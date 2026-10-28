/**
 * The island's own preferences (renderer side).
 *
 * MAIN is authoritative — it owns the OS window, the anchor display and the
 * global approval chord, and it must restore them on a cold launch without this
 * window ever visiting Settings. So this module never decides: it reads what the
 * bridge answers and caches it for the Settings rows, the same authority split
 * Quick Entry uses.
 *
 * Two other surfaces read it too: `store/native-notifications` (so an approval
 * does not arrive twice, once in the notch and once as a banner) and the island
 * shell itself (a disabled island has no window, so this only matters to the app
 * window).
 */

import { atom } from 'nanostores'

export interface IslandSettings {
  expandShortcut: string
  followPointer: boolean
  enabled: boolean
  sessionSize: { height: number; width: number } | null
  shortcut: string
  suppressApprovalNotifications: boolean
}

export interface IslandStatus extends IslandSettings {
  /** The expand chord the OS actually holds; '' when the user set none or it was taken. */
  registeredExpandShortcut: string
  /** The chord the OS actually holds; '' when the user set none or it was taken. */
  registeredShortcut: string
}

export type IslandSettingsPatch = Partial<IslandSettings>

export const ISLAND_DEFAULT_SETTINGS: IslandSettings = {
  expandShortcut: '',
  followPointer: false,
  enabled: true,
  sessionSize: null,
  shortcut: '',
  suppressApprovalNotifications: true
}

export interface IslandState extends IslandSettings {
  /** null before the first read; the Settings rows show their skeleton until then. */
  loaded: boolean
  registeredExpandShortcut: string
  registeredShortcut: string
}

export const $island = atom<IslandState>({
  ...ISLAND_DEFAULT_SETTINGS,
  loaded: false,
  registeredExpandShortcut: '',
  registeredShortcut: ''
})

type IslandBridge = NonNullable<Window['hermesDesktop']['island']>

function bridge(): IslandBridge | null {
  if (typeof window === 'undefined') {
    return null
  }

  return window.hermesDesktop?.island ?? null
}

function adopt(status: IslandStatus | undefined): void {
  if (!status) {
    return
  }

  $island.set({
    expandShortcut: typeof status.expandShortcut === 'string' ? status.expandShortcut : '',
    followPointer: status.followPointer === true,
    enabled: status.enabled === true,
    loaded: true,
    registeredExpandShortcut:
      typeof status.registeredExpandShortcut === 'string' ? status.registeredExpandShortcut : '',
    registeredShortcut: typeof status.registeredShortcut === 'string' ? status.registeredShortcut : '',
    sessionSize: status.sessionSize ?? null,
    shortcut: typeof status.shortcut === 'string' ? status.shortcut : '',
    suppressApprovalNotifications: status.suppressApprovalNotifications === true
  })
}

export async function loadIslandSettings(): Promise<void> {
  const api = bridge()

  if (!api) {
    return
  }

  adopt(await api.getSettings())
}

export async function saveIslandSettings(patch: IslandSettingsPatch): Promise<void> {
  const api = bridge()

  if (!api) {
    return
  }

  adopt(await api.setSettings(patch))
}

/**
 * Whether the OS notification for an approval should stand down because the
 * island is showing the same question. Read, not subscribed: the notification
 * path is called from event handlers, where a stale-by-one-frame read is
 * harmless and a subscription would be a second render loop.
 */
export function islandAnswersApprovals(): boolean {
  const state = $island.get()

  return state.loaded && state.enabled && state.suppressApprovalNotifications
}
