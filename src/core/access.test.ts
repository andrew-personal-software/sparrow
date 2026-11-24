import { beforeEach, expect, test } from 'vitest'
import { canManageProject, checkCreate, checkOp, visibleIndex } from './access'
import { openDb } from './db'
import type { Db } from './db'
import { buildIndex, viewTask } from './indexer'
import type { Index } from './indexer'
import { applyOp, createTask } from './ops'
import type { Op } from './ops'
import { createProject } from './projects'
import type { Identity } from './types'

const bob: Identity = { kind: 'user', username: 'bob', admin: false }
const admin: Identity = { kind: 'user', username: 'andrew', admin: true }
const hawk: Identity = { kind: 'service', name: 'hawk' }
const crow: Identity = { kind: 'service', name: 'crow' }

let db: Db
let index: Index
beforeEach(() => {
  db = openDb(':memory:')
  createProject(db, { key: 'A' }, 'ann')
  createProject(db, { key: 'B' }, 'cat')
  db.exec("INSERT INTO members (project, username) VALUES ('A', 'bob')")
  createTask(db, { title: 'a', project: 'A' })
  createTask(db, { title: 'b', project: 'B', body: 'see [[A-1]]', links: [{ type: 'blocks', id: 'A-1' }] })
  createTask(db, { title: 'feedback', project: 'CROW' })
  db.exec(`UPDATE tasks SET extra = '{"reporter":"bob"}' WHERE project = 'CROW'`)
  applyOp(db, 'A-1', { type: 'addComment', author: 'ann', body: 'by ann' })
  applyOp(db, 'A-1', { type: 'addComment', author: 'bob', body: 'by bob' })
  index = buildIndex(db)
})

const task = (key: string) => viewTask(index, key)!
const code = (fn: () => unknown) => {
  try {
    fn()
  } catch (err) {
    return (err as { code?: string }).code
  }
}
const op = (who: Identity, key: string, o: Op) => code(() => checkOp(index, who, task(key), o))

test('a member sees their projects and their own feedback, nothing else', () => {
  const v = visibleIndex(index, bob as Identity & { kind: 'user' })
  expect(v.tasks.map((t) => t.id).sort()).toEqual(['A-1', 'CROW-1'])
  expect(v.tasks.find((t) => t.id === 'A-1')!.backlinks).toEqual([])
  expect(task('A-1').blocked).toBe(true)
  expect(v.tasks.find((t) => t.id === 'A-1')!.blocked).toBe(false)
  expect(v.projects.map((p) => p.key)).toEqual(['A', 'CROW'])
  expect(v.me).toEqual({ username: 'bob', admin: false })
})

test('progress counts only subtasks the user can see', () => {
  createTask(db, { title: 'sub', parent: 'CROW-1' })
  index = buildIndex(db)
  expect(task('CROW-1').progress.total).toBe(1)
  db.exec("UPDATE tasks SET extra = '{}' WHERE number = 2 AND project = 'CROW'")
  index = buildIndex(db)
  const v = visibleIndex(index, bob as Identity & { kind: 'user' })
  expect(v.tasks.find((t) => t.id === 'CROW-1')!.progress).toEqual({ done: 0, total: 0 })
})

test('admin sees every task', () => {
  expect(visibleIndex(index, admin as Identity & { kind: 'user' }).tasks).toHaveLength(3)
})

test('a reporter may edit the description of their feedback but not its status', () => {
  expect(op(bob, 'CROW-1', { type: 'setBody', body: 'x' })).toBeUndefined()
  expect(op(bob, 'CROW-1', { type: 'addComment', author: 'bob', body: 'x' })).toBeUndefined()
  expect(op(bob, 'CROW-1', { type: 'setStatus', status: 'done' })).toBe('forbidden')
})

test('only the author or admin may edit a comment', () => {
  const edit = (i: number): Op => ({ type: 'editComment', index: i, at: task('A-1').comments[i].at, body: 'x' })
  expect(op(bob, 'A-1', edit(0))).toBe('forbidden')
  expect(op(bob, 'A-1', edit(1))).toBeUndefined()
  expect(op(admin, 'A-1', edit(0))).toBeUndefined()
})

test('a member cannot move a task to a project they are not in', () => {
  expect(op(bob, 'A-1', { type: 'setProject', project: 'B' })).toBe('forbidden')
})

test('a member cannot link to a task they cannot see', () => {
  expect(op(bob, 'A-1', { type: 'addLink', link: { type: 'relates', id: 'B-1' } })).toBe('forbidden')
  expect(op(bob, 'A-1', { type: 'setParent', parent: 'B-1' })).toBe('forbidden')
})

test('hawk may only comment and set status', () => {
  expect(op(hawk, 'B-1', { type: 'addComment', author: 'hawk', body: 'deployed' })).toBeUndefined()
  expect(op(hawk, 'B-1', { type: 'setStatus', status: 'done' })).toBeUndefined()
  expect(op(hawk, 'B-1', { type: 'setBody', body: 'x' })).toBe('forbidden')
})

test('crow creates only in CROW; only crow sets a reporter', () => {
  expect(code(() => checkCreate(index, crow, { title: 'x', project: 'A' }))).toBe('forbidden')
  expect(code(() => checkCreate(index, crow, { title: 'x', project: 'CROW', reporter: 'bob' }))).toBeUndefined()
  expect(code(() => checkCreate(index, bob, { title: 'x', project: 'A', reporter: 'x' }))).toBe('forbidden')
  expect(code(() => checkCreate(index, bob, { title: 'x', project: 'A' }))).toBeUndefined()
  expect(code(() => checkCreate(index, bob, { title: 'x', project: 'B' }))).toBe('forbidden')
  expect(code(() => checkCreate(index, hawk, { title: 'x', project: 'CROW' }))).toBe('forbidden')
})

test('only the owner or admin manages a project', () => {
  expect(canManageProject(index, bob, 'A')).toBe(false)
  expect(canManageProject(index, { kind: 'user', username: 'ann', admin: false }, 'A')).toBe(true)
  expect(canManageProject(index, admin, 'A')).toBe(true)
})
