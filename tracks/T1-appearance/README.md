# T1 · 外观与体验

> 启动、界面、常驻元素都符合自己的审美与习惯。

## 现状

- 启动动画素材与管线在 `../whale-motion/`（192 帧 PNG、`render.py`、`cutout.py`、`tune_mask.py`）。
- 构建与落盘工具已归拢到 `vendor/whale/`（`build.mjs`、`install.mjs` + 三个 patcher + `bundle.mjs`），声明在 `patches/T1-whale-splash.yml`。
- `dsh-whale-widget@0.3.18` 已装为 **L1 插件**：Web 右下角余额小鲸鱼、气泡点击序列、音效、角色、动图。
- 数据目录：`.dsh/whale-audio`、`.dsh/whale-bubble-imgs`、`.dsh/whale-roles`（多数为空）。
- **动画已落盘**（2026-10-06 晚）：安装包 `app.asar` 121,421,984 B（sha256 `2c6d8b4bf4716498…`），与 `state/staged/app.asar` 逐字节相同；原版备份 121,348,951 B（`983ca71114e6dfd3…`）完好保留，随时可回滚（`install.mjs --rollback`）。`dsht accept` 12 项自动判定全过。
- 暂存包 `state/staged/app.asar`（121,421,984 B，**13** 条目按声明改动，其余 11,466 条目逐字节一致）—— 落盘时 `install.mjs` 拿同一判据自检过（verify --expect 13）。

## 主战场

| 目标 | 层 | 入口 |
| --- | --- | --- |
| 余额小鲸鱼外观/行为 | **L1** | `dsh-whale-widget` 设置 |
| 主题配色 | L1 | `dsh-client-ui-theme` |
| 对话排版 | L0 | `ui-chat`：`transcriptView` / `performanceUsage` / `linkOpening` |
| 启动窗口动画 | **L3** | `renderer/welcome.html`、`lib/welcome/whale-animation.js` |
| 桌面悬浮挂件 | **L3** | `lib/main.js` 新建窗口 |

**L1 优先。** 只有启动窗口动画是 L3 —— 因为 `renderer/` 属于安装包内文件，没有插件层入口。

## 待办

- [x] 清理 `app.asar.tmp` 残留（115.8 MB）——**已确认是坏构建**（见下「记录」），已删除
- [x] 鲸鱼启动动画落盘 —— 2026-10-06 晚完成（完全退出 Harness → 双击 `install-whale.cmd` → 重启）。`dsht accept` 里「T1 鲸鱼启动动画已落盘」「app.asar 已被改造」均过；观感那一眼（启动画卷 → 鲸鱼 → 挂件动画）仍归你，见下方「验收」。
- [x] 把主题/气泡等偏好从 asar 侧迁到 `dsh-whale-widget` 的 L1 设置 —— **侦察后结论是「本来就不该这么做」**：`dsh-whale-widget` 0.3.18 的 `package.json` 只声明 `dsh.bundle.patch`，**没有任何 `Config` schema**，它的偏好本来就不在 asar 里，而是落在 `$DSH_HOME\.dshw-size.json` / `.dshw-turn.json` / `.dshw-usage.json`（设备本地，随用随写）。四层改造面（L0–L3）管的是**组合与代码**，不管这层用户数据。⇒ 这条待办的前提是错的，撤销；真要改默认值应改 widget 自己的默认值（L1 包内），而不是「迁到 L1 设置」（见下方记录）。
- [x] 桌面挂件窗口的**开关**（设置 →「通用」里那一行）—— 2026-10-06 完成：出货 Harness 有整套挂件机制，却没有任何代码调用 `window.dshWhaleCharm`，于是 `whale-charm.json` 永远是 `enabled: false`、挂件永不出现且不报错。开关改由 L1 插件 `dsh-up-t` 提供（`settings.general.item`），**不碰安装包、硬刷新即生效**。见下方记录与 [plugins/dsh-up-t/README.md](../../plugins/dsh-up-t/README.md)。
- [x] 桌面挂件菜单的「Replay animation」原本是空操作（`"replay"` 发给主窗口，而启动画面在欢迎窗口）—— 2026-10-06 已修：改 `vendor/whale/patch-main.mjs`，让主进程**自己**开一个短命 replay 窗口（`REPLAY_MAX_MS = 2e4` 安全网），新增 `renderer/replay.html` + `renderer/replay.js` 两个 `insert`（`expect_diff_entries` 11 → 13），`test/splash.test.mjs` 19 → **23** 条。见下方记录。**已构建核对，并于 2026-10-06 晚随落盘进安装包**（`expect_diff_entries` 已是 13 条实况）。
- [x] 把 T1 的**手写素材**搬进仓库 —— 2026-10-06 完成：10 个文件（39 KB）进了 `vendor/whale/materials/`
      （`renderer/` 六件、`lib/preload-charm.cjs`、`whale-animation.js` 的 ESM 源、离线预览页、挂件设置页残留物），
      声明里的 `source:` 一并改指仓库内。**验收方式不是「能跑」，而是「产物一字未变」**：
      先把搬家前的 `state/staged/app.asar`（sha256 `E6A1EAD1EAAF9433…`）存好，用新路径重建到 `state/cmp/repro-check.asar`
      → 两者 **sha256 完全相同**（121,416,081 B，11 条目按声明改动）。素材换位置不该改变产物。
      `action: patch` 的三份**原版缓存**（`lib/main.js`、`lib/preload-app.cjs`、session-controller）**刻意不入库**：
      它们是从安装包抽出来的上游原文，任何一份 `app.asar` 都能重抽（`node vendor/asar/list.mjs --get <归档内路径> <目标>`），
      而构建时会逐字节校验它们与当前归档一致 —— 不一致直接报错，所以「不入库」不会变成静默风险。
