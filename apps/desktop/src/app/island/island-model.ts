// What the Dynamic Island shows, as plain data.
//
// The shell is a view over the app's own stores — `$attentionSessionIds` and
// `$workingSessionIds` (both stored session ids, lineage-expanded) plus the
// approvals parked per session by `store/prompts`. Keeping the derivation here
// means the interesting part (which sessions are listed, in what order, and
// which stage that adds up to) is unit-tested without a DOM, and the component
// only paints it.

/** `hidden` = nothing to say, `pill` = work running, `attention` = a prompt is
 *  waiting, `expanded` = the user opened it. */
export type IslandStage = 'attention' | 'expanded' | 'hidden' | 'pill'

export interface IslandApproval {
  command: string
  description: string
  requestId: string
}

export interface IslandRow {
  approval?: IslandApproval
  id: string
  state: 'needs-input' | 'working'
  title: string
}

export interface IslandRowsInput {
  /** Parked approvals, keyed by the session that raised them. */
  approvalsById: Record<string, readonly IslandApproval[]>
  attentionIds: readonly string[]
  /** Titles keyed by stored session id; a missing one falls back to a generic label. */
  titles: Record<string, string>
  workingIds: readonly string[]
}

/**
 * Attention before work: a session waiting on the user is the reason the island
 * exists, and it must never sit below three rows of "still thinking". A session
 * that is BOTH busy and waiting (a turn parked on its own approval) is listed
 * once, as `needs-input` — the newer, more actionable fact.
 */
export function islandRows({ approvalsById, attentionIds, titles, workingIds }: IslandRowsInput): IslandRow[] {
  const needsInput = new Set(attentionIds)
  const rows: IslandRow[] = []

  for (const id of needsInput) {
    rows.push({
      approval: approvalsById[id]?.[0],
      id,
      state: 'needs-input',
      title: titles[id]?.trim() ?? ''
    })
  }

  for (const id of workingIds) {
    if (needsInput.has(id)) {
      continue
    }

    rows.push({ id, state: 'working', title: titles[id]?.trim() ?? '' })
  }

  const rank = (row: IslandRow) => (row.state === 'needs-input' ? 0 : 1)

  return rows.sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title))
}

export function islandStage(input: {
  attentionCount: number
  expanded: boolean
  workingCount: number
}): IslandStage {
  if (input.expanded) {
    return 'expanded'
  }

  if (input.attentionCount > 0) {
    return 'attention'
  }

  return input.workingCount > 0 ? 'pill' : 'hidden'
}

/** The one line the pill shows: what needs the user, else what is running. */
export function islandCountLabel(stage: IslandStage, count: number): { kind: 'attention' | 'running'; count: number } | null {
  if (stage === 'attention') {
    return { count, kind: 'attention' }
  }

  if (stage === 'pill' || stage === 'expanded') {
    return { count, kind: 'running' }
  }

  return null
}
