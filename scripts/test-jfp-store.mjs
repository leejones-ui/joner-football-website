// Pure-function checks for JFP term bookings. No network, no KV.
import assert from 'node:assert/strict'
import { to24h, sessionDates, dateLabel, groupId, validateGroup, placesLeft, normaliseConfig, HOLD_SCRIPT, EXTEND_SCRIPT, signParentCookie, hasParentAccess } from '../api/_jfp-store.js'
import { draftGroupsFromRoster } from '../api/_jfp-airtable.js'
import { splitFee } from '../api/_jfp-finalise.js'
import { publicGroup } from '../api/jfp-groups.js'

let passed = 0
function test(name, fn) { fn(); passed += 1; console.log(`ok - ${name}`) }
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

test('places left never counts below zero and includes both sources', () => {
  assert.equal(placesLeft({ capacity: 6 }, 4, 1), 1)
  assert.equal(placesLeft({ capacity: 6 }, 6, 2), 0)
  assert.equal(placesLeft({ capacity: 6 }, 0, 0), 6)
})

test('drafting from the roster opens only what the records justify', () => {
  const p = (day, time, location, coach, type, confirmation = 'Confirmed') => ({ day, time, location, groupId: groupId(day, time, location), coach, paymentType: type, confirmation, holdsPlace: confirmation !== 'Dropped' })
  const roster = [
    p('Monday', '4:20pm', 'Belrose HQ', 'Dean Mac', 'JFP 10 weeks'),
    p('Monday', '4:20pm', 'Belrose HQ', 'Dean Mac', 'JFP 10 weeks'),
    p('Friday', '4pm', 'Belrose HQ', 'Dean Mac', 'JFP Pathway 10 weeks'),
    p('Friday', '4pm', 'Belrose HQ', 'Sam Yorks', 'JFP Pathway 10 weeks'),
    p('Monday', '1pm', 'Belrose HQ', 'Dean Mac', 'JFP 1 on 1, 10 weeks'),
    p('Friday', '6:30am', 'Rydalmere', 'Luke Bakos', 'JFP 10 weeks'),
    p('Friday', '6:30am', 'Rydalmere', 'Lee Jones', 'JFP 10 weeks'),
    p('Wednesday', '11am', 'Belrose HQ', 'Dean Mac', 'JFP 10 weeks'),
    p('Tuesday', '6:30pm', 'Belrose HQ', 'Dean Mac', 'JFP 10 weeks', 'Dropped'),
  ]
  const byId = Object.fromEntries(draftGroupsFromRoster(roster, config).map((g) => [g.id, g]))
  assert.equal(byId['mon-1620-belrose-hq'].mode, 'direct')
  assert.equal(byId['mon-1620-belrose-hq'].capacity, 6)
  assert.equal(byId['mon-1620-belrose-hq'].coachId, 'dean')
  assert.equal(byId['fri-1600-belrose-hq'].mode, 'application', 'pathway stays by application even with two coaches')
  assert.equal(byId['mon-1300-belrose-hq'].mode, 'closed', '1 to 1 is never sold online')
  assert.equal(byId['fri-0630-rydalmere'].mode, 'closed', 'shared early squads stay closed')
  assert.equal(byId['fri-0630-rydalmere'].extraCoachIds.length, 1, 'second coach recorded')
  assert.equal(byId['wed-1100-belrose-hq'].mode, 'closed', 'school hours stay closed')
  assert.equal(byId['tue-1830-belrose-hq'], undefined, 'dropped players do not create a group')
})

test('group validation rejects bad input', () => {
  assert.equal(validateGroup({ day: 'Funday', time: '4:20pm', location: 'x', capacity: 6, mode: 'direct' }, config).ok, false)
  assert.equal(validateGroup({ day: 'Monday', time: '4:20pm', location: 'Belrose HQ', capacity: 6, mode: 'direct', coachId: 'dean' }, config).ok, true)
  assert.equal(validateGroup({ day: 'Monday', time: '4:20pm', location: 'Belrose HQ', capacity: -1, mode: 'direct' }, config).ok, false)
  assert.equal(validateGroup({ day: 'Monday', time: '4:20pm', location: 'Belrose HQ', capacity: 6, mode: 'open' }, config).ok, false)
})

test('hold scripts purge first and never overfill', () => {
  assert.ok(HOLD_SCRIPT.indexOf('ZREMRANGEBYSCORE') < HOLD_SCRIPT.indexOf('ZCARD'))
  assert.ok(HOLD_SCRIPT.includes('taken + want > tonumber(ARGV[2])'))
  assert.ok(EXTEND_SCRIPT.includes("'XX'"), 'extend never creates a hold that was lost')
})

test('one payment for several players splits the exact Stripe fee with nothing lost', () => {
  assert.deepEqual(splitFee(3001, 2), [1501, 1500])
  assert.deepEqual(splitFee(1500, 3), [500, 500, 500])
  assert.equal(splitFee(2903, 3).reduce((a, b) => a + b, 0), 2903)
  assert.equal(splitFee(null, 2), null)
})

test('the public group shape carries no player information', () => {
  const g = { id: 'mon-1620-belrose-hq', day: 'Monday', time: '4:20pm', location: 'Belrose HQ', coachId: 'dean', programme: 'JFP 10 weeks', mode: 'direct', durationMin: 60, capacity: 6 }
  const pub = publicGroup(g, config, 3)
  assert.deepEqual(Object.keys(pub).sort(), ['address', 'coachName', 'day', 'durationMin', 'firstDate', 'full', 'id', 'lastDate', 'location', 'mode', 'placesLeft', 'priceCents', 'priceLabel', 'programme', 'publicNote', 'sessions', 'sortTime', 'time'].sort())
  assert.equal(pub.placesLeft, 3)
  assert.match(pub.address, /Narabang Way/)
  assert.equal(publicGroup({ ...g, mode: 'application' }, config, 3).placesLeft, null, 'application groups do not reveal numbers')
})

test('parent cookie works and dies when the password changes', () => {
  process.env.JFP_BOOKING_PASSWORD = 'term4'
  const token = signParentCookie({ secret: 's' })
  const req = { headers: { cookie: `jf_jfp=${token}` } }
  assert.equal(hasParentAccess(req, { secret: 's' }), true)
  assert.equal(hasParentAccess(req, { secret: 'other' }), false)
  process.env.JFP_BOOKING_PASSWORD = 'changed'
  assert.equal(hasParentAccess(req, { secret: 's' }), false)
  delete process.env.JFP_BOOKING_PASSWORD
})

console.log(`\n${passed} JFP store checks passed`)
