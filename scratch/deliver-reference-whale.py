from pathlib import Path
import shutil,hashlib,json
root=Path.cwd();out=Path('D:/Z1848/output/deepseek-up-T-cosmic-whale-20261009');preview=out/'preview'
for name in ['index.html','whale-animation.js','whale-3d.png']:shutil.copy2(root/'state/whale-reference-v3'/name,preview/name)
for name in ['app.asar','app.asar.build.json']:shutil.copy2(root/'state/staged'/name,out/name)
for src,dst in [('replay.mp4','replay-v3.mp4'),('sequence.png','sequence-v3.png'),('keyframe.png','keyframe-v3.png')]:shutil.copy2(root/'state/whale-reference-video'/src,preview/dst)
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
original=Path('D:/Z1848/Temp/codex-clipboard-2d1ee809-0218-41a2-a401-55b8f68205c3.png')
assert sha(original)==sha(preview/'whale-3d.png')==sha(root/'vendor/whale/materials/whale-3d.png')
assert sha(out/'app.asar')==json.loads((out/'app.asar.build.json').read_text())['stagedHash']
assert sha(Path('D:/Program Files (x86)/deepseekharness/resources/app.asar'))=='6c23768d8316b4a5995fde8a0a0c95d18a4ed36fb0f1329f0b0b72f74fdcd7f3'
readme='''# 星光鲸鱼 · 用户原图版（第三轮）

当前最新版使用用户提供的透明星光鲸鱼原图，保留轮廓、发光线条与星点。原始图片逐字节一致，没有重新生成或换成另一条鲸鱼。

- `preview/index.html`：实时预览，可重播、暂停、拖动时间轴，结束后淡入同一鲸鱼挂件。
- `preview/replay-v3.mp4`：最新版 8 秒完整回放，1280×800、30 fps。
- `preview/keyframe-v3.png` 与 `preview/sequence-v3.png`：当前画面与全程序列。
- `preview/whale-3d.png`：用户原始透明 PNG。脚本也内嵌其原始字节，以支持直接打开本地文件时的 WebGL 纹理加载。
- `VISUAL-REVIEW.md`：本轮纠偏、实现边界与验证。
- `app.asar` / `app.asar.build.json`：最新暂存包与哈希清单。未替换在用安装包。

当前动效以原图贴合可变形网格，让身体、尾鳍、胸鳍轻柔起伏，并加上柔光、星海涟漪与纵深。这是保留原画的 2.5D 动效，不是重建一条可任意转面的完整三维鲸鱼。

之前的 `replay-v2.mp4` 等 v2 文件属于已被替代的历史版本，不代表本次效果。
'''
(out/'README.md').write_text(readme,encoding='utf-8',newline='\n')
review=f'''# 用户原图版视觉复盘 · 2026-10-09

## 本次纠偏

上一轮擅自将用户的星光线条鲸鱼换成实体蓝鲸，违背了视觉要求。本轮以最新附件为唯一主体素材，保持透明轮廓、青蓝线条、星点与连接关系；不再自行设计另一种鲸鱼造型。

原图 SHA-256：`{sha(original)}`。附件、工程素材、交付图片逐字节一致；回归检查同时确认归档中内嵌纹理与原始 PNG 完全一致。

## 动作和氛围

- 原图贴合 10,800 三角形的可变形纹理网格。尾部、胸鳍和身体柔和起伏，轻微深度变化；保留原画正侧面辨识度。这是原图驱动的 2.5D 效果，不宣称完成任意视角三维建模。
- 深蓝星空加入克制的青蓝、淡紫远景光，鲸鱼有微弱呼吸亮度与边缘柔光；星点受运动和涟漪扰动。
- 继续从右到左跃起、落下；按原图尾部与头部位置调整接触点，窄窗口的跃出波纹也位于可视范围。
- 场景结束后淡入同一原图鲸鱼挂件，支持减动效。图片首次加载完成后补画静止挂件，避免冷启动空白。

## 实际验证

- Chrome 中复看 1280×800 与 600×700 画面，确认 `webgl2-reference-mesh`、`imageReady: true`，不是上一轮实体鲸鱼模型。
- 最终录制 8 秒 / 240 帧回放并检查全程序列，覆盖游入、跃起、落下、波纹消散、挂件淡入。
- 暂停、时间轴、重播、减动效、挂件方向键检查通过。实际暂存包重播页与 128×128 挂件页均成功加载原图，重播发出一次关窗请求。浏览器未捕获异常。
- 修复直接打开本地文件时 WebGL 纹理的来源限制：经典脚本内嵌原图字节。挂件页仅补充允许 data 图片，不开放外部脚本或网络资源。
- 离线行为检查 26/26 通过，含原图字节一致性；资源检查全部通过；构建 8 个 JS 目标语法通过，14 项声明差异，其余 11,466 条目一致。
- 最终暂存包 { (out/'app.asar').stat().st_size:,} 字节，交付哈希与构建记录一致。

## 当前范围

源码、预览、录像、暂存包与开发进度均已更新；在用安装包哈希未变化。原生桌面窗口的最终表现仍待安装重启验收。
'''
(out/'VISUAL-REVIEW.md').write_text(review,encoding='utf-8',newline='\n')
p=root/'tracks/T1-appearance/README.md';s=p.read_text(encoding='utf-8');a=s.index('### 星海');b=s.index('## 现状',a)
s=s[:a]+'''### 用户原图星光鲸鱼（第三轮，已复看，待落盘）

- 用户明确要求保留最新附件的星光线条鲸鱼。已撤换上一轮实体蓝鲸模型，直接使用原始透明 PNG；源图、工程素材、交付图逐字节一致。
- 用原图贴合可变形纹理网格，轻柔运动身体、尾鳍和胸鳍；深蓝星空、青蓝柔光、接触点涟漪。此为保留原画的 2.5D 动效，不是完整任意视角模型。继续右向左跃起落下，场景结束后淡入同一鲸鱼挂件。
- Chrome 宽 1280×800 / 窄 600×700 复看，最终 8 秒视频与全程序列已检查。预览交互、减动效以及暂存包重播页/挂件页通过；图像成功加载，无浏览器异常。
- 行为检查 26/26（含原图一致性）、资源检查全部通过。8 个 JS 语法检查通过；14 项声明差异，其余 11,466 条目一致；暂存包 122,107,165 B。
- 最新预览与 `replay-v3.mp4` 位于 `D:\\Z1848\\output\\deepseek-up-T-cosmic-whale-20261009\\`，复盘详见同目录 `VISUAL-REVIEW.md`。在用安装包未改动，原生桌面验收待安装重启。

'''+s[b:];p.write_text(s,encoding='utf-8',newline='\n')
p=root/'docs/04-roadmap.md';s=p.read_text(encoding='utf-8');lines=s.splitlines()
for i,line in enumerate(lines):
 if line.startswith('- **2026-10-09 最新变更：'):
  lines[i]='- **2026-10-09 最新变更：已按用户附件恢复星光线条鲸鱼（第三轮），尚未落盘。**直接复用原始透明 PNG，采用原图网格变形的 2.5D 动效，保留原画轮廓、线条和星点；右向左跃起落下、接触点涟漪、场景结束后同图挂件淡入。宽窄窗口与完整 8 秒回放已复看，暂存包重播/挂件页面通过浏览器检查。行为检查 26/26（含原图一致性）、资源检查全部通过。最新预览、`replay-v3.mp4`、复盘与暂存包见 `D:\\Z1848\\output\\deepseek-up-T-cosmic-whale-20261009\\`；在用包未改动。'
s='\n'.join(lines)+'\n';s=s.replace('**25** 条断言','**26** 条断言');p.write_text(s,encoding='utf-8',newline='\n')
p=root/'patches/T1-whale-splash.yml';s=p.read_text(encoding='utf-8').replace('WebGL2 不可用时的本地透明图片降级资源','用户指定原始透明星光鲸鱼；纹理与降级共用')
s=s.replace('3D 鲸鱼由本地 WebGL2 网格绘制，Canvas 合成星海与接触点涟漪；WebGL2 不可用时\n     降级为透明 PNG。完整动态效果需 GPU 路径，离线生命周期检查不能代替视觉验收。','鲸鱼必须保留用户提供的原图。WebGL2 使用原图纹理网格实现柔和的 2.5D 变形，\n     不重建或替换鲸鱼造型；脚本内嵌同一 PNG 字节以支持本地文件纹理。无 WebGL2 时直接绘制原图。')
p.write_text(s,encoding='utf-8',newline='\n')
print('Delivered v3; exact source image verified; archive verified; live install unchanged.')
