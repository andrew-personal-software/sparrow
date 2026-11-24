import { applyOp, canWrite, checkOp, deleteTask, KbError, normalizeTaskKey } from '@/core'
import type { Op } from '@/core'
import { requireIdentity, viewFor, visibleTask } from '@/server/auth'
import { errorResponse, getState, refresh } from '@/server/state'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const id = requireIdentity(req)
    const key = normalizeTaskKey((await params).id)
    const { index } = getState()
    return Response.json(viewFor(index, id, visibleTask(index, id, key).id))
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const id = requireIdentity(req)
    const key = normalizeTaskKey((await params).id)
    const state = getState()
    const { op } = (await req.json()) as { op: Op }
    if (!op?.type) throw new KbError('usage', 'expected { op: { type, ... } }')
    checkOp(state.index, id, visibleTask(state.index, id, key), op)
    if (op.type === 'addComment') op.author = id.kind === 'user' ? id.username : id.name
    const task = applyOp(state.db, key, op)
    refresh(state)
    const view = viewFor(state.index, id, task.id)
    if (!view) throw new KbError('not_found', `task ${key} not found`)
    return Response.json(view)
  } catch (err) {
    return errorResponse(err)
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const id = requireIdentity(req)
    const key = normalizeTaskKey((await params).id)
    const state = getState()
    if (!canWrite(state.index, id, visibleTask(state.index, id, key))) throw new KbError('forbidden', `no write access to ${key}`)
    deleteTask(state.db, key)
    refresh(state)
    return Response.json({ ok: true })
  } catch (err) {
    return errorResponse(err)
  }
}
