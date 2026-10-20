// Session value (Lee, 20 Oct 2026): "For each session: how full it is, and
// the money per coach hour. That tells you which slots to add, merge or drop
// (like 7:30 vs 7:45)".
//
// One row per weekly JFP group: places held against capacity, the Term 4 fees
// of the players holding a place (each row's own fee, never a catalogue
// price), what is paid so far, the coach hours this term, fees per coach hour,
// and the coach cost from the rate cards where one is set (priceLine, the same
// sums as coach invoices). Joners Juniors classes are left out: their fees are
// not in Term 4.
//
// Read only. Lee and Ligia only: rate cards are private, so never coaches and
// never Hermes. No player names leave this module, only counts and money.
import { sessionDates, locationFor, coachById, coachLabel, to24h, isSessionType, dayOrder, listGroups } from './_jfp-store.js'
import { loadRoster } from './_jfp-airtable.js'
import { priceLine, allCards } from './_jfp-coach-pay.js'
import { perSessionFor } from './_jfp-account-pay.js'
import { sessionOffMap } from './_jfp-makeups.js'

const isJuniors = (g) => g?.label === 'Joners Juniors'
const isTestName = (n) => /test/i.test(n || '')
const cents = (aud) => (typeof aud === 'number' && Number.isFinite(aud) ? Math.round(aud * 100) : 0)
const mins = (time) => { const t = to24h(time); if (!t) return null; const [h, m] = t.split(':').map(Number); return h * 60 + m }

// Pure: how full. null when the group has no places set.
export function fillPct(holding, capacity) {
  if (!(capacity > 0)) return null
  return Math.min(100, Math.round((holding / capacity) * 100))
}
// Pure: the badge colour (Lee: green 80% and up, orange 40 to 79%, red under 40%).
export function fillTone(pct) {
  if (pct == null) return 'grey'
  return pct >= 80 ? 'green' : pct >= 40 ? 'orange' : 'red'
}
// Pure: an amount over hours, in cents an hour. null with no hours or no amount known.
export function perHour(totalCents, hours) {
  if (totalCents == null || !(hours > 0)) return null
  return Math.round(totalCents / hours)
}

// Pure: groups on the same day at the same venue whose times overlap.
// list: [{ id, day, time, durationMin, venueId }]. Returns Map id -> [ids].
export function overlaps(list) {
  const out = new Map(list.map((g) => [g.id, []]))
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j]
      if (a.day !== b.day || a.venueId !== b.venueId) continue
      const as = mins(a.time), bs = mins(b.time)
      if (as == null || bs == null) continue
      const ae = as + (Number(a.durationMin) || 60), be = bs + (Number(b.durationMin) || 60)
      if (as < be && bs < ae) { out.get(a.id).push(b.id); out.get(b.id).push(a.id) }
    }
  }
  return out
}

// Pure: who in a group counts where. rows: the roster rows holding a place in it.
export function splitRows(rows) {
  const term = [], session = [], trial = []
  for (const r of rows) {
    if (isSessionType(r.paymentType)) session.push(r)
    else if (/trial/i.test(r.paymentType || '')) trial.push(r)
    else term.push(r)
  }
  const priced = term.filter((r) => cents(r.feeAud) > 0)
  return {
    term, session, trial,
    feeCents: priced.reduce((t, r) => t + cents(r.feeAud), 0),
    paidCents: term.reduce((t, r) => t + cents(r.paidAud), 0),
    noPrice: term.length - priced.length,
    oneToOne: rows.some((r) => /\[JFP-1TO1\]/.test(r.notes || '')),
  }
}

// Pure: the coach cost of one weekly session, from each coach's rate card.
// coachIds: the coach then any helpers. Returns { known, perSessionCents, missing, basis, reason }.
export function sessionCost({ group, coachIds, cards, players, date }) {
  const missing = [], basis = []
  let total = 0, known = coachIds.length > 0, reason = ''
  for (const id of coachIds) {
    const card = cards[id]
    if (!card) { missing.push(id); known = false; continue }
    const p = priceLine({ kind: 'session', minutes: Number(group.durationMin) || 60, date, groupId: group.id, players: Array.from({ length: players }, (_, i) => `p${i}`) }, { card, group, register: null })
    if (p.cents == null) { known = false; reason ||= players ? p.basis : 'Nobody holding a place, so no rate band'; continue }
    total += p.cents
    basis.push(p.basis)
  }
  return { known, perSessionCents: known ? total : null, missing, basis, reason }
}

