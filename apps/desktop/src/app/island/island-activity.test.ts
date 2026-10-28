import { describe, expect, it } from 'vitest'

import type { ComposerStatusItem } from '@/store/composer-status'

import { formatIslandElapsed, islandActivity } from './island-activity'

const todo = (id: string, state: 'done' | 'running', depth?: number): ComposerStatusItem => ({
  depth,
  id,
  state,
  title: id,
  type: 'todo'
})

const worker = (id: string, currentTool?: string, state: 'done' | 'running' = 'running'): ComposerStatusItem => ({
  currentTool,
  id,
  state,
  title: id,
  type: 'subagent'
})

describe('islandActivity', () => {
  it('is idle with nothing to report', () => {
    expect(islandActivity([], null)).toEqual({ startedAt: null, todoDone: 0, todoTotal: 0, workers: 0 })
  })

  it('counts top-level todos only, so subtasks never inflate progress', () => {
    const items = [todo('a', 'done'), todo('b', 'running'), todo('a1', 'done', 1), todo('a2', 'running', 1)]

    expect(islandActivity(items, null)).toMatchObject({ todoDone: 1, todoTotal: 2 })
  })

  it('counts workers and takes the first named tool', () => {
    const items = [worker('a', 'bash'), worker('b', 'write_file'), worker('c', undefined)]

    expect(islandActivity(items, null)).toMatchObject({ tool: 'bash', workers: 3 })
  })

  it('drops a finished worker from both the count and the tool', () => {
    const items = [worker('a', 'bash', 'done'), worker('b', 'edit')]

    expect(islandActivity(items, null)).toMatchObject({ tool: 'edit', workers: 1 })
  })

  it('ignores a blank tool name rather than showing an empty chip', () => {
    expect(islandActivity([worker('a', '   ')], null).tool).toBeUndefined()
  })

  it('carries the turn clock only when given one', () => {
    expect(islandActivity([], 1_700_000_000_000).startedAt).toBe(1_700_000_000_000)
    expect(islandActivity([todo('a', 'running')], null).startedAt).toBeNull()
  })

  it('ignores rows that are neither todos nor workers', () => {
    const items: ComposerStatusItem[] = [
      { id: 'bg', state: 'running', title: 'npm run dev', type: 'background' },
      { goalStatus: 'active', id: 'goal', state: 'running', title: 'Ship it', type: 'goal' }
    ]

    expect(islandActivity(items, null)).toEqual({ startedAt: null, todoDone: 0, todoTotal: 0, workers: 0 })
  })
})

describe('formatIslandElapsed', () => {
  it('floors to whole seconds', () => {
    expect(formatIslandElapsed(9_400)).toBe('0:09')
  })

  it('pads the seconds field', () => {
    expect(formatIslandElapsed(65_000)).toBe('1:05')
  })

  it('adds hours past the hour', () => {
    expect(formatIslandElapsed(3_723_000)).toBe('1:02:03')
  })

  it('clamps a clock that runs backwards or arrives broken', () => {
    expect(formatIslandElapsed(-4_000)).toBe('0:00')
    expect(formatIslandElapsed(Number.NaN)).toBe('0:00')
  })
})
