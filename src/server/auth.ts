import { KbError, touchUser } from '@/core'
import type { Db, Identity } from '@/core'
import { identityFrom } from './identity'
import { getState } from './state'

export { identityFrom }

const TOUCH_MS = 60_000
const touched = new WeakMap<Db, Map<string, number>>()

/** identityFrom, and records the user so owners can add them to projects. */
export function requireIdentity(req: Request): Identity {
  const id = identityFrom(req.headers)
  if (id.kind !== 'user') return id
  const { db } = getState()
  const seen = touched.get(db) ?? new Map<string, number>()
  touched.set(db, seen)
  if (Date.now() - (seen.get(id.username) ?? 0) > TOUCH_MS) {
    touchUser(db, id.username)
    seen.set(id.username, Date.now())
  }
  return id
}

/** requireIdentity for routes only people use (the board, live updates). */
export function requireUser(req: Request): Identity & { kind: 'user' } {
  const id = requireIdentity(req)
  if (id.kind !== 'user') throw new KbError('forbidden', `${id.name} cannot read the board`)
  return id
}
