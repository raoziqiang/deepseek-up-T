// Analyze captured splash frames numerically, without an image library.
// Decodes PNG (zlib via node:zlib) and reports color distribution, the vertical
// extent of blue "whale" pixels, and where the paper/water regions sit.
//
// 归拢自 tools/analyze-frames.mjs（与所在目录无关，直接搬）。
// Usage: node vendor/visual/analyze-frames.mjs <dir>
import { readdir, readFile } from 'node:fs/promises'
import { inflateSync } from 'node:zlib'
import path from 'node:path'

/** Decode a non-interlaced PNG into { width, height, pixels: RGBA Uint8Array }. */
function decodePng(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG')
  let offset = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  const idat = []
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('latin1', offset + 4, offset + 8)
    const data = buffer.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
      if (data[12] !== 0) throw new Error('interlaced PNG unsupported')
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    offset += 12 + length
  }
  if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`)
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType]
  if (channels === undefined) throw new Error(`unsupported color type ${colorType}`)

  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const out = new Uint8Array(width * height * 4)
  let prev = Buffer.alloc(stride)
  let pos = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++]
    const line = Buffer.from(raw.subarray(pos, pos + stride))
    pos += stride
    // Undo the per-scanline filter.
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
      if (channels >= 3) {
        out[d] = line[s]
        out[d + 1] = line[s + 1]
        out[d + 2] = line[s + 2]
        out[d + 3] = channels === 4 ? line[s + 3] : 255
      } else {
        out[d] = out[d + 1] = out[d + 2] = line[s]
        out[d + 3] = channels === 2 ? line[s + 1] : 255
      }
    }
  }
  return { width, height, pixels: out }
}

const dir = process.argv[2]
const files = (await readdir(dir)).filter((f) => f.endsWith('.png')).sort()
if (files.length === 0) {
  console.error(`analyze: no PNGs in ${dir}`)
  process.exit(1)
}

for (const file of files) {
  const png = decodePng(await readFile(path.join(dir, file)))
  const { width, height, pixels } = png

  let whale = 0          // saturated MID blue: the whale body only
  let spray = 0          // near-white
  let paper = 0          // pale, low-saturation background
  let gold = 0           // the rod end caps / charm ring
  let minY = height
  let maxY = -1
  let minX = width
  let maxX = -1
  let sumX = 0
  let sumY = 0

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const r = pixels[i]
      const g = pixels[i + 1]
      const b = pixels[i + 2]
      const max = Math.max(r, g, b)
      const min = Math.min(r, g, b)
      const sat = max === 0 ? 0 : (max - min) / max

      // The whale body is a deeper blue than the water band. The light-theme
      // water starts at rgb(147,197,253) (r=147); the whale body is rgb(65,118,230)
      // and darker. Requiring a LOW red channel separates the two cleanly.
      if (b > 150 && b - r > 80 && r < 110 && sat > 0.5) {
        whale++
        if (y < minY) minY = y
        if (y > maxY) maxY = y
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        sumX += x
        sumY += y
      } else if (r === g && g === b && r > 244) {
        // Pure white: the spray droplets and foam.
        spray++
      } else if (min > 205 && sat < 0.16) {
        // Pale and nearly neutral: the scroll's rice paper, not the spray.
        paper++
      } else if (r > 170 && g > 130 && b < 140 && r - b > 45) {
        gold++
      }
    }
  }

  const total = width * height
  const pct = (n) => ((n / total) * 100).toFixed(2)
  const centroid = whale > 0
    ? `(${(sumX / whale).toFixed(0)}, ${(sumY / whale).toFixed(0)})`
    : 'n/a'
  const box = whale > 0 ? `x[${minX}..${maxX}] y[${minY}..${maxY}]` : 'n/a'

  console.log(
    `${file.padEnd(22)} whale=${pct(whale).padStart(6)}%  spray=${pct(spray).padStart(6)}%  ` +
    `paper=${pct(paper).padStart(6)}%  gold=${pct(gold).padStart(5)}%  centroid=${centroid}  bbox=${box}`,
  )
}
