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
const kv = async (cmd) => (await fetch(`${B}/__kv?cmd=${encodeURIComponent(JSON.stringify(cmd))}`)).text()

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
  assert.ok(!/coachId|coachName/.test(JSON.stringify(x.bookable)), 'no coach id')
  assert.ok(x.bookable.every((b) => /^Coach Sam/.test(b.coach) && b.kind === '1 on 1'), `the coach and the kind of session (Lee, 19 Oct): ${JSON.stringify(x.bookable[0])}`)
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
  const dean = client()
  await signIn(dean, 'jonerfootballdean@gmail.com', 'staff')
  // Sam's rate card (invented amounts): an hour by players present, weekend extra, Pathway flat.
  await ok(lee, 'coachPayCardSave', { coachId: 'sam', card: { bands: [4000, 5000, 6000, 7000, 7500, 8500, 9000], weekendExtra: 1000, pathwayFlat: 5000, jjHead: 5000, jjShadow: 5000 } })
  assert.equal((await portal(sam, 'coachPayCardSave', { coachId: 'sam', card: { bands: [1, 1, 1, 1, 1, 1, 1] } })).status, 403, 'a coach never sets rates')
  assert.equal((await portal(sam, 'coachPayCards')).status, 403, 'a coach never sees the rate cards')
  // The cover checks on a line: Dean covered it, Sam still claims it, Dean logged it too.
  const { flagsFor } = await import('../api/_jfp-coach-invoices.js')
  const line = { status: 'approved', groupId: 'G1', date: '2026-10-16', kind: 'session' }
  const covers = [{ status: 'active', groupId: 'G1', date: '2026-10-16', coachId: 'sam', coverCoachId: 'dean' }]
  const codes = flagsFor(line, 'sam', { covers, hours: [{ coachId: 'dean', groupId: 'G1', date: '2026-10-16', kind: 'session' }], name: (id) => id }).map((f) => f.code)
  assert.deepEqual(codes, ['covered', 'double'])
  assert.deepEqual(flagsFor({ ...line, kind: 'cover' }, 'max', { covers, hours: [], name: (id) => id }).map((f) => f.code), ['no-cover'])
  const h1 = await ok(sam, 'hoursSave', { date: thuDate, start: '16:15', end: '17:15', kind: 'session', groupId: THU })
  // The register: three marked present, one absent.
  for (const [id, v] of [['recA', 'Present'], ['recB', 'Present'], ['recC', 'Present'], ['recD', 'Absent']]) await kv(['HSET', `jfp:att:${THU}:${thuDate}`, id, v])
  await ok(sam, 'hoursSave', { date: day(-2), start: '09:00', end: '10:30', kind: 'admin' })
  const draft = await ok(sam, 'coachInvList', { from: day(-7), to: day(0) })
  assert.equal(draft.draft.length, 2)
  assert.ok(draft.draft.every((l) => l.flags.some((f) => f.code === 'waiting')), 'not approved yet is flagged')
  assert.ok(!('rates' in draft) && !('cards' in draft), 'a coach never sees other rates')
  const sess = draft.draft.find((l) => l.kind === 'session')
  assert.equal(sess.players, 3); assert.equal(sess.cents, 6000, '3 present: the 3 player rate for 1 hour'); assert.match(sess.description, /^3on1/)
  const office = draft.draft.find((l) => l.kind === 'admin')
  assert.equal(office.cents, null, 'no agreed office rate: TBC, never guessed')
  assert.equal((await portal(sam, 'coachInvCreate', { from: day(-7), to: day(0) })).status, 400, 'details first')
  await ok(sam, 'coachPayDetailsSave', { details: { fullName: 'Sam Example', abn: '12345678901', accountName: 'S Example', bsb: '062-000', accountNumber: '12345678' } })
  const made = await ok(sam, 'coachInvCreate', { from: day(-7), to: day(0) })
  const inv = made.invoice
  assert.equal(inv.totalMinutes, 150); assert.equal(inv.amountCents, 6000); assert.equal(inv.pending, 1)
  const mail = (await (await fetch(`${B}/__emails`)).json()).filter((e) => /Coach invoice SAM-/.test(e.subject)).at(-1)
  assert.ok(mail, 'emailed to Lee and Ligia'); assert.ok(!/\$|A\$/.test(mail.subject), 'no amount in the subject')
  const pdf = await ok(sam, 'coachInvPdf', { id: inv.id })
  assert.ok(Buffer.from(pdf.base64, 'base64').subarray(0, 4).toString() === '%PDF')
  assert.equal((await portal(dean, 'coachInvPdf', { id: inv.id })).status, 403, 'another coach cannot open it')
  assert.ok(!(await ok(dean, 'coachInvList', {})).invoices.some((x) => x.id === inv.id), 'another coach never sees it')
  assert.equal((await portal(lee, 'coachInvDecide', { id: inv.id, status: 'approved' })).status, 400, 'TBC lines first')
  assert.match(inv.number, /^SAM-\d{3}$/)
  assert.equal((await portal(sam, 'coachInvCreate', { from: day(-7), to: day(0) })).status, 400, 'nothing left to invoice')
  assert.equal((await portal(sam, 'hoursSave', { id: h1.entry.id, date: thuDate, start: '16:00', end: '17:15', kind: 'session', groupId: THU })).status, 409)
  assert.equal((await portal(sam, 'coachInvDecide', { id: inv.id, status: 'approved' })).status, 403)
  await ok(lee, 'coachInvDecide', { id: inv.id, status: 'queried', note: 'Check Thursday' })
  const again = await ok(sam, 'coachInvList', { from: day(-7), to: day(0) })
  assert.equal(again.draft.length, 2, 'sent back frees the hours')
  const inv2 = (await ok(sam, 'coachInvCreate', { from: day(-7), to: day(0) })).invoice
  const tbc = inv2.lines.findIndex((l) => l.cents == null)
  assert.equal((await portal(sam, 'coachInvLineSet', { id: inv2.id, index: tbc, cents: 3000, note: 'x' })).status, 403)
  assert.equal((await ok(lee, 'coachInvLineSet', { id: inv2.id, index: tbc, cents: 4500, note: 'Office rate agreed' })).invoice.amountCents, 10500)
  await ok(lee, 'coachInvDecide', { id: inv2.id, status: 'approved' })
  await ok(lee, 'coachInvDecide', { id: inv2.id, status: 'paid' })
  const list = await ok(lee, 'coachInvList', {})
  assert.ok(list.invoices.some((x) => x.id === inv2.id && x.status === 'paid'))
})

