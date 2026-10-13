// End to end checks for JFP bookings against the local harness
// (scripts/holiday-local.mjs): fake Airtable, fake Stripe, captured email.
//   npm run build && node scripts/holiday-local.mjs   (in one terminal)
//   node scripts/test-jfp-flow.mjs 4321               (in another)
import assert from 'node:assert/strict'

const PORT = Number(process.argv[2] || 4321)
const B = `http://localhost:${PORT}`
const ORIGIN = { origin: B }
let passed = 0
async function test(name, fn) { await fn(); passed += 1; console.log(`ok - ${name}`) }

// A browser per person: its own cookie jar.
let ipSeq = 1
function client() {
  const jar = new Map()
  const ip = `10.0.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}` // each family on its own connection
  const header = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
  async function call(path, body, method = body ? 'POST' : 'GET') {
    // The JF playing kit is confirmed before every term payment; tests that
    // check that gate pass noKit.
    if (path === '/api/jfp-account' && body?.action === 'pay' && !body.noKit) await call(path, { action: 'confirmKit', payreqId: body.payreqId, kit: 'ordered' })
    const res = await fetch(`${B}${path}`, { method, redirect: 'manual', headers: { 'content-type': 'application/json', cookie: header(), 'x-forwarded-for': ip, ...ORIGIN }, body: body ? JSON.stringify(body) : undefined })
    const set = res.headers.getSetCookie?.() || []
    for (const c of set) { const [kv] = c.split(';'); const i = kv.indexOf('='); const k = kv.slice(0, i); const v = kv.slice(i + 1); if (v) jar.set(k, v); else jar.delete(k) }
    const text = await res.text()
    let data = {}
    try { data = JSON.parse(text) } catch {}
    return { status: res.status, data }
  }
  return { call, jar }
}

const emails = async () => (await fetch(`${B}/__emails`)).json()
const at = async () => (await fetch(`${B}/__airtable`)).json()
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
  return v.data
}
// The password check is rate limited (8 a minute), so do it once and share
// the signed access cookie, as separate browsers of the same family would.
let gateCookie = ''
async function gate(c) {
  if (!gateCookie) { assert.equal((await c.call('/api/jfp-access', { password: 'term4' })).status, 200); gateCookie = c.jar.get('jf_jfp') }
  c.jar.set('jf_jfp', gateCookie)
}
const portal = (c, action, body = {}) => c.call('/api/jfp-portal-data', { action, ...body })
async function groupsPublic(c) { return (await c.call('/api/jfp-groups')).data.groups }
const left = async (c, id) => (await groupsPublic(c)).find((g) => g.id === id)?.placesLeft
const WAIVER = { accepted: { terms: true, makeups: true, payment: true, emergency: true }, media: false, signature: 'Pat Parent' }

// ---------- setup: Lee signs in and sets up the groups ----------
const lee = client()
await signIn(lee, 'leejones@jonerfootball.com', 'staff')
// The password is off by default now (Lee, 5 Oct 2026); the older checks run with it on.
assert.equal((await lee.call('/api/jfp-portal-data', { action: 'saveSettings', config: { passwordRequired: true } })).status, 200)
const mk = async (group) => { const r = await portal(lee, 'saveGroup', { group }); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data.group.id }
const TUE420 = await mk({ day: 'Tuesday', time: '4:20pm', location: 'Belrose HQ', coachId: 'sam', capacity: 6, mode: 'direct', label: 'Small group', minAge: 9, maxAge: 12, ageStatus: 'confirmed' })
const TUE525 = await mk({ day: 'Tuesday', time: '5:25pm', location: 'Belrose HQ', coachId: 'dean', capacity: 6, mode: 'direct', minAge: 7, maxAge: 18 })
const WED420 = await mk({ day: 'Wednesday', time: '4:20pm', location: 'Belrose HQ', coachId: 'sam', capacity: 6, mode: 'direct', minAge: 7, maxAge: 18 })
const FRI400 = await mk({ day: 'Friday', time: '4pm', location: 'Belrose HQ', coachId: 'dean', capacity: 6, mode: 'application', label: 'Pathway', minAge: 6, maxAge: 12 })
const MON1300 = await mk({ day: 'Monday', time: '1pm', location: 'Belrose HQ', coachId: 'dean', capacity: 1, mode: 'enquire', label: '1 to 1' })
await mk({ day: 'Monday', time: '5:25pm', location: 'Belrose HQ', coachId: 'dean', capacity: 6, mode: 'direct', minAge: 12, maxAge: 16 })
await mk({ day: 'Friday', time: '6:30am', location: 'Rydalmere', coachId: 'lee', extraCoachIds: ['luke'], capacity: 20, mode: 'application', label: 'Squad' })

await test('1. the board shows every player holding a place, in the right group, and the dashboard count', async () => {
  const b = (await portal(lee, 'board')).data
  const airtable = await at()
  const holding = airtable.term4.filter((r) => ['Confirmed', 'Awaiting Reply', 'Needs Follow-up', 'Not Contacted', ''].includes(r.fields['Term 4 Confirmation'] || ''))
  const onBoard = b.groups.reduce((t, g) => t + g.players.length, 0) + b.unassigned.length
  assert.equal(onBoard, holding.length)
  assert.equal(b.groups.find((g) => g.id === TUE525).players.length, 5)
  assert.equal(b.groups.find((g) => g.id === WED420).placesLeft, 0)
  assert.equal(b.totals.dashboard, airtable.term4.filter((r) => r.fields['Term 4 Confirmation'] === 'Confirmed' && !/test/i.test(r.fields['Player Name'])).length)
  assert.ok(b.groups.every((g) => g.players.every((p) => p.rowId.startsWith('rec'))))
})

await test('parents need the password, and the public list never shows people', async () => {
  const anon = client()
  assert.equal((await anon.call('/api/jfp-groups')).status, 401)
  await gate(anon)
  const r = await anon.call('/api/jfp-groups')
  assert.equal(r.status, 200)
  const s = JSON.stringify(r.data)
  assert.ok(!/parent\d+@example|Player \d|Riley|returning@/.test(s), 'no names or emails in the public list')
  assert.ok(!r.data.groups.some((g) => g.mode === 'closed'))
  assert.ok(r.data.locations.length >= 1)
})

