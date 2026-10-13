// Joners Juniors in the portal, stage 1, end to end against the local
// harness and its invented Juniors data (the Juniors tables refuse columns
// they do not have, as Airtable does):
//   npm run build
//   JFP_JUNIORS_DEMO=1 HOLIDAY_LOCAL_PORT=4491 node scripts/holiday-local.mjs
//   node scripts/test-jj-flow.mjs 4491
// Safe to run after scripts/test-jfp-juniors-flow.mjs on the same harness.
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
const B = `http://localhost:${process.argv[2] || '4491'}`
let passed = 0, ip = 1
const test = async (n, fn) => { await fn(); passed += 1; console.log(`ok - ${n}`) }
function client() {
  const jar = new Map(), me = `10.8.0.${ip++}`
  return async (p, body) => {
    const res = await fetch(`${B}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: B, 'x-forwarded-for': me, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') }, body: JSON.stringify(body || {}) })
    for (const c of res.headers.getSetCookie?.() || []) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar.set(kv.slice(0, i), kv.slice(i + 1)) }
    let data = {}; try { data = await res.json() } catch {}
    return { status: res.status, data }
  }
}
async function signIn(call, email, audience = 'staff') {
  const s = await call('/api/jfp-auth', { action: 'start', email, audience })
  const code = (await (await fetch(`${B}/__emails`)).json()).filter((e) => e.to.includes(email) && /sign-in code/.test(e.subject)).at(-1).subject.match(/(\d{6})/)[1]
  assert.equal((await call('/api/jfp-auth', { action: 'verify', challenge: s.data.challenge, code })).status, 200)
}
const get = async (p) => (await fetch(`${B}${p}`)).json()
const airtable = () => get('/__airtable')
const kv = async (cmd) => JSON.parse((await (await fetch(`${B}/__kv?cmd=${encodeURIComponent(JSON.stringify(cmd))}`)).text()) || 'null')
const emails = () => get('/__emails')
const T4 = ['Player Full Name', 'Payment Status', 'Parent Name', 'Parent Email', 'Parent Mobile', 'Date of Birth', 'Term', 'Session Day', 'Session Time', 'Location', 'Coach', 'Fee', 'Paid Via', 'Confirmation Status', 'Confirmation Date', 'Waiver Status', 'Source Term 3 Record ID', 'Stripe Payment Link', 'Notes']

const lee = client()
await signIn(lee, 'leejones@jonerfootball.com')
const portal = (action, body = {}) => lee('/api/jfp-portal-data', { action, ...body })
const players = async (fresh = true) => (await portal('jjPlayers', { fresh })).data
const kid = async (name) => (await players()).players.find((p) => p.name === name)
const jfpBefore = { money: (await portal('money', { fresh: true })).data.money.kpis, config: (await portal('getSettings')).data.config, at: await airtable() }
const restoreSettings = (await portal('jjSettings')).data.juniors

// Sign up on the website and pay on the pretend Stripe page; the signed webhook follows.
async function signUp(name, email) {
  const r = await fetch(`${B}/api/juniors-registration`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.8.9.${ip++}` }, body: JSON.stringify({ playerFullName: name, parentName: 'Pat Invented', email, mobile: '0400000999', dateOfBirth: '02/02/2021', source: 'Friend', medicalHistory: 'Invented allergy', agreementAccepted: true }) })
  return { status: r.status, data: await r.json() }
}
async function payAndHook(sessionId, { tamper } = {}) {
  await fetch(`${B}/mock-stripe/?cs=${sessionId}&action=pay&webhook=off`, { redirect: 'manual' })
  const paid = (await get('/__sessions')).find((x) => x.id === sessionId)
  return hook({ id: `evt_${sessionId}`, type: 'checkout.session.completed', data: { object: tamper ? tamper(paid) : paid } })
}
async function hook(event, secret = 'whsec_local_juniors') {
  const raw = JSON.stringify(event), t = Math.floor(Date.now() / 1000)
  const sig = `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')}`
  const r = await fetch(`${B}/api/juniors-payment-webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': sig }, body: raw })
  return { status: r.status, data: await r.json().catch(() => ({})) }
}

await test('the public page reads the settings at runtime: Term 4 2026 by default, nothing private', async () => {
  const res = await fetch(`${B}/api/juniors-info`)
  assert.equal(res.status, 200)
  assert.match(res.headers.get('cache-control') || '', /s-maxage=60/)
  const j = (await res.json()).juniors
  assert.equal(j.termDatesLine, 'Term 4: 12 October 2026 to 19 December 2026')
  assert.equal(j.feeLine, '$220 for 10 weeks'); assert.equal(j.registrationOpen, true)
  assert.ok(!/Term 3|25 July|tbl|@/.test(JSON.stringify(j)))
  assert.equal((await fetch(`${B}/api/juniors-info`, { method: 'POST' })).status, 405)
  const page = await (await fetch(`${B}/jonersjuniors/`)).text()
  assert.match(page, /Term 4: 12 October 2026 to 19 December 2026/, 'the built page starts with the Term 4 defaults')
  assert.ok(!/Term 3: 25 July/.test(page))
  assert.match(page, /\/api\/juniors-info/)
})

await test('only Lee and Ligia: coaches, families and strangers are refused every Juniors page', async () => {
  const dean = client(); await signIn(dean, 'jonerfootballdean@gmail.com')
  for (const action of ['jjPlayers', 'jjDashboard', 'jjSettings', 'jjSaveSettings', 'jjAddPlayer', 'jjRecordPayment', 'jjRemovePlayer']) assert.equal((await dean('/api/jfp-portal-data', { action })).status, 403, action)
  const parent = client(); await signIn(parent, 'alpha@example.com', 'parent')
  assert.ok([401, 403].includes((await parent('/api/jfp-portal-data', { action: 'jjPlayers' })).status))
  assert.equal((await client()('/api/jfp-portal-data', { action: 'jjPlayers' })).status, 401)
})

await test('Players: every child with paid status, age, waiver and family, from the Juniors tables', async () => {
  const d = await players()
  assert.equal(d.term, 'Term 4 2026'); assert.equal(d.capacity, 12)
  const by = Object.fromEntries(d.players.map((p) => [p.name, p]))
  for (const n of ['Jun Alpha', 'Jun Delta', 'Jun Echo', 'Jun Foxtrot']) assert.ok(by[n], n)
  assert.equal(by['Jun Alpha'].pay, 'paid'); assert.equal(by['Jun Alpha'].payStatus, 'credit')
  assert.equal(by['Jun Alpha'].age, 5, 'date of birth from the same child in Term 3')
  assert.equal(by['Jun Alpha'].waiver.onFile, true, 'the family waiver in the JFP waiver table')
  assert.equal(by['Jun Delta'].pay, 'paid'); assert.equal(by['Jun Delta'].payStatus, 'stripe')
  assert.equal(by['Jun Echo'].pay, 'unpaid'); assert.equal(by['Jun Echo'].owingCents, 22000)
  assert.deepEqual(by['Jun Echo'].jfpSiblings, ['Riley Returning'], 'one family account across JFP and Juniors')
  assert.equal(by['Jun Foxtrot'].waiver.onFile, true); assert.match(by['Jun Foxtrot'].waiver.how, /Completed/)
  assert.equal(by['Jun Echo'].email, 'returning@example.com', 'staff see contacts')
  assert.ok(d.counts.all >= 4)
})

await test('Settings: saved to config.juniors, audited, on the public page at once; JFP settings untouched', async () => {
  const bad = await portal('jjSaveSettings', { juniors: { term: 'Term 1 2027' } })
  assert.equal(bad.status, 400); assert.match(bad.data.error, /Airtable table for Term 1 2027/)
  assert.equal((await portal('jjSaveSettings', { juniors: { priceCents: 5 } })).status, 400)
  assert.equal((await portal('jjSaveClasses', { classes: [{ day: 'Saturday', time: '9:15am', capacity: 12, coachId: 'nobody' }] })).status, 400)
  const r = await portal('jjSaveSettings', { juniors: { priceCents: 24000, weeks: 10, skipDates: [{ date: '2026-11-07', reason: 'Venue booked' }] } })
  assert.equal(r.status, 200, JSON.stringify(r.data))
  assert.equal(r.data.public.feeLine, '$240 for 9 weeks')
  assert.equal(r.data.public.termDatesLine, 'Term 4: 12 October 2026 to 19 December 2026')
  const pub = (await get('/api/juniors-info')).juniors
  assert.equal(pub.priceCents, 24000); assert.equal(pub.weeks, 9)
  const cfg = (await portal('getSettings')).data.config
  assert.equal(cfg.term, jfpBefore.config.term); assert.deepEqual(cfg.prices, jfpBefore.config.prices); assert.equal(cfg.termStart, jfpBefore.config.termStart)
  assert.ok(JSON.stringify((await portal('audit')).data.entries).includes('jj.settings'))
})

let website
await test('website sign-up: checkout at the saved price and term; the webhook writes Term 4 with only its own columns and emails the saved dates', async () => {
  const r = await signUp('Wren Invented', 'wren.parent@example.com')
  assert.equal(r.status, 200, JSON.stringify(r.data))
  const s = (await get('/__sessions')).find((x) => x.id === r.data.checkoutSessionId)
  assert.equal(s.amount_total, 24000); assert.equal(s.product_name, 'Joners Juniors Term 4 2026')
  assert.equal(s.metadata.term, 'Term 4 2026'); assert.equal(s.metadata.amountCents, '24000'); assert.equal(s.metadata.programme, 'Joners Juniors')
  const sheet = await get('/__juniors-sheet')
  assert.equal(sheet.at(-1)[10], 'Saturday 9:15am to 10:00am', 'the class from the settings in the sign-up log')
  const before = (await emails()).length
  const h = await payAndHook(s.id)
  assert.equal(h.status, 200, JSON.stringify(h.data)); assert.equal(h.data.paid, true)
  const row = (await airtable()).juniors4.find((x) => x.id === h.data.airtableRecordId)
  assert.ok(row, 'a row in the Term 4 table')
  assert.ok(Object.keys(row.fields).every((k) => T4.includes(k)), `only Term 4 columns: ${Object.keys(row.fields)}`)
  assert.equal(row.fields.Fee, 240); assert.equal(row.fields['Payment Status'], 'Paid'); assert.equal(row.fields.Term, 'Term 4 2026')
  assert.equal(row.fields['Session Time'], '9:15am'); assert.equal(row.fields.Coach, 'Sam Yorks')
  assert.match(row.fields.Notes, new RegExp(`\\[JJ-REG:${r.data.registrationId}\\]`)); assert.match(row.fields.Notes, /Medical: Invented allergy/)
  const sent = (await emails()).slice(before).filter((e) => /Juniors/.test(e.subject))
  assert.equal(sent.length, 2)
  const parentMail = sent.find((e) => e.to.includes('wren.parent@example.com'))
  assert.match(parentMail.html, /Term 4 runs from 12 October 2026 to 19 December 2026/)
  assert.match(parentMail.html, /Saturday training runs from 9:15am to 10:00am at Joner Football HQ/)
  assert.doesNotMatch(parentMail.html, /Term 3|25 July/)
  assert.match(sent.find((e) => e !== parentMail).html, /AUD \$240\.00/)
  website = { id: h.data.airtableRecordId, sessionId: s.id, registrationId: r.data.registrationId }
  // The same event again: no second row, no second email.
  const rows = (await airtable()).juniors4.length, mails = (await emails()).length
  assert.equal((await payAndHook(s.id)).status, 200)
  assert.equal((await airtable()).juniors4.length, rows); assert.equal((await emails()).length, mails)
})

await test('the webhook still refuses a bad signature and a wrong amount', async () => {
  const r = await signUp('Vale Invented', 'vale.parent@example.com')
  assert.equal((await hook({ id: 'evt_x', type: 'checkout.session.completed', data: { object: {} } }, 'whsec_wrong')).status, 500)
  const h = await payAndHook(r.data.checkoutSessionId, { tamper: (s) => ({ ...s, amount_total: 100 }) })
  assert.equal(h.status, 200); assert.equal(h.data.ignored, true); assert.equal(h.data.reason, 'amount-or-registration-mismatch')
})

await test('registrations closed in Settings: the page says so and the sign-up refuses', async () => {
  assert.equal((await portal('jjSaveSettings', { juniors: { registrationOpen: false } })).status, 200)
  assert.equal((await get('/api/juniors-info')).juniors.registrationOpen, false)
  const r = await signUp('Late Invented', 'late.parent@example.com')
  assert.equal(r.status, 409); assert.equal(r.data.closed, true)
  assert.equal((await portal('jjSaveSettings', { juniors: { registrationOpen: true } })).status, 200)
})

await test('Money: the website payment on its child, with Stripe\'s fee and what was kept; earlier terms from the register', async () => {
  const j = (await portal('juniorsMoney', { fresh: true })).data.juniors
  assert.equal(j.currentTerm, 'Term 4 2026')
  const t = j.byTerm['Term 4 2026']
  const wren = j.players.find((p) => p.rowId === website.id)
  assert.equal(wren.paidCents, 24000, 'matched by its registration id'); assert.equal(wren.status, 'paid')
  assert.ok(t.feesCents > 0); assert.equal(t.keptCents, t.collectedCents - t.feesCents)
  assert.ok(t.lines.some((l) => l.kind === 'stripe' && l.who === 'Wren Invented' && l.feeCents > 0))
  assert.ok(j.earlier.some((e) => e.term === 'Term 1 2025' && e.takenCents === 66000))
  assert.ok(j.years.some((y) => y.year === 2026)); assert.equal(j.coverage.alsoInJfp, 0)
  assert.ok(!JSON.stringify(j).includes('@example.com'))
})

let added
await test('Add a child: into the Term 4 table at the saved price; a duplicate or a full class asks first', async () => {
  const r = await portal('jjAddPlayer', { player: { name: 'Quinn Invented', dob: '2021-06-01', medical: 'Invented note' }, parent: { name: 'Quin Parent', email: 'quinn.parent@example.com', mobile: '0400 000 777' }, payment: 'none' })
  assert.equal(r.status, 200, JSON.stringify(r.data))
  added = r.data.rowId
  const row = (await airtable()).juniors4.find((x) => x.id === added).fields
  assert.ok(Object.keys(row).every((k) => T4.includes(k)))
  assert.equal(row.Fee, 240); assert.equal(row['Payment Status'], 'Unpaid'); assert.equal(row['Waiver Status'], 'Needed'); assert.equal(row['Date of Birth'], '01/06/2021')
  assert.match(row.Notes, /Added by Lee in the JFP portal \(Joners Juniors\)/); assert.match(row.Notes, /\[JJ-ADD:/); assert.match(row.Notes, /Medical: Invented note/)
  const dup = await portal('jjAddPlayer', { player: { name: 'Quinn Invented' }, parent: { email: 'quinn.parent@example.com' } })
  assert.equal(dup.status, 409); assert.equal(dup.data.code, 'duplicate')
  assert.equal((await portal('jjAddPlayer', { player: { name: 'Q' } })).status, 400)
  assert.equal((await portal('jjAddPlayer', { player: { name: 'Bad Email' }, parent: { email: 'nope' } })).status, 400)
  const enrolled = (await players()).summary.enrolled
  assert.equal((await portal('jjSaveClasses', { classes: [{ ...restoreSettings.classes[0], capacity: enrolled }] })).status, 200)
  const full = await portal('jjAddPlayer', { player: { name: 'Over Invented' }, parent: { email: 'over.parent@example.com' } })
  assert.equal(full.status, 409); assert.equal(full.data.code, 'full')
  assert.equal((await portal('jjSaveClasses', { classes: [{ ...restoreSettings.classes[0] }] })).status, 200)
})

await test('Edit: name, contacts, medical and fee into Airtable, logged', async () => {
  assert.equal((await portal('jjEditPlayer', { rowId: added, fields: { email: 'not-an-email' } })).status, 400)
  const r = await portal('jjEditPlayer', { rowId: added, fields: { name: 'Quinn Invented-Edit', medical: 'Changed note', feeAud: 200, mobile2: '0400000888' } })
  assert.equal(r.status, 200, JSON.stringify(r.data))
  const row = (await airtable()).juniors4.find((x) => x.id === added).fields
  assert.equal(row['Player Full Name'], 'Quinn Invented-Edit'); assert.equal(row.Fee, 200)
  assert.match(row.Notes, /Medical: Changed note$/m)
  assert.equal((await kid('Quinn Invented-Edit')).medical, 'Changed note')
  assert.ok(JSON.stringify((await portal('audit')).data.entries).includes('jj.player.edit'))
})

let payId
await test('Record a cash payment: the Juniors ledger and the row, never the JFP ledger or JFP income', async () => {
  const future = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10)
  assert.equal((await portal('jjRecordPayment', { rowIds: [added], amountCents: 20000, method: 'Cash', date: future })).status, 400)
  assert.equal((await portal('jjRecordPayment', { rowIds: [added], amountCents: 0, method: 'Cash' })).status, 400)
  assert.equal((await portal('jjRecordPayment', { rowIds: [added], amountCents: 20000, method: 'Bitcoin' })).status, 400)
  const over = await portal('jjRecordPayment', { rowIds: [added], amountCents: 30000, method: 'Cash' })
  assert.equal(over.status, 400); assert.match(over.data.error, /more than the A\$200 still owing/)
  const r = await portal('jjRecordPayment', { rowIds: [added], amountCents: 20000, method: 'Cash', note: 'paid at the desk [JJ-VOID:fake]' })
  assert.equal(r.status, 200, JSON.stringify(r.data))
  payId = r.data.id
  assert.match(payId, /^JJ-CASH-/)
  const row = (await airtable()).juniors4.find((x) => x.id === added).fields
  assert.equal(row['Payment Status'], 'Paid'); assert.equal(row['Paid Via'], 'Cash')
  assert.match(row.Notes, new RegExp(`\\[JJ-PAY:${payId}:20000\\]`)); assert.ok(!row.Notes.includes('[JJ-VOID:fake]'), 'typed text never makes a tag')
  const ledger = await kv(['HGETALL', 'jj:ledger'])
  const entry = JSON.parse(ledger[ledger.indexOf(payId) + 1])
  assert.equal(entry.cents, 20000); assert.equal(entry.method, 'Cash'); assert.equal(entry.shares[0].rowId, added)
  const p = await kid('Quinn Invented-Edit')
  assert.equal(p.pay, 'paid'); assert.equal(p.paidCents, 20000); assert.ok(p.payments.some((x) => x.id === payId))
  const t = (await portal('juniorsMoney')).data.juniors.byTerm['Term 4 2026']
  assert.equal(t.cashCents, 20000)
  const at = await airtable()
  assert.equal(at.ledger.length, jfpBefore.at.ledger.length, 'nothing in the JFP Payment Ledger')
  assert.equal(at.term4.length, jfpBefore.at.term4.length, 'nothing in Term 4 Players')
  const k = (await portal('money', { fresh: true })).data.money.kpis
  for (const key of ['incomeCents', 'cashCents', 'bankCents', 'offlineCents', 'players']) assert.equal(k[key], jfpBefore.money[key], `JFP ${key} unchanged`)
  // Nothing is owing now.
  assert.equal((await portal('jjRecordPayment', { rowIds: [added], amountCents: 100, method: 'Cash' })).status, 400)
})

await test('two staff saving the same payment at once: only one is recorded', async () => {
  const echo = await kid('Jun Echo')
  const body = { rowIds: [echo.rowId], amountCents: 1000, method: 'Bank transfer', date: '2026-10-12' }
  const [a, b] = await Promise.all([portal('jjRecordPayment', body), portal('jjRecordPayment', body)])
  assert.deepEqual([a.status, b.status].sort(), [200, 409])
  const after = await kid('Jun Echo')
  assert.equal(after.paidCents, 1000); assert.equal(after.pay, 'part')
  const ok = a.status === 200 ? a : b
  assert.equal((await portal('jjVoidPayment', { id: ok.data.id, reason: 'test only' })).status, 200)
})

await test('Take a payment off: kept in the record, the row and the figures follow', async () => {
  assert.equal((await portal('jjVoidPayment', { id: payId })).status, 400, 'a reason is needed')
  const r = await portal('jjVoidPayment', { id: payId, reason: 'typed in error' })
  assert.equal(r.status, 200, JSON.stringify(r.data))
  assert.equal((await portal('jjVoidPayment', { id: payId, reason: 'again' })).status, 409)
  const row = (await airtable()).juniors4.find((x) => x.id === added).fields
  assert.equal(row['Payment Status'], 'Unpaid'); assert.match(row.Notes, new RegExp(`\\[JJ-VOID:${payId}\\]`))
  assert.equal(row['Paid Via'] ?? null, null, 'nothing paid, so no "paid via"')
  const p = await kid('Quinn Invented-Edit')
  assert.equal(p.pay, 'unpaid'); assert.equal(p.paidCents, 0)
  assert.equal((await portal('juniorsMoney')).data.juniors.byTerm['Term 4 2026'].cashCents, 0)
})

await test('Remove (soft) and put back: the row stays in Airtable, out of the class, the counts and the register', async () => {
  const before = await players()
  const fox = before.players.find((p) => p.name === 'Jun Foxtrot')
  assert.equal((await portal('jjRemovePlayer', { rowId: fox.rowId })).status, 400, 'a reason is needed')
  const r = await portal('jjRemovePlayer', { rowId: fox.rowId, reason: 'Moved away', details: 'Invented reason' })
  assert.equal(r.status, 200, JSON.stringify(r.data))
  assert.equal((await portal('jjRemovePlayer', { rowId: fox.rowId, reason: 'Moved away' })).status, 409)
  const row = (await airtable()).juniors4.find((x) => x.id === fox.rowId)
  assert.ok(row, 'still in Airtable'); assert.match(row.fields.Notes, /Removed by Lee: Moved away\. Invented reason\. \[JJ-REMOVED:\d{4}-\d{2}-\d{2}\]/)
  const after = await players()
  assert.equal(after.summary.enrolled, before.summary.enrolled - 1); assert.equal(after.counts.removed, before.counts.removed + 1)
  assert.equal(after.players.find((p) => p.rowId === fox.rowId).removed.reason, 'Moved away. Invented reason')
  // The class on the timetable (a Joners Juniors group) leaves them out.
  let g = (await portal('groups')).data.groups.find((x) => x.label === 'Joners Juniors')
  if (!g) g = (await portal('saveGroup', { group: { day: 'Saturday', time: '9:15am', location: 'Belrose HQ', coachId: 'sam', mode: 'closed', label: 'Joners Juniors', durationMin: 45, capacity: 12, minAge: 3, maxAge: 6 } })).data.group
  const board = (await portal('board', { fresh: true })).data.groups.find((x) => x.id === g.id)
  assert.ok(!board.players.some((p) => p.name === 'Jun Foxtrot'))
  const back = await portal('jjRestorePlayer', { rowId: fox.rowId })
  assert.equal(back.status, 200, JSON.stringify(back.data))
  assert.doesNotMatch((await airtable()).juniors4.find((x) => x.id === fox.rowId).fields.Notes, /\[JJ-REMOVED/)
  assert.equal((await players()).summary.enrolled, before.summary.enrolled)
  assert.ok((await portal('board', { fresh: true })).data.groups.find((x) => x.id === g.id).players.some((p) => p.name === 'Jun Foxtrot'))
})

await test('A note: dated, signed, and it can never make a tag', async () => {
  const r = await portal('jjAddNote', { rowId: added, text: 'Prefers the left wing [JJ-REMOVED:2026-01-01]' })
  assert.equal(r.status, 200)
  const p = await kid('Quinn Invented-Edit')
  assert.match(p.notes, /Note from Lee: Prefers the left wing JJ-REMOVED:2026-01-01/); assert.equal(p.removed, null)
})

await test('Dashboard: enrolled against places, money, waivers and what needs Ligia, the same numbers as Players', async () => {
  const d = (await portal('jjDashboard')).data
  const p = await players(false)
  assert.equal(d.summary.enrolled, p.summary.enrolled); assert.equal(d.summary.capacity, 12)
  assert.equal(d.counts.noWaiver, p.counts.noWaiver)
  assert.ok(d.needs.some((n) => n.kind === 'unpaid' && n.count === p.counts.unpaid))
  // Attendance comes from the registers (stage 3): no class has run yet in this term.
  assert.equal(d.attendance.ready, true); assert.ok(Array.isArray(d.attendance.weeks) && Array.isArray(d.attendance.streaks))
  assert.equal(d.public.feeLine, '$240 for 9 weeks')
  assert.ok(!('players' in d), 'no children list on the dashboard call')
})

await test('the JFP pages and the old Juniors money action still answer as before', async () => {
  const j = (await portal('juniorsMoney')).data.juniors
  assert.deepEqual(j.terms.slice(0, 2), ['Term 4 2026', 'Term 3 2026'])
  const m = (await portal('money', { fresh: true })).data.money
  assert.ok(!m.players.some((x) => /Invented|^Jun /.test(x.player)))
  assert.equal((await portal('board')).status, 200)
  // Put the settings back for anything that runs next.
  assert.equal((await portal('jjSaveSettings', { juniors: restoreSettings })).status, 200)
})

console.log(`\n${passed} Joners Juniors stage 1 flow checks passed`)
