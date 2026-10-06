# dsh-up-t

`deepseek-up-T` 的第一个自建 DSH 插件，也是 `tracks/T4-webgui` 这条线的样板。

在 DSH 界面**左下角**放一个小胶囊：显示 Harness 版本 + 安装包是否被改造过，点开有细节。
右键点它可隐藏（位置与隐藏状态都存在 `localStorage`）。

另外在**设置里挂了一整页**「deepseek-up-T」（`settings.section` 槽位，`replaceRisk: none`，
不会遮蔽任何自带界面）。这一页是 T4 那条线的正题：**用 Slot 系统挂自有面板**。
左下的胶囊走的是更轻的注入通道，两者互不依赖 —— 胶囊是「通道可用」的证明，设置页是「槽位可用」的证明。

```
up-T · 44.0.0        ← 灰点：安装包与原版备份大小相同（很可能未被改造）
up-T · 44.0.0        ← 绿点：大小不同（已被改造）
up-T · ?             ← 黄点：没有原版备份可比 / 宿主没回应
```

## 它为什么值得存在

不是因为这个胶囊本身有用，而是因为它**证明了这条通道确实可用**：
插件住在 L1（`$DSH_HOME/profiles/<p>/node_modules/`），Harness 升级不会碰它，
而它却能把自有脚本注入到界面里、并能通过宿主自己的 HTTP 路由回传数据。
胶囊能出现，就说明整条链路通了 —— 以后要加的其它面板都走同一条路。

## 它做了什么

| 路由 | 作用 |
| --- | --- |
| `/dsh-up-t/client.js` | 客户端脚本。按 **mtime** 重读，所以改完**硬刷新页面即生效，不用重启 DSH** |
| `/dsh-up-t/status.json` | 状态事实（只做 stat 级读取，不算 121MB 的 sha256；含磁盘上的心跳） |

`apply()` 的**第一条语句**就是 `writeHeartbeat()`，然后立刻注册 `webserver/index-inject` 的注入行；
其余逻辑在 `root.inject(['webServer'], …)` 里。

## ★ 心跳：回答「重启到底有没有把我装进去」

这个插件的失败路径**全都是静默的** —— 没重启就什么都没发生；`apply()` 抛错宿主照常跑；
客户端脚本 404 只是少一页（注入行刻意吞掉 `onerror`，为了不拖垮启动）。
所以「加载成功了吗」以前只能靠**肉眼看界面**。

`apply()` 每次执行都会写 `plugins/dsh-up-t/.runtime/heartbeat.json`：

```json
{ "plugin": "dsh-up-t", "version": "0.1.0", "at": "…", "pid": 12345,
  "execPath": "…", "electron": "44.0.0", "node": "24.x", "installDir": "…",
  "clientPath": "/dsh-up-t/client.js", "statusPath": "/dsh-up-t/status.json" }
```

- **绝不抛异常**：写失败只记进 `lastHeartbeatResult`，并通过 `status.json` 的 `heartbeatWriteError` 暴露。
- **返回值被忽略** —— 磁盘上的文件才是证据。
- `dsht doctor` 读它并给三条结论：**没有文件 → INFO**（还没重启，预期）、
  **不是合法 JSON → WARN**、**合法 → 按 `pid` 现在是否还活着给 OK / WARN**。
- 所以它写在**包自己的 `.runtime/`**，不写项目的 `state/`：插件若以非 junction 方式安装，
  它写的就不是我们这份副本的目录 —— 而 `doctor` 看不到它，**这正是正确的结论**。

`.runtime/` 已在 `.gitignore` 里（它含本机 pid 与绝对路径，是「这一刻」的证据，不是源码）。

## ★ 三条不能违反的约束（都是别人踩过的坑）

1. **不能用对象级 `inject: ['webServer', …]`。**
   桌面端（Electron）的注入表是宿主**启动时一次性收集**的，没有刷新路径。
   对象级 inject 会把整个 `apply()` 推迟到服务就绪之后，行就赶不上那次收集 ——
   结果是「插件装好了但什么都不出现」，而且**不报任何错**。

2. **注入行必须是内联 `script` 类型，绝不能是 `script-src`。**
   渲染层对 `script` 行只做 `createElement + textContent + append`（没有 await，不可能失败）；
   对 `script-src` 行却是 `await loadScript(src)` —— 一旦 404 就 reject 掉 `__DSH_BOOT_READY__`，
   **整个应用起不来**。而一次性收集意味着插件被关掉后表里那行还在、路由已注销，
   404 是必然会发生的。所以推内联行，由它自己建 `<script src=…>` 并吞掉 `onerror`：
   最坏结果只是胶囊不出现。

