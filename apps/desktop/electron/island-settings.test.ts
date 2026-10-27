import { describe, expect, it } from 'vitest'

import { ISLAND_DEFAULTS, sanitizeIslandSettings, withIslandPatch } from './island-settings'

describe('sanitizeIslandSettings', () => {
  it('reads a missing or malformed file as the shipped defaults', () => {
    expect(sanitizeIslandSettings(undefined)).toEqual(ISLAND_DEFAULTS)
    expect(sanitizeIslandSettings('nonsense')).toEqual(ISLAND_DEFAULTS)
    expect(sanitizeIslandSettings({})).toEqual(ISLAND_DEFAULTS)
  })

  it('keeps an explicit off switch off — the window must not be created', () => {
    expect(sanitizeIslandSettings({ enabled: false }).enabled).toBe(false)
    // Only a literal true turns anything on: a stray string must not.
    expect(sanitizeIslandSettings({ enabled: 'yes' }).enabled).toBe(false)
  })

  it('drops a chord the OS would refuse instead of registering it', () => {
    expect(sanitizeIslandSettings({ shortcut: 'Alt+' }).shortcut).toBe('')
    expect(sanitizeIslandSettings({ shortcut: '   ' }).shortcut).toBe('')
  })

  it('keeps a valid chord', () => {
    expect(sanitizeIslandSettings({ shortcut: 'CommandOrControl+Shift+I' }).shortcut).toBe(
      'CommandOrControl+Shift+I'
    )
  })

  it('defaults the approval hand-off on, because two prompts for one approval is the bug', () => {
    expect(ISLAND_DEFAULTS.suppressApprovalNotifications).toBe(true)
    expect(sanitizeIslandSettings({ suppressApprovalNotifications: false }).suppressApprovalNotifications).toBe(false)
  })
})

describe('withIslandPatch', () => {
  const current = sanitizeIslandSettings({ enabled: true, followPointer: false, shortcut: 'Command+Shift+I' })

  it('changes only the field the patch names', () => {
    expect(withIslandPatch(current, { followPointer: true })).toEqual({ ...current, followPointer: true })
  })

  it('never lets a patch blank a chord by omission', () => {
    expect(withIslandPatch(current, { enabled: false }).shortcut).toBe('Command+Shift+I')
  })

  it('does clear a chord the user deliberately emptied', () => {
    expect(withIslandPatch(current, { shortcut: '' }).shortcut).toBe('')
  })
})
