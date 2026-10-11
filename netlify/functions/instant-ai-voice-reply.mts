import type { Config } from '@netlify/functions'
import { findProspect } from './lib/apexvoice.mts'

/** Clean and split scraped website text into authoritative factual sentences */
const extractSentences = (text: string): string[] => {
  if (!text) return []
  const cleaned = text
    .replace(/^Website Scraped Facts:\s*/i, '')
    .replace(/^Company Overview:\s*/i, '')
    .replace(/^Overview:\s*/i, '')
    .replace(/undefined/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  return cleaned
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => {
      if (s.length < 20 || s.length > 250) return false
      const lower = s.toLowerCase()
      return (
        !lower.includes('cookie') &&
        !lower.includes('privacy policy') &&
        !lower.includes('copyright') &&
        !lower.includes('all rights reserved') &&
        !lower.includes('diagnostic') &&
        !lower.includes('sign in') &&
        !lower.includes('login')
      )
    })
}

/** Dynamic semantic matcher: finds the best factual answer from scraped website text */
const findBestFactMatch = (speech: string, sentences: string[]): string | null => {
  if (sentences.length === 0) return null
  const speechWords = speech
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !['what', 'when', 'where', 'which', 'your', 'have', 'with', 'about', 'tell'].includes(w))

  if (speechWords.length === 0) return null

  let bestSentence: string | null = null
  let maxScore = 0

  for (const sentence of sentences) {
    const sLower = sentence.toLowerCase()
    let score = 0
    for (const word of speechWords) {
      if (sLower.includes(word)) {
        score += 1
      }
    }
    if (score > maxScore && score >= 2) {
      maxScore = score
      bestSentence = sentence
    }
  }

  return bestSentence
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

    if (prospectId) {
      try {
        const prospect = await findProspect(prospectId)
        if (prospect) {
          company = prospect.business_name || company
          contact = prospect.contact_person || contact
          facts = prospect.pain_points || facts
        }
      } catch (err) {
        console.error('Error loading prospect for speech reply:', err)
      }
    }

    const isConcreet =
      company.toLowerCase().includes('concreet') ||
      facts.toLowerCase().includes('microcement') ||
      facts.toLowerCase().includes('concrete')

    let aiReply = `Thank you for calling ${company}. How can I assist you with your project today?`

    if (userSpeech) {
      const lower = userSpeech.toLowerCase().trim()
      const sentences = extractSentences(facts)

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

      // 2. APEXVOICE / ECHOLIFT PLATFORM INQUIRIES
      else if (
        lower.includes('apexvoice') ||
        lower.includes('apex voice') ||
        lower.includes('echolift') ||
        lower.includes('how does this work') ||
        lower.includes('how do you work') ||
        lower.includes('who built you')
      ) {
        aiReply = `ApexVoice is our 24/7 AI voice receptionist platform. It answers calls instantly, answers customer inquiries knowledgeably, and books appointments straight into your diary so you never lose leads.`
      }

      // 3. CONCREET & MICROCEMENT DOMAIN KNOWLEDGE
      else if (
        isConcreet &&
        (lower.includes('bathroom') ||
          lower.includes('shower') ||
          lower.includes('wet room') ||
          lower.includes('wetroom') ||
          lower.includes('water') ||
          lower.includes('moisture'))
      ) {
        aiReply = `Yes! Microcement is 100% waterproof and completely seamless with no grout lines, making it perfect for luxury bathrooms, walk-in showers, and wet rooms. Would you like to discuss a project?`
      } else if (
        isConcreet &&
        (lower.includes('tile') ||
          lower.includes('tiles') ||
          lower.includes('existing surface') ||
          lower.includes('rip out') ||
          lower.includes('substrate') ||
          lower.includes('plasterboard') ||
          lower.includes('wood') ||
          lower.includes('timber'))
      ) {
        aiReply = `Yes, microcement can be applied directly over existing tiles, concrete, timber, and plasterboard without the mess or cost of ripping old tiles out.`
      } else if (
        isConcreet &&
        (lower.includes('durable') ||
          lower.includes('durability') ||
          lower.includes('crack') ||
          lower.includes('scratch') ||
          lower.includes('stain') ||
          lower.includes('tough') ||
          lower.includes('wear') ||
          lower.includes('longevity'))
      ) {
        aiReply = `Microcement is exceptionally tough, flexible, and crack-resistant. It is sealed with a heavy-duty polyurethane coating that resists stains, scratches, and daily wear.`
      } else if (
        isConcreet &&
        (lower.includes('kitchen') ||
          lower.includes('worktop') ||
          lower.includes('countertop') ||
          lower.includes('island') ||
          lower.includes('splashback'))
      ) {
        aiReply = `Yes, we craft bespoke seamless microcement kitchen worktops, splashbacks, and islands that are heat-resistant, hygienic, and completely grout-free.`
      } else if (
        isConcreet &&
        (lower.includes('floor') ||
          lower.includes('floors') ||
          lower.includes('underfloor') ||
          lower.includes('heating') ||
          lower.includes('cold'))
      ) {
        aiReply = `Yes, microcement makes stunning seamless floors. It feels warm underfoot and is fully compatible with underfloor heating without any risk of cracking.`
      } else if (
        isConcreet &&
        (lower.includes('how long') ||
          lower.includes('timescale') ||
          lower.includes('duration') ||
          lower.includes('days') ||
          lower.includes('time frame') ||
          lower.includes('take to install'))
      ) {
        aiReply = `A typical microcement installation takes around three to five days from surface preparation to the final protective sealing.`
      } else if (
        isConcreet &&
        (lower.includes('color') ||
          lower.includes('colour') ||
          lower.includes('colours') ||
          lower.includes('colors') ||
          lower.includes('finish') ||
          lower.includes('finishes') ||
          lower.includes('texture') ||
          lower.includes('sample'))
      ) {
        aiReply = `We offer an extensive range of colours, tones, and textures, from smooth contemporary polished concrete to rustic, textured stone finishes.`
      } else if (
        isConcreet &&
        (lower.includes('clean') ||
          lower.includes('maintain') ||
          lower.includes('maintenance') ||
          lower.includes('soap') ||
          lower.includes('mould') ||
          lower.includes('care'))
      ) {
        aiReply = `Microcement is very easy to look after. Just clean with warm water and a neutral pH soap. With zero grout lines, there is nowhere for mould or dirt to hide.`
      } else if (
        isConcreet &&
        (lower.includes('what is microcement') ||
          lower.includes('what is it') ||
          lower.includes('what do you mean') ||
          lower.includes('tell me about microcement'))
      ) {
        aiReply = `Microcement is a polymer-modified decorative cement overlay applied at just two to three millimetres thick, giving you the luxury look of polished concrete on walls, floors, and surfaces.`
      }

      // 4. GENERAL TRADE DOMAINS (FOR PROSPECT SITES)
      else if (
        lower.includes('boiler') ||
        lower.includes('central heating') ||
        lower.includes('radiator') ||
        lower.includes('gas safe') ||
        lower.includes('heating engineer')
      ) {
        aiReply = `We cover all aspects of boiler installations, servicing, central heating, and repairs, and our engineers are fully Gas Safe registered. Would you like to book a visit?`
      } else if (
        lower.includes('rewire') ||
        lower.includes('fuse box') ||
        lower.includes('consumer unit') ||
        lower.includes('ev charger') ||
        lower.includes('electrician') ||
        lower.includes('electrical')
      ) {
        aiReply = `We handle full domestic and commercial electrical work, including rewires, fuse boards, EV chargers, and certified safety inspections. How can we help?`
      } else if (
        lower.includes('roof') ||
        lower.includes('roofing') ||
        lower.includes('flat roof') ||
        lower.includes('gutter') ||
        lower.includes('slate') ||
        lower.includes('chimney') ||
        lower.includes('roof leak')
      ) {
        aiReply = `We specialize in all roofing work, from complete re-roofs and modern flat roof systems to leak repairs, tile replacements, and gutters.`
      } else if (
        lower.includes('patio') ||
        lower.includes('driveway') ||
        lower.includes('paving') ||
        lower.includes('landscaping') ||
        lower.includes('fencing') ||
        lower.includes('turf') ||
        lower.includes('decking')
      ) {
        aiReply = `We design and install bespoke porcelain patios, block paving driveways, fencing, and complete garden transformations. Would you like a free quote?`
      } else if (
        lower.includes('emergency') ||
        lower.includes('urgent') ||
        lower.includes('burst pipe') ||
        lower.includes('leak') ||
        lower.includes('call out') ||
        lower.includes('callout') ||
        lower.includes('24/7')
      ) {
        aiReply = `We prioritize urgent repairs and emergency callouts. Would you like me to alert ${contact} to call you back right away?`
      }

      // 5. PRICING & QUOTES
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
        aiReply = `We provide free, no-obligation quotes tailored to your exact project at ${company}. Would you like me to book a quick callback or site survey with ${contact}?`
      }

      // 6. LOCATION & TRAVEL
      else if (
        lower.includes('where') ||
        lower.includes('location') ||
        lower.includes('based') ||
        lower.includes('area') ||
        lower.includes('cover') ||
        lower.includes('travel') ||
        lower.includes('address')
      ) {
        if (isConcreet) {
          aiReply = `We are based in Newcastle and the North East, and we carry out bespoke microcement projects nationwide across the UK. Where is your project located?`
        } else {
          aiReply = `${company} serves customers across the local area and surrounding regions. Where is your project located?`
        }
      }

      // 7. AVAILABILITY & SCHEDULING
      else if (
        lower.includes('when can you start') ||
        lower.includes('availability') ||
        lower.includes('available') ||
        lower.includes('next week') ||
        lower.includes('book a date') ||
        lower.includes('how soon')
      ) {
        aiReply = `We can check our current diary and arrange a consultation or survey for you. Would you like me to have ${contact} call you back to confirm available dates?`
      }

      // 8. INSURANCE & GUARANTEES
      else if (
        lower.includes('insured') ||
        lower.includes('insurance') ||
        lower.includes('guarantee') ||
        lower.includes('guaranteed') ||
        lower.includes('warranty')
      ) {
        aiReply = `Yes, all our work is fully guaranteed, and we carry comprehensive public liability insurance for complete peace of mind.`
      }

      // 9. SPEAK TO OWNER / HUMAN CALLBACK
      else if (
        lower.includes('speak to someone') ||
        lower.includes('real person') ||
        lower.includes('talk to') ||
        lower.includes('speak with') ||
        lower.includes('human') ||
        lower.includes(contact.toLowerCase())
      ) {
        aiReply = `Of course! I will pass your message directly to ${contact} right away. What is the best number and time to reach you on?`
      }

      // 10. WHAT DO YOU DO / SERVICES OVERVIEW
      else if (
        lower.includes('service') ||
        lower.includes('what do you do') ||
        lower.includes('what services') ||
        lower.includes('tell me what you do') ||
        lower.includes('tell me about your business')
      ) {
        if (isConcreet) {
          aiReply = `At Concreet, we specialize in luxury microcement wall and floor finishes, seamless bathrooms, kitchen worktops, and polished concrete design. How can we help today?`
        } else {
          const matchedFact = findBestFactMatch(userSpeech, sentences)
          if (matchedFact) {
            aiReply = `At ${company}, ${matchedFact} How can we help with your upcoming project?`
          } else {
            aiReply = `At ${company}, we deliver high-quality professional services tailored to your needs. Would you like to discuss a specific project or get a free quote?`
          }
        }
      }

      // 11. DYNAMIC MATCHING AGAINST SCRAPED WEBSITE FACTS
      else {
        const dynamicFact = findBestFactMatch(userSpeech, sentences)
        if (dynamicFact) {
          aiReply = `According to our website, ${dynamicFact}. Would you like me to have ${contact} follow up with full details?`
        } else {
          // Attentive, professional receptionist response instead of generic brush-off
          aiReply = `That sounds like a great project for ${company}. I can take your details or have ${contact} call you back today with all the information. Would you like me to arrange that?`
        }
      }
    }

    const audioUrl = `https://www.echoliftai.co.uk/api/instant-ai-voice-stream?text=${encodeURIComponent(aiReply)}`
    const pIdStr = prospectId ? String(prospectId) : ''

    // Pre-warm the synthesized audio in the background so Twilio receives it instantly
    fetch(audioUrl).catch((e) => console.warn('Prewarm reply audio warning:', e))

    // Nest <Play> inside <Gather> to enable immediate speech recognition & zero transition latency
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" action="https://www.echoliftai.co.uk/api/instant-ai-voice-reply?prospectId=${pIdStr}" speechTimeout="auto" timeout="4" hints="concreet, microcement, apexvoice, echolift, services, quote, pricing, cost, location, contact, phone, bathrooms, wet rooms, showers, kitchen, worktop, floors, tiles, durable, waterproof, timescale">
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
