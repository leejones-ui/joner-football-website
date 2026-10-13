// Money > Holiday training and the new Bank transfers to check buttons, in
// jsdom (Lee, 13 Oct 2026). Every name and amount here is invented.
import assert from 'node:assert/strict'
import { openPortal, csvRows } from './jfp-portal-dom.mjs'
import { money } from '../src/scripts/jfp-common.js'
import { holidayMoneyView } from '../api/_holiday-money.js'

let passed = 0
async function test(name, fn) { await fn(); passed += 1; console.log(`ok - ${name}`) }

// ---------- a small JFP term, for the Money page around the bank panel ----------
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

// ---------- invented holiday training ----------
const config = { coaches: [{ id: 'cara', name: 'Cara', tier: 'coach' }, { id: 'bo', name: 'Bo', tier: 'coach' }], defaultLocation: 'Test HQ, Belrose' }
const slot = (id, date, coachId) => ({ id, date, startTime: '10:00', coachId, type: 'open', location: 'Test HQ, Belrose', status: 'open' })
const bk = (id, slotId, x = {}) => ({ id, slotId, coachId: 'cara', type: 'one', seats: 1, unitCents: 12000, amountPaidCents: 12000, status: 'paid', paidAt: '2026-09-25T01:00:00.000Z', createdAt: '2026-09-25T00:00:00.000Z', parentName: `Parent ${id}`, players: [{ name: `Kid ${id}` }], ...x })
const pay = (bookingId, cents, x = {}) => ({ id: `cs_${bookingId}`, intentId: `pi_${bookingId}`, bookingId, at: '2026-09-25T01:00:00.000Z', amountCents: cents, refundedCents: 0, feeCents: 300, feeGstCents: 27, feeKnown: true, payMethod: 'card', ...x })
const HOL = {
  bookings: [bk('HOL-A', 'S1'), bk('HOL-B', 'S2', { coachId: 'bo' }), bk('HOL-C', 'S3', { status: 'cancelled', refundDue: true, refund: { cents: 12000 } })],
  slots: [slot('S1', '2026-09-29', 'cara'), slot('S2', '2026-10-01', 'bo'), slot('S3', '2026-10-06', 'cara')],
  config, stripe: { error: '', at: '2026-10-13T00:00:00.000Z', payments: [pay('HOL-A', 12000), pay('HOL-B', 12000), pay('HOL-C', 12000)] },
  bankLines: [{ id: 'XERO-00000021-dddd', date: '2026-07-08', cents: 8500, payer: 'W PAYER', period: '2026-winter', sessionDate: '', coach: 'Cara', location: 'Belrose HQ', note: '' }, { id: 'XERO-00000022-dddd', date: '2026-09-22', cents: 17000, payer: 'S PAYER', period: '2026-spring', sessionDate: '2026-10-02', coach: '', location: 'Belrose HQ', note: 'two kids' }],
  locationOf: (n) => ({ id: 'belrose', name: /belrose/i.test(n) ? 'Belrose HQ' : n }), today: '2026-10-13',
}
const view = (period = '') => holidayMoneyView({ ...HOL, period })

