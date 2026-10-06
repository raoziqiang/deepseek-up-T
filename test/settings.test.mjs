// deepseek-up-T :: 设置页与桌面挂件开关（plugins/dsh-up-t/lib/client.js）的离线渲染单测
//
// 为什么要有它：设置里那一页「deepseek-up-T」和「通用」里那一行挂件开关，**从来没有被渲染过**。
// test/plugin.test.mjs（55 条）钉住的是**形状** —— 槽位注册签名、`inject` 声明、条目 id/order ——
// 它给 bundle 的 React 是个 stub（`useState` 只回初值、`useEffect` 什么都不做），组件函数**没被调用过**。
// 形状对而组件在真渲染里抛错，表现同样是「设置里没有那一页」：没有报错、没有堆栈、没有白屏提示。
//
// 所以这里补上「真的渲染一遍」，分两半，各自证明不同的事：
//   ① 显示层用**外壳真实提供的 React**（profiles/node_modules/react@18.3.1）渲染成 HTML。
//      它证明：平台模块确实 require 得到、纯展示组件在真 React 下不抛错、aria 属性与文案都对。
//   ② 数据流与生命周期用**迷你 hook 主机**（自己实现 useState/useEffect 的组件树）。
//      SSR 不跑 effect，而这段代码的价值几乎全在 effect 里：拉 status.json、30 秒轮询、
//      桥的 state()/onChange、切换失败要回退、卸载要撤监听。迷你主机让这些真的跑起来。
//      它的局限当场被断言钉住：只支持空依赖数组的 useEffect（本 bundle 里全是 `[]`），
//      一旦有人加了依赖数组，这套假主机会**报错要求扩展它**，而不是蒙过去给个假绿。
//
// 注：React 是 DSH 外壳冻结的平台模块，不 vendored 进本仓库。缺了它 → 打印 SKIP 并跳过 ①，
// ②（真的行为路径）照常跑。这个取舍写在下面 reactWhy 那段里。
//
//   node test/settings.test.mjs

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { resolvePaths } from '../src/paths.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '..');
const P = resolvePaths();
const CLIENT_SRC = readFileSync(path.join(PROJECT, 'plugins', 'dsh-up-t', 'lib', 'client.js'), 'utf8');

const CLIENT_PATH = '/dsh-up-t/client.js'; // eslint-disable-line no-unused-vars
const STATUS_PATH = '/dsh-up-t/status.json';
const ACTIONS_PATH = '/dsh-up-t/action';
const SEEN_PATH = '/dsh-up-t/seen';

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, err });
  }
}
function skip(name, why) {
  results.push({ name, skip: true, why });
}

// ── ① 外壳真实提供的 React ──────────────────────────────────────────
//
// 用 createRequire 指向 `profiles/node_modules`（宿主包的共享提升位置）来解析 `react` ——
// 不是从本仓库解析：React 是平台模块，仓库里本来就没有它，假装有（自己写一个）就测不到
// 「require('react') 到底解析不解析得到」这件最该被钉住的事。

let React = null;
let renderToStaticMarkup = null;
let reactWhy = null;
try {
  const req = createRequire(path.join(P.hostModules, 'deepseek-up-t-offline-test.cjs'));
  React = req('react');
  ({ renderToStaticMarkup } = req('react-dom/server'));
  if (typeof React.createElement !== 'function' || typeof React.useState !== 'function') {
    throw new Error('拿到的 react 形状不对');
  }
  if (typeof renderToStaticMarkup !== 'function') throw new Error('拿到的 react-dom/server 形状不对');
} catch (err) {
  reactWhy = err && err.message ? err.message : String(err);
  React = null;
  renderToStaticMarkup = null;
}

// ── ② 迷你 hook 主机 ────────────────────────────────────────────────
//
// 只实现本 bundle 用到的那一件小事：函数组件 + useState + useEffect([]) + 重渲染 + 卸载。
// 刻意**不**做批处理调度、不做 key 复用 —— 那些不是这里要证明的东西。它要证明的是
// 「这些 effect 里的分支真的按预期跑过、并且改到了界面上的字」。

