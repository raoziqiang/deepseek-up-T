import { readAsarEntry } from '../src/asar.mjs';

const targetAsar = 'D:\\Program Files (x86)\\deepseekharness\\resources\\app.asar';
const welcome = readAsarEntry(targetAsar, 'renderer/welcome.html').toString('utf-8');
const lines = welcome.split('\n');
console.log('Line with CSP in target asar:', lines.find(l => l.includes('Content-Security-Policy')));

const stagedAsar = 'D:\\Z1848\\harness-ds\\deepseek-up-T\\state\\staged\\app.asar';
const stagedWelcome = readAsarEntry(stagedAsar, 'renderer/welcome.html').toString('utf-8');
const stagedLines = stagedWelcome.split('\n');
console.log('Line with CSP in staged asar:', stagedLines.find(l => l.includes('Content-Security-Policy')));
