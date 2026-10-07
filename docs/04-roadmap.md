# 04 · 路线图

五条工作线，全部已确认要做。每条线都标出**当前状态**、**已核实的抓手**、**候选动作**、**验收方式**。
候选动作按「改动小、收益大、升级后能幸存」排序——上面的先做。

---

## T1 · 外观与体验

**目标**：启动、界面、常驻元素都符合自己的审美与习惯。

**当前状态**
- `whale-motion/` 有完整的启动动画素材与渲染管线（192 帧 PNG + `render.py` + `render.mjs`）。
- `vendor/whale/build.mjs`（由 `../tools/build-whale.mjs` 重写而来，改为按 `patches/T1-whale-splash.yml` 声明驱动）已经能「生成 → 语法检查 → 重打包 → 逐字节核对」，产物 `state/staged/app.asar`。
- `dsh-whale-widget@0.3.18` 已装（L1），提供 Web 右下角余额小鲸鱼、气泡、音效、角色。
- `.dsh/whale-audio`、`.dsh/whale-bubble-imgs`、`.dsh/whale-roles` 是它的数据目录（目前多为空）。
- **动画已落盘**（2026-10-06 晚：`app.asar` 121,421,984 B，sha256 与 `state/staged/app.asar` 一致；原版备份完好，见 P2 / P1）。
- 启动窗口那几段脚本**已有行为级离线单测**（`test/splash.test.mjs`，**23** 条断言）：用 `node:vm` 造假浏览器，
  把归档里的 `lib/welcome/whale-animation.js`、`renderer/whale-splash.js` 与 `renderer/replay.js` 按页面同样的顺序真跑一遍，
  推进整条时间线，模拟拖动/键盘/主题翻转/存储被禁，并检查**每个画布参数都是有限数**（NaN 是 canvas 最典型的静默失败）；
  `replay.js` 在归档里缺席时（尚未落盘的旧版本）只跳过 replay 那一节，其余照跑 —— 读不到产物不算「通过」，也不谎报失败。
- 桌面挂件的**开关**已由 L1 插件 `dsh-up-t` 提供（设置 →「通用」里那一行），硬刷新即生效，不碰安装包。
- 挂件菜单的「Replay animation」曾是**空操作**：主进程把字符串 `"replay"` 发给**主窗口**，而启动画面跑在
  **欢迎窗口**里 —— 没有收件人，点了没反应也不报错。2026-10-06 已修（详见 `tracks/T1-appearance/README.md`）：
  新增 `renderer/replay.html` + `renderer/replay.js`（`patches/T1-whale-splash.yml` 的 `verify.expect_diff_entries` 11 → **13**），
  `vendor/whale/patch-main.mjs` 新增 `replaySplash()` 真开一个短命无框窗口（600×700、不可交互、`REPLAY_MAX_MS = 2e4` 安全网），
  `test/splash.test.mjs` 19 → **25** 条钉住「动画播完自己收场，不赖着不走」（其中两条是**故意让画面画不出来**的失败路径：
  没有画布、`drawWhale`/`WhaleSplash` 抛异常时，重播窗口必须立刻/按时自己关掉，而不是留一块 20 秒的置顶空白方块挡着界面）。
  **已构建核对，并于 2026-10-06 21:36 落盘**（`expect_diff_entries` 13 条已是现场实况）；此后又修了一版 replay 健壮性，
  暂存包 121,422,676 B **比在用安装包新 692 字节 ⇒ 待落盘**（`install-whale.cmd` 再跑一次即同步）。
- **手写素材已入库**：`vendor/whale/materials/`（**12 个文件 / 53 KB**，后两件就是上面的 replay）。搬进去之后重建验证过 ——
  产物与搬家前 **sha256 完全相同**（搬家前后各构建一次比对）。`action: patch` 的三份原版缓存仍不入库
  （从任意一份 `app.asar` 可原样重抽，且构建时逐字节校验）。

**抓手**
| 想改什么 | 走哪层 | 入口 |
| --- | --- | --- |
| 余额小鲸鱼的外观/行为/气泡 | **L1** | `dsh-whale-widget` 的插件设置 |
| 主题、配色 | **L0/L1** | `@deepseek-ai/dsh-client-ui-theme` |
| 对话排版 | **L0** | `ui-chat` 的 `transcriptView` / `performanceUsage` |
| 启动窗口动画 | **L3**（唯一选择） | `renderer/welcome.html` + `lib/welcome/whale-animation.js` |
| 桌面悬浮挂件 | **L3** | `lib/main.js` 新建窗口 |

