import fs from 'node:fs'
import { canWrite, getAttachment, isInlineImage, KbError, normalizeTaskKey, removeAttachment } from '@/core'
import { requireIdentity, viewFor, visibleTask } from '@/server/auth'
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
    visibleTask(index, who, key)
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

export async function DELETE(req: Request, { params }: Params): Promise<Response> {
  try {
    const who = requireIdentity(req)
    const { id, attId } = await params
    const key = normalizeTaskKey(id)
    const state = getState()
    if (!canWrite(state.index, who, visibleTask(state.index, who, key))) throw new KbError('forbidden', `no write access to ${key}`)
    removeAttachment(state.db, key, attId)
    refresh(state)
    return Response.json(viewFor(state.index, who, key))
  } catch (err) {
    return errorResponse(err)
  }
}
