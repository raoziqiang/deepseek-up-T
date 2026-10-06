// deepseek-up-T :: dsh-up-t 插件的离线单测
//
// 为什么要有它：插件的真实运行环境是 DSH 宿主进程，而**宿主的注入表是启动时一次性收集的**——
// 这意味着「行没赶上收集」这类失败是**静默**的（装好了却什么都不出现，还不报错）。
// 这类 bug 在真机上很难复现，所以必须在离线把 apply() 的行为钉死：
//   · 注册的是内联 `script` 行，**绝不能**是 `script-src`（后者 404 会让整个应用起不来）
//   · 行文本里带 onerror 吞错
//   · 重复触发注入表不会重复推同一条
//   · webServer 就绪后注册了 client.js 与 status.json 两条精确路由
//   · 两个 handler 真的能产出可用的响应
//   · 清理路径不抛
//
//   node test/plugin.test.mjs

import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN = path.resolve(HERE, '..', 'plugins', 'dsh-up-t');

const CLIENT_PATH = '/dsh-up-t/client.js';
const STATUS_PATH = '/dsh-up-t/status.json';

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, err });
  }
}

// ── 假的宿主侧服务 ────────────────────────────────────────────────

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

  // 真实 Cordis 会在依赖就绪后调用 inject 的回调；这里手动模拟那个时刻。
  const settle = () => {
    const pending = state.pendingInject.splice(0);
    for (const cb of pending) cb(ctx);
  };

  return { state, root, ctx, settle };
}

const mod = await import(new URL(`file:///${path.join(PLUGIN, 'lib', 'index.js').replace(/\\/g, '/')}`).href);
const plugin = mod.default;

check('默认导出带 name 与 apply', () => {
  assert.equal(typeof plugin, 'object');
  assert.equal(plugin.name, 'dsh-up-t');
  assert.equal(typeof plugin.apply, 'function');
});

const { state, root, ctx, settle } = makeHarness();
plugin.apply(root);

// ── ① 注入行 ────────────────────────────────────────────────────

check('apply() 立刻注册了 webserver/index-inject（不等待任何服务）', () => {
  assert.equal(state.injectHandlers.length, 1);
  assert.equal(state.injectHandlers[0].event, 'webserver/index-inject');
});

check('对象级没有 inject —— 它会把 apply() 推迟到服务就绪之后，让行赶不上一次性收集', () => {
  assert.equal(plugin.inject, undefined);
});

function fireInject() {
  const table = [];
  state.injectHandlers[0].cb(table);
  return table;
}

check('推的是内联 script 行，不是 script-src（script-src 加载失败会拒绝 boot，整个应用起不来）', () => {
  const table = fireInject();
  assert.equal(table.length, 1);
  assert.equal(table[0].kind, 'script');
  assert.equal(typeof table[0].text, 'string');
  assert.ok(!table.some((r) => r.kind === 'script-src'), '不得出现 script-src 行');
});

check('行文本自己建 <script src=…>、吞掉 onerror、且带幂等标记', () => {
  const row = fireInject()[0];
  assert.ok(row.text.includes(`s.src="${CLIENT_PATH}"`), '行文本必须指向 client.js');
  assert.ok(row.text.includes('s.onerror=function(){}'), '必须吞掉 onerror');
  assert.ok(row.text.includes('__DSH_UP_T_LOADED__'), '必须有幂等标记');
  assert.ok(!row.text.includes('await'), '不得出现 await（渲染层对 script 行不做异步等待）');
});

check('重复触发注入表不会重复推同一条', () => {
  const table = [];
  state.injectHandlers[0].cb(table);
  state.injectHandlers[0].cb(table);
  state.injectHandlers[0].cb(table);
  assert.equal(table.length, 1);
});

check('表里已经有同目标的（旧写法留下的）行时不重复推', () => {
  const table = [{ kind: 'script', text: `var s="/x";s.src="${CLIENT_PATH}"` }];
  state.injectHandlers[0].cb(table);
  assert.equal(table.length, 1);
  const table2 = [{ kind: 'script-src', src: CLIENT_PATH }];
  state.injectHandlers[0].cb(table2);
  assert.equal(table2.length, 1);
});

