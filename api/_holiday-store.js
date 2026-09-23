// School holiday booking store.
//
// Everything lives in Vercel KV (Upstash Redis over REST) under the `holiday:`
// prefix. The one piece of real concurrency control on the site is here: a
// seat is held with a single Lua script so two families tapping Book on the
// last place at the same instant cannot both succeed.
//
// Money is AUD cents. Times are ISO strings carrying the Sydney offset so a
// slot reads the same in KV, in Stripe metadata, in the roster sheet and on
// the page, whichever side of the October daylight-saving change it sits.
import crypto from 'node:crypto'

export const HOLD_MINUTES = 31
// How long an hour stays locked while a parent fills in the form, before Pay.
export const RESERVE_MINUTES = 10
export const CHECKOUT_EXPIRES_MINUTES = 30
export const CONFIRMED_SCORE = 9007199254740000
export const SESSION_TYPES = ['one', 'shared', 'group']
// 'open' slots let the first family to book choose the type; that choice
// then locks the slot for everyone after them.
export const SLOT_TYPES = [...SESSION_TYPES, 'open']
export const TYPE_LABELS = { one: '1 to 1', shared: 'Shared', group: 'Group', open: 'Your choice' }
export const GROUP_CAPACITY_DEFAULT = 6
export const TIERS = ['lee', 'coach']
const COOKIE_NAME = 'jf_holiday'
const COOKIE_DAYS = 14
const BOOKING_TTL_SECONDS = 60 * 60 * 24 * 400
const SESSION_LOOKUP_TTL_SECONDS = 60 * 60 * 48
const CLAIM_TTL_SECONDS = 60 * 60 * 24 * 60

// ---------- KV ----------

function kvConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) throw new Error('Holiday booking storage is not configured. Add KV_REST_API_URL and KV_REST_API_TOKEN in Vercel.')
  return { url: url.replace(/\/$/, ''), token }
}

async function kvPost(path, payload) {
  const { url, token } = kvConfig()
  const response = await fetch(`${url}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!response.ok) throw new Error((await response.text()) || `KV request failed: ${response.status}`)
  return response.json()
}

export async function kvCommand(command) {
  const data = await kvPost('', command)
  if (data?.error) throw new Error(data.error)
  return data?.result
}

export async function kvPipeline(commands) {
  if (!commands.length) return []
  const data = await kvPost('/pipeline', commands)
  return (Array.isArray(data) ? data : []).map((entry) => entry?.result)
}

function parseJson(value) {
  if (value == null) return null
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) } catch { return null }
}

export async function kvGetJson(key) { return parseJson(await kvCommand(['GET', key])) }
export async function kvSetJson(key, value, ttlSeconds) {
  const cmd = ['SET', key, JSON.stringify(value)]
  if (ttlSeconds) cmd.push('EX', String(ttlSeconds))
  return kvCommand(cmd)
}

// A one-shot claim. Whoever gets 'OK' owns the side effect (finalise, email,
// sheet row); everyone else must treat it as already done.
export async function claimOnce(key, ttlSeconds = CLAIM_TTL_SECONDS) {
  const result = await kvCommand(['SET', key, new Date().toISOString(), 'NX', 'EX', String(ttlSeconds)])
  return result === 'OK'
}

export const keys = {
  config: () => 'holiday:config',
  slots: () => 'holiday:slots',
  seats: (slotId) => `holiday:seats:${slotId}`,
  booking: (id) => `holiday:booking:${id}`,
  bookingsIndex: () => 'holiday:bookings',
  session: (sid) => `holiday:session:${sid}`,
  finalised: (id) => `holiday:finalised:${id}`,
  email: (id) => `holiday:email:${id}:confirmation`,
  sheet: (id) => `holiday:sheet:${id}`,
  adminAlert: (id) => `holiday:admin-alert:${id}`,
}

// ---------- small helpers ----------

export function clean(value, max = 500) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max)
}

export function newId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`
}

export function formatAud(cents) {
  const dollars = Number(cents || 0) / 100
  return `A$${dollars % 1 === 0 ? dollars.toFixed(0) : dollars.toFixed(2)}`
}

// Sydney offset for a given local wall-clock time. Evaluated twice because the
// offset depends on the instant and the instant depends on the offset; the
// second pass settles it on the day the clocks change.
export function sydneyOffset(date, time) {
  const naive = Date.UTC(...date.split('-').map(Number).map((n, i) => (i === 1 ? n - 1 : n)), ...time.split(':').map(Number))
  const offsetAt = (ms) => {
    const part = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', timeZoneName: 'longOffset' })
      .formatToParts(new Date(ms)).find((p) => p.type === 'timeZoneName')?.value || 'GMT+10:00'
    const m = part.match(/([+-])(\d{2}):(\d{2})/)
    return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 600
  }
  const first = offsetAt(naive - 10 * 60 * 60_000)
  const second = offsetAt(naive - first * 60_000)
  return second
}

export function sydneyIso(date, time) {
  const minutes = sydneyOffset(date, time)
  const sign = minutes < 0 ? '-' : '+'
  const abs = Math.abs(minutes)
  const hh = String(Math.floor(abs / 60)).padStart(2, '0')
  const mm = String(abs % 60).padStart(2, '0')
  return `${date}T${time}:00${sign}${hh}:${mm}`
}

export function addMinutesIso(iso, minutes) {
  const offset = iso.slice(19)
  const local = new Date(`${iso.slice(0, 19)}Z`).getTime() + minutes * 60_000
  return new Date(local).toISOString().slice(0, 19) + offset
}

export function sydneyDateLabel(iso) {
  return new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(iso)).replace(',', '')
}

