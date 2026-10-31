import type { Config } from '@netlify/functions'
import { db, findProspect, type ProspectRow } from './lib/apexvoice.mts'

interface BusinessFactsheet {
  company: string
  contact: string
  website: string
  title: string
  metaDesc: string
  productsAndServices: string[]
  paragraphs: string[]
  locations: string[]
}

/** Parse stored prospect data into a structured factsheet */
const parseFactsheet = (company: string, contact: string, website: string, rawText: string): BusinessFactsheet => {
  if (rawText && rawText.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(rawText) as Partial<BusinessFactsheet>
      return {
        company: parsed.company || company,
        contact: parsed.contact || contact,
        website: parsed.website || website,
        title: parsed.title || company,
        metaDesc: parsed.metaDesc || '',
        productsAndServices: Array.isArray(parsed.productsAndServices) ? parsed.productsAndServices : [],
        paragraphs: Array.isArray(parsed.paragraphs) ? parsed.paragraphs : [],
        locations: Array.isArray(parsed.locations) ? parsed.locations : [],
      }
    } catch (e) {
      // JSON parse fallback
    }
  }

  // Fallback if stored as plain text
  const services: string[] = []
  const locations: string[] = []
  const paragraphs: string[] = []

  const lines = (rawText || '').split('\n')
  for (const line of lines) {
    if (line.includes('Services:')) {
      const parts = line.replace(/.*Services:/, '').split(/[;,]/)
      for (const p of parts) if (p.trim().length > 3) services.push(p.trim())
    } else if (line.includes('Areas:') || line.includes('Locations:')) {
      const locs = line.replace(/.*(?:Areas|Locations):/, '').split(',')
      for (const l of locs) if (l.trim().length > 2) locations.push(l.trim())
    } else if (line.length > 25) {
      paragraphs.push(line.trim())
    }
  }

  return {
    company,
    contact,
    website,
    title: company,
    metaDesc: paragraphs[0] || `Professional services for ${company}`,
    productsAndServices: services,
    paragraphs,
    locations,
  }
}

/** Attempt ultra-fast LLM generation via Anthropic Claude (if API key available) */
const generateAiAnswer = async (
  speech: string,
  factsheet: BusinessFactsheet
): Promise<string | null> => {
  try {
    const apiKey =
      process.env.ANTHROPIC_API_KEY ||
      (typeof Netlify !== 'undefined' ? (Netlify as any).env?.get('ANTHROPIC_API_KEY') : '')
    if (!apiKey) return null

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 1100)

    const prompt = `You are Echo, the professional, friendly 24/7 AI telephone receptionist answering calls for "${factsheet.company}".
Owner / Contact Person: "${factsheet.contact}".

ACTUAL WEBSITE FACTSHEET FOR ${factsheet.company}:
Website: ${factsheet.website}
Title: ${factsheet.title}
Overview: ${factsheet.metaDesc}
Products & Services: ${factsheet.productsAndServices.join('; ')}
Locations: ${factsheet.locations.join(', ')}
Key Details: ${factsheet.paragraphs.join(' ')}

CALLER'S QUESTION ON THE PHONE:
"${speech}"

STRICT RULES:
1. Speak in 1-2 concise, conversational spoken sentences suitable for a phone call.
2. Only speak about what ${factsheet.company} actually does based strictly on the factsheet above. NEVER invent services or trades not mentioned.
3. If asked about something they do not offer, politely state what they specialize in and offer a callback with ${factsheet.contact}.
4. Speak naturally like a real UK receptionist. Do NOT use markdown, bullet points, or say you are an AI.`

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 100,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    clearTimeout(timer)

    if (res.ok) {
      const data = await res.json()
      const textBlock = data.content?.find((c: any) => c.type === 'text')
      if (textBlock?.text) {
        return textBlock.text.trim()
      }
    }
  } catch (err) {
    // Timeout or network error
  }
  return null
}

