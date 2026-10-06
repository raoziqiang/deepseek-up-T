// Patch lib/preload-app.cjs in the packed app.asar to expose the whale charm
// preference bridge to the Harness web app.
//
// The settings row (a client plugin) needs a way to read and toggle the desktop
// charm. This publishes `window.dshWhaleCharm` on the main product frame only,
// mirroring how the other desktop bridges are scoped.
//
// Usage: node vendor/whale/patch-preload.mjs <inPreload> <outPreload>
import { readFile, writeFile } from 'node:fs/promises'

const [src, out] = process.argv.slice(2)
if (src === undefined || out === undefined) {
  console.error('usage: node patch-preload.mjs <inPreload> <outPreload>')
  process.exit(2)
}

let text = await readFile(src, 'utf8')

function replaceOnce(label, anchor, replacement) {
  const first = text.indexOf(anchor)
  if (first === -1) throw new Error(`patch-preload: anchor not found (${label})`)
  if (text.indexOf(anchor, first + 1) !== -1) {
    throw new Error(`patch-preload: anchor is not unique (${label})`)
  }
  text = text.slice(0, first) + replacement + text.slice(first + anchor.length)
  console.log(`patch-preload: applied ${label}`)
}

// Add the charm channels to the private channel table, so they sit with the rest
// of the desktop shell's IPC names.
replaceOnce(
  'charm channels',
  '\twindowsMenu: "dsh-desktop:windows-menu"\n};',
  '\twindowsMenu: "dsh-desktop:windows-menu",\n\tcharmState: "dsh-desktop:charm-state",\n\tcharmAction: "dsh-desktop:charm-action",\n\tcharmChanged: "dsh-desktop:charm-changed"\n};',
)

// Publish the bridge on the main product frame, beside `dshDesktop`.
replaceOnce(
  'charm bridge',
  'electron.contextBridge.exposeInMainWorld("dshDesktop", location.protocol === `dsh-app:` && location.hostname === "app" && process.isMainFrame ? createProductApi() : { protocolVersion: 1 });',
  `electron.contextBridge.exposeInMainWorld("dshDesktop", location.protocol === \`dsh-app:\` && location.hostname === "app" && process.isMainFrame ? createProductApi() : { protocolVersion: 1 });
// The whale charm preference, read and written by the General settings row.
electron.contextBridge.exposeInMainWorld("dshWhaleCharm", {
	state: () => electron.ipcRenderer.invoke(DESKTOP_IPC.charmState),
	set: (enabled) => electron.ipcRenderer.invoke(DESKTOP_IPC.charmAction, enabled === true ? "enable" : "disable"),
	onChange: (listener) => {
		const receive = (_event, value) => {
			listener(value);
		};
		electron.ipcRenderer.on(DESKTOP_IPC.charmChanged, receive);
		return () => {
			electron.ipcRenderer.removeListener(DESKTOP_IPC.charmChanged, receive);
		};
	}
});`,
)

await writeFile(out, text, 'utf8')
console.log(`patch-preload: wrote ${out} (${text.length} bytes)`)
