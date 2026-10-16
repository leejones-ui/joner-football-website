// The account guide to everyone (Lee, 16 Oct 2026), against the local harness:
//   node scripts/holiday-local.mjs 4321 (after npm run build), then
//   node scripts/test-jfp-guide.mjs 4321
import assert from 'node:assert/strict'

const B = `http://localhost:${process.argv[2] || 4321}`
let passed = 0, ipSeq = 10
async function test(name, fn) { await fn(); passed += 1; console.log(`ok - ${name}`) }
function client(ip = `10.9.7.${ipSeq++}`) {
  const jar = new Map()
  const call = async (path, body) => {
    const res = await fetch(`${B}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: B, 'x-forwarded-for': ip, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') }, body: JSON.stringify(body) })
    for (const c of res.headers.getSetCookie?.() || []) { const [kv] = c.split(';'); const i = kv.indexOf('='); if (kv.slice(i + 1)) jar.set(kv.slice(0, i), kv.slice(i + 1)); else jar.delete(kv.slice(0, i)) }
    return { status: res.status, data: await res.json().catch(() => ({})) }
  }
  return { call }
}
const emails = async () => (await fetch(`${B}/__emails`)).json()
const kv = async (cmd) => (await fetch(`${B}/__kv?cmd=${encodeURIComponent(JSON.stringify(cmd))}`)).text()
async function signIn(c, email, audience = 'parent') {
  const s = await c.call('/api/jfp-auth', { action: 'start', email, audience })
  const code = (await emails()).filter((e) => e.to.includes(email) && /code/i.test(e.subject)).at(-1).subject.match(/(\d{6})/)[1]
  return c.call('/api/jfp-auth', { action: 'verify', challenge: s.data.challenge, code })
}
const lee = client(), ligia = client()
await signIn(lee, 'leejones@jonerfootball.com', 'staff')
await signIn(ligia, 'ligia@jonerfootball.com', 'staff')
const msg = (c, action, body = {}) => c.call('/api/jfp-messages', { action, ...body })
const portal = (action, body = {}) => lee.call('/api/jfp-portal-data', { action, ...body })

// A Term 4 family owing money, a request, and a brand new account.
const g = (await portal('saveGroup', { group: { day: 'Thursday', time: '4:50pm', location: 'Belrose HQ', coachId: 'sam', capacity: 12, mode: 'direct', minAge: 5, maxAge: 18 } })).data.group
const add = await portal('addPlayer', { groupId: g.id, force: true, player: { name: 'Gina Guide' }, parent: { name: 'Gail Guide', email: 'gail.guide@example.com', mobile: '0400 111 222' }, payment: 'none', feeAud: 650 })
assert.equal(add.status, 200, JSON.stringify(add.data))
const fam = client()
await fam.call('/api/jfp-access', { password: 'term4' })
await signIn(fam, 'asker.guide@example.com')
const ag = (await portal('saveGroup', { group: { day: 'Friday', time: '5:10pm', location: 'Belrose HQ', coachId: 'sam', capacity: 8, mode: 'application' } })).data.group.id
const ask = await fam.call('/api/jfp-book', { action: 'request', kind: 'application', groupId: ag, players: [{ name: 'Asha Guide', dob: '2014-02-02', emergencyName: 'Ari Guide', emergencyPhone: '0400777888' }], parentName: 'Ari Guide', mobile: '0422 333 444', answers: { club: 'X', team: 'U12' }, waiver: { accepted: { terms: true, makeups: true, payment: true, emergency: true }, media: false, signature: 'Ari Guide' } })
assert.equal(ask.status, 200, JSON.stringify(ask.data))
const nu = client()
await signIn(nu, 'newbie.guide@example.com')
assert.equal((await nu.call('/api/jfp-account', { action: 'addPlayer', name: 'Nate Newbie', dob: '2013-01-01', values: { parentName: 'Nora Newbie', parentMobile: '0400 999 888', club: 'Manly United', positions: ['Winger'], foot: 'Left', goals: 'Finishing', emergencyName: 'Nora Newbie', emergencyPhone: '0400 999 888' } })).status, 200)

let prep
await test('prepare drafts an email and a text for each group', async () => {
  const r = await msg(lee, 'prepareGuide', { groups: ['term', 'enquiry', 'account'] })
  assert.equal(r.status, 200, JSON.stringify(r.data))
  prep = r.data
  assert.ok(prep.byGroup.term >= 1 && prep.byGroup.enquiry >= 1 && prep.byGroup.account >= 1, JSON.stringify(prep.byGroup))
  const c = (await msg(lee, 'guide')).data
  assert.equal(c.email.draft, prep.emails)
  assert.deepEqual(c.samples.map((s) => s.group).sort(), ['account', 'enquiry', 'term'])
  for (const s of c.samples) {
    assert.ok(!/—/.test(s.html + s.text), 'no em dashes')
    assert.ok(!/programme/i.test(s.html + s.text), 'program, not programme')
    assert.ok(!/\bSam\b|Coach Sam/.test(s.html + s.text), 'no coach names')
    if (s.text) assert.ok(s.text.length <= 640, `text ${s.text.length} chars`)
  }
})

await test('only Lee sends; Ligia can prepare and look', async () => {
  assert.equal((await msg(ligia, 'guide')).status, 200)
  assert.equal((await msg(ligia, 'sendGuide', { channel: 'email', confirm: true })).status, 403)
})

await test('Lee sends the emails: each family gets its own sign-in email and to-do list', async () => {
  const before = (await emails()).length
  let left = 1
  for (let i = 0; i < 30 && left; i++) { const r = await msg(lee, 'sendGuide', { channel: 'email', confirm: true }); assert.equal(r.status, 200, JSON.stringify(r.data)); left = r.data.left }
  const sent = (await emails()).slice(before)
  const gail = sent.find((e) => e.to.includes('gail.guide@example.com'))
  assert.ok(gail, 'Term 4 family emailed')
  const body = gail.html || gail.htmlContent || JSON.stringify(gail)
  assert.match(body, /gail\.guide@example\.com/)
  assert.match(body, /Gina Guide/)
  assert.match(body, /Pay A\$\d/, 'the fee still owing')
  assert.match(body, /Sign the waiver/)
  assert.match(body, /every detail|date of birth/, 'player information to do')
  const asker = sent.find((e) => e.to.includes('asker.guide@example.com'))
  assert.ok(asker, 'request emailed')
  assert.match(asker.html || JSON.stringify(asker), /Booking a place/)
  const newbie = sent.find((e) => e.to.includes('newbie.guide@example.com'))
  assert.ok(newbie, 'new account emailed')
  assert.match(newbie.html || JSON.stringify(newbie), /Your account is up to date/)
})

await test('prepare again: nobody is emailed twice', async () => {
  const r = await msg(lee, 'prepareGuide', { groups: ['term', 'enquiry', 'account'] })
  assert.equal(r.data.emails, 0, JSON.stringify(r.data))
  assert.ok(r.data.already.length >= 3)
})

await test('texts wait for a verified route, then queue with Lee\'s reason', async () => {
  const t = (await msg(lee, 'guide')).data.text
  assert.ok(t.draft >= 3, JSON.stringify(t))
  assert.equal((await msg(lee, 'sendGuide', { channel: 'text', confirm: true, basis: 'test' })).status, 409)
  await kv(['SET', 'jfp:msg-route', JSON.stringify({ verified: true, label: 'test', sender: '0404' })])
  let left = 1, queued = 0
  for (let i = 0; i < 30 && left; i++) { const r = await msg(lee, 'sendGuide', { channel: 'text', confirm: true, basis: 'Service message about their account' }); assert.equal(r.status, 200, JSON.stringify(r.data)); left = r.data.left; queued += r.data.queued }
  assert.ok(queued >= 3)
})

await test('the office Mac picks up the request and new account texts with their own mobiles', async () => {
  const T = 'local-relay-token-0123456789abcdef0123'
  const got = []
  for (let i = 0; i < 200; i++) {
    const r = await (await fetch(`${B}/api/jfp-messages-relay`, { method: 'POST', headers: { authorization: `Bearer ${T}`, 'content-type': 'application/json' }, body: JSON.stringify({ action: 'claim', host: 'test' }) })).json()
    if (!r.message) break
    got.push(r.message)
  }
  const ari = got.find((m) => /^Hi Ari,/.test(m.text)), nora = got.find((m) => /^Hi Nora,/.test(m.text))
  assert.ok(ari && /422333444$/.test(ari.to.replace(/\D/g, '')), 'request: the mobile on the request')
  assert.ok(nora && /400999888$/.test(nora.to.replace(/\D/g, '')), 'new account: the mobile on the profile')
  assert.match(nora.text, /newbie\.guide@example\.com/)
})

console.log(`\n${passed} account guide checks passed`)
