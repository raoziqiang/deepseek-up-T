// deepseek-up-T :: dsht accept —— 落盘改完、重启之后，把要验收的东西一条命令问完
//
// 为什么要有它：改造落盘之后要核对的东西分散在四处 —— L3 声明（安装包层）、L0 声明（profile 层）、
// 运行中的宿主（路由到底活着没有）、渲染层（脚本到底跑起来没有）。人手里只有一张从记忆里抄来的
// 清单，而最容易漏的恰恰是**不报错**的那一类：插件装好了却什么都没出现、注入行没被收集、
// 客户端 bundle 在渲染层加载失败 —— 这几种在界面上长得一模一样。
// 把清单变成命令，就有了固定的判据和固定的顺序。
//
// 三条边界（都写进输出，不许含糊）：
// 1. **只读**。不写盘、不改状态、不留快照。验收本身不该改变被验收的东西。
// 2. **只验事实，不验观感**。「鲸鱼动画好不好看」「胶囊拖不拖得动」只有人知道，
//    这类项标成 MANUAL，**且不计入退出码** —— 把需要人眼的项算成失败，等于教人忽略失败。
// 3. **「没测到」与「没过」是两个结论**。宿主没在跑、没有原版备份、`--no-hash` 跳过了逐字节比对，
//    这些一律标 SKIP 并说明原因，绝不折成 FAIL，也绝不折成 PASS。

import http from 'node:http';
import path from 'node:path';
import { readFileSync, statSync } from 'node:fs';
import { resolvePaths } from './paths.mjs';
import { runDoctor } from './doctor.mjs';
import { runUpgradeCheck } from './upgrade.mjs';
import { stagedFacts } from './staged.mjs';

const DEFAULT_URL = 'http://127.0.0.1:19387';

/** 只读探针。任何失败都变成一条事实，绝不抛。 */
function probe(url, route, { timeoutMs = 4000 } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    let req;
    try {
      req = http.get(`${url}${route}`, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('error', (err) => done({ ok: false, error: String(err?.message ?? err) }));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8').slice(0, 64 * 1024);
          let json = null;
          try { json = JSON.parse(body); } catch { /* 不是 JSON 也允许：路由可能答别的 */ }
          done({ ok: true, status: res.statusCode, json, body });
        });
      });
    } catch (err) {
      done({ ok: false, error: String(err?.message ?? err) });
      return;
    }
    req.setTimeout(timeoutMs, () => { req.destroy(new Error(`超时（${timeoutMs}ms）`)); });
    req.on('error', (err) => done({ ok: false, error: String(err?.code ? `${err.code}` : (err?.message ?? err)) }));
  });
}

const item = (id, name, status, detail, fix = null) => ({ id, name, status, detail, fix });

/** 声明项：applied 才算过；drift / absent 各给各的修法。
 *  匹配用**声明文件名**：L0 的 `id` 是 cordis 行 id（`tool-ralph`、`product-analytics`…），
 *  和文件名不是一回事，拿 id 去找会得到「找不到声明文件」这种假失败。 */
function declItem(r, { file, name, fixMissing, layer }) {
  const abs = r.patches.find((d) => d.layer === layer && path.basename(d.file ?? '') === file)
    ?? r.patches.find((d) => d.id === file);
  if (!abs) return item(file, name, 'fail', `找不到声明文件（patches/${file}）`, '声明文件被删了或改名了，检查 patches/。');
  const p = abs;
  if (p.error) return item(file, name, 'fail', p.error, '先修声明文件的语法。');
  if (p.state === 'applied') return item(file, name, 'pass', `${p.layer} 声明 ${file} 与现场一致（${p.id}）`);
  if (p.layer === 'L0' && p.state === 'drift') {
    const why = [
      '声明与现场不一致（有人直接改了 cordis.patch.yml 而没回头改声明）：',
      ...(p.declConfig ?? []).map((l) => `声明 ${l}`),
      ...(p.liveConfig ?? []).map((l) => `现场 ${l}`),
    ].join('\n');
    return item(file, name, 'fail', why, '把 patches/*.yml 的 config 改成与现场一致，或把现场改回声明。');
  }
  if (p.state === 'partial') {
    return item(file, name, 'fail', `安装包里只落了一部分（缺 ${(p.missingInserts ?? []).join(', ') || '若干条目'}）`,
      '重新构建并落盘（Harness 要先完全退出）。');
  }
  if (p.state === 'unknown') {
    return item(file, name, 'skip', '无法判断（没有原版备份可比）', '原版备份 app.asar.whale-backup 不在，无法判断安装包被动过没有。');
  }
  return item(file, name, 'fail', '尚未落盘 —— 不是被升级覆盖，而是从来没做过', fixMissing);
}

