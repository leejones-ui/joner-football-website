// New accounts (Lee, 16 Oct 2026): a red count when someone new makes an
// account, the list with their players, and opening it clears the count.
//   node scripts/holiday-local.mjs 4321 (after npm run build), then
//   node scripts/test-jfp-new-accounts.mjs 4321
import assert from 'node:assert/strict'

const B = `http://localhost:${process.argv[2] || 4321}`
let passed = 0, ipSeq = 10
async function test(name, fn) { await fn(); passed += 1; console.log(`ok - ${name}`) }
function client(ip = `10.9.5.${ipSeq++}`) {
  const jar = new Map()
  const call = async (path, body) => {
    const res = await fetch(`${B}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: B, 'x-forwarded-for': ip, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') }, body: JSON.stringify(body) })
    for (const c of res.headers.getSetCookie?.() || []) { const [kv] = c.split(';'); const i = kv.indexOf('='); if (kv.slice(i + 1)) jar.set(kv.slice(0, i), kv.slice(i + 1)); else jar.delete(kv.slice(0, i)) }
    return { status: res.status, data: await res.json().catch(() => ({})) }
  }
  return { call }
}
const emails = async () => (await fetch(`${B}/__emails`)).json()
async function signIn(c, email, audience = 'parent') {
  const s = await c.call('/api/jfp-auth', { action: 'start', email, audience })
  const code = (await emails()).filter((e) => e.to.includes(email) && /sign-in code/.test(e.subject)).at(-1).subject.match(/(\d{6})/)[1]
  return c.call('/api/jfp-auth', { action: 'verify', challenge: s.data.challenge, code })
}
const lee = client(), ligia = client()
await signIn(lee, 'leejones@jonerfootball.com', 'staff')
await signIn(ligia, 'ligia@jonerfootball.com', 'staff')
const portal = (c, action, body = {}) => c.call('/api/jfp-portal-data', { action, ...body })

await test('nothing new to start with', async () => {
  await portal(lee, 'newAccounts'); await portal(ligia, 'newAccounts')
  assert.equal((await portal(lee, 'accountAlerts')).data.count, 0)
})

const NEW = 'nina.new@example.com'
await test('someone new signs up: the count goes up for Lee and Ligia', async () => {
  const mum = client()
  assert.equal((await signIn(mum, NEW)).status, 200)
  const r = await mum.call('/api/jfp-account', { action: 'addPlayer', name: 'Nico New', dob: '2014-03-03', values: { club: 'Belrose Terrey Hills', level: 'NPL', parentName: 'Nina New', parentMobile: '0400 222 333' } })
  assert.equal(r.status, 200, JSON.stringify(r.data))
  const a = (await portal(lee, 'accountAlerts')).data
  assert.equal(a.count, 1)
  assert.equal(a.latest[0].email, NEW)
  assert.equal((await portal(ligia, 'accountAlerts')).data.count, 1)
})

await test('a Term 4 family signing in for the first time does not count', async () => {
  const fam = client()
  assert.equal((await signIn(fam, 'parent1@example.com')).status, 200)
  assert.equal((await portal(lee, 'accountAlerts')).data.count, 1)
})

await test('the list shows the account, the player, club and "no session yet"; opening it clears the count for that person only', async () => {
  const d = (await portal(lee, 'newAccounts')).data
  const a = d.accounts.find((x) => x.email === NEW)
  assert.ok(a, JSON.stringify(d.accounts.map((x) => x.email)))
  assert.equal(a.isNew, true)
  assert.equal(a.parent, 'Nina New')
  assert.equal(a.booked, false)
  assert.equal(a.players[0].name, 'Nico New')
  assert.equal(a.players[0].club, 'Belrose Terrey Hills')
  assert.ok(!d.accounts.some((x) => x.email === 'parent1@example.com'), 'New to us only')
  assert.ok((await portal(lee, 'newAccounts', { show: 'all' })).data.accounts.some((x) => x.email === 'parent1@example.com'), 'All accounts has known families')
  assert.equal((await portal(lee, 'accountAlerts')).data.count, 0)
  assert.equal((await portal(ligia, 'accountAlerts')).data.count, 1, 'Ligia has not looked yet')
})

await test('coaches cannot see accounts', async () => {
  const sam = client()
  await signIn(sam, 'jonerfootballsam@gmail.com', 'staff')
  const r = await portal(sam, 'newAccounts')
  assert.ok([401, 403].includes(r.status), String(r.status))
})

console.log(`\n${passed} new accounts checks passed`)
