import { beforeEach, expect, test } from 'vitest'
import { openDb } from './db'
import type { Db } from './db'
import { buildIndex } from './indexer'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { addAttachment, removeAttachment } from './attachments'
import { mimeFor } from './mime'
import { createTask } from './ops'
import { assertRoom, DEFAULT_QUOTA_BYTES, listUsers, quotaOf, setQuota, touchUser, usageOf } from './users'

let db: Db
beforeEach(() => {
  db = openDb(':memory:')
  process.env.SPARROW_ATTACHMENTS = path.join(mkdtempSync(path.join(tmpdir(), 'sparrow-users-')), 'att')
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

test('usage counts live attachments by uploader, against the limit', () => {
  touchUser(db, 'bob')
  setQuota(db, 'bob', 1024 * 1024)
  createTask(db, { title: 't', project: 'SPAR' })
  const att = addAttachment(db, 'SPAR-1', { filename: 'a.bin', data: new Uint8Array(600 * 1024), uploader: 'bob' })
  expect(usageOf(db, 'bob')).toBe(600 * 1024)
  expect(quotaOf(db, 'bob')).toBe(1024 * 1024)
  expect(() => assertRoom(db, 'bob', 600 * 1024)).toThrow('storage limit reached (0.6 MB of 1 MB)')
  removeAttachment(db, 'SPAR-1', att.id)
  expect(usageOf(db, 'bob')).toBe(0)
})

test('the default limit is 500 MB', () => {
  expect(DEFAULT_QUOTA_BYTES).toBe(500 * 1024 * 1024)
  expect(quotaOf(db, 'nobody')).toBe(DEFAULT_QUOTA_BYTES)
  setQuota(db, 'bob', 5)
  setQuota(db, 'bob', null)
  expect(quotaOf(db, 'bob')).toBe(DEFAULT_QUOTA_BYTES)
})

test('video files get video types', () => {
  expect(['a.mp4', 'a.webm', 'a.mov'].map(mimeFor)).toEqual(['video/mp4', 'video/webm', 'video/quicktime'])
})
