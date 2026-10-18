import { execSync } from 'node:child_process';

const p = execSync('powershell -NoProfile -Command "Get-Process -Name \'DeepSeek Harness\' | Select-Object Id, StartTime"').toString();
console.log('DeepSeek Harness StartTimes:\n', p);
