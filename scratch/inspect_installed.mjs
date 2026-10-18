import { readAsarEntry } from '../src/asar.mjs';

const targetAsar = 'D:\\Program Files (x86)\\deepseekharness\\resources\\app.asar';

const filesToCheck = [
  'renderer/welcome.html',
  'renderer/whale-splash.js',
  'lib/welcome/whale-animation.js',
  'renderer/replay.html',
  'renderer/replay.js',
  'renderer/pendant.html',
  'renderer/pendant.js'
];

for (const f of filesToCheck) {
  try {
    const buf = readAsarEntry(targetAsar, f);
    if (!buf) {
      console.log(`=== ${f} NOT FOUND`);
      continue;
    }
    console.log(`=== ${f} === (length: ${buf.length})`);
    const str = buf.toString('utf-8');
    console.log(str.slice(0, 300));
    console.log('... has __WHALE_PIXEL__?', str.includes('__WHALE_PIXEL__'));
    console.log('... has data:image?', str.includes('data:image'));
  } catch (e) {
    console.log(`=== ${f} ERROR:`, e.message);
  }
}
