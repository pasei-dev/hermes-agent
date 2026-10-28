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
  type IslandDisplay,
  type IslandDock,
  islandDock,
  islandDragTarget,
  islandHasNotch,
  islandSnapOrigin,
  islandWindowBounds
} from './island-geometry'
import type { IslandOrigin } from './island-settings'
import { buildIslandWindowUrl } from './island-url'
import { attachRendererConsoleCapture } from './renderer-log'
import { installWindowRendererLifecycle } from './window-renderer-lifecycle'

/** The edge the island is currently attached to, and the way it says so. */
export interface IslandDockReport {
  dock: IslandDock
}

export interface IslandWindowOptions {
  /** Whether the app's own window has the keyboard right now. */
  isMainFocused?: () => boolean
  /** The display the island belongs on: the one the app window is on, else the
   *  primary. Not the cursor — a pointer resting on a second monitor at boot
   *  must not park the island there for the life of the session. */
  anchorDisplay: () => IslandDisplay
  devServer?: string
  isMac: boolean
  loadWindowUrl: (window: BrowserWindow, url: string, label: string) => void
  log: (message: string) => void
  /** Re-open the app window on a session the island points at. */
  platform: string
  preloadPath: string
  profile?: null | string
  /** Where the floating pill was last parked (null: never moved). */
  readOrigin?: () => IslandOrigin | null
  rendererIndex: () => string
  webPreferences: (preloadPath: string) => Electron.WebPreferences
  /** Remember a parked position after the drag settles. */
  writeOrigin?: (origin: IslandOrigin) => void
  wireWindow: (window: BrowserWindow) => void
}

/**
 * A saved position, but only when it still lands on the display the island is
 * anchored to. A point remembered on the monitor that has since been unplugged
 * would otherwise park the pill off-screen, where it cannot be dragged back.
 */
export function parkedOriginOn(display: IslandDisplay, origin: IslandOrigin | null): IslandOrigin | null {
  if (!origin) {
    return null
  }

  const under = screen.getDisplayMatching({ height: 200, width: 320, x: origin.x, y: origin.y })

  // `IslandDisplay` is the structural subset the geometry needs, so it carries no
  // id: two displays cannot share a work-area origin, which makes this the
  // comparison that survives both shapes.
  const same =
    under.workArea.x === display.workArea.x &&
    under.workArea.y === display.workArea.y &&
    under.workArea.width === display.workArea.width

  return same ? origin : null
}

/** Mouse passthrough `forward` is macOS/Windows only (see the pet overlay). */
function forwardable(platform: string): boolean {
  return platform === 'darwin' || platform === 'win32'
}

const displayUnder = (bounds: Electron.Rectangle): IslandDisplay => {
  // Largest overlap wins. Electron's own matcher answers the primary display
  // when a window overlaps none of them — a seam wider than the island would
  // then teleport it across the desk mid-drag.
  let best: Electron.Display | null = null
  let bestArea = 0

  for (const candidate of screen.getAllDisplays()) {
    const overlapX =
      Math.min(bounds.x + bounds.width, candidate.bounds.x + candidate.bounds.width) -
      Math.max(bounds.x, candidate.bounds.x)

    const overlapY =
      Math.min(bounds.y + bounds.height, candidate.bounds.y + candidate.bounds.height) -
      Math.max(bounds.y, candidate.bounds.y)

    const area = Math.max(0, overlapX) * Math.max(0, overlapY)

    if (area > bestArea) {
      best = candidate
      bestArea = area
    }
  }

  // Nothing overlaps: the nearest display to the window's centre is the one the
  // user is dragging toward.
  return (
    best ??
    screen.getDisplayNearestPoint({
      x: Math.round(bounds.x + bounds.width / 2),
      y: Math.round(bounds.y + bounds.height / 2)
    })
  )
}

function displayFor(win: BrowserWindow | null, anchor: () => IslandDisplay): IslandDisplay {
  return win && !win.isDestroyed() ? displayUnder(win.getBounds()) : anchor()
}

