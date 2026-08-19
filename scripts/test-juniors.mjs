import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  JUNIORS_AMOUNT_AUD, JUNIORS_CLASS, JUNIORS_HEADERS, JUNIORS_TERM, confirmationEmail,
  confirmationStatus, isPaidJuniorsEvent, normaliseRegistration, paidEventDetails,
  eventClaimOwnsRow, isFreshClaim, rowFromRegistration, serializeConfirmationStatus, shouldClaimEmail, shouldDuplicateProcessing, shouldUpsertAirtable, stripeCheckoutForm,
  validateJuniorsRegistration,
} from '../api/_juniors-flow.js'
import { brevoAttributes } from '../api/juniors-registration.js'
import { airtableFieldsFromRegistration } from '../api/juniors-payment-webhook.js'

const valid = () => normaliseRegistration({ playerFullName: 'Sam Jones', parentName: 'Lee Jones', email: 'parent@example.com', mobile: '0400000000', dateOfBirth: '01/01/2021', heardAboutUs: 'Google', agreementAccepted: true }, new Date('2026-07-01T00:00:00Z'))

const expectedHeaders = [
  'Paid At', 'Registration ID', 'Payment Status', 'Player Full Name', 'Date of Birth', 'Parent Name',
  'Parent Email', 'Parent Mobile', 'Medical History / Allergies', 'Heard About Us', 'Class', 'Amount Paid',
  'Stripe Checkout Session ID', 'Stripe PaymentIntent ID / Refund Link', 'Confirmation Email Status',
]

test('verified live Google Sheets schema is exactly 15 columns and maps pending/paid rows', () => {
  assert.deepEqual(JUNIORS_HEADERS, expectedHeaders)
  const registration = valid()
  const pending = rowFromRegistration(registration, { paymentStatus: 'pending', checkoutSessionId: 'cs_1' })
  assert.equal(pending.length, 15)
  assert.equal(pending[0], '')
  assert.equal(pending[2], 'pending')
  assert.equal(pending[3], 'Sam Jones')
  assert.equal(pending[9], 'Google')
  assert.equal(pending[11], '')
  assert.equal(pending[12], 'cs_1')
  const paid = rowFromRegistration(registration, { paidAt: '2026-07-01T00:00:00Z', paymentStatus: 'paid', amountAud: 220, checkoutSessionId: 'cs_1', paymentIntentId: 'pi_1', confirmationEmailStatus: '{"customer":"sent","internal":"sent"}' })
  assert.deepEqual(paid, ['2026-07-01T00:00:00Z', pending[1], 'paid', 'Sam Jones', '01/01/2021', 'Lee Jones', 'parent@example.com', '0400000000', 'None supplied', 'Google', JUNIORS_CLASS, 220, 'cs_1', 'pi_1', '{"customer":"sent","internal":"sent"}'])
})

test('Airtable fields match the verified live field names exactly', () => {
  const fields = airtableFieldsFromRegistration(valid(), { paidAt: '2026-07-01T00:00:00Z', checkoutSessionId: 'cs_1', paymentIntentId: 'pi_1' })
  const expected = ['Player Full Name', 'Date of Birth', 'Parent Name', 'Parent Email', 'Parent Mobile', 'Medical History / Allergies', 'Class', 'Session Day', 'Session Time', 'Location', 'Term', 'Fee', 'Payment Status', 'Paid Via', 'Paid At', 'Registration ID', 'Stripe Checkout Session ID', 'Stripe PaymentIntent ID', 'Heard About Us', 'Confirmation Email Status', 'Internal Notes']
  assert.deepEqual(Object.keys(fields), expected)
  assert.equal(fields['Payment Status'], 'Paid')
  assert.equal(fields['Fee'], 220)
})

test('Brevo uses only allowed attributes and the dedicated list default is present', () => {
  const attrs = brevoAttributes(valid())
  assert.deepEqual(Object.keys(attrs).sort(), ['FIRSTNAME', 'LASTNAME', 'SOURCE'])
  assert.equal(readFileSync(new URL('../api/juniors-registration.js', import.meta.url), 'utf8').includes('BREVO_JUNIORS_LIST_ID || 61'), true)
  assert.equal(['PLAYER_NAME', 'JUNIORS_REGISTRATION_ID', 'JUNIORS_CLASS'].some((name) => Object.hasOwn(attrs, name)), false)
})

