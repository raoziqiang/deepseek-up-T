// deepseek-up-T :: dsh-up-t 的客户端半身
//
// 由宿主的 `/dsh-up-t/client.js` 路由提供，按 mtime 重读 —— 改这个文件后硬刷新页面即生效。
// 没有构建步骤、没有依赖、没有 ESM（CSP 不允许），所以这里是一段经典脚本，
// 而且整段包在 IIFE 里，避免往全局泄漏任何名字（只留一个 __DSH_UP_T_LOADED__ 幂等标记）。
//
// 设计约束：这个挂件绝不能影响主体功能。
//   · 找不到挂载点就静默退出；
//   · 任何异常都吞掉，绝不冒泡成未捕获错误；
//   · 只占左下角一个小胶囊，可拖动、可关闭，位置与关闭状态存 localStorage。

(function () {
  'use strict';
  try {
    if (window.__DSH_UP_T_CLIENT__) return;
    window.__DSH_UP_T_CLIENT__ = true;

    var STATUS_URL = '/dsh-up-t/status.json';
    var POS_KEY = 'dsh-up-t:pos';
    var HIDDEN_KEY = 'dsh-up-t:hidden';
    var Z = 2147483000;

    var hideTimer = null;

    function el(tag, style, text) {
      var n = document.createElement(tag);
      if (style) for (var k in style) n.style[k] = style[k];
      if (text != null) n.textContent = text;
      return n;
    }

    function human(bytes) {
      if (typeof bytes !== 'number' || !isFinite(bytes)) return '—';
      var u = ['B', 'KB', 'MB', 'GB'];
      var i = 0;
      var v = bytes;
      while (v >= 1024 && i < u.length - 1) { v /= 1024; i += 1; }
      return (i === 0 ? v : v.toFixed(1)) + ' ' + u[i];
    }

    function readPos() {
      try {
        var raw = localStorage.getItem(POS_KEY);
        if (!raw) return null;
        var p = JSON.parse(raw);
        if (typeof p.x === 'number' && typeof p.y === 'number') return p;
      } catch (e) { /* 忽略坏数据 */ }
      return null;
    }

    function mount() {
      var host = document.body || document.documentElement;
      if (!host) { setTimeout(mount, 200); return; }

      var root = el('div', {
        position: 'fixed',
        zIndex: String(Z),
        left: '12px',
        bottom: '12px',
        font: '12px/1.4 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
        color: '#e6edf3',
        userSelect: 'none',
        pointerEvents: 'auto',
      });

      var chip = el('div', {
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '3px 9px',
        borderRadius: '999px',
        background: 'rgba(20,24,31,.86)',
        border: '1px solid rgba(255,255,255,.14)',
        boxShadow: '0 2px 10px rgba(0,0,0,.35)',
        cursor: 'grab',
        whiteSpace: 'nowrap',
        backdropFilter: 'blur(6px)',
      });

      var dot = el('span', {
        width: '7px',
        height: '7px',
        borderRadius: '50%',
        background: '#8b949e',
        flex: '0 0 auto',
      });
      var label = el('span', null, 'up-T');
      chip.appendChild(dot);
      chip.appendChild(label);

      var panel = el('div', {
        position: 'absolute',
        left: '0',
        bottom: '26px',
        minWidth: '290px',
        maxWidth: 'min(460px, 80vw)',
        padding: '10px 12px',
        borderRadius: '10px',
        background: 'rgba(20,24,31,.97)',
        border: '1px solid rgba(255,255,255,.16)',
        boxShadow: '0 8px 28px rgba(0,0,0,.5)',
        display: 'none',
        whiteSpace: 'normal',
        wordBreak: 'break-all',
      });

      root.appendChild(panel);
      root.appendChild(chip);
      host.appendChild(root);

      var pos = readPos();
      if (pos) {
        root.style.left = pos.x + 'px';
        root.style.top = pos.y + 'px';
        root.style.bottom = 'auto';
      }
      if (localStorage.getItem(HIDDEN_KEY) === '1') root.style.display = 'none';

      var row = function (k, v, color) {
        var line = el('div', { display: 'flex', gap: '8px', margin: '2px 0' });
        line.appendChild(el('span', { color: '#8b949e', flex: '0 0 84px' }, k));
        line.appendChild(el('span', { color: color || '#e6edf3' }, v));
        return line;
      };

      function render(status) {
        panel.textContent = '';
        panel.appendChild(el('div', {
          fontWeight: '600',
          marginBottom: '6px',
          color: '#e6edf3',
        }, 'deepseek-up-T · 改造状态'));

        if (!status || status.ok !== true) {
          panel.appendChild(row('状态', '宿主没有回应状态查询', '#f0883e'));
          return;
        }

        panel.appendChild(row('插件', (status.plugin && status.plugin.name) + ' ' + (status.plugin && status.plugin.version)));
        var inst = status.install;
        if (!inst) {
          panel.appendChild(row('安装包', '没找到 Harness 安装目录', '#f0883e'));
          return;
        }
        panel.appendChild(row('Harness', String(inst.version || '未知')));
        panel.appendChild(row('app.asar', human(inst.asarBytes)));
        panel.appendChild(row('原版备份', human(inst.backupBytes)));

        var verdict;
        var color;
        if (inst.sameSizeAsBackup === true) {
          verdict = '大小相同 —— 很可能还是原版（未被改造）';
          color = '#8b949e';
        } else if (inst.sameSizeAsBackup === false) {
          verdict = '大小不同 —— 安装包已被改造';
          color = '#3fb950';
        } else {
          verdict = '没有原版备份可比（无法判断）';
          color = '#d29922';
        }
        panel.appendChild(row('判定', verdict, color));

        panel.appendChild(el('div', {
          marginTop: '7px',
          paddingTop: '7px',
          borderTop: '1px solid rgba(255,255,255,.12)',
          color: '#8b949e',
          fontSize: '11px',
        }, '依据：' + (inst.judgedBy === 'size' ? '只比了文件大小（不算 121MB 的 sha256）'
          : String(inst.judgedBy)) + '。要看逐字节结论请跑 `dsht upgrade`。'));

        panel.appendChild(el('div', {
          marginTop: '5px',
          color: '#8b949e',
          fontSize: '11px',
        }, String(inst.dir)));
      }

      function refresh() {
        try {
          fetch(STATUS_URL, { cache: 'no-store' })
            .then(function (r) { return r.json(); })
            .then(function (j) {
              render(j);
              var inst = j && j.install;
              if (!inst) { dot.style.background = '#d29922'; label.textContent = 'up-T'; return; }
              label.textContent = 'up-T · ' + (inst.version || '?');
              dot.style.background = inst.sameSizeAsBackup === false ? '#3fb950'
                : inst.sameSizeAsBackup === true ? '#8b949e' : '#d29922';
            })
            .catch(function () { render(null); });
        } catch (e) { /* fetch 不存在也不会影响主界面 */ }
      }

      // ── 拖动 + 点击（区分「拖」与「点」靠位移阈值） ──
      var dragging = false;
      var moved = false;
      var start = null;

      chip.addEventListener('pointerdown', function (ev) {
        dragging = true;
        moved = false;
        start = { mx: ev.clientX, my: ev.clientY, x: root.getBoundingClientRect().left, y: root.getBoundingClientRect().top };
        chip.style.cursor = 'grabbing';
        try { chip.setPointerCapture(ev.pointerId); } catch (e) { /* 老浏览器 */ }
      });

      chip.addEventListener('pointermove', function (ev) {
        if (!dragging || !start) return;
        var dx = ev.clientX - start.mx;
        var dy = ev.clientY - start.my;
        if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
        if (!moved) return;
        var x = Math.max(0, Math.min(window.innerWidth - 40, start.x + dx));
        var y = Math.max(0, Math.min(window.innerHeight - 24, start.y + dy));
        root.style.left = x + 'px';
        root.style.top = y + 'px';
        root.style.bottom = 'auto';
      });

      chip.addEventListener('pointerup', function (ev) {
        if (!dragging) return;
        dragging = false;
        chip.style.cursor = 'grab';
        try { chip.releasePointerCapture(ev.pointerId); } catch (e) { /* 同上 */ }
        if (moved) {
          try {
            localStorage.setItem(POS_KEY, JSON.stringify({
              x: parseFloat(root.style.left) || 0,
              y: parseFloat(root.style.top) || 0,
            }));
          } catch (e) { /* 存储被禁就算了 */ }
          return;
        }
        if (panel.style.display === 'none') {
          panel.style.display = 'block';
          panel.appendChild(el('div', {
            marginTop: '7px',
            color: '#8b949e',
            fontSize: '11px',
          }, '右键点这个胶囊可以隐藏它。'));
          refresh();
        } else {
          panel.style.display = 'none';
        }
      });

      // 右键：隐藏（持久化），并留一条给自己找回的提示
      chip.addEventListener('contextmenu', function (ev) {
        ev.preventDefault();
        root.style.display = 'none';
        try { localStorage.setItem(HIDDEN_KEY, '1'); } catch (e) { /* 忽略 */ }
        try {
          console.info('[dsh-up-t] 已隐藏。要恢复：在控制台执行 localStorage.removeItem("' + HIDDEN_KEY + '") 后刷新');
        } catch (e) { /* 忽略 */ }
      });

      refresh();
      hideTimer = setInterval(refresh, 60000);
      window.addEventListener('beforeunload', function () {
        if (hideTimer) clearInterval(hideTimer);
      });
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', mount);
    } else {
      mount();
    }
  } catch (e) {
    // 挂件坏了也不能影响主界面。
    try { console.warn('[dsh-up-t] client failed:', e); } catch (_) { /* 忽略 */ }
  }
}());
