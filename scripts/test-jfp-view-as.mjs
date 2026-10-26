// See a family's account, view only (Lee, 27 Oct 2026). Starts its own
// harness. Every name and email here is invented.
//   node scripts/test-jfp-view-as.mjs
import assert from 'node:assert/strict'
import net from 'node:net'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const port = await new Promise((resolve) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => resolve(p)) }) })
const B = `http://localhost:${port}`
const harness = spawn(process.execPath, [path.join(HERE, 'holiday-local.mjs')], { env: { PATH: process.env.PATH, HOME: process.env.HOME, HOLIDAY_LOCAL_PORT: String(port) }, stdio: ['ignore', 'pipe', 'inherit'] })
await new Promise((resolve, reject) => { harness.stdout.on('data', (d) => { if (String(d).includes('holiday local harness on')) resolve() }); harness.on('exit', (c) => reject(new Error(`harness exited ${c}`))) })
process.on('exit', () => harness.kill())

let ipSeq = 1
function client() {
  const jar = new Map(), ip = `10.7.0.${ipSeq++}`
  const call = async (p, body, extra = {}) => {
    const res = await fetch(`${B}${p}`, { method: body ? 'POST' : 'GET', redirect: 'manual', headers: { 'content-type': 'application/json', cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '), 'x-forwarded-for': ip, origin: B, ...extra }, body: body ? JSON.stringify(body) : undefined })
    for (const c of res.headers.getSetCookie?.() || []) { const [kv] = c.split(';'); const i = kv.indexOf('='); const v = kv.slice(i + 1); if (v) jar.set(kv.slice(0, i), v); else jar.delete(kv.slice(0, i)) }
    let data = {}
    try { data = JSON.parse(await res.text()) } catch {}
    return { status: res.status, data }
  }
  call.jar = jar
  return call
}
const kv = async (cmd) => { const t = await (await fetch(`${B}/__kv?cmd=${encodeURIComponent(JSON.stringify(cmd))}`)).text(); try { return JSON.parse(t) } catch { return t } }
async function signIn(call, email, audience) {
  const s = await call('/api/jfp-auth', { action: 'start', email, audience })
  const mail = (await (await fetch(`${B}/__emails`)).json()).filter((e) => e.to.includes(email) && /sign-in code/.test(e.subject)).at(-1)
  const v = await call('/api/jfp-auth', { action: 'verify', challenge: s.data.challenge, code: mail.subject.match(/(\d{6})/)[1] })
  assert.equal(v.status, 200, `sign in ${email}`)
}
let passed = 0
async function test(name, fn) { await fn(); passed++; console.log(`ok - ${name}`) }

const lee = client(), sam = client(), fam = client(), other = client()
await signIn(lee, 'leejones@jonerfootball.com', 'staff')
await signIn(lee, 'parent2@example.com', 'parent') // Lee's own test family account, same browser
await signIn(sam, 'jonerfootballsam@gmail.com', 'staff')
await signIn(fam, 'returning@example.com', 'parent')
await signIn(other, 'parent2@example.com', 'parent')
const portal = (c, action, body = {}) => c('/api/jfp-portal-data', { action, ...body })
const acct = (c, action, body = {}) => c('/api/jfp-account', { action, ...body })
// The view tab sends its pass as a header (jfp-common.js); other tabs do not.
let PASS = ''
const viewTab = (action, body = {}) => lee('/api/jfp-account', { action, ...body }, { 'x-jfp-viewas': PASS })

// The groups the returning family's players are in (as test-jfp-account-four does).
for (const day of ['Tuesday', 'Wednesday']) assert.equal((await portal(lee, 'saveGroup', { group: { day, time: '4:20pm', location: 'Belrose HQ', coachId: 'sam', capacity: 6, mode: 'direct' } })).status, 200)
const own0 = (await acct(fam, 'overview')).data
const ROW = own0.players.flatMap((p) => p.enrolments || [])[0]?.rowId
assert.ok(ROW, 'the family has an enrolment')
const note = await portal(lee, 'familyNoteSave', { rowId: ROW, text: 'Invented coach note for the view test.' })
assert.equal(note.status, 200, JSON.stringify(note.data))
const noteId = note.data.note?.id || note.data.id
const own = (await acct(fam, 'overview')).data

await test('only Lee and Ligia can start a view', async () => {
  assert.equal((await portal(sam, 'viewAsStart', { rowId: ROW })).status, 403, 'a coach cannot')
  assert.equal((await fam('/api/jfp-portal-data', { action: 'viewAsStart', rowId: ROW })).status >= 400, true, 'a family cannot')
})

await test('Lee sees the account exactly as the family does, with the coach note', async () => {
  const mineBefore = (await acct(lee, 'overview')).data
  const s = await portal(lee, 'viewAsStart', { rowId: ROW })
  assert.equal(s.status, 200, JSON.stringify(s.data))
  const m = s.data.url.match(/^\/jfp-account\/#va=([a-f0-9]{64})$/); assert.ok(m, s.data.url); PASS = m[1]
  assert.ok(!lee.jar.get('jfp_viewas'), 'no browser-wide pass cookie')
  const v = await viewTab('overview')
  assert.equal(v.status, 200, JSON.stringify(v.data))
  assert.ok(v.data.viewAs && v.data.viewAs.by === 'leejones@jonerfootball.com', 'marked as a view')
  assert.ok(v.data.notes.some((n) => n.text.includes('Invented coach note')), 'the coach note shows')
  assert.deepEqual(v.data.players.map((p) => p.name).sort(), own.players.map((p) => p.name).sort(), 'same players as the family sees')
  assert.equal(v.data.askWhere, null, 'no first-visit question while viewing')
  assert.equal((await viewTab('fees')).status, 200, 'fees can be read')
  // Lee's own account in another tab of the same browser stays his own.
  const mine = (await acct(lee, 'overview')).data
  assert.ok(!mine.viewAs, 'own tab is not a view')
  assert.deepEqual(mine.players.map((p) => p.name).sort(), mineBefore.players.map((p) => p.name).sort(), 'own tab shows his own players')
  assert.ok(!mine.notes.some((n) => n.text.includes('Invented coach note')), 'never the viewed family in his own tab')
  const myFees = JSON.stringify((await acct(lee, 'fees')).data)
  assert.ok(!own.players.some((p) => myFees.includes(p.name)), 'own Fees never shows the viewed family')
})

await test('nothing can be changed while viewing', async () => {
  for (const action of ['signWaiver', 'pay', 'payOwed', 'saveProfile', 'addPlayer', 'cancelSession', 'comingSession', 'requestExtra', 'calendarLink', 'pushSubscribe', 'pushUnsubscribe', 'pushPrefs', 'saveWhere', 'nextTermChoice']) {
    const r = await viewTab(action, {})
    assert.equal(r.status, 403, `${action} refused`); assert.equal(r.data.code, 'viewOnly', action)
  }
})

await test('looking does not mark anything read or touch the family\'s notifications', async () => {
  const before = await Promise.all([kv(['HGET', 'jfp:family-note-read', 'returning@example.com']), kv(['HGETALL', 'jfp:push-subs']), kv(['HGETALL', 'jfp:push-prefs'])])
  for (const action of ['noteRead', 'announceRead', 'reportRead', 'sessionsSeen', 'pushState']) assert.equal((await viewTab(action, { ids: [noteId], endpoint: 'https://push.example/x' })).status, 200, action)
  const after = await Promise.all([kv(['HGET', 'jfp:family-note-read', 'returning@example.com']), kv(['HGETALL', 'jfp:push-subs']), kv(['HGETALL', 'jfp:push-prefs'])])
  assert.deepEqual(after, before, 'read list, phones and notification switches unchanged')
  assert.equal((await acct(fam, 'overview')).data.notes.find((n) => n.text.includes('Invented coach note')).read, false, 'still new for the family')
})

await test('the pass is useless without the same admin signed in', async () => {
  // Another family's browser sending the pass: still only their own account.
  const r = await acct(other, 'overview', {}); const r2 = await other('/api/jfp-account', { action: 'overview' }, { 'x-jfp-viewas': PASS })
  assert.ok(!r2.data.viewAs, 'not a view'); assert.ok(!r2.data.notes.some((n) => n.text.includes('Invented coach note')), 'never the viewed family'); assert.deepEqual(r2.data.players, r.data.players)
  // No sign in at all, just the pass: nothing.
  const bare = client()
  assert.equal((await bare('/api/jfp-account', { action: 'overview' }, { 'x-jfp-viewas': PASS })).status, 401)
})

await test('a leftover pass cookie from the first version does nothing and is cleared', async () => {
  const s = await portal(lee, 'viewAsStart', { rowId: ROW })
  const t = s.data.url.split('#va=')[1]
  lee.jar.set('jfp_viewas', t)
  const mine = (await acct(lee, 'overview')).data
  assert.ok(!mine.viewAs, 'cookie alone is not a view')
  assert.ok(!lee.jar.get('jfp_viewas'), 'cleared')
})

await test('Exit ends the view and it is in the audit log', async () => {
  assert.equal((await viewTab('viewAsEnd')).status, 200)
  const after = await viewTab('overview')
  assert.ok(!after.data.viewAs, 'pass no longer works')
  const log = JSON.stringify(await kv(['LRANGE', 'jfp:audit', '0', '30']))
  assert.match(log, /account\.viewAs/)
})

console.log(`view as: ${passed} passed`)
process.exit(0)
