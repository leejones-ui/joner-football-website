// The JFP staff portal. Lee and Ligia see the whole program and the money;
// coaches see the program timetable (names and ages) and their own registers.
// Every change goes to Airtable through /api/jfp-portal-data, which checks
// the role again on the server.
import { $, esc, api, toast, signIn, whoAmI, signOut, money } from './jfp-common.js'

const P = { user: null, tab: '', board: null, loc: '', day: '', coachFilter: '', ttView: 'staff', sel: '', groups: null, coachId: '', coachDate: {}, reqFilter: 'pending', linkFilter: 'open', pricing: null }
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const post = (action, body = {}) => api('/api/jfp-portal-data', { action, ...body })
const view = () => $('view')

// ---------- boot ----------

async function boot() {
  const u = await whoAmI('staff')
  if (!u) return showSignIn()
  P.user = u
  start()
}

async function showSignIn() {
  $('signin').hidden = false
  $('app').hidden = true
  await signIn({ mount: $('si-mount'), foot: $('si-foot'), audience: 'staff', intro: 'Staff only. Enter your work email and we will send you a 6 digit code.' })
  const u = await whoAmI('staff')
  if (!u) { $('si-mount').innerHTML = '<div class="j-box j-box-amber">This email does not have portal access yet. Ask Lee.</div>'; $('si-foot').innerHTML = ''; return }
  P.user = u
  $('signin').hidden = true
  start()
}

function tabs() {
  if (P.user.role !== 'admin') return [['program', 'Program'], ['coach', 'My sessions'], ['profile', 'My profile']]
  return [['board', 'Timetable'], ['requests', 'Requests'], ['payments', 'Payment links'], ['holiday', 'Holiday training'], ['next', 'Next term'], ['prices', 'Prices'], ['groups', 'Groups and rules'], ['money', 'Money'], ['coach', 'Registers'], ['coaches', 'Coaches'], ['removed', 'Removed players'], ['audit', 'Audit log'], ['settings', 'Settings']]
}

function start() {
  $('app').hidden = false
  $('sign-out').hidden = false
  $('who-small').textContent = `${P.user.name} · ${P.user.role === 'admin' ? 'Super admin' : 'Coach'}`
  const hash = location.hash.slice(1)
  go(tabs().some(([k]) => k === hash) ? hash : tabs()[0][0])
}

function renderNav() {
  $('nav').innerHTML = tabs().map(([k, label]) => `<button type="button" data-tab="${k}" aria-current="${P.tab === k ? 'page' : 'false'}">${esc(label)}${k === 'requests' && P.pendingCount ? `<span class="count">${P.pendingCount}</span>` : ''}</button>`).join('')
}

async function go(tab) {
  P.tab = tab
  history.replaceState(null, '', `#${tab}`)
  renderNav()
  view().innerHTML = '<p class="muted">Loading</p>'
  closeSide()
  const fn = { next: renderNext, holiday: renderHoliday, board: renderBoard, program: renderProgram, groups: renderGroups, requests: renderRequests, payments: renderPayments, prices: renderPrices, money: renderMoney, coach: renderCoach, coaches: renderCoaches, profile: renderProfile, removed: renderRemoved, audit: renderAudit, settings: renderSettings }[tab]
  try { await fn() } catch (e) { console.error(e); view().innerHTML = `<div class="j-box j-box-red">Something went wrong loading this page. ${esc(e.message || '')}</div>` }
  view().focus({ preventScroll: true })
}

async function need(r) {
  if (r.status === 401) { await showSignIn(); throw new Error('Signed out') }
  if (!r.ok) throw new Error(r.data.error || 'Request failed')
  return r.data
}

// ---------- small UI kit ----------

function modal(html, { wide = false } = {}) {
  closeModal()
  const scrim = document.createElement('div')
  scrim.className = 'j-scrim'
  scrim.id = 'jp-scrim'
  const box = document.createElement('div')
  box.className = 'jp-modal'
  box.id = 'jp-modal'
  box.setAttribute('role', 'dialog')
  box.setAttribute('aria-modal', 'true')
  if (wide) box.style.width = 'min(760px, calc(100vw - 24px))'
  box.innerHTML = html
  const root = document.querySelector('.jfp')
  root.appendChild(scrim)
  root.appendChild(box)
  scrim.addEventListener('click', closeModal)
  box.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeModal))
  setTimeout(() => box.querySelector('input,select,textarea,button')?.focus(), 30)
  return box
}
function closeModal() { $('jp-scrim')?.remove(); $('jp-modal')?.remove() }
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeModal(); closeMenu() } })

function confirmBox(message, { ok = 'Yes', danger = false } = {}) {
  return new Promise((resolve) => {
    const box = modal(`<p style="font-size:15px;margin-bottom:18px">${message}</p><div style="display:flex;gap:8px;justify-content:flex-end"><button type="button" class="j-btn j-btn-line" data-no>Cancel</button><button type="button" class="j-btn ${danger ? 'j-btn-danger' : 'j-btn-dark'}" data-yes>${esc(ok)}</button></div>`)
    box.querySelector('[data-no]').addEventListener('click', () => { closeModal(); resolve(false) })
    box.querySelector('[data-yes]').addEventListener('click', () => { closeModal(); resolve(true) })
  })
}

function menu(anchor, items) {
  closeMenu()
  const m = document.createElement('div')
  m.className = 'jp-menu'
  m.id = 'jp-menu'
  m.innerHTML = items.map((it) => (it === '-' ? '<hr>' : `<button type="button" data-i="${esc(it.key)}" ${it.danger ? 'style="color:#B42318"' : ''}>${esc(it.label)}</button>`)).join('')
  document.querySelector('.jfp').appendChild(m)
  const r = anchor.getBoundingClientRect()
  const top = Math.min(r.bottom + 4, window.innerHeight - m.offsetHeight - 8)
  const left = Math.min(r.left, window.innerWidth - m.offsetWidth - 8)
  m.style.top = `${Math.max(8, top)}px`
  m.style.left = `${Math.max(8, left)}px`
  m.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (!b) return; closeMenu(); items.find((it) => it.key === b.dataset.i)?.run() })
  setTimeout(() => document.addEventListener('click', closeMenuOutside), 0)
}
function closeMenu() { $('jp-menu')?.remove(); document.removeEventListener('click', closeMenuOutside) }
function closeMenuOutside(e) { if (!e.target.closest('#jp-menu')) closeMenu() }

async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Link copied') } catch { prompt('Copy this link', text) }
}

const payPill = (p) => {
  if (p.trial) return '<span class="j-pill j-pill-blue">Trial</span>'
  const s = p.paymentStatus
  if (s === 'Paid') return '<span class="j-pill j-pill-green">Paid</span>'
  if (s === 'Partially Paid') return '<span class="j-pill j-pill-amber">Part paid</span>'
  if (s === 'Unpaid') return '<span class="j-pill j-pill-red">Unpaid</span>'
  if (s === 'N/A') return '<span class="j-pill j-pill-grey">N/A</span>'
  return '<span class="j-pill j-pill-grey">Not set</span>'
}
const modeLabel = { direct: 'Book now', application: 'Apply only', enquire: 'Enquire', closed: 'Hidden' }
const modePill = (g) => ({ direct: 'green', application: 'violet', enquire: 'grey', closed: 'grey' }[g.mode])
const agesText = (g) => (g.minAge != null ? `${g.girlsOnly === 'yes' ? 'Girls ' : ''}${g.minAge} to ${g.maxAge}` : 'Ages not set')
const timeAgo = (ms) => new Date(ms).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })

// ---------- pricing (mirrors priceFor on the server) ----------

async function pricing() {
  if (!P.pricing) P.pricing = await need(await post('pricing'))
  return P.pricing
}
function priceOf(pr, { product = 'group', day, from, players = 1 }) {
  const prod = pr.products.find((x) => x.key === product) || pr.products[0]
  let key = prod.key
  if (players >= 2 && key === 'group') key = 'twoAWeek'
  const k = pr.products.find((x) => x.key === key)
  const unitFull = Math.round(pr.prices[key] / k.perPlaces)
  const dates = (pr.datesByDay[day] || []).filter((d) => !from || d.iso >= from)
  const sessions = prod.proRata && day ? dates.length : pr.weeks
  const unit = prod.proRata && sessions < pr.weeks ? Math.round((unitFull * sessions) / pr.weeks / 100) * 100 : unitFull
  return { unit, total: unit * players, sessions, of: pr.weeks, proRata: prod.proRata && sessions < pr.weeks }
}
function nextDate(pr, day) { return (pr.datesByDay[day] || []).find((d) => !d.past)?.iso || '' }
function dateOptions(pr, day, selected) {
  return (pr.datesByDay[day] || []).map((d, i) => `<option value="${esc(d.iso)}" ${d.iso === selected ? 'selected' : ''} ${d.past ? 'disabled' : ''}>Week ${i + 1} · ${esc(d.label)}${d.past ? ' (past)' : ''}</option>`).join('')
}
function productOptions(pr, selected, { noTrial = false } = {}) {
  return pr.products.filter((x) => !(noTrial && x.key === 'trial')).map((x) => `<option value="${esc(x.key)}" ${x.key === selected ? 'selected' : ''}>${esc(x.label)} · ${esc(money(x.cents))}${x.perPlaces > 1 ? ' for two' : ''}</option>`).join('')
}

// A small priced form block: product, start week, the amount (editable).
// Returns { el html, read() } wired inside a modal box.
// paid: already paid this term. On a trial row it comes off only when the
// trial box is ticked (and never more than the trial price); otherwise it
// always comes off, so nobody is asked to pay twice.
function priceBlock(box, pr, { day, product, players = 1, credit = false, paid = 0, prefix = 'pb', noTrial = false }) {
  const from = nextDate(pr, day)
  box.querySelector(`#${prefix}`).innerHTML = `
    <div class="j-two"><label class="j-field"><span>Paying for</span><select class="j-select" id="${prefix}-prod">${productOptions(pr, product, { noTrial })}</select></label>
    <label class="j-field"><span>Starts</span><select class="j-select" id="${prefix}-from">${dateOptions(pr, day, from)}</select></label></div>
    ${credit && paid > 0 ? `<label class="j-check"><input type="checkbox" id="${prefix}-credit" checked> <span>Take the ${esc(money(Math.min(paid, pr.prices.trial)))} trial off</span></label>` : ''}
    <div class="j-two"><label class="j-field"><span>Amount (A$)</span><input class="j-input" id="${prefix}-amt" inputmode="decimal"></label><div class="j-field"><span>&nbsp;</span><p class="muted small" id="${prefix}-why" style="padding-top:10px"></p></div></div>
    <label class="j-check"><input type="checkbox" id="${prefix}-afterpay" checked> <span>Afterpay allowed</span></label>`
  const $$ = (id) => box.querySelector(`#${prefix}-${id}`)
  let typed = false
  const calc = () => {
    const q = priceOf(pr, { product: $$('prod').value, day, from: $$('from').value, players })
    const off = credit ? ($$('credit')?.checked ? Math.min(paid, pr.prices.trial, q.total) : 0) : Math.min(paid, q.total)
    if (!typed) $$('amt').value = ((q.total - off) / 100).toFixed(2).replace(/\.00$/, '')
    $$('why').textContent = `${q.proRata ? `Pro rata, ${q.sessions} of ${q.of} sessions` : $$('prod').value === 'trial' || $$('prod').value === 'oneToOne' ? 'One session' : `Full term, ${q.sessions} sessions`}${players > 1 ? `, ${players} players` : ''}${off ? `, less ${money(off)} ${credit ? 'trial' : 'already paid'}` : ''}`
  }
  $$('amt').addEventListener('input', () => { typed = true })
  for (const id of ['prod', 'from', 'credit']) $$(id)?.addEventListener('change', () => { typed = false; calc() })
  calc()
  return () => ({ product: $$('prod').value, startDate: $$('from').value, amountCents: Math.round(Number($$('amt').value) * 100), creditTrial: Boolean(credit && $$('credit')?.checked), afterpay: $$('afterpay').checked })
}

// ---------- timetable (the board) ----------

const PERIODS = [['am', 'Morning'], ['pm', 'Afternoon']]
const locColor = (id) => `var(--j-loc-${id || 'belrose'})`

async function renderBoard(refresh) {
  if (!P.board || refresh !== false) P.board = await need(await post('board'))
  const B = P.board
  P.coaches = B.coaches
  const groups = B.groups.filter((g) => (!P.loc || g.locationId === P.loc) && (!P.coachFilter || g.coachId === P.coachFilter) && (!P.day || g.day === P.day) && (P.ttView === 'staff' || g.mode !== 'closed'))
  const t = B.totals
  view().innerHTML = `
    <div class="jp-head"><div><h1>${esc(B.term)}</h1><p class="muted small">${t.dashboard} confirmed · ${t.players} holding a place · ${t.awaiting} not confirmed yet · ${t.pendingRequests} request${t.pendingRequests === 1 ? '' : 's'} waiting · waivers ${t.waivers}/${t.players} · updated ${esc(timeAgo(B.at))} <button type="button" class="j-btn j-btn-ghost j-btn-sm" id="b-refresh">Refresh</button></p></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><button type="button" class="j-btn j-btn-dark" id="b-add">+ Add player</button><div class="jp-seg" id="b-view">${[['staff', 'Staff view'], ['coach', 'Coach view'], ['parent', 'Parent view']].map(([v, l]) => `<button type="button" data-view="${v}" aria-pressed="${P.ttView === v}">${l}</button>`).join('')}</div></div></div>
    ${t.pendingRequests ? `<div class="j-box j-box-amber" style="margin-bottom:12px;display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap"><span><b>${t.pendingRequests} new request${t.pendingRequests === 1 ? '' : 's'}</b> waiting for an answer: accept, trial or decline.</span><button type="button" class="j-btn j-btn-dark j-btn-sm" data-tab="requests">Review</button></div>` : ''}
    <div class="j-daybar" id="b-days" style="margin-bottom:10px">${[['', 'Whole week'], ...DAYS.filter((d) => B.groups.some((g) => g.day === d)).map((d) => [d, d])].map(([v, l]) => `<button type="button" data-bday="${esc(v)}" aria-selected="${(P.day || '') === v}">${esc(l)}</button>`).join('')}</div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:12px">
      <div class="jp-seg" id="b-loc">${[['', 'All locations'], ...B.locations.map((l) => [l.id, l.name])].map(([v, l]) => `<button type="button" data-loc="${esc(v)}" aria-pressed="${P.loc === v}">${esc(l)}</button>`).join('')}</div>
      <select class="j-select" id="b-coach" style="width:auto"><option value="">Any coach</option>${B.coaches.map((c) => `<option value="${esc(c.id)}" ${P.coachFilter === c.id ? 'selected' : ''}>Coach ${esc(c.name)}</option>`).join('')}</select>
      ${P.ttView === 'staff' ? '<div class="jp-legend" style="margin-left:auto"><span><i class="i-paid"></i>Paid</span><span><i class="i-due"></i>Unpaid</span><span><i class="i-link"></i>Link sent</span><span><i class="i-trial"></i>Trial</span><span><i class="i-off"></i>Not set</span><span><b style="color:#B42318;font-size:10px">W</b> no waiver</span></div>' : ''}
    </div>
    ${P.ttView === 'staff' ? '<p class="muted small" style="margin-bottom:8px">Tap a group for its rules, Add player or Copy spot link. Tap a name for payment and more. Drag a name onto another group to move them.</p>' : P.ttView === 'coach' ? '<p class="muted small" style="margin-bottom:8px">What a coach sees: every group, names and ages. No money, no contact details.</p>' : '<p class="muted small" style="margin-bottom:8px">What parents see: places left, never names.</p>'}
    <div class="jp-tt-wrap">${ttGrid(groups)}</div>
    ${B.unassigned.length && P.ttView === 'staff' ? `<div class="jp-day"><h2>Not in a group</h2></div><div class="jp-group">${B.unassigned.map((p) => playerRowHtml(p, '')).join('')}<p class="muted small" style="margin-top:8px">These rows have no session, or a session with no group (for the split morning groups, a coach with no group at that time). Move them onto a group.</p></div>` : ''}`
  $('b-refresh').addEventListener('click', () => renderBoard(true))
  $('b-loc').addEventListener('click', (e) => { const b = e.target.closest('[data-loc]'); if (b) { P.loc = b.dataset.loc; renderBoard(false) } })
  $('b-view').addEventListener('click', (e) => { const b = e.target.closest('[data-view]'); if (b) { P.ttView = b.dataset.view; closeSide(); renderBoard(false) } })
  $('b-coach').addEventListener('change', (e) => { P.coachFilter = e.target.value; renderBoard(false) })
  $('b-days').addEventListener('click', (e) => { const b = e.target.closest('[data-bday]'); if (b) { P.day = b.dataset.bday; renderBoard(false) } })
  $('b-add').addEventListener('click', () => pickGroupThenAdd())
  wireBoard()
  if (P.sel && P.ttView === 'staff') { const g = P.board.groups.find((x) => x.id === P.sel); if (g) groupSide(g) }
}

