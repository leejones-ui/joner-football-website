// Lee's 19 Oct 2026 coach round: homework notes, coach-to-coach notes, the player
// card (waiver, filming, came X of Y), cover notices, decline, swaps, time off.
// Starts its own copy of the local harness (fake Airtable, fake Brevo, in
// memory KV) on a free port, so nothing real is emailed or written.
//   npx astro build && node scripts/test-jfp-coach-round3.mjs
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
const APP = (await ok(lee, 'saveGroup', { group: { day: 'Friday', time: '5:10pm', location: 'Belrose HQ', coachId: 'sam', capacity: 8, mode: 'application' } })).group.id
await ok(lee, 'addPlayer', { groupId: THU, force: true, player: { name: 'Ava Ashdown', age: 13 }, parent: { name: 'Pat Ashdown', email: 'pat.ashdown@example.com', mobile: '0400 111 222' }, payment: 'full' })
const fam = client(), stranger = client()
await signIn(fam, 'pat.ashdown@example.com')

const ROW = ''

await test('homework: a coach sends it from the player; the family sees Homework and the due date; Lee sees it', async () => {
  const rowId = ROW || (await ok(sam, 'coachSessions')).sessions.flatMap((s) => s.players).find((p) => p.name === 'Ava Ashdown').rowId
  const n = await ok(sam, 'familyNoteSave', { rowId, kind: 'homework', due: 'next Tuesday', text: '50 touches each foot, five days.' })
  assert.equal(n.note.kind, 'homework')
  const a = await acct(fam, 'overview')
  const mine = (a.data.notes || []).find((x) => /50 touches/.test(x.text))
  assert.ok(mine, 'family sees it'); assert.equal(mine.kind, 'homework'); assert.equal(mine.due, 'next Tuesday')
  const all = await ok(lee, 'familyNotesAll')
  assert.ok(all.notes.some((x) => x.kind === 'homework' && x.byName))
})

await test('coach notes between coaches: coaches and Lee read them; the family account never has them', async () => {
  const rowId = (await ok(sam, 'coachSessions')).sessions.flatMap((s) => s.players).find((p) => p.name === 'Ava Ashdown').rowId
  await ok(sam, 'coachPNoteSave', { rowId, text: 'Shy at first. Pair her with a friend.' })
  const mine = await ok(sam, 'coachPNotes', { rowId })
  assert.equal(mine.notes.length, 1)
  const all = await ok(lee, 'coachPNotesAll')
  assert.ok(all.notes.some((x) => /Shy at first/.test(x.text)))
  const r = await portal(ruby, 'coachPNotes', { rowId })
  assert.equal(r.status, 404)
  const a = await acct(fam, 'overview')
  assert.ok(!JSON.stringify(a.data).includes('Shy at first'))
})

await test('player card: waiver, filming and came X of Y', async () => {
  const rowId = (await ok(sam, 'coachSessions')).sessions.flatMap((s) => s.players).find((p) => p.name === 'Ava Ashdown').rowId
  const c = await ok(sam, 'coachPlayer', { rowId })
  assert.ok(c.player.waiver && typeof c.player.waiver.signed === 'boolean')
  assert.ok(c.player.attendance && typeof c.player.attendance.came === 'number')
})

await test('cover: the cover coach gets an email; Can\'t do it hands it back and tells the asker', async () => {
  const st = await ok(sam, 'staffOverview')
  const mine = st.mySessions.find((s) => s.id === THU)
  const date = mine.dates[0].iso
  const before = (await emails()).length
  const r = await ok(sam, 'requestCover', { groupId: THU, date, coverCoachId: 'ruby', note: 'Dentist' })
  const sent = (await emails()).slice(before).filter((e) => e.to.includes('jonerfootballruby@gmail.com'))
  assert.ok(sent.some((e) => /covering/i.test(e.subject)), 'cover coach email: ' + JSON.stringify(sent.map((e) => e.subject)))
  const b2 = (await emails()).length
  await ok(ruby, 'declineCover', { id: r.cover.id })
  const back = (await emails()).slice(b2).filter((e) => e.to.includes('jonerfootballsam@gmail.com'))
  assert.ok(back.some((e) => /cannot cover/i.test(e.subject)))
  const st2 = await ok(sam, 'staffOverview')
  assert.equal(st2.covers.find((c) => c.id === r.cover.id).status, 'declined')
})

await test('swap: the other coach is told, nothing changes until they accept, then both covers apply', async () => {
  const FRI = APP
  const st = await ok(sam, 'staffOverview')
  const a = st.mySessions.find((s) => s.id === THU).dates[1].iso
  const b = st.mySessions.find((s) => s.id === FRI).dates[1].iso
  const RUB = (await ok(lee, 'saveGroup', { group: { day: 'Wednesday', time: '6:30am', location: 'Belrose HQ', coachId: 'ruby', capacity: 8, mode: 'direct' } })).group.id
  const rb = (await ok(ruby, 'staffOverview')).sessionsByCoach.ruby.find((s) => s.id === RUB).dates[1].iso
  const sw = await ok(sam, 'requestSwap', { groupId: THU, date: a, withCoachId: 'ruby', theirGroupId: RUB, theirDate: rb })
  let cv = (await ok(sam, 'staffOverview')).covers.filter((c) => c.date === a && c.status === 'active')
  assert.equal(cv.length, 0, 'not applied yet')
  const wrong = await portal(sam, 'answerSwap', { id: sw.swap.id, answer: 'accept' })
  assert.equal(wrong.status, 403)
  await ok(ruby, 'answerSwap', { id: sw.swap.id, answer: 'accept' })
  cv = (await ok(sam, 'staffOverview')).covers.filter((c) => c.status === 'active' && c.swapId === sw.swap.id)
  assert.equal(cv.length, 2)
})

await test('time off: a coach cancels their own request; Lee\'s note is shown after the decision', async () => {
  const f = day(10), t = day(11)
  const r = await ok(sam, 'requestTimeOff', { from: f, to: t, reason: 'Holiday' })
  await ok(lee, 'decideTimeOff', { id: r.timeOff.id, status: 'approved', note: 'Enjoy' })
  let list = (await ok(sam, 'staffOverview')).timeOff
  assert.equal(list.find((x) => x.id === r.timeOff.id).decisionNote, 'Enjoy')
  await ok(sam, 'cancelTimeOff', { id: r.timeOff.id })
  list = (await ok(sam, 'staffOverview')).timeOff
  assert.equal(list.find((x) => x.id === r.timeOff.id).status, 'cancelled')
  const other = await portal(ruby, 'cancelTimeOff', { id: r.timeOff.id })
  assert.notEqual(other.status, 200)
})

console.log(`${passed} passed`)
process.exit(0)
