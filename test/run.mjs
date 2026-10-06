// deepseek-up-T :: 测试总入口
//
// 为什么不让 `npm test` 手写一串 `&&`：那样每加一套测试都要回来改这里，
// 忘了改的后果是「新测试从来没在总入口跑过」——一段静默失效的防线。
// 这里改成**发现式**：`test/` 下所有 `*.test.mjs` 按文件名排序逐个跑，谁的退出码非零就记下来。
//
// stdio 用 'inherit' 而不是管道：在受限沙箱里，管道式 stdio 会直接 EPERM，
// 而直通终端既能拿到完整输出，又不需要捕获。

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
let files = fs.readdirSync(here)
  .filter((f) => f.endsWith('.test.mjs'))
  .sort();
if (only.length) {
  files = files.filter((f) => only.some((o) => f.includes(o)));
  if (!files.length) {
    console.error(`没有匹配的测试文件（-- ${only.join(' ')}）`);
    process.exit(2);
  }
}

if (!files.length) {
  console.error(`test/ 下没有 *.test.mjs —— 这不是「通过」，是没有防线。`);
  process.exit(2);
}

const results = [];
for (const f of files) {
  const full = path.join(here, f);
  process.stdout.write(`\n=== ${f} ===\n`);
  const r = spawnSync(process.execPath, [full], { stdio: 'inherit' });
  if (r.error) {
    results.push({ f, code: null, why: r.error.message });
    console.error(`${f} 无法启动：${r.error.message}`);
    continue;
  }
  results.push({ f, code: r.status ?? 1, why: r.status === null ? `被信号终止（signal=${r.signal}）` : null });
}

const bad = results.filter((r) => r.code !== 0);
console.log(`\n${'─'.repeat(60)}`);
for (const r of results) {
  console.log(`${r.code === 0 ? 'PASS' : 'FAIL'}  ${r.f}${r.code === 0 ? '' : `  (exit ${r.code}${r.why ? ` · ${r.why}` : ''})`}`);
}
console.log(`${results.length - bad.length}/${results.length} 套测试通过`);
process.exit(bad.length ? 1 : 0);
