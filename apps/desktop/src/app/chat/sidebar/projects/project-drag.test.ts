import { describe, expect, it } from 'vitest'

import { expandRowsToGroups, NEST_TRAVEL_PX, type ProjectNestRow, resolveProjectDropIntent } from './project-drag'
import type { SidebarProjectTree } from './workspace-groups'

const project = (id: string, over: Partial<SidebarProjectTree> = {}): SidebarProjectTree =>
  ({ id, isAuto: false, label: id, parentId: null, ...over }) as SidebarProjectTree

// Geometry only matters for the hit test; the element is never read by the pure resolver.
const row = (
  id: string,
  top: number,
  height: number
): Pick<ProjectNestRow, 'block' | 'el' | 'id' | 'rect'> => ({
  block: { bottom: top + height, left: 0, right: 220, top },
  el: null as unknown as HTMLElement,
  id,
  // The project's own row is one line tall; whatever follows inside the block is its session rows.
  rect: { bottom: top + 20, left: 0, right: 220, top }
})

/** `dev` is open with `align` nested inside it; `other` follows dev's region. */
const tree = [
  project('dev', { label: 'Dev' }),
  project('align', { label: 'Align', parentId: 'dev' }),
  project('other')
]

// dev: own row 0–20, a session row 20–40. align: own row 40–60, a session row 60–80. other: 80–100.
const rows = expandRowsToGroups(tree, [row('dev', 0, 40), row('align', 40, 40), row('other', 80, 20)])

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
    expect(onto('other', 50)).toEqual({ kind: 'into', targetId: 'align' })
  })

  it('nests into the ROOT of the region everywhere else, sessions included', () => {
    // 70px down: align's OWN session row — inside align's block and dev's region alike. The area
    // belongs to dev, so dev takes the subproject, not the nearest nested project.
    expect(onto('other', 70)).toEqual({ kind: 'into', targetId: 'dev' })
    // And dev's own session row, likewise.
    expect(onto('other', 30)).toEqual({ kind: 'into', targetId: 'dev' })
  })

  it('takes a nested project out on a leftward drag, whatever it is over', () => {
    expect(
      resolveProjectDropIntent({
        activeId: 'align',
        pointer: { dx: -(NEST_TRAVEL_PX + 2), x: 40, y: 50 },
        projects: tree,
        rows
      })
    ).toEqual({ kind: 'top' })
  })

  it('offers no top-level move to a project that is already there', () => {
    expect(
      resolveProjectDropIntent({ activeId: 'other', pointer: { dx: -40, x: 40, y: 50 }, projects: tree, rows })
    ).toBeNull()
  })

  it('refuses itself, its own descendants, and discovered rows', () => {
    const scanned = project('scanned', { isAuto: true })
    const withAuto = expandRowsToGroups([...tree, scanned], [row('other', 80, 20), row('scanned', 100, 20)])

    // The dragged row is out of the geometry entirely — it is under the pointer by definition.
    expect(onto('dev', 10)).toBeNull()
    // A descendant's own row resolves to the descendant, which cannot take its own ancestor.
    expect(onto('dev', 50)).toBeNull()
    expect(
      resolveProjectDropIntent({
        activeId: 'other',
        pointer: { dx: NEST_TRAVEL_PX + 4, x: 40, y: 110 },
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
    expect(rows.map(row => [row.id, row.rect.bottom, row.block.bottom, row.group.bottom])).toEqual([
      ['dev', 20, 40, 80],
      ['align', 60, 80, 80],
      ['other', 100, 100, 100]
    ])
  })

  it('contains a nested project inside its parent, so the parent keeps the pointer', () => {
    const dev = rows.find(row => row.id === 'dev')!
    const align = rows.find(row => row.id === 'align')!

    expect(align.group.top).toBeGreaterThan(dev.group.top)
    expect(align.group.bottom).toBe(dev.group.bottom)
  })
})
