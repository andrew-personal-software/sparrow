import { applyOp, canSee, deleteTask, KbError, normalizeTaskKey, viewTask, visibleIndex } from '@/core'
import type { Op } from '@/core'
import { requireIdentity } from '@/server/auth'
import { errorResponse, getState, refresh } from '@/server/state'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const id = requireIdentity(req)
    const key = normalizeTaskKey((await params).id)
    const { index } = getState()
    const view = viewTask(index, key)
    if (!view || !canSee(index, id, view)) throw new KbError('not_found', `task ${key} not found`)
    return Response.json(id.kind === 'user' ? viewTask(visibleIndex(index, id), view.id) : view)
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const key = normalizeTaskKey((await params).id)
    const state = getState()
    const { op } = (await req.json()) as { op: Op }
    // A comment without an author (from the CLI) is from the Tailscale user, else the board user.
    if (op?.type === 'addComment' && !op.author) {
      op.author = req.headers.get('Tailscale-User-Login') || state.index.config.user || 'ai'
    }
    const task = applyOp(state.db, key, op)
    refresh(state)
    const view = viewTask(state.index, task.id)
    if (!view) throw new KbError('not_found', `task ${key} not found`)
    return Response.json(view)
  } catch (err) {
    return errorResponse(err)
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const key = normalizeTaskKey((await params).id)
    const state = getState()
    deleteTask(state.db, key)
    refresh(state)
    return Response.json({ ok: true })
  } catch (err) {
    return errorResponse(err)
  }
}
