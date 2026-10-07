// deepseek-up-T :: 按 patches/*.yml 构建暂存安装包（不改安装目录）
//
// 这个脚本是补丁声明的**执行器**：声明说什么，它就构建什么。
// 顺序：解析声明 → 逐条目生成（bundle / patch / copy）→ 语法检查 → 重打包 → 与声明核对。
//
// 它**不**碰安装目录里的 app.asar：产物落在 state/staged/ 下。
// 真正落盘是 vendor/whale/install.mjs 的事（那一步需要先退出 Harness）。
//
// 这样分两步的理由：构建可以随便重跑、可以比对、可以失败，而落盘只有一次机会。
//
// 用法：
//   node vendor/whale/build.mjs                       默认按 patches/T1-whale-splash.yml 构建
//   node vendor/whale/build.mjs --decl <file>          换一份声明
//   node vendor/whale/build.mjs --from <archive>       换一个原版归档（默认本机正在用的）
//   node vendor/whale/build.mjs --out <archive>        换暂存包位置（默认 state/staged/app.asar）

import fs from 'node:fs';
import path from 'node:path';
import {
  P,
  PROJECT_ROOT,
  STAGED_ASAR,
  STAGED_TREE,
  TOOLS,
  readPatchDecl,
  readAsarEntry,
  runStep,
  runAsarVerify,
  compareDeclared,
  fail,
} from '../lib/harness.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

/** 声明里的工具路径相对于项目根写（`vendor/whale/xxx.mjs`），也允许绝对路径。 */
function toolPath(value) {
  return path.isAbsolute(value) ? value : path.resolve(PROJECT_ROOT, value);
}

const declFile = path.resolve(arg('--decl', path.join(PROJECT_ROOT, 'patches', 'T1-whale-splash.yml')));
const defaultFrom = fs.existsSync(P.asarBackup) ? P.asarBackup : P.asar;
const from = path.resolve(arg('--from', defaultFrom));
const out = path.resolve(arg('--out', STAGED_ASAR));

if (!fs.existsSync(from)) fail(`原版归档不存在：${from}`);

let decl;
try {
  decl = readPatchDecl(declFile);
} catch (error) {
  fail(String(error.message ?? error));
}
process.stdout.write(`补丁声明  ${decl.id}  (${path.relative(PROJECT_ROOT, declFile)})\n`);
process.stdout.write(`原版归档  ${from}\n`);

// ── 1. 逐条目生成 ────────────────────────────────────────────────────────────
// 暂存树按**归档内路径**镜像排列，这样「声明里的路径」与「待写入的文件」是同一个键，
// 不会出现「声明写 A、打包用 B」这类对不上的情况。
const declDir = path.dirname(declFile);
fs.rmSync(STAGED_TREE, { recursive: true, force: true });

