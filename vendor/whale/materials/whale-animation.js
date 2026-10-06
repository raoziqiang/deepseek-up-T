/**
 * The whale splash animation engine.
 *
 * Timeline (one shot, then it rests as a pendant):
 *   0.00–0.18  unfurl   A scroll of rice paper unrolls across the window,
 *                       left-to-right, with a rolled-up rod at each edge.
 *   0.10–0.62  breach   A large blue whale arcs right-to-left across the scroll:
 *                       it rises from the lower right, peaks at the top, and
 *                       falls toward the lower left.
 *   0.14–0.70  splash   Pixelated spray and foam burst where the whale leaves and
 *                       re-enters the water, quantized to a chunky pixel grid.
 *   0.62–1.00  settle   Everything contracts and folds down into a small blue
 *                       whale charm hanging from a cord.
 *   1.00+      pendant  The charm dangles idly; it can be dragged anywhere.
 *
 * The module is deliberately free of DOM globals beyond the canvas it is handed,
 * so it runs unchanged in the Electron welcome window and in a plain browser.
 */

/** Chunky pixel size for the quantized spray, in CSS pixels. */
const PIXEL = 6

const clamp = (value, min, max) => (value < min ? min : value > max ? max : value)
const lerp = (a, b, t) => a + (b - a) * t
const easeOutCubic = (t) => 1 - (1 - t) ** 3
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)
const easeOutBack = (t) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2

