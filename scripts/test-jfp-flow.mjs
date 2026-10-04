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
  for (const action of ['board', 'money', 'payments', 'addPlayer', 'getSettings', 'requests']) assert.equal((await portal(dean, action)).status, 403, `${action} is admin only`)
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
  assert.equal((await portal(lee, 'saveGroup', { group: { day: 'Thursday', time: '6:30am', location: 'NTRA', coachId: 'lee', capacity: 8, mode: 'application' } })).status, 409, 'no single group on top of a split session')
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
  const left = pr.datesByDay.Monday.filter((x) => !x.past).length
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

console.log(`\n${passed} JFP flow checks passed`)
