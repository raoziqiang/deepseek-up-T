// deepseek-up-T :: dsh-up-t
//
// 界面上只做三件事：开机动画、背景、余额还能用几次。
// 偏好存在浏览器本地，这一侧只负责把脚本送进页面，并留下「插件确实加载了」的心跳。
//
// 层：L1。Harness 升级不会覆盖这个包。
//
// 注入约束（桌面端的注入表只在启动时收集一次）：
// 1. 不能把 webServer 写进对象级 inject，否则 apply() 会推迟，注入行赶不上收集。
// 2. 注入行必须是内联 script，由它自己建 <script src> 并吞掉 onerror。
//    script-src 一旦 404 会拒绝整个启动。
// 3. 桌面端 tapIndex 不生效；仍然注册它，只给自己渲染 index.html 的 Web 形态用。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function realdir(p) {
  try { return fs.realpathSync.native(p); } catch { return p; }
}
const PACKAGE_ROOT = realdir(path.resolve(HERE, '..'));

const CLIENT_PATH = '/dsh-up-t/client.js';
const STATUS_PATH = '/dsh-up-t/status.json';
const APPEARANCE_PATH = '/dsh-up-t/appearance';
const SEEN_PATH = '/dsh-up-t/seen';
const ROUTE_PATHS = [CLIENT_PATH, STATUS_PATH, APPEARANCE_PATH, SEEN_PATH];
const ACTION_HEADER = 'x-dsh-up-t';
const CLIENT_FILE = path.join(PACKAGE_ROOT, 'assets', 'client.js');
const RUNTIME_DIR = path.join(PACKAGE_ROOT, '.runtime');
const HEARTBEAT_FILE = path.join(RUNTIME_DIR, 'heartbeat.json');

/** 这一版界面提供的能力。验收用它区分「新宿主」和「还挂着旧操作页的宿主」。 */
export const FEATURES = ['boot', 'background', 'balance'];

const INJECT_ROW_TEXT =
  '(function(){try{var d=document.body||document.head||document.documentElement;if(!d)return;'
  + 'if(window.__DSH_UP_T_LOADED__)return;window.__DSH_UP_T_LOADED__=true;'
  + `var s=document.createElement("script");s.src="${CLIENT_PATH}";`
  + 's.onerror=function(){};d.appendChild(s)}catch(e){}})()';

let lastHeartbeatResult = null;
let heartbeatTrail = [];
let clientSeen = null;

