/**
 * The island's device-local preferences.
 *
 * MAIN is authoritative, the same split Quick Entry uses: it owns the OS window
 * (and, for the approval chord, a global shortcut), so it must restore the
 * user's choice on a cold launch without the renderer ever visiting Settings. The
 * renderer keeps a mirror (`store/island.ts`) and treats what this module returns
 * as the truth.
 *
 * Everything here is a fact about THIS machine's screen and keyboard, not about
 * the profile — which is why it lives beside Quick Entry in userData rather than
 * in config.yaml.
 */

import { parseQuickEntryShortcut } from './quick-entry'

export interface IslandOrigin {
  x: number
  y: number
}

/** The size the user dragged the open session panel to. */
export interface IslandSize {
  height: number
  width: number
}

export interface IslandSettings {
  /** Put the island on the display under the pointer, not the primary one. */
  followPointer: boolean
  /** Off means the window is never created at all — no renderer, no surface. */
  enabled: boolean
  /** Global chord that expands the list; '' means none. */
  expandShortcut: string
  /**
   * Where the user last parked the floating pill, in screen coordinates. Null
   * means "at the anchor". A notch belongs to the housing and never moves, so
   * this is only ever read on a display without one.
   */
  origin: IslandOrigin | null
  /** Global chord that approves the card on top; '' means none. */
  shortcut: string
  /** Size the user dragged the open session panel to; null keeps the default. */
  sessionSize: IslandSize | null
  /** With the island answering, the OS notification is a second prompt for one approval. */
  suppressApprovalNotifications: boolean
}

export const ISLAND_DEFAULTS: IslandSettings = {
  expandShortcut: '',
  followPointer: false,
  enabled: true,
  origin: null,
  sessionSize: null,
  shortcut: '',
  suppressApprovalNotifications: true
}

/**
 * A remembered panel size inside the island window's own ceiling. A size beyond
 * it would be clipped by the window, and a tiny one could not hold a header and
 * a transcript.
 */
export function sanitizeSessionSize(raw: unknown): IslandSize | null {
  const record = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null

  if (!record) {
    return null
  }

  const width = Number(record.width)
  const height = Number(record.height)

  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return null
  }

  return {
    height: Math.round(Math.min(546, Math.max(260, height))),
    width: Math.round(Math.min(478, Math.max(340, width)))
  }
}

/** A parked position is two finite numbers or it is nothing. */
function sanitizeOrigin(raw: unknown): IslandOrigin | null {
  const record = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null

  if (!record) {
    return null
  }

  const x = Number(record.x)
  const y = Number(record.y)

  return Number.isFinite(x) && Number.isFinite(y) ? { x: Math.round(x), y: Math.round(y) } : null
}

/**
 * Raw persisted JSON → usable settings. A malformed or absent file reads as the
 * defaults, and an unparseable chord reads as "no chord" rather than as a
 * registration the OS will silently refuse.
 */
export function sanitizeIslandSettings(raw: unknown): IslandSettings {
  const record = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const shortcut = typeof record.shortcut === 'string' ? record.shortcut.trim() : ''
  const expandShortcut = typeof record.expandShortcut === 'string' ? record.expandShortcut.trim() : ''

  return {
    expandShortcut: expandShortcut && parseQuickEntryShortcut(expandShortcut).ok ? expandShortcut : '',
    followPointer: record.followPointer === true,
    enabled: record.enabled === undefined ? ISLAND_DEFAULTS.enabled : record.enabled === true,
    origin: sanitizeOrigin(record.origin),
    sessionSize: sanitizeSessionSize(record.sessionSize),
    shortcut: shortcut && parseQuickEntryShortcut(shortcut).ok ? shortcut : '',
    suppressApprovalNotifications:
      record.suppressApprovalNotifications === undefined
        ? ISLAND_DEFAULTS.suppressApprovalNotifications
        : record.suppressApprovalNotifications === true
  }
}

/** What Settings reads back: the saved preferences plus what the OS actually holds. */
export interface IslandStatus extends IslandSettings {
  /** The chord the OS accepted for expanding the list, or '' when none is registered. */
  registeredExpandShortcut: string
  /** The chord the OS accepted, or '' when none is registered. */
  registeredShortcut: string
}

/** Merge a partial patch over the saved settings, keeping every field valid. */
export function withIslandPatch(current: IslandSettings, patch: unknown): IslandSettings {
  const next = patch && typeof patch === 'object' ? (patch as Record<string, unknown>) : {}

  return sanitizeIslandSettings({
    expandShortcut: next.expandShortcut === undefined ? current.expandShortcut : next.expandShortcut,
    followPointer: next.followPointer === undefined ? current.followPointer : next.followPointer,
    enabled: next.enabled === undefined ? current.enabled : next.enabled,
    // The parked position is main's own state: the renderer drags the window, it
    // never patches a coordinate pair, and a stale one from Settings would move
    // the pill for no reason.
    origin: current.origin,
    sessionSize: next.sessionSize === undefined ? current.sessionSize : sanitizeSessionSize(next.sessionSize),
    shortcut: next.shortcut === undefined ? current.shortcut : next.shortcut,
    suppressApprovalNotifications:
      next.suppressApprovalNotifications === undefined
        ? current.suppressApprovalNotifications
        : next.suppressApprovalNotifications
  })
}
