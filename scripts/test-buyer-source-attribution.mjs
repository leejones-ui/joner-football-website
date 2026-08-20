import assert from 'node:assert/strict'
import fs from 'node:fs'
import { classifyAttribution, mergeTouch, createJourneyId } from '../api/_attribution-ledger.js'
import { classifySource } from '../api/_source-taxonomy.js'
import { decodeUscreenSource } from '../api/_attribution.js'
import { createOrTouchJourney, enrichPayloadFromJourney, linkJourneyIdentity, resolveJourneyIdentity } from '../api/_journey-ledger.js'
import { reconcilePayment } from '../api/checkout-bridge.js'

const id = createJourneyId(() => Buffer.alloc(18, 9))

assert.equal(classifyAttribution({ journey: { last_touch: {} }, payment: { journey_id: 'wrong' } }).classification, 'unknown')
assert.equal(classifyAttribution({ journey: { journey_id: id, last_touch: {} }, payment: { journey_id: id } }).classification, 'direct')
assert.equal(classifyAttribution({ journey: { journey_id: id, last_touch: { utm_source: 'google', utm_medium: 'organic' } }, payment: { journey_id: id } }).classification, 'organic')
assert.equal(classifyAttribution({ journey: { journey_id: id, last_touch: { referrer: 'https://example.com/article' } }, payment: { journey_id: id } }).classification, 'referral')

const direct = mergeTouch(null, { journey_id: id }, '2026-08-17T00:00:00.000Z')
const paid = mergeTouch(direct, { journey_id: id, utm_source: 'meta', utm_medium: 'paid_social', utm_campaign: 'launch', campaign_id: 'cmp-1', adset_id: 'set-1', ad_id: 'ad-1', placement: 'feed', fbc: 'fb.1.1.click', fbp: 'fb.1.browser' }, '2026-08-17T00:01:00.000Z')
assert.equal(paid.first_touch.utm_source, undefined)
assert.equal(paid.last_touch.campaign_id, 'cmp-1')
assert.equal(paid.last_touch.adset_id, 'set-1')
assert.equal(paid.last_touch.ad_id, 'ad-1')
assert.equal(paid.last_touch.placement, 'feed')
const paidFirst = mergeTouch(null, { journey_id: id, utm_source: 'meta', utm_medium: 'paid_social', campaign_id: 'cmp-2', adset_id: 'set-2', ad_id: 'ad-2', fbc: 'fb.1.2.click' }, '2026-08-17T00:02:00.000Z')
const laterDirect = mergeTouch(paidFirst, { journey_id: id, utm_source: 'direct', utm_medium: 'direct' }, '2026-08-17T00:03:00.000Z')
assert.equal(laterDirect.first_touch.utm_source, 'meta')

assert.equal(classifySource({ utm_source: 'google', utm_medium: 'organic' }), 'google_organic')
assert.equal(classifySource({ utm_source: 'referral', utm_medium: 'referral', source_detail: 'partner.example' }), 'referral')
const decoded = decodeUscreenSource('meta__jfa1__s=meta&m=paid_social&i=cmp-1&a=set-1&d=ad-1&p=feed&q=fb.1.1.click&b=fb.1.browser&j=token')
assert.equal(decoded.campaign_id, 'cmp-1')
assert.equal(decoded.adset_id, 'set-1')
assert.equal(decoded.ad_id, 'ad-1')
assert.equal(decoded.placement, 'feed')
assert.equal(decoded.fbc, 'fb.1.1.click')
assert.equal(decoded.fbp, 'fb.1.browser')

const headCode = fs.readFileSync(new URL('./uscreen-head-attribution-v1.js', import.meta.url), 'utf8')
assert.match(headCode, /localStorage\.getItem\(cookieName\)/)
assert.match(headCode, /tokenSavedAtKey/)
assert.match(headCode, /tokenMaxAgeMs/)
assert.match(headCode, /var medium = params\.get\('utm_medium'\) \|\| \(source === 'google' \? 'organic' : source === 'direct' \? 'direct'/)
assert.match(headCode, /if \(!source\) source = referred \|\| 'direct'/)
assert.doesNotMatch(headCode, /email.*location\.(href|search)/i)

const tracking = fs.readFileSync(new URL('../public/tracking-attribution.js', import.meta.url), 'utf8')
assert.doesNotMatch(tracking, /email/i)
assert.match(tracking, /source \+ MARKER/)

const ledger = fs.readFileSync(new URL('../api/_journey-ledger.js', import.meta.url), 'utf8')
const userIndex = ledger.indexOf('jf:journey:index:uscreen:')
const tokenLookup = ledger.indexOf('verifyJourneyToken(attribution.jf_journey_id')
assert.ok(userIndex >= 0 && userIndex < tokenLookup, 'Uscreen user ID must resolve before signed token')
const bridge = fs.readFileSync(new URL('../api/checkout-bridge.js', import.meta.url), 'utf8')
assert.ok(bridge.indexOf('getJourneyByUscreenUserId') < bridge.indexOf('const suppliedJourneyId'), 'checkout must prefer Uscreen user ID')
const baseLayout = fs.readFileSync(new URL('../src/layouts/BaseLayout.astro', import.meta.url), 'utf8')
assert.match(baseLayout, /threads\)\\\.\(com\|net\)/)
assert.match(baseLayout, /googleHosts\.indexOf\(normalHost\)/)
assert.doesNotMatch(baseLayout, /google\\\.\[a-z\.\]\+\$/)

