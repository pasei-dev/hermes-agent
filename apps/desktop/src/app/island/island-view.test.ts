import { describe, expect, it } from 'vitest'

import {
  DOCKED_RADIUS,
  GOO_BLEED,
  HOVER_WIDTH,
  islandClipPath,
  islandContentInset,
  islandCorners,
  islandGooLayer,
  islandLeash,
  islandShape,
  islandSurfaceTransform,
  LEASH_BAND,
  NOTCH_FILLET,
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
      // The housing plus the flare on either side of it — the width the band is
      // DRAWN at, which is wider than the cutout it sits in.
      width: NOTCH_WIDTH + NOTCH_FILLET * 2
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

    // A running session must be visible without a hover, and the housing itself
    // is opaque: the band is wider than it so the dot lands in a wing, while it
    // keeps the housing's height so nothing is painted under the menu bar.
    expect(bare.width).toBeGreaterThan(NOTCH_WIDTH)
    expect(bare.height).toBe(NOTCH_HEIGHT)

    // Hover widens SIDEWAYS into those wings and keeps the housing's height. Each
    // wing has to be wide enough to read a title and a status count in, and the
    // whole band still has to fit the island window.
    expect(rich.width).toBeGreaterThan(bare.width)
    expect((rich.width - NOTCH_WIDTH) / 2).toBeGreaterThanOrEqual(120)
    expect(rich.width).toBe(HOVER_WIDTH)
    expect(rich.width).toBeLessThanOrEqual(480)
    expect(rich.height).toBe(bare.height)
  })

  it('drops the housing shape the moment the surface leaves the edge', () => {
    const docked = islandShape({ notched: true, rows: 2, stage: 'pill' })
    const detached = islandShape({ attached: false, notched: true, rows: 2, stage: 'pill' })

    // The housing is not over the surface any more: a capsule, not an extrusion
    // of a cutout that is somewhere else on the screen.
    expect(docked.mode).toBe('notch')
    expect(detached.mode).toBe('floating')
    expect(islandClipPath(detached)).toBeNull()
    expect(detached.bottomOnly).toBe(false)
    expect(detached.radius).toBe(detached.height / 2)
    // It keeps the housing's height, so detaching does not resize it under the
    // pointer — and it widens, because nothing hides the middle of the band now.
    expect(detached.height).toBe(docked.height)
    expect(detached.width).toBeGreaterThan(docked.width)
  })

  it('never reserves the housing band above a detached surface', () => {
    for (const stage of ['attention', 'expanded', 'session'] as const) {
      const docked = islandShape({ notched: true, rows: 2, stage })
      const detached = islandShape({ attached: false, notched: true, rows: 2, stage })

      // The blank line the user saw: the housing's height taken out of the top
      // of a card that has no housing over it.
      expect(detached.top, stage).toBe(0)
      expect(detached.height, stage).toBe(docked.height - NOTCH_HEIGHT)
      expect(detached.bottomOnly, stage).toBe(false)
      expect(detached.radius, stage).toBeLessThan(NOTCH_HEIGHT)
    }
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
    expect(session.height).toBe(780 + NOTCH_HEIGHT)
    expect(session.width).toBe(584)
    expect(session.height).toBeGreaterThan(expanded.height)
    expect(session.height).toBeGreaterThan(attention.height)
    // Still inside the island window, or the surface would be clipped by it: the
    // window opens at 600 x 820 and the panel keeps a margin inside it.
    expect(session.width).toBeLessThanOrEqual(600)
    expect(session.height).toBeLessThanOrEqual(820)
  })

  it('keeps an empty expanded list short enough to still look like a control', () => {
    const empty = islandShape({ notched: false, rows: 0, stage: 'expanded' })

    expect(empty.height).toBeLessThan(140)
    expect(empty.opacity).toBe(1)
    expect(empty.mode).toBe('expanded')
  })
})

