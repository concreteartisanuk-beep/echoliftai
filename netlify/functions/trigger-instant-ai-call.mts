import type { Config } from '@netlify/functions'
import { db, recordOutcome, text, type ProspectRow } from './lib/apexvoice.mts'

const VAPI_API_KEY = process.env.VAPI_API_KEY || '0ebf67d6-4eca-4d1a-ab96-b7158677fc9a'
const VAPI_ASSISTANT_ID = process.env.VAPI_ASSISTANT_ID || '74a2d264-ac9b-4943-90cf-de3dc022cc03'
const VAPI_PHONE_NUMBER_ID = process.env.VAPI_PHONE_NUMBER_ID || ''

/** Clean text scraped from HTML body, stripping menus, headers, scripts, and buttons */
const cleanHtmlText = (html: string): string => {
  // 1. Extract meta description if present
  const metaMatch = html.match(/<meta\s+(?:name|property)=["'](?:description|og:description)["']\s+content=["'](.*?)["']/i)
  const metaDesc = metaMatch ? metaMatch[1].trim() : ''

  // 2. Extract paragraph and heading contents
  const textBlocks: string[] = []
  if (metaDesc) textBlocks.push(`Company Overview: ${metaDesc}`)

  const paragraphMatches = html.match(/<(?:p|h1|h2|h3)\b[^>]*>([\s\S]*?)<\/(?:p|h1|h2|h3)>/gi) || []
  for (const block of paragraphMatches) {
    const text = block
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (text.length > 25 && !/cookie|copyright|rights reserved|privacy policy|terms|sign in|login|diagnostic/i.test(text)) {
      textBlocks.push(text)
    }
  }

  const combined = textBlocks.join('. ').slice(0, 1000)
  return combined.length > 30 ? combined : 'General professional services and customer care.'
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
    let prospectId: number | null = null
    try {
      const [prospect] = (await db().sql`
        INSERT INTO apexvoice_prospects (
          business_name, contact_person, industry, location, phone, website, pain_points, warmth_score, status, source
        ) VALUES (
          ${company}, ${name}, 'Instant AI Demo', 'UK', ${e164Phone}, ${website},
          ${`Website Scraped Facts: ${scrapedFacts.slice(0, 500)}`},
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
          `Scraped website knowledge base for ${company}`,
          90
        )
      }
    } catch (err) {
      console.error('Database lead save notice:', err)
    }

    // 3. System Prompt & Dynamic Assistant Overrides
    const firstMessage = `Thank you for calling ${company}, my name is Echo, how may I help you?`

    const systemPrompt = `You are Echo, the 24/7 AI Receptionist answering calls for "${company}".
Greeting: "Thank you for calling ${company}, my name is Echo, how may I help you?"
Owner / Contact Person: ${name}

WEBSITE KNOWLEDGE BASE FOR ${company}:
- Business Name: ${company}
- Owner / Contact Person: ${name}
- Website URL: ${website || 'N/A'}
- Scraped Facts & Offerings: ${scrapedFacts}

Rules:
1. Opening Greeting: "Thank you for calling ${company}, my name is Echo, how may I help you?"
2. Answer customer questions about ${company} concisely and professionally (1-2 sentences) using the scraped website factsheet above.
3. Keep answers clear, professional, and friendly.`

    let callTriggered = false
    let vapiResponseData: any = null

    // 4. Try Vapi Outbound API
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
          voice: {
            provider: '11labs',
            voiceId: 'Xb7hH2yqWyRel9GQ555e',
            stability: 0.5,
            similarityBoost: 0.75,
          },
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
      }
    } catch (err) {
      console.error('Vapi outbound fetch exception:', err)
    }

    // 5. Fallback to Twilio Voice API with ElevenLabs ultra-realistic human voice stream & live speech input
    if (!callTriggered) {
      const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID
      const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN
      const twilioFromNumber = process.env.TWILIO_FROM_NUMBER || '+441914062323'

      if (twilioAccountSid && twilioAuthToken) {
        try {
          const spokenText = `Thank you for calling ${company}, my name is Echo, how may I help you?`
          const audioStreamUrl = `https://www.echoliftai.co.uk/api/instant-ai-voice-stream?text=${encodeURIComponent(spokenText)}`
          const pIdStr = prospectId ? String(prospectId) : ''

          const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Play>${audioStreamUrl}</Play>
  <Gather input="speech" action="https://www.echoliftai.co.uk/api/instant-ai-voice-reply?prospectId=${pIdStr}" speechTimeout="1" timeout="2" hints="services, quote, pricing, cost, location, contact, phone, opening hours, estimate">
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
