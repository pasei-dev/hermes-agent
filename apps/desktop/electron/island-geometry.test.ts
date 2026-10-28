import { describe, expect, it } from 'vitest'

import {
  ISLAND_EDGE_SNAP,
  ISLAND_NOTCH_HEIGHT,
  ISLAND_NOTCH_WIDTH,
  ISLAND_TOP_GAP,
  ISLAND_WINDOW_HEIGHT,
  ISLAND_WINDOW_WIDTH,
  islandAnchor,
  islandDisplayUnder,
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
  /** The resting pill on a notched panel: the notch itself. */
  const PILL = { height: 34, width: 236 }
  const pillAt = (x: number, y: number) => ({ ...PILL, x, y })

  const drag = (surface: { height: number; width: number; x: number; y: number }, dx: number, dy: number, displays = [PLAIN]) =>
    islandDragTarget({ dx, dy, displays, platform: 'darwin', surface })

  it('follows the pointer exactly while it stays away from every edge', () => {
    expect(drag(pillAt(1000, 300), 40, 30)).toEqual({ x: 1040, y: 330 })
  })

  it('reaches the right edge and the bottom of the work area — the window is not the island', () => {
    // The pill is 236 wide inside a 480-wide window: clamping the WINDOW left it
    // 122 points short of the edge it was dragged at.
    expect(drag(pillAt(1000, 300), 4000, 0).x).toBe(2560 - PILL.width)
    expect(drag(pillAt(1000, 300), -4000, 0).x).toBe(0)
    expect(drag(pillAt(1000, 300), 0, 4000).y).toBe(25 + 1415 - PILL.height)
    expect(drag(pillAt(1000, 300), 0, -4000).y).toBe(0)
  })

  it('a drop 10px from the top lands flush and centred on the housing', () => {
    // Notched: the top of the display is the notch, and the pill must land
    // exactly in it rather than 10px under it.
    expect(drag(pillAt(500, 10), 0, 0, [NOTCHED])).toEqual({
      x: Math.round((1512 - PILL.width) / 2),
      y: 0
    })
  })

  it('docks under the menu bar where there is no housing', () => {
    expect(drag(pillAt(500, 30), 0, 0)).toEqual({
      x: Math.round((2560 - PILL.width) / 2),
      y: 25 + ISLAND_TOP_GAP
    })
  })

  it('is not docked once it is dragged clear of the top', () => {
    expect(drag(pillAt(500, 300), 0, 0)).toEqual({ x: 500, y: 300 })
  })

  it('snaps flush to a side edge from either side of the threshold', () => {
    const near = drag(pillAt(2560 - PILL.width - 10, 300), 0, 0)

    expect(near.x).toBe(2560 - PILL.width)
    expect(drag(pillAt(ISLAND_EDGE_SNAP + 1, 300), 0, 0).x).toBe(ISLAND_EDGE_SNAP + 1)
    expect(drag(pillAt(10, 300), 0, 0).x).toBe(0)
  })

  it('treats the boundary two displays share as a seam, not an edge', () => {
    const right = { ...PLAIN, bounds: { height: 1440, width: 1920, x: 2560, y: 0 }, workArea: { height: 1415, width: 1920, x: 2560, y: 25 } }
    // 15px from the seam at x=2560, on both sides of it: a pill pulled flush
    // here would park in the middle of the desk.
    expect(drag(pillAt(2560 - PILL.width - 15, 300), 0, 0, [PLAIN, right]).x).toBe(2560 - PILL.width - 15)
    expect(drag(pillAt(2560 + 15, 300), 0, 0, [PLAIN, right]).x).toBe(2560 + 15)
  })

  it('still snaps to the far edge of a two-display desk', () => {
    const right = { ...PLAIN, bounds: { height: 1440, width: 1920, x: 2560, y: 0 }, workArea: { height: 1415, width: 1920, x: 2560, y: 25 } }

    expect(drag(pillAt(2560 + 1920 - PILL.width - 8, 300), 0, 0, [PLAIN, right]).x).toBe(2560 + 1920 - PILL.width)
  })

  it('follows a display offset, so a second monitor is usable', () => {
    const second = {
      bounds: { height: 1440, width: 2560, x: 2560, y: -200 },
      workArea: { height: 1415, width: 2560, x: 2560, y: -175 }
    }

    expect(drag(pillAt(2696, 100), 0, 0, [second])).toEqual({ x: 2696, y: 100 })
    expect(drag(pillAt(2696, 100), 0, -250, [second]).y).toBe(-175 + ISLAND_TOP_GAP)
  })

  it('lets the pill leave one display and cross onto the next on its way', () => {
    const right = { ...PLAIN, bounds: { height: 1440, width: 1920, x: 2560, y: 0 }, workArea: { height: 1415, width: 1920, x: 2560, y: 25 } }

    expect(drag(pillAt(2560 - PILL.width, 300), 600, 0, [PLAIN, right]).x).toBe(2560 - PILL.width + 600)
  })
})

describe('islandDock', () => {
  it('is the notch itself on a housing, centred and flush with the top', () => {
    expect(islandDock({ display: NOTCHED, platform: 'darwin', width: ISLAND_NOTCH_WIDTH })).toEqual({
      x: Math.round((1512 - ISLAND_NOTCH_WIDTH) / 2),
      y: NOTCHED.bounds.y
    })
  })

  it('sits under the menu bar where there is none', () => {
    expect(islandDock({ display: PLAIN, platform: 'darwin', width: 236 }).y).toBe(PLAIN.workArea.y + ISLAND_TOP_GAP)
  })
})

describe('islandSnapOrigin', () => {
  it('moves nothing it is not asked to', () => {
    expect(islandSnapOrigin({ displays: [PLAIN], rect: { height: 34, width: 236, x: 900, y: 300 } })).toEqual({
      x: 900,
      y: 300
    })
  })

  it('pulls flush to the left edge and keeps the y it was given', () => {
    expect(
      islandSnapOrigin({ displays: [PLAIN], rect: { height: 34, width: 236, x: 12, y: 300 } })
    ).toEqual({ x: 0, y: 300 })
  })
})

describe('islandDisplayUnder', () => {
  it('is the display the rect covers most of', () => {
    const right = { ...PLAIN, bounds: { height: 1440, width: 1920, x: 2560, y: 0 }, workArea: { height: 1415, width: 1920, x: 2560, y: 25 } }

    expect(islandDisplayUnder({ height: 34, width: 236, x: 2400, y: 300 }, [PLAIN, right])).toBe(PLAIN)
    expect(islandDisplayUnder({ height: 34, width: 236, x: 2600, y: 300 }, [PLAIN, right])).toBe(right)
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
