// Holiday training money (Lee, 13 Oct 2026): what school holiday training
// brought in, per NSW school holiday. Read only.
//
// Two kinds of money:
//   stripe  holiday bookings (HOL-...) paid on the Sydney Stripe account. The
//           fee is the real one from each charge's balance transaction (the
//           JFP fee helpers and their per-intent KV cache, kept for good), the
//           refund is what Stripe has refunded on the charge.
//   bank    bank transfers Lee marked "Holiday revenue" on Bank transfers to
//           check (KV jfp:holiday-bank). No fee.
//   link    quick payment links made for Holiday training (PAY-..., programme
//           holiday, Money > Payment links): Stripe, with the real fee. One
//           with no player named is "to check" until Lee ticks it.
// A booking counts in the holiday its session is in (the slot's date). A bank
// line counts in the holiday Lee picked for it.
//
// Holiday money is never in the JFP figures: classifySession leaves holiday
// sessions out of the JFP Stripe read, and these lines are claimed so they can
// never also be recorded for a player.
import { stripeFetch, listBookings, listSlots, getConfig as getHolidayConfig, kvGetJson, kvSetJson, kvCommand, coachById, formatAud } from './_holiday-store.js'
import { feeFrom, fillFees } from './_jfp-stripe.js'
import { HOLIDAY_PERIODS, OTHER, OTHER_LABEL, periodOf, periodById, pickablePeriods, rangeLabel, holidayPriceSizes, suggestPeriod } from './_holiday-periods.js'
import { listPayreqs } from './_jfp-store.js'
import { QUICK_CHECKED } from './_jfp-quick.js'

export const HOLIDAY_BANK = 'jfp:holiday-bank'
// v2 also has the quick links made for holiday training.
const STRIPE_CACHE = 'holiday:stripe-payments:v2'
const STRIPE_CACHE_SECONDS = 300
const MAX_PAGES = 20
export const ALL = 'all'
export const ALL_LABEL = 'All holiday training'

// The Sydney calendar day of an instant.
export function sydneyDay(iso) {
  const ms = Date.parse(iso || '')
  if (!Number.isFinite(ms)) return ''
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms))
}
const monthLabel = (ym) => new Intl.DateTimeFormat('en-AU', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(`${ym}-01T00:00:00Z`))

export const TYPE_NAMES = { one: '1 on 1', shared: 'Shared (2 players)', group: 'Small group', bank: 'Bank transfer', link: 'Payment link' }

// ---------- reading ----------

// Paid holiday Checkout Sessions on the Sydney account since `since`, with
// what Stripe kept and refunded. Kept in KV for 5 minutes; fresh reads again.
export async function holidayStripePayments({ since, fresh = false } = {}) {
  const sinceIso = /^\d{4}-\d{2}-\d{2}$/.test(since || '') ? since : '2026-09-01'
  if (!fresh) {
    const hit = await kvGetJson(STRIPE_CACHE).catch(() => null)
    if (hit && hit.since <= sinceIso && Array.isArray(hit.payments) && Date.now() - Date.parse(hit.at) < STRIPE_CACHE_SECONDS * 1000) return hit
  }
  const gte = Math.floor(Date.parse(`${sinceIso}T00:00:00+10:00`) / 1000)
  const payments = []
  let after = ''
  let truncated = false
  for (let page = 0; page < MAX_PAGES; page++) {
    const q = new URLSearchParams({ limit: '100', status: 'complete', 'created[gte]': String(gte) })
    q.append('expand[]', 'data.payment_intent.latest_charge.balance_transaction')
    if (after) q.set('starting_after', after)
    const d = await stripeFetch(`/checkout/sessions?${q}`)
    for (const s of d.data || []) {
      // A holiday booking, or a quick payment link made for holiday training.
      const bookingId = String(s.metadata?.holidayBookingId || (s.metadata?.jfpProgramme === 'holiday' ? s.metadata?.jfpBookingId || '' : ''))
      if (!bookingId || s.payment_status !== 'paid') continue
      const pi = s.payment_intent && typeof s.payment_intent === 'object' ? s.payment_intent : null
      const charge = pi?.latest_charge && typeof pi.latest_charge === 'object' ? pi.latest_charge : null
      const fee = !s.amount_total ? { fee: 0, gst: 0, net: 0 } : feeFrom(charge)
      payments.push({
        id: s.id,
        intentId: pi?.id || (typeof s.payment_intent === 'string' ? s.payment_intent : ''),
        bookingId,
        slotId: String(s.metadata?.slotId || ''),
        at: new Date((s.created || 0) * 1000).toISOString(),
        amountCents: s.amount_total || 0,
        refundedCents: charge?.amount_refunded || 0,
        payMethod: charge?.payment_method_details?.type || '',
        ...(fee ? { feeCents: fee.fee, feeGstCents: fee.gst, feeKnown: true } : { feeCents: null, feeGstCents: null, feeKnown: false }),
      })
    }
    if (!d.has_more || !(d.data || []).length) break
    after = d.data.at(-1).id
    // Newest first: stopping here leaves out the oldest, so say so.
    if (page === MAX_PAGES - 1) truncated = true
  }
  // A fee Stripe had not worked out yet: the shared per-intent cache, then Stripe.
  try { await fillFees(payments) } catch (error) { console.error('holiday stripe fees failed', error.message) }
  const out = { since: sinceIso, at: new Date().toISOString(), payments, truncated }
  await kvSetJson(STRIPE_CACHE, out, 3600).catch(() => {})
  return out
}

