// Extra sessions (Lee, 14 Oct 2026). A coach opens extra hours in their own
// portal: public sessions any family can book from My account, or private
// ones with their own link for a player they booked with directly (Dean and
// Sienna Hawkins: a plain $120 Stripe link that nothing could match). A coach
// can also put a player straight onto a session, so it shows in that
// family's account to pay. Everything is tied to a player and a coach, so it
// reconciles, counts in the coach's hours and has a register.
//
// Prices come only from Lee and Ligia: coaches pick from the extra session
// prices they set (config.extraPrices). Payments go through the Revenue
// session's player charges (api/_jfp-charges.js, kind 'extra',
// ref 'extra:<slotId>'); this file holds the sessions and the places.
//
// KV: hash jfp:extra, slot id -> slot. Attendance: jfp:att:<slotId>:<date>.
import crypto from 'node:crypto'
import { kvCommand, clean, newId, coachById, coachLabel, sydneyToday, to24h, dateLabel, formatAud, audit, locationFor, validEmail } from './_jfp-store.js'
import { sydneyWallToUtcMs } from './_jfp-cancel.js'
import { upsertAttendance, clearAttendance } from './_jfp-airtable.js'

export const EXTRA = 'jfp:extra'
export const EXTRA_DAYS_AHEAD = 120
const ID = /^XS-[0-9A-Za-z-]{4,40}$/
const ISO = /^\d{4}-\d{2}-\d{2}$/
const parse = (v) => { try { return v ? JSON.parse(v) : null } catch { return null } }
const addDays = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

export { cleanExtraPrices, newExtraPrice } from './_jfp-extra-prices.js'
import { cleanExtraPrices } from './_jfp-extra-prices.js'

// ---------- store ----------

export async function allSlots() {
  const raw = (await kvCommand(['HGETALL', EXTRA])) || []
  const out = []
  for (let i = 0; i + 1 < raw.length; i += 2) { const s = parse(raw[i + 1]); if (s) out.push(s) }
  return out.sort((a, b) => `${a.date} ${to24h(a.time)}`.localeCompare(`${b.date} ${to24h(b.time)}`))
}
export async function getSlot(id) { return ID.test(id || '') ? parse(await kvCommand(['HGET', EXTRA, id])) : null }
async function putSlot(s) { await kvCommand(['HSET', EXTRA, s.id, JSON.stringify(s)]) }

export const liveBookings = (s) => (s.bookings || []).filter((b) => b.status !== 'removed')
export const placesLeft = (s) => Math.max(0, s.capacity - liveBookings(s).length)
export function startMs(s) { const t = to24h(s.time); return t ? sydneyWallToUtcMs(s.date, t) : 0 }
export const endMs = (s) => startMs(s) + (Number(s.durationMin) || 60) * 60000

// ---------- what each person sees ----------

const linkFor = (s) => `https://jonerfootball.com/jfp-account/#extra?slot=${encodeURIComponent(s.id)}${s.visibility === 'private' ? `&k=${encodeURIComponent(s.token)}` : ''}`

// Coaches and staff: everything, with each booking's payment.
export function staffView(config, s, payreqs = []) {
  const coach = coachById(config, s.coachId)
  return {
    ...s, token: undefined,
    coachName: coachLabel(coach), dateLabel: dateLabel(s.date), placesLeft: placesLeft(s), priceLabel: formatAud(s.priceCents),
    link: linkFor(s), past: endMs(s) < Date.now(),
    bookings: liveBookings(s).map((b) => {
      const q = b.payreqId ? payreqs.find((x) => x.id === b.payreqId) : null
      return { ...b, paid: q?.status === 'paid', payStatus: q ? q.status : b.payreqId ? 'unknown' : 'no charge yet' }
    }),
  }
}
// Families (the Revenue session's #extra page): no other family's details.
export function familyView(config, s) {
  const loc = locationFor(config, s.location)
  return {
    id: s.id, coachId: s.coachId, coachName: coachLabel(coachById(config, s.coachId)), date: s.date, dateLabel: dateLabel(s.date),
    time: s.time, durationMin: s.durationMin, location: loc.name, address: loc.address || '', capacity: s.capacity, placesLeft: placesLeft(s),
    priceCents: s.priceCents, priceLabel: formatAud(s.priceCents), label: s.title || s.priceLabel, visibility: s.visibility, note: s.publicNote || '',
  }
}

// Open future slots. publicOnly for anyone browsing; a private one only with its token.
export async function listExtraSlots({ config, publicOnly = true, coachId = '' }) {
  const now = Date.now()
  return (await allSlots()).filter((s) => s.status === 'open' && startMs(s) > now && (!publicOnly || s.visibility === 'public') && (!coachId || s.coachId === coachId)).map((s) => familyView(config, s))
}
export async function getExtraSlot({ config, id, token = '' }) {
  const s = await getSlot(id)
  if (!s || s.status !== 'open') return null
  if (s.visibility === 'private' && !(token && s.token && crypto.timingSafeEqual(Buffer.from(sha(token)), Buffer.from(sha(s.token))))) return null
  return familyView(config, s)
}
const sha = (v) => crypto.createHash('sha256').update(String(v)).digest('hex')

