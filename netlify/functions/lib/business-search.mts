import { text } from './apexvoice.mts'

/**
 * Real UK business lookup for the ApexVoice lead finder.
 *
 * This replaces a model-generated prospect list. The old version asked Claude
 * for "realistic sample profiles" and stored them with source = 'ai-sample';
 * they looked like leads and were labelled honestly, but nobody can call them,
 * which makes the lead finder a demo rather than a tool.
 *
 * The data comes from OpenStreetMap, via two public endpoints:
 *   Nominatim — turns "Manchester, UK" into a bounding box.
 *   Overpass  — returns the businesses tagged inside that box.
 *
 * OpenStreetMap was chosen over Google Places / Companies House / a paid
 * aggregator because it needs no API key or billing account, and this project
 * has neither configured. The trade-off is real and worth stating plainly:
 * OSM's coverage of small trades is patchy (roughly a fifth of the businesses
 * it lists carry a phone number), so a search returns fewer prospects than a
 * paid provider would. They are, however, actual businesses with actual phone
 * numbers. Swapping in a paid provider later means reimplementing
 * `findBusinesses` and nothing else.
 *
 * Attribution: OSM data is ODbL-licensed and requires credit, which the portal
 * shows next to the search form.
 */

/** Identifies this app to Nominatim/Overpass, whose usage policies require it. */
const USER_AGENT = 'ApexVoice-LeadFinder/1.0 (+https://echoliftai.netlify.app)'

/**
 * Overpass mirrors, tried in order. The main instance answers "the server is
 * probably too busy" under load often enough that a single-endpoint
 * implementation would fail intermittently for no reason the operator can act
 * on.
 */
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
]

/**
 * Synchronous functions are capped at 10s of wall clock, and a slow Overpass
 * query can outlast that on its own. Every outbound call is bounded by this
 * shared deadline so the caller returns a usable error instead of being killed
 * mid-request, which surfaces to the browser as a network failure. The budget
 * stops short of 10s to leave room for writing the results to the database.
 */
const TOTAL_BUDGET_MS = 6500
const GEOCODE_TIMEOUT_MS = 3000
const OVERPASS_TIMEOUT_MS = 5500
const PLACE_SEARCH_TIMEOUT_MS = 2500

export interface BusinessRecord {
  osmId: string
  name: string
  phone: string
  email: string
  website: string
  address: string
  postcode: string
  category: string
  openingHours: string
}

class Deadline {
  private readonly expiresAt: number

  constructor(budgetMs: number, now: number) {
    this.expiresAt = now + budgetMs
  }

  /** Milliseconds left, capped to `limit`; 0 once the budget is spent. */
  remaining(limit: number): number {
    return Math.max(0, Math.min(limit, this.expiresAt - Date.now()))
  }
}

/** fetch with a hard upper bound, so one slow endpoint cannot eat the budget. */
const fetchWithTimeout = async (
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response | null> => {
  if (timeoutMs <= 0) return null

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } catch {
    // Timeout, abort, DNS failure — all mean "no data from here", and every
    // caller already has a fallback path.
    return null
  } finally {
    clearTimeout(timer)
  }
}

/* --------------------------------------------------------------- geocoding */

export interface BoundingBox {
  south: number
  west: number
  north: number
  east: number
}

/** A resolved location: its search area plus the name to show the operator. */
interface ResolvedLocation extends BoundingBox {
  displayName: string
}

/**
 * Overpass cost scales with the area searched, so an unbounded region ("England",
 * or a typo that geocodes to the whole country) would reliably time out. Clamp
 * to roughly 45km across, keeping the centre — a smaller box that returns
 * results beats a correct box that returns nothing.
 */
const MAX_SPAN_DEG = 0.6

const clampBox = (south: number, west: number, north: number, east: number): BoundingBox => {
  const midLat = (south + north) / 2
  const midLon = (west + east) / 2
  const latSpan = Math.min(north - south, MAX_SPAN_DEG)
  const lonSpan = Math.min(east - west, MAX_SPAN_DEG)

  return {
    south: midLat - latSpan / 2,
    west: midLon - lonSpan / 2,
    north: midLat + latSpan / 2,
    east: midLon + lonSpan / 2,
  }
}

interface NominatimResult {
  boundingbox?: unknown
  lat?: unknown
  lon?: unknown
  display_name?: unknown
}

/** A business-level Nominatim result, as returned by the place search. */
interface NominatimPlace {
  osm_type?: unknown
  osm_id?: unknown
  name?: unknown
  type?: unknown
  extratags?: unknown
  address?: unknown
}

