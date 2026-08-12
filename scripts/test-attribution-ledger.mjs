import assert from 'node:assert/strict'
import { createJourneyId, normalizeJourneyId, mergeTouch, sanitizeEvent, classifyAttribution, sha256, ATTRIBUTION_CLASSES } from '../api/_attribution-ledger.js'

const id = createJourneyId(() => Buffer.alloc(18, 7))
assert.match(id, /^jfy_[A-Za-z0-9_-]{24}$/)
assert.equal(normalizeJourneyId(id), id)
assert.equal(normalizeJourneyId('bad'), undefined)

const record = mergeTouch(null, { journey_id: id, utm_source: 'facebook', fbclid: 'abc', utm_campaign: 'launch', referrer: 'https://facebook.com' }, '2026-08-12T00:00:00.000Z')
assert.equal(record.first_touch.utm_source, 'facebook')
const next = mergeTouch(record, { journey_id: id, utm_source: 'google', gclid: 'x' }, '2026-08-13T00:00:00.000Z')
assert.equal(next.first_touch.utm_source, 'facebook')
assert.equal(next.last_touch.utm_source, 'google')

const event = sanitizeEvent({ journey_id: id, event_name: 'checkout_click', cta: 'Join Plus', utm_source: 'facebook', adset: 'set-1', placement: 'feed' })
assert.equal(event.journey_id, id)
assert.equal(event.attribution.adset, 'set-1')
assert.throws(() => sanitizeEvent({ journey_id: id, event_name: 'not_allowed' }), /Unsupported/)

const exact = classifyAttribution({ journey: { journey_id: id, last_touch: { ...record.last_touch, utm_medium: 'paid_social', campaign_id: 'cmp-1', adset_id: 'set-1', ad_id: 'ad-1' } }, payment: { journey_id: id, paid_at: '2026-08-12T00:00:00.000Z' }, now: Date.parse('2026-08-12T01:00:00.000Z') })
assert.equal(exact.classification, 'exact_paid_meta')
assert.equal(exact.confidence, 'high')
const fbpOnly = classifyAttribution({ journey: { journey_id: id, last_touch: { ...record.last_touch, fbp: 'fb.1.only' } }, payment: { journey_id: id, paid_at: '2026-08-12T00:00:00.000Z' }, now: Date.parse('2026-08-12T01:00:00.000Z') })
assert.notEqual(fbpOnly.classification, 'exact_paid_meta')
const unknown = classifyAttribution({ journey: { journey_id: id, last_touch: record.last_touch }, payment: { journey_id: 'jfy_other________________' }, now: Date.parse('2026-08-12T01:00:00.000Z') })
assert.equal(unknown.classification, 'unknown')
assert.equal(unknown.confidence, 'none')
assert.equal(sha256('Customer@example.com'), sha256(' customer@example.com '))
assert.ok(ATTRIBUTION_CLASSES.has('exact_paid_meta'))
assert.ok(!JSON.stringify(record).includes('@'))
console.log('attribution ledger tests passed')
