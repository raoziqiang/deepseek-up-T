#!/usr/bin/env node
// deepseek-up-T :: 命令入口
//
//   node src/cli.mjs env                环境事实
//   node src/cli.mjs doctor             体检（退出码 1 = 存在 error）
//   node src/cli.mjs snapshot create    留快照
//   node src/cli.mjs snapshot list      列出快照
//   node src/cli.mjs snapshot diff <id> 与当前现场对比
//   node src/cli.mjs snapshot restore <id> --yes
//   node src/cli.mjs baseline write     固化基线

import fs from 'node:fs';
import path from 'node:path';

import {
  resolvePaths, exists, statOrNull, readText, readJson, human, sha256,
} from './paths.mjs';
import { runDoctor } from './doctor.mjs';
import {
  createSnapshot, listSnapshots, restoreSnapshot, diffSnapshot, TRACKED_FILES,
} from './snapshot.mjs';

const TAG = { error: 'FAIL', warn: 'WARN', info: 'INFO', ok: 'OK  ' };

function parseArgs(argv) {
  const flags = new Set();
  const positional = [];
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '-m' || a === '--message') { opts.message = argv[++i]; continue; }
    if (a.startsWith('--')) { flags.add(a); continue; }
    if (a.startsWith('-') && a.length > 1) { flags.add(a); continue; }
    positional.push(a);
  }
  return { flags, positional, opts };
}

function pad(s, n) {
  const w = [...String(s)].reduce((acc, ch) => acc + (ch.charCodeAt(0) > 0x2e80 ? 2 : 1), 0);
  return String(s) + ' '.repeat(Math.max(0, n - w));
}

function table(rows, headers) {
  const widths = headers.map((h, i) =>
    Math.max(...[h, ...rows.map((r) => r[i] ?? '')].map((c) =>
      [...String(c)].reduce((acc, ch) => acc + (ch.charCodeAt(0) > 0x2e80 ? 2 : 1), 0))));
  const line = (cells) => cells.map((c, i) => pad(c ?? '', widths[i])).join('  ').replace(/\s+$/, '');
  return [line(headers), line(widths.map((w) => '─'.repeat(w))), ...rows.map(line)].join('\n');
}

// ───────────────────────────── env ─────────────────────────────

async function cmdEnv({ flags }) {
  const P = resolvePaths();
  const pkg = readJson(P.profilePackageJson);
  const bundles = pkg?.dsh?.profile?.bundles ?? [];

  const rows = [
    ['DSH_HOME', P.home, exists(P.home)],
    ['profile', P.profile, true],
    ['profile 目录', P.profileDir, exists(P.profileDir)],
    ['安装目录', P.installDir, exists(P.installDir)],
    ['app.asar', P.asar, exists(P.asar)],
    ['原版备份', P.asarBackup, exists(P.asarBackup)],
    ['宿主插件目录', P.hostModules, exists(P.hostModules)],
    ['profile 插件目录', P.profileModules, exists(P.profileModules)],
    ['内置 Node', P.bundledNode, exists(P.bundledNode)],
    ['凭据文件', P.credentials, exists(P.credentials)],
    ['快照目录', P.snapshotsDir, exists(P.snapshotsDir)],
  ];

  if (flags.has('--json')) {
    const payload = {
      paths: Object.fromEntries(rows.map(([k, v]) => [k, v])),
      exists: Object.fromEntries(rows.map(([k, v, e]) => [k, e])),
      bundles,
      dshVersion: readText(P.versionFile)?.trim() ?? null,
      nodeVersion: process.version,
    };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return 0;
  }

  console.log('deepseek-up-T · 环境事实\n');
  console.log(table(
    rows.map(([k, v, e]) => [k, e ? '✓' : '✗', v]),
    ['项', '', '值'],
  ));
  console.log(`\nHarness 版本   ${readText(P.versionFile)?.trim() ?? '(未知)'}`);
  console.log(`当前 Node      ${process.version}  (${process.execPath})`);
  console.log(`\nprofile bundles (${bundles.length})`);
  for (const b of bundles) console.log(`  · ${b}`);
  console.log('\n被快照覆盖的文件');
  for (const t of TRACKED_FILES) {
    const p = t.pick(P);
    console.log(`  ${exists(p) ? '✓' : '✗'} ${t.name}${t.critical ? '' : ' (可选)'}  ${p}`);
  }
  return 0;
}

