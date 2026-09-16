import type { Config, Context } from '@netlify/functions'
import Stripe from 'stripe'

/**
 * Server-side source of truth for everything purchasable. Prices live here (in
 * pence, GBP) so the browser can never tamper with what a customer is charged.
 * Checkout uses inline price_data, so no Stripe dashboard setup is required —
 * the moment STRIPE_SECRET_KEY is present, every button below goes live.
 */
type Recurring = { interval: 'month' | 'year' }

interface CatalogItem {
  name: string
  description: string
  monthly?: number // pence
  annual?: number // pence (charged yearly)
  oneTime?: number // pence
  mode: 'subscription' | 'payment'
}

const CATALOG: Record<string, CatalogItem> = {
  // --- Core subscription tiers ---
  starter: {
    name: 'EchoLift Starter',
    description: 'Voice agent (up to 200 calls), lead capture, basic dashboard.',
    monthly: 9700,
    annual: 97000, // 2 months free
    mode: 'subscription',
  },
  growth: {
    name: 'EchoLift Growth',
    description: 'Everything in Starter + SEO engine, reputation harvester, social pipeline.',
    monthly: 19700,
    annual: 197000,
    mode: 'subscription',
  },
  pro: {
    name: 'EchoLift Pro',
    description: 'Everything in Growth + Intelligence Hub, EchoChase win-back, CRM sync, priority support.',
    monthly: 39700,
    annual: 397000,
    mode: 'subscription',
  },
  dfy: {
    name: 'EchoLift Done-For-You',
    description: 'Fully managed: onboarding, monthly content review and reporting handled for you.',
    monthly: 59700,
    annual: 597000,
    mode: 'subscription',
  },

  // --- Add-on modules (recurring) ---
  'addon-competitors': {
    name: 'Add-on: Extra Competitor Slots',
    description: 'Monitor 3 additional rivals beyond the default 3.',
    monthly: 2900,
    mode: 'subscription',
  },
  'addon-winback': {
    name: 'Add-on: SMS Win-Back Sequences',
    description: 'Extended EchoChase campaigns with custom messaging.',
    monthly: 4900,
    mode: 'subscription',
  },
  'addon-whitelabel': {
    name: 'Add-on: White-Label Reports',
    description: 'Branded PDF growth reports clients can share with their own customers.',
    monthly: 3900,
    mode: 'subscription',
  },
  'addon-number': {
    name: 'Add-on: Additional Voice Number',
    description: 'For businesses with multiple locations or departments.',
    monthly: 1900,
    mode: 'subscription',
  },
  social: {
    name: 'Social Presence Management',
    description: 'Fully managed Facebook & LinkedIn presence plus monthly SEO blog content, built to bring in leads.',
    monthly: 14900,
    annual: 149000, // 2 months free
    mode: 'subscription',
  },
  ads: {
    name: 'Facebook & LinkedIn Ad Building',
    description: 'Done-for-you paid ad campaigns: we design the creative, write the copy and build the targeting on Facebook and LinkedIn to bring in leads.',
    monthly: 19900,
    annual: 199000, // 2 months free
    mode: 'subscription',
  },

  // --- One-time purchases ---
  setup: {
    name: 'EchoLift Onboarding & Setup',
    description: 'One-time configuration of your voice agent, brand persona and competitor tracking.',
    oneTime: 19900,
    mode: 'payment',
  },
  website: {
    name: 'Website Build & Launch',
    description: 'A fast, conversion-built website designed, written and launched for you — fully optimised to rank on Google.',
    oneTime: 49900,
    mode: 'payment',
  },
  'premium-report': {
    name: 'Premium AI Growth Report',
    description:
      'A 10-section, print-ready branded growth report: keyword plan, local SEO audit, competitor breakdown, content and social playbooks and a 90-day action plan.',
    // Launch price. Deliberately low-friction — this is the entry product that
    // turns cold traffic into a paying customer before any subscription.
    // Mirrored in netlify/functions/lib/premium-report.mts for display copy.
    oneTime: 2500,
    mode: 'payment',
  },
}

