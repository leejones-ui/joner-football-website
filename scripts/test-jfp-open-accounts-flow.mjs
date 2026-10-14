// Open accounts (Lee, 14 Oct 2026, round 2 item 8), end to end against the
// local harness: anyone can make a Joner Football account and fill in player
// profiles with no session booked, sign the waiver, and staff find them under
// "Accounts with no session" and add them to a group with the profile linked.
// Sign-ups are rate limited; nothing here ever writes a Term 4 row.
//   npm run build && HOLIDAY_LOCAL_PORT=4681 node scripts/holiday-local.mjs   (one terminal)
//   node scripts/test-jfp-open-accounts-flow.mjs 4681                        (another)
// Every name and email here is invented.
import assert from 'node:assert/strict'

const PORT = Number(process.argv[2] || 4321)
const B = `http://localhost:${PORT}`
let passed = 0
async function test(name, fn) { await fn(); passed += 1; console.log(`ok - ${name}`) }

let ipSeq = 10
function client(ip = `10.9.3.${ipSeq++}`) {
  const jar = new Map()
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
async function signIn(c, email, audience = 'parent') {
  const s = await c.call('/api/jfp-auth', { action: 'start', email, audience })
  assert.equal(s.status, 200, JSON.stringify(s.data))
  const code = (await emails()).filter((e) => e.to.includes(email) && /sign-in code/.test(e.subject)).at(-1).subject.match(/(\d{6})/)[1]
  return c.call('/api/jfp-auth', { action: 'verify', challenge: s.data.challenge, code })
}
const acct = (c, action, body = {}) => c.call('/api/jfp-account', { action, ...body })
const GUARDIAN = { accepted: { terms: true, makeups: true, payment: true, emergency: true }, media: false, kind: 'guardian' }
const ADULT = { accepted: { terms: true, makeups: true, payment: true, emergency: true, adult: true }, media: false, kind: 'adult' }

const lee = client()
assert.equal((await signIn(lee, 'leejones@jonerfootball.com', 'staff')).status, 200)
const portal = async (action, body = {}) => lee.call('/api/jfp-portal-data', { action, ...body })
const G = (await portal('saveGroup', { group: { day: 'Wednesday', time: '5:40pm', location: 'Belrose HQ', coachId: 'sam', capacity: 12, mode: 'direct', minAge: 5, maxAge: 18 } })).data.group
assert.equal((await portal('setCoachAlerts', { newPlayer: true })).data.newPlayer, true)
const term4Count = async () => (await at()).term4.length
const T4 = await term4Count()

const PARENT = 'ola.open@example.com'
const mum = client()
await test('a brand new email signs in: an account record, no players, "Book a session"', async () => {
  const v = await signIn(mum, PARENT)
  assert.equal(v.status, 200, JSON.stringify(v.data))
  const rec = JSON.parse(await kv(['HGET', 'jfp:accounts', PARENT]))
  assert.equal(rec.kind, 'new'); assert.ok(rec.createdAt)
  const d = (await acct(mum, 'overview')).data
  assert.deepEqual(d.players, []); assert.equal(d.bookUrl, '/jfp-booking/')
  assert.equal(await term4Count(), T4, 'no Term 4 row')
})

let kipKey = ''
await test('Add a player: a profile only (name, date of birth, club, level, parent), checked; never a Term 4 row', async () => {
  assert.equal((await acct(mum, 'addPlayer', { name: 'Kip', dob: '2015-05-05' })).status, 400, 'first and last name')
  assert.match((await acct(mum, 'addPlayer', { name: 'Kip Open' })).data.error, /date of birth/)
  assert.match((await acct(mum, 'addPlayer', { name: 'Kip Open', dob: '2015-05-05', self: true })).data.error, /Under 18/)
  const r = await acct(mum, 'addPlayer', { name: 'Kip Open', dob: '2015-05-05', values: { club: 'Test Valley FC', level: 'NPL', parentName: 'Ola Open', parentMobile: '0400 123 456' } })
  assert.equal(r.status, 200, JSON.stringify(r.data))
  kipKey = r.data.key
  assert.equal(r.data.profile.club, 'Test Valley FC')
  const prof = (await at()).profiles.find((x) => x.fields['Player Name'] === 'Kip Open')
  assert.equal(prof.fields['Family Emails'], PARENT); assert.equal(prof.fields['Term 4 Record IDs'] || '', '')
  assert.equal((await acct(mum, 'addPlayer', { name: 'kip open', dob: '2015-05-05' })).status, 409, 'not twice')
  assert.equal(await term4Count(), T4, 'still no Term 4 row')
})

await test('the account shows the player with no session; profile, photo-free details and the waiver all work', async () => {
  let d = (await acct(mum, 'overview')).data
  const kip = d.players.find((p) => p.key === kipKey)
  assert.ok(kip, JSON.stringify(d.players)); assert.equal(kip.noSession, true); assert.deepEqual(kip.enrolments, []); assert.equal(kip.waiver.onFile, false); assert.equal(kip.adult, false)
  const profs = (await acct(mum, 'profiles')).data
  assert.equal(profs.players.find((p) => p.key === kipKey).noSession, true)
  const s = await acct(mum, 'saveProfile', { playerKey: kipKey, values: { positions: ['Winger'], foot: 'Left', emergencyName: 'Gran Open', emergencyPhone: '0400 123 457' } })
  assert.equal(s.status, 200, JSON.stringify(s.data)); assert.deepEqual(s.data.profile.positions, ['Winger'])
  const w = await acct(mum, 'signWaiver', { players: [{ key: kipKey, emergencyName: 'Gran Open', emergencyPhone: '0400 123 457' }], waiver: { ...GUARDIAN, signature: 'Ola Open' }, parentName: 'Ola Open', mobile: '0400 123 456' })
  assert.equal(w.status, 200, JSON.stringify(w.data)); assert.equal(w.data.created, 1)
  d = (await acct(mum, 'overview')).data
  assert.equal(d.players.find((p) => p.key === kipKey).waiver.onFile, true, 'waiver signed with no session')
  assert.equal(await term4Count(), T4, 'the waiver writes no Term 4 row')
})

await test('an adult signs up for themselves: own profile, adult waiver, "My profile"', async () => {
  const me = client()
  assert.equal((await signIn(me, 'ren.self@example.com')).status, 200)
  const r = await acct(me, 'addPlayer', { name: 'Ren Self', dob: '1995-02-02', self: true, values: { club: 'Sunday League' } })
  assert.equal(r.status, 200, JSON.stringify(r.data))
  const d = (await acct(me, 'overview')).data
  assert.equal(d.self, true); assert.equal(d.players[0].adult, true)
  const w = await acct(me, 'signWaiver', { players: [{ key: r.data.key, emergencyName: 'Pal Self', emergencyPhone: '0400 222 333' }], waiver: { ...ADULT, signature: 'Ren Self' }, parentName: 'Ren Self', mobile: '0400 222 334' })
  assert.equal(w.status, 200, JSON.stringify(w.data))
})

await test('staff: Accounts with no session lists Kip; Add to a group links the same profile, tells the coach, and Kip leaves the list', async () => {
  let list = (await portal('playersList', { fresh: true })).data
  const a = list.accounts.find((x) => x.name === 'Kip Open')
  assert.ok(a, JSON.stringify(list.accounts)); assert.equal(a.email, PARENT); assert.equal(a.club, 'Test Valley FC'); assert.equal(a.parentName, 'Ola Open'); assert.equal(a.mobile, '0400 123 456')
  const before = (await at()).profiles.length
  const add = await portal('addPlayer', { groupId: G.id, force: true, player: { name: a.name, dob: a.dob }, parent: { name: a.parentName, email: a.email, mobile: a.mobile }, payment: 'none', profile: { dob: a.dob } })
  assert.equal(add.status, 200, JSON.stringify(add.data)); assert.equal(add.data.profileLinked, true)
  assert.equal((await at()).profiles.length, before, 'the same profile, not a second one')
  const prof = (await at()).profiles.find((x) => x.fields['Player Name'] === 'Kip Open')
  assert.match(prof.fields['Term 4 Record IDs'], new RegExp(add.data.rowId))
  assert.ok(JSON.parse(await kv(['HGET', 'jfp:coach-news', 'sam']) || '{"items":[]}').items.some((x) => x.rowId === add.data.rowId), 'the coach is told')
  list = (await portal('playersList', { fresh: true })).data
  assert.ok(!list.accounts.some((x) => x.name === 'Kip Open'))
  const row = list.players.find((x) => x.rowId === add.data.rowId)
  assert.equal(row.profile.club, 'Test Valley FC', 'staff see the family\'s profile straight away')
  const d = (await acct(mum, 'overview')).data
  assert.equal(d.players.filter((p) => p.name === 'Kip Open').length, 1); assert.equal(d.players[0].enrolments.length, 1)
})

await test('sign-ups are limited per connection; a family we know is never held up; no Term 4 rows from any of it', async () => {
  const T = await term4Count()
  await portal('addPlayer', { groupId: G.id, force: true, player: { name: 'Val Known' }, parent: { name: 'Vic Known', email: 'vic.known@example.com' }, payment: 'none' })
  const ip = '10.9.4.1'
  let limited = null
  for (let i = 0; i < 12; i++) {
    const v = await signIn(client(ip), `spam${i}.open@example.com`)
    if (v.status === 429) { limited = { i, ...v.data }; break }
    assert.equal(v.status, 200)
  }
  assert.ok(limited, 'the 11th new account from one connection is refused')
  assert.equal(limited.i, 10); assert.equal(limited.code, 'signup')
  assert.equal((await signIn(client(ip), 'vic.known@example.com')).status, 200, 'a known family still signs in from there')
  assert.equal(await term4Count(), T + 1, 'only the row staff added')
})

console.log(`\n${passed} open account flow checks passed`)