export function sydneyTimeLabel(iso) {
  return new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', hour: 'numeric', minute: '2-digit', hour12: true })
    .format(new Date(iso)).replace(/\s?([ap])m/i, '$1m').replace(':00', '')
}

// ---------- config ----------

export const DEFAULT_CONFIG = {
  holidayLabel: 'School Holiday Sessions',
  coaches: [
    { id: 'dean', name: 'Dean', tier: 'coach', active: true },
    { id: 'lee', name: 'Lee', tier: 'lee', active: false },
    { id: 'sam', name: 'Sam', tier: 'coach', active: false },
  ],
  prices: { lee: { one: 0, shared: 0, group: 0 }, coach: { one: 0, shared: 0, group: 0 } },
  defaultLocation: 'The HQ, Belrose',
  defaultDurations: [60, 90],
  bookingCutoffHours: 2,
  updatedAt: null,
}

export function normaliseConfig(input = {}) {
  const base = structuredClone(DEFAULT_CONFIG)
  const coaches = Array.isArray(input.coaches) && input.coaches.length
    ? input.coaches.map((c) => ({
        id: clean(c.id, 40).toLowerCase().replace(/[^a-z0-9-]/g, '') || clean(c.name, 40).toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        name: clean(c.name, 60),
        tier: TIERS.includes(c.tier) ? c.tier : 'coach',
        active: c.active !== false,
      })).filter((c) => c.id && c.name)
    : base.coaches
  const prices = {}
  for (const tier of TIERS) {
    prices[tier] = {}
    for (const type of SESSION_TYPES) {
      const raw = Number(input.prices?.[tier]?.[type])
      prices[tier][type] = Number.isFinite(raw) && raw >= 0 ? Math.round(raw) : base.prices[tier][type]
    }
  }
  const durations = Array.isArray(input.defaultDurations)
    ? [...new Set(input.defaultDurations.map(Number).filter((n) => Number.isInteger(n) && n >= 30 && n <= 180))].sort((a, b) => a - b)
    : base.defaultDurations
  const cutoff = Number(input.bookingCutoffHours)
  return {
    holidayLabel: clean(input.holidayLabel, 80) || base.holidayLabel,
    coaches,
    prices,
    defaultLocation: clean(input.defaultLocation, 120) || base.defaultLocation,
    defaultDurations: durations.length ? durations : base.defaultDurations,
    bookingCutoffHours: Number.isFinite(cutoff) && cutoff >= 0 && cutoff <= 72 ? cutoff : base.bookingCutoffHours,
    updatedAt: input.updatedAt || null,
  }
}

export async function getConfig() {
  return normaliseConfig((await kvGetJson(keys.config())) || {})
}

export async function saveConfig(partial) {
  const current = await getConfig()
  const next = normaliseConfig({ ...current, ...partial, updatedAt: new Date().toISOString() })
  await kvSetJson(keys.config(), next)
  return next
}

