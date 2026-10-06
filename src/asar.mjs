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
