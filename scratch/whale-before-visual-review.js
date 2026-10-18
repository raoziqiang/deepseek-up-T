/**
 * A short star-ocean journey for the DSH welcome window and desktop charm.
 *
 * Motion thesis:
 *   1. A volume-lit whale breaches from right to left across a quiet star sea.
 *   2. Its wake bends nearby stars; the two water contacts send out star ripples.
 *   3. The whale dissolves into a curved stream of light and reforms as a charm.
 *
 * The 3D whale is a transparent, locally bundled sprite. Canvas draws the
 * parallax star field and ripples so the scene needs no runtime network access.
 */

const PIXEL = 6
export const __WHALE_PIXEL__ = PIXEL
export const WHALE_SPLASH_DURATION_MS = 6800

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
const lerp = (a, b, t) => a + (b - a) * t
const easeOutCubic = (t) => 1 - (1 - t) ** 3
const easeInOutCubic = (t) => (
  t < 0.5
    ? 4 * t * t * t
    : 1 - ((-2 * t + 2) ** 3) / 2
)

function makeRandom(seed) {
  let value = seed >>> 0
  return () => {
    value = (value + 0x6d2b79f5) >>> 0
    let mixed = value
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1)
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61)
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
  }
}

function resolveWhaleImageUrl() {
  if (typeof document === 'undefined') return 'whale-3d.png'
  const activeScript = document.currentScript
  const scriptUrl = activeScript?.src
    || Array.from(document.scripts || []).find((script) => script.src.includes('whale-animation.js'))?.src
    || document.baseURI
  try {
    return new URL('whale-3d.png', scriptUrl).href
  } catch {
    return 'whale-3d.png'
  }
}

let whaleImage = null
let whaleImageLoaded = false

if (typeof Image !== 'undefined') {
  whaleImage = new Image()
  whaleImage.onload = () => { whaleImageLoaded = true }
  whaleImage.onerror = () => { whaleImageLoaded = false }
  whaleImage.src = resolveWhaleImageUrl()
}

/**
 * The whale silhouette fallback, centered on the origin. The measured path is
 * kept for installations where the PNG cannot be decoded.
 */
export function whalePath(ctx, w, h) {
  const X = (value) => value * w
  const Y = (value) => value * h
  ctx.beginPath()
  ctx.moveTo(X(-0.50), Y(0.00))
  ctx.bezierCurveTo(X(-0.48), Y(-0.20), X(-0.30), Y(-0.32), X(-0.10), Y(-0.33))
  ctx.bezierCurveTo(X(0.08), Y(-0.34), X(0.24), Y(-0.26), X(0.36), Y(-0.13))
  ctx.bezierCurveTo(X(0.40), Y(-0.10), X(0.42), Y(-0.08), X(0.44), Y(-0.09))
  ctx.bezierCurveTo(X(0.50), Y(-0.18), X(0.58), Y(-0.30), X(0.66), Y(-0.36))
  ctx.bezierCurveTo(X(0.64), Y(-0.22), X(0.58), Y(-0.10), X(0.52), Y(-0.02))
  ctx.bezierCurveTo(X(0.50), Y(0.00), X(0.50), Y(0.01), X(0.52), Y(0.03))
  ctx.bezierCurveTo(X(0.58), Y(0.11), X(0.64), Y(0.23), X(0.66), Y(0.37))
  ctx.bezierCurveTo(X(0.58), Y(0.31), X(0.50), Y(0.19), X(0.44), Y(0.10))
  ctx.bezierCurveTo(X(0.42), Y(0.09), X(0.40), Y(0.11), X(0.36), Y(0.14))
  ctx.bezierCurveTo(X(0.24), Y(0.27), X(0.08), Y(0.35), X(-0.10), Y(0.34))
  ctx.bezierCurveTo(X(-0.30), Y(0.33), X(-0.48), Y(0.20), X(-0.50), Y(0.00))
  ctx.closePath()
}

