// My account: Book extra sessions and Book game analysis (Lee, 14 Oct 2026).
// For now each page explains the service and has a request form. A request
// is emailed to Lee and Ligia, logged, and listed for staff under Requests in
// the portal (api/_jfp-extras.js). Built so extra 1 on 1 slots can be listed
// at the top of the page later (D.extras.slots, empty today).
import { esc, api, toast } from './jfp-common.js'
import { ic } from './jfp-account-icons.js'
import { hero, secHead, pageHead } from './jfp-account-ui.js'

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

// Sessions a coach opened (money engineer, 14 Oct 2026): public ones for
// everyone, and a private one from its own link (#extra?slot=<id>&k=<key>).
// Book: choose the player, then the place is held, the charge made and the
// family goes to Stripe (api/_jfp-family-extra.js). No coach names here.
let LINK = null
export function setExtraLink(query) {
  const q = new URLSearchParams(query || '')
  LINK = q.get('slot') ? { slot: q.get('slot'), k: q.get('k') || '', state: 'new', data: null } : null
}
function slotCard(s, D, { mine = false } = {}) {
  const full = s.placesLeft < 1
  return `<article class="ja-card" data-xslot="${esc(s.id)}"><p class="ja-kicker"><i></i>${mine ? 'Your session' : esc(s.kind || 'Extra session')}</p>
    <h3 class="ja-h3" style="margin-top:8px">${esc(s.dateLabel)} · ${esc(s.time)}</h3>
    <p class="ja-small" style="margin-top:4px"><b>${esc(s.kind || 'Extra session')}</b>${s.coach ? ` with ${esc(s.coach)}` : ''}${s.label && s.label !== s.kind ? ` · ${esc(s.label)}` : ''}</p>
    <p class="ja-small ja-muted">${esc(s.location)}${s.durationMin ? ` · ${esc(String(s.durationMin))} min` : ''} · ${esc(s.priceLabel)}</p>
    <p class="ja-small ja-muted">${full ? 'Full' : `${s.placesLeft} place${s.placesLeft === 1 ? '' : 's'} left`}${s.note ? ` · ${esc(s.note)}` : ''}</p>
    <div class="ja-actions" data-xslot-acts>${full ? '' : `<button type="button" class="ja-btn ja-btn-red ja-btn-sm" data-xbook="${esc(s.id)}">Book</button>`}</div>
    <p class="j-err" data-xslot-err hidden></p></article>`
}
function bookableHtml(D) {
  const x = X(D)
  const mine = LINK?.data ? [LINK.data] : []
  const pub = (x.bookable || []).filter((s) => !mine.some((m) => m.id === s.id))
  const notice = LINK?.state === 'missing' ? '<div class="ja-card"><p class="ja-small">That session link is not open any more. Ask Ligia for a new one, or book a time below.</p></div>' : ''
  if (!mine.length && !pub.length) return notice
  return `<section class="ja-sec" id="x-bookable">${secHead('Sessions you can book now')}${notice}<div class="ja-grid ja-grid-3">${[...mine.map((s) => slotCard(s, D, { mine: true })), ...pub.map((s) => slotCard(s, D))].join('')}</div></section>`
}

