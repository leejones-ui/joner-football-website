// Saved card or bank account and auto-charge after each session (Lee, 14 Oct
// 2026; claude/card-on-file), end to end against the local harness: fake
// Airtable, fake Stripe (customers, setup intents, payment methods, off
// session payment intents, BECS), captured email and Telegram.
//
// Families save a card or bank account in My account > Fees (consent first),
// then the daily run (and staff "Run now") charges the right dates only.
// Lee's rules (16 Oct 2026, claude/autocharge-rules): session by session
// players only (term fee players never, their extras yes); three locks (saved
// and agreed, staff turned it on for the player, the Settings switch); the
// register decides (Present and Absent charged, Notified with late notice
// charged, told 24 h ahead never, not marked waits and is retried); already
// paid (pay ahead, PREPAID, COVERED, a paid charge, billed by hand) skipped;
// consent v3 and the "The family has agreed to this amount" tick.
// Also: a rerun charges nothing twice; a declined card or
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
// Staff turn auto charge on for the players on 20 Oct (the test clock).
const OCT20 = Date.parse('2026-10-20T09:00:00+11:00')
const mark = (date, rowId, v) => kv(['HSET', `jfp:att:${GROUP}:${date}`, rowId, v])
const V3 = 'jfp-auto-charge-v3 (16 Oct 2026)'
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
  rows.tom = await addSession('Tom Termfee', 'tom.termfee@example.com')
  rows.mo = await addSession('Mo Unmarked', 'mo.unmarked@example.com')
  rows.zed = await addSession('Zed Zealous', 'zed.zealous@example.com')
  rows.paige = await addSession('Paige Payahead', 'paige.payahead@example.com')
  rows.ivy = await addSession('Ivy Invoiced', 'ivy.invoiced@example.com')
  rows.hal = await addSession('Hal Handbilled', 'hal.handbilled@example.com')
  rows.olly = await addSession('Olly Off', 'olly.off@example.com')
  // Tom pays a term fee: never charged for sessions, even with a saved card.
  await patch(rows.tom, { 'Term 4 Payment Type': 'JFP Term 4 Small group' })
  await bust()
  assert.equal((await row(rows.cara))['Term 4 Payment Type'], 'JFP Session by session')
  assert.equal((await row(rows.dex))['Term 4 Payment Type'], 'JFP Pro sessions')
})

await test('ships dark: all three switches off by default; families see nothing and setup is refused; bank needs its own switch', async () => {
  assert.deepEqual((await ok('savedPaySettings')).savedPay, { cards: false, bank: false, autoCharge: false })
  const c = client(); await signIn(c, 'cara.card@example.com')
  assert.equal((await c.call('/api/jfp-account', { action: 'savedPay' })).data.saved, null, 'no Save section')
  const off = await c.call('/api/jfp-account', { action: 'savedPaySetup', kind: 'card', agree: true })
  assert.equal(off.status, 403); assert.equal(off.data.code, 'off')
  // Cards on, bank still off: only the card option, bank setup refused.
  assert.deepEqual((await ok('savedPaySettings', { set: { cards: true } })).savedPay, { cards: true, bank: false, autoCharge: false })
  const v = (await c.call('/api/jfp-account', { action: 'savedPay' })).data.saved
  assert.equal(v.bank, false)
  assert.equal((await c.call('/api/jfp-account', { action: 'savedPaySetup', kind: 'bank', agree: true })).status, 403)
  // Coaches cannot change the switches.
  const coachC = client(); await signIn(coachC, (await ok('board')).coaches.find((x) => x.id === 'sam').email, 'staff')
  assert.equal((await coachC.call('/api/jfp-portal-data', { action: 'savedPaySettings', set: { autoCharge: true } })).status, 403)
  assert.equal((await ok('savedPaySettings', { set: { bank: true } })).savedPay.bank, true)
  assert.equal((await c.call('/api/jfp-account', { action: 'savedPay' })).data.saved.bank, true)
  // A full Settings save keeps the switches.
  const cfg = (await ok('getSettings')).config
  await ok('saveSettings', { config: { kitNote: cfg.kitNote } })
  assert.deepEqual((await ok('savedPaySettings')).savedPay, { cards: true, bank: true, autoCharge: false })
})