test('valid registration, exact AUD 220 checkout and required metadata', () => {
  const registration = valid()
  assert.equal(registration.programme, 'Joners Juniors')
  assert.equal(validateJuniorsRegistration(registration).ok, true)
  const params = stripeCheckoutForm(registration, 'https://jonerfootball.com')
  assert.equal(params.get('line_items[0][price_data][unit_amount]'), String(JUNIORS_AMOUNT_AUD))
  assert.equal(params.get('line_items[0][price_data][currency]'), 'aud')
  for (const key of ['metadata[programme]', 'metadata[registrationId]', 'metadata[class]']) assert.ok(params.get(key))
  assert.equal(params.get('metadata[programme]'), 'Joners Juniors')
  assert.equal(params.has('payment_link'), false)
})

test('only paid checkout.session.completed Juniors events are accepted', () => {
  const event = { type: 'checkout.session.completed', data: { object: { id: 'cs_123', payment_status: 'paid', amount_total: 22000, currency: 'aud', metadata: { programme: 'Joners Juniors', registrationId: 'JJ-1', player: 'Sam Jones', class: JUNIORS_CLASS } } } }
  assert.equal(isPaidJuniorsEvent(event), true)
  assert.equal(paidEventDetails(event).registrationId, 'JJ-1')
  for (const type of ['payment_intent.succeeded', 'checkout.session.async_payment_succeeded', 'checkout.session.expired']) assert.equal(isPaidJuniorsEvent({ ...event, type }), false)
  assert.equal(isPaidJuniorsEvent({ ...event, data: { object: { ...event.data.object, payment_status: 'unpaid' } } }), false)
})

test('independent durable email status prevents duplicate customer or internal sends', () => {
  const status = confirmationStatus('{"customer":"sent","internal":"in_progress"}')
  assert.equal(shouldClaimEmail(status, 'customer'), false)
  assert.equal(shouldClaimEmail(status, 'internal'), false)
  assert.equal(serializeConfirmationStatus(status), '{"customer":"sent","internal":"in_progress"}')
  assert.equal(shouldClaimEmail({ customer: '', internal: 'sent' }, 'customer'), true)
  const processing = confirmationStatus('{"customer":"","internal":"","eventId":"evt_1","processing":true}')
  assert.equal(processing.processing, true)
  assert.equal(processing.eventId, 'evt_1')
  assert.equal(serializeConfirmationStatus({ ...processing, airtable: 'synced', airtableRecordId: 'rec_1' }), '{"customer":"","internal":"","eventId":"evt_1","processing":true,"airtable":"synced","airtableRecordId":"rec_1"}')
})

test('event claim ownership survives re-read and rejects a different event stealing a completed row', () => {
  assert.equal(eventClaimOwnsRow('{"eventId":"evt_1","processing":true}', 'evt_1'), true)
  assert.equal(eventClaimOwnsRow({ eventId: 'evt_1', processing: false }, 'evt_1'), true)
  assert.equal(eventClaimOwnsRow({ eventId: 'evt_1', processing: false }, 'evt_2'), false)
  assert.equal(shouldUpsertAirtable({ airtable: 'synced' }), false)
  assert.equal(shouldUpsertAirtable({ eventId: 'evt_1', processing: false }), true)
})

test('processing and email claims recover after the deterministic 15-minute lease', () => {
  const now = Date.parse('2026-07-01T00:20:00.000Z')
  assert.equal(isFreshClaim('2026-07-01T00:10:01.000Z', now), true)
  assert.equal(isFreshClaim('2026-07-01T00:04:59.000Z', now), false)
  assert.equal(shouldDuplicateProcessing({ eventId: 'evt_1', processing: true, processingAt: '2026-07-01T00:10:01.000Z' }, 'evt_1', now), true)
  assert.equal(shouldDuplicateProcessing({ eventId: 'evt_1', processing: true, processingAt: '2026-07-01T00:04:59.000Z' }, 'evt_1', now), false)
  assert.equal(shouldClaimEmail({ customer: 'in_progress', customerAt: '2026-07-01T00:04:59.000Z' }, 'customer', now), true)
  assert.equal(shouldClaimEmail({ customer: 'in_progress', customerAt: '2026-07-01T00:10:01.000Z' }, 'customer', now), false)
})

