/**
 * dsh-whale-splash · main-window launch animation (classic script, no deps).
 *
 * Timeline (t = elapsed / DURATION_MS):
 *   0.00 - 0.86  a constellation whale swims across a starry veil over the UI;
 *                every tail stroke now and then stirs a ripple through the stars
 *   0.58 - 0.86  it dives toward the bottom-left corner, shrinking as it goes
 *   0.83 - 0.93  a burst of starlight turns it into the sci-fi whale girl
 *   0.865 - 1.0  one last ripple spreads from her and dissolves the veil
 *   1.00         the canvas is gone; she stays as a draggable DOM mascot
 *
 * Plays once per window session (reloads go straight to the mascot).
 * Click / any key skips to the transformation. Double-click her to replay,
 * right-click to hide her until the next launch.
 */
;(function () {
  'use strict'
  if (window.DshWhaleSplash) return

  var VERSION = '0.1.0'
  var DURATION_MS = 7600
  var PLAYED_KEY = 'dsh-whale-splash-played'
  var GIRL_POS_KEY = 'dsh-whale-girl-pos'
  var GIRL_HIDDEN_KEY = 'dsh-whale-girl-hidden'
  var Z = 2147483000
  var SWIM_RATE = 2.65
  var GIRL_LEFT = 14
  // Leaves room for the dsh-up-t capsule that sits at left 12 / bottom 12.
  var GIRL_BOTTOM = 46

  var T_SHRINK = 0.58
  var T_ARRIVE = 0.86
  var T_BURST = 0.865
  var T_GIRL_IN = 0.85
  var T_GIRL_DONE = 0.93
  var T_SKIP = 0.82

  var script = document.currentScript
  var base = (script && script.src) || document.baseURI
  var assetUrl = function (file) {
    try { return new URL(file, base).href } catch (e) { return file }
  }

  var clamp = function (v, a, b) { return Math.min(b === undefined ? 1 : b, Math.max(a === undefined ? 0 : a, v)) }
  var lerp = function (a, b, t) { return a + (b - a) * t }
  var smooth = function (a, b, x) { var t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t) }
  var sineInOut = function (x) { return 0.5 - 0.5 * Math.cos(Math.PI * clamp(x)) }
  var backOut = function (x) { var c = 1.9; x = clamp(x) - 1; return 1 + (c + 1) * x * x * x + c * x * x }
  function random(seed) {
    return function () { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 }
  }

  function store(kind) {
    try { return window[kind] || null } catch (e) { return null }
  }
  function readJson(kind, key) {
    try { var raw = store(kind) && store(kind).getItem(key); return raw ? JSON.parse(raw) : null } catch (e) { return null }
  }
  function writeJson(kind, key, value) {
    try { var s = store(kind); if (s) s.setItem(key, JSON.stringify(value)) } catch (e) { /* storage disabled */ }
  }
  function removeKey(kind, key) {
    try { var s = store(kind); if (s) s.removeItem(key) } catch (e) { /* storage disabled */ }
  }

  // ── Images ────────────────────────────────────────────────────────────────
  function loadImage(file) {
    var img = new Image()
    var done = new Promise(function (resolve) {
      img.onload = function () { resolve(img) }
      img.onerror = function () { resolve(null) }
    })
    img.decoding = 'async'
    img.src = assetUrl(file)
    return { img: img, ready: done }
  }
  var whale = loadImage('whale.png')
  var girl = loadImage('whale-girl.png')
  var ok = function (img) { return !!(img && img.complete && img.naturalWidth) }
  var whaleAspect = function () { return ok(whale.img) ? whale.img.naturalWidth / whale.img.naturalHeight : 880 / 478 }
  var girlAspect = function () { return ok(girl.img) ? girl.img.naturalWidth / girl.img.naturalHeight : 265 / 420 }

  // ── WebGL swim mesh (same deformation as vendor/whale/materials/whale-animation.js) ──
  var VERTEX = '#version 300 es\n'
    + 'precision highp float;in vec2 aUV;uniform float uTime;uniform float uAspect;out vec2 vUV;\n'
    + 'void main(){vUV=aUV;float phase=uTime*' + SWIM_RATE.toFixed(2) + ',aspect=uAspect;\n'
    + 'vec2 p=vec2((aUV.x-.5)*2.,(.5-aUV.y)*2.);\n'
    + 'float fin=smoothstep(.52,.72,aUV.y)*(1.-smoothstep(.56,.65,aUV.x))*smoothstep(.32,.43,aUV.x);\n'
    + 'float angle=sin(phase-.8)*.38*fin;vec2 q=vec2(p.x+.16,(p.y+.16)/aspect);\n'
    + 'p=vec2(-.16+q.x*cos(angle)-q.y*sin(angle),-.16+(q.x*sin(angle)+q.y*cos(angle))*aspect);\n'
    + 'float tail=smoothstep(.35,.95,aUV.x),wave=sin(phase-aUV.x*4.6);\n'
    + 'p.y+=wave*(.025+.30*tail*tail);p.x+=cos(phase-aUV.x*4.6)*.018*tail;\n'
    + 'float fluke=smoothstep(.70,.91,aUV.x),a=sin(phase-3.7)*.22*fluke;\n'
    + 'vec2 tq=vec2(p.x-.43,(p.y-.22)/aspect);\n'
    + 'p=vec2(.43+cos(a)*tq.x-sin(a)*tq.y,.22+(sin(a)*tq.x+cos(a)*tq.y)*aspect);\n'
    + 'gl_Position=vec4(p*.88,0.,1.);}'
  var FRAGMENT = '#version 300 es\n'
    + 'precision highp float;uniform sampler2D uImage;uniform float uTime;in vec2 vUV;out vec4 color;\n'
    + 'void main(){vec4 tex=texture(uImage,vUV);float breath=.98+.05*sin(uTime*.85+vUV.x*3.);'
    + 'color=vec4(tex.rgb*breath,tex.a);}'

  var mesh = null
  var meshError = null
  function getMesh() {
    if (mesh || meshError) return mesh
    try { mesh = createMesh() } catch (e) { meshError = String(e && e.message || e); mesh = null }
    return mesh
  }
  function createMesh() {
    var canvas = document.createElement('canvas')
    canvas.width = 1056
    canvas.height = Math.round(1056 / whaleAspect())
    var gl = canvas.getContext('webgl2', { alpha: true, antialias: true, premultipliedAlpha: false, preserveDrawingBuffer: true })
    if (!gl) throw new Error('WebGL2 unavailable')
    var compile = function (type, src) {
      var sh = gl.createShader(type); gl.shaderSource(sh, src); gl.compileShader(sh)
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh))
      return sh
    }
    var program = gl.createProgram()
    var vs = compile(gl.VERTEX_SHADER, VERTEX)
    var fs = compile(gl.FRAGMENT_SHADER, FRAGMENT)
    gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program))
    gl.deleteShader(vs); gl.deleteShader(fs); gl.useProgram(program)
    var verts = []
    var idx = []
    var nx = 100
    var ny = 54
    for (var y = 0; y <= ny; y++) for (var x = 0; x <= nx; x++) verts.push(x / nx, y / ny)
    for (var j = 0; j < ny; j++) for (var i = 0; i < nx; i++) {
      var a = j * (nx + 1) + i
      var b = a + nx + 1
      idx.push(a, b, a + 1, b, b + 1, a + 1)
    }
    var vao = gl.createVertexArray(); gl.bindVertexArray(vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW)
    var loc = gl.getAttribLocation(program, 'aUV'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 8, 0)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW)
    var uTime = gl.getUniformLocation(program, 'uTime')
    var uAspect = gl.getUniformLocation(program, 'uAspect')
    var tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.uniform1i(gl.getUniformLocation(program, 'uImage'), 0); gl.clearColor(0, 0, 0, 0)
    var uploaded = false
    return {
      triangles: idx.length / 3,
      render: function (seconds) {
        if (gl.isContextLost() || !ok(whale.img)) return null
        gl.useProgram(program); gl.bindVertexArray(vao); gl.bindTexture(gl.TEXTURE_2D, tex)
        if (!uploaded) { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, whale.img); uploaded = true }
        gl.viewport(0, 0, canvas.width, canvas.height); gl.clear(gl.COLOR_BUFFER_BIT)
        gl.uniform1f(uTime, seconds); gl.uniform1f(uAspect, whaleAspect())
        gl.drawElements(gl.TRIANGLES, idx.length, gl.UNSIGNED_SHORT, 0)
        return canvas
      },
    }
  }

  /** Draw the whale centered at the origin, `len` px across its frame, facing left. */
  function drawWhale(c, len, seconds, glowPx) {
    if (!ok(whale.img)) return
    var h = len / whaleAspect()
    var frame = getMesh() && mesh.render(seconds)
    c.save()
    c.shadowColor = 'rgba(101,225,255,.7)'
    c.shadowBlur = glowPx
    if (frame) c.drawImage(frame, -len / 2, -h / 2, len, h)
    else c.drawImage(whale.img, -len * 0.44, -h * 0.44, len * 0.88, h * 0.88)
    c.restore()
  }

  // ── Whale girl placement (shared by the canvas ending and the DOM mascot) ──
  function girlSize(vw, vh) {
    var h = Math.round(clamp(vh * 0.18, 100, 156))
    return { w: Math.round(h * girlAspect()), h: h }
  }
  function girlRect(vw, vh) {
    var size = girlSize(vw, vh)
    var saved = readJson('sessionStorage', GIRL_POS_KEY)
    var x = saved && typeof saved.x === 'number' ? saved.x : GIRL_LEFT
    var y = saved && typeof saved.y === 'number' ? saved.y : vh - GIRL_BOTTOM - size.h
    x = clamp(x, 0, Math.max(0, vw - size.w))
    y = clamp(y, 0, Math.max(0, vh - size.h))
    return { x: x, y: y, w: size.w, h: size.h, cx: x + size.w / 2, cy: y + size.h / 2 }
  }

  // ── Splash scene ──────────────────────────────────────────────────────────
  function Splash(options) {
    this.onDone = options.onDone || function () {}
    this.replay = !!options.replay
    this.root = document.createElement('div')
    this.root.className = 'dshws-overlay'
    this.root.setAttribute('aria-hidden', 'true')
    var rs = this.root.style
    rs.position = 'fixed'; rs.left = '0'; rs.top = '0'; rs.right = '0'; rs.bottom = '0'
    rs.zIndex = String(Z); rs.pointerEvents = 'auto'; rs.cursor = 'pointer'
    rs.opacity = this.replay ? '0' : '1'
    this.canvas = document.createElement('canvas')
    this.canvas.style.width = '100%'; this.canvas.style.height = '100%'; this.canvas.style.display = 'block'
    this.root.appendChild(this.canvas)
    this.ctx = this.canvas.getContext('2d')
    this.phase = 'idle'
    this.raf = 0
    this.startedAt = 0
    this.ready = false
    this.hiddenAt = null
    var rng = random(48611)
    this.dust = []
    for (var i = 0; i < 150; i++) {
      this.dust.push({ offset: rng(), life: 1.2 + rng() * 1.3, angle: rng() * 6.283, spin: (rng() - 0.5) * 2,
        spread: 0.3 + rng() * 0.9, speed: rng(), size: rng(), color: rng() < 0.1 ? 3 : Math.floor(rng() * 3) })
    }
    this.burst = []
    for (var k = 0; k < 72; k++) {
      this.burst.push({ angle: rng() * 6.283, dist: 0.6 + rng() * 0.8, spin: 0.6 + rng() * 1.6, size: rng(), color: Math.floor(rng() * 4) })
    }
    // Ripples come from tail strokes, irregularly spaced so they feel occasional.
    this.rippleTimes = [0.75, 1.95, 2.85, 4.1, 5.25]
    var self = this
    this._tick = function (now) { self.frame(now) }
    this._resize = function () { self.resize(); if (self.phase !== 'running') self.render(self.t || 0) }
    this._visibility = function () {
      if (document.hidden) { self.hiddenAt = performance.now(); cancelAnimationFrame(self.raf); self.raf = 0 }
      else if (self.phase === 'running') {
        if (self.hiddenAt !== null) self.startedAt += performance.now() - self.hiddenAt
        self.hiddenAt = null
        self.raf = requestAnimationFrame(self._tick)
      }
    }
    this._skip = function (event) {
      if (self.phase !== 'running' || !self.ready) return
      var t = (performance.now() - self.startedAt) / DURATION_MS
      if (t < T_SKIP) self.startedAt = performance.now() - T_SKIP * DURATION_MS
      if (event && event.preventDefault) event.preventDefault()
    }
  }

  Splash.prototype.mount = function () {
    ;(document.body || document.documentElement).appendChild(this.root)
    this.resize()
    this.render(0)
  }

  Splash.prototype.resize = function () {
    var w = Math.max(1, window.innerWidth || this.root.clientWidth || 1)
    var h = Math.max(1, window.innerHeight || this.root.clientHeight || 1)
    this.w = w; this.h = h
    this.dpr = Math.min(window.devicePixelRatio || 1, 1.75)
    this.canvas.width = Math.round(w * this.dpr)
    this.canvas.height = Math.round(h * this.dpr)
    this.L = clamp(Math.min(w * 0.46, h * 0.82), 240, 640)
    this.girl = girlRect(w, h)
    this.background = this.makeBackground()
    var rng = random(92731)
    var count = Math.round(clamp(w * h / 2400, 240, 720))
    this.stars = []
    for (var i = 0; i < count; i++) {
      this.stars.push({ x: rng(), y: rng(), r: 0.25 + rng() * 1.0, z: 0.2 + rng() * 0.8, phase: rng() * 6.283 })
    }
    this.buildPath()
  }

  Splash.prototype.makeBackground = function () {
    var bg = document.createElement('canvas')
    var w = this.w
    var h = this.h
    bg.width = Math.ceil(w); bg.height = Math.ceil(h)
    var c = bg.getContext('2d')
    c.fillStyle = '#040811'; c.fillRect(0, 0, w, h)
    var fog = function (x, y, r, color) {
      var g = c.createRadialGradient(x, y, 0, x, y, r)
      g.addColorStop(0, color); g.addColorStop(1, 'rgba(5,10,20,0)')
      c.fillStyle = g; c.fillRect(0, 0, w, h)
    }
    fog(w * 0.6, h * 0.38, w * 0.7, 'rgba(28,54,93,.55)')
    fog(w * 0.2, h * 0.7, w * 0.42, 'rgba(25,91,112,.28)')
    fog(w * 0.85, h * 0.12, w * 0.4, 'rgba(70,53,109,.24)')
    fog(w * 0.08, h * 0.92, w * 0.3, 'rgba(91,60,140,.18)')
    var rng = random(3197)
    for (var i = 0; i < 2200; i++) {
      var x = rng() * w
      var n = rng() + rng() + rng() - 1.5
      var y = h * 0.14 + x * 0.3 * (h / Math.max(w, 1)) * 1.4 + n * h * 0.15
      c.fillStyle = 'rgba(136,166,192,' + (0.025 + rng() * 0.09) + ')'
      c.fillRect(x, y, 0.45 + rng() * 0.7, 0.45 + rng() * 0.7)
    }
    return bg
  }

  /** Arc-length parametrised Catmull-Rom from off-screen right to the girl's spot. */
  Splash.prototype.buildPath = function () {
    var w = this.w
    var h = this.h
    var L = this.L
    var g = this.girl
    var pts = [
      { x: w + L * 0.7, y: h * 0.36 },
      { x: w * 0.74, y: h * 0.27 },
      { x: w * 0.55, y: h * 0.55 },
      { x: w * 0.36, y: h * 0.34 },
      { x: lerp(w * 0.36, g.cx, 0.55), y: lerp(h * 0.34, g.cy, 0.35) + h * 0.12 },
      { x: g.cx, y: g.cy },
    ]
    var at = function (s) {
      var n = pts.length - 1
      var f = clamp(s) * n
      var i = Math.min(n - 1, Math.floor(f))
      var u = f - i
      var p0 = pts[Math.max(0, i - 1)]
      var p1 = pts[i]
      var p2 = pts[i + 1]
      var p3 = pts[Math.min(n, i + 2)]
      var u2 = u * u
      var u3 = u2 * u
      var cr = function (a, b, c2, d) {
        return 0.5 * (2 * b + (-a + c2) * u + (2 * a - 5 * b + 4 * c2 - d) * u2 + (-a + 3 * b - 3 * c2 + d) * u3)
      }
      return { x: cr(p0.x, p1.x, p2.x, p3.x), y: cr(p0.y, p1.y, p2.y, p3.y) }
    }
    var samples = 240
    var table = [0]
    var prev = at(0)
    for (var k = 1; k <= samples; k++) {
      var cur = at(k / samples)
      table.push(table[k - 1] + Math.hypot(cur.x - prev.x, cur.y - prev.y))
      prev = cur
    }
    var total = table[samples] || 1
    this.pathAt = function (d) {
      var target = clamp(d) * total
      var lo = 0
      var hi = samples
      while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (table[mid] < target) lo = mid; else hi = mid }
      var span = table[hi] - table[lo] || 1
      return at((lo + (target - table[lo]) / span) / samples)
    }
  }

  Splash.prototype.pose = function (t) {
    var travel = sineInOut(clamp((t - 0.02) / (T_ARRIVE - 0.02)))
    var p = this.pathAt(travel)
    var q = this.pathAt(Math.min(1, travel + 0.01))
    var r = this.pathAt(Math.max(0, travel - 0.01))
    var dx = q.x - r.x
    var dy = q.y - r.y
    var flip = dx > 0 ? -1 : 1
    var angle = flip > 0 ? Math.atan2(-dy, -dx) : Math.atan2(dy, dx)
    angle = clamp(angle, -0.62, 0.62)
    var seconds = t * DURATION_MS / 1000
    var endScale = (this.girl.w * 1.7) / this.L
    var scale = lerp(1, endScale, smooth(T_SHRINK, T_ARRIVE, t))
    var bob = Math.sin(seconds * SWIM_RATE * 0.5) * this.L * 0.012 * scale
    var alpha = smooth(0.005, 0.04, t) * (1 - smooth(0.835, 0.885, t))
    return { x: p.x, y: p.y + bob, angle: angle, flip: flip, scale: scale, alpha: alpha, seconds: seconds }
  }

  /** Where the fluke is at time t (the source of ripples and the wake). */
  Splash.prototype.tailAt = function (t) {
    var p = this.pose(t)
    var len = this.L * p.scale
    var h = len / whaleAspect()
    var lx = 0.41 * 0.88 * len * p.flip
    var ly = -0.28 * 0.88 * h + Math.sin(p.seconds * SWIM_RATE - 3.7) * h * 0.12
    var ca = Math.cos(p.angle)
    var sa = Math.sin(p.angle)
    return { x: p.x + ca * lx - sa * ly, y: p.y + sa * lx + ca * ly, alpha: p.alpha, scale: p.scale }
  }

  Splash.prototype.ripples = function (t) {
    var seconds = t * DURATION_MS / 1000
    var span = Math.min(this.w, this.h)
    var list = []
    for (var i = 0; i < this.rippleTimes.length; i++) {
      var emitted = this.rippleTimes[i]
      var age = seconds - emitted
      if (age < 0 || age > 3) continue
      var src = this.tailAt(emitted / (DURATION_MS / 1000))
      var strength = smooth(0, 0.18, age) * (1 - smooth(1.4, 3, age)) * clamp(src.alpha * 1.2) * (0.55 + 0.45 * src.scale)
      list.push({ x: src.x, y: src.y, r: span * (0.03 + age * 0.26) * (0.6 + 0.4 * src.scale), width: 22 + age * 12,
        strength: strength, squash: 0.68 })
    }
    return list
  }

  /** The final ripple: its front is the edge of the hole that dissolves the veil. */
  Splash.prototype.revealRadius = function (t) {
    if (t <= T_BURST) return 0
    var g = this.girl
    var far = Math.max(Math.hypot(g.cx, g.cy), Math.hypot(this.w - g.cx, g.cy),
      Math.hypot(g.cx, this.h - g.cy), Math.hypot(this.w - g.cx, this.h - g.cy)) + 140
    var k = clamp((t - T_BURST) / (1 - T_BURST))
    return far * (k * k * (1.6 - 0.6 * k))
  }

  Splash.prototype.render = function (t) {
    this.t = t
    var c = this.ctx
    if (!c) return
    var w = this.w
    var h = this.h
    var seconds = t * DURATION_MS / 1000
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    c.globalCompositeOperation = 'source-over'
    c.globalAlpha = 1
    c.clearRect(0, 0, w, h)
    c.drawImage(this.background, 0, 0, w, h)

    var ripples = this.ripples(t)
    var R = this.revealRadius(t)
    var g = this.girl
    if (R > 0) ripples.push({ x: g.cx, y: g.cy, r: R, width: 40, strength: 1 - smooth(0.9, 1, t), squash: 1 })
    this.drawStars(seconds, ripples)
    this.drawRipples(ripples)
    this.drawWake(t, seconds)
    this.drawWhale(t)

    if (R > 0) {
      c.save()
      c.globalCompositeOperation = 'destination-out'
      var feather = Math.max(60, R * 0.18)
      var hole = c.createRadialGradient(g.cx, g.cy, 0, g.cx, g.cy, R)
      hole.addColorStop(0, 'rgba(0,0,0,1)')
      hole.addColorStop(clamp(1 - feather / R), 'rgba(0,0,0,1)')
      hole.addColorStop(1, 'rgba(0,0,0,0)')
      c.fillStyle = hole
      c.fillRect(0, 0, w, h)
      c.restore()
      this.drawRevealFront(g.cx, g.cy, R, t)
    }
    this.drawBurst(t)
    this.drawGirl(t)
  }

  Splash.prototype.drawStars = function (seconds, ripples) {
    var c = this.ctx
    var w = this.w
    var h = this.h
    for (var i = 0; i < this.stars.length; i++) {
      var s = this.stars[i]
      var x = (s.x * w + seconds * s.z * 2.2) % w
      var y = s.y * h
      var dx = 0
      var dy = 0
      var light = 0
      for (var j = 0; j < ripples.length; j++) {
        var rp = ripples[j]
        if (rp.strength < 0.002) continue
        var ox = x - rp.x
        var oy = (y - rp.y) / rp.squash
        var d = Math.hypot(ox, oy) || 1
        var band = (d - rp.r) / rp.width
        if (band < -3 || band > 3) continue
        var crest = Math.exp(-band * band) * rp.strength
        var push = Math.sin(band * 2.2) * crest * 11
        dx += ox / d * push
        dy += oy / d * push * rp.squash
        light += crest
      }
      var px = x + dx
      var py = y + dy
      var alpha = clamp((0.22 + s.z * 0.45) * (1 + 0.16 * Math.sin(s.phase + seconds * 1.1)) + light * 0.5)
      c.fillStyle = light > 0.15 ? 'rgba(196,232,255,' + alpha + ')' : 'rgba(179,216,242,' + alpha + ')'
      c.beginPath()
      c.arc(px, py, s.r * (0.7 + s.z * 0.3) + Math.min(0.9, light * 0.6), 0, 6.2832)
      c.fill()
      if (s.r > 1.05 && s.z > 0.82) {
        c.strokeStyle = 'rgba(174,211,226,' + alpha * 0.32 + ')'
        c.lineWidth = 0.55
        c.beginPath(); c.moveTo(px - 3, py); c.lineTo(px + 3, py); c.moveTo(px, py - 3); c.lineTo(px, py + 3); c.stroke()
      }
    }
  }

  Splash.prototype.drawRipples = function (ripples) {
    var c = this.ctx
    c.save()
    c.globalCompositeOperation = 'lighter'
    for (var i = 0; i < ripples.length; i++) {
      var rp = ripples[i]
      if (rp.squash === 1 || rp.strength < 0.01) continue
      var rings = [[0, 0.5, '120,220,255'], [-0.55, 0.28, '150,140,255'], [-1.1, 0.14, '230,140,230']]
      for (var k = 0; k < rings.length; k++) {
        var r = rp.r + rings[k][0] * rp.width
        if (r <= 2) continue
        c.beginPath()
        c.ellipse(rp.x, rp.y, r, r * rp.squash, 0, 0, 6.2832)
        c.strokeStyle = 'rgba(' + rings[k][2] + ',' + rp.strength * rings[k][1] * 0.22 + ')'
        c.lineWidth = rp.width * 0.5
        c.stroke()
        c.strokeStyle = 'rgba(' + rings[k][2] + ',' + rp.strength * rings[k][1] + ')'
        c.lineWidth = 1.1
        c.stroke()
      }
    }
    c.restore()
  }

  Splash.prototype.drawRevealFront = function (x, y, R, t) {
    var c = this.ctx
    var fade = 1 - smooth(0.92, 1, t)
    if (fade <= 0) return
    c.save()
    c.globalCompositeOperation = 'lighter'
    var colors = ['120,220,255', '150,140,255', '230,140,230']
    for (var k = 0; k < 3; k++) {
      var r = R - k * 26
      if (r <= 4) continue
      c.beginPath(); c.arc(x, y, r, 0, 6.2832)
      c.strokeStyle = 'rgba(' + colors[k] + ',' + 0.16 * fade / (k + 1) + ')'
      c.lineWidth = 16
      c.stroke()
      c.strokeStyle = 'rgba(' + colors[k] + ',' + 0.75 * fade / (k + 1) + ')'
      c.lineWidth = 1.4
      c.stroke()
    }
    c.restore()
  }

  Splash.prototype.drawWake = function (t, seconds) {
    var c = this.ctx
    var palette = ['91,219,255', '135,116,255', '230,123,228', '255,207,142']
    var stopAt = T_ARRIVE * DURATION_MS / 1000
    c.save()
    c.globalCompositeOperation = 'lighter'
    for (var i = 0; i < this.dust.length; i++) {
      var d = this.dust[i]
      var age = (seconds + d.offset * d.life) % d.life
      var emitted = seconds - age
      if (emitted < 0.3 || emitted > stopAt) continue
      var a = this.tailAt(emitted / (DURATION_MS / 1000))
      var life = smooth(0, 0.14, age) * (1 - smooth(d.life * 0.35, d.life, age)) * a.alpha
      if (life < 0.01) continue
      var L = this.L * a.scale
      var swirl = d.angle + age * (0.7 + d.spin)
      var radius = L * (0.02 + age * 0.09) * d.spread
      var x = a.x + age * L * (0.05 + d.speed * 0.1) + Math.cos(swirl) * radius
      var y = a.y + Math.sin(swirl) * radius * 0.8 - age * L * 0.03
      var size = (0.6 + d.size * 1.6) * Math.max(0.6, L / 600)
      var rgb = palette[d.color]
      var glow = c.createRadialGradient(x, y, 0, x, y, size * 6)
      glow.addColorStop(0, 'rgba(' + rgb + ',' + life * 0.22 + ')')
      glow.addColorStop(1, 'rgba(' + rgb + ',0)')
      c.fillStyle = glow
      c.fillRect(x - size * 6, y - size * 6, size * 12, size * 12)
      c.fillStyle = 'rgba(' + rgb + ',' + life * (0.45 + d.size * 0.45) + ')'
      c.beginPath(); c.arc(x, y, size * 0.8, 0, 6.2832); c.fill()
    }
    c.restore()
  }

  Splash.prototype.drawWhale = function (t) {
    var p = this.pose(t)
    if (p.alpha < 0.002) return
    var c = this.ctx
    var len = this.L * p.scale
    c.save()
    c.globalCompositeOperation = 'lighter'
    var halo = c.createRadialGradient(p.x, p.y, 0, p.x, p.y, len * 0.6)
    halo.addColorStop(0, 'rgba(91,219,255,' + 0.12 * p.alpha + ')')
    halo.addColorStop(1, 'rgba(91,219,255,0)')
    c.fillStyle = halo
    c.fillRect(p.x - len, p.y - len, len * 2, len * 2)
    c.restore()
    c.save()
    c.globalAlpha = p.alpha
    c.translate(p.x, p.y)
    c.rotate(p.angle)
    c.scale(p.flip, 1)
    drawWhale(c, len, p.seconds, Math.max(4, len * 0.03) * this.dpr)
    c.restore()
  }

  Splash.prototype.drawBurst = function (t) {
    if (t < 0.82 || t > 0.97) return
    var c = this.ctx
    var g = this.girl
    var palette = ['91,219,255', '135,116,255', '230,123,228', '255,236,180']
    var flash = Math.exp(-Math.pow((t - T_BURST) / 0.02, 2))
    c.save()
    c.globalCompositeOperation = 'lighter'
    var fr = g.h * 1.5
    var glow = c.createRadialGradient(g.cx, g.cy, 0, g.cx, g.cy, fr)
    glow.addColorStop(0, 'rgba(235,250,255,' + 0.85 * flash + ')')
    glow.addColorStop(0.3, 'rgba(91,219,255,' + 0.4 * flash + ')')
    glow.addColorStop(1, 'rgba(91,219,255,0)')
    c.fillStyle = glow
    c.fillRect(g.cx - fr, g.cy - fr, fr * 2, fr * 2)
    var gather = smooth(0.82, T_BURST, t)
    var spread = smooth(T_BURST, 0.96, t)
    for (var i = 0; i < this.burst.length; i++) {
      var b = this.burst[i]
      var r = t < T_BURST ? g.h * b.dist * 1.4 * (1 - gather) + 4 : g.h * (0.15 + b.dist * 0.9 * spread)
      var a = b.angle + b.spin * (t - 0.82) * 14
      var alpha = t < T_BURST ? gather * 0.9 : (1 - spread) * 0.9
      var x = g.cx + Math.cos(a) * r
      var y = g.cy + Math.sin(a) * r * 0.9
      var size = 0.8 + b.size * 1.8
      c.fillStyle = 'rgba(' + palette[b.color] + ',' + alpha + ')'
      c.beginPath(); c.arc(x, y, size, 0, 6.2832); c.fill()
      if (b.size > 0.8) {
        c.strokeStyle = 'rgba(235,242,255,' + alpha * 0.7 + ')'
        c.lineWidth = 0.7
        c.beginPath(); c.moveTo(x - size * 3, y); c.lineTo(x + size * 3, y); c.moveTo(x, y - size * 3); c.lineTo(x, y + size * 3); c.stroke()
      }
    }
    c.restore()
  }

  Splash.prototype.drawGirl = function (t) {
    if (t < T_GIRL_IN || !ok(girl.img)) return
    var c = this.ctx
    var g = this.girl
    var k = clamp((t - T_GIRL_IN) / (T_GIRL_DONE - T_GIRL_IN))
    var scale = lerp(0.45, 1, backOut(k))
    var alpha = smooth(0, 0.6, k)
    c.save()
    c.globalCompositeOperation = 'lighter'
    var glow = c.createRadialGradient(g.cx, g.cy, 0, g.cx, g.cy, g.h * 0.75)
    glow.addColorStop(0, 'rgba(91,219,255,' + 0.22 * alpha * (1 - smooth(0.93, 1, t) * 0.6) + ')')
    glow.addColorStop(1, 'rgba(91,219,255,0)')
    c.fillStyle = glow
    c.fillRect(g.cx - g.h, g.cy - g.h, g.h * 2, g.h * 2)
    c.restore()
    c.save()
    c.globalAlpha = alpha
    c.translate(g.cx, g.cy)
    c.scale(scale, scale)
    c.shadowColor = 'rgba(101,225,255,.75)'
    c.shadowBlur = 14 * this.dpr
    c.drawImage(girl.img, -g.w / 2, -g.h / 2, g.w, g.h)
    c.restore()
  }

  Splash.prototype.start = function () {
    var self = this
    this.mount()
    this.phase = 'running'
    this.startedAt = performance.now()
    window.addEventListener('resize', this._resize)
    document.addEventListener('visibilitychange', this._visibility)
    this.root.addEventListener('pointerdown', this._skip)
    window.addEventListener('keydown', this._skip, true)
    Promise.all([whale.ready, girl.ready]).then(function () { self.markReady() })
    setTimeout(function () { self.markReady() }, 1200)
    this.raf = requestAnimationFrame(this._tick)
  }

  Splash.prototype.markReady = function () {
    if (this.ready) return
    this.ready = true
    this.girl = girlRect(this.w, this.h)
    this.buildPath()
    this.startedAt = performance.now()
  }

  Splash.prototype.frame = function (now) {
    if (this.phase !== 'running') return
    if (!this.ready) this.startedAt = now
    var t = clamp((now - this.startedAt) / DURATION_MS)
    if (this.replay) this.root.style.opacity = String(smooth(0, 0.05, t))
    this.root.style.pointerEvents = t < T_BURST ? 'auto' : 'none'
    this.render(t)
    if (t >= 1) this.finish()
    else this.raf = requestAnimationFrame(this._tick)
  }

  Splash.prototype.stop = function () {
    cancelAnimationFrame(this.raf)
    this.raf = 0
    this.phase = 'stopped'
    window.removeEventListener('resize', this._resize)
    document.removeEventListener('visibilitychange', this._visibility)
    window.removeEventListener('keydown', this._skip, true)
    if (this.root.parentNode) this.root.parentNode.removeChild(this.root)
  }

  Splash.prototype.finish = function () {
    if (this.phase !== 'running') return
    this.stop()
    this.phase = 'complete'
    this.onDone()
  }

  // ── The resting mascot ────────────────────────────────────────────────────
  var STYLE_ID = 'dshws-style'
  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return
    var style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = ''
      + '.dshws-girl{position:fixed;z-index:' + (Z - 1) + ';cursor:grab;user-select:none;-webkit-user-select:none;touch-action:none;'
      + 'transition:opacity .45s ease;}'
      + '.dshws-girl.is-dragging{cursor:grabbing}'
      + '.dshws-girl.is-hiding{opacity:0}'
      + '.dshws-girl img{width:100%;height:100%;display:block;pointer-events:none;'
      + 'animation:dshws-float 3.6s ease-in-out infinite,dshws-glow 3.6s ease-in-out infinite;'
      + 'filter:drop-shadow(0 0 7px rgba(101,225,255,.55));}'
      + '.dshws-girl:hover img{filter:drop-shadow(0 0 12px rgba(101,225,255,.9)) brightness(1.08)}'
      + '.dshws-girl.is-dragging img{animation-play-state:paused}'
      + '@keyframes dshws-float{0%,100%{transform:translateY(0) rotate(0)}50%{transform:translateY(-5px) rotate(-1.5deg)}}'
      + '@keyframes dshws-glow{0%,100%{filter:drop-shadow(0 0 7px rgba(101,225,255,.55))}'
      + '50%{filter:drop-shadow(0 0 11px rgba(135,116,255,.7))}}'
      + '@media (prefers-reduced-motion: reduce){.dshws-girl img{animation:none}}'
    ;(document.head || document.documentElement).appendChild(style)
  }

  var girlEl = null
  function showGirl(fadeIn) {
    if (girlEl || readJson('sessionStorage', GIRL_HIDDEN_KEY)) return
    ensureStyle()
    var rect = girlRect(window.innerWidth, window.innerHeight)
    var el = document.createElement('div')
    el.className = 'dshws-girl'
    el.title = '鲸鱼娘 · 拖动可移动 · 双击重播启动动画 · 右键隐藏'
    el.setAttribute('role', 'img')
    el.setAttribute('aria-label', 'DSH whale girl')
    el.style.left = rect.x + 'px'
    el.style.top = rect.y + 'px'
    el.style.width = rect.w + 'px'
    el.style.height = rect.h + 'px'
    var img = document.createElement('img')
    img.src = assetUrl('whale-girl.png')
    img.alt = ''
    img.draggable = false
    el.appendChild(img)
    if (fadeIn) { el.style.opacity = '0'; requestAnimationFrame(function () { el.style.opacity = '1' }) }
    ;(document.body || document.documentElement).appendChild(el)
    girlEl = el

    var drag = null
    el.addEventListener('pointerdown', function (event) {
      if (event.button !== 0) return
      var box = el.getBoundingClientRect()
      drag = { sx: event.clientX, sy: event.clientY, ox: event.clientX - box.left, oy: event.clientY - box.top, moved: false, id: event.pointerId }
      try { el.setPointerCapture(event.pointerId) } catch (e) { /* already released */ }
    })
    el.addEventListener('pointermove', function (event) {
      if (!drag) return
      if (!drag.moved && Math.hypot(event.clientX - drag.sx, event.clientY - drag.sy) < 4) return
      drag.moved = true
      el.classList.add('is-dragging')
      place(event.clientX - drag.ox, event.clientY - drag.oy)
    })
    var endDrag = function () {
      if (!drag) return
      try { el.releasePointerCapture(drag.id) } catch (e) { /* already released */ }
      if (drag.moved) writeJson('sessionStorage', GIRL_POS_KEY, { x: parseFloat(el.style.left) || 0, y: parseFloat(el.style.top) || 0 })
      el.classList.remove('is-dragging')
      drag = null
    }
    el.addEventListener('pointerup', endDrag)
    el.addEventListener('pointercancel', endDrag)
    el.addEventListener('dblclick', function (event) { event.preventDefault(); replay() })
    el.addEventListener('contextmenu', function (event) {
      event.preventDefault()
      writeJson('sessionStorage', GIRL_HIDDEN_KEY, true)
      el.classList.add('is-hiding')
      setTimeout(removeGirl, 480)
    })
    function place(x, y) {
      var w = el.offsetWidth || rect.w
      var h = el.offsetHeight || rect.h
      el.style.left = clamp(x, 0, Math.max(0, window.innerWidth - w)) + 'px'
      el.style.top = clamp(y, 0, Math.max(0, window.innerHeight - h)) + 'px'
    }
    el.__place = function () { place(parseFloat(el.style.left) || 0, parseFloat(el.style.top) || 0) }
  }
  function removeGirl() {
    if (girlEl && girlEl.parentNode) girlEl.parentNode.removeChild(girlEl)
    girlEl = null
  }
  window.addEventListener('resize', function () { if (girlEl) girlEl.__place() })

  // ── Entry points ──────────────────────────────────────────────────────────
  var current = null
  var reduced = false
  try { reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch (e) { /* old engine */ }

  function play(replayMode) {
    if (current && current.phase === 'running') return
    if (replayMode) removeGirl()
    try {
      current = new Splash({ replay: replayMode, onDone: function () { showGirl(false) } })
      if (!current.ctx) throw new Error('2D canvas unavailable')
      current.start()
    } catch (e) {
      console.warn('[dsh-whale-splash] animation failed, showing the mascot directly:', e)
      if (current) current.stop()
      current = null
      showGirl(true)
    }
  }

  function replay() {
    removeKey('sessionStorage', GIRL_HIDDEN_KEY)
    play(true)
  }

  /** Paint a single frame at progress `t` without running the clock (previews / tests). */
  function renderAt(t) {
    return Promise.all([whale.ready, girl.ready]).then(function () {
      if (!current || current.phase === 'running') {
        if (current) current.stop()
        current = new Splash({ replay: false })
        current.mount()
        current.phase = 'paused'
      }
      current.girl = girlRect(current.w, current.h)
      current.buildPath()
      current.render(clamp(t))
      return { mode: getMesh() ? 'webgl2-mesh' : 'image', error: meshError }
    })
  }

  window.DshWhaleSplash = {
    version: VERSION,
    durationMs: DURATION_MS,
    replay: replay,
    renderAt: renderAt,
    rendererInfo: function () {
      return { mode: mesh ? 'webgl2-mesh' : 'image', error: meshError, whaleReady: ok(whale.img), girlReady: ok(girl.img) }
    },
  }

  function boot() {
    if (window.__DSH_WHALE_SPLASH_MANUAL__) return
    var played = readJson('sessionStorage', PLAYED_KEY)
    writeJson('sessionStorage', PLAYED_KEY, true)
    if (played || reduced) { showGirl(true); return }
    play(false)
  }
  // Boot right away (not on DOMContentLoaded) so the veil is up before the UI paints.
  boot()
})()
