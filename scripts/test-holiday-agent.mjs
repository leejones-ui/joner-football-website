import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { agentIdentity, CHANGE_AVAILABILITY_SCRIPT, MOVE_SLOT_SCRIPT, changeAvailability, moveUnbookedSlot } from '../api/_holiday-agent-access.js'
import { HOLD_SCRIPT } from '../api/_holiday-store.js'

test('Barry and Forge have independent expiring credentials', () => {
  const barry = 'a'.repeat(64), forge = 'b'.repeat(64)
  const hash = token => crypto.createHash('sha256').update(token).digest('hex')
  const env = {
    HOLIDAY_BARRY_EDITOR_HASH: hash(barry), HOLIDAY_BARRY_EDITOR_EXPIRES: '2026-12-31T00:00:00Z',
    HOLIDAY_FORGE_EDITOR_HASH: hash(forge), HOLIDAY_FORGE_EDITOR_EXPIRES: '2026-12-31T00:00:00Z',
  }
  const now = Date.parse('2026-09-23T00:00:00Z')
  assert.equal(agentIdentity(barry, env, now), 'barry')
  assert.equal(agentIdentity(forge, env, now), 'forge')
  assert.equal(agentIdentity(barry, { ...env, HOLIDAY_BARRY_EDITOR_HASH: '' }, now), null)
  assert.equal(agentIdentity(barry, env, Date.parse('2026-12-31T00:00:00Z')), null)
  assert.equal(agentIdentity('c'.repeat(64), env, now), null)
  assert.equal(agentIdentity('', env, now), null)
})

test('booking and availability scripts inspect the same slot state atomically', () => {
  assert.match(HOLD_SCRIPT, /HGET.*KEYS\[2\]/)
  assert.match(HOLD_SCRIPT, /status ~= 'open'/)
  assert.match(CHANGE_AVAILABILITY_SCRIPT, /ZCARD.*KEYS\[2\]/)
  assert.match(CHANGE_AVAILABILITY_SCRIPT, /slot\.status = ARGV\[2\]/)
  assert.match(CHANGE_AVAILABILITY_SCRIPT, /HSET.*KEYS\[1\]/)
})

test('invalid status is refused before accessing KV', async () => {
  assert.deepEqual(await changeAvailability('slot-1', 'cancelled'), { ok: false, reason: 'invalid' })
})

test('time move requires current slot time and a valid same-day window', async () => {
  const slot = { id: 'SLOT-1', date: '2026-09-30', startsAt: '2026-09-30T19:00:00+10:00', durationMin: 60 }
  assert.deepEqual(await moveUnbookedSlot(slot, '2026-09-30T18:00:00+10:00', '18:00'), { ok: false, reason: 'invalid' })
  assert.deepEqual(await moveUnbookedSlot(slot, slot.startsAt, '24:00'), { ok: false, reason: 'invalid' })
  assert.deepEqual(await moveUnbookedSlot(slot, slot.startsAt, '23:30'), { ok: false, reason: 'invalid' })
})

test('time move atomically guards holds, changed slots and coach overlaps', () => {
  assert.match(MOVE_SLOT_SCRIPT, /slot\.startsAt ~= ARGV\[2\]/)
  assert.match(MOVE_SLOT_SCRIPT, /ZCARD.*KEYS\[2\]/)
  assert.match(MOVE_SLOT_SCRIPT, /other\.coachId == slot\.coachId/)
  assert.match(MOVE_SLOT_SCRIPT, /newStart < otherStart/)
  assert.match(MOVE_SLOT_SCRIPT, /HSET.*KEYS\[1\]/)
})
