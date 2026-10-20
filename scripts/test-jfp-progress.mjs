// Progress over the terms (Lee, 20 Oct 2026): "A few skill ratings on each
// report, shown as a progress line on the family's page".
// Part 1: the pure functions (api/_jfp-progress.js) and the family card HTML.
// Part 2: end to end on the local harness (in-memory KV, mock email): a family
// sees only their own players' progress, never a draft or a withdrawn report,
// and a coach writing a new report sees the last report's levels only for a
// player in their own groups. Every name here is invented.
//   npx astro build && HOLIDAY_LOCAL_PORT=4812 node scripts/holiday-local.mjs 4812 &
//   node scripts/test-jfp-progress.mjs 4812
import assert from 'node:assert/strict'
import { progressFor, progressByPlayer, lastLevelsFor, termReports } from '../api/_jfp-progress.js'
import { progressHtml } from '../src/scripts/jfp-account-progress.js'

let passed = 0
async function test(name, fn) { await fn(); passed += 1; console.log(`ok - ${name}`) }

// ---------- part 1: pure ----------
const rep = (id, termNo, year, ratings, extra = {}) => ({ id, termNo, year, ratings, status: 'sent', sentAt: `${year}-0${termNo}-15T01:00:00.000Z`, player: 'Zoe Quill', playerKey: 'zoequill', rowId: 'recZ', rowEmails: ['zq@example.com'], ...extra })
const T3 = rep('RPT-3', '3', '2026', { passing: 3, first_touch: 4, attitude: 4, both_feet: 2, dribbling: 3 })
const T4 = rep('RPT-4', '4', '2026', { passing: 4, first_touch: 3, attitude: 4, both_feet: 3, awareness: 2 })

