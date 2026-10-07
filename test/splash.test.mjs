// deepseek-up-T :: 启动界面那几段脚本（whale-animation.js + whale-splash.js + replay.js）的离线行为级单测
//
// 为什么要有它：
// 这几段脚本是 T1 里**唯一从来没有被执行过**的代码 —— 它们只有 `node --check`
// （语法对不对）和逐字节核对（装进去的是不是这一份）。语法正确与「跑起来不抛」之间
// 隔着一整类失败：
//   · 打包（vendor/whale/bundle.mjs 把 ESM 包成经典脚本）可能漏掉某个导出，
//     于是 `window.WhaleSplash` 是 undefined；
//   · 画布 API 用错（坐标变成 NaN、某个方法不存在）在真浏览器里**不会报错**，
//     只会让那一帧什么都不画 —— 表现是「启动窗口一片空白」，控制台干干净净。
// 而启动窗口恰恰是人打开这个应用看到的第一屏，也是唯一没有别的界面兜底的一屏。
//
// 所以这里不查语法：把**归档里真正那两份字节**拿出来，配一个最小的假 DOM
// （假 canvas 2d 上下文、假 requestAnimationFrame、假 matchMedia、假 localStorage），
// 然后真的跑一遍，断言落在「画了什么」和「交互改到了什么」这些具体产物上：
//   ① 跨文件契约成立（whale-splash.js 依赖的 window.WhaleSplash / window.drawWhale 真的在）；
//   ② 时间线真的推进（每一帧都画了东西，跑到末尾真的交出了挂件）；
//   ③ 所有传给画布的坐标都是有限数（NaN 是 canvas 最典型的静默失败）；
//   ④ 拖动 / 键盘 / 主题翻转 / 位置记忆真的改到了该改的状态；
//   ⑤ 三条降级路径（减动效、没有画布、存储被禁）都不抛异常；
//   ⑥ 挂件菜单那条「Replay animation」真的重播（replay.js 会淡出并关掉自己的窗口 ——
//      以前主进程把 'replay' 发给主窗口，而启动画面在欢迎窗口里，那是个空操作）。
//
// 脚本取自**暂存包**（将要落盘的那一份），没有就退到**在用安装包**，两者都没有就 SKIP
// —— 和 test/assets.test.mjs 一样：读不到产物不是「通过」，但也不该谎报失败。
//
//   node test/splash.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import { readAsarEntry } from '../src/asar.mjs';
import { resolvePaths } from '../src/paths.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '..');
const P = resolvePaths();

const ANIMATION_ENTRY = 'lib/welcome/whale-animation.js';
const SPLASH_ENTRY = 'renderer/whale-splash.js';
// 第三段是后来才加进声明的（挂件菜单里的 “Replay animation”）：它**可以缺席** ——
// 在用的安装包里还没有它的时候，只跳过 replay 那一节，其余断言照跑。
const REPLAY_ENTRY = 'renderer/replay.js';

const results = [];
const RUNS = []; // 每次沙箱运行记一笔，最后横向看有没有哪一次是靠异常收场的
async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, err });
  }
}

// ── 找到这两段脚本的字节 ──────────────────────────────────────────────
//
// 顺序 = 「将要落盘的那一份」优先，其次是「正在跑的那一份」。二者都可能与源码仓库不同步，
// 而这里要回答的问题是「用户看到的第一屏会不会是空白」，所以只认归档里的字节。

const SOURCES = [
  { label: '暂存包', file: path.join(PROJECT, 'state', 'staged', 'app.asar') },
  { label: '在用安装包', file: P.asar },
];

function loadScripts() {
  for (const s of SOURCES) {
    if (!fs.existsSync(s.file)) continue;
    let animation = null;
    let splash = null;
    let replay = null;
    try {
      animation = readAsarEntry(s.file, ANIMATION_ENTRY);
      splash = readAsarEntry(s.file, SPLASH_ENTRY);
    } catch {
      continue;
    }
    if (!animation || !splash) continue;
    try {
      replay = readAsarEntry(s.file, REPLAY_ENTRY); // 可选，缺席不算失败
    } catch {
      replay = null;
    }
    return { label: s.label, file: s.file, animation, splash, replay };
  }
  return null;
}

const found = loadScripts();
if (found === null) {
  console.log(`SKIP 归档里还没有这两段脚本（${ANIMATION_ENTRY} / ${SPLASH_ENTRY}）`);
  for (const s of SOURCES) console.log(`      试过 ${s.label}：${s.file}`);
  console.log('      说明：先 `node vendor/whale/build.mjs` 构建一次，或先落盘。');
  console.log('启动界面脚本单测：0 项（无可测产物）');
  process.exit(0);
}

const ANIMATION_SRC = found.animation.toString('utf8');
const SPLASH_SRC = found.splash.toString('utf8');
// replay.js 缺席时 REPLAY_SRC 为 null，replay 那一节整体跳过（见文件末尾）。
const REPLAY_SRC = found.replay ? found.replay.toString('utf8') : null;
console.log(`脚本来源 ${found.label}  ${found.file}`);
console.log(`        ${ANIMATION_ENTRY}  ${found.animation.length} 字节`);
console.log(`        ${SPLASH_ENTRY}  ${found.splash.length} 字节`);
console.log(
  found.replay
    ? `        ${REPLAY_ENTRY}  ${found.replay.length} 字节`
    : `        ${REPLAY_ENTRY}  —— 缺席，跳过 replay 那一节`,
);

