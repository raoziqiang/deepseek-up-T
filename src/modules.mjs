// deepseek-up-T :: 模块宿主
//
// L0/L1 的 cordis 组合层没有 watcher（见 docs/01-environment.md）。热路径放在已经挂上的
// dsh-up-t 插件里：读项目根的 up-t.config.yml，按目录加载 modules/<name>/module.mjs。
// 一个模块抛错只记失败，不拖垮胶囊与路由。零 npm 依赖。

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { PROJECT_ROOT } from './paths.mjs';

export const CONFIG_NAME = 'up-t.config.yml';
export const MODULES_DIRNAME = 'modules';
export const DEFAULT_POLL_MS = 1000;

const BOOL_TRUE = new Set(['true', 'yes', 'on', '1']);
const BOOL_FALSE = new Set(['false', 'no', 'off', '0']);

/** 去掉行内注释与包裹引号。 */
export function unquoteScalar(value) {
  const withoutComment = String(value).replace(/\s+#.*$/, '').trim();
  return withoutComment.replace(/^['"]|['"]$/g, '');
}

function parseBool(raw, where) {
  const v = unquoteScalar(raw).toLowerCase();
  if (BOOL_TRUE.has(v)) return true;
  if (BOOL_FALSE.has(v)) return false;
  throw new Error(`${where}: 期望布尔值，实际 ${JSON.stringify(raw)}`);
}

/**
 * 只认 up-t.config.yml 那一小撮形状（零依赖，不做通用 YAML）。
 *
 *   modules:
 *     memory: true
 *   memory: {}
 *
 * @returns {{ modules: Record<string, boolean>, configs: Record<string, Record<string, string>> }}
 */
export function parseUpTConfig(text, label = CONFIG_NAME) {
  if (typeof text !== 'string') throw new Error(`${label}: 内容不是字符串`);
  const lines = text.split(/\r?\n/);
  const indentOf = (line) => (line.match(/^\s*/) ?? [''])[0].length;

  /** @type {Record<string, boolean>} */
  const modules = {};
  /** @type {Record<string, Record<string, string>>} */
  const configs = {};
  /** @type {Set<string>} */
  const topKeys = new Set();

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) { i += 1; continue; }
    if (indentOf(line) !== 0) {
      throw new Error(`${label}:${i + 1}: 顶层缩进非法：${trimmed}`);
    }

    const mapHead = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(trimmed);
    if (!mapHead) throw new Error(`${label}:${i + 1}: 无法解析：${trimmed}`);
    const key = mapHead[1];
    const rest = mapHead[2].trim();
    topKeys.add(key);
    const keyLine = i + 1;
    i += 1;

    if (key === 'modules') {
      if (rest !== '' && rest !== '{}' && !rest.startsWith('#')) {
        throw new Error(`${label}:${keyLine}: modules 必须是映射，不能写成标量`);
      }
      while (i < lines.length) {
        const child = lines[i];
        const ct = child.trim();
        if (ct === '' || ct.startsWith('#')) { i += 1; continue; }
        if (indentOf(child) === 0) break;
        if (indentOf(child) !== 2) {
          throw new Error(`${label}:${i + 1}: modules 子项必须两空格缩进`);
        }
        const m = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.+)$/.exec(ct);
        if (!m) throw new Error(`${label}:${i + 1}: modules 子项无法解析：${ct}`);
        modules[m[1]] = parseBool(m[2], `${label} modules.${m[1]}`);
        i += 1;
      }
      continue;
    }

    // 模块专属配置块：`memory: {}` 或带叶子的映射。
    if (rest === '{}' || rest === '' || rest.startsWith('#')) {
      configs[key] = {};
      while (i < lines.length) {
        const child = lines[i];
        const ct = child.trim();
        if (ct === '' || ct.startsWith('#')) { i += 1; continue; }
        if (indentOf(child) === 0) break;
        if (indentOf(child) !== 2) {
          throw new Error(`${label}:${i + 1}: ${key} 子项必须两空格缩进`);
        }
        const m = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(ct);
        if (!m) throw new Error(`${label}:${i + 1}: ${key} 子项无法解析：${ct}`);
        configs[key][m[1]] = unquoteScalar(m[2]);
        i += 1;
      }
      continue;
    }

    throw new Error(`${label}:${keyLine}: 未知顶层写法 ${key}: ${rest}`);
  }

  if (!topKeys.has('modules')) {
    throw new Error(`${label}: 缺少必填键 modules`);
  }
  for (const key of topKeys) {
    if (key === 'modules') continue;
    if (!(key in modules)) {
      throw new Error(`${label}: 未知键 ${key}（只允许 modules 与 modules 下列出的模块名）`);
    }
  }
  for (const name of Object.keys(modules)) {
    if (!(name in configs)) configs[name] = {};
  }
  return { modules, configs };
}

