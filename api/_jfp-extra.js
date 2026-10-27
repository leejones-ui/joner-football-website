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
// Three kinds (Lee, 19 Oct 2026), chosen when the session is made:
//   oneoff   public, on the date(s) picked: the booking page and My account
//   private  a link only, for a player booked with the coach. Never listed
//            anywhere public (Dean and Sienna, 19 Oct 2026)
//   weekly   a permanent weekly slot: public, one session each week to the
//            end of term, all sharing a seriesId
// Lee and Ligia see every kind on the Timetable (board).
//
// Whole session (Lee, 27 Oct 2026, like holiday training): instead of each
// player taking a place, the first family to book takes the whole session for
// their own group, first come first served. The coach offers one or both of
//   1 on 1   one player, at its price
//   group    a group of minPlayers to maxPlayers (Lee's 11am: 3 or 4 only)
// with a price per player for each (slot.options). The booker can bring other
// players by name; every player is a booking with the same groupId, and the
// one charge (per player price x players) sits on the first booking.
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
import { getConfig as getHolidayConfig } from './_holiday-store.js'

// ---------- store ----------

export async function allSlots() {
  const raw = (await kvCommand(['HGETALL', EXTRA])) || []
  const out = []
  for (let i = 0; i + 1 < raw.length; i += 2) { const s = parse(raw[i + 1]); if (s) out.push(s) }
  return out.sort((a, b) => `${a.date} ${to24h(a.time)}`.localeCompare(`${b.date} ${to24h(b.time)}`))
}
// Every booking id in a whole-session group (just the one id for a place
// booking), so auto charge reads the whole group's register marks.
export async function groupBookingIds(slotId, bookingId) {
  const s = await getSlot(slotId)
  const ids = (s?.bookings || []).filter((b) => b.groupId === bookingId).map((b) => b.id)
  return ids.length ? ids : [bookingId]
}
export async function getSlot(id) { return ID.test(id || '') ? parse(await kvCommand(['HGET', EXTRA, id])) : null }
async function putSlot(s) { await kvCommand(['HSET', EXTRA, s.id, JSON.stringify(s)]) }