// ── 假 canvas 2d 上下文 ───────────────────────────────────────────────
//
// 记号：每个方法调用记一次名字；**每次调用都检查数值参数是不是有限数** ——
// 这是这套测试里最有价值的一条检查：坐标算成 NaN 时真浏览器一声不吭，
// 结果就是「每一帧都被调用、屏幕上什么都没有」。
// 属性赋值（fillStyle 等）也记下来，用来证明深浅两套皮肤真的画得不一样。

const CTX_METHODS = [
  'beginPath', 'bezierCurveTo', 'save', 'restore', 'fill', 'moveTo', 'translate',
  'stroke', 'fillRect', 'arc', 'rect', 'clip', 'quadraticCurveTo', 'closePath',
  'roundRect', 'lineTo', 'scale', 'setTransform', 'clearRect', 'ellipse', 'rotate',
];

function makeCtx2d() {
  const ops = [];
  const bad = []; // 非有限数值参数
  const styled = {}; // 最后一次赋值的属性值
  const styledHistory = []; // 全部赋值（按顺序），用来比较两套皮肤的调色板
  const gradients = [];

  const record = (name, args) => {
    for (const a of args) {
      if (typeof a === 'number' && !Number.isFinite(a)) bad.push(`${name}(${args.join(', ')})`);
    }
    ops.push(name);
  };

  const target = { ops, bad, styled, styledHistory, gradients };
  for (const m of CTX_METHODS) {
    target[m] = (...args) => record(m, args);
  }
  const makeGradient = (name) => (...args) => {
    record(name, args);
    const g = { stops: [] };
    g.addColorStop = (offset, color) => {
      if (typeof offset === 'number' && !Number.isFinite(offset)) bad.push(`addColorStop(${offset})`);
      g.stops.push([offset, color]);
    };
    gradients.push(g);
    return g;
  };
  target.createLinearGradient = makeGradient('createLinearGradient');
  target.createRadialGradient = makeGradient('createRadialGradient');

  return new Proxy(target, {
    set(t, key, value) {
      t[key] = value;
      if (typeof key === 'string' && !key.startsWith('_')) {
        styled[key] = value;
        styledHistory.push([key, value]);
      }
      return true;
    },
    get(t, key) {
      const v = t[key];
      return typeof v === 'function' ? v : v;
    },
  });
}

// ── 假 DOM ────────────────────────────────────────────────────────────
//
// 只实现这两段脚本真的用到的：getElementById / createElement / querySelector /
// classList / style / offsetWidth（脚本靠它算拖动范围与钳制）/ appendChild /
// addEventListener / dispatch / getBoundingClientRect / setPointerCapture。
// offsetWidth 从 style.width 解析 —— 钳制逻辑只有在「量出来的尺寸是真的」时才被测到。

function makeElement(tag, { rect = { width: 78, height: 84, left: 0, top: 0 }, ctx2d = null } = {}) {
  const classes = new Set();
  const attrs = {};
  const listeners = {};
  const el = {
    tagName: String(tag).toUpperCase(),
    style: {},
    attrs,
    children: [],
    parentNode: null,
    listeners,
    classes,
    ctx2d,
    removed: false,
    captured: null,
    released: null,
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
      toggle: (c, on) => (on === undefined ? (classes.has(c) ? classes.delete(c) : classes.add(c)) : on ? classes.add(c) : classes.delete(c)),
    },
    setAttribute(k, v) {
      attrs[k] = String(v);
    },
    getAttribute(k) {
      return Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null;
    },
    removeAttribute(k) {
      delete attrs[k];
    },
    hasAttribute(k) {
      return Object.prototype.hasOwnProperty.call(attrs, k);
    },
    toggleAttribute(k, force) {
      const on = force === undefined ? !Object.prototype.hasOwnProperty.call(attrs, k) : Boolean(force);
      if (on) attrs[k] = '';
      else delete attrs[k];
      return on;
    },
    appendChild(child) {
      child.parentNode = el;
      el.children.push(child);
      return child;
    },
    removeChild(child) {
      el.children = el.children.filter((c) => c !== child);
      child.parentNode = null;
      return child;
    },
    addEventListener(type, fn) {
      (listeners[type] || (listeners[type] = [])).push(fn);
    },
    removeEventListener(type, fn) {
      listeners[type] = (listeners[type] || []).filter((f) => f !== fn);
    },
    listenerCount(type) {
      return (listeners[type] || []).length;
    },
    dispatch(type, ev = {}) {
      const list = (listeners[type] || []).slice();
      assert.ok(list.length > 0, `${el.tagName} 上没有 ${type} 监听器`);
      for (const fn of list) fn(ev);
    },
    setPointerCapture(id) {
      el.captured = id;
    },
    releasePointerCapture(id) {
      el.released = id;
    },
    getBoundingClientRect() {
      return {
        left: parseFloat(el.style.left) || rect.left,
        top: parseFloat(el.style.top) || rect.top,
        width: el.offsetWidth,
        height: el.offsetHeight,
      };
    },
    remove() {
      el.removed = true;
      if (el.parentNode) el.parentNode.removeChild(el);
    },
    get offsetWidth() {
      const w = parseFloat(el.style.width);
      return Number.isFinite(w) ? w : rect.width;
    },
    get offsetHeight() {
      const h = parseFloat(el.style.height);
      return Number.isFinite(h) ? h : rect.height;
    },
    get clientWidth() {
      return el.offsetWidth;
    },
    get clientHeight() {
      return el.offsetHeight;
    },
  };
  if (el.tagName === 'CANVAS') {
    el.width = 0;
    el.height = 0;
    el.getContext = (kind) => (kind === '2d' ? el.ctx2d : null);
  }
  // 真 DOM 里 className 与 classList 是同一份数据的两个门：脚本用 `el.className = 'whale-pendant'`
  // 建挂件，而查询用 `document.querySelector('.whale-pendant')`。两者不联动的话，
  // 「挂件到底建出来没有」就会被假 DOM 说谎（第一版正是这么假失败的）。
  Object.defineProperty(el, 'className', {
    get() {
      return [...classes].join(' ');
    },
    set(v) {
      classes.clear();
      for (const c of String(v).split(/\s+/)) if (c) classes.add(c);
    },
    configurable: true,
  });
  // __paint 是脚本挂在节点上的重绘函数（主题翻转时调用）。用计数器包一层，
  // 这样「主题变了到底有没有重画」是被测到的，而不是只测到「挂了个函数」。
  let paintFn = null;
  el.paintCalls = 0;
  Object.defineProperty(el, '__paint', {
    get() {
      if (paintFn === null) return undefined;
      return (...args) => {
        el.paintCalls += 1;
        return paintFn(...args);
      };
    },
    set(fn) {
      paintFn = fn;
    },
    configurable: true,
  });
  return el;
}

