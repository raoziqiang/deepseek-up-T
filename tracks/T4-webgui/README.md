# T4 · Web GUI 扩展

> 给自己的界面加面板、加槽位——走插件层，不去改安装包里的前端。

## 现状

- `@deepseek-ai/dsh-client-ui-slots` 是槽位系统（`dsh-client-ui-layout` 提供布局骨架）。
- `dsh-better-sidebar@0.24.1` 已经证明这条路走得通，并且**暴露了一个 service 供别的插件注册
  sidebar tab 与 file viewer** —— 也就是说它既是范例，也是可用的扩展点。
- 客户端插件支持热重载（`dsh-client-hmr` 已挂载），**迭代速度远快于改 asar**。

## 插件声明方式（照抄 `dsh-better-sidebar/package.json`）

```json
{
  "type": "module",
  "main": "lib/index.js",
  "exports": {
    ".":              { "default": "./lib/index.js" },
    "./invariant":    { "default": "./lib/invariant.js" },
    "./client":       { "default": "./lib/client.js" },
    "./client/service": { "default": "./lib/client.js" }
  },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "inject": [
        "@deepseek-ai/dsh-client-locale",
        "@deepseek-ai/dsh-client-ui-slots",
        "@deepseek-ai/dsh-client-ui-conversation",
        "@deepseek-ai/dsh-client-ui-primitives"
      ],
      "platform": "web"
    },
    "manifestVersion": 1
  }
}
```

要点：
- `dsh.bundle.patch` 指向插件自带的 `cordis.patch.yml` —— 插件靠它把自己插进插件树。
- `dsh.client.inject` 声明客户端侧需要哪些同伴包。
- `dsh.client.platform: "web"` 标明只作用于 Web 前端。
- 宿主侧入口是 `exports["."]`，客户端入口是 `exports["./client"]`。

## 写之前先读运行时事实

**不要猜 API。** 用两个探针工具读实时事实：

| 工具 | 能读到什么 |
| --- | --- |
| `cordis_inspect_list` | 当前所有 Inspect Provider 及其只读方法 |
| `cordis_inspect_query` | Service 方法、Event 模式、插件 Config schema、Tool schema、主题 token、**实时 Slot 树与 props** |

写插件前至少查一次：目标槽位的 id 与 props、可用 Service 的方法签名。

## 待办

- [x] 用 `cordis_inspect_query` 把可用槽位树读出来并记录 —— 2026-10-06 完成，见下方记录
- [x] 最小可用插件脚手架（host 入口 + client 入口 + `dsh` 声明）—— 2026-10-06 完成：`plugins/dsh-up-t`
- [x] 挂一个自有面板到现有槽位 —— 2026-10-06 完成：`settings.section` 一整页「deepseek-up-T」，见下方第三步记录
- [x] 让「插件到底加载了没有」变成可核对的事实 —— 2026-10-06 完成：`apply()` 落 `.runtime/heartbeat.json`，`doctor` 新增「运行时」段读它（见 `tracks/T5-engineering/README.md` 的记录）
- [x] 把高频操作做成按钮 —— 2026-10-06 完成：`/dsh-up-t/action` 白名单通道 + 设置页按钮区（体检 / 升级检测 / 重打到暂存包 / 组合预检 / 快照列表 / 留一份快照），见下方记录
- [ ] 重启 DSH 后确认胶囊与设置页真的出现

## 验收

- 界面上出现自建面板，功能可用。
- 刷新/热重载后仍在。
- Harness 升级后仍在（证明它确实活在 L1 而不是 L3）。

## 记录

### 2026-10-06 · 第六步：心跳两步走，并让它出现在设置页上（「加载了」≠「能用」）

**为什么**：设置页和胶囊都依赖宿主半侧被加载。而这条链上最安静的坏法不在「没加载」，
在**「加载了但依赖没就绪」** —— `apply()` 跑完、注入行进了表，然后卡在等 `webServer` 上：
路由一条都没注册，界面里什么都没有，**也没有任何报错**。那时手边唯一能问的只有设置页，
所以设置页必须自己说出它卡在哪一步。

