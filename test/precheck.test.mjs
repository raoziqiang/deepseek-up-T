// deepseek-up-T :: `dsht precheck` 的判据与基线（src/precheck.mjs）的回归测试
//
// 为什么补这一套：`dsht precheck` 是**落盘之前唯一那道门** —— 它回答「改完
// cordis.patch.yml 到底会不会炸」。而它此前一条测试都没有，判据又是内联的
// （`ok = run.status === 0 && problems.length === 0`），于是三个洞谁也问不出来：
//
//   1. **什么都没 dump 出来也算通过。** stdout 为空、退出码 0、stderr 干净时，
//      旧判据给出「通过」——`dsht precheck` 会打印「结论：组合可用。」。
//      一个条目都没有的绿灯是假答案里最坏的一种（它连「我什么都没验到」都不说）。
//   2. **一次失败的预检会把上一条好基线冲掉。** `probe-dump.txt` 与 `.prev` 是
//      无条件覆写的，失败那一跑写出空文件之后，下一次预检拿空基线做对比，
//      报出「201 个条目全部新增」。诊断工具弄丢自己的参照点，比它不报错还糟。
//   3. **diff 的两处盲区**（真实 dump 上量出来的）：行差异按集合算，而真实 dump
//      201 个条目里有 7 个内部就有重复行（`preset-standard` / `preset-ptc` 各有三行
//      `config:`）——「三行变两行」会被报成「改了，但一行都列不出来」；
//      条目顺序变化则完全不算 diff，于是「两个插件对调」＝「完全一致」。
//
// 测法：前四层全是纯函数与显式路径上的文件操作，**不 boot Electron、不碰真实
// state/**；最后一层用源码结构断言钉住 CLI 的报错次序（真实预检要跑 300 秒的
// Electron dump，不可能进单测 —— 这一层没测到什么，会明说）。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  analyzeStderr, splitDumpEntries, diffDumps, judgeRun, settleDumpFiles,
} from '../src/precheck.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const STATE = path.join(ROOT, 'state');
const CLI_SRC = path.join(ROOT, 'src', 'cli.mjs');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'up-t-precheck-'));