export function createIslandWindowController(options: IslandWindowOptions) {
  const { anchorDisplay, devServer, isMac, loadWindowUrl, log, platform, profile, rendererIndex } = options
  let window: BrowserWindow | null = null
  let originTimer: null | ReturnType<typeof setTimeout> = null

  /**
   * The window's frame: the anchor's, unless the user parked the pill somewhere
   * and that somewhere is still on this display. A notch is never restored — the
   * housing holds the surface and `movable` is false, so a saved point would
   * fight the anchor on every launch.
   */
  const boundsFor = (display: IslandDisplay) => {
    const bounds = islandWindowBounds(display, platform)

    if (islandHasNotch(display, platform)) {
      return bounds
    }

    const saved = options.readOrigin?.() ?? null

    if (!saved) {
      return bounds
    }

    // The saved point may be on another display: where the island sits is the
    // user's desk, not the app window's, so the drop's own display is restored
    // rather than re-homing the pill on the anchor's.
    const under = screen.getDisplayMatching({ height: 40, width: 320, x: saved.x, y: saved.y })
    const parked = parkedOriginOn(under, saved)

    return parked ? { ...islandWindowBounds(under, platform), x: parked.x, y: parked.y } : bounds
  }

  /**
   * Tell the renderer which edge it is attached to: the surface squares the
   * corners against that edge and hugs it, so a docked island reads as part of
   * the screen rather than as a pill that happens to be near it.
   */
  const announceDock = () => {
    if (!window || window.isDestroyed()) {
      return
    }

    const bounds = window.getBounds()
    const display = screen.getDisplayMatching(bounds)

    // The whole desktop decides the sides: the display under the window decides
    // the top anchor and the work area's floor.
    const dock = islandDock({
      anchor: islandWindowBounds(display, platform),
      bounds,
      display,
      displays: screen.getAllDisplays()
    })

    window.webContents.send('hermes:island:dock', dock)
  }

  /**
   * Whether the app window has the keyboard. The island is a notification, not a
   * HUD: when the user is reading Hermes itself there is nothing to notify them
   * of, so it collapses into the notch instead of sitting over the app.
   */
  const announceMainFocus = () => {
    if (!window || window.isDestroyed()) {
      return
    }

    window.webContents.send('hermes:island:main-focus', options.isMainFocused?.() === true)
  }

  /**
   * Write the parked position once the drag settles. `dragBy` fires per pointer
   * move, and a file write per move is hundreds of them for one gesture.
   */
  const rememberOrigin = () => {
    if (!options.writeOrigin) {
      return
    }

    if (originTimer) {
      clearTimeout(originTimer)
    }

    originTimer = setTimeout(() => {
      originTimer = null

      if (!window || window.isDestroyed()) {
        return
      }

      const bounds = window.getBounds()
      const display = displayUnder(bounds)

      // Attach on release: near an edge the island goes flush to it, so a
      // dropped pill is docked rather than left a few pixels off a corner. The
      // seams between displays are not edges, so a drop there stays put — the
      // window moves only when an edge actually claimed it.
      const origin = islandSnapOrigin({
        anchor: islandWindowBounds(display, platform),
        bounds,
        display,
        displays: screen.getAllDisplays()
      })

      if (origin.x !== bounds.x || origin.y !== bounds.y) {
        window.setPosition(origin.x, origin.y)
      }

      announceDock()
      options.writeOrigin?.(origin)
    }, 400)
  }

  const spawn = (): BrowserWindow => {
    if (window && !window.isDestroyed()) {
      return window
    }

    const display = anchorDisplay()
    const notched = islandHasNotch(display, platform)
    const bounds = boundsFor(display)

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

      // The display mostly under the window holds the y ceiling; the rest of the
      // desktop is the horizontal range, so a drag crosses a seam instead of
      // stopping dead at it.
      const next = islandDragTarget({
        bounds,
        display: displayUnder(window.getBounds()),
        displays: screen.getAllDisplays(),
        dx: delta.dx,
        dy: delta.dy
      })

      window.setPosition(next.x, next.y)
      rememberOrigin()
    },
    /** Follow a display topology change — the island is pinned to one display. */
    reposition() {
      if (!window || window.isDestroyed()) {
        return
      }

      const display = displayFor(window, anchorDisplay)

      window.setBounds(boundsFor(display))
      window.setAlwaysOnTop(
        true,
        islandHasNotch(display, platform) ? 'status' : isMac ? 'floating' : 'screen-saver'
      )
      announceDock()
    },
    announceDock,
    announceMainFocus,
    dispose() {
      const target = window
      window = null

      if (target && !target.isDestroyed()) {
        target.destroy()
      }
    }
  }
}

export type IslandWindowController = ReturnType<typeof createIslandWindowController>

export function registerIslandIpc(getController: () => IslandWindowController | null) {
  ipcMain.on('hermes:island:ready', () => {
    getController()?.markReady()
    // The renderer boots with no idea where the window was restored, so the dock
    // is announced with the first paint or a docked island loses its squared edge.
    getController()?.announceDock()
    getController()?.announceMainFocus()
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