describe('islandContentInset', () => {
  it('starts the content below the housing, and nowhere else', () => {
    // Under the housing the camera cutout is opaque, so the row goes under it.
    expect(islandContentInset(islandShape({ notched: true, rows: 0, stage: 'hidden' }))).toBe(6)
    expect(islandContentInset(islandShape({ notched: true, rows: 2, stage: 'attention' }))).toBe(NOTCH_HEIGHT + 6)
    expect(islandContentInset(islandShape({ notched: true, rows: 8, stage: 'expanded' }))).toBe(NOTCH_HEIGHT + 6)

    // A detached card starts at its own padding: no blank line above it.
    for (const stage of ['attention', 'expanded', 'session'] as const) {
      expect(islandContentInset(islandShape({ attached: false, notched: true, rows: 8, stage })), stage).toBe(6)
    }
  })

  it('centres the one row of a capsule, whatever height the capsule is', () => {
    const detached = islandShape({ attached: false, notched: true, rows: 2, stage: 'pill' })

    expect(islandContentInset(detached)).toBe((detached.height - 24) / 2)
    // Taller than its row by exactly the two paddings: the row is inside it.
    expect(islandContentInset(detached) * 2 + 24).toBe(detached.height)
  })
})

describe('islandGooLayer', () => {
  it('bridges nothing while the surface is fused to the housing', () => {
    expect(islandGooLayer({ gap: 0, surface: 197 })).toBeNull()
    expect(islandGooLayer({ gap: 0.4, surface: 197 })).toBeNull()
    // Torn free: the neck is gone, and the surface is a plain move from here.
    expect(islandGooLayer({ gap: LEASH_BAND + 1, surface: 197 })).toBeNull()
  })

  it('is never narrower than the surface it hangs from', () => {
    // A neck narrower than the bar meets it in a step the alpha threshold cannot
    // smooth away, which is what made the last attempt read as a block.
    for (const gap of [2, 20, 40, LEASH_BAND]) {
      expect(islandGooLayer({ gap, surface: 197 })?.width, String(gap)).toBe(197)
    }
  })

  it('is one tapered silhouette, bled under the surface', () => {
    const layer = islandGooLayer({ gap: 60, surface: 197 })

    expect(layer).toEqual({
      // Capped: past ~6 px of blur the threshold rounds the shape's own corners.
      blur: 5.5,
      // Full width where it leaves the housing, pulled in at the end that is
      // painted under the surface, so the join is never on screen.
      clip: 'polygon(0px 0px, 197px 0px, 190.84px 66px, 6.16px 66px)',
      height: 60 + GOO_BLEED,
      width: 197
    })
  })

  it('thins the neck as the gap opens, and stops before it pinches off', () => {
    // The left inset of the silhouette's far edge: the neck's waist.
    const waist = (gap: number) => {
      const points = islandGooLayer({ gap, surface: 197 })?.clip.slice('polygon('.length, -1).split(',') ?? []

      return Number(points[points.length - 1].trim().split('px')[0])
    }

    // Still inside the housing: nothing tapers, because nothing is on screen.
    expect(waist(NOTCH_HEIGHT)).toBe(0)
    expect(waist(40)).toBeGreaterThan(waist(NOTCH_HEIGHT))
    expect(waist(LEASH_BAND)).toBeGreaterThan(waist(40))
    // A neck that thins to a point is a shape no blur can smooth back.
    expect(197 - waist(LEASH_BAND) * 2).toBeGreaterThan(197 / 2)
  })

  it('blurs the silhouette with the gap it has to span, never past the cap', () => {
    expect(islandGooLayer({ gap: 2, surface: 197 })?.blur).toBeLessThan(1)
    expect(islandGooLayer({ gap: 20, surface: 197 })?.blur).toBeGreaterThan(
      islandGooLayer({ gap: 10, surface: 197 })?.blur ?? 0
    )
    expect(islandGooLayer({ gap: LEASH_BAND, surface: 197 })?.blur).toBe(5.5)
  })
})

