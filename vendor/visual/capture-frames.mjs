// Capture the splash animation at fixed timeline positions using headless Chrome
// over the DevTools Protocol. No external dependencies: this drives CDP with a
// plain WebSocket implemented on node:net, because the workspace has no ws module.
//
// 归拢自 tools/capture-frames.mjs（与所在目录无关，直接搬）。
// Usage: node vendor/visual/capture-frames.mjs <previewUrl> <outDir> [--times 0.05,0.3,...]
import { mkdir, writeFile } from 'node:fs/promises'
import { createHash, randomBytes } from 'node:crypto'
import { connect } from 'node:net'
import { spawn } from 'node:child_process'
import path from 'node:path'

const [url, outDir] = process.argv.slice(2)
const timesArg = process.argv.indexOf('--times')
const times = (timesArg >= 0 ? process.argv[timesArg + 1] : '0.08,0.25,0.42,0.6,0.75,0.88,1.0')
  .split(',')
  .map(Number)

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9333
const WIDTH = 600
const HEIGHT = 700

await mkdir(outDir, { recursive: true })

const profile = path.join(process.env.TEMP ?? '.', `dsh-capture-${randomBytes(4).toString('hex')}`)
const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  `--window-size=${WIDTH},${HEIGHT}`,
  '--hide-scrollbars',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  '--force-device-scale-factor=1',
  'about:blank',
], { stdio: 'ignore' })

/** Minimal CDP client over a hand-rolled WebSocket (RFC 6455, text frames only). */
class Cdp {
  constructor(socket) {
    this.socket = socket
    this.buffer = Buffer.alloc(0)
    this.nextId = 1
    this.pending = new Map()
    this.fragments = null
    this.mode = 'frames'
    this.handshakeDone = null
    socket.on('data', (chunk) => this.onData(chunk))
  }

