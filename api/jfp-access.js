// Parent front door for JFP bookings: one shared password, checked here,
// turned into a signed HttpOnly cookie. Separate password from holidays.
import { rateLimit, verifyRecaptcha } from './_security.js'
import { parentPasswordMatches, signParentCookie, parentCookieHeader, hasParentAccess } from './_jfp-store.js'

function parse(req) { return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}) }

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method === 'GET') return res.status(200).json({ success: true, ok: hasParentAccess(req) })
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' })
  let body
  try { body = parse(req) } catch { return res.status(400).json({ success: false, error: 'Invalid request' }) }
  const limited = rateLimit(req, { key: 'jfp-access', limit: 8, windowMs: 60_000 })
  if (!limited.allowed) return res.status(429).json({ success: false, error: 'Too many attempts. Wait a minute and try again.' })
  const recaptcha = await verifyRecaptcha(req, body.recaptchaToken)
  if (!recaptcha.ok) return res.status(400).json({ success: false, error: recaptcha.error })
  if (!process.env.JFP_BOOKING_PASSWORD) return res.status(503).json({ success: false, error: 'JFP bookings are not open yet.' })
  if (!parentPasswordMatches(String(body.password || ''))) return res.status(401).json({ success: false, error: 'That password is not right. Check the message from Joner Football.' })
  res.setHeader('Set-Cookie', parentCookieHeader(signParentCookie()))
  return res.status(200).json({ success: true, ok: true })
}
