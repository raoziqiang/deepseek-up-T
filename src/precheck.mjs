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

/**
 * 把 stderr 分类成「真问题」「提醒」与「都不是的其它输出」。
 *
 * 第三桶是刻意的：原先不匹配前两条规则的行**被直接丢掉**，于是一句没被认出来的
 * 报错（比如换了措辞、或者来自 Node 自身的告警）在结论里连痕迹都没有。
 * 它不参与 ok 判定（真实的一次成功预检 stderr 是 **0 字节**，所以「有其它输出」
 * 很可疑但不足以判失败），但要显示出来。
 */
export function analyzeStderr(text) {
  const problems = [];
  const notes = [];
  const other = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (/skipping profile bundle/.test(line)) problems.push({ kind: 'bundle-skip', text: line });
    else if (/patch: entry .* not found/.test(line)) problems.push({ kind: 'patch-miss', text: line });
    else if (/^dsh: error:/.test(line)) problems.push({ kind: 'error', text: line });
    else if (/^dsh: warning:/.test(line)) notes.push(line);
    else other.push(line);
  }
  return { problems, notes, other };
}

/**
 * 一次跑完之后的判据。**抽成函数是因为它以前是内联的，于是没法在离线测试里问
 * 「什么都没 dump 出来时它说什么」** —— 而它的答案曾经是「通过」。
 *
 * 三件事必须同时成立才算通过：
 *   1. 退出码 0；
 *   2. stderr 里没有真问题（`analyzeStderr` 那一桶）；
 *   3. **dump 里至少有一个顶层条目** —— 否则这次预检什么都没验到，
 *      「一个条目都没有」给出的绿灯是最坏的一种假答案。
 */
export function judgeRun({ status, stdout, problems, mode = 'dump-config' }) {
  const entries = splitDumpEntries(stdout ?? '').order.length;
  const emptyDump = entries === 0;
  return {
    ok: status === 0 && !emptyDump && problems.length === 0,
    entries,
    emptyDump,
    emptyDumpText: emptyDump
      ? `dump 里一个顶层条目都没有（模式 ${mode}，stdout ${Buffer.byteLength(stdout ?? '', 'utf8')} 字节）：`
        + '这次预检什么都没验到，不能算通过。'
      : null,
  };
}

/**
 * 落 dump 基线。**只有这一次跑出了可用结果才更新基线**；否则连 `.prev` 都不动，
 * 把这次的原始输出写到 `<dumpPath>.failed`。
 *
 * 为什么：原先这三行是无条件执行的，于是一次失败（或空输出）会把上一条好基线
 * 冲成空文件，而且 `.prev` 也被覆盖 —— 下一次预检就拿着一份空基线做对比，
 * 报出「201 个条目全部新增」。**一个诊断工具把自己的参照点弄丢了**，
 * 比它不报错还糟。
 *
 * `usable` 与 `ok` 是两件事：一次跑出完整 dump、但 stderr 里有 `patch: entry not
 * found` 的预检，结论是**不通过**，而它的 dump 仍然是对当前组合的忠实记录，
 * 该进基线。（不可用的是「没 dump 出来」。）
 */
