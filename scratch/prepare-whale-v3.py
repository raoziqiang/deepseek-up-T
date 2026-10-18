from pathlib import Path
import shutil
d=Path('state/whale-reference-v3');d.mkdir(exist_ok=True)
s=Path('vendor/whale/materials/preview.html').read_text(encoding='utf-8').replace('<script type="module">','<script src="whale-animation.js"></script><script>').replace("import { WhaleSplash, drawWhale } from './whale-animation.js'",'const { WhaleSplash, drawWhale } = window')
(d/'index.html').write_text(s,encoding='utf-8')
for a,b in [('state/staged/tree/lib/welcome/whale-animation.js','whale-animation.js'),('vendor/whale/materials/whale-3d.png','whale-3d.png')]:shutil.copy2(a,d/b)
