// JFP emails, sent through Brevo like every other Joner transactional email.
// Clean and light on purpose: white card, dark text, one button.
import { formatAud, dateLabel, sessionDates, coachById, coachLabel, locationFor, to24h, limitDates } from './_jfp-store.js'
import { logEmail } from './_jfp-email-log.js'
import { contactWords } from './_jfp-contact.js'

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

// Every send is written to the email log (sent with Brevo's message id, or
// failed with the reason), so staff can see what reached a family.
async function send({ to, subject, html, replyTo, attachment, kind = '' }) {
  const apiKey = process.env.BREVO_API_KEY
  // Brevo refuses an empty name, and a player with no parent has none (13 Oct 2026).
  to = (Array.isArray(to) ? to : [to]).filter((t) => t?.email).map((t) => (String(t.name || '').trim() ? { email: t.email, name: String(t.name).trim() } : { email: t.email }))
  const failed = async (error) => { await logEmail({ to, subject, kind, status: 'failed', error: error.message }); return error }
  if (!apiKey) throw await failed(new Error('BREVO_API_KEY is not configured.'))
  const sender = process.env.BREVO_SENDER_EMAIL || 'leejones@jonerfootball.com'
  if (!to.length) throw await failed(new Error('No email address to send to.'))
  let res
  try {
    res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', 'api-key': apiKey },
      body: JSON.stringify({ sender: { name: 'Joner Football', email: sender }, to, replyTo: { email: replyTo || sender, name: 'Joner Football' }, subject, htmlContent: html, ...(attachment ? { attachment } : {}) }),
    })
  } catch (error) { throw await failed(error) }
  const text = await res.text().catch(() => '')
  if (!res.ok) { const e = new Error(`Brevo ${res.status}: ${text.slice(0, 200)}`); console.error('jfp email refused', kind || subject, e.message); throw await failed(e) }
  let messageId = ''
  try { messageId = JSON.parse(text).messageId || '' } catch {}
  await logEmail({ to, subject, kind, status: 'sent', messageId })
  return { ok: true, messageId }
}

export function staffTo(config) {
  const lee = process.env.JFP_OWNER_EMAIL || process.env.CAMP_SIGNUP_EMAIL || 'leejones@jonerfootball.com'
  return [...new Set([lee, ...(config.staffEmails || [])].map((e) => e.toLowerCase()))].map((email) => ({ email }))
}

// ---------- calendar ----------

