// deepseek-up-T :: 升级检测
//
// 解决的问题：Harness 升级会整体替换 `resources/app.asar`，L3 改动（patches/*.yml）
// 随之消失。如果不检测，表现是「昨天还好好的动画今天没了」，而人只会去猜。
//
// 这里把「升级发生了没有、哪些声明需要重打、重打前还有什么要修」全部算出来。
//
// 三条判据，从强到弱：
//   1. `app.asar` 的 sha256 与基线不同          ⇒ 安装包被动过（升级或被改造过）
//   2. `app.asar` 与其原版备份 sha256 相同      ⇒ 当前是**未改造的原版**，任何 L3 补丁都没生效
//   3. 声明里 `action: insert` 的条目在归档里   ⇒ 那一条补丁「看起来已应用」
//      （insert 是「归档里本来没有」的条目，它在不在是最好的存在性信号）
//
// 另外还会预检**原版素材是否过期**：`action: patch` 的 `source` 必须与归档里那一份逐字节
// 相同，否则构建会失败。与其让人跑构建时才看到失败，不如升级检测里就指出来。

import fs from 'node:fs';
import path from 'node:path';

import {
  resolvePaths, exists, statOrNull, readText, readJson, sha256, human,
} from './paths.mjs';
import { readAsarHeader, listAsarPaths, readAsarEntry } from './asar.mjs';
import { readPatchDecl, unquote } from './patchdecl.mjs';

const indentOf = (line) => (line.match(/^\s*/) ?? [''])[0].length;

/** L3 声明一定带 `target.archive`；没有它就是 L0（profile 层）声明。 */
function isArchiveDecl(text) {
  return /^\s*archive:\s*\S+/m.test(text);
}

/** 取某一行的下一层内容行（去掉空行与注释、trim）。用于抓 `config:` 块。 */
function collectBlock(lines, keyIdx) {
  const base = indentOf(lines[keyIdx]);
  const out = [];
  for (let i = keyIdx + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    if (indentOf(line) <= base) break;
    out.push(line.trim());
  }
  return out;
}

/**
 * 把真实的 `cordis.patch.yml` 解析成 `id → {name, config[]}`。
 *
 * 只认**最外层**的 `- id:` 条目。必须这么做：`config` 里也会出现 `- id:`
 * （例如 `permission` 的三档 preset 就是一组带 `id` 的映射），不做缩进过滤会
 * 把 11 个顶层条目解析成 41 个，于是「现场有没有这一条」随时可能假阳性命中。
 */
export function livePatchEntries(text) {
  const lines = (text ?? '').split(/\r?\n/);
  const hits = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^(\s*)-\s*id:\s*(\S+)\s*$/.exec(lines[i]);
    if (m) hits.push({ idx: i, indent: m[1].length, id: m[2] });
  }
  const tops = hits.filter((h) => h.indent === hits.reduce((n, x) => Math.min(n, x.indent), Infinity));
  const out = new Map();
  for (let k = 0; k < tops.length; k += 1) {
    const h = tops[k];
    const next = tops[k + 1];
    const block = lines.slice(h.idx + 1, next ? next.idx : lines.length);
    const nameM = /^\s*name:\s*(.+?)\s*$/m.exec(block.join('\n'));
    const cfgRel = block.findIndex((l) => /^\s*config:\s*$/.test(l));
    out.set(h.id, {
      id: h.id,
      name: nameM ? unquote(nameM[1]) : null,
      config: cfgRel >= 0 ? collectBlock(block, cfgRel) : [],
    });
  }
  return out;
}

/**
 * 检查一条 L0（profile 层）声明。
 *
 * L0 改动写在 `$DSH_HOME/profiles/<p>/cordis.patch.yml` 里，**升级时不会被覆盖**，
 * 所以它永远不会出现在「需要重打」的名单里。这里检查的是另一件事：声明文件与
 * 现场那份 patch **是否还一致** —— 不一致说明有人直接改了现场而没回头改声明，
 * 于是声明就不再是「权威描述」了。
 */
export function inspectL0Decl(file, raw, live) {
  const lines = raw.split(/\r?\n/);
  const idm = /^\s*-\s*id:\s*(\S+)\s*$/m.exec(raw);
  const cfgIdx = lines.findIndex((l) => /^\s*config:\s*$/.test(l));
  const declConfig = cfgIdx >= 0 ? collectBlock(lines, cfgIdx) : [];

  const base = {
    layer: 'L0',
    file,
    name: path.basename(file),
    id: idm ? idm[1] : path.basename(file, '.yml'),
    expect: null,
    entries: [],
    items: [],
    insertCount: 0,
    patchCount: 0,
    replaceCount: 0,
    missingInserts: [],
    staleSources: [],
    declConfig,
  };

  if (!idm) return { ...base, state: 'error', error: '声明里找不到 `- id: <条目>`' };

  const liveEntry = live.get(base.id);
  if (!liveEntry) return { ...base, state: 'absent', liveConfig: null };
  const same = liveEntry.config.length === declConfig.length
    && liveEntry.config.every((l, i) => l === declConfig[i]);
  return {
    ...base,
    state: same ? 'applied' : 'drift',
    liveConfig: liveEntry.config,
    liveName: liveEntry.name,
  };
}

