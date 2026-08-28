import assert from 'node:assert/strict'
import handler from '../api/meta-uscreen-reconciliation.js'
import { addPhaseTwoThree, buildReconciliation, extractActionCount, previousWindow, resolveWindow } from '../api/_meta-uscreen-reconciliation.js'

assert.deepEqual(resolveWindow({ from: '2026-08-26', to: '2026-08-27' }), {
  from: '2026-08-26', to: '2026-08-27', timezone: 'UTC',
})
assert.throws(() => resolveWindow({ from: '2026-08-01', to: '2026-09-01' }), /31 days/)
// Alias action types are the SAME purchases reported three ways. They must
// never be summed: use the best single alias only.
assert.equal(extractActionCount([
  { action_type: 'purchase', value: '2' },
  { action_type: 'offsite_conversion.fb_pixel_purchase', value: '3' },
  { action_type: 'link_click', value: '999' },
]), 3)
assert.equal(extractActionCount([
  { action_type: 'purchase', value: '47' },
  { action_type: 'offsite_conversion.fb_pixel_purchase', value: '47' },
  { action_type: 'omni_purchase', value: '47' },
]), 47)

const window = { from: '2026-08-26', to: '2026-08-27', timezone: 'UTC' }
const paidAt = Math.floor(Date.parse('2026-08-26T12:00:00Z') / 1000)
const trialAt = Math.floor(Date.parse('2026-08-27T12:00:00Z') / 1000)
const report = buildReconciliation({
  window,
  meta: { purchases: 9, purchase_value: 900, spend: 250 },
  invoices: [
    { id: 'invoice-private-1', user_id: 'buyer-1', status: 'paid', amount: 10000, paid_at: paidAt },
    { id: 'invoice-private-2', user_id: 'buyer-2', status: 'paid', amount: 12000, paid_at: paidAt },
    { id: 'invoice-private-3', user_id: 'trial-1', status: 'paid', amount: 0, paid_at: trialAt, trial: true },
  ],
  sales: [{ uscreen_user_id: 'buyer-1', acquisition: 'exact_paid_meta', occurred_at: '2026-08-26T12:05:00Z' }],
  sourceHealth: { meta: true, uscreen: true, kv: true },
})
assert.equal(report.meta_reported_purchases, 9)
assert.equal(report.confirmed_meta_buyers, 1)
assert.equal(report.uscreen_paid_signups, 2)
assert.equal(report.uscreen_trials, 1)
assert.equal(report.unknown_sales, 1)
assert.equal(report.unmatched_meta_purchases, 8)
assert.equal(report.match_rate, 0.111)
assert.equal(report.confirmed_buyer_revenue, 100)
assert.equal(report.verdict, 'AMBER')
const previous = addPhaseTwoThree({
  report: { ...report, meta_reported_purchases: 4, confirmed_meta_buyers: 2, uscreen_paid_signups: 3, uscreen_trials: 0, unknown_sales: 1, match_rate: 0.5, uscreen_paid_value: 200 },
  previousReport: null,
  meta: { spend: 100, currency: 'USD' },
  sourceHealth: { meta: true, uscreen: true, kv: true },
})
const enhanced = addPhaseTwoThree({ report, previousReport: previous, meta: { spend: 250, currency: 'USD' }, sourceHealth: { meta: true, uscreen: true, kv: true } })
assert.equal(enhanced.schema_version, 2)
assert.equal(enhanced.commercial.confirmed_cac, 250)
// ROAS uses confirmed-buyer revenue (100) only, never whole-window revenue.
assert.equal(enhanced.commercial.confirmed_roas, 0.4)
assert.equal(enhanced.commercial.uscreen_window_revenue, 220)
assert.equal(enhanced.comparison.delta.match_rate, -0.389)
assert.ok(enhanced.alerts.some((alert) => alert.code === 'META_PURCHASES_UNMATCHED'))
assert.deepEqual(previousWindow(window), { from: '2026-08-24', to: '2026-08-25', timezone: 'UTC' })
assert.doesNotMatch(JSON.stringify(report), /invoice-private|buyer-1|trial-1/)

process.env.META_USCREEN_RECONCILIATION_TOKEN = 'test-report-token'
process.env.FACEBOOK_ACCESS_TOKEN = 'meta-test-token'
process.env.USCREEN_API_KEY = 'uscreen-test-token'
process.env.KV_REST_API_URL = 'https://kv.invalid'
process.env.KV_REST_API_TOKEN = 'kv-test-token'
const calls = []
globalThis.fetch = async (url, options = {}) => {
  calls.push({ url: String(url), options })
  if (String(url).includes('graph.facebook.com')) {
    return { ok: true, json: async () => ({ data: [{ spend: '250', actions: [{ action_type: 'purchase', value: '9' }], action_values: [{ action_type: 'purchase', value: '900' }] }] }) }
  }
  if (String(url).includes('uscreen.io')) {
    const page = new URL(url).searchParams.get('page')
    return { ok: true, json: async () => page === '1' ? [{ id: 'invoice-private-1', user_id: 'buyer-1', status: 'paid', amount: 10000, paid_at: paidAt }, { id: 'invoice-private-2', user_id: 'buyer-2', status: 'paid', amount: 12000, paid_at: paidAt }] : [] }
  }
  const command = JSON.parse(options.body)
  if (command[0] === 'ZREVRANGE') return { ok: true, json: async () => ({ result: ['sale-1'] }) }
  if (command[0] === 'GET') return { ok: true, json: async () => ({ result: JSON.stringify({ uscreen_user_id: 'buyer-1', acquisition: 'exact_paid_meta', occurred_at: '2026-08-26T12:05:00Z' }) }) }
  return { ok: true, json: async () => ({ result: null }) }
}

let statusCode = 0
let body
const response = { status(code) { statusCode = code; return this }, json(value) { body = value; return value } }
await handler({ method: 'GET', headers: { authorization: 'Bearer test-report-token' }, query: { from: window.from, to: window.to } }, response)
assert.equal(statusCode, 200)
assert.equal(body.success, true)
assert.equal(body.confirmed_meta_buyers, 1)
assert.equal(body.verdict, 'AMBER')
assert.ok(calls.some(({ url }) => url.includes('graph.facebook.com')))
assert.ok(calls.some(({ url }) => url.includes('uscreen.io')))
assert.ok(!JSON.stringify(body).includes('meta-test-token'))

statusCode = 0
await handler({ method: 'GET', headers: { authorization: 'Bearer wrong-token' }, query: {} }, response)
assert.equal(statusCode, 401)
console.log('meta-uscreen reconciliation tests passed')
