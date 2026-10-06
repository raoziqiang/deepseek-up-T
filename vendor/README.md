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
  whale/install.mjs        把暂存包落盘 / 从备份回滚 / --to 演练核对（唯一会覆盖在用 app.asar 的地方）
  whale/patch-main.mjs     lib/main.js 的锚点替换
  whale/patch-preload.mjs  lib/preload-app.cjs 的锚点替换
  whale/patch-session-controller.mjs  视觉模型自动路由的锚点替换
  whale/bundle.mjs         动画模块 → CSP 允许的经典脚本
  visual/                  视觉验证（只读）：抓帧、描轮廓、数值分析、静态预览服务
  route/                   Provider / 网关探针（只读，except store-go-credential 会写凭据）
```

### `vendor/visual/`（6 个，只读）

| 脚本 | 作用 |
| --- | --- |
| `capture-frames.mjs` | 用无头 Chrome + CDP 在固定时间点截图（自己用 `node:net` 实现了 WebSocket，无外部依赖） |
| `trace-whale.mjs` | 对**真实渲染像素**描轮廓并打印 ASCII + 形状指标（圆头 / 分叉尾 = 鲸鱼，而非一团） |
| `analyze-frames.mjs` | 数值分析帧序列：颜色分布、蓝色像素纵向范围、纸/水区位置 |
| `frame-colors.mjs` | 诊断「喷溅」分类，报告分区占比与上半区主色 |
| `check-whale-shape.mjs` | 只渲染鲸鱼轮廓并给出形状指标（长宽比、质量分布、是否有尾缺口），不靠人眼验收 |
| `serve-dir.mjs` | 极小的静态文件服务，供本地预览（ESM 需要 http 才能加载） |

### `vendor/route/`（8 个）

| 脚本 | 作用 | 副作用 |
| --- | --- | --- |
| `verify-live-routes.mjs` | 走运行中 DSH 自己的 Remote 网关（cookie 鉴权），列出它当前服务的 provider 路由 | 只读 |
| `market-verify.mjs` | 确认 dsh-market 客户端 bundle 进了实时 GUI boot manifest 且真被宿主提供 | 只读 |
| `e2e-opencode-go.mjs` | 每条 OpenCode Go 路由跑一次受限 prompt，跑完恢复 profile 原先的默认模型 | **会发真实请求、会改默认模型** |
| `probe-opencode-go.mjs` | 用本机 opencode 凭据探 OpenCode Go 端点（只打状态码/model id/短回复，不打印 key） | 网络 |
| `probe-go-protocols.mjs` | 三种 wire protocol 各发一个真实请求 | 网络 |
| `probe-go-session-header.mjs` | 试哪个 session 头被网关接受 | 网络 |
| `fetch-go-docs.mjs` | 抓 OpenCode Go 文档页并打印模型/端点表 | 网络（只 GET） |
| `store-go-credential.mjs` | 把本机 opencode 的 key 以 ref 形式写进 DSH 凭据库 | **会写 `<DSH_HOME>/.credentials.yaml`** |

## 构建与落盘是两步

```powershell
node vendor/whale/build.mjs     # → state/staged/app.asar（可随便重跑、可比对）
node vendor/whale/install.mjs --yes   # 需要先退出 Harness
```

分开的理由：构建可以随时重跑、失败、回退；落盘只有一次机会。
构建阶段就把「暂存包 vs 原版」逐字节比完了，所以落盘只是一次文件替换。

**落盘可以在 Harness 开着的时候先演练**（不需要退出，也不动在用安装包）：

```powershell
node vendor/whale/install.mjs --yes --to state/cmp/rehearsal-app.asar
```

`--to` 把暂存包**复制**到临时目标（真落盘那条路是 rename，会把暂存包移走；演练之后人还要用它去落盘），
然后对临时目标跑**同一段**声明核对。两条规则：`--to` 落在安装目录里一律拒绝（那会让人以为落盘了，
其实 Harness 读的仍是在用那份）；`--to` 指向在用 `app.asar` 时按真落盘处理，不许借它绕过 Harness 守卫。
双击版：`install-whale.cmd /dry`。这条路径的回归由 `test/install.test.mjs`（26 条断言）守着。

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

落盘链路本身的自检（构建确定性、`--to` 演练、三条拒绝路径、全程在用安装包 sha256 未变）：
`node test/install.test.mjs` —— 26 条断言，约 4 秒，不碰安装目录。

构建产物**内容**的自检（引用完整性校验，**字节核对查不出来的那一类**）：
`node test/assets.test.mjs` —— 28 条断言。它只读归档，检查被 insert/replace 的 HTML 引用的每个本地资源
都真的存在、`action: replace` 的页面没有丢掉原版引用过的资源、替换页的 CSP 没变严。
`vendor/asar/verify.mjs` 回答的是「是不是按声明改了」，这一套回答的是「改对了没有」——
两者的差别见 `tracks/T1-appearance/README.md` 里那条登录窗口页面的记录。

## 归拢状态（源在 `D:\Z1848\harness-ds\tools\`，共 23 个脚本）

**23/23 已全部归拢**，`../tools/` 只剩历史副本（保留原位未删，见下方「为什么没删」）。

对照：3 个 asar 工具 → `asar/`；`install-whale`/`build-whale`/`bundle-whale` + 3 个 patcher → `whale/`；
6 个视觉 → `visual/`；8 个 Provider 探针 → `route/`。其中 `whale/build.mjs` 是**重写**过的
（原来 `build-whale.mjs` 把步骤和路径写死在脚本里，现在改成按 `patches/*.yml` 声明驱动），
`vendor/lib/harness.mjs` 是新增的共享底座。

**为什么没删 `../tools/`**：`D:\Z1848\harness-ds\.probe\` 与 `whale-motion\` 里的素材、以及
`README-whale-splash.md` 的历史描述都还引用得到它们；在 T1 真正落盘并验收通过之前，
保留一份能独立跑通的旧副本是回退手段。删除单独作为一步，等 T1 验收后再做。

归拢时按同样四条要求做：去掉 `../` 相对依赖、「写安装包」类先过进程守卫、
与 `patches/*.yml` 对接、归拢后跑一次自检。

### 第三批（2026-10-06）：视觉验证与 Provider 探针，14 个

`visual/` 6 个 + `route/` 8 个。侦察发现这 14 个**没有一个**用
`path.resolve(here, '..')` 推工作区根，所以与所在目录无关，可以整目录搬
（唯一例外是 `serve-dir.mjs` 的 `path.resolve(process.argv[2] ?? '.')`，那是它本来的语义）。

搬迁时改的三处：

1. **DSH 凭据库改走 `$DSH_HOME`**：`e2e-opencode-go.mjs`、`verify-live-routes.mjs`、
   `market-verify.mjs`、`store-go-credential.mjs` 原本写死 `join(homedir(), '.dsh', ...)`，
   用 `P.home` 替代——`DSH_HOME` 被改过时原来的写法会读错库。
2. **保留不动**：`join(homedir(), '.local', 'share', 'opencode', 'auth.json')`
   出现在 4 个 route 脚本里。那是 **OpenCode CLI 自己的**凭据库，不是 DSH 的路径，
   不能跟着 `DSH_HOME` 走。
3. **环境变量收口**：`HOST` 统一尊重 `DSH_WEB_URL`；`e2e-opencode-go.mjs` 的
   `CWD` 由写死的 `D:\Z1848\harness-ds\.probe-workspace` 改为 `DSH_UP_T_E2E_CWD ?? join(WORKSPACE, '.probe-workspace')`。

### 每个新脚本的冒烟结果（2026-10-06，全部实跑）

| 脚本 | 命令 | 结果 |
| --- | --- | --- |
| `visual/check-whale-shape.mjs` | 无参 | exit 0，`VERDICT: tail notch present (reads as flukes)`、bbox aspect 1.59、左/右质量 59.8% / 40.2% |
| `visual/analyze-frames.mjs` | `../.probe/frames` | exit 0，7 帧全部解析（`frame-0_22.png` whale=8.43% paper=51.82%） |
| `visual/trace-whale.mjs` | `frame-0_35.png --cols 60 --rows 24` | exit 0，whale px 35288 (8.40%)、bbox 385x192、长轴 −5.7° |
| `visual/frame-colors.mjs` | `frame-0_35.png` | exit 0，主色 `rgb(248,248,248) 43.41%` |
| `visual/serve-dir.mjs` | `../.probe/dist 8198` | `GET /renderer/pendant.html` → 200 `text/html` 1106 B（与磁盘大小一致） |
| `route/verify-live-routes.mjs` | 无参 | exit 0，`llm/listProviders -> 200`，5 个 provider（4 个 opencode-go 分组 + deepseek-official / deepseek-account） |
| `route/market-verify.mjs` | 无参 | exit 0，`boot rev: 2660d19acdb1`、dshmarket 在 `application` 批（15 条）、`GET .../client.js -> 200 724114 bytes` |
| `route/fetch-go-docs.mjs` | 无参 | `status 200` + 文档正文 |

**未实跑**（有真实副作用或需外部条件，只做了 `node --check`）：
`route/e2e-opencode-go.mjs`（会发真实 prompt 并改默认模型）、
`route/probe-opencode-go.mjs` / `probe-go-protocols.mjs` / `probe-go-session-header.mjs`（会真的请求外部 API）、
`route/store-go-credential.mjs`（会写凭据库）、`visual/capture-frames.mjs`（需要无头 Chrome + 一个活着的预览 URL）。

`node --check` 14/14 通过。

