// Term 1 2027 early offer (Lee, 16 Nov 2026), against the local harness
// (scripts/holiday-local.mjs): fake Airtable, fake Stripe, captured email.
//   npm run build && node scripts/holiday-local.mjs   (in one terminal)
//   node scripts/test-jfp-flow.mjs 4321               (in another)
import assert from 'node:assert/strict'

const PORT = Number(process.argv[2] || 4321)
const B = `http://localhost:${PORT}`
const ORIGIN = { origin: B }
let passed = 0
async function test(name, fn) { await fn(); passed += 1; console.log(`ok - ${name}`) }

// A browser per person: its own cookie jar.
let ipSeq = 1
function client() {
  const jar = new Map()
  const ip = `10.0.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}` // each family on its own connection
  const header = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
  async function call(path, body, method = body ? 'POST' : 'GET') {
    // The JF playing kit is confirmed before every term payment; tests that
    // check that gate pass noKit.
    if (path === '/api/jfp-account' && body?.action === 'pay' && !body.noKit) await call(path, { action: 'confirmKit', payreqId: body.payreqId, kit: 'ordered' })
    const res = await fetch(`${B}${path}`, { method, redirect: 'manual', headers: { 'content-type': 'application/json', cookie: header(), 'x-forwarded-for': ip, ...ORIGIN }, body: body ? JSON.stringify(body) : undefined })
    const set = res.headers.getSetCookie?.() || []
    for (const c of set) { const [kv] = c.split(';'); const i = kv.indexOf('='); const k = kv.slice(0, i); const v = kv.slice(i + 1); if (v) jar.set(k, v); else jar.delete(k) }
    const text = await res.text()
    let data = {}
    try { data = JSON.parse(text) } catch {}
    return { status: res.status, data }
  }
  return { call, jar }
}

const emails = async () => (await fetch(`${B}/__emails`)).json()
const at = async () => (await fetch(`${B}/__airtable`)).json()
const stripe = (url, action) => fetch(`${url}&action=${action}`, { redirect: 'manual' })
async function codeFor(email) {
  const list = (await emails()).filter((e) => e.to.includes(email) && /sign-in code/.test(e.subject))
  assert.ok(list.length, `a code email went to ${email}`)
  return list.at(-1).subject.match(/(\d{6})/)[1]
}
async function signIn(c, email, audience = 'parent') {
  const s = await c.call('/api/jfp-auth', { action: 'start', email, audience, mobile: '0412 345 678' })
  assert.equal(s.status, 200, JSON.stringify(s.data))
  const v = await c.call('/api/jfp-auth', { action: 'verify', challenge: s.data.challenge, code: await codeFor(email) })
  assert.equal(v.status, 200, JSON.stringify(v.data))
  return v.data
}
// The password check is rate limited (8 a minute), so do it once and share
// the signed access cookie, as separate browsers of the same family would.
let gateCookie = ''
async function gate(c) {
  if (!gateCookie) { assert.equal((await c.call('/api/jfp-access', { password: 'term4' })).status, 200); gateCookie = c.jar.get('jf_jfp') }
  c.jar.set('jf_jfp', gateCookie)
}
const portal = (c, action, body = {}) => c.call('/api/jfp-portal-data', { action, ...body })
async function groupsPublic(c) { return (await c.call('/api/jfp-groups')).data.groups }

const WAIVER = { accepted: { terms: true, makeups: true, payment: true, emergency: true }, media: false, signature: 'Pat Parent' }

// ---------- Term 1 2027 early offer (Lee, 16 Nov 2026) ----------
const lee = client()
await signIn(lee, 'leejones@jonerfootball.com', 'staff')
const mk = async (group) => { const r = await portal(lee, 'saveGroup', { group }); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data.group.id }
const G1 = await mk({ day: 'Tuesday', time: '4:20pm', location: 'Belrose HQ', coachId: 'sam', capacity: 12, mode: 'direct', label: 'Small group', minAge: 6, maxAge: 18 })
const add = async (name, email) => { const r = await portal(lee, 'addPlayer', { groupId: G1, force: true, player: { name, dob: '2015-04-04' }, parent: { name: `Parent ${name.split(' ')[1]}`, email, mobile: '0400959595' }, payment: 'offline', amountCents: 85000, method: 'Cash' }); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data.rowId }
const a1 = await add('Ann Sibs', 'sibs@example.com')
const a2 = await add('Ben Sibs', 'sibs@example.com')
const b1 = await add('Cal Solo', 'solo@example.com')
const offer = (rowId, tier, offerCents, normalCents, kind) => portal(lee, 'saveNextOffer', { rowId, tier, offerCents, normalCents, kind })

