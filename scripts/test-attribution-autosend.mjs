import assert from 'node:assert/strict'
import crypto from 'node:crypto'

// In-memory KV + Meta Graph mock behind global fetch, so the real modules run
// their production code paths unchanged.
process.env.KV_REST_API_URL = 'https://kv.invalid'
process.env.KV_REST_API_TOKEN = 'test'
process.env.META_CAPI_TOKEN = 'test-capi-token'
process.env.JOURNEY_SIGNING_SECRET = 'test-signing-secret'
process.env.BREVO_API_KEY = 'test-brevo-key'
process.env.USCREEN_API_KEY = 'test-uscreen-key'

const strings = new Map()
const hashes = new Map()
const zsets = new Map()
const lists = new Map()
const sets = new Map()
let metaCalls = []
let metaResponse = { events_received: 1 }
let metaOk = true

function kvExec(command, args) {
  if (command === 'SET') {
    const [key, value, ...opts] = args
    if (opts.includes('NX') && strings.has(key)) return null
    strings.set(key, value)
    return 'OK'
  }
  if (command === 'GET') return strings.get(args[0]) ?? null
  if (command === 'MGET') return args.map((key) => strings.get(key) ?? null)
  if (command === 'DEL') { for (const key of args) strings.delete(key); return args.length }
  if (command === 'EXPIRE') return 1
  if (command === 'SCAN') {
    const prefix = String(args[2] || '').replace('*', '')
    const keys = [...new Set([...strings.keys(), ...hashes.keys()])].filter((key) => key.startsWith(prefix))
    return ['0', keys]
  }
  if (command === 'ZADD') { const [key, score, member] = args; if (!zsets.has(key)) zsets.set(key, new Map()); zsets.get(key).set(member, Number(score)); return 1 }
  if (command === 'ZRANGE' || command === 'ZREVRANGE') {
    const map = zsets.get(args[0]) || new Map()
    let rows = [...map.entries()].sort((a, b) => a[1] - b[1]).map(([k]) => k)
    if (command === 'ZREVRANGE') rows.reverse()
    const start = Number(args[1]); const e = Number(args[2]); const end = e < 0 ? rows.length + e : e
    return end < start ? [] : rows.slice(start, end + 1)
  }
  if (command === 'ZRANGEBYSCORE') {
    const map = zsets.get(args[0]) || new Map()
    const min = Number(args[1]); const max = Number(args[2])
    return [...map.entries()].filter(([, s]) => s >= min && s <= max).sort((a, b) => a[1] - b[1]).map(([k]) => k)
  }
  if (command === 'ZREM') { const map = zsets.get(args[0]); for (const key of args.slice(1)) map?.delete(key); return args.length - 1 }
  if (command === 'HSET') { const [key, field, value] = args; if (!hashes.has(key)) hashes.set(key, new Map()); hashes.get(key).set(field, value); return 1 }
  if (command === 'HINCRBY') { const [key, field, amount] = args; if (!hashes.has(key)) hashes.set(key, new Map()); const map = hashes.get(key); map.set(field, String(Number(map.get(field) || 0) + Number(amount))); return Number(map.get(field)) }
  if (command === 'HGETALL') { const map = hashes.get(args[0]) || new Map(); return [...map].flat() }
  if (command === 'LPUSH') { if (!lists.has(args[0])) lists.set(args[0], []); lists.get(args[0]).unshift(...args.slice(1)); return lists.get(args[0]).length }
  if (command === 'LTRIM') { const rows = lists.get(args[0]) || []; lists.set(args[0], rows.slice(Number(args[1]), Number(args[2]) + 1)); return 'OK' }
  if (command === 'LRANGE') { const rows = lists.get(args[0]) || []; return rows.slice(Number(args[1]), Number(args[2]) + 1) }
  if (command === 'SADD') { if (!sets.has(args[0])) sets.set(args[0], new Set()); for (const member of args.slice(1)) sets.get(args[0]).add(member); return 1 }
  if (command === 'SMEMBERS') return [...(sets.get(args[0]) || new Set())]
  return null
}

globalThis.fetch = async function mockFetch(url, options = {}) {
  const target = String(url)
  if (target.startsWith('https://kv.invalid')) {
    const [command, ...args] = JSON.parse(options.body)
    return { ok: true, json: async () => ({ result: kvExec(command, args) }) }
  }
  if (target.includes('graph.facebook.com')) {
    metaCalls.push(JSON.parse(options.body))
    return { ok: metaOk, status: metaOk ? 200 : 400, text: async () => JSON.stringify(metaResponse) }
  }
  if (target.includes('www.uscreen.io/publisher_api/v1/invoices/101')) return { ok: true, json: async () => ({id:101,user_id:1001,product_id:3,status:'paid',amount:22731,currency:'USD',paid_at:1788884915,origin:'stripe',product_type:'recurring',trial:false}) }
  if (target.includes('api.brevo.com')) {
    return { ok: true, status: 200, json: async () => ({ attributes: {}, listIds: [] }), text: async () => '{}' }
  }
  throw new Error(`Unexpected fetch in test: ${target}`)
}

