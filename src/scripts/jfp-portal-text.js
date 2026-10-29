// Text one family from the staff portal (Lee, 13 Oct 2026: "I really need
// text messages to be working in this portal"). Lee or Ligia see the exact
// words, can change them, and either send from the work number 0404 780 351
// (the office Mac sends it, 8am to 8pm) or open it in their own phone's
// Messages with everything filled in.
import { esc, api } from './jfp-common.js'

const tel = (m) => { const d = String(m || '').replace(/\D/g, ''); return d.startsWith('04') ? `+61${d.slice(1)}` : d.startsWith('614') ? `+${d}` : d }
// iPhones and Macs take sms:<number>&body=, everything else ?body=.
const smsHref = (mobile, text) => `sms:${tel(mobile)}${/iPhone|iPad|Macintosh/.test(navigator.userAgent) ? '&' : '?'}body=${encodeURIComponent(text)}`
// WhatsApp from Lee's or Ligia's own phone or laptop, words filled in (Lee,
// 29 Oct 2026: for families without iMessage, like Jaxon).
export const waHref = (mobile, text) => `https://wa.me/${tel(mobile).replace(/\D/g, '')}?text=${encodeURIComponent(text)}`
const STATE = {
  queued: ['grey', 'Waiting for the office Mac. It goes in the next minute (texts wait until 8am overnight).'],
  claimed: ['blue', 'The office Mac is sending it now.'],
  sent: ['green', 'Sent from 0404 780 351.'],
  delivered: ['green', 'Sent.'],
  failed: ['red', 'Not delivered. This number may not take iMessage: send it on WhatsApp.'],
  unknown: ['amber', 'The Mac could not confirm it. Check Messages on the office Mac before sending again.'],
  cancelled: ['amber', 'Not sent.'],
  expired: ['amber', 'Not sent in time.'],
}

// self: the player is their own contact, so the text goes to them (to: their name).
export function textComposer({ modal, toast, rowIds = [], requestId = '', parent = '', mobile = '', text = '', title = '', self = false, to = '', note = '' }) {
  const who = to || (self ? 'the player' : parent || 'the family')
  const box = modal(`${note ? `<div class="j-box j-box-green small" style="margin-bottom:12px">${note}</div>` : ''}<h2 style="margin-bottom:4px">${esc(title || (self ? `Text ${who}` : 'Text the family'))}</h2>
    <p class="muted small" style="margin-bottom:12px">To ${esc(who)}${mobile ? `, ${esc(mobile)}` : ''}. From the work number 0404 780 351, between 8am and 8pm. Check the words: this is exactly what they get.</p>
    <label class="j-field"><span>The text</span><textarea class="j-textarea" id="tx-text" rows="11" maxlength="640">${esc(text)}</textarea></label>
    <p class="muted small" id="tx-count" style="margin-top:-6px"></p>
    <div id="tx-status" style="margin-top:8px"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:12px">
      <button type="button" class="j-btn j-btn-line" data-close>Close</button>
      ${mobile ? '<a class="j-btn j-btn-line" id="tx-phone" href="#">Text from my phone</a><a class="j-btn j-btn-line" id="tx-wa" href="#" target="_blank" rel="noopener">WhatsApp</a>' : ''}
      <button type="button" class="j-btn j-btn-dark" id="tx-send">Send from 0404 780 351</button>
    </div>`, { wide: true })
  const area = box.querySelector('#tx-text')
  const wa = box.querySelector('#tx-wa')
  const count = () => { const n = area.value.length; box.querySelector('#tx-count').textContent = `${n} characters${n > 160 ? `, ${Math.ceil(n / 153)} texts` : ''}`; const a = box.querySelector('#tx-phone'); if (a) a.href = smsHref(mobile, area.value); if (wa) wa.href = waHref(mobile, area.value) }
  area.addEventListener('input', count)
  count()
  const ids = requestId ? { requestId } : { rowIds }
  // No iMessage on this number: WhatsApp becomes the main button.
  const preferWa = () => { if (!wa) return; wa.classList.replace('j-btn-line', 'j-btn-dark'); const send = box.querySelector('#tx-send'); send.classList.replace('j-btn-dark', 'j-btn-line') }
  wa?.addEventListener('click', () => { api('/api/jfp-messages', { action: 'whatsappOpened', ...ids, text: area.value }).catch(() => {}) })
  if (wa) api('/api/jfp-messages', { action: 'textHint', ...ids }).then((h) => {
    if (!h.ok || !h.data.noImessage || !document.body.contains(box)) return
    preferWa()
    status('amber', `<b>This number does not take iMessage.</b> A text from 0404 780 351 did not reach them${h.data.since ? ` on ${esc(new Date(h.data.since).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }))}` : ''}. Send it on WhatsApp instead.`)
  }).catch(() => {})
  // Always in view (Lee, 19 Oct 2026: "when i click, nothing happens"): on a
  // phone the status box can sit off screen above the buttons.
  const status = (cls, html) => { const s = box.querySelector('#tx-status'); s.innerHTML = `<div class="j-box j-box-${cls} small" role="status">${html}</div>`; s.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }) }
  box.querySelector('#tx-send').addEventListener('click', async (e) => {
    const btn = e.currentTarget
    btn.disabled = true
    btn.textContent = 'Sending'
    const r = await api('/api/jfp-messages', { action: 'quickText', ...(requestId ? { requestId } : { rowIds }), text: area.value })
    if (!r.ok) {
      btn.disabled = false
      btn.textContent = 'Send from 0404 780 351'
      status(r.data.code === 'route' ? 'amber' : 'red', esc(r.data.error || 'Could not send.'))
      toast(`Not sent: ${r.data.error || 'Could not send.'}`, 9000)
      return
    }
    btn.textContent = 'Sent to the office Mac'
    area.readOnly = true
    toast('Text on its way from 0404 780 351')
    status('grey', '<b>Waiting for the office Mac.</b> It goes in the next minute.')
    // Follow it until the office Mac reports back (about two minutes).
    const id = r.data.message.id
    for (let i = 0; i < 40 && document.body.contains(box); i += 1) {
      const g = await api('/api/jfp-messages', { action: 'get', id })
      const st = g.ok ? g.data.message.status : 'queued'
      const [cls, words] = STATE[st] || STATE.queued
      status(cls, `<b>${esc(g.data?.message?.statusLabel || st)}</b>. ${esc(words)}${st === 'queued' && !r.data.hoursOpen ? ' Outside 8am to 8pm, so it goes at 8am.' : ''}`)
      if (st === 'failed') preferWa()
      if (!['queued', 'claimed'].includes(st)) break
      await new Promise((res) => setTimeout(res, 3000))
    }
  })
  return box
}

