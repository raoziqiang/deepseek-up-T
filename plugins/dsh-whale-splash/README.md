# dsh-whale-splash

主窗口启动动画（L1 插件，升级 Harness 不会覆盖）：

1. 启动瞬间铺一层星空幕布；用户指定的原版星光鲸鱼（`assets/whale.png` = `vendor/whale/materials/whale-3d.png`，
   与启动窗口共用同一套 WebGL2 网格摆尾）从右侧游入，走两道 S 弯。
2. 尾鳍每隔一阵荡起一圈**星空涟漪**：柔光环 + 周围星点被推开、点亮；尾后拖着彩色星尘。
3. 收尾时鲸鱼缩小俯冲进**左下角**，星点聚拢、闪光，化作科幻鲸鱼娘（`assets/whale-girl.png`）；
   同时最后一圈涟漪从她脚下扩散，把幕布推开、露出界面。
4. 鲸鱼娘常驻左下角（`up-T` 胶囊上方）：拖动可移动，**双击重播**，**右键隐藏**（本会话）。

时长 13 s（鲸鱼 1 s 内入场）；星空有分温度的闪烁星光、银河带和 5 颗流星，涟漪是带光晕的椭圆环并推开经过的星点。点击幕布或按任意键直接跳到变身段。同一会话里重载页面不重播，只恢复鲸鱼娘。
系统开了「减少动态效果」时不播动画，直接出鲸鱼娘。没有 WebGL2 时退回 2D 绘制原图。

## 文件

| 文件 | 作用 |
| --- | --- |
| `lib/index.js` | 宿主侧：注册内联注入行 + `/dsh-whale-splash/{splash.js,whale.png,whale-girl.png}` 三条同源路由（按 mtime 重读，改素材硬刷新即生效） |
| `assets/splash.js` | 渲染侧动画（经典脚本、无依赖） |
| `assets/whale-girl.png` | 鲸鱼娘，由 `vendor/whale/key-whale-girl.py` 从 `vendor/whale/materials/whale-girl-raw.jpg` 抠图生成 |
| `preview.html` | 离线预览（假 DSH 界面） |

## 预览与验证

```powershell
cd D:\Z1848\harness-ds\deepseek-up-T
node vendor\visual\serve-dir.mjs plugins\dsh-whale-splash 8131     # 浏览器打开 http://127.0.0.1:8131/preview.html
node vendor\visual\capture-frames.mjs "http://127.0.0.1:8131/preview.html?whale-paused" state\whale-splash-plugin --size 1280x800 --api renderAt
node test\whale-splash-plugin.test.mjs                               # 16 条：注入行/路由 + 假浏览器跑完整时间线
```

预览页里 `DshWhaleSplash.replay()` 重播，`DshWhaleSplash.renderAt(t)` 停在时间线某一点。

## 安装（与 dsh-up-t 相同）

```powershell
cd D:\Z1848\harness-ds\deepseek-up-T
node src\cli.mjs snapshot create -m "装 dsh-whale-splash 前"
New-Item -ItemType Junction `
  -Path "$env:DSH_HOME\profiles\desktop\node_modules\dsh-whale-splash" `
  -Target "D:\Z1848\harness-ds\deepseek-up-T\plugins\dsh-whale-splash"
# 生成候选 package.json（dsh.profile.bundles 末尾加 "dsh-whale-splash"），先预检：
node src\cli.mjs precheck --profile-json state\candidate\package.json
# 通过后再改真实 profile 的 package.json，重启 Harness。
```

卸载：从 `dsh.profile.bundles` 去掉 `dsh-whale-splash`，删掉 junction，重启。

## 与启动窗口动画的关系

`patches/T1-whale-splash.yml`（L3）管的是**欢迎/登录窗口**里的画卷鲸鱼；本插件管**主窗口**，两者互不依赖。
