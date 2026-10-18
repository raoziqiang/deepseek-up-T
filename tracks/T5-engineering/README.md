# T5 · 工程化

> 让改造本身可复现、可审计、可回滚，升级后能快速重打。

## 已交付（M0）

| 命令 | 作用 |
| --- | --- |
| `node src/cli.mjs env` | 打印全部关键路径与存在性；`--json` 机器可读 |
| `node src/cli.mjs doctor` | 体检：组合层不变量 / **运行时心跳** / 包解析三条根 / 安装包完整性 / 进程占用。退出码 1 = 有 error |
| `node src/cli.mjs snapshot create -m "..."` | 给 profile 控制面留快照（含 `app.asar` 指纹） |
| `node src/cli.mjs snapshot list` | 列出快照 |
| `node src/cli.mjs snapshot diff <id>` | 快照与当前现场对比（文件级 sha256） |
| `node src/cli.mjs snapshot restore <id>` | 回滚（需 `--yes`，回滚前自动再留一份） |
| `node src/cli.mjs snapshot prune` | 快照保留策略：默认**只预演**，`--keep N` / `--keep-match GLOB` / `--yes` 才真删 |
| `node src/cli.mjs baseline write` | 固化 `state/baseline.json` |
| `node src/cli.mjs precheck` | **权威组合预检**：隔离探针家里 dump 出运行中应用真正会看到的清单（真实 profile 只读、`$DSH_HOME` 不被写入） |
| `node src/cli.mjs precheck --profile-json <文件>` | 同上，但用**候选** package.json 顶替真实 profile 的那一份 —— 用来在落盘前试「再加一个 bundle 会不会炸」 |
| `node src/cli.mjs asar ls [正则]` | 列安装包条目；无正则时按顶层目录汇总 |
| `node src/cli.mjs asar cat <路径>` | 读出安装包里单个条目的**原文**（`--out` 落盘） |
| `node src/cli.mjs asar grep <正则>` | 在安装包内容里检索（只扫文本类条目） |
| `node src/cli.mjs upgrade` | **升级检测**：安装包/版本/profile 变了没有、哪些 L3 声明需要重打、哪些只是从未落盘、原版素材是否过期、L0 声明有没有漂移 |
| `node src/cli.mjs upgrade --stage` | 检测 + **半自动重打**：把 `action: patch/insert` 真的构建到 `state/staged/app.asar`（只写 `state/`，Harness 开着也能跑）；素材过期时**先不构建**；落盘仍由人挑时间 |
| `node test/run.mjs [关键字]` | 发现式跑 `test/*.test.mjs` 全部（也可只跑匹配的那几套）；找不到任何测试文件时**退出码 2**，不装成成功 |

代码在 `src/`，**零依赖**——`doctor` 必须在「DSH 装坏了」的时候还能跑。

## 会写安装包的工具链（`vendor/`）

| 脚本 | 作用 | 风险 |
| --- | --- | --- |
| `vendor/lib/harness.mjs` | vendor 与 src 的唯一接口：路径、Harness 进程守卫、补丁声明解析 | 只读 |
| `vendor/asar/list.mjs` | 列条目 / `--get` 抽出条目 | 只读 |
| `vendor/asar/verify.mjs` | 逐条比对两个归档，`--expect N` 校验「恰好 N 处预期差异」 | 只读 |
| `vendor/asar/write.mjs` | **单条目重写**，其余条目字节保持不变 | 写安装包 |
| `vendor/whale/build.mjs` | 按 `patches/*.yml` 生成暂存包 `state/staged/app.asar`（不碰安装目录） | 只写 `state/` |
| `vendor/whale/patch-main.mjs` | `lib/main.js` 锚点替换（锚点必须唯一） | 只写暂存树 |
| `vendor/whale/patch-preload.mjs` | `lib/preload-app.cjs` 锚点替换 | 只写暂存树 |
| `vendor/whale/patch-session-controller.mjs` | 视觉模型自动路由的锚点替换 | 只写暂存树 |
| `vendor/whale/bundle.mjs` | 动画模块 → CSP 允许的经典脚本 | 只写暂存树 |
| `vendor/whale/install.mjs` | 落盘（三道保险）/ `--rollback` | **写安装包** |
| `vendor/visual/*.mjs` | 6 个：抓帧 / 描轮廓 / 帧数值分析 / 帧配色 / 形状检查 / 静态服务（`capture-frames.mjs` 需要真 Chrome + CDP；**行为**验证优先用 `test/splash.test.mjs` 的假浏览器） | 只读 |
| `vendor/route/*.mjs` | 8 个：Provider 与网关探针（`store-go-credential.mjs` 会写凭据库） | 只读为主 |

**构建与落盘是两步**，刻意分开（这就是「写安装包必须由人挑时间」的落地方式）：

```powershell
node vendor/whale/build.mjs            # → state/staged/app.asar（可随便重跑、失败、比对）
node vendor/whale/install.mjs --yes    # 需要先完全退出 Harness
```

约定见 `vendor/README.md`。四条铁律：省略 `--out` 绝不原地重写、写安装包前必须过进程守卫、
落盘后必须拿实际差异集合与声明逐项比对、声明读不到就报错不用默认值。

## 归拢状态（`../tools/`，共 23 个脚本）

**23/23 已全部归拢**（三批：asar 三件套 + `install-whale`；构建链；视觉验证 6 + Provider 探针 8）。
`../tools/` 原样保留为历史副本，等 T1 落盘验收后再删——在那之前留一份能独立跑通的旧副本是回退手段。
每个脚本与 `../tools/` 原文件的对应关系记在各文件首行的「归拢自 …」注释里。

## 待办

- [x] **权威组合预检** —— `dsht precheck`，2026-10-06 完成，见下方记录
- [x] **只读安装包工具** —— `dsht asar ls|cat|grep`，2026-10-06 完成
- [x] **L3 改动的声明式描述** —— `patches/T1-whale-splash.yml` 已写，执行器已能解析并校验（见下方记录）
- [x] **归拢第一批** —— `vendor/lib/harness.mjs` + `asar` 三件套 + `whale/install.mjs`，2026-10-06 完成
- [x] **归拢第二批（构建链）** —— `vendor/whale/build.mjs` + 三个 patcher + `bundle.mjs`，2026-10-06 完成
- [x] **归拢第三批** —— 视觉验证 6 个（`vendor/visual/`）+ T2 探针 8 个（`vendor/route/`），2026-10-06 完成，见下方记录
- [x] **升级检测** —— `dsht upgrade`，2026-10-06 完成，见下方记录
- [x] **候选清单预检** —— `precheck --profile-json <文件>`，2026-10-06 完成，见下方记录
- [x] 半自动重打：`upgrade --stage` —— 构建自动化（只写 `state/staged/`），落盘仍由人挑时间，2026-10-06 完成，见下方记录
- [x] 快照保留策略：`snapshot prune`（默认预演）+ 三层拒绝守卫，2026-10-06 完成，见下方记录
- [x] 测试总入口 `test/run.mjs`（发现式），2026-10-06 完成，见下方记录
- [x] `doctor` 扩展：运行时心跳探测（回答「重启到底有没有把我的插件装进去」），2026-10-06 完成，见下方记录
- [x] 处置 `app.asar.tmp` 残留（115.8MB）—— 确认是坏构建，已删除
- [x] **把 T1 的手写素材搬进仓库** —— 2026-10-06 完成：10 个文件（39 KB）进 `vendor/whale/materials/`，
      声明 `source:` 改指仓库内。验收标准是「产物一字未变」而不是「能跑」：搬家前后重建的
      `state/staged/app.asar` **sha256 完全相同**（121,416,081 B / 11 条目）。
      `action: patch` 的原版缓存**不入库**（可从任意 `app.asar` 重抽，且构建时逐字节校验）。
      同一轮把 `bundle.mjs` 的 banner 从写死路径改成「相对项目根」，暂存包因此 +4 字节（121,416,085 B）。
- [x] **`vendor/visual/` 那 6 个脚本有了 README** —— 2026-10-06 完成：新增 `vendor/visual/README.md`，
      逐个写清**用法 / 外部依赖 / 会写哪些盘 / 它回答什么 / 它回答不了什么**（`capture-frames.mjs` 需要真 Chrome +
      CDP 且要求页面暴露 `window.__splash`，只能对 `materials/preview.html` 用；`serve-dir.mjs` 的 `/` 默认映射
      `preview.html`），并写明分工：**行为对不对**交给 `test/splash.test.mjs` / `test/settings.test.mjs`（断言），
      这 6 个是**取证的仪器**。同一轮修掉 `check-whale-shape.mjs` 的 cwd 依赖（见下）。
- [x] **「构建了但忘了落盘」在终端也可见** —— 2026-10-07 完成：`src/staged.mjs`（五态判定）+
      `doctor` 的「安装包」段一条 `暂存包` + `upgrade` 报告末尾一段；同一条判定有两份实现
      （终端 / 图形界面），`test/staged.test.mjs` 用一张输入表**逐字交叉对照**，见下方记录。
- [x] **唯一一条回头路有了演练模式与回归测试** —— 2026-10-07 完成：`install.mjs --rollback --to <archive>`
      （不退出 Harness、不动在用安装包）+ `verifyRollback` 共用核对段；`test/install.test.mjs` 新增一节，
      用 `DSH_UP_T_INSTALL_DIR` 把安装目录换成临时目录后**真跑一遍回滚**，见下方记录。
- [x] **另一条「出事时才跑」的路也被测到了**：`snapshot restore` —— 2026-10-07 完成：
      `test/snapshot-restore.test.mjs`（12 条）在临时目录里跑创建/对比/回滚，顺带补上三个 `P` 参数、
      修掉三个真缺陷（旧家目录绝对路径 / 越界写入 / 同秒 id 互相覆盖），见下方记录。
- [x] **`vendor/asar/` 三件套自己也有回归测试了** —— 2026-10-07 完成：`test/asar-tools.test.mjs`（15 条），
      三层（自造合成归档 / 三条「写哪儿」守卫 / 真实归档只读往返）；顺带给 `write.mjs` 加上
      「输出不许落进安装目录」「不许写原版备份」两条拒绝规则，见下方记录。
- [x] **只读读归档的那条路（`src/asar.mjs` + `dsht asar ls|cat|grep`）也有回归测试了** —— 2026-10-07 完成：
      `test/asar-cli.test.mjs`（19 条），三层（纯函数打在自造合成归档上 / CLI 退出码与输出 / 真实归档只读抽查）；
      顺带修掉四个真问题（grep 路径带前导斜杠粘不进 `cat`、`listAsarPaths` 输出顺序随 DFS 变、
      `walkAsar`/`asarStats` 拿错参数时静默吐 0、带 `g` 的正则在 grep 里漏报），见下方记录。
- [x] **预检的判据与基线（`src/precheck.mjs`）也有回归测试了** —— 2026-10-07 完成：
      `test/precheck.test.mjs`（27 条，不 boot Electron，靠显式路径与合成输入）；顺带修掉三个真问题
      （空 dump 也算通过 / 失败的跑把上一条基线冲成空文件 / diff 按集合算行差异而真实 dump 里
      7 个条目有重复行、条目顺序变化完全不算 diff），见下方记录。

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

### 2026-10-06 · 归拢第一批：`vendor/` 底座 + asar 三件套 + 落盘器

**为什么**
`../tools/` 里的脚本是在项目外长出来的。其中**构建链那两个**（`build-whale.mjs` /
`install-whale.mjs`）靠 `path.resolve(here, '..')` 猜工作区根，脚本一搬目录就静默写到别处
（第三批实测：其余 14 个并没有这个毛病，但当时无法预知，所以统一按同一套路径约定重写）；
而且它们对 `patches/*.yml` 一无所知——
声明和执行器之间没有任何东西保证「声明说的」与「实际做的」是一回事。

**做成了什么**
`vendor/lib/harness.mjs` 成了 vendor 与 `src/` 的唯一接口（路径从 `src/paths.mjs` 来、
工作区根由 `DSH_UP_T_WORKSPACE` 覆盖而不是猜 `..`、Harness 进程守卫、补丁声明解析）。
`readPatchDecl()` **刻意不做通用 YAML 解析**，只认受控子集，
声明读不到就报错退出，绝不静默用默认值。

`install.mjs` 落盘后不再只看退出码：用 `verify.mjs --json` 取实际差异条目集合，
与 `patches/*.yml` 声明的 `target.entries[].path` 逐项比对，多一条少一条都失败并提示回滚。

**怎么验**
- 自检：`node vendor/asar/verify.mjs` → `比较 11470 个归档内条目、1497 个 unpacked 条目` +
  `OK：逐字节一致`（11470+1497 = 12967 ✓）。
- 重打包不改别处：以真实 app.asar 为输入 `--set lib/preload-charm.cjs` → `共 12968 个条目，替换 1 个`，
  随即 `verify.mjs <原版> <新> --expect 1` → `OK：恰好 1 个预期条目不同，其余逐字节一致`。
- 守卫：`install.mjs` 不带 `--yes`、带 `--yes`、`--rollback` 三条路径全部被拦下，
  并列出 7 个运行中的 pid。

**修掉的两个 bug（都是「文档说的和代码做的不一样」）**
1. `list.mjs` 把第一个非 `--` 位置参数当归档，于是 `list.mjs "renderer/..."` 去打开一个叫那个
   正则的文件并抛原始 `ENOENT` 堆栈。改为只认 `--archive`，并对不存在的归档给中文报错。
2. `write.mjs` 头注释写「省略 `--out` 写 `<归档>.tmp`」，代码却把「省略」当成原地重写。
   改为省略即写暂存位，只有显式 `--out <归档>` 才原地 + 过守卫——原地重写正在使用的安装包
   必须是**显式**选择。

### 2026-10-06 · 归拢第二批：声明驱动的构建链

