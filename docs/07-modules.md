# 07 · 模块宿主

长期新能力优先做成**模块**，挂在已经装上的 L1 插件 `dsh-up-t` 里热加载。
不要为了加一个开关再改 `cordis.patch.yml`（组合层没有 watcher，改了必须重启 DSH）。

## 为什么热路径在这里

| 层 | 热不热 | 说明 |
| --- | --- | --- |
| L0 `cordis.patch.yml` | 否 | 全运行时没有 watcher（见 `docs/01-environment.md`） |
| L1 bundle 列表 | 否 | 启动时收集一次 |
| `cordis-plugin-hmr` | 只盯插件源码 | 不解决「加一个新能力要不要新 cordis 行」 |
| 客户端脚本 | 按 mtime 重读 | 硬刷新即可 |
| **本宿主** | 是 | 配置 + `modules/*/module.mjs` 的 mtime 轮询 |

## 目录与配置

```
up-t.config.yml          ← 项目根，短配置
modules/<name>/module.mjs
memory/project/topics/   ← 项目笔记（memory 模块确保存在）
```

配置形状（未知顶层键直接失败）：

```yaml
modules:
  memory: true
memory: {}
```

未列出的模块不加载。模块专属块的键必须出现在 `modules:` 下。

## 模块契约

入口固定 `modules/<name>/module.mjs`，只依赖 Node 内置模块：

- `export const name`（与目录名一致）
- `start(ctx)` / `stop()`
- 可选 `reload(ctx)`；没有就 `stop` 再 `start`

`ctx`：`projectRoot`、该模块自己的配置对象、`log(level, message, extra?)`。
一个模块抛错只记 `failed`，不拖垮胶囊与路由。

## 命令

```powershell
node src/cli.mjs modules           # 热启动一次并打印状态（不 boot Electron）
node src/cli.mjs modules --watch   # mtime 轮询；改配置/入口只重启对应模块
node src/cli.mjs modules --json
```

插件侧：`dsh-up-t` 在 `webServer` 就绪后拉起**同一份** `src/modules.mjs`，状态写进心跳的 `modules` 字段。

## 记忆

- 契约 skill：`.dsh/skills/up-t-memory/SKILL.md`（对齐 Grok Build：markdown、一主题一文件、当前对话优先）
- 项目笔记：`memory/project/topics/`
- 全局笔记：`$DSH_HOME/up-t/memory/`（不进仓库）
- 灵枢继续管会话召回；本层不管自动摘录（后续里程碑）

## 本轮边界

- 不拆胶囊 / 设置页 / 鲸鱼动画为模块
- 不改灵枢配置，不接自动召回
- 不做回合后后台写入，不做记忆浏览界面
