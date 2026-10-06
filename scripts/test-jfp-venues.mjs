// Revenue by venue: pure-function checks. No network, no KV.
import assert from 'node:assert/strict'
import { splitCents, allocateTermMoney, venuesForTerm, venuesFromLedger, juniorsByVenue, previousTerm, totalOf } from '../api/_jfp-venues.js'

let passed = 0
function test(name, fn) { fn(); passed += 1; console.log(`ok - ${name}`) }

const HQ = { id: 'belrose-hq', name: 'Belrose HQ' }
const NTRA = { id: 'ntra', name: 'NTRA' }
const RYD = { id: 'rydalmere', name: 'Rydalmere' }
const LOCS = [HQ, NTRA, RYD]
const venueOf = (r) => ({ 'Belrose HQ': HQ, NTRA, Rydalmere: RYD }[r.location] || { id: 'other', name: 'Other' })
const groupOf = (r) => ({ key: `${r.day}|${r.time}|${r.location}`, label: `${r.day} ${r.time}`, coach: r.coach || '' })
const row = (id, location, extra = {}) => ({ id, player: `Player ${id}`, email: `${id}@example.com`, location, day: 'Monday', time: '4:20pm', coach: 'Dean', feeAud: 850, paidAud: 0, holdsPlace: true, ...extra })

test('cents split by weight always add back to the total', () => {
  assert.deepEqual(splitCents(100, [1, 1, 1]), [34, 33, 33])
  assert.deepEqual(splitCents(85000, [85000, 85000]), [42500, 42500])
  assert.deepEqual(splitCents(1000, [0, 0]), [500, 500], 'no fees set: equal shares')
  assert.deepEqual(splitCents(-425, [1]), [-425], 'a refund stays negative')
  for (const [t, w] of [[99999, [3, 7, 11]], [1, [5, 5, 5]], [-1001, [2, 1]]]) assert.equal(splitCents(t, w).reduce((a, b) => a + b, 0), t)
})

test('every payment lands on a row or in "not linked", never twice, never lost', () => {
  const rows = [
    row('a', 'Belrose HQ'), row('b', 'NTRA'),
    row('s1', 'Belrose HQ', { email: 'fam@example.com', feeAud: 850 }), row('s2', 'Rydalmere', { email: 'fam@example.com', feeAud: 425 }),
    row('gone', 'Belrose HQ', { email: 'gone@example.com', holdsPlace: false }),
    row('old', 'NTRA', { paidAud: 300 }),
  ]
  const stripe = [
    { id: 'cs_rec', intentId: 'pi_rec', email: 'someone-else@example.com', amountCents: 85000, refundedCents: 0 }, // recorded against row a in the ledger
    { id: 'cs_fam', email: 'fam@example.com', amountCents: 127500, refundedCents: 0 }, // siblings at two venues
    { id: 'cs_gone', email: 'gone@example.com', amountCents: 85000, refundedCents: 42500 }, // removed player, half refunded
    { id: 'cs_stranger', email: 'stranger@example.com', amountCents: 10000, refundedCents: 0 },
  ]
  const ledger = [
    { 'Payment ID': 'pi_rec', 'Payment Method': 'Stripe', 'Amount Paid': 850, 'Source Record ID': 'a' },
    { 'Payment ID': 'BANK-1', 'Payment Method': 'Bank Transfer', 'Amount Paid': 850, 'Source Record ID': 'b' },
    { 'Payment ID': 'CASH-1', 'Payment Method': 'Cash', 'Amount Paid': 200, 'Source Record ID': 'zzz' }, // row not found
    { 'Payment ID': 'X', 'Payment Method': '', 'Amount Paid': 999, 'Source Record ID': 'a' }, // no method: not income, as on the dashboard
  ]
  const alloc = allocateTermMoney({ rows, stripe, ledger, legacy: [rows[5]] })
  assert.equal(alloc.byRow.get('a').stripe, 85000, 'the ledger says which row a Stripe payment was for')
  assert.equal(alloc.byRow.get('s1').stripe, 85000)
  assert.equal(alloc.byRow.get('s2').stripe, 42500, 'a family payment splits by each row\'s fee')
  assert.equal(alloc.byRow.get('gone').stripe, 42500, 'a removed player\'s money still came in, net of the refund')
  assert.equal(alloc.byRow.get('b').bank, 85000)
  assert.equal(alloc.byRow.get('old').other, 30000)
  assert.equal(alloc.unlinked.stripe, 10000)
  assert.equal(alloc.unlinked.cash, 20000)
  // The same total as "Income this term": Stripe net plus offline (method set, not Stripe) plus legacy.
  const income = stripe.reduce((t, p) => t + p.amountCents - p.refundedCents, 0) + 85000 + 20000 + 30000
  const placed = [...alloc.byRow.values()].reduce((t, m) => t + totalOf(m), 0)
  assert.equal(placed + totalOf(alloc.unlinked), income)
})

