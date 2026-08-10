import type { Config, Context } from '@netlify/functions'
import { getStore } from '@netlify/blobs'

/**
 * Visitor counter behind the live social-proof pill on the homepage.
 *
 * Two figures are kept, because "how busy is this page today" is far stronger
 * proof than a lifetime total, but a lifetime total is the only figure that
 * reads well on a quiet morning — the page picks whichever is meaningful and
 * shows nothing at all when neither is yet.
 *
 * A single blob holds both. Only the current day is retained (the daily tally
 * rolls over the moment the date changes) so the value never grows unbounded.
 */

const STORE_NAME = 'site-stats'
const KEY = 'visitor-count'

interface Stats {
  /** All-time visits. */
  total?: number
  /** ISO date (YYYY-MM-DD, UTC) that `dayTotal` belongs to. */
  day?: string
  /** Visits recorded so far on `day`. */
  dayTotal?: number
  /** The original single-number shape, still read so no history is lost. */
  count?: number
}

const utcDay = (): string => new Date().toISOString().slice(0, 10)

export default async (req: Request, context: Context) => {
  // Strong consistency so a read immediately after an increment reflects it.
  const store = getStore({ name: STORE_NAME, consistency: 'strong' })

  const stored = ((await store.get(KEY, { type: 'json' })) as Stats | null) ?? {}
  const today = utcDay()

  let total = stored.total ?? stored.count ?? 0
  // Yesterday's tally is not today's proof, so it restarts at midnight UTC.
  let dayTotal = stored.day === today ? stored.dayTotal ?? 0 : 0

  // POST marks a new visit and increments the totals; GET just reads them.
  if (req.method === 'POST') {
    total += 1
    dayTotal += 1
    await store.setJSON(KEY, { total, day: today, dayTotal })
  }

  return Response.json(
    { total, today: dayTotal },
    // A counter that reads minutes stale looks broken, so never let this sit in
    // a CDN or browser cache.
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

export const config: Config = {
  path: '/api/visitor-count',
  method: ['GET', 'POST'],
}
