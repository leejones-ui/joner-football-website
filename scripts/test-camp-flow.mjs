// End to end checks for camp sign-ups (Lee, 10 Nov 2026) against the local
// harness: fake Stripe, captured email, in-memory KV.
//   npm run build && node scripts/holiday-local.mjs   (start it via a symlink name)
//   node scripts/test-camp-flow.mjs 4321
import assert from 'node:assert/strict'

const PORT = Number(process.argv[2] || 4321)
const B = `http://localhost:${PORT}`
const SLUG = 'christmas-holiday-camp'
let passed = 0
async function test(name, fn) { await fn(); passed += 1; console.log(`ok - ${name}`) }
let ipSeq = 1
function client() {
  const jar = new Map()
  const ip = `10.9.0.${ipSeq++}`
  async function call(path, body, method = body ? 'POST' : 'GET') {
    const res = await fetch(`${B}${path}`, { method, redirect: 'manual', headers: { 'content-type': 'application/json', cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '), 'x-forwarded-for': ip, origin: B }, body: body ? JSON.stringify(body) : undefined })
    for (const c of res.headers.getSetCookie?.() || []) { const [kv] = c.split(';'); const i = kv.indexOf('='); const v = kv.slice(i + 1); if (v) jar.set(kv.slice(0, i), v); else jar.delete(kv.slice(0, i)) }
    let data = {}; try { data = JSON.parse(await res.text()) } catch {}
    return { status: res.status, data }
  }
  return { call }
}
const emails = async () => (await fetch(`${B}/__emails`)).json()
const kv = async (cmd) => (await fetch(`${B}/__kv?cmd=${encodeURIComponent(JSON.stringify(cmd))}`)).text()
const stripe = (url, action) => fetch(`${url}&action=${action}`, { redirect: 'manual' })
const camp = async () => (await client().call(`/api/camp-book?camp=${SLUG}`)).data.camp
const player = (n, extra = {}) => ({ firstName: n, surname: 'Tester', age: '9', clubLevel: 'Forest U9', medical: '', ...extra })
const family = (extra = {}) => ({ action: 'book', camp: SLUG, days: ['mon', 'tue'], players: [player('Sam')], parentName: 'Pat Tester', email: 'pat@example.com', mobile: '0412 345 678', heardAbout: 'Instagram', source: 'instagram / paid', agreement: true, ...extra })

async function staff() {
  const c = client()
  const s = await c.call('/api/jfp-auth', { action: 'start', email: 'leejones@jonerfootball.com', audience: 'staff' })
  assert.equal(s.status, 200, JSON.stringify(s.data))
  const code = (await emails()).filter((e) => e.to.includes('leejones@jonerfootball.com') && /sign-in code/.test(e.subject)).at(-1).subject.match(/(\d{6})/)[1]
  assert.equal((await c.call('/api/jfp-auth', { action: 'verify', challenge: s.data.challenge, code })).status, 200)
  return c
}
const portal = (c, action, body = {}) => c.call('/api/jfp-portal-data', { action, ...body })

// What staff see (the public page never gets these numbers).
let lee = null
const taken = async (id) => (await portal(lee ||= await staff(), 'campList')).data.counts[id].taken

await test('the page data: prices, venue, and no totals until a day is nearly full', async () => {
  const c = await camp()
  assert.equal(c.title, 'Christmas Holiday Camp')
  assert.equal(c.location, 'Rydalmere Park')
  assert.equal(c.ages, 'Ages 7 to 16')
  assert.equal(c.prices.oneDay, 15000)
  assert.equal(c.prices.allDays, 25000)
  assert.equal(c.prices.save, 5000)
  assert.deepEqual(c.days.map((d) => [d.left, d.low, d.full, d.bookable]), [[null, false, false, true], [null, false, false, true]])
  const raw = JSON.stringify(c)
  assert.ok(!raw.includes('72') && !raw.includes('capacity') && !raw.includes('taken'), 'the 72 never reaches the website')
  assert.ok(!raw.includes('@'), 'no emails in the public data')
  const old = (await client().call('/api/camp-book?camp=christmas-drop-and-shop')).data.camp
  assert.equal(old.slug, SLUG, 'the first address of the page still answers')
})

let paidId = '', paidQuery = ''
await test('book two players for both days, pay, and the family is booked in with the email', async () => {
  const f = client()
  const r = await f.call('/api/camp-book', family({ players: [player('Sam'), player('Ella', { age: '7', medical: 'Asthma, has a puffer' })] }))
  assert.equal(r.status, 200, JSON.stringify(r.data))
  assert.equal(r.data.totalCents, 50000, 'two players x A$250')
  assert.equal((await taken('mon')), 2, 'held places count straight away')
  assert.equal((await taken('tue')), 2)
  const back = await stripe(r.data.url, 'pay')
  const loc = back.headers.get('location')
  assert.match(loc, /booked=CB-/)
  const u = new URL(loc)
  paidQuery = `/api/camp-book?camp=${SLUG}&booked=${u.searchParams.get('booked')}&session_id=${u.searchParams.get('session_id')}`
  const done = await f.call(paidQuery)
  assert.equal(done.data.booking.status, 'paid')
  assert.equal(done.data.booking.paid, 'A$500')
  paidId = done.data.booking.id
  const mail = await emails()
  const parent = mail.find((e) => e.to.includes('pat@example.com') && /^Booked in: /.test(e.subject))
  assert.ok(parent, 'parent confirmation sent')
  assert.match(parent.html, /What to bring/)
  assert.match(parent.html, /Shin guards/)
  assert.match(parent.html, /Rydalmere Park/)
  assert.ok(!/hand players|people you named|Drop and Shop/i.test(parent.html), 'no pick-up rule and no old name')
  assert.match(parent.html, /Sam and Ella are booked in/)
  assert.ok(!/[–—]/.test(parent.html.replace(/<[^>]+>/g, '')), 'no long dashes in the email')
  for (const banned of ['check out', "don't miss", 'link in bio', 'unlock', 'elevate']) assert.ok(!parent.html.toLowerCase().includes(banned), banned)
  const staff = mail.find((e) => /PAID camp sign-up/.test(e.subject))
  assert.ok(staff && staff.to.includes('ligia@jonerfootball.com') && staff.to.includes('leejones@jonerfootball.com'), 'Lee and Ligia alerted')
  assert.match(staff.html, /Asthma/)
  assert.equal(staff.replyTo, 'pat@example.com')
})

await test('the webhook and the success page finishing the same booking send one email, not two', async () => {
  const f = client()
  const r = await f.call('/api/camp-book', family({ email: 'twice@example.com', days: ['mon'] }))
  const u = new URL((await stripe(r.data.url, 'pay')).headers.get('location'))
  const q = `/api/camp-book?camp=${SLUG}&booked=${u.searchParams.get('booked')}&session_id=${u.searchParams.get('session_id')}`
  await Promise.all([f.call(q), f.call(q), f.call(q)])
  assert.equal((await emails()).filter((e) => e.to.includes('twice@example.com')).length, 1)
})

await test('no webhook at all: the success page alone confirms the booking', async () => {
  const f = client()
  const r = await f.call('/api/camp-book', family({ email: 'nohook@example.com', days: ['tue'] }))
  const u = new URL((await stripe(r.data.url, 'pay&webhook=off')).headers.get('location'))
  const d = await f.call(`/api/camp-book?camp=${SLUG}&booked=${u.searchParams.get('booked')}&session_id=${u.searchParams.get('session_id')}`)
  assert.equal(d.data.booking.status, 'paid')
  assert.ok((await emails()).some((e) => e.to.includes('nohook@example.com')))
})

await test('back from Stripe without paying: the places are let go', async () => {
  const before = (await taken('mon'))
  const f = client()
  const r = await f.call('/api/camp-book', family({ email: 'leave@example.com', days: ['mon'] }))
  assert.equal((await taken('mon')), before + 1)
  const loc = new URL((await stripe(r.data.url, 'cancel')).headers.get('location'))
  const rel = await f.call('/api/camp-book', { action: 'release', id: loc.searchParams.get('cancelled'), t: loc.searchParams.get('t') })
  assert.equal(rel.data.state, 'cancelled')
  assert.equal((await taken('mon')), before)
  const wrong = await f.call('/api/camp-book', { action: 'release', id: paidId, t: 'nope' })
  assert.equal(wrong.data.state, 'unknown', 'a paid booking cannot be released without its token')
})

await test('a full day: the last place is never sold twice, the error says so, and the waitlist takes details', async () => {
  const c = await camp()
  const raw = JSON.parse(await kv(['HGET', 'camp:camps', 'xmas-2026']) || 'null') || {}
  const monTaken = await taken('mon')
  await kv(['HSET', 'camp:camps', 'xmas-2026', JSON.stringify({ ...c, ...raw, prices: { oneDay: 15000, allDays: 25000 }, capacityPerDay: monTaken + 1 })])
  const low = (await camp()).days.find((d) => d.id === 'mon')
  assert.deepEqual([low.left, low.low], [1, true], 'nearly full: the website now says how many are left')
  const tries = await Promise.all([1, 2, 3].map((i) => client().call('/api/camp-book', family({ email: `race${i}@example.com`, days: ['mon'] }))))
  assert.equal(tries.filter((t) => t.status === 200).length, 1, 'exactly one family gets the last place')
  const no = tries.find((t) => t.status === 409)
  assert.match(no.data.error, /Monday 21 December is full/)
  const both = await client().call('/api/camp-book', family({ email: 'both@example.com' }))
  assert.equal(both.status, 409, 'both days refused when one is full')
  const w = await client().call('/api/camp-book', { action: 'waitlist', camp: SLUG, days: ['mon'], parentName: 'Wendy Wait', email: 'wait@example.com', mobile: '0400 111 222', players: 'Tim (8)' })
  assert.equal(w.status, 200)
  const fullDay = (await camp()).days.find((d) => d.id === 'mon')
  assert.deepEqual([fullDay.full, fullDay.bookable, fullDay.left], [true, false, null])
  await kv(['HSET', 'camp:camps', 'xmas-2026', JSON.stringify({ ...c, ...raw, capacityPerDay: 72 })])
})

await test('the form refuses missing details', async () => {
  for (const [bad, msg] of [[{ players: [] }, /at least one player/], [{ players: [player('A', { surname: '' })] }, /surname/], [{ parentName: '' }, /parent/], [{ mobile: '12' }, /mobile/], [{ agreement: false }, /terms/], [{ days: [] }, /which day/], [{ players: [player('A', { age: '40' })] }, /age/]]) {
    const r = await client().call('/api/camp-book', family({ email: 'bad@example.com', ...bad }))
    assert.equal(r.status, 400, JSON.stringify(bad))
    assert.match(r.data.error, msg)
  }
})

await test('portal Camps tab: every sign-up, add by hand, check in, change, cancel and settings', async () => {
  lee ||= await staff()
  const list = await portal(lee, 'campList')
  assert.equal(list.status, 200, JSON.stringify(list.data))
  assert.ok(list.data.bookings.some((b) => b.id === paidId && b.status === 'paid' && b.players.length === 2))
  assert.ok(list.data.waitlist.some((w) => w.email === 'wait@example.com'))
  assert.ok(!list.data.bookings.some((b) => b.releaseToken), 'release tokens stay on the server')
  const monBefore = list.data.counts.mon.taken
  const add = await portal(lee, 'campAdd', { booking: { days: ['mon'], players: [{ firstName: 'Cash', surname: 'Kid', age: '8' }], parentName: 'Cash Parent', email: 'cash@example.com', mobile: '0400 000 000' }, method: 'Cash', amount: '150' })
  assert.equal(add.status, 200, JSON.stringify(add.data))
  assert.equal(add.data.counts.mon.taken, monBefore + 1)
  const cash = add.data.bookings.find((b) => b.id === add.data.added)
  assert.equal(cash.amountPaidCents, 15000)
  assert.ok(!(await emails()).some((e) => e.to.includes('cash@example.com')), 'no email unless asked')
  const ck = await portal(lee, 'campCheckin', { id: cash.id, player: 0, day: 'mon', state: 'in' })
  assert.equal(ck.data.booking.checkins['mon|0'].state, 'in')
  assert.equal((await portal(lee, 'campCheckin', { id: cash.id, player: 0, day: 'tue', state: 'in' })).status, 400, 'not booked on Tuesday')
  const ed = await portal(lee, 'campEdit', { id: cash.id, booking: { days: ['mon', 'tue'] } })
  assert.equal(ed.status, 200, JSON.stringify(ed.data))
  assert.equal(ed.data.counts.tue.taken, list.data.counts.tue.taken + 1, 'moving to both days takes a Tuesday place')
  const cx = await portal(lee, 'campCancel', { id: cash.id, reason: 'Test' })
  assert.equal(cx.data.counts.mon.taken, monBefore)
  const st = await portal(lee, 'campSave', { settings: { oneDay: '160', allDays: '260', location: 'Test Park', address: '1 Test St' } })
  assert.equal(st.status, 200)
  const c = await camp()
  assert.equal(c.prices.oneDay, 16000)
  assert.equal(c.location, 'Test Park')
  await portal(lee, 'campSave', { settings: { oneDay: '150', allDays: '250', location: 'Rydalmere Park', address: 'South Street, Rydalmere NSW 2116' } })
  assert.equal((await camp()).prices.allDays, 25000)
  const resend = await portal(lee, 'campResend', { id: paidId })
  assert.equal(resend.status, 200, JSON.stringify(resend.data))
  // Refund case: cancelled after paying. Reloading the success page must not bring it back.
  const before = (await taken('tue'))
  const cx2 = await portal(lee, 'campCancel', { id: paidId, reason: 'Refunded' })
  assert.ok(cx2.data.refund?.url.includes('dashboard.stripe.com'), 'a link to refund in Stripe')
  assert.equal(cx2.data.refund.amountCents, 50000, 'more than 14 days out: the camp terms say a full refund')
  assert.match(cx2.data.refund.rule, /14 days or more/)
  assert.equal((await taken('tue')), before - 2)
  const again = await client().call(paidQuery)
  assert.equal(again.data.booking.status, 'cancelled')
  assert.equal((await taken('tue')), before - 2, 'places stay free')
})

await test('started and not paid: listed in the portal, reminded like the USA camps, and gone once they book', async () => {
  const f = client()
  const r = await f.call('/api/camp-book', family({ email: 'slow@example.com', parentName: 'Sally Slow', days: ['tue'] }))
  const loc = new URL((await stripe(r.data.url, 'cancel')).headers.get('location'))
  await f.call('/api/camp-book', { action: 'release', id: loc.searchParams.get('cancelled'), t: loc.searchParams.get('t') })
  let list = (await portal(lee, 'campList')).data
  const u = list.unfinished.find((b) => b.email === 'slow@example.com')
  assert.ok(u, 'shown under Not finished')
  assert.ok(!list.unfinished.some((b) => b.email === 'pat@example.com'), 'a family who paid is not chased')
  assert.equal((await client().call('/api/camp-book?tick=1')).status, 401, 'the reminder run needs the cron secret')
  const tick = () => fetch(`${B}/api/camp-book?tick=1`, { headers: { authorization: 'Bearer local-cron-secret' } }).then((x) => x.json())
  assert.equal((await tick()).sent, 0, 'nothing in the first hour')
  const b = JSON.parse(await kv(['GET', `camp:booking:${u.id}`]))
  await kv(['SET', `camp:booking:${u.id}`, JSON.stringify({ ...b, createdAt: new Date(Date.now() - 2 * 3600_000).toISOString() })])
  assert.ok((await tick()).sent >= 1)
  const mail = (await emails()).filter((e) => e.to.includes('slow@example.com'))
  assert.equal(mail.length, 1)
  assert.match(mail[0].subject, /not confirmed yet/)
  assert.match(mail[0].html, /christmas-holiday-camp\/\?utm_source=email/)
  assert.equal((await tick()).sent, 0, 'never twice within a day')
  assert.equal((await portal(lee, 'campReminderStop', { id: u.id })).status, 200)
  const again = await f.call('/api/camp-book', family({ email: 'slow@example.com', parentName: 'Sally Slow', days: ['tue'] }))
  await stripe(again.data.url, 'pay')
  list = (await portal(lee, 'campList')).data
  assert.ok(!list.unfinished.some((x) => x.email === 'slow@example.com'), 'booked now, so off the list')
  const paid = list.bookings.find((x) => x.email === 'slow@example.com' && x.status === 'paid')
  assert.equal(paid.cameFrom, 'instagram / paid', 'where they came from is kept')
  assert.equal(paid.source, 'online')
  // A refund made in Stripe shows on the sign-up.
  await fetch(`${B}/__refund?cs=${paid.stripeSessionId}&amount=5000`)
  const after = (await portal(lee, 'campList')).data.bookings.find((x) => x.id === paid.id)
  assert.equal(after.refundedCents, 5000)
})

await test('camp terms: 14 days full, 48 hours less A$5, 24 hours half, then nothing, and the tick is recorded', async () => {
  const { campRefundFor, XMAS_2026, CAMP_TERMS_VERSION } = await import('../api/_camp-store.js')
  const b = { dayIds: ['mon', 'tue'], amountPaidCents: 25000 }
  const start = Date.parse('2026-12-21T09:00:00+11:00')
  const at = (hoursBefore) => campRefundFor(b, XMAS_2026, start - hoursBefore * 3_600_000).amountCents
  assert.deepEqual([at(15 * 24), at(14 * 24), at(14 * 24 - 1), at(48), at(47), at(24), at(23), at(-1)], [25000, 25000, 24500, 24500, 12500, 12500, 0, 0])
  assert.equal(campRefundFor({ dayIds: ['tue'], amountPaidCents: 15000 }, XMAS_2026, start).amountCents, 7500, 'a Tuesday only booking counts back from Tuesday')
  assert.equal(campRefundFor({ ...b, refundedCents: 25000 }, XMAS_2026, start - 400 * 3_600_000).amountCents, 0, 'already refunded: nothing more')
  const list = (await portal(lee, 'campList')).data
  const online = list.bookings.find((x) => x.source === 'online' && x.status === 'paid')
  assert.equal(online.termsVersion, CAMP_TERMS_VERSION)
  assert.ok(online.agreedAt && online.refundDue.amountCents > 0)
})

console.log(`\n${passed} camp flow checks passed`)
