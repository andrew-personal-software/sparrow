import { NextRequest } from 'next/server'
import { afterEach, expect, test, vi } from 'vitest'
import { proxy } from './proxy'

vi.mock('@/core/dev-state', () => ({ readDevState: () => ({ env: 'prod' }) }))

afterEach(() => {
  vi.unstubAllEnvs()
})

test('a dev server forwarding to prod sends SPARROW_TOKEN', () => {
  vi.stubEnv('NODE_ENV', 'development')
  vi.stubEnv('SPARROW_TOKEN', 'abc')
  const res = proxy(new NextRequest('http://localhost:3000/api/tasks'))
  expect(res.headers.get('x-middleware-rewrite')).toBe('https://sparrow.andrewminghanjiang.com/api/tasks')
  expect(res.headers.get('x-middleware-request-authorization')).toBe('Bearer abc')
})
