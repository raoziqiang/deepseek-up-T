// deepseek-up-T :: src/asar.mjs + `dsht asar ls|cat|grep` 的回归测试
//
// 为什么补这一套：`src/asar.mjs` 是本项目读「**真正在跑的那份代码**」的唯一方式 ——
// asar 内的包、`profiles/node_modules/@deepseek-ai/*`（junction 到本地构建树）、源码仓库
// 三者可能是不同版本，只有 asar 里那份是运行中的 Electron 应用真正加载的。
// 而这里已经出过一次**静默错答**：`listAsarPaths()` 原本返回带前导斜杠的 `/lib/main.js`，
// 于是「按声明查归档里有没有」全部落空（10 个条目全报「归档里找不到」，而它们其实都在）。
// 一个只在被读的时候说错话的工具，比不存在的工具更危险：它会把人引去修不存在的问题。
//
// 三层：
//   ① 纯函数（`readAsarHeader` / `walkAsar` / `listAsarPaths` / `findAsarNode` /
//      `asarDataStart` / `readAsarEntry` / `grepAsarContent` / `asarStats` / `asarPackageIndex`）
//      打在**本文件自己造的**几 KB 合成归档上（独立序列化，两边对不上就会失败）；
//   ② CLI（`node src/cli.mjs asar … --file <合成归档>`）的退出码与输出；
//   ③ 真实归档只读抽查：路径形状、`package.json` 可解析、目录/不存在的条目都要明确报错。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  readAsarHeader, walkAsar, listAsarPaths, findAsarNode, asarDataStart,
  readAsarEntry, grepAsarContent, asarStats, asarPackageIndex,
} from '../src/asar.mjs';
import { P } from '../vendor/lib/harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const CLI = path.join(ROOT, 'src', 'cli.mjs');