- [x] `bundle.mjs` 产出的 banner 不再硬编码来源路径（曾写死 `../../.probe/build/whale-animation.js`）：
      改成按**相对项目根**生成（`GENERATED from vendor/whale/materials/whale-animation.js …`），
      素材搬位置这句话自动跟着变。这也是暂存包从 121,416,081 变成 121,416,085 字节的**唯一**原因（+4 字节）。

## 验收

1. 启动 Harness 时实际播放画卷→鲸鱼→挂件动画。
2. 设置 →「通用」里出现「桌面鲸鱼挂件」开关；打开后桌面上出现小鲸鱼（可拖动、右键有菜单），关掉即消失。
3. `node src/cli.mjs doctor` 中原版备份与当前 `app.asar` 的 sha256 **不再一致**（证明确实落盘了）。
4. 回滚：`node vendor/whale/install.mjs --rollback`，或 `node src/cli.mjs snapshot restore <id>`（仅覆盖 profile 控制面）。

## 落盘操作清单（T1）——为什么是「你点，而不是我点」

> **2026-10-06 晚已执行过一遍**（落盘 + 重启 + `baseline write` 都走完了）。这一节留在这里，
> 作为**重装 / 升级后重打 / 回滚**的操作清单 —— 步骤不变，只是不再有「等你做」的含义。

**这一步必须由你在 Harness 关闭的状态下执行**，原因不是权限，而是**因果**：

- 覆盖 `app.asar` 要求 Harness **完全退出**（Electron 把 `app.asar` memory-map 了，共享冲突会 EPERM）；
- 而这个 agent 会话**就跑在 Harness 里面** —— 你完全退出 Harness 的同一刻，我也停了。
  所以「你退出后我落盘」这个顺序在物理上不成立。

因此交付一个**自带守卫的独立脚本**：`install-whale.cmd`（双击即可）。

**怎么做**

0. （可选，**不用退出 Harness**）先演练：双击 `install-whale.cmd` 前先跑 `install-whale.cmd /dry`，
   或 `node vendor/whale/install.mjs --yes --to state\cmp\rehearsal-app.asar` —— 它把暂存包写到临时文件、
   按声明逐项核对，**不动在用安装包**。不放心产物的那天就先跑这一步。
1. 右键**托盘**里的 DeepSeek Harness 图标 → **退出 / Quit**。
   ⚠️ 关窗口不够 —— 它只是收进托盘，进程还在，`app.asar` 仍然被占用。
2. 双击 `deepseek-up-T\install-whale.cmd`。
   - 脚本先查 `tasklist`，Harness 还在就打印 `[STOP]` 并 **exit 2**（不会白写文件）；
   - 不在运行才调用 `node vendor\whale\install.mjs --yes`；
   - 结束后按任意键关窗。
3. 重新启动 DeepSeek Harness，然后跑 `node src\cli.mjs accept` —— 它会一次问完宿主路由、渲染层握手、
   L0/L3 声明与体检，把「该转成 pass 的那几项」直接列出来。

