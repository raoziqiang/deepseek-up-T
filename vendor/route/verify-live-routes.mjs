// Query the running DSH host through its own Remote gateway (cookie-authenticated)
// and report the provider routes it currently serves.
import { readFile } from 'node:fs/promises'
import { createHash, createHmac } from 'node:crypto'
import { join } from 'node:path'
import { P } from '../lib/harness.mjs'

// 归拢自 tools/verify-live-routes.mjs。改动：HOST 尊重 DSH_WEB_URL、
// 凭据库走 $DSH_HOME（原来写死 homedir()/.dsh）。
const HOST = process.env.DSH_WEB_URL?.replace(/^https?:\/\//, '') ?? '127.0.0.1:19387'
const store = await readFile(join(P.home, '.credentials.yaml'), 'utf8')
const lines = store.split(/\r?\n/)
const start = lines.findIndex((l) => l.includes('client-connection/browser-session:'))
const secretLine = lines.slice(start, start + 8).find((l) => /^\s+secret:/.test(l))
const secret = Buffer.from(secretLine.replace(/^\s+secret:\s*/, '').trim(), 'base64url')

const b64u = (b) => Buffer.from(b).toString('base64url')
const authority = HOST
const name = `dsh-auth-${b64u(createHash('sha256').update(authority).digest())}`
const issuedAt = Date.now()
const body = b64u(Buffer.from(JSON.stringify({ version: 1, authority, issuedAt, expiresAt: issuedAt + 3_600_000 }), 'utf8'))
const cookie = `${name}=v1.${body}.${b64u(createHmac('sha256', secret).update(body).digest())}`

const call = async (endpoint, args = {}) => {
  const res = await fetch(`http://${HOST}/api/${endpoint}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie, origin: `http://${HOST}` },
    body: JSON.stringify({ type: 'client-request', rpcId: `verify-${endpoint.replace(/\W/g, '-')}`, method: endpoint, payload: { args } }),
  })
  const text = await res.text()
  return { status: res.status, text }
}

const endpoints = [
  ['llm/listProviders', {}],
  ['llm/listConfigurableProviders', {}],
  ['llm/listModels', { provider: 'opencode-go-chat' }],
]

for (const [endpoint, args] of endpoints) {
  const { status, text } = await call(endpoint, args)
  console.log(`=== ${endpoint} -> ${status} ===`)
  console.log(text.slice(0, 3000))
  console.log()
}
