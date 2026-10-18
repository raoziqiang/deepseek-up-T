from pathlib import Path
import shutil
root=Path.cwd()
out=Path('D:/Z1848/output/deepseek-up-T-cosmic-whale-20261009')
preview=out/'preview'
preview.mkdir(parents=True,exist_ok=True)
for name in ['index.html','whale-animation.js','whale-3d.png']:
 shutil.copy2(root/'state/whale-visual-v2'/name,preview/name)
for name in ['app.asar','app.asar.build.json']:
 shutil.copy2(root/'state/staged'/name,out/name)
for src,dst in [('replay.mp4','replay-v2.mp4'),('keyframe.png','keyframe-v2.png'),('sequence.png','sequence-v2.png')]:
 shutil.copy2(root/'state/whale-review-final-video'/src,preview/dst)
readme='''# 星海鲸鱼 · 第二轮视觉修订

先打开 `preview/replay-v2.mp4` 看完整回放，再打开 `preview/index.html` 体验实时动画。旧预览地址已更新，已打开的页面请刷新。

- 预览支持重播、暂停、拖动时间轴、减弱动态效果。结束后出现的独立挂件可拖动，也支持方向键。
- 主体使用本地 WebGL2 三维网格，身体、尾部和胸鳍随时间运动；星空涟漪跟随跃出与入水接触点。
- 时间线为 6.2 秒主体动画、0.6 秒场景淡出、0.48 秒挂件淡入，约 7.3 秒完成。录像为 8 秒、1280×800、30 fps。
- `preview/whale-3d.png` 是 WebGL2 不可用时的图片降级素材。所有运行资源在本地，无网络依赖。
- `VISUAL-REVIEW.md` 记录上一版问题、修订和实际验证范围。
- `app.asar` 与 `app.asar.build.json` 为最新暂存包和构建记录。本轮没有替换在用 Harness 安装包；原生窗口衔接仍需安装后验收。
'''
(out/'README.md').write_text(readme,encoding='utf-8')
review='''# 星海鲸鱼动画视觉复盘 · 2026-10-09 第二轮

## 上一版为什么不合格

上一版主要依靠一张鲸鱼图片平移、旋转，缺少身体和尾鳍的连续动作。只凭构建通过和单帧预览交付，未充分检查完整时间线。

实际浏览器复看发现：约 2.4 秒时鲸鱼仍大幅裁在右边界外，约 4.7 秒时主体已离开左侧；尾迹表现为直线，涟漪与身体接触位置脱节。预览结束状态也没有真实呈现独立挂件衔接。这些属于动画表现问题，语法检查无法发现。

## 本轮修改

1. 使用可弯曲的三维网格，身体、尾部与胸鳍分别运动，转动时有实际透视与受光变化。模型为程序生成的简化风格鲸鱼，尚不是精细雕刻的影视模型。
2. 重做从右到左的跃起和落下轨迹，校正宽、窄窗口的主体尺寸与可见范围。尾部运动贯穿整个跃动。
3. 从尾部离水、头部入水的位置计算涟漪中心，星点受波纹扰动；落下时先头部、再身体、最后尾部逐渐没入星海。
4. 缩减直线尾迹，用稀疏曲线星屑衔接运动。细分远景星点与近处星海。
5. 场景完全结束后淡入独立挂件。预览加入暂停和时间轴，便于直接检查动作；常驻挂件复用同一模型。

## 实际复看与验证

- 在本机 Chrome 中运行真实 WebGL2，确认渲染器为 `webgl2-mesh`，模型 32,080 个三角形。
- 检查 1280×800 和 600×700 两种尺寸，逐段观察跃起、顶点、俯身、入水、尾部消失与挂件出现。第一轮发现的背鳍连接、尾形、接触点偏移已修订后复看。
- 最终录制 8 秒完整浏览器回放；复看全程序列图，检查连续动作和收尾。录像及序列图与本次交付代码一致。
- 暂停后时间保持、时间轴定位至 3.2 秒、重播、减弱动态效果、挂件方向键移动均通过浏览器检查；未捕获浏览器异常。
- 暂存包的实际重播页与 128×128 挂件页也在 Chrome 中运行：两页均使用 WebGL2；重播到点淡出并发出一次关窗请求。Chrome 中计数关窗请求，不等同于原生 Electron 窗口验收。
- `node test/splash.test.mjs`：25/25 通过，覆盖时间线结束、延迟显示挂件、交互、位置记忆、离屏绘制参数、无 GPU 降级与异常收尾。离线沙箱明确没有 GPU，其结果不冒充三维视觉证明。
- `node test/assets.test.mjs`：28 项通过。构建中 8 个 JavaScript 目标通过语法检查；14 个声明条目发生变更，其余 11,466 个归档条目逐字节一致。暂存包 122,804,393 字节。
- Impeccable 扫描无告警。视觉效果是否达到你的审美要求，仍以完整回放为准。

## 交付范围

本轮更新源码、独立预览、录像、暂存包和开发进度文档；在用安装包未改变。真实 Harness 启动窗口、常驻窗口的最终显示和桌面拖动，需安装重启后验收。
'''
(out/'VISUAL-REVIEW.md').write_text(review,encoding='utf-8')
p=root/'tracks/T1-appearance/README.md'
s=p.read_text(encoding='utf-8');a=s.index('### 星海');b=s.index('## 现状',a)
s=s[:a]+'''### 星海鲸鱼第二轮视觉修订（已复看并构建，待落盘验收）

- 根据用户对实际动画的反馈重做：从图片平移改为本地 WebGL2 三维网格，身体、胸鳍与尾部连续运动；右向左跃起落下，头部入水后身体与尾部逐步没入星海。涟漪从实际接触位置扩散，并扰动星点。
- 主体动画 6.2 秒，场景淡出 0.6 秒，独立挂件随后淡入约 0.48 秒；挂件继续遵循原有设置开关。PNG 仅作为 WebGL2 不可用时的降级资源。
- 实际 Chrome 验证 WebGL2 网格渲染（32,080 三角形），复看宽 1280×800 / 窄 600×700 的动作阶段；最后导出并复看 8 秒完整回放。暂停、时间轴、重播、减动效、挂件键盘移动通过，浏览器未捕获异常。暂存包重播页与挂件页同样跑过；原生窗口仍待安装验收。
- 构建 8 个 JS 语法检查通过；14 项声明变更，其余 11,466 个归档条目逐字节一致；暂存包 122,804,393 B。离线行为检查 25/25、资源检查 28 项通过；离线检查覆盖降级与生命周期，三维视觉由真实浏览器检查。
- 新版独立预览、录像、复盘与暂存包已更新至 `D:\\Z1848\\output\\deepseek-up-T-cosmic-whale-20261009\\`。Impeccable 扫描无告警。在用安装包未替换，真实桌面端验收待落盘重启。

'''+s[b:];p.write_text(s,encoding='utf-8')
p=root/'docs/04-roadmap.md';s=p.read_text(encoding='utf-8');lines=s.splitlines()
for i,line in enumerate(lines):
 if line.startswith('- **2026-10-09 最新变更：'):
  lines[i]='- **2026-10-09 最新变更：星海鲸鱼已完成第二轮视觉修订，尚未落盘。**使用真实 WebGL2 三维网格，重做右向左跃起、渐进入水、接触点涟漪以及场景结束后挂件淡入。已在 Chrome 中复看宽窄窗口和完整 8 秒回放，检查预览交互与暂存包重播/挂件页面，无浏览器异常；离线行为检查 25/25、资源检查 28 项通过。构建 14 项声明差异，其余 11,466 项一致。预览、录像、复盘及暂存包已更新至 `D:\\Z1848\\output\\deepseek-up-T-cosmic-whale-20261009\\`。在用安装包未改动，原生窗口验收待安装重启。'
s='\n'.join(lines)+'\n';s=s.replace('**23** 条断言','**25** 条断言');p.write_text(s,encoding='utf-8')
p=root/'patches/T1-whale-splash.yml';s=p.read_text(encoding='utf-8')
s=s.replace('透明背景的 3D 星鲸，共启动动画与桌面挂件复用','WebGL2 不可用时的本地透明图片降级资源')
s=s.replace('3D 鲸鱼由本地透明 PNG 提供，Canvas 绘制星海、跃动尾迹和涟漪；替换鲸鱼素材时需保留\n     透明边缘与朝左构图，避免启动动画与挂件的视觉方向不一致。','3D 鲸鱼由本地 WebGL2 网格绘制，Canvas 合成星海与接触点涟漪；WebGL2 不可用时\n     降级为透明 PNG。完整动态效果需 GPU 路径，离线生命周期检查不能代替视觉验收。')
p.write_text(s,encoding='utf-8')
print('Updated preview, video, staged archive, review and progress documents.')
