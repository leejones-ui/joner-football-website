// Money by year (Lee, 12 Oct 2026: "a drop down tab on Money so I can look
// at previous years, using the Money Register spreadsheet as a guide").
//
// Every term in one shape, whatever it came from: the term running now (the
// Money tab's own figures, live), the term before (its payment ledger, which
// has Stripe's fee on each payment) and older terms (the copy of Lee's Money
// Register, which has the totals he typed but no fees). A year is its terms
// added up.
//
// Where Lee typed a total in the register, that total is the term's figure
// (HQ takes the one he typed for HQ) and the payments listed under it are
// kept beside it, so a difference is always shown, never hidden. Each term's
// venues, plus money not on a venue (not linked to a player, or the part of a
// typed total the listed payments don't reach), add up to the term exactly.
// Pure functions: no network, no KV.

export const KINDS = ['stripe', 'bank', 'cash', 'other']
const TERM = /^\s*term\s*([1-4])\s+(\d{4})\s*$/i
// "Term 3 2026" -> { n: 3, year: 2026 }
export function termParts(t) {
  const m = TERM.exec(String(t || ''))
  return m ? { n: Number(m[1]), year: Number(m[2]) } : null
}
export const termName = (n, year) => `Term ${n} ${year}`
// Years with figures, newest first.
export const yearsOf = (terms) => [...new Set(terms.map(termParts).filter(Boolean).map((p) => p.year))].sort((a, b) => b - a)
// A year's terms, Term 1 first.
export const termsOfYear = (terms, year) => terms.filter((t) => termParts(t)?.year === year).sort((a, b) => termParts(a).n - termParts(b).n)

const sum = (list, f) => list.reduce((t, x) => t + (f(x) || 0), 0)
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null)
const methodsOf = (x) => ({ stripe: x.stripeCents || 0, bank: x.bankCents || 0, cash: x.cashCents || 0, other: x.otherCents || 0 })
const sumMethods = (list) => Object.fromEntries(KINDS.map((k) => [k, sum(list, (x) => x.methods?.[k])]))
// The register's Joners Juniors section sits under HQ. The portal keeps
// Joners Juniors apart from the JFP figures, so a year can say how much of
// a register term it is.
const JUNIORS = /joners juniors/i
const juniorsIn = (venue) => sum(venue.groups || [], (g) => (JUNIORS.test(g.label || '') ? g.receivedCents : 0))

// Lee's typed totals beside the payments listed under them. The register adds
// HQ up on its own and the fields (every other venue: North Turramurra and
// Rydalmere Park) together, then the term. diffCents is typed less listed.
export function registerChecks({ register = {}, venues = [], listedCents = 0, hqId = 'belrose' }) {
  const hq = venues.filter((v) => v.id === hqId), fields = venues.filter((v) => v.id !== hqId)
  const out = []
  const add = (scope, ids, typed, listed) => out.push({ scope, venueIds: ids, registerCents: typed, listedCents: listed, diffCents: typed - listed })
  if (num(register['belrose hq']) != null) add(hqId, [hqId], register['belrose hq'], sum(hq, (v) => v.receivedCents))
  if (num(register.fields) != null) add('fields', fields.map((v) => v.id), register.fields, sum(fields, (v) => v.receivedCents))
  if (num(register.all) != null) add('all', venues.map((v) => v.id), register.all, listedCents)
  return out
}

// ---------- one term, three sources ----------

