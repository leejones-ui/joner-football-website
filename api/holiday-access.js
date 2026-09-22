// The front door for parents. One shared password, checked here on the
// server, turned into a signed HttpOnly cookie. The booking page itself is
// static and holds no slot data, so without this cookie there is nothing to see.
import { rateLimit, verifyRecaptcha } from './_security.js'
import { passwordMatches, signAccessCookie, accessCookieHeader, clearAccessCookieHeader, hasHolidayAccess } from './_holiday-store.js'

function parse(req) { return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}) }

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  if (req.method === 'GET') {
    return res.status(200).json({ success: true, ok: hasHolidayAccess(req) })
  }

  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' })

  let body
  try { body = parse(req) } catch { return res.status(400).json({ success: false, error: 'Invalid request' }) }

  if (body.logout === true) {
    res.setHeader('Set-Cookie', clearAccessCookieHeader())
    return res.status(200).json({ success: true, ok: false })
  }

  const limited = rateLimit(req, { key: 'holiday-access', limit: 8, windowMs: 60_000 })
  if (!limited.allowed) {
    res.setHeader('Retry-After', String(limited.retryAfterSeconds))
    return res.status(429).json({ success: false, error: 'Too many attempts. Wait a minute and try again.' })
  }

  const recaptcha = await verifyRecaptcha(req, body.recaptchaToken)
  if (!recaptcha.ok) return res.status(400).json({ success: false, error: recaptcha.error })

  if (!process.env.HOLIDAY_BOOKING_PASSWORD) {
    return res.status(503).json({ success: false, error: 'Holiday bookings are not open yet.' })
  }

  if (!passwordMatches(String(body.password || ''))) {
    return res.status(401).json({ success: false, error: 'That password is not right. Check the message from Joner Football and try again.' })
  }

  res.setHeader('Set-Cookie', accessCookieHeader(signAccessCookie()))
  return res.status(200).json({ success: true, ok: true })
}
