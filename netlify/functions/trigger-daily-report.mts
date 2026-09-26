import { runDailyReport } from './lib/send-daily-report-core.mts'

export default async () => {
  const result = await runDailyReport()
  return Response.json(result, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'application/json'
    }
  })
}
