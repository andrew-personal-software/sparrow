import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { authorizationFor } from '../core/env'
import { call } from './http'

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  process.env.SPARROW_URL = 'http://sparrow.test'
  fetchMock.mockResolvedValue(new Response('{}', { status: 200 }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
  delete process.env.SPARROW_TOKEN
})

const sent = () => fetchMock.mock.calls[0][1] as RequestInit & { headers: Headers }

test('authorizationFor sends user:token as Basic and anything else as Bearer', () => {
  expect(authorizationFor('andrew:abc')).toBe(`Basic ${btoa('andrew:abc')}`)
  expect(authorizationFor('abc')).toBe('Bearer abc')
})

test('SPARROW_TOKEN is sent on API calls and on raw calls', async () => {
  process.env.SPARROW_TOKEN = 'abc'
  await call('/api/tasks')
  expect(sent().headers.get('authorization')).toBe('Bearer abc')
  fetchMock.mockClear()
  await call('/cli/sparrow.js', {}, true)
  expect(new Headers(sent().headers).get('authorization')).toBe('Bearer abc')
})

test('no SPARROW_TOKEN sends no authorization header', async () => {
  await call('/api/tasks')
  expect(sent().headers.get('authorization')).toBeNull()
})

test('requests do not follow redirects', async () => {
  await call('/api/tasks')
  expect(sent().redirect).toBe('manual')
})

test('a redirect to a sign-in page without a token says to set SPARROW_TOKEN', async () => {
  fetchMock.mockResolvedValue(new Response('<html>', { status: 302, headers: { location: 'https://auth.test/login' } }))
  await expect(call('/api/tasks')).rejects.toMatchObject({ code: 'unauthorized', message: 'not signed in. Set SPARROW_TOKEN' })
})

test('a 401 without a token says to set SPARROW_TOKEN', async () => {
  fetchMock.mockResolvedValue(new Response('<html>', { status: 401 }))
  await expect(call('/api/tasks')).rejects.toMatchObject({ code: 'unauthorized', message: 'not signed in. Set SPARROW_TOKEN' })
})

test('a redirect with a token says the token was rejected', async () => {
  process.env.SPARROW_TOKEN = 'abc'
  fetchMock.mockResolvedValue(new Response('', { status: 302 }))
  await expect(call('/api/tasks')).rejects.toMatchObject({ code: 'unauthorized', message: 'SPARROW_TOKEN was rejected. Make a new one in Authentik' })
})
