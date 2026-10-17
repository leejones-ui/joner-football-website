// Player reports (Lee, 18 Oct 2026), end to end on the harness. A coach
// writes a report for one of their own players and sends it; it lands in that
// family's My account (Player reports) and the parent, and the player if they
// have their own login, get an email with the PDF. Nobody else, ever.
// Starts its own copy of the local harness (fake Airtable, fake Brevo, in
// memory KV) on a free port, so nothing real is emailed or written.
//   npx astro build && node scripts/test-jfp-reports-flow.mjs
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
const ok = async (c, action, body) => { const r = await portal(c, action, body); assert.equal(r.status, 200, `${action}: ${JSON.stringify(r.data)}`); return r.data }
const reportMails = async () => (await emails()).filter((e) => /player report/i.test(e.subject))

const lee = client(), sam = client(), dean = client()
await signIn(lee, 'leejones@jonerfootball.com', 'staff')
await signIn(sam, 'jonerfootballsam@gmail.com', 'staff')
await signIn(dean, 'jonerfootballdean@gmail.com', 'staff')

// Sam coaches Thursday, Dean coaches Friday. The Ashdown family has one
// child in each; the Brightwell family has one child with Sam.
const THU = (await ok(lee, 'saveGroup', { group: { day: 'Thursday', time: '4:15pm', location: 'Belrose HQ', coachId: 'sam', capacity: 10, mode: 'direct' } })).group.id
const FRI = (await ok(lee, 'saveGroup', { group: { day: 'Friday', time: '5:30pm', location: 'Belrose HQ', coachId: 'dean', capacity: 10, mode: 'direct' } })).group.id
const parentA = { name: 'Pat Ashdown', email: 'pat.ashdown@example.com', mobile: '0400 111 222' }
const AVA = (await ok(lee, 'addPlayer', { groupId: THU, force: true, player: { name: 'Ava Ashdown', age: 13 }, parent: parentA, payment: 'full' })).rowId
const BEN = (await ok(lee, 'addPlayer', { groupId: FRI, force: true, player: { name: 'Ben Ashdown', age: 10 }, parent: parentA, payment: 'full' })).rowId
const CARA = (await ok(lee, 'addPlayer', { groupId: THU, force: true, player: { name: 'Cara Brightwell', age: 11 }, parent: { name: 'Robin Brightwell', email: 'robin.b@example.com', mobile: '0400 333 444' }, payment: 'full' })).rowId

const famA = client(), famB = client(), avaLogin = client()
await signIn(famA, parentA.email, 'parent')
await signIn(famB, 'robin.b@example.com', 'parent')

const RATINGS = { attendance: 5, attitude: 4, passing: 3, first_touch: 4, both_feet: 2 }
const fields = (extra = {}) => ({ program: 'JFP Performance', termNo: '4', year: '2026', reportDate: '2026-12-05', location: 'Belrose HQ', coachName: 'Coach Sam', ratings: RATINGS, feedback: 'Ava worked hard all term.\n\nNext: scan before receiving.', reminder: 'Keep your spot for Term 1 in My account.', ...extra })

await test('a player 12 and over gets their own login (from the family account)', async () => {
  const ov = (await acct(famA, 'overview')).data
  const ava = ov.players.find((p) => p.name === 'Ava Ashdown')
  assert.equal((await acct(famA, 'saveProfile', { playerKey: ava.key, values: { dob: '2013-01-05' } })).status, 200)
  const s = await acct(famA, 'playerLoginSet', { playerKey: ava.key, email: 'ava.own@example.com' })
  assert.equal(s.status, 200, JSON.stringify(s.data))
  await signIn(avaLogin, 'ava.own@example.com', 'parent')
})

