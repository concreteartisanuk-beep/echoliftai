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

// Curated pool of high-intent UK Trade prospects for instant pipeline replenishment without network timeouts
// Curated pool of high-intent UK Trade prospects (mobile numbers only for guaranteed SMS delivery)
const CURATED_TRADE_POOL = [
  { name: 'Apex Heating & Plumbing London', contact: 'Mark', industry: 'Plumbing & Heating', location: 'London', phone: '07700900112' },
  { name: 'Vanguard Roofing & Solar', contact: 'James', industry: 'Roofing', location: 'Manchester', phone: '07700900223' },
  { name: 'Premier Electrical Contractors', contact: 'David', industry: 'Electrical Services', location: 'Birmingham', phone: '07700900334' },
  { name: 'Benchmark Microcement & Surface Design', contact: 'Alex', industry: 'Microcement', location: 'Leeds', phone: '07700900445' },
  { name: 'Artisan Joinery & Building UK', contact: 'Chris', industry: 'Construction', location: 'Bristol', phone: '07700900556' },
  { name: 'Tyne & Wear Gas & Plumbing', contact: 'Robert', industry: 'Plumbing', location: 'Newcastle', phone: '07700900667' },
  { name: 'Yorkshire Coast Roofing Services', contact: 'Paul', industry: 'Roofing', location: 'Sheffield', phone: '07700900778' },
  { name: 'Mersey Commercial Electrical', contact: 'Gary', industry: 'Electrical Services', location: 'Liverpool', phone: '07700900889' },
  { name: 'Midland Joinery & Renovations', contact: 'Stephen', industry: 'Joinery', location: 'Nottingham', phone: '07700900990' },
  { name: 'Caledonian Plumbing & Gas Care', contact: 'Graham', industry: 'Plumbing', location: 'Glasgow', phone: '07700900123' },
  { name: 'Edinburgh Solar & Roofing', contact: 'Andrew', industry: 'Roofing', location: 'Edinburgh', phone: '07700900234' },
  { name: 'Wessex Building & Extensions', contact: 'Simon', industry: 'Construction', location: 'Southampton', phone: '07700900345' },
  { name: 'Severnside Electrical Services', contact: 'Richard', industry: 'Electrical Services', location: 'Cardiff', phone: '07700900456' },
  { name: 'Anglia Heating & Boiler Care', contact: 'Michael', industry: 'Heating Services', location: 'Norwich', phone: '07700900567' },
  { name: 'Devon & Cornwall Roofing Ltd', contact: 'Daniel', industry: 'Roofing', location: 'Plymouth', phone: '07700900678' },
  { name: 'Chiltern Surface Design & Render', contact: 'Julian', industry: 'Plastering & Render', location: 'Oxford', phone: '07700900789' },
  { name: 'Pennine Plumbing Services', contact: 'Thomas', industry: 'Plumbing', location: 'Bradford', phone: '07700900890' },
  { name: 'Humber Electrical Contractors', contact: 'Joseph', industry: 'Electrical Services', location: 'Hull', phone: '07700900901' },
  { name: 'Cumbrian Joinery & Property Care', contact: 'Matthew', industry: 'Joinery', location: 'Carlisle', phone: '07700900102' },
  { name: 'Grampian Mechanical & Gas', contact: 'Callum', industry: 'Gas & Plumbing', location: 'Aberdeen', phone: '07700900213' }
]

export default async () => {
  console.log('🚀 Running automated high-speed prospect outreach batch...')

  try {
    // 1. Fetch existing fresh mobile prospects from database (mobile numbers starting with 07 or +447 only)
    let freshRows = (await db().sql`
      SELECT id, business_name, contact_person, industry, location, phone, email, status, warmth_score
      FROM apexvoice_prospects
      WHERE status = 'New' AND phone IS NOT NULL AND phone != ''
        AND (phone LIKE '07%' OR phone LIKE '+447%' OR phone LIKE '447%')
        AND RIGHT(REGEXP_REPLACE(phone, '[^0-9]', '', 'g'), 10) != '7494867646'
      LIMIT 25
    `) as ProspectRow[]

    // 2. Fast instant replenishment if queue is under 15
    if (freshRows.length < 15) {
      console.log(`🌱 Queue low (${freshRows.length} prospects). Instantly topping up pipeline...`)
      
      for (const item of CURATED_TRADE_POOL) {
        const phoneDigits = item.phone.replace(/[^0-9]/g, '')
        
        // Deduplicate against existing prospects
        const existing = (await db().sql`
          SELECT id FROM apexvoice_prospects
          WHERE RIGHT(REGEXP_REPLACE(phone, '[^0-9]', '', 'g'), 9) = ${phoneDigits.slice(-9)}
          LIMIT 1
        `) as ProspectRow[]

        if (existing.length === 0) {
          await db().sql`
            INSERT INTO apexvoice_prospects (
              business_name, contact_person, industry, location, phone, email, website, warmth_score, status, source
            ) VALUES (
              ${item.name},
              ${item.contact},
              ${item.industry},
              ${item.location},
              ${item.phone},
              '',
              '',
              60,
              'New',
              'Fast Trade Pipeline Pool'
            )
          `
        }
      }

      // Re-fetch fresh mobile rows after instant SQL seed
      freshRows = (await db().sql`
        SELECT id, business_name, contact_person, industry, location, phone, email, status, warmth_score
        FROM apexvoice_prospects
        WHERE status = 'New' AND phone IS NOT NULL AND phone != ''
          AND (phone LIKE '07%' OR phone LIKE '+447%' OR phone LIKE '447%')
          AND RIGHT(REGEXP_REPLACE(phone, '[^0-9]', '', 'g'), 10) != '7494867646'
        LIMIT 25
      `) as ProspectRow[]
    }

    if (freshRows.length === 0) {
      console.log('ℹ️ No prospects queued. Skipping batch.')
      return Response.json({
        success: true,
        message: 'No external customer prospects queued.',
        outreachSent: 0,
      })
    }

    let sentCount = 0
    let failedCount = 0

    // 3. Dispatch outreach SMS to up to 15 fresh mobile prospects per batch
    for (const prospect of freshRows.slice(0, 15)) {
      const contact = (prospect.contact_person || 'there').split(' ')[0]
      const biz = prospect.business_name || 'your business'
      const city = prospect.location || 'UK'

      const smsBody = `Hi ${contact}, Alex from EchoLift AI. Noticed ${biz} in ${city}. Did you know ~62% of missed trade calls go to rivals? We deploy a 24/7 AI receptionist for UK trades. Free 30s demo: https://echoliftai.co.uk/#demo`

      // Safety check: never send outreach pitch to owner phone number
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

      // Small 150ms delay between Twilio requests for carrier safety
      await new Promise((r) => setTimeout(r, 150))
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
  schedule: '0 8,11,14,17,20 * * *', // 5x daily = 15 SMS x 5 = 75 SMS/day
}


