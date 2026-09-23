import { getDatabase } from '@netlify/database'

/**
 * Shared helpers for the ApexVoice portal API (/api/apexvoice/*).
 *
 * The portal is a browser-only client, so everything that must not be exposed
 * — the ElevenLabs key, the AI prompts, the outcome logic — lives here.
 */

export type PersonaKey = 'polite' | 'skeptical' | 'busy' | 'hostile'

export interface DialogueTurn {
  speaker: 'system' | 'agent' | 'customer'
  text: string
}

/** How each lead persona behaves, used for prompting and for the fallback script. */
export const PERSONAS: Record<PersonaKey, { label: string; brief: string; receptive: boolean }> = {
  polite: {
    label: 'Polite & Open-Minded',
    brief: 'Friendly and curious. Asks sensible questions and is willing to hear the pitch out.',
    receptive: true,
  },
  skeptical: {
    label: 'Skeptical & Price-Conscious',
    brief: 'Doubts the value and pushes hard on price. Needs proof before agreeing to anything.',
    receptive: true,
  },
  busy: {
    label: 'Busy Contractor (Rushed)',
    brief: 'Mid-job and short on time. Clipped, impatient answers; wants the point immediately.',
    receptive: true,
  },
  hostile: {
    label: 'Hostile / Strict Gatekeeper',
    brief: 'Annoyed by cold calls and looking to end the call. Rarely agrees to anything.',
    receptive: false,
  },
}

export const isPersona = (value: unknown): value is PersonaKey =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(PERSONAS, value)

/** Trim and hard-cap free text so a huge payload can't reach the model or the DB. */
export const text = (value: unknown, max = 600): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : ''

export const jsonError = (message: string, status: number) =>
  Response.json({ error: message }, { status })

export const db = () => getDatabase()

/* ------------------------------------------------------------------ prospects */

export interface ProspectRow {
  id: number
  business_name: string
  contact_person: string
  industry: string
  location: string
  phone: string
  email: string
  website: string
  address: string
  pain_points: string
  warmth_score: number
  status: string
  last_interaction: string | null
  source: string
  osm_id: string
  created_at: string | Date | null
}

/**
 * Postgres rows use snake_case and a numeric id; the portal expects camelCase
 * and compares ids with `===`, so the id is stringified once here rather than
 * leaving every call site to remember.
 */
export const toProspect = (row: ProspectRow) => ({
  id: String(row.id),
  businessName: row.business_name,
  contactPerson: row.contact_person,
  industry: row.industry,
  location: row.location,
  phone: row.phone,
  email: row.email,
  website: row.website,
  address: row.address ?? '',
  painPoints: row.pain_points,
  warmthScore: row.warmth_score,
  status: row.status,
  lastInteraction: row.last_interaction,
  source: row.source,
  // Present for prospects that came from the business directory, so the portal
  // can link a row back to the record it was built from.
  osmId: row.osm_id ?? '',
  createdAt: row.created_at,
})

