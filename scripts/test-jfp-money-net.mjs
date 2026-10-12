// Money after Stripe's fees: the real fee on each payment, put on the same
// rows as the money, next term kept apart. A fake KV and a fake Stripe; no
// network, no real figures (every amount here is invented).
import assert from 'node:assert/strict'

process.env.KV_REST_API_URL = 'https://kv.invalid'
process.env.KV_REST_API_TOKEN = 'test-only'
process.env.STRIPE_SECRET_KEY_SYDNEY = 'sk_test_only'
delete process.env.STRIPE_HOLIDAY_SECRET_KEY

const { feeFrom, feeTotals, splitTerms, jfpStripePayments, feeKey } = await import('../api/_jfp-stripe.js')
const { allocateTermMoney, venuesForTerm, venuesFromLedger, venuesFromHistory, totalOf, emptyVenue, LEDGER_FEE } = await import('../api/_jfp-venues.js')

let passed = 0
const queue = []
function test(name, fn) { queue.push([name, fn]) }

// ---------- fake KV and Stripe ----------
const kv = new Map() // key -> { value, ex }
const kvLog = []
function redis([cmd, key, value, ...opts]) {
  kvLog.push([cmd, key, ...opts])
  if (cmd === 'GET') return kv.get(key)?.value ?? null
  if (cmd === 'SET') {
    if (opts.includes('NX') && kv.has(key)) return null
    kv.set(key, { value, ex: opts.includes('EX') ? Number(opts[opts.indexOf('EX') + 1]) : 0 })
    return 'OK'
  }
  if (cmd === 'DEL') return kv.delete(key) ? 1 : 0
  throw new Error(`Unexpected KV command ${cmd}`)
}
let listed = [] // checkout sessions the list returns
let retrieves = [] // payment intents read on their own
let listQueries = []
const balance = (amount, fee, gst) => ({ object: 'balance_transaction', amount, fee, net: amount - fee, fee_details: [{ type: 'stripe_fee', amount: fee - gst }, { type: 'tax', amount: gst }] })
const byIntent = new Map() // pi -> balance transaction Stripe has now
globalThis.fetch = async (url, init = {}) => {
  const u = String(url)
  const ok = (data) => ({ ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) })
  if (u.startsWith('https://kv.invalid')) {
    const body = JSON.parse(init.body)
    return ok(u.endsWith('/pipeline') ? body.map((c) => ({ result: redis(c) })) : { result: redis(body) })
  }
  if (u.startsWith('https://api.stripe.com/v1/checkout/sessions?')) { listQueries.push(new URL(u).searchParams); return ok({ data: listed, has_more: false }) }
  if (u.startsWith('https://api.stripe.com/v1/payment_intents/')) {
    const pi = decodeURIComponent(u.split('/payment_intents/')[1].split('?')[0])
    retrieves.push(pi)
    return ok({ id: pi, latest_charge: { id: `ch_${pi}`, payment_method_details: { type: 'afterpay_clearpay' }, balance_transaction: byIntent.get(pi) || null } })
  }
  throw new Error(`Unexpected fetch ${u}`)
}
const session = (n, { amount = 85000, bt = balance(amount, 1720, 156), method = 'card', refunded = 0, metadata = {} } = {}) => ({
  id: `cs_${n}`, status: 'complete', payment_status: 'paid', created: 1791000000 + n, amount_total: amount,
  customer_details: { email: `fam${n}@example.com`, name: '' }, metadata: { jfpBookingId: `PAY-${n}`, ...metadata },
  payment_intent: amount ? { id: `pi_${n}`, latest_charge: { id: `ch_${n}`, amount_refunded: refunded, payment_method_details: { type: method }, balance_transaction: bt } } : null,
})
function reset() { kv.clear(); kvLog.length = 0; retrieves = []; listQueries = []; byIntent.clear() }

// ---------- the Stripe read ----------
test('the fee, its GST and the net come from the balance transaction; none yet is null, not 0', () => {
  assert.deepEqual(feeFrom({ payment_method_details: { type: 'link' }, balance_transaction: balance(42500, 990, 90) }), { fee: 990, gst: 90, net: 41510, method: 'link' })
  assert.equal(feeFrom({ balance_transaction: null }), null)
  assert.equal(feeFrom({ balance_transaction: 'txn_123' }), null, 'not expanded is not known')
  assert.equal(feeFrom(null), null)
})

