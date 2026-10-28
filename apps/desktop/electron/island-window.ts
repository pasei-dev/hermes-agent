// The Dynamic Island: a small, always-on-top window parked at the top centre of
// the display that shows what Hermes is doing and takes an approval answer
// without the user leaving the app they are working in.
//
// It is deliberately NOT the HUD. The HUD is one conversation's surface and it
// hides the app window when it opens; the island is a global status strip that
// coexists with every other window, shows nothing at all when nothing is
// running, and answers the approval the OS notification would otherwise send
// the user into Hermes for. It is also a FULL renderer with its own gateway
// (like the HUD) because it needs the app's session and prompt stores — the
// pet overlay's gateway-less model cannot see an approval.
//
// Three properties are what make "answer without switching apps" real, and all
// three are window flags rather than page CSS:
//   - `focusable: false` + `type: 'panel'` (macOS) keeps a click from activating
//     Hermes, so Deny works while the user stays in their editor.
//   - `setIgnoreMouseEvents(true, { forward: true })` makes the transparent
//     rectangle pass clicks through except where the renderer re-arms it — the
//     renderer re-arms on hover, so the pill is the only interactive part.
//   - `showInactive()` reveals an attention card without stealing the caret.
// Typing (a deny reason, a new session prompt) is the one case that asks for
// focus, and it asks explicitly.
import { BrowserWindow, ipcMain, screen } from 'electron'

import { type IslandDisplayArea, islandWindowBounds } from './island-geometry'
import { buildIslandWindowUrl } from './island-url'
import { attachRendererConsoleCapture } from './renderer-log'
import { installWindowRendererLifecycle } from './window-renderer-lifecycle'

/** What the renderer reports on every stage/geometry change. */
export interface IslandWindowReport {
  height?: number
  visible: boolean
}

export interface IslandWindowOptions {
  devServer?: string
  isMac: boolean
  loadWindowUrl: (window: BrowserWindow, url: string, label: string) => void
  log: (message: string) => void
  /** Re-open the app window on a session the island points at. */
  openSession: (sessionId: string) => void
  preloadPath: string
  profile?: null | string
  rendererIndex: () => string
  webPreferences: (preloadPath: string) => Electron.WebPreferences
  wireWindow: (window: BrowserWindow) => void
}

interface IslandReportListener {
  (report: IslandWindowReport): void
}

/** Mouse passthrough `forward` is macOS/Windows only (see the pet overlay). */
function forwardable(platform: string): boolean {
  return platform === 'darwin' || platform === 'win32'
}

function normalizeReport(value: unknown): IslandWindowReport | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const { height, visible } = value as { height?: unknown; visible?: unknown }

  return {
    height: Number.isFinite(height) ? Number(height) : undefined,
    visible: visible === true
  }
}

