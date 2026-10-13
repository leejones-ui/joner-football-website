// Joners Juniors stage 3, end to end against the local harness and its
// invented Juniors data: Classes (and the timetable kept in step, moving a
// child, a second class with its own places), Registers (marks, who coached,
// coaches marking their own class, My sessions on the Juniors dates), the
// Dashboard's attendance, and Messages (preview, then Send).
//   npm run build
//   JFP_JUNIORS_DEMO=1 HOLIDAY_LOCAL_PORT=4551 node scripts/holiday-local.mjs
//   node scripts/test-jj-stage3-flow.mjs 4551
// Safe on a fresh harness or after test-jfp-juniors-flow, test-jj-flow and
// test-jj-stage2-flow; the settings go back at the end. Every name and email
// in the Juniors data is invented.
import assert from 'node:assert/strict'
const B = `http://localhost:${process.argv[2] || '4551'}`
let passed = 0, ip = 1
const test = async (n, fn) => { await fn(); passed += 1; console.log(`ok - ${n}`) }
function client() {
  const jar = new Map(), me = `10.8.0.${ip++}`
  return async (p, body, method = 'POST') => {
    const res = await fetch(`${B}${p}`, { method, headers: { 'content-type': 'application/json', origin: B, 'x-forwarded-for': me, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') }, ...(method === 'POST' ? { body: JSON.stringify(body || {}) } : {}) })
    for (const c of res.headers.getSetCookie?.() || []) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar.set(kv.slice(0, i), kv.slice(i + 1)) }
    let data = {}; try { data = await res.json() } catch {}
    return { status: res.status, data }
  }
}
async function signIn(call, email, audience = 'staff') {
  const s = await call('/api/jfp-auth', { action: 'start', email, audience })
  const code = (await (await fetch(`${B}/__emails`)).json()).filter((e) => e.to.includes(email) && /sign-in code/.test(e.subject)).at(-1).subject.match(/(\d{6})/)[1]
  assert.equal((await call('/api/jfp-auth', { action: 'verify', challenge: s.data.challenge, code })).status, 200)
}
const get = async (p) => (await fetch(`${B}${p}`)).json()
const airtable = () => get('/__airtable')
const kv = async (cmd) => { const t = await (await fetch(`${B}/__kv?cmd=${encodeURIComponent(JSON.stringify(cmd))}`)).text(); try { return JSON.parse(t) } catch { return t } }
const emails = () => get('/__emails')
const kvJson = async (key) => { const v = await kv(['GET', key]); return typeof v === 'string' ? JSON.parse(v) : v }
const hashOf = (flat) => { const o = {}; for (let i = 0; i + 1 < (flat || []).length; i += 2) o[flat[i]] = flat[i + 1]; return o }
const iso = (d) => d.toISOString().slice(0, 10)

// The harness's own staff (the portal's default coaches) and invented families.
const lee = client(); await signIn(lee, 'leejones@jonerfootball.com')
const sam = client(); await signIn(sam, 'jonerfootballsam@gmail.com')
const ruby = client(); await signIn(ruby, 'jonerfootballruby@gmail.com')
const dean = client(); await signIn(dean, 'jonerfootballdean@gmail.com')
const parent = client(); await signIn(parent, 'fox@example.com', 'parent')
const portal = (action, body = {}) => lee('/api/jfp-portal-data', { action, ...body })
const messages = (action, body = {}) => lee('/api/jfp-messages', { action, ...body })
const restore = (await portal('jjSettings')).data.juniors
const jfpBefore = (await portal('money', { fresh: true })).data.money.kpis
const jfpMsgBefore = (await messages('overview')).data
const A0 = restore.classes[0]
const A = { ...A0, shadowCoachId: 'ruby' }
const Bc = { id: 'sat-1015-belrose', day: 'Saturday', time: '10:15am', endTime: '11:00am', location: 'Belrose HQ', capacity: 1, coachId: 'lee', shadowCoachId: '' }
const GA = 'sat-0915-belrose-hq'
const kids = async () => (await portal('jjPlayers', { fresh: true })).data
const rowOf = async (rowId) => (await airtable()).juniors4.find((r) => r.id === rowId)

// Past class dates for the registers: the term starts four Saturdays ago (put back at the end).
const now = new Date(`${new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' })}T00:00:00Z`)
const lastSat = new Date(now.getTime() - (((now.getUTCDay() + 1) % 7) * 86400000))
const start = iso(new Date(lastSat.getTime() - 21 * 86400000))
assert.equal((await portal('jjSaveSettings', { juniors: { termStart: start } })).status, 200)

await test('only Lee and Ligia change classes and send messages; coaches get 403, families 401', async () => {
  for (const action of ['jjClasses', 'jjSaveClasses', 'jjSyncClasses', 'jjMoveChild']) {
    assert.equal((await dean('/api/jfp-portal-data', { action })).status, 403, action)
    assert.equal((await parent('/api/jfp-portal-data', { action })).status, 401, action)
  }
  for (const action of ['jjMsgOverview', 'jjMsgPrepare', 'jjMsgSend', 'jjMsgCancel']) {
    assert.equal((await dean('/api/jfp-messages', { action })).status, 403, action)
    assert.equal((await parent('/api/jfp-messages', { action })).status, 401, action)
  }
  assert.equal((await dean('/api/jfp-portal-data', { action: 'jjRegister' })).status, 403, 'a coach not on a Juniors class')
  assert.equal((await parent('/api/jfp-portal-data', { action: 'jjRegister' })).status, 401)
  assert.equal((await portal('jjSaveSettings', { juniors: { classes: [A] } })).data.error, 'Classes are changed on the Classes page.')
})

await test('Classes: the class with a shadow coach goes on the timetable, in step, with its children', async () => {
  const r = await portal('jjSaveClasses', { classes: [A] })
  assert.equal(r.status, 200, JSON.stringify(r.data))
  assert.ok([...r.data.timetableReport.created, ...r.data.timetableReport.updated].includes(GA))
  const c = r.data.classes[0]
  assert.equal(c.timetable.ok, true)
  assert.deepEqual([c.head.id, c.shadow.id, c.capacity], ['sam', 'ruby', A.capacity])
  const all = (await kids()).counts.all
  assert.equal(c.enrolled, all, 'one class: every child is in it')
  const board = (await portal('board')).data.groups.find((g) => g.id === GA)
  assert.deepEqual([board.label, board.coachId, board.extraCoachIds, board.capacity], ['Joners Juniors', 'sam', ['ruby'], A.capacity])
  assert.equal(board.players.length, all)
  // The shadow coach sees it in My sessions, on the Juniors dates.
  const mine = (await ruby('/api/jfp-portal-data', { action: 'coachSessions' })).data.sessions.find((s) => s.id === GA)
  assert.ok(mine, 'the shadow coach has the class')
  assert.equal(mine.dates[0].iso, iso(new Date(Date.parse(`${start}T00:00:00Z`))), 'the Juniors term dates, not the JFP ones')
})

let mover
await test('a second class with its own places: a child moves in (Airtable updated), then it is full for the next one', async () => {
  const r = await portal('jjSaveClasses', { classes: [A, Bc] })
  assert.equal(r.status, 200, JSON.stringify(r.data))
  assert.ok(r.data.timetableReport.created.includes('sat-1015-belrose-hq'))
  const d = await kids()
  const [x, y] = d.players.filter((p) => !p.removed)
  mover = x
  const m = await portal('jjMoveChild', { rowId: x.rowId, classId: Bc.id })
  assert.equal(m.status, 200, JSON.stringify(m.data))
  const f = (await rowOf(x.rowId)).fields
  assert.deepEqual([f['Session Day'], f['Session Time'], f['Location']], ['Saturday', '10:15am', 'Belrose HQ'])
  assert.match(f.Notes, /Moved from Saturday 9:15am Belrose HQ to Saturday 10:15am Belrose HQ by /)
  assert.ok(!('Class' in f), 'the Term 4 table has no Class column: left out, as always')
  const full = await portal('jjMoveChild', { rowId: y.rowId, classId: Bc.id })
  assert.deepEqual([full.status, full.data.code], [409, 'full'])
  assert.match(full.data.error, /1 of 1 places taken\. Move anyway\?/)
  const add = await portal('jjAddPlayer', { player: { name: 'Kid Overflow' }, parent: { name: 'P', email: 'overflow@example.com' }, classId: Bc.id })
  assert.deepEqual([add.status, add.data.code], [409, 'full'])
  const after = await kids()
  assert.deepEqual(after.classes.map((c) => [c.id, c.enrolled]), [[A.id, d.counts.all - 1], [Bc.id, 1]])
  assert.equal(after.players.find((p) => p.rowId === x.rowId).classId, Bc.id)
  // The website: that class is full (waitlist), the other is not.
  const info = (await get('/api/juniors-info')).juniors
  assert.deepEqual(info.classes.map((c) => [c.id, c.full]), [[A.id, false], [Bc.id, true]])
  assert.equal(info.full, false)
  const board = (await portal('board')).data.groups.find((g) => g.id === 'sat-1015-belrose-hq')
  assert.deepEqual(board.players.map((p) => p.name), [x.name])
  const dash = (await portal('jjDashboard')).data
  assert.ok(dash.needs.some((n) => n.kind === 'full' && /Saturday 10:15am to 11:00am is full \(1 of 1\)/.test(n.label)))
})

await test('a class that moves takes its children and its timetable group with it; a class with children cannot go', async () => {
  const later = { ...Bc, time: '11:15am', endTime: '12:00pm' }
  const r = await portal('jjSaveClasses', { classes: [A, later] })
  assert.equal(r.status, 200, JSON.stringify(r.data))
  assert.equal(r.data.rowsWritten, 1)
  const f = (await rowOf(mover.rowId)).fields
  assert.equal(f['Session Time'], '11:15am')
  assert.match(f.Notes, /Class changed from Saturday 10:15am Belrose HQ to Saturday 11:15am Belrose HQ/)
  const groups = (await portal('board')).data.groups.map((g) => g.id)
  assert.ok(groups.includes('sat-1115-belrose-hq') && !groups.includes('sat-1015-belrose-hq'))
  const no = await portal('jjSaveClasses', { classes: [A] })
  assert.deepEqual([no.status, no.data.code], [409, 'children'])
  assert.equal((await portal('jjMoveChild', { rowId: mover.rowId, classId: A.id })).status, 200)
  const ok = await portal('jjSaveClasses', { classes: [A] })
  assert.equal(ok.status, 200, JSON.stringify(ok.data))
  assert.deepEqual(ok.data.timetableReport.removed, ['sat-1115-belrose-hq'])
  assert.equal((await rowOf(mover.rowId)).fields['Session Time'], A.time)
})

let reg, dates, past
await test('Registers: Lee marks a child; the register, who coached and the Airtable Attendance row (Joners Juniors)', async () => {
  reg = (await portal('jjRegister', { classId: A.id })).data
  dates = reg.dates.map((x) => x.iso)
  past = reg.dates.filter((x) => x.past).map((x) => x.iso)
  assert.ok(past.length >= 3, 'four past Saturdays')
  assert.equal(reg.date, past.at(-1), 'opens on the last class so far')
  assert.deepEqual([reg.session.recorded, reg.session.head.id, reg.session.shadow.id], [false, 'sam', 'ruby'])
  const kid = reg.children[0]
  const r = await portal('jjMark', { classId: A.id, date: past[0], rowId: kid.rowId, status: 'Present' })
  assert.deepEqual([r.status, r.data.airtable], [200, 'saved'])
  assert.equal(hashOf(await kv(['HGETALL', `jfp:att:${GA}:${past[0]}`]))[kid.rowId], 'Present')
  const rec = await kvJson(`jj:reg:${GA}:${past[0]}`)
  assert.deepEqual([rec.head, rec.shadow, rec.auto], ['sam', 'ruby', true], 'the first mark records the class coaches')
  const row = (await airtable()).attendance.find((x) => x.fields['Attendance ID'] === `JJ-W1-Sat-9:15am-${kid.name}`)
  assert.ok(row, 'one Attendance row')
  assert.deepEqual([row.fields.Programme, row.fields['Attendance Status'], row.fields.Coach, row.fields['Session Date'], row.fields['Week Number']], ['Joners Juniors', 'Present', 'Sam', past[0], 1])
  assert.equal((await portal('jjMark', { classId: A.id, date: '2026-01-03', rowId: kid.rowId, status: 'Present' })).status, 400, 'not a class date')
  assert.equal((await portal('jjMark', { classId: A.id, date: past[0], rowId: 'recNOTINTHECLASS1', status: 'Present' })).status, 404)
  // Taken off again: out of the register, the Airtable row emptied.
  assert.equal((await portal('jjMark', { classId: A.id, date: past[0], rowId: kid.rowId, status: '' })).data.airtable, 'cleared')
  assert.equal(hashOf(await kv(['HGETALL', `jfp:att:${GA}:${past[0]}`]))[kid.rowId], undefined)
  assert.equal((await airtable()).attendance.find((x) => x.fields['Attendance ID'] === `JJ-W1-Sat-9:15am-${kid.name}`).fields['Attendance Status'], null)
})

await test('coaches on the class mark it (as JFP coaches do); who coached is Lee and Ligia only; a recorded coach can mark that session', async () => {
  const [k1, k2] = reg.children
  assert.equal((await sam('/api/jfp-portal-data', { action: 'jjMark', classId: A.id, date: past[1], rowId: k1.rowId, status: 'Present' })).status, 200, 'the head coach')
  const rr = (await ruby('/api/jfp-portal-data', { action: 'jjRegister', classId: A.id, date: past[1] })).data
  assert.deepEqual(rr.classes.map((c) => c.id), [A.id]); assert.equal(rr.canEditCoaches, false); assert.equal(rr.coachTotals, undefined, 'coaches do not see everyone\'s totals')
  assert.equal(rr.children.find((c) => c.rowId === k1.rowId).status, 'Present')
  assert.equal((await ruby('/api/jfp-portal-data', { action: 'jjMark', classId: A.id, date: past[1], rowId: k2.rowId, status: 'Absent' })).status, 200, 'the shadow coach')
  assert.equal((await dean('/api/jfp-portal-data', { action: 'jjMark', classId: A.id, date: past[1], rowId: k2.rowId, status: 'Present' })).status, 403)
  assert.equal((await sam('/api/jfp-portal-data', { action: 'jjSessionCoaches', classId: A.id, date: past[1], headId: 'sam', shadowId: 'dean' })).status, 403)
  // Dean shadowed on one date instead of Ruby: recorded by Lee; Dean can mark that one only.
  const s = await portal('jjSessionCoaches', { classId: A.id, date: past[2], headId: 'sam', shadowId: 'dean' })
  assert.equal(s.status, 200, JSON.stringify(s.data))
  assert.deepEqual([s.data.session.recorded, s.data.session.shadow.id], [true, 'dean'])
  assert.equal((await portal('jjSessionCoaches', { classId: A.id, date: past[2], headId: 'sam', shadowId: 'sam' })).status, 400)
  assert.equal((await dean('/api/jfp-portal-data', { action: 'jjMark', classId: A.id, date: past[2], rowId: k1.rowId, status: 'Present' })).status, 200)
  assert.equal((await dean('/api/jfp-portal-data', { action: 'jjMark', classId: A.id, date: past[1], rowId: k1.rowId, status: 'Present' })).status, 403)
  const totals = Object.fromEntries((await portal('jjRegister', { classId: A.id })).data.coachTotals.map((t) => [t.id, t]))
  assert.ok(totals.sam.head.some((x) => x.date === past[1]) && totals.sam.head.some((x) => x.date === past[2]))
  assert.deepEqual(totals.dean.shadow.map((x) => x.date), [past[2]])
  assert.ok(totals.ruby.shadow.some((x) => x.date === past[1]) && !totals.ruby.shadow.some((x) => x.date === past[2]))
})

await test('My sessions: the coach marks the Juniors class there on a Juniors date, into the same register', async () => {
  const s = (await sam('/api/jfp-portal-data', { action: 'coachSessions' })).data.sessions.find((x) => x.id === GA)
  assert.deepEqual(s.dates.map((x) => x.iso), dates)
  const kid = s.players[0]
  const r = await sam('/api/jfp-portal-data', { action: 'markAttendance', groupId: GA, date: past.at(-1), rowId: kid.rowId, status: 'Present' })
  assert.equal(r.status, 200, JSON.stringify(r.data))
  assert.equal(hashOf(await kv(['HGETALL', `jfp:att:${GA}:${past.at(-1)}`]))[kid.rowId], 'Present')
  assert.ok(await kv(['GET', `jj:reg:${GA}:${past.at(-1)}`]), 'who coached is recorded from My sessions too')
  const back = (await portal('jjRegister', { classId: A.id, date: past.at(-1) })).data
  assert.equal(back.children.find((c) => c.rowId === kid.rowId).status, 'Present')
})

await test('Dashboard: attendance by class date, and a child missing two in a row', async () => {
  const away = reg.children.at(-1)
  for (const d of past.slice(-2)) assert.equal((await portal('jjMark', { classId: A.id, date: d, rowId: away.rowId, status: 'Absent' })).status, 200)
  const dash = (await portal('jjDashboard', { fresh: true })).data
  assert.equal(dash.attendance.ready, true)
  const w = Object.fromEntries(dash.attendance.weeks.map((x) => [x.date, x]))
  assert.ok(w[past.at(-1)].registers >= 1 && w[past.at(-1)].absent >= 1 && w[past.at(-1)].present >= 1)
  assert.ok(!dash.attendance.weeks.some((x) => x.date > dates.find((d) => !past.includes(d)) && x.registers), 'nothing in the future')
  const st = dash.attendance.streaks.find((x) => x.rowId === away.rowId)
  assert.ok(st && st.missed >= 2, JSON.stringify(dash.attendance.streaks))
  assert.ok(dash.needs.some((n) => n.kind === 'missing' && n.tab === 'jj-registers'))
})

let batch
await test('Messages: the whole class, the exact email shown, nothing sent until Send', async () => {
  const o = (await messages('jjMsgOverview')).data
  assert.equal(o.classes[0].id, A.id)
  assert.ok(o.classes[0].families >= 2)
  const before = (await emails()).length
  const r = await messages('jjMsgPrepare', { audience: 'class', classId: A.id, subject: 'No class <this> Saturday', text: 'The hall is closed for repairs.\nSee you next week.' })
  assert.equal(r.status, 200, JSON.stringify(r.data))
  batch = r.data
  assert.equal(batch.families.length, o.classes[0].families)
  assert.match(batch.previews[0].html, /Hi .+,/)
  assert.match(batch.previews[0].html, /The hall is closed for repairs\.<br>See you next week\./)
  assert.match(batch.previews[0].html, /Open your account/)
  assert.equal((await emails()).length, before, 'showing it sends nothing')
  // JFP Messages never lists or sends a Juniors message.
  const jfp = (await messages('overview')).data
  assert.ok(!jfp.messages.some((m) => m.batchId === batch.batch.id))
  assert.equal(jfp.families.length, jfpMsgBefore.families.length)
  const ids = await kv(['ZREVRANGE', 'jfp:msgs', '0', '50'])
  let jjMsg = null
  for (const id of ids) { const m = await kvJson(`jfp:msg:${id}`); if (m?.batchId === batch.batch.id) { jjMsg = m; break } }
  assert.equal(jjMsg.programme, 'juniors')
  assert.equal((await messages('approve', { id: jjMsg.id, payloadHash: jjMsg.payloadHash })).status, 409)
  assert.equal((await messages('jjMsgSend', { batchId: batch.batch.id })).status, 400, 'Send must be confirmed')
  assert.equal((await emails()).length, before)
})

await test('Messages: Send emails each family once, from the Juniors inbox, recorded with who sent it; Do Not Contact is left out', async () => {
  const fams = batch.families.map((f) => f.email)
  const dnc = fams.at(-1)
  await fetch(`${B}/__dnc?email=${encodeURIComponent(dnc)}`)
  const before = (await emails()).length
  let sent = [], skipped = [], left = 1
  for (let i = 0; i < 5 && left; i += 1) { const r = await messages('jjMsgSend', { batchId: batch.batch.id, confirm: true }); assert.equal(r.status, 200, JSON.stringify(r.data)); sent.push(...r.data.sent); skipped.push(...r.data.skipped); left = r.data.left }
  assert.deepEqual(sent.sort(), fams.filter((e) => e !== dnc).sort())
  assert.deepEqual(skipped, [{ email: dnc, why: 'Do Not Contact' }])
  const out = (await emails()).slice(before)
  assert.equal(out.length, sent.length)
  assert.ok(out.every((e) => e.subject === 'No class <this> Saturday' && e.replyTo === 'jonersjuniors@jonerfootball.com' && e.to.length === 1))
  const log = hashOf(await kv(['HGETALL', 'jj:messages']))
  for (const e of sent) { const x = typeof log[`${batch.batch.id}:${e}`] === 'string' ? JSON.parse(log[`${batch.batch.id}:${e}`]) : log[`${batch.batch.id}:${e}`]; assert.equal(x.by, 'leejones@jonerfootball.com'); assert.equal(x.audience, 'class') }
  const again = await messages('jjMsgSend', { batchId: batch.batch.id, confirm: true })
  assert.deepEqual([again.data.sent.length, again.data.left], [0, 0], 'never twice')
  const b = (await messages('jjMsgOverview')).data.batches.find((x) => x.id === batch.batch.id)
  assert.deepEqual([b.sent, b.cancelled, b.draft], [sent.length, 1, 0])
})

await test('Messages: who still owes and one family; a message not sent can be cancelled and then nothing goes', async () => {
  const o = (await messages('jjMsgOverview')).data
  const r = await messages('jjMsgPrepare', { audience: 'unpaid', subject: 'A reminder', text: 'Please pay the term fee when you can.', signIn: false })
  if (!o.counts.unpaid) assert.equal(r.status, 409, 'nobody owes: nothing to prepare')
  else {
    assert.equal(r.status, 200, JSON.stringify(r.data))
    assert.equal(r.data.families.length, o.counts.unpaid)
    assert.ok(!r.data.previews[0].html.includes('Open your account'))
    assert.equal((await messages('jjMsgCancel', { batchId: r.data.batch.id })).data.cancelled, r.data.families.length)
    const before = (await emails()).length
    assert.equal((await messages('jjMsgSend', { batchId: r.data.batch.id, confirm: true })).data.sent.length, 0)
    assert.equal((await emails()).length, before)
  }
  const one = o.families.find((f) => !f.dnc)
  const x = await messages('jjMsgPrepare', { audience: 'one', email: one.email, subject: 'Hello', text: 'Just checking in about Saturday.' })
  assert.deepEqual(x.data.families.map((f) => f.email), [one.email])
  assert.equal((await messages('jjMsgPrepare', { audience: 'one', email: 'nobody@example.com', subject: 'Hello', text: 'Just checking in.' })).status, 409)
  assert.equal((await messages('jjMsgPrepare', { audience: 'class', classId: A.id, subject: 'Hi', text: 'Short' })).status, 400)
  await messages('jjMsgCancel', { batchId: x.data.batch.id })
})

await test('JFP is untouched, and the settings go back for anything that runs next', async () => {
  const k = (await portal('money', { fresh: true })).data.money.kpis
  for (const f of ['incomeCents', 'stripeCents', 'offlineCents', 'owingCents', 'players']) assert.equal(k[f], jfpBefore[f], f)
  assert.equal((await portal('jjSaveClasses', { classes: [A0] })).status, 200)
  assert.equal((await portal('jjSaveSettings', { juniors: { termStart: restore.termStart } })).status, 200)
  const now = (await portal('jjSettings')).data.juniors
  assert.deepEqual([now.termStart, now.classes.length, now.classes[0].shadowCoachId], [restore.termStart, 1, A0.shadowCoachId || ''])
})

console.log(`\n${passed} Joners Juniors stage 3 flow checks passed`)
