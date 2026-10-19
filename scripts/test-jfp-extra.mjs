// Extra sessions end to end against the local harness:
//   npm run build && node scripts/holiday-local.mjs 4321
//   node scripts/test-jfp-extra.mjs 4321
import assert from 'node:assert/strict'

const PORT = process.argv[2] || '4321'
const B = `http://localhost:${PORT}`
let passed = 0, failed = 0
async function test(name, fn) { try { await fn(); passed += 1; console.log(`ok - ${name}`) } catch (e) { failed += 1; console.log(`FAIL - ${name}\n  ${e.message}`) } }
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
const at = async () => (await fetch(`${B}/__airtable`)).json()
const tick = async (now) => (await fetch(`${B}/api/jfp-groups?coachTick=1&now=${now}`, { headers: { authorization: 'Bearer local-cron-secret' } })).json()
async function signIn(c, email) {
  const s = await c.call('/api/jfp-auth', { action: 'start', email, audience: 'staff' })
  assert.equal(s.status, 200, JSON.stringify(s.data))
  const code = (await emails()).filter((e) => e.to.includes(email) && /sign-in code/.test(e.subject)).at(-1).subject.match(/(\d{6})/)[1]
  assert.equal((await c.call('/api/jfp-auth', { action: 'verify', challenge: s.data.challenge, code })).status, 200)
}
const lee = client(), dean = client(), sam = client()
await signIn(lee, 'leejones@jonerfootball.com')
await signIn(dean, 'jonerfootballdean@gmail.com')
await signIn(sam, 'jonerfootballsam@gmail.com')
const P = (c) => (action, body = {}) => c.call('/api/jfp-portal-data', { action, ...body })
const L = P(lee), D = P(dean), S = P(sam)
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date())
const plus = (n) => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
let priceId = '', slot = null

await test('prices: only Lee and Ligia set them; a coach cannot open a session without one', async () => {
  assert.equal((await D('extraList')).data.prices.length, 0)
  assert.equal((await D('extraSave', { slot: { date: plus(1), time: '4:30pm', capacity: 1, location: 'Belrose HQ', priceCents: 12000 } })).status, 400, 'a coach cannot type a price')
  assert.equal((await D('extraPrices', { add: { label: 'Mine', dollars: 500 } })).status, 403)
  const r = await L('extraPrices', { add: { label: 'Extra session 1 hour', dollars: '120', durationMin: 60 } })
  assert.equal(r.status, 200, JSON.stringify(r.data))
  priceId = r.data.prices[0].id
  assert.equal(r.data.prices[0].cents, 12000)
})

