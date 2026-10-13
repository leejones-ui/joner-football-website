// Holiday training between holidays (Lee, 13 Oct 2026): the Past holidays
// record and Set up next holidays. Pure checks, no KV or network. Every
// name here is invented.
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { holidayRecord, planHolidays, planToCreate, upcomingPeriods, weeklyPattern, holidayDays, isPastSlot, sourcePeriods } from '../api/_holiday-plan.js'
import { upsertSlot, sydneyIso, addMinutesIso, validateSlotInput } from '../api/_holiday-store.js'
import { recordHtml, planPreviewHtml, planFormHtml, emptyHtml, splitSlots, splitBookings, blankDates, EMPTY_TEXT } from '../src/scripts/holiday-admin-plan.js'

let passed = 0
function test(name, fn) { fn(); passed += 1; console.log(`ok - ${name}`) }
const dom = (html) => new JSDOM(`<body>${html}</body>`).window.document

const config = {
  coaches: [{ id: 'cara', name: 'Cara', tier: 'coach', active: true }, { id: 'bo', name: 'Bo', tier: 'lee', active: true }, { id: 'old', name: 'Olly', tier: 'coach', active: false }],
  prices: { lee: { one: 15000, shared: 10000, group: 9000 }, coach: { one: 12000, shared: 9000, group: 8000 } },
  defaultLocation: 'Test HQ, Belrose',
}
// A slot as the store keeps it.
function slot(id, date, startTime, coachId, x = {}) {
  const v = validateSlotInput({ coachId, date, startTime, durationMin: 60, type: 'open', capacity: 6, ...x }, config)
  assert.ok(v.ok, JSON.stringify(v.errors))
  const startsAt = sydneyIso(date, startTime)
  return { ...v.slot, id, startsAt, endsAt: addMinutesIso(startsAt, v.slot.durationMin), status: x.status || 'open' }
}
const booking = (id, slotId, names, x = {}) => ({ id, slotId, status: 'paid', seats: names.length, players: names.map((name) => ({ name })), parentName: 'A Parent', ...x })

// Spring holidays 2026 (26 Sep to 12 Oct break): a Monday and a Tuesday pattern, two weeks.
const SPRING = [
  slot('S1', '2026-09-28', '09:00', 'cara'), slot('S2', '2026-09-29', '10:00', 'bo', { priceCents: 13000 }),
  slot('S3', '2026-10-05', '09:00', 'cara'), slot('S4', '2026-10-06', '10:00', 'bo', { priceCents: 13000 }),
  slot('S5', '2026-10-06', '11:00', 'cara', { status: 'blocked' }), slot('S6', '2026-10-07', '09:00', 'cara', { status: 'cancelled' }),
  slot('S7', '2026-09-30', '15:00', 'old'),
]
const WINTER = [slot('W1', '2026-07-07', '09:00', 'cara')]
const LATER = [slot('U1', '2026-10-13', '16:00', 'cara')] // today: still coming up
const SLOTS = [...SPRING, ...WINTER, ...LATER]
const BOOKINGS = [
  booking('HOL-1', 'S1', ['Kid Ann']), booking('HOL-2', 'S2', ['Kid Ann', 'Kid Ben']), booking('HOL-3', 'S3', ['kid  ann']),
  booking('HOL-4', 'S4', ['Kid Cal'], { status: 'cancelled' }), booking('HOL-5', 'W1', ['Kid Dot']), booking('HOL-6', 'S4', ['Kid Eve'], { status: 'held' }),
]
const TODAY = '2026-10-13'

test('a slot is past from the day after it; today is still coming up', () => {
  assert.equal(isPastSlot({ date: '2026-10-12' }, TODAY), true)
  assert.equal(isPastSlot({ date: TODAY }, TODAY), false)
  const s = splitSlots(SLOTS, TODAY)
  assert.deepEqual(s.upcoming.map((x) => x.id), ['U1'])
  assert.equal(s.past.length, SLOTS.length - 1)
  const b = splitBookings([{ id: 'a', slotDate: '2026-10-01' }, { id: 'b', slotDate: TODAY }, { id: 'c', slotDate: '' }], TODAY)
  assert.deepEqual([b.upcoming.map((x) => x.id), b.past.map((x) => x.id)], [['b', 'c'], ['a']], 'a booking with no known session stays in view')
})

