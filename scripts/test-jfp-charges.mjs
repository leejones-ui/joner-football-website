// Player charges, invoices and Match to player: the pure parts (14 Oct 2026).
// Every name, email and amount here is invented.
import assert from 'node:assert/strict'
import { chargeInput, chargePayreq, chargeStatus, extraMoneyView, chargeCheckoutMeta, chargeProgramme } from '../api/_jfp-charges.js'
import { cleanLines, invoiceInput, invoiceStatus, gstOf, publicInvoice, invoiceCheckoutBody, bankReference, openForBank, owingOf } from '../api/_jfp-invoices.js'
import { invoiceRefOf, invoiceMatch, matchBank } from '../api/_jfp-bank-match.js'
import { ruleFor, rememberKey, matchInput } from '../api/_jfp-stripe-match.js'
import { quickLinkInput, quickCheckoutBody, playerMeta } from '../api/_jfp-quick.js'
import { classifySession } from '../api/_jfp-stripe.js'
import { normaliseConfig, cleanInvoiceSettings } from '../api/_jfp-store.js'
import { feesView } from '../api/_jfp-account-fees.js'

let passed = 0
async function test(name, fn) { await fn(); passed += 1; console.log(`ok - ${name}`) }
const config = normaliseConfig({})

await test('a quick link names its player, or says why not; the player rides on the Stripe page', () => {
  const t = { today: '2026-10-14', requirePlayer: true }
  const no = quickLinkInput({ amountCents: 12000, forText: 'Extra session', programme: 'extra' }, t)
  assert.deepEqual([no.ok, no.code], [false, 'player'])
  assert.equal(quickLinkInput({ amountCents: 12000, forText: 'x', programme: 'other', noPlayerReason: 'ab' }, t).ok, false, 'a reason needs a few letters')
  const why = quickLinkInput({ amountCents: 1500, forText: 'Raffle', programme: 'other', noPlayerReason: 'Raffle ticket' }, t)
  assert.equal(why.link.noPlayerReason, 'Raffle ticket')
  const row = { id: 'recAAA', player: 'Tess Example', parent: 'Pat Example', email: 'pat@example.com', groupId: '' }
  const l = quickLinkInput({ amountCents: 12000, forText: 'Extra session', programme: 'extra' }, { ...t, row }).link
  assert.deepEqual([l.term4Ids, l.rowId, l.playerNames], [[], 'recAAA', ['Tess Example']], 'an Extra sessions link never writes the term row')
  const b = quickCheckoutBody({ ...l, id: 'PAY-1791853923170-676C2E' }, 'https://x.test', Date.parse('2026-10-14T00:00:00Z'))
  assert.equal(b['line_items[0][price_data][product_data][name]'], 'Joner Football: Extra session (Tess Example)')
  assert.deepEqual([b['metadata[jfpPlayer]'], b['metadata[jfpRowIds]'], b['payment_intent_data[metadata][jfpPlayer]'], b['metadata[jfpProgramme]']], ['Tess Example', 'recAAA', 'Tess Example', 'extra'])
  assert.equal(classifySession({ metadata: { jfpBookingId: 'PAY-1', jfpProgramme: 'extra' } }), 'other', 'Extra sessions is never JFP term income')
  assert.deepEqual(playerMeta({ playerNames: [], term4Ids: [] }), {})
})

