import { runOutreachBatch } from './lib/outreach-runner.mts'

export default async () => {
  console.log('🚀 Triggering on-demand ApexVoice prospect outreach batch...')

  try {
    // Run an immediate batch of 4 verified prospect outreach SMS messages (automated cold calls disabled)
    const result = await runOutreachBatch(4, 0)

    return Response.json(result, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      }
    })
  } catch (error: any) {
    console.error('Trigger outreach error:', error)
    return Response.json({ error: error.message || 'Outreach engine error' }, { status: 500 })
  }
}
