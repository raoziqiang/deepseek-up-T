# T1 · 外观与体验

> 启动、界面、常驻元素都符合自己的审美与习惯。

## 现状

- 启动动画素材与管线在 `../whale-motion/`（192 帧 PNG、`render.py`、`cutout.py`、`tune_mask.py`）。
- 构建与落盘工具在 `../tools/`（`build-whale.mjs`、`install-whale.mjs`、`asar-write.mjs`、`asar-verify.mjs`）。
- `dsh-whale-widget@0.3.18` 已装为 **L1 插件**：Web 右下角余额小鲸鱼、气泡点击序列、音效、角色、动图。
- 数据目录：`.dsh/whale-audio`、`.dsh/whale-bubble-imgs`、`.dsh/whale-roles`（多数为空）。
- **动画未落盘**：`app.asar` 与 `app.asar.whale-backup` 的 sha256 一致（`doctor` 可验）。

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

- [ ] 清理 `app.asar.tmp` 残留（115.8 MB）——先确认它是不是想要的那版产物
- [ ] 鲸鱼启动动画落盘：先 `node ../tools/build-whale.mjs`，**退出 Harness（含托盘）**后再 `--install`
- [ ] 把主题/气泡等偏好从 asar 侧迁到 `dsh-whale-widget` 的 L1 设置

## 验收

1. 启动 Harness 时实际播放画卷→鲸鱼→挂件动画。
2. `node src/cli.mjs doctor` 中原版备份与当前 `app.asar` 的 sha256 **不再一致**（证明确实落盘了）。
3. 回滚：`node ../tools/install-whale.mjs --rollback`，或 `node src/cli.mjs snapshot restore <id>`（仅覆盖 profile 控制面）。

## 记录

_（每次改动在此追加：改了什么 / 为什么 / 怎么验 / 怎么撤）_
