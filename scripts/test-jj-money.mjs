// Joners Juniors money, stage 1: cash and bank transfers recorded in the
// portal, Stripe's real fees and what was kept, the registration id, children
// who left, earlier terms and years, and the cache. Invented data only.
//   node scripts/test-jj-money.mjs
import assert from 'node:assert/strict'
import { juniorsMoney, juniorsHistory, juniorsYears, methodKind, juniorsMoneyData } from '../api/_jfp-juniors-money.js'

let passed = 0
const test = async (name, fn) => { await fn(); passed += 1; console.log(`ok - ${name}`) }

// ---------- money: recorded payments and Stripe's fees ----------

const row = (id, x = {}) => ({ id, table: 'tblT', term: 'Term 4 2026', player: `Kid ${id}`, parent: 'P', emails: [`${id}@example.com`], location: 'Belrose HQ', session: 'Saturday 9:15am', feeCents: 22000, status: 'Unpaid', paidVia: '', paidAt: '', sessionId: '', intentId: '', linkUrl: '', registrationId: '', removed: null, ...x })
const pay = (id, x = {}) => ({ id, intentId: `pi_${id}`, paid: true, email: '', amountCents: 22000, refundedCents: 0, currency: 'aud', at: '2026-10-14T00:00:00Z', link: '', tagged: false, found: ['test'], feeKnown: true, feeCents: 460, feeGstCents: 42, payMethod: 'card', ...x })

await test('cash and bank transfers recorded in the portal count, on the child, and never twice', () => {
  const rows = [row('a'), row('b'), row('c')]
  const ledger = [
    { id: 'JJ-CASH-1', term: 'Term 4 2026', method: 'Cash', date: '2026-10-17', cents: 22000, shares: [{ rowId: 'a', name: 'Kid a', cents: 22000 }] },
    { id: 'JJ-BANK-1', term: 'Term 4 2026', method: 'Bank transfer', date: '2026-10-18', cents: 10000, shares: [{ rowId: 'b', name: 'Kid b', cents: 10000 }] },
    { id: 'JJ-CASH-2', term: 'Term 4 2026', method: 'Cash', date: '2026-10-18', cents: 22000, shares: [{ rowId: 'c', cents: 22000 }], void: { reason: 'typed twice' } },
  ]
  const m = juniorsMoney(rows, { sessions: [], links: {} }, { ledger })
  const get = (id) => m.players.find((p) => p.rowId === id)
  assert.equal(get('a').status, 'stripe', 'paid in full; Airtable still says Unpaid until the row is written')
  assert.equal(get('a').paidVia, 'Cash')
  assert.equal(get('b').status, 'part'); assert.equal(get('b').owingCents, 12000)
  assert.equal(get('c').status, 'unpaid', 'a payment taken off is not counted')
  const t = m.byTerm['Term 4 2026']
  assert.equal(t.collectedCents, 32000); assert.equal(t.cashCents, 22000); assert.equal(t.bankCents, 10000); assert.equal(t.stripeCents, 0)
  assert.equal(t.feesCents, 0); assert.equal(t.keptCents, 32000, 'cash and bank cost nothing')
  assert.equal(m.coverage.recordedPayments, 2)
})

await test('Stripe fees: the real fee on each payment, split with the money, pending when not known', () => {
  const rows = [row('s1', { sessionId: 'cs_1' }), row('s2', { emails: ['fam@example.com'] }), row('s3', { emails: ['fam@example.com'] }), row('s4', { sessionId: 'cs_4' })]
  const sessions = [pay('cs_1'), pay('cs_fam', { email: 'fam@example.com', tagged: true, amountCents: 44000, feeCents: 900, feeGstCents: 82 }), pay('cs_4', { feeKnown: false, feeCents: null, feeGstCents: null })]
  const m = juniorsMoney(rows, { sessions, links: {} })
  const t = m.byTerm['Term 4 2026']
  assert.equal(t.collectedCents, 88000)
  assert.equal(t.feesCents, 460 + 900, 'the unknown fee is not guessed')
  assert.equal(t.feesPending, 1)
  assert.equal(t.keptCents, 88000 - 1360)
  assert.equal(t.feeGstCents, 42 + 82)
  const fam = t.lines.find((l) => l.ref === '…cs_fam')
  assert.equal(fam.who, 'Kid s2, Kid s3'); assert.equal(fam.feeCents, 900); assert.equal(fam.keptCents, 43100)
  assert.equal(m.players.find((p) => p.rowId === 's2').stripeFeeCents + m.players.find((p) => p.rowId === 's3').stripeFeeCents, 900)
  assert.ok(!JSON.stringify(m).includes('@example.com'), 'no family emails in the money figures')
})

