# T3 · 使用效率

> 同样的活，少花时间、少花 token。

## 现状与抓手

| # | 抓手 | 位置 | 现状 / 判断 |
| --- | --- | --- | --- |
| 1 | **会话全文搜索** | `session-query-sqlite.openAt` | ✅ 已开（`path=$DSH_HOME/session-search.sqlite` + `openAt=first-search`）；2026-10-07 运行时与桌面界面都按正文词命中测试会话 |
| 2 | 上下文落盘阈值 | `spill-policy.maxInlineTokens` | ✅ 已核：`12500` **维持不动**（append-only，不破坏 KV Cache；完整结果落文件可读回，见记录） |
| 3 | 工具结果预压缩 | `tool-result-pruner` | ✅ 已核：`8192` / `4096` / `1024` **维持不动**（只在压缩压力下运行，且会从第一个变化的 token 起让 KV Cache 失效，见记录） |
| 4 | 会话标题质量 | `session-title-llm` | ✅ 已调：`targetWords: 8` / `targetCjkCharacters: 16` / `maxOutputTokens: 96`（原 5 / 10 / 64），待重启验收 |
| 5 | 交互习惯 | `ui-conversation.busyEnter` | 已设 `steer` |
| 6 | 快捷键 / 斜杠命令 | `dsh-client-shortcuts`、`dsh-commands` | ✅ 已梳理：7 个斜杠命令；快捷键**可重绑**（`Ctrl+/` 开速查），见记录 |
| 7 | 记忆策略 | `@furongjun1999/dsh-memory`（灵枢）、`billion-context`、`dsh-context` | ✅ 已梳理：三者**机制正交**（压缩 / 长期记忆 / 只读观测）；灵枢 **33 个配置键已逐项体检、全部维持默认**（自动记忆实测在写），见记录 |
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
- [x] 正文搜索验收：`session/search` 以「两个字母」命中本次会话；桌面界面以标题未包含的「不要调用工具」命中同一测试会话并显示正文摘要（2026-10-07）
- [x] 用 `acp_cache` 量一次当前缓存基线，作为后续调参的对照 —— 2026-10-06 完成，见下方记录
- [x] 梳理 `spill-policy` / `tool-result-pruner` 阈值对长会话成本的影响 —— 2026-10-06 完成：**结论是两个都维持不动**，见下方记录
- [x] 梳理斜杠命令与快捷键 —— 2026-10-06 完成，见下方记录
- [x] **让会话标题更长、更能区分** —— 2026-10-06 完成，见下方记录
- [x] 梳理记忆插件的写入与召回 —— 2026-10-06 完成：三个插件机制正交，**结论是都不动**，见下方记录
- [x] 逐项读完灵枢的配置清单并实测自动记忆 —— 2026-10-07 完成：33 个键全部维持默认，自动记忆确实在写，见下方记录
- [ ] 重启 DSH 后确认灵枢仍以可写身份启动（不是只读 `guest`）—— 落盘/重启后看一眼是否有 `写入凭据不可用` 告警

2026-10-07 重启后只读检查：包外 `~/.mdcg/token` 存在（只确认文件存在与大小，未读取内容），
`dsh-memory-apply-error.log` 无本次重启的新错误；但 `_audit.jsonl` 在重启后尚无新提交，
因此「仍能写入」保持待验，不把凭据存在当成写入成功。

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

### 2026-10-06 · 记忆与上下文策略梳理：三个插件，三种正交机制

**为什么梳理**：第 7 项是唯一还没搞清「到底谁在管我的上下文」的抓手。三个插件都装着，
而它们都会改变进入模型的内容——不搞清边界就调参等于蒙眼开刀。

**三个插件分别是什么**（读各自 README）

