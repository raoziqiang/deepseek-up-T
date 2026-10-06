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
- [ ] 鲸鱼启动动画落盘：`node vendor/whale/build.mjs` 已通过，**完全退出 Harness（含托盘）**后 `node vendor/whale/install.mjs --yes`
- [ ] 把主题/气泡等偏好从 asar 侧迁到 `dsh-whale-widget` 的 L1 设置

## 验收

1. 启动 Harness 时实际播放画卷→鲸鱼→挂件动画。
2. `node src/cli.mjs doctor` 中原版备份与当前 `app.asar` 的 sha256 **不再一致**（证明确实落盘了）。
3. 回滚：`node vendor/whale/install.mjs --rollback`，或 `node src/cli.mjs snapshot restore <id>`（仅覆盖 profile 控制面）。

## 记录

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