function makeStorage(initial = {}, { throws = false } = {}) {
  const map = new Map(Object.entries(initial));
  let attempts = 0;
  return {
    get attempts() {
      return attempts;
    },
    getItem(k) {
      attempts += 1;
      if (throws) throw new Error('SecurityError: 存储被禁用');
      return map.has(k) ? map.get(k) : null;
    },
    setItem(k, v) {
      attempts += 1;
      if (throws) throw new Error('SecurityError: 存储被禁用');
      map.set(k, String(v));
    },
    removeItem(k) {
      map.delete(k);
    },
    dump() {
      return Object.fromEntries(map);
    },
  };
}

/** 假 matchMedia：两种查询各一个对象，可手动触发 change（模拟系统主题翻转）。 */
function makeMatchMedia({ dark = false, reduce = false } = {}) {
  const queries = new Map();
  const list = [];
  const matchMedia = (query) => {
    const matches = query.includes('prefers-reduced-motion') ? reduce : query.includes('prefers-color-scheme') ? dark : false;
    const listeners = [];
    const mql = {
      media: query,
      matches,
      listeners,
      addEventListener(type, fn) {
        if (type === 'change') listeners.push(fn);
      },
      removeEventListener(type, fn) {
        const i = listeners.indexOf(fn);
        if (i >= 0) listeners.splice(i, 1);
      },
      set(next) {
        mql.matches = next;
        for (const fn of listeners.slice()) fn({ matches: next, media: query });
      },
    };
    queries.set(query, mql);
    list.push(mql);
    return mql;
  };
  matchMedia.queries = queries;
  matchMedia.list = list;
  matchMedia.dark = () => {
    for (const m of list) if (m.media.includes('prefers-color-scheme')) m.set(!dark);
  };
  matchMedia.reduceQuery = (next) => {
    for (const m of list) if (m.media.includes('prefers-reduced-motion')) m.set(next);
  };
  return matchMedia;
}

/**
 * 一个沙箱 = 一整个页面。`window` 就是沙箱的全局对象（脚本里既有 `window.x`
 * 也有裸的 `matchMedia` / `requestAnimationFrame` / `performance`，两者都得在）。
 */