export function coachById(config, coachId) {
  return config.coaches.find((c) => c.id === coachId) || null
}

export function resolvePriceCents(slot, config) {
  if (Number.isInteger(slot.priceCents) && slot.priceCents >= 0) return slot.priceCents
  const coach = coachById(config, slot.coachId)
  const tier = coach?.tier || 'coach'
  return Number(config.prices?.[tier]?.[slot.type] || 0)
}

// ---------- slots ----------

export function capacityForType(type, requested) {
  if (type === 'one') return 1
  if (type === 'shared') return 2
  const n = Number(requested)
  return Number.isInteger(n) && n >= 3 && n <= 20 ? n : GROUP_CAPACITY_DEFAULT
}

export function validateSlotInput(input, config) {
  const errors = []
  const coachId = clean(input.coachId, 40)
  const coach = coachById(config, coachId)
  if (!coach) errors.push('Pick a coach.')
  const date = clean(input.date, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(`${date}T00:00:00Z`).getTime())) errors.push('Date must be YYYY-MM-DD.')
  const startTime = clean(input.startTime, 5)
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime)) errors.push('Start time must be HH:MM.')
  const durationMin = Number(input.durationMin)
  if (!Number.isInteger(durationMin) || durationMin < 30 || durationMin > 180) errors.push('Duration must be between 30 and 180 minutes.')
  const type = clean(input.type, 10)
  if (!SLOT_TYPES.includes(type)) errors.push('Session type must be 1 to 1, shared, group or open.')
  const rawPrice = input.priceCents
  let priceCents = null
  if (rawPrice !== null && rawPrice !== undefined && rawPrice !== '') {
    const n = Number(rawPrice)
    if (!Number.isInteger(n) || n < 0) errors.push('Price override must be a whole number of cents, or blank.')
    else priceCents = n
  }
  if (errors.length) return { ok: false, errors }
  return {
    ok: true,
    slot: {
      coachId,
      date,
      startTime,
      durationMin,
      type,
      capacity: capacityForType(type, input.capacity),
      priceCents,
      location: clean(input.location, 120) || config.defaultLocation,
      notes: clean(input.notes, 300),
    },
  }
}

export async function listSlots({ includeCancelled = false } = {}) {
  const raw = await kvCommand(['HGETALL', keys.slots()])
  const entries = Array.isArray(raw) ? raw : []
  const slots = []
  for (let i = 0; i + 1 < entries.length; i += 2) {
    const slot = parseJson(entries[i + 1])
    if (slot && (includeCancelled || slot.status === 'open' || slot.status === 'blocked')) slots.push(slot)
  }
  return slots.sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.coachId.localeCompare(b.coachId))
}

export async function getSlot(slotId) {
  return parseJson(await kvCommand(['HGET', keys.slots(), clean(slotId, 60)]))
}

export async function upsertSlot(input, config) {
  const validated = validateSlotInput(input, config)
  if (!validated.ok) return validated
  const existing = input.id ? await getSlot(input.id) : null
  const now = new Date().toISOString()
  const startsAt = sydneyIso(validated.slot.date, validated.slot.startTime)
  const slot = {
    ...(existing || {}),
    ...validated.slot,
    id: existing?.id || newId('SLOT'),
    startsAt,
    endsAt: addMinutesIso(startsAt, validated.slot.durationMin),
    status: existing?.status || 'open',
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  }
  await kvCommand(['HSET', keys.slots(), slot.id, JSON.stringify(slot)])
  return { ok: true, slot }
}

export async function setSlotStatus(slotId, status) {
  const slot = await getSlot(slotId)
  if (!slot) return null
  slot.status = status
  slot.updatedAt = new Date().toISOString()
  await kvCommand(['HSET', keys.slots(), slot.id, JSON.stringify(slot)])
  return slot
}

export async function cancelSlot(slotId) {
  const slot = await getSlot(slotId)
  if (!slot) return null
  slot.status = 'cancelled'
  slot.updatedAt = new Date().toISOString()
  await kvCommand(['HSET', keys.slots(), slot.id, JSON.stringify(slot)])
  return slot
}

export async function reopenSlot(slotId) {
  const slot = await getSlot(slotId)
  if (!slot) return null
  slot.status = 'open'
  slot.updatedAt = new Date().toISOString()
  await kvCommand(['HSET', keys.slots(), slot.id, JSON.stringify(slot)])
  return slot
}

