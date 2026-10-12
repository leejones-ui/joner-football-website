// Money by year and earlier terms (Lee, 12 Oct 2026): the year adds up from
// its terms, each term from its venues, Lee's typed register totals are used
// and every difference from the payments listed is flagged, terms with no
// Stripe fees are named. Then the page in jsdom: the Showing picker, an
// earlier term (read only), a whole year, links and downloads.
// Every name and amount here is invented.
import assert from 'node:assert/strict'
import { venuesFromHistory, venuesFromLedger } from '../api/_jfp-venues.js'
import { termParts, yearsOf, termsOfYear, registerChecks, termFromRegister, termFromLedger, termFromLive, scopeOfYear, compareYears, yearSummary, KINDS } from '../api/_jfp-years.js'
import { openPortal, csvRows } from './jfp-portal-dom.mjs'
import { money } from '../src/scripts/jfp-common.js'

let passed = 0
async function test(name, fn) { await fn(); passed += 1; console.log(`ok - ${name}`) }
const sum = (list, f) => list.reduce((t, x) => t + (f(x) || 0), 0)

// ---------- invented terms: two years of the register, a ledger term, a live term ----------
const LOCS = [{ id: 'belrose', name: 'Belrose HQ' }, { id: 'ntra', name: 'North Turramurra' }, { id: 'rydalmere', name: 'Rydalmere Park' }]
const NAMES = Object.fromEntries(LOCS.map((l) => [l.id, l.name]))
const byVenue = (name) => LOCS.find((l) => String(name || '').toLowerCase().includes(l.id.slice(0, 4))) || { id: 'other', name: 'No venue set' }
const pay = (term, venue, session, revenue, x = {}) => ({ term, kind: 'payments', venue, session, revenue, stripe: 0, bank: 0, cash: 0, other: 0, payments: 1, importedAt: '2026-10-12', ...x })
const typed = (term, venue, revenue) => ({ term, kind: 'register total', venue, session: 'Total typed in the register', revenue })
const HISTORY = [
  // Term 1 2025: everything typed, and it matches.
  pay('Term 1 2025', 'Belrose HQ', 'Monday Afternoon (HQ)', 4000, { bank: 3000, cash: 1000, payments: 5 }),
  pay('Term 1 2025', 'Belrose HQ', 'JONERS JUNIORS', 500, { other: 500 }),
  pay('Term 1 2025', 'NTRA', 'Wednesday Morning NTRA', 2000, { bank: 2000, payments: 3 }),
  pay('Term 1 2025', 'Rydalmere', 'Friday Morning (Ryd)', 1500, { cash: 1500, payments: 2 }),
  typed('Term 1 2025', 'Belrose HQ', 4500), typed('Term 1 2025', 'Fields', 3500), typed('Term 1 2025', 'All', 8000),
  // Term 2 2025: only the grand total typed, A$200 more than listed.
  pay('Term 2 2025', 'Belrose HQ', 'Monday Afternoon (HQ)', 5000, { bank: 5000, payments: 6 }),
  pay('Term 2 2025', 'NTRA', 'Wednesday Morning NTRA', 2500, { bank: 2500, payments: 3 }),
  typed('Term 2 2025', 'All', 7700),
  // Term 3 2025: the fields typed A$600 more than listed.
  pay('Term 3 2025', 'Belrose HQ', 'Tuesday Afternoon (HQ)', 5800, { bank: 3800, cash: 1000, stripe: 1000, payments: 7 }),
  pay('Term 3 2025', 'Belrose HQ', 'JONERS JUNIORS', 600, { other: 600 }),
  pay('Term 3 2025', 'Rydalmere', 'Friday Morning (Ryd)', 2400, { bank: 2400, payments: 3 }),
  typed('Term 3 2025', 'Belrose HQ', 6400), typed('Term 3 2025', 'Fields', 3000), typed('Term 3 2025', 'All', 9400),
  // Term 4 2025: nothing typed.
  pay('Term 4 2025', 'Belrose HQ', 'Monday Afternoon (HQ)', 7000, { bank: 7000, payments: 8 }),
  pay('Term 4 2025', 'NTRA', 'Thursday Morning (NTRA)', 3000, { cash: 3000, payments: 4 }),
  // Term 1 2026: the grand total typed, matching.
  pay('Term 1 2026', 'Belrose HQ', 'Monday Afternoon (HQ)', 4400, { bank: 4400, payments: 5 }),
  pay('Term 1 2026', 'Belrose HQ', 'JONERS JUNIORS', 400, { other: 400 }),
  pay('Term 1 2026', 'NTRA', 'Wednesday Morning NTRA', 2200, { bank: 2200, payments: 3 }),
  typed('Term 1 2026', 'All', 7000),
  // Term 2 2026: HQ typed A$100 under what is listed.
  pay('Term 2 2026', 'Belrose HQ', 'Monday Afternoon (HQ)', 5500, { bank: 5000, other: 500, payments: 6 }),
  pay('Term 2 2026', 'Rydalmere', 'Friday Morning (Ryd)', 2000, { bank: 2000, payments: 2 }),
  typed('Term 2 2026', 'Belrose HQ', 5400), typed('Term 2 2026', 'All', 7400),
]
// The same shape the venue window and the server get from pastVenues.
function register(term) {
  const out = venuesFromHistory({ locations: LOCS, rows: HISTORY, term, venueOf: (r) => byVenue(r.venue) })
  return { term, source: 'register', netIncomeCents: null, ...out, hqId: 'belrose', registerChecks: registerChecks({ register: out.register, venues: out.venues, listedCents: out.incomeCents, hqId: 'belrose' }), venueCostsCents: 0, profitCents: out.incomeCents, venuesWithCosts: 0, profitBeforeFees: true }
}
const T3ROWS = [
  { id: 'r1', player: 'Ari Alpha', location: 'Belrose HQ', day: 'Monday', time: '4:20pm', coach: 'Coach Dee' },
  { id: 'r2', player: 'Bo Beta', location: 'North Turramurra (NTRA)', day: 'Wednesday', time: '6:30am', coach: 'Coach Eli' },
]
const LEDGER = [
  { 'Payment ID': 'cs_t3_1', 'Payment Method': 'Stripe', 'Amount Paid': 850, 'Source Record ID': 'r1', 'Term 3 Stripe Fee AUD': 17.2 },
  { 'Payment ID': 'BANK-T3-1', 'Payment Method': 'Bank Transfer', 'Amount Paid': 765, 'Source Record ID': 'r2' },
  { 'Payment ID': 'CASH-T3-1', 'Payment Method': 'Cash', 'Amount Paid': 300, 'Source Record ID': 'recGONE' },
]
function ledgerTerm() {
  const out = venuesFromLedger({ locations: LOCS, ledger: LEDGER, rows: T3ROWS, venueOf: (r) => byVenue(r.location), groupOf: (r) => ({ key: `${r.day}|${r.time}`, label: `${r.day} ${r.time}`, coach: r.coach }) })
  const incomeCents = sum(LEDGER, (l) => Math.round(l['Amount Paid'] * 100))
  return { term: 'Term 3 2026', source: 'ledger', incomeCents, netIncomeCents: incomeCents - out.stripeFeesCents, ...out, venueCostsCents: 0, profitCents: incomeCents - out.stripeFeesCents, venuesWithCosts: 0, profitBeforeFees: false }
}
// This term, as the Money tab has it (moneyData): venues and not linked add up to income.
const VENUE = { belrose: 'Belrose HQ', ntra: 'North Turramurra', rydalmere: 'Rydalmere Park', other: 'No venue set' }
const player = (rowId, name, loc, x) => ({ rowId, player: name, parent: `${name.split(' ')[0]} Parent`, email: `${rowId}@example.com`, familyKey: `${rowId}@example.com`, phone: '', openLink: null, product: 'group', group: `Monday 4:20pm, ${VENUE[loc]}`, groupId: `g-${loc}`, locationId: loc, locationName: VENUE[loc], coach: 'Coach Sam', feeCents: 85000, paidCents: 85000, owingCents: 0, perSessionCents: null, airtableStatus: 'Paid', type: 'JFP 10 weeks', status: 'paid', stripeCents: 0, stripeCount: 0, hasNotes: false, receivedCents: 85000, stripeFeeCents: 0, netReceivedCents: 85000, ...x })
const venue = (id, x) => ({ id, name: VENUE[id], players: 0, paid: 0, owingCents: 0, receivedCents: 0, stripeCents: 0, bankCents: 0, cashCents: 0, otherCents: 0, removedCents: 0, removedFeeCents: 0, airtableOnlyCents: 0, stripeFeeCents: 0, expectedCents: 0, collectedCents: 0, owingRowIds: [], netCents: 0, collectedPct: null, juniors: null, groups: [], canCost: true, costLines: [], costsCents: 0, profitCents: 0, profitBeforeFees: false, ...x })
const line = (id, method, venueId, taken, refunded, fee) => ({ id, at: '2026-10-06', method, payMethod: method === 'Stripe' ? 'card' : '', who: 'Pat Parent', venueId, takenCents: taken, refundedCents: refunded, feeCents: fee, feeGstCents: Math.round(fee / 11), keptCents: taken - refunded - fee })
const TERMS = ['Term 4 2026', 'Term 3 2026', 'Term 2 2026', 'Term 1 2026', 'Term 4 2025', 'Term 3 2025', 'Term 2 2025', 'Term 1 2025']
const LIVE = {
  since: '2026-09-14', stripeError: '', stripeAt: '2026-10-12T01:00:00.000Z', term: 'Term 4 2026', venueTerms: TERMS,
  prices: { group: 85000, sibling: 42500, pathway: 95000, pathwayOneToOne: 120000, oneToOneTerm: 150000, twoAWeek: 170000, familyPlace: 85000 },
  kpis: {
    incomeCents: 300000, stripeCents: 200000, stripeGrossCents: 205000, refundsCents: 5000, offlineCents: 100000, cashCents: 40000, bankCents: 60000, otherCents: 0,
    owingCents: 0, stripeUnrecordedCents: 0, players: 4, stripePayments: 3, venuesCents: 290000, unlinkedCents: 10000,
    stripeFeesCents: 4000, feeGstCents: 364, feesPendingCount: 1, netIncomeCents: 296000, unlinkedFeeCents: 200, feesByMethod: [{ method: 'card', count: 3, grossCents: 205000, feeCents: 4000, pendingCount: 1 }],
    expectedCents: 340000, collectedCents: 340000, collectedPct: 100, nextTermCents: 0, nextTermCount: 0, nextTermFeeCents: 0, venueCostsCents: 0, profitCents: 296000, venuesWithCosts: 0, paidNoMoneyCount: 0, paidNoMoneyCents: 0,
  },
  paidNoMoney: [], venueCostsLast: { term: 'Term 3 2026', byVenue: {} }, unlinked: { cents: 10000, items: [] },
  status: { paid: 4, stripe: 0, part: 0, unpaid: 0, unpriced: 0, session: 0 },
  weekly: [{ week: '2026-10-05', stripe: 200000, bank: 60000, cash: 40000, fee: 4000 }],
  weeklyByVenue: { belrose: [{ week: '2026-10-05', stripe: 130000, bank: 60000, cash: 0, fee: 2800 }], ntra: [{ week: '2026-10-05', stripe: 60000, bank: 0, cash: 40000, fee: 1000 }] },
  payments: [line('cs_1', 'Stripe', 'belrose', 135000, 5000, 2800), line('BANK-1', 'Bank transfer', 'belrose', 60000, 0, 0), line('cs_2', 'Stripe', 'ntra', 60000, 0, 1000), line('CASH-1', 'Cash', 'ntra', 40000, 0, 0), line('cs_3', 'Stripe', '', 10000, 0, 200)],
  nextTermPayments: [], otherStripe: { count: 0, cents: 0 }, unmatched: [],
  locations: [
    venue('belrose', { players: 2, paid: 2, receivedCents: 190000, stripeCents: 130000, bankCents: 60000, stripeFeeCents: 2800, netCents: 187200, groups: [{ key: 'g-belrose', label: 'Monday 4:20pm', coach: 'Coach Sam', players: 2, receivedCents: 190000, owingCents: 0, stripeFeeCents: 2800, netCents: 187200 }] }),
    venue('ntra', { players: 2, paid: 2, receivedCents: 100000, stripeCents: 60000, cashCents: 40000, stripeFeeCents: 1000, netCents: 99000, groups: [{ key: 'g-ntra', label: 'Wednesday 6:30am', coach: 'Coach Sam', players: 2, receivedCents: 100000, owingCents: 0, stripeFeeCents: 1000, netCents: 99000 }] }),
  ],
  players: [player('p1', 'Ava Test', 'belrose'), player('p2', 'Ben Test', 'belrose', { receivedCents: 105000 }), player('p3', 'Cal Test', 'ntra', { receivedCents: 60000 }), player('p4', 'Dee Test', 'ntra', { receivedCents: 40000 })],
}
const live = () => structuredClone(LIVE)
const PAST = Object.fromEntries(['Term 1 2025', 'Term 2 2025', 'Term 3 2025', 'Term 4 2025', 'Term 1 2026', 'Term 2 2026'].map((t) => [t, register(t)]))
PAST['Term 3 2026'] = ledgerTerm()
const termOf = (t) => (t === 'Term 4 2026' ? termFromLive(LIVE) : PAST[t].source === 'register' ? termFromRegister(PAST[t]) : termFromLedger(PAST[t]))
// What the moneyYear action answers.
const yearOf = (year) => ({ ...yearSummary({ year, terms: termsOfYear(TERMS, year).map(termOf), before: termsOfYear(TERMS, year - 1).map(termOf) }), years: yearsOf(TERMS), terms: TERMS, term: 'Term 4 2026', at: '2026-10-12T02:00:00.000Z' })
// Each term: its venues and the money not on a venue add up to it.
const addsUp = (t) => sum(t.venues, (v) => v.takenCents) + t.unlinkedCents + t.registerGapCents

