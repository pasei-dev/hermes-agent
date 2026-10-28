import { describe, expect, it } from 'vitest'

import { DOCKED_RADIUS, islandShape, NOTCH_HEIGHT, NOTCH_WIDTH } from './island-view'

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
