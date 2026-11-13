// The 48 hour rule for extra sessions (Lee, 7 Nov 2026), end to end against
// the local harness: half back between 24 and 48 hours, nothing under 24,
// the rest back when someone takes the place, the coach paid half when
// nobody does, and bookings from before the change on the 24 hour terms.
//   npm run build && HOLIDAY_LOCAL_PORT=4799 node scripts/holiday-local.mjs   (one terminal)
//   node scripts/test-jfp-extra-48h.mjs 4799                                 (another)
// Every name, email and amount here is invented.
import assert from 'node:assert/strict'
const { RULE48_FROM } = await import('../api/_jfp-extra-cancel.js')

const B = `http://localhost:${Number(process.argv[2] || 4321)}`
let passed = 0
async function test(name, fn) { await fn(); passed += 1; console.log(`ok - ${name}`) }
function client() {
  const jar = new Map()
  const call = async (path, body) => {
    const res = await fetch(`${B}${path}`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/json', origin: B, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') }, body: JSON.stringify(body) })
    for (const c of res.headers.getSetCookie?.() || []) { const [kv] = c.split(';'); const i = kv.indexOf('='); if (kv.slice(i + 1)) jar.set(kv.slice(0, i), kv.slice(i + 1)); else jar.delete(kv.slice(0, i)) }
    return { status: res.status, data: await res.json().catch(() => ({})) }
  }
  return { call }
}
const getJson = async (p) => (await fetch(`${B}${p}`)).json()
const emails = () => getJson('/__emails')
const telegrams = () => getJson('/__telegram')
const kv = async (cmd) => (await fetch(`${B}/__kv?cmd=${encodeURIComponent(JSON.stringify(cmd))}`)).text()
async function signIn(c, email, audience) {
  const s = await c.call('/api/jfp-auth', { action: 'start', email, audience, mobile: '0412 345 678' })
  assert.equal(s.status, 200, JSON.stringify(s.data))
  const code = (await emails()).filter((e) => e.to.includes(email) && /sign-in code/.test(e.subject)).at(-1).subject.match(/(\d{6})/)[1]
  assert.equal((await c.call('/api/jfp-auth', { action: 'verify', challenge: s.data.challenge, code })).status, 200)
}
const ok = async (r) => { const x = await r; assert.equal(x.status, 200, JSON.stringify(x.data)); return x.data }
const lee = client()
await signIn(lee, 'leejones@jonerfootball.com', 'staff')
const L = (action, body = {}) => lee.call('/api/jfp-portal-data', { action, ...body })
const players = (await ok(L('playersList'))).players
// Two families with every child's waiver on file (the second gets one here).
const solo = (p) => p.email && p.holdsPlace && players.filter((x) => x.email === p.email).length === 1
const first = players.find((p) => solo(p) && p.waiver?.onFile)
const second = players.find((p) => solo(p) && p.email !== first.email && (p.player || p.name))
if (!second.waiver?.onFile) await fetch(`${B}/__airtable-add`, { method: 'POST', body: JSON.stringify({ table: 'waiver', rows: [{ 'Player Full Name': second.player || second.name, 'Parent Email': second.email, 'Date of Birth': '2014-02-03', Term: 'Term 4 2026', 'Signed Date': '2026-10-01', 'Waiver Accepted - Full Terms': true }] }) })
const single = [first, second]
async function family(row) {
  const c = client()
  await signIn(c, row.email, 'parent')
  const A = (action, body = {}) => c.call('/api/jfp-account', { action, ...body })
  await ok(A('acceptTerms'))
  return { A, row, kid: (await ok(A('overview'))).players[0] }
}
const one = await family(single[0])
const two = await family(single[1])

