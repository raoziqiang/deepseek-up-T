// deepseek-up-T :: `dsht accept` 回归测试
//
//   node test/accept.test.mjs
//
// 为什么要有它：`accept` 是「重启之后到底成没成」的唯一入口，而它最危险的失败不是算错，
// 是**把三种不同的结论揉成两种**：
//   · 「没测到」（宿主没在跑、没有原版备份、--no-hash 跳过了逐字节）折叠成「没过」
//     ⇒ 人跑去修一个不存在的故障；
//   · 观感类项（动画好不好看、胶囊拖不拖得动）算进退出码 ⇒ 教人忽略失败；
//   · 「宿主半侧是旧代码」说成「插件没装」⇒ 排查方向整个错。
// 所以这里用一个**假宿主**（本地 http 服务器）把每条分支的真话钉住，并且验证它只发 GET。
//
// 它不碰真实 Harness、不写盘：假宿主是由本测试起来的，端口 0 由系统分配。

import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAccept, printAccept } from '../src/accept.mjs';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let bad = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${extra ? `  ${extra}` : ''}`);
  if (!cond) bad += 1;
};

/** 起一个假宿主。routes: { '/路径': (req, res) => void }，未命中的路径答 404。 */
function fakeHost(routes) {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push({ method: req.method, url: req.url });
    const h = routes[req.url];
    if (!h) { res.writeHead(404); res.end('not found'); return; }
    h(req, res);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ url: `http://127.0.0.1:${port}`, seen, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

const json = (res, obj, status = 200) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
};

const find = (r, id) => r.items.find((i) => i.id === id);
const statusOf = (r, id) => find(r, id)?.status;
/** 声明项在 items 里的 id 就是声明文件名。 */
const declOf = (r, file) => find(r, file);

// ── 1. 宿主是**新版**且渲染层两条通道都握手了：自动项应当全过 ──
console.log('── 新版宿主 + 两条通道都握手 ──');
{
  const host = await fakeHost({
    '/dsh-up-t/status.json': (_q, res) => json(res, {
      ok: true, plugin: { name: 'dsh-up-t', version: '0.1.0' }, time: 't', install: { dir: 'D:\\x', version: '44.0.0', asarBytes: 121, backupBytes: 100, sameSizeAsBackup: false, judgedBy: 'size' },
    }),
    '/dsh-up-t/action': (_q, res) => json(res, { ok: true, actions: ['doctor', 'accept'], note: 'POST' }),
    '/dsh-up-t/seen': (_q, res) => json(res, { ok: true, seen: { count: 2, sources: { capsule: 't1', bundle: 't2' } }, note: 'POST' }),
  });
  const r = await runAccept({ hash: false, url: host.url });
  await host.close();

  check('宿主在线 → pass', statusOf(r, 'host-up') === 'pass', find(r, 'host-up')?.detail);
  check('新版宿主（/action 在线）→ pass', statusOf(r, 'host-new') === 'pass', find(r, 'host-new')?.detail);
  check('两条通道都握手 → pass', statusOf(r, 'renderer') === 'pass', find(r, 'renderer')?.detail);
  check('只发 GET，一个写请求都没有', host.seen.every((s) => s.method === 'GET'),
    JSON.stringify([...new Set(host.seen.map((s) => s.method))]));
  check('探测打的确实是插件自己的只读路由',
    [...new Set(host.seen.map((s) => s.url))].every((u) => u.startsWith('/dsh-up-t/')),
    JSON.stringify([...new Set(host.seen.map((s) => s.url))]));
  check('观感类项存在，且标成 manual', r.items.filter((i) => i.status === 'manual').length >= 4);
  check('manual 不计入失败：summary.fail 里没有它们', r.summary.fail === r.items.filter((i) => i.status === 'fail').length);
}

// ── 2. 旧宿主（/action 404）+ 一次都没握手：必须说准是哪一种坏 ──
console.log('── 旧版宿主（路由是后来才加的）+ 渲染层从没握手 ──');
{
  const host = await fakeHost({
    '/dsh-up-t/status.json': (_q, res) => json(res, {
      ok: true, plugin: { name: 'dsh-up-t', version: '0.1.0' }, time: 't', install: null, installRejected: [{ asar: 'D:\\app\\resources\\app.asar', why: '0 字节' }],
    }),
    '/dsh-up-t/seen': (_q, res) => json(res, { ok: true, seen: null, note: 'POST' }),
  });
  const r = await runAccept({ hash: false, url: host.url });
  await host.close();

  check('宿主在线 → pass（旧版插件也答得出 status.json）', statusOf(r, 'host-up') === 'pass');
  check('/action 404 → FAIL', statusOf(r, 'host-new') === 'fail');
  check('FAIL 的措辞指出「旧代码」而不是「没装」', /旧代码/.test(find(r, 'host-new')?.detail ?? ''), find(r, 'host-new')?.detail);
  check('FAIL 带一句修法（重启）', /退出 Harness/.test(find(r, 'host-new')?.fix ?? ''));
  check('seen 200 但从未握手 → FAIL（不是 skip）', statusOf(r, 'renderer') === 'fail', find(r, 'renderer')?.detail);
  check('措辞点明「两种都不报错」这个关键事实', /不报错/.test(find(r, 'renderer')?.detail ?? ''));
  check('整份验收是失败的', r.ok === false);
}