// ── ② 服务就绪之后 ──────────────────────────────────────────────

check('root.inject 只依赖 webServer', () => {
  assert.equal(state.injectCalls.length, 1);
  assert.deepEqual(state.injectCalls[0].deps, ['webServer']);
});

// 模拟「依赖就绪」那一刻：真实宿主在这里才调用回调。
check('依赖就绪前就已经注册了注入行（这是桌面端能看到挂件的唯一原因）', () => {
  assert.equal(state.injectHandlers.length, 1);
  assert.equal(state.routes.length, 0, '此时还不该有路由 —— 服务没就绪');
  settle();
});

check('依赖就绪后注册了 client.js 与 status.json 两条精确路由', () => {
  assert.equal(state.routes.length, 2);
  const byPath = Object.fromEntries(state.routes.map((r) => [r.path, r]));
  assert.deepEqual(Object.keys(byPath).sort(), [CLIENT_PATH, STATUS_PATH].sort());
  for (const r of state.routes) {
    assert.equal(r.kind, 'exact');
    assert.equal(typeof r.handler, 'function');
  }
});

check('注册了 tapIndex（Web 形态用；桌面端靠注入行）', () => {
  assert.equal(state.tapIndexFns.length, 1);
  const html = state.tapIndexFns[0]('<html><body>hi</body></html>');
  assert.ok(html.includes(`<script defer src="${CLIENT_PATH}"></script>`));
  assert.ok(html.indexOf('</body>') > html.indexOf(CLIENT_PATH), '标签必须在 </body> 之前');
  const again = state.tapIndexFns[0](html);
  assert.equal(again, html, 'tapIndex 必须幂等');
});

check('client.js 路由返回 200 + JS 且内容非空', () => {
  const route = state.routes.find((r) => r.path === CLIENT_PATH);
  const res = makeRes();
  route.handler({ url: CLIENT_PATH }, res);
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['Content-Type'], /javascript/);
  assert.ok(Buffer.isBuffer(res.body));
  const text = res.body.toString('utf8');
  assert.ok(text.length > 500, '客户端脚本不该是空的');
  assert.ok(text.includes('__DSH_UP_T_CLIENT__'), '必须是经典脚本 IIFE 形态');
  assert.ok(!/^\s*import\s/m.test(text), '不得含 ESM import（CSP 不允许）');
});

check('status.json 路由返回可解析的 JSON，且字段齐备', () => {
  const route = state.routes.find((r) => r.path === STATUS_PATH);
  const res = makeRes();
  route.handler({ url: STATUS_PATH }, res);
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['Content-Type'], /application\/json/);
  const j = JSON.parse(res.body.toString('utf8'));
  assert.equal(j.ok, true);
  assert.equal(j.plugin.name, 'dsh-up-t');
  assert.equal(typeof j.plugin.version, 'string');
  assert.equal(typeof j.time, 'string');
  if (j.install) {
    assert.equal(j.install.judgedBy, 'size', '只允许按大小判定，不得声称逐字节结论');
    assert.equal(typeof j.install.dir, 'string');
    assert.ok([true, false, null].includes(j.install.sameSizeAsBackup));
  }
});

// ── ③ 清理 ──────────────────────────────────────────────────────

check('两条清理路径都可调用且不抛', () => {
  for (const fn of state.rootEffects) {
    const dispose = fn();
    assert.equal(typeof dispose, 'function');
    dispose();
  }
  for (const fn of state.ctxEffects) {
    const dispose = fn();
    assert.equal(typeof dispose, 'function');
    dispose();
  }
});

// ── 汇总 ────────────────────────────────────────────────────────

const failed = results.filter((r) => !r.ok);
for (const r of results) {
  console.log(`${r.ok ? '  ok  ' : ' FAIL '} ${r.name}`);
  if (!r.ok) console.log(`        ${r.err?.message ?? r.err}`);
}
console.log('');
if (failed.length) {
  console.log(`插件单测失败：${failed.length}/${results.length}`);
  process.exit(1);
}
console.log(`插件单测通过：${results.length}/${results.length} 项`);