**候选动作**
1. ✅ **清理 `app.asar.tmp` 残留**（P1）—— 已完成：确认它是坏构建（抽出来的 `lib/main.js` 过不了
   `node --check`，落盘会让主进程起来就抛 SyntaxError），已删除；`doctor` 现在报「无残留 `app.asar.tmp`」。
2. 🚧 **落盘鲸鱼启动动画**（P2）：`build` 与落盘是两步，落盘要等 Harness 完全退出 —— **这一步归你**。
   已落盘过一次（2026-10-06 21:36），此后重建的暂存包含重播修复，仍在等下一次落盘。
3. ~~把 `dsh-whale-widget` 当主战场~~ —— **已被取代**：本项目自建 `plugins/dsh-up-t`（L1），
   挂件菜单的开关由它提供，见 T4。

**验收**：启动窗口实际播放动画；`doctor` 中原版备份与当前 asar 的 sha256 **不再一致**（证明改动已落盘）。

---

## T2 · 能力扩展

**目标**：模型、Provider、工具、Agent 行为都按自己的需要配。

**当前状态（已经很丰富）**
- OpenCode Go 订阅已接入 3 条路由（chat / responses / messages），约 30 个模型，凭据走 `OPENCODE_GO_API_KEY`。
- `agent-default-model`：`opencode-go-chat` / `glm-5.3`（用户在 GUI 里改过）。
- `agent-preset-registry`：`selectedDefault: cordis` ⇒ 新会话跑 `preset-cordis`，它与 `preset-standard` 的唯一差别是多一个 `tool-cordis`。
- `subagent`：`maxDepth: 2`；`agent-team`：`maxMembers: 16`（本项目 2026-10-07 从 bundle 的 8 抬到包作者默认值 16）。
- 12 个 bundle 里含插件市场、上下文、记忆、Agent Teams、自动评审、定时、语音输入。

**已核实的抓手**
| 抓手 | 在哪 | 现状 |
| --- | --- | --- |
| `tool-ralph` | base 行 `disabled: true` | ✅ **已落盘**（2026-10-06，现场 `cordis.patch.yml` 第 12 条，重启 DSH 后生效）。它是「每 Round 一个全新子 agent + 有界交接（默认 16384 字符），绝不复制父对话」的迭代循环 ⇒ 长任务上下文成本从 `O(轮数 × 累积历史)` 降到 `O(轮数 × 交接上限)`。base 默认关的理由仍成立：**完成是 worker 自我报告，没有独立评估**，所以只在「明确要求全新 agent 迭代」时用；普通长期工作用 `goal`，有界委派用 `subagent` / `workflow` |
| `session-query-sqlite` | base `openAt: never` | **会话全文搜索默认关闭**，overlay 可改 `first-search` / `startup` |
| `spill-policy` | `maxInlineTokens: 12500` | 大结果落盘阈值 |
| `tool-result-pruner` | `thresholdChars: 8192` | 工具结果预压缩 |
| `llm-pi-ai` | patch 已用 | 继续加 Provider 就是往 `providers:` 里加一节 |
| `dsh-mcp-client` | 宿主包存在 | MCP 接入能力在手，未启用 |
| `dsh-tool-web` | `searchTimeoutMs: 60000` | 联网搜索/抓取 |
| `dsh-skill` / `dsh-skill-filesystem` | 已挂载 | 技能目录 |
| `agent-team` | bundle 插入行 `maxMembers: 8` | ✅ **已改 16**（2026-10-07）。名额是**每支团队累计、含创建失败的成员、名字永不复用**，所以 8 是「一辈子最多 8 个名字」而不是「同时 8 个在跑」；恢复包作者默认值只抬天花板。同时存活的**可续接子代理**仍由 `subagent.maxActiveSubagents`（默认 8）限制 —— 两道闸门别混为一谈 |
| `system-prompt` | base 已设 `personaPrefix` / `personaSuffix` | **不动**：base 自带「你是一个由 `{{model}}` 驱动的编码 agent」+「你的工作目录是 `{{cwd}}`」；`toolOrder` 有「列了名字但没注册工具 ⇒ 每次 assemble() 被拒」的锐边。要长期注入的自定义人格放**按目录作用域**的指令文件，而不是全局提示词 |
| `agent-loop.maxParallelToolCalls` | 未设 ⇒ 默认 `10` | **不动**：没有「并行度不够」的证据 |

