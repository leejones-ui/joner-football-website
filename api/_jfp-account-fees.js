// My account > Fees (Lee, 14 Oct 2026): for every family and every player
// who signs in. What they have paid this term (term fees, sessions, holiday
// training, Joners Juniors where we have it) and every payment record, newest
// first: card payments through Stripe (with Stripe's receipt where Stripe has
// one) and cash or bank transfers Joner Football recorded. Read only. What is
// owing now (and its Pay buttons) comes from the overview the page already has.
//
// Only this family's own records ever leave here: payment requests sent to
// their addresses, Stripe payments made with their addresses, ledger lines
// whose rows are all theirs, holiday bookings made with their addresses.
import { stripeFetch } from './_holiday-store.js'
import { listBookings } from './_holiday-store.js'
import { kvGetJson, kvSetJson, kvCommand, formatAud, emailsIn, isSessionType, isProType, sydneyToday, dateLabel, locationFor } from './_jfp-store.js'
import { listLedger } from './_jfp-airtable.js'
import { jfpStripePayments } from './_jfp-stripe.js'
import { listJJPayreqs } from './_jj-pay.js'
import { commitmentOf } from './_jfp-quote.js'

const cents = (aud) => (typeof aud === 'number' && Number.isFinite(aud) ? Math.round(aud * 100) : 0)
const dayOf = (iso) => (iso ? sydneyToday(Date.parse(iso)) : '')
const METHOD = { card: 'Card', afterpay_clearpay: 'Afterpay', link: 'Card', apple_pay: 'Apple Pay', google_pay: 'Google Pay' }
const RECEIPT_LOOKUPS = 8

// What a JFP payment request was for, in plain words.
export function payreqWhat(q, term) {
  if (q.prepay?.commit) return `Commitment: ${q.prepay.sessions} sessions in a row at ${formatAud(q.prepay.perCents)} each`
  if (q.prepay) return `${q.prepay.sessions} session${q.prepay.sessions > 1 ? 's' : ''} paid ahead`
  if (q.reason === 'trial') return 'Trial session'
  if (q.reason === 'sessions') return 'Sessions'
  if (q.next) return q.productLabel || `${q.next.term}${q.next.choice === 'hold' ? ', hold the place' : ''}`
  return q.productLabel || `${term} fee`
}