/**
 * 验收清单。全部只读；`hash: false` 时逐字节结论退化为「无法判断」（并如实标 SKIP）。
 */
export async function runAccept({ hash = true, url = process.env.DSH_WEB_URL || DEFAULT_URL, timeoutMs = 4000, clientBundle = null, staged = null } = {}) {
  const P = resolvePaths();
  const r = await runUpgradeCheck({ hash });
  const items = [];

  // ── L3：安装包层 ──────────────────────────────────────────────
  items.push(declItem(r, {
    file: 'T1-whale-splash.yml', name: 'T1 鲸鱼启动动画已落盘', layer: 'L3',
    fixMissing: '完全退出 Harness，然后双击 deepseek-up-T\\install-whale.cmd（它自带「Harness 还在跑」守卫）。',
  }));

  // 「安装包被动过没有」是所有 L3 改动的前提：它没变，下面任何 L3 项都不可能生效。
  if (r.pristine === true) {
    items.push(item('asar-modified', 'app.asar 已被改造', 'fail',
      `app.asar 仍是未改造的原版（与 app.asar.whale-backup 逐字节相同）`,
      '任何 L3 改动都没生效。先在 Harness 完全退出后运行 install-whale.cmd，再重启。'));
  } else if (r.pristine === false) {
    // 「原版备份」这一栏必须引用备份自己的字节数。落盘后 `baseline write` 会把基线刷成
    // 改造后的状态，基线里的 asarBytes 就成了「改造后的包」—— 拿它标「原版」会把
    // 121,348,951 B 的备份说成 121,421,984 B。
    let backupBytes = null;
    try { backupBytes = statSync(P.asarBackup).size; } catch { /* 备份不在场就如实打 '?' */ }
    items.push(item('asar-modified', 'app.asar 已被改造', 'pass',
      `与原版备份不同（安装包 ${r.current.asarBytes} B；原版备份 ${backupBytes ?? '?'} B）`));
  } else {
    items.push(item('asar-modified', 'app.asar 已被改造', 'skip',
      hash ? '无法判断（缺少原版备份 app.asar.whale-backup）' : '无法判断（--no-hash 跳过了逐字节比对）',
      hash ? null : '去掉 --no-hash 再跑一次可以逐字节确认。'));
  }

  // ── 你验的这一份，是不是你构建的那一份 ────────────────────────
  // accept 问的是「改完重启之后到底成没成」。如果磁盘上还有一份**比在用的更新**的暂存包，
  // 那这次重启装的就不是你最后构建的那一份 —— 上面那些 L3 项全绿也没用，它们判的是
  // 「声明有没有落」，不是「落的是不是最新的」。这一条与 doctor / upgrade 的取向**刻意不同**：
  // 那两处把 `pending` 当 info（它是常态，落盘要等人退出 Harness），这里是验收，有未落盘的
  // 产物就意味着「验收对象不对」，所以它是 fail。真落盘会把暂存包移走（`install.mjs` 用
  // rename，退回原地复制时也会删），所以落过盘之后这一项不会一直红。
  const sf = staged ?? stagedFacts(P);
  if (sf.status === 'pending') {
    items.push(item('staged-fresh', '这次验收的是最新构建', 'fail',
      `暂存包比在用安装包新（大 ${sf.deltaBytes} 字节）：上面那些项判的是「声明有没有落」，判不了「落的是不是最新的一份」`,
      '完全退出 Harness（托盘 → Quit）→ node vendor/whale/install.mjs --yes（或双击 install-whale.cmd）→ 重启。落盘会把暂存包移走，这一项就不再出现。'));
  } else if (sf.status === 'behind') {
    items.push(item('staged-fresh', '这次验收的是最新构建', 'pass',
      '暂存包比在用的旧 ⇒ 没有「构建了但没落盘」的东西（但那份旧暂存包别拿去落盘，先重新构建）'));
  } else if (sf.status === 'same-size') {
    items.push(item('staged-fresh', '这次验收的是最新构建', 'pass',
      '暂存包与在用安装包大小相同（大小相同不等于逐字节相同；时间戳分不出谁更新时才落到这一态）'));
  } else if (sf.status === 'differs') {
    items.push(item('staged-fresh', '这次验收的是最新构建', 'skip',
      `暂存包与在用安装包大小不同，但没拿到可比的时间戳，判不出谁更新：${sf.why}`,
      '跑 node src/cli.mjs doctor 看「暂存包」那一条，它会给出同样的事实。'));
  } else {
    items.push(item('staged-fresh', '这次验收的是最新构建', 'skip',
      sf.why ?? '没拿到暂存产物的信息',
      null));
  }

  // ── L0：profile 层（升级幸存）──────────────────────────────────
  items.push(declItem(r, {
    file: 'T2-product-analytics-off.yml', name: 'T2 产品埋点已关闭', layer: 'L0',
    fixMissing: '把 patches/T2-product-analytics-off.yml 的条目追加到 profile 的 cordis.patch.yml（见该文件顶部说明）。',
  }));
  items.push(declItem(r, {
    file: 'T2-enable-ralph.yml', name: 'T2 ralph 工具已开启', layer: 'L0',
    fixMissing: '在 profile 的 cordis.patch.yml 里加 `- id: tool-ralph` / `  disabled: false`（不改 config ⇒ 完整继承 base）。',
  }));
  items.push(declItem(r, {
    file: 'T3-session-search.yml', name: 'T3 会话全文搜索已开启', layer: 'L0',
    fixMissing: "在 profile 的 cordis.patch.yml 里把 session-query-sqlite 指向 dshHomePath('session-search.sqlite')。",
  }));
  items.push(declItem(r, {
    file: 'T3-session-title.yml', name: 'T3 会话标题更长更可读', layer: 'L0',
    fixMissing: '在 profile 的 cordis.patch.yml 里覆盖 session-title-llm 的 config（五个字段要写全，config 是整体替换）。',
  }));

  // ── 运行中的宿主：路由活着没有（这是「重启生效了没有」的直接证据）──
  const status = await probe(url, '/dsh-up-t/status.json', { timeoutMs });
  if (!status.ok) {
    items.push(item('host-up', '宿主在跑且插件路由活着', 'fail',
      `连不上 ${url}（${status.error}）`,
      'Harness 没在跑，或者网页端口不是这个。启动 Harness 后重跑；端口不同就设 DSH_WEB_URL 或 --url。'));
  } else if (status.status === 200 && status.json?.plugin?.name === 'dsh-up-t') {
    items.push(item('host-up', '宿主在跑且插件路由活着', 'pass',
      `GET /dsh-up-t/status.json → 200（插件 ${status.json.plugin.name} ${status.json.plugin.version}）`));
  } else {
    items.push(item('host-up', '宿主在跑且插件路由活着', 'fail',
      `GET /dsh-up-t/status.json → ${status.status}`,
      '插件没被这个 profile 加载，或路由被别的东西占了。去看 profile 的 dsh.profile.bundles 有没有 dsh-up-t。'));
  }

  const action = await probe(url, '/dsh-up-t/action', { timeoutMs });
  if (!action.ok) {
    items.push(item('host-new', '宿主半侧是新版（重启已生效）', 'skip',
      `探不到（${action.error}）`, null));
  } else if (action.status === 200 && Array.isArray(action.json?.actions)) {
    items.push(item('host-new', '宿主半侧是新版（重启已生效）', 'pass',
      `操作通道在线，${action.json.actions.length} 个操作：${action.json.actions.join(', ')}`));
  } else if (action.status === 404) {
    items.push(item('host-new', '宿主半侧是新版（重启已生效）', 'fail',
      'GET /dsh-up-t/action → 404：运行中的宿主是**旧代码**（这个路由是后来才加的）',
      '完全退出 Harness 再启动一次。宿主半侧的改动不重启不会生效，而且不报错。'));
  } else {
    items.push(item('host-new', '宿主半侧是新版（重启已生效）', 'fail',
      `GET /dsh-up-t/action → ${action.status}`, '这一条本该答 200 加一个 actions 列表。'));
  }

  // ── 界面里那一行挂件开关：它住在设置页的客户端 bundle 里 ──────────
  // 注意**不能**用 `/dsh-up-t/client.js` 去问：那条路由送的是 `assets/client.js`（左下角胶囊），
  // 而设置页那一页来自 ModuleLoader 加载的 `lib/client.js`，它不走我们的路由。
  // 好在这个 bundle 也是**按 mtime 从磁盘重读**的（模块系统用 mtime 派生 rev），
  // 所以「磁盘上那一份是不是新版」就是要问的事实；剩下的一步（浏览器硬刷新）只有人能做。
  const CHARM_MARKERS = ['settings.general.item', 'whale-charm'];
  const installedClient = path.join(P.profileDir, 'node_modules', 'dsh-up-t', 'lib', 'client.js');
  const sourceClient = path.join(P.projectRoot, 'plugins', 'dsh-up-t', 'lib', 'client.js');
  const candidates = clientBundle ? [clientBundle] : [installedClient, sourceClient];
  let bundleFile = null;
  let bundleText = null;
  for (const f of candidates) {
    try { bundleText = readFileSync(f, 'utf8'); bundleFile = f; break; } catch { /* 试下一个 */ }
  }
  if (bundleText === null) {
    items.push(item('charm-row', '挂件开关那一行已经在客户端 bundle 里', 'skip',
      `读不到 lib/client.js（试过 ${candidates.join('、')}）`,
      '插件没装进这个 profile？装法见 plugins/dsh-up-t/README.md。'));
  } else {
    const missing = CHARM_MARKERS.filter((m) => !bundleText.includes(m));
    if (missing.length === 0) {
      items.push(item('charm-row', '挂件开关那一行已经在客户端 bundle 里', 'pass',
        `${bundleFile} 里有 ${CHARM_MARKERS.join(' / ')}（客户端 bundle 按 mtime 重读 ⇒ 硬刷新即生效）`));
    } else {
      items.push(item('charm-row', '挂件开关那一行已经在客户端 bundle 里', 'fail',
        `${bundleFile} 里没有 ${missing.join(' / ')} —— 磁盘上这一份是旧版`,
        '先确认改的是 plugins/dsh-up-t/lib/client.js；改完硬刷新一次（设置页 bundle 走缓存就会有这种表现）。'));
    }
  }

  // ── 渲染层：脚本到底跑起来没有（这是最后一个静默区）────────────
  const seen = await probe(url, '/dsh-up-t/seen', { timeoutMs });
  if (!seen.ok || seen.status !== 200) {
    items.push(item('renderer', '渲染层已握手（界面里真的出现了）', 'skip',
      seen.ok ? `GET /dsh-up-t/seen → ${seen.status}` : `探不到（${seen.error}）`, null));
  } else {
    const sources = seen.json?.seen?.sources ?? null;
    const via = sources ? Object.keys(sources).sort() : [];
    if (via.includes('bundle') && via.includes('capsule')) {
      items.push(item('renderer', '渲染层已握手（界面里真的出现了）', 'pass',
        `两条通道都到了：${via.join(' + ')}`));
    } else if (via.length) {
      const missing = via.includes('bundle') ? 'capsule' : 'bundle';
      items.push(item('renderer', '渲染层已握手（界面里真的出现了）', 'fail',
        `只有 ${via.join(' + ')} 到了，缺 ${missing}（${missing === 'bundle' ? '设置页' : '左下角胶囊'}没挂上）`,
        missing === 'bundle'
          ? 'ModuleLoader 没加载 lib/client.js：看 Harness 的渲染层控制台有没有报错。'
          : '注入行没被收集（宿主启动时一次性收集，装晚了就得重启）。'));
    } else if (seen.json?.seen) {
      items.push(item('renderer', '渲染层已握手（界面里真的出现了）', 'pass',
        `渲染层握手过（${JSON.stringify(seen.json.seen.sources ?? {})}）`));
    } else {
      items.push(item('renderer', '渲染层已握手（界面里真的出现了）', 'fail',
        '渲染层一次都没握手：注入行没被收集，或客户端脚本在渲染层加载失败 —— 这两种都不报错',
        '先确认重启过了；再打开设置页 → deepseek-up-T 看「心跳」一行说的是哪一步。'));
    }
  }

  // ── 心跳文件：宿主的自我报告（磁盘真相）──────────────────────
  let beat = null;
  try { beat = JSON.parse(readFileSync(P.pluginHeartbeat, 'utf8')); } catch { /* 还没落过 */ }
  if (!beat) {
    items.push(item('heartbeat', '插件写过心跳', 'skip',
      '还没有心跳文件 —— 宿主半侧没加载过这个插件，或者跑的是还没有心跳功能的旧版'));
  } else if (beat.stage === 'ready') {
    items.push(item('heartbeat', '插件写过心跳', 'pass',
      `stage=ready（${(beat.routes ?? []).length} 条路由）pid=${beat.pid}`));
  } else if (beat.stage === 'apply') {
    items.push(item('heartbeat', '插件写过心跳', 'fail',
      `只走到 stage=apply：webServer 依赖没就绪 ⇒ 路由一条都没注册，界面里既不会有胶囊也不会有设置页，而且不报错`,
      '这是最安静的坏法。看 doctor 的「运行时」段，那里会报同一条。'));
  } else {
    items.push(item('heartbeat', '插件写过心跳', 'skip',
      `心跳没有 stage 字段（旧版本写的）：${JSON.stringify(Object.keys(beat))}`));
  }

  // ── 体检：整体不变量 ─────────────────────────────────────────
  const doc = await runDoctor({ hash: false });
  if (doc.summary.error === 0) {
    items.push(item('doctor', '体检没有错误', 'pass',
      `${doc.checks.length} 项检查，0 错误 / ${doc.summary.warn} 警告`));
  } else {
    const bad = doc.checks.filter((c) => c.level === 'error').slice(0, 3);
    items.push(item('doctor', '体检没有错误', 'fail',
      bad.map((c) => `${c.name}：${c.detail ?? ''}`).join('\n'),
      '跑 `node src/cli.mjs doctor` 看完整报告。'));
  }

  // ── 只能靠人眼的几项（不计入退出码）──────────────────────────
  items.push(item('manual-splash', '等一下：启动时的鲸鱼动画', 'manual',
    '看一眼启动画面有没有鲸鱼动画 —— 这是「好不好看」，命令验不了。'));
  items.push(item('manual-capsule', '等一下：左下角胶囊能拖', 'manual',
    '按住左下角胶囊拖一下（位置存在 localStorage，右键可隐藏）。'));
  items.push(item('manual-settings', '等一下：设置里多出「deepseek-up-T」一整页', 'manual',
    '设置 → 左侧应多出一项 deepseek-up-T：里面有事实行、心跳行、以及一排操作按钮。'));
  items.push(item('manual-charm', '等一下：设置 →「通用」里的挂件开关能开', 'manual',
    '设置 →「通用」里那一行「桌面鲸鱼挂件」：打开后桌面上出现小鲸鱼（可拖动、右键有菜单），关掉即消失。'));
  items.push(item('manual-search', '等一下：会话全文搜索真的能搜到历史正文', 'manual',
    '搜一个只出现在历史正文里的词（例如 resolveBundleDir），看有没有命中。'));
  items.push(item('manual-ralph', '等一下：工具目录里有 ralph', 'manual',
    '在会话里问一下可用工具，或看工具目录里有没有 ralph（长任务用全新子 agent 接力）。'));
  items.push(item('manual-titles', '等一下：会话标题更长、更能区分', 'manual',
    '开一个新会话说一句长话，看标题是不是比原来更容易区分。'));

  const summary = { pass: 0, fail: 0, skip: 0, manual: 0 };
  for (const it of items) summary[it.status] += 1;
  return {
    ok: summary.fail === 0,
    url,
    profile: r.current.profile,
    installDir: r.current.installDir,
    pluginHeartbeat: P.pluginHeartbeat,
    items,
    summary,
  };
}

