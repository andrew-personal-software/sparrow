import { listUsers } from '@/core'
import { requireUser } from '@/server/auth'
import { errorResponse, getState } from '@/server/state'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Usernames that have signed in, for the add-member picker.
export async function GET(req: Request): Promise<Response> {
  try {
    requireUser(req)
    return Response.json(listUsers(getState().db))
  } catch (err) {
    return errorResponse(err)
  }
}
