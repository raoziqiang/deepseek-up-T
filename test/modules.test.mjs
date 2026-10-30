// deepseek-up-T :: 模块宿主离线单测
//
// 钉死：坏配置拒绝、单模块失败隔离、mtime 变化只重启该模块、
// up-t-memory skill frontmatter 合规。不 boot Electron。
//
//   node test/modules.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '..');

const {
  parseUpTConfig,
  createModuleHost,
  runModulesOnce,
  CONFIG_NAME,
} = await import(pathToFileURL(path.join(PROJECT, 'src', 'modules.mjs')).href);

const results = [];
function check(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      return r.then(
        () => { results.push({ name, ok: true }); },
        (err) => { results.push({ name, ok: false, err }); },
      );
    }
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, err });
  }
  return undefined;
}

async function checkAsync(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, err });
  }
}

function writeTree(root, files) {
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body, 'utf8');
  }
}

// ── 配置解析 ────────────────────────────────────────────────────

check('合法配置：modules + 模块块', () => {
  const cfg = parseUpTConfig(`
modules:
  memory: true
memory: {}
`);
  assert.deepEqual(cfg.modules, { memory: true });
  assert.deepEqual(cfg.configs.memory, {});
});

check('未启用的模块仍有空配置对象', () => {
  const cfg = parseUpTConfig(`
modules:
  memory: false
`);
  assert.equal(cfg.modules.memory, false);
  assert.deepEqual(cfg.configs.memory, {});
});

check('未知顶层键直接失败', () => {
  assert.throws(
    () => parseUpTConfig('modules:\n  memory: true\nfoo: {}\n'),
    /未知键 foo/,
  );
});

check('缺少 modules 键直接失败', () => {
  assert.throws(() => parseUpTConfig('memory: {}\n'), /缺少必填键 modules/);
});

check('modules 写成标量直接失败', () => {
  assert.throws(() => parseUpTConfig('modules: true\n'), /必须是映射/);
});

// ── 宿主：隔离与热重载 ──────────────────────────────────────────

await checkAsync('单模块失败不拖垮其它已启用模块', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upt-mod-'));
  try {
    writeTree(root, {
      [CONFIG_NAME]: `modules:\n  good: true\n  bad: true\n`,
      'modules/good/module.mjs': `
export const name = 'good';
let n = 0;
export async function start() { n += 1; }
export async function stop() {}
export function started() { return n; }
export default { name, start, stop, started };
`,
      'modules/bad/module.mjs': `
export const name = 'bad';
export async function start() { throw new Error('boom'); }
export async function stop() {}
export default { name, start, stop };
`,
    });
    const host = createModuleHost({ projectRoot: root, pollMs: 0 });
    const status = await host.start();
    assert.equal(status.modules.good.status, 'started');
    assert.equal(status.modules.bad.status, 'failed');
    assert.match(status.modules.bad.error, /boom/);
    assert.equal(status.ok, false);
    await host.stop();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

await checkAsync('mtime 变化只重启该模块（其它模块 stop 次数不变）', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upt-mod-'));
  try {
    writeTree(root, {
      [CONFIG_NAME]: `modules:\n  alpha: true\n  beta: true\n`,
      'modules/alpha/module.mjs': `
export const name = 'alpha';
globalThis.__uptAlpha = globalThis.__uptAlpha || { start: 0, stop: 0 };
export async function start() { globalThis.__uptAlpha.start += 1; }
export async function stop() { globalThis.__uptAlpha.stop += 1; }
export default { name, start, stop };
`,
      'modules/beta/module.mjs': `
export const name = 'beta';
globalThis.__uptBeta = globalThis.__uptBeta || { start: 0, stop: 0 };
export async function start() { globalThis.__uptBeta.start += 1; }
export async function stop() { globalThis.__uptBeta.stop += 1; }
export default { name, start, stop };
`,
    });
    globalThis.__uptAlpha = { start: 0, stop: 0 };
    globalThis.__uptBeta = { start: 0, stop: 0 };

    const host = createModuleHost({ projectRoot: root, pollMs: 0 });
    await host.start();
    assert.equal(globalThis.__uptAlpha.start, 1);
    assert.equal(globalThis.__uptBeta.start, 1);

    // 只动 alpha 的入口 mtime（并改一点内容，确保 ?t= 缓存键变化且逻辑可辨）
    const alphaEntry = path.join(root, 'modules', 'alpha', 'module.mjs');
    fs.writeFileSync(alphaEntry, `
export const name = 'alpha';
globalThis.__uptAlpha = globalThis.__uptAlpha || { start: 0, stop: 0 };
export async function start() { globalThis.__uptAlpha.start += 1; }
export async function stop() { globalThis.__uptAlpha.stop += 1; }
export default { name, start, stop };
`, 'utf8');
    // Windows 上同一秒内 mtime 分辨率可能不够，显式拨快一点
    const st = fs.statSync(alphaEntry);
    fs.utimesSync(alphaEntry, st.atime, new Date(st.mtimeMs + 2000));

    await host.poll();
    assert.equal(globalThis.__uptAlpha.stop, 1, 'alpha 应被 stop 再 start');
    assert.equal(globalThis.__uptAlpha.start, 2);
    assert.equal(globalThis.__uptBeta.stop, 0, 'beta 不该被动');
    assert.equal(globalThis.__uptBeta.start, 1);

    await host.stop();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    delete globalThis.__uptAlpha;
    delete globalThis.__uptBeta;
  }
});

await checkAsync('真实项目 runModulesOnce：memory: started', async () => {
  const r = await runModulesOnce({ projectRoot: PROJECT });
  assert.ok(r.lines.some((l) => l === 'memory: started'), `实际行：${JSON.stringify(r.lines)}`);
  assert.equal(r.code, 0);
  assert.equal(r.status.modules.memory.status, 'started');
  assert.ok(fs.existsSync(path.join(PROJECT, 'memory', 'project', 'topics')));
});

// ── up-t-memory skill ───────────────────────────────────────────

check('up-t-memory skill frontmatter 合规且与目录名一致', () => {
  const skillDir = path.join(PROJECT, '.dsh', 'skills', 'up-t-memory');
  const skillMd = path.join(skillDir, 'SKILL.md');
  assert.ok(fs.existsSync(skillMd), `缺少 ${skillMd}`);
  const src = fs.readFileSync(skillMd, 'utf8');
  assert.ok(src.startsWith('---'), '必须以 frontmatter 开头');
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(src);
  assert.ok(m, 'frontmatter 解析失败');
  const fields = {};
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const kv = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (kv) fields[kv[1]] = kv[2].trim();
  }
  assert.equal(fields.name, 'up-t-memory');
  assert.match(fields.name, /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/);
  assert.ok(fields.description && fields.description.length >= 20);
  assert.ok(src.includes('memory/project/topics'), '正文应指向项目笔记目录');
  assert.ok(src.includes('docs/07-modules.md') || src.includes('up-t.config.yml'));
});

// ── 汇总 ────────────────────────────────────────────────────────

const failed = results.filter((r) => !r.ok);
for (const r of results) {
  console.log(`${r.ok ? '  ok  ' : ' FAIL '} ${r.name}`);
  if (!r.ok) console.log(`        ${r.err?.message ?? r.err}`);
}
console.log('');
if (failed.length) {
  console.log(`modules 单测失败：${failed.length}/${results.length}`);
  process.exit(1);
}
console.log(`modules 单测通过：${results.length}/${results.length} 项`);
