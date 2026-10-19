// Lee, 19 Oct 2026: the detailed (animated, multi-screen) session planner inside the
// JFP coach portal. Coaches save into the portal and see only their own; Lee and Ligia
// see every coach's and can filter by coach and type. Own harness on a free port:
//   npx astro build && node scripts/test-jfp-detailed-planner.mjs
// Every name here is invented.
import assert from 'node:assert/strict'
import net from 'node:net'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const port = await new Promise((resolve) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => resolve(p)) }) })
const B = `http://localhost:${port}`
const harness = spawn(process.execPath, [path.join(HERE, 'holiday-local.mjs')], {
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
  const ip = `10.8.0.${ipSeq++}`
  async function call(p, body) {
    const res = await fetch(`${B}${p}`, { method: body ? 'POST' : 'GET', redirect: 'manual', headers: { 'content-type': 'application/json', cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '), 'x-forwarded-for': ip, origin: B }, body: body ? JSON.stringify(body) : undefined })
    for (const c of res.headers.getSetCookie?.() || []) { const [kv] = c.split(';'); const i = kv.indexOf('='); const v = kv.slice(i + 1); if (v) jar.set(kv.slice(0, i), v); else jar.delete(kv.slice(0, i)) }
    let data = {}
    try { data = JSON.parse(await res.text()) } catch {}
    return { status: res.status, data }
  }
  return { call }
}

const emails = async () => (await fetch(`${B}/__emails`)).json()
async function signIn(c, email, audience = 'parent') {
  const s = await c.call('/api/jfp-auth', { action: 'start', email, audience })
  assert.equal(s.status, 200, JSON.stringify(s.data))
  const mail = (await emails()).filter((e) => e.to.includes(email) && /sign-in code/.test(e.subject)).at(-1)
  const v = await c.call('/api/jfp-auth', { action: 'verify', challenge: s.data.challenge, code: mail.subject.match(/(\d{6})/)[1] })
  assert.equal(v.status, 200, JSON.stringify(v.data))
}
const portal = (c, action, body = {}) => c.call('/api/jfp-portal-data', { action, ...body })
const acct = (c, action, body = {}) => c.call('/api/jfp-account', { action, ...body })
const ok = async (c, action, body) => { const r = await portal(c, action, body); assert.equal(r.status, 200, `${action}: ${JSON.stringify(r.data)}`); return r.data }
const hadmin = async (action, b = {}) => (await fetch(`${B}/api/holiday-admin`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-holiday-admin-secret': 'admin', origin: B }, body: JSON.stringify({ action, ...b }) })).json()
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)

const lee = client(), sam = client(), ruby = client()
await signIn(lee, 'leejones@jonerfootball.com', 'staff')
await signIn(sam, 'jonerfootballsam@gmail.com', 'staff')
await signIn(ruby, 'jonerfootballruby@gmail.com', 'staff')
const anon = client()

const scene = (n) => ({ id: `scene-${n}`, name: `Scene ${n}`, objects: [{ id: `o${n}`, kind: 'player', x: 300, y: 200, color: '#e8000d', label: 'A' }], drawings: [] })
const detailed = (title, extra = {}) => ({ title, scenes: [scene(1), scene(2)], pitch: 'full', links: [], notesSections: {}, ...extra })

await test('signed-out visitors cannot use the detailed planner storage', async () => {
  for (const a of ['plan2List', 'plan2Save', 'plan2Library']) assert.equal((await portal(anon, a, { plan: detailed('x') })).status, 401)
})

let samId
await test('a coach saves a detailed session and sees it in their own list', async () => {
  const r = await ok(sam, 'plan2Save', { plan: detailed('Rondo ladder') })
  samId = r.id
  assert.match(samId, /^DET-/)
  assert.equal(r.plan.kind, 'detailed'); assert.equal(r.plan.owner, 'jonerfootballsam@gmail.com'); assert.equal(r.plan.scenes, 2)
  const list = (await ok(sam, 'plan2List')).plans
  assert.deepEqual(list.map((p) => p.id), [samId])
  assert.equal(list[0].preview.dots.length, 1)
  const back = await ok(sam, 'plan2Get', { id: samId })
  assert.equal(back.plan.title, 'Rondo ladder'); assert.equal(back.plan.scenes.length, 2)
})

await test('saving again with the same id updates in place, it does not duplicate', async () => {
  const r = await ok(sam, 'plan2Save', { id: samId, plan: detailed('Rondo ladder v2') })
  assert.equal(r.id, samId)
  const list = (await ok(sam, 'plan2List')).plans
  assert.equal(list.length, 1); assert.equal(list[0].title, 'Rondo ladder v2')
})

await test('a second coach cannot see, read, overwrite or delete it', async () => {
  assert.equal((await ok(ruby, 'plan2List')).plans.length, 0)
  assert.equal((await portal(ruby, 'plan2Get', { id: samId })).status, 404)
  assert.equal((await portal(ruby, 'plan2Delete', { id: samId })).status, 404)
  const sneaky = await ok(ruby, 'plan2Save', { id: samId, plan: detailed('Ruby copy attempt') })
  assert.notEqual(sneaky.id, samId)
  assert.equal((await ok(sam, 'plan2Get', { id: samId })).plan.title, 'Rondo ladder v2')
  assert.equal((await ok(ruby, 'plan2List')).plans.length, 1)
})

await test('detailed sessions stay out of the On The Go list', async () => {
  assert.equal((await ok(sam, 'planList')).plans.length, 0)
  await ok(sam, 'planSave', { title: 'Quick pitch page', plan: { template: 'blank.html', x: 1 } })
  assert.equal((await ok(sam, 'planList')).plans.length, 1)
  assert.equal((await ok(sam, 'plan2List')).plans.length, 1)
})

await test('Lee sees every coach, with names for the coach filter, and can open any', async () => {
  const leeId = (await ok(lee, 'plan2Save', { plan: detailed("Lee's finishing circuit") })).id
  const all = (await ok(lee, 'plan2List')).plans
  assert.equal(all.length, 3)
  const owners = new Set(all.map((p) => p.owner))
  assert.deepEqual([...owners].sort(), ['jonerfootballruby@gmail.com', 'jonerfootballsam@gmail.com', 'leejones@jonerfootball.com'])
  assert.ok(all.every((p) => p.ownerName && p.kind === 'detailed'))
  assert.equal((await ok(lee, 'plan2Get', { id: samId })).plan.title, 'Rondo ladder v2')
  assert.equal((await ok(lee, 'plan2List')).plans.filter((p) => p.owner === 'jonerfootballsam@gmail.com').length, 1)
  // Lee's library: coaches can see and copy Lee's sessions, never another coach's
  const lib = (await ok(sam, 'plan2Library')).academy
  assert.deepEqual(lib.map((p) => p.id), [leeId])
  const copy = await ok(ruby, 'plan2Use', { planId: leeId })
  assert.notEqual(copy.id, leeId)
  const mine = (await ok(ruby, 'plan2List')).plans.map((p) => p.title)
  assert.ok(mine.includes("Lee's finishing circuit (copy)"))
  assert.equal((await portal(ruby, 'plan2Use', { planId: samId })).status, 404)
  assert.equal((await ok(sam, 'plan2List')).plans.length, 1)
})

await test('saving and deleting are written to the audit log', async () => {
  const entries = (await ok(lee, 'audit')).entries.map((e) => e.action)
  assert.ok(entries.includes('plan2.save')); assert.ok(entries.includes('plan2.copy'))
})

await test('delete removes it for the coach and for Lee', async () => {
  await ok(sam, 'plan2Delete', { id: samId })
  assert.equal((await ok(sam, 'plan2List')).plans.length, 0)
  assert.ok(!(await ok(lee, 'plan2List')).plans.some((p) => p.id === samId))
  assert.equal((await portal(sam, 'plan2Get', { id: samId })).status, 404)
  assert.ok((await ok(lee, 'audit')).entries.some((e) => e.action === 'plan2.delete'))
})

await test('a session over 2.5 MB is refused with a plain message; a large one under it saves', async () => {
  const big = detailed('Huge', { notesSections: { setup: 'x'.repeat(2_600_000) } })
  const r = await portal(sam, 'plan2Save', { plan: big })
  assert.equal(r.status, 413); assert.match(r.data.error, /too big/)
  const fine = detailed('Large but fine', { notesSections: { setup: 'y'.repeat(1_800_000) } })
  assert.equal((await portal(sam, 'plan2Save', { plan: fine })).status, 200)
  assert.equal((await portal(sam, 'plan2Save', { plan: { title: 'No scenes', scenes: [] } })).status, 400)
})

await test('the built planner page, bundle and artwork are served', async () => {
  const page = await fetch(`${B}/jfp-planner/detailed.html`)
  assert.equal(page.status, 200)
  const html = await page.text()
  assert.match(html, /noindex/); assert.match(html, /detailed\/app\.js\?v=/)
  assert.equal((await fetch(`${B}/jfp-planner/detailed/app.js`)).status, 200)
  assert.equal((await fetch(`${B}/jfp-planner/detailed/art/illustrated-v1/cone.png`)).status, 200)
  assert.equal((await fetch(`${B}/jfp-planner/detailed/art/players-v2/stand.png`)).status, 200)
})

console.log(`${passed} passed`)
process.exit(0)
