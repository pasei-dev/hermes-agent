// Where the Dynamic Island sits and how big its window is.
//
// Electron-free so the placement contract is unit-testable — the same split as
// `wake-indicator.ts`, and for the same reason: a wrong origin is invisible
// until it is on someone's screen.
//
// The window is ONE rectangle for the whole session, and the island animates
// inside it. Resizing a transparent always-on-top window per animation frame is
// what makes a web island stutter — every `setBounds` is a synchronous round
// trip to the compositor — so the rectangle is set when the window opens and
// when the user resizes it, never while a stage changes shape. It opens at the
// session size, because a session stage is a chat panel with a composer and the
// 480x620 rectangle clamped it; the user may shrink it back to that rectangle
// and grow it to the edge of the display, and the top edge never moves while it
// happens. The area the surface does not cover is click-through (see the
// renderer's hit test), so a big transparent window costs nothing but the
// pixels it never paints.
//
// On a notched MacBook the panel starts at the very top of the display and is
// raised above the menu bar, because that is where the notch is: the collapsed
// pill is notch-shaped and sits exactly over it, so "hidden" reads as the notch
// itself rather than as a floating bar. Everywhere else the panel starts below
// the menu bar and can be dragged.

export const ISLAND_DEFAULT_WIDTH = 600
/** Tall enough for the session panel and its composer, which the old 480x620
 *  rectangle clamped: the window was the ceiling on a stage that is a chat. */
export const ISLAND_DEFAULT_HEIGHT = 820
/**
 * The floor the user may shrink the window to.
 *
 * It is exactly the rectangle the other stages were designed against: the
 * widest of them is the answer card at 452 and the tallest is the session panel
 * at 546 under a 34pt housing band — 620. Shrinking below that clips a stage
 * that has nowhere else to go, so the floor is the old window rather than a
 * guess.
 */
export const ISLAND_MIN_WIDTH = 480
export const ISLAND_MIN_HEIGHT = 620
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

export interface IslandSize {
  height: number
  width: number
}

/** How small and how large the window may be on one display. */
export interface IslandResizeLimits {
  maxHeight: number
  maxWidth: number
  minHeight: number
  minWidth: number
}

/**
 * The resize limits for a window whose top edge is at `top`.
 *
 * Downward is the only direction a taller window can go, so what the display
 * has left below that line is the ceiling — on a notched panel that is the
 * whole screen, because the island hangs from the very top of it. The floor is
 * `ISLAND_MIN_*`, or the ceiling itself on a display too small to honour it.
 */
export function islandResizeLimits(input: { display: IslandDisplay; top: number }): IslandResizeLimits {
  const { display, top } = input
  const maxHeight = Math.max(1, Math.round(display.bounds.y + display.bounds.height - top))
  const maxWidth = Math.max(1, Math.round(display.bounds.width))

  return {
    maxHeight,
    maxWidth,
    minHeight: Math.min(ISLAND_MIN_HEIGHT, maxHeight),
    minWidth: Math.min(ISLAND_MIN_WIDTH, maxWidth)
  }
}

/** A requested size, brought inside the display's floor and ceiling. */
export function islandClampSize(input: { display: IslandDisplay; size: IslandSize; top: number }): IslandSize {
  const limits = islandResizeLimits(input)

  return {
    height: clamp(input.size.height, limits.minHeight, limits.maxHeight),
    width: clamp(input.size.width, limits.minWidth, limits.maxWidth)
  }
}

/**
 * The window rect for a new size, hung from its current top edge and centre.
 *
 * Growing happens downward: the top edge stays on the display's top (the
 * housing) and the x stays on the centre line, so the surface stays attached to
 * the housing while the panel grows away from it. Only the bottom edge travels,
 * which is why the drag clamp never has to re-derive the anchor.
 */
export function islandResizedBounds(input: { current: IslandRect; display: IslandDisplay; size: IslandSize }): IslandRect {
  const { current, display } = input
  const size = islandClampSize({ display, size: input.size, top: current.y })

  return {
    height: size.height,
    width: size.width,
    x: Math.round(current.x + current.width / 2 - size.width / 2),
    y: Math.round(current.y)
  }
}

export function islandWindowBounds(
  display: IslandDisplay,
  platform: string,
  size: IslandSize = { height: ISLAND_DEFAULT_HEIGHT, width: ISLAND_DEFAULT_WIDTH }
): IslandRect {
  const notched = islandHasNotch(display, platform)
  const top = notched ? display.bounds.y : display.workArea.y + ISLAND_TOP_GAP
  const clamped = islandClampSize({ display, size, top })

  return {
    height: clamped.height,
    width: clamped.width,
    x: islandCentredX(display, clamped.width),
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

/** The edge a docked surface is attached to, as the renderer paints it. `free`
 *  is an island that sits on no edge at all. */
export type IslandDockSide = 'bottom' | 'free' | 'left' | 'right' | 'top'

/**
 * How close to an edge still counts as attached.
 *
 * A snap puts the surface exactly on the edge, so this only absorbs the rounding
 * a hand-driven drag leaves behind — a few points, not the 30 that pull a drag
 * flush.
 */
export const ISLAND_DOCK_TOLERANCE = 2

/**
 * Which display edge a surface is attached to, if any.
 *
 * The renderer cannot see where its window is, so this is the only way it learns
 * it is docked — the drop, the corners and the housing inset all key off the
 * answer. The edges are the ones `islandDragTarget` clamps to, so the side and
 * the clamp agree: the desktop's outer edges on each axis, plus the top of the
 * display the surface is on (the notch) and that display's work-area bottom. A
 * surface flush with the seam between two displays is on no edge of the desktop,
 * and reads `free`.
 */
export function islandDockSide(input: { displays: IslandDisplay[]; platform: string; rect: IslandRect }): IslandDockSide {
  const { displays, platform, rect } = input

  if (displays.length === 0) {
    return 'free'
  }

  const under = islandDisplayUnder(rect, displays) ?? islandNearestDisplay(rect, displays)
  const near = (value: number, edge: number) => Math.abs(value - edge) <= ISLAND_DOCK_TOLERANCE

  // The top is asked first: on a notched panel it is the housing the island
  // exists to fill, and it is the one edge a snap always reaches.
  if (under) {
    const top = islandDock({ display: under, platform, width: rect.width }).y

    if (near(rect.y, top)) {
      return 'top'
    }
  }

  const bottom = under ? under.workArea.y + under.workArea.height - rect.height : null

  if (bottom != null && near(rect.y, bottom)) {
    return 'bottom'
  }

  if (near(rect.x, Math.min(...displays.map(display => display.bounds.x)))) {
    return 'left'
  }

  if (near(rect.x + rect.width, Math.max(...displays.map(display => display.bounds.x + display.bounds.width)))) {
    return 'right'
  }

  return 'free'
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
