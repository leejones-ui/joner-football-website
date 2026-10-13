import { protectForm } from './_security.js'
import { validateEmailQuality } from './_email-quality.js'
import { appendRow, readRows, updateCell } from './_camp-automation.js'
import { JUNIORS_HEADERS, JUNIORS_SHEET_TAB, normaliseRegistration, rowFromRegistration, validateJuniorsRegistration, stripeCheckoutForm } from './_juniors-flow.js'
import { captureWebsiteContact } from './_master-contact-capture.js'
import { configOrDefaults } from './_jj-data.js'
import { classFromChoice } from './_jj-config.js'
import { classFull, choiceFull, waitlistFromForm } from './_jj-requests.js'
import { sendJJRequestAlert } from './_jj-email.js'
import { audit } from './_jfp-store.js'

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
    // Term, dates, class and price from the Joners Juniors settings (portal).
    const { config, fallback } = await configOrDefaults()
    // Closed, or every place taken: the waitlist instead of Stripe (stage 2).
    const closed = config.juniors.registrationOpen === false
    const count = closed || fallback ? null : await classFull(config)
    // The class picked on the form (more than one class, stage 3), else every class.
    const full = choiceFull(config, count, body.classId || body.numberOfDays)
    if (closed || full) return await waitlistReply(res, body, config, { closed, full, fallback })
    const registration = normaliseRegistration(body, new Date(), config.juniors)
    const emailCheck = await validateEmailQuality(registration.email, { label: 'parent email' })
    const validation = validateJuniorsRegistration(registration, () => emailCheck)
    if (!validation.ok) return res.status(400).json({ success: false, error: validation.error })
    if (!sheetId()) return res.status(503).json({ success: false, error: 'Joners Juniors payment records are not configured.' })

    await appendRow(sheetId(), tab(), rowFromRegistration(registration, { paymentStatus: 'pending' }), JUNIORS_HEADERS)
    const brevo = await addParentToBrevo(registration)
    const checkout = await createCheckout(req, registration)
    // Paid At, Amount Paid and confirmation status remain blank until the signed paid webhook.
    const rows = await readRows(sheetId(), tab(), JUNIORS_HEADERS)
    const index = rows.findIndex((row, i) => i > 0 && row[1] === registration.registrationId)
    if (index < 0) throw new Error('Pending Joners Juniors registration could not be found.')
    await updateCell(sheetId(), tab(), index + 1, 'M', checkout.id)
    const masterCapture = await captureWebsiteContact({
      endpoint: 'juniors-registration', form: 'joners-juniors-paid-registration', phone: registration.mobile,
      email: registration.email, parentName: registration.parent, contactType: 'Parent/Guardian',
      country: 'AU', players: [{ name: registration.player }], source: 'joners-juniors-registration', sourceLabel: 'Joners Juniors', submittedAt: registration.submittedAt,
    })
    if (masterCapture.status === 'failed') console.error('Master contact capture failed:', masterCapture.reason)
    return res.status(200).json({ success: true, registrationId: registration.registrationId, paymentLink: checkout.url, checkoutSessionId: checkout.id, brevo: { listId: brevo.listId } })
  } catch (error) {
    console.error('Joners Juniors registration failed:', error?.message || 'unknown error')
    return res.status(500).json({ success: false, error: 'Could not save your registration. Please try again.' })
  }
}

// Closed, or every place taken (stage 2): no Stripe. Without waitlist:true
// the page is told to switch to the waitlist; with it, the request is saved
// for Requests & waitlist and only staff are emailed.
async function waitlistReply(res, body, config, { closed, full, fallback }) {
  if (body.waitlist !== true) return res.status(409).json({ success: false, closed, full, waitlist: true, error: closed ? 'Joners Juniors registrations are closed right now. Join the waitlist and we will contact you when a place opens.' : 'The class is full. Join the waitlist and we will contact you as soon as a place opens.' })
  if (fallback) return res.status(503).json({ success: false, error: 'Could not save your request. Please try again.' })
  const picked = config.juniors.classes.length > 1 ? classFromChoice(config.juniors, body.classId || body.numberOfDays) : null
  const saved = await waitlistFromForm(body, { term: config.juniors.term, why: closed ? 'closed' : 'full', classId: picked?.id || '' })
  if (!saved.ok) return res.status(400).json({ success: false, error: saved.error })
  if (!saved.already) {
    await audit({ by: saved.request.parent.email, action: 'jj.request.new', target: saved.request.id, after: { why: saved.request.why, term: saved.request.term } }).catch(() => {})
    // Staff only: the family sees their confirmation on the page.
    try { await sendJJRequestAlert({ request: saved.request }) } catch (error) { console.error('jj waitlist alert failed', error?.message) }
  }
  return res.status(200).json({ success: true, waitlist: true, already: Boolean(saved.already), requestId: saved.request.id })
}
