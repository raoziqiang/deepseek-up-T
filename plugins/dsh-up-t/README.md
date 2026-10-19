# dsh-up-t

设置里的一页「外观」，加上注入到主界面的开机动画、背景和余额提示。

鲸鱼主题、体检、升级、快照、暂存包、心跳墙都不在这一页上。那些维护命令还在仓库的 `node src/cli.mjs` 里。

## 设置页

| 块 | 做什么 |
| --- | --- |
| 开机动画 | 打开时播放一段短动画。系统开了「减少动态效果」时不自动播放。可以再看一次。 |
| 背景 | 跟随界面、静夜、晨雾、流光。流光是默认的动态背景。也可以选自己的 GIF、WebP、APNG、PNG、JPG，自定义图片优先，动图循环播放。单张不超过 1.5 MB。 |
| 余额 | 填当前余额和每次大约消耗，算出大约还能用几次。可选是否显示在界面左下角。 |

偏好存在浏览器的 `localStorage`（键 `dsh-up-t:prefs`），不写安装包。

## 注入

约束和以前一样：`apply()` 开头写心跳并注册内联 `script` 注入行，不把 `webServer` 放进对象级 `inject`，注入行自己建 `<script src="/dsh-up-t/client.js">` 并吞掉 `onerror`。

| 路由 | 作用 |
| --- | --- |
| `/dsh-up-t/client.js` | 开机动画、背景、余额条。按 mtime 重读，硬刷新即生效。 |
| `/dsh-up-t/appearance` | 列出 `boot`、`background`、`balance`。验收用它识别这一版宿主。 |
| `/dsh-up-t/status.json` | 插件名和版本。 |
| `/dsh-up-t/seen` | 渲染层握手。 |

离线预览：用浏览器打开 `preview.html`（或把它所在目录当静态站点）。正式界面在 Harness 的设置 → 外观。

如果 profile 里还挂着 `dsh-whale-splash`，把它从 `dsh.profile.bundles` 去掉，否则旧的鲸鱼动画还会播。