const results = [];
function check(name, fn) {
  try { fn(); results.push({ name, ok: true }); } catch (e) { results.push({ name, ok: false, why: e.message }); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function eq(a, b, msg) {
  const ja = JSON.stringify(a); const jb = JSON.stringify(b);
  if (ja !== jb) throw new Error(`${msg ?? '不相等'}：${ja} !== ${jb}`);
}
const run = (args, env) => spawnSync(process.execPath, [CLI, ...args], {
  encoding: 'utf8', windowsHide: true, env: env ?? process.env,
});

// ── 独立造归档（与 src/asar.mjs 的读法互证）────────────────────────────────
// 头布局：u32@0=4 / u32@4=8+jsonLen / u32@8=jsonLen+4 / u32@12=jsonLen，json@16，data@16+jsonLen。
function buildArchive(entries) {
  const root = { files: {} };
  const chunks = [];
  let cursor = 0;
  const align = (n) => (n % 4 === 0 ? n : n + (4 - (n % 4)));
  const put = (entry) => {
    const parts = entry.path.split('/');
    let node = root;
    for (const part of parts.slice(0, -1)) { node.files[part] ??= { files: {} }; node = node.files[part]; }
    return [node, parts.at(-1)];
  };
  // 目录型条目（asar 里目录节点只有 files）与叶子分开处理
  for (const e of [...entries].sort((a, b) => a.path.localeCompare(b.path))) {
    const [parent, leaf] = put(e);
    if (e.unpacked === true) {
      const bytes = Buffer.from(e.data ?? '', 'utf8');
      parent.files[leaf] = { size: bytes.length, unpacked: true };
      if (e.unpackedTarget) {
        fs.mkdirSync(path.dirname(e.unpackedTarget), { recursive: true });
        fs.writeFileSync(e.unpackedTarget, bytes);
      }
      continue;
    }
    const buf = Buffer.from(e.data ?? '', 'utf8');
    parent.files[leaf] = { size: buf.length, offset: String(cursor) };
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

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'up-t-asarcli-'));
const FIX = path.join(sandbox, 'fix.asar');
const UNPACKED_DIR = `${FIX}.unpacked`;
const BIG_TEXT = `${'x'.repeat(4000)}\nNEEDLE-IN-BIG\n`;
fs.writeFileSync(FIX, buildArchive([
  { path: 'lib/main.js', data: 'const a = 1;\nconst NEEDLE = "here";\nmodule.exports = a;\n' },
  { path: 'lib/welcome/whale-animation.js', data: 'function drawWhale() {}\n' },
  { path: 'renderer/index.html', data: '<html><body>NEEDLE</body></html>\n' },
  { path: 'renderer/logo.png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]).toString('binary') },
  { path: 'dsh/node_modules/@deepseek-ai/dsh/package.json', data: '{ "name": "@deepseek-ai/dsh", "version": "44.0.0" }\n' },
  { path: 'node_modules/ws/package.json', data: '{ "name": "ws", "version": "8.0.0" }\n' },
  { path: 'lib/big.txt', data: BIG_TEXT },
  { path: 'lib/blob.bin', data: 'NEEDLE-but-not-a-text-extension\n' },
  { path: 'lib/unpacked-native.node', data: 'NEEDLE-inside-unpacked\n', unpacked: true, unpackedTarget: path.join(UNPACKED_DIR, 'lib/unpacked-native.node') },
]));
const header = readAsarHeader(FIX).header;

// ── ① 纯函数 ──────────────────────────────────────────────────────────────
check('readAsarHeader：pickleSize === jsonLen + 8，jsonLen 与数据区起点自洽', () => {
  const h = readAsarHeader(FIX);
  eq(h.pickleSize, h.jsonLen + 8, 'pickleSize 关系');
  eq(asarDataStart(h.pickleSize), 16 + h.jsonLen, '数据区起点 = 16 + jsonLen');
  assert(h.header.files.lib, 'header 必须从根节点起算（header.files.lib 就在顶层）');
});

check('readAsarHeader：头部被截断 / 布局不符 → 明确报错，不是静默乱读', () => {
  const short = path.join(sandbox, 'short.asar');
  fs.writeFileSync(short, Buffer.alloc(8));
  let msg = '';
  try { readAsarHeader(short); } catch (e) { msg = e.message; }
  assert(/不足 16 字节/.test(msg), `截断文件应报「不足 16 字节」，实际：${msg}`);

  const bogus = path.join(sandbox, 'bogus.asar');
  const buf = fs.readFileSync(FIX).subarray(0, 64);
  const bad = Buffer.from(buf);
  bad.writeUInt32LE(999, 4);           // 破坏 pickleSize
  fs.writeFileSync(bogus, bad);
  msg = '';
  try { readAsarHeader(bogus); } catch (e) { msg = e.message; }
  assert(/布局与预期不符/.test(msg), `布局不符应报错，实际：${msg}`);
});

check('walkAsar：顶层叶子一个不少（游标从 header 起步，而不是 header.files）', () => {
  const leaves = [...walkAsar(header)].map((e) => e.path).sort();
  // 9 个条目里 8 个是叶子（lib/big.txt 等），目录不产出
  eq(leaves.length, 9, `叶子数：${JSON.stringify(leaves)}`);
  assert(leaves.includes('/package.json') === false, '合成归档里没有根的 package.json');
  assert(leaves.includes('/lib/main.js'), 'lib/main.js 要在');
  assert(leaves.includes('/dsh/node_modules/@deepseek-ai/dsh/package.json'), '深层嵌套也要在');
  const single = { files: { 'only.js': { size: 1, offset: '0' } } };
  eq([...walkAsar(single)].map((e) => e.path), ['/only.js'], '只有 1 个叶子时也必须吐出来（曾经的 bug 是吐 0 个）');
});

check('listAsarPaths：**无前导斜杠**、按字典序（`--limit` 截出来的才是稳定的一段）', () => {
  const paths = listAsarPaths(header);
  eq(paths.length, 9, '叶子数');
  eq(paths, [...paths].sort(), '必须是排好序的（DFS 顺序会随归档内容变）');
  assert(paths.every((p) => !p.startsWith('/')), `不该有前导斜杠：${paths.filter((p) => p.startsWith('/'))}`);
  assert(paths.includes('lib/main.js'), '声明里写的就是 lib/main.js 这种形状');
  // 这一条正是当年那次静默错答的形状：拿声明里的键去 pathSet 里查，必须命中
  const set = new Set(paths);
  assert(set.has('renderer/whale-splash.js') === false, '合成归档里没有这个条目');
  assert(set.has('renderer/index.html') && set.has('lib/welcome/whale-animation.js'), '两个真实形状的键都要命中');
});

check('findAsarNode：带不带前导斜杠都能定位；目录返回 files；找不到返回 null', () => {
  assert(findAsarNode(header, 'lib/main.js').size > 0, '不带斜杠');
  assert(findAsarNode(header, '/lib/main.js').size > 0, '带斜杠');
  assert(findAsarNode(header, 'lib').files, '目录节点返回 { files }');
  eq(findAsarNode(header, 'lib/nope.js'), null, '不存在的叶子');
  eq(findAsarNode(header, 'nope/main.js'), null, '不存在的目录');
  eq(findAsarNode(header, ''), header, '空路径是根节点');
});

check('readAsarEntry：字节逐字相同；目录/不存在返回 null；unpacked 回落到 <归档>.unpacked/', () => {
  eq(readAsarEntry(FIX, 'lib/main.js').toString('utf8'), 'const a = 1;\nconst NEEDLE = "here";\nmodule.exports = a;\n', '叶子内容');
  eq(readAsarEntry(FIX, 'lib'), null, '目录不是条目');
  eq(readAsarEntry(FIX, 'lib/nope.js'), null, '不存在');
  // unpacked：内容在 <归档>.unpacked/ 下，数据区里没有它的字节
  const native = readAsarEntry(FIX, 'lib/unpacked-native.node');
  assert(native && native.toString('utf8') === 'NEEDLE-inside-unpacked\n', `unpacked 条目要回落读文件，实际：${native}`);
  assert(native.length === Buffer.byteLength('NEEDLE-inside-unpacked\n'), 'unpacked 的 size 来自头部');
  // 回落目标不存在 → null（而不是抛错或给空 buffer）
  const gone = path.join(sandbox, 'gone.asar');
  fs.writeFileSync(gone, buildArchive([{ path: 'lib/x.node', data: '', unpacked: true }]));
  eq(readAsarEntry(gone, 'lib/x.node'), null, 'unpacked 文件缺失时返回 null');
});

check('grepAsarContent：命中行号与文本正确，只扫文本后缀，路径无前导斜杠', () => {
  const hits = grepAsarContent(FIX, /NEEDLE/);
  const byPath = new Map(hits.map((h) => [h.path, h]));
  assert(byPath.has('lib/main.js'), `lib/main.js 应当命中（路径不该带前导斜杠）：${JSON.stringify(hits.map((h) => h.path))}`);
  eq(byPath.get('lib/main.js').line, 2, 'NEEDLE 在第 2 行');
  eq(byPath.get('lib/main.js').text, 'const NEEDLE = "here";', '命中行文本');
  assert(byPath.has('renderer/index.html'), '.html 是文本后缀');
  assert(byPath.has('lib/big.txt'), '.txt 是文本后缀');
  assert(!byPath.has('lib/blob.bin'), '.bin 内容里有 NEEDLE 也不该扫（结构粗筛只看文本后缀）');
  assert(!byPath.has('lib/unpacked-native.node'), 'unpacked 条目不在数据区里，不该被扫');
  assert(hits.every((h) => !h.path.startsWith('/')), 'grep 出来的路径要能直接复制去 asar cat');
  eq(hits.length, 3, `命中条数（main.js / index.html / big.txt）：${JSON.stringify(hits)}`);
});

check('grepAsarContent：带 g 标志的正则不退化成「第一次命中、第二次不命中」', () => {
  const plain = grepAsarContent(FIX, /NEEDLE/);
  const global = grepAsarContent(FIX, /NEEDLE/g);
  eq(global.map((h) => `${h.path}:${h.line}`), plain.map((h) => `${h.path}:${h.line}`), 'g 标志不该改变结果（lastIndex 有状态）');
});

check('grepAsarContent：limit 是硬上限；maxBytes 跳过超大条目；无命中返回空数组', () => {
  const one = grepAsarContent(FIX, /NEEDLE/, { limit: 1 });
  eq(one.length, 1, 'limit=1 时只能有一条');
  const small = grepAsarContent(FIX, /NEEDLE-IN-BIG/, { maxBytes: 100 });
  eq(small, [], '超过 maxBytes 的条目整条跳过（哪怕里面有命中）');
  const all = grepAsarContent(FIX, /NEEDLE-IN-BIG/, { maxBytes: 1024 * 1024 });
  eq(all.map((h) => h.path), ['lib/big.txt'], '放宽 maxBytes 后能命中');
  eq(all[0].line, 2, '超大文本里的行号也要对');
  eq(grepAsarContent(FIX, /根本没有这个字符串/), [], '无命中是空数组，不是 null');
});

check('walkAsar / asarStats：拿到 readAsarHeader 的整个返回值时必须报错，不能静默吐 0 个', () => {
  const wrapper = readAsarHeader(FIX);           // { header, jsonLen, pickleSize }
  let msg = '';
  try { [...walkAsar(wrapper)]; } catch (e) { msg = e.message; }
  assert(/\.header/.test(msg), `报错要点出 .header，实际：${msg}`);
  assert(/walkAsar/.test(msg), `报错要说是哪个函数，实际：${msg}`);
  msg = '';
  try { asarStats(wrapper); } catch (e) { msg = e.message; }
  assert(/asarStats/.test(msg) && /\.header/.test(msg), `asarStats 也要报错，实际：${msg}`);
  // 空归档（根目录没有子节点）是合法的空结果，不该被当成参数错误
  eq([...walkAsar({ files: {} })], [], '空归档是空列表');
  eq(asarStats({ files: {} }), { files: 0, dirs: 0 }, '空归档计数为 0');
});

check('asarStats：根节点不算目录；asarPackageIndex 认 node_modules 下的包（含 @scope）', () => {
  const st = asarStats(header);
  eq(st.files, 9, '文件数');
  // 目录节点：lib、lib/welcome、renderer、dsh、dsh/node_modules、dsh/node_modules/@deepseek-ai、
  // dsh/node_modules/@deepseek-ai/dsh、node_modules、node_modules/ws —— 根不算
  eq(st.dirs, 9, `目录数：${JSON.stringify(st)}`);
  // 独立递归数一遍目录节点，两边对不上就说明统计逻辑有问题（不靠硬编码数字）
  const countDirs = (node) => 1 + Object.values(node.files ?? {})
    .filter((v) => v.files).reduce((n, v) => n + countDirs(v), 0);
  eq(st.dirs, countDirs(header) - 1, '目录数要与独立递归计数一致（根不算目录）');
  const idx = asarPackageIndex(header);
  eq(idx.get('@deepseek-ai/dsh'), 'dsh/node_modules/@deepseek-ai/dsh/package.json', '带 scope 的包名，路径无前导斜杠');
  eq(idx.get('ws'), 'node_modules/ws/package.json', '根 node_modules 下的包也要索引到');
  eq(idx.size, 2, '只有两个 package.json');
  assert([...idx.values()].every((p) => !p.startsWith('/')), '索引里的路径也要无前导斜杠（doctor 用它数 dsh 插件）');
});

// ── ② CLI ────────────────────────────────────────────────────────────────
check('CLI asar ls（无正则）：按目录汇总，--json 可解析且 total 等于叶子数', () => {
  const r = run(['asar', 'ls', '--file', FIX]);
  eq(r.status, 0, `应退出 0，stderr=${r.stderr}`);
  assert(/条目 9/.test(r.stdout), `要报条目总数，实际：${r.stdout}`);
  assert(/asar ls <正则>/.test(r.stdout), '要提示下一步怎么精确列');

  const j = run(['asar', 'ls', '--file', FIX, '--json']);
  eq(j.status, 0, `应退出 0，stderr=${j.stderr}`);
  const parsed = JSON.parse(j.stdout);
  eq(parsed.total, 9, 'total');
  eq(parsed.archive, FIX, '要说清读的是哪一份归档');
  // 分桶键是「路径前两段」：lib/main.js、lib/welcome、dsh/node_modules…
  eq(Object.keys(parsed.buckets).length, 9, `每一条路径各成一桶：${JSON.stringify(parsed.buckets)}`);
  eq(parsed.buckets['lib/main.js'], 1, '键是前两段路径');
  eq(parsed.buckets['dsh/node_modules'], 1, '深层路径也只取两段');
});

check('CLI asar ls <正则>：列出的是无前导斜杠的路径，并报「匹配 N / 总数」', () => {
  const r = run(['asar', 'ls', '^lib/', '--file', FIX]);
  eq(r.status, 0, `应退出 0，stderr=${r.stderr}`);
  assert(/\nlib\/main\.js\n/.test(r.stdout), `路径不能带前导斜杠，实际：${r.stdout}`);
  assert(!/^\/lib\/main\.js$/m.test(r.stdout), '不该有带前导斜杠的行');
  // lib/ 下：main.js、welcome/whale-animation.js、big.txt、blob.bin、unpacked-native.node
  assert(/匹配 5 \/ 9/.test(r.stdout), `应报匹配数，实际：${r.stdout}`);

  const j = JSON.parse(run(['asar', 'ls', 'package\\.json$', '--file', FIX, '--json']).stdout);
  eq(j.matched, 2, '两个 package.json');
  eq(j.paths, ['dsh/node_modules/@deepseek-ai/dsh/package.json', 'node_modules/ws/package.json'], '路径形状');
});

check('CLI asar cat：--out 落盘逐字节相同；不存在的条目与目录都明确报错（退出码 2）', () => {
  const out = path.join(sandbox, 'cat-out.js');
  const r = run(['asar', 'cat', 'lib/main.js', '--out', out, '--file', FIX]);
  eq(r.status, 0, `应退出 0，stderr=${r.stderr}`);
  eq(fs.readFileSync(out, 'utf8'), readAsarEntry(FIX, 'lib/main.js').toString('utf8'), '写出的字节');
  eq(fs.readFileSync(out).length, readAsarEntry(FIX, 'lib/main.js').length, '字节数');

  const miss = run(['asar', 'cat', 'lib/nope.js', '--file', FIX]);
  eq(miss.status, 2, '不存在的条目退出 2');
  assert(/归档内没有该条目（或它是目录）/.test(miss.stderr), `实际：${miss.stderr}`);

  const dir = run(['asar', 'cat', 'lib', '--file', FIX]);
  eq(dir.status, 2, '目录也退出 2');

  const noArg = run(['asar', 'cat', '--file', FIX]);
  eq(noArg.status, 2, '缺参数退出 2');
  assert(/用法：asar cat/.test(noArg.stderr), `实际：${noArg.stderr}`);
});

check('CLI asar grep：命中给 path:line；无命中退出 1；--json 可解析', () => {
  const r = run(['asar', 'grep', 'NEEDLE', '--file', FIX]);
  eq(r.status, 0, `应退出 0，stderr=${r.stderr}`);
  assert(/^lib\/main\.js:2$/m.test(r.stdout), `要打 path:line 且路径无前导斜杠，实际：${r.stdout}`);
  assert(!/^\/lib\//m.test(r.stdout), 'grep 的输出也不该带前导斜杠');
  assert(/命中 3 处/.test(r.stdout), `命中数：${r.stdout}`);

  const none = run(['asar', 'grep', '根本没有这个字符串', '--file', FIX]);
  eq(none.status, 1, '无命中退出 1（与「命令失败」区分开）');
  assert(/未命中/.test(none.stdout), `实际：${none.stdout}`);

  const j = run(['asar', 'grep', 'NEEDLE', '--limit', '2', '--json', '--file', FIX]);
  const parsed = JSON.parse(j.stdout);
  eq(parsed.length, 2, '--limit 2 只回两条');
  assert(parsed.every((h) => h.path && h.line >= 1 && typeof h.text === 'string'), `每条要有 path/line/text：${JSON.stringify(parsed)}`);
  // 命中顺序是扫描顺序（DFS），不保证按路径排；要按 path 找那一条来核对行号
  const main = grepAsarContent(FIX, /NEEDLE/).find((h) => h.path === 'lib/main.js');
  assert(main, 'lib/main.js 要在命中里');
  eq(main.line, 2, 'lib/main.js 里 NEEDLE 在第 2 行');
  eq(main.text, 'const NEEDLE = "here";', 'trim 过的命中行');
});

check('CLI：非法正则、未知子命令、归档不存在 —— 三种都退出 2 且说清原因', () => {
  const bad = run(['asar', 'ls', '[', '--file', FIX]);
  eq(bad.status, 2, '非法正则退出 2');
  assert(/正则非法/.test(bad.stderr), `实际：${bad.stderr}`);

  const unk = run(['asar', 'wat', '--file', FIX]);
  eq(unk.status, 2, '未知子命令退出 2');
  assert(/未知子命令：asar wat/.test(unk.stderr), `实际：${unk.stderr}`);
  assert(/可用：asar ls/.test(unk.stderr), '要列出可用子命令');

  const noFile = run(['asar', 'ls', '--file', path.join(sandbox, '没有这个.asar')]);
  eq(noFile.status, 2, '归档不存在退出 2');
  assert(/找不到归档：/.test(noFile.stderr), `实际：${noFile.stderr}`);
});

// ── ③ 真实归档只读抽查 ───────────────────────────────────────────────────
check('真实 app.asar：11,000+ 个条目全部无前导斜杠，且 package.json 可解析', () => {
  if (!fs.existsSync(P.asar)) { console.log('      SKIP 在用安装包不存在'); return; }
  const h = readAsarHeader(P.asar);
  const paths = listAsarPaths(h.header);        // 注意是 .header：传整个返回值现在会报错
  console.log(`      （在用归档 ${paths.length} 个条目）`);
  assert(paths.length > 11000, `条目数 ${paths.length}`);
  const bad = paths.filter((p) => p.startsWith('/'));
  eq(bad.slice(0, 3), [], '不该有带前导斜杠的路径');
  const st = asarStats(h.header);
  eq(st.files, paths.length, 'asarStats 的文件数要与 listAsarPaths 的长度一致');
  const pkg = readAsarEntry(P.asar, 'package.json');
  assert(pkg && pkg.length > 0, '根 package.json 要读得到');
  const parsed = JSON.parse(pkg.toString('utf8'));
  assert(typeof parsed.name === 'string' && parsed.name.length > 0, `package.json 里有 name：${parsed.name}`);
  // 目录与不存在的条目在这份真实归档上也是 null
  eq(readAsarEntry(P.asar, 'lib'), null, 'lib 是目录');
  eq(readAsarEntry(P.asar, 'lib/根本没有这个文件.js'), null, '不存在的条目');
});

check('真实 app.asar：grep 能在归档内定位到「desktop profile 被独占」这句守卫文本', () => {
  if (!fs.existsSync(P.asar)) { console.log('      SKIP 在用安装包不存在'); return; }
  const hits = grepAsarContent(P.asar, /managed exclusively/, { limit: 5 });
  assert(hits.length > 0, '这句话（CLI 直接跑 desktop profile 时的报错）应当能在归档里找到');
  assert(hits.every((h) => h.path.startsWith('dsh/')), `命中应当在 dsh/ 下且无前导斜杠，实际：${JSON.stringify(hits)}`);
  assert(hits.every((h) => h.line >= 1 && h.text.includes('managed exclusively')), '每一条都要带行号与命中行文本');
  // 命中的路径必须真的能被 cat：grep → cat 这条链是本项目定位代码的日常用法
  const first = hits[0].path;
  assert(findAsarNode(readAsarHeader(P.asar).header, first), `grep 报出的路径要能在归档里查到：${first}`);
  const viaCli = run(['asar', 'cat', first, '--out', path.join(sandbox, 'grep-then-cat.js')]);
  eq(viaCli.status, 0, `grep 出来的路径要能直接 cat，stderr=${viaCli.stderr}`);
});

check('真实 app.asar：CLI cat 一个已知条目，stdout 与库函数读出的字节一致', () => {
  if (!fs.existsSync(P.asar)) { console.log('      SKIP 在用安装包不存在'); return; }
  const entry = 'dsh/node_modules/@deepseek-ai/dsh/package.json';
  const viaLib = readAsarEntry(P.asar, entry);
  if (viaLib === null) { console.log('      SKIP 该条目不在这一份归档里'); return; }
  const out = path.join(sandbox, 'live-cat.json');
  const r = run(['asar', 'cat', entry, '--out', out]);
  eq(r.status, 0, `应退出 0，stderr=${r.stderr}`);
  eq(fs.readFileSync(out).length, viaLib.length, '字节数一致');
  eq(fs.readFileSync(out).equals(viaLib), true, '逐字节一致');
  assert(JSON.parse(fs.readFileSync(out, 'utf8')).name, '内容应是可解析的 package.json');
});

// ── 收尾 ─────────────────────────────────────────────────────────────────
try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch { /* 临时目录，忽略 */ }

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? 'OK  ' : 'FAIL'}  ${r.name}${r.ok ? '' : `\n      ${r.why}`}`);
console.log(`\nasar 只读访问单测${failed.length ? '未通过' : '通过'}：${results.length - failed.length}/${results.length} 项`);
process.exit(failed.length ? 1 : 0);
