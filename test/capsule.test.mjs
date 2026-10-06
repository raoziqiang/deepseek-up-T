// deepseek-up-T :: 左下角胶囊（plugins/dsh-up-t/assets/client.js）的离线行为级单测
//
// 为什么要有它，而不是「看一眼代码觉得没问题」：
// 这段脚本整段包在一个 `try { … } catch (e) { console.warn(…) }` 里 —— 这是**刻意的**
// （挂件坏了绝不能影响主界面），代价是**任何异常都会变成「界面上什么都没有」**：
// 没有胶囊、没有报错、没有任何堆栈。用户重启 Harness 之后能看到的只有「说好的胶囊呢」。
//
// 而且它是注入行里唯一真正跑在渲染层的代码：宿主侧的心跳与路由全绿，也不代表它跑起来了。
//
// 所以这里不检查「语法对不对」，而是**把它真的跑一遍**：给一个最小的假 DOM、
// 假 localStorage、假 fetch（回一份真实形状的 status.json），然后断言
//   ① 胶囊真的出现在 DOM 里；
//   ② 点一下面板真的展开、里面的数字真的是人话；
//   ③ 拖动、右键隐藏、重复注入这些路径真的改到了该改的状态；
//   ④ 全程那条 `client failed` 警告一次都没响（异常被吞掉这件事本身要被测到）。
//
//   node test/capsule.test.mjs

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '..');
const SRC = readFileSync(path.join(PROJECT, 'plugins', 'dsh-up-t', 'assets', 'client.js'), 'utf8');

const results = [];
const RUNS = []; // 每次沙箱运行都记一笔，最后横向检查有没有哪一次让外层 catch 响了
async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, err });
  }
}

// ── 假 DOM ────────────────────────────────────────────────────────
//
// 只需要实现这段脚本真的用到的那些：createElement / appendChild / style / textContent /
// addEventListener / dispatch / getBoundingClientRect / setPointerCapture。
// textContent 的 setter 必须像真 DOM 一样**顺手清掉子节点**（脚本靠 `panel.textContent=''` 重画面板）。

