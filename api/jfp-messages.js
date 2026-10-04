// Portal Messages (Lee and Ligia only): prepare an email and a text for a
// family, approve each exact message, and see what happened to it.
// See api/_jfp-messages.js for the rules. Every change is in the audit log.
import { siteUrl } from './_holiday-store.js'
import { getConfig, listPayreqs, getPayreq, savePayreq, getGroup, audit, clean, validEmail, ownerEmail, kvCommand } from './_jfp-store.js'
import { loadRoster, getTerm4Row } from './_jfp-airtable.js'
import { staffPrincipal, sameOrigin } from './_jfp-people.js'
import { accountInvite } from './_jfp-email.js'
import { familyPlan, createPayreq, payreqUrl } from './jfp-portal-data.js'
import {
  newMsg, getMsg, saveMsg, listMsgs, event, isFinal, claim, payloadHash, evidenceOf, familyPhone, maskPhone, normalisePhone, sha,
  textFor, doNotContact, getPrefs, setPref, relayStatus, routeStatus, saveRoute, sendEmailExact, keys, STATUS_LABELS, TEXT_HOURS, TEXT_EXPIRES_HOURS,
} from './_jfp-messages.js'

function parse(req) { return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}) }
function fail(res, status, error, extra = {}) { return res.status(status).json({ success: false, error, ...extra }) }
const isOwner = (p) => p.email === ownerEmail()

// The family as the records stand right now: the plan entry, its Term 4
// rows, its open pay link and the evidence hash for all of it.
export async function familyNow(req, config, email) {
  const plan = await familyPlan(req, config)
  const fam = plan.list.find((f) => f.email === email)
  if (!fam) return { fam: null }
  const roster = await loadRoster()
  const rows = roster.players.filter((r) => fam.players.some((p) => p.rowId === r.id))
  const payreqs = await listPayreqs()
  const payreq = payreqs.find((q) => ['open', 'checkout'].includes(q.status) && q.term4Ids.some((id) => fam.owingRowIds.includes(id))) || null
  return { fam, rows, payreq, evidence: evidenceOf(rows, payreq) }
}

// Before anything is sent: is this still exactly what the records say?
export async function stillValid(req, config, m) {
  if (m.selfTest) return { ok: true }
  const now = await familyNow(req, config, m.email)
  if (!now.fam) return { ok: false, why: 'The family no longer holds a Term 4 place.' }
  if (now.fam.kind !== m.kind) return { ok: false, why: `The family is now "${now.fam.kind}" in the records, not "${m.kind}".` }
  if (m.payreqId) {
    const q = await getPayreq(m.payreqId)
    if (!q || !['open', 'checkout'].includes(q.status)) return { ok: false, why: `The pay link is ${q ? q.status : 'gone'}.` }
  }
  if (now.evidence.hash !== m.evidence?.hash) return { ok: false, why: 'The payment records for this family changed since it was prepared.' }
  return { ok: true, now }
}

function view(m) {
  const { content, ...rest } = m
  return { ...rest, statusLabel: STATUS_LABELS[m.status] || m.status, subject: content.subject || '', text: content.text || '', html: m.channel === 'email' ? content.html : '' }
}

async function overview(req, config) {
  const [plan, msgs, prefs, relay, route, roster] = await Promise.all([familyPlan(req, config), listMsgs(), getPrefs(), relayStatus(), routeStatus(), loadRoster()])
  let dnc = null, dncError = ''
  try { dnc = await doNotContact() } catch (error) { console.error('jfp messages dnc failed', error); dncError = 'Could not read Do Not Contact from Airtable, so nothing can be approved right now.' }
  const invitedRaw = (await kvCommand(['HGETALL', 'jfp:acct-invited'])) || []
  const invited = {}
  for (let i = 0; i + 1 < invitedRaw.length; i += 2) invited[invitedRaw[i]] = invitedRaw[i + 1]
  const families = plan.list.map((f) => {
    const rows = roster.players.filter((r) => f.players.some((p) => p.rowId === r.id))
    const ph = familyPhone(rows)
    const mine = msgs.filter((m) => m.email === f.email)
    const last = (ch) => { const m = mine.find((x) => x.channel === ch); return m ? { id: m.id, status: m.status, statusLabel: STATUS_LABELS[m.status], at: m.events.at(-1)?.at } : null }
    return {
      email: f.email, parent: f.parent, players: f.players, kind: f.kind, owingCents: f.owingCents, openLink: f.openLink, needsWaiver: f.needsWaiver,
      invitedAt: invited[f.email] || f.invitedAt || '', phone: maskPhone(ph.phone), phoneProblem: ph.problem,
      pref: prefs[f.email] || null, dnc: dnc ? dnc.has(f.email, ph.phone) : null,
      lastEmail: last('email'), lastText: last('text'),
    }
  })
  return {
    success: true, families, noEmail: plan.noEmail, dncError,
    messages: msgs.slice(0, 200).map((m) => { const v = view(m); delete v.html; return v }),
    relay, route: { ...route, sender: route.sender || '' }, textHours: TEXT_HOURS, textExpiresHours: TEXT_EXPIRES_HOURS,
  }
}

