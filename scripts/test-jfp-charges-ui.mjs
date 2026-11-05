// Money > Extra sessions, Money > Invoices and Match to player, in jsdom
// (14 Oct 2026). Every name and amount here is invented.
import assert from 'node:assert/strict'
import { openPortal } from './jfp-portal-dom.mjs'
import { extraMoneyView } from '../api/_jfp-charges.js'
import { publicInvoice, invoiceRow } from '../api/_jfp-invoices.js'
import { normaliseConfig } from '../api/_jfp-store.js'

let passed = 0
async function test(name, fn) { await fn(); passed += 1; console.log(`ok - ${name}`) }
const setValue = (p, sel, v, ev = 'input') => { const el = p.$(sel); el.value = v; el.dispatchEvent(new p.w.Event(ev, { bubbles: true })) }
const config = normaliseConfig({})

const CHARGES = [
  { id: 'CHG-1791853923170-AAAAAA', kind: 'extra', programme: 'extra', label: 'Extra session, Sat', amountCents: 9000, playerName: 'Ivy Test', rowId: 'p1', coachId: 'dean', coachName: 'Coach D', sessionDate: '2026-10-18', payments: [{ id: 'pi_1', method: 'stripe', cents: 9000, feeCents: 200, date: '2026-10-12' }], createdAt: '2026-10-10T00:00:00Z' },
  { id: 'CHG-1791853923170-BBBBBB', kind: 'analysis', programme: 'extra', label: 'Video analysis', amountCents: 5000, playerName: 'Max Sample', rowId: 'p2', payments: [], createdAt: '2026-10-11T00:00:00Z' },
]
const EXTRA = { ...extraMoneyView({ charges: CHARGES, payreqs: [] }), at: '2026-10-14T02:00:00.000Z' }
const BOARD = { groups: [{ id: 'g1', day: 'Monday', time: '4:20pm', players: [{ rowId: 'p1', name: 'Ivy Test', parent: 'Pat Test', email: 'pat@example.com' }] }], unassigned: [] }
const PRICING = { success: true, priceList: [{ id: 'PR-1-AAAAAA', name: 'Extra session', cents: 9000, amountLabel: 'A$90', programme: 'extra', archived: false }], programmes: [], holidayPeriods: [], products: [] }

await test('Extra sessions: taken, fees and kept, still to pay, by coach; New charge posts the player, amount and a ref', async () => {
  const p = await openPortal({ hash: '#money?programme=extra', onPost: (b) => (b.action === 'extraMoney' ? { success: true, extra: EXTRA } : b.action === 'board' ? { success: true, ...BOARD } : b.action === 'pricing' ? PRICING : b.action === 'me' ? { success: true, coaches: [{ id: 'dean', name: 'Coach D' }] } : b.action === 'createCharge' ? { success: true, charge: { player: 'Ivy Test', amountCents: 9000 }, payreqId: 'PAY-1' } : null) })
  assert.equal(p.$('#m-prog').value, 'extra')
  assert.match(p.text('#x-tiles'), /^KeptA\$88Taken A\$90.*RefundedA\$0.*Stripe feesA\$2.*Still to payA\$50/)
  assert.match(p.text('#x-open'), /Max Sample.*Video analysis/)
  assert.match(p.text('#x-coach'), /Coach D.*1.*A\$90.*A\$2.*A\$88/)
  await p.click('#x-new')
  setValue(p, '#ch-q', 'ivy')
  await p.settle()
  await p.click('#ch-res [data-i="0"]')
  await p.pick('#ch-price', 'PR-1-AAAAAA')
  assert.equal(p.$('#ch-amt').value, '90')
  await p.pick('#ch-coach', 'dean')
  await p.click('#ch-go')
  const post = p.posts.find((b) => b.action === 'createCharge')
  assert.deepEqual([post.rowId, post.amountCents, post.kind, post.coachId, post.label], ['p1', 9000, 'extra', 'dean', 'Extra session'])
  assert.match(post.ref, /^\d+-[a-z0-9]+$/, 'a ref, so a double tap makes one charge')
  assert.deepEqual(p.errors, [])
  p.close()
})

const INV = { id: 'INV-1004', number: 1004, token: 'x'.repeat(32), programme: 'jfp', email: 'pat@example.com', parentName: 'Pat Test', players: [{ rowId: 'p1', name: 'Ivy Test' }], lines: [{ description: 'Term 4', qty: 1, unitCents: 85000, totalCents: 85000 }], totalCents: 85000, gstCents: 7727, issueDate: '2026-10-14', dueDate: '2026-10-31', notes: '', payments: [], createdAt: '2026-10-14T00:00:00Z', createdBy: 'staff@example.com' }
const detail = (inv) => ({ success: true, invoice: invoiceRow(inv, { base: 'http://localhost' }), view: publicInvoice(inv, config), email: { to: inv.email, subject: `Invoice ${inv.id} from Joner Football`, html: '<p>hi</p>' } })

