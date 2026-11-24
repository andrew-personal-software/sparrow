import { constants, createGzip } from 'node:zlib'
import { canSee, visibleIndex } from '@/core'
import { requireUser } from '@/server/auth'
import { onShutdown } from '@/server/shutdown'
import { errorResponse, getState, userRev } from '@/server/state'
import type { ServerEvent } from '@/server/state'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PING_MS = 15000

function sse(data: string): string {
  return `data: ${data}\n\n`
}

export async function GET(req: Request): Promise<Response> {
  try {
    const id = requireUser(req)
    const state = getState()
    const clientRev = new URL(req.url).searchParams.get('rev')
    // Gzipped by hand (see /api/tasks); a sync flush after each write keeps events from being buffered.
    const gzip = /\bgzip\b/.test(req.headers.get('accept-encoding') ?? '') ? createGzip() : null

    const stream = new ReadableStream({
      start(controller) {
        let closed = false
        const cleanup = (): void => {
          if (closed) return
          closed = true
          offShutdown()
          clearInterval(ping)
          state.emitter.off('event', onEvent)
          gzip?.destroy()
          try {
            controller.close()
          } catch {}
        }

        // Guards against enqueueing on an already-closed/errored controller
        // (e.g. a client that disconnected between ticks): a thrown error
        // here would otherwise surface as an uncaught exception at the
        // emitter/watcher callsite that triggered it.
        const safeEnqueue = (chunk: Uint8Array): void => {
          try {
            controller.enqueue(chunk)
          } catch {
            cleanup()
          }
        }

        const send = (text: string): void => {
          if (closed) return
          if (!gzip) return safeEnqueue(new TextEncoder().encode(text))
          gzip.write(text)
          gzip.flush(constants.Z_SYNC_FLUSH)
        }
        gzip?.on('data', safeEnqueue)
        gzip?.on('error', cleanup)

        // Ids this user has been sent, so a task that becomes hidden is removed from their view.
        const sent = new Set<string>()
        const snapshot = (rev: string): ServerEvent => {
          const index = visibleIndex(state.index, id)
          sent.clear()
          for (const t of index.tasks) sent.add(t.id)
          return { type: 'snapshot', index, rev: userRev(rev, id.username) }
        }
        const filter = (event: ServerEvent): ServerEvent | null => {
          switch (event.type) {
            case 'upsert': {
              if (canSee(state.index, id, event.task)) {
                sent.add(event.task.id)
                const task = visibleIndex(state.index, id).tasks.find((t) => t.id === event.task.id)
                return task ? { type: 'upsert', task } : null
              }
              return sent.delete(event.task.id) ? { type: 'remove', id: event.task.id } : null
            }
            case 'remove':
              return sent.delete(event.id) ? event : null
            case 'snapshot':
              return snapshot(event.rev)
            default:
              return { ...event, rev: userRev(event.rev, id.username) }
          }
        }
        const onEvent = (event: ServerEvent): void => {
          const out = filter(event)
          if (out) send(sse(JSON.stringify(out)))
        }
        state.emitter.on('event', onEvent)

        const ping = setInterval(() => send(': ping\n\n'), PING_MS)

        req.signal.addEventListener('abort', cleanup)
        const offShutdown = onShutdown(cleanup)

        const rev = userRev(state.rev, id.username)
        const first: ServerEvent = clientRev === rev ? { type: 'unchanged', rev } : snapshot(state.rev)
        if (clientRev === rev) for (const t of visibleIndex(state.index, id).tasks) sent.add(t.id)
        send(sse(JSON.stringify(first)))
      },
    })

    const headers: Record<string, string> = {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      Vary: 'Accept-Encoding',
    }
    if (gzip) headers['Content-Encoding'] = 'gzip'
    return new Response(stream, { headers })
  } catch (err) {
    return errorResponse(err)
  }
}
