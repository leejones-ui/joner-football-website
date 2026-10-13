// Money > Pro sessions (Lee, 13 Oct 2026): the money taken for Pro sessions,
// kept apart from JFP term income. Pro money is recognised by the keys agreed
// with the players work (programmes.md):
//   * a Term 4 row whose payment type is "JFP Pro sessions" (billed session
//     by session: the fee on the row is what has been billed so far);
//   * a Stripe Checkout Session with metadata jfpProgramme 'pro' (a Pro quick
//     link) or jfpProduct 'pro' (a payment link for Pro rows);
//   * cash and bank transfers recorded in the ledger against a Pro row;
//   * bank lines Lee marks "Pro session" on Bank transfers to check
//     (jfp:pro-bank, one hash field per bank line).
// None of it is in the JFP totals: moneyData leaves Pro rows, their ledger
// lines and Pro Stripe payments out. Read only here, except marking a bank
// line and putting it back (jfp-portal-data.js).
import { loadRoster, listLedger, PAINT_MAX_AGE_MS } from './_jfp-airtable.js'
import { jfpStripePayments } from './_jfp-stripe.js'
import { listPayreqs, kvCommand, rowEmails, sydneyToday } from './_jfp-store.js'

export const PRO_BANK = 'jfp:pro-bank'
// The agreed payment type (PRO_TYPE in the players work: "JFP Pro sessions").
export const isProRow = (type) => /pro session/i.test(String(type || ''))
// A ledger line is Pro when every row it was recorded for is a Pro row.
export function isProLedger(l, proIds) {
  const ids = String(l?.['Source Record ID'] || '').split(',').map((x) => x.trim()).filter(Boolean)
  return ids.length > 0 && ids.every((id) => proIds.has(id))
}

const cents = (aud) => (typeof aud === 'number' ? Math.round(aud * 100) : 0)
const sum = (list, k) => list.reduce((t, x) => t + (x[k] || 0), 0)
const monthLabel = (ym) => new Intl.DateTimeFormat('en-AU', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(`${ym}-01T00:00:00Z`))
const METHODS = { stripe: 'Stripe', bank: 'Bank transfer', cash: 'Cash', other: 'Other' }

export async function listProBank() {
  const flat = await kvCommand(['HGETALL', PRO_BANK]).catch(() => [])
  const out = []
  for (let i = 1; Array.isArray(flat) && i < flat.length; i += 2) { try { const r = JSON.parse(flat[i]); if (r?.id) out.push(r) } catch {} }
  return out
}

// Split an amount across rows: even shares, the odd cents on the first.
function shares(total, n) {
  if (n <= 1) return [total]
  const base = Math.trunc(total / n)
  return Array.from({ length: n }, (_, i) => base + (i === 0 ? total - base * n : 0))
}

