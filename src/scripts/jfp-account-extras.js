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
  return `<section class="ja-sec">${secHead('Your requests')}<div class="ja-card"><ul class="ja-list">${list.map((r) => `<li class="ja-row"><span class="ja-num">${ic(kind === 'analysis' ? 'video' : 'calplus')}</span><div><b>${esc(r.kindLabel)}: ${esc(r.player)}</b><small>Sent ${esc(new Date(r.createdAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }))}${r.matchLabel ? ` · match ${esc(r.matchLabel)}` : ''}${r.packageLabel ? ` · ${esc(r.packageLabel)}` : ''}</small></div><span class="ja-dot ${r.status === 'done' ? 'ok' : 'warn'}">${r.status === 'done' ? 'Sorted' : 'With Ligia'}</span></li>`).join('')}</ul></div></section>`
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
// A whole session (Lee, 27 Oct 2026): one family takes it, first come first
// served, as 1 on 1 or a group. Each option with its price per player.
const optLine = (o) => `${esc(o.label)}: ${esc(o.priceLabel)}${o.type === 'one' || o.pairCents ? '' : ' a player'}`
function slotCard(s, D, { mine = false } = {}) {
  const full = s.placesLeft < 1
  return `<article class="ja-card" data-xslot="${esc(s.id)}"><p class="ja-kicker"><i></i>${mine ? 'Your session' : esc(s.kind || 'Extra session')}</p>
    <h3 class="ja-h3" style="margin-top:8px">${esc(s.dateLabel)} · ${esc(s.time)}</h3>
    <p class="ja-small" style="margin-top:4px"><b>${esc(s.kind || 'Extra session')}</b>${s.coach ? ` with ${esc(s.coach)}` : ''}${s.label && s.label !== s.kind ? ` · ${esc(s.label)}` : ''}${s.weekly && !mine ? ` · <b>Every ${esc(s.dayName)}</b>` : ''}</p>
    <p class="ja-small ja-muted">${esc(s.location)}${s.durationMin ? ` · ${esc(String(s.durationMin))} min` : ''}${s.whole ? '' : ` · ${esc(s.priceLabel)}`}</p>
    ${s.whole ? `<ul class="ja-small" style="margin:6px 0 0 18px">${s.options.map((o) => `<li>${optLine(o)}</li>`).join('')}</ul>
    <p class="ja-small ja-muted">${full ? 'Booked' : 'The first family to book has the whole session.'}${s.note ? ` · ${esc(s.note)}` : ''}</p>`
    : `<p class="ja-small ja-muted">${full ? 'Full' : `${s.placesLeft} place${s.placesLeft === 1 ? '' : 's'} left`}${s.note ? ` · ${esc(s.note)}` : ''}</p>`}
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

// Redesign with Coach Dean's packages (Lee, 21 Oct 2026): JFP prices with
// the normal price crossed out, what they get, how it works, then the form
// with the package already picked.
const GA_DEFAULT = [{ key: '1', games: 1, cents: 25000, normalCents: 30000 }, { key: '5', games: 5, cents: 97500, normalCents: 119900 }, { key: '10', games: 10, cents: 150000, normalCents: 180000 }]
const aud = (c) => `A$${(c / 100).toLocaleString('en-AU', { maximumFractionDigits: 0 })}`
const GA_GETS = [
  ['Full Performance Breakdown', 'A detailed review of your overall performance.'],
  ['Performance Statistics', 'Key stats and individual performance metrics.'],
  ['What You Did Well', 'Your strengths and positive moments throughout the game.'],
  ['Areas for Improvement', 'Constructive feedback with specific examples of what you could have done differently.'],
  ['Position-Specific Analysis', 'Detailed feedback tailored to your position and your role in the team.'],
  ['Personal Development Targets', 'Clear areas to focus on to help improve your game.'],
  ['In-Person Review', 'A one to one session to go through the footage, discuss key moments and find ways to take your game to the next level.'],
]
export function renderAnalysis(el, D) {
  const x = X(D)
  const packs = x.analysisPackages?.length ? x.analysisPackages : GA_DEFAULT
  const jfp = x.analysisJfp === true
  const card = (k) => {
    const save = k.normalCents - k.cents
    const best = k.games === 10
    return `<div class="ja-opt-card ja-ga-pack${best ? ' is-best' : ''}" data-ga-pack="${esc(k.key)}">
      ${best ? `<span class="ja-best">${ic('spark')}Best value</span>` : ''}
      <p class="ja-opt-t">${k.games} game${k.games > 1 ? 's' : ''}</p>
      ${jfp ? `<p class="ja-ga-was"><s>${aud(k.normalCents)}</s> <span>Save ${aud(save)}</span></p>` : ''}
      <p class="ja-ga-now">${aud(jfp ? k.cents : k.normalCents)}</p>
      <p class="ja-opt-s">${k.games > 1 ? `${aud(Math.round((jfp ? k.cents : k.normalCents) / k.games))} a game` : 'One match analysed'}</p>
      <button type="button" class="ja-btn ${best ? 'ja-btn-red' : 'ja-btn-light'} ja-btn-block" data-ga-pick="${esc(k.key)}">Choose ${k.games} game${k.games > 1 ? 's' : ''}</button>
    </div>`
  }
  el.innerHTML = `${hero({ img: `${IMG}/lee-coaching-field-1600x900.webp`, imgSmall: `${IMG}/lee-coaching-field-900x1100.webp`, kicker: 'Program', title: 'Game<br>analysis', lede: 'We break down your game, show you what went well and what to work on, then go through the footage with you one to one.' })}
    <section class="ja-sec">${secHead(jfp ? 'Exclusive JFP prices' : 'Prices', jfp ? 'Only for JFP players. Everyone else pays the full price.' : 'JFP players get exclusive lower prices.')}
      <div class="ja-opts-grid ja-ga-packs">${packs.map(card).join('')}</div>
    </section>
    <section class="ja-sec">${secHead('What you get', 'In every game analysis.')}
      <div class="ja-ga-gets">${GA_GETS.map(([t, d], i) => `<div class="ja-ga-get${i === GA_GETS.length - 1 ? ' is-wide' : ''}"><span class="ja-ga-ic">${ic(i === GA_GETS.length - 1 ? 'user' : i === 1 ? 'grid' : i === 2 ? 'check' : i === 0 ? 'video' : 'spark')}</span><div><b>${esc(t)}</b><p>${esc(d)}</p></div></div>`).join('')}</div>
    </section>
    <section class="ja-sec">${secHead('How it works')}
      <div class="ja-steps ja-steps-4"><div class="ja-step"><b>Choose and enquire</b><p>Pick a package and send the short form below.</p></div><div class="ja-step"><b>Send us the game</b><p>A link to the match video, now or later.</p></div><div class="ja-step"><b>We analyse it</b><p>Every moment, on and off the ball, with stats and examples.</p></div><div class="ja-step"><b>Your in-person review</b><p>We go through the footage together, one to one.</p></div></div>
    </section>
    <section class="ja-sec" id="x-analysis-sec">
      <div class="ja-card ja-form-card" id="x-analysis">
        <p class="ja-kicker"><i></i>Enquire</p><h2 class="ja-h2" style="margin-top:10px">Book game analysis</h2>
        <label class="j-field"><span>Package</span><select class="j-select" id="xa-package">${packs.map((k) => `<option value="${esc(k.key)}">${k.games} game${k.games > 1 ? 's' : ''}, ${aud(jfp ? k.cents : k.normalCents)}</option>`).join('')}</select></label>
        ${playerField(D, 'xa-player')}
        <label class="j-field"><span>Link to a match video <span class="muted">(optional)</span></span><input class="j-input" id="xa-video" type="url" inputmode="url" placeholder="https://" autocomplete="off"></label>
        <label class="j-field"><span>Anything we should know? <span class="muted">(optional)</span></span><textarea class="j-textarea" id="xa-notes" rows="3" maxlength="1000" placeholder="For example, their position, or what you would like us to look at"></textarea></label>
        <label class="j-field"><span>Your mobile <span class="muted">(optional)</span></span><input class="j-input" id="xa-phone" type="tel" inputmode="tel" autocomplete="tel"></label>
        <p class="ja-small ja-muted">Nothing is charged now. We reply with the next steps and how to pay.</p>
        <p class="j-err" id="xa-err" hidden></p>
        <div class="ja-actions"><button type="button" class="ja-btn ja-btn-red" data-x-send="analysis">Send the enquiry</button></div>
      </div>
    </section>
    ${mineList(D, 'analysis')}`
  el.querySelectorAll('[data-ga-pick]').forEach((b) => b.addEventListener('click', () => {
    const sel = el.querySelector('#xa-package'); if (sel) sel.value = b.dataset.gaPick
    el.querySelector('#x-analysis-sec')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }))
}

// ---------- clicks ----------

async function send(kind, btn, D) {
  const root = btn.closest('.ja-form-card')
  const v = (id) => (root.querySelector(`#${id}`)?.value || '').trim()
  const err = root.querySelector(kind === 'analysis' ? '#xa-err' : '#x-err')
  err.hidden = true
  const body = kind === 'analysis'
    ? { kind, package: v('xa-package'), player: v('xa-player'), video: v('xa-video'), notes: v('xa-notes'), phone: v('xa-phone') }
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

// A whole session: the option, their own players, and friends by name. The
// total shows as they go; the server checks the sizes again.
const slotById = (D, id) => (LINK?.data?.id === id ? LINK.data : (X(D).bookable || []).find((s) => s.id === id))
function wholePicker(card, D, s) {
  const ps = D.players || []
  const acts = card.querySelector('[data-xslot-acts]')
  if (!ps.length) { acts.innerHTML = '<p class="ja-small">Add your player first (My profile), then book.</p>'; return }
  acts.style.flexDirection = 'column'; acts.style.alignItems = 'stretch'
  acts.innerHTML = `<div class="j-field" style="margin:0"><span>How do you want it?</span><div class="ja-seg" data-xw-opts>${s.options.map((o, i) => `<button type="button" class="j-chip" data-xw-opt="${esc(o.id)}" aria-pressed="${i === 0}">${esc(o.label)}</button>`).join('')}</div></div>
    <div class="j-field" style="margin:0"><span>Your players</span>${ps.map((p, i) => `<label class="ja-small" style="display:flex;gap:8px;align-items:center"><input type="checkbox" data-xw-me="${esc(p.key)}" ${i === 0 ? 'checked' : ''}> ${esc(p.name)}${p.waiver?.onFile ? '' : ' (waiver needed)'}</label>`).join('')}</div>
    <div class="j-field" style="margin:0" data-xw-guests-wrap><span>Friends coming too <span class="muted">(full names)</span></span><div data-xw-guests></div></div>
    <p class="ja-small" data-xw-total></p>
    <button type="button" class="ja-btn ja-btn-red ja-btn-sm" data-xbook-go="${esc(s.id)}">Book and pay</button>`
  const opt = () => s.options.find((o) => o.id === acts.querySelector('[data-xw-opt][aria-pressed="true"]')?.dataset.xwOpt) || s.options[0]
  const draw = () => {
    const o = opt()
    const mine = acts.querySelectorAll('[data-xw-me]:checked').length
    const box = acts.querySelector('[data-xw-guests]')
    const typed = [...box.querySelectorAll('input')].map((x) => x.value)
    const room = Math.max(0, o.maxPlayers - mine)
    acts.querySelector('[data-xw-guests-wrap]').hidden = room === 0 && !typed.some(Boolean)
    // One empty box more than the names typed, up to the room left.
    const want = Math.min(room, typed.filter(Boolean).length + 1)
    box.innerHTML = Array.from({ length: want }, (_, i) => `<input class="j-input" data-xw-guest maxlength="80" autocomplete="off" placeholder="Friend's full name" value="${esc(typed[i] || '')}" style="margin-top:6px">`).join('')
    const n = mine + [...box.querySelectorAll('input')].filter((x) => x.value.trim()).length
    const need = o.minPlayers > n ? ` · needs ${o.minPlayers - n} more player${o.minPlayers - n === 1 ? '' : 's'}` : ''
    acts.querySelector('[data-xw-total]').innerHTML = n ? `<b>${n} player${n === 1 ? '' : 's'}: A$${(((o.pairCents && n === 2 ? o.pairCents : o.priceCents) * n) / 100).toLocaleString('en-AU', { maximumFractionDigits: 2 })}</b>${esc(need)}` : 'Tick your player.'
  }
  acts.addEventListener('click', (e) => { const b = e.target.closest('[data-xw-opt]'); if (!b) return; acts.querySelectorAll('[data-xw-opt]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); draw() })
  acts.addEventListener('change', (e) => { if (e.target.matches('[data-xw-me]')) draw() })
  acts.addEventListener('input', (e) => { if (!e.target.matches('[data-xw-guest]')) return; const pos = [...acts.querySelectorAll('[data-xw-guest]')].indexOf(e.target); const cur = e.target.selectionStart; draw(); const again = acts.querySelectorAll('[data-xw-guest]')[pos]; if (again) { again.focus(); again.setSelectionRange(cur, cur) } })
  draw()
}

// Book: pick the player (the waiver first), then hold, charge and pay.
function bookPicker(card, D, slotId) {
  const s = slotById(D, slotId)
  if (s?.whole) return wholePicker(card, D, s)
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
  const whole = Boolean(card.querySelector('[data-xw-opts]'))
  const keys = whole ? [...card.querySelectorAll('[data-xw-me]:checked')].map((x) => x.dataset.xwMe) : [card.querySelector('[data-xbook-player]')?.value || '']
  const key = keys[0] || ''
  const guests = whole ? [...card.querySelectorAll('[data-xw-guest]')].map((x) => x.value.trim()).filter(Boolean) : []
  const optionId = whole ? card.querySelector('[data-xw-opt][aria-pressed="true"]')?.dataset.xwOpt || '' : ''
  if (whole && !keys.length) { err.textContent = 'Tick your player.'; err.hidden = false; return }
  if (whole) {
    const o = slotById(D, btn.dataset.xbookGo)?.options.find((x) => x.id === optionId)
    const n = keys.length + guests.length
    if (o && n < o.minPlayers) { err.textContent = `${o.label} needs at least ${o.minPlayers} players. Add ${o.minPlayers - n} more.`; err.hidden = false; return }
  }
  const p = (D.players || []).find((x) => keys.includes(x.key) && !x.waiver?.onFile)
  if (p) { err.innerHTML = `Sign ${esc(p.name)}'s waiver first, then book. <button type="button" class="ja-link" data-go="waivers">Sign the waiver</button>`; err.hidden = false; return }
  btn.disabled = true
  btn.textContent = 'Opening'
  const r = await api('/api/jfp-account', { action: 'bookExtra', slotId: btn.dataset.xbookGo, k: LINK?.slot === btn.dataset.xbookGo ? LINK.k : '', playerKey: key, ...(whole ? { playerKeys: keys, guests, optionId } : {}) })
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