// Draft an email and (when allowed) a text for one family. A pay link is only
// created when staff ask for it (createLink), for the amount on the records.
async function prepare(req, res, principal, config, body) {
  const email = validEmail(body.email)
  if (!email) return fail(res, 400, 'Choose a family.')
  let now = await familyNow(req, config, email)
  if (!now.fam) return fail(res, 404, 'That family does not hold a Term 4 place.')
  // No fee on the records is unknown, not zero: price it first.
  if (now.fam.kind === 'noPrice') return fail(res, 409, 'This family has no fee set in Airtable yet. Set the fee first, then prepare their messages.', { code: 'noPrice' })
  let { fam, payreq } = now
  if (fam.kind === 'pay' && !payreq) {
    if (body.createLink !== true) return res.status(200).json({ success: true, needsLink: true, family: fam, evidence: now.evidence })
    const rowsFull = []
    for (const id of fam.owingRowIds) { const r = await getTerm4Row(id); if (r) rowsFull.push(r) }
    const group = rowsFull[0]?.groupId ? await getGroup(rowsFull[0].groupId) : null
    payreq = await createPayreq({ req, principal, config, group, rows: rowsFull.map((r) => ({ id: r.id, name: r.player })), email, parentName: fam.parent, amountCents: fam.owingCents, reason: 'balance', afterpay: true })
    await audit({ by: principal.email, action: 'message.link', target: payreq.id, after: { email, amountCents: fam.owingCents } })
    now = await familyNow(req, config, email)
    fam = now.fam
  }
  const signInUrl = `${siteUrl(req)}/jfp-account/`
  const payUrl = fam.kind === 'pay' && payreq ? payreqUrl(req, payreq) : ''
  // Any older draft for this family is replaced by these two.
  for (const old of (await listMsgs()).filter((m) => m.email === email && m.status === 'draft')) { old.status = 'cancelled'; event(old, principal.email, 'replaced by a new draft'); await saveMsg(old) }
  const by = principal.email
  const mail = accountInvite({ parentName: fam.parent, players: fam.players, config, signInUrl, payUrl, amountCents: fam.owingCents, needsWaiver: fam.needsWaiver })
  const emailMsg = await saveMsg(newMsg({ channel: 'email', family: fam, payreq, evidence: now.evidence, by, content: { ...mail, payUrl }, target: { ref: email, hash: sha(email) } }))
  const ph = familyPhone(now.rows)
  const route = await routeStatus()
  let textMsg = null
  if (ph.phone) {
    const text = textFor({ parentName: fam.parent, players: fam.players, kind: fam.kind, amountCents: fam.owingCents, payUrl, signInUrl, config, sender: route.senderName || 'Lee' })
    textMsg = await saveMsg(newMsg({ channel: 'text', family: fam, payreq, evidence: now.evidence, by, content: { text, payUrl }, target: { ref: maskPhone(ph.phone), hash: sha(ph.phone) }, route: { id: 'mac', label: route.label || 'Messages on the HQ Mac', sender: route.sender || '' } }))
  }
  await audit({ by, action: 'message.prepare', target: email, after: { email: emailMsg.id, text: textMsg?.id || '' } })
  return res.status(200).json({ success: true, family: fam, evidence: now.evidence, email: view(emailMsg), text: textMsg ? view(textMsg) : null, phoneProblem: ph.problem })
}

async function editText(res, principal, body) {
  const m = await getMsg(body.id)
  if (!m || m.channel !== 'text') return fail(res, 404, 'Text not found.')
  if (m.status !== 'draft') return fail(res, 409, 'Only a draft can be edited. Approved texts are frozen.')
  const text = String(body.text || '').replace(/\r/g, '').trim().slice(0, 640)
  if (text.length < 10) return fail(res, 400, 'The text is too short.')
  if (m.payUrl && !text.includes(m.payUrl)) return fail(res, 400, 'Keep the pay link in the text, exactly as it is.')
  m.content.text = text
  m.payloadHash = payloadHash(m)
  event(m, principal.email, 'edited the text')
  await saveMsg(m)
  return res.status(200).json({ success: true, message: view(m) })
}

