import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

try {
  const p1 = execSync('powershell -NoProfile -Command "Get-Process | Where-Object { $_.ProcessName -like \'*deepseek*\' -or $_.ProcessName -like \'*harness*\' } | Select-Object Id, ProcessName, Path"').toString();
  console.log('Running processes:\n', p1);
} catch (e) {
  console.log('Error checking processes:', e.message);
}

try {
  const p2 = execSync('powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; Get-ChildItem -Path ([Environment]::GetFolderPath(\'Desktop\')) -Filter *.lnk | ForEach-Object { [PSCustomObject]@{ File = $_.Name; Target = $ws.CreateShortcut($_.FullName).TargetPath } } | Format-Table -AutoSize"').toString();
  console.log('Desktop Shortcuts:\n', p2);
} catch (e) {
  console.log('Error checking desktop shortcuts:', e.message);
}
