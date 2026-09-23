import crypto from 'node:crypto'
import { kvCommand, keys, clean, sydneyIso, addMinutesIso } from './_holiday-store.js'

const AGENTS = ['barry', 'forge']
export function agentIdentity(token, env = process.env, now = Date.now()) {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null
  const digest = crypto.createHash('sha256').update(token).digest()
  for (const id of AGENTS) {
    const hash = env[`HOLIDAY_${id.toUpperCase()}_EDITOR_HASH`]
    const expiry = Date.parse(env[`HOLIDAY_${id.toUpperCase()}_EDITOR_EXPIRES`] || '')
    if (!/^[a-f0-9]{64}$/.test(hash || '') || !Number.isFinite(expiry) || now >= expiry) continue
    if (crypto.timingSafeEqual(digest, Buffer.from(hash, 'hex'))) return id
  }
  return null
}

export const CHANGE_AVAILABILITY_SCRIPT = `
local raw = redis.call('HGET', KEYS[1], ARGV[1])
if not raw then return 0 end
local slot = cjson.decode(raw)
local expected = ARGV[2] == 'blocked' and 'open' or 'blocked'
if slot.status ~= expected then return -1 end
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', ARGV[3])
if redis.call('ZCARD', KEYS[2]) > 0 then return -2 end
slot.status = ARGV[2]
slot.updatedAt = ARGV[4]
redis.call('HSET', KEYS[1], ARGV[1], cjson.encode(slot))
return 1`

export async function changeAvailability(slotId, status, nowMs = Date.now()) {
  const id = clean(slotId, 60)
  if (!id || !['blocked', 'open'].includes(status)) return { ok: false, reason: 'invalid' }
  const result = Number(await kvCommand(['EVAL', CHANGE_AVAILABILITY_SCRIPT, '2', keys.slots(), keys.seats(id), id, status, String(nowMs), new Date(nowMs).toISOString()]))
  if (result === 1) return { ok: true }
  return { ok: false, reason: result === -2 ? 'owned' : result === -1 ? 'status' : 'missing' }
}

// Keep the original slot ID and every booking reference intact. A Redis script
// checks the hold, stale reads and coach collisions in the same write step.
export const MOVE_SLOT_SCRIPT = `
local raw = redis.call('HGET', KEYS[1], ARGV[1])
if not raw then return 0 end
local slot = cjson.decode(raw)
if slot.status ~= 'open' or slot.startsAt ~= ARGV[2] then return -1 end
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', ARGV[6])
if redis.call('ZCARD', KEYS[2]) > 0 then return -2 end
local newStart = tonumber(string.sub(ARGV[3], 1, 2)) * 60 + tonumber(string.sub(ARGV[3], 4, 5))
local newEnd = newStart + tonumber(slot.durationMin)
local all = redis.call('HGETALL', KEYS[1])
for i = 1, #all, 2 do
  if all[i] ~= ARGV[1] then
    local other = cjson.decode(all[i + 1])
    if other.coachId == slot.coachId and other.date == slot.date and other.status ~= 'cancelled' then
      local otherStart = tonumber(string.sub(other.startTime, 1, 2)) * 60 + tonumber(string.sub(other.startTime, 4, 5))
      if newStart < otherStart + tonumber(other.durationMin) and otherStart < newEnd then return -3 end
    end
  end
end
slot.startTime = ARGV[3]
slot.startsAt = ARGV[4]
slot.endsAt = ARGV[5]
slot.updatedAt = ARGV[7]
redis.call('HSET', KEYS[1], ARGV[1], cjson.encode(slot))
return 1`

export async function moveUnbookedSlot(slot, expectedStartsAt, newStartTime, nowMs = Date.now()) {
  const id = clean(slot?.id, 60)
  const expected = clean(expectedStartsAt, 35)
  const startTime = clean(newStartTime, 5)
  const duration = Number(slot?.durationMin)
  if (!id || expected !== slot?.startsAt || !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime) ||
      !Number.isInteger(duration) || duration < 30 || duration > 180 ||
      Number(startTime.slice(0, 2)) * 60 + Number(startTime.slice(3)) + duration > 24 * 60) {
    return { ok: false, reason: 'invalid' }
  }
  const startsAt = sydneyIso(slot.date, startTime)
  const endsAt = addMinutesIso(startsAt, duration)
  const result = Number(await kvCommand(['EVAL', MOVE_SLOT_SCRIPT, '2', keys.slots(), keys.seats(id), id, expected, startTime, startsAt, endsAt, String(nowMs), new Date(nowMs).toISOString()]))
  return result === 1 ? { ok: true } : { ok: false, reason: ({ 0: 'missing', '-1': 'stale', '-2': 'owned', '-3': 'overlap' })[result] || 'unknown' }
}