await test('Invoices: the list with filters, New invoice from Prices with the GST shown, then the invoice as the family sees it', async () => {
  const sent = { ...INV, id: 'INV-1003', number: 1003, issuedAt: '2026-10-13T00:00:00Z' }
  const p = await openPortal({ hash: '#money?programme=invoices', onPost: (b) => (b.action === 'invoiceList' ? { success: true, invoices: [invoiceRow(INV), invoiceRow(sent)], counts: { all: 2, draft: 1, sent: 1, viewed: 0, part: 0, paid: 0, void: 0, overdue: 0 }, owingCents: 170000 } : b.action === 'board' ? { success: true, ...BOARD } : b.action === 'pricing' ? PRICING : b.action === 'invoiceSave' ? detail(INV) : b.action === 'invoiceGet' ? detail(INV) : null) })
  assert.equal(p.$('#m-prog').value, 'invoices')
  assert.equal(p.d.querySelectorAll('#iv-rows tr').length, 2)
  await p.click('[data-ivf="draft"]')
  assert.equal(p.d.querySelectorAll('#iv-rows tr').length, 1)
  await p.click('#iv-new')
  setValue(p, '#ivp-q', 'ivy')
  await p.settle()
  await p.click('#ivp-res [data-i="0"]')
  assert.equal(p.$('#iv-email').value, 'pat@example.com')
  await p.pick('#iv-fromprice', 'PR-1-AAAAAA')
  assert.match(p.text('#iv-total'), /Total A\$90 \(includes GST of A\$8\.18\)/)
  await p.pick('#iv-prog', 'extra')
  await p.click('#iv-save')
  const post = p.posts.find((b) => b.action === 'invoiceSave')
  assert.deepEqual([post.programme, post.rowIds, post.lines], ['extra', ['p1'], [{ description: 'Extra session', qty: 1, unitCents: 9000 }]])
  assert.match(p.text('.ji-doc'), /Tax invoice.*INV-1004.*Includes GST of.*A\$77\.27/)
  assert.ok(p.$('[data-iv="email"]') && p.$('[data-iv="ready"]'), 'Send and Mark ready on a draft')
  assert.deepEqual(p.errors, [])
  p.close()
})

await test('Match to player: pick the player, an extra session, remember the payment link', async () => {
  const money = { since: '2026-09-14', stripeError: '', term: 'Term 4 2026', prices: {}, venueTerms: ['Term 4 2026'], kpis: { incomeCents: 0, stripeCents: 0, netIncomeCents: 0, owingCents: 0, feesByMethod: [] }, unlinked: { cents: 0, items: [] }, status: { paid: 0, stripe: 0, part: 0, unpaid: 0, unpriced: 0, session: 0 }, weekly: [], weeklyByVenue: {}, payments: [], nextTermPayments: [], locations: [], players: [{ rowId: 'p1', player: 'Ivy Test', parent: 'Pat Test', email: 'pat@example.com', familyKey: 'pat@example.com', group: 'Monday 4:20pm', status: 'paid', feeCents: 0, paidCents: 0, owingCents: 0, unledgeredCents: 0 }], unmatched: [{ id: 'cs_x', at: '2026-10-13T01:00:00Z', name: 'Q Payer', email: 'q@example.com', cents: 12000, product: '1 on 1 session', linkId: 'plink_x' }] }
  const p = await openPortal({ money, hash: '#money', onPost: (b) => (b.action === 'stripeMatch' ? { success: true } : null) })
  await p.click('#m-unmatched summary')
  await p.click('[data-match="cs_x"]')
  setValue(p, '#mt-q', 'ivy')
  await p.click('[data-pick="p1"]')
  await p.pick('#mt-as', 'extra')
  assert.equal(p.$('#mt-rem').value, 'link')
  await p.click('#mt-go')
  const post = p.posts.find((b) => b.action === 'stripeMatch')
  assert.deepEqual([post.paymentId, post.rowIds, post.as, post.remember], ['cs_x', ['p1'], 'extra', 'link'])
  assert.deepEqual(p.errors, [])
  p.close()
})