// The words for the usual cases, in Lee's voice. Plain, no dashes.
// self: the player is their own contact, so "Hi Kai, you have a spot".
const firstName = (s) => String(s || '').trim().split(/\s+/)[0] || 'there'
// Laid out the way Lee writes them (14 Oct 2026): greeting on its own line,
// short paragraphs, the email they sign in with, signed "Joner".
const SIGN = 'Joner ⚽️'
const hiLine = (name) => `Hi ${firstName(name)},`
const signIn = (email) => (email ? `sign in using this email (the one we have on file): ${email}` : 'sign in with the email we have on file')
const lines = (...parts) => parts.filter(Boolean).join('\n\n')
// owed: sessions already had, on this link (Lee, 19 Oct 2026), e.g. "Wed 15 Oct".
export function payLinkText({ parent, player, when, place, url, self = false, starts = '', email = '', emailed = true, owed = '' }) {
  const from = starts ? `, starting ${starts}` : ''
  return lines(
    hiLine(self ? player : parent),
    `It's Lee from Joner Football. ${self ? 'You have' : `${firstName(player)} has`} a spot in our ${when} group at ${place}${from}.`,
    owed ? `To lock it in, ${signIn(email)}, sign the waiver and pay for the session${owed.includes(',') ? 's' : ''} already had (${owed}) here: ${url}\nYour account also shows the options for the sessions ahead.` : `To 100% lock it in, ${signIn(email)}, sign the waiver and pay here: ${url}`,
    `${emailed ? 'We have emailed you the same link. ' : ''}See you on the pitch!\n${SIGN}`,
  )
}
// After any add with no payment link: when they start and what to do next.
export function startText({ parent, player, when, place, starts = '', self = false, paid = false, email = '' }) {
  return lines(
    hiLine(self ? player : parent),
    `It's Lee from Joner Football. ${self ? 'You are' : `${firstName(player)} is`}${starts ? ` starting on ${starts}` : ''} in our ${when} group at ${place}.`,
    paid
      ? `You are all paid. Please ${signIn(email)} at jonerfootball.com/jfp-account and sign the waiver before the first session.`
      : `To 100% lock in the spot, ${signIn(email)} at jonerfootball.com/jfp-account, sign the waiver and pay.`,
    `See you on the pitch!\n${SIGN}`,
  )
}
export function trialText({ parent, player, when, where, self = false, email = '' }) {
  return lines(
    hiLine(self ? player : parent),
    `It's Lee from Joner Football. ${self ? 'You are' : `${firstName(player)} is`} booked in for a trial on ${when} at ${where}.`,
    `Before the session, please ${signIn(email)} at jonerfootball.com/jfp-account and sign the waiver.`,
    `See you on the pitch!\n${SIGN}`,
  )
}
export function helloText({ parent, player = '', self = false }) {
  return `${hiLine(self ? player : parent)}\n\nIt's Lee from Joner Football. \n\n${SIGN}`
}
// The account invite as a text, next to the email (Lee, 13 Oct 2026).
export function inviteText({ parent, player, email, self = false }) {
  return lines(
    hiLine(self ? player : parent),
    `It's Lee from Joner Football. ${self ? 'Your' : `${firstName(player)}'s`} JFP account is ready.`,
    `Go to jonerfootball.com/jfp-account and ${signIn(email)}. We send you a 6 digit code, no password needed.`,
    `We have emailed you the same. See you on the pitch!\n${SIGN}`,
  )
}
// Money > By family: the family invoice as a text (Lee, 15 Oct 2026: "the
// way it is in Messages should also be built into the money tab"). paidCents:
// what they have paid already, which the amount already takes off.
export function familyInvoiceText({ parent, players = [], amount, url = '', paidCents = 0, paidLabel = '', email = '', emailed = true, self = false }) {
  const names = players.map(firstName)
  const who = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0] || ''
  return lines(
    hiLine(self ? players[0] : parent),
    `It's Lee from Joner Football. Here is the invoice for ${self ? 'your place' : who}: ${amount}.${paidCents > 0 ? ` That already takes off the ${paidLabel} you have paid.` : ''}`,
    url ? `You can pay here: ${url}` : `To pay, ${signIn(email)} at jonerfootball.com/jfp-account.`,
    `${emailed && url ? 'We have emailed you the same link. ' : ''}See you on the pitch!\n${SIGN}`,
  )
}
// Requests (Lee, 16 Oct 2026): text the family straight after Accept, Trial
// or Decline, in the same layout as the other texts.
const names = (players) => { const f = players.map(firstName); return f.length > 1 ? `${f.slice(0, -1).join(', ')} and ${f.at(-1)}` : f[0] || '' }
export function requestOfferText({ parent, players = [], when, place, url, email = '', emailed = true }) {
  const n = names(players)
  return lines(
    hiLine(parent),
    `It's Lee from Joner Football. Great news, ${n} ${players.length > 1 ? 'have' : 'has'} a spot in our ${when} group at ${place}.`,
    `To 100% lock it in, ${signIn(email)}, sign the waiver and pay here: ${url}`,
    `${emailed ? 'We have emailed you the same link. ' : ''}See you on the pitch!\n${SIGN}`,
  )
}
export function requestTrialText({ parent, players = [], date, when, place, url, email = '', emailed = true }) {
  const n = names(players)
  return lines(
    hiLine(parent),
    `It's Lee from Joner Football. Thanks for applying. We would love ${n} to come for a trial on ${date} in our ${when} group at ${place}.`,
    `To lock in the trial, ${signIn(email)}, sign the waiver and pay for the trial here: ${url}`,
    `${emailed ? 'We have emailed you the same link. ' : ''}See you on the pitch!\n${SIGN}`,
  )
}
export function requestDeclineText({ parent, players = [], group, suggest = [] }) {
  const n = names(players)
  return lines(
    hiLine(parent),
    `It's Lee from Joner Football. Thanks for applying for ${group}. It is not the right group for ${n} this term, as we keep every group at one level so each player is challenged.`,
    suggest.length ? `${suggest.length === 1 ? 'A group we think would suit' : 'Groups we think would suit'}: ${suggest.join('; ')}. You can apply for ${suggest.length === 1 ? 'it' : 'them'} on our timetable.` : 'If you would like to talk about another group or 1 to 1 coaching, just reply to our email.',
    `Thanks again.\n${SIGN}`,
  )
}