/**
 * Resolve a free-text location to a bounding box.
 *
 * Tried UK-first because the portal asks for a UK city or region, then without
 * the country filter so a valid non-UK search still works rather than silently
 * returning nothing.
 */
const geocode = async (location: string, deadline: Deadline): Promise<ResolvedLocation | null> => {
  for (const restrictToUk of [true, false]) {
    const url = new URL('https://nominatim.openstreetmap.org/search')
    url.searchParams.set('q', location)
    url.searchParams.set('format', 'json')
    url.searchParams.set('limit', '1')
    if (restrictToUk) url.searchParams.set('countrycodes', 'gb')

    const res = await fetchWithTimeout(
      url.toString(),
      { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } },
      deadline.remaining(GEOCODE_TIMEOUT_MS),
    )
    if (!res?.ok) continue

    const results = (await res.json().catch(() => null)) as NominatimResult[] | null
    const hit = Array.isArray(results) ? results[0] : null
    if (!hit) continue

    const displayName = typeof hit.display_name === 'string' ? hit.display_name : location

    // Nominatim returns [south, north, west, east] as strings.
    if (Array.isArray(hit.boundingbox) && hit.boundingbox.length === 4) {
      const [south, north, west, east] = hit.boundingbox.map((v) => Number.parseFloat(String(v)))
      if ([south, north, west, east].every(Number.isFinite)) {
        return { ...clampBox(south, west, north, east), displayName }
      }
    }

    // A point result (a single address) has no box; build a small one around it.
    const lat = Number.parseFloat(String(hit.lat ?? ''))
    const lon = Number.parseFloat(String(hit.lon ?? ''))
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      return {
        ...clampBox(lat - 0.05, lon - 0.05, lat + 0.05, lon + 0.05),
        displayName,
      }
    }
  }

  return null
}

/* ----------------------------------------------------- industry → OSM tags */

/**
 * Free-text industry to the OSM tags that actually hold those businesses.
 *
 * A lookup table rather than an AI-generated query: the tag vocabulary is fixed
 * and small, so a model adds latency and a failure mode to a problem that a map
 * solves exactly. Keys are matched as substrings of the lowercased input, so
 * "emergency plumbing" and "plumber" both hit the plumbing entry.
 *
 * Ordered longest-key-first at match time, so "car wash" is not captured by
 * "car". Unmatched industries fall back to a name search.
 */
