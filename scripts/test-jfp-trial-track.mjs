// Trial tracker (Lee, 20 Oct 2026): every trial from booked to paid or lost.
//   npm run build && node scripts/holiday-local.mjs 4321
//   node scripts/test-jfp-trial-track.mjs 4321
// Every name here is invented.
import assert from 'node:assert/strict'
import { cameFrom, trialStage, pipelineCounts } from '../api/_jfp-trial-track.js'

const PORT = process.argv[2] || '4321'
const B = `http://localhost:${PORT}`
let passed = 0
async function test(name, fn) { await fn(); passed += 1; console.log(`ok - ${name}`) }

const T = '2026-10-20'
const base = { stillTrial: true, holdsPlace: true, paymentStatus: '', feedback: null, decision: null, followUp: null, came: '', trialDate: '2026-10-13' }
await test('register on the trial day: came, missed, unmarked, still to come', async () => {
  assert.equal(cameFrom('Present', '2026-10-13', T), 'came')
  assert.equal(cameFrom('Absent', '2026-10-13', T), 'missed')
  assert.equal(cameFrom('Notified', '2026-10-13', T), 'missed')
  assert.equal(cameFrom(null, '2026-10-13', T), 'unmarked')
  assert.equal(cameFrom('Present', '2026-10-27', T), '')
})
await test('stages: booked, came, feedback, offered, followed up, paid, lost', async () => {
  assert.equal(trialStage({ ...base, trialDate: '2026-10-27' }, T).stage, 'booked')
  assert.equal(trialStage({ ...base, came: 'came' }, T).stage, 'came')
  assert.equal(trialStage({ ...base, came: 'missed' }, T).stage, 'missed')
  assert.equal(trialStage({ ...base, feedback: { at: 'x' } }, T).stage, 'feedback')
  assert.equal(trialStage({ ...base, feedback: { at: 'x' }, decision: { decision: 'accepted' } }, T).stage, 'offered')
  assert.equal(trialStage({ ...base, decision: { decision: 'accepted' }, followUp: { at: '2026-10-19T01:00:00Z', outcome: 'thinking' } }, T).stage, 'followed')
  const paid = trialStage({ ...base, stillTrial: false, paymentStatus: 'Paid', feedback: { at: 'x' } }, T)
  assert.equal(paid.stage, 'paid'); assert.equal(paid.done.came, true); assert.equal(paid.done.offered, true)
  assert.equal(trialStage({ ...base, decision: { decision: 'declined' } }, T).outcome, 'lost')
  assert.equal(trialStage({ ...base, followUp: { at: '2026-10-19T01:00:00Z', outcome: 'lost' } }, T).outcome, 'lost')
  assert.equal(trialStage({ ...base, stillTrial: false, holdsPlace: false }, T).outcome, 'lost', 'removed from Term 4')
})
await test('stuck: 5 or more days since the trial with no outcome and no follow up this week', async () => {
  assert.equal(trialStage({ ...base, trialDate: '2026-10-15' }, T).stuck, true)
  assert.equal(trialStage({ ...base, trialDate: '2026-10-16' }, T).stuck, false, '4 days')
  assert.equal(trialStage({ ...base, followUp: { at: '2026-10-18T01:00:00Z', outcome: 'thinking' } }, T).stuck, false)
  assert.equal(trialStage({ ...base, followUp: { at: '2026-10-10T01:00:00Z', outcome: 'thinking' } }, T).stuck, true, 'old follow up')
  assert.equal(trialStage({ ...base, stillTrial: false, paymentStatus: 'Paid' }, T).stuck, false)
  const c = pipelineCounts([{ track: trialStage({ ...base, trialDate: '2026-10-15' }, T) }, { track: trialStage({ ...base, stillTrial: false, paymentStatus: 'Paid' }, T) }])
  assert.equal(c.booked, 1); assert.equal(c.paid, 1); assert.equal(c.stuck, 1)
})

function client() {
  const jar = new Map()
  const call = async (p, body) => {
    const res = await fetch(`${B}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: B, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') }, body: JSON.stringify(body) })
    for (const c of res.headers.getSetCookie?.() || []) { const [kv] = c.split(';'); const i = kv.indexOf('='); if (kv.slice(i + 1)) jar.set(kv.slice(0, i), kv.slice(i + 1)); else jar.delete(kv.slice(0, i)) }
    return { status: res.status, data: await res.json().catch(() => ({})) }
  }
  return { call }
}
const emails = async () => (await fetch(`${B}/__emails`)).json()
async function signIn(c, email) {
  const s = await c.call('/api/jfp-auth', { action: 'start', email, audience: 'staff' })
  const code = (await emails()).filter((e) => e.to.includes(email) && /sign-in code/.test(e.subject)).at(-1).subject.match(/(\d{6})/)[1]
  assert.equal((await c.call('/api/jfp-auth', { action: 'verify', challenge: s.data.challenge, code })).status, 200)
}
const lee = client(), sam = client()
await signIn(lee, 'leejones@jonerfootball.com')
await signIn(sam, 'jonerfootballsam@gmail.com')
const L = (action, b = {}) => lee.call('/api/jfp-portal-data', { action, ...b })
const ok = async (action, b) => { const r = await L(action, b); assert.equal(r.status, 200, `${action}: ${JSON.stringify(r.data)}`); return r.data }
const G = (await ok('saveGroup', { group: { day: 'Thursday', time: '5:25pm', location: 'Belrose HQ', coachId: 'sam', capacity: 10, mode: 'direct' } })).group.id
const tia = (await ok('addPlayer', { groupId: G, force: true, player: { name: 'Tia Tracker', age: 10 }, parent: { name: 'Tia Parent', email: 'tia.t@example.com', mobile: '0400 222 333' }, payment: 'trial' })).rowId

await test('the trials page carries the tracker: steps, pipeline counts, outcomes', async () => {
  const d = await ok('trials')
  const x = d.items.find((i) => i.rowId === tia)
  assert.ok(x.track && x.track.done.booked)
  assert.ok(d.pipeline && typeof d.pipeline.booked === 'number')
  assert.deepEqual(Object.keys(d.outcomes), ['thinking', 'lost'])
  assert.ok(d.steps.some(([k]) => k === 'followed'))
})

await test('Followed up saves who, when, outcome and note; Not coming makes it lost; undo clears it; coaches cannot', async () => {
  const before = (await emails()).length
  const r = await ok('trialFollowUp', { rowId: tia, outcome: 'thinking', note: 'Called mum, deciding next week' })
  assert.equal(r.followUp.outcome, 'thinking')
  let x = (await ok('trials')).items.find((i) => i.rowId === tia)
  assert.equal(x.followUp.note, 'Called mum, deciding next week'); assert.equal(x.track.stage, 'followed')
  await ok('trialFollowUp', { rowId: tia, outcome: 'lost' })
  x = (await ok('trials')).items.find((i) => i.rowId === tia)
  assert.equal(x.track.outcome, 'lost')
  await ok('trialFollowUp', { rowId: tia, outcome: 'undo' })
  x = (await ok('trials')).items.find((i) => i.rowId === tia)
  assert.equal(x.followUp, null); assert.equal(x.track.outcome, 'open')
  assert.equal((await sam.call('/api/jfp-portal-data', { action: 'trialFollowUp', rowId: tia, outcome: 'lost' })).status, 403)
  assert.equal((await emails()).length, before, 'nothing sent')
})

console.log(`\n${passed} trial tracker checks passed`)
