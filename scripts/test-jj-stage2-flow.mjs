// Joners Juniors stage 2, end to end against the local harness and its
// invented Juniors data: Invites (new family, re-enrol, reminders), paying
// from the family account, and Requests & waitlist.
//   npm run build
//   JFP_JUNIORS_DEMO=1 HOLIDAY_LOCAL_PORT=4521 node scripts/holiday-local.mjs
//   node scripts/test-jj-stage2-flow.mjs 4521
// Safe to run after test-jfp-juniors-flow.mjs and test-jj-flow.mjs on the
// same harness. Every name and email is invented.
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
const B = `http://localhost:${process.argv[2] || '4491'}`
let passed = 0, ip = 1
const test = async (n, fn) => { await fn(); passed += 1; console.log(`ok - ${n}`) }
function client() {
  const jar = new Map(), me = `10.9.0.${ip++}`
  return async (p, body, method = 'POST') => {
    const res = await fetch(`${B}${p}`, { method, headers: { 'content-type': 'application/json', origin: B, 'x-forwarded-for': me, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') }, ...(method === 'POST' ? { body: JSON.stringify(body || {}) } : {}) })
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
const kv = async (cmd) => { const t = await (await fetch(`${B}/__kv?cmd=${encodeURIComponent(JSON.stringify(cmd))}`)).text(); try { return JSON.parse(t) } catch { return t } }
const emails = () => get('/__emails')
const hashOf = (flat) => { const o = {}; for (let i = 0; i + 1 < (flat || []).length; i += 2) o[flat[i]] = JSON.parse(flat[i + 1]); return o }
const payreqs = async () => hashOf(await kv(['HGETALL', 'jj:payreqs']))
const T4 = ['Player Full Name', 'Payment Status', 'Parent Name', 'Parent Email', 'Parent Mobile', 'Date of Birth', 'Term', 'Session Day', 'Session Time', 'Location', 'Coach', 'Fee', 'Paid Via', 'Confirmation Status', 'Confirmation Date', 'Waiver Status', 'Source Term 3 Record ID', 'Stripe Payment Link', 'Notes']
const NEXT_TABLE = 'tblJJNextTerm0001'

const lee = client()
await signIn(lee, 'leejones@jonerfootball.com')
const portal = (action, body = {}) => lee('/api/jfp-portal-data', { action, ...body })
const restore = (await portal('jjSettings')).data.juniors
const jfpBefore = { money: (await portal('money', { fresh: true })).data.money.kpis, at: await airtable() }
const kids = async () => Object.fromEntries((await portal('jjPlayers', { fresh: true })).data.players.map((p) => [p.name, p]))
const plan = async (kind, extra = {}) => (await portal('jjInvites', { kind, ...extra })).data
const sendTo = (kind, list, extra = {}) => portal('jjInvites', { kind, send: true, emails: list, ...extra })
// Pay on the pretend Stripe page; the Sydney webhook (holiday-payment-webhook) follows.
async function payOnStripe(url, { webhook = true } = {}) {
  const cs = new URL(url).searchParams.get('cs')
  const r = await fetch(`${B}/mock-stripe/?cs=${cs}&action=pay${webhook ? '' : '&webhook=off'}`, { redirect: 'manual' })
  return { cs, location: r.headers.get('location') || '' }
}
async function juniorsHook(session) {
  const raw = JSON.stringify({ id: `evt_${session.id}`, type: 'checkout.session.completed', data: { object: session } }), t = Math.floor(Date.now() / 1000)
  const sig = `t=${t},v1=${crypto.createHmac('sha256', 'whsec_local_juniors').update(`${t}.${raw}`).digest('hex')}`
  const r = await fetch(`${B}/api/juniors-payment-webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': sig }, body: raw })
  return { status: r.status, data: await r.json().catch(() => ({})) }
}

// The demo's own families (all invented): Echo's family also has a JFP player.
const parentEcho = client(); await signIn(parentEcho, 'returning@example.com', 'parent')
const parentFox = client(); await signIn(parentFox, 'fox@example.com', 'parent')
const account = (call, body = {}) => call('/api/jfp-account', { action: 'overview', ...body })

await test('only Lee and Ligia: coaches get 403 and families 401 on every new Juniors action', async () => {
  const dean = client(); await signIn(dean, 'jonerfootballdean@gmail.com')
  for (const action of ['jjInvites', 'jjRequests', 'jjDecideRequest', 'jjPayments', 'jjRepairPayment', 'jjCancelPayreq', 'jjPaymentChecked']) {
    assert.equal((await dean('/api/jfp-portal-data', { action })).status, 403, action)
    assert.equal((await parentEcho('/api/jfp-portal-data', { action })).status, 401, action)
  }
})

let echoPay
await test('Invites, new family: every family with what they owe from Juniors Money; previews send nothing and make no payment link', async () => {
  const before = { mails: (await emails()).length, pays: Object.keys(await payreqs()).length }
  const d = await plan('new')
  const by = Object.fromEntries(d.list.map((f) => [f.email, f]))
  assert.equal(by['delta@example.com'].owingCents, 0, 'paid on a payment link: owes nothing')
  assert.equal(by['delta@example.com'].status, 'paid')
  assert.equal(by['returning@example.com'].owingCents, 22000); assert.equal(by['returning@example.com'].needsWaiver, true)
  assert.equal(by['returning@example.com'].status, 'not sent')
  assert.ok(d.previews.length >= 1); assert.match(d.previews[0].html, /Joners Juniors/)
  assert.ok(!/—/.test(d.previews.map((x) => x.subject + x.html).join('')), 'no em dashes')
  const one = await plan('new', { previewEmail: 'returning@example.com' })
  assert.equal(one.previews.length, 1); assert.match(one.previews[0].subject, /A\$220 to pay/)
  assert.equal((await emails()).length, before.mails, 'no email from a preview')
  assert.equal(Object.keys(await payreqs()).length, before.pays, 'no payment link from a preview')
})

await test('Invites, new family: Send emails the chosen families a sign in and pay link, records who was sent what, and never twice', async () => {
  const before = (await emails()).length
  // Two staff pressing Send together: one email each family.
  const [a, b] = await Promise.all([sendTo('new', ['returning@example.com', 'fox@example.com']), sendTo('new', ['returning@example.com', 'fox@example.com'])])
  assert.equal(a.status, 200, JSON.stringify(a.data)); assert.equal(b.status, 200)
  assert.deepEqual([...a.data.sent, ...b.data.sent].sort(), ['fox@example.com', 'returning@example.com'])
  const sent = (await emails()).slice(before)
  assert.equal(sent.length, 2)
  const echoMail = sent.find((e) => e.to.includes('returning@example.com'))
  assert.match(echoMail.subject, /Joners Juniors Term 4: A\$220 to pay/)
  const link = echoMail.html.match(/\/jfp-account\/\?pay=(JJPAY-[0-9A-Z-]+)/)
  assert.ok(link, 'the email links to the family account with the payment')
  assert.doesNotMatch(echoMail.html, /returning@example\.com\/|pay=.*@/, 'no email in the link')
  echoPay = link[1]
  const q = (await payreqs())[echoPay]
  assert.equal(q.amountCents, 22000); assert.equal(q.kind, 'term'); assert.equal(q.programme, 'Joners Juniors'); assert.equal(q.term, 'Term 4 2026')
  const inv = hashOf(await kv(['HGETALL', 'jj:invites']))['new:returning@example.com']
  assert.equal(inv.count, 1); assert.equal(inv.payreqId, echoPay); assert.match(inv.by, /leejones/)
  // Sending again without "again" does nothing.
  const again = await sendTo('new', ['returning@example.com'])
  assert.deepEqual(again.data.sent, [])
  assert.equal((await emails()).length, before + 2)
  const d = await plan('new')
  assert.equal(d.list.find((f) => f.email === 'returning@example.com').status, 'sent')
  assert.ok(JSON.stringify((await portal('audit')).data.entries).includes('jj.invite.new'))
})

await test('the family account: one login shows JFP and Juniors children together; a JFP-only family sees no change', async () => {
  const r = await account(parentEcho, { pay: echoPay })
  assert.equal(r.status, 200)
  assert.ok(r.data.players.some((p) => p.name === 'Riley Returning'), 'the JFP player is still there')
  assert.ok(!r.data.players.some((p) => p.name === 'Jun Echo'), 'the Juniors child is not shown twice')
  const j = r.data.juniors
  assert.equal(j.term, 'Term 4 2026'); assert.equal(j.classLabel, 'Saturday 9:15am to 10:00am')
  const echo = j.children.find((c) => c.name === 'Jun Echo')
  assert.equal(echo.payment.state, 'due'); assert.equal(echo.payment.payreqId, echoPay); assert.equal(echo.waiver.onFile, false)
  assert.equal(echo.dates.length, 10)
  assert.ok(j.todo.some((t) => t.id === echoPay && t.needsWaiver))
  // Opening the link counts as opened.
  assert.equal((await plan('new')).list.find((f) => f.email === 'returning@example.com').status, 'opened')
  // A JFP-only family: no Juniors block at all.
  const jfpOnly = client(); await signIn(jfpOnly, 'parent1@example.com', 'parent')
  const o = await account(jfpOnly)
  assert.equal(o.status, 200); assert.equal(o.data.juniors, null)
  assert.ok(o.data.players.length >= 1)
  // Another family cannot see or pay Echo's payment.
  assert.equal((await parentFox('/api/jfp-account', { action: 'jjPay', payreqId: echoPay })).status, 404)
})

let echoSession
await test('pay from the family account: the one family waiver first, then Stripe with Juniors metadata (never JFP)', async () => {
  const blocked = await parentEcho('/api/jfp-account', { action: 'jjPay', payreqId: echoPay })
  assert.equal(blocked.status, 400); assert.equal(blocked.data.code, 'waiver')
  const echo = (await account(parentEcho)).data.juniors.children.find((c) => c.name === 'Jun Echo')
  const w = await parentEcho('/api/jfp-account', { action: 'signWaiver', players: [{ key: echo.key, dob: '2021-04-04', emergencyName: 'Invented Contact', emergencyPhone: '0400000555' }], waiver: { accepted: { terms: true, makeups: true, payment: true, emergency: true }, signature: 'Rita Returning' }, parentName: 'Rita Returning', mobile: '0400000103' })
  assert.equal(w.status, 200, JSON.stringify(w.data)); assert.equal(w.data.created, 1)
  const at = await airtable()
  const wrow = at.waiver.find((x) => x.fields['Player Full Name'] === 'Jun Echo')
  assert.equal(wrow.fields.Programme, 'Joners Juniors'); assert.match(wrow.fields['Waiver Version'], /Joners Juniors/); assert.equal(wrow.fields.Term, 'Term 4 2026')
  assert.equal(at.juniors4.find((x) => x.id === echo.rowId).fields['Waiver Status'], 'Completed')
  const after = (await account(parentEcho)).data.juniors.children.find((c) => c.name === 'Jun Echo')
  assert.equal(after.waiver.onFile, true)
  const p = await parentEcho('/api/jfp-account', { action: 'jjPay', payreqId: echoPay })
  assert.equal(p.status, 200, JSON.stringify(p.data)); assert.match(p.data.url, /mock-stripe/)
  const s = (await get('/__sessions')).find((x) => x.url === p.data.url)
  assert.equal(s.amount_total, 22000); assert.equal(s.metadata.jjPayreqId, echoPay); assert.equal(s.metadata.programme, 'Joners Juniors')
  assert.equal(s.metadata.jjRowIds, echo.rowId); assert.equal(s.metadata.term, 'Term 4 2026')
  assert.equal(s.metadata.jfpBookingId, undefined, 'never a JFP booking id')
  assert.match(s.product_name, /^Joners Juniors Term 4 2026: Jun Echo/)
  assert.equal((await payreqs())[echoPay].status, 'checkout')
  echoSession = { url: p.data.url, id: s.id, rowId: echo.rowId }
})

await test('paid: the Juniors row is marked paid with the Stripe ids and the real fee; receipt and staff alert; JFP income and ledger untouched', async () => {
  const before = (await emails()).length
  const { cs, location } = await payOnStripe(echoSession.url)
  assert.match(location, /\/jfp-account\/\?paid=1&session_id=/)
  const q = (await payreqs())[echoPay]
  assert.equal(q.status, 'paid'); assert.equal(q.paidCents, 22000); assert.equal(q.stripeFeeCents, 460, 'the fee from the balance transaction')
  assert.equal(q.effects.airtable.status, 'done')
  const row = (await airtable()).juniors4.find((x) => x.id === echoSession.rowId).fields
  assert.ok(Object.keys(row).every((k) => T4.includes(k)), 'only the Term 4 table\'s columns')
  assert.equal(row['Payment Status'], 'Paid'); assert.equal(row['Paid Via'], 'Stripe')
  assert.match(row.Notes, new RegExp(`\\[JJ-CS:${cs}\\]`)); assert.match(row.Notes, /\[JJ-PI:pi_/); assert.match(row.Notes, new RegExp(`\\[JJ-PAID:${echoPay}\\]`)); assert.match(row.Notes, /Stripe fee A\$4\.60/)
  const sent = (await emails()).slice(before)
  assert.ok(sent.some((e) => e.to.includes('returning@example.com') && /payment received/i.test(e.subject)))
  assert.ok(sent.some((e) => e.to.includes('jonersjuniors@jonerfootball.com') && /Joners Juniors payment/.test(e.subject)))
  // The page the family comes back to.
  const c = await get(`/api/jfp-confirm?session_id=${cs}`)
  assert.equal(c.status, 'paid'); assert.equal(c.kind, 'juniors')
  // The same payment again through the Juniors webhook: nothing twice.
  const mails = (await emails()).length, notes = row.Notes
  const hook = await juniorsHook((await get('/__sessions')).find((x) => x.id === cs))
  assert.equal(hook.status, 200, JSON.stringify(hook.data))
  assert.equal((await emails()).length, mails)
  assert.equal((await airtable()).juniors4.find((x) => x.id === echoSession.rowId).fields.Notes, notes)
  // Juniors Money finds it on the child, with its fee; JFP does not count it.
  const j = (await portal('juniorsMoney', { fresh: true })).data.juniors
  const echo = j.players.find((p) => p.rowId === echoSession.rowId)
  assert.equal(echo.paidCents, 22000); assert.equal(echo.status, 'paid')
  assert.ok(j.byTerm['Term 4 2026'].lines.some((l) => l.kind === 'stripe' && l.who === 'Jun Echo' && l.feeCents === 460))
  assert.equal(j.coverage.alsoInJfp, 0)
  const at = await airtable()
  assert.equal(at.ledger.length, jfpBefore.at.ledger.length, 'nothing in the JFP Payment Ledger')
  assert.equal(at.term4.length, jfpBefore.at.term4.length, 'nothing in Term 4 Players')
  const k = (await portal('money', { fresh: true })).data.money.kpis
  for (const key of ['incomeCents', 'stripeCents', 'offlineCents', 'players']) assert.equal(k[key], jfpBefore.money[key], `JFP ${key} unchanged`)
  // The family sees it paid.
  const fam = (await account(parentEcho)).data.juniors
  assert.equal(fam.children.find((x) => x.name === 'Jun Echo').payment.state, 'paid')
  assert.ok(fam.paid.some((x) => x.id === echoPay))
  assert.equal((await plan('new')).list.find((f) => f.email === 'returning@example.com').status, 'paid')
})

await test('a family pays a child with no payment link yet: the amount comes from Juniors Money, and a child already paid on a link is not charged again', async () => {
  const fox = (await account(parentFox)).data.juniors.children.find((c) => c.name === 'Jun Foxtrot')
  assert.ok(fox.payment.state === 'due' || fox.payment.canPay)
  const r = await parentFox('/api/jfp-account', { action: 'jjRequestPay', rowIds: [fox.rowId] })
  assert.equal(r.status, 200, JSON.stringify(r.data))
  const q = (await payreqs())[r.data.payreqId]
  assert.equal(q.amountCents, 22000); assert.deepEqual(q.rowIds, [fox.rowId])
  const again = await parentFox('/api/jfp-account', { action: 'jjRequestPay', rowIds: [fox.rowId] })
  assert.equal(again.data.payreqId, r.data.payreqId, 'the same open link, not a second one')
  // Delta paid on a Stripe payment link; Airtable still says Unpaid.
  const delta = client(); await signIn(delta, 'delta@example.com', 'parent')
  const dk = (await account(delta)).data.juniors.children[0]
  const d = await delta('/api/jfp-account', { action: 'jjRequestPay', rowIds: [dk.rowId] })
  assert.equal(d.status, 409); assert.equal(d.data.code, 'paid')
})

await test('Reminders: unpaid and/or no waiver with the amount owing; resending counts; a cancelled link cannot be paid', async () => {
  const d = await plan('reminder')
  const by = Object.fromEntries(d.list.map((f) => [f.email, f]))
  assert.ok(by['fox@example.com']); assert.equal(by['fox@example.com'].owingCents, 22000)
  assert.equal(by['delta@example.com'].owingCents, 0, 'paid on a link: only the waiver to remind about')
  assert.equal(by['delta@example.com'].needsWaiver, true)
  assert.ok(!(await plan('reminder', { filter: 'unpaid' })).list.some((f) => f.email === 'delta@example.com'), 'nothing owing: not on the unpaid list')
  const waiverOnly = await plan('reminder', { filter: 'waiver' })
  assert.ok(!waiverOnly.list.some((f) => f.email === 'fox@example.com' && f.todo), 'Foxtrot has a waiver')
  const before = (await emails()).length
  const r = await sendTo('reminder', ['fox@example.com'])
  assert.deepEqual(r.data.sent, ['fox@example.com'])
  const mail = (await emails()).slice(before)[0]
  assert.match(mail.subject, /Reminder: A\$220 to pay for Joners Juniors/)
  const id = mail.html.match(/pay=(JJPAY-[0-9A-Z-]+)/)[1]
  assert.equal((await payreqs())[id].status, 'open')
  await kv(['DEL', 'jj:invite-lock:reminder:fox@example.com'])
  assert.deepEqual((await sendTo('reminder', ['fox@example.com'], { resend: true })).data.sent, ['fox@example.com'])
  assert.equal(hashOf(await kv(['HGETALL', 'jj:invites']))['reminder:fox@example.com'].count, 2)
  // Staff cancel the link: the family can no longer pay it.
  assert.equal((await portal('jjCancelPayreq', { id })).status, 200)
  assert.equal((await parentFox('/api/jfp-account', { action: 'jjPay', payreqId: id })).status, 410)
  assert.equal((await portal('jjCancelPayreq', { id })).status, 409)
})

let echoNextRow
await test('Re-enrol: blocked with a clear message until next term has its own Airtable table', async () => {
  assert.equal((await portal('jjSaveSettings', { juniors: { nextTerm: { name: 'Term 1 2027', termStart: '2027-02-06', open: false, priceCents: 23000, holdCents: 5000 } } })).status, 200)
  const d = await plan('next')
  assert.match(d.blocked, /Add the Airtable table for Term 1 2027/)
  const r = await sendTo('next', ['returning@example.com'])
  assert.equal(r.status, 409)
  assert.equal((await parentEcho('/api/jfp-account', { action: 'jjNextChoice', rowId: echoSession.rowId, choice: 'hold' })).status, 403)
  assert.equal((await portal('jjSaveSettings', { juniors: { nextTerm: { name: 'Term 1 2027', termStart: '2027-02-06', open: false, priceCents: 23000, holdCents: 50000 } } })).status, 400, 'a hold more than the price')
  assert.equal((await portal('jjSaveSettings', { juniors: { tables: { ...restore.tables, 'Term 1 2027': NEXT_TABLE } } })).status, 200)
  assert.equal((await plan('next')).blocked, '')
})

await test('Re-enrol: invite, hold the place in the account, then pay the rest: one row in next term\'s table, held then paid', async () => {
  const before = (await emails()).length
  const r = await sendTo('next', ['returning@example.com'])
  assert.deepEqual(r.data.sent, ['returning@example.com'], JSON.stringify(r.data))
  const mail = (await emails()).slice(before)[0]
  assert.match(mail.subject, /Keep your Joners Juniors place for Term 1 2027/); assert.match(mail.html, /A\$230/); assert.match(mail.html, /A\$50/)
  const st = hashOf(await kv(['HGETALL', 'jj:next:Term 1 2027']))
  assert.equal(st[echoSession.rowId].status, 'invited')
  assert.equal((await plan('next')).list.find((f) => f.email === 'returning@example.com').children[0].next, 'invited')
  // The account offers hold, full or not returning.
  let echo = (await account(parentEcho)).data.juniors.children.find((c) => c.name === 'Jun Echo')
  assert.deepEqual({ status: echo.next.status, hold: echo.next.holdLabel, full: echo.next.fullLabel }, { status: 'invited', hold: 'A$50', full: 'A$230' })
  const hold = await parentEcho('/api/jfp-account', { action: 'jjNextChoice', rowId: echoSession.rowId, choice: 'hold' })
  assert.equal(hold.status, 200, JSON.stringify(hold.data))
  const pay1 = await parentEcho('/api/jfp-account', { action: 'jjPay', payreqId: hold.data.payreqId })
  assert.equal(pay1.status, 200, JSON.stringify(pay1.data))
  const s1 = (await get('/__sessions')).find((x) => x.url === pay1.data.url)
  assert.equal(s1.amount_total, 5000); assert.equal(s1.metadata.term, 'Term 1 2027')
  await payOnStripe(pay1.data.url)
  let rows = (await airtable()).juniorsNext.filter((x) => (x.fields.Notes || '').includes(`[JJ-NEXT:${echoSession.rowId}]`))
  assert.equal(rows.length, 1, 'a row in next term\'s table')
  echoNextRow = rows[0].id
  assert.equal(rows[0].fields.Term, 'Term 1 2027'); assert.equal(rows[0].fields.Fee, 230); assert.equal(rows[0].fields['Payment Status'], 'Partially Paid')
  assert.equal(rows[0].fields['Player Full Name'], 'Jun Echo'); assert.equal(rows[0].fields['Parent Email'], 'returning@example.com'); assert.equal(rows[0].fields['Waiver Status'], 'Completed')
  assert.ok(Object.keys(rows[0].fields).every((k) => T4.includes(k)))
  assert.equal(hashOf(await kv(['HGETALL', 'jj:next:Term 1 2027']))[echoSession.rowId].status, 'held')
  echo = (await account(parentEcho)).data.juniors.children.find((c) => c.name === 'Jun Echo')
  assert.equal(echo.next.status, 'held'); assert.equal(echo.next.afterHoldLabel, 'A$180')
  assert.equal((await parentEcho('/api/jfp-account', { action: 'jjNextChoice', rowId: echoSession.rowId, choice: 'hold' })).status, 409, 'already held')
  const full = await parentEcho('/api/jfp-account', { action: 'jjNextChoice', rowId: echoSession.rowId, choice: 'full' })
  const pay2 = await parentEcho('/api/jfp-account', { action: 'jjPay', payreqId: full.data.payreqId })
  assert.equal((await get('/__sessions')).find((x) => x.url === pay2.data.url).amount_total, 18000, 'the rest: A$230 less the A$50 hold')
  await payOnStripe(pay2.data.url)
  rows = (await airtable()).juniorsNext.filter((x) => (x.fields.Notes || '').includes(`[JJ-NEXT:${echoSession.rowId}]`))
  assert.equal(rows.length, 1, 'still one row')
  assert.equal(rows[0].fields['Payment Status'], 'Paid')
  assert.equal((rows[0].fields.Notes.match(/\[JJ-CS:/g) || []).length, 2, 'both payments on the row')
  assert.equal(hashOf(await kv(['HGETALL', 'jj:next:Term 1 2027']))[echoSession.rowId].status, 'paid')
  // Juniors Money: both payments in Term 1 2027, against the new row; JFP untouched.
  const j = (await portal('juniorsMoney', { fresh: true })).data.juniors
  assert.equal(j.players.find((p) => p.rowId === echoNextRow).paidCents, 23000)
  assert.equal(j.byTerm['Term 1 2027'].collectedCents, 23000)
  assert.equal((await airtable()).ledger.length, jfpBefore.at.ledger.length)
  assert.equal((await plan('next')).list.find((f) => f.email === 'returning@example.com').status, 'paid')
})

await test('Re-enrol: not returning is recorded; a family not invited cannot answer until re-enrolment is open to all', async () => {
  const alpha = client(); await signIn(alpha, 'alpha@example.com', 'parent')
  const a = (await account(alpha)).data.juniors.children.find((c) => c.name === 'Jun Alpha')
  assert.equal(a.next, null, 'not invited and not open: no next term block')
  assert.equal((await alpha('/api/jfp-account', { action: 'jjNextChoice', rowId: a.rowId, choice: 'no' })).status, 403)
  assert.equal((await portal('jjSaveSettings', { juniors: { nextTerm: { name: 'Term 1 2027', termStart: '2027-02-06', open: true, priceCents: 23000, holdCents: 5000 } } })).status, 200)
  assert.equal((await alpha('/api/jfp-account', { action: 'jjNextChoice', rowId: a.rowId, choice: 'no' })).status, 200)
  assert.equal(hashOf(await kv(['HGETALL', 'jj:next:Term 1 2027']))[a.rowId].status, 'no')
  // The name cannot change once families have answered.
  assert.equal((await portal('jjSaveSettings', { juniors: { nextTerm: { name: 'Term 1 2028', open: true } } })).status, 409)
})

await test('a payment for next term with no table: Stripe is asked to retry, staff are told, and Try again finishes it', async () => {
  const fox = (await account(parentFox)).data.juniors.children.find((c) => c.name === 'Jun Foxtrot')
  const choice = await parentFox('/api/jfp-account', { action: 'jjNextChoice', rowId: fox.rowId, choice: 'full' })
  assert.equal(choice.status, 200, JSON.stringify(choice.data))
  const w = await parentFox('/api/jfp-account', { action: 'jjPay', payreqId: choice.data.payreqId })
  assert.equal(w.status, 200, JSON.stringify(w.data))
  // The table goes missing before the money arrives.
  const { 'Term 1 2027': gone, ...withoutNext } = (await portal('jjSettings')).data.juniors.tables
  assert.equal((await portal('jjSaveSettings', { juniors: { tables: withoutNext } })).status, 200)
  const mails = (await emails()).length
  const { cs } = await payOnStripe(w.data.url, { webhook: false })
  const hook = await juniorsHook((await get('/__sessions')).find((x) => x.id === cs))
  assert.equal(hook.status, 500, 'Stripe tries again later')
  const q = (await payreqs())[choice.data.payreqId]
  assert.equal(q.status, 'paid'); assert.equal(q.effects.airtable.status, 'failed'); assert.match(q.needsAttention, /no-table/)
  assert.ok((await emails()).slice(mails).some((e) => e.to.includes('jonersjuniors@jonerfootball.com') && /needs checking/.test(e.subject)))
  assert.ok(!(await emails()).slice(mails).some((e) => e.to.includes('fox@example.com')), 'no receipt until it is recorded')
  const list = (await portal('jjPayments')).data.payments
  assert.equal(list.find((x) => x.id === q.id).needsCheck, true)
  assert.ok((await portal('jjDashboard')).data.needs.some((n) => n.kind === 'payments'))
  assert.equal((await portal('jjSaveSettings', { juniors: { tables: { ...withoutNext, 'Term 1 2027': gone } } })).status, 200)
  const fix = await portal('jjRepairPayment', { id: q.id })
  assert.equal(fix.status, 200); assert.equal(fix.data.done, true)
  assert.equal((await payreqs())[q.id].needsAttention, '', 'recorded now: the table flag comes off')
  assert.equal((await portal('jjPayments')).data.payments.find((x) => x.id === q.id).needsCheck, false)
  assert.equal((await portal('jjPaymentChecked', { id: q.id })).status, 409, 'nothing left to check')
  assert.ok((await airtable()).juniorsNext.some((x) => (x.fields.Notes || '').includes(`[JJ-NEXT:${fox.rowId}]`) && x.fields['Payment Status'] === 'Paid'))
  assert.ok((await emails()).some((e) => e.to.includes('fox@example.com') && /payment received/i.test(e.subject)))
})

await test('paid on Stripe but the webhook is late: paying again is refused, and coming back to the account finishes it', async () => {
  const fox = (await account(parentFox)).data.juniors.children.find((c) => c.name === 'Jun Foxtrot')
  const ask = await parentFox('/api/jfp-account', { action: 'jjRequestPay', rowIds: [fox.rowId] })
  assert.equal(ask.status, 200, JSON.stringify(ask.data))
  const pay = await parentFox('/api/jfp-account', { action: 'jjPay', payreqId: ask.data.payreqId })
  const { cs } = await payOnStripe(pay.data.url, { webhook: false })
  const again = await parentFox('/api/jfp-account', { action: 'jjPay', payreqId: ask.data.payreqId })
  assert.equal(again.status, 409); assert.equal(again.data.code, 'processing')
  assert.equal((await airtable()).juniors4.find((x) => x.id === fox.rowId).fields['Payment Status'], 'Unpaid', 'not yet')
  const back = await get(`/api/jfp-confirm?session_id=${cs}`)
  assert.equal(back.status, 'paid'); assert.equal(back.kind, 'juniors')
  assert.equal((await airtable()).juniors4.find((x) => x.id === fox.rowId).fields['Payment Status'], 'Paid')
  assert.equal((await parentFox('/api/jfp-account', { action: 'jjPay', payreqId: ask.data.payreqId })).status, 409, 'already paid')
})

let reqId
await test('the website: a full class offers the waitlist instead of checkout; the request is saved and only staff are emailed', async () => {
  const enrolled = (await portal('jjPlayers', { fresh: true })).data.summary.enrolled
  assert.equal((await portal('jjSaveClasses', { classes: [{ ...restore.classes[0], capacity: enrolled }] })).status, 200)
  await kv(['DEL', `jj:rows:v1:${restore.tables['Term 4 2026']}`])
  const info = (await get('/api/juniors-info')).juniors
  assert.equal(info.full, true); assert.equal(info.waitlist, true)
  assert.ok(!/@|rec[A-Za-z0-9]{14}/.test(JSON.stringify(info)), 'nothing private')
  const form = (x = {}) => fetch(`${B}/api/juniors-registration`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.9.9.${ip++}` }, body: JSON.stringify({ playerFullName: 'Kit Waitlist', parentName: 'Kay Waitlist', email: 'kay.waitlist@example.com', mobile: '0400000321', dateOfBirth: '03/03/2021', source: 'Friend', medicalHistory: 'None', agreementAccepted: true, ...x }) }).then(async (r) => ({ status: r.status, data: await r.json() }))
  const sessions = (await get('/__sessions')).length
  const no = await form()
  assert.equal(no.status, 409); assert.equal(no.data.full, true); assert.equal(no.data.waitlist, true)
  const mails = (await emails()).length
  const yes = await form({ waitlist: true })
  assert.equal(yes.status, 200, JSON.stringify(yes.data)); assert.equal(yes.data.waitlist, true)
  reqId = yes.data.requestId
  assert.equal((await get('/__sessions')).length, sessions, 'no Stripe checkout')
  const sent = (await emails()).slice(mails)
  assert.equal(sent.length, 1); assert.ok(sent[0].to.includes('jonersjuniors@jonerfootball.com')); assert.ok(!sent.some((e) => e.to.includes('kay.waitlist@example.com')), 'nothing to the family')
  const twice = await form({ waitlist: true })
  assert.equal(twice.data.already, true); assert.equal(twice.data.requestId, reqId)
  assert.equal((await form({ waitlist: true, playerFullName: 'Lu Waitlist', email: 'lu.waitlist@example.com' })).status, 200)
  // Closed registrations: the same.
  assert.equal((await portal('jjSaveSettings', { juniors: { registrationOpen: false } })).status, 200)
  const closed = await form({ waitlist: true, playerFullName: 'Mo Waitlist', email: 'mo.waitlist@example.com' })
  assert.equal(closed.status, 200)
  assert.equal(hashOf(await kv(['HGETALL', 'jj:requests']))[closed.data.requestId].why, 'closed')
  assert.equal((await portal('jjSaveSettings', { juniors: { registrationOpen: true } })).status, 200)
})

await test('Requests & waitlist: in the order asked; accept asks first when full, puts the child in the class, then the invite to pay goes on Send', async () => {
  const d = (await portal('jjRequests')).data
  const waiting = d.list.filter((r) => r.status === 'waiting')
  assert.deepEqual(waiting.slice(0, 3).map((r) => [r.position, r.player.name]), [[1, 'Kit Waitlist'], [2, 'Lu Waitlist'], [3, 'Mo Waitlist']])
  assert.equal(d.placeFree, false)
  assert.equal(waiting[0].age, 5)
  const full = await portal('jjDecideRequest', { id: reqId, decision: 'accept' })
  assert.equal(full.status, 409); assert.equal(full.data.code, 'full'); assert.match(full.data.error, /Accept anyway\?/)
  const ok = await portal('jjDecideRequest', { id: reqId, decision: 'accept', force: true })
  assert.equal(ok.status, 200, JSON.stringify(ok.data))
  const row = (await airtable()).juniors4.find((x) => x.id === ok.data.rowId).fields
  assert.equal(row['Player Full Name'], 'Kit Waitlist'); assert.equal(row['Payment Status'], 'Unpaid'); assert.equal(row['Date of Birth'], '03/03/2021')
  assert.match(row.Notes, new RegExp(`\\[JJ-REQ:${reqId}\\]`))
  assert.equal((await portal('jjDecideRequest', { id: reqId, decision: 'accept' })).status, 409, 'not twice')
  let r = (await portal('jjRequests')).data.list.find((x) => x.id === reqId)
  assert.equal(r.stage, 'accepted')
  const before = (await emails()).length
  const prev = await plan('new', { previewEmail: 'kay.waitlist@example.com' })
  assert.match(prev.previews[0].subject, /A\$220 to pay/)
  assert.equal((await emails()).length, before, 'the preview sends nothing')
  assert.deepEqual((await sendTo('new', ['kay.waitlist@example.com'])).data.sent, ['kay.waitlist@example.com'])
  r = (await portal('jjRequests')).data.list.find((x) => x.id === reqId)
  assert.equal(r.stage, 'invited')
  // Decline one, then back on the waitlist.
  const lu = waiting[1]
  assert.equal((await portal('jjDecideRequest', { id: lu.id, decision: 'decline', reason: 'Invented reason' })).status, 200)
  assert.equal((await portal('jjRequests')).data.list.find((x) => x.id === lu.id).status, 'declined')
  assert.equal((await portal('jjDecideRequest', { id: lu.id, decision: 'wait' })).status, 200)
  assert.equal((await portal('jjRequests')).data.list.find((x) => x.id === lu.id).position, 1, 'Kit is in the class, so Lu is next')
  // A place frees up: the page says who is next.
  assert.equal((await portal('jjSaveClasses', { classes: [{ ...restore.classes[0], capacity: 40 }] })).status, 200)
  const free = (await portal('jjRequests')).data
  assert.equal(free.placeFree, true); assert.ok(free.placesLeft > 0)
  assert.ok((await portal('jjDashboard')).data.needs.some((n) => n.kind === 'waiting'))
  assert.ok(JSON.stringify((await portal('audit')).data.entries).includes('jj.request.accept'))
})

await test('the JFP pages still answer as before; settings go back for anything that runs next', async () => {
  const m = (await portal('money', { fresh: true })).data.money
  assert.ok(!m.players.some((x) => /^Jun |Waitlist/.test(x.player)))
  assert.equal((await portal('familyInvites')).status, 200)
  assert.equal((await portal('payments')).status, 200)
  assert.ok(!JSON.stringify((await portal('payments')).data).includes('JJPAY-'), 'Juniors payments are not in the JFP payments list')
  assert.equal((await portal('jjSaveSettings', { juniors: restore })).status, 200)
})

console.log(`\n${passed} Joners Juniors stage 2 flow checks passed`)
