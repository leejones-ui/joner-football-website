// The Joners Juniors section of the staff portal in jsdom: the sidebar
// group, Dashboard, Players (search, chips, a child's page, recording a
// payment), Money (the download, the switch to and from JFP Money),
// Settings and the pages still to come. Every name and amount is invented.
//   node scripts/test-jj-ui.mjs
import assert from 'node:assert/strict'
import { openPortal, csvRows } from './jfp-portal-dom.mjs'
import { money } from '../src/scripts/jfp-common.js'

let passed = 0
async function test(name, fn) { await fn(); passed += 1; console.log(`ok - ${name}`) }

// JFP Money, for the switch to Joners Juniors (the same invented term as test-jfp-money-ui.mjs).
const VENUES = { belrose: 'Belrose HQ', ntra: 'North Turramurra', rydalmere: 'Rydalmere Park', other: 'No venue set' }
const player = (rowId, name, loc, x) => ({
  rowId, player: name, parent: `${name.split(' ')[0]} Parent`, email: `${rowId}@example.com`, familyKey: `${rowId}@example.com`, phone: '', openLink: null, product: 'group',
  group: `Monday 4:20pm, ${VENUES[loc]}`, groupId: `g-${loc}`, locationId: loc, locationName: VENUES[loc], coach: 'Coach Sam',
  feeCents: 0, paidCents: 0, owingCents: 0, perSessionCents: null, airtableStatus: 'Not set', type: 'JFP 10 weeks', status: 'unpaid',
  stripeCents: 0, stripeCount: 0, hasNotes: false, receivedCents: 0, stripeFeeCents: 0, netReceivedCents: 0, ...x,
})
const players = [
  player('p1', 'Ava Test', 'belrose', { feeCents: 85000, paidCents: 85000, status: 'paid', receivedCents: 85000, stripeFeeCents: 1720, netReceivedCents: 83280 }),
  player('p2', 'Ben Test', 'belrose', { feeCents: 85000, owingCents: 85000, status: 'unpaid' }),
  player('p3', 'Cal Test', 'ntra', { feeCents: 42500, paidCents: 20000, owingCents: 22500, status: 'part', receivedCents: 20000, netReceivedCents: 20000 }),
  player('p4', 'Dee Test', 'ntra', { feeCents: 85000, status: 'stripe', stripeCents: 85000, receivedCents: 85000, stripeFeeCents: 6000, netReceivedCents: 79000 }),
  player('p5', 'Eve Test', 'rydalmere', { feeCents: 85000, paidCents: 85000, status: 'paid', receivedCents: 85000, netReceivedCents: 85000 }),
  player('p6', 'Fin Test', 'other', { status: 'unpriced' }),
  player('p7', 'Gus Test', 'ntra', { feeCents: 30000, owingCents: 30000, status: 'unpaid' }),
]
const line = (id, at, method, payMethod, who, venueId, taken, refunded, fee, gst) => ({ id, at, method, payMethod, who, venueId, takenCents: taken, refundedCents: refunded, feeCents: fee, feeGstCents: gst, keptCents: fee == null ? null : taken - refunded - fee })
const payments = [
  line('cs_1', '2026-10-05', 'Stripe', 'card', 'Ava Parent', 'belrose', 85000, 0, 1720, 156),
  line('cs_2', '2026-10-06', 'Stripe', 'afterpay_clearpay', 'Dee Parent', 'ntra', 90000, 5000, 6000, 545),
  line('BANK-1', '2026-10-07', 'Bank transfer', '', 'Cal Test', 'ntra', 20000, 0, 0, 0),
  line('CASH-1', '2026-10-08', 'Cash', '', 'Eve Test', 'rydalmere', 85000, 0, 0, 0),
  line('cs_3', '2026-10-09', 'Stripe', 'card', '@Stranger', '', 10000, 0, 240, 22),
  line('cs_4', '2026-10-10', 'Stripe', 'link', 'Late Payer', 'belrose', 5000, 0, null, null),
  line('OFF-1', '', 'Other', '', 'Old Payer', 'rydalmere', 3000, 0, 0, 0),
]
const group = (loc, x) => ({ key: `g-${loc}`, label: 'Monday 4:20pm', coach: 'Coach Sam', ...x })
const venue = (id, x) => ({ id, name: VENUES[id], players: 0, paid: 0, owingCents: 0, receivedCents: 0, stripeCents: 0, bankCents: 0, cashCents: 0, otherCents: 0, removedCents: 0, removedFeeCents: 0, airtableOnlyCents: 0, stripeFeeCents: 0, expectedCents: 0, collectedCents: 0, owingRowIds: [], netCents: 0, collectedPct: null, juniors: null, groups: [], ...x })
const locations = [
  venue('belrose', { players: 2, paid: 1, owingCents: 85000, receivedCents: 90000, stripeCents: 90000, removedCents: 5000, stripeFeeCents: 1720, netCents: 88280, expectedCents: 170000, collectedCents: 85000, collectedPct: 50, owingRowIds: ['p2'], groups: [group('belrose', { players: 2, receivedCents: 90000, owingCents: 85000, stripeFeeCents: 1720, netCents: 88280 })] }),
  venue('ntra', { players: 3, paid: 1, owingCents: 52500, receivedCents: 105000, stripeCents: 85000, bankCents: 20000, stripeFeeCents: 6000, netCents: 99000, expectedCents: 157500, collectedCents: 105000, collectedPct: 66, owingRowIds: ['p3', 'p7'], groups: [group('ntra', { players: 3, receivedCents: 105000, owingCents: 52500, stripeFeeCents: 6000, netCents: 99000 })] }),
  venue('rydalmere', { players: 1, paid: 1, receivedCents: 88000, cashCents: 85000, otherCents: 3000, removedCents: 3000, netCents: 88000, expectedCents: 85000, collectedCents: 85000, collectedPct: 100, groups: [group('rydalmere', { players: 1, receivedCents: 88000, netCents: 88000 })] }),
  venue('other', { players: 1 }),
]
const weeks = ['2026-09-28', '2026-10-05']
const wk = (rows) => weeks.map((week, i) => ({ week, stripe: 0, bank: 0, cash: 0, fee: 0, ...(i === 1 ? rows : {}) }))
const MONEY = {
  since: '2026-09-28', stripeError: '', stripeAt: '2026-10-12T01:00:00.000Z', term: 'Term 4 2026',
  prices: { group: 85000, sibling: 42500, pathway: 95000, pathwayOneToOne: 120000, oneToOneTerm: 150000, twoAWeek: 170000, familyPlace: 85000 },
  venueTerms: ['Term 4 2026', 'Term 3 2026', 'Term 2 2026'],
  kpis: {
    incomeCents: 293000, stripeCents: 185000, stripeGrossCents: 190000, refundsCents: 5000, offlineCents: 108000, cashCents: 85000, bankCents: 20000, otherCents: 3000,
    owingCents: 137500, stripeUnrecordedCents: 1, players: 7, stripePayments: 4, venuesCents: 283000, unlinkedCents: 10000,
    stripeFeesCents: 7960, feeGstCents: 723, feesPendingCount: 1, netIncomeCents: 285040, unlinkedFeeCents: 240,
    feesByMethod: [{ method: 'afterpay_clearpay', count: 1, grossCents: 90000, feeCents: 6000, pendingCount: 0 }, { method: 'card', count: 2, grossCents: 95000, feeCents: 1960, pendingCount: 0 }, { method: 'link', count: 1, grossCents: 5000, feeCents: 0, pendingCount: 1 }],
    expectedCents: 412500, collectedCents: 275000, collectedPct: 66, nextTermCents: 50000, nextTermCount: 1, nextTermFeeCents: 1020,
  },
  unlinked: { cents: 10000, items: [] },
  status: { paid: 2, stripe: 1, part: 1, unpaid: 2, unpriced: 1, session: 0 },
  weekly: wk({ stripe: 185000, bank: 20000, cash: 85000, fee: 7960 }),
  weeklyByVenue: { belrose: wk({ stripe: 90000, fee: 1720 }), ntra: wk({ stripe: 85000, bank: 20000, fee: 6000 }), rydalmere: wk({ cash: 85000 }), other: wk({}) },
  payments,
  nextTermPayments: [{ id: 'cs_n1', at: '2026-10-09T00:00:00.000Z', name: 'Next Parent', email: 'next@example.com', cents: 50000, feeCents: 1020, product: 'JFP Term 1 2027 hold', forTerm: 'Term 1 2027' }],
  locations, players,
  unmatched: [{ id: 'cs_3', at: '2026-10-09T00:00:00.000Z', name: '@Stranger', email: 'stranger@example.com', cents: 10000, product: 'JFP' }],
}

