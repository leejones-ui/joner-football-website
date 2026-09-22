// Pure-function checks for the holiday booking store. No network, no KV.
import assert from 'node:assert/strict'
import {
  sydneyIso, sydneyOffset, addMinutesIso, sydneyTimeLabel, sydneyDateLabel,
  signAccessCookie, verifyAccessCookie, passwordMatches,
  normaliseConfig, resolvePriceCents, validateSlotInput, capacityForType,
  HOLD_SCRIPT, seatMembers, formatAud, publicSlot, effectiveCapacity, effectiveType,
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
  assert.equal(good.slot.location, 'The HQ, Belrose')
  assert.equal(capacityForType('one', 9), 1)
  assert.equal(capacityForType('shared', 9), 2)
  assert.equal(capacityForType('group', 99), 6)
  const bad = validateSlotInput({ coachId: 'nobody', date: '1 Oct', startTime: '9am', durationMin: 5, type: 'private' }, config)
  assert.equal(bad.ok, false)
  assert.equal(bad.errors.length, 5)
})

test('hold script purges before counting, locks the type, and adds one member per seat', () => {
  assert.ok(HOLD_SCRIPT.indexOf('ZREMRANGEBYSCORE') < HOLD_SCRIPT.indexOf('ZCARD'))
  assert.ok(HOLD_SCRIPT.indexOf('ZCARD') < HOLD_SCRIPT.indexOf("current ~= ARGV[6]"))
  assert.ok(HOLD_SCRIPT.includes("taken + want > tonumber(ARGV[2])"))
  assert.ok(HOLD_SCRIPT.indexOf("return -1") < HOLD_SCRIPT.indexOf("return 0"))
  assert.deepEqual(seatMembers('HOL-1', 2), ['HOL-1#1', 'HOL-1#2'])
})

test('open slots run as whatever the first booker chose', () => {
  const config = normaliseConfig({ prices: { coach: { one: 12000, shared: 9000, group: 8000 } } })
  const open = validateSlotInput({ coachId: 'dean', date: '2026-09-28', startTime: '10:00', durationMin: 60, type: 'open' }, config)
  assert.equal(open.ok, true)
  assert.equal(open.slot.capacity, 6)
  const slot = { ...open.slot, id: 'S', startsAt: '2026-09-28T10:00:00+10:00', endsAt: '2026-09-28T11:00:00+10:00', status: 'open' }
  const fresh = publicSlot(slot, config, { taken: 0, lockedType: null })
  assert.equal(fresh.lockedType, null)
  assert.equal(fresh.typeLabel, 'Your choice')
  assert.deepEqual(fresh.options.map((o) => [o.type, o.capacity, o.priceCents]), [['one', 1, 12000], ['shared', 2, 9000], ['group', 6, 8000]])
  const asShared = publicSlot(slot, config, { taken: 1, lockedType: 'shared' })
  assert.equal(asShared.lockedType, 'shared')
  assert.equal(asShared.capacity, 2)
  assert.equal(asShared.remaining, 1)
  assert.equal(asShared.priceCents, 9000)
  const asOne = publicSlot(slot, config, { taken: 1, lockedType: 'one' })
  assert.equal(asOne.remaining, 0)
  assert.equal(effectiveCapacity(slot, 'group'), 6)
  assert.equal(effectiveType(slot, null), null)
})

console.log(`\n${passed} holiday store checks passed`)