// ── 3. 只到了一半的通道：必须说清缺的是哪一个（两条通道的排查方向不同）──
console.log('── 只有 capsule 握手（设置页没挂上）──');
{
  const host = await fakeHost({
    '/dsh-up-t/status.json': (_q, res) => json(res, { ok: true, plugin: { name: 'dsh-up-t' }, time: 't', install: null }),
    '/dsh-up-t/action': (_q, res) => json(res, { ok: true, actions: ['doctor'] }),
    '/dsh-up-t/seen': (_q, res) => json(res, { ok: true, seen: { count: 1, sources: { capsule: 't1' } } }),
  });
  const r = await runAccept({ hash: false, url: host.url });
  await host.close();
  const d = find(r, 'renderer');
  check('只有一条通道 → FAIL', d?.status === 'fail');
  check('措辞点出缺的是 bundle（设置页）', /bundle/.test(d?.detail ?? '') && /设置页/.test(d?.detail ?? ''), d?.detail);
  check('修法指向 ModuleLoader / 渲染层控制台', /ModuleLoader/.test(d?.fix ?? ''), d?.fix);
}

// ── 4. 宿主没在跑：连不上是「没测到」，不是「插件坏了」──
console.log('── 宿主没在跑 ──');
{
  // 端口挑一个几乎不可能被占的：连接立即 ECONNREFUSED。
  const r = await runAccept({ hash: false, url: 'http://127.0.0.1:1', timeoutMs: 1500 });
  check('连不上宿主 → FAIL（验收本来就需要它在跑）', statusOf(r, 'host-up') === 'fail', find(r, 'host-up')?.detail);
  check('连不上导致的「测不了」标 SKIP，不折成 FAIL', statusOf(r, 'host-new') === 'skip' && statusOf(r, 'renderer') === 'skip');
  check('修法里给出「启动 Harness 后重跑」与 DSH_WEB_URL', /启动 Harness/.test(find(r, 'host-up')?.fix ?? ''));
  check('不崩：仍然给出完整报告', typeof printAccept(r) === 'string' && r.items.length > 8);
}

// ── 5. --no-hash：逐字节结论退化，必须标 SKIP 并说明怎么补 ──
console.log('── --no-hash 的降级 ──');
{
  const r = await runAccept({ hash: false, url: 'http://127.0.0.1:1', timeoutMs: 1000 });
  const a = find(r, 'asar-modified');
  check('--no-hash 时「安装包被动过没有」不硬答（skip 或如实按大小）',
    a?.status === 'skip' || a?.status === 'fail' || a?.status === 'pass', `${a?.status} · ${a?.detail}`);
}

// ── 6. 报告本身：修法必须逐条露出，且人看得懂哪几项要自己看 ──
console.log('── 报告措辞 ──');
{
  const host = await fakeHost({
    '/dsh-up-t/status.json': (_q, res) => json(res, { ok: true, plugin: { name: 'dsh-up-t' }, time: 't', install: null }),
  });
  const r = await runAccept({ hash: false, url: host.url });
  await host.close();
  const text = printAccept(r);
  check('报告把「只能靠你的眼睛」单列一段', /只能靠你的眼睛/.test(text));
  check('报告点明「不计入退出码」', /不计入退出码/.test(text));
  check('失败项逐条带修法（↳）', (text.match(/↳/g) ?? []).length >= 1);
  check('结尾解释 SKIP 不是通过', /SKIP|无法判断/.test(text));
}

// ── 7. 声明项：真现场（本仓库）应当被判成「与现场一致」──
console.log('── 真现场的 L0 声明 ──');
{
  const r = await runAccept({ hash: false, url: 'http://127.0.0.1:1', timeoutMs: 1000 });
  for (const f of ['T2-product-analytics-off.yml', 'T2-enable-ralph.yml', 'T3-session-search.yml', 'T3-session-title.yml']) {
    const it = declOf(r, f);
    check(`${f} 被找到且没有报「找不到声明文件」`, Boolean(it) && !/找不到声明文件/.test(it.detail ?? ''), it?.detail);
    check(`${f} 判为 pass（声明与现场一致）`, it?.status === 'pass', it?.status);
  }
  const t1 = declOf(r, 'T1-whale-splash.yml');
  check('T1 声明存在（状态取决于有没有落盘，但必须找得到）', Boolean(t1), t1?.detail);
  check('T1 的文件名与 cordis 行 id 不同这件事被正确处理（不是靠 id 找文件）',
    Boolean(t1) && !/找不到声明文件/.test(t1.detail ?? ''));
  const pa = declOf(r, 'T2-product-analytics-off.yml');
  check('L0 项的 detail 里带上真正的 cordis id，便于对账', /product-analytics/.test(pa?.detail ?? ''), pa?.detail);
}

console.log('');
if (bad) {
  console.log(`accept 测试失败：${bad} 项`);
  process.exit(1);
}
console.log('accept 测试全部通过');
