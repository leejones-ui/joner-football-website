// Staff sign-in for the JFP portal. Separate from the Joner Dashboard.
//
//   login   email + password. Coaches are signed in; Lee and Ligia are sent
//           a six digit code and must enter it (verify) first.
//   verify  challenge + code -> session
//   setup   one-time invite token + chosen password
//   bootstrapOwner  first owner invite, guarded by JFP_BOOTSTRAP_SECRET
import crypto from 'node:crypto'
import { cookieToken, cookieHeader, sameOrigin, normaliseUsername } from './_jfp-auth.js'
import { auth, getUser, needsCode, createChallenge, verifyChallenge, inviteDetails, completeSetup, createInvite, listUsers, noteLogin } from './_jfp-accounts.js'
import { sendLoginCode, sendInvite } from './_jfp-email.js'
import { siteUrl } from './_holiday-store.js'
import { getConfig, listGroups, saveGroup, validateGroup } from './_jfp-store.js'
import { readTerm4WithCoaches, draftGroupsFromRoster, airtableCounts } from './_jfp-airtable.js'

function parse(req) { return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}) }
function ip(req) { return String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim() }
function secretOk(supplied, expected) {
  if (!expected || typeof supplied !== 'string' || supplied.length !== expected.length) return false
  return crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
}

async function startSession(res, req, email, user) {
  await auth.logout(cookieToken(req))
  const token = await auth.openSession(email, user)
  await noteLogin(email)
  res.setHeader('Set-Cookie', cookieHeader(token))
  return res.status(200).json({ ok: true, user: { name: user.name, role: user.role } })
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  if (process.env.JFP_PORTAL_ENABLED !== 'true') return res.status(503).json({ error: 'The JFP portal is not open yet.' })
  try {
    if (req.method === 'GET') {
      const user = await auth.principal(cookieToken(req))
      return user ? res.status(200).json({ user: { name: user.name, role: user.role, coachId: user.coachId || '' } }) : res.status(401).json({ error: 'Please sign in.' })
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
    let body
    try { body = parse(req) } catch { return res.status(400).json({ error: 'Invalid request' }) }

    // Server-to-server: creates the very first owner invite. Never returns the link.
    if (body?.action === 'bootstrapOwner') {
      if (!secretOk(String(req.headers['x-jfp-bootstrap-secret'] || ''), process.env.JFP_BOOTSTRAP_SECRET)) return res.status(403).json({ error: 'Forbidden' })
      if ((await listUsers()).some((u) => u.role === 'owner' && u.passwordSet)) return res.status(409).json({ error: 'An owner already exists. Invite from the portal instead.' })
      const inv = await createInvite({ email: body.email, name: body.name, role: 'owner' }, 'bootstrap')
      if (inv.error) return res.status(400).json({ error: inv.error })
      await sendInvite({ email: inv.email, name: inv.name, role: inv.role, url: `${siteUrl(req)}/jfp-portal/?setup=${inv.token}` })
      return res.status(200).json({ ok: true, email: inv.email })
    }

    // Server-to-server: load groups from the Airtable roster before anyone has
    // a login. Adds missing groups only; returns group settings, no people.
    if (body?.action === 'bootstrapSyncGroups') {
      if (!secretOk(String(req.headers['x-jfp-bootstrap-secret'] || ''), process.env.JFP_BOOTSTRAP_SECRET)) return res.status(403).json({ error: 'Forbidden' })
      const config = await getConfig()
      const roster = await readTerm4WithCoaches()
      const existing = new Set((await listGroups()).map((g) => g.id))
      let added = 0
      for (const d of draftGroupsFromRoster(roster, config)) {
        if (existing.has(d.id)) continue
        const v = validateGroup(d, config)
        if (v.ok) { await saveGroup({ ...v.group, extraCoachIds: d.extraCoachIds, createdFrom: 'airtable' }); added += 1 }
      }
      const { counts } = await airtableCounts({ fresh: true })
      const groups = (await listGroups()).map((g) => ({ id: g.id, day: g.day, time: g.time, location: g.location, coachId: g.coachId, extraCoachIds: g.extraCoachIds, mode: g.mode, capacity: g.capacity, existing: counts[g.id] || 0 }))
      return res.status(200).json({ ok: true, added, groups })
    }

    if (!sameOrigin(req, process.env.JFP_PORTAL_ORIGIN)) return res.status(403).json({ error: 'Invalid request origin' })

    if (body?.logout === true || body?.action === 'logout') {
      await auth.logout(cookieToken(req))
      res.setHeader('Set-Cookie', cookieHeader('', 0))
      return res.status(200).json({ ok: true })
    }

    if (body?.action === 'inviteInfo') {
      const d = await inviteDetails(String(body.token || ''))
      return d ? res.status(200).json({ ok: true, name: d.name, email: d.email }) : res.status(404).json({ error: 'This set-up link has expired or was already used. Ask Lee for a new one.' })
    }

    if (body?.action === 'setup') {
      const r = await completeSetup(String(body.token || ''), String(body.password || ''))
      return r.ok ? res.status(200).json({ ok: true, email: r.email }) : res.status(400).json({ error: r.error })
    }

    if (body?.action === 'verify') {
      const email = await verifyChallenge(String(body.challenge || ''), String(body.code || ''))
      if (!email) return res.status(401).json({ error: 'That code is not right or has expired. Sign in again.' })
      const user = await getUser(email)
      if (!user || user.active !== true) return res.status(401).json({ error: 'This account is not active.' })
      return startSession(res, req, email, user)
    }

    // action 'login' (default)
    const result = await auth.login(body?.username || body?.email, body?.password, ip(req))
    if (!result) return res.status(401).json({ error: 'Email or password is incorrect.' })
    if (needsCode(result.user)) {
      const ch = await createChallenge(result.username)
      await sendLoginCode({ email: result.username, code: ch.code })
      return res.status(200).json({ ok: true, needCode: true, challenge: ch.id, sentTo: result.username.replace(/^(.).*(@.*)$/, '$1***$2') })
    }
    return startSession(res, req, result.username, result.user)
  } catch (error) {
    if (error.message === 'Rate limited') { res.setHeader('Retry-After', '900'); return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' }) }
    console.error('jfp-session failed', error)
    return res.status(503).json({ error: 'Sign-in is temporarily unavailable.' })
  }
}

export { normaliseUsername }
