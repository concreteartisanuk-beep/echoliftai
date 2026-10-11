import type { Config } from '@netlify/functions'
import { findProspect } from './lib/apexvoice.mts'

/** Dynamic industry & trade knowledge synthesiser when website data is partial */
const inferIndustryProfile = (companyName: string, scrapedText: string) => {
  const combined = (companyName + ' ' + scrapedText).toLowerCase()

  if (combined.includes('microcement') || combined.includes('concrete') || companyName.toLowerCase().includes('concreet')) {
    return {
      industry: 'Microcement & Surface Design',
      coreServices: [
        'Microcement wall and floor finishes',
        'Seamless waterproof bathrooms and wet rooms',
        'Kitchen worktops and splashbacks',
        'Direct overlay over existing tiles and timber',
        'Polished concrete overlays and furniture',
      ],
      locations: ['Newcastle and the North East', 'UK nationwide'],
      specialties: '100% waterproof, seamless, grout-free, crack-resistant, polyurethane sealed',
    }
  }

  if (combined.includes('roof') || combined.includes('gutter') || combined.includes('chimney')) {
    return {
      industry: 'Roofing Services',
      coreServices: [
        'Slate and tile roof replacements',
        'EPDM and fibreglass flat roofs',
        'Emergency leak repairs and storm damage',
        'Chimney repointing and leadwork',
        'UPVC gutters, fascias, and soffits',
      ],
      locations: ['local area and surrounding regions'],
      specialties: 'Fully insured, guaranteed workmanship, emergency storm callouts, free roof surveys',
    }
  }

  if (combined.includes('dog') || combined.includes('groom') || combined.includes('pet') || combined.includes('canine')) {
    return {
      industry: 'Dog Grooming & Pet Care',
      coreServices: [
        'Full dog grooming and styling',
        'Bath, blow-dry, and brush out',
        'Nail clipping and ear cleaning',
        'Puppy introduction sessions',
        'Deshedding treatments for all breeds',
      ],
      locations: ['local salon and surrounding area'],
      specialties: 'Gentle 1-to-1 handling, natural organic shampoos, cage-free salon',
    }
  }

  if (combined.includes('dental') || combined.includes('dentist') || combined.includes('teeth') || combined.includes('smile')) {
    return {
      industry: 'Dental Practice',
      coreServices: [
        'Routine dental checkups and oral exams',
        'Hygienist teeth cleaning',
        'Teeth whitening and composite bonding',
        'Invisalign clear aligners',
        'Emergency toothache appointments',
      ],
      locations: ['local dental practice'],
      specialties: 'Gentle modern dentistry, nervous patient care, private and NHS treatments',
    }
  }

  if (combined.includes('plumb') || combined.includes('boiler') || combined.includes('heating') || combined.includes('gas')) {
    return {
      industry: 'Plumbing & Heating',
      coreServices: [
        'Boiler installations, servicing, and repairs',
        'Central heating and radiator upgrades',
        'Emergency leak and burst pipe callouts',
        'Bathroom plumbing and shower installations',
        'Landlord Gas Safety Certificates',
      ],
      locations: ['local area and surrounding regions'],
      specialties: 'Gas Safe registered, fully insured, 24/7 emergency response, free quotes',
    }
  }

  if (combined.includes('electr') || combined.includes('rewire') || combined.includes('fuse')) {
    return {
      industry: 'Electrical Services',
      coreServices: [
        'Full domestic and commercial rewires',
        'Fuse board and consumer unit upgrades',
        'EV charger installations',
        'Indoor and outdoor lighting design',
        'Electrical safety certificates (EICR)',
      ],
      locations: ['local area and surrounding regions'],
      specialties: 'NICEIC certified, fully insured, emergency fault finding',
    }
  }

  if (combined.includes('paving') || combined.includes('driveway') || combined.includes('landscap') || combined.includes('patio')) {
    return {
      industry: 'Landscaping & Driveways',
      coreServices: [
        'Porcelain and sandstone patios',
        'Block paving and resin driveways',
        'Timber and composite decking',
        'Garden fencing and turfing',
        'Complete garden transformations',
      ],
      locations: ['local area and surrounding regions'],
      specialties: 'Bespoke design, free site surveys, durable sub-base guarantees',
    }
  }

  return {
    industry: 'Professional Services',
    coreServices: [
      'Bespoke client consultations',
      'Free estimates and project quotes',
      'Quality workmanship and installations',
    ],
    locations: ['the local area and surrounding regions'],
    specialties: 'Fully insured, certified, and guaranteed work',
  }
}

