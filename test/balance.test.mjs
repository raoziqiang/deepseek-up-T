// deepseek-up-T :: DeepSeek 官方余额（plugins/dsh-up-t/lib/balance.js + 宿主路由 + 悬浮窗脚本）的离线单测
//
// 不打真接口：fetch 全部注入假的。钉住：
//   ① 密钥只从 DEEPSEEK_API_KEY 环境变量或 $DSH_HOME/.credentials.yaml 的 refs 段读，
//      而且**任何返回给渲染层的结论里都没有密钥字节**；
//   ② 官方返回体（金额是字符串）解析对：优先 CNY、偏低阈值、is_available=false；
//   ③ 401/429/超时/断网/格式不对 —— 都变成人话 + code，绝不抛到路由外面；
//   ④ 缓存：5 分钟内不重复打接口；并发只飞一个请求；手动刷新 10 秒内只认一次；
//   ⑤ 路由 `/dsh-up-t/balance.json` 真的回 JSON；悬浮窗随 client.js 一起送出；
//   ⑥ 悬浮窗脚本是经典脚本、走 CSSOM 上样式、只从宿主路由取数。
//
//   node test/balance.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN = path.resolve(HERE, '..', 'plugins', 'dsh-up-t');
const B = await import(pathToFileURL(path.join(PLUGIN, 'lib', 'balance.js')).href);

const results = [];
async function check(name, fn) {
  try { await fn(); results.push({ name, ok: true }); } catch (err) { results.push({ name, ok: false, err }); }
}

const KEY = 'sk-test-0123456789abcdef0123456789abcdef';
const OFFICIAL = {
  is_available: true,
  balance_infos: [{ currency: 'CNY', total_balance: '110.00', granted_balance: '10.00', topped_up_balance: '100.00' }],
};
const respond = (status, body) => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
});
const noFile = () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); };

// ── ① 密钥 ──────────────────────────────────────────────────────

await check('密钥：环境变量优先，其次 .credentials.yaml 的 refs 段；都没有 → null', () => {
  assert.deepEqual(B.resolveKey({ env: { DEEPSEEK_API_KEY: ` ${KEY} ` }, readFile: noFile }), { key: KEY, source: 'env' });
  const yaml = `version: 1\nrefs:\n  OPENCODE_GO_API_KEY: x\n  DEEPSEEK_API_KEY: "${KEY}"\nother:\n  DEEPSEEK_API_KEY: wrong\n`;
  let readPath = null;
  const r = B.resolveKey({ env: { DSH_HOME: '/h' }, readFile: (p) => { readPath = p; return yaml; } });
  assert.deepEqual(r, { key: KEY, source: 'credentials' });
  assert.equal(readPath, path.join('/h', '.credentials.yaml'));
  assert.deepEqual(B.resolveKey({ env: {}, readFile: noFile }), { key: null, source: null });
});

await check('凭据文件：只认 refs 段里两空格缩进的那一行（别的段同名键不算）', () => {
  assert.equal(B.keyFromCredentials('other:\n  DEEPSEEK_API_KEY: nope\n'), null);
  assert.equal(B.keyFromCredentials('refs:\n  DEEPSEEK_API_KEY:\n'), null);
  assert.equal(B.keyFromCredentials("refs:\r\n  DEEPSEEK_API_KEY: 'abc'\r\n"), 'abc');
  assert.equal(B.keyFromCredentials(null), null);
});

await check('请求带 Bearer 头、打的是官方地址；成功结论里没有任何密钥字节', async () => {
  let seen = null;
  const fetchImpl = async (url, init) => { seen = { url, init }; return respond(200, OFFICIAL); };
  const svc = B.createBalanceService({ env: { DEEPSEEK_API_KEY: KEY }, fetchImpl, readFile: noFile });
  const out = await svc.get();
  assert.equal(seen.url, 'https://api.deepseek.com/user/balance');
  assert.equal(seen.init.method, 'GET');
  assert.equal(seen.init.headers.Authorization, `Bearer ${KEY}`);
  assert.equal(out.ok, true);
  assert.equal(out.keySource, 'env');
  assert.ok(!JSON.stringify(out).includes(KEY), '结论里出现了密钥');
  assert.ok(!JSON.stringify(out).includes(KEY.slice(3, 15)), '结论里出现了密钥片段');
});

