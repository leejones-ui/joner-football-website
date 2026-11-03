// Money > Latest payments (Lee, 3 Nov 2026): "a live payment, just like the
// Joner Football app": every JFP payment newest first, so when the Castorinas
// pay their invoice or Niki pays an extra session it is at the top. Filter by
// kind (term fees, extra sessions, invoices, other), with a total for each.
//
// Read from what is already stored, nothing new is written:
//   payment links that are paid (term fees, extra sessions, invoices, quick links)
//   new family bookings that are paid
//   JFP Payment Ledger lines not already shown from a link or booking
//   (bank transfers and cash recorded in the portal, older Stripe lines)
import { listPayreqs, listBookings, sydneyToday, dateLabel } from './_jfp-store.js'
import { listLedger } from './_jfp-airtable.js'
import { payreqWhat } from './_jfp-account-fees.js'
import { listCharges } from './_jfp-charges.js'

export const KINDS = { jfp: 'Term fees', extra: 'Extra sessions', invoice: 'Invoices', other: 'Other' }
const OFFLINE = { bank: 'Bank transfer', cash: 'Cash', other: 'Other' }
const LEDGER_METHOD = { 'Bank Transfer': 'Bank transfer', Cash: 'Cash', Stripe: 'Card' }

export function kindOf(q) {
  if (q.charge?.kind === 'extra' || q.programme === 'extra') return 'extra'
  if (q.invoiceId) return 'invoice'
  if (q.quick || (q.programme && q.programme !== 'jfp')) return 'other'
  return 'jfp'
}
const dayOf = (iso) => (iso ? sydneyToday(Date.parse(iso)) : '')

// Pure: the list from what was read (unit tested on its own).
export function latestView({ config, payreqs = [], bookings = [], ledger = [], charges = [], limit = 300 }) {
  const items = []
  // Extra sessions: the coach and the session day come from the charge.
  const chargeOf = new Map(charges.map((c) => [c.id, c]))
  const seen = new Set()
  for (const q of payreqs) {
    if (q.status !== 'paid') continue
    if (q.stripeSessionId) seen.add(q.stripeSessionId)
    if (q.stripePaymentIntentId) seen.add(q.stripePaymentIntentId)
    // An invoice for a place paid by bank or cash: its ledger lines are the record.
    if (q.paidOffline && !q.charge) continue
    seen.add(q.id)
    items.push({
      id: q.id, at: q.paidAt || q.createdAt || '', kind: kindOf(q), what: payreqWhat(q, config.term),
      who: (q.playerNames || []).join(', ') || q.payerName || q.parentName || '', parent: q.parentName || '',
      method: q.paidOffline ? OFFLINE[q.paidMethod] || 'Other' : 'Card', cents: (q.paidCents ?? q.amountCents ?? 0) - (q.refundedCents || 0),
      rowIds: q.term4Ids || (q.rowId ? [q.rowId] : []),
      ...(q.charge?.id && chargeOf.has(q.charge.id) ? { coach: chargeOf.get(q.charge.id).coachName || '', sessionDate: chargeOf.get(q.charge.id).sessionDate || '' } : {}),
    })
  }
  for (const b of bookings) {
    if (b.status !== 'paid') continue
    if (b.stripeSessionId) seen.add(b.stripeSessionId)
    if (b.stripePaymentIntentId) seen.add(b.stripePaymentIntentId)
    items.push({
      id: b.id, at: b.paidAt || b.createdAt || '', kind: 'jfp', what: 'New family booking',
      who: (b.players || []).map((p) => p.name).join(', '), parent: b.parentName || '', method: 'Card',
      cents: (b.amountPaidCents ?? b.priceCents ?? 0) - (b.refundedCents || 0), rowIds: b.term4Ids || [],
    })
  }
  // Ledger lines split per player ("<id>#2") are one payment: shown once each,
  // as the ledger keeps them.
  for (const l of ledger) {
    const sid = l['Stripe Checkout Session ID'] || '', pid = l['Stripe Payment Intent ID'] || ''
    if ((sid && seen.has(sid)) || (pid && seen.has(pid))) continue
    if (/^cancel|^refund|^void/i.test(l['Payment Status'] || '')) continue
    const cents = Math.round(Number(l['Amount Paid'] || 0) * 100)
    if (!cents) continue
    // Payment Date is a date, or a note with one in it ("Opening balance confirmed by 2026-08-11").
    const raw = String(l['Payment Date'] || '')
    const at = /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw : (raw.match(/\d{4}-\d{2}-\d{2}/) || [''])[0]
    if (!at) continue
    items.push({
      id: l.id, at, kind: 'jfp', what: l.Term ? `${l.Term} fee` : 'Term fee',
      who: l['Player Name'] || '', parent: '', method: LEDGER_METHOD[l['Payment Method']] || l['Payment Method'] || 'Other', cents,
      rowIds: l['Source Record ID'] ? [l['Source Record ID']] : [],
    })
  }
  items.sort((a, b) => String(b.at).localeCompare(String(a.at)))
  // Totals: this term (from the term's first day) and every payment on record.
  const zero = () => Object.fromEntries(Object.keys(KINDS).map((k) => [k, { cents: 0, count: 0 }]))
  const totals = zero(), allTime = zero()
  const from = config.termStart || ''
  const lastByRow = {}
  for (const x of items) {
    allTime[x.kind].cents += x.cents; allTime[x.kind].count += 1
    if (dayOf(x.at) >= from || String(x.at).slice(0, 10) >= from) { totals[x.kind].cents += x.cents; totals[x.kind].count += 1 }
    for (const r of x.rowIds) if (!lastByRow[r] || x.at > lastByRow[r]) lastByRow[r] = x.at
  }
  return {
    items: items.filter((x, i) => i < limit || x.kind === 'extra').map(({ rowIds, ...x }) => ({ ...x, rowIds, date: dayOf(x.at) || String(x.at).slice(0, 10), dateLabel: dateLabel(dayOf(x.at) || String(x.at).slice(0, 10)), timed: /T\d\d:\d\d/.test(x.at) && !/T00:00:00/.test(x.at) })),
    totals, allTime, termLabel: from ? `since ${dateLabel(from)}` : 'this term', lastByRow, kinds: KINDS,
  }
}

export async function latestPayments(config) {
  const [payreqs, bookings, ledger, charges] = await Promise.all([listPayreqs(), listBookings(), listLedger('', { quick: true }).catch(() => []), listCharges().catch(() => [])])
  return latestView({ config, payreqs, bookings, ledger, charges })
}