function makePage({
  reduce = false,
  dark = false,
  withCanvas = true,
  storage,
  savedPos = null,
  innerWidth = 600,
  innerHeight = 700,
  devicePixelRatio = 2,
  script = 'splash', // 'splash' = 欢迎窗口那两段；'replay' = 挂件重播页那一段
  preScript = null, // (sandbox, document) => void，在被测脚本执行前改动沙箱
  expectWarns = false, // 故意制造失败的页面：把它从「全程零告警」那条总账里摘出去
} = {}) {
  const body = makeElement('body', { rect: { width: innerWidth, height: innerHeight, left: 0, top: 0 } });
  const documentElement = makeElement('html');
  documentElement.appendChild(body);

  const created = [];
  const splashes = [];
  const byId = new Map();
  const document = {
    body,
    documentElement,
    createElement(tag) {
      const ctx2d = tag === 'canvas' ? makeCtx2d() : null;
      const el = makeElement(tag, {
        rect: { width: innerWidth, height: innerHeight, left: 0, top: 0 },
        ctx2d,
      });
      if (ctx2d) splashes.push(el);
      created.push(el);
      return el;
    },
    getElementById: (id) => (byId.has(id) ? byId.get(id) : null),
    querySelector: (sel) => {
      if (sel.startsWith('.')) {
        const want = sel.slice(1);
        return body.children.find((c) => c.classes.has(want)) ?? null;
      }
      return null;
    },
    addEventListener() {},
    removeEventListener() {},
  };

  // welcome.html 里那个 <canvas id="whale-stage">：它是 body 的孩子，正常跑完会被移除。
  const stageCtx = makeCtx2d();
  const stage = makeElement('canvas', { rect: { width: innerWidth, height: innerHeight, left: 0, top: 0 }, ctx2d: stageCtx });
  if (withCanvas) {
    byId.set('whale-stage', stage);
    body.appendChild(stage);
  }

  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.document = document;
  sandbox.localStorage = storage ?? makeStorage(savedPos === null ? {} : { 'dsh-whale-pendant-position': JSON.stringify(savedPos) });

  const winListeners = {};
  sandbox.addEventListener = (type, fn) => {
    (winListeners[type] || (winListeners[type] = [])).push(fn);
  };
  sandbox.removeEventListener = (type, fn) => {
    winListeners[type] = (winListeners[type] || []).filter((f) => f !== fn);
  };
  sandbox.innerWidth = innerWidth;
  sandbox.innerHeight = innerHeight;
  sandbox.devicePixelRatio = devicePixelRatio;

  const matchMedia = makeMatchMedia({ dark, reduce });
  sandbox.matchMedia = matchMedia;

  // ── 帧驱动 ──
  const frames = new Map();
  let rafId = 0;
  let clock = 1000;
  let rafCalls = 0;
  let cancelCalls = 0;
  sandbox.requestAnimationFrame = (fn) => {
    rafCalls += 1;
    const id = ++rafId;
    frames.set(id, fn);
    return id;
  };
  sandbox.cancelAnimationFrame = (id) => {
    cancelCalls += 1;
    frames.delete(id);
  };
  sandbox.performance = { now: () => clock };

  const timeouts = [];
  sandbox.setTimeout = (fn, ms) => {
    timeouts.push({ fn, ms });
    return timeouts.length;
  };
  sandbox.clearTimeout = () => {};

  const errors = [];
  const warns = [];
  sandbox.console = {
    log: () => {},
    info: () => {},
    warn: (...a) => warns.push(a.map((x) => String(x)).join(' ')),
    error: (...a) => warns.push(a.map((x) => String(x)).join(' ')),
  };

  // 脚本里用到的一批内置对象。跨 realm 的数组/对象与宿主不同源，所以断言一律
  // 用 Array.isArray / Array.from / Object.keys，绝不用 deepEqual 比数组。
  Object.assign(sandbox, {
    Math, JSON, Object, Array, String, Number, Boolean, Error, Date, Map, Set, Symbol,
    parseFloat, parseInt, isFinite, isNaN, Promise, RegExp,
  });

  // replay.js 会调 window.close() 关掉自己那个短命窗口；真实关窗归主进程，
  // 这里只数次数 —— 断言「它确实打算自己收场」，而不是等外面的安全网。
  let closeCalls = 0;
  sandbox.close = () => {
    closeCalls += 1;
  };

  vm.createContext(sandbox);
  vm.runInContext(ANIMATION_SRC, sandbox, { filename: ANIMATION_ENTRY });
  // preScript：动画包已经就位、**页面脚本还没开始跑**的时候破坏沙箱里的某个东西。
  // 有些降级路径只在「页面脚本跑起来的那一刻」才走得到，事后改属性已经太晚；
  // 而放在动画包之前又会被它自己的导出盖回去。
  if (preScript) preScript(sandbox, document);
  if (script === 'replay') {
    vm.runInContext(REPLAY_SRC, sandbox, { filename: REPLAY_ENTRY });
  } else {
    vm.runInContext(SPLASH_SRC, sandbox, { filename: SPLASH_ENTRY });
  }

  const page = {
    sandbox,
    expectWarns,
    document,
    body,
    stage,
    stageCtx,
    created,
    splashes,
    frames,
    timeouts,
    errors,
    warns,
    matchMedia,
    winListeners,
    storage: sandbox.localStorage,
    innerWidth,
    innerHeight,
    get rafCalls() {
      return rafCalls;
    },
    get cancelCalls() {
      return cancelCalls;
    },
    /** replay.js 调了几次 window.close()。 */
    get closes() {
      return closeCalls;
    },
    get now() {
      return clock;
    },
    /** 推进 n 帧，每帧前进 stepMs 毫秒。捕获异常而不是让它冒出去（异常也要被断言）。 */
    pump(n = 1, stepMs = 420) {
      for (let i = 0; i < n; i += 1) {
        clock += stepMs;
        const pending = [...frames.entries()];
        frames.clear();
        for (const [, fn] of pending) {
          try {
            fn(clock);
          } catch (err) {
            errors.push(err);
          }
        }
      }
    },
    dispatchWindow(type, ev = {}) {
      for (const fn of (winListeners[type] || []).slice()) fn(ev);
    },
    pendant() {
      return body.children.find((c) => c.classes.has('whale-pendant')) ?? null;
    },
  };
  RUNS.push(page);
  return page;
}