// ---------- the year adds up ----------

await test('terms and years from the term list', () => {
  assert.deepEqual(termParts('Term 3 2026'), { n: 3, year: 2026 })
  assert.equal(termParts('Summer camp 2026'), null)
  assert.deepEqual(yearsOf(TERMS), [2026, 2025])
  assert.deepEqual(termsOfYear(TERMS, 2025), ['Term 1 2025', 'Term 2 2025', 'Term 3 2025', 'Term 4 2025'])
})

await test('earlier terms carry how many payments and the money by method on every venue and session', () => {
  const r = PAST['Term 3 2025']
  const hq = r.venues.find((v) => v.id === 'belrose')
  assert.deepEqual([r.paymentsCount, hq.payments], [11, 8])
  assert.deepEqual(hq.groups.map((g) => [g.label, g.payments, g.stripeCents, g.bankCents, g.cashCents, g.otherCents]), [['Tuesday Afternoon (HQ)', 7, 100000, 380000, 100000, 0], ['JONERS JUNIORS', 1, 0, 0, 0, 60000]])
  const l = PAST['Term 3 2026']
  assert.deepEqual([l.paymentsCount, l.unlinkedByKind, l.unlinked], [3, { stripe: 0, bank: 0, cash: 30000, other: 0 }, { cents: 30000, count: 1 }], 'unlinked keeps its shape')
  const g = l.venues.find((v) => v.id === 'belrose').groups[0]
  assert.deepEqual([g.payments, g.stripeCents, g.coach], [1, 85000, 'Coach Dee'])
  // A payment split over two rows at one venue is one payment there.
  const two = venuesFromLedger({ locations: LOCS, ledger: [{ 'Payment Method': 'Bank Transfer', 'Amount Paid': 1700, 'Source Record ID': 'r1, r3' }], rows: [...T3ROWS, { ...T3ROWS[0], id: 'r3', player: 'Cy Gamma' }], venueOf: (x) => byVenue(x.location), groupOf: (x) => ({ key: `${x.day}|${x.time}`, label: `${x.day} ${x.time}`, coach: x.coach }) })
  assert.deepEqual([two.paymentsCount, two.venues[0].payments, two.venues[0].players, two.venues[0].groups[0].payments], [1, 1, 2, 1])
})