// Approve exactly what was shown (payloadHash from the screen must match).
async function approve(req, res, principal, config, body) {
  const m = await getMsg(body.id)
  if (!m) return fail(res, 404, 'Message not found.')
  if (m.status !== 'draft') return fail(res, 409, `This message is already ${STATUS_LABELS[m.status] || m.status}.`)
  if (body.payloadHash !== m.payloadHash || payloadHash(m) !== m.payloadHash) return fail(res, 409, 'The message changed since you looked at it. Open it again.', { code: 'changed' })
  const prefs = await getPrefs()
  let dnc
  try { dnc = await doNotContact() } catch { return fail(res, 503, 'Could not check Do Not Contact in Airtable. Try again in a minute.') }
  const check = await stillValid(req, config, m)
  if (!check.ok) { m.status = 'cancelled'; event(m, principal.email, 'cancelled at approval', { why: check.why }); await saveMsg(m); return fail(res, 409, `${check.why} Prepare it again.`, { code: 'stale' }) }

  if (m.channel === 'email') {
    if (dnc.has(m.email, '')) return fail(res, 409, 'This family is marked Do Not Contact in the Master Database.')
    // Already emailed (account invite or this pay link)? Only Lee can send again.
    const invitedAt = await kvCommand(['HGET', 'jfp:acct-invited', m.email])
    const q = m.payreqId ? await getPayreq(m.payreqId) : null
    const sentBefore = (await listMsgs()).some((x) => x.id !== m.id && x.email === m.email && x.channel === 'email' && ['sent', 'delivered', 'unknown', 'sending'].includes(x.status))
    if ((invitedAt || q?.emailedAt || sentBefore) && !(body.replace === true && isOwner(principal))) {
      return fail(res, 409, isOwner(principal) ? 'This family has been emailed before. Tick "Send again" to send another.' : 'This family has been emailed before. Only Lee can send another.', { code: 'emailed_before', invitedAt: invitedAt || q?.emailedAt || '' })
    }
    if (!(await claim(m.id, 120))) return fail(res, 409, 'This email is already being sent.')
    m.status = 'sending'; m.approvedBy = principal.email; m.approvedAt = new Date().toISOString(); m.leaseUntil = new Date(Date.now() + 120000).toISOString()
    event(m, principal.email, 'approved and sending', body.replace === true ? { replace: true } : {})
    await saveMsg(m)
    try {
      const r = await sendEmailExact({ to: m.email, name: m.parentName, subject: m.content.subject, html: m.content.html })
      m.status = 'sent'; m.receipt = { provider: 'brevo', messageId: r.messageId || '', at: new Date().toISOString() }
      event(m, 'brevo', 'accepted by Brevo', { messageId: r.messageId || '' })
      await kvCommand(['HSET', 'jfp:acct-invited', m.email, m.receipt.at])
      if (q && !q.emailedAt) await savePayreq({ ...q, emailedAt: m.receipt.at })
    } catch (error) {
      console.error('jfp message email failed', m.id, error.message)
      m.status = error.definite ? 'failed' : 'unknown'
      event(m, 'brevo', error.definite ? 'Brevo refused it: not sent' : 'no clear answer from Brevo: check Brevo before sending again', { error: String(error.message).slice(0, 200) })
    }
    m.leaseUntil = ''
    await saveMsg(m)
    await audit({ by: principal.email, action: `message.email.${m.status}`, target: m.id, after: { email: m.email, messageId: m.receipt?.messageId || '' } })
    return res.status(200).json({ success: m.status === 'sent', message: view(m), error: m.status === 'sent' ? undefined : (m.status === 'failed' ? 'Brevo refused the email. Nothing was sent.' : 'Brevo did not answer clearly. It is marked "Check it": look in Brevo before sending again.') })
  }

  // A text: checked here, then queued for the Mac.
  const route = await routeStatus()
  if (!route.verified && !m.selfTest) return fail(res, 409, 'The text route is not verified yet. Lee sends a test text to himself first.', { code: 'route' })
  const pref = prefs[m.email]
  if (!m.selfTest && pref?.text !== 'yes') return fail(res, 409, 'Texts need this family\'s OK first. Set "Texts: yes" for them, with how they agreed.', { code: 'consent' })
  const roster = await loadRoster({ fresh: true })
  const ph = familyPhone(roster.players.filter((r) => m.rowIds.includes(r.id)))
  if (!m.selfTest && (!ph.phone || sha(ph.phone) !== m.target.hash)) { m.status = 'cancelled'; event(m, principal.email, 'cancelled: the mobile in Airtable changed'); await saveMsg(m); return fail(res, 409, 'The mobile in Airtable changed. Prepare it again.') }
  if (!m.selfTest && dnc.has(m.email, ph.phone)) return fail(res, 409, 'This family is marked Do Not Contact in the Master Database.')
  m.status = 'queued'; m.approvedBy = principal.email; m.approvedAt = new Date().toISOString()
  m.expiresAt = new Date(Date.now() + TEXT_EXPIRES_HOURS * 3600000).toISOString()
  // Ligia approving sends from the route's number, shown on screen: both recorded.
  m.route = { ...(m.route || {}), label: route.label || m.route?.label, sender: route.sender || '' }
  event(m, principal.email, 'approved: waiting for the Mac', { displayedSender: route.sender || '' })
  await saveMsg(m)
  await audit({ by: principal.email, action: 'message.text.queued', target: m.id, after: { email: m.email, route: m.route?.sender || '' } })
  return res.status(200).json({ success: true, message: view(m) })
}