/** Deterministic PRNG so every launch looks the same (mulberry32). */
function makeRandom(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * The whale body silhouette, drawn into a box `w` wide and `h` tall, centred on
 * the origin. The snout is at the LEFT and the tail flukes at the RIGHT, so a
 * whale travelling leftward faces its direction of travel.
 *
 * The outline is one continuous closed path: a tapered body that meets a narrow
 * caudal peduncle, then splits into the upper and lower flukes around a deep
 * notch at the right edge. Drawing it as a single path (rather than a body plus
 * separate flukes) keeps the silhouette readable at charm size.
 */
export function whalePath(ctx, w, h) {
  const X = (v) => v * w
  const Y = (v) => v * h
  ctx.beginPath()
  // Snout: blunt and slightly rounded, left edge.
  ctx.moveTo(X(-0.50), Y(0.00))
  // Top of the head, rising into the back.
  ctx.bezierCurveTo(X(-0.48), Y(-0.20), X(-0.30), Y(-0.32), X(-0.10), Y(-0.33))
  // Back tapering toward the peduncle.
  ctx.bezierCurveTo(X(0.08), Y(-0.34), X(0.24), Y(-0.26), X(0.36), Y(-0.13))
  // Peduncle narrows, then the upper fluke sweeps out and back.
  ctx.bezierCurveTo(X(0.40), Y(-0.10), X(0.42), Y(-0.08), X(0.44), Y(-0.09))
  ctx.bezierCurveTo(X(0.50), Y(-0.18), X(0.58), Y(-0.30), X(0.66), Y(-0.36))
  // Trailing edge of the upper fluke.
  ctx.bezierCurveTo(X(0.64), Y(-0.22), X(0.58), Y(-0.10), X(0.52), Y(-0.02))
  // The fluke notch: dip toward the centre, then out to the lower fluke.
  ctx.bezierCurveTo(X(0.50), Y(0.00), X(0.50), Y(0.01), X(0.52), Y(0.03))
  ctx.bezierCurveTo(X(0.58), Y(0.11), X(0.64), Y(0.23), X(0.66), Y(0.37))
  // Trailing edge of the lower fluke.
  ctx.bezierCurveTo(X(0.58), Y(0.31), X(0.50), Y(0.19), X(0.44), Y(0.10))
  ctx.bezierCurveTo(X(0.42), Y(0.09), X(0.40), Y(0.11), X(0.36), Y(0.14))
  // Belly, sweeping forward under the jaw to the snout.
  ctx.bezierCurveTo(X(0.24), Y(0.27), X(0.08), Y(0.35), X(-0.10), Y(0.34))
  ctx.bezierCurveTo(X(-0.30), Y(0.33), X(-0.48), Y(0.20), X(-0.50), Y(0.00))
  ctx.closePath()
}

/** Pectoral fin, drawn separately so it can sweep with the stroke. */
function finPath(ctx, w, h) {
  ctx.beginPath()
  ctx.moveTo(-0.20 * w, 0.14 * h)
  ctx.bezierCurveTo(-0.16 * w, 0.30 * h, -0.08 * w, 0.42 * h, 0.02 * w, 0.44 * h)
  ctx.bezierCurveTo(0.00 * w, 0.28 * h, -0.06 * w, 0.16 * h, -0.10 * w, 0.10 * h)
  ctx.closePath()
}

/**
 * Draw a blue whale centred on the current transform origin.
 * @param ctx - 2D context, already translated/rotated by the caller.
 * @param w - body length in CSS pixels.
 * @param h - body height in CSS pixels.
 * @param detail - whether to draw eye, belly grooves, and fin.
 * @param light - theme-light body palette flag.
 */
export function drawWhale(ctx, w, h, detail = true, light = false) {
  const body = ctx.createLinearGradient(0, -0.4 * h, 0, 0.4 * h)
  if (light) {
    body.addColorStop(0, '#4d93f8')
    body.addColorStop(0.55, '#2f6fd8')
    body.addColorStop(1, '#1f4fa8')
  } else {
    body.addColorStop(0, '#7aaaff')
    body.addColorStop(0.55, '#4176e6')
    body.addColorStop(1, '#2a4f9e')
  }

  if (detail) {
    ctx.save()
    ctx.globalAlpha = 0.95
    ctx.fillStyle = light ? '#2f6fd8' : '#4176e6'
    ctx.save()
    ctx.translate(0.02 * w, 0.02 * h)
    ctx.rotate(0.25)
    finPath(ctx, w, h)
    ctx.fill()
    ctx.restore()
    ctx.restore()
  }

  whalePath(ctx, w, h)
  ctx.fillStyle = body
  ctx.fill()

  if (!detail) return

  // Belly grooves: thin lighter arcs along the underside.
  ctx.save()
  whalePath(ctx, w, h)
  ctx.clip()
  ctx.strokeStyle = light ? 'rgba(228, 237, 253, 0.55)' : 'rgba(211, 226, 255, 0.5)'
  ctx.lineWidth = Math.max(1, 0.012 * h)
  for (let i = 1; i <= 4; i++) {
    const y = 0.06 * h + i * 0.055 * h
    ctx.beginPath()
    ctx.moveTo(-0.44 * w, y)
    ctx.quadraticCurveTo(-0.1 * w, y + 0.05 * h, 0.3 * w, y * 0.5)
    ctx.stroke()
  }
  ctx.restore()

  // Eye.
  ctx.save()
  ctx.fillStyle = light ? '#0f1115' : '#0b1220'
  ctx.beginPath()
  ctx.arc(-0.34 * w, -0.06 * h, Math.max(1.2, 0.028 * h), 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = 'rgba(255,255,255,0.85)'
  ctx.beginPath()
  ctx.arc(-0.352 * w, -0.072 * h, Math.max(0.5, 0.010 * h), 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

/**
 * The animated splash scene.
 *
 * Owns the canvas, the timeline clock, the particle field, the unfurling scroll,
 * and the final charm. All geometry is expressed in CSS pixels against the live
 * canvas size, so it survives any window size and DPR.
 */
export class WhaleSplash {
  /**
   * @param canvas - the canvas to render into.
   * @param options - tuning: `durationMs`, `seed`, `onPendant`.
   */
  constructor(canvas, options = {}) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')
    this.durationMs = options.durationMs ?? 4200
    this.seed = options.seed ?? 0x5eed
    this.onPendant = options.onPendant ?? (() => {})
    this.random = makeRandom(this.seed)
    this.particles = []
    this.phase = 'idle'
    this.startedAt = 0
    this.raf = 0
    this.dpr = 1
    this.width = 0
    this.height = 0
    this.pendant = { x: 0, y: 0, placed: false }
    this.reduced = typeof matchMedia === 'function'
      && matchMedia('(prefers-reduced-motion: reduce)').matches
    this._onResize = () => this.resize()
    this._tick = (now) => this.frame(now)
  }

  /** Attach to the live window and begin the timeline. */
  start() {
    this.resize()
    window.addEventListener('resize', this._onResize)
    this.dark = document.body.hasAttribute('data-ds-dark-theme')
    this.startedAt = performance.now()
    this.phase = 'running'
    this.raf = requestAnimationFrame(this._tick)
  }

  /** Stop the loop and detach listeners. */
  stop() {
    cancelAnimationFrame(this.raf)
    this.raf = 0
    window.removeEventListener('resize', this._onResize)
  }

  /** Re-read the canvas size and DPR; called on start and on every resize. */
  resize() {
    const rect = this.canvas.getBoundingClientRect()
    const dpr = clamp(window.devicePixelRatio || 1, 1, 2.5)
    this.width = Math.max(1, Math.round(rect.width))
    this.height = Math.max(1, Math.round(rect.height))
    this.dpr = dpr
    this.canvas.width = Math.round(this.width * dpr)
    this.canvas.height = Math.round(this.height * dpr)
    this.layout()
  }

  /** Recompute size-dependent geometry (scroll box, whale scale, pendant rest). */
  layout() {
    const w = this.width
    const h = this.height

    // The scroll fills most of the frame, with a margin for the rods.
    const margin = Math.round(clamp(Math.min(w, h) * 0.055, 12, 56))
    this.scroll = {
      x: margin,
      y: margin,
      w: Math.max(1, w - margin * 2),
      h: Math.max(1, h - margin * 2),
    }

    // Water line sits low in the scroll; the whale breaches above it.
    this.waterY = this.scroll.y + this.scroll.h * 0.74

    // The breaching whale is the scene's subject, so it takes a large share of
    // the scroll's width. Its height follows the path's own 1.59 aspect ratio so
    // the body is never squashed.
    const len = this.scroll.w * 0.62
    this.whale = { len, height: len / 1.59 }

    if (!this.pendant.placed) {
      const size = this.pendantSize()
      this.pendant.x = this.scroll.x + this.scroll.w - size * 0.9
      this.pendant.y = this.scroll.y + size * 1.5
    }
  }

  /** Chord-and-charm size, shared by the settle animation and the pendant. */
  pendantSize() {
    return clamp(Math.min(this.width, this.height) * 0.13, 44, 96)
  }

  /** Spawn one burst of pixelated spray at a point. */
  burst(x, y, count, spread, power) {
    for (let i = 0; i < count; i++) {
      const angle = -Math.PI / 2 + (this.random() - 0.5) * spread
      const speed = power * (0.45 + this.random() * 0.75)
      this.particles.push({
        x,
        y,
        // `power` is in CSS pixels per second; the arc reads as a real fountain.
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        // Short lives keep the spray as a burst at the breach, not a fog.
        life: 0.34 + this.random() * 0.34,
        age: 0,
        size: 1 + Math.floor(this.random() * 2),
        tone: this.random(),
      })
    }
  }

  /** Advance and draw one frame. */
  frame(now) {
    const t = this.reduced
      ? 1
      : clamp((now - this.startedAt) / this.durationMs, 0, 1)
    this.render(t)
    if (t < 1) {
      this.raf = requestAnimationFrame(this._tick)
      return
    }
    if (this.phase === 'running') {
      this.phase = 'pendant'
      this.onPendant()
    }
    // Keep a slow pendulum running for the resting charm.
    this.raf = requestAnimationFrame((next) => this.idleFrame(next))
  }

  /** The pendant's resting animation: a gentle swing, nothing else. */
  idleFrame(now) {
    if (this.phase !== 'pendant') return
    this.render(1, now)
    this.raf = requestAnimationFrame((next) => this.idleFrame(next))
  }

  /** Draw the whole scene at timeline progress `t` in [0, 1]. */
  render(t, now = performance.now()) {
    const ctx = this.ctx
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.clearRect(0, 0, this.width, this.height)

    const dark = document.body.hasAttribute('data-ds-dark-theme')
    this.dark = dark

    // Scene phases, each with its own window on the timeline.
    const unfurl = clamp(t / 0.18, 0, 1)
    const breach = clamp((t - 0.10) / 0.52, 0, 1)
    const settle = clamp((t - 0.62) / 0.38, 0, 1)

    this.drawBackdrop(dark, t)
    if (settle < 1) {
      this.drawScrollPaper(unfurl, settle, dark)
      this.drawWaterLine(unfurl, settle, dark)
      this.advanceParticles(breach, settle)
      this.drawParticles(dark, settle)
      this.drawWhale(breach, settle, dark, unfurl)
      this.drawScrollRods(unfurl, settle, dark)
    }
    if (settle > 0) this.drawPendant(settle, now, dark)
  }

  /** The window backdrop behind the scroll. */
  drawBackdrop(dark, t) {
    const ctx = this.ctx
    const g = ctx.createLinearGradient(0, 0, 0, this.height)
    if (dark) {
      g.addColorStop(0, '#0b1220')
      g.addColorStop(1, '#111c33')
    } else {
      g.addColorStop(0, '#eef4ff')
      g.addColorStop(1, '#dbe8ff')
    }
    ctx.fillStyle = g
    ctx.fillRect(0, 0, this.width, this.height)

    // A soft radial glow that swells as the whale peaks.
    const peak = Math.sin(clamp((t - 0.1) / 0.62, 0, 1) * Math.PI)
    if (peak > 0.01) {
      const cx = this.width * 0.5
      const cy = this.waterY
      const r = Math.max(this.width, this.height) * (0.35 + 0.25 * peak)
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
      glow.addColorStop(0, dark ? `rgba(96,165,250,${0.22 * peak})` : `rgba(147,197,253,${0.4 * peak})`)
      glow.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = glow
      ctx.fillRect(0, 0, this.width, this.height)
    }
  }

  /** The unfurling rice-paper scroll: it wipes open left-to-right. */
  drawScrollPaper(unfurl, settle, dark) {
    const ctx = this.ctx
    const s = this.scroll
    const open = easeOutCubic(unfurl)

    ctx.save()
    // The scroll contracts toward the charm as it settles.
    const shrink = easeInOutCubic(settle)
    const cx = lerp(s.x + s.w / 2, this.pendant.x, shrink)
    const cy = lerp(s.y + s.h / 2, this.pendant.y, shrink)
    const sw = s.w * lerp(1, 0.22, shrink)
    const sh = s.h * lerp(1, 0.22, shrink)
    ctx.translate(cx, cy)
    ctx.globalAlpha = lerp(1, 0.0, clamp((settle - 0.55) / 0.45, 0, 1))

    // Paper body, revealed by the unfurl wipe and centred on the growing rod.
    const wipeW = sw * open
    const x0 = -wipeW / 2
    const y0 = -sh / 2

    ctx.beginPath()
    ctx.rect(x0, y0, wipeW, sh)
    const paper = ctx.createLinearGradient(0, y0, 0, y0 + sh)
    if (dark) {
      paper.addColorStop(0, '#f3f6fb')
      paper.addColorStop(0.55, '#e6edf9')
      paper.addColorStop(1, '#d3ddec')
    } else {
      paper.addColorStop(0, '#ffffff')
      paper.addColorStop(0.55, '#f6f9ff')
      paper.addColorStop(1, '#e8f0fd')
    }
    ctx.fillStyle = paper
    ctx.shadowColor = dark ? 'rgba(0,0,0,0.5)' : 'rgba(31,79,168,0.22)'
    ctx.shadowBlur = Math.max(8, sw * 0.02)
    ctx.shadowOffsetY = Math.max(2, sh * 0.006)
    ctx.fill()
    ctx.shadowColor = 'transparent'
    ctx.shadowBlur = 0
    ctx.shadowOffsetY = 0

    // Faint vertical rules, the suggestion of a handscroll's columns.
    ctx.save()
    ctx.beginPath()
    ctx.rect(x0, y0, wipeW, sh)
    ctx.clip()
    ctx.strokeStyle = dark ? 'rgba(65,118,230,0.10)' : 'rgba(65,118,230,0.12)'
    ctx.lineWidth = 1
    const cols = 9
    for (let i = 1; i < cols; i++) {
      const x = x0 + (wipeW * i) / cols
      ctx.beginPath()
      ctx.moveTo(x, y0 + sh * 0.05)
      ctx.lineTo(x, y0 + sh * 0.95)
      ctx.stroke()
    }
    ctx.restore()
    ctx.restore()
  }

  /** The paper's rolled rods: one at each edge, tracking the unfurl wipe. */
  drawScrollRods(unfurl, settle, dark) {
    const ctx = this.ctx
    const s = this.scroll
    const open = easeOutCubic(unfurl)
    const shrink = easeInOutCubic(settle)
    const cx = lerp(s.x + s.w / 2, this.pendant.x, shrink)
    const cy = lerp(s.y + s.h / 2, this.pendant.y, shrink)
    const sw = s.w * lerp(1, 0.22, shrink)
    const sh = s.h * lerp(1, 0.22, shrink)
    const wipeW = sw * open
    const rodR = Math.max(4, sh * 0.035)

    ctx.save()
    ctx.globalAlpha = lerp(1, 0, clamp((settle - 0.5) / 0.5, 0, 1))
    ctx.translate(cx, cy)
    for (const side of [-1, 1]) {
      const x = (side * wipeW) / 2
      const rod = ctx.createLinearGradient(x - rodR, 0, x + rodR, 0)
      if (dark) {
        rod.addColorStop(0, '#6b7fa3')
        rod.addColorStop(0.5, '#9aa9c4')
        rod.addColorStop(1, '#5c6f92')
      } else {
        rod.addColorStop(0, '#8fa4c9')
        rod.addColorStop(0.5, '#c3d2ea')
        rod.addColorStop(1, '#7e93b8')
      }
      ctx.fillStyle = rod
      ctx.beginPath()
      ctx.roundRect(x - rodR, -sh / 2 - rodR * 0.6, rodR * 2, sh + rodR * 1.2, rodR)
      ctx.fill()
      // Gold end caps.
      ctx.fillStyle = dark ? '#c8a24a' : '#d9b45e'
      for (const ey of [-sh / 2 - rodR * 0.6, sh / 2 + rodR * 0.6]) {
        ctx.beginPath()
        ctx.arc(x, ey, rodR * 0.75, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    ctx.restore()
  }

  /** The water line, drawn as a chunky pixel-stepped band. */
  drawWaterLine(unfurl, settle, dark) {
    const ctx = this.ctx
    const s = this.scroll
    const open = easeOutCubic(unfurl)
    const shrink = easeInOutCubic(settle)
    const cx = lerp(s.x + s.w / 2, this.pendant.x, shrink)
    const cy = lerp(s.y + s.h / 2, this.pendant.y, shrink)
    const sw = s.w * lerp(1, 0.22, shrink)
    const sh = s.h * lerp(1, 0.22, shrink)
    const wipeW = sw * open
    const x0 = cx - wipeW / 2
    const y0 = cy - sh / 2

    const localWater = this.waterY - (s.y + s.h / 2) + sh / 2
    const rowTop = y0 + localWater
    const rows = Math.max(1, Math.round((y0 + sh - rowTop) / PIXEL))

    ctx.save()
    ctx.globalAlpha = lerp(0.95, 0, clamp((settle - 0.45) / 0.55, 0, 1))
    ctx.beginPath()
    ctx.rect(x0, y0, wipeW, sh)
    ctx.clip()
    for (let r = 0; r < rows; r++) {
      const y = rowTop + r * PIXEL
      const depth = r / Math.max(1, rows - 1)
      const tone = dark
        ? `rgba(${Math.round(lerp(65, 23, depth))},${Math.round(lerp(118, 61, depth))},${Math.round(lerp(230, 148, depth))},${lerp(0.9, 0.65, depth)})`
        : `rgba(${Math.round(lerp(147, 65, depth))},${Math.round(lerp(197, 118, depth))},${Math.round(lerp(253, 230, depth))},${lerp(0.95, 0.7, depth)})`
      ctx.fillStyle = tone
      ctx.fillRect(x0, y, wipeW, PIXEL)
    }
    ctx.restore()
  }

  /** Integrate the spray particles and drop the dead ones. */
  advanceParticles(breach, settle) {
    // Two emission moments: the whale leaving the water, and re-entering.
    // Counts stay modest so the spray reads as a burst at the breach rather than
    // a wash that hides the whale.
    if (!this._e1 && breach > 0.02 && breach < 0.2) {
      this._e1 = true
      const n = this.reduced ? 10 : 46
      this.burst(this.exitX(), this.waterY, n, 1.5, this.scroll.h * 0.85)
    }
    if (!this._e2 && breach > 0.88) {
      this._e2 = true
      const n = this.reduced ? 12 : 62
      this.burst(this.entryX(), this.waterY, n, 1.0, this.scroll.h * 1.1)
    }

    // Fixed-step integration, in seconds. A frame budget of 1/60 s keeps the
    // motion identical regardless of the display's refresh rate.
    const dt = 1 / 60
    const gravity = this.scroll.h * 1.6
    for (const p of this.particles) {
      p.age += dt
      p.vy += gravity * dt
      p.x += p.vx * dt
      p.y += p.vy * dt
    }
    this.particles = this.particles.filter((p) => p.age < p.life)
  }

  /** Where the whale leaves the water (its tail-side), in CSS pixels. */
  exitX() {
    const s = this.scroll
    return s.x + s.w * 0.74
  }

  /** Where the whale re-enters the water, in CSS pixels. */
  entryX() {
    const s = this.scroll
    return s.x + s.w * 0.28
  }

  /** Draw the spray as chunky, quantized "pixel" blocks. */
  drawParticles(dark, settle) {
    const ctx = this.ctx
    ctx.save()
    ctx.globalAlpha = lerp(1, 0, clamp((settle - 0.3) / 0.7, 0, 1))
    for (const p of this.particles) {
      const life = 1 - p.age / p.life
      const px = Math.round(p.x / PIXEL) * PIXEL
      const py = Math.round(p.y / PIXEL) * PIXEL
      // Blocks stay chunky but bounded, so a near-camera particle cannot blanket
      // the scene. They also shrink as they age, as droplets do.
      const size = PIXEL * clamp(p.size * life * 1.1, 0.5, 2.6)
      // Foam drifts white; spray keeps a blue cast.
      const blue = 1 - p.tone
      const r = Math.round(lerp(255, 147, blue * 0.75))
      const g = Math.round(lerp(255, 197, blue * 0.75))
      const b = 255
      ctx.fillStyle = dark
        ? `rgba(${r},${g},${b},${clamp(life, 0, 1) * 0.92})`
        : `rgba(${Math.round(r * 0.82)},${Math.round(g * 0.86)},${b},${clamp(life, 0, 1) * 0.9})`
      ctx.fillRect(px - size / 2, py - size / 2, size, size)
    }
    ctx.restore()
  }

  /** Draw the breaching whale travelling right-to-left in an arc. */
  drawWhale(breach, settle, dark, unfurl = 1) {
    if (breach <= 0) return
    const ctx = this.ctx
    const s = this.scroll
    const e = easeInOutCubic(breach)

    // Horizontal travel, right to left. The range is inset by the whale's own
    // half-length so the body (plus its flukes) stays inside the scroll instead
    // of hanging off the edge at the extremes of the arc.
    const half = this.whale.len * 0.66
    const startX = s.x + s.w - half * 0.95
    const endX = s.x + half * 0.95
    const x = lerp(startX, endX, e)

    // Vertical arc: a parabola rising from the water to a peak below the scroll's
    // top edge, then falling back. The peak is clamped so the whale never clips
    // out of the paper.
    const peak = s.y + Math.max(s.h * 0.20, this.whale.height * 0.62)
    const apex = Math.sin(breach * Math.PI)
    const y = lerp(this.waterY, peak, apex)

    // Rotation follows the velocity of the arc, plus a flourish on entry/exit.
    const slope = Math.cos(breach * Math.PI) * Math.PI
    const rot = clamp(-slope * 0.55, -1.15, 1.15)

    const len = this.whale.len * (1 - 0.75 * easeInOutCubic(settle))
    const ht = this.whale.height * (1 - 0.75 * easeInOutCubic(settle))

    ctx.save()
    // Clip to the unfurled paper: the whale breaches ON the scroll, so it must
    // never ride out over the backdrop.
    const open = easeOutCubic(unfurl)
    const wipeW = s.w * open
    ctx.beginPath()
    ctx.rect(s.x + (s.w - wipeW) / 2, s.y, wipeW, s.h)
    ctx.clip()
    ctx.globalAlpha = lerp(1, 0.25, clamp((settle - 0.2) / 0.8, 0, 1))
    ctx.translate(x, y)
    ctx.rotate(rot)
    // A subtle scale wobble reads as a body flex.
    const flex = 1 + 0.05 * Math.sin(breach * Math.PI * 2.2)
    ctx.scale(flex, 1 / flex)
    drawWhale(ctx, len, ht, len > 40, !dark)
    ctx.restore()
  }

  /** The settled charm: a small whale hanging from a cord, swinging gently. */
  drawPendant(settle, now, dark) {
    const ctx = this.ctx
    const e = easeOutBack(clamp(settle, 0, 1))
    const size = this.pendantSize() * clamp(e, 0.01, 1.35)
    const x = this.pendant.x
    const y = this.pendant.y

    // Resting swing, damped in as the settle completes.
    const swingAmp = 0.10 * clamp((settle - 0.5) / 0.5, 0, 1)
    const swing = Math.sin(now / 1450) * swingAmp

    ctx.save()
    ctx.globalAlpha = clamp(settle * 1.6, 0, 1)

    // Cord, hanging from the top of the scroll area.
    const anchorY = Math.max(0, this.scroll.y - 4)
    ctx.strokeStyle = dark ? 'rgba(154,169,196,0.85)' : 'rgba(126,147,184,0.85)'
    ctx.lineWidth = Math.max(1, size * 0.022)
    ctx.beginPath()
    ctx.moveTo(x, anchorY)
    ctx.quadraticCurveTo(
      x + Math.sin(swing) * size * 0.9,
      (anchorY + y) / 2,
      x + Math.sin(swing) * size * 0.35,
      y - size * 0.42,
    )
    ctx.stroke()

    ctx.translate(x + Math.sin(swing) * size * 0.35, y)
    ctx.rotate(swing)

    // A ring and a small bead, so it reads as a charm on a cord.
    ctx.strokeStyle = dark ? '#c8a24a' : '#d9b45e'
    ctx.lineWidth = Math.max(1.2, size * 0.035)
    ctx.beginPath()
    ctx.arc(0, -size * 0.44, size * 0.10, 0, Math.PI * 2)
    ctx.stroke()

    // Drop shadow under the charm.
    ctx.save()
    ctx.shadowColor = dark ? 'rgba(0,0,0,0.55)' : 'rgba(31,79,168,0.3)'
    ctx.shadowBlur = size * 0.28
    ctx.shadowOffsetY = size * 0.10
    // The charm's body keeps the whale path's own 1.59 aspect ratio, so the
    // finished whale is never stretched into a lens shape.
    const charmLen = size * 1.15
    drawWhale(ctx, charmLen, charmLen / 1.59, true, !dark)
    ctx.restore()
    ctx.restore()
  }
}

export { PIXEL, clamp, lerp }
