// Prices and quick payment links, end to end against the local harness
// (Lee, 13 Oct 2026): fake Airtable, fake Stripe, captured email.
//   npm run build && HOLIDAY_LOCAL_PORT=4511 node scripts/holiday-local.mjs   (one terminal)
//   node scripts/test-jfp-quick-flow.mjs 4511                                (another)
// Every name, email and amount here is invented.
import assert from 'node:assert/strict'
import fs from 'node:fs'

const PORT = Number(process.argv[2] || 4321)
const B = `http://localhost:${PORT}`
let passed = 0
async function test(name, fn) { await fn(); passed += 1; console.log(`ok - ${name}`) }

function client() {
  const jar = new Map()
  const call = async (path, body, headers = {}) => {
    const res = await fetch(`${B}${path}`, { method: body ? 'POST' : 'GET', redirect: 'manual', headers: { 'content-type': 'application/json', origin: B, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '), ...headers }, body: body ? JSON.stringify(body) : undefined })
    for (const c of res.headers.getSetCookie?.() || []) { const [kv] = c.split(';'); const i = kv.indexOf('='); if (kv.slice(i + 1)) jar.set(kv.slice(0, i), kv.slice(i + 1)); else jar.delete(kv.slice(0, i)) }
    return { status: res.status, data: await res.json().catch(() => ({})) }
  }
  return { call, jar }
}
const emails = async () => (await fetch(`${B}/__emails`)).json()
const at = async () => (await fetch(`${B}/__airtable`)).json()
const kv = async (cmd) => (await fetch(`${B}/__kv?cmd=${encodeURIComponent(JSON.stringify(cmd))}`)).text()
async function signIn(c, email, audience = 'staff') {
  const s = await c.call('/api/jfp-auth', { action: 'start', email, audience })
  assert.equal(s.status, 200, JSON.stringify(s.data))
  const code = (await emails()).filter((e) => e.to.includes(email) && /sign-in code/.test(e.subject)).at(-1).subject.match(/(\d{6})/)[1]
  assert.equal((await c.call('/api/jfp-auth', { action: 'verify', challenge: s.data.challenge, code })).status, 200)
}
const lee = client()
await signIn(lee, 'leejones@jonerfootball.com')
const portal = (action, body = {}) => lee.call('/api/jfp-portal-data', { action, ...body })
const ok = async (action, body = {}) => { const r = await portal(action, body); assert.equal(r.status, 200, `${action}: ${JSON.stringify(r.data)}`); return r.data }
const pay = (body) => client().call('/api/jfp-pay', body)
const record = async (id) => JSON.parse(await kv(['GET', `jfp:payreq:${id}`]))
// The family opens the link, goes to Stripe and pays (the webhook fires).
async function payLink(id, { email = '', name = '' } = {}) {
  const v = await pay({ action: 'view', id })
  assert.equal(v.status, 200, JSON.stringify(v.data))
  const p = await pay({ action: 'pay', id })
  assert.equal(p.status, 200, JSON.stringify(p.data))
  const cs = p.data.url.split('cs=')[1]
  const r = await fetch(`${B}/mock-stripe/?cs=${cs}&action=pay${email ? `&email=${encodeURIComponent(email)}` : ''}${name ? `&name=${encodeURIComponent(name)}` : ''}`, { redirect: 'manual' })
  assert.equal(r.status, 302)
  assert.equal(r.headers.get('location'), `${B}/jfp-pay/?q=${id}&session_id=${cs}`, 'back to the link\'s own page')
  return cs
}
const links = async () => (await ok('payments')).payreqs
const money = async () => (await ok('money', { fresh: true })).money

const players = (await ok('playersList')).players
const famRow = players.find((p) => p.email && p.holdsPlace && players.filter((x) => x.email === p.email).length === 1)
const otherRow = players.find((p) => p.email && p.holdsPlace && p.email !== famRow.email && p.rowId !== famRow.rowId)
const kpiKeys = Object.keys((await money()).kpis).sort()

await test('Prices: add, edit, archive and restore your own; the JFP price list keeps its keys; wrong asks refused', async () => {
  const a = await ok('savePrice', { price: { name: 'Holiday camp day', amountCents: 6500, programme: 'holiday', perSession: true, description: 'Full day' } })
  assert.match(a.price.id, /^PR-\d+-[0-9A-F]{6}$/)
  const camp = a.price.id
  const b = await ok('savePrice', { price: { name: 'Kit fee', amountCents: 6000, programme: 'other' } })
  const kit = b.price.id
  await ok('savePrice', { price: { id: kit, name: 'Kit fee', amountCents: 6500, programme: 'other' } })
  let pr = await ok('pricing')
  assert.deepEqual(pr.priceList.filter((p) => !p.builtin).map((p) => [p.name, p.cents, p.programme, p.perSession]), [['Holiday camp day', 6500, 'holiday', true], ['Kit fee', 6500, 'other', false]])
  assert.equal(pr.priceList.filter((p) => p.builtin).length, pr.products.length, 'the JFP price list is in the same list')
  // The term price list, edited here, is still config.prices.
  await ok('savePrice', { price: { id: 'jfp:trial', amountCents: 9000 } })
  pr = await ok('pricing')
  assert.deepEqual([pr.prices.trial, pr.products.find((x) => x.key === 'trial').cents, pr.prices.group], [9000, 9000, 85000])
  await ok('savePrice', { price: { id: 'jfp:trial', amountCents: 8500 } })
  for (const [body, status] of [[{ name: '', amountCents: 500, programme: 'jfp' }, 400], [{ name: 'X', amountCents: 10, programme: 'jfp' }, 400], [{ name: 'X', amountCents: 500, programme: 'camps' }, 400], [{ id: 'PR-404-ABCDEF', name: 'X', amountCents: 500, programme: 'jfp' }, 404], [{ id: 'jfp:nothing', amountCents: 500 }, 404], [{ id: 'jfp:group', amountCents: 0 }, 400]]) assert.equal((await portal('savePrice', { price: body })).status, status, JSON.stringify(body))
  assert.equal((await portal('archivePrice', { id: 'jfp:group' })).status, 400, 'the JFP price list stays')
  await ok('archivePrice', { id: kit })
  assert.equal((await ok('pricing')).priceList.find((p) => p.id === kit).archived, true)
  assert.equal((await portal('quickLink', { priceId: kit })).status, 400, 'an archived price makes no new links')
  await ok('archivePrice', { id: kit, undo: true })
  assert.equal((await ok('pricing')).priceList.find((p) => p.id === kit).archived, false)
  // Settings saves keep them.
  await ok('saveSettings', { config: { kitNote: 'Order before the first session.' } })
  assert.equal((await ok('pricing')).priceList.filter((p) => !p.builtin).length, 2)
  // Two adds at once: neither is lost.
  const two = await Promise.all(['Clinic A', 'Clinic B'].map((name) => portal('savePrice', { price: { name, amountCents: 2500, programme: 'jfp' } })))
  const added = (await ok('pricing')).priceList.filter((p) => /^Clinic [AB]$/.test(p.name)).length
  assert.equal(added, two.filter((r) => r.status === 200).length, two.map((r) => r.status).join(' '))
  assert.ok(two.every((r) => [200, 409].includes(r.status)))
  globalThis.CAMP = camp; globalThis.KIT = kit
})

await test('a JFP quick link with no player: paid on its own page, staff told, waits on not matched (never put on a family by email), then matched', async () => {
  const before = await money()
  const famBefore = before.players.filter((p) => p.email === famRow.email).reduce((t, p) => t + p.stripeCents, 0)
  const mail0 = (await emails()).length
  const q = (await ok('quickLink', { amountCents: 8500, forText: 'Extra session', programme: 'jfp' })).link
  assert.match(q.url, /\/jfp-pay\/\?q=PAY-/)
  assert.equal((await emails()).length, mail0, 'making a link sends nothing')
  const cs = await payLink(q.id, { email: famRow.email, name: 'Pat Payer' })
  const r = await record(q.id)
  assert.deepEqual([r.status, r.paidCents, r.payerEmail, r.payerName, r.effects.staffAlert.status], ['paid', 8500, famRow.email, 'Pat Payer', 'done'])
  const mail = (await emails()).slice(mail0)
  assert.deepEqual(mail.map((e) => e.subject), ['Quick link paid: Extra session, A$85'], 'staff told; no receipt pretending a place was booked')
  assert.ok(mail[0].html.includes('Money &gt; JFP'))
  const confirm = await pay({ action: 'confirm', id: q.id, sessionId: cs })
  assert.deepEqual([confirm.status, confirm.data.status], [200, 'paid'])
  const m = await money()
  const u = m.unmatched.find((x) => x.id === cs)
  assert.ok(u, 'on the not matched list')
  assert.deepEqual([u.quickLink, u.product, u.cents], [q.id, 'Quick link: Extra session', 8500])
  assert.equal(m.players.filter((p) => p.email === famRow.email).reduce((t, p) => t + p.stripeCents, 0), famBefore, 'not added to the family whose email paid')
  assert.equal(m.kpis.stripeCents, before.kpis.stripeCents + 8500, 'JFP is JFP income')
  assert.deepEqual(Object.keys(m.kpis).sort(), kpiKeys, 'the money keys are the same')
  // Matched to a player, like any other payment on the list.
  const rec = await portal('recordPayment', { rowIds: [famRow.rowId], method: 'Stripe', stripeSessionId: cs })
  assert.equal(rec.status, 200, JSON.stringify(rec.data))
  const m2 = await money()
  assert.ok(!m2.unmatched.some((x) => x.id === cs), 'matched: off the list')
  assert.equal(m2.players.find((p) => p.rowId === famRow.rowId).receivedCents, before.players.find((p) => p.rowId === famRow.rowId).receivedCents + 8500)
  assert.equal((await portal('recordPayment', { rowIds: [famRow.rowId], method: 'Stripe', stripeSessionId: cs })).status, 409, 'never twice')
})

await test('a JFP quick link for a player records on their row like any link; one open link per player', async () => {
  const air0 = await at()
  const row0 = air0.term4.find((r) => r.id === otherRow.rowId).fields
  const first = (await ok('quickLink', { rowId: otherRow.rowId, amountCents: 4000, forText: 'Extra session', programme: 'jfp' })).link
  assert.deepEqual([first.email, first.players], [otherRow.email, [otherRow.name]])
  const again = await portal('quickLink', { rowId: otherRow.rowId, amountCents: 5000, forText: 'Two extra sessions', programme: 'jfp' })
  assert.deepEqual([again.status, again.data.code], [409, 'link_open'])
  const q = (await ok('quickLink', { rowId: otherRow.rowId, amountCents: 5000, forText: 'Two extra sessions', programme: 'jfp', replace: true })).link
  assert.equal((await record(first.id)).status, 'cancelled', 'the old link stops working')
  assert.equal((await pay({ action: 'pay', id: first.id })).status, 410)
  const mail0 = (await emails()).length
  await payLink(q.id)
  const r = await record(q.id)
  assert.equal(r.status, 'paid')
  assert.ok(['airtable', 'ledger', 'parentEmail', 'staffAlert'].every((k) => r.effects[k].status === 'done'), JSON.stringify(r.effects))
  const row = (await at()).term4.find((x) => x.id === otherRow.rowId).fields
  assert.equal(row['Term 4 Amount Paid'], (row0['Term 4 Amount Paid'] || 0) + 50)
  assert.match(row['Term 4 Notes'], new RegExp(`\\[PAID:${q.id}\\]`))
  assert.equal((await at()).ledger.filter((l) => l.fields['Payment ID'] === r.stripePaymentIntentId).length, 1)
  const mail = (await emails()).slice(mail0)
  assert.ok(mail.some((e) => e.to.includes(otherRow.email) && /^Payment received: /.test(e.subject)), 'the family gets the usual receipt')
  // It never shows as something to pay on the family account page.
  const fam = client()
  await signIn(fam, otherRow.email, 'parent')
  const acct = await fam.call('/api/jfp-account', {})
  assert.equal(acct.status, 200, JSON.stringify(acct.data))
  assert.ok(!JSON.stringify(acct.data).includes(q.id) && !JSON.stringify(acct.data).includes(first.id))
})

await test('a holiday quick link: in Money > Holiday training for its holiday, to check until ticked, never in JFP', async () => {
  const m0 = await money()
  const q = (await ok('quickLink', { priceId: globalThis.CAMP, sessions: 2, programme: 'holiday', holidayPeriod: '2026-summer' })).link
  assert.deepEqual([q.amountLabel, q.forText, q.programme], ['A$130', 'Holiday camp day, 2 sessions', 'holiday'])
  const cs = await payLink(q.id, { email: 'holiday.payer@example.com', name: 'Holly Payer' })
  const m = await money()
  assert.ok(!m.unmatched.some((x) => x.id === cs) && !m.payments.some((x) => x.id === cs), 'not JFP money')
  assert.equal(m.kpis.stripeCents, m0.kpis.stripeCents)
  assert.deepEqual(m.otherStripe, m0.otherStripe)
  let h = (await ok('holidayMoney', { period: '2026-summer', fresh: true })).holiday
  const line = h.lines.find((x) => x.id === q.id)
  assert.ok(line, 'in the summer holidays')
  assert.deepEqual([line.status, line.takenCents, line.who, line.note, line.feeCents > 0], ['link-check', 13000, 'Holly Payer', 'Holiday camp day, 2 sessions', true])
  assert.deepEqual(h.toCheck.map((x) => x.id), [q.id])
  await ok('quickLinkChecked', { id: q.id })
  h = (await ok('holidayMoney', { period: '2026-summer', fresh: true })).holiday
  assert.deepEqual([h.toCheck.length, h.lines.find((x) => x.id === q.id).status], [0, 'link'])
  await ok('quickLinkChecked', { id: q.id, undo: true })
  assert.equal((await ok('holidayMoney', { period: '2026-summer', fresh: true })).holiday.toCheck.length, 1)
  // A refund in Stripe: on the link and in holiday money, never in the JFP ledger.
  const ledger0 = (await at()).ledger.length
  await fetch(`${B}/__refund?cs=${cs}&amount=3000`)
  assert.equal((await record(q.id)).refundedCents, 3000)
  assert.equal((await at()).ledger.length, ledger0, 'no JFP ledger row')
  h = (await ok('holidayMoney', { period: '2026-summer', fresh: true })).holiday
  assert.equal(h.lines.find((x) => x.id === q.id).refundedCents, 3000)
  globalThis.HOLIDAY_LINK = q.id
})

await test('a Joners Juniors quick link lands with the Juniors money, named for the child, not in JFP', async () => {
  const m0 = await money()
  const q = (await ok('quickLink', { rowId: famRow.rowId, amountCents: 22000, forText: 'Juniors Term 4', programme: 'juniors' })).link
  assert.deepEqual(q.players, [famRow.name])
  const cs = await payLink(q.id, { email: 'juniors.payer@example.com' })
  const r = await record(q.id)
  assert.deepEqual([r.status, r.term4Ids, r.effects.staffAlert.status], ['paid', [], 'done'], 'nothing written to the JFP row')
  const m = await money()
  assert.ok(!m.unmatched.some((x) => x.id === cs))
  assert.equal(m.otherStripe.count, m0.otherStripe.count + 1)
  const j = await portal('juniorsMoney', { fresh: true })
  assert.equal(j.status, 200, JSON.stringify(j.data))
  assert.ok(j.data.juniors.unlinked.some((u) => u.forPlayer === famRow.name && u.cents === 22000), 'on the Juniors not matched list, for that child')
})

await test('an Other quick link: on Payment links to check; Email it only on a tap, once; statuses sent, opened, paid, expired', async () => {
  const mail0 = (await emails()).length
  const q = (await ok('quickLink', { priceId: globalThis.KIT, email: 'parent.quick@example.com' })).link
  assert.deepEqual([q.programme, q.amountLabel, q.email], ['other', 'A$65', 'parent.quick@example.com'])
  assert.equal((await emails()).length, mail0, 'nothing sent until Email it')
  let l = (await links()).find((x) => x.id === q.id)
  assert.deepEqual([l.quick, l.quickStatus, l.programme, l.forText, l.url], [true, 'made', 'other', 'Kit fee', q.url])
  await ok('emailQuickLink', { id: q.id })
  const sent = (await emails()).slice(mail0)
  assert.equal(sent.length, 1)
  assert.deepEqual([sent[0].to, sent[0].subject], [['parent.quick@example.com'], 'Joner Football: Kit fee'])
  assert.ok(sent[0].html.includes(q.url))
  assert.equal((await portal('emailQuickLink', { id: q.id })).status, 409, 'a double tap sends one')
  assert.equal((await links()).find((x) => x.id === q.id).quickStatus, 'sent')
  await pay({ action: 'view', id: q.id })
  assert.equal((await links()).find((x) => x.id === q.id).quickStatus, 'opened')
  // Change the amount and email the family: the same link, its own email.
  const before = (await emails()).length
  const ch = await ok('changePayreqAmount', { id: q.id, amountCents: 7000, sendEmail: true })
  assert.deepEqual([ch.url, ch.amountLabel, ch.emailed], [q.url, 'A$70', true])
  const changed = (await emails()).slice(before)
  assert.deepEqual(changed.map((e) => [e.to, e.subject]), [[['parent.quick@example.com'], 'Joner Football: Kit fee']])
  assert.ok(changed[0].html.includes('A$70') && changed[0].html.includes(q.url))
  const noMail = (await ok('quickLink', { amountCents: 1500, forText: 'Ball', programme: 'other' })).link
  assert.equal((await portal('emailQuickLink', { id: noMail.id })).status, 400)
  await payLink(q.id, { email: 'parent.quick@example.com', name: 'Quinn Parent' })
  l = (await links()).find((x) => x.id === q.id)
  assert.deepEqual([l.quickStatus, l.toCheck, l.payerName, l.effects.ok, l.amountLabel], ['paid', true, 'Quinn Parent', true, 'A$70'])
  await ok('quickLinkChecked', { id: q.id })
  assert.equal((await links()).find((x) => x.id === q.id).toCheck, false)
  assert.equal((await portal('quickLinkChecked', { id: noMail.id })).status, 409, 'only a paid link')
  assert.equal((await portal('emailQuickLink', { id: q.id })).status, 409, 'paid: nothing to email')
  // Expired after 30 days: shown so, cannot be paid or emailed.
  const old = await record(noMail.id)
  await kv(['SET', `jfp:payreq:${noMail.id}`, JSON.stringify({ ...old, expiresAt: new Date(Date.now() - 1000).toISOString(), email: 'late@example.com' })])
  l = (await links()).find((x) => x.id === noMail.id)
  assert.deepEqual([l.status, l.quickStatus], ['expired', 'expired'])
  assert.equal((await pay({ action: 'pay', id: noMail.id })).status, 410)
  assert.equal((await pay({ action: 'view', id: noMail.id })).data.link.status, 'expired')
  assert.equal((await portal('emailQuickLink', { id: noMail.id })).status, 409)
  // Cancelled: cannot be paid.
  const c = (await ok('quickLink', { amountCents: 2000, forText: 'Cancel me', programme: 'other' })).link
  await ok('cancelPayreq', { id: c.id })
  assert.equal((await pay({ action: 'pay', id: c.id })).status, 410)
})

await test('the pay page shows only what it is for and the amount; other payments are not found there; other sites refused', async () => {
  const q = (await ok('quickLink', { rowId: otherRow.rowId, amountCents: 3300, forText: 'Socks', programme: 'other', email: 'private.parent@example.com' })).link
  const v = await pay({ action: 'view', id: q.id })
  assert.equal(v.status, 200)
  const s = JSON.stringify(v.data)
  assert.ok(!s.includes('private.parent') && !s.includes(otherRow.name) && !s.includes(otherRow.email), 'no names or emails')
  assert.deepEqual(Object.keys(v.data.link).sort(), ['afterpay', 'amountCents', 'amountLabel', 'forText', 'id', 'programme', 'status'])
  // A normal JFP link (signed in on the account page) is never found here.
  const normal = await portal('sendPaymentLink', { rowId: famRow.rowId, amountCents: 1000 })
  assert.equal(normal.status, 200, JSON.stringify(normal.data))
  assert.equal((await pay({ action: 'view', id: normal.data.payreq.id })).status, 404)
  assert.equal((await pay({ action: 'view', id: 'PAY-0000000000000-ABCDEF' })).status, 404)
  assert.equal((await pay({ action: 'view', id: '../jfp:config' })).status, 404)
  const evil = await fetch(`${B}/api/jfp-pay`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: JSON.stringify({ action: 'pay', id: q.id }) })
  assert.equal(evil.status, 403)
  assert.equal((await fetch(`${B}/api/jfp-pay?id=${q.id}`)).status, 405)
  assert.equal((await pay({ action: 'confirm', id: q.id, sessionId: 'cs_test_nothere' })).status, 404, 'a session Stripe does not know')
  assert.equal((await pay({ action: 'confirm', id: q.id, sessionId: 'not-a-session' })).status, 400)
})

await test('coaches never see or make prices or links; Lee only from this site, by POST', async () => {
  const cfg = (await ok('getSettings')).config
  await ok('saveSettings', { config: { coaches: [...cfg.coaches, { id: 'quickcoach', name: 'Quinny', fullName: 'Quinny Coach', airtableName: 'Quinny Coach', email: 'coach.quick@example.com' }] } })
  const coach = client()
  await signIn(coach, 'coach.quick@example.com')
  for (const [action, body] of [['pricing', {}], ['savePrice', { price: { name: 'X', amountCents: 500, programme: 'jfp' } }], ['archivePrice', { id: globalThis.KIT }], ['quickLink', { amountCents: 500, forText: 'x', programme: 'other' }], ['emailQuickLink', { id: globalThis.HOLIDAY_LINK }], ['quickLinkChecked', { id: globalThis.HOLIDAY_LINK }], ['payments', {}]]) assert.equal((await coach.call('/api/jfp-portal-data', { action, ...body })).status, 403, action)
  const leeCookie = [...lee.jar].map(([k, v]) => `${k}=${v}`).join('; ')
  const evil = await fetch(`${B}/api/jfp-portal-data`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: leeCookie, origin: 'https://evil.example' }, body: JSON.stringify({ action: 'quickLink', amountCents: 500, forText: 'x', programme: 'other' }) })
  assert.equal(evil.status, 403)
  assert.equal((await fetch(`${B}/api/jfp-portal-data?action=pricing`, { headers: { cookie: leeCookie, origin: B } })).status, 405)
  const log = (await ok('audit', { limit: 200 })).entries
  for (const a of ['price.add', 'price.edit', 'price.archive', 'price.restore', 'price.save', 'quick.create', 'quick.email', 'quick.check']) assert.ok(log.some((e) => e.action === a), a)
})

await test('the built pages carry Prices, Quick link and the pay page', async () => {
  const html = fs.readFileSync(new URL('../dist/jfp-portal/index.html', import.meta.url), 'utf8')
  const js = fs.readFileSync(new URL(`../dist/${html.match(/<script type="module" src="\/(_astro\/jfp-portal[^"]+\.js)"/)[1]}`, import.meta.url), 'utf8')
  for (const t of ['quickLink', 'emailQuickLink', 'savePrice', 'archivePrice', 'Quick payment link', 'Other payments to check', 'Quick links to check', 'Create link']) assert.ok(js.includes(t), `the built portal has ${t}`)
  assert.ok(fs.existsSync(new URL('../dist/jfp-pay/index.html', import.meta.url)))
})

console.log(`\n${passed} quick link flow checks passed`)
