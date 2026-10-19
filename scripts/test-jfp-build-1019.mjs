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

await test('a family extra session request: every coach sees it, one takes it, the other cannot, Lee sees who', async () => {
  const dean = client()
  await signIn(dean, 'jonerfootballdean@gmail.com', 'staff')
  const r = await acct(fam, 'requestExtra', { kind: 'extra', player: 'Ava Ashdown', days: ['Tuesday'], type: 'Either' })
  assert.equal(r.status, 200, JSON.stringify(r.data))
  const id = r.data.request.id
  const seen = (await ok(sam, 'extraAsks')).asks
  assert.ok(seen.some((a) => a.id === id), 'Sam sees it')
  assert.ok((await ok(dean, 'extraAsks')).asks.some((a) => a.id === id), 'Dean sees it')
  assert.equal((await ok(dean, 'extraAskReply', { id, answer: 'pass' })).ask.mine, 'pass')
  await ok(sam, 'extraAskReply', { id, answer: 'take' })
  const clash = await portal(dean, 'extraAskReply', { id, answer: 'take' })
  assert.equal(clash.status, 409)
  const admin = JSON.stringify(await ok(lee, 'requests'))
  assert.ok(/takenBy|Sam/.test(admin))
  await ok(sam, 'extraAskReply', { id, answer: '' })
  await ok(dean, 'extraAskReply', { id, answer: 'take' })
})

await test('cover and time off: Lee and Ligia get a count in the portal until they open it', async () => {
  const before = await ok(lee, 'staffAlerts', { seen: true })
  const t = await ok(sam, 'requestTimeOff', { from: day(30), to: day(31), reason: 'Away' })
  assert.ok(t.timeOff.id)
  const a = await ok(lee, 'staffAlerts')
  assert.ok(a.count >= 1 && a.latest.some((x) => x.kind === 'timeoff'))
  assert.equal((await ok(sam, 'staffAlerts')).count, 0, 'a coach gets no admin alerts')
  assert.ok(before.count >= 0)
})

await test('session ideas: the JF App and YouTube for coaches; only Lee or Ligia edit the list', async () => {
  const i = await ok(sam, 'ideasGet')
  assert.ok(i.ideas.some((x) => /apps\.apple\.com/.test(x.url)) && i.ideas.some((x) => /youtube\.com/.test(x.url)))
  assert.equal((await portal(sam, 'ideasSave', { ideas: [] })).status, 403)
  const sv = await ok(lee, 'ideasSave', { ideas: [...i.ideas, { label: 'Training videos', url: 'https://docs.google.com/spreadsheets/d/example', note: '' }, { label: 'Bad', url: 'http://x' }] })
  assert.equal(sv.ideas.length, i.ideas.length + 1)
})

