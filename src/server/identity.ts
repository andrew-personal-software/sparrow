import { timingSafeEqual } from 'node:crypto'
import { KbError } from '@/core/errors'
import type { Identity } from '@/core/types'

const USERNAME = /^[a-z0-9-]+$/
const safeEqual = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))

/**
 * Who sent the request. Caddy adds X-Sparrow-Proxy-Secret and the X-Authentik-* headers; without the secret,
 * only a service token (crow, hawk on 127.0.0.1) is accepted. Dev without SPARROW_PROXY_SECRET is an admin.
 */
export function identityFrom(h: Headers): Identity {
  const secret = process.env.SPARROW_PROXY_SECRET
  const production = process.env.NODE_ENV === 'production'
  if (!secret || secret === 'change-me') {
    if (production) throw new KbError('unauthorized', 'server misconfigured: set SPARROW_PROXY_SECRET')
    return { kind: 'user', username: process.env.SPARROW_DEV_USER || 'dev', admin: true }
  }
  if (safeEqual(h.get('x-sparrow-proxy-secret') ?? '', secret)) {
    const username = h.get('x-authentik-username')
    if (!username) throw new KbError('unauthorized', 'not signed in')
    if (!USERNAME.test(username)) throw new KbError('forbidden', 'invalid username')
    const groups = (h.get('x-authentik-groups') ?? '').split('|')
    if (!groups.includes('sparrow-admin') && !groups.includes('sparrow-user')) throw new KbError('forbidden', 'no access to sparrow')
    return { kind: 'user', username, admin: groups.includes('sparrow-admin') }
  }
  const bearer = /^Bearer (.+)$/.exec(h.get('authorization') ?? '')?.[1] ?? ''
  for (const [name, token] of [['crow', process.env.SPARROW_SERVICE_TOKEN], ['hawk', process.env.SPARROW_HAWK_TOKEN]] as const) {
    if (token && bearer && safeEqual(bearer, token)) return { kind: 'service', name }
  }
  throw new KbError('unauthorized', 'not signed in')
}
