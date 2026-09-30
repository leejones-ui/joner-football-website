// JFP emails, sent through Brevo like every other Joner transactional email.
// Clean and light on purpose: white card, dark text, one button.
import { formatAud, dateLabel, sessionDates, coachById, locationFor, to24h } from './_jfp-store.js'

export function esc(v) {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

export function locationLine(config, location) { return locationFor(config, location).address || location }

function shell({ preheader = '', heading, body }) {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head>
<body style="margin:0;padding:0;background:#F4F5F7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827;">
<span style="display:none;max-height:0;overflow:hidden;">${esc(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F5F7;"><tr><td align="center" style="padding:28px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;">
<tr><td style="padding:0 6px 14px;font-size:13px;font-weight:700;letter-spacing:.4px;color:#6B7280;">JONER FOOTBALL PERFORMANCE</td></tr>
<tr><td style="background:#FFFFFF;border:1px solid #E5E7EB;border-radius:16px;padding:30px 26px;">
<h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;font-weight:800;color:#111827;">${esc(heading)}</h1>
${body}
</td></tr>
<tr><td style="padding:16px 6px;font-size:12px;line-height:1.6;color:#6B7280;">Joner Football, 20 Narabang Way (Unit 2), Belrose NSW 2085. Reply to this email with any questions.</td></tr>
</table></td></tr></table></body></html>`
}

function p(html) { return `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#374151;">${html}</p>` }
function rows(list) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 18px;border-top:1px solid #F0F1F3;">${list.map(([k, v]) => `<tr>
<td style="padding:10px 0;border-bottom:1px solid #F0F1F3;color:#6B7280;font-size:13px;width:34%;vertical-align:top;">${esc(k)}</td>
<td style="padding:10px 0;border-bottom:1px solid #F0F1F3;color:#111827;font-size:15px;font-weight:600;vertical-align:top;">${v}</td></tr>`).join('')}</table>`
}
function button(label, href) {
  return `<p style="margin:20px 0 8px;"><a href="${esc(href)}" style="background:#111827;color:#FFFFFF;text-decoration:none;font-weight:700;font-size:15px;padding:14px 22px;border-radius:10px;display:inline-block;">${esc(label)}</a></p>`
}
function link(label, href) { return `<a href="${esc(href)}" style="color:#1D4ED8;text-decoration:underline;">${esc(label)}</a>` }

async function send({ to, subject, html, replyTo, attachment }) {
  const apiKey = process.env.BREVO_API_KEY
  if (!apiKey) throw new Error('BREVO_API_KEY is not configured.')
  const sender = process.env.BREVO_SENDER_EMAIL || 'leejones@jonerfootball.com'
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', 'api-key': apiKey },
    body: JSON.stringify({ sender: { name: 'Joner Football', email: sender }, to, replyTo: { email: replyTo || sender, name: 'Joner Football' }, subject, htmlContent: html, ...(attachment ? { attachment } : {}) }),
  })
  if (!res.ok) throw new Error(`Brevo ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return true
}

export function staffTo(config) {
  const lee = process.env.JFP_OWNER_EMAIL || process.env.CAMP_SIGNUP_EMAIL || 'leejones@jonerfootball.com'
  return [...new Set([lee, ...(config.staffEmails || [])].map((e) => e.toLowerCase()))].map((email) => ({ email }))
}

// ---------- calendar ----------

export function buildIcs({ uid, group, config, title, fromIso = '', only = '' }) {
  const dates = only ? [only] : sessionDates(config, group.day).filter((d) => !fromIso || d >= fromIso)
  if (!dates.length) return ''
  const [hh, mm] = (to24h(group.time) || '16:00').split(':').map(Number)
  const end = hh * 60 + mm + (group.durationMin || 60)
  const pad = (n) => String(n).padStart(2, '0')
  const day = (iso) => iso.replace(/-/g, '')
  const loc = locationLine(config, group.location).replace(/([,;])/g, '\\$1')
  // One event per real session, so a skipped week (public holiday) is not in
  // the family's calendar.
  const stamp = `${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Joner Football//JFP//EN', 'CALSCALE:GREGORIAN',
    ...dates.flatMap((d, i) => [
      'BEGIN:VEVENT',
      `UID:${uid}-${i + 1}@jonerfootball.com`,
      `DTSTAMP:${stamp}`,
      `DTSTART;TZID=Australia/Sydney:${day(d)}T${pad(hh)}${pad(mm)}00`,
      `DTEND;TZID=Australia/Sydney:${day(d)}T${pad(Math.floor(end / 60))}${pad(end % 60)}00`,
      `SUMMARY:${title.replace(/([,;])/g, '\\$1')}`,
      `LOCATION:${loc}`,
      'END:VEVENT',
    ]),
    'END:VCALENDAR',
  ]
  return lines.join('\r\n')
}

function groupRows(config, group, fromIso = '') {
  const loc = locationFor(config, group.location)
  const coach = coachById(config, group.coachId)
  const dates = sessionDates(config, group.day).filter((d) => !fromIso || d >= fromIso)
  return [
    ['Group', `${esc(group.day)} ${esc(group.time)}`],
    ['Where', `${esc(loc.address || group.location)}${loc.maps ? `<br>${link('Open in Maps', loc.maps)}` : ''}`],
    ['Coach', coach ? `Coach ${esc(coach.name)}` : 'Joner Football coach'],
    ...(dates.length ? [['Dates', `${esc(dates.length)} ${dates.length === 1 ? 'session' : 'sessions'}, ${esc(dateLabel(dates[0]))} to ${esc(dateLabel(dates.at(-1)))}<br><span style="color:#6B7280;font-weight:400;font-size:13px;">${esc(dates.map(dateLabel).join(', '))}</span>`]] : []),
  ]
}

// ---------- sign in ----------

export async function sendSignInCode({ email, code, audience }) {
  const who = audience === 'staff' ? 'the JFP staff portal' : 'My JFP'
  const body = `${p(`Here is your code to sign in to ${who}:`)}
<p style="margin:8px 0 18px;font-size:34px;letter-spacing:8px;font-weight:800;color:#111827;">${esc(code)}</p>
${p('It works once, for 10 minutes. If you did not ask for it, ignore this email.')}`
  return send({ to: [{ email }], subject: `Your JFP sign-in code: ${code}`, html: shell({ preheader: `Code ${code}`, heading: 'Your sign-in code', body }) })
}

// ---------- booking ----------

export async function sendParentConfirmation({ booking, group, config, siteUrl }) {
  const players = booking.players.map((x) => esc(x.name)).join(', ')
  const ics = buildIcs({ uid: booking.id, group, config, title: `JFP ${group.day} ${group.time}`, fromIso: booking.startDate || '' })
  const body = `${p(`Payment received. ${players} ${booking.players.length > 1 ? 'are' : 'is'} booked into ${esc(config.term)}.`)}
${rows([...groupRows(config, group, booking.startDate || ''), ['Players', players], ['Paid', esc(formatAud(booking.amountPaidCents ?? booking.priceCents))], ['Reference', esc(booking.id)]])}
${p('The calendar file attached adds all the dates in one tap.')}
${p('Arrive 10 minutes early. Bring boots, shin pads and a full water bottle.')}
${config.kitUrl ? p(`<b>Required:</b> every JFP player trains in the JF playing kit (${config.kitPriceLabel || 'A$50'}). If you have not ordered it yet, ${link('order it from BE Teamsport', config.kitUrl)} before the first session.`) : ''}
${siteUrl ? button('Open My JFP', `${siteUrl}/jfp-account/`) : ''}`
  return send({
    to: [{ email: booking.email, name: booking.parentName }],
    subject: `You're booked in: ${group.day} ${group.time}, ${config.term}`,
    html: shell({ preheader: `${group.day} ${group.time}, first session ${dateLabel(booking.startDate || sessionDates(config, group.day)[0])}`, heading: 'You are booked in', body }),
    attachment: ics ? [{ name: 'jfp-term.ics', content: Buffer.from(ics).toString('base64') }] : undefined,
  })
}

export async function sendStaffAlert({ booking, group, config }) {
  const coach = coachById(config, group.coachId)
  const body = rows([
    ['Group', `${esc(group.day)} ${esc(group.time)}, ${esc(group.location)}`],
    ['Coach', esc(coach?.name || '')],
    ['Players', booking.players.map((x) => `${esc(x.name)}${x.age != null ? ` (${esc(x.age)})` : ''}`).join(', ')],
    ['Parent', esc(booking.parentName)],
    ['Email', esc(booking.email)],
    ['Mobile', esc(booking.mobile)],
    ['New players', booking.players.filter((x) => x.isNew).length ? 'Details and waiver signed online' : 'Returning'],
    ['Paid', esc(formatAud(booking.amountPaidCents ?? booking.priceCents))],
    ['Stripe fee', booking.stripeFeeCents != null ? esc(formatAud(booking.stripeFeeCents)) : 'Pending'],
    ['Reference', esc(booking.id)],
  ])
  return send({ to: staffTo(config), subject: `JFP booking: ${booking.players.map((x) => x.name).join(', ')}, ${group.day} ${group.time}`, html: shell({ heading: 'New JFP booking', body }), replyTo: booking.email })
}

export async function sendCoachAlert({ booking, group, config }) {
  const coach = coachById(config, group.coachId)
  if (!coach?.email) return false
  const body = `${p(`Coach ${esc(coach.name)}, a new player has joined your ${esc(group.day)} ${esc(group.time)} group.`)}
${rows([
    ['Group', `${esc(group.day)} ${esc(group.time)}, ${esc(group.location)}`],
    ['Players', booking.players.map((x) => `${esc(x.name)}${x.age != null ? ` (${esc(x.age)})` : ''}`).join(', ')],
    ['First session', esc(dateLabel(booking.startDate || sessionDates(config, group.day)[0]))],
    ['Reference', esc(booking.id)],
  ])}`
  await send({ to: [{ email: coach.email, name: `Coach ${coach.name}` }], subject: `New player: ${group.day} ${group.time}`, html: shell({ heading: 'New player in your group', body }) })
  return true
}

// ---------- payment requests (admin adds, balances, approved places) ----------

export async function sendFamilyInvite({ to, parentName, playerNames, group, config, url, needs, amountCents, trial = false, startDate = '' }) {
  const todo = []
  if (needs.details) todo.push('add the player details')
  if (needs.waiver) todo.push('sign the waiver')
  if (needs.payment) todo.push(`pay ${formatAud(amountCents)}`)
  const list = todo.length ? `${todo.slice(0, -1).join(', ')}${todo.length > 1 ? ' and ' : ''}${todo.at(-1)}` : ''
  const what = trial ? `a trial session in ${esc(group.day)} ${esc(group.time)}` : `a place in ${esc(config.term)}`
  const body = `${p(`Hi ${esc(parentName || 'there')}, ${esc(playerNames.join(' and '))} ${playerNames.length > 1 ? 'have' : 'has'} ${what}.`)}
${rows([...(trial && startDate ? [['Trial', esc(dateLabel(startDate))]] : []), ...groupRows(config, group, trial ? '' : startDate)])}
${list ? p(`To finish, sign in with this email address and ${esc(list)}. It takes a couple of minutes.${needs.payment ? ' The place is locked in once it is paid.' : ''}`) : p('Sign in with this email address to see the booking.')}
${button(needs.payment ? 'Sign in and finish' : 'View the booking', url)}`
  return send({ to: [{ email: to, name: parentName }], subject: trial ? `${playerNames.join(' and ')}: your JFP trial` : `${playerNames.join(' and ')}: your ${config.term} place`, html: shell({ preheader: `${group.day} ${group.time}`, heading: trial ? 'Your JFP trial' : 'Your JFP place', body }) })
}

// After a good trial: the rest of the term, with the trial fee taken off.
export async function sendTermOffered({ to, parentName, playerNames, group, config, url, amountCents, startDate, creditCents = 0 }) {
  const body = `${p(`Hi ${esc(parentName || 'there')}. Great trial. We would love ${esc(playerNames.join(' and '))} to join ${esc(group.day)} ${esc(group.time)} for the rest of ${esc(config.term)}.`)}
${rows([...groupRows(config, group, startDate), ['To pay', `${esc(formatAud(amountCents))}${creditCents ? `<br><span style="color:#6B7280;font-weight:400;font-size:13px;">The ${esc(formatAud(creditCents))} trial is already taken off.</span>` : ''}`]])}
${p('Sign in with this email address to pay and lock in the place. Card, Apple Pay or Afterpay.')}
${button('Sign in and pay', url)}`
  return send({ to: [{ email: to, name: parentName }], subject: `${playerNames.join(' and ')}: the rest of ${config.term}`, html: shell({ heading: 'Your place for the term', body }) })
}

export async function sendPaymentReceipt({ payreq, group, config, siteUrl }) {
  if (payreq.next) {
    const held = payreq.next.choice === 'hold'
    const body = `${p(`Thanks ${esc(payreq.parentName || '')}. ${esc(payreq.playerNames.join(' and '))}'s place for ${esc(payreq.next.term)} is ${held ? 'held' : 'paid and locked in'}.`)}
${rows([...(group ? [['Group', `${esc(group.day)} ${esc(group.time)}, ${esc(locationFor(config, group.location).name)}`]] : []), ['Paid', esc(formatAud(payreq.paidCents ?? payreq.amountCents))], ...(held ? [['Still to pay', `${esc(formatAud(Math.max(0, payreq.next.fullCents - (payreq.paidCents ?? payreq.amountCents))))} before ${esc(payreq.next.term)} starts`]] : []), ['Reference', esc(payreq.id)]])}
${held ? p('The hold fee is non-refundable and comes off the term fee. When the new timetable is out we will confirm the group, and you pay the rest in My JFP.') : ''}
${siteUrl ? button('Open My JFP', `${siteUrl}/jfp-account/`) : ''}`
    return send({ to: [{ email: payreq.email, name: payreq.parentName }], subject: `${payreq.playerNames.join(' and ')}: ${payreq.next.term} ${held ? 'place held' : 'paid'}`, html: shell({ heading: held ? 'Your place is held' : 'You are locked in', body }) })
  }
  const trial = payreq.reason === 'trial'
  const ics = group ? buildIcs({ uid: payreq.id, group, config, title: trial ? `JFP trial ${group.day} ${group.time}` : `JFP ${group.day} ${group.time}`, fromIso: payreq.startDate || '', only: trial ? payreq.trialDate || '' : '' }) : ''
  const body = `${p(`Thanks ${esc(payreq.parentName || '')}. We have your payment for ${esc(payreq.playerNames.join(' and '))}.`)}
${rows([...(trial && payreq.trialDate ? [['Trial', esc(dateLabel(payreq.trialDate))]] : []), ...(group ? groupRows(config, group, trial ? '' : payreq.startDate || '').filter(([k]) => !(trial && k === 'Dates')) : []), ['Paid', esc(formatAud(payreq.paidCents ?? payreq.amountCents))], ['Reference', esc(payreq.id)]])}
${config.kitUrl ? p(`<b>Required:</b> every JFP player trains in the JF playing kit (${config.kitPriceLabel || 'A$50'}). If you have not ordered it yet, ${link('order it from BE Teamsport', config.kitUrl)} before the first session.`) : ''}
${siteUrl ? button('Open My JFP', `${siteUrl}/jfp-account/`) : ''}`
  return send({
    to: [{ email: payreq.email, name: payreq.parentName }],
    subject: `Payment received: ${payreq.playerNames.join(' and ')}`,
    html: shell({ heading: 'Payment received', body }),
    attachment: ics ? [{ name: 'jfp-term.ics', content: Buffer.from(ics).toString('base64') }] : undefined,
  })
}

export async function sendPaymentStaffAlert({ payreq, group, config }) {
  const body = rows([
    ['Players', esc(payreq.playerNames.join(', '))],
    ['Group', group ? `${esc(group.day)} ${esc(group.time)}, ${esc(group.location)}` : 'Not set'],
    ['Parent', esc(payreq.parentName)],
    ['Email', esc(payreq.email)],
    ['Paid', esc(formatAud(payreq.paidCents ?? payreq.amountCents))],
    ['Stripe fee', payreq.stripeFeeCents != null ? esc(formatAud(payreq.stripeFeeCents)) : 'Pending'],
    ['For', esc(payreq.reason || '')],
    ['Reference', esc(payreq.id)],
  ])
  return send({ to: staffTo(config), subject: `JFP payment: ${payreq.playerNames.join(', ')}`, html: shell({ heading: 'Payment received', body }), replyTo: payreq.email })
}

// ---------- payments that need a person ----------

const ATTENTION = {
  'paid-after-cancel': 'A family paid for a booking or payment link that had already been cancelled or had expired. Nothing was added to Airtable automatically. Decide whether to give them the place or refund in Stripe.',
  'second-payment': 'A family paid twice for the same booking or payment link. The first payment is recorded; this second one is not. Refund it in Stripe, or keep it as credit.',
  'overpaid': 'A payment took a player past what their Term 4 row costs (for example two payment links paid for the same child). It is recorded in Airtable. Check the row and refund the extra in Stripe.',
  'duplicate-enrolment': 'A family booked and paid for a child who already had a place in the same group. Both rows are in Airtable. Remove one and refund in Stripe.',
}
export async function sendAttentionAlert({ record, reason, info, config }) {
  const body = `${p(esc(ATTENTION[reason] || 'A payment needs checking.'))}${rows([
    ['Reference', esc(record.id)],
    ['Players', esc((record.players || []).map((x) => x.name).join(', ') || (record.playerNames || []).join(', '))],
    ['Parent', `${esc(record.parentName || '')} ${esc(record.email || '')}`],
    ['Amount', esc(formatAud(info.amountCents || 0))],
    ...(info.extra ? [['Players', esc(info.extra)]] : []),
    ['Stripe', info.intentId ? link(info.intentId, `https://dashboard.stripe.com/payments/${info.intentId}`) : esc(info.sessionId)],
  ])}${p('It is also flagged in the JFP portal under Payments.')}`
  return send({ to: staffTo(config), subject: `JFP payment needs checking: ${record.id}`, html: shell({ heading: 'A payment needs checking', body }) })
}

// ---------- applications, waitlist, enquiries ----------

// End of term: keep your place for next term.
export async function sendNextTermInvite({ to, parentName, players, config, url, holdLabel, fullLabel }) {
  const body = `${p(`Hi ${esc(parentName || 'there')}. ${esc(config.term)} is nearly done, and ${esc(config.nextTerm.name)} places open to current families first.`)}
${rows(players.map((x) => [x.name, esc(x.group)]))}
${p(`Know you can commit? <b>Pay ${esc(fullLabel)}</b> for the term and the place is locked in.`)}
${p(`Not sure of next term's schedule yet? <b>Hold your place for ${esc(holdLabel)}</b>. It is non-refundable and comes off the term fee.`)}
${p('Not coming back? Tell us in the same place, and we will offer the spot to someone else.')}
${button('Choose in My JFP', url)}`
  return send({ to: [{ email: to, name: parentName }], subject: `Keep your place for ${config.nextTerm.name}`, html: shell({ heading: `${config.nextTerm.name}: keep your place`, body }) })
}

const KIND_WORD = { application: 'application', waitlist: 'waitlist request', enquiry: 'enquiry' }

export async function sendTrialOffered({ request, group, config, url, amountCents, trialDate }) {
  const body = `${p(`Thanks ${esc(request.parentName)}. We would like ${esc(request.players.map((x) => x.name).join(' and '))} to come to a trial in ${esc(group.day)} ${esc(group.time)}.`)}
${rows([['Trial', esc(dateLabel(trialDate))], ...groupRows(config, group).filter(([k]) => k !== 'Dates'), ['To pay', esc(formatAud(amountCents))]])}
${p('Sign in with this email address to pay for the trial and it is booked. After the session the coach will let you know, and if it is a good fit you pay for the rest of the term in My JFP, with the trial fee taken off.')}
${button('Sign in and book the trial', url)}`
  return send({ to: [{ email: request.email, name: request.parentName }], subject: `Trial: ${group.day} ${group.time}, ${dateLabel(trialDate)}`, html: shell({ heading: 'Your trial session', body }) })
}

export async function sendRequestReceived({ request, group, config }) {
  const names = esc(request.players.map((x) => x.name).join(' and '))
  const line = request.kind === 'waitlist'
    ? `You are on the waitlist for ${esc(group.day)} ${esc(group.time)}. If a place opens we will email you a link to take it.`
    : request.kind === 'enquiry'
      ? `Thanks for your enquiry about ${esc(group.label || '1 to 1')} coaching. Lee or Ligia will be in touch.`
      : `We have your application for ${names} to join ${esc(group.day)} ${esc(group.time)}. We reply within 48 hours: either a place for the term, or a trial session first.`
  const body = `${p(`Thanks ${esc(request.parentName)}.`)}${p(line)}${rows(groupRows(config, group))}`
  return send({ to: [{ email: request.email, name: request.parentName }], subject: `Received: your JFP ${KIND_WORD[request.kind] || 'request'}`, html: shell({ heading: 'We have your request', body }) })
}

// A kind no: this group is not the right fit, maybe another one is.
export async function sendDeclined({ request, group, config, message, suggest, siteUrl }) {
  const names = esc(request.players.map((x) => x.name).join(' and '))
  const body = `${p(`Thanks for applying, ${esc(request.parentName)}.`)}
${p(`Our coaches have looked at ${names}'s application for ${esc(group.day)} ${esc(group.time)}, and it is not the right group for ${request.players.length > 1 ? 'them' : 'this player'} this term. We keep every group at one level so each player is challenged, and we would rather say so now.`)}
${message ? p(esc(message)) : ''}
${suggest ? `${p(`A group we think would suit: <b>${esc(suggest.day)} ${esc(suggest.time)}, ${esc(locationFor(config, suggest.location).name)}</b>. Apply for it on the timetable, or reply to this email.`)}` : p('Reply to this email if you would like to talk about another group or 1 to 1 coaching.')}
${siteUrl ? button('See the timetable', `${siteUrl}/jfp-booking/`) : ''}`
  return send({ to: [{ email: request.email, name: request.parentName }], subject: `Your JFP application: ${group.day} ${group.time}`, html: shell({ heading: 'About your application', body }) })
}

export async function sendRefundAlert({ record, refund, config, full }) {
  const players = (record.playerNames || (record.players || []).map((x) => x.name)).join(', ')
  const body = `${p(`A ${full ? 'full' : 'part'} refund made in Stripe has been recorded.`)}${rows([
    ['Players', esc(players)], ['Refunded', esc(formatAud(refund.amountCents))], ['Reference', esc(record.id)], ['Stripe refund', esc(refund.id)],
    ['Airtable', refund.rows.length ? `Amount paid lowered on ${refund.rows.length} Term 4 row${refund.rows.length === 1 ? '' : 's'}` : 'No Term 4 row found to change'],
  ])}${p('The ledger has a matching refund row. If the player is leaving, remove them on the timetable.')}`
  return send({ to: staffTo(config), subject: `JFP refund recorded: ${players}, ${formatAud(refund.amountCents)}`, html: shell({ heading: 'Refund recorded', body }) })
}

const ANSWER_LABELS = { club: 'Club', team: 'Team and age group', playingUp: 'Playing', trainedBefore: 'Trained with Joner before', position: 'Position', videos: 'Videos' }

export async function sendRequestAlert({ request, group, config }) {
  const body = `${rows([
    ['Type', esc(KIND_WORD[request.kind] || request.kind)],
    ['Group', `${esc(group.day)} ${esc(group.time)}, ${esc(group.location)}`],
    ['Players', request.players.map((x) => `${esc(x.name)}${x.age != null ? ` (${esc(x.age)})` : ''}`).join(', ')],
    ...Object.entries(request.answers || {}).map(([k, v]) => [ANSWER_LABELS[k] || k, esc(v)]),
    ...(request.answers?.club ? [] : [['Club', esc(request.club || 'Not given')]]),
    ['Parent', esc(request.parentName)],
    ['Email', esc(request.email)],
    ['Mobile', esc(request.mobile)],
    ['Message', esc(request.message || 'None')],
  ])}${p('Review it in the JFP portal.')}`
  return send({ to: staffTo(config), subject: `JFP ${KIND_WORD[request.kind] || 'request'}: ${request.players.map((x) => x.name).join(', ')}, ${group.day} ${group.time}`, html: shell({ heading: `New ${KIND_WORD[request.kind] || 'request'}`, body }), replyTo: request.email })
}

export async function sendPlaceOffered({ request, group, config, url, amountCents, startDate = '' }) {
  const body = `${p(`Great news ${esc(request.parentName)}. ${esc(request.players.map((x) => x.name).join(' and '))} ${request.players.length > 1 ? 'have' : 'has'} a place in ${esc(group.day)} ${esc(group.time)} for ${esc(config.term)}.`)}
${rows([...groupRows(config, group, startDate), ['To pay', esc(formatAud(amountCents))]])}
${p('Sign in with this email address to pay and lock it in. The place is held for you for 7 days, and it is yours once it is paid. Card, Apple Pay or Afterpay.')}
${button('Sign in and pay', url)}`
  return send({ to: [{ email: request.email, name: request.parentName }], subject: `A place for you: ${group.day} ${group.time}`, html: shell({ heading: 'Your place is ready', body }) })
}