process.env.JOURNEY_SIGNING_SECRET = 'buyer-source-test-signing-secret'
process.env.KV_REST_API_URL = 'https://kv.invalid'
process.env.KV_REST_API_TOKEN = 'test-token'
const strings = new Map()
const sets = new Map()
const originalFetch = globalThis.fetch
globalThis.fetch = async (_url, options) => {
  const [command, key, ...args] = JSON.parse(options.body)
  let result = null
  if (command === 'SET') { strings.set(key, args[0]); result = 'OK' }
  if (command === 'GET') result = strings.get(key) || null
  if (command === 'SADD') { const values = sets.get(key) || new Set(); const before = values.size; values.add(args[0]); sets.set(key, values); result = values.size - before }
  if (command === 'SMEMBERS') result = [...(sets.get(key) || [])]
  if (command === 'EXPIRE') result = 1
  return { ok: true, json: async () => ({ result }) }
}

const directJourney = await createOrTouchJourney({ attribution: { utm_source: 'direct', utm_medium: 'direct', source_taxonomy: 'direct' }, page_path: '/' })
assert.equal(directJourney.record.first_touch.utm_source, 'direct')
await linkJourneyIdentity(directJourney.token, { email: 'direct-test@example.invalid', uscreenUserId: 'user-direct' })

const metaJourney = await createOrTouchJourney({ attribution: { utm_source: 'meta', utm_medium: 'paid_social', campaign_id: 'cmp-user', adset_id: 'set-user', ad_id: 'ad-user', placement: 'instagram_reels', fbc: 'fb.1.user.click', fbp: 'fb.1.user.browser' } })
await linkJourneyIdentity(metaJourney.token, { email: 'meta-test@example.invalid', uscreenUserId: 'user-meta' })
const userWins = await reconcilePayment({ user_id: 'user-meta', jf_journey_id: directJourney.token, event_date: new Date().toISOString() })
assert.equal(userWins.join_method, 'uscreen_user_id')
assert.equal(userWins.classification, 'exact_paid_meta')
assert.equal(userWins.campaign, 'cmp-user')
assert.equal(userWins.fbc, 'fb.1.user.click')
assert.equal(userWins.fbp, 'fb.1.user.browser')

const signedFallback = await reconcilePayment({ jf_journey_id: directJourney.token, event_date: new Date().toISOString() })
assert.equal(signedFallback.join_method, 'signed_journey_id')
assert.equal(signedFallback.classification, 'direct')

const emailResolution = await resolveJourneyIdentity({}, 'direct-test@example.invalid')
assert.equal(emailResolution.join_method, 'hashed_email')
assert.equal(emailResolution.id, directJourney.record.id)
const emailEnriched = await enrichPayloadFromJourney({}, 'direct-test@example.invalid')
assert.equal(emailEnriched.jf_journey_id, directJourney.token)

// Two journeys linked by the same checkout email are the same person, so the
// most recently updated journey wins instead of failing ambiguous (a returning
// device plus a fresh ad click was blocking real paid attribution).
await new Promise((resolve) => setTimeout(resolve, 5))
const latestJourney = await createOrTouchJourney({ attribution: { utm_source: 'referral', utm_medium: 'referral', source_taxonomy: 'referral' } })
await linkJourneyIdentity(latestJourney.token, { email: 'direct-test@example.invalid' })
const latestResolution = await resolveJourneyIdentity({}, 'direct-test@example.invalid')
assert.equal(latestResolution.join_method, 'hashed_email_latest')
assert.equal(latestResolution.id, latestJourney.record.id)
const latestEnriched = await enrichPayloadFromJourney({}, 'direct-test@example.invalid')
assert.equal(latestEnriched.jf_journey_id, latestJourney.token)

globalThis.fetch = originalFetch

console.log('buyer-source attribution regression tests passed')
