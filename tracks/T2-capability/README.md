# T2 · 能力扩展

> 模型、Provider、工具、Agent 行为都按自己的需要配。

## 现状

**模型侧已经接得比较满：**

- `llm-pi-ai` 上挂了 3 条 OpenCode Go 路由（`opencode-go-chat` / `-responses` / `-messages`），
  覆盖 `openai-completions` / `openai-responses` / `anthropic-messages` 三种 wire protocol，
  约 30 个模型；凭据走 `OPENCODE_GO_API_KEY`（存于 `.dsh/.credentials.yaml`）。
- 每条路由钉了稳定的 `x-opencode-session` 头（网关缺 session 会回 400）。
- `agent-default-model`：`opencode-go-chat` / `glm-5.3`（用户在 GUI 里改过；2026-10-07 的预检
  把它列成 L0 里唯一一处与上次不同项，从 `deepseek-account` / `deepseek-flash` / `reasoningEffort: high` 变来）。
- `agent-preset-registry`：`default: standard`、`selectedDefault: cordis`
  ⇒ **新会话跑的是 `preset-cordis`**，它与 `preset-standard` 的唯一差别是多一个 `tool-cordis`。
- `subagent`：`maxDepth: 2`（base/包默认 1）。`agent-team.maxMembers` 维持 bundle 自己写的 `8`（包作者默认 16）；把上限抬到 16 的仓库声明已在 **M6** 撤回。

**已装的能力 bundle（13 个）：** base、web-app、dshmarket、dsh-context、billion-context、
dsh-memory、better-sidebar、whale-widget，4 个 experimental（Agent Teams、自动评审、定时、语音输入），
以及本项目自建的 `dsh-up-t`（见 T4）。

## 已核实的抓手

| 抓手 | 位置 | 现状 |
| --- | --- | --- |
| `tool-ralph` | base 行 `disabled: true` | **M6 已撤回仓库声明**。`patches/` 里不再有这份开关，`dsht upgrade` 只核对还在目录里的声明 |
| `session-query-sqlite` | base `openAt: never` | ✅ 已由 T3 打开（会话全文搜索） |
| `llm-pi-ai.providers` | 已用 | 加 Provider = 加一节 |
| `dsh-mcp-client` | 宿主包存在 | MCP 接入能力在手，未启用 |
| `dsh-skill` / `dsh-skill-filesystem` | 已挂载 | ✅ 已用它写了项目 skill（2026-10-06），见下方记录 |
| `spill-policy` | `maxInlineTokens: 12500` | 大结果落盘阈值 |
| `dsh-tool-web` | `searchTimeoutMs: 60000` | 联网搜索与抓取 |
| `system-prompt` | base 已设 `personaPrefix` / `personaSuffix` | **不动**：base 自带「你是一个由 `{{model}}` 驱动的编码 agent」+「你的工作目录是 `{{cwd}}`」；锐边见下方记录 |
| `agent-team` | bundle 插入行 `maxMembers: 8` | **M6 已撤回仓库声明**（2026-10-07 曾把上限写成 16）。仓库现状回到 bundle 的 8 |
| `agent-loop.maxParallelToolCalls` | 未设 ⇒ 默认 `10` | **不动**：没有「并行度不够」的证据，调它只是赌 |
| `subagent.maxActiveSubagents` | 未设 ⇒ 默认 `8` | **不动**：见下方记录（一次性运行不受它限制，所以工作流扇出不会撞它） |
| `product-analytics` | base `enabled: true`（界面无开关） | **M6 已撤回仓库声明**。关闭埋点不再是 `patches/` 里的权威声称 |

## 待办