const built = [];
for (const item of decl.items) {
  if (item.path === undefined) fail(`声明 ${decl.id} 有一条条目没有 path`);
  if (item.source === undefined) fail(`条目 ${item.path} 没有 source`);
  const src = path.resolve(declDir, item.source);
  const dest = path.join(STAGED_TREE, item.path);

  if (!fs.existsSync(src)) {
    const hint = item.action === 'patch'
      ? '这是原版素材，从与本脚本 `--from` 同源的那份归档里抽出来\n' +
        '（无升级时 = resources/app.asar.whale-backup 原版备份；升级后 = 新安装包；\n' +
        '  落盘后别从已改造的安装包抽，抽出来的会是打过补丁的代码）：\n' +
        `  node vendor/asar/list.mjs --get ${item.path} ${path.relative(process.cwd(), src)}`
      : '这是构建素材，应当在改造素材目录里（见 vendor/README.md）。';
    fail(`缺少素材：${src}\n${hint}`);
  }

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const action = item.action ?? 'replace';

  // action: patch 的 source 是**原版素材**，必须在当前归档里找到一模一样的那一份。
  // 否则就是拿旧版本的原版去改——改出来的文件会**静默丢掉**新版新增的代码，
  // 而且所有锚点仍然命中，patch 会一路声称成功。这是这条链上最危险的一种失败。
  if (action === 'patch') {
    let current = null;
    try {
      current = readAsarEntry(from, item.path);
    } catch {
      current = null;
    }
    if (current === null || current === undefined) fail(`归档里没有 ${item.path}`);
    if (!current.equals(fs.readFileSync(src))) {
      fail(
        `原版素材与归档不一致：${src}\n` +
        `  归档里 ${current.length} 字节，素材 ${fs.statSync(src).size} 字节\n` +
        '这是拿旧版本的原版去改，会丢掉新版代码。从上面这份 --from 归档里重新抽一份：\n' +
        `  node vendor/asar/list.mjs --get ${item.path} ${path.relative(process.cwd(), src)}`,
      );
    }
    process.stdout.write(`  原版素材与归档一致（${current.length} 字节）\n`);
  }

  if (item.bundler !== undefined) {
    runStep([toolPath(item.bundler), src, dest]);
  } else if (item.patcher !== undefined) {
    runStep([toolPath(item.patcher), src, dest]);
  } else {
    fs.copyFileSync(src, dest);
  }
  process.stdout.write(`  ${action.padEnd(7)} ${item.path}\n`);
  built.push({ ...item, action, dest });
}

// ── 2. 语法检查 ──────────────────────────────────────────────────────────────
// 声明里列了 syntax_check 就必须逐个检查；没列就把所有 JS 产物都检查一遍。
// 归档里的代码语法错误在打包阶段看不出来，只会在下次启动时炸——所以这一步不能省。
const declaredChecks = decl.syntaxCheck.length > 0
  ? decl.syntaxCheck
  : built.filter((b) => /\.(m?[jt]s|cjs)$/i.test(b.path)).map((b) => b.path);
for (const rel of declaredChecks) {
  const target = path.join(STAGED_TREE, rel);
  if (!fs.existsSync(target)) fail(`syntax_check 里的 ${rel} 不在暂存树里（声明与 entries 不一致？）`);
  runStep(['--check', target]);
  process.stdout.write(`  已检查 ${rel}\n`);
}

// ── 3. 重打包到暂存位 ────────────────────────────────────────────────────────
const sets = [];
for (const b of built) sets.push('--set', b.path, b.dest);
fs.mkdirSync(path.dirname(out), { recursive: true });
runStep([TOOLS.write, from, ...sets, '--out', out]);
process.stdout.write(`\n暂存包  ${out}\n`);

// ── 4. 与声明核对 ────────────────────────────────────────────────────────────
// 构建阶段就能核对，是因为「暂存包 vs 原版」的差异集合此时已经可测。
// 落盘前就知道改了几处，比落盘后才发现多改一处要安全得多。
const check = runAsarVerify(from, out, decl.expect);
if (!check.ok) {
  process.stderr.write(
    `\n构建核对失败：预期 ${decl.expect} 个差异，实际 ${check.problems.length} 个。\n`,
  );
  for (const p of check.problems.slice(0, 20)) process.stderr.write(`  ${p}\n`);
  process.exit(1);
}
const { actual, undeclared, missing } = compareDeclared(decl, check.problems);
if (undeclared.length > 0 || missing.length > 0) {
  process.stderr.write(
    '\n构建核对失败：实际差异与声明不符。\n' +
    (undeclared.length ? `  声明里没有、却真被改了：${undeclared.join(', ')}\n` : '') +
    (missing.length ? `  声明里有、却没被改：${missing.join(', ')}\n` : ''),
  );
  process.exit(1);
}

process.stdout.write(
  `${actual.size} 个条目按声明改动，其余 ${check.checked} 个条目逐字节一致。\n` +
  `原版大小 ${fs.statSync(from).size} 字节 → 暂存包 ${fs.statSync(out).size} 字节\n` +
  '落盘（需要先退出 Harness）：node vendor/whale/install.mjs --yes\n',
);