// Everything worked out from what was read (unit tested on its own).
export function feesView({ config, emails, rows = [], payreqs = [], stripe = [], ledger = [], bookings = [], jjPayreqs = [], receipts = {}, groups = {} }) {
  const mine = new Set(emails)
  const rowIds = new Set(rows.map((r) => r.id))
  const records = []
  const seenRefs = new Set()
  const seenIntents = new Set()
  const today = sydneyToday()
  for (const q of payreqs) {
    if (q.status !== 'paid' || q.quick || !emailsIn(q.email).some((e) => mine.has(e))) continue
    seenRefs.add(q.id)
    if (q.stripePaymentIntentId) seenIntents.add(q.stripePaymentIntentId)
    records.push({ id: q.id, date: dayOf(q.paidAt), at: q.paidAt || '', programme: q.programme === 'pro' ? 'Pro sessions' : 'JFP', what: payreqWhat(q, config.term), players: q.playerNames || [], method: 'Card', amountCents: q.paidCents ?? q.amountCents, refundedCents: q.refundedCents || 0, intentId: q.stripePaymentIntentId || '' })
  }
  for (const q of jjPayreqs) {
    if (q.status !== 'paid' || !mine.has(String(q.email || '').toLowerCase())) continue
    seenRefs.add(q.id)
    if (q.stripePaymentIntentId) seenIntents.add(q.stripePaymentIntentId)
    records.push({ id: q.id, date: dayOf(q.paidAt), at: q.paidAt || '', programme: 'Joners Juniors', what: q.next ? `${q.next.term}` : `${q.term || 'Joners Juniors'} fee`, players: q.playerNames || [], method: 'Card', amountCents: q.paidCents ?? q.amountCents, refundedCents: q.refundedCents || 0, intentId: q.stripePaymentIntentId || '' })
  }
  // Card payments Stripe has under their addresses that no request above
  // explains (payment links from before the portal, for example).
  for (const p of stripe) {
    if (!mine.has(p.email) || (p.jfpRef && seenRefs.has(p.jfpRef)) || (p.intentId && seenIntents.has(p.intentId))) continue
    if (p.intentId) seenIntents.add(p.intentId)
    records.push({ id: p.id, date: dayOf(p.at), at: p.at, programme: p.pro ? 'Pro sessions' : 'JFP', what: p.product && p.product !== 'JFP' && !/^Quick link/.test(p.product) ? p.product : 'JFP payment', players: [], method: METHOD[p.payMethod] || 'Card', amountCents: p.amountCents, refundedCents: p.refundedCents || 0, intentId: p.intentId || '' })
  }
  // Cash and bank transfers recorded in the portal, for their own rows only.
  for (const l of ledger) {
    const m = l['Payment Method']
    if (!m || m === 'Stripe') continue
    const ids = String(l['Source Record ID'] || '').split(',').map((x) => x.trim()).filter(Boolean)
    if (!ids.length || !ids.every((id) => rowIds.has(id))) continue
    const pro = ids.every((id) => isProType(rows.find((r) => r.id === id)?.paymentType))
    records.push({ id: l['Payment ID'] || l.id, date: String(l['Payment Date'] || '').slice(0, 10), at: String(l['Payment Date'] || ''), programme: pro ? 'Pro sessions' : 'JFP', what: 'Recorded by Joner Football', players: l['Player Name'] ? [l['Player Name']] : [], method: m === 'Bank Transfer' ? 'Bank transfer' : m, amountCents: Math.round(Number(l['Amount Paid'] || 0) * 100), refundedCents: 0, intentId: '' })
  }
  for (const b of bookings) {
    if (b.status !== 'paid' || !mine.has(String(b.email || '').toLowerCase())) continue
    if (b.stripePaymentIntentId) seenIntents.add(b.stripePaymentIntentId)
    records.push({ id: b.id, date: dayOf(b.paidAt), at: b.paidAt || '', programme: 'Holiday training', what: 'Holiday training', players: (b.players || []).map((x) => x.name).filter(Boolean), method: 'Card', amountCents: b.amountPaidCents ?? b.priceCents ?? 0, refundedCents: b.refundedCents || 0, intentId: b.stripePaymentIntentId || '' })
  }
  records.sort((a, b) => (b.date || '').localeCompare(a.date || '') || String(b.at).localeCompare(String(a.at)))
  const out = records.map(({ intentId, at, ...r }) => ({ ...r, dateLabel: r.date ? dateLabel(r.date) : '', amountLabel: formatAud(r.amountCents), ...(r.refundedCents ? { refundedLabel: formatAud(r.refundedCents) } : {}), receiptUrl: (intentId && receipts[intentId]) || '' }))
  // This term's places: fee, paid, and for sessions what is prepaid or committed.
  const places = rows.filter((r) => r.holdsPlace || cents(r.paidAud) > 0).map((r) => {
    const g = groups[r.groupId]
    const where = g ? `${g.day} ${g.time}, ${locationFor(config, g.location).name}` : [r.day, r.time, r.location].filter(Boolean).join(' ') || 'Group to be confirmed'
    const sessions = isSessionType(r.paymentType)
    const fee = cents(r.feeAud), paid = cents(r.paidAud)
    const c = sessions ? commitmentOf(r.notes, today) : null
    return {
      rowId: r.id, player: r.player, group: where, kind: isProType(r.paymentType) ? 'pro' : sessions ? 'sessions' : /trial/i.test(r.paymentType || '') ? 'trial' : 'term',
      feeCents: fee, paidCents: paid, owingCents: Math.max(0, fee - paid),
      paidLabel: formatAud(paid), feeLabel: formatAud(fee),
      ...(sessions && r.prepaidSessions ? { prepaidSessions: r.prepaidSessions } : {}),
      ...(c ? { commitment: { sessions: c.sessions, left: c.left, leftDates: c.leftDates.map(dateLabel) } } : {}),
    }
  })
  const sum = (list) => list.reduce((t, r) => t + (r.amountCents - (r.refundedCents || 0)), 0)
  const byProg = (p) => sum(records.filter((r) => r.programme === p))
  const totals = [['JFP', byProg('JFP')], ['Pro sessions', byProg('Pro sessions')], ['Holiday training', byProg('Holiday training')], ['Joners Juniors', byProg('Joners Juniors')]]
    .filter(([, c]) => c > 0).map(([label, c]) => ({ label, cents: c, amountLabel: formatAud(c) }))
  return { term: config.term, places, totals, paidCents: sum(records), paidLabel: formatAud(sum(records)), records: out, intentIds: records.map((r) => r.intentId).filter(Boolean) }
}

