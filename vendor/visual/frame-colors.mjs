// 归拢自 tools/frame-colors.mjs（与所在目录无关，直接搬）。
// Diagnose which parts of a frame the analyzer classifies as "spray", by
// reporting the per-region breakdown and the dominant colors in the top half
// (where, after the whale leaves, only spray or paper should remain).
import { readFile } from 'node:fs/promises'
import { inflateSync } from 'node:zlib'

function decodePng(buffer) {
  let offset = 8
  let width = 0
  let height = 0
  let colorType = 0
  const idat = []
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('latin1', offset + 4, offset + 8)
    const data = buffer.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      colorType = data[9]
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    offset += 12 + length
  }
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType]
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const out = new Uint8Array(width * height * 4)
  let prev = Buffer.alloc(stride)
  let pos = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++]
    const line = Buffer.from(raw.subarray(pos, pos + stride))
    pos += stride
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels] : 0
      const b = prev[i]
      const c = i >= channels ? prev[i - channels] : 0
      let value = line[i]
      if (filter === 1) value += a
      else if (filter === 2) value += b
      else if (filter === 3) value += (a + b) >> 1
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      line[i] = value & 0xff
    }
    prev = line
    for (let x = 0; x < width; x++) {
      const s = x * channels
      const d = (y * width + x) * 4
      out[d] = line[s]
      out[d + 1] = channels >= 3 ? line[s + 1] : line[s]
      out[d + 2] = channels >= 3 ? line[s + 2] : line[s]
      out[d + 3] = channels === 4 ? line[s + 3] : 255
    }
  }
  return { width, height, pixels: out }
}

const png = decodePng(await readFile(process.argv[2]))
const { width, height, pixels } = png
const hist = new Map()
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4
    // Quantize to 16 levels per channel to group near-identical shades.
    const key = `${pixels[i] >> 4},${pixels[i + 1] >> 4},${pixels[i + 2] >> 4}`
    hist.set(key, (hist.get(key) ?? 0) + 1)
  }
}
const total = width * height
const top = [...hist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
console.log(`top colors in ${process.argv[2]} (${width}x${height}):`)
for (const [key, count] of top) {
  const [r, g, b] = key.split(',').map((v) => (Number(v) << 4) + 8)
  console.log(`  rgb(${r},${g},${b}) ${((count / total) * 100).toFixed(2)}%`)
}
