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

    // Cord from the top of the window to the ring.
    ctx.strokeStyle = dark ? 'rgba(154,169,196,0.8)' : 'rgba(126,147,184,0.8)'
    ctx.lineWidth = Math.max(1.2, size * 0.018)
    ctx.beginPath()
    ctx.moveTo(0, -h / 2)
    ctx.lineTo(0, -size * 0.34)
    ctx.stroke()

    ctx.strokeStyle = '#d9b45e'
    ctx.lineWidth = Math.max(1.4, size * 0.03)
    ctx.beginPath()
    ctx.arc(0, -size * 0.30, size * 0.055, 0, Math.PI * 2)
    ctx.stroke()

    ctx.save()
    ctx.translate(0, size * 0.06)
    ctx.shadowColor = 'rgba(0,0,0,0.35)'
    ctx.shadowBlur = size * 0.16
    ctx.shadowOffsetY = size * 0.05
    // Keep the whale path's own 1.59 aspect ratio so the charm keeps its shape.
    const len = size * 0.80
    window.drawWhale(ctx, len, len / 1.59, size > 40, !dark)
    ctx.restore()
    ctx.restore()
  }

  const loop = (now) => {
    draw(now)
    requestAnimationFrame(loop)
  }
  requestAnimationFrame(loop)

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
