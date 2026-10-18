// 升级后原版备份轮换：旧版必须留下，新版必须能成为回滚基准。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { refreshBackup, hashFile } from '../vendor/whale/backup.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'up-t-backup-'));
const asar = path.join(dir, 'app.asar');
const backup = path.join(dir, 'app.asar.whale-backup');
let checks = 0;
const assert = (condition, message) => {
  checks += 1;
  if (!condition) throw new Error(message);
};
try {
  fs.writeFileSync(asar, 'new-version');
  fs.writeFileSync(backup, 'old-version');
  const oldHash = hashFile(backup);
  const rotated = refreshBackup(asar, backup);
  assert(rotated.refreshed, '升级后必须刷新当前版本备份');
  assert(rotated.archived === `${backup}.${oldHash.slice(0, 16)}`, '旧备份按哈希命名');
  assert(fs.readFileSync(rotated.archived, 'utf8') === 'old-version', '旧版字节未丢');
  assert(fs.readFileSync(backup, 'utf8') === 'new-version', '新版成为回滚基准');
  const again = refreshBackup(asar, backup);
  assert(!again.refreshed && again.archived === null, '同版本重复执行不再轮换');

  fs.writeFileSync(asar, 'newer-version');
  fs.writeFileSync(backup, 'old-version');
  fs.writeFileSync(rotated.archived, 'conflicting-data');
  let rejected = false;
  try { refreshBackup(asar, backup); } catch (error) { rejected = /冲突/.test(error.message); }
  assert(rejected, '历史备份同名异内容时拒绝覆盖');
  assert(fs.readFileSync(backup, 'utf8') === 'old-version', '冲突时当前备份不变');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log(`备份轮换 ${checks}/${checks} 项通过`);
