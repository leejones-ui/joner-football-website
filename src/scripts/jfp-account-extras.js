// My account: Book extra sessions and Book game analysis (Lee, 14 Oct 2026).
// For now each page explains the service and has a request form. A request
// is emailed to Lee and Ligia, logged, and listed for staff under Requests in
// the portal (api/_jfp-extras.js). Built so extra 1 on 1 slots can be listed
// at the top of the page later (D.extras.slots, empty today).
import { esc, api, toast } from './jfp-common.js'
import { ic } from './jfp-account-icons.js'
import { hero, secHead } from './jfp-account-ui.js'

const IMG = '/images/jfp-account/photos'
const todayIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const X = (D) => D.extras || { days: [], times: [], types: [], slots: [], mine: [], holidaySlots: 0, analysisPriceLabel: '' }

function playerField(D, id) {
  const names = [...(D.players || []).map((p) => p.name), ...(D.juniors?.children || []).map((c) => c.name)]
  if (!names.length) return `<label class="j-field"><span>Player's name</span><input class="j-input" id="${id}" autocomplete="off"></label>`
  return `<label class="j-field"><span>Which player?</span><select class="j-select" id="${id}">${names.map((n) => `<option>${esc(n)}</option>`).join('')}</select></label>`
}
const chips = (group, list, { multi = true, pick = '' } = {}) => `<div class="ja-seg" data-x-group="${esc(group)}" data-x-multi="${multi ? '1' : ''}">${list.map((x) => `<button type="button" class="j-chip" data-x-chip="${esc(x)}" aria-pressed="${x === pick}">${esc(x)}</button>`).join('')}</div>`
const picked = (root, group) => [...root.querySelectorAll(`[data-x-group="${group}"] [aria-pressed="true"]`)].map((b) => b.dataset.xChip)

function mineList(D, kind) {
  const list = X(D).mine.filter((r) => r.kind === kind)
  if (!list.length) return ''
  return `<section class="ja-sec">${secHead('Your requests')}<div class="ja-card"><ul class="ja-list">${list.map((r) => `<li class="ja-row"><span class="ja-num">${ic(kind === 'analysis' ? 'video' : 'calplus')}</span><div><b>${esc(r.kindLabel)}: ${esc(r.player)}</b><small>Sent ${esc(new Date(r.createdAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }))}${r.matchLabel ? ` · match ${esc(r.matchLabel)}` : ''}</small></div><span class="ja-dot ${r.status === 'done' ? 'ok' : 'warn'}">${r.status === 'done' ? 'Sorted' : 'With Ligia'}</span></li>`).join('')}</ul></div></section>`
}

// ---------- Book extra sessions ----------

