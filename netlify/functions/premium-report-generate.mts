import type { Config, Context } from '@netlify/functions'
import Anthropic from '@anthropic-ai/sdk'
import { getDatabase } from '@netlify/database'
import Stripe from 'stripe'
import { emailEnabled, premiumReportEmail, sendEmail } from './lib/email.mts'
import {
  clean,
  reportLink,
  siteBase,
  verifyPurchase,
  type OrderRow,
} from './lib/premium-report.mts'

/**
 * Background worker that writes the paid Premium AI Growth Report.
 *
 * This is a background function because the deliverable is genuinely long — ten
 * sections, roughly ten printed pages — and a generation that thorough runs past
 * the synchronous function limit. Running it here lets the model take its time
 * while the delivery page politely polls `/api/premium-report`.
 *
 * Triggered by that same endpoint, but it re-verifies the Stripe session itself:
 * a background function is publicly addressable, so it must never take the
 * caller's word that a report has been paid for.
 */

const anthropic = new Anthropic()

const buildPrompt = (b: {
  businessName: string
  industry: string
  city: string
  usp: string
}) => `You are the senior growth analyst behind EchoLift AI, a growth platform for UK small businesses. Write a PREMIUM, in-depth growth report for the paying client below. This is a paid deliverable that will be printed as a ~10 page branded PDF, so depth, specificity and usefulness matter far more than brevity.

Business: ${b.businessName}
Industry: ${b.industry}
Location: ${b.city}
Unique selling point: ${b.usp}

Ground every number and claim in plausible UK small-business reality. Prefer concrete, checkable specifics (real search phrases a ${b.city} customer would type, realistic monthly figures in GBP, named tactics) over generic marketing advice. Never invent named real companies or cite statistics as if they were measured data — describe competitor *types* and label estimates as estimates.

Respond with ONLY a raw JSON object (no markdown fences, no commentary) matching exactly this shape:
{
  "executiveSummary": "3-4 sentences: where this business stands, the single biggest growth opportunity, and the shape of the plan to capture it",
  "visibilityScorecard": {
    "overallScore": 42,
    "summary": "1-2 sentences interpreting the scores below",
    "bands": [ { "area": "area name", "score": 55, "verdict": "short judgement (max 14 words)" } ]
  },
  "missedCallImpact": {
    "estimatedMonthlyLoss": "GBP string e.g. \\"£2,400\\"",
    "estimatedAnnualLoss": "GBP string e.g. \\"£28,800\\"",
    "explanation": "2-3 sentences on how missed and unreturned calls drain revenue in this trade",
    "assumptions": [ "one plain-English assumption behind the figure" ]
  },
  "keywordPlan": [
    { "keyword": "long-tail phrase a real ${b.city} customer types", "intent": "informational|commercial|transactional", "difficulty": "Low|Medium|High", "monthlyVolume": "estimated range e.g. \\"70-140\\"", "why": "why it is winnable for this business (max 18 words)" }
  ],
  "localSeoAudit": {
    "priorityFixes": [ { "area": "e.g. Google Business Profile", "issue": "what is likely wrong (max 18 words)", "fix": "the specific fix (max 18 words)" } ],
    "profileTips": [ "a specific Google Business Profile action for this trade" ]
  },
  "competitorBreakdown": [
    { "competitorType": "the kind of rival, e.g. 'established multi-van firm'", "likelyStrength": "what they do well (max 14 words)", "weakness": "a concrete gap to exploit (max 18 words)", "counterMove": "what this business should do about it (max 18 words)" }
  ],
  "reputationPlan": {
    "currentRisk": "1-2 sentences on the review position and what it costs them",
    "targetReviewCount": "a realistic 90-day target e.g. \\"25+ Google reviews\\"",
    "tactics": [ "a specific, repeatable review-generation tactic" ]
  },
  "contentPlan": [
    { "title": "a specific blog or landing page title tailored to this business", "format": "e.g. Blog post / Landing page / Video", "targetKeyword": "the keyword it targets", "angle": "why it converts for this audience (max 16 words)" }
  ],
  "socialPlaybook": {
    "cadence": "a realistic posting rhythm this owner can sustain",
    "pillars": [ { "pillar": "content theme", "example": "a concrete post idea for this business" } ],
    "samplePost": "a ready-to-post, on-brand caption (2-3 short sentences) including 3 relevant hashtags"
  },
  "ninetyDayPlan": [
    { "phase": "Days 1-30", "focus": "theme for the phase", "actions": [ "concrete action" ], "kpi": "the one number to watch this phase" }
  ],
  "kpis": [ { "metric": "metric name", "baseline": "likely starting point", "ninetyDayTarget": "realistic target" } ],
  "projectedOutcome": "2-3 sentences on realistic results after 90 days if the plan is followed, with a caveat that results depend on execution"
}

Strict counts — the layout depends on them:
- visibilityScorecard.bands: exactly 5 items. Scores are integers 0-100 and should be a believable mix, not all similar.
- missedCallImpact.assumptions: exactly 3 items.
- keywordPlan: exactly 8 items, no duplicates, at least 2 transactional.
- localSeoAudit.priorityFixes: exactly 4 items. localSeoAudit.profileTips: exactly 3 items.
- competitorBreakdown: exactly 3 items, each a different type of rival.
- reputationPlan.tactics: exactly 4 items.
- contentPlan: exactly 5 items.
- socialPlaybook.pillars: exactly 3 items.
- ninetyDayPlan: exactly 3 phases, in order "Days 1-30", "Days 31-60", "Days 61-90", each with exactly 3 actions.
- kpis: exactly 4 items.

Tone: confident, professional, plain UK English. Use British spelling and GBP throughout. Reference the industry, city and USP where it genuinely helps.`