// ---------- slot ownership ----------

// Lee's rule: a booking owns the whole hour. Whether the family books it as
// 1 to 1, shared or group only changes the price and how many of their own
// players they list. Nobody else can buy into it.
//
// The owner is one member in a sorted set keyed by the slot. Score is the
// hold expiry, or a far-future constant once paid. Purge expired holds, then
// take the slot only if it is empty. One round trip, one atomic step.
export const HOLD_SCRIPT = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
if redis.call('ZCARD', KEYS[1]) > 0 then return 0 end
redis.call('ZADD', KEYS[1], ARGV[2], ARGV[3])
return 1`

// Returns 'held' or 'taken'.
// Pushes this booking's hold out to a new expiry, but only if it still owns
// the slot and its hold has not lapsed. Used when a parent who reserved the
// hour on opening the form goes on to pay.
export const EXTEND_SCRIPT = `
local score = redis.call('ZSCORE', KEYS[1], ARGV[3])
if not score or tonumber(score) <= tonumber(ARGV[1]) then return 0 end
redis.call('ZADD', KEYS[1], 'XX', ARGV[2], ARGV[3])
return 1`

export async function extendHold({ slotId, bookingId, holdExpiresMs, nowMs = Date.now() }) {
  const result = Number(await kvCommand(['EVAL', EXTEND_SCRIPT, '1', keys.seats(slotId), String(nowMs), String(holdExpiresMs), bookingId]))
  return result === 1
}

export async function holdSlot({ slotId, bookingId, holdExpiresMs, nowMs = Date.now() }) {
  const result = Number(await kvCommand(['EVAL', HOLD_SCRIPT, '1', keys.seats(slotId), String(nowMs), String(holdExpiresMs), bookingId]))
  return result === 1 ? 'held' : 'taken'
}

export async function confirmSlot(slotId, bookingId) {
  await kvCommand(['ZADD', keys.seats(slotId), String(CONFIRMED_SCORE), bookingId])
}

// Removes only this booking's own member, so releasing a stale booking can
// never free a slot that a newer booking now owns.
export async function releaseSlot(slotId, bookingId) {
  await kvCommand(['ZREM', keys.seats(slotId), bookingId])
}

// { slotId: { booked: boolean, ownerId: string|null } }
export async function slotOwners(slotIds, nowMs = Date.now()) {
  if (!slotIds.length) return {}
  const commands = slotIds.flatMap((id) => [
    ['ZREMRANGEBYSCORE', keys.seats(id), '-inf', String(nowMs)],
    ['ZRANGE', keys.seats(id), '0', '0'],
  ])
  const results = await kvPipeline(commands)
  const owners = {}
  slotIds.forEach((id, i) => {
    const members = Array.isArray(results[i * 2 + 1]) ? results[i * 2 + 1] : []
    owners[id] = { booked: members.length > 0, ownerId: members[0] || null }
  })
  return owners
}

// ---------- bookings ----------

export async function saveBooking(booking) {
  // A reservation nobody paid for is only worth keeping briefly.
  const ttl = booking.status === 'reserving' ? 60 * 60 * 24 : BOOKING_TTL_SECONDS
  await kvSetJson(keys.booking(booking.id), booking, ttl)
  return booking
}

export async function getBookings(ids) {
  if (!ids.length) return []
  const results = await kvPipeline(ids.map((id) => ['GET', keys.booking(id)]))
  return results.map(parseJson)
}

export async function getBooking(id) {
  const cleanId = clean(id, 60)
  return cleanId ? kvGetJson(keys.booking(cleanId)) : null
}

export async function indexBooking(booking) {
  await kvCommand(['ZADD', keys.bookingsIndex(), String(new Date(booking.createdAt).getTime()), booking.id])
  if (booking.stripeSessionId) await kvCommand(['SET', keys.session(booking.stripeSessionId), booking.id, 'EX', String(SESSION_LOOKUP_TTL_SECONDS)])
}

export async function bookingIdForSession(sessionId) {
  const id = await kvCommand(['GET', keys.session(clean(sessionId, 120))])
  return typeof id === 'string' ? id : null
}

export async function listBookings({ limit = 500 } = {}) {
  const ids = await kvCommand(['ZREVRANGE', keys.bookingsIndex(), '0', String(Math.max(0, limit - 1))])
  if (!Array.isArray(ids) || !ids.length) return []
  const results = await kvPipeline(ids.map((id) => ['GET', keys.booking(id)]))
  return results.map(parseJson).filter(Boolean)
}

// ---------- access cookie ----------

function sha256(value) { return crypto.createHash('sha256').update(String(value)).digest() }
function b64url(buf) { return Buffer.from(buf).toString('base64url') }

export function passwordVersion(password = process.env.HOLIDAY_BOOKING_PASSWORD) {
  return password ? sha256(password).toString('hex').slice(0, 12) : ''
}

export function passwordMatches(supplied, expected = process.env.HOLIDAY_BOOKING_PASSWORD) {
  if (!expected || typeof supplied !== 'string') return false
  return crypto.timingSafeEqual(sha256(supplied), sha256(expected))
}

function cookieSignature(payload, secret) {
  return crypto.createHmac('sha256', secret).update(`jf-holiday-v1:${payload}`).digest('base64url')
}

export function signAccessCookie({ secret = process.env.HOLIDAY_SIGNING_SECRET, password = process.env.HOLIDAY_BOOKING_PASSWORD, nowMs = Date.now() } = {}) {
  if (!secret) throw new Error('HOLIDAY_SIGNING_SECRET is not configured.')
  const payload = b64url(JSON.stringify({ exp: Math.floor(nowMs / 1000) + COOKIE_DAYS * 86400, pv: passwordVersion(password) }))
  return `${payload}.${cookieSignature(payload, secret)}`
}

export function verifyAccessCookie(token, { secret = process.env.HOLIDAY_SIGNING_SECRET, password = process.env.HOLIDAY_BOOKING_PASSWORD, nowMs = Date.now() } = {}) {
  if (!secret || !password || typeof token !== 'string') return false
  const [payload, sig] = token.split('.')
  if (!payload || !sig) return false
  const expected = cookieSignature(payload, secret)
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false
  let data
  try { data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) } catch { return false }
  if (!data || Number(data.exp) * 1000 < nowMs) return false
  return data.pv === passwordVersion(password)
}

export function readCookie(req, name = COOKIE_NAME) {
  const header = req.headers?.cookie || ''
  return header.split(';').map((v) => v.trim()).find((v) => v.startsWith(`${name}=`))?.slice(name.length + 1)
}

export function accessCookieHeader(token) {
  return `${COOKIE_NAME}=${token}; Max-Age=${COOKIE_DAYS * 86400}; Path=/; SameSite=Lax; Secure; HttpOnly`
}

export function clearAccessCookieHeader() {
  return `${COOKIE_NAME}=; Max-Age=0; Path=/; SameSite=Lax; Secure; HttpOnly`
}

export function hasHolidayAccess(req) {
  return verifyAccessCookie(readCookie(req))
}

export function requireHolidayAccess(req, res) {
  if (hasHolidayAccess(req)) return true
  res.status(401).json({ success: false, error: 'Enter the holiday booking password to continue.', code: 'no_access' })
  return false
}

export function requireAdmin(req, body = {}) {
  const secret = process.env.HOLIDAY_ADMIN_SECRET
  if (!secret) return false
  const supplied = String(req.headers?.['x-holiday-admin-secret'] || body.secret || '')
  if (!supplied || supplied.length !== secret.length) return false
  return crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(secret))
}

// ---------- stripe ----------

export function stripeSecret() {
  return process.env.STRIPE_HOLIDAY_SECRET_KEY || process.env.STRIPE_SECRET_KEY_SYDNEY || ''
}

export async function stripeFetch(path, { method = 'GET', body } = {}) {
  const secret = stripeSecret()
  if (!secret) throw new Error('STRIPE_SECRET_KEY_SYDNEY is not configured.')
  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${secret}`,
      ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: body ? new URLSearchParams(body) : undefined,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data?.error?.message || `Stripe request failed: ${response.status}`)
  return data
}

