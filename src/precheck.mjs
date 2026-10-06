// deepseek-up-T :: 组合预检（probe）
//
// 为什么需要它
// ------------
// desktop profile 被 Electron 应用独占，CLI 直接拒绝 dump / boot：
//     $ dsh --profile desktop --dump-config
//     error: profile "desktop" is managed exclusively by the Electron application
// 守卫在 app.asar 内 `@deepseek-ai/dsh/lib/bin.js` 的 `rejectElectronProfile()`：
//     function rejectElectronProfile(program, profile) {
//       if (profile.toLowerCase() === "desktop") program.error(...);
//     }
// 于是「改完 cordis.patch.yml 到底会不会炸」这件事，用官方 CLI 无法预检。
//
// 做法
// ----
// 在项目目录里搭一个**完全隔离的探针 DSH_HOME**，把当前 profile 的
// cordis.yml / cordis.patch.yml / package.json 复制进去，profile 改名为 `_probe`
// （绕开 desktop 守卫），再用安装版 Electron 以 Node 身份执行 **asar 内那份**
// `@deepseek-ai/dsh/lib/bin.js --dump-config`。
// 真实 profile 全程只读，$DSH_HOME 不被写入。
//
// 三个必须踩准的点
// ----------------
//  1) Electron 是 GUI 子系统 exe：PowerShell 用 `&` 调用会立刻返回、拿不到退出码
//     也拿不到输出，必须 Start-Process -Wait + Redirect*（等价物见 dumpWithElectron）。
//     本模块用 child_process.spawnSync 直接读管道，实测可用。
//  2) 第三方 bundle 住在 profile/node_modules，共享包住在 profiles/node_modules。
//     探针必须用 junction 指过去，否则会刷 `skipping profile bundle "..."`，
//     且 patch 里对应条目报 `entry "..." not found`。
//  3) `resolveBundleDir` 是**安装锚点优先**（app-boot 的显式契约）：
//     in-box 包——包括只存在于 app.asar 的 `@deepseek-ai/dsh-experimental-*`——
//     从归档内解析，探针无需复制任何 in-box 包。
//
// 产出即「权威组合结果」：这是运行中应用真正会看到的清单，比读源码仓库可靠，
// 因为 asar / junction 构建树 / 源码仓库三者版本可能并不相同。

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { resolvePaths, exists } from './paths.mjs';

/** 探针 profile 名：只要不是 desktop 就能绕开独占守卫。 */
export const PROBE_PROFILE = '_probe';

/** 探针家要复制的组合层文件。 */
const COPY_FILES = ['cordis.yml', 'cordis.patch.yml', 'package.json', 'pnpm-workspace.yaml'];

/** 安装目录里挑可执行文件：Electron 主程序是本目录下最大的 .exe。 */
function findElectronBinary(installDir) {
  if (process.env.DSH_UP_T_ELECTRON) return process.env.DSH_UP_T_ELECTRON;
  const cands = fs.readdirSync(installDir)
    .filter((f) => f.toLowerCase().endsWith('.exe'))
    .map((f) => path.join(installDir, f))
    .map((p) => ({ p, size: fs.statSync(p).size }))
    .sort((a, b) => b.size - a.size);
  if (!cands.length) throw new Error(`在 ${installDir} 里找不到任何 .exe`);
  return cands[0].p;
}

/** 建 junction（Windows 下不需要管理员权限，symlink 才需要）。 */
function ensureJunction(linkPath, target) {
  if (exists(linkPath)) return 'exists';
  if (!exists(target)) return 'missing-target';
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  fs.symlinkSync(target, linkPath, 'junction');
  return 'created';
}

/**
 * 搭好隔离探针家。返回路径与 junction 结果。
 * `fresh: true` 会先整个删掉重建（junction 会连同链接一起删，不会删到真实目录内容）。
 *
 * `profilePackageJson`：用**候选** package.json 顶替真实 profile 的那一份。
 * 为什么需要：`dsh.profile.bundles` 只存在于 package.json，所以「再加一个 bundle 会不会炸」
 * 这件事，如果只能复制真实文件，就永远无法在落盘前预检 —— 只能先改真实 profile 再祈祷。
 * 给了这个覆盖项之后，预检可以跑「候选清单 + 真实 cordis.patch.yml」的组合。
 */
export function prepareProbeHome({ fresh = false, profilePackageJson = null } = {}) {
  const P = resolvePaths();
  const probeHome = path.join(P.stateDir, 'probe-home');
  const probeDir = path.join(probeHome, 'profiles', PROBE_PROFILE);

  if (fresh && exists(probeHome)) fs.rmSync(probeHome, { recursive: true, force: true });
  fs.mkdirSync(probeDir, { recursive: true });

  const override = profilePackageJson ? path.resolve(profilePackageJson) : null;
  if (override && !exists(override)) {
    throw new Error(`--profile-json 指向的文件不存在：${override}`);
  }

  const copied = [];
  const sources = [];
  for (const f of COPY_FILES) {
    const src = (f === 'package.json' && override) ? override : path.join(P.profileDir, f);
    if (!exists(src)) continue;
    fs.copyFileSync(src, path.join(probeDir, f));
    copied.push(f);
    sources.push({ file: f, from: src });
  }

  const links = [
    { name: 'profile/node_modules', link: path.join(probeDir, 'node_modules'), target: P.profileModules },
    { name: 'profiles/node_modules', link: path.join(probeHome, 'profiles', 'node_modules'), target: P.hostModules },
  ].map((l) => ({ ...l, result: ensureJunction(l.link, l.target) }));

  return { P, probeHome, probeDir, copied, sources, override, links };
}