function ttGrid(groups) {
  const cols = DAYS.filter((d) => groups.some((g) => g.day === d))
  if (!cols.length) return '<div class="j-empty">No groups match.</div>'
  const periods = PERIODS.filter(([p]) => groups.some((g) => g.period === p))
  // One day: its groups side by side, morning then afternoon.
  if (P.day) return periods.map(([p, label]) => `<div class="j-tt-row" style="margin:6px 0 8px">${esc(P.day)} ${esc(label.toLowerCase())}</div><div class="jp-board" style="margin-bottom:14px">${groups.filter((g) => g.period === p).sort((a, b) => a.sortTime.localeCompare(b.sortTime)).map(ttBlock).join('')}</div>`).join('')
  return `<div class="jp-tt" style="--cols:${cols.length}">${cols.map((d) => `<div class="j-tt-day">${esc(d)}</div>`).join('')}
    ${periods.map(([p, label]) => `<div class="j-tt-row">${esc(label)}</div>${cols.map((d) => `<div class="j-tt-cell">${groups.filter((g) => g.day === d && g.period === p).sort((a, b) => a.sortTime.localeCompare(b.sortTime)).map(ttBlock).join('')}</div>`).join('')}`).join('')}</div>`
}

function dotFor(p) {
  if (p.trial) return 'i-trial'
  if (p.paymentStatus === 'Paid') return 'i-paid'
  if (p.payreq) return 'i-link'
  if (['Unpaid', 'Partially Paid'].includes(p.paymentStatus)) return 'i-due'
  return 'i-off'
}

function ttBlock(g) {
  const n = g.players.length
  const left = g.capacity - n
  const tag = g.mode === 'direct' ? 'Book now' : g.mode === 'application' ? 'Apply' : g.mode === 'enquire' ? 'Enquire' : 'Hidden'
  const head = `<div class="jp-blk-head" data-open="${esc(g.id)}"><b>${esc(g.time)}</b>${g.pendingRequests && P.ttView === 'staff' ? ` <span class="j-pill j-pill-violet" style="font-size:10px;padding:0 6px">${g.pendingRequests} new</span>` : ''}<span class="n">${P.ttView === 'parent' ? '' : `${n}/${g.capacity}`}</span></div>
    <div class="sub" data-open="${esc(g.id)}">${esc(g.coachName || 'No coach')} · ${esc(tag)}${g.label !== 'Small group' ? ` · ${esc(g.label)}` : ''}${g.minAge != null ? ` · ${g.girlsOnly === 'yes' ? 'girls ' : ''}${g.minAge} to ${g.maxAge}` : ''}</div>`
  let body
  if (P.ttView === 'parent') {
    body = left <= 0 ? '<div class="jp-open" style="color:#B42318;font-weight:700">Fully booked · waitlist</div>' : `<div class="jp-open" style="color:${g.mode === 'direct' ? '#067647' : '#175CD3'};font-weight:700">${tag} · ${left} ${left === 1 ? 'spot' : 'spots'} left</div>`
  } else {
    body = g.players.map((p) => `<div class="jp-nm" ${P.ttView === 'staff' ? `draggable="true" data-row="${esc(p.rowId)}" data-from="${esc(g.id)}" tabindex="0" role="button" aria-label="${esc(p.name)}, options"` : ''}>${P.ttView === 'staff' ? `<i class="${dotFor(p)}"></i>` : ''}<span class="nmx">${esc(p.name)}${p.age != null ? ` <span class="muted">${esc(p.age)}</span>` : ''}</span>${P.ttView === 'staff' && p.status !== 'Confirmed' ? '<span class="muted" style="font-size:10px">awaiting</span>' : ''}${P.ttView === 'staff' && !p.waiver ? '<span class="w">W</span>' : ''}</div>`).join('')
    body += left > 0 ? `<div class="jp-open">+ ${left} open</div>` : left < 0 ? `<div class="jp-open" style="color:#B42318">${-left} over capacity</div>` : '<div class="jp-open" style="color:#B42318">Full</div>'
    if (P.ttView === 'staff') body += `<button type="button" class="jp-addbtn" data-add="${esc(g.id)}">+ Add player</button>`
  }
  return `<section class="jp-blk ${P.sel === g.id && P.ttView === 'staff' ? 'sel' : ''}" style="--lc:${locColor(g.locationId)}" data-drop="${esc(g.id)}">${head}${body}</section>`
}

function closeSide() { $('jp-side')?.remove() }

function groupSide(g) {
  closeSide()
  P.sel = g.id
  document.querySelectorAll('.jp-blk.sel').forEach((x) => x.classList.remove('sel'))
  document.querySelector(`.jp-blk[data-drop="${CSS.escape(g.id)}"]`)?.classList.add('sel')
  const el = document.createElement('aside')
  el.className = 'jp-side'
  el.id = 'jp-side'
  const left = g.capacity - g.players.length
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start"><div><h2>${esc(g.day)} ${esc(g.time)}</h2><p class="muted small">${esc(g.locationName)} · Coach ${esc(g.coachName || 'not set')} · ${g.players.length} of ${g.capacity}</p></div><button type="button" class="j-close" id="sd-x" aria-label="Close">&times;</button></div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin:10px 0"><span class="j-pill j-pill-${modePill(g)}">${esc(modeLabel[g.mode])}</span>${left <= 0 ? '<span class="j-pill j-pill-red">Fully booked</span>' : `<span class="j-pill j-pill-grey">${left} open</span>`}${g.label !== 'Small group' ? `<span class="j-pill j-pill-grey">${esc(g.label)}</span>` : ''}</div>
    <dl class="j-kv" style="font-size:13px;grid-template-columns:96px 1fr">
      <dt>Ages</dt><dd>${esc(agesText(g))}${g.ageStatus !== 'confirmed' && g.minAge != null ? ' (draft)' : ''}${g.mode === 'application' ? ', a guide' : g.mode === 'direct' ? ', enforced' : ''}</dd>
      <dt>Asks</dt><dd>${g.mode === 'application' || g.mode === 'direct' ? esc((g.questions || []).map((q) => ({ club: 'club', team: 'team', playingUp: 'playing up or down', trainedBefore: 'trained before', position: 'position' }[q] || q)).join(', ') || 'nothing extra') : 'n/a'}</dd>
      <dt>Trials</dt><dd>${g.mode === 'application' ? (g.trials !== false ? 'Allowed' : 'Not offered') : 'n/a'}</dd>
      <dt>Who for</dt><dd>${(g.requirements || []).length ? esc(g.requirements.map((k) => ({ club: 'club football', npl: 'NPL or Division 1', rep: 'rep, NPL or academy', high: 'high level only', committed: 'every session', trialNew: 'new players trial', coach: 'coach invitation' }[k] || k)).join(', ')) : 'Ages only (set in Edit rules)'}${g.publicNote ? `<br><span class="muted">${esc(g.publicNote)}</span>` : ''}</dd>
    </dl>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:14px">
      <button type="button" class="j-btn j-btn-dark j-btn-sm" id="sd-add">Add player</button>
      <button type="button" class="j-btn j-btn-line j-btn-sm" id="sd-link">Copy spot link</button>
      <button type="button" class="j-btn j-btn-line j-btn-sm" id="sd-edit">Edit rules</button>
      <button type="button" class="j-btn j-btn-line j-btn-sm" id="sd-reg">Register</button>
    </div>
    ${g.pendingRequests ? `<button type="button" class="j-btn j-btn-soft j-btn-block j-btn-sm" id="sd-req" style="margin-top:8px">${g.pendingRequests} request${g.pendingRequests === 1 ? '' : 's'} for this group</button>` : ''}
    <h3 style="margin:16px 0 6px">Players</h3>
    ${g.players.map((p) => playerRowHtml(p, g.id)).join('') || '<p class="muted small">No players yet.</p>'}`
  document.querySelector('.jfp').appendChild(el)
  el.querySelector('#sd-x').addEventListener('click', () => { P.sel = ''; closeSide(); document.querySelectorAll('.jp-blk.sel').forEach((x) => x.classList.remove('sel')) })
  el.querySelector('#sd-add').addEventListener('click', () => addPlayerModal(g))
  el.querySelector('#sd-link').addEventListener('click', () => addPlayerModal(g, { spotLink: true }))
  el.querySelector('#sd-edit').addEventListener('click', async () => { if (!P.groups) P.groups = await need(await post('groups')); groupModal(P.groups.groups.find((x) => x.id === g.id) || g) })
  el.querySelector('#sd-reg').addEventListener('click', () => { P.coachId = g.coachId; go('coach') })
  el.querySelector('#sd-req')?.addEventListener('click', () => go('requests'))
  wireRows(el)
}

function playerRowHtml(p, gid) {
  const tags = [
    p.status !== 'Confirmed' ? `<span class="j-pill j-pill-amber">${esc(p.status)}</span>` : '',
    payPill(p),
    p.payreq ? `<span class="j-pill j-pill-blue" title="Payment link open">Link ${esc(p.payreq.amountLabel)}</span>` : '',
    p.waiver ? '' : '<span class="j-pill j-pill-grey" title="No waiver on file">No waiver</span>',
    p.kit ? `<span class="j-pill j-pill-green" title="JF playing kit: ${esc(p.kit)}">Kit</span>` : '',
  ].join('')
  return `<div class="jp-player" draggable="true" data-row="${esc(p.rowId)}" data-from="${esc(gid)}" tabindex="0" role="button" aria-label="${esc(p.name)}, options">
    <span class="nm">${esc(p.name)}${p.age != null ? ` <span class="muted">(${esc(p.age)})</span>` : ''}</span>
    <span class="tags">${tags}</span></div>`
}

function findPlayer(rowId) {
  for (const g of P.board.groups) { const p = g.players.find((x) => x.rowId === rowId); if (p) return { p, g } }
  const p = P.board.unassigned.find((x) => x.rowId === rowId)
  return p ? { p, g: null } : null
}

function wireRows(root) {
  root.querySelectorAll('[data-row]').forEach((el) => {
    const open = (e) => { e?.stopPropagation(); playerMenu(el) }
    el.addEventListener('click', open)
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open() } })
    el.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', el.dataset.row); e.dataTransfer.effectAllowed = 'move' })
  })
}

function wireBoard() {
  const v = view()
  v.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => { if (P.ttView !== 'staff') return; const g = P.board.groups.find((x) => x.id === b.dataset.open); if (g) groupSide(g) }))
  v.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); const g = P.board.groups.find((x) => x.id === b.dataset.add); if (g) addPlayerModal(g) }))
  if (P.ttView !== 'staff') return
  wireRows(v)
  v.querySelectorAll('[data-drop]').forEach((zone) => {
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drop') })
    zone.addEventListener('dragleave', () => zone.classList.remove('drop'))
    zone.addEventListener('drop', async (e) => {
      e.preventDefault()
      zone.classList.remove('drop')
      const rowId = e.dataTransfer.getData('text/plain')
      const found = findPlayer(rowId)
      const to = P.board.groups.find((g) => g.id === zone.dataset.drop)
      if (!found || !to || found.g?.id === to.id) return
      if (await confirmBox(`Move <b>${esc(found.p.name)}</b> to <b>${esc(to.day)} ${esc(to.time)}, ${esc(to.locationName)}, Coach ${esc(to.coachName)}</b>?`, { ok: 'Move' })) doMove(rowId, to.id)
    })
  })
}

async function doMove(rowId, toGroupId, force = false) {
  const r = await post('movePlayer', { rowId, toGroupId, force })
  if (r.status === 409 && r.data.code === 'full') { if (await confirmBox(esc(r.data.error), { ok: 'Add anyway' })) return doMove(rowId, toGroupId, true); return }
  if (!r.ok) return toast(r.data.error || 'Could not move.')
  toast('Moved. Airtable updated.')
  renderBoard(true)
}

function playerMenu(el) {
  const found = findPlayer(el.dataset.row)
  if (!found) return
  const { p, g } = found
  menu(el, [
    { key: 'info', label: 'Details', run: () => detailsModal(p, g) },
    { key: 'move', label: 'Move to another group', run: () => moveModal(p, g) },
    '-',
    ...(p.trial ? [{ key: 'term', label: 'Offer full term (after trial)', run: () => termModal(p, g) }] : []),
    ...(p.paymentStatus !== 'Paid' || p.trial ? [{ key: 'link', label: p.payreq ? `Payment link open (${p.payreq.amountLabel})` : 'Send a payment link', run: () => linkModal(p, g) }, { key: 'paid', label: 'Mark paid offline', run: () => paidModal(p) }] : []),
    { key: 'trial', label: p.trial ? 'End trial without a link' : 'Mark as trial', run: async () => { const r = await post('setTrial', { rowId: p.rowId, trial: !p.trial }); if (!r.ok) return toast(r.data.error); toast('Updated'); renderBoard(true) } },
    '-',
    { key: 'remove', label: 'Remove from group', danger: true, run: () => removeModal(p, g) },
  ])
}

function detailsModal(p, g) {
  modal(`<h2 style="margin-bottom:12px">${esc(p.name)}</h2>
    <dl class="j-kv">
      <dt>Group</dt><dd>${g ? `${esc(g.day)} ${esc(g.time)}, ${esc(g.locationName)}, Coach ${esc(g.coachName)}` : esc(p.session || 'None')}</dd>
      <dt>Age</dt><dd>${p.age != null ? esc(p.age) : 'Not on file'}</dd>
      <dt>Status</dt><dd>${esc(p.status)}</dd>
      <dt>Type</dt><dd>${esc(p.type || 'Not set')}</dd>
      <dt>Payment</dt><dd>${esc(p.paymentStatus)} · paid ${esc(money(p.paidCents))} of ${esc(money(p.feeCents))}</dd>
      <dt>Waiver</dt><dd>${p.waiver ? 'On file' : 'Not found'}</dd>
      <dt>Parent</dt><dd>${esc(p.parent || '')}</dd>
      <dt>Email</dt><dd>${p.email ? `<a href="mailto:${esc(p.email)}">${esc(p.email)}</a>` : 'None'}</dd>
      <dt>Mobile</dt><dd>${p.phone ? `<a href="tel:${esc(p.phone)}">${esc(p.phone)}</a>` : 'None'}</dd>
      ${p.linkNotes ? `<dt>Payment notes</dt><dd style="font-weight:400">${esc(p.linkNotes)}</dd>` : ''}
    </dl>
    <div style="display:flex;justify-content:flex-end;margin-top:16px"><button type="button" class="j-btn j-btn-line" data-close>Close</button></div>`)
}

function groupOptions(selected, { exclude } = {}) {
  return P.board.groups.filter((g) => g.id !== exclude).map((g) => `<option value="${esc(g.id)}" ${g.id === selected ? 'selected' : ''}>${esc(g.day)} ${esc(g.time)} · ${esc(g.locationName)} · Coach ${esc(g.coachName || '?')} · ${g.players.length}/${g.capacity}</option>`).join('')
}

function moveModal(p, g) {
  const box = modal(`<h2 style="margin-bottom:12px">Move ${esc(p.name)}</h2>
    <label class="j-field"><span>New group</span><select class="j-select" id="mv-to">${groupOptions('', { exclude: g?.id })}</select></label>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px"><button type="button" class="j-btn j-btn-line" data-close>Cancel</button><button type="button" class="j-btn j-btn-dark" id="mv-go">Move</button></div>`)
  box.querySelector('#mv-go').addEventListener('click', () => { const to = box.querySelector('#mv-to').value; closeModal(); doMove(p.rowId, to) })
}

