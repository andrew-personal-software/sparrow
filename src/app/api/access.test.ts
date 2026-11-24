import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { addAttachment, applyOp, createProject, createTask } from '@/core'
import { getState, refresh } from '@/server/state'
import { GET as events } from './events/route'
import { GET as getAttachment } from './tasks/[id]/attachments/[attId]/route'
import { GET as getTask } from './tasks/[id]/route'
import { GET as getTasks } from './tasks/route'

beforeEach(() => {
  process.env.SPARROW_DB = path.join(mkdtempSync(path.join(tmpdir(), 'sparrow-access-')), 'x.db')
  process.env.SPARROW_ATTACHMENTS = path.join(path.dirname(process.env.SPARROW_DB), 'att')
  globalThis.__kb = undefined
  vi.stubEnv('SPARROW_PROXY_SECRET', 's')
  const { db } = getState()
  createProject(db, { key: 'A' }, 'ann')
  createProject(db, { key: 'B' }, 'cat')
  db.exec("INSERT INTO members (project, username) VALUES ('A', 'bob')")
  createTask(db, { title: 'a', project: 'A' })
  createTask(db, { title: 'b', project: 'B' })
  refresh(getState())
})
afterEach(() => vi.unstubAllEnvs())

const as = (username: string, groups = 'sparrow-user'): Record<string, string> => ({
  'x-sparrow-proxy-secret': 's',
  'x-authentik-username': username,
  'x-authentik-groups': groups,
})
const params = <T extends Record<string, string>>(id: string, extra?: T) => ({ params: Promise.resolve({ id, ...(extra as T) }) })

test('GET /api/tasks lists only the tasks the user may see', async () => {
  const res = await getTasks(new Request('http://x/api/tasks', { headers: as('bob') }))
  expect((await res.json()).tasks.map((t: { id: string }) => t.id)).toEqual(['A-1'])
})

test("one user's ETag never gives another user a 304", async () => {
  const ann = await getTasks(new Request('http://x/api/tasks', { headers: as('ann') }))
  const etag = ann.headers.get('etag')!
  const res = await getTasks(new Request('http://x/api/tasks', { headers: { ...as('bob'), 'if-none-match': etag } }))
  expect(res.status).toBe(200)
})

test('a hidden task is a 404 with the not-found message', async () => {
  const hidden = await getTask(new Request('http://x', { headers: as('bob') }), params('B-1'))
  const missing = await getTask(new Request('http://x', { headers: as('bob') }), params('B-9'))
  expect(hidden.status).toBe(404)
  expect((await hidden.json()).error.message).toBe('task B-1 not found')
  expect((await missing.json()).error.message).toBe('task B-9 not found')
})

test('an attachment on a hidden task is a 404', async () => {
  const { db } = getState()
  addAttachment(db, 'B-1', { filename: 'x.txt', mime: 'text/plain', data: new Uint8Array([1]) })
  refresh(getState())
  const attId = getState().index.tasks.find((t) => t.id === 'B-1')!.attachments[0].id
  const res = await getAttachment(new Request('http://x', { headers: as('bob') }), params('B-1', { attId }))
  expect(res.status).toBe(404)
})

test('services cannot read the board', async () => {
  vi.stubEnv('SPARROW_SERVICE_TOKEN', 'crow-t')
  const res = await getTasks(new Request('http://x/api/tasks', { headers: { authorization: 'Bearer crow-t' } }))
  expect(res.status).toBe(403)
})

test('live updates only carry what the user may see', async () => {
  const abort = new AbortController()
  const res = await events(new Request('http://x/api/events', { headers: as('bob'), signal: abort.signal }))
  const reader = res.body!.getReader()
  const next = async () => JSON.parse(new TextDecoder().decode((await reader.read()).value).replace(/^data: /, ''))
  const first = await next()
  expect(first.type).toBe('snapshot')
  expect(first.index.tasks.map((t: { id: string }) => t.id)).toEqual(['A-1'])
  expect(first.rev).toMatch(/:bob$/)

  applyOp(getState().db, 'B-1', { type: 'setBody', body: 'x' })
  refresh(getState())
  expect(await next()).toEqual({ type: 'rev', rev: `${getState().rev}:bob` })

  createTask(getState().db, { title: 'new', project: 'A' })
  refresh(getState())
  expect(await next()).toMatchObject({ type: 'upsert', task: { id: 'A-2' } })
  await next() // rev

  applyOp(getState().db, 'A-1', { type: 'setProject', project: 'B' })
  refresh(getState())
  const after = [await next(), await next()]
  expect(after).toContainEqual({ type: 'remove', id: 'A-1' })
  const snapshot = after.find((e) => e.type === 'snapshot')
  expect(snapshot.index.tasks.map((t: { id: string }) => t.id)).toEqual(['A-2'])
  abort.abort()
})
