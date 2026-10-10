import type { Config } from '@netlify/functions'
import { db, findProspect, generateJson, type ProspectRow } from './lib/apexvoice.mts'

export default async (req: Request) => {
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

  let company = 'Your Business'
  let contact = 'there'
  let facts = 'Standard professional services.'

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

  let aiReply = `Thank you for asking about ${company}. How else can I assist you today?`

  if (userSpeech) {
    const lower = userSpeech.toLowerCase().trim()

    // 1. Only standalone brief greetings trigger a simple hello
    if (lower === 'hello' || lower === 'hi' || lower === 'hey' || lower === 'hello echo') {
      aiReply = `Hello! I am Echo, your 24/7 AI Receptionist for ${company}. How can I help you today?`
    } else {
      // 2. AI response generation using scraped factsheet + ApexVoice product knowledge
      const systemPrompt = `You are Echo, the 24/7 AI Receptionist answering phone calls for "${company}".
Greeting used: "Thank you for calling ${company}, my name is Echo, how may I help you?"
Owner: ${contact}

PRODUCT KNOWLEDGE:
ApexVoice / EchoLift AI is a 24/7 AI voice receptionist system that answers missed customer calls in 2 seconds, handles inquiries using custom business facts, and books appointments directly into your calendar.

WEBSITE KNOWLEDGE BASE FOR ${company}:
${facts}

Rules:
1. Answer the caller's question directly in 1-2 natural, spoken sentences (maximum 25 words).
2. If asked about ApexVoice or EchoLift AI, explain how it captures missed calls and books jobs 24/7.
3. Speak in clean, professional, friendly English as an authentic receptionist.
4. Output valid JSON: { "reply": "Your clean spoken response here" }`

      const userPrompt = `Caller asked: "${userSpeech}"`
      const aiRes = await generateJson<{ reply: string }>(systemPrompt, userPrompt, 90)

      if (aiRes && aiRes.reply) {
        aiReply = aiRes.reply.replace(/[#*_`]/g, '').trim()
      } else {
        // Natural fallback answers
        if (lower.includes('apexvoice') || lower.includes('apex voice') || lower.includes('echolift')) {
          aiReply = `ApexVoice is our 24/7 AI voice receptionist platform. It answers missed calls, responds to customer inquiries, and books jobs straight into your schedule so you never lose leads.`
        } else if (lower.includes('service') || lower.includes('do') || lower.includes('offer') || lower.includes('provide') || lower.includes('work')) {
          aiReply = `At ${company}, we provide professional services tailored to our clients' needs. How can we help you with your upcoming project?`
        } else if (lower.includes('quote') || lower.includes('cost') || lower.includes('price') || lower.includes('estimate') || lower.includes('fee')) {
          aiReply = `We offer free customized quotes for all our services at ${company}. Would you like me to book a callback with ${contact}?`
        } else if (lower.includes('where') || lower.includes('location') || lower.includes('based') || lower.includes('area') || lower.includes('address')) {
          aiReply = `${company} serves customers across the UK. How can we assist you today?`
        } else {
          aiReply = `Thank you for asking about ${company}! I will make sure ${contact} receives your message. Is there anything else I can help with?`
        }
      }
    }
  }

  const audioUrl = `https://www.echoliftai.co.uk/api/instant-ai-voice-stream?text=${encodeURIComponent(aiReply)}`

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Play>${audioUrl}</Play>
  <Gather input="speech" action="https://www.echoliftai.co.uk/api/instant-ai-voice-reply?prospectId=${prospectId || ''}" speechTimeout="auto" timeout="4" hints="apexvoice, echolift, services, quote, pricing, cost, location, contact, phone">
  </Gather>
</Response>`

  return new Response(twiml, {
    headers: {
      'Content-Type': 'text/xml',
    },
  })
}

export const config: Config = {
  path: '/api/instant-ai-voice-reply',
  method: ['GET', 'POST', 'OPTIONS'],
}
