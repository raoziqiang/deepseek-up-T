// deepseek-up-T :: 升级检测回归测试
//
//   node test/upgrade.test.mjs
//
// 为什么要有它：`dsht upgrade` 的价值全在判据和措辞上——判据算错顶多显示错，
// 措辞错会让人去做错事（例如把「从未落盘」当成「被升级覆盖」去查一个不存在的故障）。
// 所以每个分支都钉一条断言。
//
// 最后一段会**临时篡改** state/baseline.json 来模拟一次 Harness 升级，跑完原样还原
// （用 sha256 前后比对确认还原成功）。它只动这个 git 里的 JSON，不碰安装目录。

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { inspectDecl, inspectL0Decl, livePatchEntries } from '../src/upgrade.mjs';
import { resolvePaths, readText, sha256 } from '../src/paths.mjs';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRATCH = path.join(PROJECT_ROOT, 'state', 'cmp');
fs.mkdirSync(SCRATCH, { recursive: true });

let bad = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${extra ? `  ${extra}` : ''}`);
  if (!cond) bad += 1;
};

const P = resolvePaths();
const decls = (f) => path.join(PROJECT_ROOT, 'patches', f);

// ── L0：真实现场应当一致 ──
console.log('── L0 层 ──');
const live = livePatchEntries(readText(P.cordisPatch));
// 这里**不写死条目数** —— 每落盘一条就要改一次，而且改的时候很容易把「我加的那条」写成
// 「解析器坏了」。它真正要守的性质是：只认顶层 `- id:`，不被 config 里嵌套的那些骗到
// （现场 llm-pi-ai 的路由里就有 30 条 `- id:` 是模型的 id）。所以拿一个独立算法对照。
const liveLines = readText(P.cordisPatch).split(/\r?\n/);
const topLevelIds = liveLines.filter((l) => /^- id:/.test(l)).length;
const nestedIds = liveLines.filter((l) => /^\s+- id:/.test(l)).length;
check('顶层条目数与「顶格 - id: 行数」一致', live.size === topLevelIds, `解析 ${live.size} / 顶格 ${topLevelIds}`);
check('现场确实有嵌套的 - id:（否则上一条没在测任何东西）', nestedIds > 0, `嵌套 ${nestedIds} 条`);
const t3 = readText(decls('T3-session-search.yml'));
const applied = inspectL0Decl('T3-session-search.yml', t3, live);
check('T3 声明判定为 applied', applied.state === 'applied', applied.state);
check('T3 是 L0 层', applied.layer === 'L0');

const drifted = new Map(live);
drifted.set('session-query-sqlite', {
  id: 'session-query-sqlite', name: null, config: ["path: ':memory:'", 'openAt: never'],
});
const drift = inspectL0Decl('T3-session-search.yml', t3, drifted);
check('现场被改成内存库 ⇒ drift', drift.state === 'drift', drift.state);
check('drift 时带出两侧 config 供人对照', (drift.declConfig?.length ?? 0) > 0 && drift.liveConfig.length === 2);

const noEntry = new Map(live);
noEntry.delete('session-query-sqlite');
check('现场没有这一条 ⇒ absent', inspectL0Decl('x.yml', t3, noEntry).state === 'absent');
check('声明里找不到 - id: ⇒ error', inspectL0Decl('x.yml', '# 只有注释\n', live).state === 'error');

// ── L3：三种存在性 + 素材过期 ──
console.log('\n── L3 层 ──');
const whaleText = readText(decls('T1-whale-splash.yml'));
check('T1 声明带 target.archive ⇒ 判为 L3', /^\s*archive:\s*\S+/m.test(whaleText));

const bogus = path.join(SCRATCH, 'bogus-source.js');
fs.writeFileSync(bogus, 'this is not what is inside the archive\n');
const stale = inspectDecl(
  {
    id: 'fake',
    file: path.join(SCRATCH, 'fake.yml'),
    name: 'fake',
    expect: 1,
    entries: [],
    items: [{ path: 'lib/main.js', action: 'patch', source: './bogus-source.js' }],
  },
  { pathSet: new Set(['lib/main.js']), pristine: false, asarPath: P.asar },
);
check('素材与归档不一致 ⇒ staleSources（构建会被守卫拦下）', stale.staleSources.length === 1);
fs.unlinkSync(bogus);

const items = [...whaleText.matchAll(/^\s*-\s*path:\s*(.+?)\s*$/gm)]
  .map((m) => ({ path: m[1].replace(/\s+#.*$/, '').trim(), action: 'insert' }));
const withSet = (set, pristine) => inspectDecl({ items }, { pathSet: set, pristine, asarPath: P.asar });
check('归档 == 原版 ⇒ 一律 absent', withSet(new Set(items.map((i) => i.path)), true).state === 'absent');
check('insert 条目全缺 ⇒ absent', withSet(new Set(), false).state === 'absent');
check('insert 条目全在 ⇒ applied', withSet(new Set(items.map((i) => i.path)), false).state === 'applied');
check(
  'insert 条目一多半在 ⇒ partial',
  withSet(new Set(items.slice(0, items.length - 1).map((i) => i.path)), false).state === 'partial',
);
check(
  '只有 patch 条目 ⇒ unknown（没有存在性证据就不猜）',
  inspectDecl({ items: [{ path: 'lib/main.js', action: 'patch' }] }, { pathSet: new Set(), pristine: false }).state === 'unknown',
);

// ── 模拟一次升级：使用未打补丁的原版归档模拟被升级覆盖的环境 ──
console.log('\n── 模拟升级（临时篡改基线，跑完还原）──');
const baselineFile = path.join(PROJECT_ROOT, 'state', 'baseline.json');
const original = fs.readFileSync(baselineFile);
const before = await sha256(baselineFile);
const payload = JSON.parse(original.toString('utf8'));
payload.dshVersion = '44.9.9-fake-upgrade';
fs.writeFileSync(baselineFile, `${JSON.stringify(payload, null, 2)}\n`);

const simDir = path.join(PROJECT_ROOT, 'state', 'cmp', 'sim-upgrade');
const simRes = path.join(simDir, 'resources');
fs.mkdirSync(simRes, { recursive: true });
const simAsar = path.join(simRes, 'app.asar');
try { fs.unlinkSync(simAsar); } catch {}
if (fs.existsSync(P.asarBackup)) {
  fs.linkSync(P.asarBackup, simAsar);
}
fs.writeFileSync(path.join(simDir, 'version'), '44.0.0\n');
const simEnv = { ...process.env, DSH_UP_T_INSTALL_DIR: simDir };

let run;
try {
  run = spawnSync(process.execPath, ['src/cli.mjs', 'upgrade'], {
    cwd: PROJECT_ROOT, env: simEnv, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
} finally {
  fs.writeFileSync(baselineFile, original);
}

check('基线已原样还原（sha256 一致）', before === await sha256(baselineFile));
const out = run.stdout ?? '';
if (run.stderr?.trim()) console.log(run.stderr);
check('识别为「Harness 版本变了」', out.includes('Harness 版本变了'));
check('把 T1 列进「已被升级覆盖、需要重打」', out.includes('已被升级覆盖、需要重打的声明（1）：T1-whale-splash'));
check('此时**不再**说「尚未落盘」', !out.includes('尚未落盘'));
check('L0 仍判定为「升级幸存，无需重打」', out.includes('声明与现场一致（升级幸存，无需重打）'));
check('给出重打步骤', out.includes('node vendor/whale/install.mjs --yes'));
check('有要重打的事 ⇒ 退出码 1', run.status === 1, `实际 ${run.status}`);

// ── `--no-hash`：跳过 sha256 时必须诚实降级，不能偷偷算完再报「逐字节相同」 ──
console.log('\n── --no-hash 语义 ──');
const nh = spawnSync(process.execPath, ['src/cli.mjs', 'upgrade', '--no-hash', '--json'], {
  cwd: PROJECT_ROOT, env: simEnv, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
});
const nhJson = JSON.parse(nh.stdout);
check('--no-hash 时如实标注按大小比较', nhJson.changes.asar.basis === 'size', nhJson.changes.asar.basis);
check('--no-hash 时 sha256 为空（没有偷偷算）', nhJson.changes.asar.toHash === null);
check('--no-hash 时「是否原版」不再给结论', nhJson.pristine === null, String(nhJson.pristine));
check(
  '--no-hash 时 L3 状态仍能靠 insert 条目判定',
  nhJson.patches.find((p) => p.layer === 'L3')?.state === 'absent',
  nhJson.patches.find((p) => p.layer === 'L3')?.state,
);

// ── `--stage`：把「重打」这一步真的做掉，但不落盘 ──
//
// 要一起钉住两件事：
//   ① 它真的构建了，而且构建是按声明核对的（不是「跑完了没报错」就算数）；
//   ② `--json` 下它没有把构建自己的 stdout 混进 JSON 文档里 —— 继承 stdio 就会，
//      而且这种坏法（stdout 里多出一段人话）很难一眼看出来。
// 另有一条同样重要：构建**绝不能**碰安装目录，用 mtime 当证人。
console.log('\n── --stage：半自动重打 ──');
const stagedFile = path.join(PROJECT_ROOT, 'state', 'staged', 'app.asar');
const stageBefore = fs.existsSync(stagedFile) ? fs.statSync(stagedFile) : null;
const asarMtimeBefore = fs.statSync(P.asar).mtimeMs;

// 模拟状态：在未落盘/升级还原的基线下跑 --stage
const stageBaseline = JSON.parse(original.toString('utf8'));
stageBaseline.facts.asarBytes = 121348951;
stageBaseline.facts.asarHash = '983ca71114e6dfd353fc79af5a1f9481a250ee64c2a3c757673029b811b23bc2';
fs.writeFileSync(baselineFile, `${JSON.stringify(stageBaseline, null, 2)}\n`);

let stageJson;
let stageHuman;
try {
  stageJson = spawnSync(process.execPath, ['src/cli.mjs', 'upgrade', '--stage', '--json', '--no-hash'], {
    cwd: PROJECT_ROOT, env: simEnv, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  stageHuman = spawnSync(process.execPath, ['src/cli.mjs', 'upgrade', '--stage', '--no-hash'], {
    cwd: PROJECT_ROOT, env: simEnv, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
} finally {
  fs.writeFileSync(baselineFile, original);
  try { fs.rmSync(simDir, { recursive: true, force: true }); } catch {}
}

let stageParsed = null;
try { stageParsed = JSON.parse(stageJson.stdout); } catch { /* stageParsed 保持 null */ }
check('--stage --json 的 stdout 仍是合法 JSON（构建输出被捕获而不是继承）', stageParsed !== null);
check(
  '--stage 报告真的构建了',
  stageParsed?.staged?.attempted === true && stageParsed?.staged?.ok === true,
  JSON.stringify(stageParsed?.staged ?? null),
);
check('--stage 构建的正是缺的那条声明', (stageParsed?.staged?.ids ?? []).includes('T1-whale-splash'));
check('--stage 把构建自己的输出也带回来了（不是只报个成功）', String(stageParsed?.staged?.stdout ?? '').includes('条目按声明改动'));
check('--stage 之后暂存包存在且变新了', fs.existsSync(stagedFile) && (!stageBefore || fs.statSync(stagedFile).mtimeMs >= stageBefore.mtimeMs));
check('--stage 只写 state/，安装目录的 mtime 一动没动', fs.statSync(P.asar).mtimeMs === asarMtimeBefore);
check('--stage 退出码 0（构建成功时不该拖累退出码）', stageJson.status === 0, `实际 ${stageJson.status}`);

const stageHumanOut = stageHuman.stdout ?? '';
check('人类可读输出里说明已构建到暂存包', stageHumanOut.includes('已构建到 state/staged/app.asar'));
check('人类可读输出里仍把「落盘」留给用户，并给出两条命令', stageHumanOut.includes('完全退出 Harness') && stageHumanOut.includes('baseline write'));
check('人类可读输出里说明基线必须在落盘之后写', stageHumanOut.includes('基线必须在落盘之后写'));

// ── 落盘后的稳态：安装包已改造、原版备份还在、基线已刷新 ──
//
// 落盘之后，安装包里躺着的是**打过补丁的**代码。「素材过期」若仍拿声明素材对比在用
// 安装包，稳态下每一天都会报 3 条假过期 + 一段「重打前必须先修素材」的误导指引 ——
// 天天响的假警报会淹没升级时的真警报。基准必须跟 build.mjs 的默认 --from 同源：
// 有备份、没升级 ⇒ 比备份里的条目（备份里躺着的是没打过补丁的原版）。
console.log('\n── 落盘后稳态（不报假「素材过期」）──');
const steadyDir = path.join(SCRATCH, 'steady');
const steadyRes = path.join(steadyDir, 'resources');
fs.mkdirSync(steadyRes, { recursive: true });
const steadyAsar = path.join(steadyRes, 'app.asar');
const steadyBackup = path.join(steadyRes, 'app.asar.whale-backup');
for (const f of [steadyAsar, steadyBackup]) { try { fs.unlinkSync(f); } catch {} }
fs.linkSync(stagedFile, steadyAsar);      // 已改造的安装包（暂存产物就是落盘后的样子）
fs.linkSync(P.asarBackup, steadyBackup);  // 完好的原版备份
fs.writeFileSync(path.join(steadyDir, 'version'), '44.0.0\n');
const steadyEnv = { ...process.env, DSH_UP_T_INSTALL_DIR: steadyDir };

let steadyRun = null;
let steadyJson = null;
let steadyHuman = null;
try {
  steadyRun = spawnSync(process.execPath, ['src/cli.mjs', 'upgrade', '--no-hash', '--json'], {
    cwd: PROJECT_ROOT, env: steadyEnv, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  try { steadyJson = JSON.parse(steadyRun.stdout); } catch { /* steadyJson 保持 null */ }
  steadyHuman = spawnSync(process.execPath, ['src/cli.mjs', 'upgrade', '--no-hash'], {
    cwd: PROJECT_ROOT, env: steadyEnv, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
} finally {
  try { fs.rmSync(steadyDir, { recursive: true, force: true }); } catch {}
}

check('稳态判定为 unchanged（既没升级也没被改动）', steadyJson?.verdict === 'unchanged', String(steadyJson?.verdict ?? '(stdout 不是 JSON)'));
check(
  '稳态不再报「素材过期」（基准 = 原版备份，而不是已改造的安装包）',
  (steadyJson?.stale ?? ['?']).length === 0,
  JSON.stringify(steadyJson?.stale ?? null),
);
check(
  '每条 L3 声明的 staleSources 都为空',
  (steadyJson?.patches ?? []).filter((p) => p.layer === 'L3').every((p) => (p.staleSources ?? []).length === 0),
);
check('稳态退出码 0（不该拿假过期拖累退出码）', steadyRun?.status === 0, `实际 ${steadyRun?.status}`);
check('人类可读输出里没有「素材过期」假警报', !(steadyHuman.stdout ?? '').includes('素材过期'));
check('人类可读输出里没有「重打前必须先修素材」误导指引', !(steadyHuman.stdout ?? '').includes('重打前必须先修素材'));

console.log(bad ? `\n${bad} 个失败` : `\n全部通过`);
process.exit(bad ? 1 : 0);
