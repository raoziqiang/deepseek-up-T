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

插件侧：`dsh-up-t` 在 `webServer` 就绪后拉起**同一份** `src/modules.mjs`，状态写进心跳的 `modules` 字段，最近 20 条模块日志写进 `modulesLog` 字段（每轮宿主重新开始计）。

## 记忆

- 契约 skill：`.dsh/skills/up-t-memory/SKILL.md`（对齐 Grok Build：markdown、一主题一文件、当前对话优先）
- 项目笔记：`memory/project/topics/`
- 全局笔记：`$DSH_HOME/up-t/memory/`（不进仓库）
- 灵枢继续管会话召回；本层不管自动摘录（后续里程碑）

浏览与检查（只读，判据在 `src/memory.mjs`，CLI 与模块共用一份）：

```powershell
node src/cli.mjs memory ls                      # 两处目录下的笔记（README.md 不算）
node src/cli.mjs memory show <主题>             # 项目范围优先；--scope project|global 限定
node src/cli.mjs memory lint                    # 退出码 1 = 有 error
```

| 判据 | 级别 | 对应 skill 里哪句话 |
| --- | --- | --- |
| 文件名不是 kebab-case `.md` | error | 一主题一文件，文件名 kebab-case |
| 空文件 | error | — |
| 疑似凭据（私钥 / `sk-` / `ghp_` / `AKIA` / `xox?-` / Bearer / `password=…`） | error | 不许写密钥、令牌、凭据 |
| 第一行非空内容不是 `# 标题` | warn | — |
| 超过 16 KB | warn | 笔记指向文档，不复制正文 |
| 全局与项目同名 | warn（报在全局那份） | 读取时项目那份优先 |

凭据判据**宁可漏报**：`token: 见 docs/…`、`password: true`、`api_key: <你的>` 这类说明文字不报
（`test/memory.test.mjs` 钉住）。误报一多，人就学会忽略 lint。

`modules/memory` 启动时跑同一份 lint，把计数记进宿主日志；有 error 只记 `warn`，模块仍是 `started` ——
一条坏笔记不该把整个模块判成失败。

## 本轮边界

- 不拆胶囊 / 设置页 / 鲸鱼动画为模块
- 不改灵枢配置，不接自动召回
- 不做回合后后台写入，不做记忆浏览界面