function finPath(ctx, w, h) {
  ctx.beginPath()
  ctx.moveTo(-0.20 * w, 0.14 * h)
  ctx.bezierCurveTo(-0.16 * w, 0.30 * h, -0.08 * w, 0.42 * h, 0.02 * w, 0.44 * h)
  ctx.bezierCurveTo(0.00 * w, 0.28 * h, -0.06 * w, 0.16 * h, -0.10 * w, 0.10 * h)
  ctx.closePath()
}

/** Draw the same 3D whale in the splash and in the resting desktop charm. */
export function drawWhale(ctx, w, h, detail = true, light = false) {
  ctx.save()
  ctx.shadowColor = light ? 'rgba(56, 189, 248, 0.58)' : 'rgba(96, 165, 250, 0.70)'
  ctx.shadowBlur = Math.max(3, Math.min(w * 0.055, 24))

  if (whaleImageLoaded && whaleImage && typeof ctx.drawImage === 'function') {
    const aspect = whaleImage.naturalWidth / Math.max(1, whaleImage.naturalHeight)
    let drawW = w
    let drawH = drawW / aspect
    if (drawH > h) {
      drawH = h
      drawW = drawH * aspect
    }
    ctx.drawImage(whaleImage, -drawW / 2, -drawH / 2, drawW, drawH)
    ctx.restore()
    return
  }

  const body = ctx.createLinearGradient(-0.15 * w, -0.45 * h, 0.18 * w, 0.45 * h)
  body.addColorStop(0, light ? '#79dfff' : '#88e6ff')
  body.addColorStop(0.28, light ? '#168fc4' : '#1887c2')
  body.addColorStop(0.68, light ? '#075b99' : '#104a8c')
  body.addColorStop(1, '#07152f')

  if (detail) {
    ctx.save()
    ctx.globalAlpha *= 0.82
    ctx.fillStyle = light ? '#0d72aa' : '#1254a2'
    ctx.translate(0.02 * w, 0.02 * h)
    ctx.rotate(0.20)
    finPath(ctx, w, h)
    ctx.fill()
    ctx.restore()
  }

  whalePath(ctx, w, h)
  ctx.fillStyle = body
  ctx.fill()

  whalePath(ctx, w, h)
  ctx.strokeStyle = 'rgba(133, 226, 255, 0.92)'
  ctx.lineWidth = Math.max(1, w * 0.005)
  ctx.stroke()

  ctx.save()
  whalePath(ctx, w, h)
  ctx.clip()
  const lightSweep = ctx.createRadialGradient(-0.16 * w, -0.19 * h, 1, -0.16 * w, -0.19 * h, w * 0.58)
  lightSweep.addColorStop(0, 'rgba(229, 250, 255, 0.66)')
  lightSweep.addColorStop(0.26, 'rgba(93, 211, 255, 0.23)')
  lightSweep.addColorStop(1, 'rgba(10, 40, 95, 0)')
  ctx.fillStyle = lightSweep
  ctx.fillRect(-w, -h, w * 2, h * 2)

  if (detail) {
    for (let index = 0; index < 7; index += 1) {
      const fraction = (index + 1) / 8
      const y = (-0.16 + fraction * 0.32) * h
      ctx.beginPath()
      ctx.strokeStyle = 'rgba(163, 232, 255, 0.42)'
      ctx.lineWidth = Math.max(0.6, h * 0.006)
      ctx.moveTo(-0.43 * w + fraction * 0.05 * w, y * 0.48)
      ctx.bezierCurveTo(-0.20 * w, y * 1.10, 0.12 * w, y * 0.86, 0.42 * w - fraction * 0.07 * w, y * 0.28)
      ctx.stroke()
    }
  }
  ctx.restore()

  ctx.fillStyle = '#d9f7ff'
  ctx.beginPath()
  ctx.arc(-0.34 * w, -0.06 * h, Math.max(1.4, h * 0.026), 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#04142b'
  ctx.beginPath()
  ctx.arc(-0.34 * w, -0.06 * h, Math.max(0.8, h * 0.014), 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

/** A deterministic, low-cost star sea with two expanding contact waves. */
export class WhaleSplash {
  constructor(canvas, options = {}) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')
    this.durationMs = options.durationMs ?? WHALE_SPLASH_DURATION_MS
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
    this.reduced = options.reducedMotion ?? (
      typeof matchMedia === 'function'
      && matchMedia('(prefers-reduced-motion: reduce)').matches
    )
    this._onResize = () => this.resize()
    this._onVisibility = () => this.handleVisibility()
    this._tick = (now) => this.frame(now)
    this.initStars()
    this.resize()
  }

  initStars() {
    const rng = makeRandom(this.seed ^ 0x73a91)
    this.stars = []
    for (let index = 0; index < 210; index += 1) {
      this.stars.push({
        x: rng(),
        y: rng() * 0.82,
        radius: 0.45 + rng() * 1.25,
        phase: rng() * Math.PI * 2,
        drift: (rng() - 0.5) * 7,
        bright: rng() > 0.89,
        color: rng() > 0.42 ? '125, 211, 252' : '232, 247, 255',
      })
    }
    this.contacts = [
      { x: 0.82, y: 0.76, at: 0.20 },
      { x: 0.13, y: 0.76, at: 0.79 },
    ]
  }

  start() {
    if (this.phase === 'running') return
    this.resize()
    window.addEventListener('resize', this._onResize)
    document.addEventListener('visibilitychange', this._onVisibility)
    this.startedAt = performance.now()
    this.phase = 'running'

    if (this.reduced) {
      this.render(1, this.startedAt)
      this.finish()
      return
    }
    this.raf = requestAnimationFrame(this._tick)
  }

  stop() {
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = 0
    this.phase = 'stopped'
    window.removeEventListener('resize', this._onResize)
    document.removeEventListener('visibilitychange', this._onVisibility)
  }

  handleVisibility() {
    if (document.hidden) {
      if (this.raf) cancelAnimationFrame(this.raf)
      this.raf = 0
      return
    }
    if (this.phase === 'running' && !this.raf) this.raf = requestAnimationFrame(this._tick)
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect()
    this.dpr = clamp(window.devicePixelRatio || 1, 1, 2)
    this.width = Math.max(1, Math.round(rect.width))
    this.height = Math.max(1, Math.round(rect.height))
    this.canvas.width = Math.round(this.width * this.dpr)
    this.canvas.height = Math.round(this.height * this.dpr)
    this.layout()
  }

  layout() {
    const width = this.width
    const height = this.height
    const margin = Math.round(clamp(Math.min(width, height) * 0.04, 8, 36))
    this.scroll = {
      x: margin,
      y: margin,
      w: Math.max(1, width - margin * 2),
      h: Math.max(1, height - margin * 2),
    }
    const length = Math.min(this.scroll.w * 0.62, this.scroll.h * 0.46 * 1.59)
    this.whale = { len: length, height: length / 1.59 }
    this.surfaceY = height * 0.76
    if (!this.pendant.placed) {
      this.pendant.x = width * 0.86
      this.pendant.y = height * 0.18
    }
  }

  pendantSize() {
    return clamp(Math.min(this.width, this.height) * 0.13, 44, 96)
  }

  finish() {
    if (this.phase !== 'running') return
    this.phase = 'complete'
    this.raf = 0
    this.onPendant()
  }

  frame(now) {
    if (this.phase !== 'running') return
    const progress = clamp((now - this.startedAt) / this.durationMs, 0, 1)
    this.render(progress, now)
    if (progress < 1) {
      this.raf = requestAnimationFrame(this._tick)
      return
    }
    this.finish()
  }

  /** Convert the breaching movement to screen coordinates and orientation. */
  whalePose(progress) {
    const startAt = 0.12
    const endAt = 0.79
    if (progress < startAt || progress > endAt) return null
    const u = clamp((progress - startAt) / (endAt - startAt), 0, 1)
    const eased = easeInOutCubic(u)
    const startX = this.width + this.whale.len * 0.72
    const endX = -this.whale.len * 0.72
    const x = lerp(startX, endX, eased)
    const arc = Math.min(this.height * 0.37, this.whale.height * 1.55)
    const y = this.surfaceY - Math.sin(u * Math.PI) * arc
    const dx = endX - startX
    const dy = -Math.cos(u * Math.PI) * arc * Math.PI
    let rotation = Math.atan2(dy, dx) - Math.PI
    rotation = Math.atan2(Math.sin(rotation), Math.cos(rotation))
    const edgeFade = Math.min(clamp(u / 0.045, 0, 1), clamp((1 - u) / 0.075, 0, 1))
    return {
      x,
      y,
      rotation,
      scale: 0.88 + Math.sin(u * Math.PI) * 0.18 + Math.sin(u * Math.PI * 4) * 0.018,
      alpha: edgeFade,
      u,
    }
  }

  starPosition(star, now, progress, pose) {
    const driftSeconds = (now - this.startedAt) / 1000
    let x = ((star.x * this.width + star.drift * driftSeconds) % this.width + this.width) % this.width
    let y = star.y * this.height

    if (pose) {
      const dx = x - pose.x
      const dy = y - pose.y
      const distance = Math.max(1, Math.hypot(dx, dy))
      const influence = Math.exp(-distance / (Math.min(this.width, this.height) * 0.20))
      const wave = Math.sin(distance * 0.075 - now * 0.012) * 15 * influence
      x += (dx / distance) * wave
      y += (dy / distance) * wave
    }

    for (const contact of this.contacts) {
      const age = ((progress - contact.at) * this.durationMs) / 1000
      if (age <= 0 || age > 1.6) continue
      const cx = contact.x * this.width
      const cy = contact.y * this.height
      const dx = x - cx
      const dy = (y - cy) * 0.58
      const distance = Math.max(1, Math.hypot(dx, dy))
      const band = distance - age * 185
      const ring = Math.exp(-(band * band) / (2 * 20 * 20)) * (1 - age / 1.6)
      const push = Math.sin(band * 0.08) * 12 * ring
      x += (dx / distance) * push
      y += (dy / distance) * push
    }

    return { x, y }
  }

  drawBackground(ctx, now) {
    const width = this.width
    const height = this.height
    const background = ctx.createLinearGradient(0, 0, 0, height)
    background.addColorStop(0, '#020613')
    background.addColorStop(0.48, '#071329')
    background.addColorStop(1, '#020916')
    ctx.fillStyle = background
    ctx.fillRect(0, 0, width, height)

    const nebula = ctx.createRadialGradient(width * 0.62, height * 0.42, 0, width * 0.62, height * 0.42, Math.max(width, height) * 0.62)
    nebula.addColorStop(0, 'rgba(28, 77, 145, 0.25)')
    nebula.addColorStop(0.42, 'rgba(18, 46, 106, 0.13)')
    nebula.addColorStop(1, 'rgba(2, 6, 19, 0)')
    ctx.fillStyle = nebula
    ctx.fillRect(0, 0, width, height)

    const secondary = ctx.createRadialGradient(width * 0.10, height * 0.70, 0, width * 0.10, height * 0.70, Math.min(width, height) * 0.46)
    secondary.addColorStop(0, 'rgba(8, 145, 178, 0.09)')
    secondary.addColorStop(1, 'rgba(8, 145, 178, 0)')
    ctx.fillStyle = secondary
    ctx.fillRect(0, 0, width, height)

    const horizonY = this.surfaceY
    const horizon = ctx.createLinearGradient(0, horizonY - 2, 0, height)
    horizon.addColorStop(0, 'rgba(56, 189, 248, 0.055)')
    horizon.addColorStop(1, 'rgba(2, 6, 19, 0)')
    ctx.fillStyle = horizon
    ctx.fillRect(0, horizonY - 2, width, height - horizonY + 2)

    this.drawStars(ctx, now)
    this.drawWaterline(ctx, now)
  }

  drawStars(ctx, now) {
    const progress = this.durationMs > 0 ? (now - this.startedAt) / this.durationMs : 1
    const pose = this.whalePose(progress)
    for (const star of this.stars) {
      const point = this.starPosition(star, now, progress, pose)
      const twinkle = 0.56 + Math.sin(now * 0.0012 + star.phase) * 0.24
      const alpha = clamp(twinkle + (star.bright ? 0.18 : 0), 0.18, 0.96)
      ctx.globalAlpha = alpha
      ctx.fillStyle = 'rgba(' + star.color + ', ' + alpha + ')'
      ctx.beginPath()
      ctx.arc(point.x, point.y, star.radius * (star.bright ? 1.28 : 1), 0, Math.PI * 2)
      ctx.fill()

      if (star.bright) {
        ctx.strokeStyle = 'rgba(186, 230, 253, ' + (alpha * 0.42) + ')'
        ctx.lineWidth = 0.65
        ctx.beginPath()
        ctx.moveTo(point.x - star.radius * 2.2, point.y)
        ctx.lineTo(point.x + star.radius * 2.2, point.y)
        ctx.moveTo(point.x, point.y - star.radius * 2.2)
        ctx.lineTo(point.x, point.y + star.radius * 2.2)
        ctx.stroke()
      }
    }
    ctx.globalAlpha = 1
  }

  drawWaterline(ctx, now) {
    const width = this.width
    const y = this.surfaceY
    ctx.save()
    ctx.globalAlpha = 0.42
    ctx.beginPath()
    ctx.moveTo(0, y)
    for (let x = 24; x <= width; x += 24) {
      ctx.lineTo(x, y + Math.sin(x * 0.012 + now * 0.0007) * 2.4)
    }
    ctx.strokeStyle = 'rgba(103, 232, 249, 0.44)'
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.restore()
  }

  drawRipples(ctx, progress) {
    const maxAgeSeconds = 1.6
    for (const contact of this.contacts) {
      const age = ((progress - contact.at) * this.durationMs) / 1000
      if (age <= 0 || age > maxAgeSeconds) continue
      const cx = contact.x * this.width
      const cy = contact.y * this.height
      const life = 1 - age / maxAgeSeconds
      for (let ring = 0; ring < 4; ring += 1) {
        const radius = age * 150 + ring * 18
        const alpha = life * (0.42 - ring * 0.07)
        ctx.save()
        ctx.globalAlpha = alpha
        ctx.beginPath()
        if (typeof ctx.ellipse === 'function') {
          ctx.ellipse(cx, cy, radius, Math.max(1, radius * 0.16), 0, 0, Math.PI * 2)
        } else {
          ctx.translate(cx, cy)
          ctx.scale(1, 0.16)
          ctx.arc(0, 0, radius, 0, Math.PI * 2)
        }
        ctx.strokeStyle = ring === 0 ? 'rgba(125, 211, 252, 0.95)' : 'rgba(56, 189, 248, 0.72)'
        ctx.lineWidth = ring === 0 ? 1.4 : 0.85
        ctx.stroke()
        ctx.restore()
      }
    }
  }

  drawSplashBurst(ctx, progress) {
    for (const contact of this.contacts) {
      const age = ((progress - contact.at) * this.durationMs) / 1000
      if (age < 0 || age > 0.36) continue
      const alpha = 1 - age / 0.36
      const cx = contact.x * this.width
      const cy = contact.y * this.height
      for (let index = 0; index < 22; index += 1) {
        const angle = (index / 22) * Math.PI * 2
        const speed = this.height * (0.11 + ((index * 17) % 7) * 0.012)
        const x = cx + Math.cos(angle) * speed * age
        const y = cy + Math.sin(angle) * speed * age * 0.66 + age * age * this.height * 0.045
        const radius = Math.max(0.7, (2.2 - age * 4) * (index % 3 === 0 ? 1.15 : 0.72))
        ctx.globalAlpha = alpha
        ctx.fillStyle = index % 3 === 0 ? '#e0f7ff' : '#67e8f9'
        ctx.beginPath()
        ctx.arc(x, y, radius, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    ctx.globalAlpha = 1
  }

  drawWake(ctx, pose, alpha) {
    ctx.save()
    ctx.translate(pose.x, pose.y)
    ctx.rotate(pose.rotation)
    ctx.globalAlpha = alpha * 0.34
    ctx.lineWidth = Math.max(1, this.whale.len * 0.008)
    for (let line = 0; line < 3; line += 1) {
      ctx.beginPath()
      ctx.moveTo(this.whale.len * 0.36, (line - 1) * this.whale.height * 0.07)
      ctx.bezierCurveTo(
        this.whale.len * 0.72,
        (line - 1) * this.whale.height * 0.15,
        this.whale.len * 1.15,
        (line - 1) * this.whale.height * 0.20,
        this.whale.len * 1.48,
        (line - 1) * this.whale.height * 0.24,
      )
      ctx.strokeStyle = line === 1 ? 'rgba(103, 232, 249, 0.82)' : 'rgba(125, 211, 252, 0.38)'
      ctx.stroke()
    }
    ctx.restore()
  }

  drawFlight(ctx, pose, now, dark) {
    if (!pose || pose.alpha <= 0) return
    const glow = ctx.createRadialGradient(pose.x, pose.y, 1, pose.x, pose.y, this.whale.len * 0.72)
    glow.addColorStop(0, 'rgba(56, 189, 248, 0.18)')
    glow.addColorStop(1, 'rgba(56, 189, 248, 0)')
    ctx.save()
    ctx.globalAlpha = pose.alpha
    ctx.fillStyle = glow
    ctx.beginPath()
    if (typeof ctx.ellipse === 'function') {
      ctx.ellipse(pose.x, pose.y, this.whale.len * 0.72, this.whale.height * 0.56, pose.rotation, 0, Math.PI * 2)
    } else {
      ctx.save()
      ctx.translate(pose.x, pose.y)
      ctx.rotate(pose.rotation)
      ctx.scale(1, 0.78)
      ctx.arc(0, 0, this.whale.len * 0.72, 0, Math.PI * 2)
      ctx.restore()
    }
    ctx.fill()
    ctx.restore()

    this.drawWake(ctx, pose, pose.alpha)
    ctx.save()
    ctx.globalAlpha = pose.alpha
    ctx.translate(pose.x, pose.y + Math.sin(now * 0.004) * 2)
    ctx.rotate(pose.rotation)
    ctx.scale(pose.scale, 0.99 / pose.scale)
    drawWhale(ctx, this.whale.len, this.whale.height, true, !dark)
    ctx.restore()
  }

  drawConstellationTrail(ctx, progress, now) {
    const transfer = clamp((progress - 0.79) / 0.18, 0, 1)
    if (transfer <= 0) return null
    const eased = easeOutCubic(transfer)
    const startX = this.width * 0.13
    const startY = this.surfaceY
    const controlX = this.width * 0.45
    const controlY = this.height * 0.12
    const endX = this.pendant.x
    const endY = this.pendant.y
    const inverse = 1 - eased
    const x = inverse * inverse * startX + 2 * inverse * eased * controlX + eased * eased * endX
    const y = inverse * inverse * startY + 2 * inverse * eased * controlY + eased * eased * endY

    ctx.save()
    ctx.globalAlpha = 0.36 * (1 - eased * 0.45)
    ctx.beginPath()
    ctx.moveTo(startX, startY)
    ctx.quadraticCurveTo(controlX, controlY, x, y)
    ctx.strokeStyle = 'rgba(103, 232, 249, 0.58)'
    ctx.lineWidth = 1
    ctx.stroke()
    for (let index = 0; index < 15; index += 1) {
      const p = ((index / 15) + eased * 0.5) % 1
      const oneMinus = 1 - p
      const sx = oneMinus * oneMinus * startX + 2 * oneMinus * p * controlX + p * p * endX
      const sy = oneMinus * oneMinus * startY + 2 * oneMinus * p * controlY + p * p * endY
      const twinkle = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(now * 0.008 + index))
      ctx.globalAlpha = twinkle * (0.24 + eased * 0.35)
      ctx.fillStyle = index % 3 === 0 ? '#e0f7ff' : '#67e8f9'
      ctx.beginPath()
      ctx.arc(sx, sy, index % 4 === 0 ? 1.8 : 1.1, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
    return { x, y, eased }
  }

  drawPendant(progress, now, dark, x = this.pendant.x, y = this.pendant.y, size = this.pendantSize()) {
    const float = Math.sin(now * 0.002) * size * 0.035
    const alpha = clamp(progress * 1.45, 0, 1)

    const ctx = this.ctx
    ctx.save()
    ctx.globalAlpha = alpha
    const halo = ctx.createRadialGradient(x, y + float, 0, x, y + float, size * 1.55)
    halo.addColorStop(0, 'rgba(56, 189, 248, 0.33)')
    halo.addColorStop(0.46, 'rgba(99, 102, 241, 0.13)')
    halo.addColorStop(1, 'rgba(0, 0, 0, 0)')
    ctx.fillStyle = halo
    ctx.beginPath()
    ctx.arc(x, y + float, size * 1.55, 0, Math.PI * 2)
    ctx.fill()

    ctx.translate(x, y + float)
    if (!this.reduced) {
      for (let index = 0; index < 5; index += 1) {
        const angle = index * (Math.PI * 2 / 5) + now * 0.00028 * (index % 2 === 0 ? 1 : -1)
        const distance = size * (0.53 + (index % 2) * 0.08)
        const sparkle = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(now * 0.006 + index))
        ctx.globalAlpha = alpha * sparkle
        ctx.fillStyle = '#dff8ff'
        ctx.beginPath()
        ctx.arc(Math.cos(angle) * distance, Math.sin(angle) * distance, Math.max(0.8, size * 0.018), 0, Math.PI * 2)
        ctx.fill()
      }
    }

    ctx.globalAlpha = alpha
    ctx.shadowColor = dark ? 'rgba(56, 189, 248, 0.54)' : 'rgba(31, 79, 168, 0.42)'
    ctx.shadowBlur = size * 0.28
    const whaleWidth = size * 1.18
    drawWhale(ctx, whaleWidth, whaleWidth / 1.59, true, !dark)
    ctx.restore()
  }

  render(progress, now = performance.now()) {
    const ctx = this.ctx
    if (!ctx) return
    const t = clamp(progress, 0, 1)
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.clearRect(0, 0, this.width, this.height)

    const dark = true
    const pose = this.whalePose(t)
    this.drawBackground(ctx, now)
    this.drawRipples(ctx, t)
    this.drawSplashBurst(ctx, t)
    this.drawFlight(ctx, pose, now, dark)
    const transfer = this.drawConstellationTrail(ctx, t, now)
    if (transfer) {
      const size = lerp(this.whale.len * 0.58, this.pendantSize(), transfer.eased)
      this.drawPendant(transfer.eased, now, dark, transfer.x, transfer.y, size)
    }
  }
}

WhaleSplash.DURATION_MS = WHALE_SPLASH_DURATION_MS

export { PIXEL, clamp, lerp }
