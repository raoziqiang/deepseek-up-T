// deepseek-up-T :: 快照的「创建 / 对比 / 回滚」单测
//
// test/snapshot.test.mjs 测的是**删除**（保留策略凭什么不删错东西）；
// 这个文件测的是另一半：`snapshot restore` 是会把 profile 控制面文件**覆盖**回去的那条路，
// 而且它是出事时才会跑的一条路 —— 和 `install.mjs --rollback` 同一类。
//
// 全部在一个系统临时目录里跑（用显式传入的 `P`，不依赖 DSH_HOME/DSH_PROFILE_DIR）：
// 绝不碰真实的 state/snapshots/，也绝不碰真实的 profile 文件。
//
// 重点不是「正常路径能不能恢复」，而是四条不出声的坏法：
//   ① 快照里记的绝对路径 vs 当前现场（DSH_HOME 换过之后照着旧路径写 = 报成功而现场没变）；
//   ② 手改过 / 来自别处的 meta.json 能不能指挥这个工具往任意位置写；
//   ③ 跨 profile 回滚；
//   ④ 同一秒里创建两份会不会互相盖掉（「回滚前的那一份」被静默覆盖）。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  createSnapshot, restoreSnapshot, diffSnapshot, listSnapshots, TRACKED_FILES,
} from '../src/snapshot.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, '..', 'src', 'cli.mjs');

const results = [];
async function check(name, fn) {
  try {
    await fn();
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
const read = (p) => fs.readFileSync(p, 'utf8');
const write = (p, s) => fs.writeFileSync(p, s, 'utf8');

// ── 一次性沙盒：假 DSH_HOME + 假安装目录 ──────────────────────────────────
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'up-t-snaprestore-'));
const home = path.join(root, 'home');
const profileDir = path.join(home, 'profiles', 'testprof');
const otherProfileDir = path.join(home, 'profiles', 'other');
const installDir = path.join(root, 'install');
const outside = path.join(root, 'outside');

function makePaths(over = {}) {
  const pd = over.profileDir ?? profileDir;
  const inst = over.installDir ?? installDir;
  const snap = over.snapshotsDir ?? path.join(root, 'snapshots');
  return {
    home,
    profile: over.profile ?? 'testprof',
    profileDir: pd,
    installDir: inst,
    versionFile: path.join(inst, 'version'),
    cordisPatch: path.join(pd, 'cordis.patch.yml'),
    cordisYml: path.join(pd, 'cordis.yml'),
    profilePackageJson: path.join(pd, 'package.json'),
    pnpmWorkspace: path.join(pd, 'pnpm-workspace.yaml'),
    asar: path.join(inst, 'resources', 'app.asar'),
    asarBackup: path.join(inst, 'resources', 'app.asar.whale-backup'),
    snapshotsDir: snap,
    ...over,
  };
}
const P = makePaths();
const Pother = makePaths({ profile: 'other', profileDir: otherProfileDir });

const ORIGINAL = {
  'cordis.patch.yml': '- id: tool-ralph\n  disabled: false\n',
  'cordis.yml': '[]\n',
  'package.json': '{ "name": "testprof" }\n',
};
const LIVE = { ...ORIGINAL, 'pnpm-workspace.yaml': 'packages:\n  - .\n' };

function seedLive() {
  fs.mkdirSync(profileDir, { recursive: true });
  for (const [name, text] of Object.entries(LIVE)) write(path.join(profileDir, name), text);
  fs.mkdirSync(path.dirname(P.asar), { recursive: true });
  write(P.asar, 'ORIGINAL-ASAR');
  write(P.asarBackup, 'BACKUP-ASAR');
  write(P.versionFile, '44.0.0\n');
}

seedLive();

// ── createSnapshot ────────────────────────────────────────────────────────
await check('createSnapshot：四个受控文件都被抓到，快照里的字节与原文件逐字节相同', async () => {
  const { id, dir, meta } = await createSnapshot({ label: 'T-抓取' }, P);
  eq(meta.files.map((f) => f.name), TRACKED_FILES.map((t) => t.name), '覆盖的文件清单');
  assert(meta.files.every((f) => f.present === true), '四个文件都该 present');
  for (const f of meta.files) {
    eq(read(path.join(dir, 'files', f.name)), LIVE[f.name], `${f.name} 快照内容`);
    eq(f.bytes, Buffer.byteLength(LIVE[f.name]), `${f.name} 字节数`);
    assert(/^[0-9a-f]{64}$/.test(f.sha256), `${f.name} 应有 sha256`);
  }
  eq(meta.profile, 'testprof', 'meta 里要记 profile（跨 profile 回滚靠它拦）');
  eq(meta.dshVersion, '44.0.0', 'meta 里要记 Harness 版本');
  assert(meta.asar?.sha256 && meta.asarBackup?.sha256, '两个归档指纹都要记');
  eq(listSnapshots(P)[0].id, id, '新快照应排在列表最前');
});

