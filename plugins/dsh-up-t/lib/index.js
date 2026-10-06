// deepseek-up-T :: dsh-up-t —— 把「改造状态」挂到 Web 界面上
//
// 这是 deepseek-up-T 的第一个自建 DSH 插件，也是 tracks/T4-webgui 这条线的样板。
// 它只做一件小事：在界面左下角放一个小徽标，显示 Harness 版本与安装包是否被改造过，
// 点开有细节。之所以从这件小事开始，是因为它的价值不在于徽标本身，而在于它证明了
// **一条升级幸存的 UI 扩展通道确实可用**——徽标能出现，就说明链路通了。
//
// 层：L1（profile 插件层，`$DSH_HOME/profiles/<p>/node_modules/`）。
//     升级 Harness 不会碰它，所以它必须在升级后继续工作。
//
// 为什么注入行必须这么写（照抄 dsh-whale-widget 被 issue #152/#153/#154 打磨过的做法）
// -------------------------------------------------------------------------------
// 1) 桌面壳（Electron）的 index.html 是从安装包静态 dist 直出（`dsh-app://app/`），
//    不经过宿主的 renderIndex()，所以 `ctx.webServer.tapIndex()` 在桌面端**永远不生效**。
//    桌面端唯一的注入通道是 `webserver/index-inject` 的结构化行。
// 2) 那张注入表由宿主在**启动时一次性收集**，没有刷新路径。由此推出两条硬约束：
//    - 行必须在 apply() 一开头就注册，不能等任何服务就绪。所以**绝不能**把 `webServer`
//      写进对象级 `inject: [...]`——那会把整个 apply() 推迟到服务就绪之后，行就赶不上
//      那次收集，结果是插件「装好了但什么都不出现」，且不报任何错。
//    - 行不能用 `script-src` 类型：渲染层对它 `await loadScript(src)`，一旦 404 就会
//      reject 掉 `__DSH_BOOT_READY__`，**整个应用起不来**（issue #154 的致命启动错误）。
//      而一次性收集意味着插件被关掉后表里那行仍在、路由已注销 ⇒ 404 是必然会发生的。
//    所以推一条内联 `script` 行（渲染层对它只做 createElement + textContent + append，
//    没有 await，不可能失败），由它自己建 `<script src=…>` 并吞掉 `onerror`。
//    最坏结果只是徽标不出现，绝不会拖垮启动。

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * 自己的包目录，**解析成真实路径**。
 *
 * 为什么必须 realpath：插件是以 junction 的形式装进 profile 的
 * （`$DSH_HOME\profiles\<p>\node_modules\dsh-up-t` → 本项目目录）。
 * 一旦宿主给我们的是 junction 那条路径，往上走两层得到的就不是项目根，
 * 而是 `...\node_modules` —— 于是心跳会写错地方、操作按钮也会找不到 `src/cli.mjs`，
 * 而且**两种情况都不报错**（只是「文件不在」）。
 */
function realdir(p) {
  try { return fs.realpathSync.native(p); } catch { return p; }
}
const PACKAGE_ROOT = realdir(path.resolve(HERE, '..'));

/** 客户端脚本的公开路径。注入行与路由必须用同一个常量，否则永远不会一致。 */
const CLIENT_PATH = '/dsh-up-t/client.js';
const STATUS_PATH = '/dsh-up-t/status.json';
const ACTION_PATH = '/dsh-up-t/action';
/**
 * 自定义请求头。跨源 `<form>`/`fetch` 不经过预检就带不上自定义头，而我们从不下发
 * CORS 允许头 —— 所以这一个字段就把「别的网页悄悄让本机跑命令」挡在外面。
 */
const ACTION_HEADER = 'x-dsh-up-t';

const CLIENT_FILE = path.join(PACKAGE_ROOT, 'assets', 'client.js');

/**
 * 心跳文件：`apply()` 一被执行就落一枚，内容是「谁、什么时候、在哪个进程里加载了我」。
 *
 * 为什么需要它：插件装好之后，「到底加载成功了没有」原本只能靠**肉眼看界面**——
 * 徽标没出现可能是没加载、可能是加载了但注入行没进表、也可能是客户端脚本 404（而那条路径
 * 被刻意设计成**静默失败**，就为了不拖垮启动）。这样一旦出问题，你无法区分这几种情况。
 * 落一枚带 pid 与时间戳的文件，就把「加载了吗」变成一条可核对的事实：
 * `dsht doctor` 读这个文件 —— 文件在、pid 活着、时间戳在本次 Harness 启动之后 ⇒ 确实加载了。
 *
 * 写成幂等的（每次 apply 覆盖），并且**绝不抛异常**：诊断设施不能成为新的故障点。
 */
