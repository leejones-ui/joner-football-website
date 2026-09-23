// JFP emails, sent through Brevo like every other Joner transactional email.
import { formatAud, dateLabel, sessionDates, coachById } from './_jfp-store.js'

const LOCATIONS = {
  belrose: 'Joner Football HQ, 20 Narabang Way (Unit 2), Belrose NSW 2085',
}

function esc(v) {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

export function locationLine(location) {
  return /belrose/i.test(location) ? LOCATIONS.belrose : location
}

function shell({ eyebrow = 'Joner Football Performance', heading, body }) {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#050505;font-family:Arial,Helvetica,sans-serif;color:#fff;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#050505;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#111;border:1px solid #252525;border-radius:16px;">
<tr><td style="padding:32px 26px 8px;">
<p style="margin:0 0 10px;color:#e8000d;font-size:12px;font-weight:900;letter-spacing:1.8px;text-transform:uppercase;">${esc(eyebrow)}</p>
<h1 style="margin:0 0 18px;color:#fff;font-size:28px;line-height:1.1;font-weight:900;text-transform:uppercase;">${esc(heading)}</h1>
</td></tr>${body}
<tr><td style="padding:24px 26px;background:#0b0b0b;border-top:1px solid #252525;border-radius:0 0 16px 16px;">
<p style="margin:0;color:#fff;font-size:15px;font-weight:800;">Joner Football</p></td></tr>
</table></td></tr></table></body></html>`
}

function rows(list) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${list.map(([k, v]) => `<tr>
<td style="padding:9px 0;border-bottom:1px solid #252525;color:#9a9a9a;font-size:13px;text-transform:uppercase;letter-spacing:1px;width:36%;vertical-align:top;">${esc(k)}</td>
<td style="padding:9px 0;border-bottom:1px solid #252525;color:#fff;font-size:16px;font-weight:700;vertical-align:top;">${v}</td></tr>`).join('')}</table>`
}

function p(text) { return `<p style="margin:0 0 12px;color:#e6e6e6;font-size:15px;line-height:1.6;">${text}</p>` }
function button(label, href) {
  return `<p style="margin:18px 0;"><a href="${esc(href)}" style="background:#e8000d;color:#fff;text-decoration:none;font-weight:900;font-size:15px;padding:15px 22px;border-radius:8px;display:inline-block;text-transform:uppercase;">${esc(label)}</a></p>`
}

async function send({ to, subject, html, replyTo }) {
  const apiKey = process.env.BREVO_API_KEY
  if (!apiKey) throw new Error('BREVO_API_KEY is not configured.')
  const sender = process.env.BREVO_SENDER_EMAIL || 'leejones@jonerfootball.com'
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', 'api-key': apiKey },
    body: JSON.stringify({ sender: { name: 'Joner Football', email: sender }, to, replyTo: { email: replyTo || sender, name: 'Joner Football' }, subject, htmlContent: html }),
  })
  if (!res.ok) throw new Error(`Brevo ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return true
}

function staffTo(config) {
  const lee = process.env.JFP_OWNER_EMAIL || process.env.CAMP_SIGNUP_EMAIL || 'leejones@jonerfootball.com'
  return [...new Set([lee, ...(config.staffEmails || [])].map((e) => e.toLowerCase()))].map((email) => ({ email }))
}

function dateList(config, group) {
  return sessionDates(config, group.day).map(dateLabel).join(', ')
}

// ---------- booking ----------

export async function sendParentConfirmation({ booking, group, config }) {
  const coach = coachById(config, group.coachId)
  const players = booking.players.map((x) => esc(x.name)).join(', ')
  const dates = sessionDates(config, group.day)
  const body = `<tr><td style="padding:0 26px 8px;">
${p(`Payment received. ${players} ${booking.players.length > 1 ? 'are' : 'is'} booked into ${esc(config.term)}.`)}
${rows([
    ['Group', `${esc(group.day)} ${esc(group.time)}`],
    ['Where', esc(locationLine(group.location))],
    ['Coach', coach ? `Coach ${esc(coach.name)}` : 'Joner Football coach'],
    ['Players', players],
    ['First session', esc(dateLabel(dates[0]))],
    ['All 10 dates', esc(dateList(config, group))],
    ['Paid', esc(formatAud(booking.amountPaidCents ?? booking.priceCents))],
    ['Reference', esc(booking.id)],
  ])}
</td></tr>
<tr><td style="padding:14px 26px 24px;">
<p style="margin:0 0 8px;color:#fff;font-size:15px;font-weight:800;text-transform:uppercase;">One more step</p>
${p('Every player needs a signed waiver before their first session. It takes two minutes.')}
${config.waiverUrl ? button('Complete the waiver', config.waiverUrl) : p('We will send you the waiver link separately.')}
${p('Arrive 10 minutes early. Bring boots, shin pads and a full water bottle.')}
${p('Any questions, reply to this email.')}
</td></tr>`
  return send({ to: [{ email: booking.email, name: booking.parentName }], subject: `Booked: ${config.term}, ${group.day} ${group.time}`, html: shell({ heading: 'You are booked in.', body }) })
}

export async function sendStaffAlert({ booking, group, config }) {
  const coach = coachById(config, group.coachId)
  const body = `<tr><td style="padding:0 26px 24px;">${rows([
    ['Group', `${esc(group.day)} ${esc(group.time)}, ${esc(group.location)}`],
    ['Coach', esc(coach?.name || '')],
    ['Players', booking.players.map((x) => `${esc(x.name)} (${esc(x.age)})`).join(', ')],
    ['Parent', esc(booking.parentName)],
    ['Email', esc(booking.email)],
    ['Mobile', esc(booking.mobile)],
    ['Notes', esc(booking.notes || 'None')],
    ['Paid', esc(formatAud(booking.amountPaidCents ?? booking.priceCents))],
    ['Stripe fee', booking.stripeFeeCents != null ? esc(formatAud(booking.stripeFeeCents)) : 'Pending'],
    ['Airtable', booking.term4Ids?.length ? `Added to Term 4 Players (${booking.term4Ids.length})` : 'Pending'],
    ['Reference', esc(booking.id)],
  ])}</td></tr>`
  return send({ to: staffTo(config), subject: `JFP booking: ${booking.players.map((x) => x.name).join(', ')}, ${group.day} ${group.time}`, html: shell({ heading: 'New JFP Booking', body }), replyTo: booking.email })
}

export async function sendCoachAlert({ booking, group, config }) {
  const coach = coachById(config, group.coachId)
  if (!coach?.email) return false
  const body = `<tr><td style="padding:0 26px 24px;">
${p(`Coach ${esc(coach.name)}, a new player has joined your ${esc(group.day)} ${esc(group.time)} group.`)}
${rows([
    ['Group', `${esc(group.day)} ${esc(group.time)}, ${esc(group.location)}`],
    ['Players', booking.players.map((x) => `${esc(x.name)} (${esc(x.age)})`).join(', ')],
    ['First session', esc(dateLabel(sessionDates(config, group.day)[0]))],
    ['Reference', esc(booking.id)],
  ])}</td></tr>`
  await send({ to: [{ email: coach.email, name: `Coach ${coach.name}` }], subject: `New player: ${group.day} ${group.time}`, html: shell({ heading: 'New Player In Your Group', body }) })
  return true
}

// ---------- applications ----------

export async function sendApplicationReceived({ application, group, config }) {
  const body = `<tr><td style="padding:0 26px 24px;">
${p(`Thanks ${esc(application.parentName)}. We have your application for ${esc(application.players.map((x) => x.name).join(', '))} to join ${esc(group.day)} ${esc(group.time)} ${esc(group.programme)}.`)}
${p('Lee or Ligia will review it and come back to you. If it is approved you will get a link to pay and secure the place.')}
</td></tr>`
  return send({ to: [{ email: application.email, name: application.parentName }], subject: `Application received: ${group.programme}`, html: shell({ heading: 'Application Received', body }) })
}

export async function sendApplicationAlert({ application, group, config }) {
  const body = `<tr><td style="padding:0 26px 24px;">${rows([
    ['Group', `${esc(group.day)} ${esc(group.time)}, ${esc(group.location)}`],
    ['Programme', esc(group.programme)],
    ['Players', application.players.map((x) => `${esc(x.name)} (${esc(x.age)})`).join(', ')],
    ['Club / level', esc(application.club || 'Not given')],
    ['Parent', esc(application.parentName)],
    ['Email', esc(application.email)],
    ['Mobile', esc(application.mobile)],
    ['Why', esc(application.notes || 'Not given')],
  ])}${p('Review it in the JFP portal under Applications.')}</td></tr>`
  return send({ to: staffTo(config), subject: `JFP application: ${application.players.map((x) => x.name).join(', ')}, ${group.programme}`, html: shell({ heading: 'New Application', body }), replyTo: application.email })
}

export async function sendApplicationApproved({ application, group, config, payUrl }) {
  const body = `<tr><td style="padding:0 26px 24px;">
${p(`Great news ${esc(application.parentName)}. ${esc(application.players.map((x) => x.name).join(', '))} ${application.players.length > 1 ? 'have' : 'has'} a place in ${esc(group.day)} ${esc(group.time)} ${esc(group.programme)}.`)}
${p('Use the button below to pay and lock it in. The link is just for you and works for 7 days.')}
${button('Pay and secure the place', payUrl)}
</td></tr>`
  return send({ to: [{ email: application.email, name: application.parentName }], subject: `Approved: ${group.programme}`, html: shell({ heading: 'Your Place Is Approved', body }) })
}

// ---------- staff accounts ----------

export async function sendInvite({ email, name, role, url }) {
  const what = role === 'coach' ? 'your own timetable and hours' : 'the full JFP programme'
  const body = `<tr><td style="padding:0 26px 24px;">
${p(`Hi ${esc(name)}, you have a login for the Joner Football Performance portal, where you can see ${what}.`)}
${p('Use the button to choose your password. The link works once, for 48 hours.')}
${button('Set my password', url)}
${p('If you did not expect this email, ignore it.')}
</td></tr>`
  return send({ to: [{ email, name }], subject: 'Your JFP portal login', html: shell({ heading: 'Set Up Your Login', body }) })
}

export async function sendLoginCode({ email, code }) {
  const body = `<tr><td style="padding:0 26px 24px;">
${p('Your JFP portal sign-in code:')}
<p style="margin:10px 0 18px;font-size:36px;letter-spacing:10px;font-weight:900;color:#fff;">${esc(code)}</p>
${p('It works for 10 minutes. If you did not try to sign in, change your password.')}
</td></tr>`
  return send({ to: [{ email }], subject: `JFP sign-in code ${code}`, html: shell({ heading: 'Sign-in Code', body }) })
}
