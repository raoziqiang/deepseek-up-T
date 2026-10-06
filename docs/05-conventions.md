# 05 · 约定

## 红线

1. **改之前必留快照。** `node src/cli.mjs snapshot create -m "..."`。没有例外。
2. **`cordis.yml` 必须保持顶层 `[]`。** 所有意图写进 `cordis.patch.yml`。`doctor` 会强制检查。
3. **不删 `app.asar.whale-backup`。** 这是本机唯一的原版安装包副本。
4. **Harness 运行时不动 `app.asar`。** 连托盘一起退出再落盘。
5. **不整体重建 `app.asar`。** 只用 `asar-write.mjs` 单条目重写，并用 `asar-verify.mjs` 校验差异数量。
6. **不在** `profiles/node_modules/@deepseek-ai/*` **里做持久改动。** 那是 L2，会被覆盖；用 L0 覆盖 row。

## 层的选择

```
能用 cordis.patch.yml 表达吗？
  ├─ 能 → L0（首选）
  └─ 不能 → 有现成插件能装/能改吗？
        ├─ 能 → L1
        └─ 不能 → 这个包在磁盘上有吗？（doctor 会告诉你）
              ├─ 有 → L2（临时验证可以，持久方案要回到 L0/L1）
              └─ 没有，只在 app.asar 里 → L3（最后手段，必须写 patches/ 声明）
```

## 目录职责

| 目录 | 放什么 | 不放什么 |
| --- | --- | --- |
| `docs/` | 架构、流程、路线、基线事实 | 一次性的调试记录 |
| `src/` | 控制台代码（纯 Node，零依赖） | 业务补丁 |
| `patches/` | L3 改动的声明式描述 | 生成物 |
| `vendor/` | 从 `../tools` 归拢来的执行器（asar 工具链、构建链、视觉验证、Provider 探针） | 项目自有逻辑 |
| `tracks/T*/` | 每条线的方案、实验、结论 | 大二进制 |
| `state/` | 基线、快照（已 gitignore） | 手写内容 |

**零依赖**是 `src/` 的硬约束：`doctor` 必须在「DSH 装坏了」的时候还能跑，所以不能依赖待修的 `node_modules`。

## 命名

- **快照 id**：`YYYYMMDD-HHMMSS[-标签]`，由 `snapshot.mjs` 自动生成。
- **补丁文件**：`patches/<track>-<slug>.yml`，如 `patches/t1-whale-welcome.yml`。
- **实验产物**：放 `tracks/T*/` 下，不进 `state/`。

## 写 `cordis.patch.yml` 的规范

```yaml
# 为什么改：<一句话说明动机，三个月后你自己就是那个读不懂的人>
- id: <base 或 bundle 中已存在的行 id>
  name: "<该行原本的包名>"     # 必须写，否则 loader 定位不到
  config:
    <把你想完全决定的字段全写出来——config 是整体替换>
```

- 每条改动前**必须**有一行注释说明动机。
- 一个 row 只在一个地方出现，避免同 id 重复（`doctor` 会报）。
- 用空格缩进，**禁止 Tab**（`doctor` 会报）。

## git

- **一次改造一个提交**，提交信息格式：
  ```
  <track>: <做了什么>

  为什么：<动机>
  怎么验：<doctor / diff / 界面观察>
  怎么撤：<恢复哪个快照>
  ```
- 提交前必跑：`node test/run.mjs`（发现式跑全 `test/*.test.mjs`，**当前 9 套**全绿）、`node src/cli.mjs doctor`（0 error）、
  且 `snapshot diff <快照id>` 只显示预期改动。
  **加了一套新测试就什么都不用改**——`test/run.mjs` 自己发现；反过来，`test/` 下一套都找不到时它以退出码 2 报错，
  而不是「0 套通过」地装成成功。
- 大文件（`app.asar`、动画帧、构建产物）**不入库**，已在 `.gitignore`。
- **行尾一律不转换**（`.gitattributes` 里 `* -text`）：有些文件是逐字节参与工作的
  （`vendor/whale/materials/**` 会原样打进 `app.asar`；`test/fixtures/*` 按 sha256 认证据），
  本机 `core.autocrlf=true`，一旦被改写成 CRLF，产物与证据哈希都会静默变化。

## 记录义务

每次有实质改动，更新对应 `tracks/T*/README.md`，至少写清四件事：

1. **改了什么**（精确到文件与行）
2. **为什么**（动机，不是复述改动）
3. **怎么验**（可复现的命令）
4. **怎么撤**（快照 id 或反向操作）