- [ ] 新增 Provider：往 `llm-pi-ai.providers` 加一节（`apiKeyEnv` + `api` + `baseURL` + `models`）
- [ ] 接入 MCP server，把外部工具变成本地 DSH 工具
- [x] **写自有 skill** —— 2026-10-06 完成：`.dsh/skills/deepseek-up-t/SKILL.md` + 两条 junction + 离线单测 9/9，见下方记录
- [x] **M6：撤回三份 T2 开关的仓库声明** —— `tool-ralph`、产品埋点关闭、`agent-team.maxMembers` 16。只删 `patches/` 里的声明，本机 `cordis.patch.yml` 不动。见下方记录
- [x] **调 Agent 行为：先把「Agent 行为」到底是哪些旋钮读清楚** —— 2026-10-07 完成（四个 preset 的真实差异、`system-prompt` 全部键与两个陷阱、`subagent` 的 depth 与并发两道闸门、`agent-loop.maxParallelToolCalls`、dump 里一长串 `[disabled]` 的来历），见下方记录
- [ ] 新增 Provider / MCP —— 用户已选「暂时跳过」，需要目标再开
- [ ] **另存一份 preset**：新建/覆盖 preset 只能靠 bundle 补丁（插入一行 `@deepseek-ai/dsh-agent-preset` 或按 id 覆盖）再用 `plugin_manager` 装进 profile；现在只是把它记清楚了，没有目标就不动手

## 验收

- 模型选择器出现新模型，且能真实完成一次对话。
- 新工具出现在工具目录，且调用返回预期结果。
- `node src/cli.mjs doctor` 中「patch 引用的包可解析」保持 OK。

## 记录

### 2026-10-15 · M6：撤回三份 T2 开关的仓库声明

`patches/` 里的 L0 文件是权威声称：`dsht upgrade` 会拿每一份去对现场 `cordis.patch.yml`。对不上就报「现场 cordis.patch.yml 里没有这一条」（声明了，现场没有），退出码 1。这三份开关已经不再作为仓库声明存在：

| 撤回的声明 | 它曾经声称的现场 |
| --- | --- |
| `T2-enable-ralph.yml` | `tool-ralph` `disabled: false` |
| `T2-product-analytics-off.yml` | `product-analytics` `enabled: false` |
| `T2-agent-team-members.yml` | `agent-team.maxMembers: 16` |

三份文件已删除。`dsht upgrade` / `dsht accept` 的清单里不再有它们，所以升级检测不会再为这三行报「声明了但现场没有」。

**这次只动仓库。** 本机 profile 的 `cordis.patch.yml` 没有改，也没有走任何 L0 落盘路径。机器上如果还留着当年写进去的行，那是现场自己的事；仓库不再拿一份声明去要求它。

下面 2026-10-06 / 2026-10-07 的记录保留侦察结论。文中出现的那三个文件名是当时的路径，文件已经不在 `patches/` 里。

### 2026-10-06 · 侦察：`tool-ralph` 是一个被关掉的「全新 agent 迭代」能力

**它是什么**（读 `@deepseek-ai/dsh-tool-ralph` 的 `README.zh.md`，10.6KB）

`ralph` 针对一个**不可变目标**跑一串**全新子 agent**：每个 Round 一个全新的子 agent 在共享工作区里干活，
Round 之间只传一份**有界结构化交接**（`maxHandoffChars` 默认 16384 字符），
**父级对话与先前子 agent 的会话绝不会被复制进新的 Round**。

这一条对长会话就是数量级的效率改善：上下文成本从 `O(轮数 × 累积历史)` 变成 `O(轮数 × 交接上限)`。
工作区（磁盘）是跨 Round 的长期记忆。

- 模型提交 `{ objective, maxRounds? }`，调用**阻塞**到整轮结算。
- 终态：`complete` / `blocked` / `budget-limited`，附带最后一份有界报告与已启动的 Round 数。
- 报告的 `status` 必须是 `continue` / `complete` / `blocked` 之一，且随状态校验不同字段
  （`continue` 要有后续步骤且阻塞为空，`complete` 要有证据且没有后续步骤，`blocked` 要有具体阻塞）。
  无效或超长报告会让整轮**失败**，不会被截断、也不会被误判成「轮数用尽」。
- 配置：`subagentProvider`（默认 `spawn`）、`maxRounds`（README 默认 256，base 行设的是 **64**）、
  `maxHandoffChars` / `maxResultChars`（默认 16384）。
- 提供方必须存在、支持结构化输出、且报告 `inheritsParentContext: false`；不满足时
  **在任何 Round 开始前直接报错** ⇒ 配错也是安全失败，不会静默乱跑。

**base 为什么默认关着**（这段理由必须照抄，不能当成遗漏）

base 的注释原话：该工具的描述把 `ralph` 限制在「人类明确要求的运行」上，而且**完成是 worker 自我报告，
不是独立评估**。所以它默认 `disabled: true`，并给出恢复用的 overlay 示例。

