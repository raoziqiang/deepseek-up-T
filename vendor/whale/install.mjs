// deepseek-up-T :: vendor/whale 落盘 / 回滚
//
// 这是本项目**唯一**会覆盖正在使用的 app.asar 的地方，所以它做三件别处不做的事：
//   1. 落盘前强制确认 Harness 已退出（Electron memory-map 了 app.asar，否则 EPERM）；
//   2. 必须显式 `--yes`，避免手滑；
//   3. 落盘后不看退出码就完事——而是拿 patches/*.yml 的声明去核对**实际差异条目集合**，
//      多一条少一条、或者哪条不是声明里写的，都算失败。
//
// 用法：
//   node vendor/whale/install.mjs --yes                落盘暂存包（默认 app.asar.tmp）
//   node vendor/whale/install.mjs --rollback           从 app.asar.whale-backup 恢复
//   node vendor/whale/install.mjs --decl <file>        换一份声明
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  P,
  PROJECT_ROOT,
  assertHarnessStopped,
  readPatchDecl,
  fail,
} from '../lib/harness.mjs';

const VERIFY = path.join(PROJECT_ROOT, 'vendor', 'asar', 'verify.mjs');

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

/** 从 asar-verify 的问题串里还原出条目路径。 */
function pathOf(problem) {
  let m = /^(?:MISSING in new archive|UNPACKED metadata changed|ADDED): (.+)$/.exec(problem);
  if (m) return m[1];
  m = /^(?:SIZE differs|BYTES differ): (\S+)/.exec(problem);
  if (m) return m[1];
  return null;
}

function runVerify(original, target, expect) {
  const result = spawnSync(
    process.execPath,
    [VERIFY, original, target, '--expect', String(expect), '--json'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true },
  );
  const text = (result.stdout ?? '').trim();
  if (text === '') {
    return fail(`asar-verify 没有输出，无法核对。stderr:\n${result.stderr ?? ''}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(text.split(/\r?\n/).at(-1));
  } catch {
    return fail(`asar-verify 的输出不是 JSON：\n${text.slice(0, 500)}`);
  }
  return parsed;
}

function main() {
  const declFile = path.resolve(arg('--decl', path.join(PROJECT_ROOT, 'patches', 'T1-whale-splash.yml')));
  const staged = arg('--staged', P.asarTmp);
  const rollback = process.argv.includes('--rollback');

  if (!fs.existsSync(declFile)) return fail(`找不到补丁声明：${declFile}`);
  let decl;
  try {
    decl = readPatchDecl(declFile);
  } catch (error) {
    return fail(String(error.message ?? error));
  }
  process.stdout.write(`补丁声明  ${decl.id}\n  声明差异条目 ${decl.expect} 个：\n`);
  for (const e of decl.entries) process.stdout.write(`    ${e}\n`);

  // ── 回滚路径 ──────────────────────────────────────────────────────────────
  if (rollback) {
    if (!fs.existsSync(P.asarBackup)) return fail(`没有备份可回滚：${P.asarBackup}`);
    assertHarnessStopped('从备份回滚 app.asar');
    fs.copyFileSync(P.asarBackup, P.asar);
    process.stdout.write(`\n已从备份恢复 ${P.asar}\n`);
    const check = runVerify(P.asarBackup, P.asar, 0);
    process.stdout.write(check.ok ? '核对：恢复后的安装包与备份逐字节一致\n' : '核对失败：恢复结果与原版不一致\n');
    process.exitCode = check.ok ? 0 : 1;
    return;
  }

  // ── 落盘路径 ──────────────────────────────────────────────────────────────
  if (!process.argv.includes('--yes')) {
    return fail(
      '落盘会覆盖正在使用的 app.asar。确认要执行请再加 --yes：\n' +
      `  node vendor/whale/install.mjs --yes\n`,
    );
  }
  if (!fs.existsSync(staged)) {
    return fail(
      `没有暂存包：${staged}\n先构建：node vendor/whale/build.mjs --install`,
    );
  }
  assertHarnessStopped('覆盖 app.asar');

  const stagedInfo = fs.statSync(staged);
  process.stdout.write(
    `\n暂存包  ${staged}\n  ${stagedInfo.size} 字节，${stagedInfo.mtime.toISOString()}\n`,
  );

  if (!fs.existsSync(P.asarBackup)) {
    fs.copyFileSync(P.asar, P.asarBackup);
    process.stdout.write(`已备份原版安装包 -> ${P.asarBackup}\n`);
  } else {
    process.stdout.write(`原版备份已存在，保留：${P.asarBackup}\n`);
  }

  // rename 在同卷上是原子的；目标仍存在且可写时退回原地复制。
  try {
    fs.renameSync(staged, P.asar);
    process.stdout.write(`已落盘 -> ${P.asar}\n`);
  } catch (error) {
    process.stdout.write(`rename 被拒（${error.code}），改为原地复制\n`);
    fs.copyFileSync(staged, P.asar);
    fs.rmSync(staged, { force: true });
    process.stdout.write(`已落盘 -> ${P.asar}\n`);
  }

  // ── 用声明核对实际差异 ────────────────────────────────────────────────────
  const check = runVerify(P.asarBackup, P.asar, decl.expect);
  if (!check.ok) {
    process.stderr.write(
      `\n核对失败：预期 ${decl.expect} 个差异，实际 ${check.problems.length} 个。\n` +
      `回滚：node vendor/whale/install.mjs --rollback\n\n`,
    );
    for (const p of check.problems.slice(0, 20)) process.stderr.write(`  ${p}\n`);
    process.exit(1);
  }

  const actual = new Set(check.problems.map(pathOf).filter(Boolean));
  const declared = new Set(decl.entries.map((e) => e.replace(/\\/g, '/')));
  const undeclared = [...actual].filter((p) => !declared.has(p));
  const missing = [...declared].filter((p) => !actual.has(p));
  if (undeclared.length > 0 || missing.length > 0) {
    process.stderr.write(
      `\n核对失败：实际差异与声明不符。\n` +
      (undeclared.length ? `  声明里没有、却真被改了：${undeclared.join(', ')}\n` : '') +
      (missing.length ? `  声明里有、却没被改：${missing.join(', ')}\n` : '') +
      `更新声明 ${declFile}，或回滚：node vendor/whale/install.mjs --rollback\n\n`,
    );
    process.exit(1);
  }

  process.stdout.write(
    `\n完成：${actual.size} 个条目按声明改动，其余全部逐字节一致。\n` +
    '启动 DeepSeek Harness 即可看到新的启动界面与桌面挂件。\n',
  );
}

main();
