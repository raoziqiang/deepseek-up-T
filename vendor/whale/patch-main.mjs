// Patch lib/main.js in the packed app.asar to add the desktop whale charm window.
//
// The charm is an optional, frameless, transparent, always-on-top window that
// survives independently of the Harness window. It is disabled by default and
// enabled from the app's settings (which writes the same preference document the
// patch reads).
//
// This script performs a small number of exact string replacements against the
// shipped main.js. Every anchor is asserted to exist exactly once, so a version
// bump that changes the file fails loudly instead of corrupting it.
//
// Usage: node vendor/whale/patch-main.mjs <inMainJs> <outMainJs>
import { readFile, writeFile } from 'node:fs/promises'

const [src, out] = process.argv.slice(2)
if (src === undefined || out === undefined) {
  console.error('usage: node patch-main.mjs <inMainJs> <outMainJs>')
  process.exit(2)
}

let text = await readFile(src, 'utf8')

/** Apply one replacement, asserting the anchor is present exactly once. */
function replaceOnce(label, anchor, replacement) {
  const first = text.indexOf(anchor)
  if (first === -1) throw new Error(`patch-main: anchor not found (${label})`)
  const second = text.indexOf(anchor, first + 1)
  if (second !== -1) throw new Error(`patch-main: anchor is not unique (${label})`)
  text = text.slice(0, first) + replacement + text.slice(first + anchor.length)
  console.log(`patch-main: applied ${label}`)
}

