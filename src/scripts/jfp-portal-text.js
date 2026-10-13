// Text one family from the staff portal (Lee, 13 Oct 2026: "I really need
// text messages to be working in this portal"). Lee or Ligia see the exact
// words, can change them, and either send from the work number 0404 780 351
// (the office Mac sends it, 8am to 8pm) or open it in their own phone's
// Messages with everything filled in.
import { esc, api } from './jfp-common.js'

const tel = (m) => { const d = String(m || '').replace(/\D/g, ''); return d.startsWith('04') ? `+61${d.slice(1)}` : d.startsWith('614') ? `+${d}` : d }
// iPhones and Macs take sms:<number>&body=, everything else ?body=.
const smsHref = (mobile, text) => `sms:${tel(mobile)}${/iPhone|iPad|Macintosh/.test(navigator.userAgent) ? '&' : '?'}body=${encodeURIComponent(text)}`
const STATE = {
  queued: ['grey', 'Waiting for the office Mac. It goes in the next minute (texts wait until 8am overnight).'],
  claimed: ['blue', 'The office Mac is sending it now.'],
  sent: ['green', 'Sent from 0404 780 351.'],
  delivered: ['green', 'Sent.'],
  failed: ['red', 'Not delivered. They may not use iMessage: use Text from my phone.'],
  unknown: ['amber', 'The Mac could not confirm it. Check Messages on the office Mac before sending again.'],
  cancelled: ['amber', 'Not sent.'],
  expired: ['amber', 'Not sent in time.'],
}

// self: the player is their own contact, so the text goes to them (to: their name).
export function textComposer({ modal, toast, rowIds, parent = '', mobile = '', text = '', title = '', self = false, to = '' }) {
  const who = to || (self ? 'the player' : parent || 'the family')
  const box = modal(`<h2 style="margin-bottom:4px">${esc(title || (self ? `Text ${who}` : 'Text the family'))}</h2>
    <p class="muted small" style="margin-bottom:12px">To ${esc(who)}${mobile ? `, ${esc(mobile)}` : ''}. From the work number 0404 780 351, between 8am and 8pm. Check the words: this is exactly what they get.</p>
    <label class="j-field"><span>The text</span><textarea class="j-textarea" id="tx-text" rows="7" maxlength="640">${esc(text)}</textarea></label>
    <p class="muted small" id="tx-count" style="margin-top:-6px"></p>
    <div id="tx-status" style="margin-top:8px"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:12px">
      <button type="button" class="j-btn j-btn-line" data-close>Close</button>
      ${mobile ? '<a class="j-btn j-btn-line" id="tx-phone" href="#">Text from my phone</a>' : ''}
      <button type="button" class="j-btn j-btn-dark" id="tx-send">Send from 0404 780 351</button>
    </div>`, { wide: true })
  const area = box.querySelector('#tx-text')
  const count = () => { const n = area.value.length; box.querySelector('#tx-count').textContent = `${n} characters${n > 160 ? `, ${Math.ceil(n / 153)} texts` : ''}`; const a = box.querySelector('#tx-phone'); if (a) a.href = smsHref(mobile, area.value) }
  area.addEventListener('input', count)
  count()
  const status = (cls, html) => { box.querySelector('#tx-status').innerHTML = `<div class="j-box j-box-${cls} small">${html}</div>` }
  box.querySelector('#tx-send').addEventListener('click', async (e) => {
    const btn = e.currentTarget
    btn.disabled = true
    btn.textContent = 'Sending'
    const r = await api('/api/jfp-messages', { action: 'quickText', rowIds, text: area.value })
    if (!r.ok) {
      btn.disabled = false
      btn.textContent = 'Send from 0404 780 351'
      status(r.data.code === 'route' ? 'amber' : 'red', esc(r.data.error || 'Could not send.'))
      return
    }
    btn.textContent = 'Sent to the office Mac'
    area.readOnly = true
    toast('Text on its way from 0404 780 351')
    // Follow it until the office Mac reports back (about two minutes).
    const id = r.data.message.id
    for (let i = 0; i < 40 && document.body.contains(box); i += 1) {
      const g = await api('/api/jfp-messages', { action: 'get', id })
      const st = g.ok ? g.data.message.status : 'queued'
      const [cls, words] = STATE[st] || STATE.queued
      status(cls, `<b>${esc(g.data?.message?.statusLabel || st)}</b>. ${esc(words)}${st === 'queued' && !r.data.hoursOpen ? ' Outside 8am to 8pm, so it goes at 8am.' : ''}`)
      if (!['queued', 'claimed'].includes(st)) break
      await new Promise((res) => setTimeout(res, 3000))
    }
  })
  return box
}

// The words for the usual cases, in Lee's voice. Plain, no dashes.
// self: the player is their own contact, so "Hi Kai, you have a spot".
const firstName = (s) => String(s || '').trim().split(/\s+/)[0] || 'there'
export function payLinkText({ parent, player, when, place, url, self = false }) {
  return self
    ? `Hi ${firstName(player)}, it's Lee from Joner Football. You have a spot in our ${when} group at ${place}. To lock it in, sign in, sign the waiver and pay here: ${url} We have emailed you the same link. See you on the pitch!`
    : `Hi ${firstName(parent)}, it's Lee from Joner Football. ${firstName(player)} has a spot in our ${when} group at ${place}. To lock it in, sign in, sign the waiver and pay here: ${url} We have emailed you the same link. See you on the pitch!`
}
export function trialText({ parent, player, when, where, self = false }) {
  return self
    ? `Hi ${firstName(player)}, it's Lee from Joner Football. You are booked in for a trial on ${when} at ${where}. Please sign in and sign your waiver before the session: jonerfootball.com/jfp-account See you on the pitch!`
    : `Hi ${firstName(parent)}, it's Lee from Joner Football. ${firstName(player)} is booked in for a trial on ${when} at ${where}. Please sign in and sign the waiver before the session: jonerfootball.com/jfp-account See you on the pitch!`
}
export function helloText({ parent, player = '', self = false }) {
  return `Hi ${firstName(self ? player : parent)}, it's Lee from Joner Football. `
}
