import { verifyStripeWebhook } from './_stripe-webhook.js'
import { readRows, updateCell } from './_camp-automation.js'
import { confirmationEmail, JUNIORS_HEADERS, JUNIORS_SHEET_TAB, isPaidJuniorsEvent, paidEventDetails, shouldSendEmail } from './_juniors-flow.js'

export const config = { api: { bodyParser: false } }
const sheetId = () => process.env.JUNIORS_SHEET_ID || process.env.CAMP_REGISTRATION_SHEET_ID
const tab = () => process.env.JUNIORS_SHEET_TAB || JUNIORS_SHEET_TAB

async function rawBody(req) {
  if (typeof req.body === 'string') return req.body
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8')
  const chunks = []
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

async function airtableRequest(path, init = {}) {
  const token = process.env.AIRTABLE_API_TOKEN || process.env.AIRTABLE_TOKEN
  const baseId = process.env.AIRTABLE_BASE_ID
  const table = process.env.JUNIORS_AIRTABLE_TABLE || 'Joners Juniors'
  if (!token || !baseId) throw new Error('Joners Juniors Airtable is not configured.')
  const response = await fetch(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers || {}) } })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error?.message || 'Airtable request failed.')
  return data
}

function formulaValue(value) { return String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'") }

async function upsertPaidAirtable(registration, details) {
  const table = process.env.JUNIORS_AIRTABLE_TABLE || 'Joners Juniors'
  const formula = `{Registration ID}='${formulaValue(registration.registrationId)}'`
  const found = await airtableRequest(`?maxRecords=1&filterByFormula=${encodeURIComponent(formula)}`)
  const fields = {
    'Registration ID': registration.registrationId, Programme: 'Joners Juniors', Player: registration.player, Parent: registration.parent,
    'Parent Email': registration.email, Mobile: registration.mobile, 'Date Of Birth': registration.dateOfBirth,
    'Medical / Allergies': registration.medical, Class: registration.className, 'Term Dates': registration.termDates,
    'Amount AUD': 220, 'Payment Status': 'paid', 'Stripe Checkout Session ID': details.checkoutSessionId,
    'Stripe Payment Intent ID': details.paymentIntentId, 'Paid At': new Date().toISOString(), Source: registration.source,
  }
  if (found.records?.[0]?.id) {
    await airtableRequest(`/${found.records[0].id}`, { method: 'PATCH', body: JSON.stringify({ fields }) })
    return found.records[0].id
  }
  const created = await airtableRequest('', { method: 'POST', body: JSON.stringify({ fields }) })
  return created.id
}

async function sendEmail({ to, subject, html, replyTo }) {
  const apiKey = process.env.BREVO_API_KEY
  if (!apiKey) throw new Error('Brevo email is not configured.')
  const response = await fetch('https://api.brevo.com/v3/smtp/email', { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json', 'api-key': apiKey }, body: JSON.stringify({ sender: { name: 'Joner Football', email: process.env.BREVO_SENDER_EMAIL || 'leejones@jonerfootball.com' }, to: [{ email: to }], ...(replyTo ? { replyTo: { email: replyTo, name: 'Ligia' } } : {}), subject, html }) })
  if (!response.ok) throw new Error('Brevo email send failed.')
  return true
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' })
  try {
    const raw = await rawBody(req)
    await verifyStripeWebhook(raw, req.headers['stripe-signature'], process.env.STRIPE_JUNIORS_WEBHOOK_SECRET)
    const event = JSON.parse(raw)
    if (!isPaidJuniorsEvent(event)) return res.status(200).json({ received: true, ignored: true, reason: 'not-paid-juniors-event' })
    const details = paidEventDetails(event)
    if (details.amountTotal !== 22000 || details.currency !== 'aud' || !details.registrationId) return res.status(200).json({ received: true, ignored: true, reason: 'amount-or-registration-mismatch' })
    const rows = await readRows(sheetId(), tab(), JUNIORS_HEADERS)
    const index = rows.findIndex((row, i) => i > 0 && row[1] === details.registrationId)
    if (index < 0) return res.status(200).json({ received: true, ignored: true, reason: 'registration-not-found' })
    const rowNumber = index + 1
    const registration = { submittedAt: rows[index][0], registrationId: rows[index][1], paymentStatus: rows[index][2], programme: rows[index][3], player: rows[index][4], parent: rows[index][5], email: rows[index][6], mobile: rows[index][7], dateOfBirth: rows[index][8], medical: rows[index][9], className: rows[index][10], termDates: rows[index][11], amountAud: 220, source: rows[index][18] }
    details.checkoutSessionId ||= rows[index][13] || ''
    details.paymentIntentId ||= rows[index][14] || ''
    const alreadyPaid = rows[index][2] === 'paid'
    if (!alreadyPaid) {
      await updateCell(sheetId(), tab(), rowNumber, 'C', 'paid')
      if (details.checkoutSessionId) await updateCell(sheetId(), tab(), rowNumber, 'N', details.checkoutSessionId)
      if (details.paymentIntentId) await updateCell(sheetId(), tab(), rowNumber, 'O', details.paymentIntentId)
    }
    const airtableRecordId = await upsertPaidAirtable(registration, details)
    if (rows[index][15] !== airtableRecordId) await updateCell(sheetId(), tab(), rowNumber, 'P', airtableRecordId)
    let customerSent = !shouldSendEmail(rows[index][16])
    let internalSent = !shouldSendEmail(rows[index][17])
    if (!customerSent) { await sendEmail({ to: registration.email, replyTo: process.env.JUNIORS_REPLY_TO_EMAIL || 'ligia@jonerfootball.com', subject: 'Your Joners Juniors spot is confirmed', html: confirmationEmail({ registration }) }); await updateCell(sheetId(), tab(), rowNumber, 'Q', new Date().toISOString()); customerSent = true }
    if (!internalSent) { await sendEmail({ to: process.env.JUNIORS_INTERNAL_EMAIL || 'ligia@jonerfootball.com', subject: `PAID Joners Juniors signup: ${registration.player}`, html: confirmationEmail({ registration, internal: true, refs: { ...details, airtableRecordId, sheetRef: tab() } }) }); await updateCell(sheetId(), tab(), rowNumber, 'R', new Date().toISOString()); internalSent = true }
    return res.status(200).json({ received: true, paid: true, registrationId: details.registrationId, airtableRecordId, customerSent, internalSent })
  } catch (error) {
    console.error('Joners Juniors webhook failed:', error?.message || 'unknown error')
    return res.status(400).json({ received: false, error: error?.message || 'Webhook failed.' })
  }
}

export { upsertPaidAirtable, sendEmail }
