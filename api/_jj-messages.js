// Joners Juniors Messages (stage 3): Lee or Ligia write one email to Juniors
// families (a whole class, families who still owe, families with no waiver,
// or one family), see it exactly as each family will get it, then press Send.
// Nothing goes before Send.
//
// Served by api/jfp-messages.js (Lee and Ligia only) and kept in the same
// message store as JFP Messages (jfp:msg:<id>, statuses, the once-only claim,
// Do Not Contact, the Brevo receipt), marked programme 'juniors' so the JFP
// Messages page never lists or sends them.
//
// KV:
//   jj:msg-batches   hash  batchId -> { id, audience, classId, subject, text, signIn, by, byName, at, count, emails }
//   jj:messages      hash  "<batchId>:<email>" -> { at, by, byName, subject, audience, messageId, msgId }
//                          (who was sent what, when and by whom, as jj:invites records invites)
import { kvCommand, audit, clean, validEmail, newId, sydneyToday, dateLabel } from './_jfp-store.js'
import { siteUrl } from './_holiday-store.js'
import { newMsg, saveMsg, getMsg, listMsgs, event, claim, sha, doNotContact, sendEmailExact, payloadHash, STATUS_LABELS } from './_jfp-messages.js'
import { jjOverview } from './_jj-portal.js'
import { readJJTable, tableFor, isEnrolled } from './_jj-data.js'
import { juniorsDates, classById, classLabelFor } from './_jj-config.js'
import { jjMessageEmail, JJ_INBOX } from './_jj-email.js'

export const JJ_MESSAGE_ACTIONS = new Set(['jjMsgOverview', 'jjMsgPrepare', 'jjMsgSend', 'jjMsgCancel'])
export const AUDIENCES = ['class', 'unpaid', 'waiver', 'one']
const BATCHES = 'jj:msg-batches', SENT = 'jj:messages'
const BATCH = 10
const out = (res, data) => res.status(200).json({ success: true, ...data })
const fail = (res, status, error, extra = {}) => res.status(status).json({ success: false, error, ...extra })
const hashOf = (raw) => { const o = {}; for (let i = 0; i + 1 < (raw || []).length; i += 2) { try { o[raw[i]] = JSON.parse(raw[i + 1]) } catch {} } return o }
export const isJJMsg = (m) => m?.programme === 'juniors'

// Families in the current term, grouped by the first parent email (as Invites).
function families(overview) {
  const fams = new Map(), noEmail = []
  for (const p of overview.players.filter((x) => !x.removed)) {
    const email = validEmail(p.emails?.[0] || '')
    if (!email) { noEmail.push(p.name); continue }
    if (!fams.has(email)) fams.set(email, { email, parent: p.parent, children: [] })
    fams.get(email).children.push({ rowId: p.rowId, name: p.name, classId: p.classId || '', pay: p.pay, owingCents: ['unpaid', 'part'].includes(p.pay) ? p.owingCents : 0, waiver: p.waiver.onFile, waiverUnknown: Boolean(p.waiver.unknown) })
  }
  return { list: [...fams.values()].sort((a, b) => String(a.parent).localeCompare(String(b.parent))), noEmail }
}

export function inAudience(f, audience, { classId = '', email = '' } = {}) {
  if (audience === 'one') return f.email === email
  if (audience === 'class') return f.children.some((c) => c.classId === classId)
  if (audience === 'unpaid') return f.children.some((c) => ['unpaid', 'part'].includes(c.pay))
  if (audience === 'waiver') return f.children.some((c) => !c.waiver && !c.waiverUnknown)
  return false
}
const audienceLabel = (jj, a, classId) => ({ class: `Everyone in ${classLabelFor(jj, classById(jj, classId)) || 'the class'}`, unpaid: 'Families who still owe', waiver: 'Families with no waiver', one: 'One family' }[a] || a)

function nextClassFor(jj, f) {
  const cls = classById(jj, f.children[0]?.classId) || jj.classes[0]
  const today = sydneyToday()
  const d = cls ? juniorsDates(jj, cls).find((x) => x >= today) : ''
  return d ? dateLabel(d) : ''
}

async function readBatches() { return hashOf(await kvCommand(['HGETALL', BATCHES])) }
async function readSent() { return hashOf(await kvCommand(['HGETALL', SENT])) }