**为什么**
`patch-*.mjs` 这些脚本本身是好的，但它们只知道「拿一个源文件、吐一个产物」，不知道自己在
`patches/*.yml` 里对应哪一条、也不知道这条声明一共应该改几个条目。声明与执行器之间必须补上
**闭环**：改几个、改哪些、素材从哪来、产物往哪去，全部由声明驱动。

**做成了什么**
- 四个脚本原样搬进 `vendor/whale/`（三个 patcher + `bundle.mjs`）。侦察确认它们都是纯
  `[src, out]` 过滤器，只有 `build-whale.mjs`/`install-whale.mjs` 猜过工作区根，那两个已被
  `vendor/lib/harness.mjs` 取代。
- `vendor/whale/build.mjs`：解析声明 → 逐条目生成到 `state/staged/tree/<归档内路径>`（路径镜像，
  所以声明的键与待写入文件是同一个键，不会错位）→ 按 `verify.syntax_check` 做 `node --check`
  → `write.mjs --out state/staged/app.asar` → 用 `verify.mjs --json` 把**实际差异条目集合**
  与声明逐项比对。**整个过程不碰安装目录。**
- `readPatchDecl()` 补齐逐条目字段解析（`path`/`action`/`source`/`patcher`/`bundler`）与
  `syntax_check` 列表，并修掉行内注释没剥离的 bug。

**新增的一条关键守卫（值得单独记）**
`action: patch` 的 `source` 是「原版素材」。构建时强制要求它与 `--from` 归档里的那一份
**逐字节相同**，否则失败并提示重新抽取。理由：拿旧版本的原版素材去打补丁，**所有锚点仍然会
命中**，于是产出会静默丢掉新版本的代码——这是最危险的一类失败，因为它看起来完全正常。
（实测 `../.probe/` 里那三份素材与当前 app.asar 内条目 sha256 一致，所以是可信的。）

**修掉的两个 bug**
1. 声明里写 `source: xxx.js      # 经 bundle 成经典脚本`，解析后连行内注释一起当成了路径，
   报「缺少素材：`...whale-animation.js      # 经 bundle 成经典脚本（CSP 不允许 ESM）`」。
   修法：`unquote()` 里先 `value.replace(/\s+#.*$/, '')` 再 trim。
2. **注入重复 import**：构建出的 `lib/main.js` 过不了 `node --check` ——
   `SyntaxError: Identifier 'readFileSync' has already been declared`。
   原版 `main.js` 的 esbuild 产物第 8 行已经 import 了 `readFileSync`/`writeFileSync`，
   而 `patch-main.mjs` 无条件再插一行 `import { readFileSync, writeFileSync } from "node:fs";`。
   修法：改成先扫出已有 `node:fs` 命名绑定集合，**只补缺的名字**；`electron` 的 `screen` 同样
   改为条件插入。**这个 bug 就是旧 `app.asar.tmp` 坏掉的原因**（见 T1 记录）。

**怎么验**
- `node vendor/whale/build.mjs` → exit 0，`11 个条目按声明改动，其余 11466 个条目逐字节一致`，
  暂存包 `state/staged/app.asar` = 121,415,560 B（原版 121,348,951 B）。
- 7 个 JS 产物逐个 `node --check` 全部通过。
- 与旧坏暂存包交叉比对：`node vendor/asar/verify.mjs "<旧 app.asar.tmp>" state/staged/app.asar --expect 2`
  → `OK：恰好 2 个预期条目不同，其余逐字节一致`，差异恰好是
  `lib/main.js 497450 -> 497395` 与 `lib/welcome/whale-animation.js 23820 -> 23828`
  ⇒ **确定性构建**：同样的声明每次产出同样的包。

### 2026-10-06 · `dsht upgrade`：升级检测

**为什么**
Harness 升级会整体替换 `resources/app.asar`，L3 改动随之消失。不检测的表现是「昨天还好好的
动画今天没了」，而人只会去猜。这个命令要一次性回答四件事：升级发生了没有；哪些 L3 声明需要
重打；重打前还有哪份原版素材必须先重新抽取；L0 声明有没有与现场漂移。

**三条判据（从强到弱）**
1. `app.asar` 的 sha256 与基线不同 ⇒ 安装包被动过（升级，或被改造过）。
2. `app.asar` 与其原版备份 sha256 相同 ⇒ 当前是**未改造原版**，任何 L3 补丁都没生效。
3. 声明里 `action: insert` 的条目在不在归档里 ⇒ 最可靠的存在性信号。
   （只做 replace/patch 的声明没有这条证据，就报 `unknown`，**不猜**。）

**分成两层报，是这个命令最有用的地方**
- **L3**（`patches/*.yml`，写在安装包层）：升级会被覆盖。
- **L0**（`patches/T3-session-search.yml` 这种 `- id:` 片段，写在 profile 层）：
  升级**不会**被覆盖，所以永远不进「需要重打」名单。对 L0 检查的是另一件事——
  声明文件与现场 `cordis.patch.yml` 的 `config` 块是否还逐行一致，不一致就是**漂移**
  （有人直接改了现场而没回头改声明，于是声明不再是权威描述）。

**把「被升级覆盖」与「从未落盘」分开报（否则会白忙一场）**
最初把两者混在一起，输出 `需要重打的声明（1）：T1-whale-splash` —— 可那补丁**从来没落盘过**。
这不是重打，是还没做。现在：安装包变了 ⇒ `已被升级覆盖、需要重打的声明`；安装包没变 ⇒
`尚未落盘（不是被升级覆盖，而是从来没做过）`。**把「没做过的事」说成「做过的被冲掉了」，
会让人去查一个根本不存在的故障。**

**修掉的两个 bug**
1. `TypeError: c.asar.toHash?.slice is not a function` —— `paths.mjs` 的 `sha256()` 是 **async**
   的（`fs.createReadStream` 流式），忘了 `await`，于是 `toHash` 是个 Promise，`changed` 被误报
   成「★ 变了」。修法：`currentFacts` / `runUpgradeCheck` 改 `async`。
2. `listAsarPaths(header)` 返回的路径**带前导斜杠**（`/lib/main.js`），而声明、暂存树、
   `asar-verify` 的问题串全都用 `lib/main.js`。于是 `pathSet.has('lib/main.js')` 恒为 false，
   「归档里缺少」把 7 个条目全部误报，3 份 patch 素材也全报「归档里找不到对应条目」。
   修法：`src/asar.mjs` 里 `.map((e) => e.path.replace(/^\//, ''))`，并把这个约定写进注释。
3. 追加修：`livePatchEntries()` 一开始把 `config` 里嵌套的 `- id:`（`permission` 的三档 preset）
   也当成顶层条目，11 个被解析成 41 个。修法：只认缩进最浅的那一批。

**怎么验**
- `node src/cli.mjs upgrade` → exit 0：判定未升级；L3 `T1-whale-splash` 未应用；
  L0 `session-query-sqlite` 声明与现场一致。
- `node test/upgrade.test.mjs`（已随 M3 提交，21 项断言）覆盖 applied / drift / absent / error /
  素材过期 / pristine⇒absent / 全缺⇒absent / 全在⇒applied / 半应用⇒partial，以及把
  `state/baseline.json` 的版本号临时改成 `44.9.9-fake-upgrade` 后的「已被升级覆盖、需要重打」分支
  （断言退出码 1，跑完用 sha256 确认基线原样还原）。

**教训**：诊断命令的措辞就是它的功能。判据算错顶多显示错，措辞错会让人去做错事。

**补：`--no-hash` 曾经名不副实**（2026-10-06 发现并修复）
`currentFacts()` 里原本写 `backupsMatch = (asarHash ?? (await sha256(P.asar))) === ...`，
于是即使传了 `--no-hash`，为了算「当前是否未改造原版」**还是会把 121MB 的 sha256 算一遍**
—— 标志没省下任何时间，报告里 sha256 列显示 `?` 却同时给出「与原版备份逐字节相同」的结论，自相矛盾。
现在：`--no-hash` 就真的不算，`pristine` 变 `null` 并显示「无法判断（--no-hash 跳过了逐字节比对）」；
`changes.asar` 增加 `basis`（`hash` / `size`），按大小时在行尾标注
「（按大小比较：--no-hash 跳过了 sha256）」，免得「大小相同」被读成「内容相同」。
L3 状态在这种情况下仍能靠 `insert` 条目的存在性判定，所以降级是可用的而不是坏的。
`test/upgrade.test.mjs` 加了 4 条断言钉住这个语义（25 条全过）。

### 2026-10-06 · 归拢第三批：视觉验证 6 个 + Provider 探针 8 个

**先侦察，再动手。** 对 14 个目标脚本逐个 grep
`fileURLToPath|import.meta.url|path.resolve|../|process.env.|DSH_HOME|homedir|process.exit`，
结论：**没有一个**用 `path.resolve(here, '..')` 或 `fileURLToPath(import.meta.url)` 猜工作区根
（唯一 cwd 相关的是 `serve-dir.mjs` 的 `path.resolve(process.argv[2] ?? '.')`，那是它本来的语义）。
所以这 14 个可以整目录搬，不需要逐个改路径逻辑——这跟第二批（`build-whale.mjs` /
`install-whale.mjs` 真的在猜根）完全不同。**先 grep 一遍再决定改哪些，比先假设一个统一改法便宜得多。**

**搬迁时改的三处**
1. DSH 凭据库改走 `$DSH_HOME`：`e2e-opencode-go.mjs` / `verify-live-routes.mjs` /
   `market-verify.mjs` / `store-go-credential.mjs` 原本写死 `join(homedir(), '.dsh', ...)`，
   换成 `P.home`。`DSH_HOME` 被改过时原写法会读错库。
2. **保留不动**：`join(homedir(), '.local', 'share', 'opencode', 'auth.json')`（4 个 route 脚本）。
   那是 OpenCode CLI 自己的凭据库，不是 DSH 的路径，不能跟着 `DSH_HOME` 走。
   *这一条是这次最容易做错的地方：看到 `homedir()` 就一律替换，会把外部工具的凭据读坏。*
3. 环境变量收口：`HOST` 统一尊重 `DSH_WEB_URL`；`e2e-opencode-go.mjs` 的 `CWD` 从写死的
   `D:\Z1848\harness-ds\.probe-workspace` 改为 `DSH_UP_T_E2E_CWD ?? join(WORKSPACE, '.probe-workspace')`。

**怎么验**（不是只跑 `node --check`）
- `node --check` 14/14 通过。
- 只读的那批**逐个真跑**：`check-whale-shape`（exit 0，判定「有尾缺口」）、
  `analyze-frames ../.probe/frames`（7 帧全解析）、`trace-whale frame-0_35.png`（whale 8.40%）、
  `frame-colors`（主色 43.41%）、`serve-dir ../.probe/dist 8198`（`GET /renderer/pendant.html` → 200，1106 B）、
  `verify-live-routes`（走运行中的网关，`llm/listProviders -> 200`，5 个 provider）、
  `market-verify`（dshmarket 在 application 批，client.js 724114 B）、`fetch-go-docs`（status 200）。
- **证据分级**：`verify-live-routes` / `market-verify` 的 200 同时证明了 `P.home` 那处改动是对的
  （它们必须读到 `$DSH_HOME/.credentials.yaml` 才能通过网关照鉴权）。
- 没实跑并说明原因：`e2e-opencode-go`（会发真实 prompt 并改默认模型）、3 个 `probe-go-*`
  （会请求外部 API）、`store-go-credential`（会写凭据库）、`capture-frames`（需无头 Chrome + 活着的预览 URL）。

**教训**：归拢的验收不能停在 `node --check`。语法通过只证明文件能解析，
证明不了「它在新位置还能拿到路径」。能安全真跑的脚本就要真跑。

### 2026-10-06 · `../tools/` 保留为历史副本

23/23 已归拢，但**没有删除 `../tools/`**。理由：T1 还没真正落盘、没验收，
在 T1 通过之前保留一份能独立跑通的旧副本是回退手段；素材（`.probe/`、`whale-motion/`）
和历史说明（`README-whale-splash.md`）也还引用得到它们。删除单独作为一步，放在 T1 验收之后。

### 2026-10-06 · `precheck --profile-json`：候选清单预检

**为什么必须补**：`dsh.profile.bundles` 只存在于 profile 的 `package.json`，而
`prepareProbeHome()` 每次都从**真实 profile** 复制那一份。于是「再加一个 bundle 会不会炸」
这件事**无法在落盘前预检** —— 只能先改真实 profile 再祈祷。这个缺口正好被 T4 的插件安装撞上。

**改法**（三处，都很小）
- `src/precheck.mjs`：`prepareProbeHome({ fresh, profilePackageJson })` 多一个覆盖项，
  指向候选文件时用它当 `package.json` 的来源（其余文件仍从真实 profile 复制）；
  返回体多 `sources` 与 `override` 两个字段，好让调用方与报告知道用的是哪一份；
  文件不存在直接抛错（不许静默回退到真实 profile —— 那会让预检结果失去意义）。
- `runPrecheck({ ..., profilePackageJson })` 透传。
- `src/cli.mjs`：`VALUE_OPTS` 加 `['--profile-json','profileJson']`；人类可读输出里多一行
  `⚠ 候选清单 package.json 来自 …（不是真实 profile 的那一份）`；`--json` 多
  `profilePackageJson` 字段；usage 补两行。`state/candidate/` 已进 `.gitignore`
  （候选文件源自本机真实 profile，不可跨机复现）。

**怎么验的（T4 插件安装就是它的第一个真实用例）**
- 生成候选 `state/candidate/package.json`（12 → 13 个 bundle，新增 `dsh-up-t`）
  → `node src/cli.mjs precheck --profile-json state/candidate/package.json`
  → **退出码 0、问题 0**、`与上一次预检相比：1 新增 / 0 移除 / 0 修改 → + 条目 dsh-up-t`，
  且**没有** `skipping profile bundle`（说明 junction 解析成功、patch 里的 `insert` 命中了）。
- 落盘后 `precheck`（用真实 profile）→ 退出码 0、问题 0、与候选预检**完全一致**
  ⇒ 这条预检是忠实的，而不是「预检通过、真实启动却不同」。

