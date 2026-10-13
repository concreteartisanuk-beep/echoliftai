import type { Config } from '@netlify/functions'
import { runOutreachBatch } from './lib/outreach-runner.mts'

export default async () => {
  console.log('🚀 Running automated high-volume prospect outreach batch...')

  try {
    // Dispatch 8 high-intent prospect outreach SMS messages per run
    // Scheduled 5x daily = 40 SMS messages per day
    const result = await runOutreachBatch(8)

    console.log(`✅ Outreach batch finished: ${result.smsSent} initial pitches sent, ${result.followupsSent} follow-ups sent. ${result.freshRemaining} fresh prospects remaining.`)

    return Response.json(result)
  } catch (error: any) {
    console.error('Automated outreach batch error:', error)
    return Response.json({ error: error.message || 'Outreach engine error' }, { status: 500 })
  }
}

export const config: Config = {
  // 5 runs daily at 08:00, 11:00, 14:00, 17:00, 20:00 GMT (8 SMS/run = 40 SMS/day)
  schedule: '0 8,11,14,17,20 * * *',
}