export function renderExtra(el, D) {
  if (LINK?.state === 'new') {
    LINK.state = 'loading'
    api('/api/jfp-account', { action: 'extraSlot', slotId: LINK.slot, k: LINK.k }).then((r) => {
      LINK.state = r.ok ? 'ok' : 'missing'
      LINK.data = r.ok ? r.data.slot : null
      renderExtra(el, D)
    })
  }
  const x = X(D)
  const slots = x.slots.length
    ? `<section class="ja-sec">${secHead('Times you can book now')}<div class="ja-grid ja-grid-3">${x.slots.map((s) => `<article class="ja-card"><p class="ja-kicker"><i></i>${esc(s.type || '1 on 1')}</p><h3 class="ja-h3" style="margin-top:8px">${esc(s.label)}</h3><p class="ja-small ja-muted">${esc(s.where || '')}${s.priceLabel ? ` · ${esc(s.priceLabel)}` : ''}</p>${s.url ? `<div class="ja-actions"><a class="ja-btn ja-btn-red ja-btn-sm" href="${esc(s.url)}">Book</a></div>` : ''}</article>`).join('')}</div></section>`
    : ''
  el.innerHTML = `${pageHead('Program', 'Book extra sessions', 'Extra 1 on 1 or small group sessions with our coaches, on top of your JFP group.')}
    ${bookableHtml(D) || '<section class="ja-sec" id="x-bookable"><div class="ja-card"><p class="ja-small">No extra sessions are open to book right now. New ones show here as soon as a coach adds them, or ask for a time below.</p></div></section>'}
    ${slots}
    <div class="ja-grid ja-grid-3">
      <div class="ja-card ja-info-card">${ic('clock')}<h3 class="ja-h3">1 on 1 in term time</h3><p class="ja-small ja-muted">During the school term, 1 on 1 sessions run in school hours only, from about 7:30am to 2pm.</p></div>
      <div class="ja-card ja-info-card">${ic('sun')}<h3 class="ja-h3">School holidays</h3><p class="ja-small ja-muted">1 on 1 and small group sessions run through the school holidays at Joner Football HQ, Belrose.</p>${x.holidaySlots ? '<p style="margin-top:12px"><a class="ja-btn ja-btn-red ja-btn-sm" href="#holidays">Book holiday training</a></p>' : ''}</div>
      <div class="ja-card ja-info-card">${ic('chat')}<h3 class="ja-h3">Other times</h3><p class="ja-small ja-muted">Need a different time? Ask below. Other times are on request, depending on the coaches.</p></div>
    </div>
    ${x.holidaySlots ? `<div class="ja-band" style="margin-top:14px"><div><p class="ja-kicker"><i></i>School holidays</p><h2 style="margin-top:10px">Holiday sessions are open</h2><p style="margin-top:8px">Book a holiday session straight away on the holiday booking page.</p></div><a class="ja-btn ja-btn-light" href="#holidays">Book holiday training ${ic('arrow')}</a></div>` : ''}
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
  el.innerHTML = `${hero({ img: `${IMG}/lee-coaching-field-1600x900.webp`, imgSmall: `${IMG}/lee-coaching-field-900x1100.webp`, kicker: 'Program', title: 'Game<br>analysis', lede: "JFP players get an exclusive discount on game analysis. We watch your player's game and give them detailed feedback to take into training." })}
    <div class="ja-steps"><div class="ja-step"><b>Enquire</b><p>Fill in the short form below.</p></div><div class="ja-step"><b>We watch the game</b><p>Your player's moments in the match, on and off the ball.</p></div><div class="ja-step"><b>Detailed feedback</b><p>What they do well and what to work on next.</p></div></div>
    <div class="ja-grid ja-grid-2" style="margin-top:14px">
      <div class="ja-card ja-price-card"><p class="ja-kicker"><i></i>JFP players</p><p class="ja-amt"><span>Exclusive discount</span></p><p class="ja-small ja-muted">${x.analysisPriceLabel ? `Your JFP price is ${esc(x.analysisPriceLabel)} a match. ` : ''}Send an enquiry and we will reply with the price and the next steps.</p></div>
      <div class="ja-card ja-form-card" id="x-analysis">
        <p class="ja-kicker"><i></i>Enquire</p><h2 class="ja-h2" style="margin-top:10px">Ask about game analysis</h2>
        ${playerField(D, 'xa-player')}
        <label class="j-field"><span>Link to a match video <span class="muted">(optional)</span></span><input class="j-input" id="xa-video" type="url" inputmode="url" placeholder="https://" autocomplete="off"></label>
        <label class="j-field"><span>Anything we should know? <span class="muted">(optional)</span></span><textarea class="j-textarea" id="xa-notes" rows="3" maxlength="1000" placeholder="For example, their position, or what you would like us to look at"></textarea></label>
        <label class="j-field"><span>Your mobile <span class="muted">(optional)</span></span><input class="j-input" id="xa-phone" type="tel" inputmode="tel" autocomplete="tel"></label>
        <p class="j-err" id="xa-err" hidden></p>
        <div class="ja-actions"><button type="button" class="ja-btn ja-btn-red" data-x-send="analysis">Send the enquiry</button></div>
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
    ? { kind, player: v('xa-player'), video: v('xa-video'), notes: v('xa-notes'), phone: v('xa-phone') }
    : { kind, player: v('x-player'), type: picked(root, 'type')[0] || 'Either', days: picked(root, 'days'), times: picked(root, 'times'), coach: v('x-coach'), notes: v('x-notes'), phone: v('x-phone') }
  // The same checks the server makes, so the family hears straight away.
  if (kind === 'analysis' && body.video && !/^https?:\/\/\S{4,}/.test(body.video)) { err.textContent = 'That video link does not look right. Paste the full link, or leave it empty.'; err.hidden = false; return }
  if (kind === 'extra' && !body.days.length && !body.times.length && body.notes.length < 3) { err.textContent = 'Choose the days or times that suit, or add a note.'; err.hidden = false; return }
  btn.disabled = true
  btn.textContent = 'Sending'
  const r = await api('/api/jfp-account', { action: 'requestExtra', ...body })
  btn.disabled = false
  btn.textContent = kind === 'analysis' ? 'Send the enquiry' : 'Send the request'
  if (!r.ok) { err.textContent = r.data.error || 'Could not send that. Try again.'; err.hidden = false; return }
  if (D.extras) D.extras.mine = [r.data.request, ...(D.extras.mine || [])]
  root.innerHTML = `<div class="ja-sent" data-x-sent>${ic('check')}<div><h3 class="ja-h3">Sent. Thank you.</h3><p class="ja-small ja-muted" style="margin-top:4px">${kind === 'analysis' ? `We have your game analysis enquiry for ${esc(r.data.request.player)} and will reply with the price and next steps.` : `Ligia has your request for ${esc(r.data.request.player)} and will come back to you with times.`} We reply to ${esc(D.email)}.</p></div></div>`
  toast('Sent. We will be in touch.')
}

