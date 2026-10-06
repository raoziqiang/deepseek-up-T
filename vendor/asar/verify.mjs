// deepseek-up-T :: vendor/asar 逐条目校验重打包结果
//
// 用法：
//   node vendor/asar/verify.mjs                                  自检：原版备份 vs 当前安装包（应 0 差异）
//   node vendor/asar/verify.mjs <原版> <新包>
//   node vendor/asar/verify.mjs <原版> <新包> --expect <n>        预期恰好 n 个条目不同
//   node vendor/asar/verify.mjs <原版> <新包> --expect <n> --json  机器可读输出
//
// `--expect` 的语义是「**恰好** n 个条目不同，且每一个都是尺寸变化或新增」——
// 同尺寸条目的字节翻转一定是改坏了，永远算失败。这是仓内所有安装包改动的验收门。
//
// 不带参数时比较 `app.asar.whale-backup` 与 `app.asar`，也就是厂商原版 vs 当前安装版：
// 结果必须是 0 差异（还没落盘）或声明里那个数字（已按 patches/*.yml 落盘）。
import fs from 'node:fs';
import crypto from 'node:crypto';
import { P, fail } from '../lib/harness.mjs';

const HEAD = 16;

function loadArchive(file) {
  const fd = fs.openSync(file, 'r');
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
}

function collect(header) {
  const map = new Map();
  const stack = [['', header]];
  while (stack.length > 0) {
    const [prefix, node] = stack.pop();
    for (const [name, value] of Object.entries(node.files ?? {})) {
      const p = prefix ? `${prefix}/${name}` : name;
      if (value.files) stack.push([p, value]);
      else map.set(p, value);
    }
  }
  return map;
}

function readRange(fd, dataOffset, meta) {
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

function main() {
  const argv = process.argv.slice(2);
  const flag = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const json = argv.includes('--json');
  const onlyArg = flag('--only');
  const only = onlyArg !== undefined ? new RegExp(onlyArg) : null;
  const expectArg = flag('--expect');
  const expected = expectArg !== undefined ? Number(expectArg) : null;

  const positional = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--only' && argv[i - 1] !== '--expect');
  const originalPath = positional[0] ?? P.asarBackup;
  const newPath = positional[1] ?? P.asar;

  for (const f of [originalPath, newPath]) {
    if (!fs.existsSync(f)) return fail(`归档不存在：${f}`);
  }

  const orig = loadArchive(originalPath);
  const next = loadArchive(newPath);
  const a = collect(orig.header);
  const b = collect(next.header);

  let checked = 0;
  let skipped = 0;
  const problems = [];

  for (const [p, meta] of a) {
    if (only && !only.test(p)) continue;
    const other = b.get(p);
    if (other === undefined) {
      problems.push(`MISSING in new archive: ${p}`);
      continue;
    }
    if (meta.unpacked === true || meta.offset === undefined) {
      if (JSON.stringify(meta) !== JSON.stringify(other)) problems.push(`UNPACKED metadata changed: ${p}`);
      skipped += 1;
      continue;
    }
    if (meta.size !== other.size) {
      problems.push(`SIZE differs: ${p} ${meta.size} -> ${other.size}`);
      continue;
    }
    const x = readRange(orig.fd, orig.dataOffset, meta);
    const y = readRange(next.fd, next.dataOffset, other);
    if (!x.equals(y)) {
      const ha = crypto.createHash('sha256').update(x).digest('hex').slice(0, 12);
      const hb = crypto.createHash('sha256').update(y).digest('hex').slice(0, 12);
      problems.push(`BYTES differ: ${p} (${ha} vs ${hb})`);
    }
    checked += 1;
  }
  for (const p of b.keys()) if (!a.has(p)) problems.push(`ADDED: ${p}`);

  fs.closeSync(orig.fd);
  fs.closeSync(next.fd);

  const byteDiffs = problems.filter((p) => p.startsWith('BYTES differ'));
  const unpackedDiffs = problems.filter((p) => p.startsWith('UNPACKED'));
  let ok;
  if (expected === null) ok = problems.length === 0;
  else ok = problems.length === expected && byteDiffs.length === 0 && unpackedDiffs.length === 0;

  if (json) {
    process.stdout.write(`${JSON.stringify({
      original: originalPath, target: newPath, checked, skipped, expected, ok, problems,
    })}\n`);
  } else {
    process.stdout.write(`比较 ${checked} 个归档内条目、${skipped} 个 unpacked 条目\n`);
    if (problems.length === 0) {
      process.stdout.write('OK：逐字节一致\n');
    } else if (ok) {
      process.stdout.write(`OK：恰好 ${expected} 个预期条目不同，其余逐字节一致\n`);
      for (const p of problems) process.stdout.write(`  ${p}\n`);
    } else if (expected !== null) {
      process.stdout.write(`失败：预期 ${expected} 个预期差异，实际 ${problems.length} 个\n`);
      if (byteDiffs.length > 0) {
        process.stdout.write(`  其中 ${byteDiffs.length} 个同尺寸条目发生了字节变化（一定是改坏了）：\n`);
        for (const p of byteDiffs.slice(0, 10)) process.stdout.write(`    ${p}\n`);
      }
      if (unpackedDiffs.length > 0) {
        process.stdout.write(`  其中 ${unpackedDiffs.length} 个 unpacked 元数据变化：\n`);
        for (const p of unpackedDiffs.slice(0, 10)) process.stdout.write(`    ${p}\n`);
      }
      for (const p of problems.slice(0, 20)) process.stdout.write(`  ${p}\n`);
    } else {
      process.stdout.write(`失败：${problems.length} 个问题\n`);
      for (const p of problems.slice(0, 20)) process.stdout.write(`  ${p}\n`);
    }
  }
  if (!ok) process.exitCode = 1;
}

main();