// ---------- coaches and staff ----------

// Create or edit a slot. A coach only ever touches their own.
export async function saveSlot({ config, principal, isAdmin, input }) {
  const before = input.id ? await getSlot(input.id) : null
  if (input.id && !before) return { error: 'That session is gone.' }
  if (before && !isAdmin && before.coachId !== principal.coachId) return { error: 'Not your session.' }
  const coachId = isAdmin ? clean(input.coachId, 30) || before?.coachId || principal.coachId || '' : principal.coachId
  if (!coachById(config, coachId)) return { error: 'Choose the coach.' }
  const today = sydneyToday()
  const date = ISO.test(input.date || '') ? input.date : ''
  if (!date || date < today || date > addDays(today, EXTRA_DAYS_AHEAD)) return { error: `Pick a date from today to ${dateLabel(addDays(today, EXTRA_DAYS_AHEAD))}.` }
  const time = to24h(input.time) ? clean(input.time, 10) : ''
  if (!time) return { error: 'Pick a start time, like 4:30pm.' }
  const capacity = Number(input.capacity)
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 20) return { error: 'Places: 1 to 20.' }
  if (before && liveBookings(before).length > capacity) return { error: `${liveBookings(before).length} players are already booked. Remove one first, or keep more places.` }
  const location = clean(input.location, 80)
  if (!location) return { error: 'Where is it?' }
  // The price: one Lee or Ligia set. Only they can type their own amount.
  const prices = cleanExtraPrices(config.extraPrices).filter((p) => !p.archived)
  const picked = prices.find((p) => p.id === input.priceId)
  let priceCents, priceLabel, durationMin
  if (picked) { priceCents = picked.cents; priceLabel = picked.label; durationMin = Number(input.durationMin) || picked.durationMin }
  else if (isAdmin && Number.isInteger(Number(input.priceCents)) && Number(input.priceCents) >= 100 && Number(input.priceCents) <= 200000) { priceCents = Number(input.priceCents); priceLabel = clean(input.title, 60) || 'Extra session'; durationMin = Number(input.durationMin) || 60 }
  else if (before && !input.priceId) { priceCents = before.priceCents; priceLabel = before.priceLabel; durationMin = Number(input.durationMin) || before.durationMin }
  else return { error: prices.length ? 'Pick a price.' : 'No extra session prices yet. Lee or Ligia add them on the Extra sessions page.' }
  // Paid bookings keep the price they were charged.
  if (before && liveBookings(before).some((b) => b.payreqId) && priceCents !== before.priceCents) return { error: 'Players are already charged for this session, so its price cannot change. Make a new session instead.' }
  if (!(durationMin >= 15 && durationMin <= 240)) return { error: 'Length: 15 minutes to 4 hours.' }
  const visibility = input.visibility === 'public' ? 'public' : 'private'
  const slot = {
    id: before?.id || newId('XS'), coachId, date, time, durationMin, location, capacity,
    priceId: picked?.id || before?.priceId || '', priceCents, priceLabel,
    title: clean(input.title, 60) || priceLabel, publicNote: clean(input.publicNote, 200), note: clean(input.note, 300),
    visibility, token: before?.token || crypto.randomBytes(12).toString('base64url'),
    status: 'open', bookings: before?.bookings || [],
    createdBy: before?.createdBy || principal.email, createdAt: before?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(),
  }
  await putSlot(slot)
  await audit({ by: principal.email, action: before ? 'extra.edit' : 'extra.create', target: slot.id, after: { coach: coachId, date, time, visibility, capacity, cents: priceCents } })
  return { slot, created: !before }
}

export async function cancelSlot({ principal, isAdmin, id }) {
  const s = await getSlot(id)
  if (!s) return { error: 'That session is gone.' }
  if (!isAdmin && s.coachId !== principal.coachId) return { error: 'Not your session.' }
  if (liveBookings(s).length && !isAdmin) return { error: 'Players are booked on this one. Ask Lee or Ligia to cancel it, so their payments are sorted.' }
  s.status = 'cancelled'; s.cancelledBy = principal.email; s.cancelledAt = new Date().toISOString()
  await putSlot(s)
  await audit({ by: principal.email, action: 'extra.cancel', target: s.id, after: { booked: liveBookings(s).length } })
  return { slot: s }
}