function makeHookHost() {
  const stats = { passes: 0, updates: 0, effectsRun: 0, cleanups: 0, depsSeen: [], cleanupErrors: [] };
  let frames = new Map();
  let pendingEffects = [];
  let dirty = false;
  let currentFrame = null;
  let rootEl = null;
  let tree = null;

  function flattenChildren(list, out = []) {
    for (const c of list) {
      if (Array.isArray(c)) flattenChildren(c, out);
      else if (c !== null && c !== undefined && typeof c !== 'boolean') out.push(c);
    }
    return out;
  }

  function addTo(list, value) {
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) {
      value.forEach((v) => addTo(list, v));
      return;
    }
    list.push(value);
  }

  function useState(initial) {
    const frame = currentFrame;
    const index = frame.cursor++;
    if (!(index in frame.hooks)) frame.hooks[index] = typeof initial === 'function' ? initial() : initial;
    return [
      frame.hooks[index],
      function set(next) {
        const value = typeof next === 'function' ? next(frame.hooks[index]) : next;
        if (Object.is(value, frame.hooks[index])) return;
        frame.hooks[index] = value;
        stats.updates++;
        dirty = true;
      },
    ];
  }

  function useEffect(fn, deps) {
    const frame = currentFrame;
    const index = frame.cursor++;
    stats.depsSeen.push(deps);
    if (deps !== undefined && (!Array.isArray(deps) || deps.length !== 0)) {
      // 这里必须响亮地失败：假主机不支持依赖数组，蒙过去的代价是「以为测了、其实没跑」。
      throw new Error(
        `迷你 hook 主机只实现了空依赖数组的 useEffect，这里出现了 deps=${JSON.stringify(deps)}。` +
          '需要先扩展假主机，不能蒙过去。',
      );
    }
    if (!frame.effects[index]) {
      frame.effects[index] = { ran: false, cleanup: null };
      pendingEffects.push({ frame, index, fn });
    }
  }

  function createElement(type, props, ...children) {
    return { $$el: true, type, props: props || {}, children: flattenChildren(children) };
  }

  function frameFor(key) {
    let frame = frames.get(key);
    if (!frame) {
      frame = { key, hooks: [], effects: {} };
      frames.set(key, frame);
    }
    frame.cursor = 0;
    return frame;
  }

  function renderNode(node, key) {
    if (node === null || node === undefined || typeof node === 'boolean') return null;
    if (Array.isArray(node)) {
      const out = [];
      node.forEach((child, i) => addTo(out, renderNode(child, `${key}:${i}`)));
      return out;
    }
    if (typeof node === 'string' || typeof node === 'number') return { $$text: String(node) };
    if (!node || node.$$el !== true) {
      throw new Error(`迷你 hook 主机收到了非 createElement 产物：${String(node)}`);
    }

    const { type, props, children } = node;
    if (typeof type === 'function') {
      const frame = frameFor(key);
      const prev = currentFrame;
      currentFrame = frame;
      let out;
      try {
        out = type(Object.assign({}, props, { children: children.length === 1 ? children[0] : children }));
      } finally {
        currentFrame = prev;
      }
      return renderNode(out, `${key}>0`);
    }

    const kids = [];
    children.forEach((child, i) => addTo(kids, renderNode(child, `${key}>${i}`)));
    return { $$host: true, type, props: props || {}, children: kids };
  }

  function runPendingEffects() {
    const list = pendingEffects;
    pendingEffects = [];
    for (const item of list) {
      const slot = item.frame.effects[item.index];
      if (!slot || slot.ran) continue;
      slot.ran = true;
      const cleanup = item.fn();
      stats.effectsRun++;
      if (typeof cleanup === 'function') slot.cleanup = cleanup;
    }
  }

  function flush() {
    let guard = 0;
    do {
      dirty = false;
      tree = renderNode(rootEl, 'root');
      stats.passes++;
      runPendingEffects();
      guard++;
    } while (dirty && guard < 25);
    if (guard >= 25) throw new Error('迷你 hook 主机：渲染 25 轮仍未收敛（疑似 setState 死循环）');
    return tree;
  }

  function render(Component, props) {
    rootEl = { $$el: true, type: Component, props: props || {}, children: [] };
    return flush();
  }

  function unmount() {
    for (const frame of Array.from(frames.values()).reverse()) {
      for (const key of Object.keys(frame.effects)) {
        const slot = frame.effects[key];
        if (slot && typeof slot.cleanup === 'function') {
          try {
            slot.cleanup();
          } catch (err) {
            stats.cleanupErrors.push(String(err && err.message ? err.message : err));
          }
          slot.cleanup = null;
          stats.cleanups++;
        }
      }
    }
    frames = new Map();
    pendingEffects = [];
    rootEl = null;
    tree = null;
  }

  function textOf(node = tree) {
    if (node === null || node === undefined) return '';
    if (Array.isArray(node)) return node.map((n) => textOf(n)).join('');
    if (node.$$text !== undefined) return node.$$text;
    return (node.children || []).map((n) => textOf(n)).join('');
  }

  function findAll(pred, node = tree, out = []) {
    if (node === null || node === undefined) return out;
    if (Array.isArray(node)) {
      node.forEach((n) => findAll(pred, n, out));
      return out;
    }
    if (node.$$host) {
      if (pred(node)) out.push(node);
    }
    (node.children || []).forEach((n) => findAll(pred, n, out));
    return out;
  }

  return {
    react: { createElement, useState, useEffect },
    render,
    flush,
    unmount,
    text: textOf,
    findAll,
    hosts: () => findAll(() => true),
    buttons: () => findAll((n) => n.type === 'button'),
    inputs: () => findAll((n) => n.type === 'input'),
    buttonWith(label) {
      const hit = findAll((n) => n.type === 'button').find((b) => textOf(b).includes(label));
      assert.ok(hit, `界面上没有写着「${label}」的按钮（现有按钮：${findAll((n) => n.type === 'button').map((b) => textOf(b)).join(' / ')}）`);
      return hit;
    },
    get tree() {
      return tree;
    },
    stats,
  };
}

// ── ③ 在 vm 里按 ModuleLoader 协议加载 bundle ────────────────────────
//
// 与 test/plugin.test.mjs 同一套做法：stub 一个 `window.__ModuleLoader__` 抓下 factory，
// 再由我们**从宿主 realm** 调 factory —— 这样 `require('react')` 给什么就由我们决定，
// 而且返回的元素对象落在宿主 realm，断言才认得出。
//
// `fetch` / `setInterval` / `console.warn` 解析到的是 **vm 沙箱的全局**，
// 所以要用转发壳把它们接到本测试可观测的地方。

let clientFetch = () => Promise.reject(new Error('offline'));
const warnings = []; // 全程累计，不随加载重置 —— 收尾那条断言要的是「一共只该响一次」
let confirms = [];
let confirmAnswer = true;
let intervals = [];
let clearedIntervals = [];
let offRoute = [];

