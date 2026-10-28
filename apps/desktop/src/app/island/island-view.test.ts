import { describe, expect, it } from 'vitest'

import {
  DOCKED_RADIUS,
  islandClipPath,
  islandCorners,
  islandGooBlur,
  islandLeash,
  islandShape,
  islandSurfaceTransform,
  LEASH_BAND,
  NOTCH_HEIGHT,
  NOTCH_WIDTH
} from './island-view'

describe('islandShape', () => {
  it('rests as the notch itself on a notched display — that is the autohide', () => {
    expect(islandShape({ notched: true, rows: 0, stage: 'hidden' })).toEqual({
      bottomOnly: true,
      height: NOTCH_HEIGHT,
      mode: 'notch',
      opacity: 1,
      radius: DOCKED_RADIUS,
      top: 0,
      width: NOTCH_WIDTH
    })
  })

  it('squares the resting pill off against the housing, and keeps it docked there', () => {
    const docked = islandShape({ notched: true, rows: 0, stage: 'hidden' })
    const floating = islandShape({ notched: false, rows: 0, stage: 'hidden' })

    // Squarer than the floating pill's full round, so the docked state reads as
    // pressed into the housing rather than as another floating bubble.
    expect(docked.radius).toBeLessThan(docked.height / 2)
    expect(floating.radius).toBe(floating.height / 2)
  })

  it('starts every grown state BELOW the housing, and the resting pill inside it', () => {
    for (const stage of ['attention', 'expanded', 'session'] as const) {
      expect(islandShape({ notched: true, rows: 2, stage }).top, stage).toBe(NOTCH_HEIGHT)
    }

    // The pill IS the housing on a notched display; where there is no housing
    // there is nothing to clear, so only the notched case pays the offset.
    expect(islandShape({ notched: true, rows: 2, stage: 'pill' }).top).toBe(0)
    expect(islandShape({ notched: true, rows: 0, stage: 'hidden' }).top).toBe(0)

    for (const stage of ['attention', 'expanded', 'session'] as const) {
      expect(islandShape({ notched: false, rows: 2, stage }).top, stage).toBe(0)
    }
  })

  it('is fully invisible when idle with no housing to hide inside', () => {
    const shape = islandShape({ notched: false, rows: 0, stage: 'hidden' })

    expect(shape.opacity).toBe(0)
    expect(shape.width).toBeLessThan(NOTCH_WIDTH)
  })

  it('rests as the housing exactly while something runs, and widens only on hover', () => {
    const bare = islandShape({ notched: true, rows: 2, stage: 'pill' })
    const rich = islandShape({ notched: true, rich: true, rows: 2, stage: 'pill' })
    const attention = islandShape({ notched: true, rows: 2, stage: 'attention' })

    // Idle is the notch: the housing's own width and height, so nothing is
    // painted over the menu bar either side of it.
    expect(bare.width).toBe(NOTCH_WIDTH)
    expect(bare.height).toBe(NOTCH_HEIGHT)

    // Hover widens SIDEWAYS into those wings and keeps the housing's height.
    expect(rich.width).toBeGreaterThan(bare.width)
    expect(rich.width).toBeLessThan(attention.width)
    expect(rich.height).toBe(bare.height)
  })

  it('grows out of the notch as the stage rises, and never shrinks back', () => {
    const pill = islandShape({ notched: true, rich: true, rows: 2, stage: 'pill' })
    const attention = islandShape({ notched: true, rows: 2, stage: 'attention' })
    // A two-row list is shorter than a card, and that is allowed: the list earns
    // its height from rows, the card from content.
    const expanded = islandShape({ notched: true, rows: 8, stage: 'expanded' })

    expect(pill.width).toBeGreaterThan(NOTCH_WIDTH)
    expect(attention.height).toBeGreaterThan(pill.height)
    expect(expanded.width).toBeGreaterThan(attention.width)
    expect(expanded.height).toBeGreaterThan(attention.height)
  })

  it('grows with the number of rows, and stops at a ceiling', () => {
    const two = islandShape({ notched: false, rows: 2, stage: 'expanded' })
    const five = islandShape({ notched: false, rows: 5, stage: 'expanded' })
    const many = islandShape({ notched: false, rows: 40, stage: 'expanded' })

    expect(five.height).toBeGreaterThan(two.height)
    expect(many.height).toBe(420)
  })

  it('gives one open session the panel the chat view needs, and the largest one', () => {
    const session = islandShape({ notched: true, rows: 0, stage: 'session' })
    const expanded = islandShape({ notched: true, rows: 8, stage: 'expanded' })
    const attention = islandShape({ notched: true, rows: 0, stage: 'attention' })

    // The session stage mounts the app's own chat surface: a panel of a fixed
    // size, not a band that grows per transcript line.
    // The panel plus the housing band it grows out of.
    expect(session.height).toBe(546 + NOTCH_HEIGHT)
    expect(session.width).toBe(478)
    expect(session.height).toBeGreaterThan(expanded.height)
    expect(session.height).toBeGreaterThan(attention.height)
    // Still inside the island window, or the surface would be clipped by it.
    expect(session.width).toBeLessThanOrEqual(480)
    expect(session.height).toBeLessThanOrEqual(620)
  })

  it('keeps an empty expanded list short enough to still look like a control', () => {
    const empty = islandShape({ notched: false, rows: 0, stage: 'expanded' })

    expect(empty.height).toBeLessThan(140)
    expect(empty.opacity).toBe(1)
    expect(empty.mode).toBe('expanded')
  })
})