/** Extract structured facts from scraped knowledge text */
const parseScrapedKnowledge = (factsText: string) => {
  const services: string[] = []
  const locations: string[] = []
  const paragraphs: string[] = []

  const lines = factsText.split('\n')
  for (const line of lines) {
    if (line.startsWith('Services & Offerings:')) {
      const items = line.replace('Services & Offerings:', '').split(';')
      for (const item of items) {
        const clean = item.trim()
        if (clean.length > 3) services.push(clean)
      }
    } else if (line.startsWith('Service Areas:')) {
      const locs = line.replace('Service Areas:', '').split(',')
      for (const l of locs) {
        const clean = l.trim()
        if (clean.length > 2) locations.push(clean)
      }
    } else if (line.startsWith('About Details:') || line.startsWith('Overview:')) {
      paragraphs.push(line.replace(/^(About Details:|Overview:)/, '').trim())
    }
  }

  return { services, locations, paragraphs }
}

/** Attempt ultra-fast LLM generation via Anthropic Claude 3.5 Haiku */
const generateAiAnswer = async (
  speech: string,
  company: string,
  contact: string,
  knowledgeContext: string
): Promise<string | null> => {
  try {
    const apiKey =
      process.env.ANTHROPIC_API_KEY ||
      (typeof Netlify !== 'undefined' ? (Netlify as any).env?.get('ANTHROPIC_API_KEY') : '')
    if (!apiKey) return null

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 1100)

    const prompt = `You are Echo, the friendly, professional, 24/7 AI telephone receptionist answering calls for "${company}".
Owner / Contact Person: "${contact}".

KNOWLEDGE BASE ABOUT ${company}:
${knowledgeContext}

CALLER'S QUESTION ON THE PHONE:
"${speech}"

RULES FOR YOUR SPOKEN ANSWER:
1. Respond in 1-2 concise, conversational spoken sentences suitable for a phone call.
2. Directly answer questions about ${company}'s services, products, pricing, location, and bookings based on the knowledge base.
3. If asked about something specific to their business that isn't mentioned, be helpful and offer to take their details or have ${contact} call them back.
4. Speak naturally like a real UK receptionist. Do NOT use bullet points, markdown, or mention you are an AI.`

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
    // Timeout or network error - smoothly falls through to the knowledge engine
  }
  return null
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
    let contact = 'Ian Henry'
    let facts = ''
    let website = ''

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

    // Parse scraped facts and synthesize industry profile
    const parsed = parseScrapedKnowledge(facts)
    const inferred = inferIndustryProfile(company, facts)

    const allServices = [...new Set([...parsed.services, ...inferred.coreServices])]
    const allLocations = [...new Set([...parsed.locations, ...inferred.locations])]
    const knowledgeContext = `Business: ${company}
Owner: ${contact}
Services: ${allServices.join('; ')}
Locations: ${allLocations.join(', ')}
Specialties: ${inferred.specialties}
Website Details: ${facts}`

    let aiReply: string | null = null

    // 1. First priority: Try ultra-fast AI generation with Claude 3.5 Haiku
    if (userSpeech) {
      aiReply = await generateAiAnswer(userSpeech, company, contact, knowledgeContext)
    }

    // 2. Deterministic Knowledge Engine (runs if AI took >1100ms or is unavailable)
    if (!aiReply) {
      const lower = userSpeech.toLowerCase().trim()
      const contactFirst = contact.split(' ')[0].toLowerCase()

      // A. Greetings
      if (
        lower === 'hello' ||
        lower === 'hi' ||
        lower === 'hey' ||
        lower === 'hello echo' ||
        lower === 'good morning' ||
        lower === 'good afternoon'
      ) {
        aiReply = `Hello! I am Echo, the 24/7 AI Receptionist for ${company}. How can I help with your project today?`
      }

      // B. ApexVoice / EchoLift platform explanation
      else if (
        lower.includes('apexvoice') ||
        lower.includes('apex voice') ||
        lower.includes('echolift') ||
        lower.includes('how does this work') ||
        lower.includes('who built you')
      ) {
        aiReply = `ApexVoice is our 24/7 AI voice receptionist platform. It answers calls instantly, answers customer inquiries knowledgeably for ${company}, and books jobs straight into your diary so you never lose leads.`
      }

      // C. Pricing & Quotes (Evaluated BEFORE service search so "how much is X" gives a quote answer)
      else if (
        lower.includes('quote') ||
        lower.includes('cost') ||
        lower.includes('price') ||
        lower.includes('pricing') ||
        lower.includes('estimate') ||
        lower.includes('fee') ||
        lower.includes('how much') ||
        lower.includes('rates')
      ) {
        aiReply = `We provide free, no-obligation quotes for all our work at ${company}. Would you like me to book a quick callback with ${contact} to discuss your project and pricing?`
      }

      // D. Location & Service Area
      else if (
        lower.includes('where') ||
        lower.includes('location') ||
        lower.includes('based') ||
        lower.includes('area') ||
        lower.includes('cover') ||
        lower.includes('travel') ||
        lower.includes('address')
      ) {
        const locStr = allLocations.length ? allLocations.slice(0, 3).join(', ') : 'the local area and surrounding regions'
        aiReply = `${company} is based in and serves ${locStr}. Where is your property located?`
      }

      // E. Availability & Scheduling
      else if (
        lower.includes('when can you start') ||
        lower.includes('availability') ||
        lower.includes('available') ||
        lower.includes('book') ||
        lower.includes('how soon') ||
        lower.includes('tomorrow') ||
        lower.includes('this week') ||
        lower.includes('next week')
      ) {
        aiReply = `We can check our diary and get an appointment or site visit scheduled for you at ${company}. Would you like me to have ${contact} call you back to confirm a date?`
      }

      // F. Insurance, Guarantees, Gas Safe, Accreditations
      else if (
        lower.includes('insured') ||
        lower.includes('insurance') ||
        lower.includes('guarantee') ||
        lower.includes('guaranteed') ||
        lower.includes('warranty') ||
        lower.includes('certified') ||
        lower.includes('gas safe')
      ) {
        if (inferred.industry.includes('Plumbing') || facts.toLowerCase().includes('gas safe')) {
          aiReply = `Yes, all our engineers at ${company} are fully Gas Safe registered and our work is backed by comprehensive insurance and warranties.`
        } else {
          aiReply = `Yes, all our work at ${company} is fully guaranteed and backed by comprehensive public liability insurance for complete peace of mind.`
        }
      }

      // G. Speak to Owner / Human
      else if (
        lower.includes('speak to') ||
        lower.includes('real person') ||
        lower.includes('talk to') ||
        lower.includes('human') ||
        lower.includes(contact.toLowerCase()) ||
        lower.includes(contactFirst)
      ) {
        aiReply = `Of course! I will pass your message directly to ${contact} right away. What is the best number and time to reach you on?`
      }

      // H. "What do you do" / Core Services Overview
      else if (
        lower.includes('service') ||
        lower.includes('what do you do') ||
        lower.includes('what services') ||
        lower.includes('tell me about your business')
      ) {
        const servicesList = allServices.slice(0, 3).join(', ')
        aiReply = `At ${company}, we specialize in ${servicesList}. How can we help with your upcoming project?`
      }

      // I. Specific Service Match (Scored against all company services)
      else {
        let bestService: string | null = null
        let maxScore = 0

        for (const s of allServices) {
          const words = s.toLowerCase().split(/[\s,]+/)
          let score = 0
          for (const w of words) {
            if (w.length > 3 && lower.includes(w)) {
              score += 1
            }
          }
          if (score > maxScore && score >= 1) {
            maxScore = score
            bestService = s
          }
        }

        if (bestService) {
          aiReply = `Yes! At ${company} we provide professional ${bestService.toLowerCase()}. Would you like to get a free quote or book a callback with ${contact}?`
        } else {
          // J. Scraped Paragraph Search
          let paragraphMatch: string | null = null
          for (const p of parsed.paragraphs) {
            const pWords = lower.replace(/[^a-z0-9 ]/g, '').split(' ').filter((w) => w.length > 3)
            const matches = pWords.filter((w) => p.toLowerCase().includes(w)).length
            if (matches >= 2) {
              paragraphMatch = p.split(/(?<=[.!?])\s+/)[0]
              break
            }
          }

          if (paragraphMatch) {
            aiReply = `According to our records at ${company}, ${paragraphMatch}. Would you like me to have ${contact} follow up with full details?`
          } else {
            // K. Attentive Receptionist Fallback
            aiReply = `That sounds like a great project for ${company}. I can take down your details or have ${contact} call you back today with all the information. Would you like me to arrange that?`
          }
        }
      }
    }

    const audioUrl = `https://www.echoliftai.co.uk/api/instant-ai-voice-stream?text=${encodeURIComponent(aiReply)}`
    const pIdStr = prospectId ? String(prospectId) : ''

    // Pre-warm the synthesized audio in background so Twilio receives it instantly
    fetch(audioUrl).catch((e) => console.warn('Prewarm reply audio warning:', e))

    // Nest <Play> inside <Gather> for instant speech recognition & zero transition latency
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" action="https://www.echoliftai.co.uk/api/instant-ai-voice-reply?prospectId=${pIdStr}" speechTimeout="auto" timeout="4" hints="services, quote, pricing, cost, location, contact, phone, appointments, bookings, hours, emergency">
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
