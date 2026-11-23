import { timingSafeEqual } from 'node:crypto'

/** The reporter name from a trusted service (crow), or undefined. Needs `Authorization: Bearer $SPARROW_SERVICE_TOKEN`. */
export function serviceReporter(req: Request, reporter: unknown): string | undefined {
  const token = process.env.SPARROW_SERVICE_TOKEN
  if (!token || typeof reporter !== 'string' || !reporter) return undefined
  const given = Buffer.from(req.headers.get('authorization') ?? '')
  const want = Buffer.from(`Bearer ${token}`)
  return given.length === want.length && timingSafeEqual(given, want) ? reporter : undefined
}
