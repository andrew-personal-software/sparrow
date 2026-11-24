import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { runCommand } from './commands'

const fetchMock = vi.fn()
const project = { key: 'A', name: 'A', color: '#2563eb', owner: 'ann', members: ['bob'] }

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  process.env.SPARROW_URL = 'http://sparrow.test'
  fetchMock.mockResolvedValue(Response.json(project))
})
afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
})

test('project add-member posts the username to the members route', async () => {
  expect(await runCommand('project', {}, ['add-member', 'a', 'bob'])).toEqual({ kind: 'project', value: project })
  const [url, init] = fetchMock.mock.calls[0]
  expect(url).toBe('http://sparrow.test/api/projects/A/members')
  expect(init.method).toBe('POST')
  expect(JSON.parse(init.body)).toEqual({ username: 'bob' })
})

test('project remove-member sends DELETE', async () => {
  await runCommand('project', {}, ['remove-member', 'A', 'bob'])
  expect(fetchMock.mock.calls[0][1].method).toBe('DELETE')
})

test('project members shows one project from the board', async () => {
  fetchMock.mockResolvedValue(Response.json({ projects: [project], tasks: [] }))
  expect(await runCommand('project', {}, ['members', 'a'])).toEqual({ kind: 'project', value: project })
})

test('user quota sends MB, and "default" sends null', async () => {
  const value = { username: 'bob', quotaBytes: 1048576, usedBytes: 0 }
  fetchMock.mockResolvedValue(Response.json(value))
  expect(await runCommand('user', {}, ['quota', 'bob', '1'])).toEqual({ kind: 'user', value })
  expect(fetchMock.mock.calls[0][0]).toBe('http://sparrow.test/api/users/bob')
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ quotaMb: 1 })
  fetchMock.mockResolvedValue(Response.json(value))
  await runCommand('user', {}, ['quota', 'bob', 'default'])
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ quotaMb: null })
})
