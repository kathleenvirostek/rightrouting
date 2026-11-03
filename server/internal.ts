import { eq } from 'drizzle-orm'
import { db, settings } from '../db'

let cached: string | null = null

// Shared secret (stored in the database, never sent to the browser) that the
// API passes to background functions so outsiders can't trigger agent runs.
export async function getInternalToken(): Promise<string> {
  if (cached) return cached
  const [row] = await db.select().from(settings).where(eq(settings.key, 'internal_token'))
  if (row) return (cached = String(row.value))
  const token = crypto.randomUUID()
  await db.insert(settings).values({ key: 'internal_token', value: token }).onConflictDoNothing()
  const [again] = await db.select().from(settings).where(eq(settings.key, 'internal_token'))
  return (cached = String(again.value))
}

export async function isInternal(req: Request) {
  const t = req.headers.get('x-internal-token')
  return Boolean(t) && t === (await getInternalToken())
}
