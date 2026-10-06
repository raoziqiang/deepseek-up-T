# patches/

**L3（安装包层）改动的声明式描述。** 每个文件描述一次针对 `app.asar` 内文件的改造，
使得这次改造可审计、可重放、可在 Harness 升级后重新应用。

## 为什么需要它

L3 改动会被 Harness 升级覆盖。如果改动只存在于「某次跑过的命令行」或者某人的记忆里，
升级后就只能靠考古恢复。把它写成声明式文件，重打就是重放一个文件。

## 格式（约定，随工具归拢逐步固化）

```yaml
# patches/t1-whale-welcome.yml
name: 启动窗口画卷鲸鱼动画
track: T1
target:
  archive: resources/app.asar
  entries:
    - path: renderer/welcome.html
      action: replace        # replace | insert
      source: ../.probe/build/welcome.html
      anchors:               # 锚点必须唯一，否则工具必须报错而不是猜
        - '<div id="root">'
    - path: lib/welcome/whale-animation.js
      action: insert
      source: ../.probe/build/whale-animation.bundle.js
verify:
  expect_diff_entries: 10    # asar-verify.mjs --expect 的期望值
  syntax_check:
    - lib/welcome/whale-animation.js
rollback:
  - 恢复 resources/app.asar.whale-backup
notes: |
  为什么改：启动界面单调，希望有品牌感。
  已知限制：Harness 升级会覆盖，需重跑应用脚本。
```

## 规则

1. **anchor 必须唯一。** 锚点在归档中出现多次时，工具必须失败退出，不许「改第一个」。
2. **必须写 `verify.expect_diff_entries`。** 应用的差异条目数必须**恰好**等于声明值——
   多一处少一处都说明改坏了。
3. **必须写 `rollback`。**
4. 生成物（被打进去的文件）放 `tracks/` 或 `../.probe/build/`，不要放这里。

> 状态：M0 只建立约定。实际应用器在 T5 归拢 `../tools/` 工具链时实现。
