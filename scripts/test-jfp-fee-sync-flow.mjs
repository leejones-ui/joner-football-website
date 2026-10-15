// A link follows the fee (Lee, 16 Oct 2026), end to end against the local
// harness: fake Airtable, fake Stripe, captured email. When a place's fee
// changes, the family's account, the ?pay= link and the Stripe page all ask
// for what is owing now; a link with nothing left owing is cancelled; a
// family link changes only the place whose fee moved; quick links and
// charges keep their own amounts; a page for the old amount cannot be paid
// as if it were the new one.
//   npm run build && HOLIDAY_LOCAL_PORT=4851 node scripts/holiday-local.mjs   (one terminal)
//   node scripts/test-jfp-fee-sync-flow.mjs 4851                             (another)
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
const getJson = async (p) => (await fetch(`${B}${p}`)).json()
const emails = () => getJson('/__emails')
const sessions = () => getJson('/__sessions')
const at = () => getJson('/__airtable')
const kv = async (cmd) => (await fetch(`${B}/__kv?cmd=${encodeURIComponent(JSON.stringify(cmd))}`)).text()
const payreq = async (id) => JSON.parse(await kv(['GET', `jfp:payreq:${id}`]))
const putPayreq = async (q) => kv(['SET', `jfp:payreq:${q.id}`, JSON.stringify(q)])
const row = async (id) => (await at()).term4.find((r) => r.id === id).fields
async function signIn(c, email, audience = 'parent') {
  const s = await c.call('/api/jfp-auth', { action: 'start', email, audience })
  assert.equal(s.status, 200, JSON.stringify(s.data))
  const code = (await emails()).filter((e) => e.to.includes(email) && /sign-in code/.test(e.subject)).at(-1).subject.match(/(\d{6})/)[1]
  assert.equal((await c.call('/api/jfp-auth', { action: 'verify', challenge: s.data.challenge, code })).status, 200)
}
const GUARDIAN = { accepted: { terms: true, makeups: true, payment: true, emergency: true }, media: false, kind: 'guardian' }

const lee = client()
await signIn(lee, 'leejones@jonerfootball.com', 'staff')
const portal = (action, body = {}) => lee.call('/api/jfp-portal-data', { action, ...body })
const ok = async (action, body = {}) => { const r = await portal(action, body); assert.equal(r.status, 200, `${action}: ${JSON.stringify(r.data)}`); return r.data }
const GID = (await ok('saveGroup', { group: { day: 'Tuesday', time: '6:05pm', location: 'NTRA', coachId: 'lee', capacity: 16, mode: 'direct' } })).group.id

// A family: children added on the Timetable with no payment, the fee set in
// Edit, the parent signed in with the waiver signed for every child.
let famSeq = 0
async function family(surname, kids, fees) {
  famSeq += 1
  const email = `${surname.toLowerCase()}.fam${famSeq}@example.com`
  const rowIds = []
  for (const [i, k] of kids.entries()) {
    const a = await ok('addPlayer', { groupId: GID, force: true, player: { name: `${k} ${surname}`, dob: `201${famSeq % 10}-0${i + 1}-1${famSeq % 10}` }, parent: { name: `Pat ${surname}`, email, mobile: `0400 777 ${String(100 + famSeq * 3 + i)}` }, payment: 'none', sendEmail: false })
    await ok('editPlayer', { rowId: a.rowId, fields: { feeAud: fees[i] } })
    rowIds.push(a.rowId)
  }
  const c = client()
  await signIn(c, email)
  const d = (await c.call('/api/jfp-account', { action: 'overview' })).data
  const players = d.players.map((p, i) => ({ key: p.key, dob: `201${famSeq % 10}-0${i + 1}-1${famSeq % 10}`, emergencyName: `Em ${surname}`, emergencyPhone: '0400 555 101' }))
  const w = await c.call('/api/jfp-account', { action: 'signWaiver', players, waiver: { ...GUARDIAN, signature: `Pat ${surname}` }, parentName: `Pat ${surname}`, mobile: '0400 555 102' })
  assert.equal(w.status, 200, JSON.stringify(w.data))
  const account = async (pay = '') => (await c.call('/api/jfp-account', { action: 'overview', ...(pay ? { pay } : {}) })).data
  const payNow = async (id) => {
    await c.call('/api/jfp-account', { action: 'confirmKit', payreqId: id, kit: 'has' })
    return c.call('/api/jfp-account', { action: 'pay', payreqId: id })
  }
  return { email, rowIds, c, account, payNow }
}
const sessionFor = async (url) => (await sessions()).find((s) => s.url === url)
const payAt = async (c, url) => {
  const back = await fetch(`${url}&action=pay`, { redirect: 'manual' })
  const sid = new URL(back.headers.get('location')).searchParams.get('session_id')
  return (await c.call(`/api/jfp-confirm?session_id=${sid}`)).data
}

