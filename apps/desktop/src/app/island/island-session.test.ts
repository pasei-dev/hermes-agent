import { describe, expect, it, vi } from 'vitest'

import { type IslandGatewayRequest, islandTranscriptRows, submitToIslandSession } from './island-session'

/** The gateway door is generic; a mock is not, so the cast lives here once. */
const gateway = (impl: (method: string, params?: Record<string, unknown>) => Promise<unknown>) =>
  impl as unknown as IslandGatewayRequest

describe('islandTranscriptRows', () => {
  it('keeps the last four user/assistant lines, oldest first', () => {
    const messages = Array.from({ length: 8 }, (_, i) => ({
      content: `line ${i}`,
      role: i % 2 === 0 ? 'user' : 'assistant'
    }))

    expect(islandTranscriptRows(messages).map(row => row.text)).toEqual(['line 4', 'line 5', 'line 6', 'line 7'])
  })

  it('keeps tool rows as one line each, named, so a turn reads as a log', () => {
    const rows = islandTranscriptRows([
      { content: 'real question', role: 'user' },
      { content: '', role: 'assistant' },
      { content: '{"shell":"ls -la"}', role: 'tool', tool_name: 'shell' },
      { content: 'hidden intent', display_kind: 'hidden', role: 'user' },
      { content: 'real answer', role: 'assistant' }
    ])

    expect(rows).toEqual([
      { role: 'user', text: 'real question' },
      { role: 'tool', text: '{"shell":"ls -la"}', tool: 'shell' },
      { role: 'assistant', text: 'real answer' }
    ])
  })

  it('clips a tool payload far shorter than a prose line', () => {
    const [row] = islandTranscriptRows([{ content: 'y'.repeat(500), role: 'tool', tool_name: 'read' }])

    expect(row.text.length).toBe(140)
    expect(row.tool).toBe('read')
  })

  it('flattens a multi-part content array and collapses its whitespace', () => {
    const [row] = islandTranscriptRows([
      { content: [{ text: 'one' }, { type: 'image' }, { text: 'two\n\nlines' }], role: 'assistant' }
    ])

    expect(row.text).toBe('one two lines')
  })

  it('truncates a long line instead of letting it push the surface open', () => {
    const [row] = islandTranscriptRows([{ content: 'x'.repeat(900), role: 'assistant' }])

    expect(row.text.length).toBe(320)
    expect(row.text.endsWith('…')).toBe(true)
  })

  it('answers an empty or malformed payload with nothing, never a throw', () => {
    expect(islandTranscriptRows(null)).toEqual([])
    expect(islandTranscriptRows([{ role: 'assistant' }])).toEqual([])
  })
})

describe('submitToIslandSession', () => {
  it('resumes first when it has no runtime id, then submits on it', async () => {
    const request = vi.fn(async (method: string) =>
      method === 'session.resume' ? { session_id: 'runtime-1' } : { ok: true }
    )

    await expect(submitToIslandSession(gateway(request), 'stored-1', 'hello')).resolves.toBe('runtime-1')
    expect(request).toHaveBeenNthCalledWith(1, 'session.resume', {
      omit_messages: true,
      session_id: 'stored-1',
      source: 'desktop'
    })
    expect(request).toHaveBeenNthCalledWith(2, 'prompt.submit', { session_id: 'runtime-1', text: 'hello' })
  })

  it('reuses a runtime id it already has', async () => {
    const request = vi.fn(async () => ({ ok: true }))

    await expect(submitToIslandSession(gateway(request), 'stored-1', ' again ', 'runtime-1')).resolves.toBe('runtime-1')
    expect(request).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledWith('prompt.submit', { session_id: 'runtime-1', text: 'again' })
  })

  it('refuses an empty prompt without touching the gateway', async () => {
    const request = vi.fn()

    await expect(submitToIslandSession(gateway(request), 'stored-1', '   ')).rejects.toThrow('Nothing to send')
    expect(request).not.toHaveBeenCalled()
  })

  it('refuses when the resume names no runtime', async () => {
    await expect(submitToIslandSession(gateway(async () => ({})), 'stored-1', 'hi')).rejects.toThrow(
      'That session is not available'
    )
  })
})