// Holiday prices (Lee, 27 Oct 2026): the coach's holiday rates, so a group
// of 2 pays the shared price each and 3 or more the group price each.
export const perPlayerCents = (o, n) => (o.pairCents && n === 2 ? o.pairCents : o.priceCents)
async function holidayRates(coachId) {
  const hc = await getHolidayConfig()
  const tier = hc.coaches?.find((c) => c.id === coachId)?.tier || 'coach'
  return hc.prices?.[tier] || {}
}
export const liveBookings = (s) => (s.bookings || []).filter((b) => b.status !== 'removed')
export const isWhole = (s) => Array.isArray(s?.options) && s.options.length > 0
// A whole session is either free (every place) or taken by one group.
export const placesLeft = (s) => (isWhole(s) ? (liveBookings(s).length ? 0 : s.capacity) : Math.max(0, s.capacity - liveBookings(s).length))
const OPTION_LABEL = { one: '1 on 1', group: 'Group' }
// "1 on 1", "Group of 3 to 4", "Group of up to 4", "Group of 4".
export function optionLabel(o) {
  if (o.type === 'one') return OPTION_LABEL.one
  return o.minPlayers === o.maxPlayers ? `Group of ${o.maxPlayers}` : o.minPlayers <= 2 ? `Group of up to ${o.maxPlayers}` : `Group of ${o.minPlayers} to ${o.maxPlayers}`
}
// What families read about a whole session: "1 on 1 or a group of up to 4".
export function optionsSummary(options) {
  return options.map((o, i) => (i ? optionLabel(o).replace(/^Group/, 'a group') : optionLabel(o))).join(' or ')
}
// The coach's options, checked: a price each (one Lee or Ligia set, or an
// amount only they can type), and sizes that make sense.
function cleanOptions(raw, prices, isAdmin, before, holiday = {}) {
  const out = []
  for (const o of (Array.isArray(raw) ? raw : []).slice(0, 2)) {
    const type = o?.type === 'one' ? 'one' : o?.type === 'group' ? 'group' : ''
    if (!type || out.some((x) => x.type === type)) continue
    const maxPlayers = type === 'one' ? 1 : Number(o.maxPlayers)
    const minPlayers = type === 'one' ? 1 : Number(o.minPlayers) || 2
    if (type === 'group' && (!Number.isInteger(maxPlayers) || maxPlayers < 2 || maxPlayers > 20)) return { error: 'Group: the most players is 2 to 20.' }
    if (type === 'group' && (!Number.isInteger(minPlayers) || minPlayers < 2 || minPlayers > maxPlayers)) return { error: `Group: the fewest players is 2 to ${maxPlayers}. A single player books 1 on 1.` }
    const picked = prices.find((p) => p.id === o.priceId)
    const old = before?.options?.find((x) => x.type === type)
    let priceCents, priceId = '', pairCents = 0
    if (o.priceId === '__holiday') {
      priceCents = Number(type === 'one' ? holiday.one : holiday.group); priceId = '__holiday'
      if (type === 'group' && maxPlayers === 2) priceCents = Number(holiday.shared)
      else if (type === 'group' && minPlayers <= 2 && Number(holiday.shared) > 0) pairCents = Number(holiday.shared)
      if (!(priceCents > 0)) return { error: 'The holiday prices are not set. Pick a price instead.' }
    }
    else if (picked) { priceCents = picked.cents; priceId = picked.id }
    else if (isAdmin && Number.isInteger(Number(o.priceCents)) && Number(o.priceCents) >= 100 && Number(o.priceCents) <= 200000) priceCents = Number(o.priceCents)
    else if (old && !o.priceId && o.priceCents == null) { priceCents = old.priceCents; priceId = old.priceId || ''; if (type === 'group' && minPlayers <= 2) pairCents = old.pairCents || 0 }
    else return { error: `Pick a price for ${type === 'one' ? '1 on 1' : 'the group'}.` }
    const priceLabel = pairCents ? `${formatAud(pairCents)} each for 2, ${formatAud(priceCents)} each for 3 or more` : formatAud(priceCents)
    const opt = { id: type, type, minPlayers, maxPlayers, priceId, priceCents, ...(pairCents ? { pairCents } : {}), priceLabel }
    out.push({ ...opt, label: optionLabel(opt) })
  }
  if (!out.length) return { error: 'Tick 1 on 1, a group, or both.' }
  return { options: out }
}
export function startMs(s) { const t = to24h(s.time); return t ? sydneyWallToUtcMs(s.date, t) : 0 }
export const endMs = (s) => startMs(s) + (Number(s.durationMin) || 60) * 60000
export const KIND_LABEL = { oneoff: 'One-off', private: 'Private link', weekly: 'Weekly slot' }
// Older slots have no kind: public ones were one-offs.
export const kindOf = (s) => (s.visibility !== 'public' ? 'private' : s.kind === 'weekly' ? 'weekly' : 'oneoff')
// The dates of a weekly slot: the first date, then every 7 days to the end of
// term (and never more than EXTRA_DAYS_AHEAD out).
export function weeklyDates(config, first, today = sydneyToday()) {
  if (!ISO.test(first || '')) return []
  const termEnd = config?.termStart ? addDays(config.termStart, (Number(config.weeks) || 10) * 7 - 1) : ''
  const last = [termEnd, addDays(today, EXTRA_DAYS_AHEAD)].filter(Boolean).sort()[0]
  const out = []
  for (let d = first; d <= last && out.length < 20; d = addDays(d, 7)) out.push(d)
  return out
}

// ---------- what each person sees ----------

const linkFor = (s) => `https://jonerfootball.com/jfp-account/#extra?slot=${encodeURIComponent(s.id)}${s.visibility === 'private' ? `&k=${encodeURIComponent(s.token)}` : ''}`

