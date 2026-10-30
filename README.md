# deepseek-up-T

**DSH 改造控制台。** 把散落的一次性改造动作，收敛成「有基线、有快照、有体检、可回滚、可复现」的工程。

- 项目位置：`D:\Z1848\harness-ds\deepseek-up-T\`
- 改造目标：本机 **DeepSeek Harness**（安装于 `D:\Program Files (x86)\deepseekharness`）
- 目标 profile：`desktop`（`DSH_HOME = C:\Users\Z1848\.dsh`）

---

## 为什么需要它

DSH 不是一个「装好就固定」的应用，它有四层可改造面，而且**四层的代价、生效方式、升级后是否幸存完全不同**：

| 层 | 改造面 | 生效方式 | 代价 | 升级后 |
| --- | --- | --- | --- | --- |
| **L0 配置层** | `$DSH_HOME/profiles/<p>/cordis.patch.yml` | **只能重启**（无 watcher，实测确认） | 极低 | ✅ 幸存 |
| **L1 插件层** | 第三方插件包 + 自建插件（`dsh.bundle.patch` / `dsh.client`） | 热重载或重启 | 中 | ✅ 幸存 |
| **L2 宿主层** | `$DSH_HOME/profiles/node_modules/@deepseek-ai/*` 下的核心包 | 重启 | 中高 | ⚠️ 被覆盖 |
| **L3 安装包层** | `resources/app.asar` 内的 `lib/`、`renderer/` | 必须重启 Harness | 高 | ❌ 被覆盖 |

现实中的问题不是「改不动」，而是：**改动散落在四层、没有基线、改坏了不知道、DSH 一升级就全丢，而且没人记得当初为什么这么改。**

deepseek-up-T 就是解决这个：先量化现场，再动手；每次动手前后自动留快照；任何时候一条命令回到已知good状态。

---

## 快速开始

```powershell
cd D:\Z1848\harness-ds\deepseek-up-T

node src/cli.mjs env        # 打印本机全部环境事实与路径
node src/cli.mjs doctor     # 体检：组合层不变量 / 插件可解析 / 安装包完整性 / 进程占用
node src/cli.mjs snapshot create -m "改之前"   # 留快照
node src/cli.mjs snapshot list                 # 列出快照
node src/cli.mjs snapshot restore <id>         # 只预演：列将被覆盖的文件，什么都不写
node src/cli.mjs snapshot restore <id> --yes   # 真回滚（回滚前会自动再留一份）
node src/cli.mjs snapshot prune                # 快照保留策略（默认只预演，--yes 才真删）
node src/cli.mjs precheck                      # 改完 cordis.patch.yml 后、重启前，预检组合
node src/cli.mjs baseline write                # 把当前事实固化为基线
node src/cli.mjs upgrade                       # Harness 升级后：哪些 L3 改动要重打、素材过期没
node src/cli.mjs upgrade --stage               # 顺手把重打构建做掉（只写 state/staged/，不落盘）
```

`doctor` 退出码：`0` = 无错误（警告不算），`1` = 存在 error 级问题。可直接接进任何 CI / 钩子。
`precheck` 退出码：`0` = 组合可用，`1` = 有问题，`2` = 预检自身跑不起来。
`upgrade` 退出码：`0` = 安装包没变且没有漂移，`1` = 有要重打或要修的东西。
`upgrade --stage` 在有 L3 构建器时会把构建写到 `state/staged/`；当前启动动画构建链已移除，
该项会如实报告「构建器不在」。

---

## 目录结构

```
deepseek-up-T/
├── README.md               ← 你在这里
├── package.json            npm scripts 快捷入口
├── src/                    控制台代码（纯 Node，零依赖）
│   ├── paths.mjs           路径与环境事实解析（只读）
│   ├── cordis.mjs          cordis.patch.yml 结构扫描
│   ├── asar.mjs            安装包只读读取（条目定位 / 读取 / 内容检索）
│   ├── precheck.mjs        权威组合预检（隔离探针家 + Electron-as-Node）
│   ├── patchdecl.mjs       patches/*.yml 声明解析（src 与 vendor 共用同一份）
│   ├── upgrade.mjs         升级检测：L3 重打 / L0 漂移 / 素材过期
│   ├── modules.mjs         模块宿主：up-t.config.yml + 热加载
│   ├── doctor.mjs          体检
│   ├── snapshot.mjs        快照 / 回滚
│   └── cli.mjs             命令入口
├── up-t.config.yml         模块启用清单（短配置）
├── modules/                热加载模块（入口 modules/<name>/module.mjs）
├── memory/project/topics/  项目笔记（对齐 Grok Build；见 up-t-memory skill）
├── docs/                   工程文档
│   ├── 01-environment.md   环境基线与实测事实
│   ├── 02-architecture.md  四层改造面与组合顺序
│   ├── 03-workflow.md      标准改造工作流
│   ├── 04-roadmap.md       五条工作线路线图
│   ├── 05-conventions.md   约定与红线
│   ├── 06-precheck.md      权威组合预检：为什么 CLI 做不到、怎么绕、边界在哪
│   └── 07-modules.md       模块宿主契约与热加载
├── patches/                L0/L3 改动的声明式副本（可审计、可重放）
├── plugins/                自建 DSH 插件（L1 层，升级幸存）
│   └── dsh-up-t/           T4 样板：界面左下角显示改造状态的小胶囊
├── test/                   回归测试（`npm test`）
├── tracks/                 五条工作线的落地目录
│   ├── T1-appearance/      外观与体验
│   ├── T2-capability/      能力扩展
│   ├── T3-efficiency/      使用效率
│   ├── T4-webgui/          Web GUI 扩展
│   └── T5-engineering/     工程化
├── vendor/                 会写安装包的工具链（asar 三件套 + whale 构建/落盘 + 声明解析）
└── state/                  运行时状态（快照载荷、探针家、暂存包均已 gitignore）
```

---

## 安全红线

1. **永远先快照再改。** `snapshot create` 是任何改动的第 0 步。
2. **能改 L0 就不动 L1，能改 L1 就不动 L2/L3。** 越靠上越安全、越容易在升级后幸存。
3. **不手改 `cordis.yml`。** 它必须保持顶层空数组 `[]`；所有意图写进 `cordis.patch.yml`。
4. **不删 `app.asar.whale-backup`。** 那是本机唯一的原版安装包副本。
5. **改 asar 前必须先退出 Harness（含托盘）。** Windows 不允许替换被内存映射的文件。

---

## 状态

**2026-10-30**：启动动画相关内容已从仓库删除待重构（插件 / L3 声明 / `vendor/whale` / `vendor/visual` /
`install-whale.cmd` 及对应单测）。见 [tracks/T1-appearance/README.md](tracks/T1-appearance/README.md)。
通用 asar 工具仍在 `vendor/asar/`；模块宿主仍在。

历史里程碑（M0–M4）细节在 git 与各 `tracks/*/README.md` 记录里。当前主线：控制台（doctor / snapshot /
precheck / upgrade / asar）、T4 `dsh-up-t`、模块宿主与 L0 声明副本。

> ⚠️ `cordis.patch.yml` 与 profile `package.json` 的改动**不会热重载**，必须重启 DSH 才生效。

五条工作线见 [docs/04-roadmap.md](docs/04-roadmap.md)，预检见 [docs/06-precheck.md](docs/06-precheck.md)。
