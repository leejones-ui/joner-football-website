import assert from 'node:assert/strict'
import { isGa4PurchaseCandidate, buildGa4Purchase, sendRecentSalesToGa4, fallbackClientId } from '../api/_ga4-sales.js'

const now = Date.parse('2026-10-31T10:00:00Z')
const sale = { kind: 'payment', payment_status: 'paid', provider_payment_id: 'inv1', amount: 14.99, currency: 'usd', occurred_at: '2026-10-31T08:00:00Z', uscreen_user_id: '42', acquisition: 'meta_paid', source: 'fb', medium: 'paid_social', campaign: 'unknown' }

assert.equal(isGa4PurchaseCandidate(sale, now), true)
assert.equal(isGa4PurchaseCandidate({ ...sale, kind: 'renewal' }, now), false)
assert.equal(isGa4PurchaseCandidate({ ...sale, payment_status: 'refunded' }, now), false)
assert.equal(isGa4PurchaseCandidate({ ...sale, amount: 0 }, now), false)
assert.equal(isGa4PurchaseCandidate({ ...sale, provider_payment_id: 'unknown' }, now), false)
assert.equal(isGa4PurchaseCandidate({ ...sale, occurred_at: '2026-10-27T08:00:00Z' }, now), false)

const body = buildGa4Purchase(sale, '111.222')
assert.equal(body.client_id, '111.222')
assert.equal(body.user_id, 'uscreen:42')
assert.equal(body.events[0].name, 'purchase')
assert.equal(body.events[0].params.transaction_id, 'inv1')
assert.equal(body.events[0].params.currency, 'USD')
assert.equal(body.events[0].params.jf_source, 'fb')
assert.equal('jf_campaign' in body.events[0].params, false)
assert.match(buildGa4Purchase(sale).client_id, /^\d+\.\d+$/)
assert.equal(fallbackClientId('42'), fallbackClientId('42'))

process.env.GA4_MP_API_SECRET = 'test-secret'
const claimed = new Set(); const posts = []
const kv = async ([cmd, key]) => {
  if (cmd === 'SET') { if (claimed.has(key)) return { result: null }; claimed.add(key); return { result: 'OK' } }
  if (cmd === 'DEL') { claimed.delete(key); return { result: 1 } }
  return { result: null }
}
const fetchImpl = async (url, opts) => { posts.push({ url, body: JSON.parse(opts.body) }); return { ok: true } }
const list = async () => [sale, { ...sale, kind: 'renewal', provider_payment_id: 'inv2' }]
const first = await sendRecentSalesToGa4({ list, kv, fetchImpl, now })
assert.deepEqual(first, { candidates: 1, sent: 1, already: 0, failed: 0, joined_session: 0 })
const second = await sendRecentSalesToGa4({ list, kv, fetchImpl, now })
assert.equal(second.already, 1); assert.equal(posts.length, 1)
assert.match(posts[0].url, /measurement_id=G-H73LP37D8D/)

const failing = await sendRecentSalesToGa4({ list: async () => [{ ...sale, provider_payment_id: 'inv3' }], kv, fetchImpl: async () => ({ ok: false, status: 500 }), now })
assert.equal(failing.failed, 1); assert.equal(claimed.has('jfa:ga4:purchase-sent:inv3'), false)

delete process.env.GA4_MP_API_SECRET
assert.deepEqual(await sendRecentSalesToGa4({ list, kv, fetchImpl, now }), { skipped: 'no-ga4-secret' })
console.log('ga4 sales tests passed')