// Coaches and staff: everything, with each booking's payment.
export function staffView(config, s, payreqs = []) {
  const coach = coachById(config, s.coachId)
  return {
    ...s, token: undefined, kind: kindOf(s), kindLabel: KIND_LABEL[kindOf(s)],
    coachName: coachLabel(coach), dateLabel: dateLabel(s.date), placesLeft: placesLeft(s), priceLabel: formatAud(s.priceCents),
    link: linkFor(s), past: endMs(s) < Date.now(),
    ...(isWhole(s) ? { whole: true, optionsLabel: optionsSummary(s.options) } : {}),
    bookings: liveBookings(s).map((b) => {
      // A group's players are paid for on the first booking's charge.
      const lead = b.groupId && !b.payreqId ? liveBookings(s).find((x) => x.id === b.groupId) : null
      const q = (b.payreqId || lead?.payreqId) ? payreqs.find((x) => x.id === (b.payreqId || lead.payreqId)) : null
      return { ...b, paid: q?.status === 'paid', payStatus: q ? q.status : b.payreqId ? 'unknown' : 'no charge yet', ...(lead ? { inGroupOf: lead.name } : {}) }
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
    weekly: kindOf(s) === 'weekly', dayName: new Date(`${s.date}T12:00:00Z`).toLocaleDateString('en-AU', { weekday: 'long', timeZone: 'UTC' }),
    createdAt: s.createdAt || '',
    ...(isWhole(s) ? { whole: true, options: s.options.map(({ id, type, label, minPlayers, maxPlayers, priceCents, pairCents, priceLabel }) => ({ id, type, label, minPlayers, maxPlayers, priceCents, ...(pairCents ? { pairCents } : {}), priceLabel })), optionsLabel: optionsSummary(s.options) } : {}),
  }
}

// Open future slots. publicOnly for anyone browsing; a private one only with
// its token. Public lists leave out full sessions, so a session a coach filled
// with their own player never shows to other families.
export async function listExtraSlots({ config, publicOnly = true, coachId = '' }) {
  const now = Date.now()
  return (await allSlots()).filter((s) => s.status === 'open' && startMs(s) > now && (!publicOnly || (s.visibility === 'public' && placesLeft(s) > 0)) && (!coachId || s.coachId === coachId)).map((s) => familyView(config, s))
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
  // Whole session: the options decide the price and the most players.
  const prices = cleanExtraPrices(config.extraPrices).filter((p) => !p.archived)
  let options = null
  if (input.bookAs === 'whole') {
    const o = cleanOptions(input.options, prices, isAdmin, before, await holidayRates(coachId))
    if (o.error) return { error: o.error }
    options = o.options
  }
  if (before && liveBookings(before).length && Boolean(options) !== isWhole(before)) return { error: 'Players are already booked, so how it is booked cannot change. Make a new session instead.' }
  if (before && options && liveBookings(before).length && JSON.stringify(options.map((x) => [x.type, x.priceCents, x.pairCents || 0])) !== JSON.stringify(before.options.map((x) => [x.type, x.priceCents, x.pairCents || 0]))) return { error: 'A family has already booked this session, so its options and prices cannot change. Make a new session instead.' }
  const capacity = options ? Math.max(...options.map((x) => x.maxPlayers)) : Number(input.capacity)
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 20) return { error: 'Places: 1 to 20.' }
  if (before && !options && liveBookings(before).length > capacity) return { error: `${liveBookings(before).length} players are already booked. Remove one first, or keep more places.` }
  const location = clean(input.location, 80)
  if (!location) return { error: 'Where is it?' }
  // The price: one Lee or Ligia set. Only they can type their own amount.
  const picked = options ? null : prices.find((p) => p.id === input.priceId)
  let priceCents, priceLabel, durationMin
  // A whole session's headline price is its cheapest option per player.
  if (options) { const lo = options.reduce((a, b) => (b.priceCents < a.priceCents ? b : a)); priceCents = lo.priceCents; priceLabel = clean(input.title, 60) || optionsSummary(options); durationMin = Number(input.durationMin) || 60 }
  else if (picked) { priceCents = picked.cents; priceLabel = picked.label; durationMin = Number(input.durationMin) || picked.durationMin }
  else if (isAdmin && Number.isInteger(Number(input.priceCents)) && Number(input.priceCents) >= 100 && Number(input.priceCents) <= 200000) { priceCents = Number(input.priceCents); priceLabel = clean(input.title, 60) || 'Extra session'; durationMin = Number(input.durationMin) || 60 }
  else if (before && !input.priceId) { priceCents = before.priceCents; priceLabel = before.priceLabel; durationMin = Number(input.durationMin) || before.durationMin }
  else return { error: prices.length ? 'Pick a price.' : 'No extra session prices yet. Lee or Ligia add them on the Extra sessions page.' }
  // Paid bookings keep the price they were charged.
  if (!options && before && liveBookings(before).some((b) => b.payreqId) && priceCents !== before.priceCents) return { error: 'Players are already charged for this session, so its price cannot change. Make a new session instead.' }
  if (!(durationMin >= 15 && durationMin <= 240)) return { error: 'Length: 15 minutes to 4 hours.' }
  // The kind decides who can see it. Anything not clearly public is private.
  const kind = ['oneoff', 'private', 'weekly'].includes(input.kind) ? input.kind : before ? kindOf(before) : input.visibility === 'public' ? 'oneoff' : 'private'
  const visibility = kind === 'private' ? 'private' : 'public'
  const slot = {
    id: before?.id || newId('XS'), coachId, date, time, durationMin, location, capacity,
    priceId: options ? '' : picked?.id || before?.priceId || '', priceCents, priceLabel, ...(options ? { options } : {}),
    title: clean(input.title, 60) || priceLabel, publicNote: clean(input.publicNote, 200), note: clean(input.note, 300),
    visibility, kind, ...(input.seriesId || before?.seriesId ? { seriesId: clean(input.seriesId, 40) || before.seriesId } : {}),
    token: before?.token || crypto.randomBytes(12).toString('base64url'),
    status: 'open', bookings: before?.bookings || [],
    createdBy: before?.createdBy || principal.email, createdAt: before?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(),
  }
  await putSlot(slot)
  await audit({ by: principal.email, action: before ? 'extra.edit' : 'extra.create', target: slot.id, after: { coach: coachId, date, time, kind, visibility, capacity, cents: priceCents, ...(options ? { options: options.map((x) => `${x.label} ${x.priceLabel}`) } : {}) } })
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
    if (isWhole(s)) return { error: 'One family books this whole session. Book it from My account, or make a private session for this player.' }
    if (!placesLeft(s)) return { error: 'That session is full.' }
    const booking = { id: newId('XB'), name: nm, email: em, mobile: clean(mobile, 30), rowId: clean(rowId, 30), profileKey: clean(profileKey, 200), payreqId: clean(payreqId, 60), status: 'booked', at: new Date().toISOString(), by, from }
    s.bookings = [...(s.bookings || []), booking]
    await putSlot(s)
    await audit({ by, action: 'extra.book', target: s.id, after: { booking: booking.id, from, player: nm } })
    return { booking, slot: s }
  } finally { await kvCommand(['DEL', `jfp:extra-lock:${slotId}`]) }
}
// A whole session for one family's group, first come first served. players:
// [{ name, rowId?, profileKey?, guest? }], the first is the booker's own player.
// The same family booking again gets their bookings back, never a second group.
export async function reserveWholeSession({ slotId, optionId, players = [], email, mobile = '', by }) {
  if ((await kvCommand(['SET', `jfp:extra-lock:${slotId}`, '1', 'NX', 'EX', '15'])) !== 'OK') return { error: 'Someone is booking this session right now. Try again in a moment.' }
  try {
    const s = await getSlot(slotId)
    if (!s || s.status !== 'open' || !isWhole(s)) return { error: 'That session is not open.' }
    if (startMs(s) < Date.now()) return { error: 'That session has started.' }
    const em = validEmail(email)
    if (!em) return { error: 'Sign in again, then book.' }
    const live = liveBookings(s)
    if (live.length) {
      const mine = live.filter((b) => b.email === em && b.groupId)
      if (mine.length) return { already: true, bookings: mine, lead: mine.find((b) => b.id === b.groupId) || mine[0], slot: s }
      return { error: 'Another family has just booked this session. It is no longer free.' }
    }
    const opt = s.options.find((o) => o.id === optionId)
    if (!opt) return { error: 'Choose 1 on 1 or a group.' }
    const list = players.map((p) => ({ ...p, name: clean(p.name, 80) })).filter((p) => p.name.length >= 2)
    if (list.length !== players.length) return { error: "Enter each player's full name." }
    if (new Set(list.map((p) => p.name.toLowerCase())).size !== list.length) return { error: 'The same player is in twice.' }
    if (opt.type === 'group' && list.length < 2) return { error: 'A group needs at least 2 players. One player books 1 on 1.' }
    if (list.length < opt.minPlayers) return { error: `${opt.label} needs at least ${opt.minPlayers} players. Add ${opt.minPlayers - list.length} more.` }
    if (list.length > opt.maxPlayers) return { error: `${opt.label} takes up to ${opt.maxPlayers} player${opt.maxPlayers === 1 ? '' : 's'}.` }
    const at = new Date().toISOString()
    const leadId = newId('XB')
    const bookings = list.map((p, i) => ({
      id: i ? newId('XB') : leadId, groupId: leadId, optionId: opt.id, name: p.name, email: em, mobile: clean(mobile, 30),
      rowId: clean(p.rowId, 30), profileKey: clean(p.profileKey, 200), ...(p.guest ? { guest: true } : {}), payreqId: '', status: 'booked', at, by, from: 'family',
    }))
    s.bookings = [...(s.bookings || []), ...bookings]
    await putSlot(s)
    await audit({ by, action: 'extra.book', target: s.id, after: { group: leadId, option: opt.label, players: bookings.map((b) => b.name), cents: perPlayerCents(opt, bookings.length) * bookings.length } })
    return { bookings, lead: bookings[0], option: opt, slot: s }
  } finally { await kvCommand(['DEL', `jfp:extra-lock:${slotId}`]) }
}

