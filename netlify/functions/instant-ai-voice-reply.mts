import type { Config } from '@netlify/functions'
import { db, findProspect, type ProspectRow } from './lib/apexvoice.mts'

const VOICE_ID = 'b6T2IrWoTx7ZIb3BHJSg' // North East UK female voice
const VOICE_STREAM_BASE = 'https://www.echoliftai.co.uk/api/instant-ai-voice-stream'

const makeAudioUrl = (text: string) => {
  return `${VOICE_STREAM_BASE}?voiceId=${VOICE_ID}&text=${encodeURIComponent(text)}`
}

/**
 * Intelligent domain expert engine for Ready-Mix Concrete Order Desk
 * Answers mix queries, volume calculations, pricing, delivery, discharge & booking
 */
export const answerConcreteOrderQuery = (speech: string): string => {
  const lower = speech.toLowerCase().trim()

  // 1. GREETINGS
  if (
    lower === 'hello' ||
    lower === 'hi' ||
    lower === 'hey' ||
    lower === 'good morning' ||
    lower === 'good afternoon' ||
    lower.includes('is this the concrete') ||
    lower.includes('is this concrete')
  ) {
    return "Hello love! Thanks for calling the concrete order desk. How can I help you with your concrete mix, quantity or delivery today?"
  }

  // 2. VOLUME / MEASUREMENT CALCULATION IN SPEECH
  // Look for patterns like "6 by 4 by 100", "5 metres by 3 metres by 150mm", "4m x 3m x 0.1m"
  const dimMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?:m|metres?|meters?)?\s*(?:by|x|\*)\s*(\d+(?:\.\d+)?)\s*(?:m|metres?|meters?)?(?:\s*(?:by|x|\*)\s*(\d+(?:\.\d+)?)\s*(?:m|metres?|mm|milli?metres?|cm)?)?/)
  if (dimMatch && (lower.includes('cube') || lower.includes('volume') || lower.includes('measure') || lower.includes('need') || lower.includes('area') || lower.includes('deep') || lower.includes('thick'))) {
    const l = parseFloat(dimMatch[1])
    const w = parseFloat(dimMatch[2])
    let d = dimMatch[3] ? parseFloat(dimMatch[3]) : 0.1 // default 100mm (0.1m) if omitted
    if (d >= 20) d = d / 1000 // Convert mm to metres (e.g. 100mm -> 0.1m)
    else if (d >= 5 && d < 20) d = d / 100 // Convert cm to metres

    if (l > 0 && w > 0 && d > 0 && l < 100 && w < 100) {
      const rawCubes = l * w * d
      const recommendedCubes = (rawCubes * 1.1).toFixed(1)
      const exactCubes = rawCubes.toFixed(1)
      return `For ${l} by ${w} at roughly ${Math.round(d * 1000)} millimetres deep, that comes out at about ${exactCubes} cubic metres. With ten percent extra for trench dips and ground variation, you'll want ${recommendedCubes} cubes love. What mix are you after?`
    }
  }

  // General volume calculation advice
  if (
    lower.includes('calculate') ||
    lower.includes('how do i work out') ||
    lower.includes('how many cubes') ||
    lower.includes('how many metres') ||
    lower.includes('measure')
  ) {
    return "To calculate your cubes love, just multiply your length by width by depth in metres, and add ten percent for trench dips. If you tell me your measurements now, I can work it out for you straight away!"
  }

  // 3. PRICING & QUOTES (Checked before mix explanations so "how much is C25" quotes price)
  const isPricingQuery = lower.includes('price') || lower.includes('cost') || lower.includes('how much') || lower.includes('rate') || lower.includes('quote') || lower.includes('estimate')
  
  // Specific volume with price (e.g. "how much for 6 cubes of C25")
  const cubeMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?:cubes?|metres?|meters?|m3)/)
  if (cubeMatch && isPricingQuery) {
    const qty = parseFloat(cubeMatch[1])
    const estMin = Math.round(qty * 115)
    const estMax = Math.round(qty * 130)
    let mixMention = ''
    if (lower.includes('c30') || lower.includes('rc30')) mixMention = ' of C30'
    else if (lower.includes('c25') || lower.includes('rc25')) mixMention = ' of C25'
    else if (lower.includes('c20') || lower.includes('gen 3')) mixMention = ' of C20'
    return `For ${qty} cubes${mixMention}, you're looking around £${estMin} to £${estMax} plus VAT delivered on an eight-wheeler truck. Whereabouts is the delivery going love?`
  }

  if (isPricingQuery) {
    return "Ready-mix concrete is typically around £115 to £130 a cube depending on your mix grade and delivery location, delivered on an eight-wheeler mixer. What mix and delivery postcode are you looking for love?"
  }

  // Part load / minimum load fees
  if (lower.includes('part load') || lower.includes('minimum load') || lower.includes('small load')) {
    return "Our standard eight-wheelers carry up to 8 cubic metres, and there is just a small part-load charge for orders under 4 cubes. How many cubic metres are you needing love?"
  }

  // 4. MIX RECOMMENDATIONS BY APPLICATION
  // Driveways
  if (lower.includes('drive') || lower.includes('driveway') || lower.includes('car')) {
    return "For a domestic driveway you'll want RC30 or C30 love, nice and hard-wearing to take vehicle weights and frost. How many cubic metres are you needing?"
  }

  // Garage Floor / Slab
  if (lower.includes('garage') || lower.includes('workshop')) {
    return "For a garage floor slab, C25 or C30 is spot on love, usually laid 100 to 150 mil thick with a tamp or trowel finish. How many cubes were you looking for?"
  }

  // Foundations / Footings / Trenches
  if (
    lower.includes('footing') ||
    lower.includes('foundation') ||
    lower.includes('trench') ||
    lower.includes('underpin') ||
    lower.includes('extension')
  ) {
    return "For standard domestic footings and strip foundations, Gen 3 or C20 is standard, or C25 if you've got heavier ground. Have you got your trench measurements handy?"
  }

  // Patio / Paving / Paths / Garden
  if (
    lower.includes('patio') ||
    lower.includes('paving') ||
    lower.includes('path') ||
    lower.includes('garden') ||
    lower.includes('slab')
  ) {
    return "For a garden patio base or pathway, C20 or Gen 3 at 100 mil thick is ideal love. What are your length and width measurements?"
  }

  // Shed Base
  if (lower.includes('shed') || lower.includes('summer house') || lower.includes('greenhouse')) {
    return "A shed base is grand with C20 or Gen 3 concrete, normally poured 100 millimetres thick on hardcore. How long and wide is the base love?"
  }

  // Floor Screed / Underfloor Heating
  if (lower.includes('screed') || lower.includes('underfloor')) {
    return "We supply standard 4-to-1 semi-dry floor screed, and fibre screed for underfloor heating. How many square metres is the floor love?"
  }

  // Agricultural / Heavy Commercial / Farm
  if (lower.includes('farm') || lower.includes('agricultural') || lower.includes('silage') || lower.includes('commercial yard')) {
    return "For agricultural yards or heavy plant access, you'll need RC35 or C40 concrete for high abrasion resistance. What size area are you pouring love?"
  }

  // Slump / Workability
  if (lower.includes('slump') || lower.includes('workability') || lower.includes('wet') || lower.includes('dry')) {
    return "We supply standard S3 slump which is perfect for barrowing and raking, or we can add plasticiser if you need it flowing easily into foundations. How are you placing it love?"
  }

  // Curing / Setting time
  if (lower.includes('cure') || lower.includes('curing') || lower.includes('dry') || lower.includes('setting time') || lower.includes('walk on')) {
    return "Ready-mix takes its initial set in about two to three hours. You can walk on it carefully after 24 to 48 hours, and it reaches full design strength after 28 days."
  }

  // Explaining specific mix grades (C20, C25, C30, Gen 1, Gen 3)
  if (lower.includes('c20') || lower.includes('gen 3') || lower.includes('gen3')) {
    return "C20, or Gen 3, is a 20-Newton mix ideal for domestic foundations, patio slabs, and unreinforced floors. How many cubic metres do you need love?"
  }
  if (lower.includes('c25') || lower.includes('rc25')) {
    return "C25 is our most popular 25-Newton versatile mix for house extensions, footings, and garage floors. How many cubes are you looking to order?"
  }
  if (lower.includes('c30') || lower.includes('rc30')) {
    return "C30 is a high-strength 30-Newton mix designed for external paving, driveways, and reinforced slabs. Whereabouts is your delivery going?"
  }
  if (lower.includes('what mix') || lower.includes('which mix') || lower.includes('mix do i need')) {
    return "It depends on the job love! For driveways we recommend C30, for garage floors C25, and for foundations or patios C20 or Gen 3. What are you pouring?"
  }

  // 5. BOOKING AN ORDER & COLLECTING DETAILS
  if (
    lower.includes('book') ||
    lower.includes('order') ||
    lower.includes('place an order') ||
    lower.includes('put me down') ||
    lower.includes('arrange')
  ) {
    return "Grand! To get that booked in, I just need your delivery address or postcode, the date you want it, whether you want morning or afternoon slot, and your contact name."
  }

  // Detecting if caller provided delivery address, postcode, date, or contact details
  const hasPostcodeOrTown = /\b(?:[a-z]{1,2}\d[a-z\d]?\s*\d[a-z]{2}|ne\d{1,2}|dh\d{1,2}|sr\d{1,2}|ts\d{1,2}|dl\d{1,2}|ca\d{1,2}|newcastle|gateshead|sunderland|durham|darlington|middlesbrough|stockton|hartlepool|south shields|north shields|blyth|cramlington|hexham|morpeth|consett|chester-le-street)\b/i.test(lower)
  const hasStreetOrRoad = /\b(?:street|st\b|road|rd\b|avenue|ave\b|lane|close|way|drive|crescent)\b/i.test(lower)
  const hasDay = /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|tomorrow|next week)\b/i.test(lower)

  if (hasPostcodeOrTown || hasStreetOrRoad || (hasDay && (lower.includes('morning') || lower.includes('afternoon') || lower.includes('slot')))) {
    return "Spot on love, I've got those details noted down for dispatch. Ian from the batch plant will ring you back on this number within 15 minutes to confirm your batch time and slot. Is there anything else you need?"
  }

  // 6. DELIVERY, DISCHARGE, CHUTES, BARROWING & PUMPS
  if (lower.includes('barrow') || lower.includes('wheelbarrow') || lower.includes('discharge time') || lower.includes('waiting time')) {
    return "You get 30 minutes free discharge time included with each load for barrowing love. It's best to have two or three good lads on barrows to get it offloaded before waiting time kicks in."
  }

  if (lower.includes('pump') || lower.includes('pumping') || lower.includes('boom pump') || lower.includes('line pump')) {
    return "If access is tight, over 10 metres, or through a house, we can book a ground line pump or boom pump for you so it goes straight in without any barrowing. Would you like a pump quote love?"
  }

  if (lower.includes('chute') || lower.includes('reach') || lower.includes('access') || lower.includes('truck size') || lower.includes('how big')) {
    return "The mixer trucks carry up to 8 cubic metres and have chutes on the back reaching about two and a half metres. The truck is about 3 metres wide, so make sure there's clear access into your drive or site."
  }

  if (lower.includes('delivery') || lower.includes('deliver') || lower.includes('time slot') || lower.includes('morning') || lower.includes('afternoon') || lower.includes('when can you')) {
    return "We deliver from 7:30am with first load morning slots or afternoon deliveries across the North East and UK-wide. What date were you hoping for love?"
  }

  // 7. SPEAK TO HUMAN / IAN / MANAGER
  if (
    lower.includes('speak to') ||
    lower.includes('talk to') ||
    lower.includes('human') ||
    lower.includes('person') ||
    lower.includes('ian') ||
    lower.includes('manager')
  ) {
    return "No trouble at all love! I'll put a message straight through to Ian at dispatch, and he'll give you a buzz back on this number right away. Have a grand day!"
  }

  // 8. ECHOLIFT / MIXERSHARE / TECH META
  if (lower.includes('mixershare') || lower.includes('echolift') || lower.includes('ai sales agent') || lower.includes('who are you')) {
    return "I am the AI Concrete Sales Agent for MixerShare and ready-mix batch plants! I take orders, advise on mixes, calculate cubes, and book deliveries 24/7. How can I help you today love?"
  }

  // 9. DEFAULT HELPFUL READY-MIX REPLY
  return "We supply all grades of ready-mix concrete, floor screed, and truck mixer deliveries across the North East and UK-wide via mixershare.co.uk. How can I help with your project today love?"
}

