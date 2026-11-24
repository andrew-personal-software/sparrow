import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { addAttachment, applyOp, createProject, createTask, setQuota, touchUser, usageOf } from '@/core'
import { getState, refresh } from '@/server/state'
import { GET as events } from './events/route'
import { GET as getAttachment } from './tasks/[id]/attachments/[attId]/route'
import { DELETE as removeMemberRoute, POST as addMemberRoute } from './projects/[key]/members/route'
import { PATCH as patchProject } from './projects/[key]/route'
import { POST as postProject } from './projects/route'
import { POST as upload } from './tasks/[id]/attachments/route'
import { DELETE as deleteTask, GET as getTask, POST as postTask } from './tasks/[id]/route'
import { GET as getTasks, POST as postTasks } from './tasks/route'
import { PATCH as patchUser } from './users/[name]/route'
import { GET as getUsers } from './users/route'

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

const post = (headers: Record<string, string>, body: unknown) =>
  new Request('http://x', { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) })

test('writes to a hidden task are 404, to a read-only task 403', async () => {
  createTask(getState().db, { title: 'fb', project: 'CROW' })
  getState().db.exec(`UPDATE tasks SET extra = '{"reporter":"bob"}' WHERE project = 'CROW'`)
  refresh(getState())
  const op = { op: { type: 'setStatus', status: 'done' } }
  expect((await postTask(post(as('bob'), op), params('B-1'))).status).toBe(404)
  expect((await postTask(post(as('bob'), op), params('CROW-1'))).status).toBe(403)
})

test('the comment author is always the caller', async () => {
  vi.stubEnv('SPARROW_HAWK_TOKEN', 'hawk-t')
  vi.stubEnv('SPARROW_SERVICE_TOKEN', 'crow-t')
  const comment = (author: string) => ({ op: { type: 'addComment', author, body: 'x' } })
  const authors = async (res: Response) => (await res.json()).comments.map((c: { author: string }) => c.author)
  expect(await authors(await postTask(post(as('bob'), comment('ann')), params('A-1')))).toEqual(['bob'])
  expect(await authors(await postTask(post({ authorization: 'Bearer hawk-t' }, comment('')), params('A-1')))).toEqual(['bob', 'hawk'])
})

test('only crow sets a reporter', async () => {
  vi.stubEnv('SPARROW_SERVICE_TOKEN', 'crow-t')
  const res = await postTasks(post({ authorization: 'Bearer crow-t' }, { title: 'fb', project: 'CROW', reporter: 'bob' }))
  expect((await res.json()).extra).toEqual({ reporter: 'bob' })
  expect((await postTasks(post(as('bob'), { title: 'x', project: 'A', reporter: 'bob' }))).status).toBe(403)
})

test('a new project belongs to its creator; only the owner may edit it', async () => {
  expect((await (await postProject(post(as('bob'), { key: 'NEW' }))).json()).owner).toBe('bob')
  const patch = new Request('http://x', { method: 'PATCH', headers: as('bob'), body: JSON.stringify({ name: 'x' }) })
  expect((await patchProject(patch, { params: Promise.resolve({ key: 'A' }) })).status).toBe(403)
})

test('a request with no identity is 401', async () => {
  expect((await postTasks(post({}, { title: 'x', project: 'A' }))).status).toBe(401)
})

test('a user cannot delete or upload to a task they cannot write', async () => {
  createTask(getState().db, { title: 'fb', project: 'CROW' })
  getState().db.exec(`UPDATE tasks SET extra = '{"reporter":"bob"}' WHERE project = 'CROW'`)
  refresh(getState())
  const del = new Request('http://x', { method: 'DELETE', headers: as('bob') })
  expect((await deleteTask(del, params('CROW-1'))).status).toBe(403)
  const form = new FormData()
  form.set('file', new File(['x'], 'x.txt', { type: 'text/plain' }))
  const up = new Request('http://x', { method: 'POST', headers: as('bob'), body: form })
  expect((await upload(up, params('CROW-1'))).status).toBe(403)
})

test('editing a project you are not in is a 404', async () => {
  const patch = new Request('http://x', { method: 'PATCH', headers: as('bob'), body: JSON.stringify({ name: 'x' }) })
  expect((await patchProject(patch, { params: Promise.resolve({ key: 'B' }) })).status).toBe(404)
})