await test('a charge: checked input, a payment request with no Term 4 row, the player and its program on Stripe', () => {
  assert.match(chargeInput({ amountCents: 50 }, config).error, /A\$1 to A\$20,000/)
  assert.match(chargeInput({ amountCents: 5000 }, config).error, /Say which player/)
  assert.match(chargeInput({ amountCents: 5000, rowId: 'recA', kind: 'party' }, config).error, /kind/)
  assert.match(chargeInput({ amountCents: 5000, rowId: 'recA', coachId: 'nobody' }, config).error, /coach/)
  assert.match(chargeInput({ amountCents: 5000, rowId: 'recA', sessionDate: '14/10' }, config).error, /date/)
  const v = chargeInput({ amountCents: 9000, rowId: 'recA', sessionDate: '2026-10-18', coachId: config.coaches[0].id, ref: 'extra:SLOT1:B1' }, config).v
  assert.deepEqual([v.kind, v.programme, v.label, v.coachId], ['extra', 'extra', 'Extra session, 2026-10-18', config.coaches[0].id])
  assert.equal(chargeProgramme('invoice', 'jfp'), 'other', 'a charge is never a term fee')
  assert.equal(chargeProgramme('analysis'), 'extra')
  const c = { id: 'CHG-1791853923170-676C2E', kind: 'extra', programme: 'extra', label: 'Extra session, Sat', amountCents: 9000, playerName: 'Tess Example', email: 'pat@example.com', parentName: 'Pat Example', rowId: 'recA', payments: [] }
  const q = chargePayreq(c, { principal: { email: 'staff@example.com' } })
  assert.deepEqual([q.reason, q.term4Ids, q.chargeRowIds, q.amountCents, q.programme, q.playerKeys], ['charge', [], ['recA'], 9000, 'extra', ['tessexample']])
  const meta = chargeCheckoutMeta({ ...q, id: 'PAY-1' })
  assert.deepEqual([meta['metadata[jfpProgramme]'], meta['metadata[jfpCharge]'], meta['metadata[jfpPlayer]'], meta['metadata[jfpRowIds]'], meta['payment_intent_data[metadata][jfpProgramme]']], ['extra', c.id, 'Tess Example', 'recA', 'extra'])
  // A JFP row link: the player and rows, and nothing that changes how it is counted.
  const row = chargeCheckoutMeta({ playerNames: ['Sam Sample'], term4Ids: ['recB'] })
  assert.deepEqual(row, { 'metadata[jfpPlayer]': 'Sam Sample', 'payment_intent_data[metadata][jfpPlayer]': 'Sam Sample', 'metadata[jfpRowIds]': 'recB', 'payment_intent_data[metadata][jfpRowIds]': 'recB' })
  assert.equal(chargeStatus({ ...c, payments: [{ cents: 4000 }] }), 'part')
  assert.equal(chargeStatus({ ...c, payments: [{ cents: 9000 }] }), 'paid')
  assert.equal(chargeStatus({ ...c, status: 'cancelled' }), 'cancelled')
})

await test('Money > Extra sessions: taken, fees and kept, by coach, by month, by player; what is still to pay', () => {
  const ch = (id, coachId, coachName, payments, amountCents = 9000, extra = {}) => ({ id, kind: 'extra', programme: 'extra', label: 'Extra session', amountCents, playerName: `Player ${id}`, rowId: `rec${id}`, coachId, coachName, payments, createdAt: '2026-10-01T00:00:00Z', ...extra })
  const charges = [
    ch('A', 'dean', 'Coach D', [{ id: 'pi_1', method: 'stripe', cents: 9000, feeCents: 200, date: '2026-10-05', payreqId: 'PAY-A' }]),
    ch('B', 'dean', 'Coach D', [{ id: 'BANK-1', method: 'bank', cents: 9000, feeCents: 0, date: '2026-09-28' }]),
    ch('C', 'sam', 'Coach S', [{ id: 'pi_3', method: 'stripe', cents: 4000, feeCents: null, date: '2026-10-07', payreqId: 'PAY-C' }]),
    ch('D', '', '', [], 5000),
    ch('E', '', '', [], 5000, { status: 'cancelled' }),
    { ...ch('F', '', '', [{ id: 'x', method: 'cash', cents: 100, date: '2026-10-01' }]), programme: 'other' },
  ]
  const payreqs = [{ id: 'PAY-A', refundedCents: 1000 }, { id: 'PAY-Q', quick: true, programme: 'extra', status: 'paid', paidCents: 3000, amountCents: 3000, stripeFeeCents: 80, paidAt: '2026-10-08T01:00:00Z', playerNames: [], payerName: 'Q Payer', forText: 'Extra', stripePaymentIntentId: 'pi_q' }]
  const v = extraMoneyView({ charges, payreqs })
  assert.deepEqual([v.totals.count, v.totals.takenCents, v.totals.refundedCents, v.totals.feeCents, v.totals.keptCents, v.totals.feesPending], [4, 25000, 1000, 280, 23720, 1])
  assert.deepEqual([v.totals.owingCents, v.totals.openCount], [5000 + 5000, 2], 'D unpaid and C part paid; cancelled and Other are not here')
  assert.deepEqual(v.byCoach.map((c) => [c.label, c.count, c.keptCents]), [['Coach D', 2, 9000 - 1000 - 200 + 9000], ['Coach S', 1, 4000], ['No coach named', 1, 2920]])
  assert.deepEqual(v.byMonth.map((m) => [m.id, m.count]), [['2026-10', 3], ['2026-09', 1]])
  assert.equal(v.toCheck.length, 1, 'a paid Extra quick link with no player waits to be checked')
  const oct = extraMoneyView({ charges, payreqs, month: '2026-09' })
  assert.deepEqual([oct.month, oct.totals.count, oct.totals.takenCents], ['2026-09', 1, 9000])
})

