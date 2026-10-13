// Joners Juniors stage 2, the parts with no network: next term settings,
// several Stripe payments on one row, the waitlist order and the emails.
// Every name, email and amount is invented.
//   node scripts/test-jj-stage2.mjs
import assert from 'node:assert/strict'
import { normaliseJuniors, validateJuniors, nextTermOf, JJ_DEFAULTS } from '../api/_jj-config.js'
import { parseJJRecord } from '../api/_jj-data.js'
import { juniorsMoney } from '../api/_jfp-juniors-money.js'
import { requestsView } from '../api/_jj-requests.js'
import { jjAccountInvite, jjReminder, jjNextInvite } from '../api/_jj-email.js'
import { splitBy, jjPayreqUrl, jjPayreqIdFromSession, JJPAY } from '../api/_jj-pay.js'

let passed = 0
const test = (n, fn) => { fn(); passed += 1; console.log(`ok - ${n}`) }
const jj = normaliseJuniors({})

test('next term: price and hold are optional, checked, and the table comes from the term tables', () => {
  assert.deepEqual(nextTermOf(jj), { name: 'Term 1 2027', termStart: '', open: false, fullCents: 22000, holdCents: 0, table: '' })
  const set = normaliseJuniors({ nextTerm: { name: 'Term 1 2027', priceCents: 23000, holdCents: 5000 }, tables: { 'Term 1 2027': 'tblAAAAAAAAAAAAAA' } })
  assert.deepEqual({ ...nextTermOf(set) }, { name: 'Term 1 2027', termStart: '', open: false, fullCents: 23000, holdCents: 5000, table: 'tblAAAAAAAAAAAAAA' })
  assert.equal(validateJuniors({ nextTerm: { name: 'Term 1 2027', holdCents: 25000 } }, jj).ok, false, 'a hold over the price')
  assert.match(validateJuniors({ nextTerm: { name: 'Term 1 2027', priceCents: 5 } }, jj).errors.join(' '), /next term's price/)
  assert.equal(validateJuniors({ nextTerm: { name: 'Term 1 2027', priceCents: null, holdCents: '' } }, jj).ok, true, 'blank is fine')
  assert.equal(normaliseJuniors({ nextTerm: { priceCents: 'abc' } }).nextTerm.priceCents, null)
  assert.equal(JJ_DEFAULTS.nextTerm.holdCents, null)
})

test('a row keeps every Stripe payment it was paid with, and where it came from', () => {
  const r = parseJJRecord({ id: 'recAAAAAAAAAAAAA1', fields: { 'Player Full Name': 'Ada Junior', Notes: '2026-10-13: Held. [JJ-NEXT:recBBBBBBBBBBBBB2] [JJ-CS:cs_test_one] [JJ-PI:pi_one] [JJ-PAID:JJPAY-1-AAAAAA]\n2026-10-14: Rest. [JJ-CS:cs_test_two] [JJ-PI:pi_two] [JJ-PAID:JJPAY-2-BBBBBB]\n[JJ-REQ:JJREQ-1-CCCCCC]' } }, 'tbl', 'Term 1 2027')
  assert.deepEqual(r.sessionIds, ['cs_test_one', 'cs_test_two']); assert.deepEqual(r.intentIds, ['pi_one', 'pi_two'])
  assert.equal(r.sessionId, 'cs_test_one', 'the first stays the main one, as before')
  assert.deepEqual(r.paidRequests, ['JJPAY-1-AAAAAA', 'JJPAY-2-BBBBBB'])
  assert.equal(r.nextFrom, 'recBBBBBBBBBBBBB2'); assert.equal(r.requestId, 'JJREQ-1-CCCCCC')
  const col = parseJJRecord({ id: 'recAAAAAAAAAAAAA3', fields: { 'Stripe Checkout Session ID': 'cs_col', Notes: '[JJ-CS:cs_tag]' } })
  assert.deepEqual(col.sessionIds, ['cs_col', 'cs_tag'])
})

test('Juniors Money: a hold then the rest on one row is both payments, in the row\'s term', () => {
  const row = { id: 'recAAAAAAAAAAAAA1', table: 't', term: 'Term 1 2027', player: 'Ada Junior', parent: 'Ada Parent', emails: ['ada@example.com'], feeCents: 23000, status: 'Paid', paidVia: 'Stripe', sessionId: 'cs_one', intentId: 'pi_one', sessionIds: ['cs_one', 'cs_two'], intentIds: ['pi_one', 'pi_two'], linkUrl: '', registrationId: '', removed: null }
  const s = (id, cents) => ({ id, intentId: `pi_${id.slice(3)}`, paid: true, email: 'ada@example.com', amountCents: cents, refundedCents: 0, currency: 'aud', at: '2026-10-13T00:00:00Z', link: '', tagged: true, player: '', registrationId: '', feeKnown: true, feeCents: Math.round(cents * 0.02) + 20, feeGstCents: 0, found: ['row id'] })
  const m = juniorsMoney([row], { sessions: [s('cs_one', 5000), s('cs_two', 18000)], links: {} })
  const p = m.players[0]
  assert.equal(p.paidCents, 23000); assert.equal(p.status, 'paid'); assert.equal(p.payments.length, 2)
  assert.equal(m.byTerm['Term 1 2027'].collectedCents, 23000); assert.equal(m.unlinked.length, 0)
  assert.equal(m.byTerm['Term 1 2027'].feesCents, 120 + 380)
})

test('the waitlist: numbered in the order families asked; accepted ones show invited and paid', () => {
  const req = (id, status, at, x = {}) => ({ id, status, createdAt: at, why: 'full', term: 'Term 4 2026', player: { name: id, dob: '', medical: '' }, parent: { name: 'P', email: `${id}@example.com`, mobile: '' }, ...x })
  const list = [req('a', 'waiting', '2026-10-01'), req('b', 'declined', '2026-10-02'), req('c', 'waiting', '2026-10-03'), req('d', 'accepted', '2026-10-04', { rowId: 'recD' }), req('e', 'accepted', '2026-10-05', { rowId: 'recE' })]
  const v = requestsView(list, { rowsById: new Map([['recD', { status: 'Unpaid' }], ['recE', { status: 'Paid' }]]), invites: { 'new:d@example.com': { at: '2026-10-06' } }, placesLeft: 1 })
  assert.deepEqual(v.list.map((r) => [r.id, r.position, r.stage]), [['a', 1, 'waiting'], ['b', null, 'declined'], ['c', 2, 'waiting'], ['d', null, 'invited'], ['e', null, 'paid']])
  assert.deepEqual(v.counts, { waiting: 2, accepted: 2, declined: 1 }); assert.equal(v.placeFree, true)
  assert.equal(requestsView(list, { placesLeft: 0 }).placeFree, false)
})

test('the emails: amounts, the class, how to sign in, one waiver, and plain words (no em dashes)', () => {
  const kids = [{ name: 'Ada Junior', owingCents: 22000, needsWaiver: true }, { name: 'Bo Junior', owingCents: 0 }]
  const a = jjAccountInvite({ parentName: 'Pat Parent', children: kids, jj, signInUrl: 'https://x.test/jfp-account/', payUrl: 'https://x.test/jfp-account/?pay=JJPAY-1-AAAAAA', amountCents: 22000, needsWaiver: true, email: 'pat@example.com' })
  assert.match(a.subject, /Joners Juniors Term 4: A\$220 to pay/)
  for (const re of [/Ada and Bo/, /Saturday 9:15am to 10:00am/, /Sign in and pay/, /pat@example\.com/, /one waiver covers JFP and Joners Juniors/, /same account as JFP/]) assert.match(a.html, re)
  const none = jjAccountInvite({ parentName: 'Pat Parent', children: kids, jj, signInUrl: 'https://x.test/jfp-account/' })
  assert.match(none.subject, /your account is ready/); assert.match(none.html, /Nothing to pay/); assert.doesNotMatch(none.html, /\?pay=/)
  const r = jjReminder({ parentName: 'Pat Parent', children: kids, jj, url: 'https://x.test/jfp-account/?pay=JJPAY-1-AAAAAA', amountCents: 22000, needsWaiver: true })
  assert.match(r.subject, /Reminder: A\$220 to pay/); assert.match(r.html, /pay the A\$220 still owing and sign the waiver/)
  const w = jjReminder({ parentName: 'Pat Parent', children: kids, jj, url: 'https://x.test/jfp-account/', needsWaiver: true })
  assert.match(w.subject, /waiver/); assert.doesNotMatch(w.html, /still owing/)
  const held = normaliseJuniors({ nextTerm: { name: 'Term 1 2027', priceCents: 23000, holdCents: 5000 } })
  const n = jjNextInvite({ parentName: 'Pat Parent', children: kids.slice(0, 1), jj: held, url: 'https://x.test/jfp-account/' })
  assert.match(n.subject, /Term 1 2027/); assert.match(n.html, /Pay A\$230/); assert.match(n.html, /Hold the place for A\$50/)
  assert.doesNotMatch(jjNextInvite({ parentName: 'P', children: kids, jj, url: 'u' }).html, /Hold the place/, 'no hold set, no hold offered')
  for (const e of [a, none, r, w, n]) assert.ok(!/—|Term 3/.test(e.subject + e.html))
})

test('payments: split to the cent, the link never carries an email, ids are checked', () => {
  assert.deepEqual(splitBy(22000, [22000, 11000]), [14667, 7333])
  assert.deepEqual(splitBy(100, [0, 0, 0]), [34, 33, 33])
  assert.equal(jjPayreqUrl('https://x.test/', { id: 'JJPAY-1-AAAAAA' }), 'https://x.test/jfp-account/?pay=JJPAY-1-AAAAAA')
  assert.equal(jjPayreqIdFromSession({ metadata: { jjPayreqId: 'JJPAY-1781-ABC123' } }), 'JJPAY-1781-ABC123')
  assert.equal(jjPayreqIdFromSession({ metadata: { jjPayreqId: 'PAY-1781-ABC123' } }), '', 'a JFP id is not a Juniors one')
  assert.equal(jjPayreqIdFromSession({ metadata: { jfpBookingId: 'PAY-1-AAAAAA' } }), '')
  assert.ok(JJPAY.test('JJPAY-1781000000000-0A1B2C'))
})

console.log(`\n${passed} Joners Juniors stage 2 checks passed`)
