// The account guide to everyone (Lee, 16 Oct 2026), in Messages: prepare
// drafts an email and a text per family (api/_jfp-guide.js picks who, and
// _jfp-email.js accountGuide writes it); Lee sees the samples and the counts;
// only Lee sends, in batches of 15, emails and texts separately. At send each
// one is written again from the records as they are then, with the same
// approved template, so a to-do or an amount is never out of date. Do Not
// Contact and "Texts: no" are checked at prepare and again at send.
import { siteUrl } from './_holiday-store.js'
import { audit, clean, ownerEmail } from './_jfp-store.js'
import { loadRoster } from './_jfp-airtable.js'
import { accountGuide, accountGuideText } from './_jfp-email.js'
import { GUIDE, GUIDE_GROUPS, guideAudience, guidePhoneRaw } from './_jfp-guide.js'
import { newMsg, saveMsg, listMsgs, event, claim, payloadHash, familyPhone, maskPhone, sha, doNotContact, getPrefs, setPref, routeStatus, sendEmailExact, TEXT_EXPIRES_HOURS } from './_jfp-messages.js'

export const GUIDE_ACTIONS = new Set(['guide', 'prepareGuide', 'sendGuide', 'cancelGuide'])
const BATCH = 15
const LIVE = (m) => !['cancelled', 'failed', 'expired'].includes(m.status)
const isOwner = (p) => p.email === ownerEmail()
const fail = (res, status, error, extra = {}) => res.status(status).json({ success: false, error, ...extra })

function phoneFor(r, roster, profiles) {
  if (r.rowIds.length) return familyPhone(roster.players.filter((x) => r.rowIds.includes(x.id)))
  return familyPhone([{ phone: guidePhoneRaw(r, profiles) }])
}
const familyOf = (r) => ({ email: r.email, parent: r.parent, players: r.players.map((x) => ({ name: x.name, rowId: x.rowId || '' })), kind: GUIDE, owingCents: r.owingCents })

function summary(msgs) {
  const mine = msgs.filter((m) => m.campaign === GUIDE)
  const count = (ch, st) => mine.filter((m) => m.channel === ch && st.includes(m.status)).length
  const by = (ch) => Object.fromEntries(GUIDE_GROUPS.map((g) => [g, mine.filter((m) => m.channel === ch && m.status === 'draft' && m.guideGroup === g).length]))
  return {
    email: { draft: count('email', ['draft']), sent: count('email', ['sent', 'delivered']), problem: count('email', ['failed', 'unknown']), byGroup: by('email') },
    text: { draft: count('text', ['draft']), queued: count('text', ['queued', 'claimed']), sent: count('text', ['sent', 'delivered']), problem: count('text', ['failed', 'unknown', 'expired']), byGroup: by('text') },
  }
}

