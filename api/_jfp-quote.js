// Pro session quotes (Lee, 14 Oct 2026). Each Pro (or session by session)
// player can have their own quote, set only by staff (Lee or Ligia) in Edit
// player or Add a player:
//
//   a price per session        [PERSESSION:<cents>] (as before)
//   commitment tiers            [QUOTE:6x9500,10x9000] "commit to the next 6
//                               sessions in a row at A$95 each", and so on
//
// In My account the player chooses among those options only: pay the next
// session at the per-session price, or commit to one of the tiers. The server
// works out the amount from the stored quote, never from the page.
//
// A paid commitment adds its sessions to [PREPAID:<n>] (as any prepay does)
// and its dates to [COVERED:<iso>,<iso>,...]. Staff session billing
// (sessionInvoice) then never bills a covered date: sessions on dates that
// have happened come off the bill first, and a covered date the player
// missed is still counted as paid (no automatic refund). See billPlan.
//
// A leaf module: the JFP store imports it (normaliseConfig keeps the staff
// default quote), so it imports nothing from the store.
import { clean } from './_holiday-store.js'

export const QUOTE_TIERS_MAX = 4
export const QUOTE_N_MIN = 2
export const QUOTE_N_MAX = 20
export const PER_MIN = 100 // A$1
export const PER_MAX = 200000 // A$2,000, as staff session billing allows

const ISO = /^\d{4}-\d{2}-\d{2}$/
const aud = (c) => `A$${(c / 100).toFixed(2).replace(/\.00$/, '')}`

// ---------- the quote on the row's notes ----------

// [QUOTE:6x9500,10x9000] -> [{ n: 6, cents: 9500 }, { n: 10, cents: 9000 }]
export function quoteTiersOf(notes) {
  const m = String(notes || '').match(/\[QUOTE:([0-9x,]+)\]/)
  if (!m) return []
  const out = []
  for (const part of m[1].split(',')) {
    const [n, c] = part.split('x').map(Number)
    if (Number.isInteger(n) && Number.isInteger(c) && n >= QUOTE_N_MIN && n <= QUOTE_N_MAX && c >= PER_MIN && c <= PER_MAX && !out.some((t) => t.n === n)) out.push({ n, cents: c })
  }
  return out.sort((a, b) => a.n - b.n).slice(0, QUOTE_TIERS_MAX)
}
export function withQuote(notes, tiers) {
  const base = String(notes || '').replace(/\s*\[QUOTE:[^\]]*\]/g, '')
  const list = (tiers || []).filter((t) => t && t.n && t.cents)
  return list.length ? `${base}${base ? ' ' : ''}[QUOTE:${list.map((t) => `${t.n}x${t.cents}`).join(',')}]` : base
}

// What staff typed: { ok, perCents, tiers } or { ok: false, error }. A tier is
// a discount: its price must be under the price per session.
export function cleanQuote(input = {}) {
  const per = Number(input.perCents)
  if (!Number.isInteger(per) || per < PER_MIN || per > PER_MAX) return { ok: false, error: 'Enter the price per session, for example 100.' }
  const raw = Array.isArray(input.tiers) ? input.tiers : []
  if (raw.length > QUOTE_TIERS_MAX) return { ok: false, error: `At most ${QUOTE_TIERS_MAX} commitment options.` }
  const tiers = []
  for (const t of raw) {
    const n = Number(t?.n), c = Number(t?.cents)
    if (!Number.isInteger(n) || n < QUOTE_N_MIN || n > QUOTE_N_MAX) return { ok: false, error: `A commitment is ${QUOTE_N_MIN} to ${QUOTE_N_MAX} sessions in a row.` }
    if (!Number.isInteger(c) || c < PER_MIN || c > PER_MAX) return { ok: false, error: `Enter the price each for ${n} sessions in a row.` }
    if (c >= per) return { ok: false, error: `${n} in a row at ${aud(c)} each is not less than ${aud(per)} a session. A commitment price is lower.` }
    if (tiers.some((x) => x.n === n)) return { ok: false, error: `There are two options for ${n} sessions in a row. Keep one.` }
    tiers.push({ n, cents: c })
  }
  return { ok: true, perCents: per, tiers: tiers.sort((a, b) => a.n - b.n) }
}

