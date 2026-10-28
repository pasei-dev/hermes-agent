// The island's shape, as plain numbers.
//
// The OS window is one fixed rectangle (see electron/island-geometry.ts); every
// stage change is a CSS transition of these values inside it, so the animation
// runs on the compositor instead of paying a window `setBounds` per frame. The
// numbers are derived here, unit-tested without a DOM, and the component only
// paints them.
//
// On a notched Mac the resting shape IS the notch — same width, same height,
// flush with the top edge — so "hidden" reads as the housing rather than as a
// black bar under it. That is the autohide: the surface grows down and out of
// the notch when there is something to say, and retreats into it when there is
// not. Where there is no housing there is nothing to hide inside, so idle is
// fully invisible and activity floats a pill below the menu bar.

import type { IslandStage } from './island-model'

/** Matches electron/island-geometry.ts::islandAnchor. */
export const NOTCH_WIDTH = 208
export const NOTCH_HEIGHT = 32
/** The concave corner where the housing's sides meet the screen's top edge.
 *  `border-radius` rounds a corner inward; a notch flares outward, so the
 *  resting surface is clipped to a path instead (see `islandClipPath`). */
export const NOTCH_FILLET = 10
/** Matches electron/island-geometry.ts::ISLAND_EDGE_SNAP. */
export const ISLAND_EDGE_SNAP = 30
/** How far the pointer may travel before the leash is cut, and how hard the
 *  rubber band holds: the curve flattens toward c·L, so the surface lags the
 *  pointer by a growing distance instead of stopping dead. */
export const LEASH_BAND = 80
const LEASH_CURVE = 0.55
/** The goo neck: blur per pixel of gap, and the ceiling where it dissolves. */
const GOO_BLUR_PER_PX = 0.18
const GOO_MAX_BLUR = 6

const EXPANDED_WIDTH = 452
/** Corner radius of the pill while it rests in the housing: squarer than the
 *  rounded pill it grows out of, so a surface that has settled against the notch
 *  reads as docked rather than as an ordinary floating bubble. */
export const DOCKED_RADIUS = 10
/** One open session: the app's chat view, so it is a panel — the island window's
 *  own ceiling is 480 × 560, and the surface takes all of it bar the padding. */
const SESSION_WIDTH = 478
const SESSION_HEIGHT = 546
const MAX_EXPANDED_HEIGHT = 420
const ROW_HEIGHT = 26
/** The list's search field, its divider and its breathing room. */
// The search field is an overlay now, not a band: it takes no height of its own.
const ATTENTION_CARD_HEIGHT = 104
const HEADER_HEIGHT = 34
const SURFACE_PADDING = 12

export interface IslandShape {
  height: number
  /** What the resting pill is called in tests and data attributes. `notch` is
   *  the surface being the housing itself, so it wears the concave top fillet. */
  mode: 'expanded' | 'floating' | 'notch'
  opacity: number
  radius: number
  /** Content inset from the surface's top: zero where the content lives in the
   *  housing band (the resting pill, whose text sits in the visible wings), the
   *  housing's height where the surface grows out of it — a notched Mac's top
   *  centre is opaque, so nothing may be painted under it. */
  top: number
  /** A notched surface is an extrusion of the housing: flush with the screen's
   *  top edge, square there, rounded only at the bottom. */
  bottomOnly: boolean
  width: number
}

