import { readAsarEntry } from '../src/asar.mjs';

const targetAsar = 'D:\\Program Files (x86)\\deepseekharness\\resources\\app.asar';
const anim = readAsarEntry(targetAsar, 'lib/welcome/whale-animation.js').toString('utf-8');

let pos = 0;
while (true) {
  const idx = anim.indexOf('renderVectorFallbackScene', pos);
  if (idx === -1) break;
  console.log(`Found at index ${idx}:`);
  console.log(anim.slice(Math.max(0, idx - 50), idx + 200));
  pos = idx + 25;
}