// Staff's default Pro quote (Money > Prices), kept in the JFP config. It only
// fills in the Add form; each player's own quote is what counts.
export function cleanDefaultQuote(input) {
  if (!input || typeof input !== 'object') return null
  const r = cleanQuote(input)
  return r.ok ? { perCents: r.perCents, tiers: r.tiers, updatedAt: clean(input.updatedAt, 30) } : null
}

// ---------- dates a commitment covers ----------

export function coveredOf(notes) {
  const m = String(notes || '').match(/\[COVERED:([0-9,-]*)\]/)
  return m ? [...new Set(m[1].split(',').filter((d) => ISO.test(d)))].sort() : []
}
export function withCovered(notes, dates) {
  const base = String(notes || '').replace(/\s*\[COVERED:[^\]]*\]/g, '')
  const list = [...new Set((dates || []).filter((d) => ISO.test(d)))].sort()
  return list.length ? `${base}${base ? ' ' : ''}[COVERED:${list.join(',')}]` : base
}
// A paid prepay link: a commitment adds its dates to the row (finalise).
export function commitNotes(notes, prepay) {
  if (!prepay?.commit) return notes
  return withCovered(notes, [...coveredOf(notes), ...(prepay.dates || [])])
}

// The row's commitment as staff and the player see it.
export function commitmentOf(notes, today) {
  const dates = coveredOf(notes)
  if (!dates.length) return null
  const left = dates.filter((d) => d > today)
  return { sessions: dates.length, dates, left: left.length, leftDates: left, done: dates.length - left.length }
}

// Staff bill `sessions` sessions today. Of the row's prepaid count
// ([PREPAID:p]), the covered dates are a commitment: the ones already
// happened (on or before today) are used for this bill first, and any of
// those the player missed are counted as paid anyway (lapsed). Covered dates
// still to come stay prepaid for later. Anything prepaid beyond the
// commitment (prepaid one at a time from My account) comes off next, as before.
// With no covered dates this is exactly the old rule: min(sessions, prepaid).
export function billPlan({ prepaid = 0, covered = [], sessions = 0, today }) {
  const p = Math.max(0, Number(prepaid) || 0)
  const past = covered.filter((d) => d <= today)
  const future = covered.filter((d) => d > today)
  const commitPast = Math.min(past.length, p)
  const commitUsed = Math.min(sessions, commitPast)
  const lapsed = commitPast - commitUsed
  const plain = Math.max(0, p - Math.min(covered.length, p))
  const plainUsed = Math.min(sessions - commitUsed, plain)
  return { covered: commitUsed + plainUsed, commitUsed, plainUsed, lapsed, prepaidAfter: Math.max(0, p - commitPast - plainUsed), coveredAfter: future }
}
export function afterBill(notes, plan, withPrepaid) {
  return withCovered(withPrepaid(notes, plan.prepaidAfter), plan.coveredAfter)
}
export function billLine(plan) {
  return plan.lapsed ? `, ${plan.lapsed} committed session${plan.lapsed > 1 ? 's' : ''} missed and counted as paid` : ''
}

// ---------- the options in My account ----------

// dates: [{ iso, label }] still to come and free to pay for, in order.
export function quoteOptions({ perCents, tiers, dates }) {
  if (!perCents || !dates.length) return []
  const out = [{ key: 'one', n: 1, perCents, totalCents: perCents, saveCents: 0, title: `Pay for the next session, ${aud(perCents)}`, dates: dates.slice(0, 1) }]
  for (const t of tiers || []) {
    if (dates.length < t.n) continue
    out.push({ key: `commit:${t.n}`, n: t.n, perCents: t.cents, totalCents: t.n * t.cents, saveCents: t.n * (perCents - t.cents), commit: true, title: `Commit to the next ${t.n} sessions at ${aud(t.cents)} each, ${aud(t.n * t.cents)}`, dates: dates.slice(0, t.n) })
  }
  return out
}
