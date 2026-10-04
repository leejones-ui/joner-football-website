// The HQ Mac asks here for approved texts and reports what happened. The Mac
// always calls out; nothing here can reach the Mac. Auth is a bearer token
// (JFP_RELAY_TOKEN, Vercel env and a private file on the Mac only). Each text
// is handed out once (a lease); its receipt must come back under that lease.
import crypto from 'node:crypto'
import { getConfig, audit, clean } from './_jfp-store.js'
import { loadRoster } from './_jfp-airtable.js'
import {
  listMsgs, getMsg, saveMsg, event, claim, keys, sha, familyPhone, doNotContact, getPrefs, saveRelay, routeStatus, textHoursOpen, LEASE_SECONDS,
} from './_jfp-messages.js'
import { stillValid } from './jfp-messages.js'
import { kvCommand } from './_holiday-store.js'

function parse(req) { return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}) }
function fail(res, status, error, extra = {}) { return res.status(status).json({ success: false, error, ...extra }) }

function authorised(req) {
  const token = process.env.JFP_RELAY_TOKEN || ''
  const got = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (token.length < 32 || !got) return false
  const a = crypto.createHash('sha256').update(token).digest(), b = crypto.createHash('sha256').update(got).digest()
  return crypto.timingSafeEqual(a, b)
}

async function cancelIt(m, why) { m.status = m.expiresAt && Date.parse(m.expiresAt) < Date.now() ? 'expired' : 'cancelled'; event(m, 'relay', `${m.status} before sending`, { why }); await saveMsg(m) }

// The oldest approved text that is still exactly right, leased to the Mac.
async function claimNext(req, res, body) {
  if (!textHoursOpen()) return res.status(200).json({ success: true, message: null, waiting: 'outside texting hours' })
  const route = await routeStatus()
  const queued = (await listMsgs()).filter((m) => m.channel === 'text' && m.status === 'queued').reverse()
  if (!queued.length) return res.status(200).json({ success: true, message: null })
  const config = await getConfig()
  const [roster, prefs] = await Promise.all([loadRoster({ fresh: true }), getPrefs()])
  let dnc
  try { dnc = await doNotContact() } catch { return res.status(200).json({ success: true, message: null, waiting: 'Do Not Contact could not be checked' }) }
  for (const m of queued) {
    if (m.expiresAt && Date.parse(m.expiresAt) < Date.now()) { await cancelIt(m, 'not sent within the time allowed'); continue }
    if (!m.selfTest && !route.verified) continue
    let to = ''
    if (m.selfTest) to = m.selfPhone || ''
    else {
      const ph = familyPhone(roster.players.filter((r) => m.rowIds.includes(r.id)))
      if (!ph.phone || sha(ph.phone) !== m.target.hash) { await cancelIt(m, 'the mobile in Airtable changed'); continue }
      if (prefs[m.email]?.text !== 'yes') { await cancelIt(m, 'the family no longer has Texts: yes'); continue }
      if (dnc.has(m.email, ph.phone)) { await cancelIt(m, 'marked Do Not Contact'); continue }
      const check = await stillValid(req, config, m)
      if (!check.ok) { await cancelIt(m, check.why); continue }
      to = ph.phone
    }
    if (!to || !(await claim(m.id, LEASE_SECONDS))) continue
    m.status = 'claimed'
    m.claimedAt = new Date().toISOString()
    m.leaseUntil = new Date(Date.now() + LEASE_SECONDS * 1000).toISOString()
    event(m, 'relay', 'picked up by the Mac', { host: clean(body.host, 60) })
    await saveMsg(m)
    return res.status(200).json({ success: true, message: { id: m.id, to, text: m.content.text, textHash: sha(m.content.text), selfTest: Boolean(m.selfTest), expectedSender: route.sender || '' } })
  }
  return res.status(200).json({ success: true, message: null })
}

// What the Mac saw: sent (read back from Messages), failed (definitely not
// sent) or unknown (it may have gone). Final; never sent again from here.
async function receipt(res, body) {
  const m = await getMsg(body.id)
  if (!m || m.status !== 'claimed') return fail(res, 409, 'Not a text the Mac is holding.')
  if (body.textHash !== sha(m.content.text)) return fail(res, 409, 'Receipt is for different text.')
  const outcome = ['sent', 'failed', 'unknown'].includes(body.outcome) ? body.outcome : 'unknown'
  const route = await routeStatus()
  const sender = clean(body.sender, 80)
  // Sent from a different number than the verified one: keep it, but flag it.
  const senderMismatch = outcome === 'sent' && route.verified && route.sender && sender && sender !== route.sender
  m.status = outcome
  m.receipt = {
    at: new Date().toISOString(), outcome, service: clean(body.service, 20), sender, providerId: clean(body.providerId, 80),
    readback: { found: body.readback?.found === true, isFromMe: body.readback?.isFromMe === true, at: clean(body.readback?.at, 40) },
    error: clean(body.error, 300), host: clean(body.host, 60), senderMismatch,
  }
  m.leaseUntil = ''
  event(m, 'relay', outcome === 'sent' ? `sent by ${m.receipt.service || 'Messages'} (read back from Messages)` : outcome === 'failed' ? 'not sent' : 'unclear: check Messages before doing anything', { error: m.receipt.error })
  await saveMsg(m)
  await kvCommand(['DEL', keys.lease(m.id)])
  await audit({ by: 'relay', action: `message.text.${outcome}`, target: m.id, after: { service: m.receipt.service, senderMismatch } })
  return res.status(200).json({ success: true })
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return fail(res, 405, 'Method not allowed')
  if (!process.env.JFP_RELAY_TOKEN) return fail(res, 503, 'The text relay is not switched on.')
  if (!authorised(req)) return fail(res, 401, 'Not authorised.')
  let body
  try { body = parse(req) } catch { return fail(res, 400, 'Invalid request') }
  try {
    const action = clean(body.action, 20)
    if (action === 'hello') {
      await saveRelay({ at: new Date().toISOString(), host: clean(body.host, 60), imsg: clean(body.imsg, 40), ok: body.ok === true, problem: clean(body.problem, 200) })
      return res.status(200).json({ success: true, route: await routeStatus() })
    }
    if (action === 'claim') return await claimNext(req, res, body)
    if (action === 'receipt') return await receipt(res, body)
    return fail(res, 400, 'Unknown action')
  } catch (error) {
    console.error('jfp-messages-relay failed', error)
    return fail(res, 500, 'Relay error')
  }
}
