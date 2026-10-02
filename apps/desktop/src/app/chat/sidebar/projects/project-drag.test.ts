import { describe, expect, it } from 'vitest'

import { NEST_TRAVEL_PX, type ProjectNestRow, resolveProjectDropIntent } from './project-drag'
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