const { attemptFirstPaidAutoSend, buildVerifiedMetaEvent } = await import('../api/_uscreen-webhook.js')
const { retriggerUnknownSalesForEmail } = await import('../api/checkout-bridge.js')
const { appendReliableSale } = await import('../api/_reliability-ledger.js')
const { createOrTouchJourney, linkJourneyIdentity } = await import('../api/_journey-ledger.js')
const { presentSale } = await import('../api/attribution-report.js')

const sha256 = (value) => crypto.createHash('sha256').update(String(value).trim().toLowerCase()).digest('hex')

// Verified invoice replaces wrong webhook money. No real network is permitted.
const key = `jf:meta:first-paid:${sha256('uscreen:1001')}`
const metaEvent = buildVerifiedMetaEvent('JF_First_Paid_Membership', {user_id:'1001',order_id:'101',offer_id:3,currency:'GBP'}, 'buyer@example.com', 252.58)
metaEvent.event_id = `JF_First_Paid_Membership.${sha256('uscreen:1001')}`
const verified = {status:'verified',eventId:metaEvent.event_id,uscreenUserId:'1001',uscreenOrderId:'101',offerId:3,metaEvent,reconciliation:{paymentId:'101',historyComplete:true,channel:'web',evidenceHash:'synthetic-history',value:227.31,currency:'USD'}}
strings.set(key,JSON.stringify(verified))
let result = await attemptFirstPaidAutoSend({key,record:verified,metaEvent})
assert.equal(result.sent,true)
assert.equal(metaCalls.length,1)
assert.equal(metaCalls[0].data[0].custom_data.value,227.31)
assert.equal(metaCalls[0].data[0].custom_data.currency,'USD')
// Expired lock still cannot resend or overwrite an accepted event.
strings.delete(`${key}:send-lock`)
const sentRecord = strings.get(key)
result = await attemptFirstPaidAutoSend({key,record:verified,metaEvent})
assert.equal(result.reason,'already-sent');assert.equal(strings.get(key),sentRecord);assert.equal(metaCalls.length,1)
// Merely positive value/currency is insufficient.
strings.delete(`${key}:send-lock`);strings.set(key,JSON.stringify({...verified,status:'pending',reconciliation:undefined}))
result = await attemptFirstPaidAutoSend({key,metaEvent})
assert.equal(result.reason,'authoritative-history-required');assert.equal(metaCalls.length,1)
assert.equal(JSON.parse(strings.get(key)).status,'candidate')
// Ambiguous transport is durable, and must not retry after lock expiry.
strings.delete(`${key}:send-lock`);strings.set(key,JSON.stringify(verified));metaResponse={events_received:0}
result = await attemptFirstPaidAutoSend({key,metaEvent})
assert.equal(result.reason,'transport-outcome-requires-review');assert.equal(JSON.parse(strings.get(key)).status,'sending')
strings.delete(`${key}:send-lock`)
result=await attemptFirstPaidAutoSend({key,metaEvent})
assert.equal(result.reason,'transport-outcome-requires-review');assert.equal(metaCalls.length,2)
metaResponse={events_received:1}
// A held lock must not mutate an accepted record.
strings.set(key, sentRecord)
result=await attemptFirstPaidAutoSend({key,metaEvent})
assert.equal(result.reason,'send-locked');assert.equal(strings.get(key),sentRecord)

// 5. Late identity retrigger: an unknown sale becomes attributed once the
// buyer's email is linked to a journey with Meta evidence.
{
  const email = 'buyer5@example.com'
  const emailHash = sha256(email)
  const { token } = await createOrTouchJourney({
    attribution: {
      utm_source: 'facebook', utm_medium: 'paid_social', utm_campaign: 'jf_coaches_max',
      campaign_id: '120249257260070035', adset_id: '120249271941100035', ad_id: '120249272080270035',
      placement: 'feed', fbclid: 'TESTCLICK5', fbc: 'fb.1.1700000000000.TESTCLICK5', fbp: 'fb.1.1700000000000.111',
    },
    page_path: '/app/for-coaches',
  })
  await linkJourneyIdentity(token, { email, uscreenUserId: 'u-5005' })
  await appendReliableSale({
    sale_id: 'payment:ch_late5', kind: 'payment', payment_status: 'paid',
    provider_payment_id: 'ch_late5', occurred_at: new Date().toISOString(),
    amount: 249.99, currency: 'USD', uscreen_user_id: 'u-5005',
    customer_reference: emailHash.slice(0, 16), email_sha256: emailHash,
    acquisition: 'unknown', confidence: 'none', evidence: ['no_safe_join'],
  })
  const result = await retriggerUnknownSalesForEmail(emailHash)
  assert.equal(result.checked, 1)
  assert.equal(result.reclassified, 1, 'late identity must reclassify the unknown sale')
  const row = JSON.parse(strings.get('jfa:reliability:sale:payment:ch_late5'))
  assert.notEqual(String(row.acquisition), 'unknown')
  assert.ok(row.evidence.includes('late_identity_retrigger'))
}

