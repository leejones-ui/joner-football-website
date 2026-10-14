// Pro session quotes and the Fees tab (Lee, 14 Oct 2026), end to end against
// the local harness: fake Airtable, fake Stripe, captured email.
// Lee sets a default Pro quote, adds a Pro at A$100 a session with "6 in a row
// at A$95 each", the player signs in, sees both options, commits to 6, pays
// A$570; [PREPAID:6] and the six dates are on the row, and staff session
// billing never bills those dates. A Pro with no quote keeps plain
// per-session pay. Fees lists the family's payments.
//   npm run build && HOLIDAY_LOCAL_PORT=4651 node scripts/holiday-local.mjs   (one terminal)
//   node scripts/test-jfp-pro-quotes-flow.mjs 4651                            (another)
// Every name, email and amount here is invented.
import assert from 'node:assert/strict'

const PORT = Number(process.argv[2] || 4321)
const B = `http://localhost:${PORT}`
let passed = 0
async function test(name, fn) { await fn(); passed += 1; console.log(`ok - ${name}`) }

let ipSeq = 60
function client() {
  const jar = new Map()
  const ip = `10.9.1.${ipSeq++}`
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
const patch = async (id, fields) => { const r = await fetch(`${B}/__patch?table=term4&id=${id}&fields=${encodeURIComponent(JSON.stringify(fields))}`); assert.equal(r.status, 200) }
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
}
const row = async (id) => (await at()).term4.find((r) => r.id === id).fields
const payreqsFor = async (rowId) => {
  const ids = JSON.parse(await kv(['ZRANGE', 'jfp:payreqs', '0', '-1']))
  const out = []
  for (const id of ids) { const q = JSON.parse(await kv(['GET', `jfp:payreq:${id}`]) || 'null'); if (q && (q.term4Ids || []).includes(rowId)) out.push(q) }
  return out
}
const auditOf = async (action) => JSON.parse(await kv(['LRANGE', 'jfp:audit', '0', '200'])).map((x) => JSON.parse(x)).filter((x) => x.action === action)
const tag = (notes, t) => (String(notes).match(new RegExp(`\\[${t}:([^\\]]*)\\]`)) || [])[1]
const ADULT = { accepted: { terms: true, makeups: true, payment: true, emergency: true, adult: true }, media: false, kind: 'adult' }

const lee = client()
await signIn(lee, 'leejones@jonerfootball.com', 'staff')
const portal = async (action, body = {}) => lee.call('/api/jfp-portal-data', { action, ...body })
const ok = async (action, body = {}) => { const r = await portal(action, body); assert.equal(r.status, 200, `${action}: ${JSON.stringify(r.data)}`); return r.data }
const GROUP = (await ok('saveGroup', { group: { day: 'Wednesday', time: '7:30am', location: 'NTRA', coachId: 'lee', capacity: 12, mode: 'direct', label: 'Pros' } })).group.id

let seq = 0
async function addPro(name, email, extra = {}) {
  seq += 1
  return ok('addPlayer', { groupId: GROUP, force: true, player: { name, dob: `199${seq}-04-0${seq}` }, parent: { name: '', email, mobile: `0400 333 44${seq}` }, ownContact: true, payment: 'pro', perSessionCents: 10000, sendEmail: true, ...extra })
}
async function signAdult(c, name, dob, mobile) {
  const me = (await c.call('/api/jfp-account', { action: 'overview' })).data.players[0]
  const r = await c.call('/api/jfp-account', { action: 'signWaiver', players: [{ key: me.key, dob, emergencyName: `Em ${name}`, emergencyPhone: '0400 555 666' }], waiver: { ...ADULT, signature: name }, parentName: name, mobile })
  assert.equal(r.status, 200, JSON.stringify(r.data))
}

await test('Prices: Lee saves a default Pro quote (A$100, 6 in a row at A$95); a bad one is refused; only staff', async () => {
  const bad = await portal('saveDefaultQuote', { quote: { perCents: 10000, tiers: [{ n: 6, cents: 11000 }] } })
  assert.equal(bad.status, 400)
  const d = await ok('saveDefaultQuote', { quote: { perCents: 10000, tiers: [{ n: 6, cents: 9500 }] } })
  assert.deepEqual(d.defaultQuote.tiers, [{ n: 6, cents: 9500 }])
  assert.deepEqual((await ok('pricing')).defaultQuote.tiers, [{ n: 6, cents: 9500 }])
  const stranger = client()
  assert.notEqual((await stranger.call('/api/jfp-portal-data', { action: 'saveQuote', rowId: 'recAAAAAAAAAAAAAA', perCents: 100, tiers: [] })).status, 200, 'no staff session, no quote change')
})

