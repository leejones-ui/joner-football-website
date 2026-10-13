// Joners Juniors in the portal, stage 1: the Money download and the
// Dashboard's "needs you" list. Invented data only. See also
// test-jj-settings.mjs, test-jj-money.mjs, test-jj-ui.mjs and test-jj-flow.mjs.
//   node scripts/test-jj.mjs
import assert from 'node:assert/strict'
import { juniorsMoney } from '../api/_jfp-juniors-money.js'
import { needsList } from '../api/_jj-portal.js'
import { juniorsCsv } from '../src/scripts/jfp-portal-juniors.js'

let passed = 0
const test = async (name, fn) => { await fn(); passed += 1; console.log(`ok - ${name}`) }

const row = (id, x = {}) => ({ id, table: 'tblT', term: 'Term 4 2026', player: `Kid ${id}`, parent: 'P', emails: [`${id}@example.com`], location: 'Belrose HQ', session: 'Saturday 9:15am', feeCents: 22000, status: 'Unpaid', paidVia: '', paidAt: '', sessionId: '', intentId: '', linkUrl: '', registrationId: '', removed: null, ...x })
const pay = (id, x = {}) => ({ id, intentId: `pi_${id}`, paid: true, email: '', amountCents: 22000, refundedCents: 0, currency: 'aud', at: '2026-10-14T00:00:00Z', link: '', tagged: false, found: ['test'], feeKnown: true, feeCents: 460, feeGstCents: 42, payMethod: 'card', ...x })

await test('the download: summary, every child and every payment, no emails, formulas made safe', () => {
  const rows = [row('d1', { player: '=Kid One', sessionId: 'cs_d1' }), row('d2')]
  const ledger = [{ id: 'JJ-CASH-9', term: 'Term 4 2026', method: 'Cash', date: '2026-10-17', cents: 5000, shares: [{ rowId: 'd2', cents: 5000 }] }]
  const m = juniorsMoney(rows, { sessions: [pay('cs_d1')], links: {} }, { ledger })
  const csv = juniorsCsv(m, 'Term 4 2026')
  assert.match(csv, /^Joners Juniors money,Term 4 2026/)
  assert.match(csv, /Collected \(after refunds\),270\.00/)
  assert.match(csv, /Kept after Stripe fees,265\.40/)
  assert.match(csv, /'=Kid One/, 'a name that looks like a formula stays text')
  assert.match(csv, /Stripe \(Card\),'=Kid One,220\.00,0\.00,4\.60,0\.42,215\.40/)
  assert.match(csv, /Cash,Kid d2,50\.00,0\.00,0\.00,0\.00,50\.00,JJ-CASH-9/)
  assert.ok(!csv.includes('@example.com'))
})

await test('needs you: unpaid, waivers, Stripe not in Airtable, unmatched, full, closed', () => {
  const o = { current: true, moneyError: '', waiversUnknown: false, counts: { all: 12, paid: 8, part: 1, unpaid: 2, noprice: 1, noWaiver: 3, removed: 0 }, summary: { enrolled: 12, capacity: 12, owingCents: 56000, paidInStripeOnly: 1, unverified: 1, unlinkedCount: 2, unlinkedCents: 44000 } }
  const kinds = needsList(o, { registrationOpen: false }).map((n) => n.kind)
  assert.deepEqual(kinds, ['unpaid', 'part', 'waiver', 'stripe', 'unverified', 'unlinked', 'noprice', 'full', 'closed'])
  assert.match(needsList(o, { registrationOpen: true })[0].label, /2 children have not paid \(A\$560 owing\)/)
})

console.log(`\n${passed} Joners Juniors portal checks passed`)
