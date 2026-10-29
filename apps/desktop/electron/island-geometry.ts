// Where the Dynamic Island sits and how big its window is.
//
// Electron-free so the placement contract is unit-testable — the same split as
// `wake-indicator.ts`, and for the same reason: a wrong origin is invisible
// until it is on someone's screen.
//
// The window is ONE fixed rectangle for the whole session, top-centred, and the
// island animates inside it. Resizing a transparent always-on-top window per
// frame is what makes a web island stutter — every `setBounds` is a synchronous
// round trip to the compositor — so the window is laid out once as the largest
// the island can ever be and the black surface moves, scales and fades within
// it. The area the surface does not cover is click-through (see the renderer's
// hit test), so a big transparent window costs nothing but pixels it never
// paints.
//
// On a notched MacBook the panel starts at the very top of the display and is
// raised above the menu bar, because that is where the notch is: the collapsed
// pill is notch-shaped and sits exactly over it, so "hidden" reads as the notch
// itself rather than as a floating bar. Everywhere else the panel starts below
// the menu bar and can be dragged.

export const ISLAND_WINDOW_WIDTH = 480
/** Tallest the expanded island may get; the surface itself is usually shorter. */
export const ISLAND_WINDOW_HEIGHT = 620
/** The notch-shaped resting pill — roughly a 14" MacBook Pro's notch. */
export const ISLAND_NOTCH_WIDTH = 208
export const ISLAND_NOTCH_HEIGHT = 32
/** Clearance under the menu bar on displays that have no notch. */
export const ISLAND_TOP_GAP = 6
/** How close a settled surface has to be to an edge before it is pulled flush. */
export const ISLAND_EDGE_SNAP = 30

export interface IslandRect {
  height: number
  width: number
  x: number
  y: number
}

/**
 * The painted island, measured inside its window.
 *
 * The drag has to follow this rectangle and not the window: the window is the
 * largest the island can ever be, so a window edge sits far outside the black
 * pill and clamping the window leaves the pill unable to reach the screen edge
 * it is being dragged at.
 */
export interface IslandSurfaceRect {
  height: number
  /** Distance from the window's left edge to the surface's left edge. */
  offsetX: number
  /** Distance from the window's top edge to the surface's top edge. */
  offsetY: number
  width: number
}


export interface IslandDisplay {
  bounds: { height: number; width: number; x: number; y: number }
  /** Electron's built-in-panel flag. Undefined on platforms/versions that lack it. */
  internal?: boolean
  /** macOS excludes the menu bar from this; the difference is the menu bar. */
  workArea: { height: number; width: number; x: number; y: number }
}

/**
 * Whether this display has a camera housing.
 *
 * Electron exposes no notch API, but the geometry gives it away on macOS: the
 * work area starts BELOW the menu bar, and a notched display's menu bar is the
 * housing's height (32pt and up) while a plain one is ~24pt. The threshold sits
 * between the two, so an ordinary display can never read as notched — a false
 * positive would park a black pill over someone's menu bar.
 */
export function islandHasNotch(display: IslandDisplay, platform: string): boolean {
  if (platform !== 'darwin') {
    return false
  }

  // A housing is built into a laptop panel and nowhere else. Without this the
  // test is a menu-bar height, and an external display with a tall menu bar (a
  // larger menu-bar size, a scaled 5K) reads as notched — which parks a pill
  // that cannot be dragged over a desk display that has no notch at all.
  if (display.internal === false) {
    return false
  }

  return display.workArea.y - display.bounds.y >= 30
}

export function islandWindowBounds(display: IslandDisplay, platform: string) {
  const notched = islandHasNotch(display, platform)
  const top = notched ? display.bounds.y : display.workArea.y + ISLAND_TOP_GAP

  return {
    height: ISLAND_WINDOW_HEIGHT,
    width: Math.min(ISLAND_WINDOW_WIDTH, display.bounds.width),
    x: islandCentredX(display, Math.min(ISLAND_WINDOW_WIDTH, display.bounds.width)),
    y: top
  }
}

/** Centred horizontally on a display, never wider than the display itself. */
function islandCentredX(display: IslandDisplay, width: number): number {
  return Math.round(display.bounds.x + (display.bounds.width - width) / 2)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)))
}

/** Height of the band two displays share, which is where their edges meet. */
function verticalOverlap(a: IslandDisplay, b: IslandDisplay): number {
  return (
    Math.min(a.bounds.y + a.bounds.height, b.bounds.y + b.bounds.height) - Math.max(a.bounds.y, b.bounds.y)
  )
}

/** The display a rect covers most of — what `screen.getDisplayMatching` answers. */
export function islandDisplayUnder(rect: IslandRect, displays: IslandDisplay[]): IslandDisplay | null {
  let under: IslandDisplay | null = null
  let covered = 0

  for (const display of displays) {
    const width =
      Math.min(rect.x + rect.width, display.bounds.x + display.bounds.width) - Math.max(rect.x, display.bounds.x)

    const height =
      Math.min(rect.y + rect.height, display.bounds.y + display.bounds.height) - Math.max(rect.y, display.bounds.y)

    const area = Math.max(0, width) * Math.max(0, height)

    if (area > covered) {
      covered = area
      under = display
    }
  }

  return under
}

/** The display closest to a rect that overlaps none of them. */
export function islandNearestDisplay(rect: IslandRect, displays: IslandDisplay[]): IslandDisplay | null {
  const centreX = rect.x + rect.width / 2
  const centreY = rect.y + rect.height / 2
  let best: IslandDisplay | null = null
  let bestDistance = Number.POSITIVE_INFINITY

  for (const display of displays) {
    const dx = Math.max(display.bounds.x - centreX, 0, centreX - (display.bounds.x + display.bounds.width))
    const dy = Math.max(display.bounds.y - centreY, 0, centreY - (display.bounds.y + display.bounds.height))
    const distance = dx * dx + dy * dy

    if (distance < bestDistance) {
      bestDistance = distance
      best = display
    }
  }

  return best
}

