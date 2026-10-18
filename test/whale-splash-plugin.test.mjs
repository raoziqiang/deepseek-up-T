// plugins/dsh-whale-splash —— 主窗口启动动画插件
//
// 宿主侧：注入行必须在 apply() 一开头就注册（注入表只收集一次），而且必须是内联 script
// （script-src 行 404 会拖垮启动）；三条同源路由真的能把包内文件送出去。
// 渲染侧：在 node:vm 假浏览器里把 assets/splash.js 真跑一遍 —— 启动即出幕布、整条时间线
// 画完后幕布自己撤掉并留下鲸鱼娘、同一会话里重载不再播放、点击可跳过、右键隐藏、
// 减动效直接出鲸鱼娘。画布的每个数值参数必须是有限数、半径不得为负（真浏览器里负半径
// 会抛 IndexSizeError，而这段代码在注入行里，没有人接这个异常）。

import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN = path.resolve(HERE, '..', 'plugins', 'dsh-whale-splash');
const SCRIPT_PATH = '/dsh-whale-splash/splash.js';

const results = [];
async function check(name, fn) {
  try { await fn(); results.push({ name, ok: true }); } catch (err) { results.push({ name, ok: false, err }); }
}

// ── 宿主侧 ──────────────────────────────────────────────────────

const mod = await import(pathToFileURL(path.join(PLUGIN, 'lib', 'index.js')).href);
const plugin = mod.default;

function makeHarness() {
  const state = { on: [], pending: [], routes: [], taps: [] };
  const root = {
    on(event, cb) { state.on.push({ event, cb }); return () => {}; },
    effect() { return () => {}; },
    inject(deps, cb) { state.pending.push({ deps, cb }); return () => {}; },
  };
  const ctx = {
    webServer: {
      register(route) { state.routes.push(route); return () => {}; },
      tapIndex(fn) { state.taps.push(fn); return () => {}; },
    },
    effect() { return () => {}; },
  };
  const settle = () => { for (const p of state.pending.splice(0)) p.cb(ctx); };
  return { state, root, settle };
}
const makeRes = () => ({
  status: null, headers: null, body: null,
  writeHead(code, headers) { this.status = code; this.headers = headers; },
  end(body) { this.body = body; },
});

const host = makeHarness();
plugin.apply(host.root);

await check('默认导出带 name 与 apply，且没有对象级 inject', () => {
  assert.equal(plugin.name, 'dsh-whale-splash');
  assert.equal(typeof plugin.apply, 'function');
  assert.equal(plugin.inject, undefined);
});

await check('apply() 立刻注册 webserver/index-inject，不等 webServer', () => {
  assert.equal(host.state.on.length, 1);
  assert.equal(host.state.on[0].event, 'webserver/index-inject');
  assert.equal(host.state.routes.length, 0, '路由要等 webServer，注入行不能等');
});

await check('注入行是内联 script、吞掉 onerror、幂等', () => {
  const table = [];
  host.state.on[0].cb(table);
  assert.equal(table.length, 1);
  assert.equal(table[0].kind, 'script');
  assert.ok(table[0].text.includes(SCRIPT_PATH));
  assert.ok(table[0].text.includes('onerror=function(){}'));
  host.state.on[0].cb(table);
  assert.equal(table.length, 1, '表被重复应用时不能推第二行');
  new vm.Script(table[0].text);
});

host.settle();

await check('webServer 就绪后注册三条路由，并兼容 Web 形态的 tapIndex', () => {
  const paths = host.state.routes.map((r) => r.path).sort();
  assert.deepEqual(paths, Object.keys(mod.ROUTES).sort());
  assert.ok(paths.includes(SCRIPT_PATH));
  assert.equal(host.state.taps.length, 1);
  const html = host.state.taps[0]('<html><body></body></html>');
  assert.ok(html.includes(`src="${SCRIPT_PATH}"`));
  assert.equal(host.state.taps[0](html), html, 'tapIndex 也要幂等');
});

await check('每条路由送出的就是包内那份文件，类型正确', () => {
  for (const route of host.state.routes) {
    const res = makeRes();
    route.handler({ method: 'GET' }, res);
    assert.equal(res.status, 200, route.path);
    const spec = mod.ROUTES[route.path];
    assert.equal(res.headers['Content-Type'], spec.type);
    assert.ok(Buffer.from(res.body).equals(readFileSync(path.join(PLUGIN, 'assets', spec.file))), route.path);
  }
});

