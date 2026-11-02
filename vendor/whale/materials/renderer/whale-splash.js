/**
 * The welcome window's splash controller.
 *
 * Plays the cyber splash (lib/welcome/cyber-splash.js) over the welcome UI, then
 * removes its canvas and gets out of the way. Nothing stays behind in this window:
 * the whale lives on as the desktop charm, which is its own window.
 *
 * This script runs BEFORE the bundled welcome React app (both are `defer`, and
 * this one is included first), so it only prepares the overlay and never depends
 * on the app's internals.
 */
;(() => {
  'use strict'

  /** After the last frame, how long the canvas takes to fade (matches whale.css). */
  const FADE_MS = 240

  const canvas = document.getElementById('whale-stage')
  if (canvas === null) return

  const themeMedia = window.matchMedia('(prefers-color-scheme: dark)')
  const applyTheme = () => {
    document.body.toggleAttribute('data-ds-dark-theme', themeMedia.matches)
  }
  applyTheme()
  themeMedia.addEventListener('change', applyTheme)

  let removed = false
  const remove = () => {
    if (removed) return
    removed = true
    canvas.remove()
  }

  /** Fade out, then take the canvas out of the DOM so it can never block the UI. */
  const handOff = (fadeMs) => {
    canvas.classList.add('is-done')
    canvas.addEventListener('transitionend', remove, { once: true })
    // transitionend is not guaranteed (hidden window, reduced motion): always clean up.
    setTimeout(remove, fadeMs + 80)
  }

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (reduced || typeof window.CyberSplash !== 'function') {
    handOff(0)
    return
  }

  let splash
  try {
    splash = new window.CyberSplash(canvas, { onDone: () => handOff(FADE_MS) })
    splash.start()
  } catch (err) {
    console.error('welcome splash: failed to start', err)
    handOff(0)
    return
  }

  window.addEventListener('pagehide', () => {
    splash.stop()
    themeMedia.removeEventListener('change', applyTheme)
  }, { once: true })
})()
