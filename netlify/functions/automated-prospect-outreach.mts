import type { Config } from '@netlify/functions'
import { db, sendSms, recordOutcome } from './lib/apexvoice.mts'

interface ProspectRow {
  id: number
  business_name: string
  contact_person: string
  industry: string
  location: string
  phone: string
  email: string
  status: string
  warmth_score: number
}

// UK Trade prospects to seed if database queue is low
const SEED_PROSPECTS = [
  { business_name: 'Apex Heating & Plumbing London', contact_person: 'Mark Davies', industry: 'Plumbing & Heating', location: 'London', phone: '07494867646' },
  { business_name: 'Vanguard Roofing & Solar', contact_person: 'James Wright', industry: 'Roofing', location: 'Manchester', phone: '07494867646' },
  { business_name: 'Premier Electrical Contractors', contact_person: 'David Smith', industry: 'Electrical Services', location: 'Birmingham', phone: '07494867646' },
  { business_name: 'Benchmark Microcement & Surface Design', contact_person: 'Alex Turner', industry: 'Microcement', location: 'Leeds', phone: '07494867646' },
  { business_name: 'Artisan Joinery & Building UK', contact_person: 'Chris Taylor', industry: 'Construction', location: 'Bristol', phone: '07494867646' }
]

export default async () => {
  console.log('🚀 Running automated prospect outreach batch...')

  try {
    // 1. Ensure table exists and check fresh prospects count
    let freshRows = (await db().sql`
      SELECT id, business_name, contact_person, industry, location, phone, email, status, warmth_score
      FROM apexvoice_prospects
      WHERE status = 'New' AND phone IS NOT NULL AND phone != ''
        AND RIGHT(REGEXP_REPLACE(phone, '[^0-9]', '', 'g'), 10) != '7494867646'
      LIMIT 3
    `) as ProspectRow[]

    // If no real prospects queued, do not send outreach to placeholder test numbers
    if (freshRows.length === 0) {
      console.log('ℹ️ No real customer prospects in queue. Skipping automated outreach batch.')
      return Response.json({
        success: true,
        message: 'No external customer prospects queued. Skipping batch.',
        outreachSent: 0,
      })
    }

    let sentCount = 0
    let failedCount = 0

    // 2. Dispatch outreach SMS to up to 2 fresh prospects
    for (const prospect of freshRows.slice(0, 2)) {
      const contact = (prospect.contact_person || 'there').split(' ')[0]
      const biz = prospect.business_name || 'your business'
      const city = prospect.location || 'UK'

      const smsBody = `Hi ${contact}, Alex from EchoLift AI. Noticed ${biz} in ${city}. Did you know ~62% of missed trade calls go to rivals? We deploy a 24/7 AI receptionist for UK trades. Free 30s demo: https://echoliftai.co.uk/#demo`

      // Extra safety check: never send outreach pitch to owner phone number
      const phoneDigits = prospect.phone.replace(/[^0-9]/g, '')
      if (phoneDigits.endsWith('7494867646')) {
        console.log(`Skipping outreach pitch to owner number: ${prospect.phone}`)
        continue
      }

      const smsResult = await sendSms(prospect.phone, smsBody)

      if (smsResult.ok) {
        sentCount++
        await recordOutcome(
          prospect,
          'SMS',
          'Outbound Pitch Sent (EchoLift AI)',
          'Contacted',
          new Date().toISOString(),
          prospect.warmth_score + 10
        )
      } else {
        failedCount++
        console.error(`Outreach failed for prospect ${prospect.id}:`, smsResult.error)
      }
    }

    return Response.json({
      success: true,
      timestamp: new Date().toISOString(),
      outreachSent: sentCount,
      outreachFailed: failedCount,
    })
  } catch (error: any) {
    console.error('Automated outreach batch error:', error)
    return Response.json({ error: error.message || 'Outreach engine error' }, { status: 500 })
  }
}

export const config: Config = {
  schedule: '0 10 * * 1-5', // Mon-Fri at 10:00 AM UTC
}
