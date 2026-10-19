// Lee's 20 Oct 2026: any coach adds an outside link (Instagram, TikTok, YouTube)
// to the Session ideas library under a group; Who handles what has Lee running JFP.
// Starts its own copy of the local harness (fake Airtable, fake Brevo, in
// memory KV) on a free port, so nothing real is emailed or written.
//   npx astro build && node scripts/test-jfp-idea-links.mjs
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

const lee = client(), sam = client(), ruby = client(), fam = client()
await signIn(lee, 'leejones@jonerfootball.com', 'staff')
await signIn(sam, 'jonerfootballsam@gmail.com', 'staff')
await signIn(ruby, 'jonerfootballruby@gmail.com', 'staff')
let samLink

await test('a coach adds an Instagram link under Passing; every coach and Lee see it with the coach name', async () => {
  const r = await ok(sam, 'ideasLinkAdd', { url: 'https://www.instagram.com/reel/ABC123/', title: 'Rondo 4v1', topic: 'pass', note: 'Tight spaces' })
  samLink = r.link
  assert.equal(r.link.topic, 'pass')
  const seen = (await ok(ruby, 'ideasLinks')).links.find((l) => l.id === samLink.id)
  assert.ok(seen, 'Ruby sees it'); assert.equal(seen.title, 'Rondo 4v1'); assert.ok(seen.by); assert.equal(seen.canRemove, false); assert.equal(seen.byEmail, undefined)
  assert.equal((await ok(lee, 'ideasLinks')).links.find((l) => l.id === samLink.id).canRemove, true)
  assert.equal((await ok(sam, 'ideasLinks')).links.find((l) => l.id === samLink.id).mine, true)
})

await test('bad links, no group, and the same link twice are refused', async () => {
  assert.equal((await portal(sam, 'ideasLinkAdd', { url: 'http://insecure.example.com/x', title: 'Drill', topic: 'pass' })).status, 400)
  assert.equal((await portal(sam, 'ideasLinkAdd', { url: 'javascript:alert(1)', title: 'Drill', topic: 'pass' })).status, 400)
  assert.equal((await portal(sam, 'ideasLinkAdd', { url: 'https://youtu.be/xyz', title: 'Drill', topic: 'nope' })).status, 400)
  assert.equal((await portal(ruby, 'ideasLinkAdd', { url: 'https://www.instagram.com/reel/ABC123/', title: 'Again', topic: 'pass' })).status, 409)
})

await test('only the coach who added it, Lee or Ligia can remove it; a family cannot read the library', async () => {
  assert.equal((await portal(ruby, 'ideasLinkDelete', { id: samLink.id })).status, 403)
  const r2 = await ok(ruby, 'ideasLinkAdd', { url: 'https://www.tiktok.com/@x/video/1', title: 'Fast feet ladder', topic: 'speed' })
  await ok(lee, 'ideasLinkDelete', { id: r2.link.id })
  await ok(sam, 'ideasLinkDelete', { id: samLink.id })
  assert.equal((await ok(lee, 'ideasLinks')).links.length, 0)
  assert.notEqual((await portal(fam, 'ideasLinks')).status, 200)
})

await test('the portal script has the Add a link button and Who handles what has Lee and Ligia, not Dean', async () => {
  const fs = await import('node:fs')
  const ideas = fs.readFileSync(path.join(HERE, '../src/scripts/jfp-portal-ideas.js'), 'utf8')
  assert.match(ideas, /Add a link/); assert.match(ideas, /ideasLinkAdd/)
  const portalJs = fs.readFileSync(path.join(HERE, '../src/scripts/jfp-portal.js'), 'utf8')
  const help = portalJs.slice(portalJs.indexOf('function renderHelp'), portalJs.indexOf('function renderHelp') + 3000)
  assert.doesNotMatch(help, /Dean/)
  assert.match(help, /anything about joining', 'Lee and Ligia'/)
  assert.match(help, /upset', 'Ligia'/)
  assert.match(help, /'Lee or the senior coach'/)
})

console.log(`${passed} passed`)
process.exit(0)