test('parent confirmation copy has no camp, jersey or payment-reminder wording', () => {
  const html = confirmationEmail({ registration: valid() })
  assert.match(html, /Your Joners Juniors spot is confirmed/)
  assert.match(html, /Saturday training runs from 9:15am to 10:00am/)
  assert.match(html, /25 July 2026 to 26 September 2026/)
  assert.doesNotMatch(html, /camp|jersey|refund|reminder|unpaid/i)
})

test('test-email endpoint is secret protected, allowlisted, preview-only by default, and labels review copy', () => {
  const source = readFileSync(new URL('../api/juniors-email-test.js', import.meta.url), 'utf8')
  assert.match(source, /JUNIORS_EMAIL_TEST_SECRET \|\| process\.env\.CAMP_EMAIL_TEST_SECRET/)
  assert.match(source, /Recipient is not an approved test address/)
  assert.match(source, /TEST FOR REVIEW ONLY/)
  assert.match(source, /previewOnly !== false/)
  assert.match(source, /JUNIORS_EMAIL_TEST_REPLY_TO \|\| 'leejones@jonerfootball\.com'/)
  assert.doesNotMatch(source, /JUNIORS_REPLY_TO_EMAIL \|\| 'ligia@jonerfootball\.com'/)
  assert.doesNotMatch(source, /juniors-payment-webhook/)
})

test('public registration errors are generic and do not expose provider messages', () => {
  const source = readFileSync(new URL('../api/juniors-registration.js', import.meta.url), 'utf8')
  assert.match(source, /Could not save your registration\. Please try again\./)
  assert.doesNotMatch(source, /error: error\?\.message/)
})

test('registration persists before Checkout and updates column M before returning its URL', () => {
  const source = readFileSync(new URL('../api/juniors-registration.js', import.meta.url), 'utf8')
  assert.ok(source.indexOf('await appendRow(') < source.indexOf('await createCheckout('))
  assert.ok(source.indexOf('await updateCell(') < source.indexOf('return res.status(200).json({ success: true, registrationId: registration.registrationId, paymentLink'))
  assert.ok(source.includes("updateCell(sheetId(), tab(), index + 1, 'M', checkout.id)"))
})

test('full class waitlist path sends no Checkout request and routes internally to Joners Juniors', () => {
  const source = readFileSync(new URL('../api/juniors-registration.js', import.meta.url), 'utf8')
  assert.ok(source.indexOf("registration.waitlist ? 'waitlist' : 'pending'") >= 0)
  assert.ok(source.indexOf("if (registration.waitlist)") < source.indexOf('await createCheckout('))
  assert.ok(source.includes("to: 'jonersjuniors@jonerfootball.com'"))
})

test('test-email endpoint requires the secret header and uses a rate limit', () => {
  const source = readFileSync(new URL('../api/juniors-email-test.js', import.meta.url), 'utf8')
  const emailHelper = readFileSync(new URL('../api/_juniors-email.js', import.meta.url), 'utf8')
  assert.ok(source.includes("req.headers['x-juniors-email-test-secret']"))
  assert.equal(source.includes('body.secret'), false)
  assert.ok(source.includes("rateLimit(req, { key: 'joners-juniors-email-test'"))
  assert.ok(source.includes('body.send !== true'))
  assert.match(emailHelper, /htmlContent:\s*html/)
})

test('webhook lock cleanup compares and deletes the tracked promise', () => {
  const source = readFileSync(new URL('../api/juniors-payment-webhook.js', import.meta.url), 'utf8')
  assert.ok(source.includes('locks.get(registrationId) === tracked'))
})

test('Airtable confirmation status is patched after durable Google status writes', () => {
  const source = readFileSync(new URL('../api/juniors-payment-webhook.js', import.meta.url), 'utf8')
  assert.match(source, /updateCell\(sheetId\(\), sheet, rowNumber, 'O'/)
  assert.match(source, /syncAirtableConfirmationStatus\(airtableRecordId, status\)/)
  assert.match(source, /await persistStatus\(rowNumber, status, airtableRecordId\)/)
})
