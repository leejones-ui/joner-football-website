// JFP booking page. Password gate, then the whole program as a timetable
// (filter by location, coach, day, book or apply). Tapping a group shows who
// it is for and how it works, then a sheet walks the family through sign in,
// players, the group's questions, the waiver and payment (or an application,
// waitlist request or enquiry).
import { $, esc, api, recaptcha, toast, openSheet, closeSheet, signIn, whoAmI, waiverBlock, money } from './jfp-common.js'

const S = { data: null, filters: { loc: '', coach: '', day: '', show: '' }, phoneDay: '', view: 'week', parent: null, family: null, hold: null, timer: null, toStripe: false }
const SHOW = [['', 'All'], ['book', 'Book now'], ['open', 'Has places']]
const DAY_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const SHORT = { Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed', Thursday: 'Thu', Friday: 'Fri', Saturday: 'Sat', Sunday: 'Sun' }

function track(name, data) { try { window.JonerTracking?.trackEvent?.(name, { custom_data: data }) } catch {} }

// ---------- gate ----------

async function boot() {
  const q = new URLSearchParams(location.search)
  const r = await api('/api/jfp-access', null, { method: 'GET' })
  if (r.data?.ok) return showApp(q)
  $('gate').hidden = false
  setTimeout(() => $('gate-password').focus(), 50)
  $('gate-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    const err = $('gate-err')
    err.hidden = true
    $('gate-btn').disabled = true
    const res = await api('/api/jfp-access', { password: $('gate-password').value, recaptchaToken: await recaptcha('jfp_gate') })
    $('gate-btn').disabled = false
    if (!res.ok) { err.textContent = res.data.error || 'That password did not work.'; err.hidden = false; return }
    $('gate').hidden = true
    showApp(q)
  })
}

async function showApp(q) {
  $('app').hidden = false
  if (q.get('payment') === 'cancelled' && q.get('booking_id') && q.get('release')) {
    // Say only what the server has confirmed (launch review, 5 Oct 2026).
    history.replaceState(null, '', location.pathname)
    $('banner').innerHTML = '<div class="j-box j-box-grey" style="margin-top:16px">Checking your payment</div>'
    const r = await api('/api/jfp-book', { action: 'release', bookingId: q.get('booking_id'), releaseToken: q.get('release') }).catch(() => ({ ok: false, data: {} }))
    const state = r.ok ? r.data.state : 'unknown'
    $('banner').innerHTML = state === 'cancelled'
      ? '<div class="j-box j-box-amber" style="margin-top:16px">Payment cancelled. Nothing was charged and the place has been released.</div>'
      : state === 'paid'
        ? '<div class="j-box j-box-green" style="margin-top:16px"><b>Your payment went through.</b> We are confirming your place and will email you. Please do not pay again.</div>'
        : '<div class="j-box j-box-amber" style="margin-top:16px"><b>We could not confirm the cancellation yet.</b> If you finished paying, you will get a confirmation email. Please do not pay again until you hear from us. Questions? Use Contact us at the bottom of the page.</div>'
  }
  showTab((location.hash || '#timetable').slice(1))
  S.parent = await whoAmI('parent')
  accountLink()
  await load()
  setInterval(() => { if (!document.querySelector('.j-sheet')) load(true) }, 45000)
}

function showTab(tab) {
  if (!['timetable', 'term', 'pricing'].includes(tab)) tab = 'timetable'
  document.querySelectorAll('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== tab })
  document.querySelectorAll('.j-tabs [data-tab]').forEach((a) => a.setAttribute('aria-current', a.dataset.tab === tab ? 'page' : 'false'))
}
window.addEventListener('hashchange', () => showTab(location.hash.slice(1)))

async function load(quiet) {
  const r = await api('/api/jfp-groups', null, { method: 'GET' })
  if (r.status === 401) { location.reload(); return }
  if (!r.ok) { if (!quiet) $('results').innerHTML = `<div class="j-empty">${esc(r.data.error || 'Could not load the timetable. Try again in a minute.')}</div>`; return }
  S.data = r.data
  renderMeta()
  renderFilters()
  renderLocations()
  renderResults()
}

// ---------- top of page ----------

// "Sign in" until a family is signed in, then "My account".
function accountLink() {
  const a = $('acct-link')
  if (a) a.textContent = S.parent ? 'My account' : 'Sign in'
}

function renderMeta() {
  const d = S.data
  $('term-name').textContent = d.termLabel || d.term
  $('term-range').textContent = `${d.termRange} · ${d.weeks} weeks`
  $('term-tab').textContent = d.termLabel || 'Term'
  document.querySelectorAll('.term-name-2').forEach((x) => { x.textContent = d.termLabel || 'This term' })
  $('term-range-2').textContent = `${d.termRange}, ${d.weeks} weeks`
  $('trial-price').textContent = d.trialPriceLabel
  if (d.kitUrl) { $('kit-tab').href = d.kitUrl; $('kit-buy').href = d.kitUrl }
  if (d.kitPriceLabel) $('kit-price').textContent = d.kitPriceLabel
  const rows = (sec) => (d.pricing || []).filter((x) => x.section === sec).map((x) => `<div class="j-prow"><span><b>${esc(x.title)}</b><small>${esc(x.note)}</small></span><span class="p">${esc(x.price)}</span></div>`).join('')
  $('price-term').innerHTML = rows('Term')
  $('price-121').innerHTML = rows('1 to 1')
  const loc = $('f-loc')
  if (loc.options.length < 2) {
    for (const l of d.locations) loc.insertAdjacentHTML('beforeend', `<option value="${esc(l.id)}">${esc(l.name)}</option>`)
    loc.addEventListener('change', () => { S.filters.loc = loc.value; renderLocations(); renderResults() })
  }
  const coach = $('f-coach')
  if (coach.options.length < 2) {
    for (const c of d.coaches) coach.insertAdjacentHTML('beforeend', `<option value="${esc(c.id)}">${esc(c.name)}</option>`)
    coach.addEventListener('change', () => { S.filters.coach = coach.value; renderResults() })
  }
}

function days(list) { return [...new Set(list.map((g) => g.day))].sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b)) }

function renderLocations() {
  $('locs').innerHTML = S.data.locations.map((l) => {
    const badge = l.full ? 'Fully booked' : `${l.groups} group${l.groups === 1 ? '' : 's'} · ${l.spots} spot${l.spots === 1 ? '' : 's'} left`
    return `<button type="button" class="j-loc" data-loc="${esc(l.id)}" aria-pressed="${S.filters.loc === l.id}">
      <div class="img">${l.photo ? `<img src="${esc(l.photo)}" alt="" loading="lazy" decoding="async">` : ''}<span class="badge">${esc(badge)}</span></div>
      <div class="body"><h3><span class="j-dot j-dot-${esc(l.id)}"></span> ${esc(l.name)}</h3>${l.maps ? `<p><a href="${esc(l.maps)}" target="_blank" rel="noopener noreferrer" data-stop>Map</a></p>` : ''}</div>
    </button>`
  }).join('')
}

