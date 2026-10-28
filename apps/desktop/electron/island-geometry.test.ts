import { describe, expect, it } from 'vitest'

import {
  ISLAND_NOTCH_HEIGHT,
  ISLAND_NOTCH_WIDTH,
  ISLAND_TOP_GAP,
  ISLAND_WINDOW_HEIGHT,
  ISLAND_WINDOW_WIDTH,
  islandAnchor,
  islandDock,
  islandDragTarget,
  islandHasNotch,
  islandSnapOrigin,
  islandWindowBounds
} from './island-geometry'

/** 14" MacBook Pro: menu bar is the housing height, so the work area starts 32pt down. */
const NOTCHED = {
  bounds: { height: 982, width: 1512, x: 0, y: 0 },
  workArea: { height: 950, width: 1512, x: 0, y: 32 }
}

/** Ordinary display: a ~24pt menu bar. */
const PLAIN = {
  bounds: { height: 1440, width: 2560, x: 0, y: 0 },
  workArea: { height: 1415, width: 2560, x: 0, y: 25 }
}

describe('islandHasNotch', () => {
  it('reads a tall menu bar as a camera housing on macOS', () => {
    expect(islandHasNotch(NOTCHED, 'darwin')).toBe(true)
  })

  it('never reads an ordinary menu bar as a notch — a false positive paints a black pill over it', () => {
    expect(islandHasNotch(PLAIN, 'darwin')).toBe(false)
  })

  it('never reads an external display as notched, however tall its menu bar', () => {
    const external = { ...NOTCHED, internal: false }

    expect(islandHasNotch(external, 'darwin')).toBe(false)
  })

  it('still reads the housing when the platform does not report the panel flag', () => {
    expect(islandHasNotch(NOTCHED, 'darwin')).toBe(true)
    expect(islandHasNotch({ ...NOTCHED, internal: true }, 'darwin')).toBe(true)
  })

  it('is macOS-only', () => {
    expect(islandHasNotch(NOTCHED, 'win32')).toBe(false)
    expect(islandHasNotch(NOTCHED, 'linux')).toBe(false)
  })
})

describe('islandWindowBounds', () => {
  it('starts at the top of a notched display, where the housing is', () => {
    const bounds = islandWindowBounds(NOTCHED, 'darwin')

    expect(bounds.y).toBe(0)
    expect(bounds.height).toBe(ISLAND_WINDOW_HEIGHT)
    expect(bounds.width).toBe(ISLAND_WINDOW_WIDTH)
    expect(bounds.x).toBe(Math.round((1512 - ISLAND_WINDOW_WIDTH) / 2))
  })

  it('starts below the menu bar elsewhere, and still centres', () => {
    const bounds = islandWindowBounds(PLAIN, 'darwin')

    expect(bounds.y).toBe(25 + ISLAND_TOP_GAP)
    expect(bounds.x).toBe(Math.round((2560 - ISLAND_WINDOW_WIDTH) / 2))
  })

  it('never asks for more width than the display has, and follows a display offset', () => {
    const small = {
      bounds: { height: 900, width: 400, x: 1512, y: 0 },
      workArea: { height: 875, width: 400, x: 1512, y: 25 }
    }

    const bounds = islandWindowBounds(small, 'darwin')

    expect(bounds.width).toBe(400)
    expect(bounds.x).toBe(1512)
  })
})

describe('islandDragTarget', () => {
  const window = { height: 560, width: 480, x: 136, y: 25 }

  const drag = (dx: number, dy: number, display = PLAIN, displays = [display]) =>
    islandDragTarget({ bounds: window, display, displays, dx, dy })

  it('follows the pointer exactly while it stays in bounds', () => {
    expect(drag(40, 30)).toEqual({ x: 176, y: 55 })
  })

  it('may hang over the menu bar but never off the screen', () => {
    expect(drag(-400, -400)).toEqual({ x: 0, y: 0 })
    expect(drag(4000, 0)).toEqual({ x: 2560 - 480, y: 25 })
  })

  it('can be parked anywhere down the screen, stopping only at the work area', () => {
    expect(drag(0, 4000).y).toBe(1440 - 560)
  })

  it('follows a display offset, so a second monitor is usable', () => {
    const display = {
      bounds: { height: 1440, width: 2560, x: 2560, y: -200 },
      workArea: { height: 1415, width: 2560, x: 2560, y: -175 }
    }

    const onSecond = (dx: number, dy: number) =>
      islandDragTarget({ bounds: { height: 560, width: 480, x: 2696, y: -175 }, display, displays: [display], dx, dy })

    expect(onSecond(0, 0)).toEqual({ x: 2696, y: -175 })
    expect(onSecond(0, -400)).toEqual({ x: 2696, y: -200 })
  })
})