// A session starting about h hours from now, on the hour (Sydney).
function inHours(h) {
  const t = new Date(Math.ceil((Date.now() + h * 3600000) / 3600000) * 3600000)
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', hour12: false }).formatToParts(t).map((x) => [x.type, x.value]))
  const hr = Number(p.hour) % 24
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${hr % 12 || 12}:00${hr < 12 ? 'am' : 'pm'}` }
}
const newSlot = async (h, extra = {}) => (await ok(L('extraSave', { slot: { coachId: 'dean', ...inHours(h), capacity: 1, location: 'Rydalmere Park', priceCents: 12000, title: '1 on 1', visibility: 'public', ...extra } }))).slot
async function bookAndPay(f, slotId) {
  // bookExtra opens the Stripe page straight away.
  const b = await ok(f.A('bookExtra', { slotId, playerKey: f.kid.key, acceptTerms: true }))
  const url = new URL(b.url, B)
  url.searchParams.set('action', 'pay')
  await fetch(url, { redirect: 'manual' })
  const s = await slotOf(slotId)
  const mine = s.bookings.find((x) => x.status !== 'removed' && x.email === f.row.email.toLowerCase())
  // Booked after the change (RULE48_FROM can be later than now on this machine).
  if (mine.at < RULE48_FROM) { mine.at = RULE48_FROM; await kv(['HSET', 'jfp:extra', slotId, JSON.stringify(s)]) }
  return mine.payreqId
}
const slotOf = async (id) => JSON.parse(await kv(['HGET', 'jfp:extra', id]))
const live = async (id) => (await slotOf(id)).bookings.filter((b) => b.status !== 'removed')
const payreq = async (id) => JSON.parse(await kv(['GET', `jfp:payreq:${id}`]))
const cancelOf = async (f, id) => (await ok(f.A('overview'))).extras.booked.find((x) => x.id === id)?.cancel
const newMail = async (n) => (await emails()).slice(n)
const newTg = async (n) => (await telegrams()).slice(n)

await test('the terms page says 48 hours', async () => {
  const html = await (await fetch(`${B}/terms/`)).text()
  assert.match(html, /Cancel at least 48 hours before the session and we refund what you paid, less a A\$5 card processing fee\./)
  assert.match(html, /Cancel between 24 and 48 hours before and we refund half of what you paid\./)
  assert.match(html, /If someone else books your place after you cancel, we refund you as if you had given 48 hours notice\./)
})

let s1, pay1
await test('30 hours before: half back, the place opens, Dean is told he is paid half if nobody takes it', async () => {
  s1 = await newSlot(30)
  pay1 = await bookAndPay(one, s1.id)
  assert.equal((await payreq(pay1)).status, 'paid')
  const c = await cancelOf(one, s1.id)
  assert.deepEqual([c.band, c.refundCents, c.refill, c.fullLabel], ['half', 6000, true, 'A$115'])
  const m = (await emails()).length, t = (await telegrams()).length
  const r = await ok(one.A('cancelExtra', { slotId: s1.id, confirm: true }))
  assert.deepEqual([r.band, r.refundCents], ['half', 6000])
  assert.equal((await payreq(pay1)).refundedCents, 6000, 'A$60 refunded in Stripe')
  assert.equal((await live(s1.id)).length, 0, 'the place is open again')
  const gone = (await slotOf(s1.id)).bookings.find((b) => b.payreqId === pay1)
  assert.deepEqual([gone.lateCancel.band, gone.lateCancel.refill, gone.lateCancel.fullCents], ['half', 'pending', 11500])
  const coach = (await newMail(m)).find((e) => /Extra session cancelled/.test(e.subject))
  assert.ok(coach, 'Dean is emailed')
  assert.match(JSON.stringify(coach), /If nobody books the place, you are paid half for this session\. If someone books it, it is as normal\./)
  assert.ok((await newTg(t)).some((x) => /Under 48 hours notice, so half refunded \(A\$60\.00\)|half refunded/.test(JSON.stringify(x))), 'admin chat told')
})

await test('another family books and pays for that place: the first family gets the rest of the 48 hour refund', async () => {
  const t = (await telegrams()).length
  await bookAndPay(two, s1.id)
  assert.equal((await live(s1.id)).length, 1)
  assert.equal((await payreq(pay1)).refundedCents, 11500, 'A$115 back in all, A$5 kept')
  const gone = (await slotOf(s1.id)).bookings.find((b) => b.payreqId === pay1)
  assert.equal(gone.lateCancel.refill, 'filled')
  assert.equal(gone.lateCancel.topUpCents, 5500)
  assert.ok((await newTg(t)).some((x) => /took the place/.test(JSON.stringify(x)) && /A\$55/.test(JSON.stringify(x))), 'admin chat told')
})

await test('the place is only taken once per new booking', async () => {
  const filler = (await live(s1.id))[0]
  assert.ok(await kv(['HGET', 'jfp:extra-refill', filler.id]), 'marked done')
  assert.equal((await payreq(pay1)).refundedCents, 11500)
})

let s2, pay2
await test('under 24 hours: nothing back, and nobody takes it: the register shows Dean is paid half', async () => {
  s2 = await newSlot(10)
  pay2 = await bookAndPay(one, s2.id)
  const c = await cancelOf(one, s2.id)
  assert.deepEqual([c.band, c.refundCents, c.refill], ['late', 0, true])
  const r = await ok(one.A('cancelExtra', { slotId: s2.id, confirm: true }))
  assert.deepEqual([r.band, r.refundCents], ['late', 0])
  assert.equal(Number((await payreq(pay2)).refundedCents || 0), 0)
  assert.equal((await live(s2.id)).length, 0)
  const d = await ok(L('coachSessions', { coachId: 'all', week: '' }))
  const x = (d.extras || []).find((y) => y.id === s2.id)
  assert.ok(x, 'the empty session stays on the register')
  assert.deepEqual(x.halfPay, [one.kid.name])
})

await test('under 24 hours, then a coach puts a player on: the family gets A$115 back, the half pay note goes', async () => {
  await ok(L('extraAttach', { slotId: s2.id, name: 'Testy Filler', email: 'filler.family@example.com' }))
  assert.equal((await payreq(pay2)).refundedCents, 11500)
  const d = await ok(L('coachSessions', { coachId: 'all', week: '' }))
  assert.deepEqual((d.extras || []).find((y) => y.id === s2.id).halfPay, [])
})

await test('more than 48 hours before: back less A$5, no half pay, nothing waiting', async () => {
  const s3 = await newSlot(60)
  const p = await bookAndPay(one, s3.id)
  const c = await cancelOf(one, s3.id)
  assert.deepEqual([c.band, c.refundCents, c.refill], ['full', 11500, false])
  await ok(one.A('cancelExtra', { slotId: s3.id, confirm: true }))
  assert.equal((await payreq(p)).refundedCents, 11500)
  const gone = (await slotOf(s3.id)).bookings.find((b) => b.payreqId === p)
  assert.equal(gone.lateCancel, undefined)
})

await test('a booking made before the change keeps the 24 hour terms: 30 hours is back less A$5', async () => {
  const s4 = await newSlot(30)
  const p = await bookAndPay(one, s4.id)
  const s = await slotOf(s4.id)
  s.bookings.find((b) => b.payreqId === p).at = '2026-11-05T07:28:24.000Z'
  await kv(['HSET', 'jfp:extra', s4.id, JSON.stringify(s)])
  const c = await cancelOf(one, s4.id)
  assert.deepEqual([c.rule, c.band, c.refundCents, c.refill], ['24h', 'full', 11500, false])
  await ok(one.A('cancelExtra', { slotId: s4.id, confirm: true }))
  assert.equal((await payreq(p)).refundedCents, 11500)
})

await test('an unpaid booking cancelled late: nothing waiting and no half pay', async () => {
  const s5 = await newSlot(10)
  await ok(one.A('bookExtra', { slotId: s5.id, playerKey: one.kid.key, acceptTerms: true }))
  await ok(one.A('cancelExtra', { slotId: s5.id, confirm: true }))
  assert.equal((await slotOf(s5.id)).bookings[0].lateCancel, undefined)
})

console.log(`\n${passed} 48 hour checks passed`)
