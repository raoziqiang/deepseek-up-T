---
name: up-t-memory
description: deepseek-up-T 的跨会话项目记忆契约（对齐 Grok Build）：何时读笔记、何时写笔记、写到哪、什么不许写。与灵枢会话召回并存，互不替代。做本仓库长期约定/决策沉淀前先读这份。
whenToUse: 在 deepseek-up-T 仓库里开工或收尾时；用户要求记住约定、决策、项目事实时；需要跨会话延续本项目上下文时。
---

# up-t-memory · 项目笔记契约

这份 skill 管的是**跨会话的项目笔记**，不是会话内自动召回。
会话召回继续走灵枢（`@furongjun1999/dsh-memory` / mdcg）。两套并存：

| 系统 | 存什么 | 位置 |
| --- | --- | --- |
| 灵枢 | 会话里自动记住的上下文碎片 | `~/.dsh/.dsh-memory/data/mdcg` |
| 本 skill | 人手（或模型按契约）写下的项目约定与决策 | 见下 |

## 存哪儿

- **项目范围**：`memory/project/topics/<topic>.md`（随仓库版本化）
- **全局偏好**：`$DSH_HOME/up-t/memory/<topic>.md`（本机，不进仓库）

一主题一文件。文件名用 kebab-case，例如 `module-host.md`、`asar-red-lines.md`。

## 何时读

在本仓库开始或恢复相关工作前，先扫一遍与当前主题相关的 `memory/project/topics/`。
当前对话里的明确指令**优先于**任何笔记。

## 何时写

只写跨会话仍有用的东西：

- 团队/个人在本仓库里稳定下来的约定
- 已拍板的决策与理由（为什么选这条路）
- 文档里还没有、但以后会反复用到的项目事实（子系统在哪、哪条命令跑哪套测试）

## 不许写

- 密钥、令牌、凭据、私人联系方式
- 一次性任务进度、临时猜测、未验证的结论
- 仓库文档（`docs/`、`tracks/*/README.md`、`patches/`）里已经写清楚的事实 —— 笔记指向文档，不复制正文

## 模块宿主

笔记目录由 `modules/memory` 在热启动时确保存在。
配置见项目根 `up-t.config.yml`；契约细节见 `docs/07-modules.md`。
本轮**不做**回合后自动摘录，也没有 `/dream` 归并 —— 那些是后续里程碑。

## 与改造作业规范的关系

改 DSH 本身（四层选层、快照、落盘红线）仍读 `deepseek-up-t` skill。
本 skill 只补「长期使用时把教训落成可复用笔记」这一环。
