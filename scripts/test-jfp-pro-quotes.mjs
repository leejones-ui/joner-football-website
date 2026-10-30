// Pro session quotes and the Fees tab (Lee, 14 Oct 2026): the quote on the
// row's notes, staff's checks, the options a player sees, what a commitment
// does to staff session billing, and the family's Fees view.
// Every name, email and amount here is invented.
import assert from 'node:assert/strict'
import { quoteTiersOf, withQuote, cleanQuote, cleanDefaultQuote, coveredOf, withCovered, commitNotes, commitmentOf, billPlan, afterBill, billLine, quoteOptions } from '../api/_jfp-quote.js'
import { normaliseConfig, withPerSession, withPrepaid, prepaidOf, PRO_TYPE } from '../api/_jfp-store.js'
import { owedItems } from '../api/_jfp-account-pay.js'
import { feesView, payreqWhat } from '../api/_jfp-account-fees.js'

let passed = 0
async function test(name, fn) { await fn(); passed += 1; console.log(`ok - ${name}`) }

await test('the quote sits on the notes as [QUOTE:...], next to the other tags, and reads back', () => {
  const n = withQuote(withPerSession('Added by staff. [CONTACT:self]', 10000), [{ n: 6, cents: 9500 }, { n: 10, cents: 9000 }])
  assert.match(n, /\[PERSESSION:10000\]/); assert.match(n, /\[CONTACT:self\]/)
  assert.match(n, /\[QUOTE:6x9500,10x9000\]/)
  assert.deepEqual(quoteTiersOf(n), [{ n: 6, cents: 9500 }, { n: 10, cents: 9000 }])
  assert.equal(withQuote(withQuote(n, [{ n: 4, cents: 9800 }]), [{ n: 4, cents: 9800 }]).match(/\[QUOTE:/g).length, 1, 'never twice')
  assert.doesNotMatch(withQuote(n, []), /QUOTE/, 'no options: the tag goes')
  assert.deepEqual(quoteTiersOf('[QUOTE:1x500,6x9500,6x9000,99x100]'), [{ n: 6, cents: 9500 }], 'broken tiers are dropped, never guessed')
})

await test('staff checks: a price per session, 2 to 20 in a row, each price lower than the per-session price', () => {
  assert.deepEqual(cleanQuote({ perCents: 10000, tiers: [{ n: 10, cents: 9000 }, { n: 6, cents: 9500 }] }), { ok: true, perCents: 10000, tiers: [{ n: 6, cents: 9500 }, { n: 10, cents: 9000 }] })
  assert.match(cleanQuote({ perCents: 0, tiers: [] }).error, /price per session/)
  assert.match(cleanQuote({ perCents: 10000, tiers: [{ n: 1, cents: 9000 }] }).error, /2 to 20/)
  assert.match(cleanQuote({ perCents: 10000, tiers: [{ n: 6, cents: 10000 }] }).error, /not less than/)
  assert.match(cleanQuote({ perCents: 10000, tiers: [{ n: 6, cents: 9500 }, { n: 6, cents: 9000 }] }).error, /two options/)
  assert.match(cleanQuote({ perCents: 10000, tiers: Array.from({ length: 5 }, (_, i) => ({ n: i + 2, cents: 9000 })) }).error, /At most 4/)
  assert.equal(cleanDefaultQuote({ perCents: 10000, tiers: [{ n: 6, cents: 12000 }] }), null, 'a bad default is dropped')
  const c = normaliseConfig({ proQuote: { perCents: 10000, tiers: [{ n: 6, cents: 9500 }] } })
  assert.deepEqual(c.proQuote.tiers, [{ n: 6, cents: 9500 }], 'the default Pro quote survives the config')
  assert.equal(normaliseConfig({}).proQuote, null)
})

await test('a paid commitment adds its dates as [COVERED:...]; plain prepay adds none', () => {
  const n = commitNotes('x [PREPAID:6]', { commit: true, dates: ['2026-10-21', '2026-10-14'] })
  assert.deepEqual(coveredOf(n), ['2026-10-14', '2026-10-21'])
  assert.equal(commitNotes('x', { sessions: 2, dates: ['2026-10-14'] }), 'x', 'pay ahead without committing')
  assert.deepEqual(coveredOf(commitNotes(n, { commit: true, dates: ['2026-10-28', '2026-10-21'] })), ['2026-10-14', '2026-10-21', '2026-10-28'], 'a second commitment adds, once each')
  const c = commitmentOf(n, '2026-10-14')
  assert.deepEqual({ sessions: c.sessions, left: c.left, done: c.done }, { sessions: 2, left: 1, done: 1 })
  assert.equal(withCovered(n, []), 'x [PREPAID:6]')
})

await test('staff billing: covered dates are never billed, missed ones count as paid, plain prepaid as before', () => {
  const six = ['2026-10-14', '2026-10-21', '2026-10-28', '2026-11-04', '2026-11-11', '2026-11-18']
  // Old rule untouched with no covered dates.
  assert.deepEqual(billPlan({ prepaid: 1, covered: [], sessions: 1, today: '2026-10-15' }), { covered: 1, commitUsed: 0, plainUsed: 1, lapsed: 0, prepaidAfter: 0, coveredAfter: [] })
  assert.equal(billPlan({ prepaid: 2, covered: [], sessions: 3, today: '2026-10-15' }).covered, 2)
  // Two weeks in, staff bill the 2 sessions: both covered, nothing billed.
  let p = billPlan({ prepaid: 6, covered: six, sessions: 2, today: '2026-10-22' })
  assert.deepEqual([p.covered, p.lapsed, p.prepaidAfter, p.coveredAfter.length], [2, 0, 4, 4])
  // Missed the 28th: staff bill 1 (the 4th) on 5 Nov. The miss is still paid; nothing is billed.
  p = billPlan({ prepaid: 4, covered: six.slice(2), sessions: 1, today: '2026-11-05' })
  assert.deepEqual([p.covered, p.lapsed, p.prepaidAfter, p.coveredAfter], [1, 1, 2, ['2026-11-11', '2026-11-18']])
  assert.match(billLine(p), /1 committed session missed and counted as paid/)
  // After the commitment, a session past it is billed in full.
  p = billPlan({ prepaid: 2, covered: six.slice(4), sessions: 3, today: '2026-11-26' })
  assert.deepEqual([p.covered, p.prepaidAfter, p.coveredAfter.length], [2, 0, 0])
  // A session paid ahead one at a time plus a commitment: both come off.
  p = billPlan({ prepaid: 7, covered: six, sessions: 2, today: '2026-10-22' })
  assert.deepEqual([p.covered, p.commitUsed, p.plainUsed, p.prepaidAfter], [2, 2, 0, 5])
  p = billPlan({ prepaid: 7, covered: six, sessions: 3, today: '2026-10-22' })
  assert.deepEqual([p.covered, p.plainUsed, p.prepaidAfter], [3, 1, 4])
  const notes = afterBill(`a [PREPAID:6] [COVERED:${six.join(',')}]`, billPlan({ prepaid: 6, covered: six, sessions: 2, today: '2026-10-22' }), withPrepaid)
  assert.equal(prepaidOf(notes), 4); assert.equal(coveredOf(notes).length, 4)
})

await test('the options a player sees: the next session, and only the commitments that fit the dates left', () => {
  const dates = ['2026-10-14', '2026-10-21', '2026-10-28', '2026-11-04', '2026-11-11', '2026-11-18', '2026-11-25'].map((iso) => ({ iso, label: iso }))
  const o = quoteOptions({ perCents: 10000, tiers: [{ n: 6, cents: 9500 }, { n: 10, cents: 9000 }], dates })
  assert.deepEqual(o.map((x) => x.key), ['one', 'commit:6', 'rest'], '10 in a row does not fit 7 dates; the rest of the term (7) is always offered')
  // Lee, 30 Oct 2026: the rest of the term at the best pack rate it earns (the 6-pack's A$95), as a commitment.
  assert.deepEqual([o[2].n, o[2].totalCents, o[2].commit, o[2].saveCents], [7, 66500, true, 3500])
  const none = quoteOptions({ perCents: 10000, tiers: [{ n: 8, cents: 8500 }], dates })
  assert.deepEqual([none.at(-1).key, none.at(-1).totalCents, none.at(-1).commit], ['rest', 70000, undefined], 'no pack fits: the price per session')
  assert.equal(o[1].totalCents, 57000); assert.equal(o[1].saveCents, 3000); assert.equal(o[1].dates.length, 6)
  assert.equal(o[0].totalCents, 10000)
})

const config = normaliseConfig({ term: 'Term 4 2026', termStart: '2026-10-13', weeks: 10 })
const group = { id: 'g-wed', day: 'Wednesday', time: '7:30am', location: 'North Turramurra', durationMin: 60 }
const nowMs = Date.parse('2026-10-13T12:00:00+11:00')
const proRow = (notes) => ({ id: 'recPRO00000000001', player: 'Pat Pro', email: 'pat.pro@example.com', emails: ['pat.pro@example.com'], holdsPlace: true, groupId: group.id, day: 'Wednesday', time: '7:30am', location: 'North Turramurra', paymentType: PRO_TYPE, feeAud: 0, paidAud: 0, paymentStatus: 'Unpaid', notes, perSessionCents: Number((notes.match(/\[PERSESSION:(\d+)\]/) || [])[1]) || null })
const fam = (row) => [{ key: 'patpro', name: 'Pat Pro', waiver: { onFile: true }, term4: [row] }]

await test('My account: a quoted Pro gets the options; a Pro with no quote keeps plain per-session pay', () => {
  const quoted = proRow('[PERSESSION:10000] [QUOTE:6x9500]')
  const [a] = owedItems({ config, players: fam(quoted), payreqs: [], byGroup: { [group.id]: group }, nowMs })
  assert.equal(a.kind, 'prepay'); assert.equal(a.dates.length, 10, 'all ten dates this term')
  assert.deepEqual(a.quote.options.map((x) => [x.key, x.totalCents]), [['one', 10000], ['commit:6', 57000], ['rest', 95000]])
  assert.deepEqual([a.left, a.leftCents, a.rest.key, a.rest.n], [10, 100000, 'rest', 10], 'ten left this term, and the rest of the term')
  const [b] = owedItems({ config, players: fam(proRow('[PERSESSION:10000]')), payreqs: [], byGroup: { [group.id]: group }, nowMs })
  assert.equal(b.kind, 'prepay'); assert.equal(b.quote, undefined, 'no quote, no options: the plain picker')
  // Dates a paid commitment took are not offered again.
  const paid = { id: 'PAY-x', status: 'paid', term4Ids: [quoted.id], prepay: { rowId: quoted.id, sessions: 6, commit: true, dates: a.quote.options[1].dates.map((d) => d.iso) } }
  const [c] = owedItems({ config, players: fam(proRow('[PERSESSION:10000] [QUOTE:6x9500] [PREPAID:6] [COVERED:2026-10-14]')), payreqs: [paid], byGroup: { [group.id]: group }, nowMs })
  assert.equal(c.dates.length, 4); assert.deepEqual(c.quote.options.map((x) => x.key), ['one', 'rest'], '6 in a row no longer fits; the rest of the term (4) does')
  assert.equal(c.quote.commitment.sessions, 1)
})

await test('Fees: their own payments only, newest first, with receipts, cash and bank, holiday and Juniors', () => {
  const row = { ...proRow('[PERSESSION:10000] [QUOTE:6x9500] [PREPAID:6] [COVERED:2026-10-14,2026-10-21,2026-10-28,2026-11-04,2026-11-11,2026-11-18]'), feeAud: 570, paidAud: 570, prepaidSessions: 6 }
  const kid = { id: 'recKID00000000001', player: 'Kit Kid', email: 'pat.pro@example.com', emails: ['pat.pro@example.com'], holdsPlace: true, groupId: group.id, paymentType: 'JFP 10 weeks', feeAud: 850, paidAud: 400, notes: '' }
  const v = feesView({
    config, emails: ['pat.pro@example.com'], rows: [row, kid], groups: { [group.id]: group },
    payreqs: [
      { id: 'PAY-commit', status: 'paid', email: 'pat.pro@example.com', programme: 'pro', playerNames: ['Pat Pro'], amountCents: 57000, paidAt: '2026-10-13T02:00:00Z', stripePaymentIntentId: 'pi_commit', prepay: { rowId: row.id, sessions: 6, perCents: 9500, commit: true, dates: [] } },
      { id: 'PAY-other', status: 'paid', email: 'someone.else@example.com', amountCents: 85000, paidAt: '2026-10-12T02:00:00Z' },
      { id: 'PAY-open', status: 'open', email: 'pat.pro@example.com', amountCents: 45000 },
    ],
    stripe: [
      { id: 'cs_1', email: 'pat.pro@example.com', jfpRef: 'PAY-commit', intentId: 'pi_commit', amountCents: 57000, at: '2026-10-13T02:00:00Z' },
      { id: 'cs_2', email: 'pat.pro@example.com', jfpRef: '', intentId: 'pi_old', amountCents: 20000, at: '2026-09-08T02:00:00Z', product: 'JFP 10 weeks', payMethod: 'card' },
      { id: 'cs_3', email: 'someone.else@example.com', intentId: 'pi_x', amountCents: 99900, at: '2026-10-01T02:00:00Z' },
    ],
    ledger: [
      { id: 'l1', 'Payment ID': 'L-1', 'Payment Method': 'Bank Transfer', 'Amount Paid': 200, 'Payment Date': '2026-10-02', 'Source Record ID': kid.id, 'Player Name': 'Kit Kid' },
      { id: 'l2', 'Payment ID': 'L-2', 'Payment Method': 'Cash', 'Amount Paid': 50, 'Payment Date': '2026-10-03', 'Source Record ID': `${kid.id},recOTHER000000001` },
      { id: 'l3', 'Payment ID': 'L-3', 'Payment Method': 'Stripe', 'Amount Paid': 570, 'Payment Date': '2026-10-13', 'Source Record ID': row.id },
    ],
    bookings: [{ id: 'HB-1', status: 'paid', email: 'pat.pro@example.com', paidAt: '2026-10-05T01:00:00Z', amountPaidCents: 9000, players: [{ name: 'Kit Kid' }], stripePaymentIntentId: 'pi_hol' }, { id: 'HB-2', status: 'reserving', email: 'pat.pro@example.com' }],
    jjPayreqs: [{ id: 'JJ-1', status: 'paid', email: 'pat.pro@example.com', amountCents: 25000, paidAt: '2026-10-06T01:00:00Z', term: 'Term 4 2026', playerNames: ['Kit Kid'] }],
    receipts: { pi_commit: 'https://pay.stripe.com/receipts/test_commit' },
  })
  assert.deepEqual(v.records.map((r) => r.id), ['PAY-commit', 'JJ-1', 'HB-1', 'L-1', 'cs_2'], 'newest first, nothing of anyone else, no Stripe line twice')
  assert.equal(v.records[0].what, 'Commitment: 6 sessions in a row at A$95 each'); assert.equal(v.records[0].programme, 'Pro sessions')
  assert.equal(v.records[0].receiptUrl, 'https://pay.stripe.com/receipts/test_commit')
  assert.equal(v.records.find((r) => r.id === 'L-1').method, 'Bank transfer')
  assert.ok(!v.records.some((r) => r.id === 'L-2'), 'a ledger line shared with another family stays out')
  assert.ok(v.records.every((r) => !('intentId' in r)))
  assert.deepEqual(v.totals.map((t) => t.label), ['JFP', 'Pro sessions', 'Holiday training', 'Joners Juniors'])
  const pro = v.places.find((x) => x.rowId === row.id)
  assert.equal(pro.kind, 'pro'); assert.equal(pro.prepaidSessions, 6); assert.equal(pro.commitment.sessions, 6)
  const term = v.places.find((x) => x.rowId === kid.id)
  assert.equal(term.owingCents, 45000); assert.equal(term.paidLabel, 'A$400')
  assert.equal(payreqWhat({ prepay: { sessions: 2 } }, 'T'), '2 sessions paid ahead')
})

console.log(`\n${passed} Pro quote and Fees checks passed`)
