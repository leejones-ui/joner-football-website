// Coach profiles (Lee, 20 Oct 2026): a coach fills in their own, live straight
// away; every coach reads them on Our coaches; families see their own coach's
// only once Lee switches it on.
// Starts its own copy of the local harness (fake Airtable, fake Brevo, in
// memory KV) on a free port, so nothing real is emailed or written.
//   npx astro build && node scripts/test-jfp-coach-profiles.mjs
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

const lee = client(), sam = client(), ruby = client(), fam = client()
await signIn(lee, 'leejones@jonerfootball.com', 'staff')
await signIn(sam, 'jonerfootballsam@gmail.com', 'staff')
await signIn(ruby, 'jonerfootballruby@gmail.com', 'staff')
const THU = (await ok(lee, 'saveGroup', { group: { day: 'Thursday', time: '4:15pm', location: 'Belrose HQ', coachId: 'sam', capacity: 10, mode: 'direct' } })).group.id
await ok(lee, 'addPlayer', { groupId: THU, force: true, player: { name: 'Ava Ashdown', age: 13 }, parent: { name: 'Pat Ashdown', email: 'pat.ashdown@example.com', mobile: '0400 111 222' }, payment: 'full' })
await signIn(fam, 'pat.ashdown@example.com')
const y = new Date().getFullYear() - 3

await test('a coach saves their own profile and it is live straight away; they cannot set their own role', async () => {
  const r = await ok(sam, 'coachProfileSave', { profile: { role: 'Head coach', joined: `${y}-03`, about: 'Grew up playing on the Northern Beaches.', highest: 'NPL NSW 2', playing: [{ club: 'Manly United', level: 'NPL', years: '2012 to 2016' }, { club: '' }], coaching: [{ club: 'Joner Football', team: 'U12', years: `${y} to now` }], quals: [{ name: 'Football Australia C Licence', year: '2023' }], skills: ['pass', 'nonsense'], ages: ['8 to 11'], languages: 'English', favourite: 'Messi', leaveWith: 'Confidence on the ball.' } })
  assert.equal(r.profile.role, '')
  assert.equal(r.profile.playing.length, 1)
  assert.deepEqual(r.profile.skills, ['pass'])
  assert.match(r.profile.since, new RegExp(`Since March ${y} · 3 years`))
})

await test('coaches read every profile on Our coaches, with no email; a coach cannot edit someone else', async () => {
  const d = await ok(ruby, 'coachProfiles')
  const s = d.coaches.find((c) => c.id === 'sam')
  assert.equal(s.about, 'Grew up playing on the Northern Beaches.'); assert.equal(s.canEdit, false); assert.equal(s.email, undefined)
  assert.equal(d.coaches.find((c) => c.id === 'ruby').mine, true)
  assert.equal((await portal(ruby, 'coachProfileSave', { coachId: 'sam', profile: { about: 'x' } })).status, 403)
  assert.equal((await portal(ruby, 'coachProfilesFamilies', { on: true })).status, 403)
})

await test('Lee or Ligia can edit anyone and set the role', async () => {
  const before = (await ok(lee, 'coachProfiles')).coaches.find((c) => c.id === 'sam')
  const r = await ok(lee, 'coachProfileSave', { coachId: 'sam', profile: { ...before, role: 'Senior coach' } })
  assert.equal(r.profile.role, 'Senior coach'); assert.equal(r.profile.about, 'Grew up playing on the Northern Beaches.')
  // A later save by Sam keeps the role Lee set.
  assert.equal((await ok(sam, 'coachProfileSave', { profile: { ...r.profile, role: 'Head coach' } })).profile.role, 'Senior coach')
})

await test('families see no coach until Lee switches it on, then their own coach profile only', async () => {
  const off = await acct(fam, 'overview')
  assert.equal(off.status, 200)
  const e0 = off.data.players.flatMap((p) => p.enrolments).find((e) => e.day === 'Thursday')
  assert.ok(e0); assert.equal(e0.coaches, undefined)
  await ok(lee, 'coachProfilesFamilies', { on: true })
  const on = await acct(fam, 'overview')
  const e1 = on.data.players.flatMap((p) => p.enrolments).find((e) => e.day === 'Thursday')
  assert.equal(e1.coaches.length, 1)
  assert.equal(e1.coaches[0].id, 'sam'); assert.equal(e1.coaches[0].role, 'Senior coach'); assert.equal(e1.coaches[0].email, undefined)
  assert.ok(!JSON.stringify(e1.coaches).includes('@'))
  await ok(lee, 'coachProfilesFamilies', { on: false })
  assert.equal((await acct(fam, 'overview')).data.players.flatMap((p) => p.enrolments).find((e) => e.day === 'Thursday').coaches, undefined)
})

console.log(`${passed} passed`)
process.exit(0)
