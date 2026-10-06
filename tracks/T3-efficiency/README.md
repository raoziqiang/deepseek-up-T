# T3 · 使用效率

> 同样的活，少花时间、少花 token。

## 现状与抓手

| # | 抓手 | 位置 | 现状 / 判断 |
| --- | --- | --- | --- |
| 1 | **会话全文搜索** | `session-query-sqlite.openAt` | ✅ 已开（`path=$DSH_HOME/session-search.sqlite` + `openAt=first-search`），待重启验收 |
| 2 | 上下文落盘阈值 | `spill-policy.maxInlineTokens` | ✅ 已核：`12500` **维持不动**（append-only，不破坏 KV Cache；完整结果落文件可读回，见记录） |
| 3 | 工具结果预压缩 | `tool-result-pruner` | ✅ 已核：`8192` / `4096` / `1024` **维持不动**（只在压缩压力下运行，且会从第一个变化的 token 起让 KV Cache 失效，见记录） |
| 4 | 会话标题质量 | `session-title-llm` | ✅ 已调：`targetWords: 8` / `targetCjkCharacters: 16` / `maxOutputTokens: 96`（原 5 / 10 / 64），待重启验收 |
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
- [x] 梳理 `spill-policy` / `tool-result-pruner` 阈值对长会话成本的影响 —— 2026-10-06 完成：**结论是两个都维持不动**，见下方记录
- [x] 梳理斜杠命令与快捷键 —— 2026-10-06 完成，见下方记录
- [x] **让会话标题更长、更能区分** —— 2026-10-06 完成，见下方记录
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

### 2026-10-06 · 第 4 项：让会话标题更长、更能区分

**问题**：base 把标题压得很短 —— `targetWords: 5` / `targetCjkCharacters: 10`。
10 个汉字的标题只能表达到「这是一次关于 X 的会话」，同一主题的多次会话会长得一模一样，
于是「找上周那次」只能靠点开看。这是**纯读数上的损失**，没有换来任何安全或成本收益。

**改了什么**（现场 `cordis.patch.yml` 第 13 条；声明副本 `patches/T3-session-title.yml`）：

| 字段 | 原 | 新 | 为什么 |
| --- | --- | --- | --- |
| `targetWords` | 5 | **8** | 非 CJK 语言下的目标词数 |
| `targetCjkCharacters` | 10 | **16** | 16 个汉字 ≈ 48 字节，仍在 `session-title` 的 `maxTitleBytes: 80` 之内 |
| `maxOutputTokens` | 64 | **96** | 多出的字数要留出生成空间；标题只有一两行，这点 token 可以忽略 |
| `maxInputBytes` | 4096 | 4096 | **不动**：那是送进去的首条提示词上限，与「标题多长」无关，改了只会让成本变 |
| `timeoutMs` | 60000 | 60000 | **不动**：已经足够宽 |

**为什么五个字段全部写出来**：patch 是**按 id 整体替换该行的 config**（不是深合并），
而该条目的五个字段在 schema 里全部 `.required()` —— 漏写任何一个那条条目都会校验失败。
（对比 `tool-ralph`：那里只写 `disabled: false` 是安全的，因为**没给** `config`，于是完整继承 base 的。）
另据 `state/probe-config-schema.txt`，这几个字段只要求 `"minimum": 1`，**没有上界**，所以放大是合法的。

**怎么验的**：`precheck --patch` 先离线跑一遍，差异**恰好 3 行**（`targetWords` / `targetCjkCharacters` /
`maxOutputTokens`），`maxInputBytes` 与 `timeoutMs` 显示未变 —— 这正是「整体替换写全了五个字段」的证据。
落盘后再 `precheck`（现场）→ 退出码 0、问题 0、`与上一次预检相比：组合结果完全一致` ⇒ 现场与预检过的候选**逐字节等价**。
`doctor` → 0 错误 2 警告、patch 条目 **13**；`baseline write` 重新固化（13 bundle / 13 patch 条）。

**怎么撤**：删掉现场 `cordis.patch.yml` 里这一条（或改回 5 / 10 / 64），重启 DSH。改动前快照
`20261006-082050-T3-会话标题-改动前`。

**顺带修掉一个会反复过期的量具**：`test/upgrade.test.mjs` 里原本硬编码「顶层条目恰好 N 个」，
每落盘一条都要改一次 —— 而它真正要守的性质是「解析器只认顶格 `- id:`，没被 config 里嵌套的骗到」。
现在改成用独立算法对照：现场顶格 `- id:` 行数必须等于解析出的条目数，并另外断言「现场确实存在嵌套的 `- id:`」
（实测 13 顶格 / **30** 嵌套 —— 那 30 条是 `llm-pi-ai` 三条路由里的模型 id），否则上一条断言等于没测东西。
**这个量具从此不会再过期。**

