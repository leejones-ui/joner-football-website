// Refund a JFP term fee from a player's payment history (Lee, 5 Nov 2026),
// end to end against the local harness. Every name, email and amount is invented.
//   npm run build && HOLIDAY_LOCAL_PORT=4799 node scripts/holiday-local.mjs   (one terminal)
//   node scripts/test-jfp-term-refund-flow.mjs 4799                          (another)
import assert from 'node:assert/strict'

const B = `http://localhost:${Number(process.argv[2] || 4321)}`
let passed = 0
async function test(name, fn) { await fn(); passed += 1; console.log(`ok - ${name}`) }
const jar = new Map()
const call = async (path, body) => {
  const res = await fetch(`${B}${path}`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/json', origin: B, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') }, body: JSON.stringify(body) })
  for (const c of res.headers.getSetCookie?.() || []) { const [kv] = c.split(';'); const i = kv.indexOf('='); if (kv.slice(i + 1)) jar.set(kv.slice(0, i), kv.slice(i + 1)); else jar.delete(kv.slice(0, i)) }
  return { status: res.status, data: await res.json().catch(() => ({})) }
}
const emails = async () => (await fetch(`${B}/__emails`)).json()
const s = await call('/api/jfp-auth', { action: 'start', email: 'leejones@jonerfootball.com', audience: 'staff', mobile: '0412 345 678' })
const code = (await emails()).filter((e) => /sign-in code/.test(e.subject)).at(-1).subject.match(/(\d{6})/)[1]
assert.equal((await call('/api/jfp-auth', { action: 'verify', challenge: s.data.challenge, code })).status, 200)
const P = (action, body = {}) => call('/api/jfp-portal-data', { action, ...body })
const ok = async (r) => { const x = await r; assert.equal(x.status, 200, JSON.stringify(x.data)); return x.data }

const row = (await ok(P('playersList'))).players.find((p) => p.email && p.holdsPlace)
await (await fetch(`${B}/__stripe-seed`, { method: 'POST', body: JSON.stringify({ cents: 85000, email: row.email, name: row.parent || 'Pat Sample', link: 'plink_jfp850' }) })).json()

let pay
await test('the payment history shows the Stripe term fee with what the term refund needs', async () => {
  const h = (await ok(P('playerPayments', { rowId: row.rowId }))).player
  pay = h.stripe.find((x) => x.cents === 85000)
  assert.ok(pay, 'the A$850 payment is listed')
  assert.ok(pay.intentId.startsWith('pi_'))
  assert.deepEqual(Object.keys(h.termRefund).sort(), ['had', 'half', 'weeks'])
})
await test('Refund: the room, then A$800 back (before term, less A$50), once', async () => {
  const room = await ok(P('refundRoom', { stripeId: pay.intentId }))
  assert.deepEqual([room.paidCents, room.roomCents], [85000, 85000])
  const r = await ok(P('refundPayment', { stripeId: pay.intentId, amountCents: 80000, reason: 'Before the first session' }))
  assert.match(r.refundId, /^re_/)
  const again = await P('refundPayment', { stripeId: pay.intentId, amountCents: 10000 })
  assert.equal(again.status, 400); assert.match(again.data.error, /Only A\$50/)
  const h = (await ok(P('playerPayments', { rowId: row.rowId }))).player
  assert.equal(h.stripe.find((x) => x.id === pay.id).refundedCents, 80000)
})
console.log(`\n${passed} term refund checks passed`)
