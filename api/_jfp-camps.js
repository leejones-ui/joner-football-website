// Money > Camps (Lee, 13 Oct 2026): what each camp brought in, a year at a
// time. Lee keeps camp revenue in Google Sheets the website cannot read, so
// the Revenue session's Mac script (scripts/camps_import.py) copies a
// summary per camp into the Airtable table "JFP Camps" (no names), and this
// reads it, at most every 10 minutes. If the table is not there, the same
// summary can sit in KV under jfp:camps-summary.
//
// Live Stripe camp payments (camp sign-ups paid on the Sydney account carry
// metadata camp and registrationId) are read on their own, as a cross-check
// for a camp the sheet has no figure for. Read only.
import { readTable } from './_jfp-airtable.js'
import { kvGetJson, kvSetJson } from './_jfp-store.js'
import { stripeFetch } from './_holiday-store.js'
import { feeFrom } from './_jfp-stripe.js'

// JFP Camps, base apphU4R0BtVIu5YqT (made by the import, 13 Oct 2026).
export const CAMPS_TABLE = process.env.JFP_CAMPS_TABLE || 'tblrELWFdVouAn5FB'
const CACHE = 'jfp:camps-cache'
const SUMMARY = 'jfp:camps-summary'
const CACHE_SECONDS = 600
const STRIPE_SECONDS = 1800
const MAX_PAGES = 20

const text = (f, k) => (f?.[k] == null ? '' : String(f[k]).trim())
const num = (f, k) => (typeof f?.[k] === 'number' ? f[k] : f?.[k] != null && f[k] !== '' && Number.isFinite(Number(f[k])) ? Number(f[k]) : null)
const toCents = (v) => (v == null ? null : Math.round(v * 100))
const sum = (list, k) => list.reduce((t, x) => t + (x[k] || 0), 0)
// A total of a field some camps do not have: null when none have it.
const sumKnown = (list, k) => (list.some((x) => x[k] != null) ? sum(list, k) : null)

export function campFromRecord({ id, fields: f }) {
  const year = num(f, 'Year')
  return {
    id, key: text(f, 'Key'), camp: text(f, 'Camp') || text(f, 'Key'), year: year == null ? null : Math.trunc(year),
    location: text(f, 'Location') || 'No location', start: text(f, 'Start Date').slice(0, 10), end: text(f, 'End Date').slice(0, 10),
    players: num(f, 'Players'), places: num(f, 'Places'),
    grossCents: toCents(num(f, 'Gross')), refundsCents: toCents(num(f, 'Refunds')), feesCents: toCents(num(f, 'Stripe Fees')), costsCents: toCents(num(f, 'Costs')), netCents: toCents(num(f, 'Net')),
    currency: (text(f, 'Currency') || 'AUD').toUpperCase(), sheet: text(f, 'Source Sheet'), tab: text(f, 'Source Tab'), notes: text(f, 'Notes'), importedAt: text(f, 'Imported At'),
  }
}
// The KV copy has cents already.
const campFromSummary = (c, i) => ({
  id: c.key || `camp-${i}`, key: c.key || '', camp: c.camp || c.key || 'Camp', year: Number.isInteger(c.year) ? c.year : Number(c.year) || null, location: c.location || 'No location',
  start: String(c.start || '').slice(0, 10), end: String(c.end || '').slice(0, 10), players: c.players ?? null, places: c.places ?? null,
  grossCents: c.grossCents ?? null, refundsCents: c.refundsCents ?? null, feesCents: c.feesCents ?? null, costsCents: c.costsCents ?? null, netCents: c.netCents ?? null,
  currency: String(c.currency || 'AUD').toUpperCase(), sheet: c.sheet || '', tab: c.tab || '', notes: c.notes || '', importedAt: c.importedAt || '',
})

