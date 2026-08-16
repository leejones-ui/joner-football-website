import assert from 'node:assert/strict'
import {
  appendReliableSale,
  listReliableSales,
  recordWebhookFailure,
  listWebhookFailures,
  replayWebhookFailure,
  reconcileAuthoritativePayments,
  reliablePaymentIdentity,
  getAnonymousAggregates,
  MAX_DETAILED_SALES,
} from '../api/_reliability-ledger.js'
import reliabilityHandler from '../api/uscreen-reliability.js'

const strings = new Map()
const hashes = new Map()
const zsets = new Map()
const lists = new Map()
let failCommand = null
async function fakeFetch(_url, options) {
  const [command, ...args] = JSON.parse(options.body)
  if (command === failCommand) { failCommand = null; throw new Error('partial KV failure') }
  let result = null
  if (command === 'SET') {
    const [key, value, ...opts] = args
    if (opts.includes('NX') && strings.has(key)) result = null
    else { strings.set(key, value); result = 'OK' }
  } else if (command === 'GET') result = strings.get(args[0]) || null
  else if (command === 'DEL') { for (const key of args) strings.delete(key); result = args.length }
  else if (command === 'SCAN') {
    const keys = [...new Set([...strings.keys(), ...hashes.keys()])].filter((key) => key.startsWith(args[2]?.replace('*', '') || ''))
    result = ['0', keys]
  } else if (command === 'ZADD') { const [key, score, member] = args; if (!zsets.has(key)) zsets.set(key, new Map()); zsets.get(key).set(member, Number(score)); result = 1 }
  else if (command === 'ZRANGE' || command === 'ZREVRANGE') {
    const map = zsets.get(args[0]) || new Map(); let rows = [...map.entries()].sort((a,b) => a[1]-b[1]).map(([k]) => k); if (command === 'ZREVRANGE') rows.reverse(); const start=Number(args[1]); const e=Number(args[2]); const end=e < 0 ? rows.length+e : e; result=end < start ? [] : rows.slice(start,end+1)
  } else if (command === 'ZREM') { const map=zsets.get(args[0]); for (const key of args.slice(1)) map?.delete(key); result=args.length-1 }
  else if (command === 'HINCRBY') { const [key, field, amount] = args; if (!hashes.has(key)) hashes.set(key, new Map()); const map=hashes.get(key); map.set(field, Number(map.get(field)||0)+Number(amount)); result=map.get(field) }
  else if (command === 'HGETALL') { const map=hashes.get(args[0]) || new Map(); result=[...map].flat() }
  else if (command === 'LPUSH') { if (!lists.has(args[0])) lists.set(args[0], []); lists.get(args[0]).unshift(...args.slice(1)); result=lists.get(args[0]).length }
  else if (command === 'LRANGE') { const rows=lists.get(args[0])||[]; result=rows.slice(Number(args[1]), Number(args[2])+1) }
  else if (command === 'MULTI') result = 'OK'
  else if (command === 'EXEC') result = []
  return { ok: true, json: async () => ({ result }) }
}
process.env.KV_REST_API_URL = 'https://kv.invalid'; process.env.KV_REST_API_TOKEN = 'test'

assert.equal(reliablePaymentIdentity({}), '')
await assert.rejects(
  () => appendReliableSale({ occurred_at: '2026-01-01T00:00:00Z', amount: 10 }, fakeFetch),
  /payment identity is required/,
)

await appendReliableSale({ sale_id: 'a', occurred_at: '2026-01-01T00:00:00Z', amount: 10, acquisition: 'facebook' }, fakeFetch)
assert.equal((await appendReliableSale({ sale_id: 'a', amount: 10, currency: 'AUD', acquisition: 'unknown' }, fakeFetch)).duplicate, true)
const updatedDuplicate = (await listReliableSales(fakeFetch)).find((sale) => sale.sale_id === 'a')
assert.equal(updatedDuplicate.currency, 'AUD')
assert.equal(updatedDuplicate.acquisition, 'facebook')
for (let i=1;i<=MAX_DETAILED_SALES;i++) await appendReliableSale({ sale_id: String(i), occurred_at: `2026-01-01T00:00:${String(i).padStart(2,'0')}Z`, amount: 1, acquisition: 'facebook' }, fakeFetch)
assert.equal((await listReliableSales(fakeFetch)).length, MAX_DETAILED_SALES)
failCommand = 'ZADD'
await assert.rejects(() => appendReliableSale({ sale_id: 'partial', occurred_at: '2026-01-02T00:00:00Z', amount: 4, acquisition: 'email' }, fakeFetch))
assert.ok((await listReliableSales(fakeFetch)).some((sale) => sale.sale_id === 'partial'))

await recordWebhookFailure({ event_id: 'evt-1', payload: { event: 'order.paid' }, error: 'Brevo down' }, fakeFetch)
assert.equal((await listWebhookFailures(fakeFetch))[0].event_id, 'evt-1')
let replayed = 0
assert.equal((await replayWebhookFailure('evt-1', async () => { replayed++ }, fakeFetch)).status, 'replayed')
assert.equal(replayed, 1)

await reconcileAuthoritativePayments([{ payment_id: 'r1', amount: 7, currency: 'USD', occurred_at: '2026-02-01T00:00:00Z', channel: 'google' }], fakeFetch)
await appendReliableSale({ sale_id: 'payment:provider-1', kind: 'payment', payment_id: 'provider-1', amount: 9 }, fakeFetch)
assert.equal((await appendReliableSale({ sale_id: 'payment:provider-1', kind: 'payment', payment_id: 'provider-1', amount: 9 }, fakeFetch)).duplicate, true)
assert.equal((await appendReliableSale({ sale_id: 'renewal:provider-1', kind: 'renewal', payment_id: 'provider-1', amount: 9 }, fakeFetch)).duplicate, false)
assert.equal((await appendReliableSale({ sale_id: 'refund:provider-1', kind: 'refund', payment_id: 'provider-1', amount: -9 }, fakeFetch)).duplicate, false)
await reconcileAuthoritativePayments([{ payment_id: 'r1', amount: 7, currency: 'USD', occurred_at: '2026-02-01T00:00:00Z', channel: 'google' }], fakeFetch)
await reconcileAuthoritativePayments(Array.from({ length: 55 }, (_, i) => ({ payment_id: `r${i + 2}`, amount: 1, occurred_at: '2026-02-02T00:00:00Z', channel: 'google' })), fakeFetch)
const aggregates = await getAnonymousAggregates(fakeFetch)
assert.equal(aggregates.google.count, 56)
assert.equal(aggregates.google.revenue, 62)
assert.equal((await listReliableSales(fakeFetch)).length, MAX_DETAILED_SALES)

const originalFetch = globalThis.fetch
globalThis.fetch = fakeFetch
process.env.USCREEN_RELIABILITY_TOKEN = 'test-token'
let responseStatus = 0
let responseBody
const response = {
  status(value) { responseStatus = value; return this },
  json(value) { responseBody = value; return value },
}
await reliabilityHandler({ method: 'GET', headers: { authorization: 'Bearer test-token' } }, response)
globalThis.fetch = originalFetch
assert.equal(responseStatus, 200)
assert.ok(Array.isArray(responseBody.sales))
assert.equal(responseBody.sales.length, MAX_DETAILED_SALES)
console.log('reliability layer tests passed')
