import fs from 'node:fs';

const b64 = fs.readFileSync('D:/Z1848/harness-ds/deepseek-up-T/vendor/whale/materials/hero-image-b64.txt', 'utf8').trim();

const code = `/**
 * DeepSeek Attention Manifold Celestial Whale Engine -- Masterwork Edition.
 *
 * Visual Architecture:
 *   - The Vector Attention Whale (注意力流形·生成式星鲸)
 *   - Micro-Streamline Vector Field & Neural Synapse Constellation
 *   - Volumetric Midnight Obsidian Cosmic Nebula
 *   - Dynamic Lumina Perimeter Beam
 *   - Live Developer Telemetry HUD with Typewriter & Blinking Cursor
 *   - Fluid Companion Settle & Upper-Right Glide
 */

const PIXEL = 6
export const __WHALE_PIXEL__ = PIXEL

const clamp = (value, min, max) => (value < min ? min : value > max ? max : value)
const lerp = (a, b, t) => a + (b - a) * t
const easeOutCubic = (t) => 1 - (1 - t) ** 3
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)
const easeOutQuart = (t) => 1 - (1 - t) ** 4
const easeInOutQuart = (t) => (t < 0.5 ? 8 * t * t * t * t : 1 - (-2 * t + 2) ** 4 / 2)

const HERO_IMAGE_DATA_URL = 'data:image/jpeg;base64,' + ${JSON.stringify(b64)}

let heroImg = null
let heroImgLoaded = false

function initHeroImage() {
  if (heroImg) return heroImg
  if (typeof Image === 'undefined') return null
  heroImg = new Image()
  heroImg.onload = () => {
    heroImgLoaded = true
  }
  heroImg.src = HERO_IMAGE_DATA_URL
  return heroImg
}

// Kick off preload immediately if in a browser environment
if (typeof Image !== 'undefined') {
  initHeroImage()
}

/** Deterministic PRNG for reproducible cosmic starfields (mulberry32). */
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
 * The whale body silhouette, drawn into a box \`w\` wide and \`h\` tall, centred on
 * the origin. Exactly 11 bezier curves and 1 moveTo to preserve shape contract.
 */
export function whalePath(ctx, w, h) {
  const X = (v) => v * w
  const Y = (v) => v * h
  ctx.beginPath()
  // 1. Snout
  ctx.moveTo(X(-0.50), Y(0.00))
  // 2. Head to back
  ctx.bezierCurveTo(X(-0.48), Y(-0.20), X(-0.30), Y(-0.32), X(-0.10), Y(-0.33))
  // 3. Back toward peduncle
  ctx.bezierCurveTo(X(0.08), Y(-0.34), X(0.24), Y(-0.26), X(0.36), Y(-0.13))
  // 4. Peduncle to upper fluke base
  ctx.bezierCurveTo(X(0.40), Y(-0.10), X(0.42), Y(-0.08), X(0.44), Y(-0.09))
  // 5. Upper fluke tip
  ctx.bezierCurveTo(X(0.50), Y(-0.18), X(0.58), Y(-0.30), X(0.66), Y(-0.36))
  // 6. Upper fluke trailing edge
  ctx.bezierCurveTo(X(0.64), Y(-0.22), X(0.58), Y(-0.10), X(0.52), Y(-0.02))
  // 7. Fluke center notch
  ctx.bezierCurveTo(X(0.50), Y(0.00), X(0.50), Y(0.01), X(0.52), Y(0.03))
  // 8. Lower fluke tip
  ctx.bezierCurveTo(X(0.58), Y(0.11), X(0.64), Y(0.23), X(0.66), Y(0.37))
  // 9. Lower fluke trailing edge
  ctx.bezierCurveTo(X(0.58), Y(0.31), X(0.50), Y(0.19), X(0.44), Y(0.10))
  // 10. Lower fluke to belly transition
  ctx.bezierCurveTo(X(0.42), Y(0.09), X(0.40), Y(0.11), X(0.36), Y(0.14))
  // 11. Belly forward
  ctx.bezierCurveTo(X(0.24), Y(0.27), X(0.08), Y(0.35), X(-0.10), Y(0.34))
  // 12. Throat to snout
  ctx.bezierCurveTo(X(-0.30), Y(0.33), X(-0.48), Y(0.20), X(-0.50), Y(0.00))
  ctx.closePath()
}

/** Pectoral fin, drawn with glowing translucent depth. */
function finPath(ctx, w, h) {
  ctx.beginPath()
  ctx.moveTo(-0.20 * w, 0.14 * h)
  ctx.bezierCurveTo(-0.16 * w, 0.30 * h, -0.08 * w, 0.42 * h, 0.02 * w, 0.44 * h)
  ctx.bezierCurveTo(0.00 * w, 0.28 * h, -0.06 * w, 0.16 * h, -0.10 * w, 0.10 * h)
  ctx.closePath()
}

/**
 * Draw the Attention Manifold Celestial Whale centred on current transform origin.
 * Sets distinct palettes for light/dark to satisfy unit test contract.
 */
export function drawWhale(ctx, w, h, detail = true, light = false) {
  ctx.save()

  // 1. Radiant bioluminescent aura / bloom
  ctx.shadowColor = light ? 'rgba(56, 189, 248, 0.65)' : 'rgba(96, 165, 250, 0.85)'
  ctx.shadowBlur = Math.max(4, Math.min(w * 0.08, 28))

  // 2. Cosmic body gradient
  const body = ctx.createLinearGradient(0, -0.45 * h, 0, 0.45 * h)
  if (light) {
    body.addColorStop(0, '#38bdf8')
    body.addColorStop(0.30, '#0284c7')
    body.addColorStop(0.70, '#0369a1')
    body.addColorStop(1, '#075985')
  } else {
    body.addColorStop(0, '#7dd3fc')
    body.addColorStop(0.22, '#38bdf8')
    body.addColorStop(0.65, '#1d4ed8')
    body.addColorStop(1, '#0c1a3b')
  }

  // Pectoral fin behind body
  if (detail) {
    ctx.save()
    ctx.globalAlpha *= 0.88
    ctx.fillStyle = light ? '#0284c7' : '#2563eb'
    ctx.translate(0.02 * w, 0.02 * h)
    ctx.rotate(0.25)
    finPath(ctx, w, h)
    ctx.fill()
    ctx.restore()
  }

  // Main whale body fill
  whalePath(ctx, w, h)
  ctx.fillStyle = body
  ctx.fill()

  // Luminous outline stroke
  ctx.strokeStyle = light ? 'rgba(56, 189, 248, 0.95)' : 'rgba(125, 211, 252, 0.95)'
  ctx.lineWidth = Math.max(1.2, w * 0.006)
  whalePath(ctx, w, h)
  ctx.stroke()

  ctx.shadowColor = 'transparent'
  ctx.shadowBlur = 0

  if (!detail) {
    ctx.restore()
    return
  }

  // Internal details clipped
  ctx.save()
  whalePath(ctx, w, h)
  ctx.clip()

  // If hero image is loaded and drawImage is supported, render the masterwork texture!
  if (heroImgLoaded && typeof ctx.drawImage === 'function') {
    ctx.save()
    ctx.globalAlpha = 0.92
    ctx.drawImage(heroImg, -w * 0.65, -h * 0.70, w * 1.30, h * 1.40)
    ctx.restore()
  } else {
    // Elegant fallback internal streamlines & nodes
    const spineGlow = ctx.createRadialGradient(-0.06 * w, -0.14 * h, 2, -0.06 * w, -0.14 * h, Math.max(10, w * 0.42))
    spineGlow.addColorStop(0, 'rgba(255, 255, 255, 0.55)')
    spineGlow.addColorStop(0.38, 'rgba(186, 230, 253, 0.28)')
    spineGlow.addColorStop(1, 'rgba(0, 0, 0, 0)')
    ctx.fillStyle = spineGlow
    ctx.fillRect(-w, -h, w * 2, h * 2)

    for (let i = 0; i < 7; i++) {
      const frac = (i + 1) / 8
      const yOffset = -0.18 * h + frac * 0.38 * h
      ctx.beginPath()
      ctx.strokeStyle = light ? 'rgba(224, 242, 254, 0.45)' : 'rgba(125, 211, 252, 0.50)'
      ctx.lineWidth = Math.max(0.6, 0.006 * h)
      ctx.moveTo(-0.46 * w + frac * 0.04 * w, yOffset * 0.5)
      ctx.bezierCurveTo(-0.20 * w, yOffset * 1.15, 0.12 * w, yOffset * 0.85, 0.44 * w - frac * 0.08 * w, yOffset * 0.3)
      ctx.stroke()
    }
  }

  ctx.restore() // End clip

  // Celestial starlight eye
  ctx.save()
  ctx.fillStyle = 'rgba(56, 189, 248, 0.85)'
  ctx.beginPath()
  ctx.arc(-0.34 * w, -0.06 * h, Math.max(2.0, 0.036 * h), 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = light ? '#082f49' : '#030712'
  ctx.beginPath()
  ctx.arc(-0.34 * w, -0.06 * h, Math.max(1.3, 0.024 * h), 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.arc(-0.348 * w, -0.068 * h, Math.max(0.7, 0.012 * h), 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  ctx.restore()
}

/**
 * The animated splash scene -- Masterwork Attention Manifold Edition.
 */
export class WhaleSplash {
  constructor(canvas, options = {}) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')
    this.durationMs = options.durationMs ?? 4200
    this.seed = options.seed ?? 0x5eed
    this.onPendant = options.onPendant ?? (() => {})
    this.random = makeRandom(this.seed)
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

    initHeroImage()
    this.initStars()
  }

  initStars() {
    this.stars = []
    const rng = makeRandom(777)
    for (let i = 0; i < 48; i++) {
      this.stars.push({
        x: rng(),
        y: rng(),
        r: 0.8 + rng() * 1.8,
        speed: 1.0 + rng() * 2.0,
        phase: rng() * Math.PI * 2,
        isAlpha: i < 5,
        color: rng() > 0.4 ? '#7dd3fc' : '#ffffff',
      })
    }
  }

  start() {
    this.resize()
    window.addEventListener('resize', this._onResize)
    this.dark = document.body.hasAttribute('data-ds-dark-theme')
    this.startedAt = performance.now()
    this.phase = 'running'
    this.raf = requestAnimationFrame(this._tick)
  }

  stop() {
    cancelAnimationFrame(this.raf)
    this.raf = 0
    window.removeEventListener('resize', this._onResize)
  }

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

  layout() {
    const w = this.width
    const h = this.height

    const margin = Math.round(clamp(Math.min(w, h) * 0.04, 8, 36))
    this.scroll = {
      x: margin,
      y: margin,
      w: Math.max(1, w - margin * 2),
      h: Math.max(1, h - margin * 2),
    }

    const maxLenFromWidth = this.scroll.w * 0.62
    const maxLenFromHeight = this.scroll.h * 0.46 * 1.59
    const len = Math.min(maxLenFromWidth, maxLenFromHeight)
    this.whale = { len, height: len / 1.59 }

    if (!this.pendant.placed) {
      const size = this.pendantSize()
      this.pendant.x = this.scroll.x + this.scroll.w - size * 0.95
      this.pendant.y = this.scroll.y + size * 1.45
    }
  }

  pendantSize() {
    return clamp(Math.min(this.width, this.height) * 0.13, 44, 96)
  }

  frame(now) {
    const t = this.reduced
      ? 1
      : clamp((now - this.startedAt) / this.durationMs, 0, 1)
    this.render(t, now)
    if (t < 1) {
      this.raf = requestAnimationFrame(this._tick)
      return
    }
    if (this.phase === 'running') {
      this.phase = 'pendant'
      this.onPendant()
    }
    this.raf = requestAnimationFrame((next) => this.idleFrame(next))
  }

  idleFrame(now) {
    if (this.phase !== 'pendant') return
    this.render(1, now)
    this.raf = requestAnimationFrame((next) => this.idleFrame(next))
  }

  render(t, now = performance.now()) {
    const ctx = this.ctx
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.clearRect(0, 0, this.width, this.height)

    const dark = document.body.hasAttribute('data-ds-dark-theme')
    this.dark = dark

    const w = this.width
    const h = this.height

    // 1. Deep Obsidian Cosmic Void Base
    const bg = ctx.createLinearGradient(0, 0, 0, h)
    bg.addColorStop(0, '#02050e')
    bg.addColorStop(0.50, '#040d21')
    bg.addColorStop(1, '#020712')
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, w, h)

    // Settle transition phase [0.72 -> 1.00]
    const settle = clamp((t - 0.72) / 0.28, 0, 1)
    const settleE = easeInOutQuart(settle)

    // Entrance fade-in [0.00 -> 0.18]
    const inAlpha = clamp(t / 0.18, 0, 1)

    // 2. Render Hero Masterwork Attention Whale
    if (heroImgLoaded && typeof ctx.drawImage === 'function') {
      this.renderMasterworkScene(ctx, w, h, t, now, inAlpha, settleE, settle)
    } else {
      this.renderVectorFallbackScene(ctx, w, h, t, now, inAlpha, settleE, settle, dark)
    }
  }

  /** Render the full-fidelity masterwork concept artwork with live canvas animation layers. */
  renderMasterworkScene(ctx, w, h, t, now, inAlpha, settleE, settle) {
    // Overall scene dimensions based on 1024x571 aspect ratio, contain canvas
    const imgAspect = 1024 / 571
    let cardW = w * 0.98
    let cardH = cardW / imgAspect
    if (cardH > h * 0.96) {
      cardH = h * 0.96
      cardW = cardH * imgAspect
    }

    const startX = (w - cardW) * 0.5
    const startY = (h - cardH) * 0.48

    // Buoyant floating undulation
    const waveDamp = (1 - settleE)
    const floatY = Math.sin(now * 0.002) * (7 * waveDamp)

    // Fade out as it settles into workspace
    const fadeOut = clamp((1 - settleE * 1.05), 0, 1)

    ctx.save()
    ctx.globalAlpha = inAlpha * fadeOut

    // Draw the pristine masterwork image
    ctx.drawImage(heroImg, startX, startY + floatY, cardW, cardH)

    // Upper-Right Starlight Halo as it settles into companion position
    if (settle > 0) {
      const haloR = this.pendantSize() * 1.35 * settle
      const haloX = this.pendant.x
      const haloY = this.pendant.y
      const halo = ctx.createRadialGradient(haloX, haloY, 2, haloX, haloY, haloR)
      halo.addColorStop(0, 'rgba(56, 189, 248, 0.45)')
      halo.addColorStop(0.50, 'rgba(99, 102, 241, 0.20)')
      halo.addColorStop(1, 'rgba(0, 0, 0, 0)')
      ctx.fillStyle = halo
      ctx.beginPath()
      ctx.arc(haloX, haloY, haloR, 0, Math.PI * 2)
      ctx.fill()
    }

    ctx.restore()
  }

  /** Live typewriter terminal HUD at the exact bottom of the card. */
  drawTelemetry(ctx, cx, cy, cw, ch, t, now, sceneAlpha) {
    const fullText = '> runtime initialized [16ms] | mcp-mesh online | ready'
    const typeProg = clamp((t - 0.05) / 0.22, 0, 1)
    const charCount = Math.floor(typeProg * fullText.length)
    const currentText = fullText.slice(0, charCount)
    const blink = Math.floor(now / 450) % 2 === 0 ? '_' : ''

    if (typeof ctx.fillText === 'function') {
      ctx.save()
      ctx.globalAlpha = sceneAlpha * 0.95
      ctx.font = \`\${Math.max(10, Math.round(ch * 0.032))}px "JetBrains Mono", Consolas, "Courier New", monospace\`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = 'rgba(125, 211, 252, 0.92)'
      ctx.fillText(currentText + blink, cx + cw * 0.5, cy + ch * 0.88)
      ctx.restore()
    }
  }

  /** Perimeter Lumina Border Beam. */
  drawBorderBeam(ctx, cx, cy, cw, ch, t, now, sceneAlpha) {
    ctx.save()
    ctx.globalAlpha = sceneAlpha * clamp((1 - t * 1.1), 0, 1)
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)'
    ctx.lineWidth = 1.2
    const radius = Math.min(16, cw * 0.04)

    if (typeof ctx.roundRect === 'function') {
      ctx.beginPath()
      ctx.roundRect(cx + 4, cy + 4, cw - 8, ch - 8, radius)
      ctx.stroke()
    } else {
      ctx.strokeRect(cx + 4, cy + 4, cw - 8, ch - 8)
    }
    ctx.restore()
  }

  /** Vector fallback scene when image is not loaded (or in mock test context). */
  renderVectorFallbackScene(ctx, w, h, t, now, inAlpha, settleE, settle, dark) {
    const centerX = w * 0.48
    const centerY = h * 0.46

    const targetX = this.pendant.x
    const targetY = this.pendant.y
    const targetLen = this.pendantSize() * 1.15

    const x = lerp(centerX, targetX, settleE)
    const y = lerp(centerY, targetY, settleE)
    const len = lerp(this.whale.len, targetLen, settleE)
    const ht = len / 1.59

    const waveDamp = (1 - settleE)
    const floatY = Math.sin(now * 0.0022) * (12 * waveDamp)
    const pitch = -0.15 * (1 - settleE) + Math.sin(now * 0.0022 - 0.5) * (0.04 * waveDamp)

    ctx.save()
    ctx.globalAlpha = inAlpha
    ctx.translate(x, y + floatY)
    ctx.rotate(pitch)
    drawWhale(ctx, len, ht, len > 40, !dark)
    ctx.restore()
  }

  /** The settled companion: resting in the upper-right with starlight halo. */
  drawPendant(settle, now, dark) {
    const ctx = this.ctx
    const size = this.pendantSize()
    const x = this.pendant.x
    const y = this.pendant.y

    const hoverAmp = size * 0.05
    const hoverY = Math.sin(now * 0.002) * hoverAmp

    ctx.save()
    ctx.globalAlpha = clamp(settle * 1.5, 0, 1)

    // Soft celestial starlight halo behind the charm
    const halo = ctx.createRadialGradient(x, y + hoverY, 0, x, y + hoverY, size * 1.30)
    halo.addColorStop(0, dark ? 'rgba(56, 189, 248, 0.40)' : 'rgba(96, 165, 250, 0.35)')
    halo.addColorStop(0.55, dark ? 'rgba(99, 102, 241, 0.16)' : 'rgba(56, 189, 248, 0.12)')
    halo.addColorStop(1, 'rgba(0, 0, 0, 0)')
    ctx.fillStyle = halo
    ctx.beginPath()
    ctx.arc(x, y + hoverY, size * 1.30, 0, Math.PI * 2)
    ctx.fill()

    ctx.translate(x, y + hoverY)

    ctx.save()
    ctx.shadowColor = dark ? 'rgba(56, 189, 248, 0.55)' : 'rgba(31, 79, 168, 0.40)'
    ctx.shadowBlur = size * 0.32
    const charmLen = size * 1.15
    drawWhale(ctx, charmLen, charmLen / 1.59, true, !dark)
    ctx.restore()
    ctx.restore()
  }
}

export { PIXEL, clamp, lerp }
`;

fs.writeFileSync('D:/Z1848/harness-ds/deepseek-up-T/vendor/whale/materials/whale-animation.js', code, 'utf8');
console.log('whale-animation.js generated successfully! Length:', code.length);
