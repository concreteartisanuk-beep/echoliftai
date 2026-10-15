import type { Config } from '@netlify/functions'
import { runOutreachBatch } from './lib/outreach-runner.mts'

export default async () => {
  console.log('🚀 Running automated high-volume prospect outreach batch...')

  try {
    // Dispatch 4 verified mobile SMS pitches per run (automated cold voice calls disabled for UK PECR compliance)
    // Scheduled 2x daily = 8 SMS per day (~£0.35/day Twilio spend)
    const result = await runOutreachBatch(4, 0)

    console.log(`✅ Outreach batch finished: ${result.smsSent} SMS sent. ${result.freshRemaining} fresh verified mobiles remaining.`)

    return Response.json(result)
  } catch (error: any) {
    console.error('Automated outreach batch error:', error)
    return Response.json({ error: error.message || 'Outreach engine error' }, { status: 500 })
  }
}

export const config: Config = {
  // 2 runs daily at 09:30 and 15:30 GMT (morning tea break & afternoon pack-up time)
  schedule: '30 9,15 * * *',
}
