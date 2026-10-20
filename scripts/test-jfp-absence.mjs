// Missing players (Lee, 20 Oct 2026): "A player who misses 2 weeks in a row
// gets flagged to Ligia." Pure checks of the rules, then end to end on the
// harness: Lee sees the list, marks one followed up, a coach is refused, and
// the Monday email to Ligia sends nothing while it is switched off.
//   npx astro build && node scripts/holiday-local.mjs 4813 (another terminal), then
//   node scripts/test-jfp-absence.mjs 4813
// Every name here is invented.
import assert from 'node:assert/strict'
import { normaliseConfig } from '../api/_jfp-store.js'
import { findAbsences, streakFor, markKind, digestWords, missedLine, toldLine } from '../api/_jfp-absence.js'

let passed = 0
async function test(name, fn) { await fn(); passed += 1; console.log(`ok - ${name}`) }

// ---------- pure ----------

const config = normaliseConfig({})
const G1 = { id: 'tue-1620-belrose-hq', day: 'Tuesday', time: '4:20pm', location: 'Belrose HQ', coachId: 'sam', label: 'Small group' }
const G2 = { id: 'tue-1725-belrose-hq', day: 'Tuesday', time: '5:25pm', location: 'Belrose HQ', coachId: 'dean', label: 'Small group' }
const JJ = { id: 'sat-0900-belrose-hq', day: 'Saturday', time: '9am', location: 'Belrose HQ', coachId: 'ruby', label: 'Joners Juniors' }
const groups = [G1, G2, JJ]
const T1 = '2026-10-13', T2 = '2026-10-20', T3 = '2026-10-27'
const row = (id, player, groupId, extra = {}) => ({ id, player, groupId, holdsPlace: true, paymentType: 'JFP 10 weeks', notes: '', day: 'Tuesday', ...extra })
const players = [
  row('rA', 'Ari Away', G1.id),
  row('rB', 'Bo Back', G1.id),
  row('rC', 'Cy Unmarked', G1.id),
  row('rF', 'Fen Told', G1.id),
  row('rM', 'Mo Mixed', G1.id),
  row('rG', 'Gus Late Start', G1.id, { notes: '[STARTS:2026-10-20]' }),
  row('rT', 'Tia Trial', G1.id, { paymentType: 'JFP Trial' }),
  row('rX', 'Test Kid', G1.id),
  row('rN', 'Ned No Place', G1.id, { holdsPlace: false }),
  row('rJ', 'Jo Juniors', JJ.id, { day: 'Saturday' }),
  row('rE', 'Eve Cancelled', G2.id),
]
const reg = (gid, date, marks) => [`${gid}|${date}`, marks]
const registers = new Map([
  reg(G1.id, T1, { rA: 'Absent', rB: 'Absent', rC: 'Absent', rF: 'Notified', rM: 'Notified', rG: 'Absent', rT: 'Absent', rX: 'Absent', rN: 'Absent' }),
  reg(G1.id, T2, { rA: 'Absent', rB: 'Present', rF: 'Notified', rM: 'Absent', rG: 'Absent', rT: 'Absent', rX: 'Absent', rN: 'Absent' }),
  reg(G1.id, T3, { rC: 'Absent' }),
  reg(JJ.id, '2026-10-17', { rJ: 'Absent' }), reg(JJ.id, '2026-10-24', { rJ: 'Absent' }),
  // G2 on 20 Oct was cancelled: a mark left on it must not count.
  reg(G2.id, T1, { rE: 'Present' }), reg(G2.id, T2, { rE: 'Absent' }), reg(G2.id, T3, { rE: 'Absent' }),
])
const off = new Set([`${G2.id}|${T2}`])
const list = findAbsences({ config, groups, players, registers, off, today: T3 })
const by = (id) => list.find((a) => a.rowId === id)

