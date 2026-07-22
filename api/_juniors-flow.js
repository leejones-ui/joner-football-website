import { randomUUID } from 'node:crypto'

export const JUNIORS_PROGRAMME = 'Joners Juniors'
export const JUNIORS_AMOUNT_AUD = 22000
export const JUNIORS_CLASS = 'Saturday 9:15am to 10:00am'
export const JUNIORS_TERM = '25 July 2026 to 26 September 2026'
export const JUNIORS_SHEET_TAB = 'Joners Juniors'
export const JUNIORS_AIRTABLE_TABLE = 'Joners Juniors'

export const JUNIORS_HEADERS = [
  'Submitted At', 'Registration ID', 'Payment Status', 'Programme', 'Player', 'Parent', 'Parent Email',
  'Mobile', 'Date Of Birth', 'Medical / Allergies', 'Class', 'Term Dates', 'Amount AUD', 'Stripe Checkout Session ID',
  'Stripe Payment Intent ID', 'Airtable Record ID', 'Customer Email Sent At', 'Internal Email Sent At', 'Source',
]

export function clean(value, max = 500) {
  return String(value ?? '').replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, max)
}

export function normaliseRegistration(body = {}, now = new Date()) {
  const player = clean(body.playerFullName || `${body.playerFirstName || ''} ${body.playerSurname || ''}`, 160).replace(/\s+/g, ' ')
  return {
    submittedAt: now.toISOString(),
    registrationId: clean(body.registrationId, 120) || `JJ-${now.getTime()}-${randomUUID().slice(0, 8).toUpperCase()}`,
    programme: JUNIORS_PROGRAMME,
    player,
    parent: clean(body.parentName, 160),
    email: clean(body.email, 220).toLowerCase(),
    mobile: clean(body.mobile, 80),
    dateOfBirth: clean(body.dateOfBirth || body.dob, 80),
    medical: clean(body.medicalHistory || body.medical, 1200) || 'None supplied',
    className: JUNIORS_CLASS,
    termDates: JUNIORS_TERM,
    source: clean(body.source, 120),
    agreementAccepted: body.agreementAccepted === true || body.agreementAccepted === 'true' || body.agreementAccepted === 'on',
    paymentStatus: 'pending',
    amountAud: JUNIORS_AMOUNT_AUD / 100,
  }
}

export function validateJuniorsRegistration(registration, emailValidator = null) {
  const required = ['player', 'parent', 'email', 'mobile', 'dateOfBirth', 'source']
  const missing = required.find((field) => !registration[field])
  if (missing) return { ok: false, error: `${missing} is required.` }
  if (emailValidator) {
    const result = emailValidator(registration.email)
    if (!result?.ok) return { ok: false, error: result?.error || 'Enter a valid parent email address.' }
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(registration.email)) {
    return { ok: false, error: 'Enter a valid parent email address.' }
  }
  if (!registration.agreementAccepted) return { ok: false, error: 'Training agreement must be accepted.' }
  return { ok: true }
}

export function isJuniorsMetadata(metadata = {}) {
  return clean(metadata.programme || metadata.program || '', 80).toLowerCase() === JUNIORS_PROGRAMME.toLowerCase()
}

export function stripeCheckoutForm(registration, siteUrl) {
  const base = String(siteUrl || '').replace(/\/$/, '')
  const fields = {
    mode: 'payment',
    success_url: `${base}/jonersjuniors/?payment=success&registration_id=${encodeURIComponent(registration.registrationId)}&session_id={CHECKOUT_SESSION_ID}#book`,
    cancel_url: `${base}/jonersjuniors/?payment=cancelled&registration_id=${encodeURIComponent(registration.registrationId)}#book`,
    customer_email: registration.email,
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'aud',
    'line_items[0][price_data][unit_amount]': String(JUNIORS_AMOUNT_AUD),
    'line_items[0][price_data][product_data][name]': 'Joners Juniors Term 3 2026',
    'line_items[0][price_data][product_data][metadata][programme]': JUNIORS_PROGRAMME,
    'line_items[0][price_data][product_data][metadata][class]': JUNIORS_CLASS,
    'metadata[registrationId]': registration.registrationId,
    'metadata[programme]': JUNIORS_PROGRAMME,
    'metadata[player]': registration.player,
    'metadata[class]': JUNIORS_CLASS,
    'payment_intent_data[metadata][registrationId]': registration.registrationId,
    'payment_intent_data[metadata][programme]': JUNIORS_PROGRAMME,
    'payment_intent_data[metadata][player]': registration.player,
    'payment_intent_data[metadata][class]': JUNIORS_CLASS,
  }
  return new URLSearchParams(fields)
}

