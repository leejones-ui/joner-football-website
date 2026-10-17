// The Money page in jsdom: kept after Stripe fees, the venue switch (and its
// #money?loc= link), the fees card, next term, the venue window and the
// download for the accountant. Every name and amount here is invented.
import assert from 'node:assert/strict'
import { openPortal, csvRows } from './jfp-portal-dom.mjs'
import { money } from '../src/scripts/jfp-common.js'

let passed = 0
async function test(name, fn) { await fn(); passed += 1; console.log(`ok - ${name}`) }

// ---------- an invented term that adds up ----------
const VENUES = { belrose: 'Belrose HQ', ntra: 'North Turramurra', rydalmere: 'Rydalmere Park', other: 'No venue set' }
const player = (rowId, name, loc, x) => ({
  rowId, player: name, parent: `${name.split(' ')[0]} Parent`, email: `${rowId}@example.com`, familyKey: `${rowId}@example.com`, phone: '', openLink: null, product: 'group',
  group: `Monday 4:20pm, ${VENUES[loc]}`, groupId: `g-${loc}`, locationId: loc, locationName: VENUES[loc], coach: 'Coach Sam',
  feeCents: 0, paidCents: 0, owingCents: 0, perSessionCents: null, airtableStatus: 'Not set', type: 'JFP 10 weeks', status: 'unpaid',
  stripeCents: 0, stripeCount: 0, hasNotes: false, receivedCents: 0, stripeFeeCents: 0, netReceivedCents: 0, ...x,
})
const players = [
  player('p1', 'Ava Test', 'belrose', { feeCents: 85000, paidCents: 85000, status: 'paid', receivedCents: 85000, stripeFeeCents: 1720, netReceivedCents: 83280 }),
  player('p2', 'Ben Test', 'belrose', { feeCents: 85000, owingCents: 85000, status: 'unpaid' }),
  player('p3', 'Cal Test', 'ntra', { feeCents: 42500, paidCents: 20000, owingCents: 22500, status: 'part', receivedCents: 20000, netReceivedCents: 20000 }),
  player('p4', 'Dee Test', 'ntra', { feeCents: 85000, status: 'stripe', stripeCents: 85000, receivedCents: 85000, stripeFeeCents: 6000, netReceivedCents: 79000 }),
  player('p5', 'Eve Test', 'rydalmere', { feeCents: 85000, paidCents: 85000, status: 'paid', receivedCents: 85000, netReceivedCents: 85000 }),
  player('p6', 'Fin Test', 'other', { status: 'unpriced' }),
  player('p7', 'Gus Test', 'ntra', { feeCents: 30000, owingCents: 30000, status: 'unpaid' }),
]
const line = (id, at, method, payMethod, who, venueId, taken, refunded, fee, gst) => ({ id, at, method, payMethod, who, venueId, takenCents: taken, refundedCents: refunded, feeCents: fee, feeGstCents: gst, keptCents: fee == null ? null : taken - refunded - fee })
const payments = [
  line('cs_1', '2026-10-05', 'Stripe', 'card', 'Ava Parent', 'belrose', 85000, 0, 1720, 156),
  line('cs_2', '2026-10-06', 'Stripe', 'afterpay_clearpay', 'Dee Parent', 'ntra', 90000, 5000, 6000, 545),
  line('BANK-1', '2026-10-07', 'Bank transfer', '', 'Cal Test', 'ntra', 20000, 0, 0, 0),
  line('CASH-1', '2026-10-08', 'Cash', '', 'Eve Test', 'rydalmere', 85000, 0, 0, 0),
  line('cs_3', '2026-10-09', 'Stripe', 'card', '@Stranger', '', 10000, 0, 240, 22),
  line('cs_4', '2026-10-10', 'Stripe', 'link', 'Late Payer', 'belrose', 5000, 0, null, null),
  line('OFF-1', '', 'Other', '', 'Old Payer', 'rydalmere', 3000, 0, 0, 0),
]
const group = (loc, x) => ({ key: `g-${loc}`, label: 'Monday 4:20pm', coach: 'Coach Sam', ...x })
const venue = (id, x) => ({ id, name: VENUES[id], players: 0, paid: 0, owingCents: 0, receivedCents: 0, stripeCents: 0, bankCents: 0, cashCents: 0, otherCents: 0, removedCents: 0, removedFeeCents: 0, airtableOnlyCents: 0, stripeFeeCents: 0, expectedCents: 0, collectedCents: 0, owingRowIds: [], netCents: 0, collectedPct: null, juniors: null, groups: [], ...x })
const locations = [
  venue('belrose', { players: 2, paid: 1, owingCents: 85000, receivedCents: 90000, stripeCents: 90000, removedCents: 5000, stripeFeeCents: 1720, netCents: 88280, expectedCents: 170000, collectedCents: 85000, collectedPct: 50, owingRowIds: ['p2'], groups: [group('belrose', { players: 2, receivedCents: 90000, owingCents: 85000, stripeFeeCents: 1720, netCents: 88280 })] }),
  venue('ntra', { players: 3, paid: 1, owingCents: 52500, receivedCents: 105000, stripeCents: 85000, bankCents: 20000, stripeFeeCents: 6000, netCents: 99000, expectedCents: 157500, collectedCents: 105000, collectedPct: 66, owingRowIds: ['p3', 'p7'], groups: [group('ntra', { players: 3, receivedCents: 105000, owingCents: 52500, stripeFeeCents: 6000, netCents: 99000 })] }),
  venue('rydalmere', { players: 1, paid: 1, receivedCents: 88000, cashCents: 85000, otherCents: 3000, removedCents: 3000, netCents: 88000, expectedCents: 85000, collectedCents: 85000, collectedPct: 100, groups: [group('rydalmere', { players: 1, receivedCents: 88000, netCents: 88000 })] }),
  venue('other', { players: 1 }),
]
const weeks = ['2026-09-28', '2026-10-05']
const wk = (rows) => weeks.map((week, i) => ({ week, stripe: 0, bank: 0, cash: 0, fee: 0, ...(i === 1 ? rows : {}) }))
const MONEY = {
  since: '2026-09-28', stripeError: '', stripeAt: '2026-10-12T01:00:00.000Z', term: 'Term 4 2026',
  prices: { group: 85000, sibling: 42500, pathway: 95000, pathwayOneToOne: 120000, oneToOneTerm: 150000, twoAWeek: 170000, familyPlace: 85000 },
  venueTerms: ['Term 4 2026', 'Term 3 2026', 'Term 2 2026'],
  kpis: {
    incomeCents: 293000, stripeCents: 185000, stripeGrossCents: 190000, refundsCents: 5000, offlineCents: 108000, cashCents: 85000, bankCents: 20000, otherCents: 3000,
    owingCents: 137500, stripeUnrecordedCents: 1, players: 7, stripePayments: 4, venuesCents: 283000, unlinkedCents: 10000,
    stripeFeesCents: 7960, feeGstCents: 723, feesPendingCount: 1, netIncomeCents: 285040, unlinkedFeeCents: 240,
    feesByMethod: [{ method: 'afterpay_clearpay', count: 1, grossCents: 90000, feeCents: 6000, pendingCount: 0 }, { method: 'card', count: 2, grossCents: 95000, feeCents: 1960, pendingCount: 0 }, { method: 'link', count: 1, grossCents: 5000, feeCents: 0, pendingCount: 1 }],
    expectedCents: 412500, collectedCents: 275000, collectedPct: 66, nextTermCents: 50000, nextTermCount: 1, nextTermFeeCents: 1020,
  },
  unlinked: { cents: 10000, items: [] },
  status: { paid: 2, stripe: 1, part: 1, unpaid: 2, unpriced: 1, session: 0 },
  weekly: wk({ stripe: 185000, bank: 20000, cash: 85000, fee: 7960 }),
  weeklyByVenue: { belrose: wk({ stripe: 90000, fee: 1720 }), ntra: wk({ stripe: 85000, bank: 20000, fee: 6000 }), rydalmere: wk({ cash: 85000 }), other: wk({}) },
  payments,
  nextTermPayments: [{ id: 'cs_n1', at: '2026-10-09T00:00:00.000Z', name: 'Next Parent', email: 'next@example.com', cents: 50000, feeCents: 1020, product: 'JFP Term 1 2027 hold', forTerm: 'Term 1 2027' }],
  locations, players,
  unmatched: [{ id: 'cs_3', at: '2026-10-09T00:00:00.000Z', name: '@Stranger', email: 'stranger@example.com', cents: 10000, product: 'JFP' }],
  stripeMarked: [{ id: 'cs_9', kind: 'holiday', cents: 12000, date: '2026-09-22', name: 'Hana Test', product: '1 on 1 session', periodLabel: 'Spring holidays 2026' }],
}
const fresh = () => structuredClone(MONEY)
// Redesign (16 Oct 2026): Stripe, bank, cash and other sit in the Breakdown
// fold; Owing is one of the four numbers at the top.
const tiles = (p) => [...[...p.d.querySelectorAll('#m-scope [data-tile]')].map((t) => t.dataset.tile), ...(p.$('#m-kpis [data-kpi="owing"]') ? ['owing'] : [])]
const tile = (p, key) => p.text(key === 'owing' ? '#m-kpis [data-kpi="owing"] .val' : `#m-scope [data-tile="${key}"] .val`)
const chip = (p, v) => p.text(`#m-chips [data-set-status="${v}"] .n`)
const rows = (p) => p.d.querySelectorAll('#m-rows tr[data-row]').length

