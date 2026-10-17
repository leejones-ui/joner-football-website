// Unmatched Stripe > More (Lee, 18 Oct 2026): a Stripe payment on a JFP
// payment link that was really holiday training (or Pro sessions, or not JFP)
// is marked as such, end to end against the local harness (fake Airtable,
// fake Stripe, fake KV).
//   HOLIDAY_LOCAL_PORT=4591 node scripts/holiday-local.mjs
//   node scripts/test-jfp-stripe-holiday-flow.mjs 4591
// Every name, email and amount here is invented.
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
const portal = (c, action, body = {}) => c.call('/api/jfp-portal-data', { action, ...body })
const seed = (body) => fetch(`${B}/__stripe-seed`, { method: 'POST', body: JSON.stringify(body) }).then((r) => r.json())

const lee = client()
await signIn(lee, DEFAULT_CONFIG.superAdmins[0])
const money = async () => { const r = await portal(lee, 'money', { fresh: true }); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data.money }
const hol = async (period = '2026-spring') => { const r = await portal(lee, 'holidayMoney', { period, fresh: true }); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data.holiday }
const audits = async (action, target) => (await portal(lee, 'audit', { limit: 1000 })).data.entries.filter((e) => e.action === action && e.target === target)

// An invented A$120 payment on a "1 on 1 session" payment link, from an email on no row.
const CENTS = 12000
const { id: PAY } = await seed({ email: 'holiday.parent@example.com', name: 'Hana Holidayparent', cents: CENTS, link: 'plink_coach120', at: '2026-09-22T01:30:00.000Z' })
let FEE = null

await test('the payment starts in JFP term income and on Unmatched Stripe', async () => {
  const m = await money()
  const u = m.unmatched.find((x) => x.id === PAY)
  assert.ok(u, 'on the unmatched list')
  assert.equal(u.cents, CENTS)
  assert.match(u.product, /1 on 1/i)
  FEE = m.payments.find((x) => x.id === PAY)?.feeCents
  assert.equal(FEE, Math.round(CENTS * 0.02) + 20, 'the harness Stripe fee')
  assert.ok(!(await hol()).lines.some((x) => x.id === PAY), 'not holiday money yet')
})

await test('a coach gets 403 for every Stripe classification action', async () => {
  const cfg = (await portal(lee, 'getSettings')).data.config
  if (!cfg.coaches.some((c) => c.id === 'stripetestcoach')) assert.equal((await portal(lee, 'saveSettings', { config: { coaches: [...cfg.coaches, { id: 'stripetestcoach', name: 'Stripey', fullName: 'Stripey Coach', airtableName: 'Stripey Coach', email: 'stripe.coach@example.com' }] } })).status, 200)
  const coach = client()
  await signIn(coach, 'stripe.coach@example.com')
  assert.equal((await portal(coach, 'me')).data.user.role, 'coach')
  for (const [action, body] of [['stripeClassOptions', {}], ['stripeHoliday', { id: PAY, period: '2026-spring' }], ['stripeHolidayUndo', { id: PAY }], ['stripePro', { id: PAY }], ['stripeProUndo', { id: PAY }], ['stripeNotJfp', { id: PAY }], ['stripeNotJfpUndo', { id: PAY }]]) {
    const r = await portal(coach, action, body)
    assert.equal(r.status, 403, `${action}: ${JSON.stringify(r.data)}`)
  }
  assert.ok((await money()).unmatched.some((x) => x.id === PAY), 'nothing changed')
})

let before, holBefore, coachName
await test('the modal choices: the holidays, coaches and locations bankHoliday takes, and a suggestion', async () => {
  const r = await portal(lee, 'stripeClassOptions', { date: '2026-09-22' })
  assert.equal(r.status, 200, JSON.stringify(r.data))
  assert.ok(r.data.holiday.periods.some((p) => p.id === '2026-spring'))
  assert.ok(r.data.holiday.periods.some((p) => p.id === 'other'))
  assert.deepEqual(r.data.holiday.suggested, { id: '2026-spring', how: 'before' }, '22 Sep is just before the spring holidays')
  assert.ok(r.data.holiday.locations.length)
  coachName = r.data.holiday.coaches[0]?.name || ''
  assert.ok(Array.isArray(r.data.pro.players))
})