**做成了什么**
- 心跳从一枚变两枚：`apply()` 开头写 `stage: "apply"`；`webServer` 就绪、三条路由注册完之后
  写 `stage: "ready"` + `routes`。文件里另有 `loadedAt` 与 `trail`（本次生命周期走过的两步）。
- 设置页新增「心跳」一行，三态文案：`服务已就绪（路由 3 条） · pid …` /
  `只走到 apply() · webServer 依赖没就绪 —— 界面里不会出现胶囊与设置页 · pid …` / `还没有心跳（插件没被加载，或还没重启 Harness）`。
- `dsht doctor` 同步扩成四分支（见 `tracks/T5-engineering/README.md` 同日记录）。

**怎么验的**：`node test/plugin.test.mjs` **39/39**（新增 3 条：ready 时的 stage/routes/trail/`loadedAt`、
只到 apply 时的形状、设置页把两种 stage 渲染成人话）；`node test/run.mjs` **4/4 套通过**；
四个分支用手写心跳文件喂给 `dsht doctor` 真跑过。

**还没验的**：真实重启后的那枚 `ready`。**这正是这一步存在的意义** —— 重启后先看它，
它能替代「界面里有没有出现」这个肉眼判断的一半。

### 2026-10-06 · 第五步：把「重打到暂存包」也挂成按钮（顺带把 `writes` 语义钉死）

**为什么加这一个**：第四步挂的五个按钮里，升级之后最该被点的那一个还不存在。T5 刚交付
`upgrade --stage`（半自动重打），它**只写 `state/staged/`、不碰安装目录，所以可以随便点** ——
「随便点也不怕」正是它适合做成按钮的理由；真正危险的那一步（覆盖在用 `app.asar`）仍然留给人挑时间。

**做成了什么**
- `plugins/dsh-up-t/lib/index.js`：`ACTIONS` 加 `upgradeStage`（label「重打到暂存包」，
  `argv: ['upgrade','--stage','--json','--no-hash']`，`json: true`、`writes: true`、`timeoutMs: 600000`）。
  **客户端一行没改** —— 按钮来自 `GET /dsh-up-t/action` 的 `specs`，这正是第四步约束 ②的回报。
- `test/plugin.test.mjs` 加一条断言（35 → **36**），钉的不是「多了一个按钮」，而是**整张 specs 表**：
  每个 spec 必须有非空 `name` / `label` / `hint`（界面把 `hint` 当按钮 `title`），
  且 `writes` 必须是布尔；然后逐个核对
  `doctor` / `upgrade` / `snapshotList` = `false`，`precheck` / `snapshotCreate` / `upgradeStage` = `true`。
  **为什么这条值得单独立一条**：`writes: false` 会让界面**跳过二次确认**，所以少标一个 flag
  等于少一次确认，而界面上看不出任何异常 —— 它只会安静地变得更容易误点。

**怎么验的**：`node test/plugin.test.mjs` **36/36**；`node test/run.mjs` **4/4 套通过**；
`node --check` 两个改动文件；`upgrade --stage` 本身的行为在 `ce7f202` 里已单独验过。

**还没验的**：和第四步同一条 —— 这条路由**必须重启 Harness 才存在**。点下去会真的构建一次（约 1.2s）。

### 2026-10-06 · 第四步：把高频操作做成按钮（`/dsh-up-t/action`）

**为什么难**：前面三步都是**只读**的（读状态、渲染、写心跳）。这一步第一次让**界面能改磁盘**，
而上一步刚建立的教训正是「这个插件的失败路径全是静默的」—— 按钮点下去没反应，界面上只有转圈。
所以这一整步的设计目标可以压成一句：**让「点了没反应」不可能发生**。

**先读事实，不猜 API**（`cordis_inspect_query` host `Service/listService`）：
`WebRoute = { kind: 'exact' | 'prefix', path, handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void> }`
⇒ **handler 拿得到 `req.method` 与 `req.headers`，所以一条路由就能同时服务 GET 与 POST**，
不需要注册两条（`register` 对重复的 `(kind, path)` 直接 throw）。
宿主里跑 Node 脚本的现成做法在 `src/precheck.mjs:111-130`：`ELECTRON_RUN_AS_NODE=1` + `process.execPath`。

