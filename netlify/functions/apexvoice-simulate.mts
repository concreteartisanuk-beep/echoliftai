import type { Config } from '@netlify/functions'
import {
  db,
  findProspect,
  generateJson,
  isPersona,
  jsonError,
  parseId,
  PERSONAS,
  readCampaign,
  recordOutcome,
  scriptedDialogue,
  scriptedThread,
  text,
  type CampaignRow,
  type DialogueTurn,
  type PersonaKey,
  type ProspectRow,
} from './lib/apexvoice.mts'

/**
 * Generates the outbound call and SMS runs that the portal plays back.
 *
 * The dialogue is produced server-side and returned as a finished script, which
 * is how the portal has always worked — the browser only performs it. What
 * changed is that the outcome is now persisted: the prospect's status, warmth
 * score and last interaction are updated and an activity row is written, so the
 * dashboard counters reflect real history instead of resetting on reload.
 */

const CALL_SYSTEM = `You script realistic outbound B2B sales calls for a training simulator.
Return ONLY a JSON object, no prose or code fences:
{"turns":[{"speaker":"agent"|"customer","text":"..."}],"demoBooked":true|false}
Rules:
- 8 to 14 turns, alternating, starting with the customer answering the phone.
- Keep every line to one or two spoken sentences. No stage directions, no narration.
- The customer must raise at least one genuine objection and the agent must answer it
  using the supplied objection-handling scripts, in the agent's own words.
- "demoBooked" must honestly reflect how the call ended.`

interface GeneratedCall {
  turns?: unknown
  demoBooked?: unknown
}

/** Keep only well-formed conversational turns; the framing is added separately. */
const cleanTurns = (raw: unknown): DialogueTurn[] => {
  if (!Array.isArray(raw)) return []

  const turns: DialogueTurn[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const speaker = (item as { speaker?: unknown }).speaker
    const line = text((item as { text?: unknown }).text, 500)
    if (!line) continue
    if (speaker === 'agent' || speaker === 'customer') turns.push({ speaker, text: line })
  }
  return turns.slice(0, 20)
}

const buildCall = async (campaign: CampaignRow, prospect: ProspectRow, persona: PersonaKey) => {
  const generated = await generateJson<GeneratedCall>(
    CALL_SYSTEM,
    [
      `The agent is ${campaign.agent_name || 'Alex'} from ${campaign.company_name || 'an agency'}.`,
      `Agent style: ${campaign.personality || 'professional and warm'}.`,
      `Selling: ${campaign.service_name || 'an AI phone receptionist'} at ${campaign.pricing || 'a monthly fee'}.`,
      `What it does: ${campaign.product_description || 'answers missed calls and books jobs.'}`,
      `Opening hook to work from: ${campaign.primary_hook || 'we stop missed calls becoming lost jobs.'}`,
      '',
      'Objection-handling scripts:',
      `- Price: ${campaign.objection_pricing || 'it pays for itself with one saved booking.'}`,
      `- Trust: ${campaign.objection_trust || 'we build a free prototype first.'}`,
      `- Complexity: ${campaign.objection_complexity || 'we handle the entire setup.'}`,
      '',
      `The prospect is ${prospect.contact_person || 'the owner'} at ${prospect.business_name}`,
      `${prospect.industry ? `, a ${prospect.industry} business` : ''}${prospect.location ? ` in ${prospect.location}` : ''}.`,
      prospect.pain_points ? `Known pain point: ${prospect.pain_points}` : '',
      `Prospect persona — ${PERSONAS[persona].label}: ${PERSONAS[persona].brief}`,
      '',
      'Script the call.',
    ].join('\n'),
    2048,
  )

  const turns = cleanTurns(generated?.turns)

  // Fall back to the deterministic script whenever the model is unavailable or
  // returns something unusable, so the simulator always has something to play.
  if (turns.length < 4) return { ...scriptedDialogue(campaign, prospect, persona), generated: false }

  const isSuccessful = generated?.demoBooked === true
  const dialogue: DialogueTurn[] = [
    { speaker: 'system', text: '[Dialling — Ringing...]' },
    ...turns,
    {
      speaker: 'system',
      text: isSuccessful ? '[Call Ended — Demo booked]' : '[Call Ended — No commitment]',
    },
  ]

  return { dialogue, isSuccessful, generated: true }
}

const SMS_SYSTEM = `You script a realistic outbound B2B sales SMS thread for a training simulator.
Return ONLY a JSON object, no prose or code fences:
{"messages":[{"sender":"agent"|"customer","body":"..."}]}
Rules:
- 4 to 8 messages, alternating, starting with the agent's opener.
- Every message under 160 characters, written like a real text — no emoji, no signatures.
- The prospect should ask at least one real question before the thread ends.`

