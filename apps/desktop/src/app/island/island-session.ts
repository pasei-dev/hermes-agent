// One session, seen from the island: its last few lines, and a prompt sent into it.
//
// Two different doors, on purpose:
//   - READING is the desktop's own transcript read (`/api/sessions/<stored id>/messages`),
//     which is cheap, needs no runtime and is safe to poll — the island is a peek, not a
//     chat surface, and it must not build an agent just to show three lines.
//   - RUNNING needs a live runtime, so it resumes first (`session.resume` with
//     `omit_messages`, exactly the pair the app's own composer uses) and submits on the id
//     that came back. Resume attaches this window as an ADDITIONAL viewer of a session the
//     main window may already have open (`_rebind_live_transport` — "attach a live peer
//     without displacing existing subscribers"), so the app's view is not disturbed.
//
// Reading and running are therefore independent: a session can be read while another window
// drives it, and a prompt sent from here appears in that window's transcript.
import { getSessionMessages } from '@/api/sessions'

/** Lines the island shows; one row per message, role-labelled. */
export const ISLAND_TRANSCRIPT_ROWS = 4
/** Longest line the island keeps — the surface clamps to two lines anyway. */
const MAX_LINE = 320

export interface IslandTranscriptRow {
  role: 'assistant' | 'user'
  text: string
}

export type IslandGatewayRequest = <T>(method: string, params?: Record<string, unknown>) => Promise<T>

function flatten(content: unknown): string {
  if (typeof content === 'string') {
    return content
  }

  if (!Array.isArray(content)) {
    return ''
  }

  const parts: string[] = []

  for (const part of content) {
    if (typeof part === 'string') {
      parts.push(part)
    } else {
      const text = (part as { text?: unknown })?.text

      if (typeof text === 'string') {
        parts.push(text)
      }
    }
  }

  return parts.join(' ')
}

function oneLine(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()

  return collapsed.length > MAX_LINE ? `${collapsed.slice(0, MAX_LINE - 1)}…` : collapsed
}

/**
 * The tail of a transcript, as the island shows it.
 *
 * Tool rows, hidden widget rows and anything that is not a user/assistant turn are dropped
 * rather than summarised: a peek that shows half a tool call is worse than one that shows
 * the conversation. Empty lines fall away too, so four rows of real text is what fits.
 */
export function islandTranscriptRows(messages: unknown, limit = ISLAND_TRANSCRIPT_ROWS): IslandTranscriptRow[] {
  if (!Array.isArray(messages)) {
    return []
  }

  const rows: IslandTranscriptRow[] = []

  for (const message of messages) {
    const row = message as { content?: unknown; display_kind?: unknown; role?: unknown }
    const role = row?.role

    if (role !== 'user' && role !== 'assistant') {
      continue
    }

    if (row?.display_kind === 'hidden') {
      continue
    }

    const text = oneLine(flatten(row?.content))

    if (!text) {
      continue
    }

    rows.push({ role, text })
  }

  return rows.slice(-limit)
}

/** Read the tail of a session's transcript. Read-only: no runtime, no agent. */
export async function readIslandTranscript(storedId: string): Promise<IslandTranscriptRow[]> {
  const page = await getSessionMessages(storedId, undefined, { limit: 12, order: 'latest' })

  return islandTranscriptRows((page as { messages?: unknown })?.messages)
}

/**
 * Send a prompt into an existing session and return its runtime id.
 *
 * `runtimeId` is passed back in once the island has resumed this session, so the common
 * case (type, send, type again) costs one request instead of two.
 */
export async function submitToIslandSession(
  request: IslandGatewayRequest,
  storedId: string,
  text: string,
  runtimeId?: null | string
): Promise<string> {
  const prompt = text.trim()

  if (!prompt) {
    throw new Error('Nothing to send')
  }

  const id =
    runtimeId ??
    (
      await request<{ session_id: string }>('session.resume', {
        omit_messages: true,
        session_id: storedId,
        source: 'desktop'
      })
    )?.session_id

  if (!id) {
    throw new Error('That session is not available')
  }

  await request('prompt.submit', { session_id: id, text: prompt })

  return id
}