**四条约束**
1. **白名单，永不经过 shell**：操作在宿主侧 `ACTIONS` 表里写死 argv；用户输入只能填进「快照备注」
   这一个占位（`cleanLabel()` 折单行、去首尾、封顶 120）；执行用 `spawn(exe, [cli, ...argv])` 数组形式。
2. **客户端不复制这份清单**：按钮来自 `GET /dsh-up-t/action` 的 `specs`。硬编码的清单不会因为宿主
   加了操作而变红，只会**静静少一个按钮** —— 这正是「能发现的东西就不要手写清单」那条教训的应用。
3. **只允许本机界面触发**：必须 `POST` + `x-dsh-up-t: 1` 自定义头（跨源 `<form>`/`fetch` 不经预检带不上
   自定义头，而我们不下发 CORS 允许头）。缺头 403 / 非 POST 405 / body 非 JSON 400 / 名字不在白名单 400。
   `GET` 恒为只读的发现接口 —— 它能列动作，**永远不执行**。
4. **一次只跑一个**：所有调用串在一条 promise 链上（`precheck` 会拉起 Electron-as-Node，并发既慢又互踩探针家目录）。

**顺带修掉的一个静默陷阱**：插件是以 **junction** 装进 profile 的，`path.resolve(HERE,'..')` 拿到的是
junction 那一侧的目录。所以 `PACKAGE_ROOT` 必须走 `fs.realpathSync.native()` —— 否则心跳写错地方、
按钮找不到 `src/cli.mjs`，**两种情况都不报错**。

**优雅降级**（这是「宿主半侧 vs 客户端半侧」的区别第一次变得要紧）：操作通道是宿主半侧的新路由，
**必须重启 Harness 才存在**；而客户端脚本按 mtime 重读，硬刷新即可。所以在重启之前，
`GET` 打不通 → 面板落到 `missing` 态显示「重启 Harness 后回到本页即可」，不是一直转圈。

**怎么验的**（都是离线，没有 boot 实例）
- `test/plugin.test.mjs` 从 24 条涨到 **35 条**，新增部分：路由数 2→3；`GET` 只列动作且不执行；
  缺头 403；非 POST 405；非 JSON 400；白名单外 400 带 `actions`；**一次真 spawn**（`runAction('snapshotList')`
  真的跑起来并返回 stdout）；客户端面板**按钮来自宿主清单**（并断言源码里没有硬编码的 `"体检"`）；
  点只读按钮 → `POST` 且带 `x-dsh-up-t` 与备注；点写盘按钮 → **先 confirm，答「不」时一个请求都不发**；
  取不到清单时落到 `missing` 态并渲染出「重启 Harness」。
- 远端真跑一次（不经界面）：`runAction('doctor')` → `ok/code 0/560ms` 且 json 解析出 6 个键；
  `runAction('upgrade')` → `ok/code 0/426ms` 且 json 解析出 17 个键。
- 全套 `node test/run.mjs` **4/4 套通过**；`node src/cli.mjs doctor` **0 错误 2 警告**。

**踩到的坑（都是测试侧，不是产品侧）**
1. 元素树里 children **既可能是元素也可能是数组**（`h("div", {…}, [a, b])` 是常态），
   只按 `el.children` 递归会一层都找不到 —— 面板已渲染却断言「找不到按钮」。
2. bundle 里的 `fetch` 解析到的是 **vm 沙箱的全局**，不是宿主的 `globalThis`：
   把宿主 `fetch` 换掉，被测代码根本看不见，症状是「点了按钮一个请求都没发」。
   修法是从沙箱里换（给沙箱一个转发到可变引用的壳）。
3. 外层组件（`UpTSection`）与面板**共用同一个 `useState` 队列**，必须先渲染外层拿到面板元素，
   再改脚本化 state 渲染面板；顺序反了会让外层拿到面板的 state（症状是 `reading 'install'`）。

