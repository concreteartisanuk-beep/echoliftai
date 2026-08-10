import type { Config } from '@netlify/functions'
import { getDatabase } from '@netlify/database'
import {
  emailEnabled,
  reportBriefEmail,
  nurtureDay2Email,
  nurtureDay5Email,
  sendEmail,
  type Lead,
} from './lib/email.mts'

/**
 * Daily nurture sweep. Advances each captured lead through a short email
 * sequence, one step per eligible run, never sending the same step twice:
 *
 *   step 0 → "finish your report" nudge  (everyone who filled in a report brief
 *                                          but hasn't bought yet)
 *   step 1 → "the calls you missed"      (2+ days after capture)
 *   step 2 → "start your free trial"     (5+ days after capture)
 *   step 3 → sequence complete
 *
 * The whole job is a no-op until email is configured (RESEND_API_KEY), so it is
 * safe to deploy before the mailer is switched on.
 */

type Row = Lead

const advance = async (
  db: ReturnType<typeof getDatabase>,
  rows: Row[],
  build: (lead: Lead) => { subject: string; html: string },
  nextStep: number,
): Promise<number> => {
  let sent = 0
  for (const row of rows) {
    const ok = await sendEmail({ to: row.email, ...build(row) })
    if (!ok) continue
    await db.sql`
      UPDATE leads SET nurture_step = ${nextStep}, last_email_at = NOW()
      WHERE id = ${row.id}
    `
    sent += 1
  }
  return sent
}

export default async (req: Request) => {
  if (!emailEnabled()) {
    console.log('nurture: email not configured, skipping.')
    return new Response('email disabled', { status: 200 })
  }

  const db = getDatabase()

  // Batches are capped so a single run stays well within function limits; the
  // daily cadence drains any backlog over subsequent runs. Anyone who has
  // already bought a report is excluded from the nudge — pushing a paying
  // customer to buy the thing they own is the fastest way to lose them.
  const catchUp = (await db.sql`
    SELECT id, email, business_name, industry, city, usp, report_headline, estimated_monthly_loss
    FROM leads l
    WHERE l.nurture_step = 0
      AND NOT EXISTS (
        SELECT 1 FROM premium_report_orders o WHERE o.email = l.email
      )
    ORDER BY l.created_at ASC LIMIT 200
  `) as Row[]

  const dueDay2 = (await db.sql`
    SELECT id, email, business_name, industry, city, usp, report_headline, estimated_monthly_loss
    FROM leads
    WHERE nurture_step = 1 AND created_at <= NOW() - INTERVAL '2 days'
    ORDER BY created_at ASC LIMIT 200
  `) as Row[]

  const dueDay5 = (await db.sql`
    SELECT id, email, business_name, industry, city, usp, report_headline, estimated_monthly_loss
    FROM leads
    WHERE nurture_step = 2 AND created_at <= NOW() - INTERVAL '5 days'
    ORDER BY created_at ASC LIMIT 200
  `) as Row[]

  const nudgeSent = await advance(db, catchUp, reportBriefEmail, 1)
  const day2Sent = await advance(db, dueDay2, nurtureDay2Email, 2)
  const day5Sent = await advance(db, dueDay5, nurtureDay5Email, 3)

  const summary = { nudgeSent, day2Sent, day5Sent }
  console.log('nurture run complete:', summary)
  return Response.json(summary)
}

export const config: Config = {
  schedule: '@daily',
}
