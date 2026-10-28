// The island's motion, integrated rather than eased.
//
// A cubic-bezier runs for a fixed duration whatever it is animating from, so a
// surface that is retargeted half-way — expanded and then collapsed — restarts
// from zero velocity and the second half reads as a stutter. A spring carries
// its velocity across a retarget, which is what makes a shape that changes its
// mind feel like an object rather than a slideshow.
//
// The parameters are iOS's interactive spring: ζ = 0.75, so the step response
// overshoots by about 3% and is within a pixel of the target in ~0.35s — quick
// enough to follow a pointer, damped enough not to look bouncy.
//
// Pure numbers, unit-tested without a DOM: the renderer only paints what this
// hands it.
export interface SpringState {
  value: number
  velocity: number
}

export interface SpringParams {
  damping: number
  mass: number
  stiffness: number
}

/** The interactive spring: response 0.38s as the period, damping fraction 0.8,
 *  i.e. stiffness (2π/0.38)² and damping 2·0.8·√(stiffness) — ζ = 0.8, so the
 *  step response overshoots by about 1.5% and is settled in ~0.38s. */
export const SPRING: SpringParams = { damping: 24, mass: 1, stiffness: 330 }
/** The snap to an edge: stiff and quick, because the window has already moved. */
export const SPRING_SNAP = SPRING
/** The return to the notch: softer and looser, so coming home reads as a
 *  settle rather than as a correction. */
export const SPRING_RETURN: SpringParams = { damping: 10, mass: 1, stiffness: 50 }

/** A frame longer than this is a stalled tab, not a slow one: integrating the
 *  whole gap in one step is what makes a spring explode. */
const MAX_STEP = 1 / 120
/** Small steps, so a stiff spring stays stable whatever the frame rate is. */
const SUB_STEP = 1 / 480

/** Close enough to the target to stop: a tenth of a pixel, and a slow drift. */
export const SPRING_EPSILON = 0.1
export const SPRING_REST_VELOCITY = 1

/** The target a shape is heading for. */
export interface SpringTarget {
  height: number
  radius: number
  width: number
}

/** Three channels moving together: what a shape paints. */
export interface SpringShape {
  height: SpringState
  radius: SpringState
  width: SpringState
}

export function springRest(value: number): SpringState {
  return { value, velocity: 0 }
}

/**
 * One frame of a spring heading for `target`.
 *
 * Semi-implicit Euler in small sub-steps: velocity first, then position, which
 * is stable at these stiffnesses where explicit Euler is not.
 */
export function springStep(state: SpringState, target: number, dt: number, params: SpringParams = SPRING): SpringState {
  let value = state.value
  let velocity = state.velocity
  let remaining = Math.min(Math.max(dt, 0), MAX_STEP)

  while (remaining > 0) {
    const step = Math.min(SUB_STEP, remaining)
    const acceleration = (params.stiffness * (target - value) - params.damping * velocity) / params.mass

    velocity += acceleration * step
    value += velocity * step
    remaining -= step
  }

  return { value, velocity }
}

export function springSettled(state: SpringState, target: number): boolean {
  return Math.abs(target - state.value) < SPRING_EPSILON && Math.abs(state.velocity) < SPRING_REST_VELOCITY
}

export function springShapeRest(target: SpringTarget): SpringShape {
  return { height: springRest(target.height), radius: springRest(target.radius), width: springRest(target.width) }
}

/**
 * One frame of the whole shape.
 *
 * A retarget is invisible here on purpose: only `target` changes between calls,
 * so both channels keep the velocity they arrived with.
 */
export function springShapeStep(
  shape: SpringShape,
  target: SpringTarget,
  dt: number,
  params: SpringParams = SPRING
): SpringShape {
  return {
    height: springStep(shape.height, target.height, dt, params),
    radius: springStep(shape.radius, target.radius, dt, params),
    width: springStep(shape.width, target.width, dt, params)
  }
}

/**
 * The velocity a released surface starts with, in the spring's own units.
 *
 * A drag arrives as pixels per frame; a spring integrates in the same space as
 * its position, so the honest seed is the drag's speed measured against the
 * distance still to cover — fast flick, short remainder, hard landing.
 */
export function springReleaseVelocity(velocity: number, current: number, target: number, dt: number): number {
  const remaining = Math.abs(target - current)

  if (!Number.isFinite(velocity) || remaining < 1) {
    return 0
  }

  return (velocity / dt / remaining) * (target > current ? 1 : -1)
}

export function springShapeSettled(shape: SpringShape, target: SpringTarget): boolean {
  return (
    springSettled(shape.height, target.height) &&
    springSettled(shape.radius, target.radius) &&
    springSettled(shape.width, target.width)
  )
}

/** What goes on the element: whole pixels for the box, half pixels for corners. */
export function springShapePaint(shape: SpringShape): { height: number; radius: number; width: number } {
  return {
    height: Math.round(shape.height.value),
    radius: Math.round(shape.radius.value * 2) / 2,
    width: Math.round(shape.width.value)
  }
}
