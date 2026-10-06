# 04 · 路线图

五条工作线，全部已确认要做。每条线都标出**当前状态**、**已核实的抓手**、**候选动作**、**验收方式**。
候选动作按「改动小、收益大、升级后能幸存」排序——上面的先做。

---

## T1 · 外观与体验

**目标**：启动、界面、常驻元素都符合自己的审美与习惯。

**当前状态**
- `whale-motion/` 有完整的启动动画素材与渲染管线（192 帧 PNG + `render.py` + `render.mjs`）。
- `../tools/build-whale.mjs` 已经能「打包 → 打补丁 → 语法检查 → 重打包 → 交付」。
- `dsh-whale-widget@0.3.18` 已装（L1），提供 Web 右下角余额小鲸鱼、气泡、音效、角色。
- `.dsh/whale-audio`、`.dsh/whale-bubble-imgs`、`.dsh/whale-roles` 是它的数据目录（目前多为空）。
- **动画尚未落盘**（`app.asar` 与备份 sha256 一致，见 P2 / P1）。

**抓手**
| 想改什么 | 走哪层 | 入口 |
| --- | --- | --- |
| 余额小鲸鱼的外观/行为/气泡 | **L1** | `dsh-whale-widget` 的插件设置 |
| 主题、配色 | **L0/L1** | `@deepseek-ai/dsh-client-ui-theme` |
| 对话排版 | **L0** | `ui-chat` 的 `transcriptView` / `performanceUsage` |
| 启动窗口动画 | **L3**（唯一选择） | `renderer/welcome.html` + `lib/welcome/whale-animation.js` |
| 桌面悬浮挂件 | **L3** | `lib/main.js` 新建窗口 |

**候选动作**
1. 清理 `app.asar.tmp` 残留（P1）——先确认产物是否就是想要的那版。
2. 落盘鲸鱼启动动画（P2）：分两次会话，先 `build`，退出 Harness 后再 `--install`。
3. 把 `dsh-whale-widget` 当主战场：它是 L1，改了升级后还在。

**验收**：启动窗口实际播放动画；`doctor` 中原版备份与当前 asar 的 sha256 **不再一致**（证明改动已落盘）。

---

## T2 · 能力扩展

**目标**：模型、Provider、工具、Agent 行为都按自己的需要配。

**当前状态（已经很丰富）**
- OpenCode Go 订阅已接入 3 条路由（chat / responses / messages），约 30 个模型，凭据走 `OPENCODE_GO_API_KEY`。
- `agent-default-model`：`deepseek-account` / `deepseek-flash` / `reasoningEffort: high`。
- `agent-preset-registry`：`selectedDefault: cordis`。
- 12 个 bundle 里含插件市场、上下文、记忆、Agent Teams、自动评审、定时、语音输入。

**已核实的抓手**
| 抓手 | 在哪 | 现状 |
| --- | --- | --- |
| `tool-ralph` | base 行 `disabled: true` | 默认关闭，overlay 可开（base 注释里给了示例） |
| `session-query-sqlite` | base `openAt: never` | **会话全文搜索默认关闭**，overlay 可改 `first-search` / `startup` |
| `spill-policy` | `maxInlineTokens: 12500` | 大结果落盘阈值 |
| `tool-result-pruner` | `thresholdChars: 8192` | 工具结果预压缩 |
| `llm-pi-ai` | patch 已用 | 继续加 Provider 就是往 `providers:` 里加一节 |
| `dsh-mcp-client` | 宿主包存在 | MCP 接入能力在手，未启用 |
| `dsh-tool-web` | `searchTimeoutMs: 60000` | 联网搜索/抓取 |
| `dsh-skill` / `dsh-skill-filesystem` | 已挂载 | 技能目录 |

**候选动作**
1. 加 Provider：在 `llm-pi-ai.providers` 下加一节（`apiKeyEnv` + `api` + `baseURL` + `models`）。
2. 开 MCP：接入本地/远端 MCP server，把外部工具变成 DSH 工具。
3. 按需开 `tool-ralph`。
4. 写自己的 skill（`dsh-skill-filesystem` 认目录）。
5. 调 Agent 行为：`system-prompt.personaPrefix`、`agent-presets`、`subagent.maxDepth`。

**验收**：模型选择器里出现新模型并能真实对话；新工具在工具目录里可见且可调用。

---

## T3 · 使用效率

**目标**：同样的活少花时间少花 token。

**候选动作**
1. **开会话全文搜索**（P4）。默认 `openAt: never` 时侧边栏只能按标题和工作区名匹配；打开后可以对历史会话内容检索。这是投入产出比最高的一项。
2. **缓存与压缩参数**：`spill-policy.maxInlineTokens`、`tool-result-pruner.thresholdChars`、`compaction-basic` —— 直接决定长会话的成本。
3. **会话标题质量**：`session-title-llm` 的 `targetWords: 5` / `targetCjkCharacters: 10` / `maxInputBytes: 4096`。
4. **交互习惯**：`ui-conversation.busyEnter: steer` 已设；继续看 `dsh-client-ui-input-trigger` 的快捷键与 `dsh-commands` 的斜杠命令。
5. **记忆**：`@furongjun1999/dsh-memory` 与 `billion-context` 已在，梳理它们的写入/召回策略。

