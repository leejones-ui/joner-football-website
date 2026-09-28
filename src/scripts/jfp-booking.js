// JFP booking page. Password gate, locations, age filter, group cards, then
// a sheet that walks a family through sign in, players, waiver and payment
// (or an application, waitlist request or enquiry).
import { $, esc, api, recaptcha, toast, openSheet, closeSheet, signIn, whoAmI, waiverBlock } from './jfp-common.js'

const S = { data: null, filters: { age: '', loc: '', day: '', show: '' }, parent: null, family: null, hold: null, timer: null, toStripe: false }
const DAYS = [['', 'Any day'], ['after', 'After school'], ['early', 'Early morning'], ['sat', 'Saturday']]
const SHOW = [['', 'All'], ['book', 'Book now'], ['apply', 'Apply only']]

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
    api('/api/jfp-book', { action: 'release', bookingId: q.get('booking_id'), releaseToken: q.get('release') })
    $('banner').innerHTML = '<div class="j-box j-box-amber" style="margin-top:16px">Payment cancelled. Nothing was charged and the place has been released.</div>'
    history.replaceState(null, '', location.pathname)
  }
  S.parent = await whoAmI('parent')
  await load()
  setInterval(() => { if (!document.querySelector('.j-sheet')) load(true) }, 45000)
}

async function load(quiet) {
  const r = await api('/api/jfp-groups', null, { method: 'GET' })
  if (r.status === 401) { location.reload(); return }
  if (!r.ok) { if (!quiet) $('results').innerHTML = `<div class="j-empty">${esc(r.data.error || 'Could not load groups. Try again in a minute.')}</div>`; return }
  S.data = r.data
  renderMeta()
  renderFilters()
  renderLocations()
  renderResults()
}

// ---------- top of page ----------

function renderMeta() {
  const d = S.data
  $('term-kicker').textContent = d.term
  $('meta').innerHTML = [`${d.weeks} weeks, ${d.termStart} to ${d.termEnd}`, `${d.priceLabel} per player`, '60 minute sessions'].map((t) => `<span>${esc(t)}</span>`).join('')
  const sel = $('f-age')
  if (sel.options.length < 3) {
    for (let a = d.minAge; a <= d.maxAge; a += 1) sel.insertAdjacentHTML('beforeend', `<option value="${a}">${a}</option>`)
    sel.addEventListener('change', () => { S.filters.age = sel.value; renderResults() })
  }
}

function renderLocations() {
  $('locs').innerHTML = S.data.locations.map((l) => {
    const badge = l.bookable ? `${l.bookable} group${l.bookable === 1 ? '' : 's'} to book · ${l.spots} spot${l.spots === 1 ? '' : 's'}` : 'Apply only'
    return `<button type="button" class="j-loc" data-loc="${esc(l.id)}" aria-pressed="${S.filters.loc === l.id}">
      <div class="img" style="background-image:url('${esc(l.photo)}')"><span class="badge">${esc(badge)}</span></div>
      <div class="body"><h3><span class="j-dot j-dot-${esc(l.id)}"></span> ${esc(l.name)}</h3><p>${esc(l.blurb)}</p>${l.maps ? `<p><a href="${esc(l.maps)}" target="_blank" rel="noopener noreferrer" data-stop>${esc(l.address)}</a></p>` : ''}</div>
    </button>`
  }).join('')
}

function chip(group, value, label, current) {
  return `<button type="button" class="j-chip" data-${group}="${esc(value)}" aria-pressed="${current === value}">${esc(label)}</button>`
}
function renderFilters() {
  $('f-day').innerHTML = DAYS.map(([v, l]) => chip('day', v, l, S.filters.day)).join('')
  $('f-show').innerHTML = SHOW.map(([v, l]) => chip('show', v, l, S.filters.show)).join('')
}

// ---------- results ----------

