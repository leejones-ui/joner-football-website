// Holiday training between holidays, end to end against the local harness
// (Lee, 13 Oct 2026): Past holidays as a record, and Set up next holidays.
//   npm run build && HOLIDAY_LOCAL_PORT=4511 node scripts/holiday-local.mjs   (one terminal)
//   node scripts/test-holiday-plan-flow.mjs 4511                             (another)
// Every name and email here is invented.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { HOLIDAY_PERIODS } from '../api/_holiday-periods.js'
import { upcomingPeriods } from '../api/_holiday-plan.js'
import { sydneyToday } from '../api/_jfp-store.js'

const PORT = Number(process.argv[2] || 4321)
const B = `http://localhost:${PORT}`
let passed = 0
async function test(name, fn) { await fn(); passed += 1; console.log(`ok - ${name}`) }

function client() {
  const jar = new Map()
  const call = async (path, body, headers = {}) => {
    const res = await fetch(`${B}${path}`, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', origin: B, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '), ...headers }, body: body ? JSON.stringify(body) : undefined })
    for (const c of res.headers.getSetCookie?.() || []) { const [kv] = c.split(';'); const i = kv.indexOf('='); if (kv.slice(i + 1)) jar.set(kv.slice(0, i), kv.slice(i + 1)); else jar.delete(kv.slice(0, i)) }
    return { status: res.status, data: await res.json().catch(() => ({})) }
  }
  return { call, jar }
}
const emails = async () => (await fetch(`${B}/__emails`)).json()
const kv = async (cmd) => (await fetch(`${B}/__kv?cmd=${encodeURIComponent(JSON.stringify(cmd))}`)).text()
async function signIn(c, email) {
  const s = await c.call('/api/jfp-auth', { action: 'start', email, audience: 'staff' })
  assert.equal(s.status, 200, JSON.stringify(s.data))
  const code = (await emails()).filter((e) => e.to.includes(email) && /sign-in code/.test(e.subject)).at(-1).subject.match(/(\d{6})/)[1]
  assert.equal((await c.call('/api/jfp-auth', { action: 'verify', challenge: s.data.challenge, code })).status, 200)
}
const secret = (action, extra = {}) => client().call('/api/holiday-admin', { action, ...extra }, { 'x-holiday-admin-secret': 'admin' })

const today = sydneyToday()
const target = upcomingPeriods(today)[0]
const second = upcomingPeriods(today)[1]
// The last holiday that is over: its sessions are the pattern.
const src = [...HOLIDAY_PERIODS].filter((p) => p.to < today && p.from < target.from).sort((a, b) => b.from.localeCompare(a.from))[0]
const dayOf = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay()
const firstOn = (p, wd) => { for (let d = p.start; d <= p.end; d = new Date(Date.parse(`${d}T00:00:00Z`) + 86400000).toISOString().slice(0, 10)) if (dayOf(d) === wd) return d; return '' }
const MON = firstOn(src, 1), TUE = firstOn(src, 2)

const lee = client()
await signIn(lee, 'leejones@jonerfootball.com')
const hol = (action, extra = {}) => lee.call('/api/holiday-admin', { action, ...extra })

await test('setup: an earlier holiday with sessions that ran, one paid booking', async () => {
  assert.equal((await secret('saveConfig', { config: { coaches: [{ id: 'cara', name: 'Cara', tier: 'coach', active: true }, { id: 'olly', name: 'Olly', tier: 'coach', active: false }], prices: { coach: { one: 12000, shared: 9000, group: 8000 } } } })).data.success, true)
  for (const [date, startTime, x] of [[MON, '09:00', {}], [TUE, '10:00', { priceCents: 13000 }], [TUE, '15:00', {}]]) {
    const r = await secret('upsertSlot', { slot: { coachId: 'cara', date, startTime, durationMin: 60, type: 'open', capacity: 6, ...x } })
    assert.equal(r.data.success, true, JSON.stringify(r.data))
  }
  const slots = (await hol('listSlots')).data
  assert.equal(slots.today, today, 'the server says what today is in Sydney')
  const gone = slots.slots.find((s) => s.date === TUE && s.startTime === '15:00')
  assert.equal((await secret('cancelSlot', { slotId: gone.id })).data.success, true)
  // A paid booking on the Monday hour, as the booking system keeps it.
  const mon = slots.slots.find((s) => s.date === MON)
  const b = { id: 'HOL-PLANTEST-1', slotId: mon.id, status: 'paid', type: 'one', seats: 1, players: [{ name: 'Kid Test', age: 9 }], parentName: 'Pat Test', email: 'pat.test@example.com', mobile: '0400000000', priceCents: 12000, amountPaidCents: 12000, createdAt: `${MON}T00:00:00.000Z`, paidAt: `${MON}T00:00:00.000Z` }
  await kv(['SET', `holiday:booking:${b.id}`, JSON.stringify(b)])
  await kv(['ZADD', 'holiday:bookings', String(Date.parse(b.createdAt)), b.id])
  await kv(['ZADD', `holiday:seats:${mon.id}`, '9007199254740000', b.id])
})