await check('createSnapshot：文件当时不存在 → present:false，且快照目录里不留空文件', async () => {
  const P2 = makePaths({ profileDir: path.join(root, 'empty-profile') });
  const { dir, meta } = await createSnapshot({ label: 'T-全缺' }, P2);
  assert(meta.files.every((f) => f.present === false), '一个都不该 present');
  assert(meta.files.every((f) => f.bytes === undefined && f.sha256 === undefined), '缺的文件不该有指纹');
  assert(!fs.existsSync(path.join(dir, 'files', 'cordis.patch.yml')), '快照里不该出现这个文件');
});

await check('createSnapshot：同一秒里建两份（标签也一样）不会互相盖掉', async () => {
  const before = listSnapshots(P).length;
  const a = await createSnapshot({ label: 'T-同秒' }, P);
  const b = await createSnapshot({ label: 'T-同秒' }, P);
  assert(a.id !== b.id, `两份快照的 id 应不同，实际都是 ${a.id}`);
  eq(listSnapshots(P).length, before + 2, '两份都要留在磁盘上');
  assert(fs.existsSync(path.join(a.dir, 'meta.json')) && fs.existsSync(path.join(b.dir, 'meta.json')), '两份都该完好');
});

// ── diffSnapshot ──────────────────────────────────────────────────────────
await check('diffSnapshot：一致 / 已改动 / 现在缺失 / 快照之后才出现 四种状态各自说各自的话', async () => {
  const P3 = makePaths({ profileDir: path.join(root, 'diff-profile') });
  fs.mkdirSync(P3.profileDir, { recursive: true });
  write(P3.cordisPatch, 'A\n');
  write(P3.cordisYml, 'B\n');
  write(P3.profilePackageJson, '{\n  "name": "diff-profile"\n}\n');
  // 注意：pnpm-workspace.yaml **故意不写** —— 它要在快照之后才出现
  const { id } = await createSnapshot({ label: 'T-对比' }, P3);
  write(P3.cordisPatch, 'A-CHANGED\n');              // 已改动
  fs.rmSync(P3.profilePackageJson, { force: true }); // 现在缺失（快照里有）
  write(P3.pnpmWorkspace, 'NEW\n');                  // 快照之后才出现（快照里没有）
  const { rows, asarChanged } = await diffSnapshot(id, P3);
  const by = Object.fromEntries(rows.map((r) => [r.name, r.status]));
  eq(by['cordis.yml'], '一致', '没动过的应报一致');
  eq(by['cordis.patch.yml'], '已改动', '改过的应报已改动');
  eq(by['package.json'], '现在缺失', '快照里有、现在被删掉的应报现在缺失');
  eq(by['pnpm-workspace.yaml'], '快照之后才出现（回滚不会动它）', '快照里没有、之后才有的，必须说清回滚不会动它');
  eq(asarChanged, false, 'asar 在该沙盒里存在且未动过，应报未变化');
  const changed = rows.filter((r) => r.changed).map((r) => r.name);
  eq(changed.length, 3, '「已改动」「现在缺失」「快照之后才出现」都算变化，只有「一致」不算');
});

await check('diffSnapshot：asar 指纹三种情形 —— 拿不到 / 未变化 / 已变化', async () => {
  const P7 = makePaths({
    profileDir: path.join(root, 'diff-asar-profile'),
    installDir: path.join(root, 'diff-asar-install'),
  });
  fs.mkdirSync(P7.profileDir, { recursive: true });
  write(P7.cordisPatch, 'x\n');
  const missing = await createSnapshot({ label: 'T-asar-缺' }, P7);
  eq((await diffSnapshot(missing.id, P7)).asarChanged, null, '两侧都拿不到 asar 时应报无法比对');

  fs.mkdirSync(path.dirname(P7.asar), { recursive: true });
  write(P7.asar, 'ASAR-1');
  const present = await createSnapshot({ label: 'T-asar-有' }, P7);
  eq((await diffSnapshot(present.id, P7)).asarChanged, false, 'asar 未变应报未变化');
  write(P7.asar, 'ASAR-2');
  eq((await diffSnapshot(present.id, P7)).asarChanged, true, 'asar 变了应报已变化');
});

