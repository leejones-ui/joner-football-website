// Lee's 20 Oct 2026 round after the coach meeting: any coach marks any register
// (the Register tab), a covering coach sees the group and the coach notes,
// player reports due in week 9, and Session ideas by HQ or the field.
// Starts its own copy of the local harness (fake Airtable, fake Brevo, in
// memory KV) on a free port, so nothing real is emailed or written.
//   npx astro build && node scripts/test-jfp-register-round.mjs
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

const lee = client(), sam = client(), ruby = client()
await signIn(lee, 'leejones@jonerfootball.com', 'staff')
await signIn(sam, 'jonerfootballsam@gmail.com', 'staff')
await signIn(ruby, 'jonerfootballruby@gmail.com', 'staff')
const THU = (await ok(lee, 'saveGroup', { group: { day: 'Thursday', time: '4:15pm', location: 'Belrose HQ', coachId: 'sam', capacity: 10, mode: 'direct' } })).group.id
await ok(lee, 'addPlayer', { groupId: THU, force: true, player: { name: 'Ava Ashdown', age: 13 }, parent: { name: 'Pat Ashdown', email: 'pat.ashdown@example.com', mobile: '0400 111 222' }, payment: 'full' })

await test('Register tab: any coach opens every coach or one coach, and the coach list comes with it', async () => {
  const all = await ok(ruby, 'coachSessions', { any: true, coachId: 'all' })
  assert.equal(all.all, true)
  assert.ok(all.sessions.some((s) => s.id === THU), "Ruby sees Sam's session")
  assert.ok(all.coachList.some((c) => c.id === 'sam'))
  const one = await ok(ruby, 'coachSessions', { any: true, coachId: 'sam' })
  assert.ok(one.sessions.every((s) => s.coachId === 'sam' || s.covering))
  assert.deepEqual(one.trials, [])
  // Without any, a coach still only gets their own.
  const own = await ok(ruby, 'coachSessions', { coachId: 'sam' })
  assert.ok(!own.sessions.some((s) => s.id === THU))
})

await test("any coach can mark another coach's register (never refused as not theirs)", async () => {
  const s = (await ok(ruby, 'coachSessions', { any: true, coachId: 'sam' })).sessions.find((x) => x.id === THU)
  const rowId = s.players[0].rowId
  const mk = await portal(ruby, 'markAttendance', { groupId: THU, date: s.dates[0].iso, rowId, status: 'Present' })
  assert.notEqual(mk.status, 403, JSON.stringify(mk.data))
  assert.ok(mk.status === 200 || /not happened/.test(mk.data.error || ''), JSON.stringify(mk.data))
})

await test('a covering coach sees the coach notes on the register and can open the card', async () => {
  const s = (await ok(sam, 'coachSessions')).sessions.find((x) => x.id === THU)
  const rowId = s.players[0].rowId
  await ok(sam, 'coachPNoteSave', { rowId, text: 'Works hard, needs reminding to scan.' })
  // Not covering yet: Ruby cannot open the card (unless the session is today).
  const date = s.dates.find((d) => d.iso >= day(0)).iso
  await ok(sam, 'requestCover', { groupId: THU, date, coverCoachId: 'ruby', note: 'Away' })
  const mine = await ok(ruby, 'coachSessions')
  const cov = mine.sessions.find((x) => x.id === THU && x.covering)
  assert.ok(cov, 'cover shows in My sessions')
  assert.match(cov.players[0].pnotes[0].text, /needs reminding to scan/)
  assert.equal((await portal(ruby, 'coachPlayer', { rowId })).status, 200)
  assert.equal((await portal(ruby, 'coachPNotes', { rowId })).status, 200)
  // On the Register tab the notes only show on sessions this coach runs or covers.
  const reg = await ok(lee, 'coachSessions', { coachId: 'all' })
  assert.ok(reg.sessions.find((x) => x.id === THU).players[0].pnotes)
})

await test('player reports due in week 9: the window, who is behind, the words, and the switch', async () => {
  const rd = await import('../api/_jfp-report-due.js')
  const cfg = { termStart: '2026-10-12', weeks: 10, term: 'Term 4 2026', coaches: [{ id: 'sam', name: 'Sam', fullName: 'Sam York' }], locations: [] }
  assert.equal(rd.dueWindow(cfg, '2026-12-06').phase, 'none')
  const w = rd.dueWindow(cfg, '2026-12-07')
  assert.equal(w.start, '2026-12-07'); assert.equal(w.end, '2026-12-13'); assert.equal(w.phase, 'due'); assert.equal(w.week, 9)
  assert.equal(rd.dueWindow(cfg, '2026-12-14').phase, 'overdue')
  const groups = [{ id: 'g1', day: 'Thursday', time: '4pm', location: 'x', coachId: 'sam' }]
  const roster = { players: [{ id: 'r1', player: 'Ava', groupId: 'g1', holdsPlace: true }, { id: 'r2', player: 'Ben', groupId: 'g1', holdsPlace: true }, { id: 'r3', player: 'Cal', groupId: 'g1', holdsPlace: true, paymentType: 'Trial' }] }
  const [p] = rd.progress({ config: cfg, groups, roster, reports: [{ rowId: 'r1', termNo: '4', year: '2026', status: 'sent' }] })
  assert.equal(p.total, 2); assert.equal(p.sent, 1); assert.equal(p.left, 1); assert.equal(p.missing[0].name, 'Ben')
  const start = rd.words('start', { coach: { name: 'Sam' }, c: p, win: w })
  assert.match(start.paras[0], /due by/); assert.doesNotMatch(JSON.stringify(start), /\u2014/)
  const due = await ok(lee, 'reportDue')
  assert.equal(due.reminders, false)
  assert.equal((await portal(sam, 'reportDue', { reminders: true })).status, 403)
  assert.equal((await ok(lee, 'reportDue', { reminders: true })).reminders, true)
  await ok(lee, 'reportDue', { reminders: false })
})

await test('Session ideas: app videos carry HQ or field, and a coach link can say where', async () => {
  const { default: places } = await import('../api/_jfp-app-places.js')
  const vals = Object.values(places)
  assert.ok(vals.includes('hq') && vals.includes('field') && vals.length > 400)
  const r = await ok(sam, 'ideasLinkAdd', { url: 'https://www.instagram.com/reel/HQ1/', title: 'Wall passing', topic: 'pass', place: 'hq' })
  assert.equal(r.link.place, 'hq')
  const bad = await ok(sam, 'ideasLinkAdd', { url: 'https://www.instagram.com/reel/HQ2/', title: 'Rondo', topic: 'pass', place: 'moon' })
  assert.equal(bad.link.place, '')
})

console.log(`${passed} passed`)
process.exit(0)
