import type { Config, Context } from '@netlify/functions'
import {
  db,
  findProspect,
  generateJson,
  jsonError,
  parseId,
  readCampaign,
  text,
} from './lib/apexvoice.mts'

/**
 * The SMS thread for one prospect: read the whole conversation, or append a
 * message sent by a human taking over from the AI.
 *
 * Messages are individual rows, so a manual reply is persisted the same way an
 * AI-generated one is and survives a page reload. The previous portal appended
 * manual replies to the DOM only and fired a request with an empty body, so
 * anything typed by a human vanished on refresh.
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

const REPLY_SYSTEM = `You role-play the PROSPECT in a B2B sales SMS thread — never the salesperson.
Reply with ONLY a JSON object: {"reply": "<one short SMS, under 160 characters>"}.
Stay in character as a busy UK small-business owner. Be realistic: you may be interested,
non-committal, or brush the salesperson off. Do not use emoji or sign your name.`

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

    await db().sql`
      INSERT INTO apexvoice_messages (prospect_id, sender, body)
      VALUES (${prospectId}, 'agent', ${outgoing})
    `

    // A reply is generated in character where possible. When AI Gateway is
    // unavailable the operator's message is still saved — the thread simply
    // waits, rather than inventing a canned response as the old code did.
    if (body?.autoReply !== false) {
      const campaign = await readCampaign()
      const thread = await readThread(prospectId)
      const transcript = thread
        .map((m) => `${m.sender === 'agent' ? 'SALESPERSON' : 'PROSPECT'}: ${m.body}`)
        .join('\n')

      const generated = await generateJson<{ reply?: unknown }>(
        REPLY_SYSTEM,
        [
          `You are ${prospect.contact_person || 'the owner'} at ${prospect.business_name}`,
          prospect.industry ? `, a ${prospect.industry} business` : '',
          prospect.location ? ` in ${prospect.location}` : '',
          `.\nThe salesperson is selling: ${campaign?.service_name || 'an AI phone receptionist'}.`,
          `\n\nThread so far:\n${transcript}\n\nWrite your next reply as the prospect.`,
        ].join(''),
        300,
      )

      const reply = text(generated?.reply, 400)
      if (reply) {
        await db().sql`
          INSERT INTO apexvoice_messages (prospect_id, sender, body)
          VALUES (${prospectId}, 'customer', ${reply})
        `
      }
    }

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
