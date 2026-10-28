// Sales attribution capture fixes approved by Lee on 28 Oct 2026:
// fbclid is not paid proof, landing page reaches the sale, Uscreen signup UTM
// fallback (inferred, never over an exact join), report range and limit params.
import assert from 'node:assert/strict'
import { classifyAttribution, classifySignupUtms } from '../api/_attribution-ledger.js'
import { createOrTouchJourney, linkJourneyIdentity } from '../api/_journey-ledger.js'
import { reconcilePayment, applySignupUtmFallback, journeyLandingPage } from '../api/checkout-bridge.js'
import { mergeReliableSale } from '../api/_reliability-ledger.js'
import { reconcileUnknownSales } from '../api/attribution-cron.js'
import reportHandler, { reportRange, reportLimit, buyerCoverage } from '../api/attribution-report.js'
import goHandler from '../api/go.js'

const id = 'jfy_' + 'b'.repeat(24)
const classify = (touch) => classifyAttribution({ journey: { journey_id: id, last_touch: touch }, payment: { journey_id: id } }).classification

// 1. fbclid alone is organic social; Meta paid needs paid medium or ids.
assert.equal(classify({ fbclid: 'organic-click' }), 'organic_social')
assert.equal(classify({ fbc: 'fb.1.1.organic-click' }), 'organic_social')
assert.equal(classify({ utm_source: 'facebook', fbclid: 'organic-click' }), 'organic_social')
assert.equal(classify({ utm_source: 'instagram', utm_medium: 'social', fbclid: 'organic-click', referrer: 'https://l.instagram.com/' }), 'organic_social')
assert.equal(classify({ utm_source: 'facebook', utm_medium: 'paid_social', fbclid: 'paid-click' }), 'meta')
assert.equal(classify({ utm_source: 'fb', utm_medium: 'cpc', fbclid: 'paid-click' }), 'meta')
assert.equal(classify({ fbclid: 'paid-click', utm_medium: 'paid' }), 'meta')
assert.equal(classify({ utm_source: 'instagram', fbclid: 'paid-click', utm_id: '120249785829550035' }), 'meta')
assert.equal(classify({ utm_source: 'facebook', fbclid: 'paid-click', ad_id: '120249785829550036' }), 'meta')
assert.equal(classify({ utm_source: 'facebook', utm_medium: 'paid_social', fbclid: 'c', campaign_id: '1', adset_id: '2', ad_id: '3' }), 'exact_paid_meta')
assert.equal(classify({ utm_source: 'instagram', utm_medium: 'organic_social', fbclid: 'c', campaign_id: '1', adset_id: '2', ad_id: '3' }), 'meta')
// Specific organic sources keep their channel and do not fall to unknown.
for (const source of ['main_instagram', 'app_instagram', 'main_instagram_linktree', 'manychat_instagram', 'manychat_facebook', 'youtube', 'youtube_coaches', 'tiktok', 'youtube-es']) {
  assert.equal(classify({ utm_source: source, utm_medium: source.startsWith('manychat') ? 'automation' : 'social' }), 'organic_social', source)
  assert.equal(classify({ utm_source: source }), 'organic_social', `${source} without medium`)
}
assert.equal(classify({ utm_source: 'brevo/email', utm_medium: 'email' }), 'email')
assert.equal(classify({ utm_source: 'google', utm_medium: 'organic' }), 'organic')
assert.equal(classify({ utm_source: 'direct', utm_medium: 'direct' }), 'direct')