function paidModal(p) {
  const owing = Math.max(0, p.feeCents - p.paidCents) || p.feeCents || 85000
  const box = modal(`<h2 style="margin-bottom:6px">Mark paid offline</h2><p class="muted small" style="margin-bottom:12px">${esc(p.name)} · paid ${esc(money(p.paidCents))} of ${esc(money(p.feeCents))}</p>
    <div class="j-two"><label class="j-field"><span>Amount received (A$)</span><input class="j-input" id="pd-amt" inputmode="decimal" value="${(owing / 100).toFixed(2).replace(/\.00$/, '')}"></label>
    <label class="j-field"><span>How</span><select class="j-select" id="pd-how"><option>Bank transfer</option><option>Cash</option><option>Other</option></select></label></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px"><button type="button" class="j-btn j-btn-line" data-close>Cancel</button><button type="button" class="j-btn j-btn-dark" id="pd-go">Save</button></div>`)
  box.querySelector('#pd-go').addEventListener('click', async () => {
    const amountCents = Math.round(Number(box.querySelector('#pd-amt').value) * 100)
    if (!(amountCents > 0)) return toast('Enter the amount received.')
    const r = await post('markPaid', { rowId: p.rowId, amountCents, method: box.querySelector('#pd-how').value })
    if (!r.ok) return toast(r.data.error)
    closeModal(); toast('Marked paid. Airtable updated.'); renderBoard(true)
  })
}

// A link for a player already on the board: what is owing, or a product
// from the price list (pro rata from the start week), or any amount.
async function linkModal(p, g) {
  const pr = await pricing()
  const owing = Math.max(0, p.feeCents - p.paidCents)
  const box = modal(`<h2 style="margin-bottom:6px">Payment link</h2><p class="muted small" style="margin-bottom:12px">${esc(p.name)}${g ? ` · ${esc(g.day)} ${esc(g.time)}` : ''}. The family signs in with their email, signs the waiver if needed, then pays.</p>
    ${p.payreq ? `<div class="j-box j-box-grey" style="margin-bottom:12px">A link for ${esc(p.payreq.amountLabel)} is already open. To change its amount, use Payment links. A new link here leaves the old one open.</div>` : ''}
    <div class="jp-seg" id="ln-mode" style="margin-bottom:12px"><button type="button" data-m="price" aria-pressed="true">From the price list</button><button type="button" data-m="owing" aria-pressed="false">What is owing${owing ? ` (${esc(money(owing))})` : ''}</button></div>
    <div id="ln-price"></div>
    <label class="j-field"><span>Parent email</span><input class="j-input" id="ln-email" type="email" value="${esc(p.email || '')}"></label>
    <label class="j-check" id="ln-change-row" hidden><input type="checkbox" id="ln-change"> <span>Update the parent email in Airtable to this address. The family signs in with it to pay, and will see this player.</span></label>
    ${p.linkNotes ? `<div class="j-box j-box-amber small" style="margin-bottom:10px"><b>Payment notes in Airtable:</b> ${esc(p.linkNotes)}</div>` : ''}
    <div id="ln-out"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px;flex-wrap:wrap"><button type="button" class="j-btn j-btn-line" data-close>Close</button><button type="button" class="j-btn j-btn-line" id="ln-copy-go">Copy link only</button><button type="button" class="j-btn j-btn-dark" id="ln-go">Email payment link</button></div>`)
  let mode = 'price'
  const read = priceBlock(box, pr, { day: g?.day || 'Monday', product: g?.product || 'group', credit: p.trial, paid: p.paidCents || 0, prefix: 'ln-price' })
  // Something already owing on the row (an agreed fee): start there.
  if (owing > 0 && !p.trial) { mode = 'owing'; box.querySelectorAll('#ln-mode button').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.m === 'owing'))); box.querySelector('#ln-price').hidden = true }
  box.querySelector('#ln-mode').addEventListener('click', (e) => { const b = e.target.closest('[data-m]'); if (!b) return; mode = b.dataset.m; box.querySelectorAll('#ln-mode button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); box.querySelector('#ln-price').hidden = mode !== 'price' })
  const emailInput = box.querySelector('#ln-email')
  emailInput.addEventListener('input', () => { box.querySelector('#ln-change-row').hidden = emailInput.value.trim().toLowerCase() === (p.email || '').toLowerCase() })
  const btns = () => [box.querySelector('#ln-go'), box.querySelector('#ln-copy-go')]
  const go = async (sendEmail, replace = false) => {
    const priced = mode === 'price' ? read() : {}
    if (mode === 'price' && !(priced.amountCents > 0)) return toast('Enter an amount.')
    btns().forEach((b) => { b.disabled = true })
    const body = { rowId: p.rowId, ...(mode === 'price' ? priced : {}), email: emailInput.value.trim(), changeEmail: box.querySelector('#ln-change').checked, sendEmail, replace, reason: p.trial && priced.product !== 'trial' ? 'term-after-trial' : undefined }
    const r = await post('sendPaymentLink', body)
    btns().forEach((b) => { b.disabled = false })
    if (r.data.code === 'email_change') { box.querySelector('#ln-change-row').hidden = false; return toast(r.data.error) }
    if (r.data.code === 'link_open') {
      if (!confirm(`${r.data.error}\n\nThe old link stops working and the family uses the new one.`)) return
      return go(sendEmail, true)
    }
    if (!r.ok) return toast(r.data.error)
    box.querySelector('#ln-out').innerHTML = `<div class="j-box j-box-green" style="margin:10px 0">Link for ${esc(r.data.payreq.amountLabel)} created${r.data.emailed ? ' and emailed' : ''}. <button type="button" class="j-btn j-btn-line j-btn-sm" id="ln-copy">Copy link</button></div>`
    box.querySelector('#ln-copy').addEventListener('click', () => copy(r.data.payreq.url))
    if (!sendEmail) copy(r.data.payreq.url)
    box.querySelector('#ln-go').hidden = true; box.querySelector('#ln-copy-go').hidden = true
    P.board = null
  }
  box.querySelector('#ln-go').addEventListener('click', () => go(true))
  box.querySelector('#ln-copy-go').addEventListener('click', () => go(false))
}

// After a trial: the rest of the term, trial fee off, pro rata from a week.
async function termModal(p, g) {
  const pr = await pricing()
  const box = modal(`<h2 style="margin-bottom:6px">Offer the full term</h2><p class="muted small" style="margin-bottom:12px">${esc(p.name)} trialled in ${g ? `${esc(g.day)} ${esc(g.time)}` : 'a group'}. They pay for the rest of the term to lock the place in.</p>
    <label class="j-field"><span>Group</span><select class="j-select" id="tm-g">${groupOptions(g?.id)}</select></label>
    <div id="tm-price"></div>
    <div id="tm-out"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px;flex-wrap:wrap"><button type="button" class="j-btn j-btn-line" data-close>Close</button><button type="button" class="j-btn j-btn-line" id="tm-copy-go">Copy link only</button><button type="button" class="j-btn j-btn-dark" id="tm-go">Email payment link</button></div>`)
  let read
  const groups = P.board.groups
  const draw = () => { const gg = groups.find((x) => x.id === box.querySelector('#tm-g').value) || g; read = priceBlock(box, pr, { day: gg?.day || 'Monday', product: gg?.product || 'group', credit: true, paid: p.paidCents || 0, prefix: 'tm-price', noTrial: true }) }
  draw()
  box.querySelector('#tm-g').addEventListener('change', draw)
  const go = async (sendEmail, replace = false) => {
    const v = read()
    const b1 = box.querySelector('#tm-go'), b2 = box.querySelector('#tm-copy-go')
    b1.disabled = true; b2.disabled = true
    const r = await post('offerTerm', { rowId: p.rowId, groupId: box.querySelector('#tm-g').value, ...v, sendEmail, replace })
    b1.disabled = false; b2.disabled = false
    if (r.data.code === 'link_open') { if (confirm(`${r.data.error}\n\nThe old link stops working and the family uses the new one.`)) return go(sendEmail, true); return }
    if (r.data.code === 'full') { if (confirm(r.data.error)) { b1.disabled = true; const again = await post('offerTerm', { rowId: p.rowId, groupId: box.querySelector('#tm-g').value, ...v, sendEmail, replace, force: true }); b1.disabled = false; if (!again.ok) return toast(again.data.error); r.data = again.data; r.ok = true } else return }
    if (!r.ok) return toast(r.data.error)
    box.querySelector('#tm-out').innerHTML = `<div class="j-box j-box-green" style="margin:10px 0">Offered: ${esc(r.data.payreq.amountLabel)}${r.data.emailed ? ', emailed' : ''}. <button type="button" class="j-btn j-btn-line j-btn-sm" id="tm-copy">Copy link</button></div>`
    box.querySelector('#tm-copy').addEventListener('click', () => copy(r.data.payreq.url))
    if (!sendEmail) copy(r.data.payreq.url)
    box.querySelector('#tm-go').hidden = true; box.querySelector('#tm-copy-go').hidden = true
    P.board = null
  }
  box.querySelector('#tm-go').addEventListener('click', () => go(true))
  box.querySelector('#tm-copy-go').addEventListener('click', () => go(false))
}

const LEAVE = ['Cost', 'Time or schedule clash', 'Club or school commitments', 'Injury', 'Not the right group or level', 'Trial was not the right fit', 'Moved away', 'Taking a break', 'Joined another program', 'Moved to 1 to 1', 'No reply from the family', 'Other']

function removeModal(p, g) {
  const box = modal(`<h2 style="margin-bottom:6px">Remove ${esc(p.name)}?</h2>
    <p class="muted small" style="margin-bottom:12px">They come off Term 4 Players${g ? ` and their place in ${esc(g.day)} ${esc(g.time)} opens up` : ''}. Their contact details, the reason and a copy of their row go to "Players dropped from term 4" in Airtable, and to Removed players here, where you can restore them.${p.paymentStatus === 'Paid' ? ' They have paid: any refund is done in Stripe.' : ''}</p>
    <label class="j-field"><span>Why are they leaving?</span><select class="j-select" id="rm-why"><option value="">Choose a reason</option>${LEAVE.map((r) => `<option>${esc(r)}</option>`).join('')}</select></label>
    <label class="j-field"><span>Details <span class="muted">(what the family said, anything to remember)</span></span><textarea class="j-textarea" id="rm-details"></textarea></label>
    <p class="j-err" id="rm-err" hidden></p>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px"><button type="button" class="j-btn j-btn-line" data-close>Cancel</button><button type="button" class="j-btn j-btn-danger" id="rm-go">Remove from Term 4</button></div>`)
  box.querySelector('#rm-go').addEventListener('click', async () => {
    const reason = box.querySelector('#rm-why').value
    if (!reason) { const e = box.querySelector('#rm-err'); e.textContent = 'Choose why they are leaving.'; e.hidden = false; return }
    const btn = box.querySelector('#rm-go'); btn.disabled = true
    const r = await post('removePlayer', { rowId: p.rowId, reason, details: box.querySelector('#rm-details').value.trim() })
    btn.disabled = false
    if (!r.ok) return toast(r.data.error)
    closeModal(); toast('Removed. Saved to Players dropped from term 4.'); P.sel = ''; closeSide(); renderBoard(true)
  })
}

// Add a player by hand. With spotLink, the family gets a link to this spot:
// they sign in, add details, sign the waiver and pay. The place is held for
// them in Airtable as Awaiting Reply until it is paid.
async function addPlayerModal(g, { spotLink = false } = {}) {
  const pr = await pricing()
  const left = g.capacity - g.players.length
  const box = modal(`<h2>${spotLink ? 'Send a link to this spot' : 'Add a player'}</h2><p class="muted small" style="margin:2px 0 14px">${esc(g.day)} ${esc(g.time)} · ${esc(g.locationName)} · Coach ${esc(g.coachName || 'not set')} · ${left > 0 ? `${left} place${left === 1 ? '' : 's'} left` : 'full'}</p>
    <label class="j-field"><span>Find an existing player <span class="muted">(Term 4, Term 3 or waivers)</span></span><input class="j-input" id="ap-search" placeholder="Start typing a name" autocomplete="off"></label>
    <div id="ap-results"></div>
    <div class="j-two"><label class="j-field"><span>Player's full name</span><input class="j-input" id="ap-name" autocomplete="off"></label><label class="j-field"><span>Date of birth <span class="muted">(optional)</span></span><input class="j-input" type="date" id="ap-dob"></label></div>
    <div class="j-two"><label class="j-field"><span>Parent name</span><input class="j-input" id="ap-parent"></label><label class="j-field"><span>Mobile</span><input class="j-input" id="ap-mobile" type="tel"></label></div>
    <label class="j-field"><span>Parent email</span><input class="j-input" id="ap-email" type="email"></label>
    <label class="j-field"><span>Payment</span><select class="j-select" id="ap-pay">
      <option value="link" selected>Payment link: they sign in, confirm the waiver and pay</option><option value="offline">Already paid offline</option><option value="trial">Free trial, no payment</option><option value="none">Decide later</option></select></label>
    <div id="ap-price"></div>
    <label class="j-check"><input type="checkbox" id="ap-send" ${spotLink ? '' : 'checked'}> <span>Email the family now. They sign in, confirm the waiver (or sign it), pay for this group, then get the training kit.</span></label>
    <p class="j-err" id="ap-err" hidden></p>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px"><button type="button" class="j-btn j-btn-line" data-close>Cancel</button><button type="button" class="j-btn j-btn-dark" id="ap-go"></button></div>`, { wide: true })
  const read = priceBlock(box, pr, { day: g.day, product: g.product || 'group', prefix: 'ap-price' })
  const payWatch = () => {
    const v = box.querySelector('#ap-pay').value
    const send = box.querySelector('#ap-send').checked
    box.querySelector('#ap-price').hidden = !['link', 'offline'].includes(v)
    box.querySelector('#ap-price-afterpay').closest('label').hidden = v !== 'link'
    box.querySelector('#ap-go').textContent = v === 'link' ? (send ? 'Add and email payment link' : 'Add and copy link') : send ? 'Add and email the family' : 'Add to group'
  }
  box.querySelector('#ap-pay').addEventListener('change', payWatch)
  box.querySelector('#ap-send').addEventListener('change', payWatch)
  payWatch()
  let timer
  box.querySelector('#ap-search').addEventListener('input', (e) => {
    clearTimeout(timer)
    const qv = e.target.value.trim()
    timer = setTimeout(async () => {
      if (qv.length < 2) { box.querySelector('#ap-results').innerHTML = ''; return }
      const r = await post('searchPlayers', { q: qv })
      if (!r.ok) return
      box.querySelector('#ap-results').innerHTML = r.data.results.length
        ? r.data.results.map((x, i) => `<button type="button" class="j-player" data-pick="${i}"><span><b>${esc(x.name)}</b>${x.age != null ? ` <span class="muted">(${esc(x.age)})</span>` : ''}<br><span class="muted small">${esc(x.source)} · ${esc(x.parentName || '')} ${esc(x.email || '')}</span></span>${x.waiver ? '<span class="j-pill j-pill-green">Waiver</span>' : ''}</button>`).join('')
        : '<p class="muted small" style="margin-bottom:10px">No match. Type the details below for a new player.</p>'
      box.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => {
        const x = r.data.results[Number(b.dataset.pick)]
        box.querySelector('#ap-name').value = x.name
        box.querySelector('#ap-dob').value = x.dob || ''
        box.querySelector('#ap-parent').value = x.parentName || ''
        box.querySelector('#ap-mobile').value = x.mobile || ''
        box.querySelector('#ap-email').value = x.email || ''
        box.querySelector('#ap-results').innerHTML = `<div class="j-box j-box-grey small" style="margin-bottom:10px">Using ${esc(x.name)} from ${esc(x.source)}.${x.waiver ? ' Waiver on file.' : ''}</div>`
      }))
    }, 250)
  })
  const submit = async () => {
    const err = box.querySelector('#ap-err')
    const payment = box.querySelector('#ap-pay').value
    const priced = ['link', 'offline'].includes(payment) ? read() : {}
    const body = {
      groupId: g.id,
      player: { name: box.querySelector('#ap-name').value.trim(), dob: box.querySelector('#ap-dob').value },
      parent: { name: box.querySelector('#ap-parent').value.trim(), email: box.querySelector('#ap-email').value.trim(), mobile: box.querySelector('#ap-mobile').value.trim() },
      payment, sendEmail: box.querySelector('#ap-send').checked, ...priced,
    }
    if (body.player.name.length < 3) { err.textContent = 'Enter the player\'s full name.'; err.hidden = false; return }
    if (payment === 'offline') body.method = 'Offline'
    const btn = box.querySelector('#ap-go'); btn.disabled = true
    let r = await post('addPlayer', body)
    btn.disabled = false
    if (r.status === 409 && r.data.code === 'full') {
      // The confirm replaces this form, so resend the same details on yes.
      if (!(await confirmBox(esc(r.data.error), { ok: 'Add anyway' }))) return
      r = await post('addPlayer', { ...body, force: true })
      if (!r.ok) return toast(r.data.error || 'Could not add.')
    } else if (!r.ok) { err.textContent = r.data.error || 'Could not add.'; err.hidden = false; return }
    closeModal()
    if (r.data.payreq) {
      const url = r.data.payreq.url
      const done = modal(`<h2 style="margin-bottom:8px">${esc(body.player.name)} is in</h2><p class="muted small" style="margin-bottom:12px">The spot is held in Airtable as Awaiting Reply. It locks in once ${esc(r.data.payreq.amountLabel)} is paid.${r.data.emailed ? ' The family has been emailed.' : ''}</p>
        <label class="j-field"><span>Link to send the family</span><input class="j-input" value="${esc(url)}" readonly></label>
        <div style="display:flex;gap:8px;justify-content:flex-end"><button type="button" class="j-btn j-btn-line" data-close>Close</button><button type="button" class="j-btn j-btn-dark" id="dn-copy">Copy link</button></div>`)
      done.querySelector('#dn-copy').addEventListener('click', () => copy(url))
      if (!r.data.emailed) copy(url)
    } else toast(`Added${r.data.emailed ? ' and emailed the family' : ''}. Airtable updated.`)
    renderBoard(true)
  }
  box.querySelector('#ap-go').addEventListener('click', submit)
}

