// deepseek-up-T :: vendor/asar 三件套单测（list / verify / write）
//
// 这三个脚本此前**没有任何测试引用过**：`verify.mjs` 只被 `install.mjs` 间接用到，
// `write.mjs` 连一个自动调用者都没有（`TOOLS.write` 只是把路径摆在那里）——
// 也就是说「除 install.mjs 之外唯一能重写归档的工具」的那条守卫（原地重写必须 Harness 已退出）
// 从来没被跑到过。这与 `install.mjs --rollback`、`snapshot restore` 是同一类缺口。
//
// 三个层次，**都不碰在用安装包**：
//   ① 合成归档：用本文件里的**独立**序列化实现造一个几 KB 的归档（不调用被测工具，
//      两边对不上就会失败），覆盖 list/verify/write 的正常路径与用法错误；
//   ② 守卫：`--out` 指向在用归档（Harness 在跑时）、指向原版备份、以及省略 `--out` 时
//      会落在安装目录里 —— 三条都必须在**打开归档之前**被拒；
//   ③ 真实归档端到端：拿在用 `app.asar` 当输入（只读），把 `lib/main.js` 换成一小组字节，
//      产物写到 `state/cmp/` 后核对「恰好 1 个条目不同」—— 证明重打包不会动到其余 12,966 个条目。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { P, TOOLS, harnessRunning } from '../vendor/lib/harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const CMP = path.join(ROOT, 'state', 'cmp');

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, why: error.message });
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function eq(a, b, msg) {
  const ja = JSON.stringify(a);
  const jb = JSON.stringify(b);
  if (ja !== jb) throw new Error(`${msg ?? '不相等'}：${ja} !== ${jb}`);
}
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const run = (script, args) => spawnSync(process.execPath, [script, ...args], {
  encoding: 'utf8', windowsHide: true,
});

// ── ① 独立造一个合成归档 ───────────────────────────────────────────────────
// 格式（由 asar 头布局决定，见 write.mjs 注释）：
//   u32@0 = 4（pickle 标记）  u32@4 = 8 + jsonLen  u32@8 = jsonLen + 4  u32@12 = jsonLen
//   json @16，数据区 @16 + jsonLen；每个条目的 offset 4 字节对齐。
function buildArchive(entries) {
  const root = { files: {} };
  const chunks = [];
  let cursor = 0;
  const align = (n) => (n % 4 === 0 ? n : n + (4 - (n % 4)));
  for (const e of [...entries].sort((a, b) => a.path.localeCompare(b.path))) {
    const buf = Buffer.from(e.data, 'utf8');
    const parts = e.path.split('/');
    let node = root;
    for (const part of parts.slice(0, -1)) {
      node.files[part] ??= { files: {} };
      node = node.files[part];
    }
    node.files[parts.at(-1)] = { size: buf.length, offset: String(cursor) };
    chunks.push(buf);
    const next = align(cursor + buf.length);
    if (next > cursor + buf.length) chunks.push(Buffer.alloc(next - cursor - buf.length));
    cursor = next;
  }
  const json = Buffer.from(JSON.stringify(root), 'utf8');
  const b = 8 + json.length;
  const prefix = Buffer.alloc(16);
  prefix.writeUInt32LE(4, 0);
  prefix.writeUInt32LE(b, 4);
  prefix.writeUInt32LE(b - 4, 8);
  prefix.writeUInt32LE(json.length, 12);
  return Buffer.concat([prefix, json, ...chunks]);
}

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'up-t-asar-'));
const FIXTURE = path.join(sandbox, 'fixture.asar');
const ENTRY_A = 'lib/alpha.js';
const ENTRY_B = 'lib/deep/beta.js';
fs.writeFileSync(FIXTURE, buildArchive([
  { path: ENTRY_A, data: 'console.log("alpha");\n' },
  { path: ENTRY_B, data: 'module.exports = { beta: 1 };\n' },
  { path: 'package.json', data: '{ "name": "fixture" }\n' },
]));
const PAYLOAD = path.join(sandbox, 'payload.js');
fs.writeFileSync(PAYLOAD, 'console.log("replaced, and deliberately longer than the original");\n');

