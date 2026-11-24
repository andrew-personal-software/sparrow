import { addMember, canManageProject, canWriteProject, KbError, loadProjects, normalizeProjectKey, removeMember } from '@/core'
import type { Identity, Index } from '@/core'
import { requireIdentity } from '@/server/auth'
import { errorResponse, getState, refresh } from '@/server/state'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ key: string }> }

function target(index: Index, id: Identity, key: string): string {
  const k = normalizeProjectKey(key)
  if (!canWriteProject(index, id, k)) throw new KbError('not_found', `project ${k} not found`)
  return k
}

async function username(req: Request): Promise<string> {
  const body = (await req.json().catch(() => null)) as { username?: unknown } | null
  if (typeof body?.username !== 'string' || !body.username) throw new KbError('usage', 'expected { "username": "..." }')
  return body.username
}

const project = (key: string) => loadProjects(getState().db).find((p) => p.key === key)

// Owner and admin add members.
export async function POST(req: Request, { params }: Params): Promise<Response> {
  try {
    const id = requireIdentity(req)
    const state = getState()
    const key = target(state.index, id, (await params).key)
    if (!canManageProject(state.index, id, key)) throw new KbError('forbidden', `only the owner can add members to ${key}`)
    addMember(state.db, key, await username(req))
    refresh(state)
    return Response.json(project(key))
  } catch (err) {
    return errorResponse(err)
  }
}

// Owner and admin remove members; a member may remove themself.
export async function DELETE(req: Request, { params }: Params): Promise<Response> {
  try {
    const id = requireIdentity(req)
    const state = getState()
    const key = target(state.index, id, (await params).key)
    const who = await username(req)
    const self = id.kind === 'user' && id.username === who
    if (!self && !canManageProject(state.index, id, key)) throw new KbError('forbidden', `only the owner can remove members from ${key}`)
    removeMember(state.db, key, who)
    refresh(state)
    return Response.json(project(key))
  } catch (err) {
    return errorResponse(err)
  }
}
