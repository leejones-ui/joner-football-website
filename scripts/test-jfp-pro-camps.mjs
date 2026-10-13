// Money > Pro sessions and Money > Camps (Lee, 13 Oct 2026), worked out with
// a fake KV and a fake Stripe: Pro money is found by the agreed keys and kept
// out of JFP, the Pro view adds up by month and by player, the camps import
// is read (Airtable, then KV) and a year is totalled, by location and against
// last year. No network; every name and amount here is invented.
import assert from 'node:assert/strict'

process.env.KV_REST_API_URL = 'https://kv.invalid'
process.env.KV_REST_API_TOKEN = 'test-only'
process.env.STRIPE_SECRET_KEY_SYDNEY = 'sk_test_only'
delete process.env.STRIPE_HOLIDAY_SECRET_KEY

const { jfpStripePayments, splitTerms, isProSession, classifySession } = await import('../api/_jfp-stripe.js')
const { proLines, proMoneyView, isProRow, isProLedger } = await import('../api/_jfp-pro-money.js')
const { campsView, listCamps, campsStripe, groupCampSessions, campFromRecord } = await import('../api/_jfp-camps.js')
const { matchStripe, campsCsv } = await import('../src/scripts/jfp-portal-camps.js')
const { FIGURES } = await import('../src/scripts/jfp-portal-everything.js')
const { proCsv } = await import('../src/scripts/jfp-portal-pro.js')

let passed = 0
const queue = []
function test(name, fn) { queue.push([name, fn]) }

const kv = new Map()
function redis([cmd, key, value, ...opts]) {
  if (cmd === 'GET') return kv.get(key) ?? null
  if (cmd === 'SET') { if (opts.includes('NX') && kv.has(key)) return null; kv.set(key, value); return 'OK' }
  if (cmd === 'DEL') return kv.delete(key) ? 1 : 0
  throw new Error(`Unexpected KV command ${cmd}`)
}
let listed = []
globalThis.fetch = async (url, init = {}) => {
  const u = String(url)
  const ok = (data) => ({ ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) })
  if (u.startsWith('https://kv.invalid')) {
    const body = JSON.parse(init.body)
    return ok(u.endsWith('/pipeline') ? body.map((c) => ({ result: redis(c) })) : { result: redis(body) })
  }
  if (u.startsWith('https://api.stripe.com/v1/checkout/sessions?')) return ok({ data: listed, has_more: false })
  throw new Error(`Unexpected fetch ${u}`)
}
const bt = (amount, fee) => ({ object: 'balance_transaction', amount, fee, net: amount - fee, fee_details: [{ type: 'stripe_fee', amount: fee - 10 }, { type: 'tax', amount: 10 }] })
const session = (n, { amount = 6000, fee = 150, refunded = 0, metadata = {}, email = `fam${n}@example.com` } = {}) => ({
  id: `cs_${n}`, status: 'complete', payment_status: 'paid', created: 1791000000 + n, amount_total: amount, currency: 'aud',
  customer_details: { email, name: `Payer ${n}` }, metadata,
  payment_intent: { id: `pi_${n}`, latest_charge: { id: `ch_${n}`, amount_refunded: refunded, payment_method_details: { type: 'card' }, balance_transaction: bt(amount, fee) } },
})

// ---------- Pro money is found by the agreed keys, and is not JFP ----------

test('Stripe: a Pro quick link and a link for Pro rows come back as Pro, never as JFP term income', async () => {
  kv.clear()
  listed = [
    session(1, { amount: 85000, metadata: { jfpBookingId: 'PAY-1' } }),
    session(2, { metadata: { jfpBookingId: 'PAY-2', jfpProgramme: 'pro', source: 'quick', jfpFor: 'Pro session' } }),
    session(3, { metadata: { jfpBookingId: 'PAY-3', jfpProduct: 'pro' } }),
    session(4, { metadata: { jfpBookingId: 'PAY-4', jfpProgramme: 'other' } }),
  ]
  const out = await jfpStripePayments({ fresh: true, term: 'Term 4 2026' })
  assert.deepEqual(out.payments.map((p) => p.id), ['cs_1'])
  assert.deepEqual(out.pro.map((p) => p.id).sort(), ['cs_2', 'cs_3'])
  assert.equal(out.other.count, 1, 'only the "other" quick link is other')
  assert.equal(out.pro.find((p) => p.id === 'cs_3').feeCents, 150, 'the real Stripe fee')
  assert.ok(isProSession(listed[1]) && isProSession(listed[2]) && !isProSession(listed[0]))
  assert.equal(classifySession(listed[1]), 'other', 'the webhook still sees a Pro quick link as not JFP')
  assert.equal(classifySession(listed[2]), 'jfp', 'and a Pro row link as the JFP payment it records on the row')
})