/** 100% Grounded Universal Answering Engine */
const answerGrounded = (query: string, factsheet: BusinessFactsheet): string => {
  const lower = query.toLowerCase().trim()
  const company = factsheet.company
  const contact = factsheet.contact
  const contactFirst = contact ? contact.split(' ')[0].toLowerCase() : ''
  const navPattern = /\b(?:home|about|contact|sign in|cookie|privacy|basket|cart|shop|checkout|menu|search|account|login)\b/i
  const services = (factsheet.productsAndServices || []).filter((s) => !navPattern.test(s) && !/[🛒🛍️📦]/u.test(s))
  const servicesSummary = services.length
    ? services.slice(0, 4).join(', ')
    : factsheet.metaDesc || 'our bespoke products and services'

  // 1. GREETINGS
  if (
    lower === 'hello' ||
    lower === 'hi' ||
    lower === 'hey' ||
    lower === 'hello echo' ||
    lower === 'good morning' ||
    lower === 'good afternoon'
  ) {
    return `Hello! I am Echo, the 24/7 AI Receptionist for ${company}. How can I assist you with your project today?`
  }

  // 2. APEXVOICE / ECHOLIFT PLATFORM META
  if (
    lower.includes('apexvoice') ||
    lower.includes('apex voice') ||
    lower.includes('echolift') ||
    lower.includes('who built you') ||
    lower.includes('what are you')
  ) {
    return `ApexVoice is our 24/7 AI voice receptionist platform. It answers calls instantly, answers inquiries for ${company}, and books jobs straight into your schedule so you never lose leads.`
  }

  // 3. PRICING & QUOTES (Using strict whole word matching to avoid substring bugs like 'coffee' matching 'fee'!)
  if (
    /\b(?:quote|quotes|cost|costs|pricing|price|prices|estimate|estimates|fee|fees|rates)\b/i.test(lower) ||
    lower.includes('how much')
  ) {
    return `We provide tailored quotes for all our work at ${company}. Would you like me to book a quick callback with ${contact} to discuss pricing and specifications?`
  }

  // 4. LOCATION & WHERE BASED
  if (
    lower.includes('where are you') ||
    lower.includes('where based') ||
    lower.includes('where are you based') ||
    lower.includes('location') ||
    lower.includes('deliver') ||
    lower.includes('travel') ||
    lower.includes('what area') ||
    lower.includes('do you cover')
  ) {
    const locStr = factsheet.locations && factsheet.locations.length
      ? factsheet.locations.join(' and ')
      : 'the local area and across the UK'
    return `${company} is based in ${locStr}. Where is your property or project located?`
  }

  // 5. AVAILABILITY & SCHEDULING
  if (
    lower.includes('when can you start') ||
    lower.includes('availability') ||
    lower.includes('available') ||
    lower.includes('book an appointment') ||
    lower.includes('how soon') ||
    lower.includes('book a survey') ||
    lower.includes('can someone come out') ||
    lower.includes('tomorrow') ||
    lower.includes('this week')
  ) {
    return `We can check our diary and get an appointment or consultation scheduled for you at ${company}. Would you like me to have ${contact} call you back to confirm a date?`
  }

  // 6. SPEAK TO OWNER / HUMAN
  if (
    lower.includes('speak to') ||
    lower.includes('talk to') ||
    lower.includes('human') ||
    lower.includes('real person') ||
    (contact && lower.includes(contact.toLowerCase())) ||
    (contactFirst && lower.includes(contactFirst))
  ) {
    return `Of course! I will pass your message directly to ${contact} right away. What is the best number and time to reach you on?`
  }

  // 7. "WHAT DO YOU DO?" / "WHAT SERVICES DO YOU OFFER?" / "WHAT DO YOU MAKE?"
  if (
    lower === 'what do you do' ||
    lower.includes('what do you do') ||
    lower.includes('what do you make') ||
    lower.includes('what do you sell') ||
    lower.includes('what services do you offer') ||
    lower.includes('tell me what you do') ||
    lower.includes('tell me about your business')
  ) {
    return `At ${company}, we specialize in ${servicesSummary}. How can we help with your upcoming project?`
  }

  // 8. SPECIFIC PRODUCT / SERVICE INQUIRY ("DO YOU DO X?")
  // Extract specific subject nouns from caller question, filtering out company name and generic meta-tokens
  const genericNouns = new Set([
    'services', 'service', 'products', 'product', 'work', 'works', 'business',
    'company', 'things', 'stuff', 'quote', 'quotes', 'cost', 'costs', 'price',
    'prices', 'appointment', 'appointments', 'times', 'dates', 'help', 'call',
    'calls', 'someone', 'people', 'team', 'tell', 'about', 'need', 'want',
    'doing', 'offer', 'provide', 'make', 'makes', 'sell', 'sells',
    'polished', 'commercial', 'residential', 'domestic', 'bespoke', 'custom', 'luxury',
    // Common material / medium modifiers
    'concrete', 'wooden', 'timber', 'metal', 'steel', 'glass', 'stone', 'marble', 'granite',
    'acrylic', 'plastic', 'ceramic', 'leather', 'fabric'
  ])
  company.toLowerCase().split(/[^a-z0-9]+/).forEach((w) => {
    if (w.length > 2) genericNouns.add(w)
  })

  const queryNouns = lower
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !genericNouns.has(w) && !['what', 'when', 'where', 'which', 'have', 'with', 'from', 'your', 'some', 'they', 'their', 'could', 'would'].includes(w))

  let matchedItem: string | null = null
  for (const noun of queryNouns) {
    const singular = noun.replace(/s$/, '')
    for (const item of services) {
      const itemLower = item.toLowerCase()
      // Skip if item is just the whole company name
      if (itemLower === company.toLowerCase()) continue
      const pattern = new RegExp('\\b' + (singular.length > 3 ? singular : noun) + '(?:s|es|ing)?\\b', 'i')
      if (pattern.test(itemLower)) {
        matchedItem = item
        break
      }
    }
    if (matchedItem) break
  }

  if (matchedItem) {
    return `Yes! At ${company} we specialize in ${matchedItem.toLowerCase()}. Would you like to get a quote or discuss options with ${contact}?`
  }

  // 9. CHECK SCRAPED PARAGRAPHS FOR FACTUAL ANSWERS ONLY IF SPECIFIC NOUN MATCHES
  if (factsheet.paragraphs && factsheet.paragraphs.length && queryNouns.length > 0) {
    for (const p of factsheet.paragraphs) {
      const matches = queryNouns.filter((w) => new RegExp('\\b' + w + '\\b', 'i').test(p)).length
      if (matches >= 2) {
        const sentence = p.split(/(?<=[.!?])\s+/)[0]
        return `At ${company}, ${sentence}. Would you like me to have ${contact} follow up with full details?`
      }
    }
  }

  // 10. GROUNDED RECEPTIONIST RESPONSE (Never claims to do things not on website!)
  return `At ${company}, we specialize primarily in ${servicesSummary}. If you need ${queryNouns[0] || 'that'}, I would be happy to take your details and have ${contact} call you back today. Would you like me to arrange that?`
}

