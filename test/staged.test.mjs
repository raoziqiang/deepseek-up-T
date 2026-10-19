// deepseek-up-T :: 「暂存包 vs 在用安装包」判定的单测
//
// 暂存包判定只留在终端（dsht doctor / upgrade）。设置页不再展示它。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { stagedVerdict, stagedFacts, stagedLine } from '../src/staged.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const PROJECT = path.resolve(HERE, '..');

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

const MIN = 60_000;

// ── 1. 判定表本身：五个状态各自说各自的话 ────────────────────────────────
check('五个状态：每一种都给得出状态、人话与差值，且不把「拿不到」说成「有改动」', () => {
  const pending = stagedVerdict({ bytes: 121_422_676, mtimeMs: 2000 * MIN, installedBytes: 121_421_984, installedMtimeMs: 1000 * MIN });
  eq(pending.status, 'pending', 'pending.status');
  eq(pending.deltaBytes, 692, 'pending.deltaBytes');
  assert(pending.why.includes('比在用安装包新'), `pending.why 应说清新旧：${pending.why}`);

  const behind = stagedVerdict({ bytes: 100, mtimeMs: 1000 * MIN, installedBytes: 200, installedMtimeMs: 2000 * MIN });
  eq(behind.status, 'behind', 'behind.status');
  assert(behind.why.includes('别用它落盘'), `behind.why 必须警告别落盘：${behind.why}`);

  const same = stagedVerdict({ bytes: 500, mtimeMs: 2000 * MIN, installedBytes: 500, installedMtimeMs: 1000 * MIN });
  eq(same.status, 'same-size', 'same-size.status');
  eq(same.deltaBytes, 0, 'same-size.deltaBytes');
  assert(same.why.includes('不等于逐字节相同'), `大小相同不许说成逐字节相同：${same.why}`);

  // 大小一样时，即便 mtime 说暂存更新，也不许升级成 pending —— 那会让人去落一个「没变化」的包。
  const sameNewer = stagedVerdict({ bytes: 500, mtimeMs: 9000 * MIN, installedBytes: 500, installedMtimeMs: 1000 * MIN });
  eq(sameNewer.status, 'same-size', '大小相同优先于 mtime');

  const differs = stagedVerdict({ bytes: 100, mtimeMs: null, installedBytes: 200, installedMtimeMs: 2000 * MIN });
  eq(differs.status, 'differs', 'differs.status');
  assert(differs.why.includes('判不出谁更新'), `differs 必须承认判不出方向：${differs.why}`);

  const zero = stagedVerdict({ bytes: 0, mtimeMs: 2000 * MIN, installedBytes: 200, installedMtimeMs: 1000 * MIN });
  eq(zero.status, 'unavailable', '0 字节必须是「拿不到」');
  assert(zero.why.includes('0 字节不是「有改动」的证据'), `0 字节的措辞：${zero.why}`);
  eq(zero.deltaBytes, null, '0 字节时不该给差值');

  const noInst = stagedVerdict({ bytes: 123, mtimeMs: 2000 * MIN, installedBytes: null, installedMtimeMs: null });
  eq(noInst.status, 'unavailable', '拿不到在用大小 ⇒ unavailable');
  assert(noInst.why.includes('没拿到在用安装包的大小'), `措辞要指出缺哪一份事实：${noInst.why}`);

  const noBytes = stagedVerdict({ bytes: null, mtimeMs: null, installedBytes: 200, installedMtimeMs: null });
  eq(noBytes.status, 'unavailable', '拿不到暂存大小 ⇒ unavailable');
});

// ── 2. 读磁盘那一半：判定方向靠 mtime，缺证据就降级 ──────────────────────
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'up-t-staged-'));
const stagedFile = path.join(sandbox, 'app.asar');
const asar = path.join(sandbox, 'installed.asar');

function write(p, bytes) {
  fs.writeFileSync(p, Buffer.alloc(bytes, 0x41));
}

