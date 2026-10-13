// Holiday training money and the two new bank buttons' helpers (Lee, 13 Oct
// 2026): the NSW school holidays, the money per holiday, the hints, the fold
// for older bank lines and last term's rows. No network; every name and
// amount is invented.
import assert from 'node:assert/strict'
import { HOLIDAY_PERIODS, OTHER, periodOf, suggestPeriod, nearHoliday, pickablePeriods, holidayPriceSizes, rangeLabel, isPeriodId, periodLabel } from '../api/_holiday-periods.js'
import { holidayLines, holidayMoneyView, byMonth, sydneyDay, ALL } from '../api/_holiday-money.js'
import { matchBank, cleanItem, hintsFor, previousMatch } from '../api/_jfp-bank-match.js'
import { previousRow, PREVIOUS_TERMS } from '../api/_jfp-airtable.js'

let passed = 0
function test(name, fn) { fn(); passed += 1; console.log(`ok - ${name}`) }

test('school holidays: 2024 to 2027, in order, each break around its official dates', () => {
  assert.ok(HOLIDAY_PERIODS.length >= 16)
  for (const y of ['2024', '2025', '2026', '2027']) for (const s of ['autumn', 'winter', 'spring', 'summer']) assert.ok(HOLIDAY_PERIODS.some((p) => p.id === `${y}-${s}`), `${y} ${s}`)
  for (const [i, p] of HOLIDAY_PERIODS.entries()) {
    assert.ok(p.from <= p.start && p.start <= p.end && p.end <= p.to, p.id)
    if (i) assert.ok(HOLIDAY_PERIODS[i - 1].to < p.from, `${p.id} starts after the one before ends`)
  }
  const w = HOLIDAY_PERIODS.find((p) => p.id === '2026-winter')
  assert.deepEqual([w.start, w.end], ['2026-07-06', '2026-07-17'])
  assert.match(rangeLabel(w), /^6 July? to 17 July? 2026$/, 'short months (Node and browsers spell July either way)')
  assert.match(rangeLabel(HOLIDAY_PERIODS.find((p) => p.id === '2026-summer')), /^18 Dec 2026 to 27 Jan 2027$/)
  assert.ok(isPeriodId('2026-spring') && isPeriodId(OTHER) && !isPeriodId('2026-easter') && !isPeriodId(''))
  assert.equal(periodLabel(OTHER), 'Other dates')
})

test('a session date: in the holiday it is in (weekends either side count), else Other dates', () => {
  assert.equal(periodOf('2026-07-06'), '2026-winter')
  assert.equal(periodOf('2026-07-04'), '2026-winter', 'the Saturday before')
  assert.equal(periodOf('2026-07-20'), '2026-winter', 'the staff day after')
  assert.equal(periodOf('2026-07-21'), OTHER, 'term has started')
  assert.equal(periodOf('2026-10-01'), '2026-spring')
  assert.equal(periodOf('2027-01-15'), '2026-summer')
  assert.equal(periodOf('2027-02-10'), OTHER)
  assert.equal(periodOf(''), OTHER)
  assert.equal(periodOf('rubbish'), OTHER)
})

test('a bank date: inside, up to 10 days before, or soon after a holiday; the hint window is inside or before', () => {
  assert.deepEqual(suggestPeriod('2026-07-08'), { id: '2026-winter', how: 'inside' })
  assert.deepEqual(suggestPeriod('2026-06-25'), { id: '2026-winter', how: 'before' }, '9 days before the break')
  assert.deepEqual(suggestPeriod('2026-06-23'), { id: OTHER, how: 'none' }, '11 days before: no')
  assert.deepEqual(suggestPeriod('2026-07-30'), { id: '2026-winter', how: 'after' }, 'paid after training')
  assert.deepEqual(suggestPeriod('2026-08-30'), { id: OTHER, how: 'none' })
  assert.ok(nearHoliday('2026-06-25') && nearHoliday('2026-07-10'))
  assert.ok(!nearHoliday('2026-07-30'), 'after a holiday is no hint')
})

