import type { Config } from '@netlify/functions'
import { jsonError, readCampaign, resolveElevenLabsKey, text } from './lib/apexvoice.mts'

/**
 * Server-side ElevenLabs proxy for the call simulator's voices.
 *
 * The key never leaves the server: it is read from the ELEVENLABS_API_KEY env
 * var, or failing that from the campaign row, and the browser only says which
 * side of the conversation is speaking. Previously the page held the key and
 * attached it to every request, which meant anyone who opened the portal could
 * read it out of the form and spend against the account.
 *
 * The voice id is resolved from the saved campaign settings rather than taken
 * from the request, so this endpoint cannot be repurposed as a general-purpose
 * text-to-speech service for arbitrary voices.
 */

const ELEVENLABS_URL = 'https://api.elevenlabs.io/v1/text-to-speech'
const MAX_CHARS = 700

export default async (req: Request) => {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return jsonError('Expected a JSON body.', 400)

  const line = text(body.text, MAX_CHARS)
  if (!line) return jsonError('Nothing to speak.', 400)

  try {
    const campaign = await readCampaign()
    const apiKey = resolveElevenLabsKey(campaign)

    // 503 rather than an error: the portal treats this as "use the browser's
    // built-in speech synthesis instead", which is a working fallback.
    if (!apiKey) return jsonError('No ElevenLabs key is configured.', 503)

    const voiceId = body.speaker === 'customer'
      ? campaign?.elevenlabs_customer_voice
      : campaign?.elevenlabs_agent_voice

    if (!voiceId) return jsonError('No voice is configured for that speaker.', 503)

    const upstream = await fetch(`${ELEVENLABS_URL}/${encodeURIComponent(voiceId)}`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text: line,
        model_id: 'eleven_multilingual_v2',
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    })

    if (!upstream.ok) {
      // Log the status only — an upstream error body can echo the request.
      console.error('apexvoice tts upstream error:', upstream.status)
      return jsonError('The voice service rejected the request.', 502)
    }

    return new Response(upstream.body, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    console.error('apexvoice tts error:', error)
    return jsonError('Could not reach the voice service.', 502)
  }
}

export const config: Config = {
  path: '/api/apexvoice/tts',
  method: 'POST',
}
