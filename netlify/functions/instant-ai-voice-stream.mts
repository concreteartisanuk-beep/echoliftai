import type { Config } from '@netlify/functions'
import { readCampaign, resolveElevenLabsKey } from './lib/apexvoice.mts'

const ELEVENLABS_URL = 'https://api.elevenlabs.io/v1/text-to-speech'

export default async (req: Request) => {
  const url = new URL(req.url)
  const textParam = url.searchParams.get('text') || 'Hello! Thank you for calling.'

  try {
    const campaign = await readCampaign()
    const apiKey = resolveElevenLabsKey(campaign)
    const voiceId = campaign?.elevenlabs_agent_voice || 'Xb7hH2yqWyRel9GQ555e'

    if (!apiKey) {
      console.warn('instant-ai-voice-stream: No ElevenLabs API key found.')
      return new Response('Missing voice key', { status: 503 })
    }

    const upstream = await fetch(`${ELEVENLABS_URL}/${encodeURIComponent(voiceId)}?optimize_streaming_latency=4`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text: textParam,
        model_id: 'eleven_flash_v2_5',
        voice_settings: { stability: 0.4, similarity_boost: 0.8 },
      }),
    })

    if (!upstream.ok) {
      console.error('instant-ai-voice-stream upstream error:', upstream.status, await upstream.text())
      return new Response('Upstream voice synthesis error', { status: 502 })
    }

    return new Response(upstream.body, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'public, max-age=3600',
      },
    })
  } catch (error: any) {
    console.error('instant-ai-voice-stream exception:', error)
    return new Response('Voice stream error', { status: 500 })
  }
}

export const config: Config = {
  path: '/api/instant-ai-voice-stream',
  method: ['GET', 'POST'],
}
