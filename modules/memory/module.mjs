// deepseek-up-T :: memory 模块
//
// 启动时：确保项目笔记目录与用户级全局笔记目录存在，并按 up-t-memory 契约检查一遍现有笔记
// （与 `dsht memory lint` 同一份判据，见 src/memory.mjs），结果记进宿主日志。
// 只读笔记，不写笔记。回合后自动摘录、/dream 归并留到后续。不替代灵枢（@furongjun1999/dsh-memory）。

import fs from 'node:fs';

import { memoryRoots, lintAll } from '../../src/memory.mjs';

export const name = 'memory';

export async function start(ctx) {
  const roots = memoryRoots({ projectRoot: ctx.projectRoot });
  fs.mkdirSync(roots.project, { recursive: true });
  fs.mkdirSync(roots.global, { recursive: true });
  ctx.log('info', 'memory dirs ready', { projectDir: roots.project, globalDir: roots.global });

  const r = lintAll(roots);
  const extra = { notes: r.notes, errors: r.errors, warns: r.warns };
  if (r.errors) {
    // 只报不拦：一条坏笔记不该让宿主把整个模块判成 failed。
    ctx.log('warn', `memory lint: ${r.errors} error(s) — 跑 dsht memory lint 看详情`, extra);
  } else {
    ctx.log('info', 'memory lint ok', extra);
  }
}

export async function stop() {
  // 没有后台任务可停。
}

export default { name, start, stop };
