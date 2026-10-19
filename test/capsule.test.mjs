// assets/client.js：开机动画、背景、余额提示。在假 DOM 里真跑一遍。
//   node test/capsule.test.mjs

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(path.resolve(HERE, '..', 'plugins', 'dsh-up-t', 'assets', 'client.js'), 'utf8');

const results = [];
const RUNS = [];
async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, err });
  }
}

function makeNode(tag) {
  const node = {
    tagName: String(tag).toUpperCase(),
    id: '',
    style: {},
    children: [],
    parentNode: null,
    listeners: {},
    appendChild(child) {
      child.parentNode = node;
      node.children.push(child);
      return child;
    },
    removeChild(child) {
      const i = node.children.indexOf(child);
      if (i >= 0) node.children.splice(i, 1);
      child.parentNode = null;
      return child;
    },
    addEventListener(type, fn) {
      (node.listeners[type] || (node.listeners[type] = [])).push(fn);
    },
  };
  let text = '';
  Object.defineProperty(node, 'textContent', {
    get() {
      if (node.children.length) return node.children.map((c) => c.textContent).join('');
      return text;
    },
    set(v) {
      node.children.length = 0;
      text = v == null ? '' : String(v);
    },
  });
  return node;
}

function makeDom({ body = true, readyState = 'complete' } = {}) {
  const created = [];
  const docListeners = {};
  const document = {
    readyState,
    documentElement: null,
    head: null,
    body: null,
    createElement(tag) {
      const n = makeNode(tag);
      created.push(n);
      return n;
    },
    addEventListener(type, fn) {
      (docListeners[type] || (docListeners[type] = [])).push(fn);
    },
    dispatch(type) {
      for (const fn of (docListeners[type] || []).slice()) fn();
    },
    getElementById(id) {
      return created.find((n) => n.id === id && n.parentNode) || null;
    },
  };
  const html = makeNode('html');
  document.documentElement = html;
  const head = makeNode('head');
  html.appendChild(head);
  document.head = head;
  if (body) {
    const b = makeNode('body');
    html.appendChild(b);
    document.body = b;
  }
  return { document, created };
}

function makeStorage(initial = {}, { throws = false } = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem(k) {
      if (throws) throw new Error('SecurityError');
      return map.has(k) ? map.get(k) : null;
    },
    setItem(k, v) {
      if (throws) throw new Error('SecurityError');
      map.set(k, String(v));
    },
    removeItem(k) {
      if (throws) throw new Error('SecurityError');
      map.delete(k);
    },
    dump() { return Object.fromEntries(map); },
  };
}

function run(opts = {}) {
  const dom = makeDom(opts);
  const warns = [];
  const timeouts = [];
  const fetchCalls = [];
  const storage = opts.storage || makeStorage();
  const session = opts.session || makeStorage();
  const window_ = {
    listeners: {},
    addEventListener(type, fn) {
      (window_.listeners[type] || (window_.listeners[type] = [])).push(fn);
    },
    dispatchEvent(ev) {
      for (const fn of (window_.listeners[ev.type] || []).slice()) fn(ev);
    },
    matchMedia() { return { matches: opts.reduced === true }; },
  };
  const sandbox = {
    window: window_,
    document: dom.document,
    localStorage: storage,
    sessionStorage: session,
    fetch(url, init) {
      fetchCalls.push({ url, init });
      if (opts.fetchReject) return Promise.reject(new Error('offline'));
      return Promise.resolve({ status: 200, json: async () => ({ ok: true }) });
    },
    console: { warn: (...a) => warns.push(a.map(String).join(' ')), info() {}, log() {} },
    setTimeout(fn) { timeouts.push(fn); return timeouts.length; },
    clearTimeout() {},
    Math, JSON, Object, String, Number, isFinite,
  };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox, { filename: 'assets/client.js' });
  if (opts.twice) vm.runInContext(SRC, sandbox, { filename: 'assets/client.js' });
  const rec = { dom, window: window_, storage, session, fetchCalls, warns, timeouts };
  RUNS.push(rec);
  return rec;
}

