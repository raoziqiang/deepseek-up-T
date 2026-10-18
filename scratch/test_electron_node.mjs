import { execSync } from 'node:child_process';

const electron = 'D:\\Program Files (x86)\\deepseekharness\\DeepSeek Harness.exe';
const out = execSync(`"${electron}" -e "console.log(JSON.stringify(process.versions))"`, {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
}).toString();
console.log('Electron versions:', out);
