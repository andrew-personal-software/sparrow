import { EventEmitter } from 'node:events'
import { describe, expect, test, vi } from 'vitest'
import { applyOp, buildIndex, createTask, openDb, PROJECT_COLORS, updateProject } from '@/core'
import { refresh, revOf } from '@/server/state'
import type { ServerEvent, State } from '@/server/state'

function setup(): { state: State; events: ServerEvent[] } {
  const db = openDb(':memory:')
  const index = buildIndex(db)
  const emitter = new EventEmitter()
  const events: ServerEvent[] = []
  emitter.on('event', (e: ServerEvent) => events.push(e))
  return { state: { db, index, rev: revOf(index), emitter }, events }
}

describe('state', () => {
  test('revOf is stable for the same index and changes after a create', () => {
    const { state } = setup()
    expect(revOf(buildIndex(state.db))).toBe(state.rev)
    createTask(state.db, { project: 'SPAR', title: 'a' })
    expect(revOf(buildIndex(state.db))).not.toBe(state.rev)
  })

  test('refresh emits upserts then one rev event equal to state.rev', () => {
    const { state, events } = setup()
    const before = state.rev
    createTask(state.db, { project: 'SPAR', title: 'a' })
    refresh(state)
    expect(events.map((e) => e.type)).toEqual(['upsert', 'rev'])
    expect(events.at(-1)).toEqual({ type: 'rev', rev: state.rev })
    expect(state.rev).not.toBe(before)
  })

  test('refresh with no change emits nothing', () => {
    const { state, events } = setup()
    refresh(state)
    expect(events).toEqual([])
  })

  test('refresh bumps rev when only the config changes', () => {
    const { state, events } = setup()
    const before = state.rev
    const config = { ...state.index.config, user: 'someone-else' }
    state.db.prepare('UPDATE config SET value = ? WHERE id = 1').run(JSON.stringify(config))
    refresh(state)
    expect(state.rev).not.toBe(before)
    expect(events).toEqual([{ type: 'snapshot', index: state.index, rev: state.rev }])
  })

  test('refresh emits a snapshot when a project changes', () => {
    const { state, events } = setup()
    updateProject(state.db, 'SPAR', { color: PROJECT_COLORS[1] })
    refresh(state)
    expect(events.some((e) => e.type === 'snapshot' && e.index.projects[0].color === PROJECT_COLORS[1])).toBe(true)
  })
})

describe('hawk notify', () => {
  test('sends one-shot creates and status changes only', () => {
    vi.stubEnv('NODE_ENV', 'production')
    const fetch = vi.fn(async () => new Response('{}'))
    vi.stubGlobal('fetch', fetch)
    try {
      const { state } = setup()
      const t = createTask(state.db, { project: 'SPAR', title: 'a', oneShot: true })
      createTask(state.db, { project: 'SPAR', title: 'b' })
      refresh(state)
      applyOp(state.db, t.id, { type: 'setTitle', title: 'c' })
      refresh(state)
      applyOp(state.db, t.id, { type: 'setStatus', status: 'done' })
      refresh(state)
      const bodies = fetch.mock.calls.map((c) => JSON.parse((c as unknown as [string, RequestInit])[1].body as string))
      expect(bodies.map((b) => b.title)).toEqual([`${t.id} created`, `${t.id}: ${t.status} → done`])
      expect(bodies[0]).toMatchObject({ topic: 'sparrow.task.status', thread: t.id, link: `https://sparrow.andrewminghanjiang.com/t/${t.id}` })
    } finally {
      vi.unstubAllEnvs()
      vi.unstubAllGlobals()
    }
  })
})