test('the list asks for the balance transaction; each payment has its fee, GST, net and method', async () => {
  reset()
  listed = [session(1), session(2, { amount: 40000, bt: balance(40000, 2840, 258), method: 'afterpay_clearpay' })]
  const out = await jfpStripePayments({ fresh: true, term: 'Term 4 2026' })
  assert.ok(listQueries[0].getAll('expand[]').includes('data.payment_intent.latest_charge.balance_transaction'))
  const a = out.payments.find((p) => p.id === 'cs_1'), b = out.payments.find((p) => p.id === 'cs_2')
  assert.deepEqual([a.feeCents, a.feeGstCents, a.stripeNetCents, a.payMethod, a.feeKnown], [1720, 156, 83280, 'card', true])
  assert.deepEqual([b.feeCents, b.payMethod], [2840, 'afterpay_clearpay'], 'a higher fee is read, never worked out from a rate')
  assert.equal(retrieves.length, 0, 'nothing else is asked when the list has every fee')
})

test('a fee not in the list yet is read on its own, kept for good, and not asked again', async () => {
  reset()
  listed = [session(1), session(3, { bt: null })]
  byIntent.set('pi_3', balance(85000, 1720, 156))
  let out = await jfpStripePayments({ fresh: true, term: 'Term 4 2026' })
  const p = out.payments.find((x) => x.id === 'cs_3')
  assert.deepEqual([p.feeCents, p.feeGstCents, p.feeKnown], [1720, 156, true])
  assert.deepEqual(retrieves, ['pi_3'])
  const set = kvLog.find(([cmd, key]) => cmd === 'SET' && key === feeKey('pi_3'))
  assert.ok(set && !set.includes('EX'), 'a fee never changes, so it is kept with no expiry')
  out = await jfpStripePayments({ fresh: true, term: 'Term 4 2026' })
  assert.equal(out.payments.find((x) => x.id === 'cs_3').feeCents, 1720)
  assert.deepEqual(retrieves, ['pi_3'], 'the second read uses the kept fee')
})

test('a still-missing fee is pending, asked at most every 10 minutes, at most 10 per read', async () => {
  reset()
  listed = Array.from({ length: 12 }, (_, i) => session(10 + i, { bt: null }))
  let out = await jfpStripePayments({ fresh: true, term: 'Term 4 2026' })
  assert.equal(retrieves.length, 10, 'never a flood of Stripe calls')
  assert.equal(out.payments.filter((p) => !p.feeKnown).length, 12)
  assert.ok(out.payments.every((p) => p.feeCents === null), 'not known is null, never 0')
  const tries = kvLog.filter(([cmd, key]) => cmd === 'SET' && key.startsWith('jfp:stripe-fee-try:'))
  assert.ok(tries.every((t) => t.includes('NX') && t.includes('EX')))
  retrieves = []
  out = await jfpStripePayments({ fresh: true, term: 'Term 4 2026' })
  assert.deepEqual(retrieves, ['pi_20', 'pi_21'], 'the next read asks only for the two not tried yet')
})

test('the old cache (no fees) is never read', async () => {
  reset()
  kv.set('jfp:stripe-payments', { value: JSON.stringify({ since: '2026-09-01', at: new Date().toISOString(), payments: [{ id: 'cs_old', amountCents: 85000, refundedCents: 0 }], other: { count: 0, cents: 0 } }) })
  listed = [session(1)]
  const out = await jfpStripePayments({ term: 'Term 4 2026' })
  assert.deepEqual(out.payments.map((p) => p.id), ['cs_1'])
  assert.equal(out.payments[0].feeCents, 1720)
  assert.ok(kv.has('jfp:stripe-payments:v2'))
  const again = await jfpStripePayments({ term: 'Term 4 2026' })
  assert.equal(again.payments[0].feeKnown, true, 'the new cache keeps the fee')
})

