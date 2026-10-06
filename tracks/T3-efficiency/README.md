# T3 · 使用效率

> 同样的活，少花时间、少花 token。

## 现状与抓手

| # | 抓手 | 位置 | 现状 / 判断 |
| --- | --- | --- | --- |
| 1 | **会话全文搜索** | `session-query-sqlite.openAt` | ✅ 已开（`path=$DSH_HOME/session-search.sqlite` + `openAt=first-search`），待重启验收 |
| 2 | 上下文落盘阈值 | `spill-policy.maxInlineTokens` | `12500` |
| 3 | 工具结果预压缩 | `tool-result-pruner` | `thresholdChars: 8192` / `headChars: 4096` / `tailChars: 1024` |
| 4 | 会话标题质量 | `session-title-llm` | `targetWords: 5` / `targetCjkCharacters: 10` / `maxInputBytes: 4096` / `maxOutputTokens: 64` |
| 5 | 交互习惯 | `ui-conversation.busyEnter` | 已设 `steer` |
| 6 | 快捷键 / 斜杠命令 | `dsh-client-shortcuts`、`dsh-commands` | ✅ 已梳理：7 个斜杠命令；快捷键**可重绑**（`Ctrl+/` 开速查），见记录 |
| 7 | 记忆策略 | `@furongjun1999/dsh-memory`、`billion-context` | 已装，写入/召回策略未梳理 |
| 8 | 缓存经济学 | `acp_cache` | ✅ 已量：命中率 **98.3%**，压缩净 **+92.35M tok**；无问题可修（见记录） |

## 为什么先做第 1 项

`session-query-sqlite` 是**已经装好、只差一个开关**的能力。base 的注释明确写了部署方可以在后续 patch 层把
`openAt` 改成 `first-search` 或 `startup`，并建议同时给一个持久化的 `path`：

```yaml
# 为什么改：默认 openAt=never 时侧边栏只能按标题/工作区名匹配，找不到历史内容
- id: session-query-sqlite
  name: "@deepseek-ai/dsh-session-query-sqlite"
  config:
    path: !!js dshHomePath('session-index.sqlite')
    openAt: first-search
```

注意 `config` 是**整体替换**，所以要连同 `path` 一起写出来。

## 待办

- [x] 开启会话全文搜索（含持久化 `path`）—— 2026-10-06 完成，见下方记录
- [ ] 重启 DSH 后做一次真实验收：搜一个只出现在历史对话正文里的词
- [x] 用 `acp_cache` 量一次当前缓存基线，作为后续调参的对照 —— 2026-10-06 完成，见下方记录
- [ ] 梳理 `spill-policy` / `tool-result-pruner` 阈值对长会话成本的影响
- [x] 梳理斜杠命令与快捷键 —— 2026-10-06 完成，见下方记录
- [ ] 梳理记忆插件的写入与召回

## 验收

- 在侧边栏搜索一个只出现在历史对话正文里的词，能命中。
- 给一个固定任务，改前改后对比耗时与 token 消耗。

## 记录

### 2026-10-06 · 开启会话全文搜索（L0）

**改了什么**
`C:\Users\Z1848\.dsh\profiles\desktop\cordis.patch.yml` 追加第 11 个条目：

```yaml
- id: session-query-sqlite
  name: "@deepseek-ai/dsh-session-query-sqlite"
  config:
    path: !!js dshHomePath('session-search.sqlite')
    openAt: first-search
```

声明式副本在 `patches/T3-session-search.yml`。

**为什么**

- base 层把它配成 `path: ':memory:'` + `openAt: never`，于是搜索面板只能按标题、工作区名匹配；
  按内容/代码搜就直接以 `SESSION_QUERY_SEARCH_DISABLED` 失败。
- 选 `first-search` 不选 `startup`：`startup` 会在服务发布**之前**就打开句柄，索引无效时
  **整个插件激活失败**，等于把一个附加能力变成启动风险。`first-search` 把打开推迟到第一次真正
  搜索，并发搜索共享同一个就绪 promise，启动路径零成本。
- `path` 必须是**专用派生索引**，绝不能指向 session-persistence 的库；放 `$DSH_HOME` 下可随用户
  目录一起备份。

**怎么验**
`dsht precheck` —— 与改动前的权威组合结果逐条目比对，结果是「0 新增 / 0 移除 / 1 修改」，
且恰好是预定的两行；stderr 0 字节，退出码 0。