**教训**：这套工具的每一条命令都得能被用在「改动**之前**」。只能事后验证的诊断，
价值只有一半 —— 因为它拦不住任何事。

### 2026-10-06 · 快照保留策略 `snapshot prune`

**为什么**
快照一份只有几 KB，所以「可以随便留」；但留到几十份之后，`snapshot restore <id>` 的选择成本就
从「记得改之前有一份」变成「在一堆 `…改动前` 里挑出一个」。工程化的要求不是「多留」或「少留」，
而是**留多少由一条说得清的规则决定**。这条规则还必须能被**预演** —— 一个会删目录的工具，
如果第一次运行就是真删，那它本身就是风险来源。

**规则（纯加法，三条互不排除）**
1. 最新的 `--keep N` 份（默认 10）；
2. 任何 id 匹配 `--keep-match <glob>` 的（可重复；只实现 `*` / `?`，其余字符按字面量 ——
   刻意不引依赖，`src/` 的全部价值就在于「DSH 装坏了也能跑」）；
3. 其余进删除集。
`planPrune` 连磁盘都不碰，只产出 `{total, keepN, keepMatch, keep, drop}`；
`--yes` 做的事就是**把这份预演输出执行掉**，中间没有第二套逻辑。

**三层拒绝守卫（`deleteSnapshots`）**—— 删之前每个 id 都要过：
1. 必须是一个**纯目录名**：非空、不含 `/` 或 `\`、不是 `.` / `..`；
2. `path.resolve` 之后必须仍在快照目录**里面**（`dir.startsWith(root + path.sep)`，挡 `..` 逃逸）；
3. 里面必须有 `meta.json`（确认这真的是一个快照，而不是别的什么东西 —— 比如手滑建的空目录）。
被拒的进 `refused` 并让命令**退出码 1**，但不抛异常：调用方要能一次性看到全部结果，
而不是删到第三个才炸掉、前两个已经没了。

**怎么验的**
- `test/snapshot.test.mjs`（**15/15 通过**，新增）：全部在 `fs.mkdtempSync` 的临时目录里跑，
  **绝不碰 `state/snapshots/`**。钉住：glob 的三条语义（`*` 含空串 / `?` 单字符 / `.` `+` 按字面量
  + 整串锚定不做子串匹配）、`keep` 取最新 N、`--keep-match` 是**加法不是替换**、`keep=0` 只留匹配项、
  `keep>总数` 一份不删、**keep 与 drop 严格互补无重叠**、`planPrune` 只读不改盘；
  然后是拒绝路径（`..`/`../..`/`a/b`/`a\b`/空串 五个全拒、不存在的目录拒、**没有 `meta.json` 的目录拒
  且原目录必须还在**）、正常路径（删掉的消失、**其余快照逐个比对完全不受影响**），
  最后一条是「预演之后真删，删的**正是**预演那一批」——把「预演忠实」这件事本身也钉住。
- 真实现场（6 份快照）：`snapshot prune`（默认）→ 退出码 0、`没有需要删除的快照`；
  `--keep 1 --keep-match "*-M0-*"` → 保留最新 1 份 + M0，列出 4 份将删除；
  `--keep abc` → 退出码 2 + `--keep 需要一个非负整数（收到 "abc"）`；
  `--json` → `total=6 keep=3 drop=3`；**预演之后 `state/snapshots` 目录数仍是 6**。

**顺带修掉的文档缺陷**：`tracks/T5-engineering/README.md` 里「四条铁律 + 构建与落盘两步」整段
**重复了两遍**，而 `vendor/visual` / `vendor/route` 两行被写在了代码块**外面**（表格已经结束），
渲染时会变成散落的正文。已把两行并回表格、重复段落删掉、并把「构建与落盘是两步」补上它存在的
理由（这就是「写安装包必须由人挑时间」的落地方式）。

**教训**：删东西的工具，**默认行为必须是预演**；而预演的可信度不能靠文档承诺，要有一条断言
（「真删的那批 == 预演的那批」）把它钉住。另外，「保留规则」永远只做加法 —— 只要有一类
「必须永远保留」的快照，规则就得是 `keep N ∪ match globs`。

### 2026-10-06 · 测试总入口 `test/run.mjs`（发现式）

**为什么**
`package.json` 里的 `"test": "node test/upgrade.test.mjs && node test/plugin.test.mjs"` 是**手写清单**：
后来加的两套（`skill.test.mjs`、`snapshot.test.mjs`）**从来没进过总入口**。
这不是「忘了跑一次」，而是**防线静默失效** —— `npm test` 全绿，而两套测试一次都没执行。
手写清单的失效模式永远是同一个方向：**它不会因为漏了东西而变红**。

**改法**
- `test/run.mjs`：`readdirSync(test/)` 取全部 `*.test.mjs` 排序后逐个跑，收集退出码；
  可用位置参数过滤（`node test/run.mjs snapshot`）。`spawnSync(..., { stdio: 'inherit' })`
  而**不用管道**：受限沙箱里管道式 stdio 会直接 EPERM，直通终端既拿得到完整输出又不需要捕获。
  **`test/` 下一套都找不到时以退出码 2 报错**（打印「这不是「通过」，是没有防线」），
  而不是「0 套通过」地装成成功 —— 这跟 `doctor` 那条「非法 level 直接抛错」是同一个原则。
- `package.json`：`"test": "node test/run.mjs"`；`test:upgrade` / `test:plugin` / `test:skill` /
  `test:snapshot` 四个别名全部改为 `node test/run.mjs <关键字>`，不再各自写死文件路径。
- `docs/05-conventions.md` 的「提交前必跑」补上 `node test/run.mjs`（4 套全绿）。
- `.dsh/skills/deepseek-up-t/SKILL.md` 命令表补上这一行。

**怎么验的**
`node test/run.mjs` → `PASS plugin.test.mjs` / `PASS skill.test.mjs` / `PASS snapshot.test.mjs` /
`PASS upgrade.test.mjs`，`4/4 套测试通过`，退出码 0。这一次它**真的**把四套都跑了 ——
而改之前，同样的「全绿」只覆盖两套。

**教训**：**能发现的东西就不要手写清单**。凡是「新增一项时要记得回来改」的地方，
都要问一句「忘了改会怎样」——如果答案是「静默地少测一块」，那就把它改成发现式；
实在必须手写，就让「清单为空」变成错误而不是成功。

### 2026-10-06 · `doctor` 扩展：运行时心跳探测

**为什么**
`doctor` 到这时为止只会回答**静态**事实：文件在不在、配置合不合法、归档头能不能解析。
而 L1 插件最容易出的问题恰恰在**运行时**，且三条失败路径**全都是静默的**：

| 情况 | 表现 |
| --- | --- |
| 插件装好了，但 profile 没重启 | 什么都没发生（配置文件一切正常） |
| 重启了，但插件 `apply()` 抛错 | 宿主继续跑，只是少一个挂件 |
| 加载了，但客户端脚本 404 | 设置里少一页（注入行刻意 `s.onerror = function () {}`，为了不拖垮启动） |

于是「到底加载成功了没有」此前只能靠**肉眼看界面**。心跳文件把这个问题变成一条可核对的文件事实。

**做成了什么**
- `plugins/dsh-up-t/lib/index.js`：`writeHeartbeat()` 在 `apply(root)` 的**第一条语句**执行
  （和注入行同一个理由：越早做，越不可能因为后面的依赖不满足而漏掉），写
  `plugins/dsh-up-t/.runtime/heartbeat.json` = `{ plugin, version, at, pid, execPath, electron, node, installDir, clientPath, statusPath }`。
  **它绝不抛异常**（写失败记进 `lastHeartbeatResult`），返回值也**被忽略** —— 磁盘上的文件才是证据。
  `collectStatus()` 新增 `heartbeat`（**从磁盘读**，不是内存变量）、`heartbeatFile`、`heartbeatWriteError`，
  所以 `/dsh-up-t/status.json` 也带心跳。
- `src/paths.mjs`：新增 `pluginRuntimeDir` / `pluginHeartbeat`。
- `src/doctor.mjs`：`GROUPS` 加 `'运行时'`（渲染按 push 顺序分段，新段落在「组合层」之后、「安装包」之前）；
  新增 `pidAlive(pid)`（`kill(pid, 0)` 只做存在性检查，**EPERM 也算「在」**）与 `humanAge(ms)`；
  检查项 `T4 插件 dsh-up-t 心跳` 三分支：**没有文件 → INFO**（重启前这是预期，不是故障，hint 明说）、
  **不是合法 JSON → WARN**、**合法 → 按 pid 存活给 OK/WARN**。

**两个值得记住的取舍**
1. 心跳写在**插件包自己的 `.runtime/`**，不写项目的 `state/`。因为插件可能以非 junction 的方式安装，
   那时往 `../../state` 写会造垃圾；写在包内最坏只是写进它自己那份安装副本，而 `doctor` 看不到它 ——
   **这恰恰是正确的结论**（「那不是我们这份插件副本」）。
2. OK 态用 `level: 'warn'` + `ok: true`。渲染规则是从 `level` 和 `ok` 两个字段**共同**推出标签
   （`c.ok === false ? TAG[c.level] : (c.level === 'info' ? TAG.info : TAG.ok)`），而 `LEVELS` 白名单
   只有 `error|warn|info` —— 想让失败显示 `WARN`、成功显示 `OK`，只能这么写。

**怎么验的（四个分支都用真进程跑过，不是只读代码）**
- 短命 `node -e` 写心跳（写完就退出）→ `WARN … ← 该进程已经不在了` + 正确 hint；
- 手改 `pid: 999999` → 同上（**过期心跳与「写完就退出的进程」不可区分，这是对的** ——
  判据只能是「写过它的那个 pid 现在还活着没有」）；
- 写烂 JSON → `WARN … 存在但内容不是合法 JSON`；
- `Start-Process node -ArgumentList '-e','setTimeout(()=>{},9000)'`（pid 42032，`HasExited=False`）代写 →
  **`OK  T4 插件 dsh-up-t 心跳  dsh-up-t 0.1.0 · …（0 秒前） · pid 42032`** ——
  这一条是必需的，否则「pid 存活」这一路可能恒判 WARN 也没人发现。
- 收尾删掉心跳回到 `INFO`；`.gitignore` 加 `plugins/dsh-up-t/.runtime/`；
  `test/plugin.test.mjs` 加 4 条断言（20 → **24/24**）：文件真的落盘、合法 JSON 且 `pid === process.pid`、
  `writeHeartbeat()` 返回值诚实、`status.json` 把**磁盘上**的心跳原样带出来且 `heartbeatWriteError === null`；
  **测试跑完必须清理**（那枚心跳的 pid 是测试进程，留着会让下一次 `doctor` 报 WARN —— 测试不许给真实环境留状态）。

**教训**：一个「加载成功了吗」这种只能靠肉眼回答的问题，通常不是因为没有答案，而是因为**没有把答案写下来**。
把每次加载写成一行带 pid 与时间的文件，问题就从「看界面」变成「读一行字」，
而且**顺带解释了为什么它是静默的** —— 因为静默正是它当初的设计目标。

### 2026-10-06 · `upgrade --stage`：半自动重打

**起因**：待办里那条「自动重打」写的是「不自动落盘（写安装包必须由人挑时间）」。但把这句话读细一点会发现
它只禁掉了**落盘**，没有禁掉**构建**：`vendor/whale/build.mjs` 读安装目录是只读的、产物只写
`state/staged/app.asar`，Harness 开着也能跑。而这一步恰恰是最容易漏、漏了后果最坏的一步 ——
漏掉之后 `upgrade` 会把「从未落盘」说成「被升级覆盖」，你会去追一个不存在的回归。

**做成了什么**
- `src/cli.mjs`：`import { spawnSync } from 'node:child_process'` + `PROJECT_ROOT`；
  新增 `runStageBuild(r, ids, quiet)`，`cmdUpgrade` 支持 `--stage`。人类模式下打一段
  「已构建到 `state/staged/app.asar`（1.2s），差异集合按声明核对通过」并把**落盘与写基线两条命令**
  连带理由一起打出来；`--json` 下把结果放进 `staged: { attempted, ok, ids, ms, code, stdout, reason }`。
- 三种结果各自诚实：没有要重打的声明 → `attempted: false, ok: true, reason: 没有需要重打的声明`；
  素材过期 → `attempted: false, ok: false` + 一句「先重新抽取素材，再谈重打」，**一个字节都不构建**；
  构建失败 → `attempted: true, ok: false`，退出码 1（成功时退出码仍是 `upgrade` 自己的判断）。

**两个刻意的决定**
1. **素材过期时直接不构建**。构建器自己也会拦（source 与归档必须逐字节相同），但那是最后一道；
   与其跑到一半失败，不如先说清楚哪份素材已经不是新版本那一段了。
2. **`--json` 下必须捕获子进程输出，不能 `stdio: 'inherit'`**。构建自己的 stdout 会直接插进
   我们正在写的 JSON 文档里 —— 这种坏法（stdout 里多出一段人话）极难一眼看出，而所有下游消费者
   都会在 `JSON.parse` 上炸。成功时把输出尾部放进 `staged.stdout`，机器可读文档保持纯净。

**怎么验的**
- 真跑：`upgrade --stage --no-hash` → 退出码 0，`state/staged/app.asar` 121,415,560 B（1.2s），
  与手工构建逐字节同一份（大小未变、mtime 前进）；
- `upgrade --stage --json --no-hash` → **`JSON.parse` 成功**，`staged.stdout` 里能看到构建自己的
  「11 个条目按声明改动，其余 11466 个条目逐字节一致」；
- 篡改素材（往 `D:\Z1848\harness-ds\.probe\main.js` 尾部加一个字节）→ `stale: 1`、
  `staged.attempted = false`、退出码 **1**、**暂存包 mtime 没动**；还原后 sha256 与篡改前一致
  （素材在仓库外，只能自己备份还原）；
- 安装目录 mtime 在整轮构建前后**一动没动**（用 mtime 当「没碰安装目录」的证人，比再哈希 121MB 便宜）；
- `test/upgrade.test.mjs` 加 **10 条断言**（26 → 36）：JSON 仍是合法 JSON、真的构建了、构建的正是缺的那条声明、
  构建输出被带回来了、暂存包变新、安装目录 mtime 未动、退出码 0、人类输出含「已构建到…」「完全退出 Harness」
  「baseline write」「基线必须在落盘之后写」。**整套测试 4/4 通过、3.2s**（构建两次约 2s，可接受）。

**教训**：把一条「不能自动化」的待办**拆开看它到底禁了什么** —— 常常禁的只是最后那一步（落盘），
前一步（构建/校验）完全可以自动化，而前一步恰恰是最容易漏的。另一种说法：
「必须先退出应用」这个约束属于**写安装目录**，不属于**算出一份安装目录的替代品**。

### 2026-10-06 · 心跳两步走：把「加载了」和「能用」分开

**起因**：上一节那条心跳只回答了一个问题 ——「这个插件被加载了吗」。但 L1 插件最安静的坏法
落在另一个位置上：**被加载了，然后卡在等 `webServer` 上**。那时 `apply()` 跑完了、注入行也进了表，
而路由一条都没注册 ⇒ 界面里既没有胶囊也没有设置页，**而且没有任何报错**。这枚心跳当时只会说
「加载过」，于是这一种和「一切正常」在 `doctor` 里长得一模一样。

**做成了什么**
- `plugins/dsh-up-t/lib/index.js`：`writeHeartbeat(stage = 'apply', extra = {})`，模块级 `heartbeatTrail`
  记录本次生命周期走过的那几步；`apply()` 开头写 `apply`，`root.inject(['webServer'])` 的回调末尾
  写 `ready` + `routes: [CLIENT_PATH, STATUS_PATH, ACTION_PATH]`。文件里多出 `stage` / `loadedAt` / `trail`
  三个字段。同一个进程里插件被重新加载时，`trail` 从新的 `apply` 重新开始（旧 trail 属于上一次生命周期）。
- `src/doctor.mjs` 的心跳检查从三分支变四分支：多出一条 **`stage: "apply"` 且进程活着 → WARN**，
  正文直说「路由没注册，界面里既不会有胶囊也不会有设置页，而且不会有任何报错」；`ready` → OK
  并报出路由条数；**心跳没有 `stage` 字段时一律按「未知」**（显示「心跳没有 stage 字段（旧版本写的）」），
  绝不当作「没就绪」—— 把「我手里没有这条信息」说成「你坏了」是最糟的一种诊断错误。
- 设置页新增「心跳」一行（`服务已就绪（路由 3 条）` / `只走到 apply()` / `还没有心跳`）：
  设置页恰恰是「什么都没出现」时人会去看的地方，让它自己说出卡在哪一步，比让人去猜「是不是没重启」有用。
- `test/plugin.test.mjs` 加 **3 条断言**（36 → **39/39**）：`ready` 时 stage/routes/trail/`loadedAt` 都对、
  只写 `apply` 时的形状（无 `routes`、trail 只有一步、`loadedAt === at`）、设置页把两种 stage 渲染成人话。

**怎么验的**
- `node test/plugin.test.mjs` **39/39**；`node test/run.mjs` **4/4 套通过**；`node --check` 三个改动文件；
- **四个分支都用手写的真心跳文件喂给 `dsht doctor` 跑过**（不是只读代码）：
  `stage: apply` + 活 pid → `WARN … 只走到 apply()` + 那条 hint；
  `stage: ready` + 3 条 routes → `OK … 服务已就绪（路由 3 条）`；
  无 `stage` 字段 → `OK … 心跳没有 stage 字段（旧版本写的）`；
  `pid: 999999` → `WARN … ← 该进程已经不在了`；删掉文件 → 回到 `INFO 还没有心跳文件`；
- 顺带确认一件对界面有影响的事：`stage: apply` 这种 WARN **不影响 `doctor` 的退出码（仍是 0）** ——
  所以设置页上「体检」按钮不会因为一枚卡住的心跳显示成失败（文案里的 WARN 仍然醒目）。
  注意 Powershell 5.1 的 `Set-Content -Encoding utf8NoBOM` 不存在，写测试文件要用
  `[System.IO.File]::WriteAllText(..., UTF8Encoding($false))`，否则带 BOM 的 JSON 在 `JSON.parse` 上直接炸；
- 收尾删掉 `plugins/dsh-up-t/.runtime/`（测试与手验都不许给真实环境留状态，`git status` 干净）。

**教训**：「加载了」和「能用」是两个不同的事实，中间隔着的正是所有**静默失败**。凡是问「有没有生效」的
诊断设施，都该问清楚自己回答的是哪一半 —— 只答前面一半的探针，会在最需要它的时候和「一切正常」无法区分。

### 2026-10-06 · 握手：把最后一个静默区交给渲染层自己说

**起因**：心跳的 `ready` 只说得出**宿主侧**的事实（路由注册了）。它答不了最后一个问题：浏览器里那段
脚本到底跑了没有？注入行可能没被收集、客户端 bundle 可能在渲染层加载失败 —— **两种都不报错**，
界面里就是什么都没有，和「插件根本没加载」长得一模一样。这一段宿主无论如何推测不出来。

**做成了什么**：第四条路由 `/dsh-up-t/seen`，渲染层脚本跑起来后 `POST` 一句「我到了」；
两条投递通道**分开记**（`capsule` = 注入行加载 `assets/client.js`；`bundle` = ModuleLoader 加载
`lib/client.js`），因为「胶囊在、设置页不在」和反过来是两种不同的故障，合成一个布尔值就再也分不开。
记录写进**同一份心跳文件**的 `client` 字段，所以 `doctor` / `status.json` / 设置页三处都能看到。

**守住的边界**：
- 握手是**证据，不是功能**：两处都包在 `try/catch` 里、失败静默。旧宿主上没有这条路由（404）时界面照旧。
- `GET` 只读、**永不记录**；要记录必须带 `x-dsh-up-t: 1`（否则别的网页能凭空伪造一次握手）。
- 时间语义写进文案：**刚启动的头几秒、以及无界面形态下没有握手是正常的** —— 免得把正常状态说成故障。

**怎么验的**（全部真跑）：
- 插件单测 39 → **44 条**：seen 路由三条（`GET` 只读且 `seen` 仍为 null / 缺头 403 / 两条通道分开记
  且落进磁盘心跳与 `status.json`）+ 客户端 bundle 两条（`apply()` **恰好**握一次手、握手失败也照常注册
  设置页）+ 胶囊源码里必须出现 `via: 'capsule'`。
- 手写真心跳文件喂给 `dsht doctor`，两个新分支各看一次：
  `ready` 无握手 → `WARN … 服务已就绪（路由 1 条） · 还没有渲染层握手` + hint；
  `ready` 且 `client.sources = {bundle, capsule}` → `OK … · 渲染层已握手（bundle+capsule）`。
- 第一次跑 44 条时 3 条失败，**两条是测试假件的缺陷，不是产品代码**：① 假 `IncomingMessage` 漏了
  `resume()`，于是守卫里排空请求体那一步抛 TypeError、被 `try/catch` 变成 500 —— 修好假件，403 就对了；
  ② `actionJson` 定义在握手段之后，const 的暂时性死区让两条断言报
  `Cannot access 'actionJson' before initialization`。
  **教训：假件缺一样真对象一定有的东西，症状会长在别的分支上。**

**教训**：把「我跑起来了」这句话的**发言权交给唯一知道的那个进程**。宿主能推测的只有「我准备好了」，
而「界面里到底出现了吗」只有渲染层自己说了才算 —— 这两句话之间那一段，就是之前所有静默失败住的地方。

### 2026-10-06 · 三态里的 `null` 是结论，不是占位符

**起因**：还没重启的旧版插件（`ea8d9ec`）在 19387 上答出了 `install.asarBytes: 0`，而磁盘上那份
`app.asar` 是 **121,348,951 B**、原版备份同大小。旧代码的判定是 `asarBytes === backupBytes`，
于是 `false` ⇒ 设置页显示**「已被改造（大小不同）」** —— 一句建立在「拿不到的事实」上的反面结论。
更值得记的是：`findInstall()` 的代码里**根本产生不出 0**（文件缺失应得 `null`，存在应得真实大小），
所以这不是哪一行写错了，而是**把三态硬压成两态**之后必然会长出来的那种错。

**做法**：把「拿不到」从「反面」里拆出来 —— `findInstall()` 视 `不存在`/`stat 失败`/`0 字节`
为「这条线索不作数」并继续试下一条，被否掉的候选带进 `installRejected`；`collectStatus()` 只认正数，
证据不足时 `sameSizeAsBackup: null` + `judgedBy: 'unavailable'`；界面据此说「无法判断」而不再
声称依据是大小比较。顺带修掉心跳那一行的同类误报：能拿到 `status.json` 却读不到心跳字段，
说明的是「这一版宿主还没有心跳功能」，**不是**「插件没被加载」。

**怎么验的**：单测 44 → **46 条**，其中一条是真回归 —— 在临时目录里摆一个 0 字节的 `app.asar`
当第一条线索（`process.resourcesPath` 指向它），断言它被跳过、真实大小被带回、`rejected[0].why === '0 字节'`，
并断言两条线索指向同一个根时候选去重（`Object.defineProperty` 改完必须**恢复成原样**，
原本没有该属性就 `delete`，否则后面的断言会在一个被改过的世界里通过）。另一条是渲染断言：
证据不足时不得出现「已被改造」与「大小比较」。全套 **4/4 套**、`doctor` 0 错误 2 警告（既有）。

**教训**：**「拿不到」和「不同」是两个不同的结论。** 三态里的 `null` 不是占位符、不是「还没填」，
它就是这个设施最需要诚实的那一格；把它折叠成 `false`，人就会拿着一个不存在的故障去查真问题。
诊断命令/页面说的每一句话都是结论 —— 凡是「有没有生效/有没有变」这类设施，都要问自己一句：
**我现在答的是我知道的，还是我以为的？**

### 2026-10-06 · `dsht accept`：把重启后的验收变成一条命令

**起因**：落盘改完之后要核对的东西分散在**四处**，而人手里只有一张从记忆里抄来的清单：
L3 声明（安装包层落没落）、L0 声明（profile 层漂没漂）、运行中的宿主（路由活着没有）、
渲染层（脚本真的跑起来没有）。最容易漏的恰恰是**不报错**的那一类，而且漏掉之后没有任何东西会提醒你。

**`src/accept.mjs`**（只读，不写盘、不留快照 —— 验收不该改变被验收的东西）：
- 探针：`probe(url, route, {timeoutMs})` 用内置 `http` 发 **GET**，任何失败都变成一条事实、绝不抛；
  地址默认 `process.env.DSH_WEB_URL || 'http://127.0.0.1:19387'`（`--url` 可覆盖）。
- 声明项：复用 `runUpgradeCheck()` 的结果（不重新发明判据）。**匹配要用声明文件名，不能用 id** ——
  L0 的 `id` 是 cordis 行 id（`tool-ralph` / `product-analytics` / `session-query-sqlite` /
  `session-title-llm`），拿它去找文件会得到「找不到声明文件」这种**假失败**（第一次真跑就踩到了）。
- 三项宿主/渲染层事实：`/dsh-up-t/status.json` 200（插件活着）、`/dsh-up-t/action` 200 vs **404**
  （404 = 跑的是**旧代码**，不是「没装」）、`/dsh-up-t/seen` 的 `sources` 里 `bundle` 与 `capsule`
  **是否都在**（缺哪一个的排查方向完全不同）；再加磁盘心跳（`stage === 'apply'` 要报「界面里不会有
  胶囊也不会有设置页」，那是**最安静的坏法**）。
- **三种结论分开，这是这个命令的全部价值**：`FAIL`（没成）/ `SKIP`（这次没拿到证据：宿主没在跑、
  没有原版备份、`--no-hash` 跳过了逐字节）/ `MANUAL`（只有人眼能判：动画好不好看、胶囊拖不拖得动…
  **不计入退出码**）。把「没测到」折成「没过」会让人去修一个不存在的故障；把需要人眼的项算成失败，
  等于教人忽略失败。退出码只在**没有任何 FAIL** 时为 0。
- 每条失败都带一句修法（`fix`），报告里以 `↳` 另起一行露出。

**顺手接进界面**：`ACTIONS` 新增 `accept`（label `重启后验收`，`writes: false`，**不给 `--json`** ——
这条命令的价值就是那份人读的报告，面板本来就渲染 stdout 文本）。`writes: false` 是刻意的：
「确认要验收吗」这种确认框会训练人习惯性点掉确认，而那个习惯迟早会点掉一个真的写操作。

**怎么验的**：
- 新增 `test/accept.test.mjs`（**总入口是发现式的，所以它自动被 `test/run.mjs` 收进来**，
  套数 4 → **5**）。它起一个**假宿主**（`http.createServer` + 端口 0）把每条分支都钉住：
  新版宿主 + 两条通道 → 全过；旧宿主（`/action` 404）→ FAIL 且措辞必须是**「旧代码」**不是「没装」；
  只有 `capsule` 握手 → FAIL 且点明缺的是 `bundle`、修法指向 ModuleLoader；
  连不上 → `host-up` FAIL 但 `host-new` / `renderer` 是 **SKIP**（不折成 FAIL）；
  `--no-hash` 的降级；报告里「只能靠你的眼睛」单列一段且写明不计入退出码；
  以及**探测只发 GET**（`host.seen.every(s => s.method === 'GET')`）—— 这条是「只读」这个承诺的测试。
- 真跑（Harness 在跑、宿主半侧仍是旧版）：`T1` 与 `app.asar 已被改造` 如实报 FAIL、四条 L0 声明
  `OK`、`宿主在跑且插件路由活着` `OK`、`宿主半侧是新版` 报 **404 = 旧代码**、渲染层/心跳 `SKIP`、
  体检 0 错误，总 `通过 2 / 失败 7 / 无法判断 2 / 需要人看 6`、退出码 1 —— **每个数都对得上当时的现实**。
- 全套 **5/5 套**；`doctor` 0 错误 2 警告（既有）。

**后来补的一条（同日，接上桌面挂件开关之后）**：验收清单里多了一项
`charm-row`「挂件开关那一行已经在客户端 bundle 里」—— 它**不查任何路由，查的是磁盘上那份
`lib/client.js`**。理由是踩过一次：最初写成 `GET /dsh-up-t/client.js` 再找标记，真跑立刻报 FAIL，
因为那条路由送的是 `assets/client.js`（左下角胶囊），而设置页那一页是 ModuleLoader 加载的
`lib/client.js`，根本不走我们的路由。查磁盘文件还更耐得住：这个 bundle 由模块系统**按 mtime 派生 rev**
后重读，所以「文件是不是新版」就是要问的事实，剩下的一步（浏览器硬刷新）只有人能做。
路径先看 profile 里的 junction（`<profileDir>/node_modules/dsh-up-t/lib/client.js`，那是应用真正解析到的那一份），
再退到仓库里的源文件；两处都读不到 ⇒ `SKIP`（插件没装进这个 profile），文件在但缺标记 ⇒ `FAIL` 并提示硬刷新。
同时补了一项 `manual-charm`（设置 →「通用」里打开挂件开关后桌面上出现小鲸鱼）—— 观感项不进退出码，
但**清单不能漏**：人重启后能看到的正是这些。测试里新增一段专门钉这三条分支
（真仓库那份 → pass；临时目录里的旧内容 → FAIL 且措辞点出缺哪两个标记；路径不存在 → SKIP 且说清「试过哪些路径」，
临时目录用完即删）。`test/accept.test.mjs` 随之增加，仍是发现式自动收进总入口。

**教训**：验收清单必须**把「没测到」单列**。一个只有「过/不过」两态的验收工具，在环境不满足时
一定会撒谎（要么把没测的说成没过，要么说成过了）；而人会照着这个谎去查问题。
另外：**能靠一条命令回答的问题，不要留给记忆** —— 落盘之后的那一刻正是人最容易忘掉一半的时候。

### 2026-10-06 · 落盘链路可以离线演练：`install.mjs --to`

**起因**：`vendor/whale/install.mjs` 是这个项目里**唯一**会覆盖在用 `app.asar` 的地方，而它过去
只有在**真落盘那一刻**才能被验证 —— 一年做几次的事等于没验证。它有两种很安静的坏法：
① 写之前忘了确认 Harness 已退出（Electron memory-map 了 `app.asar`，会 EPERM，或者更糟）；
② 写完只看退出码、不核对「实际改的条目集合」是不是声明里那几条 —— **锚点全命中、却静默改了别的东西**，
   退出码照样是 0。构建器有 `--expect` 守着，落盘器以前只在落盘后那一瞬才守。

**做了什么**：
- `--to <archive>`：把暂存包**复制**到临时目标（真落盘那条路是 `renameSync`，会把暂存包移走；
  演练之后人还要用同一个暂存包去落盘），然后在临时目标上跑**同一段** `verifyAgainst()` 核对 ——
  两条路共用同一个函数，是为了不让「演练通过」和「真落盘通过」变成两套可能各说各话的判据。
- 两条边界：`--to` 落在 `resources\` 里一律拒绝（那会让人以为落盘了，其实 Harness 读的仍是在用那份）；
  `--to` 指向在用 `app.asar` 时**刻意**按真落盘处理（走 Harness 守卫），不给它开后门。
- `install-whale.cmd /dry`：双击版演练，落盘后的提示改成 `node src\cli.mjs accept`（接上验收闭环）。

**怎么验的**：`test/install.test.mjs`（**26 条断言**，发现式总入口自动收，套数 5 → **6**，4.1 秒）：
两次独立构建 sha256 相同（确定性）→ `upgrade --stage` 重打 → `--to` 演练 → 按原版备份核对
「差异集合恰好 = 声明数 = 列出数，一条不多一条不少」→ 三条拒绝路径（无 `--yes` / 目标在安装目录内 /
Harness 在跑时 `assertHarnessStopped` 拦下并报出 pid）→ **全程前后在用 `app.asar` 与原版备份 sha256 均未变**。
唯一**不做**的事：不跑「`--to` 指向真 asar」那条分支 —— 那等于让测试替用户落盘，万一守卫坏了就真改了
安装包；那一条只用源码文本断言它存在。**测试不该有「失败就毁掉现场」的分支。**

**教训**：
1. **一条路径只要「只能在最难重来的那一刻被验证」，它实际上从未被验证。** 把它拆出一个
   「写到别处、但跑同一段核对」的演练分支，代价很小，换来的是它每次 `npm test` 都被真跑一遍。
2. **演练必须复制而不是移动。** 真落盘那条路的 `rename` 是「消费掉暂存包」的语义，
   借来当演练会让演练变成长度很短的落盘。
3. `install-whale.cmd` 里**不能出现非 ASCII 字节**：cmd.exe 按当前代码页解析这个文件，中文 `rem`
   注释会把后续行嚼成 `'K]' is not recognized as an internal or external command` 之类的假错误，
   **而且退出码是 0**（看起来像成功）。现在它是纯 ASCII，中文说明放在 `tracks/T1-appearance/README.md`。
   （顺带一个反直觉的结论：这个文件是 LF 行尾，实测没问题 —— 坏的是字节，不是行尾。）

### 2026-10-06 · 把「故意吞掉异常」的渲染层脚本也变成可验证的：`test/capsule.test.mjs`

**起因**：给 T4 那座插件做重启前的最后一遍风险盘点，发现整条链上只剩一处**没有任何证据**：
`plugins/dsh-up-t/assets/client.js`（左下角胶囊）整段包在 `try { … } catch (e) { console.warn(…) }` 里。
这个 `try` 是刻意加的（挂件坏掉不能影响主界面），但它的代价是**异常不再有第二个出口** ——
界面上「什么都没有」，日志里只有一行 warning，用户重启后只会问「说好的胶囊呢」。
而 `test/plugin.test.mjs` 覆盖的是宿主路由与 `lib/client.js`（设置页 bundle），这个文件**一行断言都没有**。

**做了什么**：`test/capsule.test.mjs`（**16 条断言**，发现式总入口自动收，套数 6 → **7**）。
不查语法，而是用 `node:vm` 给假 DOM + 假 `localStorage` + 假 `fetch`（回**真实形状**的 `status.json`）
把脚本真跑一遍，断言落到**具体产物**上（DOM 里有没有那个节点、面板里的数字是不是人话、
`localStorage` 里有没有那个键）。细节见 `tracks/T4-webgui/README.md` 的第九步记录。

**当场抓到的真 bug**：`localStorage.getItem(HIDDEN_KEY)` 没包 `try`。存储被禁时它抛出的异常被最外层
catch 吞掉，而那一刻**事件监听与定时刷新都还没注册** —— 胶囊在，但点不动、永不刷新，且没有报错。
先跑到 13/16（含这条失败），修完才 16/16。

**教训**：
1. **一段故意吞掉异常的代码，等于把「它坏了」也从世界里删掉了。** 对这种代码，
   「读一遍觉得没问题」不算验证；**把它跑起来、断言产物存在**才算。
2. 断言要落在**产物**上，不要落在**过程**上（「DOM 里有胶囊节点」而不是「挂载函数被调用了」）——
   后者在脚本提前 return / 被外层 catch 时同样会通过。
3. 假宿主/假 DOM 必须模拟真实的**时序**（`readyState`、依赖就绪、`textContent` setter 清子节点、
   事件派发顺序），否则测试会替被测代码把 bug 藏起来。这一条在写 `plugin.test.mjs` 与
   `capsule.test.mjs` 时各踩了一次（假 DOM 少了 `window.addEventListener` ⇒ 13 条里一半假失败；
   用 `cursor === 'grab'` 认胶囊 ⇒ 按住之后找不到，因为按下时它被改成 `grabbing`）。

### 2026-10-06 · 手写素材没有锚点保护：`test/assets.test.mjs`

**起因**：给 T1 的鲸鱼启动画面找**重启前能用的离线证据**。先盘了 `vendor/visual/`（6 个脚本），
发现它们回答的是「画得像不像」（`check-whale-shape.mjs` 甚至把贝塞尔控制点手抄了一份，
自己就会漂移；`capture-frames.mjs` 要真 Chrome + CDP），**回答不了「页面装配对不对」**。
于是换了个更便宜的问题：被替换的页面在归档里引用的东西到底存不存在。

**结果**：一句话就抓出一条会让 **DSH 欢迎/登录窗口变空白**的 bug —— `renderer/welcome.html`
（声明为 `action: replace`，素材是手写的）丢掉了原版加载的 `../lib/welcome/welcome.js`
（欢迎界面自己的 React 启动脚本，挂到 `#root`）和 `welcome.css`，还把 splash 控制器指向了
归档里不存在的位置，CSP 也少了 `font-src 'self'`。它**通过了当时全部检查**：构建 exit 0、
11 个条目按声明改动、其余 11,466 个条目逐字节一致、`node --check` 全过、`doctor` 不报错。
细节与修法见 `tracks/T1-appearance/README.md` 的记录。

