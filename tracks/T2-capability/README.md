# T2 · 能力扩展

> 模型、Provider、工具、Agent 行为都按自己的需要配。

## 现状

**模型侧已经接得比较满：**

- `llm-pi-ai` 上挂了 3 条 OpenCode Go 路由（`opencode-go-chat` / `-responses` / `-messages`），
  覆盖 `openai-completions` / `openai-responses` / `anthropic-messages` 三种 wire protocol，
  约 30 个模型；凭据走 `OPENCODE_GO_API_KEY`（存于 `.dsh/.credentials.yaml`）。
- 每条路由钉了稳定的 `x-opencode-session` 头（网关缺 session 会回 400）。
- `agent-default-model`：`deepseek-account` / `deepseek-flash` / `reasoningEffort: high`。
- `agent-preset-registry`：`default: standard`、`selectedDefault: cordis`。

**已装的能力 bundle（13 个）：** base、web-app、dshmarket、dsh-context、billion-context、
dsh-memory、better-sidebar、whale-widget，4 个 experimental（Agent Teams、自动评审、定时、语音输入），
以及本项目自建的 `dsh-up-t`（见 T4）。

## 已核实的抓手

| 抓手 | 位置 | 现状 |
| --- | --- | --- |
| `tool-ralph` | base 行 `disabled: true` | ✅ **已落盘**（2026-10-06，现场 `cordis.patch.yml` 第 12 条，重启后生效）；预检 0 问题、只改 1 行，row-key 合并已实测验证 |
| `session-query-sqlite` | base `openAt: never` | ✅ 已由 T3 打开（会话全文搜索） |
| `llm-pi-ai.providers` | 已用 | 加 Provider = 加一节 |
| `dsh-mcp-client` | 宿主包存在 | MCP 接入能力在手，未启用 |
| `dsh-skill` / `dsh-skill-filesystem` | 已挂载 | 技能目录机制在手 |
| `spill-policy` | `maxInlineTokens: 12500` | 大结果落盘阈值 |
| `dsh-tool-web` | `searchTimeoutMs: 60000` | 联网搜索与抓取 |
| `system-prompt` | `personaPrefix: ''` | 部署人格，可覆盖 |

## 待办

- [ ] 新增 Provider：往 `llm-pi-ai.providers` 加一节（`apiKeyEnv` + `api` + `baseURL` + `models`）
- [ ] 接入 MCP server，把外部工具变成本地 DSH 工具
- [x] **落盘 `tool-ralph`** —— 2026-10-06 完成（用户确认后落盘），见下方记录
- [ ] 写自有 skill
- [ ] 调 Agent 行为：`personaPrefix`、`agent-presets`、`subagent.maxDepth`

## 验收

- 模型选择器出现新模型，且能真实完成一次对话。
- 新工具出现在工具目录，且调用返回预期结果。
- `node src/cli.mjs doctor` 中「patch 引用的包可解析」保持 OK。

## 记录

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

**做了什么**

`patches/T2-enable-ralph.yml` 声明式副本 —— 只写一行，不给 `config`：

```yaml
- id: tool-ralph
  disabled: false
```

**为什么只写一行**：patch 是按行键合并的（同 id 命中已存在的行，只覆盖给出的键），
而 `config` 一旦给出是**整体替换**。所以不给 `config` 就继承了 base 的
`subagentProvider: spawn` + `maxRounds: 64` —— 比 README 的默认 256 更保守。
（这一点也是本项目 `patches/README.md` 里「L0 声明」那一类的意义所在。）

**怎么验的**（只读，没有落盘）

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

**怎么落盘 / 怎么撤**

```powershell
# 落盘前先快照
node src/cli.mjs snapshot create -m "T2 ralph 落盘前"
# 往现场 cordis.patch.yml 末尾追加那两行，然后
node src/cli.mjs precheck
node src/cli.mjs baseline write
# 撤：删掉那两行，或 snapshot restore <id> --yes
```

`cordis.patch.yml` 没有热重载，落盘后需要重启 DSH 才生效。