await test('Fees: consent is required, then Stripe setup mode; the card is saved (brand and last 4 only), with the consent wording and version', async () => {
  const c = client()
  await signIn(c, 'cara.card@example.com')
  const v = (await c.call('/api/jfp-account', { action: 'savedPay' })).data.saved
  assert.equal(v.method, null)
  assert.equal(v.consent.card, "I authorise Joner Football to charge this card for my player's session by session fees and the extra sessions booked for them, after each session they attend or miss without notice, at the agreed price, and any other amount we agree with you in writing before charging, until I remove it.")
  assert.equal(v.consent.version, V3)
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
  assert.match(m.pmId, /^pm_test_/); assert.equal(m.last4, '4242'); assert.equal(m.consent.version, V3)
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
  for (const e of ['cody.covered', 'nia.noshow', 'sam.starter', 'pip.paused', 'rhys.removed', 'ula.undated', 'una.unsure', 'tom.termfee', 'mo.unmarked', 'zed.zealous', 'paige.payahead', 'ivy.invoiced', 'hal.handbilled', 'olly.off']) await saveMethod(`${e}@example.com`)
  await saveMethod('tia.threeds@example.com', 'card', '3ds')
})

let cody = null
let paigeDates = []
await test('three locks: auto charge is off for every player until staff turn it on (audited, admin only); term fee players can be switched on (for extras)', async () => {
  const st = await ok('autoChargeStatus', { rowId: rows.cara })
  assert.equal(st.on, false, 'off by default'); assert.equal(st.consent.coversOther, true)
  // The old pause hash is not read: a row in it is simply off.
  await kv(['HSET', 'jfp:autocharge:pause', rows.olly, JSON.stringify({ by: 'old', at: '2026-10-14T00:00:00.000Z' })])
  assert.equal((await portal('autoChargeSwitch', { rowId: rows.cara })).status, 400, 'on or off must be said')
  for (const k of ['cara', 'dex', 'bea', 'cody', 'nia', 'sam', 'rhys', 'ula', 'tia', 'una', 'tom', 'mo', 'zed', 'paige', 'ivy', 'hal']) {
    const r = await ok('autoChargeSwitch', { rowId: rows[k], on: true, now: OCT20 })
    assert.equal(r.on, true)
  }
  assert.equal((await ok('autoChargeSwitch', { rowId: rows.cara, on: true, now: OCT20 })).already, true)
  const log = JSON.parse(await kv(['LRANGE', 'jfp:audit', '0', '300'])).map((x) => JSON.parse(x)).filter((x) => x.action === 'autocharge.on')
  assert.ok(log.some((x) => x.target === rows.cara && x.by === 'leejones@jonerfootball.com' && x.after.on === true), 'audited')
  const sw = JSON.parse(await kv(['HGET', 'jfp:autocharge:on', rows.cara]))
  assert.equal(sw.at, new Date(OCT20).toISOString())
  const coachC = client(); await signIn(coachC, (await ok('board')).coaches.find((x) => x.id === 'sam').email, 'staff')
  assert.equal((await coachC.call('/api/jfp-portal-data', { action: 'autoChargeSwitch', rowId: rows.pip, on: true })).status, 403)
})

