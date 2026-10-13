import { verifyStripeWebhook } from './_stripe-webhook.js'
import { readRows, updateCell } from './_camp-automation.js'
import { confirmationEmail, confirmationStatus, eventClaimOwnsRow, isPaidJuniorsEvent, JUNIORS_HEADERS, JUNIORS_SHEET_TAB, JUNIORS_AMOUNT_AUD, paidEventDetails, serializeConfirmationStatus, shouldClaimEmail, shouldDuplicateProcessing, shouldUpsertAirtable, juniorsTerms } from './_juniors-flow.js'
import { sendJuniorsEmail } from './_juniors-email.js'
import { configOrDefaults, tableFor, findByRegistration, writeJJRow, NAMES } from './_jj-data.js'
import { coachById } from './_jfp-store.js'
import { stripeFetch } from './_holiday-store.js'
import { jjWebhook } from './_jj-pay.js'

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

// The paid child goes into the Juniors table for the term they paid for
// (config.juniors.tables), through the Juniors data layer: a column that
// table does not have is left out, and the registration and Stripe ids are
// kept in the row's notes instead, so a retry finds the same row and the
// money is matched to it. The old single "Joners Juniors" table setting is a
// last resort only.
const recordTables = new Map()
const BY_NAME = Object.fromEntries(Object.entries(NAMES).flatMap(([key, names]) => names.map((n) => [n, key])))
export function canonicalFromAirtable(fields) {
  const set = {}
  let note = ''
  for (const [name, value] of Object.entries(fields)) {
    const key = BY_NAME[name]
    if (key === 'notes') note = value
    else if (key) set[key] = value
  }
  return { set, note }
}

export async function upsertPaidAirtable(registration, details, config) {
  // The term paid for; a term with no table set falls back to the current term's.
  const table = tableFor(config, registration.term) || tableFor(config) || process.env.JUNIORS_AIRTABLE_TABLE || 'Joners Juniors'
  const existing = await findByRegistration(table, registration.registrationId)
  const { set, note } = canonicalFromAirtable(airtableFieldsFromRegistration(registration, details))
  const coach = coachById(config, registration.coachId || '')
  if (coach?.airtableName) set.coach = coach.airtableName
  const id = await writeJJRow(table, { id: existing?.id || '', set, note: existing ? '' : note })
  recordTables.set(id, table)
  return id
}

export async function syncAirtableConfirmationStatus(recordId, status) {
  if (!recordId) throw new Error('Joners Juniors Airtable record is unavailable.')
  const table = recordTables.get(recordId) || tableFor((await configOrDefaults()).config) || process.env.JUNIORS_AIRTABLE_TABLE || 'Joners Juniors'
  // A table with no "Confirmation Email Status" column: nothing to write (the sheet keeps it).
  await writeJJRow(table, { id: recordId, set: { confirmationEmail: serializeConfirmationStatus(status) } })
}