await test('a register term: Lee\'s typed total is the term, HQ takes its typed total, every difference is a check', () => {
  const t1 = termFromRegister(PAST['Term 1 2025'])
  assert.deepEqual([t1.takenCents, t1.listedCents, t1.registerCents, t1.registerGapCents], [800000, 800000, 800000, 0])
  assert.ok(t1.checks.every((c) => c.diffCents === 0), 'all three typed totals match')
  assert.deepEqual(t1.checks.map((c) => c.scope), ['belrose', 'fields', 'all'])
  assert.equal(t1.juniorsCents, 50000, 'the register\'s Joners Juniors section, under HQ')
  const t2 = termFromRegister(PAST['Term 2 2025'])
  assert.deepEqual([t2.takenCents, t2.listedCents, t2.registerGapCents], [770000, 750000, 20000], 'the typed grand total is used; the A$200 it has more is not on a venue')
  assert.deepEqual(t2.checks.map((c) => [c.scope, c.registerCents, c.listedCents, c.diffCents]), [['all', 770000, 750000, 20000]])
  const t3 = termFromRegister(PAST['Term 3 2025'])
  const fields = t3.checks.find((c) => c.scope === 'fields')
  assert.deepEqual([fields.registerCents, fields.listedCents, fields.diffCents, fields.venueIds], [300000, 240000, 60000, ['rydalmere']])
  assert.equal(t3.venues.find((v) => v.id === 'belrose').takenCents, 640000)
  const t6 = termFromRegister(PAST['Term 2 2026'])
  const hq = t6.venues.find((v) => v.id === 'belrose')
  assert.deepEqual([hq.takenCents, hq.listedCents, hq.registerCents], [540000, 550000, 540000], 'HQ shows what Lee typed for it')
  assert.deepEqual([t6.takenCents, t6.registerGapCents], [740000, 0])
  assert.deepEqual(t6.checks.map((c) => [c.scope, c.diffCents]), [['belrose', -10000], ['all', -10000]])
  // Nothing typed: the payments listed are the term.
  const t4 = termFromRegister(PAST['Term 4 2025'])
  assert.deepEqual([t4.takenCents, t4.registerCents, t4.checks.length], [1000000, null, 0])
  for (const t of [t1, t2, t3, t4, t6]) {
    assert.equal(addsUp(t), t.takenCents, `${t.term}: the venues and the money not on a venue add up to the term`)
    assert.equal(sum(KINDS, (k) => t.methods[k]), t.listedCents, `${t.term}: the methods add up to the payments listed`)
    assert.deepEqual([t.feesKnown, t.stripeFeeCents, t.keptCents], [false, null, null], 'no Stripe fees in the register: not known, not nothing')
  }
})

