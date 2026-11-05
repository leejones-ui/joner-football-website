// refundPayreq (5 Nov 2026) against a fake KV and a fake Stripe. Every name,
// id and amount here is invented; nothing reaches Stripe.
import assert from 'node:assert/strict'

process.env.KV_REST_API_URL = 'https://kv.invalid'
process.env.KV_REST_API_TOKEN = 'test-only'
process.env.STRIPE_SECRET_KEY_SYDNEY = 'sk_test_only'
const { refundPayreq, refundRoom } = await import('../api/_jfp-refund-actions.js')

let kv, refunds, posts, applied
const PAY = 'PAY-1790000000000-AAAAAA'
function reset({ status = 'paid', refunded = 0 } = {}) {
  kv = new Map([[`jfp:payreq:${PAY}`, JSON.stringify({ id: PAY, status, programme: 'extra', charge: { id: 'CHG-1', kind: 'extra' }, stripePaymentIntentId: 'pi_test', refundedCents: refunded })]])
  refunds = refunded ? [{ id: 're_old', amount: refunded, status: 'succeeded' }] : []
  posts = []
  applied = 0
}
const charge = () => ({ id: 'ch_test', amount: 12000, amount_refunded: refunds.reduce((t, r) => t + r.amount, 0), payment_intent: 'pi_test', refunds: { data: refunds } })
globalThis.fetch = async (url, init = {}) => {
  const u = String(url)
  if (u.startsWith('https://kv.invalid')) {
    const cmd = JSON.parse(init.body)
    if (Array.isArray(cmd[0])) return { ok: true, json: async () => cmd.map(() => ({ result: 1 })) }
    let result = null
    if (cmd[0] === 'GET') result = kv.get(cmd[1]) ?? null
    else if (cmd[0] === 'SET') { if (cmd.includes('NX') && kv.has(cmd[1])) result = null; else { kv.set(cmd[1], cmd[2]); result = 'OK' } }
    else if (cmd[0] === 'DEL') { kv.delete(cmd[1]); result = 1 }
    else if (cmd[0] === 'LPUSH' || cmd[0] === 'LTRIM') result = 1
    else throw new Error(`fake KV: ${cmd[0]}`)
    return { ok: true, json: async () => ({ result }) }
  }
  if (u.startsWith('https://api.stripe.com/v1/payment_intents/pi_test')) return { ok: true, json: async () => ({ id: 'pi_test', latest_charge: charge(), metadata: { jfpBookingId: PAY } }) }
  if (u.startsWith('https://api.stripe.com/v1/refunds')) {
    const body = Object.fromEntries(new URLSearchParams(init.body))
    posts.push({ body, key: init.headers['idempotency-key'] })
    const r = { id: `re_${posts.length}`, amount: Number(body.amount), status: 'succeeded' }
    refunds.push(r)
    return { ok: true, json: async () => r }
  }
  if (u.startsWith('https://api.stripe.com/v1/charges/ch_test')) { applied += 1; return { ok: true, json: async () => charge() } }
  // applyJfpRefunds reads more (Airtable, email); those are not under test here.
  throw new Error(`not in this test: ${u}`)
}
const quiet = console.error
console.error = () => {}

let passed = 0
async function test(name, fn) { reset(); await fn(); passed += 1; console.log(`ok - ${name}`) }

await test('the room: paid A$120, the amount starts at A$115', async () => {
  const r = await refundRoom(PAY)
  assert.deepEqual([r.paidCents, r.refundedCents, r.roomCents, r.suggestCents], [12000, 0, 12000, 11500])
})
await test('refunds the amount in Stripe once, with an idempotency key, then applies it', async () => {
  const r = await refundPayreq({ payreqId: PAY, amountCents: 11500, by: 'lee@example.com', reason: 'Cancelled with 24 hours notice' })
  assert.equal(r.ok, true)
  assert.equal(r.refundId, 're_1')
  assert.equal(posts.length, 1)
  assert.deepEqual([posts[0].body.charge, posts[0].body.amount, posts[0].body['metadata[jfpPayreqId]'], posts[0].body['metadata[by]']], ['ch_test', '11500', PAY, 'lee@example.com'])
  assert.equal(posts[0].key, `jfp-refund:${PAY}:0:11500`)
  assert.equal(applied, 1, 'applied straight away, not left for the webhook')
  assert.equal(kv.has(`jfp:refund-request:${PAY}`), false, 'the lock is let go')
})
await test('never more than is left: A$5 left after A$115 back', async () => {
  reset({ refunded: 11500 })
  const r = await refundPayreq({ payreqId: PAY, amountCents: 1000, by: 'lee@example.com' })
  assert.equal(r.ok, false)
  assert.match(r.error, /Only A\$5/)
  assert.equal(posts.length, 0)
})
await test('nothing for an unpaid payment, a bad amount, or no name', async () => {
  for (const args of [{ amountCents: 0, by: 'x' }, { amountCents: -100, by: 'x' }, { amountCents: 'abc', by: 'x' }, { amountCents: 100, by: '' }]) assert.equal((await refundPayreq({ payreqId: PAY, ...args })).ok, false)
  reset({ status: 'open' })
  assert.match((await refundPayreq({ payreqId: PAY, amountCents: 100, by: 'x' })).error, /Only a paid payment/)
  assert.equal(posts.length, 0)
})
await test('a second tap while one is going through does nothing', async () => {
  kv.set(`jfp:refund-request:${PAY}`, '1')
  const r = await refundPayreq({ payreqId: PAY, amountCents: 11500, by: 'lee@example.com' })
  assert.equal(r.ok, false)
  assert.match(r.error, /already going through/)
  assert.equal(posts.length, 0)
})

console.error = quiet
console.log(`\n${passed} refund checks passed`)
