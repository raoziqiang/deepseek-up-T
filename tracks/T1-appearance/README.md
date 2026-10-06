# T1 · 外观与体验

> 启动、界面、常驻元素都符合自己的审美与习惯。

## 现状

- 启动动画素材与管线在 `../whale-motion/`（192 帧 PNG、`render.py`、`cutout.py`、`tune_mask.py`）。
- 构建与落盘工具已归拢到 `vendor/whale/`（`build.mjs`、`install.mjs` + 三个 patcher + `bundle.mjs`），声明在 `patches/T1-whale-splash.yml`。
- `dsh-whale-widget@0.3.18` 已装为 **L1 插件**：Web 右下角余额小鲸鱼、气泡点击序列、音效、角色、动图。
- 数据目录：`.dsh/whale-audio`、`.dsh/whale-bubble-imgs`、`.dsh/whale-roles`（多数为空）。
- **动画仍未落盘**：`app.asar` 与 `app.asar.whale-backup` 的 sha256 一致（`doctor` 可验）。
- **待落盘的暂存包已就绪且已验证**：`state/staged/app.asar`（121,416,081 B，11 条目按声明改动，其余 11,466 条目逐字节一致）。

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
- [ ] 鲸鱼启动动画落盘：**运行 `install-whale.cmd`**（先完全退出 Harness，见下方操作清单）
- [x] 把主题/气泡等偏好从 asar 侧迁到 `dsh-whale-widget` 的 L1 设置 —— **侦察后结论是「本来就不该这么做」**：`dsh-whale-widget` 0.3.18 的 `package.json` 只声明 `dsh.bundle.patch`，**没有任何 `Config` schema**，它的偏好本来就不在 asar 里，而是落在 `$DSH_HOME\.dshw-size.json` / `.dshw-turn.json` / `.dshw-usage.json`（设备本地，随用随写）。四层改造面（L0–L3）管的是**组合与代码**，不管这层用户数据。⇒ 这条待办的前提是错的，撤销；真要改默认值应改 widget 自己的默认值（L1 包内），而不是「迁到 L1 设置」（见下方记录）。
- [x] 桌面挂件窗口的**开关**（设置 →「通用」里那一行）—— 2026-10-06 完成：出货 Harness 有整套挂件机制，却没有任何代码调用 `window.dshWhaleCharm`，于是 `whale-charm.json` 永远是 `enabled: false`、挂件永不出现且不报错。开关改由 L1 插件 `dsh-up-t` 提供（`settings.general.item`），**不碰安装包、硬刷新即生效**。见下方记录与 [plugins/dsh-up-t/README.md](../../plugins/dsh-up-t/README.md)。
- [ ] 桌面挂件菜单的「Replay animation」目前是空操作（`"replay"` 发给主窗口，而启动画面在欢迎窗口）—— 要修必须改安装包（打通主进程作用域），单独一步。

## 验收

1. 启动 Harness 时实际播放画卷→鲸鱼→挂件动画。
2. 设置 →「通用」里出现「桌面鲸鱼挂件」开关；打开后桌面上出现小鲸鱼（可拖动、右键有菜单），关掉即消失。
3. `node src/cli.mjs doctor` 中原版备份与当前 `app.asar` 的 sha256 **不再一致**（证明确实落盘了）。
4. 回滚：`node vendor/whale/install.mjs --rollback`，或 `node src/cli.mjs snapshot restore <id>`（仅覆盖 profile 控制面）。

## 落盘操作清单（T1）——为什么是「你点，而不是我点」

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

- 暂存包与声明**完全吻合**：`node vendor/asar/verify.mjs "<app.asar.whale-backup>" state\staged\app.asar --expect 11`
  → `OK：恰好 11 个预期条目不同，其余逐字节一致`（比较 11,466 个归档内条目 + 1,497 个 unpacked 条目），
  差异集合 = 4 改（`renderer/welcome.html` 645→1510、`lib/main.js` 490173→497395、
  `lib/preload-app.cjs` 41075→41776、`dsh-api-session-controller/lib/index.js` 124151→125198）
  + 7 增（`renderer/whale.css`、`renderer/whale-splash.js`、`renderer/pendant.html`、
  `renderer/pendant.css`、`renderer/pendant.js`、`lib/preload-charm.cjs`、`lib/welcome/whale-animation.js`）。
- **引用完整性**已单独核对（`node test\assets.test.mjs`）：这两页 HTML 引用的每个本地资源都真的在归档里，
  且替换页没有丢掉原版加载过的东西（见下方「登录窗口页面」那条记录 —— 这正是它抓出来的）。
- 脚本的守卫路径**已实测**：Harness 运行中运行它 → 打印 `[STOP]`、`exit 2`、**不动任何文件**。
- `install.mjs` 自己在落盘后还会**按声明逐项比对差异集合**，多一条少一条都判失败并提示回滚；
  原版备份 `app.asar.whale-backup` 在落盘前已存在且与当前 `app.asar` 逐字节一致。

**落盘后怎么验**（重启之后）：

| 看什么 | 期望 |
| --- | --- |
| 启动时的画面 | 画卷 → 鲸鱼 → 桌面挂件动画 |
| `node src/cli.mjs doctor` | 「原版备份可比对」那行**不再是「完全一致」** |
| `node src/cli.mjs upgrade` | `T1-whale-splash` 从「未应用」变成 `applied`，退出码 0 |

**出问题怎么退**：`node vendor\whale\install.mjs --rollback`（从备份恢复，恢复后自带逐字节核对）。

**记录**

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
  设计意图的残留物还在仓库外：`.probe\build\client\whale-charm-settings.js`（一个 ESM 形态的
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
  **从不检查「是不是少了什么」**。这一页应该是从离线预览页改来的（`.probe\build\preview.html`
  就是同一批脚本的预览载体），改的时候把应用自己的启动脚本一起删掉了。
- **修法**：改声明里的 `source`（`.probe\build\renderer\welcome.html`）—— 恢复 `font-src 'self'`、
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
