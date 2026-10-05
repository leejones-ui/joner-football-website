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

// Barry's swap: two unbooked hours of the same coach on the same day trade
// times in one Redis step. Both IDs, both current start times and both
// versions (updatedAt) must match what Barry read. Refused if either hour is
// held, booked or blocked (including any shared-seat place), if the coach
// differs, if the day differs, or if either new time overlaps any other hour
// of that coach that day. Only startTime, startsAt, endsAt and updatedAt
// change; every other field and both IDs stay as they are.
export const SWAP_SLOTS_SCRIPT = `
local rawA = redis.call('HGET', KEYS[1], ARGV[1])
local rawB = redis.call('HGET', KEYS[1], ARGV[2])
if not rawA or not rawB then return 0 end
local a = cjson.decode(rawA)
local b = cjson.decode(rawB)
if a.status ~= 'open' or b.status ~= 'open' then return -1 end
if a.startsAt ~= ARGV[3] or b.startsAt ~= ARGV[4] then return -1 end
local va = a.updatedAt
if type(va) ~= 'string' then va = '' end
local vb = b.updatedAt
if type(vb) ~= 'string' then vb = '' end
if va ~= ARGV[5] or vb ~= ARGV[6] then return -1 end
if a.coachId ~= b.coachId then return -4 end
if a.date ~= b.date then return -5 end
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', ARGV[7])
redis.call('ZREMRANGEBYSCORE', KEYS[3], '-inf', ARGV[7])
if redis.call('ZCARD', KEYS[2]) > 0 or redis.call('ZCARD', KEYS[3]) > 0 then return -2 end
local function mins(t) return tonumber(string.sub(t, 1, 2)) * 60 + tonumber(string.sub(t, 4, 5)) end
local aStart = mins(b.startTime)
local aEnd = aStart + tonumber(a.durationMin)
local bStart = mins(a.startTime)
local bEnd = bStart + tonumber(b.durationMin)
if aStart < bEnd and bStart < aEnd then return -3 end
local all = redis.call('HGETALL', KEYS[1])
for i = 1, #all, 2 do
  if all[i] ~= ARGV[1] and all[i] ~= ARGV[2] then
    local o = cjson.decode(all[i + 1])
    if o.coachId == a.coachId and o.date == a.date and o.status ~= 'cancelled' then
      local s = mins(o.startTime)
      local e = s + tonumber(o.durationMin)
      if (aStart < e and s < aEnd) or (bStart < e and s < bEnd) then return -3 end
    end
  end
end
-- Edit only the four time fields in the stored JSON, so every other field
-- (including empty ones, which cjson would drop) is kept exactly.
local function setf(raw, key, val)
  local rep = '"' .. key .. '":"' .. val .. '"'
  local out, n = string.gsub(raw, '"' .. key .. '":"[^"]*"', rep, 1)
  if n == 0 then out = string.sub(raw, 1, -2) .. ',' .. rep .. '}' end
  return out
end
local newA = setf(setf(setf(setf(rawA, 'startTime', b.startTime), 'startsAt', b.startsAt), 'endsAt', ARGV[8]), 'updatedAt', ARGV[10])
local newB = setf(setf(setf(setf(rawB, 'startTime', a.startTime), 'startsAt', a.startsAt), 'endsAt', ARGV[9]), 'updatedAt', ARGV[10])
redis.call('HSET', KEYS[1], ARGV[1], newA, ARGV[2], newB)
return 1`

export const SWAP_REASONS = { 0: 'missing', '-1': 'stale', '-2': 'owned', '-3': 'overlap', '-4': 'coach', '-5': 'day' }

// a and b are the slots as Barry last read them (for durations); the script
// re-checks everything against what is stored now. keyNames is for tests.
export async function swapUnbookedSlots(a, b, expected, nowMs = Date.now(), keyNames = { slots: keys.slots(), seats: keys.seats }) {
  const idA = clean(a?.id, 60), idB = clean(b?.id, 60)
  const e = expected || {}
  const fields = [e.startsAtA, e.startsAtB].map((v) => clean(v, 35))
  const versions = [e.versionA, e.versionB].map((v) => clean(v ?? '', 40))
  if (!idA || !idB || idA === idB || fields.some((f) => !f) || fields[0] !== a.startsAt || fields[1] !== b.startsAt ||
      !Number.isInteger(Number(a.durationMin)) || !Number.isInteger(Number(b.durationMin))) return { ok: false, reason: 'invalid' }
  const endA = addMinutesIso(b.startsAt, Number(a.durationMin))
  const endB = addMinutesIso(a.startsAt, Number(b.durationMin))
  const result = Number(await kvCommand(['EVAL', SWAP_SLOTS_SCRIPT, '3', keyNames.slots, keyNames.seats(idA), keyNames.seats(idB),
    idA, idB, fields[0], fields[1], versions[0], versions[1], String(nowMs), endA, endB, new Date(nowMs).toISOString()]))
  return result === 1 ? { ok: true } : { ok: false, reason: SWAP_REASONS[result] || 'unknown' }
}