// An older term from the Money Register copy (pastVenues, source 'register').
export function termFromRegister(v) {
  const p = termParts(v.term) || { n: 0, year: 0 }
  const hqId = v.hqId || 'belrose'
  const reg = v.register || {}
  const typedHq = num(reg['belrose hq']), typedFields = num(reg.fields)
  // The term's total as Lee typed it: "Grand total", else HQ and the fields.
  const registerCents = num(reg.all) ?? (typedHq != null && typedFields != null ? typedHq + typedFields : null)
  const listed = (v.venues || []).filter((x) => x.receivedCents || x.payments || x.players)
  const listedCents = sum(listed, (x) => x.receivedCents)
  const venues = listed.map((x) => {
    const typed = registerCents != null && x.id === hqId ? typedHq : null
    return { id: x.id, name: x.name, takenCents: typed ?? x.receivedCents, listedCents: x.receivedCents, registerCents: typed, stripeFeeCents: null, keptCents: null, methods: methodsOf(x), payments: x.payments ?? x.players ?? 0, juniorsCents: juniorsIn(x) }
  })
  const takenCents = registerCents ?? listedCents
  return {
    term: v.term, n: p.n, year: p.year, source: 'register', current: false, importedAt: v.importedAt || '', error: '',
    takenCents, listedCents, registerCents, feesKnown: false, stripeFeeCents: null, keptCents: null, feesPending: 0, refundedCents: 0,
    methods: sumMethods(venues), payments: sum(venues, (x) => x.payments), juniorsCents: sum(venues, (x) => x.juniorsCents),
    venues, unlinkedCents: 0, unlinkedFeeCents: null,
    // The part of Lee's total the listed payments don't reach (or go past).
    registerGapCents: takenCents - sum(venues, (x) => x.takenCents),
    checks: v.registerChecks || registerChecks({ register: reg, venues: listed, listedCents, hqId }),
  }
}

// The term before, from its payment ledger (pastVenues, source 'ledger').
export function termFromLedger(v) {
  const p = termParts(v.term) || { n: 0, year: 0 }
  const listed = (v.venues || []).filter((x) => x.receivedCents || x.stripeFeeCents)
  const venues = listed.map((x) => ({ id: x.id, name: x.name, takenCents: x.receivedCents, listedCents: x.receivedCents, registerCents: null, stripeFeeCents: x.stripeFeeCents || 0, keptCents: x.receivedCents - (x.stripeFeeCents || 0), methods: methodsOf(x), payments: x.payments || 0, players: x.players || 0, juniorsCents: 0 }))
  const unlinkedCents = v.unlinked?.cents || 0
  const loose = v.unlinkedByKind || { other: unlinkedCents }
  const takenCents = num(v.incomeCents) ?? sum(venues, (x) => x.takenCents) + unlinkedCents
  const fees = v.stripeFeesCents || 0
  return {
    term: v.term, n: p.n, year: p.year, source: 'ledger', current: false, importedAt: '', error: '',
    takenCents, listedCents: takenCents, registerCents: null, feesKnown: true, stripeFeeCents: fees, keptCents: takenCents - fees, feesPending: v.feesPendingCount || 0, refundedCents: 0,
    methods: Object.fromEntries(KINDS.map((k) => [k, sum(venues, (x) => x.methods[k]) + (loose[k] || 0)])),
    payments: v.paymentsCount ?? sum(venues, (x) => x.payments), players: sum(venues, (x) => x.players), juniorsCents: 0,
    venues, unlinkedCents, unlinkedFeeCents: v.unlinkedFeeCents || 0, registerGapCents: 0, checks: [],
  }
}

// The term running now, from the Money tab's own figures (moneyData).
export function termFromLive(m) {
  const k = m.kpis || {}
  const p = termParts(m.term) || { n: 0, year: 0 }
  const lines = m.payments || []
  const count = (list) => new Set(list.map((x) => `${x.method}|${x.id}`)).size
  const venues = (m.locations || []).filter((x) => x.receivedCents || x.stripeFeeCents).map((x) => ({ id: x.id, name: x.name, takenCents: x.receivedCents, listedCents: x.receivedCents, registerCents: null, stripeFeeCents: x.stripeFeeCents || 0, keptCents: x.receivedCents - (x.stripeFeeCents || 0), methods: methodsOf(x), payments: count(lines.filter((l) => l.venueId === x.id)), players: x.players || 0, paid: x.paid || 0, juniorsCents: 0 }))
  const takenCents = k.incomeCents || 0, fees = k.stripeFeesCents || 0
  return {
    term: m.term, n: p.n, year: p.year, source: 'live', current: true, importedAt: '', error: m.stripeError || '',
    takenCents, listedCents: takenCents, registerCents: null, feesKnown: true, stripeFeeCents: fees, keptCents: takenCents - fees, feesPending: k.feesPendingCount || 0, refundedCents: k.refundsCents || 0,
    methods: { stripe: k.stripeCents || 0, bank: k.bankCents || 0, cash: k.cashCents || 0, other: k.otherCents || 0 },
    payments: count(lines), players: (m.status?.paid || 0) + (m.status?.stripe || 0), playersAll: k.players || 0, juniorsCents: 0,
    venues, unlinkedCents: k.unlinkedCents || 0, unlinkedFeeCents: k.unlinkedFeeCents || 0, registerGapCents: 0, checks: [],
  }
}