const INDUSTRY_TAGS: Record<string, string[]> = {
  // Trades — the portal's core target market.
  plumb: ['craft=plumber', 'shop=plumber', 'craft=hvac'],
  heating: ['craft=hvac', 'craft=plumber'],
  hvac: ['craft=hvac', 'craft=plumber'],
  'air conditioning': ['craft=hvac'],
  electric: ['craft=electrician'],
  roof: ['craft=roofer'],
  build: ['craft=builder', 'shop=trade'],
  carpent: ['craft=carpenter'],
  joiner: ['craft=carpenter'],
  plaster: ['craft=plasterer'],
  paint: ['craft=painter'],
  decorat: ['craft=painter', 'shop=interior_decoration'],
  scaffold: ['craft=scaffolder'],
  glaz: ['craft=glaziery'],
  window: ['craft=window_construction', 'craft=glaziery'],
  lock: ['craft=locksmith', 'shop=locksmith'],
  garden: ['craft=gardener', 'shop=garden_centre'],
  landscap: ['craft=gardener'],
  'tree surg': ['craft=gardener'],
  clean: ['craft=cleaning', 'shop=dry_cleaning', 'shop=laundry'],
  laundry: ['shop=laundry', 'shop=dry_cleaning'],
  floor: ['shop=flooring', 'craft=floorer'],
  kitchen: ['shop=kitchen'],
  bathroom: ['shop=bathroom_furnishing'],
  weld: ['craft=metal_construction', 'craft=blacksmith'],
  upholster: ['craft=upholsterer'],
  removal: ['office=moving_company', 'shop=storage_rental'],
  storage: ['shop=storage_rental'],
  pest: ['craft=pest_control'],

  // Motor trade.
  garage: ['shop=car_repair'],
  mechanic: ['shop=car_repair'],
  'car repair': ['shop=car_repair'],
  'car deal': ['shop=car'],
  tyre: ['shop=tyres'],
  'car wash': ['shop=car_wash'],
  motorcycle: ['shop=motorcycle', 'shop=motorcycle_repair'],
  'driving school': ['amenity=driving_school'],

  // Health & wellbeing.
  dentist: ['amenity=dentist', 'healthcare=dentist'],
  dental: ['amenity=dentist', 'healthcare=dentist'],
  doctor: ['amenity=doctors', 'healthcare=doctor'],
  physio: ['healthcare=physiotherapist'],
  chiroprac: ['healthcare=chiropractor'],
  osteopath: ['healthcare=alternative'],
  optic: ['shop=optician'],
  pharmac: ['amenity=pharmacy'],
  vet: ['amenity=veterinary'],
  clinic: ['amenity=clinic', 'healthcare=clinic'],
  'care home': ['amenity=social_facility'],

  // Beauty & fitness.
  hair: ['shop=hairdresser'],
  barber: ['shop=hairdresser'],
  salon: ['shop=hairdresser', 'shop=beauty'],
  beauty: ['shop=beauty'],
  nail: ['shop=beauty', 'shop=nail_salon'],
  spa: ['leisure=spa', 'shop=beauty'],
  massage: ['shop=massage'],
  tattoo: ['shop=tattoo'],
  gym: ['leisure=fitness_centre'],
  fitness: ['leisure=fitness_centre'],

  // Professional services.
  solicitor: ['office=lawyer'],
  lawyer: ['office=lawyer'],
  legal: ['office=lawyer'],
  account: ['office=accountant'],
  'estate agent': ['office=estate_agent'],
  letting: ['office=estate_agent'],
  insur: ['office=insurance'],
  mortgage: ['office=financial_advisor', 'office=insurance'],
  financial: ['office=financial_advisor'],
  architect: ['office=architect'],
  survey: ['office=surveyor'],
  recruit: ['office=employment_agency'],
  market: ['office=advertising_agency'],
  advertis: ['office=advertising_agency'],
  'it support': ['office=it', 'shop=computer'],
  computer: ['shop=computer', 'office=it'],
  print: ['shop=copyshop', 'craft=printer'],
  photograph: ['craft=photographer', 'shop=photo'],
  travel: ['shop=travel_agency'],
  funeral: ['shop=funeral_directors'],

  // Food, drink & hospitality.
  restaurant: ['amenity=restaurant'],
  cafe: ['amenity=cafe'],
  coffee: ['amenity=cafe', 'shop=coffee'],
  takeaway: ['amenity=fast_food'],
  'fast food': ['amenity=fast_food'],
  pub: ['amenity=pub'],
  bar: ['amenity=bar', 'amenity=pub'],
  cater: ['craft=caterer'],
  bakery: ['shop=bakery', 'craft=bakery'],
  butcher: ['shop=butcher'],
  hotel: ['tourism=hotel', 'tourism=guest_house'],
  'bed and breakfast': ['tourism=guest_house', 'tourism=bed_and_breakfast'],

  // Retail & other.
  florist: ['shop=florist'],
  jewel: ['shop=jewelry'],
  furniture: ['shop=furniture'],
  pet: ['shop=pet', 'shop=pet_grooming'],
  groom: ['shop=pet_grooming'],
  kennel: ['amenity=animal_boarding'],
  nursery: ['amenity=childcare', 'amenity=kindergarten'],
  childcare: ['amenity=childcare'],
  'estate manage': ['office=property_management'],
}

/**
 * Map an industry to Overpass tag filters, or null when nothing matches.
 * Longest keys first so more specific phrases win ("car wash" over "car").
 */
const tagsForIndustry = (industry: string): string[] | null => {
  const needle = industry.toLowerCase()
  const keys = Object.keys(INDUSTRY_TAGS).sort((a, b) => b.length - a.length)
  for (const key of keys) {
    if (needle.includes(key)) return INDUSTRY_TAGS[key]
  }
  return null
}

/* -------------------------------------------------------- Overpass querying */

const bboxClause = (box: BoundingBox): string =>
  `(${box.south.toFixed(5)},${box.west.toFixed(5)},${box.north.toFixed(5)},${box.east.toFixed(5)})`

/**
 * Ask for well above the number of prospects we want to keep: only a minority
 * of OSM entries carry contact details, and the ones that do are the only ones
 * worth showing an operator.
 */
const OVERPASS_LIMIT = 250