let qRow = '', plainRow = ''
await test('Add a player with a quote: [PERSESSION:10000] and [QUOTE:6x9500] on the row, in the audit, and in Edit', async () => {
  const bad = await portal('addPlayer', { groupId: GROUP, force: true, player: { name: 'Quinn Badquote' }, parent: { email: 'quinn.bad@example.com' }, ownContact: true, payment: 'pro', perSessionCents: 10000, quote: { tiers: [{ n: 6, cents: 10500 }] } })
  assert.equal(bad.status, 400, 'a commitment dearer than a session is refused before anything is written')
  assert.ok(!(await at()).term4.some((r) => r.fields['Player Name'] === 'Quinn Badquote'))
  const a = await addPro('Quinn Quoted', 'quinn.quoted@example.com', { quote: { tiers: [{ n: 6, cents: 9500 }] } })
  qRow = a.rowId
  const n = (await row(qRow))['Term 4 Notes']
  assert.equal(tag(n, 'PERSESSION'), '10000'); assert.equal(tag(n, 'QUOTE'), '6x9500')
  assert.deepEqual((await auditOf('player.add')).find((x) => x.target === qRow).after.quote, [{ n: 6, cents: 9500 }])
  const q = await ok('playerQuote', { rowId: qRow })
  assert.deepEqual(q.quote, { perCents: 10000, tiers: [{ n: 6, cents: 9500 }] }); assert.equal(q.commitment, null); assert.equal(q.sessionPay, true)
  plainRow = (await addPro('Pia Plain', 'pia.plain@example.com')).rowId
  assert.equal(tag((await row(plainRow))['Term 4 Notes'], 'QUOTE'), undefined)
})

await test('staff change a quote in Edit (a loyal player gets more options): saved, audited, never by the player', async () => {
  const r = await ok('saveQuote', { rowId: qRow, perCents: 10000, tiers: [{ n: 6, cents: 9500 }, { n: 4, cents: 9800 }] })
  assert.deepEqual(r.quote.tiers, [{ n: 4, cents: 9800 }, { n: 6, cents: 9500 }])
  const e = (await auditOf('player.quote')).find((x) => x.target === qRow)
  assert.deepEqual(e.before.tiers, [{ n: 6, cents: 9500 }]); assert.equal(e.by, 'leejones@jonerfootball.com')
  await ok('saveQuote', { rowId: qRow, perCents: 10000, tiers: [{ n: 6, cents: 9500 }] })
  assert.equal(tag((await row(qRow))['Term 4 Notes'], 'QUOTE'), '6x9500')
})

const pro = client()
let commitDates = []
await test('the player signs in and sees both options: the next session at A$100, or 6 in a row at A$95 = A$570, dates listed', async () => {
  await signIn(pro, 'quinn.quoted@example.com')
  await signAdult(pro, 'Quinn Quoted', '1991-04-01', '0400 333 441')
  const d = (await pro.call('/api/jfp-account', { action: 'overview' })).data
  const o = d.owed.find((x) => x.rowId === qRow)
  assert.ok(o.dates.length >= 6, `the term's remaining dates (${o.dates.length})`)
  // Round 2: and the rest of the term at the price per session (every date left).
  assert.deepEqual(o.quote.options.map((x) => [x.key, x.totalCents]), [['one', 10000], ['commit:6', 57000], ...(o.dates.length > 6 ? [['rest', o.dates.length * 10000]] : [])])
  assert.equal(o.quote.options[1].dates.length, 6); assert.equal(o.quote.options[1].saveCents, 3000)
  commitDates = o.quote.options[1].dates.map((x) => x.iso)
  assert.deepEqual(commitDates, o.dates.slice(0, 6).map((x) => x.iso), 'six in a row, from the next session')
})

