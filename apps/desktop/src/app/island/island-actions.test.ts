import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { QueuedPromptEntry } from '@/store/composer-queue'
import { getQueuedPrompts, writeSessionQueue } from '@/store/composer-queue'

import { cancelIslandQueuedPrompt, islandQueue, islandQueueView, stopIslandSession } from './island-actions'

const entry = (id: string, text: string, extra: Partial<QueuedPromptEntry> = {}): QueuedPromptEntry => ({
  attachments: [],
  id,
  queuedAt: 0,
  text,
  ...extra
})

beforeEach(() => {
  writeSessionQueue('run-1', [])
  writeSessionQueue('stored-1', [])
})

describe('islandQueueView', () => {
  it('says nothing about an empty queue', () => {
    expect(islandQueueView([])).toBeNull()
  })

  it('names the head of the queue and how many wait behind it', () => {
    const view = islandQueueView([entry('a', '  run   the tests '), entry('b', 'and then deploy')])

    expect(view).toMatchObject({ cancellable: true, count: 2, next: 'run the tests' })
  })

  it('shows what a queued skill invocation displays, not its expanded body', () => {
    const view = islandQueueView([entry('a', 'the whole skill body', { displayText: '/skill tidy' })])

    expect(view?.next).toBe('/skill tidy')
  })

  it('withholds the cancel when every entry belongs to the server', () => {
    expect(islandQueueView([entry('a', 'x', { serverStatus: 'pending' })])?.cancellable).toBe(false)
  })
})

describe('islandQueue', () => {
  it('takes the first key that has a queue, skipping the nulls', () => {
    writeSessionQueue('stored-1', [entry('a', 'queued text')])

    expect(islandQueue([null, 'run-1', 'stored-1'])).toMatchObject({ count: 1, next: 'queued text' })
  })

  it('is null when neither key holds anything', () => {
    expect(islandQueue(['run-1', 'stored-1'])).toBeNull()
  })
})

describe('cancelIslandQueuedPrompt', () => {
  it('drops the local head and leaves the rest', () => {
    writeSessionQueue('run-1', [entry('a', 'first'), entry('b', 'second')])

    expect(cancelIslandQueuedPrompt(['run-1'])).toBe(true)
    expect(getQueuedPrompts('run-1').map(row => row.id)).toEqual(['b'])
  })

  it('refuses a server-owned head rather than pretending it went', () => {
    writeSessionQueue('run-1', [entry('a', 'server row', { serverStatus: 'pending' })])

    expect(cancelIslandQueuedPrompt(['run-1'])).toBe(false)
    expect(getQueuedPrompts('run-1')).toHaveLength(1)
  })

  it('reports false for keys that hold nothing', () => {
    expect(cancelIslandQueuedPrompt([null, 'run-1'])).toBe(false)
  })
})

describe('stopIslandSession', () => {
  it('interrupts the runtime id, not the stored one', async () => {
    const request = vi.fn(async () => ({}) as never)

    await stopIslandSession(request as never, 'run-1')

    expect(request).toHaveBeenCalledWith('session.interrupt', { session_id: 'run-1' })
  })

  it('surfaces a refusal from the gateway', async () => {
    const request = vi.fn(async () => {
      throw new Error('no such session')
    })

    await expect(stopIslandSession(request as never, 'gone')).rejects.toThrow('no such session')
  })
})