// Closes an unpaid Checkout Session so a released hour cannot be paid for
// afterwards. Best effort: a session that is already complete or expired
// refuses, which is fine.
export async function expireCheckoutSession(sessionId) {
  if (!sessionId) return false
  try {
    await stripeFetch(`/checkout/sessions/${encodeURIComponent(sessionId)}/expire`, { method: 'POST', body: {} })
    return true
  } catch (error) {
    console.warn('holiday checkout expire skipped', sessionId, error.message)
    return false
  }
}

export function siteUrl(req) {
  return (process.env.PUBLIC_SITE_URL || process.env.SITE_URL || `https://${req?.headers?.host || 'jonerfootball.com'}`).replace(/\/$/, '')
}

// ---------- cancellation policy ----------

// Lee's policy: cancel 24 hours or more before the session for a full
// refund. Inside 24 hours, half is refunded. Refunds are made by hand in
// Stripe; this only works out what is owed.
export const CANCELLATION_POLICY = 'Cancel 24 hours or more before your session for a full refund. Cancellations within 24 hours of the session are refunded 50%.'

export function refundFor(booking, slot, nowMs = Date.now()) {
  const paid = Number(booking.amountPaidCents ?? booking.priceCents ?? 0)
  const startsMs = slot?.startsAt ? new Date(slot.startsAt).getTime() : 0
  const hoursBefore = startsMs ? (startsMs - nowMs) / 3_600_000 : 0
  const percent = hoursBefore >= 24 ? 100 : 50
  return { percent, cents: Math.round(paid * percent / 100), paidCents: paid, hoursBefore: Math.round(hoursBefore * 10) / 10 }
}

