import type { Config, Context } from '@netlify/functions'
import {
  db,
  findProspect,
  jsonError,
  parseId,
  recordOutcome,
  sendSms,
  text,
} from './lib/apexvoice.mts'

/**
 * The SMS thread for one prospect: read the whole conversation, or send a
 * real text via Twilio.
 *
 * This used to auto-generate the "customer's" reply with Claude role-playing
 * the prospect — useful for a demo, actively misleading for a real thread,
 * since it made the operator believe a real person had replied. A message is
 * now only ever inserted as `sender = 'customer'` by the Twilio inbound
 * webhook (apexvoice-sms-inbound.mts), when a real reply actually arrives.
 */

interface MessageRow {
  id: number
  sender: string
  body: string
  sent_at: string | Date | null
}

const toMessage = (row: MessageRow) => ({
  id: String(row.id),
  sender: row.sender === 'agent' ? 'agent' : 'customer',
  body: row.body,
  sentAt: row.sent_at,
})

const readThread = async (prospectId: number) => {
  const rows = (await db().sql`
    SELECT id, sender, body, sent_at
    FROM apexvoice_messages
    WHERE prospect_id = ${prospectId}
    ORDER BY sent_at ASC, id ASC
  `) as MessageRow[]
  return rows.map(toMessage)
}

export default async (req: Request, context: Context) => {
  const prospectId = parseId(context.params.id)
  if (prospectId === null) return jsonError('Invalid prospect id.', 400)

  try {
    const prospect = await findProspect(prospectId)
    if (!prospect) return jsonError('Prospect not found.', 404)

    if (req.method === 'GET') {
      return Response.json({ messages: await readThread(prospectId) })
    }

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    const outgoing = text(body?.body, 800)
    if (!outgoing) return jsonError('A message body is required.', 400)

    if (!prospect.phone) {
      return jsonError('This prospect has no phone number on file — nothing to send to.', 400)
    }

    // Send for real first. Only persist the row if Twilio actually accepted
    // it, so the thread never shows a message that didn't go out.
    const result = await sendSms(prospect.phone, outgoing)
    if (!result.ok) {
      return jsonError(result.error || 'Twilio did not accept the message.', 502)
    }

    await db().sql`
      INSERT INTO apexvoice_messages (prospect_id, sender, body)
      VALUES (${prospectId}, 'agent', ${outgoing})
    `

    // Real replies arrive later, asynchronously, via the Twilio inbound
    // webhook — not generated here. Just mark that contact was attempted.
    await recordOutcome(
      prospect,
      'SMS',
      'Text sent',
      prospect.status === 'New' ? 'In Progress' : prospect.status,
      `Texted ${new Date().toLocaleDateString('en-GB')}`,
      prospect.warmth_score,
    )

    return Response.json({ success: true, messages: await readThread(prospectId) })
  } catch (error) {
    console.error('apexvoice messages error:', error)
    return jsonError('Could not load or update the message thread.', 502)
  }
}

export const config: Config = {
  path: '/api/apexvoice/prospects/:id/messages',
  method: ['GET', 'POST'],
}