await test('holiday training: picked from the Money switch, the newest holiday with money, kept and what makes it up', async () => {
  const p = await openPortal({ money: fresh(), hash: '#money?programme=holiday', onPost: (b) => (b.action === 'holidayMoney' ? { success: true, holiday: view(b.period) } : null) })
  // One Programme menu (13 Oct 2026), holiday training picked.
  assert.deepEqual([...p.d.querySelectorAll('#m-prog option')].map((o) => [o.textContent, o.selected]), [['JFP', false], ['Joners Juniors', false], ['Holiday training', true], ['Pro sessions', false], ['Camps', false], ['Everything', false]])
  // First paint from the last Stripe read (quick), never a wait on Stripe.
  assert.deepEqual(p.posts.find((b) => b.action === 'holidayMoney'), { action: 'holidayMoney', period: '', quick: true })
  const v = view()
  assert.equal(v.period, '2026-spring')
  assert.equal(p.w.location.hash, '#money?programme=holiday&period=2026-spring')
  assert.equal(p.$('#h-period').value, '2026-spring')
  const kept = 3 * 12000 - 3 * 300 + 17000
  assert.equal(p.text('#h-kept'), money(kept))
  assert.equal(p.text('#h-sum'), `Taken ${money(36000 + 17000)} · Refunded A$0 · Stripe fees ${money(900)}`)
  assert.equal(p.text('[data-htile="stripe"] .val'), money(36000 - 900))
  assert.equal(p.text('[data-htile="bank"] .val'), money(17000))
  assert.equal(p.text('[data-htile="owed"] .val'), money(12000))
  // Refunds still owed: the cancelled booking Stripe shows no refund for.
  assert.match(p.text('#h-owed'), /^Refunds still owed: 1 booking · A\$120/)
  assert.ok(p.$('#h-owed a[href="https://dashboard.stripe.com/payments/pi_HOL-C"]'))
  // By coach, location and type add up to the same kept.
  for (const id of ['#h-coach', '#h-loc', '#h-type']) {
    const sum = [...p.d.querySelectorAll(`${id} li b`)].reduce((t, b) => t + Math.round(Number(b.textContent.replace(/[A$,]/g, '')) * 100), 0)
    assert.equal(sum, kept, id)
  }
  assert.match(p.text('#h-type'), /1 on 1 · A\$120 a player/)
  // Every booking and transfer, a bank one can be put back.
  assert.equal(p.d.querySelectorAll('#h-lines [data-hline]').length, 4)
  assert.ok(p.$('#h-lines [data-hundo="XERO-00000022-dddd"]'))
  assert.equal(p.$('#h-lines [data-hundo="HOL-A"]'), null)
  assert.deepEqual(p.errors, [])
  p.close()
})

await test('holiday training: Add to your sheet, by session date then by payment date', async () => {
  const p = await openPortal({ money: fresh(), hash: '#money?programme=holiday&period=2026-spring', onPost: (b) => (b.action === 'holidayMoney' ? { success: true, holiday: view(b.period) } : null) })
  assert.equal(p.posts.find((b) => b.action === 'holidayMoney').period, '2026-spring')
  const months = () => [...p.d.querySelectorAll('#h-months tbody tr')].map((tr) => [...tr.children].map((c) => c.textContent.trim()))
  assert.equal(p.$('#h-sheet [data-basis="session"]').getAttribute('aria-pressed'), 'true', 'session date first')
  // Sessions: 29 Sep (Sep), 1 Oct, 6 Oct and the bank line on 2 Oct (Oct).
  assert.deepEqual(months().map((r) => r[0]), ['October 2026', 'September 2026', 'Total'])
  assert.deepEqual(months()[1], ['September 2026', money(11700), 'A$0', money(11700)])
  assert.deepEqual(months()[0], ['October 2026', money(23400), money(17000), money(40400)])
  await p.click('#h-sheet [data-basis="paid"]')
  assert.equal(p.$('#h-sheet [data-basis="paid"]').getAttribute('aria-pressed'), 'true')
  assert.deepEqual(months(), [['September 2026', money(35100), money(17000), money(52100)]], 'everything was paid in September')
  assert.match(p.text('#h-basis-note'), /month it was paid/)
  // The CSV for the accountant: summary, both month tables, every payment.
  await p.click('#h-csv')
  const { name, text } = await p.csv()
  assert.equal(name, 'jfp-holiday-training-spring-holidays-2026.csv')
  const rows = csvRows(text)
  assert.deepEqual(rows.find((r) => r[0] === 'Kept'), ['Kept', '521.00'])
  assert.ok(rows.some((r) => r[0] === 'Kept per month, by session date'))
  assert.ok(rows.some((r) => r[0] === 'Kept per month, by payment date'))
  const head = rows.findIndex((r) => r[0] === 'Holiday' && r[1] === 'Session date')
  assert.ok(head > 0)
  const lines = rows.slice(head + 1).filter((r) => r[0] === 'Spring holidays 2026')
  assert.equal(lines.length, 4)
  assert.ok(lines.some((r) => r[4] === 'Bank transfer' && r[15] === '170.00'))
  assert.ok(lines.some((r) => r[5] === 'HOL-C' && r[17] === '120.00'), 'the refund still owed is in the download')
  assert.deepEqual(rows.find((r) => r[0] === 'Total' && r.length > 10).slice(11, 16), ['530.00', '0.00', '9.00', '0.81', '521.00'])
  assert.deepEqual(p.errors, [])
  p.close()
})

