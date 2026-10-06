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
node src/cli.mjs snapshot restore <id>         # 回滚（回滚前会自动再留一份）
node src/cli.mjs snapshot prune                # 快照保留策略（默认只预演，--yes 才真删）
node src/cli.mjs precheck                      # 改完 cordis.patch.yml 后、重启前，预检组合
node src/cli.mjs baseline write                # 把当前事实固化为基线
node src/cli.mjs upgrade                       # Harness 升级后：哪些 L3 改动要重打、素材过期没
node src/cli.mjs upgrade --stage               # 顺手把重打构建做掉（只写 state/staged/，不落盘）
```

`doctor` 退出码：`0` = 无错误（警告不算），`1` = 存在 error 级问题。可直接接进任何 CI / 钩子。
`precheck` 退出码：`0` = 组合可用，`1` = 有问题，`2` = 预检自身跑不起来。
`upgrade` 退出码：`0` = 安装包没变且没有漂移，`1` = 有要重打或要修的东西。
`upgrade --stage` 只把**构建**自动化：它读安装目录、写 `state/staged/app.asar`，Harness 开着也能跑；
落盘（`vendor/whale/install.mjs --yes`）仍然必须由人在 Harness 完全退出后挑时间做。

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
│   ├── doctor.mjs          体检
│   ├── snapshot.mjs        快照 / 回滚
│   └── cli.mjs             命令入口
├── docs/                   工程文档
│   ├── 01-environment.md   环境基线与实测事实
│   ├── 02-architecture.md  四层改造面与组合顺序
│   ├── 03-workflow.md      标准改造工作流
│   ├── 04-roadmap.md       五条工作线路线图
│   ├── 05-conventions.md   约定与红线
│   └── 06-precheck.md      权威组合预检：为什么 CLI 做不到、怎么绕、边界在哪
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

当前为 **M3：构建链闭环、升级检测就位、T4 脚手架落地**。

- **M0 已完成**：`env` / `doctor` / `snapshot` / `baseline` 四个命令，基线固化，git 初始化。
- **M1 已完成**：`dsht precheck`（权威组合预检）、`dsht asar ls|cat|grep`（只读读安装包里**真正在跑的那份代码**）、
  T3 第一件落地：**开启会话全文搜索**（`session-query-sqlite` 改 `path` + `openAt: first-search`）。
- **M2 已完成**：
  - ✅ `vendor/` 工具链：asar 三件套（list/verify/write）+ `whale/build.mjs`（按声明构建暂存包）
    + `whale/install.mjs`（三道保险落盘）；`../tools/` 的 23 个脚本**已全部归拢**（另有
    `vendor/visual/` 6 个视觉验证、`vendor/route/` 8 个 Provider 探针）。
  - ✅ `patches/T1-whale-splash.yml`：11 条目（4 改 7 增）声明驱动构建通过，
    `state/staged/app.asar` 已就绪，**只差退出 Harness 后落盘**。
  - ✅ 旧 `app.asar.tmp` 已确认是**坏构建**并删除（重复 import 会让主进程起不来）。
- **M3 已完成**：
  - ✅ `dsht upgrade` —— 升级检测：区分「被升级覆盖」与「从未落盘」，报素材过期与 L0 漂移。
  - ✅ `dsht upgrade --stage` —— **半自动重打**：把构建做掉（只写 `state/staged/`，Harness 开着也能跑），
    落盘仍留给人挑时间；素材过期时**先不构建**，因为拿旧素材打补丁会静默丢掉新版本代码。
  - ✅ `precheck --profile-json <文件>` —— 用**候选** profile 清单预检，改动前就能知道会不会炸。
  - ✅ T3 缓存经济学结案：命中率 98.3%、17 次折叠净 **+92.35M tok** ⇒ 缓存层没有问题可修。
  - 🚧 T4 脚手架 `plugins/dsh-up-t` 已落盘（宿主路由 + 六条操作 + 心跳 + 握手 + 设置页 + 左下角胶囊，
    离线单测覆盖到这些形态；候选预检与 `doctor` 全过），**只差重启 DSH 后确认界面里真的出现了**。
    `dsht accept` 会在重启后把这件事一次问完。
  - ✅ 落盘链路可**离线演练**：`install.mjs --to <临时目标>`（或双击 `install-whale.cmd /dry`）在不退出
    Harness、不动在用安装包的前提下跑同一段声明核对；`test/install.test.mjs` 26 条断言守着它。

> ⚠️ `cordis.patch.yml` 与 profile `package.json` 的改动**不会热重载**，必须重启 DSH 才生效；
> `app.asar` 的改动必须**连托盘一起退出 Harness** 才能落盘。重启后请按
> [tracks/T3-efficiency/README.md](tracks/T3-efficiency/README.md) 的验收项确认搜索真的能用了，
> 并看一眼左下角有没有出现 `up-T` 胶囊。

五条工作线的具体改造见 [docs/04-roadmap.md](docs/04-roadmap.md)，预检机制见 [docs/06-precheck.md](docs/06-precheck.md)。
