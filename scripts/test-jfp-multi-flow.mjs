// Several sessions in one go (Lee, 14 Oct 2026), end to end on the local
// harness (scripts/holiday-local.mjs): a family picks several groups for the
// same players, sends one batch, each group keeps its own rules, one email to
// the family and one to staff, staff see the requests grouped, a waiver signed
// once is written once, and a Book now pick is then paid on its own.
//   npm run build && HOLIDAY_LOCAL_PORT=4775 node scripts/holiday-local.mjs
//   node scripts/test-jfp-multi-flow.mjs 4775
import assert from 'node:assert/strict'

const PORT = Number(process.argv[2] || 4321)
const B = `http://localhost:${PORT}`
let passed = 0
async function test(name, fn) { await fn(); passed += 1; console.log(`ok - ${name}`) }

let ipSeq = 1
function client() {
  const jar = new Map()
  const ip = `10.9.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`
  const header = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
  async function call(path, body, method = body ? 'POST' : 'GET') {
    const res = await fetch(`${B}${path}`, { method, redirect: 'manual', headers: { 'content-type': 'application/json', cookie: header(), 'x-forwarded-for': ip, origin: B }, body: body ? JSON.stringify(body) : undefined })
    for (const c of res.headers.getSetCookie?.() || []) { const [kv] = c.split(';'); const i = kv.indexOf('='); const k = kv.slice(0, i); const v = kv.slice(i + 1); if (v) jar.set(k, v); else jar.delete(k) }
    const text = await res.text()
    let data = {}
    try { data = JSON.parse(text) } catch {}
    return { status: res.status, data }
  }
  return { call, jar }
}
const emails = async () => (await fetch(`${B}/__emails`)).json()
const at = async () => (await fetch(`${B}/__airtable`)).json()
const telegram = async () => (await fetch(`${B}/__telegram`)).json()
const stripe = (url, action) => fetch(`${url}&action=${action}`, { redirect: 'manual' })
async function codeFor(email) {
  const list = (await emails()).filter((e) => e.to.includes(email) && /sign-in code/.test(e.subject))
  assert.ok(list.length, `a code email went to ${email}`)
  return list.at(-1).subject.match(/(\d{6})/)[1]
}
async function signIn(c, email, audience = 'parent') {
  const s = await c.call('/api/jfp-auth', { action: 'start', email, audience })
  assert.equal(s.status, 200, JSON.stringify(s.data))
  const v = await c.call('/api/jfp-auth', { action: 'verify', challenge: s.data.challenge, code: await codeFor(email) })
  assert.equal(v.status, 200, JSON.stringify(v.data))
}
let gateCookie = ''
async function gate(c) {
  if (!gateCookie) { assert.equal((await c.call('/api/jfp-access', { password: 'term4' })).status, 200); gateCookie = c.jar.get('jf_jfp') }
  c.jar.set('jf_jfp', gateCookie)
}
const portal = (c, action, body = {}) => c.call('/api/jfp-portal-data', { action, ...body })
const WAIVER = { accepted: { terms: true, makeups: true, payment: true, emergency: true }, media: false, signature: 'Mia Multi' }
const book = (c, body) => c.call('/api/jfp-book', body)
// The same signed-in family on another connection (the batch is rate limited per connection).
function again(c) { const d = client(); for (const [k, v] of c.jar) d.jar.set(k, v); return d }

// ---------- setup ----------
const lee = client()
await signIn(lee, 'leejones@jonerfootball.com', 'staff')
assert.equal((await portal(lee, 'saveSettings', { config: { passwordRequired: true } })).status, 200)
const mk = async (group) => { const r = await portal(lee, 'saveGroup', { group }); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data.group.id }
const TUE420 = await mk({ day: 'Tuesday', time: '4:20pm', location: 'Belrose HQ', coachId: 'sam', capacity: 6, mode: 'direct', minAge: 7, maxAge: 14 })
const WED420 = await mk({ day: 'Wednesday', time: '4:20pm', location: 'Belrose HQ', coachId: 'sam', capacity: 6, mode: 'direct', minAge: 7, maxAge: 18 }) // full in the seed
const FRI400 = await mk({ day: 'Friday', time: '4pm', location: 'Belrose HQ', coachId: 'dean', capacity: 6, mode: 'application', label: 'Pathway', questions: ['club', 'team', 'playingUp'] })
const SAT9 = await mk({ day: 'Saturday', time: '9am', location: 'Belrose HQ', coachId: 'dean', capacity: 6, mode: 'application', questions: ['club', 'position'] })
const THU420 = await mk({ day: 'Thursday', time: '4:20pm', location: 'Belrose HQ', coachId: 'sam', capacity: 6, mode: 'direct', minAge: 7, maxAge: 14 })
const MON1300 = await mk({ day: 'Monday', time: '1pm', location: 'Belrose HQ', coachId: 'dean', capacity: 1, mode: 'enquire', label: '1 to 1' })

