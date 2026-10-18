from pathlib import Path
import shutil
p=Path('vendor/whale/materials/whale-animation.js');shutil.copy2(p,'scratch/whale-before-flow-v4.js')
s=p.read_text(encoding='utf-8');a=s.index('const VERTEX =');b=s.index('const FRAGMENT =',a)
s=s[:a]+Path('scratch/whale-swim-vertex.txt').read_text(encoding='utf-8')+'\n'+s[b:]
a=s.index('  waveAt(');b=s.index('  drawFlight(',a)
s=s[:a]+Path('scratch/whale-flow-methods.txt').read_text(encoding='utf-8')+'\n'+s[b:]
# Replace the old rigid dotted exhaust with the shared deformed-tail filaments.
a=s.index("    c.save();c.globalCompositeOperation='screen'",s.index('  drawFlight('));b=s.index('    const layer=this.whaleContext',a)
s=s[:a]+s[b:]
s=s.replace('this.drawStars(t,seconds)', 'this.prepareFlow(t);this.drawStars(t,seconds)')
s=s.replace('this.drawFlight(t,seconds);this.drawRipples(t)', 'this.drawContinuum(t);this.drawFlight(t,seconds)')
s=s.replace('const lift=Math.sin(clamp((t-.16)/.60)*Math.PI)', 'const lift=Math.sin(smooth(.12,.80,t)*Math.PI)')
s=s.replace('const rotation=.48*Math.cos(clamp((t-.16)/.60)*Math.PI)-smooth(.76,.94,t)*.18', 'const rotation=.38*Math.cos(smooth(.12,.80,t)*Math.PI)-smooth(.76,.94,t)*.12')
s=s.replace("error:modelError})", "error:modelError,strokePeriod:Math.PI*2/SWIM_RATE})")
p.write_text(s,encoding='utf-8',newline='\n')
d=Path('state/whale-flow-v4');d.mkdir(exist_ok=True)
s=Path('vendor/whale/materials/preview.html').read_text(encoding='utf-8').replace('<script type="module">','<script src="whale-animation.js"></script><script>').replace("import { WhaleSplash, drawWhale } from './whale-animation.js'",'const { WhaleSplash, drawWhale } = window')
(d/'index.html').write_text(s,encoding='utf-8',newline='\n');shutil.copy2('vendor/whale/materials/whale-3d.png',d/'whale-3d.png')