test('Stripe: a copy read before Pro was marked is read again once; then the copy is used', async () => {
  kv.clear()
  kv.set('jfp:stripe-payments:v2', JSON.stringify({ since: '2026-09-01', at: new Date().toISOString(), payments: [{ id: 'cs_old', amountCents: 100, refundedCents: 0 }], other: { count: 0, cents: 0 } }))
  listed = [session(5, { metadata: { jfpBookingId: 'PAY-5', jfpProduct: 'pro' } })]
  const out = await jfpStripePayments({ term: 'Term 4 2026', quick: true })
  assert.deepEqual(out.pro.map((p) => p.id), ['cs_5'])
  listed = []
  const again = await jfpStripePayments({ term: 'Term 4 2026', quick: true })
  assert.deepEqual(again.pro.map((p) => p.id), ['cs_5'], 'the new copy is used')
  const split = splitTerms({ payments: [{ id: 'a', pro: true }, { id: 'b', nextTerm: true }, { id: 'c' }] }, 'Term 4 2026')
  assert.deepEqual([split.payments.map((p) => p.id), split.next.map((p) => p.id), split.pro.map((p) => p.id)], [['c'], ['b'], ['a']])
})

test('Pro rows and the ledger lines recorded on them', () => {
  assert.ok(isProRow('JFP Pro sessions') && isProRow('pro session') && !isProRow('JFP Session by session') && !isProRow(''))
  const pro = new Set(['recPRO1', 'recPRO2'])
  assert.equal(isProLedger({ 'Source Record ID': 'recPRO1' }, pro), true)
  assert.equal(isProLedger({ 'Source Record ID': 'recPRO1, recPRO2' }, pro), true)
  assert.equal(isProLedger({ 'Source Record ID': 'recPRO1, recJFP1' }, pro), false, 'a family payment with a JFP row stays JFP')
  assert.equal(isProLedger({ 'Source Record ID': '' }, pro), false)
})

// ---------- the Pro view ----------

const ROWS = [
  { id: 'recPRO1', player: 'Ava Pro', parent: 'Pat Pro', email: 'pro1@example.com', emails: ['pro1@example.com'], feeAud: 200, paidAud: 120, perSessionCents: 4000, holdsPlace: true, day: 'Tuesday', time: '17:30', location: 'Test HQ', paymentType: 'JFP Pro sessions' },
  { id: 'recPRO2', player: 'Ben Pro', parent: 'Bo Pro', email: 'pro2@example.com', emails: ['pro2@example.com'], feeAud: 80, paidAud: 80, perSessionCents: 4000, holdsPlace: true, day: 'Tuesday', time: '17:30', location: 'Test HQ', paymentType: 'JFP Pro sessions' },
]
const pay = (id, at, cents, x = {}) => ({ id, intentId: `pi_${id}`, at, email: '', name: 'A Payer', amountCents: cents, refundedCents: 0, feeCents: 100, feeGstCents: 9, feeKnown: true, jfpRef: '', product: 'Pro', pro: true, ...x })
const VIEW_IN = {
  rows: ROWS,
  stripe: { error: '', at: '2026-10-13T00:00:00.000Z', pro: [
    pay('cs_a', '2026-10-02T01:00:00.000Z', 8000, { jfpRef: 'PAY-A' }),
    pay('cs_b', '2026-09-20T01:00:00.000Z', 4000, { jfpRef: 'PAY-B', refundedCents: 1000 }),
    pay('cs_q', '2026-10-05T01:00:00.000Z', 4000, { jfpRef: 'PAY-Q' }),
    pay('cs_e', '2026-10-06T01:00:00.000Z', 4000, { email: 'pro2@example.com', feeKnown: false, feeCents: null, feeGstCents: null }),
  ] },
  payreqs: [{ id: 'PAY-A', term4Ids: ['recPRO1', 'recPRO2'] }, { id: 'PAY-B', term4Ids: ['recPRO1'] }, { id: 'PAY-Q', quick: true, term4Ids: [], forText: 'Pro session' }],
  ledger: [
    { id: 'recL1', 'Payment ID': 'CASH-1', 'Payment Method': 'Cash', 'Amount Paid': 40, 'Payment Date': '2026-10-08', 'Source Record ID': 'recPRO1', 'Player Name': 'Ava Pro' },
    { id: 'recL2', 'Payment ID': 'cs_a', 'Payment Method': 'Stripe', 'Amount Paid': 80, 'Payment Date': '2026-10-02', 'Source Record ID': 'recPRO1' },
    { id: 'recL3', 'Payment ID': 'BANK-9', 'Payment Method': 'Bank Transfer', 'Amount Paid': 850, 'Payment Date': '2026-10-01', 'Source Record ID': 'recJFP9' },
  ],
  bankLines: [{ id: 'XERO-1', date: '2026-09-25', cents: 4000, payer: 'B PRO', rowId: 'recPRO2', player: 'Ben Pro', sessionDate: '2026-09-23', note: '' }, { id: 'XERO-2', date: '2026-10-09', cents: 4000, payer: 'SOMEONE', rowId: '', note: 'not sure who' }],
}

