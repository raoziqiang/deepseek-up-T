/**
 * The desktop charm window's preload bridge.
 *
 * Exposes only the four operations the charm needs: read its own drag/position
 * state and ask the main process to move the native window or run a menu action.
 * Nothing here can reach the Harness data model.
 */
const { contextBridge, ipcRenderer } = require('electron')

const CHARM_IPC = {
  state: 'dsh-desktop:charm-state',
  dragStart: 'dsh-desktop:charm-drag-start',
  dragMove: 'dsh-desktop:charm-drag-move',
  dragEnd: 'dsh-desktop:charm-drag-end',
  action: 'dsh-desktop:charm-action',
}

contextBridge.exposeInMainWorld('dshPendant', {
  /** Report that a drag began, so the main process can snapshot the origin. */
  dragStart: (point) => ipcRenderer.invoke(CHARM_IPC.dragStart, point),
  /** Move the native window by a screen-space delta. */
  dragMove: (delta) => ipcRenderer.invoke(CHARM_IPC.dragMove, delta),
  /** Finish the drag and persist the new position. */
  dragEnd: () => ipcRenderer.invoke(CHARM_IPC.dragEnd),
  /** Run a charm menu action: `toggle-splash`, `reset`, or `close`. */
  action: (name) => ipcRenderer.invoke(CHARM_IPC.action, name),
})
