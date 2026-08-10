import type { Config, Context } from '@netlify/edge-functions'

/**
 * Single-operator access control for the ApexVoice portal.
 *
 * The portal page and its API were reachable by anyone who knew the URL, which
 * meant the prospect list, the campaign scripts and the ElevenLabs voice proxy
 * were all public. This gate sits in front of both:
 *
 *   /portal, /portal/*        the portal UI          → redirect to the login page
 *   /api/apexvoice/*          the portal API         → 401 JSON
 *   /api/portal/login|logout|session                 → handled here
 *
 * Auth is a single password held in the PORTAL_PASSWORD environment variable,
 * exchanged for a signed, HttpOnly session cookie. There is one operator, so
 * there are no accounts, no user table and no password reset flow — changing
 * PORTAL_PASSWORD is the reset, and it invalidates every existing session
 * because the signing key is derived from it.
 *
 * An edge function rather than a serverless function so that the check runs
 * before the static portal HTML is served: a Netlify Function cannot intercept
 * a request for a published file.
 */

const COOKIE_NAME = 'apexvoice_session'
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7 // 7 days
const LOGIN_PAGE = '/portal/login.html'

/** Bumping this invalidates every issued cookie without touching the password. */
const TOKEN_VERSION = 'v1'

/** Slows password guessing to a crawl without holding server state. */
const WRONG_PASSWORD_DELAY_MS = 500

const encoder = new TextEncoder()

/* ----------------------------------------------------------------- crypto */

const toHex = (buffer: ArrayBuffer): string =>
  Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')

const sha256Hex = async (value: string): Promise<string> =>
  toHex(await crypto.subtle.digest('SHA-256', encoder.encode(value)))

const hmacHex = async (secret: string, payload: string): Promise<string> => {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return toHex(await crypto.subtle.sign('HMAC', key, encoder.encode(payload)))
}

/**
 * Constant-time comparison for equal-length hex strings. Both callers hash
 * first, so the inputs are always 64 characters and the length check below
 * cannot leak anything about the secret.
 */
const equalHex = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false
  let difference = 0
  for (let i = 0; i < a.length; i += 1) {
    difference |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return difference === 0
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/* ------------------------------------------------------------------ config */

/**
 * PORTAL_PASSWORD is the canonical name. `apexvoicepass` is accepted as well
 * because the site was first configured under that name, and honouring it means
 * the password already stored there keeps working without a dashboard visit.
 * PORTAL_PASSWORD is read first, so setting it always overrides the older name.
 */
const PASSWORD_VARS = ['PORTAL_PASSWORD', 'apexvoicepass'] as const

/**
 * Surrounding whitespace is stripped. A password pasted into the Netlify
 * environment-variable form often picks up a trailing space or newline, which
 * is invisible in the dashboard and makes every sign-in attempt look like a
 * wrong password. The submitted password is trimmed the same way in
 * handleLogin, so both sides agree.
 */
const portalPassword = (): string => {
  for (const name of PASSWORD_VARS) {
    const value = Netlify.env.get(name)?.trim()
    if (value) return value
  }
  return ''
}

/**
 * A dedicated signing key is optional. Falling back to the password means
 * rotating the password logs every session out, which is the behaviour you
 * want from a single-operator gate; setting PORTAL_SESSION_SECRET separately
 * keeps sessions alive across a password change.
 */
const signingSecret = (): string =>
  Netlify.env.get('PORTAL_SESSION_SECRET') || portalPassword()

/* ------------------------------------------------------------------ tokens */

const issueToken = async (): Promise<{ token: string; expires: Date }> => {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS
  const signature = await hmacHex(signingSecret(), `${TOKEN_VERSION}.${expiresAt}`)
  return { token: `${expiresAt}.${signature}`, expires: new Date(expiresAt * 1000) }
}

const tokenIsValid = async (token: string | undefined): Promise<boolean> => {
  if (!token) return false

  const separator = token.indexOf('.')
  if (separator === -1) return false

  const expiresAt = token.slice(0, separator)
  const signature = token.slice(separator + 1)
  if (!/^\d+$/.test(expiresAt) || !/^[0-9a-f]{64}$/.test(signature)) return false

  // Expiry is checked before the HMAC so a stale cookie costs no crypto work.
  if (Number(expiresAt) * 1000 <= Date.now()) return false

  const expected = await hmacHex(signingSecret(), `${TOKEN_VERSION}.${expiresAt}`)
  return equalHex(signature, expected)
}

/* --------------------------------------------------------------- responses */

const NO_STORE = { 'cache-control': 'no-store' }

const json = (body: unknown, status: number, extraHeaders: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { ...NO_STORE, ...extraHeaders } })

