---
name: deepseek-up-t
description: 改造 DSH 本身（不是用 DSH 做事）时的作业规范：四层改造面怎么选、六步环怎么走、`dsht` 各命令什么时候用、哪些红线不能碰。做 DSH 的外观/插件/配置/安装包相关任务前先读这份。
whenToUse: 任务涉及 DSH 自身的界面、插件、profile 配置、启动动画、安装包 `app.asar`，或就在 `D:\Z1848\harness-ds\deepseek-up-T` 里干活时。
---

# deepseek-up-T 作业规范

**这个项目的目的**：改造 DSH 本身，让用户用得更顺手。五条线：T1 外观与体验、T2 能力扩展、
T3 使用效率、T4 Web GUI 扩展、T5 工程化。

## 先做这三件事（任何改动之前）

```powershell
cd D:\Z1848\harness-ds\deepseek-up-T
node src/cli.mjs doctor          # 体检：环境 / 组合层 / 运行时心跳 / 安装包 / 解析
node src/cli.mjs upgrade         # 安装包被动过没有？哪些补丁需要重打？哪些只是从未落盘？
node src/cli.mjs snapshot create -m "<本次改动一句话>"
```

别急着改。`snapshot` 是唯一的安全网，`upgrade` 是唯一的"现在到底什么状态"的真相。

## 四层改造面（先选层，再动手）

| 层 | 位置 | 升级后 | 什么时候用 |
| --- | --- | --- | --- |
| **L0** | `$DSH_HOME/profiles/<p>/cordis.patch.yml` | **幸存** | 首选。改已有配置行（阈值、开关、路径） |
| **L1** | `profiles/<p>/node_modules/<pkg>`、自建插件 | **幸存** | L0 表达不了的：新插件、新面板、新工具 |
| **L2** | `profiles/node_modules/@deepseek-ai/*` | 可能被覆盖 | 尽量别用 |
| **L3** | `resources/app.asar` | **被覆盖** | 最后手段，且必须写成 `patches/*.yml` 声明 |

**判据：能用 L0 表达的绝不动 L1，能在 L1 做的绝不动 L2/L3。**

L0 patch 的两条硬规则：
1. 条目必须带 `id` 且 id 与 base 里已有行一致，否则命中不了任何东西；
2. **`config` 是整体替换，不是深合并** —— 要改一个字段就把整个 config 写全（漏掉的字段会被重置为
   schema 默认值，或被抹掉）。只有 `disabled` 这类顶层键是按键合并的。

改完必须 `node src/cli.mjs precheck --patch <那份 yml>`，它会在**隔离的探针家**里真的跑一遍
DSH 的组合，报告退出码、问题数与逐条 diff。**差异行数要恰好等于你想改的东西。**

## 六步环

① 体检 `doctor` → ② 快照 `snapshot create` → ③ 改 → ④ 复验 `precheck` → ⑤ 观察 → ⑥ 收尾 `baseline write`

第 ⑥ 步不能省：`baseline write` 把当前状态固化成新基线，否则 `upgrade` 会永远把你**自己改的**东西
报成"环境变了"。

## 命令表

| 命令 | 用途 |
| --- | --- |
| `node src/cli.mjs doctor` | 体检。0 错误才算干净，警告要读。含「运行时」段：读插件心跳回答「重启到底有没有把我装进去」 |
| `node src/cli.mjs precheck [--patch 文件] [--profile-json 文件]` | 权威组合预检（探针家，真实 `$DSH_HOME` 只读） |
| `node src/cli.mjs snapshot create\|list\|diff\|restore` | 改动前后的配置快照与回滚 |
| `node src/cli.mjs snapshot prune [--keep N] [--keep-match GLOB] [--yes]` | 快照清理。**默认只预演**；不加 `--yes` 绝不动磁盘 |
| `node src/cli.mjs baseline write` | 收尾：固化基线 |
| `node src/cli.mjs upgrade [--no-hash]` | 升级检测 + 重打计划（`--json` 可机读） |
| `node src/cli.mjs upgrade --stage` | 检测 + **真的构建**到 `state/staged/app.asar`（只写 `state/`，Harness 开着也能跑）；素材过期时先不构建 |
| `node test/run.mjs` | 跑全部 `test/*.test.mjs`（发现式）。改完任何 `src/`、`plugins/` 之前之后都该跑 |
| `node src/cli.mjs asar ls\|cat\|grep` | 只读地读安装包里**真正在跑的那份代码** |
| `node vendor/whale/build.mjs` | 按 `patches/*.yml` 构建暂存包（**不碰安装目录**） |
| `node vendor/whale/install.mjs --yes` | **唯一**会覆盖在用 `app.asar` 的操作。须先完全退出 Harness |
| `node test/*.test.mjs` | 离线单测（升级检测、插件、假宿主） |