**这一步已经预先验过的东西**（所以你不用担心它是「碰运气」）：

- 暂存包与声明**完全吻合**：`node vendor/asar/verify.mjs "<app.asar.whale-backup>" state\staged\app.asar --expect 13`
  → `OK：恰好 13 个预期条目不同，其余逐字节一致`（比较 11,466 个归档内条目 + 1,497 个 unpacked 条目），
  差异集合 = 4 改（`renderer/welcome.html` 645→1510、`lib/main.js` 490173→500046、
  `lib/preload-app.cjs` 41075→41776、`dsh-api-session-controller/lib/index.js` 124151→125198）
  + 9 增（`renderer/whale.css`、`renderer/whale-splash.js`、`renderer/replay.html`、`renderer/replay.js`、
  `renderer/pendant.html`、`renderer/pendant.css`、`renderer/pendant.js`、`lib/preload-charm.cjs`、
  `lib/welcome/whale-animation.js`）。
- **引用完整性**已单独核对（`node test\assets.test.mjs`）：这两页 HTML 引用的每个本地资源都真的在归档里，
  且替换页没有丢掉原版加载过的东西（见下方「登录窗口页面」那条记录 —— 这正是它抓出来的）。
- 启动窗口那几段脚本**已经在假浏览器里真跑过一遍**（`node test\splash.test.mjs`，**23** 条断言）：
  从归档里取脚本、按页面同样的顺序执行、推进整条时间线、模拟拖动/键盘/主题翻转/存储被禁，
  并检查**每一个画布参数都是有限数** —— 这一条专治「不报错但白屏」。replay 那一节在归档里还没有
  `renderer/replay.js` 时（也就是落盘之前）**只跳过它**，不谎报失败。
- 脚本的守卫路径**已实测**：Harness 运行中运行它 → 打印 `[STOP]`、`exit 2`、**不动任何文件**。
- `install.mjs` 自己在落盘后还会**按声明逐项比对差异集合**，多一条少一条都判失败并提示回滚；
  原版备份 `app.asar.whale-backup` 在落盘前已存在且与当前 `app.asar` 逐字节一致。

**落盘后怎么验**（重启之后）：

| 看什么 | 期望 |
| --- | --- |
| 启动时的画面 | 画卷 → 鲸鱼 → 桌面挂件动画 |
| 桌面上的小挂件 | 能拖（松手后位置记住）、方向键能挪、右键有菜单；关掉设置里的开关即消失 |
| `node src/cli.mjs doctor` | 「原版备份可比对」那行**不再是「完全一致」** |
| `node src/cli.mjs upgrade` | `T1-whale-splash` 从「未应用」变成 `applied`，退出码 0 |

**出问题怎么退**：`node vendor\whale\install.mjs --rollback`（从备份恢复，恢复后自带逐字节核对）。

**记录**

### 2026-10-06 · 启动界面那两段脚本，第一次真的被执行了一遍

- **起因**：T1 那 7 个插入文件里，`lib/welcome/whale-animation.js`（23,828 B）与 `renderer/whale-splash.js`（7,311 B）
  是唯一两段**运行期代码**（其余是 HTML/CSS 与 preload）。此前对它们只有两种证据：`node --check`（语法）
  与逐字节核对（是否按声明改动）。这两样都答不了「跑起来会不会白屏」。
- **为什么这条链是静默的**：启动窗口是第一屏，**没有别的界面兜底**；画布的失败形态是「什么都不画」
  而不是报错；打包若漏掉一个全局导出（`window.drawWhale`），挂件的 `paint()` 会抛 TypeError ——
  而那段代码在 window 里，没有人接这个异常。
- **做了什么**：新增 `test/splash.test.mjs`（**19 条**断言）。用 `node:vm` 造一个假浏览器
  （假 document/元素/2D 上下文/`matchMedia`/`localStorage`/`requestAnimationFrame`），把归档里的两段脚本
  按 `welcome.html` 里**同样的顺序**（先 `whale-animation.js` 再 `whale-splash.js`）真跑一遍。
  脚本来源是 `state/staged/app.asar`（要落盘的那一份），取不到就打印 `SKIP` 正常退出。
- **其中最有价值的一条**：2D 上下文的**每一个数值参数都必须是有限数**。`createLinearGradient(NaN, …)`、
  `bezierCurveTo(NaN, …)` 都不报错，只是什么都不画 —— **NaN 是 canvas 最典型的静默失败**。
  这一条覆盖全部帧与全部重画。