// Add player from the top of the page: pick the group first.
function pickGroupThenAdd() {
  const box = modal(`<h2 style="margin-bottom:10px">Add a player</h2>
    <label class="j-field"><span>Which group?</span><select class="j-select" id="pg-g">${groupOptions(P.sel || '')}</select></label>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px"><button type="button" class="j-btn j-btn-line" data-close>Cancel</button><button type="button" class="j-btn j-btn-dark" id="pg-go">Next</button></div>`)
  box.querySelector('#pg-go').addEventListener('click', () => { const g = P.board.groups.find((x) => x.id === box.querySelector('#pg-g').value); closeModal(); if (g) addPlayerModal(g) })
}

// ---------- next term: hold your place ----------

async function renderNext() {
  const d = await need(await post('nextTerm'))
  const nt = d.nextTerm
  const word = { invited: ['blue', 'Invited'], held: ['violet', 'Held'], paid: ['green', 'Paid in full'], no: ['grey', 'Not returning'] }
  const t = d.totals
  view().innerHTML = `<div class="jp-head"><div><h1>Next term</h1><p class="muted small">Current families keep their place before ${esc(nt.name)} opens to everyone: hold it with a non-refundable fee (taken off the term), pay in full, or say they are not returning. Everything is saved in Airtable under "Next term holds".</p></div></div>
    <div class="j-card" style="padding:16px;margin-bottom:14px;max-width:760px">
      <div class="j-two"><label class="j-field"><span>Next term</span><input class="j-input" id="nt-name" value="${esc(nt.name)}"></label><label class="j-field"><span>Hold fee (A$, non-refundable)</span><input class="j-input" id="nt-hold" inputmode="decimal" value="${nt.holdCents / 100}"></label></div>
      <label class="j-check"><input type="checkbox" id="nt-open" ${nt.open ? 'checked' : ''}> <span><b>Open to every current family</b> in My JFP (otherwise only the players you invite below).</span></label>
      <p class="muted small">Full term is ${esc(d.prices.fullLabel)} (from Prices). A held place pays ${esc(d.prices.afterHoldLabel)} more later.</p>
      <button type="button" class="j-btn j-btn-dark j-btn-sm" id="nt-save" style="margin-top:8px">Save</button>
    </div>
    <div class="jp-kpis"><div class="jp-kpi"><span>Players this term</span><b>${t.players}</b></div><div class="jp-kpi"><span>Held</span><b>${t.held}</b></div><div class="jp-kpi"><span>Paid in full</span><b>${t.paid}</b></div><div class="jp-kpi"><span>Invited, no answer</span><b>${t.invited}</b></div><div class="jp-kpi"><span>Not returning</span><b>${t.no}</b></div></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px"><button type="button" class="j-btn j-btn-line j-btn-sm" id="nt-all">Select everyone not invited</button><label class="j-check" style="padding:0"><input type="checkbox" id="nt-email" checked> <span>Email the families</span></label><button type="button" class="j-btn j-btn-dark j-btn-sm" id="nt-invite">Invite selected</button></div>
    <div class="jp-scroll"><table class="jp-table"><thead><tr><th></th><th>Player</th><th>Group now</th><th>${esc(nt.name)}</th></tr></thead><tbody>
      ${d.players.map((p) => `<tr><td><input type="checkbox" data-nt="${esc(p.rowId)}" ${p.status ? 'disabled' : ''}></td><td><b>${esc(p.name)}</b><br><span class="muted small">${esc(p.parent)} · ${esc(p.email || 'no email')}</span></td><td>${esc(p.group)}${p.coach ? `<br><span class="muted small">Coach ${esc(p.coach)}</span>` : ''}</td><td>${p.status ? `<span class="j-pill j-pill-${word[p.status][0]}">${word[p.status][1]}</span>${p.paidCents ? ` <span class="muted small">${esc(money(p.paidCents))}</span>` : ''}` : '<span class="muted small">Not invited</span>'}</td></tr>`).join('')}
    </tbody></table></div>`
  $('nt-save').addEventListener('click', async () => {
    const r = await post('saveNextTerm', { nextTerm: { name: $('nt-name').value.trim(), holdCents: Math.round(Number($('nt-hold').value) * 100), open: $('nt-open').checked } })
    toast(r.ok ? 'Saved' : r.data.error); if (r.ok) renderNext()
  })
  $('nt-all').addEventListener('click', () => view().querySelectorAll('[data-nt]:not(:disabled)').forEach((c) => { c.checked = true }))
  $('nt-invite').addEventListener('click', async (e) => {
    const rowIds = [...view().querySelectorAll('[data-nt]:checked')].map((c) => c.dataset.nt)
    if (!rowIds.length) return toast('Tick the players to invite.')
    if (!(await confirmBox(`Invite ${rowIds.length} player${rowIds.length === 1 ? '' : 's'} to keep their place for ${esc(nt.name)}?${$('nt-email').checked ? ' Their families are emailed.' : ' No email is sent.'}`, { ok: 'Invite' }))) return
    e.target.disabled = true
    const r = await post('nextTermInvite', { rowIds, sendEmail: $('nt-email').checked })
    e.target.disabled = false
    toast(r.ok ? `${r.data.invited} invited${r.data.emailed ? `, ${r.data.emailed} famil${r.data.emailed === 1 ? 'y' : 'ies'} emailed` : ''}` : r.data.error); renderNext()
  })
}

// ---------- holiday training ----------

// The holiday admin (slots, bookings, prices, coaches), signed in with the
// portal login. The parent holiday booking page is unchanged.
async function renderHoliday() {
  view().innerHTML = `<div class="jp-head"><div><h1>Holiday training</h1><p class="muted small">School holiday sessions: slots, bookings, prices and coaches. Parents still book at <a href="/holiday-bookings/" target="_blank" rel="noopener">jonerfootball.com/holiday-bookings</a>.</p></div></div>
    <iframe src="/jfp-portal/holiday/" title="Holiday training" style="width:100%;height:calc(100vh - 170px);min-height:640px;border:1px solid var(--j-line);border-radius:14px;background:#0A0A0A"></iframe>`
}

// ---------- coach: the whole program ----------

async function renderProgram() {
  const d = await need(await post('program'))
  const groups = d.groups.map((g) => ({ ...g, players: g.players.map((p) => ({ ...p })) }))
  view().innerHTML = `<div class="jp-head"><div><h1>${esc(d.term)} program</h1><p class="muted small">Every group, with names and ages. Your groups are outlined.</p></div></div>
    <div class="jp-tt-wrap">${(() => {
      const cols = DAYS.filter((dd) => groups.some((g) => g.day === dd))
      const periods = PERIODS.filter(([p]) => groups.some((g) => g.period === p))
      return `<div class="jp-tt" style="--cols:${cols.length}">${cols.map((dd) => `<div class="j-tt-day">${esc(dd)}</div>`).join('')}${periods.map(([p, label]) => `<div class="j-tt-row">${esc(label)}</div>${cols.map((dd) => `<div class="j-tt-cell">${groups.filter((g) => g.day === dd && g.period === p).sort((a, b) => a.sortTime.localeCompare(b.sortTime)).map((g) => `<section class="jp-blk ${g.mine ? 'sel' : ''}" style="--lc:${locColor(g.locationId)}"><div class="jp-blk-head"><b>${esc(g.time)}</b><span class="n">${g.players.length}/${g.capacity}</span></div><div class="sub">${esc(g.coachName)} · ${esc(g.locationName)}</div>${g.players.map((x) => `<div class="jp-nm" style="cursor:default"><span class="nmx">${esc(x.name)}${x.age != null ? ` <span class="muted">${esc(x.age)}</span>` : ''}</span>${x.trial ? '<span class="muted" style="font-size:10px">trial</span>' : ''}</div>`).join('')}</section>`).join('')}</div>`).join('')}`).join('')}</div>`
    })()}</div>`
}

// ---------- groups ----------

async function renderGroups() {
  const d = await need(await post('groups'))
  P.groups = d
  if (!P.board) P.board = await need(await post('board'))
  const taken = Object.fromEntries(P.board.groups.map((g) => [g.id, g.taken]))
  view().innerHTML = `
    <div class="jp-head"><div><h1>Groups and rules</h1><p class="muted small">Each group's coach, places, ages, whether parents book or apply, and what an application asks. Changes are live on the parent page straight away.</p></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="j-btn j-btn-line" id="g-draft">Draft age bands from players</button><button type="button" class="j-btn j-btn-dark" id="g-new">+ New group</button></div></div>
    <div class="jp-scroll"><table class="jp-table"><thead><tr><th>Day</th><th>Time</th><th>Location</th><th>Coach</th><th>Type</th><th>Parents can</th><th>Ages</th><th>Trials</th><th>Places</th><th></th></tr></thead><tbody>
    ${d.groups.map((g) => `<tr><td>${esc(g.day)}</td><td>${esc(g.time)}</td><td>${esc(g.locationName)}</td><td>${esc(d.coaches.find((c) => c.id === g.coachId)?.name || '')}${(g.extraCoachIds || []).length ? ` +${g.extraCoachIds.length}` : ''}</td><td>${esc(g.label)}</td>
      <td><span class="j-pill j-pill-${modePill(g)}">${esc(modeLabel[g.mode])}</span></td>
      <td>${esc(agesText(g))}${g.minAge != null && g.ageStatus !== 'confirmed' ? ' <span class="j-pill j-pill-amber">draft</span>' : ''}${g.girlsOnly === 'suggested' ? ' <span class="j-pill j-pill-amber">girls?</span>' : ''}</td>
      <td>${g.mode === 'application' ? (g.trials !== false ? 'Yes' : 'No') : ''}</td><td>${taken[g.id] ?? 0}/${g.capacity}</td><td><button type="button" class="j-btn j-btn-line j-btn-sm" data-edit="${esc(g.id)}">Edit</button></td></tr>`).join('')}
    </tbody></table></div>`
  $('g-new').addEventListener('click', () => groupModal(null))
  $('g-draft').addEventListener('click', async () => { const r = await post('draftAges'); if (!r.ok) return toast(r.data.error); toast(`${r.data.changed} group${r.data.changed === 1 ? '' : 's'} given a draft age band`); P.board = null; renderGroups() })
  view().querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => groupModal(d.groups.find((g) => g.id === b.dataset.edit))))
}