// 2. Landing path through checkout-bridge from a signed journey.
process.env.JOURNEY_SIGNING_SECRET = 'capture-test-signing-secret'
process.env.KV_REST_API_URL = 'https://kv.invalid'
process.env.KV_REST_API_TOKEN = 'test-token'
delete process.env.USCREEN_API_KEY
const strings = new Map(), sets = new Map()
const kvFetch = async (_url, options) => {
  const [command, key, ...args] = JSON.parse(options.body)
  let result = null
  if (command === 'SET') { strings.set(key, args[0]); result = 'OK' }
  if (command === 'GET') result = strings.get(key) || null
  if (command === 'SADD') { const v = sets.get(key) || new Set(); v.add(args[0]); sets.set(key, v); result = 1 }
  if (command === 'SMEMBERS') result = [...(sets.get(key) || [])]
  if (command === 'EXPIRE') result = 1
  return { ok: true, json: async () => ({ result }) }
}
globalThis.fetch = kvFetch
const landed = await createOrTouchJourney({ attribution: { utm_source: 'main_instagram', utm_medium: 'social', link_token: 'instagram-bio', source_taxonomy: 'main_instagram' }, page_path: '/join' })
await createOrTouchJourney({ token: landed.token, attribution: {}, page_path: '/app/for-coaches' })
await linkJourneyIdentity(landed.token, { uscreenUserId: 'user-landing' })
const landing = await reconcilePayment({ user_id: 'user-landing', event_date: new Date().toISOString() })
assert.equal(landing.join_method, 'uscreen_user_id')
assert.equal(landing.classification, 'organic_social')
assert.equal(landing.source, 'main_instagram')
assert.equal(landing.landing_page, '/join')
assert.equal(landing.last_page, '/app/for-coaches')
assert.equal(journeyLandingPage({ last_touch: { landing_url: 'https://jonerfootball.com/app' }, first_page_path: '/join' }), 'https://jonerfootball.com/app')
assert.equal(journeyLandingPage({ last_touch: {}, latest_page_path: '/teams' }), '/teams')

// 3. Uscreen signup UTM fallback: inferred, and never over an exact join.
const signup = { utm_source: 'manychat_facebook', utm_medium: 'automation', utm_campaign: 'facebook-app-flow' }
const noJoin = await reconcilePayment({ user_id: 'user-without-journey', event_date: new Date().toISOString(), uscreen_signup_utms: signup })
assert.equal(noJoin.classification, 'organic_social')
assert.equal(noJoin.confidence, 'inferred')
assert.ok(noJoin.evidence.includes('uscreen_signup_utm'))
assert.equal(noJoin.join_method, 'uscreen_signup_utm')
assert.equal(noJoin.source, 'manychat_facebook')
const paidSignup = applySignupUtmFallback({ classification: 'unknown', confidence: 'none', evidence: ['no_safe_join'] }, { utm_source: 'fb__jfa1__s=fb&m=paid_social&i=120249785829550035&d=120249785829550036' })
assert.equal(paidSignup.classification, 'meta', 'inferred Meta is never exact_paid_meta')
assert.equal(paidSignup.confidence, 'inferred')
assert.equal(paidSignup.ad, '120249785829550036')
assert.equal(applySignupUtmFallback({ classification: 'unknown', confidence: 'none' }, {}).classification, 'unknown')
assert.equal(classifySignupUtms({ utm_source: 'partner-site' }), undefined, 'unrecognised signup UTMs stay unknown')
// A journey join (even one that classifies unknown) is never replaced.
const joinedUnknown = { classification: 'unknown', confidence: 'high', journey_id: 'token', evidence: ['explicit_journey_id'] }
assert.equal(applySignupUtmFallback(joinedUnknown, signup), joinedUnknown)
const exact = await reconcilePayment({ user_id: 'user-landing', event_date: new Date().toISOString(), uscreen_signup_utms: { utm_source: 'facebook', utm_medium: 'paid_social' } })
assert.equal(exact.join_method, 'uscreen_user_id')
assert.equal(exact.classification, 'organic_social')
assert.notEqual(exact.confidence, 'inferred')
// The ledger merge keeps a journey-joined source when an inferred write lands later.
const kept = mergeReliableSale({ sale_id: 's1', acquisition: 'exact_paid_meta', confidence: 'high', source: 'facebook', journey_id: 'j1', join_method: 'uscreen_user_id' }, { sale_id: 's1', acquisition: 'organic_social', confidence: 'inferred', source: 'manychat_facebook', join_method: 'uscreen_signup_utm', amount: 10 })
assert.equal(kept.acquisition, 'exact_paid_meta'); assert.equal(kept.source, 'facebook'); assert.equal(kept.confidence, 'high'); assert.equal(kept.join_method, 'uscreen_user_id'); assert.equal(kept.amount, 10)
const upgraded = mergeReliableSale({ sale_id: 's2', acquisition: 'organic_social', confidence: 'inferred' }, { sale_id: 's2', acquisition: 'meta', confidence: 'high', journey_id: 'j2' })
assert.equal(upgraded.acquisition, 'meta')

