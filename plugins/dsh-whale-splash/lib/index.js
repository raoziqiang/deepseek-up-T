// deepseek-up-T :: dsh-whale-splash —— 主窗口启动动画
//
// 星空鲸鱼游过界面、时不时荡起星空涟漪，收尾时游到左下角化作一只科幻鲸鱼娘并常驻。
//
// 层：L1（profile 插件层），升级 Harness 不会碰它。
// 注入方式与 dsh-up-t 完全一致（理由见 plugins/dsh-up-t/lib/index.js 文件头）：
//   - 注入行必须在 apply() 一开头注册，不能等 webServer —— 注入表只在启动时收集一次；
//   - 注入行必须是内联 `script`，由它自己建 `<script src>` 并吞掉 onerror ——
//     `script-src` 行 404 会拖垮整个应用启动。
// 图片走同源路由而不是 data: URL：WebGL 纹理要求同源，且主界面的 img-src 未必放行 data:。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = (() => {
  const p = path.resolve(HERE, '..');
  try { return fs.realpathSync.native(p); } catch { return p; }
})();
const ASSETS = path.join(PACKAGE_ROOT, 'assets');

const BASE = '/dsh-whale-splash/';
const SCRIPT_PATH = BASE + 'splash.js';

/** 路由表：公开路径 → 包内文件与类型。注入行与路由共用 SCRIPT_PATH。 */
export const ROUTES = {
  [SCRIPT_PATH]: { file: 'splash.js', type: 'application/javascript; charset=utf-8' },
  [BASE + 'whale.png']: { file: 'whale.png', type: 'image/png' },
  [BASE + 'whale-girl.png']: { file: 'whale-girl.png', type: 'image/png' },
};

export const INJECT_ROW_TEXT =
  '(function(){try{var d=document.head||document.documentElement;if(!d)return;'
  + 'if(window.__DSH_WHALE_SPLASH_LOADED__)return;window.__DSH_WHALE_SPLASH_LOADED__=true;'
  + `var s=document.createElement("script");s.src="${SCRIPT_PATH}";`
  + 's.onerror=function(){};d.appendChild(s)}catch(e){}})()';

/** 按 mtime 重读：改完 assets/ 硬刷新即生效，不用重启 Harness。 */
const cache = new Map();
function readAsset(file) {
  const full = path.join(ASSETS, file);
  try {
    const { mtimeMs } = fs.statSync(full);
    const hit = cache.get(full);
    if (hit && hit.mtimeMs === mtimeMs) return hit.body;
    const body = fs.readFileSync(full);
    cache.set(full, { mtimeMs, body });
    return body;
  } catch {
    return null;
  }
}

export function serve(route, res) {
  const body = readAsset(route.file);
  if (body === null) {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('dsh-whale-splash: ' + route.file + ' not readable');
    return;
  }
  res.writeHead(200, {
    'Content-Type': route.type,
    'Content-Length': body.length,
    'Cache-Control': 'no-cache',
  });
  res.end(body);
}

export default {
  name: 'dsh-whale-splash',

  // 故意不写对象级 inject：那会把 apply() 推迟到服务就绪之后，注入行赶不上收集。
  apply(root) {
    const rowDisposers = [];
    rowDisposers.push(root.on('webserver/index-inject', (table) => {
      for (const row of table) {
        if (row.kind === 'script' && typeof row.text === 'string' && row.text.includes(SCRIPT_PATH)) return;
      }
      table.push({ kind: 'script', text: INJECT_ROW_TEXT });
    }));
    root.effect(() => () => {
      for (const d of rowDisposers) { try { d(); } catch { /* 清理失败不影响退出 */ } }
    });

    root.inject(['webServer'], (ctx) => {
      const disposers = [];
      for (const [routePath, route] of Object.entries(ROUTES)) {
        disposers.push(ctx.webServer.register({
          kind: 'exact',
          path: routePath,
          handler: (req, res) => serve(route, res),
        }));
      }
      disposers.push(ctx.webServer.tapIndex((html) => {
        if (html.includes(SCRIPT_PATH)) return html;
        const tag = `<script defer src="${SCRIPT_PATH}"></script>`;
        return html.includes('</body>') ? html.replace('</body>', `${tag}</body>`) : html + tag;
      }));
      ctx.effect(() => () => {
        for (const d of disposers) { try { d(); } catch { /* 同上 */ } }
      });
    });
  },
};