也就是说：`ralph` 的「做完了」只是子 agent 自己说的，没有任何独立验证。
它适合「用户明确要求全新 agent 迭代」的场景，不适合当作默认的长期工作方式
（普通长期工作应该用 `goal` 工具，有界委派用 `subagent` / `workflow`）。

**当时做了什么**（声明文件已在 M6 删除）

当时的声明只写一行，不给 `config`：

```yaml
- id: tool-ralph
  disabled: false
```

**为什么只写一行**：patch 是按行键合并的（同 id 命中已存在的行，只覆盖给出的键），
而 `config` 一旦给出是**整体替换**。所以不给 `config` 就继承了 base 的
`subagentProvider: spawn` + `maxRounds: 64` —— 比 README 的默认 256 更保守。
（这一点也是本项目 `patches/README.md` 里「L0 声明」那一类的意义所在。M6 之后仓库里现存的 L0 声明都给了 `config`。）

**当时怎么验的**（只读；下面这条命令指向的文件已在 M6 删除）

```
node src/cli.mjs precheck --patch patches\T2-enable-ralph.yml
  退出码 0 · 问题 0
  与上一次预检相比：0 新增 / 0 移除 / 1 修改
      ~ 条目 tool-ralph
          - disabled: true
          + disabled: false
```

**结论：能力本身可用且组合干净，但这是一次会改变「模型能看到什么工具」的行为开关，
所以把声明和证据备好，等用户决定是否落盘 —— 不擅自替用户改 Agent 的行为边界。**

**当时怎么落盘 / 怎么撤**（历史步骤。M6 已撤回仓库声明：不要按这里改本机 `cordis.patch.yml`，也不要把声明文件加回 `patches/`。）

```powershell
# 落盘前先快照
node src/cli.mjs snapshot create -m "T2 ralph 落盘前"
# 往现场 cordis.patch.yml 末尾追加那两行，然后
node src/cli.mjs precheck
node src/cli.mjs baseline write
# 撤：删掉那两行，或 snapshot restore <id> --yes
```

`cordis.patch.yml` 没有热重载，落盘后需要重启 DSH 才生效。

### 2026-10-06 · 写项目自有 skill：把「怎么改造 DSH」变成模型能自己读到的规范

**为什么值得做**：这个项目的作业规范（四层改造面怎么选、六步环怎么走、哪些红线不能碰）
过去只存在于 `docs/` 与人的记忆里。skill 是 DSH **原生**的「按需加载规范」机制——
不需要新插件、不需要重启、不需要改安装包，纯 L1/文件系统层。

**机制（读 `@deepseek-ai/dsh-skill-filesystem` 的 `README.zh.md`，11,035 字节）**

扫描根按 rank 顺序（`projectRoot` = 含 `.git` 的最近祖先，没有则用 cwd）：

| Rank | 来源 | 路径 |
| --- | --- | --- |
| 100 | `project-dsh` | `<projectRoot>/.dsh/skills` |
| 200 | `project-agents` | `<projectRoot>/.agents/skills` |
| 300 | `custom` | `Config.customSkillDirs` |
| 400 | `user-dsh` | `<dshHome>/skills`（跳过它的 `.system`） |
| 500 | `user-agents` | `<agentsHome>/skills` |
| 600 | `bundledSkillDir` | 配置后才扫 |

- 只认扫描根**顶层**的 `<name>/SKILL.md` 或 `<name>.md`；**刻意不支持嵌套** `**/SKILL.md`。
- frontmatter 必填 `name`（kebab-case）与 `description`；可选 `whenToUse`、`metadata`、
  `disable-model-invocation`、`user-invocable`。
- **目录与正文生命周期分离**：发现阶段解析 frontmatter，每次加载重读正文 ⇒ 改正文不需要任何缓存失效。
- Chokidar 监视现有根（深度 1），**不存在的根会被逐段探测直到出现**；
  第一方 `write`/`edit` 命中受监视 skill 时直接让提供方失效。
- 失败模式是静默的：**frontmatter 非法 / name 不合规 / 调用键写法非法 ⇒ 整个 skill 被丢弃**，
  模型目录只看到「没有这个 skill」，分不清「不存在」与「无效」。

**做了什么**

