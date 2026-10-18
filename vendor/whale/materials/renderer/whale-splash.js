/**
 * The welcome window's splash controller.
 *
 * Runs the whale-scroll animation, then leaves a draggable whale charm pinned
 * over the welcome UI. The charm's position is remembered per user so it stays
 * wherever it was last hung.
 *
 * This script runs BEFORE the bundled welcome React app (both are `defer`, and
 * this one is included first), so it only prepares the overlay and never depends
 * on the app's internals.
 */
;(() => {
  'use strict'

  const STORAGE_KEY = 'dsh-whale-pendant-position'
  const DURATION_MS = window.WhaleSplash?.DURATION_MS ?? 6200

  const canvas = document.getElementById('whale-stage')
  if (canvas === null) return

  const themeMedia = window.matchMedia('(prefers-color-scheme: dark)')
  let pendantEl = null
  const applyTheme = () => {
    document.body.toggleAttribute('data-ds-dark-theme', themeMedia.matches)
    // The charm bakes its colors into a canvas, so it repaints on a theme flip.
    pendantEl?.__paint?.()
  }
  applyTheme()
  themeMedia.addEventListener('change', applyTheme)

  /** Read the remembered charm position, if it is still on screen. */
  const readSaved = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw === null) return null
      const value = JSON.parse(raw)
      if (typeof value?.x !== 'number' || typeof value?.y !== 'number') return null
      return value
    } catch {
      return null
    }
  }

  const save = (x, y) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ x, y }))
    } catch {
      /* Storage can be unavailable in a sandboxed frame; the charm still works. */
    }
  }

  /**
   * Build the resting charm as a DOM element (not the splash canvas), so it can
   * be dragged with pointer events, focused, and positioned anywhere in the
   * window. Its whale is drawn with the SAME path function the splash uses, so
   * the charm and the animation can never drift apart.
   */
  function createPendant(size) {
    const el = document.createElement('div')
    el.className = 'whale-pendant'
    el.setAttribute('role', 'img')
    el.setAttribute('aria-label', 'DSH whale charm')
    el.tabIndex = 0
    el.style.width = `${size}px`
    el.style.height = `${size * 1.08}px`

    const canvas = document.createElement('canvas')
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    canvas.style.display = 'block'
    el.appendChild(canvas)

    // Paint on the next frame, once the element has a measured size. Exposing the
    // painter lets a theme change redraw the charm without rebuilding it.
    const paint = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5)
      const w = el.clientWidth || size
      const h = el.clientHeight || size * 1.08
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      const ctx = canvas.getContext('2d')
      if (ctx === null || typeof window.drawWhale !== 'function') return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)

      const dark = document.body.hasAttribute('data-ds-dark-theme')

      // Soft starlight halo behind the whale
      const halo = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w * 0.48)
      halo.addColorStop(0, dark ? 'rgba(56, 189, 248, 0.32)' : 'rgba(96, 165, 250, 0.28)')
      halo.addColorStop(0.55, dark ? 'rgba(99, 102, 241, 0.14)' : 'rgba(56, 189, 248, 0.10)')
      halo.addColorStop(1, 'rgba(0, 0, 0, 0)')
      ctx.fillStyle = halo
      ctx.beginPath()
      ctx.arc(w / 2, h / 2, w * 0.48, 0, Math.PI * 2)
      ctx.fill()

      // The whale body, centered at the path's own 1.59 aspect ratio
      const len = w * 0.85
      ctx.save()
      ctx.translate(w / 2, h / 2)
      window.drawWhale(ctx, len, len / 1.59, true, !dark)
      ctx.restore()
    }
    el.__paint = paint
    requestAnimationFrame(paint)

    return el
  }

  /** Make the charm draggable and keyboard-nudgeable, clamped to the viewport. */
  function attachDrag(el, initial) {
    let x = initial.x
    let y = initial.y
    const size = el.offsetWidth || 64

    const place = () => {
      const maxX = Math.max(0, window.innerWidth - el.offsetWidth)
      const maxY = Math.max(0, window.innerHeight - el.offsetHeight)
      x = Math.min(Math.max(0, x), maxX)
      y = Math.min(Math.max(0, y), maxY)
      el.style.left = `${x}px`
      el.style.top = `${y}px`
      el.style.right = 'auto'
      el.style.bottom = 'auto'
    }
    place()

    let dragging = false
    let offsetX = 0
    let offsetY = 0

    el.addEventListener('pointerdown', (event) => {
      dragging = true
      el.classList.add('is-dragging')
      el.setPointerCapture(event.pointerId)
      const rect = el.getBoundingClientRect()
      offsetX = event.clientX - rect.left
      offsetY = event.clientY - rect.top
      event.preventDefault()
    })

    el.addEventListener('pointermove', (event) => {
      if (!dragging) return
      x = event.clientX - offsetX
      y = event.clientY - offsetY
      place()
    })

    const endDrag = (event) => {
      if (!dragging) return
      dragging = false
      el.classList.remove('is-dragging')
      try {
        el.releasePointerCapture(event.pointerId)
      } catch {
        /* The pointer may already be released. */
      }
      save(x, y)
    }
    el.addEventListener('pointerup', endDrag)
    el.addEventListener('pointercancel', endDrag)

    // Arrow keys move the charm, so it is reachable without a pointer.
    el.addEventListener('keydown', (event) => {
      const step = event.shiftKey ? 24 : 8
      const moves = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      }
      const move = moves[event.key]
      if (move === undefined) return
      x += move[0]
      y += move[1]
      place()
      save(x, y)
      event.preventDefault()
    })

    window.addEventListener('resize', place)
    return { place }
  }

  /** Compute the resting charm size from the window, matching the splash. */
  const pendantSize = () =>
    Math.round(Math.min(Math.max(Math.min(window.innerWidth, window.innerHeight) * 0.13, 44), 96))

  function showPendant() {
    if (document.querySelector('.whale-pendant') !== null) return
    const size = pendantSize()
    const saved = readSaved()
    const initial = saved ?? {
      x: window.innerWidth - size - 28,
      y: 26,
    }
    const el = createPendant(size)
    document.body.appendChild(el)
    pendantEl = el
    attachDrag(el, initial)
    canvas.classList.add('is-done')
    let faded = false
    const reveal = () => {
      if (faded) return
      faded = true
      canvas.remove()
      requestAnimationFrame(() => el.classList.add('is-visible'))
    }
    canvas.addEventListener('transitionend', reveal, { once: true })
    // Reduced motion has no canvas fade; otherwise leave a short, clean gap.
    setTimeout(reveal, reduced ? 0 : 760)
  }

  window.addEventListener('whaleassetready', () => pendantEl?.__paint?.())
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (reduced || typeof window.WhaleSplash !== 'function') {
    // No canvas animation available: go straight to the charm.
    showPendant()
    return
  }

  const splash = new window.WhaleSplash(canvas, {
    durationMs: DURATION_MS,
    onPendant: showPendant,
  })
  splash.start()

  window.addEventListener('pagehide', () => {
    splash.stop()
    themeMedia.removeEventListener('change', applyTheme)
  }, { once: true })
})()