const mum = client()
await gate(mum)
const NEW = [{ name: 'Max Multi', dob: '2015-04-04', emergencyName: 'Mia Multi', emergencyPhone: '0400555666' }]
const base = { action: 'batch', players: NEW, parentName: 'Mia Multi', mobile: '0400555666', answers: { club: 'Forest FC', team: 'U11 Div 1', playingUp: 'Playing up', position: 'Winger', nonsense: 'x' }, waiver: WAIVER, message: 'Keen on any of these' }
let batchId = ''
let firstIds = []

await test('a batch needs a sign-in, and checks every pick before saving anything', async () => {
  assert.equal((await book(mum, { ...base, picks: [{ groupId: FRI400, kind: 'application' }] })).status, 401)
  await signIn(mum, 'multi@example.com')
  const before = (await portal(lee, 'requests')).data.requests.length
  const twice = await book(mum, { ...base, picks: [{ groupId: FRI400, kind: 'application' }, { groupId: FRI400, kind: 'application' }] })
  assert.equal(twice.status, 400)
  const enquiry = await book(mum, { ...base, picks: [{ groupId: FRI400, kind: 'application' }, { groupId: MON1300, kind: 'application' }] })
  assert.equal(enquiry.status, 409, 'an enquire group cannot take an application')
  assert.equal(enquiry.data.groupId, MON1300, 'the page is told which session to fix')
  const gone = await book(mum, { ...base, picks: [{ groupId: FRI400, kind: 'application' }, { groupId: 'nope-group', kind: 'application' }] })
  assert.equal(gone.status, 404)
  const bookApp = await book(mum, { ...base, picks: [{ groupId: FRI400, kind: 'book' }, { groupId: SAT9, kind: 'application' }] })
  assert.equal(bookApp.status, 409, 'only a Book now group can be booked')
  const m2 = again(mum)
  const onlyBook = await book(m2, { ...base, picks: [{ groupId: TUE420, kind: 'book' }] })
  assert.equal(onlyBook.status, 400, 'nothing to apply for')
  const tooMany = await book(m2, { ...base, picks: Array.from({ length: 9 }, (_, i) => ({ groupId: `g${i}`, kind: 'application' })) })
  assert.equal(tooMany.status, 400)
  const noName = await book(m2, { ...base, players: [{ name: 'Max', dob: '2015-04-04' }], picks: [{ groupId: FRI400, kind: 'application' }, { groupId: SAT9, kind: 'application' }] })
  assert.equal(noName.status, 400)
  const badWaiver = await book(m2, { ...base, waiver: { ...WAIVER, accepted: { terms: true } }, picks: [{ groupId: FRI400, kind: 'application' }, { groupId: SAT9, kind: 'application' }] })
  assert.equal(badWaiver.data.code, 'waiver')
  assert.equal((await portal(lee, 'requests')).data.requests.length, before, 'nothing was saved by any of those')
})