check('真文件：暂存包更新的 mtime ⇒ pending，并带出差值字节数', () => {
  write(asar, 400);
  write(stagedFile, 692);
  // mtime 要显式设，不能靠「谁后写谁更新」—— 那样测的是写入顺序，不是判定。
  const older = new Date(Date.now() - 600_000);
  fs.utimesSync(asar, older, older);
  fs.utimesSync(stagedFile, new Date(), new Date());
  const facts = stagedFacts({ stagedFile, asar });
  eq(facts.status, 'pending', 'status');
  eq(facts.deltaBytes, 692 - 400, 'deltaBytes');
  eq(facts.file, stagedFile, 'file');
});

check('真文件：把暂存包的 mtime 调旧 ⇒ behind（而不是仍然说待落盘）', () => {
  const old = new Date(Date.now() - 3600_000);
  fs.utimesSync(stagedFile, old, old);
  const facts = stagedFacts({ stagedFile, asar });
  eq(facts.status, 'behind', 'status');
  assert(facts.why.includes('别用它落盘'), facts.why);
});

check('真文件：大小相同 ⇒ same-size（不给方向，也不假称逐字节相同）', () => {
  write(stagedFile, 400);
  const facts = stagedFacts({ stagedFile, asar });
  eq(facts.status, 'same-size', 'status');
  eq(facts.deltaBytes, 0, 'deltaBytes');
});

check('真文件：0 字节的暂存包 ⇒ unavailable，并说清「0 字节不是证据」', () => {
  write(stagedFile, 0);
  const facts = stagedFacts({ stagedFile, asar });
  eq(facts.status, 'unavailable', 'status');
  assert(facts.why.includes('0 字节'), facts.why);
});

check('真文件：暂存包不存在 ⇒ unavailable，且提示用哪两条命令生成它', () => {
  fs.rmSync(stagedFile);
  const facts = stagedFacts({ stagedFile, asar });
  eq(facts.status, 'unavailable', 'status');
  assert(facts.why.includes('还没构建过暂存包'), facts.why);
  assert(facts.why.includes('vendor/whale/build.mjs'), `要给出构建命令：${facts.why}`);
  eq(facts.bytes, null, 'bytes 应为 null');
});

check('真文件：在用安装包读不到 ⇒ unavailable（不是「不同」）', () => {
  write(stagedFile, 700);
  const facts = stagedFacts({ stagedFile, asar: path.join(sandbox, 'nope.asar') });
  eq(facts.status, 'unavailable', 'status');
  assert(facts.why.includes('没拿到在用安装包的大小'), facts.why);
});

// ── 4. 报告用的一行话 ────────────────────────────────────────────────────
check('stagedLine：pending / behind 带差值字节数，unavailable 照实说', () => {
  const p = stagedLine({ status: 'pending', why: '暂存包比在用安装包新', deltaBytes: 692 });
  assert(p.includes('大 692 字节'), p);
  const b = stagedLine({ status: 'behind', why: '暂存包比在用安装包旧 —— 别用它落盘，先重新构建', deltaBytes: -12 });
  assert(b.includes('小 12 字节'), b);
  const u = stagedLine({ status: 'unavailable', why: '没拿到在用安装包的大小，无法与暂存包比较', deltaBytes: null });
  eq(u, '没拿到在用安装包的大小，无法与暂存包比较', 'unavailable 的一行话');
});

// ── 5. 这一行真的进了 doctor 的输出（而不是只有单测知道）────────────────
check('dsht doctor 的报告里有「暂存包」这一条（终端也能看到，不是只有胶囊知道）', () => {
  const r = spawnSync(process.execPath, [path.join(PROJECT, 'src', 'cli.mjs'), 'doctor', '--no-hash'], {
    cwd: PROJECT, encoding: 'utf8', timeout: 120_000, windowsHide: true,
  });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  assert(r.status === 0, `doctor 退出码应为 0，实际 ${r.status}`);
  assert(out.includes('暂存包'), `doctor 输出里没有「暂存包」这一条：\n${out.slice(0, 400)}`);
});

// ── 收尾 ────────────────────────────────────────────────────────────────
fs.rmSync(sandbox, { recursive: true, force: true });

let bad = 0;
for (const r of results) {
  if (r.ok) console.log(`  ok   ${r.name}`);
  else { bad += 1; console.log(`  FAIL ${r.name}\n       ${r.why}`); }
}
console.log(`\n暂存包判定单测${bad ? '失败' : '通过'}：${results.length - bad}/${results.length} 项`);
process.exit(bad ? 1 : 0);