**做了什么**：`test/assets.test.mjs`（**28 条断言**，发现式总入口自动收，套数 7 → **8**），
只读归档字节、不读工作区源码，钉住三条不变量：

- **A 引用完整性**：被 insert/replace 的 HTML，它引用的每个本地资源都必须在归档里存在；
- **B 不许丢东西**：`action: replace` 的页面不许丢掉原版引用过的任何资源；
- **C CSP 不许变严**：原版的每条 CSP 指令与源，新的那一份里必须还在（更严 = 原来能加载的现在加载不了）。

**最重要的是 C 与反证**：坏版本原文（991 B，sha256 前 16 位 `5BC23F972FCC30A6`）留在
`test/fixtures/welcome-html-broken-before-2026-10-06.html` 当**永久反例** —— 既证明这三条规则会响，
也证明「就是这些规则没响才放它过去」。另外用合成坏样例做反证，防止规则退化成永远通过。

**顺手修掉自己一个 bug**：`cspOf` 原来写 `content=["']([^"']*)["']`，而 CSP 值里带单引号
（`default-src 'none'`），`[^"']*` 在第一个内层单引号处就截断了 ⇒ 必须成对匹配同一种引号：
`content\s*=\s*(?:"([^"]*)"|'([^']*)')`。（规则本身写错，反证也可能跟着一起错。）

