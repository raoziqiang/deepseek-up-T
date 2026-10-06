// 归拢自 tools/probe-go-protocols.mjs（与所在目录无关，直接搬）。
// Verify one real request per wire protocol against the OpenCode Go prefix.
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const auth = JSON.parse(await readFile(join(homedir(), '.local', 'share', 'opencode', 'auth.json'), 'utf8'))
const key = auth['opencode-go'].key
const BASE = 'https://opencode.ai/zen/go/v1'
const brief = (s) => s.replace(/\s+/g, ' ').slice(0, 200)

const posts = [
  ['chat/completions', 'deepseek-v4-flash', { model: 'deepseek-v4-flash', messages: [{ role: 'user', content: 'Reply with the single word: ok' }], max_tokens: 24, stream: false }],
  ['chat/completions', 'deepseek-flash', { model: 'deepseek-flash', messages: [{ role: 'user', content: 'Reply with the single word: ok' }], max_tokens: 24, stream: false }],
  ['chat/completions', 'kimi-k3', { model: 'kimi-k3', messages: [{ role: 'user', content: 'Reply with the single word: ok' }], max_tokens: 24, stream: false }],
  ['responses', 'gpt-5.6-luna', { model: 'gpt-5.6-luna', input: 'Reply with the single word: ok', max_output_tokens: 64, stream: false }],
  ['responses', 'grok-4.7', { model: 'grok-4.7', input: 'Reply with the single word: ok', max_output_tokens: 64, stream: false }],
  ['messages', 'qwen3.7-plus', { model: 'qwen3.7-plus', max_tokens: 24, messages: [{ role: 'user', content: 'Reply with the single word: ok' }] }],
  ['messages', 'minimax-m3', { model: 'minimax-m3', max_tokens: 24, messages: [{ role: 'user', content: 'Reply with the single word: ok' }] }],
]

for (const [path, model, body] of posts) {
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }
  if (path === 'messages') {
    headers['x-api-key'] = key
    headers['anthropic-version'] = '2023-06-01'
  }
  try {
    const res = await fetch(`${BASE}/${path}`, { method: 'POST', headers, body: JSON.stringify(body) })
    const text = await res.text()
    console.log(`${path.padEnd(17)} ${model.padEnd(26)} -> ${res.status}  ${brief(text)}`)
  } catch (error) {
    console.log(`${path.padEnd(17)} ${model.padEnd(26)} -> transport error: ${error.message}`)
  }
}
