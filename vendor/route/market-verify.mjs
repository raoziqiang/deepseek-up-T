// Confirm the dsh-market client bundle is composed into the live GUI boot
// manifest and is actually served by the host.
import { readFile } from 'node:fs/promises'
import { createHash, createHmac } from 'node:crypto'
import { join } from 'node:path'
import { P } from '../lib/harness.mjs'

// 归拢自 tools/market-verify.mjs。改动：凭据库走 $DSH_HOME
// （原来写死 homedir()/.dsh，DSH_HOME 被改过时会读错）。
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

const html = await (await fetch(`http://${HOST}/`, { headers: { cookie } })).text()
const boot = JSON.parse(html.match(/globalThis\["__DSH_BOOT__"\]\s*=\s*(\{.*?\})<\/script>/s)[1])

const row = boot.entries.find((e) => e.id === 'dshmarket')
console.log('boot rev:', boot.rev)
console.log('dshmarket row:', row ? JSON.stringify(row) : '(MISSING)')
if (!row) process.exit(1)

const url = `http://${HOST}/${row.url}`
const res = await fetch(url, { headers: { cookie } })
const text = await res.text()
console.log(`\nGET ${row.url}`)
console.log(`-> HTTP ${res.status}, ${res.headers.get('content-type')}, ${text.length} bytes`)
console.log('head:', text.slice(0, 160).replace(/\s+/g, ' '))

const batches = boot.batches ?? []
console.log('\nbatches:', batches.map((b) => b.phase).join(', '))
for (const b of batches) {
  if (b.entries?.includes('dshmarket')) console.log(`dshmarket rides the "${b.phase}" batch (${b.entries.length} entries)`)
}
