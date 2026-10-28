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

  it('reads a parked position, and a broken one as "never moved"', () => {
    expect(sanitizeIslandSettings({ origin: { x: 640.4, y: 12.6 } }).origin).toEqual({ x: 640, y: 13 })
    // Half a coordinate is not a position: restoring one of them parks the pill
    // on a display edge it cannot be dragged back from.
    expect(sanitizeIslandSettings({ origin: { x: 640 } }).origin).toBeNull()
    expect(sanitizeIslandSettings({ origin: { x: 'left', y: 0 } }).origin).toBeNull()
    expect(sanitizeIslandSettings({ origin: null }).origin).toBeNull()
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

  it('leaves the parked position alone: the renderer never patches a coordinate', () => {
    const parked = sanitizeIslandSettings({ origin: { x: 10, y: 20 } })

    expect(withIslandPatch(parked, { followPointer: true, origin: { x: 0, y: 0 } }).origin).toEqual({ x: 10, y: 20 })
  })
})
