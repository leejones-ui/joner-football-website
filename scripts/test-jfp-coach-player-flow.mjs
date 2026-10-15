// A coach taps a player in My sessions and sees their football information
// (Lee, 15 Oct 2026), end to end against the local harness:
//   npm run build && node scripts/holiday-local.mjs 4321
//   node scripts/test-jfp-coach-player-flow.mjs 4321
// Club, team, age, level, positions, what they want to work on and the note
// from Lee and Ligia. Only their own players; never contacts or medical notes.
// Every name here is invented.
import assert from 'node:assert/strict'

const PORT = process.argv[2] || '4321'
const B = `http://localhost:${PORT}`
let passed = 0
async function test(name, fn) { await fn(); passed += 1; console.log(`ok - ${name}`) }
function client() {
  const jar = new Map()
  const call = async (p, body) => {
    const res = await fetch(`${B}${p}`, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', origin: B, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') }, body: body ? JSON.stringify(body) : undefined })
    for (const c of res.headers.getSetCookie?.() || []) { const [kv] = c.split(';'); const i = kv.indexOf('='); if (kv.slice(i + 1)) jar.set(kv.slice(0, i), kv.slice(i + 1)); else jar.delete(kv.slice(0, i)) }
    return { status: res.status, data: await res.json().catch(() => ({})) }
  }
  return { call }
}
const emails = async () => (await fetch(`${B}/__emails`)).json()
async function signIn(c, email) {
  const s = await c.call('/api/jfp-auth', { action: 'start', email, audience: 'staff' })
  assert.equal(s.status, 200, JSON.stringify(s.data))
  const code = (await emails()).filter((e) => e.to.includes(email) && /sign-in code/.test(e.subject)).at(-1).subject.match(/(\d{6})/)[1]
  assert.equal((await c.call('/api/jfp-auth', { action: 'verify', challenge: s.data.challenge, code })).status, 200)
}
const lee = client(), sam = client(), dean = client()
await signIn(lee, 'leejones@jonerfootball.com')
await signIn(sam, 'jonerfootballsam@gmail.com')
await signIn(dean, 'jonerfootballdean@gmail.com')
const L = (action, b = {}) => lee.call('/api/jfp-portal-data', { action, ...b })
const ok = async (action, b) => { const r = await L(action, b); assert.equal(r.status, 200, `${action}: ${JSON.stringify(r.data)}`); return r.data }

const G = (await ok('saveGroup', { group: { day: 'Thursday', time: '4:15pm', location: 'Belrose HQ', coachId: 'sam', capacity: 10, mode: 'direct' } })).group.id
const rowId = (await ok('addPlayer', { groupId: G, force: true, player: { name: 'Remy Calloway', age: 12 }, parent: { name: 'Remy Parent', email: 'remy.c@example.com', mobile: '0400 333 444' }, payment: 'trial' })).rowId
await ok('saveProfile', { rowId, values: { club: 'Gladesville Ravens', team: 'U12 Div 1', level: 'Club Division 1', positions: ['Winger', 'Striker'], foot: 'Left', goals: 'Weak foot finishing. Shy at first, give him time.', medical: 'Asthma, puffer in bag', emergencyName: 'Aunt Example', emergencyPhone: '0400 999 888' } })
await ok('setCoachNote', { rowId, text: 'Back from a sprained ankle, ease in' })

await test('Sam sees his player: plays for, level, positions, foot, what they want to work on, the note; no contacts or medical', async () => {
  const r = await sam.call('/api/jfp-portal-data', { action: 'coachPlayer', rowId })
  assert.equal(r.status, 200, JSON.stringify(r.data))
  const p = r.data.player
  assert.deepEqual([p.name, p.club, p.team, p.level, p.positions, p.foot, p.trial], ['Remy Calloway', 'Gladesville Ravens', 'U12 Div 1', 'Club Division 1', ['Winger', 'Striker'], 'Left', true])
  assert.match(p.goals, /Weak foot finishing/)
  assert.equal(p.note, 'Back from a sprained ankle, ease in')
  const all = JSON.stringify(r.data)
  for (const bad of ['Asthma', '0400', 'remy.c@example.com', 'Remy Parent', 'Aunt Example', 'feeCents', 'paidCents']) assert.ok(!all.includes(bad), `no ${bad}`)
})

await test('Dean is not this player\'s coach: refused', async () => {
  const r = await dean.call('/api/jfp-portal-data', { action: 'coachPlayer', rowId })
  assert.equal(r.status, 404)
  assert.match(r.data.error, /not in your sessions/)
})

console.log(`${passed} coach player checks passed`)
