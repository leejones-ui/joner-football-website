// Announcements (17 Oct 2026): one-way notices, end to end. Starts its own copy of the local harness
// (scripts/holiday-local.mjs: fake Airtable, fake Brevo, fake Telegram, in
// memory KV) on a free port, so nothing real is ever emailed, texted or written.
//   node scripts/test-jfp-announce.mjs
import assert from 'node:assert/strict'
import { cleanAnnouncement } from '../api/_jfp-announce.js'
import net from 'node:net'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const port = await new Promise((resolve) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => resolve(p)) }) })
const B = `http://localhost:${port}`
const harness = spawn(process.execPath, [path.join(HERE, 'holiday-local.mjs')], {
  // A clean environment: no real tokens can leak into the harness.
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


const ymd = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' })
const today = ymd(Date.now()), day = 86400000

await test('cleanAnnouncement: needs a title and a message, checks the audience and dates', () => {
  assert.match(cleanAnnouncement({ title: 'Hi', body: 'Long enough' }).error, /title/)
  assert.match(cleanAnnouncement({ title: 'Rain update', body: '' }).error, /message/)
  assert.match(cleanAnnouncement({ title: 'Rain update', body: 'All on', audience: { type: 'group' } }).error, /group/)
  assert.match(cleanAnnouncement({ title: 'Rain update', body: 'All on', from: '2026-10-20', until: '2026-10-19' }).error, /before/)
  const ok = cleanAnnouncement({ title: '  Rain update ', body: 'Line one\r\nLine two', audience: { type: 'nonsense', id: 'x' }, from: 'bad', pinned: 'yes' }).value
  assert.equal(ok.title, 'Rain update')
  assert.equal(ok.body, 'Line one\nLine two')
  assert.deepEqual(ok.audience, { type: 'all', id: '' })
  assert.match(ok.from, /^\d{4}-\d{2}-\d{2}$/)
  assert.equal(ok.pinned, false, 'only a real true pins')
  assert.equal(cleanAnnouncement({ title: 'x'.repeat(200), body: 'y'.repeat(5000) }).value.body.length, 1200)
})

const lee = client(); await signIn(lee, 'leejones@jonerfootball.com', 'staff')
const mk = async (group) => { const r = await portal(lee, 'saveGroup', { group }); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data.group.id }
const TUE420 = await mk({ day: 'Tuesday', time: '4:20pm', location: 'Belrose HQ', coachId: 'sam', capacity: 6, mode: 'direct' })
const WED420 = await mk({ day: 'Wednesday', time: '4:20pm', location: 'Belrose HQ', coachId: 'sam', capacity: 6, mode: 'direct' })
const rows = (await airtable()).term4
const THIRD = rows.find((r) => r.fields['Term 3 Day'] === 'Wednesday' && r.fields['Term 3 Time'] === '4:20pm')
assert.ok(THIRD)
const riley = client(); await signIn(riley, 'returning@example.com', 'parent') // Tue 4:20pm Belrose HQ
const third = client(); await signIn(third, THIRD.fields.Email, 'parent') // Wed 4:20pm Belrose HQ
const seen = async (c) => ((await acct(c, 'overview')).data.announcements || []).map((a) => a.title)

let opts
await test('Lee lists announcements with the locations and groups to choose from', async () => {
  const r = await portal(lee, 'announceList')
  assert.equal(r.status, 200, JSON.stringify(r.data))
  assert.deepEqual(r.data.announcements, [])
  opts = r.data.options
  assert.ok(opts.groups.some((g) => g.id === TUE420 && /Tuesday 4:20pm/.test(g.label)))
  assert.ok(opts.locations.length)
})

const save = async (a) => { const r = await portal(lee, 'announceSave', a); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data.announcement }
let everyone, tueOnly
await test('notices reach everyone, one location or one group, and only from their dates', async () => {
  const hq = opts.locations.find((l) => /belrose/i.test(l.name))
  assert.ok(hq, 'Belrose HQ is a location')
  everyone = await save({ title: 'Welcome to Term 4', body: 'Great to have you.\nSee you at training.', audience: { type: 'all' } })
  tueOnly = await save({ title: 'Tuesday 4:20 runs late', body: 'Finish at 5:30 this week.', audience: { type: 'group', id: TUE420 }, pinned: true })
  await save({ title: 'HQ car park works', body: 'Park on the street.', audience: { type: 'location', id: hq.id } })
  await save({ title: 'Future notice', body: 'Not yet.', from: ymd(Date.now() + 5 * day) })
  await save({ title: 'Old notice', body: 'Gone.', from: ymd(Date.now() - 10 * day), until: ymd(Date.now() - 2 * day) })
  const r = await seen(riley), t = await seen(third)
  assert.equal(r[0], 'Tuesday 4:20 runs late', 'pinned comes first')
  assert.deepEqual(new Set(r), new Set(['Tuesday 4:20 runs late', 'Welcome to Term 4', 'HQ car park works']))
  assert.deepEqual(new Set(t), new Set(['Welcome to Term 4', 'HQ car park works']), 'the Wednesday family does not see the Tuesday notice')
  const one = (await acct(riley, 'overview')).data.announcements.find((a) => a.title === 'Welcome to Term 4')
  assert.deepEqual(Object.keys(one).sort(), ['author', 'body', 'button', 'dateLabel', 'forLabel', 'from', 'id', 'pinned', 'read', 'title'], 'families never see staff emails')
  assert.deepEqual(Object.keys(one.author).sort(), ['kind', 'line', 'name', 'photo'])
  assert.ok(!JSON.stringify(one).includes('@'), 'no email addresses reach families')
  assert.equal(one.body, 'Great to have you.\nSee you at training.')
})

await test('a group that is not on the timetable is refused', async () => {
  const r = await portal(lee, 'announceSave', { title: 'Nope', body: 'Nope nope', audience: { type: 'group', id: 'no-such-group' } })
  assert.equal(r.status, 400)
})

await test('editing keeps the id; deleting removes it for families at once; both are audited', async () => {
  const e = await save({ id: everyone.id, title: 'Welcome back to Term 4', body: 'Great to have you.', audience: { type: 'all' } })
  assert.equal(e.id, everyone.id)
  assert.ok((await seen(riley)).includes('Welcome back to Term 4'))
  const d = await portal(lee, 'announceDelete', { id: tueOnly.id })
  assert.equal(d.status, 200)
  assert.ok(!(await seen(riley)).includes('Tuesday 4:20 runs late'))
  assert.equal((await portal(lee, 'announceDelete', { id: tueOnly.id })).status, 404)
  const log = JSON.stringify((await portal(lee, 'audit')).data)
  for (const a of ['announce.add', 'announce.edit', 'announce.delete']) assert.ok(log.includes(a), a)
})

await test('unread: new notices start unread; opening marks them read for that family only', async () => {
  const ov = async (c) => (await acct(c, 'overview')).data.announcements
  const before = await ov(riley)
  assert.ok(before.length && before.every((a) => a.read === false), 'all unread at first')
  const r = await acct(riley, 'announceRead', { ids: [...before.map((a) => a.id), 'ANN-not-real', '<script>'] })
  assert.equal(r.status, 200, JSON.stringify(r.data))
  assert.ok(!r.data.read.includes('ANN-not-real'), 'made-up ids are not kept')
  assert.ok((await ov(riley)).every((a) => a.read === true), 'read after opening')
  assert.ok((await ov(third)).every((a) => a.read === false), 'the other family still has them unread')
  const fresh = await save({ title: 'Brand new notice', body: 'Just posted.', audience: { type: 'all' } })
  const after = await ov(riley)
  assert.equal(after.find((a) => a.id === fresh.id).read, false, 'a new one is unread again')
  assert.equal(after.filter((a) => !a.read).length, 1)
  const anon = await fetch(`${B}/api/jfp-account`, { method: 'POST', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ action: 'announceRead', ids: [fresh.id] }) })
  assert.equal(anon.status, 401, 'signed-out marks are refused')
})