await check('文件读不到时回 503，而不是抛异常', () => {
  const res = makeRes();
  mod.serve({ file: 'does-not-exist.png', type: 'image/png' }, res);
  assert.equal(res.status, 503);
});

await check('鲸鱼娘是带透明通道的 PNG（RGBA），鲸鱼原图在包内', () => {
  const girl = readFileSync(path.join(PLUGIN, 'assets', 'whale-girl.png'));
  assert.equal(girl.subarray(1, 4).toString('latin1'), 'PNG');
  assert.equal(girl[25], 6, 'IHDR color type 6 = RGBA');
  assert.ok(existsSync(path.join(PLUGIN, 'assets', 'whale.png')));
  assert.ok(readFileSync(path.join(PLUGIN, 'assets', 'whale.png'))
    .equals(readFileSync(path.resolve(HERE, '..', 'vendor', 'whale', 'materials', 'whale-3d.png'))),
  '鲸鱼必须是用户指定的原图');
});

// ── 渲染侧：假浏览器 ─────────────────────────────────────────────

const SOURCE = readFileSync(path.join(PLUGIN, 'assets', 'splash.js'), 'utf8');

function makeBrowser({ reduced = false, session = {}, width = 1280, height = 800, search = '' } = {}) {
  let now = 0;
  let rafs = [];
  let timers = [];
  const problems = [];
  const warns = [];
  const store = new Map(Object.entries(session));

  const finite = (where, args) => {
    for (const a of args) if (typeof a === 'number' && !Number.isFinite(a)) problems.push(`${where}(${args.join(',')})`);
  };
  const make2d = () => {
    const ctx = {};
    const methods = ['setTransform', 'clearRect', 'fillRect', 'drawImage', 'beginPath', 'moveTo', 'lineTo',
      'stroke', 'fill', 'save', 'restore', 'translate', 'rotate', 'scale', 'transform', 'quadraticCurveTo'];
    for (const m of methods) ctx[m] = (...args) => { finite(m, args); };
    ctx.arc = (...args) => { finite('arc', args); if (args[2] < 0) problems.push(`arc negative radius ${args[2]}`); };
    ctx.ellipse = (...args) => {
      finite('ellipse', args);
      if (args[2] < 0 || args[3] < 0) problems.push(`ellipse negative radius ${args[2]},${args[3]}`);
    };
    const gradient = (name) => (...args) => {
      finite(name, args);
      if (name === 'createRadialGradient' && (args[2] < 0 || args[5] < 0)) problems.push(`${name} negative radius`);
      return { addColorStop: (o, c) => { finite('addColorStop', [o]); if (o < 0 || o > 1) problems.push(`stop ${o}`); if (/NaN/.test(c)) problems.push(`color ${c}`); } };
    };
    ctx.createRadialGradient = gradient('createRadialGradient');
    ctx.createLinearGradient = gradient('createLinearGradient');
    return new Proxy(ctx, {
      set(target, key, value) {
        if (typeof value === 'number' && !Number.isFinite(value)) problems.push(`${String(key)}=${value}`);
        if (typeof value === 'string' && /NaN|undefined/.test(value)) problems.push(`${String(key)}=${value}`);
        target[key] = value; return true;
      },
    });
  };

  const byId = new Map();
  class El {
    constructor(tag) {
      this.tagName = tag.toUpperCase(); this.children = []; this.parentNode = null; this.style = {};
      this.attrs = {}; this.listeners = {}; this._cls = new Set(); this.textContent = '';
      const self = this;
      this.classList = {
        add: (c) => self._cls.add(c), remove: (c) => self._cls.delete(c), contains: (c) => self._cls.has(c),
      };
      if (tag === 'canvas') { this.width = 300; this.height = 150; }
    }
    get className() { return [...this._cls].join(' '); }
    set className(v) { this._cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
    set id(v) { this._id = v; byId.set(v, this); }
    get id() { return this._id; }
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
    removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parentNode = null; return c; }
    setAttribute(k, v) { this.attrs[k] = v; }
    addEventListener(t, cb) { (this.listeners[t] ??= []).push(cb); }
    removeEventListener(t, cb) { this.listeners[t] = (this.listeners[t] ?? []).filter((x) => x !== cb); }
    dispatch(t, ev = {}) { for (const cb of this.listeners[t] ?? []) cb({ preventDefault() {}, button: 0, pointerId: 1, ...ev }); }
    setPointerCapture() {}
    getContext(kind) { return kind === '2d' ? (this._2d ??= make2d()) : null; }
    querySelectorAll(sel) {
      const cls = sel.replace(/^\./, ''), out = [];
      const walk = (n) => { for (const c of n.children) { if (c._cls.has(cls)) out.push(c); walk(c); } };
      walk(this); return out;
    }
  }
  const documentElement = new El('html');
  const head = documentElement.appendChild(new El('head'));
  const body = documentElement.appendChild(new El('body'));

  class FakeImage {
    constructor() { this.complete = false; this.naturalWidth = 0; this.onload = null; this.onerror = null; }
    set src(v) {
      this._src = v;
      queueMicrotask(() => { this.complete = true; this.naturalWidth = 880; this.naturalHeight = 478; this.onload?.(); });
    }
    get src() { return this._src; }
  }

  const winListeners = {};
  const sandbox = {
    console: { log() {}, warn: (...a) => warns.push(a.join(' ')), error: (...a) => warns.push(a.join(' ')) },
    URL, URLSearchParams, Promise, queueMicrotask,
    Image: FakeImage,
    innerWidth: width, innerHeight: height, devicePixelRatio: 1,
    location: { search },
    performance: { now: () => now },
    requestAnimationFrame: (cb) => { rafs.push(cb); return rafs.length; },
    cancelAnimationFrame: () => {},
    setTimeout: (cb, ms) => { timers.push({ at: now + (ms || 0), cb }); return timers.length; },
    matchMedia: (q) => ({ matches: q.includes('reduced-motion') ? reduced : false }),
    sessionStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
    addEventListener: (t, cb) => { (winListeners[t] ??= []).push(cb); },
    removeEventListener: (t, cb) => { winListeners[t] = (winListeners[t] ?? []).filter((x) => x !== cb); },
    document: {
      documentElement, head, body, hidden: false, baseURI: 'http://app.test/',
      currentScript: { src: 'http://app.test' + SCRIPT_PATH },
      createElement: (tag) => new El(tag),
      getElementById: (id) => byId.get(id) ?? null,
      addEventListener() {}, removeEventListener() {},
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);

  const flush = () => new Promise((r) => setImmediate(r));
  const advance = async (ms, step = 16) => {
    const end = now + ms;
    while (now < end) {
      now = Math.min(end, now + step);
      const due = timers.filter((t) => t.at <= now); timers = timers.filter((t) => t.at > now);
      for (const t of due) t.cb();
      const frame = rafs; rafs = [];
      for (const cb of frame) cb(now);
      await flush();
    }
  };
  const load = async () => { vm.runInContext(SOURCE, sandbox, { filename: 'splash.js' }); await flush(); };
  const veil = () => body.querySelectorAll('.dshws-veil')[0] ?? null;
  const girl = () => body.querySelectorAll('.dshws-girl')[0] ?? null;
  return { sandbox, store, problems, warns, advance, load, veil, girl, flush };
}

const DURATION = Number(/var DURATION_MS = (\d+)/.exec(SOURCE)?.[1]);
assert.ok(DURATION > 0, 'splash.js 里找不到 DURATION_MS');

await check('启动即挂上星空幕布，并且标记本会话已播放', async () => {
  const b = makeBrowser();
  await b.load();
  assert.ok(b.veil(), '没有幕布');
  assert.equal(b.store.get('dsh-whale-splash-played'), '1');
  assert.equal(typeof b.sandbox.DshWhaleSplash.replay, 'function');
});

await check('整条时间线画完：幕布自己撤掉，左下角留下鲸鱼娘；全程参数有限、半径非负、零告警', async () => {
  const b = makeBrowser();
  await b.load();
  await b.advance(DURATION * 0.5);
  assert.ok(b.veil(), '播到一半幕布不该消失');
  assert.equal(b.girl(), null, '鲸鱼娘要等动画收尾才常驻');
  await b.advance(DURATION * 0.5 + 400);
  assert.equal(b.veil(), null, '播完幕布必须移除，否则会挡住整个界面');
  const g = b.girl();
  assert.ok(g, '播完没有鲸鱼娘');
  assert.equal(parseFloat(g.style.left), 14);
  const top = parseFloat(g.style.top), h = parseFloat(g.style.height);
  assert.ok(Math.abs(top + h - (800 - 48)) < 0.5, '鲸鱼娘应坐在左下角、up-T 胶囊上方');
  assert.ok(g.children[0].src.endsWith('/dsh-whale-splash/whale-girl.png'));
  assert.deepEqual(b.problems, []);
  assert.deepEqual(b.warns.filter((w) => !w.includes('2D fallback')), []);
});

await check('幕布在揭幕阶段放行指针，不挡界面', async () => {
  const b = makeBrowser();
  await b.load();
  await b.advance(200);
  assert.equal(b.veil().style.pointerEvents, 'auto');
  await b.advance(DURATION * 0.9);
  assert.equal(b.veil().style.pointerEvents, 'none');
});

await check('点击幕布跳到变身段：剩余时间明显变短', async () => {
  const b = makeBrowser();
  await b.load();
  await b.advance(300);
  b.veil().dispatch('pointerdown');
  await b.advance(DURATION * 0.22 + 300);
  assert.equal(b.veil(), null, '跳过后应在约 20% 时长内收尾');
  assert.ok(b.girl());
  assert.deepEqual(b.problems, []);
});

await check('同一会话里重载：不再播放，直接出鲸鱼娘', async () => {
  const b = makeBrowser({ session: { 'dsh-whale-splash-played': '1' } });
  await b.load();
  await b.advance(50);
  assert.equal(b.veil(), null);
  assert.ok(b.girl());
});

await check('右键隐藏鲸鱼娘并记住（本会话）；双击重播会把她带回来', async () => {
  const b = makeBrowser({ session: { 'dsh-whale-splash-played': '1' } });
  await b.load();
  await b.advance(50);
  b.girl().dispatch('contextmenu');
  assert.equal(b.store.get('dsh-whale-girl-hidden'), '1');
  await b.advance(600);
  assert.equal(b.girl(), null);
  b.sandbox.DshWhaleSplash.replay();
  assert.ok(b.veil(), '重播要重新挂幕布');
  await b.advance(DURATION + 1600);
  assert.ok(b.girl(), '重播结束后鲸鱼娘回来');
  assert.equal(b.store.has('dsh-whale-girl-hidden'), false);
  assert.deepEqual(b.problems, []);
});

await check('拖动鲸鱼娘会记住位置，下一次落点跟着走', async () => {
  const b = makeBrowser({ session: { 'dsh-whale-splash-played': '1' } });
  await b.load();
  await b.advance(50);
  const g = b.girl();
  g.dispatch('pointerdown', { clientX: 40, clientY: 700 });
  g.dispatch('pointermove', { clientX: 240, clientY: 500 });
  g.dispatch('pointerup');
  const saved = JSON.parse(b.store.get('dsh-whale-girl-pos'));
  assert.equal(saved.x, 214);
  assert.equal(parseFloat(g.style.left), 214);
});

await check('减动效：不挂幕布，直接出鲸鱼娘', async () => {
  const b = makeBrowser({ reduced: true });
  await b.load();
  await b.advance(50);
  assert.equal(b.veil(), null);
  assert.ok(b.girl());
});

await check('renderAt 逐点扫过时间线（含极窄与极矮窗口）都画得出来', async () => {
  for (const [w, h] of [[1280, 800], [420, 900], [1600, 360]]) {
    const b = makeBrowser({ width: w, height: h, search: '?whale-paused' });
    await b.load();
    assert.equal(b.veil(), null, 'whale-paused 不应自动播放');
    for (let t = 0; t <= 1.0001; t += 0.025) await b.sandbox.DshWhaleSplash.renderAt(t);
    assert.deepEqual(b.problems, [], `${w}x${h}`);
  }
});

// ── 汇总 ────────────────────────────────────────────────────────

let failed = 0;
for (const r of results) {
  if (r.ok) console.log(`  ok  ${r.name}`);
  else { failed++; console.log(`  FAIL ${r.name}\n       ${String(r.err?.stack ?? r.err).split('\n').slice(0, 4).join('\n       ')}`); }
}
console.log(`${results.length - failed}/${results.length} 条通过`);
process.exit(failed ? 1 : 0);