await test('the registration id on a row matches the website payment', () => {
  const rows = [row('w', { registrationId: 'JJ-55', emails: ['other@example.com'] })]
  const m = juniorsMoney(rows, { sessions: [pay('cs_web', { registrationId: 'JJ-55', email: 'different@example.com', tagged: true })], links: {} })
  assert.equal(m.players[0].paidCents, 22000); assert.equal(m.byTerm['Term 4 2026'].unlinkedCount, 0)
})

await test('a child who has left owes nothing more and is not counted in the class', () => {
  const rows = [row('stay'), row('gone', { removed: { at: '2026-10-20', reason: 'Moved away' } })]
  const m = juniorsMoney(rows, { sessions: [], links: {} })
  const t = m.byTerm['Term 4 2026']
  assert.equal(t.players, 1); assert.equal(t.removed, 1); assert.equal(t.owingCents, 22000)
  assert.equal(m.players.find((p) => p.rowId === 'gone').owingCents, 0)
})

await test('earlier terms from the register, and years that add up', () => {
  const history = [
    { term: 'Term 1 2025', kind: 'payments', venue: 'Belrose HQ', session: 'JONERS JUNIORS', revenue: 660, other: 660, payments: 3 },
    { term: 'Term 1 2025', kind: 'payments', venue: 'Belrose HQ', session: 'Monday Afternoon (HQ)', revenue: 5000 },
    { term: 'Term 2 2025', kind: 'register total', venue: 'Belrose HQ', session: 'Joners Juniors total', revenue: 999 },
    { term: 'Term 4 2026', kind: 'payments', venue: 'Belrose HQ', session: 'JONERS JUNIORS', revenue: 1 },
  ]
  const earlier = juniorsHistory(history, ['Term 4 2026'])
  assert.deepEqual(earlier.map((e) => [e.term, e.takenCents]), [['Term 1 2025', 66000]], 'Juniors payment rows only; live terms come from the tables')
  const data = juniorsMoney([row('y')], { sessions: [pay('cs_y', { email: 'y@example.com', tagged: true })], links: {} })
  const years = juniorsYears(data, earlier)
  assert.deepEqual(years.map((y) => [y.year, y.takenCents]), [[2026, 22000], [2025, 66000]])
  assert.equal(years[0].keptCents, 22000 - 460); assert.equal(years[1].keptCents, null, 'no fees in the register: not known')
  assert.equal(methodKind('Bank transfer'), 'bank')
})

await test('figures read before a change in the portal are never served as up to date', async () => {
  const store = {}
  let cleared = null, reads = 0, slow = null
  const deps = {
    kvGetJson: async (k) => (k === 'jj:money-cleared' ? cleared : store[k] ?? null), kvSetJson: async (k, v) => { store[k] = v },
    readRows: async () => { reads += 1; if (slow) await slow; return [row('r1')] }, readStripe: async () => ({ sessions: [], links: {} }), readLedger: async () => [], readHistory: async () => [],
  }
  const first = await juniorsMoneyData({}, deps)
  await juniorsMoneyData({}, deps)
  assert.equal(reads, 1, 'kept for a few minutes')
  cleared = Date.parse(first.at)
  await juniorsMoneyData({}, deps)
  assert.equal(reads, 2, 'a change at the same moment: read again')
  // A slow refresh that began before a change finishes after it: it is
  // stamped with when it began, so the next look reads again.
  let release
  slow = new Promise((r) => { release = r })
  cleared = 0
  const running = juniorsMoneyData({ fresh: true }, deps)
  await new Promise((r) => setTimeout(r, 5))
  cleared = Date.now()
  await new Promise((r) => setTimeout(r, 5))
  release(); await running; slow = null
  await juniorsMoneyData({}, deps)
  assert.equal(reads, 4, 'the slow result was not taken as newer than the change')
})

console.log(`\n${passed} Joners Juniors money checks passed`)