**还没验的**：真在界面上点一下按钮 —— 和设置页一样，要**重启 Harness** 才会有这条路。

### 2026-10-06 · 第三步：用 Slot 系统挂一页设置（`lib/client.js`）

**为什么这步比第二步难**：第二步的胶囊走的是「注入一段脚本」的轻通道，客户端代码随便写。
这一步要走槽位系统，就必须是一个**真正的客户端 Cordis 插件**——而宿主**不会替你构建**它。

**查清的四件事**
1. 客户端半侧能用什么：client `Service/listService` 给出 `layout` / `locale` / `sessions` /
   **`slots`**（`register` / `registerFactory` / `inject`）/ `theme` / `timer` / `uiWorkspace` / `workspaces`。
   动态客户端半身（`Builtin/listBuiltins`）另有一套：只有 `ctx`（`get`/`on`/`provide`/`effect`，
   **没有 `inject`**）、`React`、`host.call`、`styles.insert`。
2. **宿主只提供已构建的客户端 bundle**（`@deepseek-ai/dsh-client-modules/README.zh.md`：
   「启动前 `pnpm run build` 必须已产出每个 `lib/client.js`；缺失 bundle 会明确导致激活失败」）。
   而 `profiles/desktop/package.json` **没有 `scripts` 字段** ⇒ profile 里不存在那条构建链。
   ⇒ **`lib/client.js` 只能手写并提交进仓库。**
3. bundle 的**确凿形态**（从真实上线的 `dsh-better-sidebar/lib/client.js` 逆出，1,099,283 字节）：
   `window.__ModuleLoader__.load({ id, factory: (require) => { … return module.exports } })`，
   factory 导出的是 `exports.apply` + `exports.inject`（Cordis **服务名**数组，如
   `["slots","sessions","locale","modules","connection","remote",…]`）；`require("react")` 直接可用。
4. 槽位注册的**运行期签名**（`dsh-better-sidebar/lib/client.js:23284`，正是 `settings.section`）：
   `ctx.slots.inject(键, () => ctx.slots.register({ name: 键, id, order, label: () => string, inject: () => businessShare }, 组件))`。
   另从 `@deepseek-ai/dsh-client-ui-slots/README.zh.md`（7278 字节）确认：四种 kind
   `single`/`list`/`keyed`/`chain`；组件拿到五个框架 share 组合的 props；
   **声明即认领**——注册未声明的 slot 会在**加载时抛错**，所以挂错座位不会静默。

**选座位的理由**：`settings.section` 是 `list` 且 `replaceRisk: none` —— 一个条目 = 设置里的一整页，
**不会遮蔽任何自带界面**。这是「用 Slot 系统挂自有面板」里语义最干净的一种。

**做了什么**：新建 `plugins/dsh-up-t/lib/client.js`（经典脚本、无 ESM；顶部守 `window.__ModuleLoader__`
缺失就静默退出，绝不影响外壳启动；`inject = ["slots"]`；注册一页 `id: "dsh-up-t"`、`order: 90`、
标签「deepseek-up-T」，组件 `UpTSection` 每 30 秒从 `/dsh-up-t/status.json` 读一次并渲染三态）；
`package.json` 加 `exports["./client"]` 与 `dsh.client.platform = "web"`。

**怎么验的**（离线，不 boot 实例）：`test/plugin.test.mjs` 加 6 条断言 —— 在 `node:vm` 里给一个 stub 的
`window.__ModuleLoader__` 抓下 factory、用假 `require` 执行、断言导出的 `apply`/`inject` 形态，
再用假 `ctx`（记录 `slots.inject` / `slots.register`）跑 `apply()`，断言注册进 `settings.section`
且条目形态正确、组件能渲染出 loading 态。**共 20/20 项通过。**
踩到的坑：vm 里造出来的数组/对象与宿主 realm 不同源，`assert.deepEqual` 会因原型不相等而误报；
改用 `Array.isArray` + `Array.from` 与 `Object.keys(...).length` 比较。

