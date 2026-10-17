// JFP ops, 18 Oct 2026 (Lee): requests copied to Airtable, nightly money check,
// coach hours and "a place has opened" emails to the waitlist. Starts its own copy of the local harness
// (scripts/holiday-local.mjs: fake Airtable, fake Brevo, fake Telegram, in
// memory KV) on a free port, so nothing real is ever emailed, texted or written.
//   node scripts/test-jfp-ops.mjs
import assert from 'node:assert/strict'
import { findings } from '../api/_jfp-nightly.js'
import { pickWaiters, NEXT_AFTER_MS } from '../api/_jfp-waitlist-open.js'
import { checkEntry } from '../api/_jfp-hours.js'
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

const groupKey = 'jfp:groups'
const lee = client(); await signIn(lee, 'leejones@jonerfootball.com', 'staff')
const mk = async (group) => { const r = await portal(lee, 'saveGroup', { group }); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data.group.id }
const WED420 = await mk({ day: 'Wednesday', time: '4:20pm', location: 'Belrose HQ', coachId: 'sam', capacity: 6, mode: 'direct', minAge: 7, maxAge: 18 })
const FRI400 = await mk({ day: 'Friday', time: '4pm', location: 'Belrose HQ', coachId: 'dean', capacity: 6, mode: 'application', label: 'Pathway', minAge: 6, maxAge: 12 })
const cron = (q, auth = true) => fetch(`${B}/api/jfp-groups?${q}`, auth ? { headers: { authorization: 'Bearer local-cron-secret' } } : {})
const ask = (c, kind, groupId, name, parentName) => c.call('/api/jfp-book', { action: 'request', kind, groupId, players: [{ name, dob: '2015-08-08' }], parentName, mobile: '0400123123', answers: { club: 'Belrose FC' } })
const fam = async (email) => { const c = client(); await signIn(c, email, 'parent'); return c }

await test('a new request lands in the Airtable table JFP Applications, and its answer updates the same row', async () => {
  const a = await fam('apply.ops@example.com')
  const r = await ask(a, 'application', FRI400, 'Ollie Ops', 'Olga Ops')
  assert.equal(r.status, 200, JSON.stringify(r.data))
  const rows = (await airtable()).applications
  assert.equal(rows.length, 1)
  const f = rows[0].fields
  assert.equal(f.Type, 'Application'); assert.equal(f.Status, 'Pending'); assert.equal(f.Players, 'Ollie Ops'); assert.equal(f['Parent Name'], 'Olga Ops')
  assert.match(f.Group, /^Friday 4pm /); assert.ok(f.Coach); assert.match(f.Answers, /Club/); assert.ok(f['Request ID'].startsWith('APP-'))
  const id = f['Request ID']
  const d = await portal(lee, 'decideRequest', { id, decision: 'done', note: 'Called the family' })
  assert.equal(d.status, 200, JSON.stringify(d.data))
  const after = (await airtable()).applications
  assert.equal(after.length, 1, 'updated in place, not a second row')
  assert.equal(after[0].fields.Status, 'Done'); assert.equal(after[0].fields['Decided By'], 'leejones@jonerfootball.com'); assert.equal(after[0].fields['Decision Notes'], 'Called the family')
})

await test('Airtable down: the request still goes through, and the nightly check copies it later', async () => {
  await fetch(`${B}/__fail?what=airtable-applications&on=1`)
  const a = await fam('late.ops@example.com')
  const r = await ask(a, 'application', FRI400, 'Lara Late', 'Lou Late')
  assert.equal(r.status, 200, JSON.stringify(r.data))
  assert.equal((await airtable()).applications.length, 1)
  await fetch(`${B}/__fail?what=airtable-applications&on=0`)
  const n = await cron('nightly=1')
  assert.equal(n.status, 200)
  const rows = (await airtable()).applications
  assert.equal(rows.length, 2)
  assert.ok(rows.some((x) => x.fields.Players === 'Lara Late'))
})

