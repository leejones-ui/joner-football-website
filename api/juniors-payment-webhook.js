import { verifyStripeWebhook } from './_stripe-webhook.js'
import { readRows, updateCell } from './_camp-automation.js'
import { confirmationEmail, confirmationStatus, eventClaimOwnsRow, isPaidJuniorsEvent, JUNIORS_HEADERS, JUNIORS_SHEET_TAB, paidEventDetails, serializeConfirmationStatus, shouldClaimEmail, shouldUpsertAirtable } from './_juniors-flow.js'
import { sendJuniorsEmail } from './_juniors-email.js'

export const config = { api: { bodyParser: false } }
const sheetId = () => process.env.JUNIORS_SHEET_ID || process.env.CAMP_REGISTRATION_SHEET_ID
const tab = () => process.env.JUNIORS_SHEET_TAB || JUNIORS_SHEET_TAB
const locks = new Map()

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

export async function upsertPaidAirtable(registration, details) {
  const formula = `{Registration ID}='${formulaValue(registration.registrationId)}'`
  const found = await airtableRequest(`?maxRecords=1&filterByFormula=${encodeURIComponent(formula)}`)
  const fields = airtableFieldsFromRegistration(registration, details)
  if (found.records?.[0]?.id) {
    await airtableRequest(`/${found.records[0].id}`, { method: 'PATCH', body: JSON.stringify({ fields }) })
    return found.records[0].id
  }
  const created = await airtableRequest('', { method: 'POST', body: JSON.stringify({ fields }) })
  return created.id
}

export async function syncAirtableConfirmationStatus(recordId, status) {
  if (!recordId) throw new Error('Joners Juniors Airtable record is unavailable.')
  await airtableRequest(`/${recordId}`, { method: 'PATCH', body: JSON.stringify({ fields: { 'Confirmation Email Status': serializeConfirmationStatus(status) } }) })
}

export function airtableFieldsFromRegistration(registration, details = {}) {
  return {
    'Player Full Name': registration.player, 'Date of Birth': registration.dateOfBirth, 'Parent Name': registration.parent,
    'Parent Email': registration.email, 'Parent Mobile': registration.mobile, 'Medical History / Allergies': registration.medical,
    'Class': registration.className, 'Session Day': 'Saturday', 'Session Time': '9:15am to 10:00am',
    'Location': 'Joner Football HQ, Unit 2, 20 Narabang Way, Belrose', 'Term': registration.termDates, 'Fee': 220,
    'Payment Status': 'Paid', 'Paid Via': 'Stripe', 'Paid At': details.paidAt || '', 'Registration ID': registration.registrationId,
    'Stripe Checkout Session ID': details.checkoutSessionId || '', 'Stripe PaymentIntent ID': details.paymentIntentId || '',
    'Heard About Us': registration.source, 'Confirmation Email Status': details.confirmationEmailStatus || '',
    'Internal Notes': 'Joners Juniors paid signup',
  }
}

async function updateStatus(sheet, rowNumber, status) {
  await updateCell(sheetId(), sheet, rowNumber, 'O', serializeConfirmationStatus(status))
}

async function persistStatus(rowNumber, status, airtableRecordId) {
  await updateStatus(tab(), rowNumber, status)
  if (airtableRecordId) await syncAirtableConfirmationStatus(airtableRecordId, status)
}

