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

const SEED_PROSPECTS = [
  { business_name: 'Apex Heating & Plumbing London', contact_person: 'Mark Davies', industry: 'Plumbing & Heating', location: 'London', phone: '07494867646' },
  { business_name: 'Vanguard Roofing & Solar', contact_person: 'James Wright', industry: 'Roofing', location: 'Manchester', phone: '07494867646' },
  { business_name: 'Premier Electrical Contractors', contact_person: 'David Smith', industry: 'Electrical Services', location: 'Birmingham', phone: '07494867646' },
  { business_name: 'Benchmark Microcement & Surface Design', contact_person: 'Alex Turner', industry: 'Microcement', location: 'Leeds', phone: '07494867646' },
  { business_name: 'Artisan Joinery & Building UK', contact_person: 'Chris Taylor', industry: 'Construction', location: 'Bristol', phone: '07494867646' }
]

export default async () => {
  console.log('🚀 Triggering manual ApexVoice outreach batch...')

  try {
    let freshRows: ProspectRow[] = []
    try {
      freshRows = (await db().sql`
        SELECT id, business_name, contact_person, industry, location, phone, email, status, warmth_score
        FROM apexvoice_prospects
        WHERE status = 'New' AND phone IS NOT NULL AND phone != ''
        LIMIT 3
      `) as ProspectRow[]
    } catch {
      // Database query fallback
    }

    let sentCount = 0
    let failedCount = 0
    let lastDetails = ''

    // Default target phone if database is unseeded
    const targetPhone = '+447494867646'
    const contactName = 'there'
    const bizName = 'your business'

    const smsBody = `Hi ${contactName}, Ian from EchoLift AI. We consult for UK small businesses to eliminate missed calls & automate daily admin. Offering a Bespoke AI Audit & Roadmap for £47 this week (saves 15+ hrs/wk or 100% refund). Info: https://echoliftai.co.uk`

    const smsResult = await sendSms(targetPhone, smsBody)

    if (smsResult.ok) {
      sentCount++
      lastDetails = `Sent successfully to ${targetPhone} via Twilio Sender ID EchoLift`
    } else {
      failedCount++
      lastDetails = `Error: ${smsResult.error}`
    }

    return Response.json({
      success: true,
      timestamp: new Date().toISOString(),
      outreachSent: sentCount,
      outreachFailed: failedCount,
      details: lastDetails
    }, {
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