const clean = (value: unknown, max = 120): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : ''

export default async (req: Request, context: Context) => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }

  const secret = process.env.STRIPE_SECRET_KEY
  // Payments are not wired up yet — tell the client so it can fall back to the
  // no-card free-trial flow instead of showing a broken button.
  if (!secret) {
    return Response.json({ configured: false })
  }

  let body: { product?: string; billing?: string; business?: Record<string, unknown> }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const item = body.product ? CATALOG[body.product] : undefined
  if (!item) {
    return Response.json({ error: 'Unknown product' }, { status: 400 })
  }

  const stripe = new Stripe(secret)
  const base = process.env.URL || `${new URL(req.url).origin}`
  const annual = body.billing === 'annual'

  try {
    let lineItem: Stripe.Checkout.SessionCreateParams.LineItem
    const recurring: Recurring | undefined =
      item.mode === 'subscription' ? { interval: annual && item.annual ? 'year' : 'month' } : undefined

    let unitAmount: number | undefined
    if (item.mode === 'subscription') {
      unitAmount = annual && item.annual ? item.annual : item.monthly
    } else {
      unitAmount = item.oneTime
    }
    if (!unitAmount) {
      return Response.json({ error: 'Product not purchasable in that mode' }, { status: 400 })
    }

    lineItem = {
      quantity: 1,
      price_data: {
        currency: 'gbp',
        unit_amount: unitAmount,
        product_data: { name: item.name, description: item.description },
        ...(recurring ? { recurring } : {}),
      },
    }

    // Where the customer lands after paying.
    const successPath =
      body.product === 'premium-report'
        ? '/premium-report?session_id={CHECKOUT_SESSION_ID}'
        : `/thanks?checkout=success&plan=${encodeURIComponent(body.product!)}`

    // ...and where they land if they back out. Abandoning checkout is the single
    // most recoverable moment in the funnel, so this returns them to the order
    // form with a flag the page uses to restore their brief and explain that
    // nothing was charged — rather than dumping them at the top of the site.
    const cancelPath = '/?checkout=cancelled#growth-report'

    // Stash the business details for the premium report so we can generate it
    // after payment without asking the customer to re-enter anything. The email
    // is carried through too, so the finished report can be delivered even if
    // Stripe's own email field is skipped (wallet payments sometimes do).
    const metadata: Record<string, string> = { product: body.product! }
    let prefillEmail = ''
    if (body.product === 'premium-report' && body.business) {
      metadata.businessName = clean(body.business.businessName)
      metadata.industry = clean(body.business.industry)
      metadata.city = clean(body.business.city)
      metadata.usp = clean(body.business.usp)
      prefillEmail = clean(body.business.email, 160)
      if (prefillEmail) metadata.email = prefillEmail
    }

    // The premium report is generated from these details after payment, so
    // refuse the sale without them rather than charge £47 for a generic
    // document. The site collects them in the report brief before checkout.
    if (body.product === 'premium-report' && !metadata.businessName) {
      return Response.json(
        {
          error:
            'Please fill in your business details first so we know which business to write about.',
        },
        { status: 400 },
      )
    }

    const session = await stripe.checkout.sessions.create({
      mode: item.mode,
      line_items: [lineItem],
      success_url: `${base}${successPath}`,
      cancel_url: `${base}${cancelPath}`,
      billing_address_collection: 'auto',
      allow_promotion_codes: true,
      ...(prefillEmail ? { customer_email: prefillEmail } : {}),
      metadata,
      ...(item.mode === 'payment'
        ? { payment_intent_data: { metadata, statement_descriptor_suffix: 'ECHOLIFT' } }
        : {}),
    })

    return Response.json({ configured: true, url: session.url })
  } catch (error) {
    console.error('create-checkout error:', error)
    return Response.json({ error: 'Could not start checkout. Please try again.' }, { status: 502 })
  }
}

export const config: Config = {
  path: '/api/create-checkout',
  method: 'POST',
}