let tue420Before
await test('2. a new family: sign in, new player details, waiver, pay; Airtable, waiver, ledger and email all update', async () => {
  const mum = client()
  await gate(mum)
  tue420Before = await left(mum, TUE420)
  const early = await mum.call('/api/jfp-book', { action: 'reserve', groupId: TUE420 })
  assert.equal(early.status, 401, 'holding a place needs a sign-in')
  assert.equal((await mum.call('/api/jfp-book', { action: 'family', groupId: TUE420 })).status, 401, 'details need a sign-in')
  await signIn(mum, 'new@example.com')
  const hold = await mum.call('/api/jfp-book', { action: 'reserve', groupId: TUE420 })
  assert.equal(hold.status, 200)
  assert.equal(await left(mum, TUE420), tue420Before - 1, 'the hold takes a place at once')
  const fam = await mum.call('/api/jfp-book', { action: 'family', groupId: TUE420 })
  assert.deepEqual(fam.data.players, [])
  const base = { groupId: TUE420, bookingId: hold.data.bookingId, releaseToken: hold.data.releaseToken, parentName: 'Pat Parent', mobile: '0411222333', agreementAccepted: true, kit: 'ordered' }
  const tooOld = await mum.call('/api/jfp-book', { ...base, players: [{ name: 'Big Kid', dob: '2010-01-01', emergencyName: 'Gran', emergencyPhone: '0400111222' }], waiver: WAIVER })
  assert.equal(tooOld.status, 400)
  assert.equal(tooOld.data.code, 'age')
  const noWaiver = await mum.call('/api/jfp-book', { ...base, players: [{ name: 'Nina New', dob: '2016-05-01', emergencyName: 'Gran', emergencyPhone: '0400111222' }] })
  assert.equal(noWaiver.data.code, 'waiver')
  const kitless = await mum.call('/api/jfp-book', { ...base, kit: '', players: [{ name: 'Nina New', dob: '2016-05-01', club: 'Forest FC', emergencyName: 'Gran New', emergencyPhone: '0400111222' }], waiver: WAIVER })
  assert.equal(kitless.data.code, 'kit', 'a booking needs the kit confirmed')
  const ok = await mum.call('/api/jfp-book', { ...base, players: [{ name: 'Nina New', dob: '2016-05-01', club: 'Forest FC', emergencyName: 'Gran New', emergencyPhone: '0400111222' }], waiver: WAIVER })
  assert.equal(ok.status, 200, JSON.stringify(ok.data))
  assert.equal(ok.data.bookingId, hold.data.bookingId, 'the reservation became the booking')
  const pay = await stripe(ok.data.url, 'pay')
  const success = new URL(pay.headers.get('location'))
  const conf = await mum.call(`/api/jfp-confirm?session_id=${success.searchParams.get('session_id')}`)
  assert.equal(conf.data.status, 'paid')
  const a = await at()
  const row = a.term4.find((r) => r.fields['Player Name'] === 'Nina New')
  assert.ok(row, 'Term 4 row created')
  assert.equal(row.fields['Term 4 Confirmation'], 'Confirmed')
  assert.equal(row.fields['Term 4 Payment Status'], 'Paid')
  assert.equal(row.fields['Term 3 Day'], 'Tuesday')
  assert.match(row.fields['Term 4 Notes'], /\[JFP-ONLINE:JFP-/)
  assert.ok(row.fields['Term 4 Stripe Fee AUD'] > 0, 'exact Stripe fee recorded')
  const w = a.waiver.find((r) => r.fields['Player Full Name'] === 'Nina New')
  assert.ok(w && w.fields['Parent/Guardian Signature'] === 'Pat Parent' && w.fields['Emergency Contact Name'] === 'Gran New' && w.fields['Term'] === 'Term 4 2026')
  assert.equal(a.ledger.filter((r) => r.fields['Player Name'] === 'Nina New').length, 1)
  const mail = (await emails()).filter((e) => e.to.includes('new@example.com') && /booked in/i.test(e.subject))
  assert.equal(mail.length, 1)
  assert.equal(mail[0].attachments[0].name, 'jfp-term.ics')
  assert.equal((mail[0].attachments[0].content.match(/BEGIN:VEVENT/g) || []).length, 10)
  assert.ok((await emails()).some((e) => /^JFP booking: Nina New/.test(e.subject)), 'staff alert sent')
  assert.equal(await left(mum, TUE420), tue420Before - 1, 'the place stays taken, counted once')
  const again = await mum.call(`/api/jfp-confirm?session_id=${success.searchParams.get('session_id')}`)
  assert.equal(again.data.status, 'paid')
  assert.equal((await at()).term4.filter((r) => r.fields['Player Name'] === 'Nina New').length, 1, 'no duplicate on a second confirm')
})

await test('3. a returning family is recognised: players, ages and waivers on file, pay without re-filling', async () => {
  const rita = client()
  await gate(rita)
  await signIn(rita, 'returning@example.com')
  const fam = (await rita.call('/api/jfp-book', { action: 'family', groupId: TUE420 })).data
  const riley = fam.players.find((p) => p.name === 'Riley Returning')
  const sasha = fam.players.find((p) => p.name === 'Sasha Returning')
  assert.equal(riley.inGroup, true)
  assert.equal(riley.waiverOnFile, true)
  assert.equal(sasha.age, 10)
  assert.equal(sasha.waiverOnFile, true)
  assert.equal(fam.parentName, 'Rita Returning')
  const hold = await rita.call('/api/jfp-book', { action: 'reserve', groupId: TUE420 })
  const waiversBefore = (await at()).waiver.length
  const ok = await rita.call('/api/jfp-book', { groupId: TUE420, bookingId: hold.data.bookingId, releaseToken: hold.data.releaseToken, players: [{ key: sasha.key }], agreementAccepted: true, kit: 'ordered' })
  assert.equal(ok.status, 200, JSON.stringify(ok.data))
  const dup = await rita.call('/api/jfp-book', { groupId: TUE420, players: [{ key: riley.key }], agreementAccepted: true, kit: 'ordered' })
  assert.match(dup.data.error, /already in this group/)
  await stripe(ok.data.url, 'pay')
  const a = await at()
  assert.ok(a.term4.some((r) => r.fields['Player Name'] === 'Sasha Returning' && r.fields['Term 4 Payment Status'] === 'Paid'))
  assert.equal(a.waiver.length, waiversBefore, 'no second waiver for a player already on file')
})

await test('4. two families racing for the last place: exactly one gets it', async () => {
  const p0 = client()
  await gate(p0)
  assert.equal(await left(p0, TUE525), 1)
  const x = client(), y = client()
  await Promise.all([gate(x), gate(y)])
  await signIn(x, 'racer-x@example.com')
  await signIn(y, 'racer-y@example.com')
  const [a, b] = await Promise.all([x.call('/api/jfp-book', { action: 'reserve', groupId: TUE525 }), y.call('/api/jfp-book', { action: 'reserve', groupId: TUE525 })])
  assert.deepEqual([a.status, b.status].sort(), [200, 409])
  const winner = a.status === 200 ? a : b
  const winnerClient = a.status === 200 ? x : y
  // The winner cannot grow the hold past what is left.
  const two = await winnerClient.call('/api/jfp-book', { groupId: TUE525, bookingId: winner.data.bookingId, releaseToken: winner.data.releaseToken, players: [{ name: 'Win One', dob: '2014-01-01', emergencyName: 'A B', emergencyPhone: '0400000001' }, { name: 'Win Two', dob: '2014-02-01', emergencyName: 'A B', emergencyPhone: '0400000001' }], waiver: WAIVER, parentName: 'Win Parent', mobile: '0400000001', agreementAccepted: true, kit: 'ordered' })
  assert.equal(two.status, 409)
  // Closing the form hands the place back.
  await winnerClient.call('/api/jfp-book', { action: 'release', bookingId: winner.data.bookingId, releaseToken: winner.data.releaseToken })
  assert.equal(await left(x, TUE525), 1)
})

let offerUrl
await test('5. an application: parent applies, admin offers a place, parent signs the waiver and pays via the link', async () => {
  const ap = client()
  await gate(ap)
  await signIn(ap, 'apply@example.com')
  const req = await ap.call('/api/jfp-book', { action: 'request', kind: 'application', groupId: FRI400, players: [{ name: 'Ava Apply', dob: '2017-03-03' }], parentName: 'Amy Apply', mobile: '0400999888', club: 'Belrose Terrey Hills U9', message: 'Keen' })
  assert.equal(req.status, 200, JSON.stringify(req.data))
  assert.ok((await emails()).some((e) => e.to.includes('apply@example.com') && /Received/.test(e.subject)))
  assert.ok((await emails()).some((e) => /^JFP application: Ava Apply/.test(e.subject)))
  const list = (await portal(lee, 'requests')).data.requests
  const r = list.find((x) => x.id === req.data.id)
  assert.equal(r.status, 'pending')
  const offer = await portal(lee, 'decideRequest', { id: r.id, decision: 'offer', amountCents: 85000 })
  assert.equal(offer.status, 200, JSON.stringify(offer.data))
  offerUrl = offer.data.payreq.url
  const row = (await at()).term4.find((x) => x.fields['Player Name'] === 'Ava Apply')
  assert.equal(row.fields['Term 4 Confirmation'], 'Awaiting Reply', 'the place is held in Airtable')
  assert.ok((await emails()).some((e) => e.to.includes('apply@example.com') && /A place for you/.test(e.subject)))
  const acc = (await ap.call('/api/jfp-account', { action: 'overview' })).data
  assert.equal(acc.todo.length, 1)
  assert.equal(acc.todo[0].needsWaiver, true)
  const early = await ap.call('/api/jfp-account', { action: 'pay', payreqId: acc.todo[0].id, noKit: true })
  assert.equal(early.data.code, 'waiver', 'cannot pay before the waiver')
  const ava = acc.players.find((p) => p.name === 'Ava Apply')
  const signed = await ap.call('/api/jfp-account', { action: 'signWaiver', players: [{ key: ava.key, emergencyName: 'Al Apply', emergencyPhone: '0400999777' }], waiver: { ...WAIVER, signature: 'Amy Apply' }, parentName: 'Amy Apply', mobile: '0400999888' })
  assert.equal(signed.status, 200, JSON.stringify(signed.data))
  const noKit = await ap.call('/api/jfp-account', { action: 'pay', payreqId: acc.todo[0].id, noKit: true })
  assert.equal(noKit.data.code, 'kit', 'the JF playing kit is confirmed before paying')
  assert.equal((await ap.call('/api/jfp-account', { action: 'overview' })).data.todo[0].needsKit, true)
  const kit = await ap.call('/api/jfp-account', { action: 'confirmKit', payreqId: acc.todo[0].id, kit: 'has' })
  assert.equal(kit.status, 200, JSON.stringify(kit.data))
  assert.equal((await at()).term4.find((x) => x.fields['Player Name'] === 'Ava Apply').fields['Training Kit'], 'Already has one', 'the kit answer is on the Term 4 row')
  const pay = await ap.call('/api/jfp-account', { action: 'pay', payreqId: acc.todo[0].id, noKit: true })
  assert.equal(pay.status, 200, JSON.stringify(pay.data))
  const back = await stripe(pay.data.url, 'pay')
  const sid = new URL(back.headers.get('location')).searchParams.get('session_id')
  assert.equal((await ap.call(`/api/jfp-confirm?session_id=${sid}`)).data.status, 'paid')
  const after = (await at()).term4.find((x) => x.fields['Player Name'] === 'Ava Apply')
  assert.equal(after.fields['Term 4 Confirmation'], 'Confirmed')
  assert.equal(after.fields['Term 4 Payment Status'], 'Paid')
  assert.equal(after.fields['Term 4 Amount Paid'], 850)
  assert.equal((await at()).ledger.filter((x) => x.fields['Player Name'] === 'Ava Apply').length, 1)
  assert.equal((await ap.call('/api/jfp-account', { action: 'overview' })).data.todo.length, 0)
})

await test('waitlist on a full group and an enquiry for 1 to 1 are both recorded for staff', async () => {
  const w = client()
  await gate(w)
  await signIn(w, 'wait@example.com')
  assert.equal((await w.call('/api/jfp-book', { action: 'reserve', groupId: WED420 })).data.code, 'full')
  const wl = await w.call('/api/jfp-book', { action: 'request', kind: 'waitlist', groupId: WED420, players: [{ name: 'Walt Wait', dob: '2015-08-08' }], parentName: 'Wendy Wait', mobile: '0400123123' })
  assert.equal(wl.status, 200, JSON.stringify(wl.data))
  const en = await w.call('/api/jfp-book', { action: 'request', kind: 'enquiry', groupId: MON1300, players: [{ name: 'Walt Wait', dob: '2015-08-08' }], parentName: 'Wendy Wait', mobile: '0400123123', message: 'Saturdays' })
  assert.equal(en.status, 200, JSON.stringify(en.data))
  const pc = (await w.call('/api/jfp-groups')).data.privateCoaching
  assert.equal(pc.id, 'one-to-one', 'one 1 to 1 enquiry card when the programme has 1 to 1 slots')
  const en2 = await w.call('/api/jfp-book', { action: 'request', kind: 'enquiry', groupId: 'one-to-one', players: [{ name: 'Walt Wait', dob: '2015-08-08' }], parentName: 'Wendy Wait', mobile: '0400123123', message: 'Weekday mornings' })
  assert.equal(en2.status, 200, JSON.stringify(en2.data))
  assert.equal((await w.call('/api/jfp-book', { action: 'request', kind: 'waitlist', groupId: 'one-to-one', players: [{ name: 'Walt Wait', dob: '2015-08-08' }], parentName: 'Wendy Wait', mobile: '0400123123' })).status, 404)
  const kinds = (await portal(lee, 'requests')).data.requests.map((r) => r.kind)
  assert.ok(kinds.includes('waitlist') && kinds.includes('enquiry'))
})

await test('6b. a Pro added session by session: own price per session, nothing owing, email with no payment', async () => {
  assert.equal((await portal(lee, 'addPlayer', { groupId: TUE420, player: { name: 'Pat Pro' }, parent: { email: 'pro@example.com' }, payment: 'sessions', perSessionCents: 5, sendEmail: true })).status, 400, 'a price per session, when given, is a real price')
  const add = await portal(lee, 'addPlayer', { groupId: TUE420, player: { name: 'Pat Pro' }, parent: { email: 'pro@example.com' }, payment: 'sessions', perSessionCents: 8000, sendEmail: true, force: true })
  assert.equal(add.status, 200, JSON.stringify(add.data))
  const row = (await at()).term4.find((r) => r.id === add.data.rowId).fields
  assert.equal(row['Term 4 Fee'], 0)
  assert.match(row['Term 4 Payment Type'], /session/i)
  assert.match(row['Term 4 Notes'], /PERSESSION:8000/)
  assert.equal(add.data.payreq, null, 'no payment link')
  const mail = (await emails()).filter((e) => e.to.includes('pro@example.com'))
  assert.equal(mail.length, 1)
  assert.doesNotMatch(mail[0].html, /pay A\$/)
  const rm = await portal(lee, 'removePlayer', { rowId: add.data.rowId, reason: 'Other', details: 'test' })
  assert.equal(rm.status, 200)
})

await test('6. admin adds, moves and removes a player; the family gets the sign-in email; Airtable and the parent page update', async () => {
  const pub = client()
  await gate(pub)
  const before = await left(pub, TUE420)
  const add = await portal(lee, 'addPlayer', { groupId: TUE420, player: { name: 'Leo Added', dob: '2015-09-09' }, parent: { name: 'Lou Added', email: 'added@example.com', mobile: '0400555666' }, payment: 'link', sendEmail: true })
  assert.equal(add.status, 200, JSON.stringify(add.data))
  assert.equal(await left(pub, TUE420), before - 1, 'the parent page shows the place gone at once')
  const invite = (await emails()).filter((e) => e.to.includes('added@example.com'))
  assert.equal(invite.length, 1)
  assert.match(invite[0].html, /sign the waiver/)
  assert.match(invite[0].html, /pay A\$850/)
  const fam = client()
  await signIn(fam, 'added@example.com')
  const acc = (await fam.call('/api/jfp-account', { action: 'overview' })).data
  assert.equal(acc.players[0].name, 'Leo Added')
  assert.equal(acc.todo.length, 1)
  const rowId = add.data.rowId
  const move = await portal(lee, 'movePlayer', { rowId, toGroupId: TUE525 })
  assert.equal(move.status, 200, JSON.stringify(move.data))
  assert.equal((await at()).term4.find((r) => r.id === rowId).fields['Term 3 Time'], '5:25pm')
  assert.equal((await at()).term4.find((r) => r.id === rowId).fields['Coach'], 'Dean Mac')
  const full = await portal(lee, 'movePlayer', { rowId, toGroupId: WED420 })
  assert.equal(full.status, 409, 'a full group asks first')
  assert.equal((await portal(lee, 'removePlayer', { rowId })).status, 400, 'a reason is needed')
  const rm = await portal(lee, 'removePlayer', { rowId, reason: 'Moved away', details: 'Family moving to Brisbane' })
  assert.equal(rm.status, 200, JSON.stringify(rm.data))
  assert.ok(!(await at()).term4.some((r) => r.id === rowId), 'off Term 4 Players')
  const kept = (await at()).dropped.find((r) => r.fields['Source Term 4 Record ID'] === rowId)
  assert.equal(kept.fields['Email'], 'added@example.com', 'the contact is kept')
  assert.equal(kept.fields['Reason for leaving'], 'Moved away')
  const removed = (await portal(lee, 'removed')).data.players.find((p) => p.droppedId === kept.id)
  assert.equal(removed.details, 'Family moving to Brisbane')
  const back = await portal(lee, 'restorePlayer', { droppedId: kept.id })
  assert.equal(back.status, 200, JSON.stringify(back.data))
  const restored = (await at()).term4.find((r) => r.id === back.data.rowId)
  assert.equal(restored.fields['Term 3 Time'], '5:25pm')
  assert.equal(restored.fields['Term 4 Confirmation'], 'Confirmed')
  assert.equal((await portal(lee, 'restorePlayer', { droppedId: kept.id })).status, 409, 'restored once')
  await portal(lee, 'removePlayer', { rowId: back.data.rowId, reason: 'Other' })
  assert.equal((await fam.call('/api/jfp-account', { action: 'overview' })).data.todo.length, 0, 'open payment cancelled with the removal')
  const log = (await portal(lee, 'audit')).data.entries.map((e) => e.action)
  for (const a of ['player.add', 'player.move', 'player.remove']) assert.ok(log.includes(a), `audit has ${a}`)
})

await test('7. roles: coaches see only their sessions and no money; parents only their own family', async () => {
  const dean = client()
  const cfg = (await portal(lee, 'getSettings')).data.config
  assert.equal(cfg.coachLoginsEnabled, true, 'coach logins are on')
  assert.equal((await portal(lee, 'saveSettings', { config: { coachLoginsEnabled: false } })).status, 200)
  const start = await dean.call('/api/jfp-auth', { action: 'start', email: 'jonerfootballdean@gmail.com', audience: 'staff' })
  assert.equal(start.status, 200)
  assert.ok(!(await emails()).some((e) => e.to.includes('jonerfootballdean@gmail.com')), 'no code while coach logins are off')
  assert.equal((await portal(lee, 'saveSettings', { config: { coachLoginsEnabled: true } })).status, 200)
  await signIn(dean, 'jonerfootballdean@gmail.com', 'staff')
  const mine = await portal(dean, 'coachSessions', { coachId: 'sam' })
  assert.equal(mine.status, 200)
  assert.equal(mine.data.coach, 'Dean McDonnell', 'a coach cannot ask for another coach')
  // Profile photo: a coach sets their own, never another coach's.
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
  const up = await portal(dean, 'coachPhoto', { coachId: 'sam', dataUrl: PNG })
  assert.equal(up.status, 200)
  assert.match(up.data.photo, /coachPhoto=dean&v=\d+/, 'the photo saves to the coach signed in, whatever coachId says')
  const img = await fetch(B + up.data.photo)
  assert.equal(img.status, 200)
  assert.equal(img.headers.get('content-type'), 'image/png')
  assert.equal((await portal(dean, 'coachPhoto', { dataUrl: 'data:text/html;base64,PGgxPg==' })).status, 400, 'only images')
  const me = await portal(dean, 'me')
  assert.equal(me.data.user.name, 'Coach Dean McDonnell')
  assert.ok(me.data.user.photo)
  assert.deepEqual(me.data.coaches, [], 'a coach never gets the coach list with emails')
  const sam = (await portal(lee, 'me')).data.coaches.find((c) => c.id === 'sam')
  assert.equal(sam.photo, '', 'Sam has no photo')
  assert.ok((await portal(lee, 'me')).data.coaches.some((c) => c.id === 'sage' && c.name === 'Sage Melhem'))
  const s = JSON.stringify(mine.data)
  assert.ok(!/@|0400|Paid|850|parent/i.test(s), 'no money or contact details')
  assert.ok(mine.data.sessions.every((x) => x.id !== TUE420), 'only their own sessions')
  for (const action of ['board', 'money', 'payments', 'addPlayer', 'getSettings', 'requests', 'getProfile', 'saveProfile']) assert.equal((await portal(dean, action)).status, 403, `${action} is admin only`)
  const tue = mine.data.sessions.find((x) => x.id === TUE525)
  const mark = await portal(dean, 'markAttendance', { groupId: TUE525, date: tue.nextDate, rowId: tue.players[0].rowId, status: 'Present' })
  assert.equal(mark.status, 200)
  assert.equal((await portal(dean, 'markAttendance', { groupId: TUE420, date: '2026-10-13', rowId: 'recX', status: 'Present' })).status, 403)
  const rita = client()
  await signIn(rita, 'returning@example.com')
  const fam = (await rita.call('/api/jfp-book', { action: 'family' }))
  assert.equal(fam.status, 401, 'booking API also needs the password')
  await gate(rita)
  const own = (await rita.call('/api/jfp-book', { action: 'family' })).data.players.map((p) => p.name).sort()
  assert.deepEqual(own, ['Riley Returning', 'Sasha Returning'])
  const acc = JSON.stringify((await rita.call('/api/jfp-account', { action: 'overview' })).data)
  assert.ok(!/Nina|Ava|Leo Added|new@example|apply@example/.test(acc), 'no other family in the account view')
  assert.equal((await rita.call('/api/jfp-portal-data', { action: 'board' })).status, 401, 'a parent session is not a staff session')
  const other = client()
  assert.equal((await other.call('/api/jfp-account', { action: 'overview' })).status, 401)
  // Another family's payment link and players are out of reach.
  const payreqs = (await portal(lee, 'payments')).data.payreqs
  const someoneElses = payreqs.find((q) => q.email !== 'returning@example.com')
  assert.equal((await rita.call('/api/jfp-account', { action: 'pay', payreqId: someoneElses.id })).status, 404)
  const signOther = await rita.call('/api/jfp-account', { action: 'signWaiver', players: [{ key: 'leoadded', dob: '2015-09-09', emergencyName: 'X Y', emergencyPhone: '0400000009' }], waiver: WAIVER, parentName: 'Rita', mobile: '0400000009' })
  assert.equal(signOther.status, 404)
  const bookOther = await rita.call('/api/jfp-book', { groupId: TUE420, players: [{ key: 'ninanew' }], agreementAccepted: true, kit: 'ordered' })
  assert.equal(bookOther.status, 400)
  // Cross-site requests are refused.
  const evil = await fetch(`${B}/api/jfp-portal-data`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example', cookie: [...lee.jar].map(([k, v]) => `${k}=${v}`).join('; ') }, body: JSON.stringify({ action: 'board' }) })
  assert.equal(evil.status, 403)
})

await test('sign-in codes are single use, and a wrong code is refused', async () => {
  const c = client()
  const s = await c.call('/api/jfp-auth', { action: 'start', email: 'once@example.com', audience: 'parent' })
  const code = await codeFor('once@example.com')
  const wrong = String((Number(code) + 1) % 1000000).padStart(6, '0')
  assert.equal((await c.call('/api/jfp-auth', { action: 'verify', challenge: s.data.challenge, code: wrong })).status, 401)
  assert.equal((await c.call('/api/jfp-auth', { action: 'verify', challenge: s.data.challenge, code })).status, 200)
  assert.equal((await c.call('/api/jfp-auth', { action: 'verify', challenge: s.data.challenge, code })).status, 401)
})

await test('an abandoned Stripe checkout releases the place', async () => {
  const c = client()
  await gate(c)
  const beforeLeft = await left(c, TUE420)
  await signIn(c, 'abandon@example.com')
  const hold = await c.call('/api/jfp-book', { action: 'reserve', groupId: TUE420 })
  const ok = await c.call('/api/jfp-book', { groupId: TUE420, bookingId: hold.data.bookingId, releaseToken: hold.data.releaseToken, players: [{ name: 'Abe Andon', dob: '2016-01-01', emergencyName: 'X Y', emergencyPhone: '0400444555' }], waiver: WAIVER, parentName: 'Ann Andon', mobile: '0400444555', agreementAccepted: true, kit: 'ordered' })
  assert.equal(ok.status, 200, JSON.stringify(ok.data))
  assert.equal(await left(c, TUE420), beforeLeft - 1)
  await stripe(ok.data.url, 'expire')
  assert.equal(await left(c, TUE420), beforeLeft)
})

await test('a failed Airtable write is recorded and repaired, never lost', async () => {
  const c = client()
  await gate(c)
  await signIn(c, 'repair@example.com')
  const hold = await c.call('/api/jfp-book', { action: 'reserve', groupId: TUE420 })
  const ok = await c.call('/api/jfp-book', { groupId: TUE420, bookingId: hold.data.bookingId, releaseToken: hold.data.releaseToken, players: [{ name: 'Rae Pair', dob: '2016-02-02', emergencyName: 'X Y', emergencyPhone: '0400444556' }], waiver: WAIVER, parentName: 'Ray Pair', mobile: '0400444556', agreementAccepted: true, kit: 'ordered' })
  await fetch(`${B}/__fail?what=airtable-term4&on=1`)
  await stripe(ok.data.url, 'pay')
  await fetch(`${B}/__fail?what=airtable-term4&on=0`)
  let p = (await portal(lee, 'payments')).data.bookings.find((b) => b.id === ok.data.bookingId)
  assert.ok(p.effects.failed.includes('airtable'))
  const fixed = await portal(lee, 'repair', { id: ok.data.bookingId })
  assert.equal(fixed.data.summary.ok, true)
  assert.equal((await at()).term4.filter((r) => r.fields['Player Name'] === 'Rae Pair').length, 1)
  assert.equal((await emails()).filter((e) => e.to.includes('repair@example.com') && /booked in/i.test(e.subject)).length, 1, 'booked in only once, after the repair')
})

await test('launch review 1: paid while Airtable is down is "payment received, confirming", never "booked in", and recovers on its own', async () => {
  const c = client()
  await gate(c)
  await signIn(c, 'outage@example.com')
  const WED420 = await mk({ day: 'Saturday', time: '7:00am', location: 'Belrose HQ', coachId: 'dean', capacity: 6, mode: 'direct', minAge: 6, maxAge: 19 })
  const hold = await c.call('/api/jfp-book', { action: 'reserve', groupId: WED420 })
  const ok = await c.call('/api/jfp-book', { groupId: WED420, bookingId: hold.data.bookingId, releaseToken: hold.data.releaseToken, players: [{ name: 'Otto Age', dob: '2015-05-05', emergencyName: 'O A', emergencyPhone: '0400444557' }], waiver: WAIVER, parentName: 'Ola Age', mobile: '0400444557', agreementAccepted: true, kit: 'ordered' })
  assert.equal(ok.status, 200, JSON.stringify(ok.data))
  const sid = new URL(ok.data.url).searchParams.get('cs')
  await fetch(`${B}/__fail?what=airtable-term4&on=1`)
  await stripe(ok.data.url, 'pay')
  const ev = await (await fetch(`${B}/__events`)).json()
  assert.ok(ev.some((e) => e.kind === 'webhook' && e.detail.includes(sid) && e.detail.endsWith('-> 500')), 'the webhook asks Stripe to retry')
  let conf = await (await fetch(`${B}/api/jfp-confirm?session_id=${sid}`)).json()
  assert.equal(conf.status, 'confirming', 'the success page does not say booked in')
  const mails = (await emails()).filter((e) => e.to.includes('outage@example.com'))
  assert.ok(!mails.some((e) => /booked in/i.test(e.subject)), 'no booked-in email while the roster is missing')
  assert.ok((await emails()).some((e) => /needs checking/.test(e.subject) && e.html.includes(ok.data.bookingId)), 'staff are told straight away')
  assert.equal((await at()).term4.filter((r) => r.fields['Player Name'] === 'Otto Age').length, 0)
  // Airtable back: the next attempt (Stripe's retry or the success page) finishes it.
  await fetch(`${B}/__fail?what=airtable-term4&on=0`)
  conf = await (await fetch(`${B}/api/jfp-confirm?session_id=${sid}`)).json()
  assert.equal(conf.status, 'paid')
  assert.equal((await at()).term4.filter((r) => r.fields['Player Name'] === 'Otto Age').length, 1)
  assert.equal((await emails()).filter((e) => e.to.includes('outage@example.com') && /booked in/i.test(e.subject)).length, 1, 'booked in exactly once, after the place exists')
  const p = (await portal(lee, 'payments')).data.bookings.find((b) => b.id === ok.data.bookingId)
  assert.ok(!String(p.needsAttention || '').includes('roster-pending'), 'the flag clears once enrolled')
})

await test('launch review 3: coming back from Stripe says only what the server confirmed', async () => {
  const c = client()
  await gate(c)
  await signIn(c, 'cancel@example.com')
  const WED420 = await mk({ day: 'Saturday', time: '7:15am', location: 'Belrose HQ', coachId: 'dean', capacity: 6, mode: 'direct', minAge: 6, maxAge: 19 })
  const hold = await c.call('/api/jfp-book', { action: 'reserve', groupId: WED420 })
  const ok = await c.call('/api/jfp-book', { groupId: WED420, bookingId: hold.data.bookingId, releaseToken: hold.data.releaseToken, players: [{ name: 'Cal Cel', dob: '2015-06-06', emergencyName: 'C C', emergencyPhone: '0400444558' }], waiver: WAIVER, parentName: 'Cara Cel', mobile: '0400444558', agreementAccepted: true, kit: 'ordered' })
  // Paid, then the cancel link is opened anyway: never "nothing was charged".
  await stripe(ok.data.url, 'pay')
  const r1 = await c.call('/api/jfp-book', { action: 'release', bookingId: ok.data.bookingId, releaseToken: hold.data.releaseToken })
  assert.deepEqual([r1.data.released, r1.data.state], [false, 'paid'])
  const r2 = await c.call('/api/jfp-book', { action: 'release', bookingId: 'JFP-unknown', releaseToken: 'x' })
  assert.deepEqual([r2.data.released, r2.data.state], [false, 'unknown'])
  // A real cancel: released and nothing charged.
  const hold2 = await c.call('/api/jfp-book', { action: 'reserve', groupId: WED420 })
  const ok2 = await c.call('/api/jfp-book', { groupId: WED420, bookingId: hold2.data.bookingId, releaseToken: hold2.data.releaseToken, players: [{ name: 'Cid Cel', dob: '2015-07-07', emergencyName: 'C C', emergencyPhone: '0400444558' }], waiver: WAIVER, parentName: 'Cara Cel', mobile: '0400444558', agreementAccepted: true, kit: 'ordered' })
  const r3 = await c.call('/api/jfp-book', { action: 'release', bookingId: ok2.data.bookingId, releaseToken: hold2.data.releaseToken })
  assert.deepEqual([r3.data.released, r3.data.state], [true, 'cancelled'])
})

await test('review risk: staff and a family racing for the last place: exactly one gets it', async () => {
  const LAST = await mk({ day: 'Thursday', time: '7:00pm', location: 'Belrose HQ', coachId: 'dean', capacity: 1, mode: 'direct', minAge: 6, maxAge: 19 })
  const fam = client()
  await gate(fam)
  await signIn(fam, 'race@example.com')
  const [staff, parent] = await Promise.all([
    portal(lee, 'addPlayer', { groupId: LAST, player: { name: 'Staff Racer', age: 10 }, parent: { name: 'S R', email: '', mobile: '' }, payment: 'none' }),
    fam.call('/api/jfp-book', { action: 'reserve', groupId: LAST }),
  ])
  const wins = [staff.status === 200, parent.status === 200].filter(Boolean).length
  assert.equal(wins, 1, `exactly one wins (staff ${staff.status}, family ${parent.status})`)
  // Two staff at once: one gets it, the other is asked "Add anyway?".
  const LAST2 = await mk({ day: 'Thursday', time: '8:00pm', location: 'Belrose HQ', coachId: 'dean', capacity: 1, mode: 'direct', minAge: 6, maxAge: 19 })
  const ligia = client()
  await signIn(ligia, 'ligia@jonerfootball.com', 'staff')
  const both = await Promise.all([
    portal(lee, 'addPlayer', { groupId: LAST2, player: { name: 'Lee Racer', age: 10 }, parent: { name: 'L R', email: '', mobile: '' }, payment: 'none' }),
    portal(ligia, 'addPlayer', { groupId: LAST2, player: { name: 'Ligia Racer', age: 10 }, parent: { name: 'L R', email: '', mobile: '' }, payment: 'none' }),
  ])
  assert.equal(both.filter((r) => r.status === 200).length, 1)
  assert.equal(both.filter((r) => r.data.code === 'full').length, 1)
  // The public timetable never changes state (no sweep on a read).
  const before = JSON.stringify((await at()).term4.length)
  await c2Get()
  assert.equal(JSON.stringify((await at()).term4.length), before)
  async function c2Get() { const x = client(); await gate(x); await x.call('/api/jfp-groups') }
})

await test('a payment for a booking that was just cancelled is recorded and flagged, never lost', async () => {
  const c = client()
  await gate(c)
  await signIn(c, 'late@example.com')
  const hold = await c.call('/api/jfp-book', { action: 'reserve', groupId: TUE420 })
  const ok = await c.call('/api/jfp-book', { groupId: TUE420, bookingId: hold.data.bookingId, releaseToken: hold.data.releaseToken, players: [{ name: 'Lana Late', dob: '2016-03-03', emergencyName: 'X Y', emergencyPhone: '0400444557' }], waiver: WAIVER, parentName: 'Lou Late', mobile: '0400444557', agreementAccepted: true, kit: 'ordered' })
  // The parent closes the form; we close the Stripe page and release.
  await c.call('/api/jfp-book', { action: 'release', bookingId: hold.data.bookingId, releaseToken: hold.data.releaseToken })
  // A payment still lands for it (a second tab, a slow bank).
  const back = await stripe(ok.data.url, 'pay')
  const sid = new URL(back.headers.get('location')).searchParams.get('session_id')
  const conf = await c.call(`/api/jfp-confirm?session_id=${sid}`)
  assert.equal(conf.data.status, 'received', 'the parent is never told nothing was charged')
  const p = (await portal(lee, 'payments')).data.bookings.find((b) => b.id === hold.data.bookingId)
  assert.match(p.needsAttention, /paid-after-cancel/)
  assert.ok((await emails()).some((e) => /needs checking/.test(e.subject)), 'Lee is emailed')
  assert.equal((await at()).term4.filter((r) => r.fields['Player Name'] === 'Lana Late').length, 0, 'nothing added automatically')
})

await test('paying twice for one booking: the first counts, the second is flagged', async () => {
  const c = client()
  await gate(c)
  await signIn(c, 'twice@example.com')
  const hold = await c.call('/api/jfp-book', { action: 'reserve', groupId: TUE420 })
  const body = { groupId: TUE420, bookingId: hold.data.bookingId, releaseToken: hold.data.releaseToken, players: [{ name: 'Tia Twice', dob: '2016-04-04', emergencyName: 'X Y', emergencyPhone: '0400444558' }], waiver: WAIVER, parentName: 'Tom Twice', mobile: '0400444558', agreementAccepted: true, kit: 'ordered' }
  const first = await c.call('/api/jfp-book', body)
  const second = await c.call('/api/jfp-book', body)
  assert.equal(second.status, 200, JSON.stringify(second.data))
  assert.equal(second.data.bookingId, first.data.bookingId, 'same booking, the first Stripe page is closed')
  const sessions = await (await fetch(`${B}/__sessions`)).json()
  assert.equal(sessions.find((x) => first.data.url.includes(x.id)).status, 'expired')
  await stripe(second.data.url, 'pay')
  await stripe(first.data.url, 'pay')
  assert.equal((await at()).term4.filter((r) => r.fields['Player Name'] === 'Tia Twice').length, 1)
  const p = (await portal(lee, 'payments')).data.bookings.find((b) => b.id === first.data.bookingId)
  assert.match(p.needsAttention, /second-payment/)
})

await test('a payment link across two players is split by what each still owes', async () => {
  const add = async (name) => (await portal(lee, 'addPlayer', { groupId: TUE420, force: true, player: { name }, parent: { name: 'Sib Parent', email: 'sib@example.com', mobile: '0400777888' }, payment: 'none' })).data.rowId
  const a = await add('Sib One'), b = await add('Sib Two')
  await portal(lee, 'markPaid', { rowId: a, amountCents: 42500, method: 'Cash' })
  const link = await portal(lee, 'sendPaymentLink', { rowIds: [a, b], sendEmail: false })
  assert.equal(link.data.payreq.amountLabel, 'A$1275')
  const fam = client()
  await signIn(fam, 'sib@example.com')
  const acc = (await fam.call('/api/jfp-account', { action: 'overview' })).data
  await fam.call('/api/jfp-account', { action: 'signWaiver', players: acc.players.map((p) => ({ key: p.key, dob: '2015-05-05', emergencyName: 'E C', emergencyPhone: '0400777889' })), waiver: WAIVER, parentName: 'Sib Parent', mobile: '0400777888' })
  const pay = await fam.call('/api/jfp-account', { action: 'pay', payreqId: link.data.payreq.id })
  assert.equal(pay.status, 200, JSON.stringify(pay.data))
  await stripe(pay.data.url, 'pay')
  const rows = (await at()).term4.filter((r) => [a, b].includes(r.id))
  for (const r of rows) {
    assert.equal(r.fields['Term 4 Amount Paid'], 850)
    assert.equal(r.fields['Term 4 Payment Status'], 'Paid')
  }
})

await test('family invoice: each place keeps its own price, one link for the family, one ledger line per player', async () => {
  const parent = { name: 'Rae Family', email: 'family-invoice@example.com', mobile: '0400555111' }
  const add = async (groupId, name) => { const r = await portal(lee, 'addPlayer', { groupId, force: true, player: { name }, parent, payment: 'none' }); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data.rowId }
  const a1 = await add(WED420, 'Aya Family'), a2 = await add(TUE525, 'Aya Family'), k = await add(TUE420, 'Kai Family')
  // The mistake found live: the family total typed into every row.
  for (const id of [a1, a2, k]) assert.equal((await portal(lee, 'editPlayer', { rowId: id, fields: { feeAud: 2250 } })).status, 200)
  const old = await portal(lee, 'sendPaymentLink', { rowIds: [k], amountCents: 10000, sendEmail: false })
  assert.equal(old.status, 200, JSON.stringify(old.data))
  const m = (await portal(lee, 'money', { fresh: true })).data.money
  const fam = m.players.filter((p) => [a1, a2, k].includes(p.rowId))
  assert.equal(new Set(fam.map((p) => p.familyKey)).size, 1, 'the three places are one family')
  assert.equal(fam.find((p) => p.rowId === k).openLink.id, old.data.payreq.id)
  assert.equal(m.prices.familyPlace, 75000)
  const places = [a1, a2, k].map((rowId) => ({ rowId, feeCents: 75000, paymentType: 'Sibling / 2 sessions per week' }))
  const ask = await portal(lee, 'familyInvoice', { places, sendEmail: true })
  assert.equal(ask.status, 409, 'an open link is never replaced without a yes')
  assert.equal(ask.data.code, 'link_open')
  const inv = await portal(lee, 'familyInvoice', { places, sendEmail: true, replace: true })
  assert.equal(inv.status, 200, JSON.stringify(inv.data))
  assert.equal(inv.data.payreq.amountLabel, 'A$2250')
  assert.equal(inv.data.replaced, 1)
  const air = await at()
  for (const id of [a1, a2, k]) {
    const f = air.term4.find((r) => r.id === id).fields
    assert.equal(f['Term 4 Fee'], 750)
    assert.equal(f['Term 4 Payment Type'], 'Sibling / 2 sessions per week')
  }
  const links = (await portal(lee, 'payments')).data.payreqs
  assert.equal(links.find((q) => q.id === old.data.payreq.id).status, 'cancelled')
  assert.ok(air.term4.find((r) => r.id === k), 'replacing a link never removes the place')
  const mail = (await emails()).filter((e) => e.to.includes(parent.email) && /invoice/.test(e.subject)).at(-1)
  assert.ok(mail && mail.html.includes('Aya Family') && mail.html.includes('Kai Family') && mail.html.includes('A$2250'))
  const c = client()
  await signIn(c, parent.email)
  const acc = (await c.call('/api/jfp-account', { action: 'overview' })).data
  const todo = acc.todo.find((t) => t.id === inv.data.payreq.id)
  assert.equal(todo.places.length, 3)
  await c.call('/api/jfp-account', { action: 'signWaiver', players: acc.players.map((p) => ({ key: p.key, dob: '2014-04-04', emergencyName: 'E C', emergencyPhone: '0400555112' })), waiver: WAIVER, parentName: parent.name, mobile: parent.mobile })
  const pay = await c.call('/api/jfp-account', { action: 'pay', payreqId: todo.id })
  assert.equal(pay.status, 200, JSON.stringify(pay.data))
  const session = (await (await fetch(`${B}/__sessions`)).json()).find((x) => pay.data.url.includes(x.id))
  assert.equal(session.amount_total, 225000)
  assert.equal(session.line_count, 3, 'Stripe lists each place')
  await stripe(pay.data.url, 'pay')
  const after = await at()
  for (const id of [a1, a2, k]) {
    const f = after.term4.find((r) => r.id === id).fields
    assert.equal(f['Term 4 Amount Paid'], 750)
    assert.equal(f['Term 4 Payment Status'], 'Paid')
  }
  const lines = after.ledger.filter((l) => String(l.fields['Source Record ID']).split(', ').some((x) => [a1, a2, k].includes(x)))
  assert.equal(lines.length, 3, 'one ledger line per player')
  assert.deepEqual(lines.map((l) => l.fields['Amount Paid']), [750, 750, 750])
  assert.equal(new Set(lines.map((l) => l.fields['Payment ID'])).size, 3)
  assert.equal(new Set(lines.map((l) => l.fields['Stripe Checkout Session ID'])).size, 1, 'all from the one payment')
})

await test('session by session: pink in Money, a link for the sessions (sisters on one link), or recorded as a bank payment', async () => {
  const parent = { name: 'Sam Sisters', email: 'sessions@example.com', mobile: '0400666111' }
  const add = async (name) => (await portal(lee, 'addPlayer', { groupId: WED420, force: true, player: { name }, parent, payment: 'none' })).data.rowId
  const j = await add('Jay Sister'), i = await add('Ivy Sister')
  for (const id of [j, i]) assert.equal((await portal(lee, 'editPlayer', { rowId: id, fields: { paymentType: 'JFP Session by session', perSessionAud: 50 } })).status, 200)
  let m = (await portal(lee, 'money', { fresh: true })).data.money
  assert.deepEqual(m.players.filter((p) => [j, i].includes(p.rowId)).map((p) => [p.status, p.perSessionCents]), [['session', 5000], ['session', 5000]])
  const link = await portal(lee, 'sessionInvoice', { rows: [{ rowId: j, sessions: 2, perSessionCents: 5000 }, { rowId: i, sessions: 2, perSessionCents: 5000 }], what: '8 and 15 Oct', sendEmail: true })
  assert.equal(link.status, 200, JSON.stringify(link.data))
  assert.equal(link.data.payreq.amountLabel, 'A$200')
  let air = await at()
  assert.equal(air.term4.find((r) => r.id === j).fields['Term 4 Fee'], 100)
  const c = client()
  await signIn(c, parent.email)
  const acc = (await c.call('/api/jfp-account', { action: 'overview' })).data
  const todo = acc.todo.find((t) => t.id === link.data.payreq.id)
  assert.equal(todo.needsKit, false, 'no kit step for sessions')
  await c.call('/api/jfp-account', { action: 'signWaiver', players: acc.players.map((p) => ({ key: p.key, dob: '2010-02-02', emergencyName: 'E C', emergencyPhone: '0400666112' })), waiver: WAIVER, parentName: parent.name, mobile: parent.mobile })
  const pay = await c.call('/api/jfp-account', { action: 'pay', payreqId: todo.id, noKit: true })
  assert.equal(pay.status, 200, JSON.stringify(pay.data))
  await stripe(pay.data.url, 'pay')
  air = await at()
  for (const id of [j, i]) assert.equal(air.term4.find((r) => r.id === id).fields['Term 4 Amount Paid'], 100)
  // The next week, paid by bank transfer.
  const bank = await portal(lee, 'sessionInvoice', { rows: [{ rowId: j, sessions: 1, perSessionCents: 5000 }], mode: 'paid', method: 'bank transfer' })
  assert.equal(bank.status, 200, JSON.stringify(bank.data))
  air = await at()
  const row = air.term4.find((r) => r.id === j).fields
  assert.equal(row['Term 4 Fee'], 150)
  assert.equal(row['Term 4 Amount Paid'], 150)
  m = (await portal(lee, 'money', { fresh: true })).data.money
  assert.equal(m.players.find((p) => p.rowId === j).status, 'session', 'stays pink after paying')
})

await test('half term: add a player for 5 weeks at A$425, the family sees those 5 sessions only', async () => {
  const pr = (await portal(lee, 'pricing')).data
  assert.ok(pr.products.some((x) => x.key === 'halfTerm' && x.cents === 42500), 'in Paying for, A$425')
  const add = await portal(lee, 'addPlayer', { groupId: TUE420, force: true, player: { name: 'Hal Half' }, parent: { name: 'Hal Parent', email: 'half@example.com', mobile: '0400999111' }, payment: 'link', product: 'halfTerm', sendEmail: true })
  assert.equal(add.status, 200, JSON.stringify(add.data))
  const f = (await at()).term4.find((r) => r.id === add.data.rowId).fields
  assert.equal(f['Term 4 Fee'], 425)
  assert.equal(f['Term 4 Payment Type'], 'JFP Half term (5 weeks)')
  const c = client()
  await signIn(c, 'half@example.com')
  const acc = (await c.call('/api/jfp-account', { action: 'overview' })).data
  assert.equal(acc.players[0].enrolments[0].dates.length, 5)
  assert.match(acc.todo[0].what, /Half term, 5 sessions from/)
  assert.equal(acc.todo[0].amountLabel, 'A$425')
})

await test('note for coaches + a later start: coaches see it on the register and program; the family sees dates from that week', async () => {
  const add = await portal(lee, 'addPlayer', { groupId: TUE420, force: true, player: { name: 'Wren Weekthree' }, parent: { name: 'Wren Parent', email: 'week3@example.com', mobile: '0400888111' }, payment: 'none' })
  assert.equal(add.status, 200, JSON.stringify(add.data))
  const pr = (await portal(lee, 'pricing')).data
  const wk3 = pr.datesByDay.Tuesday[2].iso
  const set = await portal(lee, 'setCoachNote', { rowId: add.data.rowId, text: 'Back from a broken wrist, no goalkeeping', startDate: wk3 })
  assert.equal(set.status, 200, JSON.stringify(set.data))
  assert.match((await at()).term4.find((r) => r.id === add.data.rowId).fields['Term 4 Notes'], new RegExp(`\\[STARTS:${wk3}\\]`))
  const sam = client(); await signIn(sam, 'jonerfootballsam@gmail.com', 'staff')
  const reg = (await portal(sam, 'coachSessions')).data.sessions.find((x) => x.id === TUE420)
  const p = reg.players.find((x) => x.rowId === add.data.rowId)
  assert.equal(p.note, 'Back from a broken wrist, no goalkeeping')
  assert.match(p.startsLabel, /week 3/)
  const prog = (await portal(sam, 'program')).data.groups.find((g) => g.id === TUE420).players.find((x) => x.name === 'Wren Weekthree')
  assert.equal(prog.startsFrom, wk3)
  const fam = client(); await signIn(fam, 'week3@example.com')
  const en = (await fam.call('/api/jfp-account', { action: 'overview' })).data.players[0].enrolments[0]
  assert.equal(en.firstDate, pr.datesByDay.Tuesday[2].label, 'first session is week 3')
  assert.ok(!JSON.stringify(await fam.call('/api/jfp-account', { action: 'overview' })).includes('broken wrist'), 'families never see the coach note')
  // Clearing it.
  assert.equal((await portal(lee, 'setCoachNote', { rowId: add.data.rowId, text: '', startDate: '' })).status, 200)
  const again = (await portal(sam, 'coachSessions')).data.sessions.find((x) => x.id === TUE420).players.find((x) => x.rowId === add.data.rowId)
  assert.equal(again.note, '')
  assert.equal(again.startsFrom, '')
})

await test('marked paid by hand (A$800 cash, never in the ledger): record how it was paid, never twice', async () => {
  const add = await portal(lee, 'addPlayer', { groupId: TUE420, force: true, player: { name: 'Nico Cashman' }, parent: { name: 'Nico Parent', email: 'cash@example.com', mobile: '0400777999' }, payment: 'none' })
  const id = add.data.rowId
  await fetch(`${B}/__patch?table=term4&id=${id}&fields=${encodeURIComponent(JSON.stringify({ 'Term 4 Fee': 800, 'Term 4 Amount Paid': 800, 'Term 4 Payment Status': 'Paid' }))}`)
  await fetch(`${B}/__kv?cmd=${encodeURIComponent(JSON.stringify(['SET', 'jfp:roster-cleared', String(Date.now())]))}`)
  let m = (await portal(lee, 'money', { fresh: true })).data.money
  const before = m.kpis.cashCents
  const p = m.players.find((x) => x.rowId === id)
  assert.equal(p.unledgeredCents, 80000)
  assert.equal(p.owingCents, 0)
  const plain = await portal(lee, 'recordPayment', { rowIds: [id], amountCents: 80000, method: 'cash' })
  assert.equal(plain.status, 400, 'adding it again is refused')
  const r = await portal(lee, 'recordPayment', { rowIds: [id], amountCents: 80000, method: 'cash', existing: true, note: 'paid at the first session' })
  assert.equal(r.status, 200, JSON.stringify(r.data))
  const row = (await at()).term4.find((x) => x.id === id).fields
  assert.equal(row['Term 4 Amount Paid'], 800, 'still A$800, not A$1,600')
  const lines = (await at()).ledger.filter((l) => l.fields['Source Record ID'] === id)
  assert.equal(lines.length, 1)
  assert.equal(lines[0].fields['Payment Method'], 'Cash')
  m = (await portal(lee, 'money', { fresh: true })).data.money
  assert.equal(m.kpis.cashCents, before + 80000, 'now in the Cash total')
  assert.equal(m.players.find((x) => x.rowId === id).unledgeredCents, 0)
  assert.equal((await portal(lee, 'recordPayment', { rowIds: [id], amountCents: 80000, method: 'cash', existing: true })).status, 400, 'never twice')
})

await test('a flood of parallel code guesses still gets only five tries', async () => {
  const c = client()
  const s = await c.call('/api/jfp-auth', { action: 'start', email: 'flood@example.com', audience: 'parent' })
  const code = await codeFor('flood@example.com')
  const wrong = Array.from({ length: 12 }, (_, i) => String((Number(code) + i + 1) % 1000000).padStart(6, '0'))
  await Promise.all(wrong.map((w) => c.call('/api/jfp-auth', { action: 'verify', challenge: s.data.challenge, code: w })))
  assert.equal((await c.call('/api/jfp-auth', { action: 'verify', challenge: s.data.challenge, code })).status, 401)
})

await test('an offer is made once, and an unpaid offer gives the place back after 7 days', async () => {
  const ap = client()
  await gate(ap)
  await signIn(ap, 'offer@example.com')
  const req = await ap.call('/api/jfp-book', { action: 'request', kind: 'application', groupId: FRI400, players: [{ name: 'Ollie Offer', dob: '2018-06-06' }], parentName: 'Olga Offer', mobile: '0400121212' })
  const first = await portal(lee, 'decideRequest', { id: req.data.id, decision: 'offer', sendEmail: false })
  assert.equal(first.status, 200)
  assert.equal((await portal(lee, 'decideRequest', { id: req.data.id, decision: 'offer', sendEmail: false })).status, 409, 'no second offer')
  // Pretend 8 days have passed.
  await fetch(`${B}/__kv?cmd=${encodeURIComponent(JSON.stringify(['GET', `jfp:payreq:${first.data.payreq.id}`]))}`)
  const q = JSON.parse(await (await fetch(`${B}/__kv?cmd=${encodeURIComponent(JSON.stringify(['GET', `jfp:payreq:${first.data.payreq.id}`]))}`)).text())
  q.expiresAt = new Date(Date.now() - 86400000).toISOString()
  await fetch(`${B}/__kv?cmd=${encodeURIComponent(JSON.stringify(['SET', `jfp:payreq:${first.data.payreq.id}`, JSON.stringify(q)]))}`)
  await portal(lee, 'board')
  const row = (await at()).term4.find((r) => r.fields['Player Name'] === 'Ollie Offer')
  assert.equal(row.fields['Term 4 Confirmation'], 'Dropped', 'the place goes back')
  assert.equal((await ap.call('/api/jfp-account', { action: 'overview' })).data.todo.length, 0)
})

await test('editing a group moves its players in Airtable; ages and modes reach the parent page', async () => {
  const g = (await portal(lee, 'groups')).data.groups.find((x) => x.id === TUE525)
  const r = await portal(lee, 'saveGroup', { id: g.id, group: { ...g, time: '5:30pm', minAge: 11, maxAge: 14, ageStatus: 'confirmed', girlsOnly: 'yes' } })
  assert.equal(r.status, 200, JSON.stringify(r.data))
  assert.equal(r.data.group.id, 'tue-1730-belrose-hq')
  assert.ok(r.data.movedPlayers >= 5)
  const a = await at()
  assert.equal(a.term4.filter((x) => x.fields['Term 3 Time'] === '5:25pm' && x.fields['Term 3 Day'] === 'Tuesday' && x.fields['Term 4 Confirmation'] !== 'Dropped').length, 0, 'everyone holding a place moved; removed players keep their history')
  const c = client()
  await gate(c)
  const pub = (await groupsPublic(c)).find((x) => x.id === 'tue-1730-belrose-hq')
  assert.equal(pub.minAge, 11)
  assert.equal(pub.girlsOnly, true)
})

// ---------- round 2: trials, pro rata, coach groups, link changes ----------

const pricingNow = async () => (await portal(lee, 'pricing')).data

await test('an application from outside the age band is taken, with the group\'s questions answered', async () => {
  const ap = client()
  await gate(ap)
  await signIn(ap, 'trial@example.com')
  const direct = await ap.call('/api/jfp-book', { action: 'request', kind: 'application', groupId: TUE420, players: [{ name: 'Old Enough', dob: '2010-02-02' }], parentName: 'Tara Trial', mobile: '0400313131', answers: { club: 'Ryde Saints', team: 'U16 Div 2' } })
  assert.equal(direct.status, 200, 'a Book now group takes an application from a player outside its band')
  const req = await ap.call('/api/jfp-book', { action: 'request', kind: 'application', groupId: FRI400, players: [{ name: 'Theo Trial', dob: '2012-02-02', emergencyName: 'Tom Trial', emergencyPhone: '0400313132' }], parentName: 'Tara Trial', mobile: '0400313131', answers: { club: 'Gladesville Ravens', team: 'U14', playingUp: 'Playing up', nonsense: 'x' }, waiver: { ...WAIVER, signature: 'Tara Trial' } })
  assert.equal(req.status, 200, JSON.stringify(req.data))
  const r = (await portal(lee, 'requests')).data.requests.find((x) => x.id === req.data.id)
  assert.deepEqual(r.answers, { club: 'Gladesville Ravens', team: 'U14', playingUp: 'Playing up' }, 'only the questions the group asks are kept')
  globalThis.trialReq = req.data.id
})

await test('trial first: A$85 holds the place, then the rest of the term pro rata with the trial taken off', async () => {
  const pr = await pricingNow()
  const fri = pr.datesByDay.Friday
  const t = await portal(lee, 'decideRequest', { id: globalThis.trialReq, decision: 'trial', startDate: fri[0].iso })
  assert.equal(t.status, 200, JSON.stringify(t.data))
  assert.equal(t.data.payreq.amountLabel, 'A$85')
  let row = (await at()).term4.find((x) => x.fields['Player Name'] === 'Theo Trial')
  assert.equal(row.fields['Term 4 Payment Type'], 'JFP Trial')
  assert.equal(row.fields['Term 4 Confirmation'], 'Awaiting Reply')
  assert.ok((await emails()).some((e) => e.to.includes('trial@example.com') && /^Trial: Friday 4pm/.test(e.subject)))
  const fam = client()
  await signIn(fam, 'trial@example.com')
  const acc = (await fam.call('/api/jfp-account', { action: 'overview' })).data
  const todo = acc.todo.find((x) => x.reason === 'trial')
  assert.match(todo.what, /Trial session/)
  assert.equal(todo.needsWaiver, false, 'the waiver signed with the application is on file')
  const pay = await fam.call('/api/jfp-account', { action: 'pay', payreqId: todo.id })
  assert.equal(pay.status, 200, JSON.stringify(pay.data))
  await stripe(pay.data.url, 'pay')
  row = (await at()).term4.find((x) => x.fields['Player Name'] === 'Theo Trial')
  assert.equal(row.fields['Term 4 Confirmation'], 'Confirmed')
  assert.equal(row.fields['Term 4 Amount Paid'], 85)
  // Good trial: the rest of the term from week 4, trial off.
  const week4 = fri[3].iso
  const term = await portal(lee, 'offerTerm', { rowId: row.id, startDate: week4, creditTrial: true, sendEmail: true })
  assert.equal(term.status, 200, JSON.stringify(term.data))
  const expected = Math.round((45000 * 7) / 10 / 100) * 100 - 8500
  assert.equal(term.data.payreq.amountLabel, `A$${expected / 100}`, 'Pathway A$450 x 7/10, less the A$85 trial')
  row = (await at()).term4.find((x) => x.fields['Player Name'] === 'Theo Trial')
  assert.equal(row.fields['Term 4 Fee'], (expected + 8500) / 100)
  assert.equal(row.fields['Term 4 Payment Type'], 'JFP Pathway 10 weeks')
  assert.ok((await emails()).some((e) => e.to.includes('trial@example.com') && /the rest of Term 4/.test(e.subject)))
  const acc2 = (await fam.call('/api/jfp-account', { action: 'overview' })).data
  const pay2 = await fam.call('/api/jfp-account', { action: 'pay', payreqId: acc2.todo.find((x) => x.reason === 'term-after-trial').id })
  await stripe(pay2.data.url, 'pay')
  row = (await at()).term4.find((x) => x.fields['Player Name'] === 'Theo Trial')
  assert.equal(row.fields['Term 4 Payment Status'], 'Paid')
  assert.equal(row.fields['Term 4 Amount Paid'], (expected + 8500) / 100)
})

await test('morning squads split by coach: each coach has their own places, and the Coach column decides', async () => {
  const d = await mk({ day: 'Thursday', time: '6:30am', location: 'NTRA', coachId: 'dean', byCoach: true, capacity: 8, mode: 'application', label: 'Squad' })
  const s2 = await mk({ day: 'Thursday', time: '6:30am', location: 'NTRA', coachId: 'sam', byCoach: true, capacity: 2, mode: 'direct', label: 'Squad', minAge: 8, maxAge: 16 })
  assert.equal(d, 'thu-0630-ntra-dean')
  // A group added at a split session becomes that coach's own group (Dean, 12 Oct).
  const extra = await portal(lee, 'saveGroup', { group: { day: 'Thursday', time: '6:30am', location: 'NTRA', coachId: 'lee', capacity: 8, mode: 'application' } })
  assert.equal(extra.status, 200); assert.equal(extra.data.group.id, 'thu-0630-ntra-lee', 'an extra coach at a split session gets their own group')
  assert.equal((await portal(lee, 'saveGroup', { group: { day: 'Thursday', time: '6:30am', location: 'NTRA', coachId: 'dean', capacity: 8, mode: 'application' } })).status, 409, 'a coach never gets two groups at one session')
  assert.equal((await portal(lee, 'deleteGroup', { id: 'thu-0630-ntra-lee' })).status, 200)
  for (const [gid, name] of [[d, 'Dee One'], [s2, 'Sam One'], [s2, 'Sam Two']]) assert.equal((await portal(lee, 'addPlayer', { groupId: gid, player: { name }, parent: { name: 'Co Parent' }, payment: 'none' })).status, 200)
  const b = (await portal(lee, 'board')).data
  assert.deepEqual(b.groups.find((g) => g.id === d).players.map((p) => p.name), ['Dee One'])
  assert.deepEqual(b.groups.find((g) => g.id === s2).players.map((p) => p.name).sort(), ['Sam One', 'Sam Two'])
  const c = client()
  await gate(c)
  const pub = await groupsPublic(c)
  assert.equal(pub.find((g) => g.id === s2).full, true, 'Coach Sam is booked out')
  assert.equal(pub.find((g) => g.id === d).placesLeft, 7, 'Coach Dean still has places')
  const moved = await portal(lee, 'movePlayer', { rowId: b.groups.find((g) => g.id === s2).players[0].rowId, toGroupId: d })
  assert.equal(moved.status, 200)
  const b2 = (await portal(lee, 'board')).data
  assert.equal(b2.groups.find((g) => g.id === d).players.length, 2, 'a move rewrites the Coach column')
})

await test('an open link can change amount: same link, the open Stripe page is closed first', async () => {
  const add = await portal(lee, 'addPlayer', { groupId: TUE420, force: true, player: { name: 'Cam Change' }, parent: { name: 'Cara Change', email: 'change@example.com', mobile: '0400616161' }, payment: 'link', product: 'group', sendEmail: false })
  assert.equal(add.status, 200, JSON.stringify(add.data))
  const fam = client()
  await signIn(fam, 'change@example.com')
  let acc = (await fam.call('/api/jfp-account', { action: 'overview', pay: add.data.payreq.id })).data
  await fam.call('/api/jfp-account', { action: 'signWaiver', players: acc.players.map((p) => ({ key: p.key, dob: '2015-05-05', emergencyName: 'E C', emergencyPhone: '0400616162' })), waiver: WAIVER, parentName: 'Cara Change', mobile: '0400616161' })
  const pay = await fam.call('/api/jfp-account', { action: 'pay', payreqId: add.data.payreq.id })
  assert.equal(pay.status, 200)
  const ch = await portal(lee, 'changePayreqAmount', { id: add.data.payreq.id, amountCents: 60000 })
  assert.equal(ch.status, 200, JSON.stringify(ch.data))
  assert.equal(ch.data.url, add.data.payreq.url, 'the link stays the same')
  const sessions = await (await fetch(`${B}/__sessions`)).json()
  assert.equal(sessions.find((x) => pay.data.url.includes(x.id)).status, 'expired', 'the old payment page is closed')
  acc = (await fam.call('/api/jfp-account', { action: 'overview' })).data
  assert.equal(acc.todo[0].amountLabel, 'A$600')
  const list = (await portal(lee, 'payments')).data.payreqs.find((q) => q.id === add.data.payreq.id)
  assert.equal(list.views, 1, 'staff see the family opened the link')
  assert.equal((await at()).term4.find((r) => r.id === add.data.rowId).fields['Term 4 Fee'], 600)
})

await test('coaches see the whole program with names and ages, never money', async () => {
  const dean = client()
  await signIn(dean, 'jonerfootballdean@gmail.com', 'staff')
  const r = await portal(dean, 'program')
  assert.equal(r.status, 200)
  assert.ok(r.data.groups.some((g) => g.coachId === 'sam') && r.data.groups.some((g) => g.mine))
  assert.ok(!/@|0400|Paid|850|parent|fee/i.test(JSON.stringify(r.data)), 'no money or contact details')
  assert.equal((await portal(dean, 'pricing')).status, 403)
})

await test('joining during the term: pro rata for the sessions left, siblings at the two place rate', async () => {
  const cfg = (await portal(lee, 'getSettings')).data.config
  await portal(lee, 'saveSettings', { config: { ...cfg, termStart: '2026-09-07' } })
  const g = await mk({ day: 'Monday', time: '4:20pm', location: 'Belrose HQ', coachId: 'dean', capacity: 6, mode: 'direct', minAge: 8, maxAge: 12 })
  const pr = await pricingNow()
  // A session that has already started today no longer counts (the booking
  // code's rule), so the test uses the same clock: Sydney time against 4:20pm.
  const syd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date())
  const part = (t) => syd.find((x) => x.type === t).value
  const todayIso = `${part('year')}-${part('month')}-${part('day')}`
  const startedToday = Number(part('hour')) * 60 + Number(part('minute')) >= 16 * 60 + 20
  const left = pr.datesByDay.Monday.filter((x) => x.iso > todayIso || (x.iso === todayIso && !startedToday)).length
  assert.ok(left > 0 && left < 10)
  const one = Math.round((85000 * left) / 10 / 100) * 100
  const each = Math.round((75000 * left) / 10 / 100) * 100
  const mum = client()
  await gate(mum)
  await signIn(mum, 'prorata@example.com')
  const hold = await mum.call('/api/jfp-book', { action: 'reserve', groupId: g })
  const fam = (await mum.call('/api/jfp-book', { action: 'family', groupId: g })).data
  assert.equal(fam.quote.oneCents, one)
  assert.equal(fam.quote.eachOfTwoCents, each)
  assert.equal(fam.quote.proRata, true)
  const ok = await mum.call('/api/jfp-book', { groupId: g, bookingId: hold.data.bookingId, releaseToken: hold.data.releaseToken, players: [{ name: 'Pia Pro', dob: '2016-01-01', emergencyName: 'P R', emergencyPhone: '0400717171' }, { name: 'Pete Pro', dob: '2017-01-01', emergencyName: 'P R', emergencyPhone: '0400717171' }], waiver: WAIVER, parentName: 'Pru Pro', mobile: '0400717171', agreementAccepted: true, kit: 'ordered' })
  assert.equal(ok.status, 200, JSON.stringify(ok.data))
  await stripe(ok.data.url, 'pay')
  const rows = (await at()).term4.filter((r) => /^P\w+ Pro$/.test(r.fields['Player Name']))
  assert.equal(rows.length, 2)
  for (const r of rows) {
    assert.equal(r.fields['Term 4 Fee'], each / 100)
    assert.equal(r.fields['Term 4 Payment Type'], 'Sibling / 2 sessions per week')
    assert.match(r.fields['Term 4 Notes'], /pro rata/)
  }
  await portal(lee, 'saveSettings', { config: { ...cfg, termStart: '2026-10-12' } })
})

await test('after paying a link: a thank you page that points to the training kit', async () => {
  const cfg = (await portal(lee, 'getSettings')).data.config
  assert.equal((await portal(lee, 'saveSettings', { config: { ...cfg, kitUrl: 'https://kit.example.com/joner' } })).status, 200)
  const add = await portal(lee, 'addPlayer', { groupId: WED420, force: true, player: { name: 'Kit Kid', dob: '2015-01-01' }, parent: { name: 'Kim Kit', email: 'kit@example.com', mobile: '0400818181' }, payment: 'link', sendEmail: true })
  assert.equal(add.status, 200)
  const mail = (await emails()).find((e) => e.to.includes('kit@example.com') && /place/.test(e.subject))
  assert.ok(mail.html.includes(add.data.payreq.url.replace(/&/g, '&amp;')) || mail.html.includes(add.data.payreq.url), 'the email links straight to this payment')
  const fam = client()
  await signIn(fam, 'kit@example.com')
  const acc = (await fam.call('/api/jfp-account', { action: 'overview', pay: add.data.payreq.id })).data
  await fam.call('/api/jfp-account', { action: 'signWaiver', players: acc.players.map((p) => ({ key: p.key, dob: '2015-01-01', emergencyName: 'K K', emergencyPhone: '0400818182' })), waiver: WAIVER, parentName: 'Kim Kit', mobile: '0400818181' })
  const pay = await fam.call('/api/jfp-account', { action: 'pay', payreqId: add.data.payreq.id })
  const back = new URL((await stripe(pay.data.url, 'pay')).headers.get('location'))
  assert.equal(back.pathname, '/jfp-booking/success/')
  const conf = (await fam.call(`/api/jfp-confirm?session_id=${back.searchParams.get('session_id')}`)).data
  assert.equal(conf.status, 'paid')
  assert.equal(conf.kit.url, 'https://kit.example.com/joner')
  assert.equal((await at()).term4.find((r) => r.id === add.data.rowId).fields['Term 4 Confirmation'], 'Confirmed', 'paid locks the place in')
})

await test('removing a player who has paid keeps their row as Dropped, with the reason and contact saved', async () => {
  const kid = (await at()).term4.find((r) => r.fields['Player Name'] === 'Kit Kid')
  const rm = await portal(lee, 'removePlayer', { rowId: kid.id, reason: 'Injury', details: 'Broken wrist' })
  assert.equal(rm.status, 200, JSON.stringify(rm.data))
  assert.equal(rm.data.kept, true)
  const row = (await at()).term4.find((r) => r.id === kid.id)
  assert.equal(row.fields['Term 4 Confirmation'], 'Dropped', 'the paid row stays for the takings')
  assert.ok((await at()).dropped.some((d) => d.fields['Source Term 4 Record ID'] === kid.id && d.fields['Reason for leaving'] === 'Injury'))
  const list = (await portal(lee, 'removed')).data.players.filter((p) => p.name === 'Kit Kid')
  assert.equal(list.length, 1, 'listed once, not twice')
  const back = await portal(lee, 'restorePlayer', { droppedId: list[0].droppedId, force: true })
  assert.equal(back.status, 200, JSON.stringify(back.data))
  assert.equal(back.data.rowId, kid.id, 'the same row comes back')
  assert.equal((await at()).term4.find((r) => r.id === kid.id).fields['Term 4 Confirmation'], 'Confirmed')
})

await test('a price-list link takes off what is already paid, and a cancelled link puts the row back', async () => {
  const add = await portal(lee, 'addPlayer', { groupId: TUE420, force: true, player: { name: 'Half Paid' }, parent: { name: 'Hal Paid', email: 'half@example.com', mobile: '0400919191' }, payment: 'none' })
  await portal(lee, 'markPaid', { rowId: add.data.rowId, amountCents: 42500, method: 'Cash' })
  const before = (await at()).term4.find((r) => r.id === add.data.rowId).fields
  const link = await portal(lee, 'sendPaymentLink', { rowId: add.data.rowId, product: 'group', startDate: '2026-10-13', sendEmail: false })
  assert.equal(link.data.payreq.amountLabel, 'A$425', 'A$850 less the A$425 already paid')
  assert.equal((await at()).term4.find((r) => r.id === add.data.rowId).fields['Term 4 Fee'], 850)
  assert.equal((await portal(lee, 'cancelPayreq', { id: link.data.payreq.id })).status, 200)
  const after = (await at()).term4.find((r) => r.id === add.data.rowId).fields
  assert.equal(after['Term 4 Fee'], before['Term 4 Fee'])
  assert.equal(after['Term 4 Payment Type'], before['Term 4 Payment Type'])
})

await test('one open link per player: a second needs replace, and a declined offer closes its link', async () => {
  const add = await portal(lee, 'addPlayer', { groupId: TUE420, force: true, player: { name: 'Two Links' }, parent: { name: 'Tia Links', email: 'links@example.com', mobile: '0400929292' }, payment: 'link', sendEmail: false })
  const again = await portal(lee, 'sendPaymentLink', { rowId: add.data.rowId, product: 'group', sendEmail: false })
  assert.equal(again.status, 409)
  assert.equal(again.data.code, 'link_open')
  const replaced = await portal(lee, 'sendPaymentLink', { rowId: add.data.rowId, product: 'group', sendEmail: false, replace: true })
  assert.equal(replaced.status, 200, JSON.stringify(replaced.data))
  const open = (await portal(lee, 'payments')).data.payreqs.filter((q) => q.term4Ids.includes(add.data.rowId) && ['open', 'checkout'].includes(q.status))
  assert.equal(open.length, 1, 'only the new link is open')
  assert.equal((await portal(lee, 'addPlayer', { groupId: TUE420, force: true, player: { name: 'No Amount' }, parent: { name: 'N A' }, payment: 'offline' })).status, 400, 'paid offline needs an amount')
  // an offered application, then declined: the link closes and the place goes back
  const ap = client()
  await gate(ap)
  await signIn(ap, 'decline@example.com')
  const req = await ap.call('/api/jfp-book', { action: 'request', kind: 'application', groupId: FRI400, players: [{ name: 'Dee Cline', dob: '2017-01-01' }], parentName: 'Dora Cline', mobile: '0400939393', answers: { club: 'X FC', team: 'U9' } })
  const offer = await portal(lee, 'decideRequest', { id: req.data.id, decision: 'offer', sendEmail: false })
  assert.equal(offer.status, 200)
  const no = await portal(lee, 'decideRequest', { id: req.data.id, decision: 'decline', sendEmail: true, message: 'Try Saturday' })
  assert.equal(no.status, 200, JSON.stringify(no.data))
  assert.equal((await portal(lee, 'payments')).data.payreqs.find((q) => q.id === offer.data.payreq.id).status, 'cancelled')
  assert.equal((await at()).term4.find((r) => r.fields['Player Name'] === 'Dee Cline').fields['Term 4 Confirmation'], 'Dropped', 'the held place is given back')
  assert.ok((await emails()).some((e) => e.to.includes('decline@example.com') && /Your JFP application/.test(e.subject)))
  assert.equal((await ap.call('/api/jfp-account', { action: 'overview' })).data.todo.length, 0, 'nothing left to pay')
})

await test('a refund made in Stripe updates the Term 4 row and the ledger, once', async () => {
  const add = await portal(lee, 'addPlayer', { groupId: TUE420, force: true, player: { name: 'Ref Und', dob: '2015-02-02' }, parent: { name: 'Rae Und', email: 'refund@example.com', mobile: '0400949494' }, payment: 'link', sendEmail: false })
  const fam = client()
  await signIn(fam, 'refund@example.com')
  const acc = (await fam.call('/api/jfp-account', { action: 'overview' })).data
  await fam.call('/api/jfp-account', { action: 'signWaiver', players: acc.players.map((p) => ({ key: p.key, dob: '2015-02-02', emergencyName: 'R U', emergencyPhone: '0400949495' })), waiver: WAIVER, parentName: 'Rae Und', mobile: '0400949494' })
  const pay = await fam.call('/api/jfp-account', { action: 'pay', payreqId: add.data.payreq.id })
  const back = new URL((await stripe(pay.data.url, 'pay')).headers.get('location'))
  const sid = back.searchParams.get('session_id')
  const r = await (await fetch(`${B}/__refund?cs=${sid}&amount=42500&twice=1`)).json()
  assert.ok(r.ok)
  const row = (await at()).term4.find((x) => x.id === add.data.rowId)
  assert.equal(row.fields['Term 4 Amount Paid'], 425, 'half refunded, applied once even though Stripe sent it twice')
  assert.equal(row.fields['Term 4 Payment Status'], 'Partially Paid')
  const ledger = (await at()).ledger.filter((x) => x.fields['Payment ID'] === r.refund.id)
  assert.equal(ledger.length, 1)
  assert.equal(ledger[0].fields['Amount Paid'], -425)
  assert.ok((await emails()).some((e) => /JFP refund recorded: Ref Und/.test(e.subject)))
  assert.ok((await portal(lee, 'audit')).data.entries.some((e) => e.action === 'payment.refund' && e.target === add.data.payreq.id))
})

await test('next term: invite, hold the place for the fee, then pay the rest; not returning is recorded', async () => {
  const set = await portal(lee, 'saveNextTerm', { nextTerm: { name: 'Term 1 2027', holdCents: 10000, open: false } })
  assert.equal(set.status, 200)
  const add = await portal(lee, 'addPlayer', { groupId: TUE420, force: true, player: { name: 'Nex Term', dob: '2015-04-04' }, parent: { name: 'Nia Term', email: 'next@example.com', mobile: '0400959595' }, payment: 'offline', amountCents: 85000, method: 'Cash' })
  const add2 = await portal(lee, 'addPlayer', { groupId: TUE420, force: true, player: { name: 'Nop Term', dob: '2014-04-04' }, parent: { name: 'Nia Term', email: 'next@example.com', mobile: '0400959595' }, payment: 'offline', amountCents: 85000, method: 'Cash' })
  const fam = client()
  await signIn(fam, 'next@example.com')
  assert.equal((await fam.call('/api/jfp-account', { action: 'overview' })).data.nextTerm, null, 'nothing shows before an invite')
  const inv = await portal(lee, 'nextTermInvite', { rowIds: [add.data.rowId, add2.data.rowId], sendEmail: true })
  assert.equal(inv.status, 200, JSON.stringify(inv.data))
  assert.equal(inv.data.emailed, 1, 'one email per family')
  assert.ok((await emails()).some((e) => e.to.includes('next@example.com') && /Keep your place for Term 1 2027/.test(e.subject)))
  let acc = (await fam.call('/api/jfp-account', { action: 'overview' })).data
  assert.equal(acc.nextTerm.players.length, 2)
  await fam.call('/api/jfp-account', { action: 'signWaiver', players: acc.players.map((p) => ({ key: p.key, dob: '2015-04-04', emergencyName: 'N T', emergencyPhone: '0400959596' })), waiver: WAIVER, parentName: 'Nia Term', mobile: '0400959595' })
  const hold = await fam.call('/api/jfp-account', { action: 'nextTermChoice', rowId: add.data.rowId, choice: 'hold' })
  assert.equal(hold.status, 200, JSON.stringify(hold.data))
  const pay = await fam.call('/api/jfp-account', { action: 'pay', payreqId: hold.data.payreqId })
  assert.equal(pay.status, 200, JSON.stringify(pay.data))
  await stripe(pay.data.url, 'pay')
  let row = (await at()).nextHolds.find((r) => r.fields['Source Term 4 Record ID'] === add.data.rowId)
  assert.equal(row.fields['Status'], 'Held')
  assert.equal(row.fields['Amount Paid'], 100)
  assert.equal((await at()).term4.find((r) => r.id === add.data.rowId).fields['Term 4 Amount Paid'], 850, 'Term 4 row untouched')
  assert.ok((await at()).ledger.some((r) => r.fields['Term'] === 'Term 1 2027' && r.fields['Amount Paid'] === 100))
  const rest = await fam.call('/api/jfp-account', { action: 'nextTermChoice', rowId: add.data.rowId, choice: 'full' })
  const pay2 = await fam.call('/api/jfp-account', { action: 'pay', payreqId: rest.data.payreqId })
  assert.match((await fam.call('/api/jfp-account', { action: 'overview' })).data.todo.find((t) => t.id === rest.data.payreqId).amountLabel, /A\$750/, 'the rest is the full term less the hold')
  await stripe(pay2.data.url, 'pay')
  row = (await at()).nextHolds.find((r) => r.fields['Source Term 4 Record ID'] === add.data.rowId)
  assert.equal(row.fields['Status'], 'Paid in full')
  assert.equal(row.fields['Amount Paid'], 850)
  const no = await fam.call('/api/jfp-account', { action: 'nextTermChoice', rowId: add2.data.rowId, choice: 'no' })
  assert.equal(no.status, 200)
  assert.equal((await at()).nextHolds.find((r) => r.fields['Source Term 4 Record ID'] === add2.data.rowId).fields['Status'], 'Not returning')
  const board = (await portal(lee, 'nextTerm')).data.totals
  assert.equal(board.paid, 1)
  assert.equal(board.no, 1)
})

await test('round 7: sibling rate only with a paid sibling in Airtable; show as fully booked; decline with several suggestions', async () => {
  const SAT9 = await mk({ day: 'Saturday', time: '9am', location: 'Belrose HQ', coachId: 'sage', capacity: 6, mode: 'application', minAge: 8, maxAge: 14 })
  const rita = client()
  await gate(rita)
  await signIn(rita, 'returning@example.com')
  const req = await rita.call('/api/jfp-book', { action: 'request', kind: 'application', groupId: SAT9, players: [{ name: 'Milo Returning', dob: '2017-05-05', emergencyName: 'Rita Returning', emergencyPhone: '0400000003' }], parentName: 'Rita Returning', mobile: '0400000003', answers: { club: 'Test FC', team: 'U9' }, waiver: WAIVER })
  assert.equal(req.status, 200, JSON.stringify(req.data))
  const r = (await portal(lee, 'requests')).data.requests.find((x) => x.id === req.data.id)
  assert.ok(r.siblings.map((x) => x.name).includes('Riley Returning'), 'Riley has a paid place, so Milo is a sibling')
  const offer = await portal(lee, 'decideRequest', { id: r.id, decision: 'offer', product: 'sibling', sendEmail: false })
  assert.equal(offer.status, 200, JSON.stringify(offer.data))
  assert.match(offer.data.payreq.amountLabel, /650/, 'second child pays the sibling rate')
  // A family with no paid child cannot get it, whatever the request says.
  const stranger = client()
  await gate(stranger)
  await signIn(stranger, 'nosibling@example.com')
  const req2 = await stranger.call('/api/jfp-book', { action: 'request', kind: 'application', groupId: SAT9, players: [{ name: 'Fake Sibling', dob: '2016-01-01', emergencyName: 'N S', emergencyPhone: '0400000004' }], parentName: 'No Sibling', mobile: '0400000004', answers: { club: 'X', team: 'Y' }, waiver: WAIVER, message: 'My other child trains with you, sibling rate please' })
  assert.equal(req2.status, 200)
  const r2 = (await portal(lee, 'requests')).data.requests.find((x) => x.id === req2.data.id)
  assert.deepEqual(r2.siblings, [])
  assert.equal((await portal(lee, 'decideRequest', { id: r2.id, decision: 'offer', product: 'sibling', sendEmail: false })).status, 400, 'no sibling rate without a paid sibling')
  // Decline with two suggestions: both are in the email.
  const dec = await portal(lee, 'decideRequest', { id: r2.id, decision: 'decline', suggestGroupIds: [TUE420, WED420], sendEmail: true })
  assert.equal(dec.status, 200)
  const mail = (await emails()).filter((e) => e.to.includes('nosibling@example.com')).at(-1)
  assert.match(mail.html, /Tuesday 4:20pm/)
  assert.match(mail.html, /Wednesday 4:20pm/)
  // Show as fully booked: families see full and cannot hold a place; staff still see the real count.
  const g = (await portal(lee, 'groups')).data.groups.find((x) => x.id === WED420)
  assert.equal((await portal(lee, 'saveGroup', { id: WED420, group: { ...g, capacity: 30, showFull: true } })).status, 200)
  const pub = (await groupsPublic(rita)).find((x) => x.id === WED420)
  assert.equal(pub.full, true)
  assert.equal(pub.placesLeft, 0)
  assert.equal((await rita.call('/api/jfp-book', { action: 'reserve', groupId: WED420 })).data.code, 'full')
  assert.ok((await portal(lee, 'board')).data.groups.find((x) => x.id === WED420).placesLeft > 0, 'staff can still add players')
  assert.equal((await portal(lee, 'saveGroup', { id: WED420, group: { ...g, showFull: false } })).status, 200)
})

await test('round 8: coach cover and time off, session plans, and inviting current families', async () => {
  const dean = client()
  await signIn(dean, 'jonerfootballdean@gmail.com', 'staff')
  const DEAN_G = 'tue-1730-belrose-hq' // Tuesday 5:25pm, moved to 5:30pm by an earlier check
  const ov = (await portal(dean, 'staffOverview')).data
  const mine = ov.mySessions.find((s) => s.id === DEAN_G)
  assert.ok(mine, 'Dean sees his own sessions to cover')
  assert.ok(!ov.mySessions.some((s) => s.id === TUE420), 'and not Sam\'s')
  assert.equal((await portal(dean, 'requestCover', { groupId: TUE420, date: mine.dates[0].iso, coverCoachId: 'sage' })).status, 403, 'cannot hand over another coach\'s session')
  const cov = await portal(dean, 'requestCover', { groupId: DEAN_G, date: mine.dates[0].iso, coverCoachId: 'sage', note: 'Away' })
  assert.equal(cov.status, 200, JSON.stringify(cov.data))
  assert.equal((await portal(dean, 'requestCover', { groupId: DEAN_G, date: mine.dates[0].iso, coverCoachId: 'sam' })).status, 409, 'one cover per session date')
  // Sage gets the session that week and can take the register.
  const sage = client()
  await signIn(sage, 'sagemelhem@icloud.com', 'staff')
  const ss = (await portal(sage, 'coachSessions')).data.sessions
  const covering = ss.find((s) => s.id === DEAN_G && s.covering)
  assert.ok(covering, 'the cover coach sees the session')
  assert.equal(covering.nextDate, mine.dates[0].iso)
  if (covering.players[0]) assert.equal((await portal(sage, 'markAttendance', { groupId: DEAN_G, date: mine.dates[0].iso, rowId: covering.players[0].rowId, status: 'Present' })).status, 200)
  assert.ok((await portal(dean, 'coachSessions')).data.sessions.find((s) => s.id === DEAN_G).coveredBy.length, 'Dean sees who covers him')
  assert.equal((await portal(sage, 'cancelCover', { id: cov.data.cover.id })).status, 403, 'only the asking coach or admins cancel')
  // Time off: coach asks, only admins decide.
  const off = await portal(dean, 'requestTimeOff', { from: '2026-11-02', to: '2026-11-06', reason: 'Holiday' })
  assert.equal(off.status, 200)
  assert.equal((await portal(dean, 'decideTimeOff', { id: off.data.timeOff.id, status: 'approved' })).status, 403)
  assert.equal((await portal(lee, 'decideTimeOff', { id: off.data.timeOff.id, status: 'approved' })).status, 200)
  assert.equal((await portal(dean, 'staffOverview')).data.timeOff.find((t) => t.id === off.data.timeOff.id).status, 'approved')
  // Session plans: admins write, coaches read.
  assert.equal((await portal(dean, 'savePlans', { plans: { structure: 'x', weeks: [] } })).status, 403)
  assert.equal((await portal(lee, 'savePlans', { plans: { structure: 'Warm up, technique, game.', weeks: [{ title: '1v1 attacking', focus: 'Feints', link: 'https://example.com/w1' }] } })).status, 200)
  const pl = (await portal(dean, 'staffOverview')).data.plans
  assert.equal(pl.weeks[0].title, '1v1 attacking')
  // Families: a preview first, nothing sent; then a real send to one family.
  const before = (await emails()).length
  const fam = (await portal(lee, 'familyInvites')).data
  assert.equal((await emails()).length, before, 'previewing sends nothing')
  assert.ok(fam.list.length > 0)
  assert.equal((await portal(dean, 'familyInvites')).status, 403, 'coaches cannot invite families')
  const payFam = fam.list.find((f) => f.kind === 'pay')
  // A row marked Paid with no amount typed in is never asked to pay.
  const at4 = (await at()).term4
  for (const f of fam.list.filter((x) => x.kind === 'pay')) for (const id of f.owingRowIds) assert.notEqual(at4.find((r) => r.id === id)?.fields['Term 4 Payment Status'], 'Paid')
  assert.ok(fam.previews.pay && /Sign in and pay/.test(fam.previews.pay.html))
  assert.ok(!/—|–/.test(fam.previews.pay.html), 'no long dashes')
  const sent = await portal(lee, 'familyInvites', { send: true, emails: [payFam.email] })
  assert.deepEqual(sent.data.sent, [payFam.email])
  const mail = (await emails()).filter((e) => e.to.includes(payFam.email)).at(-1)
  assert.match(mail.subject, /Your JFP account is ready/)
  assert.match(mail.html, /jfp-account\/\?pay=PAY-/)
  assert.deepEqual((await portal(lee, 'familyInvites', { send: true, emails: [payFam.email] })).data.sent, [], 'not twice unless resend')
})

await test('round 10: no password when switched off; a Book now hour as a group or a 1 to 1 for the term', async () => {
  assert.equal((await portal(lee, 'saveSettings', { config: { passwordRequired: false } })).status, 200)
  const anon = client()
  assert.equal((await anon.call('/api/jfp-groups')).status, 200, 'the timetable is open without the password')
  assert.equal((await anon.call('/api/jfp-access', null, 'GET')).data.ok, true)
  const T730 = await mk({ day: 'Tuesday', time: '7:30am', location: 'Belrose HQ', coachId: 'dean', capacity: 4, mode: 'direct', label: 'Small group', product: 'group', allowOneToOne: true, minAge: 6, maxAge: 19 })
  let g = (await groupsPublic(anon)).find((x) => x.id === T730)
  assert.equal(g.allowOneToOne, true)
  assert.equal(g.oneToOneOpen, true)
  // A family books the hour as a 1 to 1: every place goes.
  const solo = client()
  await signIn(solo, 'solo@example.com')
  const hold = await solo.call('/api/jfp-book', { action: 'reserve', groupId: T730 })
  assert.equal(hold.status, 200, JSON.stringify(hold.data))
  const fam = (await solo.call('/api/jfp-book', { action: 'family', groupId: T730 })).data
  assert.ok(fam.quote.oneToOneCents > fam.quote.oneCents, 'the 1 to 1 term costs more than the group term')
  const pay = await solo.call('/api/jfp-book', { groupId: T730, bookingId: hold.data.bookingId, releaseToken: hold.data.releaseToken, option: 'oneToOne', players: [{ name: 'Solo Player', dob: '2014-04-04', emergencyName: 'S P', emergencyPhone: '0400000005' }], waiver: WAIVER, parentName: 'Solo Parent', mobile: '0400000005', agreementAccepted: true, kit: 'ordered' })
  assert.equal(pay.status, 200, JSON.stringify(pay.data))
  g = (await groupsPublic(anon)).find((x) => x.id === T730)
  assert.equal(g.full, true, 'held as a 1 to 1, the hour is full for everyone else')
  await stripe(pay.data.url, 'pay')
  await new Promise((r) => setTimeout(r, 1500))
  const row = (await at()).term4.find((x) => x.fields['Player Name'] === 'Solo Player')
  assert.ok(row, 'the Term 4 row is written')
  assert.match(row.fields['Term 4 Notes'], /\[JFP-1TO1\]/)
  assert.equal(row.fields['Term 4 Payment Type'], 'JFP 1 on 1, 10 weeks')
  g = (await groupsPublic(anon)).find((x) => x.id === T730)
  assert.equal(g.full, true, 'still full once paid')
  // A second hour: a group booking first means no 1 to 1 after it.
  const T830 = await mk({ day: 'Tuesday', time: '8:30am', location: 'Belrose HQ', coachId: 'dean', capacity: 4, mode: 'direct', label: 'Small group', product: 'group', allowOneToOne: true, minAge: 6, maxAge: 19 })
  const grp = client()
  await signIn(grp, 'grp@example.com')
  const h2 = await grp.call('/api/jfp-book', { action: 'reserve', groupId: T830 })
  const p2 = await grp.call('/api/jfp-book', { groupId: T830, bookingId: h2.data.bookingId, releaseToken: h2.data.releaseToken, option: 'group', players: [{ name: 'Group Player', dob: '2014-05-05', emergencyName: 'G P', emergencyPhone: '0400000006' }], waiver: WAIVER, parentName: 'Group Parent', mobile: '0400000006', agreementAccepted: true, kit: 'ordered' })
  assert.equal(p2.status, 200)
  await stripe(p2.data.url, 'pay')
  await new Promise((r) => setTimeout(r, 1500))
  g = (await groupsPublic(anon)).find((x) => x.id === T830)
  assert.equal(g.placesLeft, 3)
  assert.equal(g.oneToOneOpen, false, 'no 1 to 1 once a group player is booked')
  const late = client()
  await signIn(late, 'late@example.com')
  const h3 = await late.call('/api/jfp-book', { action: 'reserve', groupId: T830 })
  const p3 = await late.call('/api/jfp-book', { groupId: T830, bookingId: h3.data.bookingId, releaseToken: h3.data.releaseToken, option: 'oneToOne', players: [{ name: 'Late Player', dob: '2014-06-06', emergencyName: 'L P', emergencyPhone: '0400000007' }], waiver: WAIVER, parentName: 'Late Parent', mobile: '0400000007', agreementAccepted: true, kit: 'ordered' })
  assert.equal(p3.data.code, 'solo_taken')
})

await test('round 11: money reads Stripe live, records cash and bank transfer, payment history; coaches save planner sessions', async () => {
  const seed = (body) => fetch(`${B}/__stripe-seed`, { method: 'POST', body: JSON.stringify(body) }).then((r) => r.json())
  let m = (await portal(lee, 'money', { fresh: true })).data.money
  const unpaid = m.players.filter((p) => p.status === 'unpaid' && p.email && p.feeCents > 0 && p.paidCents === 0 && m.players.filter((x) => x.email === p.email).length === 1)
  assert.ok(unpaid.length >= 2, 'two unpaid players to work with')
  const [a, b] = unpaid
  // a paid on a JFP payment link; a camp payment and a holiday payment are not JFP.
  const seeded = await seed({ email: a.email, name: a.parent, cents: a.feeCents })
  await seed({ email: 'camp@example.com', cents: 30000, link: 'plink_camp' })
  await seed({ email: 'holiday@example.com', cents: 15000, metadata: { holidayBookingId: 'HOL-1' } })
  m = (await portal(lee, 'money', { fresh: true })).data.money
  assert.equal(m.players.find((p) => p.rowId === a.rowId).status, 'stripe', 'paid in Stripe, not yet in Airtable')
  assert.ok(m.otherStripe.count >= 1, 'the camp payment is left out')
  assert.ok(!m.unmatched.some((u) => u.email === 'holiday@example.com'), 'holiday payments are left out')
  assert.ok(m.kpis.stripeCents >= a.feeCents)
  const hist = (await portal(lee, 'playerPayments', { rowId: a.rowId })).data.player
  assert.equal(hist.stripe.length, 1)
  assert.equal(hist.stripe[0].recorded, false)
  // Record the Stripe payment: Airtable and the ledger; never twice.
  assert.equal((await portal(lee, 'recordPayment', { rowIds: [a.rowId], method: 'Stripe', stripeSessionId: seeded.id })).status, 200)
  assert.equal((await portal(lee, 'recordPayment', { rowIds: [a.rowId], method: 'Stripe', stripeSessionId: seeded.id })).status, 409)
  // b paid cash at the session.
  assert.equal((await portal(lee, 'recordPayment', { rowIds: [b.rowId], method: 'Cash', amountCents: b.feeCents, date: '2026-10-05' })).status, 200)
  const air = await at()
  for (const x of [a, b]) {
    const row = air.term4.find((r) => r.id === x.rowId)
    assert.equal(row.fields['Term 4 Payment Status'], 'Paid')
    assert.equal(row.fields['Term 4 Amount Paid'], x.feeCents / 100)
  }
  assert.ok(air.ledger.some((l) => l.fields['Payment Method'] === 'Cash' && l.fields['Amount Paid'] === b.feeCents / 100))
  assert.ok(air.ledger.some((l) => l.fields['Payment Method'] === 'Stripe' && l.fields['Stripe Checkout Session ID'] === seeded.id))
  m = (await portal(lee, 'money', { fresh: true })).data.money
  assert.equal(m.players.find((p) => p.rowId === a.rowId).status, 'paid')
  assert.equal(m.players.find((p) => p.rowId === b.rowId).status, 'paid')
  assert.ok(m.kpis.cashCents >= b.feeCents)
  assert.ok(m.weekly.length >= 1)
  // Coaches never see money.
  const sam = client()
  await signIn(sam, 'jonerfootballsam@gmail.com', 'staff')
  for (const action of ['money', 'playerPayments', 'recordPayment']) assert.equal((await portal(sam, action, { rowId: a.rowId })).status, 403)
  // Planner: a coach saves, lists and opens their own; another coach cannot.
  const saved = await portal(sam, 'planSave', { title: 'Rondo warm up', plan: { template: 'blank.html', panels: [1, 2, 3] } })
  assert.equal(saved.status, 200)
  assert.deepEqual((await portal(sam, 'planList')).data.plans.map((p) => p.title), ['Rondo warm up'])
  assert.deepEqual((await portal(sam, 'planGet', { id: saved.data.plan.id })).data.plan.onTheGo.panels, [1, 2, 3])
  const deanC = client()
  await signIn(deanC, 'jonerfootballdean@gmail.com', 'staff')
  assert.equal((await portal(deanC, 'planGet', { id: saved.data.plan.id })).status, 404)
  assert.ok((await portal(lee, 'planList')).data.plans.some((p) => p.id === saved.data.plan.id), 'admins see every coach\'s sessions')
})

await test('launch review 2: a waiver counts only with the family email or mobile; earlier-term waivers follow the Settings switch', async () => {
  const rita = client()
  await gate(rita)
  await signIn(rita, 'returning@example.com')
  const on = (await rita.call('/api/jfp-book', { action: 'family' })).data.players.find((p) => p.name === 'Riley Returning')
  assert.equal(on.waiverOnFile, true, 'a Term 3 waiver on the family email counts while carryover is on')
  assert.equal((await portal(lee, 'saveSettings', { config: { waiverCarryover: false } })).status, 200)
  const off = (await rita.call('/api/jfp-book', { action: 'family' })).data.players.find((p) => p.name === 'Riley Returning')
  assert.equal(off.waiverOnFile, false, 'with carryover off, only this term\'s waivers count')
  assert.equal((await portal(lee, 'saveSettings', { config: { waiverCarryover: true } })).status, 200)
  // Another family's child with the same name never borrows that waiver.
  const other = client()
  await gate(other)
  await signIn(other, 'someone-else@example.com')
  const req = await other.call('/api/jfp-book', { action: 'family' })
  assert.ok(!req.data.players.some((p) => p.waiverOnFile), 'nothing on file for a family with no waiver of its own')
})

await test('venues: revenue by venue adds up to income this term; the term before from its ledger; coaches never see it', async () => {
  const m = (await portal(lee, 'money', { fresh: true })).data.money
  assert.equal(m.term, 'Term 4 2026')
  assert.equal(m.locations.reduce((t, l) => t + l.receivedCents, 0) + m.kpis.unlinkedCents, m.kpis.incomeCents, 'the venues add up to Income this term')
  const hq = m.locations.find((l) => l.name === 'Belrose HQ')
  assert.ok(hq.receivedCents > 0 && hq.groups.length >= 1)
  assert.equal(hq.groups.reduce((t, g) => t + g.receivedCents, 0), hq.receivedCents, 'the groups add up to the venue')
  assert.equal(hq.stripeCents + hq.bankCents + hq.cashCents + hq.otherCents, hq.receivedCents)
  assert.equal(m.players.filter((p) => p.locationId === hq.id).reduce((t, p) => t + p.receivedCents, 0) + hq.removedCents, hq.receivedCents, 'the players add up to the venue')
  assert.deepEqual([hq.juniors.paid, hq.juniors.paidCents, hq.juniors.creditCents], [1, 22000, 22000], 'Juniors: paid places only, credit apart')
  const past = (await portal(lee, 'venues')).data.venues
  assert.equal(past.term, 'Term 3 2026')
  const hq3 = past.venues.find((l) => l.name === 'Belrose HQ')
  assert.deepEqual([hq3.receivedCents, hq3.stripeCents, hq3.bankCents, hq3.players], [161500, 85000, 76500, 2])
  assert.deepEqual(past.unlinked, { cents: 30000, count: 1 })
  assert.equal(past.incomeCents, 191500)
  assert.equal(hq3.juniors.paidCents, 44000)
  assert.ok(past.players.some((p) => p.player === 'Riley Returning' && p.receivedCents === 85000))
  // Any term: the list runs newest first; older terms come from the Money Register copy.
  assert.deepEqual(m.venueTerms, ['Term 4 2026', 'Term 3 2026', 'Term 2 2026', 'Term 1 2026', 'Term 4 2025', 'Term 3 2025', 'Term 2 2025', 'Term 1 2025', 'Term 1 2024'])
  const t2 = (await portal(lee, 'venues', { term: 'Term 2 2026' })).data.venues
  assert.equal(t2.source, 'register')
  assert.deepEqual([t2.venues.find((l) => l.name === 'Belrose HQ').receivedCents, t2.venues.find((l) => l.name === 'Rydalmere Park').bankCents, t2.register['belrose hq']], [612000, 1530000, 900000])
  assert.equal((await portal(lee, 'venues', { term: 'Term 3 2026' })).data.venues.source, 'ledger')
  assert.equal((await portal(lee, 'venues', { term: 'Term 9 1999' })).status, 404)
  const sam = client()
  await signIn(sam, 'jonerfootballsam@gmail.com', 'staff')
  assert.equal((await portal(sam, 'venues')).status, 403, 'coaches never see venue money')
  assert.equal((await portal(sam, 'venues', { term: 'Term 2 2026' })).status, 403)
})

await test('money after Stripe fees: the real fee on every payment, net income, venues add up with fees, next term apart', async () => {
  const seed = (body) => fetch(`${B}/__stripe-seed`, { method: 'POST', body: JSON.stringify(body) }).then((r) => r.json())
  const money = async () => (await portal(lee, 'money', { fresh: true })).data.money
  const retrieved = async (pi) => (await (await fetch(`${B}/__events`)).json()).filter((e) => e.kind === 'stripe' && e.detail === `retrieve ${pi}`).length
  // The harness's invented fee rules (scripts/holiday-local.mjs mockBalance).
  const mockFee = (cents, method = 'card') => (method === 'afterpay_clearpay' ? Math.round(cents * 0.07) + 40 : Math.round(cents * 0.02) + 20)
  const sumOf = (list, k) => list.reduce((t, x) => t + (x[k] || 0), 0)
  const checkAddsUp = (m) => {
    const k = m.kpis
    for (const key of ['stripeFeesCents', 'feeGstCents', 'feesPendingCount', 'netIncomeCents', 'otherCents', 'expectedCents', 'collectedCents', 'unlinkedFeeCents', 'nextTermCents', 'nextTermCount']) assert.equal(typeof k[key], 'number', `kpis.${key}`)
    assert.equal(k.netIncomeCents, k.incomeCents - k.stripeFeesCents, 'net income is income less Stripe fees')
    assert.equal(k.cashCents + k.bankCents + k.otherCents, k.offlineCents)
    assert.equal(sumOf(m.locations, 'receivedCents') + k.unlinkedCents, k.incomeCents, 'the venues still add up to income')
    assert.equal(sumOf(m.locations, 'stripeFeeCents') + k.unlinkedFeeCents, k.stripeFeesCents, 'the venues\' fees add up to the term\'s fees')
    assert.equal(sumOf(k.feesByMethod, 'feeCents'), k.stripeFeesCents)
    assert.equal(sumOf(m.weekly, 'fee'), k.stripeFeesCents, 'the weekly fees add up')
    assert.ok(k.collectedPct === null || (k.collectedPct >= 0 && k.collectedPct <= 100))
    for (const l of m.locations) {
      assert.equal(l.netCents, l.receivedCents - l.stripeFeeCents, `${l.name}: net is received less fees`)
      assert.equal(sumOf(l.groups, 'stripeFeeCents'), l.stripeFeeCents, `${l.name}: the groups' fees add up`)
      assert.equal(sumOf(l.groups, 'receivedCents'), l.receivedCents, `${l.name}: the groups add up`)
      assert.equal(l.stripeCents + l.bankCents + l.cashCents + l.otherCents, l.receivedCents, `${l.name}: the methods add up`)
      assert.equal(sumOf(m.players.filter((p) => p.locationId === l.id), 'stripeFeeCents') + l.removedFeeCents, l.stripeFeeCents, `${l.name}: the players' fees add up`)
      assert.equal(sumOf(m.weeklyByVenue[l.id], 'fee'), l.stripeFeeCents, `${l.name}: its weekly fees add up`)
      assert.deepEqual(m.weeklyByVenue[l.id].map((w) => w.week), m.weekly.map((w) => w.week), `${l.name}: the same weeks as the total`)
    }
    for (const p of m.players) assert.equal(p.netReceivedCents, p.receivedCents - p.stripeFeeCents)
  }
  let m = await money()
  checkAddsUp(m)
  assert.ok(m.kpis.stripeFeesCents > 0, 'every site payment has a fee')
  assert.equal(m.kpis.feesPendingCount, 0)
  assert.ok(m.kpis.feeGstCents > 0 && m.kpis.feeGstCents < m.kpis.stripeFeesCents)
  // The family that kept their places for Term 1 2027 (the next term test): that money is not this term's.
  assert.ok(m.kpis.nextTermCount >= 2 && m.kpis.nextTermCents >= 85000, JSON.stringify(m.kpis))
  assert.ok(m.nextTermPayments.some((p) => p.email === 'next@example.com' && p.forTerm === 'Term 1 2027'))
  const nextFam = m.players.filter((p) => p.email === 'next@example.com')
  assert.ok(nextFam.length && nextFam.every((p) => p.stripeCents === 0 && p.status !== 'stripe'), 'next term money is not on this term\'s rows')
  assert.ok(!m.unmatched.some((u) => m.nextTermPayments.some((n) => n.id === u.id)))
  const before = m.kpis
  // An early hold paid on a link the old way (no term on it), a fee Stripe has not
  // worked out yet, and an Afterpay payment with its higher fee.
  const unpaid = m.players.find((p) => p.status === 'unpaid' && p.email && m.players.filter((x) => x.email === p.email).length === 1)
  await seed({ email: unpaid.email, cents: 10000, metadata: { jfpBookingId: 'PAY-SEEDNEXT', source: 'next-hold' } })
  const late = await seed({ email: 'fees-late@example.com', name: 'Late Fee', cents: 42500, btLate: true })
  const ap = await seed({ email: 'fees-afterpay@example.com', name: 'After Pay', cents: 40000, method: 'afterpay_clearpay' })
  const latePi = late.id.replace('cs_test_seed_', 'pi_seed_')
  m = await money()
  checkAddsUp(m)
  assert.equal(m.kpis.nextTermCount, before.nextTermCount + 1)
  assert.equal(m.kpis.nextTermCents, before.nextTermCents + 10000)
  assert.equal(m.players.find((p) => p.rowId === unpaid.rowId).status, 'unpaid', 'a hold for next term does not pay this term')
  assert.equal(m.kpis.incomeCents, before.incomeCents + 42500 + 40000)
  assert.equal(m.kpis.stripeFeesCents, before.stripeFeesCents + mockFee(42500) + mockFee(40000, 'afterpay_clearpay'), 'the fee Stripe had not worked out was read on its own')
  assert.equal(m.kpis.feesPendingCount, 0)
  assert.equal(await retrieved(latePi), 1)
  const kept = JSON.parse(await (await fetch(`${B}/__kv?cmd=${encodeURIComponent(JSON.stringify(['GET', `jfp:stripe-fee:${latePi}`]))}`)).text())
  assert.equal(kept.fee, mockFee(42500), 'and kept')
  assert.equal(await (await fetch(`${B}/__kv?cmd=${encodeURIComponent(JSON.stringify(['TTL', `jfp:stripe-fee:${latePi}`]))}`)).text(), '-1', 'for good')
  const afterpay = m.kpis.feesByMethod.find((x) => x.method === 'afterpay_clearpay')
  assert.ok(afterpay && afterpay.feeCents >= mockFee(40000, 'afterpay_clearpay'))
  m = await money()
  assert.equal(await retrieved(latePi), 1, 'a kept fee is never asked for again')
  // A refund gives the money back, never the fee.
  const fees = m.kpis.stripeFeesCents, income = m.kpis.incomeCents
  assert.equal((await fetch(`${B}/__refund?cs=${ap.id}`)).status, 200)
  m = await money()
  checkAddsUp(m)
  assert.equal(m.kpis.incomeCents, income - 40000)
  assert.equal(m.kpis.stripeFeesCents, fees, 'a refunded payment keeps its fee')
  assert.equal(m.kpis.netIncomeCents, m.kpis.incomeCents - fees)
  // The term before: its ledger has the fees.
  const past = (await portal(lee, 'venues')).data.venues
  assert.equal(past.stripeFeesCents, 1720)
  assert.equal(past.netIncomeCents, past.incomeCents - 1720)
  const hq3 = past.venues.find((l) => l.name === 'Belrose HQ')
  assert.deepEqual([hq3.stripeFeeCents, hq3.netCents], [1720, hq3.receivedCents - 1720])
  const t2 = (await portal(lee, 'venues', { term: 'Term 2 2026' })).data.venues
  assert.equal(t2.stripeFeesCents, null, 'the Money Register has no fees: not known')
  assert.ok(t2.venues.every((l) => l.stripeFeeCents === null && l.netCents === null))
  // The drawer shows each payment's fee and how it was paid.
  const hist = (await portal(lee, 'playerPayments', { rowId: nextFam[0].rowId })).data.player
  assert.ok(hist.stripe.some((p) => p.nextTerm && p.feeCents > 0 && p.payMethod === 'card'), JSON.stringify(hist.stripe))
})

await test('money page: the payment lines add up per venue, and the page shows each venue\'s own kept, tiles and download', async () => {
  const m = (await portal(lee, 'money', { fresh: true })).data.money
  const sum = (list, k) => list.reduce((t, x) => t + (x[k] || 0), 0)
  const k = m.kpis
  assert.ok(m.payments.length > 5, 'a line for each payment')
  for (const x of m.payments) {
    assert.equal(x.keptCents, x.takenCents - x.refundedCents - (x.feeCents || 0), `${x.id}: kept is taken less refunds and the fee`)
    assert.ok(['Stripe', 'Bank transfer', 'Cash', 'Other'].includes(x.method))
    if (x.method !== 'Stripe') assert.deepEqual([x.feeCents, x.refundedCents], [0, 0], 'only Stripe has a fee or a refund')
  }
  assert.equal(sum(m.payments, 'takenCents') - sum(m.payments, 'refundedCents'), k.incomeCents, 'the lines add up to income')
  assert.equal(sum(m.payments, 'refundedCents'), k.refundsCents, 'every refund is on a line')
  assert.equal(sum(m.payments, 'feeCents'), k.stripeFeesCents)
  assert.equal(sum(m.payments, 'feeGstCents'), k.feeGstCents)
  assert.equal(sum(m.payments, 'keptCents'), k.netIncomeCents)
  assert.ok(m.payments.some((x) => x.refundedCents > 0), 'the refunded Afterpay payment is listed')
  assert.ok(!m.payments.some((x) => m.nextTermPayments.some((n) => n.id === x.id)), 'next term money is not on a line')
  const loose = m.payments.filter((x) => !x.venueId)
  assert.equal(sum(loose, 'takenCents') - sum(loose, 'refundedCents'), k.unlinkedCents)
  assert.equal(sum(loose, 'feeCents'), k.unlinkedFeeCents)
  for (const l of m.locations) {
    const lines = m.payments.filter((x) => x.venueId === l.id)
    assert.equal(sum(lines, 'takenCents') - sum(lines, 'refundedCents'), l.receivedCents, `${l.name}: its lines add up to the venue`)
    assert.equal(sum(lines, 'feeCents'), l.stripeFeeCents, `${l.name}: and to its fees`)
    assert.equal(sum(lines, 'keptCents'), l.netCents, `${l.name}: and to what it kept`)
    assert.equal(sum(m.weeklyByVenue[l.id], 'stripe') , sum(lines.filter((x) => x.method === 'Stripe' && x.at), 'takenCents') - sum(lines.filter((x) => x.method === 'Stripe' && x.at), 'refundedCents'), `${l.name}: its weekly Stripe money is its own`)
  }
  // The page, drawn from this payload in jsdom.
  const { openPortal, csvRows } = await import('./jfp-portal-dom.mjs')
  const { money: aud } = await import('../src/scripts/jfp-common.js')
  const page = await openPortal({ money: m })
  assert.equal(page.text('#m-kept'), aud(k.netIncomeCents))
  assert.equal(page.text('#m-sum'), `Taken ${aud(k.incomeCents + k.refundsCents)} · Stripe fees ${aud(k.stripeFeesCents)} · Refunded ${aud(k.refundsCents)}`)
  const shown = [...page.d.querySelectorAll('#m-locs [data-mloc]')].map((b) => b.dataset.mloc)
  assert.deepEqual(shown, ['', ...m.locations.filter((l) => l.id !== 'other' || l.players || l.receivedCents || l.stripeFeeCents).map((l) => l.id)])
  for (const l of m.locations.filter((x) => shown.includes(x.id))) {
    await page.click(`#m-locs [data-mloc="${l.id}"]`)
    assert.equal(page.w.location.hash, `#money?loc=${l.id}`)
    assert.equal(page.text('#m-kept'), aud(l.netCents), `${l.name}: kept`)
    assert.equal(page.text('#m-scope [data-tile="stripe"] .val'), aud(l.stripeCents))
    assert.equal(page.text('#m-scope [data-tile="owing"] .val'), aud(l.owingCents))
    assert.equal(page.d.querySelectorAll('#m-rows tr[data-row]').length, m.players.filter((p) => p.locationId === l.id).length || 0)
    assert.equal(page.$('#m-unmatched details'), null)
    await page.click('#m-csv')
    const { name, text } = await page.csv()
    assert.equal(name, `jfp-money-term-4-2026-${l.id}.csv`)
    const rows = csvRows(text)
    assert.deepEqual(rows.find((r) => r[0] === 'Kept after Stripe fees'), ['Kept after Stripe fees', (l.netCents / 100).toFixed(2)])
    assert.equal(rows.filter((r) => r[0] === 'Total').at(-1)[7], (l.netCents / 100).toFixed(2), `${l.name}: the payments in the download add up to what it kept`)
  }
  assert.deepEqual(page.errors, [])
  page.close()
  // The built portal carries the new page.
  const fs = await import('node:fs')
  const html = fs.readFileSync(new URL('../dist/jfp-portal/index.html', import.meta.url), 'utf8')
  const src = html.match(/<script type="module" src="\/(_astro\/jfp-portal[^"]+\.js)"/)[1]
  const js = fs.readFileSync(new URL(`../dist/${src}`, import.meta.url), 'utf8')
  for (const id of ['m-locs', 'm-kept', 'm-sum', 'm-csv', 'm-fees', 'm-weekly', 'jv-owing', 'Download for accountant', 'Kept after Stripe fees', 'Paid for next term']) assert.ok(js.includes(id), `the built bundle has ${id}`)
  assert.ok(!/Before Stripe fees/.test(js))
})


