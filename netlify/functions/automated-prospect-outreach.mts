import type { Config } from '@netlify/functions'
import { runOutreachBatch } from './lib/outreach-runner.mts'

export default async () => {
  console.log('🚀 Running automated high-volume prospect outreach batch...')

  try {
    // Dispatch 6 verified mobile SMS pitches per run (automated cold voice calls disabled for UK PECR compliance)
    // Scheduled 4x daily Mon-Sat = 24 SMS per day (~£0.84/day Twilio spend)
    const result = await runOutreachBatch(6, 0)

    console.log(`✅ Outreach batch finished: ${result.smsSent} SMS sent. ${result.freshRemaining} fresh verified mobiles remaining.`)

    return Response.json(result)
  } catch (error: any) {
    console.error('Automated outreach batch error:', error)
    return Response.json({ error: error.message || 'Outreach engine error' }, { status: 500 })
  }
}

export const config: Config = {
  // 4 runs daily Mon-Sat: 09:15 (morning break), 11:15 (lunch), 14:15 (afternoon), 16:15 (site pack-up)
  schedule: '15 9,11,14,16 * * 1-6',
}