/** 列出 `patches/*.yml` 声明文件（按文件名排序，保证输出稳定）。 */
export function listPatchDecls(P = resolvePaths()) {
  const dir = path.join(P.projectRoot, 'patches');
  if (!exists(dir)) return [];
  return fs.readdirSync(dir)
    .filter((n) => /\.ya?ml$/i.test(n))
    .sort()
    .map((n) => path.join(dir, n));
}

function bytesEqual(a, b) {
  if (a === null || b === null) return false;
  return a.length === b.length && a.equals(b);
}

/** 当前现场事实。`hash: false` 时跳过 121MB 的 sha256。 */
export async function currentFacts({ hash = true } = {}) {
  const P = resolvePaths();
  const pkg = readJson(P.profilePackageJson);
  let asarFiles = null;
  let pathSet = null;
  try {
    const { header } = readAsarHeader(P.asar);
    const paths = listAsarPaths(header);
    asarFiles = paths.length;
    pathSet = new Set(paths);
  } catch {
    // 归档读不了也要能出报告：下面的判据会显示为「无法判断」。
  }
  // 121MB 的 sha256 只算一次，主归档与备份共用。
  // `hash: false` 时**不为了「原版比对」偷偷再算一次**：否则 --no-hash 名不副实，
  // 而且报告里 sha256 显示「?」却给出「逐字节相同」的结论，自相矛盾。
  const asarHash = hash && exists(P.asar) ? await sha256(P.asar) : null;
  let backupsMatch = null;
  if (asarHash && exists(P.asarBackup)) {
    backupsMatch = asarHash === (await sha256(P.asarBackup));
  }
  return {
    home: P.home,
    profile: P.profile,
    installDir: P.installDir,
    dshVersion: readText(P.versionFile)?.trim() ?? null,
    asarBytes: statOrNull(P.asar)?.size ?? null,
    asarHash,
    asarFiles,
    asarPathSet: pathSet,
    backupsMatch,
    bundles: pkg?.dsh?.profile?.bundles ?? [],
    P,
  };
}

/**
 * 检查一条声明的状态。
 *
 * `applied` 只在「所有 insert 条目都在归档里」时给出；一条声明可能只做 replace/patch，
 * 那就没有存在性证据，返回 `unknown` 而不是猜。
 */
export function inspectDecl(decl, { pathSet, pristine, asarPath }) {
  const all = decl.items ?? [];
  const inserts = all.filter((i) => i.action === 'insert').map((i) => i.path);
  const patches = all.filter((i) => i.action === 'patch');

  const missingInserts = pathSet && inserts.length
    ? inserts.filter((p) => !pathSet.has(p))
    : [];

  let state = 'unknown';
  if (pristine === true) {
    // 归档 == 原版备份 ⇒ 绝对没被改造过，无论 insert 条目在不在。
    state = 'absent';
  } else if (inserts.length && pathSet) {
    if (missingInserts.length === 0) state = 'applied';
    else if (missingInserts.length === inserts.length) state = 'absent';
    else state = 'partial';
  }

  // 原版素材是否还等于归档里那一份。不等就意味着构建会被守卫拦下。
  const staleSources = [];
  if (asarPath && pathSet) {
    for (const item of patches) {
      if (!item.source) {
        staleSources.push({ path: item.path, source: null, why: '声明里没有 source' });
        continue;
      }
      const src = path.resolve(path.dirname(decl.file), item.source);
      const disk = exists(src) ? fs.readFileSync(src) : null;
      const inArchive = pathSet.has(item.path) ? readAsarEntry(asarPath, item.path) : null;
      if (disk === null) {
        staleSources.push({ path: item.path, source: src, why: '磁盘上找不到素材' });
      } else if (inArchive === null) {
        staleSources.push({ path: item.path, source: src, why: '归档里找不到对应条目' });
      } else if (!bytesEqual(disk, inArchive)) {
        staleSources.push({
          path: item.path,
          source: src,
          why: `素材 ${human(disk.length)} 与归档里的 ${human(inArchive.length)} 不一致`,
        });
      }
    }
  }

  return {
    layer: 'L3',
    id: decl.id,
    file: decl.file,
    name: decl.file ? path.basename(decl.file) : (decl.id ?? '(未知声明)'),
    expect: decl.expect,
    entries: decl.entries,
    insertCount: inserts.length,
    patchCount: patches.length,
    replaceCount: all.filter((i) => i.action === 'replace').length,
    state,
    missingInserts,
    staleSources,
  };
}

