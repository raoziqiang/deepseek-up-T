// deepseek-up-T :: 项目笔记（memory）的只读浏览与契约检查
//
// `.dsh/skills/up-t-memory/SKILL.md` 写了「存哪儿 / 何时写 / 不许写」，但只是一段文字：
// 写错了没人知道。这里把其中能机械判定的部分落成判据，`dsht memory lint` 与
// `modules/memory` 共用同一份，免得两处各说各话。
//
// 只读：本文件不写任何笔记。零 npm 依赖。

import fs from 'node:fs';
import path from 'node:path';

import { PROJECT_ROOT, dshHome } from './paths.mjs';

/** 一主题一文件；文件名 kebab-case。 */
export const TOPIC_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** 目录里的说明文件，不算笔记。 */
const NON_NOTES = new Set(['README.md']);

/** 超过这个体积多半是「把多个主题塞进一个文件」或「复制了文档正文」。 */
export const NOTE_SIZE_WARN = 16 * 1024;

/**
 * 「不许写」里能机械识别的那部分：密钥、令牌、私钥。
 * 宁可漏报也不要误报一大片 —— 误报多了，人就学会忽略 lint。
 */
export const SECRET_PATTERNS = [
  { id: 'private-key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { id: 'openai-style-key', re: /\bsk-[A-Za-z0-9_-]{20,}/ },
  { id: 'github-token', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{30,}/ },
  { id: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: 'slack-token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { id: 'bearer-token', re: /\bBearer\s+[A-Za-z0-9._~+/-]{24,}=*/ },
  {
    id: 'credential-assignment',
    // api_key = "…" / password: … / token=…：值是 ≥12 个 ASCII 令牌字符、且字母数字都有。
    // 「token: 见 docs/…」「password: true」「api_key: <你的>」这类说明文字不算。
    re: /\b(?:api[_-]?key|secret|password|passwd|token)\s*[:=]\s*["']?(?=[A-Za-z0-9._~+/=-]*[0-9])(?=[A-Za-z0-9._~+/=-]*[A-Za-z])[A-Za-z0-9._~+/=-]{12,}/i,
  },
];

export function memoryRoots({ projectRoot = PROJECT_ROOT, home = dshHome() } = {}) {
  return {
    project: path.join(projectRoot, 'memory', 'project', 'topics'),
    global: path.join(home, 'up-t', 'memory'),
  };
}

/** 第一条 `# 标题`（跳过 frontmatter 与空行）；没有则 null。 */
export function noteTitle(text) {
  let body = String(text ?? '');
  const fm = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(body);
  if (fm) body = body.slice(fm[0].length);
  for (const line of body.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    const m = /^#\s+(.+?)\s*#*\s*$/.exec(t);
    return m ? m[1] : null;
  }
  return null;
}

/**
 * 对一条笔记做契约检查。
 * @param {string} fileName  basename，如 `module-host.md`
 * @param {string} text
 * @returns {{ level: 'error'|'warn', code: string, message: string, line?: number }[]}
 */
export function lintNote(fileName, text) {
  const issues = [];
  const base = String(fileName);
  if (!base.endsWith('.md')) {
    issues.push({ level: 'error', code: 'not-markdown', message: '笔记必须是 .md 文件' });
  } else if (!TOPIC_RE.test(base.slice(0, -3))) {
    issues.push({
      level: 'error',
      code: 'topic-name',
      message: `文件名应为 kebab-case（如 module-host.md），实际 ${base}`,
    });
  }

  const src = String(text ?? '');
  if (!src.trim()) {
    issues.push({ level: 'error', code: 'empty', message: '空笔记：没有内容就别留文件' });
    return issues;
  }
  if (noteTitle(src) === null) {
    issues.push({ level: 'warn', code: 'no-title', message: '第一行非空内容应是 `# 标题`' });
  }
  if (Buffer.byteLength(src, 'utf8') > NOTE_SIZE_WARN) {
    issues.push({
      level: 'warn',
      code: 'too-large',
      message: `超过 ${NOTE_SIZE_WARN / 1024} KB：可能塞了多个主题，或复制了文档正文（笔记应指向文档）`,
    });
  }

  const lines = src.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    for (const p of SECRET_PATTERNS) {
      if (p.re.test(lines[i])) {
        issues.push({
          level: 'error',
          code: `secret:${p.id}`,
          message: `疑似凭据（${p.id}）：笔记里不许写密钥/令牌`,
          line: i + 1,
        });
      }
    }
  }
  return issues;
}

/**
 * 列出某个目录下的笔记（不递归；README.md 不算）。目录不存在 → 空数组。
 * @returns {{ scope: string, topic: string, file: string, title: string|null, bytes: number, mtime: string }[]}
 */
export function listNotes(dir, scope) {
  let names;
  try {
    names = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    if (err?.code === 'ENOENT') return [];
    throw err;
  }
  const out = [];
  for (const d of names) {
    if (!d.isFile() || NON_NOTES.has(d.name)) continue;
    const file = path.join(dir, d.name);
    const st = fs.statSync(file);
    const text = d.name.endsWith('.md') ? fs.readFileSync(file, 'utf8') : '';
    out.push({
      scope,
      topic: d.name.replace(/\.md$/, ''),
      file,
      title: noteTitle(text),
      bytes: st.size,
      mtime: st.mtime.toISOString(),
    });
  }
  return out.sort((a, b) => a.topic.localeCompare(b.topic));
}

export function listAllNotes(roots = memoryRoots()) {
  return [...listNotes(roots.project, 'project'), ...listNotes(roots.global, 'global')];
}

/**
 * 按主题名找笔记。项目范围优先（与 skill 一致：项目约定比个人偏好更具体）。
 * @param {'project'|'global'|undefined} scope  显式限定范围
 */
export function findNote(topic, { roots = memoryRoots(), scope } = {}) {
  const t = String(topic ?? '').replace(/\.md$/, '');
  if (!TOPIC_RE.test(t)) return { error: `主题名非法：${JSON.stringify(topic)}（应为 kebab-case）` };
  const order = scope ? [scope] : ['project', 'global'];
  for (const s of order) {
    if (!(s in roots)) return { error: `未知范围：${s}（project | global）` };
    const file = path.join(roots[s], `${t}.md`);
    if (fs.existsSync(file)) return { scope: s, topic: t, file, text: fs.readFileSync(file, 'utf8') };
  }
  return { error: `没有主题 ${t}（查过：${order.join(', ')}）` };
}

/**
 * 全量检查。另外报一条跨文件的问题：同一主题在两个范围都有（以哪份为准不清楚）。
 * @returns {{ ok: boolean, notes: number, results: { scope: string, file: string, issues: object[] }[], errors: number, warns: number }}
 */
export function lintAll(roots = memoryRoots()) {
  const notes = listAllNotes(roots);
  const results = [];
  for (const n of notes) {
    const text = fs.readFileSync(n.file, 'utf8');
    const issues = lintNote(path.basename(n.file), text);
    results.push({ scope: n.scope, file: n.file, topic: n.topic, issues });
  }
  const byTopic = new Map();
  for (const r of results) {
    if (!byTopic.has(r.topic)) byTopic.set(r.topic, []);
    byTopic.get(r.topic).push(r);
  }
  for (const [topic, rs] of byTopic) {
    if (rs.length > 1) {
      for (const r of rs) {
        if (r.scope !== 'global') continue;
        r.issues.push({
          level: 'warn',
          code: 'shadowed',
          message: `项目范围也有 ${topic}.md：读取时项目那份优先，这份被遮住`,
        });
      }
    }
  }
  let errors = 0;
  let warns = 0;
  for (const r of results) {
    for (const i of r.issues) {
      if (i.level === 'error') errors += 1;
      else warns += 1;
    }
  }
  return { ok: errors === 0, notes: notes.length, results, errors, warns };
}