describe('islandClipPath', () => {
  it('clips the notch surface to the housing, with a concave top fillet', () => {
    const notch = islandShape({ notched: true, rows: 0, stage: 'hidden' })

    // The top edge is the housing's full width, the sides flare in by the fillet
    // as they leave it, and the bottom keeps the resting radius.
    expect(islandClipPath(notch)).toBe(
      'path("M0 0H208Q198 0 198 10V22Q198 32 188 32H20Q10 32 10 22V10Q10 0 0 0Z")'
    )
  })

  it('is worn by every surface that IS the housing, and by nothing else', () => {
    expect(islandClipPath(islandShape({ notched: true, rows: 0, stage: 'pill' }))).not.toBeNull()
    // Hover widens past the housing, and a grown surface reaches the menu bar
    // either side of it: a flare there would scoop the corner out of a bar.
    expect(islandClipPath(islandShape({ notched: true, rich: true, rows: 0, stage: 'pill' }))).toBeNull()
    expect(islandClipPath(islandShape({ notched: true, rows: 2, stage: 'attention' }))).toBeNull()
    expect(islandClipPath(islandShape({ notched: true, rows: 0, stage: 'session' }))).toBeNull()
    // No housing, no notch: a floating pill is an ordinary rounded corner.
    expect(islandClipPath(islandShape({ notched: false, rows: 0, stage: 'hidden' }))).toBeNull()
    expect(islandClipPath(islandShape({ notched: false, rows: 3, stage: 'expanded' }))).toBeNull()
  })

  it('follows the housing it is given, so a shorter menu bar clips shorter', () => {
    const shallow = islandShape({ notchHeight: 24, notched: true, rows: 0, stage: 'hidden' })
    const path = islandClipPath(shallow)

    // The fillet shrinks with the height (24 / 3), and the bottom radius stays.
    expect(path).toBe('path("M0 0H208Q200 0 200 8V14Q200 24 190 24H18Q8 24 8 14V8Q8 0 0 0Z")')
    // A fillet may take a third of the height at most, so a body and a bottom
    // corner both survive however short the housing is.
    const flat = islandClipPath({ ...shallow, height: 12 }) ?? ''
    expect(flat).toContain('V4')
    expect(flat).not.toContain('NaN')
  })

  it('lands the top corners on the screen edge and squares the bottom radius off', () => {
    const path = islandClipPath(islandShape({ notched: true, rows: 0, stage: 'hidden' })) ?? ''

    // Both antialiasing-free facts a path can be held to: it starts at the top
    // left of the element and closes on itself.
    expect(path.startsWith('path("M0 0')).toBe(true)
    expect(path.endsWith('Z")')).toBe(true)
    expect(path).toContain(`V${NOTCH_HEIGHT - DOCKED_RADIUS}`)
  })
})

