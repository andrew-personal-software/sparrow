import { beforeEach, expect, test } from 'vitest'
import { openDb } from './db'
import type { Db } from './db'
import { buildIndex } from './indexer'
import { listUsers, touchUser } from './users'

let db: Db
beforeEach(() => {
  db = openDb(':memory:')
})

test('touchUser keeps first_seen and moves last_seen', () => {
  touchUser(db, 'bob', new Date('2026-01-01T00:00:00Z'))
  touchUser(db, 'bob', new Date('2026-02-01T00:00:00Z'))
  expect(db.prepare('SELECT first_seen, last_seen FROM users').all()).toEqual([
    { first_seen: '2026-01-01T00:00:00.000Z', last_seen: '2026-02-01T00:00:00.000Z' },
  ])
})

test('listUsers is sorted', () => {
  touchUser(db, 'cat')
  touchUser(db, 'ann')
  expect(listUsers(db)).toEqual(['ann', 'cat'])
})

test('existing projects belong to andrew, and CROW exists', () => {
  const projects = buildIndex(db).projects
  expect(projects.map((p) => p.key)).toEqual(['CROW', 'SPAR', 'TASK'])
  expect(projects.every((p) => p.owner === 'andrew' && p.members.length === 0)).toBe(true)
})