test('Past holidays: one record per school holiday, newest first, with sessions run, bookings, players and coach', () => {
  const rec = holidayRecord({ slots: SLOTS, bookings: BOOKINGS, config, today: TODAY })
  assert.deepEqual(rec.map((p) => p.id), ['2026-spring', '2026-winter'], 'today\'s session is not in the record')
  const sp = rec[0]
  assert.equal(sp.label, 'Spring holidays 2026')
  // S1, S2, S3 booked online, S5 booked offline; S4 had only a cancelled and a held booking; S7 never booked; S6 cancelled is left out.
  assert.deepEqual([sp.offered, sp.run, sp.online, sp.offline, sp.notBooked], [6, 4, 3, 1, 2])
  assert.equal(sp.bookings, 3, 'paid bookings only')
  assert.equal(sp.cancelled, 1)
  assert.equal(sp.places, 4)
  assert.equal(sp.players, 2, 'the same child twice counts once')
  assert.deepEqual(sp.coaches, [{ name: 'Cara', sessions: 3 }, { name: 'Bo', sessions: 1 }])
  assert.equal(sp.sessions[0].date, '2026-10-06', 'newest session first')
  assert.ok(!sp.sessions.some((x) => x.slotId === 'S6'))
  assert.equal(sp.moneyHref, '/jfp-portal/#money?programme=holiday&period=2026-spring')
  assert.deepEqual([rec[1].run, rec[1].bookings, rec[1].players], [1, 1, 1])
})

test('Past holidays renders read only, with a link to that holiday\'s money', () => {
  const d = dom(recordHtml(holidayRecord({ slots: SLOTS, bookings: BOOKINGS, config, today: TODAY })))
  const sp = d.querySelector('[data-period="2026-spring"]')
  assert.equal(sp.querySelector('[data-stat="run"]').textContent, '4')
  assert.equal(sp.querySelector('[data-stat="bookings"]').textContent, '3')
  assert.equal(sp.querySelector('[data-stat="players"]').textContent, '2')
  assert.match(sp.querySelector('[data-stat="coach"]').textContent, /^Cara \(3\), Bo \(1\)$/)
  const a = sp.querySelector('[data-money]')
  assert.equal(a.getAttribute('href'), '/jfp-portal/#money?programme=holiday&period=2026-spring')
  assert.equal(a.getAttribute('target'), '_top', 'leaves the frame for the portal')
  assert.equal(d.querySelectorAll('input, select, textarea, button').length, 0, 'nothing to change')
  assert.match(d.body.textContent, /1 session booked offline · 2 slots not booked · 1 booking cancelled/)
  assert.match(dom(recordHtml([])).body.textContent, /No past holiday sessions yet/)
})

test('the empty state for Coming up', () => {
  const d = dom(emptyHtml())
  assert.equal(EMPTY_TEXT, 'No holiday sessions set up yet.')
  assert.match(d.body.textContent, /No holiday sessions set up yet\.\s*Set up the next holidays/)
  assert.ok(d.querySelector('button[data-plan-open]'))
})

test('the holidays to set up: the next ones not over yet', () => {
  assert.deepEqual(upcomingPeriods(TODAY).map((p) => p.id), ['2026-summer', '2027-autumn', '2027-winter'])
  assert.equal(upcomingPeriods('2026-10-05')[0].id, '2026-spring', 'a holiday under way can still get sessions')
  assert.deepEqual(sourcePeriods(SLOTS, '2026-12-18').map((p) => [p.id, p.slots]), [['2026-spring', 6], ['2026-winter', 1]], 'cancelled slots are not counted')
})

test('the weekly pattern: each weekday, time and coach once, cancelled hours left out, prices kept', () => {
  const pat = weeklyPattern(SLOTS, '2026-spring')
  assert.deepEqual(pat.map((x) => [x.weekday, x.startTime, x.coachId, x.priceCents]), [[1, '09:00', 'cara', null], [2, '10:00', 'bo', 13000], [2, '11:00', 'cara', null], [3, '15:00', 'old', null]])
  assert.ok(!pat.some((x) => x.weekday === 3 && x.startTime === '09:00'), 'the cancelled Wednesday is not copied')
})

