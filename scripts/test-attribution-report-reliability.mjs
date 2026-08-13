import assert from 'node:assert/strict'
import handler from '../api/attribution-report.js'

process.env.ATTRIBUTION_REPORT_TOKEN = 'test-report-token'
process.env.KV_REST_API_URL = 'https://kv.invalid'
process.env.KV_REST_API_TOKEN = 'test-kv-token'

const calls = []
globalThis.fetch = async (_url, options) => {
  const command = JSON.parse(options.body)
  calls.push(command)
  const [verb, key] = command
  let result = null
  if (verb === 'ZREVRANGE' && key === 'jfa:reliability:sales:index') result = ['reconcile:payment-1']
  else if (verb === 'GET' && key === 'jfa:reliability:sale:reconcile:payment-1') result = JSON.stringify({
    sale_id: 'reconcile:payment-1', payment_id: 'payment-1', occurred_at: '2026-08-12T22:36:23.000Z',
    customer_name: 'Joe Ransom', customer_reference: '32668339', plan: 'Max - Annual', amount: 124.99,
    currency: 'USD', acquisition: 'unknown', confidence: 'none', evidence: ['no_safe_join'],
  })
  else if (verb === 'SCAN') result = ['0', []]
  else if (verb === 'ZRANGE') result = []
  else if (verb === 'ZADD') result = 0
  return { ok: true, json: async () => ({ result }) }
}

let statusCode = 0, body
const req = { method: 'GET', headers: { authorization: 'Bearer test-report-token' }, query: {} }
const res = { status(code) { statusCode = code; return this }, json(value) { body = value; return value } }
await handler(req, res)
assert.equal(statusCode, 200)
assert.equal(body.sales.length, 1)
assert.equal(body.sales[0].customer_name, 'Joe Ransom')
assert.equal(body.sales[0].payment_id, 'payment-1')
assert.ok(calls.some(([verb, key]) => verb === 'ZREVRANGE' && key === 'jfa:reliability:sales:index'))
console.log('attribution report reliability test passed')