// ── 1. The charm window's channels and implementation ────────────────────────
// Inserted just before the welcome window's options factory, which is a stable
// landmark in the desktop shell's account section.
const CHARM_IMPL = `
//#region dsh-whale-charm (added by the whale-splash customization)
/**
 * The desktop whale charm: an optional frameless, transparent window that shows
 * the settled splash charm and floats above every other application.
 *
 * It is intentionally independent of the Harness window: closing or minimizing
 * Harness leaves the charm in place, and the charm can be hidden from its own
 * context menu or from the app's settings.
 */
const CHARM_IPC = {
	state: "dsh-desktop:charm-state",
	dragStart: "dsh-desktop:charm-drag-start",
	dragMove: "dsh-desktop:charm-drag-move",
	dragEnd: "dsh-desktop:charm-drag-end",
	action: "dsh-desktop:charm-action",
	changed: "dsh-desktop:charm-changed"
};
/** Charm size in CSS pixels; the window is exactly this large. */
const CHARM_SIZE = 128;
/** Persisted charm state: enabled, and its top-left position in screen space. */
const charmStateFile = () => join(app.getPath("userData"), "whale-charm.json");
const readCharmState = () => {
	try {
		const raw = readFileSync(charmStateFile(), "utf8");
		const value = JSON.parse(raw);
		return {
			enabled: value?.enabled === true,
			x: Number.isFinite(value?.x) ? value.x : void 0,
			y: Number.isFinite(value?.y) ? value.y : void 0
		};
	} catch {
		return { enabled: false, x: void 0, y: void 0 };
	}
};
let charmWindow;
let charmDragOrigin;
let charmPersistTimer;
const writeCharmState = (next) => {
	const current = readCharmState();
	const merged = { ...current, ...next };
	try {
		writeFileSync(charmStateFile(), JSON.stringify(merged), "utf8");
	} catch (error) {
		console.error("desktop charm: could not persist state", error);
	}
	return merged;
};
/** Clamp a charm position so the window stays fully on a visible display. */
const clampCharmPosition = (x, y) => {
	const area = screen.getDisplayNearestPoint({ x, y }).workArea;
	return {
		x: Math.round(Math.min(Math.max(x, area.x), area.x + area.width - CHARM_SIZE)),
		y: Math.round(Math.min(Math.max(y, area.y), area.y + area.height - CHARM_SIZE))
	};
};
const destroyCharm = () => {
	if (charmWindow !== void 0 && !charmWindow.isDestroyed()) charmWindow.destroy();
	charmWindow = void 0;
	charmDragOrigin = void 0;
	if (charmPersistTimer !== void 0) {
		clearTimeout(charmPersistTimer);
		charmPersistTimer = void 0;
	}
};
/** Create the charm window at its persisted position, and show it. */
const showCharm = async () => {
	if (charmWindow !== void 0 && !charmWindow.isDestroyed()) {
		charmWindow.showInactive();
		return charmWindow;
	}
	const saved = readCharmState();
	const primary = screen.getPrimaryDisplay().workArea;
	const fallback = {
		x: primary.x + primary.width - CHARM_SIZE - 24,
		y: primary.y + 24
	};
	const at = clampCharmPosition(
		saved.x ?? fallback.x,
		saved.y ?? fallback.y
	);
	const window = new BrowserWindow({
		width: CHARM_SIZE,
		height: CHARM_SIZE,
		x: at.x,
		y: at.y,
		frame: false,
		transparent: true,
		hasShadow: false,
		resizable: false,
		maximizable: false,
		minimizable: false,
		fullscreenable: false,
		skipTaskbar: true,
		alwaysOnTop: true,
		show: false,
		backgroundColor: "#00000000",
		webPreferences: {
			preload: fileURLToPath(new URL("./preload-charm.cjs", import.meta.url)),
			nodeIntegration: false,
			contextIsolation: true,
			sandbox: true,
			webSecurity: true
		}
	});
	charmWindow = window;
	// Float above full-screen apps too, without stealing focus.
	window.setAlwaysOnTop(true, "screen-saver");
	window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
	window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
	window.webContents.on("will-navigate", (event) => event.preventDefault());
	window.once("closed", () => {
		if (charmWindow === window) charmWindow = void 0;
	});
	window.once("ready-to-show", () => {
		if (!window.isDestroyed()) {
			window.showInactive();
			window.moveTop();
		}
	});
	try {
		await window.loadFile(join(app.getAppPath(), "renderer", "pendant.html"));
	} catch (error) {
		console.error("desktop charm: load failed", error);
		if (!window.isDestroyed()) window.destroy();
		charmWindow = void 0;
		return void 0;
	}
	return window;
};
/** Enable or disable the charm, persisting the choice. */
const setCharmEnabled = async (enabled) => {
	writeCharmState({ enabled });
	if (enabled) await showCharm();
	else destroyCharm();
	return enabled;
};
/** Install the charm's IPC handlers exactly once per process. */
let charmHandlersInstalled = false;
const installCharmHandlers = () => {
	if (charmHandlersInstalled) return;
	charmHandlersInstalled = true;
	const assertCharm = (event) => {
		if (charmWindow === void 0 || event.sender !== charmWindow.webContents) {
			throw new Error("desktop charm: rejected action from an unowned frame");
		}
	};
	ipcMain.handle(CHARM_IPC.dragStart, (event, point) => {
		assertCharm(event);
		charmDragOrigin = { x: charmWindow.getPosition()[0], y: charmWindow.getPosition()[1] };
		return true;
	});
	ipcMain.handle(CHARM_IPC.dragMove, (event, delta) => {
		assertCharm(event);
		if (charmDragOrigin === void 0) return false;
		charmDragOrigin = clampCharmPosition(charmDragOrigin.x + Math.round(delta.dx), charmDragOrigin.y + Math.round(delta.dy));
		charmWindow.setPosition(charmDragOrigin.x, charmDragOrigin.y);
		// Coalesce writes: dragging emits many moves.
		if (charmPersistTimer !== void 0) clearTimeout(charmPersistTimer);
		charmPersistTimer = setTimeout(() => {
			charmPersistTimer = void 0;
			if (charmDragOrigin !== void 0) writeCharmState(charmDragOrigin);
		}, 250);
		return true;
	});
	ipcMain.handle(CHARM_IPC.dragEnd, (event) => {
		assertCharm(event);
		if (charmDragOrigin !== void 0) writeCharmState(charmDragOrigin);
		charmDragOrigin = void 0;
		return true;
	});
	ipcMain.handle(CHARM_IPC.action, async (event, action) => {
		assertCharm(event);
		if (action === "close") {
			await setCharmEnabled(false);
			mainWindow?.webContents.send(CHARM_IPC.changed, false);
			return true;
		}
		if (action === "reset") {
			const area = screen.getPrimaryDisplay().workArea;
			const at = clampCharmPosition(area.x + area.width - CHARM_SIZE - 24, area.y + 24);
			charmWindow?.setPosition(at.x, at.y);
			writeCharmState(at);
			return true;
		}
		if (action === "toggle-splash") {
			// Ask the main window to replay the splash in its own renderer.
			mainWindow?.webContents.send(CHARM_IPC.changed, "replay");
			return true;
		}
		return false;
	});
};
//#endregion

`
replaceOnce(
  'charm implementation',
  "/**\n* Resolve the fixed-size welcome window's native material and controls.",
  CHARM_IMPL + "/**\n* Resolve the fixed-size welcome window's native material and controls.",
)

