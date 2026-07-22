import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  JUNIORS_AMOUNT_AUD, JUNIORS_CLASS, JUNIORS_HEADERS, JUNIORS_TERM, confirmationEmail,
  confirmationStatus, isPaidJuniorsEvent, normaliseRegistration, paidEventDetails,
  rowFromRegistration, serializeConfirmationStatus, shouldClaimEmail, stripeCheckoutForm,
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
  assert.equal(fields['Payment Status'], 'paid')
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
  assert.doesNotMatch(source, /juniors-payment-webhook/)
})
