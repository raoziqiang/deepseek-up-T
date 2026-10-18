import { readAsarEntry } from '../src/asar.mjs';

const targetAsar = 'D:\\Program Files (x86)\\deepseekharness\\resources\\app.asar';
console.log('=== replay.html ===\n', readAsarEntry(targetAsar, 'renderer/replay.html').toString('utf-8'));
console.log('=== replay.js ===\n', readAsarEntry(targetAsar, 'renderer/replay.js').toString('utf-8'));
