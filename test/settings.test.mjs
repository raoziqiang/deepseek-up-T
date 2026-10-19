// lib/client.js：设置页只有开机动画、背景、余额。迷你 hook 主机真的渲染并点一遍。
//   node test/settings.test.mjs

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const SRC = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'plugins', 'dsh-up-t', 'lib', 'client.js'), 'utf8');

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, err });
  }
}

function flatten(list, out = []) {
  for (const c of list) {
    if (Array.isArray(c)) flatten(c, out);
    else if (c != null && c !== false && c !== true) out.push(c);
  }
  return out;
}

function textOf(node) {
  if (node == null || node === false) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return flatten(node.children || []).map(textOf).join('');
}

function walk(node, visit) {
  if (!node || typeof node !== 'object' || !node.$$el) return;
  visit(node);
  for (const c of flatten(node.children || [])) walk(c, visit);
}

function findAction(node, action) {
  let found = null;
  walk(node, (el) => {
    if (!found && el.props && el.props['data-action'] === action) found = el;
  });
  return found;
}

function mount(initialPrefs, { fileReader } = {}) {
  const store = new Map(Object.entries(initialPrefs || {}));
  const events = [];
  const fetches = [];
  let tree = null;
  const frames = new Map();
  let current = null;
  let pending = [];
  const stats = { effects: 0 };

  function useState(initial) {
    const frame = current;
    const index = frame.cursor++;
    if (!(index in frame.hooks)) frame.hooks[index] = typeof initial === 'function' ? initial() : initial;
    return [frame.hooks[index], (next) => {
      const value = typeof next === 'function' ? next(frame.hooks[index]) : next;
      if (Object.is(value, frame.hooks[index])) return;
      frame.hooks[index] = value;
      frame.dirty = true;
    }];
  }
  function useEffect(fn, deps) {
    if (!Array.isArray(deps) || deps.length !== 0) throw new Error(`只支持 useEffect([])，收到 ${JSON.stringify(deps)}`);
    const frame = current;
    const index = frame.cursor++;
    if (!frame.effects[index]) {
      frame.effects[index] = true;
      pending.push(fn);
    }
  }
  function createElement(type, props, ...children) {
    return { $$el: true, type, props: props || {}, children: flatten(children) };
  }

  const sandbox = {
    window: {
      __ModuleLoader__: null,
      dispatchEvent(ev) { events.push(ev.type); },
    },
    localStorage: {
      getItem(k) { return store.has(k) ? store.get(k) : null; },
      setItem(k, v) {
        if (sandbox.localStorage.fail) throw new Error('QuotaExceededError');
        store.set(k, String(v));
      },
    },
    fetch(url, init) { fetches.push({ url, init }); return Promise.resolve({ ok: true }); },
    Event: class Event { constructor(type) { this.type = type; } },
    FileReader: fileReader || class FileReader {},
    console,
    JSON, Object, Math, String, Number, isFinite, RegExp,
  };
  sandbox.window.window = sandbox.window;

  let captured = null;
  sandbox.window.__ModuleLoader__ = { load(spec) { captured = spec; } };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox, { filename: 'lib/client.js' });
  const exp = captured.factory(() => ({ createElement, useState, useEffect }));
  let Component = null;
  exp.apply({
    effect(fn) { return fn(); },
    slots: {
      inject(_key, cb) { return cb(); },
      register(_entry, component) { Component = component; return () => {}; },
    },
  });

  function render() {
    const frame = frames.get('root') || { hooks: [], effects: {}, cursor: 0, dirty: false };
    frames.set('root', frame);
    frame.cursor = 0;
    frame.dirty = false;
    current = frame;
    tree = Component();
    current = null;
    return frame;
  }
  function flush() {
    const frame = render();
    const effects = pending.splice(0);
    for (const fn of effects) { stats.effects += 1; fn(); }
    if (frame.dirty) flush();
  }
  function commit() {
    const frame = frames.get('root');
    if (frame && frame.dirty) flush();
  }

  flush();
  return {
    get tree() { return tree; },
    text: () => textOf(tree),
    events,
    fetches,
    store,
    stats,
    sandbox,
    act(fn) { fn(); commit(); },
  };
}

await check('打开就是三块：开机动画、背景、余额，没有旧按钮', () => {
  const ui = mount();
  const text = ui.text();
  assert.match(text, /开机动画/);
  assert.match(text, /打开时播放/);
  assert.match(text, /再看一次/);
  assert.match(text, /跟随界面/);
  assert.match(text, /静夜/);
  assert.match(text, /晨雾/);
  assert.match(text, /流光/);
  assert.match(text, /当前余额/);
  assert.match(text, /每次大约消耗/);
  assert.match(text, /填上当前余额和每次大约消耗/);
  assert.doesNotMatch(text, /体检|升级检测|暂存包|快照|心跳|鲸鱼|app\.asar/);
  assert.equal(ui.fetches.length, 1);
  assert.equal(JSON.parse(ui.fetches[0].init.body).via, 'bundle');
  assert.equal(ui.fetches[0].init.headers['x-dsh-up-t'], '1');
});