export function islandShape(input: {
  /** Height the attention card needs for its content, in px. */
  cardHeight?: number
  /** The housing's own height on this display; the menu bar IS the notch. */
  notchHeight?: number
  notched: boolean
  rich?: boolean
  rows: number
  /** Remembered size of the open session panel. */
  sessionSize?: { height: number; width: number }
  stage: IslandStage
}): IslandShape {
  const { cardHeight = ATTENTION_CARD_HEIGHT, notchHeight = NOTCH_HEIGHT, notched, rich = false, rows, sessionSize, stage } = input

  // Everything that grows out of the housing starts BELOW it on a notched
  // display: the camera housing is physically opaque, so a row painted at the
  // top of the window would sit behind the notch and never be seen.
  const belowHousing = notched ? notchHeight : 0

  if (stage === 'hidden') {
    return notched
      ? {
          bottomOnly: true,
          height: notchHeight,
          mode: 'notch',
          opacity: 1,
          radius: DOCKED_RADIUS,
          top: 0,
          width: NOTCH_WIDTH
        }
      : { bottomOnly: false, height: 30, mode: 'floating', opacity: 0, radius: 15, top: 0, width: 132 }
  }

  if (stage === 'pill') {
    // A pill with an activity line carries four things (tool, clock, plan, workers)
    // where a bare count carried one word, so the hovered pill grows instead of
    // truncating the tool name to two letters.
    // On a notched display the RESTING pill IS the band: the housing's own width
    // and height, clipped to the housing's flare. Its one line — the title, its
    // tool and the buttons — arrives on hover, in the wings either side of the
    // housing. Idle must not widen to say that something is running.
    return {
      bottomOnly: notched,
      height: notched ? notchHeight : HEADER_HEIGHT,
      mode: notched && !rich ? 'notch' : 'floating',
      opacity: 1,
      radius: notched ? DOCKED_RADIUS : HEADER_HEIGHT / 2,
      top: 0,
      width: notched ? (rich ? 316 : NOTCH_WIDTH) : rich ? 268 : 190
    }
  }

  if (stage === 'attention') {
    return {
      bottomOnly: notched,
      height: belowHousing + HEADER_HEIGHT + cardHeight + SURFACE_PADDING,
      mode: 'floating',
      opacity: 1,
      radius: notched ? DOCKED_RADIUS : 22,
      top: belowHousing,
      width: notched ? 372 : 344
    }
  }

  if (stage === 'session') {
    // The session stage mounts the app's own chat view, which brings its own
    // composer and scrolling: it needs a panel, not one band per transcript line.
    return {
      bottomOnly: notched,
      height: belowHousing + (sessionSize?.height ?? SESSION_HEIGHT),
      mode: 'expanded',
      opacity: 1,
      radius: notched ? DOCKED_RADIUS : 22,
      top: belowHousing,
      width: sessionSize?.width ?? SESSION_WIDTH
    }
  }

  const listHeight = rows === 0 ? 28 : rows * ROW_HEIGHT

  const height = Math.min(
    MAX_EXPANDED_HEIGHT,
    HEADER_HEIGHT + listHeight + SURFACE_PADDING * 2
  )

  return {
    bottomOnly: notched,
    height: belowHousing + height,
    mode: 'expanded',
    opacity: 1,
    radius: notched ? DOCKED_RADIUS : 24,
    top: belowHousing,
    width: EXPANDED_WIDTH
  }
}

/** Which edge the island's window is attached to, as main reports it. */
export type IslandDockSide = 'bottom' | 'free' | 'left' | 'right' | 'top'

/** Anything main did not name is a free island: a bad channel value must not
 *  square a corner against an edge the window is not on. */
export function islandDockSide(raw: unknown): IslandDockSide {
  return raw === 'bottom' || raw === 'left' || raw === 'right' || raw === 'top' ? raw : 'free'
}

/** Two decimals: a path is stringified CSS, so float noise has no business in it. */
const px = (value: number) => String(Math.round(value * 100) / 100)

/**
 * The `clip-path` a notch surface is painted with, or null for every other
 * surface.
 *
 * A housing's top corners are CONCAVE: its sides flare outward into the screen's
 * top edge rather than rounding inward the way `border-radius` rounds, and no
 * radius value can do that. The path is built from the shape's own width,
 * height and bottom radius, so it clips exactly the surface it is painted on —
 * and it is only ever painted on a display that has a housing.
 */