// ──────────────────────────── doctor ────────────────────────────

async function cmdDoctor({ flags }) {
  const res = await runDoctor({ hash: !flags.has('--no-hash') });

  if (flags.has('--json')) {
    process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);
    return res.summary.error > 0 ? 1 : 0;
  }

  console.log(`deepseek-up-T · 体检   profile=${res.profile}`);
  console.log(`DSH_HOME = ${res.home}\n`);

  let group = null;
  for (const c of res.checks) {
    if (c.group !== group) { group = c.group; console.log(`── ${group} ${'─'.repeat(Math.max(0, 46 - [...group].length * 2))}`); }
    const tag = c.ok === false ? TAG[c.level] : (c.level === 'info' ? TAG.info : TAG.ok);
    console.log(`  ${tag}  ${pad(c.id, 26)} ${c.detail}`);
    if (c.ok === false && c.hint) console.log(`         ${' '.repeat(26)}↳ ${c.hint}`);
  }

  const f = res.facts;
  console.log('\n── 事实 ──────────────────────────────');
  console.log(`  app.asar        ${human(f.asarBytes)}${f.asarHash ? `  sha256:${f.asarHash.slice(0, 16)}` : ''}`);
  console.log(`  asar 条目        ${f.asarFiles ?? '-'} 文件`);
  console.log(`  asar 内包数      ${f.asarPackages ?? '-'}（其中 DSH 插件 ${f.asarDshPackages ?? '-'}）`);
  console.log(`  patch 条目       ${f.patchEntries ?? '-'}`);

  const { error, warn } = res.summary;
  console.log(`\n${error === 0 ? '通过' : '有问题'}：${error} 个错误，${warn} 个警告`);
  return error > 0 ? 1 : 0;
}

// ─────────────────────────── snapshot ───────────────────────────

async function cmdSnapshot({ flags, positional, opts }) {
  const sub = positional[1] ?? 'list';

  if (sub === 'create' || sub === 'new' || sub === 'save') {
    const { id, dir, meta } = await createSnapshot({ label: opts.message ?? '' });
    console.log(`已创建快照 ${id}`);
    console.log(`  位置   ${dir}`);
    for (const f of meta.files) {
      console.log(`  ${f.present ? '✓' : '✗'} ${f.name}${f.present ? `  ${human(f.bytes)}` : '  (不存在)'}`);
    }
    console.log(`  app.asar  ${human(meta.asar?.bytes ?? null)}  ${meta.asar ? `sha256:${meta.asar.sha256.slice(0, 16)}` : '-'}`);
    return 0;
  }

  if (sub === 'list' || sub === 'ls') {
    const items = listSnapshots();
    if (!items.length) { console.log('暂无快照。用 `node src/cli.mjs snapshot create -m "说明"` 创建。'); return 0; }
    console.log(table(
      items.map((m) => [
        m.id,
        m.createdAt ? m.createdAt.replace('T', ' ').slice(0, 19) : '?',
        m.label ?? '',
        m.files?.filter((f) => f.present).length ?? 0,
        m.asar?.sha256?.slice(0, 12) ?? '-',
        m.incomplete ? '损坏' : '',
      ]),
      ['快照 id', '创建时间', '说明', '文件数', 'asar sha256', '状态'],
    ));
    return 0;
  }

  if (sub === 'diff') {
    const id = positional[2];
    if (!id) { console.error('用法：snapshot diff <id>'); return 2; }
    const { rows, asarChanged, meta } = await diffSnapshot(id);
    console.log(`快照 ${id}（${meta.createdAt?.replace('T', ' ').slice(0, 19) ?? '?'}）与当前现场对比\n`);
    console.log(table(
      rows.map((r) => [r.name, r.status, r.was ?? '-', r.now ?? '-']),
      ['文件', '状态', '快照 sha256', '当前 sha256'],
    ));
    console.log(`\napp.asar：${asarChanged === null ? '无法比对' : asarChanged ? '已变化' : '未变化'}`);
    return 0;
  }

  if (sub === 'restore' || sub === 'rollback') {
    const id = positional[2];
    if (!id) { console.error('用法：snapshot restore <id> [--yes]'); return 2; }
    if (!flags.has('--yes')) {
      const { rows } = await diffSnapshot(id);
      console.log(`将被覆盖的文件（快照 ${id}）：`);
      for (const r of rows) console.log(`  ${r.name}  当前状态：${r.status}`);
      console.log('\n回滚前会自动再留一份快照。确认请加 --yes 重跑。');
      return 0;
    }
    const res = await restoreSnapshot(id);
    console.log(`已从快照 ${id} 回滚`);
    for (const r of res.restored) console.log(`  ✓ ${r.name} → ${r.dest}`);
    for (const s of res.skipped) console.log(`  · 跳过 ${s.name}：${s.why}`);
    if (res.preSnapshot) console.log(`\n回滚前的现场已存为快照 ${res.preSnapshot}`);
    console.log('\n注意：改动要生效需要重启 Harness（或触发 profile 重载）。');
    return 0;
  }

  console.error(`未知子命令：snapshot ${sub}`);
  return 2;
}

