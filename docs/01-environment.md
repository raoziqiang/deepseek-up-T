# 01 · 环境基线

> 本文件记录**实测事实**，不是推测。每条都可用 `node src/cli.mjs env` / `doctor` 复验。
> 基线采集时间：2026-10-06。

## 主机上的 DSH

| 项 | 值 |
| --- | --- |
| 安装目录 | `D:\Program Files (x86)\deepseekharness` |
| Harness 版本 | `44.0.0`（读自 `resources\version`） |
| 主进程产物 | `resources\app.asar` = **121,348,951 字节**（115.7 MB） |
| 归档条目 | **12,967 文件 / 2,609 目录**，头部 JSON 3.2 MB |
| 归档内包数 | **529**，其中 `/dsh/node_modules/` 下 **503** 个是 DSH 插件 |
| 原版备份 | `resources\app.asar.whale-backup` = **121,348,951 字节** |
| 备份 vs 当前 | **sha256 完全一致** ⇒ 当前安装包是**未改造的原版** |
| 残留 | `resources\app.asar.tmp` —— **已于 2026-10-06 删除**（确认是坏构建，见下） |

**结论：鲸鱼启动动画还没有落盘。** `../README-whale-splash.md` 里「已构建打包完成，但差最后一步落盘」的说法**与事实不符**：那份 `app.asar.tmp`（121,415,608 字节，mtime 2026-10-01 10:21:16）里的 `lib/main.js` 过不了 `node --check`：

```
SyntaxError: Identifier 'readFileSync' has already been declared
```

原因是 `patch-main.mjs` 无条件插入 `import { readFileSync, writeFileSync } from "node:fs";`，
而原版 `main.js`（esbuild 产物）第 8 行已声明同名绑定 —— 落盘后主进程会拒绝启动。
已删除该文件（可再生），并在 `vendor/whale/patch-main.mjs` 里修掉根因（只补缺的绑定）。
现在有一份**语法正确、已交叉验证**的暂存包：`state/staged/app.asar` = 121,422,676 字节
（素材已搬进仓库 `vendor/whale/materials/`，重建后与搬家前那一份 sha256 完全相同，
唯一区别是 bundle banner 里那句「从哪一份源生成」不再指向仓库外的路径；
2026-10-06 又加了 replay 两件 —— `renderer/replay.html` + `renderer/replay.js`，声明条目 11 → 13）。
**在用的安装包**（2026-10-06 21:36 落盘的那一份）是 121,421,984 字节 / sha256 `2c6d8b4b…`；
暂存包此后又加了一版 replay 健壮性修复（见 `tracks/T1-appearance/README.md`），
所以现在**暂存包比在用安装包新 692 字节，处于「待落盘」状态** —— 再跑一次
`install-whale.cmd`（或 `node vendor/whale/install.mjs --yes`）就同步了。

## DSH 用户态（DSH_HOME）

| 项 | 值 |
| --- | --- |
| `DSH_HOME` | `C:\Users\Z1848\.dsh` |
| `DSH_PROFILE` | `desktop` |
| `DSH_PROFILE_DIR` | `C:\Users\Z1848\.dsh\profiles\desktop` |
| 内置 Node | `v24.21.0` @ `.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe` |
| 内置 Python | `.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe`（numpy 2.3.5 / pandas 3.0.1 / Pillow 12.3.0 …） |
| 凭据 | `.dsh\.credentials.yaml`（631 字节） |

### profile 布局

```
C:\Users\Z1848\.dsh\profiles\
├── node_modules\@deepseek-ai\        ← 195 个核心包（宿主层，可执行、可读）
├── desktop\                          ← 当前活跃 profile
│   ├── cordis.yml                    → 必须是顶层 []
│   ├── cordis.patch.yml              → ★ 你的个人改造层（5.0 KB / 10 条目）
│   ├── package.json                  → dsh.profile.bundles 组合清单
│   ├── pnpm-workspace.yaml           → 手工调过的下载韧性参数
│   ├── node_modules\                 → 第三方插件 + @furongjun1999
│   ├── .backup-20261003-022753\      → 手工备份（本项目接管后由 snapshot 负责）
│   ├── .dsh-market\                  → 插件市场发现结果与日志
│   └── .plugin-manager\logs\         → 插件安装日志
├── web\
└── headless\
```

## 当前 profile 的组合

`desktop/package.json` 的 `dsh.profile.bundles`（12 项，按顺序叠加）：

1. `@deepseek-ai/dsh-base` — 共享底座
2. `@deepseek-ai/dsh-web-app` — Web 界面
3. `dshmarket` — 插件市场
4. `dsh-context` — 上下文
5. `billion-context` — 上下文
6. `@furongjun1999/dsh-memory` — 记忆
7. `dsh-better-sidebar` — 侧边栏（文件树/编辑器/变更/任务/侧聊）
8. `dsh-whale-widget` — 右下角余额小鲸鱼
9. `@deepseek-ai/dsh-experimental-agent-team-profile` — **仅存在于 app.asar**
10. `@deepseek-ai/dsh-experimental-auto-review` — **仅存在于 app.asar**
11. `@deepseek-ai/dsh-experimental-schedule-bundle` — **仅存在于 app.asar**
12. `@deepseek-ai/dsh-experimental-voice-input-bundle` — **仅存在于 app.asar**