export function islandClipPath(shape: IslandShape): null | string {
  if (shape.mode !== 'notch') {
    return null
  }

  const { height, width } = shape
  // Neither corner may eat the other: the fillet has to leave a body to flare
  // out of, and the bottom radius has to leave a straight side below it.
  const fillet = Math.max(0, Math.min(NOTCH_FILLET, width / 4, height / 3))
  const radius = Math.max(0, Math.min(shape.radius, height - fillet, width / 2 - fillet))
  const body = width - fillet
  const bottom = height - radius

  return (
    `path("M0 0H${px(width)}` +
    `Q${px(body)} 0 ${px(body)} ${px(fillet)}` +
    `V${px(bottom)}` +
    `Q${px(body)} ${px(height)} ${px(body - radius)} ${px(height)}` +
    `H${px(fillet + radius)}` +
    `Q${px(fillet)} ${px(height)} ${px(fillet)} ${px(bottom)}` +
    `V${px(fillet)}` +
    `Q${px(fillet)} 0 0 0Z")`
  )
}

/** The corner radius CSS, squared off against the edge the surface is docked to
 *  — or the edge a drag is pulling it toward. */
export function islandCorners(radius: number, side: IslandDockSide): string {
  const r = `${radius}px`

  if (side === 'top') {
    return `0 0 ${r} ${r}`
  }

  if (side === 'bottom') {
    return `${r} ${r} 0 0`
  }

  if (side === 'left') {
    return `0 ${r} ${r} 0`
  }

  if (side === 'right') {
    return `${r} 0 0 ${r}`
  }

  return r
}

/**
 * How far the surface has followed a pointer that has travelled `travel` from
 * the notch, while the leash is attached.
 *
 * iOS's rubber-band curve, d = (x·c·L)/(L + c·|x|): the first pixels of travel
 * move the surface almost nothing, and the curve flattens toward c·L instead of
 * running away. Past the band the leash is cut and the surface tracks the
 * pointer one for one, from wherever the stretch left it.
 */
export function islandLeash(travel: number, bandLength = LEASH_BAND, c = LEASH_CURVE): number {
  const x = Math.abs(travel)
  const stretch = (Math.min(x, bandLength) * c * bandLength) / (bandLength + c * Math.min(x, bandLength))
  const d = x > bandLength ? stretch + (x - bandLength) : stretch

  return travel < 0 ? -d : d
}

/**
 * The goo filter's blur, in px, for a gap between the housing band and the
 * surface: a neck fuses while the gap is small and thins out as it opens.
 *
 * Bigger stdDeviation carries the neck further out, so the blur is the one
 * number that tunes how far the surface can reach before it comes apart.
 */
export function islandGooBlur(gap: number): number {
  return Math.round(Math.max(0, Math.min(GOO_MAX_BLUR, Math.abs(gap) * GOO_BLUR_PER_PX)) * 100) / 100
}

/** Off the glass a dragged surface is bigger than the rule it settles into. */
const DRAG_LIFT = 'scale(1.03, 1.28)'

/**
 * The one transform the surface paints.
 *
 * A drag outranks the release correction: main debounces the settle from the
 * last pointer move, so a drag that pauses long enough is sent one mid-gesture,
 * and painting it would drop the lift the user is still holding.
 */
export function islandSurfaceTransform(input: {
  dragging: boolean
  /** The extra transform the leash and the release squash are painting. */
  paint: string
  /** The correction being painted after a release, or null at rest. */
  settle: null | string
  /** A hidden surface shrinks as it fades, so the fade reads as a retreat. */
  visible: boolean
}): string {
  if (input.dragging) {
    return `${DRAG_LIFT} ${input.paint}`.trim()
  }

  if (input.settle) {
    return input.settle
  }

  return input.visible ? 'none' : 'scale(0.92)'
}

/** The width the black surface needs before a command or a title is truncated
 *  into uselessness — used by the attention card's own line clamp. */
export function islandCardLineClamp(stage: IslandStage): number {
  return stage === 'attention' ? 2 : 3
}
