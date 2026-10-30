// deepseek-up-T :: memory 模块（空壳）
//
// 本轮只确保项目笔记目录与用户级全局笔记目录存在，并把路径记进宿主日志。
// 回合后自动摘录、/dream 归并留到下一轮。不替代灵枢（@furongjun1999/dsh-memory）。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const name = 'memory';

function projectTopicsDir(projectRoot) {
  return path.join(projectRoot, 'memory', 'project', 'topics');
}

function globalMemoryDir() {
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  return path.join(home, 'up-t', 'memory');
}

export async function start(ctx) {
  const projectDir = projectTopicsDir(ctx.projectRoot);
  const globalDir = globalMemoryDir();
  fs.mkdirSync(projectDir, { recursive: true });
  fs.mkdirSync(globalDir, { recursive: true });
  ctx.log('info', 'memory dirs ready', { projectDir, globalDir });
}

export async function stop() {
  // 空壳：没有后台任务可停。
}

export default { name, start, stop };
