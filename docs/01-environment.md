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
| 残留 | `resources\app.asar.tmp` = **121,415,608 字节**（比原版多 66,657 字节） |

**结论：鲸鱼启动动画还没有落盘。** 这与 `../README-whale-splash.md` 里「已构建打包完成，但差最后一步落盘」的说法一致，且现在有了机器可验证的证据。

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
| P1 | `app.asar.tmp` 残留 115.8 MB | `doctor` WARN | 确认不再需要后删除，或完成落盘 |
| P2 | 鲸鱼启动动画未落盘 | 备份与当前 asar sha256 一致 | 见 T1；落盘前必须退出 Harness 含托盘 |
| P3 | 4 个 bundle + 3 个 patch 包只存在于安装包内 | `doctor` WARN | 改造它们只能走 L3，风险最高，需单独立项 |
| P4 | 会话全文搜索默认关闭 | base 里 `session-query-sqlite.openAt: never` | 见 T3，overlay 可改 `first-search` |
| P5 | `tool-ralph` 默认 disabled | base 行 `disabled: true` | 需要时用 overlay 打开 |

## 复验方式

```powershell
node src/cli.mjs env        # 路径与存在性
node src/cli.mjs doctor     # 全部不变量 + 指纹
node src/cli.mjs baseline write   # 与本文件对照的机器可读基线
```