await test('venue costs: Lee adds them per venue per term, each venue shows profit; marked paid but no money found is listed', async () => {
  const sum = (list, k) => list.reduce((t, x) => t + (x[k] || 0), 0)
  const save = (c, body) => portal(c, 'saveVenueCosts', { term: 'Term 4 2026', venueId: 'belrose', ...body })
  const sam = client()
  await signIn(sam, 'jonerfootballsam@gmail.com', 'staff')
  assert.equal((await save(sam, { lines: [{ label: 'Hall hire', cents: 100 }] })).status, 403, 'coaches cannot set costs')
  assert.equal((await portal(sam, 'money')).status, 403)
  const bad = [
    [{ lines: Array.from({ length: 21 }, (_, i) => ({ label: `Line ${i}`, cents: 100 })) }, /20/],
    [{ lines: [{ label: 'x'.repeat(41), cents: 100 }] }, /40/],
    [{ lines: [{ label: 'Hall hire', cents: -1 }] }, /amount/],
    [{ lines: [{ label: 'Hall hire', cents: 50000001 }] }, /amount/],
    [{ lines: [{ label: 'Hall hire', cents: 12.5 }] }, /amount/],
    [{ lines: [{ label: '', cents: 100 }] }, /name/],
    [{ lines: 'rent' }, /list/],
    [{ venueId: 'moon', lines: [] }, /venue/],
    [{ term: 'Summer camp', lines: [] }, /term/],
  ]
  for (const [body, msg] of bad) {
    const r = await save(lee, body)
    assert.equal(r.status, 400, JSON.stringify(body).slice(0, 80))
    assert.match(r.data.error, msg)
  }
  const ok = await save(lee, { lines: [{ label: 'Hall hire', cents: 30000 }, { label: ' Cleaning ', cents: 4500 }] })
  assert.equal(ok.status, 200, JSON.stringify(ok.data))
  assert.deepEqual(ok.data.lines, [{ label: 'Hall hire', cents: 30000 }, { label: 'Cleaning', cents: 4500 }])
  assert.equal(ok.data.costsCents, 34500)
  const log = (await portal(lee, 'audit', { limit: 20 })).data.entries
  assert.ok(log.some((e) => e.action === 'money.venueCosts' && e.target === 'Term 4 2026:belrose'), 'the change is in the audit log')
  assert.equal((await portal(lee, 'saveVenueCosts', { term: 'Term 3 2026', venueId: 'ntra', lines: [{ label: 'Field hire', cents: 41000 }] })).status, 200)
  assert.equal((await portal(lee, 'saveVenueCosts', { term: 'Term 2 2026', venueId: 'rydalmere', lines: [{ label: 'Field hire', cents: 10000 }] })).status, 200)
  // Settings saves leave the costs alone.
  assert.equal((await portal(lee, 'saveSettings', { config: { kitNote: 'Kit note for the costs test' } })).status, 200)

  let m = (await portal(lee, 'money', { fresh: true })).data.money
  let k = m.kpis
  const hq = m.locations.find((l) => l.id === 'belrose')
  assert.deepEqual(hq.costLines, ok.data.lines)
  assert.equal(hq.costsCents, 34500)
  assert.equal(hq.profitCents, hq.netCents - 34500, 'profit is kept after fees less costs')
  assert.equal(hq.profitBeforeFees, false)
  for (const l of m.locations.filter((x) => x.id !== 'belrose')) assert.deepEqual([l.costsCents, l.profitCents], [0, l.netCents], `${l.name}: no costs, profit is what it kept`)
  assert.equal(k.venueCostsCents, 34500)
  assert.equal(k.venuesWithCosts, 1)
  assert.equal(k.profitCents, k.netIncomeCents - 34500)
  assert.equal(sum(m.locations, 'profitCents') + k.unlinkedCents - k.unlinkedFeeCents, k.profitCents, 'All\'s profit counts money not linked to a player too')
  assert.equal(sum(m.locations, 'receivedCents') + k.unlinkedCents, k.incomeCents, 'the venues still add up to income')
  assert.deepEqual(m.venueCostsLast, { term: 'Term 3 2026', byVenue: { ntra: [{ label: 'Field hire', cents: 41000 }] } }, "last term's costs, to copy")

  const t3 = (await portal(lee, 'venues', { term: 'Term 3 2026' })).data.venues
  const nt3 = t3.venues.find((l) => l.id === 'ntra')
  assert.ok(nt3, 'a venue with costs shows even with no money that term')
  assert.equal(nt3.costsCents, 41000)
  assert.equal(nt3.profitCents, nt3.netCents - 41000)
  assert.equal(t3.profitBeforeFees, false)
  assert.equal(t3.profitCents, t3.netIncomeCents - 41000)
  const t2 = (await portal(lee, 'venues', { term: 'Term 2 2026' })).data.venues
  const ry2 = t2.venues.find((l) => l.id === 'rydalmere')
  assert.equal(ry2.netCents, null)
  assert.equal(ry2.profitCents, ry2.receivedCents - 10000, 'fees not known: taken less costs')
  assert.equal(ry2.profitBeforeFees, true)
  assert.deepEqual([t2.profitBeforeFees, t2.venueCostsCents, t2.profitCents], [true, 10000, t2.incomeCents - 10000])
  assert.equal((await portal(sam, 'venues', { term: 'Term 2 2026' })).status, 403)

  // Marked paid but no money found.
  for (const x of m.paidNoMoney) {
    const p = m.players.find((y) => y.rowId === x.rowId)
    assert.ok(p, 'each one is a player on the list')
    assert.equal(x.foundCents, p.receivedCents)
    assert.ok(x.airtableSaysCents > x.foundCents)
    assert.equal(x.missingCents, x.airtableSaysCents - x.foundCents)
    assert.equal(x.locationId, p.locationId)
  }
  assert.deepEqual([k.paidNoMoneyCount, k.paidNoMoneyCents], [m.paidNoMoney.length, sum(m.paidNoMoney, 'missingCents')])
  assert.ok(m.paidNoMoney.length >= 1, 'the harness has rows marked paid with no money this term')
  const sorted = m.paidNoMoney.map((x) => x.missingCents)
  assert.deepEqual(sorted, [...sorted].sort((a, b) => b - a), 'biggest gap first')
  const fully = m.players.filter((p) => p.paidCents > 0 && p.receivedCents >= p.paidCents)
  assert.ok(!fully.some((p) => m.paidNoMoney.some((x) => x.rowId === p.rowId)), 'a row whose money is all there is not listed')
  // Marked Paid by hand with no amount, a fee set and no money: listed at its fee.
  const quiet = m.players.find((p) => p.status === 'unpaid' && p.feeCents > 0 && !p.paidCents && !p.receivedCents)
  assert.ok(quiet, 'an unpaid row to mark')
  const before = (await at()).term4.find((r) => r.id === quiet.rowId).fields['Term 4 Payment Status'] ?? ''
  const patch = (v) => fetch(`${B}/__patch?table=term4&id=${quiet.rowId}&fields=${encodeURIComponent(JSON.stringify({ 'Term 4 Payment Status': v }))}`)
  await patch('Paid')
  m = (await portal(lee, 'money', { fresh: true })).data.money
  const row = m.paidNoMoney.find((x) => x.rowId === quiet.rowId)
  assert.deepEqual(row && [row.airtableSaysCents, row.foundCents, row.missingCents], [quiet.feeCents, 0, quiet.feeCents])
  await patch(before)

  // An empty list clears a venue's costs.
  assert.equal((await save(lee, { lines: [] })).status, 200)
  for (const [term, venueId] of [['Term 3 2026', 'ntra'], ['Term 2 2026', 'rydalmere']]) assert.equal((await portal(lee, 'saveVenueCosts', { term, venueId, lines: [] })).status, 200)
  m = (await portal(lee, 'money', { fresh: true })).data.money
  assert.deepEqual([m.kpis.venueCostsCents, m.kpis.venuesWithCosts, m.kpis.profitCents], [0, 0, m.kpis.netIncomeCents])
  assert.deepEqual((await portal(lee, 'getSettings')).data.config.venueCosts, {})
  // The built portal carries the costs and the review list.
  const fs = await import('node:fs')
  const html = fs.readFileSync(new URL('../dist/jfp-portal/index.html', import.meta.url), 'utf8')
  const js = fs.readFileSync(new URL(`../dist/${html.match(/<script type="module" src="\/(_astro\/jfp-portal[^"]+\.js)"/)[1]}`, import.meta.url), 'utf8')
  for (const id of ['saveVenueCosts', 'jv-costs', 'Profit after fees and costs', 'Profit after costs', 'Marked paid but no money found', 'data-pnm-row']) assert.ok(js.includes(id), `the built bundle has ${id}`)
})

