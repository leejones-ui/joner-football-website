// Past-player cards (Lee, 27 Oct 2026), end to end on the local harness: the
// Players tab "All players, past and present" list groups rows by JFP Player
// Profile, and the card shows the profile and its waiver contact fields, never
// a medical note or date of birth. Starts its own harness (fake Airtable, in
// memory KV) on a free port, so nothing real is read or written.
//   npm run build && node scripts/test-jfp-player-cards.mjs
// Every name here is invented.// Every name here is invented.
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
const kv = async (cmd) => (await fetch(`${B}/__kv?cmd=${encodeURIComponent(JSON.stringify(cmd))}`)).text()

const lee = client(), sam = client()
await signIn(lee, 'leejones@jonerfootball.com', 'staff')
await signIn(sam, 'jonerfootballsam@gmail.com', 'staff')

await test('the list: Lee only, never a phone number, older terms still merge by name and email', async () => {
  assert.equal((await portal(sam, 'playersHistory', { term: 'all' })).status, 403)
  const all = await ok(lee, 'playersHistory', { term: 'all' })
  const olly = all.people.find((p) => p.player === 'Olly Oldtimer')
  assert.deepEqual(olly.terms, ['Term 2 2026', 'First players table'])
  assert.ok(!/0400999888|0400111222|Phone|Date of Birth|Medical/.test(JSON.stringify(all)))
})

await test('one profile, two emails: one entry, and the profile rides along in its refs', async () => {
  const all = await ok(lee, 'playersHistory', { term: 'all' })
  const pennies = all.people.filter((p) => p.player === 'Penny Profiled')
  assert.equal(pennies.length, 1, JSON.stringify(pennies))
  assert.deepEqual(pennies[0].terms, ['Term 2 2026', 'First players table'])
  assert.ok(pennies[0].refs.some((x) => x.term === 'profile'), JSON.stringify(pennies[0].refs))
  const t2 = await ok(lee, 'playersHistory', { term: 'term2' })
  assert.ok(t2.rows.find((r) => r.player === 'Penny Profiled').profile, 'a single-term row carries its profile too')
})

await test('the card: profile and waiver contact first, then the term rows; no medical note or date of birth', async () => {
  const all = await ok(lee, 'playersHistory', { term: 'all' })
  const penny = all.people.find((p) => p.player === 'Penny Profiled')
  const pc = await ok(lee, 'playerRecords', { refs: penny.refs })
  assert.deepEqual(pc.records.map((x) => x.term), ['profile', 'waiver', 'term2', 'first'])
  const f = (rec) => Object.fromEntries(rec.fields)
  assert.equal(f(pc.records[0])['Parent Mobile'], '0400111222')
  assert.equal(f(pc.records[0])['Club'], 'Invented FC')
  assert.equal(f(pc.records[1])['Emergency Contact Phone'], '0400333444')
  assert.equal(f(pc.records[1])['Parent Email'], 'penny.later@example.com')
  assert.ok(!('Waiver Accepted - Full Terms' in f(pc.records[1])), 'waiver: contact fields only')
  assert.ok(!/medical|peanut|allerg/i.test(JSON.stringify(pc)))
  assert.ok(!/2014-01-02|Date of Birth/.test(JSON.stringify(pc)))
  assert.equal((await portal(sam, 'playerRecords', { refs: penny.refs })).status, 403)
  const bad = await ok(lee, 'playerRecords', { refs: [{ term: 'profile', rowId: 'nope' }, { term: 'elsewhere', rowId: penny.refs[0].rowId }] })
  assert.equal(bad.records.length, 0)
})

await test('a player with no profile still opens as before', async () => {
  const all = await ok(lee, 'playersHistory', { term: 'all' })
  const olly = all.people.find((p) => p.player === 'Olly Oldtimer')
  assert.ok(!olly.refs.some((x) => x.term === 'profile'))
  const r = await ok(lee, 'playerRecords', { refs: olly.refs })
  assert.ok(r.records.length >= 2 && r.records.some((x) => x.fields.some(([k, v]) => k === 'Player Name' && v === 'Olly Oldtimer')))
  assert.ok(r.records.some((x) => x.fields.some(([k]) => k === 'Phone Number')), 'the card shows the phone, as before')
  assert.ok(!/medical|asthma/i.test(JSON.stringify(r)))
})

console.log(`${passed} passed`)
process.exit(0)