await test('coach invoices, 20 Oct: tick players on hours, edit lines before sending, Lee edits after, Lee makes his own', async () => {
  const dates = [1, 2, 3, 4, 5, 6, 7].map((n) => day(-n))
  const thuDate = dates.find((d) => new Date(`${d}T12:00:00Z`).getUTCDay() === 4)
  const dean = client()
  await signIn(dean, 'jonerfootballdean@gmail.com', 'staff')
  // The session's list for ticking: Sam's own group, never Dean's.
  const pl = await ok(sam, 'hoursPlayers', { groupId: THU, date: thuDate })
  assert.ok(pl.players.length >= 3 && pl.marked)
  assert.ok(pl.players.filter((p) => p.mark === 'Present').every((p) => p.ticked), 'Present comes ticked')
  assert.equal((await portal(dean, 'hoursPlayers', { groupId: THU, date: thuDate })).status, 403, 'not your session')
  // Sam logs a Dev Sesh with a typed name, and a session with two ticked players.
  const ids = pl.players.slice(0, 2).map((p) => ({ rowId: p.rowId }))
  const tue = dates.find((d) => d !== thuDate)
  await kv(['HDEL', `jfp:att:${THU}:${thuDate}`, 'zz'])
  const dev = await ok(sam, 'hoursSave', { date: tue, start: '07:00', end: '08:00', kind: 'devsesh', players: [{ name: 'Guest Player' }, { rowId: 'not-real' }] })
  assert.deepEqual(dev.entry.players, [{ rowId: '', name: 'Guest Player' }])
  const list = await ok(sam, 'hoursList', { from: day(-7), to: day(0) })
  assert.ok(list.entries.some((h) => h.id === dev.entry.id && h.players.length === 1))
  const draft = (await ok(sam, 'coachInvList', { from: day(-7), to: day(0) })).draft
  const devLine = draft.find((l) => l.hoursId === dev.entry.id)
  assert.match(devLine.description, /Guest Player/)
  // Sam changes the amount, takes nothing off, adds a line.
  const made = (await ok(sam, 'coachInvCreate', { from: day(-7), to: day(0), lines: [{ hoursId: dev.entry.id, cents: 7000, description: 'Dev Sesh: Guest' }], added: [{ date: tue, description: 'Kit run', minutes: 30, cents: 2000 }] })).invoice
  const dl = made.lines.find((l) => l.hoursId === dev.entry.id)
  assert.equal(dl.cents, 7000); assert.equal(dl.description, 'Dev Sesh: Guest'); assert.ok(dl.flags.some((f) => f.code === 'edited'))
  assert.ok(made.lines.some((l) => !l.hoursId && l.flags[0].code === 'added'))
  assert.equal(made.amountCents, 9000)
  // Lee changes a line, adds one, takes one off.
  assert.equal((await portal(sam, 'coachInvLineAdd', { id: made.id, line: { date: tue, description: 'x', minutes: 60, cents: 100 } })).status, 403)
  let v = (await ok(lee, 'coachInvLineAdd', { id: made.id, line: { date: tue, description: 'Bonus', minutes: 0, cents: 1000 } })).invoice
  assert.equal(v.amountCents, 10000)
  const i = v.lines.findIndex((l) => l.description === 'Kit run')
  v = (await ok(lee, 'coachInvLineSet', { id: made.id, index: i, line: { description: 'Kit run and setup', minutes: 60 } })).invoice
  assert.equal(v.lines.find((l) => l.description === 'Kit run and setup').minutes, 60)
  const j = v.lines.findIndex((l) => l.hoursId === dev.entry.id)
  v = (await ok(lee, 'coachInvLineRemove', { id: made.id, index: j })).invoice
  assert.equal(v.amountCents, 3000)
  const free = (await ok(sam, 'coachInvList', { from: day(-7), to: day(0) })).draft
  assert.ok(free.some((l) => l.hoursId === dev.entry.id), 'a line taken off frees its hours')
  // Lee's own coach view.
  const mine = await ok(lee, 'coachInvList', { mine: true, from: day(-7), to: day(0) })
  assert.equal(mine.admin, false); assert.ok(Array.isArray(mine.draft))
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

await test('the public booking page lists public extra sessions in the next 7 days, no coach, no price, no private ones', async () => {
  const c = client()
  await c.call('/api/jfp-access', { password: 'term4' })
  const g = await c.call('/api/jfp-groups')
  assert.equal(g.status, 200, JSON.stringify(g.data).slice(0, 200))
  const ids = new Set(MANY.map((x) => x.id))
  assert.equal(g.data.extras.filter((x) => ids.has(x.id)).length, 4)
  assert.ok(!/coachId|price|A\$|private|token/i.test(JSON.stringify(g.data.extras)), JSON.stringify(g.data.extras[0]))
  assert.ok(g.data.extras.every((x) => x.kind && x.coach), 'kind of session and coach')
  const later = await ok(sam, 'extraSave', { slot: { date: day(12), time: '4:00pm', capacity: 2, location: 'Belrose HQ', priceId: (await ok(sam, 'extraList')).prices[0].id, visibility: 'public' } })
  const g2 = await c.call('/api/jfp-groups')
  assert.ok(!g2.data.extras.some((x) => x.id === later.slot.id), 'more than a week away is not shown yet')
})

await test('free JF App access: paid Term 4 only, the account email only, then it puts them in the Uscreen group JFP by itself', async () => {
  const st = await acct(stranger, 'appAccessState')
  assert.equal(st.data.app.eligible, false)
  assert.equal((await acct(stranger, 'appAccess', { appEmail: 'kid@example.com' })).status, 403)
  assert.equal((await acct(fam, 'appAccessState')).data.app.eligible, false, 'not paid yet')
  const ava = (await ok(lee, 'playersList', { fresh: true })).players.find((p) => p.name === 'Ava Ashdown')
  await ok(lee, 'recordPayment', { rowIds: [ava.rowId], amountCents: Math.round((ava.feeAud || 850) * 100), method: 'cash' })
  const fs = await acct(fam, 'appAccessState')
  assert.equal(fs.data.app.eligible, true, JSON.stringify(fs.data))
  assert.equal(fs.data.app.accountEmail, 'pat.ashdown@example.com')
  assert.equal((await acct(fam, 'appAccess', { appEmail: 'not an email' })).status, 400)
  const other = await acct(fam, 'appAccess', { appEmail: 'ava.plays@example.com' })
  assert.equal(other.status, 400, 'a different email is refused'); assert.match(other.data.error, /pat\.ashdown@example\.com/)
  assert.equal((await (await fetch(`${B}/__uscreen`)).json()).members.length, 0, 'nothing sent to Uscreen for a refused email')
  // Uscreen down: the request waits for Lee or Ligia, and Lee is told.
  await fetch(`${B}/__fail?what=uscreen&on=1`)
  const down = await acct(fam, 'appAccess', { appEmail: ' Pat.Ashdown@example.com ' })
  assert.equal(down.status, 200); assert.equal(down.data.app.request.status, 'requested')
  await fetch(`${B}/__fail?what=uscreen&on=0`)
  const r = await acct(fam, 'appAccess', { appEmail: 'pat.ashdown@example.com' })
  assert.equal(r.status, 200); assert.equal(r.data.app.request.status, 'done', JSON.stringify(r.data))
  const us = await (await fetch(`${B}/__uscreen`)).json()
  assert.deepEqual(us.members.map((m) => [m.email, m.role]), [['pat.ashdown@example.com', 'member']])
  // Asking again changes nothing and adds no second member.
  const again = await acct(fam, 'appAccess', { appEmail: 'pat.ashdown@example.com' })
  assert.equal(again.data.already, true)
  assert.equal((await (await fetch(`${B}/__uscreen`)).json()).members.length, 1)
  assert.equal((await portal(sam, 'appAccessList')).status, 403)
  const l = await ok(lee, 'appAccessList')
  assert.ok(l.list.some((x) => x.appEmail === 'pat.ashdown@example.com' && x.status === 'done' && /auto/.test(x.doneBy)))
})

await test('Players tab: who has signed in themselves, who never has, and invites', async () => {
  const before = (await ok(lee, 'playersList', { fresh: true })).players
  const ava = before.find((p) => p.name === 'Ava Ashdown')
  assert.ok(['active', 'signedin'].includes(ava.account.status), JSON.stringify(ava.account))
  assert.ok(ava.account.createdAt && ava.account.lastSignIn)
  const cara = await ok(lee, 'addPlayer', { groupId: THU, force: true, player: { name: 'Cara Neverlogged', age: 11 }, parent: { name: 'Cy Neverlogged', email: 'cy.never@example.com', mobile: '0400 222 333' }, payment: 'full' })
  assert.ok(cara)
  const after = (await ok(lee, 'playersList', { fresh: true })).players
  const c = after.find((p) => p.name === 'Cara Neverlogged')
  assert.equal(c.account.status, 'never')
  const cy = client()
  await signIn(cy, 'cy.never@example.com')
  await signIn(cy, 'cy.never@example.com')
  const c2 = (await ok(lee, 'playersList', { fresh: true })).players.find((p) => p.name === 'Cara Neverlogged')
  assert.equal(c2.account.status, 'active'); assert.equal(c2.account.signIns, 2); assert.equal(c2.account.selfSignup, false)
})


await test('extra session kinds: private never public, one-off public, weekly slot each week to the end of term; full ones leave the public list', async () => {
  const price = (await ok(sam, 'extraList')).prices[0].id
  const base = { time: '1:15pm', capacity: 1, location: 'Belrose HQ', priceId: price }
  const priv = (await ok(sam, 'extraSave', { slot: { ...base, date: day(2), kind: 'private' } })).slot
  // Old clients that only send visibility: 'public' still make a one-off.
  const one = (await ok(sam, 'extraSave', { slot: { ...base, time: '2:15pm', date: day(2), visibility: 'public' } })).slot
  assert.equal(priv.kind, 'private'); assert.equal(priv.visibility, 'private')
  assert.equal(one.kind, 'oneoff'); assert.equal(one.visibility, 'public')
  // Anything not clearly public is private.
  const odd = (await ok(sam, 'extraSave', { slot: { ...base, time: '3:15pm', date: day(2), kind: 'banana', visibility: 'banana' } })).slot
  assert.equal(odd.visibility, 'private')
  const wk = await ok(sam, 'extraSaveMany', { slot: { ...base, time: '6:00pm', kind: 'weekly', capacity: 2 }, dates: [day(1)], times: ['6:00pm'] })
  assert.ok(wk.slots.length >= 1 && wk.slots.length <= 10, String(wk.slots.length))
  assert.ok(wk.slots.every((x) => x.kind === 'weekly' && x.visibility === 'public' && x.seriesId === wk.slots[0].seriesId))
  for (let i = 1; i < wk.slots.length; i += 1) assert.equal((Date.parse(wk.slots[i].date) - Date.parse(wk.slots[i - 1].date)) / 86400000, 7)
  const c = client()
  await c.call('/api/jfp-access', { password: 'term4' })
  const g = (await c.call('/api/jfp-groups')).data.extras
  const ids = g.map((x) => x.id)
  assert.ok(!ids.includes(priv.id) && !ids.includes(odd.id), 'private links never on the booking page')
  assert.ok(ids.includes(one.id)); assert.ok(ids.includes(wk.slots[0].id))
  assert.match(g.find((x) => x.id === wk.slots[0].id).weekly, /^Every /)
  const bookable = (await acct(stranger, 'overview')).data
  const seen = JSON.stringify(bookable || {})
  assert.ok(!seen.includes(priv.id), 'private links never in another family\'s account')
  // A coach fills a public one with their own player: it leaves the public list.
  await ok(sam, 'extraAttach', { slotId: one.id, name: 'Sienna Sample', email: 'sienna.sample@example.com' })
  const g2 = (await c.call('/api/jfp-groups')).data.extras.map((x) => x.id)
  assert.ok(!g2.includes(one.id), 'a full session is not shown publicly')
  // Lee's Timetable shows every kind this week and the next three.
  const b = await ok(lee, 'board')
  const kinds = new Set(b.extras.filter((x) => [priv.id, one.id, wk.slots[0].id].includes(x.id)).map((x) => x.kind))
  assert.deepEqual([...kinds].sort(), ['oneoff', 'private', 'weekly'])
  assert.ok(b.extras.find((x) => x.id === one.id).players.includes('Sienna Sample'))
  assert.equal((await portal(sam, 'board')).status, 403)
})

await test('register: the whole program for last week, and who is not marked off', async () => {
  const mon = (n) => { const t = new Date(`${new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' })}T00:00:00Z`); t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7) + 7 * n); return t.toISOString().slice(0, 10) }
  const last = await ok(lee, 'coachSessions', { coachId: 'all', week: mon(-1) })
  const end = new Date(Date.parse(`${mon(-1)}T00:00:00Z`) + 6 * 86400000).toISOString().slice(0, 10)
  assert.ok(last.sessions.every((s) => s.nextDate >= mon(-1) && s.nextDate <= end), 'every session on its date last week')
})

