/**
 * The desktop charm window's renderer.
 *
 * Draws the small whale on a transparent canvas with a slow idle bob, and lets
 * the user move the native window by dragging, replay the splash, or hide it.
 *
 * The window is positioned and persisted by the main process; this script only
 * asks for those operations through the `dshPendant` bridge.
 */
;(() => {
  'use strict'

  const api = window.dshPendant
  const canvas = document.getElementById('charm-canvas')
  const charm = document.getElementById('charm')
  const menu = document.getElementById('menu')
  if (canvas === null || charm === null) return

  const ctx = canvas.getContext('2d')
  if (ctx === null) return
  let dpr = 1
  let size = 96

  const resize = () => {
    const rect = canvas.getBoundingClientRect()
    dpr = Math.min(window.devicePixelRatio || 1, 2.5)
    size = Math.max(1, Math.round(Math.min(rect.width, rect.height)))
    canvas.width = Math.round(rect.width * dpr)
    canvas.height = Math.round(rect.height * dpr)
  }
  resize()
  window.addEventListener('resize', resize)

  const themeMedia = window.matchMedia('(prefers-color-scheme: dark)')
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  /** Draw the charm: a whale hanging from a cord, with a gentle bob. */
  const draw = (now) => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    if (typeof window.drawWhale !== 'function') return

    const w = canvas.width / dpr
    const h = canvas.height / dpr
    const dark = themeMedia.matches
    // Slow idle bob and sway, so the charm feels alive but not distracting.
    const t = now / 1000
    const bob = reduced ? 0 : Math.sin(t * 1.5) * h * 0.02
    const sway = reduced ? 0 : Math.sin(t * 1.1) * 0.045

    ctx.save()
    ctx.translate(w / 2, h / 2 + bob)
    ctx.rotate(sway)

    // Soft celestial starlight halo behind the charm
    const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, size * 0.48)
    halo.addColorStop(0, dark ? 'rgba(56, 189, 248, 0.35)' : 'rgba(96, 165, 250, 0.30)')
    halo.addColorStop(0.55, dark ? 'rgba(99, 102, 241, 0.15)' : 'rgba(56, 189, 248, 0.12)')
    halo.addColorStop(1, 'rgba(0, 0, 0, 0)')
    ctx.fillStyle = halo
    ctx.beginPath()
    ctx.arc(0, 0, size * 0.48, 0, Math.PI * 2)
    ctx.fill()

    // Orbiting celestial stardust sparkles
    if (!reduced) {
      const starAngles = [0.4, 1.8, 3.2, 4.6, 5.8]
      const starDists = [0.42, 0.46, 0.44, 0.47, 0.43]
      for (let i = 0; i < starAngles.length; i++) {
        const angle = starAngles[i] + (now / 3800) * (i % 2 === 0 ? 1 : -0.8)
        const dist = size * starDists[i]
        const sx = Math.cos(angle) * dist
        const sy = Math.sin(angle) * dist
        const twinkle = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(now / 550 + i * 1.7))
        ctx.fillStyle = `rgba(224, 242, 254, ${twinkle * 0.85})`
        ctx.beginPath()
        ctx.arc(sx, sy, Math.max(0.8, size * 0.015), 0, Math.PI * 2)
        ctx.fill()
      }
    }

    ctx.save()
    ctx.shadowColor = dark ? 'rgba(56, 189, 248, 0.45)' : 'rgba(31, 79, 168, 0.35)'
    ctx.shadowBlur = size * 0.20
    // drawWhale preserves the supplied constellation image's own aspect ratio.
    const len = size * 0.85
    window.drawWhale(ctx, len, len / 1.864, size > 40, !dark, reduced ? 0 : now / 1000, -0.12)
    ctx.restore()
    ctx.restore()
  }

  let frameId = 0
  let lastDraw = -Infinity
  const loop = (now) => {
    if (document.hidden) { frameId = 0; return }
    if (now - lastDraw >= 32) { draw(now); lastDraw = now }
    frameId = reduced ? 0 : requestAnimationFrame(loop)
  }
  frameId = requestAnimationFrame(loop)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { cancelAnimationFrame(frameId); frameId = 0 }
    else if (!frameId) frameId = requestAnimationFrame(loop)
  })
  themeMedia.addEventListener('change', () => draw(performance.now()))
  window.addEventListener('resize', () => draw(performance.now()))
  window.addEventListener('whaleassetready', () => draw(performance.now()))
  window.addEventListener('pagehide', () => cancelAnimationFrame(frameId), { once: true })

  // ── Window dragging ────────────────────────────────────────────────────────
  // The OS moves the window through the main process; we send screen-space
  // deltas so the charm tracks the cursor exactly.
  let dragging = false
  let lastX = 0
  let lastY = 0

  charm.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return
    dragging = true
    lastX = event.screenX
    lastY = event.screenY
    try { charm.setPointerCapture(event.pointerId) } catch {}
    api?.dragStart?.({ x: event.screenX, y: event.screenY })
    event.preventDefault()
  })

  charm.addEventListener('pointermove', (event) => {
    if (!dragging) return
    api?.dragMove?.({ dx: event.screenX - lastX, dy: event.screenY - lastY })
    lastX = event.screenX
    lastY = event.screenY
  })

  const endDrag = (event) => {
    if (!dragging) return
    dragging = false
    try { if (event?.pointerId) charm.releasePointerCapture(event.pointerId) } catch {}
    api?.dragEnd?.()
  }
  charm.addEventListener('pointerup', endDrag)
  charm.addEventListener('pointercancel', endDrag)
  window.addEventListener('blur', endDrag)

  // Double-click to replay splash directly
  charm.addEventListener('dblclick', (event) => {
    event.preventDefault()
    api?.action?.('toggle-splash')
  })

  // ── Context menu ───────────────────────────────────────────────────────────
  const hideMenu = () => { menu.hidden = true }

  window.addEventListener('contextmenu', (event) => {
    event.preventDefault()
    if (api?.action) {
      api.action('context-menu')
    } else {
      menu.hidden = false
    }
  })
  window.addEventListener('click', (event) => {
    if (!menu.hidden && !menu.contains(event.target)) hideMenu()
  })
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hideMenu()
  })

  menu.addEventListener('click', (event) => {
    const action = event.target?.dataset?.action
    if (action === undefined) return
    hideMenu()
    api?.action?.(action)
  })
})()