test('next term paid early is kept apart; a payment naming this term counts', async () => {
  reset()
  listed = [session(1), session(4, { amount: 10000, bt: balance(10000, 220, 20), metadata: { source: 'next-hold' } }), session(5, { metadata: { source: 'next-full', jfpTerm: 'Term 1 2027' } }), session(6, { metadata: { source: 'next-full', jfpTerm: 'Term 4 2026' } }), session(7, { amount: 0 })]
  const out = await jfpStripePayments({ fresh: true, term: 'Term 4 2026' })
  assert.deepEqual(out.next.map((p) => p.id).sort(), ['cs_4', 'cs_5'])
  assert.deepEqual(out.payments.map((p) => p.id).sort(), ['cs_1', 'cs_6', 'cs_7'])
  const free = out.payments.find((p) => p.id === 'cs_7')
  assert.deepEqual([free.feeCents, free.feeKnown], [0, true], 'nothing charged, no fee')
  const later = splitTerms({ payments: [...out.payments, ...out.next] }, 'Term 1 2027')
  assert.ok(later.payments.some((p) => p.id === 'cs_5'), 'once Term 1 2027 is the term, its early payment is its income')
})

test('fee totals: every fee on this term\'s payments, refunded ones too, by how people paid', () => {
  const pays = [
    { amountCents: 85000, refundedCents: 0, feeCents: 1720, feeGstCents: 156, feeKnown: true, payMethod: 'card' },
    { amountCents: 85000, refundedCents: 85000, feeCents: 1720, feeGstCents: 156, feeKnown: true, payMethod: 'card' },
    { amountCents: 40000, refundedCents: 0, feeCents: 2840, feeGstCents: 258, feeKnown: true, payMethod: 'afterpay_clearpay' },
    { amountCents: 42500, refundedCents: 0, feeCents: null, feeGstCents: null, feeKnown: false, payMethod: '' },
  ]
  const t = feeTotals(pays)
  assert.equal(t.stripeFeesCents, 1720 + 1720 + 2840)
  assert.equal(t.feeGstCents, 156 + 156 + 258)
  assert.equal(t.feesPendingCount, 1)
  assert.deepEqual(t.feesByMethod, [
    { method: 'card', count: 2, grossCents: 170000, feeCents: 3440, pendingCount: 0 },
    { method: 'unknown', count: 1, grossCents: 42500, feeCents: 0, pendingCount: 1 },
    { method: 'afterpay_clearpay', count: 1, grossCents: 40000, feeCents: 2840, pendingCount: 0 },
  ])
  const income = pays.reduce((s, p) => s + p.amountCents - p.refundedCents, 0)
  assert.equal(income - t.stripeFeesCents, 167500 - 6280, 'net income is income less every known fee')
})

// ---------- fees on venues ----------
const HQ = { id: 'belrose', name: 'Belrose HQ' }
const NTRA = { id: 'ntra', name: 'North Turramurra' }
const RYD = { id: 'rydalmere', name: 'Rydalmere Park' }
const LOCS = [HQ, NTRA, RYD]
const venueOf = (r) => ({ 'Belrose HQ': HQ, NTRA, Rydalmere: RYD }[r.location] || { id: 'other', name: 'No venue set' })
const groupOf = (r) => ({ key: `${r.day}|${r.time}|${r.location}`, label: `${r.day} ${r.time}`, coach: '' })
const row = (id, location, extra = {}) => ({ id, player: `Player ${id}`, email: `${id}@example.com`, location, day: 'Monday', time: '4:20pm', feeAud: 850, paidAud: 0, holdsPlace: true, ...extra })
const pay = (id, email, amount, fee, extra = {}) => ({ id, email, amountCents: amount, refundedCents: 0, feeCents: fee, feeKnown: fee != null, at: '2026-10-05T01:00:00.000Z', ...extra })
const feesOn = (alloc) => [...alloc.byRow.values()].reduce((t, m) => t + m.fee, 0)

