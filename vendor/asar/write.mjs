// deepseek-up-T :: vendor/asar 整条目重写（会写文件，但仍不改动正在使用的安装包）
//
// 用法：
//   node vendor/asar/write.mjs <归档> --set <条目> <输入文件> [--set ...] [--out <输出>]
//
// 与归拢前的差别（四条都是安全性的）：
//   1. **不再默认原地重写。** `--out` 省略时输出到 `<归档>.tmp`，也就是暂存位。
//      要原地写必须显式 `--out <归档>`，且此时**强制**要求 Harness 已退出——
//      Electron 会 memory-map app.asar，应用开着时覆盖是静默写坏的开始。
//   2. **`<归档>.tmp` 不许落在安装目录里。** 输入就是在用安装包时，省略 `--out` 会正好造出
//      doctor 专门报的那个「app.asar.tmp 残留」（当初一块坏构建在那里躺了一整天，
//      主进程一加载就 SyntaxError）。想写那里可以，但要显式写出 `--out`。
//   3. **原版备份 (`app.asar.whale-backup`) 一律拒绝写入**，与输入是什么无关：
//      那是唯一一条回头路。恢复安装包请用 `install.mjs --rollback`。
//   4. 路径全部来自 src/paths.mjs，不再由脚本位置推 `..`。
//
// 打包算法与归拢前逐行一致（已验证：条目顺序保留、偏移 4 字节对齐、头部不填充）。
// 注意 `unpacked: true` 的条目没有 offset，其字节在 `<归档>.unpacked/` 下，
// 一律原样透传，绝不从数据区拷贝或重写。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { P, assertHarnessStopped, fail } from '../lib/harness.mjs';

const JSON_START = 16;

const isInside = (child, parent) => {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
};

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

  // ── 三条关于「写哪儿」的规矩，全部排在真正打开归档之前 ──────────────────────
  // 1. 唯一一条回头路不许被覆盖：`app.asar.whale-backup` 一旦写坏，装坏了就没得回去。
  //    刻意与「输入是不是在用安装包」无关 —— 就算在拿一份副本练手，目标也不许是它。
  if (out !== null && path.resolve(out) === path.resolve(P.asarBackup)) {
    return fail(
      `拒绝写入原版备份：${P.asarBackup}\n`
      + '那是唯一一条回头路：doctor 的「原版备份」一条与 install.mjs --rollback 都靠这一份。\n'
      + '覆盖它之后，装坏了就没有原版可以回去了。真要恢复安装包请用：\n'
      + '  node vendor/whale/install.mjs --rollback',
    );
  }
  if (out === null) {
    out = `${archive}.tmp`;
    // 2. 省略 --out 时输出会落在**输入归档旁边**。如果输入就是在用安装包，那就是安装目录里的
    //    `app.asar.tmp` —— doctor 专门报的「残留」，也正是当初一块坏构建躺了一整天的地方
    //    （121,415,608 B，主进程一加载就 SyntaxError）。写这里可以，但必须显式说出口。
    if (isInside(out, P.resourcesDir)) {
      return fail(
        `未指定 --out，而输出会落在安装目录里：${out}\n`
        + '那正是 doctor 会报的「app.asar.tmp 残留」。请显式指定一个安装目录之外的输出，例如：\n'
        + '  node vendor/asar/write.mjs <归档> --set <条目> <文件> --out state/cmp/练手.asar',
      );
    }
    process.stdout.write(`未指定 --out，写入暂存位 ${out}\n`);
  } else if (path.resolve(out) === path.resolve(archive)) {
    // 3. 原地重写正在使用的安装包：Electron 会 memory-map 它，应用开着时覆盖是静默写坏的开始。
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
  try {
    fs.renameSync(tmp, out);
  } catch (error) {
    // Windows 上有进程以不共享 DELETE 的方式短暂打开暂存包时，覆盖式 rename
    // 会报 EPERM，尽管同一个文件仍可写。只对安装目录外的已有产物退回复制；
    // 先保留旧产物，复制失败时可以恢复。安装包本体始终由 install.mjs 管。
    if (!['EPERM', 'EACCES'].includes(error.code) || !fs.existsSync(out)
      || isInside(out, P.resourcesDir) || out === path.resolve(P.asar)) throw error;
    const previous = `${out}.previous-${crypto.randomUUID()}`;
    fs.copyFileSync(out, previous);
    try {
      fs.copyFileSync(tmp, out);
      if (fs.statSync(tmp).size !== fs.statSync(out).size) {
        throw new Error('暂存包复制后大小不一致');
      }
    } catch (copyError) {
      fs.copyFileSync(previous, out);
      fs.rmSync(previous, { force: true });
      throw copyError;
    }
    // 清理失败不能走上面的恢复分支：此时新产物已完整复制，恢复旧包会把成功写入变成假失败。
    for (const obsolete of [tmp, previous]) {
      try { fs.rmSync(obsolete, { force: true }); }
      catch (cleanupError) { process.stderr.write(`清理残留失败：${obsolete}（${cleanupError.code}）\n`); }
    }
    process.stdout.write('Windows 未允许覆盖式重命名，已备份旧暂存包并复制新产物。\n');
  }
  process.stdout.write(`写入 ${out}（共 ${order.length} 个条目，替换 ${sets.length} 个）\n`);
}

main();