await test('commit to 6: the amount comes from the quote only, one request on a double tap, and they can choose again', async () => {
  assert.equal((await pro.call('/api/jfp-account', { action: 'payOwed', rowId: qRow, option: 'commit:10' })).data.code, 'option', 'an option staff did not set is refused')
  const [a, b] = await Promise.all([1, 2].map(() => pro.call('/api/jfp-account', { action: 'payOwed', rowId: qRow, option: 'commit:6', amountCents: 100, sessions: 1 })))
  assert.ok([a, b].some((x) => x.status === 200 && x.data.url), JSON.stringify([a.data, b.data]))
  let qs = (await payreqsFor(qRow)).filter((q) => ['open', 'checkout'].includes(q.status))
  assert.equal(qs.length, 1, 'no duplicate open payment requests')
  assert.equal(qs[0].amountCents, 57000); assert.equal(qs[0].prepay.commit, true); assert.deepEqual(qs[0].prepay.dates, commitDates)
  assert.equal(qs[0].programme, 'pro')
  assert.equal((await row(qRow))['Term 4 Fee'], 570, 'on the fee while the link is open, as any prepay')
  const view = (await pro.call('/api/jfp-account', { action: 'overview' })).data
  assert.equal(view.todo[0].canChoose, true); assert.match(view.todo[0].places[0].label, /Commitment: 6 sessions in a row at A\$95 each/)
  // Changed their mind: close it, the fee goes back, the options are back.
  assert.equal((await pro.call('/api/jfp-account', { action: 'cancelOwed', payreqId: qs[0].id })).status, 200)
  assert.equal((await row(qRow))['Term 4 Fee'], 0)
  assert.ok((await pro.call('/api/jfp-account', { action: 'overview' })).data.owed.find((x) => x.rowId === qRow)?.quote)
  const p = await pro.call('/api/jfp-account', { action: 'payOwed', rowId: qRow, option: 'commit:6' })
  assert.equal(p.status, 200, JSON.stringify(p.data))
  qs = (await payreqsFor(qRow)).filter((q) => ['open', 'checkout'].includes(q.status))
  assert.equal(qs.length, 1)
  await payAtStripe(pro, p.data.url)
})

await test('paid A$570: [PREPAID:6] and the six dates on the row; the dates are not offered again; staff Edit shows it', async () => {
  const f = await row(qRow)
  assert.equal(f['Term 4 Amount Paid'], 570); assert.equal(f['Term 4 Payment Status'], 'Paid')
  assert.equal(tag(f['Term 4 Notes'], 'PREPAID'), '6')
  assert.deepEqual(tag(f['Term 4 Notes'], 'COVERED').split(','), commitDates)
  const o = (await pro.call('/api/jfp-account', { action: 'overview' })).data.owed.find((x) => x.rowId === qRow)
  if (o) { assert.ok(o.dates.every((d) => !commitDates.includes(d.iso))); assert.equal(o.quote.commitment.left, 6) }
  const q = await ok('playerQuote', { rowId: qRow })
  assert.equal(q.commitment.sessions, 6); assert.equal(q.commitment.left, 6); assert.equal(q.commitments[0].amountLabel, 'A$570')
})

