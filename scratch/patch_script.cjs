const fs = require('fs');
let s = fs.readFileSync('D:/Z1848/harness-ds/deepseek-up-T/scratch/gen_whale_animation.mjs', 'utf8');

const sIdx = s.indexOf('// Overall scene dimensions based on 1024x571 aspect ratio');
const eIdx = s.indexOf('// Upper-Right Starlight Halo as it settles into companion position');

if (sIdx !== -1 && eIdx !== -1) {
  const replacement = `// Overall scene dimensions based on 1024x571 aspect ratio, contain canvas
    const imgAspect = 1024 / 571
    let cardW = w * 0.98
    let cardH = cardW / imgAspect
    if (cardH > h * 0.96) {
      cardH = h * 0.96
      cardW = cardH * imgAspect
    }

    const startX = (w - cardW) * 0.5
    const startY = (h - cardH) * 0.48

    // Buoyant floating undulation
    const waveDamp = (1 - settleE)
    const floatY = Math.sin(now * 0.002) * (7 * waveDamp)

    // Fade out as it settles into workspace
    const fadeOut = clamp((1 - settleE * 1.05), 0, 1)

    ctx.save()
    ctx.globalAlpha = inAlpha * fadeOut

    // Draw the pristine masterwork image
    ctx.drawImage(heroImg, startX, startY + floatY, cardW, cardH)

    `;

  s = s.slice(0, sIdx) + replacement + s.slice(eIdx);
  fs.writeFileSync('D:/Z1848/harness-ds/deepseek-up-T/scratch/gen_whale_animation.mjs', s, 'utf8');
  console.log('Successfully patched gen_whale_animation.mjs!');
} else {
  console.error('Indexes not found:', sIdx, eIdx);
}