```
    ~ 条目 session-query-sqlite
        - path: ':memory:'
        - openAt: never
        + path: !!js dshHomePath('session-search.sqlite')
        + openAt: first-search
```

**怎么撤**
`node src/cli.mjs snapshot restore 20261006-070311-T3-会话搜索-改动前 --yes`
（或直接删掉 `cordis.patch.yml` 末尾那个条目 —— 该条目之前的所有内容未被触碰）。

**还没做的**
`cordis.patch.yml` **没有热重载**（全运行时没有 watcher 监听它），改动要重启 DSH 才生效。
重启后要补一次真实搜索验收，才算真正闭环。

### 2026-10-06 · 缓存经济学基线（`acp_cache`）

**为什么量**
第 8 项抓手的目的是回答一个容易凭感觉争论的问题：「压缩到底是在帮我省钱，还是在烧钱？」
在动手调任何阈值之前，先把当前的真实数字钉下来当对照。

**量了什么**（`acp_cache`，本轮会话 401 个请求）

| 指标 | 数值 |
| --- | --- |
| 总输入 | 33.55M tok |
| 命中缓存 | 32.99M tok（**98.3%**，判定 `HEALTHY`） |
| 输出 | 354.5K tok |
| miss 合计 | 556.0K tok = 新内容 313.7K + 压缩重付 240.0K + 无法归因 2314 |

命中率按输入规模的中位数：20K → 93.4%、40K → 98%、60K → 99.5%、80K → 100%、100K → 100%、
120K → 99.8%；整体中位数 99.6%。全程没有模型切换。

**压缩的账**

- 17 次 fold：累计省下 92.61M tok，重付 240.0K，摘要自身成本 19.3K ⇒ **净 +92.35M tok**。
- 14 次已回本；3 次未回本只是「折叠得早或会话已结束」，是一次性成本，不是数据丢失。
- 最大三次 fold：#1 省 79.9K、#4 省 45.3K、#13 省 44.1K；最差的一次性投入是 #8 的 9861 tok。

**稳定前缀为什么还会重付**

- restart / refork：125 tok。
- 无法归因（上游 TTL、驱逐、中继轮换）：2189 tok，占 95%。

`BODY STABILITY`：309 对相邻请求里 **0 对字节相同、309 对全部 mid-history divergence**，
说明前缀差异来自真实的历史改写，而不是载荷抖动。396 个 miss 样本落在客户端 mid-stream abort
后 30s 内 —— 时间上相关，但不是因果。

**结论**

**缓存层没有可修的效率问题，压缩在这台机器上是净赚的。** 所以第 8 项抓手到此结案：
不要在缓存/压缩上做优化，那不是瓶颈。

**这改变了什么**

它把 T3 的注意力从「缓存」推回到「真正减少要读的东西」：第 2 项（`spill-policy.maxInlineTokens`）
与第 3 项（`tool-result-pruner` 的 8192 / 4096 / 1024）才是有杠杆的地方 —— 它们决定**有多少内容
进入上下文**，而缓存只决定**进来的内容贵不贵**。后续调这两个阈值时，用本节数字做对照。

### 2026-10-06 · 斜杠命令与快捷键梳理（只读侦察）

**斜杠命令**（host 的 `ctx.commands` 人类命令注册表）—— 全归档共 7 个，都来自 `@deepseek-ai/*`：

| 命令 | 作用 | 归属包 |
| --- | --- | --- |
| `/compact` | 压缩较早的对话历史 | `dsh-command-compact` |
| `/export` | 把本会话日志下载为 ZIP | `dsh-session-log-export` |
| `/feedback` | 记录对本会话的反馈 | `dsh-command-feedback` |
| `/goal` | 设置或查看长任务的目标 | `dsh-command-goal` |
| `/permission` | 切换权限预设（沙箱模式 + 审批策略） | `dsh-permission-presets` |
| `/plan` | 进入 / 离开计划模式 | `dsh-plan-mode` |
| `/file` | 挑选文件 | `dsh-client-ui-conversation`（**客户端 UI 动作**，不是 host 命令） |

侦察方法：`dsht asar grep "commands\.register"` → 18 处命中，去重后 7 个归属包；抽包后 grep `name:` / `description:`。
`/file` 注册在客户端 `commandUi` 服务上（`ui-conversation` 的 `lib/client.js:18113`），与 host 的 `ctx.commands`
**不是同一个注册表** —— 看到菜单里它和 host 命令并列，但实现路径不同。

