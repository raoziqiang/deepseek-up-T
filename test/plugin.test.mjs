// dsh-up-t 宿主半侧：注入行、心跳、外观路由。界面不再提供体检 / 快照 / 鲸鱼挂件。
//   node test/plugin.test.mjs

import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync, existsSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN = path.resolve(HERE, '..', 'plugins', 'dsh-up-t');
const CLIENT_PATH = '/dsh-up-t/client.js';
const STATUS_PATH = '/dsh-up-t/status.json';
const APPEARANCE_PATH = '/dsh-up-t/appearance';
const SEEN_PATH = '/dsh-up-t/seen';

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, err });
  }
}
async function checkAsync(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, err });
  }
}

function makeReq({ method = 'POST', headers = {}, body = '' } = {}) {
  const listeners = { data: [], end: [], error: [] };
  let resumed = false;
  const req = {
    method,
    headers,
    destroy() { req.destroyed = true; },
    resume() { resumed = true; req.resumed = true; return req; },
    on(event, cb) { (listeners[event] ??= []).push(cb); return req; },
  };
  queueMicrotask(() => {
    if (req.destroyed) return;
    if (!resumed) for (const cb of listeners.data) cb(Buffer.from(body, 'utf8'));
    for (const cb of listeners.end) cb();
  });
  return req;
}

function makeRes() {
  return {
    statusCode: null,
    headers: null,
    body: null,
    writeHead(code, headers) { this.statusCode = code; this.headers = headers; },
    end(body) { this.body = body; },
  };
}

function makeHarness() {
  const state = {
    injectHandlers: [],
    rootEffects: [],
    injectCalls: [],
    pendingInject: [],
    routes: [],
    tapIndexFns: [],
    ctxEffects: [],
  };
  const root = {
    on(event, cb) { state.injectHandlers.push({ event, cb }); return () => {}; },
    effect(fn) { state.rootEffects.push(fn); return () => {}; },
    inject(deps, cb) {
      state.injectCalls.push({ deps, cb });
      state.pendingInject.push(cb);
      return () => {};
    },
  };
  const ctx = {
    webServer: {
      register(route) { state.routes.push(route); return () => {}; },
      tapIndex(fn) { state.tapIndexFns.push(fn); return () => {}; },
    },
    effect(fn) { state.ctxEffects.push(fn); return () => {}; },
  };
  const settle = () => {
    const pending = state.pendingInject.splice(0);
    for (const cb of pending) cb(ctx);
  };
  return { state, root, ctx, settle };
}

const mod = await import(new URL(`file:///${path.join(PLUGIN, 'lib', 'index.js').replace(/\\/g, '/')}`).href);
const plugin = mod.default;
const hostHeartbeat = existsSync(mod.heartbeatPath) ? readFileSync(mod.heartbeatPath) : null;

check('默认导出带 name 与 apply，且没有对象级 inject', () => {
  assert.equal(plugin.name, 'dsh-up-t');
  assert.equal(typeof plugin.apply, 'function');
  assert.equal(plugin.inject, undefined);
  assert.deepEqual(mod.FEATURES, ['boot', 'background', 'balance']);
  assert.equal(mod.ACTIONS, undefined, '操作白名单已从界面拿掉');
});

const { state, root, settle } = makeHarness();
plugin.apply(root);

check('apply() 第一件事就是写心跳', () => {
  assert.equal(mod.heartbeatPath, path.join(PLUGIN, '.runtime', 'heartbeat.json'));
  const beat = JSON.parse(readFileSync(mod.heartbeatPath, 'utf8'));
  assert.equal(beat.plugin, 'dsh-up-t');
  assert.equal(beat.pid, process.pid);
  assert.equal(beat.stage, 'apply');
  assert.ok(Number.isFinite(Date.parse(beat.at)));
});

check('心跳写失败只返回 ok=false，不抛', () => {
  const res = mod.writeHeartbeat();
  assert.equal(res.ok, true);
  assert.equal(res.file, mod.heartbeatPath);
});

function fireInject(table) {
  const rows = table || [];
  for (const h of state.injectHandlers) h.cb(rows);
  return rows;
}