// ---------- invented Joners Juniors ----------
const kid = (rowId, name, x = {}) => ({
  rowId, term: 'Term 4 2026', name, dob: '2021-03-05', age: 5, parent: `${name.split(' ')[0]} Parent`, email: `${rowId}@example.com`, emails: [`${rowId}@example.com`], mobile: '0400 000 001', mobile2: '',
  medical: '', notes: '', className: 'Saturday 9:15am to 10:00am', session: 'Saturday 9:15am', location: 'Belrose HQ', coach: 'Sam Yorks',
  feeCents: 22000, paidCents: 0, owingCents: 22000, pay: 'unpaid', payStatus: 'unpaid', payLabel: 'Unpaid', airtableStatus: 'Unpaid', paidVia: '', paidAt: '',
  payments: [], waiver: { onFile: false, airtable: 'Needed' }, removed: null, jfpSiblings: [], source: 'Airtable', confirmation: 'Sent', confirmationDate: '', ...x,
})
const KIDS = [
  kid('recAAAAAAAAAAAAA1', 'Ada Junior', { pay: 'paid', payStatus: 'paid', payLabel: 'Paid', paidCents: 22000, owingCents: 0, paidVia: 'Stripe', waiver: { onFile: true, how: 'family email or mobile' }, payments: [{ kind: 'stripe', ref: '…abc123', cents: 22000, at: '2026-10-10T00:00:00Z' }] }),
  kid('recAAAAAAAAAAAAA2', 'Bo Junior', { jfpSiblings: ['Cy Senior'], medical: 'Invented allergy' }),
  kid('recAAAAAAAAAAAAA3', 'Cal Junior', { pay: 'part', payStatus: 'part', payLabel: 'Part paid', paidCents: 10000, owingCents: 12000, payments: [{ kind: 'recorded', id: 'JJ-CASH-1', cents: 10000, at: '2026-10-11', method: 'Cash' }] }),
  kid('recAAAAAAAAAAAAA4', 'Dee Junior', { removed: { at: '2026-10-12', by: 'Lee', reason: 'Moved away' } }),
]
const PLAYERS = {
  term: 'Term 4 2026', current: true, terms: ['Term 4 2026', 'Term 3 2026'], at: '2026-10-13T00:00:00Z', classLabel: 'Saturday 9:15am to 10:00am', datesLabel: '17 October 2026 to 19 December 2026', capacity: 12,
  players: KIDS, counts: { all: 3, paid: 1, part: 1, unpaid: 1, noprice: 0, noWaiver: 2, removed: 1 },
  summary: { enrolled: 3, capacity: 12, placesLeft: 9, collectedCents: 32000, keptCents: 31540, feesCents: 460, feesPending: 0, owingCents: 34000, owingComplete: true, stripeCents: 22000, cashCents: 10000, bankCents: 0, unlinkedCount: 0, unlinkedCents: 0, paidInStripeOnly: 0, unverified: 0 },
  moneyError: '', reasons: ['Cost', 'Moved away', 'Other'], methods: ['Cash', 'Bank transfer', 'Other'], priceCents: 22000,
}
const PUBLIC = { termDatesLine: 'Term 4: 17 October 2026 to 19 December 2026', classLabel: 'Saturday 9:15am to 10:00am', feeLine: '$220 for 10 weeks', registrationOpen: true }
const { players: _omit, ...DASH_BASE } = PLAYERS
const DASH = { ...DASH_BASE, needs: [{ kind: 'unpaid', label: '1 child has not paid (A$340 owing)', tab: 'jj-players', filter: 'unpaid', count: 1 }, { kind: 'waiver', label: '2 without a waiver', tab: 'jj-players', filter: 'waiver', count: 2 }], registrationOpen: true, public: PUBLIC, attendance: { ready: false, note: 'Attendance by week arrives with Registers.' } }
const jline = (x) => ({ term: 'Term 4 2026', refundedCents: 0, feeGstCents: 0, ...x })
const JMONEY = {
  at: '2026-10-13T00:00:00Z', currentTerm: 'Term 4 2026', terms: ['Term 4 2026', 'Term 3 2026'], stale: false,
  byTerm: {
    'Term 4 2026': { term: 'Term 4 2026', players: 3, removed: 1, collectedCents: 32000, refundedCents: 0, linkedCents: 32000, byHandCents: 0, unlinkedCents: 0, unlinkedCount: 0, owingCents: 34000, owingComplete: true, creditPlaces: 0, creditValueCents: 0, counts: { paid: 1, part: 1, unpaid: 1 }, unresolved: 0, stripeCents: 22000, cashCents: 10000, bankCents: 0, otherCents: 0, feesCents: 460, feeGstCents: 42, feesPending: 0, keptCents: 31540,
      lines: [jline({ ref: '…abc123', at: '2026-10-10T00:00:00Z', kind: 'stripe', method: 'Stripe', payMethod: 'card', who: 'Ada Junior', takenCents: 22000, feeCents: 460, feeGstCents: 42, keptCents: 21540 }), jline({ ref: 'JJ-CASH-1', at: '2026-10-11', kind: 'cash', method: 'Cash', who: 'Cal Junior', takenCents: 10000, feeCents: 0, keptCents: 10000 })] },
    'Term 3 2026': { term: 'Term 3 2026', players: 1, removed: 0, collectedCents: 22000, refundedCents: 0, linkedCents: 22000, byHandCents: 0, unlinkedCents: 0, unlinkedCount: 0, owingCents: 0, owingComplete: true, creditPlaces: 0, creditValueCents: 0, counts: { paid: 1 }, unresolved: 0, stripeCents: 22000, cashCents: 0, bankCents: 0, otherCents: 0, feesCents: 460, feeGstCents: 42, feesPending: 0, keptCents: 21540, lines: [] },
  },
  players: [
    { rowId: 'recAAAAAAAAAAAAA1', term: 'Term 4 2026', player: 'Ada Junior', parent: 'Ada Parent', feeCents: 22000, paidCents: 22000, refundedCents: 0, owingCents: 0, status: 'paid', airtableStatus: 'Paid', paidVia: 'Stripe', paidAt: '2026-10-10T00:00:00Z', payments: [], recorded: [], stripeFeeCents: 460, stripeFeePending: 0, match: 'stripe', removed: null },
    { rowId: 'recAAAAAAAAAAAAA2', term: 'Term 4 2026', player: 'Bo Junior', parent: 'Bo Parent', feeCents: 22000, paidCents: 0, refundedCents: 0, owingCents: 22000, status: 'unpaid', airtableStatus: 'Unpaid', paidVia: '', paidAt: '', payments: [], recorded: [], stripeFeeCents: 0, stripeFeePending: 0, match: '', removed: null },
    { rowId: 'recAAAAAAAAAAAAA3', term: 'Term 4 2026', player: 'Cal Junior', parent: 'Cal Parent', feeCents: 22000, paidCents: 10000, refundedCents: 0, owingCents: 12000, status: 'part', airtableStatus: 'Partially Paid', paidVia: 'Cash', paidAt: '2026-10-11', payments: [], recorded: [], stripeFeeCents: 0, stripeFeePending: 0, match: 'recorded', removed: null },
  ],
  unlinked: [], byHand: [], unassigned: 0, otherCurrency: [],
  coverage: { tables: 2, rows: 4, stripePayments: 2, byIdOrLink: 2, linksChecked: 1, missingLinks: 0, recordedPayments: 1, sheet: null, alsoInJfp: 0 },
  earlier: [{ term: 'Term 1 2025', year: 2025, takenCents: 66000, source: 'register' }],
  years: [{ year: 2026, terms: [{ term: 'Term 4 2026', takenCents: 32000, keptCents: 31540, source: 'live' }, { term: 'Term 3 2026', takenCents: 22000, keptCents: 21540, source: 'live' }], takenCents: 54000, keptCents: 53080 }, { year: 2025, terms: [{ term: 'Term 1 2025', takenCents: 66000, keptCents: null, source: 'register' }], takenCents: 66000, keptCents: null }],
}
const SETTINGS = {
  juniors: { term: 'Term 4 2026', termStart: '2026-10-17', weeks: 10, skipDates: [], datesLabel: '', classes: [{ id: 'sat-0915-belrose', day: 'Saturday', time: '9:15am', endTime: '10:00am', location: 'Belrose HQ', capacity: 12, coachId: 'sam' }], classLabel: '', location: 'Joner Football HQ, Unit 2, 20 Narabang Way, Belrose', priceCents: 22000, siblingPriceCents: null, registrationOpen: true, waiverVersion: 'Joners Juniors Term 4 2026 online waiver v1', ageLabel: 'Ages 3 to early primary', tables: { 'Term 3 2026': 'tblMLhYQ126P5uKLB', 'Term 4 2026': 'tblVzW8E9qumQEtXx' }, nextTerm: { name: 'Term 1 2027', termStart: '', open: false } },
  derived: { dates: [{ iso: '2026-10-17', label: 'Sat 17 Oct' }], datesLabel: '17 October 2026 to 19 December 2026', classLabel: 'Saturday 9:15am to 10:00am', capacity: 12 },
  public: PUBLIC, coaches: [{ id: 'sam', name: 'Sam York' }, { id: 'lee', name: 'Lee Jones' }],
}
const answers = (extra = {}) => (b) => {
  if (extra[b.action]) return extra[b.action](b)
  if (b.action === 'jjPlayers') return { success: true, ...structuredClone(PLAYERS) }
  if (b.action === 'jjDashboard') return { success: true, ...structuredClone(DASH) }
  if (b.action === 'jjSettings') return { success: true, ...structuredClone(SETTINGS) }
  if (b.action === 'juniorsMoney') return { success: true, juniors: structuredClone(JMONEY) }
  return null
}
const open = (hash, extra) => openPortal({ money: structuredClone(MONEY), hash, onPost: answers(extra) })

