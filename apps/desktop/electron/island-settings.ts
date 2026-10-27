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

export interface IslandSettings {
  /** Put the island on the display under the pointer, not the primary one. */
  followPointer: boolean
  /** Off means the window is never created at all — no renderer, no surface. */
  enabled: boolean
  /** Global chord that approves the card on top; '' means none. */
  shortcut: string
  /** With the island answering, the OS notification is a second prompt for one approval. */
  suppressApprovalNotifications: boolean
}

export const ISLAND_DEFAULTS: IslandSettings = {
  followPointer: false,
  enabled: true,
  shortcut: '',
  suppressApprovalNotifications: true
}

/**
 * Raw persisted JSON → usable settings. A malformed or absent file reads as the
 * defaults, and an unparseable chord reads as "no chord" rather than as a
 * registration the OS will silently refuse.
 */
export function sanitizeIslandSettings(raw: unknown): IslandSettings {
  const record = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const shortcut = typeof record.shortcut === 'string' ? record.shortcut.trim() : ''

  return {
    followPointer: record.followPointer === true,
    enabled: record.enabled === undefined ? ISLAND_DEFAULTS.enabled : record.enabled === true,
    shortcut: shortcut && parseQuickEntryShortcut(shortcut).ok ? shortcut : '',
    suppressApprovalNotifications:
      record.suppressApprovalNotifications === undefined
        ? ISLAND_DEFAULTS.suppressApprovalNotifications
        : record.suppressApprovalNotifications === true
  }
}

/** What Settings reads back: the saved preferences plus what the OS actually holds. */
export interface IslandStatus extends IslandSettings {
  /** The chord the OS accepted, or '' when none is registered. */
  registeredShortcut: string
}

/** Merge a partial patch over the saved settings, keeping every field valid. */
export function withIslandPatch(current: IslandSettings, patch: unknown): IslandSettings {
  const next = patch && typeof patch === 'object' ? (patch as Record<string, unknown>) : {}

  return sanitizeIslandSettings({
    followPointer: next.followPointer === undefined ? current.followPointer : next.followPointer,
    enabled: next.enabled === undefined ? current.enabled : next.enabled,
    shortcut: next.shortcut === undefined ? current.shortcut : next.shortcut,
    suppressApprovalNotifications:
      next.suppressApprovalNotifications === undefined
        ? current.suppressApprovalNotifications
        : next.suppressApprovalNotifications
  })
}