await test('nightly check: secret needed, findings listed, only Lee and Ligia can read it', async () => {
  assert.equal((await cron('nightly=1', false)).status, 401)
  const r = await portal(lee, 'nightly')
  assert.equal(r.status, 200)
  assert.ok(r.data.last?.at)
  assert.ok(r.data.history.length >= 1)
  const sam = client(); await signIn(sam, 'jonerfootballsam@gmail.com', 'staff')
  assert.equal((await portal(sam, 'nightly')).status, 403)
  assert.equal((await portal(sam, 'nightlyRun')).status, 403)
  const run = await portal(lee, 'nightlyRun')
  assert.equal(run.status, 200)
  // Nothing new the second time: no Telegram for it.
  assert.equal(run.data.last.newCount, 0)
})

await test('nightly findings: unmatched Stripe, not recorded, paid with no money, paid twice, Stripe down', async () => {
  const items = findings({
    unmatched: [{ id: 'cs_1', name: 'Pat Pay', email: 'x@y.z', cents: 85000 }],
    players: [{ rowId: 'r1', player: 'Ann', status: 'stripe', stripeAppliedCents: 75000, feeCents: 75000, receivedCents: 0 }, { rowId: 'r2', player: 'Ben', status: 'paid', feeCents: 75000, receivedCents: 150000 }, { rowId: 'r3', player: 'Cal', status: 'session', feeCents: 5000, receivedCents: 20000 }],
    paidNoMoney: [{ rowId: 'r4', player: 'Dee', missingCents: 85000 }],
    stripeError: 'Stripe could not be read just now.',
  })
  assert.deepEqual(items.map((x) => x.kind).sort(), ['overpaid', 'paidNoMoney', 'stripeError', 'unmatched', 'unrecorded'])
  assert.ok(!items.some((x) => /x@y\.z/.test(x.text)), 'no email addresses in the alert text')
  assert.deepEqual(findings({ unmatched: [], players: [], paidNoMoney: [] }), [])
})

await test('a place opens in a full Book now group: the family waiting longest is emailed once, with a link to that session', async () => {
  const w1 = await fam('wait.one@example.com'); const w2 = await fam('wait.two@example.com')
  assert.equal((await ask(w1, 'waitlist', WED420, 'Walt Wait', 'Wendy Wait')).status, 200)
  await new Promise((r) => setTimeout(r, 20))
  assert.equal((await ask(w2, 'waitlist', WED420, 'Will Wait', 'Wanda Wait')).status, 200)
  const opened = () => emails().then((l) => l.filter((e) => /A place has opened/.test(e.subject)))
  assert.equal((await cron('sweep=1')).status, 200)
  assert.equal((await opened()).length, 0, 'still full: nobody told')
  // One place opens.
  const raw = await kv(['HGET', groupKey, WED420]); const g = typeof raw === 'string' ? JSON.parse(raw) : raw
  await kv(['HSET', groupKey, WED420, JSON.stringify({ ...g, capacity: Number(g.capacity) + 1 })])
  assert.equal((await cron('sweep=1')).status, 200)
  const sent = await opened()
  assert.equal(sent.length, 1)
  assert.deepEqual(sent[0].to, ['wait.one@example.com'])
  assert.match(sent[0].html, new RegExp(`/jfp-booking/\\?group=${WED420}`))
  assert.ok((await telegrams()).some((t) => /place has opened/.test(t.text) && /Wendy Wait/.test(t.text)))
  const req = (await portal(lee, 'requests')).data.requests.find((r) => r.email === 'wait.one@example.com')
  assert.equal(req.placeOpenTold.length, 1)
  assert.equal((await cron('sweep=1')).status, 200)
  assert.equal((await opened()).length, 1, 'not emailed again an hour later')
})

await test('waitlist rules: as many families as places, the next ones after 48 hours, nobody twice for one opening', () => {
  const at = Date.parse('2026-10-20T00:00:00Z')
  const w = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  assert.deepEqual(pickWaiters({ waiters: w, places: 2, st: null, nowMs: at }).map((x) => x.id), ['a', 'b'])
  assert.deepEqual(pickWaiters({ waiters: w, places: 0, st: null, nowMs: at }), [])
  const st = { openedAt: '2026-10-20T00:00:00.000Z', lastToldAt: '2026-10-20T00:00:00.000Z' }
  const told = [{ id: 'a', placeOpenTold: ['2026-10-20T00:00:00.000Z'] }, { id: 'b' }, { id: 'c' }]
  assert.deepEqual(pickWaiters({ waiters: told, places: 1, st, nowMs: at + 3600e3 }), [], 'within 48 hours: wait')
  assert.deepEqual(pickWaiters({ waiters: told, places: 1, st, nowMs: at + NEXT_AFTER_MS + 1 }).map((x) => x.id), ['b'])
})