test('Pro lines: Stripe on the rows its link was for, a quick link to check, ledger cash, marked bank lines; Stripe in the ledger and JFP rows left out', () => {
  const lines = proLines(VIEW_IN)
  assert.deepEqual(lines.map((x) => x.id), ['XERO-2', 'CASH-1', 'cs_e', 'cs_q', 'cs_a', 'XERO-1', 'cs_b'])
  const a = lines.find((x) => x.id === 'cs_a')
  assert.deepEqual([a.kind, a.rowIds, a.who, a.keptCents, a.feeCents], ['stripe', ['recPRO1', 'recPRO2'], 'Ava Pro, Ben Pro', 7900, 100])
  assert.equal(lines.find((x) => x.id === 'cs_q').toCheck, true, 'a Pro quick link with no player waits to be checked')
  assert.deepEqual(lines.find((x) => x.id === 'cs_q').rowIds, [], 'never put on a family by email')
  assert.deepEqual(lines.find((x) => x.id === 'cs_e').rowIds, ['recPRO2'], 'no link: the email that paid')
  assert.equal(lines.find((x) => x.id === 'cs_e').feePending, true)
  assert.deepEqual([lines.find((x) => x.id === 'CASH-1').kind, lines.find((x) => x.id === 'CASH-1').keptCents], ['cash', 4000])
  assert.equal(lines.find((x) => x.id === 'XERO-1').marked, true)
})

test('Pro view: taken, refunds, real fees, kept; by month; by player with billed, paid and owing', () => {
  const v = proMoneyView(VIEW_IN)
  const t = v.totals
  assert.deepEqual([t.takenCents, t.refundedCents, t.feeCents, t.keptCents, t.feesPending], [32000, 1000, 300, 30700, 1])
  assert.deepEqual([t.stripe.keptCents, t.bank.keptCents, t.cash.keptCents], [18700, 8000, 4000])
  assert.deepEqual([t.billedCents, t.owingCents, t.players], [28000, 8000, 2])
  assert.deepEqual(v.byMonth.map((m) => [m.month, m.keptCents]), [['2026-10', 23800], ['2026-09', 6900]])
  assert.equal(v.byMonth.reduce((s, m) => s + m.keptCents, 0), t.keptCents, 'the months add up to the total')
  const ava = v.byPlayer.find((p) => p.rowId === 'recPRO1'), ben = v.byPlayer.find((p) => p.rowId === 'recPRO2')
  assert.deepEqual([ava.billedCents, ava.paidCents, ava.owingCents], [20000, 12000, 8000])
  assert.deepEqual([ava.keptCents, ben.keptCents], [3950 + 2900 + 4000, 3950 + 4000 + 4000], 'a payment for two rows is shared; bank line on its player')
  assert.deepEqual([v.unmatched.count, v.unmatched.keptCents], [2, 3900 + 4000], 'the quick link and the unnamed bank line')
  assert.equal(ava.keptCents + ben.keptCents + v.unmatched.keptCents, t.keptCents, 'players and not matched add up to the total')
  assert.deepEqual(v.toCheck.map((x) => x.id), ['cs_q'])
  const sept = proMoneyView({ ...VIEW_IN, month: '2026-09' })
  assert.equal(sept.month, '2026-09')
  assert.deepEqual(sept.lines.map((x) => x.id), ['XERO-1', 'cs_b'])
  assert.equal(sept.totals.keptCents, 6900)
  assert.equal(proMoneyView({ ...VIEW_IN, month: '2031-01' }).month, '', 'a month with nothing in it shows every month')
})