// ── restoreSnapshot ───────────────────────────────────────────────────────
await check('restoreSnapshot：内容真的回来了，四个文件都指向**当前** profile 目录', async () => {
  const P4 = makePaths({ profileDir: path.join(root, 'restore-profile') });
  fs.mkdirSync(P4.profileDir, { recursive: true });
  for (const [name, text] of Object.entries(LIVE)) write(path.join(P4.profileDir, name), text);
  const { id } = await createSnapshot({ label: 'T-回滚' }, P4);

  write(P4.cordisPatch, '被改坏了\n');
  fs.rmSync(P4.pnpmWorkspace);                      // 被删掉
  write(P4.cordisYml, '[]\n# 也被改了\n');

  const res = await restoreSnapshot(id, { preSnapshot: false }, P4);
  eq(res.skipped, [], '不该有跳过项');
  eq(res.restored.map((r) => r.name).sort(), Object.keys(LIVE).sort(), '四个文件都该回来');
  for (const r of res.restored) {
    eq(r.dest, path.join(P4.profileDir, r.name), `${r.name} 的目标应是当前 profile 目录`);
    eq(r.relocatedFrom, null, '同一处现场不该报 relocated');
    eq(read(r.dest), LIVE[r.name], `${r.name} 内容应逐字节回到快照那一刻`);
  }
});

await check('restoreSnapshot：回滚前自动留一份，存的是**回滚前**（被改坏的）现场', async () => {
  const P5 = makePaths({ profileDir: path.join(root, 'prerestore-profile') });
  fs.mkdirSync(P5.profileDir, { recursive: true });
  for (const [name, text] of Object.entries(LIVE)) write(path.join(P5.profileDir, name), text);
  const { id } = await createSnapshot({ label: 'T-回滚前留档' }, P5);
  write(P5.cordisPatch, '现场被改过的样子\n');
  const res = await restoreSnapshot(id, {}, P5);
  assert(/^[0-9]{8}-[0-9]{6}-prerestore-/.test(res.preSnapshot ?? ''), `应留下 prerestore 快照，实际：${res.preSnapshot}`);
  const pre = listSnapshots(P5).find((s) => s.id === res.preSnapshot);
  eq(
    read(path.join(P5.snapshotsDir, pre.id, 'files', 'cordis.patch.yml')),
    '现场被改过的样子\n',
    '留档要存回滚前的现场，而不是回滚后的',
  );
  eq(read(P5.cordisPatch), LIVE['cordis.patch.yml'], '现场应已回到快照那一刻');
});

await check('restoreSnapshot：跨 profile 拒绝，且一个文件都不写', async () => {
  const { id } = await createSnapshot({ label: 'T-跨profile' }, P);
  let threw = null;
  try { await restoreSnapshot(id, { preSnapshot: false }, Pother); } catch (e) { threw = e; }
  assert(threw, '跨 profile 回滚必须抛错');
  assert(/拒绝跨 profile/.test(threw.message), `错误信息要说清原因，实际：${threw.message}`);
  assert(!fs.existsSync(Pother.cordisPatch), '不该在别的 profile 里写出文件');
});

await check('restoreSnapshot：快照不存在或没有 meta.json → 抛错', async () => {
  for (const id of ['20260101-000000-不存在', '']) {
    let threw = null;
    try { await restoreSnapshot(id, { preSnapshot: false }, P); } catch (e) { threw = e; }
    assert(threw, `${JSON.stringify(id)} 应抛错`);
    assert(/不存在或已损坏/.test(threw.message), `实际：${threw.message}`);
  }
});