await test('the ledger term and this term: venues plus money not linked add up, fees known, kept', () => {
  const t = termFromLedger(PAST['Term 3 2026'])
  assert.deepEqual([t.takenCents, t.stripeFeeCents, t.keptCents, t.unlinkedCents, t.payments], [191500, 1720, 189780, 30000, 3])
  assert.deepEqual(t.methods, { stripe: 85000, bank: 76500, cash: 30000, other: 0 }, 'the unlinked cash is in the methods too')
  assert.equal(addsUp(t), t.takenCents)
  assert.equal(sum(t.venues, (v) => v.keptCents) + t.unlinkedCents - t.unlinkedFeeCents, t.keptCents)
  const now = termFromLive(LIVE)
  assert.deepEqual([now.current, now.takenCents, now.keptCents, now.feesPending, now.refundedCents, now.payments], [true, 300000, 296000, 1, 5000, 5])
  assert.equal(addsUp(now), now.takenCents)
  assert.equal(sum(KINDS, (k) => now.methods[k]), now.takenCents)
  assert.deepEqual(now.venues.map((v) => [v.id, v.payments]), [['belrose', 2], ['ntra', 2]])
})

await test('a year: terms add up to the year, venues to each term, typed totals used and differences flagged, terms with no fees named', () => {
  const y = yearOf(2026)
  const all = y.scopes['']
  assert.deepEqual(all.perTerm.map((t) => [t.term, t.source, t.takenCents]), [['Term 1 2026', 'register', 700000], ['Term 2 2026', 'register', 740000], ['Term 3 2026', 'ledger', 191500], ['Term 4 2026', 'live', 300000]])
  assert.equal(all.takenCents, sum(all.perTerm, (t) => t.takenCents), 'the terms add up to the year')
  assert.equal(all.takenCents, 1931500)
  assert.equal(all.listedCents, 700000 + 750000 + 191500 + 300000)
  for (const v of y.venues) assert.equal(y.scopes[v.id].takenCents, sum(y.scopes[v.id].perTerm, (t) => t.takenCents), `${v.name}: its terms add up to its year`)
  for (const t of all.perTerm) {
    const venues = sum(y.venues, (v) => y.scopes[v.id].perTerm.find((x) => x.n === t.n).takenCents)
    assert.equal(venues + t.unlinkedCents + t.registerGapCents, t.takenCents, `${t.term}: the venues add up to the term`)
  }
  assert.equal(sum(y.venues, (v) => y.scopes[v.id].takenCents) + all.unlinkedCents + all.registerGapCents, all.takenCents, 'and to the year')
  // Kept after fees only for the terms whose fees are known, and it says which.
  assert.deepEqual([all.feeTerms, all.noFeeTerms], [['Term 3 2026', 'Term 4 2026'], ['Term 1 2026', 'Term 2 2026']])
  assert.deepEqual([all.stripeFeeCents, all.keptCents, all.takenWithFeesCents], [5720, 485780, 491500])
  assert.deepEqual(all.registerTerms, ['Term 1 2026', 'Term 2 2026'])
  assert.deepEqual(all.differences.map((d) => [d.term, d.scope, d.registerCents, d.listedCents]), [['Term 2 2026', 'belrose', 540000, 550000], ['Term 2 2026', 'all', 740000, 750000]])
  assert.deepEqual(y.scopes.belrose.differences.map((d) => d.scope), ['belrose'], 'HQ shows its own typed total, not the term\'s')
  assert.deepEqual(y.scopes.rydalmere.differences, [])
  assert.deepEqual([y.soFar, y.current, y.partial, y.missing, y.notYet], [true, 'Term 4 2026', true, [], []])
  assert.deepEqual(sum(KINDS, (k) => all.methods[k]), all.listedCents)
  const y25 = yearOf(2025)
  assert.deepEqual([y25.scopes[''].takenCents, y25.scopes[''].listedCents, y25.scopes[''].registerGapCents], [3510000, 3430000, 80000])
  assert.deepEqual([y25.scopes[''].feeTerms, y25.scopes[''].keptCents, y25.scopes[''].stripeFeeCents], [[], null, null], 'no fees in 2025 at all')
  assert.deepEqual(y25.scopes[''].differences.map((d) => [d.term, d.scope, d.diffCents]), [['Term 2 2025', 'all', 20000], ['Term 3 2025', 'fields', 60000], ['Term 3 2025', 'all', 60000]])
  assert.deepEqual(y25.scopes.ntra.differences.map((d) => [d.term, d.scope]), [], 'NTRA had nothing in Term 3, so the fields check there is Rydalmere\'s')
  assert.deepEqual(y25.scopes.rydalmere.differences.map((d) => [d.term, d.scope]), [['Term 3 2025', 'fields']])
  assert.deepEqual([y25.soFar, y25.partial], [false, false])
})

