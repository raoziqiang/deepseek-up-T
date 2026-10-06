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

**已装的能力 bundle（12 个）：** base、web-app、dshmarket、dsh-context、billion-context、
dsh-memory、better-sidebar、whale-widget，以及 4 个 experimental（Agent Teams、自动评审、定时、语音输入）。

## 已核实的抓手

| 抓手 | 位置 | 现状 |
| --- | --- | --- |
| `tool-ralph` | base 行 `disabled: true` | 默认关；base 注释给了 overlay 打开示例 |
| `session-query-sqlite` | base `openAt: never` | 会话全文搜索默认关闭 |
| `llm-pi-ai.providers` | 已用 | 加 Provider = 加一节 |
| `dsh-mcp-client` | 宿主包存在 | MCP 接入能力在手，未启用 |
| `dsh-skill` / `dsh-skill-filesystem` | 已挂载 | 技能目录机制在手 |
| `spill-policy` | `maxInlineTokens: 12500` | 大结果落盘阈值 |
| `dsh-tool-web` | `searchTimeoutMs: 60000` | 联网搜索与抓取 |
| `system-prompt` | `personaPrefix: ''` | 部署人格，可覆盖 |

## 待办

- [ ] 新增 Provider：往 `llm-pi-ai.providers` 加一节（`apiKeyEnv` + `api` + `baseURL` + `models`）
- [ ] 接入 MCP server，把外部工具变成本地 DSH 工具
- [ ] 按需开 `tool-ralph`
- [ ] 写自有 skill
- [ ] 调 Agent 行为：`personaPrefix`、`agent-presets`、`subagent.maxDepth`

## 验收

- 模型选择器出现新模型，且能真实完成一次对话。
- 新工具出现在工具目录，且调用返回预期结果。
- `node src/cli.mjs doctor` 中「patch 引用的包可解析」保持 OK。

## 记录

_（每次改动在此追加：改了什么 / 为什么 / 怎么验 / 怎么撤）_