await check('余额算出还能用几次，消耗为 0 或没填时说人话', () => {
  const ui = mount();
  ui.act(() => findAction(ui.tree, 'balance').props.onChange({ target: { value: '20' } }));
  assert.match(ui.text(), /余额已记下/);
  ui.act(() => findAction(ui.tree, 'cost').props.onChange({ target: { value: '0.8' } }));
  assert.match(ui.text(), /大约还能用 25 次/);
  assert.match(ui.text(), /余额 20 · 约 25 次/);
  const saved = JSON.parse(ui.store.get('dsh-up-t:prefs'));
  assert.equal(saved.balance, '20');
  assert.equal(saved.cost, '0.8');
  assert.ok(ui.events.includes('dsh-up-t:prefs'));

  ui.act(() => findAction(ui.tree, 'cost').props.onChange({ target: { value: '0' } }));
  assert.match(ui.text(), /每次消耗要大于 0/);
  ui.act(() => findAction(ui.tree, 'balance').props.onChange({ target: { value: '' } }));
  ui.act(() => findAction(ui.tree, 'cost').props.onChange({ target: { value: '' } }));
  assert.match(ui.text(), /填上当前余额和每次大约消耗/);
});

await check('关掉角落显示就不再给出那一行余额条文案', () => {
  const ui = mount({ 'dsh-up-t:prefs': JSON.stringify({ balance: '8', cost: '2', showBalance: true }) });
  assert.match(ui.text(), /余额 8 · 约 4 次/);
  ui.act(() => findAction(ui.tree, 'show-balance').props.onChange({ target: { checked: false } }));
  assert.doesNotMatch(ui.text(), /余额 8/);
  assert.equal(JSON.parse(ui.store.get('dsh-up-t:prefs')).showBalance, false);
});

await check('选中的默认背景会写进偏好，并清掉自定义图', () => {
  const ui = mount({ 'dsh-up-t:prefs': JSON.stringify({ customBackground: 'data:image/gif;base64,abc', background: 'night' }) });
  assert.ok(findAction(ui.tree, 'clear-custom'));
  let flow = null;
  walk(ui.tree, (el) => {
    if (el.props && el.props['data-preset'] === 'flow') flow = el;
  });
  ui.act(() => flow.props.onClick());
  const saved = JSON.parse(ui.store.get('dsh-up-t:prefs'));
  assert.equal(saved.background, 'flow');
  assert.equal(saved.customBackground, '');
  assert.equal(findAction(ui.tree, 'clear-custom'), null);
});

await check('自己的动图：类型不对、太大、以及一张合法 GIF', async () => {
  const ui = mount();
  ui.act(() => findAction(ui.tree, 'file').props.onChange({ target: { files: [{ name: 'a.txt', type: 'text/plain', size: 10 }] } }));
  assert.match(ui.text(), /请选图片/);

  ui.act(() => findAction(ui.tree, 'file').props.onChange({ target: { files: [{ name: 'a.gif', type: 'image/gif', size: 2_000_000 }] } }));
  assert.match(ui.text(), /超过 1\.5 MB/);

  const gif = 'data:image/gif;base64,R0lGODlhAQABAIABAP///wAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
  sandboxFile(ui, gif);
  ui.act(() => findAction(ui.tree, 'file').props.onChange({
    target: { files: [{ name: 'wave.gif', type: 'image/gif', size: 40, _url: gif }] },
  }));
  await new Promise((r) => setImmediate(r));
  ui.act(() => {});
  assert.equal(JSON.parse(ui.store.get('dsh-up-t:prefs')).customBackground, gif);
  assert.doesNotMatch(ui.text(), /请选图片|超过 1\.5 MB/);
});

function sandboxFile(ui, url) {
  ui.sandbox.FileReader = class {
    readAsDataURL(file) {
      this.result = file._url || url;
      queueMicrotask(() => this.onload());
    }
  };
}

await check('WebP 与 APNG 扩展名也可以，读出来必须是 data:image', async () => {
  const ui = mount();
  const webp = 'data:image/webp;base64,UklGRg==';
  sandboxFile(ui, webp);
  ui.act(() => findAction(ui.tree, 'file').props.onChange({
    target: { files: [{ name: 'a.webp', type: '', size: 20, _url: webp }] },
  }));
  await new Promise((r) => setImmediate(r));
  ui.act(() => {});
  assert.equal(JSON.parse(ui.store.get('dsh-up-t:prefs')).customBackground, webp);

  ui.act(() => findAction(ui.tree, 'file').props.onChange({
    target: { files: [{ name: 'a.apng', type: '', size: 20, _url: 'data:text/plain,nope' }] },
  }));
  await new Promise((r) => setImmediate(r));
  ui.act(() => {});
  assert.match(ui.text(), /不是可用的图片/);
  assert.equal(JSON.parse(ui.store.get('dsh-up-t:prefs')).customBackground, webp);
});

await check('再看一次只发重播事件', () => {
  const ui = mount();
  ui.act(() => findAction(ui.tree, 'replay').props.onClick());
  assert.ok(ui.events.includes('dsh-up-t:replay'));
});

await check('存不下自定义图时留一句，不把开关弄丢', () => {
  const ui = mount();
  ui.sandbox.localStorage.fail = true;
  ui.act(() => findAction(ui.tree, 'boot').props.onChange({ target: { checked: false } }));
  assert.match(ui.text(), /没能保存/);
  assert.equal(findAction(ui.tree, 'boot').props.checked, false);
});

const failed = results.filter((r) => !r.ok);
for (const r of results) {
  console.log(`${r.ok ? '  ok  ' : ' FAIL '} ${r.name}`);
  if (!r.ok) console.log(`        ${r.err?.stack ?? r.err}`);
}
if (failed.length) {
  console.log(`设置页单测失败：${failed.length}/${results.length}`);
  process.exit(1);
}
console.log(`设置页单测通过：${results.length}/${results.length} 项`);
