// My account: Camps, Holiday training and the Home tiles (Lee, 10 Nov 2026).
// "The home page needs to just be options for them to click on", "camps
// needs to have its own left-hand side button" and "the holiday training tab
// is so word heavy": a hero photo, few words, one request form.
//
// Camps: the camp itself (dates, price, places) comes live from the camp
// system (/api/camp-book, the Websites build), so nothing here goes stale.
// Booking and paying happen on the camp page. Holiday training requests go
// to Ligia the same way as Contact us.
import { esc, api, toast, recaptcha, openSheet, closeSheet } from './jfp-common.js'
import { ic } from './jfp-account-icons.js'
import { hero } from './jfp-account-ui.js'

const IMG = '/images/jfp-account/photos'
const CAMP_IMG = '/images/camps/joner-camps'
export const CAMP_SLUG = 'christmas-holiday-camp'
const campUrl = (slug = CAMP_SLUG) => `/camps/${slug}`
const aud = (cents) => `A$${(Number(cents) / 100).toLocaleString('en-AU', { maximumFractionDigits: 2 })}`

let CAMP
let asked = null
// Read once per visit. null = no camp to book (or it could not be read).
export function loadCamp() {
  if (!asked) asked = fetch(`/api/camp-book?camp=${CAMP_SLUG}`, { headers: { accept: 'application/json' } }).then((r) => r.json()).then((j) => { CAMP = j?.success ? j.camp : null; return CAMP }).catch(() => { CAMP = null; return null })
  return asked
}
const campOpen = (c) => Boolean(c && c.status === 'open' && (c.days || []).some((d) => d.bookable))
const datesLine = (c) => {
  const d = c.days || []
  return d.length > 1 ? `${d[0].label} and ${d.at(-1).label}` : d[0]?.label || ''
}

// ---------- Camps ----------

export function renderCamps(el) {
  const draw = (c) => {
    if (!campOpen(c)) {
      el.innerHTML = `${hero({ img: `${CAMP_IMG}/lee-coaching-group.jpg`, kicker: 'Joner Football Camps', title: 'Camps', lede: 'No camp is open to book right now. New camps show here first.', actions: `<a class="ja-btn ja-btn-light" href="/camps">See our camps ${ic('arrow')}</a>` })}`
      return
    }
    const state = (d) => d.full ? '<span class="ja-tag dark">Full</span>' : d.low && d.left ? `<span class="ja-tag red">Only ${esc(String(d.left))} left</span>` : '<span class="ja-tag green">Places open</span>'
    const p = c.prices || {}
    const facts = [
      ['calendar', 'When', datesLine(c)],
      ['clock', 'Time', `${c.timesLabel || ''}${c.arriveLabel ? `. ${c.arriveLabel}` : ''}`],
      ['pin', 'Where', `${c.location || ''}${c.address ? `, ${c.address}` : ''}`],
      ['users', 'Who', c.ages || ''],
      ['card', 'Price', `${p.oneDay ? `${aud(p.oneDay)} for one day` : ''}${p.allDays && (c.days || []).length > 1 ? ` · ${aud(p.allDays)} for both days` : ''}`],
    ].filter((f) => f[2])
    el.innerHTML = `${hero({ img: `${CAMP_IMG}/lee-coaching-group.jpg`, kicker: 'Joner Football Camps · Booking now', title: esc(c.title || 'Camp'), lede: `${esc(datesLine(c))}. ${esc(c.location || '')}.`, actions: `<a class="ja-btn ja-btn-red" href="${campUrl(c.slug)}">Book your place ${ic('arrow')}</a>` })}
      <div class="ja-grid ja-grid-2">
        <article class="ja-card ja-campfacts"><ul class="ja-list">${facts.map(([i, k, v]) => `<li class="ja-row"><span class="ja-num">${ic(i)}</span><div><small>${esc(k)}</small><b>${esc(v)}</b></div></li>`).join('')}</ul></article>
        <article class="ja-card ja-campfacts"><p class="ja-kicker"><i></i>Pick your days</p><ul class="ja-list" style="margin-top:8px">${(c.days || []).map((d) => `<li class="ja-row"><span class="ja-num">${ic('sun')}</span><div><b>${esc(d.label)}</b><small>${esc(c.timesLabel || '')}</small></div>${state(d)}</li>`).join('')}</ul>
          <div class="ja-actions" style="margin-top:16px"><a class="ja-btn ja-btn-red" href="${campUrl(c.slug)}">Book your place ${ic('arrow')}</a></div>
          <p class="ja-small ja-muted" style="margin-top:10px">You book and pay on the camp page. It takes a couple of minutes.</p></article>
      </div>
      <p class="ja-small ja-muted" style="margin-top:16px">A camp is a separate thing from holiday training at HQ. <button type="button" class="ja-link" data-go="holidays">Looking for holiday training?</button></p>`
  }
  if (CAMP === undefined) el.innerHTML = `${hero({ img: `${CAMP_IMG}/lee-coaching-group.jpg`, kicker: 'Joner Football Camps', title: 'Camps', lede: 'Loading the camp.' })}`
  else draw(CAMP)
  loadCamp().then((c) => { if (!el.hidden || CAMP !== undefined) draw(c) })
}

