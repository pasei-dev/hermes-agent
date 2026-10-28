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

const EXPANDED_WIDTH = 452
/** One open session: the app's chat view, so it is a panel — the island window's
 *  own ceiling is 480 × 560, and the surface takes all of it bar the padding. */
const SESSION_WIDTH = 478
const SESSION_HEIGHT = 546
const MAX_EXPANDED_HEIGHT = 420
const ROW_HEIGHT = 26
/** The list's search field, its divider and its breathing room. */
const SEARCH_FIELD_HEIGHT = 44
const ATTENTION_CARD_HEIGHT = 104
const HEADER_HEIGHT = 34
const SURFACE_PADDING = 12

export interface IslandShape {
  height: number
  /** What the resting pill is called in tests and data attributes. */
  mode: 'expanded' | 'floating' | 'notch'
  opacity: number
  radius: number
  width: number
}

export function islandShape(input: {
  /** Height the attention card needs for its content, in px. */
  cardHeight?: number
  notched: boolean
  rich?: boolean
  rows: number
  /** Remembered size of the open session panel. */
  sessionSize?: { height: number; width: number }
  stage: IslandStage
}): IslandShape {
  const { cardHeight = ATTENTION_CARD_HEIGHT, notched, rich = false, rows, sessionSize, stage } = input

  if (stage === 'hidden') {
    return notched
      ? { height: NOTCH_HEIGHT, mode: 'notch', opacity: 1, radius: NOTCH_HEIGHT / 2, width: NOTCH_WIDTH }
      : { height: 30, mode: 'floating', opacity: 0, radius: 15, width: 132 }
  }

  if (stage === 'pill') {
    // A pill with an activity line carries four things (tool, clock, plan, workers)
    // where a bare count carried one word, so it grows instead of truncating the
    // tool name to two letters.
    return {
      height: HEADER_HEIGHT,
      mode: 'floating',
      opacity: 1,
      radius: HEADER_HEIGHT / 2,
      width: rich ? (notched ? 316 : 268) : notched ? 236 : 190
    }
  }

  if (stage === 'attention') {
    return {
      height: HEADER_HEIGHT + cardHeight + SURFACE_PADDING,
      mode: 'floating',
      opacity: 1,
      radius: 22,
      width: notched ? 372 : 344
    }
  }

  if (stage === 'session') {
    // The session stage mounts the app's own chat view, which brings its own
    // composer and scrolling: it needs a panel, not one band per transcript line.
    return {
      height: sessionSize?.height ?? SESSION_HEIGHT,
      mode: 'expanded',
      opacity: 1,
      radius: 22,
      width: sessionSize?.width ?? SESSION_WIDTH
    }
  }

  const listHeight = rows === 0 ? 28 : rows * ROW_HEIGHT

  const height = Math.min(
    MAX_EXPANDED_HEIGHT,
    HEADER_HEIGHT + listHeight + SEARCH_FIELD_HEIGHT + SURFACE_PADDING * 2
  )

  return { height, mode: 'expanded', opacity: 1, radius: 24, width: EXPANDED_WIDTH }
}

/** Which edge the island's window is attached to, as main reports it. */
export type IslandDockSide = 'bottom' | 'free' | 'left' | 'right' | 'top'

/** Anything main did not name is a free island: a bad channel value must not
 *  square a corner against an edge the window is not on. */
export function islandDockSide(raw: unknown): IslandDockSide {
  return raw === 'bottom' || raw === 'left' || raw === 'right' || raw === 'top' ? raw : 'free'
}

/** The width the black surface needs before a command or a title is truncated
 *  into uselessness — used by the attention card's own line clamp. */
export function islandCardLineClamp(stage: IslandStage): number {
  return stage === 'attention' ? 2 : 3
}