const MARK = { pass: 'OK  ', fail: 'FAIL', skip: 'SKIP', manual: '??  ' };

/** 按显示宽度补空格：中文按 2 格算，否则列会歪。 */
function padLabel(s, n) {
  const w = [...String(s)].reduce((acc, ch) => acc + (ch.charCodeAt(0) > 0x2e80 ? 2 : 1), 0);
  return String(s) + ' '.repeat(Math.max(0, n - w));
}

export function printAccept(r) {
  const out = [];
  out.push(`deepseek-up-T · 重启后验收   profile=${r.profile}`);
  out.push(`  安装目录  ${r.installDir}`);
  out.push(`  探针      ${r.url}（DSH_WEB_URL，可用 --url 覆盖）`);
  out.push('');
  out.push('── 自动判定 ──');
  const auto = r.items.filter((i) => i.status !== 'manual');
  for (const it of auto) {
    out.push(`  ${MARK[it.status]} ${padLabel(it.name, 32)} ${(it.detail ?? '').split('\n')[0]}`);
    for (const line of (it.detail ?? '').split('\n').slice(1)) out.push(`       ${line}`);
    if (it.status !== 'pass' && it.fix) out.push(`       ↳ ${it.fix}`);
  }
  out.push('');
  out.push('── 这几项只能靠你的眼睛（不计入退出码）──');
  for (const it of r.items.filter((i) => i.status === 'manual')) {
    out.push(`  ??   ${padLabel(it.name.replace(/^等一下：/, ''), 34)} ${it.detail ?? ''}`);
  }
  out.push('');
  const s = r.summary;
  out.push(`通过 ${s.pass} 项，失败 ${s.fail} 项，无法判断 ${s.skip} 项，需要人看 ${s.manual} 项。`);
  out.push(s.fail
    ? '有失败项。上面每一条失败都带一句修法；「无法判断」不是失败，是这次没拿到证据。'
    : (s.skip ? '自动项全过。带 SKIP 的那几项不是通过，是这次没拿到证据 —— 按它给的提示补一次。' : '自动项全过。'));
  return out.join('\n');
}

export { DEFAULT_URL };
