// Player-tied links, Match to player, custom invoices and player charges, end
// to end against the local harness (Lee and Ligia, 14 Oct 2026): fake
// Airtable, fake Stripe, captured email and Telegram.
//   npm run build && HOLIDAY_LOCAL_PORT=4791 node scripts/holiday-local.mjs   (one terminal)
//   node scripts/test-jfp-charges-flow.mjs 4791                              (another)
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
const telegrams = () => getJson('/__telegram')
const kv = async (cmd) => (await fetch(`${B}/__kv?cmd=${encodeURIComponent(JSON.stringify(cmd))}`)).text()
async function signIn(c, email, audience) {
  const s = await c.call('/api/jfp-auth', { action: 'start', email, audience })
  assert.equal(s.status, 200, JSON.stringify(s.data))
  const code = (await emails()).filter((e) => e.to.includes(email) && /sign-in code/.test(e.subject)).at(-1).subject.match(/(\d{6})/)[1]
  assert.equal((await c.call('/api/jfp-auth', { action: 'verify', challenge: s.data.challenge, code })).status, 200)
}
const lee = client()
await signIn(lee, 'leejones@jonerfootball.com', 'staff')
const portal = (action, body = {}) => lee.call('/api/jfp-portal-data', { action, ...body })
const ok = async (action, body = {}) => { const r = await portal(action, body); assert.equal(r.status, 200, `${action}: ${JSON.stringify(r.data)}`); return r.data }
const money = async () => (await ok('money', { fresh: true })).money
const extra = async () => (await ok('extraMoney')).extra
const payreq = async (id) => JSON.parse(await kv(['GET', `jfp:payreq:${id}`]))
async function mockPay(url, extraQs = '') {
  const cs = url.split('cs=')[1]
  const r = await fetch(`${B}/mock-stripe/?cs=${cs}&action=pay${extraQs}`, { redirect: 'manual' })
  assert.equal(r.status, 302)
  return { cs, back: r.headers.get('location') }
}

// A family of one with a waiver on file and an email: they sign in and pay.
const players = (await ok('playersList')).players
const famRow = players.find((p) => p.email && p.holdsPlace && p.waiver?.onFile && players.filter((x) => x.email === p.email).length === 1)
assert.ok(famRow, 'the harness has a family with a waiver')
const fam = client()
await signIn(fam, famRow.email, 'parent')
const account = async () => (await fam.call('/api/jfp-account', { action: 'overview' })).data
const fees = async () => (await fam.call('/api/jfp-account', { action: 'fees' })).data.fees
const kpiKeys = Object.keys((await money()).kpis).sort()

await test('every portal link names its player: a quick link with no player needs a reason; the player goes on Stripe', async () => {
  const no = await portal('quickLink', { amountCents: 12000, forText: 'Extra session', programme: 'extra' })
  assert.deepEqual([no.status, no.data.code], [400, 'player'])
  const why = (await ok('quickLink', { amountCents: 1500, forText: 'Raffle', programme: 'other', noPlayerReason: 'Raffle ticket, no player' })).link
  assert.equal((await payreq(why.id)).noPlayerReason, 'Raffle ticket, no player')
  const l = (await ok('quickLink', { rowId: famRow.rowId, amountCents: 12000, forText: 'Extra session', programme: 'extra' })).link
  const p = await client().call('/api/jfp-pay', { action: 'pay', id: l.id })
  assert.equal(p.status, 200, JSON.stringify(p.data))
  const s = (await sessions()).find((x) => x.url === p.data.url)
  assert.equal(s.product_name, `Joner Football: Extra session (${famRow.name})`)
  assert.deepEqual([s.metadata.jfpPlayer, s.metadata.jfpRowIds, s.metadata.jfpProgramme, s.piMetadata.jfpPlayer], [famRow.name, famRow.rowId, 'extra', famRow.name])
  await ok('cancelPayreq', { id: l.id })
})

