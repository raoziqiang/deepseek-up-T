/**
 * dsh-up-t · 客户端半侧（web platform）
 *
 * 形态照抄真实上线的客户端插件（`dsh-better-sidebar/lib/client.js`）：
 *   window.__ModuleLoader__.load({ id, factory: (require) => { ... return module.exports } })
 * factory 里导出的是**一个 Cordis 客户端插件**：`exports.apply` + `exports.inject`。
 * `require("react")` 可用，因为 React 在外壳冻结的平台模块表（PLATFORM_MODULES）里。
 *
 * 这一侧做的是「用 Slot 系统挂一个自有面板」：
 *   ctx.slots.inject("settings.section", () => ctx.slots.register({...}, Component))
 * `settings.section` 是 list 槽位、replaceRisk: none —— 一个条目就是设置里的一整页，
 * 不会遮蔽任何自带界面。注册签名（实测自 better-sidebar L23284）：
 *   { name: <槽位键>, id: <条目 id>, order, label: () => string, inject: () => <business share> }
 *
 * 数据来自本插件的宿主半侧只读接口：GET /dsh-up-t/status.json
 * 宿主半侧刻意只做 stat 级读取（不算 121MB 的 sha256），所以这里也如实标注「依据：大小」。
 *
 * 这是经典脚本，不是 ESM：CSP 不允许 ESM，且 ModuleLoader 的 factory 是 CJS 形态。
 */
(function () {
  "use strict";

  var loader = window.__ModuleLoader__;
  if (!loader || typeof loader.load !== "function") {
    // 没有模块加载器（例如在普通浏览器里被直接打开）时静默退出，绝不抛错影响外壳启动。
    return;
  }

  loader.load({
    id: "dsh-up-t",
    factory: function (require) {
      var module = { exports: {} };
      var exports = module.exports;
      Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

      var React = require("react");
      var h = React.createElement;

      var STATUS_PATH = "/dsh-up-t/status.json";

      function fmtBytes(n) {
        if (typeof n !== "number" || !isFinite(n)) return "未知";
        if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + " MB";
        if (n >= 1024) return (n / 1024).toFixed(1) + " KB";
        return n + " B";
      }

      function verdictText(data) {
        var install = data && data.install;
        if (!install) return "读不到安装目录信息";
        if (install.sameSizeAsBackup === true) {
          return "未改造（app.asar 与原版备份大小相同）";
        }
        if (install.sameSizeAsBackup === false) {
          return "已被改造（app.asar 与原版备份大小不同）";
        }
        return "无法判断（缺少原版备份）";
      }

      function row(label, value) {
        return h(
          "div",
          { key: label, style: { display: "flex", gap: "8px", padding: "2px 0" } },
          h("span", { style: { minWidth: "9em", opacity: 0.65 } }, label),
          h("span", { style: { fontFamily: "ui-monospace, monospace" } }, String(value)),
        );
      }

      function UpTSection() {
        var state = React.useState({ phase: "loading" });
        var snapshot = state[0];
        var setSnapshot = state[1];

        React.useEffect(function () {
          var alive = true;
          function load() {
            fetch(STATUS_PATH, { cache: "no-store" })
              .then(function (r) {
                if (!r.ok) throw new Error("HTTP " + r.status);
                return r.json();
              })
              .then(function (data) {
                if (alive) setSnapshot({ phase: "ready", data: data });
              })
              .catch(function (error) {
                if (alive) setSnapshot({ phase: "error", error: String(error) });
              });
          }
          load();
          var timer = setInterval(load, 30000);
          return function () {
            alive = false;
            clearInterval(timer);
          };
        }, []);

        var children = [
          h(
            "p",
            { key: "intro", style: { margin: "0 0 12px", opacity: 0.75 } },
            "这个页面由 L1 层插件 dsh-up-t 挂在 settings.section 槽位上提供。它随 profile 目录走，Harness 升级不会覆盖它。",
          ),
        ];

        if (snapshot.phase === "loading") {
          children.push(h("p", { key: "loading", style: { opacity: 0.6 } }, "正在读取…"));
        } else if (snapshot.phase === "error") {
          children.push(
            h(
              "p",
              { key: "error", style: { color: "#c0392b" } },
              "读取失败：" + snapshot.error,
            ),
          );
        } else {
          var data = snapshot.data;
          var install = data.install || {};
          children.push(
            h(
              "div",
              { key: "facts", style: { margin: "0 0 12px" } },
              row("插件", (data.plugin && data.plugin.name) + " " + (data.plugin && data.plugin.version)),
              row("Harness 版本", install.version),
              row("安装目录", install.dir),
              row("app.asar", fmtBytes(install.asarBytes)),
              row("原版备份", fmtBytes(install.backupBytes)),
              row("判定", verdictText(data)),
              row("读取时间", data.time),
            ),
          );
        }

        children.push(
          h(
            "p",
            { key: "note", style: { margin: "12px 0 0", fontSize: "0.9em", opacity: 0.6 } },
            "依据：只比了文件大小（宿主半侧刻意不在这里算 121MB 的 sha256）。要看逐字节结论、以及哪些补丁需要重打，请在项目里跑 dsht upgrade。",
          ),
        );

        return h("div", { style: { padding: "4px 0" } }, children);
      }

      var inject = ["slots"];

      function apply(ctx) {
        ctx.effect(function () {
          return ctx.slots.inject("settings.section", function () {
            return ctx.slots.register(
              {
                name: "settings.section",
                id: "dsh-up-t",
                order: 90,
                label: function () {
                  return "deepseek-up-T";
                },
                inject: function () {
                  return {};
                },
              },
              UpTSection,
            );
          });
        }, "dsh-up-t: settings.section");
      }

      exports.apply = apply;
      exports.inject = inject;
      return module.exports;
    },
  });
})();
