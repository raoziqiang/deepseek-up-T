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
| **L0 配置层** | `$DSH_HOME/profiles/<p>/cordis.patch.yml` | 重启 profile / HMR | 极低 | ✅ 幸存 |
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
node src/cli.mjs baseline write                # 把当前事实固化为基线
```

`doctor` 退出码：`0` = 无错误（警告不算），`1` = 存在 error 级问题。可直接接进任何 CI / 钩子。

---

## 目录结构

```
deepseek-up-T/
├── README.md               ← 你在这里
├── package.json            npm scripts 快捷入口
├── src/                    控制台代码（纯 Node，零依赖）
│   ├── paths.mjs           路径与环境事实解析（只读）
│   ├── cordis.mjs          cordis.patch.yml 结构扫描
│   ├── doctor.mjs          体检
│   ├── snapshot.mjs        快照 / 回滚
│   └── cli.mjs             命令入口
├── docs/                   工程文档
│   ├── 01-environment.md   环境基线与实测事实
│   ├── 02-architecture.md  四层改造面与组合顺序
│   ├── 03-workflow.md      标准改造工作流
│   ├── 04-roadmap.md       五条工作线路线图
│   └── 05-conventions.md   约定与红线
├── tracks/                 五条工作线的落地目录
│   ├── T1-appearance/      外观与体验
│   ├── T2-capability/      能力扩展
│   ├── T3-efficiency/      使用效率
│   ├── T4-webgui/          Web GUI 扩展
│   └── T5-engineering/     工程化
├── vendor/                 预留：从 ../tools 逐步归拢 asar 工具链
└── state/                  运行时状态（快照载荷已 gitignore）
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

当前为 **M0：基线与控制台**。已交付 `env` / `doctor` / `snapshot` / `baseline` 四个命令。五条工作线的具体改造见 [docs/04-roadmap.md](docs/04-roadmap.md)。