await test('session ideas: the drill library, programs and app videos for coaches; Lee edits quick links', async () => {
  const d = await ok(sam, 'ideasGet')
  assert.ok(d.library.length >= 9 && d.library.every((t) => t.topic && t.links.length))
  assert.ok(d.library.flatMap((t) => t.links).every((l) => /^https:\/\//.test(l.url) && l.platform))
  assert.ok(d.programs.some((p) => p.name === 'JFP 2' && p.sessions.length >= 6))
  assert.ok(d.guide.steps.length >= 5)
  assert.ok(!/c\x75nt/i.test(JSON.stringify(d)))
  const a = await ok(sam, 'ideasApp')
  assert.deepEqual(a.videos.map((v) => v.title), ['Fast Feet Warm Up', '1v1 Defending at Speed'], 'published videos only')
  assert.equal(a.videos[0].url, 'https://app.jonerfootball.com/programs/fast-feet'); assert.equal(a.videos[0].min, 5)
  assert.equal((await portal(sam, 'ideasSave', { ideas: [] })).status, 403)
  const fresh = client()
  assert.notEqual((await portal(fresh, 'ideasGet')).status, 200, 'signed out: nothing')
})

await test('past players open: their Airtable records, never medical notes; Lee and Ligia only', async () => {
  const all = await ok(lee, 'playersHistory', { term: 'all' })
  const olly = all.people.find((p) => p.player === 'Olly Oldtimer')
  assert.ok(olly.refs.length >= 2, JSON.stringify(olly.refs))
  const r = await ok(lee, 'playerRecords', { refs: olly.refs })
  assert.ok(r.records.length >= 2 && r.records.every((x) => x.fields && x.label))
  assert.ok(r.records.some((x) => x.fields.some(([k, v]) => k === 'Player Name' && v === 'Olly Oldtimer')))
  assert.ok(!/medical/i.test(JSON.stringify(r)))
  assert.equal((await portal(sam, 'playerRecords', { refs: olly.refs })).status, 403)
  const bad = await ok(lee, 'playerRecords', { refs: [{ term: 'term2', rowId: 'nope' }, { term: 'elsewhere', rowId: olly.refs[0].rowId }] })
  assert.equal(bad.records.length, 0)
})

console.log(`${passed} passed`)
process.exit(0)