// ---------- Holiday training: request a session ----------

const KINDS = ['1 on 1', 'Small group', 'Not sure yet']
let kind = ''
export function holidayRequest(D) {
  const names = (D.players || []).map((p) => p.name)
  return `<section class="ja-card ja-holreq" id="hol-request"><p class="ja-kicker"><i></i>Joner Football HQ, Belrose</p><h2 class="ja-h2" style="margin-top:10px">Request a holiday session</h2>
      <p class="ja-muted ja-small" style="margin-top:6px">Tell us what you want and Ligia will come back with times.</p>
      <div class="j-field" style="margin-top:16px"><span>What kind of session?</span><div class="ja-topics">${KINDS.map((k) => `<button type="button" class="j-chip" data-hol-kind="${esc(k)}" aria-pressed="${k === kind}">${esc(k)}</button>`).join('')}</div></div>
      ${names.length > 1 ? `<label class="j-field"><span>Which player?</span><select class="j-select" id="hr-player"><option value="">All of them</option>${names.map((n) => `<option>${esc(n)}</option>`).join('')}</select></label>` : ''}
      <div class="j-two">${D.parentName || names[0] ? '' : '<label class="j-field"><span>Your name</span><input class="j-input" id="hr-name" autocomplete="name"></label>'}<label class="j-field"><span>Mobile <span class="muted">(optional)</span></span><input class="j-input" id="hr-phone" type="tel" inputmode="tel" autocomplete="tel"></label></div>
      <label class="j-field"><span>Which days or times suit you?</span><textarea class="j-textarea" id="hr-when" rows="3" maxlength="1500" placeholder="For example: weekday mornings in the first week of January"></textarea></label>
      <p class="j-err" id="hr-err" hidden></p>
      <div class="ja-actions"><button type="button" class="ja-btn ja-btn-red" data-hol-send>Send request</button><span class="ja-small ja-muted">We reply to ${esc(D.email || 'your email')}</span></div>
    </section>`
}
export function campsCard() {
  return `<button type="button" class="ja-promo ja-camps-card" data-go="camps"><img src="${CAMP_IMG}/camp-team-photo.jpg" alt="" loading="lazy"><span class="go">${ic('arrow')}</span><p class="ja-kicker"><i></i>Joner Football Camps</p><h3>Camps</h3><p>${campOpen(CAMP) ? `${esc(CAMP.title)} is open to book.` : 'Our holiday camps have their own page.'}</p></button>`
}
// Clicks inside the Holiday training page. true = handled.
export async function holidayClick(t, D) {
  const k = t.closest('[data-hol-kind]')
  if (k) {
    kind = k.dataset.holKind
    k.parentElement.querySelectorAll('[data-hol-kind]').forEach((b) => b.setAttribute('aria-pressed', String(b === k)))
    return true
  }
  const btn = t.closest('[data-hol-send]')
  if (!btn) return false
  const box = btn.closest('#hol-request')
  const v = (id) => (box.querySelector(id)?.value || '').trim()
  const err = box.querySelector('#hr-err')
  err.hidden = true
  const name = D.parentName || v('#hr-name') || (D.players || [])[0]?.name || ''
  const when = v('#hr-when')
  if (!kind || when.length < 3 || name.length < 2) { err.textContent = !kind ? 'Pick what kind of session you want.' : name.length < 2 ? 'Add your name.' : 'Tell us which days or times suit you.'; err.hidden = false; return true }
  btn.disabled = true
  btn.textContent = 'Sending'
  const message = ['Topic: Holiday training request', `Session: ${kind}`, `Player: ${v('#hr-player') || (D.players || []).map((p) => p.name).join(', ') || 'Not added yet'}`, 'Sent from My account, Holiday training.', '', `Days or times that suit: ${when}`].join('\n')
  const r = await api('/api/jfp-access', { action: 'contact', name, email: D.email, phone: v('#hr-phone'), message, page: '/jfp-account/#holidays', recaptchaToken: await recaptcha('jfp_contact') })
  if (!r.ok) { btn.disabled = false; btn.textContent = 'Send request'; err.textContent = r.data.error || 'Could not send. Try again, or email ligia@jonerfootball.com.'; err.hidden = false; return true }
  kind = ''
  box.innerHTML = `<p class="ja-kicker"><i></i>Request sent</p><h2 class="ja-h2" style="margin-top:10px">Thanks, we have it</h2><p class="ja-muted" style="margin-top:8px">Ligia will reply to ${esc(D.email || 'your email')} with times, usually within a day.</p>`
  toast('Request sent.')
  return true
}