await test('all venues: kept after Stripe fees leads, with taken, fees, refunds, fees still loading and expected', async () => {
  const p = await openPortal({ money: fresh() })
  assert.equal(p.text('#m-kept'), money(285040))
  assert.equal(p.text('#m-taken'), money(298000))
  assert.equal(p.text('[data-kpi="taken"] .jm-kpi-sub'), `Refunded ${money(5000)}`)
  assert.equal(p.text('#m-sum'), `Stripe fees ${money(7960)}`)
  assert.equal(p.text('#m-pending'), '1 fee still loading')
  assert.match(p.text('#m-expect'), /^3 players · 66% paid/)
  assert.equal(p.$('#m-expect').title, `Expected this term ${money(412500)}, ${money(275000)} marked paid in Airtable`, 'the detail is in the tooltip')
  assert.equal(p.$('#m-expect .jm-meter span').style.width, '66%')
  assert.deepEqual(tiles(p), ['stripe', 'bank', 'cash', 'other', 'owing'], 'Other shows when there is some')
  assert.equal(p.$('#m-scope .jm-tiles').dataset.n, '4')
  assert.deepEqual([tile(p, 'stripe'), tile(p, 'bank'), tile(p, 'cash'), tile(p, 'other'), tile(p, 'owing')], [185000, 20000, 85000, 3000, 137500].map(money))
  assert.deepEqual([...p.d.querySelectorAll('#m-locs [data-mloc]')].map((b) => b.dataset.mloc), ['', 'belrose', 'ntra', 'rydalmere', 'other'])
  assert.equal(p.$('#m-locs [data-mloc=""]').getAttribute('aria-pressed'), 'true')
  assert.match(p.text('#m-locs [data-mloc="ntra"]'), /North Turramurra A\$990 kept/)
  assert.equal(p.text('#m-unlinked'), `${money(9760)} kept (${money(10000)} paid in) not linked to a player`, 'after fees, like the venue buttons')
  assert.equal(p.text('#m-undated'), `${money(3000)} has no date, so it isn't in the chart.`)
  assert.match(p.text('#m-next summary'), /^Next term A\$500 paid early · not in this term$/)
  assert.ok(p.$('#m-unmatched details'), 'the unmatched list shows under All')
  assert.match(p.text('#m-unmatched summary'), /^Unmatched Stripe 1 not linked to a player/)
  // More (18 Oct 2026): the bank line choices for a Stripe payment, and the ones marked, to put back.
  assert.deepEqual([...p.d.querySelectorAll('#m-unmatched [data-sc-id="cs_3"]')].map((b) => [b.dataset.sc, b.textContent]), [['holiday', 'Holiday training'], ['pro', 'Pro sessions'], ['notJfp', 'Not JFP']])
  assert.match(p.text('#m-stripe-marked'), /Marked as not JFP term income \(1\)Hana TestHoliday training · Spring holidays 2026/)
  assert.ok(p.$('#m-stripe-marked [data-sc-undo="cs_9"][data-sc-kind="holiday"]'))
  assert.match(p.text('#m-top .jm-alert'), /1 player has paid in Stripe, not in Airtable yet/)
  assert.deepEqual([chip(p, ''), chip(p, 'paid'), chip(p, 'unpaid'), chip(p, 'part'), chip(p, 'stripe')], ['7', '2', '2', '1', '1'])
  assert.equal(rows(p), 7)
  assert.equal(location(p), '#money')
  assert.deepEqual(p.errors, [])
  p.close()
})
function location(p) { return p.w.location.hash }

await test('the fees card: by how people paid (card and Link together), GST in the fees', async () => {
  const p = await openPortal({ money: fresh() })
  const items = [...p.d.querySelectorAll('#m-fees .jm-feelist li')].map((li) => li.textContent.replace(/\s+/g, ' ').trim())
  assert.deepEqual(items, [`Afterpay1 payment${money(6000)}`, `Card / Link3 payments · 1 still loading${money(1960)}`])
  assert.match(p.text('#m-fees .jm-fee-total'), /A\$79\.60 on 4 payments/)
  assert.equal(p.text('#m-fees .jm-gst'), `GST in these fees: ${money(723)} (claimable)`)
  p.close()
})

