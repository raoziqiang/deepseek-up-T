# T3 · 使用效率

> 同样的活，少花时间、少花 token。

## 现状与抓手

| # | 抓手 | 位置 | 现状 / 判断 |
| --- | --- | --- | --- |
| 1 | **会话全文搜索** | `session-query-sqlite.openAt` | 默认 `never` ⇒ 侧边栏只能按标题和工作区名匹配。可改 `first-search` 或 `startup` |
| 2 | 上下文落盘阈值 | `spill-policy.maxInlineTokens` | `12500` |
| 3 | 工具结果预压缩 | `tool-result-pruner` | `thresholdChars: 8192` / `headChars: 4096` / `tailChars: 1024` |
| 4 | 会话标题质量 | `session-title-llm` | `targetWords: 5` / `targetCjkCharacters: 10` / `maxInputBytes: 4096` / `maxOutputTokens: 64` |
| 5 | 交互习惯 | `ui-conversation.busyEnter` | 已设 `steer` |
| 6 | 快捷键 / 斜杠命令 | `dsh-client-ui-input-trigger`、`dsh-commands` | 未梳理 |
| 7 | 记忆策略 | `@furongjun1999/dsh-memory`、`billion-context` | 已装，写入/召回策略未梳理 |
| 8 | 缓存经济学 | `acp_cache` | 可读缓存命中率与压缩代价 |

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

- [ ] 开启会话全文搜索（含持久化 `path`）
- [ ] 用 `acp_cache` 量一次当前缓存基线，作为后续调参的对照
- [ ] 梳理 `spill-policy` / `tool-result-pruner` 阈值对长会话成本的影响
- [ ] 梳理斜杠命令与快捷键
- [ ] 梳理记忆插件的写入与召回

## 验收

- 在侧边栏搜索一个只出现在历史对话正文里的词，能命中。
- 给一个固定任务，改前改后对比耗时与 token 消耗。

## 记录

_（每次改动在此追加：改了什么 / 为什么 / 怎么验 / 怎么撤）_