export function writeHeartbeat(stage = 'apply', extra = {}) {
  const pkg = readOwnPackage();
  const now = new Date().toISOString();
  if (stage === 'apply') heartbeatTrail = [];
  const last = heartbeatTrail[heartbeatTrail.length - 1];
  if (last && last.stage === stage) last.at = now;
  else heartbeatTrail.push({ stage, at: now });

  const payload = {
    plugin: pkg.name,
    version: pkg.version,
    stage,
    at: now,
    loadedAt: heartbeatTrail[0].at,
    trail: heartbeatTrail.map((s) => ({ ...s })),
    pid: process.pid,
    execPath: process.execPath ?? null,
    electron: process.versions?.electron ?? null,
    node: process.versions?.node ?? null,
    clientPath: CLIENT_PATH,
    statusPath: STATUS_PATH,
    appearancePath: APPEARANCE_PATH,
    features: FEATURES,
    ...extra,
  };
  try {
    fs.mkdirSync(RUNTIME_DIR, { recursive: true });
    fs.writeFileSync(HEARTBEAT_FILE, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    lastHeartbeatResult = { ok: true, file: HEARTBEAT_FILE, payload };
  } catch (err) {
    lastHeartbeatResult = { ok: false, file: HEARTBEAT_FILE, error: String(err?.message ?? err) };
  }
  return lastHeartbeatResult;
}

export const heartbeatPath = HEARTBEAT_FILE;

export function noteClientSeen(via) {
  const now = new Date().toISOString();
  const known = via === 'bundle' || via === 'capsule' ? via : 'unknown';
  const prev = clientSeen ?? { count: 0, sources: {} };
  clientSeen = {
    at: now,
    count: prev.count + 1,
    sources: { ...prev.sources, [known]: now },
  };
  writeHeartbeat('ready', { routes: ROUTE_PATHS, client: clientSeen });
  return clientSeen;
}

function readOwnPackage() {
  try {
    return JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8'));
  } catch {
    return { name: 'dsh-up-t', version: '0.0.0' };
  }
}

function makeMtimeReader(file) {
  let cache = null;
  return () => {
    try {
      const st = fs.statSync(file);
      if (cache && cache.mtimeMs === st.mtimeMs) return cache.text;
      const text = fs.readFileSync(file, 'utf8');
      cache = { text, mtimeMs: st.mtimeMs };
      return text;
    } catch {
      return cache ? cache.text : null;
    }
  };
}

const readClientJs = makeMtimeReader(CLIENT_FILE);
const MAX_BODY = 8 * 1024;

function readBody(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error(`请求体超过 ${limit} 字节`)); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function parseJsonOrNull(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function sendJson(res, payload, status = 200) {
  const body = Buffer.from(JSON.stringify(payload, null, 2), 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function sendJs(res, text) {
  if (text === null) {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('dsh-up-t: assets/client.js not readable');
    return;
  }
  const body = Buffer.from(text, 'utf8');
  res.writeHead(200, {
    'Content-Type': 'application/javascript; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function collectStatus() {
  const pkg = readOwnPackage();
  return {
    ok: true,
    plugin: { name: pkg.name, version: pkg.version },
    time: new Date().toISOString(),
    features: FEATURES,
    clientSeen,
    heartbeatWriteError: lastHeartbeatResult && !lastHeartbeatResult.ok ? lastHeartbeatResult.error : null,
  };
}

export default {
  name: 'dsh-up-t',

  apply(root) {
    const rowDisposers = [];
    writeHeartbeat();

    rowDisposers.push(root.on('webserver/index-inject', (table) => {
      for (const row of table) {
        if (row.kind === 'script-src' && row.src === CLIENT_PATH) return;
        if (row.kind === 'script' && typeof row.text === 'string' && row.text.includes(CLIENT_PATH)) return;
      }
      table.push({ kind: 'script', text: INJECT_ROW_TEXT });
    }));

    root.effect(() => () => {
      for (const d of rowDisposers) { try { d(); } catch { /* 清理失败不影响退出 */ } }
    });

    root.inject(['webServer'], (ctx) => {
      const disposers = [];

      disposers.push(ctx.webServer.register({
        kind: 'exact',
        path: CLIENT_PATH,
        handler: (_req, res) => sendJs(res, readClientJs()),
      }));

      disposers.push(ctx.webServer.register({
        kind: 'exact',
        path: STATUS_PATH,
        handler: (_req, res) => {
          try { sendJson(res, collectStatus()); } catch (err) {
            sendJson(res, { ok: false, error: String(err?.message ?? err) });
          }
        },
      }));

      disposers.push(ctx.webServer.register({
        kind: 'exact',
        path: APPEARANCE_PATH,
        handler: (_req, res) => sendJson(res, { ok: true, features: FEATURES }),
      }));

      disposers.push(ctx.webServer.register({
        kind: 'exact',
        path: SEEN_PATH,
        handler: (req, res) => {
          try {
            if (String(req.method).toUpperCase() !== 'POST') {
              sendJson(res, { ok: true, seen: clientSeen, note: '渲染层脚本加载后会 POST ' + SEEN_PATH });
              return;
            }
            if (String(req.headers?.[ACTION_HEADER] ?? '') !== '1') {
              sendJson(res, { ok: false, error: '缺少 ' + ACTION_HEADER + ' 头' }, 403);
              req.resume();
              return;
            }
            readBody(req, MAX_BODY).then((raw) => {
              const body = parseJsonOrNull(raw);
              sendJson(res, { ok: true, seen: noteClientSeen(body?.via) });
            }).catch(() => {
              try { sendJson(res, { ok: false, error: '请求体读取失败' }, 400); } catch { /* 已断开 */ }
            });
          } catch (err) {
            sendJson(res, { ok: false, error: String(err?.message ?? err) }, 500);
          }
        },
      }));

      disposers.push(ctx.webServer.tapIndex((html) => {
        if (html.includes(CLIENT_PATH)) return html;
        const tag = `<script defer src="${CLIENT_PATH}"></script>`;
        return html.includes('</body>') ? html.replace('</body>', `${tag}</body>`) : html + tag;
      }));

      ctx.effect(() => () => {
        for (const d of disposers) { try { d(); } catch { /* 同上 */ } }
      });

      writeHeartbeat('ready', { routes: ROUTE_PATHS, client: clientSeen });
    });
  },
};
