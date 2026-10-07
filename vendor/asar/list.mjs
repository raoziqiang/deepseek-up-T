// deepseek-up-T :: vendor/asar 只读列出归档条目
//
// 用法：
//   node vendor/asar/list.mjs [过滤正则]                          列出匹配条目
//   node vendor/asar/list.mjs --get <条目> <输出文件>               抽出一个条目
//   node vendor/asar/list.mjs [过滤正则] --archive <归档>           换一个归档
//
// ⚠️ `--get` 与列表一样**默认读在用安装包**。要核对 `state/staged/app.asar` 或演练
// 产物里的那一份，必须显式 `--archive`；否则你比的是在用的那一份，而输出不会反驳你。
//
// 归档默认是本机正在使用的安装包（src/paths.mjs 是路径的唯一来源），必须用
// `--archive` 显式替换——不把第一个位置参数当归档，避免 `list.mjs <正则>` 被
// 误当成文件名。需要读「真正在跑的那份代码」时用这个或 `dsht asar cat`，
// 不要去读源码仓库——三者版本可能不同（见 docs/02-architecture.md）。
import fs from 'node:fs';
import { P, fail } from '../lib/harness.mjs';

const HEAD = 16;

/** 读归档头，返回 `{ header, dataOffset }`。 */
export function loadArchive(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const head = Buffer.alloc(HEAD);
    fs.readSync(fd, head, 0, HEAD, 0);
    const jsonLength = head.readUInt32LE(12);
    const jsonBuf = Buffer.alloc(jsonLength);
    let got = 0;
    while (got < jsonLength) {
      const r = fs.readSync(fd, jsonBuf, got, jsonLength - got, HEAD + got);
      if (r <= 0) throw new Error(`归档头读取中断：${got}/${jsonLength}`);
      got += r;
    }
    return { fd, header: JSON.parse(jsonBuf.toString('utf8')), dataOffset: HEAD + jsonLength };
  } catch (error) {
    fs.closeSync(fd);
    throw error;
  }
}

/** 深度优先遍历叶子，产出 `[路径, 元数据]`，路径以 `/` 分隔且无前导斜杠。 */
export function* walkFiles(header) {
  const stack = [['', header]];
  while (stack.length > 0) {
    const [prefix, node] = stack.pop();
    for (const [name, value] of Object.entries(node.files ?? {})) {
      const p = prefix ? `${prefix}/${name}` : name;
      if (value.files) stack.push([p, value]);
      else yield [p, value];
    }
  }
}

/** 读出单个条目的字节；`unpacked` 条目从 `<归档>.unpacked/` 取。 */
export function readEntry(archive, meta, dataOffset, fd) {
  if (meta.unpacked === true || meta.offset === undefined) {
    const side = `${archive}.unpacked`;
    const rel = meta.path ?? '';
    return fs.readFileSync(`${side}/${rel}`);
  }
  const size = Number(meta.size);
  const buf = Buffer.alloc(size);
  let got = 0;
  while (got < size) {
    const r = fs.readSync(fd, buf, got, size - got, dataOffset + Number(meta.offset) + got);
    if (r <= 0) break;
    got += r;
  }
  return buf;
}

export function collectEntries(header) {
  const map = new Map();
  for (const [p, meta] of walkFiles(header)) map.set(p, meta);
  return map;
}

function main() {
  const argv = process.argv.slice(2);
  const archiveFlag = argv.indexOf('--archive');
  const getFlag = argv.indexOf('--get');
  const consumed = new Set();
  if (archiveFlag >= 0) { consumed.add(archiveFlag); consumed.add(archiveFlag + 1); }
  if (getFlag >= 0) { consumed.add(getFlag); consumed.add(getFlag + 1); consumed.add(getFlag + 2); }
  const positional = argv.filter((_, i) => !consumed.has(i) && !argv[i].startsWith('--'));

  // 归档一律显式给出：`--archive <file>`，否则用本机安装包。
  // 刻意**不**把第一个位置参数当归档——那样 `list.mjs <正则>` 会被当成文件名，
  // 抛一个 ENOENT 堆栈出来，正是这类小工具的经典误用陷阱。
  const archive = archiveFlag >= 0 ? argv[archiveFlag + 1] : P.asar;
  if (!archive || !fs.existsSync(archive)) return fail(`归档不存在：${archive}`);

  const { fd, header, dataOffset } = loadArchive(archive);
  try {
    if (getFlag >= 0) {
      const inner = argv[getFlag + 1];
      const out = argv[getFlag + 2];
      if (!inner || !out) return fail('用法：list.mjs --get <条目路径> <输出文件> [--archive <归档>]');
      const key = inner.replace(/^\//, '');
      const meta = collectEntries(header).get(key);
      if (!meta) return fail(`归档里没有这个条目：${key}`);
      const buf = readEntry(archive, { ...meta, path: key }, dataOffset, fd);
      fs.writeFileSync(out, buf);
      // 来源必须打出来：`--get` 不写 `--archive` 时读的是**在用安装包**，
      // 而这里恰恰是最常用来「核对暂存包/演练产物里那一份是不是修好的版本」的命令
      // —— 漏掉 `--archive` 会把在用安装包的哈希当成暂存包的哈希（骗过一次核对）。
      const origin = archiveFlag >= 0 ? archive : `${archive}  ← 默认（在用安装包，不是暂存包）`;
      process.stdout.write(`抽出 ${key}（${buf.length} 字节）\n  来自 ${origin}\n  写出 ${out}\n`);
      return;
    }

    const re = new RegExp(positional[0] ?? '.', 'i');
    const all = [...collectEntries(header).keys()].sort();
    const matched = all.filter((p) => re.test(p));
    process.stdout.write(`归档 ${archive}\n条目共 ${all.length} 个，匹配 ${matched.length} 个\n`);
    for (const p of matched) process.stdout.write(`  ${p}\n`);
  } finally {
    fs.closeSync(fd);
  }
}

main();
