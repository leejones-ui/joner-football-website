// Bank payments to check (Lee, 16 Oct 2026), in jsdom. Redesign: on Money a
// folded row low on the page with Check bank now inside; on the Dashboard a
// one-line link (admins only, when lines wait); the sidebar's badge.
//   node scripts/test-jfp-bank-front-ui.mjs
// Every name and amount here is invented.
import assert from 'node:assert/strict'
import { openPortal } from './jfp-portal-dom.mjs'
import { money } from '../src/scripts/jfp-common.js'

let passed = 0
async function test(name, fn) { await fn(); passed += 1; console.log(`ok - ${name}`) }

// ---------- a small JFP term ----------
const pl = (rowId, name, x = {}) => ({ rowId, player: name, parent: `${name.split(' ')[0]} Parent`, email: `${rowId}@example.com`, familyKey: `${rowId}@example.com`, phone: '', openLink: null, product: 'group', group: 'Monday 4:20pm, Belrose HQ', groupId: 'g1', locationId: 'belrose', locationName: 'Belrose HQ', coach: 'Coach Test', feeCents: 85000, paidCents: 0, owingCents: 85000, perSessionCents: null, airtableStatus: 'Not set', type: 'JFP 10 weeks', status: 'unpaid', stripeCents: 0, stripeCount: 0, hasNotes: false, receivedCents: 0, stripeFeeCents: 0, netReceivedCents: 0, ...x })
const MONEY = {
  since: '2026-09-14', stripeError: '', stripeAt: '2026-10-12T01:00:00.000Z', term: 'Term 4 2026', prices: { group: 85000, twoAWeek: 170000, familyPlace: 85000 }, venueTerms: ['Term 4 2026'],
  kpis: { incomeCents: 0, stripeCents: 0, stripeGrossCents: 0, refundsCents: 0, offlineCents: 0, cashCents: 0, bankCents: 0, otherCents: 0, owingCents: 170000, players: 2, stripePayments: 0, venuesCents: 0, unlinkedCents: 0, stripeFeesCents: 0, feeGstCents: 0, feesPendingCount: 0, netIncomeCents: 0, unlinkedFeeCents: 0, feesByMethod: [], expectedCents: 170000, collectedCents: 0, collectedPct: 0, nextTermCents: 0, nextTermCount: 0, nextTermFeeCents: 0 },
  unlinked: { cents: 0, items: [] }, status: { paid: 0, stripe: 0, part: 0, unpaid: 2, unpriced: 0, session: 0 },
  weekly: [{ week: '2026-10-12', stripe: 0, bank: 0, cash: 0, fee: 0 }], weeklyByVenue: { belrose: [{ week: '2026-10-12', stripe: 0, bank: 0, cash: 0, fee: 0 }] }, payments: [], nextTermPayments: [],
  locations: [{ id: 'belrose', name: 'Belrose HQ', players: 2, paid: 0, owingCents: 170000, receivedCents: 0, stripeCents: 0, bankCents: 0, cashCents: 0, otherCents: 0, removedCents: 0, removedFeeCents: 0, stripeFeeCents: 0, expectedCents: 170000, collectedCents: 0, netCents: 0, collectedPct: 0, juniors: null, groups: [], owingRowIds: ['p1', 'p2'] }],
  players: [pl('p1', 'Ivy Test'), pl('p2', 'Jax Test')], unmatched: [],
}
const fresh = () => structuredClone(MONEY)

