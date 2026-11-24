import type { Db } from './db'
import { KbError } from './errors'

export function touchUser(db: Db, username: string, now = new Date()): void {
  const at = now.toISOString()
  db.prepare('INSERT INTO users (username, first_seen, last_seen) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET last_seen = excluded.last_seen').run(username, at, at)
}

export function listUsers(db: Db): string[] {
  return (db.prepare('SELECT username FROM users ORDER BY username').all() as { username: string }[]).map((r) => r.username)
}

const MB = 1024 * 1024
export const DEFAULT_QUOTA_BYTES = 500 * MB

// Bytes of live attachments the user uploaded.
export function usageOf(db: Db, username: string): number {
  const row = db
    .prepare('SELECT COALESCE(SUM(a.size), 0) AS n FROM attachments a JOIN tasks t ON t.id = a.task_id WHERE t.deleted_at IS NULL AND a.uploader = ?')
    .get(username) as { n: number }
  return Number(row.n)
}

export function quotaOf(db: Db, username: string): number {
  const row = db.prepare('SELECT quota_bytes FROM users WHERE username = ?').get(username) as { quota_bytes: number | null } | undefined
  return row?.quota_bytes ?? DEFAULT_QUOTA_BYTES
}

// null goes back to the default.
export function setQuota(db: Db, username: string, bytes: number | null): void {
  const at = new Date().toISOString()
  db.prepare('INSERT INTO users (username, first_seen, last_seen, quota_bytes) VALUES (?, ?, ?, ?) ON CONFLICT DO UPDATE SET quota_bytes = excluded.quota_bytes').run(
    username,
    at,
    at,
    bytes,
  )
}

export function assertRoom(db: Db, username: string, bytes: number): void {
  const used = usageOf(db, username)
  const limit = quotaOf(db, username)
  const mb = (n: number) => Number((n / MB).toFixed(1))
  if (used + bytes > limit) throw new KbError('too_large', `storage limit reached (${mb(used)} MB of ${mb(limit)} MB)`)
}
