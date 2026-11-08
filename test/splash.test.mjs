// deepseek-up-T :: 启动窗口动画（cyber splash）的离线行为级单测
//
// 2026-11-02 启动动画推倒重来：星海鲸鱼 → 科幻 × 赛博朋克。旧测试绑的是旧契约
// （window.WhaleSplash、欢迎窗口里的可拖动小鲸鱼），整份重写。
//
// 测的是 vendor/whale/materials/ 里的源文件：这几份都是 `action: insert` / `replace`，
// 构建时**原样**进归档（build.mjs 逐字节核对），所以源文件 = 将要落盘的字节。
// 如果本机有暂存包，再额外核一遍「暂存包里的就是这一份」（防止拿旧构建去落盘）。
//
// 配一个最小的假浏览器（假 2d 上下文 / 可控时钟的 rAF / matchMedia / 计时器），然后真跑：
//   ① 跨文件契约：welcome.html 的脚本顺序、window.CyberSplash 真的在；
//   ② 每一帧在各种窗口尺寸下都画得出来，传给画布的数值全是有限数（NaN 在真浏览器里不报错，只是不画）；
//   ③ 同一时刻画两次，画出来的东西逐调用相同（抓帧与复看靠它）；
//   ④ 时间到点自己收场：画布淡出并从 DOM 移除 —— 绝不留一层东西压住欢迎界面；
//   ⑤ 点击 / 按键跳到收尾；收尾后监听器都摘掉；
//   ⑥ 降级：减动效、没有 CyberSplash、没有画布、某一帧抛异常 —— 都不卡住界面；
//   ⑦ 挂件菜单「Replay animation」：播完关窗、减动效画静止帧后关窗、各种失败也关窗。
//
//   node test/splash.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import { readAsarEntry } from '../src/asar.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '..');
const MAT = path.join(PROJECT, 'vendor', 'whale', 'materials');

const read = (rel) => fs.readFileSync(path.join(MAT, rel), 'utf8');
const CYBER_SRC = read('cyber-splash.js');
const SPLASH_SRC = read('renderer/whale-splash.js');
const REPLAY_SRC = read('renderer/replay.js');

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, err });
  }
}

// ── 假 2d 上下文：记录每次调用，并检查数值参数是否有限 ──────────────────

const CTX_METHODS = [
  'beginPath', 'save', 'restore', 'fill', 'moveTo', 'stroke', 'fillRect', 'strokeRect', 'arc', 'rect',
  'clip', 'closePath', 'lineTo', 'setTransform', 'clearRect', 'drawImage', 'fillText',
];

function makeCtx2d({ throwOn = null } = {}) {
  const calls = [];
  const bad = [];
  const record = (name, args) => {
    if (throwOn === name) throw new Error(`boom in ${name}`);
    for (const a of args) {
      if (typeof a === 'number' && !Number.isFinite(a)) bad.push(`${name}(${args.join(', ')})`);
    }
    calls.push([name, args.map((a) => (typeof a === 'object' && a !== null ? '[obj]' : a))]);
  };
  const target = { calls, bad, letterSpacing: '0px' };
  for (const m of CTX_METHODS) target[m] = (...args) => record(m, args);
  const grad = (name) => (...args) => {
    record(name, args);
    return {
      addColorStop(o, c) {
        if (!Number.isFinite(o)) bad.push(`addColorStop(${o})`);
        if (typeof c !== 'string' || /NaN|undefined/.test(c)) bad.push(`addColorStop color ${c}`);
      },
    };
  };
  target.createLinearGradient = grad('createLinearGradient');
  target.createRadialGradient = grad('createRadialGradient');
  target.measureText = (s) => ({ width: String(s).length * 7 });
  return new Proxy(target, {
    set(t, k, v) {
      t[k] = v;
      if (typeof k === 'string' && typeof v === 'string' && /NaN|undefined/.test(v)) bad.push(`${k} = ${v}`);
      if (typeof k === 'string' && typeof v === 'number' && !Number.isFinite(v)) bad.push(`${k} = ${v}`);
      calls.push([`=${String(k)}`, [typeof v === 'object' ? '[obj]' : v]]);
      return true;
    },
  });
}