await test('2 absences in a row are flagged, with group, coach and dates', async () => {
  const a = by('rA')
  assert.ok(a, JSON.stringify(list.map((x) => x.rowId)))
  assert.equal(a.inRow, 2)
  assert.deepEqual(a.missed.map((m) => m.date), [T1, T2])
  assert.equal(a.group, 'Tuesday 4:20pm, Belrose HQ')
  assert.equal(a.coach, 'Sam York')
  assert.equal(a.told, 'none')
  assert.equal(toldLine(a), "Didn't tell us")
  assert.equal(missedLine(a), '2 in a row: 13 Oct, 20 Oct')
  assert.equal(a.key, `rA|${T2}`)
  assert.equal(a.lastCame, '')
})
await test('absent then present is not flagged', async () => { assert.equal(by('rB'), undefined) })
await test('an unmarked session is skipped, not counted either way', async () => {
  const c = by('rC')
  assert.ok(c)
  assert.deepEqual(c.missed.map((m) => m.date), [T1, T3])
  assert.equal(c.latest, T3)
})
await test('a session we cancelled is skipped, even with a mark left on it', async () => { assert.equal(by('rE'), undefined) })
await test('told us (Notified) counts, and is labelled told us', async () => {
  const f = by('rF')
  assert.ok(f)
  assert.equal(f.told, 'all')
  assert.equal(toldLine(f), 'Told us')
  const m = by('rM')
  assert.equal(m.told, 'some')
  assert.equal(toldLine(m), 'Told us 1 of 2')
})
await test('a mid term start only counts their own dates', async () => { assert.equal(by('rG'), undefined) })
await test('trials, Joners Juniors, test players and players without a place are left out', async () => {
  for (const id of ['rT', 'rJ', 'rX', 'rN']) assert.equal(by(id), undefined, id)
})
await test('3 in a row, last came, and Trial and Make-up marks count as came', async () => {
  const s = streakFor([T1, T2, T3, '2026-11-03'], { [T1]: 'Make-up', [T2]: 'Absent', [T3]: 'Notified', '2026-11-03': 'Absent' })
  assert.equal(s.inRow, 3)
  assert.equal(s.lastCame, T1)
  assert.equal(markKind('Trial'), 'came')
  assert.equal(markKind(''), '')
})
await test('marks taken in a sibling group (same day, time and place) count', async () => {
  const G1b = { ...G1, id: `${G1.id}-luke`, coachId: 'luke' }
  const regs = new Map([reg(G1b.id, T1, { rZ: 'Absent' }), reg(G1.id, T2, { rZ: 'Absent' })])
  const l = findAbsences({ config, groups: [G1, G1b], players: [row('rZ', 'Zed Moved', G1.id)], registers: regs, today: T3 })
  assert.equal(l.length, 1)
})
await test('the digest words: plain, no em dashes, a link to the page', async () => {
  const w = digestWords([by('rA'), by('rF')], 1)
  assert.equal(w.subject, 'Missing players: 2 to follow up')
  const all = [w.subject, w.heading, ...w.paras, ...w.list.flat()].join('\n')
  assert.ok(!/—|–/.test(all), 'no dashes')
  assert.match(all, /Ari Away/)
  assert.match(all, /Missed 2 in a row: 13 Oct, 20 Oct/)
  assert.match(all, /1 more from earlier weeks is still to follow up/)
  assert.equal(w.cta.url, 'https://jonerfootball.com/jfp-portal/#absence')
})

// ---------- end to end on the harness ----------

const B = `http://localhost:${process.argv[2] || 4321}`
let ipSeq = 10
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
  const code = (await emails()).filter((e) => e.to.includes(email) && /sign-in code/.test(e.subject)).at(-1).subject.match(/(\d{6})/)[1]
  return c.call('/api/jfp-auth', { action: 'verify', challenge: s.data.challenge, code })
}
const portal = (c, action, body = {}) => c.call('/api/jfp-portal-data', { action, ...body })
const ok = async (c, action, body) => { const r = await portal(c, action, body); assert.equal(r.status, 200, `${action}: ${JSON.stringify(r.data)}`); return r.data }
const tick = async (nowMs) => (await fetch(`${B}/api/jfp-groups?pushTick=1&now=${nowMs}`, { headers: { authorization: 'Bearer local-cron-secret' } })).json()
const digestMails = async () => (await emails()).filter((e) => /^Missing players/.test(e.subject))

const lee = client(), sam = client()
await signIn(lee, 'leejones@jonerfootball.com', 'staff')
await signIn(sam, 'jonerfootballsam@gmail.com', 'staff')

// A Monday group of our own (Mondays 12 and 19 Oct have happened), three invented players.
const MON = (await ok(lee, 'saveGroup', { group: { day: 'Monday', time: '3:05pm', location: 'Belrose HQ', coachId: 'dean', capacity: 8, mode: 'direct' } })).group.id
const base = { 'Term 3 Day': 'Monday', 'Term 3 Time': '3:05pm', 'Term 3 Location': 'Belrose HQ', 'Coach': 'Dean Mac', 'Term 4 Confirmation': 'Confirmed', 'Term 4 Payment Type': 'JFP 10 weeks', 'Term 4 Fee': 850, 'Term 4 Amount Paid': 850, 'Term 4 Payment Status': 'Paid' }
const add = await (await fetch(`${B}/__airtable-add`, { method: 'POST', body: JSON.stringify({ table: 'term4', rows: [
  { ...base, 'Player Name': 'Abe Absent', 'Email': 'abe.fam@example.com' },
  { ...base, 'Player Name': 'Pia Present', 'Email': 'pia.fam@example.com' },
  { ...base, 'Player Name': 'Nia Notified', 'Email': 'nia.fam@example.com' },
] }) })).json()
const [ABE, PIA, NIA] = add.ids
const M1 = '2026-10-12', M2 = '2026-10-19'
for (const [rowId, date, status] of [[ABE, M1, 'Absent'], [ABE, M2, 'Absent'], [PIA, M1, 'Absent'], [PIA, M2, 'Present'], [NIA, M2, 'Absent']]) await ok(lee, 'markAttendance', { groupId: MON, date, rowId, status })
// "Can't make it" in My account marks Notified on the register (_jfp-away.js).
await fetch(`${B}/__kv?cmd=${encodeURIComponent(JSON.stringify(['HSET', `jfp:att:${MON}:${M1}`, NIA, 'Notified']))}`)

