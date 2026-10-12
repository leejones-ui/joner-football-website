// Revenue by venue (Lee, 6 Oct 2026: "click the venue and see my revenue").
//
// Money first. Every Stripe payment and every cash or bank transfer in the
// payment ledger goes onto the player rows it was for, and each row belongs
// to a venue, so this term's venues add up to "Income this term" to the
// cent. A payment that cannot be tied to a player is shown as not linked,
// never guessed onto a venue. Joners Juniors has its own table and is not in
// the JFP income, so it sits beside a venue's total, not inside it.
//
// Stripe's fee on each payment goes on the same rows, in the same shares, as
// the payment itself. It is kept apart from the money (fee, not one of
// KINDS), so the venues still add up to income and their fees add up to the
// term's Stripe fees.

const cents = (aud) => Math.round(Number(aud || 0) * 100)
const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ')
const KINDS = ['stripe', 'bank', 'cash', 'other']
// Every address on a row (one cell can hold two, or "a@x.com <a@x.com>").
const rowEmails = (r) => (r.emails?.length ? r.emails : (String(r.email || '').toLowerCase().match(/[^\s<>,;:"'()[\]]+@[^\s<>,;:"'()[\]]+\.[a-z]{2,}/g) || []))

export const methodKind = (m) => (/cash/i.test(m || '') ? 'cash' : /bank/i.test(m || '') ? 'bank' : /stripe/i.test(m || '') ? 'stripe' : 'other')
const sourceIds = (l) => String(l['Source Record ID'] || '').split(',').map((x) => x.trim()).filter(Boolean)
export const totalOf = (m) => (m ? KINDS.reduce((t, k) => t + (m[k] || 0), 0) : 0)
// Earlier terms' ledger lines carry the Stripe fee; blank is not known.
export const LEDGER_FEE = 'Term 3 Stripe Fee AUD'
export const ledgerFeeCents = (l) => (typeof l[LEDGER_FEE] === 'number' ? cents(l[LEDGER_FEE]) : null)
// Places that should be paid for this term: session by session and rows with no fee are not.
const expects = (p) => !['session', 'unpriced'].includes(p.status)

// Split whole cents by weights. The parts always add back to the total; no
// weights (no fees set) means equal shares.
export function splitCents(total, weights) {
  const n = weights.length
  if (!n) return []
  const sign = total < 0 ? -1 : 1
  const abs = Math.abs(Math.round(total))
  const w = weights.map((x) => (Number(x) > 0 ? Number(x) : 0))
  const sum = w.reduce((t, x) => t + x, 0)
  const raw = (sum ? w : w.map(() => 1)).map((x) => (abs * x) / (sum || n))
  const parts = raw.map((x) => Math.floor(x))
  let left = abs - parts.reduce((t, x) => t + x, 0)
  const order = raw.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1])
  for (let k = 0; left > 0; k = (k + 1) % n, left--) parts[order[k][1]] += 1
  return parts.map((x) => x * sign)
}

// This term: the money behind "Income this term", put on the rows it paid
// for. rows: every Term 4 row (removed players too, their money still came
// in); stripe: live JFP payments; ledger: this term's ledger; legacy: rows
// marked paid offline before the ledger had them (counted as Other).
// entries: each dated part on its row, for income by week at a venue.
// parts: every piece of every payment, on its row or not linked (rowId ''),
// with its share of the refund and of the GST in the fee, for the download.
export function allocateTermMoney({ rows, stripe = [], ledger = [], legacy = [] }) {
  const byId = new Map(rows.map((r) => [r.id, r]))
  const byRow = new Map()
  const unlinked = { stripe: 0, bank: 0, cash: 0, other: 0, fee: 0, items: [] }
  const entries = []
  const pieces = []
  // pending: a Stripe payment whose fee is not known yet; its rows count it.
  const put = (targets, amount, kind, what, fee = 0, { refunded = 0, gst = 0, pending = false } = {}) => {
    const list = targets.filter(Boolean)
    if (!list.length) {
      unlinked[kind] += amount
      unlinked.fee += fee
      if (amount || fee) unlinked.items.push({ ...what, kind, cents: amount, ...(fee ? { feeCents: fee } : {}) })
      pieces.push({ ...what, kind, rowId: '', cents: amount, fee, refunded, gst })
      return
    }
    const weights = list.map((r) => cents(r.feeAud))
    const [parts, fees, refunds, gsts] = [amount, fee, refunded, gst].map((x) => splitCents(x, weights))
    list.forEach((r, i) => {
      const x = byRow.get(r.id) || { stripe: 0, bank: 0, cash: 0, other: 0, fee: 0, feePending: 0 }
      x[kind] += parts[i]
      x.fee += fees[i]
      if (pending) x.feePending += 1
      byRow.set(r.id, x)
      if (what.at) entries.push({ rowId: r.id, at: what.at, kind, cents: parts[i], fee: fees[i] })
      pieces.push({ ...what, kind, rowId: r.id, cents: parts[i], fee: fees[i], refunded: refunds[i], gst: gsts[i] })
    })
  }
  // A Stripe payment recorded in the portal names its rows in the ledger;
  // otherwise it belongs to the family whose email paid.
  const stripeLedger = ledger.filter((l) => methodKind(l['Payment Method']) === 'stripe')
  // A payment split per player has one ledger line each (a family invoice).
  const recordedLines = (p) => stripeLedger.filter((x) => Number(x['Amount Paid']) > 0 && [x['Payment ID'], x['Stripe Checkout Session ID'], x['Stripe Payment Intent ID']].some((v) => v && (v === p.id || (p.intentId && v === p.intentId))))
  const recordedFor = (p) => {
    const l = recordedLines(p)[0]
    return l ? sourceIds(l).map((id) => byId.get(id)).filter(Boolean) : []
  }
  for (const p of stripe) {
    const refunded = p.refundedCents || 0
    const amount = (p.amountCents || 0) - refunded
    // A refund keeps its fee, so a fully refunded payment still has a cost to place.
    const fee = p.feeKnown ? p.feeCents || 0 : 0
    const gst = p.feeKnown ? p.feeGstCents || 0 : 0
    if (!amount && !fee && !refunded) continue
    const lines = recordedLines(p)
    if (lines.length > 1) {
      // Each player's line gets its part of what Stripe actually kept, and of the fee.
      const weights = lines.map((l) => cents(l['Amount Paid']))
      const [parts, fees, refunds, gsts] = [amount, fee, refunded, gst].map((x) => splitCents(x, weights))
      lines.forEach((l, i) => put(sourceIds(l).map((id) => byId.get(id)), parts[i], 'stripe', { id: p.id, at: p.day || String(p.at || '').slice(0, 10), who: l['Player Name'] || p.name || p.email || '' }, fees[i], { refunded: refunds[i], gst: gsts[i], pending: !p.feeKnown }))
      continue
    }
    let targets = recordedFor(p)
    if (!targets.length && p.email) {
      const family = rows.filter((r) => rowEmails(r).includes(p.email))
      const holding = family.filter((r) => r.holdsPlace)
      targets = holding.length ? holding : family
    }
    put(targets, amount, 'stripe', { id: p.id, at: p.day || String(p.at || '').slice(0, 10), who: p.name || p.email || '' }, fee, { refunded, gst, pending: !p.feeKnown })
  }
  // Cash, bank transfer and other: the same ledger rows "Income this term" counts.
  for (const l of ledger) {
    if (!l['Payment Method'] || methodKind(l['Payment Method']) === 'stripe') continue
    const amount = cents(l['Amount Paid'])
    if (!amount) continue
    put(sourceIds(l).map((id) => byId.get(id)), amount, methodKind(l['Payment Method']), { id: l.id || l['Payment ID'] || '', at: String(l['Payment Date'] || '').slice(0, 10), who: l['Player Name'] || '' })
  }
  for (const r of legacy) put([r], cents(r.paidAud), 'other', { id: r.id, at: '', who: r.player })
  return { byRow, unlinked, entries, parts: pieces }
}

// Of a place's fee, how much is in. A row paid in Stripe but not recorded yet
// counts only the Stripe money that is there, not the whole fee.
export const stillOwing = (p) => (p.status === 'stripe' ? Math.max(0, (p.feeCents || 0) - (p.paidCents || 0) - (p.stripeAppliedCents || 0)) : p.owingCents || 0)
export const collectedOf = (p) => (p.status === 'stripe' ? Math.min(p.feeCents || 0, (p.paidCents || 0) + (p.stripeAppliedCents || 0)) : Math.max(0, (p.feeCents || 0) - (p.owingCents || 0)))
const blankMoney = () => ({ stripeFeeCents: 0, expectedCents: 0, collectedCents: 0, owingRowIds: [] })
const blankVenue = (loc) => ({ id: loc.id, name: loc.name, players: 0, paid: 0, owingCents: 0, receivedCents: 0, stripeCents: 0, bankCents: 0, cashCents: 0, otherCents: 0, removedCents: 0, removedFeeCents: 0, airtableOnlyCents: 0, ...blankMoney(), groups: new Map() })
const blankGroup = (g) => ({ key: g.key, label: g.label, coach: g.coach || '', players: 0, receivedCents: 0, owingCents: 0, ...blankMoney() })
// A venue with no players or money this term, beside one that has (Juniors only).
export const emptyVenue = (loc) => finish(new Map([[loc.id, blankVenue(loc)]]), { keepEmpty: true })[0]
// netCents: received less Stripe's fees. collectedPct: of what the places
// should bring in, how much is in (rounded down, so 100 means all of it).
// Fees not known (an older term from the Money Register) are null, not 0.
const settle = (x, feesKnown) => ({
  ...x,
  stripeFeeCents: feesKnown ? x.stripeFeeCents : null,
  netCents: feesKnown ? x.receivedCents - x.stripeFeeCents : null,
  collectedPct: x.expectedCents ? Math.floor((x.collectedCents * 100) / x.expectedCents) : null,
})
function finish(venues, { feesKnown = true, keepEmpty = false } = {}) {
  return [...venues.values()]
    .filter((v) => keepEmpty || v.players || v.receivedCents || v.stripeFeeCents)
    .map((v) => settle({ ...v, groups: [...v.groups.values()].sort((a, b) => b.receivedCents - a.receivedCents || a.label.localeCompare(b.label)).map((g) => settle(g, feesKnown)) }, feesKnown))
}
function venueIn(venues, loc) {
  if (!venues.has(loc.id)) venues.set(loc.id, blankVenue(loc))
  return venues.get(loc.id)
}
function groupIn(v, g) {
  if (!v.groups.has(g.key)) v.groups.set(g.key, blankGroup(g))
  const x = v.groups.get(g.key)
  // Two coaches at one time (an earlier term's rows) are both named.
  if (g.coach && !x.coach.split(', ').includes(g.coach)) x.coach = x.coach ? `${x.coach}, ${g.coach}` : g.coach
  return x
}

// Venues this term: money from allocateTermMoney; places, paid and owing from
// the players the dashboard lists. venueOf(row) -> { id, name };
// groupOf(row) -> { key, label, coach }.
export function venuesForTerm({ locations, rows, players, alloc, venueOf, groupOf }) {
  const venues = new Map(locations.map((l) => [l.id, blankVenue(l)]))
  const rowById = new Map(rows.map((r) => [r.id, r]))
  for (const [rowId, m] of alloc.byRow) {
    const r = rowById.get(rowId)
    if (!r) continue
    const v = venueIn(venues, venueOf(r))
    const total = totalOf(m), fee = m.fee || 0
    v.receivedCents += total
    v.stripeFeeCents += fee
    for (const k of KINDS) v[`${k}Cents`] += m[k]
    if (!r.holdsPlace) { v.removedCents += total; v.removedFeeCents += fee }
    const g = groupIn(v, groupOf(r))
    g.receivedCents += total
    g.stripeFeeCents += fee
  }
  for (const p of players) {
    const r = rowById.get(p.rowId)
    if (!r) continue
    const v = venueIn(venues, venueOf(r))
    v.players += 1
    if (p.status === 'paid' || p.status === 'stripe') v.paid += 1
    v.owingCents += p.owingCents || 0
    const g = groupIn(v, groupOf(r))
    g.players += 1
    g.owingCents += p.owingCents || 0
    for (const x of [v, g]) {
      if (expects(p)) { x.expectedCents += p.feeCents || 0; x.collectedCents += collectedOf(p) }
      if (stillOwing(p) > 0) x.owingRowIds.push(p.rowId)
    }
    // Marked paid in Airtable, but no payment this term that we can see.
    const got = totalOf(alloc.byRow.get(p.rowId))
    if ((p.paidCents || 0) > got) v.airtableOnlyCents += p.paidCents - got
  }
  return finish(venues)
}

// An earlier term from the payment ledger alone (Term 3 was reconciled to
// Stripe): each payment on the rows it names, each row at its session's venue.
export function venuesFromLedger({ locations, ledger, rows, venueOf, groupOf }) {
  const venues = new Map(locations.map((l) => [l.id, blankVenue(l)]))
  const byId = new Map(rows.map((r) => [r.id, r]))
  const unlinked = { cents: 0, count: 0 }
  let unlinkedFeeCents = 0, stripeFeesCents = 0, feesPendingCount = 0
  const paying = new Map() // rowId -> cents
  const feeOn = new Map() // rowId -> fee cents
  for (const l of ledger) {
    const amount = cents(l['Amount Paid'])
    if (!amount) continue
    const kind = methodKind(l['Payment Method'])
    const fee = ledgerFeeCents(l)
    if (kind === 'stripe' && fee == null) feesPendingCount += 1
    stripeFeesCents += fee || 0
    const targets = sourceIds(l).map((id) => byId.get(id)).filter(Boolean)
    if (!targets.length) { unlinked.cents += amount; unlinked.count += 1; unlinkedFeeCents += fee || 0; continue }
    const parts = splitCents(amount, targets.map(() => 1)), fees = splitCents(fee || 0, targets.map(() => 1))
    targets.forEach((r, i) => {
      const v = venueIn(venues, venueOf(r))
      v.receivedCents += parts[i]
      v.stripeFeeCents += fees[i]
      v[`${kind}Cents`] += parts[i]
      const g = groupIn(v, groupOf(r))
      g.receivedCents += parts[i]
      g.stripeFeeCents += fees[i]
      paying.set(r.id, (paying.get(r.id) || 0) + parts[i])
      feeOn.set(r.id, (feeOn.get(r.id) || 0) + fees[i])
    })
  }
  const players = []
  for (const [rowId, got] of paying) {
    const r = byId.get(rowId)
    const v = venueIn(venues, venueOf(r))
    const g = groupOf(r)
    v.players += 1
    v.paid += got > 0 ? 1 : 0
    groupIn(v, g).players += 1
    const fee = feeOn.get(rowId) || 0
    players.push({ rowId, player: r.player, group: g.label, coach: g.coach || '', locationId: v.id, receivedCents: got, stripeFeeCents: fee, netReceivedCents: got - fee })
  }
  return { venues: finish(venues), unlinked, unlinkedFeeCents, stripeFeesCents, feesPendingCount, players: players.sort((a, b) => a.player.localeCompare(b.player)) }
}

// Joners Juniors for a term, by venue: paid registrations only. A place paid
// with last term's credit is not new money, so it is shown apart.
export function juniorsByVenue(rows, term, venueOf) {
  const out = new Map()
  for (const r of rows) {
    if (norm(r.term) !== norm(term)) continue
    const loc = venueOf(r)
    const x = out.get(loc.id) || { id: loc.id, name: loc.name, players: 0, paid: 0, paidCents: 0, creditCents: 0, sessions: new Set() }
    x.players += 1
    if (r.day || r.time) x.sessions.add([r.day, r.time].filter(Boolean).join(' '))
    if (/^paid$/i.test(r.status || '')) {
      if (/credit/i.test(r.paidVia || '')) x.creditCents += cents(r.fee)
      else { x.paid += 1; x.paidCents += cents(r.fee) }
    }
    out.set(loc.id, x)
  }
  return [...out.values()].map((x) => ({ ...x, sessions: [...x.sessions] }))
}

// Older terms from the Money Register copy (JFP Venue History): the payments
// listed under each session, by venue. Lee's own typed totals come back too,
// so the window can say where the two differ.
export function venuesFromHistory({ locations, rows, term, venueOf }) {
  const venues = new Map(locations.map((l) => [l.id, blankVenue(l)]))
  const register = {}
  let importedAt = ''
  let incomeCents = 0
  for (const r of rows) {
    if (norm(r.term) !== norm(term)) continue
    importedAt = importedAt || r.importedAt || ''
    if (r.kind === 'register total') { register[norm(r.venue)] = cents(r.revenue); continue }
    const v = venueIn(venues, venueOf(r))
    const c = cents(r.revenue)
    incomeCents += c
    v.receivedCents += c
    v.stripeCents += cents(r.stripe); v.bankCents += cents(r.bank); v.cashCents += cents(r.cash); v.otherCents += cents(r.other)
    v.players += r.payments || 0
    const g = groupIn(v, { key: r.session, label: r.session, coach: '' })
    g.receivedCents += c
    g.players += r.payments || 0
  }
  // The register has no Stripe fees: not known, not nothing.
  return { venues: finish(venues, { feesKnown: false }), register, importedAt, incomeCents, unlinked: { cents: 0, count: 0 }, unlinkedFeeCents: null, stripeFeesCents: null, feesPendingCount: 0, players: [] }
}

const termOrder = (t) => { const m = /term\s*(\d)\s+(\d{4})/i.exec(t || ''); return m ? Number(m[2]) * 10 + Number(m[1]) : 0 }
// Every term the venue window can show, newest first.
export function venueTerms({ current, previous, history }) {
  const list = [...new Set([current, previous, ...history.map((r) => r.term)].filter(Boolean))]
  return list.sort((a, b) => termOrder(b) - termOrder(a))
}

// "Term 4 2026" -> "Term 3 2026"; "Term 1 2027" -> "Term 4 2026".
export function previousTerm(term) {
  const m = /term\s*(\d)\s+(\d{4})/i.exec(term || '')
  if (!m) return ''
  const t = Number(m[1]), y = Number(m[2])
  return t > 1 ? `Term ${t - 1} ${y}` : `Term 4 ${y - 1}`
}

// Venue costs (Lee, 12 Oct 2026): rent, cleaning, field hire and the like,
// typed in per venue per term and kept in config.venueCosts, so a venue can
// show what is left after its costs. Coach wages only count if added as a line.
export const COST_LIMITS = { lines: 20, label: 40, cents: 50000000 }
const COST_TERM = /^term\s*[1-4]\s+\d{4}$/i
export const costTermOk = (t) => COST_TERM.test(String(t || '').trim())

// Strict, for a save: an error to show, or the lines as they will be kept.
export function checkCostLines(lines) {
  if (!Array.isArray(lines)) return { error: 'Send the cost lines as a list.' }
  if (lines.length > COST_LIMITS.lines) return { error: `Up to ${COST_LIMITS.lines} cost lines per venue.` }
  const out = []
  for (const [i, x] of lines.entries()) {
    const label = String(x?.label ?? '').trim().replace(/\s+/g, ' ')
    if (!label) return { error: `Line ${i + 1} needs a name, like "Field hire".` }
    if (label.length > COST_LIMITS.label) return { error: `Keep "${label.slice(0, 20)}…" to ${COST_LIMITS.label} letters or fewer.` }
    const c = x?.cents
    if (typeof c !== 'number' || !Number.isInteger(c) || c < 0 || c > COST_LIMITS.cents) return { error: `Check the amount for "${label}".` }
    out.push({ label, cents: c })
  }
  return { lines: out }
}

// Lenient, for config read back from KV: bad lines and terms are dropped.
export function cleanVenueCosts(input) {
  const out = {}
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out
  for (const [term, byVenue] of Object.entries(input).slice(0, 40)) {
    if (!costTermOk(term) || !byVenue || typeof byVenue !== 'object') continue
    const venues = {}
    for (const [id, lines] of Object.entries(byVenue).slice(0, 30)) {
      const vid = String(id).trim().toLowerCase().slice(0, 30)
      if (!vid || !Array.isArray(lines)) continue
      const kept = lines.slice(0, COST_LIMITS.lines).map((x) => checkCostLines([x]).lines?.[0]).filter(Boolean)
      if (kept.length) venues[vid] = kept
    }
    if (Object.keys(venues).length) out[term.trim()] = venues
  }
  return out
}

const termKey = (costs, term) => Object.keys(costs || {}).find((k) => norm(k) === norm(term))
export const costsOfTerm = (costs, term) => (costs || {})[termKey(costs, term)] || {}
const sumLines = (lines) => (lines || []).reduce((t, x) => t + (x.cents || 0), 0)

// Each venue gets its cost lines, what they come to, and profit: kept after
// Stripe fees less costs. When fees are not known (the Money Register) it is
// taken less costs, flagged profitBeforeFees.
export function withCosts(venue, lines = []) {
  const costsCents = sumLines(lines)
  const before = venue.netCents == null
  return { ...venue, costLines: lines, costsCents, profitCents: (before ? venue.receivedCents || 0 : venue.netCents) - costsCents, profitBeforeFees: before }
}
// The term as a whole: every venue's costs, and profit from all its money
// (money not linked to a player counts too).
export function costTotals(venues, keptCents) {
  const venueCostsCents = venues.reduce((t, v) => t + (v.costsCents || 0), 0)
  return { venueCostsCents, profitCents: keptCents - venueCostsCents, venuesWithCosts: venues.filter((v) => v.costLines?.length).length }
}
