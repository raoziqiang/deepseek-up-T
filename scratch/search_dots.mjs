import fs from 'node:fs';

const anim = fs.readFileSync('D:\\Z1848\\harness-ds\\deepseek-up-T\\vendor\\whale\\materials\\whale-animation.js', 'utf8');
const lines = anim.split('\n');

lines.forEach((l, idx) => {
  if (l.includes('arc') || l.includes('node') || l.includes('spine') || l.includes('constellation')) {
    console.log(`L${idx + 1}: ${l}`);
  }
});