await test('a payment link from a player row carries the player and row in Stripe metadata when the family pays it', async () => {
  const r = await ok('sendPaymentLink', { rowIds: [famRow.rowId], amountCents: 4200 })
  assert.equal((await fam.call('/api/jfp-account', { action: 'confirmKit', payreqId: r.payreq.id, kit: 'has' })).status, 200)
  const p = await fam.call('/api/jfp-account', { action: 'pay', payreqId: r.payreq.id })
  assert.equal(p.status, 200, JSON.stringify(p.data))
  const s = (await sessions()).find((x) => x.url === p.data.url)
  assert.deepEqual([s.metadata.jfpPlayer, s.metadata.jfpRowIds, s.metadata.jfpBookingId], [famRow.name, famRow.rowId, r.payreq.id])
  assert.ok(s.product_name.includes(famRow.name))
  await ok('cancelPayreq', { id: r.payreq.id })
})

await test('Match to player: a raw Stripe link is flagged once, matched as an extra session and remembered; the next one matches itself and is never flagged', async () => {
  const before = await money()
  const tg0 = (await telegrams()).length
  const first = await (await fetch(`${B}/__stripe-seed`, { method: 'POST', body: JSON.stringify({ cents: 12000, email: 'coach.link.payer@example.com', name: 'Q Linkpayer', link: 'plink_coach120', fire: true }) })).json()
  const m1 = await money()
  const u = m1.unmatched.find((x) => x.id === first.id)
  assert.ok(u, 'on Stripe payments not matched')
  assert.equal(u.linkId, 'plink_coach120')
  assert.ok((await telegrams()).slice(tg0).some((t) => /not matched to a player/.test(t.text)), 'flagged on Telegram')
  assert.equal((await portal('stripeMatch', { paymentId: first.id, rowIds: [famRow.rowId], as: 'extra', remember: 'nowhere' })).status, 200, 'an unknown remember is just not remembered')
  const m2 = await money()
  assert.ok(!m2.unmatched.some((x) => x.id === first.id), 'off the not matched list')
  assert.equal(m2.kpis.stripeCents, before.kpis.stripeCents, 'an extra session is not JFP term income')
  assert.deepEqual(Object.keys(m2.kpis).sort(), kpiKeys, 'the money keys are the same')
  assert.equal((await portal('stripeMatch', { paymentId: first.id, rowIds: [famRow.rowId], as: 'extra' })).status, 409, 'never twice')
  assert.equal((await portal('recordPayment', { rowIds: [famRow.rowId], method: 'Stripe', stripeSessionId: first.id })).status, 409, 'nor onto the term fee')
  // The second payment on the same link, matched by remembering the link this time.
  const second = await (await fetch(`${B}/__stripe-seed`, { method: 'POST', body: JSON.stringify({ cents: 12000, email: 'someone.else@example.com', name: 'R Other', link: 'plink_coach120' }) })).json()
  const r = await ok('stripeMatch', { paymentId: second.id, rowIds: [famRow.rowId], as: 'extra', remember: 'link' })
  assert.equal(r.remembered, 'link:plink_coach120')
  assert.ok((await ok('stripeMatchRules')).rules.some((x) => x.key === 'link:plink_coach120' && x.players[0] === famRow.name))
  const tg1 = (await telegrams()).length
  const third = await (await fetch(`${B}/__stripe-seed`, { method: 'POST', body: JSON.stringify({ cents: 12000, email: 'third.payer@example.com', name: 'S Third', link: 'plink_coach120', fire: true }) })).json()
  const m3 = await money()
  assert.ok(!m3.unmatched.some((x) => x.id === third.id), 'matched by the remembered link at the Stripe sync')
  const tg = (await telegrams()).slice(tg1).map((t) => t.text).join('\n')
  assert.ok(!/not matched to a player/.test(tg), 'and not flagged')
  assert.match(tg, /matched by the remembered payment link, extra session/)
  assert.equal((await kv(['GET', `jfp:stripe-flagged:${third.id}`])), 'matched')
  const x = await extra()
  assert.equal(x.lines.filter((l) => l.kind === 'stripe' && l.who === famRow.name && l.takenCents === 12000).length, 3)
  assert.equal(m3.kpis.stripeCents, before.kpis.stripeCents)
  await ok('stripeMatchForget', { key: 'link:plink_coach120' })
  assert.ok(!(await ok('stripeMatchRules')).rules.some((y) => y.key === 'link:plink_coach120'))
})

