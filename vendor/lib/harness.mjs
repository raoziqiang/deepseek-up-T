// deepseek-up-T :: vendor/ 执行器的共享底座
//
// 这里是 src/（只读诊断）与 vendor/（会写东西的执行器）之间**唯一**的接口：
//   · 全部 DSH 路径事实来自 src/paths.mjs —— vendor 下任何脚本都不得自己拼路径，
//     也不得再用 `path.resolve(here, '..')` 推「工作区根」（这是归拢前的坏习惯：
//     脚本一旦搬目录，`..` 就指向别处，静默写错位置）。
//   · 「写安装包前必须先确认 Harness 没在跑」这条守卫集中在这里，只有一处实现。

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { readAsarEntry } from '../../src/asar.mjs';
import {
  PROJECT_ROOT,
  resolvePaths,
  exists,
  statOrNull,
  human,
  short,
  sha256,
  sha256Short,
  readText,
  readJson,
} from '../../src/paths.mjs';

export {
  PROJECT_ROOT,
  resolvePaths,
  exists,
  statOrNull,
  human,
  short,
  sha256,
  sha256Short,
  readText,
  readJson,
  readAsarEntry,
};

/** 本机 DSH 的全部关键路径（安装目录 / profiles / app.asar / 备份 / 暂存）。 */
export const P = resolvePaths();

/**
 * 工作区根 = 改造素材所在处（`.probe/`、`whale-motion/`）。
 * 由项目根推出来而非写死；可用环境变量覆盖以便在别处复现。
 */
export const WORKSPACE = process.env.DSH_UP_T_WORKSPACE || path.resolve(PROJECT_ROOT, '..');

/** 构建输入资产（手工维护的源文件）与构建输出（待打包的产物）。 */
export const BUILD_DIR = path.join(WORKSPACE, '.probe', 'build');
export const DIST_DIR = path.join(WORKSPACE, '.probe', 'dist');
/** 从归档里抽出来的原版源码缓存目录（main.js / preload-app.cjs / session-controller.js）。 */
export const SOURCES_DIR = path.join(WORKSPACE, '.probe');

// ——————————————————————————— Harness 运行检测 ———————————————————————————

const IMAGE = 'DeepSeek Harness.exe';

/**
 * 返回正在运行的 Harness 进程 `{ image, pid }[]`。
 *
 * 为什么必须检测：Electron 会 memory-map `app.asar`，应用开着时 Windows 拒绝
 * 覆盖该文件（EPERM）。这是**唯一**会静默把安装包写坏的路径，所以要前置拦截。
 */
export function harnessProcesses() {
  const result = spawnSync(
    'tasklist',
    ['/FI', `IMAGENAME eq ${IMAGE}`, '/NH', '/FO', 'CSV'],
    { encoding: 'utf8', windowsHide: true },
  );
  const found = [];
  for (const line of (result.stdout ?? '').split(/\r?\n/)) {
    const m = /^"([^"]+)","(\d+)"/.exec(line.trim());
    if (m && m[1].toLowerCase() === IMAGE.toLowerCase()) found.push({ image: m[1], pid: Number(m[2]) });
  }
  return found;
}

export function harnessRunning() {
  return harnessProcesses().length > 0;
}

/**
 * 写安装包前的强制守卫。Harness 在跑就直接退出，并给出可照做的指引。
 * `action` 只用于提示文本（例如「覆盖 app.asar」）。
 */
export function assertHarnessStopped(action) {
  const procs = harnessProcesses();
  if (procs.length === 0) return;
  process.stderr.write(
    `\n不能${action}：DeepSeek Harness 正在运行，app.asar 被占用（Windows 会以 EPERM 拒绝覆盖）。\n` +
    `运行中的进程：${procs.map((p) => `pid ${p.pid}`).join(', ')}\n\n` +
    '请关掉**所有** Harness 窗口，并右键托盘图标退出（只关窗口进程还在），然后重跑。\n\n',
  );
  process.exit(1);
}

// ————————————————————————— 补丁声明的机器可读读取 —————————————————————————
//
// 实现搬到了 `src/patchdecl.mjs`：升级检测（src/upgrade.mjs）与构建器（vendor/whale/build.mjs）
// 必须用**同一份**解析，否则「构建时按 A 理解、检测时按 B 理解」会静默错位。
// 这里只做转发，保持既有 import 路径不变。

export { readPatchDecl, unquote } from '../../src/patchdecl.mjs';

// —————————————————————————— 归档工具的位置与调用 ——————————————————————————

/** 三个 asar 工具的唯一位置，避免每个脚本各拼一次路径。 */
export const TOOLS = {
  list: path.join(PROJECT_ROOT, 'vendor', 'asar', 'list.mjs'),
  verify: path.join(PROJECT_ROOT, 'vendor', 'asar', 'verify.mjs'),
  write: path.join(PROJECT_ROOT, 'vendor', 'asar', 'write.mjs'),
};

/** 暂存包与暂存树：构建产物落在项目里的 state/ 下，不污染安装目录。 */
export const STAGED_ASAR = path.join(PROJECT_ROOT, 'state', 'staged', 'app.asar');
export const STAGED_TREE = path.join(PROJECT_ROOT, 'state', 'staged', 'tree');

/** 从 asar-verify 的问题串里还原出条目路径。 */
export function pathOfProblem(problem) {
  let m = /^(?:MISSING in new archive|UNPACKED metadata changed|ADDED): (.+)$/.exec(problem);
  if (m) return m[1];
  m = /^(?:SIZE differs|BYTES differ): (\S+)/.exec(problem);
  if (m) return m[1];
  return null;
}

/** 跑一次 asar-verify --json 并解析结果；跑不起来就 fail（不是「没问题」）。 */
export function runAsarVerify(original, target, expect) {
  const result = spawnSync(
    process.execPath,
    [TOOLS.verify, original, target, '--expect', String(expect), '--json'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true },
  );
  const text = (result.stdout ?? '').trim();
  if (text === '') {
    return fail(`asar-verify 没有输出，无法核对。stderr:\n${result.stderr ?? ''}`);
  }
  try {
    return JSON.parse(text.split(/\r?\n/).at(-1));
  } catch {
    return fail(`asar-verify 的输出不是 JSON：\n${text.slice(0, 500)}`);
  }
}

/**
 * 把「实际差异条目集合」与声明集合逐项比对。
 * 只有两边完全相等才算通过——多一条少一条都说明要么改坏了、要么声明过期了。
 */
export function compareDeclared(decl, problems) {
  const actual = new Set(problems.map(pathOfProblem).filter(Boolean));
  const declared = new Set(decl.entries.map((e) => e.replace(/\\/g, '/')));
  return {
    actual,
    declared,
    undeclared: [...actual].filter((p) => !declared.has(p)),
    missing: [...declared].filter((p) => !actual.has(p)),
  };
}

// ———————————————————————————————— 小工具 ————————————————————————————————

/** 运行一个子进程并把退出码当作硬失败。用于构建链的一步步串联。 */
export function runStep(args, { cwd = WORKSPACE } = {}) {
  const result = spawnSync(process.execPath, args, { cwd, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`步骤失败：node ${args.join(' ')}`);
  return result;
}

/** 统一的中文错误出口，避免每个脚本各写一套。 */
export function fail(message) {
  process.stderr.write(`\n${message}\n\n`);
  process.exit(1);
}