function renderFilters() {
  // No Book now groups right now (Lee: everything is Apply): no Book now filter.
  const anyBook = S.data?.groups?.some((g) => g.mode === 'direct')
  $('f-show').innerHTML = SHOW.filter(([v]) => anyBook || v !== 'book').map(([v, l]) => `<button type="button" class="j-chip" data-show="${esc(v)}" aria-pressed="${S.filters.show === v}">${esc(l)}</button>`).join('')
}

// ---------- the timetable ----------

function visible() {
  const f = S.filters
  return S.data.groups.filter((g) => {
    if (f.loc && g.locationId !== f.loc) return false
    if (f.coach && g.coachId !== f.coach) return false
    if (f.day && g.day !== f.day) return false
    if (f.show === 'book' && g.mode !== 'direct') return false
    if (f.show === 'apply' && g.mode !== 'application') return false
    if (f.show === 'open' && (g.full || g.mode === 'enquire')) return false
    return true
  }).sort((a, b) => order(a) - order(b))
}
const order = (g) => DAY_ORDER.indexOf(g.day) * 10000 + Number(g.sortTime.replace(':', ''))

// What a spot asks of a player, in one list: ages, girls only, the level
// rules Lee ticks per group, and the JF playing kit (required for everyone).
function requirementsOf(g, { ages = true } = {}) {
  return [
    g.id === 'one-to-one' || !ages ? '' : `${g.girlsOnly ? 'Girls only. ' : ''}Age guide: ${g.minAge} to ${g.maxAge}`,
    ...(g.requirements || []),
    g.id === 'one-to-one' ? '' : `JF playing kit (${S.data?.kitPriceLabel || 'A$50'})`,
  ].filter(Boolean)
}

function coachChip(g, size = 28) {
  if (!g.coachName) return ''
  const pic = g.coachPhoto
    ? `<img src="${esc(g.coachPhoto)}" alt="" width="${size}" height="${size}" loading="lazy" decoding="async" class="j-coach-pic" style="width:${size}px;height:${size}px">`
    : `<span class="j-coach-pic j-coach-ini" style="width:${size}px;height:${size}px">${esc(g.coachName.replace(/^Coach\s+/, '').split(/\s+/).map((w) => w[0]).join('').slice(0, 2))}</span>`
  return `<span class="j-coach">${pic}<span>${esc(g.coachName)}</span></span>`
}

function agesLabel(g) { return g.girlsOnly ? `Girls, age guide ${g.minAge} to ${g.maxAge}` : `Age guide ${g.minAge} to ${g.maxAge}` }

function status(g) {
  if (g.mode === 'enquire') return ['s-grey', 'Enquire']
  if (g.full) return ['s-full', 'Join the waitlist']
  const left = `${g.placesLeft} ${g.placesLeft === 1 ? 'spot' : 'spots'} left`
  return g.mode === 'direct' ? ['s-book', left] : ['s-apply', left]
}

// A full group normally takes the waitlist. Groups Lee marks "keep taking
// applications" (popular spots) still say Apply when full.
function waitOnly(g) { return g.full && !g.applyWhenFull }
function actLabel(g) { return g.mode === 'enquire' ? 'Enquire' : waitOnly(g) ? 'Join the waitlist' : g.mode === 'direct' && !g.full ? 'Book' : 'Apply' }

function block(g) {
  const [cls, text] = status(g)
  return `<button type="button" class="j-blk j-blk-${esc(g.locationId)} ${g.full ? 'is-full' : ''}" data-group="${esc(g.id)}">
    ${locBanner(g)}
    <span class="t">${esc(g.time)}${g.label && !['Small group', '1 to 1'].includes(g.label) ? ` <span class="j-tag">${esc(g.label)}</span>` : ''}${g.allowOneToOne ? ' <span class="j-tag">Group or 1 to 1</span>' : ''}</span>
    <span class="c c-name">${esc(g.coachName || 'Joner Football')}</span>
    ${g.girlsOnly ? '<span class="c">Girls only</span>' : ''}
    <span class="left">${g.mode === 'enquire' ? 'On request' : g.full ? 'Fully booked' : esc(text)}</span>
    <span class="act ${waitOnly(g) ? 'act-wait' : g.mode === 'direct' ? 'act-book' : 'act-apply'}">${actLabel(g)}</span>
  </button>`
}

// Every group carries its location as a banner across the top, in the
// location's colour. Fully booked sits in the same strip, so every card's
// time and button line up whether it is full or not.
function locBanner(g) {
  return `<span class="j-lb j-lb-${esc(g.locationId)}"><span>${esc(g.locationBanner || g.location)}</span>${g.full ? '<span class="full">Fully booked</span>' : ''}</span>`
}

// A group as a card: the location banner, then the time and who it is for
// stand out, then the coach, places left and one button.
function card(g) {
  const [cls, text] = status(g)
  const btn = actLabel(g)
  return `<article class="j-group j-card-photo ${g.full ? 'is-full' : ''}">
    <button type="button" class="j-card-hit" data-group="${esc(g.id)}" aria-label="${esc(`${g.day} ${g.time}, ${g.coachName}`)}"></button>
    ${locBanner(g)}
    <div class="bd">
      <p class="when-big">${esc(g.time)}${g.label && !['Small group', '1 to 1'].includes(g.label) ? ` <span class="j-tag">${esc(g.label)}</span>` : ''}${g.allowOneToOne ? ' <span class="j-tag">Group or 1 to 1</span>' : ''}</p>
      <p class="meta" style="margin-top:6px">${coachChip(g, 32)}</p>
      <p class="meta">${esc(g.location)} · ${esc(g.durationMin)} min${g.girlsOnly ? ' · Girls only' : ''}</p>
      <div class="foot"><span class="st ${cls}">${g.mode === 'enquire' ? '' : g.full ? 'Fully booked' : esc(text)}</span><span class="j-btn ${waitOnly(g) ? 'j-btn-wait' : 'j-btn-dark'} j-act">${btn}</span></div>
    </div>
  </article>`
}

