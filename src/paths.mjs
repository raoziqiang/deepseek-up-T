// deepseek-up-T :: 路径与环境事实解析
//
// 设计原则：本模块只做**读取**。任何写入都由 doctor/snapshot 显式调用。
// 所有路径事实集中在这里，其它模块不得自行拼接 DSH 路径。

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** deepseek-up-T 项目根目录 */
export const PROJECT_ROOT = path.resolve(HERE, '..');

/** 本机 DSH 安装目录的默认值（可用 DSH_UP_T_INSTALL_DIR 覆盖） */
export const DEFAULT_INSTALL_DIR = 'D:\\Program Files (x86)\\deepseekharness';

/** DSH_HOME：所有用户态数据的根 */
export function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
}

/** 当前 profile 名（DSH_PROFILE，默认 desktop） */
export function profileName() {
  return process.env.DSH_PROFILE || 'desktop';
}

/**
 * 解析并返回本机 DSH 的全部关键路径。
 * 不校验存在性——存在性由 doctor 负责。
 */
export function resolvePaths() {
  const home = dshHome();
  const profile = profileName();
  const profilesRoot = path.join(home, 'profiles');
  const profileDir = process.env.DSH_PROFILE_DIR || path.join(profilesRoot, profile);
  const installDir = process.env.DSH_UP_T_INSTALL_DIR || DEFAULT_INSTALL_DIR;
  const resourcesDir = path.join(installDir, 'resources');

  return {
    projectRoot: PROJECT_ROOT,
    home,
    profile,
    profilesRoot,
    profileDir,
    installDir,
    resourcesDir,

    // —— 组合层（改造的主战场）——
    cordisYml: path.join(profileDir, 'cordis.yml'),
    cordisPatch: path.join(profileDir, 'cordis.patch.yml'),
    profilePackageJson: path.join(profileDir, 'package.json'),
    pnpmWorkspace: path.join(profileDir, 'pnpm-workspace.yaml'),

    // —— 宿主包（核心插件，共享提升在 profiles/node_modules）——
    hostModules: path.join(profilesRoot, 'node_modules'),
    profileModules: path.join(profileDir, 'node_modules'),

    // —— 安装包层（最后的兜底手段）——
    asar: path.join(resourcesDir, 'app.asar'),
    asarBackup: path.join(resourcesDir, 'app.asar.whale-backup'),
    asarTmp: path.join(resourcesDir, 'app.asar.tmp'),
    asarUnpacked: path.join(resourcesDir, 'app.asar.unpacked'),
    versionFile: path.join(installDir, 'version'),

    // —— 运行时与状态 ——
    runtimesDir: path.join(home, 'dsh-runtimes'),
    bundledNode: path.join(
      home, 'dsh-runtimes', 'dsh-primary-runtime', 'dependencies', 'node', 'bin', 'node.exe',
    ),
    credentials: path.join(home, '.credentials.yaml'),
    stateDir: path.join(PROJECT_ROOT, 'state'),
    snapshotsDir: path.join(PROJECT_ROOT, 'state', 'snapshots'),
    baselineFile: path.join(PROJECT_ROOT, 'state', 'baseline.json'),
  };
}

// ————————————————————————————— 文件工具 —————————————————————————————

export function exists(p) {
  try { fs.accessSync(p); return true; } catch { return false; }
}

export function statOrNull(p) {
  try { return fs.statSync(p); } catch { return null; }
}

export function readText(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}

export function readJson(p) {
  const t = readText(p);
  if (t === null) return null;
  try { return JSON.parse(t); } catch { return null; }
}

/** 流式 sha256，避免把 121MB 的 asar 整个读进内存 */
export function sha256(p) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    const stream = fs.createReadStream(p);
    let settled = false;
    const done = (fn, v) => { if (!settled) { settled = true; fn(v); } };
    stream.on('error', (e) => done(reject, e));
    stream.on('data', (c) => h.update(c));
    stream.on('end', () => done(resolve, h.digest('hex')));
  });
}

export function sha256Short(p) {
  return sha256(p).then((h) => h.slice(0, 16));
}

/** 人类可读字节数 */
export function human(bytes) {
  if (bytes === null || bytes === undefined) return '-';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i += 1; }
  return `${n.toFixed(i === 0 ? 0 : 1)}${u[i]}`;
}

/** 相对项目根的短路径，便于报告 */
export function short(p) {
  const r = path.relative(PROJECT_ROOT, p);
  return r && !r.startsWith('..') ? r : p;
}

export { fs, path, os, crypto };
