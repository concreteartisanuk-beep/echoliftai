import type { Config } from '@netlify/functions'
import { db, jsonError } from './lib/apexvoice.mts'

interface ActivityRow {
  id: number
  prospect_id: number | null
  type: string
  business_name: string
  contact_person: string
  outcome: string
  created_at: string | Date | null
}

/** Recent call and SMS outcomes for the dashboard activity feed. */
export default async () => {
  try {
    const rows = (await db().sql`
      SELECT id, prospect_id, type, business_name, contact_person, outcome, created_at
      FROM apexvoice_activity
      ORDER BY created_at DESC, id DESC
      LIMIT 50
    `) as ActivityRow[]

    return Response.json(
      rows.map((row) => ({
        id: String(row.id),
        leadId: row.prospect_id === null ? null : String(row.prospect_id),
        type: row.type,
        businessName: row.business_name,
        contactPerson: row.contact_person,
        status: row.outcome,
        timestamp: row.created_at,
      })),
    )
  } catch (error) {
    console.error('apexvoice activity error:', error)
    return jsonError('Could not load the activity feed.', 502)
  }
}

export const config: Config = {
  path: '/api/apexvoice/activity',
  method: 'GET',
}
