# dsh-up-t

`deepseek-up-T` 的第一个自建 DSH 插件，也是 `tracks/T4-webgui` 这条线的样板。

在 DSH 界面**左下角**放一个小胶囊：显示 Harness 版本 + 安装包是否被改造过，点开有细节。
右键点它可隐藏（位置与隐藏状态都存在 `localStorage`）。

```
up-T · 44.0.0        ← 灰点：安装包与原版备份大小相同（很可能未被改造）
up-T · 44.0.0        ← 绿点：大小不同（已被改造）
up-T · ?             ← 黄点：没有原版备份可比 / 宿主没回应
```

## 它为什么值得存在

不是因为这个胶囊本身有用，而是因为它**证明了这条通道确实可用**：
插件住在 L1（`$DSH_HOME/profiles/<p>/node_modules/`），Harness 升级不会碰它，
而它却能把自有脚本注入到界面里、并能通过宿主自己的 HTTP 路由回传数据。
胶囊能出现，就说明整条链路通了 —— 以后要加的其它面板都走同一条路。

## 它做了什么

| 路由 | 作用 |
| --- | --- |
| `/dsh-up-t/client.js` | 客户端脚本。按 **mtime** 重读，所以改完**硬刷新页面即生效，不用重启 DSH** |
| `/dsh-up-t/status.json` | 状态事实（只做 stat 级读取，不算 121MB 的 sha256） |

`apply()` 一开头就注册 `webserver/index-inject` 的注入行；其余逻辑在 `root.inject(['webServer'], …)` 里。

## ★ 三条不能违反的约束（都是别人踩过的坑）

1. **不能用对象级 `inject: ['webServer', …]`。**
   桌面端（Electron）的注入表是宿主**启动时一次性收集**的，没有刷新路径。
   对象级 inject 会把整个 `apply()` 推迟到服务就绪之后，行就赶不上那次收集 ——
   结果是「插件装好了但什么都不出现」，而且**不报任何错**。

2. **注入行必须是内联 `script` 类型，绝不能是 `script-src`。**
   渲染层对 `script` 行只做 `createElement + textContent + append`（没有 await，不可能失败）；
   对 `script-src` 行却是 `await loadScript(src)` —— 一旦 404 就 reject 掉 `__DSH_BOOT_READY__`，
   **整个应用起不来**。而一次性收集意味着插件被关掉后表里那行还在、路由已注销，
   404 是必然会发生的。所以推内联行，由它自己建 `<script src=…>` 并吞掉 `onerror`：
   最坏结果只是胶囊不出现。

3. **桌面端 `tapIndex` 不生效，别指望它。**
   桌面壳的 `index.html` 是从安装包静态 dist 直出（`dsh-app://app/`），不经过宿主的 `renderIndex()`。
   `tapIndex` 只为 Web 形态保留（本插件仍然注册了它，作为兼容）。

这三条连同 `apply()` 的行为，全部被 `test/plugin.test.mjs` 的 14 条断言钉住 ——
因为「行没赶上收集」这类失败是静默的，在真机上很难复现，只能在离线把行为钉死。

## 安装（本地开发形态）

```powershell
# 1) 建 junction，让 DSH 能按包名解析到本目录
New-Item -ItemType Junction `
  -Path "$env:DSH_HOME\profiles\desktop\node_modules\dsh-up-t" `
  -Target "D:\Z1848\harness-ds\deepseek-up-T\plugins\dsh-up-t"

# 2) 把 "dsh-up-t" 加进 profile package.json 的 dsh.profile.bundles
```

第 2 步**不要直接改**。先留快照，再用候选清单预检：

```powershell
cd D:\Z1848\harness-ds\deepseek-up-T
node src\cli.mjs snapshot create -m "装插件前"
# 生成候选 package.json（bundles 末尾多一个 dsh-up-t），然后：
node src\cli.mjs precheck --profile-json state\candidate\package.json
```

`precheck` 用隔离的探针家跑 asar 内那份 `bin.js --dump-config`，退出码 0 且没有
`skipping profile bundle` 就说明组合可用。确认后再改真实 profile。

## 卸载

1. 把 `dsh-up-t` 从 `dsh.profile.bundles` 去掉（profile package.json 是组合层文件，改前先快照）。
2. 删掉那个 junction。

备份文件 `package.json.up-t-backup` 是本次落盘时留下的原样副本，确认无误后可删。

## 验证

```powershell
cd D:\Z1848\harness-ds\deepseek-up-T
node test\plugin.test.mjs          # 14 条断言：注入行、路由、清理
node src\cli.mjs doctor            # bundles 全部可解析
node src\cli.mjs precheck          # 组合可用
```

**胶囊真的出现**只能在重启 DSH 之后看到 —— 组合层文件没有热重载。
