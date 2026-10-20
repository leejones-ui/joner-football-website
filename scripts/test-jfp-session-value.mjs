// Session value (Lee, 20 Oct 2026): how full each group is and the money per
// coach hour. The sums first (pure), then end to end on the harness: Lee gets
// the page, a coach gets 403. Every name and amount here is invented.
//   npx astro build && node scripts/holiday-local.mjs 4811, then
//   node scripts/test-jfp-session-value.mjs 4811
import assert from 'node:assert/strict'
import { fillPct, fillTone, perHour, overlaps, splitRows, sessionCost, sessionValueView } from '../api/_jfp-session-value.js'
import { DEFAULT_CONFIG } from '../api/_jfp-store.js'

let passed = 0
async function test(name, fn) { await fn(); passed += 1; console.log(`ok - ${name}`) }

// ---------- the sums ----------
await test('fill %: places held over capacity, capped at 100, none when no places are set', () => {
  assert.equal(fillPct(4, 5), 80)
  assert.equal(fillPct(1, 3), 33)
  assert.equal(fillPct(7, 6), 100)
  assert.equal(fillPct(0, 6), 0)
  assert.equal(fillPct(2, 0), null)
})
await test('badge: green 80% and up, orange 40 to 79%, red under 40%', () => {
  assert.equal(fillTone(80), 'green'); assert.equal(fillTone(100), 'green')
  assert.equal(fillTone(79), 'orange'); assert.equal(fillTone(40), 'orange')
  assert.equal(fillTone(39), 'red'); assert.equal(fillTone(0), 'red')
  assert.equal(fillTone(null), 'grey')
})
await test('per hour: cents over hours, none with no hours or no amount', () => {
  assert.equal(perHour(340000, 10), 34000)
  assert.equal(perHour(100000, 7.5), 13333)
  assert.equal(perHour(5000, 0), null)
  assert.equal(perHour(null, 10), null)
})
await test('overlaps: same day and venue with crossing times; back to back, other days and other venues do not', () => {
  const m = overlaps([
    { id: 'a', day: 'Tuesday', time: '7:30pm', durationMin: 60, venueId: 'belrose' },
    { id: 'b', day: 'Tuesday', time: '7:45pm', durationMin: 60, venueId: 'belrose' },
    { id: 'c', day: 'Tuesday', time: '8:30pm', durationMin: 60, venueId: 'belrose' },
    { id: 'd', day: 'Tuesday', time: '7:30pm', durationMin: 60, venueId: 'ntra' },
    { id: 'e', day: 'Wednesday', time: '7:30pm', durationMin: 60, venueId: 'belrose' },
  ])
  assert.deepEqual(m.get('a'), ['b'])
  assert.deepEqual(m.get('b').sort(), ['a', 'c'], '7:45 to 8:45 crosses 8:30')
  assert.deepEqual(m.get('c'), ['b'], '7:30 to 8:30 ends as 8:30 starts')
  assert.deepEqual(m.get('d'), [])
  assert.deepEqual(m.get('e'), [])
})
await test('the rows: own fee only, no fee counts as no price, session by session and trials apart', () => {
  const s = splitRows([
    { feeAud: 850, paidAud: 850, paymentType: 'JFP 10 weeks' },
    { feeAud: 650, paidAud: 0, paymentType: 'JFP 10 weeks' },
    { feeAud: 0, paidAud: 0, paymentType: 'JFP 10 weeks' },
    { feeAud: 100, paidAud: 50, paymentType: 'JFP Session by session' },
    { feeAud: 120, paidAud: 0, paymentType: 'JFP Pro sessions' },
    { feeAud: 85, paidAud: 85, paymentType: 'JFP Trial' },
  ])
  assert.equal(s.feeCents, 150000)
  assert.equal(s.paidCents, 85000)
  assert.equal(s.noPrice, 1)
  assert.equal(s.session.length, 2)
  assert.equal(s.trial.length, 1)
})
const card = { bands: [4000, 5000, 6000, 7000, 7500, 8500, 9000], weekendExtra: 1000 }
await test('coach cost: the rate card band for the players holding a place; weekend extra; a helper with no card makes it unknown', () => {
  const g = { id: 'G', label: 'Small group', durationMin: 60 }
  assert.equal(sessionCost({ group: g, coachIds: ['dean'], cards: { dean: card }, players: 4, date: '2026-10-13' }).perSessionCents, 7000)
  assert.equal(sessionCost({ group: g, coachIds: ['dean'], cards: { dean: card }, players: 9, date: '2026-10-13' }).perSessionCents, 9000)
  assert.equal(sessionCost({ group: { ...g, durationMin: 90 }, coachIds: ['dean'], cards: { dean: card }, players: 1, date: '2026-10-17' }).perSessionCents, 7500, 'Saturday, 90 min: (40 + 10) x 1.5')
  const two = sessionCost({ group: g, coachIds: ['dean', 'sam'], cards: { dean: card }, players: 4, date: '2026-10-13' })
  assert.equal(two.known, false); assert.deepEqual(two.missing, ['sam'])
  const none = sessionCost({ group: g, coachIds: ['dean'], cards: { dean: card }, players: 0, date: '2026-10-13' })
  assert.equal(none.known, false); assert.match(none.reason, /Nobody holding a place/)
})
await test('the whole view: coach hours, helpers counted, fees and margin an hour, Juniors and test rows left out', () => {
  const config = { ...DEFAULT_CONFIG, skipDates: [] }
  const groups = [
    { id: 'mon', day: 'Monday', time: '5:25pm', location: 'Belrose HQ', coachId: 'dean', extraCoachIds: [], capacity: 5, durationMin: 60, label: 'Small group', mode: 'direct' },
    { id: 'wed', day: 'Wednesday', time: '4:20pm', location: 'Belrose HQ', coachId: 'dean', extraCoachIds: ['sam'], capacity: 4, durationMin: 60, label: 'Small group', mode: 'direct' },
    { id: 'jj', day: 'Saturday', time: '9am', location: 'Belrose HQ', coachId: 'sam', extraCoachIds: [], capacity: 20, durationMin: 60, label: 'Joners Juniors', mode: 'closed' },
  ]
  const row = (groupId, feeAud, paidAud, extra = {}) => ({ groupId, holdsPlace: true, player: 'Kid', feeAud, paidAud, paymentType: 'JFP 10 weeks', notes: '', ...extra })
  const roster = { players: [row('mon', 850, 850), row('mon', 850, 400), row('mon', 850, 850), row('mon', 850, 850), row('mon', 850, 0, { player: 'Test Kid' }), row('wed', 850, 850), row('wed', 0, 0), row('jj', 0, 0), row('mon', 850, 850, { holdsPlace: false })] }
  const offs = new Map([['wed|2026-10-21', { reason: 'Rain' }]])
  const v = sessionValueView({ config, groups, roster, cards: { dean: card, sam: card }, offs })
  assert.equal(v.groups.length, 2, 'Joners Juniors left out')
  const mon = v.groups.find((g) => g.id === 'mon'), wed = v.groups.find((g) => g.id === 'wed')
  assert.equal(mon.holding, 4); assert.equal(mon.fillPct, 80); assert.equal(mon.fillTone, 'green')
  assert.equal(mon.feeCents, 340000); assert.equal(mon.paidCents, 295000)
  assert.equal(mon.sessions, 10); assert.equal(mon.coachHours, 10)
  assert.equal(mon.feesPerHourCents, 34000)
  assert.equal(mon.cost.perHourCents, 7000); assert.equal(mon.marginPerHourCents, 27000)
  assert.equal(wed.sessions, 9, 'a cancelled session is not coached'); assert.equal(wed.cancelled, 1)
  assert.equal(wed.coaches, 2); assert.equal(wed.coachHours, 18, 'helper hours counted')
  assert.equal(wed.noPrice, 1); assert.equal(wed.feeCents, 85000)
  assert.equal(wed.cost.perSessionCents, 10000, 'two coaches at the 2 player band')
  assert.equal(wed.feesPerHourCents, Math.round(85000 / 18))
  assert.equal(v.totals.holding, 6); assert.equal(v.totals.capacity, 9); assert.equal(v.totals.costed, 2)
  assert.equal(v.totals.feeCents, 425000)
  assert.ok(!JSON.stringify(v).includes('Kid'), 'no player names in the page data')
})

