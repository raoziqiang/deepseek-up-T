// deepseek-up-T :: DeepSeek 余额悬浮窗（渲染层）
//
// 由 assets/client.js 带起，宿主路由 `/dsh-up-t/balance.js` 按 mtime 重读 —— 改完硬刷新即生效。
// 数据只来自宿主的 `/dsh-up-t/balance.json`（已算好的结论，**不含密钥**）。
//
// 风格与启动动画一致（科幻 × 赛博朋克）：深色玻璃、切角、霓虹描边、扫描线、等宽字。
// 样式全部关在 Shadow DOM 里：既不污染 Harness 的界面，也不会被它的 CSS 弄坏。
//
// 交互：整块可拖（位置记 localStorage，窗口缩放时钳回可见区）；方向键也能挪；
// 「⟳」或双击刷新；「–」收成小胶囊再点展开；右键隐藏（控制台有恢复办法）。
// 余额 ≤ 阈值时变琥珀色并呼吸闪烁；接口说余额不足时变红。
// 绝不能影响主界面：任何异常都吞掉。

(function () {
  'use strict';
  try {
    if (window.__DSH_UP_T_BALANCE__) return;

    var DATA_URL = '/dsh-up-t/balance.json';
    var POS_KEY = 'dsh-up-t:balance:pos';
    var MIN_KEY = 'dsh-up-t:balance:min';
    var HIDDEN_KEY = 'dsh-up-t:balance:hidden';
    var POLL_MS = 5 * 60 * 1000;
    var Z = 2147482990; // 比状态胶囊低一点，两者重叠时胶囊在上

    var store = {
      get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
      set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 存储被禁也照常工作 */ } },
    };

    var CSS = [
      ':host{all:initial}',
      '.w{position:fixed;z-index:' + Z + ';min-width:208px;max-width:260px;box-sizing:border-box;padding:10px 12px 9px;',
      'font:12px/1.35 "Cascadia Mono",Consolas,"JetBrains Mono",Menlo,monospace;color:#cdefff;',
      'background:linear-gradient(160deg,rgba(14,9,34,.92),rgba(5,3,14,.9));',
      'border:1px solid rgba(0,240,255,.45);',
      'clip-path:polygon(10px 0,100% 0,100% calc(100% - 10px),calc(100% - 10px) 100%,0 100%,0 10px);',
      'box-shadow:0 0 18px rgba(0,240,255,.18),inset 0 0 22px rgba(122,60,255,.12);',
      '-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);',
      'cursor:grab;user-select:none;-webkit-user-select:none;touch-action:none;outline:none;',
      'transition:border-color .3s,box-shadow .3s}',
      '.w:focus-visible{border-color:#fff}',
      '.w.drag{cursor:grabbing;transition:none}',
      '.w::after{content:"";position:absolute;inset:0;pointer-events:none;',
      'background:repeating-linear-gradient(0deg,rgba(0,0,0,.18) 0 1px,transparent 1px 3px);mix-blend-mode:multiply}',
      '.hd{display:flex;align-items:center;gap:6px;font-size:10px;letter-spacing:.14em;color:rgba(0,240,255,.8)}',
      '.led{width:7px;height:7px;border-radius:50%;background:#00f0ff;box-shadow:0 0 8px #00f0ff;flex:none}',
      '.tt{flex:1;white-space:nowrap}',
      '.b{all:unset;cursor:pointer;width:18px;height:18px;line-height:18px;text-align:center;color:#8fdcff;font-size:12px}',
      '.b:hover,.b:focus-visible{color:#fff;text-shadow:0 0 6px #00f0ff}',
      '.amt{margin:6px 0 2px;font-size:24px;font-weight:700;letter-spacing:.02em;white-space:nowrap;',
      'background:linear-gradient(90deg,#00f0ff,#c7b6ff 60%,#ff2bd6);-webkit-background-clip:text;background-clip:text;color:transparent;',
      'filter:drop-shadow(0 0 6px rgba(0,240,255,.35))}',
      '.sub{color:rgba(205,239,255,.7);font-size:11px;white-space:nowrap}',
      '.ft{display:flex;justify-content:space-between;gap:8px;margin-top:6px;font-size:10px;color:rgba(205,239,255,.45)}',
      '.msg{margin-top:6px;font-size:11px;color:#ffb4c8;max-width:236px;white-space:normal}',
      /* 状态色 */
      '.w.low{border-color:rgba(255,176,0,.75);box-shadow:0 0 20px rgba(255,176,0,.28),inset 0 0 22px rgba(255,43,214,.14)}',
      '.w.low .led{background:#ffb000;box-shadow:0 0 8px #ffb000}',
      '.w.low .amt{background:linear-gradient(90deg,#ffb000,#ff2bd6);-webkit-background-clip:text;background-clip:text}',
      '.w.out{border-color:rgba(255,59,92,.85);box-shadow:0 0 22px rgba(255,59,92,.35)}',
      '.w.out .led{background:#ff3b5c;box-shadow:0 0 8px #ff3b5c}',
      '.w.out .amt{background:linear-gradient(90deg,#ff3b5c,#ff2bd6);-webkit-background-clip:text;background-clip:text}',
      '.w.err .led,.w.nokey .led{background:#6b7280;box-shadow:none}',
      '.w.err .amt,.w.nokey .amt{background:none;color:rgba(205,239,255,.4);filter:none}',
      '.w.busy .led{animation:blink .5s steps(2) infinite}',
      '.w.low,.w.out{animation:breathe 2.4s ease-in-out infinite}',
      '@keyframes blink{50%{opacity:.2}}',
      '@keyframes breathe{50%{box-shadow:0 0 6px rgba(255,176,0,.12)}}',
      /* 收起成胶囊 */
      '.w.min{min-width:0;padding:5px 10px 5px 9px;clip-path:polygon(6px 0,100% 0,100% calc(100% - 6px),calc(100% - 6px) 100%,0 100%,0 6px)}',
      '.w.min .tt,.w.min .sub,.w.min .ft,.w.min .msg,.w.min .rf{display:none}',
      '.w.min .hd{gap:7px}',
      '.w.min .amt{margin:0;font-size:13px}',
      '@media (prefers-reduced-motion:reduce){.w,.w.low,.w.out,.w.busy .led{animation:none!important;transition:none}}',
    ].join('');

    function fmt(n) {
      return typeof n === 'number' && isFinite(n) ? n.toFixed(2) : '—';
    }
    function sym(cur) { return cur === 'USD' ? '$' : cur === 'CNY' ? '¥' : (cur ? cur + ' ' : ''); }
    function hhmm(t) {
      try { var d = new Date(t); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); } catch (e) { return ''; }
    }

    function mount() {
      if (store.get(HIDDEN_KEY) === '1') {
        window.__DSH_UP_T_BALANCE__ = { hidden: true };
        return;
      }
      var host = document.createElement('div');
      host.setAttribute('data-dsh-up-t', 'balance');
      var shadow = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
      // 优先走 CSSOM（constructable stylesheet）：主窗口的 CSP 若不放行内联 <style>，
      // <style> 会被静默丢掉，而 CSSOM 不受 style-src 限制。老内核才退回 <style>。
      var adopted = false;
      try {
        if (shadow !== host && typeof CSSStyleSheet === 'function' && 'adoptedStyleSheets' in shadow) {
          var sheet = new CSSStyleSheet();
          sheet.replaceSync(CSS);
          shadow.adoptedStyleSheets = [sheet];
          adopted = true;
        }
      } catch (e) { adopted = false; }
      if (!adopted) {
        var style = document.createElement('style');
        style.textContent = CSS;
        shadow.appendChild(style);
      }

      var w = document.createElement('div');
      w.className = 'w busy';
      w.tabIndex = 0;
      w.setAttribute('role', 'status');
      w.setAttribute('aria-label', 'DeepSeek 余额');
      w.innerHTML =
        '<div class="hd"><span class="led"></span><span class="tt">DEEPSEEK // CREDIT</span>' +
        '<button class="b rf" title="刷新" aria-label="刷新余额">⟳</button>' +
        '<button class="b mn" title="收起" aria-label="收起或展开">–</button></div>' +
        '<div class="amt">—</div><div class="sub">正在读取…</div>' +
        '<div class="ft"><span class="at"></span><span class="lw"></span></div>' +
        '<div class="msg" hidden></div>';
      shadow.appendChild(w);
      (document.body || document.documentElement).appendChild(host);

      var q = function (s) { return w.querySelector(s); };
      var amtEl = q('.amt'), subEl = q('.sub'), atEl = q('.at'), lwEl = q('.lw'), msgEl = q('.msg');
      var hd = q('.hd');

      // ── 渲染一份结论 ──
      var last = null;
      function render(d) {
        last = d;
        w.classList.remove('busy', 'low', 'out', 'err', 'nokey');
        msgEl.hidden = true;
        msgEl.textContent = '';
        if (d && d.ok) {
          amtEl.textContent = sym(d.currency) + fmt(d.total);
          subEl.textContent = '赠送 ' + fmt(d.granted) + ' · 充值 ' + fmt(d.toppedUp);
          atEl.textContent = '更新 ' + hhmm(d.at);
          lwEl.textContent = '阈值 ' + fmt(d.low);
          if (!d.available) {
            w.classList.add('out');
            msgEl.textContent = '余额不足，API 调用会失败';
            msgEl.hidden = false;
          } else if (d.isLow) {
            w.classList.add('low');
            msgEl.textContent = '余额偏低（≤ ' + fmt(d.low) + '）';
            msgEl.hidden = false;
          }
          w.setAttribute('aria-label', 'DeepSeek 余额 ' + amtEl.textContent);
        } else {
          w.classList.add(d && d.code === 'no-key' ? 'nokey' : 'err');
          amtEl.textContent = d && d.code === 'no-key' ? '未配置' : '离线';
          subEl.textContent = d && d.code === 'no-key' ? '缺少 DEEPSEEK_API_KEY' : '读不到余额';
          atEl.textContent = d && d.at ? '尝试 ' + hhmm(d.at) : '';
          lwEl.textContent = '';
          msgEl.textContent = (d && d.error) || '宿主没有回应';
          msgEl.hidden = false;
          w.setAttribute('aria-label', 'DeepSeek 余额：' + msgEl.textContent);
        }
        if (w.classList.contains('min')) w.title = msgEl.textContent || subEl.textContent;
        place();
      }

      var loading = false;
      function refresh(force) {
        if (loading) return;
        loading = true;
        w.classList.add('busy');
        var url = DATA_URL + (force ? '?refresh=1' : '');
        fetch(url, { cache: 'no-store' })
          .then(function (r) { return r.json(); })
          .then(render)
          .catch(function () { render({ ok: false, code: 'host', error: '宿主路由不可达（插件未加载或 Harness 需要重启）' }); })
          .then(function () { loading = false; w.classList.remove('busy'); });
      }

      // ── 位置：拖动 / 方向键 / 窗口缩放都钳回可见区 ──
      var pos = null;
      try { pos = JSON.parse(store.get(POS_KEY) || 'null'); } catch (e) { pos = null; }
      if (!pos || typeof pos.x !== 'number' || typeof pos.y !== 'number') pos = null;
      function place() {
        var vw = window.innerWidth || 0, vh = window.innerHeight || 0;
        var ww = w.offsetWidth || 220, wh = w.offsetHeight || 96;
        var x = pos ? pos.x : vw - ww - 24;
        var y = pos ? pos.y : 72;
        x = Math.min(Math.max(0, x), Math.max(0, vw - ww));
        y = Math.min(Math.max(0, y), Math.max(0, vh - wh));
        w.style.left = x + 'px';
        w.style.top = y + 'px';
        return { x: x, y: y };
      }
      function save(p) { pos = p; store.set(POS_KEY, JSON.stringify(p)); }

      var drag = null;
      w.addEventListener('pointerdown', function (ev) {
        if (ev.button !== 0) return;
        if (ev.target && ev.target.closest && ev.target.closest('button')) return;
        var r = place();
        drag = { sx: ev.clientX, sy: ev.clientY, x: r.x, y: r.y, moved: false };
        try { w.setPointerCapture(ev.pointerId); } catch (e) { /* 已捕获 */ }
      });
      w.addEventListener('pointermove', function (ev) {
        if (!drag) return;
        var dx = ev.clientX - drag.sx, dy = ev.clientY - drag.sy;
        if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
        drag.moved = true;
        w.classList.add('drag');
        pos = { x: drag.x + dx, y: drag.y + dy };
        place();
      });
      function endDrag(ev) {
        if (!drag) return;
        var moved = drag.moved;
        drag = null;
        w.classList.remove('drag');
        try { w.releasePointerCapture(ev.pointerId); } catch (e) { /* 已释放 */ }
        if (moved) save(place());
        else if (w.classList.contains('min')) setMin(false); // 收起时单击＝展开
      }
      w.addEventListener('pointerup', endDrag);
      w.addEventListener('pointercancel', endDrag);
      w.addEventListener('keydown', function (ev) {
        var step = ev.shiftKey ? 24 : 8;
        var mv = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[ev.key];
        if (mv) {
          var r = place();
          pos = { x: r.x + mv[0], y: r.y + mv[1] };
          save(place());
          ev.preventDefault();
        } else if (ev.key === 'Enter' && ev.target === w) {
          refresh(true);
        }
      });
      window.addEventListener('resize', place);

      // ── 按钮 / 双击 / 右键 ──
      q('.rf').addEventListener('click', function (ev) { ev.stopPropagation(); refresh(true); });
      function setMin(on) {
        w.classList.toggle('min', on);
        store.set(MIN_KEY, on ? '1' : '0');
        q('.mn').textContent = on ? '+' : '–';
        w.title = on ? (msgEl.textContent || subEl.textContent) : '';
        // 收起时把金额挪进标题行，成一枚小胶囊
        if (on) hd.insertBefore(amtEl, q('.rf')); else hd.parentNode.insertBefore(amtEl, subEl);
        place();
      }
      q('.mn').addEventListener('click', function (ev) { ev.stopPropagation(); setMin(!w.classList.contains('min')); });
      w.addEventListener('dblclick', function (ev) {
        if (ev.target && ev.target.closest && ev.target.closest('button')) return;
        refresh(true);
      });
      w.addEventListener('contextmenu', function (ev) {
        ev.preventDefault();
        store.set(HIDDEN_KEY, '1');
        host.remove();
        try { console.info('[dsh-up-t] 余额窗已隐藏。要恢复：localStorage.removeItem("' + HIDDEN_KEY + '") 后刷新'); } catch (e) { /* 忽略 */ }
      });

      if (store.get(MIN_KEY) === '1') setMin(true);
      place();
      refresh(false);
      var timer = setInterval(function () { refresh(false); }, POLL_MS);
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible') refresh(false);
      });
      window.addEventListener('beforeunload', function () { clearInterval(timer); });

      window.__DSH_UP_T_BALANCE__ = {
        el: w,
        host: host,
        refresh: refresh,
        render: render,
        setMin: setMin,
        last: function () { return last; },
      };
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
    else mount();
  } catch (e) {
    try { console.warn('[dsh-up-t] balance panel failed:', e); } catch (_) { /* 忽略 */ }
  }
}());
