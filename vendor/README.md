# vendor/

**从 `../tools/` 归拢进来的 asar 工具链。** 目前在原位，尚未搬入（见 T5 待办）。

## 为什么单独放一层

这些脚本改的是**安装目录里的打包产物**，风险等级和 `src/` 里的只读体检完全不同。
物理隔开是为了让「只读的诊断」和「会写安装包的改造」不混在一起，
也方便对它们单独做代码审查。

## 现有实现的位置（`D:\Z1848\harness-ds\tools\`）

| 脚本 | 作用 | 风险 |
| --- | --- | --- |
| `asar-list.mjs` | 列出归档条目 | 只读 |
| `asar-write.mjs` | 单条目重写，其余条目字节保持不变 | **写安装包** |
| `asar-verify.mjs` | 逐条比对两个 asar，`--expect N` 校验差异数量 | 只读 |
| `patch-main.mjs` | `lib/main.js` 锚点替换（锚点必须唯一） | 生成产物 |
| `patch-preload.mjs` | `lib/preload-app.cjs` 锚点替换 | 生成产物 |
| `bundle-whale.mjs` | 动画模块 → CSP 允许的经典脚本 | 生成产物 |
| `build-whale.mjs` | 一键：打包 → 打补丁 → 语法检查 → 重打包 → 交付 | 生成产物 |
| `install-whale.mjs` | 落盘（检测 Harness 是否运行）/ `--rollback` | **写安装包** |
| `capture-frames.mjs` | 无头 Chrome + CDP 按时间轴截图 | 只读 |
| `trace-whale.mjs` | 真实渲染像素上描轮廓并打印 ASCII | 只读 |
| `analyze-frames.mjs` | 每帧占比与质心轨迹统计 | 只读 |

## 归拢时的要求

1. 去掉对 `../` 的相对依赖，改为由本项目传入绝对路径。
2. 「写安装包」类脚本必须**先检测 Harness 进程**，运行中直接拒绝执行。
3. 与 `patches/*.yml` 对接：补丁描述是声明，这些脚本是执行器。
4. 归拢后跑一次 `asar-verify.mjs --expect 0`（原版 vs 备份）作为自检。
