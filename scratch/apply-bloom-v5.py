from pathlib import Path
import shutil
p=Path('vendor/whale/materials/whale-animation.js');shutil.copy2(p,'scratch/whale-before-bloom-v5.js')
s=p.read_text(encoding='utf-8');a=s.index('  drawContinuum(');b=s.index('  drawStars(',a)
s=s[:a]+Path('scratch/whale-bloom-method.txt').read_text(encoding='utf-8')+'\n'+s[b:]
s=s.replace('    this.resize();getModel()', '''    this.prismaticDust=Array.from({length:260},()=>({offset:rng(),life:1.3+rng()*1.5,angle:rng()*Math.PI*2,
      spin:(rng()-.5)*2,spread:.25+rng()*.9,speed:rng(),size:rng(),color:rng()<.09?3:Math.floor(rng()*3)}))
    this.resize();getModel()''')
s=s.replace("ctx.save();ctx.shadowColor='rgba(101,225,255,.48)';ctx.shadowBlur=w*.018;", """ctx.save();ctx.globalCompositeOperation='screen';ctx.globalAlpha*=.30;
    ctx.filter='blur('+Math.max(2,w*.028)+'px)';
    ctx.drawImage(frame,-w/2,-w/(880/478)/2,w,w/(880/478));ctx.restore();
    ctx.save();ctx.shadowColor='rgba(101,225,255,.66)';ctx.shadowBlur=w*.026;""")
p.write_text(s,encoding='utf-8',newline='\n')
d=Path('state/whale-bloom-v5');d.mkdir(exist_ok=True)
shutil.copy2('state/whale-flow-v4/index.html',d/'index.html');shutil.copy2('vendor/whale/materials/whale-3d.png',d/'whale-3d.png')
