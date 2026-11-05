// A refunded extra session frees its place (Lee, 5 Nov 2026). Runs on its own:
//   node scripts/test-jfp-extra-refund-release.mjs
import assert from 'node:assert/strict'
process.env.KV_REST_API_URL = 'http://kv.local'; process.env.KV_REST_API_TOKEN = 'local'
const H = new Map(), S = new Map()
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init?.body || '[]')
  const run = ([c, ...a]) => {
    c = String(c).toUpperCase()
    if (c === 'HSET') { const h = H.get(a[0]) || new Map(); for (let i = 1; i < a.length; i += 2) h.set(a[i], a[i + 1]); H.set(a[0], h); return 1 }
    if (c === 'HGET') return H.get(a[0])?.get(a[1]) ?? null
    if (c === 'HGETALL') return [...(H.get(a[0]) || new Map())].flat()
    if (c === 'HVALS') return [...(H.get(a[0]) || new Map()).values()]
    if (c === 'SET') { if (a.includes('NX') && S.has(a[0])) return null; S.set(a[0], a[1]); return 'OK' }
    if (c === 'DEL') { S.delete(a[0]); return 1 }
    if (c === 'GET') return S.get(a[0]) ?? null
    return null
  }
  const out = Array.isArray(body[0]) ? body.map((x) => ({ result: run(x) })) : { result: run(body) }
  return new Response(JSON.stringify(out), { status: 200 })
}
const { releaseExtraForPayreq, getSlot } = await import('../api/_jfp-extra.js')
const slot = { id: 'XS-1-AAAAAA', coachId: 'dean', date: '2099-01-04', time: '10:00am', capacity: 1, status: 'open', visibility: 'public', bookings: [{ id: 'XB-1-A', name: 'Kay', payreqId: 'PAY-1-A', status: 'booked', from: 'family' }] }
H.set('jfp:extra', new Map([[slot.id, JSON.stringify(slot)]]))
let passed = 0
const left = async () => (await getSlot(slot.id)).bookings.filter((b) => b.status !== 'removed').length
assert.deepEqual((await releaseExtraForPayreq({ id: 'PAY-1-A', paidCents: 12000, refundedCents: 2000 })).released, []); assert.equal(await left(), 1); passed++
const r = await releaseExtraForPayreq({ id: 'PAY-1-A', paidCents: 12000, refundedCents: 11500 })
assert.deepEqual(r.released, ['XB-1-A']); assert.equal(await left(), 0); passed++
assert.deepEqual((await releaseExtraForPayreq({ id: 'PAY-1-A', paidCents: 12000, refundedCents: 12000 })).released, [], 'twice is safe'); passed++
console.log(`${passed} passed`)
