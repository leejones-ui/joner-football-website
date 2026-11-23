// Extra sessions are paid before they run (Lee, 16 Nov 2026), end to end
// against the local harness:
//   HOLIDAY_LOCAL_PORT=4795 node scripts/holiday-local.mjs     (one terminal)
//   node scripts/test-jfp-extra-paid.mjs 4795                  (another)
// 1. unpaid bookings: the coach is told 48 and 24 hours before, the family
//    reminder is held until Lee switches it on, Lee hears if it starts unpaid
// 2. coach invoices: extra sessions come on by themselves, paid players only
// 3. a public group is booked whole by one family, never a place at a time
// Every name, email and amount here is invented.
import assert from 'node:assert/strict'
import { extraLine, typedExtraFlag } from '../api/_jfp-coach-invoices.js'
import { familyText, stageFor } from '../api/_jfp-extra-unpaid.js'

const PORT = process.argv[2] || '4321'
const B = `http://localhost:${PORT}`
let passed = 0, failed = 0
async function test(name, fn) { try { await fn(); passed += 1; console.log(`ok - ${name}`) } catch (e) { failed += 1; console.log(`FAIL - ${name}\n  ${e.stack || e.message}`) } }
function client() {
  const jar = new Map()
  async function call(p, body) {
    const res = await fetch(`${B}${p}`, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', origin: B, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') }, body: body ? JSON.stringify(body) : undefined })
    for (const c of res.headers.getSetCookie?.() || []) { const [kv] = c.split(';'); const i = kv.indexOf('='); const v = kv.slice(i + 1); if (v) jar.set(kv.slice(0, i), v); else jar.delete(kv.slice(0, i)) }
    let data = {}
    try { data = JSON.parse(await res.text()) } catch {}
    return { status: res.status, ok: res.ok, data }
  }
  return { call }
}
const emails = async () => (await fetch(`${B}/__emails`)).json()
const telegrams = async () => (await fetch(`${B}/__telegram`)).json()
// The harness answers { result }; a stored JSON string comes back parsed.
const kv = async (cmd) => { const t = await (await fetch(`${B}/__kv?cmd=${encodeURIComponent(JSON.stringify(cmd))}`)).text(); let v; try { v = JSON.parse(t) } catch { return t } v = v && typeof v === 'object' && 'result' in v ? v.result : v; if (typeof v === 'string') { try { return JSON.parse(v) } catch { return v } } return v }
const tick = async (now) => (await fetch(`${B}/api/jfp-groups?coachTick=1&now=${now}`, { headers: { authorization: 'Bearer local-cron-secret' } })).json()
async function signIn(c, email, audience = 'staff') {
  const s = await c.call('/api/jfp-auth', { action: 'start', email, audience })
  assert.equal(s.status, 200, JSON.stringify(s.data))
  const code = (await emails()).filter((e) => e.to.includes(email) && /sign-in code/.test(e.subject)).at(-1).subject.match(/(\d{6})/)[1]
  assert.equal((await c.call('/api/jfp-auth', { action: 'verify', challenge: s.data.challenge, code })).status, 200)
}
const lee = client(), dean = client()
await signIn(lee, 'leejones@jonerfootball.com')
await signIn(dean, 'jonerfootballdean@gmail.com')
const P = (c) => (action, body = {}) => c.call('/api/jfp-portal-data', { action, ...body })
const L = P(lee), D = P(dean)
const ok = async (r) => { const x = await r; assert.equal(x.status, 200, JSON.stringify(x.data)); return x.data }
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date())
const plus = (n) => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const H = 3600000
const priceId = (await ok(L('extraPrices', { add: { label: 'Extra 1 on 1', dollars: '120', durationMin: 60 } }))).prices.at(-1).id
const getSlot = async (id) => kv(['HGET', 'jfp:extra', id])
const putSlot = async (s) => kv(['HSET', 'jfp:extra', s.id, JSON.stringify(s)])
const payreq = async (id) => kv(['GET', `jfp:payreq:${id}`])
const markPaid = async (id) => { const q = await payreq(id); await kv(['SET', `jfp:payreq:${id}`, JSON.stringify({ ...q, status: 'paid', paidAt: new Date().toISOString(), paidCents: q.amountCents })]) }