export async function listHolidayBank() {
  const flat = await kvCommand(['HGETALL', HOLIDAY_BANK]).catch(() => [])
  const out = []
  for (let i = 1; Array.isArray(flat) && i < flat.length; i += 2) { try { const r = JSON.parse(flat[i]); if (r?.id) out.push(r) } catch {} }
  return out
}

// Everything the holiday money view needs, read now. locationOf(name) gives
// the venue a slot's location is (the JFP venue list).
export async function holidayMoneyData({ period = '', fresh = false, locationOf, today } = {}) {
  const [config, bookings, slots, bankLines, payreqs, checkedRaw] = await Promise.all([getHolidayConfig(), listBookings({ limit: 2000 }), listSlots({ includeCancelled: true }), listHolidayBank(), listPayreqs().catch(() => []), kvCommand(['HGETALL', QUICK_CHECKED]).catch(() => [])])
  const quickLinks = payreqs.filter((q) => q?.quick && q.programme === 'holiday' && q.status === 'paid')
  const checked = {}
  for (let i = 0; Array.isArray(checkedRaw) && i + 1 < checkedRaw.length; i += 2) checked[checkedRaw[i]] = checkedRaw[i + 1]
  const firstDay = [...bookings.map((b) => sydneyDay(b.createdAt)), ...quickLinks.map((q) => sydneyDay(q.createdAt))].filter(Boolean).sort()[0]
  let stripe = { payments: [], error: '', at: '' }
  if (bookings.length || quickLinks.length) {
    try { stripe = { ...(await holidayStripePayments({ since: firstDay ? addDaysIso(firstDay, -1) : '', fresh })), error: '' } } catch (error) {
      console.error('holiday stripe read failed', error)
      stripe.error = 'Stripe could not be read just now. Bookings show what they were paid; fees and refunds are not known.'
    }
  }
  return holidayMoneyView({ bookings, slots, config, stripe, bankLines, quickLinks, checked, locationOf, today, period })
}
const addDaysIso = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10)

// Every amount a holiday booking could cost, for the bank hints.
export async function holidaySizes() {
  const [config, slots] = await Promise.all([getHolidayConfig(), listSlots({ includeCancelled: true })])
  return { config, sizes: holidayPriceSizes(config.prices, slots.map((s) => s.priceCents)) }
}

// ---------- working it out (pure) ----------

const sum = (list, k) => list.reduce((t, x) => t + (x[k] || 0), 0)

