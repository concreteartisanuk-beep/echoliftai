/**
 * Shared plumbing for the paid "Premium AI Growth Report".
 *
 * Two functions need this: the fast endpoint the delivery page polls
 * (`premium-report.mts`) and the background worker that actually writes the
 * report (`premium-report-generate.mts`). Both must agree on what counts as a
 * valid purchase and on the shape of an order row, so that lives here.
 */
import Stripe from 'stripe'

/**
 * Launch price in pence for the premium report. The authoritative copy is the
 * `premium-report` entry in create-checkout's CATALOG — this constant exists so
 * emails and page copy can quote the same figure. Change both together.
 */
export const PREMIUM_REPORT_PRICE_PENCE = 4700
export const PREMIUM_REPORT_PRICE_LABEL = '£47'

export interface OrderRow {
  id: number
  stripe_session_id: string
  email: string
  business_name: string
  industry: string
  city: string
  usp: string
  status: string
  report: unknown
  attempts: number
}

export const clean = (value: unknown, fallback = '', max = 120): string => {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim().slice(0, max)
  return trimmed.length > 0 ? trimmed : fallback
}

export interface VerifiedPurchase {
  email: string
  businessName: string
  industry: string
  city: string
  usp: string
  amountPaid: number | null
  currency: string
}

export type VerifyResult =
  | { ok: true; purchase: VerifiedPurchase }
  | { ok: false; status: number; error: string }

/**
 * Confirms server-side that a Stripe Checkout session was really paid and was
 * really for the premium report before anything is generated or handed over.
 * Never trust the browser here — the session id arrives in a URL the customer
 * can edit.
 */
export const verifyPurchase = async (
  stripe: Stripe,
  sessionId: string,
): Promise<VerifyResult> => {
  let session: Stripe.Checkout.Session
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId)
  } catch (error) {
    console.error('premium-report: session lookup failed:', error)
    return { ok: false, status: 502, error: 'Could not verify your purchase.' }
  }

  if (session.payment_status !== 'paid') {
    return { ok: false, status: 402, error: 'Payment not confirmed for this session.' }
  }
  if (session.metadata?.product !== 'premium-report') {
    return { ok: false, status: 400, error: 'This purchase is not a premium report.' }
  }

  const meta = session.metadata || {}
  return {
    ok: true,
    purchase: {
      // Stripe collects an email at checkout; the details captured on the free
      // report are the fallback for wallet payments that skip the email field.
      email: clean(session.customer_details?.email || meta.email, '', 160).toLowerCase(),
      businessName: clean(meta.businessName, 'your business'),
      industry: clean(meta.industry, 'general services'),
      city: clean(meta.city, 'the UK'),
      usp: clean(meta.usp, 'quality service'),
      amountPaid: typeof session.amount_total === 'number' ? session.amount_total : null,
      currency: clean(session.currency, 'gbp', 8),
    },
  }
}

/** Absolute base URL for this deploy, used for self-invocation and email links. */
export const siteBase = (req: Request): string =>
  process.env.URL || process.env.DEPLOY_PRIME_URL || new URL(req.url).origin

/** The customer's permanent link to their finished report. */
export const reportLink = (base: string, sessionId: string): string =>
  `${base}/premium-report?session_id=${encodeURIComponent(sessionId)}`