await test('one report: one point, the level words, no arrows yet', async () => {
  const p = progressFor([T3])
  assert.equal(p.count, 1)
  assert.deepEqual(p.points.map((x) => x.label), ['Term 3 2026'])
  assert.equal(p.points[0].overall, 3.2)
  const passing = p.skills.find((s) => s.k === 'passing')
  assert.deepEqual([passing.now, passing.word, passing.prev, passing.change], [3, 'Competent', null, null])
  assert.ok(p.skills.every((s) => s.change === null))
  assert.deepEqual(p.overall, { now: 3.2, prev: null, change: null })
  assert.equal(p.since, '')
  const html = progressHtml([{ player: 'Zoe Quill', ...p }])
  assert.match(html, /Your progress line starts here\. It grows with each term's report\./)
  assert.equal((html.match(/<circle/g) || []).length, 1, 'one dot')
  assert.ok(!html.includes('class="l"'), 'no line with one point')
  assert.ok(!/—|–/.test(html), 'no em or en dashes')
})

await test('two reports (given newest first): ordered by term, ups, downs and the same', async () => {
  const p = progressFor([T4, T3])
  assert.equal(p.count, 2)
  assert.deepEqual(p.points.map((x) => x.id), ['RPT-3', 'RPT-4'])
  const by = Object.fromEntries(p.skills.map((s) => [s.k, s]))
  assert.equal(by.passing.change, 'up')
  assert.deepEqual(by.passing.history, [3, 4])
  assert.equal(by.passing.word, 'Strong')
  assert.equal(by.first_touch.change, 'down')
  assert.equal(by.attitude.change, 'same')
  assert.equal(by.both_feet.change, 'up')
  assert.equal(by.dribbling.now, null, 'not rated this time')
  assert.equal(by.dribbling.change, null)
  assert.equal(by.awareness.change, null, 'no rating last time')
  assert.deepEqual(p.counts, { up: 2, down: 1, same: 1 })
  assert.deepEqual(p.overall, { now: 3.2, prev: 3.2, change: 'same' })
  assert.equal(p.since, 'Term 3 2026')
  const html = progressHtml([{ player: 'Zoe Quill', ...p }])
  assert.ok(!html.includes('Your progress line starts here'))
  assert.equal((html.match(/<circle/g) || []).length, 2)
  assert.ok(html.includes('class="l"'), 'a line')
  assert.match(html, /class="ar up"/)
  assert.match(html, /class="ar down"/)
  assert.match(html, /Up since Term 3 2026/)
  assert.ok(!/—|–/.test(html), 'no em or en dashes')
})

await test('drafts and withdrawn reports never count', async () => {
  const draft = rep('RPT-D', '1', '2027', { passing: 1 }, { status: 'draft' })
  const gone = rep('RPT-W', '4', '2026', { passing: 1 }, { status: 'withdrawn', sentAt: '2026-12-30T00:00:00.000Z' })
  const p = progressFor([T3, draft, gone, T4])
  assert.deepEqual(p.points.map((x) => x.id), ['RPT-3', 'RPT-4'])
  assert.equal(p.skills.find((s) => s.k === 'passing').now, 4)
  assert.equal(progressFor([draft]).count, 0)
  assert.deepEqual(progressByPlayer([draft, gone]), [])
})

await test('terms sort across years; two reports in one term keep the later one', async () => {
  const t1 = rep('RPT-27', '1', '2027', { passing: 5 })
  const again = rep('RPT-4b', '4', '2026', { passing: 2 }, { sentAt: '2026-12-20T00:00:00.000Z' })
  assert.deepEqual(termReports([t1, T4, T3, again]).map((x) => x.id), ['RPT-3', 'RPT-4b', 'RPT-27'])
})

await test('by player: each child separately', async () => {
  const sib = rep('RPT-S', '4', '2026', { passing: 2 }, { player: 'Max Quill', playerKey: 'maxquill', rowId: 'recM' })
  const out = progressByPlayer([T4, sib, T3])
  assert.deepEqual(out.map((x) => [x.player, x.count]), [['Zoe Quill', 2], ['Max Quill', 1]])
})

await test('last levels for the coach: same row, or same name and family email on a new row; never a draft', async () => {
  const draft = rep('RPT-D', '1', '2027', { passing: 1 }, { status: 'draft' })
  assert.equal(lastLevelsFor([T3, T4, draft], { rowId: 'recZ' }).label, 'Term 4 2026')
  const newRow = lastLevelsFor([T3, T4], { rowId: 'recNEW', playerKey: 'zoequill', emails: ['ZQ@example.com'] })
  assert.equal(newRow.label, 'Term 4 2026')
  assert.deepEqual(newRow.ratings, { passing: 4, first_touch: 3, attitude: 4, both_feet: 3, awareness: 2 })
  assert.equal(lastLevelsFor([T3, T4], { rowId: 'recNEW', playerKey: 'zoequill', emails: ['other@example.com'] }), null, 'same name, another family')
  assert.equal(lastLevelsFor([T4], { rowId: 'recZ', excludeId: 'RPT-4' }), null)
  assert.equal(lastLevelsFor([draft], { rowId: 'recZ' }), null)
})

// ---------- part 2: on the harness ----------
const B = `http://localhost:${process.argv[2] || 4812}`
let ipSeq = 20
function client(ip = `10.9.7.${ipSeq++}`) {
  const jar = new Map()
  const call = async (path, body) => {
    const res = await fetch(`${B}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: B, 'x-forwarded-for': ip, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') }, body: JSON.stringify(body) })
    for (const c of res.headers.getSetCookie?.() || []) { const [kv] = c.split(';'); const i = kv.indexOf('='); if (kv.slice(i + 1)) jar.set(kv.slice(0, i), kv.slice(i + 1)); else jar.delete(kv.slice(0, i)) }
    return { status: res.status, data: await res.json().catch(() => ({})) }
  }
  return { call }
}
const emails = async () => (await fetch(`${B}/__emails`)).json()
async function signIn(c, email, audience = 'parent') {
  const s = await c.call('/api/jfp-auth', { action: 'start', email, audience })
  assert.equal(s.status, 200, JSON.stringify(s.data))
  const code = (await emails()).filter((e) => e.to.includes(email) && /sign-in code/.test(e.subject)).at(-1).subject.match(/(\d{6})/)[1]
  const v = await c.call('/api/jfp-auth', { action: 'verify', challenge: s.data.challenge, code })
  assert.equal(v.status, 200, JSON.stringify(v.data))
}
const portal = (c, action, body = {}) => c.call('/api/jfp-portal-data', { action, ...body })
const acct = (c, action, body = {}) => c.call('/api/jfp-account', { action, ...body })
const ok = async (c, action, body) => { const r = await portal(c, action, body); assert.equal(r.status, 200, `${action}: ${JSON.stringify(r.data)}`); return r.data }
const progressOf = async (c) => { const r = await acct(c, 'reports'); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data.progress }

const lee = client(), sam = client(), dean = client()
await signIn(lee, 'leejones@jonerfootball.com', 'staff')
await signIn(sam, 'jonerfootballsam@gmail.com', 'staff')
await signIn(dean, 'jonerfootballdean@gmail.com', 'staff')
const THU = (await ok(lee, 'saveGroup', { group: { day: 'Thursday', time: '4:15pm', location: 'Belrose HQ', coachId: 'sam', capacity: 10, mode: 'direct' } })).group.id
const FRI = (await ok(lee, 'saveGroup', { group: { day: 'Friday', time: '5:30pm', location: 'Belrose HQ', coachId: 'dean', capacity: 10, mode: 'direct' } })).group.id
const parentP = { name: 'Pip Pemberton', email: 'pip.pemberton@example.com', mobile: '0400 555 111' }
const IVY = (await ok(lee, 'addPlayer', { groupId: THU, force: true, player: { name: 'Ivy Pemberton', age: 13 }, parent: parentP, payment: 'full' })).rowId
const OLLIE = (await ok(lee, 'addPlayer', { groupId: FRI, force: true, player: { name: 'Ollie Pemberton', age: 10 }, parent: parentP, payment: 'full' })).rowId
const RUBY = (await ok(lee, 'addPlayer', { groupId: THU, force: true, player: { name: 'Ruby Thornhill', age: 11 }, parent: { name: 'Kit Thornhill', email: 'kit.t@example.com', mobile: '0400 555 222' }, payment: 'full' })).rowId
const famP = client(), famT = client(), ivyLogin = client()
await signIn(famP, parentP.email)
await signIn(famT, 'kit.t@example.com')

const fields = (termNo, ratings, extra = {}) => ({ program: 'JFP Performance', termNo, year: '2026', reportDate: '2026-10-20', location: 'Belrose HQ', coachName: 'Coach Sam', ratings, feedback: 'Good term.', reminder: '', ...extra })
async function sendFor(c, rowId, f) {
  const sv = await ok(c, 'reportSave', { rowId, fields: f })
  const rec = (await ok(c, 'reportRecipients', { id: sv.report.id })).recipients
  const out = await ok(c, 'reportSend', { id: sv.report.id, confirm: true, expect: rec.map(({ role, name }) => ({ role, name })) })
  return out.report.id
}
const IVY_T3 = { passing: 3, first_touch: 4, attitude: 4, both_feet: 2 }
const IVY_T4 = { passing: 4, first_touch: 3, attitude: 4, both_feet: 3 }

await test('no reports yet: no progress card', async () => {
  assert.deepEqual(await progressOf(famP), [])
})

await test('Ivy has her own login (13)', async () => {
  const ivy = (await acct(famP, 'overview')).data.players.find((p) => p.name === 'Ivy Pemberton')
  assert.equal((await acct(famP, 'saveProfile', { playerKey: ivy.key, values: { dob: '2013-02-02' } })).status, 200)
  assert.equal((await acct(famP, 'playerLoginSet', { playerKey: ivy.key, email: 'ivy.own@example.com' })).status, 200)
  await signIn(ivyLogin, 'ivy.own@example.com')
  assert.deepEqual(await progressOf(ivyLogin), [])
})

let T3ID = ''
await test('Ivy\'s first report (Term 3) sent: one point for the Pembertons, none for anyone else', async () => {
  T3ID = await sendFor(sam, IVY, fields('3', IVY_T3))
  const p = await progressOf(famP)
  assert.deepEqual(p.map((x) => [x.player, x.count]), [['Ivy Pemberton', 1]])
  assert.equal(p[0].skills.find((s) => s.k === 'passing').word, 'Competent')
  assert.deepEqual(await progressOf(famT), [], 'another family sees nothing')
})

let DRAFT = ''
await test('a Term 4 draft changes nothing for the family', async () => {
  DRAFT = (await ok(sam, 'reportSave', { rowId: IVY, fields: fields('4', { passing: 1, first_touch: 1, attitude: 1, both_feet: 1 }) })).report.id
  const r = (await acct(famP, 'reports')).data
  assert.equal(r.progress[0].count, 1)
  assert.equal(r.progress[0].skills.find((s) => s.k === 'passing').now, 3)
  assert.ok(!JSON.stringify(r).includes(DRAFT), 'the draft id is nowhere in the family data')
})

await test('the coach writing the new report sees last report\'s levels; another coach gets nothing', async () => {
  const st = await ok(sam, 'reportStart', { rowId: IVY })
  assert.equal(st.resumed, true)
  assert.equal(st.report.id, DRAFT)
  assert.equal(st.last.label, 'Term 3 2026')
  assert.deepEqual(st.last.ratings, IVY_T3)
  const other = await portal(dean, 'reportStart', { rowId: IVY })
  assert.equal(other.status, 404)
  assert.equal(other.data.last, undefined)
  const fresh = await ok(sam, 'reportStart', { rowId: RUBY })
  assert.equal(fresh.last, null, 'no report yet for Ruby')
  const lee1 = await ok(lee, 'reportStart', { rowId: IVY })
  assert.equal(lee1.last.label, 'Term 3 2026', 'Lee sees it for anyone')
})

let T4ID = ''
await test('the Term 4 report sent: the line comes alive with ups, downs and the same', async () => {
  await ok(sam, 'reportSave', { id: DRAFT, fields: fields('4', IVY_T4) })
  const rec = (await ok(sam, 'reportRecipients', { id: DRAFT })).recipients
  T4ID = (await ok(sam, 'reportSend', { id: DRAFT, confirm: true, expect: rec.map(({ role, name }) => ({ role, name })) })).report.id
  const [p] = await progressOf(famP)
  assert.equal(p.count, 2)
  assert.deepEqual(p.points.map((x) => x.label), ['Term 3 2026', 'Term 4 2026'])
  const by = Object.fromEntries(p.skills.map((s) => [s.k, s.change]))
  assert.deepEqual([by.passing, by.first_touch, by.attitude, by.both_feet], ['up', 'down', 'same', 'up'])
  assert.equal(p.since, 'Term 3 2026')
  assert.ok(!/—/.test(progressHtml([p])))
})

await test('a sibling with another coach: the family sees both, Ivy\'s own login sees only Ivy', async () => {
  await sendFor(dean, OLLIE, fields('4', { passing: 2, attitude: 5 }, { coachName: 'Coach Dean' }))
  const fam = await progressOf(famP)
  assert.deepEqual(fam.map((x) => x.player).sort(), ['Ivy Pemberton', 'Ollie Pemberton'])
  const own = await progressOf(ivyLogin)
  assert.deepEqual(own.map((x) => x.player), ['Ivy Pemberton'])
  assert.equal(own[0].count, 2)
})

await test('another family only ever sees their own child', async () => {
  await sendFor(lee, RUBY, fields('4', { passing: 5 }, { coachName: 'Lee Jones' }))
  const t = await progressOf(famT)
  assert.deepEqual(t.map((x) => x.player), ['Ruby Thornhill'])
  assert.ok(!(await progressOf(famP)).some((x) => x.player === 'Ruby Thornhill'))
  const raw = JSON.stringify((await acct(famT, 'reports')).data)
  for (const id of [T3ID, T4ID]) assert.ok(!raw.includes(id), 'no Pemberton report ids')
})

await test('a report Lee takes out of the account leaves the line too, and comes back with it', async () => {
  await ok(lee, 'reportWithdraw', { id: T4ID, on: true })
  assert.equal((await progressOf(famP)).find((x) => x.player === 'Ivy Pemberton').count, 1)
  assert.equal((await ok(sam, 'reportStart', { rowId: IVY })).last.label, 'Term 3 2026', 'the coach is not shown a withdrawn one')
  await ok(lee, 'reportWithdraw', { id: T4ID, on: false })
  assert.equal((await progressOf(famP)).find((x) => x.player === 'Ivy Pemberton').count, 2)
})

console.log(`\n${passed} progress checks passed`)