async function cancel(res, principal, body) {
  const m = await getMsg(body.id)
  if (!m) return fail(res, 404, 'Message not found.')
  if (!['draft', 'queued'].includes(m.status)) return fail(res, 409, `A message that is ${STATUS_LABELS[m.status] || m.status} cannot be cancelled.`)
  // Lock it against the Mac claiming it at the same moment.
  if (m.status === 'queued' && !(await claim(m.id))) return fail(res, 409, 'The Mac has just picked this text up. Wait a minute and look again.')
  m.status = 'cancelled'
  event(m, principal.email, 'cancelled')
  await saveMsg(m)
  await audit({ by: principal.email, action: 'message.cancel', target: m.id })
  return res.status(200).json({ success: true, message: view(m) })
}

// "Check it": a person looked at Brevo or the phone and says what happened.
// Never sends anything.
async function reconcile(res, principal, body) {
  const m = await getMsg(body.id)
  if (!m || m.status !== 'unknown') return fail(res, 409, 'Only a message marked "Check it" can be settled.')
  const outcome = body.outcome === 'delivered' ? 'delivered' : body.outcome === 'not_sent' ? 'failed' : ''
  if (!outcome) return fail(res, 400, 'Choose: it went, or it did not go.')
  const note = clean(body.note, 300)
  if (note.length < 3) return fail(res, 400, 'Say where you checked (for example: in Messages on the Mac).')
  m.status = outcome
  event(m, principal.email, outcome === 'delivered' ? 'checked by hand: it went' : 'checked by hand: it did not go', { note })
  await saveMsg(m)
  if (outcome === 'delivered' && m.channel === 'email') await kvCommand(['HSET', 'jfp:acct-invited', m.email, new Date().toISOString()])
  await audit({ by: principal.email, action: 'message.reconcile', target: m.id, after: { outcome, note } })
  return res.status(200).json({ success: true, message: view(m) })
}

async function savePref(res, principal, body) {
  const email = validEmail(body.email)
  if (!email) return fail(res, 400, 'Choose a family.')
  const text = ['yes', 'no'].includes(body.text) ? body.text : ''
  if (!text) return fail(res, 400, 'Texts: yes or no.')
  const how = clean(body.how, 200)
  if (text === 'yes' && how.length < 3) return fail(res, 400, 'Say how the family agreed to texts (for example: asked us to text them).')
  await setPref(email, { text, how, whatsapp: body.whatsapp === true, by: principal.email, at: new Date().toISOString() })
  // Texts: no stops anything waiting for this family.
  let stopped = 0
  if (text === 'no') {
    for (const m of (await listMsgs()).filter((x) => x.email === email && x.channel === 'text' && ['draft', 'queued'].includes(x.status))) {
      if (m.status === 'queued' && !(await claim(m.id))) continue
      m.status = 'cancelled'; event(m, principal.email, 'cancelled: family does not want texts'); await saveMsg(m); stopped++
    }
  }
  await audit({ by: principal.email, action: 'message.pref', target: email, after: { text, how } })
  return res.status(200).json({ success: true, stopped })
}

