import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { agentIdentity, CHANGE_AVAILABILITY_SCRIPT, MOVE_SLOT_SCRIPT, SWAP_SLOTS_SCRIPT, changeAvailability, moveUnbookedSlot, swapUnbookedSlots } from '../api/_holiday-agent-access.js'
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

test('swap atomically guards versions, holds, coach, day and every other slot', () => {
  for (const re of [/a\.startsAt ~= ARGV\[3\]/, /va ~= ARGV\[5\]/, /ZCARD.*KEYS\[2\].*ZCARD.*KEYS\[3\]/, /a\.coachId ~= b\.coachId/, /a\.date ~= b\.date/, /all\[i\] ~= ARGV\[1\] and all\[i\] ~= ARGV\[2\]/, /HSET.*KEYS\[1\], ARGV\[1\].*ARGV\[2\]/]) assert.match(SWAP_SLOTS_SCRIPT, re)
})

test('swap refuses a request without both current times', async () => {
  const a = { id: 'A', startsAt: '2026-10-08T08:00:00+11:00', durationMin: 60 }, b = { id: 'B', startsAt: '2026-10-08T10:30:00+11:00', durationMin: 60 }
  assert.deepEqual(await swapUnbookedSlots(a, b, { startsAtA: a.startsAt }), { ok: false, reason: 'invalid' })
  assert.deepEqual(await swapUnbookedSlots(a, a, { startsAtA: a.startsAt, startsAtB: a.startsAt }), { ok: false, reason: 'invalid' })
})

test('only Barry may swap; Forge and bad tokens are refused before any change', async () => {
  const { default: handler } = await import('../api/holiday-agent.js')
  const hash = (t) => crypto.createHash('sha256').update(t).digest('hex')
  const forge = 'f'.repeat(64)
  Object.assign(process.env, { HOLIDAY_FORGE_EDITOR_HASH: hash(forge), HOLIDAY_FORGE_EDITOR_EXPIRES: '2099-01-01T00:00:00Z' })
  const call = (token, body) => new Promise((resolve) => {
    const res = { code: 200, setHeader() {}, status(c) { this.code = c; return this }, json(d) { resolve({ status: this.code, data: d }) } }
    handler({ method: 'POST', headers: { 'x-holiday-agent-token': token, 'x-forwarded-for': '10.1.2.3' }, body, socket: {} }, res)
  })
  assert.equal((await call(forge, { action: 'swapSlots', slotIdA: 'A', slotIdB: 'B' })).status, 403)
  assert.equal((await call('0'.repeat(64), { action: 'swapSlots' })).status, 401)
})

