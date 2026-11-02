/**
 * DSH cyber splash — the welcome window's startup animation (sci-fi × cyberpunk).
 *
 * Classic script (the welcome window's CSP forbids ESM). No dependencies, Canvas 2D only,
 * so it runs everywhere the welcome window does — no WebGL fallback path to rot.
 *
 * Timeline (DURATION_MS = 3600):
 *     0 –  320  CRT power-on: a bright line opens into the frame
 *   150 –  600  neon perspective grid + digital rain fade in
 *   350 –  900  HUD scan ring locks on
 *   750 – 1250  holographic whale materialises (glitch burst)
 *  1300 – 2400  title decodes out of random glyphs, subtitle types in
 *   200 – 2900  boot log types, sync bar fills
 *  3080 – 3600  CRT power-off: the frame collapses to a line, then a dot, revealing the UI
 *
 * Everything is a pure function of time (seeded noise), so `renderAt(t)` reproduces any frame
 * exactly — the offline tests and frame captures rely on that.
 *
 *   window.CyberSplash            class
 *   window.CyberSplash.DURATION_MS
 *   new CyberSplash(canvas, { durationMs?, onDone?, imageSrc?, interactive? })
 *     .start()   .stop()   .skip()   .renderAt(ms)
 */
;(() => {
  'use strict'

  const DURATION_MS = 3600
  const EXIT_MS = 520

  const PAL = {
    bg0: '#04020a',
    bg1: '#0b0620',
    bg2: '#1a0733',
    cyan: '#00f0ff',
    magenta: '#ff2bd6',
    violet: '#7a3cff',
    amber: '#ffb000',
    white: '#e9fdff',
  }
  const rgba = (hex, a) => {
    const n = parseInt(hex.slice(1), 16)
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Math.max(0, Math.min(1, a)).toFixed(3)})`
  }

  const MONO = '"Cascadia Mono", Consolas, "JetBrains Mono", "SFMono-Regular", Menlo, monospace'
  const GLYPHS = '0123456789ABCDEF<>/\\[]{}#$%&*+=?:'
  const TITLE = 'DEEPSEEK HARNESS'
  const SUBTITLE = 'NEURAL SHELL // ONLINE'
  const BOOT_LINES = [
    'DSH//BIOS 5.1 :: cold boot',
    'mount neural.core ........ OK',
    'link deepseek.uplink ..... OK',
    'decrypt harness.shell .... OK',
    'spawn agents [####] ...... OK',
    '> ready_',
  ]
  /** [start ms, length ms, strength 0..1] — short glitch bursts. */
  const BURSTS = [[720, 150, 1], [1960, 110, 0.7], [2620, 70, 0.45]]

  // ── tiny math kit ────────────────────────────────────────────────────
  const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x)
  const span = (t, a, b) => clamp01((t - a) / (b - a))
  const smooth = (t, a, b) => { const x = span(t, a, b); return x * x * (3 - 2 * x) }
  const easeOut = (x) => 1 - (1 - x) * (1 - x) * (1 - x)
  /** Deterministic noise in [0, 1) from an integer seed (mulberry32 step). */
  const rnd = (seed) => {
    let t = (seed + 0x6d2b79f5) | 0
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const glyph = (seed) => GLYPHS[Math.floor(rnd(seed) * GLYPHS.length)]

  function glitchAt(t, duration) {
    let g = 0
    for (const [s, len, k] of BURSTS) {
      if (t >= s && t < s + len) g = Math.max(g, k * Math.sin(Math.PI * (t - s) / len))
    }
    const exitStart = duration - EXIT_MS
    if (t >= exitStart - 90 && t < exitStart + 60) g = Math.max(g, 0.8)
    return g
  }

  // ── the hologram source: the bundled whale, tinted once into two offscreen layers ──
  function loadHologram(src, onReady) {
    if (typeof Image !== 'function' || typeof document === 'undefined') return null
    const holo = { ready: false, cyan: null, magenta: null, aspect: 1.864 }
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => {
      try {
        const iw = img.naturalWidth || img.width
        const ih = img.naturalHeight || img.height
        if (!(iw > 0 && ih > 0)) return
        const tint = (stops) => {
          const c = document.createElement('canvas')
          c.width = iw
          c.height = ih
          const x = c.getContext('2d')
          if (x === null) return null
          x.drawImage(img, 0, 0)
          // source-atop keeps the whale's own alpha — no pixel readback, so a file:// image is fine.
          x.globalCompositeOperation = 'source-atop'
          const g = x.createLinearGradient(0, 0, iw, ih)
          for (const [o, col] of stops) g.addColorStop(o, col)
          x.fillStyle = g
          x.fillRect(0, 0, iw, ih)
          return c
        }
        holo.cyan = tint([[0, rgba(PAL.cyan, 0.9)], [0.6, rgba('#3fb8ff', 0.85)], [1, rgba(PAL.violet, 0.85)]])
        holo.magenta = tint([[0, rgba(PAL.magenta, 0.9)], [1, rgba(PAL.magenta, 0.9)]])
        holo.aspect = iw / ih
        holo.ready = holo.cyan !== null && holo.magenta !== null
        if (holo.ready && typeof onReady === 'function') onReady()
      } catch {
        holo.ready = false
      }
    }
    img.onerror = () => { holo.ready = false }
    img.src = src
    return holo
  }

  // ── scene layers ─────────────────────────────────────────────────────
  function drawBackdrop(ctx, w, h, horizon) {
    const sky = ctx.createLinearGradient(0, 0, 0, horizon)
    sky.addColorStop(0, PAL.bg0)
    sky.addColorStop(0.65, PAL.bg1)
    sky.addColorStop(1, PAL.bg2)
    ctx.fillStyle = sky
    ctx.fillRect(0, 0, w, horizon)
    const floor = ctx.createLinearGradient(0, horizon, 0, h)
    floor.addColorStop(0, '#12052a')
    floor.addColorStop(1, PAL.bg0)
    ctx.fillStyle = floor
    ctx.fillRect(0, horizon, w, h - horizon)
  }

  /** A striped synth sun sitting on the horizon, behind everything else. */
  function drawSun(ctx, cx, horizon, r, a) {
    if (a <= 0) return
    ctx.save()
    ctx.globalAlpha = a
    const glow = ctx.createRadialGradient(cx, horizon, r * 0.2, cx, horizon, r * 2.4)
    glow.addColorStop(0, rgba(PAL.magenta, 0.35))
    glow.addColorStop(0.5, rgba(PAL.violet, 0.12))
    glow.addColorStop(1, rgba(PAL.violet, 0))
    ctx.fillStyle = glow
    ctx.fillRect(cx - r * 2.4, horizon - r * 2.4, r * 4.8, r * 2.4)

    ctx.beginPath()
    ctx.rect(cx - r, horizon - r, r * 2, r)
    ctx.clip()
    const body = ctx.createLinearGradient(0, horizon - r, 0, horizon)
    body.addColorStop(0, rgba(PAL.amber, 0.9))
    body.addColorStop(0.55, rgba(PAL.magenta, 0.85))
    body.addColorStop(1, rgba(PAL.violet, 0.6))
    ctx.fillStyle = body
    ctx.beginPath()
    ctx.arc(cx, horizon, r, Math.PI, 0)
    ctx.fill()
    // Bands cut out of the lower half, thicker toward the horizon.
    ctx.fillStyle = PAL.bg2
    for (let i = 0; i < 6; i += 1) {
      const y = horizon - r * 0.48 + i * r * 0.085
      ctx.fillRect(cx - r, y, r * 2, 1 + i * r * 0.012)
    }
    ctx.restore()
  }

  function drawGrid(ctx, w, h, horizon, t, a) {
    if (a <= 0) return
    const cx = w / 2
    const depth = h - horizon
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, horizon, w, depth)
    ctx.clip()
    ctx.lineCap = 'round'
    // Receding rows scroll toward the viewer.
    const rows = 14
    const phase = (t / 700) % 1
    for (let k = 0; k < rows; k += 1) {
      const z = (k + phase) / rows
      const y = horizon + z * z * depth
      const alpha = a * (0.12 + 0.75 * z)
      ctx.strokeStyle = rgba(PAL.magenta, alpha * 0.35)
      ctx.lineWidth = 4
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke()
      ctx.strokeStyle = rgba('#ff7ae6', alpha)
      ctx.lineWidth = 1.2
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke()
    }
    // Columns converge on the vanishing point.
    const cols = 11
    const spread = w * 1.6
    for (let i = -cols; i <= cols; i += 1) {
      const xb = cx + (i / cols) * spread
      ctx.strokeStyle = rgba(PAL.magenta, a * 0.22)
      ctx.lineWidth = 3
      ctx.beginPath(); ctx.moveTo(cx + i * 4, horizon); ctx.lineTo(xb, h); ctx.stroke()
      ctx.strokeStyle = rgba('#ff7ae6', a * 0.55)
      ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(cx + i * 4, horizon); ctx.lineTo(xb, h); ctx.stroke()
    }
    ctx.restore()
    // Horizon line glow.
    ctx.fillStyle = rgba(PAL.cyan, a * 0.7)
    ctx.fillRect(0, horizon - 0.5, w, 1.5)
    const haze = ctx.createLinearGradient(0, horizon - 18, 0, horizon + 18)
    haze.addColorStop(0, rgba(PAL.cyan, 0))
    haze.addColorStop(0.5, rgba(PAL.cyan, a * 0.18))
    haze.addColorStop(1, rgba(PAL.cyan, 0))
    ctx.fillStyle = haze
    ctx.fillRect(0, horizon - 18, w, 36)
  }

  function drawRain(ctx, w, horizon, t, a, fs) {
    if (a <= 0) return
    const colW = fs * 1.15
    const cols = Math.max(1, Math.floor(w / colW))
    ctx.save()
    ctx.font = `${fs}px ${MONO}`
    ctx.textBaseline = 'top'
    for (let c = 0; c < cols; c += 1) {
      const speed = 0.08 + rnd(c * 7 + 1) * 0.16 // px per ms
      const len = 4 + Math.floor(rnd(c * 7 + 2) * 9)
      const lane = horizon + len * fs
      const headY = ((rnd(c * 7 + 3) * lane + t * speed) % lane) - len * fs * 0.2
      const x = c * colW + colW * 0.15
      for (let j = 0; j < len; j += 1) {
        const y = headY - j * fs
        if (y < -fs || y > horizon - fs * 0.5) continue
        const fade = 1 - j / len
        const tone = j === 0 ? PAL.white : PAL.cyan
        ctx.fillStyle = rgba(tone, a * (j === 0 ? 0.55 : 0.32 * fade))
        ctx.fillText(glyph(c * 131 + j * 17 + Math.floor(t / 90)), x, y)
      }
    }
    ctx.restore()
  }

  function drawRing(ctx, cx, cy, R, t, k) {
    if (k <= 0) return
    const s = 0.7 + 0.3 * easeOut(k)
    const r = R * s
    ctx.save()
    ctx.globalAlpha = k
    ctx.lineCap = 'butt'
    // Outer segmented ring.
    const rot = t / 1400
    for (let i = 0; i < 24; i += 1) {
      if (rnd(i + 40) < 0.22) continue
      const a0 = rot + (i / 24) * Math.PI * 2
      ctx.strokeStyle = rgba(i % 6 === 0 ? PAL.magenta : PAL.cyan, 0.75)
      ctx.lineWidth = i % 6 === 0 ? 3 : 2
      ctx.beginPath()
      ctx.arc(cx, cy, r, a0, a0 + (Math.PI * 2) / 24 * 0.72)
      ctx.stroke()
    }
    // Tick marks.
    ctx.strokeStyle = rgba(PAL.cyan, 0.45)
    ctx.lineWidth = 1
    for (let i = 0; i < 72; i += 1) {
      const a0 = -rot * 0.5 + (i / 72) * Math.PI * 2
      const r0 = r * 0.88
      const r1 = r * (i % 9 === 0 ? 0.8 : 0.85)
      ctx.beginPath()
      ctx.moveTo(cx + Math.cos(a0) * r0, cy + Math.sin(a0) * r0)
      ctx.lineTo(cx + Math.cos(a0) * r1, cy + Math.sin(a0) * r1)
      ctx.stroke()
    }
    // Counter-rotating inner arcs.
    ctx.strokeStyle = rgba(PAL.violet, 0.8)
    ctx.lineWidth = 2
    for (let i = 0; i < 3; i += 1) {
      const a0 = -t / 900 + (i / 3) * Math.PI * 2
      ctx.beginPath()
      ctx.arc(cx, cy, r * 0.74, a0, a0 + 1.1)
      ctx.stroke()
    }
    // Radar sweep.
    const sweep = t / 650
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 0.88)
    g.addColorStop(0, rgba(PAL.cyan, 0))
    g.addColorStop(1, rgba(PAL.cyan, 0.16))
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.arc(cx, cy, r * 0.88, sweep, sweep + 0.6)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }

  /** Fallback core when the whale image is unavailable: a rotating wireframe hexagon. */
  function drawCore(ctx, cx, cy, R, t, k) {
    ctx.save()
    ctx.globalAlpha = k
    ctx.strokeStyle = rgba(PAL.cyan, 0.9)
    ctx.lineWidth = 2
    for (let ring = 0; ring < 2; ring += 1) {
      const r = R * (ring === 0 ? 0.42 : 0.26)
      const rot = (ring === 0 ? 1 : -1.6) * t / 1200
      ctx.beginPath()
      for (let i = 0; i <= 6; i += 1) {
        const a = rot + (i / 6) * Math.PI * 2
        const x = cx + Math.cos(a) * r
        const y = cy + Math.sin(a) * r
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
      }
      ctx.stroke()
    }
    ctx.restore()
  }

  function drawWhaleHolo(ctx, holo, cx, cy, R, t, k, g) {
    if (k <= 0) return
    // Materialising flicker: until fully in, some frames drop out.
    if (k < 1 && rnd(Math.floor(t / 40) + 900) > 0.35 + k * 0.65) return
    if (holo === null || !holo.ready) { drawCore(ctx, cx, cy, R, t, k); return }
    const ww = R * 1.62
    const wh = ww / holo.aspect
    const x = cx - ww / 2
    const y = cy - wh / 2 + Math.sin(t / 380) * R * 0.035
    const split = 1.5 + g * 7
    ctx.save()
    ctx.globalAlpha = k * 0.35
    ctx.globalCompositeOperation = 'lighter'
    ctx.drawImage(holo.magenta, x - split, y, ww, wh)
    ctx.globalAlpha = k * 0.95
    ctx.drawImage(holo.cyan, x + split * 0.4, y, ww, wh)
    ctx.restore()
    // Scanlines across the hologram + one bright travelling band.
    ctx.save()
    ctx.fillStyle = 'rgba(4, 2, 10, 0.32)'
    for (let yy = y; yy < y + wh; yy += 3) ctx.fillRect(x, yy, ww, 1)
    const band = y + ((t / 5) % (wh + 40)) - 20
    const bg = ctx.createLinearGradient(0, band - 10, 0, band + 10)
    bg.addColorStop(0, rgba(PAL.cyan, 0))
    bg.addColorStop(0.5, rgba(PAL.cyan, 0.22 * k))
    bg.addColorStop(1, rgba(PAL.cyan, 0))
    ctx.fillStyle = bg
    ctx.fillRect(x, band - 10, ww, 20)
    ctx.restore()
    // Projection cone from below.
    ctx.save()
    const cone = ctx.createLinearGradient(0, cy + R * 0.95, 0, y)
    cone.addColorStop(0, rgba(PAL.cyan, 0.22 * k))
    cone.addColorStop(1, rgba(PAL.cyan, 0))
    ctx.fillStyle = cone
    ctx.beginPath()
    ctx.moveTo(cx - R * 0.1, cy + R * 0.95)
    ctx.lineTo(cx + R * 0.1, cy + R * 0.95)
    ctx.lineTo(x + ww * 0.85, y + wh * 0.6)
    ctx.lineTo(x + ww * 0.15, y + wh * 0.6)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }

  function setSpacing(ctx, px) {
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${px}px`
  }

  function drawTitle(ctx, cx, y, fs, t, g) {
    if (t < 1300) return
    ctx.save()
    ctx.font = `700 ${fs}px ${MONO}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    setSpacing(ctx, fs * 0.18)
    let text = ''
    for (let i = 0; i < TITLE.length; i += 1) {
      const ch = TITLE[i]
      const at = 1300 + i * 45
      if (t < at) text += ' '
      else if (ch === ' ' || t >= at + 260) text += ch
      else text += glyph(i * 53 + Math.floor(t / 45))
    }
    const jitter = g * fs * 0.25
    ctx.globalCompositeOperation = 'lighter'
    ctx.fillStyle = rgba(PAL.magenta, 0.75)
    ctx.fillText(text, cx - 2 - jitter, y)
    ctx.fillStyle = rgba(PAL.cyan, 0.75)
    ctx.fillText(text, cx + 2 + jitter, y)
    ctx.globalCompositeOperation = 'source-over'
    ctx.shadowColor = PAL.cyan
    ctx.shadowBlur = fs * 0.6
    ctx.fillStyle = PAL.white
    ctx.fillText(text, cx, y)
    ctx.shadowBlur = 0

    // Subtitle types in after the title settles.
    const sub = Math.floor(span(t, 2050, 2400) * SUBTITLE.length)
    if (sub > 0) {
      const fs2 = Math.max(9, fs * 0.36)
      ctx.font = `500 ${fs2}px ${MONO}`
      setSpacing(ctx, fs2 * 0.4)
      ctx.shadowColor = PAL.bg0
      ctx.shadowBlur = fs2 * 0.8
      ctx.fillStyle = rgba(PAL.cyan, 0.95)
      const cursor = sub < SUBTITLE.length || Math.floor(t / 260) % 2 === 0 ? '\u258c' : ' '
      ctx.fillText(SUBTITLE.slice(0, sub) + cursor, cx, y + fs * 1.05)
    }
    ctx.restore()
  }

  function drawBootLog(ctx, w, h, t, fs) {
    const x = Math.max(12, w * 0.035)
    const lineH = fs * 1.45
    const y0 = h - Math.max(14, h * 0.05) - lineH * BOOT_LINES.length - fs * 1.6
    ctx.save()
    ctx.font = `${fs}px ${MONO}`
    ctx.textBaseline = 'top'
    setSpacing(ctx, 0)
    for (let i = 0; i < BOOT_LINES.length; i += 1) {
      const start = 200 + i * 330
      if (t < start) break
      const line = BOOT_LINES[i]
      const n = Math.min(line.length, Math.floor((t - start) / 11))
      const shown = line.slice(0, n)
      const ok = shown.endsWith('OK')
      const y = y0 + i * lineH
      ctx.fillStyle = rgba(PAL.cyan, 0.7)
      ctx.fillText(ok ? shown.slice(0, -2) : shown, x, y)
      if (ok) {
        ctx.fillStyle = rgba('#39ff88', 0.95)
        ctx.fillText('OK', x + ctx.measureText(shown.slice(0, -2)).width, y)
      }
    }
    ctx.restore()
  }

  function drawSyncBar(ctx, w, h, t, fs) {
    const k = smooth(t, 250, 2800)
    const bw = Math.min(w * 0.42, 260)
    const bh = Math.max(3, fs * 0.35)
    const x = w - Math.max(12, w * 0.035) - bw
    const y = h - Math.max(14, h * 0.05) - bh
    ctx.save()
    ctx.strokeStyle = rgba(PAL.cyan, 0.5)
    ctx.lineWidth = 1
    ctx.strokeRect(x - 0.5, y - 0.5, bw + 1, bh + 1)
    const fill = ctx.createLinearGradient(x, 0, x + bw, 0)
    fill.addColorStop(0, PAL.magenta)
    fill.addColorStop(1, PAL.cyan)
    ctx.fillStyle = fill
    ctx.fillRect(x, y, bw * k, bh)
    ctx.font = `${fs}px ${MONO}`
    ctx.textAlign = 'right'
    ctx.textBaseline = 'bottom'
    ctx.fillStyle = rgba(PAL.cyan, 0.8)
    ctx.fillText(`SYNC ${String(Math.round(k * 100)).padStart(3, ' ')}%`, x + bw, y - fs * 0.35)
    ctx.restore()
  }

  function drawFrame(ctx, w, h, k) {
    if (k <= 0) return
    const m = Math.max(8, Math.min(w, h) * 0.03)
    const L = Math.max(14, Math.min(w, h) * 0.07)
    ctx.save()
    ctx.globalAlpha = k
    ctx.strokeStyle = rgba(PAL.cyan, 0.8)
    ctx.lineWidth = 2
    const corners = [[m, m, 1, 1], [w - m, m, -1, 1], [m, h - m, 1, -1], [w - m, h - m, -1, -1]]
    for (const [x, y, sx, sy] of corners) {
      ctx.beginPath()
      ctx.moveTo(x, y + sy * L)
      ctx.lineTo(x, y)
      ctx.lineTo(x + sx * L, y)
      ctx.stroke()
    }
    ctx.restore()
  }

  function drawOverlay(ctx, w, h) {
    ctx.save()
    ctx.fillStyle = 'rgba(0, 0, 0, 0.16)'
    for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1)
    const v = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75)
    v.addColorStop(0, 'rgba(0, 0, 0, 0)')
    v.addColorStop(1, 'rgba(0, 0, 0, 0.55)')
    ctx.fillStyle = v
    ctx.fillRect(0, 0, w, h)
    ctx.restore()
  }

  /** Shift horizontal slices of what is already on the canvas (device pixels in, CSS pixels out). */
  function drawGlitch(ctx, canvas, w, h, dpr, t, g) {
    if (g <= 0.02) return
    const frame = Math.floor(t / 33)
    const slices = 3 + Math.floor(g * 7)
    for (let i = 0; i < slices; i += 1) {
      const sy = rnd(frame * 31 + i) * h
      const sh = Math.max(2, rnd(frame * 31 + i + 7) * h * 0.08 * g)
      const dx = (rnd(frame * 31 + i + 13) - 0.5) * w * 0.12 * g
      try {
        ctx.drawImage(canvas, 0, sy * dpr, w * dpr, sh * dpr, dx, sy, w, sh)
      } catch {
        return
      }
      ctx.fillStyle = rgba(i % 2 ? PAL.cyan : PAL.magenta, 0.1 * g)
      ctx.fillRect(0, sy, w, sh)
    }
  }

  /** CRT power-on (reveal from a line) and power-off (collapse to a line, then a dot). */
  function applyCrt(ctx, w, h, t, duration) {
    const cy = h / 2
    if (t < 320) {
      const k = easeOut(span(t, 40, 320))
      const half = Math.max(1, (h / 2) * k)
      ctx.fillStyle = PAL.bg0
      ctx.fillRect(0, 0, w, cy - half)
      ctx.fillRect(0, cy + half, w, h - (cy + half))
      ctx.fillStyle = rgba(PAL.white, 0.9 * (1 - k))
      ctx.fillRect(0, cy - half - 1, w, 2)
      ctx.fillRect(0, cy + half - 1, w, 2)
      return
    }
    const exitStart = duration - EXIT_MS
    if (t < exitStart) return
    const e = span(t, exitStart, duration)
    if (e < 0.6) {
      // Collapse vertically; outside the band goes transparent so the UI shows through.
      const k = easeOut(e / 0.6)
      const half = Math.max(1, (h / 2) * (1 - k))
      ctx.clearRect(0, 0, w, cy - half)
      ctx.clearRect(0, cy + half, w, h - (cy + half))
      ctx.fillStyle = rgba(PAL.white, 0.08 + 0.85 * k * k)
      ctx.fillRect(0, cy - half, w, Math.min(h, half * 2))
      return
    }
    // Shrink the line to a dot and fade.
    const k = easeOut((e - 0.6) / 0.4)
    ctx.clearRect(0, 0, w, h)
    const lw = Math.max(2, w * (1 - k))
    ctx.fillStyle = rgba(PAL.white, 1 - k)
    ctx.fillRect(w / 2 - lw / 2, cy - 1, lw, 2)
    const dot = ctx.createRadialGradient(w / 2, cy, 0, w / 2, cy, 18)
    dot.addColorStop(0, rgba(PAL.cyan, 0.9 * (1 - k)))
    dot.addColorStop(1, rgba(PAL.cyan, 0))
    ctx.fillStyle = dot
    ctx.fillRect(w / 2 - 18, cy - 18, 36, 36)
  }

  // ── the controller ───────────────────────────────────────────────────
  class CyberSplash {
    constructor(canvas, options = {}) {
      this.canvas = canvas
      this.ctx = canvas.getContext('2d')
      this.duration = Number.isFinite(options.durationMs) && options.durationMs > EXIT_MS + 400
        ? options.durationMs
        : DURATION_MS
      this.onDone = typeof options.onDone === 'function' ? options.onDone : null
      this.raf = 0
      this.t0 = null
      this.offset = 0
      this.done = false
      this.running = false
      this.lastT = 0
      this.dpr = 1
      this.cssW = 0
      this.cssH = 0
      this.holo = loadHologram(options.imageSrc ?? '../lib/welcome/whale-3d.png', () => {
        if (!this.running) this.renderAt(this.lastT)
      })
      this._tick = this._tick.bind(this)
      this._skip = this.skip.bind(this)
      this.interactive = options.interactive !== false
    }

    /** Keep the backing store matched to the element's CSS size × DPR. */
    resize() {
      const c = this.canvas
      const rect = typeof c.getBoundingClientRect === 'function' ? c.getBoundingClientRect() : null
      const w = Math.round((rect && rect.width) || c.clientWidth || (typeof window !== 'undefined' ? window.innerWidth : 0) || 0)
      const h = Math.round((rect && rect.height) || c.clientHeight || (typeof window !== 'undefined' ? window.innerHeight : 0) || 0)
      const dpr = Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, 2)
      if (w !== this.cssW || h !== this.cssH || dpr !== this.dpr) {
        this.cssW = w
        this.cssH = h
        this.dpr = dpr
        c.width = Math.max(1, Math.round(w * dpr))
        c.height = Math.max(1, Math.round(h * dpr))
      }
    }

    /** Draw the frame at `t` ms. Pure in `t` (apart from whether the hologram image has loaded). */
    renderAt(t) {
      const ctx = this.ctx
      if (ctx === null || ctx === undefined) return
      this.resize()
      const w = this.cssW
      const h = this.cssH
      const dpr = this.dpr
      const T = Math.max(0, Math.min(this.duration, Number(t) || 0))
      this.lastT = T
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.globalAlpha = 1
      ctx.globalCompositeOperation = 'source-over'
      ctx.clearRect(0, 0, w, h)
      if (w < 2 || h < 2) return

      const g = glitchAt(T, this.duration)
      const horizon = h * 0.7
      const cx = w / 2
      const fs = Math.max(9, Math.min(13, Math.min(w, h) * 0.022))
      const titleFs = Math.max(14, Math.min(w * 0.058, h * 0.07, 40))
      // Ring + title stack sits above the horizon; the boot log owns the floor.
      const R = Math.max(24, Math.min(w * 0.2, h * 0.19))
      const cy = Math.max(R + h * 0.06, horizon - titleFs * 2.6 - R * 1.25)
      const titleY = cy + R * 1.08 + titleFs * 0.9
      const bgIn = smooth(T, 150, 600)

      drawBackdrop(ctx, w, h, horizon)
      drawSun(ctx, cx, horizon, Math.min(w * 0.15, h * 0.2), bgIn * 0.8)
      drawRain(ctx, w, horizon, T, bgIn * 0.9, fs)
      drawGrid(ctx, w, h, horizon, T, bgIn)
      drawRing(ctx, cx, cy, R, T, smooth(T, 350, 900))
      drawWhaleHolo(ctx, this.holo, cx, cy, R, T, smooth(T, 750, 1250), g)
      drawTitle(ctx, cx, titleY, titleFs, T, g)
      drawBootLog(ctx, w, h, T, fs)
      drawSyncBar(ctx, w, h, T, fs)
      drawFrame(ctx, w, h, smooth(T, 250, 700))
      drawOverlay(ctx, w, h)
      drawGlitch(ctx, this.canvas, w, h, dpr, T, g)
      applyCrt(ctx, w, h, T, this.duration)
    }

    _now() {
      return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()
    }

    _tick(now) {
      if (!this.running) return
      if (this.t0 === null) this.t0 = now
      const t = now - this.t0 + this.offset
      if (t >= this.duration) {
        this.renderAt(this.duration)
        this._finish()
        return
      }
      try {
        this.renderAt(t)
      } catch (err) {
        // A broken frame must never leave the window covered: hand off immediately.
        console.error('cyber splash: frame failed', err)
        this._finish()
        return
      }
      this.raf = requestAnimationFrame(this._tick)
    }

    _finish() {
      this.running = false
      if (this.raf) cancelAnimationFrame(this.raf)
      this.raf = 0
      this._unbind()
      if (this.done) return
      this.done = true
      if (this.onDone) this.onDone()
    }

    _unbind() {
      if (!this.interactive || typeof window === 'undefined') return
      window.removeEventListener('keydown', this._skip)
      this.canvas.removeEventListener?.('pointerdown', this._skip)
    }

    start() {
      if (this.running || this.done) return
      this.running = true
      this.t0 = null
      if (this.interactive && typeof window !== 'undefined') {
        window.addEventListener('keydown', this._skip)
        this.canvas.addEventListener?.('pointerdown', this._skip)
      }
      this.raf = requestAnimationFrame(this._tick)
    }

    /** Jump to the power-off sequence (never backwards). */
    skip() {
      if (!this.running || this.t0 === null) return
      const t = this._now() - this.t0 + this.offset
      const exitStart = this.duration - EXIT_MS
      if (t < exitStart) this.offset += exitStart - t
    }

    stop() {
      this.running = false
      if (this.raf) cancelAnimationFrame(this.raf)
      this.raf = 0
      this._unbind()
    }
  }

  CyberSplash.DURATION_MS = DURATION_MS
  CyberSplash.EXIT_MS = EXIT_MS
  window.CyberSplash = CyberSplash
})()
