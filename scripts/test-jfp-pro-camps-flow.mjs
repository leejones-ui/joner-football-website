// Money > Pro sessions, Camps and the quick first paint, end to end against
// the local harness (fake Airtable, fake Stripe, fake KV). Lee, 13 Oct 2026.
//   npm run build && HOLIDAY_LOCAL_PORT=4591 node scripts/holiday-local.mjs
//   node scripts/test-jfp-pro-camps-flow.mjs 4591
// Every name and amount here is invented.
import assert from 'node:assert/strict'
import { DEFAULT_CONFIG } from '../api/_jfp-store.js'

const B = `http://localhost:${Number(process.argv[2] || 4321)}`
let passed = 0
async function test(name, fn) { await fn(); passed += 1; console.log(`ok - ${name}`) }
function client() {
  const jar = new Map()
  async function call(path, body) {
    const res = await fetch(B + path, { method: 'POST', headers: { origin: B, 'content-type': 'application/json', cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') }, body: JSON.stringify(body) })
    for (const c of (res.headers.getSetCookie?.() || [])) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar.set(kv.slice(0, i), kv.slice(i + 1)) }
    return { status: res.status, data: await res.json().catch(() => ({})) }
  }
  return { call }
}
const get = async (p) => (await fetch(B + p)).json()
async function signIn(c, email) {
  const s = await c.call('/api/jfp-auth', { action: 'start', audience: 'staff', email })
  assert.equal(s.status, 200, JSON.stringify(s.data))
  const code = (await get('/__emails')).filter((e) => e.to.includes(email) && /sign-in code/.test(e.subject)).at(-1)?.subject.match(/(\d{6})/)?.[1]
  const v = await c.call('/api/jfp-auth', { action: 'verify', challenge: s.data.challenge, code })
  assert.equal(v.status, 200, JSON.stringify(v.data))
}
const lee = client()
await signIn(lee, DEFAULT_CONFIG.superAdmins[0])
const portal = (c, action, body = {}) => c.call('/api/jfp-portal-data', { action, ...body })
const seed = (body) => fetch(`${B}/__stripe-seed`, { method: 'POST', body: JSON.stringify(body) }).then((r) => r.json())
const year = Number(new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' }).slice(0, 4))

let proRow = ''
await test('a Pro row and Pro Stripe payments are Pro money, not JFP term income', async () => {
  const before = (await portal(lee, 'money', { fresh: true })).data.money
  const added = await (await fetch(`${B}/__airtable-add`, { method: 'POST', body: JSON.stringify({ table: 'term4', rows: [{ 'Player Name': 'Pro Sampleplayer', 'Parent Name': 'Pro Parent', Email: 'pro.family@example.com', Phone: '0400000000', 'Term 3 Day': 'Tuesday', 'Term 3 Time': '5:25pm', 'Term 3 Location': 'Belrose HQ', 'Term 4 Confirmation': 'Confirmed', 'Term 4 Payment Type': 'JFP Pro sessions', 'Term 4 Fee': 80, 'Term 4 Amount Paid': 0, 'Term 4 Payment Status': 'Unpaid', 'Term 4 Notes': '[PERSESSION:4000]' }] }) })).json()
  proRow = added.ids[0]
  await seed({ email: 'pro.family@example.com', name: 'Pro Parent', cents: 4000, metadata: { jfpBookingId: 'PAY-PRO-QUICK', jfpProgramme: 'pro', source: 'quick', jfpFor: 'Pro session' } })
  await seed({ email: 'pro.family@example.com', name: 'Pro Parent', cents: 4000, metadata: { jfpBookingId: 'PAY-PRO-ROW', jfpProduct: 'pro' } })
  const m = (await portal(lee, 'money', { fresh: true })).data.money
  assert.ok(!m.players.some((p) => p.rowId === proRow), 'the Pro row is not on JFP Money')
  assert.equal(m.players.length, before.players.length)
  assert.equal(m.kpis.incomeCents, before.kpis.incomeCents, 'JFP income has no Pro money in it')
  assert.equal(m.kpis.stripePayments, before.kpis.stripePayments)
  assert.ok(!m.unmatched.some((u) => u.email === 'pro.family@example.com'), 'nor on the not matched list')
  const pro = (await portal(lee, 'proMoney', { fresh: true })).data.pro
  assert.equal(pro.totals.stripe.count, 2)
  assert.equal(pro.totals.takenCents, 8000)
  assert.equal(pro.totals.feeCents, 2 * (80 + 20), 'the harness Stripe fee on each')
  assert.equal(pro.totals.keptCents, 8000 - 200)
  const me = pro.byPlayer.find((p) => p.rowId === proRow)
  assert.deepEqual([me.player, me.billedCents, me.owingCents, me.perSessionCents, me.keptCents], ['Pro Sampleplayer', 8000, 8000, 4000, 7800])
  const quick = (await portal(lee, 'proMoney', { quick: true })).data.pro
  assert.equal(quick.totals.keptCents, 7800, 'the quick reading has the same figures')
})

await test('Bank transfers to check: "Pro session" claims the line for Pro, once; put back, it is on the list again', async () => {
  const bank = (await portal(lee, 'bankCheck')).data.bank
  assert.deepEqual(bank.pro.players.map((p) => p.player), ['Pro Sampleplayer'])
  const line = [...bank.items, ...bank.before].find((x) => x.payer === 'K Wolstenholme')
  assert.ok(line, 'the invented bank line is there')
  const r = await portal(lee, 'bankPro', { id: line.id, rowId: proRow, sessionDate: '2026-10-07', note: 'two sessions' })
  assert.equal(r.status, 200, JSON.stringify(r.data))
  const again = await portal(lee, 'bankPro', { id: line.id })
  assert.equal(again.status, 409)
  assert.match(again.data.error, /already marked as Pro sessions/)
  assert.match((await portal(lee, 'bankHoliday', { id: line.id, period: 'other' })).data.error, /already marked as Pro sessions/)
  assert.equal((await portal(lee, 'bankPro', { id: line.id.replace(/.$/, 'f'), rowId: 'recNOTAPRO0000001' })).status, 400, 'only a Pro player')
  const after = (await portal(lee, 'bankCheck')).data.bank
  assert.ok(![...after.items, ...after.before].some((x) => x.id === line.id), 'it leaves the list')
  const pro = (await portal(lee, 'proMoney', {})).data.pro
  assert.equal(pro.totals.bank.keptCents, line.cents)
  assert.equal(pro.byPlayer.find((p) => p.rowId === proRow).keptCents, 7800 + line.cents)
  assert.ok(pro.lines.some((x) => x.id === line.id && x.marked && x.sessionDate === '2026-10-07'))
  const undo = await portal(lee, 'bankProUndo', { id: line.id })
  assert.equal(undo.status, 200)
  assert.ok([...(await portal(lee, 'bankCheck')).data.bank.items, ...(await portal(lee, 'bankCheck')).data.bank.before].some((x) => x.id === line.id), 'back on the list')
  assert.equal((await portal(lee, 'proMoney', {})).data.pro.totals.bank.count, 0)
  assert.equal((await portal(lee, 'bankProUndo', { id: line.id })).status, 404)
})

await test('the quick first paint never shows a payment as missing after it is recorded', async () => {
  const m = (await portal(lee, 'money', { quick: true })).data.money
  const p = m.players.find((x) => x.status === 'unpaid' && x.owingCents > 0)
  assert.ok(p, 'someone owes')
  const r = await portal(lee, 'recordPayment', { rowId: p.rowId, amountCents: 10000, method: 'Cash' })
  assert.equal(r.status, 200, JSON.stringify(r.data))
  const q = (await portal(lee, 'money', { quick: true })).data.money
  assert.equal(q.players.find((x) => x.rowId === p.rowId).paidCents, p.paidCents + 10000)
  assert.equal(q.kpis.cashCents, m.kpis.cashCents + 10000, 'the ledger copy was cleared by the write')
})

await test('Camps: the imported year, by location, against last year, and live Stripe camp sign-ups', async () => {
  const c = (await portal(lee, 'campsMoney', { year: 2026 })).data.camps
  assert.equal(c.year, 2026)
  assert.deepEqual(c.camps.map((x) => x.camp), ['Testville Autumn Camp', 'Sampleton Winter Camp', 'Testville Spring Camp'])
  assert.deepEqual([c.totals.grossCents, c.totals.netCents, c.totals.players], [2100000, 1500000, 70])
  assert.equal(c.compare.year, 2025)
  assert.equal(c.byLocation[0].location, 'Testville')
  assert.equal((await portal(lee, 'campsMoney', { year: 2025 })).data.camps.totals.netCents, 720000)
  const jfpBefore = (await portal(lee, 'money', { fresh: true })).data.money.kpis.incomeCents
  await seed({ email: 'camp.family@example.com', name: 'Camp Parent', cents: 25000, link: 'plink_camp', metadata: { registrationId: 'REG-TEST-1', camp: 'Testville Spring Camp' } })
  const s = (await portal(lee, 'campsStripe', { year, fresh: true })).data.stripe
  assert.deepEqual(s.camps.map((g) => [g.camp, g.count, g.takenCents]), [['Testville Spring Camp', 1, 25000]])
  assert.equal((await portal(lee, 'money', { fresh: true })).data.money.kpis.incomeCents, jfpBefore, 'a camp sign-up is not JFP')
  assert.equal((await portal(lee, 'campsStripe', { year: 1999 })).status, 400)
})

await test('coaches cannot see or change any of it', async () => {
  const cfg = (await portal(lee, 'getSettings')).data.config
  const coach = cfg.coaches.find((x) => x.email && !cfg.superAdmins.includes(String(x.email).toLowerCase()))
  assert.ok(coach, 'a coach with a sign-in')
  const c = client()
  await signIn(c, coach.email)
  for (const action of ['proMoney', 'campsMoney', 'campsStripe', 'bankPro', 'bankProUndo', 'holidayMoney', 'juniorsMoney', 'money']) assert.equal((await portal(c, action, { year })).status, 403, `${action} is admin only`)
})

console.log(`\n${passed} Pro sessions and camps flow checks passed`)