async function processPaid(event) {
  const details = paidEventDetails(event)
  if (details.amountTotal !== 22000 || details.currency !== 'aud' || !details.registrationId) return { ignored: true, reason: 'amount-or-registration-mismatch' }
  const rows = await readRows(sheetId(), tab(), JUNIORS_HEADERS)
  const index = rows.findIndex((row, i) => i > 0 && row[1] === details.registrationId)
  if (index < 0) return { ignored: true, reason: 'registration-not-found' }
  const rowNumber = index + 1
  const registration = {
    registrationId: rows[index][1], paymentStatus: rows[index][2], player: rows[index][3], dateOfBirth: rows[index][4],
    parent: rows[index][5], email: rows[index][6], mobile: rows[index][7], medical: rows[index][8], source: rows[index][9],
    className: rows[index][10], termDates: '25 July 2026 to 26 September 2026', amountAud: 220,
  }
  details.checkoutSessionId ||= rows[index][12] || ''
  details.paymentIntentId ||= rows[index][13] || ''
  details.paidAt = new Date().toISOString()

  // These writes make paid processing and email claims durable in the 15-column row.
  await updateCell(sheetId(), tab(), rowNumber, 'A', details.paidAt)
  await updateCell(sheetId(), tab(), rowNumber, 'C', 'paid')
  await updateCell(sheetId(), tab(), rowNumber, 'L', '220')
  await updateCell(sheetId(), tab(), rowNumber, 'M', details.checkoutSessionId)
  await updateCell(sheetId(), tab(), rowNumber, 'N', details.paymentIntentId)

  let status = confirmationStatus(rows[index][14])
  // Claim the payment event in the single durable status cell before the
  // Airtable upsert. A duplicate delivery on another server instance then
  // cannot create a second record while this event is in flight.
  const eventId = event.id || details.checkoutSessionId
  if (status.eventId && !eventClaimOwnsRow(status, eventId)) return { ignored: true, reason: 'different-event-claim', registrationId: details.registrationId }
  if (status.processing && eventClaimOwnsRow(status, eventId)) return { duplicate: true, registrationId: details.registrationId }
  status = { ...status, eventId, processing: true }
  await updateStatus(tab(), rowNumber, status)
  // Google Sheets is not CAS. Re-read O immediately and only continue if this
  // event still owns the claim, protecting against cross-instance races.
  const claimedRows = await readRows(sheetId(), tab(), JUNIORS_HEADERS)
  const claimedRow = claimedRows.find((row, i) => i > 0 && row[1] === details.registrationId)
  if (!claimedRow || !eventClaimOwnsRow(claimedRow[14], eventId)) throw new Error('Juniors event claim was lost.')
  let airtableRecordId
  airtableRecordId = status.airtableRecordId || ''
  if (shouldUpsertAirtable(status)) {
    try {
      airtableRecordId = await upsertPaidAirtable(registration, { ...details, confirmationEmailStatus: serializeConfirmationStatus(status) })
      status = { ...status, airtable: 'synced', airtableRecordId }
      await persistStatus(rowNumber, status, airtableRecordId)
    } catch (error) {
      // Release the durable claim when the upsert itself fails so Stripe retry can recover.
      try { await updateStatus(tab(), rowNumber, { ...status, processing: false }) } catch { /* original failure is the actionable error */ }
      throw error
    }
  }
  status = { ...status, processing: false }
  await persistStatus(rowNumber, status, airtableRecordId)
  const internalEmail = process.env.JUNIORS_INTERNAL_EMAIL || 'ligia@jonerfootball.com'
  const replyTo = process.env.JUNIORS_REPLY_TO_EMAIL || 'ligia@jonerfootball.com'

  for (const [kind, to, subject, internal] of [
    ['customer', registration.email, 'Your Joners Juniors spot is confirmed', false],
    ['internal', internalEmail, `PAID Joners Juniors signup: ${registration.player}`, true],
  ]) {
    if (!shouldClaimEmail(status, kind)) continue
    const priorStatus = status
    status = { ...status, [kind]: 'in_progress' }
    try {
      await persistStatus(rowNumber, status, airtableRecordId)
    } catch (error) {
      try { await updateStatus(tab(), rowNumber, priorStatus) } catch { /* preserve the original failure */ }
      throw error
    }
    // If send succeeds but this next status write fails, leave in_progress and throw;
    // Stripe retries, and in_progress suppresses a duplicate while the other email can proceed.
    await sendJuniorsEmail({ to, subject, replyTo: internal ? undefined : replyTo, html: confirmationEmail({ registration, internal, refs: { ...details, airtableRecordId, sheetRef: tab() } }) })
    status = { ...status, [kind]: 'sent' }
    await persistStatus(rowNumber, status, airtableRecordId)
  }
  return { paid: true, registrationId: details.registrationId, airtableRecordId, confirmationEmailStatus: status }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' })
  try {
    const raw = await rawBody(req)
    await verifyStripeWebhook(raw, req.headers['stripe-signature'], process.env.STRIPE_JUNIORS_WEBHOOK_SECRET)
    const event = JSON.parse(raw)
    if (!isPaidJuniorsEvent(event)) return res.status(200).json({ received: true, ignored: true, reason: 'not-paid-juniors-event' })
    const registrationId = paidEventDetails(event).registrationId
    const prior = locks.get(registrationId) || Promise.resolve()
    const current = prior.then(() => processPaid(event))
    locks.set(registrationId, current.catch(() => {}))
    try { return res.status(200).json({ received: true, ...(await current) }) } finally { if (locks.get(registrationId) === current) locks.delete(registrationId) }
  } catch (error) {
    console.error('Joners Juniors webhook failed:', error?.message || 'unknown error')
    return res.status(500).json({ received: false, error: 'Webhook processing failed; Stripe should retry.' })
  }
}

export { airtableRequest, sendJuniorsEmail }