await test('staff set the offer and the prices', async () => {
  const s = await portal(lee, 'saveNextTerm', { nextTerm: { name: 'Term 1 2027', holdCents: 10000, open: true, holdUntil: '2099-01-04', offerUntil: '2099-01-04', fullOnly: true, offerOnly: true } })
  assert.equal(s.status, 200, JSON.stringify(s.data))
  assert.equal(s.data.nextTerm.offerUntil, '2099-01-04')
  assert.equal(s.data.nextTerm.fullOnly, true)
  assert.equal((await offer(a1, 'loyal', 67500, 75000, 'Sibling or 2 a week')).status, 200)
  assert.equal((await offer(a2, 'current', 70000, 75000, 'Sibling or 2 a week')).status, 200)
  assert.equal((await offer(b1, 'current', 90000, 85000, 'One player')).status, 400, 'offer above normal is refused')
  const d = (await portal(lee, 'nextTerm')).data
  assert.equal(d.offerTotals.places, 2)
  assert.equal(d.offerTotals.loyal, 1)
  assert.equal(d.offerTotals.toComeCents, 137500)
  assert.equal(d.offerTotals.live, true)
})

const sibs = client(); await signIn(sibs, 'sibs@example.com')
const solo = client(); await signIn(solo, 'solo@example.com')
const sign = async (c, parentName) => { const acc = (await c.call('/api/jfp-account', { action: 'overview' })).data; const r = await c.call('/api/jfp-account', { action: 'signWaiver', players: acc.players.map((p) => ({ key: p.key, dob: '2015-04-04', emergencyName: 'E M', emergencyPhone: '0400959596' })), waiver: WAIVER, parentName, mobile: '0400959595' }); assert.equal(r.status, 200, JSON.stringify(r.data)) }

await test('a player with no offer price sees nothing (offer only)', async () => {
  const acc = (await solo.call('/api/jfp-account', { action: 'overview' })).data
  assert.equal(acc.nextTerm, null)
  assert.equal((await solo.call('/api/jfp-account', { action: 'nextTermChoice', rowId: b1, choice: 'full' })).status, 404)
})

await test('siblings see each early price and one family total; no deposit', async () => {
  const acc = (await sibs.call('/api/jfp-account', { action: 'overview' })).data
  const byRow = Object.fromEntries(acc.nextTerm.players.map((x) => [x.rowId, x]))
  assert.equal(byRow[a1].fullLabel, 'A$675'); assert.equal(byRow[a1].normalLabel, 'A$750'); assert.equal(byRow[a1].tier, 'loyal'); assert.equal(byRow[a1].offer, true)
  assert.equal(byRow[a2].fullLabel, 'A$700'); assert.equal(byRow[a2].tier, 'current')
  assert.equal(acc.nextTerm.family.label, 'A$1,375'); assert.equal(acc.nextTerm.family.normalLabel, 'A$1,500')
  assert.equal(acc.nextTerm.fullOnly, true)
  assert.match(acc.nextTerm.offerUntilLabel, /4 Jan/)
  assert.equal((await sibs.call('/api/jfp-account', { action: 'nextTermChoice', rowId: a1, choice: 'hold' })).status, 409, 'no deposit in the offer')
})

