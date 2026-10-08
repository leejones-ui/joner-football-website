// Pure checks for "Can't make a session": Sydney time and daylight saving,
// the notice a family gave, validation, coach phones, and who gets told.
// No network, no KV.
import assert from 'node:assert/strict'
import {
  sydneyWallToUtcMs, noticeFor, noticeLabel, noticeLevel, validateCancel, rowSessionDates, rowTime, coachesFor, cancelId, noticeSummary,
  REASONS, NOTE_MAX, LATE_MINUTES, VERY_LATE_MINUTES,
} from '../api/_jfp-cancel.js'
import { normaliseConfig, cleanPhone, formatPhone } from '../api/_jfp-store.js'

let passed = 0
const queue = []
function test(name, fn) { queue.push([name, fn]) }
const config = normaliseConfig({})
const iso = (s) => Date.parse(s)
const row = { id: 'rec0001', player: 'Riley Returning', day: 'Tuesday', time: '4:20pm', location: 'Belrose HQ', coach: 'Sam Yorks', notes: '', paymentType: 'JFP 10 weeks', groupId: 'tue-1620-belrose-hq' }
const group = { id: 'tue-1620-belrose-hq', day: 'Tuesday', time: '4:20pm', coachId: 'sam', extraCoachIds: [] }
// Friday 9 Oct 2026, 10:00 in Sydney (AEDT, UTC+11).
const NOW = iso('2026-10-08T23:00:00Z')

test('a Sydney wall time becomes the right UTC instant on either side of daylight saving', () => {
  assert.equal(new Date(sydneyWallToUtcMs('2026-10-13', '16:20')).toISOString(), '2026-10-13T05:20:00.000Z') // AEDT, +11
  assert.equal(new Date(sydneyWallToUtcMs('2026-06-10', '16:20')).toISOString(), '2026-06-10T06:20:00.000Z') // AEST, +10
  // The change days themselves: before and after the clocks move.
  assert.equal(new Date(sydneyWallToUtcMs('2026-04-05', '01:30')).toISOString(), '2026-04-04T14:30:00.000Z') // still AEDT
  assert.equal(new Date(sydneyWallToUtcMs('2026-04-05', '10:00')).toISOString(), '2026-04-05T00:00:00.000Z') // AEST
  assert.equal(new Date(sydneyWallToUtcMs('2026-10-04', '01:30')).toISOString(), '2026-10-03T15:30:00.000Z') // still AEST
  assert.equal(new Date(sydneyWallToUtcMs('2026-10-04', '10:00')).toISOString(), '2026-10-03T23:00:00.000Z') // AEDT
})

test('notice is measured in real time across the end of daylight saving (April)', () => {
  // Sat 4 Apr 8pm AEDT to Mon 6 Apr 6:15am AEST: 35h15, not the 34h15 the wall clocks show.
  const n = noticeFor({ date: '2026-04-06', time: '6:15am', nowMs: iso('2026-04-04T09:00:00Z') })
  assert.equal(n.minutes, 35 * 60 + 15)
  assert.equal(n.level, 'ok')
  assert.equal(noticeLabel(n.minutes), '35 h notice')
})

test('notice is measured in real time across the start of daylight saving (October)', () => {
  // Sat 3 Oct 8pm AEST to Mon 5 Oct 6:15am AEDT: 33h15, not 34h15.
  const n = noticeFor({ date: '2026-10-05', time: '6:15am', nowMs: iso('2026-10-03T10:00:00Z') })
  assert.equal(n.minutes, 33 * 60 + 15)
})

test('notice for a normal upcoming session is hours, to the minute', () => {
  const n = noticeFor({ date: '2026-10-13', time: '4:20pm', nowMs: NOW })
  assert.equal(n.minutes, 6140)
  assert.equal(n.hours, 102.3)
  assert.equal(noticeLabel(n.minutes), '102 h notice')
})

test('a session earlier today has already started: negative notice', () => {
  // Tue 13 Oct, 8am in Sydney. The 6:15am session is over, the 5:25pm one is not.
  const now = iso('2026-10-12T21:00:00Z')
  assert.ok(noticeFor({ date: '2026-10-13', time: '6:15am', nowMs: now }).minutes < 0)
  const later = noticeFor({ date: '2026-10-13', time: '5:25pm', nowMs: now })
  assert.equal(later.minutes, 9 * 60 + 25)
  assert.equal(later.level, 'late')
  assert.equal(noticeLabel(later.minutes), 'late: 9 h')
})