await check('失败结论里同样没有密钥（错误信息不回显请求头）', async () => {
  for (const status of [401, 403, 429, 500]) {
    const svc = B.createBalanceService({ env: { DEEPSEEK_API_KEY: KEY }, fetchImpl: async () => respond(status, {}), readFile: noFile });
    const out = await svc.get();
    assert.equal(out.ok, false);
    assert.ok(!JSON.stringify(out).includes(KEY));
  }
});

// ── ② 解析 ──────────────────────────────────────────────────────

await check('解析官方返回体：字符串金额转数字，优先 CNY，带阈值与是否偏低', () => {
  const r = B.parseBalance({
    is_available: true,
    balance_infos: [
      { currency: 'USD', total_balance: '3.00', granted_balance: '0', topped_up_balance: '3.00' },
      { currency: 'CNY', total_balance: '8.50', granted_balance: '0.50', topped_up_balance: '8.00' },
    ],
  }, {});
  assert.equal(r.currency, 'CNY');
  assert.equal(r.total, 8.5);
  assert.equal(r.granted, 0.5);
  assert.equal(r.toppedUp, 8);
  assert.equal(r.low, 10);
  assert.equal(r.isLow, true);
  assert.equal(r.available, true);
  assert.equal(r.others.length, 1);
  assert.equal(r.others[0].currency, 'USD');
});

await check('只有 USD 时用 USD 及其默认阈值；DSH_UP_T_BALANCE_LOW 可覆盖阈值', () => {
  const usd = { is_available: true, balance_infos: [{ currency: 'USD', total_balance: '2.00', granted_balance: '0', topped_up_balance: '2.00' }] };
  assert.equal(B.parseBalance(usd, {}).isLow, false);
  assert.equal(B.parseBalance(usd, {}).low, 1.5);
  const r = B.parseBalance(OFFICIAL, { DSH_UP_T_BALANCE_LOW: '200' });
  assert.equal(r.low, 200);
  assert.equal(r.isLow, true);
  assert.equal(B.parseBalance(OFFICIAL, { DSH_UP_T_BALANCE_LOW: 'abc' }).low, 10, '非数字阈值退回默认');
});

await check('is_available=false 照实报出（余额不足）', () => {
  const r = B.parseBalance({ ...OFFICIAL, is_available: false }, {});
  assert.equal(r.available, false);
});

await check('格式不认识 → 抛错，不编数', () => {
  for (const bad of [null, {}, { balance_infos: [] }, { balance_infos: [{ currency: 'CNY', total_balance: 'abc' }] }]) {
    assert.throws(() => B.parseBalance(bad, {}));
  }
});

// ── ③ 错误映射 ──────────────────────────────────────────────────

await check('401/403 → auth，429 → rate，500 → http，非 JSON → format，断网 → network，超时 → network', async () => {
  const cases = [
    [async () => respond(401, {}), 'auth', /API Key 无效/],
    [async () => respond(403, {}), 'auth', /API Key 无效/],
    [async () => respond(429, {}), 'rate', /太频繁/],
    [async () => respond(500, {}), 'http', /HTTP 500/],
    [async () => ({ status: 200, ok: true, json: async () => { throw new SyntaxError('x'); } }), 'format', /不是 JSON/],
    [async () => respond(200, { what: 1 }), 'format', /格式/],
    [async () => { throw new TypeError('fetch failed'); }, 'network', /连不上/],
    [async () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }); }, 'network', /超时/],
  ];
  for (const [fetchImpl, code, re] of cases) {
    const svc = B.createBalanceService({ env: { DEEPSEEK_API_KEY: KEY }, fetchImpl, readFile: noFile });
    const out = await svc.get();
    assert.equal(out.ok, false);
    assert.equal(out.code, code, `期望 ${code}，实际 ${out.code}：${out.error}`);
    assert.match(out.error, re);
  }
});

