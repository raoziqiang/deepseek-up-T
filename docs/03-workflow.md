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
node src/cli.mjs snapshot restore <id>     # 回滚（回滚前自动再留一份）
```

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

它把暂存包**复制**到临时目标，并在临时目标上跑**同一段**声明核对。所以「产物是不是声明里那 11 条」
这件事不必等到退出 Harness 那一刻才知道 —— 那是整个流程里唯一不可重来的时刻，不该同时用来做验证。

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
