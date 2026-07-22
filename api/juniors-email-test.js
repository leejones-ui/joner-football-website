import { confirmationEmail, normaliseRegistration } from './_juniors-flow.js'
import { sendJuniorsEmail } from './_juniors-email.js'
import { rateLimit } from './_security.js'

const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
function jsonBody(req) {
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}')
  if (Buffer.isBuffer(req.body)) return JSON.parse(req.body.toString('utf8') || '{}')
  return req.body || {}
}
function allowedRecipients() {
  return new Set([
    process.env.JUNIORS_INTERNAL_EMAIL || 'ligia@jonerfootball.com',
    process.env.JUNIORS_EMAIL_TEST_REPLY_TO || 'leejones@jonerfootball.com',
    ...(process.env.JUNIORS_EMAIL_TEST_RECIPIENTS || '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean),
  ])
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ success: false, error: 'Method not allowed' }) }
  const secret = process.env.JUNIORS_EMAIL_TEST_SECRET || process.env.CAMP_EMAIL_TEST_SECRET
  if (!secret) return res.status(404).json({ success: false, error: 'Test email endpoint is not enabled.' })
  if (req.headers['x-juniors-email-test-secret'] !== secret) return res.status(401).json({ success: false, error: 'Unauthorized' })
  const limited = rateLimit(req, { key: 'joners-juniors-email-test', limit: 5, windowMs: 60_000 })
  if (!limited.allowed) { res.setHeader('Retry-After', String(limited.retryAfterSeconds)); return res.status(429).json({ success: false, error: limited.error }) }
  let body
  try { body = jsonBody(req) } catch { return res.status(400).json({ success: false, error: 'Invalid JSON.' }) }

  const to = String(body.toEmail || body.email || '').trim().toLowerCase()
  if (!validEmail.test(to) || !allowedRecipients().has(to)) return res.status(400).json({ success: false, error: 'Recipient is not an approved test address.' })
  const registration = normaliseRegistration({
    playerFullName: body.playerFullName || 'Preview Player', parentName: body.parentName || 'Ligia', email: to,
    mobile: body.mobile || '0400000000', dateOfBirth: body.dateOfBirth || '01/01/2021', source: body.heardAboutUs || 'Test preview', agreementAccepted: true,
  })
  const subject = body.subject || '[TEST FOR REVIEW] Your Joners Juniors spot is confirmed'
  const html = confirmationEmail({ registration, reviewNote: 'TEST FOR REVIEW ONLY: Ligia, please review the parent confirmation below. No Stripe event or customer record was created.' })
  if (body.previewOnly !== false && body.send !== true) return res.status(200).json({ success: true, previewOnly: true, subject, html })
  try {
    await sendJuniorsEmail({ to, subject, html, replyTo: process.env.JUNIORS_EMAIL_TEST_REPLY_TO || 'leejones@jonerfootball.com' })
    return res.status(200).json({ success: true, sent: true, subject })
  } catch (error) {
    console.error('Joners Juniors test email failed:', error?.message || 'unknown error')
    return res.status(500).json({ success: false, error: 'Could not send test email.' })
  }
}