export function renderExtra(el, D) {
  const x = X(D)
  const slots = x.slots.length
    ? `<section class="ja-sec">${secHead('Times you can book now')}<div class="ja-grid ja-grid-3">${x.slots.map((s) => `<article class="ja-card"><p class="ja-kicker"><i></i>${esc(s.type || '1 on 1')}</p><h3 class="ja-h3" style="margin-top:8px">${esc(s.label)}</h3><p class="ja-small ja-muted">${esc(s.where || '')}${s.priceLabel ? ` · ${esc(s.priceLabel)}` : ''}</p>${s.url ? `<div class="ja-actions"><a class="ja-btn ja-btn-red ja-btn-sm" href="${esc(s.url)}">Book</a></div>` : ''}</article>`).join('')}</div></section>`
    : ''
  el.innerHTML = `${hero({ img: `${IMG}/lee-one-on-one-1200x900.webp`, imgSmall: `${IMG}/lee-one-on-one-1200x900.webp`, kicker: 'Program', title: 'Book extra<br>sessions', lede: 'Extra 1 on 1 or small group sessions with our coaches, on top of your JFP group. Tell us what suits and Ligia will come back to you with times.' })}
    <div class="ja-grid ja-grid-3">
      <div class="ja-card ja-info-card">${ic('clock')}<h3 class="ja-h3">1 on 1 in term time</h3><p class="ja-small ja-muted">During the school term, 1 on 1 sessions run in school hours only, from about 7:30am to 2pm.</p></div>
      <div class="ja-card ja-info-card">${ic('sun')}<h3 class="ja-h3">School holidays</h3><p class="ja-small ja-muted">1 on 1 and small group sessions run through the school holidays at Joner Football HQ, Belrose.</p>${x.holidaySlots ? '<p style="margin-top:12px"><a class="ja-btn ja-btn-red ja-btn-sm" href="/holiday-bookings/">Book holiday training</a></p>' : ''}</div>
      <div class="ja-card ja-info-card">${ic('chat')}<h3 class="ja-h3">Other times</h3><p class="ja-small ja-muted">Need a different time? Ask below. Other times are on request, depending on the coaches.</p></div>
    </div>
    ${x.holidaySlots ? `<div class="ja-band" style="margin-top:14px"><div><p class="ja-kicker"><i></i>School holidays</p><h2 style="margin-top:10px">Holiday sessions are open</h2><p style="margin-top:8px">Book a holiday session straight away on the holiday booking page.</p></div><a class="ja-btn ja-btn-light" href="/holiday-bookings/">Book holiday training ${ic('arrow')}</a></div>` : ''}
    ${slots}
    <section class="ja-sec"><div class="ja-card ja-form-card" id="x-extra">
      <p class="ja-kicker"><i></i>Request</p><h2 class="ja-h2" style="margin-top:10px">Ask for an extra session</h2>
      ${playerField(D, 'x-player')}
      <div class="j-field"><span>What kind?</span>${chips('type', x.types.length ? x.types : ['1 on 1', 'Small group', 'Either'], { multi: false, pick: '1 on 1' })}</div>
      <div class="j-field"><span>Days that suit <span class="muted">(choose any)</span></span>${chips('days', x.days)}</div>
      <div class="j-field"><span>Times that suit <span class="muted">(choose any)</span></span>${chips('times', x.times)}</div>
      <div class="j-two"><label class="j-field"><span>Coach preference <span class="muted">(optional)</span></span><input class="j-input" id="x-coach" maxlength="80" autocomplete="off"></label><label class="j-field"><span>Your mobile <span class="muted">(optional)</span></span><input class="j-input" id="x-phone" type="tel" inputmode="tel" autocomplete="tel"></label></div>
      <label class="j-field"><span>Anything else? <span class="muted">(optional)</span></span><textarea class="j-textarea" id="x-notes" rows="3" maxlength="1000" placeholder="For example, what they want to work on, or dates that do not suit"></textarea></label>
      <p class="j-err" id="x-err" hidden></p>
      <div class="ja-actions"><button type="button" class="ja-btn ja-btn-red" data-x-send="extra">Send the request</button><span class="ja-small ja-muted">Ligia replies to ${esc(D.email)}</span></div>
    </div></section>
    ${mineList(D, 'extra')}`
}

// ---------- Book game analysis ----------

export function renderAnalysis(el, D) {
  const x = X(D)
  el.innerHTML = `${hero({ img: `${IMG}/lee-coaching-field-1600x900.webp`, imgSmall: `${IMG}/lee-coaching-field-900x1100.webp`, kicker: 'Program', title: 'Book game<br>analysis', lede: "Send us a video of a match and Lee goes through your player's game: what they do well, and what to work on next." })}
    <div class="ja-steps"><div class="ja-step"><b>Send the match</b><p>A link to the video (YouTube, Veo, Google Drive, Dropbox), or send it to us after.</p></div><div class="ja-step"><b>Lee watches it</b><p>Your player's moments in the game, on and off the ball.</p></div><div class="ja-step"><b>You get the analysis</b><p>What they do well and what to work on, to take into training.</p></div></div>
    <div class="ja-grid ja-grid-2" style="margin-top:14px">
      <div class="ja-card ja-price-card"><p class="ja-kicker"><i></i>Price</p><p class="ja-amt"><span>${esc(x.analysisPriceLabel || 'Ask us')}</span>${x.analysisPriceLabel ? ' <small>a match</small>' : ''}</p><p class="ja-small ja-muted">${x.analysisPriceLabel ? 'We confirm everything by email before Lee starts.' : 'Send the request and we will tell you the price before Lee starts.'}</p></div>
      <div class="ja-card ja-form-card" id="x-analysis">
        <p class="ja-kicker"><i></i>Request</p><h2 class="ja-h2" style="margin-top:10px">Book an analysis</h2>
        ${playerField(D, 'xa-player')}
        <label class="j-field"><span>Match date</span><input class="j-input" id="xa-date" type="date" max="${todayIso()}"></label>
        <label class="j-field"><span>Link to the video</span><input class="j-input" id="xa-video" type="url" inputmode="url" placeholder="https://" autocomplete="off"></label>
        <label class="j-check"><input type="checkbox" id="xa-later"> <span>I'll send it</span></label>
        <label class="j-field"><span>Anything Lee should know? <span class="muted">(optional)</span></span><textarea class="j-textarea" id="xa-notes" rows="3" maxlength="1000" placeholder="For example, their shirt number, position, or what you want him to look at"></textarea></label>
        <label class="j-field"><span>Your mobile <span class="muted">(optional)</span></span><input class="j-input" id="xa-phone" type="tel" inputmode="tel" autocomplete="tel"></label>
        <p class="j-err" id="xa-err" hidden></p>
        <div class="ja-actions"><button type="button" class="ja-btn ja-btn-red" data-x-send="analysis">Send the request</button></div>
      </div>
    </div>
    ${mineList(D, 'analysis')}`
}

