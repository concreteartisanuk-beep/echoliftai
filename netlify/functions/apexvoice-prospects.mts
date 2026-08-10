import type { Config, Context } from '@netlify/functions'
import { db, findProspect, jsonError, parseId, text, toProspect, type ProspectRow } from './lib/apexvoice.mts'

/**
 * Prospect list, manual creation, and deletion for the ApexVoice portal.
 *
 * Namespaced under /api/apexvoice/ rather than /api/leads: the marketing site
 * already owns /api/leads for growth-report signups, which are a different
 * kind of record entirely.
 */
export default async (req: Request, context: Context) => {
  const id = parseId(context.params.id)

  try {
    if (req.method === 'GET' && !context.params.id) {
      const rows = (await db().sql`
        SELECT * FROM apexvoice_prospects ORDER BY created_at DESC, id DESC
      `) as ProspectRow[]
      return Response.json(rows.map(toProspect))
    }

    if (req.method === 'POST' && !context.params.id) {
      const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
      if (!body) return jsonError('Expected a JSON body.', 400)

      const businessName = text(body.businessName, 200)
      if (!businessName) return jsonError('A business name is required.', 400)

      const [row] = (await db().sql`
        INSERT INTO apexvoice_prospects (
          business_name, contact_person, industry, location,
          phone, email, website, pain_points, source
        ) VALUES (
          ${businessName},
          ${text(body.contactPerson, 120)},
          ${text(body.industry, 120)},
          ${text(body.location, 120)},
          ${text(body.phone, 40)},
          ${text(body.email, 200)},
          ${text(body.website, 200)},
          ${text(body.painPoints, 600)},
          'manual'
        )
        RETURNING *
      `) as ProspectRow[]

      return Response.json(toProspect(row), { status: 201 })
    }

    if (req.method === 'DELETE') {
      if (id === null) return jsonError('Invalid prospect id.', 400)

      const existing = await findProspect(id)
      if (!existing) return jsonError('Prospect not found.', 404)

      // Messages cascade from the foreign key; activity rows are kept, with
      // their prospect_id set to null, so dashboard totals stay honest.
      await db().sql`DELETE FROM apexvoice_prospects WHERE id = ${id}`
      return Response.json({ success: true })
    }

    return jsonError('Method not allowed.', 405)
  } catch (error) {
    console.error('apexvoice prospects error:', error)
    return jsonError('Could not reach the prospect database.', 502)
  }
}

export const config: Config = {
  path: ['/api/apexvoice/prospects', '/api/apexvoice/prospects/:id'],
  method: ['GET', 'POST', 'DELETE'],
}