/** 跑到时间线末尾（默认时长 4200ms / 每帧 420ms ⇒ 11 帧足够到 t=1）。 */
function runToEnd(page, frames = 12) {
  page.pump(frames, 420);
  return page;
}

// ── ① 跨文件契约：打包出来的东西真的是 whale-splash.js 要的 ──────────────

let page = makePage();

await check('打包后的动画脚本暴露了 WhaleSplash / drawWhale / whalePath / __WHALE_PIXEL__', () => {
  assert.equal(typeof page.sandbox.WhaleSplash, 'function', 'window.WhaleSplash 不是函数 —— 打包或导出漏了，动画会整段跳过');
  assert.equal(typeof page.sandbox.drawWhale, 'function', 'window.drawWhale 不是函数 —— 挂件画不出来');
  assert.equal(typeof page.sandbox.whalePath, 'function');
  assert.equal(page.sandbox.__WHALE_PIXEL__, 6);
});

await check('两份脚本都是经典脚本（没有 ESM 语法：启动窗口的 CSP 不允许）', () => {
  assert.ok(!/^\s*(import|export)\s/m.test(ANIMATION_SRC), '动画脚本里出现了顶层 import/export');
  assert.ok(!/^\s*(import|export)\s/m.test(SPLASH_SRC), 'splash 脚本里出现了顶层 import/export');
});

await check('脚本一加载完就起了帧循环，但还没有往画布上画任何东西', () => {
  assert.equal(page.stageCtx.ops.length, 0, '加载完就画了东西？（第一个帧回调才该画）');
  assert.equal(page.rafCalls, 1, '两段脚本都是 defer，加载完应当已经 start() 并排了第一帧');
  assert.equal(page.created.length, 0, '加载阶段不该创建任何节点（挂件要等动画结束）');
});

// ── ② 时间线真的推进 ────────────────────────────────────────────────────

await check('第一帧就画了背景（setTransform → clearRect → 渐变 → 填满）', () => {
  page.pump(1, 10);
  const ops = Array.from(page.stageCtx.ops);
  assert.ok(ops.includes('setTransform'), '没有 setTransform：DPR 缩放没设，画面会偏小/模糊');
  assert.ok(ops.includes('clearRect'), '没有 clearRect：上一帧不会擦掉，会糊成一片');
  assert.ok(page.stageCtx.gradients.length > 0, '一个渐变都没建：背景没画');
  assert.ok(ops.includes('fillRect'));
});

await check('跑到末尾：鲸鱼路径真的被画过（bezierCurveTo 出现很多次）', () => {
  runToEnd(page);
  const beziers = Array.from(page.stageCtx.ops).filter((o) => o === 'bezierCurveTo').length;
  assert.ok(beziers >= 13, `只画了 ${beziers} 段贝塞尔曲线 —— 鲸鱼路径有 13 段，说明主体没画出来`);
});

await check('所有传给画布的数值参数都是有限数（NaN 是 canvas 最典型的静默失败）', () => {
  assert.ok(RUNS.length >= 1);
  for (const p of RUNS) {
    const bad = Array.from(p.stageCtx.bad);
    assert.deepEqual(Array.from(bad), [], `${SPLASH_ENTRY}: ${bad.slice(0, 5).join(' | ')}`);
  }
});

await check('时间到点后交出挂件：body 里出现 .whale-pendant，画布拿到 is-done', () => {
  assert.ok(page.pendant() !== null, '跑完了却没有挂件 —— 用户会看到一个静止的空白启动页');
  assert.ok(page.stage.classList.contains('is-done'));
  assert.ok(page.stage.listenerCount('transitionend') > 0, '没有 transitionend 兜底：淡出后的画布可能永远留着');
  assert.ok(page.timeouts.some((t) => t.ms >= 900), '没有那个「动画没触发也要移除画布」的定时器');
});

await check('挂件的兜底移除真的生效（transitionend 不来也不会压住界面）', () => {
  const timer = page.timeouts.find((t) => t.ms >= 900);
  timer.fn();
  assert.equal(page.stage.removed, true);
  assert.ok(!page.body.children.includes(page.stage));
});

await check('pagehide 之后帧循环停下（不会在窗口藏起来之后继续空转）', () => {
  assert.ok(page.frames.size > 0, '跑到末尾后应当还有 idleFrame 在排队');
  page.dispatchWindow('pagehide');
  assert.equal(page.frames.size, 0, 'stop() 没有取消 raf');
  const before = page.rafCalls;
  page.pump(3, 420);
  assert.equal(page.rafCalls, before, '停了之后还在注册新帧');
});

// ── ③ 交互：拖动 / 键盘 / 主题 / 位置记忆 ────────────────────────────────

page = runToEnd(makePage());

