import type { Config } from '@netlify/functions'
import { db, phoneFingerprint, recordOutcome, sendSms, text, verifyTwilioSignature, type ProspectRow } from './lib/apexvoice.mts'
import { apexvoicePitchEmail, sendEmail } from './lib/email.mts'

/**
 * Twilio calls this URL whenever a real prospect texts back. Point the
 * Twilio number's "A MESSAGE COMES IN" webhook at:
 *   https://www.echoliftai.co.uk/api/apexvoice/sms/inbound
 * (method POST, format application/x-www-form-urlencoded — Twilio's default).
 */

const XML_HEADERS = { 'Content-Type': 'text/xml' }
const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'

function escapeXml(unsafe: string): string {
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;'
      case '>': return '&gt;'
      case '&': return '&amp;'
      case '\'': return '&apos;'
      case '"': return '&quot;'
      default: return c
    }
  })
}

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

    let prospect = rows[0]
    if (!prospect) {
      console.log(`apexvoice sms-inbound: registering fresh inbound prospect from ${from}`)
      const inserted = (await db().sql`
        INSERT INTO apexvoice_prospects (
          business_name, contact_person, industry, location, phone, warmth_score, status, source
        ) VALUES (
          'Inbound Contact', 'there', 'Trade Services', 'UK', ${from}, 80, 'Contacted', 'Inbound SMS'
        )
        RETURNING *
      `) as ProspectRow[]
      prospect = inserted[0]
    }

    if (prospect?.id) {
      await db().sql`
        INSERT INTO apexvoice_messages (prospect_id, sender, body)
        VALUES (${prospect.id}, 'customer', ${body})
      `
    }

    const isOptOut = /^(stop|unsubscribe|remove|cancel|no|quiet|leave me alone|fuck off|stop it)/i.test(body.trim())

    if (isOptOut) {
      if (prospect) {
        await recordOutcome(
          prospect,
          'SMS',
          'Opted out',
          'Rejected',
          `Opted out via SMS: "${body.slice(0, 50)}"`,
          0,
        )
      }
      return new Response(EMPTY_TWIML, { headers: XML_HEADERS })
    }

    // Classify intent and generate authentic, conversational 2-way reply from Ian
    const contact = (prospect?.contact_person || 'there').split(' ')[0]
    const cleanBody = body.toLowerCase().trim()

    let replyText = ''
    if (/(pet|portrait|dog|cat|frame|framed|drawing|photo|picture|gift|royal|spoof)/i.test(cleanBody)) {
      replyText = `Hi ${contact}, Ian here. Thanks for reaching out! For custom framed humorous pet & family portraits, you can upload your photo and order at https://youvebeenframed.netlify.app (or text your photo straight to this number for a free 60s preview!)`
    } else if (/(worktop|microcement|kitchen|island|resurfacing|bathroom|trowel|concrete|table|furniture|bowl|candle|quote|price|cost|estimate)/i.test(cleanBody)) {
      replyText = `Hi ${contact}, Ian here from Concreet. We specialise in seamless microcement worktop resurfacing and bespoke concrete furniture across the UK. Check our instant project estimator at https://concreet.co.uk/microcement-worktops or let me know what sizes you need!`
    } else {
      replyText = `Hi ${contact}, Ian here. Thanks for getting in touch! Whether you're looking for microcement worktops/furniture (https://concreet.co.uk) or custom humorous framed pet portraits (https://youvebeenframed.netlify.app), let me know how I can help you today!`
    }

    // Record agent auto-reply in DB
    if (prospect?.id) {
      await db().sql`
        INSERT INTO apexvoice_messages (prospect_id, sender, body)
        VALUES (${prospect.id}, 'agent', ${replyText})
      `

      await recordOutcome(
        prospect,
        'SMS',
        'Inbound SMS Auto-Replied',
        'Pitch Delivered',
        `Auto-replied via SMS to "${body.slice(0, 40)}"`,
        Math.min(100, (prospect.warmth_score || 50) + 25),
      )
    }

    // Process optional email pitch if prospect has email on file
    if (prospect?.email && prospect.email.includes('@')) {
      const emailPayload = apexvoicePitchEmail({
        contactPerson: prospect.contact_person,
        businessName: prospect.business_name,
      })

      sendEmail({
        to: prospect.email,
        subject: emailPayload.subject,
        html: emailPayload.html,
      }).catch((err) => console.warn('Inbound email error:', err))
    }

    // Owner requested no update SMS to their mobile. Log inquiry without dispatching Twilio SMS.
    console.log(`[inbound-sms] Handled lead reply from ${prospect?.business_name || from} (${from}): "${body.slice(0, 70)}"`)

    // Return TwiML with the automated reply so Twilio sends it directly to the prospect's mobile
    const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(replyText)}</Message></Response>`
    return new Response(twiml, { headers: XML_HEADERS })
  } catch (error) {
    console.error('apexvoice sms-inbound error:', error)
    return new Response(EMPTY_TWIML, { headers: XML_HEADERS })
  }
}

export const config: Config = {
  path: '/api/apexvoice/sms/inbound',
  method: ['POST'],
}
