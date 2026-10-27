// The approvals a waiting session is parked on, and the one action the island
// takes on them.
//
// Approvals are QUEUE-backed on the backend (`tools/approval.py`), keyed by
// session — not by socket. That is what makes answering from this window
// correct even though the app window (or nothing at all) owns the session's
// event stream: `approval.pending` reads the queue, `approval.respond` resolves
// it, and the parked agent thread unblocks wherever it is. The same pair is what
// the OS notification's Run/Reject buttons already use
// (`store/native-notifications.ts::respondToApprovalAction`).
//
// The live prompt arrives as a server request on whichever socket owns the
// session, so when another window owns it this one only learns of it by asking
// — hence the re-sync timer, which runs only while a session is actually
// waiting.
import { useStore } from '@nanostores/react'
import { useEffect, useMemo } from 'react'

import { $gateway } from '@/store/gateway'
import { $approvalRequests, answerApproval, clearApprovalRequest, replayPendingApproval } from '@/store/prompts'

import type { IslandApproval } from './island-model'

/** A queue read is an in-process dict lookup; fast enough to be the only path,
 *  infrequent enough (only while a session waits) to be free. */
const APPROVAL_RESYNC_MS = 2_000

export type IslandApprovalChoice = 'always' | 'deny' | 'once'

export interface IslandApprovalOptions {
  /** Resolve every parked approval in the session, not just this one. */
  all?: boolean
  /** Free text a deny carries back to the agent. */
  reason?: string
}

export interface IslandApprovals {
  approvalsById: Record<string, IslandApproval[]>
  /** Answer one parked approval. Resolving removes it from the store, so the
   *  card goes away without the island inventing local "dismissed" state. */
  answer: (
    sessionId: string,
    requestId: string,
    choice: IslandApprovalChoice,
    options?: IslandApprovalOptions
  ) => Promise<void>
}

export function useIslandApprovals(attentionIds: readonly string[]): IslandApprovals {
  const parked = useStore($approvalRequests)

  // `attentionIds` is a fresh array identity only when the set actually moves
  // (`stableArray` upstream), so this joins on the ids themselves.
  const waitingKey = attentionIds.slice().sort().join('\u0000')

  useEffect(() => {
    const ids = waitingKey ? waitingKey.split('\u0000') : []

    if (ids.length === 0) {
      return
    }

    const sync = () => {
      const gateway = $gateway.get()

      for (const sessionId of ids) {
        void replayPendingApproval(gateway, sessionId).catch(() => undefined)
      }
    }

    sync()

    const timer = setInterval(sync, APPROVAL_RESYNC_MS)

    return () => clearInterval(timer)
  }, [waitingKey])

  const approvalsById = useMemo(() => {
    const next: Record<string, IslandApproval[]> = {}

    for (const [sessionId, request] of Object.entries(parked)) {
      // Only a queue entry has a `requestId`; one that was restored without the
      // id cannot be answered through `approval.respond`, so the island does not
      // offer a button it cannot honour.
      if (!request?.requestId) {
        continue
      }

      next[sessionId] = [
        {
          command: request.command?.trim() ?? '',
          description: request.description?.trim() ?? '',
          requestId: request.requestId
        }
      ]
    }

    return next
  }, [parked])

  return {
    approvalsById,
    answer: async (sessionId, requestId, choice, options) => {
      const gateway = $gateway.get()
      const request = parked[sessionId]
      const all = options?.all ?? false
      const reason = options?.reason

      if (request && request.requestId === requestId) {
        await answerApproval(gateway, request, choice, all, reason)
        clearApprovalRequest(sessionId, requestId)
      } else {
        // The store lost the prompt between the click and the call (another
        // window answered it) — still resolve the queue entry by id, which is
        // what the notification path does with a bare session id.
        await answerApproval(gateway, { requestId, sessionId }, choice, all, reason)
      }

      void replayPendingApproval(gateway, sessionId).catch(() => undefined)
    }
  }
}