test('each fee goes on the same rows as its payment, to the cent; refunded payments keep theirs', () => {
  const rows = [
    row('s1', 'Belrose HQ', { email: 'fam@example.com', feeAud: 850 }), row('s2', 'Rydalmere', { email: 'fam@example.com', feeAud: 425 }), row('s3', 'NTRA', { email: 'fam@example.com', feeAud: 300 }),
    row('r1', 'NTRA', { email: 'refund@example.com' }), row('h1', 'Belrose HQ', { email: 'half@example.com' }),
  ]
  const stripe = [
    pay('cs_fam', 'fam@example.com', 157500, 3171), // three places, an odd fee
    pay('cs_refund', 'refund@example.com', 85000, 1720, { refundedCents: 85000 }), // all given back, the fee is not
    pay('cs_half', 'half@example.com', 85000, 1720, { refundedCents: 42500 }),
    pay('cs_stranger', 'stranger@example.com', 10000, 220),
    pay('cs_pending', 'fam@example.com', 5000, null), // Stripe has no fee for it yet
  ]
  const alloc = allocateTermMoney({ rows, stripe })
  const total = stripe.reduce((t, p) => t + (p.feeKnown ? p.feeCents : 0), 0)
  assert.equal(feesOn(alloc) + alloc.unlinked.fee, total, 'no cent lost, none counted twice')
  assert.equal(alloc.byRow.get('s1').fee + alloc.byRow.get('s2').fee + alloc.byRow.get('s3').fee, 3171)
  assert.deepEqual(['s1', 's2', 's3'].map((id) => alloc.byRow.get(id).fee), [1711, 856, 604], 'shared by each place\'s fee, like the money')
  assert.equal(alloc.byRow.get('r1').fee, 1720, 'a refunded payment keeps its fee')
  assert.equal(totalOf(alloc.byRow.get('r1')), 0, 'and none of its money')
  assert.equal(alloc.byRow.get('h1').fee, 1720)
  assert.equal(alloc.unlinked.fee, 220)
  assert.ok(alloc.unlinked.items.some((i) => i.id === 'cs_stranger' && i.feeCents === 220))
  assert.ok(alloc.entries.every((e) => e.at === '2026-10-05'), 'each part keeps its date for the weekly chart')
})

test('a family invoice: the fee splits by each player\'s line, like the money', () => {
  const rows = [row('f1', 'Belrose HQ', { email: 'fam@example.com' }), row('f2', 'NTRA', { email: 'fam@example.com', feeAud: 450 })]
  const ledger = [
    { 'Payment ID': 'pi_f', 'Payment Method': 'Stripe', 'Amount Paid': 850, 'Source Record ID': 'f1', 'Stripe Payment Intent ID': 'pi_f' },
    { 'Payment ID': 'pi_f#2', 'Payment Method': 'Stripe', 'Amount Paid': 450, 'Source Record ID': 'f2', 'Stripe Payment Intent ID': 'pi_f' },
    { 'Payment ID': 'BANK-1', 'Payment Method': 'Bank Transfer', 'Amount Paid': 300, 'Source Record ID': 'f2', 'Payment Date': '2026-10-06' },
  ]
  const alloc = allocateTermMoney({ rows, stripe: [pay('cs_f', 'fam@example.com', 130000, 2621, { intentId: 'pi_f' })], ledger })
  assert.equal(alloc.byRow.get('f1').fee + alloc.byRow.get('f2').fee, 2621)
  assert.deepEqual([alloc.byRow.get('f1').fee, alloc.byRow.get('f2').fee], [1714, 907])
  assert.equal(alloc.byRow.get('f2').bank, 30000)
  assert.ok(alloc.entries.some((e) => e.rowId === 'f2' && e.kind === 'bank' && e.fee === 0), 'a bank transfer has no fee')
})

