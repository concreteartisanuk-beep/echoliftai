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
    const systemPrompt = `You are Echo, the 24/7 AI Receptionist answering calls for "${company}".
Greeting used: "Thank you for calling ${company}, my name is Echo, how may I help you?"
Owner: ${contact}

WEBSITE KNOWLEDGE BASE FOR ${company}:
${facts}

Rules:
1. Answer the caller's query directly and concisely (1-2 sentences maximum).
2. Sound like an authentic, highly professional receptionist for ${company}.
3. Do not include markdown or formatting.
4. Output valid JSON: { "reply": "Your concise response here" }`

    const userPrompt = `Caller asked: "${userSpeech}"`

    const aiRes = await generateJson<{ reply: string }>(systemPrompt, userPrompt, 150)
    if (aiRes && aiRes.reply) {
      aiReply = aiRes.reply.replace(/[#*_`]/g, '').trim()
    } else {
      // Intelligent fallback using facts
      const lower = userSpeech.toLowerCase()
      if (lower.includes('service') || lower.includes('do') || lower.includes('offer') || lower.includes('provide')) {
        aiReply = `At ${company}, we offer professional services tailored to your needs. You can learn more on our website or I can have ${contact} contact you directly.`
      } else if (lower.includes('quote') || lower.includes('cost') || lower.includes('price')) {
        aiReply = `We provide customized quotes for every project at ${company}. Would you like me to note your contact details for a free estimate?`
      } else if (lower.includes('where') || lower.includes('location') || lower.includes('based')) {
        aiReply = `${company} serves customers across the UK. How can we help with your upcoming project?`
      } else {
        aiReply = `Thank you for reaching out to ${company}! I will make sure ${contact} receives your message. Is there anything else I can help with?`
      }
    }
  }

  const audioUrl = `https://www.echoliftai.co.uk/api/instant-ai-voice-stream?text=${encodeURIComponent(aiReply)}`

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Play>${audioUrl}</Play>
  <Gather input="speech" action="https://www.echoliftai.co.uk/api/instant-ai-voice-reply?prospectId=${prospectId || ''}" speechTimeout="auto" timeout="4">
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
