// End to end checks for JFP term bookings against the local harness.
// Start it first:  HOLIDAY_LOCAL_PORT=4340 node scripts/holiday-local.mjs
// Then:            node scripts/test-jfp-flow.mjs 4340
//
// Fake Airtable, fake Stripe, captured emails. No real money, no real family.
import assert from 'node:assert/strict'

const PORT = Number(process.argv[2] || 4340)
const B = `http://localhost:${PORT}`
const ORIGIN = { origin: B }
let passed = 0
async function test(name, fn) { await fn(); passed += 1; console.log(`ok - ${name}`) }
const j = async (r) => ({ status: r.status, body: await r.json().catch(() => ({})), cookie: (r.headers.get('set-cookie') || '').split(';')[0] })
const emails = async () => (await fetch(`${B}/__emails`)).json()
const at = async () => (await fetch(`${B}/__airtable`)).json()
const lastEmail = async (to, subject) => (await emails()).filter((e) => e.to.includes(to) && (!subject || e.subject.includes(subject))).at(-1)

async function sessionPost(body, cookie = '') {
  return j(await fetch(`${B}/api/jfp-session`, { method: 'POST', headers: { 'content-type': 'application/json', ...ORIGIN, cookie }, body: JSON.stringify(body) }))
}
async function portal(action, cookie, extra = {}, headers = ORIGIN) {
  return j(await fetch(`${B}/api/jfp-portal-data`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers, cookie }, body: JSON.stringify({ action, ...extra }) }))
}
let parent = ''
async function book(body) { return j(await fetch(`${B}/api/jfp-book`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: parent }, body: JSON.stringify(body) })) }
async function groups() { return (await j(await fetch(`${B}/api/jfp-groups`, { headers: { cookie: parent } }))).body.groups }
const stripe = (cs, action) => fetch(`${B}/mock-stripe/?cs=${cs}&action=${action}`, { redirect: 'manual' })
const csOf = (url) => url.split('cs=')[1]
const kid = (name, age = 10) => ({ name, age })
const contact = (email) => ({ parentName: 'Test Parent', mobile: '0400000000', email, agreementAccepted: true })

// Sign in helper that follows the emailed code for finance roles.
async function signIn(email, password) {
  const first = await sessionPost({ action: 'login', email, password })
  if (first.body.needCode) {
    const mail = await lastEmail(email, 'sign-in code')
    const code = /(\d{6})/.exec(mail.subject)[1]
    const second = await sessionPost({ action: 'verify', challenge: first.body.challenge, code })
    assert.equal(second.status, 200)
    return second.cookie
  }
  assert.equal(first.status, 200, first.body.error)
  return first.cookie
}
async function setupFromEmail(email, password) {
  const mail = await lastEmail(email, 'JFP portal login')
  const token = /setup=([a-f0-9]{64})/.exec(mail.html)[1]
  const r = await sessionPost({ action: 'setup', token, password })
  assert.equal(r.status, 200, r.body.error)
  return token
}

let owner, ligia, dean