function groupModal(g) {
  const d = P.groups
  const v = g || { day: 'Monday', time: '4:20pm', location: 'Belrose HQ', coachId: '', extraCoachIds: [], capacity: 4, mode: 'application', label: 'Small group', durationMin: 60, minAge: '', maxAge: '', ageStatus: 'draft', girlsOnly: 'no', publicNote: '', trials: true, questions: ['club', 'team', 'playingUp', 'trainedBefore'], product: 'group', byCoach: false }
  const REQS = [['club', 'Plays club football this season'], ['npl', 'Plays NPL, or Division 1 club football'], ['rep', 'In a representative, NPL or academy squad'], ['high', 'High level players only'], ['committed', 'Can commit to every session this term'], ['trialNew', 'New players trial first'], ['coach', 'By coach invitation or recommendation']]
  const QS = [['club', 'Club they play for'], ['team', 'Team and age group'], ['playingUp', 'Playing up or down'], ['trainedBefore', 'Trained with Joner before'], ['position', 'Position'], ['videos', 'Links to training or game videos']]
  const PRODS = [['group', 'Term, small group'], ['pathway', 'JFP Pathway'], ['oneToOneTerm', 'Term of 1 to 1s'], ['pathwayOneToOne', 'Pathway 1 to 1']]
  const opt = (list, cur) => list.map(([val, label]) => `<option value="${esc(val)}" ${String(cur) === String(val) ? 'selected' : ''}>${esc(label)}</option>`).join('')
  const box = modal(`<h2 style="margin-bottom:12px">${g ? 'Edit group' : 'New group'}</h2>
    <div class="j-two"><label class="j-field"><span>Day</span><select class="j-select" id="gm-day">${opt(d.days.map((x) => [x, x]), v.day)}</select></label>
    <label class="j-field"><span>Start time</span><input class="j-input" id="gm-time" value="${esc(v.time)}" placeholder="4:20pm"></label></div>
    <div class="j-two"><label class="j-field"><span>Location (as written in Airtable)</span><input class="j-input" id="gm-loc" value="${esc(v.location)}" list="gm-locs"><datalist id="gm-locs"><option>Belrose HQ</option><option>NTRA</option><option>Rydalmere</option></datalist></label>
    <label class="j-field"><span>Coach</span><select class="j-select" id="gm-coach"><option value="">Not set</option>${opt(d.coaches.map((c) => [c.id, c.name]), v.coachId)}</select></label></div>
    <div class="j-two"><label class="j-field"><span>Parents can</span><select class="j-select" id="gm-mode">${opt(d.modes.map((m) => [m, modeLabel[m]]), v.mode)}</select></label>
    <label class="j-field"><span>Type</span><select class="j-select" id="gm-label">${opt(d.labels.map((x) => [x, x]), v.label)}</select></label></div>
    <div class="j-two"><label class="j-field"><span>Youngest age</span><input class="j-input" id="gm-min" inputmode="numeric" value="${v.minAge ?? ''}"></label><label class="j-field"><span>Oldest age</span><input class="j-input" id="gm-max" inputmode="numeric" value="${v.maxAge ?? ''}"></label></div>
    <div class="j-two"><label class="j-field"><span>Age band</span><select class="j-select" id="gm-agest">${opt([['draft', 'Draft, to confirm'], ['confirmed', 'Confirmed']], v.ageStatus)}</select></label>
    <label class="j-field"><span>Girls only</span><select class="j-select" id="gm-girls">${opt([['no', 'No'], ['suggested', 'Looks like it, not enforced'], ['yes', 'Yes, girls only']], v.girlsOnly)}</select></label></div>
    <div class="j-two"><label class="j-field"><span>Places (capacity)</span><input class="j-input" id="gm-cap" inputmode="numeric" value="${v.capacity}"></label><label class="j-field"><span>Minutes</span><input class="j-input" id="gm-dur" inputmode="numeric" value="${v.durationMin}"></label></div>
    <label class="j-field"><span>Extra coaches</span><select class="j-select" id="gm-extra" multiple size="3">${d.coaches.map((c) => `<option value="${esc(c.id)}" ${(v.extraCoachIds || []).includes(c.id) ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
    <div class="j-two"><label class="j-field"><span>Price from</span><select class="j-select" id="gm-prod">${opt(PRODS, v.product || 'group')}</select></label>
    <label class="j-check" style="margin-top:22px"><input type="checkbox" id="gm-trials" ${v.trials !== false ? 'checked' : ''}> <span>Apply: we may offer a trial first</span></label></div>
    <div class="j-field"><span>Who this group is for: parents see these under the ages</span>${REQS.map(([k, l]) => `<label class="j-check" style="padding:4px 0"><input type="checkbox" data-rk="${k}" ${(v.requirements || []).includes(k) ? 'checked' : ''}> <span>${esc(l)}</span></label>`).join('')}</div>
    <label class="j-field"><span>More about who this group is for <span class="muted">(optional, your own words, shown to parents under the ticks)</span></span><textarea class="j-textarea" id="gm-reqtext" rows="5" maxlength="1200" placeholder="For example: This group is for players who are pushing for NPL or academy squads. Expect a fast tempo, lots of 1v1s and high standards. Leave a blank line between paragraphs.">${esc(v.requirementsText || '')}</textarea></label>
    <div class="j-field"><span>An application asks</span>${QS.map(([k, l]) => `<label class="j-check" style="padding:4px 0"><input type="checkbox" data-qk="${k}" ${(v.questions || []).includes(k) ? 'checked' : ''}> <span>${esc(l)}</span></label>`).join('')}</div>
    ${g ? (g.byCoach ? '<p class="muted small" style="margin-bottom:8px">One group per coach at this time: players are in it when their Coach in Airtable is this coach.</p>' : '') : `<label class="j-check"><input type="checkbox" id="gm-bycoach"> <span>One group per coach at this time (like the early morning groups). Players go by their Coach in Airtable.</span></label>`}
    <label class="j-field"><span>Who this group is for, in words parents see <span class="muted">(optional, replaces the standard wording)</span></span><input class="j-input" id="gm-note" value="${esc(v.publicNote || '')}" maxlength="200" placeholder="For example: Players aged 8 to 11 who play club football"></label>
    ${g ? '<p class="muted small">Changing the day, time or location moves every player in this group in Airtable too.</p>' : ''}
    <p class="j-err" id="gm-err" hidden></p>
    <div style="display:flex;gap:8px;justify-content:space-between;margin-top:10px">${g ? '<button type="button" class="j-btn j-btn-danger" id="gm-del">Delete</button>' : '<span></span>'}<span style="display:flex;gap:8px"><button type="button" class="j-btn j-btn-line" data-close>Cancel</button><button type="button" class="j-btn j-btn-dark" id="gm-save">Save</button></span></div>`, { wide: true })
  box.querySelector('#gm-save').addEventListener('click', async () => {
    const val = (id) => box.querySelector(id).value
    const group = { day: val('#gm-day'), time: val('#gm-time').trim(), location: val('#gm-loc').trim(), coachId: val('#gm-coach'), mode: val('#gm-mode'), label: val('#gm-label'), minAge: val('#gm-min'), maxAge: val('#gm-max'), ageStatus: val('#gm-agest'), girlsOnly: val('#gm-girls'), capacity: val('#gm-cap'), durationMin: val('#gm-dur'), publicNote: val('#gm-note'), extraCoachIds: [...box.querySelector('#gm-extra').selectedOptions].map((o) => o.value).filter((c) => c !== val('#gm-coach')), product: val('#gm-prod'), trials: box.querySelector('#gm-trials').checked, questions: [...box.querySelectorAll('[data-qk]')].filter((c) => c.checked).map((c) => c.dataset.qk), requirements: [...box.querySelectorAll('[data-rk]')].filter((c) => c.checked).map((c) => c.dataset.rk), requirementsText: val('#gm-reqtext'), ...(g ? {} : { byCoach: Boolean(box.querySelector('#gm-bycoach')?.checked) }) }
    const r = await post('saveGroup', { id: g?.id, group })
    if (!r.ok) { const e = box.querySelector('#gm-err'); e.textContent = r.data.error; e.hidden = false; return }
    closeModal(); toast(r.data.movedPlayers ? `Saved. ${r.data.movedPlayers} players moved in Airtable.` : 'Saved'); P.board = null; P.groups = null; if (P.tab === 'board') renderBoard(true); else renderGroups()
  })
  box.querySelector('#gm-del')?.addEventListener('click', async () => {
    if (!(await confirmBox(`Delete ${esc(g.day)} ${esc(g.time)}? Only possible when nobody is in it.`, { ok: 'Delete', danger: true }))) return
    const r = await post('deleteGroup', { id: g.id })
    if (!r.ok) return toast(r.data.error)
    toast('Deleted'); P.board = null; renderGroups()
  })
}

// ---------- requests ----------

const ANSWER = { club: 'Club', team: 'Team', playingUp: 'Playing', trainedBefore: 'Trained with Joner', position: 'Position', videos: 'Videos' }
// Links a family pasted, made clickable (only http and https).
const linksHtml = (text) => String(text || '').split(/\s+/).filter((u) => /^https?:\/\/[^\s<>"']+$/.test(u)).map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer nofollow">${esc(u.replace(/^https?:\/\/(www\.)?/, '').slice(0, 40))}</a>`).join(' · ')

async function renderRequests() {
  const d = await need(await post('requests'))
  P.pendingCount = d.requests.filter((r) => r.status === 'pending').length
  renderNav()
  if (!P.board) P.board = await need(await post('board'))
  const list = d.requests.filter((r) => P.reqFilter === 'all' || r.status === P.reqFilter)
  const kind = { application: ['violet', 'Application'], waitlist: ['amber', 'Waitlist'], enquiry: ['grey', 'Enquiry'] }
  view().innerHTML = `
    <div class="jp-head"><div><h1>Requests</h1><p class="muted small">Applications, waitlist and 1 to 1 enquiries. Accept for the term, offer a trial first, or decline.</p></div>
      <div class="jp-seg" id="rq-f">${[['pending', 'Waiting'], ['offered', 'Offered'], ['all', 'All']].map(([v, l]) => `<button type="button" data-f="${v}" aria-pressed="${P.reqFilter === v}">${l}</button>`).join('')}</div></div>
    ${list.length ? list.map((r) => `<article class="j-card" style="padding:16px;margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap"><div><span class="j-pill j-pill-${kind[r.kind]?.[0] || 'grey'}">${esc(kind[r.kind]?.[1] || r.kind)}</span> <b style="margin-left:6px">${esc(r.players.map((p) => `${p.name}${p.age != null ? `, ${p.age}` : ''}`).join(' and '))}</b>
        <p class="muted small" style="margin-top:4px">Wants <b>${esc(r.group)}</b> · ${esc(new Date(r.createdAt).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' }))}</p></div>
        <span class="j-pill j-pill-grey">${esc(r.status === 'offered' ? (r.offer === 'trial' ? 'Trial offered' : 'Place offered') : ({ pending: 'Waiting', declined: 'Declined', done: 'Done', expired: 'Offer expired' }[r.status] || r.status))}</span></div>
      ${Object.keys(r.answers || {}).length ? `<p class="small" style="margin-top:8px">${Object.entries(r.answers).filter(([k]) => k !== 'videos').map(([k, v]) => `<span class="muted">${esc(ANSWER[k] || k)}:</span> <b>${esc(v)}</b>`).join(' · ')}${r.answers.videos ? `<br><span class="muted">Videos:</span> ${linksHtml(r.answers.videos) || esc(r.answers.videos)}` : ''}</p>` : r.club ? `<p class="small" style="margin-top:8px"><span class="muted">Club:</span> <b>${esc(r.club)}</b></p>` : ''}
      <p class="small" style="margin-top:6px">${esc(r.parentName)} · <a href="mailto:${esc(r.email)}">${esc(r.email)}</a> · <a href="tel:${esc(r.mobile)}">${esc(r.mobile)}</a></p>
      ${r.message ? `<p class="small j-box j-box-grey" style="margin-top:8px">${esc(r.message)}</p>` : ''}
      ${r.players.some((p) => p.isNew) ? `<p class="muted small" style="margin-top:6px">New to JFP${r.players.some((p) => p.waiver) ? ', waiver signed' : ''}.</p>` : r.players.some((p) => p.waiver) ? '<p class="muted small" style="margin-top:6px">Waiver signed with the application.</p>' : ''}
      ${['pending', 'offered'].includes(r.status) ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">${r.status === 'pending' && r.kind !== 'enquiry' ? `<button type="button" class="j-btn j-btn-dark j-btn-sm" data-offer="${esc(r.id)}">Accept for the term</button><button type="button" class="j-btn j-btn-line j-btn-sm" data-trial="${esc(r.id)}">Trial first</button>` : ''}<button type="button" class="j-btn j-btn-line j-btn-sm" data-decline="${esc(r.id)}">Decline</button><button type="button" class="j-btn j-btn-ghost j-btn-sm" data-done="${esc(r.id)}">Mark done</button></div>` : ''}
    </article>`).join('') : '<div class="j-empty">Nothing here.</div>'}`
  $('rq-f').addEventListener('click', (e) => { const b = e.target.closest('[data-f]'); if (b) { P.reqFilter = b.dataset.f; renderRequests() } })
  view().querySelectorAll('[data-offer]').forEach((b) => b.addEventListener('click', () => offerModal(d.requests.find((r) => r.id === b.dataset.offer), 'offer')))
  view().querySelectorAll('[data-trial]').forEach((b) => b.addEventListener('click', () => offerModal(d.requests.find((r) => r.id === b.dataset.trial), 'trial')))
  view().querySelectorAll('[data-decline]').forEach((b) => b.addEventListener('click', () => declineModal(d.requests.find((r) => r.id === b.dataset.decline))))
  for (const [attr, decision, label] of [['data-done', 'done', 'Mark this request as done?']]) {
    view().querySelectorAll(`[${attr}]`).forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirmBox(label))) return
      const r = await post('decideRequest', { id: b.getAttribute(attr), decision })
      if (!r.ok) return toast(r.data.error)
      toast('Updated'); renderRequests()
    }))
  }
}

function declineModal(r) {
  const box = modal(`<h2 style="margin-bottom:6px">Decline</h2><p class="muted small" style="margin-bottom:12px">${esc(r.players.map((p) => p.name).join(', '))} for ${esc(r.group)}.</p>
    <label class="j-field"><span>Suggest another group <span class="muted">(optional)</span></span><select class="j-select" id="dc-g"><option value="">No suggestion</option>${groupOptions('', { exclude: r.groupId })}</select></label>
    <label class="j-field"><span>A line from you <span class="muted">(optional, goes in the email)</span></span><textarea class="j-textarea" id="dc-msg"></textarea></label>
    <label class="j-check"><input type="checkbox" id="dc-send" checked> <span>Email the family a kind no (it says the group is not the right level this term${' '}and points to the suggestion)</span></label>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px"><button type="button" class="j-btn j-btn-line" data-close>Cancel</button><button type="button" class="j-btn j-btn-danger" id="dc-go">Decline</button></div>`)
  box.querySelector('#dc-go').addEventListener('click', async (e) => {
    e.currentTarget.disabled = true
    const res = await post('decideRequest', { id: r.id, decision: 'decline', suggestGroupId: box.querySelector('#dc-g').value, message: box.querySelector('#dc-msg').value.trim(), sendEmail: box.querySelector('#dc-send').checked })
    if (!res.ok) return toast(res.data.error)
    closeModal(); toast(res.data.emailed ? 'Declined and emailed' : 'Declined'); renderRequests()
  })
}

