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
- [ ] 最小可用插件脚手架（host 入口 + client 入口 + `dsh` 声明）
- [ ] 挂一个自有面板到现有槽位
- [ ] 把高频操作做成按钮

## 验收

- 界面上出现自建面板，功能可用。
- 刷新/热重载后仍在。
- Harness 升级后仍在（证明它确实活在 L1 而不是 L3）。

## 记录

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

