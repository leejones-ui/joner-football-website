// Joners Juniors stage 3, without a server: classes (ids that match the
// timetable, which class a child is in, the checks on a save), keeping the
// timetable in step, the website's class choice and per-class full check,
// who gets a message, and the message email. Every name is invented.
//   node scripts/test-jj-stage3.mjs
import assert from 'node:assert/strict'
import { normaliseJuniors, validateJuniors, slotId, classForRow, classFromChoice, classLabelFor, juniorsDates, juniorsPublic } from '../api/_jj-config.js'
import { groupId, normaliseConfig } from '../api/_jfp-store.js'
import { syncTimetable, timetableState, durationOf } from '../api/_jj-classes.js'
import { choiceFull } from '../api/_jj-requests.js'
import { juniorsTerms, normaliseRegistration } from '../api/_juniors-flow.js'
import { inAudience } from '../api/_jj-messages.js'
import { jjMessageEmail } from '../api/_jj-email.js'
import { needsList } from '../api/_jj-portal.js'

let passed = 0
const test = async (n, fn) => { await fn(); passed += 1; console.log(`ok - ${n}`) }
const A = { id: 'sat-0915-belrose', day: 'Saturday', time: '9:15am', endTime: '10:00am', location: 'Belrose HQ', capacity: 12, coachId: 'sam', shadowCoachId: 'ruby' }
const B = { id: 'sat-1015-belrose', day: 'Saturday', time: '10:15am', endTime: '11:00am', location: 'Belrose HQ', capacity: 2, coachId: 'lee', shadowCoachId: '' }
const two = normaliseJuniors({ classes: [A, B] })

await test('a class has the same id as its timetable group, and a shadow coach', () => {
  for (const [d, t, l] of [['Saturday', '9:15am', 'Belrose HQ'], ['Monday', '4:20pm', 'North Turramurra'], ['Sunday', '10am', 'Rydalmere Park']]) assert.equal(slotId(d, t, l), groupId(d, t, l))
  assert.equal(normaliseJuniors({}).classes[0].shadowCoachId, '')
  assert.equal(two.classes[0].shadowCoachId, 'ruby')
  assert.equal(durationOf(A), 45)
})

await test('which class a child is in: with one class every child; with two, by the day, time and place on the row', () => {
  const one = normaliseJuniors({ classes: [A] })
  assert.equal(classForRow(one, { day: '', time: '', location: '' }).id, A.id, 'one class: everyone is in it, as before')
  assert.equal(classForRow(two, { day: 'Saturday', time: '10:15am', location: 'Belrose HQ' }).id, B.id)
  assert.equal(classForRow(two, { day: 'Saturday', time: '9:15 AM', location: 'Belrose HQ' }).id, A.id)
  assert.equal(classForRow(two, { day: 'Sunday', time: '9:15am', location: 'Belrose HQ' }), null, 'no match: in no class (shown on Classes)')
  assert.equal(classLabelFor(two, B), 'Saturday 10:15am to 11:00am')
  assert.equal(classLabelFor(normaliseJuniors({ classes: [A], classLabel: 'Saturday mornings' }), A), 'Saturday mornings', 'one class keeps the label from Settings')
  assert.equal(classLabelFor(normaliseJuniors({ classes: [A, B], classLabel: 'Saturday mornings' }), B), 'Saturday 10:15am to 11:00am', 'two classes each say their own time')
})

await test('saving classes: two at the same time and place, the same coach twice, and repeated ids are caught', () => {
  assert.equal(validateJuniors({ classes: [A, { ...B, time: '9:15am' }] }).ok, false)
  assert.match(validateJuniors({ classes: [A, { ...B, time: '9:15am' }] }).errors.join(' '), /same day, time and place/)
  assert.match(validateJuniors({ classes: [{ ...A, shadowCoachId: 'sam' }] }).errors.join(' '), /two people/)
  const v = validateJuniors({ classes: [A, { ...B, id: A.id }] })
  assert.equal(v.ok, true)
  assert.deepEqual(v.juniors.classes.map((c) => c.id), ['sat-0915-belrose', 'sat-0915-belrose-2'], 'each class keeps its own id')
  assert.equal(validateJuniors({ classes: [{ ...B, id: '' }] }).juniors.classes[0].id, 'sat-1015', 'a new class gets an id from its day and time')
})