// One line per paid booking and per bank line marked as holiday training.
export function holidayLines({ bookings = [], slots = [], config = { coaches: [] }, stripe = { payments: [], error: '' }, bankLines = [], quickLinks = [], checked = {}, locationOf = (n) => ({ id: 'other', name: n || 'No venue set' }) }) {
  const slotsById = new Map(slots.map((s) => [s.id, s]))
  const pays = new Map()
  for (const p of stripe.payments || []) pays.set(p.bookingId, [...(pays.get(p.bookingId) || []), p])
  const stripeOk = !stripe.error
  const lines = []
  const seen = new Set()
  const fromBooking = (b, slot, list) => {
    const found = list.length > 0
    const taken = found ? sum(list, 'amountCents') : Number(b?.amountPaidCents ?? b?.priceCents ?? 0)
    const refunded = found ? sum(list, 'refundedCents') : 0
    const feeKnown = found && list.every((p) => p.feeKnown)
    const fee = feeKnown ? sum(list, 'feeCents') : null
    const gst = feeKnown ? sum(list, 'feeGstCents') : null
    const sessionDate = slot?.date || ''
    const paidAt = b?.paidAt || list[0]?.at || b?.createdAt || ''
    const coach = coachById(config, slot?.coachId || b?.coachId)?.name || b?.coachName || slot?.coachId || 'Not known'
    const loc = locationOf(slot?.location || config.defaultLocation || '')
    const shared = slot?.seatMode === 'shared'
    const type = shared ? 'trial' : b?.type || slot?.type || ''
    const typeName = shared ? (slot?.title || 'Group session') : TYPE_NAMES[type] || 'Session'
    const seats = Number(b?.seats) || (b?.players || []).length || 1
    const unit = Number.isInteger(b?.unitCents) ? b.unitCents : Math.round(taken / seats)
    const cancelled = b?.status === 'cancelled'
    const due = cancelled && b?.refundDue ? Number(b?.refund?.cents ?? taken) : 0
    return {
      kind: 'stripe', id: b?.id || list[0]?.bookingId, bookingId: b?.id || list[0]?.bookingId || '',
      status: !b ? 'no-booking' : cancelled ? 'cancelled' : b.status === 'paid' ? 'paid' : 'stripe-only',
      period: periodOf(sessionDate), sessionDate, time: slot?.startTime || '', paidDate: sydneyDay(paidAt),
      coach, locationId: loc.id, location: loc.name, type, typeName, unitCents: unit, band: `${typeName} · ${formatAud(unit)} a player`, seats,
      who: b?.parentName || '', players: (b?.players || []).map((p) => p.name).filter(Boolean),
      takenCents: taken, refundedCents: refunded, feeCents: fee, feeGstCents: gst, feePending: !feeKnown,
      keptCents: taken - refunded - (fee || 0),
      stripeFound: found, stripeChecked: stripeOk,
      refundDueCents: due, refundOwedCents: due && found ? Math.max(0, due - refunded) : due && stripeOk ? due : null,
      intentId: list[0]?.intentId || b?.stripePaymentIntentId || '', payMethod: list[0]?.payMethod || '',
    }
  }
  for (const b of bookings) {
    if (!b?.id) continue
    const list = pays.get(b.id) || []
    const wasPaid = b.status === 'paid' || (b.status === 'cancelled' && (b.paidAt || b.refundDue))
    if (!wasPaid && !list.length) continue
    seen.add(b.id)
    lines.push(fromBooking(b, slotsById.get(b.slotId), list))
  }
  // A quick payment link for holiday training: Stripe's own figures when the
  // list has it, else what the link recorded when it was paid.
  const quickById = new Map(quickLinks.map((q) => [q.id, q]))
  const fromLink = (q, list) => {
    const found = list.length > 0
    const taken = found ? sum(list, 'amountCents') : Number(q?.paidCents ?? q?.amountCents ?? 0)
    const refunded = found ? sum(list, 'refundedCents') : Number(q?.refundedCents || 0)
    const feeKnown = found ? list.every((p) => p.feeKnown) : Number.isInteger(q?.stripeFeeCents)
    const fee = !feeKnown ? null : found ? sum(list, 'feeCents') : q.stripeFeeCents
    const paidDate = sydneyDay(q?.paidAt || list[0]?.at || q?.createdAt || '')
    const p = periodById(q?.holidayPeriod)
    const inBreak = p && paidDate >= p.from && paidDate <= p.to
    const loc = locationOf('')
    const named = (q?.playerNames || []).length > 0
    return {
      kind: 'stripe', link: true, id: q?.id || list[0]?.bookingId, bookingId: '', status: named || checked[q?.id || list[0]?.bookingId] ? 'link' : 'link-check',
      period: p ? p.id : suggestPeriod(paidDate).id, sessionDate: '', time: '', paidDate, monthDate: p && !inBreak ? p.start : paidDate,
      coach: 'Not noted', locationId: loc.id, location: loc.name, type: 'link', typeName: TYPE_NAMES.link, unitCents: taken, band: `${TYPE_NAMES.link} · ${formatAud(taken)}`, seats: null,
      who: q?.payerName || q?.parentName || '', players: q?.playerNames || [], note: q?.forText || '',
      takenCents: taken, refundedCents: refunded, feeCents: fee, feeGstCents: feeKnown ? (found ? sum(list, 'feeGstCents') : null) : null, feePending: !feeKnown,
      keptCents: taken - refunded - (fee || 0), stripeFound: found, stripeChecked: stripeOk, refundDueCents: 0, refundOwedCents: 0,
      intentId: list[0]?.intentId || q?.stripePaymentIntentId || '', payMethod: list[0]?.payMethod || '',
    }
  }
  for (const [id, list] of pays) {
    if (seen.has(id)) continue
    // Paid in Stripe for a booking the store no longer has.
    if (!id.startsWith('PAY-')) { lines.push(fromBooking(null, slotsById.get(list[0].slotId), list)); continue }
    seen.add(id)
    lines.push(fromLink(quickById.get(id), list))
  }
  for (const q of quickLinks) if (!seen.has(q.id)) { seen.add(q.id); lines.push(fromLink(q, [])) }
  for (const x of bankLines) {
    const p = periodById(x.period)
    // No session date: the bank date, or the holiday's first day when the money came in before or after it.
    const inBreak = p && x.date >= p.from && x.date <= p.to
    const loc = locationOf(x.location || '')
    lines.push({
      kind: 'bank', id: x.id, bookingId: '', status: 'bank', period: p ? p.id : OTHER, sessionDate: x.sessionDate || '', time: '', paidDate: x.date,
      monthDate: x.sessionDate || (p && !inBreak ? p.start : x.date),
      coach: x.coach || 'Not noted', locationId: loc.id, location: loc.name, type: 'bank', typeName: TYPE_NAMES.bank, unitCents: x.cents, band: `Bank transfer · ${formatAud(x.cents)}`, seats: null,
      who: x.payer || '', players: [], note: x.note || '', by: x.by || '', at: x.at || '',
      takenCents: x.cents, refundedCents: 0, feeCents: 0, feeGstCents: 0, feePending: false, keptCents: x.cents,
      stripeFound: false, stripeChecked: true, refundDueCents: 0, refundOwedCents: 0,
    })
  }
  return lines.sort((a, b) => (b.sessionDate || b.monthDate || b.paidDate || '').localeCompare(a.sessionDate || a.monthDate || a.paidDate || '') || String(a.id).localeCompare(String(b.id)))
}

