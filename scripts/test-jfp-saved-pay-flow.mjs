// Saved card or bank account and auto-charge after each session (Lee, 14 Oct
// 2026; claude/card-on-file), end to end against the local harness: fake
// Airtable, fake Stripe (customers, setup intents, payment methods, off
// session payment intents, BECS), captured email and Telegram.
//
// Families save a card or bank account in My account > Fees (consent first),
// then the daily run (and staff "Run now") charges the right dates only:
// skips covered, told-in-time, paused, before-start, prepaid; charges
// no-shows and late notice; a rerun charges nothing twice; a declined card or
// one that needs the cardholder becomes a Pay link and is flagged; BECS goes
// processing then paid (or a Pay link) on the webhook; removing the method
// stops charges; an unclear Stripe answer is tried again with the same key.
//   npm run build && HOLIDAY_LOCAL_PORT=4861 node scripts/holiday-local.mjs   (one terminal)
//   node scripts/test-jfp-saved-pay-flow.mjs 4861                            (another)
// Every name, email and amount here is invented.
import assert from 'node:assert/strict'

const PORT = Number(process.argv[2] || 4321)
const B = `http://localhost:${PORT}`
let passed = 0
async function test(name, fn) { await fn(); passed += 1; console.log(`ok - ${name}`) }

