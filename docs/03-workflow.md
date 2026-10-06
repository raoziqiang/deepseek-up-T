# 03 · 改造工作流

任何一次改造都走同一个六步环。前两步和后两步是纪律，中间两步是手艺。

```
① 体检  →  ② 快照  →  ③ 改  →  ④ 复验  →  ⑤ 观察  →  ⑥ 收尾
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

## ④ 复验

```powershell
node src/cli.mjs doctor
node src/cli.mjs snapshot diff <id>
```

`doctor` 必须回到 0 error。`diff` 用来确认**只改了你打算改的东西**——如果 diff 里冒出一个你没碰过的文件，停下来查。

## ⑤ 观察

改动是否真的生效，取决于层：

| 层 | 怎么让它生效 | 怎么确认 |
| --- | --- | --- |
| L0 配置 | profile 重载或重启 Harness | 设置页能看到新值；`doctor` 无异常 |
| L1 插件 | 热重载（`dsh-hmr` 已挂载）或重启 | 界面上出现/消失对应能力 |
| L2 宿主 | 重启 | 启动日志无报错 |
| L3 安装包 | **退出 Harness（含托盘）** 后落盘，再启动 | 启动窗口/界面实际表现 |

L3 的落盘与 Harness 是否运行互斥。**当前会话本身就跑在 Harness 里，所以 L3 改造必须分两次会话完成：先构建好产物，再退出 Harness 落盘。**

## ⑥ 收尾

- 在对应 `tracks/T*/README.md` 记录这次改动（改了什么、为什么、怎么验、怎么撤）。
- `node src/cli.mjs baseline write` 刷新基线。
- git 提交（见 [05-conventions.md](05-conventions.md)）。

---

## 反模式

| 反模式 | 为什么错 | 正确做法 |
| --- | --- | --- |
| 直接改 `profiles/node_modules/@deepseek-ai/*` | 升级/重装即丢失，且 diff 里看不出来 | 用 `cordis.patch.yml` 覆盖对应 row |
| 手改 `cordis.yml` | 协议要求它是空数组，写了也会被组合层覆盖 | 写进 `cordis.patch.yml` |
| 用通用打包器重建 `app.asar` | 会让一万多个条目字节变化，无法审计也无法回滚 | 用 `../tools/asar-write.mjs` 单条目重写 + `asar-verify.mjs` 校验 |
| 改完不 diff 就提交 | 误改会静默进入基线 | 提交前必跑 `snapshot diff` |
| Harness 运行中尝试落盘 asar | Windows 会拒绝替换被内存映射的文件 | 连托盘一起退出再落盘 |

## 升级 Harness 之后

1. 跑 `doctor`，看 `app.asar` sha256 变化与「仅安装包提供」清单是否变动。
2. L0/L1 改动通常自动幸存；若有条目因 base 的 row id 改名而失效，`doctor` 的「patch 引用的包可解析」会报出来。
3. L3 改动必然丢失，需要重打 —— 这是 T5 要自动化的事。
4. 重跑 `baseline write`，把新版本固化成新基线。
