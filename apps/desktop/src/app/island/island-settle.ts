// The release snap: what a docked surface does when the window stops moving.
//
// Main owns the window's position, so on release the surface can be left a few
// pixels away from where the pointer put it — that difference is the correction.
// Painting the correction and letting it spring to zero is what makes the
// release legible: the surface arrives with the pointer instead of teleporting
// back. A release that corrected nothing has no travel to paint, so it paints
// nothing at all, and `prefers-reduced-motion` turns the whole thing off.
import { useCallback, useEffect, useState } from 'react'

export interface IslandSettle {
  dx: number
  dy: number
}

/** The largest correction worth painting: beyond this the surface would visibly
 *  detach from the window it is settling into instead of leaning into it. */
export const SETTLE_LIMIT = 48

/**
 * The correction a release message carries, or null when it carries none.
 *
 * Anything that is not two finite numbers is not a correction — a malformed
 * event must leave the surface at rest rather than paint a NaN transform. A
 * correction that rounds to zero is no correction either: the surface is already
 * where main put it, and painting a transform there would animate a jump that
 * never happened.
 */
export function islandSettleOffset(detail: unknown): IslandSettle | null {
  if (!detail || typeof detail !== 'object') {
    return null
  }

  const { dx, dy } = detail as { dx?: unknown; dy?: unknown }
  const x = Number(dx)
  const y = Number(dy)

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null
  }

  const clamp = (value: number) => Math.max(-SETTLE_LIMIT, Math.min(SETTLE_LIMIT, Math.round(value)))
  const offset = { dx: clamp(x), dy: clamp(y) }

  return offset.dx === 0 && offset.dy === 0 ? null : offset
}

/** The transform painted at the instant of release; `none` is the resting pose.
 *  Reduced motion paints nothing to animate, so the surface is simply at rest. */
export function islandSettleTransform(settle: IslandSettle | null, reducedMotion = false): string {
  if (!settle || reducedMotion) {
    return 'none'
  }

  // Counter the jump, not repeat it: main has already moved the window by
  // (+dx, +dy), the surface rides that move, and it starts from where the pointer
  // let go — so the first painted frame is at minus the correction. Travel only:
  // a scale here reads as a bounce on every drag, which is what a release that
  // snapped nowhere looked like.
  return `translate(${-settle.dx}px, ${-settle.dy}px)`
}

/** Whether the viewer asked for less motion. Guarded: a renderer without a
 *  media-query API keeps the snap rather than failing to paint. */
export function islandPrefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

export interface IslandSettleHandle {
  /** Snap out of a release correction. A null/garbage detail is ignored. */
  settle: (detail: unknown) => void
  /** The correction being painted, or null once the surface is at rest. */
  offset: IslandSettle | null
}

/**
 * Paint a correction for exactly one frame, then let the surface's own transform
 * transition carry it to zero. The one frame is what makes it a snap: painting
 * the correction and the rest pose in the same frame would animate the surface
 * OUT of its resting pose first, which reads as a wobble in the wrong direction.
 */
export function useIslandSettle(): IslandSettleHandle {
  const [offset, setOffset] = useState<IslandSettle | null>(null)

  useEffect(() => {
    if (!offset) {
      return
    }

    const frame = requestAnimationFrame(() => setOffset(null))

    return () => cancelAnimationFrame(frame)
  }, [offset])

  const settle = useCallback((detail: unknown) => {
    if (islandPrefersReducedMotion()) {
      return
    }

    const next = islandSettleOffset(detail)

    if (next) {
      setOffset(next)
    }
  }, [])

  return { offset, settle }
}