function makeEl(tag, ctx2d = null) {
  const classes = new Set();
  const listeners = {};
  const attrs = {};
  const el = {
    tagName: tag.toUpperCase(),
    width: 0,
    height: 0,
    removed: false,
    listeners,
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
    },
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    removeEventListener(type, fn) { listeners[type] = (listeners[type] || []).filter((f) => f !== fn); },
    count(type) { return (listeners[type] || []).length; },
    fire(type, ev = {}) { for (const fn of (listeners[type] || []).slice()) fn(ev); },
    toggleAttribute(k, on) { if (on) attrs[k] = ''; else delete attrs[k]; },
    hasAttribute(k) { return k in attrs; },
    remove() { el.removed = true; },
    getContext: (kind) => (kind === '2d' ? ctx2d : null),
  };
  return el;
}

/**
 * 一个假窗口。时间完全由测试推进：advance(ms) 让时钟走、到点的计时器触发、
 * 按 16ms 一帧跑 requestAnimationFrame。
 */
function makeWindow({ w = 900, h = 600, reduced = false, withCanvas = true, throwOn = null, dpr = 1.5 } = {}) {
  const ctx = makeCtx2d({ throwOn });
  const canvas = withCanvas ? makeEl('canvas', ctx) : null;
  if (canvas) canvas.getBoundingClientRect = () => ({ width: w, height: h, left: 0, top: 0 });
  const body = makeEl('body');
  const winListeners = {};
  let now = 0;
  let rafQ = [];
  let rafId = 0;
  let timers = [];
  const errors = [];
  const win = {
    innerWidth: w,
    innerHeight: h,
    devicePixelRatio: dpr,
    closed: false,
    performance: { now: () => now },
    console: { error: (...a) => errors.push(a.map(String).join(' ')), log() {}, warn() {} },
    matchMedia: (q) => ({
      matches: q.includes('reduced-motion') ? reduced : false,
      addEventListener() {},
      removeEventListener() {},
    }),
    requestAnimationFrame(fn) { rafId += 1; rafQ.push({ id: rafId, fn }); return rafId; },
    cancelAnimationFrame(id) { rafQ = rafQ.filter((r) => r.id !== id); },
    setTimeout(fn, ms) { timers.push({ at: now + (ms || 0), fn }); return timers.length; },
    clearTimeout() {},
    addEventListener(type, fn) { (winListeners[type] ||= []).push(fn); },
    removeEventListener(type, fn) { winListeners[type] = (winListeners[type] || []).filter((f) => f !== fn); },
    close() { win.closed = true; },
    document: {
      body,
      getElementById: (id) => (id === 'whale-stage' ? canvas : null),
      createElement: (tag) => makeEl(tag, makeCtx2d()),
    },
  };
  win.window = win;
  vm.createContext(win);

  const runTimers = () => {
    let fired = true;
    while (fired) {
      fired = false;
      const due = timers.filter((t) => t.at <= now);
      timers = timers.filter((t) => t.at > now);
      for (const t of due) { t.fn(); fired = true; }
    }
  };
  return {
    win, ctx, canvas, body, errors,
    winCount: (type) => (winListeners[type] || []).length,
    fireWin: (type, ev = {}) => { for (const fn of (winListeners[type] || []).slice()) fn(ev); },
    run(src, name) { vm.runInContext(src, win, { filename: name }); },
    get now() { return now; },
    get pendingFrames() { return rafQ.length; },
    advance(ms, frame = 16) {
      const end = now + ms;
      while (now < end) {
        now = Math.min(end, now + frame);
        const q = rafQ;
        rafQ = [];
        for (const r of q) r.fn(now);
        runTimers();
      }
    },
  };
}

// ── ① 跨文件契约 ───────────────────────────────────────────────────────

await check('welcome.html：cyber-splash.js → whale-splash.js → welcome.js 依次 defer 加载', () => {
  const html = read('renderer/welcome.html');
  const srcs = [...html.matchAll(/<script src="([^"]+)" defer><\/script>/g)].map((m) => m[1]);
  assert.deepEqual(srcs, ['../lib/welcome/cyber-splash.js', 'whale-splash.js', '../lib/welcome/welcome.js']);
  assert.match(html, /<canvas id="whale-stage"/);
  assert.match(html, /font-src 'self'/, '原版 CSP 的 font-src 不能丢（丢了欢迎窗口没字体也不报错）');
});

await check('replay.html 用同一份动画；桌面挂件 pendant.html 仍靠 whale-animation.js 画鲸鱼', () => {
  const replay = read('renderer/replay.html');
  assert.ok(replay.indexOf('cyber-splash.js') > 0 && replay.indexOf('cyber-splash.js') < replay.indexOf('replay.js'));
  assert.match(read('renderer/pendant.html'), /whale-animation\.js/);
});

