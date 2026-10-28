// The Dynamic Island: a small, always-on-top window parked at the top centre of
// the display that shows what Hermes is doing and takes an approval answer
// without the user leaving the app they are working in.
//
// It is deliberately NOT the HUD. The HUD is one conversation's surface and it
// hides the app window when it opens; the island is a global status strip that
// coexists with every other window and answers the approval the OS notification
// would otherwise send the user into Hermes for. It is also a FULL renderer with
// its own gateway (like the HUD) because it needs the app's session and prompt
// stores — the pet overlay's gateway-less model cannot see an approval.
//
// The window is laid out ONCE, as the largest the island can ever be, and the
// black surface animates inside it (see island-geometry.ts). That is what makes
// it feel native: a web island that resizes its OS window per frame stutters,
// because every `setBounds` is a synchronous compositor round trip. Everything
// the surface does not paint is click-through, so the transparent remainder of
// the rectangle costs nothing.
//
// Three window facts make "answer without switching apps" real:
//   - `focusable: false` + `type: 'panel'` (macOS) keeps a click from activating
//     Hermes, so Deny works while the user stays in their editor.
//   - `setIgnoreMouseEvents(true, { forward: true })` hands the mouse to the app
//     behind everywhere the renderer has not re-armed it.
//   - `showInactive()` reveals it without taking the caret.
// Typing (a new session prompt) is the one case that asks for focus, and it asks
// explicitly.
import { BrowserWindow, ipcMain, screen } from 'electron'

import { type IslandDisplay, islandDragTarget, islandHasNotch, islandWindowBounds } from './island-geometry'
import { buildIslandWindowUrl } from './island-url'
import { attachRendererConsoleCapture } from './renderer-log'
import { installWindowRendererLifecycle } from './window-renderer-lifecycle'

/** How far below its anchor the island may be dragged. */
const ISLAND_DRAG_BOTTOM_MARGIN = 200

export interface IslandWindowOptions {
  /** The display the island belongs on: the one the app window is on, else the
   *  primary. Not the cursor — a pointer resting on a second monitor at boot
   *  must not park the island there for the life of the session. */
  anchorDisplay: () => IslandDisplay
  devServer?: string
  isMac: boolean
  loadWindowUrl: (window: BrowserWindow, url: string, label: string) => void
  log: (message: string) => void
  /** Re-open the app window on a session the island points at. */
  openSession: (sessionId: string) => void
  platform: string
  preloadPath: string
  profile?: null | string
  rendererIndex: () => string
  webPreferences: (preloadPath: string) => Electron.WebPreferences
  wireWindow: (window: BrowserWindow) => void
}

/** Mouse passthrough `forward` is macOS/Windows only (see the pet overlay). */
function forwardable(platform: string): boolean {
  return platform === 'darwin' || platform === 'win32'
}

function displayFor(win: BrowserWindow | null, anchor: () => IslandDisplay): IslandDisplay {
  return win && !win.isDestroyed() ? screen.getDisplayMatching(win.getBounds()) : anchor()
}

