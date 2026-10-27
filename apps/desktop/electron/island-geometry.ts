// Where the Dynamic Island sits and how big it may get.
//
// Electron-free so the placement contract is unit-testable — the same split as
// `wake-indicator.ts`, and for the same reason: a wrong origin is invisible
// until it is on someone's screen. The window is anchored TOP-CENTER of the
// display's work area (below the macOS menu bar, never inside it) and grows
// downward as the renderer reports content height, so the pill never moves when
// it expands.

export const ISLAND_WINDOW_WIDTH = 460
export const ISLAND_MIN_HEIGHT = 40
export const ISLAND_MAX_HEIGHT = 640
/** Clearance under the work area's top edge — the macOS menu bar's own band. */
export const ISLAND_TOP_GAP = 8
/** Keeps the transparent window off the screen edges it could otherwise span. */
export const ISLAND_SIDE_MARGIN = 16

export interface IslandDisplayArea {
  height: number
  width: number
  x: number
  y: number
}

export function islandWindowWidth(area: IslandDisplayArea): number {
  return Math.max(ISLAND_MIN_HEIGHT, Math.min(ISLAND_WINDOW_WIDTH, area.width - ISLAND_SIDE_MARGIN * 2))
}

/** Clamp to the window's own floor/ceiling and to the display it lives on. The
 *  renderer reports a measured height; a stale or wild value must not push the
 *  island off the bottom of the screen. */
export function islandWindowHeight(area: IslandDisplayArea, height: number): number {
  const ceiling = Math.min(ISLAND_MAX_HEIGHT, Math.max(ISLAND_MIN_HEIGHT, area.height - ISLAND_TOP_GAP * 2))

  if (!Number.isFinite(height)) {
    return ISLAND_MIN_HEIGHT
  }

  return Math.round(Math.min(ceiling, Math.max(ISLAND_MIN_HEIGHT, height)))
}

export function islandWindowBounds(area: IslandDisplayArea, height: number) {
  const width = islandWindowWidth(area)

  return {
    height: islandWindowHeight(area, height),
    width,
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + ISLAND_TOP_GAP)
  }
}
