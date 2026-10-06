# T5 · 工程化

> 让改造本身可复现、可审计、可回滚，升级后能快速重打。

## 已交付（M0）

| 命令 | 作用 |
| --- | --- |
| `node src/cli.mjs env` | 打印全部关键路径与存在性；`--json` 机器可读 |
| `node src/cli.mjs doctor` | 体检：组合层不变量 / 包解析三条根 / 安装包完整性 / 进程占用。退出码 1 = 有 error |
| `node src/cli.mjs snapshot create -m "..."` | 给 profile 控制面留快照（含 `app.asar` 指纹） |
| `node src/cli.mjs snapshot list` | 列出快照 |
| `node src/cli.mjs snapshot diff <id>` | 快照与当前现场对比（文件级 sha256） |
| `node src/cli.mjs snapshot restore <id>` | 回滚（需 `--yes`，回滚前自动再留一份） |
| `node src/cli.mjs baseline write` | 固化 `state/baseline.json` |

代码在 `src/`，**零依赖**——`doctor` 必须在「DSH 装坏了」的时候还能跑。

## 待归拢的既有资产

`../tools/` 下有 20 多个已经过验证的脚本：

| 脚本 | 作用 |
| --- | --- |
| `asar-list.mjs` | 列出归档条目 |
| `asar-write.mjs` | **单条目重写**，其余条目字节保持不变 |
| `asar-verify.mjs` | 逐条比对两个 asar，`--expect N` 校验「恰好 N 处预期差异」 |
| `patch-main.mjs` | 对 `lib/main.js` 做锚点替换（锚点必须唯一，否则报错） |
| `patch-preload.mjs` | 对 `lib/preload-app.cjs` 做锚点替换 |
| `bundle-whale.mjs` | 把动画模块打成 CSP 允许的经典脚本 |
| `build-whale.mjs` | 一键：打包 → 打补丁 → 语法检查 → 重打包 → 交付 |
| `install-whale.mjs` | 落盘（检测 Harness 是否运行）或 `--rollback` |
| `capture-frames.mjs` | 无头 Chrome + CDP 按时间轴截图 |
| `trace-whale.mjs` | 在真实渲染像素上描轮廓，打印 ASCII |
| `analyze-frames.mjs` | 统计每帧占比与质心轨迹 |

## 待办

- [ ] 归拢到 `vendor/`，统一入口，去掉对 `../` 的相对依赖
- [ ] **升级检测**：把 `state/baseline.json` 里的 `app.asar` sha256 与当前比对，版本变了就提示哪些 L3 改动需要重打
- [ ] **L3 改动的声明式描述**：`patches/<track>-<slug>.yml` 描述「改哪个文件、锚点是什么、替换成什么」，让补丁可审计可重放
- [ ] 快照保留策略：自动保留最近 N 份 + 所有带标签的
- [ ] `doctor` 扩展：接入 profile 重载后的运行时探测

## 验收

在干净机器上：`doctor` → 应用补丁 → 落盘 → 复验，全程无需人工记忆任何步骤。

## 记录

_（每次改动在此追加：改了什么 / 为什么 / 怎么验 / 怎么撤）_