await test('the sidebar has a Joners Juniors section with all nine pages, in order', async () => {
  const p = await open('#jj-dashboard')
  const grp = [...p.d.querySelectorAll('.jp-navgrp')].find((g) => g.querySelector('[data-navsec]').dataset.navsec === 'Joners Juniors')
  assert.ok(grp, 'the section is there')
  assert.deepEqual([...grp.querySelectorAll('[data-tab]')].map((b) => b.dataset.label), ['Dashboard', 'Players', 'Invites', 'Requests & waitlist', 'Classes', 'Registers', 'Messages', 'Money', 'Settings'])
  assert.equal(grp.classList.contains('shut'), false, 'open: it holds the page on screen')
  assert.equal(grp.querySelector('[aria-current="page"]').dataset.tab, 'jj-dashboard')
  assert.ok(grp.querySelectorAll('svg path').length >= 9, 'every page has an icon')
  assert.deepEqual(p.errors, [])
})

await test('Dashboard: enrolled against places, collected and kept, owing, waivers, and what needs Ligia', async () => {
  const p = await open('#jj-dashboard')
  assert.match(p.text('#jj-t-enrolled'), /Enrolled\s*3 \/ 12\s*9 places left · 1 left this term/)
  assert.match(p.text('#jj-t-collected'), new RegExp(`${money(32000).replace('$', '\\$')}\\s*${money(31540).replace('$', '\\$')} kept after Stripe fees`))
  assert.match(p.text('#jj-t-owing'), /A\$340/)
  assert.match(p.text('#jj-t-waivers'), /Waivers missing\s*2/)
  assert.deepEqual([...p.d.querySelectorAll('#jj-needs button')].map((b) => b.textContent), ['1 child has not paid (A$340 owing)', '2 without a waiver'])
  assert.match(p.text('#jj-attendance'), /arrives with Registers/)
  await p.click('#jj-needs button')
  assert.equal(p.w.location.hash, '#jj-players')
  assert.equal(p.$('#jj-chips [aria-pressed="true"]').dataset.jjchip, 'unpaid', 'opens Players on the unpaid children')
  assert.deepEqual([...p.d.querySelectorAll('#jj-rows [data-jjpl]')].map((b) => b.querySelector('b').textContent.trim()), ['Bo Junior (5)'])
  assert.deepEqual(p.errors, [])
})