await test('a coach opens a private session from a price; Lee hears on Telegram; other coaches cannot see or change it', async () => {
  const tg = (await telegrams()).length
  const r = await D('extraSave', { slot: { date: plus(1), time: '4:30pm', capacity: 2, location: 'Belrose HQ', priceId, visibility: 'private', title: 'Finishing' } })
  assert.equal(r.status, 200, JSON.stringify(r.data))
  slot = r.data.slot
  assert.equal(slot.coachId, 'dean'); assert.equal(slot.token, undefined, 'the private token is only inside the link')
  // Coaches never see what a session costs (Lee, 19 Oct 2026); Lee does.
  assert.equal(slot.priceCents, undefined); assert.equal(slot.priceLabel, undefined)
  assert.equal((await L('extraList')).data.slots.find((x) => x.id === slot.id).priceCents, 12000)
  assert.match(slot.link, /jfp-account\/#extra\?slot=XS-.*&k=/)
  assert.ok((await telegrams()).slice(tg).some((t) => /Extra session opened by Coach Dean/.test(JSON.stringify(t))))
  assert.ok(!(await S('extraList')).data.slots.some((x) => x.id === slot.id), 'Sam does not see it')
  assert.equal((await S('extraSave', { slot: { ...slot, id: slot.id } })).status, 400)
  assert.ok((await L('extraList')).data.slots.some((x) => x.id === slot.id), 'Lee sees every coach')
})

await test('a coach puts players on: a JFP player from Airtable and someone new; it fills up; no double booking', async () => {
  const g = (await L('saveGroup', { group: { day: 'Friday', time: '6:10pm', location: 'Belrose HQ', coachId: 'dean', capacity: 12, mode: 'direct', minAge: 7, maxAge: 18 } })).data.group
  const add = await L('addPlayer', { groupId: g.id, force: true, player: { name: 'Sienna Hawkins' }, parent: { name: 'Hawk Parent', email: 'sienna@example.com', mobile: '0400 444 555' }, payment: 'none' })
  assert.equal(add.status, 200, JSON.stringify(add.data))
  const found = (await D('extraSearch', { q: 'sienna' })).data.results
  assert.ok(found.length && !('email' in found[0]), 'search shows names, not contacts')
  const a = await D('extraAttach', { slotId: slot.id, rowId: found[0].rowId })
  assert.equal(a.status, 200, JSON.stringify(a.data))
  assert.equal(a.data.booking.email, 'sienna@example.com', 'email from Airtable')
  assert.equal((await D('extraAttach', { slotId: slot.id, rowId: found[0].rowId })).data.already, true)
  assert.equal((await D('extraAttach', { slotId: slot.id, name: 'No Email' })).status, 400, 'an email is needed so it shows in their account')
  assert.equal((await D('extraAttach', { slotId: slot.id, name: 'Kai New', email: 'kai.new@example.com', mobile: '0400 111 999' })).status, 200)
  assert.equal((await D('extraAttach', { slotId: slot.id, name: 'Too Many', email: 'tm@example.com' })).status, 409, 'full')
  assert.equal((await S('extraAttach', { slotId: slot.id, name: 'Sneaky', email: 'x@example.com' })).status, 403)
  const v = (await D('extraList')).data.slots.find((x) => x.id === slot.id)
  assert.equal(v.placesLeft, 0); assert.equal(v.bookings.length, 2)
  // Each booking is a charge in the family's account, tied to the player and coach.
  assert.ok(v.bookings.every((b) => b.payreqId && b.payStatus === 'open'), JSON.stringify(v.bookings.map((b) => b.payStatus)))
  const fam = client()
  { const s2 = await fam.call('/api/jfp-auth', { action: 'start', email: 'sienna@example.com', audience: 'parent' }); const code = (await emails()).filter((e) => e.to.includes('sienna@example.com') && /sign-in code/.test(e.subject)).at(-1).subject.match(/(\d{6})/)[1]; await fam.call('/api/jfp-auth', { action: 'verify', challenge: s2.data.challenge, code }) }
  const ov = (await fam.call('/api/jfp-account', { action: 'overview' })).data
  assert.ok(JSON.stringify(ov.todo || []).includes('A$120') || JSON.stringify(ov).includes(v.bookings[0].payreqId), 'the charge is in Sienna\'s account to pay')
})

await test('register: not before the day; marks save to Airtable Attendance; a reminder if the coach forgets', async () => {
  const b = (await D('extraList')).data.slots.find((x) => x.id === slot.id).bookings[0]
  assert.equal((await D('extraMark', { slotId: slot.id, bookingId: b.id, status: 'Present' })).status, 400, 'tomorrow is not today')
  await L('setCoachAlerts', { register: true, newPlayer: true })
  const t = await D('extraSave', { slot: { date: plus(2), time: '7:00am', capacity: 1, location: 'NTRA', priceId, visibility: 'public' } })
  assert.equal(t.status, 200, JSON.stringify(t.data))
  assert.equal((await D('extraAttach', { slotId: t.data.slot.id, name: 'Rem Inder', email: 'rem@example.com' })).status, 200)
  // 7am Sydney (AEDT +11) is 20:00 UTC the day before; it ends at 21:00 UTC.
  const end = Date.parse(`${plus(1)}T21:00:00Z`)
  const n = (await emails()).length
  await tick(end + 35 * 60000)
  const mail = (await emails()).slice(n).filter((e) => e.to.includes('jonerfootballdean@gmail.com') && /Register not done/.test(e.subject))
  assert.equal(mail.length, 1, JSON.stringify((await emails()).slice(n).map((e) => e.subject)))
  // Lee can mark it for the coach on the day (staff), and it lands in Airtable.
  const slots = (await L('extraList', { coachId: 'dean' })).data.slots
  assert.ok(slots.some((x) => x.id === t.data.slot.id))
})

await test('remove a player and cancel: a coach cannot cancel a session with players on it; Lee can', async () => {
  assert.equal((await D('extraCancel', { id: slot.id })).status, 400)
  const v = (await D('extraList')).data.slots.find((x) => x.id === slot.id)
  const rm = await D('extraRemove', { slotId: slot.id, bookingId: v.bookings[1].id })
  assert.equal(rm.status, 200); assert.equal(rm.data.charged, false, 'an unpaid charge comes off')
  assert.equal((await D('extraList')).data.slots.find((x) => x.id === slot.id).placesLeft, 1)
  assert.equal((await L('extraCancel', { id: slot.id })).status, 200)
  assert.ok(!(await D('extraList')).data.slots.some((x) => x.id === slot.id))
})

await test('a session today can be marked, and the mark goes to Airtable Attendance', async () => {
  const r = await D('extraSave', { slot: { date: today, time: '11:59pm', capacity: 1, location: 'Belrose HQ', priceId } })
  assert.equal(r.status, 200, JSON.stringify(r.data))
  const a = await D('extraAttach', { slotId: r.data.slot.id, name: 'Mark Me', email: 'mark@example.com' })
  const m = await D('extraMark', { slotId: r.data.slot.id, bookingId: a.data.booking.id, status: 'Present' })
  assert.equal(m.status, 200, JSON.stringify(m.data))
  assert.ok((await at()).attendance.some((x) => x.fields['Programme'] === 'JFP Extra session' && x.fields['Player Name'] === 'Mark Me'))
})

console.log(`\n${failed ? `${failed} FAILED, ` : ''}${passed} extra session checks passed`)
process.exit(failed ? 1 : 0)