export function buildIcs({ uid, group, config, title, fromIso = '', only = '', product = '' }) {
  const dates = only ? [only] : limitDates(sessionDates(config, group.day).filter((d) => !fromIso || d >= fromIso), product)
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

// Families see the time, the place and the dates, never a coach's name
// (Lee, 14 Oct 2026: morning groups rotate coaches).
function groupRows(config, group, fromIso = '', product = '') {
  const loc = locationFor(config, group.location)
  const dates = limitDates(sessionDates(config, group.day).filter((d) => !fromIso || d >= fromIso), product)
  return [
    ['Group', `${esc(group.day)} ${esc(group.time)}`],
    ['Where', `${esc(loc.address || group.location)}${loc.maps ? `<br>${link('Open in Maps', loc.maps)}` : ''}`],
    ...(dates.length ? [['Dates', `${esc(dates.length)} ${dates.length === 1 ? 'session' : 'sessions'}, ${esc(dateLabel(dates[0]))} to ${esc(dateLabel(dates.at(-1)))}<br><span style="color:#6B7280;font-weight:400;font-size:13px;">${esc(dates.map(dateLabel).join(', '))}</span>`]] : []),
  ]
}

// ---------- sign in ----------

export async function sendSignInCode({ email, code, audience }) {
  const who = audience === 'staff' ? 'the JFP staff portal' : 'My account'
  const body = `${p(`Here is your code to sign in to ${who}:`)}
<p style="margin:8px 0 18px;font-size:34px;letter-spacing:8px;font-weight:800;color:#111827;">${esc(code)}</p>
${p('It works once, for 10 minutes. If you did not ask for it, ignore this email.')}`
  return send({ to: [{ email }], subject: `Your JFP sign-in code: ${code}`, html: shell({ preheader: `Code ${code}`, heading: 'Your sign-in code', body }), kind: 'sign-in code' })
}

// ---------- booking ----------

export async function sendParentConfirmation({ booking, group, config, siteUrl }) {
  const players = booking.players.map((x) => esc(x.name)).join(', ')
  const ics = buildIcs({ uid: booking.id, group, config, title: `JFP ${group.day} ${group.time}`, fromIso: booking.startDate || '' })
  const body = `${p(`Payment received. ${players} ${booking.players.length > 1 ? 'are' : 'is'} booked into ${esc(config.term)}.`)}
${rows([...groupRows(config, group, booking.startDate || ''), ['Players', players], ['Paid', esc(formatAud(booking.amountPaidCents ?? booking.priceCents))], ['Reference', esc(booking.id)]])}
${p('The calendar file attached adds all the dates in one tap.')}
${p('Arrive 10 minutes early. Bring boots, shin pads and a full water bottle.')}
${config.kitUrl ? p(`<b>Required:</b> every JFP player trains in the JF playing kit (${config.kitPriceLabel || 'A$60'}). If you have not ordered it yet, ${link('order it from BE Teamsport', config.kitUrl)} before the first session.`) : ''}
${siteUrl ? button('Open My account', `${siteUrl}/jfp-account/`) : ''}`
  return send({
    to: [{ email: booking.email, name: booking.parentName }],
    subject: `You're booked in: ${group.day} ${group.time}, ${config.term}`,
    html: shell({ preheader: `${group.day} ${group.time}, first session ${dateLabel(booking.startDate || sessionDates(config, group.day)[0])}`, heading: 'You are booked in', body }),
    attachment: ics ? [{ name: 'jfp-term.ics', content: Buffer.from(ics).toString('base64') }] : undefined,
    kind: 'booking confirmed',
  })
}

export async function sendStaffAlert({ booking, group, config }) {
  const coach = coachById(config, group.coachId)
  const body = rows([
    ['Group', `${esc(group.day)} ${esc(group.time)}, ${esc(group.location)}`],
    ['Coach', esc(coachLabel(coach))],
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
  if (!coach?.email || !coach.alerts) return false
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

// Current Term 4 families: the new booking system, their account, and a
// pay link when something is owing (Lee, 5 Oct 2026). Replies go to Ligia.
export function accountInvite({ parentName, players, config, signInUrl, payUrl = '', amountCents = 0, needsWaiver = false, money = true, email = '', self = false }) {
  if (!money) return accountOnlyInvite({ parentName, players, config, signInUrl, needsWaiver, email, self })
  const names = players.map((x) => x.name)
  const w = contactWords({ self, players: names, parent: parentName })
  const who = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0]
  const owing = payUrl && amountCents > 0
  const term = config.term.replace(/\s*\d{4}$/, '')
  const body = `${p(`Hi ${esc(w.hi)},`)}
${p(self ? `Joner Football has a new booking system, and your account is ready. Sign in with this email address to see your ${esc(term)} sessions, every date and your payments.` : `Joner Football has a new booking system, and your account is ready. Sign in with this email address to see ${esc(who)}'s ${esc(term)} sessions, every date and your payments.`)}
${rows(players.map((x) => [esc(x.name), esc(x.group)]))}
${needsWaiver ? p(self ? 'When you sign in, first sign your waiver. It takes a minute.' : 'When you sign in, first sign the player waiver. It takes a minute.') : ''}
${owing ? p(`${needsWaiver ? 'Then pay' : 'There is'} <b>${esc(formatAud(amountCents))}</b>${needsWaiver ? '' : ' to pay'} for ${esc(term)}. You can pay by card, Apple Pay, Google Pay or Afterpay. The place is locked in once it is paid.`) : p(self ? 'Your place is confirmed. Nothing to pay.' : 'Your place is confirmed. Nothing to pay.')}
${p('There is no password. Enter your email and we send you a 6 digit code.')}
${button(owing ? 'Sign in and pay' : 'Sign in to your account', owing ? payUrl : signInUrl)}
${p('Questions? Just reply to this email.')}`
  return { subject: owing ? `Your JFP account is ready: ${formatAud(amountCents)} to pay` : 'Your JFP account is ready', html: shell({ preheader: 'Sign in to see your sessions', heading: 'Your JFP account', body }) }
}
// Every Term 4 family, paid or not: sign in with the email on file (Lee's
// approved wording, 12 Oct 2026). No amounts: what is left to pay, if
// anything, is on their account page with a Pay button.
function accountOnlyInvite({ parentName, players, config, signInUrl, needsWaiver, email = '', self = false }) {
  const names = players.map((x) => String(x.name || '').trim().split(/\s+/)[0]).filter(Boolean)
  const who = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0] || 'your player'
  const w = contactWords({ self, players: players.map((x) => x.name), parent: parentName })
  const term = config.term.replace(/\s*\d{4}$/, '')
  const li = (html) => `<li style="margin:0 0 6px;">${html}</li>`
  const list = (items) => `<ul style="margin:0 0 14px;padding-left:20px;font-size:15px;line-height:1.6;color:#374151;">${items.join('')}</ul>`
  const ol = (items) => `<ol style="margin:0 0 14px;padding-left:20px;font-size:15px;line-height:1.6;color:#374151;">${items.join('')}</ol>`
  const body = `${p(`Hi ${esc(w.hi)},`)}
${p(self ? 'JFP has moved to our new booking system, and you already have an account. Please sign in today. It takes about a minute.' : `JFP has moved to our new booking system, and ${esc(who)} already ${names.length > 1 ? 'have' : 'has'} an account. Please sign in today. It takes about a minute.`)}
${p('<b>How to sign in</b>')}
${ol([li(`Go to ${link('jonerfootball.com/jfp-account', signInUrl)}`), li(`Enter <b>${esc(email || 'the email this message came to')}</b>. This is the email we have on file for you, so please use this one and ${self ? 'your sessions' : 'your players'} will be there waiting.`), li('We email you a 6 digit code. Type it in. There is no password.')])}
${p('<b>In your account you will find</b>')}
${p('<b>When you sign in, in this order</b>')}
${ol([li(`${self ? 'Sign your waiver' : 'Sign the player waiver'}${needsWaiver ? ' (<b>still to sign</b>)' : ', if it still needs signing'}`), li(`Pay anything left for ${esc(term)}, by card, Apple Pay, Google Pay or Afterpay${self ? '. Session by session? Pay for your sessions there too' : ''}.`), li(self ? 'Check your player details: club, position and who to call in an emergency' : 'Check the player details: club, position and who to call in an emergency')])}
${p('<b>In your account you will also find</b>')}
${list([li(self ? `Your group, time, location and every ${esc(term)} date` : `${esc(who)}'s group, time, location and every ${esc(term)} date`), li(`${esc(term)} information`), li('A "Can\'t make a session" button to let us know')])}
${p('<b>Already paid, or arranged payment with Ligia? Please ignore the payment part.</b>')}
${button('Sign in to your account', signInUrl)}
${p('Booked with a different email? Reply to this email and Ligia will link it for you.')}
${p('See you on the pitch,<br>Lee')}`
  return { subject: self ? 'Action needed: sign in to your JFP account' : `Action needed: sign in to ${who}'s JFP account`, html: shell({ preheader: 'Your sessions, term info and payments, all in one place. Takes a minute.', heading: 'Your JFP account', body }) }
}
export async function sendAccountInvite({ to, parentName, ...rest }) {
  const { subject, html } = accountInvite({ parentName, ...rest })
  const w = contactWords({ self: rest.self, players: (rest.players || []).map((x) => x.name), parent: parentName })
  return send({ to: [{ email: to, name: w.toName }], subject, html, replyTo: 'ligia@jonerfootball.com', kind: rest.money === false ? 'account invite' : 'account invite with payment' })
}

// The Contact us form on the family pages: straight to Ligia, reply goes
// to the family.
export async function sendContactMessage({ name, email, phone, message, page }) {
  const body = `${rows([['From', esc(name)], ['Email', esc(email)], ['Mobile', esc(phone || 'Not given')], ['Page', esc(page || '')]])}
${p(esc(message).replace(/\n/g, '<br>'))}`
  return send({ to: [{ email: 'ligia@jonerfootball.com', name: 'Ligia' }], subject: `JFP contact form: ${name}`, html: shell({ heading: 'New message from the JFP page', body }), replyTo: email })
}

// Book extra sessions / Book game analysis from My account (Lee, 14 Oct
// 2026): straight to Lee and Ligia, reply goes to the family.
export async function sendExtraRequestAlert({ rec, config }) {
  const analysis = rec.kind === 'analysis'
  const list = [
    ['Player', esc(rec.player)],
    ...(analysis
      ? [['Match', esc(rec.matchDate ? dateLabel(rec.matchDate) : 'Date not given')], ['Video', rec.video ? link(rec.video.slice(0, 80), rec.video) : 'No link yet'], ['Price', esc(rec.priceLabel || 'Not set (the page says "Ask us")')]]
      : [['Type', esc(rec.type)], ['Days', esc(rec.days.join(', ') || 'Any')], ['Times', esc(rec.times.join(', ') || 'Any')], ['Coach', esc(rec.coach || 'No preference')]]),
    ['Notes', rec.notes ? esc(rec.notes).replace(/\r?\n/g, '<br>') : 'None'],
    ['From', esc(rec.parentName || 'Not given')], ['Email', esc(rec.email)], ...(rec.phone ? [['Mobile', esc(rec.phone)]] : []),
  ]
  const what = analysis ? 'Game analysis' : 'Extra session'
  // Game analysis enquiries also go to Dean, who does the analysis (Lee, 15 Oct 2026).
  const dean = analysis ? (config.coaches || []).find((c) => c.id === 'dean')?.email : ''
  const to = [...staffTo(config), ...(dean && !staffTo(config).some((x) => x.email === dean.toLowerCase()) ? [{ email: dean.toLowerCase() }] : [])]
  const body = `${p(analysis ? 'A family has asked about game analysis from My account.' : 'A family has asked for an extra session from My account.')}${rows(list)}${p('Reply to this email to answer them. Every request is listed under Requests in the JFP portal, where you can mark it done.')}`
  return send({ to, subject: `${what} ${analysis ? 'enquiry' : 'request'}: ${rec.player}`, html: shell({ preheader: `${what}: ${rec.player}`, heading: `${what} request`, body }), replyTo: rec.email, kind: analysis ? 'game analysis request' : 'extra session request' })
}

// The kit is compulsory, so every email that sets up a place says so, in the
// same words. (Lee, 8 Oct 2026: it was missing from the payment-link email.)
const kitLine = (config) => (config.kitUrl
  ? p(`<b>The JF playing kit is required for every JFP player (${esc(config.kitPriceLabel || 'A$60')}).</b> If you have not ordered it yet, ${link('order it from BE Teamsport', config.kitUrl)} before the first session.`)
  : '')
// Families do not have a password and often think they need to make one.
const howToSignIn = (to, self = false) => p(`<b>How to sign in:</b> press the button, enter <b>${esc(to)}</b>, and we email you a six digit code. Type the code in and you are in. There is no password to set up or remember. Your account keeps every booking, so you can add another session${self ? '' : ' or another child'} from the same place.`)

// group can be null: a player added on the Players tab with no session yet.
export async function sendFamilyInvite({ to, parentName, playerNames, group, config, url, needs, amountCents, trial = false, startDate = '', product = '', self = false }) {
  const w = contactWords({ self, players: playerNames, parent: parentName })
  // The order they find on sign in (Lee, 13 Oct 2026): 1 waiver, 2 pay,
  // 3 player details. needs.sessions: session by session, paid from the
  // account; needs.owingCents: a term fee with no link, paid from the account.
  const todo = []
  if (needs.waiver) todo.push(self ? 'sign your waiver' : 'sign the waiver')
  if (needs.payment) todo.push(`pay ${formatAud(amountCents)}`)
  else if (needs.owingCents > 0) todo.push(`pay ${formatAud(needs.owingCents)}`)
  else if (needs.sessions) todo.push(self ? 'pay for your sessions' : 'pay for the sessions')
  if (needs.details) todo.push(self ? 'add your details' : 'add the player details')
  const list = todo.length ? `${todo.slice(0, -1).join(', ')}${todo.length > 1 ? ' and ' : ''}${todo.at(-1)}` : ''
  const what = trial && group ? `a trial session in ${esc(group.day)} ${esc(group.time)}` : `a place in ${esc(config.term)}`
  const intro = self ? `Hi ${esc(w.hi)}, you have ${what}.` : `Hi ${esc(w.hi)}, ${esc(playerNames.join(' and '))} ${playerNames.length > 1 ? 'have' : 'has'} ${what}.`
  const body = `${p(intro)}
${group ? rows([...(trial && startDate ? [['Trial', esc(dateLabel(startDate))]] : []), ...groupRows(config, group, trial ? '' : startDate, product)]) : p('We will confirm the group, day and time with you. Everything is in your account as soon as it is set.')}
${list ? p(`To finish, sign in with this email address and ${esc(list)}. It takes a couple of minutes.${needs.payment || needs.owingCents > 0 ? ' The place is locked in once it is paid.' : ''}`) : p('Sign in with this email address to see the booking.')}
${button(needs.payment || needs.owingCents > 0 || needs.sessions ? 'Sign in and finish' : 'View the booking', url)}
${howToSignIn(to, self)}
${kitLine(config)}`
  const subject = trial ? (self ? 'Your JFP trial' : `${playerNames.join(' and ')}: your JFP trial`) : (self ? `Your ${config.term} place` : `${playerNames.join(' and ')}: your ${config.term} place`)
  return send({ to: [{ email: to, name: w.toName }], subject, html: shell({ preheader: group ? `${group.day} ${group.time}` : config.term, heading: trial ? 'Your JFP trial' : 'Your JFP place', body }), kind: trial ? 'trial invite' : needs.payment ? 'place and payment link' : 'place invite' })
}

// Add a family (round 2, Lee 14 Oct 2026): one email for every child added
// together. Each child with their group (time and place, never a coach) and
// what they pay, then the steps in the order the account shows them: a waiver
// for each child, one payment for everyone, then each child's details.
// children: [{ name, where, pay, link (on the one payment), waiver (still to sign), sessions }]
export function familyWelcome({ to, parentName, children, config, url, amountCents = 0 }) {
  const names = children.map((c) => c.name)
  const w = contactWords({ self: false, players: names, parent: parentName })
  const firsts = children.map((c) => String(c.name).trim().split(/\s+/)[0])
  const both = (list) => (list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list.at(-1)}` : list[0] || '')
  const li = (html) => `<li style="margin:0 0 6px;">${html}</li>`
  const unsigned = children.filter((c) => c.waiver).map((c) => String(c.name).trim().split(/\s+/)[0])
  const steps = []
  if (unsigned.length) steps.push(li(`Sign the waiver for ${unsigned.length > 1 ? 'each child' : 'your child'}: ${esc(both(unsigned))}. One sheet covers them all and takes a couple of minutes.`))
  if (amountCents > 0) steps.push(li(`Pay <b>${esc(formatAud(amountCents))}</b> in one payment for ${esc(both(children.filter((c) => c.link).map((c) => String(c.name).trim().split(/\s+/)[0])))}. Card, Apple Pay or Afterpay. The places are locked in once it is paid.`))
  if (children.some((c) => c.sessions)) steps.push(li(`Session by session: pay ahead for ${esc(both(children.filter((c) => c.sessions).map((c) => String(c.name).trim().split(/\s+/)[0])))} in your account, or we bill the sessions after they happen.`))
  steps.push(li(`Check ${children.length > 1 ? "each child's" : 'the player'} details: club, position and who to call in an emergency.`))
  const body = `${p(`Hi ${esc(w.hi)}, ${esc(both(firsts))} ${children.length > 1 ? 'are' : 'is'} booked in with Joner Football for ${esc(config.term)}.`)}
${rows([...children.map((c) => [esc(c.name), `${esc(c.where)}<br><span style="color:#6B7280;font-weight:400;font-size:13px;">${esc(c.pay)}</span>`]), ...(amountCents > 0 ? [['Total to pay', esc(formatAud(amountCents))]] : [])])}
${p(`<b>One account for the family.</b> Sign in with this email address and you will see ${children.length > 1 ? 'every child' : 'your child'}, their dates and your payments.`)}
${p('<b>When you sign in, in this order</b>')}
<ol style="margin:0 0 14px;padding-left:20px;font-size:15px;line-height:1.6;color:#374151;">${steps.join('')}</ol>
${button(amountCents > 0 ? 'Sign in and finish' : 'Sign in to your account', url)}
${howToSignIn(to)}
${kitLine(config)}`
  const subject = `${both(firsts)}: your ${config.term} ${children.length > 1 ? 'places' : 'place'}`
  return { subject, html: shell({ preheader: amountCents > 0 ? `${formatAud(amountCents)} for ${children.length} player${children.length > 1 ? 's' : ''}` : config.term, heading: children.length > 1 ? 'Your family is booked in' : 'Your JFP place', body }) }
}
export async function sendFamilyWelcome({ to, parentName, children, ...rest }) {
  const { subject, html } = familyWelcome({ to, parentName, children, ...rest })
  const w = contactWords({ self: false, players: children.map((c) => c.name), parent: parentName })
  return send({ to: [{ email: to, name: w.toName }], subject, html, replyTo: 'ligia@jonerfootball.com', kind: 'family add' })
}

// One invoice for the whole family: each place and its price, one total.
export async function sendFamilyInvoice({ to, parentName, places, config, url, amountCents, needWaiver = false, sessions = false, self = false }) {
  const names = [...new Set(places.map((x) => x.name))]
  const w = contactWords({ self, players: names, parent: parentName })
  const intro = self
    ? (sessions ? `Hi ${esc(w.hi)}, here are your JFP sessions to pay.` : `Hi ${esc(w.hi)}, here is ${esc(config.term)} in one payment.`)
    : (sessions ? `Hi ${esc(w.hi)}, here are ${esc(names.join(' and '))}'s JFP sessions to pay.` : `Hi ${esc(w.hi)}, here is ${esc(config.term)} for ${esc(names.join(' and '))} in one payment.`)
  const body = `${p(intro)}
${rows([...places.map((x) => [esc(x.name), `${esc(x.label)}<br><span style="color:#6B7280;font-weight:400;font-size:13px;">${esc(formatAud(x.owingCents))}${x.paidCents ? ` (${esc(formatAud(x.feeCents))}, ${esc(formatAud(x.paidCents))} already paid)` : ''}</span>`]), ['Total to pay', esc(formatAud(amountCents))]])}
${p(`Sign in with this email address to ${needWaiver ? (self ? 'sign your waiver and ' : 'sign the waiver and ') : ''}pay. ${sessions ? 'Card or Apple Pay.' : 'Card, Apple Pay or Afterpay. The places are locked in once it is paid.'}`)}
${button('Sign in and pay', url)}
${howToSignIn(to, self)}
${kitLine(config)}`
  const subject = self ? (sessions ? 'Your JFP sessions invoice' : `Your ${config.term} invoice`) : (sessions ? `${names.join(' and ')}: JFP sessions invoice` : `${names.join(' and ')}: your ${config.term} invoice`)
  return send({ to: [{ email: to, name: w.toName }], subject, html: shell({ preheader: `${formatAud(amountCents)} for ${names.length} player${names.length > 1 ? 's' : ''}`, heading: sessions ? 'Your sessions invoice' : self ? 'Your invoice' : 'Your family invoice', body }), kind: sessions ? 'sessions invoice' : 'family invoice' })
}

// After a good trial: the rest of the term, with the trial fee taken off.
export async function sendTermOffered({ to, parentName, playerNames, group, config, url, amountCents, startDate, creditCents = 0, self = false }) {
  const w = contactWords({ self, players: playerNames, parent: parentName })
  const body = `${p(self ? `Hi ${esc(w.hi)}. Great trial. We would love you to join ${esc(group.day)} ${esc(group.time)} for the rest of ${esc(config.term)}.` : `Hi ${esc(w.hi)}. Great trial. We would love ${esc(playerNames.join(' and '))} to join ${esc(group.day)} ${esc(group.time)} for the rest of ${esc(config.term)}.`)}
${rows([...groupRows(config, group, startDate), ['To pay', `${esc(formatAud(amountCents))}${creditCents ? `<br><span style="color:#6B7280;font-weight:400;font-size:13px;">The ${esc(formatAud(creditCents))} trial is already taken off.</span>` : ''}`]])}
${p('Sign in with this email address to pay and lock in the place. Card, Apple Pay or Afterpay.')}
${button('Sign in and pay', url)}`
  return send({ to: [{ email: to, name: w.toName }], subject: self ? `The rest of ${config.term}` : `${playerNames.join(' and ')}: the rest of ${config.term}`, html: shell({ heading: 'Your place for the term', body }), kind: 'term after trial' })
}

export async function sendPaymentReceipt({ payreq, group, config, siteUrl }) {
  if (payreq.next) {
    const held = payreq.next.choice === 'hold'
    const body = `${p(`Thanks ${esc(payreq.parentName || '')}. ${esc(payreq.playerNames.join(' and '))}'s place for ${esc(payreq.next.term)} is ${held ? 'held' : 'paid and locked in'}.`)}
${rows([...(group ? [['Group', `${esc(group.day)} ${esc(group.time)}, ${esc(locationFor(config, group.location).name)}`]] : []), ['Paid', esc(formatAud(payreq.paidCents ?? payreq.amountCents))], ...(held ? [['Still to pay', `${esc(formatAud(Math.max(0, payreq.next.fullCents - (payreq.paidCents ?? payreq.amountCents))))} before ${esc(payreq.next.term)} starts`]] : []), ['Reference', esc(payreq.id)]])}
${held ? p('The hold fee is non-refundable and comes off the term fee. When the new timetable is out we will confirm the group, and you pay the rest in My account.') : ''}
${siteUrl ? button('Open My account', `${siteUrl}/jfp-account/`) : ''}`
    return send({ to: [{ email: payreq.email, name: payreq.parentName }], subject: `${payreq.playerNames.join(' and ')}: ${payreq.next.term} ${held ? 'place held' : 'paid'}`, html: shell({ heading: held ? 'Your place is held' : 'You are locked in', body }), kind: 'next term receipt' })
  }
  const trial = payreq.reason === 'trial'
  const ics = group ? buildIcs({ uid: payreq.id, group, config, title: trial ? `JFP trial ${group.day} ${group.time}` : `JFP ${group.day} ${group.time}`, fromIso: payreq.startDate || '', only: trial ? payreq.trialDate || '' : '', product: payreq.product || '' }) : ''
  const w = contactWords({ self: payreq.ownContact === true, players: payreq.playerNames, parent: payreq.parentName })
  const body = `${p(w.self ? `Thanks ${esc(w.hi)}. We have your payment.` : `Thanks ${esc(payreq.parentName || '')}. We have your payment for ${esc(payreq.playerNames.join(' and '))}.`)}
${rows([...(trial && payreq.trialDate ? [['Trial', esc(dateLabel(payreq.trialDate))]] : []), ...(group ? groupRows(config, group, trial ? '' : payreq.startDate || '', payreq.product || '').filter(([k]) => !(trial && k === 'Dates')) : []), ['Paid', esc(formatAud(payreq.paidCents ?? payreq.amountCents))], ['Reference', esc(payreq.id)]])}
${config.kitUrl ? p(`<b>Required:</b> every JFP player trains in the JF playing kit (${config.kitPriceLabel || 'A$60'}). If you have not ordered it yet, ${link('order it from BE Teamsport', config.kitUrl)} before the first session.`) : ''}
${siteUrl ? button('Open My account', `${siteUrl}/jfp-account/`) : ''}`
  return send({
    to: [{ email: payreq.email, name: w.self ? w.toName : payreq.parentName }],
    subject: w.self ? 'Payment received' : `Payment received: ${payreq.playerNames.join(' and ')}`,
    html: shell({ heading: 'Payment received', body }),
    attachment: ics ? [{ name: 'jfp-term.ics', content: Buffer.from(ics).toString('base64') }] : undefined,
    kind: 'payment receipt',
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

// ---------- quick payment links (Lee, 13 Oct 2026) ----------

// Sent only when staff tap "Email it" on the link.
export async function sendQuickLinkEmail({ to, parentName = '', forText, amountCents, url, expiresAt = '', afterpay = true }) {
  const until = expiresAt ? new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', day: 'numeric', month: 'long' }).format(new Date(expiresAt)) : ''
  const body = `${p(`Hi ${esc(parentName || 'there')}, here is your Joner Football payment link.`)}
${rows([['For', esc(forText)], ['To pay', esc(formatAud(amountCents))]])}
${button(`Pay ${formatAud(amountCents)}`, url)}
${p(`${afterpay ? 'Card, Apple Pay or Afterpay.' : 'Card or Apple Pay.'}${until ? ` The link works until ${esc(until)}.` : ''}`)}`
  return send({ to: [{ email: to, name: parentName || undefined }], subject: `Joner Football: ${forText}`, html: shell({ preheader: `${formatAud(amountCents)} for ${forText}`, heading: 'Your payment link', body }), kind: 'quick payment link' })
}

// A quick link with no player was paid: staff match it on Money.
const PROG_LABEL = { jfp: 'JFP', pro: 'Pro sessions', extra: 'Extra sessions', juniors: 'Joners Juniors', holiday: 'Holiday training', other: 'Other' }
const WHERE = { jfp: 'Money > JFP, Stripe payments not matched to a player', extra: 'Money > Extra sessions, Quick links to check', pro: 'Payment links, Pro sessions payments to check', juniors: 'Money > Joners Juniors', holiday: 'Money > Holiday training', other: 'Payment links, Other payments to check' }
export async function sendQuickPaidAlert({ payreq, config }) {
  const body = `${p(`A quick payment link was paid. No player was named on it, so it is waiting on ${esc(WHERE[payreq.programme] || WHERE.other)}.`)}${rows([
    ['For', esc(payreq.forText)],
    ['Program', esc(PROG_LABEL[payreq.programme] || payreq.programme)],
    ['Paid', esc(formatAud(payreq.paidCents ?? payreq.amountCents))],
    ['Paid by', `${esc(payreq.payerName || '')} ${esc(payreq.payerEmail || payreq.email || '')}`.trim() || 'Not known'],
    ['Stripe fee', payreq.stripeFeeCents != null ? esc(formatAud(payreq.stripeFeeCents)) : 'Pending'],
    ['Reference', esc(payreq.id)],
  ])}`
  return send({ to: staffTo(config), subject: `Quick link paid: ${payreq.forText}, ${formatAud(payreq.paidCents ?? payreq.amountCents)}`, html: shell({ heading: 'Payment received', body }), ...(payreq.payerEmail ? { replyTo: payreq.payerEmail } : {}) })
}

// ---------- payments that need a person ----------

const ATTENTION = {
  'roster-pending': 'A family has paid, but Airtable did not save their place, so they have NOT been told they are booked in. The system keeps retrying through Stripe. If this is still flagged in an hour, open Payments in the JFP portal and press Repair, or add the player by hand.',
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
export async function sendNextTermInvite({ to, parentName, players, config, url, holdLabel, fullLabel, self = false }) {
  const w = contactWords({ self, players: players.map((x) => x.name), parent: parentName })
  const body = `${p(`Hi ${esc(w.hi)}. ${esc(config.term)} is nearly done, and ${esc(config.nextTerm.name)} places open to ${self ? 'current players' : 'current families'} first.`)}
${rows(players.map((x) => [x.name, esc(x.group)]))}
${p(`Know you can commit? <b>Pay ${esc(fullLabel)}</b> for the term and the place is locked in.`)}
${p(`Not sure of next term's schedule yet? <b>Hold your place for ${esc(holdLabel)}</b>. It is non-refundable and comes off the term fee.`)}
${p('Not coming back? Tell us in the same place, and we will offer the spot to someone else.')}
${button('Choose in My account', url)}`
  return send({ to: [{ email: to, name: w.toName }], subject: `Keep your place for ${config.nextTerm.name}`, html: shell({ heading: `${config.nextTerm.name}: keep your place`, body }), kind: 'next term invite' })
}

const KIND_WORD = { application: 'application', waitlist: 'waitlist request', enquiry: 'enquiry' }

export async function sendTrialOffered({ request, group, config, url, amountCents, trialDate }) {
  const body = `${p(`Thanks ${esc(request.parentName)}. We would like ${esc(request.players.map((x) => x.name).join(' and '))} to come to a trial in ${esc(group.day)} ${esc(group.time)}.`)}
${rows([['Trial', esc(dateLabel(trialDate))], ...groupRows(config, group).filter(([k]) => k !== 'Dates'), ['To pay', esc(formatAud(amountCents))]])}
${p('Sign in with this email address to pay for the trial and it is booked. After the session the coach will let you know, and if it is a good fit you pay for the rest of the term in My account, with the trial fee taken off.')}
${button('Sign in and book the trial', url)}`
  return send({ to: [{ email: request.email, name: request.parentName }], subject: `Trial: ${group.day} ${group.time}, ${dateLabel(trialDate)}`, html: shell({ heading: 'Your trial session', body }), kind: 'trial offered' })
}

export async function sendRequestReceived({ request, group, config }) {
  const names = esc(request.players.map((x) => x.name).join(' and '))
  const line = request.kind === 'waitlist'
    ? `You are on the waitlist for ${esc(group.day)} ${esc(group.time)}. If a place opens we will email you a link to take it.`
    : request.kind === 'enquiry'
      ? `Thanks for your enquiry about ${esc(group.label || '1 to 1')} coaching. Lee or Ligia will be in touch.`
      : `We have your application for ${names} to join ${esc(group.day)} ${esc(group.time)}. We reply within 48 hours: either a place for the term, or a trial session first.`
  const body = `${p(`Thanks ${esc(request.parentName)}.`)}${p(line)}${rows(groupRows(config, group))}`
  return send({ to: [{ email: request.email, name: request.parentName }], subject: `Received: your JFP ${KIND_WORD[request.kind] || 'request'}`, html: shell({ heading: 'We have your request', body }), kind: 'request received' })
}

// Several sessions in one go (Lee, 14 Oct 2026): one email that lists them all.
// paying: Book now groups the family pays for next, one at a time on Stripe.
function batchList(config, items) {
  return `<ul style="margin:0 0 14px;padding-left:20px">${items.map(([word, g]) => `<li style="margin:6px 0;font-size:15px;line-height:1.5;color:#374151;"><b>${esc(g.day)} ${esc(g.time)}, ${esc(locationFor(config, g.location).name)}</b><br><span style="color:#6B7280;font-size:13px;">${esc(word)}</span></li>`).join('')}</ul>`
}
const BATCH_WORD = { application: 'Application: we reply within 48 hours', waitlist: 'Waitlist: we email you if a place opens' }

export async function sendBatchReceived({ requests, groups, paying = [], config }) {
  const first = requests[0]
  const names = esc(first.players.map((x) => x.name).join(' and '))
  const n = requests.length + paying.length
  const body = `${p(`Thanks ${esc(first.parentName)}.`)}${p(`We have ${names} down for ${n} sessions:`)}
${batchList(config, [...requests.map((r, i) => [BATCH_WORD[r.kind] || r.kind, groups[i]]), ...paying.map((g) => ['Book now: your place is confirmed by its own email once it is paid', g])])}
${requests.some((r) => r.kind === 'application') ? p('Each application is looked at on its own. For each one we reply within 48 hours with a place for the term, a trial session first, or a group that suits better.') : ''}
${p('You can see every request any time in My account.')}`
  return send({ to: [{ email: first.email, name: first.parentName }], subject: `Received: your JFP requests for ${n} sessions`, html: shell({ heading: 'We have your requests', body }), kind: 'request received' })
}

export async function sendBatchAlert({ requests, groups, paying = [], config }) {
  const first = requests[0]
  const n = requests.length + paying.length
  const body = `${p(`One family picked ${n} sessions in one go. Each request is on its own card in Requests, grouped together.`)}
${batchList(config, [...requests.map((r, i) => [KIND_WORD[r.kind] || r.kind, groups[i]]), ...paying.map((g) => ['Booking and paying online (separate payment)', g])])}
${rows([
    ['Players', first.players.map((x) => `${esc(x.name)}${x.age != null ? ` (${esc(x.age)})` : ''}`).join(', ')],
    ...Object.entries(first.answers || {}).map(([k, v]) => [ANSWER_LABELS[k] || k, esc(v)]),
    ...(first.answers?.club ? [] : [['Club', esc(first.club || 'Not given')]]),
    ['Parent', esc(first.parentName)],
    ['Email', esc(first.email)],
    ['Mobile', esc(first.mobile)],
    ['Message', esc(first.message || 'None')],
  ])}${p('Review them in the JFP portal.')}`
  return send({ to: staffTo(config), subject: `JFP ${n} sessions: ${first.players.map((x) => x.name).join(', ')}`, html: shell({ heading: `New requests for ${n} sessions`, body }), replyTo: first.email })
}

// A kind no: this group is not the right fit, maybe another one is.
export async function sendDeclined({ request, group, config, message, suggestions = [], siteUrl }) {
  const names = esc(request.players.map((x) => x.name).join(' and '))
  const body = `${p(`Thanks for applying, ${esc(request.parentName)}.`)}
${p(`Our coaches have looked at ${names}'s application for ${esc(group.day)} ${esc(group.time)}, and it is not the right group for ${request.players.length > 1 ? 'them' : 'this player'} this term. We keep every group at one level so each player is challenged, and we would rather say so now.`)}
${message ? p(esc(message)) : ''}
${suggestions.length ? `${p(suggestions.length === 1 ? 'A group we think would suit:' : 'Groups we think would suit:')}<ul style="margin:0 0 14px;padding-left:20px">${suggestions.map((s) => `<li style="margin:4px 0"><b>${esc(s.day)} ${esc(s.time)}, ${esc(locationFor(config, s.location).name)}</b></li>`).join('')}</ul>${p('Apply on the timetable, or reply to this email.')}` : p('Reply to this email if you would like to talk about another group or 1 to 1 coaching.')}
${siteUrl ? button('See the timetable', `${siteUrl}/jfp-booking/`) : ''}`
  return send({ to: [{ email: request.email, name: request.parentName }], subject: `Your JFP application: ${group.day} ${group.time}`, html: shell({ heading: 'About your application', body }), kind: 'application declined' })
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
  return send({ to: [{ email: request.email, name: request.parentName }], subject: `A place for you: ${group.day} ${group.time}`, html: shell({ heading: 'Your place is ready', body }), kind: 'place offered' })
}

// ---------- a family cannot make a session ----------

const LATE_WORDS = { 'very-late': 'VERY LATE NOTICE (under 2 hours)', late: 'LATE NOTICE (under 24 hours)' }

function cancelBody(rec, { forStaff }) {
  const withdrawn = rec.event === 'withdrawn'
  const late = LATE_WORDS[rec.noticeLevel]
  const intro = withdrawn
    ? p(rec.self ? `${esc(rec.player)} has taken the cancellation back, so they are coming to this session after all.` : `${esc(rec.player)}'s family has taken the cancellation back, so ${esc(rec.player)} is coming to this session after all.`)
    : p(rec.self ? `${esc(rec.player)} has told us they cannot make a session.` : `A family has told us ${esc(rec.player)} cannot make a session.`)
  const lateLine = !withdrawn && late ? `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#B42318;"><b>${esc(late)}.</b> ${rec.self ? 'They' : 'The family'} told us ${esc(rec.noticeLabel.replace(/^late: /, ''))} before the session starts.</p>` : ''
  const note = rec.note ? esc(rec.note).replace(/\r?\n/g, '<br>') : 'None'
  const list = [
    ['Player', esc(rec.player)],
    ['Session', `${esc(rec.day)} ${esc(rec.time)}, ${esc(rec.location)}`],
    ['Date', esc(dateLabel(rec.date))],
    ...(withdrawn ? [] : [['Reason', esc(rec.reason)], ['Note', note], ['Notice given', esc(rec.noticeLabel)]]),
    ...(forStaff ? [[rec.self ? 'Contact' : 'Parent', rec.self ? 'The player (own contact)' : esc(rec.parentName || '')], ['Email', esc(rec.email)], ['Coaches', esc((rec.coachNames || []).join(', ') || 'No coach set')]] : []),
  ]
  return `${intro}${lateLine}${rows(list)}${forStaff ? p('You can see every cancellation, and how much notice families give, under Cancellations in the JFP portal.') : ''}`
}

function cancelSubject(rec) {
  const base = `${rec.player}, ${rec.day} ${rec.time}, ${dateLabel(rec.date)}`
  if (rec.event === 'withdrawn') return `Back on: ${base}`
  const tag = rec.noticeLevel === 'very-late' ? 'VERY LATE: ' : rec.noticeLevel === 'late' ? 'LATE NOTICE: ' : ''
  return `${tag}Can't make it: ${base}`
}

// Coach alerts (Lee, 14 Oct 2026): a new player in your group, and a register
// not filled in. The same words go by text (see _jfp-coach-alerts.js).
export async function sendCoachNotice({ coach, subject, heading, paras = [], list = [], cta = null, kind = 'coach alert' }) {
  if (!coach?.email) return null
  const body = `${paras.map((x) => p(esc(x))).join('\n')}
${list.length ? rows(list.map(([k, v]) => [k, esc(v)])) : ''}
${cta ? button(cta.label, cta.url) : ''}`
  return send({ to: [{ email: coach.email, name: `Coach ${coach.name}` }], subject, html: shell({ preheader: subject, heading, body }), replyTo: 'ligia@jonerfootball.com', kind })
}

export async function sendCancelCoachAlert({ rec, coach }) {
  if (!coach?.email) return false
  const heading = rec.event === 'withdrawn' ? 'Cancellation withdrawn' : 'A player cannot make a session'
  await send({ to: [{ email: coach.email, name: `Coach ${coach.name}` }], subject: cancelSubject(rec), html: shell({ preheader: `${rec.player}, ${dateLabel(rec.date)}`, heading, body: cancelBody(rec, { forStaff: false }) }), kind: 'cancel to coach' })
  return true
}

export async function sendCancelStaffAlert({ rec, config }) {
  const heading = rec.event === 'withdrawn' ? 'Cancellation withdrawn' : 'A player cannot make a session'
  await send({ to: staffTo(config), subject: cancelSubject(rec), html: shell({ preheader: `${rec.player}, ${dateLabel(rec.date)}`, heading, body: cancelBody(rec, { forStaff: true }) }), replyTo: rec.email, kind: 'cancel to staff' })
  return true
}

// ---------- player charges and invoices (14 Oct 2026) ----------

// A charge paid (an extra session, video analysis, an invoice that is not a term fee).
export async function sendChargeReceipt({ payreq, config, siteUrl = '' }) {
  const w = contactWords({ self: payreq.ownContact === true, players: payreq.playerNames, parent: payreq.parentName })
  const body = `${p(`Thanks ${esc(w.self ? w.hi : payreq.parentName || 'there')}. We have your payment.`)}
${rows([['For', esc(payreq.groupLabel || payreq.productLabel || 'Joner Football')], ...(w.self ? [] : [['Player', esc((payreq.playerNames || []).join(' and '))]]), ['Paid', esc(formatAud(payreq.paidCents ?? payreq.amountCents))], ['Reference', esc(payreq.invoiceId || payreq.id)]])}
${siteUrl ? button('Open My account', `${siteUrl}/jfp-account/`) : ''}`
  return send({ to: [{ email: payreq.email, name: w.self ? w.toName : payreq.parentName }], subject: `Payment received: ${payreq.groupLabel || 'Joner Football'}`, html: shell({ heading: 'Payment received', body }), kind: 'charge receipt' })
}

// The invoice email: what it is for, the total with GST, and the link to the
// invoice page (pay by card there, or by bank transfer with the reference).
export function invoiceEmail({ view, url }) {
  const lines = view.lines.map((l) => [`${esc(l.description)}${l.qty > 1 ? ` x ${l.qty}` : ''}`, esc(l.totalLabel)])
  const body = `${p(`Hi ${esc(view.billTo.name || 'there')}, here is your invoice from Joner Football${view.players.length ? ` for ${esc(view.players.join(' and '))}` : ''}.`)}
${rows([['Invoice', esc(view.number)], ...lines, ['Total', `${esc(view.totalLabel)}<br><span style="color:#6B7280;font-weight:400;font-size:13px;">Includes GST of ${esc(view.gstLabel)}</span>`], ...(view.paidCents ? [['Paid so far', esc(view.paidLabel)], ['To pay', esc(view.owingLabel)]] : []), ...(view.dueLabel ? [['Due', esc(view.dueLabel)]] : [])])}
${button('View and pay the invoice', url)}
${p(`Pay by card on the invoice page${view.bank ? `, or by bank transfer to ${esc(view.bank.accountName)}, BSB ${esc(view.bank.bsb)}, account ${esc(view.bank.accountNumber)}, with the reference <b>${esc(view.bank.reference)}</b>` : ''}. You can download a PDF from the same page.`)}
${view.notes ? p(esc(view.notes)) : ''}`
  return { subject: `Invoice ${view.number} from Joner Football`, html: shell({ preheader: `${view.owingLabel} to pay${view.dueLabel ? `, due ${view.dueLabel}` : ''}`, heading: `Invoice ${view.number}`, body }) }
}
export async function sendInvoiceEmail({ to, name = '', view, url }) {
  const m = invoiceEmail({ view, url })
  return send({ to: [{ email: to, name }], subject: m.subject, html: m.html, kind: 'invoice' })
}
// Paid by card: the receipt says the invoice is paid (or what is left).
export async function sendInvoiceReceipt({ payreq, view, url }) {
  const body = `${p(`Thanks ${esc(view.billTo.name || 'there')}. We have your payment for invoice ${esc(view.number)}.`)}
${rows([['Paid', esc(formatAud(payreq.paidCents ?? payreq.amountCents))], ['Invoice total', esc(view.totalLabel)], ['Still to pay', esc(view.owingLabel)], ['Reference', esc(view.number)]])}
${url ? button('View the invoice', url) : ''}`
  return send({ to: [{ email: payreq.email, name: view.billTo.name }], subject: `Payment received: invoice ${view.number}`, html: shell({ heading: 'Payment received', body }), kind: 'invoice receipt' })
}

// ---------- saved card or bank account, auto-charge (claude/card-on-file, 14 Oct 2026) ----------
// A plain email to a family from api/_jfp-saved-pay.js: saved, removed, a
// session charged, a debit started, or a payment that did not go through.
export async function sendFamilyNotice({ to, name = '', subject, heading, paras = [], list = [], cta = null, kind = 'family notice', preheader = '' }) {
  const body = `${paras.map((x) => p(esc(x))).join('\n')}
${list.length ? rows(list.filter(([, v]) => v).map(([k, v]) => [k, esc(v)])) : ''}
${cta ? button(cta.label, cta.url) : ''}`
  return send({ to: [{ email: to, name }], subject, html: shell({ preheader: preheader || subject, heading, body }), kind })
}
