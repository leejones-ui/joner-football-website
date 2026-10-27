// Free place (Lee, 27 Oct 2026: a staff member testing the JF App had to be
// recorded as paying A$1). Edit player > Free place: fee A$0, marked Paid, no
// payment and no ledger row, and the JF App unlocks. Against the local harness:
//   npx astro build && HOLIDAY_LOCAL_PORT=4799 node scripts/holiday-local.mjs 4799   (one terminal)
//   node scripts/test-jfp-free-place.mjs 4799                                       (another)
// Every name and email here is invented. Nothing is charged.
import assert from 'node:assert/strict'

const PORT = Number(process.argv[2] || 4321)
const B = `http://localhost:${PORT}`
let passed = 0
async function test(name, fn) { await fn(); passed += 1; console.log(`ok - ${name}`) }

let ipSeq = 40
function client() {
  const jar = new Map()
  const ip = `10.9.8.${ipSeq++}`
  const call = async (path, body) => {
    const res = await fetch(`${B}${path}`, { method: body ? 'POST' : 'GET', redirect: 'manual', headers: { 'content-type': 'application/json', origin: B, 'x-forwarded-for': ip, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') }, body: body ? JSON.stringify(body) : undefined })
    for (const c of res.headers.getSetCookie?.() || []) { const [kv] = c.split(';'); const i = kv.indexOf('='); if (kv.slice(i + 1)) jar.set(kv.slice(0, i), kv.slice(i + 1)); else jar.delete(kv.slice(0, i)) }
    return { status: res.status, data: await res.json().catch(() => ({})) }
  }
  return { call }
}
const emails = async () => (await fetch(`${B}/__emails`)).json()
async function signIn(c, email, audience = 'parent') {
  const s = await c.call('/api/jfp-auth', { action: 'start', email, audience })
  assert.equal(s.status, 200, JSON.stringify(s.data))
  const code = (await emails()).filter((e) => e.to.includes(email) && /sign-in code/.test(e.subject)).at(-1).subject.match(/(\d{6})/)[1]
  assert.equal((await c.call('/api/jfp-auth', { action: 'verify', challenge: s.data.challenge, code })).status, 200)
}

const lee = client()
await signIn(lee, 'leejones@jonerfootball.com', 'staff')
const call = (action, body = {}) => lee.call('/api/jfp-portal-data', { action, ...body })
const ok = async (action, body = {}) => { const r = await call(action, body); assert.equal(r.status, 200, `${action}: ${JSON.stringify(r.data)}`); return r.data }
const GID = (await ok('saveGroup', { group: { day: 'Thursday', time: '7:30am', location: 'NTRA', coachId: 'lee', capacity: 16, mode: 'direct' } })).group.id
const row = async (rowId) => (await ok('getProfile', { rowId })).row

let seq = 0
async function place(surname) {
  seq += 1
  const email = `${surname.toLowerCase()}.free${seq}@example.com`
  const a = await ok('addPlayer', { groupId: GID, force: true, player: { name: `Kai ${surname}`, dob: `2011-0${seq}-1${seq}` }, parent: { name: `Jo ${surname}`, email, mobile: `0400 552 ${100 + seq}` }, payment: 'none' })
  await ok('editPlayer', { rowId: a.rowId, fields: { paymentType: 'JFP 10 weeks', feeAud: 750 } })
  const c = client()
  await signIn(c, email)
  const app = async () => (await c.call('/api/jfp-account', { action: 'appAccessState' })).data.app
  return { rowId: a.rowId, app }
}

const staff = await place('Moreau')
const paid1 = await place('Halvorsen')

await test('an unpaid place: no JF App', async () => {
  assert.equal((await staff.app()).eligible, false)
})

await test('Free place: fee A$0, Paid, JF App unlocks, nothing recorded as paid', async () => {
  await ok('editPlayer', { rowId: staff.rowId, fields: { freePlace: true } })
  const r = await row(staff.rowId)
  assert.equal(r.freePlace, true)
  assert.equal(Number(r.feeAud), 0)
  assert.equal(Number(r.paidAud || 0), 0)
  assert.equal((await staff.app()).eligible, true)
})

await test('a free place cannot be given a fee without unticking it', async () => {
  const r = await call('editPlayer', { rowId: staff.rowId, fields: { feeAud: 750 } })
  assert.equal(r.status, 400)
  assert.match(r.data.error, /Untick Free place/)
})

await test('nor turned into session by session or a trial while free', async () => {
  const r = await call('editPlayer', { rowId: staff.rowId, fields: { paymentType: 'JFP Session by session' } })
  assert.equal(r.status, 400)
})

await test('unticking: back to Unpaid with the new fee, and the JF App locks again', async () => {
  await ok('editPlayer', { rowId: staff.rowId, fields: { freePlace: false, feeAud: 750 } })
  const r = await row(staff.rowId)
  assert.equal(r.freePlace, false)
  assert.equal(Number(r.feeAud), 750)
  assert.equal((await staff.app()).eligible, false)
})

await test('money already paid is never written off: undo it first', async () => {
  await ok('recordPayment', { rowIds: [paid1.rowId], amountCents: 100, method: 'cash' })
  const r = await call('editPlayer', { rowId: paid1.rowId, fields: { freePlace: true } })
  assert.equal(r.status, 400)
  assert.match(r.data.error, /Undo that payment first/)
  assert.equal((await row(paid1.rowId)).freePlace, false)
})

await test('a trial cannot be a free place', async () => {
  const t = await place('Szabo')
  await ok('editPlayer', { rowId: t.rowId, fields: { paymentType: 'JFP Trial' } })
  const r = await call('editPlayer', { rowId: t.rowId, fields: { freePlace: true } })
  assert.equal(r.status, 400)
})

console.log(`\n${passed} passed`)