export function airtableFieldsFromRegistration(registration, details = {}) {
  return {
    'Player Full Name': registration.player, 'Date of Birth': registration.dateOfBirth, 'Parent Name': registration.parent,
    'Parent Email': registration.email, 'Parent Mobile': registration.mobile, 'Medical History / Allergies': registration.medical,
    // The same day, time and place as the rows staff add (Saturday, 9:15am,
    // Belrose HQ), so the class and the register find the child.
    'Class': registration.className, 'Session Day': registration.day || juniorsTerms().day, 'Session Time': registration.time || juniorsTerms().time,
    'Location': registration.classLocation || juniorsTerms().classLocation, 'Term': registration.term || juniorsTerms().term, 'Fee': (registration.amountCents ?? JUNIORS_AMOUNT_AUD) / 100,
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

export const JONERS_JUNIORS_INTERNAL_EMAIL = 'jonersjuniors@jonerfootball.com'
export const JONERS_JUNIORS_REPLY_TO_EMAIL = 'jonersjuniors@jonerfootball.com'

export async function processPaid(event) {
  const details = paidEventDetails(event)
  const { config } = await configOrDefaults()
  // The amount this checkout asked for (in its metadata), or for a checkout
  // made before that was added, the price then (A$220) or now.
  const allowed = details.expectedCents ? [details.expectedCents] : [JUNIORS_AMOUNT_AUD, config.juniors.priceCents]
  if (!allowed.includes(details.amountTotal) || details.currency !== 'aud' || !details.registrationId) return { ignored: true, reason: 'amount-or-registration-mismatch' }
  const rows = await readRows(sheetId(), tab(), JUNIORS_HEADERS)
  const index = rows.findIndex((row, i) => i > 0 && row[1] === details.registrationId)
  if (index < 0) return { ignored: true, reason: 'registration-not-found' }
  const rowNumber = index + 1
  // The term this checkout was for (its metadata), else the term running now.
  const jj = config.juniors
  // The class on the sign-up row (its label), so a second class is written as itself.
  const t = juniorsTerms(jj, rows[index][10] || '')
  const term = details.term || jj.term
  const registration = {
    ...t,
    registrationId: rows[index][1], paymentStatus: rows[index][2], player: rows[index][3], dateOfBirth: rows[index][4],
    parent: rows[index][5], email: rows[index][6], mobile: rows[index][7], medical: rows[index][8], source: rows[index][9],
    className: rows[index][10] || t.className, term, termShort: term === jj.term ? t.termShort : term.replace(/\s+\d{4}$/, ''), termDates: term === jj.term ? t.termDates : term,
    amountCents: details.amountTotal, amountAud: details.amountTotal / 100,
  }
  details.checkoutSessionId ||= rows[index][12] || ''
  details.paymentIntentId ||= rows[index][13] || ''
  details.paidAt = new Date().toISOString()

  // These writes make paid processing and email claims durable in the 15-column row.
  await updateCell(sheetId(), tab(), rowNumber, 'A', details.paidAt)
  await updateCell(sheetId(), tab(), rowNumber, 'C', 'paid')
  await updateCell(sheetId(), tab(), rowNumber, 'L', String(registration.amountAud))
  await updateCell(sheetId(), tab(), rowNumber, 'M', details.checkoutSessionId)
  await updateCell(sheetId(), tab(), rowNumber, 'N', details.paymentIntentId)

  let status = confirmationStatus(rows[index][14])
  // Claim the payment event in the single durable status cell before the
  // Airtable upsert. A duplicate delivery on another server instance then
  // cannot create a second record while this event is in flight.
  const eventId = event.id || details.checkoutSessionId
  if (status.eventId && !eventClaimOwnsRow(status, eventId)) return { ignored: true, reason: 'different-event-claim', registrationId: details.registrationId }
  if (shouldDuplicateProcessing(status, eventId)) return { duplicate: true, registrationId: details.registrationId }
  status = { ...status, eventId, processing: true, processingAt: new Date().toISOString() }
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
      airtableRecordId = await upsertPaidAirtable(registration, { ...details, confirmationEmailStatus: serializeConfirmationStatus(status) }, config)
      status = { ...status, airtable: 'synced', airtableRecordId }
      await persistStatus(rowNumber, status, airtableRecordId)
    } catch (error) {
      // Release the durable claim when the upsert itself fails so Stripe retry can recover.
      try { await updateStatus(tab(), rowNumber, { ...status, processing: false, processingAt: '' }) } catch { /* original failure is the actionable error */ }
      throw error
    }
  }
  status = { ...status, processing: false, processingAt: '' }
  await persistStatus(rowNumber, status, airtableRecordId)
  const internalEmail = JONERS_JUNIORS_INTERNAL_EMAIL
  const replyTo = JONERS_JUNIORS_REPLY_TO_EMAIL

  for (const [kind, to, subject, internal] of [
    ['customer', registration.email, 'Your Joners Juniors spot is confirmed', false],
    ['internal', internalEmail, `PAID Joners Juniors signup: ${registration.player}`, true],
  ]) {
    if (!shouldClaimEmail(status, kind)) continue
    const priorStatus = status
    status = { ...status, [kind]: 'in_progress', [`${kind}At`]: new Date().toISOString() }
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
    // A Juniors payment from the family account (stage 2): the session is
    // read again from Stripe, and the same finalise as the main webhook runs
    // (a lease and per-row tags, so both arriving changes nothing twice).
    const obj = event?.data?.object || {}
    if (String(event.type || '').startsWith('checkout.session.') && obj.metadata?.jjPayreqId && /^cs_(test|live)_/.test(obj.id || '')) {
      const session = await stripeFetch(`/checkout/sessions/${encodeURIComponent(obj.id)}`)
      const jj = await jjWebhook(event.type, session)
      if (jj) return res.status(jj.status).json({ received: jj.status === 200, ...jj.body })
    }
    if (!isPaidJuniorsEvent(event)) return res.status(200).json({ received: true, ignored: true, reason: 'not-paid-juniors-event' })
    const registrationId = paidEventDetails(event).registrationId
    const prior = locks.get(registrationId) || Promise.resolve()
    const current = prior.then(() => processPaid(event))
    let tracked
    const cleanup = () => { if (locks.get(registrationId) === tracked) locks.delete(registrationId) }
    tracked = current.then(cleanup, cleanup)
    locks.set(registrationId, tracked)
    try { return res.status(200).json({ received: true, ...(await current) }) } finally { cleanup() }
  } catch (error) {
    console.error('Joners Juniors webhook failed:', error?.message || 'unknown error')
    return res.status(500).json({ received: false, error: 'Webhook processing failed; Stripe should retry.' })
  }
}

export { airtableRequest, sendJuniorsEmail }
