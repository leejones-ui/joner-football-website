// Joners Juniors emails (stage 2): the account invite, reminders, next term
// re-enrolment, the payment receipt and the staff alerts. Built here and
// shown to staff as a preview first; nothing goes to a family until a staff
// member presses Send (the invites in _jj-invites.js). The receipt follows
// a payment the family made themselves.
//
// The same light card as the JFP emails, with a Joners Juniors heading.
// Replies go to the Juniors inbox.
import { formatAud, dateLabel } from './_jfp-store.js'
import { classLabelOf, datesLabelOf, juniorsDates, termShort, nextTermOf } from './_jj-config.js'

export const JJ_INBOX = 'jonersjuniors@jonerfootball.com'

export function esc(v) {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}
function shell({ preheader = '', heading, body }) {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head>
<body style="margin:0;padding:0;background:#F4F5F7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827;">
<span style="display:none;max-height:0;overflow:hidden;">${esc(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F5F7;"><tr><td align="center" style="padding:28px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;">
<tr><td style="padding:0 6px 14px;font-size:13px;font-weight:700;letter-spacing:.4px;color:#6B7280;">JONERS JUNIORS · JONER FOOTBALL</td></tr>
<tr><td style="background:#FFFFFF;border:1px solid #E5E7EB;border-radius:16px;padding:30px 26px;">
<h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;font-weight:800;color:#111827;">${esc(heading)}</h1>
${body}
</td></tr>
<tr><td style="padding:16px 6px;font-size:12px;line-height:1.6;color:#6B7280;">Joner Football, 20 Narabang Way (Unit 2), Belrose NSW 2085. Reply to this email with any questions.</td></tr>
</table></td></tr></table></body></html>`
}
const p = (html) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#374151;">${html}</p>`
function rows(list) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 18px;border-top:1px solid #F0F1F3;">${list.map(([k, v]) => `<tr>
<td style="padding:10px 0;border-bottom:1px solid #F0F1F3;color:#6B7280;font-size:13px;width:34%;vertical-align:top;">${esc(k)}</td>
<td style="padding:10px 0;border-bottom:1px solid #F0F1F3;color:#111827;font-size:15px;font-weight:600;vertical-align:top;">${v}</td></tr>`).join('')}</table>`
}
const button = (label, href) => `<p style="margin:20px 0 8px;"><a href="${esc(href)}" style="background:#111827;color:#FFFFFF;text-decoration:none;font-weight:700;font-size:15px;padding:14px 22px;border-radius:10px;display:inline-block;">${esc(label)}</a></p>`
const first = (name) => String(name || '').trim().split(/\s+/)[0] || ''
const andList = (names) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0] || '')
const howToSignIn = (email) => p(`<b>How to sign in:</b> press the button, enter <b>${esc(email || 'the email this message came to')}</b>, and we email you a 6 digit code. Type it in. There is no password. It is the same account as JFP, so a brother or sister in JFP is there too.`)