await test('a coach sees only the players in their own groups; Lee sees everyone', async () => {
  const s = await ok(sam, 'reportHome')
  const names = s.players.map((p) => p.name).sort()
  assert.deepEqual(names, ['Ava Ashdown', 'Cara Brightwell'])
  assert.equal(s.isAdmin, false)
  assert.equal(s.form.attrs.length, 16)
  const d = await ok(dean, 'reportHome')
  assert.deepEqual(d.players.map((p) => p.name), ['Ben Ashdown'])
  const l = await ok(lee, 'reportHome')
  for (const n of ['Ava Ashdown', 'Ben Ashdown', 'Cara Brightwell']) assert.ok(l.players.some((p) => p.name === n), n)
  for (const bad of ['pat.ashdown', '0400', 'robin.b']) assert.ok(!JSON.stringify(s).includes(bad), `no ${bad} on the coach list`)
})

await test('a coach cannot start, save or read a report for someone else\'s player', async () => {
  assert.equal((await portal(dean, 'reportStart', { rowId: AVA })).status, 404)
  assert.equal((await portal(dean, 'reportSave', { rowId: AVA, fields: fields() })).status, 404)
  assert.equal((await portal(sam, 'reportStart', { rowId: BEN })).status, 404)
  assert.equal((await portal(sam, 'reportStart', { rowId: 'recNOPE' })).status, 404)
})

let RID = ''
await test('Sam starts Ava\'s report: filled in from her group, saved as a draft, carried on later', async () => {
  const st = await ok(sam, 'reportStart', { rowId: AVA })
  assert.equal(st.report.id, '')
  assert.equal(st.report.player, 'Ava Ashdown')
  assert.equal(st.report.termNo, '4')
  const sv = await ok(sam, 'reportSave', { rowId: AVA, fields: fields() })
  RID = sv.report.id
  assert.match(RID, /^RPT-/)
  assert.equal(sv.report.status, 'draft')
  assert.equal(sv.report.overall, 3.6)
  const again = await ok(sam, 'reportStart', { rowId: AVA })
  assert.equal(again.resumed, true)
  assert.equal(again.report.id, RID)
  assert.equal(again.report.feedback, fields().feedback)
  // The player's name always comes from the row, never the browser.
  const sneaky = await ok(sam, 'reportSave', { id: RID, rowId: CARA, fields: { ...fields(), player: 'Someone Else' } })
  assert.equal(sneaky.report.player, 'Ava Ashdown')
  assert.equal(sneaky.report.rowId, AVA)
  assert.equal((await portal(dean, 'reportGet', { id: RID })).status, 404)
  assert.equal((await portal(dean, 'reportSave', { id: RID, fields: fields() })).status, 404)
})

await test('bad input is cleaned: ratings 0 to 5 only, a long feedback is refused', async () => {
  const r = await portal(sam, 'reportSave', { id: RID, fields: fields({ feedback: 'x'.repeat(2600) }) })
  assert.equal(r.status, 400)
  const c = await ok(sam, 'reportSave', { id: RID, fields: fields({ ratings: { ...RATINGS, passing: 9, dribbling: -1, awareness: 2.5 } }) })
  assert.deepEqual([c.report.ratings.passing, c.report.ratings.dribbling, c.report.ratings.awareness], [0, 0, 0])
  await ok(sam, 'reportSave', { id: RID, fields: fields() })
})

await test('the PDF saves for the coach before sending, and nothing has been emailed', async () => {
  const p = await ok(sam, 'reportPdf', { id: RID })
  assert.equal(p.filename, 'JFP_Report_Ava_Ashdown_Term4_2026.pdf')
  assert.equal(Buffer.from(p.pdf, 'base64').subarray(0, 5).toString(), '%PDF-')
  assert.equal((await reportMails()).length, 0)
  assert.equal((await acct(famA, 'reports')).data.reports.length, 0, 'a draft is not in the family account')
})

let RECIPS
await test('who it goes to: the parent and Ava\'s own login, emails masked for a coach', async () => {
  const r = await ok(sam, 'reportRecipients', { id: RID })
  RECIPS = r.recipients
  assert.deepEqual(RECIPS.map((x) => x.role).sort(), ['parent', 'player login'])
  assert.ok(RECIPS.every((x) => x.email.includes('•')), 'masked for the coach')
  const l = await ok(lee, 'reportRecipients', { id: RID })
  assert.ok(l.recipients.some((x) => x.email === 'pat.ashdown@example.com'), 'Lee sees the real email')
})

