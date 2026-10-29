import { describe, expect, it } from 'vitest'

import { islandSettleOffset, islandSettleTransform, SETTLE_LIMIT } from './island-settle'

describe('islandSettleOffset', () => {
  it('reads a release correction off the message', () => {
    expect(islandSettleOffset({ dx: 12, dy: -4 })).toEqual({ dx: 12, dy: -4 })
  })

  it('refuses anything that is not two finite numbers, so a bad event paints nothing', () => {
    expect(islandSettleOffset(null)).toBeNull()
    expect(islandSettleOffset(undefined)).toBeNull()
    expect(islandSettleOffset('12,4')).toBeNull()
    expect(islandSettleOffset({ dx: 12 })).toBeNull()
    expect(islandSettleOffset({ dx: Number.NaN, dy: 0 })).toBeNull()
  })

  it('is no correction at all when the release landed where it was dropped', () => {
    expect(islandSettleOffset({ dx: 0, dy: 0 })).toBeNull()
    // Rounding is what makes a sub-pixel residue a no-op rather than a jump.
    expect(islandSettleOffset({ dx: 0.4, dy: -0.4 })).toBeNull()
  })

  it('keeps the correction small enough to still read as landing rather than detaching', () => {
    expect(islandSettleOffset({ dx: 500, dy: -900 })).toEqual({ dx: SETTLE_LIMIT, dy: -SETTLE_LIMIT })
    expect(islandSettleOffset({ dx: 3.6, dy: -3.6 })).toEqual({ dx: 4, dy: -4 })
  })
})

describe('islandSettleTransform', () => {
  it('paints the travel of the snap and nothing else', () => {
    // Minus the correction: main already moved the window by it, so the surface
    // starts where the pointer let go. No scale — a dip on every release is the
    // bounce the user reported.
    expect(islandSettleTransform({ dx: 6, dy: -2 })).toBe('translate(-6px, 2px)')
  })

  it('is at rest with no correction', () => {
    expect(islandSettleTransform(null)).toBe('none')
  })

  it('honours reduced motion by never moving at all', () => {
    expect(islandSettleTransform({ dx: 6, dy: -2 }, true)).toBe('none')
  })
})