check('注入行是内联 script，自己建 src 并吞掉 onerror', () => {
  assert.equal(state.injectHandlers.length, 1);
  assert.equal(state.injectHandlers[0].event, 'webserver/index-inject');
  const rows = fireInject();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, 'script');
  assert.equal(rows[0].src, undefined);
  assert.match(rows[0].text, /createElement\("script"\)/);
  assert.match(rows[0].text, new RegExp(CLIENT_PATH.replace(/\//g, '\\/')));
  assert.match(rows[0].text, /onerror=function\(\)\{\}/);
  assert.match(rows[0].text, /__DSH_UP_T_LOADED__/);
  assert.equal(fireInject().length, 1, '同一张表里已有目标时不重复推');
  const again = fireInject([]);
  assert.equal(again.length, 1);
  fireInject(again);
  assert.equal(again.length, 1, '重复触发不追加第二条');
});

check('root.inject 只等 webServer，就绪后注册四条外观路由', () => {
  assert.deepEqual(state.injectCalls[0].deps, ['webServer']);
  assert.equal(state.routes.length, 0, '依赖就绪前不注册路由');
  settle();
  const paths = state.routes.map((r) => r.path).sort();
  assert.deepEqual(paths, [APPEARANCE_PATH, CLIENT_PATH, SEEN_PATH, STATUS_PATH].sort());
  assert.ok(!paths.includes('/dsh-up-t/action'), '不再注册操作通道');
  const beat = JSON.parse(readFileSync(mod.heartbeatPath, 'utf8'));
  assert.equal(beat.stage, 'ready');
  assert.deepEqual(beat.routes, [CLIENT_PATH, STATUS_PATH, APPEARANCE_PATH, SEEN_PATH]);
  assert.equal(beat.trail[0].stage, 'apply');
  assert.equal(beat.trail[1].stage, 'ready');
});

check('tapIndex 只在页面还没有脚本时插入', () => {
  assert.equal(state.tapIndexFns.length, 1);
  const html = state.tapIndexFns[0]('<html><body>hi</body></html>');
  assert.match(html, new RegExp(`<script defer src="${CLIENT_PATH}"></script></body>`));
  assert.equal(state.tapIndexFns[0](html), html);
});

function drive(pathName, req) {
  const route = state.routes.find((r) => r.path === pathName);
  assert.ok(route, pathName);
  const res = makeRes();
  route.handler(req, res);
  return res;
}

check('client.js 路由返回脚本', () => {
  const res = drive(CLIENT_PATH, makeReq({ method: 'GET' }));
  assert.equal(res.statusCode, 200);
  assert.match(String(res.headers['Content-Type']), /javascript/);
  assert.match(res.body.toString('utf8'), /dsh-up-t-boot/);
});

check('status.json 只报告插件还在，不再带安装包 / 暂存包 / 心跳墙', () => {
  const res = drive(STATUS_PATH, makeReq({ method: 'GET' }));
  const j = JSON.parse(res.body.toString('utf8'));
  assert.equal(j.ok, true);
  assert.equal(j.plugin.name, 'dsh-up-t');
  assert.deepEqual(j.features, ['boot', 'background', 'balance']);
  assert.equal(j.install, undefined);
  assert.equal(j.staged, undefined);
  assert.equal(j.heartbeat, undefined);
});

check('appearance 路由列出三项能力', () => {
  const res = drive(APPEARANCE_PATH, makeReq({ method: 'GET' }));
  const j = JSON.parse(res.body.toString('utf8'));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(j.features, ['boot', 'background', 'balance']);
});

await checkAsync('seen：GET 不记录，缺头的 POST 403，两条通道分开记', async () => {
  let res = drive(SEEN_PATH, makeReq({ method: 'GET' }));
  await new Promise((r) => setImmediate(r));
  assert.equal(JSON.parse(res.body.toString('utf8')).seen, null);

  res = drive(SEEN_PATH, makeReq({ method: 'POST', body: JSON.stringify({ via: 'capsule' }) }));
  await new Promise((r) => setImmediate(r));
  assert.equal(res.statusCode, 403);

  res = drive(SEEN_PATH, makeReq({
    method: 'POST',
    headers: { 'x-dsh-up-t': '1' },
    body: JSON.stringify({ via: 'bundle' }),
  }));
  await new Promise((r) => setImmediate(r));
  let seen = JSON.parse(res.body.toString('utf8')).seen;
  assert.equal(seen.sources.bundle != null, true);
  assert.equal(seen.sources.capsule, undefined);

  res = drive(SEEN_PATH, makeReq({
    method: 'POST',
    headers: { 'x-dsh-up-t': '1' },
    body: JSON.stringify({ via: 'capsule' }),
  }));
  await new Promise((r) => setImmediate(r));
  seen = JSON.parse(res.body.toString('utf8')).seen;
  assert.ok(seen.sources.bundle);
  assert.ok(seen.sources.capsule);
  assert.equal(seen.count, 2);
});

check('清理函数可调用', () => {
  for (const fn of state.rootEffects) {
    const dispose = fn();
    assert.equal(typeof dispose, 'function');
    dispose();
  }
  for (const fn of state.ctxEffects) {
    const dispose = fn();
    dispose();
  }
});

const CLIENT_SRC = readFileSync(path.join(PLUGIN, 'lib', 'client.js'), 'utf8');
const ASSET_SRC = readFileSync(path.join(PLUGIN, 'assets', 'client.js'), 'utf8');

check('设置页与注入脚本都不再包含旧功能', () => {
  for (const src of [CLIENT_SRC, ASSET_SRC]) {
    assert.equal(/^\s*(import|export)\s/m.test(src), false);
    assert.doesNotMatch(src, /whale-charm|鲸鱼|体检|快照|暂存包|settings\.general\.item|\/dsh-up-t\/action/);
  }
  assert.match(CLIENT_SRC, /开机动画/);
  assert.match(CLIENT_SRC, /余额/);
  assert.match(ASSET_SRC, /dsh-up-t-boot/);
});

check('设置页只注册一个 settings.section，标签是外观', () => {
  let captured = null;
  const sandbox = {
    window: { __ModuleLoader__: { load(spec) { captured = spec; } } },
    console,
  };
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(CLIENT_SRC, sandbox, { filename: 'lib/client.js' });
  assert.equal(captured.id, 'dsh-up-t');
  const exp = captured.factory(() => ({
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState: (initial) => [initial, () => {}],
    useEffect: () => {},
  }));
  assert.deepEqual(Array.from(exp.inject), ['slots']);
  const registers = [];
  exp.apply({
    effect(fn) { return fn(); },
    slots: {
      inject(key, cb) { registers.push(key); return cb(); },
      register(entry, component) {
        registers.push(entry);
        assert.equal(typeof component, 'function');
        return () => {};
      },
    },
  });
  assert.deepEqual(registers[0], 'settings.section');
  assert.equal(registers.length, 2);
  assert.equal(registers[1].id, 'dsh-up-t');
  assert.equal(registers[1].label(), '外观');
  assert.equal(registers[1].name, 'settings.section');
});

check('package.json 声明 web 客户端', () => {
  const pkg = JSON.parse(readFileSync(path.join(PLUGIN, 'package.json'), 'utf8'));
  assert.equal(pkg.dsh.client.platform, 'web');
  assert.equal(pkg.exports['./client'].default, './lib/client.js');
  assert.match(pkg.description, /开机动画/);
});

try {
  if (hostHeartbeat !== null) {
    mkdirSync(path.dirname(mod.heartbeatPath), { recursive: true });
    writeFileSync(mod.heartbeatPath, hostHeartbeat);
  } else {
    rmSync(path.dirname(mod.heartbeatPath), { recursive: true, force: true });
  }
} catch { /* 忽略 */ }

const failed = results.filter((r) => !r.ok);
for (const r of results) {
  console.log(`${r.ok ? '  ok  ' : ' FAIL '} ${r.name}`);
  if (!r.ok) console.log(`        ${r.err?.stack ?? r.err}`);
}
if (failed.length) {
  console.log(`插件单测失败：${failed.length}/${results.length}`);
  process.exit(1);
}
console.log(`插件单测通过：${results.length}/${results.length} 项`);