await test('bank transfers to check: Xero and the bank CSV matched to players, recorded once with the line id, hidden, coaches kept out', async () => {
  const crypto = await import('node:crypto')
  const kv = async (cmd) => (await fetch(`${B}/__kv?cmd=${encodeURIComponent(JSON.stringify(cmd))}`)).text()
  const check = async () => { const r = await portal(lee, 'bankCheck'); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data.bank }
  const xero = JSON.parse(await kv(['GET', 'jfp:xero-bank-in']))
  const [fea, zan, , wol] = xero.items
  // Coaches never see or change any of it.
  const sam = client()
  await signIn(sam, 'jonerfootballsam@gmail.com', 'staff')
  for (const [action, body] of [['bankCheck', {}], ['bankUpload', { lines: [{ date: '2026-10-01', cents: 100, description: 'x' }] }], ['bankIgnore', { id: zan.id }], ['bankUnignore', { id: zan.id }]]) assert.equal((await portal(sam, action, body)).status, 403, action)
  assert.equal((await portal(sam, 'recordPayment', { rowIds: ['recX'], amountCents: 100, externalId: fea.id })).status, 403)

  // Two new unpaid players, named after two of the Xero payers; the Xero
  // amounts are set to what they owe.
  const add = async (name, parent, email) => {
    const r = await portal(lee, 'addPlayer', { groupId: WED420, force: true, player: { name }, parent: { name: parent, email, mobile: '0400111222' }, payment: 'none' })
    assert.equal(r.status, 200, JSON.stringify(r.data))
    return r.data.rowId
  }
  const aId = await add('Ollie Featherstone', 'Mia Featherstone', 'feather@example.com')
  const bId = await add('Kit Wolstenholme', 'Kara Wolstenholme', 'wolst@example.com')
  let m = (await portal(lee, 'money', { fresh: true })).data.money
  const a = m.players.find((p) => p.rowId === aId), b = m.players.find((p) => p.rowId === bId)
  assert.ok(a.owingCents > 0 && b.owingCents > 0, 'both owe their fee')
  fea.cents = a.owingCents
  wol.cents = b.owingCents
  await kv(['SET', 'jfp:xero-bank-in', JSON.stringify(xero)])
  let bank = await check()
  assert.equal(bank.sources.xeroItems, 4)
  assert.equal(bank.sources.xeroAt, xero.at)
  assert.ok(!bank.items.some((x) => /stripe/i.test(x.payer)), 'a Stripe payout is not a family')
  const hit = bank.items.find((x) => x.id === fea.id)
  assert.equal(hit.grade, 'high')
  assert.deepEqual([hit.candidates[0].rowId, hit.candidates[0].reason, hit.candidates[0].locationId], [a.rowId, "name matches the parent, amount = what's owing", a.locationId])
  assert.equal(bank.items[0].grade, 'high', 'likely matches first')
  assert.equal(bank.items.find((x) => x.id === zan.id).grade, 'none')

  // The bank CSV: checked, given ids, kept with what is there for 45 days.
  const day = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10)
  const lines = [{ date: day(1), cents: 30000, description: 'Fast Transfer From Rita Returning' }, { date: day(2), cents: 12345, description: 'Transfer from Unknown Person' }, { date: day(4), cents: 30000, description: 'Fast Transfer From Rita Returning' }, { date: day(4), cents: 30000, description: 'Fast Transfer From Rita Returning' }]
  for (const [body, msg] of [[{ lines: [] }, /No money in/], [{ lines: 'x' }, /No money in/], [{ lines: Array.from({ length: 2001 }, () => lines[0]) }, /2000/], [{ lines: [{ ...lines[0], date: '01/10/2026' }] }, /date or amount/], [{ lines: [{ ...lines[0], date: day(-3) }] }, /date or amount/], [{ lines: [{ ...lines[0], cents: -500 }] }, /date or amount/], [{ lines: [{ ...lines[0], cents: 12.5 }] }, /date or amount/]]) {
    const r = await portal(lee, 'bankUpload', body)
    assert.equal(r.status, 400, JSON.stringify(body).slice(0, 80))
    assert.match(r.data.error, msg)
  }
  let up = await portal(lee, 'bankUpload', { lines })
  // Nobody on the term is "Unknown Person" and A$123.45 is no fee: it is never kept.
  // Two identical lines on one day are two transfers (two children): both kept.
  assert.deepEqual([up.status, up.data.lines, up.data.kept, up.data.added, up.data.total], [200, 4, 3, 3, 3])
  assert.ok(!(await kv(['GET', 'jfp:bank-csv'])).includes('Unknown Person'), 'money that is not JFP never reaches KV')
  up = await portal(lee, 'bankUpload', { lines: [lines[0], lines[2], lines[3]] })
  assert.deepEqual([up.data.added, up.data.total], [0, 3], 'the same lines again are not added twice, the pair keeps its two ids')
  const ttl = Number(await kv(['TTL', 'jfp:bank-csv']))
  assert.ok(ttl > 44 * 86400 && ttl <= 45 * 86400, `kept 45 days (${ttl})`)
  const csvIdOf = (l) => `CSV-${crypto.createHash('sha1').update(`${l.date}|${l.cents}|${l.description}`).digest('hex')}`
  bank = await check()
  assert.equal(bank.sources.csvItems, 3)
  assert.equal(bank.items.filter((x) => x.source === 'csv' && x.date === day(4)).length, 2, 'both of the same-day transfers are listed')
  assert.ok(!JSON.stringify(bank).includes('Unknown Person'))
  assert.ok(bank.sources.csvAt)
  const rita = bank.items.find((x) => x.id === csvIdOf(lines[0]))
  assert.ok(rita, 'the CSV line is listed with its id')
  assert.equal(rita.source, 'csv')
  assert.equal(rita.grade, 'possible', 'the name matches, the amount does not')

  // Record with the line id: once. The ledger has it as a bank transfer on the bank's date.
  const bad = await portal(lee, 'recordPayment', { rowIds: [a.rowId], amountCents: fea.cents, method: 'Bank transfer', date: fea.date, externalId: 'BANK-12345678' })
  assert.equal(bad.status, 400)
  // The guards still hold: no future date, no more than is owing.
  assert.equal((await portal(lee, 'recordPayment', { rowIds: [a.rowId], amountCents: fea.cents, date: day(-2), externalId: fea.id })).status, 400)
  const over = await portal(lee, 'recordPayment', { rowIds: [a.rowId], amountCents: fea.cents + 10000, date: fea.date, externalId: fea.id })
  assert.equal(over.status, 400)
  assert.match(over.data.error, /more than/)
  const ok = await portal(lee, 'recordPayment', { rowIds: [a.rowId], amountCents: fea.cents, method: 'Cash', date: fea.date, externalId: fea.id })
  assert.equal(ok.status, 200, JSON.stringify(ok.data))
  assert.equal(ok.data.ledger, true)
  const air = await at()
  const led = air.ledger.filter((l) => l.fields['Payment ID'] === fea.id)
  assert.equal(led.length, 1)
  assert.deepEqual([led[0].fields['Payment Method'], led[0].fields['Payment Date'], led[0].fields['Amount Paid'], led[0].fields['Source Record ID']], ['Bank Transfer', fea.date, fea.cents / 100, a.rowId], 'always a bank transfer, on the bank date')
  assert.match(led[0].fields.Notes, /Bank transfer matched from Xero/)
  const row = air.term4.find((r) => r.id === a.rowId).fields
  assert.deepEqual([row['Term 4 Payment Status'], row['Term 4 Amount Paid']], ['Paid', fea.cents / 100])
  assert.match(row['Term 4 Notes'], /Bank transfer matched from Xero/)
  const again = await portal(lee, 'recordPayment', { rowIds: [b.rowId], amountCents: wol.cents, date: fea.date, externalId: fea.id })
  assert.equal(again.status, 409, 'never twice, even for another player')
  // The line is claimed for good, so even with the ledger line gone (an Airtable failure) it is refused.
  assert.ok(JSON.parse(await kv(['GET', `jfp:bank-recorded:${fea.id}`])).cents === fea.cents)
  const ledLine = (await at()).ledger.find((l) => l.fields['Payment ID'] === fea.id)
  await fetch(`${B}/__patch?table=ledger&id=${ledLine.id}&fields=${encodeURIComponent(JSON.stringify({ 'Payment ID': 'GONE-1' }))}`)
  const noLedger = await portal(lee, 'recordPayment', { rowIds: [b.rowId], amountCents: wol.cents, date: fea.date, externalId: fea.id })
  assert.equal(noLedger.status, 409)
  assert.match(noLedger.data.error, /already recorded/)
  await fetch(`${B}/__patch?table=ledger&id=${ledLine.id}&fields=${encodeURIComponent(JSON.stringify({ 'Payment ID': fea.id }))}`)
  // The same transfer from the bank CSV (a day later, same payer and amount): the other copy, so it asks first.
  const copy = { date: fea.date, cents: fea.cents, description: 'Fast Transfer From M Featherstone' }
  assert.equal((await portal(lee, 'bankUpload', { lines: [copy] })).data.added, 1)
  const copyId = `CSV-${crypto.createHash('sha1').update(`${copy.date}|${copy.cents}|${copy.description}`).digest('hex')}`
  assert.ok(!(await check()).items.some((x) => x.id === copyId), 'the CSV copy of a recorded Xero line is not offered')
  const twin = await portal(lee, 'recordPayment', { rowIds: [b.rowId], amountCents: copy.cents, date: copy.date, externalId: copyId })
  assert.deepEqual([twin.status, twin.data.code], [409, 'twin'])
  assert.match(twin.data.error, /same transfer/)
  assert.equal(Number((await at()).term4.find((r) => r.id === b.rowId).fields['Term 4 Amount Paid'] || 0), 0)
  assert.equal(await kv(['GET', `jfp:bank-recorded:${copyId}`]), 'null', 'a refused line is not claimed')
  // A second transfer of the same amount from the same family two days later: still offered.
  const second = { ...fea, id: 'XERO-00000005-aaaa-4bbb-8ccc-000000000005', date: day(0) }
  xero.items.push(second)
  await kv(['SET', 'jfp:xero-bank-in', JSON.stringify(xero)])
  const withSecond = await check()
  assert.ok(withSecond.items.some((x) => x.id === second.id), 'one recorded transfer never hides another')
  assert.equal(Number((await at()).term4.find((r) => r.id === b.rowId).fields['Term 4 Amount Paid'] || 0), 0, 'and nothing was written')
  assert.ok((await portal(lee, 'audit', { limit: 20 })).data.entries.some((e) => e.action === 'payment.record' && e.after?.bank === fea.id))
  // Recorded by hand instead, as a bank transfer with the same amount within a week: also off the list.
  assert.equal((await portal(lee, 'recordPayment', { rowIds: [b.rowId], amountCents: wol.cents, method: 'Bank transfer', date: day(3) })).status, 200)
  await portal(lee, 'money', { fresh: true })
  bank = await check()
  assert.ok(!bank.items.some((x) => x.id === fea.id), 'recorded with its id: gone')
  assert.ok(!bank.items.some((x) => x.id === wol.id), 'recorded by hand: gone')
  assert.ok(bank.counts.recorded >= 2)
  // The money page counts the transfer once, as bank transfer money for that player.
  m = (await portal(lee, 'money', { fresh: true })).data.money
  const pa = m.players.find((p) => p.rowId === a.rowId)
  assert.deepEqual([pa.status, pa.receivedCents], ['paid', fea.cents])
  assert.ok(m.payments.some((x) => x.method === 'Bank transfer' && x.at === fea.date && x.venueId === a.locationId && x.takenCents === fea.cents))

  // Not JFP: hidden, and back again.
  for (const id of ['', 'BANK-12345678', 'XERO-1']) assert.equal((await portal(lee, 'bankIgnore', { id })).status, 400)
  assert.equal((await portal(lee, 'bankIgnore', { id: zan.id })).status, 200)
  bank = await check()
  assert.ok(!bank.items.some((x) => x.id === zan.id))
  assert.ok(bank.counts.ignored >= 1)
  assert.deepEqual(bank.hidden.find((x) => x.id === zan.id), { id: zan.id, date: zan.date, cents: zan.cents, payer: zan.payer, source: 'xero' }, 'listed under Hidden, so it can come back')
  assert.equal((await portal(lee, 'bankUnignore', { id: zan.id })).status, 200)
  assert.ok((await check()).items.some((x) => x.id === zan.id))
  // The built portal has the panel.
  const fs = await import('node:fs')
  const html = fs.readFileSync(new URL('../dist/jfp-portal/index.html', import.meta.url), 'utf8')
  const js = fs.readFileSync(new URL(`../dist/${html.match(/<script type="module" src="\/(_astro\/jfp-portal[^"]+\.js)"/)[1]}`, import.meta.url), 'utf8')
  for (const t of ['bankCheck', 'Bank transfers to check', 'Upload bank statement (CSV)', 'externalId']) assert.ok(js.includes(t), `the built bundle has ${t}`)
})