function renderResults() {
  const list = visible()
  const f = S.filters
  $('f-reset').hidden = !(f.loc || f.coach || f.day || f.show)
  if (!list.length) {
    $('results').innerHTML = '<div class="j-empty">No groups match those filters. Try another coach, day or location.</div>'
    $('daybar').innerHTML = ''
    return
  }
  const cols = days(list)
  const phone = window.matchMedia('(max-width: 899px)').matches
  // A phone always shows one day; a laptop starts on the whole week.
  const view = phone ? 'day' : S.view
  if (!cols.includes(S.phoneDay)) S.phoneDay = cols[0]
  $('daybar').innerHTML = `${phone ? '' : `<button type="button" role="tab" data-pday="week" aria-selected="${view === 'week'}">Whole week</button>`}${cols.map((d) => `<button type="button" role="tab" data-pday="${esc(d)}" aria-selected="${view === 'day' && S.phoneDay === d}">${esc(phone ? SHORT[d] || d : d)}</button>`).join('')}`
  const periods = [['am', 'Morning'], ['pm', 'Afternoon']].filter(([p]) => list.some((g) => g.period === p))
  if (view === 'week') {
    $('results').innerHTML = `<div class="j-tt" style="--cols:${cols.length};display:grid">
      ${cols.map((d) => `<div class="j-tt-day">${esc(d)}</div>`).join('')}
      ${periods.map(([p, label]) => `<div class="j-tt-row">${esc(label)}</div>${cols.map((d) => `<div class="j-tt-cell">${list.filter((g) => g.day === d && g.period === p).map(block).join('')}</div>`).join('')}`).join('')}
    </div>`
    return
  }
  const today = list.filter((g) => g.day === S.phoneDay)
  $('results').innerHTML = periods.map(([p, label]) => {
    const rows = today.filter((g) => g.period === p)
    return rows.length ? `<p class="j-tt-row" style="margin:16px 0 10px">${esc(S.phoneDay)} ${esc(label.toLowerCase())}</p><div class="j-grid">${rows.map(card).join('')}</div>` : ''
  }).join('')
}
window.addEventListener('resize', () => { if (S.data) renderResults() })

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-stop]')) return
  const tab = e.target.closest('.j-tabs [data-tab]')
  if (tab) { e.preventDefault(); history.replaceState(null, '', `#${tab.dataset.tab}`); showTab(tab.dataset.tab); return }
  const locBtn = e.target.closest('[data-loc]')
  if (locBtn) { S.filters.loc = S.filters.loc === locBtn.dataset.loc ? '' : locBtn.dataset.loc; $('f-loc').value = S.filters.loc; renderLocations(); renderResults(); return }
  const s = e.target.closest('[data-show]')
  if (s) { S.filters.show = s.dataset.show; renderFilters(); renderResults(); return }
  const pd = e.target.closest('[data-pday]')
  if (pd) { if (pd.dataset.pday === 'week') S.view = 'week'; else { S.view = 'day'; S.phoneDay = pd.dataset.pday } renderResults(); return }
  if (e.target.closest('#f-reset')) { S.filters = { loc: '', coach: '', day: '', show: '' }; $('f-coach').value = ''; $('f-loc').value = ''; renderFilters(); renderLocations(); renderResults(); return }
  const blk = e.target.closest('[data-group]')
  if (blk) { const g = S.data.groups.find((x) => x.id === blk.dataset.group); if (g) groupSheet(g) }
})

// ---------- one group: who it is for, how it works ----------

function groupSheet(g) {
  const sheet = openSheet({ title: `${g.day} ${g.time}`, subtitle: `${g.location} · ${g.coachName || 'Joner Football'} · ${g.durationMin} minutes` })
  const taken = Math.max(0, g.capacity - Math.max(0, g.placesLeft ?? 0))
  const pills = [
    g.mode === 'direct' ? '<span class="j-pill j-pill-green">Book now</span>' : g.mode === 'application' ? '<span class="j-pill j-pill-blue">Apply only</span>' : '<span class="j-pill j-pill-grey">Enquire</span>',
    g.full ? '<span class="j-pill j-pill-red">Fully booked</span>' : g.placesLeft != null ? `<span class="j-pill j-pill-grey">${taken} of ${g.capacity} places taken</span>` : '',
    g.label && !['Small group'].includes(g.label) ? `<span class="j-pill j-pill-grey">${esc(g.label)}</span>` : '',
  ].join(' ')
  // Ages as a guide, then what the group asks of a player. Nothing that
  // invites a family to pick a group above the player's level.
  const who = `<ul class="j-req">${requirementsOf(g).map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
    ${g.requirementsText ? `<div class="j-reqtext">${g.requirementsText.split(/\n\s*\n/).map((para) => `<p>${esc(para).replace(/\n/g, '<br>')}</p>`).join('')}</div>` : ''}
    ${g.publicNote ? `<p style="margin-top:6px">${esc(g.publicNote)}</p>` : ''}
    <p class="small" style="margin-top:6px">Our coaches place every player with others at their level, so each ${g.mode === 'direct' ? 'booking is for players who meet the above' : 'application is reviewed'}.</p>`
  const steps = waitOnly(g)
    ? ['This group is fully booked right now.', 'Join the waitlist and we will contact you if a place opens.']
    : g.mode === 'direct'
      ? [`Sign in with your email, then add the player and sign the waiver.`, `Pay and the place is yours${g.sessions ? `: every session from the next one to ${esc(g.lastDate)}` : ''}.`, 'Joining after the term starts? You only pay for the sessions left.']
      : ['Apply with the player\'s club and team. It takes 2 minutes.', `We reply within 48 hours with one of three answers:`, 'The place is only held once it is paid.']
  const outcomes = !waitOnly(g) && g.mode === 'application' ? `<div class="j-outcomes">
      <div class="j-card"><b>Accepted for the term</b><span>If we know the player or they fit the group. Pay to lock in the place.</span></div>
      ${g.trials ? `<div class="j-card"><b>Trial first, ${esc(S.data.trialPriceLabel)}</b><span>One session in this group. If it is a good fit, pay for the rest of the term in My account, with the trial taken off.</span></div>` : ''}
      <div class="j-card"><b>Not this group</b><span>If it is not the right level, we will tell you, and suggest a group that is.</span></div>
    </div>` : ''
  sheet.body.innerHTML = `
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">${pills}</div>
    ${g.coachName ? `<div style="margin-bottom:14px">${coachChip(g, 56)}</div>` : ''}
    <div class="j-box j-box-grey" style="margin-bottom:16px"><b>Requirements for this spot</b>${who}</div>
    <h3 style="margin-bottom:6px">How it works</h3>
    <ol class="j-steps-list">${steps.map((t, i) => `<li><span class="n">${i + 1}</span><span>${t}${i === 1 ? outcomes : ''}</span></li>`).join('')}</ol>
    <p class="muted small" style="margin-top:10px">${esc(g.sessions)} weekly sessions this term, ${esc(g.firstDate)} to ${esc(g.lastDate)}.${g.noSession?.length ? ` No session on ${esc(g.noSession.join(', '))}.` : ''}</p>`
  const kind = waitOnly(g) ? 'waitlist' : g.full ? 'application' : g.mode === 'direct' ? 'book' : g.mode === 'application' ? 'application' : 'enquiry'
  const label = { waitlist: 'Join the waitlist', book: 'Book this group', application: 'Apply for this group', enquiry: 'Enquire' }[kind]
  sheet.foot.innerHTML = `<button type="button" class="j-btn j-btn-dark j-btn-block j-btn-lg" id="g-go">${label}</button>`
  sheet.foot.querySelector('#g-go').addEventListener('click', () => start(kind, g))
}