// Every Pro payment as one line: Stripe, ledger cash / bank, and marked bank lines.
export function proLines({ rows = [], stripe = { pro: [] }, ledger = [], bankLines = [], payreqs = [] }) {
  const byId = new Map(rows.map((r) => [r.id, r]))
  const proIds = new Set(byId.keys())
  const payreqById = new Map(payreqs.map((q) => [q.id, q]))
  const nameOf = (ids) => ids.map((id) => byId.get(id)?.player).filter(Boolean).join(', ')
  const lines = []
  for (const p of stripe.pro || []) {
    const q = p.jfpRef ? payreqById.get(p.jfpRef) : null
    let rowIds = (q?.term4Ids || []).filter((id) => proIds.has(id))
    // A link made from a row says which rows. A quick link with no player
    // waits for Lee to look at it; it is never put on a family by email.
    const unplaced = Boolean(q?.quick) && !rowIds.length
    if (!q && !rowIds.length && p.email) rowIds = rows.filter((r) => rowEmails(r).includes(p.email)).map((r) => r.id)
    const fee = p.feeKnown ? p.feeCents || 0 : null
    lines.push({
      kind: 'stripe', id: p.id, intentId: p.intentId || '', paidDate: sydneyToday(Date.parse(p.at)), rowIds,
      who: nameOf(rowIds) || p.name || p.email || '', payer: p.name || '', note: q?.forText || (p.jfpRef ? 'Pro sessions link' : p.product || ''), quick: Boolean(q?.quick), toCheck: unplaced,
      takenCents: p.amountCents, refundedCents: p.refundedCents || 0, feeCents: fee, feeGstCents: p.feeKnown ? p.feeGstCents || 0 : null,
      keptCents: p.amountCents - (p.refundedCents || 0) - (fee || 0), feePending: !p.feeKnown, payMethod: p.payMethod || '',
    })
  }
  for (const l of ledger) {
    if (!l['Payment Method'] || l['Payment Method'] === 'Stripe' || !isProLedger(l, proIds)) continue
    const amount = Math.round(Number(l['Amount Paid'] || 0) * 100)
    const rowIds = String(l['Source Record ID']).split(',').map((x) => x.trim()).filter(Boolean)
    const kind = l['Payment Method'] === 'Cash' ? 'cash' : l['Payment Method'] === 'Bank Transfer' ? 'bank' : 'other'
    lines.push({ kind, id: l['Payment ID'] || l.id, paidDate: String(l['Payment Date'] || '').slice(0, 10), rowIds, who: nameOf(rowIds) || l['Player Name'] || '', payer: '', note: 'Recorded in the portal', takenCents: amount, refundedCents: 0, feeCents: 0, feeGstCents: 0, keptCents: amount, feePending: false, payMethod: '' })
  }
  for (const b of bankLines) {
    const rowIds = b.rowId && proIds.has(b.rowId) ? [b.rowId] : []
    lines.push({ kind: 'bank', id: b.id, paidDate: b.date, sessionDate: b.sessionDate || '', rowIds, who: nameOf(rowIds) || b.player || '', payer: b.payer || '', note: b.note || '', marked: true, takenCents: b.cents, refundedCents: 0, feeCents: 0, feeGstCents: 0, keptCents: b.cents, feePending: false, payMethod: '' })
  }
  return lines.sort((a, b) => (b.paidDate || '').localeCompare(a.paidDate || '') || String(a.id).localeCompare(String(b.id)))
}

function tally(list) {
  const part = (l) => ({ count: l.length, takenCents: sum(l, 'takenCents'), refundedCents: sum(l, 'refundedCents'), feeCents: sum(l, 'feeCents'), keptCents: sum(l, 'keptCents') })
  return { ...part(list), feeGstCents: sum(list, 'feeGstCents'), feesPending: list.filter((x) => x.feePending).length, stripe: part(list.filter((x) => x.kind === 'stripe')), bank: part(list.filter((x) => x.kind === 'bank')), cash: part(list.filter((x) => x.kind === 'cash' || x.kind === 'other')) }
}

