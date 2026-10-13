// Holiday training, between holidays (Lee, 13 Oct 2026: "all the sessions
// have passed by now! we just need a record of that and then get ready for
// the next holidays"). Pure functions, no KV and no network:
//
//   holidayRecord  every past slot, grouped by NSW school holiday, newest
//                  first: sessions run, bookings, players and coaches. Read only.
//   planHolidays   the slots to make for the next holidays: last holiday's
//                  weekly pattern (same weekdays, times, coaches, prices and
//                  places) put onto the new dates, or a blank start.
//
// Nothing here creates a slot or sends anything. holiday-admin creates the
// planned slots through upsertSlot, the same validation as every other slot.
import { HOLIDAY_PERIODS, OTHER, OTHER_LABEL, periodOf, periodById, rangeLabel } from './_holiday-periods.js'
import { coachById, slotOptions, formatAud, sydneyIso, sydneyDateLabel, sydneyTimeLabel, TYPE_LABELS } from './_holiday-store.js'
import { NSW_HOLIDAYS } from './_jfp-store.js'

const ISO = /^\d{4}-\d{2}-\d{2}$/
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
export const weekday = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay()
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10)
const dayLabel = (iso) => new Intl.DateTimeFormat('en-AU', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(`${iso}T00:00:00Z`)).replace(',', '')
// The most slots one tap may create (a six week summer of busy days).
export const PLAN_MAX = 400

// A slot that has happened: its day is before today (Sydney). Today's
// sessions are still coming up.
export const isPastSlot = (slot, today) => Boolean(slot?.date) && slot.date < today

// What a past slot was: run (booked online or offline) or not booked.
function slotRun(slot, paid) {
  if (slot.status === 'blocked') return 'offline'
  return paid.length ? 'online' : 'none'
}

// ---------- the record ----------

// periods: newest first, Other dates last. Cancelled slots are left out (they
// never ran); a paid booking whose slot was cancelled still counts as a booking.
export function holidayRecord({ slots = [], bookings = [], config = { coaches: [] }, today } = {}) {
  const past = slots.filter((s) => isPastSlot(s, today) && s.status !== 'cancelled')
  const slotIds = new Set(slots.filter((s) => isPastSlot(s, today)).map((s) => s.id))
  const paidBySlot = new Map()
  const cancelledBySlot = new Map()
  for (const b of bookings) {
    if (!slotIds.has(b?.slotId)) continue
    const map = b.status === 'paid' ? paidBySlot : b.status === 'cancelled' ? cancelledBySlot : null
    if (map) map.set(b.slotId, [...(map.get(b.slotId) || []), b])
  }
  const slotsById = new Map(slots.map((s) => [s.id, s]))
  const groups = new Map()
  const group = (id) => {
    if (!groups.has(id)) {
      const p = periodById(id)
      groups.set(id, { id, label: p ? p.label : OTHER_LABEL, range: p ? rangeLabel(p) : 'Sessions outside the school holidays', from: p?.from || '', offered: 0, run: 0, online: 0, offline: 0, notBooked: 0, bookings: 0, cancelled: 0, places: 0, names: new Set(), coaches: new Map(), sessions: [], lastDate: '' })
    }
    return groups.get(id)
  }
  for (const s of past) {
    const g = group(periodOf(s.date))
    const paid = paidBySlot.get(s.id) || []
    const run = slotRun(s, paid)
    const coach = coachById(config, s.coachId)?.name || s.coachId || 'Not known'
    g.offered += 1
    if (run === 'none') g.notBooked += 1
    else {
      g.run += 1
      g[run] += 1
      const c = g.coaches.get(coach) || { name: coach, sessions: 0 }
      c.sessions += 1
      g.coaches.set(coach, c)
    }
    if (s.date > g.lastDate) g.lastDate = s.date
    const players = paid.flatMap((b) => (b.players || []).map((p) => String(p?.name || '').trim()).filter(Boolean))
    g.sessions.push({
      slotId: s.id, date: s.date, dateLabel: s.startsAt ? sydneyDateLabel(s.startsAt) : dayLabel(s.date), time: s.startTime || '', startLabel: s.startsAt ? sydneyTimeLabel(s.startsAt) : s.startTime || '',
      coach, run, typeLabel: s.title || TYPE_LABELS[s.type] || s.type || '', bookings: paid.length, players, location: s.location || '',
    })
  }
  // Bookings, places and players: paid bookings on past slots, cancelled kept apart.
  for (const [slotId, list] of paidBySlot) {
    const s = slotsById.get(slotId)
    const g = group(periodOf(s.date))
    for (const b of list) {
      g.bookings += 1
      const names = (b.players || []).map((p) => String(p?.name || '').trim()).filter(Boolean)
      g.places += Number(b.seats) || names.length || 1
      for (const n of names) g.names.add(n.toLowerCase().replace(/\s+/g, ' '))
      if (s.date > g.lastDate) g.lastDate = s.date
    }
  }
  for (const [slotId, list] of cancelledBySlot) group(periodOf(slotsById.get(slotId).date)).cancelled += list.length
  return [...groups.values()]
    .map(({ names, coaches, sessions, ...g }) => ({
      ...g,
      players: names.size,
      coaches: [...coaches.values()].sort((a, b) => b.sessions - a.sessions || a.name.localeCompare(b.name)),
      sessions: sessions.sort((a, b) => b.date.localeCompare(a.date) || a.time.localeCompare(b.time) || a.coach.localeCompare(b.coach)),
      moneyHref: `/jfp-portal/#money?programme=holiday&period=${encodeURIComponent(g.id)}`,
    }))
    .sort((a, b) => (a.id === OTHER) - (b.id === OTHER) || (b.from || b.lastDate).localeCompare(a.from || a.lastDate))
}