await test('coach hours: Sam logs his own, sees his sessions to add, cannot see others; Lee approves and sends back', async () => {
  const sam = client(); await signIn(sam, 'jonerfootballsam@gmail.com', 'staff')
  const dean = client(); await signIn(dean, 'jonerfootballdean@gmail.com', 'staff')
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date())
  const l = await portal(sam, 'hoursList', {})
  assert.equal(l.status, 200, JSON.stringify(l.data))
  assert.equal(l.data.myCoachId, 'sam')
  const save = await portal(sam, 'hoursSave', { date: today, start: '07:00', end: '08:30', kind: 'admin', note: 'Planning' })
  assert.equal(save.status, 200, JSON.stringify(save.data))
  assert.equal(save.data.entry.minutes, 90); assert.equal(save.data.entry.status, 'submitted'); assert.equal(save.data.entry.coachId, 'sam')
  assert.equal((await portal(sam, 'hoursSave', { date: today, start: '08:00', end: '09:00', kind: 'admin' })).status, 400, 'overlap refused')
  assert.equal((await portal(sam, 'hoursSave', { date: today, start: '09:00', end: '08:00', kind: 'admin' })).status, 400, 'finish before start refused')
  // Sam cannot log for Dean by sending a coachId.
  const sneaky = await portal(sam, 'hoursSave', { date: today, start: '10:00', end: '11:00', kind: 'other', coachId: 'dean' })
  assert.equal(sneaky.data.entry.coachId, 'sam')
  const deanList = await portal(dean, 'hoursList', {})
  assert.equal(deanList.data.entries.length, 0, 'Dean sees only his own')
  assert.equal((await portal(dean, 'hoursDelete', { id: save.data.entry.id })).status, 403)
  assert.equal((await portal(dean, 'hoursDecide', { ids: [save.data.entry.id], status: 'approved' })).status, 403)
  const all = await portal(lee, 'hoursList', {})
  assert.equal(all.data.entries.length, 2)
  assert.equal(all.data.totals.find((t) => t.coachId === 'sam').minutes, 150)
  assert.equal((await portal(lee, 'hoursDecide', { ids: [save.data.entry.id], status: 'queried' })).status, 400, 'sending back needs a note')
  assert.equal((await portal(lee, 'hoursDecide', { ids: [sneaky.data.entry.id], status: 'queried', note: 'Which session?' })).status, 200)
  assert.equal((await portal(lee, 'hoursDecide', { ids: [save.data.entry.id], status: 'approved' })).status, 200)
  // Approved: Sam can no longer change it; a sent back one he can fix, and it goes back to waiting.
  assert.equal((await portal(sam, 'hoursSave', { id: save.data.entry.id, date: today, start: '07:00', end: '09:00', kind: 'admin' })).status, 403)
  const fixed = await portal(sam, 'hoursSave', { id: sneaky.data.entry.id, date: today, start: '10:00', end: '11:00', kind: 'event', note: 'Trial day' })
  assert.equal(fixed.status, 200); assert.equal(fixed.data.entry.status, 'submitted')
  // A family cannot reach any of it.
  const f = await fam('hours.family@example.com')
  assert.notEqual((await f.call('/api/jfp-portal-data', { action: 'hoursList' })).status, 200)
})

await test('hours rules: dates, times, 12 hour cap', () => {
  const today = '2026-10-18'
  assert.match(checkEntry({ date: '2026-10-19', start: '07:00', end: '08:00', kind: 'admin' }, { today }).error, /on or after/)
  assert.match(checkEntry({ date: '2026-07-01', start: '07:00', end: '08:00', kind: 'admin' }, { today }).error, /too far back/)
  assert.match(checkEntry({ date: today, start: '06:00', end: '19:00', kind: 'admin' }, { today }).error, /12 hours/)
  assert.match(checkEntry({ date: today, start: '06:00', end: '07:00', kind: 'pay' }, { today }).error, /what the hours/)
  assert.equal(checkEntry({ date: today, start: '16:20', end: '17:20', kind: 'session' }, { today }).minutes, 60)
})

console.log(`\n${passed} JFP ops checks passed`)
process.exit(0)
