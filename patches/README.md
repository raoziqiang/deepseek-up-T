# patches/

**L3（安装包层）改动的声明式描述。** 每个文件描述一次针对 `app.asar` 内文件的改造，
使得这次改造可审计、可重放、可在 Harness 升级后重新应用。

## 为什么需要它

L3 改动会被 Harness 升级覆盖。如果改动只存在于「某次跑过的命令行」或者某人的记忆里，
升级后就只能靠考古恢复。把它写成声明式文件，重打就是重放一个文件。

## 执行器

这些 YAML 是**声明**，执行器在 `vendor/`：

| 文件 | 执行器 |
| --- | --- |
| `T1-whale-splash.yml` | `vendor/whale/build.mjs`（构建）+ `vendor/whale/install.mjs`（落盘 / `--rollback`） |

两侧都从这个文件读 `verify.expect_diff_entries` 与 `target.entries[].path`，
声明与实际差异不一致就报错退出（解析实现在 `vendor/lib/harness.mjs` 的 `readPatchDecl`）。

## 格式

```yaml
id: T1-whale-splash                 # 必填，也是 install.mjs --decl 的定位键
name: 启动窗口画卷鲸鱼动画 + 桌面挂件 + 视觉模型自动路由
track: T1

target:
  archive: resources/app.asar
  entries:
    - path: renderer/welcome.html
      action: replace               # replace | patch | insert
      source: ../../.probe/build/renderer/welcome.html
    - path: lib/main.js
      action: patch                 # 锚点替换
      source: ../../.probe/main.js
      patcher: vendor/whale/patch-main.mjs
    - path: lib/welcome/whale-animation.js
      action: insert
      source: ../../.probe/build/whale-animation.js
      bundler: vendor/whale/bundle.mjs   # 插入前先过一遍打包器

verify:
  expect_diff_entries: 11           # 必填：asar-verify --expect 的期望值
  syntax_check:                     # 落盘前逐项 node --check
    - lib/main.js

rollback:
  - node vendor/whale/install.mjs --rollback

notes: |
  为什么改、已知限制。散文本地保留，不要写成需要解析的结构。
```

### 三个 action 的区别

| action | 含义 | 为什么单独区分 |
| --- | --- | --- |
| `replace` | 整份换掉 | 生成物就是完整文件 |
| `patch` | 在**原版**上做锚点替换 | 原版会随 Harness 升级变化，必须每次都从当次原版重新打 |
| `insert` | 归档里本来没有，新增 | 新增条目是差异计数里最容易算漏的一类 |

`patch` 的 `source` 指**原版缓存**（`.probe/main.js` 这类），不是生成物——
生成物在 `--out` 的暂存位，是可丢弃的。

## 规则

1. **锚点必须唯一。** 锚点在归档中出现多次时，工具必须失败退出，不许「改第一个」。
2. **必须写 `verify.expect_diff_entries`。** 应用的差异条目数必须**恰好**等于声明值——
   多一处少一处都说明改坏了。`install.mjs` 会拿实际差异集合与 `target.entries` 逐项比对。
3. **必须写 `rollback`。** 回滚路径不加 `--yes` 确认，因为它是恢复通道。
4. 源素材放 `../.probe/`（原版缓存）与 `../.probe/build/`（动画/客户端资产）；
   构建的中间产物在 `state/staged/tree/`、整包在 `state/staged/app.asar`（均已 gitignore，可重建）。不要放这里。
5. **声明读不到就报错，不要默认值。** 缺 `expect_diff_entries` 时宁可失败退出。

## 两类声明：L3 与 L0

这个目录下的 `*.yml` 有两种，靠**有没有 `target.archive`** 区分（`dsht upgrade` 也是这么判的）：

| | 写在哪 | 例子 | 升级后 |
| --- | --- | --- | --- |
| **L3** | `resources/app.asar` | `T1-whale-splash.yml` | **被覆盖，需要重打** |
| **L0** | `profiles/<p>/cordis.patch.yml` | `T3-session-search.yml`、`T3-session-title.yml`、`T2-enable-ralph.yml`、`T2-product-analytics-off.yml` | **幸存，无需重打** |

- L3 声明用 `target.archive` + `entries:`，由 `vendor/whale/build.mjs` 与 `install.mjs` 执行。
- L0 声明就是一**片段**（`- id:` / `name:` / `config:`），它记录的是「往 profile patch 里加了什么」，
  由人手写进 `cordis.patch.yml`。`dsht upgrade` 会拿它与现场逐行比对，不一致就是**漂移**。
- L0 的两个写法都被实测验证过：**给 `config`** 就是整体替换（`T3-session-title.yml` 因此把五个字段写全），
  **不给 `config`** 就完整继承 base 那一行（`T2-enable-ralph.yml` 只写 `disabled: false`，证据在
  `state/probe-dump.txt:458`）。
- 判据：能在 L0 表达的，**不要**写成 L3。L0 改完重启就生效，且升级不会丢。

- **L0 声明是权威描述，不是提案。** `dsht upgrade` 逐行比对声明与现场，不一致就报漂移
  （退出码 1）。所以**只想提一个建议时不要放进这个目录**——放进来就等于声称「现场应该是这样」，
  而 `upgrade` 会一直把未落盘的声明报成漂移。`T2-product-analytics-off.yml` 曾以「未应用的提案」
  形态在此存在过一段时间（用户还没决定要不要关埋点），当时 `upgrade` 每次都报漂移——
  这不是 bug，是「声明即声称」这条语义在如实工作。要提建议就写完先别放这里。

> 状态：**L3 已闭环、L0 有 4 份声明、现场与声明全部一致。**
> - L3：`node vendor/whale/build.mjs` 产出 `state/staged/app.asar`（11 条目按声明改动，
>   其余 11,466 条目逐字节一致），再 `node vendor/whale/install.mjs --yes` 落盘（需先退出 Harness）。
> - L0：4 份声明全部 `OK 声明与现场一致`。`dsht upgrade` 会区分「被升级覆盖」与「从未落盘」。
> - 当前声明文件：`T1-whale-splash.yml`（L3）、`T2-enable-ralph.yml`、
>   `T2-product-analytics-off.yml`、`T3-session-search.yml`、`T3-session-title.yml`（L0）。
>   新增声明时按同样的格式写，执行器无需改代码。