// ---------- public shapes ----------

// The ways a family can book this hour, and what each costs per player.
export function maxPlayersForType(slot, type) {
  if (type === 'one') return 1
  if (type === 'shared') return 2
  return Math.max(3, Number(slot.capacity) || GROUP_CAPACITY_DEFAULT)
}

export function slotOptions(slot, config) {
  const types = slot.type === 'open' ? SESSION_TYPES : [slot.type]
  return types.map((type) => ({
    type,
    label: TYPE_LABELS[type],
    maxPlayers: maxPlayersForType(slot, type),
    priceCents: resolvePriceCents({ ...slot, type }, config),
    priceLabel: formatAud(resolvePriceCents({ ...slot, type }, config)),
  }))
}

export function publicSlot(slot, config, owner = { booked: false, ownerId: null, pending: false }) {
  const coach = coachById(config, slot.coachId)
  const booked = slot.status === 'blocked' || Boolean(owner?.booked)
  // pending: another parent has it open or is paying, so it may yet come free.
  const pending = slot.status !== 'blocked' && Boolean(owner?.booked && owner?.pending)
  return {
    id: slot.id,
    coachId: slot.coachId,
    coachName: coach?.name || slot.coachId,
    coachTier: coach?.tier || 'coach',
    date: slot.date,
    dateLabel: sydneyDateLabel(slot.startsAt),
    startTime: slot.startTime,
    startLabel: sydneyTimeLabel(slot.startsAt),
    endLabel: sydneyTimeLabel(slot.endsAt),
    startsAt: slot.startsAt,
    endsAt: slot.endsAt,
    durationMin: slot.durationMin,
    type: slot.type,
    typeLabel: TYPE_LABELS[slot.type],
    maxPlayers: maxPlayersForType(slot, slot.type === 'open' ? 'group' : slot.type),
    options: slotOptions(slot, config),
    booked,
    pending,
    ownerId: owner?.ownerId || null,
    location: slot.location,
    notes: slot.notes || '',
    status: slot.status,
  }
}

export function bookingSummary(booking, slot, config) {
  const coach = slot ? coachById(config, slot.coachId) : null
  return {
    id: booking.id,
    status: booking.status,
    seats: booking.seats,
    players: (booking.players || []).map((p) => ({ name: p.name })),
    coachName: coach?.name || booking.coachName || '',
    typeLabel: TYPE_LABELS[booking.type] || booking.type,
    dateLabel: slot ? sydneyDateLabel(slot.startsAt) : '',
    startLabel: slot ? sydneyTimeLabel(slot.startsAt) : '',
    endLabel: slot ? sydneyTimeLabel(slot.endsAt) : '',
    startsAt: slot?.startsAt || '',
    endsAt: slot?.endsAt || '',
    location: slot?.location || '',
    priceCents: booking.priceCents,
    priceLabel: formatAud(booking.priceCents),
    needsAttention: booking.needsAttention || '',
  }
}