**还没验的**：设置里真的出现那一页 —— 要看这个界面必须**重启 DSH**（组合层文件没有热重载）。
不过客户端脚本按 mtime 重读，之后改客户端代码硬刷新即可，不用再重启。

### 2026-10-06 · 第一步：把运行时事实读出来（没有猜任何 API）

**可用的 Inspect Provider**（`cordis_inspect_list`）

| 平台 | Provider | 用途 |
| --- | --- | --- |
| host | `Service` | 渐进式 Service 发现：先拿紧凑目录，再拿某一个的精确契约 |
| host | `Event` | 同上，事件与监听者签名 |
| host | `Config` | **实时**插件 Config：分页条目目录（带 schema 状态）+ 单条目的 JSON Schema |
| host | `Tool` | 当前 Agent 可见的全部 Tool schema |
| client | `Slots` | 实时 Slot / Factory 拓扑，`listSubTree` 带 `root` 时返回该 Slot 的目录与占用者 |
| client | `Service` / `Event` / `Builtin` | 客户端侧的同名发现，`Builtin` 是动态客户端半身可用的纯 JS 符号 |
| client | `Theme` | 当前主题 token 名与明暗覆盖要求 |

**★ 一个必须记住的语义陷阱：`Config/listConfigs` 的 `status` 里 `inactive` 不等于「关掉了」。**
203 个条目里 `tool-fs`、`tool-pwsh`、`tool-web`、`tool-plugin-manager`、`compaction-basic`
都报 `inactive`，但它们的功能明显在工作（本会话就在用 `read`/`pwsh`/`web_search`/`compress`）。
`status` 描述的是**这个条目自身的配置投影状态**，不是「启用/禁用」。
把 `inactive` 读成「关着」会得出「我的文件工具没启用」这种荒唐结论。
真正的「配置有没有值」用 `status: schema` + 取该条目 schema 判断。
（`tree` = 分组节点，`absent` = 没有 schema 投影。）

**★ 可加挂的槽位：只列 `replaceRisk: none` 的（加法座位，不会遮蔽自带 UI）**

| 槽位 | 类型 | 作用 |
| --- | --- | --- |
| `shell.overlay` | list | 帧级浮层，在所有列之上、滚动容器之外 |
| `sidebar.footer.action` | list | 侧栏底部「设置」旁边的动作 |
| `sidebar.panellist` | list | 全局面板图标 |
| `sidebar.workspaces.session.row.action` | list | 某条会话行尾的 hover 按钮（在「…」菜单之后） |
| `sidebar.workspaces.session.menu.item` | list | 会话行「…」菜单的菜单项 |
| `sidebar.session.row.leading` | list | 会话标题前 16px 单元格的装饰 |
| `sidebar.session.row.hover` | list | 会话行 hover 卡片中「相对时间」与状态行之间的区段 |
| `settings.section` | list | **整页**设置（每项一页） |
| `settings.general.item` | list | 「通用」里的一行偏好（不需要单独一页时用它） |
| `settings.plugins.tab` | list | 插件设置区内的一页 |
| `settings.models.provider-card` | keyed | 某个 provider 卡片的扩展区（`entryKey = settingsNs` 派发） |
| `settings.models.footer` | list | provider 行与新增控件之后的排序扩展区 |
| `plugins.item` | list | 插件页 Official 组里的一张卡片 |
| `plugins.detail.actions` / `plugins.detail.badge` | list | 详情页头部控件 / 标题旁的标签 |
| `conversation.chat.assistant-actions` | list | **一条已完成 assistant 消息的动作行** |
| `conversation.chat.turnTail` | list | 一个已完成 Turn 的动作行之前 |
| `conversation.input.left` / `.right` | list | 输入框工具行左/右的紧凑控件 |
| `conversation.composer.dock` | list | 输入卡片**下方**的环境条目 |
| `conversation.input.dock` | list | 输入卡片**上方**的全宽条目 |
| `conversation.input.overlay` | list | 输入卡片内部的浮层条目 |
| `conversation.plan-review.actions` | list | 正在审阅的计划的动作 |
| `sidebar.right.tab.menu.item` | list | 右侧面板某个标签页动作菜单的额外项 |
| `deliverables.file.actions` | list | 按会话事件坐标打开一个文件 |

