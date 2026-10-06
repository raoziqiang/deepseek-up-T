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
| `/dsh-up-t/action` | 操作通道。`GET` 列出可用操作（只读、无需请求头），`POST` 才真的执行 |
| `/dsh-up-t/seen` | 握手通道。渲染层脚本跑起来后 `POST` 一句「我到了」；`GET` 只读，永不记录 |

`apply()` 的**第一条语句**就是 `writeHeartbeat()`，然后立刻注册 `webserver/index-inject` 的注入行；
其余逻辑在 `root.inject(['webServer'], …)` 里。

## ★ 心跳：回答「重启到底有没有把我装进去」

这个插件的失败路径**全都是静默的** —— 没重启就什么都没发生；`apply()` 抛错宿主照常跑；
客户端脚本 404 只是少一页（注入行刻意吞掉 `onerror`，为了不拖垮启动）。
所以「加载成功了吗」以前只能靠**肉眼看界面**。

`apply()` 每次执行都会写 `plugins/dsh-up-t/.runtime/heartbeat.json`：

```json
{ "plugin": "dsh-up-t", "version": "0.1.0", "stage": "ready", "at": "…",
  "loadedAt": "…", "trail": [{ "stage": "apply", "at": "…" }, { "stage": "ready", "at": "…" }],
  "pid": 12345, "execPath": "…", "electron": "44.0.0", "node": "24.x", "installDir": "…",
  "clientPath": "/dsh-up-t/client.js", "statusPath": "/dsh-up-t/status.json",
  "actionPath": "/dsh-up-t/action", "routes": ["/dsh-up-t/client.js", "…"] }
```

**两枚心跳，不是一个。**「加载了」和「能用」是两件事，而最安静的坏法正好落在两者之间：
插件被加载、注入行也进了表，然后**卡在等 `webServer` 上** —— 路由没注册，界面里既没有胶囊也
没有设置页，而且没有任何一条报错。所以心跳分两步写：

| `stage` | 什么时候 | 结论 |
| --- | --- | --- |
| `apply` | `apply()` 的第一件事（不依赖任何服务） | 插件确实被加载并执行了 |
| `ready` | `webServer` 就绪、四条路由都注册完之后 | **能用**：界面里该出现的东西确实有地方可取 |

- `trail` 是这两步的路径（出问题时最想知道的就是「它停在哪一步」），`loadedAt` 钉在第一步。
  同一个进程里插件被重新加载时，`trail` 从新的 `apply` 重新开始 —— 旧的那条属于上一次生命周期。
- **绝不抛异常**：写失败只记进 `lastHeartbeatResult`，并通过 `status.json` 的 `heartbeatWriteError` 暴露。
- **返回值被忽略** —— 磁盘上的文件才是证据。
- `dsht doctor` 读它并给几种结论：**没有文件 → INFO**（还没重启，预期）、
  **不是合法 JSON → WARN**、**`stage: "apply"` 且进程活着 → WARN**（加载了但依赖没就绪，
  即上面那种静默失败，提示里直接说「界面里既不会有胶囊也不会有设置页」）、
  **`stage: "ready"` → OK 并报出路由条数**、**`stage: "ready"` 但还没有渲染层握手 → WARN**
  （见下一节：宿主能跑了，但浏览器里那段脚本没跑起来）；`pid` 已经不在了 → WARN（来自上一个进程）。
  心跳**没有** `stage` 字段时按「未知」处理并明说是旧版本写的 —— 把「我手里没有这条信息」
  说成「你坏了」是最糟的一种诊断错误。
- 设置页的「心跳」一行显示同一件事（`服务已就绪（路由 4 条）` / `只走到 apply()`），
  并跟上握手状态（`· 渲染层已握手（bundle+capsule）` / `· 还没有渲染层握手`）。
  设置页恰恰是「什么都没出现」时人会来看的地方，让它自己说出卡在哪一步，比让人去猜「是不是没重启」有用。
- 所以它写在**包自己的 `.runtime/`**，不写项目的 `state/`：插件若以非 junction 方式安装，
  它写的就不是我们这份副本的目录 —— 而 `doctor` 看不到它，**这正是正确的结论**。

