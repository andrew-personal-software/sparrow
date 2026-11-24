import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { identityFrom } from './auth'

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('SPARROW_PROXY_SECRET', 's')
  vi.stubEnv('SPARROW_SERVICE_TOKEN', 'crow-t')
  vi.stubEnv('SPARROW_HAWK_TOKEN', 'hawk-t')
})
afterEach(() => vi.unstubAllEnvs())

const h = (o: Record<string, string>) => new Headers(o)
const user = (username: string, groups: string) =>
  h({ 'x-sparrow-proxy-secret': 's', 'x-authentik-username': username, 'x-authentik-groups': groups })
const code = (fn: () => unknown) => {
  try {
    fn()
  } catch (err) {
    return (err as { code?: string }).code
  }
}

test('no proxy secret and no bearer is unauthorized', () => {
  expect(code(() => identityFrom(h({ 'x-authentik-username': 'bob', 'x-authentik-groups': 'sparrow-admin' })))).toBe('unauthorized')
})

test('a sparrow-user is a plain user', () => {
  expect(identityFrom(user('bob', 'sparrow-user'))).toEqual({ kind: 'user', username: 'bob', admin: false })
})

test('sparrow-admin in the group list makes an admin', () => {
  expect(identityFrom(user('andrew', 'a|sparrow-admin'))).toEqual({ kind: 'user', username: 'andrew', admin: true })
})

test('a user in no sparrow group is forbidden', () => {
  expect(code(() => identityFrom(user('bob', 'crow-user')))).toBe('forbidden')
})

test('a username outside [a-z0-9-] is forbidden', () => {
  expect(code(() => identityFrom(user('../x', 'sparrow-user')))).toBe('forbidden')
})

test('service tokens without the proxy secret are crow and hawk', () => {
  expect(identityFrom(h({ authorization: 'Bearer crow-t' }))).toEqual({ kind: 'service', name: 'crow' })
  expect(identityFrom(h({ authorization: 'Bearer hawk-t' }))).toEqual({ kind: 'service', name: 'hawk' })
})

test('the proxy secret wins over a bearer header', () => {
  const headers = user('bob', 'sparrow-user')
  headers.set('authorization', 'Bearer crow-t')
  expect(identityFrom(headers)).toEqual({ kind: 'user', username: 'bob', admin: false })
})

test('a wrong bearer is unauthorized', () => {
  expect(code(() => identityFrom(h({ authorization: 'Bearer nope' })))).toBe('unauthorized')
})

test('an empty service token never matches', () => {
  vi.stubEnv('SPARROW_HAWK_TOKEN', '')
  expect(code(() => identityFrom(h({ authorization: 'Bearer ' })))).toBe('unauthorized')
})

test('production without SPARROW_PROXY_SECRET fails closed', () => {
  vi.stubEnv('SPARROW_PROXY_SECRET', '')
  expect(() => identityFrom(user('bob', 'sparrow-user'))).toThrow('server misconfigured')
  vi.stubEnv('SPARROW_PROXY_SECRET', 'change-me')
  expect(() => identityFrom(user('bob', 'sparrow-user'))).toThrow('server misconfigured')
})

test('development without SPARROW_PROXY_SECRET is the dev admin', () => {
  vi.stubEnv('NODE_ENV', 'development')
  vi.stubEnv('SPARROW_PROXY_SECRET', '')
  expect(identityFrom(h({}))).toEqual({ kind: 'user', username: 'dev', admin: true })
  vi.stubEnv('SPARROW_DEV_USER', 'ann')
  expect(identityFrom(h({}))).toEqual({ kind: 'user', username: 'ann', admin: true })
})