/** 用安装版 Electron 以 Node 身份跑 asar 内的 dsh CLI。 */
export function dumpWithElectron({ mode = 'dump-config', patches = [], probeHome, installDir, timeoutMs = 300000 }) {
  const bin = path.join(
    resolvePaths().asar, 'dsh', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js',
  );
  const exe = findElectronBinary(installDir);
  const args = [bin, '--profile', PROBE_PROFILE];
  for (const p of patches) args.push('--patch', p);
  args.push(mode === 'dump-default-config' ? '--dump-default-config' : '--dump-config');

  const res = spawnSync(exe, args, {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', DSH_HOME: probeHome },
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    timeout: timeoutMs,
    windowsHide: true,
  });

  if (res.error) throw res.error;
  return { exe, bin, args, status: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

/** 把 stderr 分类成「真问题」与「提醒」。 */
export function analyzeStderr(text) {
  const problems = [];
  const notes = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (/skipping profile bundle/.test(line)) problems.push({ kind: 'bundle-skip', text: line });
    else if (/patch: entry .* not found/.test(line)) problems.push({ kind: 'patch-miss', text: line });
    else if (/^dsh: error:/.test(line)) problems.push({ kind: 'error', text: line });
    else if (/^dsh: warning:/.test(line)) notes.push(line);
  }
  return { problems, notes };
}

/**
 * 把 dump 拆成 `id -> 该条目的原始文本`。只认顶格的 `- id:`，
 * 所以嵌套的模型列表（缩进的 `- id:`）不会被误当成顶层条目。
 *
 * dump 里的 `# == <bundle> ...` 是**层边界标记**，而且其中一行会带上探针家的
 * 绝对路径（每次预检都变），既不属于任何条目又会污染 diff —— 一律剔除；
 * 同理剔除空行。
 */
export function splitDumpEntries(text) {
  const map = new Map();
  const order = [];
  let id = null;
  let buf = [];
  const flush = () => {
    if (id === null) return;
    map.set(id, buf.join('\n').trimEnd());
    order.push(id);
  };
  for (const line of text.split('\n')) {
    if (line.startsWith('# == ')) continue;
    const m = /^- id: (.+?)\s*$/.exec(line);
    if (m) { flush(); id = m[1].replace(/^['"]|['"]$/g, ''); buf = [line]; continue; }
    if (id !== null) buf.push(line);
  }
  flush();
  return { map, order };
}

/** 逐条目比较两次 dump，返回 added / removed / changed。 */
export function diffDumps(beforeText, afterText) {
  const a = splitDumpEntries(beforeText);
  const b = splitDumpEntries(afterText);
  const added = b.order.filter((id) => !a.map.has(id));
  const removed = a.order.filter((id) => !b.map.has(id));
  const changed = b.order
    .filter((id) => a.map.has(id) && a.map.get(id) !== b.map.get(id))
    .map((id) => ({
      id,
      removed: a.map.get(id).split('\n').filter((l) => !b.map.get(id).split('\n').includes(l)),
      added: b.map.get(id).split('\n').filter((l) => !a.map.get(id).split('\n').includes(l)),
    }));
  return { added, removed, changed, count: added.length + removed.length + changed.length };
}

/**
 * 端到端预检：搭探针 → 跑 dump → 分类问题 → 与上一次 dump 比对。
 * 不抛业务错误；调用方按 `ok` 决定退出码。
 */
export function runPrecheck({
  patches = [], mode = 'dump-config', fresh = false, timeoutMs, profilePackageJson = null,
} = {}) {
  const P = resolvePaths();
  const probe = prepareProbeHome({ fresh, profilePackageJson });
  const run = dumpWithElectron({ mode, patches, probeHome: probe.probeHome, installDir: P.installDir, timeoutMs });
  const { problems, notes } = analyzeStderr(run.stderr);

  const dumpPath = path.join(P.stateDir, `probe-dump${mode === 'dump-default-config' ? '-default' : ''}.txt`);
  const prevPath = `${dumpPath}.prev`;
  const before = exists(dumpPath) ? fs.readFileSync(dumpPath, 'utf8') : null;
  fs.mkdirSync(P.stateDir, { recursive: true });
  if (before !== null) fs.writeFileSync(prevPath, before, 'utf8');
  fs.writeFileSync(dumpPath, run.stdout, 'utf8');
  const errPath = `${dumpPath}.err`;
  fs.writeFileSync(errPath, run.stderr, 'utf8');

  const diff = before === null ? null : diffDumps(before, run.stdout);
  const ok = run.status === 0 && problems.length === 0;

  return { ok, probe, run, problems, notes, diff, dumpPath, prevPath, errPath, before };
}