await check('拖动：按住 → 移动（按窗口与挂件尺寸钳制）→ 松手写进 localStorage', () => {
  const el = page.pendant();
  assert.ok(el !== null);
  // 默认落点：窗口右侧留 28px。600 - 78 - 28 = 494。
  assert.equal(el.style.left, '494px');
  assert.equal(el.style.top, '26px');

  el.dispatch('pointerdown', { pointerId: 7, clientX: 500, clientY: 40, preventDefault: () => {} });
  assert.ok(el.classList.contains('is-dragging'));
  assert.equal(el.captured, 7, '没有抓指针：指针移出挂件后拖动会断');

  // 期望值一律**算出来**，不写整数：挂件高度是 `size * 1.08`（78 → 84.24），
  // 硬编码 616 会把「钳制对了」判成失败（第一版正是如此）。
  const maxLeft = `${page.innerWidth - parseFloat(el.style.width)}px`;
  const maxTop = `${page.innerHeight - parseFloat(el.style.height)}px`;
  el.dispatch('pointermove', { clientX: 7000, clientY: 7000 });
  assert.equal(el.style.left, maxLeft, '超出右边界没有钳制');
  assert.equal(el.style.top, maxTop, '超出下边界没有钳制');

  el.dispatch('pointerup', { pointerId: 7 });
  assert.ok(!el.classList.contains('is-dragging'));
  assert.equal(el.released, 7);
  const saved = JSON.parse(page.storage.getItem('dsh-whale-pendant-position'));
  assert.equal(saved.x, page.innerWidth - parseFloat(el.style.width));
  assert.equal(saved.y, page.innerHeight - parseFloat(el.style.height));
});

await check('键盘：方向键挪 8px，按住 Shift 挪 24px（不用鼠标也够得着）', () => {
  const el = page.pendant();
  const startLeft = parseFloat(el.style.left);
  const startTop = parseFloat(el.style.top);
  el.dispatch('keydown', { key: 'ArrowLeft', preventDefault: () => {} });
  assert.equal(parseFloat(el.style.left), startLeft - 8);
  // 上一条用例把挂件拖到了下边界，再往下按会被钳住 —— 所以这里用 ArrowUp。
  el.dispatch('keydown', { key: 'ArrowUp', shiftKey: true, preventDefault: () => {} });
  assert.equal(parseFloat(el.style.top), startTop - 24);
  el.dispatch('keydown', { key: 'a', preventDefault: () => {} });
  assert.equal(parseFloat(el.style.left), startLeft - 8, '无关按键不该移动挂件');
});

await check('位置记忆：存过的位置会被恢复（含越界钳制）', () => {
  const p = runToEnd(makePage({ savedPos: { x: 120, y: 90 } }));
  const el = p.pendant();
  assert.equal(el.style.left, '120px');
  assert.equal(el.style.top, '90px');

  const off = runToEnd(makePage({ savedPos: { x: 99999, y: 99999 } }));
  assert.equal(off.pendant().style.left, '522px', '越界的历史位置没有被钳制回窗口内');
});

await check('主题翻转：body 记下深色标记，并让挂件重画（颜色是烤进画布的）', () => {
  const el = page.pendant();
  assert.equal(page.body.hasAttribute('data-ds-dark-theme'), false);
  // 挂件把画笔挂在 `el.__paint` 上供主题变化时重画。**不要**断言此刻 paintCalls >= 1：
  // `createPendant()` 里的首画是直接 `requestAnimationFrame(paint)` 排进去的，不走这层包装。
  assert.equal(typeof el.__paint, 'function', '挂件没有把画笔暴露出来 —— 主题变了根本没法重画');
  const before = el.paintCalls;

  page.matchMedia.dark();
  assert.equal(page.body.hasAttribute('data-ds-dark-theme'), true, '系统切深色时 body 没被标记');
  assert.equal(el.paintCalls, before + 1, '主题变了但没有重画 —— 挂件会一直是浅色');

  // 画布是挂件 div 里的孩子（div 自身没有 2d 上下文）。
  const inner = el.children.find((c) => c.tagName === 'CANVAS');
  assert.ok(inner, '挂件里没有画布节点');
  const ops = Array.from(inner.ctx2d.ops);
  assert.ok(ops.includes('bezierCurveTo'), '重画时没有画鲸鱼');
  assert.equal(inner.ctx2d.bad.length, 0, '重画时把 NaN 喂给了画布');
});

// ── ④ 深浅两套皮肤真的不一样（不是只换了个变量名） ────────────────────────

await check('drawWhale 的 light 参数真的改变配色（浅色皮肤不再用深色那一套）', () => {
  const darkCtx = makeCtx2d();
  const lightCtx = makeCtx2d();
  page.sandbox.drawWhale(darkCtx, 100, 63, true, false);
  page.sandbox.drawWhale(lightCtx, 100, 63, true, true);
  const fills = (ctx) => Array.from(ctx.ops).filter((o) => o === 'fill').length;
  assert.ok(fills(darkCtx) > 0 && fills(lightCtx) > 0, '两种皮肤都没有填充色块');
  const palette = (ctx) => Array.from(new Set(ctx.styledHistory.filter(([k]) => k === 'fillStyle' || k === 'strokeStyle').map(([, v]) => String(v))));
  assert.notDeepEqual(palette(darkCtx), palette(lightCtx), '深浅两套皮肤的调色板一模一样 —— light 参数被忽略了');
  assert.equal(darkCtx.bad.length, 0);
  assert.equal(lightCtx.bad.length, 0);
});