/** Route params arrive as strings; only a clean positive integer is a valid id. */
export const parseId = (raw: string | undefined): number | null => {
  if (!raw || !/^\d+$/.test(raw)) return null
  const id = Number.parseInt(raw, 10)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

export const findProspect = async (id: number) => {
  const rows = (await db().sql`
    SELECT * FROM apexvoice_prospects WHERE id = ${id}
  `) as ProspectRow[]
  return rows[0] ?? null
}

/* ------------------------------------------------------------------- campaign */

export interface CampaignRow {
  company_name: string
  service_name: string
  pricing: string
  agent_name: string
  personality: string
  product_description: string
  primary_hook: string
  objection_pricing: string
  objection_trust: string
  objection_complexity: string
  elevenlabs_key: string
  elevenlabs_agent_voice: string
  elevenlabs_customer_voice: string
}

export const readCampaign = async (): Promise<CampaignRow | null> => {
  const rows = (await db().sql`
    SELECT * FROM apexvoice_campaign WHERE id = 1
  `) as CampaignRow[]
  return rows[0] ?? null
}

/**
 * The browser-safe view of the campaign. The ElevenLabs key is replaced with a
 * boolean: the old portal sent the saved key back to every visitor, which made
 * an unauthenticated page enough to read it straight out of the form.
 */
export const toCampaign = (row: CampaignRow) => ({
  companyName: row.company_name,
  serviceName: row.service_name,
  pricing: row.pricing,
  agentName: row.agent_name,
  personality: row.personality,
  productDescription: row.product_description,
  primaryHook: row.primary_hook,
  objectionHandling: {
    pricing: row.objection_pricing,
    trust: row.objection_trust,
    complexity: row.objection_complexity,
  },
  elevenLabsAgentVoice: row.elevenlabs_agent_voice,
  elevenLabsCustomerVoice: row.elevenlabs_customer_voice,
  elevenLabsConfigured: Boolean(Netlify.env.get('ELEVENLABS_API_KEY') || row.elevenlabs_key),
  // True when the key comes from the environment, so the UI can explain that
  // the in-page field is being overridden rather than ignored.
  elevenLabsFromEnv: Boolean(Netlify.env.get('ELEVENLABS_API_KEY')),
})

/** Env var wins over the stored key so production never depends on a DB write. */
export const resolveElevenLabsKey = (row: CampaignRow | null): string =>
  Netlify.env.get('ELEVENLABS_API_KEY') || row?.elevenlabs_key || ''

/* ------------------------------------------------------------------------- AI */

const MODEL = 'claude-sonnet-5'

/**
 * Ask the model for JSON and parse it defensively. Returns null on any
 * failure — no AI Gateway credentials, a refusal, malformed output — so every
 * caller is forced to have a non-AI path instead of surfacing a 500.
 *
 * Declared as a function rather than a generic arrow: in a .mts file `<T>(…)`
 * is ambiguous with JSX and the bundler rejects it.
 */
export async function generateJson<T>(
  system: string,
  prompt: string,
  maxTokens: number,
): Promise<T | null> {
  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk')
    const anthropic = new Anthropic()

    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: prompt }],
    })

    const raw = message.content
      .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
      .map((block) => block.text)
      .join('')

    return parseJsonBlock<T>(raw)
  } catch (error) {
    console.error('apexvoice AI generation failed:', error)
    return null
  }
}

/** Models like to wrap JSON in prose or code fences; dig the payload back out. */
export function parseJsonBlock<T>(raw: string): T | null {
  const cleaned = raw.replace(/```(?:json)?/gi, '').trim()
  const candidates = [cleaned]

  const first = cleaned.search(/[[{]/)
  const last = Math.max(cleaned.lastIndexOf(']'), cleaned.lastIndexOf('}'))
  if (first !== -1 && last > first) candidates.push(cleaned.slice(first, last + 1))

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T
    } catch {
      // Try the next candidate.
    }
  }

  console.error('apexvoice: could not parse model output as JSON')
  return null
}

/* -------------------------------------------------------- scripted fallback */

/**
 * A deterministic call script assembled from the campaign settings.
 *
 * The simulator is the whole point of the portal, so it must still run when AI
 * Gateway is unavailable — which is the normal state in local dev and before a
 * site's first production deploy. This uses the operator's own hook and
 * objection rebuttals, so it demonstrates the configured pitch even without a
 * model in the loop.
 */
export const scriptedDialogue = (
  campaign: CampaignRow,
  prospect: ProspectRow,
  persona: PersonaKey,
): { dialogue: DialogueTurn[]; isSuccessful: boolean } => {
  const agent = campaign.agent_name || 'Alex'
  const company = campaign.company_name || 'our agency'
  const contact = prospect.contact_person || 'there'
  const hook = campaign.primary_hook || `We help ${prospect.industry || 'local'} businesses win back missed calls.`

  const openers: Record<PersonaKey, string> = {
    polite: `Hello, ${contact} speaking.`,
    skeptical: `${contact}. Who's calling?`,
    busy: `Yep, ${contact} — I'm on a job, make it quick.`,
    hostile: `We don't take cold calls. How did you get this number?`,
  }

  const pushbacks: Record<PersonaKey, string> = {
    polite: `That does sound useful. What does something like that cost?`,
    skeptical: `Everyone says that. Honestly, it sounds expensive for what it is.`,
    busy: `Haven't got time to set up another system, mate.`,
    hostile: `Not interested. Take us off your list.`,
  }

  const rebuttals: Record<PersonaKey, string> = {
    polite: campaign.objection_pricing || 'It pays for itself with a single saved booking.',
    skeptical: campaign.objection_trust || 'We build you a working prototype first, free.',
    busy: campaign.objection_complexity || 'We handle the whole setup — under 15 minutes of your time.',
    hostile: 'Understood — I appreciate your time, and I will take you off the list.',
  }

  const dialogue: DialogueTurn[] = [
    { speaker: 'system', text: '[Dialling — Ringing...]' },
    { speaker: 'customer', text: openers[persona] },
    { speaker: 'agent', text: `Hi ${contact}, it's ${agent} from ${company}. ${hook}` },
    { speaker: 'customer', text: pushbacks[persona] },
    { speaker: 'agent', text: rebuttals[persona] },
  ]

  if (PERSONAS[persona].receptive) {
    dialogue.push(
      { speaker: 'customer', text: 'Alright. Send me the details and we can talk properly.' },
      {
        speaker: 'agent',
        text: `Brilliant — I'll text the details across now and book you a short demo. Thanks ${contact}.`,
      },
      { speaker: 'system', text: '[Call Ended — Demo booked]' },
    )
    return { dialogue, isSuccessful: true }
  }

  dialogue.push(
    { speaker: 'customer', text: 'No. Goodbye.' },
    { speaker: 'system', text: '[Call Ended — Prospect declined]' },
  )
  return { dialogue, isSuccessful: false }
}