await test('money: a Stripe day is the Sydney day, part paid in Stripe still owes the rest, a fee still loading is blank, no costs for No venue set', async () => {
  const seed = (body) => fetch(`${B}/__stripe-seed`, { method: 'POST', body: JSON.stringify(body) }).then((r) => r.json())
  const kv = async (cmd) => (await fetch(`${B}/__kv?cmd=${encodeURIComponent(JSON.stringify(cmd))}`)).text()
  const money = async () => (await portal(lee, 'money', { fresh: true })).data.money
  const sum = (list, k) => list.reduce((t, x) => t + (x[k] || 0), 0)
  const add = async (name, parent, email) => {
    const r = await portal(lee, 'addPlayer', { groupId: WED420, force: true, player: { name }, parent: { name: parent, email, mobile: '0400111333' }, payment: 'none' })
    assert.equal(r.status, 200, JSON.stringify(r.data))
    return r.data.rowId
  }
  const famId = await add('Ivy Mondayson', 'Ola Mondayson', 'monday@example.com'), otherId = await add('Rex Latefield', 'Una Latefield', 'latefee@example.com')
  let m = await money()
  const before = m.kpis, weekBefore = Object.fromEntries(m.weekly.map((w) => [w.week, w.stripe]))
  const fam = m.players.find((p) => p.rowId === famId), other = m.players.find((p) => p.rowId === otherId)
  assert.ok(fam.owingCents > 10000 && other.owingCents > 0, 'both owe their fee')
  // Monday 12 Oct 2026, 7:30 am in Sydney (summer time) is still Sunday in UTC.
  const mon = await seed({ email: fam.email, name: 'Monday Payer', cents: 10000, at: '2026-10-11T20:30:00.000Z' })
  m = await money()
  const row = m.players.find((p) => p.rowId === fam.rowId)
  assert.equal(m.payments.find((x) => x.id === mon.id).at, '2026-10-12', 'the day it was paid in Sydney')
  if (weekBefore['2026-10-12'] != null) {
    assert.equal(m.weekly.find((w) => w.week === '2026-10-12').stripe, weekBefore['2026-10-12'] + 10000, 'in the week of Monday 12 Oct')
    assert.equal(m.weekly.find((w) => w.week === '2026-10-05').stripe, weekBefore['2026-10-05'], 'not the week before')
    assert.ok(m.weeklyByVenue[row.locationId].find((w) => w.week === '2026-10-12').stripe >= 10000)
  }
  // A$100 of an A$850 place, not recorded yet: A$100 is in, the rest still owing.
  assert.deepEqual([row.status, row.owingCents, row.stripeAppliedCents, row.stillOwingCents], ['stripe', 0, 10000, fam.owingCents - 10000])
  assert.equal(m.kpis.collectedCents, before.collectedCents + 10000, 'only the money that came in counts as paid')
  const v = m.locations.find((l) => l.id === row.locationId)
  assert.ok(v.owingRowIds.includes(row.rowId), 'and the venue still lists them as owing')
  assert.equal(sum(m.locations, 'receivedCents') + m.kpis.unlinkedCents, m.kpis.incomeCents)
  // A fee Stripe has not worked out, and was asked for a moment ago: blank, never 0.
  const late = await seed({ email: other.email, name: 'Late Payer', cents: other.owingCents, btLate: true })
  await kv(['SET', `jfp:stripe-fee-try:${late.id.replace('cs_test_seed_', 'pi_seed_')}`, '1', 'EX', '600'])
  m = await money()
  const line = m.payments.find((x) => x.id === late.id)
  assert.deepEqual([line.feeCents, line.keptCents], [null, null], 'no fee yet, so no kept yet')
  assert.equal(m.players.find((p) => p.rowId === other.rowId).stripeFeePending, 1)
  assert.equal(m.players.find((p) => p.rowId === fam.rowId).stripeFeePending, 0)
  // Costs only for a real venue.
  for (const l of m.locations) assert.equal(l.canCost, l.id !== 'other', l.id)
  const none = m.locations.find((l) => l.id === 'other')
  if (none) assert.equal(none.canCost, false)
  assert.equal((await portal(lee, 'saveVenueCosts', { venueId: 'other', lines: [{ label: 'Field hire', cents: 1000 }] })).status, 400)
})