await check('真的会超时：挂住的请求在 timeoutMs 后被中止', async () => {
  const fetchImpl = (url, init) => new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });
  const t0 = Date.now();
  await assert.rejects(B.fetchBalance(KEY, { fetchImpl, timeoutMs: 50, env: {} }), /超时/);
  assert.ok(Date.now() - t0 < 2000);
});

await check('没有密钥 → no-key，且根本不发请求', async () => {
  let calls = 0;
  const svc = B.createBalanceService({ env: {}, fetchImpl: async () => { calls += 1; return respond(200, OFFICIAL); }, readFile: noFile });
  const out = await svc.get();
  assert.equal(out.code, 'no-key');
  assert.match(out.error, /DEEPSEEK_API_KEY/);
  assert.equal(calls, 0);
});

// ── ④ 缓存与限流 ────────────────────────────────────────────────

await check('缓存：5 分钟内不重打；过期后重打；失败只缓存 1 分钟', async () => {
  let t = 0;
  let calls = 0;
  let fail = false;
  const fetchImpl = async () => { calls += 1; return fail ? respond(500, {}) : respond(200, OFFICIAL); };
  const svc = B.createBalanceService({ env: { DEEPSEEK_API_KEY: KEY }, fetchImpl, readFile: noFile, now: () => t });
  await svc.get();
  t = B.TTL_MS - 1;
  const c = await svc.get();
  assert.equal(calls, 1);
  assert.equal(c.cached, true);
  t = B.TTL_MS + 1;
  fail = true;
  await svc.get();
  assert.equal(calls, 2);
  t += B.ERROR_TTL_MS - 1;
  await svc.get();
  assert.equal(calls, 2, '失败结果在 1 分钟内也该复用');
  t += 2;
  await svc.get();
  assert.equal(calls, 3);
});

await check('并发：同时来 5 个请求只打一次接口', async () => {
  let calls = 0;
  let release;
  const gate = new Promise((r) => { release = r; });
  const fetchImpl = async () => { calls += 1; await gate; return respond(200, OFFICIAL); };
  const svc = B.createBalanceService({ env: { DEEPSEEK_API_KEY: KEY }, fetchImpl, readFile: noFile });
  const all = Promise.all([1, 2, 3, 4, 5].map(() => svc.get()));
  release();
  const outs = await all;
  assert.equal(calls, 1);
  assert.ok(outs.every((o) => o.ok && o.total === 110));
});

await check('手动刷新：10 秒内的 force 不算数，之后才真的重打', async () => {
  let t = 0;
  let calls = 0;
  const svc = B.createBalanceService({
    env: { DEEPSEEK_API_KEY: KEY },
    fetchImpl: async () => { calls += 1; return respond(200, OFFICIAL); },
    readFile: noFile,
    now: () => t,
  });
  await svc.get();
  t = B.MIN_REFRESH_MS - 1;
  await svc.get({ force: true });
  assert.equal(calls, 1);
  t = B.MIN_REFRESH_MS;
  await svc.get({ force: true });
  assert.equal(calls, 2);
});

// ── ⑤ 宿主路由 ──────────────────────────────────────────────────