/**
 * Where a drag may put the SURFACE.
 *
 * Its edges reach the desktop's outer edges and no further, so the union of the
 * displays is the bound on each axis: a setup that is wider than it is tall must
 * let the island cross a display boundary on its way to the far side. Downward
 * it stops at the bottom of the work area of the display it mostly sits on — the
 * dock and the taskbar are that display's, not the union's.
 */
export function islandDragTarget(input: {
  dx: number
  dy: number
  displays: IslandDisplay[]
  platform: string
  /** Snap to an edge on this move. False while a drag is in flight: a pill that
   *  snapped on every pointer event could not be dragged back out of the band it
   *  snapped into. */
  settle?: boolean
  surface: IslandRect
}): { x: number; y: number } {
  const { dx, dy, displays, platform, settle = true, surface } = input
  const floor = Math.min(...displays.map(display => display.bounds.y))
  // The ceiling belongs to the display the pill is on NOW: a drag that asks for
  // the far side of the desk must not be allowed to jump a whole screen down.
  // A pill in the void between displays has no overlap at all, so the nearest
  // display governs — `floor` alone would pin it to the top of the desktop.
  const under = islandDisplayUnder(surface, displays) ?? islandNearestDisplay(surface, displays)
  const ceiling = under ? under.workArea.y + under.workArea.height - surface.height : floor

  const moved: IslandRect = {
    height: surface.height,
    width: surface.width,
    x: clamp(
      surface.x + dx,
      Math.min(...displays.map(display => display.bounds.x)),
      Math.max(...displays.map(display => display.bounds.x + display.bounds.width)) - surface.width
    ),
    y: clamp(surface.y + dy, floor, Math.max(floor, ceiling))
  }

  if (!settle) {
    return { x: Math.round(moved.x), y: Math.round(moved.y) }
  }

  const docked = islandDisplayUnder(moved, displays) ?? islandNearestDisplay(moved, displays)
  const dock = docked ? islandDock({ display: docked, platform, width: moved.width }) : null

  // The top of a display is the notch position, and a pill that stops 10px short
  // of it looks broken rather than parked: snap flush and centred instead.
  if (dock && Math.abs(moved.y - dock.y) <= ISLAND_EDGE_SNAP) {
    return dock
  }

  return islandSnapOrigin({ displays, rect: moved })
}

/**
 * Pull a settled surface flush to a display's side edge when it is close.
 *
 * The boundary two side-by-side displays share is not an edge: a pill pulled
 * flush to a seam would park in the middle of the desktop.
 */
export function islandSnapOrigin(input: { displays: IslandDisplay[]; rect: IslandRect }): { x: number; y: number } {
  const { displays, rect } = input
  const right = rect.x + rect.width
  let x = Math.round(rect.x)
  let nearest = ISLAND_EDGE_SNAP + 1

  for (const display of displays) {
    for (const side of ['left', 'right'] as const) {
      if (isSeam(displays, display, side)) {
        continue
      }

      const edge = side === 'left' ? display.bounds.x : display.bounds.x + display.bounds.width
      const distance = side === 'left' ? Math.abs(rect.x - edge) : Math.abs(right - edge)

      if (distance <= ISLAND_EDGE_SNAP && distance < nearest) {
        nearest = distance
        x = Math.round(side === 'left' ? edge : edge - rect.width)
      }
    }
  }

  return { x, y: Math.round(rect.y) }
}

/** Whether this side of a display abuts another display instead of the desktop. */
function isSeam(displays: IslandDisplay[], display: IslandDisplay, side: 'left' | 'right'): boolean {
  const edge = side === 'left' ? display.bounds.x : display.bounds.x + display.bounds.width

  return displays.some(
    other =>
      other !== display &&
      verticalOverlap(display, other) > 0 &&
      (side === 'left' ? other.bounds.x + other.bounds.width : other.bounds.x) === edge
  )
}

/** The surface origin at the top of a display: centred, and flush with the
 *  housing on a notched panel (that is the notch itself) or just under the menu
 *  bar where there is none. */
/**
 * The housing's width in points, from its height.
 *
 * The cutout is a fixed number of panel pixels (~370 x 64), so its size in
 * points follows the display's scale: measured 185 x 32 at 1728-wide and
 * 220 x 38 at 2056-wide (crestnotch.app, notchbay.com) — a width:height ratio of
 * 5.78 in both. Electron exposes no safeAreaInsets, so the menu bar height is the
 * only measurement available and this converts it to the width beside it.
 */
export function islandNotchWidth(menuBarHeight: number): number {
  return Number.isFinite(menuBarHeight) && menuBarHeight > 0 ? Math.round(menuBarHeight * 5.785) : 0
}

export function islandDock(input: { display: IslandDisplay; platform: string; width: number }): { x: number; y: number } {
  const { display, platform, width } = input

  return {
    x: islandCentredX(display, Math.min(width, display.bounds.width)),
    y: islandHasNotch(display, platform) ? display.bounds.y : display.workArea.y + ISLAND_TOP_GAP
  }
}

/** Where the collapsed black pill sits inside that window. Flush with the top
 *  edge when there is a notch (so it is the notch), a hair below it when not. */
export function islandAnchor(notched: boolean) {
  return {
    height: notched ? ISLAND_NOTCH_HEIGHT : 30,
    radius: notched ? ISLAND_NOTCH_HEIGHT / 2 : 15,
    width: notched ? ISLAND_NOTCH_WIDTH : 132
  }
}
