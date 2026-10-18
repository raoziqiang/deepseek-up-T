import { readAsarEntry } from '../src/asar.mjs';

const targetAsar = 'D:\\Program Files (x86)\\deepseekharness\\resources\\app.asar';
const mainJs = readAsarEntry(targetAsar, 'lib/main.js').toString('utf-8');

console.log('Total length of lib/main.js:', mainJs.length);
const lines = mainJs.split('\n');
lines.forEach((l, idx) => {
  if (l.includes('welcome') || l.includes('whale') || l.includes('splash') || l.includes('replay') || l.includes('pendant')) {
    console.log(`L${idx + 1}: ${l}`);
  }
});