await check('whalePath 画 11 段贝塞尔（形状契约，改路径就会在这里露出来）', () => {
  const ctx = makeCtx2d();
  page.sandbox.whalePath(ctx, 200, 126);
  const n = Array.from(ctx.ops).filter((o) => o === 'bezierCurveTo').length;
  // 11 是鲸鱼身体本体的段数（鱼鳍另 2 段在 finPath 里，不从这里过）。
  // 这个数字的意义是「路径还在、没被改塌」，所以改动路径时这里**应该**失败。
  assert.equal(n, 11);
  assert.equal(Array.from(ctx.ops).filter((o) => o === 'moveTo').length, 1, '路径应当只有一个起点');
  assert.equal(ctx.bad.length, 0);
});

// ── ⑤ 三条降级路径 ──────────────────────────────────────────────────────

await check('减动效偏好：不跑动画，直接出挂件（但挂件本身照样画出来）', () => {
  const p = makePage({ reduce: true });
  assert.equal(p.rafCalls, 1, '减动效时不该起动画帧循环（只该有挂件自己那一帧重绘）');
  assert.ok(p.pendant() !== null, '减动效时连挂件都没有 —— 这一段就白屏了');
  p.pump(1, 16);
  assert.ok(p.stageCtx.ops.length === 0, '减动效时还在往启动画布上画');
  // 挂件自己的画布是 div 里的那个 <canvas> 孩子（div 本身没有 2d 上下文）。
  const inner = p.pendant().children.find((c) => c.tagName === 'CANVAS');
  assert.ok(inner, '挂件里没有画布节点');
  assert.ok(Array.from(inner.ctx2d.ops).includes('bezierCurveTo'), '挂件上的鲸鱼没画出来');
  assert.deepEqual(Array.from(p.errors), []);
});

await check('没有 <canvas id="whale-stage">：整段安静退出，一个节点都不建', () => {
  const p = makePage({ withCanvas: false });
  assert.equal(p.created.length, 0);
  assert.equal(p.rafCalls, 0);
  assert.equal(p.errors.length, 0);
});

await check('存储被禁（企业策略 / 隐私模式）：挂件仍在，拖动与位置读取都不抛', () => {
  const storage = makeStorage({}, { throws: true });
  const p = runToEnd(makePage({ storage }));
  const el = p.pendant();
  assert.ok(el !== null);
  assert.equal(el.style.left, '494px', '读不到位置时没有退回默认落点');
  el.dispatch('pointerdown', { pointerId: 1, clientX: 500, clientY: 40, preventDefault: () => {} });
  el.dispatch('pointermove', { clientX: 460, clientY: 60 });
  el.dispatch('pointerup', { pointerId: 1 });
  assert.ok(storage.attempts >= 2, '存储被禁时应当尝试过读写（这条断言防止测试根本没碰到存储）');
  assert.deepEqual(Array.from(p.errors), []);
  assert.deepEqual(Array.from(p.warns), []);
});

// ── ⑤-bis 挂件菜单里的「Replay animation」：renderer/replay.js ────────────
//
// 这段脚本只干三件事：把动画播一遍、淡出、**关掉自己那个短命窗口**。
// 在它之前，主进程把 'replay' 发给主窗口，而启动画面跑在欢迎窗口里 ——
// 那是个空操作，菜单点了没反应。所以这一节盯的就是「它真的会自己收场」：
// 窗口既不立刻消失（那样等于没播），也不赖着不走（那样要等主进程的安全网）。

