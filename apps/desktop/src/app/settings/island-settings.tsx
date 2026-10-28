import { useStore } from '@nanostores/react'
import { useEffect, useState } from 'react'

import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n'
import { isSubmitEnter } from '@/lib/ime'
import { $island, loadIslandSettings, saveIslandSettings } from '@/store/island'

import { ListRow, ToggleRow } from './primitives'
import { SETTING_IDS, settingElementId } from './settings-manifest'

/**
 * The Dynamic Island's settings rows.
 *
 * MAIN is authoritative (it owns the window, the anchor display and the approval
 * chord), so every row round-trips through the bridge and adopts the state that
 * actually resulted — turning the island off destroys its window rather than
 * hiding it, and that is main's decision to make.
 */
export function IslandSettings() {
  const { t } = useI18n()
  const copy = t.settings.island
  const state = useStore($island)
  // The chord is a local draft until blur/Enter, so a half-typed binding never
  // tears down the accelerator the OS is currently holding.
  const [draft, setDraft] = useState<null | string>(null)
  const [note, setNote] = useState<null | string>(null)
  // Two chords, two drafts: a half-typed expand binding must not tear down the
  // approval accelerator either.
  const [expandDraft, setExpandDraft] = useState<null | string>(null)
  const [expandNote, setExpandNote] = useState<null | string>(null)

  useEffect(() => {
    void loadIslandSettings()
  }, [])

  if (!window.hermesDesktop?.island?.getSettings) {
    return null
  }

  const commit = async () => {
    const wanted = (draft ?? '').trim()

    setDraft(null)
    setNote(null)

    if (wanted === state.shortcut) {
      return
    }

    await saveIslandSettings({ shortcut: wanted })

    const saved = $island.get()

    // Two ways a chord fails to become the one the OS holds: main refused it as
    // unparseable (it keeps the old value) or another app already owns it (the
    // registration came back empty). Both are said out loud, under the field.
    if (wanted && !saved.shortcut) {
      setNote(copy.shortcutInvalid)
    } else if (saved.shortcut && saved.registeredShortcut !== saved.shortcut) {
      setNote(copy.shortcutTaken)
    }
  }

  const commitExpand = async () => {
    const wanted = (expandDraft ?? '').trim()

    setExpandDraft(null)
    setExpandNote(null)

    if (wanted === state.expandShortcut) {
      return
    }

    await saveIslandSettings({ expandShortcut: wanted })

    const saved = $island.get()

    if (wanted && !saved.expandShortcut) {
      setExpandNote(copy.shortcutInvalid)
    } else if (saved.expandShortcut && saved.registeredExpandShortcut !== saved.expandShortcut) {
      setExpandNote(copy.shortcutTaken)
    }
  }

  return (
    <>
      <ToggleRow
        checked={state.enabled}
        description={copy.enabledDesc}
        id={settingElementId(SETTING_IDS.advanced.island)}
        label={copy.enabledTitle}
        onChange={enabled => void saveIslandSettings({ enabled })}
      />
      <ToggleRow
        checked={state.followPointer}
        description={copy.displayDesc}
        disabled={!state.enabled}
        id={settingElementId(SETTING_IDS.advanced.islandDisplay)}
        label={copy.displayTitle}
        onChange={followPointer => void saveIslandSettings({ followPointer })}
      />
      <ToggleRow
        checked={state.suppressApprovalNotifications}
        description={copy.notificationsDesc}
        disabled={!state.enabled}
        id={settingElementId(SETTING_IDS.advanced.islandNotifications)}
        label={copy.notificationsTitle}
        onChange={suppressApprovalNotifications => void saveIslandSettings({ suppressApprovalNotifications })}
      />
      <ListRow
        action={
          <Input
            aria-label={copy.expandShortcutTitle}
            disabled={!state.enabled}
            onBlur={() => void commitExpand()}
            onChange={event => setExpandDraft(event.target.value)}
            onKeyDown={event => {
              if (isSubmitEnter(event)) {
                event.preventDefault()
                void commitExpand()
              }
            }}
            value={expandDraft ?? state.expandShortcut}
          />
        }
        below={
          expandNote && (
            <div className="mt-1 text-[length:var(--conversation-caption-font-size)] text-amber-500/90">
              {expandNote}
            </div>
          )
        }
        description={copy.expandShortcutDesc}
        id={settingElementId(SETTING_IDS.advanced.islandExpandShortcut)}
        title={copy.expandShortcutTitle}
      />
      <ListRow
        action={
          <Input
            aria-label={copy.shortcutTitle}
            disabled={!state.enabled}
            onBlur={() => void commit()}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={event => {
              if (isSubmitEnter(event)) {
                event.preventDefault()
                void commit()
              }
            }}
            value={draft ?? state.shortcut}
          />
        }
        below={
          note && (
            <div className="mt-1 text-[length:var(--conversation-caption-font-size)] text-amber-500/90">{note}</div>
          )
        }
        description={copy.shortcutDesc}
        id={settingElementId(SETTING_IDS.advanced.islandShortcut)}
        title={copy.shortcutTitle}
      />
    </>
  )
}