await test('invoices: lines, GST included (one eleventh), statuses, and what the family page shows', () => {
  assert.match(cleanLines([]).error, /at least one line/)
  assert.match(cleanLines([{ description: '', qty: 1, unitCents: 100 }]).error, /Line 1: say what it is for/)
  assert.match(cleanLines([{ description: 'x', qty: 0, unitCents: 100 }]).error, /quantity/)
  assert.match(cleanLines([{ description: 'x', qty: 1, unitCents: 50 }]).error, /at least A\$1/)
  const l = cleanLines([{ description: 'Term 4 small group', qty: 1, unitCents: 85000 }, { description: 'Extra session', qty: 2, unitCents: 9000 }])
  assert.deepEqual([l.totalCents, gstOf(l.totalCents)], [103000, 9364])
  const rows = [{ id: 'recA', player: 'Tess Example', parent: 'Pat Example', email: 'pat@example.com' }]
  assert.match(invoiceInput({ programme: 'jfp', lines: [{ description: 'x', qty: 1, unitCents: 100 }], playerName: 'Someone' }, {}).error, /choose the player from the list/)
  assert.match(invoiceInput({ programme: 'camps', lines: [] }, { rows }).error, /Pick the program/)
  const v = invoiceInput({ programme: 'jfp', lines: [{ description: 'Term 4', qty: 1, unitCents: 85000 }], dueDate: '2026-10-31' }, { rows, today: '2026-10-14' }).v
  assert.deepEqual([v.email, v.parentName, v.players, v.gstCents, v.issueDate], ['pat@example.com', 'Pat Example', [{ rowId: 'recA', name: 'Tess Example' }], 7727, '2026-10-14'])
  const inv = { id: 'INV-1004', number: 1004, token: 'x'.repeat(32), ...v, payments: [] }
  assert.equal(invoiceStatus(inv), 'draft')
  assert.equal(invoiceStatus({ ...inv, issuedAt: 'x' }), 'sent')
  assert.equal(invoiceStatus({ ...inv, issuedAt: 'x' }, 'y'), 'viewed')
  assert.equal(invoiceStatus({ ...inv, issuedAt: 'x', payments: [{ cents: 100 }] }), 'part')
  assert.equal(invoiceStatus({ ...inv, issuedAt: 'x', payments: [{ cents: 85000 }] }), 'paid')
  assert.equal(invoiceStatus({ ...inv, voidedAt: 'x' }), 'void')
  // No bank details saved: none shown, no ABN; saved but bank transfer not
  // switched on (Lee, 16 Oct 2026: not yet): still none; switched on: shown, with the reference.
  let pub = publicInvoice({ ...inv, issuedAt: 'x' }, config)
  assert.deepEqual([pub.bank, pub.business.abn, pub.gstLabel, pub.canPayCard], [null, undefined, 'A$77.27', true])
  const savedOff = normaliseConfig({ invoice: { accountName: 'Example Trust', bsb: '062-000', accountNumber: '1234 5678', abn: '12 345 678 901' } })
  assert.deepEqual([publicInvoice({ ...inv, issuedAt: 'x' }, savedOff).bank, publicInvoice({ ...inv, issuedAt: 'x' }, savedOff).business.abn], [null, '12 345 678 901'])
  const withBank = normaliseConfig({ invoice: { accountName: 'Example Trust', bsb: '062-000', accountNumber: '1234 5678', abn: '12 345 678 901', bankEnabled: true } })
  pub = publicInvoice({ ...inv, issuedAt: 'x' }, withBank)
  assert.deepEqual([pub.bank.bsb, pub.bank.accountNumber, pub.bank.reference, pub.business.abn], ['062-000', '12345678', 'INV-1004 Tess', '12 345 678 901'])
  assert.equal(bankReference(withBank, inv), 'INV-1004 Tess')
  assert.deepEqual(cleanInvoiceSettings({ bsb: '12', accountNumber: '1', reference: 'no number' }), { accountName: '', bsb: '', accountNumber: '', reference: 'INV-<n> <player>', abn: '', bankEnabled: false, attachPdf: true })
  assert.ok(!JSON.stringify(pub).includes('createdBy'), 'no staff names')
  assert.equal(publicInvoice(inv, config).canPayCard, false, 'a draft cannot be paid')
})

