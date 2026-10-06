// 归拢自 tools/probe-go-session-header.mjs（与所在目录无关，直接搬）。
// Which session header does the OpenCode Go gateway accept, and does a static one work?
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const auth = JSON.parse(await readFile(join(homedir(), '.local', 'share', 'opencode', 'auth.json'), 'utf8'))
const key = auth['opencode-go'].key
const BASE = 'https://opencode.ai/zen/go/v1'
const brief = (s) => s.replace(/\s+/g, ' ').slice(0, 180)

const cases = [
  ['chat/completions', 'deepseek-v4-flash', { 'x-opencode-session': randomUUID() }],
  ['chat/completions', 'deepseek-v4-flash', { 'x-deepseek-harness-session-id': randomUUID() }],
  ['chat/completions', 'deepseek-v4-flash', { 'x-opencode-session': 'dsh-static-probe', 'x-deepseek-harness-session-id': randomUUID() }],
  ['responses', 'gpt-5.6-luna', { 'x-opencode-session': randomUUID() }],
  ['messages', 'qwen3.7-plus', { 'x-opencode-session': randomUUID() }],
  ['messages', 'minimax-m3', { 'x-opencode-session': randomUUID() }],
]

const bodyFor = (path, model) => {
  if (path === 'chat/completions') return { model, messages: [{ role: 'user', content: 'Reply with the single word: ok' }], max_tokens: 24, stream: false }
  if (path === 'responses') return { model, input: 'Reply with the single word: ok', max_output_tokens: 64, stream: false }
  return { model, max_tokens: 24, messages: [{ role: 'user', content: 'Reply with the single word: ok' }] }
}

for (const [path, model, extra] of cases) {
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, ...extra }
  if (path === 'messages') {
    headers['x-api-key'] = key
    headers['anthropic-version'] = '2023-06-01'
  }
  const res = await fetch(`${BASE}/${path}`, { method: 'POST', headers, body: JSON.stringify(bodyFor(path, model)) })
  const text = await res.text()
  console.log(`${path}/${model} [${Object.keys(extra).join('+')}] -> ${res.status}  ${brief(text)}`)
}
