// Whole-session extra sessions (Lee, 27 Oct 2026), end to end against the
// local harness: one family books the whole session, first come first served,
// as 1 on 1 or a group with a fewest and most players.
//   npm run build && HOLIDAY_LOCAL_PORT=4792 node scripts/holiday-local.mjs   (one terminal)
//   node scripts/test-jfp-extra-whole.mjs 4792                               (another)
// Every name, email and amount here is invented.
import assert from 'node:assert/strict'

const PORT = Number(process.argv[2] || 4321)
const B = `http://localhost:${PORT}`
let passed = 0
async function test(name, fn) { await fn(); passed += 1; console.log(`ok - ${name}`) }
function client() {
  const jar = new Map()
  const call = async (path, body) => {
    const res = await fetch(`${B}${path}`, { method: body ? 'POST' : 'GET', redirect: 'manual', headers: { 'content-type': 'application/json', origin: B, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') }, body: body ? JSON.stringify(body) : undefined })
    for (const c of res.headers.getSetCookie?.() || []) { const [kv] = c.split(';'); const i = kv.indexOf('='); if (kv.slice(i + 1)) jar.set(kv.slice(0, i), kv.slice(i + 1)); else jar.delete(kv.slice(0, i)) }
    return { status: res.status, data: await res.json().catch(() => ({})) }
  }
  return { call }
}
const getJson = async (p) => (await fetch(`${B}${p}`)).json()
const emails = () => getJson('/__emails')
const sessions = () => getJson('/__sessions')
const kv = async (cmd) => (await fetch(`${B}/__kv?cmd=${encodeURIComponent(JSON.stringify(cmd))}`)).text()
async function signIn(c, email, audience) {
  const s = await c.call('/api/jfp-auth', { action: 'start', email, audience })
  assert.equal(s.status, 200, JSON.stringify(s.data))
  const code = (await emails()).filter((e) => e.to.includes(email) && /sign-in code/.test(e.subject)).at(-1).subject.match(/(\d{6})/)[1]
  assert.equal((await c.call('/api/jfp-auth', { action: 'verify', challenge: s.data.challenge, code })).status, 200)
}
const lee = client(), dean = client()
await signIn(lee, 'leejones@jonerfootball.com', 'staff')
await signIn(dean, 'jonerfootballdean@gmail.com', 'staff')
const L = (action, body = {}) => lee.call('/api/jfp-portal-data', { action, ...body })
const D = (action, body = {}) => dean.call('/api/jfp-portal-data', { action, ...body })
const ok = async (r) => { const x = await r; assert.equal(x.status, 200, JSON.stringify(x.data)); return x.data }
const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date(Date.now() + 3 * 86400000))
const payreq = async (id) => JSON.parse(await kv(['GET', `jfp:payreq:${id}`]))
const staffSlot = async (id) => (await ok(L('extraList', { coachId: '' }))).slots.find((x) => x.id === id)

const players = (await ok(L('playersList'))).players
const solo = (p) => p.email && p.holdsPlace && p.waiver?.onFile && players.filter((x) => x.email === p.email).length === 1
const famRow = players.find(solo)
const famRow2 = players.find((p) => p.email && p.holdsPlace && !p.waiver?.onFile && p.email !== famRow?.email && players.filter((x) => x.email === p.email).length === 1)
assert.ok(famRow && famRow2, 'the harness has two families')
const fam = client(), fam2 = client()
await signIn(fam, famRow.email, 'parent')
await signIn(fam2, famRow2.email, 'parent')
const account = async (c) => (await c.call('/api/jfp-account', { action: 'overview' })).data
{
  const kid = (await account(fam2)).players[0]
  await ok(fam2.call('/api/jfp-account', { action: 'signWaiver', players: [{ key: kid.key, dob: '2013-05-05', emergencyName: 'Gran Sample', emergencyPhone: '0400 777 889' }], waiver: { accepted: { terms: true, makeups: true, payment: true, emergency: true }, media: false, kind: 'guardian', signature: 'Pat Sample' }, parentName: 'Pat Sample', mobile: '0400 777 888' }))
}

let tenAm, elevenAm, groupPrice
await test('Lee opens a 10am (1 on 1 A$150 or a group of up to 4) and an 11am (group of 3 or 4 only)', async () => {
  groupPrice = (await ok(L('extraPrices', { add: { label: 'Small group 1 hour', dollars: '60', durationMin: 60 } }))).prices.find((p) => p.label === 'Small group 1 hour')
  tenAm = (await ok(L('extraSave', { slot: { coachId: 'lee', date: day, time: '10:00am', location: 'Belrose HQ', kind: 'oneoff', bookAs: 'whole', options: [{ type: 'one', priceCents: 15000 }, { type: 'group', priceId: groupPrice.id, minPlayers: 2, maxPlayers: 4 }] } }))).slot
  assert.deepEqual(tenAm.options.map((o) => [o.label, o.priceCents]), [['1 on 1', 15000], ['Group of up to 4', 6000]])
  assert.deepEqual([tenAm.whole, tenAm.capacity, tenAm.placesLeft, tenAm.optionsLabel], [true, 4, 4, '1 on 1 or a group of up to 4'])
  elevenAm = (await ok(L('extraSave', { slot: { coachId: 'lee', date: day, time: '11:00am', location: 'Belrose HQ', kind: 'oneoff', bookAs: 'whole', options: [{ type: 'group', priceId: groupPrice.id, minPlayers: 3, maxPlayers: 4 }] } }))).slot
  assert.equal(elevenAm.options[0].label, 'Group of 3 to 4')
})

await test('checks: no option ticked, a bad group size, and a coach typing their own amount are refused', async () => {
  const base = { coachId: 'lee', date: day, time: '1:00pm', location: 'Belrose HQ', kind: 'oneoff', bookAs: 'whole' }
  assert.equal((await L('extraSave', { slot: { ...base, options: [] } })).status, 400)
  assert.equal((await L('extraSave', { slot: { ...base, options: [{ type: 'group', priceId: groupPrice.id, minPlayers: 5, maxPlayers: 4 }] } })).status, 400)
  const solo = await L('extraSave', { slot: { ...base, options: [{ type: 'group', priceId: groupPrice.id, minPlayers: 1, maxPlayers: 4 }] } })
  assert.equal(solo.status, 400, 'a group of 1 would be a cheap 1 on 1'); assert.match(solo.data.error, /fewest players is 2/)
  assert.equal((await D('extraSave', { slot: { ...base, coachId: 'dean', options: [{ type: 'one', priceCents: 1000 }] } })).status, 400, 'coaches pick a price Lee set')
})

await test('a coach sees the sizes but never the prices; Add a player is not offered on a whole session', async () => {
  const d = await ok(D('extraSave', { slot: { date: day, time: '2:00pm', location: 'Belrose HQ', kind: 'oneoff', bookAs: 'whole', options: [{ type: 'group', priceId: groupPrice.id, minPlayers: 2, maxPlayers: 3 }] } }))
  assert.deepEqual(d.slot.options.map((o) => [o.label, o.priceCents, o.priceLabel]), [['Group of up to 3', undefined, undefined]])
  const r = await D('extraAttach', { slotId: d.slot.id, name: 'Test Player', email: 'test.player@example.com' })
  assert.equal(r.status, 409)
})

await test('families see the options with prices per player, and the booking page says Free to book', async () => {
  const card = (await account(fam)).extras.bookable.find((x) => x.id === tenAm.id)
  assert.ok(card, 'the 10am is on My account')
  assert.deepEqual([card.whole, card.kind, card.options.map((o) => o.priceLabel)], [true, '1 on 1 or a group of up to 4', ['A$150', 'A$60']])
})

await test('the 11am refuses a group of 2 (needs 3) and a group of 5; the 10am group refuses 1 player', async () => {
  const me = (await account(fam)).players.find((p) => p.name === famRow.name)
  const two = await fam.call('/api/jfp-account', { action: 'bookExtra', slotId: elevenAm.id, optionId: 'group', playerKeys: [me.key], guests: ['Sample Friend'] })
  assert.equal(two.status, 409); assert.match(two.data.error, /at least 3/)
  const five = await fam.call('/api/jfp-account', { action: 'bookExtra', slotId: elevenAm.id, optionId: 'group', playerKeys: [me.key], guests: ['Friend One', 'Friend Two', 'Friend Three', 'Friend Four'] })
  assert.equal(five.status, 409)
  assert.equal((await staffSlot(elevenAm.id)).bookings.length, 0, 'nothing is held')
  const one = await fam.call('/api/jfp-account', { action: 'bookExtra', slotId: tenAm.id, optionId: 'group', playerKeys: [me.key] })
  assert.equal(one.status, 409, 'one player cannot book the 10am group at the group price'); assert.match(one.data.error, /at least 2/)
})

await test('a group of 3 books the 10am: one charge of 3 x A$60 on their player; the session is gone for everyone else', async () => {
  const me = (await account(fam)).players.find((p) => p.name === famRow.name)
  const r = await fam.call('/api/jfp-account', { action: 'bookExtra', slotId: tenAm.id, optionId: 'group', playerKeys: [me.key], guests: ['Friend Alpha', 'Friend Beta'] })
  assert.equal(r.status, 200, JSON.stringify(r.data))
  assert.equal((await sessions()).find((x) => x.url === r.data.url).amount_total, 18000)
  const s = await staffSlot(tenAm.id)
  assert.deepEqual(s.bookings.map((b) => [b.name, Boolean(b.guest)]), [[famRow.name, false], ['Friend Alpha', true], ['Friend Beta', true]])
  const q = await payreq(s.bookings[0].payreqId)
  assert.deepEqual([q.amountCents, q.playerNames], [18000, [famRow.name]])
  assert.equal(s.bookings[1].inGroupOf, famRow.name)
  // A retry: the same group and the same charge.
  const again = await fam.call('/api/jfp-account', { action: 'bookExtra', slotId: tenAm.id, optionId: 'group', playerKeys: [me.key], guests: ['Friend Alpha', 'Friend Beta'] })
  assert.equal(again.status, 200)
  assert.equal((await staffSlot(tenAm.id)).bookings.length, 3)
  assert.ok(!(await account(fam2)).extras.bookable.some((x) => x.id === tenAm.id), 'gone from other families')
  const kid = (await account(fam2)).players[0]
  const late = await fam2.call('/api/jfp-account', { action: 'bookExtra', slotId: tenAm.id, optionId: 'one', playerKeys: [kid.key] })
  assert.deepEqual([late.status, late.data.error], [409, 'Another family has just booked this session. It is no longer free.'])
})

await test('1 on 1 at A$150 on the 11am is not offered (group only); removing the group frees the 10am and drops the charge', async () => {
  const kid = (await account(fam2)).players[0]
  assert.equal((await fam2.call('/api/jfp-account', { action: 'bookExtra', slotId: elevenAm.id, optionId: 'one', playerKeys: [kid.key] })).status, 400)
  const s = await staffSlot(tenAm.id)
  const rm = await ok(L('extraRemove', { slotId: tenAm.id, bookingId: s.bookings[1].id }))
  assert.equal(rm.charged, false)
  const after = await staffSlot(tenAm.id)
  assert.deepEqual([after.bookings.length, after.placesLeft], [0, 4])
  assert.equal((await payreq(s.bookings[0].payreqId)).status, 'cancelled')
  const one = await fam2.call('/api/jfp-account', { action: 'bookExtra', slotId: tenAm.id, optionId: 'one', playerKeys: [kid.key] })
  assert.equal(one.status, 200, JSON.stringify(one.data))
  assert.equal((await sessions()).find((x) => x.url === one.data.url).amount_total, 15000)
})

await test('holiday prices (Lee, 27 Oct): 1 on 1 A$150; a group of 2 pays A$100 each, 3 or more A$90 each; coaches get their own holiday rates', async () => {
  const hc = JSON.parse(await kv(['GET', 'holiday:config']) || 'null') || {}
  await kv(['SET', 'holiday:config', JSON.stringify({ ...hc, prices: { lee: { one: 15000, shared: 10000, group: 9000 }, coach: { one: 12000, shared: 9000, group: 8000 } }, coaches: [...(hc.coaches || []).filter((c) => c.id !== 'lee' && c.id !== 'dean'), { id: 'lee', name: 'Lee', tier: 'lee' }, { id: 'dean', name: 'Dean', tier: 'coach' }] })])
  const s = (await ok(L('extraSave', { slot: { coachId: 'lee', date: day, time: '3:00pm', location: 'Belrose HQ', kind: 'oneoff', bookAs: 'whole', options: [{ type: 'one', priceId: '__holiday' }, { type: 'group', priceId: '__holiday', minPlayers: 2, maxPlayers: 4 }] } }))).slot
  assert.deepEqual(s.options.map((o) => [o.priceCents, o.pairCents || 0, o.priceLabel]), [[15000, 0, 'A$150'], [9000, 10000, 'A$100 each for 2, A$90 each for 3 or more']])
  const kid = (await account(fam2)).players[0]
  const me = (await account(fam)).players.find((p) => p.name === famRow.name)
  const two = await fam.call('/api/jfp-account', { action: 'bookExtra', slotId: s.id, optionId: 'group', playerKeys: [me.key], guests: ['Pair Friend'] })
  assert.equal(two.status, 200, JSON.stringify(two.data))
  assert.equal((await sessions()).find((x) => x.url === two.data.url).amount_total, 20000, '2 x A$100')
  const s3 = (await ok(L('extraSave', { slot: { coachId: 'lee', date: day, time: '5:00pm', location: 'Belrose HQ', kind: 'oneoff', bookAs: 'whole', options: [{ type: 'group', priceId: '__holiday', minPlayers: 2, maxPlayers: 4 }] } }))).slot
  const three = await fam2.call('/api/jfp-account', { action: 'bookExtra', slotId: s3.id, optionId: 'group', playerKeys: [kid.key], guests: ['Three One', 'Three Two'] })
  assert.equal(three.status, 200, JSON.stringify(three.data))
  assert.equal((await sessions()).find((x) => x.url === three.data.url).amount_total, 27000, '3 x A$90')
  const d = (await ok(D('extraSave', { slot: { date: day, time: '6:00pm', location: 'Belrose HQ', kind: 'oneoff', bookAs: 'whole', options: [{ type: 'one', priceId: '__holiday' }] } }))).slot
  assert.equal(d.options[0].priceCents, undefined, 'the coach still never sees it')
  assert.equal((await staffSlot(d.id)).options[0].priceCents, 12000, "Dean's holiday 1 on 1")
})

console.log(`\n${passed} whole-session extra checks passed`)
