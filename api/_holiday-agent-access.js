import crypto from 'node:crypto'
import { kvCommand, keys, clean } from './_holiday-store.js'

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