/** A second display to the right, dropped 200pt so the seams do not line up. */
const OFFSET = {
  bounds: { height: 1440, width: 2560, x: 2560, y: -200 },
  workArea: { height: 1415, width: 2560, x: 2560, y: -175 }
}

/** A second display to the right with 200pt of desk and no screen between them. */
const GAPPED = {
  bounds: { height: 1440, width: 1280, x: 2760, y: 0 },
  workArea: { height: 1415, width: 1280, x: 2760, y: 25 }
}

describe('islandDragTarget across a two-display desktop', () => {
  const size = { height: 560, width: 480 }
  const DESK = [PLAIN, OFFSET]

  const drag = (from: { x: number; y: number }, dx: number, display: typeof PLAIN, displays = DESK) =>
    islandDragTarget({ bounds: { ...size, ...from }, display, displays, dx, dy: 0 })

  it('crosses the seam instead of stopping on it, even straddling both displays', () => {
    // The window is wider than half the seam, so the old per-display clamp
    // returned 2080 here and the pill could never be pushed across.
    expect(drag({ x: 2080, y: 100 }, 300, PLAIN)).toEqual({ x: 2380, y: 100 })
    expect(drag({ x: 2100, y: 100 }, 900, OFFSET)).toEqual({ x: 3000, y: 100 })
  })

  it('stops at the desktop outer edge, which is the far display edge', () => {
    expect(drag({ x: 136, y: 100 }, 99999, PLAIN)).toEqual({ x: 2560 + 2560 - 480, y: 100 })
    expect(drag({ x: 3000, y: 100 }, -99999, OFFSET)).toEqual({ x: 0, y: 100 })
  })

  it('floors y at the top of the desktop, not the top of the governing display', () => {
    // OFFSET starts 200pt higher, so the pill may follow the pointer up there.
    expect(islandDragTarget({ bounds: { ...size, x: 2100, y: 0 }, display: OFFSET, displays: DESK, dx: 0, dy: -400 })).toEqual({
      x: 2100,
      y: -200
    })
  })

  it('ceils y at the work area of the display under the window', () => {
    expect(islandDragTarget({ bounds: { ...size, x: 2100, y: 0 }, display: OFFSET, displays: DESK, dx: 0, dy: 4000 }).y).toBe(
      -175 + 1415 - 560
    )
    expect(islandDragTarget({ bounds: { ...size, x: 136, y: 0 }, display: PLAIN, displays: DESK, dx: 0, dy: 4000 }).y).toBe(
      25 + 1415 - 560
    )
  })

  it('reaches across a gap between displays, without inventing anything in it', () => {
    const split = [PLAIN, GAPPED]

    // 2560..2760 is desk with no screen on it; the drag passes over it.
    expect(drag({ x: 2080, y: 100 }, 520, PLAIN, split)).toEqual({ x: 2600, y: 100 })
    // Parked over the gap it stays put: the gap is not a wall, and not an edge.
    expect(drag({ x: 2600, y: 100 }, 0, GAPPED, split)).toEqual({ x: 2600, y: 100 })
    // The far edge is still the far display's, gap and all.
    expect(drag({ x: 2600, y: 100 }, 99999, GAPPED, split)).toEqual({ x: 2760 + 1280 - 480, y: 100 })
  })
})

