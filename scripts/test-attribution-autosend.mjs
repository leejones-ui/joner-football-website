import assert from 'node:assert/strict'
import crypto from 'node:crypto'

// In-memory KV + Meta Graph mock behind global fetch, so the real modules run
// their production code paths unchanged.
process.env.KV_REST_API_URL = 'https://kv.invalid'
process.env.KV_REST_API_TOKEN = 'test'
process.env.META_CAPI_TOKEN = 'test-capi-token'
process.env.JOURNEY_SIGNING_SECRET = 'test-signing-secret'

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

// 1. Automatic canonical send: gates passed, value and currency present, Meta
// confirms receipt, claim becomes sent, exactly one Graph call.
{
  const data = { user_id: 'u-1001', order_id: 'ord-1', transaction_id: 'ch_test1', total: 249.99, currency: 'USD', event: 'order.paid' }
  const metaEvent = buildVerifiedMetaEvent('JF_First_Paid_Membership', data, 'buyer1@example.com', 249.99)
  const key = 'jf:meta:first-paid:test-user-1'
  const result = await attemptFirstPaidAutoSend({ key, record: { eventId: metaEvent.event_id }, metaEvent })
  assert.equal(result.sent, true, 'auto-send must succeed with value, currency and Meta receipt')
  assert.equal(metaCalls.length, 1, 'exactly one Meta call')
  const claim = JSON.parse(strings.get(key))
  assert.equal(claim.status, 'sent')
  assert.ok(claim.metaResponse, 'Meta response recorded on the claim')
}

// 2. Idempotency: a second attempt for the same user hits the send lock and
// never produces a second Meta call marked sent.
{
  metaCalls = []
  const data = { user_id: 'u-1001', order_id: 'ord-1', transaction_id: 'ch_test1', total: 249.99, currency: 'USD' }
  const metaEvent = buildVerifiedMetaEvent('JF_First_Paid_Membership', data, 'buyer1@example.com', 249.99)
  const key = 'jf:meta:first-paid:test-user-1'
  const result = await attemptFirstPaidAutoSend({ key, record: { eventId: metaEvent.event_id }, metaEvent })
  assert.equal(result.sent, false)
  assert.equal(result.reason, 'send-locked')
  assert.equal(metaCalls.length, 0, 'no duplicate Meta call under the lock')
}

// 3. Missing currency: held as candidate, no Meta call.
{
  metaCalls = []
  const data = { user_id: 'u-2002', order_id: 'ord-2', transaction_id: 'ch_test2', total: 39.99 }
  const metaEvent = buildVerifiedMetaEvent('JF_First_Paid_Membership', data, 'buyer2@example.com', 39.99)
  assert.equal(metaEvent.custom_data.currency, undefined)
  const key = 'jf:meta:first-paid:test-user-2'
  const result = await attemptFirstPaidAutoSend({ key, record: { eventId: metaEvent.event_id }, metaEvent })
  assert.equal(result.sent, false)
  assert.equal(result.reason, 'missing-currency')
  assert.equal(metaCalls.length, 0)
  assert.equal(JSON.parse(strings.get(key)).status, 'candidate')
}

// 4. Meta does not confirm receipt: held for retry, alert recorded.
{
  metaCalls = []
  metaResponse = { events_received: 0 }
  const data = { user_id: 'u-3003', order_id: 'ord-3', transaction_id: 'ch_test3', total: 19.99, currency: 'USD' }
  const metaEvent = buildVerifiedMetaEvent('JF_First_Paid_Membership', data, 'buyer3@example.com', 19.99)
  const key = 'jf:meta:first-paid:test-user-3'
  const result = await attemptFirstPaidAutoSend({ key, record: { eventId: metaEvent.event_id }, metaEvent })
  assert.equal(result.sent, false)
  assert.equal(result.reason, 'send-failed')
  const claim = JSON.parse(strings.get(key))
  assert.equal(claim.status, 'candidate')
  assert.equal(Number(claim.attempts), 1)
  const alerts = (lists.get('jfa:alerts:list') || []).map((row) => JSON.parse(row))
  assert.ok(alerts.some((alert) => alert.type === 'canonical_event_send_failed'), 'send failure raises an alert')
  metaResponse = { events_received: 1 }
}

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

console.log('test-attribution-autosend: all assertions passed')