// Every camp summary: the 10 minute copy, then Airtable, then KV.
export async function listCamps({ fresh = false } = {}, deps = {}) {
  const get = deps.kvGetJson || kvGetJson, set = deps.kvSetJson || kvSetJson
  if (!fresh) {
    const hit = await get(CACHE).catch(() => null)
    if (hit && Array.isArray(hit.camps)) return hit
  }
  let out
  try {
    const rows = await (deps.readTable || readTable)(CAMPS_TABLE, [])
    out = { source: 'airtable', at: new Date().toISOString(), camps: rows.map(campFromRecord).filter((c) => c.year) }
  } catch (error) {
    // No table (or no access to it): the KV copy, if the import wrote one.
    const s = await get(SUMMARY).catch(() => null)
    if (!s || !Array.isArray(s.camps)) throw new Error(/40[34]|not found|could not find|INVALID_PERMISSIONS|NOT_FOUND/i.test(error.message) ? 'No camp figures yet: run the camps import on the Mac (RUNBOOK, Camps money).' : `Camp figures could not be read just now (${error.message.slice(0, 80)}).`)
    out = { source: 'kv', at: s.importedAt || new Date().toISOString(), camps: s.camps.map(campFromSummary).filter((c) => c.year) }
  }
  out.importedAt = out.camps.map((c) => c.importedAt).filter(Boolean).sort().at(-1) || ''
  await set(CACHE, out, CACHE_SECONDS).catch(() => {})
  return out
}

function yearTotals(list) {
  const aud = list.filter((c) => c.currency === 'AUD')
  return {
    camps: list.length, audCamps: aud.length, players: sumKnown(aud, 'players'),
    grossCents: sumKnown(aud, 'grossCents'), refundsCents: sumKnown(aud, 'refundsCents'), feesCents: sumKnown(aud, 'feesCents'), costsCents: sumKnown(aud, 'costsCents'), netCents: sumKnown(aud, 'netCents'),
    // Camps in another currency are listed, never added into the A$ totals.
    other: [...new Set(list.filter((c) => c.currency !== 'AUD').map((c) => c.currency))].map((cur) => { const l = list.filter((c) => c.currency === cur); return { currency: cur, camps: l.length, grossCents: sumKnown(l, 'grossCents'), netCents: sumKnown(l, 'netCents') } }),
  }
}
const change = (now, before) => (now == null || before == null ? null : { diffCents: now - before, pct: before > 0 ? Math.round(((now - before) * 1000) / before) / 10 : null })

// One year's camps, worked out (pure).
export function campsView({ camps = [], year = 0, today = new Date().toISOString().slice(0, 10) } = {}) {
  const years = [...new Set(camps.map((c) => c.year))].sort((a, b) => b - a)
  const thisYear = Number(today.slice(0, 4))
  const chosen = years.includes(year) ? year : years.includes(thisYear) ? thisYear : years[0] || thisYear
  const mine = camps.filter((c) => c.year === chosen).sort((a, b) => (a.start || '9').localeCompare(b.start || '9') || a.camp.localeCompare(b.camp))
  const before = camps.filter((c) => c.year === chosen - 1)
  const totals = yearTotals(mine)
  const prev = before.length ? yearTotals(before) : null
  const locs = new Map()
  // "Sydney, AU (Rydalmere Park)" is Sydney, AU: the venue in brackets is not another place.
  const place = (c) => c.location.replace(/\s*\([^)]*\)\s*$/, '').trim() || c.location
  for (const c of mine) { const k = `${place(c).toLowerCase()}|${c.currency}`; locs.set(k, [...(locs.get(k) || []), c]) }
  const byLocation = [...locs.values()].map((l) => ({ location: place(l[0]), currency: l[0].currency, camps: l.length, players: sumKnown(l, 'players'), grossCents: sumKnown(l, 'grossCents'), netCents: sumKnown(l, 'netCents') }))
    .sort((a, b) => (a.currency === 'AUD' ? 0 : 1) - (b.currency === 'AUD' ? 0 : 1) || (b.netCents ?? b.grossCents ?? 0) - (a.netCents ?? a.grossCents ?? 0) || a.location.localeCompare(b.location))
  return {
    year: chosen, years: years.map((y) => ({ year: y, camps: camps.filter((c) => c.year === y).length, ...(() => { const t = yearTotals(camps.filter((c) => c.year === y)); return { grossCents: t.grossCents, netCents: t.netCents } })() })),
    camps: mine, totals, byLocation,
    compare: prev ? { year: chosen - 1, ...prev, gross: change(totals.grossCents, prev.grossCents), net: change(totals.netCents, prev.netCents), playersDiff: totals.players != null && prev.players != null ? totals.players - prev.players : null } : null,
  }
}