await test('fee 850 -> 765: the link, the account and ?pay all say A$765, the open A$850 Stripe page is closed, checkout charges A$765', async () => {
  const f = await family('Feeswell', ['Ada'], [850])
  const [rid] = f.rowIds
  const link = (await ok('sendPaymentLink', { rowIds: [rid] })).payreq
  assert.equal(link.amountLabel, 'A$850')
  // The family opens Stripe's page for A$850 and goes back without paying.
  const first = await f.payNow(link.id)
  assert.equal(first.status, 200, JSON.stringify(first.data))
  const old = await sessionFor(first.data.url)
  assert.equal(old.amount_total, 85000)
  // Lee changes the fee in Edit player.
  const e = await ok('editPlayer', { rowId: rid, fields: { feeAud: 765 } })
  assert.deepEqual(e.repricedLinks.map((x) => [x.id, x.fromCents, x.amountCents]), [[link.id, 85000, 76500]])
  assert.equal(e.closedLinks.length, 0)
  const q = await payreq(link.id)
  assert.deepEqual([q.status, q.amountCents, q.stripeSessionId], ['open', 76500, ''])
  assert.ok(q.replacedSessionIds.includes(old.id))
  assert.equal((await sessions()).find((s) => s.id === old.id).status, 'expired', 'the A$850 page is closed')
  assert.equal(q.repriced.at(-1).toCents, 76500)
  // The account and the ?pay= link.
  for (const d of [await f.account(), await f.account(link.id)]) {
    assert.equal(d.todo.length, 1)
    assert.equal(d.todo[0].amountLabel, 'A$765')
    assert.equal(d.players[0].enrolments[0].payment.label, 'A$765 to pay')
  }
  // Staff see the live amount and that it moved.
  const shown = (await ok('payments')).payreqs.find((x) => x.id === link.id)
  assert.equal(shown.amountLabel, 'A$765')
  assert.equal(shown.repricedNote, 'Link updated to A$765 after the fee changed')
  const m = (await ok('money', { fresh: true })).money.players.find((p) => p.rowId === rid)
  assert.deepEqual([m.openLink.amountCents, m.openLink.note], [76500, 'Link updated to A$765 after the fee changed'])
  assert.ok((await ok('audit', { limit: 50 })).entries.some((x) => x.action === 'payreq.reprice' && x.target === link.id && x.before.cents === 85000 && x.after.cents === 76500))
  // The old page paid anyway (it was closed): flagged, never "paid" at A$850.
  await fetch(`${old.url}&action=pay`, { redirect: 'manual' })
  const after = await payreq(link.id)
  assert.equal(after.status, 'open', 'not marked paid for an amount the link no longer holds')
  assert.match(after.needsAttention, /amount-changed/)
  assert.equal((await row(rid))['Term 4 Amount Paid'] || 0, 0, 'nothing written to the row')
  // Pay: Stripe asks for A$765, and that is what is recorded.
  const p = await f.payNow(link.id)
  assert.equal(p.status, 200, JSON.stringify(p.data))
  assert.equal((await sessionFor(p.data.url)).amount_total, 76500)
  assert.equal((await payAt(f.c, p.data.url)).status, 'paid')
  const paid = await payreq(link.id)
  assert.deepEqual([paid.status, paid.paidCents], ['paid', 76500])
  const r = await row(rid)
  assert.deepEqual([r['Term 4 Amount Paid'], r['Term 4 Payment Status']], [765, 'Paid'])
})