await test('coach invoices: built from logged hours, a covered session is flagged, hours sit on one invoice only', async () => {
  const dates = [1, 2, 3, 4, 5, 6, 7].map((n) => day(-n))
  const thuDate = dates.find((d) => new Date(`${d}T12:00:00Z`).getUTCDay() === 4)
  await ok(lee, 'coachInvRate', { coachId: 'sam', dollars: 40 })
  // The cover checks on a line: Dean covered it, Sam still claims it, Dean logged it too.
  const { flagsFor } = await import('../api/_jfp-coach-invoices.js')
  const line = { status: 'approved', groupId: 'G1', date: '2026-10-16', kind: 'session' }
  const covers = [{ status: 'active', groupId: 'G1', date: '2026-10-16', coachId: 'sam', coverCoachId: 'dean' }]
  const codes = flagsFor(line, 'sam', { covers, hours: [{ coachId: 'dean', groupId: 'G1', date: '2026-10-16', kind: 'session' }], name: (id) => id }).map((f) => f.code)
  assert.deepEqual(codes, ['covered', 'double'])
  assert.deepEqual(flagsFor({ ...line, kind: 'cover' }, 'max', { covers, hours: [], name: (id) => id }).map((f) => f.code), ['no-cover'])
  const h1 = await ok(sam, 'hoursSave', { date: thuDate, start: '16:15', end: '17:15', kind: 'session', groupId: THU })
  await ok(sam, 'hoursSave', { date: day(-2), start: '09:00', end: '10:30', kind: 'admin' })
  const draft = await ok(sam, 'coachInvList', { from: day(-7), to: day(0) })
  assert.equal(draft.draft.length, 2)
  assert.ok(draft.draft.every((l) => l.flags.some((f) => f.code === 'waiting')), 'not approved yet is flagged')
  assert.ok(!('rates' in draft), 'a coach never sees other rates')
  const inv = (await ok(sam, 'coachInvCreate', { from: day(-7), to: day(0), abn: '12 345 678 901', payTo: 'S York' })).invoice
  assert.equal(inv.totalMinutes, 150); assert.equal(inv.amountCents, 10000)
  assert.match(inv.number, /^SAM-\d{3}$/)
  assert.equal((await portal(sam, 'coachInvCreate', { from: day(-7), to: day(0) })).status, 400, 'nothing left to invoice')
  assert.equal((await portal(sam, 'hoursSave', { id: h1.entry.id, date: thuDate, start: '16:00', end: '17:15', kind: 'session', groupId: THU })).status, 409)
  assert.equal((await portal(sam, 'coachInvDecide', { id: inv.id, status: 'approved' })).status, 403)
  await ok(lee, 'coachInvDecide', { id: inv.id, status: 'queried', note: 'Check Thursday' })
  const again = await ok(sam, 'coachInvList', { from: day(-7), to: day(0) })
  assert.equal(again.draft.length, 2, 'sent back frees the hours')
  const inv2 = (await ok(sam, 'coachInvCreate', { from: day(-7), to: day(0) })).invoice
  await ok(lee, 'coachInvDecide', { id: inv2.id, status: 'approved' })
  await ok(lee, 'coachInvDecide', { id: inv2.id, status: 'paid' })
  const list = await ok(lee, 'coachInvList', {})
  assert.ok(list.invoices.some((x) => x.id === inv2.id && x.status === 'paid'))
})

await test('the whole program register: Lee sees every coach in a week; a coach only sees their own', async () => {
  await ok(lee, 'saveGroup', { group: { day: 'Monday', time: '5:00pm', location: 'Belrose HQ', coachId: 'dean', capacity: 10, mode: 'direct' } })
  const all = await ok(lee, 'coachSessions', { coachId: 'all' })
  assert.equal(all.coach, 'Whole program')
  const coaches = new Set(all.sessions.map((s) => s.coachId))
  assert.ok(coaches.has('sam') && coaches.has('dean'))
  const t = new Date(); t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7) + 7)
  const week = t.toISOString().slice(0, 10)
  const w = await ok(lee, 'coachSessions', { coachId: 'all', week })
  const end = new Date(t.getTime() + 6 * 86400000).toISOString().slice(0, 10)
  assert.ok(w.sessions.length && w.sessions.every((s) => s.nextDate >= week && s.nextDate <= end))
  const mine = await ok(sam, 'coachSessions', { coachId: 'all' })
  assert.ok(mine.sessions.every((s) => s.coachId === 'sam'))
})

await test('players across terms and JF Master Players: Lee only, never a phone number', async () => {
  assert.equal((await portal(sam, 'playersHistory', { term: 'all' })).status, 403)
  const all = await ok(lee, 'playersHistory', { term: 'all' })
  const olly = all.people.find((p) => p.player === 'Olly Oldtimer')
  assert.deepEqual(olly.terms, ['Term 2 2026', 'First players table'])
  assert.ok(all.people.some((p) => p.player === 'Ava Ashdown' && p.current))
  assert.ok(!/0400999888|Phone|Date of Birth|Medical/.test(JSON.stringify(all)))
  const t2 = await ok(lee, 'playersHistory', { term: 'term2' })
  assert.equal(t2.rows.length, 1)
  const m = await ok(lee, 'playersHistory', { term: 'master' })
  assert.equal(m.master.length, 2)
  assert.equal((await portal(lee, 'playersHistory', { term: 'nope' })).status, 400)
})

console.log(`${passed} passed`)
process.exit(0)
