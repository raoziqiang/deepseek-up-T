# 03 · 改造工作流

任何一次改造都走同一个七步环。头两步和尾两步是纪律，中间三步是手艺。

```
① 体检  →  ② 快照  →  ③ 改  →  ④ 预检  →  ⑤ 复验  →  ⑥ 观察  →  ⑦ 收尾
```

## ① 体检

```powershell
node src/cli.mjs doctor
```

先确认现场是干净的。**如果动手前就有 error，先修 error，别在坏地基上盖楼。**
尤其注意 `Harness 进程` 与 `无残留 app.asar.tmp` 两行——它们决定你能不能动 L3。

同时看一眼 `docs/01-environment.md` 里的「已识别的问题」，别重复发现同一个问题。

## ② 快照

```powershell
node src/cli.mjs snapshot create -m "改什么、为什么"
```

快照覆盖 profile 的四个控制面文件（`cordis.patch.yml` / `cordis.yml` / `package.json` / `pnpm-workspace.yaml`）
并记录 `app.asar` 与备份的 sha256。**几 KB，秒级，没有理由不留。**

回滚：

```powershell
node src/cli.mjs snapshot diff <id>        # 先看差在哪
node src/cli.mjs snapshot restore <id>     # 只预演：列出将被覆盖的文件，什么都不写
node src/cli.mjs snapshot restore <id> --yes   # 真回滚（回滚前自动再留一份）
```

两条要知道的：

- **回滚写的是「当前现场」的路径，而不是快照里记下的那条绝对路径。** 同一 profile 名、但
  `DSH_HOME` 换过之后，快照里那条路径指向的是旧家目录 —— 照着它写会「报成功、而现场一个字没变」。
  真发生了这种情况，命令会额外打印一行「快照记的是 …」。
- `snapshot diff` 对「快照拍下时还不存在、之后才出现的文件」说的是
  **`快照之后才出现（回滚不会动它）`** —— 因为它和 `restore` 必须说同一句话（那边会把它算进
  `skipped`），否则人会以为那一行会被撤回去。

快照**只在收尾时清理**（`snapshot prune`，见 ⑦）：攒到几十份之后，真正要回滚的那一份会被埋在
一堆 `…改动前` 中间，选择成本比留快照贵得多。

## ③ 改

按 [02-architecture.md](02-architecture.md) 的优先级选层。绝大多数改动就是在 `cordis.patch.yml` 里加一段：

```yaml
- id: <已被 base 或 bundle 占用的行 id>
  name: "<该行原本的包名>"      # 必须带上，否则 loader 无法定位
  config:
    <你想完全决定的字段>
```

三条硬规则：

1. **必须带 `name`。** 少写 `name` 会导致该条目不生效。
2. **`config` 是整体替换，不是深合并。** 改一个字段时，要把同一 row 其它你想保留的字段一并写出。
3. **中文注释写清楚「为什么」。** 三个月后你自己就是那个读不懂的人。

## ④ 预检（改完、重启前）

```powershell
node src/cli.mjs precheck
```

`precheck` 在隔离探针家里，用安装版 Electron 以 Node 身份跑 **asar 内那份**
`dsh/lib/bin.js --dump-config`，把运行中应用**真正会看到的组合清单**打出来，
并与上一次预检逐条目比对。

**为什么必须做这一步**：`desktop` profile 被 Electron 应用独占，CLI 直接拒绝
`--dump-config`：

```
error: profile "desktop" is managed exclusively by the Electron application
```

于是这是改 `cordis.patch.yml` 之后、重启之前**唯一**的反馈渠道。判据：

- 退出码 `0`，且「问题 0」。
- 「与上一次预检相比」的条目变化**恰好是你打算改的那些**——多一条少一条都要停下来查。
- 想先试一层再落盘，用 `--patch patches/<你的>.yml`，不用动真实 profile。

边界见 [06-precheck.md](06-precheck.md)：预检**不执行 `!!js`、不加载模块、不是 boot**，
所以它只回答「这层配置能不能被 loader 接受、有没有命中预期条目」。

## ⑤ 复验

```powershell
node src/cli.mjs doctor
node src/cli.mjs snapshot diff <id>
```

`doctor` 必须回到 0 error。`diff` 用来确认**只改了你打算改的东西**——如果 diff 里冒出一个你没碰过的文件，停下来查。

## ⑥ 观察

改动是否真的生效，取决于层：