// The whole view, worked out. month: 'YYYY-MM' or '' for every month.
export function proMoneyView({ rows = [], stripe = { pro: [], error: '' }, ledger = [], bankLines = [], payreqs = [], month = '', at = '' } = {}) {
  const all = proLines({ rows, stripe, ledger, bankLines, payreqs })
  const months = [...new Set(all.map((x) => (x.paidDate || '').slice(0, 7)).filter(Boolean))].sort().reverse()
  const chosen = months.includes(month) ? month : ''
  const list = chosen ? all.filter((x) => (x.paidDate || '').startsWith(chosen)) : all
  const byMonth = months.filter((m) => !chosen || m === chosen).map((m) => {
    const l = list.filter((x) => (x.paidDate || '').startsWith(m))
    const t = tally(l)
    return { month: m, label: monthLabel(m), count: t.count, takenCents: t.takenCents, refundedCents: t.refundedCents, feeCents: t.feeCents, keptCents: t.keptCents, stripeCents: t.stripe.keptCents, bankCents: t.bank.keptCents, cashCents: t.cash.keptCents }
  })
  // By player: what came in (this month or every month) and what Airtable
  // says has been billed and paid so far.
  const per = new Map(rows.map((r) => [r.id, { takenCents: 0, keptCents: 0, refundedCents: 0, feeCents: 0, count: 0 }]))
  const loose = { takenCents: 0, keptCents: 0, refundedCents: 0, feeCents: 0, count: 0 }
  for (const x of list) {
    const ids = x.rowIds.filter((id) => per.has(id))
    if (!ids.length) { for (const k of ['takenCents', 'keptCents', 'refundedCents', 'feeCents']) loose[k] += x[k] || 0; loose.count += 1; continue }
    const parts = Object.fromEntries(['takenCents', 'keptCents', 'refundedCents', 'feeCents'].map((k) => [k, shares(x[k] || 0, ids.length)]))
    ids.forEach((id, i) => { const p = per.get(id); for (const k of Object.keys(parts)) p[k] += parts[k][i]; p.count += 1 })
  }
  const byPlayer = rows.map((r) => {
    const billed = cents(r.feeAud), paid = cents(r.paidAud)
    return { rowId: r.id, player: r.player, parent: r.parent || '', group: [r.day, r.time, r.location].filter(Boolean).join(' ') || 'Not in a group', perSessionCents: r.perSessionCents || null, ...(r.prepaidSessions ? { prepaidSessions: r.prepaidSessions } : {}), billedCents: billed, paidCents: paid, owingCents: Math.max(0, billed - paid), holdsPlace: r.holdsPlace !== false, ...per.get(r.id) }
  }).filter((p) => p.holdsPlace || p.count || p.billedCents).sort((a, b) => a.player.localeCompare(b.player))
  return {
    at: at || new Date().toISOString(), month: chosen, months: months.map((m) => ({ id: m, label: monthLabel(m) })),
    stripeError: stripe.error || '', stripeAt: stripe.at || '', since: stripe.since || '',
    totals: { ...tally(list), billedCents: sum(byPlayer, 'billedCents'), owingCents: sum(byPlayer, 'owingCents'), players: byPlayer.filter((p) => p.holdsPlace).length },
    byMonth, byPlayer, unmatched: loose.count ? loose : null,
    toCheck: all.filter((x) => x.toCheck).map((x) => ({ id: x.id, paidDate: x.paidDate, takenCents: x.takenCents, who: x.payer || x.who, note: x.note })),
    lines: list.map((x) => ({ ...x, method: METHODS[x.kind] })),
  }
}

// Read and worked out. quick (first paint): the roster and ledger copies
// from the last 15 minutes that no write has overtaken, and the last Stripe
// read (up to 6 hours); the page reads again behind it.
export async function proMoneyData(config, { fresh = false, quick = false, month = '' } = {}) {
  const first = quick && !fresh
  const [roster, ledger, payreqs, bankLines] = await Promise.all([loadRoster({ fresh: !first, ...(first ? { maxAgeMs: PAINT_MAX_AGE_MS } : {}) }), listLedger(config.term, { paint: first }).catch(() => []), listPayreqs().catch(() => []), listProBank()])
  let stripe = { pro: [], error: '', at: '', since: config.moneySince }
  try { stripe = { ...(await jfpStripePayments({ since: config.moneySince, fresh, quick: quick && !fresh, term: config.term })), error: '' } } catch (error) {
    console.error('jfp pro stripe read failed', error.message)
    stripe.error = 'Stripe could not be read just now. Cash and bank transfers only.'
  }
  const rows = roster.players.filter((r) => isProRow(r.paymentType) && !/test/i.test(r.player || ''))
  return { ...proMoneyView({ rows, stripe, ledger, bankLines, payreqs, month }), quick: Boolean(quick && !fresh) }
}