// Cron sweep: old unknown rows get the fallback once; inferred rows only yield to a real join.
const old = new Date(Date.now() - 40 * 86400000).toISOString()
const recent = new Date(Date.now() - 2 * 86400000).toISOString()
const rows = [
  { sale_id: 'old-unknown', kind: 'payment', acquisition: 'unknown', uscreen_user_id: 'u-old', occurred_at: old },
  { sale_id: 'old-checked', kind: 'payment', acquisition: 'unknown', uscreen_user_id: 'u-checked', occurred_at: old, signup_utm_checked: 'v1-2026-10-28' },
  { sale_id: 'exact', kind: 'payment', acquisition: 'exact_paid_meta', confidence: 'high', uscreen_user_id: 'u-exact', occurred_at: recent },
  { sale_id: 'inferred', kind: 'payment', acquisition: 'organic_social', confidence: 'inferred', uscreen_user_id: 'u-inferred', occurred_at: recent },
]
const writes = [], signupCalls = []
const sweep = await reconcileUnknownSales(50, {
  list: async () => rows,
  append: async (row) => { writes.push(row); return row },
  fetchSignup: async (userId) => { signupCalls.push(userId); return { utm_source: 'youtube_coaches', utm_medium: 'social' } },
  reconcile: async (payment) => applySignupUtmFallback({ classification: 'unknown', confidence: 'none', evidence: ['no_safe_join'] }, payment.uscreen_signup_utms),
})
assert.deepEqual(signupCalls, ['u-old'])
assert.equal(sweep.signup_utm_reclassified, 1)
const oldWrite = writes.find((row) => row.sale_id === 'old-unknown')
assert.equal(oldWrite.acquisition, 'organic_social'); assert.equal(oldWrite.confidence, 'inferred'); assert.equal(oldWrite.source, 'youtube_coaches'); assert.equal(oldWrite.signup_utm_checked, 'v1-2026-10-28')
assert.ok(!writes.some((row) => row.sale_id === 'exact'), 'exact rows are never touched')
const inferredWrite = writes.find((row) => row.sale_id === 'inferred')
assert.equal(inferredWrite.acquisition, 'organic_social'); assert.equal(inferredWrite.confidence, 'inferred'); assert.equal(inferredWrite.reconcile_attempts, 1)
const joinedSweep = []
await reconcileUnknownSales(50, { list: async () => [rows[3]], append: async (row) => { joinedSweep.push(row) }, fetchSignup: async () => undefined,
  reconcile: async () => ({ classification: 'meta', confidence: 'high', journey_id: 'j3', join_method: 'uscreen_user_id', evidence: ['explicit_journey_id'] }) })
assert.equal(joinedSweep[0].acquisition, 'meta'); assert.equal(joinedSweep[0].journey_id, 'j3')

// 4. Report params: limit up to 200, days and from/to (from/to win).
assert.equal(reportLimit(500), 200); assert.equal(reportLimit('0'), 50); assert.equal(reportLimit(150), 150); assert.equal(reportLimit(undefined), 50)
const now = Date.parse('2026-10-28T00:00:00Z')
assert.deepEqual(reportRange({ days: '7' }, now), { from: '2026-10-21T00:00:00.000Z', to: '2026-10-28T00:00:00.000Z', days: 7 })
assert.equal(reportRange({}, now).from, '2026-09-28T00:00:00.000Z')
assert.equal(reportRange({ days: '7', from: '2026-10-01', to: '2026-10-11' }, now).from, '2026-10-01')
assert.equal(reportRange({ days: '7', from: '2026-10-01', to: '2026-10-11' }, now).days, 10)
assert.equal(reportRange({ days: 3, to: '2026-10-10T00:00:00Z' }, now).from, '2026-10-07T00:00:00.000Z')
assert.ok(reportRange({ days: 'abc' }, now).error)
assert.ok(reportRange({ from: '2026-10-11', to: '2026-10-01' }, now).error)

