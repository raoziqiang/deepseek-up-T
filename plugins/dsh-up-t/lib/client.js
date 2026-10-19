/**
 * dsh-up-t · 设置页
 *
 * 经典脚本，走 ModuleLoader。设置里只有一页：开机动画、背景、余额。
 * 偏好写在 localStorage（dsh-up-t:prefs），和 assets/client.js 共用。
 */
(function () {
  "use strict";

  var loader = window.__ModuleLoader__;
  if (!loader || typeof loader.load !== "function") return;

  loader.load({
    id: "dsh-up-t",
    factory: function (require) {
      var module = { exports: {} };
      var exports = module.exports;
      Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

      var React = require("react");
      var h = React.createElement;
      var PREF_KEY = "dsh-up-t:prefs";
      var SEEN_PATH = "/dsh-up-t/seen";
      var MAX_IMAGE = 1572864;
      var PRESETS = [
        { id: "none", label: "跟随界面" },
        { id: "night", label: "静夜" },
        { id: "dawn", label: "晨雾" },
        { id: "flow", label: "流光" },
      ];

      function loadPrefs() {
        try {
          var raw = localStorage.getItem(PREF_KEY);
          var p = raw ? JSON.parse(raw) : {};
          if (!p || typeof p !== "object") p = {};
          return p;
        } catch (e) {
          return {};
        }
      }

      function trimNum(n) {
        return String(Math.round(Number(n) * 1000) / 1000);
      }

      function balanceHint(balance, cost) {
        var bEmpty = balance === "" || balance == null;
        var cEmpty = cost === "" || cost == null;
        var b = bEmpty ? NaN : Number(balance);
        var c = cEmpty ? NaN : Number(cost);
        var bOk = !bEmpty && isFinite(b);
        var cOk = !cEmpty && isFinite(c) && c > 0;
        if (!bOk && !cEmpty && isFinite(c) && c <= 0) return "每次消耗要大于 0，才能算次数。";
        if (bOk && !cEmpty && isFinite(c) && c <= 0) return "每次消耗要大于 0，才能算次数。";
        if (!bOk && !cOk) return "填上当前余额和每次大约消耗，这里会算出大约还能用几次。";
        if (bOk && !cOk) return "余额已记下。再填每次大约消耗，就能算出还能用几次。";
        if (!bOk && cOk) return "还没填当前余额。";
        var turns = b <= 0 ? 0 : Math.floor(b / c);
        return "大约还能用 " + turns + " 次。";
      }

      function balanceChip(balance, cost, show) {
        if (!show) return "";
        var bEmpty = balance === "" || balance == null;
        var b = bEmpty ? NaN : Number(balance);
        if (bEmpty || !isFinite(b)) return "";
        var text = "余额 " + trimNum(b);
        var cEmpty = cost === "" || cost == null;
        var c = cEmpty ? NaN : Number(cost);
        if (cEmpty || !isFinite(c)) return text + " · 填上每次消耗可算次数";
        if (c <= 0) return text + " · 每次消耗要大于 0";
        var turns = b <= 0 ? 0 : Math.floor(b / c);
        return text + " · 约 " + turns + " 次";
      }

      function AppearanceSection() {
        var stored = loadPrefs();
        var bootState = React.useState(stored.boot !== false);
        var backgroundState = React.useState(stored.background || "none");
        var customState = React.useState(typeof stored.customBackground === "string" ? stored.customBackground : "");
        var errorState = React.useState("");
        var balanceState = React.useState(stored.balance == null ? "" : String(stored.balance));
        var costState = React.useState(stored.cost == null ? "" : String(stored.cost));
        var showState = React.useState(stored.showBalance !== false);
        var boot = bootState[0];
        var setBoot = bootState[1];
        var background = backgroundState[0];
        var setBackground = backgroundState[1];
        var custom = customState[0];
        var setCustom = customState[1];
        var error = errorState[0];
        var setError = errorState[1];
        var balance = balanceState[0];
        var setBalance = balanceState[1];
        var cost = costState[0];
        var setCost = costState[1];
        var showBalance = showState[0];
        var setShowBalance = showState[1];

        React.useEffect(function () {
          try {
            fetch(SEEN_PATH, {
              method: "POST",
              headers: { "Content-Type": "application/json", "x-dsh-up-t": "1" },
              body: JSON.stringify({ via: "bundle" }),
            }).catch(function () {});
          } catch (e) { /* 握手失败不影响这一页 */ }
        }, []);

        function snapshot(patch) {
          return {
            boot: boot,
            background: background,
            customBackground: custom,
            balance: balance,
            cost: cost,
            showBalance: showBalance,
            ...patch,
          };
        }

        function save(patch) {
          var next = snapshot(patch);
          try {
            localStorage.setItem(PREF_KEY, JSON.stringify(next));
            window.dispatchEvent(new Event("dsh-up-t:prefs"));
            setError("");
            return true;
          } catch (e) {
            setError("没能保存。图片太大时换一张小一点的，或检查浏览器有没有禁止本地存储。");
            return false;
          }
        }

        function onFile(ev) {
          var file = ev.target && ev.target.files && ev.target.files[0];
          if (!file) return;
          var typeOk = /image\/(gif|webp|png|apng|jpeg|jpg)/i.test(file.type || "")
            || /\.(gif|webp|png|apng|jpe?g)$/i.test(file.name || "");
          if (!typeOk) {
            setError("请选图片：GIF、WebP、APNG、PNG 或 JPG。");
            return;
          }
          if (file.size > MAX_IMAGE) {
            setError("这张图超过 1.5 MB，换一张小一点的。动图也一样。");
            return;
          }
          var reader = new FileReader();
          reader.onload = function () {
            var url = String(reader.result || "");
            if (!/^data:image\/(gif|webp|png|apng|jpeg|jpg);/i.test(url)) {
              setError("这张图读出来不是可用的图片。");
              return;
            }
            if (save({ customBackground: url })) setCustom(url);
          };
          reader.onerror = function () { setError("这张图没有读出来。"); };
          reader.readAsDataURL(file);
        }

        var chip = balanceChip(balance, cost, showBalance);
        var swatch = {
          none: "transparent",
          night: "radial-gradient(40px 28px at 30% 20%, #1d3d66, #0c1220)",
          dawn: "linear-gradient(165deg, #f3eee6, #c7d5c3)",
          flow: "linear-gradient(120deg, #10182c, #1d4e62, #16345a)",
        };

        return h("div", { style: { maxWidth: 560, fontSize: 14, lineHeight: 1.5 } },
          h("p", { style: { margin: "0 0 18px", opacity: 0.72 } },
            "开机时的短动画、主界面背景，以及余额还能用几次。"),
          h("section", { style: { marginBottom: 22 } },
            h("div", { style: { fontWeight: 600, marginBottom: 8 } }, "开机动画"),
            h("label", { style: { display: "flex", gap: 8, alignItems: "center", marginBottom: 8 } },
              h("input", {
                type: "checkbox",
                "data-action": "boot",
                checked: boot,
                onChange: function (ev) {
                  var next = !!(ev.target && ev.target.checked);
                  setBoot(next);
                  save({ boot: next });
                },
              }),
              "打开时播放"),
            h("button", {
              type: "button",
              "data-action": "replay",
              onClick: function () { window.dispatchEvent(new Event("dsh-up-t:replay")); },
              style: { padding: "4px 10px" },
            }, "再看一次"),
            h("p", { style: { margin: "8px 0 0", opacity: 0.65, fontSize: 12 } },
              "系统开了「减少动态效果」时，打开应用不会自动播放。")),
          h("section", { style: { marginBottom: 22 } },
            h("div", { style: { fontWeight: 600, marginBottom: 8 } }, "背景"),
            h("div", { style: { display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 } },
              PRESETS.map(function (preset) {
                var on = background === preset.id && !custom;
                return h("button", {
                  key: preset.id,
                  type: "button",
                  "data-action": "preset",
                  "data-preset": preset.id,
                  onClick: function () {
                    setBackground(preset.id);
                    setCustom("");
                    save({ background: preset.id, customBackground: "" });
                  },
                  style: {
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "4px 8px",
                    borderRadius: 8,
                    border: on ? "1px solid #7aa2c4" : "1px solid rgba(128,128,128,0.35)",
                    background: "transparent",
                    color: "inherit",
                  },
                },
                h("span", {
                  "aria-hidden": "true",
                  style: {
                    width: 18,
                    height: 18,
                    borderRadius: 4,
                    background: swatch[preset.id],
                    border: "1px solid rgba(128,128,128,0.4)",
                  },
                }),
                preset.label);
              })),
            h("p", { style: { margin: "0 0 8px", opacity: 0.65, fontSize: 12 } },
              "流光是默认的动态背景。自己的图片优先，GIF、WebP、APNG 会循环播放。"),
            h("label", { style: { display: "block", marginBottom: 8 } },
              "自己的图片",
              h("input", {
                type: "file",
                "data-action": "file",
                accept: "image/gif,image/webp,image/png,image/apng,image/jpeg,.gif,.webp,.png,.apng,.jpg,.jpeg",
                onChange: onFile,
                style: { display: "block", marginTop: 4 },
              })),
            custom ? h("button", {
              type: "button",
              "data-action": "clear-custom",
              onClick: function () {
                setCustom("");
                save({ customBackground: "" });
              },
              style: { padding: "4px 10px" },
            }, "去掉这张图片") : null,
            error ? h("p", { style: { margin: "8px 0 0", color: "#d29922" }, role: "alert" }, error) : null),
          h("section", null,
            h("div", { style: { fontWeight: 600, marginBottom: 8 } }, "余额"),
            h("label", { style: { display: "block", marginBottom: 8 } },
              "当前余额",
              h("input", {
                type: "number",
                "data-action": "balance",
                step: "any",
                value: balance,
                onChange: function (ev) {
                  var next = ev.target ? ev.target.value : "";
                  setBalance(next);
                  save({ balance: next });
                },
                style: { display: "block", marginTop: 4, width: 160 },
              })),
            h("label", { style: { display: "block", marginBottom: 8 } },
              "每次大约消耗",
              h("input", {
                type: "number",
                "data-action": "cost",
                step: "any",
                value: cost,
                onChange: function (ev) {
                  var next = ev.target ? ev.target.value : "";
                  setCost(next);
                  save({ cost: next });
                },
                style: { display: "block", marginTop: 4, width: 160 },
              })),
            h("label", { style: { display: "flex", gap: 8, alignItems: "center" } },
              h("input", {
                type: "checkbox",
                "data-action": "show-balance",
                checked: showBalance,
                onChange: function (ev) {
                  var next = !!(ev.target && ev.target.checked);
                  setShowBalance(next);
                  save({ showBalance: next });
                },
              }),
              "在界面角落显示"),
            h("p", { style: { margin: "8px 0 0" } }, balanceHint(balance, cost)),
            chip ? h("p", { style: { margin: "4px 0 0", opacity: 0.72 }, "data-chip": "1" }, chip) : null));
      }

      function apply(ctx) {
        ctx.effect(function () {
          return ctx.slots.inject("settings.section", function () {
            return ctx.slots.register({
              name: "settings.section",
              id: "dsh-up-t",
              order: 90,
              label: function () { return "外观"; },
              inject: function () { return {}; },
            }, AppearanceSection);
          });
        }, "dsh-up-t: settings.section");
      }

      exports.apply = apply;
      exports.inject = ["slots"];
      return module.exports;
    },
  });
})();
