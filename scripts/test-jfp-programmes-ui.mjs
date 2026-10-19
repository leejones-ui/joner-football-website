// Money's Programme menu, the short headers, instant switching, and the Pro
// sessions, Camps and Everything views, in jsdom (Lee, 13 Oct 2026). Every
// name and amount here is invented.
import assert from 'node:assert/strict'
import { openPortal, csvRows } from './jfp-portal-dom.mjs'
import { money } from '../src/scripts/jfp-common.js'
import { proMoneyView } from '../api/_jfp-pro-money.js'
import { campsView, campFromRecord } from '../api/_jfp-camps.js'

let passed = 0
async function test(name, fn) { await fn(); passed += 1; console.log(`ok - ${name}`) }

const pl = (rowId, name, x = {}) => ({ rowId, player: name, parent: `${name.split(' ')[0]} Parent`, email: `${rowId}@example.com`, familyKey: `${rowId}@example.com`, phone: '', openLink: null, product: 'group', group: 'Monday 4:20pm, Belrose HQ', groupId: 'g1', locationId: 'belrose', locationName: 'Belrose HQ', coach: 'Coach Test', feeCents: 85000, paidCents: 0, owingCents: 85000, perSessionCents: null, airtableStatus: 'Not set', type: 'JFP 10 weeks', status: 'unpaid', stripeCents: 0, stripeCount: 0, hasNotes: false, receivedCents: 0, stripeFeeCents: 0, netReceivedCents: 0, ...x })
const MONEY = {
  since: '2026-09-14', stripeError: '', stripeAt: '2026-10-12T01:00:00.000Z', term: 'Term 4 2026', prices: { group: 85000, twoAWeek: 170000, familyPlace: 85000 }, venueTerms: ['Term 4 2026', 'Term 3 2026'],
  kpis: { incomeCents: 0, stripeCents: 0, stripeGrossCents: 0, refundsCents: 0, offlineCents: 0, cashCents: 0, bankCents: 0, otherCents: 0, owingCents: 85000, players: 1, stripePayments: 0, venuesCents: 0, unlinkedCents: 0, stripeFeesCents: 0, feeGstCents: 0, feesPendingCount: 0, netIncomeCents: 0, unlinkedFeeCents: 0, feesByMethod: [], expectedCents: 85000, collectedCents: 0, collectedPct: 0, nextTermCents: 0, nextTermCount: 0, nextTermFeeCents: 0 },
  unlinked: { cents: 0, items: [] }, status: { paid: 0, stripe: 0, part: 0, unpaid: 1, unpriced: 0, session: 0 },
  weekly: [{ week: '2026-10-12', stripe: 0, bank: 0, cash: 0, fee: 0 }], weeklyByVenue: { belrose: [{ week: '2026-10-12', stripe: 0, bank: 0, cash: 0, fee: 0 }] }, payments: [], nextTermPayments: [],
  locations: [{ id: 'belrose', name: 'Belrose HQ', players: 1, paid: 0, owingCents: 85000, receivedCents: 0, stripeCents: 0, bankCents: 0, cashCents: 0, otherCents: 0, removedCents: 0, removedFeeCents: 0, stripeFeeCents: 0, expectedCents: 85000, collectedCents: 0, netCents: 0, collectedPct: 0, juniors: null, groups: [], owingRowIds: ['p1'] }],
  players: [pl('p1', 'Ivy Test')], unmatched: [],
}
const fresh = () => structuredClone(MONEY)

// ---------- invented Pro sessions ----------
const ROWS = [{ id: 'recPRO1', player: 'Ava Pro', parent: 'Pat Pro', email: 'pro1@example.com', emails: ['pro1@example.com'], feeAud: 160, paidAud: 80, perSessionCents: 4000, holdsPlace: true, day: 'Tuesday', time: '17:30', location: 'Test HQ', paymentType: 'JFP Pro sessions' }]
const PRO_IN = {
  rows: ROWS, payreqs: [{ id: 'PAY-A', term4Ids: ['recPRO1'] }],
  stripe: { error: '', at: '2026-10-13T00:00:00.000Z', pro: [{ id: 'cs_a', intentId: 'pi_a', at: '2026-10-02T01:00:00.000Z', email: 'pro1@example.com', name: 'Pat Pro', amountCents: 8000, refundedCents: 0, feeCents: 200, feeGstCents: 18, feeKnown: true, jfpRef: 'PAY-A', product: 'Pro', pro: true }] },
  ledger: [], bankLines: [{ id: 'XERO-00000041-ffff-4bbb-8ccc-000000000041', date: '2026-09-25', cents: 4000, payer: 'P PRO', rowId: 'recPRO1', player: 'Ava Pro', sessionDate: '', note: '' }],
}
const pro = (month = '') => ({ ...proMoneyView({ ...PRO_IN, month }), at: '2026-10-13T02:53:00.000Z' })

