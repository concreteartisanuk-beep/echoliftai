import type { Config } from '@netlify/functions'
import { runDailyReport } from './lib/send-daily-report-core.mts'

export default async () => {
  const res = await runDailyReport()
  return Response.json(res)
}

export const config: Config = {
  schedule: '0 18 * * *',
}