await test('From: Lee Jones, Joner Football or a coach; the button link is checked', async () => {
  const a = await save({ title: 'From Lee', body: 'Hello families', author: { type: 'lee' }, button: { label: 'Book extra sessions', url: 'https://jonerfootball.com/jfp-booking#extra' } })
  assert.equal(a.status, 'live', 'Lee posts straight away')
  assert.deepEqual(a.button, { label: 'Book extra sessions', url: '/jfp-booking#extra' }, 'our own site is kept as a path')
  const c = await save({ title: 'From Dean', body: 'Hello from Dean', author: { type: 'coach', coachId: 'dean' } })
  const fam = (await acct(riley, 'overview')).data.announcements
  assert.equal(fam.find((x) => x.id === a.id).author.name, 'Lee Jones')
  assert.equal(fam.find((x) => x.id === c.id).author.name, 'Dean McDonnell')
  assert.equal(fam.find((x) => x.id === c.id).author.line, 'Coach, Joner Football')
  assert.equal(fam.find((x) => x.title === 'Brand new notice').author.name, 'Joner Football', 'no author = Joner Football')
  for (const url of ['javascript:alert(1)', 'not a link']) assert.equal((await portal(lee, 'announceSave', { title: 'Bad link', body: 'Bad link here', button: { label: 'Go', url } })).status, 400, url)
  assert.equal((await portal(lee, 'announceSave', { title: 'No words', body: 'Button with no words', button: { label: '', url: '/jfp-booking' } })).status, 400)
  assert.equal((await portal(lee, 'announceSave', { title: 'No coach', body: 'Coach missing', author: { type: 'coach', coachId: 'nobody' } })).status, 400)
})