await check('三段脚本都是经典脚本（启动窗口 CSP 不允许 ESM）', () => {
  for (const [name, src] of [['cyber-splash.js', CYBER_SRC], ['whale-splash.js', SPLASH_SRC], ['replay.js', REPLAY_SRC]]) {
    assert.doesNotMatch(src, /^\s*(import|export)\s/m, `${name} 里有 ESM 语法`);
    new vm.Script(src, { filename: name }); // 语法
  }
});

await check('加载后暴露 window.CyberSplash，时长 3.6 s，收尾 0.52 s', () => {
  const f = makeWindow();
  f.run(CYBER_SRC, 'cyber-splash.js');
  assert.equal(typeof f.win.CyberSplash, 'function');
  assert.equal(f.win.CyberSplash.DURATION_MS, 3600);
  assert.equal(f.win.CyberSplash.EXIT_MS, 520);
  assert.equal(f.ctx.calls.length, 0, '只加载不该画任何东西');
});

// ── ② ③ 每一帧都画得出来、数值有限、可复现 ─────────────────────────────

const SIZES = [[900, 600], [480, 620], [1600, 900], [3840, 2160], [200, 120], [1, 1], [0, 0]];

await check('各种窗口尺寸 × 整条时间线：不抛、数值全有限、每帧都有画面', () => {
  for (const [w, h] of SIZES) {
    const f = makeWindow({ w, h });
    f.run(CYBER_SRC, 'cyber-splash.js');
    const s = new f.win.CyberSplash(f.canvas);
    for (let t = 0; t <= 3600; t += 30) {
      const before = f.ctx.calls.length;
      s.renderAt(t);
      if (w >= 2 && h >= 2) {
        const drawn = f.ctx.calls.slice(before).filter(([n]) => n === 'fillRect' || n === 'stroke' || n === 'fill');
        assert.ok(drawn.length > 0, `${w}x${h} @${t}ms 什么都没画`);
      }
    }
    assert.deepEqual(f.ctx.bad, [], `${w}x${h} 出现非有限数：${f.ctx.bad.slice(0, 3).join(' | ')}`);
    assert.equal(f.canvas.width, Math.max(1, Math.round(w * 1.5)), '画布按 DPR 设尺寸');
  }
});

await check('时间越界也安全（负数、NaN、远超时长都钳到 [0, 时长]）', () => {
  const f = makeWindow();
  f.run(CYBER_SRC, 'cyber-splash.js');
  const s = new f.win.CyberSplash(f.canvas);
  for (const t of [-500, Number.NaN, undefined, 1e9]) s.renderAt(t);
  assert.deepEqual(f.ctx.bad, []);
});

await check('同一时刻画两次，逐调用相同（抓帧 / 复看可复现）', () => {
  const f = makeWindow();
  f.run(CYBER_SRC, 'cyber-splash.js');
  const s = new f.win.CyberSplash(f.canvas);
  for (const t of [100, 760, 1500, 1980, 3300]) {
    const a0 = f.ctx.calls.length;
    s.renderAt(t);
    const a = JSON.stringify(f.ctx.calls.slice(a0));
    const b0 = f.ctx.calls.length;
    s.renderAt(t);
    const b = JSON.stringify(f.ctx.calls.slice(b0));
    assert.equal(a, b, `@${t}ms 两次不一样`);
  }
});

await check('标题真的解码出来：2.3 s 时画的是 DEEPSEEK HARNESS（最后一个字 2235 ms 落定）', () => {
  const f = makeWindow();
  f.run(CYBER_SRC, 'cyber-splash.js');
  const s = new f.win.CyberSplash(f.canvas);
  s.renderAt(2300);
  const texts = f.ctx.calls.filter(([n]) => n === 'fillText').map(([, a]) => a[0]);
  assert.ok(texts.includes('DEEPSEEK HARNESS'), `没画出标题：${texts.slice(0, 8).join(' | ')}`);
  s.renderAt(1200);
  // 1.2 s 时标题还没开始
  const before = f.ctx.calls.length;
  s.renderAt(1200);
  assert.ok(!f.ctx.calls.slice(before).some(([n, a]) => n === 'fillText' && a[0] === 'DEEPSEEK HARNESS'));
});

await check('没有 Image（图片加载不了）时退成线框核心，不报错', () => {
  const f = makeWindow();
  f.run(CYBER_SRC, 'cyber-splash.js');
  const s = new f.win.CyberSplash(f.canvas);
  s.renderAt(2000);
  assert.deepEqual(f.errors, []);
  assert.deepEqual(f.ctx.bad, []);
});

