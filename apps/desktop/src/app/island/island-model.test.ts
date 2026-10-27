import { describe, expect, it } from 'vitest'

import { islandCountLabel, islandRows, islandStage } from './island-model'

const TITLES = { 's-a': 'Refactor the decoder', 's-b': 'Buchla notes', 's-c': 'Mix review' }

describe('islandRows', () => {
  it('lists a waiting session above running ones, whichever order the stores report', () => {
    const rows = islandRows({
      approvalsById: {},
      attentionIds: ['s-c'],
      titles: TITLES,
      workingIds: ['s-a', 's-b']
    })

    expect(rows.map(row => row.state)).toEqual(['needs-input', 'working', 'working'])
    expect(rows[0].id).toBe('s-c')
  })

  it('lists a session that is both busy and waiting ONCE, as needs-input', () => {
    const rows = islandRows({
      approvalsById: {},
      attentionIds: ['s-a'],
      titles: TITLES,
      workingIds: ['s-a']
    })

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: 's-a', state: 'needs-input' })
  })

  it('attaches the first parked approval to its session', () => {
    const approval = { command: 'rm -rf build', description: 'dangerous command', requestId: 'r-1' }

    const rows = islandRows({
      approvalsById: { 's-a': [approval, { ...approval, requestId: 'r-2' }] },
      attentionIds: ['s-a'],
      titles: TITLES,
      workingIds: []
    })

    expect(rows[0].approval?.requestId).toBe('r-1')
  })

  it('sorts within a group by title and tolerates an unknown session', () => {
    const rows = islandRows({
      approvalsById: {},
      attentionIds: [],
      titles: TITLES,
      workingIds: ['s-c', 'ghost', 's-a']
    })

    expect(rows.map(row => row.id)).toEqual(['ghost', 's-c', 's-a'])
    expect(rows[0].title).toBe('')
  })
})

describe('islandStage', () => {
  it('is hidden with nothing running — the zero-footprint idle state', () => {
    expect(islandStage({ attentionCount: 0, expanded: false, focused: false, workingCount: 0 })).toBe('hidden')
  })

  it('is a pill while work runs, and attention wins over it', () => {
    expect(islandStage({ attentionCount: 0, expanded: false, focused: false, workingCount: 2 })).toBe('pill')
    expect(islandStage({ attentionCount: 1, expanded: false, focused: false, workingCount: 2 })).toBe('attention')
  })

  it('stays expanded while the user has it open, even with nothing to show', () => {
    expect(islandStage({ attentionCount: 0, expanded: true, focused: false, workingCount: 0 })).toBe('expanded')
  })

  it('opens one session deeper than the list, and the list wins while it is open', () => {
    const open = { attentionCount: 1, expanded: false, focused: true, workingCount: 0 }

    expect(islandStage(open)).toBe('session')
    // A list the user opened is a step BACK from a session, so it outranks it.
    expect(islandStage({ ...open, expanded: true })).toBe('expanded')
  })
})

describe('islandCountLabel', () => {
  it('names attention first, else the running count, and nothing when hidden', () => {
    expect(islandCountLabel('attention', 2)).toEqual({ count: 2, kind: 'attention' })
    expect(islandCountLabel('pill', 3)).toEqual({ count: 3, kind: 'running' })
    expect(islandCountLabel('hidden', 0)).toBeNull()
  })
})
