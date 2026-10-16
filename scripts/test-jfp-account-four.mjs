// My account, 17 Oct 2026 (Lee): attendance per child, coach notes to families,
// push notifications and player logins (12+). End to end on the harness. Starts its own copy of the local harness
// (scripts/holiday-local.mjs: fake Airtable, fake Brevo, fake Telegram, in
// memory KV) on a free port, so nothing real is ever emailed, texted or written.
//   node scripts/test-jfp-account-four.mjs
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { encryptPayload } from '../api/_jfp-push.js'
import { attendanceFor } from '../api/_jfp-attendance-view.js'
import net from 'node:net'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
// Throwaway VAPID keys for this run only.
const vk = crypto.createECDH('prime256v1'); vk.generateKeys()
const VAPID = { JFP_VAPID_PUBLIC: vk.getPublicKey().toString('base64url'), JFP_VAPID_PRIVATE: vk.getPrivateKey().toString('base64url') }
const port = await new Promise((resolve) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => resolve(p)) }) })
const B = `http://localhost:${port}`
const harness = spawn(process.execPath, [path.join(HERE, 'holiday-local.mjs')], {
  // A clean environment: no real tokens can leak into the harness.
  env: { PATH: process.env.PATH, HOME: process.env.HOME, HOLIDAY_LOCAL_PORT: String(port), JFP_PUSH_TEST_HOST: 'push.test', ...VAPID },
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
  const ip = `10.9.0.${ipSeq++}`
  async function call(p, body) {
    const res = await fetch(`${B}${p}`, { method: body ? 'POST' : 'GET', redirect: 'manual', headers: { 'content-type': 'application/json', cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '), 'x-forwarded-for': ip, origin: B }, body: body ? JSON.stringify(body) : undefined })
    for (const c of res.headers.getSetCookie?.() || []) { const [kv] = c.split(';'); const i = kv.indexOf('='); const v = kv.slice(i + 1); if (v) jar.set(kv.slice(0, i), v); else jar.delete(kv.slice(0, i)) }
    let data = {}
    try { data = JSON.parse(await res.text()) } catch {}
    return { status: res.status, data }
  }
  return { call }
}
const j = async (p) => (await fetch(`${B}${p}`)).json()
const emails = () => j('/__emails')
const telegrams = () => j('/__telegram')
const airtable = () => j('/__airtable')
const kv = async (cmd) => { const t = await (await fetch(`${B}/__kv?cmd=${encodeURIComponent(JSON.stringify(cmd))}`)).text(); try { return JSON.parse(t) } catch { return t } }

async function signIn(c, email, audience) {
  const s = await c.call('/api/jfp-auth', { action: 'start', email, audience })
  assert.equal(s.status, 200, JSON.stringify(s.data))
  const mail = (await emails()).filter((e) => e.to.includes(email) && /sign-in code/.test(e.subject)).at(-1)
  assert.ok(mail, `a code email went to ${email}`)
  const v = await c.call('/api/jfp-auth', { action: 'verify', challenge: s.data.challenge, code: mail.subject.match(/(\d{6})/)[1] })
  assert.equal(v.status, 200, JSON.stringify(v.data))
}
const portal = (c, action, body = {}) => c.call('/api/jfp-portal-data', { action, ...body })
const acct = (c, action, body = {}) => c.call('/api/jfp-account', { action, ...body })




// A pretend phone: its own keys, so the test can open what was sent to it.
function phone(name) {
  const k = crypto.createECDH('prime256v1'); k.generateKeys()
  const auth = crypto.randomBytes(16)
  return { sub: { endpoint: `https://push.test/${name}`, keys: { p256dh: k.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } }, k, auth }
}
const hm = (key, data) => crypto.createHmac('sha256', key).update(data).digest()
function openPush(ph, b64) {
  const buf = Buffer.from(b64, 'base64')
  const salt = buf.subarray(0, 16), asPub = buf.subarray(21, 86), ct = buf.subarray(86)
  const shared = ph.k.computeSecret(asPub)
  const ikm = hm(hm(ph.auth, shared), Buffer.concat([Buffer.from('WebPush: info\0'), ph.k.getPublicKey(), asPub, Buffer.from([1])]))
  const prk = hm(salt, ikm)
  const d = crypto.createDecipheriv('aes-128-gcm', hm(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16), hm(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12))
  d.setAuthTag(ct.subarray(ct.length - 16))
  const pt = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()])
  return JSON.parse(pt.subarray(0, pt.lastIndexOf(2)).toString())
}
const pushes = () => j('/__pushes')
const to = async (ph) => (await pushes()).filter((p) => p.url === ph.sub.endpoint).map((p) => openPush(ph, p.body))

await test('push payloads are encrypted so only that phone can read them (RFC 8291)', () => {
  const ph = phone('unit')
  const body = encryptPayload(JSON.stringify({ title: 'Hi' }), ph.sub.keys)
  assert.equal(body.readUInt32BE(16), 4096)
  assert.equal(body[20], 65)
  assert.deepEqual(openPush(ph, body.toString('base64')), { title: 'Hi' })
  assert.ok(!body.includes(Buffer.from('Hi')), 'no plain text in what is sent')
})

await test('attendance counts only marked sessions; dates still to come are left out', () => {
  const st = { '2026-10-13': 'Present', '2026-10-14': 'Absent', '2026-10-15': '', '2026-10-16': 'Notified' }
  const a = attendanceFor(['2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-20'], (d) => st[d])
  assert.deepEqual(a.marks, ['came', 'missed', '', 'missed', 'ahead'])
  assert.equal(a.label, 'Came to 1 of 3')
})

const lee = client(); await signIn(lee, 'leejones@jonerfootball.com', 'staff')
const mk = async (group) => { const r = await portal(lee, 'saveGroup', { group }); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data.group.id }
const TUE = await mk({ day: 'Tuesday', time: '4:20pm', location: 'Belrose HQ', coachId: 'sam', capacity: 6, mode: 'direct' })
await mk({ day: 'Wednesday', time: '4:20pm', location: 'Belrose HQ', coachId: 'sam', capacity: 6, mode: 'direct' })
const riley = client(); await signIn(riley, 'returning@example.com', 'parent')
const other = client(); await signIn(other, 'parent10@example.com', 'parent')
const ov0 = (await acct(riley, 'overview')).data
const rileyP = ov0.players.find((p) => p.enrolments.length)
const E = rileyP.enrolments[0]
const ROW = E.rowId

await test('a session the coach marked shows for the family as came or away, with "Came to N of M"', async () => {
  const past = E.isoDates ? null : null
  const sched = (await portal(lee, 'coachSessions', { coachId: 'sam' })).data
  const s = (sched.sessions || []).find((x) => x.id === TUE)
  assert.ok(s, 'the Tuesday group is on Sam\'s sessions')
  const pastDates = s.dates.map((d) => d.iso).filter((d) => d < new Date().toISOString().slice(0, 10))
  if (!pastDates.length) { console.log('  (no Tuesday has run yet this term: skipped the marking part)'); return }
  const r = await portal(lee, 'markAttendance', { groupId: TUE, date: pastDates[0], rowId: ROW, status: 'Present' })
  assert.equal(r.status, 200, JSON.stringify(r.data))
  const e = (await acct(riley, 'overview')).data.players.flatMap((p) => p.enrolments).find((x) => x.rowId === ROW)
  assert.equal(e.attendance.came, 1)
  assert.equal(e.attendance.label, 'Came to 1 of 1')
  await portal(lee, 'markAttendance', { groupId: TUE, date: pastDates[0], rowId: ROW, status: 'Absent' })
  const e2 = (await acct(riley, 'overview')).data.players.flatMap((p) => p.enrolments).find((x) => x.rowId === ROW)
  assert.equal(e2.attendance.label, 'Came to 0 of 1')
})

const ph = phone('riley-phone')
await test('notifications: a family turns them on for a phone; an unknown push service is refused', async () => {
  const st = await acct(riley, 'pushState', { endpoint: '' })
  assert.equal(st.data.push.available, true)
  assert.equal((await acct(riley, 'pushSubscribe', { sub: { ...ph.sub, endpoint: 'https://evil.example/x' } })).status, 400)
  const r = await acct(riley, 'pushSubscribe', { sub: ph.sub })
  assert.equal(r.status, 200, JSON.stringify(r.data))
  assert.equal(r.data.push.thisDevice, true)
  assert.deepEqual(Object.values(r.data.push.prefs), [true, true, true, true, true])
})

let noteId
await test('a coach note goes straight to the family (from "Coach", no staff email), and to their phone', async () => {
  const r = await portal(lee, 'familyNoteSave', { rowId: ROW, text: 'Great first touch today.\nWork on the left foot.' })
  assert.equal(r.status, 200, JSON.stringify(r.data))
  noteId = r.data.note.id
  const ov = (await acct(riley, 'overview')).data
  const n = ov.notes.find((x) => x.id === noteId)
  assert.ok(n && !n.read && n.text.includes('left foot'))
  assert.ok(!JSON.stringify(ov.notes).includes('leejones@'), 'no staff email reaches the family')
  assert.ok(!(await acct(other, 'overview')).data.notes.length, 'another family never sees it')
  const got = await to(ph)
  assert.equal(got.length, 1)
  assert.match(got[0].title, /coach/i)
  assert.equal(got[0].url, '/jfp-account/#notes')
  const p = (await pushes()).at(-1)
  assert.match(p.headers.Authorization, /^vapid t=.+, k=/)
  assert.equal(p.headers['Content-Encoding'], 'aes128gcm')
})

await test('opening the notes marks them read for that sign-in only', async () => {
  assert.equal((await acct(riley, 'noteRead', { ids: [noteId] })).status, 200)
  assert.equal((await acct(riley, 'overview')).data.notes.find((x) => x.id === noteId).read, true)
})

await test('switching coach notes off on the phone stops the next one', async () => {
  await acct(riley, 'pushPrefs', { endpoint: ph.sub.endpoint, prefs: { notes: false } })
  await portal(lee, 'familyNoteSave', { rowId: ROW, text: 'Second note.' })
  assert.equal((await to(ph)).length, 1)
  await acct(riley, 'pushPrefs', { endpoint: ph.sub.endpoint, prefs: { notes: true } })
})

await test('Lee edits and deletes a note; the family sees the change at once', async () => {
  const e = await portal(lee, 'familyNoteSave', { id: noteId, text: 'Edited words.' })
  assert.equal(e.status, 200)
  assert.equal((await acct(riley, 'overview')).data.notes.find((x) => x.id === noteId).text, 'Edited words.')
  assert.equal((await portal(lee, 'familyNoteDelete', { id: noteId })).status, 200)
  assert.ok(!(await acct(riley, 'overview')).data.notes.some((x) => x.id === noteId))
  const all = await portal(lee, 'familyNotesAll')
  assert.equal(all.status, 200)
})

await test('a coach writes only to families in their own sessions, and edits only their own notes', async () => {
  const sam = client(); await signIn(sam, 'jonerfootballsam@gmail.com', 'staff')
  const dean = client(); await signIn(dean, 'jonerfootballdean@gmail.com', 'staff')
  const mine = await portal(sam, 'familyNoteSave', { rowId: ROW, text: 'From Sam.' })
  assert.equal(mine.status, 200, JSON.stringify(mine.data))
  assert.equal((await portal(dean, 'familyNoteSave', { rowId: ROW, text: 'Not my player.' })).status, 404)
  assert.equal((await portal(dean, 'familyNoteSave', { id: mine.data.note.id, text: 'Changed.' })).status, 403)
  assert.equal((await portal(dean, 'familyNoteDelete', { id: mine.data.note.id })).status, 403)
  assert.equal((await portal(sam, 'familyNotesAll')).status, 403, 'only Lee and Ligia see every note')
  assert.equal((await portal(sam, 'familyNoteDelete', { id: mine.data.note.id })).status, 200)
})

await test('the VAPID signature checks out against the public key', async () => {
  const p = (await pushes()).at(-1)
  const [, jwt] = p.headers.Authorization.match(/t=([^,]+)/)
  const [h, c, sig] = jwt.split('.')
  const pub = Buffer.from(VAPID.JFP_VAPID_PUBLIC, 'base64url')
  const key = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33).toString('base64url') }, format: 'jwk' })
  assert.ok(crypto.verify('sha256', Buffer.from(`${h}.${c}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url')))
  assert.equal(JSON.parse(Buffer.from(c, 'base64url')).aud, 'https://push.test')
})

await test('a family cannot reach the staff note actions', async () => {
  const r = await riley.call('/api/jfp-portal-data', { action: 'familyNoteSave', rowId: ROW, text: 'x x' })
  assert.ok([401, 403].includes(r.status), String(r.status))
})

await test('a new announcement goes to the phone; the nightly run never sends it twice', async () => {
  const r = await portal(lee, 'announceSave', { title: 'Saturday is on', body: 'All sessions on this Saturday.', audience: { type: 'all' } })
  assert.equal(r.status, 200, JSON.stringify(r.data))
  const n = (await to(ph)).filter((x) => x.title === 'Saturday is on').length
  assert.equal(n, 1)
  const t = await fetch(`${B}/api/jfp-groups?pushTick=1`, { headers: { authorization: 'Bearer local-cron-secret' } })
  assert.equal(t.status, 200)
  assert.equal((await to(ph)).filter((x) => x.title === 'Saturday is on').length, 1)
})

await test('the night before a session: one reminder, sent once, and nothing without the cron secret', async () => {
  assert.equal((await fetch(`${B}/api/jfp-groups?pushTick=1`)).status, 401)
  const e = (await acct(riley, 'overview')).data.players.flatMap((p) => p.enrolments).find((x) => x.rowId === ROW)
  const at = e.sessions[0].startMs - 20 * 3600 * 1000
  const go = () => fetch(`${B}/api/jfp-groups?pushTick=1&now=${at}`, { headers: { authorization: 'Bearer local-cron-secret' } })
  assert.equal((await go()).status, 200)
  await go()
  const rem = (await to(ph)).filter((x) => x.title === 'JFP tomorrow')
  assert.equal(rem.length, 1)
  assert.match(rem[0].body, /Riley has JFP at 4:20pm, Belrose HQ/)
})

await test('a phone that turned notifications off is forgotten when the push service says gone', async () => {
  const g = phone('gone-phone')
  await acct(other, 'pushSubscribe', { sub: g.sub })
  await portal(lee, 'announceSave', { title: 'Second notice', body: 'Words.', audience: { type: 'all' } })
  assert.equal((await acct(other, 'pushState', { endpoint: g.sub.endpoint })).data.push.thisDevice, false)
})

// ---------- player logins ----------
await test('a player under 12 cannot get their own login', async () => {
  const r = await acct(riley, 'playerLoginSet', { playerKey: rileyP.key, email: 'riley.own@example.com' })
  assert.equal(r.status, 400)
  assert.match(r.data.error, /12 and over/)
})

const player = client()
await test('a parent sets up a 12+ player login; the player sees only their own things', async () => {
  const pr = await acct(riley, 'saveProfile', { playerKey: rileyP.key, values: { dob: '2012-01-05' } })
  assert.equal(pr.status, 200, JSON.stringify(pr.data))
  assert.equal((await acct(riley, 'playerLoginSet', { playerKey: rileyP.key, email: 'returning@example.com' })).status, 400, 'not the parent\'s own email')
  assert.equal((await acct(riley, 'playerLoginSet', { playerKey: rileyP.key, email: 'parent10@example.com' })).status, 400, 'not another family')
  const s = await acct(riley, 'playerLoginSet', { playerKey: rileyP.key, email: 'riley.own@example.com' })
  assert.equal(s.status, 200, JSON.stringify(s.data))
  assert.equal((await acct(riley, 'overview')).data.players.find((p) => p.key === rileyP.key).login, 'riley.own@example.com')
  await signIn(player, 'riley.own@example.com', 'parent')
  const ov = (await acct(player, 'overview')).data
  assert.equal(ov.playerLogin, true)
  assert.equal(ov.players.length, 1)
  assert.equal(ov.parentName, '')
  assert.deepEqual([ov.todo.length, ov.owed.length, ov.paid.length], [0, 0, 0])
  const e = ov.players[0].enrolments[0]
  assert.equal(e.payment, undefined)
  assert.ok(e.attendance)
  const text = JSON.stringify(ov)
  assert.ok(!/returning@example|Rita|A\$/.test(text), 'no parent email, parent name or money')
})

await test('the player cannot pay, see fees, sign waivers or change the family', async () => {
  for (const action of ['fees', 'pay', 'payOwed', 'profiles', 'saveProfile', 'signWaiver', 'playerLoginSet', 'nextTermChoice', 'receiptPdf', 'addPlayer']) {
    const r = await acct(player, action, {})
    assert.equal(r.status, 403, `${action} -> ${r.status}`)
  }
})

await test('the player can say they cannot make a session; the parent sees it too', async () => {
  const ov = (await acct(player, 'overview')).data
  const e = ov.players[0].enrolments[0]
  const date = e.sessions.at(-1).iso
  const r = await acct(player, 'cancelSession', { rowId: e.rowId, date, reason: 'sick', note: '' })
  assert.equal(r.status, 200, JSON.stringify(r.data))
  const pe = (await acct(riley, 'overview')).data.players.flatMap((p) => p.enrolments).find((x) => x.rowId === e.rowId)
  assert.ok(pe.cancelled.some((c) => c.id === r.data.cancellation.id))
  assert.equal((await acct(player, 'cancelSession', { rowId: 'recNOTHERS', date, reason: 'sick' })).status, 404)
  assert.equal((await acct(player, 'withdrawCancel', { id: r.data.cancellation.id })).status, 200)
})

await test('coach notes reach the player too, on their own phone', async () => {
  const pp = phone('player-phone')
  await acct(player, 'pushSubscribe', { sub: pp.sub })
  const r = await portal(lee, 'familyNoteSave', { rowId: ROW, text: 'Nice work, Riley.' })
  assert.equal(r.status, 200)
  assert.ok((await acct(player, 'overview')).data.notes.some((n) => n.text === 'Nice work, Riley.'))
  assert.equal((await to(pp)).filter((x) => /coach/i.test(x.title)).length, 1)
})

await test('removing the login: the player sees an empty account', async () => {
  assert.equal((await acct(riley, 'playerLoginRemove', { playerKey: rileyP.key })).status, 200)
  const ov = (await acct(player, 'overview')).data
  assert.ok(!ov.playerLogin)
  assert.ok(!ov.players.some((p) => p.enrolments.length))
})

console.log(`\n${passed} account checks passed`)
process.exit(0)