**list 槽位的注册签名统一是** `{ id: string（必填）, order?: number, label?: string | (() => string) }`。

**要「替换」而不只是「加挂」时的座位**（`replaceRisk: shadows-shipped-ui`，会遮蔽自带 UI，慎用）：
`root`、`sidebar`、`sidebar.brand.mark`/`.name`、`sidebar.toggle.badge`、`sidebar.settings`、
`sidebar.workspaces`、`settings.trigger`/`.header`/`.close`/`.launcher`/`.models.sign-in`、
`main`（keyed，已占用 `conversation`）、`conversation.session`、`conversation.view`、
`conversation.chat.node`（keyed，已占用 20 种 ChatNodeKind）、`tool.call.toolview`（keyed）、
`conversation.composer.bar`、`conversation.input.model`/`.permission`/`.plan`/`.activity`、
`conversation.hero.workspace`、`shell.leading` 等。

**顺带读到的两个「已占用键」白名单**（做 keyed 槽位时必须避开）
- `main` 的 keyDomain：`open: any string … already taken: conversation`
- `tool.call.toolview` 的 keyDomain 已列出全部 50 个线上 Tool 名
  （`ask_user_question`、`bash`、`cordis_*`、`create_goal`、`edit`、`glob`、`grep`、`present`、`ralph`、
  `read`、`read_image`、`schedule_*`、`session_event_*`、`session_search`、`skill`、`spawn_teammate`、
  `subagent`、`team_task_*`、`terminal_*`、`todo_write`、`update_goal`、`wait_agent`、`web_fetch`、
  `web_search`、`workflow`、`write` …）
  ⇒ 想给自己造的 Tool 配一张专属卡片，就在这个 keyed 槽位注册同名键。

**候选插件（按「小、能独立验证、升级幸存」排序）**
1. **会话标题旁的效率指示**：`sidebar.session.row.leading` 挂一个小点/角标，显示该会话的
   缓存命中或折叠次数。数据源需要先找到对应 Service（下一步用 host `Service/listService` 查）。
2. **`shell.overlay` 上的常驻信息条**：显示当前 DSH 版本 + `deepseek-up-T` 状态
   （`app.asar` 是否被改造过）。数据可用现成的 `dsht upgrade --json`。
3. **`settings.general.item` 一行**：把 `dsht` 的常用动作（体检 / 快照 / 预检）做成设置里的一行。
4. **`conversation.chat.assistant-actions` 一个动作**：「把这条回答存成项目记录」。

**下一步（不要跳步）**：先用 host `Service/listService` 的紧凑目录确认数据从哪来，
再写脚手架；脚手架第一版只做「静态文本渲染」，先证明**能挂上去**，再接数据。

### 2026-10-06 · 第二步：脚手架落地（`plugins/dsh-up-t`）