// The real script on Upstash, under throwaway keys that expire on their own.
// Never touches real slots. Run with JFP_REAL_KV_TEST=1 and the KV env set.
const REAL = process.env.JFP_REAL_KV_TEST === '1' && process.env.KV_REST_API_URL
test('swap on real Redis: every guard, then a clean same-day swap', { skip: !REAL && 'set JFP_REAL_KV_TEST=1 with KV env to run' }, async () => {
  const { kvCommand } = await import('../api/_holiday-store.js')
  const ns = `jfp-test:swap:${crypto.randomBytes(5).toString('hex')}`
  const k = { slots: `${ns}:slots`, seats: (id) => `${ns}:seats:${id}` }
  const base = { coachId: 'lee', date: '2026-10-08', location: 'Joner Football HQ, Belrose', status: 'open', createdAt: '2026-10-04T00:00:00Z' }
  const at = (t) => `2026-10-08T${t}:00+11:00`
  const A0 = { ...base, id: 'SLOT-A', startTime: '08:00', startsAt: at('08:00'), endsAt: at('09:00'), durationMin: 60, type: 'group', seatMode: 'shared', capacity: 4, priceCents: 10000, title: "Pro's Only", minAge: 16, maxAge: null, minPlayers: 1, notes: '', updatedAt: 'v-a' }
  const B0 = { ...base, id: 'SLOT-B', startTime: '10:30', startsAt: at('10:30'), endsAt: at('11:30'), durationMin: 60, type: 'open', capacity: 6, priceCents: null, title: 'Minimum 2 players', minPlayers: 2, notes: '', updatedAt: 'v-b' }
  const C0 = { ...base, id: 'SLOT-C', startTime: '09:15', startsAt: at('09:15'), endsAt: at('10:15'), durationMin: 60, type: 'open', capacity: 6, priceCents: null, minPlayers: 1, notes: '', updatedAt: 'v-c' }
  const reset = async (extra = {}) => {
    await kvCommand(['DEL', k.slots, k.seats('SLOT-A'), k.seats('SLOT-B')])
    const rows = { A: { ...A0, ...extra.A }, B: { ...B0, ...extra.B }, C: { ...C0, ...extra.C } }
    await kvCommand(['HSET', k.slots, ...Object.values(rows).flatMap((r) => [r.id, JSON.stringify(r)])])
    await kvCommand(['EXPIRE', k.slots, '600'])
    return rows
  }
  const get = async (id) => JSON.parse(await kvCommand(['HGET', k.slots, id]))
  const exp = (a, b) => ({ startsAtA: a.startsAt, startsAtB: b.startsAt, versionA: a.updatedAt, versionB: b.updatedAt })
  const swap = (a, b, e = exp(a, b)) => swapUnbookedSlots(a, b, e, Date.now(), k)
  try {
    let r = await reset()
    assert.deepEqual(await swap(r.A, r.B, { ...exp(r.A, r.B), versionB: 'old' }), { ok: false, reason: 'stale' }, 'wrong version')
    // A booking (paid: far-future score) on one of the pair.
    await kvCommand(['ZADD', k.seats('SLOT-B'), '9007199254740000', 'HOL-PAID'])
    assert.deepEqual(await swap(r.A, r.B), { ok: false, reason: 'owned' }, 'booked slot')
    await kvCommand(['DEL', k.seats('SLOT-B')])
    // Race: Barry read both, then a parent took one shared place before the swap.
    const seen = await reset()
    await kvCommand(['ZADD', k.seats('SLOT-A'), String(Date.now() + 600000), 'HOL-NEW#1'])
    assert.deepEqual(await swap(seen.A, seen.B), { ok: false, reason: 'owned' }, 'race with a new hold / partial shared-seat hold')
    await kvCommand(['DEL', k.seats('SLOT-A')])
    r = await reset({ B: { coachId: 'dean' } })
    assert.deepEqual(await swap(r.A, r.B), { ok: false, reason: 'coach' }, 'different coach')
    r = await reset({ B: { date: '2026-10-09', startsAt: '2026-10-09T10:30:00+11:00' } })
    assert.deepEqual(await swap(r.A, r.B), { ok: false, reason: 'day' }, 'different day')
    r = await reset({ B: { durationMin: 90 } })
    assert.deepEqual(await swap(r.A, r.B), { ok: false, reason: 'overlap' }, 'B at 8:00 for 90 minutes runs into 9:15')
    assert.deepEqual(await get('SLOT-A'), r.A, 'nothing changed after refusals')
    // An expired hold does not block. Then the real swap.
    r = await reset()
    await kvCommand(['ZADD', k.seats('SLOT-A'), String(Date.now() - 1000), 'HOL-OLD#1'])
    assert.deepEqual(await swap(r.A, r.B), { ok: true })
    const [a, b, c] = [await get('SLOT-A'), await get('SLOT-B'), await get('SLOT-C')]
    assert.equal(a.startTime, '10:30'); assert.equal(a.startsAt, at('10:30')); assert.equal(a.endsAt, '2026-10-08T11:30:00+11:00')
    assert.equal(b.startTime, '08:00'); assert.equal(b.startsAt, at('08:00')); assert.equal(b.endsAt, '2026-10-08T09:00:00+11:00')
    const rest = (x) => { const { startTime, startsAt, endsAt, updatedAt, ...o } = x; return o }
    assert.deepEqual(rest(a), rest(r.A), 'every other field of the Pro hour kept')
    assert.deepEqual(rest(b), rest(r.B), 'every other field of the other hour kept')
    assert.deepEqual(c, r.C, 'the third slot untouched')
    assert.deepEqual(await swap(r.A, r.B), { ok: false, reason: 'stale' }, 'the same request again is refused')
  } finally {
    await kvCommand(['DEL', k.slots, k.seats('SLOT-A'), k.seats('SLOT-B')])
  }
})
