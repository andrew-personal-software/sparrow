import { tx } from './db'
import type { Db } from './db'
import { KbError } from './errors'
import { normalizeProjectKey } from './keys'

function ownerOf(db: Db, key: string): string {
  const row = db.prepare('SELECT owner FROM projects WHERE key = ?').get(key) as { owner: string } | undefined
  if (!row) throw new KbError('not_found', `project ${key} not found`)
  return row.owner
}

function known(db: Db, username: string): void {
  if (!db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) {
    throw new KbError('invalid', `${username} has not signed in to sparrow yet`)
  }
}

export function addMember(db: Db, project: string, username: string): void {
  const key = normalizeProjectKey(project)
  if (ownerOf(db, key) === username) return
  known(db, username)
  db.prepare('INSERT OR IGNORE INTO members (project, username) VALUES (?, ?)').run(key, username)
}

export function removeMember(db: Db, project: string, username: string): void {
  const key = normalizeProjectKey(project)
  if (ownerOf(db, key) === username) throw new KbError('invalid', `${username} owns ${key}; change the owner first`)
  db.prepare('DELETE FROM members WHERE project = ? AND username = ?').run(key, username)
}

export function setOwner(db: Db, project: string, username: string): void {
  const key = normalizeProjectKey(project)
  tx(db, () => {
    const old = ownerOf(db, key)
    known(db, username)
    db.prepare('UPDATE projects SET owner = ? WHERE key = ?').run(username, key)
    db.prepare('DELETE FROM members WHERE project = ? AND username = ?').run(key, username)
    db.prepare('INSERT OR IGNORE INTO members (project, username) VALUES (?, ?)').run(key, old)
  })
}
