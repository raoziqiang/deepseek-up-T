/**
 * The on-demand splash replay.
 *
 * Loaded into a short-lived frameless overlay by the desktop charm's
 * "Replay animation" menu item. It plays the same cyber splash the welcome
 * window plays at startup, then closes its own window -- the main process keeps
 * only a safety-net timer, so the animation's duration lives in exactly one place.
 */
;(() => {
  'use strict'

  /** Give the last frame a moment after the fade-out before the window goes. */
  const CLOSE_AFTER_FADE_MS = 300
  /** How long a still frame (reduced motion) stays on screen. */
  const STILL_MS = 1600
  /** The still frame: everything on screen, title settled. */
  const STILL_AT_MS = 2500

  const canvas = document.getElementById('whale-stage')
  if (canvas === null) {
    // 没有画布就别把窗口留着：它是无边框置顶窗，主进程的安全网要 20 秒才收回，
    // 那 20 秒里用户看到的是一个挡在界面上的空白方块。
    window.close()
    return
  }

  const close = (delay) => {
    canvas.classList.add('is-done')
    setTimeout(() => window.close(), delay)
  }

  if (typeof window.CyberSplash !== 'function') {
    close(0)
    return
  }

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    try {
      const still = new window.CyberSplash(canvas, { interactive: false })
      still.renderAt(STILL_AT_MS)
      // The hologram image may land a moment later; repaint the same instant then.
      setTimeout(() => { try { still.renderAt(STILL_AT_MS) } catch { /* 静止帧画不出来就空着 */ } }, 120)
    } catch (err) {
      // 画不出来也要收场：宁可空着淡出，也不要留一个置顶窗口等安全网。
      console.error('replay: failed to draw the still frame', err)
    }
    close(STILL_MS)
    return
  }

  try {
    // The overlay window is non-interactive, so skipping by click/key is off.
    const splash = new window.CyberSplash(canvas, {
      interactive: false,
      onDone: () => close(CLOSE_AFTER_FADE_MS),
    })
    splash.start()
    window.addEventListener('pagehide', () => splash.stop(), { once: true })
  } catch (err) {
    console.error('replay: failed to start the animation', err)
    close(0)
  }
})()
