from pathlib import Path
p=Path('vendor/whale/materials/whale-animation.js');s=p.read_text(encoding='utf-8')
a=s.index('    // Solve when the tail clears');b=s.index('  makeBackground()',a)
s=s[:a]+'  }\n'+s[b:]
s='\n'.join(line for line in s.splitlines() if 'this.dust=Array.from' not in line and 'this.particles=Array.from' not in line)+'\n'
s=s.replace('strand<13','strand<11').replace('spread=(strand-6)/6','spread=(strand-5)/5')
s=s.replace("(.012+.14*Math.pow(age,1.2))", "(.06+.14*Math.pow(age,1.2))")
s=s.replace("grad.addColorStop(0,'rgba(137,231,247,'+opacity+')');", "grad.addColorStop(0,'rgba(137,231,247,0)');\n      grad.addColorStop(.14,'rgba(137,231,247,'+opacity+')');")
p.write_text(s,encoding='utf-8',newline='\n')
p=Path('test/splash.test.mjs');s=p.read_text(encoding='utf-8')
s=s.replace('宽窄窗口均向左跃起再落下，接触点位于可见星海内','宽窄窗口均向左跃起再落下，沿经过的路径持续留下波峰')
s=s.replace("    assert.equal(animation.contacts.length, 2);\n    assert.ok(animation.contacts[0].at < animation.contacts[1].at);\n    assert.ok(animation.contacts.every(c => c.x >= 0 && c.x <= 1 && c.y > 0 && c.y < 1));", """    animation.prepareFlow(.55);
    assert.ok(animation.flowWaves.length >= 2, '游动途中应有多个仍在扩散的波峰');
    assert.ok(animation.flowWaves.every(w => w.rx > 0 && w.ry > 0 && w.strength > 0));
    const wave = animation.flowWaves[0];
    const influence = animation.flowAt(wave.x + Math.cos(wave.angle) * wave.rx, wave.y + Math.sin(wave.angle) * wave.rx);
    assert.ok(influence.light > 0, '尾迹必须影响星点，不能只有装饰线');
    const tail = animation.tailAt(.55);
    assert.ok(Number.isFinite(tail.x) && Number.isFinite(tail.y));
    animation.reduced = true; animation.prepareFlow(.55);
    assert.equal(animation.flowWaves.length, 0);
    const still = animation.flowAt(tail.x, tail.y);
    assert.equal(still.dx, 0); assert.equal(still.dy, 0);""")
p.write_text(s,encoding='utf-8',newline='\n')