// ---------- invented bank lines ----------
const day = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date(Date.now() - n * 86400000))
const short = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
const cand = (rowId, player) => ({ rowId, player, parent: `${player.split(' ')[0]} Parent`, locationId: 'belrose', owingCents: 85000, score: 3, reason: 'name matches the parent', familyRowIds: [rowId] })
const line = (id, date, cents, payer, grade, candidates = []) => ({ id, date, cents, payer, description: payer, reference: '', source: 'xero', grade, candidates })
const X1 = 'XERO-00000101-aaaa-4bbb-8ccc-000000000101', X2 = 'XERO-00000102-aaaa-4bbb-8ccc-000000000102', X3 = 'XERO-00000103-aaaa-4bbb-8ccc-000000000103'
const XB = 'XERO-00000104-aaaa-4bbb-8ccc-000000000104', XNEW = 'XERO-00000105-aaaa-4bbb-8ccc-000000000105'
const CHECKED = new Date(Date.now() - 3600000).toISOString()
// latest: the newest line's age in days. extra: lines the Mac found on a check.
const BANK = ({ latest = 5, extra = [], checkedAt = CHECKED } = {}) => ({
  sources: { xeroAt: new Date().toISOString(), xeroItems: 4, csvAt: '', csvItems: 0 },
  items: [...extra, line(X1, day(latest), 85000, 'I PARENT', 'high', [cand('p1', 'Ivy Test')]), line(X2, day(latest + 1), 42500, 'J PARENT', 'possible', [cand('p2', 'Jax Test')]), line(X3, day(latest + 2), 1234, 'Q ZANZIBARRE', 'none')],
  // From before this term: in its own fold on Money, not in the count.
  before: [line(XB, '2026-07-01', 8500, 'W OLDLINE', 'none')],
  hidden: [], counts: {},
  feed: { latestLineDate: extra.length ? extra[0].date : day(latest), status: { at: checkedAt, ok: true, latestLineDate: day(latest), count: 4 }, request: null, today: day(0) },
})
const TOTAL = 85000 + 42500 + 1234
const stamp = (iso) => new Date(iso).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
const until = async (p, ok, ms = 12000) => { const end = Date.now() + ms; while (!ok()) { if (Date.now() > end) throw new Error('timed out'); await p.settle() } }

await test('Dashboard: an admin sees one line in the header, "3 bank payments to check · A$", and no card', async () => {
  const p = await openPortal({ money: fresh(), hash: '#overview', onPost: (b) => (b.action === 'bankCheck' ? { success: true, bank: BANK({ latest: 1 }) } : null) })
  const line = p.$('#d-bank')
  assert.ok(line, 'the line is there')
  assert.ok(line.closest('.jd-head'), 'in the header, not the grid')
  assert.equal(p.$('.jd-grid #d-bank'), null)
  assert.equal(p.text('#d-bank-review'), `3 bank payments to check · ${money(TOTAL)}`)
  assert.equal(p.text('#d-bank-count'), '3', 'this term only, not the line from before it')
  assert.equal(p.text('#d-bank-total'), money(TOTAL))
  for (const id of ['#d-bank-refresh', '#d-bank-old', '#d-bank-file', '#d-bank-status']) assert.equal(p.$(id), null, `${id}: the check itself is on Money`)
  assert.equal(p.posts.filter((b) => b.action === 'bankCheck').length, 1, 'the bank read once, for the line and the badge')
  assert.ok(!/—/.test(line.innerHTML), 'no em dashes')
  assert.deepEqual(p.errors, [])
  p.close()
})

await test('the sidebar: Bank payments under Money, with the count on the usual badge', async () => {
  const p = await openPortal({ money: fresh(), hash: '#overview', onPost: (b) => (b.action === 'bankCheck' ? { success: true, bank: BANK() } : null) })
  const money_ = [...p.d.querySelectorAll('.jp-navgrp')].find((g) => g.querySelector('[data-navsec]').dataset.navsec === 'Money')
  assert.deepEqual([...money_.querySelectorAll('[data-tab]')].map((b) => b.dataset.label), ['Money', 'Bank payments', 'Payment links', 'Prices'])
  const badge = p.$('#nav [data-tab="bank"] .count')
  assert.ok(badge, 'the badge shows')
  assert.equal(badge.textContent, '3')
  assert.equal(badge.className, 'count', 'the same badge as Requests')
  // On the Dashboard the Money section is folded: its heading carries the count too.
  assert.ok(money_.classList.contains('shut'))
  assert.equal(money_.querySelector('[data-navsec] .count')?.textContent, '3')
  p.close()
  // Nothing waiting: no badge.
  const q = await openPortal({ money: fresh(), hash: '#overview', onPost: (b) => (b.action === 'bankCheck' ? { success: true, bank: { ...BANK(), items: [] } } : null) })
  assert.equal(q.$('#nav [data-tab="bank"] .count'), null)
  assert.equal(q.$('#d-bank-review'), null, 'nothing waiting: no line on the Dashboard')
  q.close()
})