async function offerModal(r, decision) {
  const pr = await pricing()
  const trial = decision === 'trial'
  const box = modal(`<h2 style="margin-bottom:6px">${trial ? 'Offer a trial first' : 'Accept for the term'}</h2><p class="muted small" style="margin-bottom:12px">${esc(r.players.map((p) => p.name).join(', '))}. The place is held in Airtable as Awaiting Reply for 7 days, and locks in once it is paid.</p>
    <label class="j-field"><span>Group</span><select class="j-select" id="of-g">${groupOptions(r.groupId)}</select></label>
    <div id="of-body"></div>
    <label class="j-check"><input type="checkbox" id="of-send" checked> <span>Email the family ${trial ? 'the trial date and a link to pay for it' : 'the offer and payment link'}</span></label>
    <div id="of-out"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px"><button type="button" class="j-btn j-btn-line" data-close>Close</button><button type="button" class="j-btn j-btn-dark" id="of-go">${trial ? 'Offer trial' : 'Offer place'}</button></div>`)
  let read
  const draw = () => {
    const g = P.board.groups.find((x) => x.id === box.querySelector('#of-g').value)
    if (trial) {
      box.querySelector('#of-body').innerHTML = `<div class="j-two"><label class="j-field"><span>Trial session</span><select class="j-select" id="of-date">${dateOptions(pr, g.day, nextDate(pr, g.day))}</select></label><label class="j-field"><span>Trial price (A$)</span><input class="j-input" id="of-amt" inputmode="decimal" value="${(pr.prices.trial * r.players.length) / 100}"></label></div>`
      read = () => ({ startDate: box.querySelector('#of-date').value, amountCents: Math.round(Number(box.querySelector('#of-amt').value) * 100) })
    } else {
      box.querySelector('#of-body').innerHTML = '<div id="of-price"></div>'
      read = priceBlock(box, pr, { day: g.day, product: g.product || 'group', players: r.players.length, prefix: 'of-price', noTrial: true })
    }
  }
  draw()
  box.querySelector('#of-g').addEventListener('change', draw)
  const go = async () => {
    const body = { id: r.id, decision, groupId: box.querySelector('#of-g').value, ...read(), sendEmail: box.querySelector('#of-send').checked }
    const btn = box.querySelector('#of-go')
    if (btn.disabled) return
    btn.disabled = true
    let res = await post('decideRequest', body)
    btn.disabled = false
    if (res.status === 409 && res.data.code === 'full') {
      if (!(await confirmBox(esc(res.data.error), { ok: 'Offer anyway' }))) return
      res = await post('decideRequest', { ...body, force: true })
      if (!res.ok) return toast(res.data.error)
      toast(`Offered${res.data.emailed ? ' and emailed' : ''}`)
      copy(res.data.payreq.url)
      P.board = null
      return renderRequests()
    }
    if (!res.ok) return toast(res.data.error)
    box.querySelector('#of-out').innerHTML = `<div class="j-box j-box-green" style="margin:10px 0">${trial ? 'Trial offered' : 'Place offered'}, ${esc(res.data.payreq.amountLabel)}${res.data.emailed ? ', emailed' : ''}. <button type="button" class="j-btn j-btn-line j-btn-sm" id="of-copy">Copy payment link</button></div>`
    box.querySelector('#of-copy').addEventListener('click', () => copy(res.data.payreq.url))
    box.querySelector('#of-go').hidden = true
    box.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => renderRequests()))
    P.board = null
  }
  box.querySelector('#of-go').addEventListener('click', go)
}

// ---------- payment links ----------

const REASON = { 'admin-add': 'Spot link', balance: 'Balance', application: 'Application offer', waitlist: 'Waitlist offer', trial: 'Trial', 'term-after-trial': 'Term after trial' }

async function renderPayments() {
  const d = await need(await post('payments'))
  if (!P.board) P.board = await need(await post('board'))
  const eff = (e) => (!e ? '' : e.ok ? '<span class="j-pill j-pill-green">Airtable and emails done</span>' : `<span class="j-pill j-pill-red">${esc([...e.failed, ...e.uncertain, ...e.pending].join(', '))}</span>`)
  const when = (iso) => new Date(iso).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
  const state = (q) => {
    if (q.status === 'paid') return `<span class="j-pill j-pill-green">Paid</span><div class="muted small" style="margin-top:3px">${q.paidAt ? esc(when(q.paidAt)) : ''}</div>`
    if (['cancelled', 'expired'].includes(q.status)) return `<span class="j-pill j-pill-grey">${esc(q.status)}</span>`
    const pill = q.status === 'checkout' ? '<span class="j-pill j-pill-amber">Paying now</span>' : q.views ? `<span class="j-pill j-pill-amber">Opened ${q.views === 1 ? 'once' : `${q.views} times`}</span>` : q.emailedAt ? '<span class="j-pill j-pill-blue">Emailed</span>' : '<span class="j-pill j-pill-blue">Not sent yet</span>'
    return `${pill}<div class="muted small" style="margin-top:3px">${q.emailedAt ? `Emailed ${esc(when(q.emailedAt))}` : `Made ${esc(when(q.createdAt))}`}${q.expiresAt ? ` · holds until ${esc(new Date(q.expiresAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }))}` : ''}</div>`
  }
  const filt = { open: (q) => ['open', 'checkout'].includes(q.status), paid: (q) => q.status === 'paid', closed: (q) => ['cancelled', 'expired'].includes(q.status) }
  const counts = Object.fromEntries(Object.entries(filt).map(([k, f]) => [k, d.payreqs.filter(f).length]))
  const list = d.payreqs.filter(filt[P.linkFilter] || filt.open)
  const attention = [...d.payreqs, ...d.bookings].filter((x) => x.needsAttention)
  const attnWord = { 'paid-after-cancel': 'Paid after it was cancelled', 'second-payment': 'Paid twice', 'late-payment': 'Paid after the hold ran out' }
  view().innerHTML = `
    <div class="jp-head"><div><h1>Payment links</h1><p class="muted small">Make a link for any player, change the amount on an open one, or copy it to send yourself. You never need to open Stripe. Refunds are made in Stripe.</p></div>
      <button type="button" class="j-btn j-btn-dark" id="pl-new">+ New payment link</button></div>
    ${attention.length ? `<div class="j-box j-box-red" style="margin-bottom:16px"><b>Needs checking</b>${attention.map((x) => `<div style="margin-top:8px">${esc(x.players.join(', '))} · ${esc(x.parentName)} · ${esc(String(x.needsAttention).split(', ').map((k) => attnWord[k] || k).join(', '))}${(x.unexpected || []).map((u) => ` · ${esc(u.amountLabel)}${u.stripeUrl ? ` <a href="${esc(u.stripeUrl)}" target="_blank" rel="noopener noreferrer">Stripe</a>` : ''}`).join('')}</div>`).join('')}<p class="small" style="margin-top:8px">A payment that arrived after a cancel is not added to Airtable. Give the family the place (add them on the timetable) or refund in Stripe.</p></div>` : ''}
    <div class="jp-seg" id="pl-f" style="margin-bottom:10px">${[['open', `Open ${counts.open}`], ['paid', `Paid ${counts.paid}`], ['closed', `Cancelled or expired ${counts.closed}`]].map(([v, l]) => `<button type="button" data-f="${v}" aria-pressed="${P.linkFilter === v}">${l}</button>`).join('')}</div>
    ${list.length ? `<div class="jp-scroll"><table class="jp-table"><thead><tr><th>Player</th><th>For</th><th>Amount</th><th>Status</th><th></th></tr></thead><tbody>
      ${list.map((q) => `<tr><td><b>${esc(q.players.join(', '))}</b><br><span class="muted small">${esc(q.parentName)} · ${esc(q.email)}</span></td>
        <td>${esc(q.group || 'No group')}<br><span class="muted small">${esc(REASON[q.kind] || q.kind)}${q.productLabel ? ` · ${esc(q.productLabel)}` : ''}${q.trialDate ? ` · trial ${esc(q.trialDate)}` : q.startDate ? ` · from ${esc(q.startDate)}` : ''}${q.afterpay ? '' : ' · card only'}</span></td>
        <td>${esc(q.amountLabel)}${q.feeLabel ? `<br><span class="muted small">fee ${esc(q.feeLabel)}</span>` : ''}</td><td>${state(q)}${q.status === 'paid' ? `<div style="margin-top:4px">${eff(q.effects)}</div>` : ''}</td>
        <td style="white-space:nowrap">${['open', 'checkout'].includes(q.status) ? `<button type="button" class="j-btn j-btn-line j-btn-sm" data-change="${esc(q.id)}">Change amount</button> <button type="button" class="j-btn j-btn-line j-btn-sm" data-copy="${esc(q.url)}">Copy</button> <button type="button" class="j-btn j-btn-ghost j-btn-sm" data-cancel-pay="${esc(q.id)}">Cancel</button>` : ''}${q.effects && !q.effects.ok ? `<button type="button" class="j-btn j-btn-line j-btn-sm" data-repair="${esc(q.id)}">Repair</button>` : ''}${q.stripeUrl ? ` <a class="j-btn j-btn-ghost j-btn-sm" href="${esc(q.stripeUrl)}" target="_blank" rel="noopener noreferrer">Stripe</a>` : ''}</td></tr>`).join('')}
    </tbody></table></div>` : '<div class="j-empty">Nothing here.</div>'}
    <h2 style="margin:22px 0 10px">Online bookings</h2>
    ${d.bookings.length ? `<div class="jp-scroll"><table class="jp-table"><thead><tr><th>Players</th><th>Group</th><th>Paid</th><th>Status</th><th>Airtable and emails</th><th></th></tr></thead><tbody>
      ${d.bookings.map((b) => `<tr><td><b>${esc(b.players.join(', ') || 'Not chosen yet')}</b><br><span class="muted small">${esc(b.parentName)} · ${esc(b.email)}</span></td><td>${esc(b.group)}</td><td>${esc(b.amountLabel)}${b.feeLabel ? `<br><span class="muted small">fee ${esc(b.feeLabel)}</span>` : ''}</td><td><span class="j-pill j-pill-${b.status === 'paid' ? 'green' : b.status === 'held' ? 'amber' : 'grey'}">${esc(b.status)}</span>${b.needsAttention ? ` <span class="j-pill j-pill-red">${esc(b.needsAttention)}</span>` : ''}</td><td>${eff(b.effects)}</td>
        <td style="white-space:nowrap">${b.effects && !b.effects.ok ? `<button type="button" class="j-btn j-btn-line j-btn-sm" data-repair="${esc(b.id)}">Repair</button>` : ''}${b.status === 'held' ? `<button type="button" class="j-btn j-btn-ghost j-btn-sm" data-cancel-booking="${esc(b.id)}">Release</button>` : ''}${b.stripeUrl ? ` <a class="j-btn j-btn-ghost j-btn-sm" href="${esc(b.stripeUrl)}" target="_blank" rel="noopener noreferrer">Stripe</a>` : ''}</td></tr>`).join('')}
    </tbody></table></div>` : '<div class="j-empty">No online bookings yet.</div>'}`
  $('pl-f').addEventListener('click', (e) => { const b = e.target.closest('[data-f]'); if (b) { P.linkFilter = b.dataset.f; renderPayments() } })
  $('pl-new').addEventListener('click', () => newLinkModal())
  view().querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', () => copy(b.dataset.copy)))
  view().querySelectorAll('[data-change]').forEach((b) => b.addEventListener('click', () => changeModal(d.payreqs.find((q) => q.id === b.dataset.change))))
  view().querySelectorAll('[data-repair]').forEach((b) => b.addEventListener('click', async () => { b.disabled = true; const r = await post('repair', { id: b.dataset.repair }); toast(r.ok ? (r.data.summary.ok ? 'Repaired' : 'Still not complete. Check Airtable and try again.') : r.data.error); renderPayments() }))
  view().querySelectorAll('[data-cancel-pay]').forEach((b) => b.addEventListener('click', async () => { if (!(await confirmBox('Cancel this payment link? The family will not be able to pay with it, and a place held for it goes back.'))) return; const r = await post('cancelPayreq', { id: b.dataset.cancelPay }); toast(r.ok ? 'Cancelled' : r.data.error); P.board = null; renderPayments() }))
  view().querySelectorAll('[data-cancel-booking]').forEach((b) => b.addEventListener('click', async () => { if (!(await confirmBox('Release this held place?'))) return; const r = await post('cancelBooking', { id: b.dataset.cancelBooking }); toast(r.ok ? 'Released' : r.data.error); renderPayments() }))
}

function changeModal(q) {
  const box = modal(`<h2 style="margin-bottom:6px">Change the amount</h2><p class="muted small" style="margin-bottom:12px">${esc(q.players.join(', '))} · now ${esc(q.amountLabel)}. The link stays the same: the family opens it and sees the new amount. A payment page they already have open is closed first.</p>
    <label class="j-field"><span>New amount (A$)</span><input class="j-input" id="ch-amt" inputmode="decimal" value="${(q.amountCents / 100).toFixed(2).replace(/\.00$/, '')}"></label>
    <label class="j-check"><input type="checkbox" id="ch-send"> <span>Email the family the new amount</span></label>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px"><button type="button" class="j-btn j-btn-line" data-close>Cancel</button><button type="button" class="j-btn j-btn-dark" id="ch-go">Save</button></div>`)
  box.querySelector('#ch-go').addEventListener('click', async () => {
    const amountCents = Math.round(Number(box.querySelector('#ch-amt').value) * 100)
    if (!(amountCents > 0)) return toast('Enter the new amount.')
    const r = await post('changePayreqAmount', { id: q.id, amountCents, sendEmail: box.querySelector('#ch-send').checked })
    if (!r.ok) return toast(r.data.error)
    closeModal(); toast(`Now ${r.data.amountLabel}${r.data.emailed ? ', emailed' : ''}`); renderPayments()
  })
}

// Pick any player on the timetable, then the same link form as the board.
function newLinkModal() {
  const all = P.board.groups.flatMap((g) => g.players.map((p) => ({ p, g }))).concat(P.board.unassigned.map((p) => ({ p, g: null })))
  const box = modal(`<h2 style="margin-bottom:10px">New payment link</h2>
    <label class="j-field"><span>Player</span><input class="j-input" id="nl-q" placeholder="Start typing a name" autocomplete="off"></label>
    <div id="nl-res"></div>
    <p class="muted small">New to JFP? Add them to a group on the timetable with "Send a link to this spot".</p>`)
  box.querySelector('#nl-q').addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase()
    const hits = q.length < 2 ? [] : all.filter(({ p }) => p.name.toLowerCase().includes(q)).slice(0, 8)
    box.querySelector('#nl-res').innerHTML = hits.map(({ p, g }, i) => `<button type="button" class="j-player" data-i="${i}"><span><b>${esc(p.name)}</b><br><span class="muted small">${g ? `${esc(g.day)} ${esc(g.time)} · Coach ${esc(g.coachName)}` : 'Not in a group'} · ${esc(p.parent || '')}</span></span>${payPill(p)}</button>`).join('')
    box.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => { const h = hits[Number(b.dataset.i)]; closeModal(); linkModal(h.p, h.g) }))
  })
}

// ---------- prices (Lee and Ligia only) ----------

