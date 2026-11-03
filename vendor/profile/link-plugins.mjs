// deepseek-up-T :: 把本仓库的 L1 插件挂回 profile（目录链接 + dsh.profile.bundles 登记）
//
// 为什么要有它：插件靠两样东西被 Harness 加载 ——
//   ① `<profile>/node_modules/<名字>` 是指向 `plugins/<名字>` 的 junction；
//   ② `<profile>/package.json` 的 `dsh.profile.bundles` 里有这个名字。
// 任何一样丢了，插件就**静默地**不加载（界面上什么都没有，也不报错）。2026-11-03 就是这样：
// 两样都被别的改动摘掉了。以前靠 README 里手敲 New-Item + 手改 JSON，这里收成一条命令。
//
//   node vendor/profile/link-plugins.mjs            只预演：列出要做的事，写候选清单 state/candidate/package.json
//   node vendor/profile/link-plugins.mjs --yes      真做：先备份 package.json，再建链接、补登记
//   node vendor/profile/link-plugins.mjs --only dsh-up-t   只处理指定插件（可重复）
//
// 只追加，不删除：已有的登记与链接原样保留；同名路径已存在但指向别处 → 拒绝，不覆盖。
// 改完要**重启 Harness**（组合层没有 watcher）。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolvePaths, PROJECT_ROOT } from '../../src/paths.mjs';

export const DEFAULT_PLUGINS = ['dsh-up-t', 'dsh-whale-splash'];

function realOrNull(p) {
  try { return fs.realpathSync.native(p); } catch { return null; }
}
function lexists(p) {
  try { fs.lstatSync(p); return true; } catch { return false; }
}
const samePath = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

/**
 * 算出要做的事，不写盘。
 * @returns {{ links: object[], bundles: { before: string[], after: string[], added: string[] }, pkg: object, problems: string[] }}
 */
export function planLink({ profileDir, projectRoot = PROJECT_ROOT, plugins = DEFAULT_PLUGINS }) {
  const problems = [];
  const links = [];
  for (const name of plugins) {
    const target = path.join(projectRoot, 'plugins', name);
    const link = path.join(profileDir, 'node_modules', name);
    if (!fs.existsSync(path.join(target, 'package.json'))) {
      problems.push(`仓库里没有插件 ${name}（缺 ${path.join(target, 'package.json')}）`);
      continue;
    }
    if (lexists(link)) {
      const real = realOrNull(link);
      if (real && samePath(real, realOrNull(target) ?? target)) {
        links.push({ name, link, target, action: 'ok' });
      } else {
        problems.push(`${link} 已存在但指向 ${real ?? '（断链）'}，不是 ${target}：不覆盖，请人工确认`);
        links.push({ name, link, target, action: 'conflict', real });
      }
    } else {
      links.push({ name, link, target, action: 'create' });
    }
  }

  const pkgFile = path.join(profileDir, 'package.json');
  let pkg = null;
  try { pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8')); } catch (err) {
    problems.push(`读不了 ${pkgFile}：${err?.message ?? err}`);
  }
  const before = Array.isArray(pkg?.dsh?.profile?.bundles) ? pkg.dsh.profile.bundles.slice() : null;
  if (pkg && before === null) problems.push(`${pkgFile} 里没有 dsh.profile.bundles 数组：结构不认识，不动它`);
  const after = before ? before.slice() : [];
  const added = [];
  if (before) {
    for (const name of plugins) {
      if (!after.includes(name)) { after.push(name); added.push(name); }
    }
  }
  return { links, bundles: { before: before ?? [], after, added }, pkg, pkgFile, problems };
}

/** 真做。调用前应已确认 plan.problems 为空。 */
export function applyLink(plan, { now = new Date() } = {}) {
  const done = [];
  if (plan.bundles.added.length) {
    const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-');
    const backup = `${plan.pkgFile}.up-t-backup-${stamp}`;
    fs.copyFileSync(plan.pkgFile, backup);
    done.push(`备份 ${backup}`);
    const next = structuredClone(plan.pkg);
    next.dsh.profile.bundles = plan.bundles.after;
    const tmp = `${plan.pkgFile}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    fs.renameSync(tmp, plan.pkgFile);
    done.push(`登记 ${plan.bundles.added.join(', ')} → dsh.profile.bundles`);
  }
  for (const l of plan.links) {
    if (l.action !== 'create') continue;
    fs.mkdirSync(path.dirname(l.link), { recursive: true });
    // Windows 上 junction 不需要管理员权限；其它系统 'junction' 会被当成目录符号链接。
    fs.symlinkSync(l.target, l.link, 'junction');
    done.push(`链接 ${l.link} → ${l.target}`);
  }
  return done;
}

function main(argv) {
  const yes = argv.includes('--yes');
  const only = [];
  for (let i = 0; i < argv.length; i += 1) if (argv[i] === '--only') only.push(argv[i + 1]);
  const P = resolvePaths();
  const plan = planLink({ profileDir: P.profileDir, plugins: only.length ? only : DEFAULT_PLUGINS });

  console.log(`profile  ${P.profileDir}`);
  for (const l of plan.links) {
    const tag = { ok: 'OK  ', create: '新建', conflict: '冲突' }[l.action];
    console.log(`  ${tag} 链接 ${l.name}  →  ${l.target}`);
  }
  if (plan.bundles.added.length) console.log(`  新增 登记 ${plan.bundles.added.join(', ')}（现有 ${plan.bundles.before.length} 个）`);
  else if (plan.pkg) console.log('  OK   登记 已齐');
  for (const p of plan.problems) console.log(`  FAIL ${p}`);
  if (plan.problems.length) return 1;

  const nothing = !plan.bundles.added.length && plan.links.every((l) => l.action === 'ok');
  if (nothing) { console.log('\n都已就位，无事可做。没出现的话：重启 Harness，再跑 node src/cli.mjs doctor 看心跳。'); return 0; }

  if (!yes) {
    if (plan.pkg && plan.bundles.added.length) {
      const cand = path.join(PROJECT_ROOT, 'state', 'candidate', 'package.json');
      fs.mkdirSync(path.dirname(cand), { recursive: true });
      const next = structuredClone(plan.pkg);
      next.dsh.profile.bundles = plan.bundles.after;
      fs.writeFileSync(cand, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
      console.log(`\n候选清单已写到 ${cand}（真实 profile 没动）。`);
      console.log('可选：先预检  node src/cli.mjs precheck --profile-json state\\candidate\\package.json');
    }
    console.log('确认无误后加 --yes 真做；做完重启 Harness。');
    return 0;
  }
  for (const d of applyLink(plan)) console.log(`  done ${d}`);
  console.log('\n完成。请完全退出并重启 Harness（托盘也要退），然后 node src/cli.mjs doctor 看心跳。');
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  process.exitCode = main(process.argv.slice(2));
}