await test('the first owner is invited by email, sets their own password, and needs an emailed code', async () => {
  const boot = await j(await fetch(`${B}/api/jfp-session`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-jfp-bootstrap-secret': 'boot' }, body: JSON.stringify({ action: 'bootstrapOwner', email: 'lee@example.com', name: 'Lee' }) }))
  assert.equal(boot.status, 200)
  assert.equal(boot.body.token, undefined, 'the set-up link is never returned, only emailed')
  const bad = await j(await fetch(`${B}/api/jfp-session`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-jfp-bootstrap-secret': 'wrong' }, body: JSON.stringify({ action: 'bootstrapOwner', email: 'x@example.com', name: 'X' }) }))
  assert.equal(bad.status, 403)
  const token = await setupFromEmail('lee@example.com', 'a long enough password')
  const reuse = await sessionPost({ action: 'setup', token, password: 'another long password' })
  assert.equal(reuse.status, 400, 'a set-up link works once')
  const pwOnly = await sessionPost({ action: 'login', email: 'lee@example.com', password: 'a long enough password' })
  assert.equal(pwOnly.body.needCode, true)
  assert.equal(pwOnly.cookie, '', 'no session before the code')
  const wrongCode = await sessionPost({ action: 'verify', challenge: pwOnly.body.challenge, code: '000000' })
  assert.equal(wrongCode.status, 401)
  owner = await signIn('lee@example.com', 'a long enough password')
  assert.match(owner, /__Host-jfp_staff=/)
})

await test('requests from another site are refused', async () => {
  const r = await portal('overview', owner, {}, { origin: 'https://evil.example' })
  assert.equal(r.status, 403)
})

await test('groups are drafted from the Airtable roster, opening only what the records justify', async () => {
  const s = await portal('syncGroups', owner)
  assert.equal(s.status, 200)
  const g = Object.fromEntries((await portal('groups', owner)).body.groups.map((x) => [x.id, x]))
  assert.equal(g['mon-1725-belrose-hq'].mode, 'direct')
  assert.equal(g['mon-1725-belrose-hq'].capacity, 6)
  assert.equal(g['mon-1725-belrose-hq'].placesLeft, 2)
  assert.equal(g['wed-1620-belrose-hq'].placesLeft, 0)
  assert.equal(g['wed-1725-belrose-hq'].existingPlayers, 1, 'Awaiting Reply still holds a place')
  assert.equal(g['fri-1600-belrose-hq'].mode, 'application')
  assert.equal(g['fri-0630-rydalmere'].mode, 'closed')
  assert.equal(g['mon-1300-belrose-hq'].mode, 'closed')
  assert.equal(g['thu-1620-belrose-hq'], undefined, 'dropped players do not create a group')
  const again = await portal('syncGroups', owner)
  assert.equal(again.body.added, 0, 'sync never duplicates or overwrites')
})

await test('parents need the password; the page shows only open groups and no player data', async () => {
  const none = await j(await fetch(`${B}/api/jfp-groups`))
  assert.equal(none.status, 401)
  const wrong = await j(await fetch(`${B}/api/jfp-access`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'nope' }) }))
  assert.equal(wrong.status, 401)
  const ok = await j(await fetch(`${B}/api/jfp-access`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'term4' }) }))
  parent = ok.cookie
  const raw = await (await fetch(`${B}/api/jfp-groups`, { headers: { cookie: parent } })).text()
  assert.ok(!/Player \d|Parent \d|@example|0400000000/.test(raw), 'no names, emails or phones in the public API')
  const gs = JSON.parse(raw).groups
  assert.ok(!gs.some((x) => x.mode === 'closed'), 'closed groups are not listed')
  assert.equal(gs.find((x) => x.id === 'fri-1600-belrose-hq').placesLeft, null, 'application groups do not reveal numbers')
})

await test('two parents racing for the last 2 places: exactly one gets them', async () => {
  const [a, b] = await Promise.all([book({ action: 'reserve', groupId: 'mon-1725-belrose-hq', players: 2 }), book({ action: 'reserve', groupId: 'mon-1725-belrose-hq', players: 2 })])
  const wins = [a, b].filter((r) => r.status === 200)
  assert.equal(wins.length, 1)
  assert.equal([a, b].find((r) => r.status !== 200).status, 409)
  const one = await book({ action: 'reserve', groupId: 'mon-1725-belrose-hq', players: 1 })
  assert.equal(one.status, 409, 'nothing left while the 2 are held')
  globalThis.win = wins[0].body
})