test('the holidays to pick: newest first, the next one coming at the top, none further ahead', () => {
  const list = pickablePeriods('2026-10-13')
  assert.equal(list[0].id, '2026-summer', 'the next one')
  assert.equal(list[1].id, '2026-spring')
  assert.equal(list[2].id, '2026-winter')
  assert.ok(!list.some((p) => p.id === '2027-autumn'))
  assert.equal(list.at(-1).id, '2023-summer')
})

test('holiday prices: each price a player for 1 to 3 players, test prices left out', () => {
  const s = holidayPriceSizes({ coach: { one: 12000, shared: 9000, group: 0 }, lee: { one: 15000 } }, [8500, 100, null])
  for (const c of [12000, 24000, 36000, 9000, 18000, 15000, 8500, 17000, 25500]) assert.ok(s.has(c), String(c))
  assert.ok(!s.has(100) && !s.has(0) && !s.has(200))
})

// ---------- money per holiday ----------
const config = { coaches: [{ id: 'cara', name: 'Cara', tier: 'coach' }, { id: 'bo', name: 'Bo', tier: 'coach' }], defaultLocation: 'Test HQ, Belrose' }
const slot = (id, date, coachId, x = {}) => ({ id, date, startTime: '10:00', coachId, type: 'open', location: 'Test HQ, Belrose', status: 'open', ...x })
const SLOTS = [slot('S1', '2026-09-29', 'cara'), slot('S2', '2026-10-02', 'bo', { location: 'Fieldtown Park' }), slot('S3', '2026-10-06', 'cara'), slot('S4', '2026-10-08', 'bo'), slot('S5', '2027-02-10', 'cara'), slot('S6', '2026-10-07', 'cara', { seatMode: 'shared', type: 'group', title: 'Pros only' })]
const booking = (id, slotId, x = {}) => ({ id, slotId, coachId: 'cara', type: 'one', seats: 1, unitCents: 12000, priceCents: 12000, amountPaidCents: 12000, status: 'paid', paidAt: '2026-09-25T01:00:00.000Z', createdAt: '2026-09-25T00:55:00.000Z', parentName: `Parent ${id}`, players: [{ name: `Kid ${id}` }], ...x })
const BOOKINGS = [
  booking('HOL-1', 'S1'),
  booking('HOL-2', 'S2', { coachId: 'bo', type: 'shared', seats: 2, unitCents: 9000, priceCents: 18000, amountPaidCents: 18000, paidAt: '2026-09-30T23:30:00.000Z' }),
  // Cancelled with a full refund due, not refunded in Stripe.
  booking('HOL-3', 'S3', { status: 'cancelled', refundDue: true, refund: { percent: 100, cents: 12000, paidCents: 12000 } }),
  // Cancelled inside 24 hours, half due, half refunded: nothing owed.
  booking('HOL-4', 'S4', { coachId: 'bo', status: 'cancelled', refundDue: true, refund: { percent: 50, cents: 6000, paidCents: 12000 } }),
  booking('HOL-5', 'S5', { paidAt: '2026-10-05T02:00:00.000Z' }),
  booking('HOL-6', 'S6', { type: 'group', seats: 2, unitCents: 8500, priceCents: 17000, amountPaidCents: 17000 }),
  // Never paid: not money.
  booking('HOL-7', 'S1', { status: 'expired', paidAt: undefined, amountPaidCents: undefined }),
  booking('HOL-8', 'S2', { status: 'cancelled', paidAt: undefined, amountPaidCents: undefined, cancelledBy: 'parent' }),
]
const pay = (bookingId, slotId, cents, x = {}) => ({ id: `cs_${bookingId}`, intentId: `pi_${bookingId}`, bookingId, slotId, at: '2026-09-25T01:00:00.000Z', amountCents: cents, refundedCents: 0, feeCents: Math.round(cents * 0.02) + 20, feeGstCents: 4, feeKnown: true, payMethod: 'card', ...x })
const STRIPE = { error: '', payments: [
  pay('HOL-1', 'S1', 12000), pay('HOL-2', 'S2', 18000, { at: '2026-09-30T23:30:00.000Z' }), pay('HOL-3', 'S3', 12000), pay('HOL-4', 'S4', 12000, { refundedCents: 6000 }),
  pay('HOL-5', 'S5', 12000, { at: '2026-10-05T02:00:00.000Z' }), pay('HOL-6', 'S6', 17000, { feeKnown: false, feeCents: null, feeGstCents: null }),
] }
const BANK = [
  { id: 'XERO-00000011-aaaa', date: '2026-07-08', cents: 8500, payer: 'A Payer', period: '2026-winter', sessionDate: '', coach: 'Cara', location: 'Belrose HQ' },
  { id: 'XERO-00000012-aaaa', date: '2026-06-30', cents: 17000, payer: 'B Payer', period: '2026-winter', sessionDate: '', coach: '', location: 'Belrose HQ' },
  { id: 'XERO-00000013-aaaa', date: '2026-09-20', cents: 12000, payer: 'C Payer', period: '2026-spring', sessionDate: '2026-10-01', coach: 'Bo', location: 'Belrose HQ' },
]
const locationOf = (n) => (/belrose/i.test(n || '') ? { id: 'belrose', name: 'Belrose HQ' } : { id: 'fieldtown', name: n || 'No venue set' })
const fee = (c) => Math.round(c * 0.02) + 20

