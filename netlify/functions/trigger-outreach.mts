import { runOutreachBatch } from './lib/outreach-runner.mts'

export default async (req: Request) => {
  console.log('🚀 Triggering on-demand ApexVoice prospect outreach batch...')

  try {
    const url = new URL(req.url)
    const countParam = parseInt(url.searchParams.get('batch') || '4', 10)
    const batchCount = Math.min(10, Math.max(1, isNaN(countParam) ? 4 : countParam))

    const result = await runOutreachBatch(batchCount, 0)

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
