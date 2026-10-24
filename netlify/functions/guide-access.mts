import type { Config } from '@netlify/functions'
import { db, sendSms, text, type ProspectRow } from './lib/apexvoice.mts'

interface GuideAccessRequest {
  companyName?: string
  contactName?: string
  email?: string
  phone?: string
  industry?: string
  nameOrBiz?: string
  contact?: string
}

const clean = (val: unknown, max = 100): string =>
  typeof val === 'string' ? val.trim().slice(0, max) : ''

const isValidEmail = (email: string): boolean =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)

const looksLikePhone = (phone: string): boolean => {
  const digits = phone.replace(/\D/g, '')
  return digits.length >= 9 && digits.length <= 15
}

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

  const nameOrBiz = clean(body.nameOrBiz || body.companyName || body.contactName, 120) || 'Business Owner'
  const company = clean(body.companyName || body.nameOrBiz, 120) || nameOrBiz
  const contact = clean(body.contactName || body.nameOrBiz, 80) || nameOrBiz
  const industry = clean(body.industry, 80) || 'Small Business'

  let email = clean(body.email, 160).toLowerCase()
  let phone = clean(body.phone, 40)

  // Handle single contact field if passed
  const singleContact = clean(body.contact, 160)
  if (singleContact) {
    if (isValidEmail(singleContact)) {
      email = singleContact.toLowerCase()
    } else if (looksLikePhone(singleContact)) {
      phone = singleContact
    } else {
      // If it contains @, prioritize as email
      if (singleContact.includes('@')) email = singleContact.toLowerCase()
      else phone = singleContact
    }
  }

  const hasValidEmail = isValidEmail(email)
  const hasValidPhone = looksLikePhone(phone)

  if (!hasValidEmail && !hasValidPhone) {
    return Response.json(
      { error: 'Please enter a valid UK mobile number (for instant SMS link) or email address.' },
      { status: 400 }
    )
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
      const contactInfo = [phone, email].filter(Boolean).join(' · ')
      const ownerAlert = `🚨 AI Guide Download! ${contact} (${contactInfo}). Trade: ${industry}. Follow up warm!`
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
