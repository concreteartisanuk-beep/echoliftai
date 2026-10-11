import type { Config } from '@netlify/functions'
import { db, findProspect, type ProspectRow } from './lib/apexvoice.mts'

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
    } else {
      // If prospectId is omitted, load the most recent prospect who just requested a live demo
      try {
        const rows = (await db().sql`
          SELECT * FROM apexvoice_prospects ORDER BY id DESC LIMIT 1
        `) as ProspectRow[]
        if (rows[0]) {
          company = rows[0].business_name || company
          contact = rows[0].contact_person || contact
          facts = rows[0].pain_points || facts
          website = rows[0].website || website
        }
      } catch (err) {
        console.error('Error loading latest prospect for speech reply:', err)
      }
    }

    // Parse scraped facts and synthesize industry profile
    const parsed = parseScrapedKnowledge(facts)
    const inferred = inferIndustryProfile(company, facts)

    const allServices = [...new Set([...parsed.services, ...inferred.coreServices])]
    const allLocations = [...new Set([...parsed.locations, ...inferred.locations])]

    const isMicrocementOrConcrete =
      company.toLowerCase().includes('concreet') ||
      facts.toLowerCase().includes('microcement') ||
      facts.toLowerCase().includes('concrete') ||
      inferred.industry.includes('Microcement')

    const lower = userSpeech.toLowerCase().trim()
    const contactFirst = contact.split(' ')[0].toLowerCase()

    let aiReply = ''

    // 1. GREETINGS
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

    // 2. APEXVOICE / ECHOLIFT PLATFORM EXPLANATION
    else if (
      lower.includes('apexvoice') ||
      lower.includes('apex voice') ||
      lower.includes('echolift') ||
      lower.includes('who built you') ||
      lower.includes('what are you')
    ) {
      aiReply = `ApexVoice is our 24/7 AI voice receptionist platform. It answers calls instantly, answers customer inquiries knowledgeably for ${company}, and books jobs straight into your schedule so you never lose leads.`
    }

    // 3. DURABILITY, STRENGTH, CRACKING, SCRATCHING, WEAR
    else if (
      lower.includes('durable') ||
      lower.includes('durability') ||
      lower.includes('crack') ||
      lower.includes('scratch') ||
      lower.includes('stain') ||
      lower.includes('tough') ||
      lower.includes('hard wearing') ||
      lower.includes('wear and tear') ||
      lower.includes('last long') ||
      lower.includes('how long does it last')
    ) {
      if (isMicrocementOrConcrete) {
        aiReply = `It is exceptionally tough, flexible, and crack-resistant. It is sealed with a heavy-duty polyurethane coating that resists stains, scratches, and daily wear.`
      } else {
        aiReply = `All our work and materials at ${company} are built to be extremely durable, heavy-duty, and backed by comprehensive guarantees against wear and defects.`
      }
    }

    // 4. WATERPROOFING, WATER RESISTANCE, BATHROOMS, WET ROOMS, SHOWERS
    else if (
      lower.includes('waterproof') ||
      lower.includes('water proof') ||
      lower.includes('water resistant') ||
      lower.includes('wet room') ||
      lower.includes('wetroom') ||
      lower.includes('shower') ||
      lower.includes('bathroom') ||
      lower.includes('moisture')
    ) {
      if (isMicrocementOrConcrete) {
        aiReply = `Yes! It is 100% waterproof and completely seamless with no grout lines, making it perfect for luxury bathrooms, walk-in showers, and wet rooms.`
      } else if (inferred.industry.includes('Roofing')) {
        aiReply = `Yes, all our roof installations and EPDM rubber flat roofs are 100% waterproof, weather-sealed, and backed by long-term leak-free warranties.`
      } else {
        aiReply = `Yes, we handle complete waterproof installations and bathroom finishes with full seal guarantees.`
      }
    }

    // 5. TILES, EXISTING SURFACES, SUBSTRATES, RIPPING OUT
    else if (
      lower.includes('tile') ||
      lower.includes('tiles') ||
      lower.includes('existing surface') ||
      lower.includes('rip out') ||
      lower.includes('substrate') ||
      lower.includes('plasterboard') ||
      lower.includes('timber') ||
      lower.includes('what can it go on') ||
      lower.includes('what surfaces')
    ) {
      if (isMicrocementOrConcrete) {
        aiReply = `Yes, it can be applied directly over existing tiles, concrete, timber, and plasterboard without the mess or cost of ripping old tiles out.`
      } else {
        aiReply = `Yes, our team works over all standard existing substrates and can advise on the best surface preparation during a site survey.`
      }
    }

    // 6. TIMESCALE, HOW LONG DOES IT TAKE, PROJECT DURATION
    else if (
      lower.includes('how long') ||
      lower.includes('timescale') ||
      lower.includes('duration') ||
      lower.includes('how many days') ||
      lower.includes('time frame') ||
      lower.includes('take to install') ||
      lower.includes('turnaround')
    ) {
      if (isMicrocementOrConcrete) {
        aiReply = `A typical installation takes around three to five days depending on the size of the area and drying times.`
      } else {
        aiReply = `Project timescales depend on the exact job size, but most standard projects are completed within two to four days. Would you like a timescale estimate for your project?`
      }
    }

    // 7. FLOORS, UNDERFLOOR HEATING
    else if (
      lower.includes('floor') ||
      lower.includes('flooring') ||
      lower.includes('underfloor') ||
      lower.includes('cold underfoot')
    ) {
      aiReply = `Yes, it makes stunning seamless floors. It feels warm underfoot and is fully compatible with underfloor heating without any risk of cracking.`
    }

    // 8. KITCHENS, WORKTOPS, COUNTERTOPS, SPLASHBACKS, ISLANDS
    else if (
      lower.includes('kitchen') ||
      lower.includes('worktop') ||
      lower.includes('countertop') ||
      lower.includes('island') ||
      lower.includes('splashback')
    ) {
      aiReply = `Yes, we craft bespoke seamless kitchen worktops, splashbacks, and islands that are heat-resistant, hygienic, and completely grout-free.`
    }

    // 9. COLOURS, FINISHES, TEXTURES, SAMPLES
    else if (
      lower.includes('color') ||
      lower.includes('colour') ||
      lower.includes('colours') ||
      lower.includes('colors') ||
      lower.includes('finish') ||
      lower.includes('finishes') ||
      lower.includes('texture') ||
      lower.includes('sample')
    ) {
      aiReply = `We offer an extensive range of colours, tones, and textures, from smooth contemporary polished finishes to rustic textured mineral effects.`
    }

    // 10. CLEANING, MAINTENANCE, SOAP, MOULD
    else if (
      lower.includes('clean') ||
      lower.includes('maintain') ||
      lower.includes('maintenance') ||
      lower.includes('soap') ||
      lower.includes('mould') ||
      lower.includes('mold') ||
      lower.includes('care for')
    ) {
      aiReply = `It is very easy to look after. Just clean with warm water and a neutral pH soap. With zero grout lines, there is nowhere for mould or dirt to hide.`
    }

    // 11. WHAT IS MICROCEMENT / WHAT IS IT / EXPLANATION
    else if (
      lower.includes('what is microcement') ||
      lower.includes('what is it') ||
      lower.includes('tell me about microcement') ||
      lower.includes('what do you mean by microcement')
    ) {
      aiReply = `Microcement is a polymer-modified decorative cement overlay applied at just two to three millimetres thick, giving you the luxury look of polished concrete on walls, floors, and surfaces.`
    }

    // 12. BOILERS & CENTRAL HEATING
    else if (
      lower.includes('boiler') ||
      lower.includes('central heating') ||
      lower.includes('radiator') ||
      lower.includes('power flush')
    ) {
      aiReply = `Yes, we cover boiler installations, servicing, central heating upgrades, and emergency repairs, and all our engineers are fully Gas Safe registered.`
    }

    // 13. GAS SAFE / SAFETY ACCREDITATIONS
    else if (
      lower.includes('gas safe') ||
      lower.includes('cp12') ||
      lower.includes('landlord certificate')
    ) {
      aiReply = `Yes, all our heating engineers at ${company} are fully Gas Safe registered and our work is backed by certified safety guarantees.`
    }

    // 14. ROOFING & FLAT ROOFS
    else if (
      lower.includes('flat roof') ||
      lower.includes('epdm') ||
      lower.includes('fibreglass roof') ||
      lower.includes('roof leak') ||
      lower.includes('slate roof')
    ) {
      aiReply = `Yes, we specialize in high-performance EPDM flat roofs, slate and tile re-roofs, and emergency leak repairs with long-term guarantees.`
    }

    // 15. DOG GROOMING & PET CARE
    else if (
      lower.includes('nail clipping') ||
      lower.includes('full groom') ||
      lower.includes('bath and blow') ||
      lower.includes('puppy') ||
      lower.includes('deshed')
    ) {
      aiReply = `Yes, we provide gentle 1-to-1 full grooms, bath and blow-dry, nail clipping, and deshedding treatments for all dog breeds.`
    }

    // 16. DENTAL & TEETH WHITENING
    else if (
      lower.includes('teeth whitening') ||
      lower.includes('hygienist') ||
      lower.includes('checkup') ||
      lower.includes('invisalign') ||
      lower.includes('toothache')
    ) {
      aiReply = `Yes, we provide routine dental checkups, hygienist cleans, teeth whitening, and emergency toothache appointments.`
    }

    // 17. PRICING & QUOTES (Checked before service matching so "how much is X" gives a quote answer)
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

    // 18. LOCATION & SERVICE AREA
    else if (
      lower.includes('where are you') ||
      lower.includes('where based') ||
      lower.includes('location') ||
      lower.includes('what area') ||
      lower.includes('do you cover') ||
      lower.includes('do you travel') ||
      lower.includes('address')
    ) {
      const locStr = allLocations.length ? allLocations.slice(0, 3).join(', ') : 'the local area and surrounding regions'
      aiReply = `${company} is based in and serves ${locStr}. Where is your property located?`
    }

    // 19. AVAILABILITY & SCHEDULING
    else if (
      lower.includes('when can you start') ||
      lower.includes('availability') ||
      lower.includes('available') ||
      lower.includes('book an appointment') ||
      lower.includes('book a date') ||
      lower.includes('how soon') ||
      lower.includes('tomorrow') ||
      lower.includes('this week') ||
      lower.includes('next week')
    ) {
      aiReply = `We can check our diary and get an appointment or site survey scheduled for you at ${company}. Would you like me to have ${contact} call you back to confirm a date?`
    }

    // 20. INSURANCE & GUARANTEES
    else if (
      lower.includes('insured') ||
      lower.includes('insurance') ||
      lower.includes('guarantee') ||
      lower.includes('guaranteed') ||
      lower.includes('warranty') ||
      lower.includes('certified')
    ) {
      aiReply = `Yes, all our work at ${company} is fully guaranteed and backed by comprehensive public liability insurance for complete peace of mind.`
    }

    // 21. SPEAK TO OWNER / HUMAN
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

    // 22. ONLY WHEN EXPLICITLY ASKED: "What do you do?" / "What services do you offer?"
    else if (
      lower === 'what do you do' ||
      lower.includes('what do you do') ||
      lower.includes('what services do you offer') ||
      lower.includes('what services do you provide') ||
      lower.includes('tell me what you do') ||
      lower.includes('tell me about your services')
    ) {
      const servicesList = allServices.slice(0, 3).join(', ')
      aiReply = `At ${company}, we specialize in ${servicesList}. How can we help with your upcoming project?`
    }

    // 23. SPECIFIC SUBSTANTIVE SERVICE SEARCH (With strict stop-word filtering & score threshold >= 2)
    else {
      const stopWords = new Set([
        'this', 'that', 'with', 'from', 'your', 'have', 'what', 'when', 'some', 'will',
        'more', 'over', 'good', 'well', 'make', 'time', 'days', 'work', 'care', 'room',
        'like', 'free', 'about', 'just', 'come', 'there', 'here', 'take', 'need', 'want',
        'tell', 'them'
      ])

      let bestService: string | null = null
      let maxScore = 0

      for (const s of allServices) {
        const words = s.toLowerCase().split(/[\s,]+/).filter((w) => w.length > 3 && !stopWords.has(w))
        let score = 0
        for (const w of words) {
          if (lower.includes(w)) {
            score += 1
          }
        }
        if (score > maxScore && score >= 2) {
          maxScore = score
          bestService = s
        }
      }

      if (bestService) {
        aiReply = `Yes! At ${company} we provide professional ${bestService.toLowerCase()}. Would you like to get a free quote or book a callback with ${contact}?`
      } else {
        // Fallback: polite, attentive receptionist callback offer
        aiReply = `That sounds like something we can definitely help with at ${company}. I can take down your details or have ${contact} call you back today with full information. Would you like me to arrange that?`
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
