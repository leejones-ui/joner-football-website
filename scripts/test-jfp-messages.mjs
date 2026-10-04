// Portal Messages, end to end against the local harness, with a fake imsg:
//   node scripts/holiday-local.mjs   (after npm run build), then
//   node scripts/test-jfp-messages.mjs <port>
// Nothing real is emailed or texted: Brevo and Airtable are faked by the
// harness, and texts go to scripts/fake-imsg.mjs.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const PORT = process.argv[2] || '5000'
const B = `http://localhost:${PORT}`
const ORIGIN = { origin: B }
const HERE = path.dirname(fileURLToPath(import.meta.url))
const TOKEN = 'local-relay-token-0123456789abcdef0123'
const FAKE_DB = path.join(os.tmpdir(), `fake-imsg-${process.pid}.json`)
let passed = 0
let ipSeq = 1
async function test(name, fn) { await fn(); passed += 1; console.log(`ok - ${name}`) }

function client() {
  const jar = new Map()
  const ip = `10.7.0.${ipSeq++}`
  async function call(p, body) {
    const res = await fetch(`${B}${p}`, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '), 'x-forwarded-for': ip, ...ORIGIN }, body: body ? JSON.stringify(body) : undefined })
    for (const c of res.headers.getSetCookie?.() || []) { const [kv] = c.split(';'); const i = kv.indexOf('='); const v = kv.slice(i + 1); if (v) jar.set(kv.slice(0, i), v); else jar.delete(kv.slice(0, i)) }
    let data = {}
    try { data = JSON.parse(await res.text()) } catch {}
    return { status: res.status, ok: res.ok, data }
  }
  return { call, jar }
}
const emails = async () => (await fetch(`${B}/__emails`)).json()
const at = async () => (await fetch(`${B}/__airtable`)).json()
const patch = (id, fields) => fetch(`${B}/__patch?table=term4&id=${id}&fields=${encodeURIComponent(JSON.stringify(fields))}`)
async function signIn(c, email) {
  const s = await c.call('/api/jfp-auth', { action: 'start', email, audience: 'staff' })
  assert.equal(s.status, 200, JSON.stringify(s.data))
  const code = (await emails()).filter((e) => e.to.includes(email) && /sign-in code/.test(e.subject)).at(-1).subject.match(/(\d{6})/)[1]
  assert.equal((await c.call('/api/jfp-auth', { action: 'verify', challenge: s.data.challenge, code })).status, 200)
}
const msg = (c, action, body = {}) => c.call('/api/jfp-messages', { action, ...body })
function sidecar(mode = 'ok') {
  const r = spawnSync(process.execPath, [path.join(HERE, 'jfp-text-sidecar.mjs'), '--once', '--url', `${B}/api/jfp-messages-relay`, '--imsg', path.join(HERE, 'fake-imsg.mjs'), '--env', '/dev/null'], { encoding: 'utf8', env: { ...process.env, JFP_RELAY_TOKEN: TOKEN, FAKE_IMSG_DB: FAKE_DB, FAKE_IMSG_MODE: mode }, timeout: 90000 })
  assert.equal(r.status, 0, r.stderr || r.stdout)
  assert.ok(!/04\d{8}|\+614\d{8}/.test(r.stdout + r.stderr), 'the Mac helper never prints a phone number')
  return r.stdout
}
const fakeSends = () => (fs.existsSync(FAKE_DB) ? JSON.parse(fs.readFileSync(FAKE_DB, 'utf8')).sends || 0 : 0)

// ---------- setup: three families on the records ----------
const lee = client(), ligia = client()
await signIn(lee, 'leejones@jonerfootball.com')
await signIn(ligia, 'ligia@jonerfootball.com')
const g = await lee.call('/api/jfp-portal-data', { action: 'saveGroup', group: { day: 'Thursday', time: '4:20pm', location: 'Belrose HQ', coachId: 'sam', capacity: 12, mode: 'direct', minAge: 7, maxAge: 18 } })
assert.equal(g.status, 200, JSON.stringify(g.data))
async function family(name, email, mobile, fields) {
  const r = await lee.call('/api/jfp-portal-data', { action: 'addPlayer', groupId: g.data.group.id, force: true, player: { name }, parent: { name: `${name.split(' ')[0]}s Parent`, email, mobile }, payment: 'none' })
  assert.equal(r.status, 200, JSON.stringify(r.data))
  await patch(r.data.rowId, { 'Term 4 Confirmation': 'Confirmed', ...fields })
  return r.data.rowId
}
const owe = { 'Term 4 Fee': 850, 'Term 4 Amount Paid': 0, 'Term 4 Balance': 850, 'Term 4 Payment Status': 'Unpaid' }
const rowA = await family('Mia Message', 'msg-a@example.com', '0400 111 001', owe)
await family('Noah Message', 'msg-b@example.com', '0400111002', owe)
await family('Ola Message', 'msg-c@example.com', '0400111003', owe)
await family('Pip Message', 'msg-d@example.com', '0400111004', owe)
await family('Quin Message', 'msg-e@example.com', '0400111005', { 'Term 4 Payment Status': 'Unpaid', 'Term 4 Fee': null, 'Term 4 Amount Paid': null, 'Term 4 Balance': null }) // no fee typed in
const famOf = async (email) => (await msg(lee, 'overview')).data.families.find((f) => f.email === email)

await test('only Lee and Ligia see Messages; coaches and families do not', async () => {
  const anon = client()
  assert.equal((await msg(anon, 'overview')).status, 401)
  const o = await msg(lee, 'overview')
  assert.equal(o.status, 200, JSON.stringify(o.data))
  assert.equal(o.data.isOwner, true)
  assert.equal((await msg(ligia, 'overview')).data.isOwner, false)
  const a = await famOf('msg-a@example.com')
  assert.equal(a.kind, 'pay'); assert.equal(a.owingCents, 85000); assert.equal(a.phone, '•••• 001'); assert.equal(a.dnc, false)
  const dean = client()
  await signIn(dean, 'jonerfootballdean@gmail.com')
  assert.equal((await msg(dean, 'overview')).status, 403, 'coaches never see family messages')
  assert.ok(!JSON.stringify(o.data).includes('0400111001') && !JSON.stringify(o.data).includes('+61400111001'), 'no full mobile numbers leave the server')
})

await test('a blank fee is unknown, not zero: no messages until it is set', async () => {
  assert.equal((await famOf('msg-e@example.com')).kind, 'noPrice')
  assert.equal((await msg(lee, 'prepare', { email: 'msg-e@example.com' })).data.code, 'noPrice')
})

let A
await test('prepare: a pay link only when asked, then the exact email and text', async () => {
  const first = await msg(lee, 'prepare', { email: 'msg-a@example.com' })
  assert.equal(first.data.needsLink, true, 'no link is created without asking')
  A = (await msg(lee, 'prepare', { email: 'msg-a@example.com', createLink: true })).data
  assert.ok(A.email.html.includes('/jfp-account/?pay=PAY-'), 'the email carries the pay link')
  assert.match(A.text.text, /A\$850 due on our records/)
  assert.ok(A.text.text.includes(A.email.payUrl))
  assert.equal(A.evidence.rows.length, 1)
})

await test('approve sends exactly what was shown, once, with the Brevo receipt', async () => {
  assert.equal((await msg(lee, 'approve', { id: A.email.id, payloadHash: 'not-it' })).data.code, 'changed')
  const before = (await emails()).length
  const r = await msg(ligia, 'approve', { id: A.email.id, payloadHash: A.email.payloadHash })
  assert.equal(r.status, 200, JSON.stringify(r.data))
  assert.equal(r.data.message.status, 'sent'); assert.equal(r.data.message.receipt.messageId, 'local'); assert.equal(r.data.message.approvedBy, 'ligia@jonerfootball.com')
  const sent = (await emails()).slice(before)
  assert.equal(sent.length, 1); assert.deepEqual(sent[0].to, ['msg-a@example.com']); assert.equal(sent[0].subject, A.email.subject)
  assert.equal((await msg(lee, 'approve', { id: A.email.id, payloadHash: A.email.payloadHash })).status, 409, 'approving twice never sends twice')
})

await test('Brevo refusing an email is "Not sent", and does not count as emailed', async () => {
  const B0 = (await msg(lee, 'prepare', { email: 'msg-b@example.com', createLink: true })).data
  await fetch(`${B}/__fail?what=email&on=1`)
  const r = await msg(lee, 'approve', { id: B0.email.id, payloadHash: B0.email.payloadHash })
  await fetch(`${B}/__fail?what=email&on=0`)
  assert.equal(r.data.message.status, 'failed')
  assert.equal((await famOf('msg-b@example.com')).invitedAt, '')
})

await test('a second email to the same family needs Lee to say send again', async () => {
  const again = (await msg(lee, 'prepare', { email: 'msg-a@example.com' })).data
  assert.equal((await msg(ligia, 'approve', { id: again.email.id, payloadHash: again.email.payloadHash, replace: true })).data.code, 'emailed_before')
  assert.equal((await msg(lee, 'approve', { id: again.email.id, payloadHash: again.email.payloadHash })).data.code, 'emailed_before')
  const r = await msg(lee, 'approve', { id: again.email.id, payloadHash: again.email.payloadHash, replace: true })
  assert.equal(r.data.message.status, 'sent')
})

await test('no family texts until Lee verifies the route with a test text to himself', async () => {
  const fresh = (await msg(lee, 'prepare', { email: 'msg-a@example.com' })).data
  assert.equal((await msg(lee, 'approve', { id: fresh.text.id, payloadHash: fresh.text.payloadHash })).data.code, 'route')
  assert.equal((await msg(ligia, 'selfTest', { phone: '0400999111' })).status, 403, 'only Lee runs the test')
  const t = await msg(lee, 'selfTest', { phone: '0400 999 111' })
  assert.equal(t.data.message.status, 'queued')
  sidecar()
  const list = (await msg(lee, 'overview')).data.messages
  const sentTest = list.find((m) => m.id === t.data.message.id)
  assert.equal(sentTest.status, 'sent'); assert.equal(sentTest.receipt.readback.found, true); assert.equal(sentTest.receipt.sender, '+61400000999')
  assert.equal((await msg(lee, 'verifyRoute', { id: sentTest.id })).status, 400, 'Lee has to say it arrived')
  const v = await msg(lee, 'verifyRoute', { id: sentTest.id, arrived: true })
  assert.equal(v.data.route.verified, true); assert.equal(v.data.route.sender, '+61400000999')
})

await test('a family text needs their OK, goes once through the Mac, and is read back', async () => {
  const B1 = (await msg(lee, 'prepare', { email: 'msg-b@example.com', createLink: true })).data
  assert.equal((await msg(lee, 'approve', { id: B1.text.id, payloadHash: B1.text.payloadHash })).data.code, 'consent')
  assert.equal((await msg(lee, 'setPref', { email: 'msg-b@example.com', text: 'yes' })).status, 400, 'say how they agreed')
  assert.equal((await msg(lee, 'setPref', { email: 'msg-b@example.com', text: 'yes', how: 'Parent asked us to text' })).status, 200)
  assert.equal((await msg(lee, 'editText', { id: B1.text.id, text: 'Hi, please pay soon.' })).status, 400, 'the pay link cannot be edited out')
  const edited = await msg(lee, 'editText', { id: B1.text.id, text: `${B1.text.text} Thanks!` })
  assert.equal(edited.status, 200)
  assert.equal((await msg(ligia, 'approve', { id: B1.text.id, payloadHash: B1.text.payloadHash })).data.code, 'changed', 'approval is for the text on screen')
  const q = await msg(ligia, 'approve', { id: B1.text.id, payloadHash: edited.data.message.payloadHash })
  assert.equal(q.data.message.status, 'queued'); assert.equal(q.data.message.route.sender, '+61400000999')
  const n = fakeSends()
  sidecar()
  assert.equal(fakeSends(), n + 1)
  sidecar()
  assert.equal(fakeSends(), n + 1, 'a second run never sends it again')
  const m = (await msg(lee, 'get', { id: B1.text.id })).data.message
  assert.equal(m.status, 'sent'); assert.ok(m.text.endsWith('Thanks!'))
  assert.ok(m.events.some((e) => e.by === 'ligia@jonerfootball.com' && e.displayedSender === '+61400000999'), 'who approved and which sender, both recorded')
})

await test('if the records change before the Mac sends, the text is cancelled, not sent', async () => {
  await msg(lee, 'setPref', { email: 'msg-c@example.com', text: 'yes', how: 'Asked at training' })
  const C = (await msg(lee, 'prepare', { email: 'msg-c@example.com', createLink: true })).data
  assert.equal((await msg(lee, 'approve', { id: C.text.id, payloadHash: C.text.payloadHash })).data.message.status, 'queued')
  const row = (await at()).term4.find((r) => r.fields['Email'] === 'msg-c@example.com')
  await patch(row.id, { 'Term 4 Amount Paid': 850, 'Term 4 Balance': 0, 'Term 4 Payment Status': 'Paid' })
  const n = fakeSends()
  sidecar()
  assert.equal(fakeSends(), n)
  const m = (await msg(lee, 'get', { id: C.text.id })).data.message
  assert.equal(m.status, 'cancelled'); assert.ok(m.events.at(-1).why)
})

await test('an unclear send is "Check it", never retried, and a person settles it', async () => {
  await msg(lee, 'setPref', { email: 'msg-d@example.com', text: 'yes', how: 'Texted us first' })
  const D = (await msg(lee, 'prepare', { email: 'msg-d@example.com', createLink: true })).data
  await msg(lee, 'approve', { id: D.text.id, payloadHash: D.text.payloadHash })
  const n = fakeSends()
  sidecar('lost')
  assert.equal(fakeSends(), n + 1)
  assert.equal((await msg(lee, 'get', { id: D.text.id })).data.message.status, 'unknown')
  sidecar()
  assert.equal(fakeSends(), n + 1, 'not sent again')
  assert.equal((await msg(lee, 'reconcile', { id: D.text.id, outcome: 'delivered' })).status, 400, 'say where you checked')
  const r = await msg(lee, 'reconcile', { id: D.text.id, outcome: 'delivered', note: 'It is in Messages on the Mac' })
  assert.equal(r.data.message.status, 'delivered')
})

await test('Texts: no stops a waiting text; Do Not Contact blocks everything', async () => {
  const D2 = (await msg(lee, 'prepare', { email: 'msg-d@example.com' })).data
  await msg(lee, 'approve', { id: D2.text.id, payloadHash: D2.text.payloadHash })
  const p = await msg(lee, 'setPref', { email: 'msg-d@example.com', text: 'no' })
  assert.equal(p.data.stopped, 1)
  assert.equal((await msg(lee, 'get', { id: D2.text.id })).data.message.status, 'cancelled')
  await fetch(`${B}/__dnc?email=msg-b@example.com`)
  assert.equal((await famOf('msg-b@example.com')).dnc, true)
  const B2 = (await msg(lee, 'prepare', { email: 'msg-b@example.com' })).data
  const r = await msg(lee, 'approve', { id: B2.email.id, payloadHash: B2.email.payloadHash, replace: true })
  assert.equal(r.status, 409); assert.match(r.data.error, /Do Not Contact/)
})

await test('the relay only answers the Mac\'s token', async () => {
  const bad = await fetch(`${B}/api/jfp-messages-relay`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer wrong' }, body: '{"action":"claim"}' })
  assert.equal(bad.status, 401)
  const none = await fetch(`${B}/api/jfp-messages-relay`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"claim"}' })
  assert.equal(none.status, 401)
})

await test('every step is in the audit log', async () => {
  const log = (await lee.call('/api/jfp-portal-data', { action: 'audit' })).data
  const actions = JSON.stringify(log)
  for (const a of ['message.prepare', 'message.email.sent', 'message.text.queued', 'message.text.sent', 'message.route.verify', 'message.reconcile', 'message.pref']) assert.ok(actions.includes(a), a)
})

fs.rmSync(FAKE_DB, { force: true })
console.log(`\n${passed} JFP messages checks passed`)
process.exit(0)
