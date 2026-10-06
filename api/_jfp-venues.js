// Revenue by venue (Lee, 6 Oct 2026: "click the venue and see my revenue").
//
// Money first. Every Stripe payment and every cash or bank transfer in the
// payment ledger goes onto the player rows it was for, and each row belongs
// to a venue, so this term's venues add up to "Income this term" to the
// cent. A payment that cannot be tied to a player is shown as not linked,
// never guessed onto a venue. Joners Juniors has its own table and is not in
// the JFP income, so it sits beside a venue's total, not inside it.

const cents = (aud) => Math.round(Number(aud || 0) * 100)
const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ')
const KINDS = ['stripe', 'bank', 'cash', 'other']

export const methodKind = (m) => (/cash/i.test(m || '') ? 'cash' : /bank/i.test(m || '') ? 'bank' : /stripe/i.test(m || '') ? 'stripe' : 'other')
const sourceIds = (l) => String(l['Source Record ID'] || '').split(',').map((x) => x.trim()).filter(Boolean)
export const totalOf = (m) => (m ? KINDS.reduce((t, k) => t + (m[k] || 0), 0) : 0)

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
export function allocateTermMoney({ rows, stripe = [], ledger = [], legacy = [] }) {
  const byId = new Map(rows.map((r) => [r.id, r]))
  const byRow = new Map()
  const unlinked = { stripe: 0, bank: 0, cash: 0, other: 0, items: [] }
  const put = (targets, amount, kind, what) => {
    const list = targets.filter(Boolean)
    if (!list.length) { unlinked[kind] += amount; unlinked.items.push({ ...what, kind, cents: amount }); return }
    const parts = splitCents(amount, list.map((r) => cents(r.feeAud)))
    list.forEach((r, i) => {
      const x = byRow.get(r.id) || { stripe: 0, bank: 0, cash: 0, other: 0 }
      x[kind] += parts[i]
      byRow.set(r.id, x)
    })
  }
  // A Stripe payment recorded in the portal names its rows in the ledger;
  // otherwise it belongs to the family whose email paid.
  const stripeLedger = ledger.filter((l) => methodKind(l['Payment Method']) === 'stripe')
  const recordedFor = (p) => {
    const l = stripeLedger.find((x) => [x['Payment ID'], x['Stripe Checkout Session ID'], x['Stripe Payment Intent ID']].some((v) => v && (v === p.id || (p.intentId && v === p.intentId))))
    return l ? sourceIds(l).map((id) => byId.get(id)).filter(Boolean) : []
  }
  for (const p of stripe) {
    const amount = (p.amountCents || 0) - (p.refundedCents || 0)
    if (!amount) continue
    let targets = recordedFor(p)
    if (!targets.length && p.email) {
      const family = rows.filter((r) => r.email && r.email === p.email)
      const holding = family.filter((r) => r.holdsPlace)
      targets = holding.length ? holding : family
    }
    put(targets, amount, 'stripe', { id: p.id, at: String(p.at || '').slice(0, 10), who: p.name || p.email || '' })
  }
  // Cash, bank transfer and other: the same ledger rows "Income this term" counts.
  for (const l of ledger) {
    if (!l['Payment Method'] || methodKind(l['Payment Method']) === 'stripe') continue
    const amount = cents(l['Amount Paid'])
    if (!amount) continue
    put(sourceIds(l).map((id) => byId.get(id)), amount, methodKind(l['Payment Method']), { id: l.id || l['Payment ID'] || '', at: String(l['Payment Date'] || '').slice(0, 10), who: l['Player Name'] || '' })
  }
  for (const r of legacy) put([r], cents(r.paidAud), 'other', { id: r.id, at: '', who: r.player })
  return { byRow, unlinked }
}

const blankVenue = (loc) => ({ id: loc.id, name: loc.name, players: 0, paid: 0, owingCents: 0, receivedCents: 0, stripeCents: 0, bankCents: 0, cashCents: 0, otherCents: 0, removedCents: 0, airtableOnlyCents: 0, groups: new Map() })
const blankGroup = (g) => ({ key: g.key, label: g.label, coach: g.coach || '', players: 0, receivedCents: 0, owingCents: 0 })
function finish(venues) {
  return [...venues.values()]
    .filter((v) => v.players || v.receivedCents)
    .map((v) => ({ ...v, groups: [...v.groups.values()].sort((a, b) => b.receivedCents - a.receivedCents || a.label.localeCompare(b.label)) }))
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
    const total = totalOf(m)
    v.receivedCents += total
    for (const k of KINDS) v[`${k}Cents`] += m[k]
    if (!r.holdsPlace) v.removedCents += total
    groupIn(v, groupOf(r)).receivedCents += total
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
  const paying = new Map() // rowId -> cents
  for (const l of ledger) {
    const amount = cents(l['Amount Paid'])
    if (!amount) continue
    const kind = methodKind(l['Payment Method'])
    const targets = sourceIds(l).map((id) => byId.get(id)).filter(Boolean)
    if (!targets.length) { unlinked.cents += amount; unlinked.count += 1; continue }
    const parts = splitCents(amount, targets.map(() => 1))
    targets.forEach((r, i) => {
      const v = venueIn(venues, venueOf(r))
      v.receivedCents += parts[i]
      v[`${kind}Cents`] += parts[i]
      groupIn(v, groupOf(r)).receivedCents += parts[i]
      paying.set(r.id, (paying.get(r.id) || 0) + parts[i])
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
    players.push({ rowId, player: r.player, group: g.label, coach: g.coach || '', locationId: v.id, receivedCents: got })
  }
  return { venues: finish(venues), unlinked, players: players.sort((a, b) => a.player.localeCompare(b.player)) }
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
  return { venues: finish(venues), register, importedAt, incomeCents, unlinked: { cents: 0, count: 0 }, players: [] }
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