function tally(list) {
  const stripe = list.filter((x) => x.kind === 'stripe'), bank = list.filter((x) => x.kind === 'bank')
  const part = (l) => ({ count: l.length, takenCents: sum(l, 'takenCents'), refundedCents: sum(l, 'refundedCents'), feeCents: sum(l, 'feeCents'), keptCents: sum(l, 'keptCents') })
  return { ...part(list), feeGstCents: sum(list, 'feeGstCents'), feesPending: list.filter((x) => x.feePending).length, stripe: part(stripe), bank: part(bank) }
}
function groupBy(list, keyOf, labelOf) {
  const by = new Map()
  for (const x of list) {
    const k = keyOf(x)
    const g = by.get(k) || { key: k, label: labelOf(x), list: [] }
    g.list.push(x)
    by.set(k, g)
  }
  return [...by.values()].map(({ key, label, list: l }) => ({ key, label, count: l.length, takenCents: sum(l, 'takenCents'), refundedCents: sum(l, 'refundedCents'), feeCents: sum(l, 'feeCents'), keptCents: sum(l, 'keptCents'), stripeKeptCents: sum(l.filter((x) => x.kind === 'stripe'), 'keptCents'), bankKeptCents: sum(l.filter((x) => x.kind === 'bank'), 'keptCents') }))
    .sort((a, b) => b.keptCents - a.keptCents || a.label.localeCompare(b.label))
}
// Kept per calendar month, by session date or by the day the money came in.
export function byMonth(list, basis) {
  const day = (x) => (basis === 'paid' ? x.paidDate : x.kind === 'bank' ? x.monthDate : x.sessionDate || x.paidDate)
  return groupBy(list, (x) => String(day(x) || '').slice(0, 7) || 'none', (x) => { const m = String(day(x) || '').slice(0, 7); return m ? monthLabel(m) : 'No date' })
    .sort((a, b) => b.key.localeCompare(a.key))
    .map((g) => ({ month: g.key, label: g.label, count: g.count, stripeCents: g.stripeKeptCents, bankCents: g.bankKeptCents, keptCents: g.keptCents, takenCents: g.takenCents, refundedCents: g.refundedCents, feeCents: g.feeCents }))
}