test('Pro CSV: summary, months, players and every payment; no emails', () => {
  const v = proMoneyView(VIEW_IN)
  const csvCell = (x) => { const t = String(x ?? ''); return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t }
  const aud = (c) => (c == null ? '' : (c / 100).toFixed(2))
  const text = proCsv(v, { csvCell, aud })
  assert.match(text, /\r\nKept,307\.00\r\n/)
  assert.match(text, /\r\nOctober 2026,/)
  assert.match(text, /\r\nAva Pro,200\.00,120\.00,80\.00,/)
  assert.ok(!text.includes('@example.com'))
})

// ---------- camps ----------

const rec = (id, f) => ({ id, fields: { Currency: 'AUD', 'Imported At': '2026-10-13', ...f } })
const CAMPS = [
  rec('r1', { Key: '2026 | A', Camp: 'Testville Autumn', Year: 2026, Location: 'Testville', 'Start Date': '2026-04-14', 'End Date': '2026-04-16', Players: 40, Gross: 12000, Refunds: 0, Costs: 3000, Net: 9000 }),
  rec('r2', { Key: '2026 | B', Camp: 'Sampleton Winter', Year: 2026, Location: 'Sampleton (Test Oval)', 'Start Date': '2026-07-07', Players: 30, Gross: 9000, Refunds: 500, Costs: 2500, Net: 6000 }),
  rec('r3', { Key: '2026 | C', Camp: 'Testville Spring', Year: 2026, Location: 'Testville', 'Start Date': '2026-10-01' }),
  rec('r6', { Key: '2026 | E', Camp: 'Sampleton Spring', Year: 2026, Location: 'Sampleton', 'Start Date': '2026-10-05', Players: 5, Gross: 1000, Net: 1000 }),
  rec('r4', { Key: '2026 | D', Camp: 'Faraway Tour', Year: 2026, Location: 'Faraway', Players: 10, Gross: 5000, Net: 2000, Currency: 'USD' }),
  rec('r5', { Key: '2025 | A', Camp: 'Testville Autumn', Year: 2025, Location: 'Testville', Players: 35, Gross: 10000, Costs: 2800, Net: 7200 }),
]

test('camps: a year in date order, A$ totals (another currency listed apart), by location, against last year', () => {
  const v = campsView({ camps: CAMPS.map(campFromRecord), year: 2026, today: '2026-10-13' })
  assert.equal(v.year, 2026)
  assert.deepEqual(v.camps.map((c) => c.camp), ['Testville Autumn', 'Sampleton Winter', 'Testville Spring', 'Sampleton Spring', 'Faraway Tour'])
  const t = v.totals
  assert.deepEqual([t.camps, t.audCamps, t.players, t.grossCents, t.refundsCents, t.costsCents, t.netCents, t.feesCents], [5, 4, 75, 2200000, 50000, 550000, 1600000, null])
  assert.deepEqual(t.other, [{ currency: 'USD', camps: 1, grossCents: 500000, netCents: 200000 }])
  assert.deepEqual(v.byLocation.map((l) => [l.location, l.currency, l.camps, l.netCents]), [['Testville', 'AUD', 2, 900000], ['Sampleton', 'AUD', 2, 700000], ['Faraway', 'USD', 1, 200000]], 'the venue in brackets is the same place')
  assert.deepEqual([v.compare.year, v.compare.net.diffCents, v.compare.net.pct, v.compare.playersDiff], [2025, 880000, 122.2, 40])
  assert.deepEqual(v.years.map((y) => [y.year, y.camps]), [[2026, 5], [2025, 1]])
  assert.equal(campsView({ camps: CAMPS.map(campFromRecord), year: 1999, today: '2026-10-13' }).year, 2026, 'a year with no camps: this year')
  assert.equal(campsView({ camps: CAMPS.map(campFromRecord), year: 2025 }).compare, null, 'nothing the year before')
})

test('camps: read from Airtable and kept 10 minutes; the KV copy when there is no table; a clear message when neither', async () => {
  const store = new Map()
  const deps = { kvGetJson: async (k) => store.get(k) ?? null, kvSetJson: async (k, v) => { store.set(k, v) }, readTable: async () => CAMPS }
  const a = await listCamps({}, deps)
  assert.deepEqual([a.source, a.camps.length, a.importedAt], ['airtable', 6, '2026-10-13'])
  deps.readTable = async () => { throw new Error('should not be read') }
  assert.equal((await listCamps({}, deps)).camps.length, 6, 'the 10 minute copy')
  store.clear()
  deps.readTable = async () => { throw new Error('Airtable 404: Could not find table') }
  await assert.rejects(listCamps({}, deps), /No camp figures yet: run the camps import/)
  store.set('jfp:camps-summary', { importedAt: '2026-10-13T00:00:00Z', camps: [{ key: 'k', camp: 'Kv Camp', year: 2026, location: 'Testville', grossCents: 100000, netCents: 80000 }] })
  const k = await listCamps({ fresh: true }, deps)
  assert.deepEqual([k.source, k.camps[0].camp, k.camps[0].grossCents, k.camps[0].currency], ['kv', 'Kv Camp', 100000, 'AUD'])
})

