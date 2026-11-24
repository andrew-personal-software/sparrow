import { addAttachment, canWrite, KbError, MAX_ATTACHMENT_BYTES, normalizeTaskKey } from '@/core'
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
    if (!canUpload(before.index, id, visibleTask(before.index, id, key))) throw new KbError('forbidden', `no write access to ${key}`)
    if (Number(req.headers.get('content-length')) > MAX_ATTACHMENT_BYTES + 64 * 1024) {
      return Response.json({ error: { code: 'invalid', message: 'attachment exceeds 25 MB' } }, { status: 413 })
    }
    const file = (await req.formData().catch(() => null))?.get('file')
    if (!(file instanceof File)) throw new KbError('usage', 'expected multipart form data with a "file" field')
    const state = getState()
    addAttachment(state.db, key, { filename: file.name, mime: file.type, data: new Uint8Array(await file.arrayBuffer()) })
    refresh(state)
    return Response.json(viewFor(state.index, id, key))
  } catch (err) {
    return errorResponse(err)
  }
}