await test('staff session billing bills none of the committed dates; a missed one still counts as paid', async () => {
  // Today's session is not one of them: billed as usual (recorded as paid by bank).
  const today = await ok('sessionInvoice', { rows: [{ rowId: qRow, sessions: 1, perSessionCents: 10000 }], mode: 'paid', method: 'Bank Transfer', date: new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' }) })
  assert.equal(today.recorded, 'A$100')
  let f = await row(qRow)
  assert.equal(tag(f['Term 4 Notes'], 'PREPAID'), '6', 'the commitment is untouched')
  assert.equal(tag(f['Term 4 Notes'], 'COVERED').split(',').length, 6)
  // Three weeks on (the first three committed dates moved into the past), staff bill the 2 the player came to.
  const past = ['2026-09-30', '2026-10-07', '2026-10-14']
  await patch(qRow, { 'Term 4 Notes': f['Term 4 Notes'].replace(/\[COVERED:[^\]]*\]/, `[COVERED:${[...past, ...commitDates.slice(3)].join(',')}]`) })
  const fee = f['Term 4 Fee']
  const r = await ok('sessionInvoice', { rows: [{ rowId: qRow, sessions: 2, perSessionCents: 10000 }], mode: 'link', sendEmail: false })
  assert.equal(r.payreq, null, 'nothing billed'); assert.equal(r.covered, 2)
  f = await row(qRow)
  assert.equal(f['Term 4 Fee'], fee, 'the fee is unchanged')
  assert.equal(tag(f['Term 4 Notes'], 'PREPAID'), '3', 'three committed dates used: two came, one missed and counted as paid')
  assert.deepEqual(tag(f['Term 4 Notes'], 'COVERED').split(','), commitDates.slice(3))
  assert.match(f['Term 4 Notes'], /1 committed session missed and counted as paid/)
})

await test('a Pro with no quote sees plain per-session pay, and cannot ask for a commitment', async () => {
  const c = client()
  await signIn(c, 'pia.plain@example.com')
  await signAdult(c, 'Pia Plain', '1992-04-02', '0400 333 442')
  const o = (await c.call('/api/jfp-account', { action: 'overview' })).data.owed.find((x) => x.rowId === plainRow)
  assert.equal(o.kind, 'prepay'); assert.equal(o.perCents, 10000); assert.equal(o.quote, undefined)
  assert.equal((await c.call('/api/jfp-account', { action: 'payOwed', rowId: plainRow, option: 'commit:6' })).data.code, 'option')
  const p = await c.call('/api/jfp-account', { action: 'payOwed', rowId: plainRow, sessions: 1 })
  assert.equal(p.status, 200)
  assert.equal((await payreqsFor(plainRow))[0].amountCents, 10000)
})

await test('Fees: the player sees the commitment (with its receipt) and the bank transfer, newest first, nothing of anyone else', async () => {
  const r = await pro.call('/api/jfp-account', { action: 'fees' })
  assert.equal(r.status, 200, JSON.stringify(r.data))
  const f = r.data.fees
  const commit = f.records.find((x) => /Commitment: 6 sessions/.test(x.what))
  assert.ok(commit, JSON.stringify(f.records))
  assert.equal(commit.amountLabel, 'A$570'); assert.equal(commit.programme, 'Pro sessions'); assert.match(commit.receiptUrl, /\/mock-stripe\/receipt\//)
  const bank = f.records.find((x) => x.method === 'Bank transfer')
  assert.equal(bank?.amountLabel, 'A$100')
  assert.ok(!f.records.some((x) => /pia|plain/i.test(JSON.stringify(x))), 'nobody else')
  const place = f.places.find((x) => x.rowId === qRow)
  assert.equal(place.kind, 'pro'); assert.equal(place.paidLabel, 'A$670'); assert.equal(place.commitment.left, 3)
  assert.equal(f.paidLabel, 'A$670')
  assert.equal(r.data.fees.intentIds, undefined)
})

await test('a family Fees tab lists the term payment they made', async () => {
  const add = await ok('addPlayer', { groupId: GROUP, force: true, player: { name: 'Fen Family', dob: '2013-05-05' }, parent: { name: 'Fay Family', email: 'fay.family@example.com', mobile: '0400 777 888' }, payment: 'none', sendEmail: true })
  const c = client()
  await signIn(c, 'fay.family@example.com')
  const me = (await c.call('/api/jfp-account', { action: 'overview' })).data.players[0]
  assert.equal((await c.call('/api/jfp-account', { action: 'signWaiver', players: [{ key: me.key, dob: '2013-05-05', emergencyName: 'Gran Family', emergencyPhone: '0400 777 889' }], waiver: { accepted: { terms: true, makeups: true, payment: true, emergency: true }, media: false, kind: 'guardian', signature: 'Fay Family' }, parentName: 'Fay Family', mobile: '0400 777 888' })).status, 200)
  const first = await c.call('/api/jfp-account', { action: 'payOwed', rowId: add.rowId })
  assert.equal(first.data.code, 'kit')
  const q = (await payreqsFor(add.rowId))[0]
  assert.equal((await c.call('/api/jfp-account', { action: 'confirmKit', payreqId: q.id, kit: 'has' })).status, 200)
  const p = await c.call('/api/jfp-account', { action: 'pay', payreqId: q.id })
  await payAtStripe(c, p.data.url)
  const f = (await c.call('/api/jfp-account', { action: 'fees' })).data.fees
  assert.equal(f.records.length, 1, JSON.stringify(f.records))
  assert.equal(f.records[0].amountLabel, q.amountCents === 85000 ? 'A$850' : f.records[0].amountLabel)
  assert.equal(f.records[0].programme, 'JFP'); assert.ok(f.records[0].receiptUrl)
  assert.equal(f.places[0].owingCents, 0)
})

console.log(`\n${passed} Pro quote and Fees flow checks passed`)
