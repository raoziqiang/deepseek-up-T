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
import { readFileSync, existsSync, rmSync } from 'node:fs';
import vm from 'node:vm';
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

// ── ⓪ 心跳 ──────────────────────────────────────────────────────
//
// 心跳是「这个插件到底被加载并执行了没有」的**唯一文件级证据**：宿主侧的失败路径
// 全都是静默的（没重启 → 什么都没发生；客户端脚本 404 → 开关里少一页），
// 所以 doctor 只能靠这枚文件回答「重启有没有把我的插件装进去」。
// 它必须真的落盘、是合法 JSON、且 pid 就是加载它的那个进程。

check('apply() 第一件事就是写心跳（不依赖任何服务，所以不会被后续失败吞掉）', () => {
  assert.equal(mod.heartbeatPath, path.join(PLUGIN, '.runtime', 'heartbeat.json'));
  assert.ok(existsSync(mod.heartbeatPath), `心跳文件不存在：${mod.heartbeatPath}`);
});

check('心跳是合法 JSON，且带 plugin / version / pid / at', () => {
  const beat = JSON.parse(readFileSync(mod.heartbeatPath, 'utf8'));
  assert.equal(beat.plugin, 'dsh-up-t');
  assert.equal(beat.version, JSON.parse(readFileSync(path.join(PLUGIN, 'package.json'), 'utf8')).version);
  assert.equal(beat.pid, process.pid, 'pid 必须是写它的那个进程，否则 doctor 的存活判断没有意义');
  assert.ok(Number.isFinite(Date.parse(beat.at)), `at 不是可解析的时间：${beat.at}`);
});

check('心跳绝不抛异常：写不进去也要返回 ok=false 而不是让 apply() 炸掉', () => {
  const res = mod.writeHeartbeat();
  assert.equal(typeof res, 'object');
  assert.equal(res.ok, true);
  assert.equal(res.file, mod.heartbeatPath);
});

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

// 心跳的对外面：status.json 必须把**磁盘上**的心跳原样带出来。
// 这一条必须放在服务就绪之后 —— 它走的是真实路由，不是直接调 collectStatus。
check('status.json 把磁盘上的心跳原样带出来，且写失败时显式暴露', () => {
  const route = state.routes.find((r) => r.path === STATUS_PATH);
  const res = makeRes();
  route.handler({ url: STATUS_PATH }, res);
  const status = JSON.parse(res.body.toString('utf8'));
  assert.equal(status.heartbeatWriteError, null, '心跳写失败必须显式暴露，不能静默');
  assert.equal(status.heartbeatFile, mod.heartbeatPath);
  assert.equal(status.heartbeat?.pid, process.pid, 'status 里的心跳必须来自磁盘，而不是内存里的变量');
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

// ── ④ 客户端 bundle（lib/client.js）────────────────────────────────
//
// 为什么客户端半侧也要离线测：它的失败同样是**静默**的——包声明了 dsh.client 而 bundle 形态
// 不对时，表现只是「设置里没有那一页」，既不报错也没有堆栈。
// 这里给一个 stub 的 window.__ModuleLoader__ 抓下 factory，再自己执行并跑一遍 apply()。

const CLIENT_SRC = readFileSync(path.join(PLUGIN, 'lib', 'client.js'), 'utf8');

function makeReactStub() {
  return {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState: (initial) => [initial, () => {}],
    useEffect: () => {},
  };
}

function runClientBundle({ withLoader = true } = {}) {
  let captured = null;
  const sandbox = {
    window: withLoader ? { __ModuleLoader__: { load: (spec) => (captured = spec) } } : {},
    Symbol,
    Object,
    Array,
    JSON,
    Math,
    Error,
    setInterval: () => 0,
    clearInterval: () => {},
    fetch: () => Promise.reject(new Error('offline')),
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(CLIENT_SRC, sandbox, { filename: 'plugins/dsh-up-t/lib/client.js' });
  return captured;
}

const bundle = runClientBundle();
const clientExports =
  bundle && typeof bundle.factory === 'function'
    ? bundle.factory((name) => {
        if (name === 'react') return makeReactStub();
        throw new Error(`客户端 bundle 出现了未声明的 require：${name}`);
      })
    : null;

const clientState = { injectKeys: [], registers: [] };

check('lib/client.js 是经典脚本，不含 ESM 语法', () => {
  assert.ok(!/^\s*(import|export)\s/m.test(CLIENT_SRC), '不得含 ESM import/export（CSP 不允许）');
  assert.ok(CLIENT_SRC.includes('__ModuleLoader__'), '必须走 ModuleLoader 协议');
});

check('没有 __ModuleLoader__ 时静默退出、不抛错', () => {
  const captured = runClientBundle({ withLoader: false });
  assert.equal(captured, null);
});

check('bundle 以 id="dsh-up-t" 注册，factory 导出 Cordis 客户端插件', () => {
  assert.ok(bundle, '没有抓到 load() 的调用');
  assert.equal(bundle.id, 'dsh-up-t');
  assert.equal(typeof bundle.factory, 'function');
  assert.ok(clientExports, 'factory 没有返回模块');
  assert.equal(typeof clientExports.apply, 'function');
  // 注意：vm 里造出来的数组与宿主 realm 不同源，所以只能用 Array.isArray + Array.from 比较。
  assert.equal(Array.isArray(clientExports.inject), true);
  assert.deepEqual(Array.from(clientExports.inject), ['slots'], '客户端半侧必须 inject slots');
  assert.equal(clientExports[Symbol.toStringTag], 'Module');
});

check('apply() 只向 settings.section 注册一个条目，形态正确', () => {
  const ctx = {
    effect(fn) {
      assert.equal(typeof fn(), 'function', 'ctx.effect 必须返回 disposer');
    },
    slots: {
      inject(key, cb) {
        clientState.injectKeys.push(key);
        return cb();
      },
      register(entry, component) {
        clientState.registers.push({ entry, component });
        return () => {};
      },
    },
  };
  clientExports.apply(ctx);
  assert.deepEqual(clientState.injectKeys, ['settings.section']);
  assert.equal(clientState.registers.length, 1);
  const { entry, component } = clientState.registers[0];
  assert.equal(entry.name, 'settings.section');
  assert.equal(entry.id, 'dsh-up-t');
  assert.equal(typeof entry.order, 'number');
  assert.equal(entry.label(), 'deepseek-up-T');
  assert.equal(typeof entry.inject, 'function');
  assert.equal(Object.keys(entry.inject()).length, 0, 'business share 应为空对象');
  assert.equal(typeof component, 'function');
});

check('设置页组件能渲染出 loading 态（不抛、返回元素树）', () => {
  const { component } = clientState.registers[0];
  const el = component();
  assert.ok(el && typeof el === 'object', '组件必须返回元素');
  assert.equal(el.type, 'div');
});

check('package.json 声明了 dsh.client.platform=web 且导出 ./client', () => {
  const pkg = JSON.parse(readFileSync(path.join(PLUGIN, 'package.json'), 'utf8'));
  assert.equal(pkg.dsh.client.platform, 'web');
  assert.equal(pkg.exports['./client'].default, './lib/client.js');
  assert.equal(pkg.exports['.'].default, './lib/index.js');
});

// ── 汇总 ────────────────────────────────────────────────────────

// 必须清理：这枚心跳的 pid 是测试进程，测试一退出它就变成「来自已退出进程」，
// 留着会让下一次 `dsht doctor` 报 WARN。测试不许给真实环境留状态。
try { rmSync(path.dirname(mod.heartbeatPath), { recursive: true, force: true }); } catch { /* 忽略 */ }

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
