// Removed players stay on file and come back easily (Lee, 14 Oct 2026: "I
// removed my test player, went to add myself back into the same session with
// a different price, and it wouldn't let me: it was gone").
// End to end against the local harness: remove with a reason, the Removed
// list and reason counts, not counted as a place or owing in Money, Find an
// existing player finds them, everything on file fills the add, re-add to the
// same group at a new price, the profile and waiver carried over (no second
// profile), a paid player kept as Dropped re-added, own contact with no group,
// and Add a family. Fake Airtable, fake Stripe, captured email.
//   npm run build && HOLIDAY_LOCAL_PORT=4821 node scripts/holiday-local.mjs   (one terminal)
//   node scripts/test-jfp-removed-flow.mjs 4821                              (another)
// Every name, email and amount here is invented.
import assert from 'node:assert/strict'

const PORT = Number(process.argv[2] || 4321)
const B = `http://localhost:${PORT}`
let passed = 0
async function test(name, fn) { await fn(); passed += 1; console.log(`ok - ${name}`) }

function client() {
  const jar = new Map()
  const call = async (path, body) => {
    const res = await fetch(`${B}${path}`, { method: body ? 'POST' : 'GET', redirect: 'manual', headers: { 'content-type': 'application/json', origin: B, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') }, body: body ? JSON.stringify(body) : undefined })
    for (const c of res.headers.getSetCookie?.() || []) { const [kv] = c.split(';'); const i = kv.indexOf('='); if (kv.slice(i + 1)) jar.set(kv.slice(0, i), kv.slice(i + 1)); else jar.delete(kv.slice(0, i)) }
    return { status: res.status, data: await res.json().catch(() => ({})) }
  }
  return { call }
}
const emails = async () => (await fetch(`${B}/__emails`)).json()
const at = async () => (await fetch(`${B}/__airtable`)).json()
async function signIn(c, email, audience = 'staff') {
  const s = await c.call('/api/jfp-auth', { action: 'start', email, audience })
  assert.equal(s.status, 200, JSON.stringify(s.data))
  const code = (await emails()).filter((e) => e.to.includes(email) && /sign-in code/.test(e.subject)).at(-1).subject.match(/(\d{6})/)[1]
  assert.equal((await c.call('/api/jfp-auth', { action: 'verify', challenge: s.data.challenge, code })).status, 200)
}
const lee = client()
await signIn(lee, 'leejones@jonerfootball.com')
const portal = (action, body = {}) => lee.call('/api/jfp-portal-data', { action, ...body })
const ok = async (action, body = {}) => { const r = await portal(action, body); assert.equal(r.status, 200, `${action}: ${JSON.stringify(r.data)}`); return r.data }
const row = async (id) => (await at()).term4.find((r) => r.id === id)
const mk = async (group) => (await ok('saveGroup', { group })).group.id
const G1 = await mk({ day: 'Thursday', time: '7:30am', location: 'Belrose HQ', coachId: 'sam', capacity: 6, mode: 'direct', minAge: 6, maxAge: 25 })
const G2 = await mk({ day: 'Thursday', time: '8:30am', location: 'Belrose HQ', coachId: 'dean', capacity: 6, mode: 'direct', minAge: 6, maxAge: 25 })
const placesIn = async (gid) => (await ok('board')).groups.find((g) => g.id === gid).players.length
const KID = { name: 'Rory Rejoin', parent: 'Ruth Rejoin', email: 'rory.rejoin@example.com', mobile: '0400 222 333', dob: '2014-05-06' }

let firstRow = '', dropped = null
await test('remove with a reason: off the group, on file in Removed with the reason, not a place, not owing', async () => {
  const add = await ok('addPlayer', { groupId: G1, player: { name: KID.name, dob: KID.dob }, parent: { name: KID.parent, email: KID.email, mobile: KID.mobile }, payment: 'none', amountCents: 85000, profile: { club: 'Rejoin Rovers', level: 'NPL', positions: ['Winger'], emergencyName: 'Gran Rejoin' } })
  firstRow = add.rowId
  assert.equal(add.profileSaved, true)
  assert.equal(await placesIn(G1), 1)
  const owingBefore = (await ok('money', { fresh: true })).money.players.find((p) => p.rowId === firstRow)
  assert.ok(owingBefore?.owingCents > 0, 'owing while in the group')
  await ok('removePlayer', { rowId: firstRow, reason: 'Time or schedule clash', details: 'Trying another day' })
  assert.equal(await placesIn(G1), 0, 'the place opens up')
  const m = (await ok('money', { fresh: true })).money
  assert.ok(!m.players.some((p) => p.rowId === firstRow), 'not on Money: no place held, nothing owing')
  const d = await ok('removed')
  dropped = d.players.find((p) => p.name === KID.name)
  assert.ok(dropped?.droppedId, 'in Removed players')
  assert.equal(dropped.reason, 'Time or schedule clash'); assert.equal(dropped.details, 'Trying another day')
  assert.ok(dropped.removedAt && dropped.removedBy, 'when and by whom')
  assert.equal(dropped.groupId, G1, 'the group they were in')
  assert.ok(d.counts.some((c) => c.reason === 'Time or schedule clash' && c.count >= 1), 'reasons counted for the term')
  const prof = (await at()).profiles.filter((p) => p.fields['Player Key'] === `roryrejoin|${KID.email}`)
  assert.equal(prof.length, 1, 'player information is never deleted')
})

await test('Find an existing player finds them, with when and why', async () => {
  const r = (await ok('searchPlayers', { q: 'rory rej' })).results
  const hit = r.find((x) => x.name === KID.name)
  assert.ok(hit?.removed, JSON.stringify(r))
  assert.match(hit.removed.label, /^Removed \d{1,2} \w{3}: Time or schedule clash$/)
  assert.equal(hit.removed.droppedId, dropped.droppedId); assert.equal(hit.email, KID.email)
})

await test('picking them fills everything: contacts, own contact, player information, the group they were in', async () => {
  const p = (await ok('removedPlayer', { droppedId: dropped.droppedId })).player
  assert.deepEqual([p.name, p.parentName, p.email, p.mobile, p.ownContact], [KID.name, KID.parent, KID.email, KID.mobile, false])
  assert.equal(p.dob, KID.dob)
  assert.equal(p.profile.club, 'Rejoin Rovers'); assert.deepEqual(p.profile.positions, ['Winger']); assert.equal(p.profile.emergencyName, 'Gran Rejoin')
  assert.equal(p.removed.groupId, G1); assert.equal(p.removed.reason, 'Time or schedule clash')
  assert.equal((await portal('removedPlayer', { droppedId: 'recNOTREAL0000000' })).status, 404)
})

let secondRow = ''
await test('re-add to the same group at a different price works, and the removal says they are back', async () => {
  const back = await ok('addPlayer', { groupId: G1, player: { name: KID.name, dob: KID.dob }, parent: { name: KID.parent, email: KID.email, mobile: KID.mobile }, payment: 'offline', amountCents: 42500, method: 'Cash', profile: { club: 'Rejoin Rovers' }, fromRemoved: dropped.droppedId })
  secondRow = back.rowId
  assert.notEqual(secondRow, firstRow)
  const f = (await row(secondRow)).fields
  assert.equal(f['Term 4 Fee'], 425); assert.equal(f['Term 4 Payment Status'], 'Paid')
  assert.match(f['Term 4 Notes'], /Added back after being removed .* \(Time or schedule clash\)\./)
  assert.equal(await placesIn(G1), 1)
  const d = (await at()).dropped.find((x) => x.id === dropped.droppedId).fields
  assert.equal(d.Restored, true)
  assert.match(d['Reason details'], new RegExp(`Trying another day\\nAdded back \\d{4}-\\d{2}-\\d{2} by .+ to Thursday 7:30am, Belrose HQ as ${secondRow}\\.`))
  assert.equal(d['Reason for leaving'], 'Time or schedule clash', 'why they left is kept')
  const prof = (await at()).profiles.filter((p) => p.fields['Player Key'] === `roryrejoin|${KID.email}`)
  assert.equal(prof.length, 1, 'no second profile')
  assert.match(prof[0].fields['Term 4 Record IDs'], new RegExp(secondRow))
  assert.equal(prof[0].fields.Level, 'NPL', 'player information carried over')
  assert.equal((await portal('restorePlayer', { droppedId: dropped.droppedId })).status, 409, 'cannot be restored a second time')
  const log = (await ok('audit', { limit: 50 })).entries
  assert.ok(log.some((e) => e.action === 'player.addBack' && e.target === secondRow))
  const s = (await ok('searchPlayers', { q: 'rory rej' })).results.filter((x) => x.name === KID.name)
  assert.equal(s.length, 1); assert.ok(!s[0].removed, 'found as a Term 4 player now, not as removed'); assert.match(s[0].source, /^Term 4/)
  // Removed keeps the history, marked back.
  assert.equal((await ok('removed')).players.find((p) => p.droppedId === dropped.droppedId).restored, true)
})

await test('a player who paid stays as Dropped (Money keeps the payment) and can still be re-added to the same group', async () => {
  const PAID = { name: 'Paige Paidup', email: 'paige.paidup@example.com' }
  const add = await ok('addPlayer', { groupId: G2, player: { name: PAID.name }, parent: { name: 'Pat Paidup', email: PAID.email }, payment: 'none', amountCents: 85000 })
  await ok('recordPayment', { rowId: add.rowId, amountCents: 85000, method: 'cash' })
  await ok('removePlayer', { rowId: add.rowId, reason: 'Cost' })
  assert.equal((await row(add.rowId)).fields['Term 4 Confirmation'], 'Dropped', 'kept because money was paid')
  let m = (await ok('money', { fresh: true })).money
  assert.ok(!m.players.some((p) => p.rowId === add.rowId), 'not a place, not owing')
  const hq = m.locations.find((l) => l.id === 'belrose')
  assert.ok(hq.removedCents >= 85000, 'its money shows as from players since removed')
  const hit = (await ok('searchPlayers', { q: 'paige' })).results
  assert.equal(hit.length, 1, 'once, as removed (not also as the Dropped row)'); assert.match(hit[0].removed.label, /: Cost$/)
  const again = await ok('addPlayer', { groupId: G2, player: { name: PAID.name }, parent: { name: 'Pat Paidup', email: PAID.email }, payment: 'sessions', perSessionCents: 5000, fromRemoved: hit[0].removed.droppedId })
  assert.equal(await placesIn(G2), 1, 'the duplicate guard ignores the removed row')
  m = (await ok('money', { fresh: true })).money
  assert.ok(m.players.some((p) => p.rowId === again.rowId))
  assert.ok(m.locations.find((l) => l.id === 'belrose').removedCents >= 85000, 'the old payment still counted where it was')
})

await test('own contact, removed, comes back with no group from the Players tab add', async () => {
  const OWN = { name: 'Oscar Owncontact', email: 'oscar.own@example.com' }
  const add = await ok('addPlayerNoGroup', { player: { name: OWN.name, dob: '1995-01-02' }, parent: { email: OWN.email, mobile: '0400 999 888' }, ownContact: true, payment: 'none' })
  await ok('removePlayer', { rowId: add.rowId, reason: 'Taking a break' })
  const hit = (await ok('searchPlayers', { q: 'oscar own' })).results[0]
  assert.equal(hit.ownContact, true); assert.equal(hit.parentName, '')
  const p = (await ok('removedPlayer', { droppedId: hit.removed.droppedId })).player
  assert.equal(p.ownContact, true); assert.equal(p.dob, '1995-01-02'); assert.equal(p.removed.groupId, '')
  const back = await ok('addPlayerNoGroup', { player: { name: OWN.name }, parent: { email: OWN.email, mobile: p.mobile }, ownContact: true, payment: 'none', fromRemoved: hit.removed.droppedId })
  assert.match((await row(back.rowId)).fields['Term 4 Notes'], /\[CONTACT:self\]/)
  assert.match((await row(back.rowId)).fields['Term 4 Notes'], /Added back after being removed/)
  assert.equal((await at()).dropped.find((x) => x.id === hit.removed.droppedId).fields.Restored, true)
})

await test('Add a family: a removed child comes back alongside a new one', async () => {
  const add = await ok('addPlayer', { groupId: G2, player: { name: 'Fern Familyback' }, parent: { name: 'Fay Familyback', email: 'fay.familyback@example.com' }, payment: 'none' })
  await ok('removePlayer', { rowId: add.rowId, reason: 'Injury', details: 'Sprained ankle' })
  const hit = (await ok('searchPlayers', { q: 'fern family' })).results[0]
  const fam = await ok('addFamily', { parent: { name: 'Fay Familyback', email: 'fay.familyback@example.com' }, sendEmail: false, children: [
    { groupId: G2, player: { name: 'Fern Familyback' }, payment: 'none', fromRemoved: hit.removed.droppedId },
    { groupId: G2, player: { name: 'Finn Familyback' }, payment: 'none' },
  ] })
  const [fern, finn] = fam.rows
  assert.match((await row(fern.rowId)).fields['Term 4 Notes'], /Added back after being removed .* \(Injury\)\./)
  assert.doesNotMatch((await row(finn.rowId)).fields['Term 4 Notes'], /Added back/)
  const d = (await at()).dropped.find((x) => x.id === hit.removed.droppedId).fields
  assert.equal(d.Restored, true); assert.match(d['Reason details'], /Sprained ankle\nAdded back/)
})

await test('the waiver and date of birth on file are carried over', async () => {
  const seeded = (await at()).term4.find((r) => r.fields['Player Name'] === 'Riley Returning')
  await ok('removePlayer', { rowId: seeded.id, reason: 'Club or school commitments' })
  const hit = (await ok('searchPlayers', { q: 'riley ret' })).results.find((x) => x.removed)
  assert.ok(hit, 'found as removed')
  const p = (await ok('removedPlayer', { droppedId: hit.removed.droppedId })).player
  assert.equal(p.waiver, true); assert.equal(p.dob, '2015-03-02')
  const back = await ok('addPlayer', { groupId: G2, player: { name: p.name, dob: p.dob }, parent: { name: p.parentName, email: p.email, mobile: p.mobile }, payment: 'none', fromRemoved: hit.removed.droppedId })
  const listed = (await ok('playersList', { fresh: true })).players.find((x) => x.rowId === back.rowId)
  assert.equal(listed.waiver.onFile, true, 'no new waiver needed')
})

await test('a stale or made-up removal id never blocks an add', async () => {
  const r = await ok('addPlayerNoGroup', { player: { name: 'Nia Newcomer' }, parent: { email: 'nia.new@example.com' }, payment: 'none', fromRemoved: 'recNOTREAL0000000' })
  assert.doesNotMatch((await row(r.rowId)).fields['Term 4 Notes'], /Added back/)
  const r2 = await ok('addPlayerNoGroup', { player: { name: 'Noa Newcomer' }, parent: { email: 'noa.new@example.com' }, payment: 'none', fromRemoved: dropped.droppedId })
  assert.doesNotMatch((await row(r2.rowId)).fields['Term 4 Notes'], /Added back/, 'a removal already marked back is not reused')
})

console.log(`\n${passed} removed player checks passed`)