export async function jjMessagesAction(req, res, principal, config, body, action) {
  const jj = config.juniors
  if (action === 'jjMsgOverview') {
    const [overview, batches, msgs, sentLog] = await Promise.all([jjOverview(config), readBatches(), listMsgs(1000), readSent()])
    const fams = families(overview)
    let dnc = null, dncError = ''
    try { dnc = await doNotContact() } catch (error) { console.error('jj messages dnc failed', error.message); dncError = 'Could not read Do Not Contact from Airtable, so nothing can be sent right now.' }
    const mine = msgs.filter(isJJMsg)
    const lastSent = (email) => Object.values(sentLog).filter((x) => x.email === email).sort((a, b) => String(b.at).localeCompare(String(a.at)))[0] || null
    return out(res, {
      term: jj.term, dncError,
      classes: jj.classes.map((c) => ({ id: c.id, label: classLabelFor(jj, c), families: fams.list.filter((f) => inAudience(f, 'class', { classId: c.id })).length })),
      counts: { unpaid: fams.list.filter((f) => inAudience(f, 'unpaid')).length, waiver: fams.list.filter((f) => inAudience(f, 'waiver')).length, all: fams.list.length },
      families: fams.list.map((f) => ({ ...f, dnc: dnc ? dnc.has(f.email, '') : null, lastSent: lastSent(f.email) })),
      noEmail: fams.noEmail,
      batches: Object.values(batches).sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 30).map((b) => {
        const ms = mine.filter((m) => m.batchId === b.id)
        const n = (st) => ms.filter((m) => st.includes(m.status)).length
        return { ...b, emails: undefined, draft: n(['draft']), sent: n(['sent', 'delivered']), problem: n(['failed', 'unknown']), cancelled: n(['cancelled']), checkIt: ms.filter((m) => m.status === 'unknown').map((m) => ({ id: m.id, email: m.email, parent: m.parentName })) }
      }),
      moneyError: overview.moneyError || '',
    })
  }

  if (action === 'jjMsgPrepare') {
    const audience = AUDIENCES.includes(body.audience) ? body.audience : ''
    if (!audience) return fail(res, 400, 'Choose who gets it.')
    const classId = audience === 'class' ? clean(body.classId, 40) : ''
    if (audience === 'class' && !classById(jj, classId)) return fail(res, 400, 'Choose the class.')
    const email = audience === 'one' ? validEmail(body.email) : ''
    if (audience === 'one' && !email) return fail(res, 400, 'Choose the family.')
    const subject = clean(body.subject, 120)
    const text = String(body.text || '').replace(/\r/g, '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, 3000)
    if (subject.length < 3) return fail(res, 400, 'Write the subject.')
    if (text.length < 10) return fail(res, 400, 'Write the message.')
    const overview = await jjOverview(config, { fresh: true })
    const fams = families(overview).list.filter((f) => inAudience(f, audience, { classId, email }))
    if (!fams.length) return fail(res, 409, 'Nobody is in that group right now.')
    const signIn = body.signIn !== false
    const signInUrl = signIn ? `${siteUrl(req)}/jfp-account/` : ''
    const batchId = newId('JJMSG')
    const by = principal.email
    const kind = `jj-${audience}`
    const made = []
    for (const f of fams) {
      // A class message names only that class's children.
      const children = audience === 'class' ? f.children.filter((c) => c.classId === classId) : f.children
      const built = jjMessageEmail({ parentName: f.parent, children, jj, subject, text, signInUrl, email: f.email, nextDate: nextClassFor(jj, { children }) })
      const m = newMsg({ channel: 'email', family: { email: f.email, parent: f.parent, players: children.map((c) => ({ name: c.name, rowId: c.rowId })), kind }, content: built, target: { ref: f.email, hash: sha(f.email) }, by })
      m.programme = 'juniors'; m.batchId = batchId; m.audience = audience
      m.payloadHash = payloadHash(m)
      await saveMsg(m)
      made.push(m)
    }
    const batch = { id: batchId, audience, classId, label: audienceLabel(jj, audience, classId), subject, text, signIn, by, byName: principal.name, at: new Date().toISOString(), count: made.length, emails: made.map((m) => m.email) }
    await kvCommand(['HSET', BATCHES, batchId, JSON.stringify(batch)])
    await audit({ by, action: 'jj.message.prepare', target: batchId, after: { audience, classId, count: made.length, subject } })
    return out(res, {
      batch: { ...batch, emails: undefined },
      families: made.map((m) => ({ email: m.email, parent: m.parentName, players: m.players })),
      // The exact emails: the first two families (the rest differ only in names and class).
      previews: made.slice(0, 2).map((m) => ({ email: m.email, parent: m.parentName, subject: m.content.subject, html: m.content.html })),
    })
  }

  if (action === 'jjMsgCancel') {
    const id = clean(body.batchId, 60)
    let n = 0
    for (const m of (await listMsgs(1000)).filter((x) => isJJMsg(x) && x.batchId === id && x.status === 'draft')) { m.status = 'cancelled'; event(m, principal.email, 'cancelled before sending'); await saveMsg(m); n += 1 }
    await audit({ by: principal.email, action: 'jj.message.cancel', target: id, after: { cancelled: n } })
    return out(res, { cancelled: n })
  }

  if (action === 'jjMsgSend') {
    const id = clean(body.batchId, 60)
    const batch = (await readBatches())[id]
    if (!batch) return fail(res, 404, 'That message was not found. Prepare it again.')
    if (body.confirm !== true) return fail(res, 400, 'Confirm the send.')
    let dnc
    try { dnc = await doNotContact() } catch { return fail(res, 503, 'Could not check Do Not Contact in Airtable. Nothing was sent. Try again in a minute.') }
    // Still in the class? The rows as Airtable has them now.
    const rows = (await readJJTable(tableFor(config, jj.term), { term: jj.term, fresh: true })).filter(isEnrolled)
    const todo = (await listMsgs(1000)).filter((m) => isJJMsg(m) && m.batchId === id && m.status === 'draft').slice(0, BATCH)
    const done = { sent: [], failed: [], skipped: [] }
    for (const m of todo) {
      const still = m.rowIds.some((rid) => rows.some((r) => r.id === rid && r.emails.includes(m.email)))
      const why = !still ? 'no longer in Joners Juniors' : dnc.has(m.email, '') ? 'Do Not Contact' : payloadHash(m) !== m.payloadHash ? 'the email changed after it was shown' : ''
      if (why) { m.status = 'cancelled'; event(m, principal.email, `cancelled at send: ${why}`); await saveMsg(m); done.skipped.push({ email: m.email, why }); continue }
      if (!(await claim(m.id, 120))) { done.skipped.push({ email: m.email, why: 'already being sent' }); continue }
      m.status = 'sending'; m.approvedBy = principal.email; m.approvedAt = new Date().toISOString(); m.leaseUntil = new Date(Date.now() + 120000).toISOString()
      event(m, principal.email, 'sent with Send')
      await saveMsg(m)
      try {
        const r = await sendEmailExact({ to: m.email, name: m.parentName, subject: m.content.subject, html: m.content.html, replyTo: JJ_INBOX })
        m.status = 'sent'; m.receipt = { provider: 'brevo', messageId: r.messageId || '', at: new Date().toISOString() }
        event(m, 'brevo', 'accepted by Brevo', { messageId: r.messageId || '' })
        await kvCommand(['HSET', SENT, `${id}:${m.email}`, JSON.stringify({ at: m.receipt.at, by: principal.email, byName: principal.name, email: m.email, subject: m.content.subject, audience: batch.audience, classId: batch.classId || '', messageId: r.messageId || '', msgId: m.id })])
        done.sent.push(m.email)
      } catch (error) {
        console.error('jj message email failed', m.id, error.message)
        m.status = error.definite ? 'failed' : 'unknown'
        event(m, 'brevo', error.definite ? 'Brevo refused it: not sent' : 'no clear answer from Brevo: check Brevo before sending again', { error: String(error.message).slice(0, 200) })
        done.failed.push({ email: m.email, error: m.status === 'failed' ? 'Brevo refused it' : 'No clear answer from Brevo: marked Check it' })
      }
      m.leaseUntil = ''
      await saveMsg(m)
    }
    const left = (await listMsgs(1000)).filter((m) => isJJMsg(m) && m.batchId === id && m.status === 'draft').length
    await audit({ by: principal.email, action: 'jj.message.send', target: id, after: { sent: done.sent.length, failed: done.failed.length, skipped: done.skipped.length, left, families: done.sent } })
    return out(res, { ...done, left })
  }
  return fail(res, 400, 'Unknown action')
}

export { STATUS_LABELS, getMsg }