// ---------- invented camps ----------
const rec = (id, f) => ({ id, fields: { Currency: 'AUD', 'Imported At': '2026-10-13', ...f } })
const CAMPS = [
  rec('r1', { Key: '2026 | A', Camp: 'Testville Autumn', Year: 2026, Location: 'Testville', 'Start Date': '2026-04-14', 'End Date': '2026-04-16', Players: 40, Gross: 12000, Refunds: 0, Costs: 3000, Net: 9000 }),
  rec('r2', { Key: '2026 | B', Camp: 'Sampleton Winter', Year: 2026, Location: 'Sampleton', 'Start Date': '2026-07-07', Players: 30, Gross: 9000, Refunds: 500, Costs: 2500, Net: 6000 }),
  rec('r3', { Key: '2026 | C', Camp: 'Testville Spring', Year: 2026, Location: 'Testville' }),
  rec('r5', { Key: '2025 | A', Camp: 'Testville Autumn', Year: 2025, Location: 'Testville', Players: 35, Gross: 10000, Costs: 2800, Net: 7200 }),
].map(campFromRecord)
const camps = (year) => ({ ...campsView({ camps: CAMPS, year, today: '2026-10-13' }), source: 'airtable', at: '2026-10-13T02:00:00.000Z', importedAt: '2026-10-13' })
const STRIPE_CAMPS = { year: 2026, at: '2026-10-13T02:00:00.000Z', payments: 2, truncated: false, camps: [{ camp: 'Testville Spring Camp', currency: 'AUD', count: 2, takenCents: 40000, refundedCents: 0, feeCents: 600, feesPending: 0, keptCents: 39400 }] }

const answers = (b) => {
  if (b.action === 'proMoney') return { success: true, pro: pro(b.month || '') }
  if (b.action === 'campsMoney') return { success: true, camps: camps(b.year || 0) }
  if (b.action === 'campsStripe') return { success: true, stripe: STRIPE_CAMPS }
  if (b.action === 'sessionInvoice') return { success: true, payreq: { id: 'PAY-S', url: 'https://example.com/pay', amountCents: 4000, amountLabel: 'A$40' }, emailed: true }
  return null
}

