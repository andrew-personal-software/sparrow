import { createProject, KbError } from '@/core'
import { requireIdentity } from '@/server/auth'
import { errorResponse, getState, refresh } from '@/server/state'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request): Promise<Response> {
  try {
    const id = requireIdentity(req)
    if (id.kind !== 'user') throw new KbError('forbidden', 'services cannot create projects')
    const state = getState()
    const input = (await req.json()) as { key: string; name?: string }
    const project = createProject(state.db, input, id.username)
    refresh(state)
    return Response.json(project)
  } catch (err) {
    return errorResponse(err)
  }
}
