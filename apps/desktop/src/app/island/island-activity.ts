// What the pill says while work is running: the tool in flight, how long the
// turn has been going, how far the plan got and how many workers are out.
//
// Composed from the composer's own status stack (`$statusItemsBySession`) and the
// per-runtime turn clock (`$sessionStates`), because those are already the app's
// answer to "what is this session doing": the island reads them rather than
// scraping the transcript, so a token delta costs one recompute and no request.
//
// The island holds STORED session ids (its rows come from `$attentionSessionIds`
// and `$workingSessionIds`, both lineage-expanded); the status stack is keyed by
// RUNTIME id. `storedSessionId` on each state is the bridge, so the map built here
// is stored-id keyed and the shell can index it directly.
import { computed, type ReadableAtom } from 'nanostores'

import type { ComposerStatusItem } from '@/store/composer-status'
import { $statusItemsBySession } from '@/store/composer-status'
import { $sessionStates } from '@/store/session-states'

export interface IslandActivity {
  /** Epoch ms the current turn started; null when the turn is not live. */
  startedAt: number | null
  /** The active tool of the first running worker, when one names it. */
  tool?: string
  todoDone: number
  todoTotal: number
  workers: number
}

const IDLE: IslandActivity = { startedAt: null, todoDone: 0, todoTotal: 0, workers: 0 }

/**
 * The activity line for one session, from its merged status items.
 *
 * Todos count TOP-LEVEL rows only: a plan of five steps with four subtasks each is
 * "2/5", not "2/25" — the subtask tree is the plan's detail, not its progress.
 * Workers are the subagents still out (`running`/`queued` upstream, filtered again
 * here so the count survives a status stack that starts sending finished rows).
 */
export function islandActivity(items: readonly ComposerStatusItem[], startedAt: null | number): IslandActivity {
  let todoDone = 0
  let todoTotal = 0
  let workers = 0
  let tool: string | undefined

  for (const item of items) {
    if (item.type === 'todo' && (item.depth ?? 0) === 0) {
      todoTotal += 1
      todoDone += item.state === 'done' ? 1 : 0
    } else if (item.type === 'subagent') {
      if (item.state === 'done') {
        continue
      }

      workers += 1
      const named = item.currentTool?.trim()

      if (!tool && named) {
        tool = named
      }
    }
  }

  if (!startedAt && !todoTotal && !workers && !tool) {
    return IDLE
  }

  return { startedAt: startedAt ?? null, todoDone, todoTotal, tool, workers }
}

/** `m:ss`, and `h:mm:ss` past the hour — a turn that long is worth the extra field. */
export function formatIslandElapsed(ms: number): string {
  const total =
    Number.isFinite(ms) && ms > 0
      ? Math.floor(ms / 1000)
      : 0

  const seconds = total % 60
  const minutes = Math.floor(total / 60) % 60
  const hours = Math.floor(total / 3600)
  const pad = (value: number) => String(value).padStart(2, '0')

  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`
}

function sameActivity(a: IslandActivity, b: IslandActivity): boolean {
  return (
    a.startedAt === b.startedAt &&
    a.todoDone === b.todoDone &&
    a.todoTotal === b.todoTotal &&
    a.tool === b.tool &&
    a.workers === b.workers
  )
}

let previous: Record<string, IslandActivity> = {}

/**
 * Activity per STORED session id. A session with nothing to say is absent, so the
 * shell's `activity[id]` is `undefined` and it falls back to the plain count.
 *
 * Identity is stabilised per session: `$sessionStates` changes on every message
 * delta, and handing the island a new object each time would re-render it at token
 * rate for a number that moves once a second.
 */
export const $islandActivityBySession: ReadableAtom<Record<string, IslandActivity>> = computed(
  [$sessionStates, $statusItemsBySession],
  (states, statusItems) => {
    const out: Record<string, IslandActivity> = {}
    let changed = false

    for (const [runtimeId, state] of Object.entries(states)) {
      const stored = state.storedSessionId

      if (!stored) {
        continue
      }

      const next = islandActivity(
        statusItems[runtimeId] ?? [],
        state.turnLive ? state.turnStartedAt : null
      )

      if (next === IDLE) {
        continue
      }

      const before = previous[stored]

      out[stored] = before && sameActivity(before, next) ? before : next
      changed ||= !before || out[stored] !== before
    }

    for (const stored of Object.keys(previous)) {
      if (!(stored in out)) {
        changed = true
      }
    }

    return changed ? (previous = out) : previous
  }
)