**候选动作**
1. 加 Provider：在 `llm-pi-ai.providers` 下加一节（`apiKeyEnv` + `api` + `baseURL` + `models`）。
2. 开 MCP：接入本地/远端 MCP server，把外部工具变成 DSH 工具。
3. ~~按需开 `tool-ralph`~~ ✅ 2026-10-06 已落盘。
4. 写自己的 skill（`dsh-skill-filesystem` 认目录）✅ 2026-10-06 已完成。
5. ~~调 Agent 行为~~ ✅ 2026-10-07 已把「Agent 行为」读成一张旋钮表并落了一处（`agent-team.maxMembers`）；其余各项**有证据地不动**，理由与锐边见 `tracks/T2-capability/README.md`。
6. 另存一份 preset（新建/覆盖 preset 只能靠 bundle 补丁 + `plugin_manager`，见 `patches/README.md`）—— 无目标，暂不动手。

**验收**：模型选择器里出现新模型并能真实对话；新工具在工具目录里可见且可调用。

---

## T3 · 使用效率

**目标**：同样的活少花时间少花 token。

**候选动作**
1. **开会话全文搜索**（P4）。默认 `openAt: never` 时侧边栏只能按标题和工作区名匹配；打开后可以对历史会话内容检索。这是投入产出比最高的一项。✅ 已落地，待重启验收。
2. **缓存与压缩参数**：`spill-policy.maxInlineTokens`、`tool-result-pruner.thresholdChars`、`compaction-basic`。✅ 已核实、**无需改动**。缓存侧已结案（命中率 98.3%、压缩净 +92.35M）。阈值侧：`spill-policy` 是**仅追加**的（不破坏 KV Cache），完整结果落文件可 `read`/`grep` 读回；`tool-result-pruner` **只在压缩压力下运行**、原始事件留在仅追加日志里可回放（无损），但**从第一个变化的 token 起**会让 KV Cache 失效。⇒ 两处都**维持默认**：调高 `maxInlineTokens` 只是让更多内容内联、反而加重压力；调低 pruner 阈值是用「省一次摘要」换「破坏缓存」。**没有实测病灶就不开刀**；将来若真的要动，先动 `maxInlineTokens` 并用 `acp_cache` 复测命中率。详见 `tracks/T3-efficiency/README.md`。
3. **会话标题质量**：`session-title-llm` 原来只有 `targetWords: 5` / `targetCjkCharacters: 10` —— 10 个汉字的标题无法区分同主题的多次会话，是纯读数损失。✅ 2026-10-06 已调为 `8` / `16` / `maxOutputTokens: 96`（`maxInputBytes` 与 `timeoutMs` 刻意不动），现场 `cordis.patch.yml` 第 13 条，声明副本 `patches/T3-session-title.yml`；**待重启验收**。
4. **交互习惯**：`ui-conversation.busyEnter: steer` 已设。✅ 斜杠命令与快捷键已梳理（7 个斜杠命令；快捷键由 `@deepseek-ai/dsh-client-shortcuts` 提供、**按设备可重绑**，`Ctrl+/` 开速查面板，桌面端存 Electron `userData/keybindings.json`）。**不加配置**：默认值已覆盖主要动作，改默认反而破坏既有肌肉记忆。见 `tracks/T3-efficiency/README.md`。
5. **记忆**：`@furongjun1999/dsh-memory` 与 `billion-context` 已在，梳理它们的写入/召回策略。✅ 三个插件机制正交（压缩 / 长期记忆 / 只读观测），**都不动**；2026-10-07 把灵枢 **33 个配置键逐项读完**（两个独立来源互相印证），结论仍是全部维持默认，并实测自动记忆确实在写（`_audit.jsonl` 有 `actor=dsh-memory` / `clearance=internal` 记录）。顺带查出两件原本不知道的事：写入凭据在**包外**密钥环 `~/.mdcg/token`（首启自动签发 ⇒ 升级/重装不会带走），以及**热重载会让灵枢静默降级**（`apply failed: cannot create effect on inactive context` ⇒ 改完必须重启 Harness）。详见 `tracks/T3-efficiency/README.md`。

**验收**：给一个具体任务，改前改后对比耗时与 token 消耗（`acp_cache` / `dsh-token-meter` 可读）。

---

## T4 · Web GUI 扩展

**目标**：给自己的界面加面板、加槽位，而不是去改安装包里的前端。