1. `.dsh/skills/deepseek-up-t/SKILL.md`（随仓库版本化）——内容就是本项目的作业规范：
   四层改造面表 + 判据、L0 patch 的两条硬规则（尤其 **`config` 是整体替换**）、六步环、
   `dsht` 全部命令、6 条红线、两个语义陷阱（`inactive` ≠ 关闭、base 的 `disabled: true` 是中性的）、
   文档索引、提交与记录约定。
   另外把「**查事实以 `app.asar` 为准**（junction 那棵树是另一个构建）」「不要为了看效果 boot 实例」
   这些踩过的坑写进了红线 —— skill 的价值就是把教训变成下一次的默认。
2. 两条 junction，让它无论从哪个目录开会话都能被扫到：
   - `<项目>/.dsh/skills/deepseek-up-t`（rank 100，cwd 在项目内时命中）
   - `$DSH_HOME/skills/deepseek-up-t`（rank 400，用户级，任何目录都命中）
   正文真源只有仓库里那一份，junction 保证不会出现两处副本漂移。
3. `test/skill.test.mjs`（**9/9 通过**）——把上面那些「静默失败」全部离线钉死：
   bundle 位于扫描根顶层、frontmatter 必须在文件开头、`name` 是 kebab-case 且等于目录名、
   `description` 非空、可选调用键是严格布尔拼写、skills 根下没有嵌套 `SKILL.md`、
   **两条 junction 都 `realpathSync` 到同一个仓库目录**、
   正文里的关键命令仍在、**正文引用的项目内文档全部存在**（最后一条防的是文档改名后指引读到空气）。

**怎么验的**：`node test/skill.test.mjs` → 9/9；`test/upgrade.test.mjs` 与 `test/plugin.test.mjs`
一并回归通过（未受影响）。

**还没验的（必须如实说）**：**当前这个会话没能立刻加载这个 skill** ——
`skill(name: "deepseek-up-t")` 返回 `unknown or no longer available`，
而那两条 junction 是**会话启动之后才创建的根**。按 README 的说法缺失根会被逐段探测，
但至少在两分钟内没有生效。所以「新根会被运行时接住」这条**本机尚未验证**，
要等一次重启（或更长的探测窗口）才能确认；在此之前，skill 的**格式合规性**是离线钉死的，
**可发现性**不是。这条结论写在这里，避免以后把它当成已验证的事实。

### 2026-10-06 · 关闭桌面端产品埋点（经用户确认后落盘）

**为什么这是本项目该管的事**：`@deepseek-ai/dsh-client-product-analytics` 的 README 原文是
「桌面端默认通过现有 OTel 产品导出器上报指定交互，**不提供用户操作入口**」，
而 `product-analytics` 的 `enabled` **默认 true**。也就是说：这是一项**默认开启、
界面上关不掉**的行为，而它恰好只是一个普通配置行 ⇒ 正好落在 L0 改造面上。

**上报什么**（README 摘要）：公共字段 `device_id` / `user_id` / `os_version` / `app_version`；
事件有欢迎页曝光、消息提交（`msg_type` / 模型 / 显式思考强度 / `run_mode`）、模型与思考强度切换、
插件开关与安装结果、会话分叉。**API key、账户令牌、提示词和模型回复都不是事件字段**；
采集**不修改模型请求**（对 KV Cache 无影响）；普通 Web 客户端不装配这两个服务。

**这是一次「用户的选择」，不是工程判断**：所以这份声明在用户拍板之前
**刻意以「未应用的提案」形态在 `patches/` 里躺了一段时间**。副作用值得记下来——
`dsht upgrade` 把它如实报成「现场 cordis.patch.yml 里没有这一条」并**退出码 1**。
那不是 bug：`patches/` 里的声明是**权威描述**（claim），不是建议；放进去就等于声称
「现场应该是这样」。这条语义以后要记住：**只想提建议时别放 `patches/`。**

**当时怎么落的**（历史步骤，严格走六步环；声明文件已在 M6 删除，不要再按这里改本机 profile）：

1. `node src/cli.mjs snapshot create -m "T2 关闭产品埋点 改动前"`
   → `20261006-084554-T2-关闭产品埋点-改动前`。
2. `precheck --patch` 对着当时的产品埋点声明验过（该文件已在 M6 删除）：退出码 0、问题 0、
   `~ 条目 product-analytics` / `- enabled: true` / `+ enabled: false`。