const tagQuery = (tags: string[], box: BoundingBox): string => {
  const bbox = bboxClause(box)
  const clauses = tags
    .map((tag) => {
      const [key, value] = tag.split('=')
      return `  nwr["${key}"="${value}"]${bbox};`
    })
    .join('\n')

  return `[out:json][timeout:20];\n(\n${clauses}\n);\nout tags center ${OVERPASS_LIMIT};`
}

/**
 * The second source: Nominatim's own place search, restricted to the bounding
 * box.
 *
 * It carries the search for industries the tag table does not cover, and tops
 * up the ones it does. The obvious alternative was an Overpass regex over
 * business names, which was measured at ~12s for a single city — longer than
 * the whole function is allowed to run. Nominatim answers the same question
 * from an index in well under a second. It only knows category words it has
 * indexed ("dentist" works, "skip hire" does not), so it widens coverage
 * without guaranteeing it; when it finds nothing, the caller reports an honest
 * empty result.
 */
const searchPlaces = async (
  industry: string,
  box: BoundingBox,
  deadline: Deadline,
): Promise<NominatimPlace[] | null> => {
  const url = new URL('https://nominatim.openstreetmap.org/search')
  url.searchParams.set('q', industry)
  url.searchParams.set('format', 'json')
  url.searchParams.set('limit', '40')
  url.searchParams.set('extratags', '1')
  url.searchParams.set('addressdetails', '1')
  url.searchParams.set('bounded', '1')
  // Nominatim wants viewbox as west,north,east,south.
  url.searchParams.set(
    'viewbox',
    `${box.west.toFixed(5)},${box.north.toFixed(5)},${box.east.toFixed(5)},${box.south.toFixed(5)}`,
  )

  const res = await fetchWithTimeout(
    url.toString(),
    { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } },
    deadline.remaining(PLACE_SEARCH_TIMEOUT_MS),
  )
  if (!res?.ok) return null

  const results = (await res.json().catch(() => null)) as NominatimPlace[] | null
  return Array.isArray(results) ? results : null
}

interface OverpassElement {
  type?: unknown
  id?: unknown
  tags?: Record<string, string>
}

/**
 * How long to wait for the primary mirror before also trying the backup.
 *
 * A healthy Overpass answers a city-sized query in roughly 1.5s, so this only
 * fires when the primary is misbehaving.
 */
const OVERPASS_HEDGE_MS = 1800

/** Ask one mirror. Returns null for any failure so the caller can try another. */
const askOverpass = async (
  endpoint: string,
  query: string,
  timeoutMs: number,
): Promise<OverpassElement[] | null> => {
  if (timeoutMs <= 0) return null

  const res = await fetchWithTimeout(
    endpoint,
    {
      method: 'POST',
      headers: {
        'User-Agent': USER_AGENT,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ data: query }).toString(),
    },
    timeoutMs,
  )
  if (!res?.ok) return null

  // A busy Overpass instance answers 200 with an HTML error page, so the status
  // code alone is not enough to tell success from failure.
  const raw = await res.text().catch(() => '')
  if (!raw.trimStart().startsWith('{')) return null

  try {
    const parsed = JSON.parse(raw) as { elements?: unknown }
    return Array.isArray(parsed.elements) ? (parsed.elements as OverpassElement[]) : null
  } catch {
    return null
  }
}

/** Resolve with the first non-null result, or null once every promise settles. */
function firstResult(
  attempts: Array<Promise<OverpassElement[] | null>>,
): Promise<OverpassElement[] | null> {
  return new Promise((resolve) => {
    let pending = attempts.length
    if (pending === 0) {
      resolve(null)
      return
    }
    const settle = (value: OverpassElement[] | null) => {
      if (value !== null) resolve(value)
      else if (--pending === 0) resolve(null)
    }
    for (const attempt of attempts) attempt.then(settle, () => settle(null))
  })
}

/**
 * Run a query against the Overpass mirrors, hedged rather than sequential.
 *
 * Overpass publishes a two-concurrent-request-per-IP limit and answers 429 past
 * it, which rules out fanning out to every mirror at once. But a sequential loop
 * handles a *stalled* mirror badly: the first one to hang spends the whole
 * budget and the backup is never asked. Hedging splits the difference — the
 * primary gets a head start, and only if it has not answered by then is one
 * backup raced against it. The common case stays at a single request; a stalled
 * mirror costs some latency instead of the entire result.
 */