3. **桌面端 `tapIndex` 不生效，别指望它。**
   桌面壳的 `index.html` 是从安装包静态 dist 直出（`dsh-app://app/`），不经过宿主的 `renderIndex()`。
   `tapIndex` 只为 Web 形态保留（本插件仍然注册了它，作为兼容）。

这三条连同 `apply()` 的行为，全部被 `test/plugin.test.mjs` 的断言钉住 ——
因为「行没赶上收集」这类失败是静默的，在真机上很难复现，只能在离线把行为钉死。

## ★ 客户端半侧（`lib/client.js`）与它的第四条约束

**宿主提供的是已构建的客户端 bundle，它自己不会替你构建。** 每个声明了 `dsh.client` 的包，
启动前必须已经有 `lib/client.js`；缺了会**明确导致激活失败**（`@deepseek-ai/dsh-client-modules`
的 README 就是这么写的）。而 `profiles/desktop/package.json` **没有 `scripts` 字段** ——
profile 里根本不存在 `pnpm run build` 这条链，所以「让宿主替我构建」这条路不存在。
⇒ **`lib/client.js` 是手写并提交进仓库的产物，不是构建结果。**

第 4 条约束：**客户端 bundle 必须是 ModuleLoader 的惰性 CJS factory**，不能是 ESM 模块
（CSP 不允许 ESM）。形态照抄真实上线的 `dsh-better-sidebar/lib/client.js`：

```js
window.__ModuleLoader__.load({
  id: "dsh-up-t",
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    var React = require("react");        // React 在外壳冻结的平台模块表里，无需声明
    // …组件定义…
    var inject = ["slots"];              // Cordis **服务名**数组（不是槽位名）
    function apply(ctx) {
      ctx.effect(function () {
        return ctx.slots.inject("settings.section", function () {
          return ctx.slots.register({
            name: "settings.section",    // 槽位键
            id: "dsh-up-t",              // 条目 id
            order: 90,
            label: function () { return "deepseek-up-T"; },
            inject: function () { return {}; },   // business share
          }, UpTSection);
        });
      }, "dsh-up-t: settings.section");
    }
    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
```

`package.json` 侧要配两处：`exports["./client"]` 指向该文件，`dsh.client.platform = "web"`。

**槽位规则（`@deepseek-ai/dsh-client-ui-slots`）**：`settings.section` 是 `list` 槽位，
一个条目就是设置里的一整页；`SlotCore` 构造时预置 `'root'`。注册**未声明**的 slot、
重复声明子项、缺 `select` 的 chain 都会在**加载时抛错** —— 也就是说挂错座位不会静默，会直接报错。

## 安装（本地开发形态）

```powershell
# 1) 建 junction，让 DSH 能按包名解析到本目录
New-Item -ItemType Junction `
  -Path "$env:DSH_HOME\profiles\desktop\node_modules\dsh-up-t" `
  -Target "D:\Z1848\harness-ds\deepseek-up-T\plugins\dsh-up-t"

# 2) 把 "dsh-up-t" 加进 profile package.json 的 dsh.profile.bundles
```

第 2 步**不要直接改**。先留快照，再用候选清单预检：

```powershell
cd D:\Z1848\harness-ds\deepseek-up-T
node src\cli.mjs snapshot create -m "装插件前"
# 生成候选 package.json（bundles 末尾多一个 dsh-up-t），然后：
node src\cli.mjs precheck --profile-json state\candidate\package.json
```

`precheck` 用隔离的探针家跑 asar 内那份 `bin.js --dump-config`，退出码 0 且没有
`skipping profile bundle` 就说明组合可用。确认后再改真实 profile。

## 卸载

1. 把 `dsh-up-t` 从 `dsh.profile.bundles` 去掉（profile package.json 是组合层文件，改前先快照）。
2. 删掉那个 junction。

备份文件 `package.json.up-t-backup` 是本次落盘时留下的原样副本，确认无误后可删。

## 验证

```powershell
cd D:\Z1848\harness-ds\deepseek-up-T
node test\plugin.test.mjs          # 24 条断言：心跳、注入行、两条路由、客户端 bundle 形态、清理
node src\cli.mjs doctor            # bundles 全部可解析
node src\cli.mjs precheck          # 组合可用
```

**胶囊与设置页真的出现**只能在重启 DSH 之后看到 —— 组合层文件没有热重载。
（客户端脚本本身按 mtime 重读，所以**改客户端代码之后硬刷新页面即生效**，不用再重启。）