await test('one send: applications, a waitlist on a full group, and a Book now pick named for the emails', async () => {
  const mailBefore = (await emails()).length
  const tgBefore = (await telegram()).length
  const r = await book(mum, { ...base, picks: [{ groupId: FRI400, kind: 'application' }, { groupId: SAT9, kind: 'application' }, { groupId: WED420, kind: 'waitlist' }, { groupId: TUE420, kind: 'book' }] })
  assert.equal(r.status, 200, JSON.stringify(r.data))
  assert.match(r.data.batchId, /^BAT-/)
  batchId = r.data.batchId
  assert.deepEqual(r.data.requests.map((x) => [x.groupId, x.kind]), [[FRI400, 'application'], [SAT9, 'application'], [WED420, 'waitlist']])
  assert.deepEqual(r.data.paying, [TUE420])
  firstIds = r.data.requests.map((x) => x.id)
  const list = (await portal(lee, 'requests')).data.requests.filter((x) => x.batchId === batchId)
  assert.equal(list.length, 3)
  for (const x of list) {
    assert.equal(x.batchSize, 4)
    assert.deepEqual(x.batchPaying, [TUE420])
    assert.equal(x.status, 'pending')
    assert.equal(x.players[0].name, 'Max Multi')
    assert.ok(x.players[0].waiver, 'the waiver signed once rides on each request')
    assert.equal(x.message, 'Keen on any of these')
    assert.ok(!('nonsense' in x.answers))
  }
  // Each group keeps only the answers to its own questions.
  assert.deepEqual(list.find((x) => x.groupId === FRI400).answers, { club: 'Forest FC', team: 'U11 Div 1', playingUp: 'Playing up' })
  assert.deepEqual(list.find((x) => x.groupId === SAT9).answers, { club: 'Forest FC', position: 'Winger' })
  const mail = (await emails()).slice(mailBefore)
  const family = mail.filter((e) => e.to.includes('multi@example.com'))
  assert.equal(family.length, 1, 'one email to the family')
  assert.match(family[0].subject, /4 sessions/)
  for (const t of ['Friday 4pm', 'Saturday 9am', 'Wednesday 4:20pm', 'Tuesday 4:20pm', 'Waitlist', 'Book now']) assert.ok(family[0].html.includes(t), `family email lists ${t}`)
  assert.ok(!/\u2014/.test(family[0].html), 'no em dash in the family email')
  const staff = mail.filter((e) => e.to.includes('leejones@jonerfootball.com'))
  assert.equal(staff.length, 1, 'one email to staff')
  assert.match(staff[0].subject, /4 sessions: Max Multi/)
  const tg = (await telegram()).slice(tgBefore)
  assert.equal(tg.length, 1, 'one Telegram message')
  assert.ok(!/0400555666|multi@example/.test(JSON.stringify(tg)), 'no phone or email in chat')
})

await test('the same player cannot ask for the same group twice, and nothing else is saved', async () => {
  const before = (await portal(lee, 'requests')).data.requests.length
  const again = await book(mum, { ...base, picks: [{ groupId: SAT9, kind: 'application' }, { groupId: FRI400, kind: 'application' }] })
  assert.equal(again.status, 409)
  assert.equal(again.data.code, 'duplicate')
  assert.match(again.data.error, /Max Multi already has an application/)
  assert.equal((await portal(lee, 'requests')).data.requests.length, before)
})

await test('the Book now pick is then booked and paid on its own, with every existing check', async () => {
  const hold = await book(mum, { action: 'reserve', groupId: TUE420 })
  assert.equal(hold.status, 200, JSON.stringify(hold.data))
  const pay = { groupId: TUE420, bookingId: hold.data.bookingId, releaseToken: hold.data.releaseToken, players: NEW, waiver: WAIVER, parentName: 'Mia Multi', mobile: '0400555666', agreementAccepted: true, notes: 'Keen on any of these', option: 'group' }
  assert.equal((await book(mum, { ...pay, kit: '' })).data.code, 'kit', 'the kit is still required')
  const ok = await book(mum, { ...pay, kit: 'ordered' })
  assert.equal(ok.status, 200, JSON.stringify(ok.data))
  const paid = await stripe(ok.data.url, 'pay')
  const sid = new URL(paid.headers.get('location')).searchParams.get('session_id')
  assert.equal((await mum.call(`/api/jfp-confirm?session_id=${sid}`)).data.status, 'paid')
  const row = (await at()).term4.find((r) => r.fields['Player Name'] === 'Max Multi' && r.fields['Term 3 Day'] === 'Tuesday')
  assert.equal(row.fields['Term 4 Payment Status'], 'Paid')
  // A second Book now session after that: the player is on the account now,
  // so the page books them by their saved record (knownPlayers in the page).
  const hold2 = await book(mum, { action: 'reserve', groupId: THU420 })
  const pay2 = { ...pay, groupId: THU420, bookingId: hold2.data.bookingId, releaseToken: hold2.data.releaseToken, kit: 'ordered' }
  const asNew = await book(mum, pay2)
  assert.match(asNew.data.error || '', /already on your account/)
  const fam = (await book(mum, { action: 'family', groupId: THU420 })).data
  const max = fam.players.find((x) => x.name === 'Max Multi')
  assert.ok(max && max.waiverOnFile, 'Max and his waiver are on file after the first payment')
  const ok2 = await book(mum, { ...pay2, players: [{ key: max.key }], waiver: undefined })
  assert.equal(ok2.status, 200, JSON.stringify(ok2.data))
})