await test('against the year before: term for term, never the term still running, and without Joners Juniors when the two count it differently', () => {
  const c = yearOf(2026).scopes[''].compare
  assert.deepEqual([c.previousYear, c.terms, c.allTerms, c.running], [2025, [1, 2, 3], false, ['Term 4 2026']])
  assert.deepEqual([c.thisCents, c.lastCents, c.diffCents, c.pct], [1631500, 2510000, -878500, -35])
  assert.ok(c.withoutJuniors, 'Term 3 2025 counted Joners Juniors (the register), Term 3 2026 did not (the ledger)')
  assert.deepEqual([c.withoutJuniors.juniorsThisCents, c.withoutJuniors.juniorsLastCents, c.withoutJuniors.diffCents], [40000, 110000, -808500])
  assert.deepEqual(yearOf(2025).scopes[''].compare, { previousYear: 2024, none: 'nodata' }, 'no figures for 2024')
  // A venue the year before never had.
  const r = yearOf(2026).scopes.rydalmere.compare
  assert.deepEqual([r.thisCents, r.lastCents], [200000, 390000])
  const s = scopeOfYear([termFromRegister(PAST['Term 1 2025'])], 'rydalmere')
  const none = compareYears(s, scopeOfYear([termFromRegister(PAST['Term 1 2026'])], 'rydalmere'), 2025)
  assert.equal(none.nothingBefore, true)
  // A year with only the term running so far.
  const only = yearSummary({ year: 2026, terms: [termFromLive(LIVE)], before: [termFromRegister(PAST['Term 4 2025'])] })
  assert.equal(only.scopes[''].compare.none, 'running')
  assert.deepEqual([only.notYet, only.missing], [[], ['Term 1 2026', 'Term 2 2026', 'Term 3 2026']])
  // Both years in full: no term left out.
  const full = compareYears(scopeOfYear(termsOfYear(TERMS, 2025).map(termOf)), scopeOfYear(termsOfYear(TERMS, 2025).map(termOf)), 2024)
  assert.deepEqual([full.allTerms, full.diffCents, full.pct, full.withoutJuniors], [true, 0, 0, undefined])
})

