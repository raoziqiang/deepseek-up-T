# vendor/

**会写安装包的工具链。** 与 `src/` 的区别只有一条，但很关键：

| | `src/` | `vendor/` |
| --- | --- | --- |
| 读什么 | `$DSH_HOME/profiles/desktop/cordis.patch.yml`、`app.asar` 的元数据 | `app.asar` 的**全部字节** |
| 写什么 | 只写自己项目目录里的 `state/` | 会覆盖 `resources/app.asar` |
| 出错代价 | 体检结果不准 | Harness 起不来 |

物理隔开是为了让「只读的诊断」和「会损坏安装包的改造」不混在一起，也方便单独审查。

## 目录

```
vendor/
  lib/harness.mjs          vendor 与 src 的唯一接口：路径、Harness 进程守卫、补丁声明解析
  asar/list.mjs            列条目 / 抽条目
  asar/verify.mjs          逐字节比对两个归档，--expect N 校验差异数量
  asar/write.mjs           单条目重写，其余条目字节保持不变
  whale/build.mjs          按 patches/*.yml 构建暂存包（不碰安装目录）
  whale/install.mjs        把暂存包落盘 / 从备份回滚（唯一会覆盖在用 app.asar 的地方）
  whale/patch-main.mjs     lib/main.js 的锚点替换
  whale/patch-preload.mjs  lib/preload-app.cjs 的锚点替换
  whale/patch-session-controller.mjs  视觉模型自动路由的锚点替换
  whale/bundle.mjs         动画模块 → CSP 允许的经典脚本
```

## 构建与落盘是两步

```powershell
node vendor/whale/build.mjs     # → state/staged/app.asar（可随便重跑、可比对）
node vendor/whale/install.mjs --yes   # 需要先退出 Harness
```

分开的理由：构建可以随时重跑、失败、回退；落盘只有一次机会。
构建阶段就把「暂存包 vs 原版」逐字节比完了，所以落盘只是一次文件替换。

## 路径约定

所有路径从 `src/paths.mjs` 来（`vendor/lib/harness.mjs` 再导出），**不在 vendor 里另拼一套**。
工作区根（`D:\Z1848\harness-ds`）由 `DSH_UP_T_WORKSPACE` 覆盖，默认取项目目录的上一级；
构建输入资产在 `../.probe/build`，产物在 `../.probe/dist`，原版源码缓存在 `../.probe`。

刻意**不再**用 `path.resolve(here, '..')` 推工作区根——脚本一搬目录，`..` 就指向别处，
然后静默写到不该写的位置。

## 安全约定（比功能重要）

1. **省略 `--out` 绝不原地重写。** `write.mjs` 省略 `--out` 写 `<归档>.tmp`；
   只有显式 `--out <归档>` 才原地，并且必须先通过 Harness 进程守卫。
   原地重写正在使用的安装包是最容易把 Harness 写坏的一步，必须是**显式**选择。
2. **写安装包前必须检测 Harness 进程。** `assertHarnessStopped()` 用
   `tasklist /FI "IMAGENAME eq DeepSeek Harness.exe"` 取 pid 列表，有进程就拒绝执行
   并提示「右键托盘图标退出（只关窗口进程还在）」。
3. **落盘后必须验证，不能只看退出码。** `install.mjs` 落盘后用 `verify.mjs --json`
   把**实际差异条目集合**与 `patches/*.yml` 声明的集合逐项比对，多一条少一条都算失败。
4. **声明读不到就报错，不用默认值。** `readPatchDecl()` 只解析受控子集
   （`id:`、`verify.expect_diff_entries:`、`target.entries[].path`），
   `expect` 缺失或 `entries:` 块不是恰好一个，直接失败退出。

## 自检

```powershell
# 原版备份 vs 当前安装包：应当逐字节一致（归拢要求 4）
node vendor/asar/verify.mjs

# 或者对任意两个归档
node vendor/asar/verify.mjs <原版> <改动后> --expect 11
```

`verify.mjs` 无位置参数时默认比较 `app.asar.whale-backup` vs `app.asar`。

实测输出（2026-10-06）：`比较 11470 个归档内条目、1497 个 unpacked 条目` + `OK：逐字节一致`。

## 待归拢（`D:\Z1848\harness-ds\tools\`，共 23 个脚本）

已归拢 5 个（上表去掉「待归拢」的项）。剩余 18 个分三类：

| 类别 | 脚本 | 风险 |
| --- | --- | --- |
| 构建链 | `patch-main.mjs`、`patch-preload.mjs`、`patch-session-controller.mjs`、`bundle-whale.mjs`、`build-whale.mjs` | 生成产物 |
| 视觉验证 | `capture-frames.mjs`、`trace-whale.mjs`、`analyze-frames.mjs`、`frame-colors.mjs`、`check-whale-shape.mjs`、`serve-dir.mjs` | 只读 |
| 其它线的探针 | `e2e-opencode-go.mjs`、`verify-live-routes.mjs`、`probe-go-protocols.mjs`、`probe-go-session-header.mjs`、`probe-opencode-go.mjs`、`market-verify.mjs`、`fetch-go-docs.mjs`、`store-go-credential.mjs` | 只读（`store-go-credential` 会写凭据） |

归拢时按同样四条要求做：去掉 `../` 相对依赖、「写安装包」类先过进程守卫、
与 `patches/*.yml` 对接、归拢后跑一次自检。
