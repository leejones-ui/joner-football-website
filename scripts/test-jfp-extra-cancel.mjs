// Family cancels an extra session in My account, and the updated terms
// (Lee, 5 Nov 2026), end to end against the local harness.
//   npm run build && HOLIDAY_LOCAL_PORT=4799 node scripts/holiday-local.mjs   (one terminal)
//   node scripts/test-jfp-extra-cancel.mjs 4799                              (another)
// Every name, email and amount here is invented.
import assert from 'node:assert/strict'

const B = `http://localhost:${Number(process.argv[2] || 4321)}`
let passed = 0
async function test(name, fn) { await fn(); passed += 1; console.log(`ok - ${name}`) }
function client() {
  const jar = new Map()
  const call = async (path, body) => {
    const res = await fetch(`${B}${path}`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/json', origin: B, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') }, body: JSON.stringify(body) })
    for (const c of res.headers.getSetCookie?.() || []) { const [kv] = c.split(';'); const i = kv.indexOf('='); if (kv.slice(i + 1)) jar.set(kv.slice(0, i), kv.slice(i + 1)); else jar.delete(kv.slice(0, i)) }
    return { status: res.status, data: await res.json().catch(() => ({})) }
  }
  return { call }
}
const getJson = async (p) => (await fetch(`${B}${p}`)).json()
const emails = () => getJson('/__emails')
async function signIn(c, email, audience) {
  const s = await c.call('/api/jfp-auth', { action: 'start', email, audience, mobile: '0412 345 678' })
  assert.equal(s.status, 200, JSON.stringify(s.data))
  const code = (await emails()).filter((e) => e.to.includes(email) && /sign-in code/.test(e.subject)).at(-1).subject.match(/(\d{6})/)[1]
  assert.equal((await c.call('/api/jfp-auth', { action: 'verify', challenge: s.data.challenge, code })).status, 200)
}
const ok = async (r) => { const x = await r; assert.equal(x.status, 200, JSON.stringify(x.data)); return x.data }
const lee = client()
await signIn(lee, 'leejones@jonerfootball.com', 'staff')
const L = (action, body = {}) => lee.call('/api/jfp-portal-data', { action, ...body })
const players = (await ok(L('playersList'))).players
const row = players.find((p) => p.email && p.holdsPlace && p.waiver?.onFile && players.filter((x) => x.email === p.email).length === 1)
const fam = client()
await signIn(fam, row.email, 'parent')
const A = (action, body = {}) => fam.call('/api/jfp-account', { action, ...body })
const day = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date(Date.now() + n * 86400000))
const live = async (id) => (await ok(L('extraList', { coachId: '' }))).slots.find((s) => s.id === id).bookings.filter((b) => b.status !== 'removed')

await test('every family is asked to tick the updated terms once', async () => {
  assert.ok((await ok(A('overview'))).termsAsk)
  await ok(A('acceptTerms'))
  assert.equal((await ok(A('overview'))).termsAsk, null)
})

let slot
await test('booking an extra session needs the extra terms ticked', async () => {
  slot = (await ok(L('extraSave', { slot: { coachId: 'dean', date: day(4), time: '9:00am', capacity: 1, location: 'Belrose HQ', priceCents: 12000, title: '1 on 1', visibility: 'public' } }))).slot
  const kid = (await ok(A('overview'))).players[0]
  const no = await A('bookExtra', { slotId: slot.id, playerKey: kid.key })
  assert.equal(no.status, 400); assert.equal(no.data.code, 'terms')
  assert.equal((await live(slot.id)).length, 0, 'nothing held')
  const yes = await A('bookExtra', { slotId: slot.id, playerKey: kid.key, acceptTerms: true })
  assert.equal(yes.status, 200, JSON.stringify(yes.data))
  assert.equal((await live(slot.id)).length, 1)
})

await test('an unpaid booking: Cancel shows, nothing to refund, the place opens and the coach is told', async () => {
  const b = (await ok(A('overview'))).extras.booked.find((x) => x.id === slot.id)
  assert.deepEqual([b.cancel.paid, b.cancel.refundCents], [false, 0])
  const q = await ok(A('cancelExtra', { slotId: slot.id }))
  assert.equal(q.quote.refundCents, 0)
  assert.equal((await live(slot.id)).length, 1, 'a quote changes nothing')
  const before = (await emails()).length
  const r = await ok(A('cancelExtra', { slotId: slot.id, confirm: true }))
  assert.equal(r.refundCents, 0)
  assert.equal((await live(slot.id)).length, 0, 'the place is open again')
  assert.ok((await emails()).slice(before).some((e) => /Extra session cancelled/.test(e.subject)), 'the coach is emailed')
  const again = await A('cancelExtra', { slotId: slot.id, confirm: true })
  assert.equal(again.status, 404, 'cancelling twice does nothing')
})

await test('a session booked by a coach cannot be cancelled by the family', async () => {
  const s2 = (await ok(L('extraSave', { slot: { coachId: 'dean', date: day(5), time: '9:00am', capacity: 1, location: 'Belrose HQ', priceCents: 12000, title: '1 on 1', visibility: 'private' } }))).slot
  await ok(L('extraAttach', { slotId: s2.id, name: row.name || row.player, email: row.email }))
  const b = (await ok(A('overview'))).extras.booked.find((x) => x.id === s2.id)
  assert.equal(b?.cancel ?? null, null)
  assert.equal((await A('cancelExtra', { slotId: s2.id, confirm: true })).status, 404)
})

console.log(`\n${passed} extra cancel checks passed`)