- **覆盖**：导出四件套（`WhaleSplash`/`whalePath`/`drawWhale`/`__WHALE_PIXEL__`）；两份都是经典脚本
  （启动窗口 CSP 只允许 `'self'`，ESM 会直接加载失败）；加载即起帧循环；第一帧画背景；全时间线画完；
  到点交出挂件（`.whale-pendant` + `is-done` + `transitionend` + 900ms 兜底移除）；`pagehide` 后停帧；
  拖动（边界钳制 + 抓指针 + 写 `localStorage`）；键盘（8px / Shift 24px）；位置记忆与越界钳制；
  主题翻转重画；深浅两套皮肤调色板确实不同；`whalePath` 11 段；减动效直接出挂件；
  没有 `#whale-stage` 时安静退出；存储被禁（企业策略/隐私模式）仍能拖动并记住位置。
- **当场抓到的真问题**（都在**测试自己**里，产品代码这轮没被改动）：假 DOM 一开始 `className` 与 `classList`
  不联动 —— 脚本用 `el.className = 'whale-pendant'` 建挂件、用 `querySelector('.whale-pendant')` 查询，
  不联动就等于让假 DOM 在「挂件到底建出来没有」这件事上说谎；挂件是 `div` + 内层 `<canvas>`，
  2D 上下文在内层（第一版对着 div 断言，误报失败）。
- **三次假失败（都值得记）**：① 期望值写整数 `616`，而挂件高度是 `size * 1.08 = 84.24`，
  钳制算出来是 `615.76`；② 键盘用例复用了上一条把挂件拖到下边界的状态，`ArrowDown + Shift` 被钳住不动；
  ③ 断言「挂件创建后 `paintCalls >= 1`」，而 `createPendant()` 的首画是直接 `requestAnimationFrame(paint)`
  排进去的，**不走 `el.__paint` 这层包装**。三条的共性：**期望值来自推算，而不是量出来的现实**。
- **怎么验的**：`node test\splash.test.mjs` → 19/19；`node test\run.mjs` → **9/9 套**；
  `node src\cli.mjs doctor` → 退出码 0、0 错误 2 警告。
- **教训**：「语法正确 + 字节吻合」与「跑起来是对的」之间隔着一整类失败，它们的共同特征是
  **只在真正执行时才出现**。凡是第一屏、没有兜底的界面代码，都值得备一个这样的假浏览器。

### 2026-10-06 · 桌面挂件：整套机制都在，唯独没有人打开它

- **症状**：同样**没有任何症状**。启动画面里那截「画卷 → 鲸鱼 → 挂件」的落地动画，会停在鲸鱼上，
  桌面上不会有那个常驻的小挂件；没有报错、没有日志、`doctor` 全绿。
- **怎么发现的**：给 T1 找离线证据时逐个读那 7 个插入文件。读 `renderer/pendant.js` 时看到它
  整段依赖 `window.dshPendant`，于是顺着查「谁建的这个窗口、谁打开的这个开关」，一路读到主进程。
- **事实**：出货的 Harness **已经有整套挂件机制** ——
  主进程 `showCharm()`（`lib/main.js:7835`）建一个 128px 无框透明 always-on-top 窗口，加载
  `renderer/pendant.html`（配 `lib/preload-charm.cjs`，暴露 `window.dshPendant`：拖动 + 右键菜单）；
  `installCharmHandlers()`（`:7908`）注册 4 条 IPC；启动时 `:12367` `if (readCharmState().enabled) showCharm()`；
  主应用 preload（`lib/preload-app.cjs:880`）还暴露了 `window.dshWhaleCharm = { state(), set(bool), onChange(fn) }`，
  主进程侧有对应 handler（`:12165`，`win32` 才有）。
- **根因**：**整个安装包里没有任何代码调用那座桥。** 全归档 + `app.asar.unpacked` 里搜
  `dshWhaleCharm` / `charm-state`，命中的只有 preload 的暴露处。于是 `userData/whale-charm.json`
  永远是默认的 `enabled: false`，`showCharm()` 永远不被调用 —— 「设计意图实现了、出口忘了接」。
  设计意图的残留物是 `vendor\whale\materials\client\whale-charm-settings.js`（一个 ESM 形态的
  Cordis 客户端插件，`settings.general.item` 里那一行开关），但它不在这 11 条声明里，从来没被打进安装包。