await test('a coach: no line, no Bank payments in the sidebar, and the bank is never asked', async () => {
  const p = await openPortal({ money: fresh(), hash: '#overview', role: 'coach', onPost: (b) => (b.action === 'bankCheck' ? { success: true, bank: BANK() } : null) })
  assert.equal(p.$('#d-bank'), null)
  assert.equal(p.$('#nav [data-tab="bank"]'), null)
  assert.equal(p.$('#nav [data-tab="overview"]'), null, 'no dashboard for a coach')
  assert.equal(p.posts.filter((b) => /^bank/.test(b.action)).length, 0)
  p.close()
})

await test('lines over 2 days old: the amber note and CSV upload inside the open bank row on Money', async () => {
  const p = await openPortal({ money: fresh(), hash: '#bank', onPost: (b) => (b.action === 'bankCheck' ? { success: true, bank: BANK({ latest: 5 }) } : null) })
  await until(p, () => p.$('#m-bank-old'))
  assert.match(p.text('#m-bank-old'), new RegExp(`^Xero only has bank lines up to ${short(day(5))}\\. Payments appear there after they're reconciled in Xero\\. For anything newer, upload today's CommBank statement \\(CSV\\)\\.`))
  assert.ok(p.$('#m-bank-old label[for="m-bank-file"]'), 'the upload sits in the note')
  assert.equal(p.d.querySelectorAll('input[type="file"]').length, 1)
  p.close()
})

await test('Check bank now on Money: asks the Mac, waits, reads the bank again, and the row, count and badge move', async () => {
  const asked = new Date().toISOString()
  let found = false
  const p = await openPortal({
    money: fresh(), hash: '#bank',
    onPost: (b) => {
      if (b.action === 'bankCheck') return { success: true, bank: found ? BANK({ latest: 0, extra: [line(XNEW, day(0), 17000, 'N NEWPAY', 'possible', [cand('p2', 'Jax Test')])], checkedAt: new Date().toISOString() }) : BANK({ latest: 5 }) }
      if (b.action === 'bankRefresh') return { success: true, request: { at: asked }, status: null }
      // The Mac answers on the first look.
      if (b.action === 'bankRefreshStatus') { found = true; return { success: true, request: { at: asked }, status: { at: new Date(Date.parse(asked) + 1000).toISOString(), ok: true, latestLineDate: day(0), count: 5 }, done: true } }
      return null
    },
  })
  await until(p, () => p.$('#m-bank-refresh'))
  assert.equal(p.text('#m-bank-count'), '3')
  await p.click('#m-bank-refresh')
  assert.equal(p.posts.filter((b) => b.action === 'bankRefresh').length, 1, 'the request for the Mac')
  assert.equal(p.$('#m-bank-refresh').disabled, true, 'busy while it checks')
  assert.match(p.text('#m-bank-status'), /^Checking the bank… This can take up to two minutes\.$/)
  await until(p, () => p.text('.j-toast') === 'Found 1 new payment')
  assert.equal(p.text('#m-bank-count'), '4')
  assert.equal(p.text('#m-bank-total'), money(TOTAL + 17000))
  assert.match(p.text('#m-bank-status'), new RegExp(`^Checked .+ · lines to ${short(day(0))}$`))
  assert.equal(p.$('#m-bank-old'), null, 'fresh lines: the amber note goes')
  assert.equal(p.$('#m-bank-refresh').disabled, false)
  assert.equal(p.text('#m-bank-refresh'), 'Check bank now')
  assert.equal(p.text('#nav [data-tab="bank"] .count'), '4', 'the badge follows')
  assert.equal(p.text('#m-kpi-bank .val'), '4', 'the To check number follows')
  assert.deepEqual(p.errors, [])
  p.close()
})