await test('JFP Money: one Programme menu, title and controls in one row, "Updated" with Refresh, the explanation under (i)', async () => {
  const p = await openPortal({ money: fresh(), onPost: answers })
  assert.deepEqual([...p.d.querySelectorAll('#m-prog option')].map((o) => [o.value, o.textContent, o.selected]), [['jfp', 'JFP', true], ['juniors', 'Joners Juniors', false], ['holiday', 'Holiday training', false], ['pro', 'Pro sessions', false], ['extra', 'Extra sessions', false], ['camps', 'Camps', false], ['invoices', 'Invoices', false], ['all', 'Everything', false]])
  assert.equal(p.d.querySelectorAll('[data-programme]').length, 0, 'no segmented buttons')
  assert.ok(p.$('.jd-head .jd-sync #m-prog') && p.$('.jd-head .jd-sync #m-show') && p.$('.jd-head .jd-sync #m-add'), 'the controls in one row')
  assert.match(p.text('.jd-head p'), /^Updated \d{1,2}:\d{2} [ap]m · Refresh \?$/)
  assert.ok(p.$('#m-refresh') && p.$('#m-since'), 'Refresh and the payments date are still there')
  const tip = p.$('#m-tipbox')
  assert.equal(tip.hidden, true)
  assert.ok(tip.contains(p.$('#m-since')), 'the date sits in the (i), with the explanation')
  assert.match(tip.textContent, /Every player's payments: Stripe read live/)
  assert.ok(!p.d.body.textContent.includes('Read from Airtable and Stripe at'), 'the long line has gone')
  await p.click('[data-tip]')
  assert.equal(tip.hidden, false)
  assert.equal(p.$('[data-tip]').getAttribute('aria-expanded'), 'true')
  assert.deepEqual(p.errors, [])
  p.close()
})

await test('switching is instant: the last reading paints at once and the latest is read behind it', async () => {
  const p = await openPortal({ money: fresh(), onPost: answers })
  await p.pick('#m-prog', 'pro')
  assert.equal(p.w.location.hash, '#money?programme=pro')
  assert.deepEqual(p.posts.filter((b) => b.action === 'proMoney')[0], { action: 'proMoney', quick: true }, 'a first look asks for the quick reading')
  assert.equal(p.text('#p-kept'), money(8000 - 200 + 4000))
  // Back to JFP: drawn from the last reading straight away, no quick read first.
  const before = p.posts.length
  await p.pick('#m-prog', 'jfp')
  assert.ok(p.$('#m-scope'), 'JFP is on screen')
  assert.equal(p.w.location.hash, '#money')
  const after = p.posts.slice(before)
  assert.ok(!after.some((b) => b.action === 'money' && b.quick), 'no wait for a fresh read')
  assert.ok(after.some((b) => b.action === 'money' && !b.quick), 'the latest is read behind it')
  // And Pro again inside 30 seconds: nothing asked at all.
  const n = p.posts.filter((b) => b.action === 'proMoney').length
  await p.pick('#m-prog', 'pro')
  assert.equal(p.text('#p-kept'), money(11800))
  assert.equal(p.posts.filter((b) => b.action === 'proMoney').length, n)
  // Joners Juniors has its own Money page.
  await p.pick('#m-prog', 'juniors')
  assert.match(p.w.location.hash, /^#jj-money/)
  assert.deepEqual(p.errors, [])
  p.close()
})

await test('Pro sessions: each player has a Sessions button that bills their sessions, as on JFP (Lee, 19 Oct 2026)', async () => {
  const p = await openPortal({ money: fresh(), onPost: answers })
  await p.pick('#m-prog', 'pro')
  const b = p.$('[data-pbill="recPRO1"]')
  assert.ok(b, 'the Sessions button is on the player')
  assert.match(b.textContent, /Sessions · A\$40/)
  await p.click('[data-pbill="recPRO1"]')
  assert.match(p.d.body.textContent, /Sessions: Ava Pro/)
  assert.equal(p.$('[data-srow="recPRO1"] [data-per]').value, '40')
  await p.click('#ss-go')
  const sent = p.posts.find((x) => x.action === 'sessionInvoice')
  assert.deepEqual(sent.rows, [{ rowId: 'recPRO1', sessions: 1, perSessionCents: 4000 }])
  assert.equal(sent.mode, 'link')
  assert.deepEqual(p.errors, [])
  p.close()
})

await test('Pro sessions: kept, by month, by player with billed and owing, every payment, put back, and the CSV', async () => {
  let undone = false
  const p = await openPortal({ money: fresh(), hash: '#money?programme=pro', onPost: (b) => (b.action === 'bankProUndo' ? (undone = true, { success: true, id: b.id }) : answers(b)) })
  assert.equal(p.$('#m-prog').value, 'pro')
  assert.match(p.text('.jd-head p'), /^Updated 1:53 pm · Refresh \?$/)
  assert.match(p.$('#m-tipbox').textContent, /None of it is in the JFP figures/)
  assert.equal(p.text('#p-kept'), money(11800))
  assert.equal(p.text('#p-sum'), `Taken ${money(12000)} · Refunded A$0 · Stripe fees ${money(200)}`)
  assert.equal(p.text('[data-ptile="stripe"] .val'), money(7800))
  assert.equal(p.text('[data-ptile="bank"] .val'), money(4000))
  assert.equal(p.text('[data-ptile="owing"] .val'), money(8000))
  assert.deepEqual([...p.d.querySelectorAll('#p-months tbody tr')].map((tr) => tr.children[0].textContent), ['October 2026', 'September 2026', 'Total'])
  assert.match(p.text('#p-players'), /Ava Pro A\$40 a session.*A\$160.*A\$80.*A\$80.*A\$118/)
  assert.equal(p.d.querySelectorAll('#p-lines [data-pline]').length, 2)
  await p.pick('#p-month', '2026-09')
  assert.equal(p.posts.filter((b) => b.action === 'proMoney').at(-1).month, '2026-09')
  assert.equal(p.w.location.hash, '#money?programme=pro&month=2026-09')
  assert.equal(p.text('#p-kept'), money(4000))
  await p.click('#p-csv')
  const f = await p.csv()
  assert.equal(f.name, 'jfp-pro-sessions-september-2026.csv')
  assert.deepEqual(csvRows(f.text).find((r) => r[0] === 'Kept'), ['Kept', '40.00'])
  assert.ok(!f.text.includes('@example.com'))
  await p.click('#p-lines [data-pundo]')
  assert.match(p.text('#jp-modal'), /Put A\$40 from P PRO back on Bank transfers to check\?/)
  await p.click('#jp-modal [data-yes]')
  assert.ok(undone)
  assert.deepEqual(p.posts.filter((b) => b.action === 'bankProUndo'), [{ action: 'bankProUndo', id: 'XERO-00000041-ffff-4bbb-8ccc-000000000041' }])
  assert.deepEqual(p.errors, [])
  p.close()
})

await test('Camps: the year, net and gross, by location, against last year, Stripe sign-ups as a check, and the CSV', async () => {
  const p = await openPortal({ money: fresh(), hash: '#money?programme=camps', onPost: answers })
  assert.equal(p.$('#m-prog').value, 'camps')
  assert.equal(p.w.location.hash, '#money?programme=camps&year=2026')
  assert.equal(p.text('#c-net'), money(1500000))
  assert.equal(p.text('#c-sum'), `Gross ${money(2100000)} · Refunds ${money(50000)} · Costs ${money(550000)}`)
  assert.deepEqual([...p.d.querySelectorAll('#c-camps tbody tr th')].map((th) => th.childNodes[0].textContent), ['Testville Autumn', 'Sampleton Winter', 'Testville Spring', 'Total (A$)'])
  assert.match(p.text('#c-camps'), /not in sheet/)
  assert.match(p.text('#c-loc'), /Testville.*A\$9,000.*Sampleton.*A\$6,000/)
  assert.match(p.text('#c-compare'), /Net ?A\$7,200 in 2025 ?\+A\$7,800 \(\+108\.3%\)/)
  assert.match(p.text('#c-stripe'), /Testville Spring Camp ?2 sign-ups · taken A\$400 · fees A\$6 · the sheet has no figure ?A\$394/)
  await p.pick('#c-year', '2025')
  assert.equal(p.posts.filter((b) => b.action === 'campsMoney').at(-1).year, 2025)
  assert.equal(p.text('#c-net'), money(720000))
  assert.match(p.text('#c-compare'), /No camps imported for 2024/)
  await p.click('#c-csv')
  const f = await p.csv()
  assert.equal(f.name, 'jfp-camps-2025.csv')
  assert.deepEqual(csvRows(f.text).find((r) => r[0] === 'Net'), ['Net', '7200.00'])
  assert.deepEqual(p.errors, [])
  p.close()
})

await test('Everything: each programme side by side for the year, and the total once they are in', async () => {
  const p = await openPortal({ money: fresh(), hash: '#money?programme=all&year=2026', onPost: (b) => {
    if (b.action === 'moneyYear') return { success: true, year: { year: 2026, scopes: { '': { takenCents: 900000, keptCents: 880000, stripeFeeCents: 20000 } }, soFar: true, current: 'Term 4 2026', sources: [] } }
    if (b.action === 'juniorsMoney') return { success: true, juniors: { years: [{ year: 2026, takenCents: 70000, keptCents: 68000, terms: [{}] }], byTerm: {}, terms: [], players: [], unlinked: [] } }
    if (b.action === 'holidayMoney') return { success: true, holiday: { period: 'all', byMonth: { session: [{ month: '2026-10', takenCents: 50000, refundedCents: 0, keptCents: 48000, count: 4 }, { month: '2025-12', takenCents: 9000, refundedCents: 0, keptCents: 8800, count: 1 }], paid: [] } } }
    return answers(b)
  } })
  assert.equal(p.$('#m-prog').value, 'all')
  assert.deepEqual([...p.d.querySelectorAll('#e-grid [data-eprog] h2')].map((h) => h.textContent), ['JFP', 'Joners Juniors', 'Holiday training', 'Pro sessions', 'Camps'])
  assert.equal(p.text('[data-eprog="jfp"] .je-kept b'), money(880000))
  assert.equal(p.text('[data-eprog="holiday"] .je-kept b'), money(48000), 'only 2026')
  assert.equal(p.text('[data-eprog="camps"] .je-taken b'), money(2050000))
  assert.equal(p.text('#e-kept'), money(880000 + 68000 + 48000 + 11800 + 2050000))
  assert.deepEqual(p.posts.find((b) => b.action === 'holidayMoney'), { action: 'holidayMoney', period: 'all', quick: true })
  await p.click('[data-eopen="pro"]')
  assert.equal(p.$('#m-prog').value, 'pro')
  assert.deepEqual(p.errors, [])
  p.close()
})

// ---------- Bank transfers to check: Pro session ----------
const XP = 'XERO-00000051-aaaa-4bbb-8ccc-000000000051'
const BANK = () => ({
  sources: { xeroAt: new Date().toISOString(), xeroItems: 1, csvAt: '', csvItems: 0 },
  items: [{ id: XP, date: '2026-10-10', cents: 4000, payer: 'P PRO', description: 'P PRO', reference: '', source: 'xero', grade: 'none', candidates: [], previous: null, hints: { holiday: false, lastTerm: false }, holidayPeriod: { id: 'other', how: 'none' } }],
  before: [], counts: { checked: 1, high: 0, possible: 0, none: 1, before: 0, early: 0 }, hidden: [],
  holiday: { periods: [{ id: 'other', label: 'Other dates', range: '' }], coaches: [], locations: ['Belrose HQ'], defaultLocation: 'Belrose HQ' },
  previousTerm: null, termStart: '2026-10-12', pro: { players: [{ rowId: 'recPRO1', player: 'Ava Pro' }] },
})
await test('bank transfers: "Pro session" saves the line for a Pro player, with an undo', async () => {
  let bank = BANK()
  const p = await openPortal({ money: fresh(), onPost: (b) => {
    if (b.action === 'bankCheck') return { success: true, bank }
    if (b.action === 'bankPro') { bank = { ...bank, items: [] }; return { success: true, line: { id: b.id, player: 'Ava Pro' } } }
    if (b.action === 'bankProUndo') { bank = BANK(); return { success: true, id: b.id } }
    return answers(b)
  } })
  await p.click(`#m-bank [data-bank="${XP}"] [data-bank-pro]`)
  assert.match(p.text('#jp-modal'), /^Pro session ?Bank, .*: A\$40 · P PRO/)
  assert.deepEqual([...p.$('#pb-row').options].map((o) => o.textContent), ['Not sure', 'Ava Pro'])
  p.$('#pb-row').value = 'recPRO1'
  p.$('#pb-date').value = '2026-10-07'
  await p.click('#pb-go')
  assert.deepEqual(p.posts.filter((b) => b.action === 'bankPro'), [{ action: 'bankPro', id: XP, rowId: 'recPRO1', sessionDate: '2026-10-07', note: '' }])
  assert.equal(p.$(`#m-bank [data-bank="${XP}"]`), null, 'it leaves the list')
  assert.match(p.text('#m-bank-undo'), /Saved A\$40 from P PRO as Pro sessions \(Ava Pro\)\. ?Undo/)
  await p.click('#m-bank-undo [data-bank-undo]')
  assert.deepEqual(p.posts.filter((b) => b.action === 'bankProUndo'), [{ action: 'bankProUndo', id: XP }])
  assert.ok(p.$(`#m-bank [data-bank="${XP}"]`), 'back on the list')
  assert.deepEqual(p.errors, [])
  p.close()
})

console.log(`\n${passed} programme menu, Pro sessions and camps screen checks passed`)