await test('a link made before this change (the 14 Oct case): stored A$850, fee since changed to 765, read-time shows and charges A$765', async () => {
  const f = await family('Oldlink', ['Bea'], [850])
  const [rid] = f.rowIds
  const link = (await ok('sendPaymentLink', { rowIds: [rid] })).payreq
  await ok('editPlayer', { rowId: rid, fields: { feeAud: 765 } })
  // Put the record back as it was in KV before this change: no basis, A$850.
  const q = await payreq(link.id)
  delete q.feeSync; delete q.repriced; q.amountCents = 85000
  await putPayreq(q)
  const d = await f.account(link.id)
  assert.equal(d.todo[0].amountLabel, 'A$765')
  const fixed = await payreq(link.id)
  assert.equal(fixed.amountCents, 76500)
  assert.equal(fixed.feeSync.rows[rid].owingCents, 76500)
  const p = await f.payNow(link.id)
  assert.equal((await sessionFor(p.data.url)).amount_total, 76500)
  await ok('cancelPayreq', { id: link.id })
})

await test('a fee raised: the link goes up (A$765 -> A$900)', async () => {
  const f = await family('Upfee', ['Cal'], [765])
  const [rid] = f.rowIds
  const link = (await ok('sendPaymentLink', { rowIds: [rid] })).payreq
  assert.equal(link.amountLabel, 'A$765')
  const e = await ok('editPlayer', { rowId: rid, fields: { feeAud: 900 } })
  assert.equal(e.repricedLinks[0].amountCents, 90000)
  assert.equal((await payreq(link.id)).amountCents, 90000)
  assert.equal((await f.account()).todo[0].amountLabel, 'A$900')
  await ok('cancelPayreq', { id: link.id })
})

await test('a fee lowered to what is already paid: the link is cancelled ("fee changed, nothing owing"), the place stays', async () => {
  const f = await family('Paidup', ['Dot'], [850])
  const [rid] = f.rowIds
  await ok('recordPayment', { rowIds: [rid], amountCents: 30000, method: 'cash' })
  const link = (await ok('sendPaymentLink', { rowIds: [rid] })).payreq
  assert.equal(link.amountLabel, 'A$550')
  const e = await ok('editPlayer', { rowId: rid, fields: { feeAud: 300 } })
  assert.deepEqual(e.closedLinks.map((x) => x.id), [link.id])
  assert.equal(e.openLinks.length, 0)
  const q = await payreq(link.id)
  assert.deepEqual([q.status, q.cancelReason], ['cancelled', 'fee changed, nothing owing'])
  assert.equal((await f.account()).todo.length, 0)
  const tried = await f.c.call('/api/jfp-account', { action: 'pay', payreqId: link.id })
  assert.deepEqual([tried.status, tried.data.code], [409, 'nothing'], 'the old link says there is nothing to pay')
  const r = await row(rid)
  assert.equal(r['Term 3 Day'], 'Tuesday', 'still in the group')
  assert.notEqual(r['Term 4 Confirmation'], 'Not Returning')
})

await test('paid another way while the link was open, or switched to session by session with no fee: the link closes when next read', async () => {
  const f = await family('Banked', ['Ivy', 'Jed'], [850, 850])
  const [a, b] = f.rowIds
  const la = (await ok('sendPaymentLink', { rowIds: [a] })).payreq
  const lb = (await ok('sendPaymentLink', { rowIds: [b] })).payreq
  // The family paid by bank transfer instead; the A$850 link was never closed.
  await ok('recordPayment', { rowIds: [a], amountCents: 85000, method: 'bank' })
  // Session by session, the fee cleared (no fee is nothing billed yet).
  await ok('editPlayer', { rowId: b, fields: { paymentType: 'JFP Session by session', feeAud: null } })
  assert.equal((await payreq(lb.id)).cancelReason, 'fee changed, nothing owing')
  const d = await f.account(la.id)
  assert.equal(d.todo.length, 0, 'nothing left to pay on the account')
  const qa = await payreq(la.id)
  assert.deepEqual([qa.status, qa.cancelReason], ['cancelled', 'paid another way, nothing owing'])
  const shown = (await ok('payments')).payreqs.find((x) => x.id === la.id)
  assert.equal(shown.cancelReason, 'paid another way, nothing owing')
})