await test('the special cases are set up: covered date, told in time, the register, late notice, start date, off, removed, undated prepaid, pay ahead, a paid charge, billed by hand', async () => {
  // Cody: 28 Oct is covered by a commitment; told us about 4 Nov weeks ahead
  // (Can't make it marks his register Notified).
  await patch(rows.cody, { 'Term 4 Notes': `${(await row(rows.cody))['Term 4 Notes']} [PREPAID:1] [COVERED:${D1}]` })
  cody = (await saveMethod('cody.covered@example.com')).c
  await bust()
  const cx = await cody.call('/api/jfp-account', { action: 'cancelSession', rowId: rows.cody, date: D2, reason: 'school' })
  assert.equal(cx.status, 200, JSON.stringify(cx.data))
  assert.equal(await kv(['HGET', `jfp:att:${GROUP}:${D2}`, rows.cody]), 'Notified')
  // The coach marks the register for the rest.
  for (const k of ['cara', 'dex', 'bea', 'sam', 'pip', 'ula', 'tia', 'una', 'tom', 'mo', 'paige', 'ivy', 'hal', 'olly', 'rhys', 'nobody']) for (const d of [D1, D2]) await mark(d, rows[k], 'Present')
  // Nia: a coach-marked no-show on 28 Oct, and told us 2 hours before 4 Nov (register Notified).
  await mark(D1, rows.nia, 'Absent')
  await mark(D2, rows.nia, 'Notified')
  await kv(['HSET', 'jfp:cancels', 'CXL-TESTLATE00000001', JSON.stringify({ id: 'CXL-TESTLATE00000001', status: 'active', email: 'nia.noshow@example.com', rowId: rows.nia, player: 'Nia Noshow', groupId: GROUP, date: D2, noticeAt: '2026-11-04T04:00:00.000Z', noticeMinutes: 120, noticeHours: 2, noticeLevel: 'very-late', noticeLabel: 'late: 2 h', submittedAt: '2026-11-04T04:00:00.000Z' })])
  // Zed told us 3 days ahead for 28 Oct, but the coach marked him here anyway: never charged.
  await kv(['HSET', 'jfp:cancels', 'CXL-TESTAHEAD0000001', JSON.stringify({ id: 'CXL-TESTAHEAD0000001', status: 'active', email: 'zed.zealous@example.com', rowId: rows.zed, player: 'Zed Zealous', groupId: GROUP, date: D1, noticeAt: '2026-10-25T06:00:00.000Z', noticeMinutes: 3 * 1440 + 30, noticeHours: 72.5, noticeLevel: 'ok', noticeLabel: '72 h notice', submittedAt: '2026-10-25T06:00:00.000Z' })])
  await mark(D1, rows.zed, 'Present'); await mark(D2, rows.zed, 'Present')
  // Mo: 28 Oct marked; nobody marked 4 Nov yet.
  await kv(['HDEL', `jfp:att:${GROUP}:${D2}`, rows.mo])
  // Sam starts on 4 Nov; Ula has one undated prepaid session.
  await patch(rows.sam, { 'Term 4 Notes': `${(await row(rows.sam))['Term 4 Notes']} [STARTS:${D2}]` })
  await patch(rows.ula, { 'Term 4 Notes': `${(await row(rows.ula))['Term 4 Notes']} [PREPAID:1]` })
  await bust()
  // Paige pays 2 sessions ahead from My account (the portal's pay ahead path).
  const paige = client(); await signIn(paige, 'paige.payahead@example.com')
  const pk = (await paige.call('/api/jfp-account', { action: 'overview' })).data.players.find((x) => x.name === 'Paige Payahead').key
  const w = await paige.call('/api/jfp-account', { action: 'signWaiver', players: [{ key: pk, dob: '2012-03-20', emergencyName: 'Gran Payahead', emergencyPhone: '0400 777 999' }], waiver: { accepted: { terms: true, makeups: true, payment: true, emergency: true }, media: false, kind: 'guardian', signature: 'Parent Payahead' }, parentName: 'Parent Payahead', mobile: '0400 777 998' })
  assert.equal(w.status, 200, JSON.stringify(w.data))
  const owed = (await paige.call('/api/jfp-account', { action: 'overview' })).data.owed.find((x) => x.rowId === rows.paige)
  assert.equal(owed?.kind, 'prepay', JSON.stringify(owed))
  const pay = await paige.call('/api/jfp-account', { action: 'payOwed', rowId: rows.paige, sessions: 2 })
  assert.equal(pay.status, 200, JSON.stringify(pay.data))
  const back = await fetch(`${pay.data.url}&action=pay`, { redirect: 'manual' })
  const sid = new URL(back.headers.get('location')).searchParams.get('session_id')
  assert.equal((await paige.call(`/api/jfp-confirm?session_id=${sid}`)).data.status, 'paid')
  const ids = JSON.parse(await kv(['ZRANGE', 'jfp:payreqs', '0', '-1']))
  paigeDates = (await Promise.all(ids.map((id) => payreq(id)))).find((q) => q?.prepay?.rowId === rows.paige && q.status === 'paid').prepay.dates
  assert.equal(paigeDates.length, 2)
  // Ivy: a paid invoice charge for the 28 Oct session.
  const ic = await ok('createCharge', { rowId: rows.ivy, kind: 'invoice', amountCents: 5000, label: 'Session 28 Oct', sessionDate: D1, notifyFamily: false })
  assert.equal((await portal('chargeRecord', { id: ic.charge.id, method: 'cash', amountCents: 5000 })).status, 200)
  // Hal: staff billed his sessions by hand on 29 Oct.
  await kv(['LPUSH', 'jfp:audit', JSON.stringify({ at: '2026-10-29T01:00:00.000Z', by: 'leejones@jonerfootball.com', action: 'player.sessions', target: rows.hal, after: { mode: 'paid' } })])
  // Rhys removes his card: nothing is charged.
  const rhys = client(); await signIn(rhys, 'rhys.removed@example.com')
  assert.equal((await rhys.call('/api/jfp-account', { action: 'savedPayRemove' })).status, 200)
  assert.equal((await rhys.call('/api/jfp-account', { action: 'savedPay' })).data.saved.method, null)
  const pm = (await getJson('/__stripe-saved')).paymentMethods.find((x) => x.card?.last4 === '4242' && x.customer === null)
  assert.ok(pm, 'detached at Stripe')
})

