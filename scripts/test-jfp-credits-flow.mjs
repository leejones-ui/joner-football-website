// Credits come off by themselves (Lee, 20 Oct 2026), end to end against the
// local harness: Lee gives a credit in Money; it comes off the next payment
// link, a family invoice, sessions billed, a payment made in My account, or
// an auto charge after a session. A credit bigger than the bill keeps the
// rest; a cancelled link whose fee goes back gives the credit back; a
// session we cancelled is never auto charged. Money > Credits owed shows the
// total and who. Hermes can never give one.
//   npm run build && HOLIDAY_LOCAL_PORT=4861 node scripts/holiday-local.mjs   (one terminal)
//   node scripts/test-jfp-credits-flow.mjs 4861                              (another)
// Every name, email and amount here is invented.
import assert from 'node:assert/strict'

const PORT = Number(process.argv[2] || 4321)
const B = `http://localhost:${PORT}`
let passed = 0
async function test(name, fn) { await fn(); passed += 1; console.log(`ok - ${name}`) }

let ipSeq = 80
function client() {
  const jar = new Map()
  const ip = `10.9.3.${ipSeq++}`
  const call = async (path, body) => {
    const res = await fetch(`${B}${path}`, { method: body ? 'POST' : 'GET', redirect: 'manual', headers: { 'content-type': 'application/json', origin: B, 'x-forwarded-for': ip, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') }, body: body ? JSON.stringify(body) : undefined })
    for (const c of res.headers.getSetCookie?.() || []) { const [kv] = c.split(';'); const i = kv.indexOf('='); if (kv.slice(i + 1)) jar.set(kv.slice(0, i), kv.slice(i + 1)); else jar.delete(kv.slice(0, i)) }
    return { status: res.status, data: await res.json().catch(() => ({})) }
  }
  return { call }
}
const getJson = async (p) => (await fetch(`${B}${p}`)).json()
const emails = () => getJson('/__emails')
const at = () => getJson('/__airtable')
const kv = async (cmd) => (await fetch(`${B}/__kv?cmd=${encodeURIComponent(JSON.stringify(cmd))}`)).text()
const payreq = async (id) => JSON.parse(await kv(['GET', `jfp:payreq:${id}`]))
const row = async (id) => (await at()).term4.find((r) => r.id === id).fields
const pis = () => getJson('/__stripe-pis')
async function signIn(c, email, audience = 'parent') {
  const s = await c.call('/api/jfp-auth', { action: 'start', email, audience })
  assert.equal(s.status, 200, JSON.stringify(s.data))
  const code = (await emails()).filter((e) => e.to.includes(email) && /sign-in code/.test(e.subject)).at(-1).subject.match(/(\d{6})/)[1]
  assert.equal((await c.call('/api/jfp-auth', { action: 'verify', challenge: s.data.challenge, code })).status, 200)
}
const GUARDIAN = { accepted: { terms: true, makeups: true, payment: true, emergency: true }, media: false, kind: 'guardian' }

const lee = client()
await signIn(lee, 'leejones@jonerfootball.com', 'staff')
const portal = (action, body = {}) => lee.call('/api/jfp-portal-data', { action, ...body })
const ok = async (action, body = {}) => { const r = await portal(action, body); assert.equal(r.status, 200, `${action}: ${JSON.stringify(r.data)}`); return r.data }
const GID = (await ok('saveGroup', { group: { day: 'Thursday', time: '6:10pm', location: 'NTRA', coachId: 'lee', capacity: 16, mode: 'direct' } })).group.id
const owed = async () => ok('creditsList')
const give = (rowId, dollars, reason = 'Session cancelled, wet weather') => ok('creditGive', { rowId, cents: Math.round(dollars * 100), reason })

let famSeq = 0
async function family(surname, fee) {
  famSeq += 1
  const email = `${surname.toLowerCase()}.cred${famSeq}@example.com`
  const dob = `2013-0${famSeq % 9 + 1}-1${famSeq % 10}`
  const a = await ok('addPlayer', { groupId: GID, force: true, player: { name: `Kit ${surname}`, dob }, parent: { name: `Pat ${surname}`, email, mobile: `0400 778 ${String(100 + famSeq)}` }, payment: 'none' })
  await ok('editPlayer', { rowId: a.rowId, fields: { feeAud: fee } })
  const c = client()
  await signIn(c, email)
  const d = (await c.call('/api/jfp-account', { action: 'overview' })).data
  const w = await c.call('/api/jfp-account', { action: 'signWaiver', players: d.players.map((p) => ({ key: p.key, dob, emergencyName: `Em ${surname}`, emergencyPhone: '0400 555 101' })), waiver: { ...GUARDIAN, signature: `Pat ${surname}` }, parentName: `Pat ${surname}`, mobile: '0400 555 102' })
  assert.equal(w.status, 200, JSON.stringify(w.data))
  return { email, rowId: a.rowId, c, account: async () => (await c.call('/api/jfp-account', { action: 'overview' })).data }
}

await test('Money > Credits owed: Lee gives a credit; total and who; a reason is needed; Hermes and coaches cannot', async () => {
  const f = await family('Ames', 850)
  assert.equal((await owed()).totalCents, 0)
  assert.equal((await portal('creditGive', { rowId: f.rowId, cents: 5000, reason: '' })).status, 400)
  assert.equal((await portal('creditGive', { rowId: f.rowId, cents: 0, reason: 'x' })).status, 400)
  await give(f.rowId, 50)
  const v = await owed()
  assert.equal(v.totalCents, 5000)
  assert.equal(v.owed.length, 1); assert.equal(v.owed[0].player, 'Kit Ames'); assert.equal(v.owed[0].amountLabel, 'A$50')
  const coachC = client(); await signIn(coachC, (await ok('board')).coaches.find((x) => x.id === 'sam').email, 'staff')
  assert.equal((await coachC.call('/api/jfp-portal-data', { action: 'creditGive', rowId: f.rowId, cents: 5000, reason: 'x' })).status, 403)
  assert.equal((await coachC.call('/api/jfp-portal-data', { action: 'creditsList' })).status, 403)
  // The family sees it, and that it comes off by itself.
  const mk = (await f.account()).makeups || []
  assert.ok(mk.some((m) => m.kind === 'credit' && m.cents === 5000 && m.given), JSON.stringify(mk))
})

await test('a payment link: the credit comes off; the fee comes down; the link asks for less; the credit is used up', async () => {
  const f = await family('Bell', 850)
  await give(f.rowId, 50)
  const link = (await ok('sendPaymentLink', { rowIds: [f.rowId] })).payreq
  assert.equal(link.amountLabel, 'A$800')
  const q = await payreq(link.id)
  assert.equal(q.amountCents, 80000); assert.equal(q.creditCents, 5000); assert.deepEqual(q.creditUsed, [{ rowId: f.rowId, cents: 5000 }])
  const r = await row(f.rowId)
  assert.equal(r['Term 4 Fee'], 800)
  assert.match(r['Term 4 Notes'], /Credit A\$50 used: comes off the payment link \(fee A\$850 to A\$800\)/)
  assert.ok(!(await owed()).owed.some((x) => x.player === 'Kit Bell'), 'nothing owed now')
  assert.ok((await owed()).used.some((x) => x.player === 'Kit Bell'), 'listed as used lately')
})

await test('a credit bigger than the bill: the bill is covered, the link is closed, the rest stays owed', async () => {
  const f = await family('Cole', 40)
  await give(f.rowId, 50)
  const link = (await ok('sendPaymentLink', { rowIds: [f.rowId] })).payreq
  const q = await payreq(link.id)
  assert.equal(q.amountCents, 0); assert.equal(q.status, 'cancelled'); assert.equal(q.paidWithCredit, true)
  const r = await row(f.rowId)
  assert.equal(r['Term 4 Fee'], 0); assert.equal(r['Term 4 Payment Status'], 'Paid')
  const left = (await owed()).owed.find((x) => x.player === 'Kit Cole')
  assert.equal(left.cents, 1000, 'A$10 left for next time')
})

await test('a family invoice: two places, one with credit; the places add up to what the link asks for', async () => {
  const f = await family('Dunn', 850)
  await give(f.rowId, 100)
  const inv = await ok('familyInvoice', { places: [{ rowId: f.rowId, feeCents: 85000 }], sendEmail: false })
  const q = await payreq(inv.payreq.id)
  assert.equal(q.amountCents, 75000)
  assert.equal(q.places.reduce((t, p) => t + p.owingCents, 0), q.amountCents)
  assert.match(q.places[0].label, /A\$100 credit used/)
})

await test('My account: the family pays what is owing; the credit comes off before the payment page', async () => {
  const f = await family('Egan', 850)
  await give(f.rowId, 25)
  // The link is made, then the kit question stops the page (as for any family).
  const r = await f.c.call('/api/jfp-account', { action: 'payOwed', rowId: f.rowId })
  assert.ok(r.status === 200 || r.data.code === 'kit', JSON.stringify(r.data))
  const ids = JSON.parse(await kv(['ZREVRANGE', 'jfp:payreqs', '0', '40']))
  const mine = []
  for (const id of ids) { const x = await payreq(id); if (x?.fromAccount && x.term4Ids?.includes(f.rowId)) mine.push(x) }
  assert.equal(mine.length, 1)
  const q = mine[0]
  assert.equal(q.amountCents, 82500); assert.equal(q.creditCents, 2500)
  assert.equal((await row(f.rowId))['Term 4 Fee'], 825)
})

await test('a cancelled sessions link (its sessions come back off the fee) gives the credit back, owed again', async () => {
  const f = await family('Ford', 0)
  await ok('editPlayer', { rowId: f.rowId, fields: { paymentType: 'JFP Session by session', perSessionAud: 50 } })
  await give(f.rowId, 20)
  const s = await ok('sessionInvoice', { rows: [{ rowId: f.rowId, sessions: 2, perSessionCents: 5000 }], what: '8 and 15 Oct', sendEmail: false })
  assert.equal(s.payreq.amountLabel, 'A$80')
  const q = await payreq(s.payreq.id)
  assert.equal(q.creditCents, 2000)
  assert.equal(q.places.reduce((t, p) => t + p.owingCents, 0), 8000)
  assert.equal((await row(f.rowId))['Term 4 Fee'], 80)
  await ok('cancelPayreq', { id: q.id })
  assert.equal((await row(f.rowId))['Term 4 Fee'], 0, 'the sessions come back off')
  const back = (await owed()).owed.find((x) => x.player === 'Kit Ford')
  assert.equal(back?.cents, 2000, 'the credit is owed again')
})

// Auto charge (the test clock: switched on 20 Oct, run on 5 Nov).
const OCT20 = Date.parse('2026-10-20T09:00:00+11:00')
const NOV5 = Date.parse('2026-11-05T10:30:00+11:00')
const D1 = '2026-10-28', D2 = '2026-11-04'
async function saveMethod(email) {
  const c = client()
  await signIn(c, email)
  const st = await c.call('/api/jfp-account', { action: 'savedPaySetup', kind: 'card', agree: true })
  assert.equal(st.status, 200, JSON.stringify(st.data))
  const back = await fetch(`${st.data.url}&action=pay&pm=card`, { redirect: 'manual' })
  const sid = new URL(back.headers.get('location')).searchParams.get('saved')
  assert.equal((await c.call('/api/jfp-account', { action: 'savedPayConfirm', sessionId: sid })).status, 200)
}
await test('auto charge: a session we cancelled is never charged; credit pays a whole session, then part of the next', async () => {
  const WED = (await ok('saveGroup', { group: { day: 'Wednesday', time: '5:15pm', location: 'NTRA', coachId: 'lee', capacity: 20, mode: 'direct' } })).group.id
  const add = async (name, email) => (await ok('addPlayer', { groupId: WED, force: true, player: { name, dob: '2012-04-04' }, parent: { name: `Parent ${name}`, email, mobile: '0400 779 101' }, payment: 'sessions', perSessionCents: 5000 })).rowId
  const cal = await add('Cal Credit', 'cal.credit@example.com')
  const ola = await add('Ola Off', 'ola.off@example.com')
  await ok('savedPaySettings', { set: { cards: true } })
  for (const e of ['cal.credit', 'ola.off']) await saveMethod(`${e}@example.com`)
  for (const id of [cal, ola]) await ok('autoChargeSwitch', { rowId: id, on: true, now: OCT20 })
  for (const d of [D1, D2]) for (const id of [cal, ola]) await kv(['HSET', `jfp:att:${WED}:${d}`, id, 'Present'])
  // We cancel Ola's 28 Oct session (a separate group, so only this test's players).
  await kv(['HSET', 'jfp:session-off', `${WED}|${D1}`, JSON.stringify({ groupId: WED, date: D1, reason: 'Coach sick', kind: 'makeup', at: new Date(OCT20).toISOString() })])
  await give(cal, 80, 'Wet weather')
  await give(ola, 30, 'Wet weather')
  const pv = (await ok('autoChargePanel', { now: NOV5 })).preview
  const p = (n, d) => pv.find((x) => x.player === n && x.date === d)
  // 28 Oct was cancelled for the whole group: nobody is charged, credit or not.
  for (const n of ['Ola Off', 'Cal Credit']) { assert.equal(p(n, D1).reason, 'cancelled'); assert.match(p(n, D1).why, /session cancelled, not charged/i) }
  // 4 Nov: Cal's A$80 pays the whole A$50; Ola's A$30 pays part and A$20 is charged.
  assert.equal(p('Cal Credit', D2).reason, 'credit'); assert.match(p('Cal Credit', D2).why, /paid with credit/i)
  assert.equal(p('Ola Off', D2).action, 'charge'); assert.equal(p('Ola Off', D2).amountLabel, 'A$20'); assert.match(p('Ola Off', D2).why, /A\$30 credit used/)
  const before = (await pis()).length
  await ok('savedPaySettings', { set: { autoCharge: true } })
  await ok('autoChargeRun', { confirm: true, now: NOV5 })
  const charged = (await pis()).slice(before)
  assert.deepEqual(charged.map((x) => Number(x.amount)), [2000], 'only A$20 for Ola')
  const o = await row(ola)
  assert.equal(o['Term 4 Fee'], 20); assert.equal(o['Term 4 Amount Paid'], 20)
  const c = await row(cal)
  assert.equal(c['Term 4 Fee'] || 0, 0)
  assert.match(c['Term 4 Notes'], /Session on 2026-11-04: A\$50 credit used, nothing charged/)
  const v = await owed()
  assert.equal(v.owed.find((x) => x.player === 'Cal Credit')?.cents, 3000, 'A$30 left for Cal')
  assert.ok(!v.owed.some((x) => x.player === 'Ola Off'), 'Ola has none left')
  // A second run changes nothing.
  await ok('autoChargeRun', { confirm: true, now: NOV5 })
  assert.equal((await pis()).length, before + 1)
  assert.equal((await owed()).owed.find((x) => x.player === 'Cal Credit')?.cents, 3000)
})

console.log(`\n${passed} passed`)
