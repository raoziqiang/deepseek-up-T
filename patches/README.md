# patches/

改动的声明式副本：可审计、可重放。

## 当前内容

| 文件 | 层 | 说明 |
| --- | --- | --- |
| `T2-*.yml` / `T3-*.yml` | L0 | `cordis.patch.yml` 的声明副本 |

## L3 启动动画

`T1-whale-splash.yml` 与整条 `vendor/whale/` 构建落盘链已于 2026-10-30 **删除**（待重构）。
通用 asar 读写仍在 `vendor/asar/`。新的启动动画应重新写声明与执行器，不要复活旧路径名当默认。

## L0 格式（摘录）

```yaml
# 为什么改：<一句话>
- id: <base 已有行 id>
  name: "<包名>"
  config:
    <整体替换的字段>
```

细节见 `docs/05-conventions.md`。