await test('one tap on a venue: every figure follows it, unlinked money and the unmatched list stay under All', async () => {
  const p = await openPortal({ money: fresh() })
  await p.click('#m-locs [data-mloc="ntra"]')
  assert.equal(location(p), '#money?loc=ntra')
  assert.equal(p.$('#m-locs [data-mloc="ntra"]').getAttribute('aria-pressed'), 'true')
  assert.equal(p.text('#m-kept'), money(99000))
  assert.match(p.text('#m-kpis .lbl'), /Taken · North Turramurra/)
  assert.equal(p.text('#m-taken'), money(110000))
  assert.equal(p.text('#m-sum'), `Stripe fees ${money(6000)}`)
  assert.equal(p.$('#m-pending'), null)
  assert.match(p.$('#m-expect').title, /A\$1,575, .* marked paid/)
  assert.match(p.text('#m-expect'), /66% paid/)
  assert.deepEqual(tiles(p), ['stripe', 'bank', 'cash', 'owing'], 'no Other here')
  assert.deepEqual([tile(p, 'stripe'), tile(p, 'bank'), tile(p, 'cash'), tile(p, 'owing')], [85000, 20000, 0, 52500].map(money))
  assert.match(p.text('#m-kpis [data-kpi="owing"] .jm-kpi-sub'), /^2 players/)
  for (const id of ['#m-unlinked', '#m-next', '#m-unmatched details']) assert.equal(p.$(id), null, `${id} is for All only`)
  assert.match(p.text('#m-top .jm-alert'), /1 player at North Turramurra has paid in Stripe/)
  assert.deepEqual([chip(p, ''), chip(p, 'paid'), chip(p, 'unpaid'), chip(p, 'part'), chip(p, 'stripe')], ['3', '0', '1', '1', '1'])
  assert.equal(rows(p), 3)
  assert.equal(p.text('#m-count'), `3 of 3 players at North Turramurra · owing ${money(52500)}`)
  const week = [...p.d.querySelectorAll('#m-scope .jc-table tbody tr')].map((tr) => tr.textContent)
  assert.equal(week[1], `2026-10-05${money(85000)}${money(20000)}A$0${money(6000)}`, 'the weekly chart is the venue\'s')
  assert.match(p.text('#m-fees h3'), /Stripe fees · North Turramurra/)
  assert.match(p.text('#m-fees .jm-gst'), /A\$5\.45/)
  // The status picked stays as the venue changes; By family follows the venue too.
  await p.click('#m-chips [data-set-status="unpaid"]')
  assert.equal(rows(p), 1)
  await p.click('#m-locs [data-mloc="belrose"]')
  assert.deepEqual([...p.d.querySelectorAll('#m-rows tr[data-row]')].map((tr) => tr.dataset.row), ['p2'])
  assert.equal(p.text('#m-kept'), money(88280))
  await p.click('[data-money-view="family"]')
  assert.match(p.text('#m-fams'), /Ben Test/)
  assert.doesNotMatch(p.text('#m-fams'), /Gus Test|Ava Test/)
  await p.click('[data-money-view="players"]')
  await p.click('#m-locs [data-mloc=""]')
  assert.equal(location(p), '#money')
  assert.equal(p.text('#m-kept'), money(285040))
  assert.deepEqual(p.errors, [])
  p.close()
})

await test('a venue link opens on that venue; a venue that is not there falls back to All', async () => {
  let p = await openPortal({ money: fresh(), hash: '#money?loc=rydalmere' })
  assert.equal(p.$('#m-locs [data-mloc="rydalmere"]').getAttribute('aria-pressed'), 'true')
  assert.equal(p.text('#m-kept'), money(88000))
  assert.deepEqual(tiles(p), ['stripe', 'bank', 'cash', 'other', 'owing'])
  assert.equal(location(p), '#money?loc=rydalmere', 'the link is kept')
  p.close()
  p = await openPortal({ money: fresh(), hash: '#money?loc=nowhere' })
  assert.equal(p.text('#m-kept'), money(285040))
  assert.equal(location(p), '#money')
  p.close()
  // No players or money with no venue set: no button for it.
  const m = fresh()
  m.locations = m.locations.filter((l) => l.id !== 'other').concat(venue('other', {}))
  p = await openPortal({ money: m })
  assert.ok(!p.$('#m-locs [data-mloc="other"]'))
  assert.equal(p.$('#m-scope .jm-tiles').dataset.n, '4')
  p.close()
  // No Other money: four tiles.
  const m2 = fresh()
  m2.kpis.otherCents = 0
  p = await openPortal({ money: m2 })
  assert.deepEqual(tiles(p), ['stripe', 'bank', 'cash', 'owing'])
  p.close()
})