await test('money by year: this term live, the term before from its ledger, older terms from the register; adds up, typed totals used and flagged, the year before compared; coaches never see it', async () => {
  const sum = (list, f) => list.reduce((t, x) => t + (f(x) || 0), 0)
  const m = (await portal(lee, 'money', { fresh: true })).data.money
  const r = await portal(lee, 'moneyYear', { year: 2026, fresh: true })
  assert.equal(r.status, 200, JSON.stringify(r.data))
  const y = r.data.year
  const all = y.scopes['']
  assert.deepEqual(y.years, [2026, 2025, 2024])
  assert.deepEqual(y.terms, m.venueTerms)
  assert.deepEqual(all.perTerm.map((t) => [t.term, t.source, t.current]), [['Term 1 2026', 'register', false], ['Term 2 2026', 'register', false], ['Term 3 2026', 'ledger', false], ['Term 4 2026', 'live', true]])
  // This term is the Money tab's own figure; the term before is the venue window's.
  const now = all.perTerm[3]
  assert.deepEqual([now.takenCents, now.keptCents, now.stripeFeeCents, now.unlinkedCents], [m.kpis.incomeCents, m.kpis.netIncomeCents, m.kpis.stripeFeesCents, m.kpis.unlinkedCents])
  const t3 = (await portal(lee, 'venues', { term: 'Term 3 2026' })).data.venues
  assert.deepEqual([all.perTerm[2].takenCents, all.perTerm[2].stripeFeeCents, all.perTerm[2].keptCents, all.perTerm[2].unlinkedCents], [t3.incomeCents, t3.stripeFeesCents, t3.netIncomeCents, t3.unlinked.cents])
  // Terms add up to the year; venues and money not on a venue add up to each term.
  assert.equal(all.takenCents, sum(all.perTerm, (t) => t.takenCents))
  for (const t of all.perTerm) assert.equal(sum(y.venues, (v) => y.scopes[v.id].perTerm.find((x) => x.n === t.n).takenCents) + t.unlinkedCents + t.registerGapCents, t.takenCents, `${t.term} adds up`)
  for (const v of y.venues) assert.equal(y.scopes[v.id].takenCents, sum(y.scopes[v.id].perTerm, (t) => t.takenCents), `${v.name}'s year adds up`)
  // Term 1 2026: the typed total matches. Term 2 2026: HQ typed A$9,000, A$6,120 listed.
  assert.deepEqual([all.perTerm[0].registerCents, all.perTerm[0].listedCents], [637500, 637500])
  assert.deepEqual(all.differences.map((d) => [d.term, d.scope, d.registerCents, d.listedCents]), [['Term 2 2026', 'belrose', 900000, 612000]])
  assert.deepEqual([all.feeTerms, all.noFeeTerms], [['Term 3 2026', 'Term 4 2026'], ['Term 1 2026', 'Term 2 2026']])
  assert.equal(all.keptCents, all.perTerm[2].keptCents + now.keptCents)
  assert.deepEqual([all.compare.terms, all.compare.running, all.compare.previousYear], [[1, 2, 3], ['Term 4 2026'], 2025])
  assert.equal(all.compare.thisCents, sum(all.perTerm.slice(0, 3), (t) => t.takenCents))
  assert.deepEqual([y.soFar, y.current], [true, 'Term 4 2026'])
  // 2025: every term from the register, typed totals where Lee typed them.
  const y25 = (await portal(lee, 'moneyYear', { year: 2025 })).data.year
  assert.deepEqual(y25.scopes[''].perTerm.map((t) => [t.term, t.takenCents, t.listedCents]), [['Term 1 2025', 1213500, 1213500], ['Term 2 2025', 875000, 850000], ['Term 3 2025', 725000, 680000], ['Term 4 2025', 850000, 850000]])
  assert.equal(y25.scopes[''].takenCents, 3663500)
  assert.deepEqual(y25.scopes[''].differences.map((d) => [d.term, d.scope, d.diffCents]), [['Term 2 2025', 'all', 25000], ['Term 3 2025', 'fields', 45000], ['Term 3 2025', 'all', 45000]])
  assert.deepEqual([y25.scopes[''].keptCents, y25.scopes[''].noFeeTerms.length], [null, 4], 'no Stripe fees in the register')
  assert.deepEqual([y25.scopes[''].compare.terms, y25.scopes[''].compare.allTerms, y25.scopes[''].compare.thisCents], [[1], false, 1213500], 'only Term 1 is in both 2025 and 2024')
  assert.equal(y25.scopes[''].juniorsCents, 66000, 'Joners Juniors as the register has it, under HQ')
  const y24 = (await portal(lee, 'moneyYear', { year: 2024 })).data.year
  assert.deepEqual([y24.partial, y24.missing, y24.scopes[''].compare.none, y24.scopes[''].takenCents], [true, ['Term 2 2024', 'Term 3 2024', 'Term 4 2024'], 'nodata', 640000])
  // Kept for 10 minutes; fresh adds it up again.
  assert.equal((await portal(lee, 'moneyYear', { year: 2026 })).data.year.at, y.at)
  assert.notEqual((await portal(lee, 'moneyYear', { year: 2026, fresh: true })).data.year.at, y.at)
  assert.equal((await portal(lee, 'moneyYear', { year: 2019 })).status, 404, 'a year with no figures')
  assert.equal((await portal(lee, 'moneyYear', { year: 'last year' })).status, 400)
  const sam = client()
  await signIn(sam, 'jonerfootballsam@gmail.com', 'staff')
  assert.equal((await portal(sam, 'moneyYear', { year: 2026 })).status, 403, 'coaches never see money by year')
  // An earlier term for the Money tab: payments counted, Lee's typed totals checked.
  const t2 = (await portal(lee, 'venues', { term: 'Term 2 2026' })).data.venues
  assert.deepEqual([t2.paymentsCount, t2.hqId], [27, 'belrose'])
  assert.deepEqual(t2.registerChecks, [{ scope: 'belrose', venueIds: ['belrose'], registerCents: 900000, listedCents: 612000, diffCents: 288000 }])
  assert.deepEqual(t2.venues.find((v) => v.id === 'belrose').groups.map((g) => [g.label, g.payments, g.bankCents, g.cashCents]), [['Monday Afternoon (HQ)', 9, 400000, 212000]])
  assert.deepEqual([t3.paymentsCount, t3.unlinkedByKind.cash, t3.unlinked], [3, 30000, { cents: 30000, count: 1 }])
  assert.equal(sum(t3.venues, (v) => v.payments), 2)
  // The pages, drawn from these answers in jsdom.
  const { openPortal } = await import('./jfp-portal-dom.mjs')
  const { money: aud } = await import('../src/scripts/jfp-common.js')
  const answer = (b) => (b.action === 'moneyYear' ? { success: true, year: b.year === 2025 ? y25 : y } : b.action === 'venues' ? { success: true, venues: b.term === 'Term 2 2026' ? t2 : t3 } : null)
  let page = await openPortal({ money: m, hash: '#money?year=2026', onPost: answer })
  assert.equal(page.text('#y-taken'), aud(all.takenCents))
  assert.match(page.text('#y-compare'), /^Terms 1 to 3: (up|down) .* on the same terms of 2025\.$/)
  assert.equal(page.d.querySelectorAll('#y-terms tbody tr[data-term]').length, 4)
  assert.equal(page.text('#y-venues tr.jv-total td:last-child'), aud(all.takenCents))
  await page.click('#y-terms [data-open-term="Term 2 2026"]')
  assert.equal(page.w.location.hash, '#money?term=Term%202%202026')
  assert.equal(page.text('#m-taken'), aud(t2.incomeCents))
  assert.match(page.text('#m-register'), /Your register says A\$9,000 for Belrose HQ, the payments listed add up to A\$6,120\./)
  assert.equal(page.$('[data-record]'), null)
  assert.deepEqual(page.errors, [])
  page.close()
  page = await openPortal({ money: m, hash: '#money?term=Term%203%202026', onPost: answer })
  assert.equal(page.text('#m-sum'), `Kept after Stripe fees ${aud(t3.netIncomeCents)} · Stripe fees ${aud(t3.stripeFeesCents)}`)
  assert.deepEqual(page.errors, [])
  page.close()
  // The built portal carries the new views.
  const fs = await import('node:fs')
  const html = fs.readFileSync(new URL('../dist/jfp-portal/index.html', import.meta.url), 'utf8')
  const js = fs.readFileSync(new URL(`../dist/${html.match(/<script type="module" src="\/(_astro\/jfp-portal[^"]+\.js)"/)[1]}`, import.meta.url), 'utf8')
  for (const t of ['moneyYear', 'm-show', 'whole year', 'this term', 'Your register says']) assert.ok(js.includes(t), `the built bundle has ${t}`)
})