test('lines: one per paid booking (cancelled ones too), one per holiday bank line; never paid is left out', () => {
  const lines = holidayLines({ bookings: BOOKINGS, slots: SLOTS, config, stripe: STRIPE, bankLines: BANK, locationOf })
  assert.deepEqual(lines.filter((x) => x.kind === 'stripe').map((x) => x.id).sort(), ['HOL-1', 'HOL-2', 'HOL-3', 'HOL-4', 'HOL-5', 'HOL-6'])
  assert.equal(lines.filter((x) => x.kind === 'bank').length, 3)
  const two = lines.find((x) => x.id === 'HOL-2')
  assert.deepEqual([two.period, two.coach, two.location, two.typeName, two.seats, two.unitCents, two.paidDate], ['2026-spring', 'Bo', 'Fieldtown Park', 'Shared (2 players)', 2, 9000, '2026-10-01'], 'paid the evening of 30 Sep UTC is 1 Oct in Sydney')
  assert.equal(two.keptCents, 18000 - fee(18000))
  const trial = lines.find((x) => x.id === 'HOL-6')
  assert.deepEqual([trial.typeName, trial.feeCents, trial.feePending, trial.keptCents], ['Pros only', null, true, 17000], 'a fee not known yet is pending, never zero')
  assert.equal(lines.find((x) => x.id === 'HOL-5').period, OTHER)
  const b2 = lines.find((x) => x.id === 'XERO-00000012-aaaa')
  assert.deepEqual([b2.period, b2.monthDate, b2.coach, b2.feeCents, b2.keptCents], ['2026-winter', '2026-07-06', 'Not noted', 0, 17000], 'paid before the holiday, no session date: the holiday\'s first day')
  assert.equal(lines.find((x) => x.id === 'XERO-00000011-aaaa').monthDate, '2026-07-08')
  assert.equal(sydneyDay('2026-09-30T23:30:00.000Z'), '2026-10-01')
})

