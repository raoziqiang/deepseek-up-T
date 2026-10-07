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
import { readFileSync, existsSync, rmSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN = path.resolve(HERE, '..', 'plugins', 'dsh-up-t');

const CLIENT_PATH = '/dsh-up-t/client.js';
const STATUS_PATH = '/dsh-up-t/status.json';
const ACTION_PATH = '/dsh-up-t/action';
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

/** 处理请求的那几条路径是异步的（读 body、跑子进程），所以要有异步版。 */
async function checkAsync(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, err });
  }
}

/** 假的 IncomingMessage：只实现路由真正用到的那几样。 */
function makeReq({ method = 'POST', headers = {}, body = '' } = {}) {
  const listeners = { data: [], end: [], error: [] };
  let resumed = false;
  let destroyed = false;
  const req = {
    method,
    headers,
    resumed: false,
    destroyed: false,
    destroy() { destroyed = true; req.destroyed = true; },
    // 真实 IncomingMessage 一定有 resume()：守卫拒掉一个带 body 的 POST 时靠它把流排空，
    // 否则连接不会被复用。假件漏了它，会让「403 守卫」看起来返回 500（被 try/catch 吞掉）。
    resume() { resumed = true; req.resumed = true; return req; },
    on(event, cb) { (listeners[event] ??= []).push(cb); return req; },
  };
  // 真实的 req 是流：注册完监听器之后才会推数据，且是异步的。
  queueMicrotask(() => {
    if (destroyed) return;
    if (!resumed) for (const cb of listeners.data) cb(Buffer.from(body, 'utf8'));
    for (const cb of listeners.end) cb();
  });
  return req;
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

// 宿主可能正跑着、且在它自己 apply() 时已经把心跳写进了 .runtime/heartbeat.json。
// 下面这些用例会把这枚文件反复覆写成「测试进程的心跳」，而宿主只在加载时写一次、
// 没有别的重写路径 —— 所以必须在动它之前把宿主的那一份原样存下来，结尾写回。
// （老版清理直接 rmSync 整个 .runtime：跑一次测试套件，宿主的心跳就没了，
// `dsht accept` 的「插件写过心跳」从此 SKIP 到下一次重启为止 —— 修的就是这个。）
const hostHeartbeat = existsSync(mod.heartbeatPath)
  ? readFileSync(mod.heartbeatPath)
  : null;

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

check('依赖就绪后注册了 client.js / status.json / action / seen 四条精确路由', () => {
  assert.equal(state.routes.length, 4);
  const byPath = Object.fromEntries(state.routes.map((r) => [r.path, r]));
  assert.deepEqual(Object.keys(byPath).sort(), [CLIENT_PATH, STATUS_PATH, ACTION_PATH, SEEN_PATH].sort());
  for (const r of state.routes) {
    assert.equal(r.kind, 'exact');
    assert.equal(typeof r.handler, 'function');
  }
});

check('依赖就绪后心跳推进到 ready，并记下路由与完整的 trail', () => {
  const beat = JSON.parse(readFileSync(mod.heartbeatPath, 'utf8'));
  assert.equal(beat.stage, 'ready');
  assert.deepEqual(beat.routes, [CLIENT_PATH, STATUS_PATH, ACTION_PATH, SEEN_PATH]);
  assert.deepEqual(beat.trail.map((s) => s.stage), ['apply', 'ready'], 'trail 要能看出它走过哪两步');
  assert.equal(beat.loadedAt, beat.trail[0].at, 'loadedAt 必须钉在第一枚心跳的时刻，不能随 ready 一起被改写');
  assert.ok(beat.at >= beat.loadedAt, `at(${beat.at}) 不该早于 loadedAt(${beat.loadedAt})`);
});

// 「加载了」和「能用」是两件事。只写 apply 的那种形状，正是「界面里什么都没有、也没有报错」的
// 静默失败 —— doctor 与设置页靠 stage 把这一种和「压根没加载」分开。
check('只走到 apply 的心跳形状 = 加载了但依赖没就绪（doctor / 设置页据此报警）', () => {
  mod.writeHeartbeat('apply');
  const beat = JSON.parse(readFileSync(mod.heartbeatPath, 'utf8'));
  assert.equal(beat.stage, 'apply');
  assert.equal(beat.routes, undefined, '没走到 ready 就不该声称注册了路由');
  assert.deepEqual(beat.trail.map((s) => s.stage), ['apply'], '新的 apply 要丢掉上一次生命周期的 trail');
  assert.equal(beat.loadedAt, beat.at, '只有一步时 loadedAt 就是它自己');
  mod.writeHeartbeat('ready', { routes: [CLIENT_PATH, STATUS_PATH, ACTION_PATH, SEEN_PATH] }); // 还原，后面还要用
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
  // 胶囊也要握手：注入行没被收集时，它是**唯一**能替渲染层说话的证人（而且它和设置页 bundle
  // 是两条独立的投递通道，分开记才分得清「胶囊在、设置页不在」和反过来）。
  assert.ok(text.includes("'/dsh-up-t/seen'"), '胶囊必须向 /dsh-up-t/seen 握手');
  assert.ok(text.includes("via: 'capsule'"), '两条通道要靠 via 区分');
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

/** 把路由的响应体当 JSON 读。握手那一段也用得到，所以定义必须在这两段之前。 */
const actionJson = (res) => JSON.parse(res.body.toString('utf8'));

// ── 握手通道（/dsh-up-t/seen）──────────────────────────────────────
//
// 这是「界面里出现了吗」这条链上**最后一段静默区**：宿主知道自己注册了路由（心跳的 ready），
// 但不知道浏览器有没有真的把脚本跑起来 —— 注入行可能没被收集、bundle 可能在渲染层抛错，
// 两种都不报错。所以让渲染层自己 POST 一句「我到了」，并把两条投递通道分开记。

/** 打一次 seen 路由并等它给出响应。 */
async function driveSeen(req) {
  const route = state.routes.find((r) => r.path === SEEN_PATH);
  assert.ok(route, 'seen 路由必须已注册');
  const res = makeRes();
  route.handler(req, res);
  for (let i = 0; i < 4000 && res.statusCode === null; i += 1) {
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.notEqual(res.statusCode, null, '路由没有给出任何响应');
  return res;
}

await checkAsync('seen 路由：GET 只读（还没人握手时 seen 为 null，永不记录）', async () => {
  const res = await driveSeen(makeReq({ method: 'GET' }));
  assert.equal(res.statusCode, 200);
  const j = actionJson(res);
  assert.equal(j.ok, true);
  assert.equal(j.seen, null, 'GET 绝不能凭空造出一次握手');
});

await checkAsync('seen 路由：缺 x-dsh-up-t 头一律 403（别的网页不能伪造握手）', async () => {
  const res = await driveSeen(makeReq({ method: 'POST', body: JSON.stringify({ via: 'bundle' }) }));
  assert.equal(res.statusCode, 403);
  assert.equal(actionJson(res).ok, false);
});

await checkAsync('seen 路由：握手落进内存与磁盘心跳，且两条通道分开记', async () => {
  const res = await driveSeen(makeReq({
    method: 'POST',
    headers: { 'x-dsh-up-t': '1' },
    body: JSON.stringify({ via: 'capsule' }),
  }));
  assert.equal(res.statusCode, 200);
  const seen = actionJson(res).seen;
  assert.ok(Number.isFinite(Date.parse(seen.at)), '握手必须带时间戳');
  assert.equal(seen.count, 1);
  assert.deepEqual(Object.keys(seen.sources), ['capsule']);

  // 磁盘上的那一份才是 doctor 的证据（doctor 只读文件）。
  const beat = JSON.parse(readFileSync(mod.heartbeatPath, 'utf8'));
  assert.equal(beat.client.count, 1);
  assert.ok(beat.client.sources.capsule, '磁盘心跳里必须能看出是哪条通道握的手');
  assert.equal(beat.client.sources.bundle, undefined, 'bundle 还没握过手，就不能凭空记上');

  // 第二条通道：同一份记录里应当出现两个来源。
  await driveSeen(makeReq({
    method: 'POST',
    headers: { 'x-dsh-up-t': '1' },
    body: JSON.stringify({ via: 'bundle' }),
  }));
  const beat2 = JSON.parse(readFileSync(mod.heartbeatPath, 'utf8'));
  assert.equal(beat2.client.count, 2);
  assert.deepEqual(Object.keys(beat2.client.sources).sort(), ['bundle', 'capsule']);

  // status.json 也要带出来（设置页显示的就是它）。
  const statusRes = makeRes();
  state.routes.find((r) => r.path === STATUS_PATH).handler({ url: STATUS_PATH }, statusRes);
  const status = actionJson(statusRes);
  assert.equal(status.clientSeen.count, 2, 'status 必须带上当前的握手状态');
});

// ── 操作通道（/dsh-up-t/action）────────────────────────────────────
//
// 这一段守的是「按钮点了会发生什么」。它的失败模式同样是静默的：路由没注册、守卫漏了、
// 或者 spawn 那一层根本跑不起来 —— 界面上只会看到一个转圈然后什么都没有。
// 所以这里既断言守卫（403/405/400），也**真的 spawn 一次**。

/** 打一次 action 路由并等它给出响应。 */
async function driveAction(req) {
  const route = state.routes.find((r) => r.path === ACTION_PATH);
  assert.ok(route, 'action 路由必须已注册');
  const res = makeRes();
  route.handler(req, res);
  for (let i = 0; i < 4000 && res.statusCode === null; i += 1) {
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.notEqual(res.statusCode, null, '路由没有给出任何响应');
  return res;
}

await checkAsync('action 路由：GET 无头也答一句（好让人用浏览器确认路由活着）', async () => {
  const res = await driveAction(makeReq({ method: 'GET' }));
  assert.equal(res.statusCode, 200);
  const j = actionJson(res);
  assert.equal(j.ok, true);
  assert.ok(Array.isArray(j.actions) && j.actions.length > 0);
  assert.ok(j.actions.includes('doctor') && j.actions.includes('snapshotCreate'));
  // 验收是重启之后要用的那一个，而且**只读**：它不该被标成写盘类（否则界面会先弹一次确认，
  // 而「确认要验收吗」这种问题会教人习惯性点掉确认框 —— 那个习惯迟早会点掉一个真的写操作）。
  assert.ok(j.actions.includes('accept'), '重启后验收必须挂在界面上');
  assert.equal(mod.ACTIONS.accept.writes, false, 'accept 只读，不得标成写盘类');
  assert.deepEqual(Array.from(mod.ACTIONS.accept.argv({})), ['accept']);
});

await checkAsync('action 路由：specs 表完整，且写盘类操作都标了 writes（界面据此二次确认）', async () => {
  const res = await driveAction(makeReq({ method: 'GET' }));
  const specs = actionJson(res).specs;
  assert.ok(Array.isArray(specs) && specs.length > 0, 'GET 必须带上界面要用的 specs');
  for (const s of specs) {
    assert.ok(typeof s.name === 'string' && s.name.length > 0, '每个 spec 都要有 name');
    assert.ok(typeof s.label === 'string' && s.label.length > 0, `${s.name} 缺 label`);
    assert.ok(typeof s.hint === 'string' && s.hint.length > 0, `${s.name} 缺 hint（界面拿它当按钮 title）`);
    assert.equal(typeof s.writes, 'boolean', `${s.name} 的 writes 必须是布尔`);
  }
  const byName = Object.fromEntries(specs.map((s) => [s.name, s]));
  for (const name of ['doctor', 'upgrade', 'precheck', 'snapshotList', 'snapshotCreate', 'upgradeStage', 'accept']) {
    assert.ok(byName[name], `specs 里缺 ${name}`);
  }
  assert.equal(byName.doctor.writes, false);
  assert.equal(byName.upgrade.writes, false);
  assert.equal(byName.snapshotList.writes, false);
  assert.equal(byName.precheck.writes, true, 'precheck 会写探针家，必须二次确认');
  assert.equal(byName.snapshotCreate.writes, true);
  assert.equal(byName.upgradeStage.writes, true, '重打会写 state/staged/，必须二次确认');
});

await checkAsync('action 路由：缺少 x-dsh-up-t 头一律 403（别的网页不能悄悄让本机跑命令）', async () => {
  const res = await driveAction(makeReq({ method: 'POST', body: JSON.stringify({ action: 'doctor' }) }));
  assert.equal(res.statusCode, 403);
  assert.match(actionJson(res).error, /x-dsh-up-t/);
});

await checkAsync('action 路由：GET 永远只列动作、绝不执行（写盘操作不能靠 GET 触发）', async () => {
  const res = await driveAction(makeReq({
    method: 'GET',
    headers: { 'x-dsh-up-t': '1' },
    body: JSON.stringify({ action: 'snapshotCreate' }),
  }));
  assert.equal(res.statusCode, 200);
  const j = actionJson(res);
  assert.equal(j.ok, true);
  assert.ok(Array.isArray(j.actions) && j.actions.length > 0);
  assert.equal(j.stdout, undefined, 'GET 不得返回任何命令输出');
  assert.equal(j.code, undefined);
});

await checkAsync('action 路由：GET/POST 之外的方法一律 405', async () => {
  const res = await driveAction(makeReq({ method: 'PUT', headers: { 'x-dsh-up-t': '1' } }));
  assert.equal(res.statusCode, 405);
  assert.match(actionJson(res).error, /POST/);
});

await checkAsync('action 路由：头对了但 body 不是 JSON 时 400', async () => {
  const res = await driveAction(makeReq({ method: 'POST', headers: { 'x-dsh-up-t': '1' }, body: '{oops' }));
  assert.equal(res.statusCode, 400);
  assert.match(actionJson(res).error, /JSON/);
});

await checkAsync('action 路由：不在白名单里的 action 返回 400 并附上白名单', async () => {
  const res = await driveAction(makeReq({
    method: 'POST',
    headers: { 'x-dsh-up-t': '1' },
    body: JSON.stringify({ action: 'rm -rf /' }),
  }));
  assert.equal(res.statusCode, 400);
  const j = actionJson(res);
  assert.equal(j.ok, false);
  assert.ok(Array.isArray(j.actions) && j.actions.includes('doctor'));
});

await checkAsync('runAction 真能把命令跑起来（顺带钉住「spawn 这一路走得通」）', async () => {
  if (!mod.findProjectRoot()) {
    console.log('  （跳过：找不到项目根，操作按钮在这个形态下不可用）');
    return;
  }
  const r = await mod.runAction('snapshotList');
  assert.equal(r.ok, true, `命令应当成功：${r.stderr || r.error || ''}`);
  assert.equal(r.code, 0);
  assert.equal(r.writes, false);
  assert.ok(r.ms >= 0);
  assert.ok(typeof r.stdout === 'string' && r.stdout.length > 0, 'stdout 不该是空的');
  assert.ok(r.root.endsWith('deepseek-up-T'));
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

/**
 * bundle 里的 `fetch` 解析到的是 **vm 沙箱的全局**，不是宿主的 globalThis，
 * 所以要换掉它必须从沙箱里换：给它一个转发到可变引用的壳。
 */
let clientFetch = () => Promise.reject(new Error('offline'));

/**
 * bundle 里的 `console.warn` 也解析到 vm 沙箱。渲染层的告警本来就该被看见 ——
 * 但那应该在断言里被看见，而不是弄脏测试输出，所以把它收进这个数组。
 */
let clientWarnings = [];

function runClientBundle({ withLoader = true, confirm, bridge } = {}) {
  let captured = null;
  clientWarnings = [];
  const win = withLoader ? { __ModuleLoader__: { load: (spec) => (captured = spec) } } : {};
  if (confirm) win.confirm = confirm;
  // 桌面挂件的桥（window.dshWhaleCharm）。它是主应用 preload 暴露的，不是本插件的代码，
  // 所以测试里必须自己放进去 —— 少了它，那一行应当降级而不是崩。
  if (bridge !== undefined) win.dshWhaleCharm = bridge;
  const sandbox = {
    window: win,
    Symbol,
    Object,
    Array,
    JSON,
    Math,
    Error,
    setInterval: () => 0,
    clearInterval: () => {},
    fetch: (...args) => clientFetch(...args),
    console: {
      log: console.log,
      info: () => {},
      warn: (...args) => clientWarnings.push(args.map(String).join(' ')),
      error: (...args) => clientWarnings.push(args.map(String).join(' ')),
    },
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
  assert.deepEqual(Array.from(clientExports.inject), ['slots', 'locale'], '客户端半侧必须 inject slots 与 locale');
  assert.equal(clientExports[Symbol.toStringTag], 'Module');
});

check('apply() 向两个槽位各注册一个条目：设置页 + 桌面挂件开关', () => {
  const ctx = {
    effect(fn) {
      assert.equal(typeof fn(), 'function', 'ctx.effect 必须返回 disposer');
    },
    get: () => undefined,
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
  assert.deepEqual(clientState.injectKeys, ['settings.section', 'settings.general.item']);
  assert.equal(clientState.registers.length, 2);
  const { entry, component } = clientState.registers[0];
  assert.equal(entry.name, 'settings.section');
  assert.equal(entry.id, 'dsh-up-t');
  assert.equal(typeof entry.order, 'number');
  assert.equal(entry.label(), 'deepseek-up-T');
  assert.equal(typeof entry.inject, 'function');
  assert.equal(Object.keys(entry.inject()).length, 0, 'business share 应为空对象');
  assert.equal(typeof component, 'function');

  // 第二项是桌面挂件开关：走 settings.general.item（list 槽位、replaceRisk: none），
  // 不写 label —— 与同槽位真实注册者 dsh-client-ui-theme 一致（行自己渲染标题）。
  const charm = clientState.registers[1];
  assert.equal(charm.entry.name, 'settings.general.item');
  assert.equal(charm.entry.id, 'whale-charm');
  assert.equal(charm.entry.order, 60, '排在「外观」(10)/「字号」(11) 之后');
  assert.equal(charm.entry.label, undefined, '通用页的条目不自带 label');
  assert.equal(typeof charm.component, 'function');
});

check('设置页组件能渲染出 loading 态（不抛、返回元素树）', () => {
  const { component } = clientState.registers[0];
  const el = component();
  assert.ok(el && typeof el === 'object', '组件必须返回元素');
  assert.equal(el.type, 'div');
});

// ── 客户端半侧的「操作」区 ─────────────────────────────────────────
//
// 这一段守的是「按钮按下之后到底发了什么」。界面上的失败是沉默的：请求打歪了、
// 或者忘了带那个自定义头，表现只是一直转圈 —— 没有任何报错。

const ACTION_SPECS = [
  { name: 'doctor', label: '体检', hint: '只读', writes: false },
  { name: 'snapshotCreate', label: '留一份快照', hint: '会写盘', writes: true },
];

/** 可编排的 React 假件：能指定 useState 的初值，并记录 effect 与 setter 调用。 */
function makeScriptedReact() {
  let i = 0;
  let states = [];
  const setCalls = [];
  const effects = [];
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState(initial) {
      const idx = i++;
      const value = idx < states.length && states[idx] !== undefined ? states[idx] : initial;
      return [value, (next) => setCalls.push({ idx, next })];
    },
    useEffect(fn) { effects.push(fn); },
  };
  return {
    React,
    setCalls,
    effects,
    setStates(list) { states = list; i = 0; },
    reset() { setCalls.length = 0; effects.length = 0; },
  };
}

/** 用给定的 React 与 window.confirm 造一份客户端实例，并取到注册的设置页组件。 */
function makeClient({ confirm, bridge } = {}) {
  const scripted = makeScriptedReact();
  const b = runClientBundle({ confirm, bridge });
  const exp = b.factory((name) => {
    if (name === 'react') return scripted.React;
    throw new Error(`客户端 bundle 出现了未声明的 require：${name}`);
  });
  const registers = [];
  const ctx = {
    effect: (fn) => fn(),
    // 语言服务：renderer 侧就是这么问语言的（inject 里有 locale）。
    // 这里给 zh-CN，好让断言能钉住中文文案本身，而不是只钉住「有字」。
    get: (key) => (key === 'locale' ? { getLocale: () => ({ id: 'zh-CN' }) } : undefined),
    slots: {
      inject: (key, cb) => cb(),
      register: (entry, component) => { registers.push({ entry, component }); return () => {}; },
    },
  };
  exp.apply(ctx);
  return {
    scripted,
    registers,
    component: registers[0].component,
    charm: registers[1] && registers[1].component,
  };
}

/** 元素树的遍历：children 里既有元素、也有数组（h("div", …, [a, b]) 是常态）。 */
function walk(node, visit) {
  if (Array.isArray(node)) {
    for (const n of node) walk(n, visit);
    return;
  }
  if (!node || typeof node !== 'object') return;
  visit(node);
  for (const c of node.children || []) walk(c, visit);
}

/** 树里第一个「type 是函数」的节点就是操作面板。 */
function findPanel(el) {
  let found = null;
  walk(el, (n) => {
    if (!found && typeof n.type === 'function') found = n;
  });
  return found;
}

function collect(el, type) {
  const out = [];
  walk(el, (n) => {
    if (n.type === type) out.push(n);
  });
  return out;
}

function withFetch(impl, fn) {
  const previous = clientFetch;
  clientFetch = impl;
  try { return fn(); } finally { clientFetch = previous; }
}

const flush = () => new Promise((r) => setTimeout(r, 0));

/**
 * 取到操作面板元素。注意顺序：**必须在改 states 之前**把外层组件渲染一次 ——
 * 外层组件（UpTSection）也会用 useState，共享同一个 state 队列。
 */
function panelOf(client) {
  const panel = findPanel(client.component());
  assert.ok(panel, '设置页里必须有操作面板');
  return panel;
}

// ── 握手：让渲染层自己说「我跑起来了」────────────────────────────────
//
// 这是「界面里出现了吗」这条链上最后一段静默区：宿主知道自己注册了那几条路由（心跳的 ready），
// 但注入行有没有被收集、bundle 有没有在渲染层真的执行，宿主无从得知 —— 而且两种失败都不报错。
// 所以让渲染层自己 POST 一句。它必须**恰好报一次**，也必须**报不出去时不影响界面**。
await checkAsync('客户端 bundle：apply 时先握一次手（证明渲染层真的加载了这个 bundle）', async () => {
  const calls = [];
  const client = withFetch((url, opts) => {
    calls.push({ url, opts });
    return Promise.resolve({ ok: true });
  }, () => makeClient());
  assert.equal(calls.length, 1, 'apply() 必须恰好握一次手');
  assert.equal(calls[0].url, '/dsh-up-t/seen');
  assert.equal(calls[0].opts.method, 'POST');
  assert.equal(calls[0].opts.headers['x-dsh-up-t'], '1', '缺这个头宿主会 403');
  assert.deepEqual(JSON.parse(calls[0].opts.body), { via: 'bundle' }, '两条投递通道必须可区分');
  assert.ok(client.component, '握手是证据不是功能：它出了任何事，设置页都必须照常注册');
  await flush();
});

await checkAsync('客户端 bundle：握手失败（比如宿主还没重启、路由不存在）绝不炸掉界面', async () => {
  const client = withFetch(() => Promise.reject(new Error('404')), () => makeClient());
  await flush();
  assert.ok(client.component, '旧宿主上没有 /dsh-up-t/seen：必须静默失败，界面照旧');
});

await checkAsync('操作面板：按钮来自宿主给的清单，而不是前端硬编码', async () => {
  const client = makeClient();
  const panel = panelOf(client);
  client.scripted.reset();
  client.scripted.setStates([{ phase: 'ready', specs: ACTION_SPECS, error: null }, '', null]);
  const tree = panel.type(panel.props);
  const buttons = collect(tree, 'button');
  assert.deepEqual(buttons.map((b) => b.children[0]), ['体检', '留一份快照 ⚠'], '⚠ 必须只出现在会写盘的操作上');
  assert.ok(CLIENT_SRC.includes('/dsh-up-t/action'), '面板必须打真实的操作路由');
  assert.ok(!/label:\s*"体检"/.test(CLIENT_SRC), '清单必须在宿主侧，不得在前端复制一份');
});

await checkAsync('操作面板：点只读按钮 → POST 到操作路由并带上自定义头与备注', async () => {
  const client = makeClient();
  const panel = panelOf(client);
  client.scripted.setStates([{ phase: 'ready', specs: ACTION_SPECS, error: null }, '我的备注', null]);
  const tree = panel.type(panel.props);
  const button = collect(tree, 'button')[0];
  const calls = [];
  withFetch((url, opts) => {
    calls.push({ url, opts });
    return Promise.resolve({ status: 200, text: () => Promise.resolve(JSON.stringify({ ok: true, code: 0 })) });
  }, () => button.props.onClick());
  await flush();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/dsh-up-t/action');
  assert.equal(calls[0].opts.method, 'POST');
  assert.equal(calls[0].opts.headers['x-dsh-up-t'], '1', '缺了这个头宿主会直接 403');
  assert.deepEqual(JSON.parse(calls[0].opts.body), { action: 'doctor', message: '我的备注' });
});

await checkAsync('操作面板：会写盘的操作要先问；答「不」就一个请求都不发', async () => {
  let asked = 0;
  const client = makeClient({ confirm: () => { asked += 1; return false; } });
  const panel = panelOf(client);
  client.scripted.setStates([{ phase: 'ready', specs: ACTION_SPECS, error: null }, '', null]);
  const writeBtn = collect(panel.type(panel.props), 'button')[1];
  let calls = 0;
  withFetch(() => { calls += 1; return Promise.resolve({ status: 200, text: () => Promise.resolve('{}') }); },
    () => writeBtn.props.onClick());
  await flush();
  assert.equal(asked, 1, '写盘操作必须先确认');
  assert.equal(calls, 0, '用户答「不」时不得发出任何请求');

  // 答「是」才发，且发的是那个会写盘的 action。
  let asked2 = 0;
  const c2 = makeClient({ confirm: () => { asked2 += 1; return true; } });
  const panel2 = panelOf(c2);
  c2.scripted.setStates([{ phase: 'ready', specs: ACTION_SPECS, error: null }, '', null]);
  const writeBtn2 = collect(panel2.type(panel2.props), 'button')[1];
  const calls2 = [];
  withFetch((url, opts) => {
    calls2.push({ url, opts });
    return Promise.resolve({ status: 200, text: () => Promise.resolve('{"ok":true}') });
  }, () => writeBtn2.props.onClick());
  await flush();
  assert.equal(asked2, 1);
  assert.equal(calls2.length, 1);
  assert.equal(JSON.parse(calls2[0].opts.body).action, 'snapshotCreate');
});

await checkAsync('操作面板：宿主半侧还没重启（404）时降级成一句「重启后可用」', async () => {
  const client = makeClient();
  const panel = panelOf(client);
  client.scripted.reset();
  client.scripted.setStates([{ phase: 'loading', specs: [], error: null }, '', null]);
  panel.type(panel.props);
  assert.equal(client.scripted.effects.length, 1, '面板挂载时必须自己去取一次清单');
  withFetch(() => Promise.resolve({ ok: false, status: 404, json: () => Promise.reject(new Error('not json')) }),
    () => client.scripted.effects[0]());
  await flush(); await flush();
  const missing = client.scripted.setCalls.find((c) => c.next && c.next.phase === 'missing');
  assert.ok(missing, '取不到清单时必须落到 missing 态，而不是一直转圈');
  client.scripted.setStates([missing.next, '', null]);
  const text = JSON.stringify(panel.type(panel.props));
  assert.match(text, /重启 Harness/);
});

check('设置页：把心跳走到哪一步也显示出来（「加载了」≠「能用」）', () => {
  const render = (heartbeat) => {
    const client = makeClient();
    client.component(); // 先渲染一次让 useState 队列就位（外层自己的 state 在 idx 0）
    client.scripted.setStates([{
      phase: 'ready',
      data: {
        plugin: { name: 'dsh-up-t', version: '0.1.0' },
        install: {},
        time: 't',
        heartbeat,
      },
    }]);
    return JSON.stringify(client.component());
  };
  assert.match(render({ stage: 'ready', pid: 1, routes: ['a', 'b', 'c'] }), /服务已就绪（路由 3 条）/);
  // 这一种正是「界面里什么都没有、也没有报错」：必须自己说出它卡在哪一步，
  // 否则人只会看到一片空白，然后去猜是不是自己没重启。
  assert.match(render({ stage: 'apply', pid: 1 }), /只走到 apply/);
  assert.match(render(null), /还没有心跳/);
});

check('设置页：证据不足时不许说「已被改造」，也不许假装「依据：大小比较」', () => {
  const render = (data) => {
    const client = makeClient();
    client.component();
    client.scripted.setStates([{ phase: 'ready', data, error: null }]);
    return JSON.stringify(client.component());
  };
  const base = { ok: true, plugin: { name: 'dsh-up-t', version: '0.1.0' }, time: 't', heartbeat: null };
  // 1) 拿不到大小（宿主这次没读到，或原版备份不在）：必须落「无法判断」，
  //    而且必须说清是哪种拿不到 —— 这正是运行中实例里 asarBytes: 0 踩出来的坑。
  const unavailable = render({
    ...base,
    install: { dir: 'D:\\apps\\harness', version: '44.0.0', asarBytes: null, backupBytes: 121348951, sameSizeAsBackup: null, judgedBy: 'unavailable' },
  });
  assert.match(unavailable, /无法判断/);
  assert.ok(!unavailable.includes('已被改造'), '证据不足时不许下「已被改造」这种结论');
  assert.ok(!unavailable.includes('大小比较'), 'judgedBy 已降级，不许再说依据是大小比较');
  // 2) 三条事实都在（同一个大小、不同的大小、拿不到）：
  assert.match(render({ ...base, install: { dir: 'd', version: 'v', asarBytes: 10, backupBytes: 10, sameSizeAsBackup: true, judgedBy: 'size' } }), /未改造/);
  assert.match(render({ ...base, install: { dir: 'd', version: 'v', asarBytes: 11, backupBytes: 10, sameSizeAsBackup: false, judgedBy: 'size' } }), /已被改造/);
  // 3) 读不到安装目录时，「为什么」必须一起显示；否则人只能猜。
  const none = render({ ...base, install: null, installRejected: [{ dir: 'D:\\apps\\harness', asar: 'D:\\apps\\harness\\resources\\app.asar', why: '0 字节' }] });
  assert.match(none, /读不到安装目录信息/);
  assert.match(none, /0 字节/);
  // 4) 能拿到 status.json 却读不到心跳字段 ⇒ 这是「这一版宿主还没写心跳」，不是「插件没被加载」。
  assert.match(render(base), /没有心跳字段/);
  assert.match(render({ ...base, ok: false }), /还没有心跳/, '拿不到 status.json 时才是「插件没被加载」');
});

check('findInstall：0 字节的 app.asar 是「拿不到」，不是「大小不同」——必须被否掉并记下理由', () => {
  // 来源：运行中的旧版实例报过 install.asarBytes: 0，而磁盘上那份是 121MB，
  // 于是设置页得出「已被改造」。0 字节不是证据，它只是坏掉的一条线索。
  const root = mkdtempSync(path.join(tmpdir(), 'dsht-install-'));
  try {
    const real = path.join(root, 'real');
    const decoy = path.join(root, 'decoy');
    mkdirSync(path.join(decoy, 'resources'), { recursive: true });
    mkdirSync(path.join(real, 'resources'), { recursive: true });
    writeFileSync(path.join(decoy, 'resources', 'app.asar'), '');
    writeFileSync(path.join(real, 'resources', 'app.asar'), 'x'.repeat(64));
    writeFileSync(path.join(real, 'version'), '44.0.0\n');

    const resourcesPath = path.join(decoy, 'resources');
    const execPath = path.join(real, 'DeepSeek Harness.exe');
    // 换成别的路径跑一次，跑完**恢复成原样**（原本没有这个属性就删掉）——
    // 测试不许给进程留下状态，否则后面的断言会在一个被改过的世界里通过。
    const withPaths = (r, e, fn) => {
      const prevR = Object.getOwnPropertyDescriptor(process, 'resourcesPath');
      const prevE = Object.getOwnPropertyDescriptor(process, 'execPath');
      Object.defineProperty(process, 'resourcesPath', { value: r, configurable: true });
      Object.defineProperty(process, 'execPath', { value: e, configurable: true });
      try { return fn(); } finally {
        if (prevR) Object.defineProperty(process, 'resourcesPath', prevR); else delete process.resourcesPath;
        if (prevE) Object.defineProperty(process, 'execPath', prevE); else delete process.execPath;
      }
    };

    // 第一条线索（resourcesPath）指向 0 字节的那份：必须跳过它，落到真正有内容的那份。
    const inst = withPaths(resourcesPath, execPath, () => mod.findInstall());
    assert.equal(inst.installDir, real, '必须跳过 0 字节的候选，去找真正的那一份');
    assert.equal(inst.asarBytes, 64, '带回来的必须是真实大小，而不是 0');
    assert.equal(inst.rejected.length, 1, '被否掉的候选要留下来当解释');
    assert.equal(inst.rejected[0].dir, decoy);
    assert.equal(inst.rejected[0].why, '0 字节');
    assert.ok(inst.rejected[0].asar.endsWith(path.join('resources', 'app.asar')));

    // 两条线索指向同一个根时不许在 rejected 里出现两遍（Electron 下这两条线索常常相同）。
    writeFileSync(path.join(decoy, 'resources', 'app.asar'), 'y'.repeat(8));
    const same = withPaths(
      path.join(decoy, 'resources'),
      path.join(decoy, 'DeepSeek Harness.exe'),
      () => mod.findInstall(),
    );
    assert.equal(same.rejected.length, 0, '候选根要去重，否则同一个根会被否掉两次');
    assert.equal(same.asarBytes, 8);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ── 桌面挂件开关（settings.general.item）────────────────────────────
//
// 这一段守的是一整条**静默链**：出货的 Harness 有挂件窗口、有 IPC、有 window.dshWhaleCharm，
// 却没有任何地方调用它 —— 于是 whale-charm.json 永远是 enabled:false，挂件永不出现、不报错。
// 开关接上之后，最该被钉住的又是它的降级：桥不在（网页版/普通浏览器）、平台没有 handler
// （调用被拒）都必须说清楚，而不是给一个点上去没反应的开关。

const CHARM_ZH = clientExports.__charmCopy('zh-CN');
const CHARM_EN = clientExports.__charmCopy('en');

check('挂件开关：中英文案都在，语言按 zh 前缀切', () => {
  assert.equal(CHARM_ZH.title, '桌面鲸鱼挂件');
  assert.equal(CHARM_EN.title, 'Desktop whale charm');
  assert.match(CHARM_ZH.unavailable, /桌面版/);
  assert.match(CHARM_EN.unavailable, /desktop/);
});

check('挂件开关：桥不在时禁用 + 说明原因（不许给一个点了没反应的开关）', () => {
  const el = clientExports.__charmView({
    copy: CHARM_ZH,
    available: false,
    enabled: false,
    why: null,
    onToggle: () => { throw new Error('禁用的开关不该被调用'); },
  });
  assert.equal(el.props['data-dsh-up-t'], 'charm');
  const buttons = collect(el, 'button');
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].props.role, 'switch');
  assert.equal(buttons[0].props.disabled, true);
  assert.equal(buttons[0].props['aria-checked'], false);
  assert.equal(buttons[0].props['data-available'], 'false');
  assert.match(JSON.stringify(el), /桌面版/);
});

check('挂件开关：可用时是可点的开关，状态由 data-on / aria-checked 表达', () => {
  const on = clientExports.__charmView({ copy: CHARM_ZH, available: true, enabled: true, onToggle: () => {} });
  const off = clientExports.__charmView({ copy: CHARM_ZH, available: true, enabled: false, onToggle: () => {} });
  const bOn = collect(on, 'button')[0];
  const bOff = collect(off, 'button')[0];
  assert.equal(bOn.props['aria-checked'], true);
  assert.equal(bOn.props['data-on'], 'true');
  assert.equal(bOn.props.disabled, false);
  assert.equal(bOff.props['aria-checked'], false);
  assert.equal(bOff.props['data-on'], 'false');
  assert.match(JSON.stringify(on), /已开启/);
  assert.match(JSON.stringify(off), /已关闭/);
});

check('挂件开关：失败时说失败（仍可再点），正在切换时不可连点', () => {
  let clicks = 0;
  const failed = clientExports.__charmView({
    copy: CHARM_ZH,
    available: true,
    enabled: false,
    failed: true,
    onToggle: () => { clicks += 1; },
  });
  assert.match(JSON.stringify(failed), /切换失败/);
  const b = collect(failed, 'button')[0];
  assert.equal(b.props.disabled, false, '失败之后必须还能再试一次');
  b.props.onClick({});
  assert.equal(clicks, 1);

  const busy = clientExports.__charmView({
    copy: CHARM_ZH,
    available: true,
    enabled: false,
    busy: true,
    onToggle: () => { throw new Error('正在切换时不该再发一次请求'); },
  });
  const bb = collect(busy, 'button')[0];
  assert.equal(bb.props.disabled, true);
  bb.props.onClick({});
});

await checkAsync('挂件开关：挂载时读一次状态，并把布尔状态收进来；卸载时撤掉监听', async () => {
  const seen = { state: 0, listeners: [], off: false };
  const bridge = {
    state: () => { seen.state += 1; return Promise.resolve(false); },
    set: () => Promise.resolve(true),
    onChange: (fn) => { seen.listeners.push(fn); return () => { seen.off = true; }; },
  };
  const client = makeClient({ bridge });
  assert.ok(client.charm, '必须注册了挂件那一项');
  const loading = client.charm();
  assert.match(JSON.stringify(loading), /正在读取/, '还没读到状态时要说「正在读取」');
  assert.equal(client.scripted.effects.length, 1, '挂载时必须自己去读一次状态');
  const off = client.scripted.effects[0]();
  assert.equal(typeof off, 'function', 'effect 必须返回清理函数');
  await flush();
  assert.equal(seen.state, 1);
  const ready = client.scripted.setCalls.find((c) => c.next && c.next.phase === 'ready');
  assert.ok(ready, '读到状态后必须落到 ready 态');
  assert.equal(ready.next.enabled, false);
  off();
  assert.equal(seen.off, true, '卸载时不许把监听留在桥里');
});

await checkAsync('挂件开关：onChange 只认布尔值 —— "replay" 是挂件菜单的请求，不是状态', async () => {
  const listeners = [];
  const bridge = {
    state: () => Promise.resolve(false),
    set: () => Promise.resolve(true),
    onChange: (fn) => { listeners.push(fn); return () => {}; },
  };
  const client = makeClient({ bridge });
  client.charm();
  client.scripted.effects[0]();
  await flush();
  client.scripted.reset();
  assert.equal(listeners.length, 1, '必须订阅一次变化');
  // 挂件菜单的「Replay animation」走的正是这条通道。把字符串当状态，
  // 会让开关在挂件其实开着的时候显示成关 —— 这种错不会报错，只会骗人。
  listeners[0]('replay');
  assert.equal(client.scripted.setCalls.length, 0, '字符串不是状态，绝不能翻转开关');
  listeners[0](true);
  assert.equal(client.scripted.setCalls.length, 1);
  assert.equal(client.scripted.setCalls[0].next.enabled, true);
  assert.equal(client.scripted.setCalls[0].next.why, null);
});

await checkAsync('挂件开关：点一下 → 调桥的 set，并用桥的返回值落定（不是自己猜）', async () => {
  const seen = { set: [] };
  const bridge = {
    state: () => Promise.resolve(false),
    set: (value) => { seen.set.push(value); return Promise.resolve(value); },
    onChange: () => () => {},
  };
  const client = makeClient({ bridge });
  client.charm();
  client.scripted.setStates([{ phase: 'ready', enabled: false, why: null, failed: false, busy: false }]);
  const el = client.charm();
  assert.equal(typeof el.type, 'function', 'ready 态渲染的是纯展示组件');
  assert.equal(typeof el.props.onToggle, 'function');
  client.scripted.reset();
  el.props.onToggle();
  assert.deepEqual(seen.set, [true], '关 → 开');
  assert.ok(client.scripted.setCalls.some((c) => c.next && c.next.busy === true), '等待期间要标 busy，免得人连点');
  await flush();
  const done = client.scripted.setCalls[client.scripted.setCalls.length - 1];
  assert.equal(done.next.enabled, true);
  assert.equal(done.next.busy, false);
});

await checkAsync('挂件开关：桥在但调用被拒（非 Windows 平台没有 handler）→ 按「用不了」并带上原因', async () => {
  const bridge = {
    state: () => Promise.reject(new Error('No handler registered for dsh-desktop:charm-state')),
    set: () => Promise.resolve(true),
    onChange: () => () => {},
  };
  const client = makeClient({ bridge });
  client.charm();
  client.scripted.effects[0]();
  await flush(); await flush();
  const call = client.scripted.setCalls.find((c) => c.next && c.next.phase === 'unavailable');
  assert.ok(call, '被拒也是「用不了」，不能一直停在「正在读取」');
  assert.match(call.next.why, /No handler registered/);
});

await checkAsync('挂件开关：切换失败时不许把开关悄悄翻过去', async () => {
  const bridge = {
    state: () => Promise.resolve(false),
    set: () => Promise.reject(new Error('boom')),
    onChange: () => () => {},
  };
  const client = makeClient({ bridge });
  client.charm();
  client.scripted.setStates([{ phase: 'ready', enabled: false, why: null, failed: false, busy: false }]);
  const el = client.charm();
  client.scripted.reset();
  el.props.onToggle();
  await flush();
  const done = client.scripted.setCalls[client.scripted.setCalls.length - 1];
  assert.equal(done.next.failed, true);
  assert.equal(done.next.enabled, false, '失败时开关必须回到原来的位置');
  assert.equal(done.next.busy, false);
  // 界面上只写一句「切换失败，请看控制台」——所以控制台里必须有东西可看。
  assert.ok(
    clientWarnings.some((w) => /切换桌面挂件失败/.test(w) && /boom/.test(w)),
    `切换失败必须留下可查的告警，实际：${JSON.stringify(clientWarnings)}`,
  );
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
// 但「清理」≠「抹掉宿主的证据」：跑测试之前宿主可能已经写了自己的心跳（pid 是宿主的、
// 还活着）—— 那份要在结尾**原样写回**。宿主没写过（文件本来就不存在）才整个 .runtime
// 抹掉，语义与「不给真实环境留状态」一致。
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
  if (!r.ok) console.log(`        ${r.err?.message ?? r.err}`);
}
console.log('');
if (failed.length) {
  console.log(`插件单测失败：${failed.length}/${results.length}`);
  process.exit(1);
}
console.log(`插件单测通过：${results.length}/${results.length} 项`);
