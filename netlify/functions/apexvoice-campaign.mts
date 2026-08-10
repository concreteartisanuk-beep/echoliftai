import type { Config } from '@netlify/functions'
import { db, jsonError, readCampaign, text, toCampaign } from './lib/apexvoice.mts'

/**
 * Read and update the single shared campaign configuration row.
 *
 * GET never returns the ElevenLabs key — only whether one is configured. POST
 * treats every field as optional and merges into the existing row, so the
 * "Reset Defaults" button (which posts the pitch fields but no voice settings)
 * cannot silently wipe a saved key. Clearing the key is an explicit opt-in via
 * `clearElevenLabsKey`.
 */
export default async (req: Request) => {
  try {
    const current = await readCampaign()
    if (!current) return jsonError('Campaign configuration is missing.', 500)

    if (req.method === 'GET') {
      return Response.json(toCampaign(current))
    }

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return jsonError('Expected a JSON body.', 400)

    const objections = (body.objectionHandling ?? {}) as Record<string, unknown>

    // `keep` leaves a column alone when the client omitted the field entirely.
    const keep = (incoming: unknown, existing: string, max = 2000): string =>
      typeof incoming === 'string' ? text(incoming, max) : existing

    const newKey = typeof body.elevenLabsKey === 'string' ? body.elevenLabsKey.trim() : ''
    const elevenLabsKey = body.clearElevenLabsKey === true
      ? ''
      : newKey || current.elevenlabs_key

    await db().sql`
      UPDATE apexvoice_campaign SET
        company_name = ${keep(body.companyName, current.company_name, 200)},
        service_name = ${keep(body.serviceName, current.service_name, 200)},
        pricing = ${keep(body.pricing, current.pricing, 120)},
        agent_name = ${keep(body.agentName, current.agent_name, 80)},
        personality = ${keep(body.personality, current.personality, 300)},
        product_description = ${keep(body.productDescription, current.product_description)},
        primary_hook = ${keep(body.primaryHook, current.primary_hook)},
        objection_pricing = ${keep(objections.pricing, current.objection_pricing)},
        objection_trust = ${keep(objections.trust, current.objection_trust)},
        objection_complexity = ${keep(objections.complexity, current.objection_complexity)},
        elevenlabs_key = ${elevenLabsKey},
        elevenlabs_agent_voice = ${keep(body.elevenLabsAgentVoice, current.elevenlabs_agent_voice, 64)},
        elevenlabs_customer_voice = ${keep(body.elevenLabsCustomerVoice, current.elevenlabs_customer_voice, 64)},
        updated_at = NOW()
      WHERE id = 1
    `

    const updated = await readCampaign()
    return Response.json(updated ? toCampaign(updated) : { success: true })
  } catch (error) {
    console.error('apexvoice campaign error:', error)
    return jsonError('Could not reach the campaign database.', 502)
  }
}

export const config: Config = {
  path: '/api/apexvoice/campaign',
  method: ['GET', 'POST'],
}
