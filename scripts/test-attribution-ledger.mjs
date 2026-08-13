import assert from 'node:assert/strict'
import { createJourneyId, normalizeJourneyId, mergeTouch, sanitizeEvent, classifyAttribution, sha256, ATTRIBUTION_CLASSES, appendSale, listSales, MAX_SALES } from '../api/_attribution-ledger.js'

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

const strings = new Map()
const scores = new Map()
async function fakeFetch(_url, options) {
  const [name, ...args] = JSON.parse(options.body)
  let result = null
  if (name === 'SET') {
    const [key, value] = args
    if (args.includes('NX') && strings.has(key)) result = null
    else { strings.set(key, value); result = 'OK' }
  } else if (name === 'GET') result = strings.get(args[0]) || null
  else if (name === 'ZADD') { scores.set(args[2], Number(args[1])); result = 1 }
  else if (name === 'ZRANGE' || name === 'ZREVRANGE') {
    const ordered = [...scores.entries()].sort((a, b) => a[1] - b[1]).map(([key]) => key)
    const source = name === 'ZREVRANGE' ? ordered.reverse() : ordered
    const start = Number(args[1]); const rawEnd = Number(args[2]); const end = rawEnd < 0 ? source.length + rawEnd : rawEnd
    result = end < start ? [] : source.slice(start, end + 1)
  } else if (name === 'ZREM') { for (const key of args.slice(1)) scores.delete(key); result = args.length - 1 }
  else if (name === 'DEL') { for (const key of args) strings.delete(key); result = args.length }
  return { ok: true, json: async () => ({ result }) }
}
process.env.KV_REST_API_URL = 'https://kv.invalid'
process.env.KV_REST_API_TOKEN = 'test-token'
for (let i = 0; i < MAX_SALES + 5; i++) {
  await appendSale({ sale_id: `sale-${i}`, occurred_at: new Date(Date.UTC(2026, 7, 1, 0, i)).toISOString() }, fakeFetch)
}
const rollingSales = await listSales(fakeFetch)
assert.equal(rollingSales.length, MAX_SALES)
assert.equal(rollingSales[0].sale_id, `sale-${MAX_SALES + 4}`)
assert.equal(rollingSales.at(-1).sale_id, 'sale-5')
assert.equal(strings.has('jfa:sale:sale-0'), false)
console.log('attribution ledger tests passed')
