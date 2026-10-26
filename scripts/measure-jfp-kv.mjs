// KV transfer per flow (26 Oct 2026, the Upstash bandwidth notice). Starts the
// local harness with an invented roster the size of the real one
// (HARNESS_BULK), seeds invented payment requests and applications, then runs
// the same flows and prints KV commands and bytes for each. Run it on two
// checkouts to compare before and after:
//   node scripts/measure-jfp-kv.mjs
// Every name and email here is invented.
import net from 'node:net'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const port = await new Promise((resolve) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => resolve(p)) }) })
const B = `http://localhost:${port}`
const harness = spawn(process.execPath, [path.join(HERE, 'holiday-local.mjs')], {
  env: { PATH: process.env.PATH, HOME: process.env.HOME, HOLIDAY_LOCAL_PORT: String(port), HARNESS_BULK: process.env.HARNESS_BULK || '135' },
  stdio: ['ignore', 'pipe', 'inherit'],
})
await new Promise((resolve, reject) => { harness.stdout.on('data', (d) => { if (String(d).includes('holiday local harness on')) resolve() }); harness.on('exit', (c) => reject(new Error(`harness exited ${c}`))) })
process.on('exit', () => harness.kill())

let ipSeq = 1
function client() {
  const jar = new Map(), ip = `10.9.0.${ipSeq++}`
  return async (p, body) => {
    const res = await fetch(`${B}${p}`, { method: body ? 'POST' : 'GET', redirect: 'manual', headers: { 'content-type': 'application/json', cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '), 'x-forwarded-for': ip, origin: B }, body: body ? JSON.stringify(body) : undefined })
    for (const c of res.headers.getSetCookie?.() || []) { const [kv] = c.split(';'); const i = kv.indexOf('='); const v = kv.slice(i + 1); if (v) jar.set(kv.slice(0, i), v); else jar.delete(kv.slice(0, i)) }
    let data = {}
    try { data = JSON.parse(await res.text()) } catch {}
    return { status: res.status, data }
  }
}
const kv = async (cmd) => (await fetch(`${B}/__kv?cmd=${encodeURIComponent(JSON.stringify(cmd))}`)).text()
async function signIn(call, email, audience) {
  const s = await call('/api/jfp-auth', { action: 'start', email, audience })
  const mail = (await (await fetch(`${B}/__emails`)).json()).filter((e) => e.to.includes(email) && /sign-in code/.test(e.subject)).at(-1)
  const v = await call('/api/jfp-auth', { action: 'verify', challenge: s.data.challenge, code: mail.subject.match(/(\d{6})/)[1] })
  if (v.status !== 200) throw new Error(`sign in ${email}: ${JSON.stringify(v.data)}`)
}

// Invented payment requests (about 1.1 KB each, like the live ones) and applications.
const pad = (s, n) => s.padEnd(n, ' invented filler')
for (let i = 0; i < 90; i++) {
  const id = `PAY-MEASURE-${i}`, at = new Date(Date.now() - i * 3600000).toISOString()
  await kv(['SET', `jfp:payreq:${id}`, JSON.stringify({ id, email: `bulk${i}@example.com`, status: i % 3 ? 'paid' : 'open', term4Ids: [`recBULK${i}`], playerKeys: [], players: [], amountCents: 85000, createdAt: at, note: pad(`Invented payment ${i}`, 900) })])
  await kv(['ZADD', 'jfp:payreqs', String(Date.parse(at)), id])
}
for (let i = 0; i < 13; i++) {
  const id = `APP-MEASURE-${i}`, at = new Date(Date.now() - i * 7200000).toISOString()
  await kv(['SET', `jfp:application:${id}`, JSON.stringify({ id, kind: 'waitlist', status: i % 2 ? 'pending' : 'offered', email: `bulk${i}@example.com`, players: [{ name: `Bulk Player ${i}` }], groupId: '', createdAt: at, note: pad('Invented application', 700) })])
  await kv(['ZADD', 'jfp:applications', String(Date.parse(at)), id])
}

// The family's own open payment request.
await kv(['SET', 'jfp:payreq:PAY-MEASURE-FAM', JSON.stringify({ id: 'PAY-MEASURE-FAM', email: 'parent1@example.com', status: 'open', term4Ids: [], playerKeys: [], players: [], amountCents: 85000, createdAt: new Date().toISOString(), note: 'Invented' })])
await kv(['ZADD', 'jfp:payreqs', String(Date.now()), 'PAY-MEASURE-FAM'])
// MEASURE_INDEX=1: as if scripts/jfp-backfill-family-index.mjs had run (the
// per family sets filled for the records seeded above, and jfp:idx:ready set).
if (process.env.MEASURE_INDEX === '1') {
  const { familyIndexCommands, FAMILY_INDEX_READY } = await import('../api/_jfp-store.js')
  for (const [kind, index, prefix] of [['payreq', 'jfp:payreqs', 'jfp:payreq:'], ['application', 'jfp:applications', 'jfp:application:']]) {
    for (const id of JSON.parse(await kv(['ZRANGE', index, '0', '-1']))) for (const c of familyIndexCommands(kind, JSON.parse(await kv(['GET', prefix + id])))) await kv(c)
  }
  await kv(['SET', FAMILY_INDEX_READY, new Date().toISOString()])
}
const reset = () => fetch(`${B}/__calls?reset=1`).then((r) => r.json())
const flows = []
async function flow(name, fn) {
  await reset()
  const extra = await fn()
  const c = await reset()
  const top = Object.entries(c.kvByKey || {}).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} ${(v / 1024).toFixed(1)}KB`)
  flows.push({ name, commands: c.kvCommands || 0, inKB: +((c.kvBytesIn || 0) / 1024).toFixed(1), outKB: +((c.kvBytesOut || 0) / 1024).toFixed(1), airtable: c.airtable || 0, ...(extra || {}), top })
}

const fam = client(), lee = client(), pub = client()
await pub('/api/jfp-access', { password: 'term4' })
await signIn(fam, 'parent1@example.com', 'parent')
await signIn(lee, 'leejones@jonerfootball.com', 'staff')
const portal = (call, action, body = {}) => call('/api/jfp-portal-data', { action, ...body })

// The cache warms on the first read in every flow below; the first timetable
// read is measured on its own (an instance's first read).
await flow('timetable: first read', async () => { const r = await pub('/api/jfp-groups'); if (r.status !== 200) throw new Error(JSON.stringify(r.data)) })
await flow('timetable: 20 more reads (45 s polling)', async () => { for (let i = 0; i < 20; i++) await pub('/api/jfp-groups') })
await flow('My account: 5 opens', async () => { for (let i = 0; i < 5; i++) { const r = await fam('/api/jfp-account', { action: 'overview' }); if (r.status !== 200) throw new Error(JSON.stringify(r.data)) } })
await flow('portal badges: one 30 minute check', async () => {
  const lite = await portal(lee, 'requestCount')
  const req = lite.status === 200 ? [] : await Promise.all([portal(lee, 'requests'), portal(lee, 'extraRequests')])
  await Promise.all([portal(lee, 'cancelAlerts'), portal(lee, 'trialCount'), portal(lee, 'accountAlerts'), portal(lee, 'absenceAlerts'), portal(lee, 'extraAsks'), portal(lee, 'staffAlerts')])
  return { requestCheck: lite.status === 200 ? 'requestCount' : `requests + extraRequests (${req.length})` }
})
await flow('coach cron: 3 ticks', async () => { for (let i = 0; i < 3; i++) await fetch(`${B}/api/jfp-groups?coachTick=1`, { headers: { authorization: 'Bearer local-cron-secret' } }) })
const size = async (k) => { const v = await kv(['GET', k]); return v && v !== 'null' ? Buffer.byteLength(v) : 0 }
console.log(JSON.stringify({ rosterCacheBytes: { plain: await size('jfp:roster-cache'), compressed: await size('jfp:roster-cache:z') }, flows }, null, 1))
process.exit(0)
