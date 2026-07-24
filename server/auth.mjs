// Optional single-password gate for the server vault.
//
// Nib has no user accounts: the server vault is one shared vault behind one
// optional password (NIB_PASSWORD). With no password set the API is wide open,
// which is the right default only when something else already guards the port
// (Tailscale, a VPN, an authenticating reverse proxy).
//
// Sessions are stateless: a signed "expiry" token in an HttpOnly cookie. No
// session store to keep, and revoking everything is a matter of changing the
// secret. Set NIB_SESSION_SECRET to keep sessions valid across restarts;
// otherwise a fresh random secret is generated at boot and a restart logs
// everyone out.

import crypto from 'node:crypto'

const COOKIE_NAME = 'nib_session'
const DEFAULT_TTL_DAYS = 30

// Failed logins are throttled per client IP so the password can't be ground
// down by a script. Counters live in memory and reset on restart.
const LOCKOUT_WINDOW_MS = 15 * 60_000
const MAX_ATTEMPTS = 10

export function createAuth(env = process.env) {
  const password = env.NIB_PASSWORD || ''
  const required = password.length > 0
  const secret = env.NIB_SESSION_SECRET
    ? Buffer.from(env.NIB_SESSION_SECRET, 'utf8')
    : crypto.randomBytes(32)
  const ttlMs = Number(env.NIB_SESSION_TTL_DAYS || DEFAULT_TTL_DAYS) * 86_400_000
  const attempts = new Map() // ip -> { count, resetAt }

  function sign(value) {
    return crypto.createHmac('sha256', secret).update(value).digest('base64url')
  }

  function issueToken() {
    const payload = String(Date.now() + ttlMs)
    return `${Buffer.from(payload, 'utf8').toString('base64url')}.${sign(payload)}`
  }

  function verifyToken(token) {
    if (typeof token !== 'string') return false
    const dot = token.indexOf('.')
    if (dot === -1) return false
    const payload = Buffer.from(token.slice(0, dot), 'base64url').toString('utf8')
    const expected = sign(payload)
    const given = token.slice(dot + 1)
    // Equal-length check first: timingSafeEqual throws on a length mismatch.
    if (given.length !== expected.length) return false
    if (!crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))) return false
    const expiresAt = Number(payload)
    return Number.isFinite(expiresAt) && expiresAt > Date.now()
  }

  function readCookie(req) {
    const header = req.headers.cookie
    if (!header) return null
    for (const part of header.split(';')) {
      const eq = part.indexOf('=')
      if (eq === -1) continue
      if (part.slice(0, eq).trim() === COOKIE_NAME) {
        return decodeURIComponent(part.slice(eq + 1).trim())
      }
    }
    return null
  }

  /** Is this request allowed to touch the vault? */
  function isAuthenticated(req) {
    if (!required) return true
    return verifyToken(readCookie(req))
  }

  function clientIp(req) {
    const forwarded = req.headers['x-forwarded-for']
    if (typeof forwarded === 'string' && forwarded) return forwarded.split(',')[0].trim()
    return req.socket.remoteAddress || 'unknown'
  }

  function throttled(ip) {
    const entry = attempts.get(ip)
    if (!entry) return false
    if (Date.now() > entry.resetAt) {
      attempts.delete(ip)
      return false
    }
    return entry.count >= MAX_ATTEMPTS
  }

  function recordFailure(ip) {
    const now = Date.now()
    const entry = attempts.get(ip)
    if (!entry || now > entry.resetAt) {
      attempts.set(ip, { count: 1, resetAt: now + LOCKOUT_WINDOW_MS })
    } else {
      entry.count += 1
    }
  }

  /**
   * Check a submitted password. Returns a `Set-Cookie` value on success, or an
   * error code ('throttled' | 'invalid').
   */
  function login(req, submitted) {
    const ip = clientIp(req)
    if (throttled(ip)) return { error: 'throttled' }

    const a = Buffer.from(String(submitted ?? ''), 'utf8')
    const b = Buffer.from(password, 'utf8')
    const ok = a.length === b.length && crypto.timingSafeEqual(a, b)
    if (!ok) {
      recordFailure(ip)
      return { error: 'invalid' }
    }
    attempts.delete(ip)
    return { cookie: buildCookie(req, issueToken(), ttlMs / 1000) }
  }

  function logoutCookie(req) {
    return buildCookie(req, '', 0)
  }

  function buildCookie(req, value, maxAgeSeconds) {
    // Strict SameSite is the primary CSRF defence: the vault API is only ever
    // called by the app served from the same origin, never by a cross-site
    // navigation. `Secure` is added only when the request actually arrived over
    // HTTPS — setting it unconditionally would break plain-HTTP LAN deploys,
    // which is how most self-hosters will run this.
    const https =
      req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted === true
    const parts = [
      `${COOKIE_NAME}=${encodeURIComponent(value)}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Strict',
      `Max-Age=${Math.floor(maxAgeSeconds)}`,
    ]
    if (https) parts.push('Secure')
    return parts.join('; ')
  }

  return { required, isAuthenticated, login, logoutCookie }
}
