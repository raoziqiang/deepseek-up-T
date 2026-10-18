from pathlib import Path
import shutil,hashlib,json
out=Path('D:/Z1848/output/deepseek-up-T-cosmic-whale-20261009');d=out/'preview'
shutil.copy2('state/staged/tree/lib/welcome/whale-animation.js',d/'whale-animation.js')
shutil.copy2('state/whale-bloom-v5/index.html',d/'index.html')
for name in ['app.asar','app.asar.build.json']:shutil.copy2(Path('state/staged')/name,out/name)
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
assert sha(d/'whale-3d.png')==sha('D:/Z1848/Temp/codex-clipboard-2d1ee809-0218-41a2-a401-55b8f68205c3.png')
assert sha(out/'app.asar')==json.loads((out/'app.asar.build.json').read_text())['stagedHash']
assert sha('D:/Program Files (x86)/deepseekharness/resources/app.asar')=='6c23768d8316b4a5995fde8a0a0c95d18a4ed36fb0f1329f0b0b72f74fdcd7f3'
note='''# 光晕与飘彩版（第五轮）· 2026-10-11

## 修改

移除尾后整束轨迹线以及清晰的椭圆线圈；保留鲸鱼的原图与上一轮游动。

- 鲸鱼分两层绘制：外层模糊柔光、内层清晰原图。
- 尾部经过的位置留下叠加的青蓝、紫粉星云光晕。
- 260 个带独立生命周期、漂移、旋转和消散的彩色粒子；少量暖金色光点点缀。
- 时空波峰仍偏折背景星点，波峰自身改为柔和色光。

## 参考来源与具体借鉴

- [Three.js 官方 Unreal Bloom 演示](https://threejs.org/examples/webgl_postprocessing_unreal_bloom.html)：已在浏览器实际查看，参考清晰发光主体与外围柔光的层次。
- [Codrops: Implementing a Dissolve Effect with Shaders and Particles in Three.js](https://tympanus.net/codrops/2025/02/17/implementing-a-dissolve-effect-with-shaders-and-particles-in-three-js/)：阅读其粒子生命周期、波状漂移和选择性辉光讲解。借鉴运动与发光方式，不复制其模型或代码。

## 验证状态

行为检查 26/26、资源检查全部通过；构建 8 个 JS 语法检查通过，14 项声明差异，其余 11,466 项一致。源图哈希未变化，交付包与构建记录一致，在用安装包未改动。

**本轮视觉复看未完成。** 浏览器工具安全策略阻止打开本地 file:// 预览，并明确禁止绕过。没有将旧版本的录像当作本版证明。本版没有 replay-v5.mp4；目录中的 v2/v3/v4 录像均为历史版本。

预览文件已更新到原地址，用户可以刷新当前打开的页面查看。仍需新版实际截图或录像来完成视觉复看。
'''
(out/'VISUAL-REVIEW.md').write_text(note,encoding='utf-8',newline='\n')
(out/'README.md').write_text('''# 星光鲸鱼 · 光晕与飘彩版（第五轮）

2026-10-11 更新。`preview/index.html` 为最新预览，刷新当前页面即可加载。

本版移除尾后线束，改为青蓝、紫粉光晕、漂浮彩色星屑与少量暖金亮点。用户指定鲸鱼原图与游动保留。

构建和行为检查已通过，实际视觉复看因浏览器工具阻止本地 file:// 页面而未完成。详见 `VISUAL-REVIEW.md` 的参考来源与验证状态。

`app.asar` 和 `app.asar.build.json` 已同步为最新暂存包，尚未安装。v2/v3/v4 录像是历史版本，本版尚无新录像。
''',encoding='utf-8',newline='\n')
p=Path('tracks/T1-appearance/README.md');s=p.read_text(encoding='utf-8');a=s.index('### 原图鲸鱼');b=s.index('## 现状',a)
s=s[:a]+'''### 光晕与飘彩（第五轮，已构建，视觉复看待完成）

- 按用户反馈移除尾后的线束与硬线圈，改为分层柔光、青蓝/紫粉星云、260 个独立漂移旋转的彩色粒子，少量暖金点缀。用户指定原图与上一轮游动保留。
- 实际查看 Three.js 官方 Unreal Bloom 演示，并阅读 Codrops 发光粒子教程，借鉴亮核/柔光分层、生命周期与波状漂移。完整来源见交付目录 `VISUAL-REVIEW.md`。
- 行为检查 26/26、资源检查全部通过；构建 8 个 JS 语法检查通过，14 项声明差异，其余 11,466 项一致。
- **新版视觉复看未完成**：浏览器工具安全策略阻止本地 file:// 预览且禁止绕过。未导出新录像，旧 v4 录像不能作为本版证明。
- 原地址预览与暂存包已更新至 `D:\\Z1848\\output\\deepseek-up-T-cosmic-whale-20261009\\`。在用安装包未替换；需要新版截图或录像继续视觉复看。

'''+s[b:];p.write_text(s,encoding='utf-8',newline='\n')
p=Path('docs/04-roadmap.md');lines=p.read_text(encoding='utf-8').splitlines()
for i,line in enumerate(lines):
 if line.startswith('- **2026-10-11 最新变更：'):
  lines[i]='- **2026-10-11 最新变更：光晕与飘彩版完成第五轮代码修订，视觉复看待完成，尚未落盘。**按用户要求参考 Three.js Bloom 和 Codrops 粒子案例，移除尾后线束，改为柔光、青蓝/紫粉星云和独立漂散彩色粒子；原图鲸鱼与游动保留。行为检查 26/26、资源与构建检查通过。浏览器安全策略阻止 file:// 预览且禁止绕过，本轮未完成实际视觉复看，也没有新版录像。原地址预览和暂存包已更新，在用安装包未改动。'
p.write_text('\n'.join(lines)+'\n',encoding='utf-8',newline='\n')
print('v5 preview and archive updated; visual review explicitly pending.')