await test('bad answers are refused, as bankHoliday refuses them', async () => {
  assert.equal((await portal(lee, 'stripeHoliday', { id: PAY, period: 'nope' })).status, 400)
  assert.equal((await portal(lee, 'stripeHoliday', { id: PAY, period: '2026-spring', sessionDate: '2026-11-03' })).status, 400, 'a session date outside the holiday')
  assert.equal((await portal(lee, 'stripeHoliday', { id: PAY, period: '2026-spring', coach: 'nobody-at-all' })).status, 400)
  assert.equal((await portal(lee, 'stripeHoliday', { id: PAY, period: '2026-spring', location: 'the moon' })).status, 400)
  assert.equal((await portal(lee, 'stripeHoliday', { id: 'not a stripe id', period: '2026-spring' })).status, 400)
  assert.equal((await portal(lee, 'stripeHoliday', { id: 'cs_test_seed_does_not_exist', period: '2026-spring' })).status, 404)
})

await test('Holiday training: in the holiday view at the right amount and fee; out of JFP income and Unmatched Stripe', async () => {
  before = await money()
  holBefore = await hol()
  const r = await portal(lee, 'stripeHoliday', { id: PAY, period: '2026-spring', sessionDate: '2026-09-29', coach: coachName, location: 'Belrose HQ', note: 'two holiday sessions' })
  assert.equal(r.status, 200, JSON.stringify(r.data))
  assert.equal(r.data.line.feeCents, FEE)
  assert.equal(r.data.periodLabel, 'Spring holidays 2026')
  const m = await money()
  assert.ok(!m.unmatched.some((x) => x.id === PAY), 'leaves Unmatched Stripe')
  assert.equal(m.unmatched.length, before.unmatched.length - 1, 'one fewer to check')
  assert.equal(m.kpis.incomeCents, before.kpis.incomeCents - CENTS, 'out of JFP term income')
  assert.equal(m.kpis.stripePayments, before.kpis.stripePayments - 1)
  assert.equal(m.kpis.stripeFeesCents, before.kpis.stripeFeesCents - FEE, 'its fee leaves the JFP fees too')
  assert.ok(!m.payments.some((x) => x.id === PAY))
  assert.deepEqual(m.stripeMarked.find((x) => x.id === PAY), { id: PAY, kind: 'holiday', cents: CENTS, date: '2026-09-22', name: 'Hana Holidayparent', product: '1 on 1 session', periodLabel: 'Spring holidays 2026' })
  const h = await hol()
  const line = h.lines.find((x) => x.id === PAY)
  assert.ok(line, 'in Holiday training')
  assert.deepEqual([line.kind, line.marked, line.status, line.period, line.sessionDate, line.paidDate, line.coach, line.location], ['stripe', true, 'marked', '2026-spring', '2026-09-29', '2026-09-22', coachName || 'Not noted', 'Belrose HQ'])
  assert.deepEqual([line.takenCents, line.refundedCents, line.feeCents, line.keptCents, line.feePending], [CENTS, 0, FEE, CENTS - FEE, false])
  assert.equal(h.totals.takenCents, holBefore.totals.takenCents + CENTS)
  assert.equal(h.totals.feeCents, holBefore.totals.feeCents + FEE)
  assert.equal(h.totals.keptCents, holBefore.totals.keptCents + CENTS - FEE)
  assert.equal(h.totals.stripe.count, holBefore.totals.stripe.count + 1, 'counted as Stripe money, not bank')
  assert.equal(h.totals.bank.keptCents, holBefore.totals.bank.keptCents)
  // The "Add to your sheet" months the monthly sheet reads: by session date and by paid date.
  const month = (list, k) => list.find((x) => x.month === k) || { keptCents: 0, stripeCents: 0, feeCents: 0 }
  assert.equal(month(h.byMonth.session, '2026-09').keptCents - month(holBefore.byMonth.session, '2026-09').keptCents, CENTS - FEE)
  assert.equal(month(h.byMonth.session, '2026-09').stripeCents - month(holBefore.byMonth.session, '2026-09').stripeCents, CENTS - FEE)
  assert.equal(month(h.byMonth.paid, '2026-09').feeCents - month(holBefore.byMonth.paid, '2026-09').feeCents, FEE)
  // All holiday training has it too, and so does the agent's read-only view.
  assert.ok((await hol('all')).lines.some((x) => x.id === PAY))
  // Match to player and recording it for a player can no longer find it.
  assert.equal((await portal(lee, 'stripeMatch', { paymentId: PAY, rowIds: [before.players[0].rowId], as: 'jfp' })).status, 404)
  assert.equal((await audits('money.stripeHoliday', PAY)).length, 1, 'audited once')
})