await test('the words and stages (pure)', async () => {
  assert.equal(familyText({ parentFirst: 'Sarah', playerFirst: 'Sam', coach: 'Dean', when: 'Sun 22 Nov at 10:00am', url: 'https://jonerfootball.com/jfp-account/?pay=PAY-1' }),
    "Hi Sarah, a reminder that Sam's extra session with Coach Dean on Sun 22 Nov at 10:00am isn't paid yet. Please pay here before the session: https://jonerfootball.com/jfp-account/?pay=PAY-1 Sam can't train until it's paid. Thanks, Joner Football")
  assert.match(familyText({ parentFirst: 'Sarah', playerFirst: 'Sam', coach: 'Dean', when: 'x', url: 'u', amountCents: 12000 }), /isn't paid yet \(A\$120\)/)
  const t = Date.parse('2026-11-22T00:00:00Z')
  assert.equal(stageFor(t, t - 50 * H), '')
  assert.equal(stageFor(t, t - 47 * H), '48h')
  assert.equal(stageFor(t, t - 23 * H), '24h')
  assert.equal(stageFor(t, t - 90 * 60000), '2h', '2 hours before: the coach is told not to train them')
  assert.equal(stageFor(t, t + 5 * 60000), 'start')
  assert.equal(stageFor(t, t + 4 * H), '')
})

await test('an invoice line for an extra session: paid players only, weekend rate, half pay (pure)', async () => {
  const card = { bands: [6000, 6500, 7000, 7500, 8000, 8500, 9000], weekendExtra: 1000 }
  const s = { id: 'XS-1-AAAAAA', coachId: 'dean', date: '2026-11-22', time: '10:00am', durationMin: 60, location: 'Belrose HQ', status: 'open', bookings: [
    { id: 'XB-1', name: 'Rayan Sample', payreqId: 'PAY-A', status: 'booked', from: 'coach' },
    { id: 'XB-2', name: 'Reyansh Sample', payreqId: 'PAY-B', status: 'booked', from: 'coach' },
  ] }
  const one = extraLine(s, { paid: new Set(['PAY-A']), card })
  assert.equal(one.cents, 7000, 'Sunday 1 on 1: A$60 + A$10 weekend, Reyansh unpaid is left off')
  assert.equal(one.hoursId, 'extra:XS-1-AAAAAA')
  assert.match(one.flags.map((f) => f.text).join(' '), /Not paid for: Reyansh/)
  assert.equal(extraLine(s, { paid: new Set(['PAY-A', 'PAY-B']), card }).cents, 7500, 'both paid: 2on1 + weekend')
  assert.equal(extraLine(s, { paid: new Set(), card }).cents, 0, 'nobody paid: nothing')
  assert.equal(extraLine({ ...s, date: '2026-11-23' }, { paid: new Set(['PAY-A']), card }).cents, 6000, 'a weekday has no weekend rate')
  const late = { ...s, bookings: [{ id: 'XB-3', name: 'Gone', status: 'removed', lateCancel: { refill: 'pending' } }] }
  assert.equal(extraLine(late, { paid: new Set(), card }).cents, 3500, 'late cancel nobody filled: half pay')
  const typed = typedExtraFlag({ kind: 'other', date: '2026-11-22', flags: [] }, [s])
  assert.ok(typed.flags.some((f) => f.code === 'extra-typed'))
})

await test('a public group is booked whole by one family: no per place groups, families never take one place', async () => {
  const r = await D('extraSave', { slot: { date: plus(9), time: '10:00am', capacity: 4, location: 'Rydalmere Park', priceId, visibility: 'public', kind: 'oneoff' } })
  assert.equal(r.status, 400, 'a public group in places is refused')
  assert.match(r.data.error, /whole session/)
  assert.equal((await D('extraSave', { slot: { date: plus(9), time: '10:00am', capacity: 1, location: 'Rydalmere Park', priceId, visibility: 'public', kind: 'oneoff' } })).status, 200, 'a public 1 place is fine')
  assert.equal((await D('extraSave', { slot: { date: plus(9), time: '11:00am', capacity: 3, location: 'Rydalmere Park', priceId, visibility: 'private' } })).status, 200, 'a private session for players the coach adds is fine')
  assert.equal((await D('extraSave', { slot: { date: plus(9), time: '1:00pm', location: 'Rydalmere Park', kind: 'oneoff', bookAs: 'whole', options: [{ type: 'group', priceId, minPlayers: 2, maxPlayers: 4 }] } })).status, 200, 'a whole session group is fine')
  // An older public per place group (made before 16 Nov) is no longer listed or bookable one place at a time.
  const old = { id: 'XS-1700000000000-OLDGRP', coachId: 'dean', date: plus(10), time: '1:00pm', durationMin: 60, location: 'Rydalmere Park', capacity: 4, priceId, priceCents: 8000, priceLabel: 'Group', title: 'Group', visibility: 'public', kind: 'oneoff', token: 'tok', status: 'open', bookings: [], createdAt: new Date().toISOString() }
  await putSlot(old)
  const c = client()
  await c.call('/api/jfp-access', { password: 'term4' })
  const g = (await c.call('/api/jfp-groups')).data.extras || []
  assert.ok(!g.some((x) => x.id === old.id), 'not on the booking page')
})

let slot, booking
await test('unpaid: the coach is told 48 hours before, the family reminder is held while off, Lee hears at the start', async () => {
  const s = (await ok(D('extraSave', { slot: { date: plus(3), time: '10:00am', capacity: 1, location: 'Rydalmere Park', priceId, visibility: 'private' } }))).slot
  const a = await ok(D('extraAttach', { slotId: s.id, name: 'Pay Later', email: 'pay.later@example.com', mobile: '0400 222 333' }))
  slot = await getSlot(s.id); booking = a.booking
  assert.ok(booking.payreqId, 'charged')
  const start = Date.parse(`${slot.date}T10:00:00+11:00`)
  const before = (await emails()).length
  const r1 = await tick(start - 40 * H)
  assert.equal(r1.unpaid?.coach, 1, JSON.stringify(r1))
  assert.equal(r1.unpaid?.held, 1, 'the family reminder is held: the switch is off')
  assert.equal(r1.unpaid?.family, 0)
  const sent = (await emails()).slice(before)
  assert.ok(sent.some((e) => e.to.includes('jonerfootballdean@gmail.com') && /Not paid yet: Pay Later/.test(e.subject)), 'Dean is emailed')
  assert.ok(!sent.some((e) => e.to.includes('pay.later@example.com')), 'nothing to the family')
  assert.equal((await tick(start - 39 * H)).unpaid?.coach, 0, 'once per stage')
  const st = await ok(L('extraUnpaid'))
  assert.equal(st.on, false)
  assert.ok(st.held.some((h) => h.player === 'Pay Later' && /isn't paid yet/.test(h.text) && /can't train until it's paid/.test(h.text)))
  assert.equal((await D('extraUnpaid')).status, 403, 'a coach cannot switch it')
  // Dean's tab and register say it is not paid.
  const v = (await ok(D('extraList'))).slots.find((x) => x.id === slot.id)
  assert.equal(v.bookings[0].paid, false)
  // Lee switches it on: the 24 hour one goes to the family by email.
  assert.equal((await ok(L('extraUnpaid', { on: true }))).on, true)
  const b2 = (await emails()).length
  const r2 = await tick(start - 20 * H)
  assert.equal(r2.unpaid?.family, 1, JSON.stringify(r2))
  assert.ok((await emails()).slice(b2).some((e) => e.to.includes('pay.later@example.com') && /not paid yet/i.test(e.subject)), 'the family email')
  const tg = (await telegrams()).length
  assert.equal((await tick(start + 5 * 60000)).unpaid?.lee, 1)
  assert.match((await telegrams()).slice(tg).map((t) => t.text).join('\n'), /NOT PAID[\s\S]*Pay Later/)
  await ok(L('extraUnpaid', { on: false }))
})

await test('paid: nothing more is sent', async () => {
  const s = (await ok(D('extraSave', { slot: { date: plus(3), time: '2:00pm', capacity: 1, location: 'Rydalmere Park', priceId, visibility: 'private' } }))).slot
  const a = await ok(D('extraAttach', { slotId: s.id, name: 'Paid Early', email: 'paid.early@example.com' }))
  await markPaid(a.booking.payreqId)
  const start = Date.parse(`${s.date}T14:00:00+11:00`)
  const r = await tick(start - 40 * H)
  assert.equal(r.unpaid?.coach, 0, JSON.stringify(r))
  assert.equal(r.unpaid?.held, 0)
})

await test('coach invoice: the extra session comes on by itself, paid players only; a hand typed line on that day is flagged', async () => {
  await ok(L('coachPayCardSave', { coachId: 'dean', card: { bands: [6000, 6500, 7000, 7500, 8000, 8500, 9000], weekendExtra: 1000 } }))
  await ok(D('coachPayDetailsSave', { details: { fullName: 'Dean Sample', accountName: 'Dean Sample', bsb: '062-000', accountNumber: '12345678' } }))
  // A session that ran this morning, with a paid and an unpaid player.
  const ran = { id: `XS-${Date.now()}-RANAAA`, coachId: 'dean', date: today, time: '6:00am', durationMin: 60, location: 'Rydalmere Park', capacity: 2, priceCents: 12000, priceLabel: '1 on 1', title: '1 on 1', visibility: 'private', kind: 'private', token: 't', status: 'open', createdAt: new Date().toISOString(), bookings: [
    { id: 'XB-RAN-1', name: 'Has Paid', payreqId: 'PAY-RAN-1', status: 'booked', from: 'coach', at: new Date().toISOString() },
    { id: 'XB-RAN-2', name: 'Not Paid', payreqId: 'PAY-RAN-2', status: 'booked', from: 'coach', at: new Date().toISOString() },
  ] }
  await putSlot(ran)
  await kv(['SET', 'jfp:payreq:PAY-RAN-1', JSON.stringify({ id: 'PAY-RAN-1', status: 'paid', amountCents: 12000 })])
  await kv(['SET', 'jfp:payreq:PAY-RAN-2', JSON.stringify({ id: 'PAY-RAN-2', status: 'open', amountCents: 12000 })])
  const draft = (await ok(D('coachInvList', { from: today, to: today }))).draft
  const line = draft.find((l) => l.hoursId === `extra:${ran.id}`)
  assert.ok(line, JSON.stringify(draft.map((l) => l.hoursId)))
  const weekend = [0, 6].includes(new Date(`${today}T00:00:00Z`).getUTCDay())
  assert.equal(line.cents, weekend ? 7000 : 6000, '1 paid player only')
  assert.match(line.flags.map((f) => f.text).join(' '), /Not paid for: Not/)
  const inv = (await ok(D('coachInvCreate', { from: today, to: today, added: [{ date: today, description: '1on1 Not Paid', minutes: 60, cents: 6000 }] }))).invoice
  const typed = inv.lines.find((l) => l.kind === 'other')
  assert.ok(typed.flags.some((f) => f.code === 'extra-typed'), 'the hand typed line is flagged for Lee')
  assert.ok(inv.lines.some((l) => l.hoursId === `extra:${ran.id}`))
  const again = (await ok(D('coachInvList', { from: today, to: today }))).draft
  assert.ok(!again.some((l) => l.hoursId === `extra:${ran.id}`), 'never on two invoices')
  // Withdrawn: it comes free again.
  await ok(D('coachInvWithdraw', { id: inv.id }))
  assert.ok((await ok(D('coachInvList', { from: today, to: today }))).draft.some((l) => l.hoursId === `extra:${ran.id}`))
})

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