let ipSeq = 20
function client() {
  const jar = new Map()
  const ip = `10.9.7.${ipSeq++}`
  const call = async (path, body) => {
    const res = await fetch(`${B}${path}`, { method: body ? 'POST' : 'GET', redirect: 'manual', headers: { 'content-type': 'application/json', origin: B, 'x-forwarded-for': ip, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') }, body: body ? JSON.stringify(body) : undefined })
    for (const c of res.headers.getSetCookie?.() || []) { const [kv] = c.split(';'); const i = kv.indexOf('='); if (kv.slice(i + 1)) jar.set(kv.slice(0, i), kv.slice(i + 1)); else jar.delete(kv.slice(0, i)) }
    return { status: res.status, data: await res.json().catch(() => ({})) }
  }
  return { call }
}
const getJson = async (path) => (await fetch(`${B}${path}`)).json()
const emails = () => getJson('/__emails')
const at = () => getJson('/__airtable')
const pis = () => getJson('/__stripe-pis')
const kv = async (cmd) => (await fetch(`${B}/__kv?cmd=${encodeURIComponent(JSON.stringify(cmd))}`)).text()
const patch = async (id, fields) => { const r = await fetch(`${B}/__patch?table=term4&id=${id}&fields=${encodeURIComponent(JSON.stringify(fields))}`); assert.equal(r.status, 200) }
const row = async (id) => (await at()).term4.find((r) => r.id === id).fields
const payreq = async (id) => JSON.parse(await kv(['GET', `jfp:payreq:${id}`]) || 'null')
const rec = async (rowId, date) => JSON.parse(await kv(['GET', `jfp:autocharge:${rowId}:${date}`]) || 'null')
const ledgerFor = async (rowId) => (await at()).ledger.filter((l) => String(l.fields['Source Record ID'] || '').includes(rowId))
const bust = () => kv(['SET', 'jfp:roster-cleared', String(Date.now())])
async function signIn(c, email, audience = 'parent') {
  const s = await c.call('/api/jfp-auth', { action: 'start', email, audience })
  assert.equal(s.status, 200, JSON.stringify(s.data))
  const code = (await emails()).filter((e) => e.to.includes(email) && /sign-in code/.test(e.subject)).at(-1).subject.match(/(\d{6})/)[1]
  assert.equal((await c.call('/api/jfp-auth', { action: 'verify', challenge: s.data.challenge, code })).status, 200)
}

// Sydney 10:30 on 5 Nov 2026 (AEDT): yesterday was Wed 4 Nov; the lookback
// reaches back to 22 Oct, so the Wednesday sessions charged are 28 Oct and 4 Nov.
const NOV5 = Date.parse('2026-11-05T10:30:00+11:00')
const NOV12 = Date.parse('2026-11-12T10:30:00+11:00')
const D1 = '2026-10-28', D2 = '2026-11-04', D3 = '2026-11-11'

const lee = client()
await signIn(lee, 'leejones@jonerfootball.com', 'staff')
const portal = async (action, body = {}) => lee.call('/api/jfp-portal-data', { action, ...body })
const ok = async (action, body = {}) => { const r = await portal(action, body); assert.equal(r.status, 200, `${action}: ${JSON.stringify(r.data)}`); return r.data }
const GROUP = (await ok('saveGroup', { group: { day: 'Wednesday', time: '5:00pm', location: 'NTRA', coachId: 'lee', capacity: 20, mode: 'direct', label: 'Small group' } })).group.id

let seq = 0
async function addSession(name, email, { pro = false, per = 5000 } = {}) {
  seq += 1
  const r = await ok('addPlayer', { groupId: GROUP, force: true, player: { name, dob: `2012-03-${String(seq).padStart(2, '0')}` }, parent: { name: `Parent ${name.split(' ')[1]}`, email, mobile: `0400 777 ${String(100 + seq)}` }, payment: pro ? 'pro' : 'sessions', perSessionCents: per })
  return r.rowId
}
// The family signs in, ticks the consent and saves a method on the mock Stripe page (pm: card|declined|3ds|becs).
async function saveMethod(email, kind = 'card', pm = kind === 'bank' ? 'becs' : 'card') {
  const c = client()
  await signIn(c, email)
  const v = await c.call('/api/jfp-account', { action: 'savedPay' })
  assert.equal(v.status, 200, JSON.stringify(v.data))
  const s = await c.call('/api/jfp-account', { action: 'savedPaySetup', kind, agree: true })
  assert.equal(s.status, 200, JSON.stringify(s.data))
  const back = await fetch(`${s.data.url}&action=pay&pm=${pm}`, { redirect: 'manual' })
  const sid = new URL(back.headers.get('location')).searchParams.get('saved')
  assert.match(sid, /^cs_test_/)
  const conf = await c.call('/api/jfp-account', { action: 'savedPayConfirm', sessionId: sid })
  assert.equal(conf.status, 200, JSON.stringify(conf.data))
  return { c, sid, method: conf.data.method }
}

const rows = {}
await test('setup: session by session players (JFP and Pro) in a Wednesday 5pm group', async () => {
  rows.cara = await addSession('Cara Card', 'cara.card@example.com')
  rows.dex = await addSession('Dex Declined', 'dex.declined@example.com', { pro: true, per: 10000 })
  rows.bea = await addSession('Bea Bank', 'bea.bank@example.com', { per: 6000 })
  rows.cody = await addSession('Cody Covered', 'cody.covered@example.com')
  rows.nia = await addSession('Nia Noshow', 'nia.noshow@example.com')
  rows.sam = await addSession('Sam Starter', 'sam.starter@example.com')
  rows.pip = await addSession('Pip Paused', 'pip.paused@example.com', { pro: true, per: 10000 })
  rows.rhys = await addSession('Rhys Removed', 'rhys.removed@example.com')
  rows.ula = await addSession('Ula Undated', 'ula.undated@example.com')
  rows.tia = await addSession('Tia Threeds', 'tia.threeds@example.com')
  rows.una = await addSession('Una Unsure', 'una.unsure@example.com')
  rows.nobody = await addSession('Noel Nocard', 'noel.nocard@example.com')
  assert.equal((await row(rows.cara))['Term 4 Payment Type'], 'JFP Session by session')
  assert.equal((await row(rows.dex))['Term 4 Payment Type'], 'JFP Pro sessions')
})

await test('Fees: consent is required, then Stripe setup mode; the card is saved (brand and last 4 only), with the consent wording and version', async () => {
  const c = client()
  await signIn(c, 'cara.card@example.com')
  const v = (await c.call('/api/jfp-account', { action: 'savedPay' })).data.saved
  assert.equal(v.method, null)
  assert.equal(v.consent.card, "I authorise Joner Football to charge this card for my player's session by session fees and the extra sessions booked for them, after each session they attend or miss without notice, at the agreed price, until I remove it.")
  assert.match(v.consent.becsMandate, /Direct Debit Request/)
  assert.deepEqual(v.players.map((p) => [p.name, p.perLabel]), [['Cara Card', 'A$50']])
  assert.ok(!/—/.test(JSON.stringify(v)), 'no em dashes in family copy')
  const no = await c.call('/api/jfp-account', { action: 'savedPaySetup', kind: 'card' })
  assert.equal(no.status, 400); assert.equal(no.data.code, 'consent')
  const s = await c.call('/api/jfp-account', { action: 'savedPaySetup', kind: 'card', agree: true })
  assert.equal(s.status, 200, JSON.stringify(s.data))
  const sess = (await getJson('/__sessions')).find((x) => s.data.url.includes(x.id))
  assert.equal(sess.mode, 'setup'); assert.deepEqual(sess.payment_method_types, ['card']); assert.match(sess.customer, /^cus_test_/)
  const back = await fetch(`${s.data.url}&action=pay&pm=card`, { redirect: 'manual' })
  const sid = new URL(back.headers.get('location')).searchParams.get('saved')
  // The webhook already saved it; the return page finds it saved.
  const conf = await c.call('/api/jfp-account', { action: 'savedPayConfirm', sessionId: sid })
  assert.equal(conf.status, 200, JSON.stringify(conf.data))
  assert.equal(conf.data.method.label, 'Visa ending 4242')
  const m = JSON.parse(await kv(['GET', 'jfp:savedpay:method:cara.card@example.com']))
  assert.match(m.pmId, /^pm_test_/); assert.equal(m.last4, '4242'); assert.equal(m.consent.version, 'jfp-auto-charge-v2 (14 Oct 2026)')
  assert.match(m.consent.text, /I authorise Joner Football to charge this card/); assert.ok(m.consent.at)
  assert.ok(!JSON.stringify(m).includes('4242424242'), 'no card number kept')
  const after = (await c.call('/api/jfp-account', { action: 'savedPay' })).data.saved
  assert.equal(after.method.label, 'Visa ending 4242'); assert.equal(after.mine, true)
  assert.ok((await emails()).some((e) => e.to.includes('cara.card@example.com') && /Visa ending 4242 saved for session payments/.test(e.subject)))
  // Another family cannot confirm this setup page.
  const other = client(); await signIn(other, 'noel.nocard@example.com')
  assert.equal((await other.call('/api/jfp-account', { action: 'savedPayConfirm', sessionId: sid })).status, 404)
  // One Stripe customer per email, reused.
  const again = await c.call('/api/jfp-account', { action: 'savedPaySetup', kind: 'card', agree: true })
  const sess2 = (await getJson('/__sessions')).find((x) => again.data.url.includes(x.id))
  assert.equal(sess2.customer, sess.customer)
})

await test('the other families save theirs: a declined card, a bank account (BECS mandate stored), cards for the rest', async () => {
  await saveMethod('dex.declined@example.com', 'card', 'declined')
  const b = await saveMethod('bea.bank@example.com', 'bank')
  assert.equal(b.method.label, 'Bank account ending 3456'); assert.equal(b.method.kind, 'bank')
  const bm = JSON.parse(await kv(['GET', 'jfp:savedpay:method:bea.bank@example.com']))
  assert.match(bm.consent.mandate, /Direct Debit Request/); assert.match(bm.mandateId, /^mandate_test_/); assert.equal(bm.bsbStart, '062')
  assert.ok(!JSON.stringify(bm).includes('062000'), 'only the first 3 of the BSB')
  for (const e of ['cody.covered', 'nia.noshow', 'sam.starter', 'pip.paused', 'rhys.removed', 'ula.undated', 'una.unsure']) await saveMethod(`${e}@example.com`)
  await saveMethod('tia.threeds@example.com', 'card', '3ds')
})

let cody = null
await test('the special cases are set up: covered date, told in time, register absent, late notice, start date, paused, removed, undated prepaid', async () => {
  // Cody: 28 Oct is covered by a commitment; told us about 4 Nov weeks ahead.
  await patch(rows.cody, { 'Term 4 Notes': `${(await row(rows.cody))['Term 4 Notes']} [PREPAID:1] [COVERED:${D1}]` })
  cody = (await saveMethod('cody.covered@example.com')).c
  await bust()
  const cx = await cody.call('/api/jfp-account', { action: 'cancelSession', rowId: rows.cody, date: D2, reason: 'school' })
  assert.equal(cx.status, 200, JSON.stringify(cx.data))
  // Nia: marked absent on 28 Oct (no notice), and told us 2 hours before 4 Nov.
  await kv(['HSET', `jfp:att:${GROUP}:${D1}`, rows.nia, 'Absent'])
  await kv(['HSET', 'jfp:cancels', 'CXL-TESTLATE00000001', JSON.stringify({ id: 'CXL-TESTLATE00000001', status: 'active', email: 'nia.noshow@example.com', rowId: rows.nia, player: 'Nia Noshow', groupId: GROUP, date: D2, noticeMinutes: 120, noticeLevel: 'very-late', noticeLabel: 'late: 2 h', submittedAt: '2026-11-04T04:00:00.000Z' })])
  // Sam starts on 4 Nov; Ula has one undated prepaid session; Pip is paused.
  await patch(rows.sam, { 'Term 4 Notes': `${(await row(rows.sam))['Term 4 Notes']} [STARTS:${D2}]` })
  await patch(rows.ula, { 'Term 4 Notes': `${(await row(rows.ula))['Term 4 Notes']} [PREPAID:1]` })
  await bust()
  assert.equal((await ok('autoChargePause', { rowId: rows.pip, paused: true })).paused, true)
  // Rhys removes his card: nothing is charged.
  const rhys = client(); await signIn(rhys, 'rhys.removed@example.com')
  assert.equal((await rhys.call('/api/jfp-account', { action: 'savedPayRemove' })).status, 200)
  assert.equal((await rhys.call('/api/jfp-account', { action: 'savedPay' })).data.saved.method, null)
  const pm = (await getJson('/__stripe-saved')).paymentMethods.find((x) => x.card?.last4 === '4242' && x.customer === null)
  assert.ok(pm, 'detached at Stripe')
})

let preview = null
await test('staff preview (dry run): who, date, amount, method, and every skip reason; nothing is charged', async () => {
  const before = (await pis()).length
  preview = await ok('autoChargePanel', { now: NOV5 })
  const p = (name, date) => preview.preview.find((x) => x.player === name && x.date === date)
  assert.equal(p('Cara Card', D1).action, 'charge'); assert.equal(p('Cara Card', D1).amountLabel, 'A$50'); assert.equal(p('Cara Card', D1).method, 'Visa ending 4242')
  assert.equal(p('Cara Card', D2).action, 'charge')
  assert.equal(p('Dex Declined', D1).amountLabel, 'A$100'); assert.equal(p('Dex Declined', D1).programme, 'pro')
  assert.equal(p('Bea Bank', D1).method, 'Bank account ending 3456')
  assert.equal(p('Cody Covered', D1).reason, 'covered')
  assert.equal(p('Cody Covered', D2).reason, 'told'); assert.match(p('Cody Covered', D2).reasonLabel, /^Told us in time \(\d+ h notice\)$/)
  assert.equal(p('Nia Noshow', D1).action, 'charge'); assert.match(p('Nia Noshow', D1).note, /absent with no notice/); assert.equal(p('Nia Noshow', D1).register, 'Absent')
  assert.equal(p('Nia Noshow', D2).action, 'charge'); assert.match(p('Nia Noshow', D2).note, /Told us late/)
  assert.equal(p('Sam Starter', D1), undefined, 'before the start date: not listed')
  assert.equal(p('Sam Starter', D2).action, 'charge')
  assert.equal(p('Pip Paused', D1).reason, 'paused')
  assert.equal(p('Rhys Removed', D1), undefined, 'no saved method: not listed')
  assert.equal(p('Noel Nocard', D1), undefined)
  assert.equal(p('Ula Undated', D1).reason, 'prepaid'); assert.equal(p('Ula Undated', D2).action, 'charge')
  assert.ok(!preview.preview.some((x) => x.date === '2026-10-14' || x.date === '2026-10-21'), 'never before the card was saved or beyond the lookback')
  assert.ok(!preview.preview.some((x) => x.date >= '2026-11-05'), 'never a session still to come')
  assert.equal((await pis()).length, before, 'a preview charges nothing')
  assert.equal(await rec(rows.cara, D1), null)
  // Coaches cannot see or run it.
  const coach = client()
  assert.notEqual((await coach.call('/api/jfp-portal-data', { action: 'autoChargeRun', confirm: true })).status, 200)
})

await test('the cron waits until 10:00 Sydney; a run needs the cron secret', async () => {
  const early = await fetch(`${B}/api/jfp-groups?autoCharge=1&now=${Date.parse('2026-11-05T09:30:00+11:00')}`, { headers: { authorization: 'Bearer local-cron-secret' } })
  assert.equal((await early.json()).waiting, true)
  const anon = await fetch(`${B}/api/jfp-groups?autoCharge=1&now=${NOV5}`)
  assert.equal(anon.status, 401)
  assert.equal((await pis()).length, 0)
})

await test('the daily run: right dates charged, receipts sent, rows paid and in the ledger; covered, told, paused, prepaid settled', async () => {
  // Una's charge: Stripe takes it but the answer never arrives.
  await fetch(`${B}/__fail?what=${encodeURIComponent(`stripe-pi:${rows.una}`)}&on=1`)
  const res = await fetch(`${B}/api/jfp-groups?autoCharge=1&now=${NOV5}`, { headers: { authorization: 'Bearer local-cron-secret' } })
  const out = await res.json()
  assert.equal(res.status, 200, JSON.stringify(out))
  // Cara: both dates paid, A$50 each, off session, tied to the request, the row, the date, JFP.
  for (const d of [D1, D2]) {
    const r = await rec(rows.cara, d)
    assert.equal(r.status, 'succeeded', JSON.stringify(r))
    const q = await payreq(r.payreqId)
    assert.equal(q.status, 'paid'); assert.equal(q.reason, 'sessions'); assert.equal(q.autoCharge.date, d); assert.match(q.stripePaymentIntentId, /^pi_test_/)
    const pi = (await pis()).find((x) => x.id === q.stripePaymentIntentId)
    assert.equal(pi.amount, 5000); assert.equal(pi.off_session, true); assert.equal(pi.metadata.jfpBookingId, q.id); assert.equal(pi.metadata.jfpAutoCharge, '1'); assert.equal(pi.metadata.jfpDate, d); assert.equal(pi.metadata.jfpRowId, rows.cara); assert.equal(pi.metadata.jfpProgramme, 'jfp')
  }
  const f = await row(rows.cara)
  assert.equal(f['Term 4 Fee'], 100); assert.equal(f['Term 4 Amount Paid'], 100); assert.equal(f['Term 4 Payment Status'], 'Paid')
  assert.match(f['Term 4 Notes'], new RegExp(`Auto-charge for the session on ${D1}`))
  assert.equal((await ledgerFor(rows.cara)).length, 2, 'one ledger line per session')
  const receipts = (await emails()).filter((e) => e.to.includes('cara.card@example.com') && /^Session paid: Cara Card/.test(e.subject))
  assert.equal(receipts.length, 2)
  assert.ok(!receipts.some((e) => /—/.test(e.html)), 'no em dashes in family emails')
  // Cody: nothing charged; both settled with their reasons.
  assert.equal((await rec(rows.cody, D1)).reason, 'covered'); assert.equal((await rec(rows.cody, D2)).reason, 'told')
  assert.equal((await row(rows.cody))['Term 4 Amount Paid'] || 0, 0)
  // Nia: the no-show and the late notice are both charged.
  assert.equal((await rec(rows.nia, D1)).status, 'succeeded'); assert.equal((await rec(rows.nia, D2)).status, 'succeeded')
  // Sam: only from the start date.
  assert.equal(await rec(rows.sam, D1), null); assert.equal((await rec(rows.sam, D2)).status, 'succeeded')
  // Pip: paused, settled as not charged.
  assert.equal((await rec(rows.pip, D1)).reason, 'paused'); assert.equal((await rec(rows.pip, D2)).reason, 'paused')
  // Ula: the undated prepaid session comes off on 28 Oct, then 4 Nov is charged.
  assert.equal((await rec(rows.ula, D1)).reason, 'prepaid'); assert.equal((await rec(rows.ula, D2)).status, 'succeeded')
  assert.doesNotMatch((await row(rows.ula))['Term 4 Notes'], /\[PREPAID:1\]/)
  // Rhys (removed his card) and Noel (none): nothing.
  assert.equal(await rec(rows.rhys, D1), null); assert.equal(await rec(rows.nobody, D1), null)
  // The Pro charge says Pro.
  assert.equal((await payreq((await rec(rows.dex, D1)).payreqId)).programme, 'pro')
  // Una: uncertain, not a Pay link and no email; asked again next run.
  const u = await rec(rows.una, D1)
  assert.equal(u.status, 'uncertain', JSON.stringify(u))
  assert.equal((await payreq(u.payreqId)).status, 'charging')
  assert.ok(!(await emails()).some((e) => e.to.includes('una.unsure@example.com') && /Please pay/.test(e.subject)))
  // Staff are told once on Telegram.
  const tg = (await getJson('/__telegram')).filter((t) => /JFP auto-charge 2026-11-05/.test(t.text))
  assert.equal(tg.length, 1); assert.match(tg[0].text, /Charged \d+/); assert.match(tg[0].text, /Dex Declined/)
})

await test('declined card: the request becomes a Pay link, the family is emailed it, staff see it flagged; the Pay link is on Home', async () => {
  for (const d of [D1, D2]) {
    const r = await rec(rows.dex, d)
    assert.equal(r.status, 'failed'); assert.match(r.error, /Declined/)
    const q = await payreq(r.payreqId)
    assert.equal(q.status, 'open'); assert.match(q.needsAttention, /auto-charge-failed/); assert.equal(q.autoCharge.failed.code, 'generic_decline')
  }
  const mail = (await emails()).filter((e) => e.to.includes('dex.declined@example.com') && /Please pay for Dex Declined's session/.test(e.subject))
  assert.ok(mail.length >= 1); assert.match(mail[0].html, /jfp-account\/\?pay=PAY-/)
  assert.equal((await row(rows.dex))['Term 4 Fee'] >= 100, true, 'the session is on the fee, owing')
  const panel = await ok('autoChargePanel', { now: NOV5 })
  assert.ok(panel.needsLook.some((x) => x.player === 'Dex Declined' && x.status === 'failed'))
  // The family pays the link in My account like any other.
  const dex = client(); await signIn(dex, 'dex.declined@example.com')
  const ov = (await dex.call('/api/jfp-account', { action: 'overview' })).data
  const todo = ov.todo.find((t) => t.reason === 'sessions')
  assert.ok(todo, 'the Pay link is on Home')
})

await test('needs the cardholder (3D Secure): never left open at Stripe, Pay link emailed, flagged as needing the cardholder', async () => {
  const r = await rec(rows.tia, D1)
  assert.equal(r.status, 'action'); assert.match(r.error, /cardholder/)
  const pi = (await pis()).find((x) => x.id === r.intentId)
  assert.equal(pi.status, 'canceled', 'the payment waiting on the cardholder was closed')
  assert.equal((await payreq(r.payreqId)).status, 'open')
  assert.ok((await emails()).some((e) => e.to.includes('tia.threeds@example.com') && /Please pay/.test(e.subject) && /confirm the payment yourself/.test(e.html)))
})

await test('BECS: processing first (no Pay link, not owing yet), paid when the debit clears; a failed debit becomes a Pay link', async () => {
  const r1 = await rec(rows.bea, D1), r2 = await rec(rows.bea, D2)
  const proc = [r1, r2].filter((r) => r.status === 'processing')
  assert.equal(proc.length, 2, JSON.stringify([r1, r2]))
  for (const r of proc) {
    const q = await payreq(r.payreqId)
    assert.equal(q.status, 'processing')
    const pi = (await pis()).find((x) => x.id === r.intentId)
    assert.equal(pi.payment_method_types[0], 'au_becs_debit'); assert.match(pi.mandate, /^mandate_test_/)
  }
  assert.ok((await emails()).some((e) => e.to.includes('bea.bank@example.com') && /Direct debit for Bea Bank's session/.test(e.subject)))
  // Not owing on the account while it clears.
  const bea = client(); await signIn(bea, 'bea.bank@example.com')
  const ov = (await bea.call('/api/jfp-account', { action: 'overview' })).data
  assert.ok(!ov.owed.some((x) => x.rowId === rows.bea && x.kind === 'sessions'), 'nothing to pay while the debit clears')
  // The first clears (twice: Stripe retries), the second fails.
  const ok1 = await fetch(`${B}/__becs?pi=${proc[0].intentId}&outcome=succeeded&twice=1`); assert.equal(ok1.status, 200)
  const done = await rec(rows.bea, proc[0].date)
  assert.equal(done.status, 'succeeded')
  assert.equal((await payreq(done.payreqId)).status, 'paid')
  assert.equal((await ledgerFor(rows.bea)).length, 1, 'recorded once')
  assert.equal((await emails()).filter((e) => e.to.includes('bea.bank@example.com') && /^Session paid: Bea Bank/.test(e.subject)).length, 1)
  {
    await fetch(`${B}/__becs?pi=${proc[1].intentId}&outcome=failed`)
    const bad = await rec(rows.bea, proc[1].date)
    assert.equal(bad.status, 'failed')
    assert.equal((await payreq(bad.payreqId)).status, 'open')
    assert.ok((await emails()).some((e) => e.to.includes('bea.bank@example.com') && /Please pay/.test(e.subject)))
  }
  const f = await row(rows.bea)
  assert.equal(f['Term 4 Amount Paid'], 60)
})

await test('a rerun charges nothing twice; the uncertain one is asked again with the same key and charged once', async () => {
  const before = (await pis()).length
  const again = await ok('autoChargeRun', { confirm: true, now: NOV5 })
  assert.equal(again.summary.charged, 1, `only the uncertain one: ${JSON.stringify(again.done)}`)
  assert.equal((await pis()).length, before, 'the same Stripe request, no new payment')
  for (const [, id] of Object.entries(rows)) for (const d of [D1, D2]) { const r = await rec(id, d); if (r) assert.notEqual(r.status, 'uncertain') }
  const third = await ok('autoChargeRun', { confirm: true, now: NOV5 })
  assert.equal(third.summary.charged, 0); assert.equal(third.summary.failed, 0)
  // Every Stripe charge is unique per player and date.
  const keys = (await pis()).map((p) => `${p.metadata.jfpRowId}|${p.metadata.jfpDate}`)
  assert.equal(new Set(keys).size, keys.length, 'one Stripe payment per player and date')
  // A card success webhook arriving late changes nothing.
  const cr = await rec(rows.cara, D1)
  await fetch(`${B}/__pi-webhook?pi=${cr.intentId}`)
  assert.equal((await ledgerFor(rows.cara)).length, 2)
})

// ---------- round 2: extra sessions, analysis and invoices, emails, coach amounts ----------
const dean = client()
// A coach login from the default coach list (the same one test-jfp-extra uses).
const COACH_EMAIL = (await ok('board')).coaches.find((c) => c.id === 'dean').email
await signIn(dean, COACH_EMAIL, 'staff')
const coach = async (action, body = {}) => dean.call('/api/jfp-portal-data', { action, ...body })
const XDAY = '2026-11-11'
let slot = null, niaExtra = null, noelExtra = null
await test('coaches never send an amount: a price they type is refused or ignored on every path; money actions are admin only', async () => {
  assert.equal((await coach('extraSave', { slot: { date: XDAY, time: '4:00pm', capacity: 3, location: 'Belrose HQ', priceCents: 99 } })).status, 400, 'a coach cannot type a price')
  const pr = await ok('extraPrices', { add: { label: 'Extra session 1 hour', dollars: '120', durationMin: 60 } })
  const priceId = pr.prices.at(-1).id
  const made = await coach('extraSave', { slot: { date: XDAY, time: '4:00pm', capacity: 3, location: 'Belrose HQ', priceId, priceCents: 99, amountCents: 99, visibility: 'private' } })
  assert.equal(made.status, 200, JSON.stringify(made.data))
  slot = made.data.slot
  assert.equal(slot.priceCents, 12000, "the coach's typed price is ignored: Lee's price list")
  const a = await coach('extraAttach', { slotId: slot.id, rowId: rows.nia, amountCents: 1, priceCents: 1 })
  assert.equal(a.status, 200, JSON.stringify(a.data))
  niaExtra = await payreq(a.data.booking.payreqId)
  assert.equal(niaExtra.amountCents, 12000, 'the charge is the session price, never an amount a coach sends')
  const b = await coach('extraAttach', { slotId: slot.id, rowId: rows.nobody, amountCents: 5 })
  noelExtra = await payreq(b.data.booking.payreqId)
  assert.equal(noelExtra.amountCents, 12000)
  for (const [action, body] of [['createCharge', { rowId: rows.nia, kind: 'analysis', amountCents: 5 }], ['chargeSavedPay', { chargeId: niaExtra.charge.id, confirm: true }], ['chargeRecord', { id: niaExtra.charge.id, method: 'cash', amountCents: 5 }], ['autoChargeRun', { confirm: true }], ['autoChargePause', { rowId: rows.nia, paused: true }], ['savedPayFor', { chargeIds: [niaExtra.charge.id] }], ['invoiceSave', { programme: 'other', rowIds: [rows.nia], lines: [{ description: 'x', qty: 1, unitCents: 5 }] }]]) {
    assert.equal((await coach(action, body)).status, 403, `${action} is admin only`)
  }
  assert.equal((await payreq(niaExtra.id)).amountCents, 12000)
})

await test('the family is emailed "You have a payment to make": saved card says it will be charged after the session; no card says pay; no coach names', async () => {
  const all = await emails()
  const nia = all.filter((e) => e.to.includes('nia.noshow@example.com') && e.subject === 'You have a payment to make')
  assert.equal(nia.length, 1)
  assert.match(nia[0].html, /it will be charged to your saved card ending 4242 after the session/)
  assert.match(nia[0].html, /A\$120/)
  const noel = all.filter((e) => e.to.includes('noel.nocard@example.com') && e.subject === 'You have a payment to make')
  assert.equal(noel.length, 1); assert.match(noel[0].html, /Pay A\$120/); assert.match(noel[0].html, /jfp-account\/\?pay=PAY-/)
  // No coach names: the session's coach (from the coach list) is nowhere in the email.
  const coachNames = (await ok('board')).coaches.filter((c) => c.id === slot.coachId).flatMap((c) => [c.name, c.firstName].filter(Boolean))
  assert.ok(coachNames.length)
  for (const e of [...nia, ...noel]) { for (const n of coachNames) assert.ok(!e.html.includes(n), 'no coach name'); assert.doesNotMatch(e.html, /Coach /); assert.doesNotMatch(e.html, /—/) }
  // Attaching again (a retry) sends nothing more.
  await coach('extraAttach', { slotId: slot.id, rowId: rows.nia })
  assert.equal((await emails()).filter((e) => e.to.includes('nia.noshow@example.com') && e.subject === 'You have a payment to make').length, 1)
})

let analysis = null
await test('video analysis: never auto-charged; "Charge saved card" (confirm) charges it and records the payment on the charge with the intent id', async () => {
  const c = await ok('createCharge', { rowId: rows.ula, kind: 'analysis', amountCents: 9900, label: 'Video analysis' })
  analysis = c.charge
  assert.equal(c.emailed, true)
  const mail = (await emails()).filter((e) => e.to.includes('ula.undated@example.com') && e.subject === 'You have a payment to make').at(-1)
  assert.match(mail.html, /Pay A\$99/, 'analysis is paid with the link (no auto-charge words)')
  assert.doesNotMatch(mail.html, /charged to your saved/)
  const f = await ok('savedPayFor', { chargeIds: [analysis.id, noelExtra.charge.id] })
  assert.equal(f.charges[analysis.id].button, 'Charge saved card'); assert.equal(f.charges[analysis.id].label, 'Visa ending 4242'); assert.equal(f.charges[analysis.id].amountLabel, 'A$99')
  assert.equal(f.charges[noelExtra.charge.id], undefined, 'no saved method, no button')
  assert.equal((await portal('chargeSavedPay', { chargeId: analysis.id })).status, 400, 'confirm first')
  const r = await ok('chargeSavedPay', { chargeId: analysis.id, confirm: true, amountCents: 1 })
  assert.equal(r.result, 'succeeded'); assert.equal(r.amountLabel, 'A$99', 'the amount comes from the charge, never the request')
  const ch = JSON.parse(await kv(['GET', `jfp:charge:${analysis.id}`]))
  assert.equal(ch.status, 'paid'); assert.equal(ch.payments[0].method, 'stripe'); assert.match(ch.payments[0].intentId, /^pi_test_/); assert.equal(ch.payments[0].cents, 9900)
  const pi = (await pis()).find((x) => x.id === ch.payments[0].intentId)
  assert.equal(pi.amount, 9900); assert.equal(pi.metadata.jfpCharge, analysis.id)
  assert.equal((await portal('chargeSavedPay', { chargeId: analysis.id, confirm: true })).status, 409, 'never twice')
  assert.ok((await emails()).some((e) => e.to.includes('ula.undated@example.com') && /Payment received/.test(e.subject)))
  const ula = client(); await signIn(ula, 'ula.undated@example.com')
  const fees = (await ula.call('/api/jfp-account', { action: 'fees' })).data.fees
  assert.ok(fees.records.some((x) => x.amountCents === 9900 && x.method === 'Card'), JSON.stringify(fees.records))
  const xm = await ok('extraMoney')
  assert.ok(xm.extra.lines.some((x) => x.chargeId === analysis.id && x.kind === 'stripe' && x.takenCents === 9900), 'Money > Extra sessions has it as a Stripe payment')
})

await test('invoices: "Charge by direct debit" on an Other invoice (BECS, paid when it clears), "Charge saved card" on a JFP invoice for a place', async () => {
  const d = await ok('invoiceSave', { programme: 'other', rowIds: [rows.bea], lines: [{ description: 'Kit and bag', qty: 1, unitCents: 4400 }] })
  assert.match(d.invoice.id, /^INV-1\d{3,}$/, 'numbers from 1001')
  const sent = await ok('invoiceSend', { id: d.invoice.id, sendEmail: false })
  const f = await ok('savedPayFor', { invoiceIds: [d.invoice.id] })
  assert.equal(f.invoices[d.invoice.id].button, 'Charge by direct debit')
  const r = await ok('chargeSavedPay', { invoiceId: d.invoice.id, confirm: true })
  assert.equal(r.result, 'processing')
  const pi = (await pis()).filter((x) => x.metadata.jfpInvoice === d.invoice.id)
  assert.equal(pi.length, 1)
  await fetch(`${B}/__becs?pi=${pi[0].id}&outcome=succeeded`)
  const inv = (await ok('invoiceGet', { id: d.invoice.id })).invoice
  assert.equal(inv.status, 'paid', JSON.stringify(inv))
  const ch = JSON.parse(await kv(['GET', `jfp:charge:${sent.invoice.chargeId}`]))
  assert.equal(ch.payments[0].intentId, pi[0].id)
  // A JFP invoice for Ula's place, by card: the row is paid and Money's Stripe list has it.
  const j = await ok('invoiceSave', { programme: 'jfp', rowIds: [rows.ula], lines: [{ description: 'Holiday catch up', qty: 1, unitCents: 3000 }] })
  await ok('invoiceSend', { id: j.invoice.id, sendEmail: false })
  const before = (await row(rows.ula))['Term 4 Amount Paid'] || 0
  assert.equal((await ok('chargeSavedPay', { invoiceId: j.invoice.id, confirm: true })).result, 'succeeded')
  assert.equal((await ok('invoiceGet', { id: j.invoice.id })).invoice.status, 'paid')
  assert.equal((await row(rows.ula))['Term 4 Amount Paid'], before + 30)
})

await test('pause works and turning it back on charges only the sessions after; removing the method stops charges', async () => {
  assert.equal((await ok('autoChargePause', { rowId: rows.pip, paused: false })).paused, false)
  // Cara removes her card before the next session.
  const cara = client(); await signIn(cara, 'cara.card@example.com')
  assert.equal((await cara.call('/api/jfp-account', { action: 'savedPayRemove' })).status, 200)
  const r = await ok('autoChargeRun', { confirm: true, now: NOV12 })
  assert.equal((await rec(rows.pip, D3)).status, 'succeeded')
  assert.equal((await rec(rows.pip, D1)).reason, 'paused', 'paused sessions stay not charged')
  assert.equal(await rec(rows.cara, D3), null, 'no saved method: not charged')
  assert.equal((await rec(rows.cody, D3)).status, 'succeeded', 'the next session after the covered and told ones is charged')
  assert.ok(r.summary.charged >= 3)
  // Nia's extra session (11 Nov) is charged the day after, A$120, on the charge; Noel (no card) still has his Pay link.
  const xr = await rec(niaExtra.charge.id, XDAY)
  assert.equal(xr.status, 'succeeded', JSON.stringify(xr))
  const xc = JSON.parse(await kv(['GET', `jfp:charge:${niaExtra.charge.id}`]))
  assert.equal(xc.status, 'paid'); assert.equal(xc.payments[0].cents, 12000); assert.equal(xc.payments[0].intentId, xr.intentId)
  assert.equal((await payreq(niaExtra.id)).status, 'paid')
  assert.equal((await payreq(noelExtra.id)).status, 'open')
  assert.equal((await pis()).filter((p) => p.metadata.jfpCharge === niaExtra.charge.id).length, 1)
  const again = await ok('autoChargeRun', { confirm: true, now: NOV12 })
  assert.equal(again.summary.charged, 0, 'the extra is never charged twice')
})

await test('staff see it: Players list tag, Edit player status, Money panel; families see it on Fees', async () => {
  const pl = await ok('playersList', { fresh: true })
  const p = (n) => pl.players.find((x) => x.name === n)
  assert.equal(p('Bea Bank').savedPay.label, 'Direct debit on file')
  assert.equal(p('Dex Declined').savedPay.label, 'Card on file'); assert.equal(p('Dex Declined').savedPay.last.status, 'failed')
  assert.equal(p('Pip Paused').savedPay.paused, false)
  assert.equal(p('Noel Nocard').savedPay, null); assert.equal(p('Cara Card').savedPay, null)
  const st = await ok('autoChargeStatus', { rowId: rows.dex })
  assert.equal(st.method.staffLabel, 'Card on file'); assert.equal(st.paused, false); assert.ok(st.recent.length >= 1); assert.ok(st.consent.at)
  const panel = await ok('autoChargePanel', { now: NOV12 })
  assert.match(panel.schedule, /10:00 Sydney time/); assert.ok(panel.lastRun.at); assert.ok(panel.recent.length > 0)
  // Fees: the auto-charges are in the history, charged automatically.
  const nia = client(); await signIn(nia, 'nia.noshow@example.com')
  const fees = (await nia.call('/api/jfp-account', { action: 'fees' })).data.fees
  const lines = fees.records.filter((x) => /charged automatically/.test(x.what))
  assert.ok(lines.length >= 1, JSON.stringify(fees.records))
  const sv = (await nia.call('/api/jfp-account', { action: 'savedPay' })).data.saved
  assert.ok(sv.recent.some((x) => x.statusLabel === 'Paid'))
  // Money's Stripe list has the auto-charges: Pro ones under Pro sessions, the rest under JFP.
  const pro = await ok('proMoney', { fresh: true })
  const pipLine = pro.pro.lines.find((x) => x.kind === 'stripe' && x.who === 'Pip Paused')
  assert.ok(pipLine, JSON.stringify(pro.pro.lines)); assert.equal(pipLine.takenCents, 10000); assert.equal(pipLine.feePending, false, 'the Stripe fee is read for it')
  const money = await ok('money', { fresh: true })
  const caraM = money.money.players.find((x) => x.player === 'Cara Card')
  assert.equal(caraM.stripeCents, 10000)
  assert.ok(!money.money.unmatched.some((u) => /auto-charge/i.test(u.product || '')), 'never "not matched"')
})

console.log(`\n${passed} passed`)