**教训**：
1. **字节核对回答的是「是不是按声明改了」，从不回答「改对了没有」。** `patch` 类素材有锚点保护
   （素材是原版那份文件、逐字节校验、锚点错一处就命中不了），**手写的 `replace`/`insert` 素材没有**。
   凡是替换一整个文件，都要额外问一句：原来那一份加载的东西，新的这一份还在加载吗？
2. **「像不像」和「装没装上」是两层。** 视觉检查再精细也看不见「脚本 404 了」；
   而后者恰恰是所有静默失败的高发区。便宜的不变量检查应该排在昂贵的像素检查前面。
3. **给一条规则立反例，等于给这条规则本身立了防线。** 只用「当前文件是对的」做断言，
   规则写错时测试照样全绿 —— 把真实坏版本存进 `test/fixtures/` 才有意义。

### 2026-10-06 · 让「从来没人执行过」的代码被执行一次：`test/splash.test.mjs`

**起因**：`test/assets.test.mjs` 关掉了「页面装配」这一层，但还剩一层更靠下的静默区 ——
启动窗口那两段脚本（`lib/welcome/whale-animation.js` 23,828 B、`renderer/whale-splash.js` 7,311 B）
此前只有 `node --check`（语法）与逐字节核对（是否按声明改动）。
**这两样加起来仍然不回答「跑起来对不对」**：canvas 画不出来时不抛异常，只是什么都没有。

**做了什么**：`test/splash.test.mjs`（**19 条断言**，发现式总入口自动收，套数 8 → **9**）——
用 `node:vm` 造一个假浏览器（假 `document`/元素/2D 上下文/`matchMedia`/`localStorage`/`requestAnimationFrame`），
把**归档里**的两段脚本按 `welcome.html` 里同样的顺序真跑一遍，然后推进整条时间线做断言。
脚本来源是 `state/staged/app.asar`（要落盘的那一份），取不到就 `SKIP` 正常退出 ——
不谎报失败，也不假装验过。

**为什么用假 DOM 而不是真浏览器**：`vendor/visual/capture-frames.mjs` 那条路要真 Chrome + CDP，
慢、脆、且只能看像素；而这一层要问的是**行为**（有没有排帧、有没有钳制边界、有没有重画、
有没有把 NaN 喂给画布），假 DOM 更便宜也更精确。**「画得像不像」和「跑起来对不对」是两层，
后者更靠下、也更容易静默失败。**

**测试里最值钱的一条**：2D 上下文的**每一个数值参数都必须是有限数**。
`createLinearGradient(NaN, …)` / `bezierCurveTo(NaN, …)` 都不报错，只是什么都不画 ——
**NaN 是 canvas 最典型的静默失败**，而全时间线 + 全重画都从这一条过。

**教训**：
1. **「语法正确 + 字节吻合」与「跑起来是对的」之间隔着一整类失败**，它们的共同特征是**只在真正执行时才出现**。
   第一屏、没有兜底的界面代码，都值得备一个假浏览器。
2. **期望值要量出来，不要推算出来。** 本轮三条假失败全出在这上面：写死 `616px` 而实际钳制值是 `615.76px`
   （挂件高度 `size * 1.08 = 84.24`）；键盘用例复用了上一条把挂件拖到下边界的状态，
   `ArrowDown + Shift` 被钳住不动；断言「创建后已重画 ≥1 次」，而首画是直接排进 raf 的、不走 `el.__paint` 包装。