// ---------- the booking sheet ----------

const F = {} // flow state for the open sheet

function groupLine(g) { return g.id === 'one-to-one' ? `Private sessions at ${g.location}, times on request` : `${g.day} ${g.time} · ${g.location}${g.coachName ? ` · ${g.coachName}` : ''}` }

async function start(kind, g, btn) {
  if (!g) return
  Object.keys(F).forEach((k) => delete F[k])
  Object.assign(F, { kind, g, selected: new Map(), newPlayers: [], waiver: null })
  const titles = { book: 'Book this group', application: 'Apply for this group', waitlist: 'Join the waitlist', enquiry: 'Enquire about 1 to 1' }
  F.titles = titles
  F.sheet = openSheet({ title: titles[kind], subtitle: groupLine(g), onClose: () => { releaseHold(); load(true) } })
  if (S.parent) return afterSignIn()
  stepWho()
}

// The place is held once we know who is booking (a signed-in parent), so
// nobody can hold every group just by tapping Book.
async function afterSignIn() {
  if (F.kind !== 'book' || S.hold) return stepPlayers()
  F.sheet.body.innerHTML = '<p class="muted">Holding your place</p>'
  F.sheet.foot.innerHTML = ''
  const r = await api('/api/jfp-book', { action: 'reserve', groupId: F.g.id, recaptchaToken: await recaptcha('jfp_reserve') })
  if (r.status === 401 && r.data.code === 'signin') { S.parent = null; return stepWho() }
  if (r.status === 401) { location.reload(); return }
  if (!r.ok) {
    if (r.data.code === 'full') {
      // Straight on to the waitlist for the same group.
      F.kind = 'waitlist'
      F.sheet.setTitle(F.titles.waitlist, groupLine(F.g))
      toast('That group has just filled. You can join the waitlist.')
      return stepPlayers()
    }
    F.sheet.body.innerHTML = `<div class="j-box j-box-amber">${esc(r.data.error || 'Could not hold that place. Try again.')}</div>`
    return
  }
  S.hold = { bookingId: r.data.bookingId, releaseToken: r.data.releaseToken, expiresAt: Date.parse(r.data.expiresAt) }
  track('InitiateCheckout', { content_category: 'jfp_term', content_name: F.g.id })
  startTimer()
  stepPlayers()
}

function releaseHold(beacon) {
  const h = S.hold
  S.hold = null
  clearInterval(S.timer)
  if (!h) return
  const body = JSON.stringify({ action: 'release', bookingId: h.bookingId, releaseToken: h.releaseToken })
  if (beacon && navigator.sendBeacon) navigator.sendBeacon('/api/jfp-book', new Blob([body], { type: 'application/json' }))
  else fetch('/api/jfp-book', { method: 'POST', credentials: 'same-origin', keepalive: true, headers: { 'content-type': 'application/json' }, body }).catch(() => {})
}
window.addEventListener('pagehide', () => { if (!S.toStripe) releaseHold(true) })

function startTimer() {
  clearInterval(S.timer)
  const tick = () => {
    const el = F.sheet?.timer
    if (!el || !S.hold) return
    const left = Math.max(0, S.hold.expiresAt - Date.now())
    const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000)
    el.hidden = false
    el.textContent = left > 0 ? `Your place is held for ${m}:${String(s).padStart(2, '0')}` : 'Your hold ended. We will try to hold the place again when you pay.'
    if (left <= 0) clearInterval(S.timer)
  }
  tick()
  S.timer = setInterval(tick, 1000)
}

// Booking and applying both take the waiver; waitlist and enquiries do not.
function needsWaiverStep() { return F.kind === 'book' || F.kind === 'application' }
function stepsFor() { return F.kind === 'book' ? 4 : F.kind === 'application' ? 4 : 3 }

function stepWho() {
  F.sheet.setSteps(stepsFor(), 0)
  const g = F.g
  F.sheet.body.innerHTML = `
    <div class="j-box j-box-grey" style="margin-bottom:16px">${g.id === 'one-to-one' ? '<b>1 to 1 coaching</b><br>Tell us who it is for and the times that suit. Lee or Ligia will be in touch.' : `<b>${esc(agesLabel(g))}</b><br>${esc(g.sessions)} weekly sessions, ${esc(g.firstDate)} to ${esc(g.lastDate)}`}</div>
    <h3 style="margin-bottom:10px">Who is training?</h3>
    <button type="button" class="j-choice" data-who="current"><span class="ico">↺</span><span><b>A current JFP player</b><small>Trained with us this year. Sign in with the email we have and your details and waiver are already on file.</small></span></button>
    <button type="button" class="j-choice" data-who="new"><span class="ico">+</span><span><b>New to JFP</b><small>First time with Joner Football. A couple of minutes of details, then the waiver.</small></span></button>`
  F.sheet.foot.innerHTML = '<p class="muted small">Both start with your email address. We send a code, no password.</p>'
  F.sheet.body.querySelectorAll('[data-who]').forEach((b) => b.addEventListener('click', () => stepSignIn(b.dataset.who)))
}

async function stepSignIn(who) {
  F.who = who
  F.sheet.setSteps(stepsFor(), 0)
  const intro = who === 'current' ? 'Use the email address you gave Joner Football, so we can find your players.' : 'Your email is where we send the confirmation and every session date.'
  const u = await signIn({ mount: F.sheet.body, foot: F.sheet.foot, audience: 'parent', intro })
  S.parent = { email: u.email }
  afterSignIn()
}

async function loadFamily() {
  const r = await api('/api/jfp-book', { action: 'family', groupId: F.g.id })
  if (r.status === 401 && r.data.code === 'signin') { S.parent = null; stepWho(); return null }
  if (!r.ok) { toast(r.data.error || 'Could not load your players.'); return null }
  S.family = r.data
  return r.data
}