export default async (req: Request) => {
  try {
    const url = new URL(req.url)
    const prospectIdRaw = url.searchParams.get('prospectId')
    const prospectId = prospectIdRaw ? Number.parseInt(prospectIdRaw, 10) : null

    let userSpeech = ''

    try {
      const contentType = req.headers.get('content-type') || ''
      if (contentType.includes('application/x-www-form-urlencoded')) {
        const bodyText = await req.text()
        const params = new URLSearchParams(bodyText)
        userSpeech = params.get('SpeechResult') || ''
      } else if (contentType.includes('application/json')) {
        const json = await req.json().catch(() => ({}))
        userSpeech = json.SpeechResult || json.speech || ''
      } else {
        userSpeech = url.searchParams.get('SpeechResult') || ''
      }
    } catch (e) {
      console.error('Error parsing speech input:', e)
    }

    userSpeech = userSpeech.trim()
    console.log(`🎤 Twilio Speech Input for prospect ${prospectId}: "${userSpeech}"`)

    let company = 'Concreet'
    let contact = 'Ian'
    let facts = JSON.stringify({
      company: 'Concreet',
      contact: 'Ian',
      website: 'https://concreet.co.uk',
      title: 'Concreet - Bespoke Microcement & Architectural Concrete',
      metaDesc: 'Handcrafted concrete homeware, furniture, and seamless microcement kitchen worktops in the UK.',
      productsAndServices: [
        'microcement worktop resurfacing',
        'kitchen island microcement',
        'seamless bathroom wall microcement',
        'bespoke concrete coffee tables',
        'concrete dining tables',
        'concrete candles and diffusers',
        'fluted concrete bowls and trays',
        'waterproof polyurethane sealing',
        'free kitchen worktop estimates'
      ],
      paragraphs: [
        'Concreet specialises in hand-trowelled microcement worktops applied directly over existing laminate, timber, or tile surfaces with zero demolition and a fast 3-day turnaround.',
        'All microcement surfaces are sealed with 3 coats of heavy-duty matte or satin polyurethane, making them 100% waterproof and heat-resistant.',
        'Ian has over 30 years of hands-on concrete, polishing, and surface finishing experience in the UK.'
      ],
      locations: ['North East England', 'Newcastle', 'Durham', 'Sunderland', 'Middlesbrough', 'Yorkshire', 'UK Wide Delivery']
    })
    let website = 'https://concreet.co.uk'

    if (prospectId) {
      try {
        const prospect = await findProspect(prospectId)
        if (prospect) {
          company = prospect.business_name || company
          contact = prospect.contact_person || contact
          facts = prospect.pain_points || facts
          website = prospect.website || website
        }
      } catch (err) {
        console.error('Error loading prospect for speech reply:', err)
      }
    }

    // Parse the prospect's factual knowledge base
    const factsheet = parseFactsheet(company, contact, website, facts)

    let aiReply: string | null = null

    // 1. Try Claude 3.5 Haiku if API key is present
    if (userSpeech) {
      aiReply = await generateAiAnswer(userSpeech, factsheet)
    }

    // 2. Grounded Universal Knowledge Engine (runs if AI took >1100ms or is offline)
    if (!aiReply) {
      aiReply = answerGrounded(userSpeech, factsheet)
    }

    const audioUrl = `https://www.echoliftai.co.uk/api/instant-ai-voice-stream?text=${encodeURIComponent(aiReply)}`
    const pIdStr = prospectId ? String(prospectId) : ''

    // Pre-warm the synthesized audio in background so Twilio receives it instantly
    fetch(audioUrl).catch((e) => console.warn('Prewarm reply audio warning:', e))

    // Nest <Play> inside <Gather> for instant speech recognition & zero transition latency
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" action="https://www.echoliftai.co.uk/api/instant-ai-voice-reply?prospectId=${pIdStr}" speechTimeout="auto" timeout="4" hints="services, quote, pricing, cost, location, contact, phone, appointments, bookings, hours">
    <Play>${audioUrl}</Play>
  </Gather>
  <Gather input="speech" action="https://www.echoliftai.co.uk/api/instant-ai-voice-reply?prospectId=${pIdStr}" speechTimeout="auto" timeout="4">
    <Say voice="alice" language="en-GB">Are you still there? How can I help you today?</Say>
  </Gather>
</Response>`

    return new Response(twiml, {
      headers: {
        'Content-Type': 'text/xml',
      },
    })
  } catch (err: any) {
    console.error('Unhandled instant-ai-voice-reply exception:', err)
    const fallbackText = 'Thank you for calling. Please let us know how we can help and we will get back to you shortly.'
    const fallbackAudio = `https://www.echoliftai.co.uk/api/instant-ai-voice-stream?text=${encodeURIComponent(fallbackText)}`
    const fallbackTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" speechTimeout="auto" timeout="4">
    <Play>${fallbackAudio}</Play>
  </Gather>
</Response>`
    return new Response(fallbackTwiml, {
      headers: {
        'Content-Type': 'text/xml',
      },
    })
  }
}

export const config: Config = {
  path: '/api/instant-ai-voice-reply',
  method: ['GET', 'POST', 'OPTIONS'],
}
