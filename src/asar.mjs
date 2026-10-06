// deepseek-up-T :: app.asar 只读访问
//
// asar 文件头部布局（已在本机实测确认）：
//   offset 0  uint32 = 4
//   offset 4  uint32 = pickleSize (= jsonLen + 8)
//   offset 8  uint32 = payloadSize (= jsonLen + 4)
//   offset 12 uint32 = jsonLen
//   offset 16          JSON 头（UTF-8），形如 {"files":{...}}
// 实测值：pickleSize=3392056，jsonLen=3392048，16+3392048 = 文件头长度。

import fs from 'node:fs';
import path from 'node:path';

const JSON_START = 16;

export function readAsarHeader(asarPath) {
  const fd = fs.openSync(asarPath, 'r');
  try {
    const head = Buffer.alloc(JSON_START);
    const got = fs.readSync(fd, head, 0, JSON_START, 0);
    if (got < JSON_START) throw new Error('asar 头部不足 16 字节，文件可能被截断');

    const pickleSize = head.readUInt32LE(4);
    const jsonLen = head.readUInt32LE(12);

    if (pickleSize !== jsonLen + 8) {
      throw new Error(
        `asar 头部布局与预期不符：pickleSize=${pickleSize} jsonLen=${jsonLen}（期望 pickleSize === jsonLen + 8）`,
      );
    }
    if (jsonLen <= 0 || jsonLen > 512 * 1024 * 1024) {
      throw new Error(`asar 头部长度异常：${jsonLen}`);
    }

    const buf = Buffer.alloc(jsonLen);
    let off = 0;
    while (off < jsonLen) {
      const r = fs.readSync(fd, buf, off, jsonLen - off, JSON_START + off);
      if (r <= 0) throw new Error('asar 头部读取中断');
      off += r;
    }
    return { header: JSON.parse(buf.toString('utf8')), jsonLen, pickleSize };
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * 深度优先遍历 asar 头，产出 { path, node }（仅叶子）。
 * path 以 '/' 开头，使用正斜杠。
 *
 * 注意：asar 头的根节点本身就是目录节点，即 header.files 是「名字 → 子节点」的映射，
 * 而不是一个目录节点。因此游标必须从 header 起步，不能从 header.files 起步。
 */
export function* walkAsar(header) {
  if (!header?.files) return;
  const stack = [[header, '']];
  while (stack.length) {
    const [node, prefix] = stack.pop();
    for (const [name, child] of Object.entries(node.files)) {
      const full = `${prefix}/${name}`;
      if (child?.files) stack.push([child, full]);
      else yield { path: full, node: child };
    }
  }
}

// 本机实测的 app.asar 顶层结构：
//   dsh/           DSH 应用本体（含 dsh/node_modules —— 真正的 DSH 插件包都在这棵树下）
//   node_modules/  仅 Electron 打包依赖（electron-updater / fs-extra / ws …，19 个）
//   lib/           main.js、preload-*.cjs、welcome/
//   renderer/      启动窗口与更新对话框
//   package.json
// 因此包索引必须同时覆盖 `/<任意>/node_modules/<name>/package.json`。
const PKG_RE = /(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)\/package\.json$/;

/** 索引 asar 内所有 package.json 的包名 → 该 package.json 在归档内的路径 */
export function asarPackageIndex(header) {
  const index = new Map();
  for (const { path } of walkAsar(header)) {
    const m = PKG_RE.exec(path);
    if (m && !index.has(m[1])) index.set(m[1], path);
  }
  return index;
}

/**
 * 按归档内路径（`/a/b/c` 或 `a/b/c`）定位一个节点。目录节点返回 `{ files }`，叶子返回 `{ size, offset }`。
 * 找不到返回 null。
 */
export function findAsarNode(header, entryPath) {
  const parts = String(entryPath).replace(/^\/+/, '').split('/').filter(Boolean);
  let node = header;
  for (const part of parts) {
    if (!node?.files || !(part in node.files)) return null;
    node = node.files[part];
  }
  return node;
}

/**
 * 归档内全部叶子路径：正斜杠、**无前导斜杠**、与 `patches/*.yml` 里写的键同形。
 *
 * 去掉前导 `/` 是刻意的：声明、暂存树、`asar-verify` 的问题串全都用 `lib/main.js`
 * 这种写法，只有这里若保留 `/lib/main.js` 就会让「按声明查归档里有没有」全部落空。
 */
export function listAsarPaths(header) {
  return [...walkAsar(header)].map((e) => e.path.replace(/^\//, ''));
}

/** 文件数据区的起点：16 字节头 + JSON 头（等价于 8 + pickleSize）。 */
export function asarDataStart(pickleSize) {
  return 8 + pickleSize;
}

/**
 * 读出归档中单个条目的字节。
 * - `unpacked: true` 的条目内容在 `<asar>.unpacked/<path>`，此处自动回落到该目录。
 * - 目录或不存在返回 null。
 *
 * 这是本项目读「**真正在跑的那份代码**」的唯一可靠方式：实测 asar 内的包与
 * `profiles/node_modules/@deepseek-ai/*`（junction 到本地构建树）以及源码仓库
 * 都可能是**不同版本**，只有 asar 里的才是运行中 Electron 应用加载的那一份。
 */
export function readAsarEntry(asarPath, entryPath) {
  const { header, pickleSize } = readAsarHeader(asarPath);
  const node = findAsarNode(header, entryPath);
  if (!node || node.files) return null;

  if (node.unpacked === true) {
    const fallback = path.join(`${asarPath}.unpacked`, entryPath.replace(/^\/+/, ''));
    return fs.existsSync(fallback) ? fs.readFileSync(fallback) : null;
  }

  const size = Number(node.size);
  const offset = Number(node.offset);
  if (!Number.isFinite(size) || !Number.isFinite(offset)) {
    throw new Error(`条目 ${entryPath} 缺少 size/offset，无法读取`);
  }

  const base = asarDataStart(pickleSize);
  const fd = fs.openSync(asarPath, 'r');
  try {
    const buf = Buffer.alloc(size);
    let got = 0;
    while (got < size) {
      const r = fs.readSync(fd, buf, got, size - got, base + offset + got);
      if (r <= 0) throw new Error(`条目 ${entryPath} 读取中断（已读 ${got}/${size}）`);
      got += r;
    }
    return buf;
  } finally {
    fs.closeSync(fd);
  }
}

/** 结构粗筛用的文本后缀白名单：只对它们做内容检索。 */
const TEXT_EXT = /\.(m?[jt]s|cjs|json|ya?ml|md|txt|html|css|svg|map|xml|toml|sh|ps1)$/i;

/**
 * 在归档内容里检索正则，返回 `{ path, line, text }`。
 * 只扫文本后缀且不超过 `maxBytes` 的条目；命中数达到 `limit` 即停。
 * 用途：确认某个字符串**到底出自哪份产物**（源码仓库、junction 构建树、还是 asar）。
 */
export function grepAsarContent(asarPath, pattern, { limit = 20, maxBytes = 4 * 1024 * 1024 } = {}) {
  const re = pattern instanceof RegExp ? pattern : new RegExp(pattern);
  const { header, jsonLen, pickleSize } = readAsarHeader(asarPath);
  const base = asarDataStart(pickleSize);
  const hits = [];
  const fd = fs.openSync(asarPath, 'r');
  try {
    for (const { path: entryPath, node } of walkAsar(header)) {
      if (hits.length >= limit) break;
      if (!TEXT_EXT.test(entryPath)) continue;
      if (node.unpacked === true) continue;
      const size = Number(node.size);
      if (!Number.isFinite(size) || size === 0 || size > maxBytes) continue;
      const buf = Buffer.alloc(size);
      let got = 0;
      while (got < size) {
        const r = fs.readSync(fd, buf, got, size - got, base + Number(node.offset) + got);
        if (r <= 0) break;
        got += r;
      }
      if (got < size) continue;
      const text = buf.toString('utf8');
      if (!re.test(text)) continue;
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i += 1) {
        if (re.test(lines[i])) hits.push({ path: entryPath, line: i + 1, text: lines[i].trim().slice(0, 200) });
        if (hits.length >= limit) break;
      }
    }
  } finally {
    fs.closeSync(fd);
  }
  void jsonLen;
  return hits;
}

export function asarStats(header) {
  let files = 0;
  let dirs = 0;
  if (!header?.files) return { files, dirs };
  const stack = [header];
  while (stack.length) {
    const node = stack.pop();
    if (!node?.files) { files += 1; continue; }
    dirs += 1;
    for (const child of Object.values(node.files)) stack.push(child);
  }
  return { files, dirs: Math.max(0, dirs - 1) }; // 根节点不算目录
}