await test('the invoice Stripe page: each line, the invoice, the player and the payment request; a charge keeps its program', () => {
  const inv = { id: 'INV-1005', number: 1005, token: 't'.repeat(32), email: 'pat@example.com', players: [{ rowId: 'recA', name: 'Tess Example' }], lines: [{ description: 'Extra session', qty: 2, unitCents: 9000, totalCents: 18000 }], totalCents: 18000, payments: [] }
  const q = { id: 'PAY-9', amountCents: 18000, charge: { id: 'CHG-1', kind: 'invoice' }, programme: 'extra', playerNames: ['Tess Example'], term4Ids: [], chargeRowIds: ['recA'] }
  const b = invoiceCheckoutBody(inv, q, 'https://x.test', 0)
  assert.deepEqual([b['line_items[0][quantity]'], b['line_items[0][price_data][unit_amount]'], b['line_items[0][price_data][product_data][name]']], ['2', '9000', 'INV-1005: Extra session (Tess Example)'])
  assert.deepEqual([b['metadata[jfpBookingId]'], b['metadata[jfpInvoice]'], b['metadata[jfpProgramme]'], b['metadata[jfpPlayer]'], b['payment_intent_data[metadata][jfpBookingId]']], ['PAY-9', 'INV-1005', 'extra', 'Tess Example', 'PAY-9'])
  const part = invoiceCheckoutBody({ ...inv, payments: [{ cents: 5000 }] }, { ...q, amountCents: 13000 }, 'https://x.test', 0)
  assert.deepEqual([part['line_items[0][price_data][unit_amount]'], part['line_items[1][quantity]']], ['13000', undefined])
  const jfp = invoiceCheckoutBody(inv, { id: 'PAY-8', amountCents: 18000, term4Ids: ['recA'], playerNames: ['Tess Example'] }, 'https://x.test', 0)
  assert.equal(jfp['metadata[jfpProgramme]'], undefined, 'a JFP invoice stays JFP')
  assert.equal(classifySession({ metadata: { jfpBookingId: 'PAY-8', jfpInvoice: 'INV-1005' } }), 'jfp')
})

