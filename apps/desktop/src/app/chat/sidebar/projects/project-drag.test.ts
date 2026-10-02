import { describe, expect, it } from 'vitest'

import { expandRowsToGroups, NEST_TRAVEL_PX, type ProjectNestRow, resolveProjectDropIntent } from './project-drag'
import type { SidebarProjectTree } from './workspace-groups'

const project = (id: string, over: Partial<SidebarProjectTree> = {}): SidebarProjectTree =>
  ({ id, isAuto: false, label: id, parentId: null, ...over }) as SidebarProjectTree

// Geometry only matters for the hit test; the element is never read by the pure resolver.
const header = (id: string, top: number): Pick<ProjectNestRow, 'el' | 'id' | 'rect'> => ({
  el: null as unknown as HTMLElement,
  id,
  rect: { bottom: top + 20, left: 0, right: 200, top }
})

/** `dev` is open with `align` nested inside it; `other` is the next project after dev's region. */
const tree = [
  project('dev', { label: 'Dev' }),
  project('align', { label: 'Align', parentId: 'dev' }),
  project('other')
]

// 20px rows: dev's row, then 60px of dev's own region below it (align's row and the sessions of
// both), then other.
const rows = expandRowsToGroups(tree, [header('dev', 0), header('align', 20), header('other', 100)])

/** Drag `other` sideways-right to a point. */
const onto = (activeId: string, y: number) =>
  resolveProjectDropIntent({ activeId, pointer: { dx: NEST_TRAVEL_PX + 4, x: 40, y }, projects: tree, rows })

describe('resolveProjectDropIntent', () => {
  it('leaves a mostly-vertical drag to the reorder', () => {
    expect(
      resolveProjectDropIntent({ activeId: 'other', pointer: { dx: 4, x: 40, y: 30 }, projects: tree, rows })
    ).toBeNull()
  })

  it("nests into the project whose own row the pointer is on — nested projects included", () => {
    expect(onto('other', 10)).toEqual({ kind: 'into', targetId: 'dev' })
    // The one way to reach a project that is already nested.
    expect(onto('other', 30)).toEqual({ kind: 'into', targetId: 'align' })
  })

  it('nests into the ROOT of the region when the pointer is between rows', () => {
    // 70px down: below align's own row, still inside dev's region — where dev's own sessions sit.
    // The area belongs to dev, so dev takes the subproject, not the nearest descendant.
    expect(onto('other', 70)).toEqual({ kind: 'into', targetId: 'dev' })
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
    const scanned = project('scanned', { isAuto: true })
    const withAuto = expandRowsToGroups([...tree, scanned], [header('scanned', 120), header('other', 100)])

    // Its own row is skipped outright — during a drag it is under the pointer.
    expect(onto('dev', 10)).toBeNull()
    // A descendant region resolves to the descendant, which cannot take its own ancestor.
    expect(onto('dev', 30)).toBeNull()
    expect(
      resolveProjectDropIntent({
        activeId: 'other',
        pointer: { dx: NEST_TRAVEL_PX + 4, x: 40, y: 130 },
        projects: [...tree, scanned],
        rows: withAuto
      })
    ).toBeNull()
  })

  it('does nothing when the drag ends away from every row', () => {
    expect(onto('other', 480)).toBeNull()
  })
})

describe('expandRowsToGroups', () => {
  it('stretches each row over the region it heads', () => {
    expect(rows.map(row => [row.id, row.rect.bottom, row.group.bottom])).toEqual([
      ['dev', 20, 100],
      ['align', 40, 100],
      ['other', 120, 120]
    ])
  })

  it('contains a nested project inside its parent, so the parent keeps the pointer', () => {
    const dev = rows.find(row => row.id === 'dev')!
    const align = rows.find(row => row.id === 'align')!

    expect(align.group.top).toBeGreaterThan(dev.group.top)
    expect(align.group.bottom).toBe(dev.group.bottom)
  })
})