await test('each class has its own dates (the Juniors term, less days off)', () => {
  const jj = normaliseJuniors({ termStart: '2026-10-12', weeks: 3, skipDates: [{ date: '2026-10-24', reason: 'Long weekend' }], classes: [A, { ...B, day: 'Sunday' }] })
  assert.deepEqual(juniorsDates(jj, jj.classes[0]), ['2026-10-17', '2026-10-31'])
  assert.deepEqual(juniorsDates(jj, jj.classes[1]), ['2026-10-18', '2026-10-25', '2026-11-01'])
})

// A pretend timetable for syncTimetable.
function timetable(start = []) {
  const groups = new Map(start.map((g) => [g.id, g]))
  return { groups, deps: { listGroups: async () => [...groups.values()], saveGroup: async (g) => { groups.set(g.id, g) }, deleteGroup: async (id) => { groups.delete(id) } } }
}
const config = (classes) => ({ ...normaliseConfig({}), juniors: normaliseJuniors({ classes }) })
const me = { email: 'staff@example.com', name: 'Staff' }

await test('the timetable is kept in step: made, changed, moved with the class, and taken off with it', async () => {
  const t = timetable([{ id: 'mon-1620-belrose-hq', day: 'Monday', time: '4:20pm', location: 'Belrose HQ', label: 'Small group', capacity: 6, coachId: 'dean', mode: 'book' }])
  let r = await syncTimetable(config([A]), null, me, t.deps)
  assert.deepEqual(r.created, ['sat-0915-belrose-hq'])
  const g = t.groups.get('sat-0915-belrose-hq')
  assert.deepEqual([g.label, g.coachId, g.extraCoachIds, g.capacity, g.durationMin, g.mode], ['Joners Juniors', 'sam', ['ruby'], 12, 45, 'closed'])
  assert.equal(timetableState([...t.groups.values()], A).ok, true)
  // Places and the shadow coach change; a second class is added.
  const before = normaliseJuniors({ classes: [A] })
  r = await syncTimetable(config([{ ...A, capacity: 14, shadowCoachId: '' }, B]), before, me, t.deps)
  assert.deepEqual([r.updated, r.created], [['sat-0915-belrose-hq'], ['sat-1015-belrose-hq']])
  assert.deepEqual([t.groups.get('sat-0915-belrose-hq').capacity, t.groups.get('sat-0915-belrose-hq').extraCoachIds], [14, []])
  // Class B moves to 11:15am: its group moves with it (same class id).
  r = await syncTimetable(config([A, { ...B, time: '11:15am', endTime: '12:00pm' }]), normaliseJuniors({ classes: [A, B] }), me, t.deps)
  assert.ok(t.groups.has('sat-1115-belrose-hq') && !t.groups.has('sat-1015-belrose-hq'))
  // B goes: its group comes off. The JFP group is never touched.
  r = await syncTimetable(config([A]), normaliseJuniors({ classes: [A, { ...B, time: '11:15am' }] }), me, t.deps)
  assert.deepEqual(r.removed, ['sat-1115-belrose-hq'])
  assert.ok(t.groups.has('mon-1620-belrose-hq'))
  assert.equal(t.groups.get('mon-1620-belrose-hq').label, 'Small group')
})

await test('a JFP group already at that time and place: the Juniors class is not put over it', async () => {
  const t = timetable([{ id: 'sat-0915-belrose-hq', day: 'Saturday', time: '9:15am', location: 'Belrose HQ', label: 'Small group', capacity: 6, coachId: 'dean', mode: 'book' }])
  const r = await syncTimetable(config([A]), null, me, t.deps)
  assert.equal(r.created.length, 0)
  assert.match(r.problems[0], /A JFP group already runs at Saturday 9:15am Belrose HQ/)
  assert.equal(t.groups.get('sat-0915-belrose-hq').label, 'Small group')
})