export async function guideAction(req, res, principal, config, body, action) {
  if (action === 'guide') {
    const msgs = await listMsgs(3000)
    const mine = msgs.filter((m) => m.campaign === GUIDE)
    // One sample of each kind, so Lee sees exactly what each group gets.
    const samples = GUIDE_GROUPS.map((g) => {
      const e = mine.find((m) => m.channel === 'email' && m.guideGroup === g && m.status === 'draft')
      const t = mine.find((m) => m.channel === 'text' && m.guideGroup === g && m.status === 'draft')
      return e || t ? { group: g, to: e?.parentName || e?.email || '', subject: e?.content.subject || '', html: e?.content.html || '', text: t?.content.text || '' } : null
    }).filter(Boolean)
    return res.status(200).json({ success: true, ...summary(msgs), samples, route: await routeStatus(), isOwner: isOwner(principal), lastPrepare: mine.find((m) => m.prepareNote)?.prepareNote || null })
  }

  if (action === 'prepareGuide') {
    const groups = (Array.isArray(body.groups) ? body.groups : GUIDE_GROUPS).filter((g) => GUIDE_GROUPS.includes(g))
    if (!groups.length) return fail(res, 400, 'Choose who gets it.')
    let dnc
    try { dnc = await doNotContact() } catch { return fail(res, 503, 'Could not check Do Not Contact in Airtable. Try again in a minute.') }
    const [aud, msgs, roster, prefs, route] = await Promise.all([guideAudience(req, config, { groups }), listMsgs(3000), loadRoster({ fresh: true }), getPrefs(), routeStatus()])
    // A fresh prepare replaces the drafts; anything already sent stays sent.
    for (const m of msgs.filter((x) => x.campaign === GUIDE && x.status === 'draft')) { m.status = 'cancelled'; event(m, principal.email, 'replaced by a new prepare'); await saveMsg(m) }
    const signInUrl = `${siteUrl(req)}/jfp-account/`
    const out = { emails: 0, texts: 0, already: [], dnc: [], noPhone: [], noTexts: [], noEmail: aud.noEmail.map((x) => x.parent || x.name), byGroup: Object.fromEntries(groups.map((g) => [g, 0])) }
    const sentBefore = (email, ch) => msgs.some((m) => m.campaign === GUIDE && m.email === email && m.channel === ch && m.status !== 'draft' && LIVE(m))
    for (const r of aud.list) {
      const ph = phoneFor(r, roster, aud.profiles)
      const label = r.parent || r.email
      if (dnc.has(r.email, ph.phone)) { out.dnc.push(label); continue }
      out.byGroup[r.group]++
      const tag = (m) => { m.rowIds = m.rowIds.filter(Boolean); m.campaign = GUIDE; m.guideGroup = r.group; m.requestId = r.requestId || ''; m.accountEmail = r.accountEmail || ''; m.payloadHash = payloadHash(m); return m }
      if (sentBefore(r.email, 'email')) out.already.push(label)
      else { await saveMsg(tag(newMsg({ channel: 'email', family: familyOf(r), content: accountGuide(r, { config, signInUrl }), target: { ref: r.email, hash: sha(r.email) }, by: principal.email }))); out.emails++ }
      if (sentBefore(r.email, 'text')) continue
      if (!ph.phone) { out.noPhone.push(`${label}: ${ph.problem || 'no mobile'}`); continue }
      if (prefs[r.email]?.text === 'no') { out.noTexts.push(label); continue }
      const text = accountGuideText(r, { sender: route.senderName || 'Lee' })
      await saveMsg(tag(newMsg({ channel: 'text', family: familyOf(r), content: { text }, target: { ref: maskPhone(ph.phone), hash: sha(ph.phone) }, route: { id: 'mac', label: route.label || 'Messages on the HQ Mac' }, by: principal.email })))
      out.texts++
    }
    await audit({ by: principal.email, action: 'message.guide.prepare', target: GUIDE, after: { groups, emails: out.emails, texts: out.texts, dnc: out.dnc.length } })
    return res.status(200).json({ success: true, ...out })
  }

  if (action === 'cancelGuide') {
    const channel = body.channel === 'text' ? 'text' : body.channel === 'email' ? 'email' : ''
    let n = 0
    for (const m of (await listMsgs(3000)).filter((x) => x.campaign === GUIDE && x.status === 'draft' && (!channel || x.channel === channel))) { m.status = 'cancelled'; event(m, principal.email, 'cancelled: account guide drafts cleared'); await saveMsg(m); n++ }
    await audit({ by: principal.email, action: 'message.guide.cancel', target: GUIDE, after: { channel, n } })
    return res.status(200).json({ success: true, cancelled: n })
  }

  // sendGuide: Lee only, one batch per press.
  if (!isOwner(principal)) return fail(res, 403, 'Only Lee sends the account guide to everyone.')
  const channel = body.channel === 'text' ? 'text' : body.channel === 'email' ? 'email' : ''
  if (!channel) return fail(res, 400, 'Email or text?')
  if (body.confirm !== true) return fail(res, 400, 'Confirm the send.')
  const route = await routeStatus()
  const basis = clean(body.basis, 200)
  if (channel === 'text') {
    if (!route.verified) return fail(res, 409, 'The text route is not verified yet. Send yourself the test text first.', { code: 'route' })
    if (basis.length < 3) return fail(res, 400, 'Say why these families can be texted.')
  }
  let dnc
  try { dnc = await doNotContact() } catch { return fail(res, 503, 'Could not check Do Not Contact in Airtable. Try again in a minute.') }
  const todo = (await listMsgs(3000)).filter((m) => m.campaign === GUIDE && m.channel === channel && m.status === 'draft').slice(0, BATCH)
  const done = { sent: 0, queued: 0, skipped: [], problem: 0 }
  if (todo.length) {
    const [aud, roster, prefs] = await Promise.all([guideAudience(req, config), loadRoster({ fresh: true }), getPrefs()])
    const signInUrl = `${siteUrl(req)}/jfp-account/`
    const skip = async (m, why) => { m.status = 'cancelled'; event(m, principal.email, `cancelled at send: ${why}`); await saveMsg(m); done.skipped.push(`${m.parentName || m.email}: ${why}`) }
    for (const m of todo) {
      const r = aud.list.find((x) => x.email === m.email)
      if (!r) { await skip(m, 'no longer on the list'); continue }
      const ph = phoneFor(r, roster, aud.profiles)
      if (dnc.has(m.email, channel === 'text' ? ph.phone : '')) { await skip(m, 'Do Not Contact'); continue }
      if (channel === 'email') {
        if (!(await claim(m.id, 120))) continue
        // The same template, from the records as they are now.
        m.content = { ...accountGuide(r, { config, signInUrl }), text: '' }
        m.status = 'sending'; m.approvedBy = principal.email; m.approvedAt = new Date().toISOString()
        event(m, principal.email, 'approved with the account guide to everyone, sending')
        await saveMsg(m)
        try {
          const out = await sendEmailExact({ to: m.email, name: r.self ? r.players[0]?.name : r.parent, subject: m.content.subject, html: m.content.html, kind: 'account guide' })
          m.status = 'sent'; m.receipt = { provider: 'brevo', messageId: out.messageId || '', at: new Date().toISOString() }
          event(m, 'brevo', 'accepted by Brevo', { messageId: out.messageId || '' })
          done.sent++
        } catch (error) {
          m.status = error.definite ? 'failed' : 'unknown'; done.problem++
          event(m, 'brevo', error.definite ? 'Brevo refused it: not sent' : 'no clear answer from Brevo: check Brevo before sending again', { error: String(error.message).slice(0, 200) })
        }
        await saveMsg(m)
        continue
      }
      if (!ph.phone || sha(ph.phone) !== m.target.hash) { await skip(m, 'the mobile changed'); continue }
      if (prefs[m.email]?.text === 'no') { await skip(m, 'Texts: no'); continue }
      // Lee's reason for texting, kept on the family as their Texts: yes (as a Send from a player's page does).
      if (prefs[m.email]?.text !== 'yes') await setPref(m.email, { text: 'yes', how: `Account guide text, Lee: ${basis}`, by: principal.email, at: new Date().toISOString() })
      m.content = { text: accountGuideText(r, { sender: route.senderName || 'Lee' }) }
      m.status = 'queued'; m.approvedBy = principal.email; m.approvedAt = new Date().toISOString()
      m.expiresAt = new Date(Date.now() + TEXT_EXPIRES_HOURS * 3600000).toISOString()
      m.route = { ...(m.route || {}), label: route.label || m.route?.label, sender: route.sender || '' }
      event(m, principal.email, 'approved with the account guide to everyone: waiting for the Mac', { basis })
      await saveMsg(m)
      done.queued++
    }
  }
  const left = (await listMsgs(3000)).filter((m) => m.campaign === GUIDE && m.channel === channel && m.status === 'draft').length
  await audit({ by: principal.email, action: `message.guide.${channel}`, target: GUIDE, after: { sent: done.sent, queued: done.queued, skipped: done.skipped.length, problem: done.problem } })
  return res.status(200).json({ success: true, ...done, left })
}
