import type { Config, Context } from '@netlify/functions'
import { getDatabase } from '@netlify/database'

/**
 * Owner-only export of captured leads. Guarded by the LEADS_ADMIN_TOKEN env var:
 * the endpoint stays completely closed until that secret is set, and every
 * request must present the matching token. Returns JSON by default, or CSV
 * (?format=csv) for dropping straight into a mailer or CRM.
 *
 * Auth: send the token as `Authorization: Bearer <token>` or `?token=<token>`.
 */
const csvCell = (value: unknown): string => {
  const str = value == null ? '' : String(value)
  // Escape per RFC 4180 — quote and double any embedded quotes.
  return `"${str.replace(/"/g, '""')}"`
}

export default async (req: Request, context: Context) => {
  const expected = process.env.LEADS_ADMIN_TOKEN
  // No token configured → keep the endpoint firmly shut rather than open.
  if (!expected) {
    return Response.json({ error: 'Leads export is not configured.' }, { status: 503 })
  }

  const url = new URL(req.url)
  const header = req.headers.get('authorization') || ''
  const bearer = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : ''
  const provided = bearer || url.searchParams.get('token') || ''

  if (provided !== expected) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const limitParam = Number.parseInt(url.searchParams.get('limit') || '500', 10)
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 5000) : 500

  let rows: Array<Record<string, unknown>> = []
  try {
    const db = getDatabase()
    rows = (await db.sql`
      SELECT id, email, business_name, industry, city, usp, report_headline,
             estimated_monthly_loss, source, created_at
      FROM leads
      ORDER BY created_at DESC
      LIMIT ${limit}
    `) as Array<Record<string, unknown>>
  } catch (error) {
    console.error('leads export error:', error)
    return Response.json({ error: 'Could not load leads.' }, { status: 502 })
  }

  if (url.searchParams.get('format') === 'csv') {
    const columns = [
      'id', 'email', 'business_name', 'industry', 'city', 'usp',
      'report_headline', 'estimated_monthly_loss', 'source', 'created_at',
    ]
    const lines = [columns.join(',')]
    for (const row of rows) {
      lines.push(columns.map((col) => csvCell(row[col])).join(','))
    }
    return new Response(lines.join('\r\n'), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="echolift-leads.csv"',
      },
    })
  }

  return Response.json({ count: rows.length, leads: rows })
}

export const config: Config = {
  path: '/api/leads',
  method: 'GET',
}