await test('Bank transfers to check: an INV- reference finds its open invoice, however the bank writes it', () => {
  assert.equal(invoiceRefOf({ reference: 'INV-1004 Tess' }), 'INV-1004')
  assert.equal(invoiceRefOf({ description: 'Transfer from P Example inv1004' }), 'INV-1004')
  assert.equal(invoiceRefOf({ description: 'INV 1004' }), 'INV-1004')
  assert.equal(invoiceRefOf({ description: 'INVOICE PAID' }), '')
  const invoices = openForBank([
    { id: 'INV-1004', number: 1004, issuedAt: 'x', totalCents: 85000, payments: [], players: [{ name: 'Tess Example' }], programme: 'jfp' },
    { id: 'INV-1006', number: 1006, issuedAt: 'x', totalCents: 9000, payments: [{ cents: 9000 }], players: [{ name: 'Paid Up' }], programme: 'extra' },
    { id: 'INV-1007', number: 1007, totalCents: 9000, payments: [], players: [{ name: 'Draft Only' }], programme: 'extra' },
  ])
  assert.deepEqual(invoices.map((x) => x.id), ['INV-1004'], 'paid and draft invoices are not matched')
  assert.deepEqual([invoiceMatch({ reference: 'INV-1004', cents: 85000 }, invoices).exact, invoiceMatch({ reference: 'INV-1004', cents: 40000 }, invoices).exact], [true, false])
  const item = { id: 'XERO-00000001-aaaa-4bbb-8ccc-000000000009', date: '2026-10-13', cents: 85000, payer: 'Q Nobody', description: 'Q Nobody', reference: 'INV-1004 Tess', source: 'xero' }
  const r = matchBank({ items: [item], players: [], invoices })
  assert.deepEqual([r.items.length, r.items[0].grade, r.items[0].invoice.id], [1, 'high', 'INV-1004'], 'shown, though nobody on the term has that name')
  assert.equal(matchBank({ items: [{ ...item, reference: '' }], players: [], invoices }).items.length, 0)
})

await test('Match to player: remembered by payment link first, then email', () => {
  const rules = { 'link:plink_x': { rowIds: ['recA'], as: 'extra' }, 'email:pat@example.com': { rowIds: ['recB'], as: 'jfp' } }
  assert.equal(ruleFor(rules, { linkId: 'plink_x', email: 'pat@example.com' }).key, 'link:plink_x')
  assert.equal(ruleFor(rules, { linkId: 'plink_y', email: 'PAT@example.com' }).key, 'email:pat@example.com')
  assert.equal(ruleFor(rules, { linkId: '', email: 'other@example.com' }), null)
  assert.deepEqual([rememberKey({ linkId: '' }, 'link'), rememberKey({ email: 'a@example.com' }, 'email')], ['', 'email:a@example.com'])
  assert.deepEqual(matchInput({ paymentId: 'cs_1', rowId: 'recA', as: 'bogus', remember: 'forever' }), { paymentId: 'cs_1', as: 'jfp', remember: '', rowIds: ['recA'], label: '' })
})

await test('My account > Fees: a paid charge says its own program and label; paid by bank says so', () => {
  const v = feesView({ config, emails: ['pat@example.com'], payreqs: [
    { id: 'PAY-1', status: 'paid', email: 'pat@example.com', charge: { id: 'CHG-1' }, programme: 'extra', groupLabel: 'Extra session, Sat', playerNames: ['Tess Example'], paidCents: 9000, paidAt: '2026-10-12T01:00:00Z' },
    { id: 'PAY-2', status: 'paid', email: 'pat@example.com', charge: { id: 'CHG-2' }, programme: 'other', groupLabel: 'Invoice INV-1004', invoiceId: 'INV-1004', playerNames: ['Tess Example'], paidCents: 5000, paidAt: '2026-10-13T01:00:00Z', paidOffline: true, paidMethod: 'bank' },
    { id: 'PAY-3', status: 'paid', email: 'pat@example.com', invoiceId: 'INV-1005', term4Ids: ['recA'], playerNames: ['Tess Example'], paidCents: 85000, paidAt: '2026-10-13T01:00:00Z', paidOffline: true, paidMethod: 'bank' },
  ] })
  assert.deepEqual(v.records.map((r) => [r.id, r.programme, r.what, r.method]), [['PAY-2', 'Joner Football', 'Invoice INV-1004', 'Bank transfer'], ['PAY-1', 'Extra sessions', 'Extra session, Sat', 'Card']], 'a JFP invoice paid by bank shows by its ledger line, never twice')
})

console.log(`\n${passed} charges and invoices checks passed`)