export function readUpTConfig(projectRoot = PROJECT_ROOT) {
  const file = path.join(projectRoot, CONFIG_NAME);
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    throw new Error(`读不到 ${file}：${err?.message ?? err}`);
  }
  return { file, ...parseUpTConfig(text, file) };
}

function moduleEntryPath(projectRoot, name) {
  return path.join(projectRoot, MODULES_DIRNAME, name, 'module.mjs');
}

function mtimeOrNull(file) {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return null;
  }
}

function makeLog(name, sink) {
  return (level, message, extra) => {
    const entry = {
      at: new Date().toISOString(),
      module: name,
      level: String(level ?? 'info'),
      message: String(message ?? ''),
      ...(extra && typeof extra === 'object' ? { extra } : {}),
    };
    if (typeof sink === 'function') sink(entry);
  };
}

/**
 * @param {{
 *   projectRoot?: string,
 *   pollMs?: number,
 *   onStatus?: (status: object) => void,
 *   onLog?: (entry: object) => void,
 * }} [opts]
 */
export function createModuleHost(opts = {}) {
  const projectRoot = opts.projectRoot ?? PROJECT_ROOT;
  const pollMs = Number.isFinite(opts.pollMs) ? opts.pollMs : DEFAULT_POLL_MS;
  const onStatus = typeof opts.onStatus === 'function' ? opts.onStatus : null;
  const onLog = typeof opts.onLog === 'function' ? opts.onLog : null;

  /** @type {Map<string, { instance: any, mtimeMs: number|null, status: string, error: string|null, at: string }>} */
  const running = new Map();
  let configMtime = null;
  let timer = null;
  let stopped = false;
  let lastStatus = { ok: true, modules: {} };

  function emitStatus() {
    const modules = {};
    for (const [name, slot] of running) {
      modules[name] = {
        status: slot.status,
        error: slot.error,
        at: slot.at,
        entry: moduleEntryPath(projectRoot, name),
      };
    }
    lastStatus = { ok: Object.values(modules).every((m) => m.status !== 'failed'), modules };
    if (onStatus) onStatus(lastStatus);
    return lastStatus;
  }

  async function loadInstance(name, config) {
    const entry = moduleEntryPath(projectRoot, name);
    const mt = mtimeOrNull(entry);
    if (mt === null) {
      throw new Error(`缺少入口 ${entry}`);
    }
    const url = `${pathToFileURL(entry).href}?t=${mt}`;
    const mod = await import(url);
    const instance = mod.default && typeof mod.default === 'object' ? mod.default : mod;
    const exportName = instance.name ?? mod.name;
    if (exportName && exportName !== name) {
      throw new Error(`${entry} 导出 name=${JSON.stringify(exportName)}，与目录名 ${name} 不一致`);
    }
    if (typeof instance.start !== 'function') {
      throw new Error(`${entry} 缺少 start(ctx)`);
    }
    if (typeof instance.stop !== 'function') {
      throw new Error(`${entry} 缺少 stop()`);
    }
    const ctx = {
      projectRoot,
      config: config && typeof config === 'object' ? { ...config } : {},
      log: makeLog(name, onLog),
    };
    await instance.start(ctx);
    return { instance, mtimeMs: mt, ctx };
  }

  async function stopOne(name) {
    const slot = running.get(name);
    if (!slot) return;
    try {
      if (slot.instance && typeof slot.instance.stop === 'function') {
        await slot.instance.stop();
      }
    } catch (err) {
      slot.status = 'failed';
      slot.error = `stop 失败：${err?.message ?? err}`;
      slot.at = new Date().toISOString();
      return;
    }
    running.delete(name);
  }

  async function startOne(name, config) {
    const at = new Date().toISOString();
    try {
      const { instance, mtimeMs, ctx } = await loadInstance(name, config);
      running.set(name, {
        instance,
        mtimeMs,
        ctx,
        status: 'started',
        error: null,
        at,
      });
    } catch (err) {
      running.set(name, {
        instance: null,
        mtimeMs: mtimeOrNull(moduleEntryPath(projectRoot, name)),
        ctx: null,
        status: 'failed',
        error: String(err?.message ?? err),
        at,
      });
    }
  }

  async function reloadOne(name, config) {
    const slot = running.get(name);
    if (slot?.instance && typeof slot.instance.reload === 'function') {
      try {
        const entry = moduleEntryPath(projectRoot, name);
        const mt = mtimeOrNull(entry);
        const url = `${pathToFileURL(entry).href}?t=${mt}`;
        const mod = await import(url);
        const instance = mod.default && typeof mod.default === 'object' ? mod.default : mod;
        const ctx = {
          projectRoot,
          config: config && typeof config === 'object' ? { ...config } : {},
          log: makeLog(name, onLog),
        };
        await instance.reload(ctx);
        running.set(name, {
          instance,
          mtimeMs: mt,
          ctx,
          status: 'started',
          error: null,
          at: new Date().toISOString(),
        });
        return;
      } catch (err) {
        running.set(name, {
          instance: slot.instance,
          mtimeMs: slot.mtimeMs,
          ctx: slot.ctx,
          status: 'failed',
          error: `reload 失败：${err?.message ?? err}`,
          at: new Date().toISOString(),
        });
        return;
      }
    }
    await stopOne(name);
    await startOne(name, config);
  }

  async function applyConfig(cfg) {
    const wanted = Object.entries(cfg.modules)
      .filter(([, on]) => on)
      .map(([name]) => name)
      .sort();
    const wantedSet = new Set(wanted);

    for (const name of [...running.keys()]) {
      if (!wantedSet.has(name)) await stopOne(name);
    }
    for (const name of wanted) {
      const slot = running.get(name);
      const entry = moduleEntryPath(projectRoot, name);
      const mt = mtimeOrNull(entry);
      if (!slot) {
        await startOne(name, cfg.configs[name]);
        continue;
      }
      if (slot.mtimeMs !== mt) {
        await reloadOne(name, cfg.configs[name]);
      }
    }
    return emitStatus();
  }

  async function tick() {
    if (stopped) return;
    const configFile = path.join(projectRoot, CONFIG_NAME);
    const mt = mtimeOrNull(configFile);
    let cfg;
    try {
      cfg = readUpTConfig(projectRoot);
    } catch (err) {
      lastStatus = {
        ok: false,
        modules: {},
        error: String(err?.message ?? err),
      };
      if (onStatus) onStatus(lastStatus);
      return lastStatus;
    }

    const configChanged = configMtime !== mt;
    configMtime = mt;

    if (configChanged) {
      return applyConfig(cfg);
    }

    // 配置没变：只看已启用模块入口的 mtime。
    for (const name of Object.keys(cfg.modules).filter((n) => cfg.modules[n])) {
      const slot = running.get(name);
      const mtEntry = mtimeOrNull(moduleEntryPath(projectRoot, name));
      if (!slot) {
        await startOne(name, cfg.configs[name]);
        continue;
      }
      if (slot.mtimeMs !== mtEntry) {
        await reloadOne(name, cfg.configs[name]);
      }
    }
    return emitStatus();
  }

  return {
    getStatus() { return lastStatus; },
    async start() {
      stopped = false;
      await tick();
      if (pollMs > 0) {
        timer = setInterval(() => {
          tick().catch((err) => {
            lastStatus = { ok: false, modules: lastStatus.modules ?? {}, error: String(err?.message ?? err) };
            if (onStatus) onStatus(lastStatus);
          });
        }, pollMs);
        if (typeof timer.unref === 'function') timer.unref();
      }
      return lastStatus;
    },
    async stop() {
      stopped = true;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      for (const name of [...running.keys()]) await stopOne(name);
      return emitStatus();
    },
    /** 测试用：立刻扫一轮。 */
    async poll() { return tick(); },
    /** 测试用：绕过计时器直接套一份配置。 */
    async apply(cfg) { return applyConfig(cfg); },
  };
}

/**
 * 一次性热启动：加载配置、启模块、打印状态。不 boot Electron。
 * @returns {Promise<{ code: number, status: object, lines: string[] }>}
 */
export async function runModulesOnce(opts = {}) {
  const projectRoot = opts.projectRoot ?? PROJECT_ROOT;
  const lines = [];
  const host = createModuleHost({
    projectRoot,
    pollMs: 0,
    onLog: (e) => lines.push(`[${e.level}] ${e.module}: ${e.message}`),
  });
  let status;
  try {
    status = await host.start();
  } finally {
    await host.stop();
  }
  const names = Object.keys(status.modules ?? {}).sort();
  for (const name of names) {
    const m = status.modules[name];
    if (m.status === 'started') lines.push(`${name}: started`);
    else if (m.status === 'failed') lines.push(`${name}: failed — ${m.error}`);
    else lines.push(`${name}: ${m.status}`);
  }
  if (status.error) lines.push(`host: ${status.error}`);
  if (names.length === 0 && !status.error) lines.push('(no modules enabled)');
  const code = status.ok && !status.error ? 0 : 1;
  return { code, status, lines };
}