3. **假宿主必须模拟真实的联动关系。** 第一版假 DOM 的 `className` 与 `classList` 互相不联动，
   于是「挂件到底建出来没有」被假 DOM 说了谎；`querySelector` 能不能找到 `className` 设的类，
   和真 DOM 一样是测试的前提，不是细节。

### 2026-10-06 · 把 T1 的手写素材搬进仓库（验收标准是「产物一字未变」）

**起因**：写 `test/splash.test.mjs` 时盘素材，发现 T1 那 7 个插入文件的素材全在
**仓库之外**（`D:\Z1848\harness-ds\.probe\build\**`），声明里的 `source:` 是 `../../.probe/...`。
后果不是「构建会坏」（`build.mjs` 会响亮报错），而是**一份全新 clone 拿得到声明却拿不到素材**：
其中 `whale-animation.js` 是**手写的 ESM 源**，归档里只有 bundle 之后的那一份 —— 它只活在这台机器上。

**做了什么**：
- 10 个手写文件（39 KB）复制进 `vendor/whale/materials/`：`renderer/{welcome.html, whale.css, whale-splash.js,
  pendant.html, pendant.css, pendant.js}`、`lib/preload-charm.cjs`、`whale-animation.js`、
  `preview.html`、`client/whale-charm-settings.js`；`patches/T1-whale-splash.yml` 的 8 条 `source:` 改指仓库内。
- **`action: patch` 的三份原版缓存刻意不入库**（`lib/main.js` 490 KB、`lib/preload-app.cjs` 41 KB、
  session-controller 124 KB）：它们是上游原文，属安装包内容，体量大；任何一份 `app.asar` 都能原样重抽
  （`node vendor/asar/list.mjs --get <归档内路径> <目标>`），而构建时会**逐字节校验**它们与当前归档一致 ——
  不一致直接报错，所以「不入库」不会退化成静默风险。声明顶部与 `patches/README.md` 都写清了这个分界。
- `vendor/whale/bundle.mjs` 的 banner 原本写死 `GENERATED from ../../.probe/build/whale-animation.js`：
  素材一搬位置，这句话就变成假话。改成按**相对项目根**生成
  （`GENERATED from vendor/whale/materials/whale-animation.js …`），`PROJECT_ROOT` 从 `vendor/lib/harness.mjs`
  导入，不在这里自己推一份。

**怎么验的（关键）**：这类「搬家」最容易被「构建 exit 0」蒙过去，所以验收标准定成**产物一字未变** ——
先记下搬家前 `state/staged/app.asar` 的 sha256（`E6A1EAD1EAAF9433A3214F65B20D484DCA7BDA1308286B20C576A3FFC9E5DD71`，121,416,081 B），
再用新路径重建到 `state/cmp/repro-check.asar` ⇒ **sha256 完全相同**。
随后改 banner 重建正式暂存包：11 个条目按声明改动、其余 11,466 逐字节一致，大小 121,416,085（+4 字节，
正是 banner 里那句路径变长的那几字节）。全套 **9/9 套**测试、`doctor` 0 错误 2 警告。

**教训**：
1. **「能构建」不等于「构建的是同一件东西」。** 搬素材、换路径、升级工具链这类动作，正确的验收标准是
   **产物哈希不变**，而不是「跑通了」。定下哈希再动手，任何意外的内容变化都会当场暴露。
2. **手写素材和上游原文要分开对待。** 前者必须入库（丢了不可再生），后者应该**从权威来源现取 + 逐字节校验**
   （库里存一份反而会引入「库里那份过期了」这种新故障）。
3. **产物里不要写死路径。** banner、日志、生成的注释一旦写死位置，就会在搬家那天开始说谎。
4. **把「逐字节参与构建」的文件纳入版本控制，必须同时锁住行尾。** 本机 `core.autocrlf=true`，而这次入库
   的文件是 LF —— 没有规则的话，下次 checkout 会把它们写成 CRLF：`app.asar` 的产物随之变化，
   而 `test/fixtures/welcome-html-broken-before-2026-10-06.html` 的 sha256 也会变
   （`test/assets.test.mjs` 正是**按哈希**认这份证据的）。两者都不会让任何命令报错，
   只会让「产物哈希」和「证据哈希」这两类断言开始说谎。所以新增 `.gitattributes`：`* -text`
   （只关 EOL 归一化，不影响 diff/合并）。**入库一个字节敏感的文件，等于同时接管了它的行尾命运。**

### 2026-10-06 · 渲染类代码的两层验法：真框架看「会不会白屏」，假主机看「数据流对不对」

**起因**：`test/plugin.test.mjs` 用 stub 的 React 钉 `lib/client.js` 的槽位注册**形状**，
而 stub 的 `useState` 只回初值、`useEffect` 什么都不做 ⇒ 组件函数**从未被调用**。
「形状对」和「渲染过」之间的那一整类失败（真渲染时抛错 → 设置里什么都没有、无报错无堆栈）
正是这套测试照不到的地方。

**做了什么**：新增 `test/settings.test.mjs`（**41 条断言**，发现式总入口自动收，套数 9 → **10**），
把渲染代码拆成两层分别验（记录见 [tracks/T4-webgui/README.md](../T4-webgui/README.md)）：

| 层 | 用什么验 | 证明什么 |
| --- | --- | --- |
| 显示 | 外壳**真实提供的** `react@18.3.1` + `react-dom/server`（`createRequire` 指向 `profiles/node_modules`），`renderToStaticMarkup` | `require("react")` 真解析得到、组件在真 React 下不抛错、aria/文案全对 |
| 行为 | 自写**迷你 hook 主机**（`useState` / `useEffect([])` / 重渲染 / 卸载） | 拉数据、30 秒轮询、桥的 `state()`/`onChange`、失败回退、卸载撤监听 |

**两条可复用的做法**：
1. **不支持的用法要抛错，不要默默忽略。** 假主机只实现空依赖数组的 `useEffect`，
   遇到带依赖的 effect 直接**报错要求先扩展它** —— 默默跳过等于「以为测了、其实没跑」。
2. **横向收尾断言**：全程只该响过一次 `console.warn`、这个 bundle 只该请求过那三条路由。
   单个用例全绿而横向约束被破坏，是这类测试最容易漏的一档。

**代价与取舍**：真 React 是外壳冻结的平台模块，**不 vendored 进仓库**（否则要跟着上游升版本）；
解析不到就 `skip` 那三条、其余照跑。**不用真浏览器也能验行为**，和 `test/splash.test.mjs` 同一条思路。

**怎么验的**：`node test\settings.test.mjs` → **41/41**、退出码 0、stderr 0 字节；
`node test\run.mjs` → **10/10 套**；`node src\cli.mjs doctor` → 0 错误 2 警告。

**教训**：
1. **「形状对」不等于「渲染过」。** stub 掉框架的测试证明的是协议，不是行为；两者都要有，
   但别拿前者当后者的证据。
2. **又是「期望值从推算来」这一类失败**（唯一一次失败 40/41）：断言里写『需要重启 Harness』，
   而代码里的文案是「要重启 Harness 才会重新加载」。凡是钉**界面文案**的断言，先量再写。
3. 一条 `createRequire` 就能把「白屏且不报错」整类失败变成红色 —— 这类防线便宜得值得默认配上。

### 2026-10-06 · 给仪器写说明书：`vendor/visual/README.md`（顺手修掉一条 cwd 依赖）

**起因**：那 6 个脚本归拢进来时只做了「能不能跑」的冒烟，没有任何地方写清**各自的适用范围与依赖**。
后果是下次想问「画得像不像」时会先踩两个坑：`capture-frames.mjs` 到底要不要真 Chrome、
`check-whale-shape.mjs` 的落盘文件到底在哪。**仪器没有说明书，等于每次都要重新摸索一遍。**

**做了什么**：新增 `vendor/visual/README.md`（`vendor/README.md` 的 `visual/` 一节改为指向它，
并把原来那句不准确的「6 个，只读」改成「6 个，都不碰 DSH 安装目录」——其中两个确实会落盘）：

| 脚本 | 用法 | 依赖 | 落盘 |
| --- | --- | --- | --- |
| `capture-frames.mjs` | `<previewUrl> <outDir> [--times …]` | 真 Chrome（路径硬编码）+ CDP 9333 | `<outDir>/frame-<t>.png` |
| `trace-whale.mjs` | `<frame.png> [--cols 96] [--rows 40]` | 无 | 否 |
| `analyze-frames.mjs` | `<dir>` | 无 | 否 |
| `frame-colors.mjs` | `<frame.png>` | 无 | 否 |
| `check-whale-shape.mjs` | `[--out <file>]` | 无（不需要 Chrome） | `.probe/frames/whale-silhouette.txt` |
| `serve-dir.mjs` | `<dir> [port]`（默认 `preview.html`、8129） | 无 | 否 |

**写清的两条边界**：① `capture-frames.mjs` 第 219-227 行先查 `window.__splash`，
而这个钩子只由 `vendor/whale/materials/preview.html:93` 提供 ⇒ **它只能对着 `preview.html` 抓帧**，
不能对着归档里的 `welcome.html`；② `check-whale-shape.mjs` 的贝塞尔控制点是**从
`whale-animation.js` 手抄的**（文件注释写着 Keeping it in sync matters）⇒ 改了动画控制点必须同步改它，
否则「形状对」是旧形状的结论。另外写明分工：**行为对不对**由 `test/splash.test.mjs` 与
`test/settings.test.mjs` 断言（红了就是坏了）；这 6 个是**取证的仪器**（打印数字给人看）。

**顺手抓到的真缺陷**：`vendor/visual/check-whale-shape.mjs` 末尾写的是**相对 cwd** 的
`.probe/frames/whale-silhouette.txt`，且只 import 了 `writeFile`、**不建目录**。
实测 `deepseek-up-T\.probe\frames` 不存在、只有工作区根 `D:\Z1848\harness-ds\.probe\frames` 存在
⇒ **从项目目录运行必然 ENOENT**（当初冒烟 exit 0 是因为 cwd 恰好在有那个目录的地方）。
这正是 `vendor/README.md` 明令避免的「路径靠 cwd 决定就静默写错位置」那一类。
改为从 `vendor/lib/harness.mjs` 取 `WORKSPACE`（与其它 vendor 脚本同一个来源）+ `mkdir` 递归 +
打印落盘路径，并新增 `--out <file>`。

**怎么验的**：修完在**两个不同的 cwd**（项目目录、`%TEMP%`）各跑一次 —— 都 exit 0、stderr 0 字节、
写到**同一个绝对路径**，指标一字未变（`VERDICT: tail notch present (reads as flukes)`、
bbox aspect 1.59、`tail columns 2-run = 53`、左/右质量 59.8% / 40.2%）。

**教训**：
1. **「搬过来能跑」不等于「搬过来对」。** 归拢时冒烟用的是当时的 cwd，cwd 依赖被掩盖了；
   凡是会写盘的脚本，都要问一句「路径从哪来」。
2. **仪器也要写适用面。** 一个脚本的用法、依赖、副作用、以及**它回答不了什么**，
   是它能不能被正确使用的一半。

### 2026-10-06 · 「落盘后稳态」那节测试，曾经在一种完全正常的工作状态下变红

- **症状**：改完素材、重建了暂存包、**还没退出 Harness 落盘**时跑 `node test/run.mjs`，
  得到 `9/10`，`upgrade.test.mjs` 报 6 条失败：「稳态判定为 unchanged」给的是 `asar-changed`、
  「稳态不再报素材过期」多出一条 `T1-whale-splash`、退出码 1……
  看上去像升级检测坏了，实际上**工具是对的**：暂存包与基线描述的那份安装包确实不一样。
- **根因（在测试夹具里）**：那一节把 `state/staged/app.asar` **硬链**成「已改造的安装包」，
  注释写的是「暂存产物就是落盘后的样子」。这句话只在「先落盘再跑测试」时成立。
  而 `--no-hash` 判据是**按大小**比基线，于是「重建过、没落盘」的暂存包一进场就判 changed，
  连带 `src/upgrade.mjs:292-305` 把素材比对基准从原版备份切成那份已改造的归档 ⇒ 一堆假「素材过期」。
- **改了什么**（`test/upgrade.test.mjs`）：
  - 夹具改用**现场真正装着的那一份** `P.asar`（基线描述的就是它），不再拿暂存包顶替。
  - 版本文件跟着现场走（`readText(P.versionFile)`），不再写死 `44.0.0` —— 那条会在 Harness 真升级后变成假失败。
  - 新增前提断言「在用的 app.asar 确实已被改造」；**没落盘过就 `skip` 这一节**并打印原因，
    而不是让六条断言拿 `null` 去假通过。
- **为什么值得单独记一条**：纪律写的是「提交前必跑 `node test/run.mjs` 全绿」，
  而**任何需要落盘的改动**都会经过「已重建、未落盘」这个中间状态。夹具一旦依赖「必须已经落盘」，
  这条纪律在那个状态里就是做不到的 —— 测试会把「正常」报成「坏了」，接着人就开始不看它了。
  凡是把「环境此刻长什么样」写进断言的测试，都要问一句「这个前提在哪种正常工作状态下不成立」。
- **怎么验**：`node test/upgrade.test.mjs` → 全部通过（含稳态那 7 条）；`node test/run.mjs` → **10/10 套**。

### 2026-10-07 · `asar/list.mjs --get` 的默认值骗过一次哈希核对

- **症状**：核对「暂存包里那份 `renderer/replay.js` 是不是修好的版本」时，用
  `node vendor/asar/list.mjs --get renderer/replay.js <临时文件>` 抽出后算哈希，得到
  **2144 B / `782116F8…`**，与 `vendor/whale/materials/renderer/replay.js`（2835 B / `E2695F4B…`）
  **不一致** —— 看上去像「改了素材但没重建」。
- **根因（在命令里，不在产物里）**：`--get` 与列表命令一样，**不写 `--archive` 时读的是在用安装包**。
  它老老实实抽了一份**真代码**出来，只是不是我以为的那一份：2144 B 那份正是 21:36 落盘的旧版
  （没有 try/catch 兜底）。补 `--archive state\staged\app.asar` 后：**2835 B / `E2695F4B…`**，
  与素材逐字节一致，演练产物 `state/cmp/rehearsal-app.asar` 里那份也相同。
