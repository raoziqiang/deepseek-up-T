// 模拟升级后旧备份仍在：构建必须从新版安装包出发，安装演练必须以它核对。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolvePaths, sha256 } from '../src/paths.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const real = resolvePaths();
const fake = path.join(root, 'state', 'cmp', 'upgrade-source-test');
const resources = path.join(fake, 'resources');
const asar = path.join(resources, 'app.asar');
const backup = path.join(resources, 'app.asar.whale-backup');
const marker = path.join(fake, 'upgrade-marker.txt');
const staged = path.join(fake, 'staged.asar');
const rehearsal = path.join(fake, 'rehearsal.asar');
const env = { ...process.env, DSH_UP_T_INSTALL_DIR: fake };
const run = (args, opts = {}) => spawnSync(process.execPath, args, {
  cwd: root, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts,
});
let checks = 0;
const assert = (condition, message) => {
  checks += 1;
  if (!condition) throw new Error(message);
};

if (!fake.startsWith(path.join(root, 'state', 'cmp') + path.sep)) throw new Error('测试目录越界');
fs.rmSync(fake, { recursive: true, force: true });
fs.mkdirSync(resources, { recursive: true });
try {
  fs.copyFileSync(real.asarBackup, backup);
  fs.writeFileSync(marker, 'simulated upgrade\n');
  fs.writeFileSync(path.join(fake, 'version'), '44.1.0-simulated\n');
  const changed = run(['vendor/asar/write.mjs', backup, '--set', 'test-upgrade-marker.txt', marker, '--out', asar]);
  assert(changed.status === 0, `造新版安装包失败：${changed.stderr}`);
  const newHash = await sha256(asar);
  const oldHash = await sha256(backup);
  assert(newHash !== oldHash, '新版安装包与旧备份确实不同');

  const built = run(['vendor/whale/build.mjs', '--out', staged]);
  assert(built.status === 0, `升级后构建失败：${built.stderr}`);
  const manifest = JSON.parse(fs.readFileSync(`${staged}.build.json`, 'utf8'));
  assert(manifest.sourceHash === newHash, '构建来源必须是新版安装包');
  assert(manifest.sourceHash !== oldHash, '不能误用旧版备份');
  assert(manifest.stagedHash === await sha256(staged), '暂存包哈希写入来源记录');

  const rehearsed = run(['vendor/whale/install.mjs', '--yes', '--staged', staged, '--to', rehearsal]);
  assert(rehearsed.status === 0, `新版落盘演练失败：${rehearsed.stderr}`);
  assert(await sha256(rehearsal) === await sha256(staged), '演练产物等于暂存包');
  assert(await sha256(asar) === newHash && await sha256(backup) === oldHash, '演练不改安装包与旧备份');

  manifest.sourceHash = oldHash;
  fs.writeFileSync(`${staged}.build.json`, JSON.stringify(manifest));
  const stale = run(['vendor/whale/install.mjs', '--yes', '--staged', staged, '--to', rehearsal]);
  assert(stale.status === 1 && /旧备份/.test(stale.stderr), '错用旧备份必须拒绝');
  assert(await sha256(asar) === newHash && await sha256(backup) === oldHash, '拒绝时安装目录仍未改动');
} finally {
  fs.rmSync(fake, { recursive: true, force: true });
}
console.log(`升级来源演练 ${checks}/${checks} 项通过`);