export async function campsMoneyData({ year = 0, fresh = false } = {}, deps = {}) {
  const list = await listCamps({ fresh }, deps)
  return { ...campsView({ camps: list.camps, year, today: deps.today }), source: list.source, at: list.at, importedAt: list.importedAt }
}

// ---------- live Stripe camp payments (the cross-check) ----------

// Paid camp sign-ups on the Sydney account in one calendar year (Sydney
// time), grouped by the camp name Stripe has. Kept 30 minutes; quick shows
// any kept copy at once.
export function groupCampSessions(sessions) {
  const by = new Map()
  for (const s of sessions) {
    const k = s.camp.toLowerCase()
    const g = by.get(k) || { camp: s.camp, currency: s.currency, count: 0, takenCents: 0, refundedCents: 0, feeCents: 0, feesPending: 0, first: s.day, last: s.day }
    g.count += 1
    g.takenCents += s.amountCents
    g.refundedCents += s.refundedCents
    if (s.feeCents == null) g.feesPending += 1; else g.feeCents += s.feeCents
    if (s.day < g.first) g.first = s.day
    if (s.day > g.last) g.last = s.day
    by.set(k, g)
  }
  return [...by.values()].map((g) => ({ ...g, keptCents: g.takenCents - g.refundedCents - g.feeCents })).sort((a, b) => b.takenCents - a.takenCents || a.camp.localeCompare(b.camp))
}

export async function campsStripe({ year, fresh = false, quick = false } = {}, deps = {}) {
  const get = deps.kvGetJson || kvGetJson, set = deps.kvSetJson || kvSetJson
  const key = `jfp:camps-stripe:${year}`
  if (!fresh) {
    const hit = await get(key).catch(() => null)
    if (hit && Array.isArray(hit.camps) && (quick || Date.now() - Date.parse(hit.at) < STRIPE_SECONDS * 1000)) return { ...hit, quick: Boolean(quick && Date.now() - Date.parse(hit.at) >= STRIPE_SECONDS * 1000) }
  }
  const fetchStripe = deps.stripeFetch || stripeFetch
  const gte = Math.floor(Date.parse(`${year}-01-01T00:00:00+10:00`) / 1000), lt = Math.floor(Date.parse(`${year + 1}-01-01T00:00:00+10:00`) / 1000)
  const sessions = []
  let after = '', truncated = false
  for (let page = 0; page < MAX_PAGES; page++) {
    const q = new URLSearchParams({ limit: '100', status: 'complete', 'created[gte]': String(gte), 'created[lt]': String(lt) })
    q.append('expand[]', 'data.payment_intent.latest_charge.balance_transaction')
    if (after) q.set('starting_after', after)
    const d = await fetchStripe(`/checkout/sessions?${q}`)
    for (const s of d.data || []) {
      if (s.payment_status !== 'paid' || !s.metadata?.registrationId || !s.metadata?.camp) continue
      const charge = s.payment_intent?.latest_charge && typeof s.payment_intent.latest_charge === 'object' ? s.payment_intent.latest_charge : null
      const fee = !s.amount_total ? { fee: 0 } : feeFrom(charge)
      sessions.push({ camp: String(s.metadata.camp).slice(0, 120), currency: String(s.currency || 'aud').toUpperCase(), day: new Date(((s.created || 0) + 36000) * 1000).toISOString().slice(0, 10), amountCents: s.amount_total || 0, refundedCents: charge?.amount_refunded || 0, feeCents: fee ? fee.fee : null })
    }
    if (!d.has_more || !(d.data || []).length) break
    after = d.data.at(-1).id
    if (page === MAX_PAGES - 1) truncated = true
  }
  const out = { year, at: new Date().toISOString(), camps: groupCampSessions(sessions), payments: sessions.length, truncated }
  await set(key, out, 7 * 86400).catch(() => {})
  return out
}
