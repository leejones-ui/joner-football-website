// Camp emails (Lee, 10 Nov 2026): the parent gets everything for the day the
// moment Stripe says paid (as the USA and Sydney camps did), and Lee and
// Ligia get an alert with the details. Brevo transactional API.
import { daysText, audLabel } from './_camp-store.js'

const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;')
const SITE = 'https://jonerfootball.com'
const HERO = `${SITE}/images/camps/email/camp-confirmation-hero.jpg`

function shell({ preheader, eyebrow, heading, body }) {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f2f2f2;font-family:Arial,Helvetica,sans-serif;color:#111;">
<span style="display:none!important;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;">${esc(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f2f2;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;max-width:640px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e3e3e3;">
<tr><td style="background:#000;"><img src="${HERO}" width="640" alt="Joner Football camp" style="display:block;width:100%;max-width:640px;height:auto;border:0;"></td></tr>
<tr><td style="padding:28px 26px 6px;"><p style="margin:0 0 8px;color:#E8000D;font-size:12px;font-weight:900;letter-spacing:1.6px;text-transform:uppercase;">${esc(eyebrow)}</p>
<h1 style="margin:0 0 16px;color:#000;font-size:28px;line-height:1.1;font-weight:900;text-transform:uppercase;">${esc(heading)}</h1></td></tr>
${body}
<tr><td style="padding:22px 26px;background:#0a0a0a;"><p style="margin:0 0 2px;color:#fff;font-size:15px;font-weight:800;">Lee Jones</p><p style="margin:0;color:#bbb;font-size:13px;">Joner Football · <a href="${SITE}/camps/" style="color:#fff;">jonerfootball.com/camps</a></p></td></tr>
</table></td></tr></table></body></html>`
}
const p = (t) => `<tr><td style="padding:0 26px 14px;"><p style="margin:0;color:#333;font-size:15px;line-height:1.65;">${t}</p></td></tr>`
const h2 = (t) => `<tr><td style="padding:10px 26px 8px;"><h2 style="margin:0;color:#000;font-size:18px;font-weight:900;text-transform:uppercase;">${esc(t)}</h2></td></tr>`
const table = (rows) => `<tr><td style="padding:4px 26px 18px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f7f7;border-radius:10px;">${rows.filter(([, v]) => v).map(([k, v]) => `<tr><td style="padding:10px 12px;border-bottom:1px solid #e6e6e6;color:#777;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;vertical-align:top;">${esc(k)}</td><td style="padding:10px 12px;border-bottom:1px solid #e6e6e6;color:#000;font-size:15px;font-weight:700;text-align:right;">${esc(v)}</td></tr>`).join('')}</table></td></tr>`
const list = (items) => `<tr><td style="padding:0 26px 16px;"><ul style="margin:0;padding-left:20px;color:#333;font-size:15px;line-height:1.8;">${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul></td></tr>`

const mapsUrl = (camp) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(camp.address || camp.location)}`
const names = (b) => b.players.map((x) => x.firstName).join(' and ')

export function renderCampConfirmation(b, camp) {
  const first = String(b.parentName || '').split(' ')[0] || 'there'
  const kids = names(b)
  const start = camp.timesLabel.split(' to ')[0]
  const end = camp.timesLabel.split(' to ')[1] || '12pm'
  const html = shell({
    preheader: `${kids} ${b.players.length > 1 ? 'are' : 'is'} booked in. Here is where to be, when, and what to bring.`,
    eyebrow: camp.title,
    heading: `${kids}${b.players.length > 1 ? ' are' : ' is'} booked in`,
    body: `
${p(`Hi ${esc(first)},`)}
${p(`Payment received, so the place${b.players.length > 1 || b.dayIds.length > 1 ? 's are' : ' is'} confirmed. We cannot wait to get to work with ${esc(kids)}.`)}
${table([
  ['Booking', b.id],
  ['Player' + (b.players.length > 1 ? 's' : ''), b.players.map((x) => `${x.firstName} ${x.surname}`).join(', ')],
  ['Day' + (b.dayIds.length > 1 ? 's' : ''), daysText(camp, b.dayIds)],
  ['Times', camp.timesLabel],
  ['Where', camp.location ? `${camp.location}${camp.address ? `, ${camp.address}` : ''}` : 'Sydney. We email you the venue before camp.'],
  ['Paid', audLabel(b.amountPaidCents)],
])}
${h2('On the day')}
${list([
  `${camp.arriveLabel} to sign in. We start at ${start} sharp.`,
  `Finish is ${end}.`,
  'Players are grouped by age and ability, so everyone is challenged at the right level.',
])}
${camp.location ? p(`<a href="${mapsUrl(camp)}" style="color:#E8000D;font-weight:800;">Open ${esc(camp.location)} in Maps</a>`) : ''}
${h2('What to bring')}
${list(camp.bring)}
${h2('Good to know')}
${list([
  'Only severe weather will affect the camp. We will email you if anything changes.',
  'If anything changes with medical notes, reply to this email before the day.',
  'Need to cancel? Reply to this email. 14 days or more before camp is a full refund, 48 hours or more is a full refund less a A$5 card fee, 24 to 48 hours is half, and inside 24 hours there is no refund. You can pass the place to another player at any time.',
])}
${p(`Want ${esc(b.players[0]?.firstName || 'them')} to arrive sharper? The Joner Football App has free sessions to start with: <a href="${SITE}/app" style="color:#E8000D;font-weight:800;">jonerfootball.com/app</a>`)}
${p(`Know a teammate who would love it? Send them this before places go: <a href="${SITE}/camps/${camp.slug}/" style="color:#E8000D;font-weight:800;">jonerfootball.com/camps/${camp.slug}</a>`)}
${p('Any questions, just reply. See you on the pitch.')}
${p(`<span style="font-size:13px;color:#777;">You booked under our <a href="${SITE}/camps/terms/" style="color:#777;">camp terms</a>.</span>`)}`,
  })
  return { subject: `Booked in: ${camp.short}, ${daysText(camp, b.dayIds)}`, html }
}

// Started the form, did not pay (the USA and Sydney camps sent the same nudge).
export function renderCampReminder(b, camp) {
  const first = String(b.parentName || '').split(' ')[0] || 'there'
  const kids = names(b)
  const link = `${SITE}/camps/${camp.slug}/?utm_source=email&utm_medium=reminder&utm_campaign=camp_not_finished#book`
  const html = shell({
    preheader: `${kids}'s place is not confirmed until payment is complete.`,
    eyebrow: camp.title,
    heading: 'Your camp place is not confirmed yet',
    body: `
${p(`Hi ${esc(first)},`)}
${p(`We saw you start a booking for ${esc(kids)} at the ${esc(camp.title)} (${esc(daysText(camp, b.dayIds))}), but the payment did not go through.`)}
${p('<strong style="color:#000;">The place is not held until payment is complete,</strong> and places are limited.')}
<tr><td style="padding:6px 26px 22px;"><a href="${link}" style="background:#E8000D;color:#ffffff;text-decoration:none;font-weight:900;font-size:15px;padding:16px 24px;border-radius:8px;display:inline-block;text-transform:uppercase;letter-spacing:.04em;">Finish booking</a></td></tr>
${p('If you have decided not to come, no problem, just ignore this. If you already paid and this crossed over, reply and we will check it.')}`,
  })
  return { subject: `${kids}'s camp place is not confirmed yet`, html }
}

export function renderCampStaffAlert(b, camp) {
  const rows = [
    ['Booking', b.id], ['Status', b.status === 'paid' ? `PAID ${audLabel(b.amountPaidCents)} (${b.method || 'Stripe'})` : b.status],
    ['Days', daysText(camp, b.dayIds)], ['Parent', b.parentName], ['Email', b.email], ['Mobile', b.mobile],
    ['Emergency contact', [b.emergencyName, b.emergencyMobile].filter(Boolean).join(' · ')], ['Collecting', b.pickup],
    ['Heard about camp', b.heardAbout], ['Came from', b.cameFrom], ['Extra info', b.extraInfo], ['Needs a look', b.attention],
  ]
  const players = b.players.map((x, i) => [`Player ${i + 1}`, `${x.firstName} ${x.surname}, age ${x.age || '?'}${x.clubLevel ? `, plays for ${x.clubLevel}` : ''}${x.previousCamp ? `, camp before: ${x.previousCamp}` : ''}${x.medical ? `. Medical: ${x.medical}` : ''}`])
  const html = shell({
    preheader: `${names(b)} for ${daysText(camp, b.dayIds)}`,
    eyebrow: 'New camp sign-up',
    heading: `${names(b)}: ${camp.short}`,
    body: `${table([...rows, ...players])}${p(`Every sign-up is in the Joner Football Portal under <a href="${SITE}/jfp-portal/#camps" style="color:#E8000D;font-weight:800;">Camps</a>.`)}`,
  })
  return { subject: `${b.attention ? 'CHECK ' : ''}PAID camp sign-up: ${names(b)} for ${camp.short} (${daysText(camp, b.dayIds)})`, html }
}

async function brevoSend({ to, subject, html, replyTo }) {
  const apiKey = process.env.BREVO_API_KEY
  if (!apiKey) throw new Error('BREVO_API_KEY is not configured.')
  const sender = { name: process.env.CAMP_EMAIL_SENDER_NAME || 'Joner Football Camps', email: process.env.BREVO_SENDER_EMAIL || 'leejones@jonerfootball.com' }
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', 'api-key': apiKey },
    body: JSON.stringify({ sender, to, subject, htmlContent: html, replyTo: replyTo || { email: process.env.CAMP_REPLY_TO_EMAIL || sender.email, name: 'Joner Football' } }),
  })
  if (!res.ok) throw new Error(`Brevo ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return (await res.json().catch(() => ({}))).messageId || 'sent'
}

export async function sendCampConfirmation(b, camp) {
  const { subject, html } = renderCampConfirmation(b, camp)
  return brevoSend({ to: [{ email: b.email, name: b.parentName || b.email }], subject, html })
}
export async function sendCampReminder(b, camp) {
  const { subject, html } = renderCampReminder(b, camp)
  return brevoSend({ to: [{ email: b.email, name: b.parentName || b.email }], subject, html })
}
export async function sendCampStaffAlert(b, camp) {
  const to = [...new Set([...(camp.staffEmails || []), process.env.CAMP_SIGNUP_EMAIL].filter(Boolean).map((e) => e.toLowerCase()))].map((email) => ({ email }))
  if (!to.length) return 'no-staff'
  const { subject, html } = renderCampStaffAlert(b, camp)
  return brevoSend({ to, subject, html, replyTo: { email: b.email, name: b.parentName || b.email } })
}

// The family joins the Sydney list in Brevo (list 6, as the Sydney camps did).
export async function addCampContact(b, camp) {
  const apiKey = process.env.BREVO_API_KEY
  if (!apiKey) return 'off'
  if (/@jonerfootball\.com$/i.test(b.email)) return 'staff'
  const res = await fetch('https://api.brevo.com/v3/contacts', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', 'api-key': apiKey },
    body: JSON.stringify({ email: b.email, attributes: { FIRSTNAME: b.players[0]?.firstName || '', WEBSITE_SOURCE: 'camp-registration', CAMP_NAME: camp.title, CAMP_DESTINATION: 'Sydney', HEARD_ABOUT_CAMP: b.heardAbout || '', DONE_CAMP_BEFORE: b.players[0]?.previousCamp || '' }, listIds: [Number(process.env.CAMP_BREVO_LIST_ID || 6)], updateEnabled: true }),
  })
  if (!res.ok && res.status !== 204) throw new Error(`Brevo contact ${res.status}`)
  return 'added'
}

// ---------- upgrades: extra days paid for (Lee, 11 Nov 2026) ----------

// The updated confirmation after a family pays to add days. Sent once per
// upgrade, and only after Lee or Ligia approve this wording (until then staff
// send it from the portal). Replies go to Ligia.
export function renderCampUpgradeConfirmation(b, camp, u) {
  const first = String(b.parentName || '').split(' ')[0] || 'there'
  const f = b.players.map((x) => x.firstName)
  const kids = f.length > 1 ? `${f.slice(0, -1).join(', ')} and ${f.at(-1)}` : f[0] || ''
  const many = b.players.length > 1
  const start = camp.timesLabel.split(' to ')[0]
  const end = camp.timesLabel.split(' to ')[1] || '12pm'
  const html = shell({
    preheader: `${daysText(camp, u.newDayIds)} is added. ${kids} ${many ? 'are' : 'is'} now booked for ${daysText(camp, b.dayIds)}.`,
    eyebrow: camp.title,
    heading: `${daysText(camp, u.newDayIds)} added`,
    body: `
${p(`Hi ${esc(first)},`)}
${p(`Thanks for the extra payment. ${esc(kids)} ${many ? 'are' : 'is'} now booked for ${esc(daysText(camp, b.dayIds))}. Nothing else about the booking has changed.`)}
${table([
  ['Booking', b.id],
  ['Player' + (many ? 's' : ''), b.players.map((x) => `${x.firstName} ${x.surname}`).join(', ')],
  ['Days now', daysText(camp, b.dayIds)],
  ['Added', daysText(camp, u.newDayIds)],
  ['Times', camp.timesLabel],
  ['Where', camp.location ? `${camp.location}${camp.address ? `, ${camp.address}` : ''}` : 'Sydney. We email you the venue before camp.'],
  ['Paid today', audLabel(u.topUpCents)],
  ['Paid in total', audLabel(b.amountPaidCents)],
])}
${h2('On the day')}
${list([
  `${camp.arriveLabel} to sign in. We start at ${start} sharp.`,
  `Finish is ${end}.`,
])}
${camp.location ? p(`<a href="${mapsUrl(camp)}" style="color:#E8000D;font-weight:800;">Open ${esc(camp.location)} in Maps</a>`) : ''}
${h2('What to bring each day')}
${list(camp.bring)}
${p('Any questions, just reply. See you on the pitch.')}
${p(`<span style="font-size:13px;color:#777;">Your booking is under our <a href="${SITE}/camps/terms/" style="color:#777;">camp terms</a>.</span>`)}`,
  })
  return { subject: `${daysText(camp, u.newDayIds)} added: ${camp.short}`, html }
}

export function renderCampUpgradeStaffAlert(b, camp, u) {
  const html = shell({
    preheader: `${names(b)} now ${daysText(camp, b.dayIds)}`,
    eyebrow: 'Camp upgrade paid',
    heading: `${names(b)}: ${daysText(camp, u.newDayIds)} added`,
    body: `${table([
      ['Booking', b.id], ['Upgrade', u.id], ['Parent', b.parentName], ['Email', b.email],
      ['Days now', daysText(camp, b.dayIds)], ['Added', daysText(camp, u.newDayIds)],
      ['Top-up', audLabel(u.topUpCents)], ['Paid in total', audLabel(b.amountPaidCents)],
      ['Parent email', u.effects?.parentEmail === 'done' ? 'Sent' : 'Not sent yet: send it from the portal once the wording is approved'],
    ])}${p(`Open the sign-up in the Joner Football Portal under <a href="${SITE}/jfp-portal/#camps" style="color:#E8000D;font-weight:800;">Camps</a>.`)}`,
  })
  return { subject: `Camp upgrade paid: ${names(b)} now ${daysText(camp, b.dayIds)} (${camp.short})`, html }
}

export async function sendCampUpgradeConfirmation(b, camp, u) {
  const { subject, html } = renderCampUpgradeConfirmation(b, camp, u)
  return brevoSend({ to: [{ email: b.email, name: b.parentName || b.email }], subject, html, replyTo: { email: 'ligia@jonerfootball.com', name: 'Joner Football' } })
}
export async function sendCampUpgradeStaffAlert(b, camp, u) {
  const to = [...new Set([...(camp.staffEmails || []), process.env.CAMP_SIGNUP_EMAIL].filter(Boolean).map((e) => e.toLowerCase()))].map((email) => ({ email }))
  if (!to.length) return 'no-staff'
  const { subject, html } = renderCampUpgradeStaffAlert(b, camp, u)
  return brevoSend({ to, subject, html, replyTo: { email: b.email, name: b.parentName || b.email } })
}