// Stripe's own receipt for a payment, kept once found. A few asked per read.
async function receiptsFor(intentIds) {
  const out = {}
  const ids = [...new Set(intentIds.filter((x) => /^pi_[A-Za-z0-9_]+$/.test(x)))]
  if (!ids.length) return out
  const hits = await Promise.all(ids.map((id) => kvGetJson(`jfp:receipt:${id}`).catch(() => null)))
  const ask = []
  ids.forEach((id, i) => { if (hits[i]?.url != null) out[id] = hits[i].url; else ask.push(id) })
  for (const id of ask.slice(0, RECEIPT_LOOKUPS)) {
    // Not asked again for an hour when Stripe has none or cannot be reached.
    if ((await kvCommand(['SET', `jfp:receipt-try:${id}`, '1', 'NX', 'EX', '3600']).catch(() => null)) !== 'OK') continue
    try {
      const pi = await stripeFetch(`/payment_intents/${encodeURIComponent(id)}?expand[]=latest_charge`)
      const url = /^https:\/\//.test(pi?.latest_charge?.receipt_url || '') || /^http:\/\/localhost[:/]/.test(pi?.latest_charge?.receipt_url || '') ? pi.latest_charge.receipt_url : ''
      if (url) { await kvSetJson(`jfp:receipt:${id}`, { url }); out[id] = url }
    } catch (error) { console.error('jfp receipt read failed', id, error.message) }
  }
  return out
}

const within = (p, ms, fallback) => Promise.race([p, new Promise((r) => setTimeout(() => r(fallback), ms))])

// Read and worked out. fam: familyFor() of the signed-in address.
export async function familyFees({ config, parent, fam, payreqs, groups = [] }) {
  const emails = [...new Set([parent.email, ...(fam.emails || [])])]
  const rows = fam.players.flatMap((p) => p.term4)
  const [ledger, bookings, jjPayreqs, stripe] = await Promise.all([
    listLedger(config.term, { quick: true }).catch(() => []),
    listBookings().catch(() => []),
    listJJPayreqs().catch(() => []),
    // The copy Money keeps (up to 6 hours old); never a long Stripe read for a family page.
    within(jfpStripePayments({ since: config.moneySince, quick: true, term: config.term }).then((s) => [...(s.payments || []), ...(s.next || []), ...(s.pro || [])]).catch(() => []), 6000, []),
  ])
  const byGroup = Object.fromEntries(groups.map((g) => [g.id, g]))
  const first = feesView({ config, emails, rows, payreqs, stripe, ledger, bookings, jjPayreqs, groups: byGroup })
  const receipts = await receiptsFor(first.intentIds).catch(() => ({}))
  return Object.keys(receipts).length ? feesView({ config, emails, rows, payreqs, stripe, ledger, bookings, jjPayreqs, receipts, groups: byGroup }) : first
}