// ---------- end to end ----------
const B = `http://localhost:${process.argv[2] || 4811}`
let ipSeq = 10
function client(ip = `10.9.7.${ipSeq++}`) {
  const jar = new Map()
  const call = async (path, body) => {
    const res = await fetch(`${B}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: B, 'x-forwarded-for': ip, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') }, body: JSON.stringify(body) })
    for (const c of res.headers.getSetCookie?.() || []) { const [kv] = c.split(';'); const i = kv.indexOf('='); if (kv.slice(i + 1)) jar.set(kv.slice(0, i), kv.slice(i + 1)); else jar.delete(kv.slice(0, i)) }
    return { status: res.status, data: await res.json().catch(() => ({})) }
  }
  return { call }
}
const emails = async () => (await fetch(`${B}/__emails`)).json()
async function signIn(c, email, audience = 'staff') {
  const s = await c.call('/api/jfp-auth', { action: 'start', email, audience })
  const code = (await emails()).filter((e) => e.to.includes(email) && /sign-in code/.test(e.subject)).at(-1).subject.match(/(\d{6})/)[1]
  return c.call('/api/jfp-auth', { action: 'verify', challenge: s.data.challenge, code })
}
const portal = (c, action, body = {}) => c.call('/api/jfp-portal-data', { action, ...body })
const ok = async (c, action, body) => { const r = await portal(c, action, body); assert.equal(r.status, 200, `${action}: ${JSON.stringify(r.data)}`); return r.data }
const lee = client(), ligia = client(), sam = client()
await signIn(lee, 'leejones@jonerfootball.com')
await signIn(ligia, 'ligia@jonerfootball.com')
await signIn(sam, 'jonerfootballsam@gmail.com')

// The harness has seeded Term 4 rows (4 on Monday 5:25pm Belrose HQ with Dean) but no groups.
const MON = (await ok(lee, 'saveGroup', { group: { day: 'Monday', time: '5:25pm', location: 'Belrose HQ', coachId: 'dean', capacity: 5, mode: 'direct' } })).group.id
const T730 = (await ok(lee, 'saveGroup', { group: { day: 'Tuesday', time: '7:30pm', location: 'Belrose HQ', coachId: 'dean', capacity: 4, mode: 'direct' } })).group.id
const T745 = (await ok(lee, 'saveGroup', { group: { day: 'Tuesday', time: '7:45pm', location: 'Belrose HQ', coachId: 'dean', capacity: 4, mode: 'direct' } })).group.id
const THU = (await ok(lee, 'saveGroup', { group: { day: 'Thursday', time: '6pm', location: 'Belrose HQ', coachId: 'sam', extraCoachIds: ['dean'], capacity: 6, mode: 'direct' } })).group.id
const row = (name, extra) => ({ 'Player Name': name, 'Parent Name': `${name.split(' ')[1]} Parent`, 'Email': `${name.split(' ')[0].toLowerCase()}.sv@example.com`, 'Term 3 Day': 'Thursday', 'Term 3 Time': '6pm', 'Term 3 Location': 'Belrose HQ', 'Coach': 'Sam Yorks', 'Term 4 Confirmation': 'Confirmed', 'Term 4 Payment Type': 'JFP 10 weeks', 'Term 4 Fee': 850, 'Term 4 Amount Paid': 850, 'Term 4 Payment Status': 'Paid', ...extra })
await fetch(`${B}/__airtable-add`, { method: 'POST', body: JSON.stringify({ table: 'term4', rows: [
  row('Arlo Valley'),
  row('Bea Valley', { 'Term 4 Fee': 0, 'Term 4 Amount Paid': 0, 'Term 4 Payment Status': 'Unpaid' }),
  row('Cy Valley', { 'Term 4 Payment Type': 'JFP Session by session', 'Term 4 Fee': 100, 'Term 4 Amount Paid': 50, 'Term 4 Payment Status': 'Partially Paid', 'Term 4 Notes': '[PERSESSION:5000]' }),
] }) })
await ok(lee, 'coachPayCardSave', { coachId: 'dean', card: { bands: [4000, 5000, 6000, 7000, 7500, 8500, 9000], weekendExtra: 1000 } })

await test('Lee gets the page data: fill, fees, coach hours, cost and margin an hour', async () => {
  const d = await ok(lee, 'sessionValue', { fresh: true })
  const mon = d.groups.find((g) => g.id === MON)
  assert.ok(mon, JSON.stringify(d.groups.map((g) => g.id)))
  assert.equal(mon.holding, 4); assert.equal(mon.capacity, 5); assert.equal(mon.fillPct, 80); assert.equal(mon.fillTone, 'green')
  assert.equal(mon.feeCents, 340000); assert.equal(mon.paidCents, 295000)
  assert.equal(mon.sessions, 10); assert.equal(mon.coachHours, 10); assert.equal(mon.feesPerHourCents, 34000)
  assert.equal(mon.cost.known, true); assert.equal(mon.cost.perHourCents, 7000); assert.equal(mon.marginPerHourCents, 27000)
  assert.equal(mon.coach, 'Dean McDonnell')
})
await test('Dean\'s Tuesday 7:30 and 7:45 at Belrose HQ show as overlapping, both empty and red', async () => {
  const d = await ok(lee, 'sessionValue')
  const a = d.groups.find((g) => g.id === T730), b = d.groups.find((g) => g.id === T745)
  assert.deepEqual(a.overlaps.map((o) => o.id), [T745])
  assert.deepEqual(b.overlaps.map((o) => o.id), [T730])
  assert.equal(a.overlaps[0].label, 'Tue 7:45pm, Dean McDonnell')
  assert.equal(a.fillTone, 'red')
  assert.equal(a.cost.known, false); assert.match(a.cost.reason, /Nobody holding a place/)
})
await test('helpers count in coach hours; no price and session by session shown as counts; no rate card for Sam', async () => {
  const d = await ok(lee, 'sessionValue')
  const thu = d.groups.find((g) => g.id === THU)
  assert.equal(thu.holding, 3); assert.equal(thu.fillPct, 50); assert.equal(thu.fillTone, 'orange')
  assert.equal(thu.coaches, 2); assert.deepEqual(thu.helpers, ['Dean McDonnell'])
  assert.equal(thu.coachHours, 20)
  assert.equal(thu.feeCents, 85000, 'only the priced term player')
  assert.equal(thu.noPrice, 1)
  assert.equal(thu.session.count, 1); assert.equal(thu.session.perSessionCents, 5000); assert.equal(thu.session.billedCents, 10000)
  assert.equal(thu.cost.known, false); assert.deepEqual(thu.cost.missing, ['Sam York'])
  assert.equal(thu.marginPerHourCents, null)
  assert.ok(!JSON.stringify(d).includes('Valley'), 'no player names in the page data')
})
await test('totals add up over every group shown', async () => {
  const d = await ok(lee, 'sessionValue')
  const sum = (k) => d.groups.reduce((t, g) => t + g[k], 0)
  assert.equal(d.totals.groups, d.groups.length)
  assert.equal(d.totals.holding, sum('holding')); assert.equal(d.totals.capacity, sum('capacity'))
  assert.equal(d.totals.feeCents, sum('feeCents')); assert.equal(d.totals.paidCents, sum('paidCents'))
  assert.ok(d.totals.costed >= 1)
})
await test('Ligia gets it too; it never writes anything', async () => {
  const before = await (await fetch(`${B}/__airtable`)).json()
  const d = await ok(ligia, 'sessionValue')
  assert.ok(d.groups.length >= 4)
  assert.deepEqual(await (await fetch(`${B}/__airtable`)).json(), before)
})
await test('a coach gets 403', async () => {
  const r = await portal(sam, 'sessionValue')
  assert.equal(r.status, 403, String(r.status))
  assert.ok(!r.data.groups)
})

console.log(`\n${passed} session value checks passed`)
