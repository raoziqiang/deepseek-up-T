// deepseek-up-T :: 落盘链路的端到端演练（离线、不碰在用安装包）
//
//   node test/install.test.mjs
//
// 为什么要有它：`vendor/whale/install.mjs` 是这个项目里**唯一**会覆盖在用 app.asar 的地方，
// 而它过去只有在真落盘那一刻才能被验证 —— 一年做几次的事，等于没验证。它最危险的两种坏法都很安静：
//   · 覆盖了但在写之前忘了确认 Harness 已退出（Windows 会 EPERM，或者更糟：写坏一个正在被 mmap 的文件）；
//   · 写完只看退出码，不去核对「实际改的条目集合」是不是声明里那几条（锚点全命中、却静默改了别的东西）。
// 所以这里用 `--to <临时目标>` 把整条链路（构建 → 落盘 → 按声明核对）在临时文件上真跑一遍，并用
// **sha256 证明在用安装包一个字都没动**。
//
// 唯一不做的事：不跑「--to 指向真 asar」那条分支 —— 那会变成「测试替用户落盘」，
// 万一守卫坏了就真的改了安装包。那一条只用源码文本断言它存在且刻意走真落盘路径。

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readPatchDecl } from '../src/patchdecl.mjs';
import { resolvePaths, sha256, readText } from '../src/paths.mjs';
import { runAsarVerify, compareDeclared, harnessProcesses } from '../vendor/lib/harness.mjs';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRATCH = path.join(PROJECT_ROOT, 'state', 'cmp');
fs.mkdirSync(SCRATCH, { recursive: true });