// ---------- a year ----------

// One term seen from one scope: every venue ('') or one venue's id. A venue
// with nothing in a term that has figures took A$0 there.
function scopeTerm(t, id) {
  const base = { term: t.term, n: t.n, current: t.current, source: t.source, feesKnown: t.feesKnown, importedAt: t.importedAt || '', error: t.error || '' }
  if (!id) {
    return { ...base, takenCents: t.takenCents, listedCents: t.listedCents, registerCents: t.registerCents, stripeFeeCents: t.stripeFeeCents, keptCents: t.keptCents, feesPending: t.feesPending, refundedCents: t.refundedCents, methods: t.methods, payments: t.payments, juniorsCents: t.juniorsCents, unlinkedCents: t.unlinkedCents, unlinkedFeeCents: t.unlinkedFeeCents, registerGapCents: t.registerGapCents, checks: t.checks.filter((c) => c.diffCents) }
  }
  const v = t.venues.find((x) => x.id === id)
  const zero = t.feesKnown ? 0 : null
  return {
    ...base, takenCents: v?.takenCents || 0, listedCents: v?.listedCents || 0, registerCents: v?.registerCents ?? null,
    stripeFeeCents: v ? v.stripeFeeCents : zero, keptCents: v ? v.keptCents : zero, feesPending: 0, refundedCents: 0,
    methods: v?.methods || { stripe: 0, bank: 0, cash: 0, other: 0 }, payments: v?.payments || 0, juniorsCents: v?.juniorsCents || 0,
    // HQ's own typed total, or the fields' when this is one of them; the term's is not a venue's.
    unlinkedCents: 0, unlinkedFeeCents: zero, registerGapCents: 0, checks: t.checks.filter((c) => c.diffCents && c.scope !== 'all' && c.venueIds.includes(id)),
  }
}

// A year (or one venue's year): its terms added up. Kept after Stripe fees
// only counts the terms whose fees are known, and says which those are.
export function scopeOfYear(terms, id = '') {
  const perTerm = terms.map((t) => scopeTerm(t, id))
  const fees = perTerm.filter((x) => x.feesKnown)
  return {
    takenCents: sum(perTerm, (x) => x.takenCents),
    listedCents: sum(perTerm, (x) => x.listedCents),
    feeTerms: fees.map((x) => x.term),
    noFeeTerms: perTerm.filter((x) => !x.feesKnown).map((x) => x.term),
    takenWithFeesCents: sum(fees, (x) => x.takenCents),
    stripeFeeCents: fees.length ? sum(fees, (x) => x.stripeFeeCents) : null,
    keptCents: fees.length ? sum(fees, (x) => x.keptCents) : null,
    feesPending: sum(perTerm, (x) => x.feesPending),
    methods: sumMethods(perTerm),
    payments: sum(perTerm, (x) => x.payments),
    juniorsCents: sum(perTerm, (x) => x.juniorsCents),
    unlinkedCents: sum(perTerm, (x) => x.unlinkedCents),
    registerGapCents: sum(perTerm, (x) => x.registerGapCents),
    registerTerms: perTerm.filter((x) => x.registerCents != null).map((x) => x.term),
    differences: perTerm.flatMap((x) => x.checks.map((c) => ({ term: x.term, ...c }))),
    perTerm,
  }
}

