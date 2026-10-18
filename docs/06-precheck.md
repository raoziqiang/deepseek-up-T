# 06 · 权威组合预检（precheck）

> 这一页解决一个很具体的问题：**改完 `cordis.patch.yml`，在重启 DSH 之前，怎么知道会不会炸？**

## 为什么官方 CLI 做不到

`desktop` profile 被 Electron 应用独占。用 CLI 直接 dump 会被硬拒绝：

```
$ dsh --profile desktop --dump-config
error: profile "desktop" is managed exclusively by the Electron application
```

守卫就在安装包的 `@deepseek-ai/dsh/lib/bin.js` 里（用
`dsht asar cat dsh/node_modules/@deepseek-ai/dsh/lib/bin.js` 可读到原文）：

```js
function rejectElectronProfile(program, profile) {
  if (profile.toLowerCase() === "desktop")
    program.error("error: profile \"desktop\" is managed exclusively by the Electron application");
}
// 只有 Desktop 自己的载体才带 manageDesktopProfile = true
function parseDshArgs(argv, version, manageDesktopProfile = false) { ... }
```

顺带确认的三件事：

- `--dump-config-schema`（第三个 dump 模式）确实存在，能吐出 900KB+ 的权威 JSON Schema —— 但它的 stderr 会带**假阳性**：在空用户层下它依然报
  `[/179] unrecognized Loader tree carrier` 与
  `[/187] The requested module '@deepseek-ai/dsh-session' does not provide an export named 'SessionLogOffset'`，
  而应用本身跑得好好的。原因是该模式不做真实模块加载。**因此它只能当 Schema 参考，不能当门禁。**
- `--dump-default-config` 与 `--patch` 互斥（`--dump-default-config prints the bundle layers and takes no --patch`）。
- 三个 dump 模式互斥。

## 机制

`dsht precheck` 做四件事：

1. 在**项目目录**里搭一个隔离探针家 `state/probe-home/`，把当前 profile 的
   `cordis.yml` / `cordis.patch.yml` / `package.json` / `pnpm-workspace.yaml` 复制进去，
   profile 名改成 `_probe` —— 只为绕开那个 `desktop` 字面量守卫。
2. 用 junction 把解析环境补齐：
   - `state/probe-home/profiles/_probe/node_modules` → 真实 `profiles/desktop/node_modules`
   - `state/probe-home/profiles/node_modules` → 真实 `profiles/node_modules`
3. 用**安装版 Electron 以 Node 身份**执行 **asar 内那份** bin.js：
   ```
   ELECTRON_RUN_AS_NODE=1
   DSH_HOME=<probe-home>
   "<安装目录>\DeepSeek Harness.exe" "<app.asar>\dsh\node_modules\@deepseek-ai\dsh\lib\bin.js" \
       --profile _probe [--patch <file>]... --dump-config
   ```
4. 把 stderr 分类成「问题 / 提醒 / 其它」，把 stdout 按顶层条目切开，与上一次 precheck 的结果逐条目比对。

真实 `$DSH_HOME` 全程只读。

## 判据：三件事同时成立才算通过（`judgeRun`）

| # | 条件 | 不成立时 |
|---|---|---|
| 1 | 退出码 `0` | 失败（`null` 也算，超时/被杀） |
| 2 | stderr 里没有真问题（`skipping profile bundle` / `patch: entry … not found` / `dsh: error:`） | 失败 |
| 3 | **dump 里至少有一个顶层条目** | 失败，并打印 `[empty-dump] dump 里一个顶层条目都没有（模式 …，stdout N 字节）：这次预检什么都没验到，不能算通过。` |

第 3 条是 2026-10-07 补的：在此之前判据只有前两条，于是一次**什么都没 dump 出来**的
预检（stdout 空、退出码 0、stderr 干净）会被判成通过，命令照样打印「结论：组合可用。」
—— 一个条目都没有的绿灯是最坏的一种假答案，因为它连「我什么都没验到」都不说。

`dsh: warning:` 只进「提醒」，不阻塞。认不出来的其它行进「其它输出」并原样显示：
它们**不参与结论**（真实的一次成功预检 stderr 是 **0 字节**），但也不许被悄悄丢掉。

## 基线不会被一次失败的跑冲掉（`settleDumpFiles`）

`state/probe-dump.txt` 是**上一次真的 dump 出来的组合**。只有这一次跑出了可用结果
（退出码 0 且有条目）才会更新它，并且把旧的转存到 `.prev`；跑失败时：

- `probe-dump.txt` 与 `probe-dump.txt.prev` **一字未动**（下次还有得比）；
- 本次原始输出写到 `state/probe-dump.txt.failed`；
- 末行改说「基线未动，仍是 …」；
- 跑成功时顺手删掉上一次的 `.failed` 残留（否则会让人以为这次也没成）。

修正前这三行是无条件执行的：一次失败把基线写成空文件之后，下一次预检拿空基线做对比，
会报出「201 个条目全部新增」。**一个诊断工具弄丢自己的参照点，比它不报错还糟。**

注意「可用」与「通过」是两件事：一次 dump 完整、但 stderr 里有 `patch: entry not found`
的预检，结论是**不通过**，而它的 dump 仍是对当前组合的忠实记录，该进基线。

## diff 的两处讲究

- **行差异按出现次数算，不按集合。** 真实 dump 的 201 个条目里有 7 个内部本来就有重复行
  （`preset-standard` / `preset-ptc` 各有三行 `config:`，`permission` 有两行 `approval: ask`）。
  按集合比的话，「三行 `config:` 变成两行」会报成「改了这条，但一行都列不出来」
  （`changed: [{ removed: [], added: [] }]`）。
