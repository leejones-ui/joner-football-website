// Email-code sign-in for JFP. One endpoint, two audiences:
//   parent  the booking page and the family account page
//   staff   the JFP portal (Lee and Ligia, and coaches once switched on)
//
//   POST { action: 'start', email, audience }      -> emails a 6 digit code
//   POST { action: 'verify', challenge, code }      -> sets the session cookie
//   POST { action: 'logout', audience }
//   GET  ?audience=parent|staff                     -> who is signed in
import { verifyRecaptcha } from './_security.js'
import { getConfig } from './_jfp-store.js'
import { startChallenge, verifyChallenge, openSession, cookieHeader, sessionFor, closeSession, roleFor, sameOrigin, clientIp, staffPrincipal } from './_jfp-people.js'
import { sendSignInCode } from './_jfp-email.js'

function parse(req) { return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}) }
function fail(res, status, error, extra = {}) { return res.status(status).json({ success: false, error, ...extra }) }
const audienceOf = (v) => (v === 'staff' ? 'staff' : 'parent')

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  try {
    const config = await getConfig()
    if (req.method === 'GET') {
      const audience = audienceOf(req.query?.audience)
      if (audience === 'staff') {
        const p = await staffPrincipal(req, config)
        return res.status(200).json({ success: true, user: p ? { name: p.name, role: p.role, coachId: p.coachId || '', email: p.email } : null })
      }
      const s = await sessionFor(req, 'parent')
      return res.status(200).json({ success: true, user: s ? { email: s.email } : null })
    }
    if (req.method !== 'POST') return fail(res, 405, 'Method not allowed')
    if (!sameOrigin(req)) return fail(res, 403, 'Invalid request origin')
    let body
    try { body = parse(req) } catch { return fail(res, 400, 'Invalid request') }

    if (body.action === 'logout') {
      const audience = audienceOf(body.audience)
      await closeSession(req, audience)
      res.setHeader('Set-Cookie', cookieHeader(audience, '', 0))
      return res.status(200).json({ success: true })
    }

    if (body.action === 'start') {
      const audience = audienceOf(body.audience)
      const rc = await verifyRecaptcha(req, body.recaptchaToken)
      if (!rc.ok) return fail(res, 400, rc.error)
      const email = String(body.email || '').trim().toLowerCase()
      // Staff: only emails with a role get a code. Everyone gets the same
      // answer, so the form never reveals who has access.
      const allowed = audience === 'parent' || Boolean(roleFor(email, config))
      const generic = { success: true, sent: true, hint: email.replace(/^(.).*(@.*)$/, '$1***$2') }
      const ch = await startChallenge({ email, audience, ip: clientIp(req) })
      if (ch.error) return fail(res, 400, ch.error)
      if (ch.limited) return fail(res, 429, 'Too many codes asked for. Wait 15 minutes and try again.')
      // Take about as long as a real send, so timing does not reveal who has access.
      if (!allowed) { await new Promise((r) => setTimeout(r, 250 + Math.floor(Math.random() * 400))); return res.status(200).json({ ...generic, challenge: ch.challenge }) }
      await sendSignInCode({ email: ch.email, code: ch.code, audience })
      return res.status(200).json({ ...generic, challenge: ch.challenge })
    }

    if (body.action === 'verify') {
      const v = await verifyChallenge(String(body.challenge || ''), String(body.code || '').trim(), clientIp(req))
      if (v?.limited) return fail(res, 429, 'Too many tries. Wait 15 minutes and try again.')
      if (!v) return fail(res, 401, 'That code is not right or has expired. Ask for a new one.')
      if (v.audience === 'staff' && !roleFor(v.email, config)) return fail(res, 401, 'That code is not right or has expired. Ask for a new one.')
      const { token, seconds } = await openSession(v.email, v.audience)
      res.setHeader('Set-Cookie', cookieHeader(v.audience, token, seconds))
      const role = v.audience === 'staff' ? roleFor(v.email, config) : null
      return res.status(200).json({ success: true, audience: v.audience, email: v.email, role: role?.role || 'parent' })
    }

    return fail(res, 400, 'Unknown action')
  } catch (error) {
    console.error('jfp-auth failed', error)
    return fail(res, 503, 'Sign-in is briefly unavailable. Try again in a minute.')
  }
}