function dayPart(g) {
  const h = Number(g.sortTime.slice(0, 2))
  if (g.day === 'Saturday' || g.day === 'Sunday') return 'sat'
  if (h < 9) return 'early'
  if (h >= 15) return 'after'
  return 'day'
}

function visible() {
  const f = S.filters
  const age = f.age === '' ? null : Number(f.age)
  return S.data.groups.filter((g) => {
    if (f.loc && g.locationId !== f.loc) return false
    if (f.day && dayPart(g) !== f.day) return false
    if (f.show === 'book' && g.mode !== 'direct') return false
    if (f.show === 'apply' && g.mode === 'direct') return false
    if (age != null && (age < g.minAge || age > g.maxAge)) return false
    return true
  }).sort((a, b) => (Number(b.mode === 'direct' && !b.full) - Number(a.mode === 'direct' && !a.full)) * (age != null ? 1 : 0) || order(a) - order(b))
}
const DAY_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const order = (g) => DAY_ORDER.indexOf(g.day) * 10000 + Number(g.sortTime.replace(':', ''))

function agesLabel(g) { return `${g.girlsOnly ? 'Girls, ' : ''}Ages ${g.minAge} to ${g.maxAge}` }

function spots(g) {
  if (g.mode === 'application') return `<span class="j-pill j-pill-violet">Apply · ${esc(g.label)}</span>`
  if (g.mode === 'enquire') return `<span class="j-pill j-pill-grey">${esc(g.label)} · enquire</span>`
  if (g.full) return '<span class="j-pill j-pill-grey">Full</span>'
  if (g.placesLeft === 1) return '<span class="j-pill j-pill-red">1 spot left</span>'
  if (g.placesLeft <= 2) return `<span class="j-pill j-pill-amber">${g.placesLeft} spots left</span>`
  return `<span class="j-pill j-pill-green">${g.placesLeft} spots left</span>`
}
function cta(g) {
  if (g.mode === 'application') return `<button type="button" class="j-btn j-btn-line" data-act="application" data-id="${esc(g.id)}">Apply</button>`
  if (g.mode === 'enquire') return `<button type="button" class="j-btn j-btn-soft" data-act="enquiry" data-id="${esc(g.id)}">Enquire</button>`
  if (g.full) return `<button type="button" class="j-btn j-btn-line" data-act="waitlist" data-id="${esc(g.id)}">Join waitlist</button>`
  return `<button type="button" class="j-btn j-btn-dark" data-act="book" data-id="${esc(g.id)}">Book</button>`
}

function renderResults() {
  const list = visible()
  const f = S.filters
  const loc = S.data.locations.find((l) => l.id === f.loc)
  const where = loc ? ` at ${loc.name}` : ''
  $('results-title').textContent = f.age !== ''
    ? `${list.length} group${list.length === 1 ? '' : 's'} for a ${f.age} year old${where}`
    : `${list.length} group${list.length === 1 ? '' : 's'}${where}`
  $('f-reset').hidden = !(f.age || f.loc || f.day || f.show)
  $('age-note').hidden = f.age === ''
  if (!list.length) {
    $('results').innerHTML = `<div class="j-empty" style="grid-column:1/-1">No groups match those filters.${f.age ? ' Try another location or day, or email us about 1 to 1 coaching.' : ''}</div>`
    return
  }
  const pc = S.data.privateCoaching
  const showPc = pc && f.show !== 'book' && (!f.loc || f.loc === pc.locationId) && !f.day
  $('results').innerHTML = list.map((g) => `
    <article class="j-group">
      <p class="when">${esc(g.day)} · ${esc(g.time)}</p>
      <p class="who">${esc(agesLabel(g))}</p>
      <p class="meta"><span class="j-dot j-dot-${esc(g.locationId)}"></span>${esc(g.location)}${g.coachName ? ` · ${esc(g.coachName)}` : ''} · ${esc(g.durationMin)} min</p>
      ${g.publicNote ? `<p class="note">${esc(g.publicNote)}</p>` : ''}
      <div class="foot">${spots(g)}${cta(g)}</div>
    </article>`).join('') + (showPc ? `
    <article class="j-group">
      <p class="when">Private coaching</p>
      <p class="who">1 to 1 coaching</p>
      <p class="meta"><span class="j-dot j-dot-${esc(pc.locationId)}"></span>${esc(pc.location)} · times on request · all ages</p>
      <div class="foot"><span class="j-pill j-pill-grey">1 to 1 · enquire</span><button type="button" class="j-btn j-btn-soft" data-act="enquiry" data-id="${esc(pc.id)}">Enquire</button></div>
    </article>` : '')
}

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-stop]')) return
  const locBtn = e.target.closest('[data-loc]')
  if (locBtn) { S.filters.loc = S.filters.loc === locBtn.dataset.loc ? '' : locBtn.dataset.loc; renderLocations(); renderResults(); return }
  const d = e.target.closest('[data-day]')
  if (d) { S.filters.day = d.dataset.day; renderFilters(); renderResults(); return }
  const s = e.target.closest('[data-show]')
  if (s) { S.filters.show = s.dataset.show; renderFilters(); renderResults(); return }
  if (e.target.closest('#f-reset')) { S.filters = { age: '', loc: '', day: '', show: '' }; $('f-age').value = ''; renderFilters(); renderLocations(); renderResults(); return }
  const act = e.target.closest('[data-act]')
  if (act) start(act.dataset.act, act.dataset.id === S.data.privateCoaching?.id ? S.data.privateCoaching : S.data.groups.find((g) => g.id === act.dataset.id), act)
})

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

