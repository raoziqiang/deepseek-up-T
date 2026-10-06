// deepseek-up-T :: vendor/ 执行器的共享底座
//
// 这里是 src/（只读诊断）与 vendor/（会写东西的执行器）之间**唯一**的接口：
//   · 全部 DSH 路径事实来自 src/paths.mjs —— vendor 下任何脚本都不得自己拼路径，
//     也不得再用 `path.resolve(here, '..')` 推「工作区根」（这是归拢前的坏习惯：
//     脚本一旦搬目录，`..` 就指向别处，静默写错位置）。
//   · 「写安装包前必须先确认 Harness 没在跑」这条守卫集中在这里，只有一处实现。

import { spawnSync } from 'node:child_process';
import path from 'node:path';
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

/**
 * 从 `patches/*.yml` 声明里读出执行器需要的两个事实：预期差异条目数与条目路径清单。
 *
 * 这里刻意不做通用 YAML 解析，只认 patches/README.md 里那个受控子集：
 *
 *   target:
 *     archive: resources/app.asar
 *     entries:
 *       - path: renderer/welcome.html
 *         action: replace
 *   verify:
 *     expect_diff_entries: 11
 *
 * 读不到就**报错退出**，绝不静默用默认值——声明与执行器脱钩正是这类改造最容易
 * 变坏的地方。
 */
export function readPatchDecl(file) {
  const text = readText(file);
  if (text === null) throw new Error(`读不到补丁声明：${file}`);

  const idMatch = /^id:\s*(\S+)\s*$/m.exec(text);
  const expectMatch = /^\s*expect_diff_entries:\s*(\d+)\s*$/m.exec(text);
  if (!expectMatch) throw new Error(`${file} 缺少 verify.expect_diff_entries`);

  const lines = text.split(/\r?\n/);
  const indentOf = (line) => (line.match(/^\s*/) ?? [''])[0].length;
  const heads = lines.map((l, i) => (/^\s*entries:\s*$/.test(l) ? i : -1)).filter((i) => i >= 0);
  if (heads.length !== 1) {
    throw new Error(`${file} 应当恰好有一个 target.entries 列表，实际找到 ${heads.length} 个`);
  }
  const listIndent = indentOf(lines[heads[0]]);

  const entries = [];
  for (let i = heads[0] + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    if (indentOf(line) <= listIndent) break;
    const m = /^\s*-\s+path:\s*(.+?)\s*$/.exec(line);
    if (m) entries.push(m[1].replace(/^['"]|['"]$/g, '').replace(/\\/g, '/'));
  }
  if (entries.length === 0) throw new Error(`${file} 的 target.entries 为空`);

  return {
    id: idMatch ? idMatch[1] : path.basename(file, '.yml'),
    expect: Number(expectMatch[1]),
    entries,
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