await test('the Dashboard line opens Money with the bank row open', async () => {
  const p = await openPortal({ money: fresh(), hash: '#overview', onPost: (b) => (b.action === 'bankCheck' ? { success: true, bank: BANK() } : null) })
  await p.click('#d-bank-review')
  await until(p, () => p.$('#m-bank-box'))
  assert.equal(p.$('#m-bank-box').open, true, 'the list is open')
  assert.equal(p.$('#nav [data-tab="money"]').getAttribute('aria-current'), 'page')
  assert.deepEqual([...p.d.querySelectorAll('#m-bank [data-bank]')].map((li) => li.dataset.bank), [X1, X2, X3, XB])
  p.close()
})

await test('Money: the bank is one folded row under the player list, "Bank payments 3 to check", not at the top', async () => {
  const p = await openPortal({ money: fresh(), hash: '#money', onPost: (b) => (b.action === 'bankCheck' ? { success: true, bank: BANK({ latest: 5 }) } : null) })
  const bank = p.$('#m-bank')
  assert.ok(p.$('#m-table').compareDocumentPosition(bank) & 4, 'after the player list')
  assert.ok(p.$('#m-kpis').compareDocumentPosition(bank) & 4, 'after the numbers')
  assert.equal(bank.firstElementChild.id, 'm-bank-box')
  assert.equal(p.$('#m-bank-box').tagName, 'DETAILS')
  assert.equal(p.$('#m-bank-box').open, false, 'folded until asked')
  assert.match(p.text('#m-bank-box summary'), new RegExp(`^Bank payments 3 to check · 2 matched · checked `))
  assert.equal(p.text('#m-bank-h'), 'Bank payments')
  assert.equal(p.text('#m-bank-count'), '3')
  assert.equal(p.text('#m-bank-sum'), `${money(TOTAL)} waiting · 2 matched`)
  assert.equal(p.text('#m-bank-refresh'), 'Check bank now')
  assert.equal(p.text('#m-bank-status'), `Checked ${stamp(CHECKED)} · lines to ${short(day(5))}`)
  assert.ok(p.$('#m-bank-box #m-bank-old label[for="m-bank-file"]'), 'the amber note and upload are inside the row')
  assert.equal(p.d.querySelectorAll('input[type="file"]').length, 1, 'one upload only')
  // The To check number opens it.
  assert.equal(p.text('#m-kpi-bank .val'), '3')
  await p.click('#m-kpi-bank')
  assert.equal(p.$('#m-bank-box').open, true)
  p.close()
})

await test('the sidebar Bank payments opens Money with the list open', async () => {
  const p = await openPortal({ money: fresh(), hash: '#overview', onPost: (b) => (b.action === 'bankCheck' ? { success: true, bank: BANK() } : null) })
  await p.click('#nav [data-tab="bank"]')
  await until(p, () => p.$('#m-bank-box'))
  assert.equal(p.$('#m-bank-box').open, true)
  assert.equal(p.text('#m-bank-count'), '3')
  p.close()
  // A #bank link lands there too.
  const q = await openPortal({ money: fresh(), hash: '#bank', onPost: (b) => (b.action === 'bankCheck' ? { success: true, bank: BANK() } : null) })
  await until(q, () => q.$('#m-bank-box'))
  assert.equal(q.$('#m-bank-box').open, true)
  q.close()
})

console.log(`\n${passed} bank payments checks passed`)
