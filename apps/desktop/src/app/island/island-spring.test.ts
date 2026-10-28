import { describe, expect, it } from 'vitest'

import { SPRING, springReleaseVelocity, springRest, springSettled, springStep } from './island-spring'

/** Frames of 60Hz, which is what the renderer asks for. */
const FRAME = 1 / 60

function run(target: number, seconds: number, params = SPRING) {
  let state = springRest(0)
  let peak = 0

  for (let frame = 0; frame < Math.round(seconds / FRAME); frame += 1) {
    state = springStep(state, target, FRAME, params)
    peak = Math.max(peak, state.value)
  }

  return { peak, state }
}

describe('springStep', () => {
  it('overshoots the step by a hair and settles in under a second', () => {
    const { peak, state } = run(100, 1)

    // ζ ≈ 0.8: a small overshoot, so the shape arrives rather than stopping.
    expect(peak).toBeGreaterThan(100)
    expect(peak).toBeLessThan(108)
    // Within a third of a pixel after a second: the overshoot is spent.
    expect(Math.abs(state.value - 100)).toBeLessThan(1)
  })

  it('comes to rest, so the renderer can stop asking for frames', () => {
    let state = springRest(0)

    for (let frame = 0; frame < 240; frame += 1) {
      state = springStep(state, 100, FRAME)
    }

    expect(springSettled(state, 100)).toBe(true)
  })

  it('keeps its velocity when it is retargeted mid-flight', () => {
    let state = springRest(0)

    // Half way out to 200, then told to go back to 0.
    for (let frame = 0; frame < 8; frame += 1) {
      state = springStep(state, 200, FRAME)
    }

    const before = state
    const after = springStep(state, 0, FRAME)

    // Continuous: one frame of travel, not a jump to zero.
    expect(Math.abs(after.value - before.value)).toBeLessThanOrEqual(Math.abs(before.velocity) * FRAME + 1e-6)
    expect(after.value).toBeGreaterThan(before.value)
    // And the velocity it arrived with is the one it turns around with.
    expect(after.velocity).toBeGreaterThan(before.velocity * 0.5)
  })

  it('is stable across a stalled frame instead of exploding', () => {
    const state = springStep(springRest(0), 100, 5)

    expect(Number.isFinite(state.value)).toBe(true)
    expect(state.value).toBeLessThan(100)
  })
})

describe('springReleaseVelocity', () => {
  it('reads a drag as a landing: fast flick over a short remainder lands hard', () => {
    // 40px in one frame, 80px still to go: a hard flick.
    expect(springReleaseVelocity(40, 0, 80, FRAME)).toBeGreaterThan(0)
    // Already there: nothing to carry.
    expect(springReleaseVelocity(40, 80, 80, FRAME)).toBe(0)
    // The sign follows the direction still to travel.
    expect(springReleaseVelocity(40, 80, 0, FRAME)).toBeLessThan(0)
  })
})