test('a holiday: taken, refunds, real fees, kept; Stripe and bank apart; by coach, location, type and month', () => {
  const v = holidayMoneyView({ bookings: BOOKINGS, slots: SLOTS, config, stripe: STRIPE, bankLines: BANK, locationOf, today: '2026-10-13', period: '2026-spring' })
  assert.equal(v.period, '2026-spring')
  assert.equal(v.label, 'Spring holidays 2026')
  const stripeIds = ['HOL-1', 'HOL-2', 'HOL-3', 'HOL-4', 'HOL-6']
  const taken = 12000 + 18000 + 12000 + 12000 + 17000
  const fees = fee(12000) + fee(18000) + fee(12000) + fee(12000)
  assert.deepEqual(v.lines.filter((x) => x.kind === 'stripe').map((x) => x.id).sort(), stripeIds)
  assert.equal(v.totals.stripe.takenCents, taken)
  assert.equal(v.totals.stripe.refundedCents, 6000)
  assert.equal(v.totals.stripe.feeCents, fees)
  assert.equal(v.totals.stripe.keptCents, taken - 6000 - fees)
  assert.deepEqual([v.totals.bank.count, v.totals.bank.keptCents], [1, 12000])
  assert.equal(v.totals.keptCents, v.totals.stripe.keptCents + v.totals.bank.keptCents)
  assert.equal(v.totals.feesPending, 1)
  // Every breakdown adds up to the same kept.
  for (const k of ['byCoach', 'byLocation', 'byType']) assert.equal(v[k].reduce((t, g) => t + g.keptCents, 0), v.totals.keptCents, k)
  for (const k of ['session', 'paid']) assert.equal(v.byMonth[k].reduce((t, g) => t + g.keptCents, 0), v.totals.keptCents, k)
  assert.deepEqual(v.byCoach.map((g) => g.label).sort(), ['Bo', 'Cara'])
  assert.deepEqual(v.byLocation.map((g) => g.label).sort(), ['Belrose HQ', 'Fieldtown Park'])
  assert.ok(v.byType.some((g) => g.label === '1 on 1 · A$120 a player' && g.count === 3))
  assert.ok(v.byType.some((g) => g.label === 'Bank transfer · A$120'))
  // By session date: the spring sessions sit in Sep (29th) and Oct; by payment date, all in Sep (paid 25 Sep, 20 Sep) bar the one paid 1 Oct.
  assert.deepEqual(v.byMonth.session.map((m) => m.label), ['October 2026', 'September 2026'])
  assert.equal(v.byMonth.session.find((m) => m.month === '2026-09').keptCents, 12000 - fee(12000))
  assert.deepEqual(v.byMonth.paid.map((m) => [m.month, m.count]), [['2026-10', 1], ['2026-09', 5]])
  assert.equal(v.byMonth.paid.find((m) => m.month === '2026-09').bankCents, 12000)
  // Refunds still owed: the full refund never made; the half refund made is not listed.
  assert.deepEqual(v.refundsOwed.map((x) => [x.bookingId, x.owedCents, x.refundDueCents]), [['HOL-3', 12000, 12000]])
})

test('which holiday: the newest with money when none is asked, Other dates, all of it, and the picker list', () => {
  const v = holidayMoneyView({ bookings: BOOKINGS, slots: SLOTS, config, stripe: STRIPE, bankLines: BANK, locationOf, today: '2026-10-13' })
  assert.equal(v.period, '2026-spring', 'newest with money')
  assert.equal(v.periods[0].id, '2026-summer', 'next one coming first')
  assert.equal(v.periods[0].count, 0)
  const ids = v.periods.map((p) => p.id)
  assert.ok(ids.indexOf('2026-spring') < ids.indexOf('2026-winter'), 'newest first')
  assert.deepEqual(ids.slice(-2), [OTHER, ALL])
  assert.deepEqual([v.periods.find((p) => p.id === '2026-winter').count, v.periods.find((p) => p.id === '2026-winter').keptCents], [2, 25500])
  const other = holidayMoneyView({ bookings: BOOKINGS, slots: SLOTS, config, stripe: STRIPE, bankLines: BANK, locationOf, today: '2026-10-13', period: OTHER })
  assert.deepEqual(other.lines.map((x) => x.id), ['HOL-5'])
  const all = holidayMoneyView({ bookings: BOOKINGS, slots: SLOTS, config, stripe: STRIPE, bankLines: BANK, locationOf, today: '2026-10-13', period: ALL })
  assert.equal(all.lines.length, 9)
  assert.equal(all.totals.keptCents, v.periods.filter((p) => p.id !== ALL).reduce((t, p) => t + p.keptCents, 0), 'the holidays add up to all of it')
  const nothing = holidayMoneyView({ bookings: [], slots: [], config, stripe: { payments: [], error: '' }, bankLines: [], locationOf, today: '2026-10-13' })
  assert.equal(nothing.period, '2026-summer')
  assert.equal(nothing.totals.keptCents, 0)
})

test('Stripe not read: bookings show what was paid; fees pending; a refund due is still listed, as not checked', () => {
  const v = holidayMoneyView({ bookings: BOOKINGS, slots: SLOTS, config, stripe: { payments: [], error: 'Stripe could not be read just now.' }, bankLines: [], locationOf, today: '2026-10-13', period: '2026-spring' })
  assert.equal(v.stripeError, 'Stripe could not be read just now.')
  assert.equal(v.totals.takenCents, 12000 + 18000 + 12000 + 12000 + 17000)
  assert.equal(v.totals.feesPending, 5)
  assert.deepEqual(v.refundsOwed.map((x) => [x.bookingId, x.owedCents, x.stripeChecked]), [['HOL-4', null, false], ['HOL-3', null, false]], 'newest session first')
})