await test('createPlayerCharge: idempotent on ref, in the family\'s Home and Fees with Pay, paid by card, in Extra sessions, never JFP income', async () => {
  const before = await money()
  const row0 = before.players.find((p) => p.rowId === famRow.rowId)
  const body = { rowId: famRow.rowId, amountCents: 9000, kind: 'extra', sessionDate: '2026-10-18', coachId: 'dean', label: 'Extra session, Saturday', ref: 'flow-1' }
  const a = await ok('createCharge', body)
  const b = await ok('createCharge', body)
  assert.deepEqual([a.existing, b.existing, b.charge.id, b.payreqId], [false, true, a.charge.id, a.payreqId], 'the same ref gives the same charge')
  assert.equal((await portal('createCharge', { ...body, rowId: players.find((p) => p.rowId !== famRow.rowId && p.email).rowId })).status, 409, 'the same ref for another player is refused')
  const q = await payreq(a.payreqId)
  assert.deepEqual([q.reason, q.term4Ids, q.programme, q.status], ['charge', [], 'extra', 'open'])
  const o = await account()
  const todo = o.todo.find((t) => t.id === a.payreqId)
  assert.ok(todo, 'on Home with Pay')
  assert.deepEqual([todo.needsKit, todo.amountLabel, todo.group], [false, 'A$90', 'Extra session, Saturday'])
  const p = await fam.call('/api/jfp-account', { action: 'pay', payreqId: a.payreqId })
  assert.equal(p.status, 200, JSON.stringify(p.data))
  const s = (await sessions()).find((x) => x.url === p.data.url)
  assert.deepEqual([s.metadata.jfpProgramme, s.metadata.jfpCharge, s.metadata.jfpPlayer], ['extra', a.charge.id, famRow.name])
  await mockPay(p.data.url)
  const paid = await payreq(a.payreqId)
  assert.deepEqual([paid.status, paid.effects.charge.status, paid.effects.airtable], ['paid', 'done', undefined])
  const x = await extra()
  const line = x.lines.find((l) => l.chargeId === a.charge.id)
  assert.deepEqual([line.kind, line.takenCents, line.coachId, line.sessionDate], ['stripe', 9000, 'dean', '2026-10-18'])
  assert.ok(x.byCoach.some((c) => c.id === 'dean'))
  const m = await money()
  assert.equal(m.kpis.stripeCents, before.kpis.stripeCents, 'not JFP term income')
  const row1 = m.players.find((p) => p.rowId === famRow.rowId)
  assert.deepEqual([row1.paidCents, row1.feeCents], [row0.paidCents, row0.feeCents], 'the term row is untouched')
  const f = await fees()
  assert.ok(f.records.some((r) => r.id === a.payreqId && r.programme === 'Extra sessions' && r.what === 'Extra session, Saturday'), 'in Fees, paid')
  assert.ok((await emails()).some((e) => e.to.includes(famRow.email) && e.subject === 'Payment received: Extra session, Saturday'))
  // Bank or cash for an offline booking: recorded here, and the request reads paid.
  const c2 = await ok('createCharge', { rowId: famRow.rowId, amountCents: 5000, kind: 'analysis', label: 'Video analysis', ref: 'flow-2' })
  assert.equal((await portal('chargeRecord', { id: c2.charge.id, method: 'bank', amountCents: 6000 })).status, 400, 'never more than is owed')
  await ok('chargeRecord', { id: c2.charge.id, method: 'bank', amountCents: 2000 })
  assert.equal((await payreq(c2.payreqId)).amountCents, 3000, 'the request asks for the rest')
  await ok('chargeRecord', { id: c2.charge.id, method: 'cash' })
  const q2 = await payreq(c2.payreqId)
  assert.deepEqual([q2.status, q2.paidOffline, q2.paidMethod], ['paid', true, 'cash'])
  assert.ok(!(await account()).todo.some((t) => t.id === c2.payreqId))
  const c3 = await ok('createCharge', { rowId: famRow.rowId, amountCents: 5000, label: 'Cancel me', ref: 'flow-3' })
  await ok('chargeCancel', { id: c3.charge.id })
  assert.equal((await payreq(c3.payreqId)).status, 'cancelled')
})