test('late and very late are flagged at 24 hours and 2 hours', () => {
  assert.equal(noticeLevel(LATE_MINUTES), 'ok')
  assert.equal(noticeLevel(LATE_MINUTES - 1), 'late')
  assert.equal(noticeLevel(VERY_LATE_MINUTES), 'late')
  assert.equal(noticeLevel(VERY_LATE_MINUTES - 1), 'very-late')
  assert.equal(noticeLabel(26 * 60), '26 h notice')
  assert.equal(noticeLabel(24 * 60), '24 h notice')
  assert.equal(noticeLabel(24 * 60 - 1), 'late: 23 h')
  assert.equal(noticeLabel(120), 'late: 2 h')
  assert.equal(noticeLabel(90), 'late: 90 min')
  assert.equal(noticeLabel(-5), 'late: 0 min')
})

test('an unreadable time gives no notice rather than a wrong one', () => {
  assert.equal(noticeFor({ date: '2026-10-13', time: 'after school', nowMs: NOW }), null)
  assert.equal(noticeFor({ date: 'tomorrow', time: '4pm', nowMs: NOW }), null)
})

const ok = (over = {}) => validateCancel({ config, row, group, date: '2026-10-13', reason: 'sick', note: '', nowMs: NOW, ...over })

test('a valid request passes and carries the time and notice', () => {
  const v = ok()
  assert.equal(v.ok, true)
  assert.equal(v.time, '4:20pm')
  assert.equal(v.notice.minutes, 6140)
})

test('the reason must be one of the four', () => {
  assert.deepEqual(Object.values(REASONS), ['Sick or injured', 'School or exams', 'Family or travel', 'Other'])
  assert.equal(ok({ reason: '' }).ok, false)
  assert.equal(ok({ reason: 'bored' }).ok, false)
  assert.equal(ok({ reason: 'school' }).ok, true)
  assert.equal(ok({ reason: 'family' }).ok, true)
})

test('Other needs a few words; every other reason can go without', () => {
  assert.equal(ok({ reason: 'other', note: '' }).ok, false)
  assert.equal(ok({ reason: 'other', note: 'ab' }).ok, false)
  assert.equal(ok({ reason: 'other', note: 'Gran visiting' }).ok, true)
})

test('the note is capped and cleaned', () => {
  const v = ok({ note: `${'x'.repeat(900)}` })
  assert.equal(v.note.length, NOTE_MAX)
  assert.equal(ok({ note: 'line one\u0000\u0007 line two' }).note, 'line one   line two')
})

test('only real session dates of the row are accepted', () => {
  // Tuesdays from 13 Oct. Wednesday 14 Oct is not this group's day.
  assert.equal(ok({ date: '2026-10-14' }).code, 'not_a_session')
  assert.equal(ok({ date: '2026-10-13' }).ok, true)
  assert.equal(ok({ date: '2026-12-15' }).ok, true) // week 10
  assert.equal(ok({ date: '2026-12-22' }).code, 'not_a_session') // week 11 does not exist
  assert.equal(ok({ date: 'not a date' }).ok, false)
  assert.equal(ok({ date: '' }).ok, false)
})

test('skipped dates (public holidays) are not sessions', () => {
  const c = normaliseConfig({ skipDates: [{ date: '2026-10-20', reason: 'Holiday' }] })
  assert.equal(validateCancel({ config: c, row, group, date: '2026-10-20', reason: 'sick', nowMs: NOW }).code, 'not_a_session')
  assert.equal(validateCancel({ config: c, row, group, date: '2026-10-27', reason: 'sick', nowMs: NOW }).ok, true)
})

test('a mid term joiner can only cancel from their start date', () => {
  const joiner = { ...row, notes: 'Joining from 2026-10-27' }
  assert.deepEqual(rowSessionDates(config, joiner, group).slice(0, 2), ['2026-10-27', '2026-11-03'])
  assert.equal(validateCancel({ config, row: joiner, group, date: '2026-10-20', reason: 'sick', nowMs: NOW }).code, 'not_a_session')
  assert.equal(validateCancel({ config, row: joiner, group, date: '2026-10-27', reason: 'sick', nowMs: NOW }).ok, true)
})

test('a trial player can only cancel the trial date', () => {
  const trial = { ...row, paymentType: 'JFP Trial', notes: 'Trial offered for 2026-10-20' }
  assert.deepEqual(rowSessionDates(config, trial, group), ['2026-10-20'])
  assert.equal(validateCancel({ config, row: trial, group, date: '2026-10-27', reason: 'sick', nowMs: NOW }).code, 'not_a_session')
  assert.equal(validateCancel({ config, row: trial, group, date: '2026-10-20', reason: 'sick', nowMs: NOW }).ok, true)
})

test('a session that has started or passed is refused', () => {
  // Tue 13 Oct 4:30pm: ten minutes into the 4:20pm session.
  const late = iso('2026-10-13T05:30:00Z')
  assert.equal(ok({ nowMs: late }).code, 'past')
  // One minute before it starts is still fine, and very late.
  const v = ok({ nowMs: iso('2026-10-13T05:19:00Z') })
  assert.equal(v.ok, true)
  assert.equal(v.notice.level, 'very-late')
  assert.equal(ok({ nowMs: iso('2026-10-20T00:00:00Z'), date: '2026-10-13' }).code, 'past')
})

