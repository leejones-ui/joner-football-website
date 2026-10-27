// extraSettle (28 Oct 2026, Revenue agent review): a paid family keeps its
// place; families still to pay stay while there is room, each one using it up;
// the rest come off. Runs on an in-memory KV, no harness.
import assert from 'node:assert/strict'
process.env.KV_REST_API_URL = 'http://kv.test'; process.env.KV_REST_API_TOKEN = 't'
const H = new Map(), S = new Map(), L = []
const run = ([c, ...a]) => {
  c = c.toUpperCase()
  if (c === 'HGETALL') return [...(H.get(a[0]) || new Map())].flat()
  if (c === 'HGET') return (H.get(a[0]) || new Map()).get(a[1]) ?? null
  if (c === 'HSET') { const h = H.get(a[0]) || new Map(); h.set(a[1], a[2]); H.set(a[0], h); return 1 }
  if (c === 'MGET') return a.map((k) => S.get(k) ?? null)
  if (c === 'GET') return S.get(a[0]) ?? null
  if (c === 'SET') { if (a.includes('NX') && S.has(a[0])) return null; S.set(a[0], a[1]); return 'OK' }
  if (c === 'DEL') { S.delete(a[0]); return 1 }
  if (c === 'LPUSH' || c === 'LTRIM' || c === 'EXPIRE') { L.push(a); return 1 }
  throw new Error('kv ' + c)
}
globalThis.fetch = async (url, init) => { const body = JSON.parse(init.body); const result = String(url).endsWith('/pipeline') ? body.map((x) => ({ result: run(x) })) : { result: run(body) }; return new Response(JSON.stringify(result)) }
const { extraSettle } = await import('../api/_jfp-extra.js')
const fam = (id, pay) => ({ id, name: id, email: `${id}@x.test`, from: 'family', payreqId: pay, status: 'booked' })
const slot = { id: 'XS-1', status: 'open', capacity: 2, date: '2026-11-05', time: '10:00am', location: 'Belrose HQ', bookings: [fam('a', 'P-a'), fam('b', 'P-b'), fam('c', 'P-c')] }
H.set('jfp:extra', new Map([['XS-1', JSON.stringify(slot)]]))
S.set('jfp:payreq:P-a', JSON.stringify({ id: 'P-a', status: 'paid' }))
for (const id of ['P-b', 'P-c']) S.set(`jfp:payreq:${id}`, JSON.stringify({ id, status: 'open' }))
const r = await extraSettle('P-a')
assert.deepEqual(r.removed.map((x) => x.payreqId), ['P-c'], 'one place left: the first family still to pay stays, the second comes off')
const after = JSON.parse(H.get('jfp:extra').get('XS-1'))
assert.deepEqual(after.bookings.filter((b) => b.status !== 'removed').map((b) => b.id), ['a', 'b'])
assert.equal(S.has('jfp:extra-lock:XS-1'), false, 'lock released')
// Held lock: settle waits, then goes on (a paid payment always finishes).
S.set('jfp:payreq:P-b', JSON.stringify({ id: 'P-b', status: 'paid' }))
S.set('jfp:extra-lock:XS-1', '1'); setTimeout(() => S.delete('jfp:extra-lock:XS-1'), 700)
const r2 = await extraSettle('P-b')
assert.deepEqual(r2.removed, [], 'both paid, full, nobody else to move')
// Revenue agent review: the family taken off had also just paid (closeCheckout
// came back 'complete', cancelCharge refuses). They go back on and Lee gets the
// two-families-paid alert, never "charge cancelled".
const { settleExtraPaid } = await import('../api/_jfp-extra-settle.js')
const slot3 = { id: 'XS-3', status: 'open', capacity: 1, date: '2026-11-05', time: '10:00am', location: 'Belrose HQ', bookings: [fam('x', 'P-x'), fam('y', 'P-y')] }
H.get('jfp:extra').set('XS-3', JSON.stringify(slot3))
S.set('jfp:payreq:P-x', JSON.stringify({ id: 'P-x', status: 'paid' })); S.set('jfp:payreq:P-y', JSON.stringify({ id: 'P-y', status: 'checkout' }))
const sent = []
const r3 = await settleExtraPaid('P-x', {
  listCharges: async () => [{ id: 'C-x', payreqId: 'P-x', playerName: 'x', amountCents: 7000 }, { id: 'C-y', payreqId: 'P-y', playerName: 'y', amountCents: 7000 }],
  cancelCharge: async () => ({ ok: false, status: 409, error: 'The family has just paid.' }),
  telegramAlert: async (t) => { sent.push(t) },
})
assert.deepEqual(r3.removed.map((x) => x.payreqId), ['P-y'])
const after3 = JSON.parse(H.get('jfp:extra').get('XS-3'))
assert.deepEqual(after3.bookings.map((b) => b.status), ['booked', 'booked'], 'the family that also paid is back on')
assert.equal(after3.bookings[1].removedBy, undefined)
assert.equal(sent.length, 1); assert.match(sent[0], /two families have paid/); assert.doesNotMatch(sent[0], /charge is cancelled/)
// A charge that does cancel still says so.
const slot4 = { ...slot3, id: 'XS-4', bookings: [fam('w', 'P-w'), fam('z', 'P-z')] }
H.get('jfp:extra').set('XS-4', JSON.stringify(slot4)); S.set('jfp:payreq:P-z', JSON.stringify({ id: 'P-z', status: 'open' })); S.set('jfp:payreq:P-w', JSON.stringify({ id: 'P-w', status: 'paid' }))
sent.length = 0
await settleExtraPaid('P-w', { listCharges: async () => [{ id: 'C-z', payreqId: 'P-z' }], cancelCharge: async () => ({ ok: true }), telegramAlert: async (t) => { sent.push(t) } })
assert.equal(JSON.parse(H.get('jfp:extra').get('XS-4')).bookings[1].status, 'removed')
assert.equal(sent.length, 1); assert.match(sent[0], /charge is cancelled/)
console.log('ok - extraSettle keeps families while there is room and waits for the booking lock\nok - a family that paid too goes back on; Lee is told two paid\n4 settle checks passed')