// ── 2. Import the small Node helpers the implementation needs ────────────────
// main.js already imports `app`, `ipcMain`, `BrowserWindow`, and `join`; it needs
// the synchronous file helpers plus `screen` (used only by the charm).
//
// 注意：**不能无条件插入 import**。Harness 升级后 main.js 自己也会 import
// `readFileSync`/`writeFileSync`（新版的 esbuild 产物里就有），再插一行同名绑定
// 会让整个主进程报 `SyntaxError: Identifier 'readFileSync' has already been declared`
// ——语法没错、锚点全中、补丁"成功"，但应用起不来。所以这里只补缺的那些名字。
const IMPORT_ANCHOR = 'import { fileURLToPath } from "node:url";'
const FS_NEEDED = ['readFileSync', 'writeFileSync']
const fsImported = new Set(
  [...text.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']node:fs["']/g)]
    .flatMap((m) => m[1].split(','))
    .map((clause) => clause.trim().split(/\s+as\s+/).pop().trim())
    .filter(Boolean),
)
const fsMissing = FS_NEEDED.filter((name) => !fsImported.has(name))
if (fsMissing.length > 0) {
  replaceOnce(
    'node:fs import',
    IMPORT_ANCHOR,
    `${IMPORT_ANCHOR}\nimport { ${fsMissing.join(', ')} } from "node:fs";`,
  )
} else {
  console.log(`patch-main: node:fs import already present (${FS_NEEDED.join(', ')})`)
}

const ELECTRON_ANCHOR = 'import { BrowserWindow, Menu, Notification, Tray, WebContentsView, app, clipboard, dialog, ipcMain, nativeImage, nativeTheme, net, powerMonitor, protocol, session, shell, systemPreferences } from "electron";'
const electronNames = new Set(
  ELECTRON_ANCHOR.replace(/^import\s*\{|\}\s*from\s*"electron";$/g, '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
)
if (electronNames.has('screen')) {
  console.log('patch-main: electron screen import already present')
} else {
  replaceOnce(
    'electron screen import',
    ELECTRON_ANCHOR,
    ELECTRON_ANCHOR.replace('protocol, session', 'protocol, screen, session'),
  )
}

// ── 3. Start the charm at launch when it was left enabled ────────────────────
replaceOnce(
  'startup hook',
  '\tconst openInitialWindow = async () => {\n\t\tif (quitting || recovery.active) return;',
  `\tconst openInitialWindow = async () => {
		if (quitting || recovery.active) return;
		// The whale charm restores itself before any window is shown.
		installCharmHandlers();
		if (readCharmState().enabled) showCharm().catch((error) => {
			console.error("desktop charm: could not restore", error);
		});`,
)

// ── 4. Tear the charm down with the rest of the desktop shell ────────────────
replaceOnce(
  'quit teardown',
  '\t\tif (welcomeWindow !== void 0 && !welcomeWindow.isDestroyed()) welcomeWindow.hide();\n\t\tif (mainWindow !== void 0 && !mainWindow.isDestroyed()) mainWindow.hide();',
  '\t\tif (welcomeWindow !== void 0 && !welcomeWindow.isDestroyed()) welcomeWindow.hide();\n\t\tif (mainWindow !== void 0 && !mainWindow.isDestroyed()) mainWindow.hide();\n\t\tdestroyCharm();',
)

// ── 5. Let the settings UI read and change the preference ────────────────────
// The Platform renderer (hostname "platform") hosts the settings surface.
replaceOnce(
  'settings IPC',
  '\t\tipcMain.handle(DESKTOP_IPC.windowsMenu, (event, name, x, y) => {\n\t\t\tassertDesktopSender(event, ["app"]);',
  `\t\tipcMain.handle(CHARM_IPC.state, async (event) => {
			assertDesktopSender(event, ["app", "platform"]);
			installCharmHandlers();
			return readCharmState().enabled;
		});
		ipcMain.handle(CHARM_IPC.action, async (event, action) => {
			assertDesktopSender(event, ["app", "platform"]);
			installCharmHandlers();
			if (action === "enable") {
				await setCharmEnabled(true);
				return true;
			}
			if (action === "disable") {
				await setCharmEnabled(false);
				return false;
			}
			throw new Error("desktop charm: unknown settings action");
		});
\t\tipcMain.handle(DESKTOP_IPC.windowsMenu, (event, name, x, y) => {
\t\t\tassertDesktopSender(event, ["app"]);`,
)

await writeFile(out, text, 'utf8')
console.log(`patch-main: wrote ${out} (${text.length} bytes)`)