describe('islandDock', () => {
  const anchor = { height: 560, width: 480, x: 20, y: 31 }
  const size = { height: 560, width: 480 }

  const dock = (x: number, y: number) => islandDock({ anchor, bounds: { ...size, x, y }, display: PLAIN })

  it('reads each edge a snapped window sits on', () => {
    expect(dock(20, 31)).toBe('top')
    expect(dock(0, 300)).toBe('left')
    expect(dock(2560 - 480, 300)).toBe('right')
    expect(dock(700, 1440 - 560)).toBe('bottom')
  })

  it('reads open space as free', () => {
    expect(dock(700, 400)).toBe('free')
  })
})

describe('islandSnapOrigin', () => {
  const anchor = { height: 560, width: 480, x: 20, y: 31 }
  const size = { height: 560, width: 480 }

  const snap = (x: number, y: number) => islandSnapOrigin({ anchor, bounds: { ...size, x, y }, display: PLAIN })

  it('docks to the top edge, centred, when released near it', () => {
    expect(snap(900, 40)).toEqual({ x: 20, y: 31 })
  })

  it('docks flush to a side edge and keeps the height it was dropped at', () => {
    expect(snap(12, 200)).toEqual({ x: 0, y: 200 })
    expect(snap(2072, 200)).toEqual({ x: 2560 - 480, y: 200 })
  })

  it('docks to the bottom of the work area', () => {
    expect(snap(900, 870)).toEqual({ x: 900, y: 1440 - 560 })
  })

  it('leaves a drop in open space exactly where it was let go', () => {
    expect(snap(700, 400)).toEqual({ x: 700, y: 400 })
  })
})

describe('islandDock and islandSnapOrigin across a two-display desktop', () => {
  const DESK = [PLAIN, OFFSET]
  const split = [PLAIN, GAPPED]
  const size = { height: 560, width: 480 }
  /** The island's resting anchor on the second display, 200pt higher. */
  const anchor = { height: 560, width: 480, x: 3600, y: -169 }

  const drop = (x: number, y: number, display: typeof PLAIN, displays = DESK) =>
    islandSnapOrigin({ anchor, bounds: { ...size, x, y }, display, displays })

  const dock = (x: number, y: number, display: typeof PLAIN, displays = DESK) =>
    islandDock({ anchor, bounds: { ...size, x, y }, display, displays })

  it('leaves a drop near the seam alone — the seam is not an edge, so nothing moves', () => {
    // 2090 is 10pt from the old per-display right edge (2080), so the
    // single-display snap pulled the pill back on release.
    expect(drop(2090, 300, PLAIN)).toEqual({ x: 2090, y: 300 })
    expect(drop(2600, 300, GAPPED, split)).toEqual({ x: 2600, y: 300 })
  })

  it('attaches to the desktop outer edge, on the far display', () => {
    expect(drop(4650, 300, OFFSET)).toEqual({ x: 2560 + 2560 - 480, y: 300 })
    expect(drop(10, 300, PLAIN)).toEqual({ x: 0, y: 300 })
  })

  it('still docks to a side of the work area the window is on', () => {
    expect(drop(1000, 880, PLAIN)).toEqual({ x: 1000, y: 25 + 1415 - 560 })
    expect(drop(1000, -160, OFFSET)).toEqual({ x: 3600, y: -169 })
  })

  it('reads a window on the seam, or over the gap, as free rather than attached to a side', () => {
    expect(dock(2560, 300, OFFSET)).toBe('free')
    expect(dock(2600, 300, GAPPED, split)).toBe('free')
    expect(dock(2560 + 2560 - 480, 300, OFFSET)).toBe('right')
  })
})

describe('islandAnchor', () => {
  it('rests as the notch itself on a notched display, and flush with the top edge', () => {
    expect(islandAnchor(true)).toEqual({
      height: ISLAND_NOTCH_HEIGHT,
      radius: ISLAND_NOTCH_HEIGHT / 2,
      width: ISLAND_NOTCH_WIDTH
    })
  })

  it('rests as a small floating pill where there is no notch', () => {
    expect(islandAnchor(false).width).toBeLessThan(ISLAND_NOTCH_WIDTH)
    expect(islandAnchor(false).radius).toBeLessThan(ISLAND_NOTCH_HEIGHT / 2)
  })
})