/**
 * 跑一次升级检测。
 * @returns 结构化结果；渲染交给 src/cli.mjs。
 */
export async function runUpgradeCheck({ hash = true } = {}) {
  const P = resolvePaths();
  const baseline = readJson(P.baselineFile);
  const cur = await currentFacts({ hash });

  const changes = {
    version: {
      from: baseline?.dshVersion ?? null,
      to: cur.dshVersion,
      changed: Boolean(baseline) && baseline.dshVersion !== cur.dshVersion,
    },
    asar: (() => {
      const fromBytes = baseline?.facts?.asarBytes ?? null;
      const toBytes = cur.asarBytes;
      const fromHash = baseline?.facts?.asarHash ?? null;
      const toHash = cur.asarHash;
      // 优先逐字节；没有 sha256（--no-hash）时退回按大小比较，并如实标注依据，
      // 免得「大小相同」被读成「内容相同」的证明。
      const basis = fromHash && toHash ? 'hash' : fromBytes !== null && toBytes !== null ? 'size' : null;
      const changed = !baseline || basis === null
        ? null
        : basis === 'hash'
          ? fromHash !== toHash
          : fromBytes !== toBytes;
      return { fromBytes, toBytes, fromHash, toHash, basis, changed };
    })(),
    bundles: {
      from: baseline?.bundles ?? [],
      to: cur.bundles,
      added: cur.bundles.filter((b) => !(baseline?.bundles ?? []).includes(b)),
      removed: (baseline?.bundles ?? []).filter((b) => !cur.bundles.includes(b)),
    },
  };

  const patches = [];
  for (const file of listPatchDecls(P)) {
    const raw = readText(file) ?? '';
    if (isArchiveDecl(raw)) {
      try {
        patches.push(inspectDecl(readPatchDecl(file), {
          pathSet: cur.asarPathSet, pristine: cur.backupsMatch, asarPath: P.asar,
        }));
      } catch (err) {
        patches.push({
          layer: 'L3',
          id: path.basename(file, '.yml'),
          file,
          name: path.basename(file),
          error: err.message,
          state: 'error',
          missingInserts: [],
          staleSources: [],
        });
      }
    } else {
      patches.push(inspectL0Decl(file, raw, livePatchEntries(readText(P.cordisPatch))));
    }
  }

  const l3 = patches.filter((p) => p.layer === 'L3');
  // 「未生效」的 L3 声明。它有两种完全不同的含义，必须分开报：
  //   · 安装包变了 ⇒ 曾经应用过、被升级覆盖了 ⇒ **需要重打**
  //   · 安装包没变 ⇒ 从来没有落盘过 ⇒ 不是重打，是还没做
  // 混在一起会把「没做过的事」说成「做过的被冲掉了」，那种报告会让人白忙一场。
  const notInEffect = l3.filter((p) => p.state === 'absent' || p.state === 'partial').map((p) => p.id);
  const archiveChanged = Boolean(changes.version.changed || changes.asar.changed);
  const needsReapply = archiveChanged ? notInEffect : [];
  const neverApplied = archiveChanged ? [] : notInEffect;
  const stale = l3.filter((p) => (p.staleSources ?? []).length > 0).map((p) => p.id);
  const l0Drift = patches.filter((p) => p.layer === 'L0' && p.state !== 'applied').map((p) => p.id);

  let verdict = 'unchanged';
  if (!baseline) verdict = 'no-baseline';
  else if (changes.version.changed) verdict = 'upgraded';
  else if (changes.asar.changed) verdict = 'asar-changed';
  else if (changes.bundles.added.length || changes.bundles.removed.length) verdict = 'profile-changed';
  else if (l0Drift.length) verdict = 'profile-drift';

  return {
    ok: verdict === 'unchanged' && l0Drift.length === 0,
    verdict,
    hasBaseline: Boolean(baseline),
    baselineFile: P.baselineFile,
    baselineCapturedAt: baseline?.capturedAt ?? null,
    current: {
      dshVersion: cur.dshVersion,
      asarBytes: cur.asarBytes,
      asarHash: cur.asarHash,
      asarFiles: cur.asarFiles,
      bundles: cur.bundles,
      installDir: cur.installDir,
      home: cur.home,
      profile: cur.profile,
    },
    pristine: cur.backupsMatch,
    changes,
    patches,
    needsReapply,
    neverApplied,
    stale,
    l0Drift,
  };
}

/** 需要落盘的补丁该跑什么（升级后的重打，与「从未落盘」的首装是同一条命令）。 */
export function reapplyPlan(ids) {
  const lines = [
    'node vendor/whale/build.mjs                 # 重新构建到 state/staged/app.asar',
    'node vendor/whale/install.mjs --yes         # 完全退出 Harness 后落盘',
    'node src/cli.mjs baseline write             # 把新基线固化下来',
  ];
  if (ids?.length) lines.unshift(`# 涉及声明：${ids.join(', ')}`);
  return lines;
}