export function createIslandWindowController(options: IslandWindowOptions & { platform: string }) {
  const { devServer, isMac, loadWindowUrl, log, openSession, platform, profile, rendererIndex } = options
  let interactive = false
  let lastHeight = 0
  let pinnedDisplayId: number | null = null
  let visible = false
  let window: BrowserWindow | null = null

  // The display the island was born on, and NOT the one under the cursor: a
  // height change while the pointer happens to sit on another monitor must not
  // teleport the pill there. A display that disappears falls back to the
  // primary rather than leaving the island off-screen.
  const displayArea = (): IslandDisplayArea => {
    const displays = screen.getAllDisplays()
    const pinned = pinnedDisplayId === null ? null : displays.find(display => display.id === pinnedDisplayId)

    return (pinned ?? screen.getPrimaryDisplay()).workArea
  }

  const applyBounds = (height: number) => {
    if (!window || window.isDestroyed()) {
      return
    }

    const next = islandWindowBounds(displayArea(), height)

    if (lastHeight === next.height && !window.isDestroyed()) {
      // The height is what moves; a re-report at the same height must not
      // re-seat the window (and must never fight a user's own drag, if one is
      // ever added).
      return
    }

    lastHeight = next.height
    window.setBounds(next)
  }

  const applyInteractive = (next: boolean) => {
    if (!window || window.isDestroyed()) {
      return
    }

    interactive = next
    // `forward` keeps mousemove flowing to the page while clicks pass through,
    // which is what lets the renderer re-arm the moment the cursor reaches the
    // pill. Linux has no `forward`; there the renderer drives solidity from
    // hover events it does receive.
    window.setIgnoreMouseEvents(!next, forwardable(platform) ? { forward: true } : undefined)
  }

  const spawn = (): BrowserWindow => {
    if (window && !window.isDestroyed()) {
      return window
    }

    if (pinnedDisplayId === null) {
      pinnedDisplayId = screen.getPrimaryDisplay().id
    }

    const bounds = islandWindowBounds(displayArea(), 0)

    const next = new BrowserWindow({
      ...bounds,
      alwaysOnTop: true,
      backgroundColor: '#00000000',
      // Non-activating by default: the island appears and updates without
      // taking the keyboard from whatever the user is working in.
      focusable: false,
      frame: false,
      fullscreenable: false,
      hasShadow: false,
      hiddenInMissionControl: isMac,
      maximizable: false,
      minimizable: false,
      movable: false,
      resizable: false,
      show: false,
      // On macOS a panel is a non-activating helper window that floats over
      // full-screen spaces without becoming the app's switcher window. Elsewhere
      // the taskbar entry is wrong for a status strip, so skip it.
      skipTaskbar: !isMac,
      transparent: true,
      type: isMac ? 'panel' : undefined,
      webPreferences: {
        ...options.webPreferences(options.preloadPath),
        // The whole job is to notice a turn finishing OR an approval landing
        // while the island is hidden and nobody is looking at it. Chromium's
        // default throttles a hidden window's timers hard enough to make that
        // late, so the poll keeps its cadence.
        backgroundThrottling: false
      }
    })

    next.setAlwaysOnTop(true, isMac ? 'floating' : 'screen-saver')
    next.setHiddenInMissionControl?.(true)

    // Start click-through from MAIN: a transparent window that is slow to load,
    // blank, or whose renderer died must never sit over the top of the screen
    // eating clicks.
    next.setIgnoreMouseEvents(true, forwardable(platform) ? { forward: true } : undefined)

    try {
      next.setVisibleOnAllWorkspaces(true, isMac ? { skipTransformProcessType: true, visibleOnFullScreen: true } : undefined)
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
      lastHeight = 0
      visible = false

      if (window === next) {
        window = null
      }
    })

    loadWindowUrl(
      next,
      buildIslandWindowUrl({
        devServer,
        profile,
        rendererIndexPath: devServer ? undefined : rendererIndex()
      }),
      'Dynamic island'
    )

    window = next

    return next
  }

  const report: IslandReportListener = raw => {
    const next = normalizeReport(raw)

    if (!next) {
      return
    }

    if (!next.visible) {
      visible = false

      if (window && !window.isDestroyed() && window.isVisible()) {
        window.hide()
      }

      return
    }

    const target = spawn()

    if (next.height !== undefined) {
      applyBounds(next.height)
    }

    visible = true

    if (!target.isVisible()) {
      target.showInactive()
    }
  }

  return {
    ensureSpawned: spawn,
    getWindow: () => window,
    isVisible: () => visible,
    /** Height the renderer last asked for (0 before the first report). */
    reportedHeight: () => lastHeight,
    setInteractive: (next: boolean) => applyInteractive(next),
    setFocusable(next: boolean) {
      if (!window || window.isDestroyed()) {
        return
      }

      window.setFocusable(next)

      if (next) {
        window.focus()
      }
    },
    report,
    /** Follow a display topology change — the island is pinned to one display. */
    reposition() {
      if (!window || window.isDestroyed() || !lastHeight) {
        return
      }

      window.setBounds(islandWindowBounds(displayArea(), lastHeight))
    },
    dispose() {
      const target = window
      window = null
      visible = false
      lastHeight = 0

      if (target && !target.isDestroyed()) {
        target.destroy()
      }
    },
    openSession
  }
}

export type IslandWindowController = ReturnType<typeof createIslandWindowController>

export function registerIslandIpc(getController: () => IslandWindowController | null) {
  ipcMain.on('hermes:island:report', (_event, report) => {
    getController()?.report(report)
  })

  ipcMain.on('hermes:island:interactive', (_event, interactive) => {
    getController()?.setInteractive(interactive === true)
  })

  ipcMain.on('hermes:island:focusable', (_event, focusable) => {
    getController()?.setFocusable(focusable === true)
  })

  ipcMain.on('hermes:island:open-session', (_event, sessionId) => {
    if (typeof sessionId === 'string' && sessionId.trim()) {
      getController()?.openSession(sessionId.trim())
    }
  })
}