async function renderPrices() {
  const pr = P.pricing = await need(await post('pricing'))
  view().innerHTML = `<div class="jp-head"><div><h1>Prices</h1><p class="muted small">Private: only you and Ligia see this tab. Parents never see a term price on the timetable; they see what they pay when they book or open a link.</p></div></div>
    <div class="j-card jp-prices" style="padding:18px;max-width:760px">
      <table class="jp-table"><thead><tr><th>What</th><th>Price (A$)</th><th>Pro rata</th></tr></thead><tbody>
      ${pr.products.map((x) => `<tr><td><b>${esc(x.label)}</b><br><span class="muted small">Airtable type: ${esc(x.type)}${x.perPlaces > 1 ? ' · covers two places' : ''}</span></td><td><input class="j-input" data-price="${esc(x.key)}" inputmode="decimal" value="${x.cents / 100}"></td><td>${x.proRata ? 'Yes, sessions left' : 'No'}</td></tr>`).join('')}
      </tbody></table>
      <p class="muted small" style="margin-top:12px">Joining in week 4 of ${pr.weeks} pays for ${pr.weeks - 3} sessions: A$850 x ${pr.weeks - 3}/${pr.weeks} = A$${(850 * (pr.weeks - 3)) / pr.weeks}. Two siblings in one booking pay the two place rate each. After a trial, the trial price is taken off the term. Afterpay is on for every link unless you untick it.</p>
      <p class="j-err" id="pr-err" hidden></p>
      <button type="button" class="j-btn j-btn-dark" id="pr-save" style="margin-top:10px">Save prices</button>
    </div>`
  $('pr-save').addEventListener('click', async () => {
    const prices = {}
    view().querySelectorAll('[data-price]').forEach((i) => { prices[i.dataset.price] = Math.round(Number(i.value) * 100) })
    if (Object.values(prices).some((v) => !(v > 0))) { $('pr-err').textContent = 'Every price needs an amount.'; $('pr-err').hidden = false; return }
    const r = await post('saveSettings', { config: { prices } })
    if (!r.ok) { $('pr-err').textContent = r.data.error; $('pr-err').hidden = false; return }
    P.pricing = null
    toast('Prices saved')
    renderPrices()
  })
}

// ---------- money ----------

async function renderMoney() {
  const m = (await need(await post('money'))).money
  const a = m.airtable, o = m.online
  view().innerHTML = `
    <div class="jp-head"><div><h1>Money</h1><p class="muted small">${esc(m.notes)}</p></div></div>
    <div class="jp-kpis">
      <div class="jp-kpi"><span>Players marked Paid</span><b>${a.byStatus.Paid || 0}<span class="muted" style="font-size:14px;font-weight:600"> / ${a.players}</span></b></div>
      <div class="jp-kpi"><span>Marked Unpaid</span><b>${a.byStatus.Unpaid || 0}</b></div>
      <div class="jp-kpi"><span>Payment not set</span><b>${a.byStatus['Not Set'] || 0}</b></div>
      <div class="jp-kpi"><span>Paid online (${o.payments})</span><b>${money(o.grossCents)}</b></div>
      <div class="jp-kpi"><span>Stripe fees online</span><b>${money(o.stripeFeesCents)}</b></div>
    </div>
    <p class="small" style="margin-bottom:16px">All statuses: ${Object.entries(a.byStatus).map(([k, v]) => `${esc(k)} ${v}`).join(' · ')}. In Airtable dollars: fees ${money(a.feesCents)}, amounts paid ${money(a.paidCents)}, balances on rows not marked Paid ${money(a.owingCents)} across ${a.owingPlayers} players. Many rows marked Paid have no amount entered, so the dollar figures are only as good as what is typed in. Online net after Stripe fees ${money(o.netCents)}${o.feesPending ? ` (${o.feesPending} fees still to read)` : ''}.</p>
    <h2 style="margin-bottom:10px">Owing</h2>
    ${m.owing.length ? `<div class="jp-scroll"><table class="jp-table"><thead><tr><th>Player</th><th>Group</th><th>Owing</th><th>Status</th><th>Notes</th><th></th></tr></thead><tbody>
      ${m.owing.map((r) => `<tr><td><b>${esc(r.player)}</b><br><span class="muted small">${esc(r.parent)} · ${esc(r.email)}</span></td><td>${esc(r.group)}</td><td>${money(r.balanceCents)}</td><td>${esc(r.status)}</td><td class="small" style="max-width:260px">${esc(r.linkNotes || '')}</td><td><button type="button" class="j-btn j-btn-line j-btn-sm" data-link-row="${esc(r.rowId)}">Payment link</button></td></tr>`).join('')}
    </tbody></table></div>` : '<div class="j-empty">Nothing owing.</div>'}
    <h2 style="margin:22px 0 10px">Recent online payments</h2>
    ${o.recent.length ? `<div class="jp-scroll"><table class="jp-table"><thead><tr><th>When</th><th>Who</th><th>For</th><th>Amount</th><th>Stripe fee</th></tr></thead><tbody>${o.recent.map((s) => `<tr><td>${esc(s.at ? new Date(s.at).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' }) : '')}</td><td>${esc(s.who)}</td><td>${esc(s.kind)}</td><td>${esc(s.label)}</td><td>${esc(s.feeLabel)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="j-empty">No online payments yet.</div>'}`
  view().querySelectorAll('[data-link-row]').forEach((b) => b.addEventListener('click', async () => {
    if (!P.board) P.board = await need(await post('board'))
    const f = findPlayer(b.dataset.linkRow)
    if (f) linkModal(f.p, f.g); else toast('Open the board to send this one.')
  }))
}

// ---------- coach view ----------

async function renderCoach() {
  const admin = P.user.role === 'admin'
  if (admin && !P.coaches) P.coaches = (await need(await post('me'))).coaches
  if (admin && !P.coachId) P.coachId = P.coaches?.[0]?.id || ''
  const d = await need(await post('coachSessions', { coachId: P.coachId }))
  const hrs = (min) => `${Math.floor(min / 60)}h${min % 60 ? ` ${min % 60}m` : ''}`
  view().innerHTML = `
    <div class="jp-head"><div style="display:flex;gap:12px;align-items:center">${avatar(d.coachPhoto, d.coach, 48)}<div><h1>${admin ? `Coach ${esc(d.coach)}` : 'My sessions'}</h1><p class="muted small">${esc(d.term)} · ${d.sessions.length} session${d.sessions.length === 1 ? '' : 's'} a week · ${hrs(d.hours.perWeekMinutes)} a week, ${hrs(d.hours.termMinutes)} across the term</p></div></div>
      ${admin ? `<div class="jp-seg" id="c-pick">${P.coaches.map((c) => `<button type="button" data-c="${esc(c.id)}" aria-pressed="${P.coachId === c.id}">${esc(c.name)}</button>`).join('')}</div>` : ''}</div>
    ${admin ? '<p class="muted small" style="margin-bottom:10px">This is exactly what the coach sees when they sign in: times, names and ages. No money, no parent contact details.</p>' : ''}
    ${d.sessions.length ? d.sessions.map((s) => {
      const date = P.coachDate[s.id] || s.nextDate
      return `<article class="j-card" style="padding:16px;margin-bottom:12px" data-sess="${esc(s.id)}">
        <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center"><div><h3 style="font-size:17px">${esc(s.day)} ${esc(s.time)} · ${esc(s.location)}</h3><p class="muted small">${esc(s.label)}${s.minAge != null ? ` · ages ${s.minAge} to ${s.maxAge}` : ''} · ${s.durationMin} min · ${s.players.length} player${s.players.length === 1 ? '' : 's'}</p></div>
          <select class="j-select" style="width:auto" data-date="${esc(s.id)}">${s.dates.map((x) => `<option value="${esc(x.iso)}" ${x.iso === date ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</select></div>
        <div style="margin-top:10px">${s.players.map((p) => `<div class="jp-player" style="cursor:default"><span class="nm">${esc(p.name)}${p.age != null ? ` <span class="muted">(${esc(p.age)})</span>` : ''}${!p.mine ? ` <span class="muted small">· ${esc(p.coach)}</span>` : ''}${p.trial ? ' <span class="j-pill j-pill-blue">Trial</span>' : ''}${p.status !== 'Confirmed' ? ` <span class="j-pill j-pill-amber">${esc(p.status)}</span>` : ''}</span>
          <span class="jp-att"><button type="button" class="p" data-att="Present" data-row="${esc(p.rowId)}" aria-pressed="${s.attendance[p.rowId] === 'Present'}">Here</button><button type="button" class="a" data-att="Absent" data-row="${esc(p.rowId)}" aria-pressed="${s.attendance[p.rowId] === 'Absent'}">Away</button></span></div>`).join('') || '<p class="muted small">No players yet.</p>'}</div>
      </article>`
    }).join('') : '<div class="j-empty">No sessions yet.</div>'}`
  $('c-pick')?.addEventListener('click', (e) => { const b = e.target.closest('[data-c]'); if (b) { P.coachId = b.dataset.c; renderCoach() } })
  view().querySelectorAll('[data-date]').forEach((sel) => sel.addEventListener('change', () => { P.coachDate[sel.dataset.date] = sel.value; loadAttendance(sel.dataset.date, sel.value) }))
  view().querySelectorAll('[data-att]').forEach((b) => b.addEventListener('click', async () => {
    const card = b.closest('[data-sess]')
    const gid = card.dataset.sess
    const date = card.querySelector('[data-date]').value
    const on = b.getAttribute('aria-pressed') === 'true'
    const status = on ? '' : b.dataset.att
    card.querySelectorAll(`[data-row="${CSS.escape(b.dataset.row)}"][data-att]`).forEach((x) => x.setAttribute('aria-pressed', String(x === b && !on)))
    const r = await post('markAttendance', { groupId: gid, date, rowId: b.dataset.row, status })
    if (!r.ok) { toast(r.data.error || 'Could not save'); renderCoach() }
    else if (r.data.airtable === 'failed') toast('Saved here. Airtable attendance did not update; it will not affect the session.')
  }))
}

async function loadAttendance() { renderCoach() }

// ---------- coaches: names, emails, photos ----------

function avatar(url, name, size = 56) {
  const initials = String(name || '').replace(/^Coach\s+/, '').split(/\s+/).map((w) => w[0] || '').join('').slice(0, 2).toUpperCase()
  return url
    ? `<img src="${esc(url)}" alt="" width="${size}" height="${size}" style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;object-position:50% 20%;flex:none;background:#eee">`
    : `<span aria-hidden="true" style="width:${size}px;height:${size}px;border-radius:50%;background:#eef0f3;color:#555;display:inline-flex;align-items:center;justify-content:center;font-weight:700;font-size:${Math.round(size / 2.8)}px;flex:none">${esc(initials)}</span>`
}

// Resize in the browser to a 4:5 portrait, at most 600 x 750, as a JPEG.
function photoDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!/^image\//.test(file.type || '') && !/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name || '')) return reject(new Error('Choose a photo.'))
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const want = 4 / 5
      let sw = img.naturalWidth, sh = img.naturalHeight, sx = 0, sy = 0
      if (sw / sh > want) { sw = Math.round(sh * want); sx = Math.round((img.naturalWidth - sw) / 2) } else { sh = Math.round(sw / want) }
      const w = Math.min(600, sw), h = Math.round(w / want)
      const cv = document.createElement('canvas')
      cv.width = w; cv.height = h
      cv.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, w, h)
      URL.revokeObjectURL(url)
      resolve(cv.toDataURL('image/jpeg', 0.85))
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file could not be read. Try a JPG or PNG.')) }
    img.src = url
  })
}

function photoPicker(el, coachId, onDone) {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.addEventListener('change', async () => {
    const file = input.files?.[0]
    if (!file) return
    el.disabled = true
    const was = el.textContent
    el.textContent = 'Uploading'
    try {
      const dataUrl = await photoDataUrl(file)
      const r = await post('coachPhoto', { coachId, dataUrl })
      if (!r.ok) throw new Error(r.data.error || 'Could not save the photo.')
      toast('Photo saved. It shows on the booking page now.')
      onDone(r.data.photo)
    } catch (e) { toast(e.message) } finally { el.disabled = false; el.textContent = was }
  })
  input.click()
}

async function renderProfile() {
  const d = await need(await post('me'))
  const u = d.user
  view().innerHTML = `<div class="jp-head"><div><h1>My profile</h1><p class="muted small">Your photo shows to parents on every group you coach.</p></div></div>
    <div class="j-card" style="padding:18px;max-width:520px;display:flex;gap:18px;align-items:center;flex-wrap:wrap">
      ${avatar(u.photo, u.name, 120)}
      <div><h2 style="margin-bottom:4px">${esc(u.name)}</h2><p class="muted small" style="margin-bottom:12px">${esc(u.email)}</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="j-btn j-btn-dark" id="pf-up">${u.photo ? 'Change photo' : 'Add a coaching photo'}</button>${u.photo ? '<button type="button" class="j-btn j-btn-line" id="pf-rm">Remove</button>' : ''}</div>
      <p class="muted small" style="margin-top:10px">A clear photo of you coaching, face visible. It is cropped to a portrait.</p></div>
    </div>`
  $('pf-up').addEventListener('click', (e) => photoPicker(e.currentTarget, u.coachId, () => renderProfile()))
  $('pf-rm')?.addEventListener('click', async () => {
    if (!(await confirmBox('Remove your photo from the booking page?', { ok: 'Remove' }))) return
    const r = await post('coachPhoto', { coachId: u.coachId, remove: true })
    toast(r.ok ? 'Photo removed.' : r.data.error); renderProfile()
  })
}

async function renderCoaches() {
  const [me, sd] = await Promise.all([need(await post('me')), need(await post('getSettings'))])
  const list = me.coaches
  const cfg = sd.config
  let rows = list.map((c) => ({ ...cfg.coaches.find((x) => x.id === c.id), photo: c.photo }))
  const draw = () => {
    view().innerHTML = `<div class="jp-head"><div><h1>Coaches</h1><p class="muted small">Full names show to parents on every group. Coaches sign in at <b>jonerfootball.com/jfp-portal</b> with the email here and a 6 digit code. Nobody is emailed from this page.</p></div></div>
      <label class="j-check" style="max-width:760px"><input type="checkbox" id="co-on" ${cfg.coachLoginsEnabled ? 'checked' : ''}> <span><b>Coach logins on.</b> Coaches see the program timetable (names and ages), their own registers and their profile. Never money or parent contact details.</span></label>
      <div style="display:grid;gap:12px;max-width:760px;margin-top:12px">${rows.map((c, i) => `<div class="j-card" style="padding:14px;display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap" data-co="${i}">
        <div style="display:flex;flex-direction:column;gap:6px;align-items:center">${avatar(c.photo, c.fullName, 84)}<button type="button" class="j-btn j-btn-line j-btn-sm" data-photo="${i}">${c.photo ? 'Change photo' : 'Add photo'}</button>${c.photo ? `<button type="button" class="j-btn j-btn-ghost j-btn-sm" data-photo-rm="${i}">Remove</button>` : ''}</div>
        <div style="flex:1;min-width:220px">
          <div class="j-two"><label class="j-field"><span>Full name (parents see this)</span><input class="j-input" data-cf="fullName" value="${esc(c.fullName)}"></label>
          <label class="j-field"><span>Sign-in email</span><input class="j-input" type="email" data-cf="email" value="${esc(c.email)}" placeholder="No login"></label></div>
          <label class="j-check"><input type="checkbox" data-cf="alerts" ${c.alerts ? 'checked' : ''}> <span>Email them when a family pays for a place in their group</span></label>
          <p class="muted small">Matches Airtable's Coach column as "${esc(c.airtableName || c.name)}"${c.id === 'lee' ? '. You sign in as super admin, so you see everything.' : ''}</p>
        </div></div>`).join('')}</div>
      <div class="j-card" style="padding:14px;max-width:760px;margin-top:12px"><h3 style="margin-bottom:8px">Add a coach</h3>
        <div class="j-two"><label class="j-field"><span>Full name</span><input class="j-input" id="co-new-name" placeholder="First and last name"></label><label class="j-field"><span>Email</span><input class="j-input" type="email" id="co-new-email"></label></div>
        <button type="button" class="j-btn j-btn-line j-btn-sm" id="co-add">Add to the list</button></div>
      <p class="j-err" id="co-err" hidden></p>
      <button type="button" class="j-btn j-btn-dark j-btn-lg" id="co-save" style="margin-top:12px">Save coaches</button>`
    const read = () => { rows = rows.map((c, i) => { const box = view().querySelector(`[data-co="${i}"]`); return { ...c, fullName: box.querySelector('[data-cf="fullName"]').value.trim(), email: box.querySelector('[data-cf="email"]').value.trim(), alerts: box.querySelector('[data-cf="alerts"]').checked } }) }
    view().querySelectorAll('[data-photo]').forEach((b) => b.addEventListener('click', () => { read(); const c = rows[Number(b.dataset.photo)]; if (!list.some((x) => x.id === c.id)) return toast('Save coaches first, then add the photo.'); photoPicker(b, c.id, (url) => { c.photo = url; draw() }) }))
    view().querySelectorAll('[data-photo-rm]').forEach((b) => b.addEventListener('click', async () => { read(); const c = rows[Number(b.dataset.photoRm)]; const r = await post('coachPhoto', { coachId: c.id, remove: true }); if (r.ok) { c.photo = ''; draw() } else toast(r.data.error) }))
    $('co-add').addEventListener('click', () => {
      read()
      const full = $('co-new-name').value.trim().replace(/\s+/g, ' ')
      if (!/\s/.test(full)) return toast('Enter their first and last name.')
      const first = full.split(' ')[0]
      let id = first.toLowerCase().replace(/[^a-z0-9]/g, '') || 'coach'
      while (rows.some((c) => c.id === id)) id += '2'
      rows.push({ id, name: first, fullName: full, airtableName: full, email: $('co-new-email').value.trim(), alerts: false, photo: '' })
      draw()
    })
    $('co-save').addEventListener('click', async () => {
      read()
      const bad = rows.find((c) => c.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email))
      if (bad) { $('co-err').textContent = `Check ${bad.fullName}'s email.`; $('co-err').hidden = false; return }
      const r = await post('saveSettings', { config: { coachLoginsEnabled: $('co-on').checked, coaches: rows.map(({ photo, ...c }) => c) } })
      if (!r.ok) { $('co-err').textContent = r.data.error; $('co-err').hidden = false; return }
      toast('Coaches saved'); P.coaches = null; P.board = null; renderCoaches()
    })
  }
  draw()
}

