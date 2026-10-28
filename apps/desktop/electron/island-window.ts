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

import {
  ISLAND_WINDOW_WIDTH,
  type IslandDisplay,
  islandDock,
  islandDragTarget,
  islandHasNotch,
  type IslandRect,
  type IslandSurfaceRect,
  islandWindowBounds
} from './island-geometry'
import type { IslandOrigin } from './island-settings'
import { buildIslandWindowUrl } from './island-url'
import { attachRendererConsoleCapture } from './renderer-log'
import { installWindowRendererLifecycle } from './window-renderer-lifecycle'

export interface IslandWindowOptions {
  /** The display the island belongs on: the one the app window is on, else the
   *  primary. Not the cursor — a pointer resting on a second monitor at boot
   *  must not park the island there for the life of the session. */
  anchorDisplay: () => IslandDisplay
  devServer?: string
  isMac: boolean
  /** Whether the app's own window has the keyboard: the island steps aside. */
  isMainFocused?: () => boolean
  loadWindowUrl: (window: BrowserWindow, url: string, label: string) => void
  log: (message: string) => void
  /** Re-open the app window on a session the island points at. */
  platform: string
  /** Where the pill was parked last time, and how a new place is remembered. */
  readOrigin?: () => IslandOrigin | null
  preloadPath: string
  profile?: null | string
  rendererIndex: () => string
  webPreferences: (preloadPath: string) => Electron.WebPreferences
  writeOrigin?: (origin: IslandOrigin) => void
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
  const { anchorDisplay, devServer, isMac, loadWindowUrl, log, platform, profile, rendererIndex } = options
  let window: BrowserWindow | null = null
  /**
   * The painted pill, as the renderer measured it. Everything the drag clamps
   * and snaps is this rectangle: the window is bigger than the island by
   * design, so clamping its edges would stop the pill more than a hundred
   * points short of the screen edge it was dragged at.
   */
  let surface: IslandSurfaceRect | null = null

  /** The surface's rectangle in screen coordinates. Before the renderer has
   *  measured itself the window IS the surface, which is the safe default. */
  const surfaceRect = (bounds: IslandRect): IslandRect => {
    if (!surface || !(surface.width > 0) || !(surface.height > 0)) {
      return { ...bounds }
    }

    // The renderer is the only side that measures the surface, so a stale or
    // nonsense offset must not park the window a screen away from the pointer.
    const offsetX = Math.max(-ISLAND_WINDOW_WIDTH, Math.min(ISLAND_WINDOW_WIDTH, surface.offsetX))
    const offsetY = Math.max(-ISLAND_WINDOW_WIDTH, Math.min(ISLAND_WINDOW_WIDTH, surface.offsetY))

    return {
      height: surface.height,
      width: surface.width,
      x: bounds.x + offsetX,
      y: bounds.y + offsetY
    }
  }

  /** Tell the renderer which edge it is attached to: the surface squares the
   *  corners against that edge and hugs it. */
  const announceDock = () => {
    if (!window || window.isDestroyed()) {
      return
    }

    const bounds = window.getBounds()
    const display = screen.getDisplayMatching(bounds)
    const dock = islandDock({ display, platform, width: surface?.width ?? bounds.width })

    window.webContents.send('hermes:island:dock', dock)
  }

  /** Whether the app window has the keyboard: the island reads it as "step
   *  aside", because a notification about the app you are reading is noise. */
  const announceMainFocus = () => {
    if (!window || window.isDestroyed()) {
      return
    }

    window.webContents.send('hermes:island:main-focus', options.isMainFocused?.() === true)
  }

  let originTimer: null | ReturnType<typeof setTimeout> = null

  /**
   * The drag is over: snap the surface to an edge if it is close to one, move the
   * window by the correction, let the surface spring into place and remember the
   * result. Debounced from the last pointer move — the renderer never says
   * "released", and one write per gesture is enough.
   */
  const rememberOrigin = () => {
    if (originTimer) {
      clearTimeout(originTimer)
    }

    originTimer = setTimeout(() => {
      originTimer = null

      if (!window || window.isDestroyed()) {
        return
      }

      const bounds = window.getBounds()
      const current = surfaceRect(bounds)

      const settled = islandDragTarget({
        dx: 0,
        dy: 0,
        displays: screen.getAllDisplays(),
        platform,
        surface: current
      })

      const dx = Math.round(settled.x - current.x)
      const dy = Math.round(settled.y - current.y)

      if (dx !== 0 || dy !== 0) {
        window.setPosition(Math.round(bounds.x + dx), Math.round(bounds.y + dy))
      }

      // Sent even at zero: a release that landed where it was dropped still gets
      // the dip, which is what makes letting go feel like something happened.
      if (!window.webContents.isDestroyed()) {
        window.webContents.send('hermes:island:settle', { dx, dy })
      }

      announceDock()
      options.writeOrigin?.({ x: Math.round(bounds.x + dx), y: Math.round(bounds.y + dy) })
    }, 320)
  }