describe('islandSurfaceTransform', () => {
  const still = { dragging: false, paint: '', settle: null, visible: true }

  it('lifts a dragged surface, and carries whatever the leash is painting', () => {
    expect(islandSurfaceTransform({ ...still, dragging: true })).toBe('scale(1.03, 1.28)')
    expect(islandSurfaceTransform({ ...still, dragging: true, paint: 'translateY(12px)' })).toBe(
      'scale(1.03, 1.28) translateY(12px)'
    )
  })

  it('never lets a release correction that arrives mid-gesture drop the lift', () => {
    // Main debounces the settle from the last pointer move, so a paused drag is
    // sent one while the pointer is still down.
    const paused = islandSurfaceTransform({ ...still, dragging: true, settle: 'translate(0px, 0px) scale(0.94)' })

    expect(paused).toBe('scale(1.03, 1.28)')
    expect(paused).not.toContain('0.94')
  })

  it('paints the dip once the surface is released, and rests when it is over', () => {
    expect(islandSurfaceTransform({ ...still, settle: 'translate(0px, 0px) scale(0.94)' })).toBe(
      'translate(0px, 0px) scale(0.94)'
    )
    expect(islandSurfaceTransform(still)).toBe('none')
    expect(islandSurfaceTransform({ ...still, visible: false })).toBe('scale(0.92)')
  })
})

describe('islandCorners', () => {
  it('squares the corners against the edge the surface is on', () => {
    expect(islandCorners(10, 'top')).toBe('0 0 10px 10px')
    expect(islandCorners(10, 'bottom')).toBe('10px 10px 0 0')
    expect(islandCorners(10, 'left')).toBe('0 10px 10px 0')
    expect(islandCorners(10, 'right')).toBe('10px 0 0 10px')
    expect(islandCorners(10, 'free')).toBe('10px')
  })
})

describe('islandLeash', () => {
  it('starts at the anchor and never runs away from it', () => {
    expect(islandLeash(0)).toBe(0)
    // The rubber band flattens toward c·L rather than following the pointer 1:1.
    expect(islandLeash(80)).toBeLessThan(80)
    expect(islandLeash(80)).toBeCloseTo((80 * 0.55 * 80) / (80 + 0.55 * 80), 6)
    // The rubber-band part alone never reaches c·L + L: the leash holds.
    expect(islandLeash(LEASH_BAND)).toBeLessThan(0.55 * LEASH_BAND + 1)
  })

  it('is monotone, and takes a negative travel as a negative lag', () => {
    let last = -1

    for (const travel of [0, 1, 10, 40, 79, 80]) {
      const d = islandLeash(travel)

      expect(d).toBeGreaterThan(last)
      last = d
    }

    expect(islandLeash(-30)).toBe(-islandLeash(30))
  })

  it('tracks the pointer one for one past the band', () => {
    const band = islandLeash(LEASH_BAND)
    const one = islandLeash(LEASH_BAND + 10)

    // Slope exactly 1: the leash is cut, and the surplus travel is the pointer's.
    expect(one - band).toBeCloseTo(10, 6)
    expect((islandLeash(LEASH_BAND + 10) - islandLeash(LEASH_BAND + 9)) / 1).toBeCloseTo(1, 6)
  })
})

describe('islandGooBlur', () => {
  it('thickens with the gap and dissolves at the ceiling', () => {
    expect(islandGooBlur(0)).toBe(0)
    expect(islandGooBlur(10)).toBeLessThan(islandGooBlur(20))
    // Bigger blur = the neck forms further out; the filter stops paying for it.
    expect(islandGooBlur(1000)).toBe(6)
    expect(islandGooBlur(-12)).toBe(islandGooBlur(12))
  })
})