3. 追加到 `$DSH_HOME/profiles/desktop/cordis.patch.yml` 末尾。
   **落盘前后的字节事实**：8130 B / 206 行 → **9138 B / 221 行**，行尾 LF，
   **首三字节 `23 20 59`（`# Y`）⇒ 无 BOM**（用 `AppendAllText` + `UTF8Encoding($false)`）。
4. `node src/cli.mjs precheck` → **退出码 0、问题 0**。
   注意它报的是「与上一次预检相比：组合结果完全一致」——这是**对的**，
   因为上一次预检就是带 `--patch` 的候选预检，两者本就该相同。
5. 直接查组合结果 `state/probe-dump.txt:530-535` 确认：
   ```
   - id: product-analytics
     name: '@deepseek-ai/dsh-client-product-analytics'
     disabled: !!js ctx.get('profileContext')?.name !== 'desktop'
     config:
       enabled: false
       appVersion: !!js process.env.DSH_CLIENT_VERSION
   ```
   `appVersion` 被保留 ⇒ 印证了「**patch 按 id 整体替换该行 config**」这条规则，
   也说明声明里把 `appVersion` 一起写出来是必需的（只写 `enabled` 会把它抹掉）。
6. `node src/cli.mjs baseline write` → **13 个 bundle / 14 条 patch**。
   随后 `upgrade` 的四份 L0 声明**全部 `OK 声明与现场一致`**，漂移消失。

**关掉之后会发生什么**：不读取埋点身份、不接收新事件；
但**导出器仍然挂载**，已入队的事件仍可能被导出（README 明说「关闭只停止新采集，
不清空导出器队列」）。**不影响 `session-telemetry-otel`**——那是**独立策略**
（`mode: FEEDBACK_ONLY`），只在用户显式提交反馈后才导出。
整进程一键退出另有环境变量通道 `DSH_TELEMETRY_DISABLED`（任何非空值，含 `'0'`/`'false'`），
但它需要改启动方式，而本次只改配置。

**怎么撤**：`node src/cli.mjs snapshot restore 20261006-084554-T2-关闭产品埋点-改动前`
——注意它同样需要重启 DSH 才失效，`cordis.patch.yml` 没有热重载。

### 2026-10-07 · 把「Agent 行为」读清楚：四个 preset、两道闸门、一长串 `[disabled]` 的来历；并把 Agent Teams 的名字上限 8 抬到 16

待办上只剩「调 Agent 行为：`personaPrefix`、`agent-presets`、`subagent.maxDepth`」这一条，
而这三个词**都不是旋钮名**（一个是键、一个是包的类别名、一个是键）。所以这一步先不「调」，
先把它们各自是什么读成一张有默认值、有类型、有超限行为的表——没有表的「调」只能靠感觉。

**三个取证来源（都不许靠猜）**

1. `node src/cli.mjs precheck` 的组合结果 `state/probe-dump.txt` —— 这是**权威**：
   所有 bundle 与用户 L0 叠加之后的最终每一行。
2. **在用安装包**里各包自己的 `README.zh.md`。抽法：
   `node src/cli.mjs asar cat /dsh/node_modules/<pkg>/README.zh.md --out D:\Z1848\Temp\<k>.md`。
   **教训**：PowerShell 里 `Get-Content -Raw` 读 UTF-8 中文文档会乱码，乱码不是内容问题，
   是量具问题；`asar cat` 落盘再用文件工具打开就正常。
3. 归档里的 **bundle patch 文件本身**（bundle 是怎么把这一行挂进来的）。

**① dump 里那一长串 `[disabled]` 不是缺失能力，是「谁挂了这一行」**

`agent-instructions`、`plan-mode`、`command-goal`、`command-compact`、`skill-filesystem`、
`skill-badge`、`tool-subagent`、`tool-subagent-fork`、`tool-subagent-control`、
`tool-subagent-list-agents` 在顶层全是 `[disabled]`，看着像十个坏掉的开关。实际上
**这些能力都活在 preset 的插件列表里**（每个 preset 自己挂一份），顶层那一份关掉是为了
避免同一个能力被注册两次。两条独立证据：

- 四个 preset 的子插件清单里都有它们（见下表）；
- 本会话里 plan 模式、goal、skill、subagent / Agent Teams 工具**全部在线** ⇒ 生效的是
  preset scope 里那一份，不是顶层这一份。

