// deepseek-up-T :: 项目笔记浏览与契约检查的离线单测
//
// 钉死：文件名/标题/体积/疑似凭据的判据、说明文字不误报、README 不算笔记、
// 项目范围优先且遮住全局同名、CLI 退出码、memory 模块把 lint 结果记进宿主日志。
// 全部在临时目录里跑（DSH_HOME 指过去），不碰真实笔记。
//
//   node test/memory.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '..');
const CLI = path.join(PROJECT, 'src', 'cli.mjs');

const {
  lintNote, noteTitle, listNotes, findNote, lintAll, memoryRoots, NOTE_SIZE_WARN,
} = await import(pathToFileURL(path.join(PROJECT, 'src', 'memory.mjs')).href);

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, err });
  }
}

const codes = (issues) => issues.map((i) => i.code).sort();

function sandbox(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upt-mem-'));
  const home = path.join(root, 'dsh-home');
  const roots = memoryRoots({ projectRoot: root, home });
  fs.mkdirSync(roots.project, { recursive: true });
  fs.mkdirSync(roots.global, { recursive: true });
  for (const [rel, body] of Object.entries(files)) {
    const [scope, name] = rel.split('/');
    fs.writeFileSync(path.join(roots[scope], name), body, 'utf8');
  }
  return { root, home, roots, done: () => fs.rmSync(root, { recursive: true, force: true }) };
}

// ── 单条笔记判据 ────────────────────────────────────────────────

await check('合规笔记：零问题', () => {
  assert.deepEqual(lintNote('module-host.md', '# 模块宿主\n\n见 docs/07-modules.md。\n'), []);
});

await check('文件名不是 kebab-case → error', () => {
  assert.deepEqual(codes(lintNote('Module_Host.md', '# x\n')), ['topic-name']);
  assert.deepEqual(codes(lintNote('notes.txt', '# x\n')), ['not-markdown']);
});

await check('空笔记 → error；没有 # 标题 → warn', () => {
  assert.deepEqual(codes(lintNote('a.md', '  \n\n')), ['empty']);
  assert.deepEqual(codes(lintNote('a.md', '正文先行\n# 标题\n')), ['no-title']);
});

await check('frontmatter 之后的 # 标题也认', () => {
  assert.equal(noteTitle('---\nk: v\n---\n\n# 真标题\n'), '真标题');
  assert.deepEqual(lintNote('a.md', '---\nk: v\n---\n# 真标题\n'), []);
});

await check('体积超限 → warn', () => {
  const big = `# 大\n${'x'.repeat(NOTE_SIZE_WARN + 1)}\n`;
  assert.deepEqual(codes(lintNote('big.md', big)), ['too-large']);
});

await check('各类疑似凭据 → error，并带行号', () => {
  const cases = {
    'secret:private-key': '-----BEGIN RSA PRIVATE KEY-----',
    'secret:openai-style-key': `key 是 sk-${'a1'.repeat(15)}`,
    'secret:github-token': `ghp_${'A1'.repeat(18)}`,
    'secret:aws-access-key': 'AKIAABCDEFGHIJKLMNOP',
    'secret:credential-assignment': 'api_key = "abc123def456ghi"',
  };
  for (const [code, line] of Object.entries(cases)) {
    const issues = lintNote('s.md', `# 标题\n\n${line}\n`);
    const hit = issues.find((i) => i.code === code);
    assert.ok(hit, `${code} 没被识别：${JSON.stringify(issues)}`);
    assert.equal(hit.level, 'error');
    assert.equal(hit.line, 3);
  }
});

await check('说明文字不误报（lint 误报多了，人就学会忽略它）', () => {
  const prose = [
    '# 凭据放哪',
    '',
    'token: 见 docs/05-conventions.md',
    'password: true',
    'api_key: <你的密钥>',
    'secret = ${DSH_SECRET}',
    '令牌由 Provider 探针读取环境变量，不落盘。',
    'sk-learn 不是密钥',
  ].join('\n');
  assert.deepEqual(lintNote('creds.md', prose), []);
});

// ── 目录 / 范围 ────────────────────────────────────────────────

await check('listNotes：README.md 不算笔记；目录不存在 → 空', () => {
  const s = sandbox({ 'project/README.md': '# 说明\n', 'project/b.md': '# B\n', 'project/a.md': '# A\n' });
  try {
    const notes = listNotes(s.roots.project, 'project');
    assert.deepEqual(notes.map((n) => n.topic), ['a', 'b']);
    assert.equal(notes[0].title, 'A');
    assert.deepEqual(listNotes(path.join(s.root, 'nope'), 'project'), []);
  } finally { s.done(); }
});

await check('findNote：项目范围优先；--scope 能取到全局那份；非法主题名拒绝', () => {
  const s = sandbox({ 'project/dup.md': '# 项目版\n', 'global/dup.md': '# 全局版\n', 'global/only.md': '# 只在全局\n' });
  try {
    assert.equal(findNote('dup', { roots: s.roots }).scope, 'project');
    assert.equal(findNote('dup', { roots: s.roots, scope: 'global' }).text, '# 全局版\n');
    assert.equal(findNote('only.md', { roots: s.roots }).scope, 'global');
    assert.match(findNote('../etc/passwd', { roots: s.roots }).error, /主题名非法/);
    assert.match(findNote('missing', { roots: s.roots }).error, /没有主题 missing/);
  } finally { s.done(); }
});

