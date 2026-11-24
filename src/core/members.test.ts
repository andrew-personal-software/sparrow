import { beforeEach, expect, test } from 'vitest'
import { openDb } from './db'
import type { Db } from './db'
import { addMember, removeMember, setOwner } from './members'
import { createProject, loadProjects } from './projects'
import { touchUser } from './users'

let db: Db
beforeEach(() => {
  db = openDb(':memory:')
  createProject(db, { key: 'A' }, 'ann')
  touchUser(db, 'bob')
  touchUser(db, 'ann')
})
const a = () => loadProjects(db).find((p) => p.key === 'A')!
const code = (fn: () => unknown) => {
  try {
    fn()
  } catch (err) {
    return (err as { code?: string }).code
  }
}

test('addMember needs a user sparrow has seen', () => {
  expect(code(() => addMember(db, 'A', 'zed'))).toBe('invalid')
  addMember(db, 'a', 'bob')
  expect(a().members).toEqual(['bob'])
})

test('the owner cannot be removed', () => {
  expect(code(() => removeMember(db, 'A', 'ann'))).toBe('invalid')
})

test('removeMember drops a member', () => {
  addMember(db, 'A', 'bob')
  removeMember(db, 'A', 'bob')
  expect(a().members).toEqual([])
})

test('setOwner keeps the old owner as a member', () => {
  setOwner(db, 'A', 'bob')
  expect(a()).toMatchObject({ owner: 'bob', members: ['ann'] })
})

test('a missing project is not_found', () => {
  expect(code(() => addMember(db, 'NOPE', 'bob'))).toBe('not_found')
})