let bad = 0;
let skipped = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${extra ? `  ${extra}` : ''}`);
  if (!cond) bad += 1;
};
const skip = (name, why) => {
  console.log(`SKIP ${name}  ${why}`);
  skipped += 1;
};

const P = resolvePaths();
const STAGED = path.join(PROJECT_ROOT, 'state', 'staged', 'app.asar');
const REHEARSAL = path.join(SCRATCH, 'install-e2e-rehearsal.asar');
const DECL_FILE = path.join(PROJECT_ROOT, 'patches', 'T1-whale-splash.yml');

const run = (args, opts = {}) => spawnSync(process.execPath, args, {
  cwd: PROJECT_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts,
});

// ── 现场事实（不是断言，是取证；出了意外时这几行是唯一的上下文）──
const procs = harnessProcesses();
const asarHashBefore = await sha256(P.asar);
const backupHash = await sha256(P.asarBackup);
console.log(`现场：Harness 进程 ${procs.length} 个${procs.length ? `（pid ${procs.map((p) => p.pid).join(', ')}）` : ''}`);
console.log(`      在用安装包 ${fs.statSync(P.asar).size} 字节  ${asarHashBefore.slice(0, 16)}…`);
console.log(`      原版备份   ${fs.statSync(P.asarBackup).size} 字节  ${backupHash.slice(0, 16)}…`);

// ── 1. 两次独立构建必须逐字节相同（确定性；不确定的构建没法核对差异集合）──
console.log('\n── 构建的确定性 ──');
fs.rmSync(REHEARSAL, { force: true });

const built = run(['vendor/whale/build.mjs']);
check('build.mjs 退出码 0', built.status === 0, `实际 ${built.status}`);
const stagedHash1 = await sha256(STAGED);
check('暂存包不等于原版（确实是一次改造）', stagedHash1 !== backupHash);

const staged2 = run(['src/cli.mjs', 'upgrade', '--stage', '--json', '--no-hash']);
check('upgrade --stage 退出码 0', staged2.status === 0, `实际 ${staged2.status}`);
const stagedHash2 = await sha256(STAGED);
check('两次独立构建逐字节相同（同一输入 ⇒ 同一产物）', stagedHash1 === stagedHash2,
  `${stagedHash1.slice(0, 16)}… / ${stagedHash2.slice(0, 16)}…`);

// ── 2. 声明的自洽：声明写的条目数 == 实际差异条目集合 ──
console.log('\n── 声明与实际差异 ──');
const decl = readPatchDecl(DECL_FILE);
check('声明的 expect_diff_entries 与列出的条目数一致', decl.expect === decl.entries.length,
  `expect ${decl.expect} / entries ${decl.entries.length}`);
check('声明的条目都是相对路径（否则核对会永远对不上）', decl.entries.every((e) => !path.isAbsolute(e)));

// ── 3. 演练落盘：整条链路在临时目标上真跑一遍 ──
console.log('\n── 演练落盘（--to）──');
const rehearsal = run(['vendor/whale/install.mjs', '--yes', '--to', REHEARSAL]);
check('演练退出码 0', rehearsal.status === 0, `实际 ${rehearsal.status}${rehearsal.stderr ? ` · ${rehearsal.stderr.trim().split(/\r?\n/).slice(-1)[0]}` : ''}`);
check('演练产出的归档与暂存包逐字节相同', fs.existsSync(REHEARSAL) && (await sha256(REHEARSAL)) === stagedHash1);
check('演练**不消费**暂存包（真落盘会把暂存包移走，演练必须留下它）', fs.existsSync(STAGED));
check('演练输出明说「这次写的不是在用安装包」', /不是\*\*在用安装包|不是在用安装包/.test(rehearsal.stdout ?? ''));

const diff = runAsarVerify(P.asarBackup, REHEARSAL, decl.expect);
check('按原版备份核对：恰好是声明的那个差异数', diff.ok, `problems ${diff.problems.length}`);
const cmp = compareDeclared(decl, diff.problems);
check('实际改动的条目一条不多', cmp.undeclared.length === 0, cmp.undeclared.join(', '));
check('声明的条目一条不少', cmp.missing.length === 0, cmp.missing.join(', '));
check('实际差异条目数 == 声明数 == 列出数', cmp.actual.size === decl.expect && cmp.actual.size === decl.entries.length,
  `${cmp.actual.size}`);

// ── 4. 守卫：三条「不许写」的路 ──
console.log('\n── 守卫 ──');
const noYes = run(['vendor/whale/install.mjs']);
check('不给 --yes 时拒绝落盘', noYes.status === 1, `实际 ${noYes.status}`);
check('拒绝的提示里给出加 --yes 的完整命令', /--yes/.test(`${noYes.stdout}${noYes.stderr}`));

const inInstallDir = run(['vendor/whale/install.mjs', '--yes', '--to', path.join(P.resourcesDir, 'app.asar.rehearsal')]);
const strayFile = path.join(P.resourcesDir, 'app.asar.rehearsal');
check('--to 落在安装目录里时拒绝（免得让人以为落盘了）', inInstallDir.status === 1, `实际 ${inInstallDir.status}`);
check('拒绝时确实什么都没写', !fs.existsSync(strayFile));
check('拒绝的理由里指出 Harness 读的仍是哪一个文件', /Harness 读的仍是/.test(inInstallDir.stderr ?? ''));

// 「--to 指向真 asar」必须走真落盘路径（不是绕过守卫的后门）。只做源码断言：
// 在测试里跑它 = 测试替用户落盘，万一守卫坏了就真改了安装包。
const src = readText(path.join(PROJECT_ROOT, 'vendor', 'whale', 'install.mjs'));
check('--to 指向在用安装包时被刻意当成真落盘（不给 --to 开后门）',
  /--to 指的就是在用安装包，按真落盘处理/.test(src));
check('守卫调用排在所有写操作之前',
  src.indexOf("assertHarnessStopped('覆盖 app.asar')") < src.indexOf('fs.copyFileSync(P.asar, P.asarBackup)'),
  '先确认 Harness 已退出，才轮到备份与覆盖');

// 守卫函数本身：Harness 在跑时必须拦下（用真函数、真进程表，不是读源码猜）
const guardUrl = pathToFileURL(path.join(PROJECT_ROOT, 'vendor', 'lib', 'harness.mjs')).href;
const guard = spawnSync(process.execPath, [
  '--input-type=module', '-e',
  `import { assertHarnessStopped } from ${JSON.stringify(guardUrl)};\n` +
  'assertHarnessStopped("测试动作");\n' +
  'process.stdout.write("GUARD-DID-NOT-TRIP\\n");',
], { cwd: PROJECT_ROOT, encoding: 'utf8' });

if (procs.length > 0) {
  check('Harness 在跑时 assertHarnessStopped 拦下（退出码 1）', guard.status === 1, `实际 ${guard.status}`);
  check('拦下的提示里点出占用者 pid 与「托盘退出」这条路',
    /不能测试动作/.test(guard.stderr ?? '') && /pid \d+/.test(guard.stderr ?? '') && /托盘/.test(guard.stderr ?? ''));
  check('守卫本身不写任何文件（它只读进程表）', (await sha256(P.asar)) === asarHashBefore);
} else {
  skip('Harness 在跑时 assertHarnessStopped 拦下', '这次 Harness 没在跑，拦不下来的那条路测不到');
  check('Harness 没在跑时守卫放行（不是无条件拒绝）', guard.status === 0 && /GUARD-DID-NOT-TRIP/.test(guard.stdout ?? ''));
}

// ── 4b. 回滚：唯一一条回头路 ──
//
// 它是出事时才会跑的那条命令，而它过去**一个字都没有测过**（连排练模式都没有）。
// 真回滚会覆盖在用 app.asar，所以这里用 DSH_UP_T_INSTALL_DIR 把整个「安装目录」
// 换成一个临时目录再跑真回滚 —— 走的还是同一段代码，但写坏也写不到真安装包。
console.log('\n── 回滚（--rollback）──');
const RB_REHEARSAL = path.join(SCRATCH, 'install-e2e-rollback.asar');
const FAKE_INSTALL = path.join(SCRATCH, 'fake-install');
const FAKE_ASAR = path.join(FAKE_INSTALL, 'resources', 'app.asar');
const FAKE_BACKUP = path.join(FAKE_INSTALL, 'resources', 'app.asar.whale-backup');
fs.rmSync(FAKE_INSTALL, { recursive: true, force: true });
fs.rmSync(RB_REHEARSAL, { force: true });
fs.mkdirSync(path.dirname(FAKE_ASAR), { recursive: true });
fs.writeFileSync(FAKE_ASAR, 'not-an-archive-before-rollback');
// 备份只被读、从不被写 ⇒ 硬链过去，省一次 121MB 拷贝（同卷才成功，不行就退回复制）。
try { fs.linkSync(P.asarBackup, FAKE_BACKUP); } catch { fs.copyFileSync(P.asarBackup, FAKE_BACKUP); }
const fakeBefore = await sha256(FAKE_ASAR);

// 4b-1 演练：恢复到一个临时文件（Harness 开着也能跑）
const rbReh = run(['vendor/whale/install.mjs', '--rollback', '--to', RB_REHEARSAL]);
check('回滚演练退出码 0', rbReh.status === 0, `实际 ${rbReh.status}`);
check('回滚演练产物与备份逐字节相同', fs.existsSync(RB_REHEARSAL) && (await sha256(RB_REHEARSAL)) === backupHash);
check('回滚演练明说这次写的不是在用安装包', /不是\*\*在用安装包|不是在用安装包/.test(rbReh.stdout ?? ''));
check('回滚演练打印核对结论（不是只看退出码）', /逐字节一致（0 个差异）/.test(rbReh.stdout ?? ''));
check('回滚不需要 --yes（失败提示里印出来让人原样复制的就是这条命令）',
  !/确认要执行请再加 --yes/.test(`${rbReh.stdout}${rbReh.stderr}`) && rbReh.status === 0);

// 4b-2 与落盘同一条规矩：演练目标不许落在安装目录里，免得以为回滚了
const rbInside = run(
  ['vendor/whale/install.mjs', '--rollback', '--to', path.join(FAKE_INSTALL, 'resources', 'app.asar.rb')],
  { env: { ...process.env, DSH_UP_T_INSTALL_DIR: FAKE_INSTALL } },
);
check('回滚演练目标落在安装目录里时拒绝', rbInside.status === 1, `实际 ${rbInside.status}`);
check('拒绝时确实什么都没写', !fs.existsSync(path.join(FAKE_INSTALL, 'resources', 'app.asar.rb')));
check('拒绝的理由里指出 Harness 读的仍是哪一个文件', /Harness 读的仍是/.test(rbInside.stderr ?? ''));

// 4b-3 没有备份时：先报「没有备份可回滚」，而不是先抱怨 Harness 在跑
const FAKE_NOBACKUP = path.join(SCRATCH, 'fake-install-nobackup');
fs.rmSync(FAKE_NOBACKUP, { recursive: true, force: true });
fs.mkdirSync(path.join(FAKE_NOBACKUP, 'resources'), { recursive: true });
const NOBACKUP_ASAR = path.join(FAKE_NOBACKUP, 'resources', 'app.asar');
fs.writeFileSync(NOBACKUP_ASAR, 'untouched');
const rbNoBackup = run(['vendor/whale/install.mjs', '--rollback'],
  { env: { ...process.env, DSH_UP_T_INSTALL_DIR: FAKE_NOBACKUP } });
check('没有备份时回滚拒绝（退出码 1）', rbNoBackup.status === 1, `实际 ${rbNoBackup.status}`);
check('拒绝的理由是「没有备份」，不是先怨 Harness 在跑（先看有没有回头路）',
  /没有备份可回滚/.test(rbNoBackup.stderr ?? ''), (rbNoBackup.stderr ?? '').trim().split(/\r?\n/).filter(Boolean)[0] ?? '');
check('拒绝时不碰那个 app.asar', fs.readFileSync(NOBACKUP_ASAR, 'utf8') === 'untouched');

// 4b-4 真回滚（跑在临时「安装目录」里，不是真安装包）
const rbReal = run(['vendor/whale/install.mjs', '--rollback'],
  { env: { ...process.env, DSH_UP_T_INSTALL_DIR: FAKE_INSTALL } });
const fakeAfter = await sha256(FAKE_ASAR);
if (procs.length > 0) {
  // Harness 在跑 ⇒ 只可能走到守卫那一步。这本身就是要测的东西：回滚也过同一个守卫。
  check('Harness 在跑时回滚被守卫拦下（退出码 1）', rbReal.status === 1, `实际 ${rbReal.status}`);
  check('拦下的提示点出占用者 pid，并说清拦的是「从备份回滚」',
    /从备份回滚/.test(rbReal.stderr ?? '') && /pid \d+/.test(rbReal.stderr ?? ''));
  check('被拦下时目标安装目录里的 app.asar 一个字节都没动', fakeAfter === fakeBefore);
} else {
  check('Harness 没在跑时真回滚执行成功（退出码 0）', rbReal.status === 0, `实际 ${rbReal.status}`);
  check('回滚把 app.asar 换成了备份的内容（原先是个占位文件）', fakeAfter === backupHash);
  check('回滚后的输出给出重刷基线这一步', /baseline write/.test(rbReal.stdout ?? ''));
  check('回滚后的输出说明怎么再装回改造版', /build\.mjs/.test(rbReal.stdout ?? ''));
}

// 4b-5 源码层面的结构性不变量
check('回滚的守卫排在复制之前',
  src.indexOf("assertHarnessStopped('从备份回滚 app.asar')") < src.indexOf('fs.copyFileSync(P.asarBackup, P.asar)'),
  '先确认 Harness 已退出，才轮得到覆盖');
check('回滚的核对是一段共用代码（演练通过 == 真回滚通过）',
  (src.match(/verifyRollback\(/g) ?? []).length >= 3, '定义 1 次 + 演练与真回滚各 1 次');

// ── 5. 全程之后：在用安装包一个字节都没变 ──
console.log('\n── 在用安装包 ──');
check('全程结束后在用安装包 sha256 未变', (await sha256(P.asar)) === asarHashBefore);
check('原版备份 sha256 也未变', (await sha256(P.asarBackup)) === backupHash);

// ── 6. 不留痕 ──
fs.rmSync(REHEARSAL, { force: true });
fs.rmSync(RB_REHEARSAL, { force: true });
fs.rmSync(FAKE_INSTALL, { recursive: true, force: true });
fs.rmSync(FAKE_NOBACKUP, { recursive: true, force: true });
check('演练产物已清理（测试不许给真实环境留状态）',
  !fs.existsSync(REHEARSAL) && !fs.existsSync(RB_REHEARSAL) && !fs.existsSync(FAKE_INSTALL));

console.log('');
if (bad) {
  console.log(`落盘演练失败：${bad} 项${skipped ? `（另有 ${skipped} 项跳过）` : ''}`);
  process.exit(1);
}
console.log(`落盘演练全部通过${skipped ? `（${skipped} 项跳过：见上面的 SKIP 行）` : ''}`);
