// JFP round 2 (Lee, 14 Oct 2026), end to end against the local harness:
// fake Airtable, fake Stripe, captured email.
//   1. Add a family: a brother and sister in two groups with their own prices,
//      and a younger brother session by session, ONE email to the parent, ONE
//      payment for the two priced places, each group's coach noted.
//   2. The family signs in: every child, a waiver for each, one Pay for the
//      combined amount, Fees by child; paid lands on each child's own row.
//   3. Session by session: sessions left, pay for the rest of the term, the
//      dates marked paid on My sessions.
//   4. A quote run is never longer than the sessions left.
//   5. No coach name in anything the family sees or is sent.
//   6. Players tab: a family with no group yet.
//   npm run build && HOLIDAY_LOCAL_PORT=4671 node scripts/holiday-local.mjs   (one terminal)
//   node scripts/test-jfp-round2-flow.mjs 4671                               (another)
// Every name, email and amount here is invented.
import assert from 'node:assert/strict'

const PORT = Number(process.argv[2] || 4321)
const B = `http://localhost:${PORT}`
let passed = 0
async function test(name, fn) { await fn(); passed += 1; console.log(`ok - ${name}`) }

let ipSeq = 80
function client() {
  const jar = new Map()
  const ip = `10.9.2.${ipSeq++}`
  const call = async (path, body) => {
    const res = await fetch(`${B}${path}`, { method: body ? 'POST' : 'GET', redirect: 'manual', headers: { 'content-type': 'application/json', origin: B, 'x-forwarded-for': ip, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') }, body: body ? JSON.stringify(body) : undefined })
    for (const c of res.headers.getSetCookie?.() || []) { const [kv] = c.split(';'); const i = kv.indexOf('='); if (kv.slice(i + 1)) jar.set(kv.slice(0, i), kv.slice(i + 1)); else jar.delete(kv.slice(0, i)) }
    return { status: res.status, data: await res.json().catch(() => ({})) }
  }
  return { call }
}
const emails = async () => (await fetch(`${B}/__emails`)).json()
const at = async () => (await fetch(`${B}/__airtable`)).json()
const kv = async (cmd) => (await fetch(`${B}/__kv?cmd=${encodeURIComponent(JSON.stringify(cmd))}`)).text()
async function signIn(c, email, audience = 'parent') {
  const s = await c.call('/api/jfp-auth', { action: 'start', email, audience })
  assert.equal(s.status, 200, JSON.stringify(s.data))
  const code = (await emails()).filter((e) => e.to.includes(email) && /sign-in code/.test(e.subject)).at(-1).subject.match(/(\d{6})/)[1]
  assert.equal((await c.call('/api/jfp-auth', { action: 'verify', challenge: s.data.challenge, code })).status, 200)
}
async function payAtStripe(c, url) {
  const back = await fetch(`${url}&action=pay`, { redirect: 'manual' })
  const sid = new URL(back.headers.get('location')).searchParams.get('session_id')
  const conf = await c.call(`/api/jfp-confirm?session_id=${sid}`)
  assert.equal(conf.data.status, 'paid', JSON.stringify(conf.data))
  return conf.data
}
const row = async (id) => (await at()).term4.find((r) => r.id === id)?.fields
const payreq = async (id) => JSON.parse(await kv(['GET', `jfp:payreq:${id}`]) || 'null')
const auditOf = async (action) => JSON.parse(await kv(['LRANGE', 'jfp:audit', '0', '400'])).map((x) => JSON.parse(x)).filter((x) => x.action === action)
const tag = (notes, t) => (String(notes).match(new RegExp(`\\[${t}:([^\\]]*)\\]`)) || [])[1]
const COACH_NAMES = /Sam York|Dean McDonnell|Coach Sam|Coach Dean|Sam Yorks/
const GUARDIAN = { accepted: { terms: true, makeups: true, payment: true, emergency: true }, media: false, kind: 'guardian' }

const lee = client()
await signIn(lee, 'leejones@jonerfootball.com', 'staff')
const portal = async (action, body = {}) => lee.call('/api/jfp-portal-data', { action, ...body })
const ok = async (action, body = {}) => { const r = await portal(action, body); assert.equal(r.status, 200, `${action}: ${JSON.stringify(r.data)}`); return r.data }
const G1 = (await ok('saveGroup', { group: { day: 'Tuesday', time: '6:10pm', location: 'Belrose HQ', coachId: 'sam', capacity: 12, mode: 'direct', minAge: 5, maxAge: 18 } })).group
const G2 = (await ok('saveGroup', { group: { day: 'Thursday', time: '6:10pm', location: 'Belrose HQ', coachId: 'dean', capacity: 12, mode: 'direct', minAge: 5, maxAge: 18 } })).group
assert.equal((await ok('setCoachAlerts', { newPlayer: true })).newPlayer, true)
const pr = await ok('pricing')
const PARENT = { name: 'Robin Family', email: 'robin.family@example.com', mobile: '0400 999 000' }

let fam = null
const startMail = (await emails()).length
await test('Add a family: three children, own groups and prices, one email, one payment for the two priced places', async () => {
  fam = await ok('addFamily', { parent: PARENT, sendEmail: true, children: [
    { groupId: G1.id, player: { name: 'Ari Family', dob: '2014-03-03' }, payment: 'link', product: 'group' },
    { groupId: G2.id, player: { name: 'Bea Family', dob: '2016-06-06' }, payment: 'link', product: 'sibling' },
    { groupId: G1.id, player: { name: 'Cal Family', dob: '2018-09-09' }, payment: 'sessions', perSessionCents: 8000 },
  ] })
  assert.equal(fam.rows.length, 3)
  const [ari, bea, cal] = await Promise.all(fam.rows.map((x) => row(x.rowId)))
  assert.deepEqual([ari['Term 3 Day'], bea['Term 3 Day'], cal['Term 3 Day']], ['Tuesday', 'Thursday', 'Tuesday'], 'each in their own group')
  assert.deepEqual([ari['Term 4 Confirmation'], bea['Term 4 Confirmation'], cal['Term 4 Confirmation']], ['Awaiting Reply', 'Awaiting Reply', 'Confirmed'])
  assert.deepEqual([ari.Email, bea.Email, cal.Email], [PARENT.email, PARENT.email, PARENT.email], 'one family email on every row')
  assert.ok(ari['Term 4 Fee'] > bea['Term 4 Fee'] && bea['Term 4 Fee'] > 0, `own prices: ${ari['Term 4 Fee']} and ${bea['Term 4 Fee']} (sibling rate)`)
  assert.equal(cal['Term 4 Fee'], 0); assert.equal(tag(cal['Term 4 Notes'], 'PERSESSION'), '8000'); assert.match(cal['Term 4 Payment Type'], /Session by session/)
  const q = await payreq(fam.payreq.id)
  assert.equal(q.reason, 'family'); assert.deepEqual(q.term4Ids, [fam.rows[0].rowId, fam.rows[1].rowId])
  assert.equal(q.amountCents, Math.round((ari['Term 4 Fee'] + bea['Term 4 Fee']) * 100), 'one payment: the two places together')
  assert.deepEqual(q.places.map((x) => [x.name, x.owingCents]), [['Ari Family', ari['Term 4 Fee'] * 100], ['Bea Family', bea['Term 4 Fee'] * 100]], 'each child\'s own amount on the invoice')
  const mine = (await emails()).slice(startMail).filter((e) => e.to.includes(PARENT.email))
  assert.equal(mine.length, 1, `one email to the parent, not three: ${mine.map((e) => e.subject).join(' | ')}`)
  assert.equal(mine[0].subject, 'Ari, Bea and Cal: your Term 4 2026 places')
  assert.match(mine[0].html, /Ari Family.*Bea Family.*Cal Family/s)
  assert.match(mine[0].html, /Sign the waiver for each child: Ari, Bea and Cal/)
  assert.match(mine[0].html, /in one payment for Ari and Bea/)
  assert.match(mine[0].html, /Session by session: pay ahead for Cal/)
  assert.doesNotMatch(mine[0].html, COACH_NAMES, 'no coach name in the family email')
  // Each group's coach is told about their new players, as with any add.
  const sam = JSON.parse(await kv(['HGET', 'jfp:coach-news', 'sam']) || '{"items":[]}').items.map((x) => x.rowId)
  const dean = JSON.parse(await kv(['HGET', 'jfp:coach-news', 'dean']) || '{"items":[]}').items.map((x) => x.rowId)
  assert.ok(sam.includes(fam.rows[0].rowId) && sam.includes(fam.rows[2].rowId), 'Sam: Ari and Cal')
  assert.ok(dean.includes(fam.rows[1].rowId), 'Dean: Bea')
  assert.equal((await auditOf('family.add')).find((x) => x.target === fam.familyId).after.rows.length, 3)
})

await test('Add a family: two paid trials on ONE family payment, a typed price counts', async () => {
  const P2 = { name: 'Tia Trialfam', email: 'tia.trialfam@example.com', mobile: '0400 777 000' }
  const from = pr.dates?.Tuesday?.[1]?.value || ''
  const r = await ok('addFamily', { parent: P2, sendEmail: true, children: [
    { groupId: G1.id, player: { name: 'Ty Trialfam' }, payment: 'link', product: 'trial', amountCents: 8500, ...(from ? { startDate: from } : {}) },
    { groupId: G1.id, player: { name: 'Vi Trialfam' }, payment: 'link', product: 'trial', amountCents: 6000 },
  ] })
  const q = await payreq(r.payreq.id)
  assert.equal(q.amountCents, 14500, 'one payment: both trials, at the typed prices')
  assert.deepEqual(q.places.map((x) => x.owingCents), [8500, 6000])
  assert.ok(q.places.every((x) => /Trial session/.test(x.label)))
  const [a, b] = await Promise.all(r.rows.map((x) => row(x.rowId)))
  assert.equal(a['Term 4 Payment Type'], 'JFP Trial'); assert.equal(b['Term 4 Fee'], 60)
})

await test('the same family again: refused before anything is written, naming the child already there', async () => {
  const n = (await at()).term4.length
  const r = await portal('addFamily', { parent: PARENT, children: [{ groupId: G1.id, player: { name: 'Ari Family' }, payment: 'none' }, { groupId: G2.id, player: { name: 'New Kid Family' }, payment: 'none' }] })
  assert.equal(r.status, 409); assert.equal(r.data.code, 'duplicate'); assert.equal(r.data.child, 0); assert.match(r.data.error, /Ari Family is already in this group/)
  assert.equal((await at()).term4.length, n, 'nothing written')
  const twice = await portal('addFamily', { parent: PARENT, children: [{ player: { name: 'Zed Family' }, payment: 'none' }, { player: { name: 'zed family' }, payment: 'none' }] })
  assert.equal(twice.status, 400); assert.match(twice.data.error, /listed twice/)
  assert.equal((await portal('addFamily', { parent: { name: 'X', email: '' }, children: [{ player: { name: 'Yan Family' } }] })).status, 400, 'a parent email is needed')
})

const parent = client()
await test('the parent signs in: every child, a waiver for each, one Pay for the combined amount, Fees by child', async () => {
  await signIn(parent, PARENT.email)
  let d = (await parent.call('/api/jfp-account', { action: 'overview' })).data
  assert.deepEqual(d.players.map((p) => p.name).sort(), ['Ari Family', 'Bea Family', 'Cal Family'])
  assert.equal(d.todo.length, 1, 'one payment for the family')
  assert.deepEqual(d.todo[0].places.map((x) => x.name), ['Ari Family', 'Bea Family'])
  assert.equal(d.todo[0].needsWaiver, true)
  assert.doesNotMatch(JSON.stringify(d), COACH_NAMES, 'no coach name in My account')
  assert.ok(d.players.every((p) => p.enrolments.every((e) => !('coach' in e))))
  // One waiver sheet, a waiver for each child.
  const list = d.players.map((p, i) => ({ key: p.key, dob: ['2014-03-03', '2016-06-06', '2018-09-09'][i], emergencyName: 'Gran Family', emergencyPhone: '0400 999 001' }))
  const w = await parent.call('/api/jfp-account', { action: 'signWaiver', players: list, waiver: { ...GUARDIAN, signature: 'Robin Family' }, parentName: 'Robin Family', mobile: PARENT.mobile })
  assert.equal(w.status, 200, JSON.stringify(w.data)); assert.equal(w.data.created, 3, 'three waivers')
  d = (await parent.call('/api/jfp-account', { action: 'overview' })).data
  assert.ok(d.players.every((p) => p.waiver.onFile)); assert.equal(d.todo[0].needsWaiver, false)
  const q = await payreq(fam.payreq.id)
  assert.equal((await parent.call('/api/jfp-account', { action: 'confirmKit', payreqId: q.id, kit: 'has' })).status, 200)
  const p = await parent.call('/api/jfp-account', { action: 'pay', payreqId: q.id })
  assert.equal(p.status, 200, JSON.stringify(p.data))
  await payAtStripe(parent, p.data.url)
  const [ari, bea] = [await row(fam.rows[0].rowId), await row(fam.rows[1].rowId)]
  assert.deepEqual([ari['Term 4 Payment Status'], bea['Term 4 Payment Status']], ['Paid', 'Paid'])
  assert.deepEqual([ari['Term 4 Amount Paid'], bea['Term 4 Amount Paid']], [ari['Term 4 Fee'], bea['Term 4 Fee']], 'each child\'s own amount on their own row')
  assert.deepEqual([ari['Term 4 Confirmation'], bea['Term 4 Confirmation']], ['Confirmed', 'Confirmed'])
  const f = (await parent.call('/api/jfp-account', { action: 'fees' })).data.fees
  assert.equal(f.records.length, 1); assert.deepEqual(f.records[0].players, ['Ari Family', 'Bea Family'])
  assert.deepEqual(f.places.filter((x) => x.kind === 'term').map((x) => [x.player, x.paidLabel]).sort(), [['Ari Family', `A$${ari['Term 4 Fee']}`], ['Bea Family', `A$${bea['Term 4 Fee']}`]].sort())
  const receipt = (await emails()).filter((e) => e.to.includes(PARENT.email) && /Payment received/.test(e.subject)).at(-1)
  assert.ok(receipt); assert.doesNotMatch(receipt.html, COACH_NAMES, 'no coach name on the receipt')
})

await test('session by session: sessions left and their total, pay for the rest of the term, the dates marked paid', async () => {
  const calId = fam.rows[2].rowId
  let d = (await parent.call('/api/jfp-account', { action: 'overview' })).data
  const o = d.owed.find((x) => x.rowId === calId)
  assert.equal(o.kind, 'prepay'); assert.ok(o.left >= 2, `sessions left: ${o.left}`)
  assert.equal(o.leftCents, o.left * 8000); assert.deepEqual([o.rest.key, o.rest.n], ['rest', o.left])
  const cal = d.players.find((p) => p.name === 'Cal Family').enrolments[0]
  assert.equal(cal.sessionPay, true); assert.deepEqual(cal.paidDates, [])
  const r = await parent.call('/api/jfp-account', { action: 'payOwed', rowId: calId, option: 'rest' })
  assert.equal(r.status, 200, JSON.stringify(r.data))
  const q = (await auditOf('payreq.account.prepay')).find((x) => x.after.row === calId)
  assert.equal(q.after.sessions, o.left); assert.equal(q.after.cents, o.left * 8000)
  await payAtStripe(parent, r.data.url)
  assert.equal(tag((await row(calId))['Term 4 Notes'], 'PREPAID'), String(o.left))
  d = (await parent.call('/api/jfp-account', { action: 'overview' })).data
  const after = d.players.find((p) => p.name === 'Cal Family').enrolments[0]
  assert.deepEqual(after.paidDates, o.dates.map((x) => x.iso), 'every date left is marked paid')
  assert.ok(!d.owed.some((x) => x.rowId === calId), 'nothing left to pay ahead')
})

await test('a quote run is never longer than the sessions left; the editor gets Rest of term and Whole term', async () => {
  const calId = fam.rows[2].rowId
  const q = await ok('playerQuote', { rowId: calId })
  assert.ok(q.termWhole >= q.termLeft && q.termLeft >= 2, JSON.stringify([q.termWhole, q.termLeft]))
  assert.equal(pr.runs.byGroup[G1.id].whole, q.termWhole)
  const bad = await portal('saveQuote', { rowId: calId, perCents: 8000, tiers: [{ n: q.termLeft + 1, cents: 7000 }] })
  assert.equal(bad.status, 400); assert.match(bad.data.error, new RegExp(`Only ${q.termLeft} sessions are left`))
  const good = await ok('saveQuote', { rowId: calId, perCents: 8000, tiers: [{ n: q.termLeft, cents: 7000 }] })
  assert.deepEqual(good.quote.tiers, [{ n: q.termLeft, cents: 7000 }])
  const add = await portal('addPlayer', { groupId: G1.id, force: true, player: { name: 'Dot Quote' }, parent: { name: 'Dee Quote', email: 'dee.quote@example.com' }, payment: 'pro', perSessionCents: 10000, quote: { tiers: [{ n: pr.runs.byGroup[G1.id].left + 1, cents: 9000 }] } })
  assert.equal(add.status, 400, 'Add a player checks the run too')
})

await test('Players tab Add a family: no group needed, one sign-in email for both, no amounts', async () => {
  const before = (await emails()).length
  const r = await ok('addFamily', { parent: { name: 'Nia Nogroup', email: 'nia.nogroup@example.com', mobile: '0400 888 000' }, sendEmail: true, children: [{ player: { name: 'Ola Nogroup' }, payment: 'none' }, { player: { name: 'Pip Nogroup' }, payment: 'sessions', perSessionCents: 7500 }] })
  assert.equal(r.payreq, null)
  const rows = await Promise.all(r.rows.map((x) => row(x.rowId)))
  assert.ok(rows.every((x) => !x['Term 3 Day']), 'no group yet')
  assert.deepEqual(r.rows.map((x) => x.where), ['Group to be confirmed', 'Group to be confirmed'])
  const mine = (await emails()).slice(before).filter((e) => e.to.includes('nia.nogroup@example.com'))
  assert.equal(mine.length, 1); assert.match(mine[0].subject, /Ola and Pip/)
  assert.doesNotMatch(mine[0].html, /Total to pay/)
})

console.log(`\n${passed} round 2 flow checks passed`)