await test('the family pays both at once; both places are recorded paid with their own share', async () => {
  await sign(sibs, 'Parent Sibs')
  const c = await sibs.call('/api/jfp-account', { action: 'nextTermChoice', choice: 'family' })
  assert.equal(c.status, 200, JSON.stringify(c.data))
  const again = await sibs.call('/api/jfp-account', { action: 'nextTermChoice', choice: 'family' })
  assert.equal(again.data.payreqId, c.data.payreqId, 'pressing twice reuses the link')
  const pay = await sibs.call('/api/jfp-account', { action: 'pay', payreqId: c.data.payreqId })
  assert.equal(pay.status, 200, JSON.stringify(pay.data))
  await stripe(pay.data.url, 'pay')
  const holds = (await at()).nextHolds
  const h1 = holds.find((r) => r.fields['Source Term 4 Record ID'] === a1), h2 = holds.find((r) => r.fields['Source Term 4 Record ID'] === a2)
  assert.equal(h1.fields['Status'], 'Paid in full'); assert.equal(h1.fields['Amount Paid'], 675)
  assert.equal(h2.fields['Status'], 'Paid in full'); assert.equal(h2.fields['Amount Paid'], 700)
  assert.ok((await at()).ledger.some((r) => r.fields['Term'] === 'Term 1 2027' && r.fields['Amount Paid'] === 1375), 'one ledger line for the family payment')
  assert.equal((await at()).term4.find((r) => r.id === a1).fields['Term 4 Amount Paid'], 850, 'Term 4 rows untouched')
  const acc = (await sibs.call('/api/jfp-account', { action: 'overview' })).data
  assert.ok(acc.nextTerm.players.every((x) => x.status === 'paid'))
  assert.equal(acc.nextTerm.family, null)
  const d = (await portal(lee, 'nextTerm')).data
  assert.equal(d.offerTotals.paid, 2); assert.equal(d.offerTotals.paidCents, 137500); assert.equal(d.offerTotals.toComeCents, 0)
  assert.ok((await emails()).some((e) => e.to.includes('sibs@example.com') && /Term 1 2027 paid/.test(e.subject)), 'the receipt')
})

await test('one player pays the early price by card only; after the date the normal price applies and the old link is not reused', async () => {
  assert.equal((await offer(b1, 'current', 80000, 85000, 'One player')).status, 200)
  await sign(solo, 'Parent Solo')
  const c = await solo.call('/api/jfp-account', { action: 'nextTermChoice', rowId: b1, choice: 'full' })
  assert.equal(c.status, 200, JSON.stringify(c.data))
  let acc = (await solo.call('/api/jfp-account', { action: 'overview' })).data
  assert.match(acc.todo.find((t) => t.id === c.data.payreqId).amountLabel, /A\$800/)
  assert.equal((await portal(lee, 'saveNextTerm', { nextTerm: { offerUntil: '2020-01-04' } })).status, 200)
  acc = (await solo.call('/api/jfp-account', { action: 'overview' })).data
  assert.equal(acc.nextTerm.players[0].fullLabel, 'A$850'); assert.equal(acc.nextTerm.players[0].offer, false)
  const c2 = await solo.call('/api/jfp-account', { action: 'nextTermChoice', rowId: b1, choice: 'full' })
  assert.notEqual(c2.data.payreqId, c.data.payreqId, 'a new link at the new price')
  acc = (await solo.call('/api/jfp-account', { action: 'overview' })).data
  assert.match(acc.todo.find((t) => t.id === c2.data.payreqId).amountLabel, /A\$850/)
  assert.ok(!acc.todo.some((t) => t.id === c.data.payreqId), 'the early link is closed')
  const d = (await portal(lee, 'nextTerm')).data
  assert.equal(d.offerTotals.live, false)
})

await test('staff cannot remove a paid offer; audit has the changes', async () => {
  assert.equal((await portal(lee, 'saveNextOffer', { rowId: a1, remove: true })).status, 409)
  assert.equal((await portal(lee, 'saveNextOffer', { rowId: b1, remove: true })).status, 200)
  const audit = (await portal(lee, 'audit')).data.entries
  assert.ok(audit.some((e) => e.action === 'next.offer.add' && e.target === a1))
  assert.ok(audit.some((e) => e.action === 'next.choose.family'))
})

console.log(`\n${passed} passed`)
