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
export const ISLAND_WINDOW_HEIGHT = 560
/** The notch-shaped resting pill — roughly a 14" MacBook Pro's notch. */
export const ISLAND_NOTCH_WIDTH = 208
export const ISLAND_NOTCH_HEIGHT = 32
/** Clearance under the menu bar on displays that have no notch. */
export const ISLAND_TOP_GAP = 6

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
    x: Math.round(display.bounds.x + (display.bounds.width - Math.min(ISLAND_WINDOW_WIDTH, display.bounds.width)) / 2),
    y: top
  }
}

/**
 * Where a drag may put the window.
 *
 * The island is the user's to move only where there is no housing, and that
 * freedom is bounded: it may hang over the menu bar (that is the point of a
 * floating pill) but never off the display, and never far enough down to become
 * a second HUD.
 */
export function islandDragTarget(input: {
  bounds: { height: number; width: number; x: number; y: number }
  display: IslandDisplay
  dx: number
  dy: number
}): { x: number; y: number } {
  const { bounds, display, dx, dy } = input
  const minX = display.bounds.x
  const maxX = display.bounds.x + display.bounds.width - bounds.width
  const minY = display.bounds.y
  // The whole work area: the island is the user's to park, and a 200pt ceiling
  // read as a drag that fought the pointer a quarter of the way down.
  const maxY = Math.max(minY, display.workArea.y + display.workArea.height - bounds.height)

  return {
    x: Math.round(Math.min(maxX, Math.max(minX, bounds.x + dx))),
    y: Math.round(Math.min(maxY, Math.max(minY, bounds.y + dy)))
  }
}

/** Which edge the island is attached to, once a drop has snapped. */
export type IslandDock = 'bottom' | 'free' | 'left' | 'right' | 'top'

/** The edge a snapped origin sits on, or `free` in open space. */
export function islandDock(input: {
  anchor: { x: number; y: number }
  bounds: { height: number; width: number; x: number; y: number }
  display: IslandDisplay
}): IslandDock {
  const { anchor, bounds, display } = input
  const bottom = display.workArea.y + display.workArea.height - bounds.height

  if (Math.abs(bounds.y - anchor.y) <= 1) {
    return 'top'
  }

  if (Math.abs(bounds.y - bottom) <= 1) {
    return 'bottom'
  }

  if (Math.abs(bounds.x - display.bounds.x) <= 1) {
    return 'left'
  }

  if (Math.abs(bounds.x - (display.bounds.x + display.bounds.width - bounds.width)) <= 1) {
    return 'right'
  }

  return 'free'
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

/** How close to an edge a dropped island must be to attach to it, in px. */
export const ISLAND_EDGE_SNAP = 30

/**
 * Where a dropped island lands.
 *
 * Released near an edge, it attaches: flush to that edge, and flush-and-centred
 * on the top edge, which is the notch anchor — so "put it back" is a short drag
 * up rather than a hunt for the exact origin. Released anywhere else it stays
 * where the pointer left it. Each axis is judged on its own, which makes a
 * corner land in the corner instead of picking one edge and dropping the other.
 */
export function islandSnapOrigin(input: {
  anchor: { x: number; y: number }
  bounds: { height: number; width: number; x: number; y: number }
  display: IslandDisplay
}): { x: number; y: number } {
  const { anchor, bounds, display } = input
  const left = display.bounds.x
  const right = display.bounds.x + display.bounds.width - bounds.width
  const top = anchor.y
  const bottom = display.workArea.y + display.workArea.height - bounds.height

  const nearTop = Math.abs(bounds.y - top) <= ISLAND_EDGE_SNAP
  const nearBottom = !nearTop && Math.abs(bounds.y - bottom) <= ISLAND_EDGE_SNAP
  const nearLeft = Math.abs(bounds.x - left) <= ISLAND_EDGE_SNAP
  const nearRight = !nearLeft && Math.abs(bounds.x - right) <= ISLAND_EDGE_SNAP

  // The top edge owns the centre: a top dock that kept a side's x would sit off
  // the housing it is meant to be.
  const x = nearTop ? anchor.x : nearLeft ? left : nearRight ? right : bounds.x
  const y = nearTop ? top : nearBottom ? bottom : bounds.y

  return { x: Math.round(x), y: Math.round(y) }
}
