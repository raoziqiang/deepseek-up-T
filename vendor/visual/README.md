# `vendor/visual/` —— 靠「量出来的像素」回答「画得像不像」

这一层只回答一类问题：**渲染出来到底是什么形状、什么颜色**。
它不回答「代码跑起来对不对」——那是 `test/splash.test.mjs`（假 DOM 行为单测）和
`test/settings.test.mjs`（真 React 渲染 + 迷你 hook 主机）的活。

几个脚本都是归拢过来的独立小工具（原在 `tools/`），**没有任何外部 npm 依赖**：
自写 WebSocket、自写 PNG 解码（`node:zlib` inflate）、扫线填充贝塞尔轮廓。
`vendor/lib/harness.mjs` 只被 `check-whale-shape.mjs` 用来定位产物路径。

## 一览

| 脚本 | 用法 | 外部依赖 | 会写盘 |
| --- | --- | --- | --- |
| `capture-frames.mjs` | `node vendor/visual/capture-frames.mjs <previewUrl> <outDir> [--times 0.08,0.25,…]` | **真 Chrome**（路径硬编码）+ CDP 端口 9333 | `<outDir>/frame-<t>.png`（`outDir` 相对 cwd） |
| `trace-whale.mjs` | `node vendor/visual/trace-whale.mjs <frame.png> [--cols 96] [--rows 40]` | 无 | 否 |
| `analyze-frames.mjs` | `node vendor/visual/analyze-frames.mjs <dir>` | 无 | 否 |
| `frame-colors.mjs` | `node vendor/visual/frame-colors.mjs <frame.png>` | 无 | 否 |
| `check-whale-shape.mjs` | `node vendor/visual/check-whale-shape.mjs [--out <file>]` | 无（不需要 Chrome） | `$WORKSPACE/.probe/frames/whale-silhouette.txt` |
| `serve-dir.mjs` | `node vendor/visual/serve-dir.mjs <dir> [port]`（默认 `preview.html`、8129） | 无 | 否 |

`$WORKSPACE` 默认是项目上一级（即本机 `D:\Z1848\harness-ds`），可用环境变量 `DSH_UP_T_WORKSPACE` 覆盖。
**所有路径都不从 cwd 推**——脚本可以在任何目录下被调用，产物仍落在同一个地方。

## 逐个说清楚

### `capture-frames.mjs` —— 唯一需要真浏览器的一个

- 硬编码：`C:\Program Files\Google\Chrome\Application\chrome.exe`、端口 `9333`、
  视口 **600×700**（对齐欢迎窗口），`--headless=new` + 临时 `--user-data-dir`。
- `--times` 默认 `0.08,0.25,0.42,0.6,0.75,0.88,1.0`；每帧执行
  `s.stop(); s.reduced = false; s.render(t, 2400)` 后 `Page.captureScreenshot`。
- **必须先有 `window.__splash`**：脚本第 219-227 行检查，不可用就报
  `capture: window.__splash() unavailable; cannot scrub frames` 并 exit 1。
  这个钩子只由 `vendor/whale/materials/preview.html:93`（`window.__splash = () => splash`）提供 ⇒
  **它只能对着 `preview.html` 抓帧，不能对着归档里的 `welcome.html`。**
  典型用法：先 `node vendor/visual/serve-dir.mjs vendor/whale/materials`
  （该目录里同时有 `preview.html` 和它 import 的 `./whale-animation.js`），
  再对着 `http://127.0.0.1:8129/preview.html` 抓。

### `trace-whale.mjs` / `analyze-frames.mjs` / `frame-colors.mjs` —— 纯读像素

- `trace-whale.mjs`：对真实渲染像素描轮廓，打 ASCII 图 + 形状指标。它的分类器只认鲸鱼**身体**
  的饱和深蓝——水带的红通道高得多、纸接近中性，三者可分。这是它能在没有 alpha 通道的情况下
  把鲸鱼从背景里抠出来的原因。
- `analyze-frames.mjs`：`readdir(dir)` 取 `*.png` 排序后逐帧报颜色分布、蓝色像素纵向范围、纸/水区位置。
- `frame-colors.mjs`：诊断「喷溅」分类，报分区占比与上半区主色（`top colors in <file> (WxH):`）。

### `check-whale-shape.mjs` —— 不需要浏览器，但有一条**维护义务**

它不复用 canvas，而是用扫线填充**同一套贝塞尔轮廓**（`whalePath()` / `finPath()`）。
控制点是**从 `vendor/whale/materials/whale-animation.js` 手工抄来的**（文件注释写着
「Keeping it in sync matters」）⇒ **改了动画里的控制点，这里必须同步改**，否则它给出的
「形状对」是旧形状的结论。

输出路径：默认 `$WORKSPACE/.probe/frames/whale-silhouette.txt`，可用 `--out <file>` 改；
目录不存在会自动创建。**以前这里写的是相对 cwd 的 `.probe/frames/...` 且不 mkdir，
从项目目录运行必然 ENOENT**——已修，因为「路径靠 cwd 决定就会静默写错位置」正是
`vendor/README.md` 里明令避免的那一类问题。

`--cols/--rows` 之类参数没有：它固定出 96×32 的 ASCII 预览 + 一组数值指标。

### `serve-dir.mjs`

`/` 默认映射到 `preview.html`；带 `file.startsWith(root)` 越权守卫；响 `cache-control: no-store`；
MIME 表覆盖 html/js/mjs/css/svg/png/json。ESM 必须经 http 才能加载，所以本机预览离不开它。

## 什么时候不该用它们

- **问「代码逻辑对不对」**：用 `test/splash.test.mjs`（19 条，假 DOM，秒级、无需 Chrome）。
- **问「设置页会不会白屏」**：用 `test/settings.test.mjs`（真 React + 迷你 hook 主机）。
- 上面两个测试是**断言**（红了就是坏了）；本目录这些脚本是**取证的仪器**（打印数字给人看）。
  能写成断言的就别留在仪器里。

## 冒烟（可复现）

```powershell
node vendor/visual/check-whale-shape.mjs        # exit 0；VERDICT: tail notch present (reads as flukes)
node vendor/visual/serve-dir.mjs vendor/whale/materials   # → http://127.0.0.1:8129/preview.html
# 需要真 Chrome 的两个（抓帧 / 描轮廓）；outDir 是唯一还看 cwd 的参数，给绝对路径最省事：
node vendor/visual/capture-frames.mjs http://127.0.0.1:8129/preview.html D:\Z1848\harness-ds\.probe\frames
node vendor/visual/trace-whale.mjs D:\Z1848\harness-ds\.probe\frames\frame-0_42.png
```

`check-whale-shape.mjs` 的基线数值（2026-10-06 实测）：`bbox aspect (w/h) = 1.59`、
`fill ratio in bbox = 63.6%`、`tail columns 2-run = 53`、`left/right mass = 59.8% / 40.2%`、
`VERDICT: tail notch present (reads as flukes)`。
