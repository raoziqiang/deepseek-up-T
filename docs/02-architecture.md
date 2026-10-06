# 02 · 改造面架构

改造 DSH 有**四层**入口。选错层的代价不是「改不动」，而是「改完升级就没了」或者「改坏了回不去」。

## 总览

| 层 | 名称 | 位置 | 生效方式 | 升级后 | 本项目优先级 |
| --- | --- | --- | --- | --- | --- |
| **L0** | 配置层 | `$DSH_HOME/profiles/<p>/cordis.patch.yml` | profile 重载 / 重启 | ✅ 幸存 | ★★★★★ |
| **L1** | 插件层 | `profiles/<p>/node_modules/<pkg>` + 自建插件 | 热重载 / 重启 | ✅ 幸存 | ★★★★ |
| **L2** | 宿主层 | `profiles/node_modules/@deepseek-ai/*`（195 个） | 重启 | ⚠️ 可能被覆盖 | ★★ |
| **L3** | 安装包层 | `resources/app.asar` | 退出 Harness 后落盘 | ❌ 被覆盖 | ★ |

**判据：能用 L0 表达的就绝不动 L1；能在 L1 做的就绝不动 L2/L3。**

## 组合顺序（谁覆盖谁）

DSH 用 Cordis loader 把 profile 组合成一棵插件树，叠加顺序是：

```
profile root (cordis.yml = [])          空数组，永远是起点
  ↓
bundles，按 package.json 中 dsh.profile.bundles 的顺序
  ↓
cordis.patch.yml                         ← 你的个人层（本项目主战场）
  ↓
--patch <file> 命令行叠加层               ← 临时实验用，优先级最高
```

规则：
- patch 条目**按 `id` 命中**已存在的行，**整体替换该行的 `config`**（不是深合并）。所以一个 row 只写你想完全决定的那些字段。
- **同一 id 后写覆盖前写**（`last write wins per row`）。
- 条目没有 `id` 就无法被后续层命中。

> 推论：改 base 行时不要改 `app.asar`，而是在 `cordis.patch.yml` 里写同名 `id` 覆盖它。这是本项目最重要的一条工程纪律。

## 包解析：运行期是「安装锚点优先」

**重要更正（2026-10-06，实测）。** 下面这张三条根表描述的是 `doctor` 的静态查找顺序，
**不是**运行中 DSH 的 bundle 解析顺序。运行期由 `@deepseek-ai/dsh-app-boot` 的
`resolveBundleDir()` 决定，它是**安装锚点优先**：

```js
function resolveBundleDir(binName, packageName, installAnchor, profileDir) {
  for (const anchor of [installAnchor, join(profileDir, "package.json")]) {
    const dir = packageDirFromAnchor(anchor, packageName);
    if (dir !== void 0) return dir;
  }
  throw new Error(`${binName}: cannot resolve profile bundle ...`);
}
```

源码注释把这条规矩写成了契约：

> The installation-first order is the contract that `@deepseek-ai/dsh-base` (and every other
> in-box bundle) always comes from the same installation as the running dsh, never from a
> profile-local copy.

**活证据**：`cordis_inspect_query(platform=host, provider=Config, method=listConfigs, input={"entry":"include:session-query-sqlite"})`
返回 `packageDir = D:\Program Files (x86)\deepseekharness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-session-query-sqlite`。

⇒ **in-box 包（含只存在于 asar 的 4 个 `dsh-experimental-*`）从 `app.asar` 加载。**
`$DSH_HOME/profiles/node_modules/@deepseek-ai/*` 那 195 个条目虽然确实存在
（且都是 junction，指向 `D:\Z1848\dsh-desktop-build\dist\win-unpacked\resources\dsh-cli\node_modules\@deepseek-ai\*`），
但对 in-box bundle **是失效的回退层**。

**由此得出的判据**：asar / junction 构建树 / `D:\Z1848\deepseek-harness` 源码仓库，
三者**版本并不相同**（例：运行版 `dsh-session-query-sqlite` 的 config Schema 有
`persistedReadConcurrency` 与 `preparedSessionCacheSize`，junction 构建树那份是
`persistedInspectConcurrency` 且没有后者）。**查事实一律以 `app.asar` 为准**
（用 `dsht asar cat` / `dsht asar grep` 直接读），读源码仓库只用于理解意图。

### 静态查找顺序（`doctor` 用的）

`doctor` 按这个顺序找包，命中即停：

1. `profiles/desktop/node_modules/` — profile 自己的依赖（第三方插件）
2. `profiles/node_modules/` — 共享提升的宿主包（195 个核心 `@deepseek-ai/*`）
3. `app.asar` 内部 — 随安装包发布的包

第 3 条下又分两棵子树：

```
app.asar
├── dsh/                     ← DSH 应用本体
│   ├── desktop-runtime.json （2.8 MB 单文件）
│   ├── package.json
│   └── node_modules/        ★ 503 个 DSH 插件包都在这里
├── node_modules/            仅 19 个 Electron 打包依赖（electron-updater / fs-extra / ws …）
├── lib/                     main.js、preload-app.cjs、preload-welcome.cjs、welcome/
├── renderer/                启动窗口、更新对话框、策略登录页
└── package.json
```

**落在第 3 条的包，改动只能走 L3。** `doctor` 会专门把它们列出来（「仅安装包提供」），让这个代价在动手前就可见。

## 宿主侧的进程分层

DSH 是 Electron 应用，改造时要分清改的是哪一侧：

| 侧 | 产物 | 可改造点 |
| --- | --- | --- |
| 主进程 | `lib/main.js`、`lib/preload-*.cjs` | 窗口、托盘、启动流程、IPC |
| 渲染进程 | `renderer/welcome.html`、`renderer/*.js/css` | 启动窗口与更新对话框 |
| DSH 运行时 | `dsh/node_modules/@deepseek-ai/*` | 插件树、工具、模型、Agent |
| Web 前端 | 由 `@deepseek-ai/dsh-client-*` 在 Web profile 侧渲染 | 槽位、面板、设置页 |

Web GUI 的改造**不在这里**，走 L1 的客户端插件（见 T4）。

## 三个可用的「观察窗」

改造前先看，不要猜：

1. **`node src/cli.mjs doctor`** — 本项目的体检，看组合层不变量与包解析。
2. **`cordis_inspect_list` / `cordis_inspect_query`** — 运行时只读查询：Service 方法、Event、插件 Config schema、Tool schema、主题 token、**实时 Slot 树**。写 Web GUI 插件前必查。
3. **`$DSH_HOME/profiles/desktop/.plugin-manager/logs/`** — 插件安装失败的真实原因（pnpm 输出在这里）。

## 为什么 L3 是最后手段

改 `app.asar` 的代价：

- Windows 不允许替换被内存映射的文件 ⇒ **必须退出 Harness（连托盘）**，你正在用的会话会断。
- 121 MB 的归档要重打包，任何一处写坏都可能让应用起不来。
- Harness 每次升级都会整体覆盖它，改动**全部丢失**。

只有在「这个能力只存在于安装包内、且 L0/L1 无法表达」时才动 L3 —— 启动窗口动画就是典型例子（`renderer/welcome.html` 属于安装包内文件，没有插件层入口）。

`vendor/asar/{list,write,verify}.mjs` 已经提供了「只重写指定条目、其余字节保持不变」+「逐条比对校验」的能力，L3 改造必须走它，不许用通用打包器整体重建。声明与执行器的对应关系见 `patches/README.md`。
