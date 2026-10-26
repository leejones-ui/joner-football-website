// Upstash bandwidth fix (26 Oct 2026): My account reads only a family's own
// records once the per family sets are filled, the roster cache stays fresh
// after a change, and the lightweight request badge matches the full list.
// Starts its own harness. Every name and email here is invented.
//   node scripts/test-jfp-kv-bandwidth.mjs
import assert from 'node:assert/strict'
import net from 'node:net'
import { spawn, execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { familyIndexCommands, FAMILY_INDEX_READY } from '../api/_jfp-store.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const port = await new Promise((resolve) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => resolve(p)) }) })
const B = `http://localhost:${port}`
const harness = spawn(process.execPath, [path.join(HERE, 'holiday-local.mjs')], { env: { PATH: process.env.PATH, HOME: process.env.HOME, HOLIDAY_LOCAL_PORT: String(port) }, stdio: ['ignore', 'pipe', 'inherit'] })
await new Promise((resolve, reject) => { harness.stdout.on('data', (d) => { if (String(d).includes('holiday local harness on')) resolve() }); harness.on('exit', (c) => reject(new Error(`harness exited ${c}`))) })
process.on('exit', () => harness.kill())

let ipSeq = 1
function client() {
  const jar = new Map(), ip = `10.8.0.${ipSeq++}`
  return async (p, body) => {
    const res = await fetch(`${B}${p}`, { method: body ? 'POST' : 'GET', redirect: 'manual', headers: { 'content-type': 'application/json', cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '), 'x-forwarded-for': ip, origin: B }, body: body ? JSON.stringify(body) : undefined })
    for (const c of res.headers.getSetCookie?.() || []) { const [kv] = c.split(';'); const i = kv.indexOf('='); const v = kv.slice(i + 1); if (v) jar.set(kv.slice(0, i), v); else jar.delete(kv.slice(0, i)) }
    let data = {}
    try { data = JSON.parse(await res.text()) } catch {}
    return { status: res.status, data }
  }
}
const kv = async (cmd) => { const t = await (await fetch(`${B}/__kv?cmd=${encodeURIComponent(JSON.stringify(cmd))}`)).text(); try { return JSON.parse(t) } catch { return t } }
const post = (p, body) => fetch(`${B}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json())
const calls = (reset) => fetch(`${B}/__calls${reset ? '?reset=1' : ''}`).then((r) => r.json())
async function signIn(call, email, audience) {
  const s = await call('/api/jfp-auth', { action: 'start', email, audience })
  const mail = (await (await fetch(`${B}/__emails`)).json()).filter((e) => e.to.includes(email) && /sign-in code/.test(e.subject)).at(-1)
  const v = await call('/api/jfp-auth', { action: 'verify', challenge: s.data.challenge, code: mail.subject.match(/(\d{6})/)[1] })
  assert.equal(v.status, 200, `sign in ${email}`)
}

const term4 = (await (await fetch(`${B}/__airtable`)).json()).term4
const rowOf = (email) => term4.find((r) => r.fields.Email === email)?.id
const own = rowOf('parent1@example.com'), other = rowOf('parent2@example.com')
assert.ok(own && other, 'harness has parent1 and parent2 rows')

// Paid requests show by id in My account. Ownership is by the family's email
// (ownsPayreq), so of these only PAY-ISO-OWN shows: PAY-ISO-ROW names the
// family's row from another address, PAY-ISO-OTHER is another family.
const at = new Date().toISOString()
const seed = [
  { id: 'PAY-ISO-OWN', email: 'parent1@example.com', term4Ids: [own] },
  { id: 'PAY-ISO-ROW', email: 'grandparent@example.com', term4Ids: [own] },
  { id: 'PAY-ISO-OTHER', email: 'parent2@example.com', term4Ids: [other] },
].map((q) => ({ ...q, status: 'paid', paidAt: at, createdAt: at, amountCents: 85000, playerKeys: [], players: [], playerNames: ['Invented'] }))
for (const q of seed) { await kv(['SET', `jfp:payreq:${q.id}`, JSON.stringify(q)]); await kv(['ZADD', 'jfp:payreqs', String(Date.now()), q.id]) }

const fam = client(), lee = client()
await signIn(fam, 'parent1@example.com', 'parent')
await signIn(lee, 'leejones@jonerfootball.com', 'staff')
const paidIds = async () => { const r = await fam('/api/jfp-account', { action: 'overview' }); assert.equal(r.status, 200, JSON.stringify(r.data)); return (r.data.paid || []).map((p) => p.id).filter((id) => id.startsWith('PAY-ISO')).sort() }

// 1. Before the backfill: the full lists, filtered as before.
const before = await paidIds()
assert.deepEqual(before, ['PAY-ISO-OWN'], 'index off: the family\'s own only')

// 2. After the backfill: the same answer from the family's own sets.
for (const q of seed) for (const c of familyIndexCommands('payreq', q)) await kv(c)
await kv(['SET', FAMILY_INDEX_READY, at])
await calls(true)
assert.deepEqual(await paidIds(), before, 'index on: same records as the full lists')
const c = await calls(true)
assert.ok(!Object.keys(c.kvByKey || {}).some((k) => k.startsWith('jfp:payreq:PAY-ISO-OTHER')), 'another family\'s request is not even read')

// 3. A stale or wrong set entry never shows another family's request: the
// record itself is checked again.
const [stale] = familyIndexCommands('payreq', { id: 'PAY-ISO-OTHER', email: 'parent1@example.com', term4Ids: [] })
await kv(stale)
assert.deepEqual(await paidIds(), before, 'stale set entry is filtered out')

// 4. Roster cache: a change in Airtable shows on the next read, not after the
// cache runs out (the harness marks jfp:roster-cleared, as bustRosterCache does).
const overviewText = async () => JSON.stringify((await fam('/api/jfp-account', { action: 'overview' })).data)
assert.ok(!(await overviewText()).includes('Freshy Newkid'))
const g = term4.find((r) => r.id === own).fields
await post('/__airtable-add', { table: 'term4', rows: [{ ...g, 'Player Name': 'Freshy Newkid' }] })
assert.ok((await overviewText()).includes('Freshy Newkid'), 'new roster row shows straight away')
await calls(true)
await fam('/api/jfp-account', { action: 'overview' })
{ const k = await calls(true); assert.ok(!Object.keys(k.kvByKey || {}).some((x) => x.includes('roster-cache:z')), 'second read uses the in-memory roster: no compressed copy downloaded or written') }

// 5. The badge count matches the full lists it replaces.
const portal = (action, body = {}) => lee('/api/jfp-portal-data', { action, ...body })
await kv(['SET', 'jfp:application:APP-ISO-1', JSON.stringify({ id: 'APP-ISO-1', kind: 'waitlist', status: 'pending', email: 'parent2@example.com', players: [{ name: 'Invented' }], groupId: '', createdAt: at })])
await kv(['ZADD', 'jfp:applications', String(Date.now()), 'APP-ISO-1'])
const [count, reqs, extras] = await Promise.all([portal('requestCount'), portal('requests'), portal('extraRequests')])
assert.equal(count.status, 200)
const full = reqs.data.requests.filter((r) => r.status === 'pending').length + extras.data.requests.filter((r) => r.status !== 'done').length
assert.ok(full >= 1)
assert.equal(count.data.count, full, 'requestCount equals the full lists')
assert.equal((await fam('/api/jfp-portal-data', { action: 'requestCount' })).status >= 400, true, 'families cannot read the count')

// 6. The backfill, rehearsed: records saved before the sets existed (seeded
// straight into KV, with no set entries) fail --verify; after --apply
// --no-ready, --verify finds 0 missing, and ready is left to the last step.
const backfill = (...args) => { try { return { code: 0, out: execFileSync(process.execPath, [path.join(HERE, 'jfp-backfill-family-index.mjs'), ...args], { env: { PATH: process.env.PATH, KV_REST_API_URL: `${B}/__upstash`, KV_REST_API_TOKEN: 'local' }, encoding: 'utf8' }) } } catch (e) { return { code: e.status, out: String(e.stdout) } } }
await kv(['DEL', FAMILY_INDEX_READY])
for (let i = 0; i < 40; i++) {
  const id = `PAY-OLD-${i}`, email = i % 4 ? `old${i % 7}@example.com` : `Old${i % 7}@Example.com, second${i}@example.com`
  await kv(['SET', `jfp:payreq:${id}`, JSON.stringify({ id, email, status: i % 3 ? 'paid' : 'open', term4Ids: i % 5 ? [`recOLD${i % 6}`] : [], playerKeys: [], players: [], amountCents: 85000, createdAt: at })])
  await kv(['ZADD', 'jfp:payreqs', String(Date.now() - i), id])
}
for (let i = 0; i < 10; i++) {
  await kv(['SET', `jfp:application:APP-OLD-${i}`, JSON.stringify({ id: `APP-OLD-${i}`, kind: 'waitlist', status: 'pending', email: `old${i % 3}@example.com`, players: [], groupId: '', createdAt: at })])
  await kv(['ZADD', 'jfp:applications', String(Date.now() - i), `APP-OLD-${i}`])
}
const v1 = backfill('--verify')
assert.equal(v1.code, 1, v1.out); assert.match(v1.out, /NOT READY/)
const a1 = backfill('--apply', '--no-ready')
assert.equal(a1.code, 0, a1.out)
assert.equal(await kv(['GET', FAMILY_INDEX_READY]), null, '--no-ready leaves jfp:idx:ready unset')
const v2 = backfill('--verify')
console.log('backfill verify after apply:', v2.out.trim().split('\n').join(' / ')); assert.equal(v2.code, 0, v2.out); assert.match(v2.out, / 0 missing, 1 extra\. OK/, 'only the stale entry from step 3 is extra')
assert.equal(backfill('--apply').code, 0)
assert.ok(await kv(['GET', FAMILY_INDEX_READY]), 'the last --apply sets ready')
assert.deepEqual(await paidIds(), before, 'My account unchanged after the rehearsal')

console.log('kv bandwidth: family isolation, stale sets, roster freshness and request count all passed')
process.exit(0)