**当前状态**
- `@deepseek-ai/dsh-client-ui-slots` 是槽位系统。
- `dsh-better-sidebar@0.24.1` 已经证明这条路可行：它的 `package.json` 暴露了一个 service，**供别的插件注册 sidebar tab 与 file viewer**。
- ✅ 已用 `cordis_inspect_query`（client `Slots`）把**实时**槽位树读出来并归档到 `tracks/T4-webgui/README.md`：
  24 个 `replaceRisk: none` 的加法座位 + 替换座位清单 + list 槽位统一注册签名 + `main` / `tool.call.toolview` 的已占用键。
  ⚠️ 同一次侦察的副产品：`Config/listConfigs` 的 `status: inactive` **不等于关掉**（`tool-fs`/`tool-pwsh` 都报 `inactive` 却正常工作），别据此判断插件是否启用。
- ✅ **槽位不只适合挂整页**：`plugins/dsh-up-t` 除了一整页 `settings.section`，还在 `settings.general.item` 里挂了一行
  **「桌面鲸鱼挂件」开关**（`id: whale-charm`、`order: 60`，形状照抄 `dsh-client-ui-theme/lib/client.js:1603`）。
  顺带接上了一座**出货 Harness 里没人调用的桥**：整套挂件机制（无框透明窗口 + 28 行 preload + 5 条 IPC）都在，
  但全归档搜不到一处调用 `window.dshWhaleCharm` ⇒ `whale-charm.json` 永远是 `enabled: false`，挂件永不出现且不报错。
  这一行由 L1 插件提供 ⇒ 随 profile 目录走、**硬刷新即生效、连落盘都不需要**。
  难点不在渲染而在**把「用不了」的几种原因分开说清楚**（桥不在 / 被拒 / 切换失败要回原位 / busy / 卸载撤监听 /
  `charm-changed` 通道里的字符串 `"replay"` 不是状态），`test/plugin.test.mjs` 用 9 条断言逐条钉住（46 → **55** 条）。
  见 `tracks/T4-webgui/README.md` 第十步记录与 `tracks/T1-appearance/README.md`。
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
1. ✅ **最小可用插件脚手架** —— 2026-10-06 落地：`plugins/dsh-up-t`（`package.json` +
   `cordis.patch.yml` + `lib/index.js` + `assets/client.js`），界面左下角一个显示改造状态的小胶囊。
   走的是**最轻的那条路**（宿主注册 HTTP 路由 + 推一行注入），不是 Slot 系统。
   离线单测钉住三条硬约束（注入行必须是内联 `script` 而非 `script-src`；
   不能用对象级 `inject`；桌面端 `tapIndex` 不生效）；`precheck --profile-json` 候选清单预检通过；
   落盘后 `doctor` 13 个 bundle 全部可解析。
2. ✅ **用 Slot 系统挂一个自有面板** —— 2026-10-06 落地：`plugins/dsh-up-t/lib/client.js`（手写并提交的
   ModuleLoader 格式客户端 bundle）在 `settings.section` 槽位挂出**设置里的一整页**「deepseek-up-T」。
   选这个座位是因为它 `list` + `replaceRisk: none`，**不会遮蔽任何自带界面**。
   关键约束：宿主**只提供已构建的客户端 bundle**、自己不构建，而 profile 里没有 `scripts`，
   所以这份 `lib/client.js` 只能手写（**这是本项目第一条不依赖任何构建链的客户端产物**）。
   离线单测 20 条断言钉住 bundle 形态与槽位注册签名。
3. ✅ **把高频操作做成按钮** —— 2026-10-06 落地：宿主新增 `/dsh-up-t/action`
   （白名单 + `POST` + `x-dsh-up-t` 自定义头 + 串行执行；`GET` 只列动作、永不执行），
   设置页按它给的 `specs` 渲染按钮（体检 / 升级检测 / 组合预检 / 快照列表 / 留一份快照）。
   命令行由 `process.execPath` + `ELECTRON_RUN_AS_NODE=1` 以纯 Node 身份跑，
   **数组形式 spawn、永不经过 shell**。会写盘的操作先二次确认。
   离线单测从 24 条涨到 **44 条**：路由数与守卫链、`GET` 只列动作且永不执行、一次真 spawn、
   「答「不」时一个请求都不发」、把整张 `specs` 表与 `writes` 语义钉住的一条、心跳两步走
   （`apply` / `ready`）与设置页心跳行的三条，以及**握手通道**的三条
   （`GET` 只读且不记录 / 缺头 403 / 两条投递通道分开记并落进心跳与 `status.json`）与
   「`apply()` 恰好握一次手、握手失败照常注册设置页」两条。
   握手填的是这条链上最后一个静默区：心跳的 `ready` 只说得出宿主侧（路由注册了），
   而「浏览器里那段脚本到底跑了没有」只有渲染层自己说了算 —— `/dsh-up-t/seen` 收它这一句，
   并把 `capsule`（注入行）与 `bundle`（ModuleLoader）**分开记**，因为
   「胶囊在、设置页不在」和反过来是两种不同的故障。
