# T4 · Web GUI 扩展

> 给自己的界面加面板、加槽位——走插件层，不去改安装包里的前端。

## 现状

- `@deepseek-ai/dsh-client-ui-slots` 是槽位系统（`dsh-client-ui-layout` 提供布局骨架）。
- `dsh-better-sidebar@0.24.1` 已经证明这条路走得通，并且**暴露了一个 service 供别的插件注册
  sidebar tab 与 file viewer** —— 也就是说它既是范例，也是可用的扩展点。
- 客户端插件支持热重载（`dsh-client-hmr` 已挂载），**迭代速度远快于改 asar**。

## 插件声明方式（照抄 `dsh-better-sidebar/package.json`）

```json
{
  "type": "module",
  "main": "lib/index.js",
  "exports": {
    ".":              { "default": "./lib/index.js" },
    "./invariant":    { "default": "./lib/invariant.js" },
    "./client":       { "default": "./lib/client.js" },
    "./client/service": { "default": "./lib/client.js" }
  },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "inject": [
        "@deepseek-ai/dsh-client-locale",
        "@deepseek-ai/dsh-client-ui-slots",
        "@deepseek-ai/dsh-client-ui-conversation",
        "@deepseek-ai/dsh-client-ui-primitives"
      ],
      "platform": "web"
    },
    "manifestVersion": 1
  }
}
```

要点：
- `dsh.bundle.patch` 指向插件自带的 `cordis.patch.yml` —— 插件靠它把自己插进插件树。
- `dsh.client.inject` 声明客户端侧需要哪些同伴包。
- `dsh.client.platform: "web"` 标明只作用于 Web 前端。
- 宿主侧入口是 `exports["."]`，客户端入口是 `exports["./client"]`。

## 写之前先读运行时事实

**不要猜 API。** 用两个探针工具读实时事实：

| 工具 | 能读到什么 |
| --- | --- |
| `cordis_inspect_list` | 当前所有 Inspect Provider 及其只读方法 |
| `cordis_inspect_query` | Service 方法、Event 模式、插件 Config schema、Tool schema、主题 token、**实时 Slot 树与 props** |

写插件前至少查一次：目标槽位的 id 与 props、可用 Service 的方法签名。

## 待办

- [ ] 用 `cordis_inspect_query` 把可用槽位树读出来并记录
- [ ] 最小可用插件脚手架（host 入口 + client 入口 + `dsh` 声明）
- [ ] 挂一个自有面板到现有槽位
- [ ] 把高频操作做成按钮

## 验收

- 界面上出现自建面板，功能可用。
- 刷新/热重载后仍在。
- Harness 升级后仍在（证明它确实活在 L1 而不是 L3）。

## 记录

_（每次改动在此追加：改了什么 / 为什么 / 怎么验 / 怎么撤）_
