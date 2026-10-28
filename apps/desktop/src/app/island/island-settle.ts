// The release snap: what a docked surface does when the window stops moving.
//
// Main owns the window's position, so on release the surface can be left a few
// pixels away from where the pointer put it — that difference is the correction.
// Painting the correction and letting it spring to zero is what makes the
// release legible: the surface arrives with the pointer instead of teleporting
// back. A short scale dip rides along, so a release that corrected nothing still
// lands visibly, and `prefers-reduced-motion` turns the whole thing off.
import { useCallback, useEffect, useState } from 'react'

export interface IslandSettle {
  dx: number
  dy: number
}

/** The largest correction worth painting: beyond this the surface would visibly
 *  detach from the window it is settling into instead of leaning into it. */
export const SETTLE_LIMIT = 48
/** Where the dip bottoms out. Shallow on purpose — the surface is small, and a
 *  deep scale would read as the island being resized rather than as a landing. */
export const SETTLE_SCALE = 0.94

/**
 * The correction a release message carries, or null when it carries none.
 *
 * Anything that is not two finite numbers is not a correction — a malformed
 * event must leave the surface at rest rather than paint a NaN transform.
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

  return { dx: clamp(x), dy: clamp(y) }
}

/** The transform painted at the instant of release; `none` is the resting pose.
 *  Reduced motion paints nothing to animate, so the surface is simply at rest. */
export function islandSettleTransform(settle: IslandSettle | null, reducedMotion = false): string {
  if (!settle || reducedMotion) {
    return 'none'
  }

  return `translate(${settle.dx}px, ${settle.dy}px) scale(${SETTLE_SCALE})`
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
