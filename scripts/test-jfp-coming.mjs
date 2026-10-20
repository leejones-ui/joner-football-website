// I'm coming (Lee, 20 Oct 2026), end to end against the local harness:
// session by session and Pro players tap I'm coming for one date or every
// week left; the coach sees Coming / Not said yet; Can't make it clears a yes.
// Never touches the register (jfp:att) and never charges or emails anyone.
//   npx astro build && HOLIDAY_LOCAL_PORT=4799 node scripts/holiday-local.mjs 4799   (one terminal)
//   node scripts/test-jfp-coming.mjs 4799                                           (another)
// Every name and email here is invented.
import assert from 'node:assert/strict'

const PORT = Number(process.argv[2] || 4321)
const B = `http://localhost:${PORT}`
let passed = 0
async function test(name, fn) { await fn(); passed += 1; console.log(`ok - ${name}`) }

let ipSeq = 20
function client() {
  const jar = new Map()
  const ip = `10.9.7.${ipSeq++}`
  const call = async (path, body) => {
    const res = await fetch(`${B}${path}`, { method: body ? 'POST' : 'GET', redirect: 'manual', headers: { 'content-type': 'application/json', origin: B, 'x-forwarded-for': ip, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') }, body: body ? JSON.stringify(body) : undefined })
    for (const c of res.headers.getSetCookie?.() || []) { const [kv] = c.split(';'); const i = kv.indexOf('='); if (kv.slice(i + 1)) jar.set(kv.slice(0, i), kv.slice(i + 1)); else jar.delete(kv.slice(0, i)) }
    return { status: res.status, data: await res.json().catch(() => ({})) }
  }
  return { call }
}
const getJson = async (p) => (await fetch(`${B}${p}`)).json()
const emails = () => getJson('/__emails')
const kv = async (cmd) => (await fetch(`${B}/__kv?cmd=${encodeURIComponent(JSON.stringify(cmd))}`)).text()
async function signIn(c, email, audience = 'parent') {
  const s = await c.call('/api/jfp-auth', { action: 'start', email, audience })
  assert.equal(s.status, 200, JSON.stringify(s.data))
  const code = (await emails()).filter((e) => e.to.includes(email) && /sign-in code/.test(e.subject)).at(-1).subject.match(/(\d{6})/)[1]
  assert.equal((await c.call('/api/jfp-auth', { action: 'verify', challenge: s.data.challenge, code })).status, 200)
}

const lee = client()
await signIn(lee, 'leejones@jonerfootball.com', 'staff')
const ok = async (action, body = {}) => { const r = await lee.call('/api/jfp-portal-data', { action, ...body }); assert.equal(r.status, 200, `${action}: ${JSON.stringify(r.data)}`); return r.data }
const GID = (await ok('saveGroup', { group: { day: 'Saturday', time: '7:15am', location: 'NTRA', coachId: 'lee', capacity: 16, mode: 'direct' } })).group.id

let seq = 0
async function family(surname, paymentType) {
  seq += 1
  const email = `${surname.toLowerCase()}.coming${seq}@example.com`
  const a = await ok('addPlayer', { groupId: GID, force: true, player: { name: `Sam ${surname}`, dob: `2012-0${seq}-1${seq}` }, parent: { name: `Alex ${surname}`, email, mobile: `0400 551 ${100 + seq}` }, payment: 'none' })
  if (paymentType) await ok('editPlayer', { rowId: a.rowId, fields: { paymentType, ...(/session/i.test(paymentType) ? { perSessionAud: 50 } : {}) } })
  const c = client()
  await signIn(c, email)
  const acct = async (action, body = {}) => c.call('/api/jfp-account', { action, ...body })
  const enrol = async () => (await acct('overview')).data.players.flatMap((p) => p.enrolments).find((e) => e.rowId === a.rowId)
  return { email, rowId: a.rowId, acct, enrol }
}

const sbs = await family('Reyes', 'JFP Session by session')
const pro = await family('Okafor', 'JFP Pro sessions')
const term = await family('Lindqvist', '')
const mailsBefore = (await emails()).length

await test('session by session and Pro places ask; a term place does not', async () => {
  const e = await sbs.enrol()
  assert.equal(e.asksComing, true)
  assert.deepEqual(e.coming, [])
  assert.ok(e.sessions.length >= 2, 'needs at least two dates still to come')
  assert.equal((await pro.enrol()).asksComing, true)
  assert.equal((await term.enrol()).asksComing, undefined)
  const r = await term.acct('comingSession', { rowId: term.rowId, dates: [(await term.enrol()).sessions[0].iso] })
  assert.equal(r.status, 404)
})

await test('one tap saves one date in its own key, never the register', async () => {
  const e = await sbs.enrol()
  const d = e.sessions[0].iso
  const r = await sbs.acct('comingSession', { rowId: sbs.rowId, dates: [d] })
  assert.equal(r.status, 200, JSON.stringify(r.data))
  assert.deepEqual(r.data.coming, [d])
  assert.deepEqual((await sbs.enrol()).coming, [d])
  assert.match(await kv(['HGET', `jfp:avail:${GID}:${d}`, sbs.rowId]), /"by"/)
  assert.ok(!/Present/.test(await kv(['HGET', `jfp:att:${GID}:${d}`, sbs.rowId])), 'register untouched')
})

await test('every week left in one go, and take one back', async () => {
  const e = await sbs.enrol()
  const all = e.sessions.map((s) => s.iso)
  const r = await sbs.acct('comingSession', { rowId: sbs.rowId, dates: all.filter((d) => !e.coming.includes(d)) })
  assert.equal(r.status, 200)
  assert.deepEqual(r.data.coming.sort(), [...all].sort())
  const off = await sbs.acct('comingSession', { rowId: sbs.rowId, dates: [all[1]], on: false })
  assert.equal(off.status, 200)
  assert.ok(!off.data.coming.includes(all[1]))
  await sbs.acct('comingSession', { rowId: sbs.rowId, dates: [all[1]] })
})

await test("can't make it clears the yes for that date and the register shows told us", async () => {
  const e = await sbs.enrol()
  const d = e.sessions[1].iso
  assert.ok(e.coming.includes(d))
  const c = await sbs.acct('cancelSession', { rowId: sbs.rowId, date: d, reason: 'sick', note: '' })
  assert.equal(c.status, 200, JSON.stringify(c.data))
  assert.ok(!(await sbs.enrol()).coming.includes(d))
  assert.equal(await kv(['HGET', `jfp:att:${GID}:${d}`, sbs.rowId]), 'Notified')
  // Saying yes again while the can't make it stands is skipped.
  const again = await sbs.acct('comingSession', { rowId: sbs.rowId, dates: [d] })
  assert.equal(again.status, 200)
  assert.deepEqual(again.data.skipped, [d])
  assert.ok(!again.data.coming.includes(d))
})

await test('no past or made-up dates, and nobody else\'s place', async () => {
  assert.equal((await sbs.acct('comingSession', { rowId: sbs.rowId, dates: ['2026-10-10'] })).status, 400)
  assert.equal((await sbs.acct('comingSession', { rowId: sbs.rowId, dates: [] })).status, 400)
  const d = (await pro.enrol()).sessions[0].iso
  assert.equal((await sbs.acct('comingSession', { rowId: pro.rowId, dates: [d] })).status, 404)
})

await test('the coach sees Coming, Not said yet and can\'t make it', async () => {
  const d0 = (await sbs.enrol()).sessions[0].iso
  const d1 = (await sbs.enrol()).sessions[1].iso
  const s = (await ok('coachSessions', { coachId: 'lee' })).sessions.find((x) => x.id === GID)
  assert.ok(s, 'the session is listed')
  const by = (n) => s.players.find((p) => p.name === n)
  assert.equal(by('Sam Reyes').bySession, true)
  assert.equal(by('Sam Okafor').bySession, true)
  assert.equal(by('Sam Lindqvist').bySession, undefined)
  assert.equal(s.comingBy[d0][sbs.rowId], true)
  assert.equal(s.comingBy[d0][pro.rowId], undefined, 'Pro has not said yet')
  assert.equal((s.comingBy[d1] || {})[sbs.rowId], undefined)
  assert.ok(s.cancelledBy[d1][sbs.rowId], "can't make it shows")
})

await test('nothing was emailed or charged by I\'m coming', async () => {
  const after = (await emails()).slice(mailsBefore)
  assert.ok(after.every((m) => !/coming/i.test(m.subject)), 'no I\'m coming email')
  const pis = await getJson('/__stripe-pis')
  assert.equal(pis.filter((p) => p.metadata?.rowId === sbs.rowId).length, 0)
})

console.log(`\n${passed} passed`)
