// 在运行中的 DSH 中验证 OpenCode Go / DeepSeek V4.1 Flash：查 Provider、选模型、真对话。
// 只输出状态与短答；浏览器会话凭据只在内存里生成，不写盘、不打印。
import { readFile, mkdir } from 'node:fs/promises';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { P, PROJECT_ROOT } from '../lib/harness.mjs';

const HOST = process.env.DSH_WEB_URL?.replace(/^https?:\/\//, '') ?? '127.0.0.1:19387';
const CWD = join(PROJECT_ROOT, 'state', 'cmp', 'model-smoke');
const provider = 'opencode-go-chat';
const model = 'deepseek-v4.1-flash';
const lines = (await readFile(join(P.home, '.credentials.yaml'), 'utf8')).split(/\r?\n/);
const start = lines.findIndex((line) => line.includes('client-connection/browser-session:'));
const secretLine = lines.slice(start, start + 8).find((line) => /^\s+secret:/.test(line));
if (!secretLine) throw new Error('缺少本机 DSH 浏览器会话凭据');
const secret = Buffer.from(secretLine.replace(/^\s+secret:\s*/, '').trim(), 'base64url');
const b64u = (bytes) => Buffer.from(bytes).toString('base64url');
const authority = HOST;
const cookieName = `dsh-auth-${b64u(createHash('sha256').update(authority).digest())}`;
const issuedAt = Date.now();
const body = b64u(Buffer.from(JSON.stringify({ version: 1, authority, issuedAt, expiresAt: issuedAt + 600_000 })));
const cookie = `${cookieName}=v1.${body}.${b64u(createHmac('sha256', secret).update(body).digest())}`;
let rpc = 0;
async function call(method, args) {
  const response = await fetch(`http://${HOST}/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie, origin: `http://${HOST}` },
    body: JSON.stringify({ type: 'client-request', rpcId: `v41-${++rpc}`, method, payload: { args } }),
  });
  const raw = await response.text();
  let envelope;
  try { envelope = JSON.parse(raw); } catch { throw new Error(`${method} 失败：HTTP ${response.status}`); }
  if (!response.ok || !envelope.result?.ok) {
    throw new Error(`${method} 失败：HTTP ${response.status}，${envelope.result?.error?.message ?? '服务未返回成功结果'}`);
  }
  return envelope.result.value;
}
function assistantText(records) {
  const texts = [];
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const value of node) visit(value); return; }
    if (node.role === 'assistant' && Array.isArray(node.content)) {
      for (const part of node.content) if (part?.type === 'text') texts.push(part.text ?? '');
    }
    for (const value of Object.values(node)) visit(value);
  };
  for (const record of records ?? []) visit(record.event?.data ?? record);
  return texts.join('').trim();
}

const providers = await call('llm/listProviders', {});
if (!providers.some((item) => item?.id === provider)) throw new Error(`运行时未注册 ${provider}`);
console.log(`Provider：${provider} 已注册`);

await mkdir(CWD, { recursive: true });
const created = await call('session/create', { request: { cwd: CWD } });
const sessionId = created.sessionId;
console.log(`测试会话：${sessionId}`);
await call('session/selectModel', { request: { sessionId, provider, model } });
console.log('模型选择：成功');
const prompted = await call('session/prompt', {
  request: {
    sessionId, requestId: randomUUID(), mode: 'queue',
    content: [{ type: 'text', text: '只回复 OK 两个字母。不要调用工具。' }],
  },
});
console.log(`提交请求返回字段：${Object.keys(prompted ?? {}).join(', ') || '无'}`);
const deadline = Date.now() + 120_000;
let lastTypes = '';
let pageShape = '';
while (Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 3000));
  const projection = await call('session/projections', { request: { sessionId } });
  if (!projection) throw new Error('测试会话未出现在运行时投影中');
  const page = await call('session/page', {
    request: { address: { kind: 'session', sessionId }, throughSeq: projection.asOfSeq, maxMessages: 12 },
  });
  pageShape = Object.keys(page ?? {}).join(', ');
  const reply = assistantText(page.records);
  lastTypes = [...new Set((page.records ?? []).map((record) => record.event?.type ?? record.type))].join(', ');
  if (reply) {
    console.log(`真实会话回复：${JSON.stringify(reply.slice(0, 120))}`);
    if (process.argv.includes('--search')) {
      const found = await call('session/search', { request: { query: '两个字母', limit: 20 } });
      const hit = found.items?.find((item) => item.sessionId === sessionId);
      console.log(`正文搜索：${hit ? '命中本次会话' : '未命中本次会话'}；返回 ${found.items?.length ?? 0} 条`);
      if (!hit) process.exit(2);
    }
    process.exit(0);
  }
}
throw new Error(`模型已选中，但 120 秒内未收到助理回复；页面字段：${pageShape || '无'}；最后事件类型：${lastTypes || '无'}`);
