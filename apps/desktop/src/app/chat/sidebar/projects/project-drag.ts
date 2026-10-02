/**
 * Sidebar PROJECT drag — move a project INTO another project, or OUT to the top level.
 *
 * Projects are already draggable: `ReorderableList` sorts them with dnd-kit. Nesting rides that same
 * drag rather than adding a rival one, and the two are told apart by the gesture file trees use —
 * sideways travel. Straight up/down still reorders (untouched); sideways is structural:
 *
 *   drag right, anywhere over another project's group → add it as a subproject of that project
 *   drag left                                         → move out to the top level
 *
 * "Group", not "row": the hit area is the project's whole visible group — its row and everything
 * rendered under it while it is open — so a release between two of its rows, or in the gap below it,
 * nests just as its own row does. Groups nest, so the deepest one under the pointer wins.
 *
 * What the release will do is shown before it happens: a chip beside the pointer reads "Add subproject
 * to <name>" or "Top level", and the whole group it would land in is outlined. Neither appears while
 * the answer is a plain reorder, or a place a project cannot go — a discovered (auto) row owns no
 * project record, a project cannot be parented to itself or to one of its own descendants, and a
 * project already at the top level has nothing to pull out of.
 *
 * The backend owns the same rule (`projects.set_parent`, which refuses looping moves); this module
 * only decides intent, paints it, and hands the move to the store.
 */

import { queryAllVisible } from '@/components/pane-shell/pane-visibility'
import { rectContains } from '@/components/pane-shell/tree/renderer/drag-session'
import type { ZoneRect } from '@/components/pane-shell/tree/zones-engine'
import { createDragGhost, type DragGhost } from '@/lib/drag-ghost'

import type { NestResolver } from '../reorderable-list'

import { projectDescendantIds } from './model'
import type { SidebarProjectTree } from './workspace-groups'

/** Row tag `ProjectOverviewRow` puts on every project row (the same one session drops use). */
const ROW_ATTR = 'data-sessions-project'
/** Marks the outline drawn around the group a drop would nest into. */
const ZONE_ATTR = 'data-project-nest-zone'

/** Sideways travel (px) before a drag means "nest" / "take out" instead of "reorder". */
export const NEST_TRAVEL_PX = 18

export interface ProjectNestRow {
  el: HTMLElement
  id: string
  rect: ZoneRect
}

export interface ProjectDropPoint {
  /** Horizontal travel for the whole drag — the axis that separates nesting from reordering. */
  dx: number
  x: number
  y: number
}

/** What a release at that point does: nest into `targetId`, or move out to the top level. */
export type ProjectDropIntent = { kind: 'into'; targetId: string } | { kind: 'top' }

const snapRect = (el: HTMLElement): ZoneRect => {
  const r = el.getBoundingClientRect()

  return { bottom: r.bottom, left: r.left, right: r.right, top: r.top }
}

const area = (rect: ZoneRect) => (rect.right - rect.left) * (rect.bottom - rect.top)

/**
 * Widen each project row's hit area to cover its whole group: the row itself plus every row rendered
 * under it while it is open, down to the next row that is NOT nested inside it.
 *
 * Rows arrive as headers only, so no element carries the group's extent — the extent is what the
 * neighbouring header says: this project's group ends where the next project outside its subtree
 * begins, and the last group ends at the list's last row. A collapsed project therefore owns the gap
 * beneath it, which is exactly the space a "drop it in here" release lands on.
 */
export function expandRowsToGroups(
  projects: SidebarProjectTree[],
  rows: ProjectNestRow[]
): ProjectNestRow[] {
  const sorted = [...rows].sort((a, b) => a.rect.top - b.rect.top)
  const last = sorted[sorted.length - 1]

  return sorted.map((row, index) => {
    const subtree = projectDescendantIds(projects, row.id)
    const next = sorted.slice(index + 1).find(candidate => !subtree.has(candidate.id))
    const bottom = Math.max(row.rect.bottom, next ? next.rect.top : (last?.rect.bottom ?? row.rect.bottom))

    return { ...row, rect: { ...row.rect, bottom } }
  })
}

/** The innermost row whose group the point is inside. Groups nest, so a point sits in several at
 *  once and the deepest — the smallest — one is the project the release belongs to. */
const hitRow = (rows: ProjectNestRow[], x: number, y: number): ProjectNestRow | undefined =>
  rows
    .filter(row => row.id && rectContains(row.rect, x, y))
    .sort((a, b) => area(a.rect) - area(b.rect))[0]