/** Model output is untrusted shape — normalise it so the page can't render holes. */
const normalise = (raw: any) => {
  const arr = (value: unknown, len: number): any[] =>
    Array.isArray(value) ? value.slice(0, len) : []
  const obj = (value: unknown): any => (value && typeof value === 'object' ? value : {})

  const scorecard = obj(raw?.visibilityScorecard)
  const impact = obj(raw?.missedCallImpact)
  const seo = obj(raw?.localSeoAudit)
  const reputation = obj(raw?.reputationPlan)
  const social = obj(raw?.socialPlaybook)

  return {
    executiveSummary: clean(raw?.executiveSummary, '', 1200),
    visibilityScorecard: {
      overallScore: Number.isFinite(Number(scorecard.overallScore))
        ? Math.max(0, Math.min(100, Math.round(Number(scorecard.overallScore))))
        : null,
      summary: clean(scorecard.summary, '', 600),
      bands: arr(scorecard.bands, 5).map((b: any) => ({
        area: clean(b?.area, '', 60),
        score: Number.isFinite(Number(b?.score))
          ? Math.max(0, Math.min(100, Math.round(Number(b.score))))
          : null,
        verdict: clean(b?.verdict, '', 200),
      })),
    },
    missedCallImpact: {
      estimatedMonthlyLoss: clean(impact.estimatedMonthlyLoss, '', 40),
      estimatedAnnualLoss: clean(impact.estimatedAnnualLoss, '', 40),
      explanation: clean(impact.explanation, '', 800),
      assumptions: arr(impact.assumptions, 3).map((a) => clean(a, '', 240)),
    },
    keywordPlan: arr(raw?.keywordPlan, 8).map((k: any) => ({
      keyword: clean(k?.keyword, '', 120),
      intent: clean(k?.intent, '', 30),
      difficulty: clean(k?.difficulty, '', 20),
      monthlyVolume: clean(k?.monthlyVolume, '', 40),
      why: clean(k?.why, '', 200),
    })),
    localSeoAudit: {
      priorityFixes: arr(seo.priorityFixes, 4).map((f: any) => ({
        area: clean(f?.area, '', 80),
        issue: clean(f?.issue, '', 240),
        fix: clean(f?.fix, '', 240),
      })),
      profileTips: arr(seo.profileTips, 3).map((t) => clean(t, '', 240)),
    },
    competitorBreakdown: arr(raw?.competitorBreakdown, 3).map((c: any) => ({
      competitorType: clean(c?.competitorType, '', 80),
      likelyStrength: clean(c?.likelyStrength, '', 200),
      weakness: clean(c?.weakness, '', 240),
      counterMove: clean(c?.counterMove, '', 240),
    })),
    reputationPlan: {
      currentRisk: clean(reputation.currentRisk, '', 600),
      targetReviewCount: clean(reputation.targetReviewCount, '', 60),
      tactics: arr(reputation.tactics, 4).map((t) => clean(t, '', 240)),
    },
    contentPlan: arr(raw?.contentPlan, 5).map((c: any) => ({
      title: clean(c?.title, '', 160),
      format: clean(c?.format, '', 40),
      targetKeyword: clean(c?.targetKeyword, '', 120),
      angle: clean(c?.angle, '', 200),
    })),
    socialPlaybook: {
      cadence: clean(social.cadence, '', 200),
      pillars: arr(social.pillars, 3).map((p: any) => ({
        pillar: clean(p?.pillar, '', 60),
        example: clean(p?.example, '', 300),
      })),
      samplePost: clean(social.samplePost, '', 800),
    },
    ninetyDayPlan: arr(raw?.ninetyDayPlan, 3).map((p: any) => ({
      phase: clean(p?.phase, '', 40),
      focus: clean(p?.focus, '', 120),
      actions: arr(p?.actions, 3).map((a) => clean(a, '', 240)),
      kpi: clean(p?.kpi, '', 160),
    })),
    kpis: arr(raw?.kpis, 4).map((k: any) => ({
      metric: clean(k?.metric, '', 80),
      baseline: clean(k?.baseline, '', 60),
      ninetyDayTarget: clean(k?.ninetyDayTarget, '', 60),
    })),
    projectedOutcome: clean(raw?.projectedOutcome, '', 900),
  }
}

