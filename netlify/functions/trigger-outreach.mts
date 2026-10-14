import { runOutreachBatch } from './lib/outreach-runner.mts'

export default async () => {
  console.log('🚀 Triggering on-demand ApexVoice prospect outreach batch...')

  try {
    // Run an immediate batch of 6 prospect outreach SMS messages and 2 landline AI sales calls
    const result = await runOutreachBatch(6, 2)

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
