// Hermes access (Lee, 16 Oct 2026), end to end against the local harness:
//   node scripts/holiday-local.mjs 4321 (after npm run build), then
//   node scripts/test-jfp-agent.mjs 4321
// Full access as Lee with the Mac mini key; texts need the confirm header;
// family emails are held until Lee's yes; only a person flips the switch.
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const PORT = process.argv[2] || '4321'
const B = `http://localhost:${PORT}`
const HERE = path.dirname(fileURLToPath(import.meta.url))
let passed = 0, ipSeq = 1
async function test(name, fn) { await fn(); passed += 1; console.log(`ok - ${name}`) }
const emails = async () => (await fetch(`${B}/__emails`)).json()
const kv = async (cmd) => (await fetch(`${B}/__kv?cmd=${encodeURIComponent(JSON.stringify(cmd))}`)).text()

function client() {
  const jar = new Map(), ip = `10.9.0.${ipSeq++}`
  async function call(p, body) {
    const res = await fetch(`${B}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '), 'x-forwarded-for': ip, origin: B }, body: JSON.stringify(body) })
    for (const c of res.headers.getSetCookie?.() || []) { const [kvp] = c.split(';'); const i = kvp.indexOf('='); const v = kvp.slice(i + 1); if (v) jar.set(kvp.slice(0, i), v); else jar.delete(kvp.slice(0, i)) }
    let data = {}; try { data = JSON.parse(await res.text()) } catch {}
    return { status: res.status, data }
  }
  return { call }
}
async function signIn(c, email) {
  const s = await c.call('/api/jfp-auth', { action: 'start', email, audience: 'staff' })
  const code = (await emails()).filter((e) => e.to.includes(email) && /sign-in code/.test(e.subject)).at(-1).subject.match(/(\d{6})/)[1]
  assert.equal((await c.call('/api/jfp-auth', { action: 'verify', challenge: s.data.challenge, code })).status, 200)
}
const KEY = `jfpa_${crypto.randomBytes(32).toString('base64url')}`
async function hermes(endpoint, action, body = {}, { key = KEY, yes = false } = {}) {
  const res = await fetch(`${B}${endpoint}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-jfp-agent-key': key, ...(yes ? { 'x-jfp-confirmed': 'lee-said-yes' } : {}) }, body: JSON.stringify({ ...body, action }) })
  let data = {}; try { data = await res.json() } catch {}
  return { status: res.status, data }
}
const H = (action, body, o) => hermes('/api/jfp-portal-data', action, body, o)

const lee = client()
await signIn(lee, 'leejones@jonerfootball.com')

await test('no key set up: Hermes is refused', async () => {
  assert.equal((await H('me')).status, 401)
})

await kv(['SET', 'jfp:agent:hermes', JSON.stringify({ hash: crypto.createHash('sha256').update(KEY).digest('hex'), enabled: true })])

await test('a wrong key is refused, a short one too', async () => {
  assert.equal((await H('me', {}, { key: KEY.slice(0, -2) + 'xx' })).status, 401)
  assert.equal((await H('me', {}, { key: 'short' })).status, 401)
})

let gid, rowId
await test('the right key acts as Lee: admin actions work with no browser origin', async () => {
  const me = await H('me')
  assert.equal(me.status, 200, JSON.stringify(me.data))
  assert.equal(me.data.user.role, 'admin')
  assert.equal(me.data.user.email, 'leejones@jonerfootball.com')
  const g = await H('saveGroup', { group: { day: 'Thursday', time: '4:40pm', location: 'Belrose HQ', coachId: 'sam', capacity: 12, mode: 'direct', minAge: 7, maxAge: 18 } })
  assert.equal(g.status, 200, JSON.stringify(g.data))
  gid = g.data.group.id
})

await test('an email to a family is held for Lee, not sent', async () => {
  const before = (await emails()).length
  const r = await H('addPlayer', { groupId: gid, force: true, player: { name: 'Hermes Testkid' }, parent: { name: 'Hermes Parent', email: 'hermes.parent@example.com', mobile: '0400000000' }, payment: 'link', amountCents: 50000, sendEmail: true })
  assert.equal(r.status, 200, JSON.stringify(r.data))
  assert.ok(r.data.heldForLee?.length, 'the reply tells Hermes it was held')
  rowId = r.data.rowId || r.data.player?.rowId || r.data.row?.id
  const sent = (await emails()).slice(before)
  assert.ok(!sent.some((e) => e.to.includes('hermes.parent@example.com')), 'nothing reached the family')
  const a = await lee.call('/api/jfp-portal-data', { action: 'agentAccess' })
  assert.equal(a.status, 200)
  assert.ok(a.data.held.some((h) => h.to.includes('hermes.parent@example.com')), JSON.stringify(a.data.held.map((h) => h.to)))
  assert.ok(a.data.recent.some((e) => e.via === 'Hermes for Lee'), 'audit rows carry Hermes for Lee')
})

await test('Hermes cannot release a held email without the confirm flag; Lee can from the portal', async () => {
  const a = await lee.call('/api/jfp-portal-data', { action: 'agentAccess' })
  const h = a.data.held.find((x) => x.to.includes('hermes.parent@example.com'))
  // The release itself sends nothing while unconfirmed: the email is held again.
  const before = (await emails()).length
  const r = await H('agentRelease', { id: h.id })
  assert.equal(r.status, 200)
  assert.equal((await emails()).slice(before).filter((e) => e.to.includes('hermes.parent@example.com')).length, 0)
  const again = (await lee.call('/api/jfp-portal-data', { action: 'agentAccess' })).data.held.find((x) => x.to.includes('hermes.parent@example.com'))
  assert.ok(again, 'still waiting for Lee')
  const s = await lee.call('/api/jfp-portal-data', { action: 'agentRelease', id: again.id })
  assert.equal(s.status, 200, JSON.stringify(s.data))
  assert.ok((await emails()).some((e) => e.to.includes('hermes.parent@example.com')), 'sent after Lee pressed Send')
  assert.equal((await lee.call('/api/jfp-portal-data', { action: 'agentAccess' })).data.held.length, 0)
})

await test('with the confirm flag (Lee said yes in the chat) an email goes straight out', async () => {
  const before = (await emails()).length
  const r = await H('addPlayer', { groupId: gid, force: true, player: { name: 'Hermes Second' }, parent: { name: 'Second Parent', email: 'hermes.second@example.com', mobile: '0400000001' }, payment: 'link', amountCents: 50000, sendEmail: true }, { yes: true })
  assert.equal(r.status, 200, JSON.stringify(r.data))
  assert.ok((await emails()).slice(before).some((e) => e.to.includes('hermes.second@example.com')))
})

await test('a text needs Lee\'s yes: refused without the flag, nothing queued', async () => {
  const r = await hermes('/api/jfp-messages', 'quickText', { rowIds: [rowId].filter(Boolean), text: 'Hi, test' })
  assert.equal(r.status, 428, JSON.stringify(r.data))
  assert.match(r.data.error, /show Lee the exact message/i)
  const c = await hermes('/api/jfp-messages', 'campaign')
  assert.equal(c.status, 200, 'reading Messages is fine')
})

await test('the register: Hermes marks a player present, audited as Hermes for Lee', async () => {
  const board = await H('board')
  assert.equal(board.status, 200)
  const grp = board.data.groups.find((x) => x.id === gid)
  const p = grp.players[0]
  const date = (await H('coachSessions', { coachId: 'sam' })).data.sessions.find((x) => x.id === gid).nextDate
  const m = await H('markAttendance', { groupId: gid, date, rowId: p.rowId, status: 'Present' })
  assert.equal(m.status, 200, JSON.stringify(m.data))
  const audit = (await lee.call('/api/jfp-portal-data', { action: 'audit' })).data.entries
  assert.ok(audit.some((e) => e.action === 'agent.call' && e.target === 'portal:markAttendance'))
})

await test('the jfp command finds players and calls actions', async () => {
  const keyFile = path.join(os.tmpdir(), `hermes-key-${process.pid}`)
  fs.writeFileSync(keyFile, KEY, { mode: 0o600 })
  const cli = path.join(HERE, '..', '..', '..', 'Desktop', 'Claude Projects', 'JFP Agent', 'hermes', 'jfp')
  const bin = fs.existsSync(cli) ? cli : process.env.JFP_CLI
  if (!bin) { console.log('  (jfp command not found, skipped)'); return }
  const run = (...a) => spawnSync(process.execPath, [bin, ...a], { encoding: 'utf8', env: { ...process.env, JFP_BASE: B, JFP_AGENT_KEY_FILE: keyFile } })
  const f = run('find', 'hermes')
  assert.equal(f.status, 0, f.stderr)
  const hits = JSON.parse(f.stdout)
  assert.ok(hits.some((x) => x.name === 'Hermes Testkid' && x.rowId && x.groupId === gid && x.nextDate), f.stdout)
  assert.ok(hits.some((x) => x.register === 'Present'), f.stdout)
  const me = run('me')
  assert.equal(JSON.parse(me.stdout).user.role, 'admin')
  const rel = run('release', 'AHx')
  assert.notEqual(rel.status, 0, 'release without --yes is stopped')
  fs.rmSync(keyFile)
})

await test('only a signed-in person flips the switch; off locks Hermes out at once', async () => {
  assert.equal((await H('agentSwitch', { enabled: false })).status, 403)
  assert.equal((await lee.call('/api/jfp-portal-data', { action: 'agentSwitch', enabled: false })).status, 200)
  assert.equal((await H('me')).status, 401)
  assert.equal((await lee.call('/api/jfp-portal-data', { action: 'agentSwitch', enabled: true })).status, 200)
  assert.equal((await H('me')).status, 200)
})

await test('Lee\'s own browser sign-in is unchanged; a page on another site still cannot post', async () => {
  assert.equal((await lee.call('/api/jfp-portal-data', { action: 'me' })).data.user.role, 'admin')
  const res = await fetch(`${B}/api/jfp-portal-data`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: JSON.stringify({ action: 'me' }) })
  assert.equal(res.status, 403)
})

console.log(`\n${passed} passed`)