**做了什么**：一个最小可用的自建插件，也是 T4 的样板。位于
`D:\Z1848\harness-ds\deepseek-up-T\plugins\dsh-up-t\`：
`package.json` / `cordis.patch.yml` / `lib/index.js` / `assets/client.js` / `README.md`。
（注意这条线后来长出**两个**客户端脚本，别混：`assets/client.js` 是第二步的胶囊，
走「宿主注册 HTTP 路由 + 推一行注入」的轻通道，由 `lib/index.js` 的 `CLIENT_FILE` 按 mtime 直出；
`lib/client.js` 是第三步的设置页，走 Slot 系统，由 `exports["./client"]` 交给 ModuleLoader。）
它在界面左下角放一个小胶囊显示 Harness 版本与安装包是否被改造过，点开有细节，可拖动、右键隐藏。

**为什么不选 Slot 系统而选注入路线**：Slot 系统（`dsh-client-ui-slots`）要求客户端半身被打包进
Web 前端，也就是 `dsh.client.inject` 那一类（`dsh-better-sidebar` 的形态：`lib/client.js` 1.1MB、
还有 `lib/client-mermaid.js` 7MB）。那需要构建链。而 `dsh-whale-widget` 证明还有一条轻得多的路：
宿主注册一个 HTTP 路由 + 推一行注入，客户端就是一段普通 JS。**先用重的路证明「能挂上去」，
再接数据** —— 这条最轻的路能走通，后面所有面板都走同一条。

**三条硬约束（照抄 `dsh-whale-widget` 被 issue #152/#153/#154 打磨过的版本）**
1. 注入行必须是**内联 `script`**，绝不能是 `script-src`：渲染层对 `script` 行只做
   `createElement + textContent + append`（没有 await，不可能失败），对 `script-src` 行却是
   `await loadScript(src)` —— 404 就 reject 掉 `__DSH_BOOT_READY__`，**整个应用起不来**。
   而注入表是宿主**启动时一次性收集**的、没有刷新路径，所以插件被关掉后那行还在、路由已注销，
   404 是必然会发生的。内联行由它自己建 `<script src=…>` 并吞掉 `onerror`，最坏只是胶囊不出现。
2. **不能用对象级 `inject: ['webServer', …]`**：它把整个 `apply()` 推迟到服务就绪之后，
   行就赶不上那次一次性收集 —— 表现是「插件装好了但什么都不出现」，**且不报任何错**。
   正确做法：`apply()` 立刻注册注入行，其余逻辑放 `root.inject([...], cb)`。
3. 桌面端 `tapIndex` **永远不生效**（桌面壳 index.html 从安装包静态 dist 直出，不经过 `renderIndex()`），
   只为 Web 形态保留。

**怎么验的（三层，缺一层都不算数）**
- **离线单测** `test/plugin.test.mjs`（**14 条断言全过**）：钉住上面三条约束 —— 注册的是内联
  `script` 行、行文本含 `s.onerror=function(){}` 与幂等标记、不含 `await`；重复触发注入表不重复推；
  `root.inject` 只依赖 `webServer`；依赖就绪前已注册注入行（这是桌面端能看到胶囊的唯一原因）；
  两条精确路由的 kind/path/handler；handler 真的产出 200 + 非空 JS / 可解析 JSON；
  两个清理路径可调用不抛。**为什么必须离线钉**：这类失败是静默的，真机上很难复现。
- **组合预检**：先给 `precheck` 补了 `--profile-json <文件>` 覆盖项（见
  `tracks/T5-engineering/README.md`），用候选 package.json 预检
  → `退出码 0 / 问题 0 / 与上一次相比 1 新增：条目 dsh-up-t`，且没有 `skipping profile bundle`。
- **落盘后**：`doctor` → 0 错误 2 警告、**13 个 bundle 全部可解析**；`precheck`（用真实 profile）
  → 退出码 0、问题 0、与候选预检**完全一致** ⇒ 证明候选预检是忠实的。

**怎么装的**：junction `$DSH_HOME\profiles\desktop\node_modules\dsh-up-t` → `plugins\dsh-up-t`，
再在 profile package.json 的 `dsh.profile.bundles` 末尾加 `dsh-up-t`。
落盘前留了快照 `20261006-080136-T4-插件-dsh-up-t-落盘前`，原样副本在
`profiles\desktop\package.json.up-t-backup`（812B / 12 个 bundle）。

**还没验的**：胶囊真的出现在界面上 —— 组合层文件没有热重载，只能重启 DSH 后看。

**教训（一次误操作）**：`dsh --profile _probe web --help` **不是干跑**。
它打印了 web 的帮助，然后**照样启动**了那个 profile，且它按组合配置去绑 19387 —— 与用户正在跑的
实例撞端口，于是进程就那么挂着。已终止，确认 19387 始终由原实例（PID 30488）持有、未抢走端口，
残留子进程也已消失。**结论：验证要靠离线单测与 `--dump-config`，不要为了「看效果」去 boot 一个实例。**

