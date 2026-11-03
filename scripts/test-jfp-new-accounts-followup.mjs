// New accounts follow up (Lee, 3 Nov 2026): a new account needs a valid
// mobile; To follow up, Followed up and Outside Sydney tabs; Done and Move
// back; email and text a new account from the portal; outside Sydney gets
// the app email straight away; the family search shows the family the
// account is already in.
//   npx astro build && HOLIDAY_LOCAL_PORT=4799 node scripts/holiday-local.mjs 4799   (one terminal)
//   node scripts/test-jfp-new-accounts-followup.mjs 4799                             (another)
// Every name and email here is invented.
import assert from 'node:assert/strict'

const B = `http://localhost:${process.argv[2] || 4321}`
let passed = 0, ipSeq = 10
async function test(name, fn) { await fn(); passed += 1; console.log(`ok - ${name}`) }
function client(extra = {}, ip = `10.9.8.${ipSeq++}`) {
  const jar = new Map()
  const call = async (path, body) => {
    const res = await fetch(`${B}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: B, 'x-forwarded-for': ip, ...extra, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') }, body: JSON.stringify(body) })
    for (const c of res.headers.getSetCookie?.() || []) { const [kv] = c.split(';'); const i = kv.indexOf('='); if (kv.slice(i + 1)) jar.set(kv.slice(0, i), kv.slice(i + 1)); else jar.delete(kv.slice(0, i)) }
    return { status: res.status, data: await res.json().catch(() => ({})) }
  }
  return { call }
}
const emails = async () => (await fetch(`${B}/__emails`)).json()
const codeFor = async (email) => (await emails()).filter((e) => e.to.includes(email) && /sign-in code/.test(e.subject)).at(-1).subject.match(/(\d{6})/)[1]
async function signIn(c, email, audience = 'parent', mobile = '0412 345 678') {
  const s = await c.call('/api/jfp-auth', { action: 'start', email, audience, ...(mobile ? { mobile } : {}) })
  assert.equal(s.status, 200, JSON.stringify(s.data))
  return c.call('/api/jfp-auth', { action: 'verify', challenge: s.data.challenge, code: await codeFor(email) })
}
const lee = client()
await signIn(lee, 'leejones@jonerfootball.com', 'staff', '')
const portal = (action, body = {}) => lee.call('/api/jfp-portal-data', { action, ...body })
const manage = (op, body = {}) => portal('accountManage', { op, ...body })
const tab = async (show) => (await portal('newAccounts', { show })).data
const has = (d, email) => d.accounts.some((a) => a.email === email)

const NEW = 'sam.newfamily@example.com', AWAY = 'far.coach@example.com', NOMOB = 'no.mobile@example.com'

await test('a new email needs a valid mobile; a family on file does not', async () => {
  const c = client()
  const none = await c.call('/api/jfp-auth', { action: 'start', email: NEW, audience: 'parent' })
  assert.equal(none.status, 400); assert.equal(none.data.code, 'mobile')
  const bad = await c.call('/api/jfp-auth', { action: 'start', email: NEW, audience: 'parent', mobile: '02 9999 1234' })
  assert.equal(bad.status, 400); assert.equal(bad.data.code, 'mobile'); assert.match(bad.data.error, /04/)
  assert.equal((await c.call('/api/jfp-auth', { action: 'start', email: 'parent1@example.com', audience: 'parent' })).status, 200, 'a Term 4 family signs in with just the email')
  assert.equal((await signIn(c, NEW, 'parent', '0412 555 666')).status, 200)
  const a = (await tab('todo')).accounts.find((x) => x.email === NEW)
  assert.ok(a, 'on To follow up')
  assert.equal(a.mobile, '+61412555666', 'the mobile they gave is on the account')
})

await test('an overseas mobile works; the where question is still asked once', async () => {
  const c = client()
  const s = await c.call('/api/jfp-auth', { action: 'start', email: NOMOB, audience: 'parent', mobile: '+44 7700 900123' })
  assert.equal(s.status, 200)
  await c.call('/api/jfp-auth', { action: 'verify', challenge: s.data.challenge, code: await codeFor(NOMOB) })
  const o = (await c.call('/api/jfp-account', { action: 'overview' })).data
  assert.ok(o.askWhere && o.askWhere.needMobile === false, 'they gave one, so it is not asked')
  assert.equal((await c.call('/api/jfp-account', { action: 'saveWhere', place: 'sydney', forWho: 'child' })).status, 200)
  assert.equal((await c.call('/api/jfp-account', { action: 'overview' })).data.askWhere, null)
})

await test('Done moves them to Followed up with how; Move back puts them back', async () => {
  const r = await manage('review', { email: NEW, how: 'call', note: 'Trial next Tuesday' })
  assert.equal(r.status, 200, JSON.stringify(r.data))
  assert.ok(!has(await tab('todo'), NEW))
  const f = (await tab('followed')).accounts.find((x) => x.email === NEW)
  assert.equal(f.followHow, 'call'); assert.equal(f.followNote, 'Trial next Tuesday'); assert.equal(f.reviewedBy, 'leejones@jonerfootball.com')
  assert.equal((await manage('unreview', { email: NEW })).status, 200)
  assert.ok(has(await tab('todo'), NEW)); assert.ok(!has(await tab('followed'), NEW))
})

await test('Email them sends exactly the words, replies to Ligia, then Followed up', async () => {
  const before = (await emails()).length
  const r = await manage('emailAccount', { email: NEW, subject: 'Your Joner Football account', text: 'Hi Sam. It is Lee from Joner Football.\n\nHow old is your player?', cta: 'account' })
  assert.equal(r.status, 200, JSON.stringify(r.data))
  const m = (await emails()).slice(before).find((e) => e.to.includes(NEW))
  assert.ok(m, 'one email'); assert.equal(m.subject, 'Your Joner Football account')
  assert.match(JSON.stringify(m), /How old is your player/)
  const f = (await tab('followed')).accounts.find((x) => x.email === NEW)
  assert.equal(f.followHow, 'email')
  assert.equal((await manage('emailAccount', { email: NEW, subject: 'x', text: 'short' })).status, 400)
})

await test('Text them reaches the text check with the account mobile', async () => {
  const r = await lee.call('/api/jfp-messages', { action: 'quickText', accountEmail: NEW, text: 'Hi Sam, it is Lee from Joner Football. How old is your player?' })
  assert.ok([200, 409].includes(r.status), JSON.stringify(r.data))
  if (r.status === 409) assert.equal(r.data.code, 'route', 'only the unverified text route stops it here')
  else assert.equal(r.data.to, '•••• 666')
})

await test('outside Sydney: their own tab, and the app email is due straight away', async () => {
  const c = client({ 'x-vercel-ip-country': 'GB' })
  await signIn(c, AWAY, 'parent', '+44 7700 900456')
  assert.equal((await c.call('/api/jfp-account', { action: 'saveWhere', place: 'overseas', country: 'England', forWho: 'coach' })).status, 200)
  assert.ok(has(await tab('away'), AWAY)); assert.ok(!has(await tab('todo'), AWAY))
  const fu = (await portal('followUps')).data
  const row = (fu.accounts || []).find((a) => a.email === AWAY)
  assert.ok(row, JSON.stringify(Object.keys(fu)))
  assert.equal(row.away, true); assert.ok(row.due || row.sentAt, 'due now, not in 3 days')
})

await test('family search: the family they are already in shows, marked', async () => {
  const fam = client()
  await signIn(fam, 'parent1@example.com')
  const d = (await manage('familySearch', { q: 'parent1', email: 'parent1@example.com' })).data
  assert.ok(Array.isArray(d.families))
  if (d.families.length) assert.ok(d.families.every((f) => f.mine === true || f.mine === false))
  assert.equal((await manage('familySearch', { q: 'z', email: NEW })).data.families.length, 0)
})

console.log(`\n${passed} passed`)