test('copy the last holiday onto the summer dates: same weekdays, times, coaches, prices and places; public holidays left out', () => {
  const plan = planHolidays({ slots: SLOTS, config, today: TODAY })
  assert.equal(plan.ok, true)
  assert.deepEqual([plan.mode, plan.target.id, plan.source.id, plan.source.pattern], ['copy', '2026-summer', '2026-spring', 4])
  assert.equal(plan.target.range, '18 Dec 2026 to 27 Jan 2027')
  const days = plan.days
  assert.equal(days[0].date, '2026-12-18')
  assert.equal(days.at(-1).date, '2027-01-27')
  // Mondays get Cara 9am; Tuesdays Bo 10am at his own A$130 and Cara 11am; Wednesdays Olly, who is not active.
  const mon = days.find((d) => d.date === '2026-12-21')
  assert.deepEqual(mon.items.map((x) => [x.startLabel, x.coachName, x.status, x.priceLabel]), [['9am', 'Cara', 'new', 'from A$80']])
  const tue = days.find((d) => d.date === '2026-12-22')
  assert.deepEqual(tue.items.map((x) => [x.startLabel, x.coachName, x.priceLabel, x.customPrice]), [['10am', 'Bo', 'A$130', true], ['11am', 'Cara', 'from A$80', false]])
  assert.deepEqual(days.find((d) => d.date === '2026-12-23').items.map((x) => x.status), ['coach'])
  // Christmas (Fri) has nothing in the pattern; Boxing Day observed (Mon 28 Dec) would have had Cara.
  const box = days.find((d) => d.date === '2026-12-28')
  assert.deepEqual([box.publicHoliday, box.items.length, box.wouldHave], ['Boxing Day (observed)', 0, 1])
  assert.equal(days.find((d) => d.date === '2027-01-26').publicHoliday, 'Australia Day')
  assert.equal(plan.counts.publicHolidays, 2, 'Boxing Day and Australia Day (a Tuesday) would have had sessions')
  // The template is a real slot for the store's own validation.
  const t = tue.items[0].template
  assert.deepEqual(t, { startTime: '10:00', coachId: 'bo', durationMin: 60, type: 'open', capacity: 6, priceCents: 13000, minPlayers: 1, location: 'Test HQ, Belrose', notes: '', date: '2026-12-22' })
  assert.equal(validateSlotInput(t, config).ok, true)
  // Mondays: 21, 28 (out), 4, 11, 18, 25 Jan; Tuesdays: 22, 29 Dec, 5, 12, 19 Jan (26th out), each with 2.
  assert.equal(plan.counts.new, 5 + 5 * 2)
  assert.equal(plan.counts.coach, 6, 'six Wednesdays with a coach who is not active')
})

test('an hour that is already there is shown, never made twice; untick a day and it is left out', () => {
  const already = slot('X1', '2027-01-04', '09:00', 'cara')
  const plan = planHolidays({ slots: [...SLOTS, already], config, today: TODAY, period: '2026-summer', source: '2026-spring' })
  assert.deepEqual(plan.days.find((d) => d.date === '2027-01-04').items.map((x) => x.status), ['exists'])
  assert.equal(plan.counts.exists, 1)
  const all = plan.days.filter((d) => d.items.some((x) => x.status === 'new')).map((d) => d.date)
  assert.equal(planToCreate(plan, all).length, plan.counts.new)
  assert.equal(planToCreate(plan, all.filter((d) => d !== '2026-12-22')).length, plan.counts.new - 2)
  assert.deepEqual(planToCreate(plan, ['2027-01-04', '2026-12-23']), [], 'nothing new on those days')
  assert.deepEqual(planToCreate(plan, 'not a list'), [])
})

