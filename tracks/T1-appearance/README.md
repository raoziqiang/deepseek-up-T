# T1 · 外观与体验

> 启动、界面、常驻元素都符合自己的审美与习惯。

## 现状

- 启动动画素材与管线在 `../whale-motion/`（192 帧 PNG、`render.py`、`cutout.py`、`tune_mask.py`）。
- 构建与落盘工具已归拢到 `vendor/whale/`（`build.mjs`、`install.mjs` + 三个 patcher + `bundle.mjs`），声明在 `patches/T1-whale-splash.yml`。
- `dsh-whale-widget@0.3.18` 已装为 **L1 插件**：Web 右下角余额小鲸鱼、气泡点击序列、音效、角色、动图。
- 数据目录：`.dsh/whale-audio`、`.dsh/whale-bubble-imgs`、`.dsh/whale-roles`（多数为空）。
- **动画仍未落盘**：`app.asar` 与 `app.asar.whale-backup` 的 sha256 一致（`doctor` 可验）。
- **待落盘的暂存包已就绪且已验证**：`state/staged/app.asar`（121,415,560 B，11 条目按声明改动，其余 11,466 条目逐字节一致）。

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

## 验收

1. 启动 Harness 时实际播放画卷→鲸鱼→挂件动画。
2. `node src/cli.mjs doctor` 中原版备份与当前 `app.asar` 的 sha256 **不再一致**（证明确实落盘了）。
3. 回滚：`node vendor/whale/install.mjs --rollback`，或 `node src/cli.mjs snapshot restore <id>`（仅覆盖 profile 控制面）。

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
  差异集合 = 4 改（`renderer/welcome.html` 645→991、`lib/main.js` 490173→497395、
  `lib/preload-app.cjs` 41075→41776、`dsh-api-session-controller/lib/index.js` 124151→125198）
  + 7 增（`renderer/whale.css`、`renderer/whale-splash.js`、`renderer/pendant.html`、
  `renderer/pendant.css`、`renderer/pendant.js`、`lib/preload-charm.cjs`、`lib/welcome/whale-animation.js`）。
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
