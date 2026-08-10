/**
 * Email delivery for the lead pipeline. Kept env-gated exactly like Stripe: the
 * moment RESEND_API_KEY (and a verified LEADS_FROM_EMAIL) are present, every
 * captured lead starts receiving the follow-up sequence, and every purchased
 * report is delivered by email. Until then `emailEnabled()` is false and callers
 * simply skip sending — lead capture itself never depends on email being on.
 *
 * Resend is called over its REST API with fetch, so no extra dependency is
 * needed. Swap the provider here and the rest of the pipeline is unaffected.
 */

export interface Lead {
  id: number
  email: string
  business_name: string
  industry: string
  city: string
  usp: string
  report_headline: string
  estimated_monthly_loss: string
}

const FROM = () => process.env.LEADS_FROM_EMAIL || 'EchoLift AI <hello@echolift.ai>'
const SITE_URL = () => process.env.URL || 'https://echoliftai.netlify.app'

export const emailEnabled = (): boolean =>
  Boolean(process.env.RESEND_API_KEY && (process.env.LEADS_FROM_EMAIL || true))

const esc = (str: unknown): string =>
  String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

/** Sends one email. Returns true on success; never throws. */
export const sendEmail = async (opts: {
  to: string
  subject: string
  html: string
}): Promise<boolean> => {
  const key = process.env.RESEND_API_KEY
  if (!key) return false
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: FROM(), to: opts.to, subject: opts.subject, html: opts.html }),
    })
    if (!res.ok) {
      console.error('sendEmail failed:', res.status, await res.text().catch(() => ''))
      return false
    }
    return true
  } catch (error) {
    console.error('sendEmail error:', error)
    return false
  }
}

const shell = (bodyHtml: string): string => `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1a1a2e;line-height:1.6;">
    <div style="padding:24px 0;text-align:center;">
      <span style="font-size:20px;font-weight:700;color:#6366f1;">EchoLift&nbsp;AI</span>
    </div>
    <div style="background:#ffffff;border:1px solid #ececf5;border-radius:16px;padding:28px;">
      ${bodyHtml}
    </div>
    <p style="text-align:center;color:#9a9ab0;font-size:12px;margin-top:20px;">
      EchoLift AI · The 6-in-1 AI growth platform for UK businesses<br/>
      You’re receiving this because you started an AI Growth Report for your business.
      <a href="${SITE_URL()}" style="color:#9a9ab0;">Visit site</a>
    </p>
  </div>`

const cta = (label: string, href: string): string =>
  `<a href="${href}" style="display:inline-block;background:#6366f1;color:#fff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:10px;margin-top:8px;">${esc(label)}</a>`

/**
 * Email 1 — sent to a lead who filled in a report brief but hasn't bought yet.
 * The report itself is the paid product, so this email never contains analysis:
 * its only job is to carry them back to checkout while the intent is fresh.
 */
export const reportBriefEmail = (lead: Lead) => {
  const name = lead.business_name || 'your business'
  return {
    subject: `Your AI Growth Report for ${name} is ready to write`,
    html: shell(`
      <h1 style="font-size:22px;margin:0 0 12px;">We've saved your brief for ${esc(name)} 👋</h1>
      <p>Your Premium AI Growth Report is written the moment you check out: ten sections built around ${esc(name)}, including an 8-keyword plan, a local SEO audit, a competitor breakdown, content and social playbooks and a 90-day action plan.</p>
      <div style="background:#f5f5ff;border-radius:12px;padding:16px;margin:16px 0;">
        <div style="font-size:26px;font-weight:700;color:#6366f1;">£47</div>
        <div style="font-size:13px;color:#6b6b80;">one-off — no subscription, print-ready branded PDF you keep</div>
      </div>
      <p>${cta('Complete my report — £47', `${SITE_URL()}/#growth-report`)}</p>
      <p style="font-size:14px;color:#6b6b80;">Rather see exactly what lands in your inbox first? <a href="${SITE_URL()}/#premium-report" style="color:#6366f1;font-weight:600;">Here's every section</a>. Or reply to this email and we'll answer anything before you buy.</p>
    `),
  }
}

/**
 * Sent as soon as a purchased Premium AI Growth Report finishes generating.
 * The link is the whole point: it is permanent and re-openable, so the customer
 * can come back to the report (and re-download the PDF) long after the tab that
 * bought it is gone.
 */
export const premiumReportEmail = (opts: {
  businessName: string
  reportRef: string
  url: string
}) => ({
  subject: `Your Premium AI Growth Report for ${opts.businessName} is ready`,
  html: shell(`
    <h1 style="font-size:22px;margin:0 0 12px;">Your premium report is ready 🎉</h1>
    <p>Thanks for your purchase. The full 10-section growth report for <strong>${esc(opts.businessName)}</strong> — keyword plan, local SEO audit, competitor breakdown, content and social playbooks and your 90-day action plan — is now live at your private link.</p>
    <p>${cta('Open my report', opts.url)}</p>
    <p style="font-size:14px;color:#6b6b80;">Use the <strong>Download PDF</strong> button at the top of the report to save or print a branded copy. Keep this email — the link stays valid, so you can reopen the report whenever you need it.</p>
    <p style="font-size:14px;color:#6b6b80;">Reference: <strong>${esc(opts.reportRef)}</strong></p>
    <p style="font-size:14px;color:#6b6b80;">Want the plan executed for you rather than by you? Reply to this email and we'll walk you through it.</p>
  `),
})

/** Email 2 — a couple of days later, lead on the cost of doing nothing. */
export const nurtureDay2Email = (lead: Lead) => {
  const name = lead.business_name || 'your business'
  const loss = lead.estimated_monthly_loss
  return {
    subject: `The calls ${name} missed this week`,
    html: shell(`
      <h1 style="font-size:22px;margin:0 0 12px;">Every missed call is a customer who called a competitor</h1>
      <p>Since you put ${esc(name)}'s brief together${loss ? `, roughly <strong>${esc(loss)}</strong> more in work has likely walked past it to a rival who happened to pick up` : `, more warm leads have likely slipped past it`}.</p>
      <p>EchoLift’s AI voice agent answers every call, day or night, captures the lead and books the job — so nothing goes to voicemail again.</p>
      <p>${cta('See how it works', `${SITE_URL()}/#features`)}</p>
    `),
  }
}

/** Email 3 — later still, a direct nudge to start the trial. */
export const nurtureDay5Email = (lead: Lead) => {
  const name = lead.business_name || 'your business'
  return {
    subject: `Ready to put ${name}'s growth on autopilot?`,
    html: shell(`
      <h1 style="font-size:22px;margin:0 0 12px;">Try EchoLift free for 14 days — no card needed</h1>
      <p>You’ve seen where the gaps are for ${esc(name)}. The trial turns them into action: the voice agent, the SEO engine, review harvesting and the social pipeline, all working while you run the business.</p>
      <p>Setup takes minutes and there’s nothing to pay to try it.</p>
      <p>${cta('Start my free trial', `${SITE_URL()}/trial`)}</p>
      <p style="font-size:14px;color:#6b6b80;">Prefer we set it all up for you? Just reply to this email and we’ll talk Done-For-You.</p>
    `),
  }
}
