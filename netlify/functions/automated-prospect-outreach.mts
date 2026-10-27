import type { Config } from '@netlify/functions'

export default async () => {
  console.log('🛑 ApexVoice automated SMS outreach is PAUSED by owner request to eliminate Twilio charges.')

  return Response.json({
    success: true,
    paused: true,
    smsSent: 0,
    message: 'Automated SMS outreach is paused by owner request to eliminate Twilio charges.'
  })
}

export const config: Config = {
  // Cron schedule disabled to prevent any automated background triggers
  // schedule: '15 9,11,14,16 * * 1-6',
}