test('venues this term: revenue, groups, paid and owing, removed and Airtable-only money', () => {
  const rows = [row('a', 'Belrose HQ', { paidAud: 850 }), row('b', 'Belrose HQ', { time: '5:25pm' }), row('c', 'NTRA'), row('gone', 'Belrose HQ', { holdsPlace: false })]
  const alloc = allocateTermMoney({ rows, stripe: [{ id: 'cs1', email: 'b@example.com', amountCents: 85000, refundedCents: 0 }, { id: 'cs2', email: 'gone@example.com', amountCents: 5000, refundedCents: 0 }], ledger: [{ 'Payment Method': 'Cash', 'Amount Paid': 425, 'Source Record ID': 'c' }] })
  const players = [
    { rowId: 'a', status: 'paid', paidCents: 85000, owingCents: 0 },
    { rowId: 'b', status: 'stripe', paidCents: 0, owingCents: 0 },
    { rowId: 'c', status: 'part', paidCents: 42500, owingCents: 42500 },
  ]
  const v = venuesForTerm({ locations: LOCS, rows, players, alloc, venueOf, groupOf })
  const hq = v.find((x) => x.id === HQ.id), nt = v.find((x) => x.id === NTRA.id)
  assert.equal(hq.receivedCents, 90000)
  assert.equal(hq.stripeCents, 90000)
  assert.equal(hq.removedCents, 5000)
  assert.equal(hq.players, 2)
  assert.equal(hq.paid, 2)
  assert.equal(hq.airtableOnlyCents, 85000, 'row a is marked paid but no payment this term is seen')
  assert.equal(hq.groups.length, 2)
  assert.equal(hq.groups[0].label, 'Monday 5:25pm', 'the biggest group first')
  assert.equal(nt.receivedCents, 42500)
  assert.equal(nt.cashCents, 42500)
  assert.equal(nt.owingCents, 42500)
  assert.ok(!v.some((x) => x.id === RYD.id), 'a venue with no players and no money is left out')
  assert.equal(v.reduce((t, x) => t + x.receivedCents, 0) + totalOf(alloc.unlinked), 90000 + 42500)
})

test('an earlier term comes from its ledger; unknown rows are counted apart', () => {
  const rows = [row('t1', 'Belrose HQ', { coach: 'Dean' }), row('t2', 'Belrose HQ', { coach: 'Sam' }), row('t3', 'Rydalmere', { day: 'Friday', time: '6:30am' })]
  const ledger = [
    { 'Payment Method': 'Stripe', 'Amount Paid': 850, 'Source Record ID': 't1' },
    { 'Payment Method': 'Bank Transfer', 'Amount Paid': 1500, 'Source Record ID': 't2, t3' },
    { 'Payment Method': 'Cash', 'Amount Paid': 300, 'Source Record ID': 'dropped-row' },
  ]
  const out = venuesFromLedger({ locations: LOCS, ledger, rows, venueOf, groupOf })
  const hq = out.venues.find((x) => x.id === HQ.id)
  assert.equal(hq.receivedCents, 85000 + 75000)
  assert.equal(hq.players, 2)
  assert.equal(hq.groups[0].coach, 'Dean, Sam', 'two coaches at one time are both named')
  assert.equal(out.venues.find((x) => x.id === RYD.id).bankCents, 75000)
  assert.deepEqual(out.unlinked, { cents: 30000, count: 1 })
  assert.equal(out.players.length, 3)
})

test('Joners Juniors: this term only, paid places, last term\'s credit apart', () => {
  const jj = [
    { term: 'Term 4 2026', location: 'Belrose HQ', status: 'Paid', paidVia: 'Stripe', fee: 220, day: 'Saturday', time: '9:15am' },
    { term: 'Term 4 2026', location: 'Belrose HQ', status: 'Paid', paidVia: 'Term 3 credit', fee: 220 },
    { term: 'Term 4 2026', location: 'Belrose HQ', status: 'Unpaid', fee: 220 },
    { term: 'Term 3 2026', location: 'Belrose HQ', status: 'Paid', paidVia: 'Stripe', fee: 220 },
  ]
  const [hq] = juniorsByVenue(jj, 'Term 4 2026', venueOf)
  assert.equal(hq.players, 3)
  assert.equal(hq.paid, 1)
  assert.equal(hq.paidCents, 22000)
  assert.equal(hq.creditCents, 22000)
  assert.deepEqual(hq.sessions, ['Saturday 9:15am'])
})

test('the term before', () => {
  assert.equal(previousTerm('Term 4 2026'), 'Term 3 2026')
  assert.equal(previousTerm('Term 1 2027'), 'Term 4 2026')
  assert.equal(previousTerm(''), '')
})

console.log(`${passed} venue checks passed`)
