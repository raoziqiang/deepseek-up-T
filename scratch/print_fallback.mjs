import { readAsarEntry } from '../src/asar.mjs';

const targetAsar = 'D:\\Program Files (x86)\\deepseekharness\\resources\\app.asar';
const anim = readAsarEntry(targetAsar, 'lib/welcome/whale-animation.js').toString('utf-8');

const start = anim.indexOf('renderVectorFallbackScene(');
console.log(anim.slice(start, start + 1200));