// 合成归档先自证：头布局与我们的读法一致（否则后面全是假象）
check('合成归档的头部布局（自洽性检查，不依赖被测工具）', () => {
  const buf = fs.readFileSync(FIXTURE);
  eq(buf.readUInt32LE(0), 4, 'pickle 标记');
  eq(buf.readUInt32LE(12), buf.readUInt32LE(4) - 8, 'jsonLength 与 u32@4 的关系');
  const json = JSON.parse(buf.subarray(16, 16 + buf.readUInt32LE(12)).toString('utf8'));
  eq(Object.keys(json.files).sort(), ['lib', 'package.json'], '顶层');
  eq(json.files.lib.files.deep.files['beta.js'].size, Buffer.byteLength('module.exports = { beta: 1 };\n'), 'beta 尺寸');
});

// ── list.mjs ──────────────────────────────────────────────────────────────
check('list：按正则列出匹配条目，路径没有前导斜杠', () => {
  const r = run(TOOLS.list, ['--archive', FIXTURE, '^lib/']);
  eq(r.status, 0, `应退出 0，stderr=${r.stderr}`);
  assert(/条目共 3 个，匹配 2 个/.test(r.stdout), `应报 3 个条目/2 个匹配，实际：${r.stdout}`);
  assert(/\n  lib\/alpha\.js\n/.test(r.stdout) && /\n  lib\/deep\/beta\.js\n/.test(r.stdout), '两个条目都要列出');
  assert(!/\n  \/lib\//.test(r.stdout), '路径不该带前导斜杠');
});

check('list：第一个位置参数是正则而不是归档 —— 显式给了不存在的归档才是干净报错', () => {
  // ① 位置参数被当正则：不给 --archive 时归档默认是**在用安装包**（存在），
  //    所以传一个「看起来像文件名」的位置参数只会得到 0 匹配，而不是 ENOENT 堆栈。
  const asRegex = run(TOOLS.list, ['一个根本不存在的归档.asar']);
  eq(asRegex.status, 0, `位置参数当正则用应正常退出，stderr=${asRegex.stderr}`);
  assert(/匹配 0 个/.test(asRegex.stdout), `应报 0 个匹配，实际：${asRegex.stdout}`);
  assert(!/at Object\.|node:internal/.test(asRegex.stderr), '不该打印堆栈');

  // ② 真的指定一个不存在的归档 → 一行清楚的报错，仍然没有堆栈。
  const missing = run(TOOLS.list, ['--archive', path.join(sandbox, '没有这个归档.asar'), '^lib/']);
  eq(missing.status, 1, '应退出 1');
  assert(/^归档不存在：/.test(missing.stderr.trim()), `实际：${missing.stderr.trim().slice(0, 200)}`);
  assert(!/at Object\.|node:internal/.test(missing.stderr), '不该打印堆栈');
});

check('list：--get 抽出的字节与造进去的逐字节相同', () => {
  const out = path.join(sandbox, 'got.js');
  const r = run(TOOLS.list, ['--get', ENTRY_B, out, '--archive', FIXTURE]);
  eq(r.status, 0, `应退出 0，stderr=${r.stderr}`);
  eq(fs.readFileSync(out, 'utf8'), 'module.exports = { beta: 1 };\n', '抽出的内容');
  assert(r.stdout.includes(FIXTURE), '要打出来源归档（`--get` 默认读在用安装包，来源必须可见）');
});

check('list：--get 一个不存在的条目 → 明确报错且不产生输出文件', () => {
  const out = path.join(sandbox, 'never-written.js');
  const r = run(TOOLS.list, ['--get', 'lib/nope.js', out, '--archive', FIXTURE]);
  eq(r.status, 1, '应退出 1');
  assert(/归档里没有这个条目/.test(r.stderr), `实际：${r.stderr}`);
  assert(!fs.existsSync(out), '不该留下空文件');
});

// ── verify.mjs ────────────────────────────────────────────────────────────
check('verify：自己跟自己比 → 逐字节一致、checked 等于条目数', () => {
  const r = run(TOOLS.verify, [FIXTURE, FIXTURE, '--expect', '0', '--json']);
  eq(r.status, 0, `应退出 0，stderr=${r.stderr}`);
  const j = JSON.parse(r.stdout.trim().split(/\r?\n/).at(-1));
  eq(j.checked, 3, '三个条目都该被比较');
  eq(j.problems, [], '不该有差异');
  eq(j.ok, true, 'ok 应为 true');
});

check('verify：SIZE 差异算「恰好 n 个」；同尺寸字节翻转永远算失败', () => {
  // 尺寸不同 → SIZE differs → 允许进 --expect 1
  const sizeChanged = path.join(sandbox, 'size-changed.asar');
  fs.writeFileSync(sizeChanged, buildArchive([
    { path: ENTRY_A, data: 'console.log("alpha but longer");\n' },
    { path: ENTRY_B, data: 'module.exports = { beta: 1 };\n' },
    { path: 'package.json', data: '{ "name": "fixture" }\n' },
  ]));
  const ok = run(TOOLS.verify, [FIXTURE, sizeChanged, '--expect', '1', '--json']);
  eq(ok.status, 0, `尺寸变化应通过，stdout=${ok.stdout}`);
  const j1 = JSON.parse(ok.stdout.trim().split(/\r?\n/).at(-1));
  eq(j1.problems.length, 1, '恰好 1 个差异');
  assert(/^SIZE differs: /.test(j1.problems[0]), `实际：${j1.problems[0]}`);

  // 同尺寸、内容不同 → BYTES differ → 即使 --expect 1 也必须失败
  const sameSize = path.join(sandbox, 'same-size.asar');
  fs.writeFileSync(sameSize, buildArchive([
    { path: ENTRY_A, data: 'console.log("ALPHA");\n' },   // 与 'console.log("alpha");\n' 同长度
    { path: ENTRY_B, data: 'module.exports = { beta: 1 };\n' },
    { path: 'package.json', data: '{ "name": "fixture" }\n' },
  ]));
  assert(
    fs.readFileSync(FIXTURE).includes(Buffer.from('console.log("alpha");\n')),
    '前置条件：原夹具里确实是这一串（大小写不同但等长）',
  );
  const bad = run(TOOLS.verify, [FIXTURE, sameSize, '--expect', '1', '--json']);
  eq(bad.status, 1, '同尺寸字节翻转必须失败');
  const j2 = JSON.parse(bad.stdout.trim().split(/\r?\n/).at(-1));
  eq(j2.ok, false, 'ok 应为 false');
  assert(/^BYTES differ: /.test(j2.problems[0]), `实际：${j2.problems[0]}`);
});

// ── write.mjs：正常路径 ───────────────────────────────────────────────────
check('write：省略 --out 写暂存位 `<归档>.tmp`，输入归档一字未变', () => {
  const before = sha(FIXTURE);
  const r = run(TOOLS.write, [FIXTURE, '--set', ENTRY_A, PAYLOAD]);
  eq(r.status, 0, `应退出 0，stderr=${r.stderr}`);
  assert(/未指定 --out，写入暂存位/.test(r.stdout), `要说明写哪去了，实际：${r.stdout}`);
  assert(fs.existsSync(`${FIXTURE}.tmp`), '应产生 <归档>.tmp');
  eq(sha(FIXTURE), before, '输入归档必须一字未变');
  fs.rmSync(`${FIXTURE}.tmp`);
});

check('write：替换一个条目 → 恰好 1 个差异，其余条目逐字节一致', () => {
  const out = path.join(sandbox, 'replaced.asar');
  const r = run(TOOLS.write, [FIXTURE, '--set', ENTRY_A, PAYLOAD, '--out', out]);
  eq(r.status, 0, `应退出 0，stderr=${r.stderr}`);
  assert(/共 3 个条目，替换 1 个/.test(r.stdout), `实际：${r.stdout}`);
  const v = run(TOOLS.verify, [FIXTURE, out, '--expect', '1', '--json']);
  eq(v.status, 0, `核对应通过，stdout=${v.stdout}`);
  const j = JSON.parse(v.stdout.trim().split(/\r?\n/).at(-1));
  eq(j.problems, [`SIZE differs: ${ENTRY_A} ${Buffer.byteLength('console.log("alpha");\n')} -> ${Buffer.byteLength('console.log("replaced, and deliberately longer than the original");\n')}`], '差异应只有这一条');
  // 条目顺序与内容：抽出来比一遍
  const got = path.join(sandbox, 'got-replaced.js');
  run(TOOLS.list, ['--get', ENTRY_A, got, '--archive', out]);
  eq(fs.readFileSync(got, 'utf8'), fs.readFileSync(PAYLOAD, 'utf8'), '替换后的字节');
});

check('write：新增一个条目 → verify 报 ADDED，且原条目一个不少', () => {
  const out = path.join(sandbox, 'added.asar');
  const r = run(TOOLS.write, [FIXTURE, '--set', 'lib/added.js', PAYLOAD, '--out', out]);
  eq(r.status, 0, `应退出 0，stderr=${r.stderr}`);
  assert(/新增条目 lib\/added\.js/.test(r.stdout), `要明说这是新增，实际：${r.stdout}`);
  const v = run(TOOLS.verify, [FIXTURE, out, '--expect', '1', '--json']);
  eq(v.status, 0, `核对应通过，stdout=${v.stdout}`);
  const j = JSON.parse(v.stdout.trim().split(/\r?\n/).at(-1));
  eq(j.problems, ['ADDED: lib/added.js'], '只该多出这一条');
});

check('write：用法错误 —— 没有 --set / 未知参数 / 输入不是文件', () => {
  const a = run(TOOLS.write, [FIXTURE]);
  eq(a.status, 1, '没有 --set 应失败');
  assert(/没有给出任何 --set 操作/.test(a.stderr), `实际：${a.stderr}`);

  const b = run(TOOLS.write, [FIXTURE, '--set', ENTRY_A, PAYLOAD, '--wat']);
  eq(b.status, 1, '未知参数应失败');
  assert(/未知参数：--wat/.test(b.stderr), `实际：${b.stderr}`);

  const c = run(TOOLS.write, [FIXTURE, '--set', ENTRY_A, path.join(sandbox, '没有这个文件')]);
  eq(c.status, 1, '输入不存在应失败');
  assert(/输入不是可读文件/.test(c.stderr), `实际：${c.stderr}`);
  assert(!fs.existsSync(`${FIXTURE}.tmp`), '失败时不该留下暂存位残渣');
});

// ── ② 三条「写哪儿」的守卫 ────────────────────────────────────────────────
const LIVE_COPY = path.join(CMP, 'write-guard-live.asar');

check('守卫：--out 指向原版备份 → 一律拒绝（哪怕输入只是一份副本）', () => {
  // 先用真实备份的哈希当基准（备份只读，不写）
  const before = fs.existsSync(P.asarBackup) ? sha(P.asarBackup) : null;
  const r = run(TOOLS.write, [FIXTURE, '--set', ENTRY_A, PAYLOAD, '--out', P.asarBackup]);
  eq(r.status, 1, '必须拒绝');
  assert(/拒绝写入原版备份/.test(r.stderr), `实际：${r.stderr}`);
  assert(/install\.mjs --rollback/.test(r.stderr), '要告诉人该怎么恢复安装包');
  if (before) eq(sha(P.asarBackup), before, '备份必须一字未变');
});

check('守卫：省略 --out 且输出会落在安装目录里 → 拒绝并给出示例', () => {
  if (!fs.existsSync(P.asar)) {
    console.log('      SKIP 在用安装包不存在，这条守卫没有现场可谈（不是失败）');
    return;
  }
  const before = sha(P.asar);
  const r = run(TOOLS.write, [P.asar, '--set', 'lib/main.js', PAYLOAD]);
  eq(r.status, 1, '必须拒绝');
  assert(/未指定 --out，而输出会落在安装目录里/.test(r.stderr), `实际：${r.stderr}`);
  assert(/\bstate[\\/]cmp[\\/]/.test(r.stderr), `要给出一个安装目录之外的例子，实际：${r.stderr}`);
  assert(!fs.existsSync(P.asarTmp), '绝不能留下 app.asar.tmp 残渣（doctor 专门报它）');
  eq(sha(P.asar), before, '在用安装包必须一字未变');
});

check('守卫：--out 指向在用归档自身（原地重写）→ 只在 Harness 退出后才允许', () => {
  // 用一份副本冒充「在用安装包」：把 DSH_UP_T_INSTALL_DIR 指到沙盒里的假安装目录，
  // 于是 write.mjs 眼里的 P.asar 就是这份副本 —— 真存档一个字都不会被碰。
  fs.mkdirSync(CMP, { recursive: true });
  const fakeResources = path.join(sandbox, 'fake-install', 'resources');
  fs.mkdirSync(fakeResources, { recursive: true });
  const fakeAsar = path.join(fakeResources, 'app.asar');
  fs.writeFileSync(fakeAsar, fs.readFileSync(FIXTURE));
  const before = sha(fakeAsar);

  const env = { ...process.env, DSH_UP_T_INSTALL_DIR: path.join(sandbox, 'fake-install') };
  const r = spawnSync(
    process.execPath,
    [TOOLS.write, fakeAsar, '--set', ENTRY_A, PAYLOAD, '--out', fakeAsar],
    { encoding: 'utf8', windowsHide: true, env },
  );

  // 真安装目录里也是同一份共用逻辑。**跑哪一条取决于 Harness 此刻在不在跑**：
  // 在跑就必须被拦下（这一条覆盖守卫），没在跑就会真的写下去（那正是它该做的事）——
  // 不能假装两种情形都测了，所以把跑到的是哪一条打印出来（同 install.test.mjs 4b-4 的做法）。
  if (harnessRunning()) {
    eq(r.status, 1, `Harness 在跑时原地重写必须被拦下，stdout=${r.stdout}`);
    assert(/原地重写正在使用的 app\.asar/.test(r.stderr), `实际：${r.stderr}`);
    assert(/pid \d+/.test(r.stderr), '要把占用进程的 pid 列出来');
    assert(/托盘/.test(r.stderr), '要告诉人怎么退出（只关窗口进程还在）');
    eq(sha(fakeAsar), before, '被拦下时目标归档必须一字未变');
    console.log('      （Harness 在跑：跑到的是「守卫拦下」这一条）');
  } else {
    eq(r.status, 0, `Harness 没在跑：原地重写应当真的写下去，stderr=${r.stderr}`);
    assert(r.status === 0 && fs.existsSync(fakeAsar), '原地重写后归档应当还在');
    const v = run(TOOLS.verify, [FIXTURE, fakeAsar, '--expect', '1', '--json']);
    eq(v.status, 0, `原地重写的结果应当恰好 1 个差异，stdout=${v.stdout}`);
    assert(sha(fakeAsar) !== before, '原地重写后内容应当真的变了');
    console.log('      （Harness 没在跑：跑到的是「真的写下去」这一条）');
  }
});

// ── ③ 真实归档端到端：重打包不会动到别的条目 ─────────────────────────────
check('真实 app.asar：换个条目的往返 → 恰好 1 个差异，其余 1 万多个归档内条目一字未动', () => {
  if (!fs.existsSync(P.asar)) {
    console.log('      SKIP 在用安装包不存在，这条端到端核对没有输入（不是失败）');
    return;
  }
  fs.mkdirSync(CMP, { recursive: true });
  const before = sha(P.asar);
  const r = run(TOOLS.write, [P.asar, '--set', 'lib/main.js', PAYLOAD, '--out', LIVE_COPY]);
  eq(r.status, 0, `应退出 0，stderr=${r.stderr}`);
  const v = run(TOOLS.verify, [P.asar, LIVE_COPY, '--expect', '1', '--json']);
  eq(v.status, 0, `应恰好 1 个差异，stdout=${v.stdout} stderr=${v.stderr}`);
  const j = JSON.parse(v.stdout.trim().split(/\r?\n/).at(-1));
  eq(j.problems.length, 1, '差异只能有一条');
  assert(/^SIZE differs: lib\/main\.js /.test(j.problems[0]), `实际：${j.problems[0]}`);
  // checked 只数**归档内**条目（`.unpacked/` 下的条目单独比元数据，不进这个计数）：
  // 在用安装包（= 改造版）有 1 万多个归档内条目，这个下界就是「重打包没有漏掉一大批」。
  assert(j.checked > 11000, `应比较上万个归档内条目，实际 ${j.checked}`);
  eq(sha(P.asar), before, '输入（在用安装包）必须一字未变');
  console.log(`      （比较了 ${j.checked} 个归档内条目，差异恰好 ${j.problems.length} 条）`);
  fs.rmSync(LIVE_COPY, { force: true });
});

// ── 收尾 ─────────────────────────────────────────────────────────────────
try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch { /* 临时目录，忽略 */ }
try { fs.rmSync(LIVE_COPY, { force: true }); } catch { /* 上面已删，忽略 */ }

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? 'OK  ' : 'FAIL'}  ${r.name}${r.ok ? '' : `\n      ${r.why}`}`);
console.log(`\nvendor/asar 三件套单测${failed.length ? '未通过' : '通过'}：${results.length - failed.length}/${results.length} 项`);
process.exit(failed.length ? 1 : 0);