await test('Players: search and chips; children who left only under Left', async () => {
  const p = await open('#jj-players')
  const names = () => [...p.d.querySelectorAll('#jj-rows [data-jjpl]')].map((b) => b.querySelector('b').firstChild.textContent.trim())
  assert.deepEqual(names(), ['Ada Junior', 'Bo Junior', 'Cal Junior'])
  await p.click('#jj-chips [data-jjchip="waiver"]')
  assert.deepEqual(names(), ['Bo Junior', 'Cal Junior'])
  await p.click('#jj-chips [data-jjchip="removed"]')
  assert.deepEqual(names(), ['Dee Junior'])
  await p.click('#jj-chips [data-jjchip=""]')
  const q = p.$('#jj-q'); q.value = 'cal'; q.dispatchEvent(new p.w.Event('input', { bubbles: true })); await p.settle()
  assert.deepEqual(names(), ['Cal Junior'])
  assert.match(p.text('#jj-p-count'), /1 of 3 children match/)
  assert.deepEqual(p.errors, [])
})

await test('a child\'s page: contacts to tap, money, payments, waiver, and recording a cash payment', async () => {
  const p = await open('#jj-players', { jjRecordPayment: () => ({ success: true, id: 'JJ-CASH-2' }) })
  await p.click('[data-jjpl="recAAAAAAAAAAAAA3"]')
  const m = p.$('#jp-modal')
  assert.ok(m.querySelector('a[href="tel:0400000001"]')); assert.ok(m.querySelector('a[href="mailto:recAAAAAAAAAAAAA3@example.com"]'))
  assert.match(m.textContent, /Part paid/); assert.match(m.textContent, /Cash · JJ-CASH-1/)
  assert.ok(m.querySelector('[data-void="JJ-CASH-1"]'), 'a recorded payment can be taken off')
  await p.click(m.querySelector('[data-act="pay"]'))
  assert.equal(p.$('#jp-amount').value, '120', 'what is still owing')
  await p.click('#jp-go')
  const sent = p.posts.find((x) => x.action === 'jjRecordPayment')
  assert.deepEqual({ rowIds: sent.rowIds, amountCents: sent.amountCents, method: sent.method }, { rowIds: ['recAAAAAAAAAAAAA3'], amountCents: 12000, method: 'Cash' })
  assert.ok(p.posts.filter((x) => x.action === 'jjPlayers').length >= 2, 'reads again after recording')
  // The family's JFP children show on a Juniors child's page.
  await p.click('[data-jjpl="recAAAAAAAAAAAAA2"]')
  assert.match(p.$('#jp-modal').textContent, /Also in JFP\s*Cy Senior/)
  assert.deepEqual(p.errors, [])
})