| 层 | 怎么让它生效 | 怎么确认 |
| --- | --- | --- |
| L0 配置 | profile 重载或重启 Harness | 设置页能看到新值；`doctor` 无异常 |
| L1 插件 | 热重载（`dsh-hmr` 已挂载）或重启 | 界面上出现/消失对应能力；**`doctor` 的「运行时」段**读插件心跳，直接回答「重启到底有没有把它装进去」 |
| L2 宿主 | 重启 | 启动日志无报错 |
| L3 安装包 | **退出 Harness（含托盘）** 后落盘，再启动 | 启动窗口/界面实际表现；重启后跑 `node src/cli.mjs accept` 把「声明有没有落、宿主路由活没活、渲染层握手到没到」一次问完 |

L3 的落盘与 Harness 是否运行互斥。**当前会话本身就跑在 Harness 里，所以 L3 改造必须分两次会话完成：先构建好产物，再退出 Harness 落盘。**

**落盘之前可以先演练**（不用退出 Harness，也不动在用安装包）：

```powershell
node vendor/whale/install.mjs --yes --to state/cmp/rehearsal-app.asar   # 或双击 install-whale.cmd /dry
```

它把暂存包**复制**到临时目标，并在临时目标上跑**同一段**声明核对。所以「产物是不是声明里那几条」
这件事不必等到退出 Harness 那一刻才知道 —— 那是整个流程里唯一不可重来的时刻，不该同时用来做验证。

**回滚同样可以先演练**（2026-10-07 起）：

```powershell
node vendor/whale/install.mjs --rollback --to state/cmp/rollback-rehearsal.asar
```

回滚是那条「出事时才跑」的命令，它过去既没有演练模式、也没有一行测试 —— 一年做几次的事，
等于没验证。现在它把备份**复制**到临时目标并跑同一段逐字节核对，所以「回头路好不好使」
可以在需要它之前就知道。真回滚仍然要等 Harness 完全退出，落盘与回滚过的是**同一个守卫**。

两条路都有双击版，而且不用记参数：`install-whale.cmd /dry`（演练落盘）、
`install-whale.cmd /rollback /dry`（演练回滚）、出事时真正要跑的是 `install-whale.cmd /rollback`
（它和落盘过同一个守卫，所以 Harness 还在跑时会被拦下并告诉你先去托盘 Quit）。
`test/install.test.mjs` 会**真的执行这个 .cmd 的两条演练路径**（不是只读它的文本），
并钉住它只能用 ASCII 的那条约束 —— `.cmd` 是唯一没有任何工具会检查的产物。

**「构建了但忘了落盘」会自己报出来**（2026-10-07 起）：`doctor` 的「安装包」段与 `upgrade` 的报告末尾
都有一条 `暂存包`，给五态之一 —— `pending`（比在用安装包新，待落盘）、`behind`（比在用的旧，**别拿它落盘**，
先重新构建）、`same-size`、`differs`（大小不同但时间戳拿不到，判不出谁更新）、`unavailable`（拿不到）。
判定表在 `src/staged.mjs`，与左下角胶囊/设置页里那份**逐字相同**（`test/staged.test.mjs` 交叉对照，
改一份忘另一份会立刻变红）。

`pending` 是**常态而不是故障**：落盘要等人退出 Harness，谁都可以拖。所以 `doctor` 与 `upgrade` 里它只是 info、
**不影响退出码** —— 但它挂了很久就说明昨天构建的东西一直没进安装目录。这条报告是补上一个真实代价换来的：
一份含重播修复的暂存包在磁盘上等了一整天，而当时所有报告都写着「没检测到任何变化」——
因为升级检测比的是「在用安装包 vs 基线」，暂存包根本不在那个比较里。

**但 `accept` 的取向不同，它有未落盘产物时这一项是 FAIL**：`doctor` / `upgrade` 回答「环境现在是什么样」，
`accept` 回答「我改完重启之后到底成没成」—— 它上面那些 L3 项判的是「声明有没有落」，判不了
「落的是不是最新的一份」。有更新的暂存包躺在磁盘上时，这次重启装的就不是你最后构建的那一份，
整份验收不该显示成绿的。落盘会把暂存包移走（`install.mjs` 用 rename，退回原地复制时也会删），
所以落过盘之后这一项就不再是红的。**同一个事实，三个命令三个取向**，这是刻意的。

## ⑦ 收尾

- 在对应 `tracks/T*/README.md` 记录这次改动（改了什么、为什么、怎么验、怎么撤）。
- `node src/cli.mjs baseline write` 刷新基线。
- 快照攒多了就清一次：`node src/cli.mjs snapshot prune`（**默认只预演**，看清保留谁、删谁之后再加 `--yes`；
  `--keep N` 改保留份数，`--keep-match "*-M0-*"` 指定永不删除的一类）。
