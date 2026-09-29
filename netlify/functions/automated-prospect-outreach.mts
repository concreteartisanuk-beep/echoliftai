import type { Config } from '@netlify/functions'
import { db, sendSms, recordOutcome } from './lib/apexvoice.mts'
import { findBusinesses } from './lib/business-search.mts'

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

// UK Trade categories and locations for automated auto-fill when pipeline runs low
const AUTO_SEARCH_TARGETS = [
  { industry: 'plumbing', location: 'Manchester' },
  { industry: 'roofing', location: 'Leeds' },
  { industry: 'electrician', location: 'Birmingham' },
  { industry: 'building', location: 'Bristol' },
  { industry: 'joinery', location: 'Newcastle' },
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

    // If no real prospects queued, automatically scrape & queue real UK trade businesses
    if (freshRows.length === 0) {
      console.log('🌱 Prospect queue low. Auto-querying UK directory for trade prospects...')
      const target = AUTO_SEARCH_TARGETS[Math.floor(Math.random() * AUTO_SEARCH_TARGETS.length)]
      
      try {
        const { businesses } = await findBusinesses(target.industry, target.location, 6)
        
        for (const b of businesses) {
          if (!b.phone || b.phone.replace(/[^0-9]/g, '').endsWith('7494867646')) continue
          
          await db().sql`
            INSERT INTO apexvoice_prospects (
              business_name, contact_person, industry, location, phone, email, website, warmth_score, status, source
            ) VALUES (
              ${b.name},
              ${'Manager'},
              ${target.industry},
              ${b.address || target.location},
              ${b.phone},
              ${b.email || ''},
              ${b.website || ''},
              50,
              'New',
              'Automated OpenStreetMap Search'
            )
          `
        }

        // Re-query fresh rows after auto-seed
        freshRows = (await db().sql`
          SELECT id, business_name, contact_person, industry, location, phone, email, status, warmth_score
          FROM apexvoice_prospects
          WHERE status = 'New' AND phone IS NOT NULL AND phone != ''
            AND RIGHT(REGEXP_REPLACE(phone, '[^0-9]', '', 'g'), 10) != '7494867646'
          LIMIT 3
        `) as ProspectRow[]
      } catch (err) {
        console.error('Auto-prospect search error:', err)
      }
    }

    if (freshRows.length === 0) {
      console.log('ℹ️ No prospects available after directory lookup. Skipping batch.')
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
