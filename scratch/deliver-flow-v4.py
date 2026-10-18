from pathlib import Path
import shutil,hashlib,json
root=Path.cwd();out=Path('D:/Z1848/output/deepseek-up-T-cosmic-whale-20261009');preview=out/'preview'
for name in ['index.html','whale-animation.js','whale-3d.png']:shutil.copy2(root/'state/whale-flow-v4'/name,preview/name)
for name in ['app.asar','app.asar.build.json']:shutil.copy2(root/'state/staged'/name,out/name)
for src,dst in [('replay.mp4','replay-v4.mp4'),('sequence.png','sequence-v4.png'),('keyframe.png','keyframe-v4.png')]:shutil.copy2(root/'state/whale-flow-final-video'/src,preview/dst)
shutil.copy2(root/'state/whale-flow-motion-proof/swim-cycle.png',preview/'swim-cycle-v4.png')
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
original=Path('D:/Z1848/Temp/codex-clipboard-2d1ee809-0218-41a2-a401-55b8f68205c3.png')
assert sha(original)==sha(preview/'whale-3d.png')==sha(root/'vendor/whale/materials/whale-3d.png')
assert sha(out/'app.asar')==json.loads((out/'app.asar.build.json').read_text())['stagedHash']
assert sha(Path('D:/Program Files (x86)/deepseekharness/resources/app.asar'))=='6c23768d8316b4a5995fde8a0a0c95d18a4ed36fb0f1329f0b0b72f74fdcd7f3'
for directory in ['whale-flow-final-video','whale-flow-final-tall','whale-flow-surfaces','whale-flow-motion-proof']:
 assert json.loads((root/'state'/directory/'browser-errors.json').read_text())==[]
