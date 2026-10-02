/**
 * Sidebar PROJECT drag — move a project INTO another project, or OUT to the top level.
 *
 * Projects are already draggable: `ReorderableList` sorts them with dnd-kit. Nesting rides that same
 * drag rather than adding a rival one, and the two are told apart by the gesture file trees use —
 * sideways travel. Straight up/down still reorders (untouched); sideways is structural:
 *
 *   drag right, anywhere over another project's region → add it as a subproject of that project
 *   drag left                                          → move out to the top level
 *
 * Which project, exactly? Point at a project's OWN row and you get that project — the only way to
 * reach a nested one. Anywhere else in its region (between its rows, over its sessions, over the
 * subprojects nested inside it) you get the ROOT of that region: the outermost project it belongs to.
 * A nested project's territory is part of its parent's, so a release between a subproject's rows
 * nests into the parent, never into whichever descendant happened to be nearest.
 *
 * What the release will do is shown before it happens: a chip beside the pointer reads "Add subproject
 * to <name>" or "Top level", and the whole region it would land in — nested subprojects included — is
 * outlined. Both follow the list as it scrolls, and neither appears while the answer is a plain
 * reorder (a mostly-vertical drag) or a place a project cannot go: a discovered (auto) row owns no
 * project record, a project cannot be parented to itself or to one of its own descendants, and a
 * project already at the top level has nothing to pull out of. Row tooltips are muted for the length
 * of the drag, so the chip is the only text saying what is about to happen.
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

/** Row tag `ProjectOverviewRow` puts on every project wrapper — the row plus its own session rows. */
const ROW_ATTR = 'data-sessions-project'
/** The project's own row element inside that wrapper. Pointing here means THIS project; anywhere
 *  else in its block (its session rows) or its region (nested subprojects) means its root. */
const HEADER_ATTR = 'data-project-row'
/** Marks the outline drawn around the region a drop would nest into. */
const ZONE_ATTR = 'data-project-nest-zone'
/** Set on `<body>` for the length of a project drag. */
const DRAG_ATTR = 'data-project-drag'
/** Tooltips (the caret's "Show/Hide … sessions" one especially) are noise mid-drag: the chip is the
 *  thing saying what the release does, and a second label disagreeing with it is worse than none. */
const MUTE_CSS = `body[${DRAG_ATTR}] [role="tooltip"]{display:none!important}`

/** Sideways travel (px) before a drag means "nest" / "take out" instead of "reorder". */
export const NEST_TRAVEL_PX = 18