// Pure: the whole page. groups and roster as read; cards: allCards();
// offs: emergency-cancelled sessions (Map 'groupId|date').
export function sessionValueView({ config, groups, roster, cards = {}, offs = new Map() }) {
  const shown = groups.filter((g) => !isJuniors(g))
  const ids = new Set(shown.map((g) => g.id))
  const holding = roster.players.filter((r) => r.holdsPlace && r.groupId && !isTestName(r.player))
  const byGroup = new Map(shown.map((g) => [g.id, []]))
  for (const r of holding) if (byGroup.has(r.groupId)) byGroup.get(r.groupId).push(r)
  const juniorIds = new Set(groups.filter(isJuniors).map((g) => g.id))
  const unplaced = holding.filter((r) => !ids.has(r.groupId) && !juniorIds.has(r.groupId)).length
  const venueOf = (g) => locationFor(config, g.location)
  const lap = overlaps(shown.map((g) => ({ id: g.id, day: g.day, time: g.time, durationMin: g.durationMin, venueId: venueOf(g).id })))
  const name = (id) => coachLabel(coachById(config, id)) || id
  const short = (g) => `${g.day.slice(0, 3)} ${g.time}, ${name(g.coachId) || 'no coach'}`

  const rows = shown.map((g) => {
    const list = byGroup.get(g.id) || []
    const s = splitRows(list)
    const taken = s.oneToOne ? Math.max(g.capacity || 0, list.length) : list.length
    const pct = fillPct(taken, g.capacity)
    const all = sessionDates(config, g.day)
    const dates = all.filter((d) => !offs.has(`${g.id}|${d}`))
    const helpers = (g.extraCoachIds || []).filter((id) => id && id !== g.coachId)
    const coachIds = [g.coachId, ...helpers].filter(Boolean)
    const people = Math.max(1, coachIds.length)
    const hoursEach = (dates.length * (Number(g.durationMin) || 60)) / 60
    const coachHours = hoursEach * people
    const cost = sessionCost({ group: g, coachIds, cards, players: list.length, date: dates[0] || all[0] || config.termStart })
    const termCostCents = cost.known ? cost.perSessionCents * dates.length : null
    const feesPerHourCents = perHour(s.feeCents, coachHours)
    const costPerHourCents = perHour(termCostCents, coachHours)
    const sessionPrices = s.session.map((r) => perSessionFor(config, r, g))
    return {
      id: g.id, day: g.day, dayOrder: dayOrder(g.day), time: g.time, sortTime: to24h(g.time), durationMin: Number(g.durationMin) || 60,
      venue: venueOf(g).name, coach: g.coachId ? name(g.coachId) : '', helpers: helpers.map(name), label: g.label, mode: g.mode,
      capacity: g.capacity || 0, holding: list.length, oneToOne: s.oneToOne, fillPct: pct, fillTone: fillTone(pct),
      termPlayers: s.term.length, feeCents: s.feeCents, paidCents: s.paidCents, noPrice: s.noPrice,
      // Session by session and Pro: never in the term fees. Their price per session is the row's own, else the price list's (as My account prepay uses).
      session: { count: s.session.length, perSessionCents: sessionPrices.reduce((t, c) => t + (c || 0), 0), unpriced: sessionPrices.filter((c) => !c).length, billedCents: s.session.reduce((t, r) => t + cents(r.feeAud), 0), paidCents: s.session.reduce((t, r) => t + cents(r.paidAud), 0) },
      trial: { count: s.trial.length, feeCents: s.trial.reduce((t, r) => t + cents(r.feeAud), 0) },
      sessions: dates.length, cancelled: all.length - dates.length, coaches: people, coachHours: Math.round(coachHours * 100) / 100,
      feesPerHourCents,
      cost: { known: cost.known, perSessionCents: cost.perSessionCents, termCents: termCostCents, perHourCents: costPerHourCents, missing: cost.missing.map(name), basis: cost.basis, reason: cost.reason, noCoach: coachIds.length === 0 },
      marginPerHourCents: feesPerHourCents != null && costPerHourCents != null ? feesPerHourCents - costPerHourCents : null,
      overlaps: (lap.get(g.id) || []).map((id) => { const o = shown.find((x) => x.id === id); return { id, label: short(o) } }),
    }
  })

  const sum = (list, f) => list.reduce((t, r) => t + (f(r) || 0), 0)
  const costed = rows.filter((r) => r.cost.known)
  const capacity = sum(rows, (r) => r.capacity), held = sum(rows, (r) => r.holding)
  const hours = sum(rows, (r) => r.coachHours)
  const costedHours = sum(costed, (r) => r.coachHours)
  const costedFees = sum(costed, (r) => r.feeCents), costedCost = sum(costed, (r) => r.cost.termCents)
  return {
    term: config.term, weeks: config.weeks,
    groups: rows,
    totals: {
      groups: rows.length, holding: held, capacity, fillPct: fillPct(held, capacity), fillTone: fillTone(fillPct(held, capacity)),
      feeCents: sum(rows, (r) => r.feeCents), paidCents: sum(rows, (r) => r.paidCents), noPrice: sum(rows, (r) => r.noPrice),
      session: sum(rows, (r) => r.session.count), sessionPerSessionCents: sum(rows, (r) => r.session.perSessionCents), trial: sum(rows, (r) => r.trial.count),
      coachHours: Math.round(hours * 100) / 100, feesPerHourCents: perHour(sum(rows, (r) => r.feeCents), hours),
      costed: costed.length, costCents: costed.length ? costedCost : null,
      // Margin only over the groups with a rate card for every coach on them.
      marginPerHourCents: costed.length && costedHours > 0 ? perHour(costedFees, costedHours) - perHour(costedCost, costedHours) : null,
      unplaced,
    },
  }
}

// Read and worked out. Lee and Ligia only (the dispatcher checks admin); never Hermes.
export async function sessionValueAction(res, principal, config, body = {}) {
  if (principal?.via === 'hermes') return res.status(403).json({ success: false, error: 'Session value uses the coach rate cards, so it is only for Lee and Ligia, in the portal.' })
  const [groups, roster, cards, offs] = await Promise.all([listGroups(), loadRoster({ fresh: body.fresh === true }), allCards(), sessionOffMap()])
  return res.status(200).json({ success: true, ...sessionValueView({ config, groups, roster, cards, offs }) })
}