- git 提交（见 [05-conventions.md](05-conventions.md)）。

---

## 反模式

| 反模式 | 为什么错 | 正确做法 |
| --- | --- | --- |
| 直接改 `profiles/node_modules/@deepseek-ai/*` | 升级/重装即丢失，且 diff 里看不出来 | 用 `cordis.patch.yml` 覆盖对应 row |
| 手改 `cordis.yml` | 协议要求它是空数组，写了也会被组合层覆盖 | 写进 `cordis.patch.yml` |
| 用通用打包器重建 `app.asar` | 会让一万多个条目字节变化，无法审计也无法回滚 | 用 `vendor/asar/write.mjs` 单条目重写 + `verify.mjs` 校验 |
| 改完不 diff 就提交 | 误改会静默进入基线 | 提交前必跑 `snapshot diff` 或 `patchdecl` 比对 |
| Harness 运行中尝试落盘 asar | Windows 会拒绝替换被内存映射的文件 | 连托盘一起退出再落盘 |
| 出事时才第一次跑 `--rollback` | 它和落盘一样「一年做几次」，而且正好是出事时才跑的那一个；没跑过就等于不知道它好不好使 | 先演练 `install-whale.cmd /rollback /dry`（或 `install.mjs --rollback --to state/cmp/rollback-rehearsal.asar`），确认无误后再退出 Harness 跑 `install-whale.cmd /rollback` |
| 只改现场 `cordis.patch.yml` 而不回头改 `patches/*.yml` | 声明不再是权威描述，下次升级重打会退回旧配置 | 改完现场立刻同步声明，用 `dsht upgrade` 查漂移 |

## 升级 Harness 之后

**先跑 `node src/cli.mjs upgrade`**，它会一次给出四件事：变了没有、哪些 L3 声明需要重打、
哪些只是从未落盘、哪份原版素材已经过期（以及 L0 声明有没有漂移）。然后：

1. `doctor` —— 看 `app.asar` sha256 变化与「仅安装包提供」清单是否变动。
2. L0/L1 改动通常自动幸存；若有条目因 base 的 row id 改名而失效，
   `doctor` 的「patch 引用的包可解析」与 `upgrade` 的 L0 漂移检查都会报出来。
3. **L3 改动必然丢失**，按 `upgrade` 给出的重打步骤走：
   `vendor/whale/build.mjs` → **先演练**（`install.mjs --yes --to state/cmp/rehearsal-app.asar`，
   Harness 开着也能跑）→ 退出 Harness → `install.mjs --yes` → 重启后 `node src/cli.mjs accept`。
   若 `upgrade` 报了「原版素材过期」，先用 `dsht asar cat <归档内路径> --out <source>`
   从**新版本**重新抽取素材 —— 拿旧素材打补丁会静默丢掉新版代码，构建守卫会拦下它。
4. 重跑 `baseline write`，把新版本固化成新基线。
   **顺序不能反**：`install.mjs --yes` → 重启 → `accept` → 确认没问题 → `baseline write`。
   提前写基线会把「还没装上的状态」固化成基线，之后的 `upgrade` 就会把你自己刚做过的改动
   报成「环境变了」。

> `upgrade` **不自动落盘**。写安装包必须由人挑时间（Harness 一退出才能做），
> 这是刻意的：一个在后台偷偷替换 `app.asar` 的工具比不做更危险。

### `--stage`：把重打里唯一机械的那步做掉

第 3 步的前半段（构建）没有任何判断成分，但漏做它的代价是「改了声明却忘了重打」——
下一次升级时你会把「从未落盘」误读成「被覆盖了」。所以：

```powershell
node src/cli.mjs upgrade --stage        # 检测 + 真的构建到 state/staged/app.asar
```

- **只写 `state/staged/`，绝不碰安装目录**，所以 Harness 开着也能跑（构建器读安装目录是只读的）。
- 构建按 `patches/*.yml` 的声明逐项核对差异集合：多一条少一条都失败。
- **素材过期时它先不动手**：与其跑到一半被守卫拦下，不如当场说清「哪份 `action: patch`
  的 source 已经不是新版本那一段了」。重抽素材后再跑。
- `--json` 下构建输出被**捕获**进 `staged.stdout`，不会混进 JSON 文档。
- 落盘与写基线仍要人做（**先演练** `install.mjs --yes --to …` → 退出 Harness → `install.mjs --yes`
  → 重启 → `dsht accept` → `baseline write`，顺序不能反：提前写基线会把「还没装上的状态」固化下来）。
