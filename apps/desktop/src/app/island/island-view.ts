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
/** One open session: narrower than the list, taller per row (text wraps). */
const SESSION_WIDTH = 420
const SESSION_ROW_HEIGHT = 34
const SESSION_MAX_ROWS = 4
const MAX_EXPANDED_HEIGHT = 420
const ROW_HEIGHT = 26
const COMPOSER_HEIGHT = 44
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

export function islandShape(input: { notched: boolean; rich?: boolean; rows: number; stage: IslandStage }): IslandShape {
  const { notched, rich = false, rows, stage } = input

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
      height: HEADER_HEIGHT + ATTENTION_CARD_HEIGHT + SURFACE_PADDING,
      mode: 'floating',
      opacity: 1,
      radius: 22,
      width: notched ? 372 : 344
    }
  }

  if (stage === 'session') {
    const lines = Math.min(SESSION_MAX_ROWS, Math.max(1, rows))

    return {
      height: HEADER_HEIGHT + lines * SESSION_ROW_HEIGHT + COMPOSER_HEIGHT + SURFACE_PADDING * 2,
      mode: 'expanded',
      opacity: 1,
      radius: 22,
      width: SESSION_WIDTH
    }
  }

  const listHeight = rows === 0 ? 28 : rows * ROW_HEIGHT

  const height = Math.min(
    MAX_EXPANDED_HEIGHT,
    HEADER_HEIGHT + listHeight + COMPOSER_HEIGHT + SURFACE_PADDING * 2
  )

  return { height, mode: 'expanded', opacity: 1, radius: 24, width: EXPANDED_WIDTH }
}

/** The width the black surface needs before a command or a title is truncated
 *  into uselessness — used by the attention card's own line clamp. */
export function islandCardLineClamp(stage: IslandStage): number {
  return stage === 'attention' ? 2 : 3
}
