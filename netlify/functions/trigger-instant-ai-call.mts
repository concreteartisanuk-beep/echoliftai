import type { Config } from '@netlify/functions'
import { db, recordOutcome, text, type ProspectRow } from './lib/apexvoice.mts'

const VAPI_API_KEY = process.env.VAPI_API_KEY || '0ebf67d6-4eca-4d1a-ab96-b7158677fc9a'
const VAPI_ASSISTANT_ID = process.env.VAPI_ASSISTANT_ID || '74a2d264-ac9b-4943-90cf-de3dc022cc03'
const VAPI_PHONE_NUMBER_ID = process.env.VAPI_PHONE_NUMBER_ID || ''

/** Clean text scraped from HTML body */
const cleanHtmlText = (html: string): string => {
  return html
    .replace(/<script\b[^<]*>([\s\S]*?)<\/script>/gi, '')
    .replace(/<style\b[^<]*>([\s\S]*?)<\/style>/gi, '')
    .replace(/<header\b[^<]*>([\s\S]*?)<\/header>/gi, '')
    .replace(/<footer\b[^<]*>([\s\S]*?)<\/footer>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1500)
}

/** Fast website content scraper with strict deadline */
const scrapeWebsiteFacts = async (urlStr: string): Promise<string> => {
  if (!urlStr || urlStr.trim() === '') return 'No website URL provided.'

  let validUrl = urlStr.trim()
  if (!/^https?:\/\//i.test(validUrl)) {
    validUrl = `https://${validUrl}`
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 2500)

  try {
    const res = await fetch(validUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) EchoLiftBot/1.0',
      },
      signal: controller.signal,
    })

    if (!res.ok) return `Could not load website (${res.status}).`
    const html = await res.text()
    const cleaned = cleanHtmlText(html)
    return cleaned.length > 50 ? cleaned : 'Website loaded with minimal text.'
  } catch (err) {
    return 'Website fetch timed out. Using standard business defaults.'
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

    // 1. Scrape website facts in real-time
    console.log(`🔍 Scraper inspecting ${website} for ${company}...`)
    const scrapedFacts = await scrapeWebsiteFacts(website)

    // 2. Save lead into database
    try {
      const [prospect] = (await db().sql`
        INSERT INTO apexvoice_prospects (
          business_name, contact_person, industry, location, phone, website, pain_points, warmth_score, status, source
        ) VALUES (
          ${company}, ${name}, 'Instant AI Demo', 'UK', ${e164Phone}, ${website},
          ${`Website Scraped Facts: ${scrapedFacts.slice(0, 300)}`},
          90, 'Instant Call Requested', 'Live Website Demo'
        )
        RETURNING *
      `) as ProspectRow[]

      if (prospect) {
        await recordOutcome(
          prospect,
          'Voice Call',
          'Instant AI Demo Call Triggered',
          'In Progress',
          `Scraped website knowledge base for ${company}`,
          90
        )
      }
    } catch (err) {
      console.error('Database lead save notice:', err)
    }

    // 3. System Prompt & Dynamic Assistant Overrides
    const systemPrompt = `You are an automated reception assistant named Echo working 24/7 for "${company}".
You are speaking directly over the phone with ${name}.
Your goal is to act as ${company}'s 24/7 AI phone receptionist, greeting ${name} warmly and answering any questions about ${company} using the website factsheet below.

WEBSITE FACTSHEET FOR ${company}:
- Company Name: ${company}
- Owner/Contact: ${name}
- Website URL: ${website || 'N/A'}
- Scraped Knowledge Base Facts: ${scrapedFacts}

Rules:
1. Greet the caller warmly: "Hi ${name}! Thank you for calling ${company}. I am your 24/7 EchoLift AI phone receptionist. How can I help you today?"
2. Answer questions accurately using the factsheet above.
3. Keep answers concise, clear, and natural (1-2 sentences per turn).
4. Demonstrate how smooth and human-sounding EchoLift AI receptionists are.`

    const firstMessage = `Hi ${name}! Thank you for calling ${company}. I am your 24/7 EchoLift AI phone receptionist. How can I help you today?`

    // 4. Trigger Outbound Phone Call via Vapi API if phone number is provided
    let callTriggered = false
    let vapiResponseData: any = null

    try {
      const vapiPayload = {
        assistantId: VAPI_ASSISTANT_ID,
        phoneNumberId: VAPI_PHONE_NUMBER_ID || undefined,
        customer: {
          number: e164Phone,
          name: name,
        },
        assistantOverrides: {
          firstMessage: firstMessage,
          model: {
            provider: 'openai',
            model: 'gpt-4o-mini',
            temperature: 0.3,
            maxTokens: 100,
            messages: [
              {
                role: 'system',
                content: systemPrompt,
              },
            ],
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
      } else {
        const errText = await vapiRes.text().catch(() => '')
        console.error('Vapi outbound call API error:', vapiRes.status, errText)
      }
    } catch (err) {
      console.error('Vapi outbound fetch exception:', err)
    }

    return Response.json(
      {
        success: true,
        callTriggered,
        name,
        company,
        phone: e164Phone,
        website,
        scrapedFactsSnippet: scrapedFacts.slice(0, 200),
        systemPrompt,
        firstMessage,
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