/** The same idea for SMS: a short thread built from the configured pitch. */
export const scriptedThread = (
  campaign: CampaignRow,
  prospect: ProspectRow,
): { messages: Array<{ sender: 'agent' | 'customer'; body: string }>; isSuccessful: boolean } => {
  const agent = campaign.agent_name || 'Alex'
  const company = campaign.company_name || 'our agency'
  const contact = (prospect.contact_person || '').split(' ')[0] || 'there'

  return {
    isSuccessful: true,
    messages: [
      {
        sender: 'agent',
        body: `Hi ${contact}, it's ${agent} from ${company}. ${campaign.primary_hook || 'We stop missed calls turning into lost jobs.'} Worth a quick look?`,
      },
      { sender: 'customer', body: 'Maybe. What does it actually do?' },
      {
        sender: 'agent',
        body: campaign.product_description || 'It answers every missed call and books the job straight into your calendar.',
      },
      { sender: 'customer', body: 'And the price?' },
      { sender: 'agent', body: campaign.objection_pricing || `It's ${campaign.pricing || 'a flat monthly fee'} — one saved job covers it.` },
      { sender: 'customer', body: 'Go on then, send me a time for a demo.' },
    ],
  }
}

/* --------------------------------------------------------------------- SMS */

/**
 * Real outbound/inbound SMS via Twilio's REST API, called directly with
 * `fetch` rather than the `twilio` SDK — one HTTP call, no extra dependency
 * to bundle into the function.
 *
 * All three env vars must be set in Netlify (Site settings > Environment
 * variables) for sending to work:
 *   TWILIO_ACCOUNT_SID   - starts with "AC..."
 *   TWILIO_AUTH_TOKEN    - from the same Twilio console page
 *   TWILIO_FROM_NUMBER   - the SMS-capable Twilio number, E.164 (+44...)
 */
export const getEnv = (key: string): string => {
  if (typeof process !== 'undefined' && process.env && process.env[key]) return process.env[key]!
  try {
    if (typeof Netlify !== 'undefined' && (Netlify as any).env) return (Netlify as any).env.get(key) || ''
  } catch {}
  return ''
}

export const twilioConfigured = (): boolean =>
  Boolean(
    (getEnv('TWILIO_ACCOUNT_SID') || getEnv('TWILIO_SID')) &&
    getEnv('TWILIO_AUTH_TOKEN') &&
    (getEnv('TWILIO_FROM_NUMBER') || getEnv('TWILIO_PHONE_NUMBER') || true),
  )

/**
 * Best-effort UK-biased E.164 normaliser. Business-directory phone numbers
 * arrive in all sorts of formats ("0191 406 2323", "+44 191 406 2323",
 * "07123456789"), and Twilio requires strict E.164. This is deliberately
 * simple: strip everything but digits and a leading +, then fix up the two
 * common UK shapes. Numbers that already look international are left alone.
 */
