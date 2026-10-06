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
      var ACTIONS_PATH = "/dsh-up-t/action";
      var ACTION_HEADER = "x-dsh-up-t";

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

      // 「加载了」和「能用」是两件事，这个页面恰恰是「什么都没出现」时人会来看的地方，
      // 所以把心跳走到哪一步也显示出来：只走到 apply() 就说明 webServer 依赖没就绪。
      function heartbeatText(data) {
        var beat = data && data.heartbeat;
        if (!beat) return "还没有心跳（插件没被加载，或还没重启 Harness）";
        var stage = typeof beat.stage === "string" ? beat.stage : null;
        if (stage === "ready") {
          var n = beat.routes && beat.routes.length;
          return "服务已就绪" + (typeof n === "number" ? "（路由 " + n + " 条）" : "") + " · pid " + beat.pid;
        }
        if (stage === "apply") {
          return "只走到 apply() · webServer 依赖没就绪 —— 界面里不会出现胶囊与设置页 · pid " + beat.pid;
        }
        return "心跳没有 stage 字段（旧版本写的） · pid " + beat.pid;
      }

      function row(label, value) {
        return h(
          "div",
          { key: label, style: { display: "flex", gap: "8px", padding: "2px 0" } },
          h("span", { style: { minWidth: "9em", opacity: 0.65 } }, label),
          h("span", { style: { fontFamily: "ui-monospace, monospace" } }, String(value)),
        );
      }

      // ── 操作：把 dsht 最常跑的几条命令挂成按钮 ──────────────────────
      //
      // 清单**不在这里硬编码**，而是 GET ACTIONS_PATH 从宿主半侧取。
      // 理由：硬编码的清单不会因为宿主加了操作而变红，只会静静少一个按钮。
      // 代价是「宿主半侧还没重启」时这里必然取不到 —— 那正是要优雅降级的那种情况。

      var ACTION_BTN = {
        padding: "6px 12px",
        borderRadius: "6px",
        border: "1px solid currentColor",
        background: "transparent",
        color: "inherit",
        cursor: "pointer",
        fontSize: "0.95em",
      };

      function TextBlock(props) {
        return h(
          "pre",
          {
            style: {
              margin: "6px 0 0",
              padding: "8px",
              maxHeight: "260px",
              overflow: "auto",
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
              fontFamily: "ui-monospace, monospace",
              fontSize: "0.85em",
              background: "rgba(127,127,127,0.12)",
              borderRadius: "6px",
            },
          },
          props.text,
        );
      }

      function ActionsPanel() {
        var state = React.useState({ phase: "loading", specs: [], error: null });
        var s = state[0];
        var setS = state[1];

        var noteState = React.useState("");
        var note = noteState[0];
        var setNote = noteState[1];

        var runState = React.useState(null);
        var run = runState[0];
        var setRun = runState[1];

        React.useEffect(function () {
          var alive = true;
          fetch(ACTIONS_PATH, { cache: "no-store" })
            .then(function (r) {
              if (!r.ok) throw new Error("HTTP " + r.status);
              return r.json();
            })
            .then(function (data) {
              if (!alive) return;
              if (!data || data.ok !== true || !data.specs || !data.specs.length) {
                throw new Error("宿主半侧没有给出操作清单");
              }
              setS({ phase: "ready", specs: data.specs, error: null });
            })
            .catch(function (error) {
              if (alive) setS({ phase: "missing", specs: [], error: String(error) });
            });
          return function () {
            alive = false;
          };
        }, []);

        function fire(spec) {
          // 会改盘的操作先问一句。宿主半侧也标了 writes，这里用的是它给的那一份。
          if (spec.writes) {
            var ok = typeof window.confirm === "function"
              ? window.confirm("「" + spec.label + "」会改动磁盘，继续吗？")
              : true;
            if (!ok) return;
          }
          setRun({ phase: "running", name: spec.name, label: spec.label });
          fetch(ACTIONS_PATH, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-dsh-up-t": "1" },
            body: JSON.stringify({ action: spec.name, message: note }),
          })
            .then(function (r) {
              return r.text().then(function (text) {
                var body = null;
                try {
                  body = JSON.parse(text);
                } catch (e) {
                  body = null;
                }
                return { status: r.status, body: body };
              });
            })
            .then(function (out) {
              if (!out.body) {
                // 这种情况几乎只有一个原因：当前这个 Harness 进程的宿主半侧还没有这条路。
                setRun({
                  phase: "done",
                  name: spec.name,
                  label: spec.label,
                  result: {
                    ok: false,
                    status: out.status,
                    error:
                      "宿主半侧没有回应合法 JSON（HTTP " + out.status + "）。" +
                      "操作通道是宿主半侧新增的，需要重启 Harness 之后才会出现。",
                  },
                });
                return;
              }
              setRun({ phase: "done", name: spec.name, label: spec.label, result: out.body });
            })
            .catch(function (error) {
              setRun({
                phase: "done",
                name: spec.name,
                label: spec.label,
                result: { ok: false, error: String(error) },
              });
            });
        }

        var children = [
          h(
            "p",
            { key: "intro", style: { margin: "0 0 8px", opacity: 0.75 } },
            "下面这些按钮就是 dsht 的日常命令，不用再开终端。",
          ),
        ];

        if (s.phase === "loading") {
          children.push(h("p", { key: "loading", style: { opacity: 0.6 } }, "正在读取操作清单…"));
        } else if (s.phase === "missing") {
          children.push(
            h(
              "p",
              { key: "missing", style: { color: "#c0392b", margin: "0 0 8px" } },
              "暂时用不了：" + s.error,
            ),
            h(
              "p",
              { key: "missing-hint", style: { margin: 0, fontSize: "0.9em", opacity: 0.75 } },
              "操作通道由宿主半侧提供，而宿主半侧要重启 Harness 才会重新加载。" +
                "重启后回到本页（必要时硬刷新）即可。",
            ),
          );
        } else {
          children.push(
            h(
              "div",
              { key: "buttons", style: { display: "flex", flexWrap: "wrap", gap: "8px" } },
              s.specs.map(function (spec) {
                var busy = run && run.phase === "running" && run.name === spec.name;
                return h(
                  "button",
                  {
                    key: spec.name,
                    type: "button",
                    title: spec.hint || "",
                    disabled: !!(run && run.phase === "running"),
                    style: Object.assign({}, ACTION_BTN, busy ? { opacity: 0.6 } : {}),
                    onClick: function () {
                      fire(spec);
                    },
                  },
                  spec.label + (spec.writes ? " ⚠" : ""),
                );
              }),
            ),
            h(
              "div",
              { key: "note", style: { margin: "8px 0 0" } },
              h(
                "label",
                { style: { display: "flex", gap: "8px", alignItems: "center", fontSize: "0.9em" } },
                h("span", { style: { opacity: 0.65 } }, "快照备注"),
                h("input", {
                  value: note,
                  placeholder: "留一份快照时用（可留空）",
                  onChange: function (e) {
                    setNote(e && e.target ? e.target.value : "");
                  },
                  style: {
                    flex: "1",
                    padding: "4px 8px",
                    borderRadius: "6px",
                    border: "1px solid rgba(127,127,127,0.5)",
                    background: "transparent",
                    color: "inherit",
                    fontFamily: "inherit",
                  },
                }),
              ),
              h(
                "p",
                { style: { margin: "6px 0 0", fontSize: "0.85em", opacity: 0.6 } },
                "带 ⚠ 的会改动磁盘（点了会再问一次）。",
              ),
            ),
          );
        }

        if (run) {
          var r = run.result;
          children.push(
            h(
              "div",
              { key: "result", style: { marginTop: "12px" } },
              h(
                "div",
                { style: { fontFamily: "ui-monospace, monospace", fontSize: "0.9em" } },
                run.label +
                  (run.phase === "running"
                    ? " · 正在跑…"
                    : r
                      ? " · " + (r.ok ? "成功" : "失败") +
                        (typeof r.code === "number" ? "（退出码 " + r.code + "）" : "") +
                        (typeof r.ms === "number" ? " · " + r.ms + " ms" : "")
                      : ""),
              ),
              r && r.error
                ? h("p", { style: { color: "#c0392b", margin: "6px 0 0" } }, r.error)
                : null,
              r && r.stdout ? h(TextBlock, { key: "out", text: r.stdout }) : null,
              r && r.stderr ? h(TextBlock, { key: "err", text: "stderr:\n" + r.stderr }) : null,
              r && !r.stdout && !r.stderr && !r.error
                ? h("p", { style: { opacity: 0.6, margin: "6px 0 0" } }, "（没有输出）")
                : null,
            ),
          );
        }

        return h("div", { style: { padding: "4px 0" } }, children);
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
              row("心跳", heartbeatText(data)),
              row("读取时间", data.time),
            ),
          );
        }

        children.push(
          h(
            "h3",
            { key: "ops-title", style: { margin: "18px 0 6px", fontSize: "1em" } },
            "操作",
          ),
        );
        children.push(h(ActionsPanel, { key: "actions" }));

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