// ---------- removed, audit, settings ----------

async function renderRemoved() {
  const d = await need(await post('removed'))
  const live = d.players.filter((p) => !p.restored)
  const tally = {}
  for (const p of live) { const k = p.reason || 'No reason recorded'; tally[k] = (tally[k] || 0) + 1 }
  const when = (iso) => (iso ? new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '')
  view().innerHTML = `<div class="jp-head"><div><h1>Removed players</h1><p class="muted small">Everyone who has left ${esc(live[0]?.term || 'this term')}, and why. Tap a name for the full detail. Kept in Airtable under "Players dropped from term 4".</p></div></div>
    ${Object.keys(tally).length ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">${Object.entries(tally).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<span class="j-pill j-pill-grey">${esc(k)} · ${v}</span>`).join('')}</div>` : ''}
    ${d.players.length ? `<div class="jp-scroll"><table class="jp-table"><thead><tr><th>Player</th><th>Was in</th><th>Why they left</th><th>Removed</th><th>Payment</th><th></th></tr></thead><tbody>
      ${d.players.map((p, i) => `<tr${p.restored ? ' style="opacity:.55"' : ''}><td><button type="button" class="j-btn j-btn-ghost j-btn-sm" style="padding:0;font-weight:700" data-rm-open="${i}">${esc(p.name)}</button><br><span class="muted small">${esc(p.parent)}${p.email ? ` · ${esc(p.email)}` : ''}</span></td><td>${esc(p.session)}${p.coach ? `<br><span class="muted small">${esc(p.coach)}</span>` : ''}</td><td><b>${esc(p.reason || 'Not recorded')}</b>${p.details ? `<br><span class="muted small">${esc(p.details.slice(0, 90))}${p.details.length > 90 ? '…' : ''}</span>` : ''}</td><td class="small">${esc(when(p.removedAt))}${p.removedBy ? `<br><span class="muted">${esc(p.removedBy)}</span>` : ''}</td><td>${payPill(p)}</td><td>${p.restored ? '<span class="j-pill j-pill-green">Restored</span>' : `<button type="button" class="j-btn j-btn-line j-btn-sm" data-restore="${i}">Restore</button>`}</td></tr>`).join('')}
    </tbody></table></div>` : '<div class="j-empty">Nobody removed.</div>'}`
  const restore = async (p) => {
    if (!(await confirmBox(`Put ${esc(p.name)} back in ${esc(p.session || 'their group')} as Confirmed?`))) return
    const r = await post('restorePlayer', { droppedId: p.droppedId, rowId: p.rowId })
    toast(r.ok ? 'Restored to Term 4. Airtable updated.' : r.data.error); P.board = null; renderRemoved()
  }
  view().querySelectorAll('[data-restore]').forEach((b) => b.addEventListener('click', () => restore(d.players[Number(b.dataset.restore)])))
  view().querySelectorAll('[data-rm-open]').forEach((b) => b.addEventListener('click', () => {
    const p = d.players[Number(b.dataset.rmOpen)]
    const box = modal(`<h2 style="margin-bottom:4px">${esc(p.name)}</h2><p class="muted small" style="margin-bottom:12px">Left ${esc(p.term)}${p.removedAt ? ` on ${esc(when(p.removedAt))}` : ''}${p.removedBy ? `, removed by ${esc(p.removedBy)}` : ''}</p>
      <div class="j-box j-box-grey" style="margin-bottom:12px"><b>${esc(p.reason || 'No reason recorded')}</b>${p.details ? `<br>${esc(p.details)}` : ''}</div>
      <dl class="j-kv">
        <dt>Was in</dt><dd>${esc(p.session || 'Not set')}${p.coach ? `, ${esc(p.coach)}` : ''}</dd>
        <dt>Parent</dt><dd>${esc(p.parent || '')}</dd>
        <dt>Email</dt><dd>${p.email ? `<a href="mailto:${esc(p.email)}">${esc(p.email)}</a>` : 'None'}</dd>
        <dt>Mobile</dt><dd>${p.phone ? `<a href="tel:${esc(p.phone)}">${esc(p.phone)}</a>` : 'None'}</dd>
        <dt>Payment</dt><dd>${esc(p.paymentStatus || 'Not set')} · paid ${esc(money(p.paidCents))} of ${esc(money(p.feeCents))}${p.type ? ` · ${esc(p.type)}` : ''}</dd>
        ${p.notes ? `<dt>Notes</dt><dd style="font-weight:400;white-space:pre-wrap">${esc(p.notes)}</dd>` : ''}
      </dl>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px"><button type="button" class="j-btn j-btn-line" data-close>Close</button>${p.restored ? '' : '<button type="button" class="j-btn j-btn-dark" id="rm-restore">Restore to Term 4</button>'}</div>`, { wide: true })
    box.querySelector('#rm-restore')?.addEventListener('click', () => { closeModal(); restore(p) })
  }))
}

async function renderAudit() {
  const d = await need(await post('audit'))
  const summary = (e) => {
    const a = e.after || {}
    return esc([a.name, a.group && `to ${a.group}`, a.payment && `payment ${a.payment}`, a.cents && money(a.cents), a.emailed && 'emailed', a.changed != null && `${a.changed} changed`].filter(Boolean).join(' · '))
  }
  view().innerHTML = `<div class="jp-head"><div><h1>Audit log</h1><p class="muted small">Every change made in the portal and by families: who, what and when. Newest first.</p></div></div>
    ${d.entries.length ? `<div class="jp-scroll"><table class="jp-table"><thead><tr><th>When</th><th>Who</th><th>What</th><th>Record</th><th>Detail</th></tr></thead><tbody>
      ${d.entries.map((e) => `<tr><td style="white-space:nowrap">${esc(new Date(e.at).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' }))}</td><td>${esc(e.by)}</td><td>${esc(e.action)}</td><td class="small">${esc(e.target)}</td><td class="small">${summary(e)}</td></tr>`).join('')}
    </tbody></table></div>` : '<div class="j-empty">No changes yet.</div>'}`
}

async function renderSettings() {
  const sd = await need(await post('getSettings'))
  const c = sd.config
  let skips = [...(c.skipDates || [])]
  view().innerHTML = `<div class="jp-head"><div><h1>Settings</h1><p class="muted small">Term details, who can sign in, and alerts.</p></div></div>
    <div class="j-card" style="padding:18px;max-width:760px">
      <h2 style="margin-bottom:12px">Term</h2>
      <div class="j-two"><label class="j-field"><span>Term name</span><input class="j-input" id="s-term" value="${esc(c.term)}"></label><label class="j-field"><span>First day (a Monday)</span><input class="j-input" type="date" id="s-start" value="${esc(c.termStart)}"></label></div>
      <div class="j-two"><label class="j-field"><span>Weeks</span><input class="j-input" id="s-weeks" inputmode="numeric" value="${c.weeks}"></label><div class="j-field"><span>Prices</span><p class="small" style="padding-top:10px">In the <a href="#prices" data-tab="prices">Prices</a> tab.</p></div></div>
      <h2 style="margin:16px 0 12px">Who can sign in</h2>
      <label class="j-field"><span>Super admins (full access and money), one email per line</span><textarea class="j-textarea" id="s-admins">${esc(c.superAdmins.join('\n'))}</textarea></label>
      <label class="j-field"><span>Booking alert emails (Lee always gets them), one per line</span><textarea class="j-textarea" id="s-staff">${esc(c.staffEmails.join('\n'))}</textarea></label>
      <p class="small">Coach logins, names, emails and photos are in the <a href="#coaches" data-tab="coaches">Coaches</a> tab. Coach logins are <b>${c.coachLoginsEnabled ? 'on' : 'off'}</b>.</p>
      <h2 style="margin:16px 0 6px">No session dates</h2>
      <p class="muted small" style="margin-bottom:10px">Public holidays and cancelled sessions. Groups on that day skip it: their dates, calendars and pro rata count only real sessions. Save settings after changing.</p>
      <div id="s-skips"></div>
      <div class="j-two" style="margin-top:8px"><label class="j-field"><span>Date</span><input class="j-input" type="date" id="s-skip-date"></label><label class="j-field"><span>Why</span><input class="j-input" id="s-skip-why" placeholder="Public holiday, coach away..."></label></div>
      <button type="button" class="j-btn j-btn-line j-btn-sm" id="s-skip-add">Add date</button>
      <p class="small" style="margin:12px 0 6px"><b>NSW public holidays</b> <span class="muted">(tap to add)</span></p>
      <div style="display:flex;gap:6px;flex-wrap:wrap" id="s-hols">${sd.holidays.map((h) => `<button type="button" class="j-chip" data-hol="${esc(h.date)}" data-why="${esc(h.reason)}">${esc(h.label)} ${esc(h.reason)}${h.inTerm ? ' · this term' : ''}</button>`).join('')}</div>
      <p class="muted small" style="margin-top:6px">${sd.holidays.some((h) => h.inTerm) ? 'Some public holidays fall in this term.' : 'No NSW public holidays fall in this term.'}</p>
      <h2 style="margin:16px 0 12px">Training kit</h2>
      <div class="j-two"><label class="j-field"><span>JF playing kit link (required, families confirm it before paying)</span><input class="j-input" id="s-kit" value="${esc(c.kitUrl || '')}" placeholder="https://"></label>
      <label class="j-field"><span>Kit price shown to families</span><input class="j-input" id="s-kitprice" value="${esc(c.kitPriceLabel || 'A$50')}" maxlength="20"></label></div>
      <label class="j-field"><span>Line above the button</span><input class="j-input" id="s-kitnote" value="${esc(c.kitNote || '')}" maxlength="300"></label>
      <h2 style="margin:16px 0 12px">Waiver</h2>
      <label class="j-field"><span>Backup waiver form link</span><input class="j-input" id="s-waiver" value="${esc(c.waiverUrl)}"></label>
      <p class="muted small">Families sign the waiver on the booking page. This link is the backup.</p>
      <h2 style="margin:16px 0 12px">Locations</h2>
      ${c.locations.map((l) => `<div class="j-card" style="padding:12px;margin-bottom:8px" data-loc="${esc(l.id)}"><b>${esc(l.name)}</b><div class="j-two" style="margin-top:8px"><label class="j-field"><span>Line under the photo</span><input class="j-input" data-lf="blurb" value="${esc(l.blurb)}"></label><label class="j-field"><span>Photo path</span><input class="j-input" data-lf="photo" value="${esc(l.photo)}"></label></div><label class="j-field"><span>Address</span><input class="j-input" data-lf="address" value="${esc(l.address)}"></label></div>`).join('')}
      <p class="j-err" id="s-err" hidden></p>
      <button type="button" class="j-btn j-btn-dark j-btn-lg" id="s-save" style="margin-top:8px">Save settings</button>
    </div>`
  const drawSkips = () => {
    $('s-skips').innerHTML = skips.length ? skips.map((x, i) => `<div class="jp-player" style="cursor:default"><span><b>${esc(x.date)}</b> ${esc(x.reason)}</span><button type="button" class="j-btn j-btn-ghost j-btn-sm" data-skip-rm="${i}">Remove</button></div>`).join('') : '<p class="muted small">None. Every week of the term runs.</p>'
    $('s-skips').querySelectorAll('[data-skip-rm]').forEach((b) => b.addEventListener('click', () => { skips.splice(Number(b.dataset.skipRm), 1); drawSkips() }))
  }
  drawSkips()
  $('s-skip-add').addEventListener('click', () => { const d = $('s-skip-date').value; if (!d) return toast('Choose a date.'); skips = [...skips.filter((x) => x.date !== d), { date: d, reason: $('s-skip-why').value.trim() || 'No session' }].sort((a, b) => a.date.localeCompare(b.date)); drawSkips() })
  $('s-hols').addEventListener('click', (e) => { const b = e.target.closest('[data-hol]'); if (!b) return; skips = [...skips.filter((x) => x.date !== b.dataset.hol), { date: b.dataset.hol, reason: b.dataset.why }].sort((a, c2) => a.date.localeCompare(c2.date)); drawSkips(); toast(`${b.dataset.why} added. Save settings to apply.`) })
  $('s-save').addEventListener('click', async () => {
    const lines = (id) => $(id).value.split(/\s*[\n,]\s*/).map((s) => s.trim()).filter(Boolean)
    const config = {
      term: $('s-term').value.trim(), termStart: $('s-start').value, weeks: Number($('s-weeks').value),
      superAdmins: lines('s-admins'), staffEmails: lines('s-staff'), waiverUrl: $('s-waiver').value.trim(), kitUrl: $('s-kit').value.trim(), kitNote: $('s-kitnote').value.trim(), kitPriceLabel: $('s-kitprice').value.trim(), skipDates: skips,
      locations: c.locations.map((l) => { const box = view().querySelector(`[data-loc="${CSS.escape(l.id)}"]`); const v = { ...l }; box.querySelectorAll('[data-lf]').forEach((i) => { v[i.dataset.lf] = i.value.trim() }); return v }),
    }
    const r = await post('saveSettings', { config })
    if (!r.ok) { $('s-err').textContent = r.data.error; $('s-err').hidden = false; return }
    toast('Settings saved')
  })
}

document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-tab]')
  if (t) { go(t.dataset.tab); return }
  if (e.target.closest('#sign-out')) { await signOut('staff'); location.href = '/jfp-portal/' }
})

boot()
