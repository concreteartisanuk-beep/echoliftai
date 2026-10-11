import type { Config } from '@netlify/functions'
import { getCachedAudio, readCampaign, resolveElevenLabsKey, setCachedAudio } from './lib/apexvoice.mts'

const ELEVENLABS_URL = 'https://api.elevenlabs.io/v1/text-to-speech'

// In-memory audio buffer cache (survives warm invocations for 0ms responses)
const memoryAudioCache = new Map<string, ArrayBuffer>()

export default async (req: Request) => {
  const url = new URL(req.url)
  const textParam = (url.searchParams.get('text') || 'Hello! Thank you for calling.').trim()
  const requestedModel = url.searchParams.get('model') || 'eleven_turbo_v2_5'

  try {
    const campaign = await readCampaign()
    const apiKey = resolveElevenLabsKey(campaign)
    const voiceId = campaign?.elevenlabs_agent_voice || 'Xb7hH2yqWyRel9GQ555e'
    const cacheKey = `${voiceId}:${textParam}`

    // 1. Check in-memory RAM cache (< 1ms response)
    const memoryHit = memoryAudioCache.get(cacheKey)
    if (memoryHit) {
      return new Response(memoryHit, {
        headers: {
          'Content-Type': 'audio/mpeg',
          'Cache-Control': 'public, max-age=86400, s-maxage=86400',
          'X-Voice-Cache': 'RAM-HIT',
        },
      })
    }

    // 2. Check Postgres DB cache (~20ms response)
    const dbHitBase64 = await getCachedAudio(cacheKey)
    if (dbHitBase64) {
      const buffer = Buffer.from(dbHitBase64, 'base64')
      memoryAudioCache.set(cacheKey, buffer.buffer as ArrayBuffer)
      return new Response(buffer, {
        headers: {
          'Content-Type': 'audio/mpeg',
          'Cache-Control': 'public, max-age=86400, s-maxage=86400',
          'X-Voice-Cache': 'DB-HIT',
        },
      })
    }

    if (!apiKey) {
      console.warn('instant-ai-voice-stream: No ElevenLabs API key found.')
      return new Response('Missing voice key', { status: 503 })
    }

    // 3. Fast generation with ElevenLabs (try ultra-fast turbo_v2_5 first)
    let upstream = await fetch(`${ELEVENLABS_URL}/${encodeURIComponent(voiceId)}`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text: textParam,
        model_id: requestedModel,
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    })

    // If requested model is rejected (e.g. 400), seamlessly fallback to eleven_multilingual_v2
    if (!upstream.ok && requestedModel !== 'eleven_multilingual_v2') {
      console.warn(`Fallback to eleven_multilingual_v2 because ${requestedModel} returned ${upstream.status}`)
      upstream = await fetch(`${ELEVENLABS_URL}/${encodeURIComponent(voiceId)}`, {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
        },
        body: JSON.stringify({
          text: textParam,
          model_id: 'eleven_multilingual_v2',
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
      })
    }

    if (!upstream.ok) {
      console.error('instant-ai-voice-stream upstream error:', upstream.status, await upstream.text())
      return new Response('Upstream voice synthesis error', { status: 502 })
    }

    const audioArrayBuffer = await upstream.arrayBuffer()

    // 4. Populate RAM cache & async DB persistence for subsequent instant replays
    memoryAudioCache.set(cacheKey, audioArrayBuffer)
    const base64Audio = Buffer.from(audioArrayBuffer).toString('base64')
    setCachedAudio(cacheKey, base64Audio).catch((e) => console.warn('setCachedAudio error:', e))

    return new Response(audioArrayBuffer, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'public, max-age=86400, s-maxage=86400',
        'X-Voice-Cache': 'MISS-GENERATED',
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