await test('Lee sees who is missing: 2 in a row flagged, told us or not, a coach and the dates', async () => {
  const d = await ok(lee, 'absenceList')
  const abe = d.players.find((p) => p.rowId === ABE), nia = d.players.find((p) => p.rowId === NIA)
  assert.ok(abe && nia, JSON.stringify(d.players.map((p) => p.name)))
  assert.ok(!d.players.some((p) => p.rowId === PIA), 'came back on the 19th')
  assert.deepEqual(abe.missed.map((m) => m.label), ['12 Oct', '19 Oct'])
  assert.equal(abe.told, 'none')
  assert.equal(nia.told, 'some')
  assert.equal(abe.coach, 'Dean McDonnell')
  assert.equal(d.digest, false, 'the Monday email starts off')
  assert.match(d.digestWords.subject, /^Missing players: \d+ to follow up$/)
  assert.ok((await ok(lee, 'absenceAlerts')).count >= 2)
})

await test('Followed up takes them off To follow up and onto Followed up, for Ligia too', async () => {
  const before = (await ok(lee, 'absenceAlerts')).count
  const r = await ok(lee, 'absenceFollowUp', { rowId: ABE, date: M2, note: 'Spoke to the family, away this week' })
  assert.equal(r.followedUp.by, 'leejones@jonerfootball.com')
  assert.equal(r.followedUp.note, 'Spoke to the family, away this week')
  assert.ok(!(await ok(lee, 'absenceList')).players.some((p) => p.rowId === ABE))
  const done = (await ok(lee, 'absenceList', { show: 'done' })).players.find((p) => p.rowId === ABE)
  assert.ok(done?.followedUp?.at)
  assert.equal((await ok(lee, 'absenceAlerts')).count, before - 1)
  const ligia = client(); await signIn(ligia, 'ligia@jonerfootball.com', 'staff')
  assert.equal((await ok(ligia, 'absenceAlerts')).count, before - 1)
  assert.equal((await portal(lee, 'absenceFollowUp', { rowId: PIA, date: M2 })).status, 404, 'only players on the list')
})

await test('a coach gets 403 on the list, the count, follow up and the switch', async () => {
  for (const [action, body] of [['absenceList', {}], ['absenceAlerts', {}], ['absenceFollowUp', { rowId: NIA, date: M2 }], ['absenceDigest', { on: true }]]) {
    assert.equal((await portal(sam, action, body)).status, 403, action)
  }
})

// Monday 26 Oct 2026, 8am Sydney (AEDT), and the Tuesday after.
const MONDAY_8AM = Date.parse('2026-10-25T21:00:00Z'), TUESDAY = Date.parse('2026-10-26T21:00:00Z')
await test('switched off, the Monday tick sends nothing', async () => {
  const before = (await digestMails()).length
  const r = await tick(MONDAY_8AM)
  assert.equal(r.success, true, JSON.stringify(r))
  assert.equal(r.absence?.off, true, JSON.stringify(r.absence))
  assert.equal((await digestMails()).length, before)
})

await test('switched on: Monday morning, one email to Ligia (not Lee, no family, no coach), once', async () => {
  assert.equal((await ok(lee, 'absenceDigest', { on: true })).digest, true)
  assert.equal((await ok(lee, 'absenceList')).digest, true)
  assert.equal((await tick(TUESDAY)).absence?.notNow, true, 'not on a Tuesday')
  const before = (await digestMails()).length
  const r = await tick(MONDAY_8AM)
  assert.equal(r.absence?.sent, true, JSON.stringify(r.absence))
  const mails = (await digestMails()).slice(before)
  assert.equal(mails.length, 1)
  assert.deepEqual(mails[0].to, ['ligia@jonerfootball.com'])
  assert.match(mails[0].html, /Nia Notified/)
  assert.doesNotMatch(mails[0].html, /Abe Absent/, 'followed up already')
  assert.equal((await tick(MONDAY_8AM)).absence?.already, true)
  assert.equal((await digestMails()).length, before + 1)
  assert.equal((await ok(lee, 'absenceDigest', { on: false })).digest, false)
})

console.log(`\n${passed} missing players checks passed`)
