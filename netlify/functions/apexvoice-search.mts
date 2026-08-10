import type { Config } from '@netlify/functions'
import { db, jsonError, text, toProspect, type ProspectRow } from './lib/apexvoice.mts'
import { findBusinesses, type BusinessRecord } from './lib/business-search.mts'

/**
 * Finds real businesses for an industry and UK location and loads them into the
 * prospect pipeline.
 *
 * This used to ask Claude for invented sample profiles. Everything it produced
 * was fictional by design — plausible names, plausible phone numbers, nobody at
 * the other end — which made the lead finder unusable for its actual purpose.
 * It now queries OpenStreetMap (see ./lib/business-search.mts) and stores only
 * what that returns.
 *
 * Nothing here is inferred or embellished. In particular:
 *   - `contact_person` is left empty. Business directories do not publish who
 *     answers the phone, and a generated "first and last name" was the single
 *     most misleading field in the old output: an operator reading a name off
 *     the screen and asking for that person would be asking for someone who
 *     does not exist. The simulator already falls back to "there" when the
 *     contact is blank, and the operator can fill it in once they know.
 *   - `pain_points` is derived from gaps in the record itself (no website, no
 *     email, hours that end before evening) rather than guessed. Those are
 *     observable facts about the business, and they are exactly the openings the
 *     pitch is built on.
 *   - `warmth_score` is an explicit heuristic over those same gaps, not a
 *     measured signal of intent. It ranks the list; it does not claim to know
 *     how anyone feels.
 */

/** Twice the six profiles the old generator returned, since these are real. */
const RESULT_LIMIT = 12

interface ProspectDraft {
  record: BusinessRecord
  painPoints: string
  warmthScore: number
}

/**
 * Describes the listed closing time when it clearly stops before the evening —
 * the window in which a missed call becomes a lost job, and the core of the
 * pitch. Returns an empty string when no such claim can be supported.
 *
 * OSM's opening_hours is a small grammar of its own and fully parsing it is not
 * worth it here: this takes the latest clock time it can see and treats
 * anything before 18:00 as an early close. Unparseable values produce no claim,
 * which is the right default — better to say nothing than to say something
 * wrong about a real business.
 */
const closesEarly = (openingHours: string): string => {
  if (!openingHours || /24\/7/.test(openingHours)) return ''

  const times = [...openingHours.matchAll(/(\d{1,2}):(\d{2})/g)]
    .map((match) => Number.parseInt(match[1], 10) * 60 + Number.parseInt(match[2], 10))
    .filter((minutes) => Number.isFinite(minutes) && minutes <= 24 * 60)

  if (times.length === 0) return ''

  const latest = Math.max(...times)
  if (latest >= 18 * 60) return ''

  const hour = Math.floor(latest / 60)
  const minute = String(latest % 60).padStart(2, '0')
  return `Listed hours close at ${hour}:${minute}, so calls after that go unanswered.`
}

/**
 * Assemble observations about what this business is missing.
 *
 * Every sentence is checkable against the stored record, so an operator can see
 * why a prospect was ranked where it was.
 */
const derivePainPoints = (record: BusinessRecord): string => {
  const observations: string[] = []

  if (!record.website) {
    observations.push(
      'No website listed, so enquiries can only arrive by phone — a missed call is lost work.',
    )
  }
  if (!record.email) {
    observations.push('No public email address, leaving the phone as the only inbound channel.')
  }

  const hours = closesEarly(record.openingHours)
  if (hours) observations.push(hours)

  if (observations.length === 0) {
    observations.push(
      `Listed as ${record.category || 'a local business'} with both phone and web contact — ask how out-of-hours calls are handled today.`,
    )
  }

  return observations.join(' ').slice(0, 600)
}

/**
 * Rank by how much room the pitch has, derived only from the record.
 *
 * Deliberately narrow (35–80): these are cold prospects nobody has spoken to
 * yet, so neither extreme would be honest. The generated version emitted
 * confident numbers like 87 for businesses it had invented outright.
 */
const deriveWarmth = (record: BusinessRecord): number => {
  let warmth = 45
  if (!record.website) warmth += 15
  if (!record.email) warmth += 8
  if (closesEarly(record.openingHours)) warmth += 12
  if (record.phone) warmth += 5
  else warmth -= 10
  return Math.max(35, Math.min(80, warmth))
}

export default async (req: Request) => {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return jsonError('Expected a JSON body.', 400)

  const industry = text(body.industry, 80)
  const location = text(body.location, 80)
  if (!industry || !location) return jsonError('Both an industry and a location are required.', 400)

  const { businesses, locationName, failure } = await findBusinesses(
    industry,
    location,
    RESULT_LIMIT,
  )

  if (failure === 'geocode') {
    return jsonError(
      `Could not find a place called "${location}". Try a town or city name, for example "Leeds" or "Bristol, UK".`,
      404,
    )
  }

  if (failure === 'upstream') {
    return jsonError(
      'The business directory is not responding right now. Wait a moment and search again, or add a prospect manually.',
      503,
    )
  }

  if (businesses.length === 0) {
    return jsonError(
      `No ${industry} businesses with contact details were found in ${locationName}. Try a broader industry term, or a nearby larger town.`,
      404,
    )
  }

  const drafts: ProspectDraft[] = businesses.map((record) => ({
    record,
    painPoints: derivePainPoints(record),
    warmthScore: deriveWarmth(record),
  }))

  const rows: ProspectRow[] = []
  let skipped = 0

  try {
    for (const { record, painPoints, warmthScore } of drafts) {
      const fullAddress = [record.address, record.postcode].filter(Boolean).join(' ')

      // ON CONFLICT rather than a pre-flight SELECT, so repeat searches stay
      // idempotent even when two run at once. The predicate matches the partial
      // unique index added in migration 0005.
      const inserted = (await db().sql`
        INSERT INTO apexvoice_prospects (
          business_name, contact_person, industry, location,
          phone, email, website, address, pain_points,
          warmth_score, source, osm_id
        ) VALUES (
          ${record.name},
          '',
          ${industry},
          ${fullAddress || locationName},
          ${record.phone},
          ${record.email},
          ${record.website},
          ${fullAddress},
          ${painPoints},
          ${warmthScore},
          'osm',
          ${record.osmId}
        )
        ON CONFLICT (osm_id) WHERE osm_id <> '' DO NOTHING
        RETURNING *
      `) as ProspectRow[]

      // No row back means this business is already in the pipeline from an
      // earlier search. That is a success, not an error.
      if (inserted.length === 0) skipped += 1
      else rows.push(inserted[0])
    }
  } catch (error) {
    console.error('apexvoice search error:', error)
    return jsonError('Could not save the businesses that were found.', 502)
  }

  return Response.json({
    success: true,
    count: rows.length,
    skipped,
    locationName,
    prospects: rows.map(toProspect),
  })
}

export const config: Config = {
  path: '/api/apexvoice/search',
  method: 'POST',
}