const json = (method: string, headers: Record<string, string>, body: unknown) =>
  new Request('http://x', { method, headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) })
const key = (k: string) => ({ params: Promise.resolve({ key: k }) })

test('only the owner or admin adds members, and a new member sees the project', async () => {
  touchUser(getState().db, 'cat')
  touchUser(getState().db, 'bob')
  expect((await addMemberRoute(json('POST', as('bob'), { username: 'cat' }), key('A'))).status).toBe(403)
  expect((await addMemberRoute(json('POST', as('ann'), { username: 'cat' }), key('A'))).status).toBe(200)
  expect((await addMemberRoute(json('POST', as('andrew', 'sparrow-admin'), { username: 'bob' }), key('B'))).status).toBe(200)
  const res = await getTasks(new Request('http://x/api/tasks', { headers: as('bob') }))
  expect((await res.json()).tasks.map((t: { id: string }) => t.id)).toEqual(['A-1', 'B-1'])
  expect((await removeMemberRoute(json('DELETE', as('bob'), { username: 'cat' }), key('A'))).status).toBe(403)
  expect((await removeMemberRoute(json('DELETE', as('ann'), { username: 'bob' }), key('B'))).status).toBe(404)
  expect((await removeMemberRoute(json('DELETE', as('cat', 'sparrow-user|x'), { username: 'cat' }), key('A'))).status).toBe(200)
})

test('GET /api/users lists users sparrow has seen', async () => {
  touchUser(getState().db, 'zed')
  const res = await getUsers(new Request('http://x', { headers: as('bob') }))
  expect(await res.json()).toContain('zed')
})

test('only admin changes the owner', async () => {
  touchUser(getState().db, 'bob')
  expect((await patchProject(json('PATCH', as('ann'), { owner: 'bob' }), key('A'))).status).toBe(403)
  const res = await patchProject(json('PATCH', as('andrew', 'sparrow-admin'), { owner: 'bob' }), key('A'))
  expect(await res.json()).toMatchObject({ owner: 'bob', members: ['ann'] })
})

const uploadAs = (headers: Record<string, string>, bytes: number, key = 'A-1') => {
  const form = new FormData()
  form.set('file', new File([new Uint8Array(bytes)], 'x.bin'))
  return upload(new Request('http://x', { method: 'POST', headers, body: form }), params(key))
}

test('an upload over the limit is 413 and saves nothing', async () => {
  setQuota(getState().db, 'bob', 1024 * 1024)
  const res = await uploadAs(as('bob'), 2 * 1024 * 1024)
  expect(res.status).toBe(413)
  expect((await res.json()).error.message).toContain('storage limit reached')
  expect(getState().index.tasks.find((t) => t.id === 'A-1')!.attachments).toEqual([])
})

test('crow uploads count to the reporter, else to crow', async () => {
  vi.stubEnv('SPARROW_SERVICE_TOKEN', 'crow-t')
  createTask(getState().db, { title: 'fb', project: 'CROW' })
  createTask(getState().db, { title: 'fb2', project: 'CROW' })
  getState().db.exec(`UPDATE tasks SET extra = '{"reporter":"bob"}' WHERE project = 'CROW' AND number = 1`)
  refresh(getState())
  expect((await uploadAs({ authorization: 'Bearer crow-t' }, 10, 'CROW-1')).status).toBe(200)
  expect((await uploadAs({ authorization: 'Bearer crow-t' }, 20, 'CROW-2')).status).toBe(200)
  expect(usageOf(getState().db, 'bob')).toBe(10)
  expect(usageOf(getState().db, 'crow')).toBe(20)
})

test('only admin sets a quota', async () => {
  const body = { quotaMb: 2 }
  expect((await patchUser(json('PATCH', as('bob'), body), { params: Promise.resolve({ name: 'bob' }) })).status).toBe(403)
  const res = await patchUser(json('PATCH', as('andrew', 'sparrow-admin'), body), { params: Promise.resolve({ name: 'bob' }) })
  expect(await res.json()).toEqual({ username: 'bob', quotaBytes: 2 * 1024 * 1024, usedBytes: 0 })
})