await test('holiday training: another holiday from the picker, and a bank transfer put back on the list', async () => {
  let bankLines = HOL.bankLines.slice()
  const p = await openPortal({ money: fresh(), hash: '#money?programme=holiday', onPost: (b) => {
    if (b.action === 'holidayMoney') return { success: true, holiday: holidayMoneyView({ ...HOL, bankLines, period: b.period }) }
    if (b.action === 'bankHolidayUndo') { bankLines = bankLines.filter((x) => x.id !== b.id); return { success: true, id: b.id } }
    return null
  } })
  const picker = p.$('#h-period')
  assert.deepEqual([...picker.options].slice(0, 4).map((o) => o.value), ['2026-summer', '2026-spring', '2026-winter', '2026-autumn'], 'newest first')
  assert.match(picker.options[0].textContent, /nothing yet/)
  assert.equal([...picker.options].at(-1).value, 'all')
  picker.value = '2026-winter'
  picker.dispatchEvent(new p.w.Event('change', { bubbles: true }))
  await p.settle()
  assert.equal(p.posts.filter((b) => b.action === 'holidayMoney').at(-1).period, '2026-winter')
  assert.equal(p.text('#h-kept'), money(8500))
  assert.equal(p.w.location.hash, '#money?programme=holiday&period=2026-winter')
  // July: paid by bank transfer before the booking system, no session date: the month it came in.
  assert.deepEqual([...p.d.querySelectorAll('#h-months tbody tr')].map((tr) => tr.children[0].textContent), ['July 2026'])
  await p.click('#h-lines [data-hundo="XERO-00000021-dddd"]')
  assert.match(p.text('#jp-modal'), /Put A\$85 from W PAYER back on Bank transfers to check\?/)
  await p.click('#jp-modal [data-yes]')
  assert.deepEqual(p.posts.filter((b) => b.action === 'bankHolidayUndo'), [{ action: 'bankHolidayUndo', id: 'XERO-00000021-dddd' }])
  assert.equal(p.text('#h-kept'), 'A$0')
  assert.match(p.text('#h-lines'), /Nothing in this holiday yet/)
  // Back to JFP: the usual Money page.
  await p.pick('#m-prog', 'jfp')
  assert.equal(p.w.location.hash, '#money')
  assert.ok(p.$('#m-bank'))
  assert.deepEqual(p.errors, [])
  p.close()
})

