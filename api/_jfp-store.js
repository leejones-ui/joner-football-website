// JFP term bookings: the group model, place holds and bookings.
//
// Airtable Term 4 Players stays the roster of record. Existing families live
// there and are never touched by this code. Places a group has left are:
//
//   capacity - players already in Airtable (not booked online) - online places in KV
//
// Online places are held in KV the moment a parent opens the form, the same
// Lua pattern the holiday system proved, but counting places rather than
// taking a whole hour. Once paid, the booking is written into Airtable and
// tagged so it is not counted twice.
import crypto from 'node:crypto'
import { kvCommand, kvPipeline, kvGetJson, kvSetJson, clean, newId, formatAud, claimOnce } from './_holiday-store.js'

export { kvCommand, kvPipeline, kvGetJson, kvSetJson, clean, newId, formatAud, claimOnce }

export const RESERVE_MINUTES = 10
export const HOLD_MINUTES = 31
export const CHECKOUT_EXPIRES_MINUTES = 30
export const CONFIRMED_SCORE = 9007199254740000
export const MODES = ['direct', 'application', 'closed']
export const ONLINE_TAG = 'JFP-ONLINE'
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

export const keys = {
  config: () => 'jfp:config',
  groups: () => 'jfp:groups',
  seats: (gid) => `jfp:seats:${gid}`,
  booking: (id) => `jfp:booking:${id}`,
  bookings: () => 'jfp:bookings',
  application: (id) => `jfp:application:${id}`,
  applications: () => 'jfp:applications',
  airtableCounts: () => 'jfp:airtable-counts',
  finalised: (id) => `jfp:finalised:${id}`,
}

// ---------- config ----------

export const DEFAULT_CONFIG = {
  term: 'Term 4 2026',
  termStart: '2026-10-12',
  weeks: 10,
  priceCents: 85000,
  waiverUrl: '',
  staffEmails: ['ligia@jonerfootball.com'],
  coaches: [
    { id: 'dean', name: 'Dean', airtableName: 'Dean Mac', email: 'jonerfootballdean@gmail.com' },
    { id: 'sam', name: 'Sam', airtableName: 'Sam Yorks', email: 'jonerfootballsam@gmail.com' },
    { id: 'lee', name: 'Lee', airtableName: 'Lee Jones', email: '' },
    { id: 'ruby', name: 'Ruby', airtableName: 'Ruby Fanoosh', email: '' },
    { id: 'luke', name: 'Luke', airtableName: 'Luke Bakos', email: '' },
  ],
  minAge: 7,
  maxAge: 18,
}

function validEmail(v) {
  const e = clean(v, 200).toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : ''
}

export function normaliseConfig(input = {}) {
  const b = structuredClone(DEFAULT_CONFIG)
  const price = Number(input.priceCents)
  return {
    term: clean(input.term, 40) || b.term,
    termStart: /^\d{4}-\d{2}-\d{2}$/.test(input.termStart || '') ? input.termStart : b.termStart,
    weeks: Number.isInteger(Number(input.weeks)) && Number(input.weeks) >= 1 && Number(input.weeks) <= 20 ? Number(input.weeks) : b.weeks,
    priceCents: Number.isInteger(price) && price > 0 ? price : b.priceCents,
    waiverUrl: /^https:\/\//.test(input.waiverUrl || '') ? clean(input.waiverUrl, 500) : (input.waiverUrl === '' ? '' : b.waiverUrl),
    staffEmails: Array.isArray(input.staffEmails) ? [...new Set(input.staffEmails.map(validEmail).filter(Boolean))] : b.staffEmails,
    coaches: Array.isArray(input.coaches) && input.coaches.length
      ? input.coaches.map((c) => ({ id: clean(c.id, 30).toLowerCase().replace(/[^a-z0-9-]/g, ''), name: clean(c.name, 60), airtableName: clean(c.airtableName, 80), email: validEmail(c.email) })).filter((c) => c.id && c.name)
      : b.coaches,
    minAge: Number(input.minAge) >= 3 && Number(input.minAge) <= 18 ? Number(input.minAge) : b.minAge,
    maxAge: Number(input.maxAge) >= 5 && Number(input.maxAge) <= 25 ? Number(input.maxAge) : b.maxAge,
  }
}

export async function getConfig() { return normaliseConfig((await kvGetJson(keys.config())) || {}) }
export async function saveConfig(partial) {
  const next = normaliseConfig({ ...(await getConfig()), ...partial })
  await kvSetJson(keys.config(), next)
  return next
}
export function coachById(config, id) { return config.coaches.find((c) => c.id === id) || null }
export function coachByAirtableName(config, name) {
  const n = clean(name, 80).toLowerCase()
  return config.coaches.find((c) => c.airtableName.toLowerCase() === n || c.name.toLowerCase() === n.split(' ')[0]) || null
}

// ---------- time and dates ----------