function stepsFor() { return F.kind === 'book' ? 4 : 3 }

function stepWho() {
  F.sheet.setSteps(stepsFor(), 0)
  const g = F.g
  F.sheet.body.innerHTML = `
    <div class="j-box j-box-grey" style="margin-bottom:16px">${g.id === 'one-to-one' ? '<b>1 to 1 coaching</b><br>Tell us who it is for and the times that suit. Lee or Ligia will be in touch.' : `<b>${esc(agesLabel(g))}</b><br>${esc(g.sessions)} weeks from ${esc(g.firstDate)}${g.priceLabel ? ` · ${esc(g.priceLabel)} per player` : ''}`}</div>
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
  else if (p.fits === false) { status = `<span class="j-pill j-pill-grey">Age ${esc(p.age)}, outside this group</span>`; off = true }
  else status = `${p.age != null ? `<span class="muted small">Age ${esc(p.age)}</span> ` : ''}${p.waiverOnFile ? '<span class="j-pill j-pill-green">Waiver on file</span>' : '<span class="j-pill j-pill-amber">Waiver needed</span>'}`
  return `<button type="button" class="j-player ${on ? 'on' : ''} ${off ? 'off' : ''}" data-key="${esc(p.key)}" ${off ? 'disabled' : ''} aria-pressed="${on}">
    <span><b>${esc(p.name)}</b><br>${status}</span><span aria-hidden="true" style="font-size:20px">${on ? '●' : '○'}</span></button>
    ${on && (p.needsDob || !p.waiverOnFile) ? detailFields(`x-${p.key}`, { dob: p.needsDob, name: false, emergency: !p.waiverOnFile && F.kind === 'book' }) : ''}`
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
    <div id="new-players">${F.newPlayers.map((_, i) => `<div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px"><h3>New player ${i + 1}</h3><button type="button" class="j-btn j-btn-ghost j-btn-sm" data-remove-new="${i}">Remove</button></div>${detailFields(`n-${i}`, { dob: true, name: true, emergency: true })}`).join('')}</div>
    <button type="button" class="j-btn j-btn-line j-btn-block" id="add-new" style="margin-top:6px">+ Add a new player</button>
    <h3 style="margin:18px 0 8px">Your details</h3>
    <div class="j-two"><label class="j-field"><span>Parent or guardian name</span><input class="j-input" id="p-name" autocomplete="name" value="${esc(fam.parentName || '')}"></label>
    <label class="j-field"><span>Mobile</span><input class="j-input" id="p-mobile" type="tel" autocomplete="tel" inputmode="tel" value="${esc(fam.mobile || '')}"></label></div>
    <p class="muted small">${esc(agesLabel(g))}. Ages are on Monday 12 October.</p>
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
    if (age < g.minAge || age > g.maxAge) return show(`${name} is ${age} on the first day of term. This group is for ages ${g.minAge} to ${g.maxAge}. Close this and filter by age to see the groups that fit.`)
    const needsWaiver = p.isNew || !p.existing?.waiverOnFile
    if (F.kind === 'book' && needsWaiver && (!(p.emergencyName || '').length || (p.emergencyPhone || '').replace(/\D/g, '').length < 8)) return show(`Add an emergency contact and phone for ${name}.`)
  }
  if ((F.parentName || '').length < 2) return show('Enter your name.')
  if ((F.mobile || '').replace(/\D/g, '').length < 8) return show('Enter a mobile number we can reach you on.')
  F.players = list
  const needsWaiver = list.some((p) => p.isNew || !p.existing?.waiverOnFile)
  if (F.kind === 'book') return needsWaiver ? stepWaiver() : stepReview()
  return stepMessage()
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
  F.sheet.foot.innerHTML = `<div style="display:flex;gap:8px"><button type="button" class="j-btn j-btn-line" id="w-back">Back</button><button type="button" class="j-btn j-btn-dark j-btn-lg" style="flex:1" id="w-next">Sign and continue</button></div>`
  F.sheet.foot.querySelector('#w-back').addEventListener('click', () => { F.waiver = w.read(); renderPlayers(); F.sheet.setSteps(stepsFor(), 1) })
  F.sheet.foot.querySelector('#w-next').addEventListener('click', () => {
    if (!w.complete()) { const e = F.sheet.body.querySelector('#w-err'); e.textContent = 'Tick each of the first four boxes and type your full name to sign.'; e.hidden = false; return }
    F.waiver = w.read()
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
  const unit = Number(String(S.data.priceLabel).replace(/[^0-9.]/g, ''))
  const total = unit * n
  F.sheet.body.innerHTML = `
    <h3 style="margin-bottom:10px">Check and pay</h3>
    <dl class="j-kv">
      <dt>Group</dt><dd>${esc(g.day)} ${esc(g.time)}</dd>
      <dt>Where</dt><dd>${esc(g.location)}</dd>
      <dt>Who for</dt><dd>${esc(agesLabel(g))}</dd>
      <dt>Coach</dt><dd>${esc(g.coachName || 'Joner Football')}</dd>
      <dt>Dates</dt><dd>${esc(g.sessions)} weeks, ${esc(g.firstDate)} to ${esc(g.lastDate)}</dd>
      <dt>Players</dt><dd>${esc(F.players.map((p) => p.existing?.name || p.name).join(', '))}</dd>
      <dt>Waiver</dt><dd>${F.waiver ? 'Signed now' : 'On file'}</dd>
      <dt>Total</dt><dd>A$${esc(total.toLocaleString('en-AU'))}${n > 1 ? ` <span class="muted">(${esc(S.data.priceLabel)} each)</span>` : ''}</dd>
    </dl>
    <label class="j-field" style="margin-top:14px"><span>Anything the coach should know? <span class="muted">(optional)</span></span><textarea class="j-textarea" id="r-notes"></textarea></label>
    ${g.girlsOnly ? '<label class="j-check"><input type="checkbox" id="r-girls"> <span>This is a girls group. Each player I am booking is a girl.</span></label>' : ''}
    <label class="j-check"><input type="checkbox" id="r-terms"> <span>I agree the place is for the full term and payment is required before the term starts. No make-up sessions.</span></label>
    <p class="muted small" style="margin-top:8px">Card, Apple Pay, Google Pay, Afterpay or Klarna. You pay on Stripe's secure page.</p>
    <p class="j-err" id="r-err" hidden></p>`
  F.sheet.foot.innerHTML = `<div style="display:flex;gap:8px"><button type="button" class="j-btn j-btn-line" id="r-back">Back</button><button type="button" class="j-btn j-btn-dark j-btn-lg" style="flex:1" id="r-pay">Pay A$${esc(total.toLocaleString('en-AU'))}</button></div>`
  F.sheet.foot.querySelector('#r-back').addEventListener('click', () => {
    if (F.players.some((p) => p.isNew || !p.existing?.waiverOnFile)) return stepWaiver()
    renderPlayers()
    F.sheet.setSteps(stepsFor(), 1)
  })
  F.sheet.foot.querySelector('#r-pay').addEventListener('click', pay)
}

async function pay() {
  const err = F.sheet.body.querySelector('#r-err')
  const show = (m) => { err.textContent = m; err.hidden = false }
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
    girlsConfirmed: Boolean(girls?.checked), agreementAccepted: true,
  })
  if (!r.ok || !r.data.url) {
    btn.disabled = false
    btn.textContent = 'Try again'
    if (r.data.code === 'signin') { S.parent = null; return stepWho() }
    if (r.data.code === 'full') { S.hold = null; show(r.data.error); load(true); return }
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
  const help = k === 'application' ? 'Tell us about the player: current club and team, level, and what they want from the Pathway.' : k === 'waitlist' ? 'Anything we should know? We email you a link if a place opens.' : 'Which days and times suit you for 1 to 1 coaching?'
  F.sheet.body.innerHTML = `
    ${k === 'application' ? '<label class="j-field"><span>Current club and team</span><input class="j-input" id="m-club"></label>' : ''}
    <label class="j-field"><span>${k === 'enquiry' ? 'Your message' : 'Anything else'}</span><textarea class="j-textarea" id="m-msg" placeholder="${esc(help)}"></textarea></label>
    <p class="j-err" id="m-err" hidden></p>`
  const label = k === 'application' ? 'Send application' : k === 'waitlist' ? 'Join the waitlist' : 'Send enquiry'
  F.sheet.foot.innerHTML = `<div style="display:flex;gap:8px"><button type="button" class="j-btn j-btn-line" id="m-back">Back</button><button type="button" class="j-btn j-btn-dark j-btn-lg" style="flex:1" id="m-send">${label}</button></div>`
  F.sheet.foot.querySelector('#m-back').addEventListener('click', () => { renderPlayers(); F.sheet.setSteps(stepsFor(), 1) })
  F.sheet.foot.querySelector('#m-send').addEventListener('click', async () => {
    const btn = F.sheet.foot.querySelector('#m-send')
    btn.disabled = true
    const r = await api('/api/jfp-book', {
      action: 'request', kind: k, groupId: F.g.id, players: payloadPlayers(), parentName: F.parentName, mobile: F.mobile,
      club: F.sheet.body.querySelector('#m-club')?.value.trim() || '', message: F.sheet.body.querySelector('#m-msg').value.trim(),
    })
    btn.disabled = false
    if (!r.ok) { const e = F.sheet.body.querySelector('#m-err'); e.textContent = r.data.error || 'Could not send. Try again.'; e.hidden = false; return }
    F.sheet.setSteps(0, 0)
    F.sheet.body.innerHTML = `<div class="j-box j-box-green"><b>Sent.</b> ${k === 'waitlist' ? 'You are on the waitlist. If a place opens we will email you a link to take it.' : 'Lee or Ligia will review it and reply within 48 hours. We have emailed you a copy.'}</div>
      <p class="muted" style="margin-top:14px">You can see it any time in <a href="/jfp-account/">your account</a>.</p>`
    F.sheet.foot.innerHTML = '<button type="button" class="j-btn j-btn-dark j-btn-block" id="m-done">Done</button>'
    F.sheet.foot.querySelector('#m-done').addEventListener('click', () => closeSheet())
  })
}

boot()