interface GeneratedThread {
  messages?: unknown
}

const cleanMessages = (raw: unknown): Array<{ sender: 'agent' | 'customer'; body: string }> => {
  if (!Array.isArray(raw)) return []

  const messages: Array<{ sender: 'agent' | 'customer'; body: string }> = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const sender = (item as { sender?: unknown }).sender
    const body = text((item as { body?: unknown }).body, 400)
    if (!body) continue
    if (sender === 'agent' || sender === 'customer') messages.push({ sender, body })
  }
  return messages.slice(0, 12)
}

const buildThread = async (campaign: CampaignRow, prospect: ProspectRow) => {
  const generated = await generateJson<GeneratedThread>(
    SMS_SYSTEM,
    [
      `The agent is ${campaign.agent_name || 'Alex'} from ${campaign.company_name || 'an agency'}.`,
      `Selling: ${campaign.service_name || 'an AI phone receptionist'} at ${campaign.pricing || 'a monthly fee'}.`,
      `Opening hook to work from: ${campaign.primary_hook || 'we stop missed calls becoming lost jobs.'}`,
      `Price rebuttal if asked: ${campaign.objection_pricing || 'one saved job covers it.'}`,
      `The prospect is ${prospect.contact_person || 'the owner'} at ${prospect.business_name}`,
      `${prospect.industry ? `, a ${prospect.industry} business` : ''}${prospect.location ? ` in ${prospect.location}` : ''}.`,
      prospect.pain_points ? `Known pain point: ${prospect.pain_points}` : '',
      '',
      'Write the thread.',
    ].join('\n'),
    1024,
  )

  const messages = cleanMessages(generated?.messages)
  if (messages.length < 2) return { ...scriptedThread(campaign, prospect), generated: false }
  return { messages, isSuccessful: true, generated: true }
}

export default async (req: Request) => {
  const url = new URL(req.url)
  const isCall = url.pathname.endsWith('/simulate-call')

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return jsonError('Expected a JSON body.', 400)

  const prospectId = parseId(typeof body.leadId === 'string' ? body.leadId : String(body.leadId ?? ''))
  if (prospectId === null) return jsonError('A valid lead id is required.', 400)

  try {
    const [prospect, campaign] = await Promise.all([findProspect(prospectId), readCampaign()])
    if (!prospect) return jsonError('Prospect not found.', 404)
    if (!campaign) return jsonError('Campaign configuration is missing.', 500)

    if (isCall) {
      const persona: PersonaKey = isPersona(body.persona) ? body.persona : 'polite'
      const { dialogue, isSuccessful, generated } = await buildCall(campaign, prospect, persona)

      await recordOutcome(
        prospect,
        'Call',
        isSuccessful ? 'Demo Booked' : 'Rejected',
        isSuccessful ? 'Qualified' : 'Rejected',
        isSuccessful ? 'AI call — demo booked' : 'AI call — prospect declined',
        prospect.warmth_score + (isSuccessful ? 15 : -20),
      )

      return Response.json({ success: true, dialogue, isSuccessful, generated })
    }

    // SMS: generate the thread, store it message by message, then log it.
    // Guard against a second run appending a fresh opener onto an existing
    // conversation — the portal only offers this for an empty thread.
    const existing = (await db().sql`
      SELECT COUNT(*)::int AS count FROM apexvoice_messages WHERE prospect_id = ${prospect.id}
    `) as Array<{ count: number }>

    if ((existing[0]?.count ?? 0) > 0) {
      return jsonError('This prospect already has a message thread.', 409)
    }

    const thread = await buildThread(campaign, prospect)

    for (const message of thread.messages) {
      await db().sql`
        INSERT INTO apexvoice_messages (prospect_id, sender, body)
        VALUES (${prospect.id}, ${message.sender}, ${message.body})
      `
    }

    await recordOutcome(
      prospect,
      'SMS',
      'Thread Started',
      'In Progress',
      'AI SMS thread — awaiting reply',
      prospect.warmth_score + 5,
    )

    return Response.json({
      success: true,
      messageCount: thread.messages.length,
      generated: thread.generated,
    })
  } catch (error) {
    console.error('apexvoice simulate error:', error)
    return jsonError('Could not run the simulation.', 502)
  }
}

export const config: Config = {
  path: ['/api/apexvoice/simulate-call', '/api/apexvoice/simulate-sms'],
  method: 'POST',
}
