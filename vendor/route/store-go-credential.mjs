// Copy the locally stored OpenCode Go key into the DSH credential store as a ref.
// The value is never printed; only names and lengths are.
//
// 归拢自 tools/store-go-credential.mjs。改动：DSH 凭据库走 $DSH_HOME。
// 注意这是本项目里**唯一会写用户凭据**的脚本（写 `<DSH_HOME>/.credentials.yaml`，
// 先写临时文件再 rename，所以不会写坏一半）；OpenCode CLI 自己的 auth.json 仍按
// homedir() 定位，那不是 DSH 的路径。
import { readFile, writeFile, rename } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { P } from '../lib/harness.mjs'

const REF = 'OPENCODE_GO_API_KEY'
const authPath = join(homedir(), '.local', 'share', 'opencode', 'auth.json')
const storePath = join(P.home, '.credentials.yaml')

const key = JSON.parse(await readFile(authPath, 'utf8'))['opencode-go']?.key
if (!key) throw new Error(`no opencode-go key in ${authPath}`)

const text = await readFile(storePath, 'utf8')
if (new RegExp(`^\\s+${REF}:`, 'm').test(text)) {
  console.log(`${REF} already present in ${storePath}; left unchanged`)
  process.exit(0)
}
if (!/^refs:\s*$/m.test(text)) throw new Error('no top-level refs: section to extend')
if (!/^version:\s*1\s*$/m.test(text)) throw new Error('unexpected credential document version')

const lines = text.split(/\r?\n/)
const at = lines.findIndex((l) => /^refs:\s*$/.test(l))
lines.splice(at + 1, 0, `  ${REF}: ${key}`)
const next = lines.join('\n')

const tmp = `${storePath}.tmp-${process.pid}`
await writeFile(tmp, next, { encoding: 'utf8', mode: 0o600 })
await rename(tmp, storePath)
console.log(`added ref ${REF} (${key.length} chars) to ${storePath}`)
console.log('refs now:', next.split(/\r?\n/).filter((l) => /^ {2}[A-Z_]+:/.test(l)).map((l) => l.split(':')[0].trim()).join(', '))
