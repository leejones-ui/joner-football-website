// My account app pieces (17 Oct 2026): receipts, the calendar feed. End to end on the harness. Starts its own copy of the local harness
// (scripts/holiday-local.mjs: fake Airtable, fake Brevo, fake Telegram, in
// memory KV) on a free port, so nothing real is ever emailed, texted or written.
//   node scripts/test-jfp-account-app.mjs
import assert from 'node:assert/strict'
import { docFromRecord } from '../api/_jfp-invoice-pdf.js'
import { icsText } from '../api/_jfp-calendar.js'
import net from 'node:net'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const port = await new Promise((resolve) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => resolve(p)) }) })
const B = `http://localhost:${port}`
const harness = spawn(process.execPath, [path.join(HERE, 'holiday-local.mjs')], {
  // A clean environment: no real tokens can leak into the harness.
  env: { PATH: process.env.PATH, HOME: process.env.HOME, HOLIDAY_LOCAL_PORT: String(port) },
  stdio: ['ignore', 'pipe', 'inherit'],
})
let ready
const up = new Promise((resolve, reject) => { ready = resolve; harness.on('exit', (c) => reject(new Error(`harness exited ${c}`))) })
harness.stdout.on('data', (d) => { if (String(d).includes('holiday local harness on')) ready() })
process.on('exit', () => harness.kill())
await up

let passed = 0
let ipSeq = 1
async function test(name, fn) { await fn(); passed += 1; console.log(`ok - ${name}`) }