export function createIslandWindowController(options: IslandWindowOptions) {
  const { anchorDisplay, devServer, isMac, loadWindowUrl, log, openSession, platform, profile, rendererIndex } = options
  let window: BrowserWindow | null = null

  const spawn = (): BrowserWindow => {
    if (window && !window.isDestroyed()) {
      return window
    }

    const display = anchorDisplay()
    const notched = islandHasNotch(display, platform)
    const bounds = islandWindowBounds(display, platform)

    const next = new BrowserWindow({
      ...bounds,
      alwaysOnTop: true,
      backgroundColor: '#00000000',
      // Non-activating by default: the island appears and updates without taking
      // the keyboard from whatever the user is working in.
      focusable: false,
      // macOS otherwise pins the frame to the work area, which is below the menu
      // bar — and on a notched Mac the housing IS that band.
      enableLargerThanScreen: isMac,
      frame: false,
      fullscreenable: false,
      hasShadow: false,
      hiddenInMissionControl: isMac,
      maximizable: false,
      minimizable: false,
      // A notch belongs to the housing and must stay put; everywhere else the
      // island is the user's to move.
      movable: !notched,
      resizable: false,
      show: false,
      // On macOS a panel is a non-activating helper window that floats over
      // full-screen spaces without becoming the app's switcher window. Elsewhere
      // the taskbar entry is wrong for a status strip, so skip it.
      skipTaskbar: !isMac,
      transparent: true,
      webPreferences: {
        ...options.webPreferences(options.preloadPath),
        // The whole job is noticing that a turn finished or an approval landed
        // while nobody is looking at the island.
        backgroundThrottling: false
      }
    })

    // A notched display's pill is drawn OVER the menu bar band, because that is
    // where the housing is: `floating` sits below it, and the pill would be
    // clipped to the work area — a black bar under the notch instead of in it.
    next.setAlwaysOnTop(true, notched ? 'status' : isMac ? 'floating' : 'screen-saver')
    next.setHiddenInMissionControl?.(true)

    // Start click-through from MAIN: a transparent window that is slow to load,
    // blank, or whose renderer died must never sit over the top of the screen
    // eating clicks.
    next.setIgnoreMouseEvents(true, forwardable(platform) ? { forward: true } : undefined)

    try {
      next.setVisibleOnAllWorkspaces(
        true,
        isMac ? { skipTransformProcessType: true, visibleOnFullScreen: true } : undefined
      )
    } catch {
      // Best effort on older Electron/macOS combinations.
    }

    options.wireWindow(next)
    attachRendererConsoleCapture(next, 'island', log)
    // Log-only lifecycle, like the HUD and the wake cue: the island is
    // re-derivable from the stores, so a dead renderer belongs in desktop.log
    // rather than being resurrected behind the user's back.
    installWindowRendererLifecycle(next, { kind: 'island', callbacks: { log } })

    next.on('closed', () => {
      if (window === next) {
        window = null
      }
    })

    // Shown once the ISLAND says it is painted (see `markReady`), not on
    // `ready-to-show`: the island is a full renderer, and its first paint is the
    // app's boot screen. Then never hidden again — idle is the notch itself (or
    // nothing at all where there is no housing), and a window that is never
    // hidden is a renderer that is never frozen out of noticing the next turn.

    loadWindowUrl(
      next,
      buildIslandWindowUrl({
        devServer,
        notched,
        profile,
        rendererIndexPath: devServer ? undefined : rendererIndex()
      }),
      'Dynamic island'
    )

    window = next

    return next
  }

  return {
    ensureSpawned: spawn,
    getWindow: () => window,
    /** The island shell is mounted: show the window, without taking the caret. */
    markReady() {
      if (!window || window.isDestroyed()) {
        return
      }

      if (!window.isVisible()) {
        window.showInactive()
      }
    },
    setInteractive(next: boolean) {
      if (!window || window.isDestroyed()) {
        return
      }

      window.setIgnoreMouseEvents(!next, forwardable(platform) ? { forward: true } : undefined)
    },
    setFocusable(next: boolean) {
      if (!window || window.isDestroyed()) {
        return
      }

      window.setFocusable(next)

      if (next) {
        window.focus()
      }
    },
    /** Move the panel by the pointer's own travel. The renderer is the only side
     *  that sees the press, so the window has to follow it exactly or the
     *  surface drifts away from the cursor holding it. */
    dragBy(delta: { dx: number; dy: number }) {
      if (!window || window.isDestroyed()) {
        return
      }

      const bounds = window.getBounds()

      const next = islandDragTarget({
        bottomMargin: ISLAND_DRAG_BOTTOM_MARGIN,
        bounds,
        display: screen.getDisplayMatching(bounds),
        dx: delta.dx,
        dy: delta.dy
      })

      window.setPosition(next.x, next.y)
    },
    /** Follow a display topology change — the island is pinned to one display. */
    reposition() {
      if (!window || window.isDestroyed()) {
        return
      }

      const display = displayFor(window, anchorDisplay)

      window.setBounds(islandWindowBounds(display, platform))
      window.setAlwaysOnTop(
        true,
        islandHasNotch(display, platform) ? 'status' : isMac ? 'floating' : 'screen-saver'
      )
    },
    dispose() {
      const target = window
      window = null

      if (target && !target.isDestroyed()) {
        target.destroy()
      }
    },
    openSession
  }
}

export type IslandWindowController = ReturnType<typeof createIslandWindowController>

export function registerIslandIpc(getController: () => IslandWindowController | null) {
  ipcMain.on('hermes:island:ready', () => {
    getController()?.markReady()
  })

  ipcMain.on('hermes:island:interactive', (_event, interactive) => {
    getController()?.setInteractive(interactive === true)
  })

  ipcMain.on('hermes:island:focusable', (_event, focusable) => {
    getController()?.setFocusable(focusable === true)
  })

  ipcMain.on('hermes:island:drag', (_event, delta) => {
    const dx = Number((delta as { dx?: unknown })?.dx)
    const dy = Number((delta as { dy?: unknown })?.dy)

    if (Number.isFinite(dx) && Number.isFinite(dy)) {
      getController()?.dragBy({ dx, dy })
    }
  })

  ipcMain.on('hermes:island:open-session', (_event, sessionId) => {
    if (typeof sessionId === 'string' && sessionId.trim()) {
      getController()?.openSession(sessionId.trim())
    }
  })
}
