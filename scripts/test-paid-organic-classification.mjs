import assert from 'node:assert/strict'
import { classifyTrialAttribution, buildTrialCohort } from '../api/_trial-cohort.js'
import { isMetaSale, buildReconciliation, buildDailySeries } from '../api/_meta-uscreen-reconciliation.js'
const paid = { acquisition: 'exact_paid_meta', source: 'fb', medium: 'paid_social', campaign: '120249257260070035', ad: '120249785829550035' }
const organic = { acquisition: 'instagram', source: 'instagram', medium: 'organic_social' }
const cases = [
  [organic, 'meta_organic'],
  [{ acquisition: 'meta', source: 'app_instagram', medium: 'social', campaign: 'app-evergreen' }, 'meta_organic'],
  [{ acquisition: 'facebook', source: 'facebook', medium: 'social', campaign: 'holiday-sale' }, 'meta_organic'],
  [{ acquisition: 'meta', has_fbc: true }, 'unknown'],
  [{}, 'unknown'],
  [paid, 'meta_ads'],
  [{ ...paid, medium: 'organic_social' }, 'unknown'],
  [{ ...organic, first_touch: { utm_source: 'fb', utm_medium: 'paid_social', ad_id: paid.ad } }, 'meta_organic'],
]
for (const [sale, channel] of cases) {
  assert.equal(classifyTrialAttribution({ sale }).channel, channel, JSON.stringify(sale))
  assert.equal(isMetaSale(sale), channel === 'meta_ads', JSON.stringify(sale))
}
assert.equal(classifyTrialAttribution({ sale: cases[7][0] }).paid_assisted, true)
const codec = `fb__jfa1__s=fb&m=paid_social&i=${paid.campaign}&d=${paid.ad}`
assert.equal(classifyTrialAttribution({ customer: { utm_params: { utm_source: codec } } }).channel, 'meta_ads')
assert.equal(classifyTrialAttribution({ customer: { utm_params: { utm_source: 'instagram__jfa1__s=instagram&m=organic_social&i=120249257260070035' } } }).channel, 'meta_organic')
const stamp = Math.floor(Date.parse('2026-09-23T12:00:00Z') / 1000)
const window = { from: '2026-09-23', to: '2026-09-23', timezone: 'UTC' }
const invoices = cases.slice(0, 7).map((_, i) => ({ user_id: `u${i}`, status: 'paid', product_type: 'recurring', product_id: 123, trial: true, amount: 0, paid_at: stamp }))
const sales = cases.slice(0, 7).map(([sale], i) => ({ ...sale, uscreen_user_id: `u${i}` }))
const snapshots = new Map([['u8', { trial_started_at: '2026-09-23T12:00:00Z', kind: 'recurring', plan_id: 123, attribution: { channel: 'meta_ads', evidence: 'journey_ledger', source: 'instagram', medium: 'organic_social' } }]])
const cohort = buildTrialCohort({ window, invoices, sales, snapshots, now: new Date('2026-09-24T00:00:00Z') })
assert.equal(cohort.by_channel.meta_ads.trials, 1)
assert.equal(cohort.by_channel.meta_organic.trials, 4)
assert.equal(cohort.rows.find(r => r.uscreen_user_id === 'u8').attribution.channel, 'meta_organic')
const paidInvoices = cases.slice(0, 7).map((_, i) => ({ user_id: `u${i}`, status: 'paid', product_type: 'recurring', product_id: 123, amount: i === 5 ? 1499 : 3399, currency: 'USD', paid_at: stamp }))
const report = buildReconciliation({ window, meta: { purchases: 1 }, invoices: paidInvoices, sales, sourceHealth: { meta: true, uscreen: true, kv: true } })
assert.equal(report.confirmed_meta_buyers, 1)
assert.deepEqual(report.confirmed_buyer_revenue_by_currency, { USD: 14.99 })
const daily = buildDailySeries({ window, invoices: paidInvoices, sales })
assert.equal(daily[0].confirmed_meta_buyers, 1)
// A newer organic row must not be outranked by an older paid row for the same user.
const oldPaid = { ...paid, uscreen_user_id: 'u0', occurred_at: '2026-09-20T00:00:00Z' }
const newOrganic = { ...organic, uscreen_user_id: 'u0', occurred_at: '2026-09-23T00:00:00Z' }
const mixed = buildReconciliation({ window, meta: { purchases: 0 }, invoices: [paidInvoices[0]], sales: [oldPaid, newOrganic], sourceHealth: { meta: true, uscreen: true, kv: true } })
assert.equal(mixed.confirmed_meta_buyers, 0)
assert.equal(buildDailySeries({ window, invoices: [paidInvoices[0]], sales: [oldPaid, newOrganic] })[0].confirmed_meta_buyers, 0)
const renewal = buildReconciliation({ window, meta: { purchases: 1 }, invoices: [paidInvoices[5]], sales: [{ ...paid, uscreen_user_id: 'u5', kind: 'renewal' }], sourceHealth: { meta: true, uscreen: true, kv: true } })
assert.equal(renewal.renewal_meta_buyers, 1)
assert.equal(renewal.verified_first_payment_meta_buyers, 0)
assert.equal(renewal.verdict, 'AMBER')
console.log('paid/organic attribution regression passed')
