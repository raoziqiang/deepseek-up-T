/**
 * The on-demand splash replay.
 *
 * Loaded into a short-lived, 600x700 frameless window by the desktop charm's
 * "Replay animation" menu item. It plays the same animation the welcome window
 * plays at startup, then closes its own window -- the main process keeps only a
 * safety-net timer, so the animation's duration lives in exactly one place.
 */
;(() => {
  'use strict'

  const DURATION_MS = 4200
  /** Give the last frame a moment after the fade-out before the window goes. */
  const CLOSE_AFTER_FADE_MS = 140
  /** How long a still frame (reduced motion) stays on screen. */
  const STILL_MS = 1600

  const canvas = document.getElementById('whale-stage')
  if (canvas === null) return

  const close = (delay) => {
    canvas.classList.add('is-done')
    setTimeout(() => window.close(), delay)
  }

  /** Reduced motion: draw the settled whale once instead of animating. */
  const drawStill = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5)
    const rect = canvas.getBoundingClientRect()
    canvas.width = Math.round(rect.width * dpr)
    canvas.height = Math.round(rect.height * dpr)
    const ctx = canvas.getContext('2d')
    if (ctx === null || typeof window.drawWhale !== 'function') return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const len = Math.min(rect.width * 0.46, rect.height * 0.32)
    const dark = window.matchMedia('(prefers-color-scheme: dark)').matches
    ctx.save()
    ctx.translate(rect.width / 2, rect.height / 2)
    window.drawWhale(ctx, len, len / 1.59, true, !dark)
    ctx.restore()
  }

  if (
    window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
    typeof window.WhaleSplash !== 'function'
  ) {
    drawStill()
    close(STILL_MS)
    return
  }

  // `onPendant` fires when the splash settles; the real welcome window keeps a
  // draggable charm at that point, while the replay simply fades out and leaves.
  const splash = new window.WhaleSplash(canvas, {
    durationMs: DURATION_MS,
    onPendant: () => close(520 + CLOSE_AFTER_FADE_MS),
  })
  splash.start()

  window.addEventListener('pagehide', () => splash.stop(), { once: true })
})()