// ---------- the page ----------

const venuesReply = (b) => (b.action === 'venues' ? (PAST[b.term] ? { success: true, venues: structuredClone(PAST[b.term]) } : { status: 404, success: false, error: 'No figures for that term.' }) : null)
const yearReply = (b) => (b.action === 'moneyYear' ? { success: true, year: yearOf(Number(b.year)) } : venuesReply(b))
const pick = async (p, value) => { const s = p.$('#m-show'); s.value = value; s.dispatchEvent(new p.w.Event('change', { bubbles: true })); await p.settle() }
const texts = (p, sel) => [...p.d.querySelectorAll(sel)].map((x) => x.textContent.replace(/\s+/g, ' ').trim())

await test('Showing: every year newest first, its whole year then its terms, this term picked; today\'s Money unchanged', async () => {
  const p = await openPortal({ money: live() })
  const groups = [...p.d.querySelectorAll('#m-show optgroup')].map((g) => [g.label, [...g.querySelectorAll('option')].map((o) => o.textContent)])
  assert.deepEqual(groups, [
    ['2026', ['2026, whole year', 'Term 4 2026 (this term)', 'Term 3 2026', 'Term 2 2026', 'Term 1 2026']],
    ['2025', ['2025, whole year', 'Term 4 2025', 'Term 3 2025', 'Term 2 2025', 'Term 1 2025']],
  ])
  assert.equal(p.$('#m-show').value, '', 'this term')
  assert.ok(p.$('[data-record]') && p.$('#m-since') && p.$('#m-kept'), 'today\'s view, as it was')
  assert.equal(p.w.location.hash, '#money')
  assert.deepEqual(p.errors, [])
  p.close()
})

await test('an earlier term from the register: read only, taken, no fees, typed totals beside the payments listed, by session', async () => {
  const p = await openPortal({ money: live(), onPost: venuesReply })
  await pick(p, 'term:Term 2 2026')
  assert.deepEqual(p.posts.filter((b) => b.action === 'venues').map((b) => b.term), ['Term 2 2026'])
  assert.equal(p.w.location.hash, '#money?term=Term%202%202026')
  assert.equal(p.$('#m-show').value, 'term:Term 2 2026')
  assert.equal(p.text('#m-taken'), money(750000))
  assert.equal(p.text('#m-nofees'), 'Stripe fees weren\'t recorded for this term.')
  assert.deepEqual(texts(p, '#m-register li'), [
    `Your register says ${money(540000)} for Belrose HQ, the payments listed add up to ${money(550000)}.${money(10000)} less in the register than in the payments listed.`,
    `Your register says ${money(740000)} for the term, the payments listed add up to ${money(750000)}.${money(10000)} less in the register than in the payments listed.`,
  ])
  assert.deepEqual([...p.d.querySelectorAll('#m-scope [data-tile]')].map((t) => [t.dataset.tile, t.querySelector('.val').textContent]), [['stripe', money(0)], ['bank', money(700000)], ['cash', money(0)], ['other', money(50000)], ['payments', '8']])
  assert.deepEqual(texts(p, '#m-sessions tbody tr'), [`Belrose HQ${money(550000)}`, `Monday Afternoon (HQ)6${money(550000)}`, `Rydalmere Park${money(200000)}`, `Friday Morning (Ryd)2${money(200000)}`, `Total8${money(750000)}`])
  // Nothing that records or changes a payment.
  for (const sel of ['[data-record]', '#m-rows', '#m-bank', '#m-record-all', '#m-unmatched', '.jm-alert', '#m-add', '#m-refresh', '#m-since', '#m-chips', '[data-remove-row]']) assert.equal(p.$(sel), null, `${sel} is for this term only`)
  assert.match(p.text('#m-readonly'), /nothing here can be changed/)
  // One venue: HQ's own typed total only.
  await p.click('#m-locs [data-mloc="belrose"]')
  assert.equal(p.w.location.hash, '#money?term=Term%202%202026&loc=belrose')
  assert.equal(p.text('#m-taken'), money(550000))
  assert.equal(p.d.querySelectorAll('#m-register li').length, 1)
  assert.ok(p.$('#m-add-costs'), 'costs for a venue can be added from here')
  await p.click('#m-locs [data-mloc="rydalmere"]')
  assert.equal(p.text('#m-taken'), money(200000))
  assert.equal(p.$('#m-register li'), null, 'no typed total for Rydalmere on its own')
  // The download: this venue's sessions, adding up to what the page says.
  await p.click('#m-csv')
  const { name, text } = await p.csv()
  assert.equal(name, 'jfp-money-term-2-2026-rydalmere.csv')
  const rows = csvRows(text)
  assert.deepEqual(rows.find((r) => r[0] === 'Taken'), ['Taken', '2000.00'])
  assert.deepEqual(rows.find((r) => r[0] === 'Stripe fees'), ['Stripe fees', 'Not recorded for this term'])
  assert.deepEqual(rows.find((r) => r[0] === 'Total').slice(0, 5), ['Total', '', '', '2', '2000.00'])
  assert.deepEqual(p.errors, [])
  p.close()
})