export interface ProjectNestRow {
  el: HTMLElement
  id: string
  /** The project's own row — pointing here means THIS project. */
  rect: ZoneRect
  /** The project's rendered block: its row and its own session rows. */
  block: ZoneRect
  /** The block extended over every row of the region it heads, nested subprojects included. */
  group: ZoneRect
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

/** Every visible project row with the geometry of the moment: a `rect` for the row itself, a `group`
 *  for the region it heads. Re-read on every pointer move and on scroll, so the answer survives a
 *  list that scrolls or reorders underneath the pointer.
 *
 *  `excludeId` drops the row being dragged. It is not a boundary: dnd-kit slides it under the pointer,
 *  so leaving it in would end the region above it exactly where the pointer is — the frame would stop
 *  at the dragged row and nothing under the pointer would match at all.
 */
export function readProjectRows(projects: SidebarProjectTree[], excludeId = ''): ProjectNestRow[] {
  return expandRowsToGroups(
    projects,
    queryAllVisible<HTMLElement>(`[${ROW_ATTR}]`)
      .filter(el => (el.dataset.sessionsProject || '') !== excludeId)
      .map(el => {
        const block = snapRect(el)
        const header = el.querySelector<HTMLElement>(`[${HEADER_ATTR}]`)

        return {
          block,
          el,
          id: el.dataset.sessionsProject || '',
          // No header element (an older row, or a skin that drops it): the block stands in, and the
          // whole row counts as the project's own.
          rect: header ? snapRect(header) : block
        }
      })
  )
}

/**
 * Give each project row the extent of the region it heads: the row itself plus every row rendered
 * under it while it is open, down to the next row that is NOT nested inside it.
 *
 * Rows arrive as headers only, so no element carries the region's extent — the extent is what the
 * neighbouring header says: this project's region ends where the next project outside its subtree
 * begins, and the last region ends at the list's last row. A collapsed project therefore owns the gap
 * beneath it, which is exactly the space a "drop it in here" release lands on. A nested project's
 * region sits inside its parent's, which keeps going over the child's own subprojects.
 */
export function expandRowsToGroups(
  projects: SidebarProjectTree[],
  rows: Pick<ProjectNestRow, 'block' | 'el' | 'id' | 'rect'>[]
): ProjectNestRow[] {
  const sorted = [...rows].sort((a, b) => a.block.top - b.block.top)
  const last = sorted[sorted.length - 1]

  return sorted.map((row, index) => {
    const subtree = projectDescendantIds(projects, row.id)
    const next = sorted.slice(index + 1).find(candidate => !subtree.has(candidate.id))
    const bottom = Math.max(row.block.bottom, next ? next.block.top : (last?.block.bottom ?? row.block.bottom))

    return { ...row, group: { ...row.block, bottom } }
  })
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

  // Pulled right. The dragged row is out of the running — it is sitting under
  // the pointer by definition.
  const targets = rows.filter(row => row.id && row.id !== activeId)

  const candidate =
    // The row itself: the one way to name a nested project directly.
    targets.find(row => rectContains(row.rect, pointer.x, pointer.y)) ??
    // Otherwise the region the pointer is in — outermost first, because the drag
    // is addressing the whole area and the whole area belongs to its root.
    targets
      .filter(row => rectContains(row.group, pointer.x, pointer.y))
      .sort((a, b) => area(b.group) - area(a.group))[0]

  if (!candidate) {
    return null
  }

  const target = projects.find(project => project.id === candidate.id)

  // Auto (discovered) rows have no project record to parent to, and nothing
  // nests under itself or one of its own descendants.
  if (!target || target.isAuto || projectDescendantIds(projects, activeId).has(target.id)) {
    return null
  }

  return { kind: 'into', targetId: target.id }
}

/** The outline around the pending target region — the "it will land in here" affordance. */
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

/** Injected once, on the first drag: the rule that mutes tooltips while one is in flight. */
let muteStyle: HTMLStyleElement | null = null

const muteTooltips = (on: boolean) => {
  if (on && !muteStyle) {
    muteStyle = document.createElement('style')
    muteStyle.textContent = MUTE_CSS
    document.head.appendChild(muteStyle)
  }

  if (on) {
    document.body.setAttribute(DRAG_ATTR, '')
  } else {
    document.body.removeAttribute(DRAG_ATTR)
  }
}

/**
 * The `ReorderableList` policy for the projects list: reads the rows when a drag engages, re-reads
 * them on every move and on scroll, paints the pending outcome, and commits it on release. Only the
 * drop answers non-null, and only for a structural move — everything else stays a reorder.
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
  let activeId = ''
  let lastPointer: ProjectDropPoint | null = null
  let ghost: DragGhost | null = null
  let zone: ReturnType<typeof createZoneOutline> | null = null

  const hidePaint = () => {
    ghost?.destroy()
    ghost = null
    zone?.destroy()
    zone = null
  }

  /** Read the list again — it may have scrolled, or reordered under the pointer — and repaint. */
  const repaint = (pointer: ProjectDropPoint | null) => {
    if (!pointer || !activeId) {
      return
    }

    const projects = deps.projects()

    rows = readProjectRows(projects, activeId)

    const intent = resolveProjectDropIntent({ activeId, pointer, projects, rows })
    const row = intent?.kind === 'into' ? rows.find(candidate => candidate.id === intent.targetId) : null

    if (intent) {
      if (!ghost) {
        ghost = createDragGhost('')
      }

      const target = intent.kind === 'into' ? projects.find(project => project.id === intent.targetId) : null

      ghost.setLabel(intent.kind === 'top' ? deps.strings.topLevel : deps.strings.nestInto(target?.label ?? ''))
      ghost.moveTo(pointer.x, pointer.y)
    } else {
      ghost?.destroy()
      ghost = null
    }

    if (row) {
      zone ??= createZoneOutline()
      zone.paint(row.group)
    } else {
      zone?.destroy()
      zone = null
    }
  }

  // The list can scroll without the pointer moving — the sidebar's own scroller, or dnd-kit's edge
  // auto-scroll — so the geometry is re-read on scroll as well as on move.
  const onScroll = () => repaint(lastPointer)

  const teardown = () => {
    hidePaint()
    muteTooltips(false)
    window.removeEventListener('scroll', onScroll, true)
    rows = []
    lastPointer = null
    activeId = ''
  }

  return info => {
    if (info.phase === 'start') {
      activeId = info.activeId
      rows = readProjectRows(deps.projects(), activeId)
      muteTooltips(true)
      window.addEventListener('scroll', onScroll, true)

      return null
    }

    if (info.phase === 'cancel') {
      teardown()

      return null
    }

    if (info.phase === 'move') {
      lastPointer = info.pointer
      repaint(lastPointer)

      return null
    }

    // Drop: commit when this is a structural move that actually changes something, then hand the drop
    // over (a non-null answer) so the list does not also reorder.
    const projects = deps.projects()

    rows = readProjectRows(projects, info.activeId)

    const intent = info.pointer
      ? resolveProjectDropIntent({ activeId: info.activeId, pointer: info.pointer, projects, rows })
      : null

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
