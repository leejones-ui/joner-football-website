// Venue costs and profit: the save rules, config read back, and the sums.
// No network; every label and amount here is invented.
import assert from 'node:assert/strict'

process.env.KV_REST_API_URL = 'https://kv.invalid'
process.env.KV_REST_API_TOKEN = 'test-only'

const { checkCostLines, cleanVenueCosts, costsOfTerm, withCosts, costTotals, costTermOk, COST_LIMITS, allocateTermMoney, venuesForTerm } = await import('../api/_jfp-venues.js')
const { normaliseConfig } = await import('../api/_jfp-store.js')

let passed = 0
function test(name, fn) { fn(); passed += 1; console.log(`ok - ${name}`) }

test('a save: up to 20 lines, a name of 40 letters or fewer, whole cents from 0 to A$500,000', () => {
  assert.deepEqual(checkCostLines([{ label: '  Hall   hire ', cents: 120000 }, { label: 'Cones', cents: 0 }]).lines, [{ label: 'Hall hire', cents: 120000 }, { label: 'Cones', cents: 0 }])
  assert.deepEqual(checkCostLines([]).lines, [], 'an empty list clears a venue')
  assert.match(checkCostLines('rent').error, /list/)
  assert.match(checkCostLines(Array.from({ length: 21 }, (_, i) => ({ label: `Line ${i}`, cents: 1 }))).error, /20/)
  assert.equal(checkCostLines(Array.from({ length: 20 }, (_, i) => ({ label: `Line ${i}`, cents: 1 }))).lines.length, 20)
  assert.match(checkCostLines([{ label: 'x'.repeat(41), cents: 1 }]).error, /40/)
  assert.ok(checkCostLines([{ label: 'x'.repeat(40), cents: 1 }]).lines)
  assert.match(checkCostLines([{ label: '', cents: 1 }]).error, /name/)
  for (const bad of [-1, 1.5, '12', null, COST_LIMITS.cents + 1, NaN]) assert.match(checkCostLines([{ label: 'Rent', cents: bad }]).error, /amount/, `refuses ${bad}`)
  assert.ok(checkCostLines([{ label: 'Rent', cents: 50000000 }]).lines)
  assert.ok(costTermOk('Term 4 2026') && costTermOk('term 1 2027'))
  assert.ok(!costTermOk('Winter') && !costTermOk('Term 5 2026') && !costTermOk(''))
})

test('config read back: bad terms and lines are dropped, good ones kept, the term found whatever its case', () => {
  const c = cleanVenueCosts({ 'Term 4 2026': { belrose: [{ label: 'Rent', cents: 90000 }, { label: '', cents: 5 }, { label: 'Lights', cents: -3 }], ntra: [] }, Holidays: { belrose: [{ label: 'Rent', cents: 1 }] }, 'Term 3 2026': 'nope' })
  assert.deepEqual(c, { 'Term 4 2026': { belrose: [{ label: 'Rent', cents: 90000 }] } })
  assert.deepEqual(cleanVenueCosts(null), {})
  assert.deepEqual(cleanVenueCosts([1, 2]), {})
  assert.deepEqual(costsOfTerm(c, 'term 4 2026'), c['Term 4 2026'])
  assert.deepEqual(costsOfTerm(c, 'Term 1 2027'), {})
  const cfg = normaliseConfig({ venueCosts: c })
  assert.deepEqual(cfg.venueCosts, c, 'normaliseConfig keeps them')
  assert.deepEqual(normaliseConfig({}).venueCosts, {}, 'none by default')
})

test('profit: kept after Stripe fees less costs, or taken less costs when fees are not known', () => {
  const v = withCosts({ id: 'belrose', receivedCents: 100000, netCents: 97000 }, [{ label: 'Rent', cents: 30000 }, { label: 'Cleaning', cents: 4500 }])
  assert.equal(v.costsCents, 34500)
  assert.equal(v.profitCents, 62500)
  assert.equal(v.profitBeforeFees, false)
  const none = withCosts({ id: 'ntra', receivedCents: 5000, netCents: 4800 })
  assert.deepEqual([none.costsCents, none.profitCents, none.costLines], [0, 4800, []])
  const reg = withCosts({ id: 'ntra', receivedCents: 80000, netCents: null }, [{ label: 'Field hire', cents: 20000 }])
  assert.equal(reg.profitCents, 60000)
  assert.equal(reg.profitBeforeFees, true, 'flagged: before Stripe fees')
  const loss = withCosts({ id: 'rydalmere', receivedCents: 1000, netCents: 900 }, [{ label: 'Field hire', cents: 5000 }])
  assert.equal(loss.profitCents, -4100, 'a loss shows as a loss')
})

test('the term: venues plus money not linked to a player, less every venue cost', () => {
  const rows = [
    { id: 'a', player: 'Row A', email: 'a@example.com', feeAud: 800, holdsPlace: true, location: 'Belrose HQ' },
    { id: 'b', player: 'Row B', email: 'b@example.com', feeAud: 400, holdsPlace: true, location: 'North Turramurra' },
  ]
  const stripe = [
    { id: 'cs_a', email: 'a@example.com', amountCents: 80000, refundedCents: 0, feeKnown: true, feeCents: 1800, feeGstCents: 164, at: '2026-10-05' },
    { id: 'cs_b', email: 'b@example.com', amountCents: 40000, refundedCents: 0, feeKnown: true, feeCents: 900, feeGstCents: 82, at: '2026-10-06' },
    { id: 'cs_x', email: 'nobody@example.com', amountCents: 10000, refundedCents: 0, feeKnown: true, feeCents: 300, feeGstCents: 27, at: '2026-10-07' },
  ]
  const alloc = allocateTermMoney({ rows, stripe })
  const ids = { 'Belrose HQ': { id: 'belrose', name: 'Belrose HQ' }, 'North Turramurra': { id: 'ntra', name: 'North Turramurra' } }
  const players = rows.map((r) => ({ rowId: r.id, status: 'paid', feeCents: r.feeAud * 100, owingCents: 0, paidCents: r.feeAud * 100 }))
  const venues = venuesForTerm({ locations: Object.values(ids), rows, players, alloc, venueOf: (r) => ids[r.location], groupOf: () => ({ key: 'g', label: 'Mon 4pm' }) })
  const costs = { belrose: [{ label: 'Rent', cents: 50000 }], ntra: [{ label: 'Field hire', cents: 45000 }] }
  const withC = venues.map((v) => withCosts(v, costs[v.id]))
  const hq = withC.find((v) => v.id === 'belrose'), nt = withC.find((v) => v.id === 'ntra')
  assert.equal(hq.profitCents, 80000 - 1800 - 50000)
  assert.equal(nt.profitCents, 40000 - 900 - 45000, 'North Turramurra runs at a loss')
  const kept = 130000 - 3000
  const t = costTotals(withC, kept)
  assert.equal(t.venueCostsCents, 95000)
  assert.equal(t.profitCents, kept - 95000)
  assert.equal(t.venuesWithCosts, 2)
  // All's profit = every venue's profit + the unlinked money kept.
  assert.equal(t.profitCents, hq.profitCents + nt.profitCents + (10000 - 300))
})

console.log(`${passed} venue cost checks passed`)