- **改了什么**：`vendor/asar/list.mjs` 的 `--get` 现在打印来源路径，省略 `--archive` 时明确标注
  `← 默认（在用安装包，不是暂存包）`；文件头用法注释与 `vendor/README.md` 安全约定新增第 5 条。
- **教训**：**一个命令的默认值就是它最容易说错的地方。** 这类工具默认指向「真正在跑的那一份」是
  对的设计（多数时候那才是你要的真相），但当你要比的是**另一份**归档时，它不会报错、也不会提醒，
  只会把一个看起来很像的哈希交给你。凡是「哪一份」会成为结论的一部分的命令，输出里就必须有「哪一份」。
- **怎么验**：不写 `--archive` → 打印 `2144 字节` + 默认标注；写 `--archive state\staged\app.asar`
  → 打印 `2835 字节` + 该路径；`node test/run.mjs` → 10/10 套。

### 2026-10-07 · 同一条判定，两份实现，一张输入表：`src/staged.mjs` + `test/staged.test.mjs`

- **起因**：T4 第十二步把「暂存包比在用安装包新」做成了界面上看得见的一件事（胶囊变橙 / 设置页一行）。
  但同样这条事实在**终端**里仍然不存在：`doctor` 比的是「在用安装包 vs 原版备份」，`upgrade` 比的是
  「在用安装包 vs 基线」——**暂存包根本不在任何一处比较里**。于是同一个人可能在终端看到
  「没检测到任何变化」，转头在界面上看到「待落盘」。
- **做了什么**：新增 `src/staged.mjs`（`stagedVerdict` 纯函数五态 + `stagedFacts` 读盘 + `stagedLine` 一行话），
  `doctor` 的「安装包」段多一条 `暂存包`，`upgrade` 的人类报告末尾多一段（`--json` 里多 `staged` 字段）。
  `src/paths.mjs` 新增 `stagedFile`。
- **★ 最要紧的一条**：判定有**两份实现** —— `src/staged.mjs`（终端）与 `plugins/dsh-up-t/lib/index.js`
  （图形界面）。两份必须说同一句话，否则会出现「界面说待落盘、终端说一切正常」：人不知道该信哪个，
  于是两个都不信。所以 `test/staged.test.mjs` 里最值钱的一条不是断言文案，而是**交叉对照**：
  同一张 10 行的输入表喂给两份实现，逐格比对 `{status, why, deltaBytes}`。改一份忘另一份会立刻变红。
  措辞本身也是判据（`behind` 必须说「别用它落盘」、`same-size` 不许说成「逐字节相同」、
  0 字节必须说「0 字节不是证据」），所以对照是逐字的，不是「状态码相同即可」。
- **为什么判定与 I/O 要拆开**：五态里有两态（0 字节的暂存包、暂存包比在用的更旧）若只能靠
  「改真文件再复原」来造，测试中途一死就留下一个被改过的 121 MB 产物 —— 拿交付物换两条断言不划算。
  拆开后判定表直接喂数字，I/O 那半边只需一条真机断言（项目根必须解析到仓库根：junction 的 realpath
  一旦失效，表现是「什么都拿不到」却不报错）。
- **`pending` 不影响退出码**：它是**常态**（落盘要等人退出 Harness，谁都可以拖），不是故障。
  把它算成失败就是把「正常工作状态」变成红的 —— 这正是「落盘后稳态」那节测试犯过的同一类错。
- **这套测试当场抓到自己的一条错**：真文件那一节原本先写暂存包再写安装包，于是「谁后写谁 mtime 更新」
  ⇒ 判成 `behind`。**那是写入顺序，不是判定**；改成显式 `utimesSync` 之后才真的在测方向。
  与 splash 那 6 条假失败同源：**期望值要量出来，不要推算**。
- **怎么验**：`node test/staged.test.mjs` → 10/10（含交叉对照与「doctor 输出里真的有这一条」）；
  `node test/run.mjs` → **11/11 套**；`node src/cli.mjs upgrade` → 结论行下方多出
  「暂存产物：暂存包比在用安装包新（大 692 字节）」并给出落盘命令，退出码仍 0；
  `node src/cli.mjs doctor --no-hash` → 「安装包」段有一条 INFO `暂存包`，仍是 0 错误 2 警告。

### 2026-10-07 · 同一条事实，三个命令，三个取向：`doctor`/`upgrade` 说 info，`accept` 说 FAIL

- **起因**：上一条把「暂存包比在用的新」补进了 `doctor` 与 `upgrade`。但真正会在**落盘之后**被跑的那条
  命令是 `accept`，而它对这件事一个字都不说 —— 更要紧的是，它上面那些 L3 项判的是
  「声明有没有落」（`insert` 条目在不在归档里、素材对不对），**判不了「落的是不是最新的一份」**。
  于是「构建了但忘了落盘」会让整份验收显示成绿的，而那正是这份验收要回答的问题。
- **做了什么**：`runAccept` 新增一项 `staged-fresh`「这次验收的是最新构建」，取值来自 `src/staged.mjs`
  的同一个五态判定（`runAccept` 多一个 `staged` 注入口，供测试喂数字，不必去动 121 MB 的真产物）：
  `pending` → **FAIL** + 落盘三步修法；
  `behind` → pass（没有更新的东西要落，但提示那份旧暂存包别拿去落盘）；
  `same-size` → pass（并明说「不等于逐字节相同」）；
  `differs` → SKIP（判不出方向就不硬答）；
  其余 → SKIP 并把 `why` 原样说出来。
- **★ 为什么同一个事实要有两种取向（这是本条记录的要点）**：`doctor` / `upgrade` 回答的是
  「环境现在是什么样」，`pending` 在那里是**常态**（落盘要等人退出 Harness，谁都可以拖），
  把它算成失败就是把一个正常工作状态染红；`accept` 回答的是「我改完重启之后到底成没成」，
  那里有未落盘的产物就意味着**验收对象不对**。两个取向都写在各处的注释与文档里，
  免得下一个人以为是漏改。落盘会把暂存包移走（`install.mjs` 用 rename，退回原地复制时也删），
  所以 `accept` 不会在落过盘之后一直红。
- **测试那半边最要紧的一条**：`test/accept.test.mjs` 里「与暂存包无关」的各节现在统一走一个
  `run()` 包装（默认注入「没有未落盘产物」的桩）。原因不是洁癖 —— 这块磁盘上此刻**确实**有一份
  待落盘的产物，不注入的话那些节的断言会跟着「今天有没有构建过」变红变绿。
  这正是本项目反复撞上的那类错误：**凡是把「环境此刻长什么样」写进断言的测试，
  都会在某一种正常工作状态下说错话。**
- **怎么验**：`node test/accept.test.mjs` → 全部通过（含五态各一条 + 真机一条）；
  `node test/run.mjs` → **11/11 套**；`node src/cli.mjs accept` →
  `FAIL 这次验收的是最新构建 暂存包比在用安装包新（大 692 字节）…` + 修法一行，
  `通过 12 项，失败 1 项，无法判断 0 项，需要人看 7 项`，**退出码 1**（这是它应该做的）；
  落盘并重启之后这一项会消失（暂存包已被落盘消费）。

### 2026-10-07 · 唯一一条回头路，第一次被测试跑到：`--rollback` 的 `--to` 演练

- **起因**：T1 落盘之后，「出问题怎么退」全项目只有一个答案 —— `node vendor/whale/install.mjs --rollback`。
  而它 `grep rollback test/install.test.mjs` **一条都没有**，并且与落盘不对称：落盘有 `--to` 演练
  （理由写在 `install.mjs` 头注释里：**一年做几次的事等于没验证**），回滚**连演练模式都没有**。
  于是那条「出事时才跑」的命令，是唯一一条只能靠真出事来验证的命令。
- **做了什么**：① `--rollback --to <archive>` —— 把备份复制到临时目标并跑同一段逐字节核对，
  两条规则与落盘对称（目标落在安装目录里拒绝；`--to` 指向在用 `app.asar` 时按真回滚处理，仍过守卫）。
  ② 核对抽成共用段 `verifyRollback(target, { rehearsal })`，演练与真回滚共用 ——
  不让「演练通过」和「真回滚通过」变成两套可能各说各话的判据（这条原则就是从落盘的
  `verifyAgainst` 抄来的）。③ 真回滚的输出补上后面两步：重启 Harness、`baseline write`
  （不刷基线的话 `upgrade` 会把这次回滚报成「安装包被动过」），以及「想装回改造版怎么走」
  （`build.mjs` 重建是确定性的，再 `install.mjs --yes`）。④ 把「回滚刻意不要 `--yes`」
  的理由从 `patches/README.md` 搬进了代码注释：失败提示印出来让人原样复制的就是那条命令。
- **★ 「真回滚」也能离线测，靠的是早就存在的 `DSH_UP_T_INSTALL_DIR`**：`src/paths.mjs` 允许覆盖
  安装目录 ⇒ 测试把整个安装目录换成一个临时目录（占位文件当 `app.asar`、把**真备份硬链**过去当
  `app.asar.whale-backup`），然后跑**同一段真回滚代码**。守卫按真实进程表判断，所以两条路都有断言：
  Harness 在跑 ⇒ 断言它被拦下、占位文件一个字节没动、提示里有 pid；Harness 没在跑 ⇒ 断言
  `app.asar` 真的变成了备份内容。**跑的是哪一条会打印出来**（Harness 在跑时 60 条、
  没在跑时 57 条 + 1 SKIP，区别就在这），而不是假装两条都测了。
- **顺手钉住的次序**：没有备份时先报「没有备份可回滚」，**不是**先让用户去退出 Harness ——
  回头路本身就不存在的时候，不必惊动任何人。（这条在 Harness 开着时才有区分度：先过备份检查
  就会得到备份的报错，先过守卫就会得到守卫的报错。）
- **⑤ 一条命令变成三条，全收进那个双击脚本**：`install-whale.cmd` 原来只有 `/dry` 和真落盘，
  现在标志顺序无关地支持 `/dry`（演练落盘）、`/rollback`（真回滚）、`/rollback /dry`（演练回滚）。
  出事时该跑的就是 `install-whale.cmd /rollback` —— **不必记命令，也不必记参数**；
  真回滚那条路和其它两条共用同一个 Harness 守卫，所以它拦下你的时候会告诉你先去托盘 Quit。
  失败提示也从「去手打 `node vendor/whale/install.mjs --rollback`」改成「`install-whale.cmd /rollback`」。
- **★ `.cmd` 是这里唯一没有任何工具会检查的产物**，所以测试不再只读它的文本：`test/install.test.mjs`
  第 4c 节**真的执行** `cmd.exe /c install-whale.cmd /dry /test` 与 `/test /rollback /dry`（顺带证明
  标志顺序无关），断言退出码 0、两条演练产物分别与暂存包/备份逐字节相同、都明说「live app.asar was NOT
  modified」、演练时没有 `[STOP]`。子进程的 `PATH` 前面补上 `path.dirname(process.execPath)` ——
  测试跑在哪个 node 上都成立。另外三条结构断言钉住它自己的约束：**全文只能有 ASCII**（cmd.exe 按当前
  代码页解析，中文是已知的坏法）、真回滚**不许**带 `--yes`、真落盘**必须**带 `--yes`。
- **⑥ 两条「真路径」的守卫分支也被跑到了**（Harness 在跑时）：`install-whale.cmd /test` 与
  `/test /rollback` 都必须**退出码 2**、打印 `[STOP]`、让人先去托盘 Quit，并各自给出对应的演练命令
  （落盘那条给 `/dry`，回滚那条给 `/rollback /dry`）。这一段是整个测试里唯一一处「条件决定跑不跑」的
  地方：Harness 没在跑时它会真的写安装包，所以那时改成一条 SKIP 并说明原因 ——
  **跳过要说理由，不能让「没测」看起来像「测过了」**。
- **教训**：**「一年才跑几次」不是不测它的理由，而是不测它就更不可能发现的理由** ——
  尤其当它恰好是**出事时才会跑**的那一条。落盘当初加上 `--to` 就是因为这个道理，
  回滚没跟上只是因为它更少被想起来。
- **怎么验**：`node test/install.test.mjs` → 60/60（Harness 在跑时）；`node test/run.mjs` → **11/11 套**。
  手工：`node vendor\whale\install.mjs --rollback --to state\cmp\rb-rehearsal.asar` → exit 0、
  产物 sha256 `983ca71114e6dfd3…` 与备份相同、在用安装包未变；
  `DSH_UP_T_INSTALL_DIR=<临时目录>` 下真跑 `--rollback` → 被判成「不能从备份回滚 app.asar」，
  目标目录里的占位文件哈希未变。

### 2026-10-07 · 另一条「出事时才跑」的路：`snapshot restore` 第一次被测试跑到

**起因**：`test/snapshot.test.mjs` 覆盖的其实只是**删除**（`prune` / `deleteSnapshots`：这个会删目录的
工具凭什么不会删错东西）。而 `snapshot restore` 是会把 profile 控制面文件
（`cordis.patch.yml` / `cordis.yml` / `package.json` / `pnpm-workspace.yaml`）**覆盖**回去的那条路 ——
和 `install.mjs --rollback` 完全同一类：平时不跑、出事才跑、跑错代价很大。

**★ 为了让它在系统临时目录里跑，先补了三个 `P` 参数**：`createSnapshot` / `restoreSnapshot` /
`diffSnapshot` 原本内部自己调 `resolvePaths()`，而 `snapshotsDir` 固定在 `PROJECT_ROOT/state/snapshots`
下 —— 离线测就只能往**真实**快照目录里写、并且（因为回滚会写回 profile）往**真实** profile 里写。
改成与 `listSnapshots` / `planPrune` / `deleteSnapshots` 一致的 `P = resolvePaths()` 尾参数后，
测试传一个假的 `{ profileDir, snapshotsDir, asar, … }` 就能整条链跑在临时目录里。
**教训：一个函数能不能被测，是它的签名决定的，不是测试决定的。**

