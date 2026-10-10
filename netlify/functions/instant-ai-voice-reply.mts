import type { Config } from '@netlify/functions'
import { findProspect } from './lib/apexvoice.mts'

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
    console.log(`🎤 Twilio Phone Speech Input for prospect ${prospectId}: "${userSpeech}"`)

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

    let aiReply = `Thank you for calling ${company}. How can I assist you with your project today?`

    if (userSpeech) {
      const lower = userSpeech.toLowerCase().trim()

      if (lower === 'hello' || lower === 'hi' || lower === 'hey' || lower === 'hello echo') {
        aiReply = `Hello! I am Echo, your 24/7 AI Receptionist for ${company}. How can I help you today?`
      } else if (lower.includes('apexvoice') || lower.includes('apex voice') || lower.includes('echolift')) {
        aiReply = `ApexVoice is our 24/7 AI voice receptionist platform. It answers missed calls, responds to customer inquiries, and books jobs straight into your schedule so you never lose leads.`
      } else if (lower.includes('quote') || lower.includes('cost') || lower.includes('price') || lower.includes('estimate') || lower.includes('fee') || lower.includes('how much')) {
        aiReply = `We offer free customized quotes for all our work at ${company}. Would you like me to book a short callback with ${contact}?`
      } else if (lower.includes('where') || lower.includes('location') || lower.includes('based') || lower.includes('area') || lower.includes('address')) {
        aiReply = `${company} serves customers across the UK. How can we help with your upcoming project?`
      } else if (lower.includes('service') || lower.includes('do') || lower.includes('offer') || lower.includes('provide') || lower.includes('work') || lower.includes('what do you do') || lower.includes('tell me about')) {
        if (company.toLowerCase().includes('concreet')) {
          aiReply = `At Concreet, we specialize in microcement wall and floor finishes, polished concrete overlays, and bespoke surface design. How can we help with your project today?`
        } else if (facts && facts.length > 30) {
          const cleanFacts = facts.replace(/Company Overview:\s*/i, '').split('.')[0].trim()
          aiReply = `At ${company}, we specialize in ${cleanFacts.slice(0, 120)}. Is there a specific service you would like to ask about?`
        } else {
          aiReply = `At ${company}, we provide professional trade and surface design services tailored to your needs. How can we assist you today?`
        }
      } else {
        aiReply = `Thank you for asking about ${company}! I will make sure ${contact} receives your message. Is there anything else I can help with?`
      }
    }

    const audioUrl = `https://www.echoliftai.co.uk/api/instant-ai-voice-stream?text=${encodeURIComponent(aiReply)}`
    const pIdStr = prospectId ? String(prospectId) : ''

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Play>${audioUrl}</Play>
  <Gather input="speech" action="https://www.echoliftai.co.uk/api/instant-ai-voice-reply?prospectId=${pIdStr}" speechTimeout="auto" timeout="4" hints="concreet, microcement, apexvoice, echolift, services, quote, pricing, cost, location, contact, phone">
  </Gather>
</Response>`

    return new Response(twiml, {
      headers: {
        'Content-Type': 'text/xml',
      },
    })
  } catch (err: any) {
    console.error('Unhandled instant-ai-voice-reply exception:', err)
    const fallbackText = 'Thank you for calling. Please leave your name and number and we will call you back shortly.'
    const fallbackAudio = `https://www.echoliftai.co.uk/api/instant-ai-voice-stream?text=${encodeURIComponent(fallbackText)}`
    const fallbackTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Play>${fallbackAudio}</Play>
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