function loadClientBundle({ require: requireFn, bridge, withLoader = true } = {}) {
  let captured = null;
  confirms = [];
  intervals = [];
  clearedIntervals = [];
  offRoute = [];

  const win = withLoader ? { __ModuleLoader__: { load: (spec) => { captured = spec; } } } : {};
  win.confirm = (message) => {
    confirms.push(message);
    return confirmAnswer;
  };
  if (bridge !== undefined) win.dshWhaleCharm = bridge;

  const sandbox = {
    window: win,
    Symbol,
    Object,
    Array,
    JSON,
    Math,
    Error,
    Promise,
    String,
    Number,
    Boolean,
    Date,
    isFinite,
    setInterval: (fn, ms) => {
      intervals.push({ fn, ms });
      return intervals.length;
    },
    clearInterval: (id) => {
      clearedIntervals.push(id);
    },
    fetch: (...args) => clientFetch(...args),
    console: {
      log() {},
      info() {},
      warn: (...args) => warnings.push(args.map(String).join(' ')),
      error: (...args) => warnings.push(args.map(String).join(' ')),
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(CLIENT_SRC, sandbox, { filename: 'plugins/dsh-up-t/lib/client.js' });

  const exports = captured && typeof captured.factory === 'function' ? captured.factory(requireFn) : null;
  return { captured, exports, win };
}

function realRequire(name) {
  if (name === 'react') return React;
  throw new Error(`客户端 bundle 出现了未声明的 require：${name}`);
}

function hostRequire(host) {
  return (name) => {
    if (name === 'react') return host.react;
    throw new Error(`客户端 bundle 出现了未声明的 require：${name}`);
  };
}

// ── ④ 假的 cxt / fetch / 回包 ───────────────────────────────────────

function localeGet({ id = 'zh-CN', throws = false } = {}) {
  return (name) => {
    if (name !== 'locale') return undefined;
    return {
      getLocale() {
        if (throws) throw new Error('locale 服务坏了');
        return { id };
      },
    };
  };
}

function applyTo(exports, { get } = {}) {
  const state = { injected: [], effectLabels: [], registered: [] };
  const ctx = {
    effect(fn, label) {
      state.effectLabels.push(label);
      return fn();
    },
    get,
    slots: {
      inject(key, cb) {
        state.injected.push(key);
        return cb();
      },
      register(entry, component) {
        state.registered.push({ entry, component });
        return () => {};
      },
    },
  };
  exports.apply(ctx);
  return state;
}

function makeFetcher(handler) {
  const calls = [];
  const fetcher = (url, opts) => {
    const call = {
      url,
      method: (opts && opts.method) || 'GET',
      opts: opts || {},
      headers: (opts && opts.headers) || {},
      body: opts && opts.body,
    };
    calls.push(call);
    let out;
    try {
      out = handler(call);
    } catch (err) {
      return Promise.reject(err);
    }
    return Promise.resolve(out);
  };
  fetcher.calls = calls;
  return fetcher;
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function htmlResponse(text, status) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      throw new SyntaxError('Unexpected token <');
    },
    text: async () => text,
  };
}

function statusPayload(over = {}) {
  return Object.assign(
    {
      ok: true,
      time: '2026-10-06T17:12:33.000Z',
      plugin: { name: 'dsh-up-t', version: '0.0.1' },
      install: {
        dir: 'D:\\Program Files (x86)\\deepseekharness',
        version: '44.0.0',
        asarBytes: 121348951,
        backupBytes: 121348951,
        judgedBy: 'size',
        sameSizeAsBackup: true,
      },
      heartbeat: { stage: 'ready', pid: 30488, routes: ['a', 'b', 'c', 'd'] },
      clientSeen: { sources: { bundle: '2026-10-06T17:00:00.000Z' } },
    },
    over,
  );
}

function actionsPayload(specs) {
  return {
    ok: true,
    specs:
      specs ||
      [
        { name: 'doctor', label: '体检（宿主给的标签）', hint: '只读', writes: false },
        { name: 'upgrade', label: '升级检测（宿主给的标签）', hint: '只读', writes: false },
        { name: 'upgradeStage', label: '重打到暂存包（宿主给的标签）', hint: '会写盘', writes: true },
        { name: 'snapshotCreate', label: '留一份快照（宿主给的标签）', hint: '会写盘', writes: true },
      ],
  };
}

/**
 * 一个「像真宿主」的 fetch：三条路由，各给各的回包。
 * 请求了别的地址一律记进 offRoute（收尾断言：这个 bundle 只该用这三条路由）。
 */
function scenarioFetch({ status = statusPayload(), actions = actionsPayload(), post = { ok: true, code: 0, ms: 1234, stdout: '0 错误 2 警告' }, onPost, onStatus } = {}) {
  return makeFetcher((call) => {
    if (call.url === SEEN_PATH) return jsonResponse({ ok: true });
    if (call.url === STATUS_PATH) {
      if (onStatus) return onStatus(call);
      return typeof status === 'function' ? status(call) : jsonResponse(status);
    }
    if (call.url === ACTIONS_PATH) {
      if (call.method === 'GET') return typeof actions === 'function' ? actions(call) : jsonResponse(actions);
      if (onPost) return onPost(call);
      return jsonResponse(post);
    }
    offRoute.push(`${call.method} ${call.url}`);
    return Promise.reject(new Error('不该请求这个地址'));
  });
}

/** 装载一个「假 React 主机」版本的 bundle，并跑一遍 apply()。 */
function loadWithHost({ bridge, locale } = {}) {
  const host = makeHookHost();
  const loaded = loadClientBundle({ require: hostRequire(host), bridge });
  const state = applyTo(loaded.exports, { get: localeGet(locale) });
  assert.equal(state.registered.length, 2, 'apply() 必须注册两个条目（设置页 + 挂件开关）');
  return { host, loaded, state, upT: state.registered[0].component, charm: state.registered[1].component };
}

async function settle(host, times = 6) {
  for (let i = 0; i < times; i++) {
    await new Promise((resolve) => setImmediate(resolve));
    host.flush();
  }
}

