// deepseek-up-T :: 快照与回滚
//
// 快照捕获的是「决定 DSH 行为的可编辑文本 + 安装包指纹」，不是整棵 node_modules。
// 这样一次快照只有几 KB，可以随便留，回滚也是秒级。

import fs from 'node:fs';
import path from 'node:path';

import {
  resolvePaths, exists, statOrNull, readText, sha256, human,
} from './paths.mjs';

/** 被快照覆盖的 profile 控制面文件 */
export const TRACKED_FILES = [
  { name: 'cordis.patch.yml', pick: (P) => P.cordisPatch, critical: true },
  { name: 'cordis.yml', pick: (P) => P.cordisYml, critical: true },
  { name: 'package.json', pick: (P) => P.profilePackageJson, critical: true },
  { name: 'pnpm-workspace.yaml', pick: (P) => P.pnpmWorkspace, critical: false },
];

function stamp(d = new Date()) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function safeLabel(label) {
  if (!label) return '';
  const s = String(label).trim().replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, '');
  return s ? `-${s.slice(0, 40)}` : '';
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

export async function fileFingerprint(p) {
  const st = statOrNull(p);
  if (!st) return null;
  return { bytes: st.size, sha256: await sha256(p), mtime: st.mtime.toISOString() };
}

export function listSnapshots(P = resolvePaths()) {
  if (!exists(P.snapshotsDir)) return [];
  const out = [];
  for (const name of fs.readdirSync(P.snapshotsDir)) {
    const metaPath = path.join(P.snapshotsDir, name, 'meta.json');
    const meta = (() => {
      try { return JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch { return null; }
    })();
    out.push(meta ?? { id: name, createdAt: null, label: null, incomplete: true, files: [] });
  }
  return out.sort((a, b) => String(b.id).localeCompare(String(a.id)));
}

/** 目标路径是否在某个目录**之内**（严格：等于目录本身不算） */
function isInside(child, parent) {
  if (!child || !parent) return false;
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * 把快照里记的一个文件映射回**当前现场**的目标路径。
 *
 * 刻意**不优先**用快照里记的绝对路径（`f.src`）：同一 profile 名、但 `DSH_HOME` 换过之后，
 * 那条路径指向的是旧家目录，照着写会「报成功、而现场一个字没变」。只有连名字都不认识
 * 的条目才回退到记录的路径，并且必须落在当前 profile 目录内 —— 快照是仓库里的普通文本，
 * 手改过或者来自别处的 meta.json 不该能指挥这个工具往任意位置写。
 */
function resolveDest(f, P) {
  const tracked = TRACKED_FILES.find((t) => t.name === f.name);
  if (tracked) {
    const dest = tracked.pick(P);
    const relocatedFrom = f.src && path.resolve(f.src) !== path.resolve(dest) ? f.src : null;
    return { dest, relocatedFrom, why: null };
  }
  if (!f.src) return { dest: null, relocatedFrom: null, why: '无法解析目标路径' };
  if (!isInside(f.src, P.profileDir)) {
    return {
      dest: null,
      relocatedFrom: null,
      why: `快照里记的路径不在当前 profile 目录内，拒绝写入：${f.src}`,
    };
  }
  return { dest: f.src, relocatedFrom: null, why: null };
}

export async function createSnapshot({ label = '', quiet = false } = {}, P = resolvePaths()) {
  const base = `${stamp()}${safeLabel(label)}`;
  // 同一秒里创建两份（标签也一样）不能让第二份盖掉第一份 ——「回滚前的那一份」被静默
  // 覆盖，正是最不该发生的那种丢失。
  let id = base;
  for (let n = 2; exists(path.join(P.snapshotsDir, id)); n += 1) id = `${base}-${n}`;
  const dir = path.join(P.snapshotsDir, id);
  const filesDir = path.join(dir, 'files');
  ensureDir(filesDir);

  const files = [];
  for (const t of TRACKED_FILES) {
    const src = t.pick(P);
    if (!exists(src)) {
      files.push({ name: t.name, src, present: false, critical: t.critical });
      continue;
    }
    const text = readText(src);
    fs.writeFileSync(path.join(filesDir, t.name), text ?? '', 'utf8');
    files.push({
      name: t.name,
      src,
      present: true,
      critical: t.critical,
      bytes: Buffer.byteLength(text ?? ''),
      sha256: await sha256(src),
    });
  }

  const asar = await fileFingerprint(P.asar);
  const asarBackup = await fileFingerprint(P.asarBackup);

  const meta = {
    id,
    createdAt: new Date().toISOString(),
    label: label || null,
    home: P.home,
    profile: P.profile,
    profileDir: P.profileDir,
    installDir: P.installDir,
    dshVersion: readText(P.versionFile)?.trim() ?? null,
    nodeVersion: process.version,
    files,
    asar: asar ? { path: P.asar, ...asar } : null,
    asarBackup: asarBackup ? { path: P.asarBackup, ...asarBackup } : null,
  };

  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');
  if (!quiet) {
    // 让调用方决定怎么展示；这里只返回
  }
  return { id, dir, meta };
}

export async function restoreSnapshot(id, { preSnapshot = true } = {}, P = resolvePaths()) {
  const dir = path.join(P.snapshotsDir, id);
  const metaPath = path.join(dir, 'meta.json');
  if (!exists(metaPath)) throw new Error(`快照不存在或已损坏：${id}`);

  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  if (meta.profile && meta.profile !== P.profile) {
    throw new Error(`快照属于 profile "${meta.profile}"，当前是 "${P.profile}"，拒绝跨 profile 回滚`);
  }

  let pre = null;
  if (preSnapshot) {
    pre = await createSnapshot({ label: `prerestore-${id.slice(0, 15)}` }, P);
  }

  const restored = [];
  const skipped = [];
  for (const f of meta.files ?? []) {
    const src = path.join(dir, 'files', f.name);
    if (!exists(src)) { skipped.push({ name: f.name, why: '快照内无此文件（当时就不存在）' }); continue; }
    const { dest, relocatedFrom, why } = resolveDest(f, P);
    if (!dest) { skipped.push({ name: f.name, why }); continue; }
    ensureDir(path.dirname(dest));
    fs.copyFileSync(src, dest);
    restored.push({ name: f.name, dest, relocatedFrom });
  }

  return { id, restored, skipped, preSnapshot: pre?.id ?? null, meta };
}

/** 对比某个快照与当前现场 */
export async function diffSnapshot(id, P = resolvePaths()) {
  const meta = JSON.parse(fs.readFileSync(path.join(P.snapshotsDir, id, 'meta.json'), 'utf8'));
  const rows = [];
  for (const f of meta.files ?? []) {
    const { dest } = resolveDest(f, P);
    if (!dest || !exists(dest)) {
      rows.push({ name: f.name, status: f.present ? '现在缺失' : '当时缺失', changed: f.present });
      continue;
    }
    if (!f.present) {
      // 快照拍下时这个文件还不存在，之后才出现 —— **回滚不会动它**（快照里没有它的内容）。
      // 这里必须与 restoreSnapshot 说同一句话：那边把它算进 skipped。
      rows.push({ name: f.name, status: '快照之后才出现（回滚不会动它）', changed: true });
      continue;
    }
    const nowHash = await sha256(dest);
    const changed = f.sha256 ? nowHash !== f.sha256 : true;
    rows.push({
      name: f.name,
      status: changed ? '已改动' : '一致',
      changed,
      was: f.sha256?.slice(0, 12) ?? '-',
      now: nowHash.slice(0, 12),
      bytesNow: statOrNull(dest)?.size ?? 0,
    });
  }
  const asarNow = await fileFingerprint(P.asar);
  let asarChanged = null;
  if (meta.asar?.sha256 && asarNow?.sha256) asarChanged = meta.asar.sha256 !== asarNow.sha256;
  return { id, rows, asarChanged, meta };
}

// ─────────────────────────── 保留策略（快照清理）───────────────────────────
//
// 快照一份只有几 KB，但「可以随便留」不等于「应该无限留」：`snapshot restore` 的选择
// 列表会越来越长，而真正要回滚的那一份会被埋在几十条中间。所以给一个**默认预演**的
// 清理器：先算清楚保留谁、删谁，再由人加 `--yes` 真删。

/**
 * 极简 glob：只实现 `*`（任意长度）与 `?`（单个字符），其余字符一律按字面量。
 * 刻意不引入依赖——`src/` 的全部价值就在于「DSH 装坏了也能跑」。
 */
export function globToRe(pattern) {
  let out = '';
  for (const ch of String(pattern)) {
    if (ch === '*') out += '.*';
    else if (ch === '?') out += '.';
    else out += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}

/**
 * 只做计划，不碰磁盘。保留规则（与删除无关，纯加法）：
 *   1. 最新的 `keep` 份；
 *   2. 任何 id 匹配 `keepMatch` 里任一 glob 的（例如 `*-M0-*`、`*改动前*`）。
 * 其余全部进 `drop`。
 */
export function planPrune({ keep = 10, keepMatch = [] } = {}, P = resolvePaths()) {
  const all = listSnapshots(P); // listSnapshots 已按 id 降序 = 新在前
  const matchers = keepMatch.map((pat) => ({ pat, re: globToRe(pat) }));
  const keepRows = [];
  const dropRows = [];
  all.forEach((s, i) => {
    if (i < keep) { keepRows.push({ ...s, why: `最近 ${keep} 份之内（第 ${i + 1} 新）` }); return; }
    const hit = matchers.find((m) => m.re.test(String(s.id)));
    if (hit) { keepRows.push({ ...s, why: `匹配保留规则「${hit.pat}」` }); return; }
    dropRows.push({ ...s, why: `不在最近 ${keep} 份内，也不匹配任何保留规则` });
  });
  return { total: all.length, keepN: keep, keepMatch, keep: keepRows, drop: dropRows };
}

/**
 * 真删。每个 id 都要过三道检查才允许 `rmSync`：
 *   1. 必须是一个**纯目录名**（不含 `/`、`\`，不是 `.` / `..`）；
 *   2. `path.resolve` 之后必须仍在快照目录**里面**（防止 `..` 逃逸）；
 *   3. 里面必须有 `meta.json`（确认这真的是一个快照，而不是别的什么东西）。
 * 被拒的进 `refused`，不抛异常——调用方要能一次性看到全部结果。
 */
export function deleteSnapshots(ids, P = resolvePaths()) {
  const root = path.resolve(P.snapshotsDir);
  const removed = [];
  const refused = [];
  for (const raw of ids) {
    const id = String(raw ?? '');
    if (!id || id === '.' || id === '..' || /[\\/]/.test(id)) {
      refused.push({ id, why: '不是一个纯目录名（含路径分隔符或为相对路径片段）' });
      continue;
    }
    const dir = path.resolve(path.join(root, id));
    if (dir !== path.join(root, id) || !dir.startsWith(root + path.sep)) {
      refused.push({ id, why: `解析后不在快照目录内：${dir}` });
      continue;
    }
    if (!exists(dir) || !exists(path.join(dir, 'meta.json'))) {
      refused.push({ id, why: '目录不存在，或不是快照（没有 meta.json）' });
      continue;
    }
    fs.rmSync(dir, { recursive: true, force: false });
    removed.push({ id, dir });
  }
  return { removed, refused, root };
}

export { human };
