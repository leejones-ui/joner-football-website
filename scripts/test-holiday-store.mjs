// Pure-function checks for the holiday booking store. No network, no KV.
import assert from 'node:assert/strict'
import {
  sydneyIso, sydneyOffset, addMinutesIso, sydneyTimeLabel, sydneyDateLabel,
  signAccessCookie, verifyAccessCookie, passwordMatches,
  normaliseConfig, resolvePriceCents, validateSlotInput, capacityForType,
  HOLD_SCRIPT, formatAud, publicSlot, maxPlayersForType, minPlayersForType, slotOptions, refundFor,
} from '../api/_holiday-store.js'

let passed = 0
function test(name, fn) { fn(); passed += 1; console.log(`ok - ${name}`) }

test('Sydney offset is +10:00 before daylight saving and +11:00 after', () => {
  assert.equal(sydneyOffset('2026-10-01', '09:00'), 600)
  assert.equal(sydneyOffset('2026-10-05', '09:00'), 660)
  assert.equal(sydneyIso('2026-10-01', '09:00'), '2026-10-01T09:00:00+10:00')
  assert.equal(sydneyIso('2026-10-05', '14:30'), '2026-10-05T14:30:00+11:00')
})

test('Sydney offset on the changeover morning itself', () => {
  // Clocks go forward at 02:00 on Sunday 4 October 2026.
  assert.equal(sydneyOffset('2026-10-04', '01:00'), 600)
  assert.equal(sydneyOffset('2026-10-04', '09:00'), 660)
})

test('addMinutesIso keeps the offset and rolls the time', () => {
  assert.equal(addMinutesIso('2026-10-01T09:00:00+10:00', 90), '2026-10-01T10:30:00+10:00')
  assert.equal(addMinutesIso('2026-10-05T23:30:00+11:00', 60), '2026-10-06T00:30:00+11:00')
})

test('labels render in Sydney time', () => {
  assert.equal(sydneyTimeLabel('2026-10-01T09:00:00+10:00'), '9am')
  assert.equal(sydneyTimeLabel('2026-10-01T14:30:00+10:00'), '2:30pm')
  assert.match(sydneyDateLabel('2026-10-01T09:00:00+10:00'), /Thu 1 Oct/)
})

test('access cookie round trips, rejects tampering and expiry, and dies on password rotation', () => {
  const opts = { secret: 'test-secret', password: 'holiday2026', nowMs: 1_700_000_000_000 }
  const token = signAccessCookie(opts)
  assert.equal(verifyAccessCookie(token, opts), true)
  assert.equal(verifyAccessCookie(token + 'x', opts), false)
  assert.equal(verifyAccessCookie(token, { ...opts, secret: 'other' }), false)
  assert.equal(verifyAccessCookie(token, { ...opts, nowMs: opts.nowMs + 15 * 86400_000 }), false)
  assert.equal(verifyAccessCookie(token, { ...opts, password: 'newpassword' }), false)
})

test('password comparison is exact', () => {
  assert.equal(passwordMatches('abc', 'abc'), true)
  assert.equal(passwordMatches('abc ', 'abc'), false)
  assert.equal(passwordMatches('', 'abc'), false)
  assert.equal(passwordMatches('abc', ''), false)
})

test('config normalises prices and coaches, and price resolution honours tier and override', () => {
  const config = normaliseConfig({
    coaches: [{ id: 'lee', name: 'Lee', tier: 'lee' }, { name: 'Dean Smith', tier: 'nonsense' }],
    prices: { lee: { one: 15000, shared: 9000, group: 6000 }, coach: { one: 10000, shared: 6500, group: 4500 } },
  })
  assert.equal(config.coaches[1].id, 'dean-smith')
  assert.equal(config.coaches[1].tier, 'coach')
  assert.equal(resolvePriceCents({ coachId: 'lee', type: 'one', priceCents: null }, config), 15000)
  assert.equal(resolvePriceCents({ coachId: 'dean-smith', type: 'group', priceCents: null }, config), 4500)
  assert.equal(resolvePriceCents({ coachId: 'lee', type: 'one', priceCents: 12345 }, config), 12345)
  assert.equal(formatAud(15000), 'A$150')
  assert.equal(formatAud(6550), 'A$65.50')
})

test('slot validation forces capacity by type and rejects bad input', () => {
  const config = normaliseConfig({})
  const good = validateSlotInput({ coachId: 'lee', date: '2026-10-01', startTime: '09:00', durationMin: 60, type: 'group', capacity: 6 }, config)
  assert.equal(good.ok, true)
  assert.equal(good.slot.capacity, 6)
  assert.equal(good.slot.location, 'Joner Football HQ, Belrose')
  assert.equal(capacityForType('one', 9), 1)
  assert.equal(capacityForType('shared', 9), 2)
  assert.equal(capacityForType('group', 99), 6)
  const bad = validateSlotInput({ coachId: 'nobody', date: '1 Oct', startTime: '9am', durationMin: 5, type: 'private' }, config)
  assert.equal(bad.ok, false)
  assert.equal(bad.errors.length, 5)
})

