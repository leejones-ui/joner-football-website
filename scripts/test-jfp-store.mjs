// Pure-function checks for JFP term bookings. No network, no KV.
import assert from 'node:assert/strict'
import { to24h, sessionDates, dateLabel, groupId, validateGroup, placesLeft, normaliseConfig, HOLD_SCRIPT, ageOn, ageFits, locationFor, signParentCookie, hasParentAccess, priceFor, periodOf, sydneyToday } from '../api/_jfp-store.js'
import { draftGroupsFromRoster, draftAgeBand, waiverFor, familyFor, placeInGroups } from '../api/_jfp-airtable.js'
import { splitFee, splitBy } from '../api/_jfp-finalise.js'
import { roleFor } from '../api/_jfp-people.js'
import { publicGroup } from '../api/jfp-groups.js'
import { buildIcs } from '../api/_jfp-email.js'

let passed = 0
const queue = []
function test(name, fn) { queue.push([name, fn]) }
const config = normaliseConfig({})

test('times read the way the roster writes them', () => {
  assert.equal(to24h('4:20pm'), '16:20')
  assert.equal(to24h('6:30am'), '06:30')
  assert.equal(to24h('12pm'), '12:00')
  assert.equal(to24h('10:15am'), '10:15')
  assert.equal(to24h('nonsense'), '')
})

test('ten weekly dates from the Monday 12 October term start', () => {
  const mon = sessionDates(config, 'Monday')
  assert.equal(mon.length, 10)
  assert.equal(mon[0], '2026-10-12')
  assert.equal(mon[9], '2026-12-14')
  assert.equal(sessionDates(config, 'Saturday')[0], '2026-10-17')
  assert.equal(dateLabel('2026-10-14'), 'Wed 14 Oct')
})

test('group ids are stable and readable', () => {
  assert.equal(groupId('Wednesday', '5:25pm', 'Belrose HQ'), 'wed-1725-belrose-hq')
  assert.equal(groupId('Friday', '6:30am', 'Rydalmere'), 'fri-0630-rydalmere')
})

test('ages are taken on the first day of term', () => {
  assert.equal(ageOn('2016-10-12', '2026-10-12'), 10)
  assert.equal(ageOn('2016-10-13', '2026-10-12'), 9)
  assert.equal(ageOn('', '2026-10-12'), null)
  const g = { minAge: 8, maxAge: 11 }
  assert.equal(ageFits(g, 8, config), true)
  assert.equal(ageFits(g, 12, config), false)
  assert.equal(ageFits({ minAge: null, maxAge: null }, 18, config), true)
  assert.equal(ageFits({ minAge: null, maxAge: null }, 25, config), false)
})

test('draft age bands sit one year either side of who is there', () => {
  assert.deepEqual(draftAgeBand([9, 10, 9, null], config), { minAge: 8, maxAge: 11 })
  assert.deepEqual(draftAgeBand([], config), { minAge: null, maxAge: null })
  assert.deepEqual(draftAgeBand([6, 19], config), { minAge: 6, maxAge: 19 })
})

test('group validation keeps bands, labels and the girls flag honest', () => {
  const ok = validateGroup({ day: 'Monday', time: '4:20pm', location: 'Belrose HQ', capacity: 6, mode: 'direct', minAge: 7, maxAge: 9, girlsOnly: 'suggested', label: 'Small group' }, config)
  assert.equal(ok.ok, true)
  assert.equal(ok.group.id, 'mon-1620-belrose-hq')
  assert.equal(ok.group.girlsOnly, 'suggested')
  assert.equal(ok.group.ageStatus, 'draft')
  assert.equal(validateGroup({ day: 'Monday', time: '4:20pm', location: 'Belrose HQ', capacity: 6, mode: 'direct', minAge: 12, maxAge: 9 }, config).ok, false)
  assert.equal(validateGroup({ day: 'Monday', time: '4:20pm', location: 'Belrose HQ', capacity: 6, mode: 'weird' }, config).ok, false)
})

test('places left never counts below zero and includes both sources', () => {
  assert.equal(placesLeft({ capacity: 6 }, 4, 1), 1)
  assert.equal(placesLeft({ capacity: 6 }, 6, 2), 0)
  assert.equal(placesLeft({ capacity: 6 }, 0, 0), 6)
})

