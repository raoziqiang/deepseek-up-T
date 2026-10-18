import { readAsarEntry } from '../src/asar.mjs';

const targetAsar = 'D:\\Program Files (x86)\\deepseekharness\\resources\\app.asar';
const mainJs = readAsarEntry(targetAsar, 'lib/main.js').toString('utf-8');
const lines = mainJs.split('\n');

for (let i = 7910; i < 7990; i++) {
  console.log(`L${i}: ${lines[i]}`);
}