test('hold script takes the whole slot, and only when it is empty', () => {
  assert.ok(HOLD_SCRIPT.indexOf('ZREMRANGEBYSCORE') < HOLD_SCRIPT.indexOf('ZCARD'))
  assert.ok(HOLD_SCRIPT.includes("if redis.call('ZCARD', KEYS[1]) > 0 then return 0 end"))
  // One member per booking: the slot has an owner, not a seat count.
  assert.ok(HOLD_SCRIPT.includes("redis.call('ZADD', KEYS[1], ARGV[2], ARGV[3])"))
  assert.ok(!HOLD_SCRIPT.includes('for i = 1'))
})

test('a booking owns the whole hour whatever type it picks', () => {
  const config = normaliseConfig({ prices: { coach: { one: 12000, shared: 9000, group: 8000 } } })
  const open = validateSlotInput({ coachId: 'dean', date: '2026-09-28', startTime: '10:00', durationMin: 60, type: 'open' }, config)
  assert.equal(open.ok, true)
  assert.equal(open.slot.capacity, 6)
  const slot = { ...open.slot, id: 'S', startsAt: '2026-09-28T10:00:00+10:00', endsAt: '2026-09-28T11:00:00+10:00', status: 'open' }

  const free = publicSlot(slot, config, { booked: false, ownerId: null })
  assert.equal(free.booked, false)
  assert.deepEqual(free.options.map((o) => [o.type, o.maxPlayers, o.priceCents]), [['one', 1, 12000], ['shared', 2, 9000], ['group', 6, 8000]])

  // Booked as a 1 to 1 by one family: the hour is gone, not "1 of 6 taken".
  const taken = publicSlot(slot, config, { booked: true, ownerId: 'HOL-1' })
  assert.equal(taken.booked, true)
  assert.equal(taken.ownerId, 'HOL-1')

  // Blocked by Lee for an offline booking reads the same way to parents.
  assert.equal(publicSlot({ ...slot, status: 'blocked' }, config, { booked: false }).booked, true)

  assert.equal(maxPlayersForType(slot, 'one'), 1)
  assert.equal(maxPlayersForType(slot, 'shared'), 2)
  assert.equal(maxPlayersForType(slot, 'group'), 6)
  assert.equal(slotOptions({ ...slot, type: 'one' }, config).length, 1)
})

test('cancellation policy: full refund at 24 hours or more, half inside 24', () => {
  const slot = { startsAt: '2026-10-01T10:00:00+10:00' }
  const booking = { amountPaidCents: 24000 }
  const start = new Date(slot.startsAt).getTime()
  assert.deepEqual(refundFor(booking, slot, start - 48 * 3600_000).percent, 100)
  assert.equal(refundFor(booking, slot, start - 24 * 3600_000).percent, 100, 'exactly 24 hours counts as on time')
  assert.equal(refundFor(booking, slot, start - 23.9 * 3600_000).percent, 50)
  assert.equal(refundFor(booking, slot, start - 23.9 * 3600_000).cents, 12000)
  assert.equal(refundFor(booking, slot, start + 3600_000).percent, 50, 'after the start is still inside 24 hours')
})

test('a group of 4 can demand all 4 players; other types never demand more than 1', () => {
  const config = normaliseConfig({})
  const g = validateSlotInput({ coachId: 'lee', date: '2026-09-30', startTime: '17:00', durationMin: 60, type: 'group', capacity: 4, minPlayers: 4 }, config)
  assert.equal(g.slot.minPlayers, 4)
  assert.equal(minPlayersForType({ ...g.slot }, 'group'), 4)
  assert.deepEqual(slotOptions(g.slot, config).map((o) => [o.type, o.minPlayers, o.maxPlayers]), [['group', 4, 4]])
  const open = validateSlotInput({ coachId: 'dean', date: '2026-09-28', startTime: '10:00', durationMin: 60, type: 'open', minPlayers: 4 }, config)
  assert.equal(open.slot.minPlayers, 1, 'an open slot ignores a minimum')
  const tooMany = validateSlotInput({ coachId: 'lee', date: '2026-09-30', startTime: '17:00', durationMin: 60, type: 'group', capacity: 4, minPlayers: 9 }, config)
  assert.equal(tooMany.slot.minPlayers, 4, 'minimum never exceeds the group size')
})

console.log(`\n${passed} holiday store checks passed`)