await test('download for the accountant: players and payments for the venue picked, totals that match the page', async () => {
  const p = await openPortal({ money: fresh(), hash: '#money?loc=belrose' })
  await p.click('#m-csv')
  let { name, text } = await p.csv()
  assert.equal(name, 'jfp-money-term-4-2026-belrose.csv')
  let r = csvRows(text)
  const find = (rows, first, after = 0) => rows.findIndex((x, i) => i >= after && x[0] === first)
  assert.deepEqual(r[0].slice(0, 3), ['JFP money', 'Term 4 2026', 'Belrose HQ'])
  assert.deepEqual(r[find(r, 'Kept after Stripe fees')], ['Kept after Stripe fees', '882.80'])
  assert.deepEqual(r[find(r, 'Taken')], ['Taken', '900.00'])
  const ph = find(r, 'Player')
  assert.deepEqual(r[ph], ['Player', 'Group', 'Venue', 'Fee (A$)', 'Paid this term (A$)', 'Owing (A$)', 'Stripe fee (A$)', 'Kept (A$)', 'Status'])
  assert.deepEqual(r[ph + 1], ['Ava Test', 'Monday 4:20pm', 'Belrose HQ', '850.00', '850.00', '0.00', '17.20', '832.80', 'Paid'])
  assert.deepEqual(r[ph + 2], ['Ben Test', 'Monday 4:20pm', 'Belrose HQ', '850.00', '0.00', '850.00', '0.00', '0.00', 'Unpaid'])
  assert.deepEqual(r[ph + 3], ['Players since removed', '', '', '', '50.00', '', '0.00', '50.00', ''])
  assert.deepEqual(r[ph + 4], ['Total', '', '', '1700.00', '900.00', '850.00', '17.20', '882.80', ''])
  const pay = find(r, 'Date')
  assert.deepEqual(r[pay], ['Date', 'Method', 'Paid by or for', 'Taken (A$)', 'Stripe fee (A$)', 'GST in fee (A$)', 'Refunded (A$)', 'Kept (A$)', 'Venue', 'Reference'])
  assert.deepEqual(r[pay + 1], ['2026-10-05', 'Stripe (Card / Link)', 'Ava Parent', '850.00', '17.20', '1.56', '0.00', '832.80', 'Belrose HQ', 'cs_1'])
  assert.deepEqual(r[pay + 2].slice(0, 8), ['2026-10-10', 'Stripe (Card / Link)', 'Late Payer', '50.00', '', '', '0.00', ''], 'a fee not known yet is blank, never 0, and so is kept')
  assert.deepEqual(r[pay + 3], ['Total', '', '', '900.00', '17.20', '1.56', '0.00', '832.80', '', ''])
  assert.match(text, /A blank Stripe fee \(and kept\) was not known yet/)
  // All venues: unlinked money is in, and text that looks like a formula stays text.
  await p.click('#m-locs [data-mloc=""]')
  await p.click('#m-csv');
  ({ name, text } = await p.csv())
  assert.equal(name, 'jfp-money-term-4-2026-all.csv')
  r = csvRows(text)
  assert.deepEqual(r[find(r, 'Kept after Stripe fees')], ['Kept after Stripe fees', '2850.40'])
  assert.deepEqual(r[find(r, 'Not linked to a player yet')].slice(4, 8), ['100.00', '', '2.40', '97.60'])
  const pt = find(r, 'Total')
  assert.deepEqual(r[pt].slice(4, 8), ['2930.00', '1375.00', '79.60', '2850.40'], 'the players add up to the term')
  const total = find(r, 'Total', pt + 1)
  assert.deepEqual(r[total].slice(3, 8), ['2980.00', '79.60', '7.23', '50.00', '2800.40'], 'the payments add up to the term (the one with no fee yet has no kept)')
  const stranger = r.find((x) => x[9] === 'cs_3')
  assert.deepEqual([stranger[2], stranger[8]], ["'@Stranger", 'Not linked to a player'])
  assert.ok(r.find((x) => x[9] === 'OFF-1')[0] === '', 'marked paid offline, no date')
  p.close()
  // A player whose Stripe fee is still loading: their fee and kept are blank, not 0.00.
  const m2 = fresh()
  Object.assign(m2.players.find((x) => x.rowId === 'p1'), { stripeFeeCents: 0, netReceivedCents: 85000, stripeFeePending: 1 })
  const q = await openPortal({ money: m2, hash: '#money?loc=belrose' })
  await q.click('#m-csv')
  const rows2 = csvRows((await q.csv()).text)
  assert.deepEqual(rows2.find((x) => x[0] === 'Ava Test').slice(6, 8), ['', ''])
  q.close()
})

await test('the venue window: kept as the main number, expected, who still owes biggest first, tap for their payments', async () => {
  const p = await openPortal({ money: fresh(), hash: '#overview', player: { player: 'Gus Test', parent: 'Gus Parent', email: 'p7@example.com', feeCents: 30000, paidCents: 0, stripe: [{ id: 'cs_n1', at: '2026-10-09T00:00:00.000Z', cents: 50000, refundedCents: 0, product: 'JFP Term 1 2027 hold', recorded: false, feeCents: 1020, payMethod: 'card', nextTerm: true }], ledger: [], links: [], history: [] } })
  const btn = p.$('.jv-list [data-venue="ntra"]')
  assert.equal(btn.querySelector('.amt').textContent, money(99000), 'the dashboard venue shows what was kept')
  assert.match(btn.textContent, /kept after fees · paid in A\$1,050/)
  await p.click(btn)
  assert.equal(p.text('#jv-kept'), money(99000))
  assert.match(p.text('.jv-kept'), /Kept after Stripe fees.*Taken A\$1,100 · Refunded A\$50 · Paid in A\$1,050 · Stripe fees A\$60/)
  // One meaning each: Taken is before refunds, Paid in after. The groups add up to Paid in.
  const table = p.$('#jp-modal .jm-table')
  const col = [...table.querySelectorAll('thead th')].findIndex((th) => th.textContent === 'Paid in')
  assert.ok(col > 0, 'the group column is Paid in')
  const cents = (t) => Math.round(Number(t.replace(/[^0-9.]/g, '')) * 100)
  const groupSum = [...table.querySelectorAll('tbody tr:not(.jv-total)')].reduce((t, tr) => t + cents(tr.children[col].textContent), 0)
  assert.equal(groupSum, 105000)
  assert.match(p.text('.jv-kept'), new RegExp(`Paid in ${money(groupSum).replace('$', '\\$')}`))
  assert.doesNotMatch(p.text('#jp-modal'), /Before Stripe fees/i)
  assert.match(p.text('#jp-modal .jv-kpis'), /Expected this term\s*A\$1,575\s*66% marked paid \(A\$1,050\)/)
  const owing = [...p.d.querySelectorAll('#jv-owing [data-owe-row]')].map((b) => b.dataset.oweRow)
  assert.deepEqual(owing, ['p7', 'p3'], 'biggest first')
  assert.match(p.text('#jv-owing summary'), /Still owing \(2\) · A\$525/)
  assert.match(p.text('#jv-owing [data-owe-row="p7"]'), /Gus Test Monday 4:20pm A\$300 Unpaid/)
  await p.click('#jv-owing [data-owe-row="p7"]')
  assert.equal(p.$('#jp-modal'), null, 'the window closes')
  assert.ok(p.$('.jm-drawer'), 'and the player\'s payments open')
  assert.ok(p.posts.some((b) => b.action === 'playerPayments' && b.rowId === 'p7'))
  const li = p.text('.jm-drawer .jm-hist li')
  assert.match(li, /Card \/ Link · Stripe fee A\$10\.20/)
  assert.match(li, /Next term/)
  assert.equal(p.$('.jm-drawer [data-rec-stripe]'), null, 'a next term payment is not recorded against this term')
  assert.deepEqual(p.errors, [])
  p.close()
})

await test('an older term from the Money Register: fees not known, so taken is the number and there is no kept column', async () => {
  const reg = { term: 'Term 2 2026', source: 'register', importedAt: '2026-07-01', incomeCents: 200000, netIncomeCents: null, stripeFeesCents: null, unlinkedFeeCents: null, feesPendingCount: 0, unlinked: { cents: 0, count: 0 }, players: [], register: {},
    venues: [venue('belrose', { players: 4, receivedCents: 200000, stripeCents: 200000, stripeFeeCents: null, netCents: null, groups: [group('belrose', { players: 4, receivedCents: 200000, stripeFeeCents: null, netCents: null })] })] }
  const p = await openPortal({ money: fresh(), hash: '#overview', onPost: (b) => (b.action === 'venues' ? { success: true, venues: reg } : null) })
  await p.click('.jv-list [data-venue="belrose"]')
  const sel = p.$('#jv-term')
  sel.value = 'Term 2 2026'
  sel.dispatchEvent(new p.w.Event('change', { bubbles: true }))
  await p.settle()
  assert.match(p.text('.jv-kept'), /Taken\s*A\$2,000\s*Stripe fees not known for this term/)
  assert.ok(![...p.d.querySelectorAll('#jp-modal th')].some((th) => th.textContent === 'Kept'))
  assert.match(p.text('.jv-notes'), /Stripe fees not known for this term/)
  assert.doesNotMatch(p.text('#jp-modal'), /Before Stripe fees|before any fees/i)
  p.close()
})