await test('send is refused without the confirm, or when the list shown is not the list now', async () => {
  assert.equal((await portal(sam, 'reportSend', { id: RID, expect: RECIPS })).status, 400)
  const wrong = await portal(sam, 'reportSend', { id: RID, confirm: true, expect: RECIPS.slice(0, 1) })
  assert.equal(wrong.status, 409)
  assert.equal(wrong.data.code, 'recipients')
  assert.equal((await portal(dean, 'reportSend', { id: RID, confirm: true, expect: RECIPS })).status, 404)
  assert.equal((await reportMails()).length, 0)
})

await test('Sam sends it: the parent and Ava each get one email with the PDF; nobody else does', async () => {
  const r = await ok(sam, 'reportSend', { id: RID, confirm: true, expect: RECIPS.map(({ role, name }) => ({ role, name })) })
  assert.equal(r.report.status, 'sent')
  assert.ok(r.report.recipients.every((x) => x.status === 'sent'), JSON.stringify(r.report.recipients))
  const m = await reportMails()
  assert.equal(m.length, 2)
  const toParent = m.find((e) => e.to.includes('pat.ashdown@example.com'))
  const toAva = m.find((e) => e.to.includes('ava.own@example.com'))
  assert.ok(toParent && toAva)
  assert.equal(toParent.subject, "Ava's JFP player report, Term 4 2026")
  assert.equal(toAva.subject, 'Your JFP player report, Term 4 2026')
  for (const e of [toParent, toAva]) {
    assert.equal(e.to.length, 1)
    assert.equal(e.replyTo, 'ligia@jonerfootball.com')
    assert.equal(e.attachments.length, 1)
    assert.equal(e.attachments[0].name, 'JFP_Report_Ava_Ashdown_Term4_2026.pdf')
    assert.equal(Buffer.from(e.attachments[0].base64, 'base64').subarray(0, 5).toString(), '%PDF-')
    assert.match(e.html, /\/jfp-account\/#reports/)
    assert.ok(!/—/.test(e.html), 'no em dashes')
    assert.ok(!/Coach Sam|Sam\b/.test(e.html.replace(/jonerfootballsam/g, '')), 'no coach name in the email')
  }
  assert.ok(!m.some((e) => e.to.includes('robin.b@example.com')))
  // A double tap or a second device: never sent twice.
  const twice = await portal(sam, 'reportSend', { id: RID, confirm: true, expect: RECIPS.map(({ role, name }) => ({ role, name })) })
  assert.equal(twice.status, 409)
  assert.equal((await reportMails()).length, 2)
})

await test('a sent report cannot be changed or deleted', async () => {
  const e = await portal(sam, 'reportSave', { id: RID, fields: fields({ feedback: 'changed' }) })
  assert.equal(e.status, 409)
  assert.equal((await portal(sam, 'reportDelete', { id: RID })).status, 409)
})

await test('it lands in the Ashdowns\' My account under Player reports, new until opened, with the PDF', async () => {
  const ov = (await acct(famA, 'overview')).data
  assert.equal(ov.reports.length, 1)
  assert.equal(ov.reports[0].unread, true)
  const r = (await acct(famA, 'reports')).data
  assert.equal(r.reports.length, 1)
  assert.equal(r.reports[0].player, 'Ava Ashdown')
  assert.equal(r.reports[0].feedback, fields().feedback)
  assert.equal(r.form.attrs.length, 16)
  const pdf = await acct(famA, 'reportPdf', { id: RID })
  assert.equal(pdf.status, 200)
  assert.equal(Buffer.from(pdf.data.pdf, 'base64').subarray(0, 5).toString(), '%PDF-')
  assert.equal((await acct(famA, 'overview')).data.reports[0].unread, false)
})

await test('another family never sees it, and cannot fetch its PDF', async () => {
  assert.equal((await acct(famB, 'reports')).data.reports.length, 0)
  assert.equal((await acct(famB, 'overview')).data.reports.length, 0)
  assert.equal((await acct(famB, 'reportPdf', { id: RID })).status, 404)
  assert.equal((await acct(famB, 'reportRead', { ids: [RID] })).data.read, 0)
})

await test('Ava\'s own login sees her report; Ben\'s report goes to the parent only and Ava never sees it', async () => {
  assert.equal((await acct(avaLogin, 'reports')).data.reports.length, 1)
  const st = await ok(dean, 'reportSave', { rowId: BEN, fields: fields({ coachName: 'Coach Dean', feedback: 'Ben listened well.' }) })
  const rec = (await ok(dean, 'reportRecipients', { id: st.report.id })).recipients
  assert.deepEqual(rec.map((x) => x.role), ['parent'])
  await ok(dean, 'reportSend', { id: st.report.id, confirm: true, expect: rec })
  const a = (await acct(avaLogin, 'reports')).data.reports
  assert.deepEqual(a.map((x) => x.player), ['Ava Ashdown'])
  assert.equal((await acct(avaLogin, 'reportPdf', { id: st.report.id })).status, 404)
  assert.deepEqual((await acct(famA, 'reports')).data.reports.map((x) => x.player).sort(), ['Ava Ashdown', 'Ben Ashdown'])
})

await test('a second report for the same player this term only goes on purpose', async () => {
  const st = await ok(sam, 'reportStart', { rowId: AVA })
  assert.equal(st.report.id, '', 'a fresh card, not the sent one')
  const sv = await ok(sam, 'reportSave', { rowId: AVA, fields: fields({ feedback: 'End of term update.' }) })
  const exp = RECIPS.map(({ role, name }) => ({ role, name }))
  const first = await portal(sam, 'reportSend', { id: sv.report.id, confirm: true, expect: exp })
  assert.equal(first.status, 409)
  assert.equal(first.data.code, 'again')
  await ok(sam, 'reportSend', { id: sv.report.id, confirm: true, expect: exp, again: true })
  assert.equal((await acct(famA, 'reports')).data.reports.length, 3)
})

await test('a coach cannot take a report out; Lee can, and put it back', async () => {
  assert.equal((await portal(sam, 'reportWithdraw', { id: RID })).status, 403)
  await ok(lee, 'reportWithdraw', { id: RID, on: true })
  assert.ok(!(await acct(famA, 'reports')).data.reports.some((x) => x.id === RID))
  assert.equal((await acct(famA, 'reportPdf', { id: RID })).status, 404)
  await ok(lee, 'reportWithdraw', { id: RID, on: false })
  assert.ok((await acct(famA, 'reports')).data.reports.some((x) => x.id === RID))
})

await test('Lee can write and send a report for any player', async () => {
  const sv = await ok(lee, 'reportSave', { rowId: CARA, fields: fields({ coachName: 'Lee Jones', feedback: 'Cara was brave on the ball.' }) })
  const rec = (await ok(lee, 'reportRecipients', { id: sv.report.id })).recipients
  assert.deepEqual(rec.map((x) => x.email), ['robin.b@example.com'])
  await ok(lee, 'reportSend', { id: sv.report.id, confirm: true, expect: rec })
  assert.deepEqual((await acct(famB, 'reports')).data.reports.map((x) => x.player), ['Cara Brightwell'])
  assert.ok(!(await acct(famA, 'reports')).data.reports.some((x) => x.player === 'Cara Brightwell'))
})

await test('a draft can be deleted by the coach who started it, not by another coach', async () => {
  const sv = await ok(sam, 'reportSave', { rowId: CARA, fields: fields({ feedback: 'draft only' }) })
  assert.equal((await portal(dean, 'reportDelete', { id: sv.report.id })).status, 404)
  await ok(sam, 'reportDelete', { id: sv.report.id })
  assert.equal((await portal(sam, 'reportGet', { id: sv.report.id })).status, 404)
})

console.log(`${passed} player report checks passed`)
process.exit(0)