- **修法（不碰安装包）**：把这一行加在**已有的 L1 插件** `plugins/dsh-up-t` 的客户端半侧
  （`settings.general.item`、`replaceRisk: none`），而不是新增 asar 声明。这样它随 profile 目录走，
  Harness 升级不覆盖；而且客户端 bundle 是**按 mtime 重读**的 ⇒ **硬刷新即生效，连落盘都不需要**。
  这正是四层判据「能用 L0/L1 表达的绝不去动 L3」带来的直接好处。
- **为什么这不算「顺手改了别的东西」**：这一行只是把一个**已经存在但没人调用的官方桥**接到界面上，
  不加任何新机制；关掉它挂件就没了，与出货 Harness 的默认行为一致。
- **怎么验的**：`test\plugin.test.mjs` 的 9 条新断言（46 → **55** 条）钉住它的**失败路径**：
  桥不在（Web 形态）、桥在但调用被拒（非 Windows 没有那两个 IPC handler）、切换失败必须把开关放回原位
  并留下 `console.warn`、切换中不可连点、卸载要撤掉监听，以及「`charm-changed` 通道里的字符串
  `"replay"` 不是状态」（把它当状态会让开关在挂件其实开着的时候显示成关）。
- **已知但故意没修**：挂件右键菜单的「Replay animation」把 `"replay"` 发给**主窗口**，
  而鲸鱼启动画面只存在于**欢迎窗口**（`welcome.html` + `renderer/whale-splash.js`）——
  `welcomeWindow` 与 `installCharmHandlers` 不在同一个函数作用域内，所以这条消息没有收件人。
  要修得打通主进程作用域，属于必须改安装包的独立一步。
- **教训**：**「机制齐备」和「有人用它」是两件事。** 这次的缺陷不在任何一处代码里，
  而在「少了一处调用」—— grep 一个 API 名，命中的全是它的定义与暴露处、没有一处使用处时，
  那通常不是「文档没写」，而是**出口真的忘了接**。

### 2026-10-06 · 登录窗口页面被换成了「预览页」：替换素材没有锚点保护

- **症状**：**没有任何症状** —— 构建 exit 0、11 个条目按声明改动、其余 11,466 个条目逐字节一致、
  `node --check` 全过、`doctor` 也不报错。它只会在**登录/欢迎窗口**真的出现时表现出来：窗口打开了，
  里面什么都没有。
- **怎么发现的**：给 `_whale-splash` 的渲染层找最后一条离线证据时，先问了一句「替换页在归档里到底引用了什么」。
  `renderer/welcome.html` 是 DSH 的欢迎/登录窗口页面（`lib/main.js` 的 `openWelcomeWindow()` 用
  `loadFile(join(app.getAppPath(), "renderer", "welcome.html"))` 载入），三处不对。
- **三处问题**：
  1. 漏了原版加载的 `../lib/welcome/welcome.js`（欢迎界面自己的 React 启动脚本，挂到 `#root`）
     与 `../lib/welcome/welcome.css` ⇒ `#root` 永远是空的，登录界面不会出现；
  2. `../lib/welcome/whale-splash.js` 指向一个归档里**不存在**的条目（它实际插入在
     `renderer/whale-splash.js`）⇒ splash 控制器 404，画布上什么都不画；
  3. CSP 少了 `font-src 'self'` ⇒ 品牌字体被 `default-src 'none'` 拦掉。