## 红线

1. **查事实以 `app.asar` 为准**。junction 那棵树是**另一个构建**，不代表运行中的代码。
2. **写安装包必须先确认 Harness 完全退出（含托盘）**。`install.mjs` 会自己拦，但别绕过它。
3. **不要为了"看效果"去 boot 一个 DSH 实例** —— `--help` 也会真的启动它，还会撞 19387 端口。
   验证靠离线单测 + `--precheck`/`--dump-config`。
4. `profiles/<p>/cordis.yml` **必须保持顶层 `[]`**。要写配置去 `cordis.patch.yml`。
5. 组合层文件**没有热重载**：L0/L1 的改动要重启 DSH 才生效。客户端脚本（`lib/client.js`、注入的
   JS）按 mtime 重读，硬刷新即可。
6. 别猜 API。写客户端代码前先用 `cordis_inspect_list` / `cordis_inspect_query` 查实时事实
   （Service 方法、Slot 树与 props、Config schema）。

## 已知的两个语义陷阱

- **`Config/listConfigs` 的 `status: "inactive"` ≠ 关掉了**：它描述的是配置投影状态
  （`tree`=分组节点、`schema`=有 schema、`absent`=无投影），不是启用/禁用。
  证据：`tool-fs`、`tool-pwsh`、`tool-web` 都报 inactive，但功能都在工作。
- **base 层写 `disabled: true` 是"中性默认"**：每个 agent 预设会重述自己的完整插件清单把要用的
  重新启用。只有**没有任何预设重新启用**的行才是真关着（如 `tool-ralph`）。

## 文档索引（要细节就读这些）

- `README.md` — 门面、目录结构、安全红线
- `docs/01-environment.md` — 环境基线与实测事实
- `docs/02-architecture.md` — 四层改造面、组合顺序、包解析三条根
- `docs/03-workflow.md` — 六步环、YAML 模板、反模式
- `docs/04-roadmap.md` — 五条线与里程碑、验收标准
- `docs/05-conventions.md` — 红线、选层决策树、提交信息格式
- `tracks/T1..T5/README.md` — 每条线的现状、抓手、待办、**记录**（做过的事都记在这）
- `patches/*.yml` — L3/L0 改动的声明
- `vendor/README.md` — 归拢进来的工具清单与各自风险

## 提交与记录约定

- 提交信息格式：`<线>: <做了什么> —— <为什么>`。
- 多行中文提交信息走文件：`git commit -F <仓库外的临时文件>`（PowerShell 直接 `-m` 会被 shell 嚼坏）。
- 做完一件事要写进对应 `tracks/T*/README.md` 的「记录」段：**为什么做、查清了什么、怎么验的、还没验什么**。
  「还没验的」必须写，不许含糊。

## 这份 skill 本身放在哪

正文的真源是 `<项目>/.dsh/skills/deepseek-up-t/SKILL.md`（随仓库版本化）。
两条 junction 让它无论从哪个目录开会话都能被扫到：

- `<项目根>/.dsh/skills/deepseek-up-t` —— rank 100（cwd 在项目内时命中）
- `$DSH_HOME/skills/deepseek-up-t` —— rank 400（用户级，任何目录都命中）

skill 根被 Chokidar 监视，改 frontmatter/目录结构会在下一个模型步骤生效，**不需要重启**。
卸载就是删掉这两条 junction 与这个目录。
