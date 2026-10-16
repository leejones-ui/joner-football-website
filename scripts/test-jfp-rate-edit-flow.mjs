// A session by session player's own rate (Lee, 17 Oct 2026: "when i edit it
// updates their accounts"), end to end against the local harness. Lee adds a
// session by session player at A$50, the family signs in and sees A$50 a
// session; Lee changes it to A$40 in Edit player, then to A$35 with a quote in
// Edit > quote; the account shows each new price at once (no stale copy).
//   npx astro build && node scripts/holiday-local.mjs 4321   (one terminal)
//   node scripts/test-jfp-rate-edit-flow.mjs 4321            (another)
// Every name, email and amount here is invented.
import assert from 'node:assert/strict'

const PORT = Number(process.argv[2] || 4321)
const B = `http://localhost:${PORT}`
let passed = 0
async function test(name, fn) { await fn(); passed += 1; console.log(`ok - ${name}`) }
let ipSeq = 90
function client() {
  const jar = new Map()
  const ip = `10.9.3.${ipSeq++}`
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
const GUARDIAN = { accepted: { terms: true, makeups: true, payment: true, emergency: true }, media: false, kind: 'parent' }

const lee = client()
await signIn(lee, 'leejones@jonerfootball.com', 'staff')
const ok = async (action, body = {}) => { const r = await lee.call('/api/jfp-portal-data', { action, ...body }); assert.equal(r.status, 200, `${action}: ${JSON.stringify(r.data)}`); return r.data }
const GROUP = (await ok('saveGroup', { group: { day: 'Thursday', time: '5pm', location: 'NTRA', coachId: 'lee', capacity: 12, mode: 'direct', label: 'Rates' } })).group.id
const EMAIL = 'rhea.rates@example.com'
const rowId = (await ok('addPlayer', { groupId: GROUP, force: true, player: { name: 'Remy Rates', dob: '2014-05-05' }, parent: { name: 'Rhea Rates', email: EMAIL, mobile: '0400 777 881' }, payment: 'sessions', perSessionCents: 5000, sendEmail: true })).rowId

const fam = client()
await signIn(fam, EMAIL)
const me = (await fam.call('/api/jfp-account', { action: 'overview' })).data.players[0]
assert.equal((await fam.call('/api/jfp-account', { action: 'signWaiver', players: [{ key: me.key, dob: '2014-05-05', emergencyName: 'Em Rates', emergencyPhone: '0400 555 667' }], waiver: { ...GUARDIAN, signature: 'Rhea Rates' }, parentName: 'Rhea Rates', mobile: '0400 777 881' })).status, 200)
const owed = async () => (await fam.call('/api/jfp-account', { action: 'overview' })).data.owed.find((x) => x.rowId === rowId)

await test('the family sees A$50 a session, and the rest of the term at A$50 each', async () => {
  const o = await owed()
  assert.equal(o.kind, 'prepay'); assert.equal(o.perCents, 5000)
  assert.equal(o.leftCents, o.left * 5000)
})
await test('Lee changes the rate to A$40 in Edit player: the account shows A$40 straight away', async () => {
  // Read the account first so a cached roster copy exists, then edit.
  await owed()
  await ok('editPlayer', { rowId, fields: { perSessionAud: 40 } })
  const o = await owed()
  assert.equal(o.perCents, 4000, JSON.stringify(o)); assert.equal(o.leftCents, o.left * 4000)
  assert.equal((await ok('playerQuote', { rowId })).quote.perCents, 4000, 'staff Edit shows the same price')
})
await test('Lee sets A$35 with "5 in a row at A$30" in the quote: the account offers exactly those', async () => {
  await ok('saveQuote', { rowId, perCents: 3500, tiers: [{ n: 5, cents: 3000 }] })
  const o = await owed()
  assert.equal(o.perCents, 3500)
  const opts = Object.fromEntries(o.quote.options.map((x) => [x.key, x.totalCents]))
  assert.equal(opts.one, 3500); assert.equal(opts['commit:5'], 15000)
})
await test('the family pays for one session: the link is for the new A$35', async () => {
  const r = await fam.call('/api/jfp-account', { action: 'payOwed', rowId, option: 'one' })
  assert.equal(r.status, 200, JSON.stringify(r.data))
  const ids = JSON.parse(await (await fetch(`${B}/__kv?cmd=${encodeURIComponent(JSON.stringify(['ZRANGE', 'jfp:payreqs', '0', '-1']))}`)).text())
  const qs = await Promise.all(ids.map(async (id) => JSON.parse(await (await fetch(`${B}/__kv?cmd=${encodeURIComponent(JSON.stringify(['GET', `jfp:payreq:${id}`]))}`)).text() || 'null')))
  const q = qs.filter((x) => x && (x.term4Ids || []).includes(rowId)).at(-1)
  assert.equal(q.amountCents, 3500, JSON.stringify(q))
})
console.log(`\n${passed} passed`)