await test('a JFP invoice: draft, email preview, Send, viewed, paid by card on its page, recorded on the player\'s row', async () => {
  await ok('saveSettings', { config: { invoice: { accountName: 'Example Football Trust', bsb: '062-000', accountNumber: '12345678', reference: 'INV-<n> <player>', abn: '' } } })
  assert.equal((await portal('saveSettings', { config: { invoice: { accountName: 'X', bsb: '12', accountNumber: '12345678' } } })).status, 400)
  const before = (await money()).players.find((p) => p.rowId === famRow.rowId)
  const d = await ok('invoiceSave', { programme: 'jfp', rowIds: [famRow.rowId], lines: [{ description: 'Term 4 small group', qty: 1, unitCents: 3300 }], dueDate: '2026-10-31', notes: 'Thanks for training with us.' })
  const inv = d.invoice
  assert.match(inv.id, /^INV-\d{4,}$/)
  assert.deepEqual([inv.status, inv.totalCents, inv.gstCents, inv.email], ['draft', 3300, 300, famRow.email])
  assert.match(d.email.html, /Includes GST of A\$3/)
  assert.equal(d.view.bank.reference, `${inv.id} ${famRow.name.split(' ')[0]}`)
  const token = new URL(inv.url).searchParams.get('i')
  assert.ok(token.length >= 24)
  const pub = client()
  const v0 = await pub.call('/api/jfp-invoice', { action: 'view', token })
  assert.deepEqual([v0.status, v0.data.invoice.draft, v0.data.invoice.canPayCard], [200, true, false])
  assert.equal((await pub.call('/api/jfp-invoice', { action: 'view', token: 'x'.repeat(32) })).status, 404, 'a wrong token finds nothing')
  const e0 = (await emails()).length
  const sent = await ok('invoiceSend', { id: inv.id, sendEmail: true })
  assert.deepEqual([sent.emailed, sent.invoice.status], [true, 'sent'])
  const mail = (await emails()).slice(e0).find((e) => e.subject === `Invoice ${inv.id} from Joner Football`)
  assert.ok(mail && mail.to.includes(famRow.email) && mail.html.includes(token), 'emailed with its link')
  assert.ok(!/—/.test(mail.html), 'no em dashes in customer copy')
  assert.ok((await account()).todo.some((t) => t.id === sent.invoice.payreqId && !t.needsKit), 'in the family\'s Home and Fees with Pay')
  const v1 = await pub.call('/api/jfp-invoice', { action: 'view', token })
  assert.equal(v1.data.invoice.status, 'viewed')
  assert.equal((await ok('invoiceGet', { id: inv.id })).invoice.status, 'viewed')
  assert.ok(!JSON.stringify(v1.data).includes('leejones@'), 'no staff email on the family page')
  const p = await pub.call('/api/jfp-invoice', { action: 'pay', token })
  assert.equal(p.status, 200, JSON.stringify(p.data))
  const s = (await sessions()).find((x) => x.url === p.data.url)
  assert.deepEqual([s.metadata.jfpInvoice, s.metadata.jfpPlayer, s.metadata.jfpRowIds, s.metadata.jfpBookingId, s.amount_total], [inv.id, famRow.name, famRow.rowId, sent.invoice.payreqId, 3300])
  const { cs, back } = await mockPay(p.data.url)
  assert.equal(back, `${B}/jfp-invoice/?i=${token}&session_id=${cs}`)
  const c = await pub.call('/api/jfp-invoice', { action: 'confirm', token, sessionId: cs })
  assert.deepEqual([c.data.status, c.data.invoice.status, c.data.invoice.owingCents], ['paid', 'paid', 0])
  const after = (await money()).players.find((p2) => p2.rowId === famRow.rowId)
  assert.equal(after.paidCents, before.paidCents + 3300, 'on the row, like any JFP link')
  assert.equal((await ok('invoiceList')).invoices.find((x) => x.id === inv.id).status, 'paid')
  assert.equal((await portal('invoiceVoid', { id: inv.id })).status, 409, 'a paid invoice cannot be voided')
})