await test('the dashboard\'s "see who" opens Money for every venue, whichever venue was picked before', async () => {
  const p = await openPortal({ money: fresh(), hash: '#money?loc=ntra' })
  assert.equal(p.text('#m-kept'), money(99000))
  await p.click('#nav [data-tab="overview"]')
  await p.click('.jd-tile [data-money-filter="unpaid"]')
  assert.equal(location(p), '#money')
  assert.equal(p.text('#m-kept'), money(285040))
  assert.equal(p.$('#m-chips [data-set-status="unpaid"]').getAttribute('aria-pressed'), 'true')
  p.close()
})


// ---------- venue costs, profit, marked paid but no money found ----------
const costed = () => {
  const m = fresh()
  const hq = m.locations.find((l) => l.id === 'belrose')
  Object.assign(hq, { costLines: [{ label: 'Hall hire', cents: 30000 }, { label: 'Cleaning', cents: 4280 }], costsCents: 34280, profitCents: 88280 - 34280, profitBeforeFees: false })
  for (const l of m.locations) if (l.id !== 'belrose') Object.assign(l, { costLines: [], costsCents: 0, profitCents: l.netCents, profitBeforeFees: false })
  Object.assign(m.kpis, { venueCostsCents: 34280, profitCents: 285040 - 34280, venuesWithCosts: 1, paidNoMoneyCount: 2, paidNoMoneyCents: 125000 })
  m.venueCostsLast = { term: 'Term 3 2026', byVenue: { ntra: [{ label: 'Field hire', cents: 41000 }] } }
  m.paidNoMoney = [
    { rowId: 'p5', player: 'Eve Test', locationId: 'rydalmere', group: 'Monday 4:20pm, Rydalmere Park', status: 'paid', feeCents: 85000, airtableSaysCents: 85000, foundCents: 0, missingCents: 85000 },
    { rowId: 'p3', player: 'Cal Test', locationId: 'ntra', group: 'Monday 4:20pm, North Turramurra', status: 'part', feeCents: 42500, airtableSaysCents: 60000, foundCents: 20000, missingCents: 40000 },
  ]
  return m
}

await test('profit after costs: under All when a venue has costs, per venue when it has its own, and in the download', async () => {
  const p = await openPortal({ money: costed() })
  assert.equal(p.text('#m-profit'), `Profit ${money(250760)}`)
  assert.equal(p.$('#m-profit').title, 'Venue costs A$342.80. Coach wages aren\'t in this unless you add them as a cost.', 'the caveat is in the tooltip')
  await p.click('#m-locs [data-mloc="belrose"]')
  assert.match(p.text('#m-profit'), /Profit A\$540(?!\d)/)
  await p.click('#m-locs [data-mloc="ntra"]')
  assert.equal(p.$('#m-profit'), null, 'no costs at this venue, so no profit line')
  assert.equal(p.text('#m-add-costs'), '+ Add costs for profit')
  await p.click('#m-add-costs')
  assert.ok(p.$('#jp-modal #jv-costs'), 'the button opens the venue window at its costs')
  p.close()
  const q = await openPortal({ money: costed(), hash: '#money?loc=belrose' })
  await q.click('#m-csv')
  const r = csvRows((await q.csv()).text)
  assert.deepEqual(r.find((x) => x[0] === 'Venue costs'), ['Venue costs', '342.80'])
  assert.deepEqual(r.find((x) => x[0] === 'Profit after costs'), ['Profit after costs', '540.00'])
  q.close()
  const none = await openPortal({ money: fresh() })
  assert.equal(none.$('#m-profit'), null, 'no costs anywhere: nothing about profit')
  assert.equal(none.$('#m-pnm'), null)
  none.close()
})

await test('marked paid but no money found: listed by venue, biggest gap first, a tap opens the payments', async () => {
  const p = await openPortal({ money: costed() })
  assert.match(p.text('#m-pnm summary'), /^Paid, no money found 2 players · A\$1,250\?Airtable says these are paid/, 'the why is behind the ?')
  assert.deepEqual([...p.d.querySelectorAll('#m-pnm [data-pnm-row]')].map((b) => b.dataset.pnmRow), ['p5', 'p3'])
  assert.match(p.text('#m-pnm [data-pnm-row="p3"]'), /Cal Test Monday 4:20pm · Airtable says A\$600 · found A\$200 ?A\$400 not found/)
  await p.click('#m-locs [data-mloc="ntra"]')
  assert.deepEqual([...p.d.querySelectorAll('#m-pnm [data-pnm-row]')].map((b) => b.dataset.pnmRow), ['p3'], 'follows the venue')
  await p.click('#m-pnm [data-pnm-row="p3"]')
  assert.ok(p.$('.jm-drawer'))
  assert.ok(p.posts.some((b) => b.action === 'playerPayments' && b.rowId === 'p3'))
  await p.click('#m-locs [data-mloc="belrose"]')
  assert.equal(p.$('#m-pnm'), null, 'none at this venue')
  assert.deepEqual(p.errors, [])
  p.close()
})