**验收**：给一个具体任务，改前改后对比耗时与 token 消耗（`acp_cache` / `dsh-token-meter` 可读）。

---

## T4 · Web GUI 扩展

**目标**：给自己的界面加面板、加槽位，而不是去改安装包里的前端。

**当前状态**
- `@deepseek-ai/dsh-client-ui-slots` 是槽位系统。
- `dsh-better-sidebar@0.24.1` 已经证明这条路可行：它的 `package.json` 暴露了一个 service，**供别的插件注册 sidebar tab 与 file viewer**。
- 插件声明方式（可直接照抄 `dsh-better-sidebar`）：

```json
{
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "inject": ["@deepseek-ai/dsh-client-locale", "@deepseek-ai/dsh-client-ui-slots"],
      "platform": "web"
    },
    "manifestVersion": 1
  }
}
```

**抓手**
1. 写之前先用 **`cordis_inspect_list` / `cordis_inspect_query`** 读实时事实：可用 Service 方法、Event 模式、插件 Config schema、Tool schema、主题 token、**实时 Slot 树与 props**。
2. 客户端插件改动可以**热重载**（`dsh-client-hmr` 已挂载）——比改 asar 快几个数量级。

**候选动作**
1. 最小可用插件脚手架（host 侧 + client 侧各一个入口）。
2. 挂一个自有面板到现有槽位。
3. 把高频操作做成按钮，减少手动输入。

**验收**：界面上出现自建面板；刷新/热重载后仍在；Harness 升级后仍在。

---

## T5 · 工程化

**目标**：改造本身可复现、可审计、可回滚，升级后能快速重打。

**当前状态**
- ✅ 本项目已交付：`env` / `doctor` / `snapshot create|list|diff|restore` / `baseline write`。
- ⏳ `../tools/` 里有 20 多个成熟脚本（asar 读写校验、补丁、构建、安装回滚、无头截图验证、帧分析）尚未归拢。
- ⏳ 升级检测与「重打」提示未做。

**候选动作**
1. **归拢 asar 工具链到 `vendor/`**，统一入口，去掉对 `../` 的相对依赖。
2. **升级检测**：把 `state/baseline.json` 里的 `app.asar` sha256 与当前比对，版本变了就提示「哪些 L3 改动需要重打」。
3. **L3 改动的声明式描述**：把「改哪个文件、锚点是什么、替换成什么」写进 `patches/*.yml`，让补丁可审计、可重放。
4. **快照保留策略**：自动保留最近 N 份 + 所有带标签的。
5. **doctor 扩展**：接入 profile 重载后的运行时探测。

**验收**：在一台干净的机器上，`doctor` → 应用补丁 → 落盘 → 复验，全程无需人工记忆任何步骤。

---

## 里程碑

| 里程碑 | 内容 | 状态 |
| --- | --- | --- |
| **M0** | 项目骨架 + 环境基线 + `doctor` / `snapshot` / `baseline` | ✅ 已完成 |
| **M1** | 权威组合预检 `precheck` + 只读安装包工具 `asar` + T3 会话搜索开启 | 🚧 代码与配置已落地，**待重启验收** |
| **M2** | T5 `../tools/` 归拢进 `vendor/`（构建链闭环）+ T1 鲸鱼动画落盘 | 🚧 构建链**已闭环**；只剩「退出 Harness 后落盘」这一步 |
| **M3** | T2 新增 Provider + T4 自建 Web 插件样板 | 待办 |
| **M4** | 升级重打自动化 | 待办 |

### M1 的验收标准

- [x] `dsht precheck` 能吐出与运行中应用一致的组合结果，退出码语义明确
- [x] `dsht asar ls|cat|grep` 能只读地读安装包里**真正在跑的那份代码**
- [x] `session-query-sqlite` 的 `path` + `openAt: first-search` 已写入 profile patch，且预检 diff 恰好只有这两行
- [ ] **重启 DSH 后**，按会话内容搜索能命中（这一步只能由人来做）

### M2 的验收标准

- [x] `vendor/whale/build.mjs` 能按 `patches/*.yml` 构建暂存包，且**不碰安装目录**
- [x] 构建后自检：`11 个条目按声明改动，其余 11466 个条目逐字节一致`
- [x] 7 个 JS 产物全部通过 `node --check`（这是旧产物栽跟头的地方）
- [x] 与旧产物交叉比对证明**确定性构建**（差异恰好 2 个预期条目）
- [ ] **完全退出 Harness 后**执行 `node vendor/whale/install.mjs --yes`，重启能看到动画
      （这一步需要窗口：托盘图标也要退出）
- [x] `app.asar.tmp` 残留已确认是坏构建并删除，`doctor` 警告 3 → 2