if (REPLAY_SRC === null) {
  console.log(`  skip  ${REPLAY_ENTRY} 不在${found.label}里 —— 跳过 Replay 那一节`);
} else {
  await check('replay.js 是经典脚本，动画时长只在它自己这一份里', () => {
    assert.ok(
      !/^\s*(?:import|export)\s/m.test(REPLAY_SRC),
      'replay.js 里出现了 ESM 语句 —— 它是以 <script defer> 经典脚本加载的，会整段语法报错',
    );
    const m = /const DURATION_MS = (\d+)/.exec(REPLAY_SRC);
    assert.ok(m, 'replay.js 里找不到 DURATION_MS —— 时长被搬到别处，就会有两个真相');
    const dur = Number(m[1]);
    assert.ok(dur > 0 && dur <= 20000, `DURATION_MS=${dur} 不合理（主进程的安全网是 20s）`);
  });

  await check('Replay：动画跑完自己淡出，关窗排进定时器而不是立刻关', () => {
    const p = makePage({ script: 'replay' });
    assert.equal(p.closes, 0, '动画还没开始，窗口就被关了');
    runToEnd(p);
    assert.deepEqual(Array.from(p.errors), []);
    assert.ok(p.stage.classList.contains('is-done'), '跑完没有进入淡出状态（缺 is-done）—— 窗口会「啪」一下消失');
    assert.ok(p.timeouts.length >= 1, '一个定时器都没排 —— 窗口永远不会自己关，只能等主进程的安全网');
    assert.equal(p.closes, 0, 'window.close() 是同步调的 —— 淡出那 520ms 根本没播');
    for (const t of p.timeouts.slice()) t.fn(); // slice：定时器里再排定时器也不会边跑边长
    assert.equal(p.closes, 1, '定时器到点后没有恰到好处地关一次窗');
    assert.ok(
      (p.winListeners.pagehide || []).length === 1,
      '没有注册 pagehide 清理 —— 窗口被强杀时动画还在跑',
    );
    p.dispatchWindow('pagehide'); // 不抛异常即可
  });

  await check('Replay + 减动效：直接画一张静止的鲸鱼，然后关窗', () => {
    const p = makePage({ script: 'replay', reduce: true });
    assert.equal(p.rafCalls, 0, '减动效时不该起动画帧循环');
    assert.ok(Array.from(p.stageCtx.ops).includes('bezierCurveTo'), '静止那一帧没有画鲸鱼');
    assert.equal(p.stageCtx.bad.length, 0, '静止那一帧里有非有限数坐标 —— 真浏览器会一声不吭什么都不画');
    assert.ok(p.stage.classList.contains('is-done'), '减动效时没有淡出就走');
    assert.equal(p.closes, 0, '减动效时窗口立刻就关了 —— 那张静止的鲸鱼没人看得见');
    for (const t of p.timeouts.slice()) t.fn();
    assert.equal(p.closes, 1);
    assert.deepEqual(Array.from(p.errors), []);
  });

  await check('Replay 页连画布都没有：立刻关窗走人（不是留一个置顶空白窗等安全网）', () => {
    const p = makePage({ script: 'replay', withCanvas: false });
    assert.equal(p.created.length, 0);
    assert.equal(p.rafCalls, 0);
    assert.equal(p.timeouts.length, 0, '没有画布还排了定时器 —— 说明它打算慢慢来');
    assert.equal(p.closes, 1, '没有画布却把窗口留着：它会当 20 秒的置顶空白方块，挡着界面');
    assert.equal(p.errors.length, 0);
  });

  await check('Replay 画不出静止帧（drawWhale 抛异常）：照样淡出关窗', () => {
    const p = makePage({
      script: 'replay',
      reduce: true,
      expectWarns: true,
      preScript: (s) => {
        s.drawWhale = () => {
          throw new Error('boom: drawWhale 炸了');
        };
      },
    });
    assert.equal(p.warns.length, 1, '画不出来时应当留一条 console.error（静默失败最难查）');
    assert.ok(String(p.warns[0]).includes('still frame'), `告警内容对不上：${p.warns[0]}`);
    assert.ok(p.stage.classList.contains('is-done'), '抛异常之后没有走淡出');
    for (const t of p.timeouts.slice()) t.fn();
    assert.equal(p.closes, 1, '画不出来就不关窗 —— 用户要盯着一块置顶空白 20 秒');
    assert.equal(p.errors.length, 0, '异常应当被脚本自己吃掉，而不是逃到 window.onerror');
  });

  await check('Replay 动画起不来（WhaleSplash 构造抛异常）：退回静止帧并关窗', () => {
    const p = makePage({
      script: 'replay',
      expectWarns: true,
      preScript: (s) => {
        s.WhaleSplash = function Broken() {
          throw new Error('boom: 打包坏了');
        };
      },
    });
    assert.equal(p.warns.length, 1);
    assert.ok(String(p.warns[0]).includes('failed to start'), `告警内容对不上：${p.warns[0]}`);
    assert.ok(
      Array.from(p.stageCtx.ops).includes('bezierCurveTo'),
      '动画起不来时应当退回画一张静止的鲸鱼，而不是留一块空白',
    );
    assert.equal(p.closes, 0);
    for (const t of p.timeouts.slice()) t.fn();
    assert.equal(p.closes, 1);
    assert.equal(p.errors.length, 0);
  });
}

// ── ⑥ 收尾：没有一次运行是靠异常收场的 ────────────────────────────────────

await check('所有沙箱运行里都没有异常、也没有控制台告警', () => {
  assert.ok(RUNS.length >= 6, `只跑了 ${RUNS.length} 次沙箱，覆盖不够（这条会假通过）`);
  const errs = RUNS.flatMap((p) => Array.from(p.errors).map((e) => String(e && e.message ? e.message : e)));
  assert.deepEqual(errs, []);
  // 故意制造失败的那几次运行（expectWarns）不看这条总账 —— 它们自己的用例里
  // 已经逐字断言了「该有哪一条告警」，这里仍然不允许出现计划外的告警。
  const warns = RUNS.filter((p) => !p.expectWarns).flatMap((p) => Array.from(p.warns));
  assert.deepEqual(warns, []);
});

const failed = results.filter((r) => !r.ok);
// 失败时连栈一起打：这套测试的失败多半来自「假 DOM 少实现了一个方法」或
// 「断言查的时机不对」，只看一句 message 往往要重新猜一遍。
for (const r of results) {
  console.log(`${r.ok ? '  ok  ' : ' FAIL '} ${r.name}`);
  if (!r.ok) console.log(`        ${r.err?.message ?? r.err}\n${r.err?.stack ?? ''}`);
}
console.log('');
if (failed.length) {
  console.log(`启动界面脚本单测失败：${failed.length}/${results.length}`);
  process.exit(1);
}
console.log(`启动界面脚本单测通过：${results.length}/${results.length} 项`);