// ---------- Bank transfers to check: chips, hints, the fold, the two buttons ----------
const XN = 'XERO-00000031-eeee-4bbb-8ccc-000000000031', XH = 'XERO-00000032-eeee-4bbb-8ccc-000000000032', XL = 'XERO-00000033-eeee-4bbb-8ccc-000000000033'
const PERIODS = [{ id: '2026-summer', label: 'Summer holidays 2026–27', range: '18 Dec 2026 to 27 Jan 2027' }, { id: '2026-spring', label: 'Spring holidays 2026', range: '28 Sep to 9 Oct 2026' }, { id: '2026-winter', label: 'Winter holidays 2026', range: '6 Jul to 17 Jul 2026' }, { id: 'other', label: 'Other dates', range: '' }]
const PREV = { rowId: 'recPREV0000000001', player: 'Zed Oldterm', parent: 'Pat Oldterm', location: 'Belrose HQ', feeCents: 85000, paidCents: 40000, owingCents: 45000, status: 'Partially Paid', score: 3, exact: true, reason: "name matches the parent, amount = what's owing" }
const BANK = () => ({
  sources: { xeroAt: new Date().toISOString(), xeroItems: 3, csvAt: '', csvItems: 0 },
  items: [{ id: XN, date: '2026-10-10', cents: 85000, payer: 'I PARENT', description: 'I PARENT', reference: '', source: 'xero', grade: 'high', candidates: [{ rowId: 'p1', player: 'Ivy Test', parent: 'Ivy Parent', locationId: 'belrose', group: 'Monday', status: 'unpaid', owingCents: 85000, feeCents: 85000, score: 3, exact: true, reason: "name matches the parent, amount = what's owing", familyRowIds: ['p1'], familyOwingCents: 85000 }], previous: null, hints: { holiday: false, lastTerm: false }, holidayPeriod: { id: 'other', how: 'none' } }],
  before: [
    { id: XH, date: '2026-07-08', cents: 8500, payer: 'H PAYER', description: 'H PAYER', reference: '', source: 'xero', grade: 'none', candidates: [], previous: null, hints: { holiday: true, lastTerm: true }, holidayPeriod: { id: '2026-winter', how: 'inside' }, early: true },
    { id: XL, date: '2026-08-04', cents: 45000, payer: 'P OLDTERM', description: 'P OLDTERM', reference: '', source: 'xero', grade: 'none', candidates: [], previous: PREV, hints: { holiday: false, lastTerm: true }, holidayPeriod: { id: '2026-winter', how: 'after' }, early: true },
  ],
  counts: { checked: 3, high: 1, possible: 0, none: 0, before: 2, early: 2 }, hidden: [],
  holiday: { periods: PERIODS, coaches: [{ id: 'cara', name: 'Cara' }, { id: 'bo', name: 'Bo' }], locations: ['Belrose HQ', 'North Turramurra'], defaultLocation: 'Belrose HQ' },
  previousTerm: { term: 'Term 3 2026' }, termStart: '2026-10-12',
})
const bankIds = (p) => [...p.d.querySelectorAll('#m-bank [data-bank]')].map((li) => li.dataset.bank)

await test('bank transfers: the chips, the hints and the fold for lines from before this term', async () => {
  const p = await openPortal({ money: fresh(), onPost: (b) => (b.action === 'bankCheck' ? { success: true, bank: BANK() } : null) })
  assert.match(p.text('#m-bank summary'), /^Bank transfers to check 1 1 with a match$/, 'the count is this term')
  assert.deepEqual([...p.d.querySelectorAll('#m-bank-chips [data-bank-chip]')].map((b) => b.textContent.replace(/\s+/g, ' ').trim()), ['All 3', 'This term 1', 'Looks like holiday 1', 'Looks like last term 2', 'Hidden 0'])
  assert.deepEqual(bankIds(p), [XN, XH, XL], 'All: this term, then the fold')
  assert.match(p.text('#m-bank-before summary'), /^Before this term \(2\)$/)
  assert.ok(p.$(`#m-bank-before [data-bank="${XH}"]`))
  assert.deepEqual([...p.$(`#m-bank [data-bank="${XH}"] .top`).children].map((x) => x.textContent.replace(/July/, 'Jul')), ['8 Jul 2026', 'A$85', 'No match yet', 'Looks like holiday training', 'Looks like last term'], 'older lines show the year')
  assert.deepEqual([...p.$(`#m-bank [data-bank="${XN}"] .top`).children].map((x) => x.textContent), ['10 Oct', 'A$850', 'Likely match'], 'no hints, no pills')
  assert.match(p.text(`#m-bank [data-bank="${XL}"] .prev`), /Last term: Zed Oldterm \(Pat Oldterm\) · owing A\$450/)
  for (const id of [XN, XH, XL]) for (const sel of ['[data-bank-holiday]', '[data-bank-prev]', '[data-bank-ignore]']) assert.ok(p.$(`#m-bank [data-bank="${id}"] ${sel}`), `${id} ${sel}`)
  await p.click('#m-bank-chips [data-bank-chip="holiday"]')
  assert.deepEqual(bankIds(p), [XH])
  assert.equal(p.$('#m-bank-chips [data-bank-chip="holiday"]').getAttribute('aria-pressed'), 'true')
  await p.click('#m-bank-chips [data-bank-chip="last"]')
  assert.deepEqual(bankIds(p), [XH, XL])
  await p.click('#m-bank-chips [data-bank-chip="term"]')
  assert.deepEqual(bankIds(p), [XN])
  assert.equal(p.$('#m-bank-before'), null)
  await p.click('#m-bank-chips [data-bank-chip="hidden"]')
  assert.match(p.text('#m-bank'), /Nothing hidden\./)
  await p.click('#m-bank-chips [data-bank-chip="all"]')
  assert.deepEqual(p.errors, [])
  p.close()
})