  static async attach(wsUrl) {
    const u = new URL(wsUrl)
    const socket = connect(Number(u.port), u.hostname)
    // Install ONE data handler before any bytes can arrive. The handshake and the
    // frame stream share it, so no response can be dropped in a race.
    const client = new Cdp(socket)
    client.mode = 'handshake'
    await new Promise((resolve, reject) => {
      socket.once('connect', resolve)
      socket.once('error', reject)
    })
    const key = randomBytes(16).toString('base64')
    const done = new Promise((resolve) => { client.handshakeDone = resolve })
    socket.write(
      `GET ${u.pathname} HTTP/1.1\r\n` +
      `Host: ${u.host}\r\n` +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Key: ${key}\r\n` +
      'Sec-WebSocket-Version: 13\r\n\r\n',
    )
    await done
    return client
  }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk])
    if (this.mode === 'handshake') {
      const idx = this.buffer.indexOf('\r\n\r\n')
      if (idx === -1) return
      const head = this.buffer.subarray(0, idx).toString('latin1')
      if (!/^HTTP\/1\.1 101/.test(head)) {
        throw new Error(`cdp: websocket upgrade refused: ${head.split('\r\n')[0]}`)
      }
      this.buffer = this.buffer.subarray(idx + 4)
      this.mode = 'frames'
      this.handshakeDone?.()
      if (this.buffer.length === 0) return
    }
    for (;;) {
      const frame = this.readFrame()
      if (frame === null) return
      // Reassemble fragmented messages: opcode 0x0 continues the previous one.
      if (frame.opcode === 0x0) {
        if (this.fragments === null) continue
        this.fragments.push(frame.payload)
        if (frame.fin) {
          const full = Buffer.concat(this.fragments)
          this.fragments = null
          this.onMessage(full.toString('utf8'))
        }
        continue
      }
      if (frame.opcode === 0x8) {
        this.socket.end()
        return
      }
      if (frame.opcode !== 0x1) continue
      if (!frame.fin) {
        this.fragments = [frame.payload]
        continue
      }
      this.onMessage(frame.payload.toString('utf8'))
    }
  }

  readFrame() {
    const b = this.buffer
    if (b.length < 2) return null
    const fin = (b[0] & 0x80) !== 0
    const opcode = b[0] & 0x0f
    const masked = (b[1] & 0x80) !== 0
    let len = b[1] & 0x7f
    let offset = 2
    if (len === 126) {
      if (b.length < 4) return null
      len = b.readUInt16BE(2)
      offset = 4
    } else if (len === 127) {
      if (b.length < 10) return null
      len = Number(b.readBigUInt64BE(2))
      offset = 10
    }
    let mask = null
    if (masked) {
      if (b.length < offset + 4) return null
      mask = b.subarray(offset, offset + 4)
      offset += 4
    }
    if (b.length < offset + len) return null
    const payload = Buffer.from(b.subarray(offset, offset + len))
    if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4]
    this.buffer = b.subarray(offset + len)
    return { opcode, payload, fin }
  }

  send(method, params = {}) {
    const id = this.nextId++
    const text = JSON.stringify({ id, method, params })
    const payload = Buffer.from(text, 'utf8')
    const mask = randomBytes(4)
    const masked = Buffer.from(payload)
    for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i % 4]

    let header
    if (payload.length < 126) {
      header = Buffer.alloc(6)
      header[0] = 0x81
      header[1] = 0x80 | payload.length
      mask.copy(header, 2)
    } else if (payload.length < 65536) {
      header = Buffer.alloc(8)
      header[0] = 0x81
      header[1] = 0x80 | 126
      header.writeUInt16BE(payload.length, 2)
      mask.copy(header, 4)
    } else {
      header = Buffer.alloc(14)
      header[0] = 0x81
      header[1] = 0x80 | 127
      header.writeBigUInt64BE(BigInt(payload.length), 2)
      mask.copy(header, 10)
    }
    this.socket.write(Buffer.concat([header, masked]))
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }))
  }

  onMessage(text) {
    const msg = JSON.parse(text)
    if (msg.id !== undefined) {
      const p = this.pending.get(msg.id)
      if (p === undefined) return
      this.pending.delete(msg.id)
      if (msg.error) p.reject(new Error(msg.error.message))
      else p.resolve(msg.result)
    }
  }
}

/** Poll the DevTools HTTP endpoint until the browser reports a page target. */
async function targetWebSocket() {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const list = await res.json()
      const page = list.find((t) => t.type === 'page')
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl
    } catch {}
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error('cdp: no page target appeared')
}

const wsUrl = await targetWebSocket()
const cdp = await Cdp.attach(wsUrl)
await cdp.send('Page.enable')
await cdp.send('Runtime.enable')
await cdp.send('Emulation.setDeviceMetricsOverride', {
  width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false,
})

// Load the preview with animation paused so we can scrub deterministically.
await cdp.send('Page.navigate', { url })
await new Promise((r) => setTimeout(r, 1800))

// Freeze the engine's rAF loop and drive render() directly per capture time.
const hasSplash = await cdp.send('Runtime.evaluate', {
  expression: 'typeof window.__splash === "function" ? !!window.__splash() : false',
  returnByValue: true,
})
if (hasSplash.result.value !== true) {
  console.error('capture: window.__splash() unavailable; cannot scrub frames')
  chrome.kill()
  process.exit(1)
}

const written = []
for (const t of times) {
  // Reproduce exactly what the engine draws at progress t.
  await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      const s = window.__splash()
      s.stop()
      s.reduced = false
      s.render(${t}, 2400)
      return true
    })()`,
    returnByValue: true,
  })
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
  const file = path.join(outDir, `frame-${String(t).replace('.', '_')}.png`)
  await writeFile(file, Buffer.from(shot.data, 'base64'))
  written.push(file)
  console.log(`captured t=${t} -> ${file}`)
}

chrome.kill()
console.log(`done: ${written.length} frames`)