await test('the website: the class picked (by id or by its words), and full means that class', () => {
  assert.equal(classFromChoice(two, 'sat-1015-belrose').id, B.id)
  assert.equal(classFromChoice(two, 'Saturday 10:15am').id, B.id)
  assert.equal(classFromChoice(two, '').id, A.id)
  const t = juniorsTerms(two, 'sat-1015-belrose')
  assert.deepEqual([t.day, t.time, t.classLocation, t.className, t.coachId], ['Saturday', '10:15am', 'Belrose HQ', 'Saturday 10:15am to 11:00am', 'lee'])
  const reg = normaliseRegistration({ playerFullName: 'Kid Test', numberOfDays: 'sat-1015-belrose' }, new Date('2026-10-13T00:00:00Z'), two)
  assert.deepEqual([reg.time, reg.className], ['10:15am', 'Saturday 10:15am to 11:00am'])
  const count = { full: false, classes: [{ id: A.id, full: false }, { id: B.id, full: true }] }
  assert.equal(choiceFull({ juniors: two }, count, 'sat-1015-belrose'), true)
  assert.equal(choiceFull({ juniors: two }, count, 'sat-0915-belrose'), false)
  assert.equal(choiceFull({ juniors: two }, null, 'sat-1015-belrose'), false, 'not known: not full (the sign-up checks again)')
  assert.deepEqual(juniorsPublic(two).classes.map((c) => [c.id, c.capacity]), [[A.id, 12], [B.id, 2]])
})

await test('who gets a message: the whole class, who still owes, no waiver, one family', () => {
  const f = { email: 'a@example.com', children: [{ classId: A.id, pay: 'paid', waiver: true }, { classId: B.id, pay: 'part', waiver: false, waiverUnknown: false }] }
  const g = { email: 'b@example.com', children: [{ classId: A.id, pay: 'paid', waiver: false, waiverUnknown: true }] }
  assert.deepEqual([inAudience(f, 'class', { classId: B.id }), inAudience(g, 'class', { classId: B.id })], [true, false])
  assert.deepEqual([inAudience(f, 'unpaid'), inAudience(g, 'unpaid')], [true, false])
  assert.deepEqual([inAudience(f, 'waiver'), inAudience(g, 'waiver')], [true, false], 'a waiver that could not be checked is not "no waiver"')
  assert.deepEqual([inAudience(f, 'one', { email: 'a@example.com' }), inAudience(g, 'one', { email: 'a@example.com' })], [true, false])
})

await test('the message email: the parent by name, what staff wrote (made safe), the child\'s class and next class', () => {
  const e = jjMessageEmail({ parentName: 'Pat Parent', children: [{ name: 'Kid <Test>', classId: B.id }], jj: two, subject: 'No class <this> Saturday', text: 'The hall is closed.\nSee you next week.\n\n<script>x</script>', signInUrl: 'https://example.com/jfp-account/', email: 'pat@example.com', nextDate: 'Sat 24 Oct' })
  assert.equal(e.subject, 'No class <this> Saturday')
  assert.match(e.html, /Hi Pat,/)
  assert.match(e.html, /The hall is closed\.<br>See you next week\./)
  assert.ok(!e.html.includes('<script>') && e.html.includes('&lt;script&gt;'))
  assert.match(e.html, /Kid &lt;Test&gt;/)
  assert.match(e.html, /Saturday 10:15am to 11:00am/)
  assert.match(e.html, /Next class.*Sat 24 Oct/s)
  assert.match(e.html, /Open your account/)
  assert.ok(!/—/.test(e.html), 'no em dashes')
  assert.ok(!jjMessageEmail({ parentName: 'P', children: [], jj: two, subject: 'S', text: 'Hello there', signInUrl: '' }).html.includes('Open your account'), 'no button when not asked')
})

await test('needs you: a full class by name, children in no class, and children missing two or more in a row', () => {
  const o = { current: true, moneyError: '', waiversUnknown: false, counts: { all: 3, paid: 3, part: 0, unpaid: 0, noprice: 0, noWaiver: 0, removed: 0 }, summary: { enrolled: 3, capacity: 14 }, classes: [{ label: 'Saturday 9:15am to 10:00am', capacity: 12, enrolled: 1 }, { label: 'Saturday 10:15am to 11:00am', capacity: 2, enrolled: 2 }], unplaced: 1, attendance: { streaks: [{ name: 'Kid' }] } }
  const n = needsList(o, { registrationOpen: true })
  assert.deepEqual(n.map((x) => x.kind), ['full', 'unplaced', 'missing'])
  assert.equal(n[0].label, 'Saturday 10:15am to 11:00am is full (2 of 2)')
  assert.deepEqual(n.map((x) => x.tab), ['jj-classes', 'jj-classes', 'jj-registers'])
})

console.log(`\n${passed} Joners Juniors stage 3 checks passed`)
