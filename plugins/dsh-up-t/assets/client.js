// deepseek-up-T :: 开机动画、背景、余额提示
//
// 由 /dsh-up-t/client.js 按 mtime 提供。经典脚本，无构建、无 ESM。
// 整段包在 try 里：这里坏了也不能拖垮主界面。
//
// 偏好与设置页共用 localStorage 键 dsh-up-t:prefs。
// 设置页改完会派发 dsh-up-t:prefs；「再看一次」派发 dsh-up-t:replay。

(function () {
  'use strict';
  try {
    if (window.__DSH_UP_T_CLIENT__) return;
    window.__DSH_UP_T_CLIENT__ = true;

    var PREF_KEY = 'dsh-up-t:prefs';
    var BOOT_KEY = 'dsh-up-t:boot-played';
    var SEEN_URL = '/dsh-up-t/seen';
    var BOOT_MS = 2200;

    try {
      fetch(SEEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-dsh-up-t': '1' },
        body: JSON.stringify({ via: 'capsule' }),
      }).catch(function () {});
    } catch (e) { /* 握手失败不影响外观 */ }

    function readPrefs() {
      var empty = {
        boot: true,
        background: 'none',
        customBackground: '',
        balance: '',
        cost: '',
        showBalance: true,
      };
      try {
        var raw = localStorage.getItem(PREF_KEY);
        if (!raw) return empty;
        var p = JSON.parse(raw);
        if (!p || typeof p !== 'object') return empty;
        return {
          boot: p.boot !== false,
          background: p.background || 'none',
          customBackground: typeof p.customBackground === 'string' ? p.customBackground : '',
          balance: p.balance == null ? '' : String(p.balance),
          cost: p.cost == null ? '' : String(p.cost),
          showBalance: p.showBalance !== false,
        };
      } catch (e) {
        return empty;
      }
    }

    function trimNum(n) {
      return String(Math.round(Number(n) * 1000) / 1000);
    }

    function balanceChip(prefs) {
      if (!prefs.showBalance) return '';
      var bEmpty = prefs.balance === '' || prefs.balance == null;
      var b = bEmpty ? NaN : Number(prefs.balance);
      if (bEmpty || !isFinite(b)) return '';
      var text = '余额 ' + trimNum(b);
      var cEmpty = prefs.cost === '' || prefs.cost == null;
      var c = cEmpty ? NaN : Number(prefs.cost);
      if (cEmpty || !isFinite(c)) return text + ' · 填上每次消耗可算次数';
      if (c <= 0) return text + ' · 每次消耗要大于 0';
      var turns = b <= 0 ? 0 : Math.floor(b / c);
      return text + ' · 约 ' + turns + ' 次';
    }

    function safeImageUrl(url) {
      if (typeof url !== 'string') return '';
      if (!/^data:image\/(gif|webp|png|apng|jpeg|jpg);/i.test(url)) return '';
      if (/["\\\n\r<>]/.test(url)) return '';
      return url;
    }

    function backgroundCss(prefs) {
      var custom = safeImageUrl(prefs.customBackground);
      if (custom) {
        return 'html{background:#0e1116 url("' + custom + '") center/cover no-repeat fixed !important;}';
      }
      if (prefs.background === 'night') {
        return 'html{background:radial-gradient(1200px 700px at 18% 0%,#1d3d66 0%,#0c1220 52%,#07090f 100%) fixed !important;}';
      }
      if (prefs.background === 'dawn') {
        return 'html{background:linear-gradient(165deg,#f3eee6 0%,#d5e3ee 46%,#c7d5c3 100%) fixed !important;}';
      }
      if (prefs.background === 'flow') {
        return '@keyframes dsh-up-t-flow{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}'
          + 'html{background-image:linear-gradient(120deg,#10182c,#1d4e62,#16345a,#10182c) !important;'
          + 'background-size:240% 240% !important;background-attachment:fixed !important;'
          + 'animation:dsh-up-t-flow 18s ease infinite !important;}';
      }
      return '';
    }

    var bgNode = null;
    var chip = null;
    var bootGen = 0;

    function parentFor(nodeDoc) {
      return nodeDoc.body || nodeDoc.documentElement || nodeDoc.head || null;
    }

    function ensureStyle() {
      if (bgNode && bgNode.parentNode) return bgNode;
      bgNode = document.createElement('style');
      bgNode.id = 'dsh-up-t-bg';
      var parent = document.head || document.documentElement;
      if (parent) parent.appendChild(bgNode);
      return bgNode;
    }

    function applyBackground() {
      var node = ensureStyle();
      if (node) node.textContent = backgroundCss(readPrefs());
    }

    function updateBalance() {
      var text = balanceChip(readPrefs());
      if (!text) {
        if (chip && chip.parentNode) chip.parentNode.removeChild(chip);
        chip = null;
        return;
      }
      if (!chip || !chip.parentNode) {
        chip = document.createElement('div');
        chip.id = 'dsh-up-t-balance';
        chip.style.position = 'fixed';
        chip.style.left = '16px';
        chip.style.bottom = '16px';
        chip.style.zIndex = '2147483000';
        chip.style.padding = '6px 10px';
        chip.style.borderRadius = '999px';
        chip.style.background = 'rgba(12,16,24,0.78)';
        chip.style.color = '#f2f5f8';
        chip.style.font = '13px/1.4 system-ui,sans-serif';
        chip.style.pointerEvents = 'none';
        var parent = parentFor(document);
        if (!parent) return;
        parent.appendChild(chip);
      }
      chip.textContent = text;
    }

    function reducedMotion() {
      try {
        return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
      } catch (e) {
        return false;
      }
    }

    function removeBoot() {
      var nodes = document.querySelectorAll ? document.querySelectorAll('#dsh-up-t-boot') : [];
      if (nodes && nodes.length) {
        for (var i = 0; i < nodes.length; i += 1) {
          if (nodes[i].parentNode) nodes[i].parentNode.removeChild(nodes[i]);
        }
        return;
      }
      var root = document.getElementById ? document.getElementById('dsh-up-t-boot') : null;
      if (root && root.parentNode) root.parentNode.removeChild(root);
    }

    function playBoot(force) {
      var prefs = readPrefs();
      if (!force && !prefs.boot) return;
      if (!force && reducedMotion()) return;
      try {
        if (!force && sessionStorage.getItem(BOOT_KEY) === '1') return;
        sessionStorage.setItem(BOOT_KEY, '1');
      } catch (e) { /* 存不了就每次都播，不影响主界面 */ }
      var gen = ++bootGen;
      removeBoot();
      var parent = parentFor(document);
      if (!parent) return;
      if (!document.getElementById || !document.getElementById('dsh-up-t-boot-style')) {
        var style = document.createElement('style');
        style.id = 'dsh-up-t-boot-style';
        style.textContent = '@keyframes dsh-up-t-boot{0%{opacity:0}12%{opacity:1}78%{opacity:1}100%{opacity:0}}'
          + '@keyframes dsh-up-t-line{from{transform:scaleX(0)}to{transform:scaleX(1)}}';
        var head = document.head || document.documentElement;
        if (head) head.appendChild(style);
      }
      var overlay = document.createElement('div');
      overlay.id = 'dsh-up-t-boot';
      overlay.style.position = 'fixed';
      overlay.style.left = '0';
      overlay.style.top = '0';
      overlay.style.right = '0';
      overlay.style.bottom = '0';
      overlay.style.zIndex = '2147483000';
      overlay.style.display = 'flex';
      overlay.style.alignItems = 'center';
      overlay.style.justifyContent = 'center';
      overlay.style.background = '#0b1020';
      overlay.style.animation = 'dsh-up-t-boot ' + (BOOT_MS / 1000) + 's ease forwards';
      var line = document.createElement('div');
      line.id = 'dsh-up-t-boot-line';
      line.style.position = 'absolute';
      line.style.left = '18%';
      line.style.right = '18%';
      line.style.top = '50%';
      line.style.height = '1px';
      line.style.background = 'rgba(186,214,232,0.85)';
      line.style.transformOrigin = 'center';
      line.style.animation = 'dsh-up-t-line 0.9s ease forwards';
      var title = document.createElement('div');
      title.id = 'dsh-up-t-boot-title';
      title.textContent = 'DeepSeek';
      title.style.position = 'relative';
      title.style.color = '#e8eef7';
      title.style.font = '600 28px/1 system-ui,sans-serif';
      title.style.letterSpacing = '0.18em';
      overlay.appendChild(line);
      overlay.appendChild(title);
      parent.appendChild(overlay);
      setTimeout(function () {
        if (gen !== bootGen) return;
        removeBoot();
      }, BOOT_MS);
    }

    function applyAll() {
      applyBackground();
      updateBalance();
    }

    function mount() {
      applyAll();
      playBoot(false);
      window.addEventListener('dsh-up-t:prefs', applyAll);
      window.addEventListener('storage', function (ev) {
        if (!ev || !ev.key || ev.key === PREF_KEY) applyAll();
      });
      window.addEventListener('dsh-up-t:replay', function () {
        try { sessionStorage.removeItem(BOOT_KEY); } catch (e) { /* 忽略 */ }
        playBoot(true);
      });
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', mount);
    } else if (parentFor(document)) {
      mount();
    } else {
      setTimeout(mount, 0);
    }
  } catch (e) {
    try { console.warn('[dsh-up-t] client failed', e); } catch (ignore) { /* 控制台也没有 */ }
  }
})();