const change = (now, before) => ({ diffCents: now - before, pct: before > 0 ? Math.round(((now - before) * 1000) / before) / 10 : null })

// This year against the year before, term for term: only the terms both years
// have figures for, and never a term that is still running (its money is not
// all in yet). Joners Juniors: the register counted it under HQ and the portal
// keeps it apart, so when the two are compared it is also given without it.
export function compareYears(a, b, previousYear) {
  if (!b?.perTerm?.length) return { previousYear, none: 'nodata' }
  const theirs = new Map(b.perTerm.map((x) => [x.n, x]))
  const both = a.perTerm.filter((x) => !x.current && theirs.has(x.n))
  const running = a.perTerm.filter((x) => x.current).map((x) => x.term)
  if (!both.length) return { previousYear, none: running.length && a.perTerm.length === running.length ? 'running' : 'noterms', running }
  const ns = both.map((x) => x.n)
  const before = ns.map((n) => theirs.get(n))
  const thisCents = sum(both, (x) => x.takenCents), lastCents = sum(before, (x) => x.takenCents)
  const out = {
    previousYear, terms: ns, allTerms: ns.length === a.perTerm.length && ns.length === b.perTerm.length,
    thisCents, lastCents, ...change(thisCents, lastCents), nothingBefore: lastCents === 0,
    leftOut: a.perTerm.filter((x) => !ns.includes(x.n)).map((x) => x.term), running,
    // Terms the year before has and this year has no figures for at all.
    beforeOnly: b.perTerm.filter((x) => !a.perTerm.some((t) => t.n === x.n)).map((x) => x.term),
  }
  const mixed = both.some((x, i) => (x.source === 'register') !== (before[i].source === 'register'))
  const jjThis = sum(both, (x) => x.juniorsCents), jjLast = sum(before, (x) => x.juniorsCents)
  if (mixed && (jjThis || jjLast)) out.withoutJuniors = { thisCents: thisCents - jjThis, lastCents: lastCents - jjLast, ...change(thisCents - jjThis, lastCents - jjLast), juniorsThisCents: jjThis, juniorsLastCents: jjLast }
  return out
}

// Venues with money in any term of the year, in the order the terms list them.
function venueList(terms) {
  const out = new Map()
  for (const t of terms) for (const v of t.venues) if (v.takenCents || v.listedCents) out.set(v.id, { id: v.id, name: v.name })
  return [...out.values()]
}

// The whole year: every scope (all venues, then each venue) with its terms,
// totals and the comparison with the year before. before: that year's terms.
export function yearSummary({ year, terms = [], before = [] }) {
  const mine = [...terms].sort((a, b) => a.n - b.n)
  const prior = [...before].sort((a, b) => a.n - b.n)
  const venues = venueList(mine)
  const scopes = { '': scopeOfYear(mine, '') }
  for (const v of venues) scopes[v.id] = scopeOfYear(mine, v.id)
  for (const [id, s] of Object.entries(scopes)) s.compare = compareYears(s, prior.length ? scopeOfYear(prior, id) : null, year - 1)
  const cur = mine.find((t) => t.current)
  const have = new Set(mine.map((t) => t.n))
  const notYet = cur ? [1, 2, 3, 4].filter((n) => n > cur.n) : []
  const missing = [1, 2, 3, 4].filter((n) => !have.has(n) && !notYet.includes(n))
  return {
    year, previousYear: prior.length ? year - 1 : null,
    soFar: Boolean(cur), current: cur?.term || '', partial: Boolean(cur) || missing.length > 0,
    missing: missing.map((n) => termName(n, year)), notYet: notYet.map((n) => termName(n, year)),
    sources: mine.map((t) => ({ term: t.term, n: t.n, source: t.source, current: t.current, importedAt: t.importedAt || '', error: t.error || '' })),
    venues, scopes,
  }
}
