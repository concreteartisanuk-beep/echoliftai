import type { Config } from '@netlify/functions'
import { db, recordOutcome, text, type ProspectRow } from './lib/apexvoice.mts'

const VAPI_API_KEY = process.env.VAPI_API_KEY || '0ebf67d6-4eca-4d1a-ab96-b7158677fc9a'
const VAPI_ASSISTANT_ID = process.env.VAPI_ASSISTANT_ID || '74a2d264-ac9b-4943-90cf-de3dc022cc03'
const VAPI_PHONE_NUMBER_ID = process.env.VAPI_PHONE_NUMBER_ID || ''

/** Clean and structure website content into a grounded factual knowledge base */
const extractDynamicFactsheet = (html: string, company: string, contact: string, website: string): string => {
  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)
  const title = titleMatch ? titleMatch[1].replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim() : ''

  const metaMatch = html.match(/<meta\s+(?:name|property)=["'](?:description|og:description)["']\s+content=["'](.*?)["']/i)
  const metaDesc = metaMatch ? metaMatch[1].replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim() : ''

  // 1. Extract lists of actual services, products, or offerings (li)
  const items: string[] = []
  const liMatches = html.match(/<li\b[^>]*>([\s\S]*?)<\/li>/gi) || []
  for (const li of liMatches) {
    const clean = li.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
    if (clean.length > 3 && clean.length < 80 && !/home|about|contact|sign in|cookie|privacy|facebook|instagram/i.test(clean)) {
      items.push(clean)
    }
  }

  // 2. Extract key headings
  const headings: string[] = []
  const hMatches = html.match(/<(?:h1|h2|h3)\b[^>]*>([\s\S]*?)<\/(?:h1|h2|h3)>/gi) || []
  for (const h of hMatches) {
    const clean = h.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
    if (clean.length > 5 && clean.length < 100 && !/cookie|menu|footer|privacy|navigation/i.test(clean)) {
      headings.push(clean)
    }
  }

  // 3. Extract factual paragraphs
  const paragraphs: string[] = []
  const pMatches = html.match(/<p\b[^>]*>([\s\S]*?)<\/p>/gi) || []
  for (const p of pMatches) {
    const clean = p.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
    if (clean.length > 20 && clean.length < 350 && !/cookie|all rights reserved|privacy|terms/i.test(clean)) {
      paragraphs.push(clean)
    }
  }

  // 4. Detect UK locations mentioned on the website
  const locationList = [
    'London', 'Manchester', 'Birmingham', 'Leeds', 'Newcastle', 'North East', 'Glasgow', 'Edinburgh',
    'Liverpool', 'Bristol', 'Sheffield', 'Cardiff', 'Belfast', 'Surrey', 'Kent', 'Essex', 'Cheshire', 'Yorkshire'
  ]
  const foundLocations = locationList.filter((l) => new RegExp('\\b' + l + '\\b', 'i').test(html))
  if (/nationwide|across the uk|throughout the uk/i.test(html)) {
    foundLocations.push('nationwide across the UK')
  }

  const uniqueServices = [...new Set([...items, ...headings])].slice(0, 15)
  const uniqueParagraphs = [...new Set(paragraphs)].slice(0, 8)

  const factsheet = {
    company,
    contact,
    website,
    title,
    metaDesc,
    productsAndServices: uniqueServices,
    paragraphs: uniqueParagraphs,
    locations: [...new Set(foundLocations)],
  }

  return JSON.stringify(factsheet)
}

/** Fast website content scraper with strict timeout */
const scrapeWebsiteFacts = async (urlStr: string, company: string, contact: string): Promise<string> => {
  if (!urlStr || urlStr.trim() === '') {
    return JSON.stringify({
      company,
      contact,
      website: '',
      title: company,
      metaDesc: `Professional services and customer care for ${company}`,
      productsAndServices: [],
      paragraphs: [],
      locations: [],
    })
  }

  let validUrl = urlStr.trim()
  if (!/^https?:\/\//i.test(validUrl)) {
    validUrl = `https://${validUrl}`
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 2800)

  try {
    const res = await fetch(validUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) EchoLiftBot/1.0 (Dynamic Knowledge Scraper)',
      },
      signal: controller.signal,
    })

    if (!res.ok) {
      return JSON.stringify({
        company,
        contact,
        website: validUrl,
        title: company,
        metaDesc: `Website returned ${res.status}`,
        productsAndServices: [],
        paragraphs: [],
        locations: [],
      })
    }

    const html = await res.text()
    return extractDynamicFactsheet(html, company, contact, validUrl)
  } catch (err) {
    return JSON.stringify({
      company,
      contact,
      website: validUrl,
      title: company,
      metaDesc: `Website fetch timed out`,
      productsAndServices: [],
      paragraphs: [],
      locations: [],
    })
  } finally {
    clearTimeout(timer)
  }
}

/** Convert UK phone numbers to standard E.164 (+44...) */
const toE164 = (phone: string): string => {
  const digits = phone.replace(/[^0-9]/g, '')
  if (digits.startsWith('44')) return `+${digits}`
  if (digits.startsWith('0')) return `+44${digits.slice(1)}`
  if (digits.length === 10 && digits.startsWith('7')) return `+44${digits}`
  return `+${digits}`
}

