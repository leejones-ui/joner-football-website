// JFP round 3 (Lee, 14 Oct 2026), end to end against the local harness:
// fake Airtable, fake Stripe, captured email.
//   1. One parent, two children in different groups on different days
//      (Tuesday and Thursday, each with its own coach): one account, one
//      combined invoice, one payment, Fees per child, each paid in full.
//   2. Can't make it on the Thursday: the Thursday coach and Ligia (staff) are
//      emailed, both sends are in the email log, the family is told both
//      heard, and the Coach number is the Thursday coach's.
//   3. Book extra sessions and Book game analysis: Lee and Ligia emailed and
//      logged, the family sees its requests, staff see them under Requests.
//   4. Next term: no deposit card until staff open it; open, the card's data
//      (day and time, held until), the deposit paid, then "held".
//   npm run build && HOLIDAY_LOCAL_PORT=4755 node scripts/holiday-local.mjs   (one terminal)
//   node scripts/test-jfp-round3-flow.mjs 4755                               (another)
// Every name, email, phone and amount here is invented.
import assert from 'node:assert/strict'

const PORT = Number(process.argv[2] || 4321)
const B = `http://localhost:${PORT}`
let passed = 0
async function test(name, fn) { await fn(); passed += 1; console.log(`ok - ${name}`) }