function playerRow(p) {
  const on = F.selected.has(p.key)
  let status = ''
  let off = false
  if (p.inGroup) { status = '<span class="j-pill j-pill-green">Already in this group</span>'; off = true }
  else if (p.fits === false) status = `<span class="j-pill j-pill-amber">Age ${esc(p.age)}, outside this group: you can apply instead</span>`
  else status = `${p.age != null ? `<span class="muted small">Age ${esc(p.age)}</span> ` : ''}${p.waiverOnFile ? '<span class="j-pill j-pill-green">Waiver on file</span>' : '<span class="j-pill j-pill-amber">Waiver needed</span>'}`
  return `<button type="button" class="j-player ${on ? 'on' : ''} ${off ? 'off' : ''}" data-key="${esc(p.key)}" ${off ? 'disabled' : ''} aria-pressed="${on}">
    <span><b>${esc(p.name)}</b><br>${status}</span><span aria-hidden="true" style="font-size:20px">${on ? '●' : '○'}</span></button>
    ${on && (p.needsDob || !p.waiverOnFile) ? detailFields(`x-${p.key}`, { dob: p.needsDob, name: false, emergency: !p.waiverOnFile && needsWaiverStep() }) : ''}`
}

function detailFields(id, { dob = true, name = true, emergency = true }) {
  return `<div class="j-card" style="padding:12px 14px;margin:-2px 0 10px" data-details="${esc(id)}">
    ${name ? `<label class="j-field"><span>Player's full name</span><input class="j-input" data-f="name" autocomplete="off"></label>` : ''}
    ${dob ? `<label class="j-field"><span>Date of birth</span><input class="j-input" type="date" data-f="dob" max="2023-12-31" min="2004-01-01"></label>` : ''}
    ${emergency ? `<div class="j-two"><label class="j-field"><span>Emergency contact</span><input class="j-input" data-f="emergencyName" autocomplete="off"></label><label class="j-field"><span>Their phone</span><input class="j-input" type="tel" data-f="emergencyPhone" inputmode="tel"></label></div>
    <label class="j-field"><span>Current club <span class="muted">(optional)</span></span><input class="j-input" data-f="club"></label>
    <label class="j-field"><span>Medical notes <span class="muted">(optional)</span></span><input class="j-input" data-f="medical" placeholder="Allergies, asthma, injuries"></label>` : ''}
  </div>`
}

async function stepPlayers() {
  F.sheet.setSteps(stepsFor(), 1)
  F.sheet.body.innerHTML = '<p class="muted">Loading your players</p>'
  F.sheet.foot.innerHTML = ''
  const fam = S.family?.email === S.parent?.email && S.family?.groupId === F.g.id ? S.family : await loadFamily()
  if (!fam) return
  fam.groupId = F.g.id
  renderPlayers()
}

function renderPlayers() {
  const fam = S.family
  const g = F.g
  const found = fam.players.length
  F.sheet.body.innerHTML = `
    <p class="muted small" style="margin-bottom:12px">Signed in as <b>${esc(fam.email)}</b> · <button type="button" class="j-btn j-btn-ghost j-btn-sm" id="not-me">Not you?</button></p>
    ${found ? `<h3 style="margin-bottom:8px">Your players</h3>${fam.players.map(playerRow).join('')}` : `<div class="j-box j-box-grey" style="margin-bottom:12px">${F.who === 'current' ? 'We could not find players under this email. If you used another email with us, sign in with that one, or add the player below.' : 'Add the player who will train.'}</div>`}
    <div id="new-players">${F.newPlayers.map((_, i) => `<div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px"><h3>New player ${i + 1}</h3><button type="button" class="j-btn j-btn-ghost j-btn-sm" data-remove-new="${i}">Remove</button></div>${detailFields(`n-${i}`, { dob: true, name: true, emergency: needsWaiverStep() })}`).join('')}</div>
    <button type="button" class="j-btn j-btn-line j-btn-block" id="add-new" style="margin-top:6px">+ Add a new player</button>
    <h3 style="margin:18px 0 8px">Your details</h3>
    <div class="j-two"><label class="j-field"><span>Parent or guardian name</span><input class="j-input" id="p-name" autocomplete="name" value="${esc(fam.parentName || '')}"></label>
    <label class="j-field"><span>Mobile</span><input class="j-input" id="p-mobile" type="tel" autocomplete="tel" inputmode="tel" value="${esc(fam.mobile || '')}"></label></div>
    <p class="muted small">${esc(agesLabel(g))}, on the first day of term.</p>
    <p class="j-err" id="pl-err" hidden></p>`
  restoreNew()
  F.sheet.foot.innerHTML = `<button type="button" class="j-btn j-btn-dark j-btn-block j-btn-lg" id="pl-next">Continue</button>`
  F.sheet.body.querySelectorAll('[data-key]').forEach((b) => b.addEventListener('click', () => {
    saveNew()
    const k = b.dataset.key
    if (F.selected.has(k)) F.selected.delete(k); else F.selected.set(k, {})
    renderPlayers()
  }))
  F.sheet.body.querySelector('#add-new').addEventListener('click', () => { saveNew(); F.newPlayers.push({}); renderPlayers(); F.sheet.body.querySelector(`[data-details="n-${F.newPlayers.length - 1}"] [data-f="name"]`)?.focus() })
  F.sheet.body.querySelectorAll('[data-remove-new]').forEach((b) => b.addEventListener('click', () => { saveNew(); F.newPlayers.splice(Number(b.dataset.removeNew), 1); renderPlayers() }))
  F.sheet.body.querySelector('#not-me').addEventListener('click', async () => { releaseHold(); await api('/api/jfp-auth', { action: 'logout', audience: 'parent' }); S.parent = null; S.family = null; stepWho() })
  F.sheet.foot.querySelector('#pl-next').addEventListener('click', () => { saveNew(); nextFromPlayers() })
}

function readDetails(id) {
  const box = F.sheet.body.querySelector(`[data-details="${id}"]`)
  if (!box) return {}
  const out = {}
  box.querySelectorAll('[data-f]').forEach((i) => { out[i.dataset.f] = i.value.trim() })
  return out
}
function saveNew() {
  if (!F.sheet?.body.querySelector('#new-players')) return
  F.newPlayers = F.newPlayers.map((_, i) => readDetails(`n-${i}`))
  for (const k of F.selected.keys()) F.selected.set(k, { ...F.selected.get(k), ...readDetails(`x-${k}`) })
  F.parentName = F.sheet.body.querySelector('#p-name')?.value.trim() ?? F.parentName
  F.mobile = F.sheet.body.querySelector('#p-mobile')?.value.trim() ?? F.mobile
}
function restoreNew() {
  F.newPlayers.forEach((v, i) => fill(`n-${i}`, v))
  for (const [k, v] of F.selected) fill(`x-${k}`, v)
  if (F.parentName) F.sheet.body.querySelector('#p-name').value = F.parentName
  if (F.mobile) F.sheet.body.querySelector('#p-mobile').value = F.mobile
}
function fill(id, v) {
  const box = F.sheet.body.querySelector(`[data-details="${id}"]`)
  if (!box) return
  box.querySelectorAll('[data-f]').forEach((i) => { if (v[i.dataset.f] != null) i.value = v[i.dataset.f] })
}

function ageOn(dob) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob || '')) return null
  const [y, m, d] = dob.split('-').map(Number)
  const [ty, tm, td] = (S.data.termStartIso || '2026-10-12').split('-').map(Number)
  let a = ty - y
  if (tm < m || (tm === m && td < d)) a -= 1
  return a
}

function chosenPlayers() {
  const fam = S.family
  const list = []
  for (const [key, v] of F.selected) {
    const p = fam.players.find((x) => x.key === key)
    if (p) list.push({ key, existing: p, ...v })
  }
  F.newPlayers.forEach((v) => list.push({ ...v, isNew: true }))
  return list
}

function nextFromPlayers() {
  const err = F.sheet.body.querySelector('#pl-err')
  const show = (m) => { err.textContent = m; err.hidden = false; err.scrollIntoView({ block: 'nearest' }) }
  const g = F.g
  const list = chosenPlayers()
  if (!list.length) return show('Choose a player or add a new one.')
  if (list.length > 4) return show('Book up to 4 players at a time.')
  for (const p of list) {
    const name = p.existing?.name || p.name || ''
    if (p.isNew && (name.length < 3 || !/\s/.test(name))) return show('Enter each new player\'s first and last name.')
    const age = p.existing?.age ?? ageOn(p.dob)
    if (age == null) return show(`Enter ${name || 'the player'}'s date of birth.`)
    // Book now is for players inside the band. Anyone else applies instead.
    if (F.kind === 'book' && (age < g.minAge || age > g.maxAge)) {
      err.innerHTML = `${esc(name)} is ${esc(age)} on the first day of term. This group books online for ages ${esc(g.minAge)} to ${esc(g.maxAge)}, so apply instead: we reply within 48 hours, maybe with a trial first. <button type="button" class="j-btn j-btn-line j-btn-sm" id="to-apply" style="margin-top:8px">Apply instead</button>`
      err.hidden = false
      err.querySelector('#to-apply').addEventListener('click', () => { releaseHold(); F.kind = 'application'; F.sheet.setTitle(F.titles.application); F.sheet.timer.hidden = true; renderPlayers(); F.sheet.setSteps(stepsFor(), 1) })
      return
    }
    const needsWaiver = p.isNew || !p.existing?.waiverOnFile
    if (needsWaiverStep() && needsWaiver && (!(p.emergencyName || '').length || (p.emergencyPhone || '').replace(/\D/g, '').length < 8)) return show(`Add an emergency contact and phone for ${name}.`)
  }
  if ((F.parentName || '').length < 2) return show('Enter your name.')
  if ((F.mobile || '').replace(/\D/g, '').length < 8) return show('Enter a mobile number we can reach you on.')
  F.players = list
  const needsWaiver = list.some((p) => p.isNew || !p.existing?.waiverOnFile)
  if (F.kind === 'book') return needsWaiver ? stepWaiver() : stepReview()
  if (F.kind === 'application') return stepQuestions()
  return stepMessage()
}