// ---------- the next holidays ----------

// The holidays Lee can set up: ones not over yet, the next three.
export function upcomingPeriods(today) {
  return HOLIDAY_PERIODS.filter((p) => p.end >= today).sort((a, b) => a.from.localeCompare(b.from)).slice(0, 3)
}

// Holidays with slots in them before `beforeFrom`, newest first (the ones a
// pattern can be copied from).
export function sourcePeriods(slots, beforeFrom) {
  const counts = new Map()
  for (const s of slots) {
    if (s.status === 'cancelled') continue
    const id = periodOf(s.date)
    if (id === OTHER) continue
    const p = periodById(id)
    if (beforeFrom && p.from >= beforeFrom) continue
    counts.set(id, (counts.get(id) || 0) + 1)
  }
  return [...counts.entries()].map(([id, n]) => ({ ...periodById(id), slots: n, range: rangeLabel(periodById(id)) })).sort((a, b) => b.from.localeCompare(a.from))
}

// One holiday's weekly pattern: each different (weekday, time, coach, kind of
// hour) once, however many weeks it ran. Cancelled hours never ran, so they
// are not copied. Hours booked offline are copied as free hours.
export function weeklyPattern(slots, periodId) {
  const seen = new Map()
  for (const s of slots) {
    if (s.status === 'cancelled' || periodOf(s.date) !== periodId) continue
    const item = {
      weekday: weekday(s.date), startTime: s.startTime, coachId: s.coachId, durationMin: s.durationMin, type: s.type,
      capacity: s.capacity, priceCents: Number.isInteger(s.priceCents) ? s.priceCents : null, minPlayers: s.minPlayers || 1,
      location: s.location || '', notes: s.notes || '',
      ...(s.seatMode ? { seatMode: s.seatMode } : {}), ...(s.title ? { title: s.title } : {}),
      ...(s.minAge != null ? { minAge: s.minAge, maxAge: s.maxAge ?? null } : {}),
    }
    const key = JSON.stringify(item)
    if (!seen.has(key)) seen.set(key, item)
  }
  return [...seen.values()].sort((a, b) => ((a.weekday + 6) % 7) - ((b.weekday + 6) % 7) || a.startTime.localeCompare(b.startTime) || a.coachId.localeCompare(b.coachId))
}

// The days of a holiday that can take sessions: the official holiday, from
// today on, with NSW public holidays marked (never planned on).
export function holidayDays(period, today, publicHolidays = NSW_HOLIDAYS) {
  const off = new Map(publicHolidays.map((h) => [h.date, h.reason]))
  const out = []
  for (let d = period.start > today ? period.start : today; d <= period.end; d = addDays(d, 1)) out.push({ date: d, label: dayLabel(d), weekday: weekday(d), publicHoliday: off.get(d) || '' })
  return out
}

