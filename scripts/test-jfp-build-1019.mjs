// Lee's 19 Oct 2026 build, end to end on the harness: sign up checks, the
// Holiday and Extra tabs, one request per player per session, new session
// alerts, several extra sessions at once, prices hidden from coaches, and the
// JFP family email held while it is off.
// Starts its own copy of the local harness (fake Airtable, fake Brevo, in
// memory KV) on a free port, so nothing real is emailed or written.
//   npx astro build && node scripts/test-jfp-build-1019.mjs
// Every name here is invented.
import assert from 'node:assert/strict'
import net from 'node:net'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const port = await new Promise((resolve) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => resolve(p)) }) })
const B = `http://localhost:${port}`
const harness = spawn(process.execPath, [path.join(HERE, 'holiday-local.mjs')], {
  env: { PATH: process.env.PATH, HOME: process.env.HOME, HOLIDAY_LOCAL_PORT: String(port) },
  stdio: ['ignore', 'pipe', 'inherit'],
})
let ready
const up = new Promise((resolve, reject) => { ready = resolve; harness.on('exit', (c) => reject(new Error(`harness exited ${c}`))) })
harness.stdout.on('data', (d) => { if (String(d).includes('holiday local harness on')) ready() })
process.on('exit', () => harness.kill())
await up