await test('an Extra sessions invoice paid by bank transfer: the INV reference is matched on Bank transfers to check and recorded on the invoice and the player', async () => {
  const d = await ok('invoiceSave', { programme: 'extra', rowIds: [famRow.rowId], lines: [{ description: 'Extra session', qty: 2, unitCents: 9000 }] })
  const inv = (await ok('invoiceSend', { id: d.invoice.id, sendEmail: false })).invoice
  assert.ok(inv.chargeId, 'an Extra sessions invoice is a player charge')
  const bank = JSON.parse(await kv(['GET', 'jfp:xero-bank-in']))
  const day = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
  const id = 'XERO-00000009-aaaa-4bbb-8ccc-000000000099'
  bank.items.push({ id, date: day, cents: 18000, payer: 'Q Nobodyknown', description: 'Fast Transfer From Q Nobodyknown', reference: `${inv.id.replace('-', '')} ${famRow.name.split(' ')[0]}`, reconciled: true })
  await kv(['SET', 'jfp:xero-bank-in', JSON.stringify(bank)])
  const check = (await ok('bankCheck')).bank
  const line = check.items.find((x) => x.id === id)
  assert.ok(line, 'shown, though the payer is on no row')
  assert.deepEqual([line.grade, line.invoice.id, line.invoice.exact], ['high', inv.id, true])
  const r = await ok('bankInvoice', { id, invoiceId: inv.id })
  assert.equal(r.invoice.status, 'paid')
  assert.equal((await portal('bankInvoice', { id, invoiceId: inv.id })).status, 409, 'never twice')
  assert.equal((await portal('recordPayment', { rowIds: [famRow.rowId], amountCents: 18000, method: 'bank', externalId: id })).status, 409, 'nor for a player')
  assert.ok(!(await ok('bankCheck')).bank.items.some((x) => x.id === id), 'off the list')
  const x = await extra()
  assert.ok(x.lines.some((l) => l.chargeId === inv.chargeId && l.kind === 'bank' && l.takenCents === 18000))
  assert.equal((await payreq(inv.payreqId)).status, 'paid')
  const f = await fees()
  assert.ok(f.records.some((y) => y.id === inv.payreqId && y.method === 'Bank transfer'))
})