4. ✅ 重启 DSH 后确认胶囊与设置页真的出现（操作通道与握手都是宿主半侧新增的，必须重启才存在）
   —— 2026-10-06 10:48 重启后 `dsht accept` 实测：操作通道 7 个动作在线、心跳 `stage=ready`（4 条路由）、
   `/dsh-up-t/status.json` → 200、渲染层 `capsule` 与 `bundle` 两条握手都到（各带时间戳，`client.count=2`）。
   只剩「用眼睛看一遍」那 7 项（不计入退出码）。
5. ✅ **把「我改的东西还没落盘」变成界面上一件看得见的事** —— 2026-10-07 落地：`status.json` 新增
   `staged` 事实（纯函数 `stagedVerdict` 的五态判定表：`pending` / `behind` / `same-size` / `differs`
   / `unavailable`），胶囊在 **`pending` 时自己**变成 `up-T · 待落盘` 并把圆点转橙，设置页多一行
   「暂存包」连落盘命令一起写出来。起因是一件真事：含重播修复的暂存包在磁盘上等了一整天没落盘，
   而界面一个字都不说。三条判据：**「待落盘」必须写在没点开的胶囊上**（人不会去点一个说「一切正常」
   的面板）；**「暂存更旧」是一句不同的话**（说反了会把人引去落一个错包）；**方向只能由 mtime 判定**
   （大小不同而时间戳拿不到 ⇒ `differs`，绝不硬猜）。判定与 I/O 拆开是为了不去改那个 121 MB 产物
   造测试数据。`test/plugin.test.mjs` 55 → **57**、`test/capsule.test.mjs` 16 → **18**，全套 10/10。
   见 `tracks/T4-webgui/README.md` 第十二步记录。

**验收**：界面上出现自建面板；刷新/热重载后仍在；Harness 升级后仍在。

---

## T5 · 工程化

**目标**：改造本身可复现、可审计、可回滚，升级后能快速重打。

