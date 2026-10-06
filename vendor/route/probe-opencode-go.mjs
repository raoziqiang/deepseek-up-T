// 归拢自 tools/probe-opencode-go.mjs（与所在目录无关，直接搬）。
// Probe the OpenCode Go endpoint with the locally stored opencode credential.
// Prints only status codes, model ids and short replies; never the key value.
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const authPath = join(homedir(), '.local', 'share', 'opencode', 'auth.json')
const auth = JSON.parse(await readFile(authPath, 'utf8'))
const entry = auth['opencode-go']
if (!entry?.key) throw new Error('no opencode-go key in auth.json')
const key = entry.key
console.log(`credential: opencode-go (type=${entry.type}, length=${key.length}, prefix=${key.slice(0, 6)}…)`)

const BASE = 'https://opencode.ai/zen/go/v1'

const getModels = async () => {
  const res = await fetch(`${BASE}/models`, { headers: { Authorization: `Bearer ${key}` } })
  const text = await res.text()
  console.log(`GET /models -> ${res.status} ${res.headers.get('content-type')} (${text.length} bytes)`)
  if (res.status !== 200) {
    console.log(text.slice(0, 600))
    return []
  }
  const json = JSON.parse(text)
  const list = Array.isArray(json.data) ? json.data : Object.entries(json.models ?? {}).map(([id, v]) => ({ id, ...v }))
  console.log(`models: ${list.length}`)
  for (const m of list) {
    const caps = [m.context_window ?? m.contextWindow ?? m.max_input_tokens, m.max_tokens ?? m.maxTokens]
      .filter((v) => v !== undefined)
      .join('/')
    console.log(`  ${m.id}${caps ? `  [${caps}]` : ''}`)
  }
  return list.map((m) => m.id)
}

const ids = await getModels()

const pick = (patterns) => patterns.flatMap((p) => ids.filter((id) => id.includes(p))).slice(0, 2)
if (process.argv.includes('--chat')) {
  for (const model of pick(['deepseek-v4-flash', 'glm', 'kimi'])) {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Reply with the single word: ok' }], max_tokens: 16, stream: false }),
    })
    const text = await res.text()
    console.log(`POST /chat/completions ${model} -> ${res.status}: ${text.replace(/\s+/g, ' ').slice(0, 220)}`)
  }
}