export default async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
    })
  }

  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) {
      return Response.json({ error: 'Expected JSON body' }, { status: 400 })
    }

    const name = text(body.name, 100) || 'there'
    const company = text(body.company, 150) || 'Your Business'
    const website = text(body.website, 200) || ''
    const rawPhone = text(body.phone, 30) || ''

    if (!rawPhone) {
      return Response.json({ error: 'Telephone number is required' }, { status: 400 })
    }

    const e164Phone = toE164(rawPhone)

    // 1. Scrape customer's website facts in real-time
    console.log(`🔍 Scraper extracting real business facts from ${website} for ${company}...`)
    const scrapedFactsJson = await scrapeWebsiteFacts(website, company, name)

    // 2. Save lead with grounded business knowledge into database
    let prospectId: number | null = null
    try {
      const [prospect] = (await db().sql`
        INSERT INTO apexvoice_prospects (
          business_name, contact_person, industry, location, phone, website, pain_points, warmth_score, status, source
        ) VALUES (
          ${company}, ${name}, 'Live Demo Prospect', 'UK', ${e164Phone}, ${website},
          ${scrapedFactsJson},
          90, 'Instant Call Requested', 'Live Website Demo'
        )
        RETURNING *
      `) as ProspectRow[]

      if (prospect) {
        prospectId = prospect.id
        await recordOutcome(
          prospect,
          'Voice Call',
          'Instant AI Demo Call Triggered',
          'In Progress',
          `Grounded factsheet extracted for ${company}`,
          90
        )
      }
    } catch (err) {
      console.error('Database lead save notice:', err)
    }

    // 3. Opening greeting
    const spokenText = `Thank you for calling ${company}, my name is Echo, how may I help you?`
    const audioStreamUrl = `https://www.echoliftai.co.uk/api/instant-ai-voice-stream?text=${encodeURIComponent(spokenText)}`
    const pIdStr = prospectId ? String(prospectId) : ''

    // 4. Pre-warm the greeting audio stream immediately in background so it is cached before pickup
    fetch(audioStreamUrl).catch((e) => console.warn('Pre-warm greeting failed:', e))

    let callTriggered = false
    let vapiResponseData: any = null

    // 5. Try Vapi Outbound API (if configured)
    try {
      const vapiPayload = {
        assistantId: VAPI_ASSISTANT_ID,
        phoneNumberId: VAPI_PHONE_NUMBER_ID || undefined,
        customer: {
          number: e164Phone,
          name: name,
        },
        assistantOverrides: {
          firstMessage: spokenText,
          voice: {
            provider: '11labs',
            voiceId: 'Xb7hH2yqWyRel9GQ555e',
            stability: 0.5,
            similarityBoost: 0.75,
          },
        },
      }

      const vapiRes = await fetch('https://api.vapi.ai/call/phone', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${VAPI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(vapiPayload),
      })

      if (vapiRes.ok) {
        callTriggered = true
        vapiResponseData = await vapiRes.json().catch(() => ({}))
      }
    } catch (err) {
      // Vapi fallback
    }

    // 6. Primary telephony via Twilio Voice API
    if (!callTriggered) {
      const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID
      const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN
      const twilioFromNumber = process.env.TWILIO_FROM_NUMBER || '+441914062323'

      if (twilioAccountSid && twilioAuthToken) {
        try {
          const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" action="https://www.echoliftai.co.uk/api/instant-ai-voice-reply?prospectId=${pIdStr}" speechTimeout="auto" timeout="4" hints="services, quote, pricing, cost, location, contact, phone, appointments, bookings, hours">
    <Play>${audioStreamUrl}</Play>
  </Gather>
  <Gather input="speech" action="https://www.echoliftai.co.uk/api/instant-ai-voice-reply?prospectId=${pIdStr}" speechTimeout="auto" timeout="4">
    <Say voice="alice" language="en-GB">Are you still there? How can I help you today?</Say>
  </Gather>
</Response>`

          const authHeader = 'Basic ' + Buffer.from(`${twilioAccountSid}:${twilioAuthToken}`).toString('base64')
          const twilioRes = await fetch(
            `https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/Calls.json`,
            {
              method: 'POST',
              headers: {
                Authorization: authHeader,
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              body: new URLSearchParams({
                To: e164Phone,
                From: twilioFromNumber,
                Twiml: twiml,
              }),
            }
          )

          if (twilioRes.ok) {
            callTriggered = true
            console.log(`Twilio Voice outbound call triggered to ${e164Phone}`)
          } else {
            console.error('Twilio Voice call failed:', twilioRes.status, await twilioRes.text())
          }
        } catch (err) {
          console.error('Twilio Voice call exception:', err)
        }
      }
    }

    return Response.json(
      {
        success: true,
        callTriggered,
        name,
        company,
        phone: e164Phone,
        website,
        firstMessage: spokenText,
        vapiCallId: vapiResponseData?.id || null,
      },
      {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json',
        },
      }
    )
  } catch (error: any) {
    console.error('Instant AI call function error:', error)
    return Response.json({ error: error.message || 'Server error' }, { status: 500 })
  }
}

export const config: Config = {
  path: '/api/trigger-instant-ai-call',
  method: ['POST', 'OPTIONS'],
}