await test('the holder pays for exactly their players and the enrolment lands in Airtable once', async () => {
  const w = globalThis.win
  const pay = await book({ groupId: 'mon-1725-belrose-hq', bookingId: w.bookingId, releaseToken: w.releaseToken, players: [kid('Sib One', 9), kid('Sib Two', 11)], ...contact('fam1@example.com') })
  assert.equal(pay.status, 200, pay.body.error)
  const sessions = await (await fetch(`${B}/__sessions`)).json()
  const s = sessions.find((x) => x.id === csOf(pay.body.url))
  assert.equal(s.amount_total, 170000, '2 players at A$850')
  await stripe(s.id, 'pay')
  await stripe(s.id, 'pay') // duplicate webhook
  const confirm = await j(await fetch(`${B}/api/jfp-confirm?session_id=${s.id}`))
  assert.equal(confirm.body.status, 'paid')
  assert.equal(confirm.body.booking.dates.length, 10)
  const a = await at()
  const rows = a.term4.filter((r) => String(r.fields['Term 4 Notes'] || '').includes(w.bookingId))
  assert.equal(rows.length, 2, 'one Term 4 row per player, never duplicated')
  assert.equal(rows[0].fields['Term 4 Payment Status'], 'Paid')
  assert.equal(rows[0].fields['Coach'], 'Dean Mac')
  assert.equal(rows[0].fields['Term 3 Time'], '5:25pm')
  const fee = Math.round(170000 * 0.0175) + 30
  const split = rows.map((r) => Math.round(r.fields['Term 4 Stripe Fee AUD'] * 100))
  assert.equal(split.reduce((x, y) => x + y, 0), fee, 'exact Stripe fee, split without losing a cent')
  assert.equal(rows[0].fields['Term 4 Fee Reconciliation'], 'Verified')
  const ledger = a.ledger.filter((r) => r.fields['Stripe Checkout Session ID'] === s.id)
  assert.equal(ledger.length, 1, 'one ledger row for one payment')
  assert.equal(ledger[0].fields['Amount Paid'], 1700)
  assert.equal(ledger[0].fields['Term'], 'Term 4 2026')
  const mails = (await emails()).filter((e) => e.html.includes(w.bookingId))
  assert.equal(mails.length, 3, `parent, staff and coach emails, saw ${mails.length}`)
  const coachMail = mails.find((e) => e.to.includes('jonerfootballdean@gmail.com'))
  assert.ok(!/A\$|fee/i.test(coachMail.html), 'the coach email has no money in it')
  const g = (await groups()).find((x) => x.id === 'mon-1725-belrose-hq')
  assert.equal(g.full, true, 'group now full: Airtable players plus the online ones')
})

await test('closing the form or an expired checkout frees only that family\'s places', async () => {
  const r = await book({ action: 'reserve', groupId: 'tue-1830-belrose-hq', players: 1 }).then((x) => x.status === 404 ? book({ action: 'reserve', groupId: 'wed-1725-belrose-hq', players: 3 }) : x)
  assert.equal(r.status, 200)
  const gid = 'wed-1725-belrose-hq'
  const before = (await groups()).find((x) => x.id === gid).placesLeft
  await book({ action: 'release', bookingId: r.body.bookingId, releaseToken: r.body.releaseToken })
  const after = (await groups()).find((x) => x.id === gid).placesLeft
  assert.equal(after, before + 3)
  const h = await book({ action: 'reserve', groupId: gid, players: 1 })
  const p = await book({ groupId: gid, bookingId: h.body.bookingId, releaseToken: h.body.releaseToken, players: [kid('Expire Kid')], ...contact('fam2@example.com') })
  await stripe(csOf(p.body.url), 'expire')
  assert.equal((await groups()).find((x) => x.id === gid).placesLeft, after)
  const stale = await book({ groupId: gid, bookingId: h.body.bookingId, releaseToken: h.body.releaseToken, players: [kid('Expire Kid')], ...contact('fam2@example.com') })
  assert.equal(stale.status, 409, 'a lapsed hold cannot be paid for')
})

await test('an Airtable outage during payment is recorded and repaired without duplicates', async () => {
  const h = await book({ action: 'reserve', groupId: 'wed-1725-belrose-hq', players: 1 })
  const p = await book({ groupId: 'wed-1725-belrose-hq', bookingId: h.body.bookingId, releaseToken: h.body.releaseToken, players: [kid('Outage Kid')], ...contact('fam3@example.com') })
  await fetch(`${B}/__fail?what=airtable&on=1`)
  await stripe(csOf(p.body.url), 'pay')
  await fetch(`${B}/__fail?what=airtable&on=0`)
  let b = (await portal('bookings', owner)).body.bookings.find((x) => x.id === h.body.bookingId)
  assert.equal(b.status, 'paid', 'the payment is never lost')
  assert.ok(b.effects.failed.includes('airtable'))
  const rep = await portal('repairBooking', owner, { bookingId: h.body.bookingId })
  assert.equal(rep.status, 200)
  b = (await portal('bookings', owner)).body.bookings.find((x) => x.id === h.body.bookingId)
  assert.equal(b.effects.ok, true)
  const rows = (await at()).term4.filter((r) => String(r.fields['Term 4 Notes'] || '').includes(h.body.bookingId))
  assert.equal(rows.length, 1)
})