`.runtime/` 已在 `.gitignore` 里（它含本机 pid 与绝对路径，是「这一刻」的证据，不是源码）。

## ★ 握手：让渲染层自己说「我跑起来了」

心跳的 `ready` 只说**宿主侧**把路由注册上了。它答不了最后一个问题：浏览器里那段脚本到底跑了没有？
注入行可能没被收集、`lib/client.js` 可能在渲染层加载失败 —— **两种都不报错**，界面里就是什么都没有，
和「插件根本没加载」长得一模一样。这一段只有渲染层自己说得出来，所以 `/dsh-up-t/seen` 收一条
「我到了」的 `POST`：

| `via` | 谁发的 | 它证明了什么 |
| --- | --- | --- |
| `capsule` | `assets/client.js`（注入行那条通道） | 注入行被收集了，且脚本在渲染层真的执行了 |
| `bundle` | `lib/client.js`（ModuleLoader 那条通道） | 设置页那个 bundle 被加载了 |

两条通道**分开记**（`client.sources`）：「胶囊在、设置页不在」和反过来是两种不同的故障，
合成一个布尔值就再也分不开了。`client.count` 是握手次数、`client.at` 是最近一次。

- **握手是证据，不是功能**：两处都包在 `try/catch` 里、失败静默。旧宿主上没有这条路由（404）时
  界面照旧 —— 这条通道的价值全在诊断上，绝不能成为新的失败原因。
- 记进**同一份心跳文件**（`client` 字段），所以 `doctor` / `status.json` / 设置页三处都看得到它。
- 需要 `x-dsh-up-t: 1` 头才记录；`GET` **只读、永不记录**（不能靠 GET 凭空造出一次握手）。
- 时间语义：**刚启动的头几秒、以及无界面（headless）形态下，没有握手是正常的** ——
  诊断文案里明说了这一句，免得把正常状态说成故障。

## ★ 操作通道：把 `dsht` 最常跑的命令挂成按钮

设置页面上那一排按钮（体检 / 升级检测 / 重打到暂存包 / 重启后验收 / 组合预检 / 快照列表 / 留一份快照）走的是
`/dsh-up-t/action`。它有四条约束，每一条都是为了让「点了没反应」不可能发生：

1. **白名单，不接受任意命令。** 每个操作在宿主侧的 `ACTIONS` 表里写死 argv 形态；
   用户能填的只有「快照备注」这一个占位（`cleanLabel()` 折成单行、去首尾、封顶 120 字符）。
   执行用 `spawn(exe, [cli, ...argv])` **数组形式，永不经过 shell** ⇒ 没有拼接注入面。
2. **客户端不复制这份清单。** 按钮来自 `GET /dsh-up-t/action` 返回的 `specs`。
   硬编码一份在界面里的清单不会因为宿主加了操作而变红 —— 它只会静静少一个按钮。
3. **只允许本机界面触发。** 必须带 `x-dsh-up-t: 1` 这个**自定义头**且必须是 `POST`：
   跨源的 `<form>` / `fetch` 不经预检带不上自定义头，而我们从不下发 CORS 允许头。
   缺头一律 **403**，非 POST 一律 **405**，body 不是 JSON 一律 **400**，名字不在白名单一律 **400**。
4. **一次只跑一个。** 所有调用串在一条 promise 链上：`precheck` 会拉起一个 Electron-as-Node
   进程去跑 `--dump-config`，两个并发既慢又容易互相踩探针家目录。

**`writes` 决定要不要二次确认**，而它划的正是「有没有动磁盘」：
`体检` / `升级检测` / `重启后验收` / `快照列表` 是 `false`，`组合预检`（写探针家）、`留一份快照`（写快照）、
`重打到暂存包`（写 `state/staged/`）是 `true`。这张表被断言钉住 —— 少标一个就等于少一次确认。
「重启后验收」跑的是 `dsht accept`（不给 `--json`：这条命令的价值就是那份人能读的报告）；
验收本身**只读**，所以它不该弹确认框 —— 「确认要验收吗」这种问题会教人习惯性点掉确认框，
而那个习惯迟早会点掉一个真的写操作。
「重打到暂存包」跑的是 `upgrade --stage --json --no-hash`：它**只写 `state/staged/`，不碰安装目录**，
所以可以随便点；真正落盘（`vendor/whale/install.mjs --yes`）永远由人在 Harness 退出后做。

