import type { Config } from '@netlify/functions'
import { db, phoneFingerprint, recordOutcome, text, verifyTwilioSignature, type ProspectRow } from './lib/apexvoice.mts'

/**
 * Twilio calls this URL whenever a real prospect texts back. Point the
 * Twilio number's "A MESSAGE COMES IN" webhook at:
 *   https://www.echoliftai.co.uk/api/apexvoice/sms/inbound
 * (method POST, format application/x-www-form-urlencoded — Twilio's default).
 *
 * This is the only place a `sender = 'customer'` message row is ever created
 * for a real prospect thread — see apexvoice-messages.mts for why the old
 * AI-role-play version of this was removed.
 */

const XML_HEADERS = { 'Content-Type': 'text/xml' }
const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'

export default async (req: Request) => {
  // Twilio always POSTs form-encoded, never JSON.
  const raw = await req.text()
  const params = Object.fromEntries(new URLSearchParams(raw))

  const signature = req.headers.get('X-Twilio-Signature')
  const verified = await verifyTwilioSignature(req.url, params, signature)
  if (!verified) {
    console.error('apexvoice sms-inbound: signature verification failed, rejecting')
    return new Response('Forbidden', { status: 403 })
  }

  const from = text(params.From, 32)
  const body = text(params.Body, 800)
  if (!from || !body) {
    // Nothing usable — acknowledge so Twilio doesn't retry, but do nothing.
    return new Response(EMPTY_TWIML, { headers: XML_HEADERS })
  }

  const fingerprint = phoneFingerprint(from)

  try {
    // Match on the last 9 digits since stored numbers aren't guaranteed to
    // already be in strict E.164 (see toE164 in lib/apexvoice.mts).
    const rows = (await db().sql`
      SELECT * FROM apexvoice_prospects
      WHERE RIGHT(REGEXP_REPLACE(phone, '[^0-9]', '', 'g'), 9) = ${fingerprint}
      ORDER BY created_at DESC
      LIMIT 1
    `) as ProspectRow[]

    const prospect = rows[0]
    if (!prospect) {
      // A real text came in from a number we don't recognise. Log it rather
      // than silently dropping it — worth checking manually.
      console.error(`apexvoice sms-inbound: no prospect matches ${from}`)
      return new Response(EMPTY_TWIML, { headers: XML_HEADERS })
    }

    await db().sql`
      INSERT INTO apexvoice_messages (prospect_id, sender, body)
      VALUES (${prospect.id}, 'customer', ${body})
    `

    await recordOutcome(
      prospect,
      'SMS',
      'Reply received',
      prospect.status === 'Rejected' ? 'Rejected' : 'In Progress',
      `Replied ${new Date().toLocaleDateString('en-GB')}`,
      Math.min(100, prospect.warmth_score + 10),
    )

    return new Response(EMPTY_TWIML, { headers: XML_HEADERS })
  } catch (error) {
    console.error('apexvoice sms-inbound error:', error)
    // Still acknowledge with 200 so Twilio doesn't hammer retries on a bug.
    return new Response(EMPTY_TWIML, { headers: XML_HEADERS })
  }
}

export const config: Config = {
  path: '/api/apexvoice/sms/inbound',
  method: ['POST'],
}
