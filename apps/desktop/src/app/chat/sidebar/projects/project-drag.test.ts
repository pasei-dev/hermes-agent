import { describe, expect, it } from 'vitest'

import {
  expandRowsToGroups,
  NEST_TRAVEL_PX,
  type ProjectNestRow,
  resolveProjectDropIntent
} from './project-drag'
import type { SidebarProjectTree } from './workspace-groups'

const project = (id: string, over: Partial<SidebarProjectTree> = {}): SidebarProjectTree =>
  ({ id, isAuto: false, label: id, parentId: null, ...over }) as SidebarProjectTree

// Geometry only matters for the hit test; the element is never read by the pure resolver.
const row = (id: string, top: number): ProjectNestRow =>
  ({ el: null as unknown as HTMLElement, id, rect: { bottom: top + 20, left: 0, right: 200, top } })

const tree = [
  project('dev', { label: 'Dev' }),
  project('align', { label: 'Align', parentId: 'dev' }),
  project('leaf', { label: 'Leaf', parentId: 'align' }),
  project('other', { label: 'Other' }),
  project('scanned', { label: 'Scanned', isAuto: true })
]

const rows = [row('dev', 0), row('align', 20), row('leaf', 40), row('other', 60), row('scanned', 80)]

/** Drag `activeId` sideways-right onto `targetId`'s row. */
const onto = (activeId: string, targetId: string) => {
  const y = rows.find(candidate => candidate.id === targetId)!.rect.top + 10

  return resolveProjectDropIntent({
    activeId,
    pointer: { dx: NEST_TRAVEL_PX + 4, x: 40, y },
    projects: tree,
    rows
  })
}

describe('resolveProjectDropIntent', () => {
  it('leaves a mostly-vertical drag to the reorder', () => {
    expect(
      resolveProjectDropIntent({ activeId: 'other', pointer: { dx: 4, x: 40, y: 30 }, projects: tree, rows })
    ).toBeNull()
  })

  it('nests into the row a rightward drag is over', () => {
    expect(onto('other', 'dev')).toEqual({ kind: 'into', targetId: 'dev' })
  })

  it('takes a nested project out on a leftward drag, whatever it is over', () => {
    expect(
      resolveProjectDropIntent({
        activeId: 'align',
        pointer: { dx: -(NEST_TRAVEL_PX + 2), x: 40, y: 30 },
        projects: tree,
        rows
      })
    ).toEqual({ kind: 'top' })
  })

  it('offers no top-level move to a project that is already there', () => {
    expect(
      resolveProjectDropIntent({ activeId: 'other', pointer: { dx: -40, x: 40, y: 30 }, projects: tree, rows })
    ).toBeNull()
  })

  it('refuses itself, its own descendants, and discovered rows', () => {
    expect(onto('dev', 'dev')).toBeNull()
    expect(onto('dev', 'align')).toBeNull()
    expect(onto('dev', 'leaf')).toBeNull()
    expect(onto('other', 'scanned')).toBeNull()
  })

  it('does nothing when the drag ends away from every row', () => {
    expect(
      resolveProjectDropIntent({ activeId: 'other', pointer: { dx: 60, x: 480, y: 480 }, projects: tree, rows })
    ).toBeNull()
  })
})

describe('expandRowsToGroups', () => {
  // Headers only (that is what the DOM query yields), so the group's extent is read off the next
  // header that is not nested inside it.
  const projects = [project('dev', { label: 'Dev' }), project('align', { parentId: 'dev' }), project('other')]
  const headers = [row('dev', 0), row('align', 60), row('other', 100)]

  it('stretches each project row over the rows of its own group', () => {
    expect(expandRowsToGroups(projects, headers).map(g => [g.id, g.rect.bottom])).toEqual([
      ['dev', 100],
      ['align', 100],
      ['other', 120]
    ])
  })

  it('lets a release between the rows of a group nest into it, and the deepest group win', () => {
    const groups = expandRowsToGroups(projects, headers)
    // 90px down the list: below align's own row, inside both dev's and align's group.
    expect(
      resolveProjectDropIntent({
        activeId: 'other',
        pointer: { dx: NEST_TRAVEL_PX + 4, x: 40, y: 90 },
        projects,
        rows: groups
      })
    ).toEqual({ kind: 'into', targetId: 'align' })
  })
})