await test('a coach writes one, it waits for Lee or Ligia, families see it only once approved', async () => {
  const sam = client(); await signIn(sam, 'jonerfootballsam@gmail.com', 'staff')
  const tg = (await telegrams()).length
  const r = await portal(sam, 'announceSave', { title: 'Coach post', body: 'Hello all', author: { type: 'lee' } })
  assert.equal(r.status, 200, JSON.stringify(r.data))
  const p = r.data.announcement
  assert.equal(p.status, 'pending')
  assert.deepEqual(p.author, { type: 'coach', coachId: 'sam' }, 'a coach always signs as themselves')
  assert.ok(!(await seen(third)).includes('Coach post'), 'families do not see it yet')
  assert.ok((await telegrams()).slice(tg).some((m) => /Sam York wants to post/.test(JSON.stringify(m))), 'Lee and Ligia are told')
  const mine = (await portal(sam, 'announceList')).data.announcements
  assert.deepEqual(mine.map((x) => x.title), ['Coach post'], 'a coach sees only their own')
  assert.equal((await portal(sam, 'announceDecide', { id: p.id, decision: 'approve' })).status, 403, 'a coach cannot approve')
  assert.equal((await portal(sam, 'announceDelete', { id: (await portal(lee, 'announceList')).data.announcements.find((x) => x.title === 'From Lee').id })).status, 404, 'nor touch anyone else\'s')
  const ligia = client(); await signIn(ligia, 'ligia@jonerfootball.com', 'staff')
  const list = (await portal(ligia, 'announceList')).data.announcements
  assert.equal(list[0].id, p.id, 'waiting ones come first for Lee and Ligia')
  const ok = await portal(ligia, 'announceDecide', { id: p.id, decision: 'approve' })
  assert.equal(ok.status, 200, JSON.stringify(ok.data))
  assert.equal((await portal(ligia, 'announceDecide', { id: p.id, decision: 'approve' })).status, 409, 'decided once')
  const fam = (await acct(third, 'overview')).data.announcements.find((x) => x.id === p.id)
  assert.equal(fam.author.name, 'Sam York')
  // A coach edit of a live notice goes back to waiting.
  const e = await portal(sam, 'announceSave', { id: p.id, title: 'Coach post edited', body: 'Hello all again' })
  assert.equal(e.data.announcement.status, 'pending')
  assert.ok(!(await seen(third)).some((t) => /Coach post/.test(t)), 'hidden again until approved')
  const no = await portal(lee, 'announceDecide', { id: p.id, decision: 'decline', note: 'Say which week' })
  assert.equal(no.status, 200)
  const back = (await portal(sam, 'announceList')).data.announcements[0]
  assert.equal(back.status, 'declined'); assert.equal(back.declineNote, 'Say which week')
  assert.ok(!(await seen(third)).some((t) => /Coach post/.test(t)))
  const log = JSON.stringify((await portal(lee, 'audit')).data)
  for (const a of ['announce.approve', 'announce.decline']) assert.ok(log.includes(a), a)
})

await test('families cannot post', async () => {
  assert.notEqual((await portal(riley, 'announceSave', { title: 'Parent post', body: 'Hello all' })).status, 200)
  assert.ok(!(await seen(third)).includes('Parent post'))
})

await test('nothing was emailed or texted by posting', async () => {
  const mails = (await emails()).filter((m) => !/sign-in code/.test(m.subject))
  assert.deepEqual(mails.map((m) => m.subject), [])
})

console.log(`\n${passed} announcement checks passed`)
process.exit(0)
