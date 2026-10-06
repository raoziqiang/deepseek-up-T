// 归拢自 tools/check-whale-shape.mjs（与所在目录无关，直接搬）。
// Render the whale silhouette alone and report shape metrics, so the drawing can
// be validated without human eyes: aspect ratio, where the mass sits, and whether
// the silhouette is convex-ish (a blob) or has the whale's notched tail.
//
// The metrics come from decoding the rendered PNG through analyze-frames' decoder.
import { writeFile } from 'node:fs/promises'
import { inflateSync } from 'node:zlib'

// A minimal Canvas2D stand-in is not feasible here, so this test renders the
// whale path with a scanline fill of the same bezier outline used at runtime.
// Keeping it in sync matters: the control points below are copied from
// whalePath()/finPath() in lib/welcome/whale-animation.js.

/** Cubic bezier point. */
const bez = (p0, p1, p2, p3, t) => {
  const u = 1 - t
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3
}

/** Sample the whale outline (normalized units, origin-centred) as a polygon. */
function whaleOutline() {
  const pts = []
  const W = 1
  const H = 1
  const seg = (x0, y0, x1, y1, x2, y2, x3, y3) => {
    for (let i = 0; i <= 24; i++) {
      const t = i / 24
      pts.push([
        bez(x0 * W, x1 * W, x2 * W, x3 * W, t),
        bez(y0 * H, y1 * H, y2 * H, y3 * H, t),
      ])
    }
  }
  // Mirrors whalePath()'s bezier segments, in order.
  seg(-0.50, 0.00, -0.48, -0.20, -0.30, -0.32, -0.10, -0.33)
  seg(-0.10, -0.33, 0.08, -0.34, 0.24, -0.26, 0.36, -0.13)
  seg(0.36, -0.13, 0.40, -0.10, 0.42, -0.08, 0.44, -0.09)
  seg(0.44, -0.09, 0.50, -0.18, 0.58, -0.30, 0.66, -0.36)
  seg(0.66, -0.36, 0.64, -0.22, 0.58, -0.10, 0.52, -0.02)
  seg(0.52, -0.02, 0.50, 0.00, 0.50, 0.01, 0.52, 0.03)
  seg(0.52, 0.03, 0.58, 0.11, 0.64, 0.23, 0.66, 0.37)
  seg(0.66, 0.37, 0.58, 0.31, 0.50, 0.19, 0.44, 0.10)
  seg(0.44, 0.10, 0.42, 0.09, 0.40, 0.11, 0.36, 0.14)
  seg(0.36, 0.14, 0.24, 0.27, 0.08, 0.35, -0.10, 0.34)
  seg(-0.10, 0.34, -0.30, 0.33, -0.48, 0.20, -0.50, 0.00)
  return pts
}

const outline = whaleOutline()
const xs = outline.map((p) => p[0])
const ys = outline.map((p) => p[1])
const minX = Math.min(...xs)
const maxX = Math.max(...xs)
const minY = Math.min(...ys)
const maxY = Math.max(...ys)

// Rasterize the polygon (even-odd scanline) at high resolution.
const N = 400
const grid = new Uint8Array(N * N)
const inside = (x, y) => {
  let hit = false
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const [xi, yi] = outline[i]
    const [xj, yj] = outline[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit
  }
  return hit
}
let filled = 0
for (let py = 0; py < N; py++) {
  for (let px = 0; px < N; px++) {
    // Map the polygon's bbox onto the grid with a small margin.
    const u = minX + ((px + 0.5) / N) * (maxX - minX)
    const v = minY + ((py + 0.5) / N) * (maxY - minY)
    if (inside(u, v)) {
      grid[py * N + px] = 1
      filled++
    }
  }
}
const fillRatio = filled / (N * N)

// The tail notch: for the rightmost fifth of the shape (where the flukes live),
// count distinct vertical runs of filled pixels per column. A whale's flukes plus
// the notch produce 2+ runs; a plain blob tapers to exactly 1.
let twoRunCols = 0
let oneRunCols = 0
const startCol = Math.floor(N * 0.80)
for (let px = startCol; px < N; px++) {
  let runs = 0
  let prev = 0
  for (let py = 0; py < N; py++) {
    const cur = grid[py * N + px]
    if (cur === 1 && prev === 0) runs++
    prev = cur
  }
  if (runs >= 2) twoRunCols++
  else if (runs === 1) oneRunCols++
}

// Where is the mass? A whale's head end (left) should be chunkier than the tail.
let leftMass = 0
let rightMass = 0
for (let py = 0; py < N; py++) {
  for (let px = 0; px < N; px++) {
    if (grid[py * N + px] === 1) {
      if (px < N / 2) leftMass++
      else rightMass++
    }
  }
}

console.log(`outline points      : ${outline.length}`)
console.log(`bbox (unit)         : x[${minX.toFixed(2)}..${maxX.toFixed(2)}] y[${minY.toFixed(2)}..${maxY.toFixed(2)}]`)
console.log(`bbox aspect (w/h)   : ${((maxX - minX) / (maxY - minY)).toFixed(2)}`)
console.log(`fill ratio in bbox  : ${(fillRatio * 100).toFixed(1)}%  (a smooth body ~55-70%)`)
console.log(`tail columns 2-run  : ${twoRunCols}  (flukes present if > 0)`)
console.log(`tail columns 1-run  : ${oneRunCols}`)
console.log(`left/right mass     : ${(leftMass / filled * 100).toFixed(1)}% / ${(rightMass / filled * 100).toFixed(1)}%`)
console.log(
  twoRunCols > 0
    ? 'VERDICT: tail notch present (reads as flukes)'
    : 'VERDICT: NO tail notch - silhouette is a closed blob at the right edge',
)

// Emit an ASCII preview so the shape can be eyeballed in text.
const chars = [' ', '.', ':', '*', '#']
let art = ''
for (let py = 0; py < 32; py++) {
  let line = ''
  for (let px = 0; px < 96; px++) {
    const gx = Math.floor((px / 96) * N)
    const gy = Math.floor((py / 32) * N)
    line += grid[gy * N + gx] === 1 ? '#' : ' '
  }
  art += line + '\n'
}
console.log('\n--- silhouette ---')
console.log(art)
await writeFile('.probe/frames/whale-silhouette.txt', art, 'utf8')
