import type { Config, Context } from '@netlify/functions'
import { getDatabase } from '@netlify/database'
import Stripe from 'stripe'
import {
  clean,
  reportLink,
  siteBase,
  verifyPurchase,
  type OrderRow,
} from './lib/premium-report.mts'

/**
 * Status endpoint for the paid "Premium AI Growth Report".
 *
 * The delivery page calls this on load and then polls it. Everything expensive
 * happens elsewhere: a deep 10-section report takes well over the synchronous
 * function limit to write, so this endpoint only ever
 *
 *   1. proves the Stripe session was actually paid,
 *   2. records the order (once) so the purchase is never lost,
 *   3. hands back the stored report if it is finished, and
 *   4. kicks off the background generator if it is not.
 *
 * Because the finished report is persisted, this is idempotent — refreshing the
 * page or coming back next month returns the same document without spending
 * another penny of inference.
 */

const GENERATOR_PATH = '/.netlify/functions/premium-report-generate'

/** Fire-and-forget nudge to the background worker; it replies 202 immediately. */
const triggerGeneration = async (base: string, sessionId: string): Promise<void> => {
  try {
    const res = await fetch(`${base}${GENERATOR_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    })
    if (!res.ok && res.status !== 202) {
      console.error('premium-report: generator returned', res.status)
    }
  } catch (error) {
    console.error('premium-report: could not reach generator:', error)
  }
}

export default async (req: Request, context: Context) => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }

  const secret = process.env.STRIPE_SECRET_KEY
  // Payments aren't switched on yet — the page shows a "get in touch" fallback
  // rather than a broken purchase flow.
  if (!secret) {
    return Response.json({ configured: false })
  }

  let body: { sessionId?: string }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const sessionId = clean(body.sessionId, '', 200)
  if (!sessionId) {
    return Response.json({ error: 'Missing checkout session' }, { status: 400 })
  }

  const verified = await verifyPurchase(new Stripe(secret), sessionId)
  if (!verified.ok) {
    return Response.json({ error: verified.error }, { status: verified.status })
  }
  const p = verified.purchase

  const db = getDatabase()

  // Record the order the first time we see this session. Doing this before
  // generation means a paid customer is on file even if every later step fails.
  let order: OrderRow | undefined
  try {
    await db.sql`
      INSERT INTO premium_report_orders
        (stripe_session_id, email, business_name, industry, city, usp, amount_paid, currency)
      VALUES
        (${sessionId}, ${p.email}, ${p.businessName}, ${p.industry}, ${p.city}, ${p.usp},
         ${p.amountPaid}, ${p.currency})
      ON CONFLICT (stripe_session_id) DO NOTHING
    `

    const rows = (await db.sql`
      SELECT id, stripe_session_id, email, business_name, industry, city, usp, status, report, attempts
      FROM premium_report_orders
      WHERE stripe_session_id = ${sessionId}
    `) as OrderRow[]
    order = rows[0]
  } catch (error) {
    // The money has already changed hands, so never leave the customer with a
    // bare 500 — tell them their purchase is safe and how to reach us.
    console.error('premium-report: order storage failed:', error)
    return Response.json(
      {
        error:
          "Your payment went through, but we couldn't open your report just now. Please refresh in a moment — or email info@echoliftai.co.uk and we'll deliver it by hand.",
      },
      { status: 503 },
    )
  }

  if (!order) {
    return Response.json({ error: 'Could not load your order.' }, { status: 500 })
  }

  const base = siteBase(req)

  // Finished — hand over the document they paid for.
  if (order.report) {
    return Response.json({
      configured: true,
      status: 'ready',
      businessName: order.business_name,
      industry: order.industry,
      city: order.city,
      reportRef: `ELR-${String(order.id).padStart(5, '0')}`,
      reportUrl: reportLink(base, sessionId),
      report: order.report,
    })
  }

  // Not finished. Claim the right to start a run: the WHERE clause is the lock,
  // so concurrent polls (or two open tabs) can't launch duplicate generators,
  // and a run that died silently is retried once its stamp goes stale.
  const claimed = (await db.sql`
    UPDATE premium_report_orders
    SET generation_started_at = NOW(), attempts = attempts + 1
    WHERE id = ${order.id}
      AND report IS NULL
      AND attempts < 3
      AND (generation_started_at IS NULL OR generation_started_at < NOW() - INTERVAL '3 minutes')
    RETURNING id
  `) as Array<{ id: number }>

  if (claimed.length > 0) {
    await triggerGeneration(base, sessionId)
  }

  // Three failed attempts means something is wrong that polling won't fix.
  if (claimed.length === 0 && order.attempts >= 3) {
    return Response.json({
      configured: true,
      status: 'failed',
      businessName: order.business_name,
      reportRef: `ELR-${String(order.id).padStart(5, '0')}`,
    })
  }

  return Response.json({
    configured: true,
    status: 'pending',
    businessName: order.business_name,
    reportRef: `ELR-${String(order.id).padStart(5, '0')}`,
  })
}

export const config: Config = {
  path: '/api/premium-report',
  method: 'POST',
}
