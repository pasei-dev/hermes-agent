/**
 * Sidebar PROJECT drag — move a project INTO another project, or OUT to the top level.
 *
 * Projects are already draggable: `ReorderableList` sorts them with dnd-kit. Nesting rides that same
 * drag rather than adding a rival one, and the two are told apart by the gesture file trees use —
 * sideways travel. Straight up/down still reorders (untouched); sideways is structural:
 *
 *   drag right, onto another project's row → nest under that project
 *   drag left                             → move out to the top level
 *
 * What the release will do is shown before it happens: a chip beside the pointer reads "Nest in
 * <name>" or "Top level", and the row it would land in gets a ring. Neither appears while the answer
 * is a plain reorder, or a place a project cannot go — a discovered (auto) row owns no project
 * record, a project cannot be parented to itself or to one of its own descendants, and a project
 * already at the top level has nothing to pull out of.
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
/** Painted on the row this drop would nest into. */
const ROW_RING_ATTR = 'data-project-drop-hover'

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

  // Pulled right: nest into whatever row it is over.
  const row = rows.find(candidate => candidate.id && rectContains(candidate.rect, pointer.x, pointer.y))

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

/**
 * The `ReorderableList` policy for the projects list: snapshots the rows when a drag engages, paints
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
  let hovered: HTMLElement | null = null

  const paintRow = (el: HTMLElement | null) => {
    if (hovered === el) {
      return
    }

    hovered?.removeAttribute(ROW_RING_ATTR)
    hovered = el
    hovered?.setAttribute(ROW_RING_ATTR, 'true')
  }

  const hideChip = () => {
    ghost?.destroy()
    ghost = null
  }

  const teardown = () => {
    paintRow(null)
    hideChip()
    rows = []
  }

  return info => {
    if (info.phase === 'start') {
      rows = queryAllVisible<HTMLElement>(`[${ROW_ATTR}]`).map(el => ({
        el,
        id: el.dataset.sessionsProject || '',
        rect: snapRect(el)
      }))

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
      if (info.pointer && intent) {
        const target = intent.kind === 'into' ? projects.find(project => project.id === intent.targetId) : null

        if (!ghost) {
          ghost = createDragGhost('')
        }

        ghost.setLabel(intent.kind === 'top' ? deps.strings.topLevel : deps.strings.nestInto(target?.label ?? ''))
        ghost.moveTo(info.pointer.x, info.pointer.y)
      } else {
        hideChip()
      }

      paintRow(intent?.kind === 'into' ? rows.find(row => row.id === intent.targetId)?.el ?? null : null)

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