// ══ ① 真 React（真外壳模块）渲染成 HTML ═══════════════════════════════
//
// 这一组回答的是「设置里那一页会不会白屏」里最基础的一半：组件在**真 React** 下渲染不抛错。
// 剩下那一半（数据流）在 ② 组里用迷你主机跑。

if (!React) {
  for (const name of [
    '能解析到外壳真实提供的 react@18 与 react-dom/server',
    '挂件开关那一行在真 React 下渲染出正确的 role/aria 与文案',
    '设置页第一次渲染（真 React）不抛错，并显示「正在读取…」与「操作」',
  ]) {
    skip(name, `解析不到 react：${reactWhy}`);
  }
} else {
  clientFetch = scenarioFetch();

  const realLoaded = loadClientBundle({ require: realRequire });
  const realState = applyTo(realLoaded.exports, { get: localeGet() });
  const realExports = realLoaded.exports;
  const zh = realExports.__charmCopy('zh-CN');
  const en = realExports.__charmCopy('en');
  const CJK = /[\u3400-\u9fff]/;

  await check('能解析到外壳真实提供的 react@18 与 react-dom/server', () => {
    assert.equal(String(React.version).split('.')[0], '18', `React 版本是 ${React.version}`);
    assert.equal(typeof React.useState, 'function');
    assert.equal(typeof renderToStaticMarkup, 'function');
  });

  await check('挂件开关的两份文案：中文有汉字、英文一个汉字都没有', () => {
    assert.ok(CJK.test(zh.title + zh.desc + zh.on + zh.off + zh.hint + zh.loading + zh.unavailable + zh.failed), '中文文案必须有汉字');
    const enAll = Object.values(en).join(' ');
    assert.ok(!CJK.test(enAll), `英文文案里混进了汉字：${enAll}`);
    assert.notEqual(zh.on, en.on);
    assert.equal(zh.title, '桌面鲸鱼挂件');
    assert.equal(en.title, 'Desktop whale charm');
  });

  const view = (props) => renderToStaticMarkup(React.createElement(realExports.__charmView, props));

  await check('开着的时候：role=switch / aria-checked=true / data-on=true，按钮可点', () => {
    const html = view({ copy: zh, available: true, enabled: true, onToggle() {} });
    assert.ok(html.includes('data-dsh-up-t="charm"'), html);
    assert.ok(html.includes('role="switch"'), html);
    assert.ok(html.includes('aria-checked="true"'), html);
    assert.ok(html.includes('data-on="true"'), html);
    assert.ok(html.includes('data-available="true"'), html);
    assert.ok(html.includes(zh.on), '必须显示「已开启」');
    assert.ok(html.includes(zh.title), '标题要显示');
    assert.ok(html.includes(zh.hint), '可用时给出「开启后立刻出现」这句提示');
    assert.ok(!html.includes('disabled'), `可用且开着时按钮必须能点：${html}`);
  });

  await check('关着的时候：aria-checked=false，按钮同样可点', () => {
    const html = view({ copy: zh, available: true, enabled: false, onToggle() {} });
    assert.ok(html.includes('aria-checked="false"'), html);
    assert.ok(html.includes('data-on="false"'), html);
    assert.ok(html.includes(zh.off), '必须显示「已关闭」');
    assert.ok(!html.includes('disabled'), html);
  });

  await check('桥不在时：按钮禁用 + 说清「只有桌面版才有」，且不给那句可点提示', () => {
    const html = view({ copy: zh, available: false, enabled: false });
    assert.ok(html.includes('disabled=""'), `按钮必须禁用：${html}`);
    assert.ok(html.includes('data-available="false"'), html);
    assert.ok(html.includes(zh.unavailable), '要如实说是「这个窗口里没有挂件通道」');
    assert.ok(!html.includes(zh.hint), '不可用时不该显示「开启后立刻出现」');
    const htmlEn = view({ copy: en, available: false, enabled: false });
    assert.ok(htmlEn.includes(en.unavailable), htmlEn);
    assert.ok(!CJK.test(htmlEn.replace(/<[^>]+>/g, '')), `英文界面里不该出现汉字：${htmlEn}`);
  });

  await check('busy 时按钮禁用，但显示的是**当前状态**而不是「正在…」', () => {
    const on = view({ copy: zh, available: true, enabled: true, busy: true });
    assert.ok(on.includes('disabled=""'), on);
    assert.ok(on.includes(zh.on), '切换中不能把「已开启」换成别的字 —— 那会让人以为状态变了');
    const off = view({ copy: zh, available: true, enabled: false, busy: true });
    assert.ok(off.includes(zh.off), off);
  });

  await check('切换失败时那一行自己说出失败，而不是静默回原样', () => {
    const html = view({ copy: zh, available: true, enabled: true, failed: true });
    assert.ok(html.includes(zh.failed), html);
    assert.ok(html.includes(zh.title), html);
  });

  await check('设置页第一次渲染（真 React）不抛错，并显示「正在读取…」与「操作」', () => {
    const html = renderToStaticMarkup(React.createElement(realState.registered[0].component));
    assert.ok(html.includes('正在读取…'), `首屏必须给出「正在读取…」：${html.slice(0, 400)}`);
    assert.ok(html.includes('操作'), '「操作」小标题在首屏就该在');
    assert.ok(html.includes('正在读取操作清单…'), '按钮区的首屏状态也要有');
    assert.ok(html.includes('settings.section'), '页面自己说明它挂在哪个槽位');
    assert.ok(!/NaN|undefined/.test(html), `界面里不该出现 NaN/undefined：${html.match(/.{0,40}(NaN|undefined).{0,40}/)}`);
  });

  await check('挂件开关那一行第一次渲染（真 React）不抛错，显示「正在读取挂件状态…」', () => {
    const html = renderToStaticMarkup(React.createElement(realState.registered[1].component));
    assert.ok(html.includes(zh.loading), `首屏必须给出「正在读取挂件状态…」：${html}`);
  });
}

