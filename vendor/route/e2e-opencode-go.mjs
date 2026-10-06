// End-to-end check: drive one bounded prompt per OpenCode Go route through the
// running DSH host (same Remote gateway the Web GUI uses), then restore the
// profile's previous default model selection.
import { readFile, mkdir } from 'node:fs/promises'
import { createHash, createHmac, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { P, WORKSPACE } from '../lib/harness.mjs'

// 归拢自 tools/e2e-opencode-go.mjs。改动：HOST 尊重 DSH_WEB_URL、CWD 尊重工作区、
// 凭据库走 $DSH_HOME（原来写死 homedir()/.dsh，DSH_HOME 被改过时会读错）。
const HOST = process.env.DSH_WEB_URL?.replace(/^https?:\/\//, '') ?? '127.0.0.1:19387'
const CWD = process.env.DSH_UP_T_E2E_CWD ?? join(WORKSPACE, '.probe-workspace')
const PROMPT = '只回复一个词：ok。不要调用任何工具。'

const lines = (await readFile(join(P.home, '.credentials.yaml'), 'utf8')).split(/\r?\n/)
const start = lines.findIndex((l) => l.includes('client-connection/browser-session:'))
const secretLine = lines.slice(start, start + 8).find((l) => /^\s+secret:/.test(l))
const secret = Buffer.from(secretLine.replace(/^\s+secret:\s*/, '').trim(), 'base64url')

const b64u = (b) => Buffer.from(b).toString('base64url')
const authority = HOST
const cookieName = `dsh-auth-${b64u(createHash('sha256').update(authority).digest())}`
const issuedAt = Date.now()
const body = b64u(Buffer.from(JSON.stringify({ version: 1, authority, issuedAt, expiresAt: issuedAt + 3_600_000 }), 'utf8'))
const cookie = `${cookieName}=v1.${body}.${b64u(createHmac('sha256', secret).update(body).digest())}`

let rpc = 0
const call = async (endpoint, args) => {
  const res = await fetch(`http://${HOST}/api/${endpoint}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie, origin: `http://${HOST}` },
    body: JSON.stringify({ type: 'client-request', rpcId: `e2e-${++rpc}`, method: endpoint, payload: { args } }),
  })
  const text = await res.text()
  let envelope
  try {
    envelope = JSON.parse(text)
  } catch {
    throw new Error(`${endpoint}: HTTP ${res.status} ${text.slice(0, 200)}`)
  }
  if (!envelope.result?.ok) {
    throw new Error(`${endpoint}: ${JSON.stringify(envelope.result?.error ?? envelope).slice(0, 400)}`)
  }
  return envelope.result.value
}

/** Collect assistant text currently visible in the Session's history page. */
const assistantText = (records) => {
  const texts = []
  const visit = (node) => {
    if (node === null || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const item of node) visit(item)
      return
    }
    if (node.role === 'assistant' && Array.isArray(node.content)) {
      for (const part of node.content) if (part?.type === 'text' && typeof part.text === 'string') texts.push(part.text)
    }
    for (const value of Object.values(node)) visit(value)
  }
  for (const record of records ?? []) visit(record.event?.data ?? record)
  return texts.join('')
}

const eventTypes = (records) => [...new Set((records ?? []).map((r) => r.event?.type ?? r.type))].join(',')

await mkdir(CWD, { recursive: true })
const created = await call('session/create', { request: { cwd: CWD } })
const sessionId = created.sessionId
console.log(`session: ${sessionId} (cwd ${CWD})`)

const routes = [
  ['opencode-go-chat', 'deepseek-v4-flash'],
  ['opencode-go-responses', 'gpt-5.6-luna'],
  ['opencode-go-messages', 'qwen3.7-plus'],
]

for (const [provider, model] of routes) {
  const selected = await call('session/selectModel', { request: { sessionId, provider, model } })
  console.log(`selectModel ${provider}/${model} -> ${JSON.stringify(selected)}`)

  await call('session/prompt', { request: { sessionId, requestId: randomUUID(), mode: 'queue', content: [{ type: 'text', text: PROMPT }] } })

  let reply = ''
  let seen = ''
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000))
    const page = await call('session/page', { request: { address: { kind: 'session', sessionId }, throughSeq: -1, maxMessages: 12 } })
    reply = assistantText(page.records)
    seen = eventTypes(page.records)
    if (reply.trim() !== '') break
  }
  console.log(`  reply: ${reply.trim() === '' ? '(none within 120s)' : JSON.stringify(reply.trim().slice(0, 120))}`)
  if (reply.trim() === '') console.log(`  last event types: ${seen}`)
}

const restored = await call('session/selectModel', { request: { sessionId, provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'max' } })
console.log(`restored default selection -> ${JSON.stringify(restored)}`)