let ipSeq = 120
function client() {
  const jar = new Map()
  const ip = `10.9.3.${ipSeq++}`
  const call = async (path, body) => {
    const res = await fetch(`${B}${path}`, { method: body ? 'POST' : 'GET', redirect: 'manual', headers: { 'content-type': 'application/json', origin: B, 'x-forwarded-for': ip, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') }, body: body ? JSON.stringify(body) : undefined })
    for (const c of res.headers.getSetCookie?.() || []) { const [kv] = c.split(';'); const i = kv.indexOf('='); if (kv.slice(i + 1)) jar.set(kv.slice(0, i), kv.slice(i + 1)); else jar.delete(kv.slice(0, i)) }
    return { status: res.status, data: await res.json().catch(() => ({})) }
  }
  return { call }
}
const emails = async () => (await fetch(`${B}/__emails`)).json()
const at = async () => (await fetch(`${B}/__airtable`)).json()
const kv = async (cmd) => (await fetch(`${B}/__kv?cmd=${encodeURIComponent(JSON.stringify(cmd))}`)).text()
const emailLog = async () => JSON.parse(await kv(['LRANGE', 'jfp:email-log', '0', '400'])).map((x) => JSON.parse(x))
async function signIn(c, email, audience = 'parent') {
  const s = await c.call('/api/jfp-auth', { action: 'start', email, audience })
  assert.equal(s.status, 200, JSON.stringify(s.data))
  const code = (await emails()).filter((e) => e.to.includes(email) && /sign-in code/.test(e.subject)).at(-1).subject.match(/(\d{6})/)[1]
  assert.equal((await c.call('/api/jfp-auth', { action: 'verify', challenge: s.data.challenge, code })).status, 200)
}
async function payAtStripe(c, url) {
  const back = await fetch(`${url}&action=pay`, { redirect: 'manual' })
  const sid = new URL(back.headers.get('location')).searchParams.get('session_id')
  const conf = await c.call(`/api/jfp-confirm?session_id=${sid}`)
  assert.equal(conf.data.status, 'paid', JSON.stringify(conf.data))
  return conf.data
}
const row = async (id) => (await at()).term4.find((r) => r.id === id)?.fields
const GUARDIAN = { accepted: { terms: true, makeups: true, payment: true, emergency: true }, media: false, kind: 'guardian' }
const ymd = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms))
const weekday = (ms) => new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', weekday: 'long' }).format(new Date(ms))

// ---------- setup: the term started last week, two groups on two days ----------
const lee = client()
await signIn(lee, 'leejones@jonerfootball.com', 'staff')
const portal = async (action, body = {}) => lee.call('/api/jfp-portal-data', { action, ...body })
const ok = async (action, body = {}) => { const r = await portal(action, body); assert.equal(r.status, 200, `${action}: ${JSON.stringify(r.data)}`); return r.data }
let mon = Date.now() - 7 * 86400000
while (weekday(mon) !== 'Monday') mon -= 86400000
const settings = (await ok('getSettings')).config
const THU_PHONE = '0400 000 222'
await ok('saveSettings', { config: { termStart: ymd(mon), weeks: 10, coaches: settings.coaches.map((c) => ({ ...c, phone: c.id === 'dean' ? THU_PHONE : c.phone || '' })) } })
const coachEmail = (id) => settings.coaches.find((c) => c.id === id).email
// Ligia and anyone else on the staff email, as set in Settings (no address written here).
const STAFF = settings.staffEmails
const G1 = (await ok('saveGroup', { group: { day: 'Tuesday', time: '6:10pm', location: 'Belrose HQ', coachId: 'sam', capacity: 12, mode: 'direct', minAge: 5, maxAge: 18 } })).group
const G2 = (await ok('saveGroup', { group: { day: 'Thursday', time: '6:10pm', location: 'Belrose HQ', coachId: 'dean', capacity: 12, mode: 'direct', minAge: 5, maxAge: 18 } })).group
const PARENT = { name: 'Quinn Twoday', email: 'quinn.twoday@example.com', mobile: '0400 777 000' }
const KIDS = ['Ivy Twoday', 'Jay Twoday']

let fam = null
const parent = client()
await test('one parent, two children on different days: one account, one invoice for both, Fees per child, both paid in full', async () => {
  fam = await ok('addFamily', { parent: PARENT, sendEmail: true, children: [
    { groupId: G1.id, player: { name: KIDS[0], dob: '2014-02-02' }, payment: 'link', product: 'group' },
    { groupId: G2.id, player: { name: KIDS[1], dob: '2016-04-04' }, payment: 'link', product: 'sibling' },
  ] })
  const [ivy, jay] = await Promise.all(fam.rows.map((x) => row(x.rowId)))
  assert.deepEqual([ivy['Term 3 Day'], jay['Term 3 Day']], ['Tuesday', 'Thursday'], 'each child in their own group, on their own day')
  await signIn(parent, PARENT.email)
  let d = (await parent.call('/api/jfp-account', { action: 'overview' })).data
  assert.deepEqual(d.players.map((p) => p.name).sort(), KIDS)
  const days = Object.fromEntries(d.players.map((p) => [p.name, p.enrolments.map((e) => `${e.day} ${e.time}`)]))
  assert.deepEqual(days, { [KIDS[0]]: ['Tuesday 6:10pm'], [KIDS[1]]: ['Thursday 6:10pm'] })
  assert.ok(d.players.every((p) => p.enrolments[0].sessions.length > 0), 'each child has their own dates to come')
  assert.ok(d.players.find((p) => p.name === KIDS[0]).enrolments[0].sessions.every((s) => weekday(s.startMs) === 'Tuesday'))
  assert.ok(d.players.find((p) => p.name === KIDS[1]).enrolments[0].sessions.every((s) => weekday(s.startMs) === 'Thursday'))
  assert.equal(d.todo.length, 1, 'one invoice for the family')
  assert.deepEqual(d.todo[0].places.map((x) => x.name), KIDS)
  assert.equal(d.owed.length, 0, 'no second way to pay the same places')
  const w = await parent.call('/api/jfp-account', { action: 'signWaiver', players: d.players.map((p, i) => ({ key: p.key, dob: ['2014-02-02', '2016-04-04'][i], emergencyName: 'Nan Twoday', emergencyPhone: '0400 777 001' })), waiver: { ...GUARDIAN, signature: PARENT.name }, parentName: PARENT.name, mobile: PARENT.mobile })
  assert.equal(w.status, 200, JSON.stringify(w.data)); assert.equal(w.data.created, 2)
  assert.equal((await parent.call('/api/jfp-account', { action: 'confirmKit', payreqId: d.todo[0].id, kit: 'has' })).status, 200)
  const p = await parent.call('/api/jfp-account', { action: 'pay', payreqId: d.todo[0].id })
  assert.equal(p.status, 200, JSON.stringify(p.data))
  await payAtStripe(parent, p.data.url)
  const after = await Promise.all(fam.rows.map((x) => row(x.rowId)))
  assert.deepEqual(after.map((r) => r['Term 4 Payment Status']), ['Paid', 'Paid'])
  const f = (await parent.call('/api/jfp-account', { action: 'fees' })).data.fees
  const places = Object.fromEntries(f.places.map((x) => [x.player, x]))
  assert.match(places[KIDS[0]].group, /^Tuesday 6:10pm/); assert.match(places[KIDS[1]].group, /^Thursday 6:10pm/)
  assert.ok(f.places.every((x) => x.kind === 'term' && x.owingCents === 0 && x.paidCents === x.feeCents && x.feeCents > 0), 'each child paid in full, own amount')
  assert.notEqual(places[KIDS[0]].feeCents, places[KIDS[1]].feeCents, 'the sibling rate on the second child')
  assert.equal(f.records.length, 1, 'one payment'); assert.deepEqual(f.records[0].players, KIDS)
  d = (await parent.call('/api/jfp-account', { action: 'overview' })).data
  assert.equal(d.todo.length + d.owed.length, 0, 'nothing left to pay')
})

await test("Can't make it on Thursday: the Thursday coach and Ligia are emailed and logged; the family hears both were told", async () => {
  const d = (await parent.call('/api/jfp-account', { action: 'overview' })).data
  const jay = d.players.find((p) => p.name === KIDS[1])
  const e = jay.enrolments[0]
  assert.deepEqual(e.contacts, [{ name: 'Coach', phone: THU_PHONE, tel: THU_PHONE.replace(/\s/g, '') }], "the Coach number is the Thursday coach's, never a name")
  const before = (await emails()).length
  const s = e.sessions.at(-1)
  const r = await parent.call('/api/jfp-account', { action: 'cancelSession', rowId: e.rowId, date: s.iso, reason: 'school', note: '' })
  assert.equal(r.status, 200, JSON.stringify(r.data))
  assert.deepEqual(r.data.toldWho, { coach: true, staff: true })
  const sent = (await emails()).slice(before).filter((m) => m.subject.includes(`Can't make it: ${KIDS[1]}`))
  const to = sent.flatMap((m) => m.to)
  assert.ok(to.includes(coachEmail('dean')), 'the coach taking Thursday')
  assert.ok(!to.includes(coachEmail('sam')), "not the Tuesday coach")
  assert.ok(STAFF.length && STAFF.every((x) => to.includes(x)), 'Ligia (the staff emails)')
  const log = (await emailLog()).filter((x) => x.subject.includes(`Can't make it: ${KIDS[1]}`))
  assert.deepEqual(log.map((x) => x.kind).sort(), ['cancel to coach', 'cancel to staff'])
  assert.ok(log.every((x) => x.status === 'sent'))
})

await test('Book extra sessions and Book game analysis: Lee and Ligia emailed and logged, the family sees them, staff see them under Requests', async () => {
  const bad = await parent.call('/api/jfp-account', { action: 'requestExtra', kind: 'analysis', player: KIDS[0] })
  assert.equal(bad.status, 400); assert.match(bad.data.error, /link to the match video/)
  const x = await parent.call('/api/jfp-account', { action: 'requestExtra', kind: 'extra', player: KIDS[0], type: '1 on 1', days: ['Monday', 'Friday'], times: ['School hours (about 7:30am to 2pm)'], notes: 'Weak foot', coach: '' })
  assert.equal(x.status, 200, JSON.stringify(x.data)); assert.equal(x.data.emailed, true)
  const a = await parent.call('/api/jfp-account', { action: 'requestExtra', kind: 'analysis', player: KIDS[1], matchDate: ymd(Date.now() - 3 * 86400000), video: 'https://video.example.com/match/42', notes: 'Number 9' })
  assert.equal(a.status, 200, JSON.stringify(a.data))
  const mails = (await emails()).filter((m) => /^(Extra session|Game analysis) request: /.test(m.subject))
  assert.deepEqual(mails.map((m) => m.subject), [`Extra session request: ${KIDS[0]}`, `Game analysis request: ${KIDS[1]}`])
  assert.ok(mails.every((m) => STAFF.every((x) => m.to.includes(x)) && m.replyTo === PARENT.email), 'to Lee and Ligia (staff), replies to the family')
  assert.match(mails[1].html, /video\.example\.com\/match\/42/)
  const log = (await emailLog()).filter((l) => /request: /.test(l.subject)).map((l) => l.kind).sort()
  assert.deepEqual(log, ['extra session request', 'game analysis request'])
  const d = (await parent.call('/api/jfp-account', { action: 'overview' })).data
  assert.deepEqual(d.extras.mine.map((m) => [m.kind, m.player, m.status]).sort(), [['analysis', KIDS[1], 'new'], ['extra', KIDS[0], 'new']])
  assert.equal(d.extras.analysisPriceLabel, '', 'no price set: "Ask us"')
  const list = (await ok('extraRequests')).requests
  const mine = list.filter((r) => r.email === PARENT.email)
  assert.equal(mine.length, 2)
  assert.deepEqual(mine.find((r) => r.kind === 'extra').days, ['Monday', 'Friday'])
  const done = await ok('extraRequestStatus', { id: mine[0].id, status: 'done' })
  assert.equal(done.request.status, 'done')
  assert.equal((await parent.call('/api/jfp-account', { action: 'requestExtra', kind: 'extra', player: 'Somebody Else', days: ['Monday'] })).status, 200, 'a player not added yet can be named')
})

await test('next term deposit: off, no card; on (with a held-until date), each child with their day and time, deposit paid, then held', async () => {
  let d = (await parent.call('/api/jfp-account', { action: 'overview' })).data
  assert.equal(d.keep.open, false, 'off: Lee has not turned it on'); assert.equal(d.nextTerm, null)
  const until = ymd(Date.now() + 30 * 86400000)
  const saved = await ok('saveNextTerm', { nextTerm: { name: 'Term 1 2027', holdCents: 10000, open: true, holdUntil: until } })
  assert.equal(saved.nextTerm.holdUntil, until)
  d = (await parent.call('/api/jfp-account', { action: 'overview' })).data
  assert.equal(d.keep.open, true); assert.equal(d.keep.holdUntil, until); assert.ok(d.keep.holdUntilLabel)
  assert.deepEqual(d.nextTerm.players.map((x) => [x.player, x.dayTime, x.holdLabel]).sort(), [[KIDS[0], 'Tuesday 6:10pm', 'A$100'], [KIDS[1], 'Thursday 6:10pm', 'A$100']])
  const ivy = d.nextTerm.players.find((x) => x.player === KIDS[0])
  const c = await parent.call('/api/jfp-account', { action: 'nextTermChoice', rowId: ivy.rowId, choice: 'hold' })
  assert.equal(c.status, 200, JSON.stringify(c.data))
  const p = await parent.call('/api/jfp-account', { action: 'pay', payreqId: c.data.payreqId })
  assert.equal(p.status, 200, JSON.stringify(p.data))
  await payAtStripe(parent, p.data.url)
  d = (await parent.call('/api/jfp-account', { action: 'overview' })).data
  assert.equal(d.nextTerm.players.find((x) => x.player === KIDS[0]).status, 'held')
  assert.equal(d.nextTerm.players.find((x) => x.player === KIDS[1]).status, 'invited')
  // Turn it back off (the harness only; production stays off until Lee says).
  await ok('saveNextTerm', { nextTerm: { name: 'Term 1 2027', holdCents: 10000, open: false } })
})

console.log(`\n${passed} round 3 flow checks passed`)