test('camps: live Stripe sign-ups for the year, by camp, with real fees; quick shows a kept copy', async () => {
  const store = new Map()
  const asked = []
  const s = (n, camp, amount, x = {}) => ({ ...session(n, { amount, fee: 300, metadata: camp ? { registrationId: `REG-${n}`, camp } : { jfpBookingId: `PAY-${n}` } }), ...x })
  const deps = { kvGetJson: async (k) => store.get(k) ?? null, kvSetJson: async (k, v) => { store.set(k, v) }, stripeFetch: async (path) => { asked.push(path); return { data: [s(1, 'Testville Spring Camp', 25000), s(2, 'Testville Spring Camp', 15000), s(3, 'Other Camp', 10000, { payment_status: 'unpaid' }), s(4, '', 85000)], has_more: false } } }
  const out = await campsStripe({ year: 2026 }, deps)
  assert.deepEqual(out.camps.map((g) => [g.camp, g.count, g.takenCents, g.feeCents, g.keptCents]), [['Testville Spring Camp', 2, 40000, 600, 39400]])
  assert.match(asked[0], /created%5Bgte%5D=1767189600/, 'from 1 January 2026, Sydney time')
  const again = await campsStripe({ year: 2026, quick: true }, { ...deps, stripeFetch: async () => { throw new Error('not read') } })
  assert.equal(again.camps.length, 1)
  assert.deepEqual(groupCampSessions([]), [])
  // The sheet's camp with no figure gets Stripe's.
  const v = campsView({ camps: CAMPS.map(campFromRecord), year: 2026 })
  const m = matchStripe(v.camps, out.camps)
  assert.deepEqual([...m.keys()], ['r3'])
  const csvCell = (x) => String(x ?? ''), aud = (c) => (c == null ? '' : (c / 100).toFixed(2))
  assert.match(campsCsv(v, { csvCell, aud }), /Net,16000\.00/)
})

test('everything: each programme\'s figures for one year', () => {
  assert.deepEqual(FIGURES.pro({ byMonth: [{ month: '2026-10', takenCents: 9000, refundedCents: 1000, keptCents: 7800, count: 2 }, { month: '2025-12', takenCents: 5000, refundedCents: 0, keptCents: 4900, count: 1 }] }, 2026), { takenCents: 8000, keptCents: 7800, note: '2 payments' })
  assert.equal(FIGURES.pro({ byMonth: [] }, 2026), null)
  assert.deepEqual(FIGURES.holiday({ byMonth: { session: [{ month: '2026-10', takenCents: 5000, refundedCents: 0, keptCents: 4800, count: 1 }] } }, 2026), { takenCents: 5000, keptCents: 4800, note: '1 payment' })
  assert.deepEqual(FIGURES.juniors({ years: [{ year: 2026, takenCents: 7000, keptCents: 6800, terms: [{}, {}] }] }, 2026), { takenCents: 7000, keptCents: 6800, note: '2 terms' })
  const camps = campsView({ camps: CAMPS.map(campFromRecord), year: 2026 })
  assert.deepEqual(FIGURES.camps(camps, 2026), { takenCents: 2150000, keptCents: 2150000, note: '5 camps · A$16,000 after costs' })
  assert.equal(FIGURES.camps(camps, 2025), null, 'another year\'s reading is not used')
  assert.deepEqual(FIGURES.jfp({ scopes: { '': { takenCents: 900000, keptCents: 180000, stripeFeeCents: 20000, noFeeTerms: ['Term 1 2026'] } }, soFar: true, current: 'Term 4 2026', sources: [] }), { takenCents: 900000, keptCents: 880000, note: 'Term 4 2026 still running · no Stripe fees for Term 1 2026' })
  assert.equal(FIGURES.jfp(null), null)
})

for (const [name, fn] of queue) { await fn(); passed += 1; console.log(`ok - ${name}`) }
console.log(`\n${passed} Pro sessions and camps checks passed`)