// ---------- Home: where do you want to go? ----------

// Photo tiles for the things to book, then small tiles for the jobs.
export function homeTiles(D, { booked, bookUrl, owing, gaps, unsigned, reports, solo, newExtra = 0, newHoliday = 0 }) {
  const big = (o) => {
    const inner = `<span class="ph"><img src="${esc(o.img)}" alt="" loading="lazy">${o.badge ? `<span class="ja-tile-badge">${esc(o.badge)}</span>` : ''}</span><span class="tx"><b>${esc(o.title)}</b><small>${esc(o.sub)}</small></span><span class="go" aria-hidden="true">${ic('arrow')}</span>`
    return o.href ? `<a class="ja-tile" href="${esc(o.href)}">${inner}</a>` : `<button type="button" class="ja-tile" data-go="${o.go}">${inner}</button>`
  }
  const small = (o) => `<button type="button" class="ja-tile-sm" data-go="${o.go}">${ic(o.icon)}<b>${esc(o.title)}</b>${o.dot ? '<span class="dot" aria-label="Needs attention"></span>' : ''}${ic('right', 'ja-mr-go')}</button>`
  const camp = campOpen(CAMP)
  const bigs = [
    booked ? { go: 'sessions', img: `${IMG}/lee-ball-900.webp`, title: 'My sessions', sub: 'Dates, times and where to be' } : { href: bookUrl, img: `${IMG}/lee-ball-900.webp`, title: 'Book a session', sub: 'Pick a group on the timetable' },
    { go: 'extra', img: `${IMG}/lee-one-on-one-1200x900.webp`, title: 'Book extra sessions', sub: 'More training in term time', badge: newExtra ? `${newExtra} new` : '' },
    { go: 'holidays', img: `${IMG}/indoor-coaching-900.webp`, title: 'Holiday training', sub: '1 on 1 and small groups at HQ', badge: newHoliday ? `${newHoliday} new` : '' },
    { go: 'camps', img: `${CAMP_IMG}/lee-coaching-group.jpg`, title: 'Camps', sub: camp ? `${CAMP.title}, ${(CAMP.days || []).map((d) => d.short).join(' and ')}` : 'Joner Football Camps', badge: camp ? 'Booking now' : '' },
  ]
  const smalls = D.playerLogin
    ? [booked && { go: 'cancel', icon: 'xcircle', title: "Can't make it" }, { go: 'videos', icon: 'play', title: 'Videos' }, { go: 'contact', icon: 'chat', title: 'Contact us' }]
    // Always six, three and three (Lee, 10 Nov 2026). Waivers still pop up
    // on sign in and sit in To do when one is unsigned.
    : [
      booked ? { go: 'cancel', icon: 'xcircle', title: "Can't make it" } : { go: 'waivers', icon: 'sign', title: 'Waivers', dot: unsigned },
      { go: 'fees', icon: 'card', title: 'Fees', dot: owing },
      { go: 'info', icon: 'user', title: solo ? 'My profile' : 'Player information', dot: gaps },
      { go: 'reports', icon: 'spark', title: 'Player reports', dot: reports },
      { go: 'analysis', icon: 'video', title: 'Game analysis' },
      { go: 'contact', icon: 'chat', title: 'Contact us' },
    ]
  return `<section class="ja-sec ja-tiles-sec" data-home-tiles><div class="ja-sec-head"><div><h2 class="ja-h2">Where do you want to go?</h2></div></div>
    <div class="ja-tiles">${(D.playerLogin ? bigs.slice(0, 1) : bigs).map(big).join('')}</div>
    <div class="ja-tiles-sm">${smalls.filter(Boolean).map(small).join('')}</div></section>`
}

