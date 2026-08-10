import type { Config } from '@netlify/functions'
import { getDatabase } from '@netlify/database'

/**
 * Lead capture for the paid AI Growth Report.
 *
 * This replaces the old `/api/growth-report` endpoint, which generated a full
 * report for free. The report is now the £47 product, so nothing is written
 * here: the site posts the brief on its way to Stripe purely so a visitor who
 * doesn't complete checkout is still an owned, followable lead.
 *
 * Deliberately cheap and silent — no inference, no email. The daily nurture
 * sweep picks these rows up at step 0 and sends the follow-up, which keeps the
 * checkout redirect as fast as possible.
 */

interface BriefRequest {
  email?: string
  businessName?: string
  industry?: string
  city?: string
  usp?: string
}

const clean = (value: unknown, fallback = '', max = 80): string => {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim().slice(0, max)
  return trimmed.length > 0 ? trimmed : fallback
}

const cleanEmail = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toLowerCase().slice(0, 160) : ''

// Basic, forgiving email shape check — enough to keep junk out of the pipeline.
const isValidEmail = (email: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)

export default async (req: Request) => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }

  let body: BriefRequest
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const email = cleanEmail(body.email)
  if (!isValidEmail(email)) {
    return Response.json({ error: 'Please enter a valid email address.' }, { status: 400 })
  }

  const lead = {
    email,
    businessName: clean(body.businessName, 'a local business'),
    industry: clean(body.industry, 'general services'),
    city: clean(body.city, 'the UK'),
    usp: clean(body.usp, 'quality service'),
  }

  try {
    const db = getDatabase()

    // A visitor who opens checkout, backs out and tries again is one lead, not
    // three, so the same brief inside a day is folded into the existing row.
    const existing = (await db.sql`
      SELECT id FROM leads
      WHERE email = ${lead.email}
        AND business_name = ${lead.businessName}
        AND created_at > NOW() - INTERVAL '1 day'
      ORDER BY created_at DESC
      LIMIT 1
    `) as Array<{ id: number }>

    if (existing[0]?.id) {
      await db.sql`
        UPDATE leads
        SET industry = ${lead.industry}, city = ${lead.city}, usp = ${lead.usp}
        WHERE id = ${existing[0].id}
      `
      return Response.json({ captured: true })
    }

    await db.sql`
      INSERT INTO leads (email, business_name, industry, city, usp, source)
      VALUES (${lead.email}, ${lead.businessName}, ${lead.industry}, ${lead.city}, ${lead.usp},
              ${'report-checkout'})
    `

    return Response.json({ captured: true })
  } catch (error) {
    // Bookkeeping must never stand between a customer and the payment page: the
    // browser ignores this and opens Stripe regardless.
    console.error('report-lead error:', error)
    return Response.json({ captured: false }, { status: 200 })
  }
}

export const config: Config = {
  path: '/api/report-lead',
  method: 'POST',
}