/** Pure resolution, so the policy can be tested without a DOM: what does a release here do? */
export function resolveProjectDropIntent({
  activeId,
  pointer,
  projects,
  rows
}: {
  activeId: string
  pointer: ProjectDropPoint
  projects: SidebarProjectTree[]
  rows: ProjectNestRow[]
}): null | ProjectDropIntent {
  // A mostly-vertical drag is the reorder gesture — never take it over.
  if (Math.abs(pointer.dx) < NEST_TRAVEL_PX) {
    return null
  }

  const active = projects.find(project => project.id === activeId)

  // Pulled left: out of the parent, back to the top level. Nothing to undo for
  // a project already there.
  if (pointer.dx <= -NEST_TRAVEL_PX) {
    return active?.parentId ? { kind: 'top' } : null
  }

  // Pulled right: nest into whichever group the pointer is inside.
  const row = hitRow(rows, pointer.x, pointer.y)

  if (!row) {
    return null
  }

  const target = projects.find(project => project.id === row.id)

  // Auto (discovered) rows have no project record to parent to, and nothing
  // nests under itself or one of its own descendants.
  if (!target || target.isAuto || projectDescendantIds(projects, activeId).has(target.id)) {
    return null
  }

  return { kind: 'into', targetId: target.id }
}

/** The outline around the pending target group — the "it will land in here" affordance. */
function createZoneOutline() {
  const el = document.createElement('div')

  el.setAttribute(ZONE_ATTR, '')
  el.style.cssText =
    'position:fixed;z-index:9998;pointer-events:none;border-radius:0.375rem;' +
    'outline:1px solid var(--color-sidebar-ring);outline-offset:-1px'
  document.body.appendChild(el)

  return {
    destroy: () => el.remove(),
    paint: (rect: ZoneRect) => {
      el.style.left = `${rect.left}px`
      el.style.top = `${rect.top}px`
      el.style.width = `${rect.right - rect.left}px`
      el.style.height = `${rect.bottom - rect.top}px`
    }
  }
}

/**
 * The `ReorderableList` policy for the projects list: snapshots the groups when a drag engages, paints
 * the pending outcome on every move, and commits it on release. Only the drop answers non-null, and
 * only for a structural move — everything else stays a reorder.
 */
export function createProjectNestResolver(deps: {
  /** The sidebar's projects, read live: labels, nesting and auto flags change between drags. */
  projects: () => SidebarProjectTree[]
  /** Commit a move through the store (RPC + optimistic tree patch). */
  setParent: (projectId: string, parentId: string) => void
  /** Chip text for each outcome. */
  strings: { nestInto: (name: string) => string; topLevel: string }
}): NestResolver {
  let rows: ProjectNestRow[] = []
  let ghost: DragGhost | null = null
  let zone: ReturnType<typeof createZoneOutline> | null = null

  const hidePaint = () => {
    ghost?.destroy()
    ghost = null
    zone?.destroy()
    zone = null
  }

  const teardown = () => {
    hidePaint()
    rows = []
  }

  return info => {
    if (info.phase === 'start') {
      const snapshot = queryAllVisible<HTMLElement>(`[${ROW_ATTR}]`).map(el => ({
        el,
        id: el.dataset.sessionsProject || '',
        rect: snapRect(el)
      }))

      rows = expandRowsToGroups(deps.projects(), snapshot)

      return null
    }

    if (info.phase === 'cancel') {
      teardown()

      return null
    }

    const projects = deps.projects()

    const intent = info.pointer
      ? resolveProjectDropIntent({ activeId: info.activeId, pointer: info.pointer, projects, rows })
      : null

    if (info.phase === 'move') {
      const row = intent?.kind === 'into' ? rows.find(candidate => candidate.id === intent.targetId) : null

      if (info.pointer && intent) {
        const target = intent.kind === 'into' ? projects.find(project => project.id === intent.targetId) : null

        if (!ghost) {
          ghost = createDragGhost('')
        }

        ghost.setLabel(intent.kind === 'top' ? deps.strings.topLevel : deps.strings.nestInto(target?.label ?? ''))
        ghost.moveTo(info.pointer.x, info.pointer.y)
      } else {
        hidePaint()
      }

      if (row) {
        zone ??= createZoneOutline()
        zone.paint(row.rect)
      } else {
        zone?.destroy()
        zone = null
      }

      return null
    }

    // Drop: commit when this is a structural move that actually changes something, then hand the drop
    // over (a non-null answer) so the list does not also reorder.
    const active = projects.find(project => project.id === info.activeId)
    const unchanged = intent?.kind === 'into' ? active?.parentId === intent.targetId : !active?.parentId

    teardown()

    if (!intent || unchanged) {
      return null
    }

    deps.setParent(info.activeId, intent.kind === 'into' ? intent.targetId : '')

    return { targetId: intent.kind === 'into' ? intent.targetId : null }
  }
}