await test('the term before from the ledger: kept after Stripe fees, groups with coaches, who paid, money not on a venue', async () => {
  const p = await openPortal({ money: live(), hash: '#money?term=Term%203%202026', onPost: venuesReply })
  assert.equal(p.text('#m-taken'), money(191500))
  assert.equal(p.text('#m-sum'), `Kept after Stripe fees ${money(189780)} · Stripe fees ${money(1720)}`)
  assert.equal(p.$('#m-nofees'), null)
  assert.match(p.text('#m-unlinked'), /A\$300 \(1 payment\) belongs to players no longer on the term list/)
  assert.equal(p.text('#m-scope [data-tile="payments"] .val'), '3')
  assert.match(p.text('#m-scope [data-tile="payments"] .note'), /2 players paid/)
  assert.deepEqual(texts(p, '#m-sessions tbody tr'), [`Belrose HQ${money(85000)}${money(83280)}`, `Monday 4:20pmCoach Dee1${money(85000)}${money(83280)}`, `North Turramurra${money(76500)}${money(76500)}`, `Wednesday 6:30amCoach Eli1${money(76500)}${money(76500)}`, `Total2${money(161500)}${money(159780)}`])
  assert.match(p.text('#m-paid summary'), /Who paid \(2\)/)
  assert.equal(p.$('#m-register'), null, 'the ledger has no typed totals')
  await p.click('#m-csv')
  const rows = csvRows((await p.csv()).text)
  assert.deepEqual(rows.find((r) => r[0] === 'Kept after Stripe fees'), ['Kept after Stripe fees', '1897.80'])
  assert.ok(rows.some((r) => r[0] === 'Ari Alpha' && r[4] === '850.00'), 'who paid is in the download')
  assert.deepEqual(p.errors, [])
  p.close()
})

await test('a whole year: taken, kept for the terms with fees, against the year before, term by term, by venue, typed totals flagged', async () => {
  const p = await openPortal({ money: live(), hash: '#money?year=2026', onPost: yearReply })
  assert.deepEqual(p.posts.filter((b) => b.action === 'moneyYear').map((b) => b.year), [2026])
  assert.equal(p.w.location.hash, '#money?year=2026')
  assert.equal(p.$('#m-show').value, 'year:2026')
  assert.match(p.text('.jd-head p'), /2026 so far: Term 4 2026 is still running/)
  assert.equal(p.text('#y-taken'), money(1931500))
  assert.equal(p.text('#y-kept'), `Kept after Stripe fees ${money(485780)} for Terms 3 and 4 (Stripe fees ${money(5720)}). Stripe fees weren't recorded for Terms 1 and 2.`)
  assert.equal(p.text('#y-compare'), `Terms 1 to 3: down ${money(878500)} (35%) on the same terms of 2025.`)
  assert.ok(p.$('#y-compare').classList.contains('down'))
  assert.equal(p.text('#y-compare-note'), 'Term 4 2026 is still running, so it isn\'t in this.')
  assert.match(p.text('#y-compare-jj'), new RegExp(`Leaving Joners Juniors out of both years: down ${money(808500).replace('$', '\\$')} \\(34%\\) on the same terms of 2025`))
  assert.equal(p.text('#y-register'), `Uses the totals you typed in your register for Terms 1 and 2. The payments listed add up to ${money(1941500)}.`)
  assert.deepEqual(texts(p, '#y-terms tbody tr').map((t) => t.replace(/·/g, '|')), [
    `Term 1 2026From your register | matches your typed total${money(700000)}Not recorded`,
    `Term 2 2026From your register | your typed total | payments listed ${money(750000)}${money(740000)}Not recorded`,
    `Term 3 2026From the payment ledger${money(191500)}${money(189780)}`,
    `Term 4 2026Live, so far | after ${money(5000)} refunded${money(300000)}${money(296000)}`,
    `2026 so far${money(1931500)}${money(485780)}Terms 3 and 4`,
  ])
  assert.equal(p.d.querySelectorAll('#y-chart .band').length, 4, 'a bar a term')
  assert.deepEqual(texts(p, '#y-venues tbody tr'), [
    `Belrose HQ${money(480000)}${money(540000)}${money(85000)}${money(190000)}${money(1295000)}`,
    `North Turramurra${money(220000)}${money(0)}${money(76500)}${money(100000)}${money(396500)}`,
    `Rydalmere Park${money(0)}${money(200000)}${money(0)}${money(0)}${money(200000)}`,
    `Not linked to a player (not on a venue)${money(0)}${money(0)}${money(30000)}${money(10000)}${money(40000)}`,
    `All venues${money(700000)}${money(740000)}${money(191500)}${money(300000)}${money(1931500)}`,
  ])
  assert.equal(p.$('#y-venues td').dataset.label, 'Term 1', 'each cell is labelled for the phone layout')
  assert.deepEqual(texts(p, '#y-diffs li').map((t) => t.slice(0, 39)), ['Term 2 2026. Your register says A$5,400', 'Term 2 2026. Your register says A$7,400'])
  for (const sel of ['[data-record]', '#m-bank', '#m-rows', '#m-since']) assert.equal(p.$(sel), null)
  // The venue switch filters the whole year.
  await p.click('#m-locs [data-mloc="belrose"]')
  assert.equal(p.w.location.hash, '#money?year=2026&loc=belrose')
  assert.equal(p.text('#y-taken'), money(1295000))
  assert.equal(p.$('#y-venues'), null, 'the venue table is for All')
  assert.deepEqual(texts(p, '#y-diffs li').length, 1, 'only HQ\'s own typed total')
  assert.match(p.text('#y-compare'), /Terms 1 to 3: down/)
  await p.click('#m-csv')
  const { name, text } = await p.csv()
  assert.equal(name, 'jfp-money-2026-belrose.csv')
  const rows = csvRows(text)
  assert.deepEqual(rows.find((r) => r[0] === 'Taken'), ['Taken', '12950.00'])
  const from = rows.findIndex((r) => r[0] === 'By term') + 2
  const byTerm = rows.slice(from, rows.findIndex((r, i) => i >= from && r[0] === 'Total'))
  assert.deepEqual(byTerm.map((r) => r[0]), ['Term 1 2026', 'Term 2 2026', 'Term 3 2026', 'Term 4 2026'])
  assert.equal(sum(byTerm, (r) => Math.round(Number(r[2]) * 100)), 1295000, 'the terms in the download add up to the year')
  // Back to All, and the download has the venues.
  await p.click('#m-locs [data-mloc=""]')
  await p.click('#m-csv')
  const all = csvRows((await p.csv()).text)
  assert.deepEqual(all.find((r) => r[0] === 'All venues'), ['All venues', '7000.00', '7400.00', '1915.00', '3000.00', '19315.00'])
  assert.deepEqual(p.errors, [])
  p.close()
})