await test('a family link for two places: one fee changes, only that place changes; Stripe gets both lines', async () => {
  const f = await family('Twoplace', ['Eli', 'Fay'], [850, 425])
  const [a, b] = f.rowIds
  const inv = await ok('familyInvoice', { places: [{ rowId: a, feeCents: 85000 }, { rowId: b, feeCents: 42500 }], sendEmail: false })
  assert.equal(inv.payreq.amountCents, 127500)
  const e = await ok('editPlayer', { rowId: b, fields: { feeAud: 400 } })
  assert.equal(e.repricedLinks[0].amountCents, 125000)
  const q = await payreq(inv.payreq.id)
  assert.equal(q.amountCents, 125000)
  assert.deepEqual(q.places.map((x) => [x.rowId, x.feeCents, x.owingCents]), [[a, 85000, 85000], [b, 40000, 40000]])
  const d = await f.account()
  assert.deepEqual(d.todo[0].places.map((x) => x.amountLabel), ['A$850', 'A$400'])
  const p = await f.payNow(inv.payreq.id)
  assert.equal(p.status, 200, JSON.stringify(p.data))
  const s = await sessionFor(p.data.url)
  assert.equal(s.amount_total, 125000)
  assert.equal((await payAt(f.c, p.data.url)).status, 'paid')
  assert.deepEqual([(await row(a))['Term 4 Amount Paid'], (await row(b))['Term 4 Amount Paid']], [850, 400])
})

await test('a hand-typed amount (a A$200 deposit) is not pushed up to the fee; quick links and charges keep their own amounts', async () => {
  const f = await family('Fixed', ['Gus', 'Hal'], [850, 850])
  const [a, b] = f.rowIds
  const dep = (await ok('sendPaymentLink', { rowIds: [a], amountCents: 20000 })).payreq
  await ok('editPlayer', { rowId: a, fields: { feeAud: 765 } })
  assert.equal((await payreq(dep.id)).amountCents, 20000, 'the deposit stays A$200')
  await ok('editPlayer', { rowId: a, fields: { feeAud: 100 } })
  assert.equal((await payreq(dep.id)).amountCents, 10000, 'but never more than is owing')
  await ok('cancelPayreq', { id: dep.id })
  // A quick link for a player, and a charge: their own amounts.
  const quick = (await ok('quickLink', { rowId: b, amountCents: 12000, forText: 'Extra session', programme: 'extra' })).link
  const charge = await ok('createCharge', { rowId: b, amountCents: 9000, kind: 'extra', sessionDate: '2026-10-20', coachId: 'lee', label: 'Extra session', ref: 'fee-sync-1' })
  const e = await ok('editPlayer', { rowId: b, fields: { feeAud: 500 } })
  assert.equal(e.repricedLinks.length, 0); assert.equal(e.closedLinks.length, 0)
  assert.deepEqual([(await payreq(quick.id)).amountCents, (await payreq(quick.id)).status], [12000, 'open'])
  assert.deepEqual([(await payreq(charge.payreqId)).amountCents, (await payreq(charge.payreqId)).status], [9000, 'open'])
  await ok('payments')
  await f.account()
  assert.equal((await payreq(quick.id)).amountCents, 12000, 'reading the lists changes nothing either')
  assert.equal((await payreq(charge.payreqId)).amountCents, 9000)
})

console.log(`\n${passed} fee sync checks passed`)