// 6. Report privacy: full email hash never leaves the server; click ids reduce
// to presence flags.
{
  const presented = presentSale({
    sale_id: 'payment:x', email_sha256: 'a'.repeat(64), fbc: 'fb.1.1.ABC', fbp: 'fb.1.1.2', fbclid: 'ABC',
    amount: 10, currency: 'USD', acquisition: 'exact_paid_meta',
  })
  assert.equal(presented.email_sha256, undefined)
  assert.equal(presented.fbc, undefined)
  assert.equal(presented.fbp, undefined)
  assert.equal(presented.fbclid, undefined)
  assert.equal(presented.has_fbc, true)
  assert.equal(presented.has_fbp, true)
  assert.equal(presented.has_fbclid, true)
  assert.equal(presented.customer_reference, 'a'.repeat(16))
}

// 7. Deterministic end-to-end fixture: Facebook ad click -> website journey ->
// checkout identity -> Uscreen order.paid -> reconciliation -> exactly one
// canonical Meta event carrying the exact ad identity.
{
  metaCalls = []
  const { processUscreenPayload } = await import('../api/_uscreen-webhook.js')
  const email = 'e2e.buyer@example.com'
  // Ad click lands on the website; a journey is minted with the ad identity.
  const { token } = await createOrTouchJourney({
    attribution: {
      utm_source: 'facebook', utm_medium: 'paid_social', utm_campaign: 'jf_coaches_max',
      utm_content: 'planning_session', campaign_id: '120249257260070035',
      adset_id: '120249271941100035', ad_id: '120249272080270035', placement: 'feed',
      fbclid: 'E2ECLICK', fbc: 'fb.1.1700000000000.E2ECLICK', fbp: 'fb.1.1700000000000.222',
    },
    page_path: '/app/for-coaches',
  })
  // Checkout: the head code links the buyer's email and Uscreen user id.
  await linkJourneyIdentity(token, { email, uscreenUserId: 'u-e2e-7' })
  // Uscreen sends the positive paid webhook (Stripe web charge, Max tier).
  const result = await processUscreenPayload({
    event: 'order.paid', email, user_id: 'u-e2e-7',
    order_id: 'e2e-order-7', transaction_id: 'ch_e2e_7', invoice_id: 'inv-e2e-7',
    event_date: new Date().toISOString(), offer_id: 202578, offer_title: 'Max - Annual',
    total: 249.99, currency: 'USD',
  })
  assert.equal(result.processed, true)
  assert.equal(result.reconciliation.classification, 'exact_paid_meta', 'the sale must join to the exact Meta journey')
  assert.equal(result.sale.acquisition, 'exact_paid_meta')
  assert.equal(result.sale.campaign, '120249257260070035')
  const canonical = metaCalls.filter((call) => call.data[0].event_name === 'JF_First_Paid_Membership')
  assert.equal(canonical.length, 0, 'unverified webhook never becomes a paid conversion')
  assert.equal(result.sale.amount, null, 'unverified webhook amount is excluded')
  // A duplicate webhook delivery must not send a second canonical event.
  await processUscreenPayload({
    event: 'order.paid', email, user_id: 'u-e2e-7',
    order_id: 'e2e-order-7', transaction_id: 'ch_e2e_7', invoice_id: 'inv-e2e-7',
    event_date: new Date().toISOString(), offer_id: 202578, offer_title: 'Max - Annual',
    total: 249.99, currency: 'USD',
  })
  assert.equal(metaCalls.filter((call) => call.data[0].event_name === 'JF_First_Paid_Membership').length, 0, 'duplicate webhook must not re-emit')
}

// 8. Same email, two journeys (returning device plus fresh ad click): the most
// recently updated journey wins instead of failing ambiguous.
{
  const email = 'e2e.twojourneys@example.com'
  const emailHash = sha256(email)
  const { token: oldToken } = await createOrTouchJourney({ attribution: { utm_source: 'direct' }, page_path: '/' })
  await linkJourneyIdentity(oldToken, { email })
  await new Promise((resolve) => setTimeout(resolve, 5))
  const { token: adToken } = await createOrTouchJourney({
    attribution: {
      utm_source: 'fb', utm_medium: 'paid_social', utm_campaign: 'test-camp',
      campaign_id: '111', adset_id: '222', ad_id: '333', placement: 'feed',
      fbclid: 'TWOJRN', fbc: 'fb.1.1700000000000.TWOJRN',
    },
    page_path: '/app/for-coaches',
  })
  await linkJourneyIdentity(adToken, { email })
  const { reconcilePayment } = await import('../api/checkout-bridge.js')
  const result = await reconcilePayment({ email_hash: emailHash, event_date: new Date().toISOString() })
  assert.equal(result.join_method, 'hashed_email_latest', 'multiple same-email journeys must resolve to the latest touch')
  assert.equal(result.classification, 'exact_paid_meta')
  assert.equal(result.campaign, '111')
}

console.log('test-attribution-autosend: all assertions passed')