function makeNode(tag) {
  const node = {
    tagName: String(tag).toUpperCase(),
    style: {},
    children: [],
    parentNode: null,
    listeners: {},
    appendChild(child) {
      child.parentNode = node;
      node.children.push(child);
      return child;
    },
    addEventListener(type, fn) {
      (node.listeners[type] || (node.listeners[type] = [])).push(fn);
    },
    removeEventListener(type, fn) {
      node.listeners[type] = (node.listeners[type] || []).filter((f) => f !== fn);
    },
    setPointerCapture() {},
    releasePointerCapture() {},
    getBoundingClientRect() {
      return {
        left: parseFloat(node.style.left) || 0,
        top: parseFloat(node.style.top) || 0,
        width: 40,
        height: 20,
      };
    },
    dispatch(type, ev) {
      const list = (node.listeners[type] || []).slice();
      assert.ok(list.length > 0, `这个节点上没有 ${type} 监听器`);
      for (const fn of list) fn(ev);
    },
    hasListener(type) {
      return (node.listeners[type] || []).length > 0;
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

function makeDom({ body = true, documentElement = true, readyState = 'complete' } = {}) {
  const created = [];
  const docListeners = {};
  const document = {
    readyState,
    documentElement: null,
    body: null,
    createElement(tag) {
      const n = makeNode(tag);
      created.push(n);
      return n;
    },
    addEventListener(type, fn) {
      (docListeners[type] || (docListeners[type] = [])).push(fn);
    },
    dispatch(type, ev) {
      for (const fn of (docListeners[type] || []).slice()) fn(ev);
    },
    listenerCount(type) {
      return (docListeners[type] || []).length;
    },
  };
  if (documentElement) {
    const el = makeNode('html');
    document.documentElement = el;
    if (body) {
      const b = makeNode('body');
      el.appendChild(b);
      document.body = b;
    }
  }
  return { document, created };
}

function makeStorage(initial = {}, { throws = false } = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem(k) {
      if (throws) throw new Error('SecurityError: 存储被禁用');
      return map.has(k) ? map.get(k) : null;
    },
    setItem(k, v) {
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

const SEEN_URL = '/dsh-up-t/seen';

/**
 * 假 fetch。默认把握手（/seen）答成 200 —— 大多数用例只关心状态查询那一次。
 * 想指定某一次调用，就给 responder 加 `match`（字符串按 includes、正则按 test）。
 * 没有 `match` 的 responder 只喂给非握手请求，免得顺序一挪就吃到握手那一次。
 */
function makeFetch(responders = []) {
  const calls = [];
  const queue = responders.map((r) => ({ ...r, used: false }));
  const matches = (m, url) => (typeof m === 'string' ? url.includes(m) : m.test(url));
  const fetchImpl = (url, opts) => {
    calls.push({ url, opts });
    const idx = queue.findIndex((r) => !r.used && (r.match ? matches(r.match, url) : url !== SEEN_URL));
    if (idx < 0) {
      if (url === SEEN_URL) return Promise.resolve({ status: 200, json: async () => ({ ok: true }) });
      return Promise.reject(new Error(`没有排队的假响应：${url}`));
    }
    const r = queue[idx];
    r.used = true;
    if (r.reject) return Promise.reject(new Error(r.reject));
    return Promise.resolve({ status: r.status ?? 200, json: async () => r.json });
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

const tick = () => new Promise((r) => setImmediate(r));

/** 一份**真实形状**的 /dsh-up-t/status.json（字段抄自现场那台机器）。 */
function statusPayload(over = {}) {
  return {
    ok: true,
    time: '2026-10-06T09:20:00-07:00',
    plugin: { name: 'dsh-up-t', version: '0.1.0', pid: 4242, startedAt: '2026-10-06T09:00:00-07:00' },
    install: {
      dir: 'D:\\Program Files (x86)\\deepseekharness',
      version: '44.0.0',
      asarBytes: 121415560,
      backupBytes: 121348951,
      sameSizeAsBackup: false,
      judgedBy: 'size',
    },
    ...over,
  };
}

function runCapsule({
  readyState = 'complete',
  body = true,
  documentElement = true,
  storage,
  responders = [],
  twice = false,
  win = {},
} = {}) {
  const dom = makeDom({ body, documentElement, readyState });
  const warns = [];
  const infos = [];
  const timeouts = [];
  const intervals = [];
  const fetchImpl = makeFetch(responders);
  const storageImpl = storage || makeStorage();
  const window_ = {
    innerWidth: 1200,
    innerHeight: 800,
    addEventListener(type, fn) {
      (window_.listeners[type] || (window_.listeners[type] = [])).push(fn);
    },
    removeEventListener(type, fn) {
      window_.listeners[type] = (window_.listeners[type] || []).filter((f) => f !== fn);
    },
    listeners: {},
    ...win,
  };
  const sandbox = {
    window: window_,
    document: dom.document,
    localStorage: storageImpl,
    fetch: fetchImpl,
    console: {
      warn: (...a) => warns.push(a.map((x) => String(x)).join(' ')),
      info: (...a) => infos.push(a.map((x) => String(x)).join(' ')),
      log: () => {},
    },
    setTimeout: (fn) => {
      timeouts.push(fn);
      return timeouts.length;
    },
    clearTimeout: () => {},
    setInterval: (fn) => {
      intervals.push(fn);
      return intervals.length;
    },
    clearInterval: () => {},
    Math,
    JSON,
    Object,
    Array,
    String,
    Number,
    Error,
    parseFloat,
    parseInt,
    isFinite,
  };
  vm.createContext(sandbox);
  const ctx = { filename: 'plugins/dsh-up-t/assets/client.js' };
  vm.runInContext(SRC, sandbox, ctx);
  if (twice) vm.runInContext(SRC, sandbox, ctx);
  const run = { dom, window: window_, storage: storageImpl, fetch: fetchImpl, warns, infos, timeouts, intervals, sandbox };
  RUNS.push(run);
  return run;
}

// 胶囊用 borderRadius:999px 认，**不要**用 cursor === 'grab' 认：按下时它会被改成 'grabbing'，
// 于是「按住之后再找一次胶囊」会找不到 —— 这正是第一版测试里两个用例假失败的原因。
function findChip(dom) {
  return dom.created.find((n) => n.style.borderRadius === '999px');
}
function findPanel(dom) {
  return dom.created.find((n) => n.style.minWidth === '290px');
}
function findRoot(dom) {
  return dom.created.find((n) => n.style.zIndex != null && n.style.position === 'fixed');
}

// ── ① 它是经典脚本 ────────────────────────────────────────────────

await check('是经典脚本（无 ESM）、有幂等标记、不往全局漏名字', () => {
  assert.ok(!/^\s*(import|export)\s/m.test(SRC), '不得含 ESM import/export（CSP 不允许）');
  assert.ok(SRC.includes('__DSH_UP_T_CLIENT__'), '必须有幂等标记，否则重复注入会挂出第二个胶囊');
  assert.ok(/^\(function \(\) \{/m.test(SRC), '整段必须包在 IIFE 里');
});

// ── ② 挂载 ────────────────────────────────────────────────────────

await check('readyState=complete 时立刻挂载：胶囊出现在 body 里、初始文案是 up-T', () => {
  const r = runCapsule();
  assert.ok(r.dom.document.body, '假 DOM 得有 body');
  assert.equal(r.dom.document.body.children.length, 1, 'body 下应恰有一个胶囊根节点');
  const root = r.dom.document.body.children[0];
  assert.equal(root, findRoot(r.dom), '挂上去的应该是那个 position:fixed 的根节点');
  const chip = findChip(r.dom);
  assert.ok(chip, '必须造出可拖动的胶囊');
  assert.equal(chip.textContent, 'up-T', '状态还没回来时文案就该是 up-T');
  assert.deepEqual(r.warns, [], '外层 catch 不许响');
});

await check('readyState=loading（注入行在 head 里先跑）时先等 DOMContentLoaded，再挂载', () => {
  const r = runCapsule({ readyState: 'loading' });
  assert.equal(r.dom.created.length, 0, 'loading 阶段不该建任何节点');
  assert.equal(r.dom.document.listenerCount('DOMContentLoaded'), 1, '必须挂上 DOMContentLoaded');
  r.dom.document.dispatch('DOMContentLoaded', {});
  assert.equal(r.dom.document.body.children.length, 1, 'DOMContentLoaded 之后应该挂上胶囊');
});

await check('没有 document.body 时退到 documentElement；两者都没有时重试而不是放弃', async () => {
  const a = runCapsule({ body: false });
  assert.equal(a.dom.document.documentElement.children.length, 1, '没有 body 时挂到 documentElement');
  assert.equal(a.dom.created.length, 5, '根节点 + 胶囊 + 圆点 + 文案 + 面板');

  const b = runCapsule({ body: false, documentElement: false });
  assert.equal(b.dom.created.length, 0, '两者都没有时不该硬建节点');
  assert.equal(b.timeouts.length, 1, '必须留下一次重试（setTimeout）');
  const w = makeDom({ body: true, documentElement: true });
  b.sandbox.document.documentElement = w.document.documentElement;
  b.sandbox.document.body = w.document.body;
  b.timeouts[0](); // 重试
  assert.equal(w.document.body.children.length, 1, '重试成功时胶囊要挂上');
});

await check('重复注入同一段脚本只会有一个胶囊（幂等标记生效）', () => {
  const r = runCapsule({ twice: true });
  assert.equal(r.dom.document.body.children.length, 1, '第二次执行必须直接 return');
  assert.equal(r.dom.created.length, 5, '第二次执行不该再造 5 个节点');
});

// ── ③ 握手 ────────────────────────────────────────────────────────

await check('挂载时先向宿主握手：POST /dsh-up-t/seen，带自定义头与 via=capsule', () => {
  const r = runCapsule({ storage: makeStorage(), responders: [{ json: statusPayload() }] });
  const seen = r.fetch.calls.find((c) => c.url === '/dsh-up-t/seen');
  assert.ok(seen, '没有发出握手请求');
  assert.equal(seen.opts.method, 'POST');
  assert.equal(seen.opts.headers['x-dsh-up-t'], '1', '握手必须带自定义头（宿主按它挡跨源）');
  assert.deepEqual(JSON.parse(seen.opts.body), { via: 'capsule' }, '两条投递通道必须可区分');
});

await check('握手失败（宿主还是旧版、路由 404）不影响挂载', async () => {
  const r = runCapsule({ responders: [{ match: SEEN_URL, reject: 'ECONNREFUSED' }] });
  await tick();
  assert.equal(r.dom.document.body.children.length, 1, '握手炸了胶囊仍要在');
  assert.deepEqual(r.warns, [], '外层 catch 不许响');
});

// ── ④ 状态渲染 ────────────────────────────────────────────────────

await check('状态回来后：文案变成「up-T · 44.0.0」、圆点变绿（已改造）', async () => {
  const r = runCapsule({ responders: [{ json: statusPayload() }] });
  await tick();
  const label = r.dom.created.find((n) => n.tagName === 'SPAN' && /^up-T/.test(n.textContent));
  assert.equal(label.textContent, 'up-T · 44.0.0');
  const dot = r.dom.created.find((n) => n.style.borderRadius === '50%');
  assert.equal(dot.style.background, '#3fb950', 'sameSizeAsBackup=false 应点绿');
  assert.deepEqual(r.warns, []);
});

await check('点一下胶囊展开面板：数字是人话、判定说「已被改造」、并给出依据与目录', async () => {
  const r = runCapsule({ responders: [{ json: statusPayload() }] });
  await tick();
  const chip = findChip(r.dom);
  const panel = findPanel(r.dom);
  assert.equal(panel.style.display, 'none', '默认收起');
  chip.dispatch('pointerdown', { clientX: 10, clientY: 10, pointerId: 1 });
  chip.dispatch('pointerup', { clientX: 10, clientY: 10, pointerId: 1 });
  assert.equal(panel.style.display, 'block', '点一下应展开');
  const text = panel.textContent;
  assert.match(text, /deepseek-up-T · 改造状态/);
  assert.match(text, /dsh-up-t 0\.1\.0/);
  assert.match(text, /Harness44\.0\.0/, '版本号要出现在面板里');
  assert.match(text, /115\.8 MB/, 'app.asar 字节数要转成人话（115.8 MB）');
  assert.match(text, /115\.7 MB/, '原版备份同理');
  assert.match(text, /大小不同 —— 安装包已被改造/);
  assert.match(text, /只比了文件大小/);
  assert.match(text, /deepseekharness/, '要给出它认到的安装目录，否则无法对账');
  assert.match(text, /右键点这个胶囊可以隐藏它/);
  assert.deepEqual(r.warns, []);
});

await check('再点一下收起；拖动只改位置、不展开面板，并把位置存进 localStorage', async () => {
  const r = runCapsule({ responders: [{ json: statusPayload() }] });
  await tick();
  const chip = findChip(r.dom);
  const panel = findPanel(r.dom);
  const root = findRoot(r.dom);

  chip.dispatch('pointerdown', { clientX: 10, clientY: 10, pointerId: 1 });
  chip.dispatch('pointermove', { clientX: 90, clientY: 60, pointerId: 1 });
  chip.dispatch('pointerup', { clientX: 90, clientY: 60, pointerId: 1 });
  assert.equal(panel.style.display, 'none', '拖动不该顺手把面板打开');
  assert.equal(root.style.left, '92px', 'x 应被夹在窗口内（12 + 80）');
  assert.equal(root.style.top, '50px');
  assert.deepEqual(JSON.parse(r.storage.dump()['dsh-up-t:pos']), { x: 92, y: 50 });

  chip.dispatch('pointerdown', { clientX: 10, clientY: 10, pointerId: 1 });
  chip.dispatch('pointerup', { clientX: 10, clientY: 10, pointerId: 1 });
  assert.equal(panel.style.display, 'block');
  chip.dispatch('pointerdown', { clientX: 10, clientY: 10, pointerId: 1 });
  chip.dispatch('pointerup', { clientX: 10, clientY: 10, pointerId: 1 });
  assert.equal(panel.style.display, 'none', '第二下应收起');
  assert.deepEqual(r.warns, []);
});

await check('右键隐藏：根节点消失、状态持久化、并留下找回自己的提示', () => {
  const r = runCapsule();
  const chip = findChip(r.dom);
  const root = findRoot(r.dom);
  let prevented = false;
  chip.dispatch('contextmenu', { preventDefault: () => (prevented = true) });
  assert.equal(prevented, true, '必须 preventDefault，否则会弹出浏览器菜单');
  assert.equal(root.style.display, 'none');
  assert.equal(r.storage.dump()['dsh-up-t:hidden'], '1');
  assert.match(r.infos.join('\n'), /localStorage\.removeItem\("dsh-up-t:hidden"\)/);
  assert.deepEqual(r.warns, []);
});

await check('已隐藏时重新挂载：不显示，但定时刷新还在跑', () => {
  const r = runCapsule({
    storage: makeStorage({ 'dsh-up-t:hidden': '1' }),
    responders: [{ json: statusPayload() }],
  });
  assert.equal(findRoot(r.dom).style.display, 'none');
  assert.equal(r.intervals.length, 1, 'refresh 必须挂上定时器（60s）');
});

// ── ⑤ 降级：坏数据不许变成「什么都不出现」 ─────────────────────────

await check('状态查询失败 / 返回 null / 缺少 install：各自给降级文案，都不抛', async () => {
  const cases = [
    [{ reject: 'boom' }, /宿主没有回应状态查询/],
    [{ json: null }, /宿主没有回应状态查询/],
    [{ json: { ok: false, why: '还没重启' } }, /宿主没有回应状态查询/],
    [{ json: { ok: true, plugin: { name: 'dsh-up-t', version: '0.1.0' }, install: null } }, /没找到 Harness 安装目录/],
  ];
  for (const [responder, expect] of cases) {
    const r = runCapsule({ responders: [responder] });
    await tick();
    const panel = findPanel(r.dom);
    findChip(r.dom).dispatch('pointerdown', { clientX: 1, clientY: 1, pointerId: 1 });
    findChip(r.dom).dispatch('pointerup', { clientX: 1, clientY: 1, pointerId: 1 });
    assert.match(panel.textContent, expect, `降级文案不对：${JSON.stringify(responder)}`);
    assert.equal(findRoot(r.dom).style.display, undefined, '降级时胶囊本身必须还在');
    assert.deepEqual(r.warns, [], '降级不是异常');
  }
});

await check('拿不到备份时判定说「无法判断」并把圆点标黄', async () => {
  const r = runCapsule({
    responders: [
      {
        json: statusPayload({
          install: { dir: 'D:\\apps', version: '44.0.0', asarBytes: 121415560, backupBytes: null, sameSizeAsBackup: null, judgedBy: 'unavailable' },
        }),
      },
    ],
  });
  await tick();
  const label = r.dom.created.find((n) => n.tagName === 'SPAN' && /^up-T/.test(n.textContent));
  assert.equal(label.textContent, 'up-T · 44.0.0');
  const dot = r.dom.created.find((n) => n.style.borderRadius === '50%');
  assert.equal(dot.style.background, '#d29922', '无法判断应标黄');
  findChip(r.dom).dispatch('pointerdown', { clientX: 1, clientY: 1, pointerId: 1 });
  findChip(r.dom).dispatch('pointerup', { clientX: 1, clientY: 1, pointerId: 1 });
  assert.match(findPanel(r.dom).textContent, /没有原版备份可比（无法判断）/);
  assert.match(findPanel(r.dom).textContent, /拿不到|unavailable/);
});

await check('localStorage 整个被禁（getItem/setItem 都抛）时胶囊仍然可用', async () => {
  const r = runCapsule({ storage: makeStorage({}, { throws: true }), responders: [{ json: statusPayload() }] });
  await tick();
  assert.equal(r.dom.document.body.children.length, 1, '存储不可用不该让胶囊消失');
  const chip = findChip(r.dom);
  assert.ok(chip.hasListener('pointerup'), '要点得动：事件必须已经注册上');
  chip.dispatch('pointerdown', { clientX: 10, clientY: 10, pointerId: 1 });
  chip.dispatch('pointerup', { clientX: 10, clientY: 10, pointerId: 1 });
  assert.equal(findPanel(r.dom).style.display, 'block', '存储炸了面板也得能展开');
  chip.dispatch('contextmenu', { preventDefault: () => {} });
  assert.equal(findRoot(r.dom).style.display, 'none');
  assert.deepEqual(r.warns, []);
});

// ── ⑥ 收尾 ────────────────────────────────────────────────────────
//
// 每条 check 各自断言过自己那次运行的 warns，这里再横向看一遍：
// 只要有**任何一次**运行让外层 catch 响过，就说明某个分支是靠异常收场的 —— 那正是用户
// 重启后「什么都没有」的成因。所以这条不是重复，它保证的是「没有一次例外」。

await check('所有沙箱运行中都没有出现「client failed」（异常一次都没被吞掉）', () => {
  assert.ok(RUNS.length >= 10, `只跑了 ${RUNS.length} 次沙箱，覆盖不够（这条会假通过）`);
  const lines = RUNS.flatMap((r) => r.warns);
  assert.deepEqual(lines, []);
});

const failed = results.filter((r) => !r.ok);
// 失败时把栈也打出来：这套测试的失败多半来自「假 DOM 少实现了一个方法」或
// 「断言查的时机不对」，只看一句 message 往往要重新猜一遍。
for (const r of results) {
  console.log(`${r.ok ? '  ok  ' : ' FAIL '} ${r.name}`);
  if (!r.ok) console.log(`        ${r.err?.message ?? r.err}\n${r.err?.stack ?? ''}`);
}
console.log('');
if (failed.length) {
  console.log(`胶囊单测失败：${failed.length}/${results.length}`);
  process.exit(1);
}
console.log(`胶囊单测通过：${results.length}/${results.length} 项`);