/** A report is only worth handing over if the headline sections came back. */
const looksComplete = (report: ReturnType<typeof normalise>): boolean =>
  Boolean(report.executiveSummary) &&
  report.keywordPlan.length >= 5 &&
  report.competitorBreakdown.length >= 2 &&
  report.ninetyDayPlan.length === 3

export default async (req: Request, context: Context) => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }

  const secret = process.env.STRIPE_SECRET_KEY
  if (!secret) return Response.json({ ok: false })

  let body: { sessionId?: string }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const sessionId = clean(body.sessionId, '', 200)
  if (!sessionId) return Response.json({ error: 'Missing checkout session' }, { status: 400 })

  // Independent verification — never generate off the back of an unverified id.
  const verified = await verifyPurchase(new Stripe(secret), sessionId)
  if (!verified.ok) {
    console.error('premium-report-generate: rejected session:', verified.error)
    return Response.json({ error: verified.error }, { status: verified.status })
  }

  const db = getDatabase()
  const [order] = (await db.sql`
    SELECT id, stripe_session_id, email, business_name, industry, city, usp, status, report, attempts
    FROM premium_report_orders
    WHERE stripe_session_id = ${sessionId}
  `) as OrderRow[]

  if (!order) {
    console.error('premium-report-generate: no order row for session')
    return Response.json({ error: 'Order not found' }, { status: 404 })
  }
  // Another run beat us to it.
  if (order.report) return Response.json({ ok: true, alreadyDone: true })

  const business = {
    businessName: order.business_name || verified.purchase.businessName,
    industry: order.industry || verified.purchase.industry,
    city: order.city || verified.purchase.city,
    usp: order.usp || verified.purchase.usp,
  }

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 8000,
      messages: [{ role: 'user', content: buildPrompt(business) }],
    })

    const textBlock = message.content.find((block) => block.type === 'text')
    const raw = textBlock && textBlock.type === 'text' ? textBlock.text : ''
    const jsonStart = raw.indexOf('{')
    const jsonEnd = raw.lastIndexOf('}')
    if (jsonStart === -1 || jsonEnd === -1) throw new Error('Model did not return JSON')

    const report = normalise(JSON.parse(raw.slice(jsonStart, jsonEnd + 1)))
    if (!looksComplete(report)) throw new Error('Generated report was incomplete')

    await db.sql`
      UPDATE premium_report_orders
      SET report = ${JSON.stringify(report)}::jsonb, status = 'ready', generated_at = NOW()
      WHERE id = ${order.id}
    `

    // Email the permanent link so the deliverable outlives the browser tab.
    const email = order.email || verified.purchase.email
    if (email && emailEnabled()) {
      const sent = await sendEmail({
        to: email,
        ...premiumReportEmail({
          businessName: business.businessName,
          reportRef: `ELR-${String(order.id).padStart(5, '0')}`,
          url: reportLink(siteBase(req), sessionId),
        }),
      })
      if (sent) {
        await db.sql`
          UPDATE premium_report_orders SET delivery_email_sent_at = NOW() WHERE id = ${order.id}
        `
      }
    }

    return Response.json({ ok: true })
  } catch (error) {
    console.error('premium-report-generate error:', error)
    // Mark failed only once retries are exhausted; below that the next poll
    // clears the stale lock and tries again.
    await db.sql`
      UPDATE premium_report_orders
      SET status = CASE WHEN attempts >= 3 THEN 'failed' ELSE 'pending' END
      WHERE id = ${order.id} AND report IS NULL
    `
    return Response.json({ ok: false }, { status: 500 })
  }
}

export const config: Config = {
  background: true,
}
