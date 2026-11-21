import { PROD_URL } from '@/core/env'
import type { Task } from '@/core'

const HAWK_URL = 'http://127.0.0.1:3402/v1/messages'

// Tells hawk-notifyd that a one-shot task was created (prev undefined) or changed status.
// Fire and forget: a failed send is logged and never reaches the task write.
export function notifyTaskStatus(task: Task, prev?: Task): void {
  if (process.env.NODE_ENV !== 'production') return
  const body = {
    topic: 'sparrow.task.status',
    title: prev ? `${task.id}: ${prev.status} → ${task.status}` : `${task.id} created`,
    link: `${PROD_URL}/t/${task.id}`,
    thread: task.id,
    key: `${task.id}:${task.status}:${task.updated}`,
  }
  fetch(HAWK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  })
    .then((res) => {
      if (!res.ok) console.error(`sparrow: hawk notify failed: ${res.status} ${res.statusText}`)
    })
    .catch((err) => console.error('sparrow: hawk notify failed', err))
}