export default async (req: Request) => {
  try {
    const url = new URL(req.url)
    const isReplyStep = url.searchParams.get('step') === 'reply'
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
    console.log(`🎤 Twilio Speech Input (step=${isReplyStep ? 'reply' : 'init'}, prospectId=${prospectId}): "${userSpeech}"`)

    let spokenText = ''

    // CASE 1: Initial call arrival (no speech result yet & not a reply turn)
    if (!isReplyStep && (!userSpeech || userSpeech.length === 0)) {
      spokenText = "Hello love! Thanks for calling the concrete order desk. How can I help you with your concrete mix, quantity or delivery today?"
    }
    // CASE 2: Caller remained silent on a reply turn
    else if (isReplyStep && (!userSpeech || userSpeech.length === 0)) {
      spokenText = "Are you still there love? I'm here to help with your concrete mix, quantity or delivery quote whenever you're ready."
    }
    // CASE 3: Caller spoke! Answer using Ready-Mix Concrete Order Desk Engine
    else {
      spokenText = answerConcreteOrderQuery(userSpeech)
    }

    const audioUrl = makeAudioUrl(spokenText)
    const followupText = "Are you still there love? I'm here to help with your concrete mix, quantity or delivery quote whenever you're ready."
    const followupAudio = makeAudioUrl(followupText)
    const goodbyeText = "No trouble at all love. If you need any concrete advice or want to book an order later, give us a ring back on 0191 406 2323 or visit mixershare.co.uk. Have a grand day!"
    const goodbyeAudio = makeAudioUrl(goodbyeText)

    const pIdParam = prospectId ? `&prospectId=${prospectId}` : ''
    const actionUrl = `https://www.echoliftai.co.uk/api/instant-ai-voice-reply?step=reply${pIdParam}`

    // Pre-warm the synthesized audio in background so Twilio receives it instantly
    fetch(audioUrl).catch((e) => console.warn('Prewarm reply audio warning:', e))

    // Strict 4-second maximum limit for silence during speech and pauses
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" action="${actionUrl}" speechTimeout="3" timeout="4" hints="concrete, mix, cubes, metres, delivery, price, quote, C20, C25, C30, gen 1, gen 3, screed, pump, chute, barrow">
    <Play>${audioUrl}</Play>
  </Gather>
  <Gather input="speech" action="${actionUrl}" speechTimeout="3" timeout="4">
    <Play>${followupAudio}</Play>
  </Gather>
  <Play>${goodbyeAudio}</Play>
  <Hangup/>
</Response>`

    return new Response(twiml, {
      headers: {
        'Content-Type': 'text/xml',
      },
    })
  } catch (err: any) {
    console.error('Unhandled instant-ai-voice-reply exception:', err)
    const fallbackText = "Hello love! Thanks for calling the concrete order desk. If you need a quote or want to book, please give us a ring back on 0191 406 2323 or visit mixershare.co.uk. Have a grand day!"
    const fallbackAudio = makeAudioUrl(fallbackText)
    const fallbackTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" action="https://www.echoliftai.co.uk/api/instant-ai-voice-reply?step=reply" speechTimeout="3" timeout="4">
    <Play>${fallbackAudio}</Play>
  </Gather>
  <Hangup/>
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
