import { spawnSync } from 'node:child_process';

const electron = 'D:\\Program Files (x86)\\deepseekharness\\DeepSeek Harness.exe';
const script = 'D:\\Z1848\\harness-ds\\deepseek-up-T\\scratch\\test_electron_window.cjs';

const res = spawnSync(electron, ['--user-data-dir=D:\\Z1848\\harness-ds\\deepseek-up-T\\state\\test-profile', script], { encoding: 'utf-8', timeout: 10000 });
console.log('stdout:\n', res.stdout);
console.log('stderr:\n', res.stderr);
console.log('exitCode:', res.status);
