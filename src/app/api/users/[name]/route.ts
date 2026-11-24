import { KbError, quotaOf, setQuota, usageOf } from '@/core'
import { requireUser } from '@/server/auth'
import { errorResponse, getState } from '@/server/state'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Admin sets a user's storage limit in MB; null goes back to the default.
export async function PATCH(req: Request, { params }: { params: Promise<{ name: string }> }): Promise<Response> {
  try {
    if (!requireUser(req).admin) throw new KbError('forbidden', 'only an admin can set a storage limit')
    const { name } = await params
    const { quotaMb } = (await req.json()) as { quotaMb?: number | null }
    if (quotaMb !== null && !(typeof quotaMb === 'number' && quotaMb >= 0)) throw new KbError('usage', 'expected { "quotaMb": <MB> | null }')
    const { db } = getState()
    setQuota(db, name, quotaMb === null ? null : Math.round(quotaMb * 1024 * 1024))
    return Response.json({ username: name, quotaBytes: quotaOf(db, name), usedBytes: usageOf(db, name) })
  } catch (err) {
    return errorResponse(err)
  }
}
