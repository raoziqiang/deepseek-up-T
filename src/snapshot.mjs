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

export async function createSnapshot({ label = '', quiet = false } = {}) {
  const P = resolvePaths();
  const id = `${stamp()}${safeLabel(label)}`;
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

export async function restoreSnapshot(id, { preSnapshot = true } = {}) {
  const P = resolvePaths();
  const dir = path.join(P.snapshotsDir, id);
  const metaPath = path.join(dir, 'meta.json');
  if (!exists(metaPath)) throw new Error(`快照不存在或已损坏：${id}`);

  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  if (meta.profile && meta.profile !== P.profile) {
    throw new Error(`快照属于 profile "${meta.profile}"，当前是 "${P.profile}"，拒绝跨 profile 回滚`);
  }

  let pre = null;
  if (preSnapshot) {
    pre = await createSnapshot({ label: `prerestore-${id.slice(0, 15)}` });
  }

  const restored = [];
  const skipped = [];
  for (const f of meta.files ?? []) {
    const src = path.join(dir, 'files', f.name);
    if (!exists(src)) { skipped.push({ name: f.name, why: '快照内无此文件（当时就不存在）' }); continue; }
    const dest = f.src || TRACKED_FILES.find((t) => t.name === f.name)?.pick(P);
    if (!dest) { skipped.push({ name: f.name, why: '无法解析目标路径' }); continue; }
    ensureDir(path.dirname(dest));
    fs.copyFileSync(src, dest);
    restored.push({ name: f.name, dest });
  }

  return { id, restored, skipped, preSnapshot: pre?.id ?? null, meta };
}

/** 对比某个快照与当前现场 */
export async function diffSnapshot(id) {
  const P = resolvePaths();
  const meta = JSON.parse(fs.readFileSync(path.join(P.snapshotsDir, id, 'meta.json'), 'utf8'));
  const rows = [];
  for (const f of meta.files ?? []) {
    const dest = f.src || TRACKED_FILES.find((t) => t.name === f.name)?.pick(P);
    if (!dest || !exists(dest)) {
      rows.push({ name: f.name, status: f.present ? '现在缺失' : '当时缺失', changed: f.present });
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

export { human };
