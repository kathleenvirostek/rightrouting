import { desc } from 'drizzle-orm'
import { db, corrections } from '../db'

const STOP = new Set(
  'a an and are as at be been but by can could do does for from had has have hi hello i im i\'m if in is it its just me my of on or please so that the their them then there this to too was we were what when will with would you your thanks thank dr doctor'.split(
    ' ',
  ),
)

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP.has(t))
}

// Retrieves the most similar past reroute corrections with TF-IDF cosine
// similarity. At clinic scale (hundreds to low thousands of corrections) this
// is fast, transparent and needs no embedding model.
export async function similarCorrections(query: string, k = 3) {
  const rows = await db.select().from(corrections).orderBy(desc(corrections.createdAt)).limit(500)
  if (!rows.length) return []
  const docs = rows.map((r) => tokens(r.messageText))
  const df = new Map<string, number>()
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1)
  const N = docs.length
  const vec = (toks: string[]) => {
    const tf = new Map<string, number>()
    for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1)
    const v = new Map<string, number>()
    for (const [t, c] of tf) v.set(t, c * Math.log(1 + N / (1 + (df.get(t) ?? 0))))
    return v
  }
  const norm = (v: Map<string, number>) => Math.sqrt([...v.values()].reduce((s, x) => s + x * x, 0)) || 1
  const q = vec(tokens(query))
  const qn = norm(q)
  return rows
    .map((r, i) => {
      const d = vec(docs[i])
      let dot = 0
      for (const [t, w] of q) dot += w * (d.get(t) ?? 0)
      return { row: r, score: dot / (qn * norm(d)) }
    })
    .filter((x) => x.score > 0.08)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map(({ row, score }) => ({
      similarity: Math.round(score * 100) / 100,
      message: row.messageText.slice(0, 400),
      intent: row.intent,
      ai_routed_to: row.fromRole,
      staff_corrected_to: row.toRole,
      staff_reason: row.reason,
    }))
}
