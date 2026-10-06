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

- [x] 开启会话全文搜索（含持久化 `path`）—— 2026-10-06 完成，见下方记录
- [ ] 重启 DSH 后做一次真实验收：搜一个只出现在历史对话正文里的词
- [ ] 用 `acp_cache` 量一次当前缓存基线，作为后续调参的对照
- [ ] 梳理 `spill-policy` / `tool-result-pruner` 阈值对长会话成本的影响
- [ ] 梳理斜杠命令与快捷键
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