await test('a JFP invoice part paid by bank (reference matched), the rest by card; void; staff list filters; coaches cannot', async () => {
  const d = await ok('invoiceSave', { programme: 'jfp', rowIds: [famRow.rowId], lines: [{ description: 'Term fee balance', qty: 1, unitCents: 2000 }] })
  const inv = (await ok('invoiceSend', { id: d.invoice.id })).invoice
  const bank = JSON.parse(await kv(['GET', 'jfp:xero-bank-in']))
  const id = 'XERO-00000010-aaaa-4bbb-8ccc-000000000100'
  bank.items.push({ id, date: new Date(Date.now() - 86400000).toISOString().slice(0, 10), cents: 500, payer: 'Q Nobodyknown', description: 'Transfer', reference: inv.id, reconciled: true })
  await kv(['SET', 'jfp:xero-bank-in', JSON.stringify(bank)])
  const before = (await money()).players.find((p) => p.rowId === famRow.rowId)
  const r = await ok('bankInvoice', { id, invoiceId: inv.id })
  assert.deepEqual([r.invoice.status, r.invoice.owingCents], ['part', 1500])
  assert.equal((await money()).players.find((p) => p.rowId === famRow.rowId).paidCents, before.paidCents + 500, 'the bank part is on the row and in the ledger')
  assert.equal((await payreq(inv.payreqId)).amountCents, 1500)
  const token = new URL(inv.url).searchParams.get('i')
  const p = await client().call('/api/jfp-invoice', { action: 'pay', token })
  assert.equal((await sessions()).find((x) => x.url === p.data.url).amount_total, 1500)
  await mockPay(p.data.url)
  assert.equal((await ok('invoiceGet', { id: inv.id })).invoice.status, 'paid')
  const v = await ok('invoiceSave', { programme: 'other', rowIds: [famRow.rowId], lines: [{ description: 'Kit', qty: 1, unitCents: 6000 }] })
  assert.equal((await ok('invoiceSave', { id: v.invoice.id, programme: 'other', rowIds: [famRow.rowId], lines: [{ description: 'Kit', qty: 1, unitCents: 6500 }] })).invoice.totalCents, 6500, 'a draft can be edited')
  const vs = (await ok('invoiceSend', { id: v.invoice.id })).invoice
  assert.equal((await portal('invoiceSave', { id: v.invoice.id, programme: 'other', rowIds: [famRow.rowId], lines: [{ description: 'Kit', qty: 1, unitCents: 7000 }] })).status, 409, 'a sent invoice cannot')
  await ok('invoiceVoid', { id: v.invoice.id })
  assert.equal((await payreq(vs.payreqId)).status, 'cancelled')
  assert.equal((await client().call('/api/jfp-invoice', { action: 'pay', token: new URL(vs.url).searchParams.get('i') })).status, 410)
  const list = await ok('invoiceList')
  assert.ok(list.counts.paid >= 3 && list.counts.void >= 1)
  const coach = client()
  await signIn(coach, 'jonerfootballsam@gmail.com', 'staff')
  for (const action of ['invoiceList', 'invoiceSave', 'createCharge', 'stripeMatch', 'extraMoney', 'bankInvoice']) assert.equal((await coach.call('/api/jfp-portal-data', { action })).status, 403, action)
})

