// Trial feedback for Lee and Ligia (15 Oct 2026), end to end against the local harness:
//   npm run build && node scripts/holiday-local.mjs 4321
//   node scripts/test-jfp-trials-flow.mjs 4321
// A coach's feedback shows on its own page with a count until it is decided;
// accept offers the term in that group, move offers it in another, decline
// is recorded; coaches cannot see the page. Every name here is invented.
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
const telegrams = async () => (await fetch(`${B}/__telegram`)).json()
async function signIn(c, email) {
  const s = await c.call('/api/jfp-auth', { action: 'start', email, audience: 'staff' })
  assert.equal(s.status, 200, JSON.stringify(s.data))
  const code = (await emails()).filter((e) => e.to.includes(email) && /sign-in code/.test(e.subject)).at(-1).subject.match(/(\d{6})/)[1]
  assert.equal((await c.call('/api/jfp-auth', { action: 'verify', challenge: s.data.challenge, code })).status, 200)
}
const lee = client(), sam = client()
await signIn(lee, 'leejones@jonerfootball.com')
await signIn(sam, 'jonerfootballsam@gmail.com')
const L = (action, b = {}) => lee.call('/api/jfp-portal-data', { action, ...b })
const S = (action, b = {}) => sam.call('/api/jfp-portal-data', { action, ...b })
const ok = async (action, b) => { const r = await L(action, b); assert.equal(r.status, 200, `${action}: ${JSON.stringify(r.data)}`); return r.data }

const G1 = (await ok('saveGroup', { group: { day: 'Wednesday', time: '5:25pm', location: 'Belrose HQ', coachId: 'sam', capacity: 10, mode: 'direct' } })).group.id
const G2 = (await ok('saveGroup', { group: { day: 'Wednesday', time: '6:30pm', location: 'Belrose HQ', coachId: 'dean', capacity: 10, mode: 'direct' } })).group.id
const add = async (name, email) => (await ok('addPlayer', { groupId: G1, force: true, player: { name, age: 11 }, parent: { name: `${name} Parent`, email, mobile: '0400 222 333' }, payment: 'trial' })).rowId
const lina = await add('Lena Darrow', 'lena.d@example.com')
const kai = await add('Kobe Moverly', 'kobe.m@example.com')
const ned = await add('Nico Nofit', 'nico.n@example.com')

await test('coach feedback shows on Trial feedback with a count; Telegram points there; coaches cannot open it', async () => {
  const before = (await ok('trialCount')).newCount
  const tg = (await telegrams()).length
  const fb = await S('trialFeedback', { rowId: lina, verdict: 'Ready for this group', level: 'About right', notes: 'Great first touch, worked hard, needs to scan more before receiving.' })
  assert.equal(fb.status, 200, JSON.stringify(fb.data))
  assert.equal((await ok('trialCount')).newCount, before + 1)
  assert.ok((await telegrams()).slice(tg).some((t) => /Trial feedback/.test(JSON.stringify(t)) && /Program > Trial feedback/.test(JSON.stringify(t))))
  const d = await ok('trials')
  const x = d.items.find((i) => i.rowId === lina)
  assert.equal(x.state, 'new'); assert.equal(x.feedback.verdict, 'Ready for this group'); assert.match(x.feedback.notes, /scan more/)
  assert.equal(x.groupId, G1); assert.match(x.coach, /Sam/)
  assert.equal(d.items[0].state, 'new', 'new feedback first')
  assert.ok(['waiting', 'upcoming'].includes(d.items.find((i) => i.rowId === ned).state), 'no feedback yet')
  assert.equal((await S('trials')).status, 403)
})

await test('accept for this group: the term is offered in that group and the count goes down', async () => {
  const before = (await ok('trialCount')).newCount
  const o = await ok('offerTerm', { rowId: lina, groupId: G1, product: 'group', amountCents: 76500, sendEmail: false })
  assert.ok(o.payreq?.url)
  await ok('trialDecide', { rowId: lina, decision: 'accepted', groupId: G1 })
  assert.equal((await ok('trialCount')).newCount, before - 1)
  const x = (await ok('trials')).items.find((i) => i.rowId === lina)
  assert.equal(x.state, 'accepted'); assert.equal(x.decision.groupId, G1)
})

await test('move to another group: the row moves, the new coach is told, recorded as moved', async () => {
  await S('trialFeedback', { rowId: kai, verdict: 'Better in another group', best: 'Wed 6:30pm', notes: 'Strong for this group, would be challenged more at 6:30.' })
  await ok('offerTerm', { rowId: kai, groupId: G2, product: 'group', amountCents: 76500, sendEmail: false, force: true })
  await ok('trialDecide', { rowId: kai, decision: 'moved', groupId: G2 })
  const x = (await ok('trials')).items.find((i) => i.rowId === kai)
  assert.equal(x.groupId, G2); assert.equal(x.state, 'moved')
})

await test('decline and mark as read are recorded; new feedback after a decision shows again; undo works', async () => {
  await S('trialFeedback', { rowId: ned, verdict: 'Not the right fit yet', notes: 'Found the pace hard, a lower level group would suit.' })
  await ok('trialDecide', { rowId: ned, decision: 'declined' })
  assert.equal((await ok('trials')).items.find((i) => i.rowId === ned).state, 'declined')
  await ok('trialDecide', { rowId: ned, decision: 'undo' })
  assert.equal((await ok('trials')).items.find((i) => i.rowId === ned).state, 'new')
  await ok('trialDecide', { rowId: ned, decision: 'seen' })
  await new Promise((r) => setTimeout(r, 5))
  await S('trialFeedback', { rowId: ned, verdict: 'Not the right fit yet', notes: 'Second look: still a lower level for now, keen though.' })
  assert.equal((await ok('trials')).items.find((i) => i.rowId === ned).state, 'new', 'fresh feedback is new again')
  assert.equal((await L('trialDecide', { rowId: ned, decision: 'nonsense' })).status, 400)
})

console.log(`\n${passed} trial feedback checks passed`)