await check('最后一帧把整块画布清空（收尾后露出的是欢迎界面，不是一层黑）', () => {
  const f = makeWindow({ w: 900, h: 600 });
  f.run(CYBER_SRC, 'cyber-splash.js');
  const s = new f.win.CyberSplash(f.canvas);
  const at = f.ctx.calls.length;
  s.renderAt(3600);
  const frame = f.ctx.calls.slice(at);
  const lastClear = frame.map(([n, a], i) => [n, a, i]).filter(([n, a]) => n === 'clearRect' && a[2] === 900 && a[3] === 600).pop();
  assert.ok(lastClear, '最后一帧没有整块 clearRect');
  const after = frame.slice(lastClear[2] + 1).filter(([n]) => n === 'fillRect');
  // 清空之后只剩那条收成点的细线和光点（宽或高都很小）
  for (const [, a] of after) assert.ok(a[2] <= 40 || a[3] <= 40, `清空后又铺了大块：${a.join(',')}`);
});

// ── ④ ⑤ 欢迎窗口控制器 ─────────────────────────────────────────────────

function bootWelcome(opts = {}) {
  const f = makeWindow(opts);
  if (opts.withCyber !== false) f.run(CYBER_SRC, 'cyber-splash.js');
  f.run(SPLASH_SRC, 'whale-splash.js');
  return f;
}

await check('自己播完自己收场：3.6 s 后画布淡出，随即从 DOM 移除', () => {
  const f = bootWelcome();
  f.advance(3000);
  assert.ok(!f.canvas.classList.contains('is-done'), '还没到点就收了');
  assert.equal(f.canvas.removed, false);
  f.advance(700);
  assert.ok(f.canvas.classList.contains('is-done'), '到点没收');
  f.advance(400);
  assert.equal(f.canvas.removed, true, 'transitionend 不来也要移除画布');
  assert.equal(f.pendingFrames, 0, '收场后帧循环还在空转');
  assert.equal(f.winCount('keydown'), 0, '收场后按键监听没摘');
  assert.equal(f.canvas.count('pointerdown'), 0, '收场后点击监听没摘');
  assert.deepEqual(f.ctx.bad, []);
  assert.deepEqual(f.errors, []);
});

await check('按任意键 / 点击画布：直接跳到收尾（约 0.52 s 后收场）', () => {
  for (const how of ['key', 'click']) {
    const f = bootWelcome();
    f.advance(500);
    if (how === 'key') f.fireWin('keydown', { key: 'Escape' });
    else f.canvas.fire('pointerdown', {});
    f.advance(500);
    assert.ok(!f.canvas.classList.contains('is-done'), `${how}：收尾还没播完就收了`);
    f.advance(120);
    assert.ok(f.canvas.classList.contains('is-done'), `${how}：跳过后没有收场`);
  }
});

await check('跳过只会往前跳：收尾阶段再按键不会重播', () => {
  const f = bootWelcome();
  f.advance(3300);
  f.fireWin('keydown', {});
  f.advance(350);
  assert.ok(f.canvas.classList.contains('is-done'));
});

await check('减动效：一帧都不画，画布立刻移除', () => {
  const f = bootWelcome({ reduced: true });
  f.advance(200);
  assert.equal(f.ctx.calls.length, 0);
  assert.equal(f.canvas.removed, true);
});

await check('cyber-splash.js 没加载上：不抛，画布立刻移除（不留一层挡住界面）', () => {
  const f = bootWelcome({ withCyber: false });
  f.advance(200);
  assert.equal(f.canvas.removed, true);
});

await check('没有 <canvas id="whale-stage">：两段脚本安静退出', () => {
  const f = makeWindow({ withCanvas: false });
  f.run(CYBER_SRC, 'cyber-splash.js');
  f.run(SPLASH_SRC, 'whale-splash.js');
  f.advance(4000);
  assert.deepEqual(f.errors, []);
});

await check('某一帧抛异常：记一条错误并立刻收场，不卡在半截画面上', () => {
  const f = bootWelcome({ throwOn: 'fillText' });
  f.advance(1600);
  assert.ok(f.errors.some((e) => /cyber splash: frame failed/.test(e)), JSON.stringify(f.errors));
  f.advance(400);
  assert.equal(f.canvas.removed, true);
  assert.equal(f.pendingFrames, 0);
});

await check('pagehide：帧循环停下', () => {
  const f = bootWelcome();
  f.advance(300);
  f.fireWin('pagehide', {});
  f.advance(50);
  assert.equal(f.pendingFrames, 0);
});