await test('Past holidays: the finished holiday as a record, with its money link', async () => {
  const r = await hol('holidayRecord')
  assert.equal(r.status, 200, JSON.stringify(r.data))
  const p = r.data.periods.find((x) => x.id === src.id)
  assert.ok(p, `${src.label} is in the record`)
  assert.equal(r.data.periods[0].id, src.id, 'newest first')
  assert.deepEqual([p.offered, p.run, p.bookings, p.players, p.notBooked], [2, 1, 1, 1, 1])
  assert.deepEqual(p.coaches, [{ name: 'Cara', sessions: 1 }])
  assert.equal(p.moneyHref, `/jfp-portal/#money?programme=holiday&period=${src.id}`)
  const bk = (await hol('listBookings')).data
  assert.equal(bk.today, today)
  assert.equal(bk.bookings.find((x) => x.id === 'HOL-PLANTEST-1').slotDate, MON, 'the page can keep it out of Coming up')
})

let plan
await test('Set up next holidays: the preview copies the last holiday onto the next one', async () => {
  const r = await hol('planHolidays')
  assert.equal(r.status, 200, JSON.stringify(r.data))
  plan = r.data.plan
  assert.deepEqual([plan.mode, plan.target.id, plan.source.id, plan.source.pattern], ['copy', target.id, src.id, 2], 'the cancelled hour is not copied')
  assert.ok(plan.counts.new > 0)
  const firstTue = plan.days.find((d) => d.weekday === 2 && d.items.length)
  assert.deepEqual(firstTue.items.map((x) => [x.startLabel, x.coachName, x.priceLabel]), [['10am', 'Cara', 'A$130']])
  assert.ok(plan.days.every((d) => d.items.every((x) => [1, 2].includes(d.weekday))), 'only the pattern\'s weekdays')
  const blank = (await hol('planHolidays', { mode: 'blank' })).data.plan
  assert.deepEqual([blank.mode, blank.counts.new], ['blank', 0])
  assert.equal((await hol('planHolidays', { period: src.id })).status, 400, 'a finished holiday cannot be set up')
})

await test('create on confirm: only the days left ticked, nothing emailed, then parents can book', async () => {
  const mailBefore = (await emails()).length
  const ticked = plan.days.filter((d) => d.items.some((x) => x.status === 'new')).map((d) => d.date)
  const leaveOut = ticked.at(-1)
  const expect = plan.days.filter((d) => ticked.includes(d.date) && d.date !== leaveOut).reduce((t, d) => t + d.items.filter((x) => x.status === 'new').length, 0)
  // Slots another flow test made in the same harness are not this test's.
  const already = new Set((await hol('listSlots')).data.slots.map((s) => s.id))
  const r = await hol('createHolidays', { period: target.id, source: src.id, dates: ticked.filter((d) => d !== leaveOut) })
  assert.equal(r.status, 200, JSON.stringify(r.data))
  assert.equal(r.data.created, expect)
  assert.equal((await emails()).length, mailBefore, 'nothing is emailed')
  const made = (await hol('listSlots')).data.slots.filter((s) => s.date >= target.start && s.date <= target.end && !already.has(s.id))
  assert.equal(made.length, expect)
  assert.ok(!made.some((s) => s.date === leaveOut), 'the unticked day has no slots')
  assert.ok(made.every((s) => s.status === 'open' && s.coachId === 'cara'))
  assert.equal(made.find((s) => s.startTime === '10:00').priceOverrideCents, 13000, 'own price kept')
  // Parents see them on the booking page (they open as soon as the slots exist).
  const access = await fetch(`${B}/api/holiday-access`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'holiday' }) })
  const cookie = access.headers.get('set-cookie').split(';')[0]
  const pub = await (await fetch(`${B}/api/holiday-slots`, { headers: { cookie } })).json()
  assert.equal(pub.slots.filter((s) => s.date >= target.start && s.date <= target.end && !already.has(s.id)).length, expect)
  // Again: what is there is not made twice.
  const again = await hol('createHolidays', { period: target.id, source: src.id, dates: ticked.filter((d) => d !== leaveOut) })
  assert.equal(again.status, 400, JSON.stringify(again.data))
  const plan2 = (await hol('planHolidays', { period: target.id })).data.plan
  assert.equal(plan2.counts.exists, (plan.counts.exists || 0) + expect)
  assert.equal(plan2.counts.new, plan.counts.new - expect, 'only the day left out is still new')
})