await test('holiday training money and last term from the bank: Stripe with real fees and refunds owed, bank lines claimed once, coaches kept out', async () => {
  const kv = async (cmd) => (await fetch(`${B}/__kv?cmd=${encodeURIComponent(JSON.stringify(cmd))}`)).text()
  const adm = async (action, extra = {}) => (await fetch(`${B}/api/holiday-admin`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-holiday-admin-secret': 'admin' }, body: JSON.stringify({ action, ...extra }) })).json()
  const fee = (c) => Math.round(c * 0.02) + 20
  const hol = async (period, fresh = true) => { const r = await portal(lee, 'holidayMoney', { period, fresh }); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data.holiday }
  const check = async () => { const r = await portal(lee, 'bankCheck'); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data.bank }
  const X = (n, date, cents, payer, description) => ({ id: `XERO-000000${n}-aaaa-4bbb-8ccc-0000000000${n}`, date, cents, payer, description, reference: '', reconciled: true })
  const H1 = X(41, '2026-07-08', 8500, 'H HOLIDAYPAYER', 'Fast Transfer From H Holidaypayer')
  const H2 = X(42, '2026-07-01', 12000, 'J JULYPAYER', 'Transfer from J Julypayer')
  const T3 = X(43, '2026-08-05', 45000, 'RITA RETURNING', 'Transfer from Rita Returning')
  const T3b = X(44, '2026-08-06', 76500, 'RITA RETURNING', 'Transfer from Rita Returning Sasha')

  // Coaches never see or change any of it; another site cannot post.
  // An invented coach, added for this check.
  const cfg = (await portal(lee, 'getSettings')).data.config
  assert.equal((await portal(lee, 'saveSettings', { config: { coaches: [...cfg.coaches, { id: 'testcoach', name: 'Testy', fullName: 'Testy Coach', airtableName: 'Testy Coach', email: 'coach.test@example.com' }] } })).status, 200)
  const sam = client()
  await signIn(sam, 'coach.test@example.com', 'staff')
  assert.equal((await portal(sam, 'me')).data.user.role, 'coach')
  for (const [action, body] of [['holidayMoney', {}], ['bankHoliday', { id: H1.id, period: '2026-winter' }], ['bankHolidayUndo', { id: H1.id }], ['bankPreviousTerm', { id: T3.id, rowId: 'recX' }], ['previousTermPlayers', {}]]) assert.equal((await portal(sam, action, body)).status, 403, action)
  const leeCookie = [...lee.jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
  const evil = await fetch(`${B}/api/jfp-portal-data`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: leeCookie, origin: 'https://evil.example' }, body: JSON.stringify({ action: 'bankHoliday', id: H1.id, period: '2026-winter' }) })
  assert.equal(evil.status, 403)
  assert.equal((await fetch(`${B}/api/jfp-portal-data?action=holidayMoney`, { headers: { cookie: leeCookie, origin: B } })).status, 405, 'POST only')

  // Holiday bookings in the summer holidays, paid in Stripe; one cancelled with a refund due.
  await adm('saveConfig', { config: { coaches: [{ id: 'cara', name: 'Cara', tier: 'coach', active: true }, { id: 'bo', name: 'Bo', tier: 'coach', active: false }], prices: { coach: { one: 12000, shared: 9000, group: 8000 } } } })
  await adm('bulkAddSlots', { template: { coachId: 'cara', type: 'open', capacity: 6, durationMin: 60 }, dates: ['2026-12-21', '2026-12-22'], times: ['10:00'] })
  // A trial hour at its own price (A$85 a player), never booked: its price still counts for the hints.
  assert.equal((await adm('upsertSlot', { slot: { coachId: 'cara', date: '2026-12-23', startTime: '10:00', durationMin: 60, type: 'group', capacity: 6, priceCents: 8500, seatMode: 'shared' } })).success, true)
  const access = await fetch(`${B}/api/holiday-access`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'holiday' }) })
  const hcookie = access.headers.get('set-cookie').split(';')[0]
  const hapi = async (path, body) => { const r = await fetch(`${B}${path}`, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', cookie: hcookie, 'x-forwarded-for': '10.9.9.9' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, data: await r.json() } }
  const open = (await hapi('/api/holiday-slots')).data.slots.filter((x) => ['2026-12-21', '2026-12-22'].includes(x.date) && !x.booked)
  assert.equal(open.length, 2)
  const book = async (slotId, type, players, email) => {
    const r = await hapi('/api/holiday-book', { slotId, type, seats: players.length, players, parentName: 'Holly Parent', mobile: '0400000000', email, agreementAccepted: true })
    assert.equal(r.status, 200, JSON.stringify(r.data))
    const cs = r.data.url.split('cs=')[1]
    await fetch(`${B}/mock-stripe/?cs=${cs}&action=pay`, { redirect: 'manual' })
    return { id: r.data.bookingId, cs }
  }
  const b1 = await book(open[0].id, 'one', [{ name: 'Kid Holly', age: 9 }], 'holly@example.com')
  const b2 = await book(open[1].id, 'shared', [{ name: 'Kid Holly', age: 9 }, { name: 'Kid Ivy', age: 11 }], 'holly@example.com')
  const cancel = await adm('cancelBooking', { bookingId: b2.id })
  assert.equal(cancel.refundDue, true)
  let h = await hol('2026-summer')
  assert.equal(h.label, 'Summer holidays 2026–27')
  assert.deepEqual(h.lines.map((x) => x.bookingId).sort(), [b1.id, b2.id].sort())
  assert.deepEqual([h.totals.stripe.takenCents, h.totals.stripe.feeCents, h.totals.refundedCents], [12000 + 18000, fee(12000) + fee(18000), 0], 'the real fee from each balance transaction')
  assert.equal(h.totals.keptCents, 30000 - fee(12000) - fee(18000))
  assert.equal(h.totals.feesPending, 0)
  assert.deepEqual(h.refundsOwed.map((x) => [x.bookingId, x.owedCents]), [[b2.id, 18000]], 'cancelled, refund due, Stripe shows none')
  assert.deepEqual(h.byCoach.map((g) => g.label), ['Cara'])
  assert.deepEqual(h.byLocation.map((g) => g.label), ['Belrose HQ'])
  assert.deepEqual(h.byMonth.session.map((m) => [m.month, m.keptCents]), [['2026-12', h.totals.keptCents]])
  assert.equal(h.byMonth.paid[0].month, new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date()).slice(0, 7), 'paid today, Sydney time')
  // Lee refunds it in Stripe: it is no longer owed, and Stripe keeps its fee.
  await fetch(`${B}/__refund?cs=${b2.cs}&amount=18000`)
  h = await hol('2026-summer')
  assert.deepEqual(h.refundsOwed, [])
  assert.deepEqual([h.totals.refundedCents, h.totals.keptCents], [18000, 12000 - fee(12000) - fee(18000)])
  // The holiday money is never in the JFP Stripe figures.
  const m = (await portal(lee, 'money', { fresh: true })).data.money
  assert.ok(!m.payments.some((x) => x.id === b1.cs || x.id === b2.cs))
  assert.ok(!m.unmatched.some((x) => x.id === b1.cs))

  // Bank lines from July and August (before this term), and last term's rows.
  const xero = JSON.parse(await kv(['GET', 'jfp:xero-bank-in']))
  xero.items.push(H1, H2, T3, T3b)
  await kv(['SET', 'jfp:xero-bank-in', JSON.stringify(xero)])
  const air = await at()
  const riley3 = air.term3.find((r) => r.fields['Player Name'] === 'Riley Returning').id
  const sasha3 = air.term3.find((r) => r.fields['Player Name'] === 'Sasha Returning').id
  const patch = (id, fields) => fetch(`${B}/__patch?table=term3&id=${id}&fields=${encodeURIComponent(JSON.stringify(fields))}`)
  await patch(riley3, { 'Fee Amount': 850, 'Term 3 Amount Paid': 400, 'Payment Status': 'Partially Paid', 'Term 3 Notes': 'Enrolled online.' })
  await patch(sasha3, { 'Fee Amount': 765, 'Payment Status': 'Paid', 'Paid': 'Paid Bank Transfer' })
  await kv(['DEL', 'jfp:prev-term:v1:term-3-2026'])
  let bank = await check()
  assert.equal(bank.previousTerm.term, 'Term 3 2026')
  assert.ok(bank.holiday.periods.some((p) => p.id === '2026-winter') && bank.holiday.periods.at(-1).id === 'other')
  assert.deepEqual(bank.holiday.coaches.map((c) => c.id), ['cara', 'bo'], 'active coaches first')
  for (const x of [H1, H2, T3, T3b]) assert.ok(!bank.items.some((y) => y.id === x.id), `${x.date} is not in this term's list`)
  const bh1 = bank.before.find((x) => x.id === H1.id), bh2 = bank.before.find((x) => x.id === H2.id), bt3 = bank.before.find((x) => x.id === T3.id)
  assert.ok(bh1 && bh2 && bt3, 'older lines are in the Before this term fold')
  assert.deepEqual([bh1.hints.holiday, bh1.holidayPeriod], [true, { id: '2026-winter', how: 'inside' }], 'A$85 is a holiday price, in the winter holidays')
  assert.deepEqual([bh2.hints.holiday, bh2.holidayPeriod.how], [true, 'before'], 'A$120, three days before the winter break')
  assert.equal(bt3.hints.lastTerm, true)
  assert.deepEqual([bt3.previous.rowId, bt3.previous.owingCents, bt3.previous.exact], [riley3, 45000, true])
  const prevList = (await portal(lee, 'previousTermPlayers')).data
  assert.equal(prevList.term, 'Term 3 2026')
  assert.deepEqual((({ feeCents, paidCents, owingCents }) => [feeCents, paidCents, owingCents])(prevList.players.find((x) => x.rowId === riley3)), [85000, 40000, 45000])

  // Holiday revenue: checked, claimed once, off the list, in the holiday view.
  for (const [body, status] of [[{ id: H1.id, period: 'easter' }, 400], [{ id: 'BANK-1234567', period: '2026-winter' }, 400], [{ id: 'XERO-99999999-zzzz', period: '2026-winter' }, 404], [{ id: H1.id, period: '2026-winter', sessionDate: '2026-08-20' }, 400], [{ id: H1.id, period: '2026-winter', coach: 'nobody' }, 400], [{ id: H1.id, period: '2026-winter', location: 'Mars' }, 400]]) assert.equal((await portal(lee, 'bankHoliday', body)).status, status, JSON.stringify(body))
  assert.equal(await kv(['GET', `jfp:bank-recorded:${H1.id}`]), 'null', 'a refused line is not claimed')
  const saved = await portal(lee, 'bankHoliday', { id: H1.id, period: '2026-winter', sessionDate: '2026-07-09', coach: 'cara', location: 'Belrose HQ', note: 'one hour' })
  assert.equal(saved.status, 200, JSON.stringify(saved.data))
  assert.equal(saved.data.periodLabel, 'Winter holidays 2026')
  assert.equal(JSON.parse(await kv(['GET', `jfp:bank-recorded:${H1.id}`])).kind, 'holiday')
  assert.deepEqual((({ cents, date, period, coach, location }) => ({ cents, date, period, coach, location }))(JSON.parse(await kv(['HGET', 'jfp:holiday-bank', H1.id]))), { cents: 8500, date: H1.date, period: '2026-winter', coach: 'Cara', location: 'Belrose HQ' })
  assert.equal((await portal(lee, 'bankHoliday', { id: H1.id, period: '2026-winter' })).status, 409, 'never twice')
  assert.equal((await portal(lee, 'recordPayment', { rowIds: [air.term4[1].id], amountCents: 8500, date: H1.date, externalId: H1.id })).status, 409, 'never also for a player')
  assert.equal((await portal(lee, 'bankPreviousTerm', { id: H1.id, rowId: riley3 })).status, 409, 'nor for last term')
  assert.ok(!(await check()).before.some((x) => x.id === H1.id), 'it leaves the list')
  h = await hol('2026-winter')
  assert.deepEqual([h.totals.bank.count, h.totals.bank.keptCents, h.totals.stripe.count, h.lines[0].sessionDate, h.lines[0].coach], [1, 8500, 0, '2026-07-09', 'Cara'])
  assert.deepEqual(h.byMonth.session.map((x) => [x.month, x.bankCents]), [['2026-07', 8500]])
  assert.ok((await hol('all')).lines.some((x) => x.id === H1.id))
  // Its copy in the bank CSV (kept: July is inside the 130 days now): the other copy, so it asks first.
  const copy = { date: H1.date, cents: H1.cents, description: 'Fast Transfer From H Holidaypayer' }
  assert.equal((await portal(lee, 'bankUpload', { lines: [copy] })).data.kept, 1, 'a holiday price is JFP money')
  const crypto = await import('node:crypto')
  const copyId = `CSV-${crypto.createHash('sha1').update(`${copy.date}|${copy.cents}|${copy.description}`).digest('hex')}`
  assert.ok(!(await check()).before.some((x) => x.id === copyId), 'the copy of a holiday line is not offered')
  const twin = await portal(lee, 'bankHoliday', { id: copyId, period: '2026-winter' })
  assert.deepEqual([twin.status, twin.data.code], [409, 'twin'])
  assert.equal(await kv(['GET', `jfp:bank-recorded:${copyId}`]), 'null')
  // Put back: out of holiday training, on the list again, free to record.
  const undo = await portal(lee, 'bankHolidayUndo', { id: H1.id })
  assert.equal(undo.status, 200, JSON.stringify(undo.data))
  assert.equal(await kv(['GET', `jfp:bank-recorded:${H1.id}`]), 'null')
  assert.equal((await hol('2026-winter')).totals.count, 0)
  assert.ok((await check()).before.some((x) => x.id === H1.id))
  assert.equal((await portal(lee, 'bankHolidayUndo', { id: H1.id })).status, 404)
  assert.equal((await portal(lee, 'bankHoliday', { id: H1.id, period: '2026-winter' })).status, 200)
  assert.equal((await portal(lee, 'bankHoliday', { id: H2.id, period: '2026-winter' })).status, 200)
  assert.equal((await hol('2026-winter')).totals.keptCents, 8500 + 12000)

  // Previous term: one ledger row under Term 3, the money onto the Term 3 row while it owes.
  for (const [body, status] of [[{ id: T3.id, rowId: riley3, amountCents: 45001 }, 400], [{ id: T3.id, rowId: 'recNOPE0000000000' }, 404], [{ id: 'XERO-99999999-zzzz', rowId: riley3 }, 404]]) assert.equal((await portal(lee, 'bankPreviousTerm', body)).status, status, JSON.stringify(body))
  const t3Before = (await portal(lee, 'venues', { term: 'Term 3 2026' })).data.venues
  const pt = await portal(lee, 'bankPreviousTerm', { id: T3.id, rowId: riley3, note: 'paid late' })
  assert.equal(pt.status, 200, JSON.stringify(pt.data))
  assert.deepEqual([pt.data.term, pt.data.ledger, pt.data.rowUpdated, pt.data.addedCents], ['Term 3 2026', true, true, 45000])
  let air2 = await at()
  const led = air2.ledger.filter((l) => l.fields['Payment ID'] === T3.id)
  assert.equal(led.length, 1)
  assert.deepEqual(['Term', 'Payment Method', 'Payment Status', 'Payment Date', 'Amount Paid', 'Source Record ID', 'Source Table'].map((k) => led[0].fields[k]), ['Term 3 2026', 'Bank Transfer', 'Paid', T3.date, 450, riley3, 'Term 3 Players'])
  const r3 = air2.term3.find((r) => r.id === riley3).fields
  assert.deepEqual([r3['Term 3 Amount Paid'], r3['Payment Status']], [850, 'Paid'])
  assert.match(r3['Term 3 Notes'], /^Enrolled online\.\n\d{4}-\d{2}-\d{2}: Bank transfer of A\$450 on 2026-08-05 recorded for Term 3 2026 in the JFP portal by .+ A\$450 added to the amount paid\. paid late$/)
  assert.equal((await portal(lee, 'bankPreviousTerm', { id: T3.id, rowId: riley3 })).status, 409, 'never twice')
  assert.equal((await portal(lee, 'recordPayment', { rowIds: [air.term4[1].id], amountCents: 45000, date: T3.date, externalId: T3.id })).status, 409)
  assert.ok(!(await check()).before.some((x) => x.id === T3.id))
  // Showing Term 3 2026 (from its ledger) has it, as bank transfer money at the row's venue.
  const t3After = (await portal(lee, 'venues', { term: 'Term 3 2026' })).data.venues
  assert.equal(t3After.incomeCents, t3Before.incomeCents + 45000)
  const hq = (v) => v.venues.find((x) => x.name === 'Belrose HQ')
  assert.equal(hq(t3After).bankCents, hq(t3Before).bankCents + 45000)
  // Already marked paid on Term 3 (and in no ledger): the ledger row only, nothing added to the row.
  const pt2 = await portal(lee, 'bankPreviousTerm', { id: T3b.id, rowId: sasha3 })
  assert.deepEqual([pt2.status, pt2.data.addedCents, pt2.data.rowUpdated], [200, 0, true])
  air2 = await at()
  const s3 = air2.term3.find((r) => r.id === sasha3).fields
  assert.deepEqual([s3['Term 3 Amount Paid'], s3['Payment Status']], [undefined, 'Paid'])
  assert.match(s3['Term 3 Notes'], /Already marked paid, so it was only added to the payment ledger\./)
  assert.equal(air2.ledger.filter((l) => l.fields['Payment ID'] === T3b.id && l.fields.Term === 'Term 3 2026').length, 1)
  const log = (await portal(lee, 'audit', { limit: 40 })).data.entries
  for (const a of ['money.bankHoliday', 'money.bankHolidayUndo', 'money.bankPreviousTerm']) assert.ok(log.some((e) => e.action === a), a)
  // The built portal carries the new view and buttons.
  const fs = await import('node:fs')
  const html = fs.readFileSync(new URL('../dist/jfp-portal/index.html', import.meta.url), 'utf8')
  const js = fs.readFileSync(new URL(`../dist/${html.match(/<script type="module" src="\/(_astro\/jfp-portal[^"]+\.js)"/)[1]}`, import.meta.url), 'utf8')
  for (const t of ['holidayMoney', 'Add to your sheet', 'Holiday revenue', 'Previous term', 'bankPreviousTerm', 'Before this term', 'Looks like holiday training']) assert.ok(js.includes(t), `the built bundle has ${t}`)
})

