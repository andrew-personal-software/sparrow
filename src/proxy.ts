import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { readDevState } from '@/core/dev-state'
import { authorizationFor, ENV_HEADER, PROD_URL } from '@/core/env'
import { KbError } from '@/core/errors'
import { compareVersions, VERSION, VERSION_HEADER } from '@/core/version'
import { identityFrom } from '@/server/identity'

const AUTH_STATUS = { unauthorized: 401, forbidden: 403 } as Record<string, number>

// Checks the Authentik identity, then rejects API calls from clients on a different major version. No version header
// (browsers, curl) is allowed. A dev server switched to prod (scripts/dev.sh) forwards API calls to the prod server.
export function proxy(req: NextRequest): Response {
  const client = req.headers.get(VERSION_HEADER)
  const headers = { [VERSION_HEADER]: VERSION }
  const { pathname, search } = req.nextUrl
  if (pathname !== '/api/version') {
    try {
      identityFrom(req.headers)
    } catch (err) {
      if (!(err instanceof KbError)) throw err
      return Response.json({ error: { code: err.code, message: err.message } }, { status: AUTH_STATUS[err.code] ?? 401, headers })
    }
  }
  if (client && pathname !== '/api/version' && compareVersions(client, VERSION) === 'incompatible') {
    const message = `client version ${client} is incompatible with server version ${VERSION}`
    return Response.json({ error: { code: 'version', message } }, { status: 426, headers })
  }
  if (
    process.env.NODE_ENV === 'development' &&
    pathname.startsWith('/api/') &&
    pathname !== '/api/dev/env' &&
    req.headers.get(ENV_HEADER) !== 'dev' &&
    readDevState()?.env === 'prod'
  ) {
    // Dev code is often ahead of prod's version, so it skips prod's version check.
    const forwarded = new Headers(req.headers)
    forwarded.delete(VERSION_HEADER)
    if (process.env.SPARROW_TOKEN) forwarded.set('Authorization', authorizationFor(process.env.SPARROW_TOKEN))
    return NextResponse.rewrite(new URL(pathname + search, PROD_URL), { request: { headers: forwarded } })
  }
  return NextResponse.next({ headers })
}

// Everything but Next's static files and the app icons.
export const config = { matcher: '/((?!_next/static|_next/image|favicon.ico|icon|apple-icon|manifest.webmanifest|sw.js).*)' }
