// Sign-up person check (27 Oct 2026): Google accepts each reCAPTCHA token once,
// so a brand-new email must be checked once only. Checking it twice blocked
// every new account with "We could not check that you are a person".
// Starts its own harness with a fake Google that enforces the once-only rule,
// with the strict sign-up check on (JFP_SIGNUP_STRICT=true), then a second
// harness with it off (the default while the site keys are broken).
//   node scripts/test-jfp-signup-human.mjs
import assert from 'node:assert/strict'
import net from 'node:net'
import fs from 'node:fs'
import os from 'node:os'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const port = await new Promise((resolve) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => resolve(p)) }) })
const B = `http://localhost:${port}`
// Started through a link with another name: some sessions run `pkill -f holiday-local.mjs`.
const link = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jfp-human-')), 'harness-signup.mjs')
fs.symlinkSync(path.join(HERE, 'holiday-local.mjs'), link)
const harness = spawn(process.execPath, [link], {
  env: { PATH: process.env.PATH, HOME: process.env.HOME, HOLIDAY_LOCAL_PORT: String(port), JFP_FAKE_RECAPTCHA: '1', JFP_SIGNUP_STRICT: 'true' },
  stdio: ['ignore', 'pipe', 'inherit'],
})
let ready
const up = new Promise((resolve, reject) => { ready = resolve; harness.on('exit', (c) => reject(new Error(`harness exited ${c}`))) })
harness.stdout.on('data', (d) => { if (String(d).includes('holiday local harness on')) ready() })
process.on('exit', () => harness.kill())
await up

let n = 1
const start = (email, recaptchaToken) => fetch(`${B}/api/jfp-auth`, { method: 'POST', headers: { 'content-type': 'application/json', origin: B, 'x-forwarded-for': `10.9.0.${n++}` }, body: JSON.stringify({ action: 'start', audience: 'parent', email, recaptchaToken }) }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => ({})) }))

let passed = 0
const test = async (name, fn) => { await fn(); passed += 1; console.log(`ok - ${name}`) }

await test('a brand-new email with a good token gets a code', async () => {
  const r = await start('new.family.one@example.org', 'good-token-1')
  assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.sent, true)
})
await test('a brand-new email with a failed check is still refused', async () => {
  const r = await start('new.family.two@example.org', 'bad-token-2')
  assert.equal(r.status, 400); assert.equal(r.data.code, 'human')
})
await test('a reused token is refused for a new email', async () => {
  const r = await start('new.family.three@example.org', 'good-token-1')
  assert.equal(r.status, 400); assert.equal(r.data.code, 'human')
})
harness.kill()
const port2 = await new Promise((resolve) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => resolve(p)) }) })
const h2 = spawn(process.execPath, [link], { env: { PATH: process.env.PATH, HOME: process.env.HOME, HOLIDAY_LOCAL_PORT: String(port2), JFP_FAKE_RECAPTCHA: '1' }, stdio: ['ignore', 'pipe', 'inherit'] })
process.on('exit', () => h2.kill())
await new Promise((resolve, reject) => { h2.on('exit', (c) => reject(new Error(`harness exited ${c}`))); h2.stdout.on('data', (d) => { if (String(d).includes('holiday local harness on')) resolve() }) })
const start2 = (email, recaptchaToken) => fetch(`http://localhost:${port2}/api/jfp-auth`, { method: 'POST', headers: { 'content-type': 'application/json', origin: `http://localhost:${port2}`, 'x-forwarded-for': `10.9.1.${n++}` }, body: JSON.stringify({ action: 'start', audience: 'parent', email, recaptchaToken }) }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => ({})) }))
await test('strict off (default): a new family gets a code even when Google rejects the token', async () => {
  const r = await start2('new.family.four@example.org', 'bad-token-4')
  assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.sent, true)
})
await test('strict off: a throwaway inbox is still refused', async () => {
  const r = await start2('someone@mailinator.com', 'good-token-5')
  assert.equal(r.status, 400); assert.equal(r.data.code, 'throwaway')
})
console.log(`${passed} passed`)
process.exit(0)
