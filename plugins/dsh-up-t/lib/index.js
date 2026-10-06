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
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(HERE, '..');

/** 客户端脚本的公开路径。注入行与路由必须用同一个常量，否则永远不会一致。 */
const CLIENT_PATH = '/dsh-up-t/client.js';
const STATUS_PATH = '/dsh-up-t/status.json';

const CLIENT_FILE = path.join(PACKAGE_ROOT, 'assets', 'client.js');

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
  };
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

function sendJson(res, payload) {
  const body = Buffer.from(JSON.stringify(payload, null, 2), 'utf8');
  res.writeHead(200, {
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

      // Web 形态（宿主自己渲染 index.html 时）用 tapIndex；桌面端靠上面的注入行。
      disposers.push(ctx.webServer.tapIndex((html) => {
        if (html.includes(CLIENT_PATH)) return html;
        const tag = `<script defer src="${CLIENT_PATH}"></script>`;
        return html.includes('</body>') ? html.replace('</body>', `${tag}</body>`) : html + tag;
      }));

      ctx.effect(() => () => {
        for (const d of disposers) { try { d(); } catch { /* 同上 */ } }
      });
    });
  },
};
