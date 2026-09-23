// End to end checks against the local harness (scripts/holiday-local.mjs).
// Start the harness first, then: node scripts/test-holiday-flow.mjs [port]
//
// Covers Lee's rule that one booking owns the whole hour, plus the payment,
// expiry, duplicate-event and recovery paths. No real Stripe, no real email.
import assert from 'node:assert/strict'

const PORT = Number(process.argv[2] || 4324)
const B = `http://localhost:${PORT}`
const ADMIN = { 'content-type': 'application/json', 'x-holiday-admin-secret': 'admin' }
let cookie = ''
let passed = 0

const j = (r) => r.json()
async function adm(action, extra = {}) {
  const res = await fetch(`${B}/api/holiday-admin`, { method: 'POST', headers: ADMIN, body: JSON.stringify({ action, ...extra }) })
  return j(res)
}
async function api(path, init = {}) {
  const res = await fetch(`${B}${path}`, { ...init, headers: { 'content-type': 'application/json', cookie, ...(init.headers || {}) } })
  return { status: res.status, body: await j(res) }
}
function book(slotId, type, players, email = 'parent@example.com') {
  return api('/api/holiday-book', {
    method: 'POST',
    body: JSON.stringify({ slotId, type, seats: players.length, players, parentName: 'Parent Test', mobile: '0400000000', email, agreementAccepted: true }),
  })
}
const KID = [{ name: 'Kid One', age: 9 }]
const TWO = [{ name: 'Kid One', age: 9 }, { name: 'Kid Two', age: 11 }]
const csOf = (body) => body.url.split('cs=')[1]
const stripe = (cs, action, extra = '') => fetch(`${B}/mock-stripe/?cs=${cs}&action=${action}${extra}`, { redirect: 'manual' })
async function slots() { return (await api('/api/holiday-slots')).body.slots }
async function freeSlots() { return (await slots()).filter((s) => !s.booked) }

async function test(name, fn) { await fn(); passed += 1; console.log(`ok - ${name}`) }
// The booking route is rate limited to 5 per minute per IP.
let booksThisMinute = 0
async function paced(fn) {
  if (booksThisMinute >= 4) { await new Promise((r) => setTimeout(r, 61_000)); booksThisMinute = 0 }
  booksThisMinute += 1
  return fn()
}

// ---------- setup ----------
await adm('saveConfig', { config: { prices: { coach: { one: 12000, shared: 9000, group: 8000 } }, holidayLabel: 'Flow Test' } })
const dates = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05']
await adm('bulkAddSlots', { template: { coachId: 'dean', type: 'open', capacity: 6, durationMin: 60 }, dates, times: ['10:00', '11:00', '12:00', '13:00'] })
const access = await fetch(`${B}/api/holiday-access`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'holiday' }) })
cookie = access.headers.get('set-cookie').split(';')[0]
const pool = await freeSlots()
assert.ok(pool.length >= 12, `need slots, got ${pool.length}`)
let next = 0
const take = () => pool[next++].id

await test('3. simultaneous checkouts on one hour yield exactly one owner', async () => {
  const id = take()
  const [a, b] = await Promise.all([book(id, 'one', KID), book(id, 'group', TWO, 'other@example.com')])
  booksThisMinute += 2
  const wins = [a, b].filter((r) => r.status === 200)
  const loses = [a, b].filter((r) => r.status === 409)
  assert.equal(wins.length, 1, 'exactly one winner')
  assert.equal(loses.length, 1, 'exactly one loser')
  assert.match(loses[0].body.error, /just booked by someone else/)
  assert.equal(loses[0].body.code, 'slot_full')
})

await test('1+2. a held hour is closed to every other type and family', async () => {
  const id = take()
  const first = await paced(() => book(id, 'one', KID))
  assert.equal(first.status, 200)
  for (const type of ['one', 'shared', 'group']) {
    const again = await paced(() => book(id, type, type === 'one' ? KID : TWO, 'second@example.com'))
    assert.equal(again.status, 409, `${type} must be refused`)
  }
  const listed = (await slots()).find((s) => s.id === id)
  assert.ok(listed, 'slot still listed')
  assert.equal(listed.booked, true, 'shows as booked')
  assert.equal(listed.remaining, undefined, 'no seat maths is advertised')
})

await test('4. player count sets the price while the whole hour is reserved', async () => {
  const id = take()
  const r = await paced(() => book(id, 'group', TWO))
  assert.equal(r.status, 200)
  const sessions = await (await fetch(`${B}/__sessions`)).json()
  const session = sessions.find((s) => s.id === csOf(r.body))
  assert.equal(session.amount_total, 16000, 'two players at the A$80 group rate')
  const listed = (await slots()).find((s) => s.id === id)
  assert.equal(listed.booked, true)
})

await test('a 1 to 1 refuses a second player, and group refuses a seventh', async () => {
  const id = take()
  const tooMany = await paced(() => book(id, 'one', TWO))
  assert.equal(tooMany.status, 400)
  assert.match(tooMany.body.error, /up to 1 player/)
  const seven = await paced(() => book(id, 'group', Array.from({ length: 7 }, (_, i) => ({ name: `Kid ${i}`, age: 9 }))))
  assert.equal(seven.status, 400)
  const free = (await slots()).find((s) => s.id === id)
  assert.equal(free.booked, false, 'a rejected booking leaves the hour free')
})

