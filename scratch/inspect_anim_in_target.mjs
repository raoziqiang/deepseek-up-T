import { readAsarEntry } from '../src/asar.mjs';

const targetAsar = 'D:\\Program Files (x86)\\deepseekharness\\resources\\app.asar';
const anim = readAsarEntry(targetAsar, 'lib/welcome/whale-animation.js').toString('utf-8');

console.log('anim length:', anim.length);
console.log('First 500 chars:\n', anim.slice(0, 500));

// Check render method
const renderMatch = anim.match(/render\(t,[\s\S]*?renderMasterworkScene[\s\S]*?\}/);
console.log('Render method:\n', renderMatch ? renderMatch[0] : 'NOT FOUND');

// Check renderMasterworkScene
const masterworkMatch = anim.match(/renderMasterworkScene\([\s\S]*?\n  \}/);
console.log('renderMasterworkScene:\n', masterworkMatch ? masterworkMatch[0] : 'NOT FOUND');

// Check initHeroImage
const heroMatch = anim.match(/function initHeroImage\(\)[\s\S]*?\n\}/);
console.log('initHeroImage:\n', heroMatch ? heroMatch[0] : 'NOT FOUND');
