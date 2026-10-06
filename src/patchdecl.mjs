// deepseek-up-T :: 补丁声明的机器可读读取
//
// `patches/*.yml` 是 L3 改动的**唯一权威描述**。构建器要用它（改什么、改几个），
// 升级检测也要用它（这次 Harness 升级后，哪些声明需要重打）。两个用途都只能有
// 一份解析实现，否则「构建时按 A 理解、检测时按 B 理解」会静默错位。
//
// 这里刻意**不做通用 YAML 解析**，只认 patches/README.md 里那个受控子集：
//
//   target:
//     archive: resources/app.asar
//     entries:
//       - path: renderer/welcome.html
//         action: replace
//   verify:
//     expect_diff_entries: 11
//
// 读不到就**报错**，绝不静默用默认值——声明与执行器脱钩正是这类改造最容易变坏的地方。
//
// 放在 src/ 而不是 vendor/：src/ 是零依赖的只读诊断层，必须能在「DSH 装坏了」的
// 时候照常跑起来；vendor/ 的构建器反过来 import 这里。

import path from 'node:path';

import { readText } from './paths.mjs';

/** 取一个 YAML 标量：去掉行内注释、去掉包裹引号、统一路径分隔符。 */
export function unquote(value) {
  // 行内注释：`source: a/b.js   # 说明` —— 声明里到处是这种中文说明，
  // 不剥掉就会把注释当成值的一部分（第一次跑构建时正是这么炸的）。
  const withoutComment = String(value).replace(/\s+#.*$/, '').trim();
  return withoutComment.replace(/^['"]|['"]$/g, '').replace(/\\/g, '/');
}

/**
 * 读一个补丁声明文件。
 *
 * @returns {{id:string, file:string, expect:number, entries:string[],
 *            items:Array<{path?:string,action?:string,source?:string,patcher?:string,bundler?:string}>,
 *            syntaxCheck:string[]}}
 * @throws 缺 `verify.expect_diff_entries` / 没有或有多于一个 `target.entries` / 条目缺 path 时
 */
export function readPatchDecl(file) {
  const text = readText(file);
  if (text === null) throw new Error(`读不到补丁声明：${file}`);

  const idMatch = /^id:\s*(\S+)\s*$/m.exec(text);
  const expectMatch = /^\s*expect_diff_entries:\s*(\d+)\s*$/m.exec(text);
  if (!expectMatch) throw new Error(`${file} 缺少 verify.expect_diff_entries`);

  const lines = text.split(/\r?\n/);
  const indentOf = (line) => (line.match(/^\s*/) ?? [''])[0].length;
  const heads = lines.map((l, i) => (/^\s*entries:\s*$/.test(l) ? i : -1)).filter((i) => i >= 0);
  if (heads.length !== 1) {
    throw new Error(`${file} 应当恰好有一个 target.entries 列表，实际找到 ${heads.length} 个`);
  }
  const listIndent = indentOf(lines[heads[0]]);

  const items = [];
  for (let i = heads[0] + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    if (indentOf(line) <= listIndent) break;
    const start = /^\s*-\s+(\w+):\s*(.+?)\s*$/.exec(line);
    if (start) {
      items.push({ [start[1]]: unquote(start[2]) });
      continue;
    }
    const cont = /^\s+(\w+):\s*(.+?)\s*$/.exec(line);
    if (cont && items.length > 0) items[items.length - 1][cont[1]] = unquote(cont[2]);
  }
  const entries = items.map((it) => it.path).filter(Boolean);
  if (entries.length === 0) throw new Error(`${file} 的 target.entries 为空`);
  for (const it of items) {
    if (!it.path) throw new Error(`${file} 的 target.entries 有一条没有 path`);
  }

  const syntaxHead = lines.map((l, i) => (/^\s*syntax_check:\s*$/.test(l) ? i : -1)).filter((i) => i >= 0)[0];
  const syntaxCheck = [];
  if (syntaxHead !== undefined) {
    const base = indentOf(lines[syntaxHead]);
    for (let i = syntaxHead + 1; i < lines.length; i += 1) {
      const line = lines[i];
      if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
      if (indentOf(line) <= base) break;
      const m = /^\s*-\s+(.+?)\s*$/.exec(line);
      if (m) syntaxCheck.push(unquote(m[1]));
    }
  }

  return {
    id: idMatch ? idMatch[1] : path.basename(file, '.yml'),
    file,
    expect: Number(expectMatch[1]),
    entries,
    items,
    syntaxCheck,
  };
}
