import { protectForm } from './_security.js'
import { validateEmailQuality } from './_email-quality.js'
import { appendRow } from './_camp-automation.js'
import { JUNIORS_HEADERS, JUNIORS_SHEET_TAB, normaliseRegistration, rowFromRegistration, validateJuniorsRegistration, stripeCheckoutForm } from './_juniors-flow.js'

const sheetId = () => process.env.JUNIORS_SHEET_ID || process.env.CAMP_REGISTRATION_SHEET_ID
const tab = () => process.env.JUNIORS_SHEET_TAB || JUNIORS_SHEET_TAB

export async function addParentToBrevo(registration) {
  const apiKey = process.env.BREVO_API_KEY
  const listId = Number(process.env.BREVO_JUNIORS_LIST_ID || 61)
  if (!apiKey || !Number.isInteger(listId) || listId <= 0) throw new Error('Joners Juniors Brevo list is not configured.')
  const response = await fetch('https://api.brevo.com/v3/contacts', {
    method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json', 'api-key': apiKey },
    body: JSON.stringify({ email: registration.email, attributes: brevoAttributes(registration), listIds: [listId], updateEnabled: true }),
  })
  if (!response.ok) throw new Error('Could not save parent to the Joners Juniors list.')
  return { listId }
}

export function brevoAttributes(registration) {
  const parentParts = registration.parent.split(/\s+/)
  return { FIRSTNAME: parentParts[0] || registration.parent, SOURCE: registration.source, ...(parentParts.length > 1 ? { LASTNAME: parentParts.slice(1).join(' ') } : {}) }
}

export async function createCheckout(req, registration) {
  const secret = process.env.STRIPE_SECRET_KEY_SYDNEY || process.env.STRIPE_SECRET_KEY
  if (!secret) throw new Error('Sydney Stripe secret is not configured.')
  const baseUrl = (process.env.PUBLIC_SITE_URL || process.env.SITE_URL || `https://${req.headers.host || 'jonerfootball.com'}`).replace(/\/$/, '')
  const response = await fetch('https://api.stripe.com/v1/checkout/sessions', { method: 'POST', headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/x-www-form-urlencoded' }, body: stripeCheckoutForm(registration, baseUrl) })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || !data.id || !data.url) throw new Error(data.error?.message || 'Could not create Stripe Checkout session.')
  return data
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ success: false, error: 'Method not allowed' }) }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
    const protection = await protectForm(req, res, 'joners-juniors-registration', body)
    if (!protection.ok) return protection.response
    const registration = normaliseRegistration(body)
    const emailCheck = await validateEmailQuality(registration.email, { label: 'parent email' })
    const validation = validateJuniorsRegistration(registration, () => emailCheck)
    if (!validation.ok) return res.status(400).json({ success: false, error: validation.error })
    if (!sheetId()) return res.status(503).json({ success: false, error: 'Joners Juniors payment records are not configured.' })

    const brevo = await addParentToBrevo(registration)
    const checkout = await createCheckout(req, registration)
    // Paid At, Amount Paid and confirmation status remain blank until the signed paid webhook.
    await appendRow(sheetId(), tab(), rowFromRegistration(registration, { paymentStatus: 'pending', checkoutSessionId: checkout.id }), JUNIORS_HEADERS)
    return res.status(200).json({ success: true, registrationId: registration.registrationId, paymentLink: checkout.url, checkoutSessionId: checkout.id, brevo: { listId: brevo.listId } })
  } catch (error) {
    console.error('Joners Juniors registration failed:', error?.message || 'unknown error')
    return res.status(500).json({ success: false, error: 'Could not save your registration. Please try again.' })
  }
}
