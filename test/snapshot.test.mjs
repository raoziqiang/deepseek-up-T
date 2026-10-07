// deepseek-up-T :: 快照保留策略单测
//
// 这里的每一条断言都在回答同一个问题：**这个会删目录的工具，凭什么不会删错东西。**
// 全部在系统临时目录里跑，绝不碰 state/snapshots/。
//
// 快照的另一半 —— **创建 / 对比 / 回滚**（`snapshot restore` 会把 profile 控制面文件覆盖回去）——
// 在 `test/snapshot-restore.test.mjs` 里测。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { globToRe, planPrune, deleteSnapshots, listSnapshots } from '../src/snapshot.mjs';

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

// ── 一次性沙盒 ────────────────────────────────────────────────────────────
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'up-t-snap-'));
const P = { snapshotsDir: root };

function makeSnapshot(id, { withMeta = true, createdAt = null } = {}) {
  const dir = path.join(root, id);
  fs.mkdirSync(dir, { recursive: true });
  if (withMeta) {
    fs.writeFileSync(
      path.join(dir, 'meta.json'),
      JSON.stringify({ id, createdAt: createdAt ?? `${id.slice(0, 15)}T00:00:00.000Z`, label: null, files: [] }),
      'utf8',
    );
  }
  return dir;
}

// id 形如 20261006-084554-<label>，字典序降序 = 时间降序（与 listSnapshots 的排序一致）
makeSnapshot('20261006-090000-newest');
makeSnapshot('20261006-080000-second');
makeSnapshot('20261006-070000-M0-基线');
makeSnapshot('20261006-060000-fourth');
makeSnapshot('20261006-050000-oldest');
makeSnapshot('20261006-040000-没有-meta', { withMeta: false }); // 不是快照

const ids = () => listSnapshots(P).map((s) => s.id);
const idsOf = (rows) => rows.map((r) => r.id);

// ── globToRe ──────────────────────────────────────────────────────────────
check('globToRe：* 匹配任意长度（含空）', () => {
  const re = globToRe('a*b');
  assert(re.test('ab') && re.test('aXb') && re.test('aXYZb'), 'a*b 应匹配 ab / aXb / aXYZb');
  assert(!re.test('a'), 'a*b 不应匹配 a');
});

check('globToRe：? 只匹配一个字符', () => {
  const re = globToRe('a?b');
  assert(re.test('aXb'), 'a?b 应匹配 aXb');
  assert(!re.test('ab') && !re.test('aXYb'), 'a?b 不应匹配 ab / aXYb');
});

check('globToRe：正则元字符按字面量处理', () => {
  assert(globToRe('a.b').test('a.b'), '点应匹配字面点');
  assert(!globToRe('a.b').test('aXb'), '点不应变成任意字符');
  assert(globToRe('a+b').test('a+b'), '加号应按字面量');
  assert(globToRe('*-M0-*').test('20261006-070000-M0-基线'), '*-M0-* 应匹配 M0 快照');
  assert(!globToRe('*-M0-*').test('20261006-090000-newest'), '*-M0-* 不应匹配别的');
});

check('globToRe：整串锚定，不做子串匹配', () => {
  assert(!globToRe('M0').test('20261006-M0-基线'), 'M0 不应命中更长 id');
});

// ── planPrune ─────────────────────────────────────────────────────────────
check('planPrune：keep 取最新 N 份', () => {
  const plan = planPrune({ keep: 2 }, P);
  eq(idsOf(plan.keep), ['20261006-090000-newest', '20261006-080000-second'], '保留的应是最新两份');
  eq(idsOf(plan.drop), [
    '20261006-070000-M0-基线',
    '20261006-060000-fourth',
    '20261006-050000-oldest',
    '20261006-040000-没有-meta',
  ], '其余全部进 drop');
  eq(plan.total, ids().length, 'total 应等于磁盘上的份数');
});

check('planPrune：keep-match 是加法，不是替换', () => {
  const plan = planPrune({ keep: 1, keepMatch: ['*-M0-*'] }, P);
  eq(idsOf(plan.keep), ['20261006-090000-newest', '20261006-070000-M0-基线'], '最新 1 份 + 匹配 M0 的那份');
  assert(!idsOf(plan.keep).includes('20261006-080000-second'), '第二新不该被保留');
});