export function paidEventDetails(event = {}) {
  const object = event.data?.object || {}
  const metadata = object.metadata || object.payment_intent?.metadata || {}
  const paymentIntent = typeof object.payment_intent === 'object' ? object.payment_intent : {}
  return {
    registrationId: clean(metadata.registrationId, 120),
    programme: clean(metadata.programme || metadata.program, 80),
    player: clean(metadata.player, 160),
    className: clean(metadata.class, 120),
    checkoutSessionId: clean(object.object === 'checkout.session' ? object.id : object.id && event.type?.startsWith('checkout.') ? object.id : '', 120),
    paymentIntentId: clean(typeof object.payment_intent === 'string' ? object.payment_intent : paymentIntent.id, 120),
    amountTotal: Number(object.amount_total || paymentIntent.amount_received || object.amount_received || 0),
    currency: clean(object.currency || paymentIntent.currency, 10).toLowerCase(),
    paid: object.payment_status === 'paid' || object.status === 'succeeded' || paymentIntent.status === 'succeeded',
  }
}

export function isPaidJuniorsEvent(event = {}) {
  return ['checkout.session.completed', 'payment_intent.succeeded'].includes(event.type)
    && isJuniorsMetadata(event.data?.object?.metadata || event.data?.object?.payment_intent?.metadata)
    && paidEventDetails(event).paid
}

export function rowFromRegistration(registration, details = {}) {
  return [registration.submittedAt, registration.registrationId, details.paymentStatus || registration.paymentStatus, JUNIORS_PROGRAMME,
    registration.player, registration.parent, registration.email, registration.mobile, registration.dateOfBirth, registration.medical,
    registration.className, registration.termDates, details.amountAud ?? registration.amountAud, details.checkoutSessionId || '',
    details.paymentIntentId || '', details.airtableRecordId || '', details.customerEmailSentAt || '', details.internalEmailSentAt || '', registration.source]
}

export function shouldSendEmail(sentAt) {
  return !clean(sentAt, 80)
}

export function confirmationEmail({ registration, internal = false, refs = {} }) {
  const player = escapeHtml(registration.player)
  const parent = escapeHtml(registration.parent)
  const details = `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;color:#111"><tr><td style="padding:9px 0;font-weight:800">Player</td><td style="padding:9px 0">${player}</td></tr><tr><td style="padding:9px 0;font-weight:800">Parent</td><td style="padding:9px 0">${parent}</td></tr><tr><td style="padding:9px 0;font-weight:800">Class</td><td style="padding:9px 0">${escapeHtml(registration.className)}</td></tr><tr><td style="padding:9px 0;font-weight:800">Term</td><td style="padding:9px 0">${escapeHtml(registration.termDates)}</td></tr></table>`
  if (internal) return `<div style="font-family:Arial,sans-serif;color:#111;max-width:680px"><h1 style="background:#050505;color:#fff;padding:20px;border-left:8px solid #e30613">PAID Joners Juniors signup: ${player}</h1>${details}<p><b>Contact:</b> ${escapeHtml(registration.email)} / ${escapeHtml(registration.mobile)}<br><b>DOB:</b> ${escapeHtml(registration.dateOfBirth)}<br><b>Medical:</b> ${escapeHtml(registration.medical)}<br><b>Amount:</b> AUD $220.00<br><b>Registration:</b> ${escapeHtml(registration.registrationId)}<br><b>Stripe Checkout:</b> ${escapeHtml(refs.checkoutSessionId || '')}<br><b>Stripe Payment Intent:</b> ${escapeHtml(refs.paymentIntentId || '')}<br><b>Sheet:</b> ${escapeHtml(refs.sheetRef || JUNIORS_SHEET_TAB)}<br><b>Airtable:</b> ${escapeHtml(refs.airtableRecordId || 'Joners Juniors')}</p></div>`
  return `<!doctype html><html><body style="margin:0;background:#f2f2ef;font-family:Arial,Helvetica,sans-serif;color:#111"><div style="max-width:620px;margin:0 auto;padding:18px"><div style="background:#050505;color:#fff;padding:24px;border-top:8px solid #e30613"><div style="color:#e30613;font-weight:900;letter-spacing:2px">JONER FOOTBALL</div><h1 style="font-size:34px;line-height:1.05;margin:18px 0">Your Joners Juniors spot is confirmed</h1><p style="font-size:17px;line-height:1.5">Hi ${parent}, ${player}'s spot is confirmed.</p></div><div style="background:#fff;padding:24px">${details}<p style="line-height:1.6">Saturday training runs from 9:15am to 10:00am at Joner Football HQ, Unit 2, 20 Narabang Way, Belrose.</p><p style="line-height:1.6">Term 3 runs from 25 July 2026 to 26 September 2026. Please bring suitable footwear and a drink bottle.</p><p style="line-height:1.6">If you need anything, reply to Ligia and the team will help you out.</p><p style="font-weight:800">See you at HQ,<br>Lee<br><span style="color:#e30613">Joner Football</span></p></div></div></body></html>`
}

export function escapeHtml(value) { return clean(value, 4000).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;') }