function client() {
  const jar = new Map()
  const ip = `10.9.0.${ipSeq++}`
  async function call(p, body) {
    const res = await fetch(`${B}${p}`, { method: body ? 'POST' : 'GET', redirect: 'manual', headers: { 'content-type': 'application/json', cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '), 'x-forwarded-for': ip, origin: B }, body: body ? JSON.stringify(body) : undefined })
    for (const c of res.headers.getSetCookie?.() || []) { const [kv] = c.split(';'); const i = kv.indexOf('='); const v = kv.slice(i + 1); if (v) jar.set(kv.slice(0, i), v); else jar.delete(kv.slice(0, i)) }
    let data = {}
    try { data = JSON.parse(await res.text()) } catch {}
    return { status: res.status, data }
  }
  return { call }
}
const j = async (p) => (await fetch(`${B}${p}`)).json()
const emails = () => j('/__emails')
const telegrams = () => j('/__telegram')
const airtable = () => j('/__airtable')
const kv = async (cmd) => { const t = await (await fetch(`${B}/__kv?cmd=${encodeURIComponent(JSON.stringify(cmd))}`)).text(); try { return JSON.parse(t) } catch { return t } }

async function signIn(c, email, audience) {
  const s = await c.call('/api/jfp-auth', { action: 'start', email, audience })
  assert.equal(s.status, 200, JSON.stringify(s.data))
  const mail = (await emails()).filter((e) => e.to.includes(email) && /sign-in code/.test(e.subject)).at(-1)
  assert.ok(mail, `a code email went to ${email}`)
  const v = await c.call('/api/jfp-auth', { action: 'verify', challenge: s.data.challenge, code: mail.subject.match(/(\d{6})/)[1] })
  assert.equal(v.status, 200, JSON.stringify(v.data))
}
const portal = (c, action, body = {}) => c.call('/api/jfp-portal-data', { action, ...body })
const acct = (c, action, body = {}) => c.call('/api/jfp-account', { action, ...body })



await test('a receipt for a cash payment reads as a paid receipt, never an invoice', () => {
  const d = docFromRecord({ id: 'pay/1 x', date: '2026-10-12', what: 'Recorded by Joner Football', players: ['Isla Cole'], programme: 'JFP', method: 'Cash', amountCents: 80000 }, { term: 'Term 4 2026' }, { name: 'Poppy', email: 'p@example.com' })
  assert.equal(d.receipt, true)
  assert.equal(d.number, 'R-pay1x')
  assert.equal(d.balanceCents, 0)
  assert.equal(d.paidCents, 80000)
  assert.equal(d.lines[0].title, 'Term 4 2026 payment')
  assert.equal(d.payUrl, '')
  assert.equal(d.bank, null)
})

await test('the calendar text is valid: CRLF, folded lines, escaped commas, cancelled dates marked', () => {
  const t = icsText([{ uid: 'a@x', startMs: Date.UTC(2026, 9, 20, 5, 20), endMs: Date.UTC(2026, 9, 20, 6, 20), title: 'Isla JFP session', location: 'Belrose HQ, 20 Narabang Way', cancelled: false }, { uid: 'b@x', startMs: 0, endMs: 1, title: 'Not going: Isla JFP session', location: '', cancelled: true }], 0)
  assert.ok(t.startsWith('BEGIN:VCALENDAR\r\n') && t.endsWith('END:VCALENDAR\r\n'))
  assert.ok(t.includes('DTSTART:20261020T052000Z'))
  assert.ok(t.includes('LOCATION:Belrose HQ\\, 20 Narabang Way'))
  assert.ok(t.includes('STATUS:CANCELLED'))
  assert.ok(t.split('\r\n').every((l) => l.length <= 75))
})

const lee = client(); await signIn(lee, 'leejones@jonerfootball.com', 'staff')
const mk = async (group) => { const r = await portal(lee, 'saveGroup', { group }); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data.group.id }
await mk({ day: 'Tuesday', time: '4:20pm', location: 'Belrose HQ', coachId: 'sam', capacity: 6, mode: 'direct' })
await mk({ day: 'Wednesday', time: '4:20pm', location: 'Belrose HQ', coachId: 'sam', capacity: 6, mode: 'direct' })
const rows = (await airtable()).term4
const THIRD = rows.find((r) => r.fields['Term 3 Day'] === 'Wednesday' && r.fields['Term 3 Time'] === '4:20pm')
const riley = client(); await signIn(riley, 'returning@example.com', 'parent')
const third = client(); await signIn(third, THIRD.fields.Email, 'parent')

let feed
await test('each family gets one private calendar link (no email in it) that lists their sessions', async () => {
  const a = await acct(riley, 'calendarLink'), b = await acct(riley, 'calendarLink'), c = await acct(third, 'calendarLink')
  assert.equal(a.status, 200, JSON.stringify(a.data))
  assert.equal(a.data.url, b.data.url, 'the same link every time')
  assert.notEqual(a.data.url, c.data.url)
  assert.ok(!/returning|example|%40|@/.test(a.data.url), 'no email in the link')
  feed = new URL(a.data.url).search
  const res = await fetch(`${B}/api/jfp-account${feed}`)
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-type'), /text\/calendar/)
  const text = await res.text()
  const ov = (await acct(riley, 'overview')).data
  const all = ov.players.flatMap((p) => p.enrolments.flatMap((e) => e.isoDates || e.dates))
  assert.ok((text.match(/BEGIN:VEVENT/g) || []).length >= ov.players.flatMap((p) => p.enrolments.flatMap((e) => e.sessions)).length, 'at least every session still to come')
  assert.ok(all.length > 0)
  assert.ok(/SUMMARY:Riley JFP session/.test(text))
  assert.ok(!/@example\.com/.test(text), 'no emails in the feed')
})

await test('a made-up calendar link is refused; a signed-out link request is refused', async () => {
  assert.equal((await fetch(`${B}/api/jfp-account?cal=notarealtoken`)).status, 404)
  const anon = await fetch(`${B}/api/jfp-account`, { method: 'POST', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ action: 'calendarLink' }) })
  assert.equal(anon.status, 401)
})

await test('a session the family said they cannot make shows as cancelled in the feed', async () => {
  const ov = (await acct(riley, 'overview')).data
  const e = ov.players.flatMap((p) => p.enrolments).find((x) => x.sessions.length > 1)
  const date = e.sessions[1].iso
  const r = await acct(riley, 'cancelSession', { rowId: e.rowId, date, reason: 'sick', note: '' })
  assert.equal(r.status, 200, JSON.stringify(r.data))
  const text = await (await fetch(`${B}/api/jfp-account${feed}`)).text()
  const ev = text.split('BEGIN:VEVENT').find((x) => x.includes(`${e.rowId}-${date}@`))
  assert.ok(ev && ev.includes('STATUS:CANCELLED') && ev.includes('Not going'), ev)
})

await test('receipts: only this family\'s own records; a made-up id is not found', async () => {
  assert.equal((await acct(riley, 'receiptPdf', { id: 'not-a-record' })).status, 404)
  const f = await acct(third, 'fees')
  for (const rec of (f.data.fees?.records || []).slice(0, 1)) {
    assert.equal((await acct(riley, 'receiptPdf', { id: rec.id })).status, 404, 'another family cannot get it')
    const mine = await acct(third, 'receiptPdf', { id: rec.id })
    assert.equal(mine.status, 200)
    assert.ok(mine.data.pdf.length > 1000)
  }
})

await test('the service worker file is served and never caches the account API', async () => {
  const sw = await (await fetch(`${B}/jfp-account-sw.js`)).text()
  assert.ok(sw.includes("startsWith('/api/')"))
  assert.ok(sw.includes("addEventListener('push'"))
})

console.log(`\n${passed} account app checks passed`)
process.exit(0)
