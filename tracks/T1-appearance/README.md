# T1 · 外观与体验

> 2026-10-30：**启动动画相关内容已从仓库删除，准备重构。**

已移除：

- L1 插件 `plugins/dsh-whale-splash`
- L3 声明 `patches/T1-whale-splash.yml`
- `vendor/whale/`（构建 / 落盘 / 素材 / patcher）
- `vendor/visual/`（抓帧与轮廓仪器）
- `install-whale.cmd`
- 相关单测（`splash` / `whale-splash-plugin` / `install` / `assets`）与 scratch / state 取证产物

未动：

- `dsh-up-t` 设置里的「桌面鲸鱼挂件」开关（L1；依赖安装包里是否还留着旧 L3 桥）
- 本机已落盘的 `app.asar` 改动（要从安装包卸掉须另做回滚，且需完全退出 Harness）

重构时从空目录重开即可；L3 通用工具仍保留在 `vendor/asar/`。