/**
 * Written by hand rather than through context.cookies.set because these
 * responses are built here and returned directly; a literal header keeps the
 * exact attribute set visible.
 *
 * SameSite=Lax, not Strict: Lax still withholds the cookie from cross-site
 * POSTs and fetches — which is what protects the API — but sends it on a
 * top-level navigation, so following a link or a bookmark into the portal does
 * not silently look like a signed-out session.
 */
const sessionCookie = (value: string, expires: Date | null, secure: boolean): string => {
  const attributes = [
    `${COOKIE_NAME}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    expires
      ? `Expires=${expires.toUTCString()}; Max-Age=${SESSION_TTL_SECONDS}`
      : 'Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0',
  ]
  // Omitted over plain HTTP so `netlify dev` on localhost can still sign in.
  if (secure) attributes.push('Secure')
  return attributes.join('; ')
}

const NOT_CONFIGURED =
  'Portal sign-in is not configured. Set the PORTAL_PASSWORD environment variable on this site (scoped so it is available at runtime), then redeploy.'

/* --------------------------------------------------------------- endpoints */

const handleLogin = async (req: Request, secure: boolean): Promise<Response> => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)

  const expected = portalPassword()
  if (!expected) return json({ error: NOT_CONFIGURED, configured: false }, 503)

  const body = (await req.json().catch(() => null)) as { password?: unknown } | null
  const provided = typeof body?.password === 'string' ? body.password.trim() : ''

  // Compared as digests so the comparison is constant-time over a fixed length
  // and the password's length is never inferable from the response.
  const [providedHash, expectedHash] = await Promise.all([
    sha256Hex(provided),
    sha256Hex(expected),
  ])

  if (!provided || !equalHex(providedHash, expectedHash)) {
    await sleep(WRONG_PASSWORD_DELAY_MS)
    return json({ error: 'That password is not right.' }, 401)
  }

  const { token, expires } = await issueToken()
  return json({ ok: true }, 200, { 'set-cookie': sessionCookie(token, expires, secure) })
}

const handleLogout = (req: Request, secure: boolean): Response => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)
  return json({ ok: true }, 200, { 'set-cookie': sessionCookie('', null, secure) })
}

const handleSession = async (context: Context): Promise<Response> => {
  const configured = Boolean(portalPassword())
  const authenticated = configured && (await tokenIsValid(context.cookies.get(COOKIE_NAME)))
  return json({ authenticated, configured }, 200)
}

/* ----------------------------------------------------------------- handler */

export default async (req: Request, context: Context) => {
  const url = new URL(req.url)
  const path = url.pathname
  const secure = url.protocol === 'https:'

  if (path === '/api/portal/login') return handleLogin(req, secure)
  if (path === '/api/portal/logout') return handleLogout(req, secure)
  if (path === '/api/portal/session') return handleSession(context)
  if (path.startsWith('/api/portal/')) return json({ error: 'Unknown endpoint.' }, 404)

  const configured = Boolean(portalPassword())
  if (configured && (await tokenIsValid(context.cookies.get(COOKIE_NAME)))) {
    // Signed in: hand the request straight on. A bare return is cheaper than
    // context.next(), which is only needed to inspect the upstream response.
    return
  }

  if (path.startsWith('/api/')) {
    return configured
      ? json({ error: 'Sign in to use the ApexVoice portal.' }, 401)
      : json({ error: NOT_CONFIGURED }, 503)
  }

  // A browser asking for the portal UI gets sent to the login page rather than
  // a bare 401, so the failure mode is a form instead of an error page.
  return new Response(null, {
    status: 302,
    headers: { location: LOGIN_PAGE, ...NO_STORE },
  })
}

export const config: Config = {
  path: [
    '/portal',
    '/portal/',
    '/portal/*',
    '/api/apexvoice/*',
    '/api/portal/*',
  ],
  // The login page must stay reachable while signed out. It is fully
  // self-contained (inline CSS and JS) so no other asset needs excluding.
  // Both spellings are listed because Netlify's pretty-URL processing serves
  // the page at /portal/login as well; gating that one would bounce it back to
  // /portal/login.html and straight into a redirect loop.
  excludedPath: ['/portal/login.html', '/portal/login'],
}
