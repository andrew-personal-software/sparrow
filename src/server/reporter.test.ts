import { afterEach, expect, test } from 'vitest'
import { serviceReporter } from './reporter'

const req = (auth?: string) => new Request('http://x', { headers: auth ? { authorization: auth } : {} })

afterEach(() => {
  delete process.env.SPARROW_SERVICE_TOKEN
})

test('reporter is accepted only with the service token', () => {
  process.env.SPARROW_SERVICE_TOKEN = 'tok'
  expect(serviceReporter(req('Bearer tok'), 'ann')).toBe('ann')
  expect(serviceReporter(req('Bearer nope'), 'ann')).toBeUndefined()
  expect(serviceReporter(req(), 'ann')).toBeUndefined()
})

test('no configured token means no reporter', () => {
  expect(serviceReporter(req('Bearer '), 'ann')).toBeUndefined()
})
