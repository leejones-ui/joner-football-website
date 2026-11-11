// Camp booking upgrades (Lee, 11 Nov 2026): add days to a paid sign-up and
// pay only the difference. Synthetic families only, fake Stripe, in-memory KV.
//   npm run build && node scripts/holiday-local.mjs 4321   (start via the usual symlink name)
//   node scripts/test-camp-upgrades.mjs 4321
// The worked case from the brief: three players paid A$450 for Tuesday; both
// days for three is A$750; the family pays A$300 more, once.
import assert from 'node:assert/strict'

const PORT = Number(process.argv[2] || 4321)
const B = `http://localhost:${PORT}`
const SLUG = 'christmas-holiday-camp'
const CONFIRMED = 9007199254740000
let passed = 0
async function test(name, fn) { await fn(); passed += 1; console.log(`ok - ${name}`) }
let ipSeq = 1
function client() {
  const jar = new Map()
  const ip = `10.8.0.${ipSeq++}`
  async function call(path, body, method = body ? 'POST' : 'GET') {
    const res = await fetch(`${B}${path}`, { method, redirect: 'manual', headers: { 'content-type': 'application/json', cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '), 'x-forwarded-for': ip, origin: B }, body: body ? JSON.stringify(body) : undefined })
    for (const c of res.headers.getSetCookie?.() || []) { const [kv] = c.split(';'); const i = kv.indexOf('='); const v = kv.slice(i + 1); if (v) jar.set(kv.slice(0, i), v); else jar.delete(kv.slice(0, i)) }
    let data = {}; try { data = JSON.parse(await res.text()) } catch {}
    return { status: res.status, data }
  }
  return { call }
}
const emails = async () => (await fetch(`${B}/__emails`)).json()
const telegrams = async () => (await fetch(`${B}/__telegram`)).json()
const kv = async (cmd) => (await fetch(`${B}/__kv?cmd=${encodeURIComponent(JSON.stringify(cmd))}`)).text()
const kvJson = async (key) => JSON.parse((await kv(['GET', key])) || 'null')
const fault = (what) => fetch(`${B}/__fail?what=${what}&on=1`)
const session = async (cs) => (await fetch(`${B}/__session?cs=${cs}`)).json()
const pay = (url, extra = '') => fetch(`${url}&action=pay${extra}`, { redirect: 'manual' })
const csOf = (url) => new URL(url).searchParams.get('cs')

async function signIn(email) {
  const c = client()
  const s = await c.call('/api/jfp-auth', { action: 'start', email, audience: 'staff' })
  assert.equal(s.status, 200, JSON.stringify(s.data))
  const code = (await emails()).filter((e) => e.to.includes(email) && /sign-in code/.test(e.subject)).at(-1).subject.match(/(\d{6})/)[1]
  assert.equal((await c.call('/api/jfp-auth', { action: 'verify', challenge: s.data.challenge, code })).status, 200)
  return c
}
const lee = await signIn('leejones@jonerfootball.com')
const P = (action, body = {}) => lee.call('/api/jfp-portal-data', { action, ...body })
const list = async () => (await P('campList')).data
const counts = async () => (await list()).counts
const bookingOf = (id) => kvJson(`camp:booking:${id}`)
const upgradeOf = (id) => kvJson(`camp:upgrade:${id}`)
const seats = async (day) => JSON.parse((await kv(['ZRANGE', `camp:seats:xmas-2026:${day}`, '0', '-1'])) || '[]')

// A synthetic family: three fictional players, paid online for Tuesday.
let famSeq = 0
const kid = (n) => ({ firstName: n, surname: 'Fixture', age: '10', clubLevel: 'Test FC', medical: '' })
async function paidFamily({ players = 3, days = ['tue'], promo = false } = {}) {
  famSeq += 1
  const email = `upgrade-family-${famSeq}@example.com`
  const r = await client().call('/api/camp-book', { action: 'book', camp: SLUG, days, players: ['Alex', 'Billie', 'Casey', 'Drew'].slice(0, players).map(kid), parentName: `Fixture Parent ${famSeq}`, email, mobile: '0400 000 111', heardAbout: 'Instagram', agreement: true })
  assert.equal(r.status, 200, JSON.stringify(r.data))
  if (promo) await fetch(`${B}/__session-set?cs=${csOf(r.data.url)}&set=${encodeURIComponent(JSON.stringify({ amount_total: 25000 }))}`)
  await pay(r.data.url)
  const b = await bookingOf(r.data.id)
  assert.equal(b.status, 'paid')
  return b
}
const quote = (id, days = ['mon', 'tue'], extra = {}) => P('campUpgradeQuote', { id, days, ...extra })
async function link(id, days = ['mon', 'tue']) {
  const q = await quote(id, days)
  assert.equal(q.status, 200, JSON.stringify(q.data))
  const r = await P('campUpgradeCreate', { id, days, quoteKey: q.data.quote.quoteKey })
  assert.equal(r.status, 200, JSON.stringify(r.data))
  return r.data.upgrade
}
const camp0 = JSON.parse((await kv(['HGET', 'camp:camps', 'xmas-2026'])) || 'null')
const setCamp = async (patch) => { const now = JSON.parse((await kv(['HGET', 'camp:camps', 'xmas-2026'])) || 'null') || (await list()).camp; await kv(['HSET', 'camp:camps', 'xmas-2026', JSON.stringify({ ...now, ...patch })]) }

// ---------------------------------------------------------------------------

let fam = null, up = null
await test('AC-01 quote: A$450 paid for Tuesday, A$750 for both days, pay A$300 once, nothing held or sent', async () => {
  fam = await paidFamily()
  assert.equal(fam.amountPaidCents, 45000)
  assert.equal(fam.priceCents, 45000)
  const before = await counts()
  const sent = (await emails()).length
  // The browser cannot set the amount, the count or the price.
  const q = await quote(fam.id, ['mon', 'tue'], { topUpCents: 1, players: 1, amount: 1, priceEachCents: 1 })
  assert.equal(q.status, 200, JSON.stringify(q.data))
  const x = q.data.quote
  assert.deepEqual([x.targetTotalCents, x.paidCents, x.topUpCents, x.players, x.currency], [75000, 45000, 30000, 3, 'aud'])
  assert.deepEqual(x.newDayIds, ['mon'])
  assert.deepEqual(x.targetDayIds, ['mon', 'tue'])
  assert.equal(x.text.topUp, 'A$300')
  assert.equal(x.places.mon.need, 3)
  const after = await counts()
  assert.deepEqual([after.mon.taken, after.tue.taken], [before.mon.taken, before.tue.taken], 'a quote holds nothing')
  assert.equal((await emails()).length, sent, 'a quote sends nothing')
  assert.equal((await bookingOf(fam.id)).dayIds.join(), 'tue', 'a quote changes nothing')
})

await test('AC-01 the link: one family amount, quantity one, no promo codes, separate metadata', async () => {
  const before = await counts()
  up = await link(fam.id)
  assert.equal(up.state, 'pending')
  assert.equal(up.topUpCents, 30000)
  assert.ok(up.url.includes('/mock-stripe/'))
  const s = await session(csOf(up.url))
  assert.equal(s.amount_total, 30000, 'A$300 in one line, not A$300 per child')
  assert.equal(s.line_count, 1)
  assert.equal(s.allow_promotion_codes, 'false')
  assert.equal(s.currency, 'aud')
  assert.equal(s.metadata.campUpgradeId, up.id)
  assert.equal(s.metadata.campBookingId, undefined, 'never campBookingId: the new-booking finaliser can never take it')
  assert.equal(s.piMetadata.campUpgradeId, up.id)
  assert.ok(up.linkExpiresMs - Date.now() > 23 * 3600_000, 'a link that lasts long enough to send to a family')
  const after = await counts()
  assert.equal(after.mon.taken, before.mon.taken + 3, 'three Monday places held')
  assert.equal(after.tue.taken, before.tue.taken, 'Tuesday is not held again')
  const mon = await seats('mon')
  assert.equal(mon.filter((m) => m.startsWith(`${up.id}#`)).length, 3, 'held under the upgrade, not the booking')
  assert.equal(mon.filter((m) => m.startsWith(`${fam.id}#`)).length, 0)
  const b = await bookingOf(fam.id)
  assert.deepEqual([b.dayIds.join(), b.amountPaidCents], ['tue', 45000], 'a link changes nothing on the booking')
})

await test('AC-05 the same request again, or five at once, gives the same link and one session', async () => {
  const q = (await quote(fam.id)).data
  assert.equal(q.open.id, up.id, 'the quote shows the open upgrade')
  const tries = await Promise.all([1, 2, 3, 4, 5].map(() => P('campUpgradeCreate', { id: fam.id, days: ['mon', 'tue'], quoteKey: 'anything' })))
  for (const t of tries) assert.ok(t.status === 200 ? t.data.upgrade.id === up.id && t.data.upgrade.url === up.url : t.status === 409, JSON.stringify(t.data))
  const ups = (await list()).upgrades.filter((u) => u.baseBookingId === fam.id)
  assert.equal(ups.length, 1, 'one upgrade, one charge opportunity')
  assert.equal((await counts()).mon.taken, (await seats('mon')).length)
})

await test('AC-12 while the link is out the sign-up cannot be edited or cancelled', async () => {
  const e = await P('campEdit', { id: fam.id, booking: { days: ['mon', 'tue'] } })
  assert.equal(e.status, 409)
  assert.match(e.data.error, /upgrade payment link/)
  assert.equal((await P('campCancel', { id: fam.id, reason: 'x' })).status, 409)
})

await test('AC-03 only Lee and Ligia: no sign-in and a coach are refused; the public result needs the right session', async () => {
  const anon = await client().call('/api/jfp-portal-data', { action: 'campUpgradeCreate', id: fam.id, days: ['mon', 'tue'] })
  assert.ok([401, 403].includes(anon.status), String(anon.status))
  const sam = await signIn('jonerfootballsam@gmail.com')
  for (const action of ['campUpgradeQuote', 'campUpgradeCreate', 'campUpgradeCancel', 'campUpgradeRetry', 'campUpgradeEmail', 'campUpgradePreview']) {
    const r = await sam.call('/api/jfp-portal-data', { action, id: fam.id, days: ['mon', 'tue'], upgradeId: up.id })
    assert.equal(r.status, 403, `${action} ${r.status}`)
  }
  const guess = await client().call(`/api/camp-book?camp=${SLUG}&upgraded=${up.id}&session_id=cs_test_nope`)
  assert.equal(guess.data.upgrade.status, 'unknown')
  const other = await client().call(`/api/camp-book?camp=${SLUG}&upgraded=CU-1-AAAAAA&session_id=${csOf(up.url)}`)
  assert.equal(other.data.upgrade.status, 'unknown')
  const unpaid = await client().call(`/api/camp-book?camp=${SLUG}&upgraded=${up.id}&session_id=${csOf(up.url)}`)
  assert.equal(unpaid.data.upgrade.status, 'unpaid', 'a redirect without payment is not a confirmation')
  const raw = JSON.stringify(unpaid.data)
  assert.ok(!raw.includes('@') && !raw.includes('Fixture') && !raw.includes('0400'), 'no surname, email or phone on the public result')
  // A cancelled upgrade link coming back from Stripe never releases anything.
  const rel = await client().call('/api/camp-book', { action: 'release', id: up.id, t: 'x' })
  assert.equal(rel.data.state, 'unknown')
})

await test('AC-07 verified payment: same booking, both days, A$450 + A$300 = A$750, original payment kept', async () => {
  const bookingsBefore = (await list()).bookings.length
  const monBefore = (await counts()).mon.taken
  const mailBefore = (await emails()).length
  const back = await pay(up.url)
  const loc = new URL(back.headers.get('location'))
  assert.equal(loc.searchParams.get('upgraded'), up.id)
  const b = await bookingOf(fam.id)
  assert.equal(b.id, fam.id)
  assert.deepEqual(b.dayIds, ['mon', 'tue'])
  assert.deepEqual([b.priceEachCents, b.priceCents, b.amountPaidCents], [25000, 75000, 75000])
  assert.equal(b.paymentIntent, fam.paymentIntent, 'original payment reference kept')
  assert.equal(b.stripeSessionId, fam.stripeSessionId)
  assert.equal(b.paidAt, fam.paidAt)
  assert.equal(b.players.length, 3)
  assert.deepEqual(b.payments.map((x) => [x.kind, x.amountCents]), [['original', 45000], ['upgrade', 30000]])
  assert.equal(b.payments[0].paymentIntent, fam.paymentIntent)
  assert.notEqual(b.payments[1].paymentIntent, fam.paymentIntent)
  assert.equal(b.upgrades.length, 1)
  const after = await list()
  assert.equal(after.bookings.length, bookingsBefore, 'no second sign-up')
  assert.equal(after.counts.mon.taken, monBefore, 'the held Monday places became the family\'s, not three more')
  const mon = await seats('mon')
  assert.equal(mon.filter((m) => m.startsWith(`${fam.id}#`)).length, 3)
  assert.equal(mon.filter((m) => m.startsWith(`${up.id}#`)).length, 0)
  const score = Number(await kv(['ZSCORE', 'camp:seats:xmas-2026:mon', `${fam.id}#1`]))
  assert.equal(score, CONFIRMED, 'Monday places never expire now')
  const u = after.upgrades.find((x) => x.id === up.id)
  assert.equal(u.state, 'applied')
  assert.equal(u.effects.parentEmail, 'waiting', 'the parent email waits for Lee or Ligia to approve the wording')
  const mail = (await emails()).slice(mailBefore)
  assert.ok(!mail.some((e) => e.to.includes(fam.email)), 'nothing to the family yet')
  assert.equal(mail.filter((e) => /Camp upgrade paid/.test(e.subject)).length, 1, 'Lee and Ligia told once')
  assert.ok((await telegrams()).some((t) => /Camp upgrade paid/.test(JSON.stringify(t))))
  // The family's page after Stripe.
  const page = await client().call(`/api/camp-book?camp=${SLUG}&upgraded=${up.id}&session_id=${loc.searchParams.get('session_id')}`)
  assert.equal(page.data.upgrade.status, 'confirmed')
  assert.equal(page.data.upgrade.total, 'A$750')
  assert.equal(page.data.upgrade.topUp, 'A$300')
  assert.equal(page.data.upgrade.days, 'Monday 21 December and Tuesday 22 December')
  // Paid so far counts the top-up once: A$750 for this family, not A$750 + A$300.
  assert.equal(after.bookings.find((x) => x.id === fam.id).amountPaidCents, 75000)
  // The register has the three on Monday, unticked.
  assert.deepEqual(b.checkins || {}, fam.checkins || {})
})

await test('AC-09 duplicate webhook, success page and staff retry: applied once, one payment, one staff email', async () => {
  const mailBefore = (await emails()).filter((e) => /Camp upgrade paid/.test(e.subject)).length
  const cs = csOf(up.url)
  await Promise.all([
    fetch(`${B}/__webhook?cs=${cs}&type=checkout.session.completed`),
    fetch(`${B}/__webhook?cs=${cs}&type=checkout.session.async_payment_succeeded`),
    client().call(`/api/camp-book?camp=${SLUG}&upgraded=${up.id}&session_id=${cs}`),
    P('campUpgradeRetry', { id: fam.id, upgradeId: up.id }),
  ])
  const b = await bookingOf(fam.id)
  assert.equal(b.amountPaidCents, 75000)
  assert.equal(b.payments.length, 2)
  assert.equal(b.upgrades.length, 1)
  assert.equal((await seats('mon')).filter((m) => m.startsWith(`${fam.id}#`)).length, 3)
  assert.equal((await emails()).filter((e) => /Camp upgrade paid/.test(e.subject)).length, mailBefore)
  // A late "expired" or "failed" event cannot undo it.
  await fetch(`${B}/__webhook?cs=${cs}&type=checkout.session.expired`)
  await fetch(`${B}/__webhook?cs=${cs}&type=checkout.session.async_payment_failed`)
  assert.equal((await upgradeOf(up.id)).state, 'applied')
  assert.deepEqual((await bookingOf(fam.id)).dayIds, ['mon', 'tue'])
})

await test('AC-13 the updated confirmation: preview, send once by hand, replies to Ligia', async () => {
  const pv = await P('campUpgradePreview', { id: fam.id, upgradeId: up.id })
  assert.equal(pv.status, 200)
  assert.equal(pv.data.replyTo, 'ligia@jonerfootball.com')
  assert.match(pv.data.preview.subject, /^Monday 21 December added/)
  const text = pv.data.preview.html.replace(/<[^>]+>/g, ' ')
  assert.match(text, /Paid today\s+A\$300/)
  assert.match(text, /Paid in total\s+A\$750/)
  assert.ok(!/[–—]/.test(text), 'no long dashes')
  assert.ok(!(await emails()).some((e) => e.to.includes(fam.email) && /added/.test(e.subject)), 'preview sends nothing')
  const s1 = await P('campUpgradeEmail', { id: fam.id, upgradeId: up.id })
  assert.equal(s1.status, 200, JSON.stringify(s1.data))
  const s2 = await P('campUpgradeEmail', { id: fam.id, upgradeId: up.id })
  assert.equal(s2.status, 409, 'never twice')
  const sent = (await emails()).filter((e) => e.to.includes(fam.email) && /added/.test(e.subject))
  assert.equal(sent.length, 1)
  assert.equal(sent[0].replyTo, 'ligia@jonerfootball.com')
})

await test('AC-13 refunds stay with their own payment: upgrade refund, then original refund', async () => {
  await fetch(`${B}/__refund?cs=${csOf(up.url)}&amount=10000`)
  let b = await bookingOf(fam.id)
  assert.deepEqual(b.payments.map((x) => x.refundedCents || 0), [0, 10000])
  assert.equal(b.refundedCents, 10000)
  assert.equal((await upgradeOf(up.id)).refundedCents, 10000)
  await fetch(`${B}/__refund?cs=${fam.stripeSessionId}&amount=5000`)
  b = await bookingOf(fam.id)
  assert.deepEqual(b.payments.map((x) => x.refundedCents || 0), [5000, 10000], 'the original refund did not overwrite the upgrade refund')
  assert.equal(b.refundedCents, 15000)
  assert.deepEqual(b.dayIds, ['mon', 'tue'], 'a refund never takes days off by itself')
  // A refunded booking is not upgraded again automatically.
  const q = await quote(fam.id, ['mon', 'tue'])
  assert.equal(q.status, 422)
  assert.match(q.data.error, /refund/)
})

await test('AC-02 eligibility: cash, discounted, refunded, cancelled, removed, unchanged, invalid and past days', async () => {
  const cash = await P('campAdd', { booking: { days: ['tue'], players: [kid('Cash')], parentName: 'Cash Fixture', email: 'cash-fixture@example.com', mobile: '0400 000 222' }, method: 'Cash', amount: '150' })
  const cashId = cash.data.added
  const r1 = await quote(cashId)
  assert.equal(r1.status, 422); assert.equal(r1.data.manual, true); assert.match(r1.data.error, /not paid online/)
  const promo = await paidFamily({ players: 2, promo: true })
  assert.equal(promo.amountPaidCents, 25000)
  const r2 = await quote(promo.id)
  assert.equal(r2.status, 422); assert.match(r2.data.error, /not the standard price/)
  const f = await paidFamily({ players: 1 })
  assert.match((await quote(f.id, ['mon'])).data.error, /only adds days/)
  assert.match((await quote(f.id, ['tue'])).data.error, /at least one more day/)
  assert.match((await quote(f.id, ['tue', 'xyz'])).data.error, /days from this camp/)
  const both = await paidFamily({ players: 1, days: ['mon', 'tue'] })
  assert.match((await quote(both.id, ['mon', 'tue'])).data.error, /already has every day/)
  // Past day.
  const camp = (await list()).camp
  await setCamp({ days: camp.days.map((x) => (x.id === 'mon' ? { ...x, date: '2020-01-01' } : x)) })
  assert.match((await quote(f.id)).data.error, /already been/)
  await setCamp({ days: camp.days })
  // Price changed since they booked.
  await setCamp({ prices: { oneDay: 16000, allDays: 26000 } })
  assert.match((await quote(f.id)).data.error, /price has changed/)
  await setCamp({ prices: { oneDay: 15000, allDays: 25000 } })
  // Cancelled.
  assert.equal((await P('campCancel', { id: f.id, reason: 'test' })).status, 200)
  assert.match((await quote(f.id)).data.error, /Only a paid sign-up/)
  // Stale quote key.
  const g = await paidFamily({ players: 1 })
  const stale = await P('campUpgradeCreate', { id: g.id, days: ['mon', 'tue'], quoteKey: 'old' })
  assert.equal(stale.status, 409); assert.equal(stale.data.stale, true)
  assert.ok(!(await list()).upgrades.some((u) => u.baseBookingId === g.id), 'a stale quote makes nothing')
})

await test('AC-04 a full Tuesday does not block adding Monday; a Monday without room for all three holds nothing', async () => {
  const f = await paidFamily()
  const c = await counts()
  // Tuesday exactly full, Monday with room.
  const cap = c.tue.taken
  assert.ok(cap - c.mon.taken >= 3, 'fixture: Monday has room')
  await setCamp({ capacityPerDay: cap })
  assert.equal((await counts()).tue.left, 0, 'Tuesday is full')
  const u = await link(f.id)
  assert.equal(u.state, 'pending')
  assert.equal((await counts()).tue.taken, cap, 'Tuesday untouched')
  assert.equal((await P('campUpgradeCancel', { id: f.id, upgradeId: u.id })).status, 200)
  // Monday with only two left: no partial hold.
  const now = await counts()
  await setCamp({ capacityPerDay: now.mon.taken + 2 })
  const monBefore = (await counts()).mon.taken
  const q = await quote(f.id)
  assert.equal(q.data.quote.room, false)
  const r = await P('campUpgradeCreate', { id: f.id, days: ['mon', 'tue'], quoteKey: q.data.quote.quoteKey })
  assert.equal(r.status, 409)
  assert.equal((await counts()).mon.taken, monBefore, 'no new-day partial reservation')
  assert.equal((await bookingOf(f.id)).dayIds.join(), 'tue')
  await setCamp({ capacityPerDay: 72 })
})

await test('AC-06 Stripe refuses: holds let go; Stripe silent: kept, and Create again gives the same session', async () => {
  const f = await paidFamily()
  const mon0 = (await counts()).mon.taken
  await fault('checkout-refuse')
  const q = (await quote(f.id)).data.quote
  const r = await P('campUpgradeCreate', { id: f.id, days: ['mon', 'tue'], quoteKey: q.quoteKey })
  assert.equal(r.status, 502)
  assert.equal((await counts()).mon.taken, mon0, 'a definite failure releases only its own holds')
  assert.equal((await list()).upgrades.find((u) => u.baseBookingId === f.id).state, 'failed')
  await fault('checkout-timeout')
  const q2 = (await quote(f.id)).data.quote
  const t = await P('campUpgradeCreate', { id: f.id, days: ['mon', 'tue'], quoteKey: q2.quoteKey })
  assert.equal(t.status, 502)
  assert.match(t.data.error, /same link/)
  assert.equal((await counts()).mon.taken, mon0 + 3, 'unclear: the places stay held')
  const again = await P('campUpgradeCreate', { id: f.id, days: ['mon', 'tue'], quoteKey: q2.quoteKey })
  assert.equal(again.status, 200, JSON.stringify(again.data))
  assert.equal(again.data.upgrade.state, 'pending')
  const s = await session(csOf(again.data.upgrade.url))
  assert.equal(s.metadata.campUpgradeId, again.data.upgrade.id, 'the session Stripe made the first time')
  const b = await bookingOf(f.id)
  assert.deepEqual([b.dayIds.join(), b.amountPaidCents, b.paymentIntent], ['tue', 45000, f.paymentIntent])
  await P('campUpgradeCancel', { id: f.id, upgradeId: again.data.upgrade.id })
})

await test('AC-10 an unpaid link expires: only its Monday holds go, Tuesday stays, and a new link can be made', async () => {
  const f = await paidFamily()
  const c0 = await counts()
  const u = await link(f.id)
  assert.equal((await counts()).mon.taken, c0.mon.taken + 3)
  await fetch(`${u.url}&action=expire`, { redirect: 'manual' })
  assert.equal((await upgradeOf(u.id)).state, 'expired')
  const c1 = await counts()
  assert.deepEqual([c1.mon.taken, c1.tue.taken], [c0.mon.taken, c0.tue.taken])
  assert.equal((await seats('tue')).filter((m) => m.startsWith(`${f.id}#`)).length, 3, 'original places never expire')
  const page = await client().call(`/api/camp-book?camp=${SLUG}&upgraded=${u.id}&session_id=${csOf(u.url)}`)
  assert.equal(page.data.upgrade.status, 'expired')
  const u2 = await link(f.id)
  assert.notEqual(u2.id, u.id)
  await P('campUpgradeCancel', { id: f.id, upgradeId: u2.id })
  assert.equal((await counts()).mon.taken, c0.mon.taken)
})

await test('AC-11 paid after the hold ran out: room means applied; full means kept for staff, no overbooking', async () => {
  const f = await paidFamily()
  const u = await link(f.id)
  await kv(['ZREM', 'camp:seats:xmas-2026:mon', `${u.id}#1`, `${u.id}#2`, `${u.id}#3`])
  await pay(u.url)
  assert.equal((await upgradeOf(u.id)).state, 'applied', 'taken fresh when there is room')
  assert.equal((await bookingOf(f.id)).amountPaidCents, 75000)

  const g = await paidFamily()
  const v = await link(g.id)
  await kv(['ZREM', 'camp:seats:xmas-2026:mon', `${v.id}#1`, `${v.id}#2`, `${v.id}#3`])
  const c = await counts()
  await setCamp({ capacityPerDay: c.mon.taken })
  const tg = (await telegrams()).length
  await pay(v.url)
  const w = await upgradeOf(v.id)
  assert.equal(w.state, 'recovery')
  assert.match(w.reason, /full/)
  assert.ok(w.paymentIntent, 'the money is recorded')
  const b = await bookingOf(g.id)
  assert.deepEqual([b.dayIds.join(), b.amountPaidCents], ['tue', 45000], 'original booking kept, nothing confirmed falsely')
  const c2 = await counts()
  assert.ok(c2.mon.taken <= c.mon.taken, 'not overbooked')
  assert.ok((await telegrams()).slice(tg).some((t) => /CHECK camp upgrade/.test(JSON.stringify(t))), 'Lee told')
  const page = await client().call(`/api/camp-book?camp=${SLUG}&upgraded=${v.id}&session_id=${csOf(v.url)}`)
  assert.equal(page.data.upgrade.status, 'checking', 'payment received, staff checking')
  // A place opens: staff press Check payment and it applies.
  await setCamp({ capacityPerDay: 72 })
  const fix = await P('campUpgradeRetry', { id: g.id, upgradeId: v.id })
  assert.equal(fix.status, 200)
  assert.equal((await upgradeOf(v.id)).state, 'applied')
  assert.equal((await bookingOf(g.id)).amountPaidCents, 75000)
})

await test('AC-08 wrong amount, or a booking changed after the link: money kept for staff, booking untouched', async () => {
  const f = await paidFamily()
  const u = await link(f.id)
  const rec = await upgradeOf(u.id)
  await kv(['SET', `camp:upgrade:${u.id}`, JSON.stringify({ ...rec, topUpCents: 29999 })])
  await pay(u.url)
  const x = await upgradeOf(u.id)
  assert.equal(x.state, 'recovery')
  assert.match(x.reason, /expected A\$299\.99/)
  assert.deepEqual([(await bookingOf(f.id)).dayIds.join(), (await bookingOf(f.id)).amountPaidCents], ['tue', 45000])

  const g = await paidFamily()
  const v = await link(g.id)
  const b = await bookingOf(g.id)
  await kv(['SET', `camp:booking:${g.id}`, JSON.stringify({ ...b, players: b.players.slice(0, 2) })])
  await pay(v.url)
  const y = await upgradeOf(v.id)
  assert.equal(y.state, 'recovery')
  assert.match(y.reason, /changed/)
  assert.equal((await bookingOf(g.id)).amountPaidCents, 45000)
  assert.equal((await seats('mon')).filter((m) => m.startsWith(`${g.id}#`)).length, 0, 'no Monday places given')
})

await test('AC-09 crash recovery: places moved but booking not saved, or booking saved but not marked: finishes once', async () => {
  // 1. Crash after the seat move, before the booking was written.
  const f = await paidFamily()
  const u = await link(f.id)
  await pay(u.url, '&webhook=off')
  const s = await session(csOf(u.url))
  const rec = await upgradeOf(u.id)
  await kv(['SET', `camp:upgrade:${u.id}`, JSON.stringify({ ...rec, state: 'applying', paymentIntent: s.payment_intent, paidAt: new Date().toISOString() })])
  await kv(['ZREM', 'camp:seats:xmas-2026:mon', `${u.id}#1`, `${u.id}#2`, `${u.id}#3`])
  for (const i of [1, 2, 3]) await kv(['ZADD', 'camp:seats:xmas-2026:mon', String(CONFIRMED), `${f.id}#${i}`])
  const mon0 = (await counts()).mon.taken
  assert.equal((await P('campUpgradeRetry', { id: f.id, upgradeId: u.id })).status, 200)
  assert.equal((await upgradeOf(u.id)).state, 'applied')
  const b = await bookingOf(f.id)
  assert.deepEqual([b.amountPaidCents, b.payments.length, b.dayIds.join()], [75000, 2, 'mon,tue'])
  assert.equal((await counts()).mon.taken, mon0, 'no extra places taken')
  // 2. Crash after the booking was written, before the upgrade was marked.
  const g = await paidFamily()
  const v = await link(g.id)
  await pay(v.url)
  const done = await upgradeOf(v.id)
  await kv(['SET', `camp:upgrade:${v.id}`, JSON.stringify({ ...done, state: 'applying' })])
  await P('campUpgradeRetry', { id: g.id, upgradeId: v.id })
  const c = await bookingOf(g.id)
  assert.deepEqual([c.amountPaidCents, c.payments.length, c.upgrades.length], [75000, 2, 1], 'not applied twice')
  assert.equal((await upgradeOf(v.id)).state, 'applied')
})

await test('AC-14 the ordinary booking path is unchanged: book, pay, confirm, original email once', async () => {
  const r = await client().call('/api/camp-book', { action: 'book', camp: SLUG, days: ['mon'], players: [kid('Plain')], parentName: 'Plain Fixture', email: 'plain-fixture@example.com', mobile: '0400 000 333', heardAbout: 'Instagram', agreement: true })
  assert.equal(r.status, 200)
  const s = await session(csOf(r.data.url))
  assert.equal(s.metadata.campBookingId, r.data.id)
  assert.equal(s.allow_promotion_codes, 'true', 'ordinary bookings still take promo codes')
  await pay(r.data.url)
  assert.equal((await bookingOf(r.data.id)).status, 'paid')
  assert.equal((await emails()).filter((e) => e.to.includes('plain-fixture@example.com') && /^Booked in/.test(e.subject)).length, 1)
  assert.ok(!(await bookingOf(r.data.id)).payments, 'no upgrade fields on an ordinary booking')
})

if (camp0) await kv(['HSET', 'camp:camps', 'xmas-2026', JSON.stringify(camp0)])
console.log(`\n${passed} camp upgrade checks passed`)