test('venues and groups: fees, net, expected and collected, who owes; fees add up to the term\'s', () => {
  const rows = [row('a', 'Belrose HQ'), row('b', 'Belrose HQ', { time: '5:25pm' }), row('c', 'NTRA'), row('d', 'NTRA', { feeAud: 0 }), row('gone', 'Belrose HQ', { holdsPlace: false })]
  const stripe = [pay('cs_a', 'a@example.com', 85000, 1720), pay('cs_gone', 'gone@example.com', 85000, 1720, { refundedCents: 85000 }), pay('cs_x', 'x@example.com', 1000, 40)]
  const ledger = [{ 'Payment Method': 'Cash', 'Amount Paid': 425, 'Source Record ID': 'c', 'Payment Date': '2026-10-05' }]
  const alloc = allocateTermMoney({ rows, stripe, ledger })
  const players = [
    { rowId: 'a', status: 'paid', feeCents: 85000, paidCents: 85000, owingCents: 0 },
    { rowId: 'b', status: 'unpaid', feeCents: 85000, paidCents: 0, owingCents: 85000 },
    { rowId: 'c', status: 'part', feeCents: 85000, paidCents: 42500, owingCents: 42500 },
    { rowId: 'd', status: 'session', feeCents: 10000, paidCents: 0, owingCents: 10000 },
  ]
  const v = venuesForTerm({ locations: LOCS, rows, players, alloc, venueOf, groupOf })
  const hq = v.find((x) => x.id === HQ.id), nt = v.find((x) => x.id === NTRA.id)
  assert.deepEqual([hq.receivedCents, hq.stripeFeeCents, hq.netCents, hq.removedFeeCents], [85000, 3440, 85000 - 3440, 1720])
  assert.equal(hq.groups.reduce((t, g) => t + g.stripeFeeCents, 0), hq.stripeFeeCents, 'the groups\' fees add up to the venue')
  assert.ok(hq.groups.every((g) => g.netCents === g.receivedCents - g.stripeFeeCents))
  assert.deepEqual([hq.expectedCents, hq.collectedCents, hq.collectedPct], [170000, 85000, 50])
  assert.deepEqual(hq.owingRowIds, ['b'])
  assert.deepEqual(hq.groups.find((g) => g.label === 'Monday 5:25pm').owingRowIds, ['b'])
  assert.deepEqual([nt.stripeFeeCents, nt.netCents], [0, 42500], 'cash costs nothing')
  assert.deepEqual([nt.expectedCents, nt.collectedPct], [85000, 50], 'session by session is not in what the places should bring in')
  assert.deepEqual(nt.owingRowIds, ['c', 'd'])
  assert.equal(v.reduce((t, x) => t + x.stripeFeeCents, 0) + alloc.unlinked.fee, 1720 + 1720 + 40)
  const empty = emptyVenue(RYD)
  assert.deepEqual([empty.receivedCents, empty.stripeFeeCents, empty.netCents, empty.collectedPct, empty.groups], [0, 0, 0, null, []])
})

test('the term before: fees from its ledger; a Stripe line with no fee is pending; the register has none', () => {
  const rows = [row('t1', 'Belrose HQ'), row('t2', 'Belrose HQ'), row('t3', 'Rydalmere', { day: 'Friday', time: '6:30am' })]
  const ledger = [
    { 'Payment Method': 'Stripe', 'Amount Paid': 850, 'Source Record ID': 't1', [LEDGER_FEE]: 17.2 },
    { 'Payment Method': 'Stripe', 'Amount Paid': 1500, 'Source Record ID': 't2, t3', [LEDGER_FEE]: 30.01 },
    { 'Payment Method': 'Stripe', 'Amount Paid': 425, 'Source Record ID': 't3' },
    { 'Payment Method': 'Bank Transfer', 'Amount Paid': 300, 'Source Record ID': 't1' },
    { 'Payment Method': 'Stripe', 'Amount Paid': 300, 'Source Record ID': 'dropped-row', [LEDGER_FEE]: 6.4 },
  ]
  const out = venuesFromLedger({ locations: LOCS, ledger, rows, venueOf, groupOf })
  const hq = out.venues.find((x) => x.id === HQ.id), ryd = out.venues.find((x) => x.id === RYD.id)
  assert.equal(out.stripeFeesCents, 1720 + 3001 + 640)
  assert.equal(hq.stripeFeeCents + ryd.stripeFeeCents + out.unlinkedFeeCents, out.stripeFeesCents)
  assert.deepEqual([hq.stripeFeeCents, ryd.stripeFeeCents, out.unlinkedFeeCents], [1720 + 1501, 1500, 640])
  assert.equal(hq.netCents, hq.receivedCents - hq.stripeFeeCents)
  assert.equal(out.feesPendingCount, 1)
  assert.deepEqual(out.unlinked, { cents: 30000, count: 1 }, 'same shape as before')
  assert.equal(out.players.find((p) => p.rowId === 't1').netReceivedCents, 85000 + 30000 - 1720)
  const reg = venuesFromHistory({ locations: LOCS, rows: [{ term: 'Term 2 2026', kind: 'payments', venue: 'Belrose HQ', session: 'Monday', revenue: 100, stripe: 100, payments: 1 }], term: 'Term 2 2026', venueOf: (r) => venueOf({ location: r.venue }) })
  assert.deepEqual([reg.stripeFeesCents, reg.venues[0].stripeFeeCents, reg.venues[0].netCents, reg.venues[0].groups[0].stripeFeeCents], [null, null, null, null], 'not known, not nothing')
})

for (const [name, fn] of queue) { await fn(); passed += 1; console.log(`ok - ${name}`) }
console.log(`${passed} money net checks passed`)
