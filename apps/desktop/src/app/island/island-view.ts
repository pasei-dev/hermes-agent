// The island's shape, as plain numbers.
//
// The OS window is one fixed rectangle (see electron/island-geometry.ts); every
// stage change is a CSS transition of these values inside it, so the animation
// runs on the compositor instead of paying a window `setBounds` per frame. The
// numbers are derived here, unit-tested without a DOM, and the component only
// paints them.
//
// On a notched Mac, AT THE TOP EDGE, the resting shape IS the notch — same
// width, same height, flush with the top edge — so "hidden" reads as the housing
// rather than as a black bar under it. That is the autohide: the surface grows
// down and out of the notch when there is something to say, and retreats into it
// when there is not. Anywhere else — dragged off that edge, or docked to another
// one — there is no housing over the surface, so it is an ordinary capsule or
// card and nothing reserves room for a cutout that is not there.

import type { IslandStage } from './island-model'

/** Matches electron/island-geometry.ts::islandAnchor. */
// The housing is 185 x 32 pt at a 2x menu bar and 220 x 38 at a wider scaling —
// a fixed 370 x 64 panel pixels either way (crestnotch.app, notchbay.com). The
// band DRAWN for it is wider by one fillet on each side, exactly as
// DynamicNotchKit sizes its shape (minWidth = notchSize.width + topCornerRadius*2).
export const NOTCH_WIDTH = 185
export const NOTCH_HEIGHT = 32
/** The concave corner where the housing's sides meet the screen's top edge.
 *  `border-radius` rounds a corner inward; a notch flares outward, so the
 *  resting surface is clipped to a path instead (see `islandClipPath`). */
export const NOTCH_FILLET = 6
/** Matches electron/island-geometry.ts::ISLAND_EDGE_SNAP. */
export const ISLAND_EDGE_SNAP = 30
/** How far the pointer may travel before the leash is cut, and how hard the
 *  rubber band holds: the curve flattens toward c·L, so the surface lags the
 *  pointer by a growing distance instead of stopping dead.
 *
 *  The band is several housing heights on purpose. The rubber band's own ceiling
 *  is 0.35·L, and a lag shorter than the housing's height leaves the surface
 *  under an opaque cutout — nothing to see, and no neck that could bridge it. At
 *  this band the surface is ~70 px out when it tears free, so the last ~40 px of
 *  the pull are the neck. */
export const LEASH_BAND = 200
const LEASH_CURVE = 0.55

const EXPANDED_WIDTH = 452
/** Corner radius of the pill while it rests in the housing: squarer than the
 *  rounded pill it grows out of, so a surface that has settled against the notch
 *  reads as docked rather than as an ordinary floating bubble. */
export const DOCKED_RADIUS = 14

/** The pointer widens the band SIDEWAYS into the wings either side of the opaque
 *  housing, and never a pixel taller than the housing: the avatar and the line on
 *  one side, the status counts and the buttons on the other. It stops short of the
 *  island window's own 480 px so the spring's overshoot is never clipped. */
export const HOVER_WIDTH = 470
/** A pill pulled off the edge is a capsule that carries its line all the time,
 *  so it is wider than the bare dot it rests as in the housing — wide enough for
 *  the avatar, a readable title and the counts, with room to widen on a hover. */
const PILL_WIDTH = 300
const PILL_WIDTH_RICH = 340

/** The goo neck: blur per pixel of gap, and the ceiling where the threshold can
 *  no longer smooth a corner — past ~6 px the silhouette's own edges round off. */
const GOO_BLUR_PER_PX = 0.16
const GOO_MAX_BLUR = 5.5
/** How far the silhouette is bled past the surface's top edge, so its tapered end
 *  is painted UNDER the surface instead of meeting it in a step. */
export const GOO_BLEED = 6
/** How far the neck is pulled in at its far end, per pixel of gap, and the
 *  ceiling: a neck that thins to a point is a shape no blur can smooth back, and
 *  a steep diagonal leaves a kink where the neck meets the band it hangs from. */
const GOO_TAPER_PER_PX = 0.22
const GOO_MAX_TAPER = 18

/** One open session: the app's chat view, so it is a panel — the island window's
 *  own ceiling is 480 × 620, and the surface takes all of it bar the padding. */
