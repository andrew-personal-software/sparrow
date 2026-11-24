import type { Db } from './db'

export function touchUser(db: Db, username: string, now = new Date()): void {
  const at = now.toISOString()
  db.prepare('INSERT INTO users (username, first_seen, last_seen) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET last_seen = excluded.last_seen').run(username, at, at)
}

export function listUsers(db: Db): string[] {
  return (db.prepare('SELECT username FROM users ORDER BY username').all() as { username: string }[]).map((r) => r.username)
}
