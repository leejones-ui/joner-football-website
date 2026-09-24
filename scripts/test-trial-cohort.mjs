import assert from 'node:assert/strict'
import { buildTrialCohort, classifyTrialAttribution } from '../api/_trial-cohort.js'

const s = (isoDate) => Math.floor(Date.parse(isoDate) / 1000)
const window = { from: '2026-08-11', to: '2026-09-09' }
const now = new Date('2026-09-09T12:00:00Z')
const invoices = [
  // converted trial from a Meta ad (ledger row)
  { id: 1, user_id: 'u1', status: 'paid', product_type: 'recurring', product_id: 230699, amount: 0, trial: true, paid_at: s('2026-08-20T10:00:00Z') },
  { id: 2, user_id: 'u1', status: 'paid', product_type: 'recurring', product_id: 230699, amount: 5699, currency: 'AUD', paid_at: s('2026-08-27T10:05:00Z') },
  // lapsed trial, signup UTMs say paid Meta via codec
  { id: 3, user_id: 'u2', status: 'paid', product_type: 'recurring', product_id: 230699, amount: 0, trial: true, paid_at: s('2026-08-25T10:00:00Z') },
  // still in trial, app signup, no signal
  { id: 4, user_id: 'u3', status: 'paid', product_type: 'recurring', product_id: 230699, amount: 0, trial: true, paid_at: s('2026-09-06T10:00:00Z') },
  // trial before the window: excluded
  { id: 5, user_id: 'u4', status: 'paid', product_type: 'recurring', product_id: 230699, amount: 0, trial: true, paid_at: s('2026-08-01T10:00:00Z') },
  // free-section signup ($0 freebie) is not a plan trial
  { id: 7, user_id: 'u6', status: 'paid', product_type: 'freebie', product_id: 226775, amount: 0, trial: false, paid_at: s('2026-09-01T10:00:00Z') },
  // paid without any trial: not part of the cohort
  { id: 6, user_id: 'u5', status: 'paid', product_type: 'recurring', product_id: 230699, amount: 3999, paid_at: s('2026-09-01T10:00:00Z') },
]
const sales = [{ uscreen_user_id: 'u1', acquisition: 'exact_paid_meta', confidence: 'high', source: 'ig', medium: 'paid_social', campaign: 'JF Coaches Max', ad: 'Planning Session', ad_id: '120249785829550035' }]
const customers = new Map([
  ['u2', { utm_params: { utm_source: 'fb__jfa1__s=fb&m=paid_social&c=JF%20Coaches%20Max&k=Coaching%20Structures%20V2&d=120249785829550035' } }],
  ['u3', { origin: 'app_sign_up', utm_params: {} }],
])
const cohort = buildTrialCohort({ window, invoices, sales, customers, now })
assert.equal(cohort.summary.trials, 3)
assert.equal(cohort.summary.converted, 1)
assert.equal(cohort.summary.ended_not_converted, 1)
assert.equal(cohort.summary.in_trial, 1)
assert.equal(cohort.summary.conversion_rate_of_decided, 0.5)
assert.equal(cohort.summary.converted_revenue, 56.99)
assert.equal(cohort.by_channel.meta_ads.trials, 2)
assert.equal(cohort.by_channel.meta_ads.converted, 1)
assert.equal(cohort.by_channel.unknown_app_signup.in_trial, 1)
const u1 = cohort.rows.find((r) => r.uscreen_user_id === 'u1')
assert.equal(u1.days_to_convert, 7)
assert.equal(u1.attribution.evidence, 'journey_ledger')
const u2 = cohort.rows.find((r) => r.uscreen_user_id === 'u2')
assert.equal(u2.attribution.channel, 'meta_ads')
assert.equal(u2.attribution.ad, 'Coaching Structures V2')
assert.equal(u2.attribution.evidence, 'uscreen_signup_utms')
// organic Meta (no paid medium) is not an ad
assert.equal(classifyTrialAttribution({ customer: { utm_params: { utm_source: 'ig', utm_medium: 'social' } } }).channel, 'meta_organic')
// unknown ledger row falls through to customer signals
assert.equal(classifyTrialAttribution({ sale: { acquisition: 'unknown' }, customer: { origin: 'web_sign_up' } }).channel, 'unknown_web_signup')
// PII never appears in rows
assert.ok(!JSON.stringify(cohort).match(/@|email/i))
assert.ok(!cohort.rows.find((r) => r.uscreen_user_id === 'u6'))
assert.equal(buildTrialCohort({ window, invoices, sales, customers, now, includeFreebies: true }).summary.trials, 3)
console.log('trial cohort tests passed')

// End-to-end guard: fetchTrialCohort must actually run. A missing snapshot load
// once shipped a ReferenceError that unit tests on buildTrialCohort could not see.
process.env.USCREEN_API_KEY = 'test-key'
process.env.KV_REST_API_URL = 'https://kv.test'
process.env.KV_REST_API_TOKEN = 'kv-test'
const { fetchTrialCohort } = await import('../api/_trial-cohort.js')
const trialAt = Math.floor(Date.parse('2026-09-08T10:00:00Z') / 1000)
const fakeFetch = async (url, options) => {
  const target = String(url)
  if (target.includes('/invoices')) {
    const page = Number(new URL(target).searchParams.get('page'))
    const body = page === 1
      ? [{ id: 'live-1', user_id: 'live-user', status: 'paid', amount: 0, trial: true, product_type: 'recurring', product_id: 230699, paid_at: trialAt }]
      : []
    return { ok: true, status: 200, json: async () => body }
  }
  if (target.includes('/customers/')) return { ok: true, status: 200, json: async () => ({ utm_params: {}, origin: 'web_sign_up' }) }
  if (target.includes('kv.test')) {
    const command = JSON.parse(options.body)[0]
    if (command === 'SMEMBERS') return { ok: true, status: 200, json: async () => ({ result: [] }) }
    if (command === 'ZREVRANGE') return { ok: true, status: 200, json: async () => ({ result: [] }) }
    return { ok: true, status: 200, json: async () => ({ result: 'OK' }) }
  }
  throw new Error('unexpected fetch ' + target)
}
const live = await fetchTrialCohort({ from: '2026-09-01', to: '2026-09-15', timezone: 'UTC' }, fakeFetch, new Date('2026-09-21T12:00:00Z'))
assert.equal(live.summary.trials, 1)
assert.equal(live.invoice_history_complete, true)
assert.ok(live.snapshots, 'snapshot accounting is reported')
console.log('trial cohort fetch smoke test passed')
