/**
 * dsh-whale-splash —— main-window launch animation.
 *
 * A constellation whale swims across the interface over a living starfield
 * (twinkling stars, a faint Milky Way, shooting stars), stirring star ripples
 * with its tail strokes. At the end it dives into the bottom-left corner,
 * bursts into light and becomes a sci-fi whale girl, while a last ripple
 * sweeps outward and dissolves the veil to reveal the UI.
 *
 * Classic script, no dependencies. Plays once per app session (sessionStorage),
 * so renderer reloads only restore the whale girl. Click / any key skips to the
 * transformation. Whale girl: drag to move, double-click to replay, right-click
 * to hide for this session.
 *
 * The whale mesh deformation is the same stroke as
 * vendor/whale/materials/whale-animation.js so both splashes swim alike.
 */
;(function () {
  'use strict'
  if (window.DshWhaleSplash) return

  var script = document.currentScript
  var base = (script && script.src) || document.baseURI
  var assetUrl = function (name) {
    try { return new URL(name, base).href } catch (e) { return name }
  }

  var DURATION_MS = 13000
  var PLAYED_KEY = 'dsh-whale-splash-played'
  var GIRL_POS_KEY = 'dsh-whale-girl-pos'
  var GIRL_HIDDEN_KEY = 'dsh-whale-girl-hidden'
  var Z = 2147483000
  var SWIM_RATE = 2.65
  var WHALE_ASPECT = 880 / 478
  var GIRL_ASPECT = 265 / 420
  // Timeline marks (fractions of DURATION_MS).
  var T_SKIP = 0.8
  var T_ARRIVE = 0.865
  var T_GIRL_IN = 0.93

  var clamp = function (v, a, b) { return Math.min(b === undefined ? 1 : b, Math.max(a || 0, v)) }
  var lerp = function (a, b, t) { return a + (b - a) * t }
  var smooth = function (a, b, x) { var t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t) }
  var backOut = function (x) { var c = 1.9; x = clamp(x) - 1; return 1 + (c + 1) * x * x * x + c * x * x }
  var random = function (seed) {
    return function () { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 }
  }

  var session = {
    get: function (k) { try { return sessionStorage.getItem(k) } catch (e) { return null } },
    set: function (k, v) { try { sessionStorage.setItem(k, v) } catch (e) { /* storage disabled */ } },
    del: function (k) { try { sessionStorage.removeItem(k) } catch (e) { /* storage disabled */ } },
  }

  function loadImage(name) {
    var img = new Image()
    img.decoding = 'async'
    var ready = new Promise(function (resolve) {
      img.onload = function () { resolve(img) }
      img.onerror = function () { resolve(null) }
    })
    img.src = assetUrl(name)
    return { img: img, ready: ready }
  }
  var whaleAsset = loadImage('whale.png')
  var girlAsset = loadImage('whale-girl.png')
  var imageOk = function (img) { return !!(img && img.complete && img.naturalWidth) }

  var PALETTE = ['91,219,255', '135,116,255', '230,123,228', '255,207,142']
  /** Star temperatures: blue-white, white, warm white, pale gold, pale blue. */
  var STAR_RGB = ['196,218,255', '236,242,255', '255,244,228', '255,222,186', '176,204,255']
  /** Shooting stars, every few seconds; position as viewport fractions, angle in radians. */
  var METEORS = [
    { at: 1.6, x: 0.82, y: 0.06, ang: 2.62, len: 0.20, dur: 0.95 },
    { at: 4.4, x: 0.38, y: 0.03, ang: 2.30, len: 0.16, dur: 0.8 },
    { at: 6.9, x: 0.97, y: 0.34, ang: 2.75, len: 0.22, dur: 1.05 },
    { at: 9.5, x: 0.64, y: 0.08, ang: 2.48, len: 0.18, dur: 0.9 },
    { at: 11.4, x: 0.88, y: 0.18, ang: 2.58, len: 0.14, dur: 0.75 },
  ]
  /** Ripples are born from tail strokes every so often (seconds). */
  var RIPPLE_EMITS = [1.4, 3.6, 5.8, 7.9, 9.8]
  var RIPPLE_LIFE = 4.2

  // ── Whale mesh: the user's original image on a deformed grid (WebGL2) ──
  var VERTEX = '#version 300 es\n' +
    'precision highp float;in vec2 aUV;uniform float uTime;out vec2 vUV;' +
    'void main(){vUV=aUV;float phase=uTime*' + SWIM_RATE.toFixed(2) + ',aspect=' + WHALE_ASPECT.toFixed(4) + ';' +
    'vec2 p=vec2((aUV.x-.5)*2.,(.5-aUV.y)*2.);' +
    'float fin=smoothstep(.52,.72,aUV.y)*(1.-smoothstep(.56,.65,aUV.x))*smoothstep(.32,.43,aUV.x);' +
    'float angle=sin(phase-.8)*.38*fin;vec2 q=vec2(p.x+.16,(p.y+.16)/aspect);' +
    'p=vec2(-.16+q.x*cos(angle)-q.y*sin(angle),-.16+(q.x*sin(angle)+q.y*cos(angle))*aspect);' +
    'float tail=smoothstep(.35,.95,aUV.x),wave=sin(phase-aUV.x*4.6);' +
    'p.y+=wave*(.025+.30*tail*tail);p.x+=cos(phase-aUV.x*4.6)*.018*tail;' +
    'float fluke=smoothstep(.70,.91,aUV.x),a=sin(phase-3.7)*.22*fluke;' +
    'vec2 tq=vec2(p.x-.43,(p.y-.22)/aspect);' +
    'p=vec2(.43+cos(a)*tq.x-sin(a)*tq.y,.22+(sin(a)*tq.x+cos(a)*tq.y)*aspect);' +
    'gl_Position=vec4(p*.88,0.,1.);}'
  var FRAGMENT = '#version 300 es\n' +
    'precision highp float;uniform sampler2D uImage;uniform float uTime;in vec2 vUV;out vec4 color;' +
    'void main(){vec4 tex=texture(uImage,vUV);float breath=.98+.04*sin(uTime*.85+vUV.x*3.);' +
    'color=vec4(tex.rgb*breath,tex.a);}'

  function WhaleMesh() {
    var canvas = document.createElement('canvas')
    canvas.width = 1056; canvas.height = 574
    var gl = canvas.getContext('webgl2', { alpha: true, antialias: true, premultipliedAlpha: false, preserveDrawingBuffer: true })
    if (!gl) throw Error('WebGL2 unavailable')
    var compile = function (type, src) {
      var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(s))
      return s
    }
    var program = gl.createProgram()
    var vs = compile(gl.VERTEX_SHADER, VERTEX), fs = compile(gl.FRAGMENT_SHADER, FRAGMENT)
    gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program))
    gl.deleteShader(vs); gl.deleteShader(fs); gl.useProgram(program)
    var verts = [], idx = [], nx = 100, ny = 54
    for (var y = 0; y <= ny; y++) for (var x = 0; x <= nx; x++) verts.push(x / nx, y / ny)
    for (y = 0; y < ny; y++) for (x = 0; x < nx; x++) {
      var a = y * (nx + 1) + x, b = a + nx + 1
      idx.push(a, b, a + 1, b, b + 1, a + 1)
    }
    var vao = gl.createVertexArray(); gl.bindVertexArray(vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW)
    var loc = gl.getAttribLocation(program, 'aUV')
    gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 8, 0)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer())
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW)
    var tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.uniform1i(gl.getUniformLocation(program, 'uImage'), 0)
    gl.clearColor(0, 0, 0, 0)
    var uTime = gl.getUniformLocation(program, 'uTime')
    var uploaded = false, count = idx.length
    this.triangles = count / 3
    this.render = function (seconds) {
      if (gl.isContextLost() || !imageOk(whaleAsset.img)) return null
      gl.useProgram(program); gl.bindVertexArray(vao); gl.bindTexture(gl.TEXTURE_2D, tex)
      if (!uploaded) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, whaleAsset.img)
        uploaded = true
      }
      gl.viewport(0, 0, canvas.width, canvas.height); gl.clear(gl.COLOR_BUFFER_BIT)
      gl.uniform1f(uTime, seconds)
      gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_SHORT, 0)
      return canvas
    }
  }
  var mesh = null, meshTried = false, meshError = null
  function getMesh() {
    if (!meshTried) {
      meshTried = true
      try { mesh = new WhaleMesh() } catch (e) { meshError = String(e && e.message || e); console.warn('dsh-whale-splash: 2D fallback:', meshError) }
    }
    return mesh
  }

  /** Draw the whale centered at the origin, `len` px wide, facing left. */
  function drawWhale(c, len, seconds, dpr) {
    var h = len / WHALE_ASPECT
    var frame = getMesh() && mesh.render(seconds)
    c.save()
    c.shadowColor = 'rgba(101,225,255,.7)'
    c.shadowBlur = Math.max(2, len * 0.03 * dpr)
    if (frame) {
      c.drawImage(frame, -len / 2, -h / 2, len, h)
    } else if (imageOk(whaleAsset.img)) {
      var sway = Math.sin(seconds * SWIM_RATE) * 0.04
      c.transform(1, sway * 0.3, 0, 1, 0, 0)
      c.drawImage(whaleAsset.img, -len * 0.44, -h * 0.44, len * 0.88, h * 0.88)
    }
    c.restore()
  }

  // ── Whale girl placement ──
  function girlSize(h) {
    var gh = Math.round(clamp(h * 0.16, 96, 136))
    return { w: Math.round(gh * GIRL_ASPECT), h: gh }
  }
  /** Bottom-left by default, sitting above the up-T capsule (left 12, bottom 12). */
  function girlRect(w, h) {
    var s = girlSize(h)
    var x = 14, y = h - 48 - s.h
    var saved = session.get(GIRL_POS_KEY)
    if (saved) {
      try {
        var p = JSON.parse(saved)
        if (typeof p.x === 'number' && typeof p.y === 'number') { x = p.x; y = p.y }
      } catch (e) { /* ignore a corrupt position */ }
    }
    x = clamp(x, 0, Math.max(0, w - s.w)); y = clamp(y, 0, Math.max(0, h - s.h))
    return { x: x, y: y, w: s.w, h: s.h, cx: x + s.w / 2, cy: y + s.h / 2 }
  }

  // ── The splash scene ──
  function Splash(options) {
    this.replay = !!options.replay
    this.onDone = options.onDone || function () {}
    this.root = document.createElement('div')
    this.root.className = 'dshws-veil'
    this.root.setAttribute('aria-hidden', 'true')
    this.canvas = document.createElement('canvas')
    this.root.appendChild(this.canvas)
    this.ctx = this.canvas.getContext('2d')
    this.phase = 'idle'; this.raf = 0; this.startedAt = 0; this.hiddenAt = null; this.ready = false
    var rng = random(92731)
    this.starSeeds = []
    for (var i = 0; i < 1600; i++) {
      var bright = rng() < 0.045
      this.starSeeds.push({
        x: rng(), y: rng(), z: 0.2 + rng() * 0.8,
        r: bright ? 1.1 + rng() * 0.9 : 0.25 + Math.pow(rng(), 2.2) * 0.95,
        ph: rng() * 6.283, ph2: rng() * 6.283,
        freq: 1.2 + rng() * 4.2, amp: bright ? 0.35 + rng() * 0.3 : 0.15 + rng() * 0.45,
        color: Math.floor(rng() * STAR_RGB.length), bright: bright,
      })
    }
    this.dust = []
    for (i = 0; i < 170; i++) this.dust.push({ off: rng(), life: 1.2 + rng() * 1.4, ang: rng() * 6.283, spin: (rng() - 0.5) * 2, spread: 0.3 + rng() * 0.9, speed: rng(), size: rng(), color: rng() < 0.1 ? 3 : Math.floor(rng() * 3) })
    this.sparks = []
    for (i = 0; i < 80; i++) this.sparks.push({ ang: rng() * 6.283, r0: 0.6 + rng() * 0.9, spin: 0.8 + rng() * 1.6, size: rng(), color: Math.floor(rng() * 4) })
    var self = this
    this._tick = function (now) { self.frame(now) }
    this._resize = function () { self.resize(); if (self.phase !== 'running') self.render(self.t || 0) }
    this._visibility = function () {
      if (document.hidden) { self.hiddenAt = performance.now(); cancelAnimationFrame(self.raf); self.raf = 0 }
      else if (self.phase === 'running') {
        if (self.hiddenAt !== null) self.startedAt += performance.now() - self.hiddenAt
        self.hiddenAt = null; self.raf = requestAnimationFrame(self._tick)
      }
    }
    this._skip = function (ev) {
      if (self.phase !== 'running' || !self.ready) return
      var t = (performance.now() - self.startedAt) / DURATION_MS
      if (t < T_SKIP) self.startedAt = performance.now() - T_SKIP * DURATION_MS
      if (ev && ev.preventDefault) ev.preventDefault()
    }
    this.root.addEventListener('pointerdown', this._skip)
  }

  Splash.prototype.mount = function () {
    (document.body || document.documentElement).appendChild(this.root)
    this.resize()
    return this
  }

  Splash.prototype.resize = function () {
    var w = Math.max(1, window.innerWidth), h = Math.max(1, window.innerHeight)
    this.w = w; this.h = h
    this.dpr = Math.min(window.devicePixelRatio || 1, 1.75)
    this.canvas.width = Math.round(w * this.dpr); this.canvas.height = Math.round(h * this.dpr)
    this.L = clamp(Math.min(w * 0.5, h * 0.85), 280, 680)
    this.girl = girlRect(w, h)
    this.bg = this.makeBackground()
    var n = Math.round(clamp(w * h / 700, 500, this.starSeeds.length))
    this.stars = this.starSeeds.slice(0, n)
    this.buildPath()
  }

  Splash.prototype.makeBackground = function () {
    var w = this.w, h = this.h, bg = document.createElement('canvas')
    bg.width = Math.ceil(w); bg.height = Math.ceil(h)
    var c = bg.getContext('2d')
    c.fillStyle = '#040811'; c.fillRect(0, 0, w, h)
    var fog = function (x, y, r, color) {
      var g = c.createRadialGradient(x, y, 0, x, y, r)
      g.addColorStop(0, color); g.addColorStop(1, 'rgba(5,10,20,0)')
      c.fillStyle = g; c.fillRect(0, 0, w, h)
    }
    fog(w * 0.58, h * 0.40, w * 0.7, 'rgba(28,54,93,.50)')
    fog(w * 0.22, h * 0.68, w * 0.42, 'rgba(25,91,112,.26)')
    fog(w * 0.84, h * 0.14, w * 0.40, 'rgba(70,53,109,.22)')
    fog(w * 0.08, h * 0.95, w * 0.30, 'rgba(60,90,160,.18)')
    // A faint Milky Way: soft glow and dense unresolved dust along a diagonal.
    var bandY = function (x) { return h * 0.86 - (x / w) * h * 0.72 }
    for (var k = 0; k <= 8; k++) {
      var bx = w * k / 8
      fog(bx, bandY(bx), Math.max(w, h) * 0.17, 'rgba(96,118,168,.075)')
    }
    var rng = random(3197)
    for (var i = 0; i < 5200; i++) {
      var x = rng() * w, n = rng() + rng() + rng() - 1.5, y = bandY(x) + n * h * 0.16
      var a = 0.02 + Math.pow(rng(), 3) * 0.16
      c.fillStyle = 'rgba(' + (rng() < 0.3 ? '186,170,206' : '146,172,204') + ',' + a + ')'
      c.fillRect(x, y, 0.4 + rng() * 0.7, 0.4 + rng() * 0.7)
    }
    return bg
  }

  /**
   * Swim route: a Catmull-Rom curve from just off-screen right, two lazy S
   * bends through the middle, then a dive into the whale girl's spot. Sampled
   * by arc length so the whale's speed follows the easing, not the knot spacing.
   */
  Splash.prototype.buildPath = function () {
    var w = this.w, h = this.h, L = this.L, g = this.girl
    var pts = [
      { x: w + L * 0.45, y: h * 0.34 },
      { x: w * 0.76, y: h * 0.26 },
      { x: w * 0.56, y: h * 0.52 },
      { x: w * 0.38, y: h * 0.32 },
      { x: Math.max(w * 0.2, g.cx + w * 0.12), y: lerp(h * 0.36, g.cy, 0.5) },
      { x: g.cx, y: g.cy },
    ]
    var at = function (s) {
      var n = pts.length - 1, f = clamp(s) * n, i = Math.min(n - 1, Math.floor(f)), u = f - i
      var p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n, i + 2)]
      var u2 = u * u, u3 = u2 * u
      var cr = function (a, b, c, d) { return 0.5 * (2 * b + (c - a) * u + (2 * a - 5 * b + 4 * c - d) * u2 + (3 * b - a - 3 * c + d) * u3) }
      return { x: cr(p0.x, p1.x, p2.x, p3.x), y: cr(p0.y, p1.y, p2.y, p3.y) }
    }
    var table = [0], prev = at(0), total = 0, N = 240
    for (var k = 1; k <= N; k++) {
      var p = at(k / N); total += Math.hypot(p.x - prev.x, p.y - prev.y); table.push(total); prev = p
    }
    this.pathAt = function (d) {
      var target = clamp(d) * total, lo = 0, hi = N
      while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (table[mid] < target) lo = mid; else hi = mid }
      var span = table[hi] - table[lo] || 1
      return at((lo + (target - table[lo]) / span) / N)
    }
  }

  /** Whale pose at timeline t: position, heading, scale, opacity, mirror. */
  Splash.prototype.pose = function (t) {
    // Enters at speed and settles into the dive, so it is on screen within a second.
    var travel = 1 - Math.pow(1 - clamp((t - 0.01) / (T_ARRIVE - 0.01)), 1.7)
    var p = this.pathAt(travel), q = this.pathAt(Math.min(1, travel + 0.004))
    var dx = q.x - p.x, dy = q.y - p.y
    if (Math.abs(dx) + Math.abs(dy) < 1e-6) { var b = this.pathAt(Math.max(0, travel - 0.004)); dx = p.x - b.x; dy = p.y - b.y }
    var mirror = dx > 0 ? -1 : 1
    var angle = clamp(Math.atan2(-dy * mirror, -dx * mirror), -0.62, 0.62)
    var seconds = t * DURATION_MS / 1000
    var endScale = (this.girl.w * 1.25) / this.L
    var scale = lerp(1, endScale, smooth(0.5, T_ARRIVE, t))
    var alpha = smooth(0.005, 0.04, t) * (1 - smooth(0.835, 0.885, t))
    return { x: p.x, y: p.y + Math.sin(seconds * SWIM_RATE * 0.5) * this.L * 0.012 * scale, angle: angle, scale: scale, alpha: alpha, mirror: mirror }
  }

  /** The fluke tip in screen space (where ripples and wake dust are born). */
  Splash.prototype.tailAt = function (t) {
    var p = this.pose(t), len = this.L * p.scale
    var lx = 0.39 * len * p.mirror, ly = -0.25 * len / WHALE_ASPECT
    var ca = Math.cos(p.angle), sa = Math.sin(p.angle)
    return { x: p.x + ca * lx - sa * ly, y: p.y + sa * lx + ca * ly, alpha: p.alpha, scale: p.scale }
  }

  Splash.prototype.ripples = function (t) {
    var seconds = t * DURATION_MS / 1000, list = [], unit = Math.min(this.w, this.h)
    for (var i = 0; i < RIPPLE_EMITS.length; i++) {
      var e = RIPPLE_EMITS[i], age = seconds - e
      if (age < 0 || age > RIPPLE_LIFE) continue
      var src = this.tailAt(e / (DURATION_MS / 1000))
      var size = 0.6 + 0.4 * src.scale
      list.push({
        x: src.x, y: src.y, age: age,
        r: unit * size * (0.03 + age * 0.13),
        width: 22 + age * 12,
        strength: smooth(0, 0.3, age) * (1 - smooth(1.8, RIPPLE_LIFE, age)) * Math.max(0.35, src.alpha) * size,
      })
    }
    return list
  }

  Splash.prototype.revealRadius = function (t) {
    var g = this.girl, far = Math.max(Math.hypot(g.cx, g.cy), Math.hypot(this.w - g.cx, g.cy),
      Math.hypot(g.cx, this.h - g.cy), Math.hypot(this.w - g.cx, this.h - g.cy)) + 140
    var k = smooth(T_ARRIVE, 1, t)
    return k * k * far
  }

  Splash.prototype.drawStars = function (t, seconds, ripples, reveal) {
    var c = this.ctx, w = this.w, h = this.h, g = this.girl
    c.drawImage(this.bg, 0, 0, w, h)
    for (var i = 0; i < this.stars.length; i++) {
      var s = this.stars[i]
      var x = (s.x * w + seconds * s.z * 0.8) % w, y = s.y * h, dx = 0, dy = 0, light = 0
      for (var j = 0; j < ripples.length; j++) {
        var rp = ripples[j], ox = x - rp.x, oy = (y - rp.y) / 0.72, d = Math.hypot(ox, oy) || 1
        var band = (d - rp.r) / rp.width
        if (band < -3 || band > 3) continue
        var crest = Math.exp(-band * band) * rp.strength, push = Math.sin(band * 2.2) * crest * 30
        dx += ox / d * push; dy += oy / d * push * 0.72; light += crest
      }
      if (reveal > 0) {
        var gx = x - g.cx, gy = y - g.cy, gd = Math.hypot(gx, gy) || 1, gb = (gd - reveal) / 46
        if (gb > -3 && gb < 3) { var gc = Math.exp(-gb * gb); dx += gx / gd * gc * 22; dy += gy / gd * gc * 22; light += gc }
      }
      var px = x + dx, py = y + dy, rgb = STAR_RGB[s.color]
      // Scintillation: two beating frequencies, so no two stars pulse in step.
      var tw = 1 + s.amp * Math.sin(s.ph + seconds * s.freq) * (0.6 + 0.4 * Math.sin(s.ph2 + seconds * s.freq * 1.73))
      var glint = s.bright ? Math.pow(Math.max(0, Math.sin(s.ph2 + seconds * 0.85)), 30) : 0
      var alpha = clamp((0.16 + s.z * 0.5) * tw + light * 0.7 + glint * 0.6)
      if (light > 0.1) {
        c.strokeStyle = 'rgba(139,196,248,' + clamp(light * 0.45) + ')'; c.lineWidth = 0.5 + s.r * 0.45
        c.beginPath(); c.moveTo(x + dx * 0.3, y + dy * 0.3); c.lineTo(px, py); c.stroke()
      }
      if (s.bright) this.glow(px, py, (3.5 + s.r * 3) * (0.8 + 0.25 * tw + glint), rgb, alpha * 0.32)
      c.fillStyle = 'rgba(' + rgb + ',' + alpha + ')'
      c.beginPath(); c.arc(px, py, s.r * (0.6 + s.z * 0.4) + Math.min(1.1, light * 0.7), 0, 6.2832); c.fill()
      if (s.bright) {
        var spike = s.r * (3 + 2.2 * tw + 7 * glint)
        c.strokeStyle = 'rgba(' + rgb + ',' + alpha * (0.28 + glint * 0.5) + ')'; c.lineWidth = 0.6
        c.beginPath(); c.moveTo(px - spike, py); c.lineTo(px + spike, py); c.moveTo(px, py - spike); c.lineTo(px, py + spike); c.stroke()
      }
    }
  }

  /** Shooting stars: a bright head with a tapering tail. */
  Splash.prototype.drawMeteors = function (seconds) {
    var c = this.ctx, span = Math.max(this.w, this.h)
    c.save(); c.globalCompositeOperation = 'lighter'; c.lineCap = 'round'
    for (var i = 0; i < METEORS.length; i++) {
      var m = METEORS[i], k = (seconds - m.at) / m.dur
      if (k < 0 || k > 1) continue
      var dx = Math.cos(m.ang), dy = Math.sin(m.ang), travel = span * m.len * 2.4
      var hx = this.w * m.x + dx * travel * k, hy = this.h * m.y + dy * travel * k
      var tail = span * m.len * (0.35 + 0.65 * smooth(0, 0.35, k))
      var alpha = smooth(0, 0.12, k) * (1 - smooth(0.65, 1, k))
      var g = c.createLinearGradient(hx - dx * tail, hy - dy * tail, hx, hy)
      g.addColorStop(0, 'rgba(160,200,255,0)')
      g.addColorStop(0.7, 'rgba(190,220,255,' + alpha * 0.35 + ')')
      g.addColorStop(1, 'rgba(245,250,255,' + alpha + ')')
      c.strokeStyle = g; c.lineWidth = 1.7
      c.beginPath(); c.moveTo(hx - dx * tail, hy - dy * tail); c.lineTo(hx, hy); c.stroke()
      this.glow(hx, hy, 7, '235,245,255', alpha * 0.8)
    }
    c.restore()
  }

  Splash.prototype.glow = function (x, y, r, rgb, alpha) {
    if (alpha < 0.0005 || r <= 0) return
    var c = this.ctx, g = c.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, 'rgba(' + rgb + ',' + alpha + ')')
    g.addColorStop(0.3, 'rgba(' + rgb + ',' + alpha * 0.6 + ')')
    g.addColorStop(0.7, 'rgba(' + rgb + ',' + alpha * 0.15 + ')')
    g.addColorStop(1, 'rgba(' + rgb + ',0)')
    c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2)
  }

  /** A soft luminous band (stacked strokes, no hard outline). */
  Splash.prototype.ring = function (x, y, r, rgb, alpha, width) {
    if (alpha < 0.002 || r <= 1) return
    var c = this.ctx, layers = [[9, 0.05], [4.5, 0.09], [2, 0.16], [0.8, 0.22]]
    for (var i = 0; i < layers.length; i++) {
      c.strokeStyle = 'rgba(' + rgb + ',' + alpha * layers[i][1] + ')'; c.lineWidth = width * layers[i][0]
      c.beginPath(); c.ellipse(x, y, r, r * 0.72, 0, 0, 6.2832); c.stroke()
    }
  }

  Splash.prototype.drawRipples = function (ripples) {
    var c = this.ctx
    c.save(); c.globalCompositeOperation = 'lighter'
    for (var i = 0; i < ripples.length; i++) {
      var rp = ripples[i], fadeIn = smooth(0, 0.5, rp.age)
      // The crest: a luminous annulus, so the ripple reads as a wave of light.
      var outer = rp.r + rp.width * 1.6, inner = Math.max(0, rp.r - rp.width * 2.6)
      c.save(); c.translate(rp.x, rp.y); c.scale(1, 0.72)
      var crest = c.createRadialGradient(0, 0, inner, 0, 0, outer), a = rp.strength
      crest.addColorStop(0, 'rgba(91,219,255,0)')
      crest.addColorStop(0.32, 'rgba(135,116,255,' + a * 0.07 + ')')
      crest.addColorStop(0.54, 'rgba(91,219,255,' + a * 0.2 + ')')
      crest.addColorStop(0.62, 'rgba(220,244,255,' + a * 0.26 + ')')
      crest.addColorStop(0.76, 'rgba(91,219,255,' + a * 0.08 + ')')
      crest.addColorStop(1, 'rgba(91,219,255,0)')
      c.fillStyle = crest; c.fillRect(-outer, -outer, outer * 2, outer * 2)
      c.restore()
      this.ring(rp.x, rp.y, rp.r, PALETTE[0], rp.strength * 0.9, 1.6)
      this.ring(rp.x, rp.y, rp.r - rp.width * 1.3, PALETTE[1], rp.strength * 0.5 * fadeIn, 1.3)
      this.ring(rp.x, rp.y, rp.r - rp.width * 2.7, PALETTE[2], rp.strength * 0.25 * fadeIn, 1)
      this.glow(rp.x, rp.y, rp.width * 2.2, PALETTE[0], rp.strength * 0.16 * (1 - smooth(0, 0.8, rp.age)))
    }
    c.restore()
  }

  Splash.prototype.drawWake = function (t, seconds) {
    var c = this.ctx, spt = DURATION_MS / 1000
    c.save(); c.globalCompositeOperation = 'lighter'
    for (var i = 0; i < this.dust.length; i++) {
      var d = this.dust[i], age = (seconds + d.off * d.life) % d.life, emitted = seconds - age
      if (emitted < 0.3 || emitted > 0.83 * spt) continue
      var a = this.tailAt(emitted / spt)
      var life = smooth(0, 0.14, age) * (1 - smooth(d.life * 0.35, d.life, age)) * a.alpha
      if (life < 0.005) continue
      var L = this.L * (0.4 + 0.6 * a.scale), swirl = d.ang + age * (0.65 + d.spin), rad = L * (0.018 + age * 0.08) * d.spread
      var x = a.x + age * L * (0.04 + d.speed * 0.09) + Math.cos(swirl) * rad
      var y = a.y + Math.sin(swirl) * rad * 0.8 - age * L * 0.03
      var size = (0.65 + d.size * 1.6) * Math.max(0.7, L / 600), rgb = PALETTE[d.color]
      this.glow(x, y, size * 7, rgb, life * 0.2)
      c.fillStyle = 'rgba(' + rgb + ',' + life * (0.45 + d.size * 0.45) + ')'
      c.beginPath(); c.arc(x, y, size * 0.8, 0, 6.2832); c.fill()
    }
    c.restore()
  }

  Splash.prototype.drawWhaleAt = function (t, seconds) {
    var p = this.pose(t)
    if (p.alpha < 0.002) return
    var c = this.ctx, len = this.L * p.scale
    c.save(); c.globalCompositeOperation = 'lighter'
    this.glow(p.x, p.y, len * 0.62, PALETTE[0], 0.10 * p.alpha)
    c.restore()
    c.save(); c.globalAlpha = p.alpha; c.translate(p.x, p.y); c.rotate(p.angle); c.scale(p.mirror, 1)
    drawWhale(c, len, seconds, this.dpr)
    c.restore()
  }

  /** Converging sparks, a flash, then the whale girl rising out of the light. */
  Splash.prototype.drawTransform = function (t, seconds) {
    var c = this.ctx, g = this.girl
    if (t < 0.8) return
    var gather = smooth(0.8, T_ARRIVE, t), burst = smooth(T_ARRIVE, 0.97, t)
    var flash = Math.exp(-Math.pow((t - T_ARRIVE) / 0.022, 2))
    c.save(); c.globalCompositeOperation = 'lighter'
    this.glow(g.cx, g.cy, g.h * (0.9 + burst * 0.8), PALETTE[0], 0.55 * flash + 0.16 * smooth(0.82, T_ARRIVE, t) * (1 - burst))
    this.glow(g.cx, g.cy, g.h * 0.45, '235,248,255', 0.8 * flash)
    for (var i = 0; i < this.sparks.length; i++) {
      var s = this.sparks[i], r, alpha
      if (t < T_ARRIVE) { r = g.h * s.r0 * (1.4 - 1.25 * gather); alpha = gather * 0.9 }
      else { r = g.h * (0.15 + s.r0 * 0.9 * burst); alpha = (1 - burst) * 0.9 }
      var ang = s.ang + seconds * s.spin * 0.6 + gather * 2.2
      var x = g.cx + Math.cos(ang) * r, y = g.cy + Math.sin(ang) * r * 0.85, size = 0.8 + s.size * 1.8
      this.glow(x, y, size * 6, PALETTE[s.color], alpha * 0.25)
      c.fillStyle = 'rgba(' + PALETTE[s.color] + ',' + alpha + ')'
      c.beginPath(); c.arc(x, y, size, 0, 6.2832); c.fill()
    }
    c.restore()
    var appear = smooth(0.85, T_GIRL_IN, t)
    if (appear > 0 && imageOk(girlAsset.img)) {
      var k = 0.55 + 0.45 * backOut(smooth(0.85, 0.95, t))
      c.save(); c.globalAlpha = appear; c.translate(g.cx, g.y + g.h)
      c.scale(k, k); c.shadowColor = 'rgba(101,225,255,.75)'; c.shadowBlur = 18 * this.dpr * (1 - smooth(0.93, 1, t) * 0.6)
      c.drawImage(girlAsset.img, -g.w / 2, -g.h, g.w, g.h)
      c.restore()
    }
  }

  Splash.prototype.render = function (progress) {
    var t = clamp(progress); this.t = t
    var c = this.ctx, seconds = t * DURATION_MS / 1000
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1
    c.clearRect(0, 0, this.w, this.h)
    var ripples = this.ripples(t), reveal = this.revealRadius(t)
    this.drawStars(t, seconds, ripples, reveal)
    this.drawMeteors(seconds)
    this.drawRipples(ripples)
    this.drawWake(t, seconds)
    this.drawWhaleAt(t, seconds)
    if (reveal > 0) {
      // The last ripple carries the veil away, uncovering the interface.
      var g = this.girl, feather = 70, inner = Math.max(0, reveal - feather)
      var hole = c.createRadialGradient(g.cx, g.cy, inner, g.cx, g.cy, reveal)
      hole.addColorStop(0, 'rgba(0,0,0,1)'); hole.addColorStop(1, 'rgba(0,0,0,0)')
      c.save(); c.globalCompositeOperation = 'destination-out'
      c.fillStyle = 'rgba(0,0,0,1)'
      c.beginPath(); c.arc(g.cx, g.cy, inner, 0, 6.2832); c.fill()
      c.fillStyle = hole; c.fillRect(0, 0, this.w, this.h)
      c.restore()
      // A starlit crest rides the front so it reads as a ripple, not a fade.
      var fade = 1 - smooth(0.93, 1, t)
      var band = c.createRadialGradient(g.cx, g.cy, Math.max(0, inner - 40), g.cx, g.cy, reveal + 24)
      band.addColorStop(0, 'rgba(91,219,255,0)')
      band.addColorStop(0.55, 'rgba(91,219,255,' + 0.22 * fade + ')')
      band.addColorStop(0.8, 'rgba(135,116,255,' + 0.16 * fade + ')')
      band.addColorStop(1, 'rgba(135,116,255,0)')
      c.save(); c.fillStyle = band; c.fillRect(0, 0, this.w, this.h); c.restore()
      c.save(); c.globalCompositeOperation = 'lighter'
      c.translate(g.cx, g.cy); c.scale(1, 1 / 0.72); c.translate(-g.cx, -g.cy)
      this.ring(g.cx, g.cy, reveal - feather * 0.4, PALETTE[0], 0.8 * fade, 1.6)
      c.restore()
    }
    this.drawTransform(t, seconds)
  }

  Splash.prototype.start = function () {
    var self = this
    this.phase = 'running'; this.startedAt = performance.now()
    window.addEventListener('resize', this._resize)
    window.addEventListener('keydown', this._skip, true)
    document.addEventListener('visibilitychange', this._visibility)
    var go = function () { if (!self.ready) { self.ready = true; self.startedAt = performance.now() } }
    whaleAsset.ready.then(go); setTimeout(go, 1200)
    this.raf = requestAnimationFrame(this._tick)
    return this
  }

  Splash.prototype.frame = function (now) {
    if (this.phase !== 'running') return
    if (!this.ready) this.startedAt = now
    var t = clamp((now - this.startedAt) / DURATION_MS)
    this.root.style.opacity = this.replay ? String(smooth(0, 0.04, t) || 0.001) : '1'
    this.root.style.pointerEvents = t < T_ARRIVE ? 'auto' : 'none'
    this.render(t)
    if (t >= 1) this.finish()
    else this.raf = requestAnimationFrame(this._tick)
  }

  Splash.prototype.stop = function () {
    cancelAnimationFrame(this.raf); this.raf = 0
    if (this.phase === 'running') this.phase = 'stopped'
    window.removeEventListener('resize', this._resize)
    window.removeEventListener('keydown', this._skip, true)
    document.removeEventListener('visibilitychange', this._visibility)
  }

  Splash.prototype.finish = function () {
    this.stop(); this.phase = 'complete'
    this.onDone(this)
    if (this.root.parentNode) this.root.parentNode.removeChild(this.root)
  }

  // ── The resting whale girl (DOM, so it can be dragged and clicked) ──
  var STYLE =
    '.dshws-veil{position:fixed;inset:0;z-index:' + Z + ';pointer-events:auto;cursor:default;contain:strict}' +
    '.dshws-veil>canvas{display:block;width:100%;height:100%}' +
    '.dshws-girl{position:fixed;z-index:' + (Z - 1) + ';touch-action:none;user-select:none;-webkit-user-select:none;cursor:grab;' +
    'transition:opacity .45s ease}' +
    '.dshws-girl.is-dragging{cursor:grabbing}.dshws-girl.is-hiding{opacity:0}' +
    '.dshws-girl img{display:block;width:100%;height:100%;pointer-events:none;-webkit-user-drag:none;' +
    'filter:drop-shadow(0 0 6px rgba(101,225,255,.55));animation:dshws-float 3.6s ease-in-out infinite,dshws-glow 4.8s ease-in-out infinite}' +
    '.dshws-girl:hover img{filter:drop-shadow(0 0 10px rgba(101,225,255,.85)) brightness(1.06)}' +
    '.dshws-girl.is-fresh{animation:dshws-in .5s ease both}' +
    '@keyframes dshws-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}' +
    '@keyframes dshws-glow{0%,100%{filter:drop-shadow(0 0 5px rgba(101,225,255,.45))}50%{filter:drop-shadow(0 0 11px rgba(135,116,255,.6))}}' +
    '@keyframes dshws-in{from{opacity:0;transform:scale(.85)}to{opacity:1;transform:none}}' +
    '@media (prefers-reduced-motion:reduce){.dshws-girl img{animation:none}}'

  function ensureStyle() {
    if (document.getElementById('dshws-style')) return
    var el = document.createElement('style')
    el.id = 'dshws-style'; el.textContent = STYLE
    ;(document.head || document.documentElement).appendChild(el)
  }

  var girlEl = null
  function showGirl(fresh) {
    if (girlEl || session.get(GIRL_HIDDEN_KEY) === '1') return
    ensureStyle()
    var r = girlRect(window.innerWidth, window.innerHeight)
    var el = document.createElement('div')
    el.className = 'dshws-girl' + (fresh ? ' is-fresh' : '')
    el.title = '鲸鱼娘 · 拖动移动 · 双击重播启动动画 · 右键隐藏'
    el.setAttribute('role', 'img'); el.setAttribute('aria-label', 'DSH whale girl')
    el.style.width = r.w + 'px'; el.style.height = r.h + 'px'
    el.style.left = r.x + 'px'; el.style.top = r.y + 'px'
    var img = document.createElement('img')
    img.alt = ''; img.draggable = false; img.src = girlAsset.img.src
    el.appendChild(img)
    ;(document.body || document.documentElement).appendChild(el)
    girlEl = el

    var x = r.x, y = r.y, drag = null
    var place = function () {
      var s = girlSize(window.innerHeight)
      el.style.width = s.w + 'px'; el.style.height = s.h + 'px'
      x = clamp(x, 0, Math.max(0, window.innerWidth - s.w)); y = clamp(y, 0, Math.max(0, window.innerHeight - s.h))
      el.style.left = x + 'px'; el.style.top = y + 'px'
    }
    el.addEventListener('pointerdown', function (ev) {
      if (ev.button !== 0) return
      drag = { sx: ev.clientX, sy: ev.clientY, x: x, y: y, moved: false }
      try { el.setPointerCapture(ev.pointerId) } catch (e) { /* already captured */ }
    })
    el.addEventListener('pointermove', function (ev) {
      if (!drag) return
      var dx = ev.clientX - drag.sx, dy = ev.clientY - drag.sy
      if (!drag.moved && Math.hypot(dx, dy) < 4) return
      drag.moved = true; el.classList.add('is-dragging')
      x = drag.x + dx; y = drag.y + dy; place()
    })
    var end = function () {
      if (!drag) return
      if (drag.moved) session.set(GIRL_POS_KEY, JSON.stringify({ x: x, y: y }))
      drag = null; el.classList.remove('is-dragging')
    }
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end)
    el.addEventListener('dblclick', function (ev) { ev.preventDefault(); replay() })
    el.addEventListener('contextmenu', function (ev) {
      ev.preventDefault()
      session.set(GIRL_HIDDEN_KEY, '1'); el.classList.add('is-hiding')
      setTimeout(removeGirl, 480)
    })
    window.addEventListener('resize', place)
    el.__dispose = function () { window.removeEventListener('resize', place) }
  }
  function removeGirl() {
    if (!girlEl) return
    if (girlEl.__dispose) girlEl.__dispose()
    if (girlEl.parentNode) girlEl.parentNode.removeChild(girlEl)
    girlEl = null
  }

  var current = null
  function play(isReplay) {
    if (current && current.phase === 'running') return current
    ensureStyle()
    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    session.set(PLAYED_KEY, '1')
    if (reduced) { girlAsset.ready.then(function () { showGirl(true) }); return null }
    current = new Splash({
      replay: isReplay,
      onDone: function () { showGirl(false) },
    }).mount().start()
    return current
  }
  function replay() {
    session.del(GIRL_HIDDEN_KEY)
    removeGirl()
    return play(true)
  }

  /** Paused render at a fixed timeline point, for previews and frame capture. */
  function renderAt(t) {
    return Promise.all([whaleAsset.ready, girlAsset.ready]).then(function () {
      if (current && current.phase === 'running') current.stop()
      if (!current || !current.root.parentNode) { ensureStyle(); current = new Splash({}).mount() }
      current.phase = 'paused'; current.ready = true
      current.resize(); current.render(t)
      return current.t
    })
  }

  window.DshWhaleSplash = {
    version: '0.2.0',
    durationMs: DURATION_MS,
    replay: replay,
    renderAt: renderAt,
    rendererInfo: function () {
      return { mode: mesh ? 'webgl2-mesh' : (meshTried ? 'fallback-image' : 'pending'), triangles: mesh ? mesh.triangles : 0, error: meshError, whaleReady: imageOk(whaleAsset.img), girlReady: imageOk(girlAsset.img) }
    },
  }

  var boot = function () {
    try {
      var params = new URLSearchParams(location.search)
      if (params.has('whale-paused')) return
      if (session.get(PLAYED_KEY) === '1') girlAsset.ready.then(function () { showGirl(true) })
      else play(false)
    } catch (e) {
      console.warn('dsh-whale-splash: failed to start', e)
    }
  }
  if (document.documentElement) boot()
  else document.addEventListener('DOMContentLoaded', boot, { once: true })
})()
