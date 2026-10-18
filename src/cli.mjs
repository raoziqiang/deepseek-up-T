#!/usr/bin/env node
// deepseek-up-T :: 命令入口
//
//   node src/cli.mjs env                环境事实
//   node src/cli.mjs doctor             体检（退出码 1 = 存在 error）
//   node src/cli.mjs snapshot create    留快照
//   node src/cli.mjs snapshot list      列出快照
//   node src/cli.mjs snapshot diff <id> 与当前现场对比
//   node src/cli.mjs snapshot restore <id> --yes
//   node src/cli.mjs snapshot prune     快照保留策略（预演；--yes 才删）
//   node src/cli.mjs baseline write     固化基线

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  resolvePaths, PROJECT_ROOT, exists, statOrNull, readText, readJson, human, sha256,
} from './paths.mjs';
import { runDoctor } from './doctor.mjs';
import {
  createSnapshot, listSnapshots, restoreSnapshot, diffSnapshot, TRACKED_FILES,
  planPrune, deleteSnapshots,
} from './snapshot.mjs';
import {
  readAsarHeader, walkAsar, listAsarPaths, readAsarEntry, grepAsarContent,
} from './asar.mjs';
import { runPrecheck, PROBE_PROFILE } from './precheck.mjs';
import { runUpgradeCheck, reapplyPlan } from './upgrade.mjs';
import { runAccept, printAccept } from './accept.mjs';

const TAG = { error: 'FAIL', warn: 'WARN', info: 'INFO', ok: 'OK  ' };

/** 这些选项要吃掉后面一个值；其余 `-x` / `--x` 一律当布尔开关。 */
const VALUE_OPTS = new Map([
  ['-m', 'message'], ['--message', 'message'],
  ['--out', 'out'], ['--limit', 'limit'], ['--file', 'file'],
  ['--profile-json', 'profileJson'], ['--keep', 'keep'], ['--url', 'url'],
]);