await test('bank transfers: Holiday revenue saves the holiday picked, the session date, coach and place, with an undo', async () => {
  let bank = BANK()
  let twinOnce = true
  const p = await openPortal({ money: fresh(), onPost: (b) => {
    if (b.action === 'bankCheck') return { success: true, bank }
    if (b.action === 'bankHoliday' && twinOnce && !b.confirmTwin) { twinOnce = false; return { status: 409, success: false, code: 'twin', error: 'This looks like the same transfer as the A$85 from H PAYER on 2026-07-08, already recorded from the bank CSV. Only save it if it is a different payment.' } }
    if (b.action === 'bankHoliday') { bank = { ...bank, before: bank.before.filter((x) => x.id !== b.id) }; return { success: true, line: { id: b.id }, periodLabel: 'Winter holidays 2026' } }
    if (b.action === 'bankHolidayUndo') { bank = BANK(); return { success: true, id: b.id } }
    return null
  } })
  await p.click(`#m-bank [data-bank="${XH}"] [data-bank-holiday]`)
  assert.match(p.text('#jp-modal'), /^Holiday training ?Bank, 0?8\/0?7\/2026: A\$85 · H PAYER/)
  assert.equal(p.$('#hb-period').value, '2026-winter', 'the holiday the bank date is in')
  assert.match(p.text('#hb-why'), /The bank date is in the Winter holidays 2026\./)
  assert.equal(p.$('#hb-loc').value, 'Belrose HQ')
  assert.deepEqual([...p.$('#hb-coach').options].map((o) => o.textContent), ['Not sure', 'Cara', 'Bo'])
  p.$('#hb-date').value = '2026-07-09'
  p.$('#hb-coach').value = 'cara'
  p.$('#hb-note').value = 'one session'
  await p.click('#hb-go')
  // The other copy of a recorded transfer: asked first.
  assert.match(p.text('#jp-modal'), /looks like the same transfer/)
  await p.click('#jp-modal [data-yes]')
  const saves = p.posts.filter((b) => b.action === 'bankHoliday')
  assert.deepEqual(saves.at(-1), { action: 'bankHoliday', id: XH, period: '2026-winter', sessionDate: '2026-07-09', coach: 'cara', location: 'Belrose HQ', note: 'one session', confirmTwin: true })
  assert.equal(saves.length, 2)
  assert.ok(!bankIds(p).includes(XH), 'it leaves the list')
  assert.match(p.text('#m-bank-undo'), /Saved A\$85 from H PAYER as holiday training \(Winter holidays 2026\)\. ?Undo/)
  await p.click('#m-bank-undo [data-bank-undo]')
  assert.deepEqual(p.posts.filter((b) => b.action === 'bankHolidayUndo'), [{ action: 'bankHolidayUndo', id: XH }])
  assert.equal(p.$('#m-bank-undo'), null)
  assert.ok(bankIds(p).includes(XH), 'back on the list')
  // A date just before a holiday suggests that holiday; Other dates otherwise.
  await p.click(`#m-bank [data-bank="${XN}"] [data-bank-holiday]`)
  assert.equal(p.$('#hb-period').value, 'other')
  assert.equal(p.$('#hb-why'), null)
  assert.deepEqual(p.errors, [])
  p.close()
})