test('the hold script resizes a booking in one step and never over-fills', () => {
  assert.ok(HOLD_SCRIPT.indexOf('ZREMRANGEBYSCORE') < HOLD_SCRIPT.indexOf('ZCARD'))
  assert.match(HOLD_SCRIPT, /ZCARD', KEYS\[1\]\) - own \+ want > tonumber\(ARGV\[2\]\)/)
})

test('first set-up drafts only what the records justify', () => {
  const players = [
    { groupId: 'mon-1620-belrose-hq', day: 'Monday', time: '4:20pm', location: 'Belrose HQ', holdsPlace: true, coach: 'Dean Mac', paymentType: 'JFP 10 weeks' },
    { groupId: 'fri-1600-belrose-hq', day: 'Friday', time: '4pm', location: 'Belrose HQ', holdsPlace: true, coach: 'Dean Mac', paymentType: 'JFP Pathway 10 weeks' },
    { groupId: 'fri-0630-rydalmere', day: 'Friday', time: '6:30am', location: 'Rydalmere', holdsPlace: true, coach: 'Lee Jones', paymentType: 'JFP 10 weeks' },
    { groupId: 'mon-1300-belrose-hq', day: 'Monday', time: '1pm', location: 'Belrose HQ', holdsPlace: true, coach: 'Dean Mac', paymentType: 'JFP 1 on 1, 10 weeks' },
  ]
  const d = Object.fromEntries(draftGroupsFromRoster(players, config).map((g) => [g.id, g]))
  assert.equal(d['mon-1620-belrose-hq'].mode, 'direct')
  assert.equal(d['fri-1600-belrose-hq'].mode, 'application')
  assert.equal(d['fri-0630-rydalmere'].label, 'Squad')
  assert.equal(d['mon-1300-belrose-hq'].mode, 'enquire')
})

test('a waiver matches on name plus the family email or mobile, never on a shared name alone', () => {
  const waivers = [
    { id: 'w1', player: 'Sam Smith', email: 'a@x.com', mobile: '0400 111 222', accepted: true },
    { id: 'w2', player: 'Sam Smith', email: 'b@x.com', mobile: '', accepted: true },
    { id: 'w3', player: 'Only One', email: 'old@x.com', mobile: '', accepted: true },
  ]
  assert.equal(waiverFor('Sam Smith', { emails: ['a@x.com'], phones: [] }, waivers).id, 'w1')
  assert.equal(waiverFor('Sam Smith', { emails: ['c@x.com'], phones: ['+61 400 111 222'] }, waivers).id, 'w1')
  assert.equal(waiverFor('Sam Smith', { emails: ['c@x.com'], phones: [] }, waivers), null)
  assert.equal(waiverFor('only one', { emails: ['new@x.com'], phones: [] }, waivers).id, 'w3')
  // Spelling differences inside one family are accepted; siblings are not.
  const fam = [
    { id: 's1', player: 'Unish Shrestha', email: 'f@x.com', mobile: '', accepted: true },
    { id: 's2', player: 'Luka Tredway', email: 'f@x.com', mobile: '', accepted: true },
    { id: 's3', player: 'Charlotte Roberts', email: 'f@x.com', mobile: '', accepted: true },
  ]
  assert.equal(waiverFor('Unish Srestha', { emails: ['f@x.com'], phones: [] }, fam).id, 's1')
  assert.equal(waiverFor('Charlie Roberts', { emails: ['f@x.com'], phones: [] }, fam).id, 's3')
  assert.equal(waiverFor('Ryda Tredway', { emails: ['f@x.com'], phones: [] }, fam), null)
  assert.equal(waiverFor('Unish Srestha', { emails: ['other@x.com'], phones: [] }, fam), null, 'another family never borrows a waiver')
})

test('a family sees only rows with its own email', () => {
  const roster = {
    players: [{ player: 'Kid A', email: 'mum@x.com', phone: '', term4: [], dob: '2015-01-01', ageFromNotes: null, groupId: 'g', holdsPlace: true }, { player: 'Kid B', email: 'other@x.com', phone: '', dob: '', ageFromNotes: null }],
    term3: [{ id: 't3', player: 'Kid C', emails: ['mum@x.com'], phone: '', dob: '2016-01-01' }],
    waivers: [],
  }
  const f = familyFor('Mum@X.com', roster, '2026-10-12')
  assert.deepEqual(f.players.map((p) => p.name), ['Kid A', 'Kid C'])
  assert.equal(f.players[0].age, 11)
})

test('roles come from config on every request', () => {
  assert.equal(roleFor('LeeJones@JonerFootball.com', config).role, 'admin')
  assert.equal(roleFor('jonerfootballdean@gmail.com', config), null, 'coach logins are off by default')
  assert.equal(roleFor('jonerfootballdean@gmail.com', { ...config, coachLoginsEnabled: true }).coachId, 'dean')
  assert.equal(roleFor('parent@x.com', config), null)
  assert.deepEqual(normaliseConfig({ superAdmins: [] }).superAdmins, config.superAdmins, 'the admin list can never be emptied')
})

test('the public group shape carries no people and no money', () => {
  const g = publicGroup({ id: 'x', day: 'Monday', time: '4:20pm', location: 'Belrose HQ', coachId: 'dean', mode: 'direct', capacity: 6, durationMin: 60, minAge: 8, maxAge: 11, girlsOnly: 'suggested', label: 'Small group' }, config, 3)
  assert.equal(g.placesLeft, 3)
  assert.equal(g.girlsOnly, false, 'a suggested girls flag is not shown until confirmed')
  assert.equal(g.locationId, 'belrose')
  assert.deepEqual(Object.keys(g).filter((k) => /email|phone|player|parent|price|cents/i.test(k)), [])
  assert.equal(g.period, 'pm')
  const apply = publicGroup({ id: 'y', day: 'Friday', time: '6:30am', location: 'Rydalmere', coachId: 'lee', mode: 'application', capacity: 8, durationMin: 60, label: 'Squad', questions: ['club', 'team'] }, config, 0)
  assert.equal(apply.full, true, 'an apply group with no places left shows fully booked')
  assert.equal(apply.placesLeft, 0)
  assert.equal(apply.period, 'am')
  assert.deepEqual(apply.questions.map((q) => q.key), ['club', 'team'])
})

test('pro rata: joining mid term pays for the sessions left, siblings pay the two place rate', () => {
  const full = priceFor(config, { product: 'group', day: 'Monday', fromIso: '2026-10-12' })
  assert.equal(full.unitCents, 85000)
  assert.equal(full.proRata, false)
  const wk4 = priceFor(config, { product: 'group', day: 'Monday', fromIso: '2026-11-02' })
  assert.equal(wk4.sessions, 7)
  assert.equal(wk4.unitCents, 59500, 'A$850 x 7/10')
  const sib = priceFor(config, { product: 'group', day: 'Monday', fromIso: '2026-10-12', players: 2 })
  assert.equal(sib.unitCents, 75000)
  assert.equal(sib.totalCents, 150000)
  assert.equal(sib.type, 'Sibling / 2 sessions per week')
  assert.equal(priceFor(config, { product: 'trial', day: 'Monday', fromIso: '2026-12-14' }).unitCents, 8500, 'a trial is never pro rata')
  assert.equal(priceFor(config, { product: 'pathway', day: 'Friday', fromIso: '2026-10-16' }).unitCents, 45000)
  assert.equal(priceFor(normaliseConfig({ prices: { group: 90000 } }), { product: 'group', day: 'Monday' }).unitCents, 90000)
  assert.equal(priceFor(normaliseConfig({ priceCents: 80000 }), { product: 'group', day: 'Monday' }).unitCents, 80000, 'an old saved term price still counts')
  assert.match(sydneyToday(Date.parse('2026-10-11T14:30:00Z')), /^2026-10-12$/, 'Sydney is ahead of UTC')
})

test('morning sessions split by coach: each coach has a group, the Coach column decides', async () => {
  assert.equal(groupId('Friday', '6:30am', 'Rydalmere', 'lee'), 'fri-0630-rydalmere-lee')
  const v = validateGroup({ day: 'Friday', time: '6:30am', location: 'Rydalmere', coachId: 'dean', byCoach: true, capacity: 8, mode: 'application' }, config)
  assert.equal(v.group.id, 'fri-0630-rydalmere-dean')
  assert.equal(validateGroup({ day: 'Friday', time: '6:30am', location: 'Rydalmere', byCoach: true, capacity: 8, mode: 'application' }, config).ok, false)
  assert.equal(periodOf({ time: '10:15am' }), 'am')
  const groups = [{ id: 'fri-0630-rydalmere-lee' }, { id: 'fri-0630-rydalmere-dean' }, { id: 'mon-1620-belrose-hq' }]
  const row = (coach, day = 'Friday', time = '6:30am', location = 'Rydalmere') => ({ player: coach || 'x', coach, day, time, location, sessionId: groupId(day, time, location), groupId: groupId(day, time, location) })
  const r = await placeInGroups({ players: [row('Lee Jones'), row('Dean Mac'), row(''), row('Ruby Fanoosh'), row('Dean Mac', 'Monday', '4:20pm', 'Belrose HQ')] }, groups, config)
  assert.deepEqual(r.players.map((p) => p.groupId), ['fri-0630-rydalmere-lee', 'fri-0630-rydalmere-dean', 'fri-0630-rydalmere', 'fri-0630-rydalmere', 'mon-1620-belrose-hq'])
  // Typed a little differently in Airtable: still the right group.
  const full = [{ id: 'mon-1620-belrose-hq', day: 'Monday', time: '4:20pm', location: 'Belrose HQ' }, { id: 'fri-0630-rydalmere-lee', day: 'Friday', time: '6:30am', location: 'Rydalmere', byCoach: true, coachId: 'lee' }]
  const odd = await placeInGroups({ players: [row('Dean Mac', 'monday ', '4.20pm', 'Belrose'), row('Lee Jones', 'Friday', '06:30', 'Rydalmere Park')] }, full, config)
  assert.deepEqual(odd.players.map((p) => p.groupId), ['mon-1620-belrose-hq', 'fri-0630-rydalmere-lee'])
})

test('locations map the roster spellings', () => {
  assert.equal(locationFor(config, 'Belrose HQ').id, 'belrose')
  assert.equal(locationFor(config, 'NTRA').id, 'ntra')
  assert.equal(locationFor(config, 'Rydalmere').id, 'rydalmere')
})

test('the calendar file repeats weekly for the whole term', () => {
  const ics = buildIcs({ uid: 'JFP-1', group: { day: 'Tuesday', time: '4:20pm', location: 'Belrose HQ', durationMin: 60 }, config, title: 'JFP Tuesday 4:20pm' })
  assert.match(ics, /DTSTART;TZID=Australia\/Sydney:20261013T162000/)
  assert.match(ics, /DTEND;TZID=Australia\/Sydney:20261013T172000/)
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 10, 'one event per session')
  const off = buildIcs({ uid: 'x', group: { day: 'Monday', time: '4:20pm', location: 'Belrose HQ' }, config: normaliseConfig({ skipDates: [{ date: '2026-10-19', reason: 'Test holiday' }] }), title: 'JFP' })
  assert.equal((off.match(/BEGIN:VEVENT/g) || []).length, 9, 'a skipped week is not in the calendar')
  assert.ok(!off.includes('20261019'))
  assert.equal(priceFor(normaliseConfig({ skipDates: [{ date: '2026-10-19' }] }), { product: 'group', day: 'Monday', fromIso: '2026-11-02' }).unitCents, Math.round(85000 * 7 / 9 / 100) * 100, 'pro rata counts only real sessions')
})

test('a fee splits across players to the cent', () => {
  assert.deepEqual(splitFee(1519, 2), [760, 759])
  assert.equal(splitFee(null, 2), null)
  assert.deepEqual(splitBy(127500, [42500, 85000]), [42500, 85000], 'by what each still owes')
  assert.deepEqual(splitBy(100, [0, 0]), [50, 50])
  assert.equal(splitBy(1001, [1, 1, 1]).reduce((a, b) => a + b, 0), 1001)
})

test('the booking password cookie survives only while the password stays the same', () => {
  process.env.JFP_BOOKING_PASSWORD = 'one'
  const secret = 'secret'
  const t = signParentCookie({ secret })
  const req = { headers: { cookie: `jf_jfp=${t}` } }
  assert.equal(hasParentAccess(req, { secret }), true)
  process.env.JFP_BOOKING_PASSWORD = 'two'
  assert.equal(hasParentAccess(req, { secret }), false)
})

for (const [name, fn] of queue) { await fn(); passed += 1; console.log(`ok - ${name}`) }
console.log(`\n${passed} JFP store checks passed`)