await test('pathway: apply, get approved, pay through the private link', async () => {
  const bad = await book({ action: 'reserve', groupId: 'fri-1600-belrose-hq', players: 1 })
  assert.equal(bad.status, 404, 'pathway cannot be booked directly')
  const a = await book({ action: 'apply', groupId: 'fri-1600-belrose-hq', players: [kid('Pathway Kid', 13)], playersCount: 1, club: 'Manly U13 Div 1', ...contact('fam4@example.com') })
  assert.equal(a.status, 200)
  assert.ok(await lastEmail('fam4@example.com', 'Application received'))
  const list = (await portal('applications', owner)).body.applications
  const app = list.find((x) => x.id === a.body.applicationId)
  assert.equal(app.payToken, undefined, 'the pay token is never sent to the portal')
  await portal('decideApplication', owner, { id: app.id, decision: 'approve' })
  const mail = await lastEmail('fam4@example.com', 'Approved')
  const m = /approved=([A-Z0-9-]+)&amp;token=([a-f0-9]+)/.exec(mail.html)
  const wrong = await j(await fetch(`${B}/api/jfp-book`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'payApproved', applicationId: m[1], token: 'f'.repeat(48) }) }))
  assert.equal(wrong.status, 403)
  const go = await j(await fetch(`${B}/api/jfp-book`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'payApproved', applicationId: m[1], token: m[2] }) }))
  assert.equal(go.status, 200, go.body.error)
  await stripe(csOf(go.body.url), 'pay')
  const again = await j(await fetch(`${B}/api/jfp-book`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'payApproved', applicationId: m[1], token: m[2] }) }))
  assert.equal(again.status, 409, 'an approved family can never be charged twice')
  assert.ok((await at()).term4.some((r) => r.fields['Player Name'] === 'Pathway Kid'))
})

await test('Ligia sees everything including money, but cannot manage logins or change the price', async () => {
  await portal('invite', owner, { user: { name: 'Ligia', email: 'ligia@example.com', role: 'finance-admin' } })
  await setupFromEmail('ligia@example.com', 'ligia long password')
  ligia = await signIn('ligia@example.com', 'ligia long password')
  const o = await portal('overview', ligia)
  assert.equal(o.status, 200)
  assert.ok(o.body.finance.online.grossCents > 0)
  assert.equal((await portal('users', ligia)).status, 403)
  assert.equal((await portal('invite', ligia, { user: { name: 'X', email: 'x@example.com', role: 'owner' } })).status, 403)
  await portal('saveConfig', ligia, { config: { priceCents: 100 } })
  assert.equal((await portal('getConfig', owner)).body.config.priceCents, 85000, 'price unchanged')
})

await test('a coach sees only their own groups and players, with no money or contacts', async () => {
  await portal('invite', owner, { user: { name: 'Dean', email: 'dean@example.com', role: 'coach', coachId: 'dean' } })
  await setupFromEmail('dean@example.com', 'dean long password')
  dean = await signIn('dean@example.com', 'dean long password')
  const mine = await portal('myGroups', dean, { coachId: 'sam' })
  assert.equal(mine.status, 200)
  assert.equal(mine.body.coach, 'Dean', 'asking for another coach is ignored')
  assert.ok(mine.body.groups.every((g) => g.id !== 'wed-1620-belrose-hq'), 'no Sam groups')
  const raw = JSON.stringify(mine.body)
  assert.ok(!/@|0400000000|850|Paid|balance/i.test(raw), 'no contacts or money')
  assert.ok(mine.body.groups.find((g) => g.id === 'mon-1725-belrose-hq').players.some((p) => p.name === 'Sib One' && p.age === 9))
  assert.equal(mine.body.hours.termMinutes, mine.body.hours.perWeekMinutes * 10)
  for (const a of ['overview', 'roster', 'finance', 'bookings', 'applications', 'users', 'groups']) {
    assert.equal((await portal(a, dean)).status, 403, `coach blocked from ${a}`)
  }
})

await test('switching a login off signs that person out at once', async () => {
  await portal('setActive', owner, { email: 'dean@example.com', active: false })
  assert.equal((await portal('myGroups', dean)).status, 401)
  const again = await sessionPost({ action: 'login', email: 'dean@example.com', password: 'dean long password' })
  assert.equal(again.status, 401)
  assert.equal((await portal('setActive', owner, { email: 'lee@example.com', active: false })).status, 400, 'Lee cannot lock himself out')
})

console.log(`\n${passed} JFP flow checks passed`)
