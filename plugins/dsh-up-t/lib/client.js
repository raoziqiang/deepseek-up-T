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
      var SEEN_PATH = "/dsh-up-t/seen";
      var ACTION_HEADER = "x-dsh-up-t";

      function fmtBytes(n) {
        if (typeof n !== "number" || !isFinite(n)) return "未知";
        if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + " MB";
        if (n >= 1024) return (n / 1024).toFixed(1) + " KB";
        return n + " B";
      }

      // 被否掉的候选路径也是事实：读不到安装目录时，它就是「为什么」。
      function rejectedText(list) {
        if (!list || !list.length) return null;
        return list.map(function (r) { return r.asar + "（" + r.why + "）"; }).join("；");
      }

      function verdictText(data) {
        var install = data && data.install;
        if (!install) {
          var why = rejectedText(data && data.installRejected);
          return why ? "读不到安装目录信息 —— 试过并否掉的路径：" + why : "读不到安装目录信息";
        }
        // 判据不足时先说「无法判断」，再说「为什么」：把拿不到的事实说成「不同」是冤枉。
        if (install.judgedBy !== "size" || install.sameSizeAsBackup === null) {
          return "无法判断（" + (install.judgedBy !== "size"
            ? "宿主这次没拿到可比的大小（app.asar 或原版备份读不到）"
            : "缺少原版备份") + "）";
        }
        if (install.sameSizeAsBackup === true) {
          return "未改造（app.asar 与原版备份大小相同）";
        }
        return "已被改造（app.asar 与原版备份大小不同）";
      }

      // 暂存产物（state/staged/app.asar）：项目的工作流是「改 → 构建到暂存包 → 落盘 → 重启」，
      // 而落盘必须等人先把 Harness 完全退出（安装目录被占用时谁也不敢写），人可以拖很久。
      // 于是「暂存包比在用安装包新」是常态，而这一页原来一个字都不说 —— 人打开看到全是正常，
      // 就会以为改动已经生效了。这一行的价值就在这：把「还没生效」变成一条看得见的事实。
      function stagedText(data) {
        var staged = data && data.staged;
        if (!staged || staged.status === "unavailable") {
          return "没拿到（" + ((staged && staged.why) || "宿主那一版还没有这个字段") + "）";
        }
        var d = staged.deltaBytes;
        var delta = (typeof d === "number" && d !== 0)
          ? "（" + (d > 0 ? "比在用安装包大 " : "比在用安装包小 ") + fmtBytes(Math.abs(d)) + "）"
          : "";
        if (staged.status === "pending") {
          return "待落盘 —— 暂存包比在用安装包新" + delta
            + "。落盘：先把 Harness 完全退出（托盘 → Quit），再跑 node vendor\\whale\\install.mjs --yes";
        }
        if (staged.status === "behind") return "暂存包比在用安装包旧" + delta + " —— 别拿它落盘，先重新构建";
        if (staged.status === "same-size") return "与在用安装包大小相同" + delta;
        return "与在用安装包大小不同，但没拿到可比的时间戳，判不出谁更新" + delta;
      }

      // 「加载了」和「能用」是两件事，这个页面恰恰是「什么都没出现」时人会来看的地方，
      // 所以把心跳走到哪一步也显示出来：只走到 apply() 就说明 webServer 依赖没就绪。
      function heartbeatText(data) {
        var beat = data && data.heartbeat;
        if (!beat) {
          // 有心跳字段是后来才加的功能。能拿到 status.json 就说明宿主半侧**被加载了**，
          // 此时说「插件没被加载」是错的 —— 正确的是「这一版宿主还没写心跳」。
          return data && data.ok
            ? "宿主半侧没有心跳字段（心跳是后来才加的功能）—— 重启 Harness 之后才会出现"
            : "还没有心跳（插件没被加载，或还没重启 Harness）";
        }
        // 握手是渲染层自己报的「我真的跑起来了」。宿主就绪而这一格空着，说明问题在
        // 投递（注入行/bundle 加载）而不是宿主 —— 这正是「界面里什么都没有」的两种近邻原因。
        var seen = (data && data.clientSeen) || beat.client || null;
        var via = seen && seen.sources ? Object.keys(seen.sources).sort().join("+") : null;
        var tail = via ? " · 渲染层已握手（" + via + "）" : " · 还没有渲染层握手";
        var stage = typeof beat.stage === "string" ? beat.stage : null;
        if (stage === "ready") {
          var n = beat.routes && beat.routes.length;
          return "服务已就绪" + (typeof n === "number" ? "（路由 " + n + " 条）" : "") + " · pid " + beat.pid + tail;
        }
        if (stage === "apply") {
          return "只走到 apply() · webServer 依赖没就绪 —— 界面里不会出现胶囊与设置页 · pid " + beat.pid + tail;
        }
        return "没有 stage 字段（旧版本写的） · pid " + beat.pid + tail;
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
              r && r.display ? h(TextBlock, { key: "summary", text: r.display }) : null,
              r && !r.display && r.stdout ? h(TextBlock, { key: "out", text: r.stdout }) : null,
              r && !r.display && r.stderr ? h(TextBlock, { key: "err", text: "stderr:\n" + r.stderr }) : null,
              r && r.display && (r.stdout || r.stderr)
                ? h("details", { key: "raw", style: { marginTop: "8px" } },
                    h("summary", null, "展开原始输出"),
                    r.stdout ? h(TextBlock, { text: r.stdout }) : null,
                    r.stderr ? h(TextBlock, { text: "stderr:\n" + r.stderr }) : null,
                  )
                : null,
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
          var facts = [
            row("插件", (data.plugin && data.plugin.name) + " " + (data.plugin && data.plugin.version)),
            row("Harness 版本", install.version),
            row("安装目录", install.dir),
            row("app.asar", fmtBytes(install.asarBytes)),
            row("原版备份", fmtBytes(install.backupBytes)),
            row("判定", verdictText(data)),
            row("暂存包", stagedText(data)),
            row("心跳", heartbeatText(data)),
            row("读取时间", data.time),
          ];
          var rejected = rejectedText(data.installRejected);
          if (rejected) facts.push(row("被否掉的路径", rejected));
          children.push(h("div", { key: "facts", style: { margin: "0 0 12px" } }, facts));
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
            "依据：只比了文件大小（宿主半侧刻意不在这里算 121MB 的 sha256）。要看逐字节结论、以及哪些补丁需要重打，请在项目里跑 dsht upgrade。"
              + "「暂存包」那一行比的是 state/staged/app.asar 与在用安装包：同样只比大小，方向（谁更新）由 mtime 判定；"
              + "大小相同不等于逐字节相同。",
          ),
        );

        return h("div", { style: { padding: "4px 0" } }, children);
      }

      // ── 桌面鲸鱼挂件的开关 ────────────────────────────────────────────
      //
      // 为什么这一行必须存在：出货的 Harness **已经**有整套挂件机制（主进程建一个 128px 的
      // 无框窗口、加载 renderer/pendant.html、lib/preload-charm.cjs 暴露 window.dshPendant、
      // 主应用侧 preload 暴露 window.dshWhaleCharm），但**没有任何地方调用那个桥** ——
      // 于是 userData/whale-charm.json 永远是 enabled:false，挂件窗口永远不出现，且不报错。
      // 我们把它接在 L1 插件里（而不是再改一次安装包）：能用 L0/L1 表达的绝不去动 L3。
      //
      // 槽位选 settings.general.item（list 槽位、replaceRisk: none）：它只有一个开关，
      // 和「外观」「字号」是同一类偏好，不该单占一整页。注册形状照抄同槽位真实注册者
      // （dsh-client-ui-theme/lib/client.js:1603）：name 必须写，store/locale/inject 可选。
      var CHARM_BRIDGE = "dshWhaleCharm";

      function bridgeOf() {
        try {
          return typeof window !== "undefined" && window ? window[CHARM_BRIDGE] : undefined;
        } catch (e) {
          return undefined;
        }
      }

      function localeId(ctx) {
        try {
          var service = ctx && typeof ctx.get === "function" ? ctx.get("locale") : null;
          if (service && typeof service.getLocale === "function") {
            var locale = service.getLocale();
            if (locale && typeof locale.id === "string") return locale.id;
          }
        } catch (e) { /* 取不到就当英文 */ }
        try {
          if (typeof document !== "undefined" && document.documentElement) {
            return document.documentElement.lang || "en";
          }
        } catch (e) { /* 同上 */ }
        return "en";
      }

      function charmCopy(id) {
        if (typeof id === "string" && id.indexOf("zh") === 0) {
          return {
            title: "桌面鲸鱼挂件",
            desc: "把启动动画里的小鲸鱼挂到桌面上，可以拖到任意位置；在它上面点右键有菜单。",
            on: "已开启",
            off: "已关闭",
            hint: "开启后立刻出现；关掉它就消失。",
            loading: "正在读取挂件状态…",
            unavailable: "这个窗口里没有挂件通道 —— 只有 Harness 桌面版（Windows）才有。",
            rejected: "挂件通道拒绝了这个请求",
            failed: "切换失败，请看控制台。",
          };
        }
        return {
          title: "Desktop whale charm",
          desc: "Float the little whale from the splash on your desktop and drag it anywhere. Right-click it for a menu.",
          on: "On",
          off: "Off",
          hint: "It appears as soon as you turn it on, and disappears when you turn it off.",
          loading: "Reading charm state…",
          unavailable: "No charm bridge in this window — Harness desktop (Windows) only.",
          rejected: "The charm bridge rejected this request",
          failed: "Could not toggle the charm. See the console.",
        };
      }

      var SWITCH_BASE = {
        padding: "4px 14px",
        borderRadius: "999px",
        border: "1px solid currentColor",
        background: "transparent",
        color: "inherit",
        cursor: "pointer",
        fontSize: "0.9em",
        minWidth: "5.5em",
      };

      /**
       * 纯展示组件：所有输入都从 props 来，不碰 hooks、不碰桥。
       * 导出 `exports.__charmView` 只为离线单测能用假 React 直接调用它
       * （ModuleLoader 只读 apply/inject，多出来的键没有副作用）。
       */
      function CharmRowView(props) {
        var copy = props.copy || charmCopy("en");
        var usable = props.available === true;
        var enabled = props.enabled === true;
        var disabled = !usable || props.busy === true;
        var status = null;
        if (!usable) status = props.why || copy.unavailable;
        else if (props.failed === true) status = copy.failed;

        return h(
          "div",
          {
            "data-dsh-up-t": "charm",
            style: {
              display: "flex",
              alignItems: "center",
              gap: "12px",
              justifyContent: "space-between",
              padding: "4px 0",
            },
          },
          h(
            "div",
            { style: { minWidth: 0 } },
            h("div", { style: { fontWeight: 600 } }, copy.title),
            h("div", { style: { fontSize: "0.88em", opacity: 0.7 } }, status || copy.desc),
            h(
              "div",
              { style: { fontSize: "0.82em", opacity: 0.5 } },
              usable ? copy.hint : "",
            ),
          ),
          h(
            "button",
            {
              type: "button",
              role: "switch",
              "aria-checked": enabled,
              "aria-label": copy.title,
              "data-on": enabled ? "true" : "false",
              "data-available": usable ? "true" : "false",
              disabled: disabled,
              style: Object.assign(
                {},
                SWITCH_BASE,
                enabled ? { background: "rgba(63,185,80,0.18)" } : {},
                disabled ? { opacity: 0.55, cursor: "default" } : {},
              ),
              onClick: function () {
                if (!disabled && typeof props.onToggle === "function") props.onToggle();
              },
            },
            enabled ? copy.on : copy.off,
          ),
        );
      }

      function makeCharmRow(ctx) {
        return function CharmRow() {
          var copy = charmCopy(localeId(ctx));
          var state = React.useState({ phase: "loading", enabled: false, why: null, failed: false, busy: false });
          var s = state[0];
          var setS = state[1];

          React.useEffect(function () {
            var bridge = bridgeOf();
            if (!bridge || typeof bridge.state !== "function" || typeof bridge.set !== "function") {
              setS({ phase: "unavailable", enabled: false, why: copy.unavailable, failed: false, busy: false });
              return undefined;
            }
            var alive = true;
            bridge.state().then(
              function (value) {
                if (alive) setS({ phase: "ready", enabled: value === true, why: null, failed: false, busy: false });
              },
              function (error) {
                // 桥在，但调用被拒 —— 非 Windows 平台根本没有这两个 handler。这也是「用不了」，
                // 但原因和「桥不在」不同，要如实分开说，别让人去查一个不存在的开关。
                if (alive) {
                  setS({
                    phase: "unavailable",
                    enabled: false,
                    why: copy.rejected + "（" + String(error && error.message ? error.message : error) + "）",
                    failed: false,
                    busy: false,
                  });
                }
              },
            );
            var off = null;
            if (typeof bridge.onChange === "function") {
              try {
                off = bridge.onChange(function (value) {
                  // 同一条通道还会送来挂件菜单的请求（字符串 "replay"）。只有布尔值是状态；
                  // 把 "replay" 当成状态会让开关在挂件其实开着的时候显示成关。
                  if (typeof value === "boolean") {
                    setS({ phase: "ready", enabled: value, why: null, failed: false, busy: false });
                  }
                });
              } catch (e) {
                off = null;
              }
            }
            return function () {
              alive = false;
              if (typeof off === "function") off();
            };
          }, []);

          function toggle() {
            var bridge = bridgeOf();
            if (!bridge || typeof bridge.set !== "function") return;
            var want = s.enabled !== true;
            setS({ phase: s.phase, enabled: want, why: s.why, failed: false, busy: true });
            bridge.set(want).then(
              function (value) {
                setS({
                  phase: "ready",
                  enabled: typeof value === "boolean" ? value : want,
                  why: null,
                  failed: false,
                  busy: false,
                });
              },
              function (error) {
                setS({
                  phase: "ready",
                  enabled: s.enabled === true,
                  why: null,
                  failed: true,
                  busy: false,
                });
                try {
                  console.warn("dsh-up-t: 切换桌面挂件失败", error);
                } catch (e) { /* 控制台不可用也不影响界面 */ }
              },
            );
          }

          if (s.phase === "loading") {
            return h("div", { style: { opacity: 0.6, padding: "4px 0" } }, copy.loading);
          }
          return h(CharmRowView, {
            copy: copy,
            available: s.phase === "ready",
            enabled: s.enabled === true,
            busy: s.busy === true,
            failed: s.failed === true,
            why: s.why,
            onToggle: toggle,
          });
        };
      }

      var inject = ["slots", "locale"];

      // 握手：告诉宿主「渲染层的这个 bundle 真的跑到了这里」。
      // 这一步只能由渲染层自己说 —— 宿主知道自己注册了路由（心跳的 ready），
      // 但不知道浏览器有没有真的把这个 bundle 加载起来（注入行可能没被收集、bundle 可能加载失败）。
      // 失败绝不影响界面：这是一条纯粹的证据，不是一个功能。
      function shakeHands(via) {
        try {
          fetch(SEEN_PATH, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-dsh-up-t": "1" },
            body: JSON.stringify({ via: via }),
          }).catch(function () {});
        } catch (e) { /* 握手失败不该影响界面 */ }
      }

      function apply(ctx) {
        shakeHands("bundle");
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

        // 桌面鲸鱼挂件的开关。它随 L1 插件一起走，所以不用落盘、不用重打安装包，
        // 硬刷新就能出现 —— 这正是「能在 L1 做的绝不动 L3」带来的好处。
        ctx.effect(function () {
          return ctx.slots.inject("settings.general.item", function () {
            return ctx.slots.register(
              {
                name: "settings.general.item",
                id: "whale-charm",
                order: 60,
              },
              makeCharmRow(ctx),
            );
          });
        }, "dsh-up-t: settings.general.item");
      }

      exports.apply = apply;
      exports.inject = inject;
      // 只为离线单测导出：ModuleLoader 只读 apply/inject，多出来的键没有副作用。
      exports.__charmView = CharmRowView;
      exports.__charmCopy = charmCopy;
      return module.exports;
    },
  });
})();