| 插件 | 版本 | 干什么 | 介质 |
| --- | --- | --- | --- |
| `billion-context` | 0.1.182（运行面报 0.1.186） | 上下文**压缩代理**（acp-kernel 改写模型流） | `%USERPROFILE%\.local\share\billion-context\`（JSON + zstd） |
| `@furongjun1999/dsh-memory`（灵枢） | 0.7.1 | 跨会话**长期记忆** | 纯文本 md 认知图 `~/.dsh/.dsh-memory/data/mdcg` |
| `dsh-context` | 0.62.3 | **只读观测**（`/context`、Context 面板） | 无（只存 UI 偏好） |

三者 README **互相零提及**（grep 过），机制正交 ⇒ 是**叠加**关系，不是替代。

**① billion-context = 压缩，不是记忆**

- 「何时压缩、压缩什么——**由模型决定**，而非硬截断」。工具就是本会话在用的那四个：
  `compress` / `decompress` / `search_context` / `acp_status`。
- **它是本项目上下文策略的主角**。它自带的 `dsh.bundle.patch.yml` 全文只做两件事：
  `- insert:` → `- id: bili-native` / `name: billion-context`，以及
  **`- id: compaction-basic` / `config: auto: false`** ——
  ⇒ **宿主原生压缩被它关掉了**，折叠改由 billion-context 的增量模型接管。
  这一条解释了第 2/3 项为什么只能在边缘动：**真正的折叠决策不落在那两个阈值上。**
- 它自述「增量、可逆、对前缀缓存友好」，并给出 `GRAND LEDGER`（miss 拆解成
  new content / compress re-pay / upstream-ttl-or-client-rewrite）与 `FOLD ECONOMICS`
  （每次折叠净省多少、是否回本）——第 8 项量到的 98.3% / 净 +92.35M 就是它的账本。
- 关键旋钮（配置 `~/.config/billion-context/billion-context.json`，优先级 CLI > env > 文件 > 默认）：
  `compress.nudgeGrowthTokens`（≈50K，决定何时折叠）、`compress`（阈值/保留规则/tiers）、
  `providers`（模型窗口与 compaction opt-in）、`sessions.gc.maxAgeDays`（默认 14）。
- 锐边原文：与进程内扩展**互斥**（同时生效＝双重压缩）；「**没有任何鉴权**：只应在可信局域网或
  防火墙内使用」；自述**早期**（真实模型集成测试是下一里程碑）；MIT 之上有一条额外署名条款。

**② 灵枢（`dsh-memory`）= 长期记忆**

- 真源是**纯 md 认知图**，本机就在
  `C:\Users\Z1848\.dsh\.dsh-memory\data\mdcg\`：分层目录
  `anchor/ structural/ knowledge/ contextual/ goals/ self/ hippocampus/ unresolved/ rejected/ trash/`，
  外加 `_index.json`、`_access.log`、`_audit.jsonl`、`_consistency.jsonl`、`_forgetting.jsonl`、
  `_sustain.jsonl`、`_writelimit.json`、`policy.json`。
- 写入＝显式工具（`cg(op=write)` / `mdcg_remember` / `cg(op=link)`），架构里另有自动钩子
  `session/event`（自动记忆 + 自动召回注入）。
- **最容易踩的一条分辨**：`ok: true` **不等于**写成功——**是否落盘只看 `committed`**；
  策略文件不可用或形状非法时写入 **fail-closed**（`policy_unavailable` / `policy_bad_shape`）；
  未配 `MDCG_TOKEN` 就是只读 `guest`。
- 召回＝词法（char-bigram + 四路 RRF + 同义扩展）+ 因果/时间图路（半衰期 30 天）；
  README 明说**当前明确不做语义向量检索**。
- 配置：`tools: 'core'` 默认只暴露 **2** 个工具（`cg` 36 op 与 `stg` 4 op）——正好就是本会话可见的
  `lingshu_cg` / `lingshu_stg`。这是「**工具数量直接变成每轮的 tool schema 成本**」的活证据。
  `'brain'|'all'` 会暴露 30 个；`mdcg.root` 留空＝用户级默认；`capability.enabled` 默认 false；
  `MDCG_SEMANTIC`、`MDCG_UNIFY_QUERY`、`MDCG_HOTCACHE`、`MDCG_RETRIEVAL_PIPELINE` 全部默认关。
- 锐边原文：**别把包内相对路径写进 `mdcg.root`**（如 `data/mdcg`）——pnpm 更新该包会把记忆连目录一起删掉；
  升级后必须重启长驻 MCP 进程（症状 `ImportError: cannot import name 'mint_auto_id' from 'md_cg.mdcg'`）；
  `mdcg_forget` / `mdcg_restore` / `mdcg_review_decide` 需 `can_admin`，`tools: 'all'` 也不自动暴露；
  「遗忘只能由显式 `cg(op=forget)` 发起、不做静默淘汰」。

**③ `dsh-context` = 只读仪表盘**：只投影官方 token-meter（`contextPressure` / `contextBreakdown`），
在时间轴上标出 compaction / prune 发生的位置（`✂`），展示 cache-hit rate。
**它自己不写记忆、不影响缓存、也没有 token 预算配置项。**

**结论：三个都不动，理由**

1. 三者**分工正交**，没有互相打架的配置。唯一的互斥是 billion-context 与「进程内扩展」
   （`billion-context-pi` / `opencode-acp`），而本机没装后者。
2. 第 8 项的实测账本正是 billion-context 的：98.3% 命中、净 +92.35M、14/17 次折叠回本
   ⇒ **压缩层正在赚钱，没有病灶。**
3. 灵枢已经跑在最省的档（`core`，2 个工具）。升到 `brain`/`all` 会把 30 个工具 schema 每轮塞进上下文
   ——**在没有明确需求之前那是纯成本**，而且会改变 system prompt 前缀。
4. 真正影响「进入上下文多少内容」的仍是已经在管的那三个旋钮：`maxInlineTokens`、pruner 阈值、
   以及压缩触发节奏。前两个第 2/3 项已核实**维持不动**。

**将来要动时的判据**

- 「想不起历史」⇒ 先看 `~/.dsh/.dsh-memory/data/mdcg/_access.log` 与 `_index.json` 里是否真有内容，
  再考虑 `tools: 'brain'`——**代价会立即体现在每轮 tool schema 上**。
- 「压缩太频繁/太贵」⇒ 看 `acp_cache` 的 `FOLD ECONOMICS`，再动 `nudgeGrowthTokens`。
- 动任何一项之前先读 billion-context 的 `GRAND LEDGER`，不要凭感觉调。

**还没验的（如实标注，没有猜测补齐）**：`@furongjun1999/dsh-memory` 的 30+ 项配置清单与
`…/dsh/cordis.patch.yml` 已于 2026-10-07 逐项读完（见下一节）；
`dsh-context/package.json` 内容**仍未读**（本次只读了它的 README 级说明）。

### 2026-10-07 · 第 7 项补完：灵枢 33 个配置键逐项体检 + 自动记忆实测

**起因**：上一节把「三个插件机制正交、都不动」的结论立住了，但留了一句「灵枢的 30+ 项完整配置清单
本次未读」。**没读过的配置清单里藏着不知道的开关** —— 结论虽然是对的，证据链却缺一环。

**① 清单位置（两个独立来源互相印证，无出入）**

- 真源 A（代码）：`lib/index.js:88-153` 的 `export const Config = z.object({...})`，每个键带 `.default(...)`。
- 真源 B（文档）：随包详细版 `docs/mdcg/README详细版_v0.4.10.md:650` 的「## 配置项」30 行表格。
- 规模：**12 个顶层叶子 + `memory` 7 + `mutual` 2 + `mdcg` 5 + `capability` 3 = 29 个可设叶子，
  加 4 个组键共 33 个键**（这就是「30+ 项」的实际构成）。
- 包位置与版本：`C:\Users\Z1848\.dsh\profiles\desktop\node_modules\@furongjun1999\dsh-memory`，**v0.7.1**。
  注意它在 **`profiles\desktop\node_modules`**（不是 `profiles\node_modules`），且 scope 名里没有
  「lingshu / memory」字样 —— **按名字搜索会漏掉它**，是按 `dsh.profile.bundles` 第 6 项才定位到的。

**② 33 个键的默认值（逐项过，实际全部处于默认）**

| 组 | 键与默认值 |
| --- | --- |
| 进程 | `serverName 'lingshu'`；`python` = `defaultPython()`（Windows 下 `python`，`MDCG_PYTHON` 可覆盖）；`moduleArgs ['-m','md_cg.mcp_server']` |
| 数据 | `dbPath 'data/lingshu.db'`（⚠️ 遗留键，**不存记忆**，只参与角色数据目录推导） |
| 身份 | `identity '灵枢'`；`env {}`；`charter 'v2.0-published'` |
| 工具 | `tools 'core'`（只暴露 2 个：`lingshu_cg` 34 op + `lingshu_stg` 4 op） |
| 超时 | `toolCallTimeoutMs 60_000`；`maxRetryDelayMs 30_000` |
| 容错 | `failOnStartupError false`；`roleplayEntryButton false` |
| `memory` | `userMessage true` / `assistantMessage false` / `toolResult false` / `importance 0.6` / `autoRecall true` / `autoRecallLimit 4`（范围 1~10）/ `desensitize true` |
| `mutual` | `enabled false` / `heartbeatMs 600000` |
| `mdcg` | `enabled true` / `root ''` / `actor 'dsh-memory'` / `tenant 'default'` / `clearance 'private'` |
| `capability` | `enabled false` / `python ''` / `args []` |

**「全部处于默认值」的证据（不是看文件没写就下结论）**：用户的
`%USERPROFILE%\.dsh\profiles\desktop\cordis.patch.yml`（220 行、14 个条目）里**没有** dsh-memory 条目；
插件自带的 `dsh\cordis.patch.yml`（**85 B**）只有 `- insert:` + `id` + `name`，**没有 `config`**
⇒ 每个键都落在代码默认值上。

**③ 自动记忆实测：确实在写**

- `_audit.jsonl` 最后 4 条：`{"op":"add","actor":"dsh-memory","session":"sess_4d2f124ce18d|sess_db460183f478",
  "layer":"contextual","role":"user","tenant":"default","clearance":"internal","unit":"record"}`。
- `contextual/` 共 **9 个节点**，最新 `mem_1791351594429_0f51fc.md`（10-06 22:39）；其余 8 层
  （anchor / structural / knowledge / goals / self / hippocampus / unresolved / rejected）**空**
  —— 自动记忆固定落 `contextual`，别的层只有显式 `cg(op=write)` 才写。
- `_forgetting.jsonl` 最新三条 verdict 全是 `ACCEPT`，理由原文 `重要度 0.60≥0.3`，importance `{"score":0.6,"from":"hint"}`。
- `_writelimit.json` 的 `sigs` **按用户消息文本去重**（每条签名带原话与节点 id）⇒ 同一句话重复说不会重复入库。
- 写入不受「六要素闸门」限制：那条闸门（`policy.json` 的 `required` / `required_kinds: ["text"]`）只针对
  `text` 类显式写入；自动记忆走 `mdcg_remember(gated=true)`，落层 `contextual`。
- 脱敏面有效：`policy.json` 的 `forbidden` 11 条含 `\bsk-[A-Za-z0-9_\-]{20,}`、`\btk_[0-9a-f]{8,}\b`、
  `mdcg1\.[A-Za-z0-9._\-]{20,}` —— **令牌本身永远进不了库**。

**④ 写入凭据从哪来（决定「升级后记忆还在不在」）**

用户级 / 机器级环境变量 `MDCG_TOKEN`、`MDCG_LEGACY_ENV_AUTH`、`MDCG_ROOT`、`MDCG_ACTOR`、
`MDCG_CAN_ADMIN`、`MDCG_POLICY_FILE` **全部未设**。答案在插件自己的
`lib\lib\token_store.js`，解析顺序：①`config.env.MDCG_TOKEN` ②进程 env ③**密钥环 `~/.mdcg/token`（0600）**
④都没有 → **首启自动签发一枚 designer 令牌**写入密钥环（`MDCG_AUTO_ISSUE=0` 可关掉自动签发）。

实测 `C:\Users\Z1848\.mdcg\` 里确有：`token`（75 B，10-03 02:51）、`_tokens.json`（512 B，哈希与元数据）、
`master.key`（44 B）、`theory.json`、`sustain/`。

⇒ **密钥环在插件包之外，pnpm 升级不会带走它**；但包内 `data/` 会被带走 ——
所以 `mdcg.root` 绝不能改指包内路径（那等于把记忆放在升级会删掉的地方）。

**⑤ 逐组判断：29 个叶子全部维持默认**

- 写入面 `memory.*`：只收真人消息（`assistantMessage` / `toolResult` 均关），噪音面最小；开那两项会让
  每条回复与每个工具结果都进库，而在 0.6 的 importance 阈值下它们大概率仍然 `ACCEPT` ⇒ **纯增量成本**。
- 召回面 `autoRecall: true` / `autoRecallLimit: 4`：注入块每次请求都进 system prompt，4 条是
  「上下文固定成本 vs 召回面」的折中；**调大直接抬高每个请求的固定成本**。
- `tools: 'core'`：升 `brain` / `all` 会把 30 个工具 schema 每轮塞进上下文，**在没有明确需求前那是纯成本**。
- `mdcg.clearance: 'private'` 与实际 principal `clearance=internal` **不冲突、也不该改**：principal 的密级
  由令牌决定（密钥环里那枚是 designer / internal），config 里的 `clearance` 是调用方声明。
- `mutual.enabled` / `capability.enabled` / `roleplayEntryButton` 三项都会额外起进程或遮挡 GUI，无需求不开。
- `failOnStartupError: false`：坏掉的灵枢不会拖垮 DSH 启动 —— 可靠性上是对的默认值。

**⑥ 这次体检顺带查出的两条日志事实**

- ★ `C:\Users\Z1848\.dsh\logs\dsh-memory-apply-error.log`（947 B，10-06 08:01 本地）：
  `[2026-10-06T15:01:59.470Z] apply failed: Error: cannot create effect on inactive context`，
  栈为 `Fiber.assertActive (cordis/lib/index.js:1133)` ← `Proxy.on (:373)` ←
  `installMemoryHooks (dsh-memory/lib/hooks.js:366)` ← `Object.apply (dsh-memory/lib/index.js:347)` ←
  `Fiber._reload (cordis/lib/index.js:1356)`。同一秒 `lingshu-bridge-debug.log` 记 `uptime=2s`
  ⇒ **热重载 dsh-memory 时，`apply` 里 await（起 python 子进程）期间 fiber 被停用，随后建 effect 抛错**：
  那一次重载后自动记忆钩子没装上，**除这条日志外没有任何症状**（对话照常），要到下次重启才恢复。
  ⇒ **动过灵枢插件或配置后必须重启 Harness，不要指望热重载**。这是上游缺陷，本项目记录而不修。
- `C:\Users\Z1848\.dsh\logs\lingshu-bridge-debug.log`（1054 B，11 行）：唯一异常为
  `2026-10-03T10:59:16.196Z exit code=1073807364`（0x40000004，被强制终止）+ 下一行
  `schedule retry 1/8 in 1000ms`（退避重连生效）；其余 exit 0 且 `disposed=true`（正常回收）。

**⑦ 一条「不要顺手优化」的警告（来自随包文档，值得抄在这里）**
`memory.autoRecall` 的注入块落在 `assembly.contexts`，宿主按**渲染后整段文本**去重，变了才 append 一条
`user/message` 快照（**append 语义，旧快照不会被替换**）。所以插件**每步都照旧 push**（内容没变也不跳过）：
跳过反而会在「有块 / 无块」之间跳变，实测每步各追加一份 ≈250 tok，长会话里会线性涨到 30k+ tok。
⇒ **不要为了「省 token」把它改成条件跳过** —— 那是把一个已知的线性成本，换成一个会让前缀失效的抖动。

**教训**：「清单未读」和「结论已定」可以同时成立，但**只有读过之后，结论才从判断变成证据**。
这次读完 33 个键的结果是结论没变（仍然全部不动），但顺带查出两件原本不知道的事：
写入凭据在包外密钥环（所以升级安全），以及热重载会让灵枢静默降级（所以改完必须重启）。
—— 换句话说，读清单的价值不在「可能推翻结论」，而在**它顺带暴露了什么**。