const runOverpass = async (
  query: string,
  deadline: Deadline,
): Promise<OverpassElement[] | null> => {
  const [primary, ...backups] = OVERPASS_ENDPOINTS

  const budget = deadline.remaining(OVERPASS_TIMEOUT_MS)
  if (budget <= 0) return null

  const primaryAttempt = askOverpass(primary, query, budget)
  if (backups.length === 0) return primaryAttempt

  // A marker distinct from both a result and a failure, so "the head start
  // elapsed" is not confused with "the primary came back empty".
  const stillWaiting = Symbol('waiting')
  const headStart = new Promise<typeof stillWaiting>((resolve) => {
    setTimeout(() => resolve(stillWaiting), Math.min(OVERPASS_HEDGE_MS, budget))
  })

  const early = await Promise.race([primaryAttempt, headStart])
  if (early !== stillWaiting) {
    if (early !== null) return early
    // The primary failed fast; the backup gets what is left of the budget.
    return askOverpass(backups[0], query, deadline.remaining(OVERPASS_TIMEOUT_MS))
  }

  // The primary is stalling, so race one backup against it. Exactly one backup:
  // Overpass allows two concurrent requests per IP and answers 429 beyond that,
  // so a wider fan-out would manufacture the very failure it is meant to survive.
  return firstResult([
    primaryAttempt,
    askOverpass(backups[0], query, deadline.remaining(OVERPASS_TIMEOUT_MS)),
  ])
}

/* -------------------------------------------------------------- normalising */

/**
 * Build the upstream record id ("node/12345") used for dedupe and for the
 * unique index in migration 0005.
 *
 * Returns an empty string when either half is missing or malformed. That is
 * deliberate: the index is partial on `osm_id <> ''`, so an unidentifiable
 * record opts out of it rather than colliding with every other unidentifiable
 * record under a shared placeholder like "node/".
 */
const buildOsmId = (type: unknown, id: unknown): string => {
  const kind = String(type ?? '')
  const ref = String(id ?? '')
  if (!/^(node|way|relation)$/.test(kind) || !/^\d+$/.test(ref)) return ''
  return `${kind}/${ref}`
}

/** First non-empty value among several possible OSM tag spellings. */
const firstTag = (tags: Record<string, string>, keys: string[], max: number): string => {
  for (const key of keys) {
    const value = text(tags[key], max)
    if (value) return value
  }
  return ''
}

