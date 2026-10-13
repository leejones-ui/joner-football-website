// Joners Juniors in the portal, end to end against the local harness with
// its invented Juniors data:
//   JFP_JUNIORS_DEMO=1 HOLIDAY_LOCAL_PORT=5000 node scripts/holiday-local.mjs
//   node scripts/test-jfp-juniors-flow.mjs 5000
import assert from 'node:assert/strict'
const B = `http://localhost:${process.argv[2] || '5000'}`
let passed = 0, ip = 1
const test = async (n, fn) => { await fn(); passed += 1; console.log(`ok - ${n}`) }
function client() {
  const jar = new Map(), me = `10.9.0.${ip++}`
  return async (p, body) => {
    const res = await fetch(`${B}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: B, 'x-forwarded-for': me, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') }, body: JSON.stringify(body || {}) })
    for (const c of res.headers.getSetCookie?.() || []) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar.set(kv.slice(0, i), kv.slice(i + 1)) }
    let data = {}; try { data = await res.json() } catch {}
    return { status: res.status, data }
  }
}
async function signIn(call, email, audience = 'staff') {
  const s = await call('/api/jfp-auth', { action: 'start', email, audience })
  const code = (await (await fetch(`${B}/__emails`)).json()).filter((e) => e.to.includes(email) && /sign-in code/.test(e.subject)).at(-1).subject.match(/(\d{6})/)[1]
  assert.equal((await call('/api/jfp-auth', { action: 'verify', challenge: s.data.challenge, code })).status, 200)
}
const lee = client()
await signIn(lee, 'leejones@jonerfootball.com')
const J = (await lee('/api/jfp-portal-data', { action: 'juniorsMoney', fresh: true })).data.juniors

await test('Juniors by term: real Stripe money only, credit apart, unknowns unknown', async () => {
  assert.deepEqual(J.terms, ['Term 4 2026', 'Term 3 2026'])
  assert.equal(J.currentTerm, 'Term 4 2026')
  const t3 = J.byTerm['Term 3 2026'], t4 = J.byTerm['Term 4 2026']
  assert.equal(t3.collectedCents, 44000, 'row id + Juniors tag; the third Paid row has no payment')
  assert.equal(t3.counts.unverified, 1); assert.equal(t3.owingComplete, false)
  assert.equal(t4.collectedCents, 44000, 'one family on the link + one unmatched payment on the Term 4 link')
  assert.equal(t4.unlinkedCount, 1); assert.equal(t4.owingCents, 44000); assert.equal(t4.owingComplete, true); assert.equal(t4.creditPlaces, 1)
  const d = J.players.find((p) => p.player === 'Jun Delta')
  assert.equal(d.status, 'stripe', 'paid in Stripe, Airtable still Unpaid')
  assert.equal(J.coverage.alsoInJfp, 0)
  assert.ok(!JSON.stringify(J).includes('@example.com'), 'no family emails sent to the page')
})

await test('the same figures come back on a second read (dashboard and Money agree)', async () => {
  const again = (await lee('/api/jfp-portal-data', { action: 'juniorsMoney' })).data.juniors
  assert.deepEqual(again.byTerm, J.byTerm)
})

await test('JFP Money figures do not include Juniors', async () => {
  const m = (await lee('/api/jfp-portal-data', { action: 'money', fresh: true })).data.money
  assert.ok(!m.players.some((p) => /^Jun /.test(p.player)))
  assert.ok(!JSON.stringify(m).includes('cs_jun_'))
})

await test('only Lee and Ligia: coaches, families and strangers are refused', async () => {
  const dean = client(); await signIn(dean, 'jonerfootballdean@gmail.com')
  assert.equal((await dean('/api/jfp-portal-data', { action: 'juniorsMoney' })).status, 403)
  const parent = client(); await signIn(parent, 'alpha@example.com', 'parent')
  assert.ok([401, 403].includes((await parent('/api/jfp-portal-data', { action: 'juniorsMoney' })).status))
  const acct = (await parent('/api/jfp-account', { action: 'overview' })).data
  assert.ok(!JSON.stringify(acct).includes('Jun Delta'), 'a family never sees other Juniors families')
  assert.equal((await client()('/api/jfp-portal-data', { action: 'juniorsMoney' })).status, 401)
})

await test('Joners Juniors on the timetable and in Coach Sam\'s hours and register', async () => {
  const before = (await lee('/api/jfp-portal-data', { action: 'coachSessions', coachId: 'sam' })).data
  const made = await lee('/api/jfp-portal-data', { action: 'saveGroup', group: { day: 'Saturday', time: '9:15am', location: 'Belrose HQ', coachId: 'sam', mode: 'closed', label: 'Joners Juniors', durationMin: 45, capacity: 12, minAge: 3, maxAge: 6 } })
  assert.equal(made.status, 200, JSON.stringify(made.data))
  const id = made.data.group.id
  const board = (await lee('/api/jfp-portal-data', { action: 'board' })).data
  const g = board.groups.find((x) => x.id === id)
  assert.deepEqual(g.players.map((p) => p.name), ['Jun Alpha', 'Jun Delta', 'Jun Echo', 'Jun Foxtrot'], 'this term\'s Juniors children')
  assert.ok(g.players.every((p) => p.juniors))
  // Payment colours on the staff timetable, from the Juniors money figures.
  const jmById = new Map(J.players.map((x) => [x.rowId, x.status]))
  assert.ok(g.players.every((p) => p.pay && p.pay.status === jmById.get(p.rowId)), JSON.stringify(g.players.map((p) => [p.name, p.pay?.status, jmById.get(p.rowId)])))
  assert.equal(board.totals.players, (await lee('/api/jfp-portal-data', { action: 'board' })).data.totals.players, 'JFP totals unchanged')
  const after = (await lee('/api/jfp-portal-data', { action: 'coachSessions', coachId: 'sam' })).data
  assert.equal(after.hours.perWeekMinutes - before.hours.perWeekMinutes, 45, 'Sam gets 45 minutes a week')
  const jj = after.sessions.find((x) => x.id === id)
  assert.equal(jj.players.length, 4)
  const sam = client(); await signIn(sam, 'jonerfootballsam@gmail.com')
  const date = jj.nextDate
  const mark = await sam('/api/jfp-portal-data', { action: 'markAttendance', groupId: id, date, rowId: jj.players[0].rowId, status: 'Present' })
  assert.equal(mark.status, 200, JSON.stringify(mark.data))
  const prog = (await sam('/api/jfp-portal-data', { action: 'program' })).data
  assert.ok(prog.groups.some((x) => x.id === id && x.players.length === 4), 'coaches see the class on the Program')
  assert.ok(!/feeCents|paidCents|owingCents|"pay"/.test(JSON.stringify(prog)), 'coaches never see Juniors money')
  const add = await lee('/api/jfp-portal-data', { action: 'addPlayer', groupId: id, player: { name: 'Not A Junior' }, parent: { name: 'P', email: 'p@example.com' }, payment: 'none' })
  assert.equal(add.status, 400)
  const pubRes = await fetch(`${B}/api/jfp-groups`, { headers: { 'x-forwarded-for': '10.9.9.9' } })
  assert.equal(pubRes.status, 200, 'the booking page loads without a password')
  const card = (await pubRes.json()).groups.find((x) => x.id === id)
  assert.equal(card.mode, 'signup', 'a sign-up card on the booking page, not a JFP booking')
  assert.equal(card.signupUrl, '/jonersjuniors')
  assert.equal(card.placesLeft, null)
  assert.ok(!JSON.stringify(card).includes('Jun '), 'no children named on the public page')
})

await test('Money: edit a player\'s fee and details (Lee and Ligia only), saved to Airtable and logged', async () => {
  const m = (await lee('/api/jfp-portal-data', { action: 'money', quick: true })).data.money
  const p = m.players.find((x) => x.feeCents)
  const r = await lee('/api/jfp-portal-data', { action: 'editPlayer', rowId: p.rowId, fields: { feeAud: 750, paymentType: 'Sibling / 2 sessions per week', parent: 'Pat Edited' } })
  assert.equal(r.status, 200, JSON.stringify(r.data))
  const row = (await (await fetch(`${B}/__airtable`)).json()).term4.find((x) => x.id === p.rowId).fields
  assert.equal(row['Term 4 Fee'], 750); assert.equal(row['Term 4 Payment Type'], 'Sibling / 2 sessions per week'); assert.equal(row['Parent Name'], 'Pat Edited')
  assert.equal((await lee('/api/jfp-portal-data', { action: 'editPlayer', rowId: p.rowId, fields: { email: 'not-an-email' } })).status, 400)
  assert.equal((await lee('/api/jfp-portal-data', { action: 'editPlayer', rowId: p.rowId, fields: { feeAud: -5 } })).status, 400)
  const dean = client(); await signIn(dean, 'jonerfootballdean@gmail.com')
  assert.equal((await dean('/api/jfp-portal-data', { action: 'editPlayer', rowId: p.rowId, fields: { feeAud: 1 } })).status, 403)
  const log = JSON.stringify((await lee('/api/jfp-portal-data', { action: 'audit' })).data)
  assert.ok(log.includes('player.edit'))
})

console.log(`\n${passed} Juniors portal checks passed`)