const results = [];
function check(name, fn) {
  try { fn(); results.push({ name, ok: true }); } catch (e) { results.push({ name, ok: false, why: e.message }); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function eq(a, b, msg) {
  const ja = JSON.stringify(a); const jb = JSON.stringify(b);
  if (ja !== jb) throw new Error(`${msg ?? '不相等'}：${ja} !== ${jb}`);
}

// ── 合成 dump：形状取自真实 dump 的实测（顶层 `- id:` 在列 0、`# == <bundle>`
//    边界行、空行、嵌套列表里缩进的 `- id:`）────────────────────────────────
const DUMP_A = [
  '# == @deepseek-ai/dsh-base',
  '- id: alpha',
  '  name: a',
  '  config:',
  '    - id: nested-1',
  '      x: 1',
  '  config:',
  '',
  '# == my-bundle',
  '- id: beta',
  "  name: 'b'",
  '  approval: ask',
  '- id: gamma',
  '  approval: ask',
  '',
].join('\n');

// ── ① analyzeStderr ─────────────────────────────────────────────────────
check('①真实的一次成功预检，stderr 是 0 字节 —— 三类都不该有', () => {
  const errPath = path.join(STATE, 'probe-dump.txt.err');
  if (!fs.existsSync(errPath)) { console.log('      SKIP 没有 state/probe-dump.txt.err（还没跑过真实预检）'); return; }
  const size = fs.statSync(errPath).size;
  const r = analyzeStderr(fs.readFileSync(errPath, 'utf8'));
  eq({ p: r.problems.length, n: r.notes.length, o: r.other.length }, { p: 0, n: 0, o: 0 },
    `真实成功预检的 stderr 应当干干净净（实测 ${size} 字节）`);
});

check('①三类 stderr 各归各桶，按行匹配', () => {
  const text = [
    'dsh: warning: schema 层面宽松校验',
    'skipping profile bundle "dsh-something"',
    'patch: entry "dsh-up-t" not found',
    'dsh: error: 组合失败',
  ].join('\n');
  const r = analyzeStderr(text);
  eq(r.notes.length, 1, 'warning 进提醒');
  eq(r.problems.map((p) => p.kind), ['bundle-skip', 'patch-miss', 'error'], '三类问题各自的 kind');
  eq(r.problems.map((p) => p.text), [
    'skipping profile bundle "dsh-something"',
    'patch: entry "dsh-up-t" not found',
    'dsh: error: 组合失败',
  ], '问题文本逐字保留（不要改写原话）');
  eq(r.other.length, 0, '这四行都认得出来，不该掉进 other');
});

check('①认不出来的行进 other，不许被丢掉（原先直接丢）', () => {
  const r = analyzeStderr('Warning: something from node\n一个完全不认识的输出行\n');
  eq(r.problems.length, 0, '认不出来不等于有问题');
  eq(r.notes.length, 0, '也不等于提醒');
  eq(r.other, ['Warning: something from node', '一个完全不认识的输出行'], 'other 要逐行留下');
});

check('①空行与纯空白行不算任何一桶', () => {
  const r = analyzeStderr('\n   \n\t\n');
  eq({ p: r.problems.length, n: r.notes.length, o: r.other.length }, { p: 0, n: 0, o: 0 }, '空行一律跳过');
});

// ── ② splitDumpEntries ─────────────────────────────────────────────────
check('②只认列 0 的 `- id:`：嵌套列表里的 id 不算顶层条目', () => {
  const s = splitDumpEntries(DUMP_A);
  eq(s.order, ['alpha', 'beta', 'gamma'], '顶层条目三个');
  assert(s.map.get('alpha').includes('    - id: nested-1'), '嵌套的 id 行应当留在 alpha 的正文里');
  assert(!s.order.includes('nested-1'), 'nested-1 不是顶层条目');
});

check('②`# == ` 边界行与空行不进条目正文（它们含探针家的绝对路径，会把 diff 弄脏）', () => {
  const s = splitDumpEntries(DUMP_A);
  assert(!s.map.get('alpha').includes('# == '), 'alpha 正文里不该有边界行');
  eq(s.map.get('alpha').includes('\n\n'), false, '空行在补进正文之前就被过滤掉了');
  eq(s.map.get('beta'), "- id: beta\n  name: 'b'\n  approval: ask", 'beta 的正文逐字');
});

check('②id 两侧的引号被剥掉；同一 id 重复时 order 记两次而 map 只留最后一份', () => {
  const s = splitDumpEntries("- id: 'quoted'\n  x: 1\n- id: dup\n  a: 1\n- id: dup\n  a: 2\n");
  eq(s.order, ['quoted', 'dup', 'dup'], 'order 按出现顺序记（含重复）');
  eq(s.map.get('quoted'), "- id: 'quoted'\n  x: 1", '引号不剥掉正文里的写法，只剥 id');
  eq(s.map.get('dup'), '- id: dup\n  a: 2', 'map 是最后一份胜出');
  eq(s.map.size === s.order.length, false, '重复 id 时两者长度会不同（实测真实 dump 里是相等的）');
});

check('②真实 dump：201 个顶层条目、id 唯一、顺序与 .prev 一致', () => {
  const curPath = path.join(STATE, 'probe-dump.txt');
  const prevPath = `${curPath}.prev`;
  if (!fs.existsSync(curPath) || !fs.existsSync(prevPath)) {
    console.log('      SKIP 没有 state/probe-dump.txt(.prev)');
    return;
  }
  const cur = splitDumpEntries(fs.readFileSync(curPath, 'utf8'));
  const prev = splitDumpEntries(fs.readFileSync(prevPath, 'utf8'));
  console.log(`      实测：cur ${cur.order.length} 条 / prev ${prev.order.length} 条`);
  eq(cur.map.size, cur.order.length, 'id 必须唯一（否则 added/removed 会重复计数）');
  eq(cur.order.length > 100, true, `真实组合应当有上百个条目，实测 ${cur.order.length}`);
  eq(prev.order.join('\n'), cur.order.join('\n'), '这两份的条目顺序实测相同');
});

// ── ③ diffDumps ────────────────────────────────────────────────────────
check('③新增 / 移除 / 修改三类都能认出来，修改带行级 +/-', () => {
  const after = DUMP_A
    .replace('- id: beta\n', '- id: beta-renamed\n')
    .replace('  name: a', '  name: a2');
  const d = diffDumps(DUMP_A, after);
  eq(d.added, ['beta-renamed'], '新条目');
  eq(d.removed, ['beta'], '被移除的条目');
  eq(d.changed.map((c) => c.id), ['alpha'], 'alpha 的 name 变了');
  eq(d.changed[0].removed, ['  name: a'], '少了的行');
  eq(d.changed[0].added, ['  name: a2'], '多了的行');
  eq(d.count, 3, 'count = 1 新增 + 1 移除 + 1 修改');
});

check('③重复行按出现次数算：「三行 config:」变「两行」必须报出少了那一行', () => {
  const before = '- id: preset-standard\n  name: x\n  config:\n  config:\n  config:';
  const after = '- id: preset-standard\n  name: x\n  config:\n  config:';
  const d = diffDumps(before, after);
  eq(d.changed.length, 1, '应当报成一个修改');
  eq(d.changed[0].removed, ['  config:'], '★ 少掉的那一行必须列出来（按集合算时这里是空数组）');
  eq(d.changed[0].added, [], '没有多出来的行');
  eq(d.count, 1, '算一处修改');
});

check('③条目顺序变了要报出来（顺序就是装载顺序，配置一字未变也算变）', () => {
  const a = '- id: a\n  x: 1\n- id: b\n  x: 2';
  const b = '- id: b\n  x: 2\n- id: a\n  x: 1';
  const d = diffDumps(a, b);
  eq(d.added, [], '没有新增');
  eq(d.removed, [], '没有移除');
  eq(d.changed, [], '没有条目内容变化');
  eq(d.reordered, true, '★ 顺序变化必须被标记（旧版这里是 count === 0，报「完全一致」）');
  eq(d.reorderedIds, ['a', 'b'], '对调时**两个**位置都变了（我第一版只写了 ["a"]，是算错的）');
  eq(d.count > 0, true, 'count 不为 0，CLI 才不会打印「完全一致」');
});

check('③改顺序的判定不误报：单纯增删条目不算顺序变化', () => {
  const a = '- id: a\n  x: 1\n- id: b\n  x: 2\n- id: c\n  x: 3';
  const b = '- id: a\n  x: 1\n- id: c\n  x: 3';
  const d = diffDumps(a, b);
  eq(d.removed, ['b'], '移除的是 b');
  eq(d.reordered, false, '剩下的 a / c 相对顺序没变，不该报顺序变化');
  eq(d.reorderedIds, [], '没有位置变了的公共条目');
});

check('③完全一致时三样都空、reordered 为假', () => {
  const d = diffDumps(DUMP_A, DUMP_A);
  eq({ added: d.added, removed: d.removed, changed: d.changed, reordered: d.reordered, count: d.count },
    { added: [], removed: [], changed: [], reordered: false, count: 0 }, '一字未改');
});

check('③真实基线对账：两次读取的差异可逆，不假定现场永远停在某次改动', () => {
  const curPath = path.join(STATE, 'probe-dump.txt');
  const prevPath = `${curPath}.prev`;
  if (!fs.existsSync(curPath) || !fs.existsSync(prevPath)) { console.log('      SKIP 没有真实基线'); return; }
  const d = diffDumps(fs.readFileSync(prevPath, 'utf8'), fs.readFileSync(curPath, 'utf8'));
  const reverse = diffDumps(fs.readFileSync(curPath, 'utf8'), fs.readFileSync(prevPath, 'utf8'));
  console.log(`      实测：added ${d.added.length} / removed ${d.removed.length} / changed ${JSON.stringify(d.changed.map((c) => c.id))} / reordered ${d.reordered}`);
  eq([...d.added].sort(), [...reverse.removed].sort(), '正向新增应等于反向移除');
  eq([...d.removed].sort(), [...reverse.added].sort(), '正向移除应等于反向新增');
  eq(d.changed.map((c) => c.id).sort(), reverse.changed.map((c) => c.id).sort(), '修改条目两向相同');
  eq(d.reordered, reverse.reordered, '顺序变化两向相同');
  assert(d.changed.every((c) => c.removed.length + c.added.length > 0), '改动的正文不能是空的');
});

// ── ④ judgeRun：一次跑完之后到底算不算通过 ─────────────────────────────
check('④★空 stdout + 退出码 0 + stderr 干净 ⇒ 不许通过（旧判据在这里说「可用」）', () => {
  const j = judgeRun({ status: 0, stdout: '', problems: [] });
  eq(j.ok, false, '★ 什么都没 dump 出来不能算通过');
  eq(j.entries, 0, '条目数 0');
  eq(j.emptyDump, true, '标记为空 dump');
  assert(/一个顶层条目都没有/.test(j.emptyDumpText), '说明必须点出「一个条目都没有」');
  assert(/0 字节/.test(j.emptyDumpText), `说明里带上 stdout 字节数，便于区分「空」与「只有噪声」：${j.emptyDumpText}`);
});

check('④只有一行 warning、没有任何条目 ⇒ 也不通过', () => {
  const { problems, notes, other } = analyzeStderr('dsh: warning: 宽松校验\n');
  const j = judgeRun({ status: 0, stdout: '', problems, mode: 'dump-default-config' });
  eq({ p: problems.length, n: notes.length, o: other.length }, { p: 0, n: 1, o: 0 }, '这一行只是提醒');
  eq(j.ok, false, '★ 提醒不算问题，但没有条目仍然不能通过');
  assert(/dump-default-config/.test(j.emptyDumpText), '说明里要点出模式');
});

check('④有条目、退出码 0、没有真问题 ⇒ 通过', () => {
  const j = judgeRun({ status: 0, stdout: DUMP_A, problems: [] });
  eq(j.ok, true, '三件事都成立');
  eq(j.entries, 3, '条目数要跟 splitDumpEntries 对得上');
  eq(j.emptyDump, false, '不是空 dump');
  eq(j.emptyDumpText, null, '通过时不给空 dump 说明');
});

check('④有条目、退出码 0，但 stderr 里有真问题 ⇒ 不通过', () => {
  const { problems } = analyzeStderr('patch: entry "dsh-up-t" not found\n');
  const j = judgeRun({ status: 0, stdout: DUMP_A, problems });
  eq(j.ok, false, '真问题优先于「有条目」');
  eq(j.entries, 3, '条目数照算');
});

check('④退出码非 0 ⇒ 不通过（即使 dump 有内容、stderr 干净）', () => {
  eq(judgeRun({ status: 1, stdout: DUMP_A, problems: [] }).ok, false, '退出码 1');
  eq(judgeRun({ status: null, stdout: DUMP_A, problems: [] }).ok, false, '退出码 null（超时/被信号杀掉）');
});

// ── ⑤ settleDumpFiles：基线不许被一次失败的跑冲掉 ─────────────────────
function tmpDump(name) {
  const p = path.join(sandbox, name, 'probe-dump.txt');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  return p;
}

check('⑤可用的一跑：dumpPath 换成新的、.prev 存旧的、before 交回给 diff', () => {
  const p = tmpDump('ok');
  fs.writeFileSync(p, 'OLD', 'utf8');
  const r = settleDumpFiles({ dumpPath: p, stdout: 'NEW', usable: true });
  eq(r.saved, true, '存下来了');
  eq(r.before, 'OLD', 'before 是上一份（diff 要用）');
  eq(fs.readFileSync(p, 'utf8'), 'NEW', 'dumpPath 是本次结果');
  eq(fs.readFileSync(`${p}.prev`, 'utf8'), 'OLD', '.prev 是上一份');
  eq(r.keptBaseline, false, '不是「保留旧基线」那种情形');
});

check('⑤★不可用的一跑：dumpPath 与 .prev 一字未动，原始输出另存 .failed', () => {
  const p = tmpDump('fail');
  fs.writeFileSync(p, 'GOOD-BASELINE', 'utf8');
  fs.writeFileSync(`${p}.prev`, 'EVEN-OLDER', 'utf8');
  const r = settleDumpFiles({ dumpPath: p, stdout: 'dsh: error: 崩了', usable: false });
  eq(r.saved, false, '没有保存');
  eq(r.before, null, '没有可比对的基线（本次没产出可用结果）');
  eq(r.keptBaseline, true, '旧基线还在');
  eq(fs.readFileSync(p, 'utf8'), 'GOOD-BASELINE', '★ 上一条好基线必须原样保留');
  eq(fs.readFileSync(`${p}.prev`, 'utf8'), 'EVEN-OLDER', '★ .prev 也不许动（它是上一次的对比物）');
  eq(fs.readFileSync(`${p}.failed`, 'utf8'), 'dsh: error: 崩了', '本次原始输出写到 .failed');
});

check('⑤不可用且本来就没有基线：不许造出一个空的 dumpPath', () => {
  const p = tmpDump('nobaseline');
  const r = settleDumpFiles({ dumpPath: p, stdout: '', usable: false });
  eq(r.saved, false, '没保存');
  eq(r.keptBaseline, false, '本来就没有基线可保');
  eq(fs.existsSync(p), false, '★ 不许创建空基线（下次会被当成「上一次的结果」）');
  eq(fs.existsSync(`${p}.prev`), false, '也不许创建 .prev');
  eq(fs.readFileSync(`${p}.failed`, 'utf8'), '', '.failed 照写（哪怕空）');
});

check('⑤首次预检成功：没有 before，也不该创建 .prev', () => {
  const p = tmpDump('first');
  const r = settleDumpFiles({ dumpPath: p, stdout: 'FIRST', usable: true });
  eq({ saved: r.saved, before: r.before }, { saved: true, before: null }, '首次没有可比对的 before');
  eq(fs.readFileSync(p, 'utf8'), 'FIRST', '基线就是本次结果');
  eq(fs.existsSync(`${p}.prev`), false, '首次不该凭空造 .prev');
});

check('⑤跑成功时顺手清掉上一次的 .failed 残留（否则会让人以为这次也没成）', () => {
  const p = tmpDump('cleanup');
  fs.writeFileSync(p, 'OLD', 'utf8');
  fs.writeFileSync(`${p}.failed`, '上次崩的输出', 'utf8');
  settleDumpFiles({ dumpPath: p, stdout: 'NEW', usable: true });
  eq(fs.existsSync(`${p}.failed`), false, '残留被清掉');
});

// ── ⑥ CLI 层的报错次序（真实预检要跑 300 秒的 Electron dump，这一层只能查源码结构；
//    它证明「措辞与次序」写对了，**不证明** CLI 真的跑通了 —— 那要人跑一次 real precheck）──
check('⑥CLI：`!r.saved` 的分支排在 `r.diff === null` 之前（否则会把「没产出」说成「首次预检」）', () => {
  const src = fs.readFileSync(CLI_SRC, 'utf8');
  const i = src.indexOf('if (!r.saved) {');
  const j = src.indexOf('} else if (r.diff === null) {');
  assert(i > 0, '没找到 !r.saved 分支');
  assert(j > i, `!r.saved 必须排在 r.diff === null 之前，实际 i=${i} j=${j}`);
});

check('⑥CLI：JSON 输出里带上 entries / saved / failedPath（脚本化调用者也要能看到「没验到东西」）', () => {
  const src = fs.readFileSync(CLI_SRC, 'utf8');
  for (const key of ['entries: r.entries', 'saved: r.saved', 'failedPath: r.failedPath', 'other: r.other']) {
    assert(src.includes(key), `JSON 里应当有 ${key}`);
  }
});

check('⑥CLI：基线未动时，末行不能再说 dumpPath 就是本次结果', () => {
  const src = fs.readFileSync(CLI_SRC, 'utf8');
  assert(src.includes('基线未动，仍是'), '要有明确的「基线未动」措辞');
});

// ── 收尾 ───────────────────────────────────────────────────────────────
try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch { /* 临时目录，忽略 */ }

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? 'OK  ' : 'FAIL'}  ${r.name}${r.ok ? '' : `\n      ${r.why}`}`);
console.log(`\nprecheck 判据与基线单测${failed.length ? '未通过' : '通过'}：${results.length - failed.length}/${results.length} 项`);
process.exit(failed.length ? 1 : 0);