await test('Add a child: a full class asks first, then adds anyway', async () => {
  let n = 0
  const p = await open('#jj-players', { jjAddPlayer: (b) => (n++ === 0 ? { status: 409, success: false, code: 'full', error: 'The class has 12 of 12 places taken. Add anyway?' } : { success: true, rowId: 'recNEW', force: b.force }) })
  await p.click('#jj-p-add')
  p.$('#ja-name').value = 'Eli Junior'; p.$('#ja-email').value = 'eli@example.com'
  await p.click('#ja-go')
  assert.match(p.text('#jp-modal'), /12 of 12 places taken/)
  await p.click('#jp-modal [data-yes]')
  const adds = p.posts.filter((x) => x.action === 'jjAddPlayer')
  assert.deepEqual(adds.map((x) => x.force), [false, true])
  assert.equal(adds[0].feeAud, 220, 'the term fee from the settings')
  assert.deepEqual(p.errors, [])
})

await test('Money: the Juniors page with Stripe, cash and kept after fees, earlier years, and the download', async () => {
  const p = await open('#jj-money')
  assert.match(p.text('#jm-kept'), new RegExp(`Kept after Stripe fees\\s*${money(31540).replace('$', '\\$')}`))
  assert.ok(p.$('#jm-years'), 'earlier terms and years')
  assert.match(p.text('#jm-years'), /Term 1 2025.*From your Money Register/)
  assert.equal(p.d.querySelectorAll('#jm-rows .jj-mrow').length, 3)
  await p.click('#jm-csv')
  const f = await p.csv()
  assert.equal(f.name, 'joners-juniors-money-term-4-2026.csv')
  const rows = csvRows(f.text)
  assert.deepEqual(rows.find((r) => r[0] === 'Kept after Stripe fees'), ['Kept after Stripe fees', '315.40'])
  assert.ok(rows.some((r) => r[0] === '2026-10-11' && r[1] === 'Cash' && r[2] === 'Cal Junior'))
  assert.ok(!f.text.includes('@example.com'))
  assert.equal(p.w.location.hash, '#jj-money?term=Term%204%202026')
  // JFP from here goes back to JFP Money.
  await p.click('[data-programme="jfp"]')
  assert.equal(p.w.location.hash, '#money')
  assert.ok(p.$('#m-scope'), 'JFP Money is on screen')
  assert.deepEqual(p.errors, [])
})