const RUNTIME_DIR = path.join(PACKAGE_ROOT, '.runtime');
const HEARTBEAT_FILE = path.join(RUNTIME_DIR, 'heartbeat.json');
/** 最近一次心跳写的返回值。写失败不该静默 —— 但也不该抛异常，所以留在这里给状态路由。 */
let lastHeartbeatResult = null;

/**
 * 本次生命周期走过的那几步。
 *
 * 心跳原本只有一枚，只能回答「加载了吗」。而**「加载了」和「能用」是两件事**：插件完全可能
 * `apply()` 跑完、注入行也进了表，却在等 `webServer` 时就再没有下文 —— 那正是「界面里既没有
 * 胶囊也没有设置页」最安静的坏法（没有任何报错，只是什么都没发生）。多记一步 `ready`，
 * 这两种情况就分开了：`apply` 之后没有 `ready` = 加载了、依赖没就绪。
 */
let heartbeatTrail = [];

export function writeHeartbeat(stage = 'apply', extra = {}) {
  const pkg = readOwnPackage();
  const inst = findInstall();
  const now = new Date().toISOString();

  // 同一个进程里 apply 可能再来一次（插件被重新加载）。那时的旧 trail 属于上一次生命周期，
  // 留下来会把「这一次走到哪一步」说成「上一次走到哪一步」。
  if (stage === 'apply') heartbeatTrail = [];
  const last = heartbeatTrail[heartbeatTrail.length - 1];
  if (last && last.stage === stage) last.at = now;
  else heartbeatTrail.push({ stage, at: now });

  const payload = {
    plugin: pkg.name,
    version: pkg.version,
    // `stage` 是给机器看的当前结论；`trail` 是给人看的路径（出问题时最想知道的就是它在哪一步停的）。
    stage,
    at: now,
    loadedAt: heartbeatTrail[0].at,
    trail: heartbeatTrail.map((s) => ({ ...s })),
    pid: process.pid,
    execPath: process.execPath ?? null,
    electron: process.versions?.electron ?? null,
    node: process.versions?.node ?? null,
    installDir: inst?.installDir ?? null,
    clientPath: CLIENT_PATH,
    statusPath: STATUS_PATH,
    actionPath: ACTION_PATH,
    ...extra,
  };
  try {
    fs.mkdirSync(RUNTIME_DIR, { recursive: true });
    fs.writeFileSync(HEARTBEAT_FILE, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    lastHeartbeatResult = { ok: true, file: HEARTBEAT_FILE, payload };
  } catch (err) {
    lastHeartbeatResult = { ok: false, file: HEARTBEAT_FILE, error: String(err?.message ?? err) };
  }
  return lastHeartbeatResult;
}

export const heartbeatPath = HEARTBEAT_FILE;

function readOwnPackage() {
  try {
    return JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8'));
  } catch {
    return { name: 'dsh-up-t', version: '0.0.0' };
  }
}

/**
 * 按 mtime 缓存读客户端脚本：改完客户端代码**硬刷新页面即生效**，不用重启 DSH。
 * 这让「改 UI」的迭代周期从「重启 Harness」降到「F5」，是走 L1 而不是 L3 的主要好处之一。
 */
function makeMtimeReader(file) {
  let cache = null;
  return () => {
    try {
      const st = fs.statSync(file);
      if (cache && cache.mtimeMs === st.mtimeMs) return cache.text;
      const text = fs.readFileSync(file, 'utf8');
      cache = { text, mtimeMs: st.mtimeMs };
      return text;
    } catch {
      return cache ? cache.text : null;
    }
  };
}

const readClientJs = makeMtimeReader(CLIENT_FILE);

/**
 * 桌面端注入行：一段**内联**脚本，自己建 `<script src>` 并吞掉 onerror。
 * 幂等由 `window.__DSH_UP_T_LOADED__` 保证（注入表可能被重复应用）。
 */
const INJECT_ROW_TEXT =
  '(function(){try{var d=document.body||document.head||document.documentElement;if(!d)return;'
  + 'if(window.__DSH_UP_T_LOADED__)return;window.__DSH_UP_T_LOADED__=true;'
  + `var s=document.createElement("script");s.src="${CLIENT_PATH}";`
  + 's.onerror=function(){};d.appendChild(s)}catch(e){}})()';

/** 找 Harness 安装目录。宿主进程可能是 Electron 也可能不是，两条线索都试。 */
function findInstall() {
  const roots = [];
  if (process.resourcesPath) roots.push(path.dirname(process.resourcesPath));
  if (process.execPath) roots.push(path.dirname(process.execPath));
  for (const root of roots) {
    const asar = path.join(root, 'resources', 'app.asar');
    if (fs.existsSync(asar)) {
      return {
        installDir: root,
        asar,
        backup: `${asar}.whale-backup`,
        versionFile: path.join(root, 'version'),
      };
    }
  }
  return null;
}

function sizeOrNull(file) {
  try { return fs.statSync(file).size; } catch { return null; }
}

/**
 * 状态事实。刻意只用 stat 级别的成本：
 * 121MB 的安装包不做 sha256（那是 `dsht upgrade` 的活），这里只比大小。
 * 因此结论的措辞必须诚实——是「大小相同」，不是「逐字节相同」。
 */
function collectStatus() {
  const pkg = readOwnPackage();
  const inst = findInstall();
  const out = {
    ok: true,
    plugin: { name: pkg.name, version: pkg.version },
    time: new Date().toISOString(),
    install: null,
    // 心跳是**磁盘真相**（不是内存里的变量）：读文件，读不到就是 null。
    heartbeat: null,
    heartbeatFile: HEARTBEAT_FILE,
    heartbeatWriteError: lastHeartbeatResult && !lastHeartbeatResult.ok ? lastHeartbeatResult.error : null,
  };
  try { out.heartbeat = JSON.parse(fs.readFileSync(HEARTBEAT_FILE, 'utf8')); } catch { /* 还没落过 */ }
  if (!inst) return out;

  const asarBytes = sizeOrNull(inst.asar);
  const backupBytes = sizeOrNull(inst.backup);
  let version = null;
  try { version = fs.readFileSync(inst.versionFile, 'utf8').trim(); } catch { /* 没有就算了 */ }

  out.install = {
    dir: inst.installDir,
    version,
    asarBytes,
    backupBytes,
    // 三态：true 同大小 / false 大小不同 / null 没有原版备份可比
    sameSizeAsBackup: (asarBytes !== null && backupBytes !== null) ? asarBytes === backupBytes : null,
    judgedBy: 'size',
  };
  return out;
}

// ─────────────────────────── 操作：把项目里最常跑的命令挂到界面上 ───────────────────────────
//
// 这一段存在的理由：`dsht` 的日常工作流是「体检 → 留快照 → 改 → 预检 → 复验 → 收尾」，
// 而这几步全都要离开界面去开终端。设置页已经能显示状态了，那就顺手把命令也放上来。
//
// 三条设计约束：
// 1. **白名单，不接受任意命令**。每个操作在表里写死 argv 的形态；用户输入只能填进
//    已经被约好的那一个占位（快照备注），并且**永不经过 shell**（`spawn` 数组形式），
//    所以不存在拼接注入。
// 2. **只允许本机界面触发**（自定义头 + POST，见 ACTION_HEADER）。
// 3. **一次只跑一个**。`precheck` 会拉起一个 Electron-as-Node 进程，两个并发既慢又容易
//    互相踩探针家目录，所以调用串成一条链。

/** 找到项目根：从插件目录往上找带 `src/cli.mjs` 且包名对得上的那一层。 */
export function findProjectRoot() {
  let dir = PACKAGE_ROOT;
  for (let i = 0; i < 5; i += 1) {
    if (fs.existsSync(path.join(dir, 'src', 'cli.mjs'))) {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
        if (pkg.name === 'deepseek-up-t' || pkg.bin?.dsht) return dir;
      } catch { /* 不是项目根，继续往上 */ }
    }
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

/** 快照备注：单行、去首尾空白、封顶，避免把奇怪的东西写进快照 id。 */
function cleanLabel(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
}

/**
 * 操作表。`argv` 只返回**参数**，`cli.mjs` 的路径由执行器补。
 * `writes` 标记会不会改动磁盘 —— 界面据此决定要不要二次确认。
 */
export const ACTIONS = {
  doctor: {
    label: '体检',
    hint: '读组合层与安装包，报告所有不变量',
    writes: false,
    argv: () => ['doctor', '--json'],
    json: true,
    timeoutMs: 180000,
  },
  upgrade: {
    label: '升级检测',
    hint: 'Harness 升级后：哪些补丁丢了、哪些要重打',
    writes: false,
    argv: () => ['upgrade', '--json'],
    json: true,
    timeoutMs: 180000,
  },
  upgradeStage: {
    label: '重打到暂存包',
    hint: '按声明重新构建到 state/staged/app.asar（只写 state/，不碰安装目录 —— 落盘仍要人挑时间）',
    writes: true,
    argv: () => ['upgrade', '--stage', '--json', '--no-hash'],
    json: true,
    timeoutMs: 600000,
  },
  precheck: {
    label: '组合预检',
    hint: '用隔离探针家跑一次权威 dump（会写 state/probe-home）',
    writes: true,
    argv: () => ['precheck'],
    json: false,
    timeoutMs: 600000,
  },
  snapshotList: {
    label: '快照列表',
    hint: '列出已有快照',
    writes: false,
    argv: () => ['snapshot', 'list'],
    json: false,
    timeoutMs: 30000,
  },
  snapshotCreate: {
    label: '留一份快照',
    hint: '改动之前先冻结 profile 控制面',
    writes: true,
    argv: (input) => ['snapshot', 'create', '-m', cleanLabel(input?.message) || '界面上留的快照'],
    json: false,
    timeoutMs: 60000,
  },
};

const ACTION_NAMES = Object.keys(ACTIONS);

/**
 * 界面要用的那张表。客户端**不复制这份清单**，而是从这里取 ——
 * 否则「宿主加了操作、按钮没跟上」这种漂移不会有任何症状。
 */
function actionSpecs() {
  return ACTION_NAMES.map((name) => ({
    name,
    label: ACTIONS[name].label,
    hint: ACTIONS[name].hint,
    writes: ACTIONS[name].writes === true,
  }));
}
const MAX_STREAM = 64 * 1024;
const MAX_BODY = 8 * 1024;

function readBody(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error(`请求体超过 ${limit} 字节`)); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function parseJsonOrNull(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function tailAppend(acc, chunk) {
  const next = acc + chunk;
  return next.length > MAX_STREAM ? next.slice(-MAX_STREAM) : next;
}

let actionChain = Promise.resolve();

/** 把操作串成一条链：同一个宿主进程里一次只跑一个。 */
export function runAction(name, input) {
  const start = () => executeAction(name, input);
  const p = actionChain.then(start, start);
  actionChain = p.then(() => {}, () => {});
  return p;
}

async function executeAction(name, input) {
  const spec = ACTIONS[name];
  if (!spec) return { ok: false, action: name, error: `未知操作：${name}`, actions: ACTION_NAMES };

  const root = findProjectRoot();
  if (!root) {
    return {
      ok: false,
      action: name,
      error: '找不到项目根（这个按钮只在开发形态下可用：插件目录里要能找到 src/cli.mjs）',
    };
  }

  const cli = path.join(root, 'src', 'cli.mjs');
  const argv = spec.argv(input);
  const started = Date.now();

  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(process.execPath, [cli, ...argv], {
        cwd: root,
        // 宿主可能是 Electron：以 Node 身份跑它，任何纯 Node 脚本都能用。
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      resolve({ ok: false, action: name, label: spec.label, argv, error: String(err?.message ?? err) });
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* 已经退出了 */ }
    }, spec.timeoutMs ?? 120000);

    const finish = (payload) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ action: name, label: spec.label, hint: spec.hint, writes: spec.writes, argv, root, ...payload });
    };

    child.stdout.on('data', (c) => { stdout = tailAppend(stdout, c.toString('utf8')); });
    child.stderr.on('data', (c) => { stderr = tailAppend(stderr, c.toString('utf8')); });
    child.on('error', (err) => finish({ ok: false, ms: Date.now() - started, error: String(err?.message ?? err), stdout, stderr }));
    child.on('close', (code) => finish({
      ok: code === 0,
      code,
      ms: Date.now() - started,
      stdout,
      stderr,
      json: spec.json ? parseJsonOrNull(stdout) : null,
    }));
  });
}