// ★ 这一条是「报成功、而现场一个字没变」的防线上最值钱的一段
await check('restoreSnapshot：meta 里记着旧家目录的绝对路径时，写的是当前现场，并报出 relocated', async () => {
  const moved = makePaths({
    profileDir: path.join(root, 'moved-new'),
    cordisPatch: path.join(root, 'moved-new', 'cordis.patch.yml'),
    cordisYml: path.join(root, 'moved-new', 'cordis.yml'),
    profilePackageJson: path.join(root, 'moved-new', 'package.json'),
    pnpmWorkspace: path.join(root, 'moved-new', 'pnpm-workspace.yaml'),
  });
  const stale = path.join(root, 'moved-old');
  fs.mkdirSync(moved.profileDir, { recursive: true });
  fs.mkdirSync(stale, { recursive: true });
  for (const [name, text] of Object.entries(LIVE)) write(path.join(moved.profileDir, name), text);
  const { id } = await createSnapshot({ label: 'T-搬家' }, moved);

  // 模拟「快照是在另一个 DSH_HOME 下拍的」：meta 里的 src 指向旧家目录
  const metaPath = path.join(moved.snapshotsDir, id, 'meta.json');
  const meta = JSON.parse(read(metaPath));
  for (const f of meta.files) if (f.src) f.src = path.join(stale, f.name);
  write(metaPath, JSON.stringify(meta, null, 2));

  write(moved.cordisPatch, '改坏\n');
  const res = await restoreSnapshot(id, { preSnapshot: false }, moved);
  const row = res.restored.find((r) => r.name === 'cordis.patch.yml');
  eq(row.dest, moved.cordisPatch, '要写当前现场的位置');
  assert(row.relocatedFrom === path.join(stale, 'cordis.patch.yml'), '要把「快照记的是哪条路径」报出来');
  eq(read(moved.cordisPatch), LIVE['cordis.patch.yml'], '当前现场应真的被恢复了');
  assert(!fs.existsSync(path.join(stale, 'cordis.patch.yml')), '绝不能照着旧路径去写');
});

await check('restoreSnapshot：不认识的条目 + 记录路径在 profile 之外 → 跳过并说明，绝不写出去', async () => {
  const P6 = makePaths({ profileDir: path.join(root, 'tamper-profile') });
  fs.mkdirSync(P6.profileDir, { recursive: true });
  for (const [name, text] of Object.entries(LIVE)) write(path.join(P6.profileDir, name), text);
  const { id, dir } = await createSnapshot({ label: 'T-篡改' }, P6);
  const metaPath = path.join(dir, 'meta.json');
  const meta = JSON.parse(read(metaPath));
  fs.mkdirSync(path.join(dir, 'files'), { recursive: true });
  // 一条不认识的文件名，且路径指向 profile 之外（例如别处的一个 .yml）
  write(path.join(dir, 'files', 'evil.yml'), 'PWNED\n');
  meta.files.push({ name: 'evil.yml', src: path.join(outside, 'evil.yml'), present: true });
  write(metaPath, JSON.stringify(meta, null, 2));

  const res = await restoreSnapshot(id, { preSnapshot: false }, P6);
  const skipped = res.skipped.find((s) => s.name === 'evil.yml');
  assert(skipped, '越界的条目必须被跳过');
  assert(/不在当前 profile 目录内/.test(skipped.why), `跳过理由要说清，实际：${skipped.why}`);
  assert(!fs.existsSync(path.join(outside, 'evil.yml')), '绝不能写到 profile 之外');
  eq(res.restored.length, Object.keys(LIVE).length, '其余四个文件照常恢复');
});

// ── CLI 那一层的闸门：不带 --yes 什么都别动 ───────────────────────────────
await check('CLI：snapshot restore 不带 --yes 时只预演，明说还没动任何文件', () => {
  const snapshotId = listSnapshots()[0]?.id;
  if (!snapshotId) {
    console.log('      SKIP 真实 state/snapshots/ 里还没有快照，无法跑 CLI 预演（不是失败）');
    return;
  }
  const r = spawnSync(process.execPath, [CLI, 'snapshot', 'restore', snapshotId], { encoding: 'utf8' });
  eq(r.status, 0, `预演应正常结束，stderr=${r.stderr}`);
  assert(/将被覆盖的文件/.test(r.stdout), '要列出将被覆盖的文件');
  assert(/此刻还没有动任何文件/.test(r.stdout), '要明说此刻什么都没动');
  assert(/确认请加 --yes 重跑/.test(r.stdout), '要给出确认方式');
  assert(!/已从快照/.test(r.stdout), '没有 --yes 时不该真的回滚');
});

// ── 收尾 ─────────────────────────────────────────────────────────────────
try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* 临时目录，忽略 */ }

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? 'OK  ' : 'FAIL'}  ${r.name}${r.ok ? '' : `\n      ${r.why}`}`);
console.log(`\n快照创建/对比/回滚单测${failed.length ? '未通过' : '通过'}：${results.length - failed.length}/${results.length} 项`);
process.exit(failed.length ? 1 : 0);