const paidRow = (i, extra = {}) => ({ sale_id: `payment:${i}`, payment_id: `payment:${i}`, occurred_at: new Date(Date.now() - 86400000).toISOString(), offer_id: '3', uscreen_user_id: `buyer-${i}`, amount: 10, currency: 'USD', payment_status: 'paid', kind: 'payment', acquisition: 'organic_social', source: 'main_instagram', ...extra })
const reportRows = [
  ...Array.from({ length: 150 }, (_, i) => paidRow(i)),
  ...Array.from({ length: 30 }, (_, i) => paidRow(150 + i, { acquisition: 'unknown', source: undefined })),
  ...Array.from({ length: 20 }, (_, i) => paidRow(180 + i, { acquisition: 'unknown', billing_origin: 'apple' })),
  paidRow(0, { sale_id: 'payment:dup', payment_id: 'payment:dup' }), // same buyer twice
  paidRow(300, { kind: 'renewal' }),
  paidRow(301, { trial: true, amount: 0 }),
]
const coverage = buyerCoverage(reportRows)
assert.deepEqual({ n: coverage.new_buyers, t: coverage.tracked_buyers, u: coverage.untracked_buyers, a: coverage.app_store_buyers }, { n: 200, t: 150, u: 30, a: 20 })
assert.equal(coverage.tracked_rate, 0.833)
globalThis.fetch = async (_url, options) => {
  const cmd = JSON.parse(options.body)
  let result = null
  if (cmd[0] === 'SCAN') result = ['0', cmd[3].includes(':archive:') ? [] : reportRows.map((row) => row.sale_id)]
  if (cmd[0] === 'MGET') result = cmd.slice(1).map((key) => key.startsWith('jf:meta:') ? null : JSON.stringify(reportRows.find((row) => row.sale_id === key)))
  if (cmd[0] === 'LRANGE' || cmd[0] === 'HGETALL') result = []
  if (!['SCAN', 'MGET', 'GET', 'LRANGE', 'HGETALL'].includes(cmd[0])) throw Error(`Unexpected mutation ${cmd[0]}`)
  return { ok: true, json: async () => ({ result }) }
}
process.env.ATTRIBUTION_REPORT_TOKEN = 'capture-report-token'
const call = async (query) => { let code, body; await reportHandler({ method: 'GET', headers: { authorization: 'Bearer capture-report-token' }, query }, { status(c) { code = c; return this }, json(b) { body = b; return b } }); return { code, body } }
const wide = await call({ days: '7', limit: '200' })
assert.equal(wide.code, 200)
assert.equal(wide.body.sales.length, 200)
assert.equal(wide.body.coverage.new_buyers, 200)
assert.equal(wide.body.coverage.tracked_buyers, 150)
assert.equal(wide.body.coverage.untracked_buyers, 30)
assert.equal(wide.body.coverage.app_store_buyers, 20)
assert.equal(wide.body.coverage.range_days, 7)
const narrow = await call({ days: '7', limit: '5' })
assert.equal(narrow.body.sales.length, 5)
assert.equal(narrow.body.coverage.new_buyers, 200, 'coverage is over the whole range, not the returned rows')
assert.equal(narrow.body.range_totals.new_buyers, 200)
assert.equal(narrow.body.range_totals.new_buyers_by_acquisition.organic_social, 150)
assert.equal(narrow.body.range_totals.new_buyers_by_acquisition.app_store, 20)
const outside = await call({ from: '2020-01-01', to: '2020-02-01', days: '7' })
assert.equal(outside.body.coverage.new_buyers, 0, 'from/to win over days')
assert.equal((await call({ days: 'x' })).code, 400)

// 5. Linktree JF App tracked link goes to the App Store with ct.
const res = { headers: {}, status(c) { this.code = c; return this }, setHeader(k, v) { this.headers[k] = v }, redirect(c, l) { this.code = c; this.location = l; return this }, json(b) { this.body = b; return this } }
await goHandler({ method: 'GET', query: { token: 'linktree-app' }, headers: {} }, res)
assert.equal(res.code, 302)
const store = new URL(res.location)
assert.equal(store.hostname, 'apps.apple.com')
assert.equal(store.searchParams.get('ct'), 'main_instagram_linktree')
assert.equal(store.searchParams.get('utm_source'), null)
const play = { ...res, headers: {} }
await goHandler({ method: 'GET', query: { token: 'linktree-android' }, headers: {} }, play)
assert.match(play.location, /referrer=utm_source%3Dmain_instagram_linktree%26utm_medium%3Dsocial/)

console.log('attribution capture tests passed')