await test('the family books an extra session: public cards (no coach names), a private link, hold then charge then pay; a retry never makes two; full is said plainly', async () => {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date(Date.now() + 3 * 86400000))
  const pubSlot = (await ok('extraSave', { slot: { coachId: 'dean', date: day, time: '7:30am', capacity: 1, location: 'Belrose HQ', priceCents: 7000, title: 'Extra 1 on 1', visibility: 'public' } })).slot
  const privSlot = (await ok('extraSave', { slot: { coachId: 'sam', date: day, time: '9:00am', capacity: 2, location: 'Belrose HQ', priceCents: 6500, title: 'Private 1 on 1', visibility: 'private' } })).slot
  const o = await account()
  const card = o.extras.bookable.find((x) => x.id === pubSlot.id)
  assert.ok(card, 'the public session is on the page')
  assert.deepEqual([card.coachName, card.coachId, card.priceLabel, card.placesLeft], [undefined, undefined, 'A$70', 1], 'no coach for families')
  assert.ok(!o.extras.bookable.some((x) => x.id === privSlot.id), 'a private one only with its link')
  const k = new URLSearchParams(privSlot.link.split('?')[1]).get('k')
  assert.equal((await fam.call('/api/jfp-account', { action: 'extraSlot', slotId: privSlot.id, k: 'wrong' })).status, 404)
  const ps = await fam.call('/api/jfp-account', { action: 'extraSlot', slotId: privSlot.id, k })
  assert.deepEqual([ps.status, ps.data.slot.coachName], [200, undefined])
  assert.equal((await fam.call('/api/jfp-account', { action: 'bookExtra', slotId: privSlot.id, playerKey: o.players[0].key })).status, 404, 'a private session needs its key')
  const me = o.players.find((p) => p.name === famRow.name)
  const b1 = await fam.call('/api/jfp-account', { action: 'bookExtra', slotId: pubSlot.id, playerKey: me.key })
  assert.equal(b1.status, 200, JSON.stringify(b1.data))
  const s1 = (await sessions()).find((x) => x.url === b1.data.url)
  assert.deepEqual([s1.metadata.jfpProgramme, s1.metadata.jfpPlayer, s1.amount_total], ['extra', famRow.name, 7000])
  const list = async () => (await ok('extraList', { coachId: '' })).slots
  const bk = (await list()).find((x) => x.id === pubSlot.id).bookings
  assert.equal(bk.length, 1)
  const q = await payreq(bk[0].payreqId)
  assert.deepEqual([q.reason, q.charge.kind, q.playerNames, q.amountCents], ['charge', 'extra', [famRow.name], 7000])
  const charge = JSON.parse(await kv(['GET', `jfp:charge:${q.charge.id}`]))
  assert.deepEqual([charge.ref, charge.coachId, charge.sessionDate], [`extra:${pubSlot.id}:${bk[0].id}`, 'dean', day])
  // A retry (a double tap, back from Stripe): the same place and the same charge.
  const b2 = await fam.call('/api/jfp-account', { action: 'bookExtra', slotId: pubSlot.id, playerKey: me.key })
  assert.equal(b2.status, 200, JSON.stringify(b2.data))
  assert.equal((await list()).find((x) => x.id === pubSlot.id).bookings.length, 1)
  const sameRef = []
  for (const id of JSON.parse(await kv(['ZRANGE', 'jfp:charges', '0', '-1']))) { const c = JSON.parse(await kv(['GET', `jfp:charge:${id}`])); if (c.ref === charge.ref) sameRef.push(c.id) }
  assert.deepEqual(sameRef, [charge.id], 'one charge for the booking')
  assert.ok((await account()).todo.some((t) => t.id === q.id), 'in Home and Fees with Pay')
  await mockPay(b2.data.url)
  const paidView = (await list()).find((x) => x.id === pubSlot.id).bookings[0]
  assert.deepEqual([paidView.paid, paidView.payStatus], [true, 'paid'], 'the coach sees Paid')
  assert.ok((await extra()).lines.some((l) => l.chargeId === q.charge.id && l.coachId === 'dean'))
  const b3 = await fam.call('/api/jfp-account', { action: 'bookExtra', slotId: pubSlot.id, playerKey: me.key })
  assert.deepEqual([b3.status, b3.data.paid], [200, true], 'booked and paid already')
  // Another family: the session is full.
  const other = players.find((p) => p.email && p.holdsPlace && !p.waiver?.onFile && p.email !== famRow.email && players.filter((x) => x.email === p.email).length === 1)
  const fam2 = client()
  await signIn(fam2, other.email, 'parent')
  let o2 = (await fam2.call('/api/jfp-account', { action: 'overview' })).data
  const kid = o2.players[0]
  // No waiver: nothing is held.
  const nw = await fam2.call('/api/jfp-account', { action: 'bookExtra', slotId: privSlot.id, k, playerKey: kid.key })
  assert.deepEqual([nw.status, nw.data.code], [400, 'waiver'])
  assert.equal((await list()).find((x) => x.id === privSlot.id).bookings.length, 0)
  const sw = await fam2.call('/api/jfp-account', { action: 'signWaiver', players: [{ key: kid.key, dob: '2013-05-05', emergencyName: 'Gran Sample', emergencyPhone: '0400 777 889' }], waiver: { accepted: { terms: true, makeups: true, payment: true, emergency: true }, media: false, kind: 'guardian', signature: 'Pat Sample' }, parentName: 'Pat Sample', mobile: '0400 777 888' })
  assert.equal(sw.status, 200, JSON.stringify(sw.data))
  o2 = (await fam2.call('/api/jfp-account', { action: 'overview' })).data
  const full = await fam2.call('/api/jfp-account', { action: 'bookExtra', slotId: pubSlot.id, playerKey: kid.key })
  assert.deepEqual([full.status, full.data.error], [409, 'That session is full.'])
  // The private session by its link.
  const pv = await fam2.call('/api/jfp-account', { action: 'bookExtra', slotId: privSlot.id, k, playerKey: kid.key })
  assert.equal(pv.status, 200, JSON.stringify(pv.data))
  assert.equal((await sessions()).find((x) => x.url === pv.data.url).amount_total, 6500)
  assert.equal((await list()).find((x) => x.id === privSlot.id).bookings[0].payStatus, 'checkout', 'the coach sees it is being paid')
})

console.log(`\n${passed} charges and invoices flow checks passed`)