check('planPrune：keep 为 0 时只留匹配项', () => {
  const plan = planPrune({ keep: 0, keepMatch: ['*-M0-*'] }, P);
  eq(idsOf(plan.keep), ['20261006-070000-M0-基线'], '只保留 M0');
});

check('planPrune：keep 大于总数时一份都不删', () => {
  const plan = planPrune({ keep: 999 }, P);
  eq(plan.drop, [], '不应有删除项');
  eq(plan.keep.length, plan.total, '全部保留');
});

check('planPrune：keep 与 drop 严格互补、无重叠', () => {
  const plan = planPrune({ keep: 2 }, P);
  const k = new Set(idsOf(plan.keep));
  for (const id of idsOf(plan.drop)) assert(!k.has(id), `${id} 同时出现在 keep 与 drop`);
  eq(plan.keep.length + plan.drop.length, plan.total, '两部分之和应等于总数');
});

check('planPrune：只读，不改磁盘', () => {
  const before = ids();
  planPrune({ keep: 1 }, P);
  eq(ids(), before, 'planPrune 之后目录内容应完全不变');
});

// ── deleteSnapshots 的拒绝路径 ────────────────────────────────────────────
check('deleteSnapshots：拒绝 `..` 与含分隔符的名字', () => {
  const res = deleteSnapshots(['..', '../..', 'a/b', 'a\\b', ''], P);
  eq(res.removed, [], '一个都不该删');
  eq(res.refused.length, 5, '五个都该被拒');
  assert(fs.existsSync(root), '快照根目录应完好');
});

check('deleteSnapshots：拒绝不存在的目录', () => {
  const res = deleteSnapshots(['20261006-000000-不存在'], P);
  eq(res.removed, [], '不该删任何东西');
  eq(res.refused.length, 1, '应被拒');
  assert(/不存在|不是快照/.test(res.refused[0].why), `拒绝理由应说明原因，实际：${res.refused[0].why}`);
});

check('deleteSnapshots：拒绝没有 meta.json 的目录（不能删随便什么目录）', () => {
  const res = deleteSnapshots(['20261006-040000-没有-meta'], P);
  eq(res.removed, [], '不该删');
  assert(fs.existsSync(path.join(root, '20261006-040000-没有-meta')), '该目录必须还在');
  eq(res.refused.length, 1, '应被拒');
});

// ── deleteSnapshots 的正常路径 ────────────────────────────────────────────
check('deleteSnapshots：删掉真正的快照目录，其余原地不动', () => {
  const keepBefore = ids().filter((id) => id !== '20261006-050000-oldest');
  const res = deleteSnapshots(['20261006-050000-oldest'], P);
  eq(res.removed.length, 1, '应删掉一份');
  eq(res.refused, [], '不该有拒绝');
  assert(!fs.existsSync(path.join(root, '20261006-050000-oldest')), '目标目录应消失');
  eq(ids(), keepBefore, '其余快照应完全不受影响');
});

check('planPrune 紧跟 deleteSnapshots：预演之后真删，删的正是预演那一批', () => {
  // 沙盒此刻剩 5 项（含没有 meta 的那份）
  const plan = planPrune({ keep: 1 }, P);
  const planned = idsOf(plan.drop).filter((id) => !id.endsWith('没有-meta'));
  const res = deleteSnapshots(planned, P);
  eq(res.removed.length, planned.length, '应把预演里可删的那批全删掉');
  eq(planPrune({ keep: 1 }, P).total, 2, '删完只剩 2 项（最新 + 那份没有 meta 的）');
  assert(
    ids().includes('20261006-040000-没有-meta'),
    '没有 meta.json 的目录必须还在 —— 它从没被当作可删对象',
  );
});

// ── 收尾 ─────────────────────────────────────────────────────────────────
try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* 临时目录，忽略 */ }

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? 'OK  ' : 'FAIL'}  ${r.name}${r.ok ? '' : `\n      ${r.why}`}`);
console.log(`\n快照保留策略单测${failed.length ? '未通过' : '通过'}：${results.length - failed.length}/${results.length} 项`);
process.exit(failed.length ? 1 : 0);