await test('the venue window: costs, profit after fees and costs, edit, copy last term, save', async () => {
  let saved = null
  const after = costed()
  const p = await openPortal({ money: costed(), hash: '#overview', onPost: (b) => {
    if (b.action !== 'saveVenueCosts') return null
    saved = b
    const nt = after.locations.find((l) => l.id === 'ntra')
    Object.assign(nt, { costLines: b.lines, costsCents: b.lines.reduce((t, x) => t + x.cents, 0) })
    nt.profitCents = nt.netCents - nt.costsCents
    return { success: true, term: b.term, venueId: b.venueId, lines: b.lines, costsCents: nt.costsCents }
  } })
  await p.click('.jv-list [data-venue="belrose"]')
  assert.deepEqual([...p.d.querySelectorAll('#jv-costs .jm-feelist li')].map((li) => li.textContent.replace(/\s+/g, ' ').trim()), ['Hall hireA$300', 'CleaningA$42.80', 'Total costsA$342.80'])
  assert.equal(p.text('#jv-profit'), money(54000))
  assert.match(p.text('#jv-costs'), /Profit after fees and costs.*Kept after Stripe fees A\$882\.80 less costs A\$342\.80/)
  assert.match(p.text('#jv-costs'), /Coach wages aren't in this unless you add them as a cost/)
  await p.click('#jp-modal [data-venue="ntra"]')
  assert.match(p.text('#jv-costs'), /No costs added yet/)
  assert.equal(p.text('#jv-cost-edit'), 'Add costs')
  await p.click('#jv-cost-edit')
  assert.equal(p.d.querySelectorAll('#jv-cost-rows .jv-cost-row').length, 1, 'one blank line to start')
  // A line with an amount and no name is refused before anything is sent.
  p.$('#jv-cost-rows [data-cc]').value = '50'
  await p.click('#jv-cost-go')
  assert.equal(saved, null)
  assert.match(p.text('.j-toast'), /Give each cost a name/)
  await p.click('#jv-cost-copy')
  const rows = () => [...p.d.querySelectorAll('#jv-cost-rows .jv-cost-row')].map((r) => [r.querySelector('[data-cl]').value, r.querySelector('[data-cc]').value])
  assert.deepEqual(rows(), [['Field hire', '410']], "last term's lines copied in")
  await p.click('#jv-cost-add')
  const last = p.d.querySelectorAll('#jv-cost-rows .jv-cost-row')[1]
  last.querySelector('[data-cl]').value = 'Lights'
  last.querySelector('[data-cc]').value = 'A$1,234.50'
  await p.click('#jv-cost-add')
  await p.click(p.d.querySelectorAll('#jv-cost-rows [data-cost-del]')[2])
  assert.equal(rows().length, 2, 'a line can be taken out')
  p.$('#jv-cost-rows [data-cc]').value = '420'
  const before = p.posts.filter((b) => b.action === 'money').length
  // The page reads Money again after a save.
  p.w.fetch = ((orig) => async (url, init) => { const b = init?.body ? JSON.parse(init.body) : {}; if (b.action === 'money') { p.posts.push(b); return { ok: true, status: 200, json: async () => ({ success: true, money: after }) } } return orig(url, init) })(p.w.fetch)
  await p.click('#jv-cost-go')
  assert.deepEqual(saved, { action: 'saveVenueCosts', term: 'Term 4 2026', venueId: 'ntra', lines: [{ label: 'Field hire', cents: 42000 }, { label: 'Lights', cents: 123450 }] })
  assert.ok(p.posts.filter((b) => b.action === 'money').length > before, 'Money is read again')
  assert.equal(p.text('#jv-profit'), `-${money(165450 - 99000)}`, 'a loss shows with a minus')
  assert.deepEqual(p.errors, [])
  p.close()
})

// ---------- bank transfers to check ----------
const XA = 'XERO-00000001-aaaa-4bbb-8ccc-000000000001', XC = 'XERO-00000003-aaaa-4bbb-8ccc-000000000003', CB = `CSV-${'b'.repeat(40)}`
const cand = (rowId, x) => { const pl = players.find((q) => q.rowId === rowId); return { rowId, player: pl.player, parent: pl.parent, locationId: pl.locationId, group: pl.group, status: pl.status, owingCents: pl.owingCents, feeCents: pl.feeCents, score: 3, exact: true, reason: "name matches the parent, amount = what's owing", familyRowIds: [rowId], familyOwingCents: pl.owingCents, ...x } }
const BANK = () => ({
  sources: { xeroAt: '2026-10-12T02:30:00.000Z', xeroItems: 3, csvAt: '', csvItems: 1 },
  items: [
    { id: XA, date: '2026-10-10', cents: 115000, payer: 'M FEATHERSTONE', description: 'Fast Transfer From M Featherstone', reference: '', source: 'xero', grade: 'high', candidates: [cand('p2', { reason: "name matches the parent, amount = the family's total owing", familyRowIds: ['p2', 'p7'], familyOwingCents: 115000 }), cand('p7', { score: 2, exact: false })] },
    { id: CB, date: '2026-10-09', cents: 22500, payer: 'Transfer from C Quill', description: 'Transfer from C Quill', reference: '', source: 'csv', grade: 'possible', candidates: [cand('p3', { score: 2 })] },
    { id: XC, date: '2026-10-08', cents: 5000, payer: 'Q Zanzibarre', description: 'Q Zanzibarre', reference: '', source: 'xero', grade: 'none', candidates: [] },
  ],
  counts: { checked: 3, high: 1, possible: 1, none: 1 },
})
const bankIds = (p) => [...p.d.querySelectorAll('#m-bank [data-bank]')].map((li) => li.dataset.bank)

await test('bank transfers to check: the count, where it is from, the hint, and it follows the venue', async () => {
  const m = fresh()
  for (const pl of m.players) if (['p2', 'p7'].includes(pl.rowId)) pl.familyKey = 'fam@example.com'
  const p = await openPortal({ money: m, onPost: (b) => (b.action === 'bankCheck' ? { success: true, bank: BANK() } : null) })
  assert.equal(p.posts.filter((b) => b.action === 'bankCheck').length, 1, 'read once, on its own')
  assert.match(p.text('#m-bank summary'), /^Bank payments 3 to check · 2 matched · checked /)
  assert.match(p.text('#m-bank-xero'), /^Xero \d/)
  // These lines are days old, so the amber note shows with the upload in it (15 Oct 2026).
  assert.match(p.text('#m-bank-old'), /^Xero only has bank lines up to 10 Oct\. Payments appear there after they're reconciled in Xero\. For anything newer, upload today's CommBank statement \(CSV\)\./)
  assert.match(p.text('#m-bank-status'), /^Checked .+ · lines to 10 Oct$/)
  assert.equal(p.text('#m-bank-old label[for="m-bank-file"]'), 'Upload bank CSV')
  assert.equal(p.$('#m-bank-old label[for="m-bank-file"]').title, 'CommBank NetBank > Accounts > Export > CSV', 'where to find it, in the tooltip')
  assert.deepEqual(bankIds(p), [XA, CB, XC])
  const first = p.$(`#m-bank [data-bank="${XA}"]`)
  const bits = (sel) => [...first.querySelectorAll(sel)].map((x) => x.textContent.replace(/\s+/g, ' ').trim())
  assert.deepEqual(bits('.top > *'), ['10 Oct', money(115000), 'Likely match'])
  assert.equal(bits('.payer')[0], 'M FEATHERSTONE Fast Transfer From M Featherstone')
  assert.deepEqual(bits('.cand > *'), ['Ben Test', '(Ben Parent)', "name matches the parent, amount = the family's total owing · Also: Gus Test"])
  assert.match(bits('.cand')[0], /owing A\$850/)
  assert.equal(first.querySelector('[data-bank-rec]').textContent, 'Record for Ben')
  assert.match(p.$(`#m-bank [data-bank="${XC}"]`).textContent, /No match yet[\s\S]*No player with that name/)
  assert.equal(p.$(`#m-bank [data-bank="${XC}"] [data-bank-rec]`), null, 'nothing to record for with no match')
  await p.click('#m-locs [data-mloc="ntra"]')
  assert.deepEqual(bankIds(p), [CB], 'a venue shows lines whose best match is there')
  assert.match(p.text('#m-bank summary'), /^Bank payments 1 to check · 1 matched/)
  await p.click('#m-locs [data-mloc="rydalmere"]')
  assert.deepEqual(bankIds(p), [])
  assert.match(p.text('#m-bank'), /Nothing to check at this venue/)
  await p.click('#m-locs [data-mloc=""]')
  assert.deepEqual(bankIds(p), [XA, CB, XC])
  // The two minute refresh draws Money again without asking the bank again.
  assert.equal(p.posts.filter((b) => b.action === 'bankCheck').length, 1)
  assert.deepEqual(p.errors, [])
  p.close()
})

await test('bank transfers: record for a family in one tap with the line id, pick another player, hide one, upload a CSV', async () => {
  const m = fresh()
  for (const pl of m.players) if (['p2', 'p7'].includes(pl.rowId)) pl.familyKey = 'fam@example.com'
  let bank = BANK()
  const p = await openPortal({ money: m, onPost: (b) => {
    if (b.action === 'bankCheck') return { success: true, bank }
    if (b.action === 'recordPayment') { bank = { ...bank, items: bank.items.filter((x) => x.id !== b.externalId) }; return { success: true, ledger: true } }
    if (b.action === 'bankUpload') return { success: true, lines: b.lines.length, kept: b.lines.length, added: 1, total: 2 }
    return null
  } })
  await p.click(`#m-bank [data-bank="${XA}"] [data-bank-rec]`)
  assert.match(p.text('#jp-modal'), /Record a bank transfer Bank, 10\/10\/2026: A\$1,150 · M FEATHERSTONE Who was it for\?/)
  const boxes = () => [...p.d.querySelectorAll('#bk-rows input')].map((x) => [x.value, x.checked])
  assert.deepEqual(boxes(), [['p2', true], ['p7', true]], 'the amount is what the family owes, so both are ticked')
  p.$('#bk-rows input[value="p7"]').checked = false
  p.$('#bk-rows input[value="p2"]').checked = false
  await p.click('#bk-go')
  assert.match(p.text('.j-toast'), /Tick who it was for/)
  p.$('#bk-rows input[value="p2"]').checked = true
  p.$('#bk-rows input[value="p7"]').checked = true
  await p.click('#bk-go')
  assert.deepEqual(p.posts.find((b) => b.action === 'recordPayment'), { action: 'recordPayment', rowIds: ['p2', 'p7'], amountCents: 115000, method: 'Bank transfer', date: '2026-10-10', note: '', externalId: XA })
  assert.equal(p.$('#jp-modal'), null)
  assert.deepEqual(bankIds(p), [CB, XC], 'the recorded line drops off')
  assert.equal(p.posts.filter((b) => b.action === 'bankCheck').length, 2, 'and the bank is asked again')
  // Another player: search, pick, record.
  await p.click(`#m-bank [data-bank="${XC}"] [data-bank-other]`)
  const q = p.$('#pk-q')
  q.value = 'cal'
  q.dispatchEvent(new p.w.Event('input', { bubbles: true }))
  await p.click('#pk-res [data-pick="p3"]')
  assert.deepEqual(boxes(), [['p3', true]])
  assert.ok(p.$('#bk-rows input').disabled, 'one player: nothing to tick')
  p.$('#bk-note').value = 'Grandma paid'
  await p.click('#bk-go')
  assert.deepEqual(p.posts.filter((b) => b.action === 'recordPayment').at(-1), { action: 'recordPayment', rowIds: ['p3'], amountCents: 5000, method: 'Bank transfer', date: '2026-10-08', note: 'Grandma paid', externalId: XC })
  // Not JFP: asked first (easy to hit by mistake on a phone), then under Hidden, where it can come back.
  await p.click(`#m-bank [data-bank="${CB}"] [data-bank-ignore]`)
  assert.match(p.text('#jp-modal'), /Hide A\$225 from .*It goes under Hidden/)
  await p.click('#jp-modal [data-no]')
  assert.deepEqual(p.posts.filter((b) => b.action === 'bankIgnore'), [], 'Cancel hides nothing')
  assert.ok(bankIds(p).includes(CB))
  await p.click(`#m-bank [data-bank="${CB}"] [data-bank-ignore]`)
  await p.click('#jp-modal [data-yes]')
  assert.deepEqual(p.posts.filter((b) => b.action === 'bankIgnore'), [{ action: 'bankIgnore', id: CB }])
  assert.ok(!bankIds(p).includes(CB))
  assert.match(p.text('#m-bank-hidden summary'), /Hidden \(1\)/)
  bank = { ...bank, hidden: [] }
  await p.click(`#m-bank-hidden [data-bank-hid="${CB}"] [data-bank-show]`)
  assert.deepEqual(p.posts.filter((b) => b.action === 'bankUnignore'), [{ action: 'bankUnignore', id: CB }])
  // Upload: read here, only money in is sent.
  const input = p.$('#m-bank-file')
  const csvText = '10/10/2026,"+850.00","Fast Transfer From A Brightwater","+1850.00"\r\n09/10/2026,"-12.00","Cones","+1000.00"\r\n'
  Object.defineProperty(input, 'files', { configurable: true, value: [{ text: async () => csvText }] })
  input.dispatchEvent(new p.w.Event('change', { bubbles: true }))
  await p.settle()
  assert.deepEqual(p.posts.find((b) => b.action === 'bankUpload'), { action: 'bankUpload', lines: [{ date: '2026-10-10', cents: 85000, description: 'Fast Transfer From A Brightwater' }] })
  assert.match(p.text('.j-toast'), /Read 1 payment in\. 1 could be JFP, 1 new/)
  assert.deepEqual(p.errors, [])
  p.close()
})


await test('bank transfers: an old Xero update is flagged; the other copy of a recorded transfer asks first', async () => {
  const old = new Date(Date.now() - 30 * 3600000).toISOString()
  let twinAsked = 0
  const p = await openPortal({ money: fresh(), onPost: (b) => {
    if (b.action === 'bankCheck') return { success: true, bank: { ...BANK(), sources: { xeroAt: old, xeroItems: 2, csvAt: '', csvItems: 0 } } }
    if (b.action === 'recordPayment' && !b.confirmTwin) { twinAsked += 1; return { status: 409, success: false, code: 'twin', error: 'This looks like the same transfer as the A$1,150 from M FEATHERSTONE on 2026-10-10, already recorded from the bank CSV. Only record it if it is a different payment.' } }
    if (b.action === 'recordPayment') return { success: true, ledger: true }
    return null
  } })
  assert.match(p.text('#m-bank-stale'), /^Xero hasn't updated since \d+ \w+\. Upload the bank CSV for now\.$/)
  await p.click(`#m-bank [data-bank="${XA}"] [data-bank-rec]`)
  await p.click('#bk-go')
  assert.equal(twinAsked, 1)
  assert.match(p.text('#jp-modal'), /looks like the same transfer/)
  await p.click('#jp-modal [data-no]')
  assert.equal(p.posts.filter((b) => b.action === 'recordPayment').length, 1, 'Cancel records nothing')
  await p.click(`#m-bank [data-bank="${XA}"] [data-bank-rec]`)
  await p.click('#bk-go')
  await p.click('#jp-modal [data-yes]')
  assert.equal(p.posts.filter((b) => b.action === 'recordPayment' && b.confirmTwin === true && b.externalId === XA).length, 1)
  assert.deepEqual(p.errors, [])
  p.close()
})

await test('a venue with no money: a plain line, not an empty chart; no costs for "No venue set"', async () => {
  const m = fresh()
  for (const l of m.locations) l.canCost = l.id !== 'other'
  const p = await openPortal({ money: m, hash: '#money?loc=other' })
  assert.equal(p.text('#m-weekly'), 'No money in yet at No venue set.')
  assert.equal(p.$('#m-weekly svg'), null)
  assert.equal(p.text('#m-fees .muted'), 'No Stripe payments yet.')
  assert.doesNotMatch(p.text('#m-fees'), /GST|on 0 payments/)
  assert.equal(p.$('#m-add-costs'), null, 'no costs to add for players with no venue')
  await p.click('#m-locs [data-mloc="rydalmere"]')
  assert.ok(p.$('#m-add-costs'), 'a real venue can have costs')
  p.close()
  const q = await openPortal({ money: m, hash: '#overview' })
  await q.click('.jv-list [data-venue="other"]')
  assert.equal(q.$('#jv-cost-edit'), null)
  assert.equal(q.text('#jv-no-costs'), 'Set a venue on these players to add costs.')
  q.close()
})

await test('paid in Stripe but only part of the fee: still on the owing list for what is left; folds stay open on refresh', async () => {
  const m = fresh()
  Object.assign(m.players.find((x) => x.rowId === 'p4'), { stripeCents: 10000, stripeAppliedCents: 10000, stillOwingCents: 75000, owingCents: 0 })
  m.paidNoMoney = [{ rowId: 'p5', player: 'Eve Test', locationId: 'rydalmere', group: 'Monday 4:20pm, Rydalmere Park', status: 'paid', feeCents: 85000, airtableSaysCents: 85000, foundCents: 0, missingCents: 85000 }]
  const p = await openPortal({ money: m, hash: '#overview' })
  await p.click('.jv-list [data-venue="ntra"]')
  const owing = [...p.d.querySelectorAll('#jv-owing [data-owe-row]')].map((b) => b.dataset.oweRow)
  assert.deepEqual(owing, ['p4', 'p7', 'p3'])
  assert.match(p.text('#jv-owing [data-owe-row="p4"]'), /A\$750/)
  assert.match(p.text('#jv-owing summary'), /Still owing \(3\) · A\$1,275/)
  p.close()
  const q = await openPortal({ money: m })
  assert.match(q.text('#m-pnm-go'), /^A\$850 with no money found$/)
  await q.click('#m-pnm-go')
  assert.equal(q.$('#m-pnm').open, true)
  q.$('#m-next').open = true
  q.$('#m-next').dispatchEvent(new q.w.Event('toggle'))
  q.$('#m-weekly-table').open = true
  q.$('#m-weekly-table').dispatchEvent(new q.w.Event('toggle'))
  // The quiet redraw (a click on the venue already picked redraws the same way).
  await q.click('#m-locs [data-mloc="ntra"]')
  await q.click('#m-locs [data-mloc=""]')
  assert.equal(q.$('#m-pnm').open, true, 'still open')
  assert.equal(q.$('#m-next').open, true)
  assert.equal(q.$('#m-weekly-table').open, true)
  assert.deepEqual(q.errors, [])
  q.close()
})

await test("bank transfers: nothing from Xero yet, and a failed read says so", async () => {
  const p = await openPortal({ money: fresh(), onPost: (b) => (b.action === 'bankCheck' ? { success: true, bank: { sources: { xeroAt: '', xeroItems: 0, csvAt: '', csvItems: 0 }, items: [], counts: {} } } : null) })
  assert.equal(p.text('#m-bank-xero'), 'No Xero update in the last 3 days')
  assert.match(p.text('#m-bank-stale'), /Xero has stopped sending\. Upload the bank CSV for now\./)
  assert.match(p.text('#m-bank'), /Nothing to check\. Every bank transfer/)
  p.close()
  const q = await openPortal({ money: fresh(), onPost: (b) => (b.action === 'bankCheck' ? { success: false, error: 'Bank lines could not be read.' } : null) })
  assert.match(q.text('#m-bank'), /could not be read/)
  q.close()
})

await test('By family: Text it too opens the text with the invoice link after sending; Text the family any time; the words can be changed', async () => {
  const m = fresh()
  for (const pl of m.players) if (['p2', 'p7'].includes(pl.rowId)) Object.assign(pl, { familyKey: 'fam@example.com', email: 'fam@example.com', phone: '0400 111 222', paidCents: 0 })
  const p = await openPortal({ money: m, onPost: (b) => (b.action === 'familyInvoice' ? { success: true, payreq: { id: 'PAY-1', url: 'https://jonerfootball.com/jfp-account/?pay=PAY-1', amountCents: 130000, amountLabel: money(130000) }, emailed: true, replaced: 0 } : b.action === 'quickText' ? { success: true, message: { id: 'M1', status: 'queued' }, hoursOpen: true } : b.action === 'get' ? { success: true, message: { id: 'M1', status: 'sent', statusLabel: 'Sent' } } : null) })
  await p.click('[data-money-view="family"]')
  const fam = () => p.$('#m-fams [data-fam="fam@example.com"]')
  assert.ok(fam().querySelector('[data-text]').checked, 'ticked when there is a mobile')
  await p.click('#m-fams [data-fam="fam@example.com"] [data-text-now]')
  assert.match(p.$('#tx-text').value, /^Hi Ben,\n\nIt's Lee from Joner Football\. Here is the invoice for /)
  p.$('[data-close]').click()
  for (const b of fam().querySelectorAll('[data-preset="sibling"]')) b.click()
  await p.click('#m-fams [data-fam="fam@example.com"] [data-send]')
  await p.click('[data-yes]')
  await new Promise((r) => setTimeout(r, 20))
  assert.equal(p.posts.filter((b) => b.action === 'familyInvoice').length, 1)
  const words = p.$('#tx-text').value
  assert.match(words, /You can pay here: https:\/\/jonerfootball\.com\/jfp-account\/\?pay=PAY-1/)
  assert.match(words, /We have emailed you the same link\./)
  assert.doesNotMatch(words, /\u2014/)
  assert.equal(p.posts.filter((b) => b.action === 'quickText').length, 0, 'nothing is texted until Send')
  p.$('#tx-text').value = 'Hi Ben, changed words'
  await p.click('#tx-send')
  const sent = p.posts.find((b) => b.action === 'quickText')
  assert.deepEqual([sent.text, sent.rowIds.sort()], ['Hi Ben, changed words', ['p2', 'p7']])
  p.close()
})

console.log(`${passed} money page checks passed`)