await test('the family sees every request in My account, and the family call reports places per pick', async () => {
  const fam = await book(mum, { action: 'family', groupIds: [FRI400, TUE420] })
  assert.equal(fam.status, 200)
  assert.ok(Array.isArray(fam.data.players))
  const rita = client()
  await gate(rita)
  await signIn(rita, 'returning@example.com')
  const tue = (await portal(lee, 'groups')).data.groups.find((g) => g.day === 'Tuesday' && g.time === '4:20pm')
  const rf = (await book(rita, { action: 'family', groupIds: [tue.id, FRI400] })).data.players.find((p) => p.name === 'Riley Returning')
  assert.deepEqual(rf.inGroups, [tue.id], 'Riley already has a Tuesday 4:20pm place')
  // Riley already in a picked group: the batch says which one, saves nothing.
  const r = await book(rita, { action: 'batch', picks: [{ groupId: FRI400, kind: 'application' }, { groupId: tue.id, kind: 'waitlist' }], players: [{ key: rf.key }], parentName: 'Rita Returning', mobile: '0400000003' })
  assert.equal(r.status, 400)
  assert.match(r.data.error, /already in this group/)
  assert.equal(r.data.groupId, tue.id)
  const acct = await mum.call('/api/jfp-account', { action: 'overview' })
  assert.equal(acct.status, 200)
})

await test('staff accept two of the batch: the waiver signed once is written to Airtable once', async () => {
  const [fri, sat] = firstIds
  const a1 = await portal(lee, 'decideRequest', { id: fri, decision: 'offer', sendEmail: false })
  assert.equal(a1.status, 200, JSON.stringify(a1.data))
  const a2 = await portal(lee, 'decideRequest', { id: sat, decision: 'trial', sendEmail: false })
  assert.equal(a2.status, 200, JSON.stringify(a2.data))
  const w = (await at()).waiver.filter((r) => r.fields['Player Full Name'] === 'Max Multi')
  assert.equal(w.length, 1, 'one waiver row: the booking paid from the batch wrote it, the accepted requests do not write it again')
  const rows = (await at()).term4.filter((r) => r.fields['Player Name'] === 'Max Multi' && ['Friday', 'Saturday'].includes(r.fields['Term 3 Day']))
  assert.equal(rows.length, 2, 'each accepted session has its own Term 4 row')
  // A batch with no booking: two accepted, the waiver still written once.
  const duo = client()
  await gate(duo)
  await signIn(duo, 'duo@example.com')
  const d = await book(duo, { ...base, players: [{ name: 'Dot Duo', dob: '2014-03-03', emergencyName: 'Dan Duo', emergencyPhone: '0400888999' }], parentName: 'Dan Duo', mobile: '0400888999', waiver: { ...WAIVER, signature: 'Dan Duo' }, picks: [{ groupId: FRI400, kind: 'application' }, { groupId: SAT9, kind: 'application' }] })
  assert.equal(d.status, 200, JSON.stringify(d.data))
  for (const x of d.data.requests) assert.equal((await portal(lee, 'decideRequest', { id: x.id, decision: 'offer', sendEmail: false, force: true })).status, 200)
  const dw = (await at()).waiver.filter((r) => r.fields['Player Full Name'] === 'Dot Duo')
  assert.equal(dw.length, 1, 'one waiver row for two accepted requests from one batch')
  assert.match(JSON.stringify(dw[0].fields), new RegExp(d.data.batchId))
  // A single application (no batch) still writes its own waiver as before.
  const solo = client()
  await gate(solo)
  await signIn(solo, 'solo@example.com')
  const one = await book(solo, { action: 'request', kind: 'application', groupId: FRI400, players: [{ name: 'Sol Solo', dob: '2014-02-02', emergencyName: 'Sue Solo', emergencyPhone: '0400777888' }], parentName: 'Sue Solo', mobile: '0400777888', answers: { club: 'X', team: 'U12' }, waiver: { ...WAIVER, signature: 'Sue Solo' } })
  assert.equal(one.status, 200)
  assert.equal((await portal(lee, 'decideRequest', { id: one.data.id, decision: 'offer', sendEmail: false })).status, 200)
  assert.equal((await at()).waiver.filter((r) => r.fields['Player Full Name'] === 'Sol Solo').length, 1)
})

await test('staff Requests page groups the batch (portal script)', async () => {
  const src = await (await import('node:fs/promises')).readFile(new URL('../src/scripts/jfp-portal.js', import.meta.url), 'utf8')
  assert.match(src, /function batched\(list\)/)
  assert.match(src, /sessions in one go/)
  const page = await import('node:fs/promises').then((fs) => fs.readFile(new URL('../src/pages/jfp-booking.astro', import.meta.url), 'utf8'))
  assert.ok(page.includes('You can apply for more than one session. Pick as many as suit you.'))
})

console.log(`\n${passed} multi-session checks passed`)
