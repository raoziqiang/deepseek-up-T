// deepseek-up-T :: 项目 skill 的离线单测
//
// 为什么要有它：skill 的正文真源是仓库里的 `.dsh/skills/deepseek-up-t/SKILL.md`，
// 靠两条 junction 暴露给 skill 发现机制。这条链路有两个静默失败模式：
//   1. frontmatter 不合规 —— skill 会被**静默丢弃**（模型目录不会收到任何逐 skill 诊断，
//      分不清「skill 不存在」和「skill 无效」）；
//   2. 正文里引用的文档被改名/删掉 —— 模型照着指引去读会读到空气。
// 两者都不会报错，所以必须在离线钉死。
//
// 契约来自 `@deepseek-ai/dsh-skill-filesystem` 的 README：
//   · 只认扫描根**顶层**的 `<name>/SKILL.md` 或 `<name>.md`，**刻意不支持**嵌套 `**/SKILL.md`
//   · frontmatter 必填 `name`（kebab-case）与 `description`
//   · 可选 `whenToUse` / `metadata` / `disable-model-invocation` / `user-invocable`，
//     后两个按严格布尔语法解析，非法值会让整个 skill 被丢弃
//
//   node test/skill.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '..');
const WORKSPACE = path.resolve(PROJECT, '..');

const SKILL_NAME = 'deepseek-up-t';
const BUNDLE = path.join(PROJECT, '.dsh', 'skills', SKILL_NAME);
const SKILL_MD = path.join(BUNDLE, 'SKILL.md');

const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, err });
  }
}

// ── 读取 ────────────────────────────────────────────────────────

const src = fs.readFileSync(SKILL_MD, 'utf8');

/** 剥出 YAML frontmatter 的键值对（只处理本文件用到的扁平行）。 */
function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  if (!m) return null;
  const fields = {};
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const kv = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (kv) fields[kv[1]] = kv[2].trim();
  }
  return { raw: m[1], fields, body: text.slice(m[0].length) };
}

const fm = parseFrontmatter(src);

// ── 断言 ────────────────────────────────────────────────────────

check('skill bundle 在扫描根的顶层：<root>/<name>/SKILL.md', () => {
  assert.ok(fs.existsSync(SKILL_MD), `缺少 ${SKILL_MD}`);
  const parent = path.dirname(BUNDLE);
  assert.equal(path.basename(parent), 'skills', `bundle 的父目录应叫 skills，实际 ${parent}`);
  assert.equal(path.basename(BUNDLE), SKILL_NAME);
});

check('frontmatter 是文件的开头且能解析出来', () => {
  assert.ok(fm, '文件必须以 --- 开头的 YAML frontmatter 起始；缺失会让 skill 被静默丢弃');
  assert.ok(src.startsWith('---'), 'frontmatter 之前不能有任何内容（连空行都不行）');
});

check('frontmatter 有 name，且是 kebab-case、与目录名一致', () => {
  assert.ok(fm.fields.name, '缺少必填键 name');
  assert.match(
    fm.fields.name,
    /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/,
    `name 必须是 kebab-case，实际 ${JSON.stringify(fm.fields.name)}`,
  );
  assert.equal(fm.fields.name, SKILL_NAME, 'name 必须等于 bundle 目录名，否则发现阶段不认');
});

check('frontmatter 有非空 description', () => {
  assert.ok(fm.fields.description, '缺少必填键 description');
  assert.ok(fm.fields.description.length >= 20, 'description 太短，模型目录里没有区分度');
});

check('可选调用键写的是严格布尔值（非法拼写会让整个 skill 被丢弃）', () => {
  const allowed = new Set(['true', 'false', 'yes', 'no', 'on', 'off', '1', '0']);
  for (const key of ['disable-model-invocation', 'user-invocable']) {
    const v = fm.fields[key];
    if (v === undefined) continue;
    const bare = v.replace(/^["']|["']$/g, '').toLowerCase();
    assert.ok(allowed.has(bare), `${key}: ${v} 不是合法布尔拼写`);
  }
});

check('发现深度只有一层：skills 根下不存在嵌套的 SKILL.md', () => {
  const roots = [path.join(PROJECT, '.dsh', 'skills'), path.join(WORKSPACE, '.dsh', 'skills')];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const entry of fs.readdirSync(root)) {
      const inner = path.join(root, entry, 'SKILL.md');
      if (!fs.existsSync(inner)) continue;
      const nested = fs
        .readdirSync(path.join(root, entry), { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => path.join(root, entry, d.name, 'SKILL.md'))
        .filter((p) => fs.existsSync(p));
      assert.equal(nested.length, 0, `发现机制不支持嵌套 SKILL.md，但存在 ${nested.join(', ')}`);
    }
  }
});

check('两条 junction 都指向同一个真实目录（随仓库版本化的那一份）', () => {
  const links = [
    path.join(DSH_HOME, 'skills', SKILL_NAME),
    path.join(WORKSPACE, '.dsh', 'skills', SKILL_NAME),
  ];
  const real = fs.realpathSync(BUNDLE);
  for (const link of links) {
    assert.ok(fs.existsSync(link), `缺少 skill 链接 ${link}`);
    assert.equal(
      fs.realpathSync(link),
      real,
      `${link} 没有解析到仓库里的 bundle，而 skill 就会读到别处的陈旧副本`,
    );
  }
});

check('正文提到的关键命令都还在（防止文档与 CLI 漂移）', () => {
  for (const cmd of ['doctor', 'snapshot create', 'precheck', 'baseline write', 'upgrade']) {
    assert.ok(fm.body.includes(cmd), `正文没提到 \`${cmd}\`——CLI 改了而 skill 没跟上`);
  }
});

check('正文引用的项目内文档全部存在（防止指引读到空气）', () => {
  const PREFIXES = ['docs/', 'tracks/', 'patches/', 'vendor/', 'test/', 'plugins/', 'src/', '.dsh/'];
  const cited = new Set();
  for (const m of fm.body.matchAll(/`([A-Za-z0-9_./-]+)`/g)) {
    const p = m[1];
    if (!PREFIXES.some((pre) => p.startsWith(pre))) continue;
    if (p.includes('*') || p.includes('..')) continue; // 通配与范围写法不逐个校验
    cited.add(p);
  }
  // 通配（`patches/*.yml`）与范围（`tracks/T1..T5/README.md`）写法会被下面的过滤跳过，
  // 所以下限只钉「还有一批具体路径被认出来」这件事本身。
  assert.ok(cited.size >= 5, `只认出 ${cited.size} 条项目内引用，正则可能已经失效`);
  const missing = [...cited].filter((p) => !fs.existsSync(path.join(PROJECT, p)));
  assert.deepEqual(missing, [], `正文引用了不存在的路径：${missing.join(', ')}`);
});

// ── 汇总 ────────────────────────────────────────────────────────

const failed = results.filter((r) => !r.ok);
for (const r of results) {
  console.log(`${r.ok ? '  ok  ' : ' FAIL '} ${r.name}`);
  if (!r.ok) console.log(`        ${r.err?.message ?? r.err}`);
}
console.log('');
if (failed.length) {
  console.log(`skill 单测失败：${failed.length}/${results.length}`);
  process.exit(1);
}
console.log(`skill 单测通过：${results.length}/${results.length} 项`);
