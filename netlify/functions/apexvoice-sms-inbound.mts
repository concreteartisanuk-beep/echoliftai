import type { Config } from '@netlify/functions'
import { db, phoneFingerprint, recordOutcome, text, verifyTwilioSignature, type ProspectRow } from './lib/apexvoice.mts'
import { apexvoicePitchEmail, sendEmail } from './lib/email.mts'

/**
 * Twilio calls this URL whenever a real prospect texts back. Point the
 * Twilio number's "A MESSAGE COMES IN" webhook at:
 *   https://www.echoliftai.co.uk/api/apexvoice/sms/inbound
 * (method POST, format application/x-www-form-urlencoded — Twilio's default).
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
      console.error(`apexvoice sms-inbound: no prospect matches ${from}`)
      return new Response(EMPTY_TWIML, { headers: XML_HEADERS })
    }

    await db().sql`
      INSERT INTO apexvoice_messages (prospect_id, sender, body)
      VALUES (${prospect.id}, 'customer', ${body})
    `

    const isOptOut = /^(stop|unsubscribe|remove|cancel|no|quiet)/i.test(body.trim())

    if (isOptOut) {
      await recordOutcome(
        prospect,
        'SMS',
        'Opted out',
        'Rejected',
        `Opted out via SMS: "${body.slice(0, 50)}"`,
        0,
      )
      return new Response(EMPTY_TWIML, { headers: XML_HEADERS })
    }

    // Process positive/inbound reply
    let emailStatus = 'No email on file'
    if (prospect.email && prospect.email.includes('@')) {
      const emailPayload = apexvoicePitchEmail({
        contactPerson: prospect.contact_person,
        businessName: prospect.business_name,
      })

      const sent = await sendEmail({
        to: prospect.email,
        subject: emailPayload.subject,
        html: emailPayload.html,
      })

      if (sent) {
        emailStatus = `Auto-email pitch sent to ${prospect.email}`
        await db().sql`
          INSERT INTO apexvoice_messages (prospect_id, sender, body)
          VALUES (${prospect.id}, 'agent', ${`[System Auto-Email] Delivered pitch & audit details to ${prospect.email}`})
        `
      } else {
        emailStatus = `Auto-email queued for ${prospect.email}`
        await db().sql`
          INSERT INTO apexvoice_messages (prospect_id, sender, body)
          VALUES (${prospect.id}, 'agent', ${`[System Notice] Drafted email pitch for ${prospect.email} (Email service pending API key)`})
        `
      }
    } else {
      await db().sql`
        INSERT INTO apexvoice_messages (prospect_id, sender, body)
        VALUES (${prospect.id}, 'agent', ${`[System Notice] Lead replied via SMS. Request their email to deliver full pitch.`})
      `
    }

    await recordOutcome(
      prospect,
      'SMS',
      'Reply received & pitch auto-sent',
      'Pitch Delivered',
      `Replied via SMS (${emailStatus})`,
      Math.min(100, prospect.warmth_score + 25),
    )

    return new Response(EMPTY_TWIML, { headers: XML_HEADERS })
  } catch (error) {
    console.error('apexvoice sms-inbound error:', error)
    return new Response(EMPTY_TWIML, { headers: XML_HEADERS })
  }
}

export const config: Config = {
  path: '/api/apexvoice/sms/inbound',
  method: ['POST'],
}