let preview = null
await test('staff preview (dry run): who, date, amount, method, and the reason for every line; nothing is charged', async () => {
  const before = (await pis()).length
  preview = await ok('autoChargePanel', { now: NOV5 })
  const p = (name, date) => preview.preview.find((x) => x.player === name && x.date === date)
  assert.equal(p('Cara Card', D1).action, 'charge'); assert.equal(p('Cara Card', D1).amountLabel, 'A$50'); assert.equal(p('Cara Card', D1).method, 'Visa ending 4242')
  assert.equal(p('Cara Card', D1).why, 'Charge: marked here'); assert.equal(p('Cara Card', D1).register, 'Present')
  assert.equal(p('Cara Card', D2).action, 'charge')
  assert.equal(p('Dex Declined', D1).amountLabel, 'A$100'); assert.equal(p('Dex Declined', D1).programme, 'pro')
  assert.equal(p('Bea Bank', D1).method, 'Bank account ending 3456')
  assert.equal(p('Cody Covered', D1).reason, 'covered')
  // Told us weeks ahead: never charged, the register says Notified.
  assert.equal(p('Cody Covered', D2).reason, 'told'); assert.match(p('Cody Covered', D2).why, /^Skip: told us \d+ days ahead$/); assert.equal(p('Cody Covered', D2).register, 'Notified')
  // Told us 3 days ahead, marked here anyway: still never charged.
  assert.equal(p('Zed Zealous', D1).why, 'Skip: told us 3 days ahead'); assert.equal(p('Zed Zealous', D1).register, 'Present')
  assert.equal(p('Zed Zealous', D2).why, 'Charge: marked here')
  // Coach-marked no-show: charged (Lee's rule). Told us 2 hours before (Notified): charged.
  assert.equal(p('Nia Noshow', D1).action, 'charge'); assert.equal(p('Nia Noshow', D1).why, 'Charge: no-show'); assert.equal(p('Nia Noshow', D1).register, 'Absent')
  assert.equal(p('Nia Noshow', D2).action, 'charge'); assert.equal(p('Nia Noshow', D2).register, 'Notified'); assert.match(p('Nia Noshow', D2).why, /^Charge: told us late \(2 hours ahead\)$/)
  // Register not marked: waits, and is on Needs a look.
  assert.equal(p('Mo Unmarked', D1).action, 'charge')
  assert.equal(p('Mo Unmarked', D2).action, 'wait'); assert.equal(p('Mo Unmarked', D2).why, 'Wait: register not marked')
  assert.ok(preview.needsLook.some((x) => x.player === 'Mo Unmarked' && x.date === D2 && x.statusLabel === 'Register not marked'))
  assert.equal(p('Sam Starter', D1), undefined, 'before the start date: not listed')
  assert.equal(p('Sam Starter', D2).action, 'charge')
  // Off for the player (and the old pause hash is not read): one line, never charged.
  assert.equal(p('Pip Paused', D2).why, 'Skip: auto charge off for this player'); assert.equal(p('Pip Paused', D1), undefined, 'one line per player')
  assert.equal(p('Olly Off', D2).why, 'Skip: auto charge off for this player')
  // Term fee player, switched on and marked here: never charged for a session.
  assert.equal(p('Tom Termfee', D2).why, 'Skip: term fee player'); assert.equal(p('Tom Termfee', D1), undefined)
  assert.equal(p('Rhys Removed', D1), undefined, 'no saved method: not listed')
  assert.equal(p('Noel Nocard', D1), undefined)
  assert.equal(p('Ula Undated', D1).reason, 'prepaid'); assert.equal(p('Ula Undated', D2).action, 'charge')
  // Already paid: pay ahead dates, a paid charge for the date, billed by hand.
  for (const d of [D1, D2]) {
    if (paigeDates.includes(d)) assert.equal(p('Paige Payahead', d).reason, 'covered', `paid ahead ${d}`)
    else assert.equal(p('Paige Payahead', d).action, 'charge')
  }
  assert.ok(paigeDates.some((d) => [D1, D2].includes(d)), `a paid ahead date is in the window: ${paigeDates}`)
  assert.equal(p('Ivy Invoiced', D1).reason, 'covered'); assert.equal(p('Ivy Invoiced', D2).action, 'charge')
  assert.equal(p('Hal Handbilled', D1).reason, 'billed'); assert.match(p('Hal Handbilled', D1).why, /^Skip: already billed by hand/); assert.equal(p('Hal Handbilled', D2).action, 'charge')
  // The panel lists every saved method with its switch.
  const pl = (n) => preview.players.find((x) => x.player === n)
  assert.equal(pl('Cara Card').on, true); assert.equal(pl('Pip Paused').on, false); assert.equal(pl('Tom Termfee').sessionPay, false)
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

await test('auto charge off: the cron and Run now only preview and say so; nothing is charged', async () => {
  const before = (await pis()).length
  const cron = await (await fetch(`${B}/api/jfp-groups?autoCharge=1&now=${NOV5}`, { headers: { authorization: 'Bearer local-cron-secret' } })).json()
  assert.equal(cron.off, true); assert.match(cron.message, /^Auto charge is off/); assert.ok(cron.wouldCharge > 0)
  const run = await ok('autoChargeRun', { confirm: true, now: NOV5 })
  assert.equal(run.off, true); assert.equal(run.summary.charged, 0); assert.match(run.message, /Auto charge is off/)
  assert.equal((await pis()).length, before)
  assert.equal(await rec(rows.cara, D1), null, 'nothing settled either')
  assert.match((await ok('autoChargePanel', { now: NOV5 })).off, /Auto charge is off/)
  // With auto charge off, hand billing is allowed as before.
  assert.equal((await ok('savedPaySettings', { set: { autoCharge: true } })).savedPay.autoCharge, true)
  assert.equal((await ok('autoChargePanel', { now: NOV5 })).off, undefined)
})

await test('the daily run: right dates charged, receipts sent, rows paid and in the ledger; covered, told, prepaid settled; off, term fee and register not marked left alone', async () => {
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
  // Pip and Olly: auto charge off for them, nothing written. Tom: term fee, nothing.
  for (const k of ['pip', 'olly', 'tom']) for (const d of [D1, D2]) assert.equal(await rec(rows[k], d), null, `${k} ${d}`)
  assert.equal((await row(rows.tom))['Term 4 Amount Paid'] || 0, 0)
  // Zed: told us 3 days ahead, settled; 4 Nov charged.
  assert.equal((await rec(rows.zed, D1)).reason, 'told'); assert.equal((await rec(rows.zed, D2)).status, 'succeeded')
  // Mo: 28 Oct charged; 4 Nov waits for the register, nothing settled.
  assert.equal((await rec(rows.mo, D1)).status, 'succeeded'); assert.equal(await rec(rows.mo, D2), null)
  assert.ok(out.waiting >= 1, JSON.stringify(out))
  // Already paid: Paige's paid ahead dates, Ivy's paid charge, Hal billed by hand.
  for (const d of [D1, D2]) { const r = await rec(rows.paige, d); if (paigeDates.includes(d)) assert.equal(r.reason, 'covered'); else assert.equal(r.status, 'succeeded') }
  assert.equal((await rec(rows.ivy, D1)).reason, 'covered'); assert.equal((await rec(rows.hal, D1)).reason, 'billed')
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

await test('hand "Bill sessions" is refused for a player charged automatically; allowed when auto charge is off for them, or with no saved method', async () => {
  const no = await portal('sessionInvoice', { rows: [{ rowId: rows.una, sessions: 1, perSessionCents: 5000 }], mode: 'link' })
  assert.equal(no.status, 409); assert.equal(no.data.code, 'auto_charge'); assert.match(no.data.error, /Una Unsure is charged automatically after each session/)
  const mixed = await portal('sessionInvoice', { rows: [{ rowId: rows.nobody, sessions: 1, perSessionCents: 5000 }, { rowId: rows.una, sessions: 1, perSessionCents: 5000 }], mode: 'link' })
  assert.equal(mixed.status, 409)
  // Pip is off: billing by hand works.
  assert.equal((await portal('sessionInvoice', { rows: [{ rowId: rows.pip, sessions: 1, perSessionCents: 10000 }], mode: 'paid', method: 'cash' })).status, 200)
  assert.equal((await portal('sessionInvoice', { rows: [{ rowId: rows.rhys, sessions: 1, perSessionCents: 5000 }], mode: 'paid', method: 'cash' })).status, 200)
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

await test('register not marked is retried: once the coach marks it, the next run charges it (inside the two weeks)', async () => {
  assert.equal((await ok('autoChargePanel', { now: NOV5 })).preview.find((x) => x.player === 'Mo Unmarked' && x.date === D2).action, 'wait')
  await mark(D2, rows.mo, 'Present')
  const r = await ok('autoChargeRun', { confirm: true, now: NOV5 })
  assert.equal(r.summary.charged, 1, JSON.stringify(r.done))
  assert.equal((await rec(rows.mo, D2)).status, 'succeeded')
  assert.ok(!(await ok('autoChargePanel', { now: NOV5 })).needsLook.some((x) => x.player === 'Mo Unmarked'))
})

// ---------- round 2: extra sessions, analysis and invoices, emails, coach amounts ----------
const dean = client()
// A coach login from the default coach list (the same one test-jfp-extra uses).
const COACH_EMAIL = (await ok('board')).coaches.find((c) => c.id === 'dean').email
await signIn(dean, COACH_EMAIL, 'staff')
const coach = async (action, body = {}) => dean.call('/api/jfp-portal-data', { action, ...body })
const XDAY = '2026-11-11'
let slot = null, niaExtra = null, noelExtra = null, niaBooking = '', zedExtra = null, zedBooking = ''
await test('coaches never send an amount: a price they type is refused or ignored on every path; money actions are admin only', async () => {
  assert.equal((await coach('extraSave', { slot: { date: XDAY, time: '4:00pm', capacity: 3, location: 'Belrose HQ', priceCents: 99 } })).status, 400, 'a coach cannot type a price')
  const pr = await ok('extraPrices', { add: { label: 'Extra session 1 hour', dollars: '120', durationMin: 60 } })
  const priceId = pr.prices.at(-1).id
  const made = await coach('extraSave', { slot: { date: XDAY, time: '4:00pm', capacity: 5, location: 'Belrose HQ', priceId, priceCents: 99, amountCents: 99, visibility: 'private' } })
  assert.equal(made.status, 200, JSON.stringify(made.data))
  slot = made.data.slot
  // Coaches never see prices (Lee, 19 Oct 2026), so read the stored price as Lee.
  assert.equal(slot.priceCents, undefined, 'a coach is not shown the price')
  const stored = (await ok('extraList')).slots.find((x) => x.id === slot.id)
  assert.equal(stored.priceCents, 12000, "the coach's typed price is ignored: Lee's price list")
  const a = await coach('extraAttach', { slotId: slot.id, rowId: rows.nia, amountCents: 1, priceCents: 1 })
  assert.equal(a.status, 200, JSON.stringify(a.data))
  niaExtra = await payreq(a.data.booking.payreqId); niaBooking = a.data.booking.id
  assert.equal(niaExtra.amountCents, 12000, 'the charge is the session price, never an amount a coach sends')
  const b = await coach('extraAttach', { slotId: slot.id, rowId: rows.nobody, amountCents: 5 })
  noelExtra = await payreq(b.data.booking.payreqId)
  assert.equal(noelExtra.amountCents, 12000)
  for (const [action, body] of [['createCharge', { rowId: rows.nia, kind: 'analysis', amountCents: 5 }], ['chargeSavedPay', { chargeId: niaExtra.charge.id, confirm: true }], ['chargeRecord', { id: niaExtra.charge.id, method: 'cash', amountCents: 5 }], ['autoChargeRun', { confirm: true }], ['autoChargeSwitch', { rowId: rows.nia, on: false }], ['savedPayFor', { chargeIds: [niaExtra.charge.id] }], ['invoiceSave', { programme: 'other', rowIds: [rows.nia], lines: [{ description: 'x', qty: 1, unitCents: 5 }] }]]) {
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
  // "The family has agreed to this amount" must be ticked.
  const noTick = await portal('chargeSavedPay', { chargeId: analysis.id, confirm: true })
  assert.equal(noTick.status, 400); assert.equal(noTick.data.code, 'agreed'); assert.match(noTick.data.error, /The family has agreed to this amount/)
  assert.equal(f.charges[analysis.id].covers, true, 'a v3 saver agreed to other amounts in writing')
  assert.equal(f.charges[analysis.id].note, undefined)
  const r = await ok('chargeSavedPay', { chargeId: analysis.id, confirm: true, agreed: true, amountCents: 1 })
  assert.equal(r.result, 'succeeded'); assert.equal(r.amountLabel, 'A$99', 'the amount comes from the charge, never the request')
  const ch = JSON.parse(await kv(['GET', `jfp:charge:${analysis.id}`]))
  assert.equal(ch.status, 'paid'); assert.equal(ch.payments[0].method, 'stripe'); assert.match(ch.payments[0].intentId, /^pi_test_/); assert.equal(ch.payments[0].cents, 9900)
  const pi = (await pis()).find((x) => x.id === ch.payments[0].intentId)
  assert.equal(pi.amount, 9900); assert.equal(pi.metadata.jfpCharge, analysis.id); assert.equal(pi.metadata.jfpAgreed, '1')
  // The tick is kept with the payment.
  const aq = await payreq(analysis.payreqId || ch.payreqId)
  assert.equal(aq.savedCharge.agreed.by, 'leejones@jonerfootball.com'); assert.equal(aq.savedCharge.agreed.amountCents, 9900); assert.equal(aq.savedCharge.agreed.consentVersion, V3)
  assert.equal((await portal('chargeSavedPay', { chargeId: analysis.id, confirm: true, agreed: true })).status, 409, 'never twice')
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
  assert.equal((await portal('chargeSavedPay', { invoiceId: d.invoice.id, confirm: true })).data.code, 'agreed', 'no tick, no charge')
  const r = await ok('chargeSavedPay', { invoiceId: d.invoice.id, confirm: true, agreed: true })
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
  assert.equal((await ok('chargeSavedPay', { invoiceId: j.invoice.id, confirm: true, agreed: true })).result, 'succeeded')
  assert.equal((await ok('invoiceGet', { id: j.invoice.id })).invoice.status, 'paid')
  assert.equal((await row(rows.ula))['Term 4 Amount Paid'], before + 30)
})

await test('consent v2 savers keep v2: staff are told to ask them to re-save for other amounts; the tick still lets it through; extras are covered by v2', async () => {
  for (const e of ['ula.undated', 'zed.zealous']) {
    const m = JSON.parse(await kv(['GET', `jfp:savedpay:method:${e}@example.com`]))
    m.consent = { ...m.consent, version: 'jfp-auto-charge-v2 (14 Oct 2026)' }
    await kv(['SET', `jfp:savedpay:method:${e}@example.com`, JSON.stringify(m)])
  }
  assert.equal((await ok('autoChargeStatus', { rowId: rows.ula })).consent.coversOther, false)
  const c = (await ok('createCharge', { rowId: rows.ula, kind: 'analysis', amountCents: 4400, label: 'Video analysis 2', notifyFamily: false })).charge
  const f = await ok('savedPayFor', { chargeIds: [c.id] })
  assert.equal(f.charges[c.id].covers, false); assert.equal(f.charges[c.id].note, 'Ask them to re-save the card to agree to other amounts')
  assert.equal((await portal('chargeSavedPay', { chargeId: c.id, confirm: true })).data.code, 'agreed')
  const r = await ok('chargeSavedPay', { chargeId: c.id, confirm: true, agreed: true })
  assert.equal(r.result, 'succeeded')
  const q = await payreq(JSON.parse(await kv(['GET', `jfp:charge:${c.id}`])).payreqId)
  assert.equal(q.savedCharge.agreed.consentVersion, 'jfp-auto-charge-v2 (14 Oct 2026)'); assert.equal(q.savedCharge.agreed.coveredByConsent, false)
  const log = JSON.parse(await kv(['LRANGE', 'jfp:audit', '0', '100'])).map((x) => JSON.parse(x)).find((x) => x.action === 'savedpay.charge' && x.target === c.id)
  assert.equal(log.after.agreed, true); assert.equal(log.after.coveredByConsent, false)
  // Zed (v2) is put on the extra session: v2 covers extra sessions.
  const z = await coach('extraAttach', { slotId: slot.id, rowId: rows.zed })
  assert.equal(z.status, 200, JSON.stringify(z.data))
  zedExtra = await payreq(z.data.booking.payreqId); zedBooking = z.data.booking.id
  const fz = await ok('savedPayFor', { chargeIds: [zedExtra.charge.id] })
  assert.equal(fz.charges[zedExtra.charge.id].covers, true); assert.equal(fz.charges[zedExtra.charge.id].note, undefined)
})

let tomExtra = null, tomBooking = ''
await test('turning auto charge on charges only the sessions after; the extra session register decides; a term fee player\'s extra is charged; removing the method stops charges', async () => {
  // Tom pays a term fee; his extra session is still charged once marked.
  const t = await coach('extraAttach', { slotId: slot.id, rowId: rows.tom })
  assert.equal(t.status, 200, JSON.stringify(t.data))
  tomExtra = await payreq(t.data.booking.payreqId); tomBooking = t.data.booking.id
  // Pip is turned on on 6 Nov: 28 Oct and 4 Nov are never his to charge.
  assert.equal((await ok('autoChargeSwitch', { rowId: rows.pip, on: true, now: Date.parse('2026-11-06T09:00:00+11:00') })).on, true)
  // Cara removes her card before the next session.
  const cara = client(); await signIn(cara, 'cara.card@example.com')
  assert.equal((await cara.call('/api/jfp-account', { action: 'savedPayRemove' })).status, 200)
  for (const k of ['pip', 'cody', 'cara']) await mark(D3, rows[k], 'Present')
  // The extra session's register: Nia here, Tom a no-show, Zed not marked.
  await kv(['HSET', `jfp:att:${slot.id}:${XDAY}`, niaBooking, 'Present'])
  await kv(['HSET', `jfp:att:${slot.id}:${XDAY}`, tomBooking, 'Absent'])
  const pv = await ok('autoChargePanel', { now: NOV12 })
  const px = (name) => pv.preview.find((x) => x.player === name && x.programme === 'extra')
  assert.match(px('Nia Noshow').why, /^Charge: marked here/); assert.match(px('Tom Termfee').why, /^Charge: no-show/)
  assert.equal(px('Zed Zealous').why, 'Wait: register not marked')
  assert.equal(pv.preview.find((x) => x.player === 'Tom Termfee' && x.date === D3).why, 'Skip: term fee player')
  const r = await ok('autoChargeRun', { confirm: true, now: NOV12 })
  assert.equal((await rec(rows.pip, D3)).status, 'succeeded')
  assert.equal(await rec(rows.pip, D1), null, 'sessions before it was turned on stay not charged'); assert.equal(await rec(rows.pip, D2), null)
  assert.equal(await rec(rows.cara, D3), null, 'no saved method: not charged')
  assert.equal((await rec(rows.cody, D3)).status, 'succeeded', 'the next session after the covered and told ones is charged')
  assert.equal(await rec(rows.tom, D3), null, 'term fee session: never')
  // Nia's extra session (11 Nov) is charged the day after, A$120, on the charge; Noel (no card) still has his Pay link.
  const xr = await rec(niaExtra.charge.id, XDAY)
  assert.equal(xr.status, 'succeeded', JSON.stringify(xr))
  const xc = JSON.parse(await kv(['GET', `jfp:charge:${niaExtra.charge.id}`]))
  assert.equal(xc.status, 'paid'); assert.equal(xc.payments[0].cents, 12000); assert.equal(xc.payments[0].intentId, xr.intentId)
  assert.equal((await payreq(niaExtra.id)).status, 'paid')
  assert.equal((await payreq(noelExtra.id)).status, 'open')
  assert.equal((await pis()).filter((p) => p.metadata.jfpCharge === niaExtra.charge.id).length, 1)
  assert.equal((await rec(tomExtra.charge.id, XDAY)).status, 'succeeded', 'a term fee player\'s extra session is charged')
  assert.equal(await rec(zedExtra.charge.id, XDAY), null, 'extra register not marked: waits')
  assert.equal((await payreq(zedExtra.id)).status, 'open')
  assert.ok(r.summary.charged >= 4, JSON.stringify(r.summary)); assert.ok(r.summary.waiting >= 1)
  // A whole-session group (Revenue, 27 Oct): the one charge sits on the lead
  // booking, but any member's mark counts. Zed leads a group with a friend;
  // only the friend is marked, and the group's charge goes.
  const xs = JSON.parse(await kv(['HGET', 'jfp:extra', slot.id]))
  const friend = { ...xs.bookings.find((b) => b.id === zedBooking), id: 'XB-friend-of-zed', name: 'Friend Ofzed', rowId: '', guest: true, payreqId: '', groupId: zedBooking }
  xs.bookings = xs.bookings.map((b) => (b.id === zedBooking ? { ...b, groupId: zedBooking } : b)).concat(friend)
  await kv(['HSET', 'jfp:extra', slot.id, JSON.stringify(xs)])
  await kv(['HSET', `jfp:att:${slot.id}:${XDAY}`, friend.id, 'Present'])
  assert.match((await ok('autoChargePanel', { now: NOV12 })).preview.find((x) => x.player === 'Zed Zealous' && x.programme === 'extra').why, /^Charge: marked here/)
  const again = await ok('autoChargeRun', { confirm: true, now: NOV12 })
  assert.equal(again.summary.charged, 1, JSON.stringify(again.done))
  assert.equal((await rec(zedExtra.charge.id, XDAY)).status, 'succeeded')
  const third = await ok('autoChargeRun', { confirm: true, now: NOV12 })
  assert.equal(third.summary.charged, 0, 'the extra is never charged twice')
})

await test('staff see it: Players list tag, Edit player status, Money panel; families see it on Fees', async () => {
  const pl = await ok('playersList', { fresh: true })
  const p = (n) => pl.players.find((x) => x.name === n)
  assert.equal(p('Bea Bank').savedPay.label, 'Direct debit on file')
  assert.equal(p('Dex Declined').savedPay.label, 'Card on file'); assert.equal(p('Dex Declined').savedPay.last.status, 'failed')
  assert.equal(p('Pip Paused').savedPay.on, true); assert.equal(p('Olly Off').savedPay.on, false); assert.equal(p('Tom Termfee').savedPay.sessionPay, false)
  assert.equal(p('Noel Nocard').savedPay, null); assert.equal(p('Cara Card').savedPay, null)
  const st = await ok('autoChargeStatus', { rowId: rows.dex })
  assert.equal(st.method.staffLabel, 'Card on file'); assert.equal(st.on, true); assert.equal(st.switchBy, 'leejones@jonerfootball.com'); assert.ok(st.recent.length >= 1); assert.ok(st.consent.at)
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