// Lee's own test: a text to his own mobile, through the same queue and Mac.
async function selfTest(req, res, principal, config, body) {
  if (!isOwner(principal)) return fail(res, 403, 'Only Lee runs the test text.')
  const phone = normalisePhone(body.phone)
  if (!phone) return fail(res, 400, 'Enter your own Australian mobile.')
  const text = `JFP portal test text ${new Date().toLocaleString('en-AU', { timeZone: 'Australia/Sydney' })}. If you got this, the text route works.`
  const m = newMsg({ channel: 'text', family: null, content: { text }, target: { ref: maskPhone(phone), hash: sha(phone) }, by: principal.email, selfTest: true, route: { id: 'mac', label: 'Messages on the HQ Mac' } })
  m.selfPhone = phone // only for Lee's own test, never a family's number
  m.status = 'queued'; m.approvedBy = principal.email; m.approvedAt = m.createdAt
  m.expiresAt = new Date(Date.now() + TEXT_EXPIRES_HOURS * 3600000).toISOString()
  event(m, principal.email, 'test text approved')
  await saveMsg(m)
  await audit({ by: principal.email, action: 'message.selftest', target: m.id })
  return res.status(200).json({ success: true, message: view(m) })
}

// After the test text arrived on Lee's phone: the route is verified with the
// sender Messages actually used (read back from Messages by the Mac).
async function verifyRoute(res, principal, body) {
  if (!isOwner(principal)) return fail(res, 403, 'Only Lee verifies the text route.')
  const m = await getMsg(body.id)
  if (!m?.selfTest || m.status !== 'sent' || !m.receipt?.readback?.found) return fail(res, 409, 'Verify after a test text shows as Sent, read back from Messages.')
  if (body.arrived !== true) return fail(res, 400, 'Confirm the test text arrived on your phone.')
  const label = clean(body.label, 60) || 'Lee (Messages on the HQ Mac)'
  const route = { verified: true, verifiedAt: new Date().toISOString(), verifiedBy: principal.email, testMsgId: m.id, sender: m.receipt.sender || '', service: m.receipt.service || '', label, senderName: clean(body.senderName, 30) || 'Lee' }
  await saveRoute(route)
  await audit({ by: principal.email, action: 'message.route.verify', target: m.id, after: { sender: route.sender, service: route.service } })
  return res.status(200).json({ success: true, route })
}

async function unverifyRoute(res, principal) {
  if (!isOwner(principal)) return fail(res, 403, 'Only Lee changes the text route.')
  await saveRoute({ verified: false, by: principal.email, at: new Date().toISOString() })
  await audit({ by: principal.email, action: 'message.route.off', target: 'route' })
  return res.status(200).json({ success: true })
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  if (process.env.JFP_PORTAL_ENABLED !== 'true') return fail(res, 503, 'The JFP portal is not open yet.')
  if (req.method !== 'POST') return fail(res, 405, 'Method not allowed')
  if (!sameOrigin(req)) return fail(res, 403, 'Invalid request origin')
  let body
  try { body = parse(req) } catch { return fail(res, 400, 'Invalid request') }
  try {
    const config = await getConfig()
    const principal = await staffPrincipal(req, config)
    if (!principal) return fail(res, 401, 'Please sign in.')
    if (principal.role !== 'admin') return fail(res, 403, 'Only Lee or Ligia send messages to families.')
    const action = clean(body.action, 30)
    if (action === 'overview') return res.status(200).json({ ...(await overview(req, config)), isOwner: isOwner(principal), me: principal.email })
    if (action === 'prepare') return await prepare(req, res, principal, config, body)
    if (action === 'get') { const m = await getMsg(body.id); return m ? res.status(200).json({ success: true, message: view(m) }) : fail(res, 404, 'Message not found.') }
    if (action === 'editText') return await editText(res, principal, body)
    if (action === 'approve') return await approve(req, res, principal, config, body)
    if (action === 'cancel') return await cancel(res, principal, body)
    if (action === 'reconcile') return await reconcile(res, principal, body)
    if (action === 'setPref') return await savePref(res, principal, body)
    if (action === 'selfTest') return await selfTest(req, res, principal, config, body)
    if (action === 'verifyRoute') return await verifyRoute(res, principal, body)
    if (action === 'unverifyRoute') return await unverifyRoute(res, principal)
    return fail(res, 400, 'Unknown action')
  } catch (error) {
    console.error('jfp-messages failed', error)
    return fail(res, 500, 'Something went wrong. Nothing was sent. Try again in a minute.')
  }
}

export { isFinal, keys }