await test('two taps at once never make an hour twice', async () => {
  const p = (await hol('planHolidays', { period: second.id, source: src.id })).data.plan
  const dates = p.days.filter((d) => d.items.some((x) => x.status === 'new')).map((d) => d.date)
  const [a, b] = await Promise.all([1, 2].map(() => hol('createHolidays', { period: second.id, source: src.id, dates })))
  const made = (await hol('listSlots')).data.slots.filter((s) => s.date >= p.target.start && s.date <= p.target.end && s.status !== 'cancelled')
  assert.equal(made.length, p.counts.new)
  assert.equal(new Set(made.map((s) => `${s.coachId}|${s.startsAt}`)).size, made.length)
  assert.equal([a, b].filter((x) => x.status === 200).reduce((t, x) => t + x.data.created, 0), p.counts.new, `${a.status} ${b.status}`)
})

await test('coaches and other sites are kept out; asks are POST only', async () => {
  const cfg = (await lee.call('/api/jfp-portal-data', { action: 'getSettings' })).data.config
  assert.equal((await lee.call('/api/jfp-portal-data', { action: 'saveSettings', config: { coaches: [...cfg.coaches, { id: 'plancoach', name: 'Planny', fullName: 'Planny Coach', airtableName: 'Planny Coach', email: 'coach.plan@example.com' }] } })).status, 200)
  const coach = client()
  await signIn(coach, 'coach.plan@example.com')
  for (const action of ['holidayRecord', 'planHolidays', 'createHolidays', 'listSlots']) assert.equal((await coach.call('/api/holiday-admin', { action, period: target.id, dates: [target.start] })).status, 403, action)
  const anon = client()
  assert.equal((await anon.call('/api/holiday-admin', { action: 'holidayRecord' })).status, 401)
  const leeCookie = [...lee.jar].map(([k, v]) => `${k}=${v}`).join('; ')
  const evil = await fetch(`${B}/api/holiday-admin`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: leeCookie, origin: 'https://evil.example' }, body: JSON.stringify({ action: 'createHolidays', period: target.id, dates: [target.start] }) })
  assert.equal(evil.status, 401)
  assert.equal((await fetch(`${B}/api/holiday-admin`, { headers: { cookie: leeCookie, origin: B } })).status, 405)
})

await test('the built holiday page carries Coming up, Past holidays and Set up next holidays', async () => {
  const html = fs.readFileSync(new URL('../dist/jfp-portal/holiday/index.html', import.meta.url), 'utf8')
  for (const t of ['Coming up', 'Past holidays', 'Set up next holidays', 'id="record-list"', 'id="plan"']) assert.ok(html.includes(t), t)
  const src2 = [...html.matchAll(/<script type="module" src="\/(_astro\/[^"]+\.js)"/g)].map((m) => fs.readFileSync(new URL(`../dist/${m[1]}`, import.meta.url), 'utf8')).join('\n') + html
  for (const t of ['planHolidays', 'createHolidays', 'holidayRecord', 'No holiday sessions set up yet.', 'Set up the next holidays']) assert.ok(src2.includes(t), `the built page has ${t}`)
})

console.log(`\n${passed} holiday plan flow checks passed`)