function handleAction(req, res) {
  const method = String(req.method ?? 'GET').toUpperCase();
  if (req.headers?.[ACTION_HEADER] !== '1') {
    sendJson(res, { ok: false, error: `缺少 ${ACTION_HEADER}: 1 请求头（只允许本机界面触发）` }, 403);
    return;
  }
  if (method !== 'POST') {
    sendJson(res, { ok: false, error: `只接受 POST，收到 ${method}` }, 405);
    return;
  }
  readBody(req)
    .then((raw) => {
      let input = {};
      if (raw && raw.trim()) {
        input = parseJsonOrNull(raw);
        if (input === null) { sendJson(res, { ok: false, error: '请求体不是合法 JSON' }, 400); return null; }
      }
      const name = String(input.action ?? '');
      if (!ACTION_NAMES.includes(name)) {
        sendJson(res, { ok: false, error: `未知操作：${name || '(空)'}`, actions: ACTION_NAMES }, 400);
        return null;
      }
      return runAction(name, input).then((result) => sendJson(res, result));
    })
    .catch((err) => sendJson(res, { ok: false, error: String(err?.message ?? err) }, 400));
}

function sendJson(res, payload, status = 200) {
  const body = Buffer.from(JSON.stringify(payload, null, 2), 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function sendJs(res, text) {
  if (text === null) {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('dsh-up-t: assets/client.js not readable');
    return;
  }
  const body = Buffer.from(text, 'utf8');
  res.writeHead(200, {
    'Content-Type': 'application/javascript; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

export default {
  name: 'dsh-up-t',

  // 注意：这里**故意不写**对象级 `inject`。理由见文件头第 2 条。
  apply(root) {
    const rowDisposers = [];

    // ⓪ 心跳：证明「这个插件真的被加载并执行了」。不依赖任何服务，所以放在最前面，
    //    和注入行同一个理由 —— 越早做，越不可能因为后面的依赖不满足而漏掉。
    writeHeartbeat();

    // ① 第一件事：注册桌面端注入行。不依赖任何服务，所以不能放进 root.inject 里。
    rowDisposers.push(root.on('webserver/index-inject', (table) => {
      for (const row of table) {
        if (row.kind === 'script-src' && row.src === CLIENT_PATH) return;
        if (row.kind === 'script' && typeof row.text === 'string' && row.text.includes(CLIENT_PATH)) return;
      }
      table.push({ kind: 'script', text: INJECT_ROW_TEXT });
    }));

    root.effect(() => () => {
      for (const d of rowDisposers) { try { d(); } catch { /* 清理失败不影响退出 */ } }
    });

    // ② 其余逻辑等 webServer 就绪。
    root.inject(['webServer'], (ctx) => {
      const disposers = [];

      disposers.push(ctx.webServer.register({
        kind: 'exact',
        path: CLIENT_PATH,
        handler: (req, res) => sendJs(res, readClientJs()),
      }));

      disposers.push(ctx.webServer.register({
        kind: 'exact',
        path: STATUS_PATH,
        handler: (req, res) => {
          try { sendJson(res, collectStatus()); } catch (err) {
            sendJson(res, { ok: false, error: String(err?.message ?? err) });
          }
        },
      }));

      // 操作通道：设置页上的按钮打这里。GET 也答一句，好让人用浏览器确认路由活着。
      disposers.push(ctx.webServer.register({
        kind: 'exact',
        path: ACTION_PATH,
        handler: (req, res) => {
          try {
            if (String(req.method).toUpperCase() === 'GET') {
              sendJson(res, {
                ok: true,
                actions: ACTION_NAMES,
                specs: actionSpecs(),
                note: '用 POST + ' + ACTION_HEADER + ': 1 触发',
              });
              return;
            }
            handleAction(req, res);
          } catch (err) {
            sendJson(res, { ok: false, error: String(err?.message ?? err) }, 500);
          }
        },
      }));

      // Web 形态（宿主自己渲染 index.html 时）用 tapIndex；桌面端靠上面的注入行。
      disposers.push(ctx.webServer.tapIndex((html) => {
        if (html.includes(CLIENT_PATH)) return html;
        const tag = `<script defer src="${CLIENT_PATH}"></script>`;
        return html.includes('</body>') ? html.replace('</body>', `${tag}</body>`) : html + tag;
      }));

      ctx.effect(() => () => {
        for (const d of disposers) { try { d(); } catch { /* 同上 */ } }
      });

      // ③ 走到这里才是真的「能用」：webServer 就绪、三条路由都注册上了。再落一枚心跳，
      //    把 stage 推到 ready。这一步本身不依赖任何服务，失败也不该影响插件工作，
      //    所以 writeHeartbeat 永远不抛。
      writeHeartbeat('ready', { routes: [CLIENT_PATH, STATUS_PATH, ACTION_PATH] });
    });
  },
};