// The holidays to pick from: newest first (the next one coming, every one
// started, and any later one with money in it), then Other dates, then all.
export function periodList(lines, today) {
  const withData = new Set(lines.map((x) => x.period))
  const pick = new Set(pickablePeriods(today).map((p) => p.id))
  const list = HOLIDAY_PERIODS.filter((p) => pick.has(p.id) || withData.has(p.id)).sort((a, b) => b.from.localeCompare(a.from))
  const row = (id, label, range, l) => ({ id, label, range, count: l.length, takenCents: sum(l, 'takenCents'), keptCents: sum(l, 'keptCents') })
  return [
    ...list.map((p) => row(p.id, p.label, rangeLabel(p), lines.filter((x) => x.period === p.id))),
    row(OTHER, OTHER_LABEL, 'Sessions outside the school holidays', lines.filter((x) => x.period === OTHER)),
    row(ALL, ALL_LABEL, 'Every holiday and other dates', lines),
  ]
}

// The whole view for one holiday (or Other dates, or all of it).
export function holidayMoneyView({ bookings, slots, config, stripe, bankLines, quickLinks = [], checked = {}, locationOf, today, period = '' } = {}) {
  const lines = holidayLines({ bookings, slots, config, stripe, bankLines, quickLinks, checked, locationOf })
  const periods = periodList(lines, today)
  const known = new Set(periods.map((p) => p.id))
  // No holiday asked for: the newest one with money in it, else the newest.
  const chosen = known.has(period) ? period : (periods.find((p) => p.id !== ALL && p.id !== OTHER && p.count) || periods.find((p) => p.id !== ALL && p.count) || periods[0]).id
  const list = chosen === ALL ? lines : lines.filter((x) => x.period === chosen)
  const p = periodById(chosen)
  return {
    period: chosen,
    label: chosen === ALL ? ALL_LABEL : chosen === OTHER ? OTHER_LABEL : p.label,
    range: chosen === ALL || chosen === OTHER ? '' : rangeLabel(p),
    periods,
    stripeError: stripe?.error || (stripe?.truncated ? `Only the newest ${MAX_PAGES * 100} Stripe payments were read, so the oldest holiday payments may be missing.` : ''), stripeAt: stripe?.at || '',
    totals: tally(list),
    byCoach: groupBy(list, (x) => x.coach.toLowerCase(), (x) => x.coach),
    byLocation: groupBy(list, (x) => x.locationId, (x) => x.location),
    byType: groupBy(list, (x) => `${x.type}|${x.unitCents}`, (x) => x.band),
    byMonth: { session: byMonth(list, 'session'), paid: byMonth(list, 'paid') },
    refundsOwed: list.filter((x) => x.kind === 'stripe' && x.refundDueCents > 0 && x.refundOwedCents !== 0).map((x) => ({ bookingId: x.bookingId, sessionDate: x.sessionDate, time: x.time, coach: x.coach, who: x.who, takenCents: x.takenCents, refundDueCents: x.refundDueCents, refundedCents: x.refundedCents, owedCents: x.refundOwedCents, stripeChecked: x.stripeFound, intentId: x.intentId })),
    // Quick links with no player named, for Lee to look at (every holiday).
    toCheck: lines.filter((x) => x.status === 'link-check').map((x) => ({ id: x.id, paidDate: x.paidDate, takenCents: x.takenCents, who: x.who, note: x.note, period: x.period })),
    lines: list,
  }
}