await test('bank transfers: Previous term picks a player from last term\'s list, with the amount and the bank date', async () => {
  const LAST = [{ rowId: 'recPREV0000000001', player: 'Zed Oldterm', parent: 'Pat Oldterm', location: 'Belrose HQ', feeCents: 85000, paidCents: 40000, owingCents: 45000, status: 'Partially Paid' }, { rowId: 'recPREV0000000002', player: 'Amy Oldterm', parent: 'Pat Oldterm', location: 'NTRA', feeCents: 85000, paidCents: 85000, owingCents: 0, status: 'Paid' }, { rowId: 'recPREV0000000003', player: 'Kai Other', parent: 'Lou Other', location: 'Rydalmere', feeCents: null, paidCents: 0, owingCents: 0, status: 'Not set' }]
  const p = await openPortal({ money: fresh(), onPost: (b) => {
    if (b.action === 'bankCheck') return { success: true, bank: BANK() }
    if (b.action === 'previousTermPlayers') return { success: true, term: 'Term 3 2026', players: LAST }
    if (b.action === 'bankPreviousTerm') return { success: true, term: 'Term 3 2026', ledger: true, rowUpdated: true, addedCents: 45000 }
    return null
  } })
  await p.click(`#m-bank [data-bank="${XL}"] [data-bank-prev]`)
  assert.match(p.text('#jp-modal'), /^Last term: Term 3 2026 ?Bank, 0?4\/0?8\/2026: A\$450 · P OLDTERM/)
  assert.equal(p.$('#pt-q').value, 'Zed Oldterm', 'the best match from last term')
  assert.equal(p.$('#pt-res input[value="recPREV0000000001"]').checked, true)
  assert.match(p.text('#pt-res'), /Zed Oldterm ?Pat Oldterm · Belrose HQ ?Fee A\$850 · paid A\$400 · owing A\$450/)
  assert.equal(p.$('#pt-amt').value, '450')
  assert.equal(p.$('#pt-date').value, '2026-08-04')
  assert.ok(p.$('#pt-date').disabled, 'the date is the bank\'s')
  // Search by the parent: both of their children.
  p.$('#pt-q').value = 'pat'
  p.$('#pt-q').dispatchEvent(new p.w.Event('input', { bubbles: true }))
  assert.deepEqual([...p.d.querySelectorAll('#pt-res input')].map((x) => x.value), ['recPREV0000000001', 'recPREV0000000002'])
  assert.match(p.text('#pt-res'), /Amy Oldterm.*marked paid/)
  p.$('#pt-amt').value = '500'
  await p.click('#pt-go')
  assert.match(p.text('#pt-err'), /more than the A\$450 that came in/)
  assert.equal(p.posts.filter((b) => b.action === 'bankPreviousTerm').length, 0)
  p.$('#pt-amt').value = '450'
  p.$('#pt-note').value = 'paid late'
  await p.click('#pt-go')
  assert.deepEqual(p.posts.filter((b) => b.action === 'bankPreviousTerm'), [{ action: 'bankPreviousTerm', id: XL, rowId: 'recPREV0000000001', amountCents: 45000, note: 'paid late' }])
  assert.equal(p.$('#jp-modal'), null)
  assert.match(p.text('.j-toast'), /Saved for Zed Oldterm in Term 3 2026: in the ledger and A\$450 on their row/)
  assert.ok(!bankIds(p).includes(XL))
  assert.deepEqual(p.errors, [])
  p.close()
})

console.log(`\n${passed} holiday money page checks passed`)