const gif = 'data:image/gif;base64,R0lGODlhAQABAIABAP///wAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
const prefs = (over) => JSON.stringify({
  boot: true, background: 'none', customBackground: '', balance: '', cost: '', showBalance: true, ...over,
});

function attached(dom, id) {
  return dom.created.filter((n) => n.id === id && n.parentNode);
}

await check('经典脚本，幂等标记在', () => {
  assert.equal(/^\s*(import|export)\s/m.test(SRC), false);
  assert.match(SRC, /__DSH_UP_T_CLIENT__/);
  assert.match(SRC, /^\(function \(\) \{/m);
});

await check('默认：播放开机动画，背景样式为空，没有余额条，并发出握手', () => {
  const r = run();
  assert.equal(attached(r.dom, 'dsh-up-t-boot').length, 1);
  assert.equal(attached(r.dom, 'dsh-up-t-boot')[0].textContent.includes('DeepSeek'), true);
  assert.equal(attached(r.dom, 'dsh-up-t-bg')[0].textContent, '');
  assert.equal(attached(r.dom, 'dsh-up-t-balance').length, 0);
  assert.equal(r.fetchCalls[0].url, '/dsh-up-t/seen');
  assert.equal(r.fetchCalls[0].init.headers['x-dsh-up-t'], '1');
  assert.deepEqual(JSON.parse(r.fetchCalls[0].init.body), { via: 'capsule' });
  assert.deepEqual(r.warns, []);
  assert.equal(r.session.dump()['dsh-up-t:boot-played'], '1');
});

await check('同一页再执行一次不会再挂一层', () => {
  const r = run({ twice: true });
  assert.equal(attached(r.dom, 'dsh-up-t-boot').length, 1);
  assert.equal(r.fetchCalls.length, 1);
});

await check('减少动态效果、本会话已播过、或关掉开关时不自动播放', () => {
  for (const opts of [
    { reduced: true },
    { session: makeStorage({ 'dsh-up-t:boot-played': '1' }) },
    { storage: makeStorage({ 'dsh-up-t:prefs': prefs({ boot: false }) }) },
  ]) {
    const r = run(opts);
    assert.equal(attached(r.dom, 'dsh-up-t-boot').length, 0, JSON.stringify(opts.storage?.dump?.() ?? opts));
    assert.deepEqual(r.warns, []);
  }
});

await check('再看一次会重播，即使本会话已经播过', () => {
  const r = run({ session: makeStorage({ 'dsh-up-t:boot-played': '1' }) });
  assert.equal(attached(r.dom, 'dsh-up-t-boot').length, 0);
  r.window.dispatchEvent({ type: 'dsh-up-t:replay' });
  assert.equal(attached(r.dom, 'dsh-up-t-boot').length, 1);
  r.timeouts.at(-1)();
  assert.equal(attached(r.dom, 'dsh-up-t-boot').length, 0);
});

await check('默认背景：静夜、晨雾、流光', () => {
  const night = run({ storage: makeStorage({ 'dsh-up-t:prefs': prefs({ background: 'night', boot: false }) }) });
  assert.match(attached(night.dom, 'dsh-up-t-bg')[0].textContent, /radial-gradient/);
  const dawn = run({ storage: makeStorage({ 'dsh-up-t:prefs': prefs({ background: 'dawn', boot: false }) }) });
  assert.match(attached(dawn.dom, 'dsh-up-t-bg')[0].textContent, /linear-gradient\(165deg/);
  const flow = run({ storage: makeStorage({ 'dsh-up-t:prefs': prefs({ background: 'flow', boot: false }) }) });
  assert.match(attached(flow.dom, 'dsh-up-t-bg')[0].textContent, /dsh-up-t-flow/);
  assert.match(attached(flow.dom, 'dsh-up-t-bg')[0].textContent, /animation:dsh-up-t-flow/);
});

await check('自定义动图盖过默认背景；不是图片的 data URL 被丢掉', () => {
  const ok = run({ storage: makeStorage({ 'dsh-up-t:prefs': prefs({ background: 'night', customBackground: gif, boot: false }) }) });
  const css = attached(ok.dom, 'dsh-up-t-bg')[0].textContent;
  assert.match(css, /data:image\/gif/);
  assert.doesNotMatch(css, /radial-gradient/);
  const bad = run({ storage: makeStorage({ 'dsh-up-t:prefs': prefs({
    background: 'dawn', customBackground: 'data:text/html,<script>', boot: false,
  }) }) });
  assert.match(attached(bad.dom, 'dsh-up-t-bg')[0].textContent, /linear-gradient\(165deg/);
});

await check('余额条：次数、缺消耗、消耗为 0、关掉显示', () => {
  const turns = run({ storage: makeStorage({ 'dsh-up-t:prefs': prefs({ balance: '20', cost: '0.8', boot: false }) }) });
  assert.equal(attached(turns.dom, 'dsh-up-t-balance')[0].textContent, '余额 20 · 约 25 次');
  const missing = run({ storage: makeStorage({ 'dsh-up-t:prefs': prefs({ balance: '10', boot: false }) }) });
  assert.equal(attached(missing.dom, 'dsh-up-t-balance')[0].textContent, '余额 10 · 填上每次消耗可算次数');
  const zero = run({ storage: makeStorage({ 'dsh-up-t:prefs': prefs({ balance: '10', cost: '0', boot: false }) }) });
  assert.equal(attached(zero.dom, 'dsh-up-t-balance')[0].textContent, '余额 10 · 每次消耗要大于 0');
  const hidden = run({ storage: makeStorage({ 'dsh-up-t:prefs': prefs({ balance: '10', cost: '1', showBalance: false, boot: false }) }) });
  assert.equal(attached(hidden.dom, 'dsh-up-t-balance').length, 0);
  const neg = run({ storage: makeStorage({ 'dsh-up-t:prefs': prefs({ balance: '-3', cost: '1', boot: false }) }) });
  assert.equal(attached(neg.dom, 'dsh-up-t-balance')[0].textContent, '余额 -3 · 约 0 次');
});

await check('偏好事件会改余额条', () => {
  const r = run({ storage: makeStorage({ 'dsh-up-t:prefs': prefs({ boot: false }) }) });
  assert.equal(attached(r.dom, 'dsh-up-t-balance').length, 0);
  r.storage.setItem('dsh-up-t:prefs', prefs({ balance: '3', cost: '1', boot: false }));
  r.window.dispatchEvent({ type: 'dsh-up-t:prefs' });
  assert.equal(attached(r.dom, 'dsh-up-t-balance')[0].textContent, '余额 3 · 约 3 次');
});

await check('存储被禁或握手失败时仍然安静', () => {
  const blocked = run({ storage: makeStorage({}, { throws: true }), session: makeStorage({}, { throws: true }) });
  assert.equal(attached(blocked.dom, 'dsh-up-t-bg').length, 1);
  assert.deepEqual(blocked.warns, []);
  const offline = run({ fetchReject: true });
  assert.equal(attached(offline.dom, 'dsh-up-t-boot').length, 1);
  assert.deepEqual(offline.warns, []);
});

await check('文档还在加载时等到 DOMContentLoaded', () => {
  const r = run({ readyState: 'loading' });
  assert.equal(attached(r.dom, 'dsh-up-t-boot').length, 0);
  r.dom.document.dispatch('DOMContentLoaded');
  assert.equal(attached(r.dom, 'dsh-up-t-boot').length, 1);
});

await check('没有一次让外层 catch 响', () => {
  assert.ok(RUNS.length >= 8);
  const lines = RUNS.flatMap((r) => r.warns);
  assert.deepEqual(lines, []);
});

const failed = results.filter((r) => !r.ok);
for (const r of results) {
  console.log(`${r.ok ? '  ok  ' : ' FAIL '} ${r.name}`);
  if (!r.ok) console.log(`        ${r.err?.stack ?? r.err}`);
}
if (failed.length) {
  console.log(`注入脚本单测失败：${failed.length}/${results.length}`);
  process.exit(1);
}
console.log(`注入脚本单测通过：${results.length}/${results.length} 项`);