// ---------- the group's questions (applications) ----------

function stepQuestions() {
  F.sheet.setSteps(stepsFor(), 2)
  const qs = F.g.questions?.length ? F.g.questions : [{ key: 'club', label: 'Club they play for' }, { key: 'team', label: 'Team and age group' }]
  const a = F.answers || {}
  const seg = (key, opts) => `<div class="j-seg" data-seg="${key}">${opts.map((o) => `<button type="button" data-v="${esc(o)}" aria-pressed="${a[key] === o}">${esc(o)}</button>`).join('')}</div>`
  const field = (q) => {
    if (q.key === 'playingUp') return `<div class="j-field"><span>${esc(q.label)}</span>${seg('playingUp', ['Own age', 'Playing up', 'Playing down'])}</div>`
    if (q.key === 'trainedBefore') return `<div class="j-field"><span>${esc(q.label)}</span>${seg('trainedBefore', ['Yes', 'No'])}</div>`
    const ph = { club: 'For example Belrose Terrey Hills Raiders', team: 'For example U11 Division 1', position: 'For example winger' }[q.key] || ''
    if (q.key === 'videos') return `<label class="j-field"><span>${esc(q.label)}</span><textarea class="j-textarea" data-q="videos" placeholder="Paste YouTube, Instagram, Hudl or Google Drive links, one per line" style="min-height:64px">${esc(a.videos || '')}</textarea><small class="muted small" style="display:block;margin-top:4px">New to Joner? A clip or two of the player helps our coaches place them faster.</small></label>`
    return `<label class="j-field"><span>${esc(q.label)}</span><input class="j-input" data-q="${esc(q.key)}" value="${esc(a[q.key] || '')}" placeholder="${esc(ph)}"></label>`
  }
  F.sheet.body.innerHTML = `
    <h3 style="margin-bottom:4px">About the player</h3>
    <p class="muted small" style="margin-bottom:14px">${esc(F.players.map((p) => p.existing?.name || p.name).join(' and '))} · ${esc(F.g.day)} ${esc(F.g.time)}</p>
    ${qs.map(field).join('')}
    <label class="j-field"><span>Anything the coach should know <span class="muted">(optional)</span></span><textarea class="j-textarea" id="q-msg">${esc(F.message || '')}</textarea></label>
    <p class="j-err" id="q-err" hidden></p>`
  F.sheet.body.querySelectorAll('[data-seg] button').forEach((b) => b.addEventListener('click', () => {
    const box = b.closest('[data-seg]')
    box.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)))
  }))
  const read = () => {
    const out = {}
    F.sheet.body.querySelectorAll('[data-q]').forEach((i) => { out[i.dataset.q] = i.value.trim() })
    F.sheet.body.querySelectorAll('[data-seg]').forEach((box) => { const on = box.querySelector('[aria-pressed="true"]'); if (on) out[box.dataset.seg] = on.dataset.v })
    F.message = F.sheet.body.querySelector('#q-msg').value.trim()
    return out
  }
  const needsWaiver = F.players.some((p) => p.isNew || !p.existing?.waiverOnFile)
  F.sheet.foot.innerHTML = `<div style="display:flex;gap:8px"><button type="button" class="j-btn j-btn-line" id="q-back">Back</button><button type="button" class="j-btn j-btn-dark j-btn-lg" style="flex:1" id="q-next">${needsWaiver ? 'Next: waiver' : 'Send application'}</button></div>`
  F.sheet.foot.querySelector('#q-back').addEventListener('click', () => { F.answers = read(); renderPlayers(); F.sheet.setSteps(stepsFor(), 1) })
  F.sheet.foot.querySelector('#q-next').addEventListener('click', () => {
    F.answers = read()
    const missing = qs.find((q) => !F.answers[q.key] && ['club', 'team'].includes(q.key))
    if (missing) { const e = F.sheet.body.querySelector('#q-err'); e.textContent = `Add the ${missing.label.toLowerCase()}.`; e.hidden = false; return }
    if (needsWaiver) return stepWaiver()
    sendRequest(F.sheet.foot.querySelector('#q-next'))
  })
}