await check('lintAll：同名遮蔽只在全局那份上报 warn；计数正确', () => {
  const s = sandbox({
    'project/dup.md': '# 项目版\n',
    'global/dup.md': '# 全局版\n',
    'project/Bad_Name.md': '# x\n',
  });
  try {
    const r = lintAll(s.roots);
    assert.equal(r.notes, 3);
    assert.equal(r.errors, 1);
    assert.equal(r.warns, 1);
    assert.equal(r.ok, false);
    const g = r.results.find((x) => x.scope === 'global');
    assert.deepEqual(codes(g.issues), ['shadowed']);
    const p = r.results.find((x) => x.scope === 'project' && x.topic === 'dup');
    assert.deepEqual(p.issues, []);
  } finally { s.done(); }
});

// ── CLI ────────────────────────────────────────────────────────

function cli(args, home) {
  return spawnSync(process.execPath, [CLI, 'memory', ...args], {
    encoding: 'utf8',
    env: { ...process.env, DSH_HOME: home },
  });
}

await check('CLI：lint 有 error → 退出码 1；只有 warn → 0；show 不存在 → 1', () => {
  // 项目范围用的是真实仓库目录（只读），所以凭据只往全局那份里放。
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'upt-mem-home-'));
  try {
    const g = path.join(home, 'up-t', 'memory');
    fs.mkdirSync(g, { recursive: true });

    fs.writeFileSync(path.join(g, 'no-title.md'), '正文\n', 'utf8');
    let r = cli(['lint'], home);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /0 个错误，1 个警告/);

    fs.writeFileSync(path.join(g, 'leak.md'), `# 泄露\nghp_${'Z9'.repeat(18)}\n`, 'utf8');
    r = cli(['lint', '--json'], home);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.equal(JSON.parse(r.stdout).errors, 1);

    r = cli(['show', 'leak', '--scope', 'global'], home);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^# 泄露/);

    r = cli(['show', 'missing'], home);
    assert.equal(r.status, 1);

    r = cli(['ls', '--json'], home);
    assert.equal(r.status, 0);
    const topics = JSON.parse(r.stdout).notes.filter((n) => n.scope === 'global').map((n) => n.topic);
    assert.deepEqual(topics, ['leak', 'no-title']);

    r = cli(['bogus'], home);
    assert.equal(r.status, 2);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

// ── 模块：lint 结果进宿主日志，且坏笔记不让模块 failed ───────────

await check('memory 模块：坏笔记只记 warn 日志，模块仍是 started', async () => {
  const { createModuleHost, CONFIG_NAME } = await import(pathToFileURL(path.join(PROJECT, 'src', 'modules.mjs')).href);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upt-mem-mod-'));
  const prevHome = process.env.DSH_HOME;
  process.env.DSH_HOME = path.join(root, 'dsh-home');
  try {
    fs.writeFileSync(path.join(root, CONFIG_NAME), 'modules:\n  memory: true\nmemory: {}\n', 'utf8');
    // 宿主按 projectRoot/modules/<name>/module.mjs 找入口；模块里相对 import 的 src/ 要一起在场。
    fs.cpSync(path.join(PROJECT, 'modules', 'memory'), path.join(root, 'modules', 'memory'), { recursive: true });
    fs.cpSync(path.join(PROJECT, 'src'), path.join(root, 'src'), { recursive: true });
    const topics = path.join(root, 'memory', 'project', 'topics');
    fs.mkdirSync(topics, { recursive: true });
    fs.writeFileSync(path.join(topics, 'leak.md'), '# x\n-----BEGIN PRIVATE KEY-----\n', 'utf8');

    const logs = [];
    const host = createModuleHost({ projectRoot: root, pollMs: 0, onLog: (e) => logs.push(e) });
    const status = await host.start();
    await host.stop();
    assert.equal(status.modules.memory.status, 'started', JSON.stringify(status));
    const lint = logs.find((e) => /memory lint/.test(e.message));
    assert.ok(lint, JSON.stringify(logs));
    assert.equal(lint.level, 'warn');
    assert.deepEqual(lint.extra, { notes: 1, errors: 1, warns: 0 });
    assert.ok(fs.existsSync(path.join(process.env.DSH_HOME, 'up-t', 'memory')));
  } finally {
    if (prevHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = prevHome;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── 汇总 ────────────────────────────────────────────────────────

const failed = results.filter((r) => !r.ok);
for (const r of results) {
  console.log(`${r.ok ? '  ok  ' : ' FAIL '} ${r.name}`);
  if (!r.ok) console.log(`        ${r.err?.message ?? r.err}`);
}
console.log('');
if (failed.length) {
  console.log(`memory 单测失败：${failed.length}/${results.length}`);
  process.exit(1);
}
console.log(`memory 单测通过：${results.length}/${results.length} 项`);