/** Strip the protocol so the stored value matches what the portal renders. */
const normaliseWebsite = (value: string): string =>
  value.replace(/^https?:\/\//i, '').replace(/\/+$/, '').slice(0, 200)

const normaliseEmail = (value: string): string => value.replace(/^mailto:/i, '').slice(0, 200)

const toRecord = (element: OverpassElement): BusinessRecord | null => {
  const tags = element.tags
  if (!tags) return null

  const name = text(tags.name, 200)
  if (!name) return null

  const houseNumber = text(tags['addr:housenumber'], 20)
  const street = text(tags['addr:street'], 120)
  const city = text(tags['addr:city'], 80)
  const address = [[houseNumber, street].filter(Boolean).join(' '), city]
    .filter(Boolean)
    .join(', ')

  const category =
    firstTag(tags, ['craft', 'shop', 'office', 'healthcare', 'amenity', 'leisure', 'tourism'], 60)
      .replace(/_/g, ' ')

  return {
    osmId: buildOsmId(element.type, element.id),
    name,
    phone: firstTag(tags, ['phone', 'contact:phone', 'contact:mobile', 'phone:mobile'], 40),
    email: normaliseEmail(firstTag(tags, ['email', 'contact:email'], 200)),
    website: normaliseWebsite(firstTag(tags, ['website', 'contact:website', 'url'], 240)),
    address,
    postcode: text(tags['addr:postcode'], 20),
    category,
    openingHours: text(tags.opening_hours, 200),
  }
}

/**
 * The same normalisation for a Nominatim place.
 *
 * Nominatim splits what Overpass keeps together: contact details arrive under
 * `extratags`, the address is pre-parsed into components, and the category is
 * the class/type pair. The output is a BusinessRecord either way, so nothing
 * downstream needs to know which source a prospect came from.
 */
const placeToRecord = (place: NominatimPlace): BusinessRecord | null => {
  const name = text(place.name, 200)
  if (!name) return null

  const extra = (place.extratags ?? {}) as Record<string, string>
  const addr = (place.address ?? {}) as Record<string, string>

  const houseNumber = text(addr.house_number, 20)
  const street = text(addr.road, 120)
  // Nominatim uses whichever of these fits the settlement's size.
  const city = text(addr.city || addr.town || addr.village || addr.suburb, 80)
  const address = [[houseNumber, street].filter(Boolean).join(' '), city]
    .filter(Boolean)
    .join(', ')

  return {
    osmId: buildOsmId(place.osm_type, place.osm_id),
    name,
    phone: firstTag(extra, ['phone', 'contact:phone', 'contact:mobile', 'phone:mobile'], 40),
    email: normaliseEmail(firstTag(extra, ['email', 'contact:email'], 200)),
    website: normaliseWebsite(firstTag(extra, ['website', 'contact:website', 'url'], 240)),
    address,
    postcode: text(addr.postcode, 20),
    category: text(place.type, 60).replace(/_/g, ' '),
    openingHours: text(extra.opening_hours, 200),
  }
}

/**
 * Rank by how contactable the business is. A record with a phone number is a
 * lead; one with neither phone nor website is a map pin, and is dropped.
 */
const score = (record: BusinessRecord): number => {
  let value = 0
  if (record.phone) value += 100
  if (record.website) value += 20
  if (record.email) value += 10
  if (record.address) value += 5
  return value
}

/* ------------------------------------------------------------------- public */

export interface SearchOutcome {
  businesses: BusinessRecord[]
  locationName: string
  /** Set when the search could not run at all, for an actionable message. */
  failure?: 'geocode' | 'upstream'
}

/**
 * Find real businesses of `industry` near `location`.
 *
 * Returns at most `limit` records, most contactable first, each with a phone
 * number or a website. An empty list with no failure means the search worked
 * and OSM genuinely has no contactable match — a real answer, and different
 * from the upstream being down.
 */
export const findBusinesses = async (
  industry: string,
  location: string,
  limit: number,
): Promise<SearchOutcome> => {
  const deadline = new Deadline(TOTAL_BUDGET_MS, Date.now())

  const box = await geocode(location, deadline)
  if (!box) return { businesses: [], locationName: location, failure: 'geocode' }

  const locationName = box.displayName || location
  const seen = new Set<string>()
  const records: BusinessRecord[] = []
  let reachedUpstream = false

  /** Keep a record unless it is uncontactable or already collected. */
  const collect = (record: BusinessRecord | null): void => {
    if (!record) return
    // Neither a phone nor a website means there is no way to open a
    // conversation, which makes it a map pin rather than a lead.
    if (!record.phone && !record.website) return

    // The two sources overlap, and OSM often holds one business as both a node
    // and the building way around it, so dedupe on the upstream id and on
    // name + postcode. An unidentifiable record has no id key, so it is matched
    // on name alone rather than colliding with every other id-less record.
    const idKey = record.osmId ? `id:${record.osmId}` : ''
    const nameKey = `name:${record.name.toLowerCase()}|${record.postcode.toLowerCase()}`
    if ((idKey && seen.has(idKey)) || seen.has(nameKey)) return
    if (idKey) seen.add(idKey)
    seen.add(nameKey)

    records.push(record)
  }

  // Both sources are queried at once. Running them in sequence meant a slow
  // Overpass query either starved the fallback or delayed it by its full
  // timeout; in parallel, each gets its own cap and the whole search costs the
  // slower of the two rather than their sum.
  const tags = tagsForIndustry(industry)
  const [elements, places] = await Promise.all([
    tags ? runOverpass(tagQuery(tags, box), deadline) : Promise.resolve(null),
    searchPlaces(industry, box, deadline),
  ])

  // Overpass first: its records come from an exact tag match and carry contact
  // details more often, so they should win the dedupe against a text-index hit
  // for the same business.
  if (elements !== null) {
    reachedUpstream = true
    for (const element of elements) collect(toRecord(element))
  }
  if (places !== null) {
    reachedUpstream = true
    for (const place of places) collect(placeToRecord(place))
  }

  // Only a genuine "we could not ask" is a failure. Reaching a source and
  // finding nothing is a real, reportable answer.
  //
  // The tag query is authoritative for a mapped industry, so if it could not be
  // reached and nothing else turned up, this has to report the directory as
  // unavailable. Reporting an empty result instead would tell the operator that
  // a city has no plumbers when all that happened was an Overpass timeout —
  // and that is a conclusion they might act on.
  const tagQueryFailed = tags !== null && elements === null
  if (records.length === 0 && (!reachedUpstream || tagQueryFailed)) {
    return { businesses: [], locationName, failure: 'upstream' }
  }

  records.sort((a, b) => score(b) - score(a))

  return { businesses: records.slice(0, limit), locationName }
}
