// Trace the whale in a rendered frame and print ASCII art + the silhouette
// metrics that distinguish a whale (rounded head, forked tail) from a blob.
//
// This works on the ACTUAL rendered pixels, so it validates the whole pipeline
// (canvas transform, rotation, clipping, gradient) rather than just the path.
//
// The classifier targets the whale BODY only: a saturated deep blue. The water
// band is a lighter blue with a much higher red channel, and the paper is
// near-neutral, so all three separate cleanly.
//
// 归拢自 tools/trace-whale.mjs（与所在目录无关，直接搬）。
// Usage: node vendor/visual/trace-whale.mjs <frame.png> [--cols 96] [--rows 40]
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

const file = process.argv[2]
const colsArg = process.argv.indexOf('--cols')
const rowsArg = process.argv.indexOf('--rows')
const COLS = colsArg >= 0 ? Number(process.argv[colsArg + 1]) : 96
const ROWS = rowsArg >= 0 ? Number(process.argv[rowsArg + 1]) : 40

const png = decodePng(await readFile(file))
const { width, height, pixels } = png

/** True when the pixel is whale-body blue (not water, not paper, not spray). */
const isWhale = (i) => {
  const r = pixels[i]
  const g = pixels[i + 1]
  const b = pixels[i + 2]
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const sat = max === 0 ? 0 : (max - min) / max
  return b > 150 && b - r > 80 && r < 110 && sat > 0.5
}

const mask = new Uint8Array(width * height)
let count = 0
let minX = width, maxX = -1, minY = height, maxY = -1
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    if (isWhale((y * width + x) * 4)) {
      mask[y * width + x] = 1
      count++
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
}

console.log(`file        : ${file}`)
console.log(`size        : ${width}x${height}`)
console.log(`whale px    : ${count} (${((count / (width * height)) * 100).toFixed(2)}%)`)
if (count === 0) {
  console.log('VERDICT: no whale-blue pixels found')
  process.exit(0)
}
const bw = maxX - minX + 1
const bh = maxY - minY + 1
console.log(`bbox        : x[${minX}..${maxX}] y[${minY}..${maxY}]  (${bw}x${bh}), aspect ${(bw / bh).toFixed(2)}`)
console.log(`fill in bbox: ${((count / (bw * bh)) * 100).toFixed(1)}%`)

// Count how many pixels of the SAME shape would appear if we ignored the angle:
// report the body's own orientation from its second moments.
let sx = 0, sy = 0
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) if (mask[y * width + x]) { sx += x; sy += y }
}
const cx = sx / count
const cy = sy / count
let mxx = 0, myy = 0, mxy = 0
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    if (!mask[y * width + x]) continue
    const dx = x - cx
    const dy = y - cy
    mxx += dx * dx
    myy += dy * dy
    mxy += dx * dy
  }
}
mxx /= count; myy /= count; mxy /= count
const theta = 0.5 * Math.atan2(2 * mxy, mxx - myy)
console.log(`centroid    : (${cx.toFixed(0)}, ${cy.toFixed(0)})`)
console.log(`major axis  : ${((theta * 180) / Math.PI).toFixed(1)}deg from +x (0=horizontal)`)

// ASCII trace of the bbox region.
console.log(`\n--- traced silhouette (${COLS}x${ROWS}) ---`)
const cw = bw / COLS
const ch = bh / ROWS
let art = ''
for (let ry = 0; ry < ROWS; ry++) {
  let line = ''
  for (let rx = 0; rx < COLS; rx++) {
    // Sample the cell; mark it filled when a decent share of it is whale.
    let hits = 0
    let total = 0
    const x0 = Math.floor(minX + rx * cw)
    const x1 = Math.max(x0 + 1, Math.floor(minX + (rx + 1) * cw))
    const y0 = Math.floor(minY + ry * ch)
    const y1 = Math.max(y0 + 1, Math.floor(minY + (ry + 1) * ch))
    for (let y = y0; y < y1 && y < height; y++) {
      for (let x = x0; x < x1 && x < width; x++) {
        total++
        if (mask[y * width + x]) hits++
      }
    }
    const ratio = total === 0 ? 0 : hits / total
    line += ratio > 0.6 ? '#' : ratio > 0.25 ? '+' : ratio > 0.05 ? '.' : ' '
  }
  art += line + '\n'
}
console.log(art)