let passed = 0
let ipSeq = 1
async function test(name, fn) { await fn(); passed += 1; console.log(`ok - ${name}`) }
function client() {
  const jar = new Map()
  const ip = `10.8.0.${ipSeq++}`
  async function call(p, body) {
    const res = await fetch(`${B}${p}`, { method: body ? 'POST' : 'GET', redirect: 'manual', headers: { 'content-type': 'application/json', cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '), 'x-forwarded-for': ip, origin: B }, body: body ? JSON.stringify(body) : undefined })
    for (const c of res.headers.getSetCookie?.() || []) { const [kv] = c.split(';'); const i = kv.indexOf('='); const v = kv.slice(i + 1); if (v) jar.set(kv.slice(0, i), v); else jar.delete(kv.slice(0, i)) }
    let data = {}
    try { data = JSON.parse(await res.text()) } catch {}
    return { status: res.status, data }
  }
  return { call }
}

const emails = async () => (await fetch(`${B}/__emails`)).json()
async function signIn(c, email, audience = 'parent') {
  const s = await c.call('/api/jfp-auth', { action: 'start', email, audience })
  assert.equal(s.status, 200, JSON.stringify(s.data))
  const mail = (await emails()).filter((e) => e.to.includes(email) && /sign-in code/.test(e.subject)).at(-1)
  const v = await c.call('/api/jfp-auth', { action: 'verify', challenge: s.data.challenge, code: mail.subject.match(/(\d{6})/)[1] })
  assert.equal(v.status, 200, JSON.stringify(v.data))
}
const portal = (c, action, body = {}) => c.call('/api/jfp-portal-data', { action, ...body })
const acct = (c, action, body = {}) => c.call('/api/jfp-account', { action, ...body })
const ok = async (c, action, body) => { const r = await portal(c, action, body); assert.equal(r.status, 200, `${action}: ${JSON.stringify(r.data)}`); return r.data }
const hadmin = async (action, b = {}) => (await fetch(`${B}/api/holiday-admin`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-holiday-admin-secret': 'admin', origin: B }, body: JSON.stringify({ action, ...b }) })).json()
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)

const lee = client(), sam = client()
await signIn(lee, 'leejones@jonerfootball.com', 'staff')
await signIn(sam, 'jonerfootballsam@gmail.com', 'staff')
const THU = (await ok(lee, 'saveGroup', { group: { day: 'Thursday', time: '4:15pm', location: 'Belrose HQ', coachId: 'sam', capacity: 10, mode: 'direct' } })).group.id
const APP = (await ok(lee, 'saveGroup', { group: { day: 'Friday', time: '5:10pm', location: 'Belrose HQ', coachId: 'sam', capacity: 8, mode: 'application' } })).group.id
await ok(lee, 'addPlayer', { groupId: THU, force: true, player: { name: 'Ava Ashdown', age: 13 }, parent: { name: 'Pat Ashdown', email: 'pat.ashdown@example.com', mobile: '0400 111 222' }, payment: 'full' })
const fam = client(), stranger = client()
await signIn(fam, 'pat.ashdown@example.com')

await test('sign up: a throwaway inbox cannot open an account; an everyday one can', async () => {
  const c = client()
  const r = await c.call('/api/jfp-auth', { action: 'start', email: 'quick@mailinator.com', audience: 'parent' })
  assert.equal(r.status, 400); assert.equal(r.data.code, 'throwaway')
  const r2 = await c.call('/api/jfp-auth', { action: 'start', email: 'x7@tempmail.dev', audience: 'parent' })
  assert.equal(r2.data.code, 'throwaway')
  await signIn(stranger, 'new.family@example.com')
})

await test('holiday training: the sessions to come are on the tab, no coach names; a JFP family books without the password', async () => {
  const c = (await hadmin('getConfig')).config
  await hadmin('saveConfig', { config: { ...c, coaches: c.coaches.map((x) => ({ ...x, active: true })) } })
  assert.equal((await hadmin('upsertSlot', { slot: { coachId: 'dean', date: day(20), startTime: '09:00', durationMin: 60, type: 'one' } })).success, true)
  assert.equal((await hadmin('upsertSlot', { slot: { coachId: 'sam', date: day(20), startTime: '10:30', durationMin: 60, type: 'shared' } })).success, true)
  const h = (await acct(fam, 'overview')).data.extras.holiday
  assert.equal(h.sessions.length, 2)
  assert.ok(!/Dean|Sam|coachId/.test(JSON.stringify(h)), 'no coach on the family list')
  assert.equal((await fam.call('/api/holiday-slots')).status, 401)
  const a = await acct(fam, 'holidayAccess')
  assert.equal(a.status, 200, JSON.stringify(a.data))
  assert.equal((await fam.call('/api/holiday-slots')).status, 200)
  const no = await acct(stranger, 'holidayAccess')
  assert.equal(no.status, 403); assert.equal(no.data.code, 'password')
})

let MANY = []
await test('a coach opens several extra sessions at once, and never sees a price', async () => {
  const pr = await ok(lee, 'extraPrices', { add: { label: 'Extra 1 on 1', dollars: 90, durationMin: 60 } })
  const priceId = pr.prices.at(-1).id
  const r = await ok(sam, 'extraSaveMany', { slot: { date: day(3), time: '7:45am', capacity: 1, location: 'Belrose HQ', priceId, visibility: 'public' }, dates: [day(3), day(4)], times: ['7:45am', '9:00am'] })
  assert.equal(r.slots.length, 4)
  MANY = r.slots
  const list = await ok(sam, 'extraList')
  const txt = JSON.stringify(list)
  assert.ok(!/priceCents|priceLabel|"cents"|A\$90|9000/.test(txt), `no price for a coach: ${txt.slice(0, 300)}`)
  assert.equal(list.prices[0].label, 'Extra 1 on 1')
  const one = await ok(sam, 'extraSave', { slot: { date: day(5), time: '4:00pm', capacity: 2, location: 'Belrose HQ', priceId, visibility: 'private' } })
  assert.ok(!('priceLabel' in one.slot) && !('priceCents' in one.slot))
  const all = await ok(lee, 'extraList')
  assert.ok(all.slots.every((s) => s.priceLabel === 'A$90.00' || /A\$90/.test(s.priceLabel)), 'Lee sees the price')
  assert.equal((await portal(sam, 'extraSaveMany', { slot: { capacity: 1, location: 'Belrose HQ', priceId }, dates: Array.from({ length: 13 }, (_, i) => day(i + 1)), times: ['7:00am', '8:00am'] })).status, 400)
})

await test('families see the new sessions (a red number and a pop up) until they open the tab', async () => {
  const x = (await acct(fam, 'overview')).data.extras
  assert.equal(x.bookable.length, 4)
  assert.ok(!/coachId|coachName|Sam/.test(JSON.stringify(x.bookable)))
  assert.deepEqual(x.seen, {})
  const s = await acct(fam, 'sessionsSeen', { kind: 'extra' })
  assert.equal(s.status, 200)
  const y = (await acct(fam, 'overview')).data.extras
  assert.ok(y.seen.extra && !y.seen.holiday)
  assert.ok(y.bookable.every((b) => b.createdAt <= y.seen.extra), 'all seen now')
})

await test('the JFP family email stays off: held, nothing sent, coaches cannot switch it', async () => {
  assert.equal((await portal(sam, 'extraAnnounce', { on: true })).status, 403)
  const a = await ok(lee, 'extraAnnounce')
  assert.equal(a.on, false)
  assert.ok(a.history.some((h) => h.status === 'held' && h.slots.length === 4))
  assert.ok(!(await emails()).some((e) => /extra session/i.test(e.subject) && /to book/i.test(e.subject)))
  assert.ok(!/—/.test(a.preview.html) && !/Sam|Dean|A\$/.test(a.preview.html), 'no em dash, coach or price')
})

await test('one request per player per session: the second says already applied, straight away', async () => {
  const c = client()
  await c.call('/api/jfp-access', { password: 'term4' })
  await signIn(c, 'asker@example.com')
  const body = { action: 'request', kind: 'waitlist', groupId: APP, players: [{ name: 'Asha Asker', dob: '2014-02-02' }], parentName: 'Ari Asker', mobile: '0422 333 444' }
  const one = await c.call('/api/jfp-book', { ...body, kind: 'application' })
  assert.equal(one.status, 200, JSON.stringify(one.data))
  const two = await c.call('/api/jfp-book', body)
  assert.equal(two.status, 409); assert.equal(two.data.code, 'duplicate')
  assert.match(two.data.error, /already applied for this spot/)
  const three = await c.call('/api/jfp-book', { ...body, players: [{ name: 'asha  ASKER', dob: '2014-02-02' }] })
  assert.equal(three.status, 409)
  const reqs = (await ok(lee, 'requests')).requests.filter((r) => r.email === 'asker@example.com')
  assert.equal(reqs.length, 1)
})

console.log(`${passed} passed`)
process.exit(0)