// ─────────────────────────── baseline ───────────────────────────

async function cmdBaseline({ flags, positional }) {
  const sub = positional[1] ?? 'write';
  if (sub !== 'write') { console.error('用法：baseline write'); return 2; }
  const P = resolvePaths();
  const res = await runDoctor({ hash: true });
  const pkg = readJson(P.profilePackageJson);

  const baseline = {
    capturedAt: new Date().toISOString(),
    project: 'deepseek-up-T',
    home: P.home,
    profile: P.profile,
    profileDir: P.profileDir,
    installDir: P.installDir,
    dshVersion: readText(P.versionFile)?.trim() ?? null,
    nodeVersion: process.version,
    bundles: pkg?.dsh?.profile?.bundles ?? [],
    facts: res.facts,
    summary: res.summary,
    checks: res.checks.map(({ group, id, level, ok, detail }) => ({ group, id, level, ok, detail })),
  };
  fs.mkdirSync(P.stateDir, { recursive: true });
  fs.writeFileSync(P.baselineFile, JSON.stringify(baseline, null, 2), 'utf8');

  if (flags.has('--json')) { process.stdout.write(`${JSON.stringify(baseline, null, 2)}\n`); return 0; }
  console.log(`基线已写入 ${P.baselineFile}`);
  console.log(`  ${baseline.dshVersion ? `Harness ${baseline.dshVersion}` : 'Harness 版本未知'} · ${baseline.bundles.length} 个 bundle · patch ${baseline.facts.patchEntries ?? 0} 条`);
  console.log(`  ${baseline.summary.error} 错误 / ${baseline.summary.warn} 警告`);
  return 0;
}

// ───────────────────────────── help ─────────────────────────────

function usage() {
  console.log(`deepseek-up-T · DSH 改造控制台

用法： node src/cli.mjs <命令> [选项]

命令
  env                     打印本机环境事实与全部关键路径
  doctor                  体检（组合层不变量 / 插件可解析 / 安装包完整性 / 进程占用）
  snapshot create [-m X]  给 profile 控制面留快照
  snapshot list           列出快照
  snapshot diff <id>      快照与当前现场对比
  snapshot restore <id>   回滚（需 --yes；回滚前自动留一份）
  baseline write          把当前事实固化为 state/baseline.json

选项
  --json                  机器可读输出
  --no-hash               doctor：跳过 121MB 安装包的 sha256（更快）

环境变量
  DSH_HOME                默认 ${'C:\\Users\\<你>\\.dsh'}
  DSH_PROFILE             默认 desktop
  DSH_PROFILE_DIR         覆盖 profile 目录
  DSH_UP_T_INSTALL_DIR    覆盖 Harness 安装目录

约定：能改 L0 配置层就不动 L1，能改 L1 就不动 L2/L3。见 docs/02-architecture.md。`);
}

// ───────────────────────────── main ─────────────────────────────

async function main() {
  const argv = process.argv.slice(2);
  const parsed = parseArgs(argv);
  const cmd = parsed.positional[0] ?? 'help';

  switch (cmd) {
    case 'env': return cmdEnv(parsed);
    case 'doctor': return cmdDoctor(parsed);
    case 'snapshot': case 'snap': return cmdSnapshot(parsed);
    case 'baseline': return cmdBaseline(parsed);
    case 'help': case '--help': case '-h': usage(); return 0;
    default:
      console.error(`未知命令：${cmd}\n`);
      usage();
      return 2;
  }
}

main()
  .then((code) => { process.exitCode = code ?? 0; })
  .catch((err) => {
    console.error(`未处理的失败：${err?.stack ?? err}`);
    process.exitCode = 1;
  });
