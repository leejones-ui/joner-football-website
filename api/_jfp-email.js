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

export function buildIcs({ uid, group, config, title }) {
  const dates = sessionDates(config, group.day)
  if (!dates.length) return ''
  const [hh, mm] = (to24h(group.time) || '16:00').split(':').map(Number)
  const end = hh * 60 + mm + (group.durationMin || 60)
  const pad = (n) => String(n).padStart(2, '0')
  const day = (iso) => iso.replace(/-/g, '')
  const loc = locationLine(config, group.location).replace(/([,;])/g, '\\$1')
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Joner Football//JFP//EN', 'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${uid}@jonerfootball.com`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
    `DTSTART;TZID=Australia/Sydney:${day(dates[0])}T${pad(hh)}${pad(mm)}00`,
    `DTEND;TZID=Australia/Sydney:${day(dates[0])}T${pad(Math.floor(end / 60))}${pad(end % 60)}00`,
    `RRULE:FREQ=WEEKLY;COUNT=${dates.length}`,
    `SUMMARY:${title.replace(/([,;])/g, '\\$1')}`,
    `LOCATION:${loc}`,
    'END:VEVENT', 'END:VCALENDAR',
  ]
  return lines.join('\r\n')
}

function groupRows(config, group) {
  const loc = locationFor(config, group.location)
  const coach = coachById(config, group.coachId)
  const dates = sessionDates(config, group.day)
  return [
    ['Group', `${esc(group.day)} ${esc(group.time)}`],
    ['Where', `${esc(loc.address || group.location)}${loc.maps ? `<br>${link('Open in Maps', loc.maps)}` : ''}`],
    ['Coach', coach ? `Coach ${esc(coach.name)}` : 'Joner Football coach'],
    ...(dates.length ? [['Dates', `${esc(dates.length)} weeks, ${esc(dateLabel(dates[0]))} to ${esc(dateLabel(dates.at(-1)))}<br><span style="color:#6B7280;font-weight:400;font-size:13px;">${esc(dates.map(dateLabel).join(', '))}</span>`]] : []),
  ]
}

// ---------- sign in ----------

export async function sendSignInCode({ email, code, audience }) {
  const who = audience === 'staff' ? 'the JFP staff portal' : 'your JFP account'
  const body = `${p(`Here is your code to sign in to ${who}:`)}
<p style="margin:8px 0 18px;font-size:34px;letter-spacing:8px;font-weight:800;color:#111827;">${esc(code)}</p>
${p('It works once, for 10 minutes. If you did not ask for it, ignore this email.')}`
  return send({ to: [{ email }], subject: `Your JFP sign-in code: ${code}`, html: shell({ preheader: `Code ${code}`, heading: 'Your sign-in code', body }) })
}

// ---------- booking ----------

export async function sendParentConfirmation({ booking, group, config, siteUrl }) {
  const players = booking.players.map((x) => esc(x.name)).join(', ')
  const ics = buildIcs({ uid: booking.id, group, config, title: `JFP ${group.day} ${group.time}` })
  const body = `${p(`Payment received. ${players} ${booking.players.length > 1 ? 'are' : 'is'} booked into ${esc(config.term)}.`)}
${rows([...groupRows(config, group), ['Players', players], ['Paid', esc(formatAud(booking.amountPaidCents ?? booking.priceCents))], ['Reference', esc(booking.id)]])}
${p('The calendar file attached adds all the dates in one tap.')}
${p('Arrive 10 minutes early. Bring boots, shin pads and a full water bottle.')}
${siteUrl ? button('View your booking', `${siteUrl}/jfp-account/`) : ''}`
  return send({
    to: [{ email: booking.email, name: booking.parentName }],
    subject: `You're booked in: ${group.day} ${group.time}, ${config.term}`,
    html: shell({ preheader: `${group.day} ${group.time}, first session ${dateLabel(sessionDates(config, group.day)[0])}`, heading: 'You are booked in', body }),
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
    ['First session', esc(dateLabel(sessionDates(config, group.day)[0]))],
    ['Reference', esc(booking.id)],
  ])}`
  await send({ to: [{ email: coach.email, name: `Coach ${coach.name}` }], subject: `New player: ${group.day} ${group.time}`, html: shell({ heading: 'New player in your group', body }) })
  return true
}

// ---------- payment requests (admin adds, balances, approved places) ----------

export async function sendFamilyInvite({ to, parentName, playerNames, group, config, url, needs, amountCents }) {
  const todo = []
  if (needs.details) todo.push('add the player details')
  if (needs.waiver) todo.push('sign the waiver')
  if (needs.payment) todo.push(`pay ${formatAud(amountCents)}`)
  const list = todo.length ? `${todo.slice(0, -1).join(', ')}${todo.length > 1 ? ' and ' : ''}${todo.at(-1)}` : ''
  const body = `${p(`Hi ${esc(parentName || 'there')}, ${esc(playerNames.join(' and '))} ${playerNames.length > 1 ? 'have' : 'has'} a place in ${esc(config.term)}.`)}