**生效条件**：组合层文件没有热重载，需**重启 DSH**。验收方式是看新会话的侧边栏标题是否比过去更有信息量
（尤其同主题的连续会话能不能一眼分开）。

### 2026-10-06 · 第 2、3 项：`spill-policy` 与 `tool-result-pruner` 阈值 —— 都维持不动

**结论先行：这两项不改。** 理由不是「懒得改」，而是读完两个包的权威文档后发现
**它们已经是保守默认值，而且信息都是可恢复的**，动它们只会在没有实测压力的情况下拿掉一层保险。

**读的什么**（都在安装包内，抽出到 `D:\Z1848\Temp\`）：
- `dsh/node_modules/@deepseek-ai/dsh-spill-policy/README.zh.md`（7806 B）
- `dsh/node_modules/@deepseek-ai/dsh-compaction-tool-result-pruner/README.zh.md`（8246 B）

**① `spill-policy.maxInlineTokens: 12500`（上下文落盘阈值）**
- 作用：工具结果超过这个**估算 token 预算**时，保留首尾各一半，末尾附一条提示给出**完整结果文件**的路径
  （`(Omitted N bytes. Full formatted result stored at: …)`），模型可用 `read` / `grep` 读回，图片用 `read_image`。
  **文件里保存的是全部已接受文本**，所以这是**无损**的 —— 只是从内联变成「按需读取」。
- 只影响过大的结果；预算内结果、`read`、被阻止的决策、值替换、不支持的内容块都**原样通过**。
  保存失败/计量失败时**保留原内容**并记警告（尽力而为，不会用读不到的路径替换内容）。
- **KV Cache 影响：仅追加** —— 「新可见内容位于可重用请求前缀之后，**不会使现有 KV Cache 条目失效**」。
  这解释了为什么本次会话的缓存命中率还能有 98.3%：spill 是**缓存友好**的机制。
- 当前值 `12500` 就是该包 README 里给出的示例值（base 照抄），**不是**被我或 base 调过的激进值。

**② `tool-result-pruner`（`thresholdChars: 8192` / `headChars: 4096` / `tailChars: 1024`）**
- 作用：把超阈值的结果换成「头部 + `[... tool result middle pruned ...]` + 尾部」。
- **它只在压缩触发条件满足后才运行** —— 「`dsh-compaction-basic` 在压力或溢出确认后、选择要压缩的内容之前调用它。
  **低于压力时不会修剪任何内容**」。也就是说它**不会**在正常对话里悄悄吃掉内容。
- **无损可回放**：原始事件仍留在**仅追加的会话日志**里，替换事件通过 `sourceEventSeqs` 引用它。
- **它存在的意义是省一次模型调用**：修剪可能充分缓解压力，从而让 `compaction-basic` **跳过摘要**（不发起 LLM 调用）。
- 三个值就是该包的**默认值**；约束是「头部 + 标记 + 尾部之和必须不超过阈值」（4096 + 标记 + 1024 ≲ 8192 ✓）。
- **KV Cache 影响与 spill 相反**：「替换较早的结果会使**从第一个改变的 token 起**的复用失效」。
  ⇒ **这正是不能把 `thresholdChars` 调低的原因**：调低 = 更早开始改写历史 = 更早打断缓存，
  在一个命中率 98.3% 的会话里是纯亏。

**为什么「维持不动」是正确的工程结论**
1. 两个机制都**信息可恢复**（spill 有完整文件；pruner 有 `sourceEventSeqs` 可回放）——不存在「悄悄丢数据」。
2. 两个阈值都**只在边缘生效**：spill 只在 >12500 token 时；pruner 只在已有压缩压力时。平时完全不参与。
3. 调高 `maxInlineTokens` ⇒ 内联更多 ⇒ 每轮 token 更多 ⇒ **更多**压力 ⇒ 更多压缩，方向正好相反；
   调低 ⇒ 更多结果被落到文件 ⇒ 更多次 `read` 往返 ⇒ **更慢**，不是更省。
4. pruner 阈值调低会把「省一次摘要」换成「破坏 KV Cache」，在 98.3% 命中率的实测下是负收益。
5. 没有实测到任何「压力过大」的症状 —— 第 8 项的缓存账（净 +92.35M、14/17 次折叠回本）说明
   压缩层运行良好。**没有病灶就不要开刀。**

**如果将来要动，判据是什么**：出现「长会话频繁触发压缩、且摘要调用明显变贵」的实测数据时，
先考虑**调高** `maxInlineTokens`（减少 spill 往返）而不是动 pruner，并且要用 `acp_cache` 复测命中率。
在此之前，这一项按「已核实、无需改动」归档。