- **根因**：`action: replace` 的素材是**手写的**，和 `action: patch` 完全不同 —— patch 的素材是原版那份文件，
  构建时逐字节校验，锚点错一处就命中不了；而 replace 的素材只被检查「与原来不同」，
  **从不检查「是不是少了什么」**。这一页应该是从离线预览页改来的（`vendor\whale\materials\preview.html`
  就是同一批脚本的预览载体，当时在 `.probe\build\`），改的时候把应用自己的启动脚本一起删掉了。
- **修法**：改声明里的 `source`（`vendor\whale\materials\renderer\welcome.html`）—— 恢复 `font-src 'self'`、
  `../lib/welcome/welcome.css`、`../lib/welcome/welcome.js`，并把 splash 控制器指向同目录真实存在的
  `whale-splash.js`；页内注释写明这三样为什么必须留着。重新 `node vendor\whale\build.mjs` →
  11 个条目按声明改动（`renderer/welcome.html` 645→1510）。
- **怎么防止再来一次**：新增 `test\assets.test.mjs`（28 条断言，发现式总入口自动收进第 8 套）。三条不变量：
  **A.** 被 insert/replace 的 HTML，它引用的每个本地资源都必须在归档里存在；
  **B.** `action: replace` 的页面不许丢掉原版引用过的任何资源；
  **C.** 替换页的 CSP 不许比原版更严（更严 = 原来能加载的现在加载不了）。
  坏版本原文留在 `test\fixtures\welcome-html-broken-before-2026-10-06.html`（sha256 前 16 位 `5BC23F972FCC30A6`），
  测试直接拿它当反例 —— 既证明规则会响，也证明「就是这些规则没响才放它过去」。
- **教训**：**只有 `patch` 类素材受锚点保护。手写素材通过「字节核对」不代表内容正确 —— 字节核对回答的是
  「是不是按声明改了」，从不回答「改对了没有」。** 凡是「替换一整个文件」的动作，都必须额外问一句：
  原来那一份加载的东西，新的这一份还在加载吗？

### 2026-10-06 · 发现「已构建未落盘」的那份产物是坏构建

- **改了什么**：没有改。删除了 `D:\Program Files (x86)\deepseekharness\resources\app.asar.tmp`（121,415,608 B，mtime 2026-10-01 10:21:16）。
- **为什么**：把它里面的 `lib/main.js` 抽出来 `node --check` → **exit 1**：
  `SyntaxError: Identifier 'readFileSync' has already been declared`（第 5 行注入的 `import { readFileSync, writeFileSync } from "node:fs";` 与第 8 行原版 esbuild 产物的同名 import 冲突）。
  落盘后主进程会拒绝启动。旧 `README-whale-splash.md` 里「已构建打包完成但未落盘」的说法**与事实不符**。
- **根因**：`tools/patch-main.mjs` 无条件插入 `node:fs` import，没检查原版是否已声明。（修法见 T5 记录。）
- **怎么验**：`node vendor/asar/list.mjs --archive "<旧 tmp>" --get lib/main.js <out>` 后 `node --check <out>`。
- **怎么撤**：不需要撤 —— 该文件是可再生中间产物，`node vendor/whale/build.mjs` 1 秒重建。
- **副作用**：`doctor` 的「残留 app.asar.tmp」警告消失，警告数 3 → 2。

### 2026-10-06 · 暂存包 `state/staged/app.asar` 构建通过并交叉验证

- **改了什么**：无（构建产物，不进 git）。`node vendor/whale/build.mjs` → exit 0。
- **为什么**：为落盘准备一份**语法正确**的整包。
- **怎么验**：
  - 构建阶段自检：`11 个条目按声明改动，其余 11466 个条目逐字节一致`。
  - 7 个 JS 产物全部 `node --check` 通过。
  - 与旧坏暂存包交叉比对：`node vendor/asar/verify.mjs "<旧 tmp>" state/staged/app.asar --expect 2`
    → `OK：恰好 2 个预期条目不同，其余逐字节一致`，差异即 `lib/main.js 497450 -> 497395`（删掉重复 import）与 `lib/welcome/whale-animation.js 23820 -> 23828`（换掉 banner）。**确定性构建**获得独立证据。
- **怎么撤**：`node vendor/whale/install.mjs --rollback`。

### 2026-10-06 · 落盘链路现在可以离线演练（`install.mjs --to` + `test/install.test.mjs`）

- **改了什么**：
  - `vendor/whale/install.mjs` 新增 `--to <archive>` 与 `/dry` 包装：把暂存包**复制**到临时目标
    （不是 rename —— 真落盘那条路会把暂存包移走，而演练之后人还要用同一个暂存包去落盘）、
    在临时目标上跑**同一段**声明核对；`--to` 落在安装目录里一律拒绝，`--to` 指向在用 asar 时
    刻意按真落盘处理（不给它开后门绕过 Harness 守卫）。
  - `install-whale.cmd` 增加 `/dry`（不用退出 Harness 的演练）与落盘后的 `dsht accept` 提示。
  - 新增 `test/install.test.mjs`（26 条断言，套数 5 → 6）。
- **为什么**：这条路径过去只在**真落盘那一刻**才被验证 —— 一年做几次的事等于没验证，而它最危险的
  两种坏法都很安静：写之前忘了确认 Harness 退出；写完只看退出码、不核对「实际改的条目集合」是不是
  声明里那几条（锚点全命中、却静默改了别的东西）。
- **怎么验**：`node test/install.test.mjs` → 26/26，4.1 秒。它真跑：两次独立构建 sha256 相同（确定性）→
  `upgrade --stage` 重打 → `--to` 演练落盘 → 按原版备份核对差异集合恰好 = 声明数 = 列出数 →
  三条拒绝路径（无 `--yes` / 目标在安装目录内 / Harness 在跑时 `assertHarnessStopped` 拦下）→
  **全程前后在用 `app.asar` 与原版备份 sha256 均未变**。
- **怎么撤**：`--to` 是新增分支，删掉即回到旧行为；演练产物落在 `state/cmp/`（已 gitignore）且测试自清。
- **副作用 / 教训**：`install-whale.cmd` 里**不能出现非 ASCII 字节**。cmd.exe 按当前代码页解析这个文件，
  中文 `rem` 注释会把后续行嚼成 `'K]' is not recognized as an internal or external command` 之类的假错误，
  而且退出码会是 0（看起来像成功）。现在该文件是纯 ASCII + 中文说明放在本 README 里。
  （顺带：LF 行尾在这个文件上实测没问题，坏的是字节而不是行尾。）

### 2026-10-06 · 「Replay animation」原来是空操作（消息发给了一个不存在的收件人）

- **症状**：挂件右键菜单里的「Replay animation」点了没反应，**而且不报错** —— 没有异常、没有日志、
  没有失败回调。一个安静到极点的 bug。
- **根因**：`patch-main.mjs` 里那句 `mainWindow?.webContents.send(CHARM_IPC.changed, "replay")`。
  `CHARM_IPC.changed` 的监听方是**启动画面**，而启动画面跑在**欢迎窗口**（`renderer/welcome.html`）里；
  `mainWindow` 是主窗口。字符串发出去了，没有收件人。`?.` 又顺手吃掉了「窗口不在」这一种失败，
  于是「发失败」也不可见。
- **改了什么**：
  - `vendor/whale/patch-main.mjs` 新增 `replaySplash()`：主进程**自己**开一个 600×700、无边框、
    透明、不可交互、`skipTaskbar`、`alwaysOnTop` 的短命窗口，
    `loadFile(join(app.getAppPath(), "renderer", "replay.html"))`，`ready-to-show` 时 `showInactive()`；
    菜单项改成 `await replaySplash()`。
  - 安全网 `REPLAY_MAX_MS = 2e4`：20 秒后无条件销毁 —— 动画卡住也不会留一个隐形窗口挡着点击。
  - 应用退出时在 `destroyCharm()` 之后补 destroy 这个窗口。
  - 新增素材 `renderer/replay.html`（966 B）+ `renderer/replay.js`（2144 B）⇒ `patches/T1-whale-splash.yml`
    的 `verify.expect_diff_entries` 11 → **13**，`syntax_check` 加上 `renderer/replay.js`。
  - `test/splash.test.mjs` 19 → **23** 条：新增 replay 一节，且**允许它缺席**（归档里没有
    `renderer/replay.js` 就跳过节、打印一句，其余照跑 —— 落盘前也能全绿，但不把「没测到」折成「过了」）。
- **为什么**：这是唯一一处「用户点得到、却什么都不会发生」的入口。而且它只能靠改安装包修 ——
  修法是打通主进程作用域，不是 L1 插件能兜住的。
- **怎么验**：`node test/run.mjs` → 10/10 套；`node test/splash.test.mjs` → 23/23；
  `node vendor/whale/build.mjs` → exit 0、`13 个条目按声明改动，其余 11466 个条目逐字节一致`、
  8 个 JS 产物全部 `node --check` 通过、产物 121,421,944 B。
  剩下的只有**肉眼**：落盘重启后右键挂件 → Replay animation，应看到动画重播一次后自己消失。
- **怎么撤**：`node vendor/whale/install.mjs --rollback`；或 git 回到本提交之前（声明与素材一起走）。
- **教训**：`?.` 与 `send()` 都不会告诉你「收件人不存在」。凡是要跨窗口投递的消息，
  值得在发送处问一句「谁在听」—— 或者干脆像这里一样，由发消息的人自己把事做完。