后 4 项在磁盘上没有任何目录、也不在 `pnpm-lock.yaml` 里 —— 它们由安装包提供。这意味着：**它们的版本跟着 Harness 走，不能单独升级。**

## 当前 `cordis.patch.yml` 的 10 条改动

| id | 包 | 关键值 |
| --- | --- | --- |
| `ui-chat` | `dsh-client-ui-chat` *(仅 asar)* | `transcriptView: verbose`、`performanceUsage: detailed`、`linkOpening: new-tab` |
| `ui-settings` | `dsh-client-ui-settings` | `enabled: true` |
| `ui-settings-account` | `dsh-client-ui-settings-account` *(仅 asar)* | `developerTools: true`、`step: done` |
| `permission` | `dsh-permission-presets` | `defaultPreset: danger-full-access` |
| `agent-preset-registry` | `dsh-agent-preset-registry` *(仅 asar)* | `default: standard`、`selectedDefault: cordis` |
| `agent-default-model` | `dsh-agent-default-model` | `provider: deepseek-account`、`model: deepseek-flash`、`reasoningEffort: high` |
| `llm-pi-ai` | `dsh-llm-pi-ai` | 3 条 OpenCode Go 路由（chat / responses / messages），约 30 个模型 |
| `ui-conversation` | `dsh-client-ui-conversation` | `busyEnter: steer` |
| `better-sidebar` | `dsh-better-sidebar` | `titleBarScheme: preset`、`titleBarPresetId: dsh-desktop`、`titleBarCompat: true` |
| `subagent` | `dsh-subagent` | `maxDepth: 2` |

## 已识别的问题

| # | 问题 | 证据 | 处置 |
| --- | --- | --- | --- |
| P1 | `app.asar.tmp` 残留 115.8 MB | `doctor` WARN | ✅ **已处置**（2026-10-06）：确认是坏构建（重复 import），已删除；`doctor` 警告数 3 → 2 |
| P2 | 鲸鱼启动动画未落盘 | 备份与当前 asar sha256 一致 | ✅ **已处置**（2026-10-06 晚）：落盘完成，`app.asar` 与 `state/staged/app.asar` 逐字节相同（121,421,984 B），备份完好可回滚；`dsht accept` 12 项自动判定全过 |
| P3 | 4 个 bundle + 3 个 patch 包只存在于安装包内 | `doctor` WARN | 改造它们只能走 L3，风险最高，需单独立项 |
| P4 | 会话全文搜索默认关闭 | base 里 `session-query-sqlite.openAt: never` | ✅ **已处置**（2026-10-06，改 `path` + `openAt: first-search`），待重启验收 |
| P5 | `tool-ralph` 默认 disabled | base 行 `disabled: true` | 需要时用 overlay 打开 |

## 2026-10-06 补充实测（三条会直接影响判断的事实）

### 1 · 运行中的 DSH 从 `app.asar` 加载 in-box 包，不是从 junction 树

`resolveBundleDir()` 是**安装锚点优先**（详见 [02-architecture.md](02-architecture.md#包解析运行期是安装锚点优先)）。
活证据是 `cordis_inspect_query` 返回的 `packageDir` 落在 `resources\app.asar\dsh\node_modules\...`。
`profiles/node_modules/@deepseek-ai/*` 那 195 个 junction 指向
`D:\Z1848\dsh-desktop-build\dist\win-unpacked\resources\dsh-cli\node_modules\@deepseek-ai\*`，
对 in-box bundle 是**失效回退层**。

**判据：asar / junction 构建树 / `D:\Z1848\deepseek-harness` 源码仓库三者版本可能不同，
查事实以 `app.asar` 为准。**

### 2 · `desktop` profile 被 Electron 应用独占，CLI 拒绝 dump/boot

```
$ dsh --profile desktop --dump-config
error: profile "desktop" is managed exclusively by the Electron application
```

守卫在 asar 内 `@deepseek-ai/dsh/lib/bin.js`：

```js
function rejectElectronProfile(program, profile) {
  if (profile.toLowerCase() === "desktop") program.error("error: profile \"desktop\" is managed exclusively by the Electron application");
}
// 只有 Desktop 自己的载体才传 manageDesktopProfile = true
function parseDshArgs(argv, version, manageDesktopProfile = false) { ... }
```

⇒ 预检走隔离探针家，见 [06-precheck.md](06-precheck.md)。

### 3 · `cordis.patch.yml` 没有热重载

全运行时 `fs.watch/watchFile` 的使用点只有：`cordis-plugin-hmr`（watch 插件源码而非配置）、
`dsh-client-hmr`（客户端 bundle stat 轮询）、`dsh-credentials-local`、`dsh-settings-file`、
`dsh-skill-filesystem`（chokidar）。`dsh-app-boot` 定义了
`const PROFILE_PATCH_FILENAME = "cordis.patch.yml";`，但**没有任何 watcher 监听它**。

⇒ 改 profile 层只能**下次启动**生效，本会话内无法热验证。

## 复验方式

```powershell
node src/cli.mjs env        # 路径与存在性
node src/cli.mjs doctor     # 全部不变量 + 指纹
node src/cli.mjs precheck   # 权威组合结果（隔离探针家 + Electron-as-Node）
node src/cli.mjs baseline write   # 与本文件对照的机器可读基线
```