describe('islandClipPath', () => {
  it('clips the notch surface to the housing, with a concave top fillet', () => {
    const notch = islandShape({ notched: true, rows: 0, stage: 'hidden' })

    // The top edge is the housing's full width, the sides flare in by the fillet
    // as they leave it, and the bottom keeps the resting radius.
    expect(islandClipPath(notch)).toBe(
      'path("M0 0H197Q191 0 191 6V18Q191 32 177 32H20Q6 32 6 18V6Q6 0 0 0Z")'
    )
  })

  it('is worn by every surface that IS the housing, and by nothing else', () => {
    expect(islandClipPath(islandShape({ notched: true, rows: 0, stage: 'pill' }))).not.toBeNull()
    // Hover widens past the housing, and a grown surface reaches the menu bar
    // either side of it: a flare there would scoop the corner out of a bar.
    expect(islandClipPath(islandShape({ notched: true, rich: true, rows: 0, stage: 'pill' }))).toBeNull()
    expect(islandClipPath(islandShape({ notched: true, rows: 2, stage: 'attention' }))).toBeNull()
    expect(islandClipPath(islandShape({ notched: true, rows: 0, stage: 'session' }))).toBeNull()
    // Pulled off the edge the surface is a capsule: the flare belongs to the
    // housing it is no longer in.
    expect(islandClipPath(islandShape({ attached: false, notched: true, rows: 0, stage: 'pill' }))).toBeNull()
    expect(islandClipPath(islandShape({ attached: false, notched: true, rows: 0, stage: 'hidden' }))).toBeNull()
    // No housing, no notch: a floating pill is an ordinary rounded corner.
    expect(islandClipPath(islandShape({ notched: false, rows: 0, stage: 'hidden' }))).toBeNull()
    expect(islandClipPath(islandShape({ notched: false, rows: 3, stage: 'expanded' }))).toBeNull()
  })

  it('follows the housing it is given, so a shorter menu bar clips shorter', () => {
    const shallow = islandShape({ notchHeight: 24, notched: true, rows: 0, stage: 'hidden' })
    const path = islandClipPath(shallow)

    // The fillet shrinks with the height (24 / 2), and the bottom radius stays.
    expect(path).toBe('path("M0 0H197Q191 0 191 6V10Q191 24 177 24H20Q6 24 6 10V6Q6 0 0 0Z")')
    // A fillet may take half the height at most, so a body and a bottom corner
    // both survive however short the housing is.
    const flat = islandClipPath({ ...shallow, height: 12 }) ?? ''
    // The fillet and the bottom radius between them may use all the height:
    // the sides collapse to a point rather than inverting.
    expect(flat).toContain('12')
    expect(flat).not.toContain('-')
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

  it('carries a dragged surface without stretching it', () => {
    expect(islandSurfaceTransform({ ...still, dragging: true })).toBe('translateY(1px)')
    expect(islandSurfaceTransform({ ...still, dragging: true, paint: 'translateY(12px)' })).toBe(
      'translateY(1px) translateY(12px)'
    )
  })

  it('never lets a release correction that arrives mid-gesture drop the lift', () => {
    // Main debounces the settle from the last pointer move, so a paused drag is
    // sent one while the pointer is still down.
    const paused = islandSurfaceTransform({ ...still, dragging: true, settle: 'translate(0px, 0px) scale(0.94)' })

    expect(paused).toBe('translateY(1px)')
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
    expect(islandLeash(80, 80)).toBeLessThan(80)
    expect(islandLeash(80, 80)).toBeCloseTo((80 * 0.55 * 80) / (80 + 0.55 * 80), 6)
    // The rubber-band part alone never reaches c·L + L: the leash holds.
    expect(islandLeash(LEASH_BAND)).toBeLessThan(0.55 * LEASH_BAND + 1)
  })

  it('stretches further than the housing is tall, or the neck would stay hidden', () => {
    // The surface only comes out from under an opaque cutout once the lag passes
    // the housing's own height; below that there is nothing for a neck to bridge.
    expect(islandLeash(LEASH_BAND)).toBeGreaterThan(NOTCH_HEIGHT + NOTCH_FILLET)
    // And it is still a leash rather than a follower: the surface trails the hand.
    expect(islandLeash(LEASH_BAND)).toBeLessThan(LEASH_BAND / 2)
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