// ── ⑦ 挂件菜单的 Replay ────────────────────────────────────────────────

function bootReplay(opts = {}) {
  const f = makeWindow(opts);
  if (opts.withCyber !== false) f.run(CYBER_SRC, 'cyber-splash.js');
  f.run(REPLAY_SRC, 'replay.js');
  return f;
}

await check('Replay：完整播一遍后自己关窗；不接受点击跳过（重播窗口不可交互）', () => {
  const f = bootReplay();
  assert.equal(f.winCount('keydown'), 0);
  assert.equal(f.canvas.count('pointerdown'), 0);
  f.advance(3500);
  assert.equal(f.win.closed, false);
  f.advance(500);
  assert.equal(f.win.closed, true);
  assert.deepEqual(f.ctx.bad, []);
});

await check('Replay 减动效：画一张静止帧（标题已出），1.6 s 后关窗', () => {
  const f = bootReplay({ reduced: true });
  const texts = f.ctx.calls.filter(([n]) => n === 'fillText').map(([, a]) => a[0]);
  assert.ok(texts.includes('DEEPSEEK HARNESS'));
  f.advance(1500);
  assert.equal(f.win.closed, false);
  f.advance(200);
  assert.equal(f.win.closed, true);
});

await check('Replay 失败路径：没有 CyberSplash / 没有画布 / 帧异常 —— 都会关窗', () => {
  let f = bootReplay({ withCyber: false });
  f.advance(50);
  assert.equal(f.win.closed, true, '没有 CyberSplash');
  f = bootReplay({ withCanvas: false });
  assert.equal(f.win.closed, true, '没有画布');
  f = bootReplay({ throwOn: 'fillRect' });
  f.advance(1000);
  assert.equal(f.win.closed, true, '帧异常');
});

// ── 声明与暂存包 ───────────────────────────────────────────────────────

await check('声明：cyber-splash.js 在条目与语法检查里，条目数 = expect_diff_entries', () => {
  const decl = fs.readFileSync(path.join(PROJECT, 'patches', 'T1-whale-splash.yml'), 'utf8');
  const entries = [...decl.matchAll(/^\s+- path: (\S+)/gm)].map((m) => m[1]);
  assert.ok(entries.includes('lib/welcome/cyber-splash.js'));
  const expect = Number(/expect_diff_entries:\s*(\d+)/.exec(decl)[1]);
  assert.equal(entries.length, expect);
  assert.match(decl, /syntax_check:[\s\S]*- lib\/welcome\/cyber-splash\.js/);
  for (const m of decl.matchAll(/source: \.\.\/vendor\/whale\/materials\/(\S+)/g)) {
    assert.ok(fs.existsSync(path.join(MAT, m[1])), `声明引用的素材不存在：${m[1]}`);
  }
});

const staged = path.join(PROJECT, 'state', 'staged', 'app.asar');
let stagedNote = null;
await check('暂存包（若有）里的启动动画就是仓库这一份', () => {
  if (!fs.existsSync(staged)) { stagedNote = `SKIP 没有暂存包 ${staged}（先 node vendor/whale/build.mjs）`; return; }
  for (const [entry, rel] of [
    ['lib/welcome/cyber-splash.js', 'cyber-splash.js'],
    ['renderer/whale-splash.js', 'renderer/whale-splash.js'],
    ['renderer/replay.js', 'renderer/replay.js'],
    ['renderer/welcome.html', 'renderer/welcome.html'],
  ]) {
    let buf = null;
    try { buf = readAsarEntry(staged, entry); } catch { buf = null; }
    assert.ok(buf, `暂存包里没有 ${entry}：这是旧构建，重新 build 再落盘`);
    assert.ok(buf.equals(fs.readFileSync(path.join(MAT, rel))), `暂存包里的 ${entry} 与仓库不一致：重新 build`);
  }
});

// ── 汇总 ───────────────────────────────────────────────────────────────

if (stagedNote) console.log(stagedNote);
const failed = results.filter((r) => !r.ok);
for (const r of results) {
  console.log(`${r.ok ? '  ok  ' : ' FAIL '} ${r.name}`);
  if (!r.ok) console.log(`        ${r.err?.message ?? r.err}`);
}
console.log('');
if (failed.length) {
  console.log(`启动动画单测失败：${failed.length}/${results.length}`);
  process.exit(1);
}
console.log(`启动动画单测通过：${results.length}/${results.length} 项`);