test('start blank, a holiday to copy from, and wrong asks', () => {
  const blank = planHolidays({ slots: SLOTS, config, today: TODAY, mode: 'blank' })
  assert.deepEqual([blank.mode, blank.source, blank.days.every((d) => !d.items.length)], ['blank', null, true])
  const wk = blankDates(blank)
  assert.ok(wk.includes('2026-12-18') && !wk.includes('2026-12-19') && !wk.includes('2026-12-25') && !wk.includes('2027-01-26'), 'weekdays, no weekends or public holidays')
  const winter = planHolidays({ slots: SLOTS, config, today: TODAY, source: '2026-winter' })
  assert.deepEqual([winter.source.id, winter.source.pattern], ['2026-winter', 1])
  assert.equal(planHolidays({ slots: [], config, today: TODAY }).mode, 'blank', 'nothing to copy: blank')
  assert.equal(planHolidays({ slots: SLOTS, config, today: TODAY, period: '2026-spring' }).ok, false, 'a finished holiday cannot be set up')
  assert.equal(planHolidays({ slots: SLOTS, config, today: TODAY, source: '2025-spring' }).ok, false)
  assert.equal(planHolidays({ slots: SLOTS, config, today: 'soon' }).ok, false)
  // A holiday under way: only from today on.
  const mid = planHolidays({ slots: SLOTS, config, today: '2026-12-30', period: '2026-summer' })
  assert.equal(mid.days[0].date, '2026-12-30')
  assert.deepEqual(holidayDays({ start: '2026-12-24', end: '2026-12-26' }, TODAY).map((d) => [d.date, d.publicHoliday]), [['2026-12-24', ''], ['2026-12-25', 'Christmas Day'], ['2026-12-26', '']])
})

test('the preview: a tick per day, the count on the button, skips explained', () => {
  const plan = planHolidays({ slots: SLOTS, config, today: TODAY })
  let d = dom(planPreviewHtml(plan))
  assert.equal(d.querySelector('[data-plan-create]').textContent, `Create ${plan.counts.new} sessions`)
  assert.ok(d.querySelector('[data-plan-day="2026-12-22"]').checked)
  assert.ok(d.querySelector('[data-plan-day="2026-12-23"]').disabled, 'a day with nothing new cannot be ticked')
  assert.equal(d.querySelector('[data-plan-day="2026-12-28"]'), null, 'a public holiday has no tick')
  assert.match(d.querySelector('#hp-skips').textContent, /6 sessions with a coach who is not active · 2 public holidays left out\. These are not made\./)
  assert.match(d.querySelector('#hp-summary').textContent, /Copying Spring holidays 2026 \(4 sessions a week\) onto Summer holidays 2026–27/)
  assert.match(d.body.textContent, /Nothing is emailed/)
  const some = new Set(['2026-12-21', '2026-12-22'])
  d = dom(planPreviewHtml(plan, some))
  assert.equal(d.querySelector('[data-plan-create]').textContent, 'Create 3 sessions')
  d = dom(planPreviewHtml(plan, new Set()))
  assert.ok(d.querySelector('[data-plan-create]').disabled)
  const f = dom(planFormHtml(plan))
  assert.deepEqual([...f.querySelectorAll('#hp-period option')].map((o) => o.value), ['2026-summer', '2027-autumn', '2027-winter'])
  assert.equal(f.querySelector('#hp-source').value, '2026-spring')
  assert.equal(f.querySelector('[data-mode="copy"]').getAttribute('aria-pressed'), 'true')
  const blank = dom(planPreviewHtml(planHolidays({ slots: [], config, today: TODAY })))
  assert.match(blank.querySelector('#hp-blank').textContent, /Summer holidays 2026–27, 18 Dec 2026 to 27 Jan 2027\. Nothing is made yet\./)
  assert.ok(blank.querySelector('[data-plan-weekdays]'))
  const bf = dom(planFormHtml(planHolidays({ slots: [], config, today: TODAY })))
  assert.ok(bf.querySelector('[data-mode="copy"]').disabled && bf.querySelector('#hp-no-source'))
})

// The store's upsertSlot is the one used to make them: same checks as the form.
test('the planned slots go through the same slot checks', () => {
  assert.equal(typeof upsertSlot, 'function')
  const bad = validateSlotInput({ coachId: 'nobody', date: '2026-12-21', startTime: '09:00', durationMin: 60, type: 'open' }, config)
  assert.equal(bad.ok, false)
})

console.log(`\n${passed} holiday plan checks passed`)