**当前状态**
- ✅ 本项目已交付：`env` / `doctor` / `snapshot create|list|diff|restore|prune` / `baseline write` / `precheck` / `asar ls|cat|grep` / `upgrade` / `accept`。
- ✅ **升级检测已交付**（`dsht upgrade`）：把 `state/baseline.json` 与现场比对，一次回答「升级发生了没有 / 哪些 L3 声明需要重打 / 哪些只是从未落盘 / 重打前哪份原版素材已过期 / L0 声明有没有与现场漂移」。
- ✅ **重启后验收已交付**（`dsht accept`）：把「改完重启之后到底成没成」这件事变成一条只读命令 —— L3 声明、L0 声明、宿主路由（`/dsh-up-t/status.json` 在不在、`/dsh-up-t/action` 是 200 还是 404）、**磁盘上那份客户端 bundle 是新版还是旧版**（挂件开关那一行的注册在不在 —— 查文件而不是查路由，因为 `/dsh-up-t/client.js` 送的是左下角胶囊，设置页那一页走 ModuleLoader）、渲染层握手（`/dsh-up-t/seen` 的 `bundle` / `capsule` 两条通道）各自判一次，每条失败都带一句修法。**三种结论分开**：`FAIL`（没成）/ `SKIP`（这次没拿到证据）/ `MANUAL`（只有人眼能判，不计入退出码）—— 把「没测到」折成「没过」会让人去修一个不存在的故障，把需要人眼的项算成失败则是教人忽略失败。设置页上也有这个按钮（`重启后验收`）。
- ✅ L3 改动的声明式描述已落地：`patches/*.yml` + `vendor/whale/build.mjs`（构建到暂存位）+ `vendor/whale/install.mjs`（落盘 + 逐项核对）。
- ✅ **落盘链路可以离线演练**（`install.mjs --yes --to <临时目标>` / `install-whale.cmd /dry`）：把暂存包复制到临时目标，在**不退出 Harness、不动在用安装包**的前提下跑同一段声明核对；`--to` 落在安装目录里一律拒绝，`--to` 指向在用 asar 时按真落盘处理（不给它开后门绕过守卫）。回归测试 `test/install.test.mjs` 钉住构建确定性、演练核对、三条拒绝路径，并用 sha256 证明全程在用安装包未变。
- ✅ **唯一一条回头路也有演练模式与回归测试**（2026-10-07）：`install.mjs --rollback --to <临时目标>`（同样不用退出 Harness）把备份复制到临时目标并跑**同一段**逐字节核对（`verifyRollback`，演练与真回滚共用判据）；三条规则与落盘对称。此前它既没有演练模式、`test/` 里也一个字都没提过它 —— 而它恰好是**出事时才跑**的那一条命令，「一年跑几次」正是不测它就更不可能发现问题的理由。`test/install.test.mjs` 现在 43 条（Harness 在跑时）/ 44 条（没在跑时），真回滚那一节靠早已存在的 `DSH_UP_T_INSTALL_DIR` 把安装目录换成临时目录后**真跑一遍回滚**，并钉住「没备份时先报没有备份，而不是先让人去退出 Harness」这个次序。
- ✅ **渲染层脚本也有离线行为级单测**：`test/capsule.test.mjs`（18 条）用假 DOM + 假 `fetch` 把左下角胶囊（`plugins/dsh-up-t/assets/client.js`）真跑一遍 —— 挂载四条路径、幂等、握手、状态与数字、点击/拖动/右键隐藏、四种降级、存储被禁时仍可用、待落盘时胶囊自己变橙并给出落盘命令（且其余状态不许冒充待落盘），以及「所有运行里 `client failed` 一次都没响」。它当场抓到 `localStorage` 读取没包 `try`（存储被禁时胶囊在但点不动、无报错）。
- ✅ **构建产物的引用完整性有独立检查**：`test/assets.test.mjs`（28 条）。`vendor/asar/verify.mjs` 的逐字节核对只能回答「是不是按声明改了」，回答不了「改对了没有」—— 手写的替换素材没有锚点保护。于是把三条不变量单独钉住：引用的资源必须存在、替换页不许丢掉原版引用过的资源、替换页的 CSP 不许变严。它当场抓到 `renderer/welcome.html`（DSH 的欢迎/登录窗口页面）被换成预览页后**丢掉了应用自己的 React 启动脚本**（窗口会打开但里面全空），坏版本原文留在 `test/fixtures/` 当永久反例。
- ✅ **启动窗口那三段脚本也有离线行为级单测**：`test/splash.test.mjs`（**23** 条）用 `node:vm` 造一个假浏览器，把归档里的 `lib/welcome/whale-animation.js`、`renderer/whale-splash.js` 与 `renderer/replay.js` 按页面里同样的顺序真跑一遍（推进整条时间线、模拟拖动/键盘/主题翻转/存储被禁），并检查**每个画布参数都是有限数** —— NaN 是 canvas 最典型的静默失败。此前对这几段代码只有 `node --check` 与逐字节核对，两者都不回答「跑起来对不对」。replay 那 4 条钉的是修「Replay 空操作」时最容易再犯的错：页面只能有一个时长真相（`DURATION_MS` 必须存在且 ≤ 主进程 20 s 安全网）、动画跑完**自己**淡出关窗、减动效与「页面里没有画布」两种输入都要**安静**收场（不建节点、不排定时器、不关窗）。
- ✅ **设置页那一页与挂件开关那一行也真的被渲染过一遍**：`test/settings.test.mjs`（41 条）分两层 ——
  **显示层**用外壳真实提供的 `react@18.3.1` + `react-dom/server` 渲染成 HTML（证明 `require("react")`
  真解析得到、组件在真 React 下不抛错、aria 与中英文案全对），**行为层**用自写迷你 hook 主机
  跑 `useEffect` 里的数据流（拉状态、30 秒轮询、桥的 `state()`/`onChange`、失败回退、卸载撤监听）。
  此前 `test/plugin.test.mjs` 用 stub 的 React 只钉住了槽位注册的**形状**，组件函数从未被调用过 ——
  「形状对」与「渲染过」之间的那类失败（白屏且无报错）照不到。全套 **11 套**测试。