// The charge made after the place was held.
export async function setBookingCharge({ slotId, bookingId, payreqId, chargeId = '' }) {
  const s = await getSlot(slotId)
  const b = s?.bookings?.find((x) => x.id === bookingId)
  if (!b) return false
  b.payreqId = clean(payreqId, 60)
  if (chargeId) b.chargeId = clean(chargeId, 60)
  await putSlot(s)
  return true
}
export async function removeBooking({ principal, isAdmin, slotId, bookingId }) {
  const s = await getSlot(slotId)
  if (!s) return { error: 'That session is gone.' }
  if (!isAdmin && s.coachId !== principal.coachId) return { error: 'Not your session.' }
  const b = (s.bookings || []).find((x) => x.id === bookingId && x.status !== 'removed')
  if (!b) return { error: 'That player is not on this session.' }
  // A whole session's group comes off together; its charge is on the first booking.
  const group = b.groupId ? s.bookings.filter((x) => x.groupId === b.groupId && x.status !== 'removed') : [b]
  const at = new Date().toISOString()
  for (const x of group) { x.status = 'removed'; x.removedBy = principal.email; x.removedAt = at }
  await putSlot(s)
  const lead = group.find((x) => x.payreqId) || b
  await audit({ by: principal.email, action: 'extra.unbook', target: s.id, after: { booking: b.id, player: group.map((x) => x.name).join(', '), charged: Boolean(lead.payreqId) } })
  return { slot: s, booking: lead, removed: group.length }
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

// Extra sessions for the Register tab (Lee, 26 Oct 2026): the week picked, or
// the last two weeks and the week ahead, so a 1 on 1 can still be marked the
// day after. Only sessions with a player on them. coachId '' is every coach.
export async function registerExtras(config, { coachId = '', week = '', weekEnd = '', today = sydneyToday() } = {}) {
  const from = week || addDays(today, -13), to = week ? weekEnd : addDays(today, 6)
  const slots = (await allSlots()).filter((s) => s.status === 'open' && (!coachId || s.coachId === coachId) && s.date >= from && s.date <= to && liveBookings(s).length)
  slots.sort((a, b) => `${a.date}${to24h(a.time) || ''}`.localeCompare(`${b.date}${to24h(b.time) || ''}`))
  const out = []
  for (const s of slots.slice(0, 100)) out.push({
    id: s.id, coachId: s.coachId, coachName: coachLabel(coachById(config, s.coachId)), date: s.date, dateLabel: dateLabel(s.date),
    time: s.time, durationMin: Number(s.durationMin) || 60, location: s.location, title: s.title || 'Extra session',
    bookings: liveBookings(s).map((b) => ({ id: b.id, name: b.name })), marks: s.date <= today ? await marksFor(s) : {},
  })
  return out
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

// Lee and Ligia's Timetable (board): every open extra session from this
// Monday for four weeks, whatever its kind (Lee, 19 Oct 2026). Admin only.
export async function boardExtras(config, today = sydneyToday()) {
  const d = new Date(`${today}T12:00:00Z`)
  const mon = addDays(today, -((d.getUTCDay() + 6) % 7))
  const end = addDays(mon, 27)
  return (await allSlots()).filter((s) => s.status === 'open' && s.date >= mon && s.date <= end).map((s) => {
    const loc = locationFor(config, s.location)
    return {
      id: s.id, date: s.date, dateLabel: dateLabel(s.date), day: new Date(`${s.date}T12:00:00Z`).toLocaleDateString('en-AU', { weekday: 'long', timeZone: 'UTC' }),
      time: s.time, sortTime: to24h(s.time), period: (to24h(s.time) || '12:00') < '12:00' ? 'am' : 'pm', durationMin: s.durationMin,
      locationId: loc.id, locationName: loc.name, coachId: s.coachId, coachName: coachLabel(coachById(config, s.coachId)),
      kind: kindOf(s), kindLabel: KIND_LABEL[kindOf(s)], title: s.title || s.priceLabel || 'Extra session', capacity: s.capacity,
      players: liveBookings(s).map((b) => b.name), week: Math.floor((Date.parse(`${s.date}T00:00:00Z`) - Date.parse(`${mon}T00:00:00Z`)) / (7 * 86400000)),
    }
  })
}
