import { canManageProject, canWriteProject, KbError, normalizeProjectKey, updateProject } from '@/core'
import { requireIdentity } from '@/server/auth'
import { errorResponse, getState, refresh } from '@/server/state'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function PATCH(req: Request, { params }: { params: Promise<{ key: string }> }): Promise<Response> {
  try {
    const id = requireIdentity(req)
    const { key } = await params
    const state = getState()
    const k = normalizeProjectKey(key)
    if (!canWriteProject(state.index, id, k)) throw new KbError('not_found', `project ${k} not found`)
    if (!canManageProject(state.index, id, k)) throw new KbError('forbidden', `only the owner can change ${key}`)
    const patch = (await req.json()) as { name?: string; color?: string }
    const project = updateProject(state.db, key, patch)
    refresh(state)
    return Response.json(project)
  } catch (err) {
    return errorResponse(err)
  }
}