test('no row means no cancellation', () => {
  assert.equal(validateCancel({ config, row: null, group, date: '2026-10-13', reason: 'sick', nowMs: NOW }).status, 404)
})

test('the group time wins over the row time, the row is the fallback', () => {
  assert.equal(rowTime(row, { time: '5:25pm' }), '5:25pm')
  assert.equal(rowTime(row, null), '4:20pm')
  assert.equal(rowTime(row, { time: '' }), '4:20pm')
})

test('the same row and date always make the same id, anything else a different one', () => {
  assert.equal(cancelId('rec1', '2026-10-13'), cancelId('rec1', '2026-10-13'))
  assert.notEqual(cancelId('rec1', '2026-10-13'), cancelId('rec1', '2026-10-20'))
  assert.notEqual(cancelId('rec1', '2026-10-13'), cancelId('rec2', '2026-10-13'))
  assert.match(cancelId('rec1', '2026-10-13'), /^CXL-[0-9A-F]{16}$/)
})

test('coaches told: the group coach, extras and cover, once each', () => {
  assert.deepEqual(coachesFor(config, row, { ...group, coachId: 'lee', extraCoachIds: ['luke'] }).map((c) => c.id), ['lee', 'luke'])
  assert.deepEqual(coachesFor(config, row, { ...group, coachId: 'lee', extraCoachIds: ['luke'] }, 'luke').map((c) => c.id), ['lee', 'luke'])
  assert.deepEqual(coachesFor(config, row, group, 'ruby').map((c) => c.id), ['sam', 'ruby'])
  assert.deepEqual(coachesFor(config, row, null).map((c) => c.id), ['sam']) // no group: the row's Airtable coach
  assert.deepEqual(coachesFor(config, { ...row, coach: '' }, null), [])
  assert.deepEqual(coachesFor(config, row, { ...group, coachId: 'ghost' }), [])
})

test('coach phone numbers are cleaned, validated and formatted', () => {
  assert.equal(cleanPhone('0411 222 333'), '0411222333')
  assert.equal(cleanPhone('+61 411 222 333'), '+61411222333')
  assert.equal(cleanPhone('(02) 9876-5432'), '0298765432')
  assert.equal(cleanPhone(''), '')
  assert.equal(cleanPhone('call me'), '')
  assert.equal(cleanPhone('123'), '')
  assert.equal(cleanPhone('1'.repeat(20)), '')
  assert.equal(cleanPhone('<script>0411222333'), '')
  assert.equal(formatPhone('0411222333'), '0411 222 333')
  assert.equal(formatPhone('+61411222333'), '+61 411 222 333')
  assert.equal(formatPhone('0298765432'), '0298765432')
})

test('coaches keep a phone only when it is valid, and older saved config still loads', () => {
  const c = normaliseConfig({ coaches: [{ id: 'sam', name: 'Sam', phone: '0411 222 333', email: 'sam@example.com' }, { id: 'dean', name: 'Dean', phone: 'banana' }, { id: 'ruby', name: 'Ruby' }], coachSeed: 2 })
  assert.equal(c.coaches.find((x) => x.id === 'sam').phone, '0411222333')
  assert.equal(c.coaches.find((x) => x.id === 'dean').phone, '')
  assert.equal(c.coaches.find((x) => x.id === 'ruby').phone, '')
  // The built in defaults carry no invented numbers.
  assert.ok(normaliseConfig({}).coaches.every((x) => x.phone === ''))
  // A config saved before phones existed (and before the latest seed) keeps working.
  const old = normaliseConfig({ coaches: [{ id: 'sam', name: 'Sam', email: 'sam@example.com' }], coachSeed: 1 })
  assert.equal(old.coaches.find((x) => x.id === 'sam').phone, '')
  assert.ok(old.coaches.length > 1)
})

test('the notice summary counts active cancellations only', () => {
  const s = noticeSummary([
    { status: 'active', noticeMinutes: 26 * 60 }, { status: 'active', noticeMinutes: 90 }, { status: 'active', noticeMinutes: 600 },
    { status: 'withdrawn', noticeMinutes: 5 },
  ])
  assert.equal(s.total, 3)
  assert.equal(s.under24, 2)
  assert.equal(s.under2, 1)
  assert.equal(s.medianHours, 10)
  assert.equal(s.averageHours, 12.5)
  assert.deepEqual(noticeSummary([]), { total: 0, under24: 0, under2: 0, averageHours: 0, medianHours: 0 })
})

for (const [name, fn] of queue) { await fn(); passed += 1; console.log(`ok - ${name}`) }
console.log(`${passed} passed`)