${rows(groupRows(config, group))}
${list ? p(`To finish, sign in with this email address and ${esc(list)}. It takes a couple of minutes.`) : p('Sign in with this email address to see the booking.')}
${button(needs.payment ? 'Sign in and finish' : 'View the booking', url)}`
  return send({ to: [{ email: to, name: parentName }], subject: `${playerNames.join(' and ')}: your ${config.term} place`, html: shell({ preheader: `${group.day} ${group.time}`, heading: 'Your JFP place', body }) })
}

export async function sendPaymentReceipt({ payreq, group, config, siteUrl }) {
  const ics = group ? buildIcs({ uid: payreq.id, group, config, title: `JFP ${group.day} ${group.time}` }) : ''
  const body = `${p(`Thanks ${esc(payreq.parentName || '')}. We have your payment for ${esc(payreq.playerNames.join(' and '))}.`)}
${rows([...(group ? groupRows(config, group) : []), ['Paid', esc(formatAud(payreq.paidCents ?? payreq.amountCents))], ['Reference', esc(payreq.id)]])}
${siteUrl ? button('View your account', `${siteUrl}/jfp-account/`) : ''}`
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
}
export async function sendAttentionAlert({ record, reason, info, config }) {
  const body = `${p(esc(ATTENTION[reason] || 'A payment needs checking.'))}${rows([
    ['Reference', esc(record.id)],
    ['Players', esc((record.players || []).map((x) => x.name).join(', ') || (record.playerNames || []).join(', '))],
    ['Parent', `${esc(record.parentName || '')} ${esc(record.email || '')}`],
    ['Amount', esc(formatAud(info.amountCents || 0))],
    ['Stripe', info.intentId ? link(info.intentId, `https://dashboard.stripe.com/payments/${info.intentId}`) : esc(info.sessionId)],
  ])}${p('It is also flagged in the JFP portal under Payments.')}`
  return send({ to: staffTo(config), subject: `JFP payment needs checking: ${record.id}`, html: shell({ heading: 'A payment needs checking', body }) })
}

// ---------- applications, waitlist, enquiries ----------

const KIND_WORD = { application: 'application', waitlist: 'waitlist request', enquiry: 'enquiry' }

export async function sendRequestReceived({ request, group, config }) {
  const names = esc(request.players.map((x) => x.name).join(' and '))
  const line = request.kind === 'waitlist'
    ? `You are on the waitlist for ${esc(group.day)} ${esc(group.time)}. If a place opens we will email you a link to take it.`
    : request.kind === 'enquiry'
      ? `Thanks for your enquiry about ${esc(group.label || '1 to 1')} coaching. Lee or Ligia will be in touch.`
      : `We have your application for ${names} to join ${esc(group.day)} ${esc(group.time)} (${esc(group.label || group.programme)}). Lee or Ligia will review it and reply within 48 hours.`
  const body = `${p(`Thanks ${esc(request.parentName)}.`)}${p(line)}${rows(groupRows(config, group))}`
  return send({ to: [{ email: request.email, name: request.parentName }], subject: `Received: your JFP ${KIND_WORD[request.kind] || 'request'}`, html: shell({ heading: 'We have your request', body }) })
}

export async function sendRequestAlert({ request, group, config }) {
  const body = `${rows([
    ['Type', esc(KIND_WORD[request.kind] || request.kind)],
    ['Group', `${esc(group.day)} ${esc(group.time)}, ${esc(group.location)}`],
    ['Players', request.players.map((x) => `${esc(x.name)}${x.age != null ? ` (${esc(x.age)})` : ''}`).join(', ')],
    ['Club / level', esc(request.club || 'Not given')],
    ['Parent', esc(request.parentName)],
    ['Email', esc(request.email)],
    ['Mobile', esc(request.mobile)],
    ['Message', esc(request.message || 'None')],
  ])}${p('Review it in the JFP portal.')}`
  return send({ to: staffTo(config), subject: `JFP ${KIND_WORD[request.kind] || 'request'}: ${request.players.map((x) => x.name).join(', ')}, ${group.day} ${group.time}`, html: shell({ heading: `New ${KIND_WORD[request.kind] || 'request'}`, body }), replyTo: request.email })
}

export async function sendPlaceOffered({ request, group, config, url, amountCents }) {
  const body = `${p(`Great news ${esc(request.parentName)}. ${esc(request.players.map((x) => x.name).join(' and '))} ${request.players.length > 1 ? 'have' : 'has'} a place in ${esc(group.day)} ${esc(group.time)}.`)}
${rows([...groupRows(config, group), ['To pay', esc(formatAud(amountCents))]])}
${p('Sign in with this email address to pay and lock it in. The place is held for you for 7 days.')}
${button('Sign in and pay', url)}`
  return send({ to: [{ email: request.email, name: request.parentName }], subject: `A place for you: ${group.day} ${group.time}`, html: shell({ heading: 'Your place is ready', body }) })
}
