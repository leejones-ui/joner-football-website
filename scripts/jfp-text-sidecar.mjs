// The HQ Mac's side of portal texts. Asks the website for approved texts,
// sends each one once with imsg (iMessage, or SMS when the family has no
// iMessage), reads it back from Messages, and reports what happened.
//
//   node scripts/jfp-text-sidecar.mjs --check   imsg works, Messages readable, relay reachable
//   node scripts/jfp-text-sidecar.mjs --once    send what is waiting now, then stop
//   node scripts/jfp-text-sidecar.mjs --watch   keep going every minute until stopped (Ctrl+C)
//
// Not a service: nothing starts this on its own. The token lives only in
// ~/jf-work/.jfp-private/relay.env (JFP_RELAY_TOKEN=...), never in git.
// Never retries a send: anything unclear goes back as "unknown" for a person.
import fs from 'node:fs'
import os from 'node:os'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'

const arg = (k, d = '') => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d }
const has = (k) => process.argv.includes(k)
const envFile = arg('--env', `${os.homedir()}/jf-work/.jfp-private/relay.env`)
const fileEnv = {}
if (fs.existsSync(envFile)) for (const l of fs.readFileSync(envFile, 'utf8').split('\n')) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) fileEnv[m[1]] = m[2].trim().replace(/^"|"$/g, '') }
const TOKEN = process.env.JFP_RELAY_TOKEN || fileEnv.JFP_RELAY_TOKEN || ''
const URL_ = arg('--url', process.env.JFP_RELAY_URL || fileEnv.JFP_RELAY_URL || 'https://jonerfootball.com/api/jfp-messages-relay')
const IMSG = arg('--imsg', process.env.JFP_IMSG || '/opt/homebrew/bin/imsg')
const HOST = os.hostname().replace(/\.local$/, '')
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex')
const digits = (s) => String(s || '').replace(/\D/g, '').slice(-9)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log(new Date().toISOString(), ...a) // never logs numbers or message text

async function relay(action, body = {}) {
  const res = await fetch(URL_, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ action, host: HOST, ...body }) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`relay ${action} ${res.status}: ${data.error || ''}`)
  return data
}

function imsg(args, timeoutMs = 60000) {
  const r = spawnSync(IMSG, args, { encoding: 'utf8', timeout: timeoutMs })
  return { code: r.status, out: r.stdout || '', err: r.stderr || '', error: r.error }
}
const jsonLines = (out) => out.split('\n').map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)

function check() {
  const v = imsg(['--version'], 15000)
  if (v.error || v.code !== 0) return { ok: false, problem: `imsg not runnable at ${IMSG}` }
  const chats = imsg(['chats', '--limit', '5', '--json'], 20000)
  if (chats.code !== 0) return { ok: false, imsg: v.out.trim(), problem: 'Cannot read Messages (Full Disk Access for the terminal?)' }
  const ids = [...new Set(jsonLines(chats.out).map((c) => c.account_login).filter(Boolean))]
  return { ok: true, imsg: v.out.trim(), identities: ids }
}

// Find our message in Messages after sending: from me, same text, just now.
async function readBack(to, text, since) {
  for (let i = 0; i < 4; i++) {
    await sleep(i ? 4000 : 2500)
    const chats = jsonLines(imsg(['chats', '--limit', '60', '--json'], 20000).out)
    const chat = chats.find((c) => !c.is_group && [c.identifier, ...(c.participants || [])].some((h) => digits(h) && digits(h) === digits(to)))
    if (!chat) continue
    const msgs = jsonLines(imsg(['history', '--chat-id', String(chat.id), '--limit', '10', '--json'], 20000).out)
    const mine = msgs.find((m) => m.is_from_me && m.text === text && Date.parse(m.created_at) >= since - 10000)
    if (mine) return { found: true, isFromMe: true, at: mine.created_at, service: chat.service || '', sender: mine.destination_caller_id || chat.account_login || '', providerId: mine.guid || '' }
  }
  return { found: false }
}

async function sendOne(job) {
  // The text must be exactly what was approved.
  if (sha(job.text) !== job.textHash) return relay('receipt', { id: job.id, textHash: job.textHash, outcome: 'failed', error: 'text did not match what was approved; not sent' })
  const since = Date.now()
  const r = imsg(['send', '--to', job.to, '--text', job.text, '--service', 'auto', '--json'])
  if (r.error && r.error.code === 'ENOENT') return relay('receipt', { id: job.id, textHash: job.textHash, outcome: 'failed', error: 'imsg not found; not sent' })
  const back = await readBack(job.to, job.text, since)
  let outcome = 'unknown', error = ''
  if (back.found) outcome = 'sent'
  else if (r.code !== 0) error = `imsg exit ${r.code}: ${(r.err || r.out).replace(/\+?\d[\d\s]{7,}/g, '[number]').slice(0, 200)}`
  else error = 'imsg said sent, but it was not found in Messages afterwards'
  log(`text ${job.id}: ${outcome}${back.service ? ` via ${back.service}` : ''}`)
  return relay('receipt', { id: job.id, textHash: job.textHash, outcome, service: back.service || '', sender: back.sender || '', providerId: back.providerId || '', readback: back, error })
}

async function once() {
  const c = check()
  await relay('hello', { imsg: c.imsg || '', ok: c.ok, problem: c.problem || '' })
  if (!c.ok) { log('not ready:', c.problem); return 0 }
  let n = 0
  for (; n < 20; n++) {
    const { message, waiting } = await relay('claim')
    if (!message) { if (waiting) log('waiting:', waiting); break }
    try { await sendOne(message) } catch (error) {
      // We may not know if it went: report unknown, never send again.
      log(`text ${message.id}: error ${error.message}`)
      await relay('receipt', { id: message.id, textHash: message.textHash, outcome: 'unknown', error: String(error.message).slice(0, 200) }).catch(() => {})
    }
  }
  return n
}

if (!TOKEN) { console.error(`No JFP_RELAY_TOKEN (looked in ${envFile}).`); process.exit(1) }
if (has('--check')) {
  const c = check()
  console.log(JSON.stringify({ ...c, identities: (c.identities || []).map((x) => (x.includes('@') ? x.replace(/^(.).*(@.*)$/, '$1***$2') : `•••• ${x.slice(-3)}`)) }))
  try { const h = await relay('hello', { imsg: c.imsg || '', ok: c.ok, problem: c.problem || '' }); console.log('relay ok, route verified:', Boolean(h.route?.verified)) } catch (e) { console.log('relay:', e.message) }
} else if (has('--watch')) {
  log('watching for approved texts (Ctrl+C to stop)')
  for (;;) { try { await once() } catch (e) { log('error', e.message) } await sleep(60000) }
} else {
  log(`sent ${await once()} text(s)`)
}