**顺着写断言，修掉三个真缺陷**（都不是新写的代码，是一直就有的）：

1. **回滚原本优先用快照里记的绝对路径**：`const dest = f.src || TRACKED_FILES.find(...)?.pick(P)`。
   同一 profile 名、但 `DSH_HOME` 换过之后，`f.src` 指向旧家目录 ⇒ 回滚**报成功，而现场一个字没变**。
   现在改成按**文件名**解析到当前 profile 目录（`resolveDest()`），位置与快照里记的不一致时
   在 `restored` 行里带上 `relocatedFrom`，CLI 多打一行「快照记的是 …」。
2. **越界写入**：只有「连名字都不认识」的条目才会回退到记录路径，而现在那条路径必须落在
   当前 profile 目录**之内**，否则跳过并说明原因。快照是仓库里的普通文本，手改过的
   `meta.json`（或者从别处拷来的）不该能指挥这个工具往任意位置写。
3. **同一秒内创建两份快照会拿到同一个 id**（时间戳精确到秒；标签也一样时更是必然），
   第二份直接写进第一份的目录 ⇒ **「回滚前的那一份」被静默覆盖**。现在 `id` 已被占用时
   自动加 `-2` / `-3` 后缀。这条正好命中这个项目最在意的那类丢失。

**顺手让两处措辞对齐**：`diff` 与 `restore` 原本对「快照拍下时还不存在、之后才出现的文件」
说两句话 —— 前者报 `已改动`（听着像会被撤回去），后者把它算进 `skipped`（根本不动）。现在
`diff` 说的是 `快照之后才出现（回滚不会动它）`。**同一个事实的两处输出，必须能被同一句话解释。**

**★ 这套测试第一版 6 条里挂了 5 条，全是我自己的期望值算错**（`makePaths()` 里派生路径写的是
闭包外那一份 `profileDir`，所以给 `P2`/`P3`/`P4` 换目录全都没生效；`preSnapshot` 断言写成了
`^prerestore-`，而 id 是「时间戳-标签」；asar 那两条把「文件存在且未变」错当成「拿不到」）。
与 splash 那 6 条假失败**同源**：**期望值要量出来，不要推算** —— 尤其是「我换了目录」这种
自己以为已经生效的前提。

**怎么验**：`node test/snapshot-restore.test.mjs` → **12/12**；`node test/run.mjs` → **12/12 套**
（新增文件被发现式总入口自动收进去）；真实现场只读复核：`snapshot diff <最新一份>` 打印四个文件的
状态与 `app.asar：未变化`，`snapshot restore <id>`（不带 `--yes`）只列将被覆盖的文件并明说
「此刻还没有动任何文件」，退出码 0。

### 2026-10-07 · `vendor/asar/` 三件套自己第一次被测到（顺手堵掉两条真隐患）

**为什么**
上一轮补掉 `install.mjs --rollback`、这一轮补掉 `snapshot restore`，用的是同一条判据：
**「出事时才跑的那条路」最需要测试，因为它平时没有机会暴露问题**。照着这条判据过一遍剩下的工具，
`vendor/asar/`（`list` / `verify` / `write`）**没有任何测试引用过**：`verify.mjs` 只是被
`install.mjs` 通过 `runAsarVerify` 间接用、`write.mjs` 连一个自动调用者都没有 —— `TOOLS.write`
只是把路径摆在那里。而它是**除落盘器之外唯一能重写 `app.asar` 的工具**。

**做了什么**
1. `test/asar-tools.test.mjs`（**15 条**，不碰安装目录），三层：
   - ① **用测试文件里自己的序列化实现**造一个几 KB 的合成归档（`buildArchive()`，不调用被测工具；
     先自证头布局 `u32@0 === 4`、`u32@12 === u32@4 - 8`），覆盖 `list` 的正则匹配 / 无前导斜杠 /
     `--get` 往返 / `--get` 不存在的条目；`verify` 自己跟自己（`checked === 3`）、SIZE 差异算「恰好 1 个」、
     **同尺寸字节翻转即使 `--expect 1` 也必须失败**；`write` 省略 `--out` 写暂存位且输入 sha256 未变、
     替换 1 条、新增一条报 `ADDED`、三条用法错误且失败时不留 `.tmp` 残渣。
   - ② **三条「写哪儿」的守卫**（见下）。原地重写那一条按 `harnessRunning()` 分支：在跑就断言被拦下
     （退出码 1 + `pid \d+` + 托盘提示 + 目标 sha256 未变），没在跑就断言**真的写下去**了
     （再 `verify --expect 1` 核对），并把跑到的是哪一条打印出来 —— **不假装两种情形都测了**。
   - ③ 真实归档往返：拿在用 `app.asar` 当**只读**输入换掉 `lib/main.js`，产物写到 `state/cmp/`，
     核对恰好 1 个差异、其余 **11,478** 个归档内条目一字未动、输入 sha256 未变，末尾删产物。

**★ 顺带堵掉两条真隐患（`vendor/asar/write.mjs`，三条规则都排在打开归档之前）**
- **省略 `--out` 时输出跟着输入走** ⇒ 输入就是在用安装包时，正好在安装目录里造出
  `doctor` 专门报的 `app.asar.tmp` 残留。那个位置**真的有前科**：一块 121,415,608 B 的坏构建在那里躺了
  一整天，主进程一加载就 SyntaxError。现在这种写法直接拒绝，并给出一个安装目录之外的例子。
- **`--out` 指向 `app.asar.whale-backup`** ⇒ 那是**唯一一条回头路**（`doctor` 的「原版备份」一条与
  `install.mjs --rollback` 都靠这一份），覆盖它之后装坏了就没得回去。现在无条件拒绝，并指向
  `install.mjs --rollback`。

**教训**
- **「没有自动调用者」和「没有测试」是同一件事的两面。** 一个工具的守卫如果只写在源码里、
  没有任何东西会执行它，那它的存在感只等于注释。这次连"谁来跑它"都要先问一遍。
- 又是**期望值算错**：合成归档换成真实归档时我写了 `checked > 12000`，实测 `11478` ——
  `checked` 只数**归档内**条目，`.unpacked/` 下的 1497 个走另一条统计。**期望值要量出来，不要推算。**
- 测「写文件」的工具时，**先想清楚失败时会不会留下痕迹**：所以每条拒绝路径都额外断言目标 sha256 未变、
  `app.asar.tmp` 不存在。

**怎么验**：`node test/asar-tools.test.mjs` → **15/15**；`node test/run.mjs` → **13/13 套**
（发现式总入口自动收进去）；手工复验三条拒绝路径的 stderr 文案与在用安装包 sha256 未变。

### 2026-10-07 · 只读读归档的那条路（`src/asar.mjs` + `dsht asar ls|cat|grep`）第一次被测到

**为什么**
照上一节那条判据（「没有自动调用者」与「没有测试」是同一件事的两面）继续过一遍剩下的工具，
`src/asar.mjs` 与 `dsht asar ls|cat|grep` **一条测试都没有**。而它有两个特殊性：
① 它是本项目读「**真正在跑的那份代码**」的**唯一**方式 —— asar 内的包、`profiles/node_modules/@deepseek-ai/*`
（junction 到本地构建树）、源码仓库三者可能是**三个版本**，只有归档里那份是运行中的 Electron 加载的；
② 它**已经出过一次静默错答**：`listAsarPaths()` 曾经返回带前导斜杠的 `/lib/main.js`，于是
「拿声明里的键去查归档里有没有」10 个条目**全部**报「归档里找不到」，而它们其实都在。
一个只在被读的时候说错话的工具，比不存在的工具更危险：它会把人引去修一个不存在的问题。

**做了什么**：`test/asar-cli.test.mjs`（**19 条**），三层：
- ① 纯函数（`readAsarHeader` / `walkAsar` / `listAsarPaths` / `findAsarNode` / `asarDataStart` /
  `readAsarEntry` / `grepAsarContent` / `asarStats` / `asarPackageIndex`）打在**本文件自己序列化**的
  几 KB 合成归档上（与 `src/asar.mjs` 的读法互证）：头部两种坏形态（截断 / 布局不符）必须报错、
  `walkAsar` 从 `header` 而不是 `header.files` 起步、`unpacked` 条目回落到 `<归档>.unpacked/`、
  `grep` 的行号与后缀白名单（`.bin` 内有命中也不扫）、`limit` 是硬上限、`maxBytes` 跳过超大条目、
  目录数用**测试自己递归数一遍**对账。
- ② CLI（`--file <合成归档>`）的退出码与输出：`ls` 无正则的汇总与 `--json`、`ls <正则>` 的
  「匹配 N / 总数」、`cat --out` 落盘逐字节相同、`cat` 一个目录/不存在的条目/缺参数都退 2、
  `grep` 无命中退 1（与「命令失败」区分）、非法正则/未知子命令/归档不存在都退 2 并说清原因。
- ③ 真实 `app.asar` 只读抽查：12,976 个条目路径全部无前导斜杠、`asarStats` 的文件数与
  `listAsarPaths` 长度一致、根 `package.json` 可解析、`grep "managed exclusively"` 命中那句
  desktop profile 独占守卫、且**grep 报出的路径必须真的能 `asar cat`**。

**★ 当场修出四个真问题**
1. **`grepAsarContent` 的命中路径带前导斜杠** ⇒ `asar grep` 打印出来的路径**粘不进 `asar cat`**
   （虽然 `cat` 两种写法都收，但输出与 `asar ls`/声明/暂存树的写法不一致）。现在两端统一成
   `lib/main.js` 那种写法，并加了一条「grep → cat 这条链必须走得通」的测试。
2. **`listAsarPaths` 的顺序是 DFS 栈序** ⇒ 归档内容一变，`asar ls <正则> --limit N` **截出来的是另外 N 条**。
   改为字典序（调用方只用来建 Set、数长度，排序对它们没有影响）。
3. **`walkAsar` / `asarStats` 拿到 `readAsarHeader()` 的整个返回值**（而不是它的 `.header`）时
   **静默吐 0 个条目**。又是一个「什么都没找到」的假答案。现在直接抛错，并把「要传 `.header`」这句话说出来。
   **这一条正是我写这套测试时自己踩的**：`listAsarPaths(h)` 传了整个返回值，测试报「条目数 0」——
   于是顺手把这类错误从静默改成响亮。
4. **带 `g` 标志的正则在 `grepAsarContent` 里会漏报**：`lastIndex` 有状态，同一段文本里
   「第一次命中、第二次不命中」。现在统一去掉 `g`/`y` 标志，并有一条断言「带 `g` 与不带 `g` 结果必须一致」。

**顺带的一致性改动**：`asarPackageIndex` 的值也改成无前导斜杠，`src/doctor.mjs` 里比较的另一端
（数 DSH 插件的 `p.startsWith('/dsh/node_modules/')`）同步改掉 —— 复验 `dsht doctor` 仍逐字是
`asar 内包数 529（其中 DSH 插件 503）`。**期望值要量出来**：合成归档里 `^lib/` 匹配数与目录数、
`grep NEEDLE` 的命中数、`ls <正则>` 的路径顺序，我第一版**四处都推算错了**（5 写成 6、目录 9 写成 4、
命中 3 写成 4、顺序以为按路径排）。

**怎么验**：`node test/asar-cli.test.mjs` → **19/19**；`node test/run.mjs` → **14/14 套**；
手工复验 `dsht doctor`（0 错误 2 警告、503 DSH 插件）与真发现场 `dsht asar grep "managed exclusively"`
（输出 `dsh/node_modules/@deepseek-ai/dsh/lib/bin.js:36`，无前导斜杠、可直接粘进 `asar cat`）。

### 2026-10-07 · 升级后重打的来源、备份轮换与预检回归

- **问题**：Harness 真升级会替换 `app.asar`，旧 `app.asar.whale-backup` 仍在。若默认继续拿旧备份构建，
  会把新版本代码覆盖回旧版；即使声明差异数正确，来源仍可能错。
- **改动**：`build.mjs` 在基线版本或安装包哈希变化时默认从新安装包构建，并写
  `state/staged/app.asar.build.json` 记录来源/产物哈希。`install.mjs` 落盘前核对这两个哈希及声明差异，
  升级安装时将旧备份按哈希留档，再把新版本原版设为当前回滚基准。`write.mjs` 对 Windows 暂存包
  覆盖式 rename 的 `EPERM` 提供保留旧产物的复制回退；清理残留失败不再误触发回滚。
- **验证**：离线模拟新安装包与旧备份并存，证明自动选新来源、拒绝旧来源冒充、演练不碰安装目录；
  备份轮换与同名冲突独立测试；真实 `precheck --json` 为 201 条、0 问题；`npm test` 17/17 套通过；
  `doctor` 0 错误、2 个既有警告。真 Harness 升级仍需到发生时按完整链路验收。
- **恢复**：修改前的 profile 快照为 `20261007-000438-开发前基线-2026-10-07`。
  安装包层若需回退，完全退出 Harness 后运行 `node vendor/whale/install.mjs --rollback`；
  跨版本旧原版备份另存为 `app.asar.whale-backup.<hash16>`，不会被刷新操作抹掉。
- **实际落盘收据**：用户同意退出运行中的 DSH 后，`install.mjs --yes` 将 13 条目暂存包安装到
  `resources/app.asar`；实装 SHA256 `c70bde8f3fe24c88b89e0b9c70b66eb931f3a01212e11ef507c30665a7941855`
  与构建记录完全一致。重启后 `dsht accept` 为 12 pass / 0 fail / 1 skip（skip 是暂存包已被安装器消费）、
  7 项保留人工观感提示；真实启动动画与设置页已在桌面看到。完成验收后才运行 `baseline write`，
  固化 Harness 44.0.0、13 个 bundle、15 条 patch；`doctor` 为 0 错误、2 个既有警告。