await test('a full year from the register: no fees, nothing to compare, typed totals that differ and what is not on a venue', async () => {
  const p = await openPortal({ money: live(), hash: '#money?year=2025', onPost: yearReply })
  assert.equal(p.text('#y-taken'), money(3510000))
  assert.equal(p.text('#y-kept'), 'Stripe fees weren\'t recorded for 2025.')
  assert.equal(p.text('#y-compare'), 'No figures for 2024 to compare with.')
  assert.match(p.text('.jd-head p'), /2025, the whole year/)
  assert.ok(texts(p, '#y-venues tbody tr').includes(`In your typed totals, not in the payments listed${money(0)}${money(20000)}${money(60000)}${money(0)}${money(80000)}`))
  assert.equal(texts(p, '#y-diffs li').length, 3)
  assert.match(texts(p, '#y-diffs li')[1], /Term 3 2025\. Your register says A\$3,000 for the fields \(Rydalmere Park\), the payments listed add up to A\$2,400/)
  assert.match(p.text('#y-notes'), /Your register counts Joners Juniors under Belrose HQ: A\$1,100 of this is Joners Juniors\./)
  // A term in the table opens it; this term opens today's Money.
  await p.click('#y-terms [data-open-term="Term 3 2025"]')
  assert.equal(p.w.location.hash, '#money?term=Term%203%202025')
  assert.equal(p.text('#m-taken'), money(880000))
  await pick(p, '')
  assert.equal(p.w.location.hash, '#money')
  assert.ok(p.$('#m-kept'))
  assert.deepEqual(p.errors, [])
  p.close()
})

await test('links: a term or year with no figures shows this term; the dashboard\'s lists always open this term', async () => {
  let p = await openPortal({ money: live(), hash: '#money?term=Term%209%201999', onPost: yearReply })
  assert.equal(p.w.location.hash, '#money')
  assert.ok(p.$('#m-kept'), 'today\'s Money')
  assert.ok(!p.posts.some((b) => b.action === 'venues'))
  p.close()
  p = await openPortal({ money: live(), hash: '#money?year=1999', onPost: yearReply })
  assert.equal(p.w.location.hash, '#money')
  assert.ok(!p.posts.some((b) => b.action === 'moneyYear'))
  p.close()
  p = await openPortal({ money: live(), hash: '#money?year=2025', onPost: yearReply })
  await p.click('#nav [data-tab="overview"]')
  await p.click('[data-money-filter="unpaid"]')
  assert.equal(p.w.location.hash, '#money')
  assert.ok(p.$('#m-rows'))
  assert.deepEqual(p.errors, [])
  p.close()
})

console.log(`\n${passed} money by year checks passed`)
