import { readAsarEntry } from '../src/asar.mjs';

const targetAsar = 'D:\\Program Files (x86)\\deepseekharness\\resources\\app.asar';

console.log('=== renderer/welcome.html ===\n', readAsarEntry(targetAsar, 'renderer/welcome.html').toString('utf-8'));
console.log('=== renderer/whale-splash.js ===\n', readAsarEntry(targetAsar, 'renderer/whale-splash.js').toString('utf-8'));
