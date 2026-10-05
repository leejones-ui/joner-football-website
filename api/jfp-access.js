// Parent front door for JFP bookings: one shared password, checked here,
// turned into a signed HttpOnly cookie. Separate password from holidays.
import { rateLimit, verifyRecaptcha } from './_security.js'
import { parentPasswordMatches, signParentCookie, parentCookieHeader, hasParentAccess, clean, validEmail, getConfig } from './_jfp-store.js'
import { sendContactMessage } from './_jfp-email.js'

function parse(req) { return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}) }

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  // release: the exact commit serving this request, for release receipts.
  if (req.method === 'GET') return res.status(200).json({ success: true, ok: hasParentAccess(req) || (await getConfig()).passwordRequired === false, release: String(process.env.VERCEL_GIT_COMMIT_SHA || 'local').slice(0, 12) })
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' })
  let body
  try { body = parse(req) } catch { return res.status(400).json({ success: false, error: 'Invalid request' }) }
  // Contact us (any family page, no password needed): one message to Ligia.
  if (body.action === 'contact') {
    if (!rateLimit(req, { key: 'jfp-contact', limit: 3, windowMs: 10 * 60_000 }).allowed) return res.status(429).json({ success: false, error: 'Too many messages. Try again in a few minutes.' })
    const rc = await verifyRecaptcha(req, body.recaptchaToken)
    if (!rc.ok) return res.status(400).json({ success: false, error: rc.error })
    const name = clean(body.name, 100), email = validEmail(body.email), phone = clean(body.phone, 40), message = String(body.message || '').trim().slice(0, 3000)
    if (name.length < 2 || !email || message.length < 5) return res.status(400).json({ success: false, error: 'Add your name, email and a message.' })
    try { await sendContactMessage({ name, email, phone, message, page: clean(body.page, 80) }) } catch (error) {
      console.error('jfp contact failed', error)
      return res.status(502).json({ success: false, error: 'Your message did not send. Email ligia@jonerfootball.com instead.' })
    }
    return res.status(200).json({ success: true })
  }
  const limited = rateLimit(req, { key: 'jfp-access', limit: 8, windowMs: 60_000 })
  if (!limited.allowed) return res.status(429).json({ success: false, error: 'Too many attempts. Wait a minute and try again.' })
  const recaptcha = await verifyRecaptcha(req, body.recaptchaToken)
  if (!recaptcha.ok) return res.status(400).json({ success: false, error: recaptcha.error })
  if (!process.env.JFP_BOOKING_PASSWORD) return res.status(503).json({ success: false, error: 'JFP bookings are not open yet.' })
  if (!parentPasswordMatches(String(body.password || ''))) return res.status(401).json({ success: false, error: 'That password is not right. Check the message from Joner Football.' })
  res.setHeader('Set-Cookie', parentCookieHeader(signParentCookie()))
  return res.status(200).json({ success: true, ok: true })
}
