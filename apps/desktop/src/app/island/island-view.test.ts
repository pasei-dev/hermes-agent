import { describe, expect, it } from 'vitest'

import { islandShape, NOTCH_HEIGHT, NOTCH_WIDTH } from './island-view'

describe('islandShape', () => {
  it('rests as the notch itself on a notched display — that is the autohide', () => {
    expect(islandShape({ notched: true, rows: 0, stage: 'hidden' })).toEqual({
      height: NOTCH_HEIGHT,
      mode: 'notch',
      opacity: 1,
      radius: NOTCH_HEIGHT / 2,
      width: NOTCH_WIDTH
    })
  })

  it('is fully invisible when idle with no housing to hide inside', () => {
    const shape = islandShape({ notched: false, rows: 0, stage: 'hidden' })

    expect(shape.opacity).toBe(0)
    expect(shape.width).toBeLessThan(NOTCH_WIDTH)
  })

  it('widens the pill for an activity line, but stays short of the attention card', () => {
    const bare = islandShape({ notched: true, rows: 2, stage: 'pill' })
    const rich = islandShape({ notched: true, rich: true, rows: 2, stage: 'pill' })
    const attention = islandShape({ notched: true, rows: 2, stage: 'attention' })

    expect(rich.width).toBeGreaterThan(bare.width)
    expect(rich.width).toBeLessThan(attention.width)
    expect(rich.height).toBe(bare.height)
  })

  it('grows out of the notch as the stage rises, and never shrinks back', () => {
    const pill = islandShape({ notched: true, rows: 2, stage: 'pill' })
    const attention = islandShape({ notched: true, rows: 2, stage: 'attention' })
    const expanded = islandShape({ notched: true, rows: 2, stage: 'expanded' })

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

  it('gives one open session its own height, one band per line of transcript', () => {
    const one = islandShape({ notched: true, rows: 1, stage: 'session' })
    const four = islandShape({ notched: true, rows: 4, stage: 'session' })
    const many = islandShape({ notched: true, rows: 40, stage: 'session' })

    expect(four.height).toBeGreaterThan(one.height)
    // Never taller than the four lines it shows: a peek that runs to the bottom of the
    // screen is the window it exists to avoid.
    expect(many.height).toBe(four.height)
    expect(four.width).toBeLessThan(islandShape({ notched: true, rows: 4, stage: 'expanded' }).width)
  })

  it('keeps an empty expanded list short enough to still look like a control', () => {
    const empty = islandShape({ notched: false, rows: 0, stage: 'expanded' })

    expect(empty.height).toBeLessThan(140)
    expect(empty.opacity).toBe(1)
    expect(empty.mode).toBe('expanded')
  })
})
