import type { Config } from '@netlify/functions'
import { db } from './lib/apexvoice.mts'
import { sendEmail } from './lib/email.mts'

export default async () => {
  console.log('⏰ Executing daily-report-cron...')

  const ownerPhone = '+447494867646'
  const ownerEmail = 'concreteartisanuk@gmail.com'

  // 1. Keep-alive ping to Render backend
  let renderStatus = 'Unknown'
  try {
    const res = await fetch('https://apexvoice-backend.onrender.com/health', { signal: AbortSignal.timeout(5000) })
    renderStatus = res.ok ? 'ONLINE' : `STATUS ${res.status}`
  } catch (err: any) {
    renderStatus = `ERR (${err?.message || 'Timeout'})`
  }

  // 2. Fetch metrics from DB
  let totalProspects = 0
  let freshProspects = 0
  let smsSent24h = 0
  let replies24h = 0
  let calls24h = 0

  try {
    const totalRes = (await db().sql`SELECT count(*)::int as count FROM apexvoice_prospects`) as any[]
    totalProspects = totalRes[0]?.count || 0

    const freshRes = (await db().sql`SELECT count(*)::int as count FROM apexvoice_prospects WHERE status = 'New'`) as any[]
    freshProspects = freshRes[0]?.count || 0

    const activity24h = (await db().sql`
      SELECT type, outcome, created_at 
      FROM apexvoice_activity 
      WHERE created_at >= NOW() - INTERVAL '24 HOURS'
    `) as any[]

    smsSent24h = activity24h.filter(a => a.type === 'SMS' && (a.outcome.includes('Outbound') || a.outcome.includes('Sent'))).length
    replies24h = activity24h.filter(a => a.type === 'SMS' && (a.outcome.includes('Reply') || a.outcome.includes('Incoming'))).length
    calls24h = activity24h.filter(a => a.type === 'Call').length
  } catch (error) {
    console.error('Error fetching DB activity metrics for daily report:', error)
  }

  const todayStr = new Date().toLocaleDateString('en-GB')

  const reportText = `📊 [ApexVoice Daily Activity Report]
Date: ${todayStr}

Today's Activity Breakdown (Last 24h):
• Outreach Texts Sent Today: ${smsSent24h}
• Customer Replies Received Today: ${replies24h}
• AI Voice Calls Placed Today: ${calls24h}

Store & Pipeline Performance:
• Total Prospects in Pipeline: ${totalProspects}
• Unsent Fresh Prospects: ${freshProspects}
• Backend Node Health: ${renderStatus}

Status: 24/7 ACTIVE | echoliftai.co.uk`

  // 3. Send SMS via Twilio (Sender ID 'EchoLift')
  let smsStatus = 'Not Sent'
  const getEnv = (key: string): string => {
    if (typeof process !== 'undefined' && process.env && process.env[key]) return process.env[key]!
    try {
      if (typeof Netlify !== 'undefined' && (Netlify as any).env) return (Netlify as any).env.get(key) || ''
    } catch {}
    return ''
  }

  const sid = getEnv('TWILIO_ACCOUNT_SID') || getEnv('TWILIO_SID')
  const token = getEnv('TWILIO_AUTH_TOKEN')

  if (sid && token) {
    try {
      const auth = Buffer.from(`${sid}:${token}`).toString('base64')
      const params = new URLSearchParams({
        To: ownerPhone,
        From: 'EchoLift',
        Body: reportText,
      })

      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      })

      if (res.ok) {
        smsStatus = 'Delivered (EchoLift)'
        console.log('✅ Daily Report SMS sent successfully!')
      } else {
        const errDetail = await res.text()
        smsStatus = `Failed: ${res.status}`
        console.error('❌ Daily Report SMS failed:', res.status, errDetail)
      }
    } catch (err: any) {
      smsStatus = `Error: ${err.message}`
      console.error('❌ Daily Report SMS error:', err)
    }
  }

  // 4. Send Email via Resend / sendEmail helper
  let emailStatus = 'Not Sent'
  try {
    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; background: #0f172a; color: #f8fafc; padding: 24px; border-radius: 12px;">
        <h2 style="color: #6366f1; margin-top: 0;">📊 ApexVoice Daily Activity Report</h2>
        <p style="color: #94a3b8; font-size: 14px;">Date: ${todayStr}</p>
        
        <div style="background: #1e293b; padding: 16px; border-radius: 8px; margin: 16px 0;">
          <h3 style="margin-top: 0; color: #38bdf8;">Today's Activity Breakdown (Last 24h)</h3>
          <ul style="line-height: 1.8; color: #e2e8f0; padding-left: 20px;">
            <li><strong>Outreach Texts Sent Today:</strong> ${smsSent24h}</li>
            <li><strong>Customer Replies Received Today:</strong> ${replies24h}</li>
            <li><strong>AI Voice Calls Placed Today:</strong> ${calls24h}</li>
          </ul>
        </div>

        <div style="background: #1e293b; padding: 16px; border-radius: 8px; margin: 16px 0;">
          <h3 style="margin-top: 0; color: #34d399;">Store & Pipeline Performance</h3>
          <ul style="line-height: 1.8; color: #e2e8f0; padding-left: 20px;">
            <li><strong>Total Prospects in Pipeline:</strong> ${totalProspects}</li>
            <li><strong>Unsent Fresh Prospects:</strong> ${freshProspects}</li>
            <li><strong>Backend Health Ping:</strong> ${renderStatus}</li>
          </ul>
        </div>

        <div style="text-align: center; margin-top: 24px; padding-top: 16px; border-top: 1px solid #334155; color: #94a3b8; font-size: 12px;">
          Status: <strong style="color: #34d399;">24/7 ACTIVE</strong> | <a href="https://echoliftai.co.uk" style="color: #6366f1; text-decoration: none;">echoliftai.co.uk</a>
        </div>
      </div>
    `
    const sent = await sendEmail({
      to: ownerEmail,
      subject: `📊 ApexVoice Daily Activity Report (${todayStr})`,
      html,
    })
    emailStatus = sent ? 'Sent' : 'Skipped/Failed'
  } catch (err: any) {
    emailStatus = `Error: ${err.message}`
  }

  return Response.json({
    success: true,
    timestamp: new Date().toISOString(),
    smsStatus,
    emailStatus,
    renderStatus,
    stats: {
      smsSent24h,
      replies24h,
      calls24h,
      totalProspects,
      freshProspects,
    },
  })
}

export const config: Config = {
  path: '/api/daily-report-cron',
  schedule: '0 18 * * *',
}