export const toE164 = (raw: string): string | null => {
  const trimmed = raw.trim()
  if (!trimmed) return null

  const hasPlus = trimmed.startsWith('+')
  const digits = trimmed.replace(/[^\d]/g, '')
  if (!digits) return null

  if (hasPlus) return `+${digits}`
  if (digits.startsWith('44')) return `+${digits}`
  if (digits.startsWith('0')) return `+44${digits.slice(1)}`
  // Bare 10-digit UK mobile/landline with no leading 0 (rare, but seen in
  // scraped directory data).
  if (digits.length === 10) return `+44${digits}`

  return null
}

/** Last 9 significant digits, used to match an inbound Twilio "From" number
 * back to a prospect row without needing every stored number to already be
 * in strict E.164. */
export const phoneFingerprint = (raw: string): string => {
  const digits = raw.replace(/[^\d]/g, '')
  return digits.slice(-9)
}

export interface SmsSendResult {
  ok: boolean
  error?: string
}

/** Sends one real SMS via Twilio. Never throws — callers check `.ok`. */
export async function sendSms(toRaw: string, body: string): Promise<SmsSendResult> {
  const sid = getEnv('TWILIO_ACCOUNT_SID') || getEnv('TWILIO_SID')
  const token = getEnv('TWILIO_AUTH_TOKEN')
  const from = getEnv('TWILIO_FROM_NUMBER') || getEnv('TWILIO_PHONE_NUMBER') || 'EchoLift'

  if (!sid || !token || !from) {
    return { ok: false, error: 'Twilio is not configured (missing TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER).' }
  }

  const to = toE164(toRaw)
  if (!to) {
    return { ok: false, error: `Could not parse "${toRaw}" as a sendable phone number.` }
  }

  try {
    const auth = Buffer.from(`${sid}:${token}`).toString('base64')
    const params = new URLSearchParams({ To: to, From: from, Body: body })

    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      return { ok: false, error: `Twilio rejected the send (${res.status}): ${detail.slice(0, 300)}` }
    }

    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Unknown error calling Twilio.' }
  }
}

/**
 * Validates that an inbound webhook request really came from Twilio, using
 * the same HMAC-SHA1 scheme Twilio's own client libraries use. Skipped (and
 * logged) when TWILIO_AUTH_TOKEN isn't set, so local/dev testing isn't
 * blocked — but that means production must always have the token set.
 */
export async function verifyTwilioSignature(
  url: string,
  params: Record<string, string>,
  signatureHeader: string | null,
): Promise<boolean> {
  const token = Netlify.env.get('TWILIO_AUTH_TOKEN')
  if (!token) {
    console.error('apexvoice sms-inbound: TWILIO_AUTH_TOKEN not set, cannot verify signature')
    return false
  }
  if (!signatureHeader) return false

  const sortedKeys = Object.keys(params).sort()
  const data = sortedKeys.reduce((acc, key) => acc + key + params[key], url)

  const subtle = globalThis.crypto?.subtle
  if (!subtle) return false

  const keyData = new TextEncoder().encode(token)
  const cryptoKey = await subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'])
  const signature = await subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data))
  const expected = Buffer.from(signature).toString('base64')

  return expected === signatureHeader
}

/* --------------------------------------------------------------- persistence */

/** Record an outcome on the prospect and drop a row in the activity feed. */
export const recordOutcome = async (
  prospect: ProspectRow,
  type: 'Call' | 'SMS',
  outcome: string,
  status: string,
  lastInteraction: string,
  warmthScore: number,
) => {
  const clamped = Math.max(0, Math.min(100, Math.round(warmthScore)))

  await db().sql`
    UPDATE apexvoice_prospects
    SET status = ${status},
        last_interaction = ${lastInteraction},
        warmth_score = ${clamped}
    WHERE id = ${prospect.id}
  `

  await db().sql`
    INSERT INTO apexvoice_activity (prospect_id, type, business_name, contact_person, outcome)
    VALUES (${prospect.id}, ${type}, ${prospect.business_name}, ${prospect.contact_person}, ${outcome})
  `
}