// "4:20pm" -> "16:20". Returns '' if it cannot be read.
export function to24h(label) {
  const m = String(label || '').trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/)
  if (!m) return ''
  let h = Number(m[1]) % 12
  if (m[3] === 'pm') h += 12
  return `${String(h).padStart(2, '0')}:${m[2] || '00'}`
}

export function sessionDates(config, day) {
  const idx = DAYS.indexOf(day)
  if (idx < 0) return []
  const start = new Date(`${config.termStart}T00:00:00Z`)
  const startIdx = (start.getUTCDay() + 6) % 7 // Monday = 0
  const first = new Date(start.getTime() + ((idx - startIdx + 7) % 7) * 86400000)
  return Array.from({ length: config.weeks }, (_, k) => new Date(first.getTime() + k * 7 * 86400000).toISOString().slice(0, 10))
}

export function dateLabel(iso) {
  return new Intl.DateTimeFormat('en-AU', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(`${iso}T00:00:00Z`)).replace(',', '')
}

export function dayOrder(day) { const i = DAYS.indexOf(day); return i < 0 ? 9 : i }

// ---------- groups ----------

export function groupId(day, time, location) {
  return `${day.slice(0, 3)}-${to24h(time).replace(':', '') || time}-${location}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export function validateGroup(input, config, existing = {}) {
  const errors = []
  const merged = { ...existing, ...input }
  if (!DAYS.includes(merged.day)) errors.push('Day must be a weekday name.')
  if (!to24h(merged.time)) errors.push('Time must look like 4:20pm.')
  if (!clean(merged.location, 80)) errors.push('Location is required.')
  if (merged.coachId && !coachById(config, merged.coachId)) errors.push('Unknown coach.')
  const capacity = Number(merged.capacity)
  if (!Number.isInteger(capacity) || capacity < 0 || capacity > 60) errors.push('Capacity must be a whole number from 0 to 60.')
  if (!MODES.includes(merged.mode)) errors.push('Mode must be direct, application or closed.')
  const duration = Number(merged.durationMin ?? 60)
  if (!Number.isInteger(duration) || duration < 15 || duration > 180) errors.push('Duration must be 15 to 180 minutes.')
  if (errors.length) return { ok: false, errors }
  return {
    ok: true,
    group: {
      id: existing.id || groupId(merged.day, merged.time, merged.location),
      day: merged.day,
      time: clean(merged.time, 10),
      location: clean(merged.location, 80),
      coachId: merged.coachId || '',
      extraCoachIds: Array.isArray(merged.extraCoachIds) ? merged.extraCoachIds.filter((c) => coachById(config, c)) : [],
      programme: clean(merged.programme, 60) || 'JFP 10 weeks',
      capacity,
      mode: merged.mode,
      durationMin: duration,
      publicNote: clean(merged.publicNote, 200),
      updatedAt: new Date().toISOString(),
    },
  }
}

function parse(v) { if (v == null) return null; if (typeof v !== 'string') return v; try { return JSON.parse(v) } catch { return null } }

export async function listGroups() {
  const raw = await kvCommand(['HGETALL', keys.groups()])
  const out = []
  for (let i = 0; i + 1 < (raw || []).length; i += 2) { const g = parse(raw[i + 1]); if (g) out.push(g) }
  return out.sort((a, b) => dayOrder(a.day) - dayOrder(b.day) || to24h(a.time).localeCompare(to24h(b.time)) || a.location.localeCompare(b.location))
}
export async function getGroup(id) { return parse(await kvCommand(['HGET', keys.groups(), clean(id, 80)])) }
export async function saveGroup(group) { await kvCommand(['HSET', keys.groups(), group.id, JSON.stringify(group)]); return group }

// ---------- places ----------

// Purge lapsed holds, then take `want` places only if they fit in what is
// left. ARGV: now, available (capacity minus Airtable players), want, expiry, bookingId.
export const HOLD_SCRIPT = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
local taken = redis.call('ZCARD', KEYS[1])
local want = tonumber(ARGV[3])
if taken + want > tonumber(ARGV[2]) then return 0 end
for i = 1, want do
  redis.call('ZADD', KEYS[1], ARGV[4], ARGV[5] .. '#' .. i)
end
return 1`

// Push this booking's live holds to a new expiry, only if every one is still ours.
export const EXTEND_SCRIPT = `
local want = tonumber(ARGV[4])
for i = 1, want do
  local s = redis.call('ZSCORE', KEYS[1], ARGV[3] .. '#' .. i)
  if not s or tonumber(s) <= tonumber(ARGV[1]) then return 0 end
end
for i = 1, want do
  redis.call('ZADD', KEYS[1], 'XX', ARGV[2], ARGV[3] .. '#' .. i)
end
return 1`

export function members(bookingId, n) { return Array.from({ length: n }, (_, i) => `${bookingId}#${i + 1}`) }

export async function holdPlaces({ gid, bookingId, want, available, expiresMs, nowMs = Date.now() }) {
  return Number(await kvCommand(['EVAL', HOLD_SCRIPT, '1', keys.seats(gid), String(nowMs), String(available), String(want), String(expiresMs), bookingId])) === 1
}
export async function extendPlaces({ gid, bookingId, want, expiresMs, nowMs = Date.now() }) {
  return Number(await kvCommand(['EVAL', EXTEND_SCRIPT, '1', keys.seats(gid), String(nowMs), String(expiresMs), bookingId, String(want)])) === 1
}
export async function confirmPlaces(gid, bookingId, n) {
  await kvCommand(['ZADD', keys.seats(gid), ...members(bookingId, n).flatMap((m) => [String(CONFIRMED_SCORE), m])])
}
export async function releasePlaces(gid, bookingId, n) {
  await kvCommand(['ZREM', keys.seats(gid), ...members(bookingId, Math.max(n, 6))])
}
export async function onlineCounts(gids, nowMs = Date.now()) {
  if (!gids.length) return {}
  const res = await kvPipeline(gids.flatMap((g) => [['ZREMRANGEBYSCORE', keys.seats(g), '-inf', String(nowMs)], ['ZCARD', keys.seats(g)]]))
  return Object.fromEntries(gids.map((g, i) => [g, Number(res[i * 2 + 1] || 0)]))
}

export function placesLeft(group, airtableCount, onlineCount) {
  return Math.max(0, Number(group.capacity || 0) - Number(airtableCount || 0) - Number(onlineCount || 0))
}

// ---------- bookings and applications ----------

export async function saveBooking(b) {
  const ttl = b.status === 'reserving' ? 86400 : 60 * 60 * 24 * 500
  await kvSetJson(keys.booking(b.id), b, ttl)
  return b
}
export async function getBooking(id) { const c = clean(id, 60); return c ? kvGetJson(keys.booking(c)) : null }
export async function indexBooking(b) { await kvCommand(['ZADD', keys.bookings(), String(Date.parse(b.createdAt)), b.id]) }
export async function listBookings(limit = 500) {
  const ids = await kvCommand(['ZREVRANGE', keys.bookings(), '0', String(limit - 1)])
  if (!ids?.length) return []
  return (await kvPipeline(ids.map((id) => ['GET', keys.booking(id)]))).map(parse).filter(Boolean)
}
export async function saveApplication(a) { await kvSetJson(keys.application(a.id), a, 60 * 60 * 24 * 500); await kvCommand(['ZADD', keys.applications(), String(Date.parse(a.createdAt)), a.id]); return a }
export async function getApplication(id) { return kvGetJson(keys.application(clean(id, 60))) }
export async function listApplications(limit = 500) {
  const ids = await kvCommand(['ZREVRANGE', keys.applications(), '0', String(limit - 1)])
  if (!ids?.length) return []
  return (await kvPipeline(ids.map((id) => ['GET', keys.application(id)]))).map(parse).filter(Boolean)
}

export function tokenMatches(supplied, expected) {
  if (typeof supplied !== 'string' || typeof expected !== 'string' || supplied.length !== expected.length || !expected) return false
  return crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
}

// ---------- parent access cookie ----------

const PARENT_COOKIE = 'jf_jfp'
function sha(v) { return crypto.createHash('sha256').update(String(v)).digest() }
export function parentPasswordMatches(supplied, expected = process.env.JFP_BOOKING_PASSWORD) {
  if (!expected || typeof supplied !== 'string') return false
  return crypto.timingSafeEqual(sha(supplied), sha(expected))
}
function pv(pw = process.env.JFP_BOOKING_PASSWORD) { return pw ? sha(pw).toString('hex').slice(0, 12) : '' }
function sign(payload, secret) { return crypto.createHmac('sha256', secret).update(`jf-jfp-v1:${payload}`).digest('base64url') }
export function signParentCookie({ secret = process.env.HOLIDAY_SIGNING_SECRET, nowMs = Date.now() } = {}) {
  if (!secret) throw new Error('Signing secret is not configured.')
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(nowMs / 1000) + 14 * 86400, pv: pv() })).toString('base64url')
  return `${payload}.${sign(payload, secret)}`
}
export function hasParentAccess(req, { secret = process.env.HOLIDAY_SIGNING_SECRET, nowMs = Date.now() } = {}) {
  const token = String(req.headers?.cookie || '').split(';').map((s) => s.trim()).find((s) => s.startsWith(`${PARENT_COOKIE}=`))?.slice(PARENT_COOKIE.length + 1)
  if (!token || !secret || !process.env.JFP_BOOKING_PASSWORD) return false
  const [payload, sig] = token.split('.')
  if (!payload || !sig || !tokenMatches(sig, sign(payload, secret))) return false
  try {
    const d = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    return d.exp * 1000 > nowMs && d.pv === pv()
  } catch { return false }
}
export function parentCookieHeader(token) { return `${PARENT_COOKIE}=${token}; Max-Age=${14 * 86400}; Path=/; SameSite=Lax; Secure; HttpOnly` }
export function requireParentAccess(req, res) {
  if (hasParentAccess(req)) return true
  res.status(401).json({ success: false, error: 'Enter the booking password to continue.', code: 'no_access' })
  return false
}