test('a Stripe payment for a booking the store no longer has still counts', () => {
  const lines = holidayLines({ bookings: [], slots: SLOTS, config, stripe: { error: '', payments: [pay('HOL-9', 'S1', 12000)] }, locationOf })
  assert.deepEqual([lines[0].id, lines[0].status, lines[0].period, lines[0].keptCents], ['HOL-9', 'no-booking', '2026-spring', 12000 - fee(12000)])
})

test('by month: kept per calendar month, newest first', () => {
  const rows = byMonth([{ kind: 'stripe', sessionDate: '2026-10-02', paidDate: '2026-09-20', keptCents: 100 }, { kind: 'bank', monthDate: '2026-09-30', paidDate: '2026-09-30', keptCents: 50 }], 'session')
  assert.deepEqual(rows.map((r) => [r.month, r.stripeCents, r.bankCents, r.keptCents]), [['2026-10', 100, 0, 100], ['2026-09', 0, 50, 50]])
})

// ---------- bank lines: the fold, the hints, last term ----------
const item = (n, date, cents, payer) => cleanItem({ id: `XERO-${String(n).padStart(8, '0')}-cccc`, date, cents, payer, description: payer }, 'xero')
const player = (rowId, name, parent, x = {}) => ({ rowId, player: name, parent, email: `${rowId}@example.com`, locationId: 'belrose', group: 'Monday 4:20pm, Belrose HQ', status: 'unpaid', feeCents: 85000, paidCents: 0, owingCents: 85000, ...x })
const NOW = [player('t1', 'Ivy Quillfeather', 'Ora Quillfeather')]
const LAST = [{ rowId: 'recLAST0000000001', player: 'Zed Marblewood', parent: 'Pip Marblewood', location: 'Belrose HQ', feeCents: 85000, paidCents: 40000, owingCents: 45000, status: 'Partially Paid' }, { rowId: 'recLAST0000000002', player: 'Ivy Quillfeather', parent: 'Ora Quillfeather', location: 'Belrose HQ', feeCents: 85000, paidCents: 85000, owingCents: 0, status: 'Paid' }]
const SIZES = holidayPriceSizes({ coach: { one: 12000, group: 8500 } })

test('older lines are not dropped: they go in their own fold, matched the same way', () => {
  const items = [item(1, '2026-07-08', 8500, 'R Nobody'), item(2, '2026-08-02', 45000, 'P MARBLEWOOD'), item(3, '2026-10-10', 85000, 'O Quillfeather'), item(4, '2026-07-09', 31337, 'S Stranger'), item(5, '2026-07-10', 8500, 'Stripe Payments Australia')]
  const r = matchBank({ items, players: NOW, since: '2026-09-14', previous: LAST, holidaySizes: SIZES, termStart: '2026-10-12' })
  assert.deepEqual(r.items.map((x) => x.id), [items[2].id])
  assert.deepEqual(r.before.map((x) => x.id), [items[1].id, items[0].id], 'newest first; a stranger at an odd amount and Stripe are left out')
  assert.ok(r.before.every((x) => x.early))
  assert.deepEqual([r.counts.early, r.counts.before], [4, 2])
  const hol = r.before.find((x) => x.id === items[0].id)
  assert.deepEqual(hol.hints, { holiday: true, lastTerm: false }, 'a holiday price in the holidays: holiday, not last term')
  assert.deepEqual(hol.holidayPeriod, { id: '2026-winter', how: 'inside' })
  const last = r.before.find((x) => x.id === items[1].id)
  assert.deepEqual([last.previous.rowId, last.previous.score, last.previous.exact, last.hints.lastTerm, last.hints.holiday], ['recLAST0000000001', 3, true, true, false])
  assert.equal(last.previous.reason, "name matches the parent, amount = what's owing")
  // This term, a likely match: no last term hint, even though the family was on last term's list too.
  const now = r.items[0]
  assert.equal(now.grade, 'high')
  assert.deepEqual(now.hints, { holiday: false, lastTerm: false })
  // Hidden older lines can still be shown again.
  const h = matchBank({ items, players: NOW, since: '2026-09-14', previous: LAST, holidaySizes: SIZES, ignored: [items[0].id] })
  assert.deepEqual(h.hidden.map((x) => x.id), [items[0].id])
  assert.ok(!h.before.some((x) => x.id === items[0].id))
})