function parseArgs(argv) {
  const flags = new Set();
  const positional = [];
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--patch') { (opts.patch ??= []).push(argv[++i]); continue; }
    if (a === '--keep-match') { (opts.keepMatch ??= []).push(argv[++i]); continue; }
    if (VALUE_OPTS.has(a)) { opts[VALUE_OPTS.get(a)] = argv[++i]; continue; }
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
    if (flags.has('--json')) {
      process.stdout.write(`${JSON.stringify({ id, dir, meta }, null, 2)}\n`);
      return 0;
    }
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
    if (flags.has('--json')) {
      process.stdout.write(`${JSON.stringify({ items }, null, 2)}\n`);
      return 0;
    }
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
      console.log('\n回滚前会自动再留一份快照。此刻还没有动任何文件 —— 确认请加 --yes 重跑。');
      return 0;
    }
    const res = await restoreSnapshot(id);
    console.log(`已从快照 ${id} 回滚`);
    for (const r of res.restored) console.log(`  ✓ ${r.name} → ${r.dest}`);
    for (const s of res.skipped) console.log(`  · 跳过 ${s.name}：${s.why}`);
    const moved = res.restored.filter((r) => r.relocatedFrom);
    if (moved.length) {
      console.log('\n注意：以下文件的当前位置与快照里记的不一样，写的是**当前现场**的位置（照着快照里那条旧路径写会「报成功、而现场没变」）：');
      for (const r of moved) console.log(`  ${r.name}：快照记的是 ${r.relocatedFrom}`);
    }
    if (res.preSnapshot) console.log(`\n回滚前的现场已存为快照 ${res.preSnapshot}`);
    console.log('\n注意：改动要生效需要重启 Harness（或触发 profile 重载）。');
    return 0;
  }

  if (sub === 'prune' || sub === 'gc') {
    const keepN = opts.keep === undefined ? 10 : Number.parseInt(opts.keep, 10);
    if (!Number.isInteger(keepN) || keepN < 0) {
      console.error(`--keep 需要一个非负整数（收到 ${JSON.stringify(opts.keep)}）`);
      return 2;
    }
    const keepMatch = opts.keepMatch ?? [];
    const plan = planPrune({ keep: keepN, keepMatch });

    if (flags.has('--json')) {
      console.log(JSON.stringify(plan, null, 2));
    } else {
      console.log(
        `快照保留策略：最近 ${plan.keepN} 份`
        + (keepMatch.length ? ` + 匹配 ${keepMatch.map((p) => `"${p}"`).join(' / ')} 的全部` : '')
        + `\n共 ${plan.total} 份 → 保留 ${plan.keep.length}，删除 ${plan.drop.length}\n`,
      );
      if (plan.keep.length) {
        console.log('保留：');
        for (const s of plan.keep) console.log(`  · ${s.id}  ${s.why}`);
      }
      if (plan.drop.length) {
        console.log('\n将删除：');
        for (const s of plan.drop) {
          const when = s.createdAt ? s.createdAt.replace('T', ' ').slice(0, 19) : '?';
          console.log(`  ✗ ${s.id}  ${when}  ${s.label ?? ''}`);
        }
      }
    }

    if (!plan.drop.length) {
      if (!flags.has('--json')) console.log('\n没有需要删除的快照。');
      return 0;
    }
    if (!flags.has('--yes')) {
      if (!flags.has('--json')) console.log('\n这是预演，没有删除任何东西。确认请加 --yes 重跑。');
      return 0;
    }

    const res = deleteSnapshots(plan.drop.map((s) => s.id));
    console.log(`\n已删除 ${res.removed.length} 份快照（在 ${res.root} 内）`);
    for (const r of res.removed) console.log(`  ✗ ${r.id}`);
    for (const r of res.refused) console.error(`  拒绝 ${r.id}：${r.why}`);
    return res.refused.length ? 1 : 0;
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

// ───────────────────────────── asar ─────────────────────────────
//
// 只读地读「真正在跑的那份代码」。实测结论：app.asar 内的包、
// profiles/node_modules/@deepseek-ai/*（junction 到本地构建树）、以及
// D:\Z1848\deepseek-harness 源码仓库，三者可能是**不同版本**；
// 只有 app.asar 里那份是运行中的 Electron 应用真正加载的。
// 所以排查「某个行为/字符串到底出自哪份产物」必须用这里，而不是读源码仓库。

function cmdAsar({ flags, positional, opts }) {
  const P = resolvePaths();
  const asarPath = opts.file ?? P.asar;
  if (!fs.existsSync(asarPath)) { console.error(`找不到归档：${asarPath}`); return 2; }

  const sub = positional[1] ?? 'ls';
  const json = flags.has('--json');
  const limit = Number(opts.limit) || (sub === 'ls' ? 200 : 20);
  const { header, jsonLen, pickleSize } = readAsarHeader(asarPath);

  if (sub === 'ls') {
    const all = listAsarPaths(header);
    const src = positional[2];
    if (!src) {
      const buckets = new Map();
      for (const p of all) {
        const key = p.split('/').filter(Boolean).slice(0, 2).join('/');
        buckets.set(key, (buckets.get(key) ?? 0) + 1);
      }
      const rows = [...buckets.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
      if (json) {
        process.stdout.write(`${JSON.stringify({ archive: asarPath, total: all.length, buckets: Object.fromEntries(rows) }, null, 2)}\n`);
        return 0;
      }
      console.log(asarPath);
      console.log(`  条目 ${all.length}  ·  JSON 头 ${(jsonLen / 1048576).toFixed(1)}MB  ·  pickleSize ${pickleSize}\n`);
      for (const [k, v] of rows) console.log(`  ${pad(k, 44)} ${String(v).padStart(6)}`);
      console.log('\n  用 `asar ls <正则>` 精确列出条目');
      return 0;
    }
    let re;
    try { re = new RegExp(src); } catch (e) { console.error(`正则非法：${e.message}`); return 2; }
    const hits = all.filter((p) => re.test(p));
    if (json) {
      process.stdout.write(`${JSON.stringify({ total: all.length, matched: hits.length, paths: hits.slice(0, limit) }, null, 2)}\n`);
      return 0;
    }
    for (const p of hits.slice(0, limit)) console.log(p);
    console.log(`\n匹配 ${hits.length} / ${all.length}${hits.length > limit ? `（只显示前 ${limit} 条，用 --limit 调整）` : ''}`);
    return 0;
  }

  if (sub === 'cat') {
    const entry = positional[2];
    if (!entry) { console.error('用法：asar cat <归档内路径> [--out 文件]'); return 2; }
    const buf = readAsarEntry(asarPath, entry);
    if (buf === null) { console.error(`归档内没有该条目（或它是目录）：${entry}`); return 2; }
    if (opts.out) { fs.writeFileSync(opts.out, buf); console.log(`已写出 ${buf.length} 字节 → ${opts.out}`); return 0; }
    process.stdout.write(buf);
    if (buf.length && buf[buf.length - 1] !== 0x0a) process.stdout.write('\n');
    return 0;
  }

  if (sub === 'grep') {
    const src = positional[2];
    if (!src) { console.error('用法：asar grep <正则> [--limit N] [--json]'); return 2; }
    let re;
    try { re = new RegExp(src); } catch (e) { console.error(`正则非法：${e.message}`); return 2; }
    const hits = grepAsarContent(asarPath, re, { limit });
    if (json) { process.stdout.write(`${JSON.stringify(hits, null, 2)}\n`); return hits.length ? 0 : 1; }
    if (!hits.length) { console.log(`未命中：${src}`); return 1; }
    for (const h of hits) console.log(`${h.path}:${h.line}\n  ${h.text}`);
    console.log(`\n命中 ${hits.length} 处（上限 ${limit}）`);
    return 0;
  }

  console.error(`未知子命令：asar ${sub}\n可用：asar ls [正则] | asar cat <路径> [--out 文件] | asar grep <正则>`);
  return 2;
}

// ─────────────────────────── precheck ───────────────────────────
//
// desktop profile 被 Electron 独占，CLI 拒绝 dump/boot，所以「改完会不会炸」
// 只能靠隔离探针家 + Electron-as-Node 跑 asar 内那份 bin.js 来预检。

function cmdPrecheck({ flags, opts }) {
  const json = flags.has('--json');
  const mode = flags.has('--default-only') ? 'dump-default-config' : 'dump-config';
  const patches = opts.patch ?? [];
  const profilePackageJson = opts.profileJson ?? null;

  let r;
  try {
    r = runPrecheck({ patches, mode, fresh: flags.has('--fresh'), profilePackageJson });
  } catch (err) {
    console.error(`预检无法执行：${err?.message ?? err}`);
    return 2;
  }

  if (json) {
    process.stdout.write(`${JSON.stringify({
      ok: r.ok,
      mode,
      patches,
      profilePackageJson: r.probe.override,
      status: r.run.status,
      entries: r.entries,
      problems: r.problems,
      notes: r.notes,
      other: r.other,
      diff: r.diff,
      saved: r.saved,
      keptBaseline: r.keptBaseline,
      dumpPath: r.dumpPath,
      failedPath: r.failedPath,
    }, null, 2)}\n`);
    return r.ok ? 0 : 1;
  }

  const P = r.probe.P;
  console.log(`组合预检 · 探针 profile=${PROBE_PROFILE}（隔离，真实 $DSH_HOME 只读） ← 真实 profile=${P.profile}`);
  console.log(`  归档      ${P.asar}`);
  console.log(`  探针家    ${r.probe.probeHome}`);
  console.log(`  模式      ${mode}${patches.length ? `  + ${patches.length} 个 --patch 覆盖层` : ''}`);
  console.log(`  复制      ${r.probe.copied.join(' / ')}`);
  if (r.probe.override) {
    console.log(`  ⚠ 候选清单 package.json 来自 ${r.probe.override}（不是真实 profile 的那一份）`);
  }
  for (const l of r.probe.links) console.log(`  junction  ${pad(l.name, 22)} ${l.result}`);
  console.log(`  退出码    ${r.run.status}`);
  console.log(`  条目数    ${r.entries}`);
  console.log(`  问题      ${r.problems.length}`);
  for (const p of r.problems) console.log(`    ${TAG.error} [${p.kind}] ${p.text}`);
  if (r.notes.length) {
    console.log(`  提醒      ${r.notes.length} 条（schema 层面的宽松校验提示，不阻塞）`);
    for (const n of r.notes.slice(0, 5)) console.log(`    ${TAG.info} ${n}`);
  }
  if (r.other.length) {
    console.log(`  其它输出  ${r.other.length} 行（既不是问题也不是提醒，未计入结论）`);
    for (const o of r.other.slice(0, 5)) console.log(`    ${TAG.info} ${o}`);
  }

  if (!r.saved) {
    console.log('\n本次没有产出可用的 dump，所以**没有**动上一条基线（否则下次就没得比了）。');
    console.log(`本次的原始输出  ${r.failedPath}`);
  } else if (r.diff === null) {
    console.log('\n（首次预检，没有可比对的上一次结果；本次结果已保存为基线）');
  } else if (r.diff.count === 0) {
    console.log('\n与上一次预检相比：组合结果完全一致');
  } else {
    console.log(`\n与上一次预检相比：${r.diff.added.length} 新增 / ${r.diff.removed.length} 移除 / ${r.diff.changed.length} 修改`);
    for (const id of r.diff.added) console.log(`    + 条目 ${id}`);
    for (const id of r.diff.removed) console.log(`    - 条目 ${id}`);
    for (const c of r.diff.changed) {
      console.log(`    ~ 条目 ${c.id}`);
      for (const l of c.removed) console.log(`        - ${l.trim()}`);
      for (const l of c.added) console.log(`        + ${l.trim()}`);
    }
    if (r.diff.reordered) {
      console.log(`    ↕ 公共条目的顺序变了（顺序就是装载顺序）：${r.diff.reorderedIds.slice(0, 5).join(', ')}`
        + `${r.diff.reorderedIds.length > 5 ? ` 等 ${r.diff.reorderedIds.length} 个` : ''}`);
    }
  }

  console.log(r.saved ? `\n组合结果    ${r.dumpPath}` : `\n组合结果    基线未动，仍是 ${r.dumpPath}`);
  console.log(r.ok
    ? '结论：组合可用。profile 层的 cordis.patch.yml 没有热重载，需重启 DSH 才生效。'
    : '结论：组合有问题，先修掉上面列出的条目再重启 DSH。');
  return r.ok ? 0 : 1;
}

// ─────────────────────────── upgrade ───────────────────────────
//
// Harness 升级会整体替换 app.asar，L3 改动随之消失。这个命令回答三个问题：
// 升级发生了没有 / 哪些声明需要重打 / 重打前还有什么必须先修。

const STATE_LABEL = {
  applied: '已应用',
  absent: '未应用（或已被覆盖）',
  partial: '只应用了一半（异常）',
  unknown: '无法判断',
  error: '声明解析失败',
};

const L0_LABEL = {
  applied: '声明与现场一致（升级幸存，无需重打）',
  drift: '声明与现场不一致（漂移）',
  absent: '现场 cordis.patch.yml 里没有这一条',
  error: '声明解析失败',
};

// ── upgrade --stage：把「重打」这一步真的做掉（但不落盘）──
//
// 铁律是「写安装包必须由人挑时间」，构建不在这条铁律里：vendor/whale/build.mjs
// 只读安装目录、只写 state/staged/，所以 Harness 开着也能跑。把构建自动化之后，
// 升级后剩下的人工动作就只有「退出 → install --yes → 回来写基线」。
//
// 两个刻意的决定：
//   ① 素材过期时**直接不构建**。构建器自己也会拦（那是最后一道），但跑到一半才
//      失败不如现在就说清楚：`action: patch` 的 source 必须与升级后归档逐字节相同。
//   ② --json 下必须把子进程输出**捕获**而不是继承 —— 否则构建自己的 stdout 会插进
//      我们正在写的 JSON 文档里，把机器可读输出弄坏（这类坏法很难看出来）。
function runStageBuild(r, ids, quiet) {
  if (!ids.length) {
    return { attempted: false, ok: true, ids: [], reason: '没有需要重打的声明' };
  }
  if (r.stale.length) {
    return {
      attempted: false,
      ok: false,
      ids,
      reason: `${r.stale.length} 条声明的原始素材已过期（action: patch 的 source 与升级后的归档不是逐字节相同）—— 先重新抽取素材，再谈重打`,
    };
  }
  const build = path.join(PROJECT_ROOT, 'vendor', 'whale', 'build.mjs');
  const t0 = Date.now();
  const run = spawnSync(process.execPath, [build], {
    cwd: PROJECT_ROOT,
    env: process.env,
    stdio: quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    maxBuffer: 16 * 1024 * 1024,
  });
  const ms = Date.now() - t0;
  const tail = (b) => String(b ?? '').slice(-4096);
  if (run.error) {
    return { attempted: true, ok: false, ids, ms, reason: `构建没能启动：${run.error.message}` };
  }
  if (run.status !== 0) {
    return {
      attempted: true, ok: false, ids, ms, code: run.status,
      reason: `构建失败（退出码 ${run.status}）`,
      stdout: quiet ? tail(run.stdout) : undefined,
      stderr: quiet ? tail(run.stderr) : undefined,
    };
  }
  return {
    attempted: true, ok: true, ids, ms, code: 0,
    stdout: quiet ? tail(run.stdout) : undefined,
  };
}

async function cmdUpgrade({ flags }) {
  const r = await runUpgradeCheck({ hash: !flags.has('--no-hash') });
  const stageIds = [...r.needsReapply, ...(r.neverApplied ?? [])];
  const stage = flags.has('--stage') ? runStageBuild(r, stageIds, flags.has('--json')) : null;

  if (flags.has('--json')) {
    const { patches, ...rest } = r;
    process.stdout.write(`${JSON.stringify({
      ...rest,
      patches: patches.map((p) => ({ ...p, staleSources: p.staleSources })),
      plan: reapplyPlan(stageIds),
      staged: stage,
    }, null, 2)}\n`);
    if (stage && !stage.ok) return 1;
    return r.ok ? 0 : 1;
  }

  console.log(`deepseek-up-T · 升级检测   profile=${r.current.profile}`);
  console.log(`  安装目录  ${r.current.installDir}`);
  console.log(`  DSH_HOME  ${r.current.home}`);
  if (r.hasBaseline) {
    console.log(`  基线      ${r.baselineFile}`);
    console.log(`            采集于 ${r.baselineCapturedAt?.replace('T', ' ').slice(0, 19) ?? '?'}`);
  } else {
    console.log(`  基线      还没有。先跑 \`node src/cli.mjs baseline write\`，之后才谈得上「变了没有」。`);
  }

  const c = r.changes;
  const mark = (changed) => (changed === null ? '(无法判断)' : changed ? '★ 变了' : '未变');
  console.log('\n── 变更 ──');
  console.log(`  Harness 版本     ${pad(c.version.from ?? '?', 14)} → ${pad(c.version.to ?? '?', 14)} ${mark(c.version.changed)}`);
  const asarNote = c.asar.basis === 'size' ? '   （按大小比较：--no-hash 跳过了 sha256）' : '';
  console.log(`  app.asar 大小    ${pad(human(c.asar.fromBytes), 14)} → ${pad(human(c.asar.toBytes), 14)} ${mark(c.asar.changed)}${asarNote}`);
  console.log(`  app.asar sha256  ${pad(c.asar.fromHash?.slice(0, 16) ?? '(未算)', 14)} → ${pad(c.asar.toHash?.slice(0, 16) ?? '(未算)', 14)}`);
  console.log(`  profile bundles  ${pad(c.bundles.from.length, 14)} → ${pad(c.bundles.to.length, 14)} ${mark(Boolean(c.bundles.added.length || c.bundles.removed.length))}`);
  for (const b of c.bundles.added) console.log(`        + ${b}`);
  for (const b of c.bundles.removed) console.log(`        - ${b}`);
  console.log(`  当前是未改造原版？ ${r.pristine === null ? (c.asar.basis === 'size' ? '无法判断（--no-hash 跳过了逐字节比对）' : '无法判断') : r.pristine ? '是（app.asar 与原版备份逐字节相同）' : '否（安装包已被改造过）'}`);

  const l3 = r.patches.filter((p) => p.layer === 'L3');
  const l0 = r.patches.filter((p) => p.layer === 'L0');

  console.log('\n── L3 补丁声明（写在安装包层，升级会被覆盖）──');
  if (!l3.length) console.log('  （没有 L3 声明）');
  for (const p of l3) {
    if (p.error) { console.log(`  ${TAG.error} ${p.id}  ${p.error}`); continue; }
    const kinds = `${p.replaceCount} 换 / ${p.patchCount} 补 / ${p.insertCount} 增`;
    const label = STATE_LABEL[p.state] ?? p.state;
    const tag = p.state === 'applied' ? TAG.ok : p.state === 'unknown' ? TAG.info : TAG.warn;
    console.log(`  ${tag} ${pad(p.id, 22)} ${pad(p.name, 26)} ${pad(kinds, 20)} ${label}`);
    if (p.missingInserts?.length) {
      console.log(`         ${' '.repeat(22)}↳ 归档里缺少：${p.missingInserts.join(', ')}`);
    }
    for (const s of p.staleSources ?? []) {
      console.log(`         ${' '.repeat(22)}⚠ 原版素材过期：${s.path} —— ${s.why}`);
    }
  }

  console.log('\n── L0 补丁声明（写在 profile 层，升级幸存）──');
  if (!l0.length) console.log('  （没有 L0 声明）');
  for (const p of l0) {
    const tag = p.state === 'applied' ? TAG.ok : p.state === 'error' ? TAG.error : TAG.warn;
    console.log(`  ${tag} ${pad(p.id, 22)} ${pad(p.name, 26)} ${L0_LABEL[p.state] ?? p.state}`);
    if (p.state === 'drift') {
      console.log('         ↳ 声明与现场不一致，说明有人直接改了 cordis.patch.yml 而没回头改声明：');
      for (const l of p.declConfig ?? []) console.log(`             声明  ${l}`);
      for (const l of p.liveConfig ?? []) console.log(`             现场  ${l}`);
    }
    if (p.error) console.log(`         ↳ ${p.error}`);
  }
  if (l0.length) {
    console.log('  这些不需要重打：它们随 profile 目录走，Harness 升级不覆盖它们。');
  }

  const VERDICT = {
    unchanged: '没有检测到 Harness 升级，也没有检测到安装包被改动。',
    upgraded: `**Harness 版本变了**（${c.version.from} → ${c.version.to}）：安装包被整体替换，L3 改动需要重打。`,
    'asar-changed': '版本号没变，但 app.asar 内容变了：要么升级被热修过，要么有人直接改过安装包。',
    'profile-changed': 'profile 的 bundle 组合变了（不是安装包升级）。',
    'profile-drift': '安装包没变，但 profile 层的声明与现场对不上了（见上）。',
    'no-baseline': '还没有基线，无从比较。',
  };
  console.log(`\n结论：${VERDICT[r.verdict] ?? r.verdict}`);

  // 暂存产物。它跟「升级检测」是两件事：升级检测比的是「在用安装包 vs 基线」，
  // 而暂存包根本不在那个比较里 ⇒ 「构建了但没落盘」会完全不可见（这件事上个月真的发生过：
  // 一份含重播修复的暂存包在磁盘上等了一整天，而报告一直是「没检测到任何变化」）。
  if (r.staged && (r.staged.status === 'pending' || r.staged.status === 'behind')) {
    const s = r.staged;
    const d = s.deltaBytes;
    const size = d === null || d === 0 ? '' : `（${d > 0 ? '大' : '小'} ${Math.abs(d)} 字节）`;
    console.log(`\n暂存产物：${s.why}${size}`);
    console.log(`  ${s.file}`);
    if (s.status === 'pending') {
      console.log('  它还没进安装目录 —— 落盘要先把 Harness 完全退出（托盘 → Quit）：');
      console.log('    node vendor/whale/install.mjs --yes');
    } else {
      console.log('  别拿它落盘：先 node vendor/whale/build.mjs 重新构建。');
    }
  }

  if (r.needsReapply.length) {
    console.log(`\n已被升级覆盖、需要重打的声明（${r.needsReapply.length}）：${r.needsReapply.join(', ')}`);
  }
  if (r.neverApplied?.length) {
    console.log(`\n尚未落盘（不是被升级覆盖，而是从来没做过）（${r.neverApplied.length}）：${r.neverApplied.join(', ')}`);
    console.log('  安装包没变，所以这些不是「重打」，是「可以开始做」：');
    console.log('  node vendor/whale/build.mjs 然后 node vendor/whale/install.mjs --yes（需先完全退出 Harness）。');
  }
  if (r.stale.length) {
    console.log(`\n重打前必须先修素材（${r.stale.length} 条声明）：`);
    console.log('  `action: patch` 的 source 必须与升级后归档里的那一份逐字节相同，');
    console.log('  否则构建会被守卫拦下（这是故意的：拿旧素材打补丁会静默丢掉新版本代码）。');
    console.log('  重新抽取：node src/cli.mjs asar cat <归档内路径> --out <source>');
  }
  if (r.needsReapply.length || r.stale.length) {
    console.log('\n重打步骤：');
    for (const l of reapplyPlan(r.needsReapply)) console.log(`  ${l}`);
  }
  if (stage) {
    console.log('\n── 重打（构建）──');
    if (!stage.attempted) {
      console.log(stage.ok
        ? `  ${TAG.info} 不需要构建：${stage.reason}。`
        : `  ${TAG.warn} 先不构建：${stage.reason}`);
    } else if (stage.ok) {
      console.log(`  ${TAG.ok} 已构建到 state/staged/app.asar（${(stage.ms / 1000).toFixed(1)}s），差异集合按声明核对通过`);
      console.log(`  涉及声明：${stage.ids.join(', ')}`);
      console.log('  构建只写了 state/staged/，没碰安装目录 —— 落盘仍然由你挑时间：');
      console.log('    1) 完全退出 Harness    node vendor/whale/install.mjs --yes');
      console.log('    2) 回到命令行          node src/cli.mjs baseline write');
      console.log('       （基线必须在落盘之后写：提前写会把「还没装上的状态」固化成基线）');
    } else {
      console.log(`  ${TAG.error} ${stage.reason}`);
      if (stage.stderr) console.log(`         ${stage.stderr.trim().split('\n').slice(-1)[0]}`);
    }
  }
  if (r.l0Drift?.length) {
    console.log(`\nL0 声明需要对齐（${r.l0Drift.length}）：${r.l0Drift.join(', ')}`);
    console.log('  把 patches/*.yml 的 config 块改成与现场一致，或把现场改回声明。');
    console.log('  两者不一致时，声明就不再是「权威描述」——这正是要靠升级检测发现的漂移。');
  }
  if (stage && !stage.ok) return 1;
  return r.ok ? 0 : 1;
}

// ───────────────────────────── accept ─────────────────────────────
//
// 落盘改完、重启之后要核对的东西分散在四处（L3 声明 / L0 声明 / 宿主路由 / 渲染层握手），
// 人手里只有一张从记忆里抄来的清单。这条命令把清单变成固定的判据 —— 只读，不写盘。
// 观感类项目标 MANUAL 且不计入退出码：把需要人眼的项算成失败，就是教人忽略失败。

async function cmdAccept({ flags, opts }) {
  const r = await runAccept({
    hash: !flags.has('--no-hash'),
    url: opts.url ?? process.env.DSH_WEB_URL,
  });
  if (flags.has('--json')) {
    process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
  } else {
    console.log(printAccept(r));
  }
  return r.ok ? 0 : 1;
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
  snapshot prune          快照保留策略（默认只预演；--keep N / --keep-match GLOB / --yes）
  baseline write          把当前事实固化为 state/baseline.json
  upgrade                 升级检测：Harness 升级后哪些 L3 改动需要重打、素材是否过期
                          （--stage 顺带把构建做掉；落盘仍由人挑时间）
  precheck                组合预检：隔离探针家里 dump 出权威组合结果（真实 profile 只读）
  asar ls [正则]          列安装包条目（无正则时按顶层目录汇总）
  asar cat <路径>         读出安装包里单个条目的内容（--out 落盘）
  asar grep <正则>        在安装包内容里检索（只扫文本类条目）
  accept                  重启后验收：L3/L0 声明、宿主路由、渲染层握手一次问完
                          （只读；观感类项标 MANUAL 且不计入退出码）

选项
  --json                  机器可读输出
  --url <地址>            accept：探针地址（默认 $DSH_WEB_URL 或 http://127.0.0.1:19387）
  --no-hash               doctor / upgrade：跳过 121MB 安装包的 sha256（更快；upgrade 会退回按大小比较）
  --stage                 upgrade：把需要重打的声明真的构建到 state/staged/app.asar
                          （只写 state/，不碰安装目录，Harness 开着也能跑）
  --limit N               asar ls / grep 的结果上限
  --out 文件              asar cat 落盘目标
  --file <asar>           覆盖要读的归档路径
  --patch <文件>          预检：叠加一个额外 patch 层（可重复）
  --profile-json <文件>   预检：用候选 package.json 顶替真实 profile 的那一份
                          （用来在落盘前试「再加一个 bundle 会不会炸」）
  --default-only          预检：只 dump bundle 层（--dump-default-config）
  --fresh                 预检：先删掉重建探针家

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
    case 'upgrade': case 'up': return cmdUpgrade(parsed);
    case 'precheck': case 'pre': return cmdPrecheck(parsed);
    case 'asar': return cmdAsar(parsed);
    case 'accept': return cmdAccept(parsed);
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