const SESSION_WIDTH = 478
const SESSION_HEIGHT = 546
const MAX_EXPANDED_HEIGHT = 420
const ROW_HEIGHT = 26
/** The list's search field, its divider and its breathing room. */
// The search field is an overlay now, not a band: it takes no height of its own.
const ATTENTION_CARD_HEIGHT = 104
const HEADER_HEIGHT = 34
const SURFACE_PADDING = 12
/** The one row of chrome every stage paints above its content. */
const CONTENT_ROW = 24

export interface IslandShape {
  height: number
  /** What the resting pill is called in tests and data attributes. `notch` is
   *  the surface being the housing itself, so it wears the concave top fillet. */
  mode: 'expanded' | 'floating' | 'notch'
  opacity: number
  radius: number
  /** Content inset from the surface's top: the housing's height where the
   *  surface sits under the housing (a notched Mac's top centre is opaque, so
   *  nothing may be painted under it), and zero where there is no housing over
   *  the content — see `islandContentInset`. */
  top: number
  /** A notched surface is an extrusion of the housing: flush with the screen's
   *  top edge, square there, rounded only at the bottom. */
  bottomOnly: boolean
  width: number
}

export function islandShape(input: {
  /** Whether the surface is the housing at the top of a notched display. A
   *  surface dragged off that edge, or docked to another one, is a capsule. */
  attached?: boolean
  /** Height the attention card needs for its content, in px. */
  cardHeight?: number
  /** The housing's own height on this display; the menu bar IS the notch. */
  notchHeight?: number
  /** The housing's width on this display, when main measured one. */
  notchWidth?: number
  notched: boolean
  rich?: boolean
  rows: number
  /** Remembered size of the open session panel. */
  sessionSize?: { height: number; width: number }
  stage: IslandStage
}): IslandShape {
  const {
    attached = true,
    cardHeight = ATTENTION_CARD_HEIGHT,
    notchHeight = NOTCH_HEIGHT,
    notchWidth = NOTCH_WIDTH,
    notched,
    rich = false,
    rows,
    sessionSize,
    stage
  } = input

  // What the pill is DRAWN as when it is the housing: the cutout's own width plus
  // the flare on either side of it.
  const band = Math.max(0, Math.round(notchWidth)) + NOTCH_FILLET * 2

  // The housing only overhangs the surface while the surface IS the housing. Off
  // that edge the cutout is not over it at all, so nothing reserves the band
  // above the content — the blank line a detached pill used to wear.
  const housing = notched && attached

  // Everything that grows out of the housing starts BELOW it: the camera housing
  // is physically opaque, so a row painted at the top of the window would sit
  // behind the notch and never be seen.
  const belowHousing = housing ? notchHeight : 0

  if (stage === 'hidden') {
    return housing
      ? {
          bottomOnly: true,
          height: notchHeight,
          mode: 'notch',
          opacity: 1,
          radius: DOCKED_RADIUS,
          top: 0,
          width: band
        }
      : { bottomOnly: false, height: 30, mode: 'floating', opacity: 0, radius: 15, top: 0, width: 132 }
  }

  if (stage === 'pill') {
    const height = notched ? notchHeight : HEADER_HEIGHT

    if (housing) {
      // At rest it is the housing and nothing more: the cutout is opaque, so a
      // band exactly its width has nowhere to paint a dot, and the answer is a
      // hover that widens it into the wings rather than a permanent +48 px.
      return {
        bottomOnly: true,
        height,
        mode: rich ? 'floating' : 'notch',
        opacity: 1,
        radius: DOCKED_RADIUS,
        top: 0,
        width: rich ? HOVER_WIDTH : band
      }
    }

    // Pulled off the edge: a capsule. No flare, no squared top, no line of
    // housing above the row — and wide enough to carry avatar, title and tool
    // without a hover, because nothing hides the middle of it any more.
    return {
      bottomOnly: false,
      height,
      mode: 'floating',
      opacity: 1,
      radius: height / 2,
      top: 0,
      width: notched ? (rich ? PILL_WIDTH_RICH : PILL_WIDTH) : rich ? PILL_WIDTH : 190
    }
  }

  if (stage === 'attention') {
    return {
      bottomOnly: housing,
      height: belowHousing + HEADER_HEIGHT + cardHeight + SURFACE_PADDING,
      mode: 'floating',
      opacity: 1,
      radius: housing ? DOCKED_RADIUS : 22,
      top: belowHousing,
      width: notched ? 372 : 344
    }
  }

  if (stage === 'session') {
    // The session stage mounts the app's own chat view, which brings its own
    // composer and scrolling: it needs a panel, not one band per transcript line.
    return {
      bottomOnly: housing,
      height: belowHousing + (sessionSize?.height ?? SESSION_HEIGHT),
      mode: 'expanded',
      opacity: 1,
      radius: housing ? DOCKED_RADIUS : 22,
      top: belowHousing,
      width: sessionSize?.width ?? SESSION_WIDTH
    }
  }

  const listHeight = rows === 0 ? 28 : rows * ROW_HEIGHT

  const height = Math.min(MAX_EXPANDED_HEIGHT, HEADER_HEIGHT + listHeight + SURFACE_PADDING * 2)

  return {
    bottomOnly: housing,
    height: belowHousing + height,
    mode: 'expanded',
    opacity: 1,
    radius: housing ? DOCKED_RADIUS : 24,
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
 * Where the content box starts, measured from the surface's top edge.
 *
 * Under the housing it starts below the housing — the camera cutout is
 * physically opaque, so a row painted under it is invisible. Everywhere else the
 * content starts at the surface's own padding: one band of chrome centres its
 * row inside a capsule, and a card starts at the top. There is never a blank line
 * where a housing would have been.
 */
export function islandContentInset(shape: IslandShape): number {
  if (shape.top > 0) {
    return shape.top + 6
  }

  if (shape.mode === 'notch') {
    return 6
  }

  return shape.height <= CONTENT_ROW + 20 ? Math.max(0, Math.round((shape.height - CONTENT_ROW) / 2)) : 6
}

/**
 * The liquid neck painted behind the surface while it tears out of the housing,
 * and again when it is absorbed back into it.
 */
export interface IslandGooLayer {
  /** `stdDeviation` the silhouette is blurred with, in px. */
  blur: number
  /** The silhouette's own clip path: a band as wide as the surface where it
   *  leaves the housing, tapered toward the end that is drawn under the surface.
   *  The taper is applied BEFORE the blur, so the filter turns it into the
   *  shoulders of a neck instead of cutting them off. */
  clip: string
  height: number
  width: number
}

/**
 * The neck between the housing and a surface that has been let out of it.
 *
 * The silhouette is ONE shape, as wide as the surface where it meets the housing,
 * so it never arrives at the surface in a step the alpha threshold cannot smooth
 * — a neck narrower than the bar reads as a block under a bar, not as liquid. It
 * is bled past the surface's top edge, so its tapered end is painted under the
 * surface and the join is never on screen; what is on screen is the waist the
 * blur and the threshold turn into fillets.
 *
 * Null when there is nothing to bridge: fused, or torn so far that the neck is
 * gone.
 */
export function islandGooLayer(input: { gap: number; notchHeight?: number; surface: number }): IslandGooLayer | null {
  const { gap, notchHeight = NOTCH_HEIGHT, surface } = input

  if (!(gap > 0.5) || gap > LEASH_BAND) {
    return null
  }

  // Never narrower than the surface it hangs from: that IS the step the
  // threshold cannot smooth away.
  const width = Math.max(1, Math.round(surface))
  const height = Math.round((gap + GOO_BLEED) * 10) / 10
  // The neck only thins once it has left the housing: inside the band there is
  // nothing on screen to taper.
  const open = Math.max(0, gap - notchHeight)
  const inset = Math.min(GOO_MAX_TAPER, open * GOO_TAPER_PER_PX)
  const blur = Math.round(Math.min(GOO_MAX_BLUR, gap * GOO_BLUR_PER_PX) * 100) / 100

  // The taper runs the whole height of the layer, so both places where its slope
  // changes are painted where they cannot be seen: the top under the housing, the
  // bottom under the surface. A taper that starts on the housing's own bottom edge
  // instead leaves that edge as a shelf with a kink in it.
  const clip = `polygon(0px 0px, ${px(width)}px 0px, ${px(width - inset)}px ${px(height)}px, ${px(inset)}px ${px(height)}px)`

  return { blur, clip, height, width }
}

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
  const fillet = Math.max(0, Math.min(NOTCH_FILLET, width / 4, height / 2))
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

/** Off the glass a dragged surface is carried, not stretched: the 28% squash
 *  that used to live here made every drag read as a rubber band rather than an
 *  object being picked up. */
const DRAG_LIFT = 'translateY(1px)'

/**
 * The one transform the surface paints.
 *
 * A drag outranks the release correction: main debounces the settle from the
 * last pointer move, so a drag that pauses long enough is sent one mid-gesture,
 * and painting it would drop the lift the user is still holding.
 */
export function islandSurfaceTransform(input: {
  dragging: boolean
  /** The extra transform the leash and the goo gap are painting. */
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