// Book: pick the player (the waiver first), then hold, charge and pay.
function bookPicker(card, D, slotId) {
  const ps = D.players || []
  const acts = card.querySelector('[data-xslot-acts]')
  acts.innerHTML = ps.length
    ? `<label class="j-field" style="margin:0;flex:1"><span>Which player?</span><select class="j-select" data-xbook-player>${ps.map((p) => `<option value="${esc(p.key)}">${esc(p.name)}${p.waiver?.onFile ? '' : ' (waiver needed)'}</option>`).join('')}</select></label><button type="button" class="ja-btn ja-btn-red ja-btn-sm" data-xbook-go="${esc(slotId)}">Book and pay</button>`
    : '<p class="ja-small">Add your player first (My profile), then book.</p>'
}
async function bookGo(btn, D) {
  const card = btn.closest('[data-xslot]')
  const err = card.querySelector('[data-xslot-err]')
  err.hidden = true
  const key = card.querySelector('[data-xbook-player]')?.value || ''
  const p = (D.players || []).find((x) => x.key === key)
  if (p && !p.waiver?.onFile) { err.innerHTML = `Sign ${esc(p.name)}'s waiver first, then book. <button type="button" class="ja-link" data-go="waivers">Sign the waiver</button>`; err.hidden = false; return }
  btn.disabled = true
  btn.textContent = 'Opening'
  const r = await api('/api/jfp-account', { action: 'bookExtra', slotId: btn.dataset.xbookGo, k: LINK?.slot === btn.dataset.xbookGo ? LINK.k : '', playerKey: key })
  if (r.ok && r.data.url) { location.href = r.data.url; return }
  btn.disabled = false
  btn.textContent = 'Book and pay'
  if (r.ok && r.data.paid) { err.textContent = 'Already booked and paid. See you there.'; err.hidden = false; return }
  err.textContent = r.data.error || 'Could not book that. Try again.'
  err.hidden = false
  if (r.data.code === 'charge') toast('Your place is held.')
}

// From the page's one click handler. Returns true when the click was ours.
export function extraClick(t, { D }) {
  const bk = t.closest('[data-xbook]')
  if (bk && D) { bookPicker(bk.closest('[data-xslot]'), D, bk.dataset.xbook); return true }
  const go = t.closest('[data-xbook-go]')
  if (go && D) { bookGo(go, D); return true }
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