function stepWaiver() {
  F.sheet.setSteps(stepsFor(), 2)
  const names = F.players.filter((p) => p.isNew || !p.existing?.waiverOnFile).map((p) => p.existing?.name || p.name)
  const w = waiverBlock(S.data.term)
  F.sheet.body.innerHTML = `<div class="j-box j-box-grey" style="margin-bottom:14px">This waiver is for <b>${esc(names.join(' and '))}</b>. Players already on file do not need to sign again.</div>`
  F.sheet.body.appendChild(w.el)
  F.sheet.body.insertAdjacentHTML('beforeend', '<p class="j-err" id="w-err" hidden></p>')
  if (F.waiver) {
    const v = F.waiver
    for (const k of ['terms', 'makeups', 'payment', 'emergency']) w.el.querySelector(`[data-w="${k}"]`).checked = v.accepted[k]
    w.el.querySelector('[data-w="media"]').checked = v.media
    w.el.querySelector('[data-w="signature"]').value = v.signature
  }
  F.sheet.foot.innerHTML = `<div style="display:flex;gap:8px"><button type="button" class="j-btn j-btn-line" id="w-back">Back</button><button type="button" class="j-btn j-btn-dark j-btn-lg" style="flex:1" id="w-next">${F.kind === 'application' ? 'Sign and send application' : 'Sign and continue'}</button></div>`
  F.sheet.foot.querySelector('#w-back').addEventListener('click', () => { F.waiver = w.read(); if (F.kind === 'application') return stepQuestions(); renderPlayers(); F.sheet.setSteps(stepsFor(), 1) })
  F.sheet.foot.querySelector('#w-next').addEventListener('click', () => {
    if (!w.complete()) { const e = F.sheet.body.querySelector('#w-err'); e.textContent = 'Tick each of the first four boxes and type your full name to sign.'; e.hidden = false; return }
    F.waiver = w.read()
    if (F.kind === 'application') return sendRequest(F.sheet.foot.querySelector('#w-next'))
    stepReview()
  })
}

function payloadPlayers() {
  return F.players.map((p) => (p.isNew
    ? { name: p.name, dob: p.dob, club: p.club, medical: p.medical, emergencyName: p.emergencyName, emergencyPhone: p.emergencyPhone }
    : { key: p.key, dob: p.dob, club: p.club, medical: p.medical, emergencyName: p.emergencyName, emergencyPhone: p.emergencyPhone }))
}

function stepReview() {
  F.sheet.setSteps(stepsFor(), 3)
  const g = F.g
  const n = F.players.length
  const qt = S.family.quote || {}
  const soloOk = g.allowOneToOne && n === 1 && g.oneToOneOpen && qt.oneToOneCents
  if (!soloOk) F.option = 'group'
  const solo = soloOk && F.option === 'oneToOne'
  const unit = solo ? qt.oneToOneCents : n > 1 ? qt.eachOfTwoCents : qt.oneCents
  const total = money(unit * n)
  F.sheet.body.innerHTML = `
    <h3 style="margin-bottom:10px">Check and pay</h3>
    ${soloOk ? `<div class="j-kitstep" style="margin-top:0"><h4 style="margin-top:0">How do you want this hour?</h4>
      <label class="j-check"><input type="radio" name="r-opt" value="group" ${solo ? '' : 'checked'}> <span><b>Small group, whole term</b> · ${esc(money(qt.oneCents))}<br><span class="muted small">Up to ${esc(g.capacity)} players in the group.</span></span></label>
      <label class="j-check"><input type="radio" name="r-opt" value="oneToOne" ${solo ? 'checked' : ''}> <span><b>1 to 1, whole term</b> · ${esc(money(qt.oneToOneCents))}<br><span class="muted small">The hour is just for your player with ${esc(g.coachName || 'the coach')}.</span></span></label></div>` : ''}
    <dl class="j-kv">
      <dt>Group</dt><dd>${esc(g.day)} ${esc(g.time)}</dd>
      <dt>Where</dt><dd>${esc(g.location)}</dd>
      <dt>Who for</dt><dd>${esc(agesLabel(g))}</dd>
      <dt>Coach</dt><dd>${esc(g.coachName || 'Joner Football')}</dd>
      <dt>Sessions</dt><dd>${qt.proRata ? `${esc(qt.sessions)} of ${esc(qt.of)}, from ${esc(qt.firstDate)} to ${esc(g.lastDate)}` : `${esc(qt.sessions || g.sessions)} weeks, ${esc(qt.firstDate || g.firstDate)} to ${esc(g.lastDate)}`}</dd>
      <dt>Players</dt><dd>${esc(F.players.map((p) => p.existing?.name || p.name).join(', '))}</dd>
      <dt>Waiver</dt><dd>${F.waiver ? 'Signed now' : 'On file'}</dd>
      <dt>Booking</dt><dd>${solo ? '1 to 1 for the term' : 'Small group for the term'}</dd>
      <dt>Total</dt><dd>${esc(total)}${n > 1 ? ` <span class="muted">(${esc(money(unit))} each, sibling rate)</span>` : ''}${qt.proRata ? '<br><span class="muted small">The rest of the term only.</span>' : ''}</dd>
    </dl>
    <label class="j-field" style="margin-top:14px"><span>Anything the coach should know? <span class="muted">(optional)</span></span><textarea class="j-textarea" id="r-notes"></textarea></label>
    ${g.girlsOnly ? '<label class="j-check"><input type="checkbox" id="r-girls"> <span>This is a girls group. Each player I am booking is a girl.</span></label>' : ''}
    ${kitStep()}
    <label class="j-check"><input type="checkbox" id="r-terms"> <span>I agree the place is for the rest of the term and is locked in once paid. No make-up sessions.</span></label>
    <p class="muted small" style="margin-top:8px">Card, Apple Pay, Google Pay or Afterpay. You pay on Stripe's secure page.</p>
    <p class="j-err" id="r-err" hidden></p>`
  F.sheet.foot.innerHTML = `<div style="display:flex;gap:8px"><button type="button" class="j-btn j-btn-line" id="r-back">Back</button><button type="button" class="j-btn j-btn-dark j-btn-lg" style="flex:1" id="r-pay">Pay ${esc(total)}</button></div>`
  F.sheet.foot.querySelector('#r-back').addEventListener('click', () => {
    if (F.players.some((p) => p.isNew || !p.existing?.waiverOnFile)) return stepWaiver()
    renderPlayers()
    F.sheet.setSteps(stepsFor(), 1)
  })
  F.sheet.foot.querySelector('#r-pay').addEventListener('click', pay)
  F.sheet.body.querySelectorAll('[name="r-opt"]').forEach((r) => r.addEventListener('change', () => { F.option = r.value; stepReview() }))
}

