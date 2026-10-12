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
const line = (id, at, method, payMethod, who, venueId, taken, refunded, fee, gst) => ({ id, at, method, payMethod, who, venueId, takenCents: taken, refundedCents: refunded, feeCents: fee, feeGstCents: gst, keptCents: taken - refunded - (fee || 0) })
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
}
const fresh = () => structuredClone(MONEY)
const tiles = (p) => [...p.d.querySelectorAll('#m-scope [data-tile]')].map((t) => t.dataset.tile)
const tile = (p, key) => p.text(`#m-scope [data-tile="${key}"] .val`)
const chip = (p, v) => p.text(`#m-chips [data-set-status="${v}"] .n`)
const rows = (p) => p.d.querySelectorAll('#m-rows tr[data-row]').length

await test('all venues: kept after Stripe fees leads, with taken, fees, refunds, fees still loading and expected', async () => {
  const p = await openPortal({ money: fresh() })
  assert.equal(p.text('#m-kept'), money(285040))
  assert.equal(p.text('#m-sum'), `Taken ${money(298000)} · Stripe fees ${money(7960)} · Refunded ${money(5000)}`)
  assert.equal(p.text('#m-pending'), '1 fee still loading')
  assert.match(p.text('#m-expect'), new RegExp(`Expected this term ${money(412500).replace('$', '\\$')} · 66% paid`))
  assert.equal(p.$('#m-expect .jm-meter span').style.width, '66%')
  assert.deepEqual(tiles(p), ['stripe', 'bank', 'cash', 'other', 'owing'], 'Other shows when there is some')
  assert.equal(p.$('#m-scope .jm-tiles').dataset.n, '5')
  assert.deepEqual([tile(p, 'stripe'), tile(p, 'bank'), tile(p, 'cash'), tile(p, 'other'), tile(p, 'owing')], [185000, 20000, 85000, 3000, 137500].map(money))
  assert.deepEqual([...p.d.querySelectorAll('#m-locs [data-mloc]')].map((b) => b.dataset.mloc), ['', 'belrose', 'ntra', 'rydalmere', 'other'])
  assert.equal(p.$('#m-locs [data-mloc=""]').getAttribute('aria-pressed'), 'true')
  assert.match(p.text('#m-locs [data-mloc="ntra"]'), /North Turramurra A\$990 kept/)
  assert.equal(p.text('#m-unlinked'), `${money(10000)} isn't linked to a player yet, so it sits under All.`)
  assert.match(p.text('#m-next summary'), /Paid for next term: A\$500 \(not counted in this term\)/)
  assert.ok(p.$('#m-unmatched details'), 'the unmatched list shows under All')
  assert.match(p.text('#m-scope .jm-alert'), /1 player has paid in Stripe/)
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
  assert.match(p.text('#m-scope .lbl'), /Kept after Stripe fees · North Turramurra/)
  assert.equal(p.text('#m-sum'), `Taken ${money(110000)} · Stripe fees ${money(6000)} · Refunded ${money(5000)}`)
  assert.equal(p.$('#m-pending'), null)
  assert.match(p.text('#m-expect'), /A\$1,575 · 66% paid/)
  assert.deepEqual(tiles(p), ['stripe', 'bank', 'cash', 'owing'], 'no Other here')
  assert.deepEqual([tile(p, 'stripe'), tile(p, 'bank'), tile(p, 'cash'), tile(p, 'owing')], [85000, 20000, 0, 52500].map(money))
  assert.equal(p.text('#m-scope [data-tile="owing"] .note'), '2 players')
  for (const id of ['#m-unlinked', '#m-next', '#m-unmatched details']) assert.equal(p.$(id), null, `${id} is for All only`)
  assert.match(p.text('#m-scope .jm-alert'), /1 player at North Turramurra has paid in Stripe/)
  assert.deepEqual([chip(p, ''), chip(p, 'paid'), chip(p, 'unpaid'), chip(p, 'part'), chip(p, 'stripe')], ['3', '0', '1', '1', '1'])
  assert.equal(rows(p), 3)
  assert.equal(p.text('#m-count'), `3 of 3 players at North Turramurra · owing ${money(52500)}`)
  const week = [...p.d.querySelectorAll('#m-scope .jc-table tbody tr')].map((tr) => tr.textContent)
  assert.equal(week[1], `2026-10-05${money(85000)}${money(20000)}A$0${money(6000)}`, 'the weekly chart is the venue\'s')
  assert.match(p.text('#m-fees'), /North Turramurra, this term/)
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
  assert.equal(p.$('#m-scope .jm-tiles').dataset.n, '5')
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
  assert.deepEqual(r[pay + 2].slice(0, 8), ['2026-10-10', 'Stripe (Card / Link)', 'Late Payer', '50.00', '', '', '0.00', '50.00'], 'a fee not known yet is blank, never 0')
  assert.deepEqual(r[pay + 3], ['Total', '', '', '900.00', '17.20', '1.56', '0.00', '882.80', '', ''])
  assert.match(text, /A blank Stripe fee was not known yet/)
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
  assert.deepEqual(r[total].slice(3, 8), ['2980.00', '79.60', '7.23', '50.00', '2850.40'], 'the payments add up to the term')
  const stranger = r.find((x) => x[9] === 'cs_3')
  assert.deepEqual([stranger[2], stranger[8]], ["'@Stranger", 'Not linked to a player'])
  assert.ok(r.find((x) => x[9] === 'OFF-1')[0] === '', 'marked paid offline, no date')
  p.close()
})

await test('the venue window: kept as the main number, expected, who still owes biggest first, tap for their payments', async () => {
  const p = await openPortal({ money: fresh(), hash: '#overview', player: { player: 'Gus Test', parent: 'Gus Parent', email: 'p7@example.com', feeCents: 30000, paidCents: 0, stripe: [{ id: 'cs_n1', at: '2026-10-09T00:00:00.000Z', cents: 50000, refundedCents: 0, product: 'JFP Term 1 2027 hold', recorded: false, feeCents: 1020, payMethod: 'card', nextTerm: true }], ledger: [], links: [], history: [] } })
  const btn = p.$('.jv-list [data-venue="ntra"]')
  assert.equal(btn.querySelector('.amt').textContent, money(99000), 'the dashboard venue shows what was kept')
  assert.match(btn.textContent, /kept after fees · taken A\$1,050/)
  await p.click(btn)
  assert.equal(p.text('#jv-kept'), money(99000))
  assert.match(p.text('.jv-kept'), /Kept after Stripe fees.*Taken A\$1,100 · Stripe fees A\$60 · Refunded A\$50/)
  assert.doesNotMatch(p.text('#jp-modal'), /Before Stripe fees/i)
  assert.match(p.text('#jp-modal .jv-kpis'), /Expected this term\s*A\$1,575\s*66% paid \(A\$1,050\)/)
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

console.log(`${passed} money page checks passed`)
