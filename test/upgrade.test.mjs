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
check('顶层条目恰好 11 个（不能把 config 里嵌套的 - id: 也算进来）', live.size === 11, `实际 ${live.size}`);
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

// ── 模拟一次升级：临时改基线版本号 ──
console.log('\n── 模拟升级（临时篡改基线，跑完还原）──');
const baselineFile = path.join(PROJECT_ROOT, 'state', 'baseline.json');
const original = fs.readFileSync(baselineFile);
const before = await sha256(baselineFile);
const payload = JSON.parse(original.toString('utf8'));
payload.dshVersion = '44.9.9-fake-upgrade';
fs.writeFileSync(baselineFile, `${JSON.stringify(payload, null, 2)}\n`);

let run;
try {
  run = spawnSync(process.execPath, ['src/cli.mjs', 'upgrade'], {
    cwd: PROJECT_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
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
  cwd: PROJECT_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
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

console.log(bad ? `\n${bad} 个失败` : `\n全部通过`);
process.exit(bad ? 1 : 0);
