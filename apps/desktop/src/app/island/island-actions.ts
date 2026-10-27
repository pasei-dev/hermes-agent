// The two things the island can DO to a session it is only peeking at: stop the
// turn that is running, and drop a prompt that is waiting behind it.
//
// Both go through surfaces that already exist, and neither invents state:
//   - stop  → `session.interrupt` on the RUNTIME id (the island holds stored ids,
//             so the caller resolves the pair; see `runtimeIdForStored`).
//   - queue → `store/composer-queue`, the same list the composer's own queue slot
//             renders, so cancelling here cancels there. A row the SERVER owns
//             cannot be removed locally (`removeQueuedPrompt` refuses it by
//             design); the island therefore shows the count and withholds the
//             button rather than offering a click that would do nothing.
import { getQueuedPrompts, type QueuedPromptEntry, removeQueuedPrompt } from '@/store/composer-queue'

export interface IslandQueueView {
  /** Entries still waiting behind the running turn. */
  count: number
  /** The one the island names: the head of the queue, clamped by the caller. */
  next: string
  /** True when at least one entry can be dropped from the island. */
  cancellable: boolean
}

/** `displayText` wins: a queued slash command shows the invocation, not its body. */
export function islandQueueView(entries: readonly QueuedPromptEntry[]): IslandQueueView | null {
  if (entries.length === 0) {
    return null
  }

  const head = entries[0]!
  const text = (head.displayText ?? head.text).replace(/\s+/g, ' ').trim()

  return {
    cancellable: entries.some(entry => !entry.serverStatus),
    count: entries.length,
    next: text
  }
}

/** The queue as this session holds it, under either key a caller may have. */
export function islandQueue(sessionIds: readonly (null | string | undefined)[]): IslandQueueView | null {
  for (const id of sessionIds) {
    if (!id) {
      continue
    }

    const view = islandQueueView(getQueuedPrompts(id))

    if (view) {
      return view
    }
  }

  return null
}

/** Drop the head of the queue that this window owns. Returns whether anything went. */
export function cancelIslandQueuedPrompt(sessionIds: readonly (null | string | undefined)[]): boolean {
  for (const id of sessionIds) {
    if (!id) {
      continue
    }

    const head = getQueuedPrompts(id).find(entry => !entry.serverStatus)

    if (head && removeQueuedPrompt(id, head.id)) {
      return true
    }
  }

  return false
}

export type IslandGatewayRequest = <T>(method: string, params?: Record<string, unknown>) => Promise<T>

/**
 * Stop the turn a session is running.
 *
 * `session.interrupt` takes the runtime id: it is the live agent's handle, and the
 * stored id is only what the transcript is filed under. The island resolves the
 * pair before calling, and asks for nothing when it cannot — an interrupt that
 * silently no-ops because it named the wrong id is worse than no button.
 */
export async function stopIslandSession(request: IslandGatewayRequest, runtimeId: string): Promise<void> {
  await request('session.interrupt', { session_id: runtimeId })
}