// ══ ② 迷你 hook 主机：设置页的数据流 ═════════════════════════════════

await check('apply() 用两个 effect 向两个槽位注册，并声明注入 slots + locale', () => {
  clientFetch = scenarioFetch();
  const t = loadWithHost();
  assert.deepEqual(Array.from(t.loaded.exports.inject), ['slots', 'locale']);
  assert.deepEqual(t.state.injected, ['settings.section', 'settings.general.item']);
  assert.equal(t.state.effectLabels.length, 2);
  assert.equal(typeof t.upT, 'function');
  assert.equal(typeof t.charm, 'function');
});

await check('渲染之后先握手：POST /dsh-up-t/seen，via 写 bundle', () => {
  clientFetch = scenarioFetch();
  loadWithHost();
  const seen = clientFetch.calls.filter((c) => c.url === SEEN_PATH);
  assert.equal(seen.length, 1, '握手应当只发一次');
  assert.equal(seen[0].method, 'POST');
  assert.equal(seen[0].headers['x-dsh-up-t'], '1');
  assert.deepEqual(JSON.parse(seen[0].body), { via: 'bundle' });
});

await check('握手自己炸掉也不影响注册（证据不该变成功能）', () => {
  const boom = () => {
    throw new Error('fetch 都不可用');
  };
  clientFetch = boom;
  const t = loadWithHost();
  assert.equal(t.state.registered.length, 2);
});

await check('设置页点名要 /dsh-up-t/status.json，且带 cache:no-store', () => {
  clientFetch = scenarioFetch();
  const t = loadWithHost();
  t.host.render(t.upT);
  const call = clientFetch.calls.find((c) => c.url === STATUS_PATH);
  assert.ok(call, '必须去读 status.json');
  assert.equal(call.method, 'GET');
  assert.equal(call.opts.cache, 'no-store', '状态页不能被缓存');
  assert.ok(t.host.text().includes('正在读取…'), '末解析出来之前先说「正在读取…」');
});

await check('status 回来之后八行事实全渲染成人话（含心跳与渲染层握手）', async () => {
  clientFetch = scenarioFetch();
  const t = loadWithHost();
  t.host.render(t.upT);
  await settle(t.host);
  const text = t.host.text();
  assert.ok(text.includes('dsh-up-t 0.0.1'), text);
  assert.ok(text.includes('44.0.0'), 'Harness 版本');
  assert.ok(text.includes('115.7 MB'), `大小要转成人话：${text}`);
  assert.ok(text.includes('未改造（app.asar 与原版备份大小相同）'), text);
  assert.ok(text.includes('服务已就绪（路由 4 条）'), text);
  assert.ok(text.includes('pid 30488'), text);
  assert.ok(text.includes('渲染层已握手（bundle）'), '握手那一格是「浏览器里到底跑了没有」的唯一证据');
  assert.ok(text.includes('2026-10-06T17:12:33.000Z'), text);
  assert.ok(!text.includes('正在读取'), '拿到数据之后不该还显示「正在读取」');
  assert.ok(text.includes('只比了文件大小'), '这一页必须自己说明判据是大小而不是 sha256');
});

await check('判定分三态：大小不同说「已被改造」', async () => {
  const payload = statusPayload();
  payload.install.sameSizeAsBackup = false;
  payload.install.asarBytes = 121415608;
  clientFetch = scenarioFetch({ status: payload });
  const t = loadWithHost();
  t.host.render(t.upT);
  await settle(t.host);
  assert.ok(t.host.text().includes('已被改造（app.asar 与原版备份大小不同）'), t.host.text());
});

await check('判定分三态：拿不到可比大小时说「无法判断」，不许诬成「不同」', async () => {
  const payload = statusPayload();
  payload.install.judgedBy = 'none';
  payload.install.sameSizeAsBackup = null;
  clientFetch = scenarioFetch({ status: payload });
  const t = loadWithHost();
  t.host.render(t.upT);
  await settle(t.host);
  const text = t.host.text();
  assert.ok(text.includes('无法判断'), text);
  assert.ok(text.includes('宿主这次没拿到可比的大小'), text);
  assert.ok(!text.includes('已被改造'), '拿不到事实时不能说「已被改造」');
});

await check('读不到安装目录时，把「试过并否掉的路径」也说出来（那才是为什么）', async () => {
  const payload = statusPayload({
    install: null,
    installRejected: [
      { asar: 'D:\\Program Files (x86)\\deepseekharness\\resources\\app.asar', why: '文件不存在' },
      { asar: 'D:\\other\\app.asar', why: '没有读权限' },
    ],
  });
  clientFetch = scenarioFetch({ status: payload });
  const t = loadWithHost();
  t.host.render(t.upT);
  await settle(t.host);
  const text = t.host.text();
  assert.ok(text.includes('读不到安装目录信息'), text);
  assert.ok(text.includes('试过并否掉的路径'), text);
  assert.ok(text.includes('文件不存在') && text.includes('没有读权限'), text);
  assert.ok(text.includes('被否掉的路径'), '单独一行列出被否掉的路径');
});

