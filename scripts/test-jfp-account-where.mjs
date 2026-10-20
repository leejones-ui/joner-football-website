// Where are you based (Lee, 20 Oct 2026): someone new answers once after
// making an account; away from Sydney they are pointed to the app; Lee and
// Ligia see the answer and the connection's country on New accounts.
//   node scripts/holiday-local.mjs 4321 (after npm run build), then
//   node scripts/test-jfp-account-where.mjs 4321
import assert from 'node:assert/strict'

const B = `http://localhost:${process.argv[2] || 4321}`
let passed = 0, ipSeq = 10
async function test(name, fn) { await fn(); passed += 1; console.log(`ok - ${name}`) }
function client(extra = {}, ip = `10.9.7.${ipSeq++}`) {
  const jar = new Map()
  const call = async (path, body) => {
    const res = await fetch(`${B}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: B, 'x-forwarded-for': ip, ...extra, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') }, body: JSON.stringify(body) })
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
const lee = client()
await signIn(lee, 'leejones@jonerfootball.com', 'staff')
const portal = (action, body = {}) => lee.call('/api/jfp-portal-data', { action, ...body })
const overview = (c) => c.call('/api/jfp-account', { action: 'overview' })

const FAR = 'far.away@example.com', NEAR = 'near.by@example.com'
const far = client({ 'x-vercel-ip-country': 'PK', 'x-vercel-ip-city': 'Karachi' })
const near = client({ 'x-vercel-ip-country': 'AU', 'x-vercel-ip-city': 'Sydney' })

await test('someone new is asked, a Term 4 family is not', async () => {
  await signIn(far, FAR)
  const o = (await overview(far)).data
  assert.ok(o.askWhere, 'asked')
  assert.equal(o.askWhere.country, 'PK')
  assert.ok(o.askWhere.places.overseas && o.askWhere.forWho.child)
  const fam = client()
  await signIn(fam, 'parent1@example.com')
  assert.equal((await overview(fam)).data.askWhere, null)
})

await test('answers are checked', async () => {
  assert.equal((await far.call('/api/jfp-account', { action: 'saveWhere', place: 'mars', forWho: 'child' })).status, 400)
  assert.equal((await far.call('/api/jfp-account', { action: 'saveWhere', place: 'overseas', forWho: 'child', country: '' })).status, 400)
  assert.equal((await far.call('/api/jfp-account', { action: 'saveWhere', place: 'sydney' })).status, 400)
})

await test('overseas: saved, marked away, not asked again', async () => {
  const r = await far.call('/api/jfp-account', { action: 'saveWhere', place: 'overseas', country: 'Pakistan', forWho: 'me', heard: 'youtube', area: 'ignored' })
  assert.equal(r.status, 200, JSON.stringify(r.data))
  assert.equal(r.data.away, true)
  assert.equal(r.data.where.area, '')
  const o = (await overview(far)).data
  assert.equal(o.askWhere, null)
  assert.deepEqual(o.where, { place: 'overseas', away: true })
})

await test('Sydney: not away', async () => {
  await signIn(near, NEAR)
  const r = await near.call('/api/jfp-account', { action: 'saveWhere', place: 'sydney', area: 'Belrose', forWho: 'child', heard: 'instagram' })
  assert.equal(r.data.away, false)
})

await test('New accounts shows where, who for, heard from and the connection; Outside Sydney filters', async () => {
  const d = (await portal('newAccounts')).data
  const a = d.accounts.find((x) => x.email === FAR), b = d.accounts.find((x) => x.email === NEAR)
  assert.equal(a.where.label, 'Outside Australia · Pakistan')
  assert.equal(a.where.forWho, 'Me, I play')
  assert.equal(a.where.heard, 'YouTube')
  assert.equal(a.where.away, true)
  assert.deepEqual(a.from, { country: 'PK', city: 'Karachi' })
  assert.equal(b.where.label, 'Sydney · Belrose')
  assert.ok(d.totals.away >= 1)
  const away = (await portal('newAccounts', { show: 'away' })).data.accounts.map((x) => x.email)
  assert.ok(away.includes(FAR) && !away.includes(NEAR), JSON.stringify(away))
})

console.log(`\n${passed} where-are-you-based checks passed`)