export function settleDumpFiles({ dumpPath, stdout, usable }) {
  const prevPath = `${dumpPath}.prev`;
  const failedPath = `${dumpPath}.failed`;
  fs.mkdirSync(path.dirname(dumpPath), { recursive: true });
  if (!usable) {
    fs.writeFileSync(failedPath, stdout ?? '', 'utf8');
    return { saved: false, dumpPath, prevPath, failedPath, keptBaseline: exists(dumpPath), before: null };
  }
  const before = exists(dumpPath) ? fs.readFileSync(dumpPath, 'utf8') : null;
  if (before !== null) fs.writeFileSync(prevPath, before, 'utf8');
  fs.writeFileSync(dumpPath, stdout, 'utf8');
  // 上一次的失败残留会让人以为这次也没成，跑成功就顺手清掉
  if (exists(failedPath)) fs.rmSync(failedPath, { force: true });
  return { saved: true, dumpPath, prevPath, failedPath, keptBaseline: false, before };
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

/**
 * 逐条目比较两次 dump，返回 added / removed / changed / reordered。
 *
 * 行差异按**多重集**算（数一遍每行出现几次），不是按集合：真实 dump 里
 * 201 个条目中有 7 个内部就有重复行（`preset-standard` / `preset-ptc` 各有三行
 * `config:`，`permission` 有两行 `approval: ask`）。按集合比的话，
 * 「三行 `config:` 变成两行」会报成 `changed: [{ removed: [], added: [] }]` ——
 * 也就是**说它改了、却一行都列不出来**。
 *
 * 顺序也要报：条目顺序就是 cordis 的装载顺序，两个插件对调而配置一字未变时，
 * 集合比较的结果是「完全一致」。公共条目之间的相对顺序变了就记 `reordered`。
 */
export function diffDumps(beforeText, afterText) {
  const a = splitDumpEntries(beforeText);
  const b = splitDumpEntries(afterText);
  const added = b.order.filter((id) => !a.map.has(id));
  const removed = a.order.filter((id) => !b.map.has(id));
  const changed = b.order
    .filter((id) => a.map.has(id))
    .map((id) => ({ id, ...diffLines(a.map.get(id), b.map.get(id)) }))
    .filter((c) => c.removed.length || c.added.length);

  const aCommon = a.order.filter((id) => b.map.has(id));
  const bCommon = b.order.filter((id) => a.map.has(id));
  const reorderedIds = aCommon.filter((id, i) => bCommon[i] !== id);

  return {
    added,
    removed,
    changed,
    reordered: reorderedIds.length > 0,
    reorderedIds,
    count: added.length + removed.length + changed.length + (reorderedIds.length ? 1 : 0),
  };
}

/** 按出现次数算行差异：返回「少了的行」与「多了的行」（各带重数）。 */
function diffLines(aText, bText) {
  const count = (text) => {
    const m = new Map();
    for (const l of text.split('\n')) m.set(l, (m.get(l) ?? 0) + 1);
    return m;
  };
  const a = count(aText);
  const b = count(bText);
  const removed = [];
  const added = [];
  for (const [line, n] of a) for (let i = n - (b.get(line) ?? 0); i > 0; i -= 1) removed.push(line);
  for (const [line, n] of b) for (let i = n - (a.get(line) ?? 0); i > 0; i -= 1) added.push(line);
  return { removed, added };
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
  const { problems, notes, other } = analyzeStderr(run.stderr);

  const judged = judgeRun({ status: run.status, stdout: run.stdout, problems, mode });
  if (judged.emptyDump) problems.push({ kind: 'empty-dump', text: judged.emptyDumpText });

  const dumpPath = path.join(P.stateDir, `probe-dump${mode === 'dump-default-config' ? '-default' : ''}.txt`);
  // 基线记录的是「上一次真的 dump 出来的组合」，与这次是否通过无关（见 settleDumpFiles）
  const settled = settleDumpFiles({
    dumpPath,
    stdout: run.stdout,
    usable: run.status === 0 && !judged.emptyDump,
  });
  const errPath = `${dumpPath}.err`;
  fs.writeFileSync(errPath, run.stderr, 'utf8');

  const diff = settled.saved && settled.before !== null ? diffDumps(settled.before, run.stdout) : null;

  return {
    ok: judged.ok,
    entries: judged.entries,
    probe,
    run,
    problems,
    notes,
    other,
    diff,
    saved: settled.saved,
    keptBaseline: settled.keptBaseline,
    dumpPath,
    prevPath: settled.prevPath,
    failedPath: settled.failedPath,
    errPath,
    before: settled.before,
  };
}