// Hold a place for a player: from the coach (attach) or a family booking.
// Atomic enough for a small session: one lock per slot.
export async function reserveExtraPlace({ slotId, rowId = '', profileKey = '', name, email = '', mobile = '', payreqId = '', by, from }) {
  if ((await kvCommand(['SET', `jfp:extra-lock:${slotId}`, '1', 'NX', 'EX', '15'])) !== 'OK') return { error: 'Someone is booking this session right now. Try again in a moment.' }
  try {
    const s = await getSlot(slotId)
    if (!s || s.status !== 'open') return { error: 'That session is not open.' }
    if (startMs(s) < Date.now() - 6 * 3600000) return { error: 'That session has finished.' }
    const nm = clean(name, 80)
    if (nm.length < 2) return { error: "Enter the player's name." }
    const em = email ? validEmail(email) : ''
    if (email && !em) return { error: 'That email does not look right.' }
    const same = liveBookings(s).find((b) => (rowId && b.rowId === rowId) || (em && b.email === em && b.name.toLowerCase() === nm.toLowerCase()))
    if (same) return { booking: same, already: true, slot: s }
    if (!placesLeft(s)) return { error: 'That session is full.' }
    const booking = { id: newId('XB'), name: nm, email: em, mobile: clean(mobile, 30), rowId: clean(rowId, 30), profileKey: clean(profileKey, 200), payreqId: clean(payreqId, 60), status: 'booked', at: new Date().toISOString(), by, from }
    s.bookings = [...(s.bookings || []), booking]
    await putSlot(s)
    await audit({ by, action: 'extra.book', target: s.id, after: { booking: booking.id, from, player: nm } })
    return { booking, slot: s }
  } finally { await kvCommand(['DEL', `jfp:extra-lock:${slotId}`]) }
}
// The charge made after the place was held.
export async function setBookingCharge({ slotId, bookingId, payreqId }) {
  const s = await getSlot(slotId)
  const b = s?.bookings?.find((x) => x.id === bookingId)
  if (!b) return false
  b.payreqId = clean(payreqId, 60)
  await putSlot(s)
  return true
}
export async function removeBooking({ principal, isAdmin, slotId, bookingId }) {
  const s = await getSlot(slotId)
  if (!s) return { error: 'That session is gone.' }
  if (!isAdmin && s.coachId !== principal.coachId) return { error: 'Not your session.' }
  const b = (s.bookings || []).find((x) => x.id === bookingId && x.status !== 'removed')
  if (!b) return { error: 'That player is not on this session.' }
  b.status = 'removed'; b.removedBy = principal.email; b.removedAt = new Date().toISOString()
  await putSlot(s)
  await audit({ by: principal.email, action: 'extra.unbook', target: s.id, after: { booking: b.id, player: b.name, charged: Boolean(b.payreqId) } })
  return { slot: s, booking: b }
}

// The coach has been told about a booking a family made themselves.
export async function markTold(slotId, bookingId) {
  const s = await getSlot(slotId)
  const b = s?.bookings?.find((x) => x.id === bookingId)
  if (!b || b.coachTold) return false
  b.coachTold = new Date().toISOString()
  await putSlot(s)
  return true
}

// ---------- register and hours ----------

export const attKey = (s) => `jfp:att:${s.id}:${s.date}`
export async function marksFor(s) {
  const raw = (await kvCommand(['HGETALL', attKey(s)])) || []
  const o = {}
  for (let i = 0; i + 1 < raw.length; i += 2) o[raw[i]] = raw[i + 1]
  return o
}
export async function markBooking({ config, principal, isAdmin, slotId, bookingId, status }) {
  const s = await getSlot(slotId)
  if (!s) return { error: 'That session is gone.' }
  if (!isAdmin && s.coachId !== principal.coachId) return { error: 'Not your session.' }
  const b = liveBookings(s).find((x) => x.id === bookingId)
  if (!b) return { error: 'That player is not on this session.' }
  if (s.date > sydneyToday()) return { error: 'Mark the register on the day.' }
  if (!['Present', 'Absent', ''].includes(status)) return { error: 'Invalid status.' }
  if (status) await kvCommand(['HSET', attKey(s), b.id, status]); else await kvCommand(['HDEL', attKey(s), b.id])
  // The Attendance table in Airtable too, which coach invoices are checked against.
  const day = new Intl.DateTimeFormat('en-AU', { timeZone: 'UTC', weekday: 'long' }).format(new Date(`${s.date}T12:00:00Z`))
  let airtable = true
  try {
    if (status) await upsertAttendance({ attendanceId: `${s.id}|${b.id}`, playerName: b.name, week: 0, date: s.date, group: { day, time: s.time, location: s.location }, coachName: coachLabel(coachById(config, s.coachId)), status, markedBy: principal.email, programme: 'JFP Extra session' })
    else await clearAttendance({ attendanceId: `${s.id}|${b.id}`, markedBy: principal.email })
  } catch (error) { console.error('jfp extra attendance airtable failed', error); airtable = false }
  return { slot: s, booking: b, status, airtable }
}

// Minutes of extra sessions a coach runs in a week (Monday to Sunday) that
// actually have a player booked.
export function extraMinutes(slots, coachId, fromIso, toIso) {
  return slots.filter((s) => s.coachId === coachId && s.status === 'open' && s.date >= fromIso && s.date <= toIso && liveBookings(s).length).reduce((t, s) => t + (Number(s.durationMin) || 60), 0)
}