四个 `tool-subagent*` 还多一层原因，
`@deepseek-ai/dsh-experimental-agent-team-profile/cordis.patch.yml` 开头就写着：

> `# Experimental Agent Teams profile layer. Apply after dsh-base so these replacements`
> `# keep direct delegation and coordination on the Team tools.`

即**它故意关掉直连委派，让协调走 Team 工具**。

⇒ **教训：dump 里的 `[disabled]` 说的是「谁挂了这一行」，不是「这个能力有没有」。**
看到它先去找同一个 id 在不在某个 preset / 子插件列表里，不要当成待修的漏洞。

**② 四个 preset 的真实差异（比名字小得多）**

| preset | 子插件数 | 与 `standard` 的差异 |
| --- | --- | --- |
| `preset-standard` | 32 | 基准 |
| `preset-cordis` | 33 | **只多一个 `tool-cordis`** |
| `preset-ptc` | 33 | **只多一个 `tool-presentation`** |
| `preset-minimal` | 7 | 只有 `persistent-bash` / `persistent-pwsh` / `persistent-shell` / `pty` / `terminal-bash` / `terminal-pwsh` |

`minimal` 缺的是 `tool-fs`、`tool-fs-search`、`tool-bash`、`tool-pwsh`、`tool-web`、
`tool-todo`、`tool-skill`、`tool-subagent*`、`compaction`、`planning` 等 —— 它不是「轻量」，
是**没有文件工具**，别误选。

`agent-preset-registry`（README 实读）：`default` **必填**（部署默认 preset ID）；
`selectedDefault` 是 **volatile 字段**，保留**用户**的默认值，新会话优先用它；
注册表**不写任何声明** —— 新建 preset 或覆盖内置 preset 只能靠 bundle 补丁
（插入一行 `@deepseek-ai/dsh-agent-preset`，或按该行 id 写覆盖补丁），再用 `plugin_manager`
装进 profile。所以「另存一份 preset」是有路可走的，只是现在没有目标，记下来即可。

**③ `system-prompt` 的全部键，与两个不该碰的陷阱**

| 键 | 默认 | 位置 |
| --- | --- | --- |
| `includeHarnessIdentity` | `true` | 顺序 −1000，第一方固定开场白 |
| `includeRuntimeContext` | `true` | 运行时上下文 |
| `personaPrefix` | `''`（**但 base 设了值**） | 顺序 `0`，在第一方指导**之前** |
| `personaSuffix` | `''`（**但 base 设了值**） | 顺序 `10200`（`deployment:persona-suffix`），在第一方指导**之后** |
| `toolOrder` | 无 | 工具引导的顺序 `100–199` |

base 已经在用它，现值（dump `:500-504`）：

```yaml
personaSuffix: Your working directory is {{cwd}}.
personaPrefix: You are a coding agent powered by the {{model}} model.
```

- **陷阱一（`toolOrder`）**：必须**恰好**含一个 `'<unlisted-tools>'` 其余项标记。形状不合规
  在**配置加载时**就抛错；而已列名字没有对应的已注册工具会让**每一次 `assemble()` 被拒绝**
  —— 危险点在首轮才暴露，不在启动时。**所以这个键不动。**
- **陷阱二（严格插值）**：未知 `{{x}}`、已注册但无值、格式错误的完整组都会抛错；
  孤立的 `{{` 后面没有 `}}` 按字面量通过；替换值绝不再扫描一次。

**决定：不动。** 理由不是「默认值挺好」，而是**要长期注入的自定义人格有更合适的载体**：
项目级说明应该放指令文件（`agent-instructions` 在 preset 里挂着，`maxBytes: 65536`），
它**按目录作用域**；而 `personaPrefix` 是**每个会话都生效**的全局提示词。用全局机制解决
局部问题，等于把「这个项目怎么做事」泄漏到跟这个项目无关的会话里，还平白动一次所有会话
的提示词前缀（KV Cache 前缀变更）。

**④ 两道不同的闸门（最容易混为一谈的地方）**