// ---------- clicks ----------

async function send(kind, btn, D) {
  const root = btn.closest('.ja-form-card')
  const v = (id) => (root.querySelector(`#${id}`)?.value || '').trim()
  const err = root.querySelector(kind === 'analysis' ? '#xa-err' : '#x-err')
  err.hidden = true
  const body = kind === 'analysis'
    ? { kind, player: v('xa-player'), matchDate: v('xa-date'), video: v('xa-video'), sendLater: root.querySelector('#xa-later').checked, notes: v('xa-notes'), phone: v('xa-phone') }
    : { kind, player: v('x-player'), type: picked(root, 'type')[0] || 'Either', days: picked(root, 'days'), times: picked(root, 'times'), coach: v('x-coach'), notes: v('x-notes'), phone: v('x-phone') }
  // The same checks the server makes, so the family hears straight away.
  if (kind === 'analysis' && !body.sendLater && !/^https?:\/\/\S{4,}/.test(body.video)) { err.textContent = 'Paste a link to the match video, or tick "I\'ll send it".'; err.hidden = false; return }
  if (kind === 'extra' && !body.days.length && !body.times.length && body.notes.length < 3) { err.textContent = 'Choose the days or times that suit, or add a note.'; err.hidden = false; return }
  btn.disabled = true
  btn.textContent = 'Sending'
  const r = await api('/api/jfp-account', { action: 'requestExtra', ...body })
  btn.disabled = false
  btn.textContent = 'Send the request'
  if (!r.ok) { err.textContent = r.data.error || 'Could not send that. Try again.'; err.hidden = false; return }
  if (D.extras) D.extras.mine = [r.data.request, ...(D.extras.mine || [])]
  root.innerHTML = `<div class="ja-sent" data-x-sent>${ic('check')}<div><h3 class="ja-h3">Sent. Thank you.</h3><p class="ja-small ja-muted" style="margin-top:4px">${kind === 'analysis' ? `Lee and Ligia have your request for ${esc(r.data.request.player)}.${body.sendLater ? ' Reply to our email with the video when you have it.' : ''}` : `Ligia has your request for ${esc(r.data.request.player)} and will come back to you with times.`} We reply to ${esc(D.email)}.</p></div></div>`
  toast('Sent. We will be in touch.')
}

// From the page's one click handler. Returns true when the click was ours.
export function extraClick(t, { D }) {
  const chip = t.closest('[data-x-group] [data-x-chip]')
  if (chip) {
    const g = chip.closest('[data-x-group]')
    const on = chip.getAttribute('aria-pressed') !== 'true'
    if (!g.dataset.xMulti) g.querySelectorAll('[data-x-chip]').forEach((b) => b.setAttribute('aria-pressed', String(b === chip)))
    else chip.setAttribute('aria-pressed', String(on))
    return true
  }
  const b = t.closest('[data-x-send]')
  if (b && D) { send(b.dataset.xSend, b, D); return true }
  return false
}