- ✅ **「构建了但忘了落盘」现在终端也会自己报出来**：`doctor` 的「安装包」段与 `upgrade` 的报告末尾各有一条
  `暂存包`（五态：`pending` 待落盘 / `behind` 暂存更旧别用 / `same-size` / `differs` 判不出方向 /
  `unavailable` 拿不到）。判定表在 `src/staged.mjs`，与 `plugins/dsh-up-t/lib/index.js` 那份
  （胶囊 / 设置页）**逐字相同**，由 `test/staged.test.mjs` 用一张输入表逐格交叉对照 —— 各写各的会出现
  「界面说待落盘、终端说一切正常」，那种结果比不说更坏。`pending` 是常态而非故障，所以只是 info、
  不影响退出码。这条报告是补上一个真实代价换来的：一份含重播修复的暂存包在磁盘上等了一整天，
  而当时所有报告都写着「没检测到任何变化」（升级检测比的是「在用安装包 vs 基线」，暂存包不在那个比较里）。
  而 `dsht accept` 对同一条事实**刻意更严**：它有未落盘的产物时这一项是 FAIL —— `accept` 问的是
  「改完重启之后到底成没成」，上面那些 L3 项判的是「声明有没有落」，判不了「落的是不是最新的一份」。

- ✅ `../tools/` 的 23 个脚本**已全部归拢**到 `vendor/`（asar 三件套、构建链 6 个、视觉验证 6 个、Provider 探针 8 个）；`../tools/` 保留为历史副本，等 T1 验收后再删。见 `vendor/README.md`。
- ✅ **归拢后的说明书补齐**：新增 `vendor/visual/README.md`（6 个脚本的用法 / 依赖 / 副作用 / 回答不了什么），
  `vendor/README.md` 的 `visual/` 一节改为指向它。同一轮修掉一条真缺陷：
  `vendor/visual/check-whale-shape.mjs` 原本把产物写到**相对 cwd** 的 `.probe/frames/whale-silhouette.txt`
  且不建目录，从项目目录运行必然 ENOENT；现改从 `vendor/lib/harness.mjs` 取 `WORKSPACE`、自动建目录、
  新增 `--out <file>`，并在两个不同 cwd 下复验（写到同一绝对路径、指标一字未变）。

**候选动作**
1. ✅ **归拢 asar 工具链到 `vendor/`**（三批全部完成）。
2. ✅ **升级检测**：已交付，见上。
3. ✅ **L3 改动的声明式描述**：`patches/T1-whale-splash.yml` 是第一条真实声明。
4. ✅ **半自动重打**：`upgrade --stage` 把**构建**这一步真的做掉（只写 `state/staged/`，Harness 开着也能跑、
   按声明逐项核对差异集合、素材过期时先不动手），落盘仍留给人在 Harness 退出后挑时间 —— 见 `docs/03-workflow.md`。
5. ✅ **快照保留策略**：`snapshot prune`（默认只预演 + `--keep N` / `--keep-match GLOB` / `--yes`）。
6. ✅ **doctor 扩展**：运行时心跳探测 —— `doctor` 现在有一条 `运行时` 段，读 `plugins/dsh-up-t/.runtime/heartbeat.json` 回答「重启到底有没有把我的插件装进去」。心跳分两步写（`apply` → `ready`），所以它还能区分「加载了」和**能用**：只走到 `apply`（`webServer` 依赖没就绪）会让 `doctor` 与设置页同时说出「界面里不会有胶囊也不会有设置页」。**做法可复用**：任何「只能靠肉眼确认」的加载事实，都值得落一枚带 pid 与时间的文件。
7. ✅ **唯一一条回头路的演练 + 回归测试**（2026-10-07）：`--rollback --to <临时目标>`，以及用 `DSH_UP_T_INSTALL_DIR` 换安装目录后真跑一遍回滚（见上）。

**验收**：在一台干净的机器上，`doctor` → 应用补丁 → 落盘 → 复验，全程无需人工记忆任何步骤。

---

## 里程碑

