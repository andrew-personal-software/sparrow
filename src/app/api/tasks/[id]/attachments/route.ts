import { addAttachment, assertRoom, canWrite, KbError, MAX_ATTACHMENT_BYTES, normalizeTaskKey } from '@/core'
import type { Identity, Index, Task } from '@/core'
import { requireIdentity, viewFor, visibleTask } from '@/server/auth'
import { errorResponse, getState, refresh } from '@/server/state'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Members upload; crow uploads only to CROW feedback.
const canUpload = (index: Index, id: Identity, task: Task) =>
  id.kind === 'service' ? id.name === 'crow' && task.project === 'CROW' : canWrite(index, id, task)

// Multipart upload with a single `file` field.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const id = requireIdentity(req)
    const key = normalizeTaskKey((await params).id)
    const before = getState()
    const task = visibleTask(before.index, id, key)
    if (!canUpload(before.index, id, task)) throw new KbError('forbidden', `no write access to ${key}`)
    const length = Number(req.headers.get('content-length'))
    if (length > MAX_ATTACHMENT_BYTES + 64 * 1024) {
      return Response.json({ error: { code: 'invalid', message: 'attachment exceeds 25 MB' } }, { status: 413 })
    }
    // Crow's uploads count to the person who sent the feedback.
    const uploader = id.kind === 'user' ? id.username : typeof task.extra.reporter === 'string' ? task.extra.reporter : id.name
    if (length) assertRoom(before.db, uploader, length)
    const file = (await req.formData().catch(() => null))?.get('file')
    if (!(file instanceof File)) throw new KbError('usage', 'expected multipart form data with a "file" field')
    const state = getState()
    assertRoom(state.db, uploader, file.size)
    addAttachment(state.db, key, { filename: file.name, mime: file.type, data: new Uint8Array(await file.arrayBuffer()), uploader })
    refresh(state)
    return Response.json(viewFor(state.index, id, key))
  } catch (err) {
    return errorResponse(err)
  }
}
