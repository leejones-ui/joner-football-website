// Add an agent (Lee, 20 Oct 2026), end to end against the local harness: an
// agent who pays for their Pro players gets one account, one email and one
// payment; agent wording, never "family"; no sibling rate; the agent pays
// before the waivers are in and never signs one; each player signs their own
// from their own login. A player added later with the agent's email joins
// the agent's account.
//   npx astro build && HOLIDAY_LOCAL_PORT=4799 node scripts/holiday-local.mjs 4799   (one terminal)
//   node scripts/test-jfp-agents.mjs 4799                                           (another)
// Every name and email here is invented.
import assert from 'node:assert/strict'
import { paidSiblings } from '../api/_jfp-store.js'

const PORT = Number(process.argv[2] || 4321)
const B = `http://localhost:${PORT}`
let passed = 0
async function test(name, fn) { await fn(); passed += 1; console.log(`ok - ${name}`) }

let ipSeq = 40
function client() {
  const jar = new Map()
  const ip = `10.9.8.${ipSeq++}`
  const call = async (path, body) => {
    const res = await fetch(`${B}${path}`, { method: body ? 'POST' : 'GET', redirect: 'manual', headers: { 'content-type': 'application/json', origin: B, 'x-forwarded-for': ip, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') }, body: body ? JSON.stringify(body) : undefined })
    for (const c of res.headers.getSetCookie?.() || []) { const [kv] = c.split(';'); const i = kv.indexOf('='); if (kv.slice(i + 1)) jar.set(kv.slice(0, i), kv.slice(i + 1)); else jar.delete(kv.slice(0, i)) }
    return { status: res.status, data: await res.json().catch(() => ({})) }
  }
  return { call }
}
const getJson = async (p) => (await fetch(`${B}${p}`)).json()
const emails = () => getJson('/__emails')
const at = () => getJson('/__airtable')
async function signIn(c, email, audience = 'parent') {
  const s = await c.call('/api/jfp-auth', { action: 'start', email, audience })
  assert.equal(s.status, 200, JSON.stringify(s.data))
  const code = (await emails()).filter((e) => e.to.includes(email) && /sign-in code/.test(e.subject)).at(-1).subject.match(/(\d{6})/)[1]
  assert.equal((await c.call('/api/jfp-auth', { action: 'verify', challenge: s.data.challenge, code })).status, 200)
}
const ADULT = { accepted: { terms: true, makeups: true, payment: true, emergency: true, adult: true }, media: false, kind: 'adult' }

const lee = client()
await signIn(lee, 'leejones@jonerfootball.com', 'staff')
const portal = (action, body = {}) => lee.call('/api/jfp-portal-data', { action, ...body })
const ok = async (action, body = {}) => { const r = await portal(action, body); assert.equal(r.status, 200, `${action}: ${JSON.stringify(r.data)}`); return r.data }
const GID = (await ok('saveGroup', { group: { day: 'Wednesday', time: '7:40pm', location: 'NTRA', coachId: 'lee', capacity: 16, mode: 'direct' } })).group.id

const AGENT = { name: 'Marco Bellini', email: 'marco.agent@example.com', mobile: '0400 661 200', company: 'Bellini Sports' }
const agent = client()
const acct = (action, body = {}) => agent.call('/api/jfp-account', { action, ...body })
let added, rowOf

await test('Add an agent: two players, one account, one payment, one agent email', async () => {
  const before = (await emails()).length
  added = await ok('addAgent', { agent: AGENT, sendEmail: true, afterpay: true, children: [
    { groupId: GID, player: { name: 'Leo Ferraro', dob: '2004-05-02' }, payment: 'pro', perSessionCents: 6000 },
    { groupId: '', player: { name: 'Dani Okoye', dob: '2006-08-14' }, payment: 'link', amountCents: 30000 },
  ] })
  assert.ok(added.agentId)
  assert.equal(added.rows.length, 2)
  assert.equal(added.payreq.amountLabel, 'A$300')
  const mail = (await emails()).slice(before).filter((m) => m.to.includes(AGENT.email))
  assert.equal(mail.length, 1, 'one email to the agent')
  const text = `${mail[0].subject} ${mail[0].html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ')}`
  assert.match(text, /2 players/)
  assert.match(text, /Hi Marco/)
  assert.ok(!/famil|your child|each child/i.test(text), 'agent wording, never family or child')
  assert.ok(!/—/.test(text), 'no em dashes')
  const rows = (await at()).term4
  rowOf = (id) => rows.find((r) => r.id === id).fields
  for (const r of added.rows) {
    assert.match(rowOf(r.rowId)['Term 4 Notes'], new RegExp(`\\[AGENT:${added.agentId}\\]`))
    assert.equal(rowOf(r.rowId)['Parent Name'], AGENT.name)
    assert.equal(rowOf(r.rowId).Email, AGENT.email)
  }
  assert.match(rowOf(added.rows[0].rowId)['Term 4 Notes'], /Add an agent/)
})

await test('the agent shows on the Players tab and in the agents list', async () => {
  const list = await ok('agentsList')
  const a = list.agents.find((x) => x.email === AGENT.email)
  assert.deepEqual(a.players, ['Dani Okoye', 'Leo Ferraro'])
  assert.equal(a.company, 'Bellini Sports')
  const pl = await ok('playersList', { fresh: true })
  assert.equal(pl.players.find((p) => p.name === 'Leo Ferraro').agent, 'Marco Bellini')
})

await test("the agent's account: agent, players, and payments not held up by waivers", async () => {
  await signIn(agent, AGENT.email)
  const d = (await acct('overview')).data
  assert.equal(d.agent.name, 'Marco Bellini')
  assert.equal(d.players.length, 2)
  assert.ok(d.players.every((p) => p.byAgent && !p.waiver.onFile))
  const link = d.todo.find((t) => t.players.includes('Dani Okoye'))
  assert.equal(link.needsWaiver, false)
  const pay = await acct('pay', { payreqId: link.id })
  assert.notEqual(pay.data.code, 'waiver', JSON.stringify(pay.data))
  // The kit question still comes first (the agent answers it); never the waiver.
  assert.ok(pay.status === 200 || pay.data.code === 'kit', JSON.stringify(pay.data))
})

await test('the agent cannot sign a waiver for a player', async () => {
  const d = (await acct('overview')).data
  const leo = d.players.find((p) => p.name === 'Leo Ferraro')
  const r = await acct('signWaiver', { players: [{ key: leo.key, dob: '2004-05-02', emergencyName: 'Em Ferraro', emergencyPhone: '0400 444 701' }], waiver: { ...ADULT, signature: 'Marco Bellini' }, parentName: 'Marco Bellini', mobile: AGENT.mobile })
  assert.equal(r.status, 403)
  assert.equal(r.data.code, 'agent')
})

await test('the player gets a login from the agent and signs their own waiver', async () => {
  const d = (await acct('overview')).data
  const leo = d.players.find((p) => p.name === 'Leo Ferraro')
  const s = await acct('playerLoginSet', { playerKey: leo.key, email: 'leo.own@example.com' })
  assert.equal(s.status, 200, JSON.stringify(s.data))
  const pl = client()
  await signIn(pl, 'leo.own@example.com')
  const ov = (await pl.call('/api/jfp-account', { action: 'overview' })).data
  assert.equal(ov.playerLogin, true)
  assert.equal(ov.players[0].agentPlayer, true)
  assert.equal(ov.players[0].waiver.onFile, false)
  // Only their own waiver.
  const dani = d.players.find((p) => p.name === 'Dani Okoye')
  assert.equal((await pl.call('/api/jfp-account', { action: 'signWaiver', players: [{ key: dani.key, dob: '2006-08-14', emergencyName: 'Em Okoye', emergencyPhone: '0400 444 702' }], waiver: { ...ADULT, signature: 'Leo Ferraro' }, parentName: 'Leo Ferraro', mobile: '0400 444 703' })).status, 404)
  const w = await pl.call('/api/jfp-account', { action: 'signWaiver', players: [{ key: leo.key, dob: '2004-05-02', emergencyName: 'Em Ferraro', emergencyPhone: '0400 444 701' }], waiver: { ...ADULT, signature: 'Leo Ferraro' }, parentName: 'Leo Ferraro', mobile: '0400 444 703' })
  assert.equal(w.status, 200, JSON.stringify(w.data))
  const after = (await acct('overview')).data
  assert.equal(after.players.find((p) => p.name === 'Leo Ferraro').waiver.onFile, true)
})

await test("no sibling rate: an agent's players are not brothers and sisters", async () => {
  const rows = [
    { player: 'Leo Ferraro', email: AGENT.email, holdsPlace: true, paymentStatus: 'Paid', paidAud: 300, agentId: added.agentId },
    { player: 'Kim Shared', email: 'fam.shared@example.com', holdsPlace: true, paymentStatus: 'Paid', paidAud: 300 },
  ]
  assert.deepEqual(paidSiblings(rows, AGENT.email, ['New Player']), [])
  assert.equal(paidSiblings(rows, 'fam.shared@example.com', ['New Sibling']).length, 1, 'a real family still gets it')
})

await test("a player added later with the agent's email joins the agent's account", async () => {
  const a = await ok('addPlayer', { groupId: GID, force: true, player: { name: 'Tomi Adeyemi', dob: '2005-02-03' }, parent: { name: AGENT.name, email: AGENT.email, mobile: AGENT.mobile }, payment: 'none' })
  const r = (await at()).term4.find((x) => x.id === a.rowId).fields
  assert.match(r['Term 4 Notes'], new RegExp(`\\[AGENT:${added.agentId}\\]`))
  assert.equal((await acct('overview')).data.players.length, 3)
})

await test("an agent's email cannot be a family's email, and the same agent again keeps one record", async () => {
  await ok('addFamily', { parent: { name: 'Pat Walsh', email: 'walsh.fam@example.com', mobile: '0400 661 300' }, sendEmail: false, children: [{ groupId: '', player: { name: 'Ava Walsh' }, payment: 'none' }] })
  const r = await portal('addAgent', { agent: { name: 'Pat Walsh', email: 'walsh.fam@example.com' }, sendEmail: false, children: [{ groupId: '', player: { name: 'Zed Other' }, payment: 'none' }] })
  assert.equal(r.status, 409)
  const again = await ok('addAgent', { agent: { ...AGENT, mobile: '0400 661 999' }, sendEmail: false, children: [{ groupId: '', player: { name: 'Remi Lawal' }, payment: 'none' }] })
  assert.equal(again.agentId, added.agentId)
  const list = (await ok('agentsList')).agents.filter((x) => x.email === AGENT.email)
  assert.equal(list.length, 1)
  assert.equal(list[0].mobile, '0400 661 999')
})

console.log(`\n${passed} agent checks passed`)