async function send({ to, name, subject, html, replyTo = JJ_INBOX }) {
  const apiKey = process.env.BREVO_API_KEY
  if (!apiKey) throw new Error('BREVO_API_KEY is not configured.')
  const sender = process.env.BREVO_SENDER_EMAIL || 'leejones@jonerfootball.com'
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', 'api-key': apiKey },
    body: JSON.stringify({ sender: { name: 'Joner Football', email: sender }, to: (Array.isArray(to) ? to : [to]).map((e) => (typeof e === 'string' ? { email: e, ...(name ? { name } : {}) } : e)), replyTo: { email: replyTo, name: 'Joners Juniors' }, subject, htmlContent: html }),
  })
  if (!res.ok) throw new Error(`Brevo ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return true
}

// The class line every family email shows.
function classRows(jj, { term = jj.term, dates = datesLabelOf(jj) } = {}) {
  const cls = jj.classes[0]
  return [['Class', esc(classLabelOf(jj, cls))], ['Where', esc(jj.location)], ['Term', `${esc(term)}${dates ? `<br><span style="color:#6B7280;font-weight:400;font-size:13px;">${esc(dates)}</span>` : ''}`]]
}

// kind 'new': sign in, sign the waiver, pay the term. The first email a
// family gets about their account.
export function jjAccountInvite({ parentName, children, jj, signInUrl, payUrl = '', amountCents = 0, needsWaiver = false, email = '' }) {
  const names = children.map((c) => first(c.name))
  const owing = Boolean(payUrl) && amountCents > 0
  const first1 = juniorsDates(jj)[0]
  const body = `${p(`Hi ${esc(first(parentName) || 'there')},`)}
${p(`${esc(andList(names))}'s Joners Juniors place for ${esc(termShort(jj.term))} is in your Joner Football account. Sign in with this email to see the class, every date and your payments.`)}
${rows([...children.map((c) => [c.name, esc(classLabelOf(jj))]), ...classRows(jj).slice(1), ...(first1 ? [['First class', esc(dateLabel(first1))]] : [])])}
${owing ? p(`There is <b>${esc(formatAud(amountCents))}</b> to pay for ${esc(termShort(jj.term))}. Card, Apple Pay or Google Pay.`) : p('Nothing to pay. The place is confirmed.')}
${needsWaiver ? p('Please also sign the waiver when you sign in. It takes a minute, and one waiver covers JFP and Joners Juniors.') : ''}
${button(owing ? 'Sign in and pay' : 'Sign in to your account', owing ? payUrl : signInUrl)}
${howToSignIn(email)}
${p('See you on Saturday,<br>The Joner Football team')}`
  return { subject: owing ? `Joners Juniors ${termShort(jj.term)}: ${formatAud(amountCents)} to pay` : `Joners Juniors ${termShort(jj.term)}: your account is ready`, html: shell({ preheader: 'Your class, dates and payments in one place', heading: 'Your Joners Juniors account', body }) }
}

// kind 'reminder': what is still owing and/or the waiver.
export function jjReminder({ parentName, children, jj, url, amountCents = 0, needsWaiver = false, email = '' }) {
  const names = children.map((c) => first(c.name))
  const owing = amountCents > 0
  const todo = [owing ? `pay the ${esc(formatAud(amountCents))} still owing` : '', needsWaiver ? 'sign the waiver' : ''].filter(Boolean)
  const body = `${p(`Hi ${esc(first(parentName) || 'there')},`)}
${p(`A quick reminder for ${esc(andList(names))}'s Joners Juniors place: please ${todo.join(' and ')}.`)}
${rows([...children.map((c) => [c.name, owing && c.owingCents ? `${esc(formatAud(c.owingCents))} to pay` : c.needsWaiver ? 'Waiver to sign' : 'Done']), ...classRows(jj)])}
${needsWaiver ? p('One waiver covers JFP and Joners Juniors. It takes a minute.') : ''}
${button(owing ? 'Sign in and pay' : 'Sign in and sign the waiver', url)}
${howToSignIn(email)}
${p('Already paid by cash or bank transfer? Reply to this email and we will update it.')}`
  return { subject: owing ? `Reminder: ${formatAud(amountCents)} to pay for Joners Juniors` : 'Reminder: the Joners Juniors waiver', html: shell({ preheader: owing ? `${formatAud(amountCents)} still to pay` : 'One waiver to sign', heading: 'A quick reminder', body }) }
}

// kind 'next': keep the place for next term (hold or pay in full) or say not returning.
export function jjNextInvite({ parentName, children, jj, url, email = '' }) {
  const nt = nextTermOf(jj)
  const names = children.map((c) => first(c.name))
  const body = `${p(`Hi ${esc(first(parentName) || 'there')},`)}
${p(`${esc(termShort(jj.term))} is going well, and ${esc(nt.name)} places for Joners Juniors go to our current families first. Would ${esc(andList(names))} like to keep ${names.length > 1 ? 'their places' : 'the place'}?`)}
${rows([...children.map((c) => [c.name, esc(classLabelOf(jj))]), ['Next term', `${esc(nt.name)}${nt.termStart ? `<br><span style="color:#6B7280;font-weight:400;font-size:13px;">First class ${esc(dateLabel(nt.termStart))}</span>` : ''}`], ['Term fee', esc(formatAud(nt.fullCents))]])}
${p(`<b>Pay ${esc(formatAud(nt.fullCents))}</b> and the place is locked in.`)}
${nt.holdCents ? p(`Not sure yet? <b>Hold the place for ${esc(formatAud(nt.holdCents))}</b>. It is non-refundable and comes off the term fee.`) : ''}
${p('Not coming back? Tell us in the same place and we will offer the spot to a family on the waitlist.')}
${button('Choose in your account', url)}
${howToSignIn(email)}`
  return { subject: `Keep your Joners Juniors place for ${nt.name}`, html: shell({ preheader: `${nt.name}: current families first`, heading: `${nt.name}: keep your place`, body }) }
}

export async function sendJJFamilyEmail({ to, parentName, built }) {
  return send({ to, name: parentName, subject: built.subject, html: built.html })
}

// After a payment the family made themselves.
export async function sendJJReceipt({ payreq, jj, siteUrl = '' }) {
  const next = payreq.next
  const held = next?.choice === 'hold'
  const paid = payreq.paidCents ?? payreq.amountCents
  const body = `${p(`Thanks ${esc(first(payreq.parentName) || '')}. ${next ? `${esc(andList(payreq.playerNames))}'s Joners Juniors place for ${esc(next.term)} is ${held ? 'held' : 'paid and locked in'}.` : `We have your payment for ${esc(andList(payreq.playerNames))}'s Joners Juniors place.`}`)}
${rows([...(next ? [['Class', esc(classLabelOf(jj))], ['Term', esc(next.term)]] : classRows(jj, { term: payreq.term })), ['Paid', esc(formatAud(paid))], ...(held ? [['Still to pay', `${esc(formatAud(Math.max(0, next.fullCents - paid)))} before ${esc(next.term)} starts`]] : []), ['Reference', esc(payreq.id)]])}
${held ? p('The hold is non-refundable and comes off the term fee. Pay the rest in your account when you are ready.') : ''}
${siteUrl ? button('Open your account', `${siteUrl}/jfp-account/`) : ''}`
  return send({ to: payreq.email, name: payreq.parentName, subject: `Joners Juniors payment received: ${payreq.playerNames.join(' and ')}`, html: shell({ heading: held ? 'Your place is held' : 'Payment received', body }) })
}

// Staff: the Juniors inbox and Lee. Never a family.
export function jjStaffTo() {
  const lee = process.env.JFP_OWNER_EMAIL || 'leejones@jonerfootball.com'
  return [...new Set([JJ_INBOX, lee.toLowerCase()])].map((email) => ({ email }))
}
const ATTENTION = {
  'paid-after-cancel': 'A family paid a Joners Juniors payment that had been cancelled. Nothing was changed in Airtable. Give them the place, or refund in Stripe.',
  'second-payment': 'A family paid the same Joners Juniors payment twice. The first is recorded; this one is not. Refund it in Stripe, or keep it as credit.',
  'no-table': 'A family paid for next term, but there is no Airtable table for that term yet, so the child is not in it. Add the table in Joners Juniors > Settings, then press Try again under Invites > Payments.',
  'row-missing': 'A family paid, but their Joners Juniors row is no longer in Airtable. Look at Invites > Payments in the portal.',
  overpaid: 'A Joners Juniors payment took a child past their fee. Check the child in Players and refund the extra in Stripe.',
}
export async function sendJJStaffAlert({ payreq, reason = '' }) {
  const body = `${reason ? p(esc(ATTENTION[reason] || 'A Joners Juniors payment needs checking.')) : ''}${rows([
    ['Children', esc(payreq.playerNames.join(', '))], ['Parent', esc(payreq.parentName || '')], ['Email', esc(payreq.email)],
    ['For', esc(payreq.next ? `${payreq.next.term} (${payreq.next.choice === 'hold' ? 'hold' : 'full term'})` : payreq.term)],
    ['Paid', esc(formatAud(payreq.paidCents ?? payreq.amountCents))], ['Stripe fee', payreq.stripeFeeCents != null ? esc(formatAud(payreq.stripeFeeCents)) : 'Not known yet'], ['Reference', esc(payreq.id)],
  ])}`
  return send({ to: jjStaffTo(), subject: reason ? `Joners Juniors payment needs checking: ${payreq.id}` : `Joners Juniors payment: ${payreq.playerNames.join(', ')}`, html: shell({ heading: reason ? 'A payment needs checking' : 'Payment received', body }), replyTo: payreq.email })
}

// A website waitlist request: to staff only. The family sees their
// confirmation on the page; nothing is emailed to them.
export async function sendJJRequestAlert({ request }) {
  const body = `${p(`${esc(request.why === 'closed' ? 'Registrations are closed' : 'The class is full')}, so this family joined the Joners Juniors waitlist on the website. Accept, decline or keep them waiting under Joners Juniors > Requests & waitlist.`)}${rows([
    ['Child', esc(request.player.name)], ['Date of birth', esc(request.player.dob || 'Not given')], ['Parent', esc(request.parent.name)], ['Email', esc(request.parent.email)], ['Mobile', esc(request.parent.mobile)], ['Term', esc(request.term)], ['Reference', esc(request.id)],
  ])}`
  return send({ to: jjStaffTo(), subject: `Joners Juniors waitlist: ${request.player.name}`, html: shell({ heading: 'New waitlist request', body }), replyTo: request.parent.email })
}