test('hints: holiday needs the window and a holiday price; last term is before this term with no name on this term, or last term matches better', () => {
  const sizes = SIZES
  assert.deepEqual(hintsFor({ date: '2026-09-20', cents: 12000 }, { holidaySizes: sizes, termStart: '2026-10-12', grade: 'none' }), { holiday: true, lastTerm: false }, 'six days before spring, a holiday price')
  assert.deepEqual(hintsFor({ date: '2026-09-20', cents: 12100 }, { holidaySizes: sizes, termStart: '2026-10-12', grade: 'none' }), { holiday: false, lastTerm: true }, 'before this term, nobody of that name this term')
  assert.deepEqual(hintsFor({ date: '2026-09-20', cents: 12100 }, { holidaySizes: sizes, termStart: '2026-10-12', grade: 'high' }), { holiday: false, lastTerm: false }, 'a Term 4 fee paid early')
  assert.deepEqual(hintsFor({ date: '2026-09-20', cents: 12100 }, { holidaySizes: sizes, termStart: '2026-10-12', grade: 'possible', best: 3 }), { holiday: false, lastTerm: false }, 'a Term 4 family, other amount')
  assert.deepEqual(hintsFor({ date: '2026-08-05', cents: 45000 }, { termStart: '2026-10-12', grade: 'possible', best: 3, previous: { score: 3, exact: true } }), { holiday: false, lastTerm: true }, 'on both lists, last term owes exactly that')
  assert.deepEqual(hintsFor({ date: '2026-07-08', cents: 8500 }, { holidaySizes: sizes, termStart: '2026-10-12', previous: { score: 2, exact: true } }), { holiday: true, lastTerm: true }, 'a drop-in fee that is also a holiday price: both')
  assert.deepEqual(hintsFor({ date: '2026-10-20', cents: 12000 }, { holidaySizes: sizes, termStart: '2026-10-12' }), { holiday: false, lastTerm: false })
  assert.deepEqual(hintsFor({ date: '2026-10-20', cents: 1 }, { termStart: '2026-10-12', best: 1, previous: { score: 3 } }), { holiday: false, lastTerm: true })
  assert.deepEqual(hintsFor({ date: '2026-10-20', cents: 1 }, { termStart: '2026-10-12', best: 3, previous: { score: 3 } }), { holiday: false, lastTerm: false }, 'on both lists')
  assert.equal(previousMatch({ payer: 'Nobody Here', description: '' }, LAST), null)
})

test('last term\'s rows: what is paid and owing; marked paid with no amount counts as the fee', () => {
  const spec = PREVIOUS_TERMS['Term 3 2026']
  assert.equal(spec.table, 'tblF25gfo0fZcqdPT')
  const row = (fields) => previousRow({ id: 'recT3000000000001', fields: { 'Player Name': 'Zed Marblewood', 'Parent Name': 'Pip Marblewood', 'Session Location': 'Belrose HQ', ...fields } }, spec)
  assert.deepEqual((({ feeCents, paidCents, owingCents, markedPaid }) => ({ feeCents, paidCents, owingCents, markedPaid }))(row({ 'Fee Amount': 850, 'Payment Status': 'Paid' })), { feeCents: 85000, paidCents: 85000, owingCents: 0, markedPaid: true })
  assert.deepEqual([row({ 'Fee Amount': 850, 'Term 3 Amount Paid': 400, 'Payment Status': 'Partially Paid' }).owingCents, row({ 'Fee Amount': 850 }).owingCents, row({}).owingCents], [45000, 85000, 0])
  assert.equal(row({ 'Term 3 Notes': 'x' }).notes, undefined, 'notes only when asked for')
  assert.equal(previousRow({ id: 'r', fields: { 'Term 3 Notes': 'paid late' } }, spec, { notes: true }).notes, 'paid late')
  assert.equal(PREVIOUS_TERMS['Term 4 2026'].paid, 'Term 4 Amount Paid', 'next term can look back at Term 4')
})

console.log(`\n${passed} holiday money checks passed`)