// The JF playing kit is required for every player: the family confirms it
// before paying. The shop opens in a new tab, so this sheet stays open.
function kitStep() {
  const url = S.data?.kitUrl || '#'
  return `<div class="j-kitstep"><span class="j-pill j-pill-red">Required</span>
    <h4>JF playing kit, ${esc(S.data?.kitPriceLabel || 'A$50')} a player</h4>
    <p class="muted small">Every player trains in it. <a href="${esc(url)}" target="_blank" rel="noopener noreferrer">Order it from BE Teamsport</a> (opens a new tab).</p>
    <label class="j-check"><input type="radio" name="r-kit" value="ordered"> <span>I have ordered it, or will order it now</span></label>
    <label class="j-check"><input type="radio" name="r-kit" value="has"> <span>The player already has the JF playing kit</span></label>
  </div>`
}

async function pay() {
  const err = F.sheet.body.querySelector('#r-err')
  const show = (m) => { err.textContent = m; err.hidden = false }
  const kit = F.sheet.body.querySelector('input[name="r-kit"]:checked')?.value
  if (!kit) return show('Confirm the JF playing kit. It is required for every player.')
  if (!F.sheet.body.querySelector('#r-terms').checked) return show('Tick the box to agree to the term.')
  const girls = F.sheet.body.querySelector('#r-girls')
  if (girls && !girls.checked) return show('Confirm the players are girls to book this group.')
  const btn = F.sheet.foot.querySelector('#r-pay')
  btn.disabled = true
  btn.textContent = 'Taking you to payment'
  const r = await api('/api/jfp-book', {
    groupId: F.g.id,
    bookingId: S.hold?.bookingId, releaseToken: S.hold?.releaseToken,
    players: payloadPlayers(), waiver: F.waiver || undefined,
    parentName: F.parentName, mobile: F.mobile, notes: F.sheet.body.querySelector('#r-notes').value.trim(),
    girlsConfirmed: Boolean(girls?.checked), agreementAccepted: true, kit, option: F.option === 'oneToOne' ? 'oneToOne' : 'group',
  })
  if (!r.ok || !r.data.url) {
    btn.disabled = false
    btn.textContent = 'Try again'
    if (r.data.code === 'signin') { S.parent = null; return stepWho() }
    // Keep the hold: "only 1 left" still leaves this family their place.
    if (r.data.code === 'full') { show(r.data.error); load(true); return }
    if (r.data.code === 'solo_taken') { F.option = 'group'; show(r.data.error); load(true); return }
    if (r.data.code === 'paid') { show(r.data.error); return }
    return show(r.data.error || 'Could not start the payment. Nothing has been charged.')
  }
  S.toStripe = true
  clearInterval(S.timer)
  try { sessionStorage.setItem('jfp_booking', r.data.bookingId) } catch {}
  location.href = r.data.url
}

// ---------- application, waitlist, enquiry ----------

function stepMessage() {
  F.sheet.setSteps(stepsFor(), 2)
  const k = F.kind
  const help = k === 'waitlist' ? 'Anything we should know? We will contact you if a place opens.' : 'Which days and times suit you for 1 to 1 coaching?'
  F.sheet.body.innerHTML = `
    <label class="j-field"><span>${k === 'enquiry' ? 'Your message' : 'Anything else'}</span><textarea class="j-textarea" id="m-msg" placeholder="${esc(help)}">${esc(F.message || '')}</textarea></label>
    <p class="j-err" id="m-err" hidden></p>`
  const label = k === 'waitlist' ? 'Join the waitlist' : 'Send enquiry'
  F.sheet.foot.innerHTML = `<div style="display:flex;gap:8px"><button type="button" class="j-btn j-btn-line" id="m-back">Back</button><button type="button" class="j-btn j-btn-dark j-btn-lg" style="flex:1" id="m-send">${label}</button></div>`
  F.sheet.foot.querySelector('#m-back').addEventListener('click', () => { renderPlayers(); F.sheet.setSteps(stepsFor(), 1) })
  F.sheet.foot.querySelector('#m-send').addEventListener('click', () => { F.message = F.sheet.body.querySelector('#m-msg').value.trim(); sendRequest(F.sheet.foot.querySelector('#m-send')) })
}

async function sendRequest(btn) {
  const k = F.kind
  btn.disabled = true
  const r = await api('/api/jfp-book', {
    action: 'request', kind: k, groupId: F.g.id, players: payloadPlayers(), parentName: F.parentName, mobile: F.mobile,
    answers: F.answers || {}, message: F.message || '', waiver: F.waiver || undefined,
  })
  btn.disabled = false
  if (!r.ok) {
    if (r.data.code === 'signin') { S.parent = null; return stepWho() }
    toast(r.data.error || 'Could not send. Try again.')
    return
  }
  F.sheet.setSteps(0, 0)
  F.sheet.timer.hidden = true
  const done = k === 'waitlist'
    ? 'You are on the waitlist. If a place opens we will be in touch.'
    : k === 'enquiry' ? 'Lee or Ligia will be in touch about times.' : 'We will reply within 48 hours: a place for the term, or a trial session first. We have emailed you a copy.'
  F.sheet.body.innerHTML = `<div class="j-box j-box-green"><b>Sent.</b> ${done}</div>
    <p class="muted" style="margin-top:14px">You can see it any time in <a href="/jfp-account/">My account</a>.</p>`
  F.sheet.foot.innerHTML = '<button type="button" class="j-btn j-btn-dark j-btn-block" id="m-done">Done</button>'
  F.sheet.foot.querySelector('#m-done').addEventListener('click', () => closeSheet())
}

boot()