// What a family would pay a player: one price, or "from" the cheapest when
// a "your choice" hour prices each kind differently.
function priceLabel(x, config) {
  const prices = [...new Set(slotOptions(x, config).map((o) => o.priceCents))].sort((a, b) => a - b)
  return prices.length > 1 ? `from ${formatAud(prices[0])}` : formatAud(prices[0] || 0)
}

// The plan: { target, source, sources, mode, days: [{ date, label, publicHoliday, items }], counts }.
// Each item says whether it would be made: 'new', or why not ('exists', 'coach').
export function planHolidays({ slots = [], config = { coaches: [] }, today, period, source = '', mode = 'copy', publicHolidays = NSW_HOLIDAYS } = {}) {
  if (!ISO.test(today || '')) return { ok: false, error: 'Today is not known.' }
  const choices = upcomingPeriods(today)
  const target = choices.find((p) => p.id === period) || (!period ? choices[0] : null)
  if (!target) return { ok: false, error: 'Pick one of the next school holidays.' }
  const sources = sourcePeriods(slots, target.from)
  const from = mode === 'copy' ? (sources.find((p) => p.id === source) || (!source ? sources[0] : null)) : null
  if (mode === 'copy' && source && !from) return { ok: false, error: 'That holiday has no sessions to copy.' }
  const pattern = from ? weeklyPattern(slots, from.id) : []
  const taken = new Set(slots.filter((s) => s.status !== 'cancelled').map((s) => `${s.coachId}|${s.startsAt}`))
  const days = holidayDays(target, today, publicHolidays).map((d) => ({
    ...d,
    dayName: DAY_NAMES[d.weekday],
    items: d.publicHoliday ? [] : pattern.filter((x) => x.weekday === d.weekday).map((x) => {
      const coach = coachById(config, x.coachId)
      const startsAt = sydneyIso(d.date, x.startTime)
      const status = taken.has(`${x.coachId}|${startsAt}`) ? 'exists' : coach?.active === false || !coach ? 'coach' : 'new'
      const { weekday: _w, ...template } = x
      return {
        key: `${d.date}|${x.startTime}|${x.coachId}`, date: d.date, status, template: { ...template, date: d.date },
        coachName: coach?.name || x.coachId, startLabel: sydneyTimeLabel(startsAt), endLabel: sydneyTimeLabel(new Date(Date.parse(startsAt) + x.durationMin * 60000).toISOString()),
        typeLabel: x.title || TYPE_LABELS[x.type] || x.type, capacity: x.capacity, priceLabel: priceLabel(x, config), customPrice: x.priceCents != null,
      }
    }),
    // A public holiday that would have had sessions in the pattern.
    wouldHave: d.publicHoliday ? pattern.filter((x) => x.weekday === d.weekday).length : 0,
  }))
  const all = days.flatMap((d) => d.items)
  return {
    ok: true, mode: from ? 'copy' : 'blank',
    target: { id: target.id, label: target.label, range: rangeLabel(target), start: target.start, end: target.end },
    source: from ? { id: from.id, label: from.label, range: from.range, slots: from.slots, pattern: pattern.length } : null,
    sources: sources.map((p) => ({ id: p.id, label: p.label, range: p.range, slots: p.slots })),
    choices: choices.map((p) => ({ id: p.id, label: p.label, range: rangeLabel(p) })),
    days,
    counts: { new: all.filter((x) => x.status === 'new').length, exists: all.filter((x) => x.status === 'exists').length, coach: all.filter((x) => x.status === 'coach').length, publicHolidays: days.filter((d) => d.publicHoliday && d.wouldHave).length },
  }
}

// The templates to create, from a plan and the days Lee left ticked.
export function planToCreate(plan, dates) {
  const keep = new Set(Array.isArray(dates) ? dates : [])
  return plan.days.filter((d) => keep.has(d.date)).flatMap((d) => d.items.filter((x) => x.status === 'new').map((x) => x.template))
}
