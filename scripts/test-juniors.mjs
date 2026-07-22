import test from 'node:test'
import assert from 'node:assert/strict'
import {
  JUNIORS_AMOUNT_AUD,
  JUNIORS_CLASS,
  JUNIORS_TERM,
  confirmationEmail,
  isPaidJuniorsEvent,
  normaliseRegistration,
  paidEventDetails,
  shouldSendEmail,
  stripeCheckoutForm,
  validateJuniorsRegistration,
} from '../api/_juniors-flow.js'

const valid = () => normaliseRegistration({ playerFullName: 'Sam Jones', parentName: 'Lee Jones', email: 'parent@example.com', mobile: '0400000000', dateOfBirth: '01/01/2021', source: 'Google', agreementAccepted: true }, new Date('2026-07-01T00:00:00Z'))

test('valid Juniors registration is normalised with stable programme details', () => {
  const registration = valid()
  assert.equal(registration.programme, 'Joners Juniors')
  assert.equal(registration.className, JUNIORS_CLASS)
  assert.equal(registration.termDates, JUNIORS_TERM)
  assert.equal(validateJuniorsRegistration(registration).ok, true)
})

test('invalid parent email and missing agreement are rejected', () => {
  const registration = normaliseRegistration({ playerFullName: 'Sam Jones', parentName: 'Lee', email: 'not-an-email', mobile: '0400', dateOfBirth: '01/01/2021', source: 'Google' })
  assert.equal(validateJuniorsRegistration(registration).ok, false)
  registration.email = 'parent@example.com'
  assert.match(validateJuniorsRegistration(registration).error, /agreement/i)
})

test('Checkout is a unique AUD 220 session with traceable metadata', () => {
  const params = stripeCheckoutForm(valid(), 'https://jonerfootball.com')
  assert.equal(params.get('line_items[0][price_data][unit_amount]'), String(JUNIORS_AMOUNT_AUD))
  assert.equal(params.get('line_items[0][price_data][currency]'), 'aud')
  assert.equal(params.get('metadata[programme]'), 'Joners Juniors')
  assert.equal(params.get('metadata[player]'), 'Sam Jones')
  assert.equal(params.get('metadata[class]'), JUNIORS_CLASS)
  assert.match(params.get('success_url'), /session_id=\{CHECKOUT_SESSION_ID\}/)
  assert.equal(params.has('payment_link'), false)
})

test('only paid Juniors events are accepted', () => {
  const event = { type: 'checkout.session.completed', data: { object: { id: 'cs_123', payment_status: 'paid', amount_total: 22000, currency: 'aud', metadata: { programme: 'Joners Juniors', registrationId: 'JJ-1', player: 'Sam Jones', class: JUNIORS_CLASS } } } }
  assert.equal(isPaidJuniorsEvent(event), true)
  assert.equal(paidEventDetails(event).registrationId, 'JJ-1')
  assert.equal(isPaidJuniorsEvent({ ...event, type: 'checkout.session.expired' }), false)
  assert.equal(isPaidJuniorsEvent({ ...event, data: { object: { ...event.data.object, metadata: { programme: 'Old closed camp', registrationId: 'CAMP-1' } } } }), false)
})

test('duplicate webhook delivery does not require another email after sent markers exist', () => {
  assert.equal(shouldSendEmail(''), true)
  assert.equal(shouldSendEmail('2026-07-01T00:00:00.000Z'), false)
})

test('confirmation email stays text-led and avoids retired camp language', () => {
  const html = confirmationEmail({ registration: valid() })
  assert.match(html, /Your Joners Juniors spot is confirmed/)
  assert.match(html, /Saturday training runs from 9:15am to 10:00am/)
  assert.match(html, /25 July 2026 to 26 September 2026/)
  assert.doesNotMatch(html, /camp|jersey|refund|app sales|multi-day/i)
})
