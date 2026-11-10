import { describe, expect, it } from 'vitest'

import type { SessionMessage } from '@/types/hermes'

import { chatMessageText, toChatMessages } from '.'

// A cron result delivered into a local chat. The gateway writes it as a note
// (gateway/session_completion_notes.py note_if_unviewed -> append_completion_note)
// with `role: 'user'` and `display_kind: 'internal_notification'`. Hydration must
// render it as a notice, not as the reader's own message: before this, every
// nightly hermes-sync report appeared in the chat as if the user had pasted it.
describe('internal_notification hydration', () => {
  const report =
    '**Tue 2026-11-10 10:19 CET**\n\n5 commits came in (`7e996a3dc54` → `5638cc1fcef`). The merge did not conflict.'

  const cronRow = (displayKind: SessionMessage['display_kind']): SessionMessage => ({
    role: 'user',
    content: report,
    display_kind: displayKind,
    timestamp: 1
  })

  it('renders a cron note as a system notice, not a user bubble', () => {
    const [message] = toChatMessages([cronRow('internal_notification')])

    expect(message.role).toBe('system')
    expect(message.role).not.toBe('user')
  })

  it('keeps the whole report text rather than collapsing it to a label', () => {
    const [message] = toChatMessages([cronRow('internal_notification')])

    // Other notice kinds collapse to a short label ('model changed'); a cron
    // result is finished text and must survive intact.
    expect(chatMessageText(message)).toBe(report)
  })

  it('leaves an ordinary user message alone', () => {
    const [message] = toChatMessages([
      { role: 'user', content: 'prove that it will deliver here', timestamp: 1 }
    ])

    expect(message.role).toBe('user')
    expect(chatMessageText(message)).toBe('prove that it will deliver here')
  })
})
