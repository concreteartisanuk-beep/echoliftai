import type { Config } from '@netlify/functions'
import { db, sendSms, text, type ProspectRow } from './lib/apexvoice.mts'

interface GuideAccessRequest {
  companyName?: string
  contactName?: string
  email?: string
  phone?: string
  industry?: string
}

const clean = (val: unknown, max = 100): string =>
  typeof val === 'string' ? val.trim().slice(0, max) : ''

const isValidEmail = (email: string): boolean =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)

export default async (req: Request) => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }

  let body: GuideAccessRequest
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON request' }, { status: 400 })
  }

  const company = clean(body.companyName, 120) || 'Independent Business'
  const contact = clean(body.contactName, 80) || 'Business Owner'
  const email = clean(body.email, 160).toLowerCase()
  const phone = clean(body.phone, 40)
  const industry = clean(body.industry, 80) || 'Small Business'

  if (!isValidEmail(email)) {
    return Response.json({ error: 'Please enter a valid work email address.' }, { status: 400 })
  }

  if (!phone || phone.length < 8) {
    return Response.json({ error: 'Please enter a valid business contact phone number.' }, { status: 400 })
  }

  try {
    // 1. Insert or update in apexvoice_prospects as high-intent lead
    await db().sql`
      INSERT INTO apexvoice_prospects (
        business_name, contact_person, industry, phone, email, warmth_score, status, source
      ) VALUES (
        ${company}, ${contact}, ${industry}, ${phone}, ${email}, 80, 'New', 'Guide Free Download'
      )
    `

    // 2. Insert into general marketing leads table if available
    try {
      await db().sql`
        INSERT INTO leads (email, business_name, industry, city, usp, source)
        VALUES (${email}, ${company}, ${industry}, 'UK', ${'Requested Free AI Booklet'}, 'ai-guide-download')
      `
    } catch {}

    // 3. Notify business owner immediately via SMS so they can follow up
    try {
      const ownerAlert = `🚨 AI Guide Download! ${contact} from ${company} (${phone}, ${email}). Trade: ${industry}. Follow up warm!`
      await sendSms('+447494867646', ownerAlert)
    } catch (smsErr) {
      console.error('Failed to dispatch owner alert for guide download:', smsErr)
    }

    return Response.json({
      success: true,
      message: 'Access granted. Your copy is ready to download.',
      downloadUrl: '/ai-guide.html?download=pdf&ref=free_optin'
    })
  } catch (error: any) {
    console.error('guide-access error:', error)
    return Response.json({
      success: true,
      message: 'Access granted.',
      downloadUrl: '/ai-guide.html?download=pdf&ref=free_optin'
    })
  }
}

export const config: Config = {
  path: '/api/guide-access',
  method: ['POST'],
}