// The camp is open: tell each family once on this device (Lee, 10 Nov 2026:
// "a message pop up in peoples portals"). Never on top of another window.
export function campPopup(go) {
  const c = CAMP
  if (!campOpen(c)) return false
  const key = `ja-camp-pop:${c.id}`
  try { if (localStorage.getItem(key)) return false; localStorage.setItem(key, '1') } catch { return false }
  const p = c.prices || {}
  const sheet = openSheet({ title: c.title || 'Camp', subtitle: 'Joner Football Camps · Booking now' })
  sheet.sheet.classList.add('ja-camp-pop')
  sheet.body.innerHTML = `<img class="ja-camp-pop-img" src="${CAMP_IMG}/lee-coaching-group.jpg" alt="">
    <ul class="ja-list" style="margin-top:12px">
      <li class="ja-row"><span class="ja-num">${ic('calendar')}</span><div><b>${esc(datesLine(c))}</b><small>${esc(c.timesLabel || '')}${c.ages ? ` · ${esc(c.ages)}` : ''}</small></div></li>
      <li class="ja-row"><span class="ja-num">${ic('pin')}</span><div><b>${esc(c.location || '')}</b><small>${esc(c.address || '')}</small></div></li>
      ${p.oneDay ? `<li class="ja-row"><span class="ja-num">${ic('card')}</span><div><b>${esc(aud(p.oneDay))} for one day${p.allDays ? `, ${esc(aud(p.allDays))} for both` : ''}</b><small>Limited places</small></div></li>` : ''}
    </ul>`
  sheet.foot.innerHTML = `<button type="button" class="ja-btn ja-btn-line" data-cpx="later">Not now</button><button type="button" class="ja-btn ja-btn-red" data-cpx="go">See the camp</button>`
  sheet.foot.querySelector('[data-cpx="later"]').addEventListener('click', () => closeSheet())
  sheet.foot.querySelector('[data-cpx="go"]').addEventListener('click', () => { closeSheet(); go('camps') })
  return true
}