| 里程碑 | 内容 | 状态 |
| --- | --- | --- |
| **M0** | 项目骨架 + 环境基线 + `doctor` / `snapshot` / `baseline` | ✅ 已完成 |
| **M1** | 权威组合预检 `precheck` + 只读安装包工具 `asar` + T3 会话搜索开启 | ✅ 2026-10-06 重启后验收：4 份 L0 声明与现场一致（`dsht upgrade` 全 OK）；只剩「按会话内容搜索真能命中」要你亲手搜一次（见下方 M1 验收） |
| **M2** | T5 `../tools/` 归拢进 `vendor/`（构建链闭环）+ T1 鲸鱼动画落盘 | ✅ 2026-10-06 晚全部完成：构建链闭环 + 落盘（12 项自动判定全过；观感那一眼归你） |
| **M3** | T2 新增 Provider + T4 自建 Web 插件样板 | 🚧 T4 样板**已落地并重启验收**（L1 插件 + 设置页 + 操作按钮 + 桌面挂件开关；10:48 重启后操作通道与两条握手通道实测在线）；T2 新增 Provider 卡在**需要用户给出目标**（baseURL + key，或 MCP 服务器） |
| **M4** | 升级重打自动化 | 🚧 检测 + **半自动重打**（`upgrade --stage`）+ **离线演练落盘**（`--to`）+ **离线演练回滚**（`--rollback --to`）已交付；自动落盘**不做**（要人挑时间，见 `docs/03-workflow.md`） |
| **M5** | T2/T3 落地批次：启用 `tool-ralph`、会话标题更长、上下文阈值核实、关闭产品埋点、写项目 skill | ✅ **已全部落盘并重启验收**（ralph / 标题 / 埋点开关 / skill；10:48 重启后 `dsht upgrade` 报 4 份 L0 声明全部 OK）；阈值核实结论是**维持不动**；灵枢记忆策略已梳理（三个插件机制正交，都不动），2026-10-07 补完 33 个配置键逐项体检 + 自动记忆实测 |

### M4 的验收标准

- [x] `dsht upgrade` 能判断安装包是否被动过（`app.asar` sha256 对基线）
- [x] 能判断「当前是未改造原版」（`app.asar` == `app.asar.whale-backup`）
- [x] 能把「被升级覆盖」与「从未落盘」分开报——前者要重打，后者只是还没做
- [x] 能指出 `action: patch` 的原版素材是否已过期（否则构建会被守卫拦下）
- [x] 能检查 L0 声明与现场 `cordis.patch.yml` 是否漂移
- [x] 已用「篡改基线版本号」的模拟升级跑通重打分支（报告正确、退出码 1、基线原样还原）
- [x] 落盘这一步本身可离线演练并核对（`install.mjs --to`；`test/install.test.mjs` 26 条，且在 Harness 开着时也能跑）
- [ ] 用**真实**的一次 Harness 升级走一遍：升级 → `dsht upgrade` → 重打 → 落盘 → 复验
      （**已知坑，届时注意**：升级会整体替换 `app.asar`，而 `install.mjs` 对已存在的备份**保留不刷新**，
      所以升级后 `build.mjs` 的默认 `--from` 指向的是**旧版备份** ⇒ 届时要显式 `--from <新安装包>` 重抽素材重打，
      或先刷新备份。素材过期的检测基准此时**恰好**指回新安装包，会如实报出这三条过期——那是真警报，不是误报）
- [x] `dsht accept` 把重启后的验收变成一条只读命令（L3/L0 声明 + 宿主路由 + 渲染层握手；FAIL/SKIP/MANUAL 三种结论分开，观感类不计入退出码）

### M1 的验收标准

- [x] `dsht precheck` 能吐出与运行中应用一致的组合结果，退出码语义明确
- [x] `dsht asar ls|cat|grep` 能只读地读安装包里**真正在跑的那份代码**
- [x] `session-query-sqlite` 的 `path` + `openAt: first-search` 已写入 profile patch，且预检 diff 恰好只有这两行
- [ ] **重启 DSH 后**，按会话内容搜索能命中（这一步只能由人来做）

### M2 的验收标准

- [x] `vendor/whale/build.mjs` 能按 `patches/*.yml` 构建暂存包，且**不碰安装目录**
- [x] 构建后自检：`13 个条目按声明改动，其余 11466 个条目逐字节一致`（数字随声明走：加进 replay 两件后 11 → 13）
- [x] 8 个 JS 产物全部通过 `node --check`（这是旧产物栽跟头的地方）
- [x] 与旧产物交叉比对证明**确定性构建**（差异恰好 2 个预期条目）
- [x] **完全退出 Harness 后**执行 `node vendor/whale/install.mjs --yes`（实际走的是等价的双击 `install-whale.cmd`），重启能看到动画 —— 2026-10-06 晚完成；`dsht accept` 的「T1 鲸鱼启动动画已落盘」「app.asar 已被改造」均过
      （这一步需要窗口：托盘图标也要退出）
- [x] `app.asar.tmp` 残留已确认是坏构建并删除，`doctor` 警告 3 → 2
- [x] 落盘后的稳态自检：`dsht upgrade` 不再误报「原版素材过期」——素材过期的对照基准已改为与 `build.mjs` 默认 `--from` 同源（无升级时 = 原版备份），`test/upgrade.test.mjs` 用「已改造安装包 + 完好备份 + 已刷新基线」的稳态模拟钉住（2026-10-06 晚修）
