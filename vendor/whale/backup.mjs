// 本版本原版备份轮换。只在 install.mjs 确认 Harness 已退出后调用。
import fs from 'node:fs';
import crypto from 'node:crypto';

export function hashFile(file) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const chunk = Buffer.allocUnsafe(1024 * 1024);
  try {
    let n;
    while ((n = fs.readSync(fd, chunk, 0, chunk.length, null)) > 0) hash.update(chunk.subarray(0, n));
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

/** 旧备份按哈希留档，再将升级后的在用原版设为当前版本的回滚基准。 */
export function refreshBackup(asar, backup) {
  const installedHash = hashFile(asar);
  if (!fs.existsSync(backup)) {
    fs.copyFileSync(asar, backup);
    if (hashFile(backup) !== installedHash) throw new Error('新备份复制后哈希不一致');
    return { refreshed: true, archived: null };
  }
  const oldHash = hashFile(backup);
  if (oldHash === installedHash) return { refreshed: false, archived: null };

  const archived = `${backup}.${oldHash.slice(0, 16)}`;
  if (fs.existsSync(archived) && hashFile(archived) !== oldHash) {
    throw new Error(`历史备份文件名冲突：${archived}`);
  }
  if (!fs.existsSync(archived)) fs.copyFileSync(backup, archived);
  if (hashFile(archived) !== oldHash) throw new Error(`历史备份复制后哈希不一致：${archived}`);
  try {
    fs.copyFileSync(asar, backup);
    if (hashFile(backup) !== installedHash) throw new Error('新备份复制后哈希不一致');
  } catch (error) {
    fs.copyFileSync(archived, backup);
    throw new Error(`刷新本版本备份失败，旧备份已恢复：${error.message}`);
  }
  return { refreshed: true, archived };
}
