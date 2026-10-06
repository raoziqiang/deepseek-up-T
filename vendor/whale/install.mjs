// deepseek-up-T :: vendor/whale 落盘 / 回滚
//
// 这是本项目**唯一**会覆盖正在使用的 app.asar 的地方，所以它做三件别处不做的事：
//   1. 落盘前强制确认 Harness 已退出（Electron memory-map 了 app.asar，否则 EPERM）；
//   2. 必须显式 `--yes`，避免手滑；
//   3. 落盘后不看退出码就完事——而是拿 patches/*.yml 的声明去核对**实际差异条目集合**，
//      多一条少一条、或者哪条不是声明里写的，都算失败。
//
// 用法：
//   node vendor/whale/install.mjs --yes                落盘暂存包（默认 state/staged/app.asar）
//   node vendor/whale/install.mjs --yes --to <archive> 演练：写到别处并按声明核对（不碰在用安装包）
//   node vendor/whale/install.mjs --rollback           从 app.asar.whale-backup 恢复
//   node vendor/whale/install.mjs --decl <file>        换一份声明
//   node vendor/whale/install.mjs --staged <archive>   换暂存包位置
//
// `--to` 存在的理由：这条路径过去**没法在 Harness 开着的时候验证** —— 它的守卫（以及
// 「声明与实际差异是否一致」这条核对）只在真落盘那一刻才跑，而真落盘一年只做几次。
// 现在它可以在临时目标上跑一遍：声明、守卫、核对、字节相等全部能离线验。
import fs from 'node:fs';
import path from 'node:path';
import {
  P,
  PROJECT_ROOT,
  STAGED_ASAR,
  assertHarnessStopped,
  readPatchDecl,
  runAsarVerify,
  compareDeclared,
  fail,
} from '../lib/harness.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function main() {
  const declFile = path.resolve(arg('--decl', path.join(PROJECT_ROOT, 'patches', 'T1-whale-splash.yml')));
  const staged = arg('--staged', STAGED_ASAR);
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
    const check = runAsarVerify(P.asarBackup, P.asar, 0);
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
      `没有暂存包：${staged}\n先构建：node vendor/whale/build.mjs\n`,
    );
  }

  // ── 演练路径（--to）：不碰在用安装包，因此不需要退出 Harness ────────────────
  // 刻意用 copyFileSync 而不是 renameSync：真落盘那条路会把暂存包**移走**，
  // 而演练跑完之后人还要接着用同一个暂存包去落盘。
  const to = arg('--to', null);
  if (to) {
    const target = path.resolve(to);
    if (target === path.resolve(P.asar)) {
      // 指向在用的那一份 = 真落盘，走下面的守卫路径，不许借 --to 绕过去。
      process.stdout.write('--to 指的就是在用安装包，按真落盘处理（需要 Harness 已退出）\n');
    } else if (isInside(target, P.resourcesDir)) {
      return fail(
        `演练目标不许落在安装目录里：${target}\n` +
        `那会让人以为改动落盘了，其实 Harness 读的仍是 ${P.asar}。换个目录（例如 state/cmp/）。\n`,
      );
    } else {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(staged, target);
      process.stdout.write(
        `\n⚠ 演练：这次写的**不是**在用安装包。\n` +
        `  目标  ${target}\n` +
        `  在用  ${P.asar}（未被改动）\n`,
      );
      return verifyAgainst(target, decl, declFile, { rehearsal: true });
    }
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
  return verifyAgainst(P.asar, decl, declFile, { rehearsal: false });
}

/** `child` 是否落在 `parent` 目录内（含相等）。用于拒绝「往安装目录里演练」。 */
function isInside(child, parent) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * 落盘/演练共用的核对：拿声明去比对**实际差异条目集合**，多一条少一条、
 * 或者哪条不是声明里写的，都算失败。两条路共用同一段代码，是为了不让
 * 「演练通过」和「真落盘通过」变成两套可能各说各话的判据。
 */
function verifyAgainst(target, decl, declFile, { rehearsal }) {
  const check = runAsarVerify(P.asarBackup, target, decl.expect);
  if (!check.ok) {
    process.stderr.write(
      `\n核对失败：预期 ${decl.expect} 个差异，实际 ${check.problems.length} 个。\n` +
      `回滚：node vendor/whale/install.mjs --rollback\n\n`,
    );
    for (const p of check.problems.slice(0, 20)) process.stderr.write(`  ${p}\n`);
    process.exit(1);
  }

  const { actual, undeclared, missing } = compareDeclared(decl, check.problems);
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
    (rehearsal
      ? '这是演练：在用安装包一个字都没动。真要落盘请在退出 Harness 后跑同样的命令、去掉 --to。\n'
      : '启动 DeepSeek Harness 即可看到新的启动界面与桌面挂件。\n'),
  );
}

main();
