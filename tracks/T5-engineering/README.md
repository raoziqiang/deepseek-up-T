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
| `node src/cli.mjs precheck` | **权威组合预检**：隔离探针家里 dump 出运行中应用真正会看到的清单（真实 profile 只读、`$DSH_HOME` 不被写入） |
| `node src/cli.mjs asar ls [正则]` | 列安装包条目；无正则时按顶层目录汇总 |
| `node src/cli.mjs asar cat <路径>` | 读出安装包里单个条目的**原文**（`--out` 落盘） |
| `node src/cli.mjs asar grep <正则>` | 在安装包内容里检索（只扫文本类条目） |

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

- [x] **权威组合预检** —— `dsht precheck`，2026-10-06 完成，见下方记录
- [x] **只读安装包工具** —— `dsht asar ls|cat|grep`，2026-10-06 完成
- [ ] 归拢到 `vendor/`，统一入口，去掉对 `../` 的相对依赖
- [ ] **升级检测**：把 `state/baseline.json` 里的 `app.asar` sha256 与当前比对，版本变了就提示哪些 L3 改动需要重打
- [ ] **L3 改动的声明式描述**：`patches/<track>-<slug>.yml` 描述「改哪个文件、锚点是什么、替换成什么」，让补丁可审计可重放（L0 的 YAML 副本已在做，见 `patches/T3-session-search.yml`）
- [ ] 快照保留策略：自动保留最近 N 份 + 所有带标签的
- [ ] `doctor` 扩展：接入 profile 重载后的运行时探测
- [ ] 处置 `app.asar.tmp` 残留（115.8MB，doctor 每次都会 WARN）

## 验收

在干净机器上：`doctor` → 应用补丁 → 落盘 → 复验，全程无需人工记忆任何步骤。

## 记录

### 2026-10-06 · 打通「权威组合预检」（M1 第一件）

**为什么**
`desktop` profile 被 Electron 应用独占，CLI 直接拒绝 dump：
`error: profile "desktop" is managed exclusively by the Electron application`。
于是改 `cordis.patch.yml` 这件事**没有任何编译期/预检反馈**，只能改完重启赌一把。
而 in-box 插件（`dsh-client-ui-chat`、`dsh-client-ui-settings-account`、
`dsh-agent-preset-registry`、4 个 `dsh-experimental-*`）**只存在于 `app.asar` 内**，
磁盘无目录、lock 无引用 —— 想改它们的行为，**只能**走 profile 层 patch 覆盖 config，
所以这条预检链路是必需的，不是锦上添花。

**做成了什么**
`src/precheck.mjs` + `dsht precheck`：搭隔离探针家 → Electron-as-Node 跑 **asar 内那份**
`@deepseek-ai/dsh/lib/bin.js --dump-config` → 分类 stderr → 与上一次逐条目比对。
新增 `dsht asar ls|cat|grep`，能直接读归档里**真正在跑的那份代码**。

**三个坑（都已写进 docs/06-precheck.md）**
1. Electron 是 GUI 子系统 exe：PowerShell `&` 调用会立刻返回，退出码为空、输出 0 字节，
   看起来像「成功但没输出」。必须 `Start-Process -Wait -Redirect*`，本项目用 `spawnSync` 读管道。
2. 少了 junction 就刷 `skipping profile bundle "..."`，随后 `patch: entry "..." not found`。
   junction 在 Windows 下不需要管理员权限。
3. dump 里 `# == <bundle>, patched by <探针家绝对路径>` 是层边界标记，必须整行剔除，否则污染 diff。

**更正一个此前的错误假设**
我原先认为「`profiles/node_modules/@deepseek-ai/*`（junction 到 `D:\Z1848\dsh-desktop-build`）
才是运行中的代码」。**错的**。`resolveBundleDir` 是**安装锚点优先**（app-boot 的显式契约：

```js
for (const anchor of [installAnchor, join(profileDir, "package.json")]) { ... }
```

注释原文：`The installation-first order is the contract that @deepseek-ai/dsh-base (and every other
in-box bundle) always comes from the same installation as the running dsh, never from a profile-local copy.`）。

活证据是 `cordis_inspect_query` 返回的 `packageDir`：
`D:\Program Files (x86)\deepseekharness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-session-query-sqlite`。
⇒ 运行中的 DSH 从 **asar** 加载 in-box 包。而 asar / junction 构建树 / `D:\Z1848\deepseek-harness` 源码仓库
三者版本**并不相同**（例：运行版的 `dsh-session-query-sqlite` 有 `persistedReadConcurrency` +
`preparedSessionCacheSize`，junction 树那份是 `persistedInspectConcurrency` 且没有后者）。
**判据：查事实一律以 asar 为准，读源码仓库只用于理解意图。**

**怎么验**
`dsht precheck` 在 T3 改动上的实跑：退出码 0、stderr 0 字节，「0 新增 / 0 移除 / 1 修改」，
恰好是预定的两行。

**另一个顺手修掉的精度问题**
`cordis.mjs` 的 `jsTagCount` 原本直接 `src.match(/!!js/g)`，把真实 `cordis.patch.yml` 第 3 行
**注释里**的 `!!js` 说明文字算成了表达式（doctor 报「1 处」而实际是 0）。已改为先 `stripComment()`
再计数。
