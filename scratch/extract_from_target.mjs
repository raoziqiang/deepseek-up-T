import asar from '@electron/asar';
import fs from 'node:fs';

const targetAsar = 'D:\\Program Files (x86)\\deepseekharness\\resources\\app.asar';

const filesToCheck = [
  'renderer/welcome.html',
  'renderer/whale-splash.js',
  'lib/welcome/whale-animation.js',
  'renderer/replay.html',
  'renderer/replay.js'
];

for (const f of filesToCheck) {
  try {
    const buf = asar.extractFile(targetAsar, f);
    console.log(`=== ${f} === (length: ${buf.length})`);
    const str = buf.toString('utf-8');
    console.log(str.slice(0, 300));
    console.log('... has __WHALE_PIXEL__?', str.includes('__WHALE_PIXEL__'));
    console.log('... has data:image?', str.includes('data:image'));
  } catch (e) {
    console.log(`=== ${f} ERROR:`, e.message);
  }
}