await test('player information: the family saves it, staff see it and edit it, the family sees that; nobody else sees it', async () => {
  const fam = client()
  await signIn(fam, 'returning@example.com')
  const before = (await fam.call('/api/jfp-account', { action: 'profiles' })).data
  const riley = before.players.find((p) => /riley/i.test(p.name))
  assert.ok(riley, 'a booked player is listed')
  assert.equal(riley.profile, null, 'nothing saved yet')
  assert.equal((await fam.call('/api/jfp-account', { action: 'saveProfile', playerKey: riley.key, values: { emergencyPhone: '123' } })).status, 400, 'a real phone number')
  const save = await fam.call('/api/jfp-account', { action: 'saveProfile', playerKey: riley.key, values: { club: 'Manly United', team: 'U12 Div 1', level: 'Club Division 1', positions: ['Winger', 'Nonsense'], foot: 'Left', emergencyName: 'Gran', emergencyPhone: '0400 111 222', medical: 'Asthma puffer in bag' } })
  assert.equal(save.status, 200, JSON.stringify(save.data))
  assert.deepEqual(save.data.profile.positions, ['Winger'], 'only real positions are kept')
  const row = (await at()).profiles.find((r) => r.fields['Player Key'] === `rileyreturning|returning@example.com`)
  assert.ok(row, 'one row in JFP Player Profiles')
  assert.equal(row.fields['Updated From'], 'Family account')
  const log = (await portal(lee, 'audit', { limit: 20 })).data.entries.find((e) => e.action === 'profile.save')
  assert.ok(log && !JSON.stringify(log).includes('Asthma'), 'the audit names the fields, never the medical note')
  // Staff see it on the Players tab, and filter by it.
  const list = (await portal(lee, 'playersList', { fresh: true })).data.players
  const p = list.find((x) => /riley/i.test(x.name))
  assert.equal(p.club, 'Manly United')
  assert.equal(p.profile.level, 'Club Division 1')
  assert.equal(p.profile.medical, undefined, 'the list never carries medical notes')
  // Staff edit it; the family sees the change.
  const g = await portal(lee, 'getProfile', { rowId: p.rowId })
  assert.equal(g.data.profile.medical, 'Asthma puffer in bag')
  assert.equal((await portal(lee, 'saveProfile', { rowId: p.rowId, values: { club: 'Manly United FC', positions: ['Striker'] } })).status, 200)
  const after = (await fam.call('/api/jfp-account', { action: 'profiles' })).data.players.find((x) => x.key === riley.key)
  assert.equal(after.profile.club, 'Manly United FC')
  assert.deepEqual(after.profile.positions, ['Striker'])
  assert.equal(after.profile.emergencyName, 'Gran', 'fields staff did not send are kept')
  assert.equal(after.profile.updatedFrom, 'Staff portal')
  // Another family: none of it, and cannot save over it.
  const other = client()
  await signIn(other, 'parent1@example.com')
  const theirs = (await other.call('/api/jfp-account', { action: 'profiles' })).data.players
  assert.ok(!theirs.some((x) => x.key === riley.key))
  assert.equal((await other.call('/api/jfp-account', { action: 'saveProfile', playerKey: riley.key, values: { club: 'Hacked' } })).status, 404)
})

await test('my profile: a Pro is the player (My profile), adults can enter a 1989 date of birth, and a photo saves to Airtable for staff and coaches', async () => {
  const add = await portal(lee, 'addPlayer', { groupId: TUE420, player: { name: 'Pat Self' }, parent: { email: 'self@example.com' }, payment: 'sessions', sendEmail: false, force: true })
  assert.equal(add.status, 200, JSON.stringify(add.data))
  const pro = client()
  await signIn(pro, 'self@example.com')
  const ov = (await pro.call('/api/jfp-account', { action: 'overview' })).data
  assert.equal(ov.players.length, 1)
  assert.equal(ov.players[0].self, true, 'a Pro with their own account is the player')
  const pf = (await pro.call('/api/jfp-account', { action: 'profiles' })).data
  const me = pf.players[0]
  assert.equal(me.self, true)
  assert.ok(pf.dob.min <= '1989-01-01', 'adult dates of birth are allowed')
  assert.equal((await pro.call('/api/jfp-account', { action: 'saveProfile', playerKey: me.key, values: { dob: '1989-06-15' } })).status, 200, 'a 1989 date of birth saves')
  assert.equal((await pro.call('/api/jfp-account', { action: 'saveProfile', playerKey: me.key, values: { dob: '2030-01-01' } })).status, 400, 'a future date does not')
  assert.equal((await pro.call('/api/jfp-account', { action: 'savePhoto', playerKey: me.key, image: 'data:text/html;base64,PGI+' })).status, 400, 'only images')
  const jpeg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q=='
  const up = await pro.call('/api/jfp-account', { action: 'savePhoto', playerKey: me.key, image: jpeg })
  assert.equal(up.status, 200, JSON.stringify(up.data))
  assert.match(up.data.profile.photo, /^https:\/\//, 'the photo comes back as an Airtable link')
  assert.equal(up.data.profile.dob, '1989-06-15', 'the details are kept')
  const again = await pro.call('/api/jfp-account', { action: 'savePhoto', playerKey: me.key, image: jpeg })
  const row = (await at()).profiles.find((r) => (r.fields['Term 4 Record IDs'] || '').includes(ov.players[0].enrolments[0]?.rowId || 'x') || r.fields['Player Key'] === `${me.key}|self@example.com`)
  assert.equal((row.fields.Photo || []).length, 1, 'a new photo replaces the old one')
  assert.equal((await pro.call('/api/jfp-account', { action: 'overview' })).data.players[0].photo, again.data.profile.photo, 'the account shows it')
  const list = (await portal(lee, 'playersList', { fresh: true })).data.players.find((x) => x.name === 'Pat Self')
  assert.equal(list.profile.photo, again.data.profile.photo, 'staff see it on the Players tab')
  const rm = await pro.call('/api/jfp-account', { action: 'savePhoto', playerKey: me.key, remove: true })
  assert.equal(rm.data.profile.photo, '', 'and it can be removed')
  // A parent's account is not "my profile".
  const fam = client()
  await signIn(fam, 'returning@example.com')
  assert.ok((await fam.call('/api/jfp-account', { action: 'profiles' })).data.players.every((p) => p.self === false), 'a family with children sees Player information')
})

await test('keep my spot: before next term opens a family can say they want it, with no payment; staff see it once', async () => {
  const fam = client()
  await signIn(fam, 'returning@example.com')
  const ov = (await fam.call('/api/jfp-account', { action: 'overview' })).data
  assert.ok(ov.keep && ov.keep.players.length, 'current spots are listed')
  assert.equal(ov.keep.open, false)
  const rowId = ov.keep.players[0].rowId
  const tgBefore = (await (await fetch(`${B}/__telegram`)).json()).length
  assert.equal((await fam.call('/api/jfp-account', { action: 'nextTermInterest', rowId })).status, 200)
  assert.equal((await fam.call('/api/jfp-account', { action: 'nextTermInterest', rowId })).status, 200, 'pressing twice is fine')
  const tg = await (await fetch(`${B}/__telegram`)).json()
  assert.equal(tg.length - tgBefore, 1, 'staff are told once')
  const again = (await fam.call('/api/jfp-account', { action: 'overview' })).data
  assert.equal(again.keep.players.find((x) => x.rowId === rowId).interested, true)
  assert.equal(again.nextTerm, null, 'no hold or pay buttons before it opens')
  assert.equal((await fam.call('/api/jfp-account', { action: 'nextTermChoice', rowId, choice: 'hold' })).status, 403, 'interest never unlocks paying')
  const staff = (await portal(lee, 'nextTerm')).data
  assert.ok(staff.players.find((x) => x.rowId === rowId).interested, 'the Next term tab shows it')
  assert.equal(staff.totals.interested >= 1, true)
  const other = client()
  await signIn(other, 'parent1@example.com')
  assert.equal((await other.call('/api/jfp-account', { action: 'nextTermInterest', rowId })).status, 404, 'only for your own players')
})

await test('trials: a dated trial shows to its coach, on that date only, and the coach tells Lee and Ligia how it went', async () => {
  const dates = (await portal(lee, 'pricing')).data
  const add = await portal(lee, 'addPlayer', { groupId: TUE420, force: true, player: { name: 'Tia Trial', age: 10 }, parent: { name: 'Tia Parent', email: 'tia@example.com', mobile: '0400 333 444' }, payment: 'trial', startDate: '2026-10-13' })
  assert.equal(add.status, 200, JSON.stringify(add.data))
  const row = (await at()).term4.find((r) => r.id === add.data.rowId).fields
  assert.match(row['Term 4 Notes'], /Trial offered for 2026-10-13/)
  assert.equal(row['Term 4 Payment Type'], 'JFP Trial')
  const sam = (await portal(lee, 'coachSessions', { coachId: 'sam' })).data
  const t = sam.trials.find((x) => x.rowId === add.data.rowId)
  assert.ok(t, 'the coach sees the trial')
  assert.equal(t.date, '2026-10-13')
  const p = sam.sessions.flatMap((s) => s.players).find((x) => x.rowId === add.data.rowId)
  assert.equal(p.trial, true); assert.equal(p.trialDate, '2026-10-13')
  assert.equal((await portal(lee, 'trialFeedback', { rowId: add.data.rowId, verdict: 'Ready for this group', notes: 'short' })).status, 400, 'a few words are needed')
  const tg = (await (await fetch(`${B}/__telegram`)).json()).length
  const fb = await portal(lee, 'trialFeedback', { rowId: add.data.rowId, verdict: 'Better in another group', level: 'Above the group', best: 'Tue 5:25pm Belrose', notes: 'Sharp first touch, wants a harder group.' })
  assert.equal(fb.status, 200, JSON.stringify(fb.data))
  assert.equal((await (await fetch(`${B}/__telegram`)).json()).length, tg + 1, 'Lee and Ligia are told')
  const after = (await portal(lee, 'coachSessions', { coachId: 'sam' })).data.trials.find((x) => x.rowId === add.data.rowId)
  assert.equal(after.due, false); assert.equal(after.feedback.verdict, 'Better in another group')
  const prof = (await at()).profiles.find((r) => (r.fields['Term 4 Record IDs'] || '').includes(add.data.rowId))
  assert.match(prof.fields['Trial Feedback'], /Better in another group/)
  const pl = (await portal(lee, 'playersList', { fresh: true })).data.players.find((x) => x.rowId === add.data.rowId)
  assert.equal(pl.trialFeedback.best, 'Tue 5:25pm Belrose')
  assert.equal((await portal(lee, 'trialFeedback', { rowId: (await at()).term4[0].id, verdict: 'Ready for this group', notes: 'not a trial player' })).status, 400)
  void dates
})

console.log(`\n${passed} JFP flow checks passed`)