  const spawn = (): BrowserWindow => {
    if (window && !window.isDestroyed()) {
      return window
    }

    const display = anchorDisplay()
    const notched = islandHasNotch(display, platform)
    const anchor = islandWindowBounds(display, platform)
    // A parked pill reopens where it was parked, on whatever display that was.
    const saved = islandHasNotch(display, platform) ? null : (options.readOrigin?.() ?? null)

    const parkedDisplay = saved
      ? screen.getDisplayMatching({ height: 40, width: 320, x: saved.x, y: saved.y })
      : display

    const bounds = saved
      ? { ...islandWindowBounds(parkedDisplay, platform), x: Math.round(saved.x), y: Math.round(saved.y) }
      : anchor

    const next = new BrowserWindow({
      ...bounds,
      alwaysOnTop: true,
      backgroundColor: '#00000000',
      // The click that answers a card must not bring Hermes to the front. On
      // macOS only a non-activating panel does that, so the window is a panel and
      // it takes the first click rather than the activation that would precede
      // it — `focusable: false` alone still activates the app.
      acceptFirstMouse: true,
      type: isMac ? 'panel' : undefined,
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
    // 'screen-saver' is above the menu bar and the status items: at 'floating' or
    // 'status' the island paints behind the macOS menu bar, which reads as the
    // pill being cut in half at the top of the screen.
    next.setAlwaysOnTop(true, 'screen-saver')
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
        notchHeight: display.workArea.y - display.bounds.y,
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
    announceDock,
    announceMainFocus,
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
    /** The renderer's measurement of the painted pill: what the drag moves. */
    setSurface(rect: IslandSurfaceRect) {
      surface = rect
    },
    /** Move the panel by the pointer's own travel. The renderer is the only side
     *  that sees the press, so the window has to follow it exactly or the
     *  surface drifts away from the cursor holding it. */
    dragBy(delta: { dx: number; dy: number }) {
      if (!window || window.isDestroyed()) {
        return
      }

      const bounds = window.getBounds()
      const current = surfaceRect(bounds)

      // What the surface would occupy if nothing were in its way, and where it
      // is allowed to settle: clamped to the displays, then snapped to an edge.
      // Clamp only while the gesture is live. A snap here would re-snap on the
      // next event and the pill could never leave the 30px band it landed in.
      const moved = islandDragTarget({
        dx: delta.dx,
        dy: delta.dy,
        displays: screen.getAllDisplays(),
        platform,
        settle: false,
        surface: current
      })

      window.setPosition(
        Math.round(moved.x - (current.x - bounds.x)),
        Math.round(moved.y - (current.y - bounds.y))
      )

      rememberOrigin()
    },
    /** Follow a display topology change — the island is pinned to one display. */
    reposition() {
      if (!window || window.isDestroyed()) {
        return
      }

      const display = displayFor(window, anchorDisplay)

      window.setBounds(islandWindowBounds(display, platform))
      // Same level as at creation, or a display change drops it back behind the
      // menu bar.
      window.setAlwaysOnTop(true, 'screen-saver')

      // The window's own width changed with the display, so the pill sits at a
      // different offset inside it: ask for a fresh measurement.
      if (!window.webContents.isDestroyed()) {
        window.webContents.send('hermes:island:remeasure')
      }

      announceDock()
    },
    dispose() {
      const target = window
      window = null
      surface = null

      if (target && !target.isDestroyed()) {
        target.destroy()
      }
    }
  }
}

export type IslandWindowController = ReturnType<typeof createIslandWindowController>

/**
 * The renderer's surface measurement, or nothing.
 *
 * It arrives over IPC from the one side that can measure the pill, so a missing
 * or non-numeric field means the message is not a measurement: drop it and keep
 * the last good one rather than moving the window to `NaN`.
 */
function readSurfaceRect(raw: unknown): IslandSurfaceRect | null {
  const value = raw as Partial<Record<keyof IslandSurfaceRect, unknown>> | null

  const rect = {
    height: Number(value?.height),
    offsetX: Number(value?.offsetX),
    offsetY: Number(value?.offsetY),
    width: Number(value?.width)
  }

  if (!Object.values(rect).every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) {
    return null
  }

  return rect
}

export function registerIslandIpc(getController: () => IslandWindowController | null) {
  ipcMain.on('hermes:island:ready', () => {
    getController()?.markReady()
    // The renderer boots with no idea where the window was restored, so the dock
    // and the app's focus are announced with the first paint.
    getController()?.announceDock()
    getController()?.announceMainFocus()
  })

  ipcMain.on('hermes:island:surface', (_event, raw) => {
    const surface = readSurfaceRect(raw)

    if (surface) {
      getController()?.setSurface(surface)
    }
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

}