| | `subagent.maxActiveSubagents` | `agent-team.maxMembers` |
| --- | --- | --- |
| 默认 | `8`（未设） | bundle 写死 `8`（包默认 16） |
| 语义 | **同时在世的可续接子代理数** | **一支团队累计创建过的 teammate 数** |
| 计数对象 | 存活名额（新建/冷恢复前预占，handle 释放后归还） | 不可变 roster 条目，**含创建失败的** |
| 超限行为 | `ACTIVATION_LIMIT_REACHED`，**不排队** | `TeamError('Team member limit N reached', 'TEAM_MEMBER_LIMIT')` |

- `subagent.maxDepth`：用户已设 **2**（包默认 1；深度 `0` 禁止继承该设置的委派，`1` 只允许
  直接子代理，工具显式深度含 `provider-managed` 优先）。**不动** —— 2 已覆盖「再派一层」。
- `agent-loop.maxParallelToolCalls` 默认 `10`。**不动** —— 没有「并行度不够」的证据；
  改成 `1` 是全线变慢，改大是赌限流。
- `subagent.maxActiveSubagents` 默认 `8`。**不动** —— README 原文说它只约束**可续接**的存活
  子代理，**一次性运行与外部提供方不受此限制**，所以工作流扇出不会撞它；会撞它的场景是
  「同时挂着 8 个以上常驻子代理」，那是资源问题，不是能力问题。

**⑤ 真正动的一处：`agent-team.maxMembers: 8 → 16`**

- **为什么**：`@deepseek-ai/dsh-experimental-agent-team-profile` 这个 bundle 用自己的 patch 层
  插入 agent-team 行并写死 `maxMembers: 8`，而该包 README.zh.md 的默认值是 **16** ——
  bundle 比包作者更保守。真正决定值不值得改的是名额语义：**每支团队累计、含创建失败的成员、
  名字永不复用**（`lib/index.js:564`
  `if (state.members.length >= this.maxMembers) throw new TeamError(\`Team member limit ${this.maxMembers} reached\`, "TEAM_MEMBER_LIMIT");`）。
  所以 8 不是「同时最多 8 个在跑」，而是「这支团队**一辈子最多 8 个名字**」，而 roster 要挺过
  崩溃与重启；长会话里反复换人就会先把这 8 个名字用完，撞上限时连一次失败重试都烧掉一个名字。
  恢复包作者自己的 16 **只抬天花板**，不改任何默认行为（名额只在真的创建 teammate 时才消耗）。
- **怎么落的**（六步环）：① 快照 `20261006-231214-T2-Agent-Teams-成员上限-8-16-改动前`；
  ② 追加到现场 `cordis.patch.yml` 末尾（第 15 条，含一段写明理由的注释）；
  ③ `node src/cli.mjs precheck` → **退出码 0、问题 0**，且它自己报出
  「与上一次预检相比：0 新增 / 0 移除 / **1 修改** —— `~ 条目 agent-team` / `- maxMembers: 8` /
  `+ maxMembers: 16`」，这是**唯一差异**的直接证据；
  ④ 查组合结果确认另外四个字段（`maxTasks: 256` / `maxPendingMessagesPerMember: 64` /
  `maxMessageBytes: 65536` / `disposalTimeoutMs: 5000`）**原样保留**；
  ⑤ 当时写入声明文件（M6 已删除）；⑥ `baseline write` 重新固化。
- **为什么五个字段全写**：patch 按 id **整体替换**该行的 `config`（不是深合并）。只写
  `maxMembers` 会让另外四个退回插件代码默认值 —— 它们恰好也相等，但不能靠这种巧合。
- **撤**：删掉现场那一条，或
  `node src/cli.mjs snapshot restore 20261006-231214-T2-Agent-Teams-成员上限-8-16-改动前 --yes`；
  同样需要重启才生效（profile 层没有热重载）。

**教训（比结论重要）**

1. 「调 X」这种待办，先把 X 展开成**有默认值、有类型、有超限行为**的旋钮表；没表的「调」是感觉。
2. 一个 `[disabled]` 有三种完全不同的含义：**能力不存在** / **被部署故意关掉** / **顶层副本让位给
   preset 副本**。分不清就会去修一个没坏的东西。
3. 同一类限制可能有两道闸门（**累计名额** vs **并发存活**），升错那道等于什么都没做。
4. 读中文包文档用 `asar cat` 落盘再读；`Get-Content -Raw` 的乱码是量具问题，不是内容问题。
