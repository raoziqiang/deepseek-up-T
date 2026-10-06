// deepseek-up-T :: vendor/asar 整条目重写（会写文件，但仍不改动正在使用的安装包）
//
// 用法：
//   node vendor/asar/write.mjs <归档> --set <条目> <输入文件> [--set ...] [--out <输出>]
//
// 与归拢前的差别（两条都是安全性的）：
//   1. **不再默认原地重写。** `--out` 省略时输出到 `<归档>.tmp`，也就是暂存位。
//      要原地写必须显式 `--out <归档>`，且此时**强制**要求 Harness 已退出——
//      Electron 会 memory-map app.asar，应用开着时覆盖是静默写坏的开始。
//   2. 路径全部来自 src/paths.mjs，不再由脚本位置推 `..`。
//
// 打包算法与归拢前逐行一致（已验证：条目顺序保留、偏移 4 字节对齐、头部不填充）。
// 注意 `unpacked: true` 的条目没有 offset，其字节在 `<归档>.unpacked/` 下，
// 一律原样透传，绝不从数据区拷贝或重写。
import fs from 'node:fs';
import path from 'node:path';
import { assertHarnessStopped, fail } from '../lib/harness.mjs';

const JSON_START = 16;

function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    return fail('用法：write.mjs <归档> --set <条目> <输入文件> [--set ...] [--out <输出>]');
  }

  const archive = argv[0];
  const sets = [];
  let out = null;
  for (let i = 1; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--set') {
      const inner = argv[++i];
      const file = argv[++i];
      if (inner === undefined || file === undefined) return fail('--set 需要 <条目> <输入文件>');
      sets.push({ inner: inner.replace(/\\/g, '/').replace(/^\//, ''), file });
    } else if (token === '--out') {
      out = argv[++i];
    } else {
      return fail(`未知参数：${token}`);
    }
  }
  if (sets.length === 0) return fail('没有给出任何 --set 操作');
  if (!fs.existsSync(archive)) return fail(`归档不存在：${archive}`);
  // 省略 --out 一律写暂存位，绝不默认原地重写：原地重写正在使用的安装包是
  // 最容易把 Harness 写坏的一步，必须是**显式**选择。
  if (out === null) {
    out = `${archive}.tmp`;
    process.stdout.write(`未指定 --out，写入暂存位 ${out}\n`);
  } else if (path.resolve(out) === path.resolve(archive)) {
    assertHarnessStopped('原地重写正在使用的 app.asar');
  }
  out = path.resolve(out);

  // ── 读归档头 ───────────────────────────────────────────────────────────────
  const fd = fs.openSync(archive, 'r');
  const head = Buffer.alloc(32);
  fs.readSync(fd, head, 0, 32, 0);
  const jsonLength = head.readUInt32LE(12);
  const jsonBuf = Buffer.alloc(jsonLength);
  let jsonGot = 0;
  while (jsonGot < jsonLength) {
    const r = fs.readSync(fd, jsonBuf, jsonGot, jsonLength - jsonGot, JSON_START + jsonGot);
    if (r <= 0) throw new Error(`归档头读取中断：${jsonGot}/${jsonLength}`);
    jsonGot += r;
  }
  const header = JSON.parse(jsonBuf.toString('utf8'));
  const dataOffset = JSON_START + jsonLength;

  const order = [];
  const fileMap = new Map();
  const walk = (node, prefix) => {
    for (const [name, value] of Object.entries(node.files ?? {})) {
      const p = prefix ? `${prefix}/${name}` : name;
      if (value.files) walk(value, p);
      else {
        fileMap.set(p, value);
        order.push(p);
      }
    }
  };
  walk(header, '');
  const isUnpacked = (meta) => meta.unpacked === true || meta.offset === undefined;

  // ── 准备替换载荷 ───────────────────────────────────────────────────────────
  const replacements = new Map();
  for (const { inner, file } of sets) {
    let info = null;
    try { info = fs.statSync(file); } catch { info = null; }
    if (info === null || !info.isFile()) return fail(`输入不是可读文件：${file}`);
    replacements.set(inner, fs.readFileSync(file));
    if (!fileMap.has(inner)) {
      const parts = inner.split('/');
      let node = header;
      for (const part of parts.slice(0, -1)) {
        node.files[part] ??= { files: {} };
        node = node.files[part];
      }
      const leaf = parts.at(-1);
      node.files[leaf] = { size: 0, offset: '0' };
      fileMap.set(inner, node.files[leaf]);
      order.push(inner);
      process.stdout.write(`新增条目 ${inner}\n`);
    }
  }

  // ── 按原条目顺序重建数据区 ─────────────────────────────────────────────────
  const chunks = [];
  let cursor = 0;
  const align = (n) => (n % 4 === 0 ? n : n + (4 - (n % 4)));

  for (const p of order) {
    const meta = fileMap.get(p);
    const payload = replacements.get(p);
    if (payload !== undefined) {
      delete meta.unpacked;
      delete meta.integrity;
      meta.size = payload.length;
      meta.offset = String(cursor);
      chunks.push(payload);
      cursor = align(cursor + payload.length);
      const pad = cursor - (Number(meta.offset) + payload.length);
      if (pad > 0) chunks.push(Buffer.alloc(pad));
      continue;
    }
    if (isUnpacked(meta)) continue;
    const size = Number(meta.size);
    const buf = Buffer.alloc(size);
    if (size > 0) fs.readSync(fd, buf, 0, size, dataOffset + Number(meta.offset));
    meta.offset = String(cursor);
    chunks.push(buf);
    cursor = align(cursor + size);
    const pad = cursor - (Number(meta.offset) + size);
    if (pad > 0) chunks.push(Buffer.alloc(pad));
  }
  fs.closeSync(fd);

  // ── 序列化新头部 ───────────────────────────────────────────────────────────
  // JSON 文档**不填充**：字段 d 就是它的精确字节长度，数据区紧随其后。
  //   u32@0  = 4                （pickle 标记）
  //   u32@4  = 8 + jsonLength
  //   u32@8  = b - 4
  //   u32@12 = jsonLength
  //   json   @16，data @16 + d
  const json = Buffer.from(JSON.stringify(header), 'utf8');
  const b = 8 + json.length;
  const prefix = Buffer.alloc(JSON_START);
  prefix.writeUInt32LE(4, 0);
  prefix.writeUInt32LE(b, 4);
  prefix.writeUInt32LE(b - 4, 8);
  prefix.writeUInt32LE(json.length, 12);

  fs.mkdirSync(path.dirname(out), { recursive: true });
  const tmp = `${out}.writing`;
  fs.writeFileSync(tmp, Buffer.concat([prefix, json, ...chunks]));
  fs.renameSync(tmp, out);
  process.stdout.write(`写入 ${out}（共 ${order.length} 个条目，替换 ${sets.length} 个）\n`);
}

main();
