import { cleanEmail, protectForm } from './_security.js'
import { syncCoachingProsLead } from './_coaching-pros-brevo.js'

const MAX_BODY_BYTES = 8 * 1024

function noStore(res) {
  res.setHeader('Cache-Control', 'no-store, private, max-age=0')
  res.setHeader('Pragma', 'no-cache')
}

function requestHost(req) {
  const forwarded = req.headers['x-forwarded-host']
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded
  return String(value || req.headers.host || '').split(',')[0].trim().toLowerCase()
}

export function validLeadOrigin(req) {
  const origin = req.headers.origin
  if (!origin) return false
  try {
    return new URL(origin).host.toLowerCase() === requestHost(req)
  } catch {
    return false
  }
}

export function validLeadBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false
  try {
    return Buffer.byteLength(JSON.stringify(body), 'utf8') <= MAX_BODY_BYTES
  } catch {
    return false
  }
}

export default async function handler(req, res) {
  noStore(res)
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ success: false, error: 'Method not allowed.' })
  }

  if (!validLeadOrigin(req)) {
    return res.status(403).json({ success: false, error: 'Request origin is not allowed.' })
  }
  if (!validLeadBody(req.body)) {
    return res.status(413).json({ success: false, error: 'Request is too large or invalid.' })
  }

  const protection = await protectForm(req, res, 'coaching-pros-lead', req.body)
  if (!protection.ok) return protection.response

  const email = cleanEmail(req.body.email, 200)
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return res.status(400).json({ success: false, error: 'Enter a valid email address.' })
  }

  const marketingConsent = req.body.marketingConsent === true

  // Preview-safe activation gate: the connector cannot write to Brevo unless
  // the exact list exists and the integration is explicitly enabled.
  if (marketingConsent && process.env.COACHING_PROS_BREVO_ENABLED !== 'true') {
    return res.status(503).json({
      success: false,
      error: 'Marketing sign-up is not active yet. Untick the optional updates box to continue to the free episode.',
    })
  }

  try {
    const result = await syncCoachingProsLead({
      email,
      marketingConsent,
      apiKey: process.env.BREVO_API_KEY,
      listId: process.env.BREVO_COACHING_PROS_LIST_ID,
    })

    return res.status(200).json({
      success: true,
      marketing: result.marketing,
      saved: result.saved,
    })
  } catch (error) {
    console.error('Coaching Pros lead sync failed:', error?.message || error)
    return res.status(502).json({
      success: false,
      error: 'We could not save your request. Please try again.',
    })
  }
}