- **条目顺序变了要单独报**（`↕ 公共条目的顺序变了`）。顺序就是装载顺序，两个插件对调
  而配置一字未变时，集合比较的结论是「完全一致」。单纯增删条目不算顺序变化
  （留下来的条目相对次序没动）。

## 三个必须踩准的点（都踩过）

| # | 坑 | 现象 | 正解 |
|---|---|---|---|
| 1 | Electron 是 **GUI 子系统** exe | PowerShell 用 `&` 调用**立刻返回**，`$LASTEXITCODE` 为空、输出 0 字节 —— 看起来像「跑成功但没输出」 | 必须 `Start-Process -Wait -RedirectStandardOutput/-RedirectStandardError`；本项目用 Node 的 `spawnSync` 直接读管道（实测可用） |
| 2 | 第三方 bundle 不在安装包里 | 少了 junction 就刷 `dsh: skipping profile bundle "dsh-better-sidebar"`，紧接着 `patch: entry "better-sidebar" not found` | 两个 junction 都要建；junction 在 Windows 下**不需要管理员权限**（symbolic link 才需要） |
| 3 | 探针家路径会进 dump | 每次 dump 出现 `# == @deepseek-ai/dsh-base, patched by D:\...\state\probe-home\...` | 这是**层边界标记**，比对时按 `^# == ` 整行剔除 |

## 用法

```powershell
node src/cli.mjs precheck                      # 用真实 profile 的当前 patch 预检
node src/cli.mjs precheck --patch patches/T3-session-search.yml   # 叠加一层再预检（可重复）
node src/cli.mjs precheck --default-only       # 只看 bundle 层
node src/cli.mjs precheck --fresh              # 先删掉重建探针家
node src/cli.mjs precheck --json               # 机器可读
```

退出码：`0` = 组合可用；`1` = 有问题；`2` = 预检本身跑不起来。

真实输出（T3 会话搜索那次改动）：

```
组合预检 · 探针 profile=_probe（隔离，真实 $DSH_HOME 只读） ← 真实 profile=desktop
  归档      D:\Program Files (x86)\deepseekharness\resources\app.asar
  探针家    D:\Z1848\harness-ds\deepseek-up-T\state\probe-home
  模式      dump-config
  复制      cordis.yml / cordis.patch.yml / package.json / pnpm-workspace.yaml
  junction  profile/node_modules   exists
  junction  profiles/node_modules  exists
  退出码    0
  条目数    201
  问题      0

与上一次预检相比：0 新增 / 0 移除 / 1 修改
    ~ 条目 session-query-sqlite
        - path: ':memory:'
        - openAt: never
        + path: !!js dshHomePath('session-search.sqlite')
        + openAt: first-search

组合结果    D:\Z1848\harness-ds\deepseek-up-T\state\probe-dump.txt
结论：组合可用。profile 层的 cordis.patch.yml 没有热重载，需重启 DSH 才生效。
```

产物：`state/probe-dump.txt`（当前组合结果）、`state/probe-dump.txt.prev`（上一次）、`state/probe-dump.txt.err`（原始 stderr）、`state/probe-dump.txt.failed`（**只在跑失败时出现**：本次没有产出可用结果时的原始输出，此时的基线没有被动过）。全部已 gitignore——里面有 junction 和本机绝对路径。

## 边界（别把预检当成万能）

- **不执行 `!!js`**。dump 只打印表达式原文（`!!js dshHomePath('session-search.sqlite')`），不求值。表达式的正确性只有运行期才知道。
- **不加载模块**。导出名对不对、运行期报不报错，预检看不出来。
- **不是 boot**。服务依赖、插件启动自检、顺序相关的 patch 命中，都要真正启动才算数。
- **顺序相关**：patch 的 id 索引只描述**当前**这一层之前的索引，后面叠加上来的层可能引入新 id。
- 结论口径：「组合可用」= 这一层能被 loader 接受且命中预期条目，**不等于**功能验证通过。

## 这套判据自己怎么测的

`node test/precheck.test.mjs`（**27 条**，**不 boot Electron**）：`analyzeStderr` /
`splitDumpEntries` / `diffDumps` / `judgeRun` 打在合成输入上；`settleDumpFiles` 打在
系统临时目录里的显式路径上（断言失败那一跑之后基线**一字未动**）；真实基线与
真实 stderr 作为只读样本对账；真实 dump 的差异按当前基线动态核对正反方向，
因为成功预检后当前与 `.prev` 可能相同，不应把某次 `agent-team` 差异写死成永恒断言。

最后三条是**源码结构断言**（CLI 里 `!r.saved` 必须排在 `r.diff === null` 之前等）——
它们钉住的是措辞与次序，**不证明** CLI 真的跑通了：真跑一次 `dsht precheck` 要 300 秒的
Electron dump，不可能进单测。那一层只能靠人跑一次真实预检。

## 为什么这件事值得单独做一层

因为 in-box 插件**无法单独升级**：`dsh-client-ui-chat`、`dsh-client-ui-settings-account`、
`dsh-agent-preset-registry` 以及 4 个 `dsh-experimental-*` 只存在于 `app.asar` 内，
磁盘上没有目录、lock 文件里也没有引用。想改它们的行为，**只能**通过 profile 层的
patch 去覆盖它们的 config —— 那就意味着每一次改动都得在没有编译期反馈的情况下
改一个纯 YAML 文件。有了 precheck，这件事才变成可验证的。