**快捷键：可以重绑，而且绑定是设备本地的**

- 服务是 `@deepseek-ai/dsh-client-shortcuts`（Web bundle 自动挂载）。功能插件在 `ctx.effect()` 里用
  `ctx.shortcuts.register()` 注册命令。
- 两类：**可编辑命令**（用户能改）与**固定操作**（`registerFixed()`，只读序列，不可改、其键位也不能被占用）。
  固定操作只有菜单导航三件套：`↑ ↓` / `Enter` / `Esc`（id 为 `fixed.move` / `fixed.select` / `fixed.dismiss`）。
- 每个命令按设备声明默认值：`desktop|web` × `macos|windows|linux`；省略的那一档 = 不绑键。`primary` 在 Windows 上就是 Ctrl。
- **持久化位置很关键**：Web 用同源 localStorage 的 `dsh.keybindings.v1`；**桌面端**用 Electron 设备本地的
  `userData/keybindings.json` —— 与 `$DSH_HOME`、工作区设置**都无关**，所以换设备要重新绑，而且它不在本项目
  的四层改造面里（既不是 L0 也不是 L1，是 Electron 的 userData）。
- 只保存**覆盖**：缺命令 = 继承默认；`null` = 清除绑定；恢复默认 = 删掉覆盖。schema v1 → v2，v2 增加可选
  `secondCode` 以支持双键组合。
- 双键组合（Windows / macOS 桌面）：1–2 个不同的非修饰键 + 0–4 个修饰键，要求**按住时间重叠**，顺序不限；
  一前一后按不算。
- 速查面板用 `Ctrl+/` 打开。Host 侧还有一个旋钮 `stopSequenceMs`：连续两次 Esc 的最大间隔，**默认 500 ms**。

**本机（Windows 桌面）的默认键位**

| 命令 id | 默认键 | 作用 |
| --- | --- | --- |
| `sidebar.left.toggle` | `Ctrl+B` | 切换左侧栏 |
| `sidebar.right.toggle` | `Ctrl+B` / `Ctrl+Alt+B` | 切换右侧栏 |
| `settings.open` | `Ctrl+,` | 打开设置 |
| `shortcuts.open` | `Ctrl+/` | 打开快捷键速查 |
| `workspace.files` | `Ctrl+Alt+P` | 打开文件面板 |
| `workspace.openLocal` | `Ctrl+Alt+O` | 在本地应用打开工作区 |
| `browser.new` | `Ctrl+Alt+T` | 新建浏览器标签 |
| `terminal.new` | `Ctrl+\`` | 新建终端 |

同一命令按平台各有默认值，上表取本机 Windows 桌面那一档；**以 `Ctrl+/` 面板显示为准**。

**★ 一个必须记住的锐边**：该包 README 明确写「**包括 Command+C 和 Ctrl+C 在内的所有有效绑定优先于原生操作、
编辑器、终端、内嵌页面和模态控件**」。也就是说重绑时把常用组合抢过来，会连带盖掉复制这类系统/编辑器行为。
双键组合是例外：只有两个键都按住时才接管，第一个键仍会正常处理（可能输入一个字符）。

**怎么验的**：只读侦察，没有改任何配置。`dsht asar grep` 三发（`commands\.register`、
`shortcuts\.(register|registerFixed)`、`accelerator:`），抽 8 个归属包的 `lib/client.js` 后正则提取
`id` / `code` / `modifiers`。`accelerator:` 在整个归档里只有 2 处（`F12` 开发者工具 + 一个空串）
⇒ 桌面菜单**不是**快捷键的主要来源，客户端 shortcuts 服务才是。

**为什么不改任何配置**：快捷键本来就可重绑，默认值也覆盖了主要动作 —— 改默认值反而会破坏用户已有的肌肉记忆。
结论是**记录 + 让用户按需在 `Ctrl+/` 面板里改**。真正值得留意的是 `Ctrl+B` 同时挂在左右两个侧栏上，
但它们的默认档位不同（本机左栏 `Ctrl+B`、右栏 `Ctrl+B`/`Ctrl+Alt+B`），若真冲突，速查面板会标出「键位冲突」。
第 6 项到此结案。


