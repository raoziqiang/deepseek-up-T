// deepseek-up-T :: cordis.patch.yml / cordis.yml 结构扫描
//
// 定位：这是**结构扫描**，不是完整 YAML 解析器。它只回答体检需要的几个问题：
// 顶层是不是数组、有哪些条目、id 有没有重复、有没有用 Tab 缩进、用了多少 !!js。
// 完整语义由 DSH 自己的 loader 负责，我们不重复实现，也不假装能实现。

const ENTRY_RE = /^-\s*(.*)$/;
const ID_RE = /^\s+id:\s*(\S[^\r\n]*?)\s*$/;
const NAME_RE = /^\s+name:\s*(\S[^\r\n]*?)\s*$/;

function unquote(v) {
  if (v === undefined) return undefined;
  const s = String(v).trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

/**
 * 逐行剥掉 YAML 注释。整行注释直接丢；行内 ` #` 之后的内容也丢。
 *
 * 为什么必须剥：真实 profile 的 cordis.patch.yml 第 3 行注释里就写了
 * `!!js` 这个字样（说明文字），不剥的话 doctor 会报「!!js 表达式 1 处」，
 * 而实际上是 0 —— 属于把说明文字当成事实。
 *
 * 引号内的 `#` 不当注释；这是够用的启发式，不是完整 YAML 词法分析。
 */
function stripComment(line) {
  if (line.trimStart().startsWith('#')) return '';
  let quote = null;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quote !== null) { if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '#' && i > 0 && /\s/.test(line[i - 1])) return line.slice(0, i);
  }
  return line;
}

/** 去掉注释与空行后，内容是否为顶层空数组 */
export function isEmptyArray(text) {
  const meaningful = String(text ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));
  return meaningful.length === 1 && meaningful[0] === '[]';
}

/**
 * 扫描 profile patch。
 * @returns {{
 *   isArray: boolean, emptyArray: boolean, entries: Array<{id?:string,name?:string,line:number}>,
 *   duplicateIds: string[], tabLines: number[], jsTagCount: number, lineCount: number
 * }}
 */
export function scanPatch(text) {
  const src = String(text ?? '');
  const lines = src.split(/\r?\n/);

  const out = {
    isArray: false,
    emptyArray: false,
    entries: [],
    duplicateIds: [],
    tabLines: [],
    jsTagCount: 0,
    lineCount: lines.length,
  };

  // 统计 !!js 时先剥注释：注释里的 `!!js` 是说明文字，不是表达式
  out.jsTagCount = (lines.map(stripComment).join('\n').match(/!!js/g) ?? []).length;
  lines.forEach((l, i) => { if (l.includes('\t')) out.tabLines.push(i + 1); });

  if (isEmptyArray(src)) {
    out.isArray = true;
    out.emptyArray = true;
    return out;
  }

  // 第一个有意义的行为准：必须是顶层数组项，或 '[]'
  const firstMeaningful = lines.find((l) => l.trim().length > 0 && !l.trim().startsWith('#'));
  out.isArray = firstMeaningful !== undefined && /^-\s|^-\s*$|^\[\]/.test(firstMeaningful.trim());

  let current = null;
  const push = () => { if (current) out.entries.push(current); };

  lines.forEach((line, idx) => {
    const m = ENTRY_RE.exec(line);
    if (m) {
      push();
      current = { line: idx + 1 };
      // 允许 `- id: xxx` 这种紧凑写法
      const inline = m[1].trim();
      const im = /^id:\s*(\S.*)$/.exec(inline);
      if (im) current.id = unquote(im[1]);
      const nm = /^name:\s*(\S.*)$/.exec(inline);
      if (nm) current.name = unquote(nm[1]);
      return;
    }
    if (!current) return;
    if (current.id === undefined) {
      const im = ID_RE.exec(line);
      if (im) current.id = unquote(im[1]);
    }
    if (current.name === undefined) {
      const nm = NAME_RE.exec(line);
      if (nm) current.name = unquote(nm[1]);
    }
  });
  push();

  const seen = new Map();
  for (const e of out.entries) {
    if (!e.id) continue;
    seen.set(e.id, (seen.get(e.id) ?? 0) + 1);
  }
  out.duplicateIds = [...seen.entries()].filter(([, n]) => n > 1).map(([id]) => id);

  return out;
}

/** 包名是否是可解析的 npm 包名（用于区分 `dsh-better-sidebar` 与相对路径） */
export function looksLikePackage(name) {
  if (!name) return false;
  if (name.startsWith('.') || name.startsWith('/')) return false;
  return /^(?:@[^/\s]+\/)?[^/\s]+$/.test(name);
}
