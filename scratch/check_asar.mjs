import fs from 'node:fs';
import path from 'node:path';

const asarPath = 'D:\\Program Files (x86)\\deepseekharness\\resources\\app.asar';
console.log('Target app.asar stat:', fs.statSync(asarPath));

const stagedPath = 'D:\\Z1848\\harness-ds\\deepseek-up-T\\state\\staged\\app.asar';
console.log('Staged app.asar stat:', fs.statSync(stagedPath));