怎么跑起来的：宿主可能是 Electron，所以用 `process.execPath` + `ELECTRON_RUN_AS_NODE=1`
以纯 Node 身份跑 `src/cli.mjs`（`src/` 零依赖，只用了内置模块）。
项目根由 `findProjectRoot()` 从插件目录往上找（≤5 层，要求有 `src/cli.mjs` 且包名对得上）；
`PACKAGE_ROOT` 走 `fs.realpathSync.native()` —— 插件是以 **junction** 装进 profile 的，
不解析真实路径就会去改 junction 那一侧的目录，而且**不报任何错**。

**优雅降级**：操作通道是宿主半侧新增的，**必须重启 Harness 才会出现**。
在那之前 `GET` 打不通，界面显示「操作通道由宿主半侧提供…重启后回到本页即可」，
而不是一直转圈。客户端半侧改完仍然只需硬刷新。

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

## ★ 状态页的判定：拿不到的事实不许说成反面结论

设置页上有一行「判定」，它要回答的是「安装包被动过没有」。这条结论**很容易说错**，错法还很毒：
拿不到证据时给出一个反面结论，人就会照着一个不存在的故障去查。

真实的踩坑记录：运行中的旧版实例报 `install.asarBytes: 0`，而磁盘上那份 `app.asar` 是
**121,348,951 B** —— 于是三态判定 `asarBytes === backupBytes` 得出 `false`，页面显示
**「已被改造（大小不同）」**。那是一句纯粹的冤枉：0 不是「大小不同」，0 只是「这份事实没拿到」。

现在的规则（两条，都被断言钉住）：

1. **0 字节与读不到一律算「拿不到」**，不是反面证据。`sameSizeAsBackup` 只在两侧都拿到正数时才是
   `true`/`false`，否则是 `null`；`judgedBy` 同步从 `size` 降级成 `unavailable`，界面于是说
   **「无法判断（宿主这次没拿到可比的大小）」**，而不会声称「依据：大小比较」。
2. **候选路径被否掉时，理由一起带出去**。`findInstall()` 会依次试
   `path.dirname(process.resourcesPath)` 与 `path.dirname(process.execPath)` 两个根，
   `不存在` / `stat 失败` / `0 字节` 三种候选都不作数，继续试下一个；全都不作数时
   `status.json` 里的 `installRejected` 会带上 `{ dir, asar, why }`，页面显示成
   **「读不到安装目录信息 —— 试过并否掉的路径：…（0 字节）」**。
   （两个根在 Electron 下常常是同一个，所以候选要去重，否则同一条会被否掉两次。）

同一节里顺手修掉了心跳那一行的第三种误报：**能拿到 `status.json` 却读不到心跳字段**，
说明的是「这一版宿主还没有心跳功能」，不是「插件没被加载」—— 后者只有连 status.json 都拿不到时
才成立。旧文案把前者也说成「插件没被加载」，而当时的运行实例正是这个状态。

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
node test\plugin.test.mjs   # 46 条断言：心跳（apply + ready 两枚、trail、route 清单）、注入行、四条路由、操作守卫与真 spawn、specs 的 writes 标记、握手通道（GET 只读 / 缺头 403 / 两条通道分开记 / bundle 恰好握一次）、客户端 bundle 形态与按钮、设置页的心跳行与握手状态、判定的三态与「拿不到 ≠ 不同」（含 `findInstall` 跳过 0 字节候选的回归测试）、清理
node src\cli.mjs doctor     # bundles 全部可解析
node src\cli.mjs precheck   # 组合可用
```

**胶囊与设置页真的出现**只能在重启 DSH 之后看到 —— 组合层文件没有热重载。
（客户端脚本本身按 mtime 重读，所以**改客户端代码之后硬刷新页面即生效**，不用再重启。
但**操作通道是宿主半侧的新路由，必须重启**。）