await check('插件注册了 balance.json 路由；client.js 路由送出的是「胶囊 + 悬浮窗」两段', async () => {
  const mod = await import(pathToFileURL(path.join(PLUGIN, 'lib', 'index.js')).href);
  const routes = [];
  const root = {
    on() { return () => {}; },
    effect() { return () => {}; },
    inject(deps, cb) {
      cb({
        webServer: { register(r) { routes.push(r); return () => {}; }, tapIndex() { return () => {}; } },
        effect() {},
      });
    },
  };
  // apply 会写心跳与拉起模块宿主；这里只关心路由表。心跳文件在 .runtime/（不入库），测试后删掉。
  const runtime = path.join(PLUGIN, '.runtime');
  const hadRuntime = fs.existsSync(runtime);
  try {
    mod.default.apply(root);
  } finally {
    if (!hadRuntime) fs.rmSync(runtime, { recursive: true, force: true });
  }
  const byPath = Object.fromEntries(routes.map((r) => [r.path, r]));
  assert.ok(byPath['/dsh-up-t/balance.json'], '没有 balance.json 路由');
  assert.equal(byPath['/dsh-up-t/balance.js'], undefined, '悬浮窗不该再单独走一条路由');

  const res = { status: 0, headers: null, body: null, writeHead(s, h) { this.status = s; this.headers = h; }, end(b) { this.body = b; } };
  byPath['/dsh-up-t/client.js'].handler({ url: '/dsh-up-t/client.js' }, res);
  assert.equal(res.status, 200);
  assert.match(res.headers['Content-Type'], /javascript/);
  const body = String(res.body);
  const capsule = fs.readFileSync(path.join(PLUGIN, 'assets', 'client.js'), 'utf8');
  const panel = fs.readFileSync(path.join(PLUGIN, 'assets', 'balance.js'), 'utf8');
  assert.ok(body.startsWith(capsule), '前半段应是胶囊原文');
  assert.ok(body.endsWith(panel), '后半段应是悬浮窗原文');
  new vm.Script(body, { filename: 'client-bundle.js' }); // 拼起来仍是合法的经典脚本

  // balance.json：本机没有密钥时也要回一份 JSON 结论（no-key），而不是 500。
  const prev = process.env.DEEPSEEK_API_KEY;
  const prevHome = process.env.DSH_HOME;
  delete process.env.DEEPSEEK_API_KEY;
  process.env.DSH_HOME = path.join(PLUGIN, '__no_such_home__');
  try {
    const jres = { status: 0, headers: null, body: null, writeHead(s, h) { this.status = s; this.headers = h; }, end(b) { this.body = b; } };
    byPath['/dsh-up-t/balance.json'].handler({ url: '/dsh-up-t/balance.json' }, jres);
    for (let i = 0; i < 50 && jres.body === null; i += 1) await new Promise((r) => setTimeout(r, 10));
    assert.equal(jres.status, 200);
    assert.equal(jres.headers['Cache-Control'], 'no-store');
    const out = JSON.parse(String(jres.body));
    assert.equal(out.ok, false);
    assert.equal(out.code, 'no-key');
  } finally {
    if (prev === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = prev;
    if (prevHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = prevHome;
  }
});

// ── ⑥ 悬浮窗脚本 ────────────────────────────────────────────────

await check('悬浮窗脚本：经典脚本、只从宿主路由取数、样式走 CSSOM（不怕主窗口 CSP）', () => {
  const src = fs.readFileSync(path.join(PLUGIN, 'assets', 'balance.js'), 'utf8');
  new vm.Script(src, { filename: 'balance.js' });
  assert.doesNotMatch(src, /^\s*(import|export)\s/m);
  assert.match(src, /'\/dsh-up-t\/balance\.json'/);
  assert.doesNotMatch(src, /api\.deepseek\.com/, '渲染层不该直连官方接口（那需要密钥）');
  assert.doesNotMatch(src, /DEEPSEEK_API_KEY'\s*\)|Authorization/, '渲染层不该碰密钥');
  assert.match(src, /adoptedStyleSheets/);
});

// ── 汇总 ────────────────────────────────────────────────────────

const failed = results.filter((r) => !r.ok);
for (const r of results) {
  console.log(`${r.ok ? '  ok  ' : ' FAIL '} ${r.name}`);
  if (!r.ok) console.log(`        ${r.err?.stack ?? r.err}`);
}
console.log('');
if (failed.length) {
  console.log(`余额单测失败：${failed.length}/${results.length}`);
  process.exit(1);
}
console.log(`余额单测通过：${results.length}/${results.length} 项`);
process.exit(0);
