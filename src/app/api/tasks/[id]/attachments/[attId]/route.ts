import fs from 'node:fs'
import { canSee, getAttachment, isInlineImage, KbError, normalizeTaskKey, removeAttachment, viewTask } from '@/core'
import { requireIdentity } from '@/server/auth'
import { errorResponse, getState, refresh } from '@/server/state'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string; attId: string }> }

export async function GET(req: Request, { params }: Params): Promise<Response> {
  try {
    const who = requireIdentity(req)
    const { id, attId } = await params
    const key = normalizeTaskKey(id)
    const { db, index } = getState()
    const task = viewTask(index, key)
    if (!task || !canSee(index, who, task)) throw new KbError('not_found', `task ${key} not found`)
    const att = getAttachment(db, key, attId)
    if (!fs.existsSync(att.file)) throw new KbError('not_found', `attachment ${attId} file is missing`)
    const inline = isInlineImage(att.mime)
    const ascii = att.filename.replace(/[^\x20-\x7e]|["\\]/g, '_')
    return new Response(new Uint8Array(fs.readFileSync(att.file)), {
      headers: {
        'Content-Type': inline ? att.mime : 'application/octet-stream',
        'Content-Length': String(att.size),
        'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(att.filename)}`,
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      },
    })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function DELETE(_req: Request, { params }: Params): Promise<Response> {
  try {
    const { id, attId } = await params
    const key = normalizeTaskKey(id)
    const state = getState()
    removeAttachment(state.db, key, attId)
    refresh(state)
    return Response.json(viewTask(state.index, key))
  } catch (err) {
    return errorResponse(err)
  }
}