await test('doing it twice is a no-op; another kind is refused', async () => {
  const again = await portal(lee, 'stripeHoliday', { id: PAY, period: 'other' })
  assert.equal(again.status, 200, JSON.stringify(again.data))
  assert.equal(again.data.already, true)
  assert.equal(again.data.line.period, '2026-spring', 'the first answer stands')
  const [a, b] = await Promise.all([1, 2].map(() => portal(lee, 'stripeHoliday', { id: PAY, period: '2026-spring' })))
  assert.deepEqual([a.status, b.status].sort(), [200, 200])
  assert.equal((await audits('money.stripeHoliday', PAY)).length, 1, 'still one audit entry')
  const h = await hol()
  assert.equal(h.lines.filter((x) => x.id === PAY).length, 1)
  assert.equal(h.totals.takenCents, holBefore.totals.takenCents + CENTS, 'counted once')
  const pro = await portal(lee, 'stripePro', { id: PAY })
  assert.equal(pro.status, 409)
  assert.match(pro.data.error, /already marked as holiday training/)
  assert.equal((await portal(lee, 'stripeNotJfpUndo', { id: PAY })).status, 409, 'the wrong Undo is refused')
})

await test('Undo puts it back: JFP income, Unmatched Stripe and the holiday figures as they were', async () => {
  const r = await portal(lee, 'stripeHolidayUndo', { id: PAY })
  assert.equal(r.status, 200, JSON.stringify(r.data))
  const m = await money()
  assert.ok(m.unmatched.some((x) => x.id === PAY), 'back on Unmatched Stripe')
  assert.equal(m.unmatched.length, before.unmatched.length)
  assert.equal(m.kpis.incomeCents, before.kpis.incomeCents)
  assert.equal(m.kpis.stripeFeesCents, before.kpis.stripeFeesCents)
  assert.ok(!(m.stripeMarked || []).some((x) => x.id === PAY))
  const h = await hol()
  assert.ok(!h.lines.some((x) => x.id === PAY))
  assert.deepEqual([h.totals.takenCents, h.totals.feeCents, h.totals.keptCents], [holBefore.totals.takenCents, holBefore.totals.feeCents, holBefore.totals.keptCents])
  assert.equal((await audits('money.stripeHolidayUndo', PAY)).length, 1)
  assert.equal((await portal(lee, 'stripeHolidayUndo', { id: PAY })).status, 404, 'a second Undo has nothing to put back')
})

await test('Pro sessions and Not JFP work the same way, and Undo brings it back', async () => {
  const pro0 = (await portal(lee, 'proMoney', { fresh: true })).data.pro
  const p = await portal(lee, 'stripePro', { id: PAY, note: 'one Pro session' })
  assert.equal(p.status, 200, JSON.stringify(p.data))
  const pro1 = (await portal(lee, 'proMoney', { fresh: true })).data.pro
  assert.equal(pro1.totals.stripe.count, pro0.totals.stripe.count + 1)
  assert.equal(pro1.totals.keptCents, pro0.totals.keptCents + CENTS - FEE, 'with its Stripe fee')
  assert.equal((await money()).kpis.incomeCents, before.kpis.incomeCents - CENTS)
  assert.equal((await portal(lee, 'stripeProUndo', { id: PAY })).status, 200)
  assert.equal((await portal(lee, 'proMoney', { fresh: true })).data.pro.totals.keptCents, pro0.totals.keptCents)

  const n = await portal(lee, 'stripeNotJfp', { id: PAY, note: 'a coach paid it back' })
  assert.equal(n.status, 200, JSON.stringify(n.data))
  const m = await money()
  assert.ok(!m.unmatched.some((x) => x.id === PAY))
  assert.equal(m.kpis.incomeCents, before.kpis.incomeCents - CENTS)
  assert.equal(m.otherStripe.count, before.otherStripe.count + 1, 'with the other Stripe payments that are not JFP')
  assert.equal(m.otherStripe.cents, before.otherStripe.cents + CENTS)
  assert.equal((await portal(lee, 'stripeNotJfpUndo', { id: PAY })).status, 200)
  const back = await money()
  assert.ok(back.unmatched.some((x) => x.id === PAY))
  assert.equal(back.kpis.incomeCents, before.kpis.incomeCents)
  assert.equal(back.otherStripe.count, before.otherStripe.count)
})

console.log(`\n${passed} Stripe holiday checks passed`)