await test('Extra sessions: a refund drops Kept, shows Refunded, and Everything counts Extra sessions after refunds (5 Nov 2026)', async () => {
  const charges = [{ ...CHARGES[0], payments: [{ ...CHARGES[0].payments[0], payreqId: 'PAY-1' }] }]
  const v = { ...extraMoneyView({ charges, payreqs: [{ id: 'PAY-1', refundedCents: 8500 }] }), at: '2026-10-14T02:00:00.000Z' }
  assert.deepEqual([v.totals.takenCents, v.totals.refundedCents, v.totals.keptCents], [9000, 8500, 300])
  const p = await openPortal({ hash: '#money?programme=extra', onPost: (b) => (b.action === 'extraMoney' ? { success: true, extra: v } : { success: true }) })
  assert.match(p.text('#x-tiles'), /^KeptA\$3Taken A\$90.*RefundedA\$85Back to families/)
  assert.match(p.text('#x-coach'), /Coach D.*A\$90.*A\$85.*A\$2.*A\$3/)
  assert.match(p.text('#x-lines'), /paid A\$90, refunded A\$85/)
  p.close()
  const { FIGURES } = await import('../src/scripts/jfp-portal-everything.js')
  assert.deepEqual(FIGURES.extra(v, 2026), { takenCents: 500, keptCents: 300, note: '1 payment' })
  assert.equal(FIGURES.extra(v, 2025), null)
})

await test('Extra sessions: Refund starts at paid less A$5, needs a second tap, then posts the amount (5 Nov 2026)', async () => {
  const charges = [{ ...CHARGES[0], amountCents: 12000, payments: [{ ...CHARGES[0].payments[0], cents: 12000, payreqId: 'PAY-2' }] }]
  const v = { ...extraMoneyView({ charges, payreqs: [{ id: 'PAY-2', refundedCents: 0 }] }), at: '2026-10-14T02:00:00.000Z' }
  const p = await openPortal({ hash: '#money?programme=extra', onPost: (b) => (b.action === 'extraMoney' ? { success: true, extra: v } : b.action === 'refundRoom' ? { success: true, paidCents: 12000, refundedCents: 0, roomCents: 12000, suggestCents: 11500 } : b.action === 'refundPayment' ? { success: true, ok: true, refundId: 're_1' } : { success: true }) })
  await p.click('#x-lines [data-xrefund="PAY-2"]')
  await p.settle()
  assert.equal(p.$('#rf-amt').value, '115')
  await p.click('#rf-go')
  assert.equal(p.posts.filter((b) => b.action === 'refundPayment').length, 0, 'the first tap only asks')
  assert.match(p.$('#rf-go').textContent, /Yes, refund A\$115/)
  setValue(p, '#rf-amt', '200')
  await p.click('#rf-go')
  assert.match(p.text('#rf-err'), /Only A\$120/)
  setValue(p, '#rf-amt', '110')
  await p.click('#rf-go'); await p.click('#rf-go')
  await p.settle()
  const post = p.posts.find((b) => b.action === 'refundPayment')
  assert.deepEqual([post.payreqId, post.amountCents], ['PAY-2', 11000])
  assert.deepEqual(p.errors, [])
  p.close()
})

await test('Whole term: JFP fees, Joners Juniors this term and Extra sessions since the term started, after refunds', async () => {
  const { wholeTerm, wholeTermHtml } = await import('../src/scripts/jfp-portal-wholeterm.js')
  const juniors = { currentTerm: 'Term 4 2026', byTerm: { 'Term 4 2026': { collectedCents: 300000 }, 'Term 3 2026': { collectedCents: 999 } } }
  const extra = { lines: [{ paidDate: '2026-11-01', takenCents: 12000, refundedCents: 11500 }, { paidDate: '2026-10-20', takenCents: 9000, refundedCents: 0 }, { paidDate: '2026-08-01', takenCents: 5000, refundedCents: 0 }] }
  const w = wholeTerm({ jfpCents: 8512600, since: '2026-09-14T00:00:00.000Z', juniors, extra })
  assert.equal(w.totalCents, 8512600 + 300000 + 500 + 9000)
  assert.deepEqual(w.waiting, [])
  const first = wholeTerm({ jfpCents: 8512600, since: '2026-09-14' })
  assert.deepEqual([first.totalCents, first.waiting], [8512600, ['Joners Juniors', 'Extra sessions']])
  const failed = wholeTerm({ jfpCents: 100, since: '', juniors: null, extra })
  assert.deepEqual(failed.failed, ['Joners Juniors'])
  assert.match(wholeTermHtml(failed), /Joners Juniors could not be read just now, so not counted/)
})

console.log(`\n${passed} charges and invoices page checks passed`)
