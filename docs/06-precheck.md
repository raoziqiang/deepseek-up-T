# 06 · 权威组合预检（precheck）

> 这一页解决一个很具体的问题：**改完 `cordis.patch.yml`，在重启 DSH 之前，怎么知道会不会炸？**

## 为什么官方 CLI 做不到

`desktop` profile 被 Electron 应用独占。用 CLI 直接 dump 会被硬拒绝：

```
$ dsh --profile desktop --dump-config
error: profile "desktop" is managed exclusively by the Electron application
```

守卫就在安装包的 `@deepseek-ai/dsh/lib/bin.js` 里（用
`dsht asar cat /dsh/node_modules/@deepseek-ai/dsh/lib/bin.js` 可读到原文）：

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
4. 把 stderr 分类成「问题 / 提醒」，把 stdout 按顶层条目切开，与上一次 precheck 的结果逐条目比对。

真实 `$DSH_HOME` 全程只读。

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

产物：`state/probe-dump.txt`（当前组合结果）、`state/probe-dump.txt.prev`（上一次）、`state/probe-dump.txt.err`（原始 stderr）。全部已 gitignore——里面有 junction 和本机绝对路径。

## 边界（别把预检当成万能）

- **不执行 `!!js`**。dump 只打印表达式原文（`!!js dshHomePath('session-search.sqlite')`），不求值。表达式的正确性只有运行期才知道。
- **不加载模块**。导出名对不对、运行期报不报错，预检看不出来。
- **不是 boot**。服务依赖、插件启动自检、顺序相关的 patch 命中，都要真正启动才算数。
- **顺序相关**：patch 的 id 索引只描述**当前**这一层之前的索引，后面叠加上来的层可能引入新 id。
- 结论口径：「组合可用」= 这一层能被 loader 接受且命中预期条目，**不等于**功能验证通过。

## 为什么这件事值得单独做一层

因为 in-box 插件**无法单独升级**：`dsh-client-ui-chat`、`dsh-client-ui-settings-account`、
`dsh-agent-preset-registry` 以及 4 个 `dsh-experimental-*` 只存在于 `app.asar` 内，
磁盘上没有目录、lock 文件里也没有引用。想改它们的行为，**只能**通过 profile 层的
patch 去覆盖它们的 config —— 那就意味着每一次改动都得在没有编译期反馈的情况下
改一个纯 YAML 文件。有了 precheck，这件事才变成可验证的。