await check('status 读失败时页面写「读取失败：…」，而不是空着', async () => {
  clientFetch = scenarioFetch({ onStatus: () => Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:19387')) });
  const t = loadWithHost();
  t.host.render(t.upT);
  await settle(t.host);
  const text = t.host.text();
  assert.ok(text.includes('读取失败：'), text);
  assert.ok(text.includes('ECONNREFUSED'), '原始错误要带出来，否则无从查起');
  assert.ok(text.includes('操作'), '事实读不到，操作区仍应在');
});

await check('30 秒轮询真的注册了；卸载时定时器被清掉（不留后台循环）', async () => {
  clientFetch = scenarioFetch();
  const t = loadWithHost();
  t.host.render(t.upT);
  await settle(t.host);
  assert.equal(intervals.length, 1, '应当恰好注册一个轮询定时器');
  assert.equal(intervals[0].ms, 30000, '轮询间隔 30 秒');
  t.host.unmount();
  assert.deepEqual(clearedIntervals, [1], '卸载必须清掉轮询');
  assert.equal(t.host.tree, null);
});

await check('卸载之后迟到的 status 响应不会再改状态、也不抛错', async () => {
  let release = null;
  clientFetch = scenarioFetch({ onStatus: () => new Promise((resolve) => { release = resolve; }) });
  const t = loadWithHost();
  t.host.render(t.upT);
  await settle(t.host, 1);
  assert.equal(typeof release, 'function', 'status 请求应当已经发出且挂着');
  t.host.unmount();
  release(jsonResponse(statusPayload()));
  await settle(t.host);
  assert.equal(t.host.tree, null);
  assert.deepEqual(t.host.stats.cleanupErrors, []);
});

// ══ ③ 迷你 hook 主机：操作按钮（真的会 spawn 命令的那一段）═══════════

await check('操作清单来自宿主（GET /dsh-up-t/action），不是硬编码 —— 标签原样上屏', async () => {
  clientFetch = scenarioFetch();
  const t = loadWithHost();
  t.host.render(t.upT);
  await settle(t.host);
  const call = clientFetch.calls.find((c) => c.url === ACTIONS_PATH);
  assert.ok(call, '必须去问宿主要清单');
  assert.equal(call.method, 'GET');
  const text = t.host.text();
  assert.ok(text.includes('体检（宿主给的标签）'), `按钮文字必须原样用宿主给的 label：${text}`);
  assert.ok(text.includes('重打到暂存包（宿主给的标签）'), text);
  assert.equal(t.host.buttons().length, 4, '四个操作各一个按钮');
  assert.ok(text.includes('带 ⚠ 的会改动磁盘'), '要说明 ⚠ 是什么意思');
});

await check('会改盘的操作带 ⚠，只读的不带', async () => {
  clientFetch = scenarioFetch();
  const t = loadWithHost();
  t.host.render(t.upT);
  await settle(t.host);
  assert.ok(t.host.text(t.host.buttonWith('体检（宿主给的标签）')).includes('⚠') === false, '只读操作不该带 ⚠');
  assert.ok(t.host.text(t.host.buttonWith('留一份快照（宿主给的标签）')).includes('⚠'), '会写盘的操作必须带 ⚠');
});

await check('宿主半侧还没重启（GET /action 404）时说清「重启后回来」', async () => {
  clientFetch = scenarioFetch({ actions: () => htmlResponse('<!doctype html><h1>404</h1>', 404) });
  const t = loadWithHost();
  t.host.render(t.upT);
  await settle(t.host);
  const text = t.host.text();
  assert.ok(text.includes('暂时用不了'), text);
  assert.ok(text.includes('HTTP 404'), text);
  assert.ok(text.includes('重启 Harness'), '必须给出下一步，而不是只说失败');
  assert.ok(text.includes('重启后回到本页'), text);
  assert.ok(text.includes('硬刷新'), text);
  assert.equal(t.host.buttons().length, 0, '清单没拿到就不该有按钮');
});

await check('点会改盘的操作先问一句；答「不」时一个请求都不发', async () => {
  clientFetch = scenarioFetch();
  const t = loadWithHost();
  t.host.render(t.upT);
  await settle(t.host);
  const before = clientFetch.calls.length;
  confirmAnswer = false;
  t.host.buttonWith('留一份快照（宿主给的标签）').props.onClick({});
  await settle(t.host);
  assert.equal(confirms.length, 1, '必须问一次');
  assert.ok(confirms[0].includes('留一份快照（宿主给的标签）'), confirms[0]);
  assert.ok(confirms[0].includes('会改动磁盘'), confirms[0]);
  const posts = clientFetch.calls.slice(before).filter((c) => c.method === 'POST');
  assert.equal(posts.length, 0, '答「不」时一个请求都不该发出去');
  confirmAnswer = true;
});

await check('只读的操作不问，点了就跑：POST + 自定义头 + JSON body（含备注）', async () => {
  clientFetch = scenarioFetch();
  const t = loadWithHost();
  t.host.render(t.upT);
  await settle(t.host);

  const input = t.host.inputs()[0];
  assert.ok(input, '应当有一个备注输入框');
  input.props.onChange({ target: { value: '改前留档' } });
  t.host.flush();

  t.host.buttonWith('留一份快照（宿主给的标签）').props.onClick({});
  await settle(t.host);
  const posts = clientFetch.calls.filter((c) => c.method === 'POST' && c.url === ACTIONS_PATH);
  assert.equal(posts.length, 1, '应当恰好发一个 POST');
  assert.equal(confirms.length, 1, '会写盘的操作要先问一次');
  assert.equal(posts[0].headers['x-dsh-up-t'], '1', '自定义头是宿主半侧的守卫之一');
  assert.equal(posts[0].headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(posts[0].body), { action: 'snapshotCreate', message: '改前留档' }, '备注要跟着请求一起发出去');

  const before = clientFetch.calls.filter((c) => c.method === 'POST').length;
  t.host.buttonWith('体检（宿主给的标签）').props.onClick({});
  await settle(t.host);
  assert.equal(clientFetch.calls.filter((c) => c.method === 'POST').length, before + 1);
  assert.equal(confirms.length, 1, '只读操作不该弹确认框');
});

await check('跑完把退出码、耗时与 stdout 显示出来', async () => {
  clientFetch = scenarioFetch();
  const t = loadWithHost();
  t.host.render(t.upT);
  await settle(t.host);
  t.host.buttonWith('体检（宿主给的标签）').props.onClick({});
  await settle(t.host);
  const text = t.host.text();
  assert.ok(text.includes('成功'), text);
  assert.ok(text.includes('退出码 0'), text);
  assert.ok(text.includes('1234 ms'), text);
  assert.ok(text.includes('0 错误 2 警告'), 'stdout 要原文给出来');
});

await check('旧宿主返回非 JSON（404 HTML）时说清「需要重启 Harness」', async () => {
  clientFetch = scenarioFetch({ onPost: () => htmlResponse('<html>404</html>', 404) });
  const t = loadWithHost();
  t.host.render(t.upT);
  await settle(t.host);
  t.host.buttonWith('体检（宿主给的标签）').props.onClick({});
  await settle(t.host);
  const text = t.host.text();
  assert.ok(text.includes('宿主半侧没有回应合法 JSON（HTTP 404）'), text);
  assert.ok(text.includes('需要重启 Harness'), text);
});

await check('操作失败时显示失败与错误文本', async () => {
  clientFetch = scenarioFetch({ post: { ok: false, code: 1, error: '基线文件读不到' } });
  const t = loadWithHost();
  t.host.render(t.upT);
  await settle(t.host);
  t.host.buttonWith('升级检测（宿主给的标签）').props.onClick({});
  await settle(t.host);
  const text = t.host.text();
  assert.ok(text.includes('失败'), text);
  assert.ok(text.includes('退出码 1'), text);
  assert.ok(text.includes('基线文件读不到'), text);
});

await check('正在跑的时候所有按钮都禁用（不许并发发两条命令）', async () => {
  let release = null;
  clientFetch = scenarioFetch({ onPost: () => new Promise((resolve) => { release = resolve; }) });
  const t = loadWithHost();
  t.host.render(t.upT);
  await settle(t.host);
  t.host.buttonWith('体检（宿主给的标签）').props.onClick({});
  await settle(t.host, 1);
  const buttons = t.host.buttons();
  assert.equal(buttons.length, 4);
  assert.ok(buttons.every((b) => b.props.disabled === true), '跑的过程中四个按钮都该禁用');
  assert.ok(t.host.text().includes('正在跑…'), t.host.text());
  release(jsonResponse({ ok: true, code: 0, ms: 5 }));
  await settle(t.host);
  assert.ok(t.host.buttons().every((b) => b.props.disabled === false), '跑完之后要恢复可点');
});

// ══ ④ 迷你 hook 主机：桌面挂件开关那一行（桥的生命周期）═══════════════

function charmBridge({ state = true, stateReject = null, setResult, setReject = null } = {}) {
  const log = { sets: [], changes: [], offCalls: 0 };
  let listener = null;
  const bridge = {
    state: () => (stateReject ? Promise.reject(new Error(stateReject)) : Promise.resolve(state)),
    set: (value) => {
      log.sets.push(value);
      if (setReject) return Promise.reject(new Error(setReject));
      return Promise.resolve(typeof setResult === 'boolean' ? setResult : value);
    },
    onChange: (fn) => {
      listener = fn;
      log.changes.push(fn);
      return () => {
        log.offCalls++;
        listener = null;
      };
    },
    push: (value) => listener && listener(value),
    log,
  };
  return bridge;
}

await check('桥不在 ⇒ 说清「只有 Harness 桌面版才有」，按钮禁用', async () => {
  clientFetch = scenarioFetch();
  const t = loadWithHost();
  t.host.render(t.charm);
  await settle(t.host);
  const text = t.host.text();
  assert.ok(text.includes('这个窗口里没有挂件通道'), text);
  assert.ok(text.includes('Harness 桌面版'), text);
  const button = t.host.buttons()[0];
  assert.ok(button, '那一行应当有一个开关按钮');
  assert.equal(button.props.disabled, true);
  assert.equal(button.props['aria-checked'], false);
});

await check('桥在且 state() 说开着 ⇒ 显示「已开启」、aria-checked=true、可点', async () => {
  clientFetch = scenarioFetch();
  const bridge = charmBridge({ state: true });
  const t = loadWithHost({ bridge });
  t.host.render(t.charm);
  await settle(t.host);
  assert.ok(t.host.text().includes('已开启'), t.host.text());
  const button = t.host.buttons()[0];
  assert.equal(button.props['aria-checked'], true);
  assert.equal(button.props.disabled, false);
  assert.equal(t.host.text(button), '已开启');
});

await check('桥在但 state() 被拒 ⇒ 说「通道拒绝了这个请求（原因）」，不是「桥不在」', async () => {
  clientFetch = scenarioFetch();
  const bridge = charmBridge({ stateReject: 'No handler registered' });
  const t = loadWithHost({ bridge });
  t.host.render(t.charm);
  await settle(t.host);
  const text = t.host.text();
  assert.ok(text.includes('挂件通道拒绝了这个请求'), text);
  assert.ok(text.includes('No handler registered'), '要把原始原因带出来');
  assert.ok(!text.includes('没有挂件通道'), '桥在就是桥在 —— 别让人去查一个不存在的东西');
});

await check('同一条通道送来的字符串 "replay" 不当成状态（否则开关会显示成关）', async () => {
  clientFetch = scenarioFetch();
  const bridge = charmBridge({ state: true });
  const t = loadWithHost({ bridge });
  t.host.render(t.charm);
  await settle(t.host);
  assert.equal(t.host.text(t.host.buttons()[0]), '已开启');
  bridge.push('replay');
  await settle(t.host);
  assert.equal(t.host.text(t.host.buttons()[0]), '已开启', '字符串不是状态，不许改开关');
  bridge.push(false);
  await settle(t.host);
  assert.equal(t.host.text(t.host.buttons()[0]), '已关闭', '布尔才是状态');
  bridge.push(true);
  await settle(t.host);
  assert.equal(t.host.text(t.host.buttons()[0]), '已开启');
});

await check('点一下调用 bridge.set(想要的值)，并用它返回的值定状态', async () => {
  clientFetch = scenarioFetch();
  const bridge = charmBridge({ state: false, setResult: true });
  const t = loadWithHost({ bridge });
  t.host.render(t.charm);
  await settle(t.host);
  t.host.buttons()[0].props.onClick({});
  await settle(t.host);
  assert.deepEqual(bridge.log.sets, [true], '关着的时候点一下应当请求开启');
  assert.equal(t.host.text(t.host.buttons()[0]), '已开启', '以桥返回的值为准');

  const bridge2 = charmBridge({ state: true, setResult: false });
  const t2 = loadWithHost({ bridge: bridge2 });
  t2.host.render(t2.charm);
  await settle(t2.host);
  t2.host.buttons()[0].props.onClick({});
  await settle(t2.host);
  assert.deepEqual(bridge2.log.sets, [false]);
  assert.equal(t2.host.text(t2.host.buttons()[0]), '已关闭', '桥说没开成，就不许显示成开着');
});

await check('set 被拒 ⇒ 显示切换失败、状态回到原值、并且 console.warn 响一次', async () => {
  clientFetch = scenarioFetch();
  const bridge = charmBridge({ state: true, setReject: '窗口建立失败' });
  const t = loadWithHost({ bridge });
  t.host.render(t.charm);
  await settle(t.host);
  const mark = warnings.length;
  t.host.buttons()[0].props.onClick({});
  await settle(t.host);
  const text = t.host.text();
  assert.ok(text.includes('切换失败'), text);
  assert.equal(t.host.text(t.host.buttons()[0]), '已开启', '失败要回到原来的状态');
  assert.equal(warnings.length, mark + 1, `切换失败必须被记一笔：${JSON.stringify(warnings.slice(mark))}`);
  assert.ok(warnings[mark].includes('切换桌面挂件失败'), warnings[mark]);
});

await check('卸载时把 onChange 的监听撤掉（不留悬挂回调）', async () => {
  clientFetch = scenarioFetch();
  const bridge = charmBridge({ state: false });
  const t = loadWithHost({ bridge });
  t.host.render(t.charm);
  await settle(t.host);
  assert.equal(bridge.log.changes.length, 1, '应当挂上一次监听');
  t.host.unmount();
  await settle(t.host, 1);
  assert.equal(bridge.log.offCalls, 1, '卸载必须撤掉监听');
  bridge.push(true); // 撤掉之后再推，不该有人在听
  await settle(t.host, 1);
  assert.equal(t.host.tree, null);
});

await check('locale 服务抛错时不崩，退回英文', async () => {
  clientFetch = scenarioFetch();
  const t = loadWithHost({ locale: { throws: true } });
  // loadWithHost 的 locale 参数走 localeGet：{throws:true} 会让 getLocale() 抛
  t.host.render(t.charm);
  await settle(t.host);
  const text = t.host.text();
  assert.ok(text.includes('Desktop whale charm'), `取不到语言就该退回英文：${text}`);
  assert.ok(!/[\u3400-\u9fff]/.test(text), `退回英文时不该还有汉字：${text}`);
});

await check('英文语言的 ctx 下整行都是英文', async () => {
  clientFetch = scenarioFetch();
  const t = loadWithHost({ locale: { id: 'en' } });
  t.host.render(t.charm);
  await settle(t.host);
  const text = t.host.text();
  assert.ok(text.includes('Desktop whale charm'), text);
  assert.ok(text.includes('On') || text.includes('Off'), text);
});

// ══ ⑤ 收尾：横向看一遍 ═══════════════════════════════════════════════

await check('迷你 hook 主机的空依赖假设成立（不可用依赖数组蒙过去）', () => {
  const host = makeHookHost();
  assert.deepEqual(host.stats.depsSeen, [], '还没渲染过，不该有记录');
});

await check('全程只响过一次告警，且正是那次预期的「切换挂件失败」', () => {
  assert.equal(warnings.length, 1, `告警应当只有一次，实际：${JSON.stringify(warnings)}`);
  assert.ok(warnings[0].includes('切换桌面挂件失败'), warnings[0]);
});

await check('这个 bundle 只请求那三条路由（没有偷偷打别的地址）', () => {
  assert.deepEqual(offRoute, []);
});

const failed = results.filter((r) => !r.ok);
const skipped = results.filter((r) => r.skip);
for (const r of results) {
  if (r.skip) {
    console.log(`  skip  ${r.name}（${r.why}）`);
    continue;
  }
  console.log(`${r.ok ? '  ok  ' : ' FAIL '} ${r.name}`);
  if (!r.ok) console.log(`        ${r.err?.message ?? r.err}\n${r.err?.stack ?? ''}`);
}
console.log('');
const total = results.length - skipped.length;
if (failed.length) {
  console.log(`设置页单测失败：${failed.length}/${total}`);
  process.exit(1);
}
console.log(`设置页单测通过：${total}/${total} 项${skipped.length ? `（另有 ${skipped.length} 项 SKIP）` : ''}`);