await test('6+. paid, then a duplicate webhook: one confirmation, one roster row', async () => {
  const id = take()
  const r = await paced(() => book(id, 'one', KID))
  const cs = csOf(r.body)
  await stripe(cs, 'pay')
  await stripe(cs, 'pay')  // duplicate delivery
  const confirm = await (await fetch(`${B}/api/holiday-confirm?session_id=${cs}`)).json()
  assert.equal(confirm.status, 'paid')
  const events = await (await fetch(`${B}/__events`)).json()
  const rows = events.filter((e) => e.kind === 'sheet' && e.detail.includes(r.body.bookingId))
  const mails = events.filter((e) => e.kind === 'brevo' && e.detail.includes(r.body.bookingId))
  assert.equal(rows.length, 1, `one sheet row, saw ${rows.length}`)
  assert.equal(mails.length, 2, `parent email + Lee alert, saw ${mails.length}`)
  const booking = (await adm('listBookings')).bookings.find((b) => b.id === r.body.bookingId)
  assert.equal(booking.status, 'paid')
  assert.deepEqual(booking.effects.pending, [])
  assert.deepEqual(booking.effects.failed, [])
  assert.equal(booking.effects.ok, true)
})

await test('5. an expired checkout releases only its own hour', async () => {
  const a = take(), b = take()
  const ra = await paced(() => book(a, 'one', KID))
  const rb = await paced(() => book(b, 'one', KID, 'other2@example.com'))
  await stripe(csOf(ra.body), 'expire')
  const after = await slots()
  assert.equal(after.find((s) => s.id === a).booked, false, 'expired hour is free again')
  assert.equal(after.find((s) => s.id === b).booked, true, 'the other booking is untouched')
})

await test('a cancelled checkout releases the hour, and a stale release cannot steal it', async () => {
  const id = take()
  const first = await paced(() => book(id, 'one', KID))
  const release = { action: 'release', bookingId: first.body.bookingId, releaseToken: new URL(`${B}${'/'}`).searchParams.get('x') }
  // Cancel properly using the token from the Stripe cancel_url.
  const sessions = await (await fetch(`${B}/__sessions`)).json()
  const token = new URL(sessions.find((s) => s.id === csOf(first.body)).cancel_url).searchParams.get('release')
  await api('/api/holiday-book', { method: 'POST', body: JSON.stringify({ action: 'release', bookingId: first.body.bookingId, releaseToken: token }) })
  assert.equal((await slots()).find((s) => s.id === id).booked, false)
  const closed = (await (await fetch(`${B}/__sessions`)).json()).find((s) => s.id === csOf(first.body))
  assert.equal(closed.status, 'expired', 'the Stripe page is closed so the released hour cannot be paid for')
  // Someone else books it, then the old release replays: it must not free them.
  const second = await paced(() => book(id, 'group', TWO, 'third@example.com'))
  assert.equal(second.status, 200)
  await api('/api/holiday-book', { method: 'POST', body: JSON.stringify({ action: 'release', bookingId: first.body.bookingId, releaseToken: token }) })
  assert.equal((await slots()).find((s) => s.id === id).booked, true, 'stale release must not free a newer booking')
})

await test('7. a failed side effect is recorded and repaired, never silently lost', async () => {
  const id = take()
  const r = await paced(() => book(id, 'one', KID, 'fail-sheet@example.com'))
  await fetch(`${B}/__fail?what=sheet&on=1`)
  await stripe(csOf(r.body), 'pay')
  let booking = (await adm('listBookings')).bookings.find((b) => b.id === r.body.bookingId)
  assert.equal(booking.status, 'paid', 'payment still lands')
  assert.deepEqual(booking.effects.failed, ['sheet'], 'the failure is visible in admin')
  assert.equal(booking.effects.ok, false)
  await fetch(`${B}/__fail?what=sheet&on=0`)
  const repair = await adm('repairBooking', { bookingId: r.body.bookingId })
  assert.equal(repair.success, true)
  booking = (await adm('listBookings')).bookings.find((b) => b.id === r.body.bookingId)
  assert.deepEqual(booking.effects.failed, [])
  assert.equal(booking.effects.ok, true, 'repaired')
  const events = await (await fetch(`${B}/__events`)).json()
  const rows = events.filter((e) => e.kind === 'sheet' && e.detail.includes(r.body.bookingId))
  assert.equal(rows.length, 1, 'repair wrote the row exactly once')
})

await test('blocked hours show as booked and refuse bookings', async () => {
  const id = take()
  const blocked = await adm('blockSlot', { slotId: id })
  assert.equal(blocked.success, true)
  assert.equal((await slots()).find((s) => s.id === id).booked, true)
  const r = await paced(() => book(id, 'one', KID))
  assert.equal(r.status, 409)
  const withBooking = await adm('blockSlot', { slotId: pool[1].id })
  assert.equal(withBooking.success, false, 'cannot block an hour a family already holds')
})

console.log(`\n${passed} holiday flow checks passed`)
