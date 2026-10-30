# vendor/

**会写安装包或做外部探测的工具链。** 与 `src/` 的区别：

| | `src/` | `vendor/` |
| --- | --- | --- |
| 读什么 | profile 配置、`app.asar` 元数据 | `app.asar` 全部字节 / 外部服务 |
| 写什么 | 只写项目 `state/` | asar 写入工具**可以**覆盖安装包 |
| 出错代价 | 体检不准 | Harness 可能起不来 |

## 目录

```
vendor/
  lib/harness.mjs   vendor 与 src 的唯一接口：路径、进程守卫、补丁声明解析
  asar/list.mjs     列条目 / 抽条目
  asar/verify.mjs   逐字节比对两个归档
  asar/write.mjs    单条目重写
  route/            Provider / 网关探针
```

## 已移除（2026-10-30）

启动动画相关的 `vendor/whale/`（构建 / 落盘 / 素材 / patcher）与 `vendor/visual/`（抓帧仪器）
已删除，待重构。见 [`tracks/T1-appearance/README.md`](../tracks/T1-appearance/README.md)。

四条铁律（以后新的 L3 链仍要遵守）：

1. 省略输出路径绝不原地重写安装包  
2. 写安装包前必须过 Harness 进程守卫  
3. 落盘后必须拿实际差异集合与声明逐项比对  
4. 声明读不到就报错，不用默认值  
