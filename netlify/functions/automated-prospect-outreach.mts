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

// Multi-city UK Trade search targets to auto-fill the pipeline
const AUTO_SEARCH_TARGETS = [
  { industry: 'plumbing', location: 'Manchester, UK' },
  { industry: 'roofing', location: 'Leeds, UK' },
  { industry: 'electrician', location: 'Birmingham, UK' },
  { industry: 'building', location: 'Bristol, UK' },
  { industry: 'joinery', location: 'Newcastle, UK' },
  { industry: 'heating', location: 'Sheffield, UK' },
  { industry: 'microcement', location: 'London, UK' },
  { industry: 'landscaping', location: 'Liverpool, UK' },
  { industry: 'plumber', location: 'Glasgow, UK' },
  { industry: 'roofing', location: 'Edinburgh, UK' },
]

export default async () => {
  console.log('🚀 Running automated prospect outreach batch...')

  try {
    // 1. Fetch fresh prospects count from database
    let freshRows = (await db().sql`
      SELECT id, business_name, contact_person, industry, location, phone, email, status, warmth_score
      FROM apexvoice_prospects
      WHERE status = 'New' AND phone IS NOT NULL AND phone != ''
        AND RIGHT(REGEXP_REPLACE(phone, '[^0-9]', '', 'g'), 10) != '7494867646'
      LIMIT 20
    `) as ProspectRow[]

    // 2. If queue has fewer than 10 prospects, search multiple directories until we have at least 15 valid leads
    if (freshRows.length < 10) {
      console.log(`🌱 Queue currently has ${freshRows.length} prospects. Querying UK directories to top up queue...`)
      
      // Shuffle target list for variety
      const shuffledTargets = [...AUTO_SEARCH_TARGETS].sort(() => 0.5 - Math.random())

      for (const target of shuffledTargets) {
        if (freshRows.length >= 15) break

        try {
          const { businesses } = await findBusinesses(target.industry, target.location, 15)
          
          for (const b of businesses) {
            if (!b.phone) continue
            const phoneDigits = b.phone.replace(/[^0-9]/g, '')
            if (phoneDigits.endsWith('7494867646') || phoneDigits.length < 10) continue

            // Deduplicate against existing prospects by phone
            const existing = (await db().sql`
              SELECT id FROM apexvoice_prospects
              WHERE RIGHT(REGEXP_REPLACE(phone, '[^0-9]', '', 'g'), 9) = ${phoneDigits.slice(-9)}
              LIMIT 1
            `) as ProspectRow[]

            if (existing.length > 0) continue

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
                'Automated Directory Multi-Search'
              )
            `
          }

          // Refresh query
          freshRows = (await db().sql`
            SELECT id, business_name, contact_person, industry, location, phone, email, status, warmth_score
            FROM apexvoice_prospects
            WHERE status = 'New' AND phone IS NOT NULL AND phone != ''
              AND RIGHT(REGEXP_REPLACE(phone, '[^0-9]', '', 'g'), 10) != '7494867646'
            LIMIT 20
          `) as ProspectRow[]
        } catch (err) {
          console.error(`Auto-search failed for ${target.industry} in ${target.location}:`, err)
        }
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

    // 3. Dispatch outreach SMS to up to 10 fresh prospects per execution
    for (const prospect of freshRows.slice(0, 10)) {
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
  schedule: '0 10,14 * * 1-5', // Mon-Fri at 10:00 AM & 2:00 PM UTC (Twice Daily)
}

