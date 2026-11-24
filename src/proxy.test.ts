import { NextRequest } from 'next/server'
import { afterEach, expect, test, vi } from 'vitest'
import { proxy } from './proxy'

vi.mock('@/core/dev-state', () => ({ readDevState: () => ({ env: 'prod' }) }))

afterEach(() => {
  vi.unstubAllEnvs()
})

test('production without a signed-in user answers 401 JSON', async () => {
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('SPARROW_PROXY_SECRET', 's')
  for (const path of ['/api/tasks', '/', '/t/SPAR-1', '/cli/sparrow.js']) {
    const res = proxy(new NextRequest(`http://localhost${path}`))
    expect(res.status).toBe(401)
    expect((await res.json()).error.code).toBe('unauthorized')
  }
})

test('/api/version stays open', () => {
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('SPARROW_PROXY_SECRET', 's')
  expect(proxy(new NextRequest('http://localhost/api/version')).status).toBe(200)
})

test('a signed-in user passes', () => {
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('SPARROW_PROXY_SECRET', 's')
  const headers = { 'x-sparrow-proxy-secret': 's', 'x-authentik-username': 'bob', 'x-authentik-groups': 'sparrow-user' }
  expect(proxy(new NextRequest('http://localhost/api/tasks', { headers })).status).toBe(200)
})

test('a dev server forwarding to prod sends SPARROW_TOKEN', () => {
  vi.stubEnv('NODE_ENV', 'development')
  vi.stubEnv('SPARROW_TOKEN', 'abc')
  const res = proxy(new NextRequest('http://localhost:3000/api/tasks'))
  expect(res.headers.get('x-middleware-rewrite')).toBe('https://sparrow.andrewminghanjiang.com/api/tasks')
  expect(res.headers.get('x-middleware-request-authorization')).toBe('Bearer abc')
})
