// Pay from My account and the adult waiver (Lee, 13 Oct 2026), end to end
// against the local harness: fake Airtable, fake Stripe, captured email.
// Lee's path: Timetable > a group > Add a player > Add and email. The player
// signs in, signs the right waiver, and the Pay step is already there.
//   npm run build && HOLIDAY_LOCAL_PORT=4621 node scripts/holiday-local.mjs   (one terminal)
//   node scripts/test-jfp-pay-waiver-flow.mjs 4621                           (another)
// Every name, email and amount here is invented.
import assert from 'node:assert/strict'

const PORT = Number(process.argv[2] || 4321)
const B = `http://localhost:${PORT}`
let passed = 0
async function test(name, fn) { await fn(); passed += 1; console.log(`ok - ${name}`) }

let ipSeq = 40
function client() {
  const jar = new Map()
  const ip = `10.9.0.${ipSeq++}`
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
// Stripe's page: pay, then the success page asks jfp-confirm.
async function payAtStripe(c, url) {
  const back = await fetch(`${url}&action=pay`, { redirect: 'manual' })
  const sid = new URL(back.headers.get('location')).searchParams.get('session_id')
  const conf = await c.call(`/api/jfp-confirm?session_id=${sid}`)
  assert.equal(conf.data.status, 'paid', JSON.stringify(conf.data))
}
const row = async (id) => (await at()).term4.find((r) => r.id === id).fields
const payreqsFor = async (rowId) => {
  const ids = JSON.parse(await kv(['ZRANGE', 'jfp:payreqs', '0', '-1']))
  const out = []
  for (const id of ids) { const q = JSON.parse(await kv(['GET', `jfp:payreq:${id}`]) || 'null'); if (q && (q.term4Ids || []).includes(rowId)) out.push(q) }
  return out
}
const ADULT = { accepted: { terms: true, makeups: true, payment: true, emergency: true, adult: true }, media: false, kind: 'adult' }
const GUARDIAN = { accepted: { terms: true, makeups: true, payment: true, emergency: true }, media: false, kind: 'guardian' }

const lee = client()
await signIn(lee, 'leejones@jonerfootball.com', 'staff')
const portal = async (action, body = {}) => lee.call('/api/jfp-portal-data', { action, ...body })
const ok = async (action, body = {}) => { const r = await portal(action, body); assert.equal(r.status, 200, `${action}: ${JSON.stringify(r.data)}`); return r.data }
const PRO_GROUP = (await ok('saveGroup', { group: { day: 'Thursday', time: '7pm', location: 'Belrose HQ', coachId: 'lee', capacity: 12, mode: 'direct', label: 'Squad' } })).group.id
const KIDS_GROUP = (await ok('saveGroup', { group: { day: 'Wednesday', time: '5:25pm', location: 'Belrose HQ', coachId: 'sam', capacity: 8, mode: 'direct', minAge: 8, maxAge: 13 } })).group.id

// Lee's add: Timetable > group > Add a player, own contact, emailed.
// Each adult has their own mobile and birthday, so no waiver is matched across them.
let adultSeq = 0
async function addAdult(name, email, extra) {
  const n = (await emails()).length
  adultSeq += 1
  const r = await ok('addPlayer', { groupId: PRO_GROUP, force: true, player: { name, dob: `199${adultSeq}-03-0${adultSeq}` }, parent: { name: '', email, mobile: `0400 222 33${adultSeq}` }, ownContact: true, sendEmail: true, ...extra })
  assert.equal(r.emailed, true, JSON.stringify(r))
  const mail = (await emails()).slice(n).filter((e) => e.to.includes(email))
  assert.equal(mail.length, 1, 'one email')
  return { rowId: r.rowId, mail: mail[0], payreq: r.payreq }
}
const order = (html, words) => words.map((w) => html.indexOf(w)).every((i, k, a) => i >= 0 && (k === 0 || i > a[k - 1]))

let sessRow = ''
const pro = client()
await test('Timetable add, own contact, A$100 a session, emailed: one email, waiver then pay then details', async () => {
  const a = await addAdult('Rowan Proudfoot', 'rowan.proudfoot@example.com', { payment: 'pro', perSessionCents: 10000 })
  sessRow = a.rowId
  assert.equal(a.payreq, null, 'no link made at add time: the account makes one when they pay')
  assert.match((await row(sessRow))['Term 4 Notes'], /\[PERSESSION:10000\]/)
  assert.ok(order(a.mail.html, ['sign your waiver', 'pay for your sessions']), a.mail.html)
  assert.doesNotMatch(a.mail.html, /parent|guardian/i)
})

await test('signed in: the adult waiver is offered and the Pay step is already there, for the next session at A$100', async () => {
  await signIn(pro, 'rowan.proudfoot@example.com')
  const d = (await pro.call('/api/jfp-account', { action: 'overview' })).data
  assert.equal(d.self, true)
  const me = d.players[0]
  assert.equal(me.adult, true, 'an adult own contact signs the adult waiver')
  assert.equal(me.waiver.onFile, false)
  const o = d.owed.find((x) => x.rowId === sessRow)
  assert.ok(o, JSON.stringify(d.owed))
  assert.equal(o.kind, 'prepay'); assert.equal(o.perCents, 10000); assert.equal(o.needsWaiver, true)
  assert.ok(o.max >= 1 && o.dates.length >= 1)
  assert.equal(d.players[0].enrolments[0].payment.state, 'sessions')
  const early = await pro.call('/api/jfp-account', { action: 'payOwed', rowId: sessRow, sessions: 1 })
  assert.equal(early.data.code, 'waiver', 'the waiver comes first')
  assert.equal((await payreqsFor(sessRow)).length, 0, 'nothing made before the waiver')
})

await test('the adult waiver: the "18 or over" tick is required, no parent or guardian is written, the kind is stored', async () => {
  const me = (await pro.call('/api/jfp-account', { action: 'overview' })).data.players[0]
  const body = { action: 'signWaiver', players: [{ key: me.key, dob: '1991-03-01', emergencyName: 'Em Proudfoot', emergencyPhone: '0400 444 555' }], parentName: 'Rowan Proudfoot', mobile: '0400 222 331' }
  const noTick = await pro.call('/api/jfp-account', { ...body, waiver: { ...GUARDIAN, signature: 'Rowan Proudfoot' } })
  assert.equal(noTick.status, 400); assert.equal(noTick.data.code, 'adult')
  const r = await pro.call('/api/jfp-account', { ...body, waiver: { ...ADULT, signature: 'Rowan Proudfoot' } })
  assert.equal(r.status, 200, JSON.stringify(r.data))
  const w = (await at()).waiver.filter((x) => x.fields['Player Full Name'] === 'Rowan Proudfoot').at(-1).fields
  assert.equal(w['Parent/Guardian Name'], '')
  assert.match(w['Internal Notes'], /\[WAIVER:adult\]/)
  assert.match(w['JFP Program Waiver and Agreement'], /adult version/)
  assert.equal(w['Player Mobile Number'], '0400 222 331')
  const d = (await pro.call('/api/jfp-account', { action: 'overview' })).data
  assert.equal(d.players[0].waiver.kind, 'adult')
  const board = (await ok('board')).groups.flatMap((g) => g.players).find((p) => p.rowId === sessRow)
  assert.equal(board.waiverKind, 'adult', 'staff see which waiver')
})

let paidDate = ''
await test('Pay for your sessions: a double tap makes one payment request, A$100 paid, recorded on the row as prepaid', async () => {
  const d = (await pro.call('/api/jfp-account', { action: 'overview' })).data
  paidDate = d.owed.find((x) => x.rowId === sessRow).dates[0].iso
  const tamper = await pro.call('/api/jfp-account', { action: 'payOwed', rowId: sessRow, sessions: 999 })
  assert.equal(tamper.status, 400, 'more sessions than are left is refused')
  const [a, b] = await Promise.all([1, 2].map(() => pro.call('/api/jfp-account', { action: 'payOwed', rowId: sessRow, sessions: 1, amountCents: 1 })))
  assert.ok([a, b].some((x) => x.status === 200 && x.data.url), JSON.stringify([a, b]))
  const again = await pro.call('/api/jfp-account', { action: 'payOwed', rowId: sessRow, sessions: 1 })
  assert.equal(again.status, 200, JSON.stringify(again.data))
  const qs = await payreqsFor(sessRow)
  assert.equal(qs.length, 1, 'no duplicate payment requests')
  assert.equal(qs[0].amountCents, 10000, 'the amount is worked out on the server')
  assert.equal(qs[0].reason, 'sessions'); assert.equal(qs[0].programme, 'pro'); assert.deepEqual(qs[0].prepay.dates, [paidDate])
  const f = await row(sessRow)
  assert.equal(f['Term 4 Fee'], 100, 'the session is on the fee, as staff billing does')
  const view = (await pro.call('/api/jfp-account', { action: 'overview' })).data
  assert.equal(view.owed.filter((x) => x.rowId === sessRow).length, 0, 'the open request shows in To do instead')
  assert.equal(view.todo.length, 1); assert.equal(view.todo[0].needsKit, false, 'no kit step for sessions')
  await payAtStripe(pro, again.data.url)
  const paid = await row(sessRow)
  assert.equal(paid['Term 4 Amount Paid'], 100); assert.equal(paid['Term 4 Payment Status'], 'Paid')
  assert.match(paid['Term 4 Notes'], /\[PREPAID:1\]/)
  const next = (await pro.call('/api/jfp-account', { action: 'overview' })).data.owed.find((x) => x.rowId === sessRow)
  assert.ok(!next || next.dates[0].iso !== paidDate, 'a prepaid date is not offered again')
  const proView = (await ok('proMoney', { fresh: true })).pro
  assert.equal(proView.byPlayer.find((p) => p.rowId === sessRow)?.prepaidSessions, 1, 'Money > Pro sessions shows the prepaid session')
})

await test('staff billing the prepaid session from Money takes it off: nothing charged twice', async () => {
  const r = await ok('sessionInvoice', { rows: [{ rowId: sessRow, sessions: 1, perSessionCents: 10000 }], mode: 'link', sendEmail: false })
  assert.equal(r.payreq, null); assert.equal(r.covered, 1); assert.match(r.message, /paid in advance/)
  const f = await row(sessRow)
  assert.equal(f['Term 4 Fee'], 100, 'the fee is unchanged')
  assert.doesNotMatch(f['Term 4 Notes'], /\[PREPAID:/)
  const two = await ok('sessionInvoice', { rows: [{ rowId: sessRow, sessions: 2, perSessionCents: 10000 }], mode: 'link', sendEmail: false })
  assert.equal(two.payreq.amountLabel, 'A$200', 'with nothing prepaid, billing is as before')
})

await test('Timetable add, own contact, A$850 term price with a link, emailed: adult waiver, kit, pay A$850, paid', async () => {
  const a = await addAdult('Tess Termpro', 'tess.termpro@example.com', { payment: 'link', amountCents: 85000 })
  assert.ok(a.payreq?.id)
  assert.ok(order(a.mail.html, ['sign your waiver', 'pay A$850']), a.mail.html)
  const c = client()
  await signIn(c, 'tess.termpro@example.com')
  const d = (await c.call('/api/jfp-account', { action: 'overview' })).data
  assert.equal(d.players[0].adult, true)
  assert.equal(d.todo.length, 1); assert.equal(d.owed.length, 0, 'the add-time link is the Pay step, no second one')
  // The account's Pay for an owed place hands back the same request.
  const me = d.players[0]
  assert.equal((await c.call('/api/jfp-account', { action: 'signWaiver', players: [{ key: me.key, dob: '1992-03-02', emergencyName: 'Em Termpro', emergencyPhone: '0400 444 556' }], waiver: { ...ADULT, signature: 'Tess Termpro' }, parentName: 'Tess Termpro', mobile: '0400 222 334' })).status, 200)
  assert.equal((await c.call('/api/jfp-account', { action: 'payOwed', rowId: a.rowId })).data.code, 'kit')
  assert.equal((await payreqsFor(a.rowId)).length, 1)
  assert.equal((await c.call('/api/jfp-account', { action: 'confirmKit', payreqId: a.payreq.id, kit: 'ordered' })).status, 200)
  const p = await c.call('/api/jfp-account', { action: 'pay', payreqId: a.payreq.id })
  assert.equal(p.status, 200, JSON.stringify(p.data))
  await payAtStripe(c, p.data.url)
  const f = await row(a.rowId)
  assert.equal(f['Term 4 Amount Paid'], 850); assert.equal(f['Term 4 Payment Status'], 'Paid'); assert.equal(f['Term 4 Confirmation'], 'Confirmed')
})

await test('a term fee of A$850 with no link (decide later): Pay A$850 is there, one request on a double tap, paid', async () => {
  const a = await addAdult('Nico Nolink', 'nico.nolink@example.com', { payment: 'none' })
  assert.equal(a.payreq, null)
  assert.equal((await row(a.rowId))['Term 4 Fee'], 850)
  assert.ok(order(a.mail.html, ['sign your waiver', 'pay A$850']), a.mail.html)
  const c = client()
  await signIn(c, 'nico.nolink@example.com')
  let d = (await c.call('/api/jfp-account', { action: 'overview' })).data
  const o = d.owed.find((x) => x.rowId === a.rowId)
  assert.equal(o.kind, 'term'); assert.equal(o.amountCents, 85000); assert.match(o.title, /^Pay A\$850 for Term 4 2026, Thursday 7pm/)
  assert.equal(d.players[0].enrolments[0].payment.state, 'due')
  const me = d.players[0]
  assert.equal((await c.call('/api/jfp-account', { action: 'signWaiver', players: [{ key: me.key, dob: '1993-03-03', emergencyName: 'Em Nolink', emergencyPhone: '0400 444 557' }], waiver: { ...ADULT, signature: 'Nico Nolink' }, parentName: 'Nico Nolink', mobile: '0400 222 335' })).status, 200)
  const taps = await Promise.all([1, 2, 3].map(() => c.call('/api/jfp-account', { action: 'payOwed', rowId: a.rowId, amountCents: 100 })))
  assert.ok(taps.some((x) => x.data.code === 'kit'), JSON.stringify(taps.map((x) => x.data)))
  const qs = await payreqsFor(a.rowId)
  assert.equal(qs.length, 1, 'no duplicate payment requests')
  assert.equal(qs[0].amountCents, 85000, 'the amount is the fee less paid, from Airtable')
  assert.equal(qs[0].fromAccount, true)
  d = (await c.call('/api/jfp-account', { action: 'overview' })).data
  assert.equal(d.owed.length, 0); assert.equal(d.todo[0].needsKit, true)
  assert.equal((await c.call('/api/jfp-account', { action: 'confirmKit', payreqId: qs[0].id, kit: 'has' })).status, 200)
  const p = await c.call('/api/jfp-account', { action: 'payOwed', rowId: a.rowId })
  assert.equal(p.status, 200, JSON.stringify(p.data))
  await payAtStripe(c, p.data.url)
  const f = await row(a.rowId)
  assert.equal(f['Term 4 Amount Paid'], 850); assert.equal(f['Term 4 Payment Status'], 'Paid')
  assert.equal((await c.call('/api/jfp-account', { action: 'overview' })).data.owed.length, 0, 'nothing left to pay')
})

await test('a child still gets the parent or guardian waiver', async () => {
  const add = await ok('addPlayer', { groupId: KIDS_GROUP, force: true, player: { name: 'Mia Minor', dob: '2014-06-06' }, parent: { name: 'Max Minor', email: 'minor.family@example.com', mobile: '0400 666 777' }, payment: 'none', sendEmail: true })
  const mail = (await emails()).filter((e) => e.to.includes('minor.family@example.com')).at(-1)
  assert.ok(order(mail.html, ['sign the waiver', 'pay A$850']), mail.html)
  const c = client()
  await signIn(c, 'minor.family@example.com')
  const me = (await c.call('/api/jfp-account', { action: 'overview' })).data.players[0]
  assert.equal(me.adult, false)
  const body = { action: 'signWaiver', players: [{ key: me.key, dob: '2014-06-06', emergencyName: 'Gran Minor', emergencyPhone: '0400 666 778' }], parentName: 'Max Minor', mobile: '0400 666 777' }
  const asAdult = await c.call('/api/jfp-account', { ...body, waiver: { ...ADULT, signature: 'Max Minor' } })
  assert.equal(asAdult.status, 400); assert.equal(asAdult.data.code, 'guardian', 'an under 18 cannot sign the adult waiver')
  assert.equal((await c.call('/api/jfp-account', { ...body, waiver: { ...GUARDIAN, signature: 'Max Minor' } })).status, 200)
  const w = (await at()).waiver.filter((x) => x.fields['Player Full Name'] === 'Mia Minor').at(-1).fields
  assert.equal(w['Parent/Guardian Name'], 'Max Minor')
  assert.match(w['Internal Notes'], /\[WAIVER:guardian\]/)
  assert.ok(add.rowId)
})

console.log(`\n${passed} pay from account and adult waiver checks passed`)