review=f'''# 原图鲸鱼 · 连续游动与时空涟漪复盘

更新：2026-10-11，第四轮。

## 上一版仍然生硬的原因

尾鳍、胸鳍变形幅度太小，观看时主要感受到整张图的位移与旋转。原来的涟漪只存在于两个固定落水事件，鲸鱼游动期间与周围星空没有持续联系。原图虽然保留了，运动关系没有建立起来。

## 本轮改动

- 同一张用户原始透明鲸鱼，未重新生成或替换；文件 SHA-256：`{sha(original)}`。
- 重做约 2.37 秒一周期的游动：胸鳍围绕鳍根划动，身体起伏传递到尾柄，再带动尾鳍上下摆动；网格预留变形边距，避免摆尾裁切。原图仍是视觉主体，这是原图驱动的 2.5D 变形。
- 尾迹、波峰和鲸鱼使用同一游动节奏。每半次摆尾留下波峰；沿已经经过的尾部位置生成延迟的弯曲光迹，随距离扩散、减弱。
- 星点实际受到鲸鱼周围和波峰附近的位移影响，发生偏折、拉伸和亮度变化。鲸鱼通过后，波纹继续扩散。移除了旧版独立的平面水圈与直线点状尾迹。
- 尾迹起点柔和淡入并分布在尾部周围，避免多根线集中拴在鱼尾的感觉。保持从右向左跃起落下，场景结束后淡入原图挂件。

## 实际复看

- 第一轮同时查看 1280×800 / 600×700，发现尾迹汇聚点过于明显；统一修正后进行最终确认。
- 单独固定鲸鱼位置，采样一整次游动的 24 个姿态，检查身体与胸鳍自身运动。相邻采样至少 2,577 个像素发生明显透明度变化，胸鳍区域至少 585 个；所有姿态均没有碰到纹理上下边缘。数字用于证明独立运动，审美以回放为准。
- `preview/swim-cycle-v4.png` 为四个固定位置泳姿，能直接比较胸鳍、尾柄、尾鳍变化。
- 最终导出 8 秒 / 240 帧 / 30 fps 完整浏览器回放，并复看全程序列。检查游动期间的连续尾迹、经过后扩散的波峰以及结尾。
- 预览的暂停、时间轴、重播、减动效、挂件方向键通过；实际暂存包重播页与 128×128 挂件页成功加载原图，重播发出一次关窗请求。上述浏览器运行没有捕获异常。
- 行为检查 26/26、资源检查全部通过。行为检查更新为验证沿路径持续留下波峰、波峰影响星点、减动效时无位移场；保留原图逐字节一致性检查。
- 构建 8 个 JS 语法检查通过，14 项声明差异，其余 11,466 条目一致。暂存包 { (out/'app.asar').stat().st_size:,} 字节，交付哈希与构建记录一致。

## 交付边界

更新源码、预览、录像、泳姿对比、暂存包及开发进度。在用安装包仍未替换；原生桌面端验收需要安装后重启。本轮浏览器检查不等同于原生窗口实测。
'''
(out/'VISUAL-REVIEW.md').write_text(review,encoding='utf-8',newline='\n')
(out/'README.md').write_text('''# 星光鲸鱼 · 连续游动与时空涟漪（第四轮）

2026-10-11 更新，保留用户指定的星光线条鲸鱼原图。

- `preview/index.html`：最新版实时预览，支持重播、暂停、拖时间轴和减动效。原地址已更新，已打开的页面需刷新。
- `preview/replay-v4.mp4`：最新版完整 8 秒回放（1280×800 / 30 fps）。
- `preview/swim-cycle-v4.png`：同一位置的四个泳姿，可对照胸鳍、尾柄、尾鳍的实际变化。
- `preview/keyframe-v4.png`、`preview/sequence-v4.png`：实际运行画面、全程序列。
- `VISUAL-REVIEW.md`：上一版问题、本轮修改和验证范围。
- `app.asar`、`app.asar.build.json`：最新版暂存包及哈希清单，尚未安装。

本版重做身体到尾鳍的传递动作，用同一摆尾节奏驱动连续尾迹与波峰，鲸鱼经过时周围星点发生偏折，经过后涟漪继续传播。约 6.2 秒主体动画结束后，场景淡出、挂件淡入。

主体仍为原始透明图片贴合网格的 2.5D 动效。v2、v3 文件保留为历史版本，不代表当前效果。
''',encoding='utf-8',newline='\n')
p=root/'tracks/T1-appearance/README.md';s=p.read_text(encoding='utf-8');a=s.index('## 最新进度');b=s.index('## 现状',a)
s=s[:a]+'''## 最新进度 · 2026-10-11

### 原图鲸鱼游动与时空涟漪（第四轮，已复看，待落盘）

- 根据“鱼没动、时空涟漪不协调”的反馈，重做身体到尾柄的传递动作、胸鳍划动与尾鳍摆动；用户原始透明鲸鱼图片保持逐字节一致。
- 原图网格变形为 2.5D 动效。尾迹取自过去的变形尾部位置，波峰随每半次摆尾释放，星点受到同一位移场影响；取代原来两处固定水圈和直线尾迹。
- 宽 1280×800 / 窄 600×700 分段复看，并检查完整 8 秒录像。另以固定位置的 24 个姿态验证鲸鱼自身在动，胸鳍和尾部运动清晰，无变形边缘裁切；四姿态对比图随交付保存。
- 暂停、时间轴、重播、减动效、挂件键盘移动与暂存包重播/挂件页浏览器检查通过，无捕获异常。行为检查 26/26，资源检查全部通过。
- 构建 8 个 JS 语法检查通过；14 项声明差异，其余 11,466 条目一致；暂存包 122,109,733 B。
- 最新预览、`replay-v4.mp4`、`swim-cycle-v4.png`、复盘与暂存包已更新到 `D:\\Z1848\\output\\deepseek-up-T-cosmic-whale-20261009\\`。在用安装包未替换，原生桌面验收待安装重启。

'''+s[b:];p.write_text(s,encoding='utf-8',newline='\n')
p=root/'docs/04-roadmap.md';s=p.read_text(encoding='utf-8');lines=s.splitlines()
for i,line in enumerate(lines):
 if line.startswith('- **2026-10-09 最新变更：'):
  lines[i]='- **2026-10-11 最新变更：原图鲸鱼游动与连续时空涟漪完成第四轮修订，尚未落盘。**保留用户原始星光鲸鱼图片；重做胸鳍划动、身体起伏、尾柄与尾鳍传递动作，沿经过的路径释放波峰并偏折星点。宽窄窗口、完整 8 秒回放与固定位置的游动周期已复看，预览交互和暂存包重播/挂件页检查通过。行为检查 26/26、资源检查全部通过；14 项声明差异，其余 11,466 项一致。最新预览、`replay-v4.mp4`、泳姿对比与复盘位于 `D:\\Z1848\\output\\deepseek-up-T-cosmic-whale-20261009\\`；在用安装包未改动。'
p.write_text('\n'.join(lines)+'\n',encoding='utf-8',newline='\n')
print('v4 delivered. Original image and archive hashes verified; live installation unchanged.')
