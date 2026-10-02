import type { useSensors } from '@dnd-kit/core'
import {
  closestCenter,
  DndContext,
  type DragCancelEvent,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent
} from '@dnd-kit/core'
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import type * as React from 'react'

// Sidebar reordering is a strictly vertical list. The dragged item's transform
// is rendered Y-only in useSortableBindings (no x, no scale); this just stops
// dnd-kit's auto-scroll from dragging the rail — or the window — sideways when
// the pointer nears an edge, killing the horizontal "drag to valhalla".
const reorderAutoScroll = { threshold: { x: 0, y: 0.2 } }

/** A tree-nesting policy layered on this list's reordering — opt-in, and the only thing that makes a
 *  drop do something other than move the item to a new slot.
 *
 *  Nesting and reordering share one drag, so they need different gestures: the policy sees where the
 *  pointer is and how far it has travelled sideways, and decides. Returning a target from the `drop`
 *  phase takes the drop over from reordering — the caller then owns the outcome and the paint —
 *  while null leaves the ordinary reorder in charge. Every phase fires, nest or not, so the caller
 *  can set up on start, paint on move, commit on drop, and tear down on either ending. `pointer` is
 *  null for keyboard drags: there is no pointer to resolve against. */
export type NestPhase = 'cancel' | 'drop' | 'move' | 'start'

export interface NestDropInfo {
  activeId: string
  /** The row dnd-kit calls the drop target (null = released in the list's empty space). */
  overId: null | string
  phase: NestPhase
  /** Pointer position at this move/release, plus the drag's horizontal travel. */
  pointer: null | { dx: number; x: number; y: number }
}

export type NestResolver = (info: NestDropInfo) => null | { targetId: null | string }

type NestDragEvent = DragCancelEvent | DragEndEvent | DragMoveEvent | DragStartEvent

// One self-contained, nesting-safe reorderable list. It owns its DndContext, so a
// drag only ever collides with THIS list's own items — drop it at any depth (repos,
// worktrees, sessions) and reordering "just works" without leaking into the lists
// around or inside it. Pair each item with useSortableBindings(id); the list reports
// the new id order and the caller persists it. This is the single generic primitive
// behind every reorderable surface in the sidebar.
export function ReorderableList({
  children,
  ids,
  onReorder,
  resolveNest,
  sensors
}: {
  children: React.ReactNode
  ids: string[]
  onReorder: (ids: string[]) => void
  resolveNest?: NestResolver
  sensors?: ReturnType<typeof useSensors>
}) {
  const nestInfo = (phase: NestPhase, event: NestDragEvent): NestDropInfo => {
    const activator = event.activatorEvent
    const delta = 'delta' in event ? event.delta : { x: 0, y: 0 }

    return {
      activeId: String(event.active.id),
      overId: 'over' in event && event.over ? String(event.over.id) : null,
      phase,
      // A keyboard drag activates on a KeyboardEvent and has no pointer.
      pointer:
        activator instanceof MouseEvent
          ? { dx: delta.x, x: activator.clientX + delta.x, y: activator.clientY + delta.y }
          : null
    }
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { activatorEvent, active, over } = event

    // dnd-kit only restores focus for keyboard drags; after a pointer drop the
    // browser leaves :focus on the grab handle, which keeps a focus-within
    // grabber/affordance reveal stuck "on". Drop that focus so the row returns
    // to its resting state once the pointer moves away.
    if (!(activatorEvent instanceof KeyboardEvent)) {
      ;(document.activeElement as HTMLElement | null)?.blur()
    }

    // The policy sees every drop — nest or plain reorder — so it can always tear
    // its paint down; a non-null answer means it also handled the outcome.
    if (resolveNest?.(nestInfo('drop', event))) {
      return
    }

    if (!over || active.id === over.id) {
      return
    }

    const from = ids.indexOf(String(active.id))
    const to = ids.indexOf(String(over.id))

    if (from >= 0 && to >= 0) {
      onReorder(arrayMove(ids, from, to))
    }
  }

  return (
    <DndContext
      autoScroll={reorderAutoScroll}
      collisionDetection={closestCenter}
      onDragCancel={event => void resolveNest?.(nestInfo('cancel', event))}
      onDragEnd={handleDragEnd}
      onDragMove={event => void resolveNest?.(nestInfo('move', event))}
      onDragStart={event => void resolveNest?.(nestInfo('start', event))}
      sensors={sensors}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  )
}

export function useSortableBindings(id: string) {
  const { attributes, isDragging, listeners, setNodeRef, transform, transition } = useSortable({ id })
  // The FULL handle (role/tabIndex + dnd-kit's keyboard and pointer
  // activators) belongs on the grabber only. Row shells forward just
  // `onPointerDown` from it: a keyboard activator on a container makes every
  // focused descendant control (the ⋯ menu button) arm a drag on Space, and
  // an armed KeyboardSensor then eats Space/Enter window-wide — the rename
  // dialog swallowed spaces (#83617).
  const dragHandleProps: React.HTMLAttributes<HTMLElement> = { ...attributes, ...listeners }

  return {
    dragging: isDragging,
    dragHandleProps,
    ref: setNodeRef,
    reorderable: true as const,
    style: {
      // Uniform vertical list: only ever translate on Y. Ignoring x and the
      // scaleX/scaleY that CSS.Transform.toString would emit keeps a dragged
      // group/row from drifting sideways or morphing its size mid-drag.
      transform: transform ? `translate3d(0px, ${transform.y}px, 0)` : undefined,
      transition: isDragging ? undefined : transition,
      willChange: isDragging ? 'transform' : undefined
    }
  }
}

/**
 * A row shell owns the presses that STARTED inside its own DOM, and nothing
 * else. React re-dispatches an event fired in a PORTAL along the REACT tree,
 * so a pointerdown on a dialog's input — `DialogContent` portals into `<body>`
 * — still arrives at the row shell that rendered the dialog, carrying a
 * `target` outside the row. Those presses belong to the dialog: selecting a
 * session title in the rename input must not arm a reorder or lift the row onto
 * the shared drag session (the pointer-side sibling of the Space leak #83617
 * fixed on the keyboard side). Gate the shell's own `onPointerDown` with this
 * BEFORE its `[data-reorder-handle], [data-row-actions]` exclusion — that
 * selector walks the DOM, where a portal's content has neither marker.
 */
export function shellOwnsPress(event: React.PointerEvent<HTMLElement>) {
  const target = event.target

  return target instanceof Node && event.currentTarget.contains(target)
}