await test('JFP Money keeps a Joners Juniors link that opens the Juniors money page; an old link lands there too', async () => {
  const p = await open('#money')
  assert.ok(p.$('[data-programme="juniors"]'))
  await p.click('[data-programme="juniors"]')
  assert.match(p.w.location.hash, /^#jj-money/)
  assert.ok(p.$('#jm-kept'))
  const old = await open('#money?programme=juniors&term=Term%203%202026')
  assert.match(old.w.location.hash, /^#jj-money\?term=Term%203%202026/)
  assert.equal(old.$('#jm-term').value, 'Term 3 2026')
  assert.deepEqual([...p.errors, ...old.errors], [])
})

await test('Settings: the term, class, price and sign-up, saved in one go', async () => {
  const p = await open('#jj-settings', { jjSaveSettings: (b) => ({ success: true, ...structuredClone(SETTINGS), juniors: { ...SETTINGS.juniors, ...b.juniors }, warnings: [] }) })
  assert.match(p.text('#jj-preview'), /Term 4: 17 October 2026 to 19 December 2026/)
  const form = p.$('#jj-sform')
  form.querySelector('[name="price"]').value = '240'
  form.querySelector('[name="registrationOpen"]').checked = false
  form.querySelector('[name="capacity"]').value = '14'
  await p.click('#jj-table-add')
  const added = [...p.d.querySelectorAll('#jj-tables .jj-trow')].at(-1)
  added.querySelector('[data-tterm]').value = 'Term 1 2027'; added.querySelector('[data-tid]').value = 'tblBBBBBBBBBBBBBB'
  form.dispatchEvent(new p.w.Event('submit', { bubbles: true, cancelable: true })); await p.settle()
  const sent = p.posts.find((x) => x.action === 'jjSaveSettings').juniors
  assert.equal(sent.priceCents, 24000); assert.equal(sent.registrationOpen, false); assert.equal(sent.classes[0].capacity, 14)
  assert.equal(sent.tables['Term 1 2027'], 'tblBBBBBBBBBBBBBB'); assert.equal(sent.tables['Term 4 2026'], 'tblVzW8E9qumQEtXx')
  assert.equal(sent.siblingPriceCents, null)
  assert.deepEqual(p.errors, [])
})

await test('the pages still to come say what they will do and where to go now', async () => {
  for (const [hash, title] of [['#jj-invites', 'Invites'], ['#jj-requests', 'Requests & waitlist'], ['#jj-classes', 'Classes'], ['#jj-registers', 'Registers'], ['#jj-messages', 'Messages']]) {
    const p = await open(hash)
    assert.equal(p.text('#view h1'), title)
    assert.match(p.text('.jj-soon'), /Coming next/)
    assert.deepEqual(p.errors, [])
  }
})

console.log(`\n${passed} Joners Juniors page checks passed`)
