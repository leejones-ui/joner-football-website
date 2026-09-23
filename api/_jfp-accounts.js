// Staff accounts for the JFP portal, separate from the Joner Dashboard.
//
// Nobody's password is ever set by anyone else or passes through email or
// chat. An owner creates an invite; the invitee gets a one-time link, valid
// for 48 hours, and chooses their own password. Lee and Ligia (finance roles)
// also get a six digit code by email every time they sign in.
import crypto from 'node:crypto'
import { kvCommand } from './_holiday-store.js'
import { createAuthStore, passwordHash, digest, normaliseUsername } from './_jfp-auth.js'

export const ROLES = ['owner', 'finance-admin', 'coach']
const INVITE_SECONDS = 48 * 3600
const CODE_SECONDS = 10 * 60
export const auth = createAuthStore(kvCommand)

const userKey = (email) => `jfp:auth:user:${digest(normaliseUsername(email))}`
const inviteKey = (token) => `jfp:auth:invite:${digest(token)}`
const challengeKey = (id) => `jfp:auth:challenge:${digest(id)}`
const USERS_INDEX = 'jfp:auth:users'

async function getJson(key) { const raw = await kvCommand(['GET', key]); return raw ? JSON.parse(raw) : null }

export async function getUser(email) { return getJson(userKey(email)) }

export async function listUsers() {
  const emails = await kvCommand(['SMEMBERS', USERS_INDEX]) || []
  const users = []
  for (const e of emails) {
    const u = await getUser(e)
    if (u) users.push({ email: e, name: u.name, role: u.role, coachId: u.coachId || '', active: u.active === true, passwordSet: Boolean(u.passwordHash), createdAt: u.createdAt, lastLoginAt: u.lastLoginAt || '' })
  }
  return users.sort((a, b) => ROLES.indexOf(a.role) - ROLES.indexOf(b.role) || a.name.localeCompare(b.name))
}

export function validateInvite({ email, name, role, coachId }) {
  const e = normaliseUsername(email)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return { error: 'Enter a valid email.' }
  if (!name || String(name).trim().length < 2) return { error: 'Enter their name.' }
  if (!ROLES.includes(role)) return { error: 'Choose a role.' }
  if (role === 'coach' && !coachId) return { error: 'Choose which coach this login is for.' }
  return { email: e, name: String(name).trim().slice(0, 60), role, coachId: role === 'coach' ? String(coachId) : '' }
}

// Creates (or refreshes) the account record and a one-time set-up token.
// The token is returned only so the caller can email it; never log it.
export async function createInvite(input, invitedBy) {
  const v = validateInvite(input)
  if (v.error) return v
  const existing = await getUser(v.email)
  const user = {
    id: existing?.id || crypto.randomUUID(),
    name: v.name,
    role: v.role,
    coachId: v.coachId,
    active: existing?.active === true && Boolean(existing?.passwordHash),
    passwordHash: existing?.passwordHash || '',
    sessionVersion: existing?.sessionVersion || 1,
    createdAt: existing?.createdAt || new Date().toISOString(),
    invitedBy: invitedBy || '',
  }
  await kvCommand(['SET', userKey(v.email), JSON.stringify(user)])
  await kvCommand(['SADD', USERS_INDEX, v.email])
  const token = crypto.randomBytes(32).toString('hex')
  await kvCommand(['SET', inviteKey(token), JSON.stringify({ email: v.email }), 'EX', String(INVITE_SECONDS)])
  return { ok: true, email: v.email, name: v.name, role: v.role, token }
}

export async function inviteDetails(token) {
  if (!/^[a-f0-9]{64}$/.test(token || '')) return null
  const inv = await getJson(inviteKey(token))
  if (!inv) return null
  const u = await getUser(inv.email)
  return u ? { email: inv.email, name: u.name, role: u.role } : null
}

// Consumes the invite: GETDEL means a link can never be used twice.
export async function completeSetup(token, password) {
  if (!/^[a-f0-9]{64}$/.test(token || '')) return { error: 'This set-up link is not valid.' }
  let hash
  try { hash = await passwordHash(password) } catch (e) { return { error: e.message } }
  const raw = await kvCommand(['GETDEL', inviteKey(token)])
  if (!raw) return { error: 'This set-up link has expired or was already used. Ask Lee for a new one.' }
  const { email } = JSON.parse(raw)
  const u = await getUser(email)
  if (!u) return { error: 'This account no longer exists.' }
  const next = { ...u, passwordHash: hash, active: true, sessionVersion: (u.sessionVersion || 1) + 1, passwordSetAt: new Date().toISOString() }
  await kvCommand(['SET', userKey(email), JSON.stringify(next)])
  return { ok: true, email, role: u.role }
}

export async function setActive(email, active) {
  const u = await getUser(email)
  if (!u) return null
  // Bumping sessionVersion signs them out everywhere, at once.
  const next = { ...u, active: active && Boolean(u.passwordHash), sessionVersion: (u.sessionVersion || 1) + 1 }
  await kvCommand(['SET', userKey(email), JSON.stringify(next)])
  return next
}

export async function noteLogin(email) {
  const u = await getUser(email)
  if (u) await kvCommand(['SET', userKey(email), JSON.stringify({ ...u, lastLoginAt: new Date().toISOString() })])
}

// ---------- email code for finance roles ----------

export function needsCode(user) { return user.role === 'owner' || user.role === 'finance-admin' }

export async function createChallenge(email) {
  const id = crypto.randomBytes(24).toString('hex')
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
  await kvCommand(['SET', challengeKey(id), JSON.stringify({ email, code: digest(code), tries: 0 }), 'EX', String(CODE_SECONDS)])
  return { id, code }
}

export async function verifyChallenge(id, code) {
  if (!/^[a-f0-9]{48}$/.test(id || '') || !/^\d{6}$/.test(code || '')) return null
  const key = challengeKey(id)
  const c = await getJson(key)
  if (!c) return null
  if (c.tries >= 5) { await kvCommand(['DEL', key]); return null }
  const ok = crypto.timingSafeEqual(Buffer.from(c.code), Buffer.from(digest(code)))
  if (!ok) { await kvCommand(['SET', key, JSON.stringify({ ...c, tries: c.tries + 1 }), 'KEEPTTL']); return null }
  await kvCommand(['DEL', key])
  return c.email
}
