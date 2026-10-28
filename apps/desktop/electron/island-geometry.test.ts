import { describe, expect, it } from 'vitest'

import {
  ISLAND_MAX_HEIGHT,
  ISLAND_MIN_HEIGHT,
  ISLAND_SIDE_MARGIN,
  ISLAND_TOP_GAP,
  ISLAND_WINDOW_WIDTH,
  islandWindowBounds,
  islandWindowHeight,
  islandWindowWidth
} from './island-geometry'

const DISPLAY = { height: 982, width: 1512, x: 0, y: 25 }

describe('island window geometry', () => {
  it('centres the window on the work area, eight pixels under its top edge', () => {
    const bounds = islandWindowBounds(DISPLAY, 120)

    expect(bounds).toEqual({
      height: 120,
      width: ISLAND_WINDOW_WIDTH,
      x: Math.round(DISPLAY.x + (DISPLAY.width - ISLAND_WINDOW_WIDTH) / 2),
      y: DISPLAY.y + ISLAND_TOP_GAP
    })
  })

  it('keeps the top edge fixed while the height changes, so an expanding pill never moves', () => {
    const collapsed = islandWindowBounds(DISPLAY, ISLAND_MIN_HEIGHT)
    const expanded = islandWindowBounds(DISPLAY, 420)

    expect(expanded.y).toBe(collapsed.y)
    expect(expanded.x).toBe(collapsed.x)
    expect(expanded.height).toBeGreaterThan(collapsed.height)
  })

  it('narrows on a display too small for the default width', () => {
    const narrow = { ...DISPLAY, width: 320 }

    expect(islandWindowWidth(narrow)).toBe(320 - ISLAND_SIDE_MARGIN * 2)
    expect(islandWindowBounds(narrow, 100).x).toBe(ISLAND_SIDE_MARGIN)
  })

  it('clamps a wild or stale height to the window and the display', () => {
    expect(islandWindowHeight(DISPLAY, 0)).toBe(ISLAND_MIN_HEIGHT)
    expect(islandWindowHeight(DISPLAY, Number.NaN)).toBe(ISLAND_MIN_HEIGHT)
    expect(islandWindowHeight(DISPLAY, 99_999)).toBe(ISLAND_MAX_HEIGHT)
    expect(islandWindowHeight({ ...DISPLAY, height: 200 }, 9_999)).toBe(200 - ISLAND_TOP_GAP * 2)
  })
})
