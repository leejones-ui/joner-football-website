// Sign-in for everyone who uses JFP: parents, coaches, Lee and Ligia.
//
// Nobody has a password. You type your email, we send a six digit code, you
// type the code. That proves you own the inbox, which is the one thing every
// role needs. What you can see is decided on the server on every request:
//
//   admin   email is in config.superAdmins (Lee and Ligia): everything
//   coach   email matches a coach in config and coach logins are switched on
//   parent  anyone else: only the players whose Airtable rows carry that email
//
// Removing someone from the config takes their access away at once, because
// the role is never stored in the session.
import crypto from 'node:crypto'
import { kvCommand, clean, validEmail, coachLabel } from './_jfp-store.js'

export const PARENT_COOKIE = '__Host-jfp_parent'
export const STAFF_COOKIE = '__Host-jfp_staff'
const SESSION_SECONDS = { parent: 30 * 86400, staff: 12 * 3600 }
const CODE_SECONDS = 10 * 60
const MAX_TRIES = 5

export const digest = (v) => crypto.createHash('sha256').update(String(v)).digest('hex')
const challengeKey = (id) => `jfp:signin:challenge:${digest(id)}`
const sessionKey = (token) => `jfp:signin:session:${digest(token)}`
const limitKey = (scope) => `jfp:signin:limit:${digest(scope)}`

export function roleFor(email, config) {
  const e = validEmail(email)
  if (!e) return null
  if (config.superAdmins.includes(e)) return { role: 'admin', email: e }
  const coach = config.coaches.find((c) => c.email && c.email === e)
  if (coach && config.coachLoginsEnabled) return { role: 'coach', email: e, coachId: coach.id }
  return null
}

// Counts attempts in a window shared by every function instance. Storage
// errors fail closed: no code is sent if the counter cannot be read.
async function underLimit(scope, limit, windowSeconds) {
  const n = Number(await kvCommand(['EVAL', "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n", '1', limitKey(scope), String(windowSeconds)]))
  return n <= limit
}

// Returns { challenge, code } to email, or { limited: true }.
export async function startChallenge({ email, audience, ip }) {
  const e = validEmail(email)
  if (!e) return { error: 'Enter a valid email address.' }
  if (!['parent', 'staff'].includes(audience)) return { error: 'Invalid request.' }
  // Per email and connection, so someone elsewhere cannot lock Lee out;
  // plus a wider per-email cap so nobody can flood an inbox with codes.
  if (!(await underLimit(`email-ip:${e}:${ip}`, 5, 900)) || !(await underLimit(`email:${e}`, 25, 900)) || !(await underLimit(`ip:${ip}`, 20, 900))) return { limited: true }
  const challenge = crypto.randomBytes(24).toString('hex')
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
  await kvCommand(['SET', challengeKey(challenge), JSON.stringify({ email: e, audience, code: digest(`${challenge}:${code}`), tries: 0 }), 'EX', String(CODE_SECONDS)])
  return { challenge, code, email: e }
}

// Check, count and consume in one atomic step, so a flood of parallel
// guesses still gets only MAX_TRIES in total and a right code works once.
export const VERIFY_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return false end
local c = cjson.decode(raw)
if c.tries >= tonumber(ARGV[2]) then redis.call('DEL', KEYS[1]) return false end
if c.code ~= ARGV[1] then
  c.tries = c.tries + 1
  redis.call('SET', KEYS[1], cjson.encode(c), 'KEEPTTL')
  return false
end
redis.call('DEL', KEYS[1])
return raw`

export async function verifyChallenge(challenge, code, ip = 'unknown') {
  if (!/^[a-f0-9]{48}$/.test(challenge || '') || !/^\d{6}$/.test(code || '')) return null
  if (!(await underLimit(`verify-ip:${ip}`, 40, 900))) return { limited: true }
  const raw = await kvCommand(['EVAL', VERIFY_SCRIPT, '1', challengeKey(challenge), digest(`${challenge}:${code}`), String(MAX_TRIES)])
  if (!raw) return null
  const c = JSON.parse(raw)
  return { email: c.email, audience: c.audience }
}

export async function openSession(email, audience) {
  const token = crypto.randomBytes(32).toString('hex')
  const seconds = SESSION_SECONDS[audience]
  await kvCommand(['SET', sessionKey(token), JSON.stringify({ email, audience, expiresAt: Date.now() + seconds * 1000 }), 'EX', String(seconds)])
  return { token, seconds }
}

export function cookieHeader(audience, token, maxAge) {
  const name = audience === 'staff' ? STAFF_COOKIE : PARENT_COOKIE
  // Parents come back from Stripe on a top-level navigation, so Lax.
  const same = audience === 'staff' ? 'Strict' : 'Lax'
  return `${name}=${token}; Path=/; HttpOnly; Secure; SameSite=${same}; Max-Age=${maxAge}`
}

function cookieValue(req, name) {
  return String(req.headers?.cookie || '').split(';').map((s) => s.trim()).find((s) => s.startsWith(`${name}=`))?.slice(name.length + 1) || ''
}

export async function sessionFor(req, audience) {
  const token = cookieValue(req, audience === 'staff' ? STAFF_COOKIE : PARENT_COOKIE)
  if (!/^[a-f0-9]{64}$/.test(token)) return null
  const raw = await kvCommand(['GET', sessionKey(token)])
  if (!raw) return null
  const s = JSON.parse(raw)
  if (s.audience !== audience || s.expiresAt <= Date.now()) return null
  return { email: s.email, token }
}

export async function closeSession(req, audience) {
  const token = cookieValue(req, audience === 'staff' ? STAFF_COOKIE : PARENT_COOKIE)
  if (/^[a-f0-9]{64}$/.test(token)) await kvCommand(['DEL', sessionKey(token)])
}

// Signed-in staff member with their current role, or null.
export async function staffPrincipal(req, config) {
  const s = await sessionFor(req, 'staff')
  if (!s) return null
  const r = roleFor(s.email, config)
  return r ? { ...r, name: nameFor(r, config) } : null
}

function nameFor(r, config) {
  if (r.role === 'coach') return `Coach ${coachLabel(config.coaches.find((c) => c.id === r.coachId))}`.trim()
  if (r.email.startsWith('leejones@')) return 'Lee'
  if (r.email.startsWith('ligia@')) return 'Ligia'
  return clean(r.email.split('@')[0], 40)
}

// Requests that change anything must come from our own pages.
export function sameOrigin(req) {
  const expected = process.env.JFP_PORTAL_ORIGIN
  if (!expected) return false
  try { return new URL(req.headers?.origin).origin === new URL(expected).origin } catch { return false }
}

export function clientIp(req) {
  return String(req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim()
}
