// The JFP staff portal. Lee and Ligia see the whole program and the money;
// coaches see the program timetable (names and ages) and their own registers.
// Every change goes to Airtable through /api/jfp-portal-data, which checks
// the role again on the server.
import { $, esc, api, toast, signIn, whoAmI, signOut, money } from './jfp-common.js'
import { renderMessages } from './jfp-portal-messages.js'

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

// The sidebar: sections, each tab with a line icon. Coaches only ever get
// their own five tabs; the server checks every request again.
const NAV = {
  coach: [['Coaching', [['program', 'Program'], ['coach', 'My sessions'], ['staff', 'Cover and time off'], ['plans', 'Session plans'], ['profile', 'My profile']]]],
  admin: [
    ['Overview', [['overview', 'Dashboard']]],
    ['Program', [['board', 'Timetable'], ['families', 'Players'], ['messages', 'Messages'], ['requests', 'Requests'], ['groups', 'Groups and rules'], ['next', 'Next term'], ['holiday', 'Holiday training']]],
    ['Money', [['money', 'Money'], ['payments', 'Payment links'], ['prices', 'Prices']]],
    ['Coaches', [['coach', 'Registers'], ['staff', 'Cover and time off'], ['plans', 'Session plans'], ['coaches', 'Coaches']]],
    ['Admin', [['removed', 'Removed players'], ['audit', 'Audit log'], ['settings', 'Settings']]],
  ],
}
const ICON = {
  overview: '<path d="M4 13h6V4H4zM14 20h6v-9h-6zM4 20h6v-4H4zM14 4v4h6V4z"/>',
  board: '<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  program: '<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  families: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5M16 5.6a3 3 0 0 1 0 5.8M17.5 14.3c1.7.6 2.7 2.2 3 4.7"/>',
  requests: '<path d="M4 6.5h16v10H8.5L4 20z"/><path d="M8 10.5h8M8 13.5h5"/>',
  messages: '<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M3.5 7l8.5 6 8.5-6"/>',
  groups: '<path d="M4 6h16M4 12h16M4 18h10"/><circle cx="18" cy="18" r="2"/>',
  next: '<path d="M5 12h12M13 7l5 5-5 5"/>',
  holiday: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/>',
  money: '<rect x="3" y="6" width="18" height="12" rx="2.5"/><circle cx="12" cy="12" r="2.6"/><path d="M6.5 9.5v5M17.5 9.5v5"/>',
  payments: '<path d="M9.5 14.5 14.5 9.5M8 12l-2 2a3 3 0 0 0 4.2 4.2l2-2M16 12l2-2a3 3 0 0 0-4.2-4.2l-2 2"/>',
  prices: '<path d="M4 4h7l9 9-7 7-9-9z"/><circle cx="8.5" cy="8.5" r="1.4"/>',
  coach: '<path d="M8 4.5h8M9 3.5h6v3H9z"/><rect x="5" y="5" width="14" height="16" rx="2.5"/><path d="M8.5 11.5l1.8 1.8 3.5-3.6M8.5 17h7"/>',
  staff: '<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4M9 15l2 2 4-4"/>',
  plans: '<rect x="4" y="3.5" width="16" height="17" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M4 12h16"/>',
  coaches: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c.8-3.6 3.6-5.6 7-5.6s6.2 2 7 5.6"/>',
  profile: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c.8-3.6 3.6-5.6 7-5.6s6.2 2 7 5.6"/>',
  removed: '<path d="M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13"/>',
  audit: '<path d="M12 7v5l3 2"/><circle cx="12" cy="12" r="8.5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/>',
}
const icon = (k) => `<span class="ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICON[k] || ICON.overview}</svg></span>`
function tabs() { return NAV[P.user.role === 'admin' ? 'admin' : 'coach'].flatMap(([, list]) => list) }

function start() {
  $('app').hidden = false
  $('sign-out').hidden = false
  $('who-name').textContent = P.user.name.replace(/^Coach\s+/, '')
  $('who-small').textContent = P.user.role === 'admin' ? 'Super admin' : 'Coach'
  $('me-ini').textContent = P.user.name.replace(/^Coach\s+/, '').split(/\s+/).map((w) => w[0] || '').join('').slice(0, 2).toUpperCase()
  const hash = location.hash.slice(1)
  go(tabs().some(([k]) => k === hash) ? hash : tabs()[0][0])
}

function renderNav() {
  const sections = NAV[P.user.role === 'admin' ? 'admin' : 'coach']
  $('nav').innerHTML = sections.map(([title, list]) => `<p class="jp-nav-sec">${esc(title)}</p>${list.map(([k, label]) => `<button type="button" data-tab="${k}" data-label="${esc(label)}" aria-current="${P.tab === k ? 'page' : 'false'}">${icon(k)}<span class="jp-lbl">${esc(label)}</span>${k === 'requests' && P.pendingCount ? `<span class="count">${P.pendingCount}</span>` : ''}</button>`).join('')}`).join('')
}

// ---------- shell: collapsible sidebar, phone drawer, theme ----------

const root = () => $('jfp-portal')
function setCollapsed(on) {
  root().classList.toggle('nav-collapsed', on)
  $('nav-collapse').setAttribute('aria-expanded', String(!on))
  $('nav-collapse').title = on ? 'Expand menu' : 'Collapse menu'
  $('nav-collapse').querySelector('.jp-lbl').textContent = on ? 'Expand' : 'Collapse'
  try { localStorage.setItem('jfp-nav-collapsed', on ? '1' : '0') } catch {}
}
function setDrawer(open) {
  root().classList.toggle('nav-open', open)
  $('nav-scrim').hidden = !open
  $('nav-open').setAttribute('aria-expanded', String(open))
  if (open) $('nav').querySelector('[aria-current="page"]')?.focus()
}
function setTheme(t) {
  root().dataset.theme = t
  $('theme-toggle').setAttribute('aria-label', t === 'dark' ? 'Switch to light mode' : 'Switch to dark mode')
  try { localStorage.setItem('jfp-portal-theme', t) } catch {}
  if (P.tab === 'overview') renderOverview(true)
}
function bindShell() {
  setCollapsed(root().classList.contains('nav-collapsed'))
  $('nav-collapse').addEventListener('click', () => setCollapsed(!root().classList.contains('nav-collapsed')))
  $('nav-open').addEventListener('click', () => setDrawer(!root().classList.contains('nav-open')))
  $('nav-scrim').addEventListener('click', () => setDrawer(false))
  $('theme-toggle').addEventListener('click', () => setTheme(root().dataset.theme === 'dark' ? 'light' : 'dark'))
  $('theme-toggle').setAttribute('aria-label', root().dataset.theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode')
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && root().classList.contains('nav-open')) { setDrawer(false); $('nav-open').focus() }
    // [ toggles the sidebar on a laptop, like most dashboards.
    if (e.key === '[' && !e.target.closest('input, textarea, select, [contenteditable]') && window.matchMedia('(min-width: 1000px)').matches) setCollapsed(!root().classList.contains('nav-collapsed'))
  })
}
bindShell()

async function go(tab) {
  P.tab = tab
  history.replaceState(null, '', `#${tab}`)
  renderNav()
  view().innerHTML = '<p class="muted">Loading</p>'
  closeSide()
  setDrawer(false)
  const fn = { overview: renderOverview, next: renderNext, holiday: renderHoliday, board: renderBoard, program: renderProgram, groups: renderGroups, requests: renderRequests, payments: renderPayments, prices: renderPrices, money: renderMoney, coach: renderCoach, coaches: renderCoaches, profile: renderProfile, staff: renderStaff, plans: renderPlans, families: renderFamilies, messages: () => renderMessages({ view, need, modal, closeModal, confirmBox }), removed: renderRemoved, audit: renderAudit, settings: renderSettings }[tab]
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
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin:10px 0"><span class="j-pill j-pill-${modePill(g)}">${esc(modeLabel[g.mode])}</span>${g.showFull ? '<span class="j-pill j-pill-red">Shown to families as fully booked</span>' : ''}${left <= 0 ? '<span class="j-pill j-pill-red">Fully booked</span>' : `<span class="j-pill j-pill-grey">${left} open</span>`}${g.label !== 'Small group' ? `<span class="j-pill j-pill-grey">${esc(g.label)}</span>` : ''}</div>
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
      ${p.linkNotes || p.notes ? `<dt>Notes</dt><dd><button type="button" class="j-btn j-btn-line j-btn-sm" data-notes-row="${esc(p.rowId)}">Show notes</button></dd>` : ''}
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
    ${p.linkNotes ? `<details class="j-box j-box-amber small" style="margin-bottom:10px"><summary style="cursor:pointer"><b>This family has payment notes in Airtable</b> (tap to read)</summary><p style="margin-top:6px;white-space:pre-wrap">${esc(p.linkNotes)}</p></details>` : ''}
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
      <label class="j-check"><input type="checkbox" id="nt-open" ${nt.open ? 'checked' : ''}> <span><b>Open to every current family</b> in My account (otherwise only the players you invite below).</span></label>
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
      <td><span class="j-pill j-pill-${modePill(g)}">${esc(modeLabel[g.mode])}</span>${g.showFull ? ' <span class="j-pill j-pill-red">Shown full</span>' : ''}</td>
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
    <label class="j-check"><input type="checkbox" id="gm-full" ${v.showFull ? 'checked' : ''}> <span><b>Show as fully booked.</b> Parents only see Join the waitlist. You can still add players here.</span></label>
    <label class="j-check"><input type="checkbox" id="gm-1to1" ${v.allowOneToOne ? 'checked' : ''}> <span><b>Group or 1 to 1.</b> For Book now groups: a family can book the whole hour as a 1 to 1 for the term (term of 1 to 1s price), only while nobody else is booked.</span></label>
    <label class="j-check"><input type="checkbox" id="gm-awf" ${v.applyWhenFull ? 'checked' : ''}> <span><b>Keep taking applications when full.</b> Parents still see Apply instead of the waitlist (for popular groups).</span></label>
    <div class="j-field"><span>Requirements: parents see these when they open the group</span>${REQS.map(([k, l]) => `<label class="j-check" style="padding:4px 0"><input type="checkbox" data-rk="${k}" ${(v.requirements || []).includes(k) ? 'checked' : ''}> <span>${esc(l)}</span></label>`).join('')}</div>
    <label class="j-field"><span>More about who this group is for <span class="muted">(optional, your own words, shown to parents under the ticks)</span></span><textarea class="j-textarea" id="gm-reqtext" rows="5" maxlength="1200" placeholder="For example: This group is for players who are pushing for NPL or academy squads. Expect a fast tempo, lots of 1v1s and high standards. Leave a blank line between paragraphs.">${esc(v.requirementsText || '')}</textarea></label>
    <div class="j-field"><span>An application asks</span>${QS.map(([k, l]) => `<label class="j-check" style="padding:4px 0"><input type="checkbox" data-qk="${k}" ${(v.questions || []).includes(k) ? 'checked' : ''}> <span>${esc(l)}</span></label>`).join('')}</div>
    ${g ? (g.byCoach ? '<p class="muted small" style="margin-bottom:8px">One group per coach at this time: players are in it when their Coach in Airtable is this coach.</p>' : '') : `<label class="j-check"><input type="checkbox" id="gm-bycoach"> <span>One group per coach at this time (like the early morning groups). Players go by their Coach in Airtable.</span></label>`}
    <label class="j-field"><span>Who this group is for, in words parents see <span class="muted">(optional, replaces the standard wording)</span></span><input class="j-input" id="gm-note" value="${esc(v.publicNote || '')}" maxlength="200" placeholder="For example: Players aged 8 to 11 who play club football"></label>
    ${g ? '<p class="muted small">Changing the day, time or location moves every player in this group in Airtable too.</p>' : ''}
    <p class="j-err" id="gm-err" hidden></p>
    <div style="display:flex;gap:8px;justify-content:space-between;margin-top:10px">${g ? '<button type="button" class="j-btn j-btn-danger" id="gm-del">Delete</button>' : '<span></span>'}<span style="display:flex;gap:8px"><button type="button" class="j-btn j-btn-line" data-close>Cancel</button><button type="button" class="j-btn j-btn-dark" id="gm-save">Save</button></span></div>`, { wide: true })
  box.querySelector('#gm-save').addEventListener('click', async () => {
    const val = (id) => box.querySelector(id).value
    const group = { day: val('#gm-day'), time: val('#gm-time').trim(), location: val('#gm-loc').trim(), coachId: val('#gm-coach'), mode: val('#gm-mode'), label: val('#gm-label'), minAge: val('#gm-min'), maxAge: val('#gm-max'), ageStatus: val('#gm-agest'), girlsOnly: val('#gm-girls'), capacity: val('#gm-cap'), durationMin: val('#gm-dur'), publicNote: val('#gm-note'), extraCoachIds: [...box.querySelector('#gm-extra').selectedOptions].map((o) => o.value).filter((c) => c !== val('#gm-coach')), product: val('#gm-prod'), trials: box.querySelector('#gm-trials').checked, showFull: box.querySelector('#gm-full').checked, applyWhenFull: box.querySelector('#gm-awf').checked, allowOneToOne: box.querySelector('#gm-1to1').checked, questions: [...box.querySelectorAll('[data-qk]')].filter((c) => c.checked).map((c) => c.dataset.qk), requirements: [...box.querySelectorAll('[data-rk]')].filter((c) => c.checked).map((c) => c.dataset.rk), requirementsText: val('#gm-reqtext'), ...(g ? {} : { byCoach: Boolean(box.querySelector('#gm-bycoach')?.checked) }) }
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
        ${(r.siblings || []).length ? `<span class="j-pill j-pill-green" style="margin-top:4px">Sibling of ${esc(r.siblings.map((x) => x.name).join(', '))} (paid)</span>` : ''}
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
    <div class="j-field"><span>Suggest other groups <span class="muted">(optional, up to 3)</span></span><div id="dc-list"></div><button type="button" class="j-btn j-btn-line j-btn-sm" id="dc-more" style="margin-top:6px">+ Add another suggestion</button></div>
    <label class="j-field"><span>A line from you <span class="muted">(optional, goes in the email)</span></span><textarea class="j-textarea" id="dc-msg"></textarea></label>
    <label class="j-check"><input type="checkbox" id="dc-send" checked> <span>Email the family. Untick to decline without emailing.</span></label>
    <div class="j-box j-box-grey small" id="dc-preview" style="margin-top:8px"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px"><button type="button" class="j-btn j-btn-line" data-close>Cancel</button><button type="button" class="j-btn j-btn-danger" id="dc-go">Decline</button></div>`)
  const list = box.querySelector('#dc-list')
  const addRow = () => {
    if (list.children.length >= 3) return
    list.insertAdjacentHTML('beforeend', `<select class="j-select" data-dc style="margin-top:6px"><option value="">Choose a group</option>${groupOptions('', { exclude: r.groupId })}</select>`)
    box.querySelector('#dc-more').hidden = list.children.length >= 3
    preview()
  }
  const picked = () => [...new Set([...list.querySelectorAll('[data-dc]')].map((s) => s.value).filter(Boolean))]
  const label = (id) => { const g = P.board?.groups?.find((x) => x.id === id); return g ? `${g.day} ${g.time}, ${g.locationName}` : id }
  // Exactly what the family will read, so nothing goes out unseen.
  const preview = () => {
    const sends = box.querySelector('#dc-send').checked
    const ids = picked()
    const msg = box.querySelector('#dc-msg').value.trim()
    box.querySelector('#dc-preview').innerHTML = sends ? `<b>The email says:</b><br>Thanks for applying, ${esc(r.parentName || '')}. Our coaches have looked at ${esc(r.players.map((p) => p.name).join(' and '))}'s application for ${esc(r.group)}, and it is not the right group this term. We keep every group at one level so each player is challenged, and we would rather say so now.${msg ? `<br>${esc(msg)}` : ''}<br>${ids.length ? `${ids.length === 1 ? 'A group we think would suit' : 'Groups we think would suit'}: ${ids.map((id) => `<b>${esc(label(id))}</b>`).join('; ')}. Apply on the timetable, or reply to this email.` : 'Reply to this email if you would like to talk about another group or 1 to 1 coaching.'}` : '<b>No email.</b> The request is only marked declined.'
  }
  box.querySelector('#dc-more').addEventListener('click', addRow)
  box.addEventListener('change', preview)
  box.querySelector('#dc-msg').addEventListener('input', preview)
  addRow()
  box.querySelector('#dc-go').addEventListener('click', async (e) => {
    e.currentTarget.disabled = true
    const res = await post('decideRequest', { id: r.id, decision: 'decline', suggestGroupIds: picked(), message: box.querySelector('#dc-msg').value.trim(), sendEmail: box.querySelector('#dc-send').checked })
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
      // Sibling rate only when Airtable shows a brother or sister already paid.
      const sib = (r.siblings || []).length > 0 && r.players.length === 1 && (g.product || 'group') === 'group'
      box.querySelector('#of-body').innerHTML = `${sib ? `<div class="j-box j-box-green small" style="margin-bottom:8px"><b>Sibling rate applies.</b> ${esc(r.siblings.map((s) => `${s.name}${s.group ? ` (${s.group})` : ''}`).join(', '))} already paid this term.</div>` : ''}<div id="of-price"></div>`
      read = priceBlock(box, pr, { day: g.day, product: sib ? 'sibling' : (g.product || 'group'), players: r.players.length, prefix: 'of-price', noTrial: true })
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

// ---------- charts: animated, responsive, accessible ----------
// Columns grow from the baseline, bars from the left, tiles rise in. Each
// chart is redrawn at its container's width (no stretching), with a hover
// and keyboard tooltip and a table view underneath.

const cssVar = (name) => getComputedStyle(root()).getPropertyValue(name).trim()
const SERIES = [['stripe', 'Stripe', '--c-series-1'], ['bank', 'Bank transfer', '--c-series-2'], ['cash', 'Cash', '--c-series-3']]
const STATUS = {
  paid: ['Paid', '--c-good'], stripe: ['Paid in Stripe, not recorded', '--c-series-1'], part: ['Part paid', '--c-warning'],
  unpaid: ['Unpaid', '--c-critical'], unpriced: ['Not priced', '--c-neutral'],
}
const compact = (c) => { const d = c / 100; return d >= 10000 ? `A$${(d / 1000).toFixed(d >= 100000 ? 0 : 1)}K` : `A$${Math.round(d).toLocaleString('en-AU')}` }
const niceMax = (v) => { if (v <= 0) return 100000; const p = 10 ** Math.floor(Math.log10(v)); const n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p }

function tip(html, x, y) {
  const t = $('chart-tip')
  t.innerHTML = html
  t.hidden = false
  const w = t.offsetWidth, h = t.offsetHeight
  t.style.left = `${Math.min(window.innerWidth - w - 8, Math.max(8, x - w / 2))}px`
  t.style.top = `${Math.max(8, y - h - 12)}px`
}
const untip = () => { $('chart-tip').hidden = true }
function bindTips(el) {
  el.querySelectorAll('[data-tip]').forEach((b) => {
    const show = (e) => { const r = b.getBoundingClientRect(); tip(b.dataset.tip, e?.clientX ?? r.left + r.width / 2, e?.clientY ?? r.top) }
    b.addEventListener('mousemove', show)
    b.addEventListener('mouseleave', untip)
    b.addEventListener('focus', () => show())
    b.addEventListener('blur', untip)
  })
}

// Stacked weekly columns: income by week, by method.
function weeklyChart(el, weeks, animate) {
  const W = Math.max(280, el.clientWidth), H = 240, L = 54, B = 26, T = 18
  const totals = weeks.map((w) => w.stripe + w.bank + w.cash)
  const max = niceMax(Math.max(...totals, 1))
  const band = (W - L) / Math.max(weeks.length, 1)
  const bw = Math.min(24, band * 0.6)
  const y = (v) => T + (H - T - B) * (1 - v / max)
  const ticks = [0, 0.5, 1].map((f) => f * max)
  const lab = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' })
  const best = totals.indexOf(Math.max(...totals))
  const cols = weeks.map((w, i) => {
    const x = L + band * i + (band - bw) / 2
    let base = H - B
    const segs = SERIES.filter(([k]) => w[k] > 0).map(([k, , c], si, arr) => {
      const h = (H - T - B) * (w[k] / max)
      const top = base - h
      const isTop = si === arr.length - 1
      // 4px rounded data end on the top segment only; 2px surface gap between segments.
      const path = isTop ? `M${x},${base} V${top + 4} Q${x},${top} ${x + 4},${top} H${x + bw - 4} Q${x + bw},${top} ${x + bw},${top + 4} V${base} Z` : `M${x},${base} V${top} H${x + bw} V${base} Z`
      base = top - (isTop ? 0 : 2)
      return `<path class="seg" d="${path}" fill="${cssVar(c)}"/>`
    }).join('')
    const tipHtml = `<b>Week of ${esc(lab(w.week))}</b>${SERIES.map(([k, n, c]) => `<span class="row"><i style="background:${cssVar(c)}"></i>${n} ${esc(money(w[k]))}</span>`).join('')}<span class="row">Total ${esc(money(totals[i]))}</span>`
    return `<g class="band" tabindex="0" data-tip="${esc(tipHtml)}" aria-label="Week of ${esc(lab(w.week))}: ${esc(money(totals[i]))}">
      <rect class="hit" x="${L + band * i}" y="${T}" width="${band}" height="${H - T - B}"/>
      <g class="col" style="--i:${i}">${segs}</g>
      ${i === best && totals[i] > 0 ? `<text class="val fade" style="--i:${i}" x="${x + bw / 2}" y="${y(totals[i]) - 6}" text-anchor="middle">${esc(compact(totals[i]))}</text>` : ''}
      ${weeks.length <= 8 || i % Math.ceil(weeks.length / 8) === 0 ? `<text class="lab" x="${x + bw / 2}" y="${H - 8}" text-anchor="middle">${esc(lab(w.week))}</text>` : ''}
    </g>`
  }).join('')
  el.classList.toggle('anim', Boolean(animate))
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Income by week, Stripe, bank transfer and cash">
    <g class="grid">${ticks.map((t) => `<line x1="${L}" x2="${W}" y1="${y(t)}" y2="${y(t)}"/>`).join('')}</g>
    <g class="axis">${ticks.map((t) => `<text x="${L - 8}" y="${y(t) + 4}" text-anchor="end">${esc(compact(t))}</text>`).join('')}</g>
    ${cols}</svg>`
  bindTips(el)
}

// Horizontal bars: players per location, the paid share inside.
function locationChart(el, locs, animate) {
  const W = Math.max(260, el.clientWidth), row = 46, H = locs.length * row + 4, L = 126, R = 64
  const max = Math.max(...locs.map((l) => l.players), 1)
  el.classList.toggle('anim', Boolean(animate))
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Players by location, and how many have paid">
    ${locs.map((l, i) => {
      const y0 = i * row + 12, bh = 18
      const full = (W - L - R) * (l.players / max)
      const paid = l.players ? full * (l.paid / l.players) : 0
      const t = `<b>${esc(l.name)}</b><span class="row"><i style="background:${cssVar('--c-good')}"></i>Paid ${l.paid}</span><span class="row"><i style="background:${cssVar('--c-neutral')}"></i>Not yet ${l.players - l.paid}</span><span class="row">Owing ${esc(money(l.owingCents))}</span>`
      return `<g class="band" tabindex="0" data-venue="${esc(l.id)}" data-tip="${esc(t)}" aria-label="${esc(l.name)}: ${l.players} players, ${l.paid} paid. Open its revenue">
        <rect class="hit" x="0" y="${y0 - 6}" width="${W}" height="${row - 4}"/>
        <text class="lab" x="0" y="${y0 + 13}">${esc(l.name)}</text>
        <g class="bar" style="--i:${i}">
          <rect x="${L}" y="${y0}" width="${Math.max(0, full)}" height="${bh}" rx="4" fill="${cssVar('--c-neutral')}" opacity=".55"/>
          ${paid > 0 ? `<rect x="${L}" y="${y0}" width="${Math.max(4, paid - (paid < full ? 2 : 0))}" height="${bh}" rx="4" fill="${cssVar('--c-good')}"/>` : ''}
        </g>
        <text class="val fade" style="--i:${i}" x="${L + full + 8}" y="${y0 + 13}">${l.paid}/${l.players}</text>
      </g>`
    }).join('')}</svg>`
  bindTips(el)
}

function statusBlock(st, animate) {
  const total = Object.values(st).reduce((t, n) => t + n, 0) || 1
  const order = ['paid', 'stripe', 'part', 'unpaid', 'unpriced'].filter((k) => st[k])
  return `<div class="jc ${animate ? 'anim' : ''}">
    <div class="jc-stack" role="img" aria-label="Payment status of every player">${order.map((k, i) => `<span style="--i:${i};flex:${st[k]};background:${cssVar(STATUS[k][1])}" title="${esc(STATUS[k][0])}: ${st[k]}"></span>`).join('')}</div>
    <ul class="jc-status">${order.map((k) => `<li><i style="background:${cssVar(STATUS[k][1])}"></i><button type="button" data-money-filter="${k}">${esc(STATUS[k][0])}</button><span class="n">${st[k]}</span><span class="muted small" style="width:42px;text-align:right">${Math.round((st[k] / total) * 100)}%</span></li>`).join('')}</ul>
  </div>`
}

function chartTable(head, rows) {
  return `<details class="jc-table"><summary>Show as a table</summary><table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></details>`
}

// ---------- dashboard ----------

let resizeTimer = 0
async function renderOverview(redraw = false) {
  if (!redraw || !P.money) {
    view().innerHTML = '<p class="muted">Loading the dashboard</p>'
    const [m, rq] = await Promise.all([need(await post('money')), post('requests')])
    P.money = m.money
    if (rq.ok) { P.pendingCount = rq.data.requests.filter((r) => r.status === 'pending').length; P.requests = rq.data.requests; renderNav() }
  }
  const m = P.money, k = m.kpis
  const hour = Number(new Date().toLocaleString('en-AU', { hour: 'numeric', hour12: false, timeZone: 'Australia/Sydney' }))
  const hi = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const paidPlayers = m.status.paid + m.status.stripe
  const pending = (P.requests || []).filter((r) => r.status === 'pending')
  view().innerHTML = `
    <div class="jd-head"><div><h1>${hi}, ${esc(P.user.name.split(' ')[0])}</h1><p>Term 4 at a glance. Stripe is read live${m.stripeAt ? `, last checked ${esc(new Date(m.stripeAt).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' }))}` : ''}.</p></div>
      <div class="jd-sync"><button type="button" class="j-btn j-btn-line j-btn-sm" id="d-refresh">Refresh from Stripe</button></div></div>
    ${m.stripeError ? `<div class="j-box j-box-amber" style="margin-bottom:12px">${esc(m.stripeError)}</div>` : ''}
    <div class="jd-grid">
      <section class="jd-card jd-hero jd-span-5 jd-in" style="--i:0"><div><p class="lbl">Income this term</p><p class="big">${esc(money(k.incomeCents))}</p></div>
        <div class="jd-split">${SERIES.map(([key, n, c]) => `<span><span class="jd-key"><i style="background:${cssVar(c)}"></i>${n}</span><b>${esc(money(key === 'stripe' ? k.stripeCents : key === 'bank' ? k.bankCents : k.cashCents))}</b></span>`).join('')}</div></section>
      <section class="jd-card jd-tiles jd-span-7 jd-in" style="--i:1">
        <div class="jd-tile"><span class="lbl">Still owing</span><span class="val">${esc(money(k.owingCents))}</span><span class="note">${m.status.unpaid + m.status.part} players</span><button type="button" class="link" data-money-filter="unpaid">See who</button></div>
        <div class="jd-tile"><span class="lbl">Players paid</span><span class="val">${paidPlayers}<span class="muted" style="font-size:16px;font-weight:650"> / ${k.players}</span></span><span class="note">${Math.round((paidPlayers / Math.max(k.players, 1)) * 100)}% of the term</span></div>
        <div class="jd-tile"><span class="lbl">Paid in Stripe, not in Airtable</span><span class="val">${m.status.stripe}</span><span class="note">Record them in one click</span><button type="button" class="link" data-money-filter="stripe">Review</button></div>
        <div class="jd-tile"><span class="lbl">Requests waiting</span><span class="val">${pending.length}</span><span class="note">Applications and waitlist</span><button type="button" class="link" data-tab="requests">Open requests</button></div>
      </section>
      <section class="jd-card jd-span-8 jd-in" style="--i:2"><h2>Income by week</h2><p class="sub">Stripe payments (live) and recorded bank transfers and cash</p>
        <div class="jc" id="c-weekly"></div>
        <div class="jc-legend">${SERIES.map(([, n, c]) => `<span><i style="background:${cssVar(c)}"></i>${n}</span>`).join('')}</div>
        ${chartTable(['Week of', 'Stripe', 'Bank transfer', 'Cash'], m.weekly.map((w) => [w.week, money(w.stripe), money(w.bank), money(w.cash)]))}</section>
      <section class="jd-card jd-span-4 jd-in" style="--i:3"><h2>Payment status</h2><p class="sub">Every player holding a place</p>${statusBlock(m.status, !redraw)}</section>
      <section class="jd-card jd-span-7 jd-in" style="--i:4"><h2>Venues</h2><p class="sub">Click a venue to see its revenue. Bars: green is paid, grey is not yet.</p><div class="jc" id="c-locs"></div>
        <div class="jv-list">${m.locations.map((l) => `<button type="button" class="jv-btn" data-venue="${esc(l.id)}"><span class="nm">${esc(l.name)}</span><span class="amt">${esc(money(l.receivedCents))}</span><span class="muted small">this term${l.juniors?.paidCents ? ` · + Juniors ${esc(money(l.juniors.paidCents))}` : ''}</span></button>`).join('')}</div>
        ${chartTable(['Location', 'Players', 'Paid', 'Owing', 'Revenue this term'], m.locations.map((l) => [l.name, l.players, l.paid, money(l.owingCents), money(l.receivedCents)]))}</section>
      <section class="jd-card jd-span-5 jd-in" style="--i:5"><h2>Needs you</h2><ul class="jd-list">
        ${pending.slice(0, 4).map((r) => `<li><button type="button" data-tab="requests">${esc(r.players.map((p) => p.name).join(', '))}</button><span class="muted small">${esc(r.kind === 'application' ? 'Application' : r.kind === 'waitlist' ? 'Waitlist' : 'Enquiry')}</span></li>`).join('')}
        ${m.status.stripe ? `<li><button type="button" data-money-filter="stripe">${m.status.stripe} Stripe payment${m.status.stripe === 1 ? '' : 's'} to record in Airtable</button><span class="muted small">Money</span></li>` : ''}
        ${m.status.unpriced ? `<li><button type="button" data-money-filter="unpriced">${m.status.unpriced} players with no price set</button><span class="muted small">Money</span></li>` : ''}
        ${m.unmatched.length ? `<li><button type="button" data-tab="money">${m.unmatched.length} Stripe payment${m.unmatched.length === 1 ? '' : 's'} not matched to a player</button><span class="muted small">Money</span></li>` : ''}
        ${!pending.length && !m.status.stripe && !m.status.unpriced && !m.unmatched.length ? '<li><span class="muted">Nothing waiting. Nice.</span></li>' : ''}
      </ul></section>
    </div>`
  weeklyChart($('c-weekly'), m.weekly, !redraw)
  locationChart($('c-locs'), m.locations, !redraw)
  $('d-refresh').addEventListener('click', async (e) => {
    e.currentTarget.disabled = true
    const r = await post('money', { fresh: true })
    if (r.ok) { P.money = r.data.money; renderOverview(true); toast('Up to date with Stripe') } else toast(r.data.error)
  })
}
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer)
  resizeTimer = setTimeout(() => {
    if (P.tab === 'overview' && P.money && $('c-weekly')) { weeklyChart($('c-weekly'), P.money.weekly, false); locationChart($('c-locs'), P.money.locations, false) }
  }, 150)
})
document.addEventListener('click', (e) => {
  const f = e.target.closest('[data-money-filter]')
  if (!f) return
  P.moneyFilter = { ...(P.moneyFilter || {}), status: f.dataset.moneyFilter }
  go('money')
})

// ---------- venues: revenue by venue (Lee, 6 Oct 2026) ----------

// This term comes with the dashboard (P.money). Any other term is read once
// and kept for the session: the term before from its payment ledger, older
// terms from the copy of the Money Register.
async function venueModal(id, term = '') {
  const m = P.money
  if (!m) return
  const now = !term || term === m.term
  let past = null
  if (!now) {
    P.venueCache = P.venueCache || {}
    if (!P.venueCache[term]) {
      const r = await post('venues', { term })
      if (!r.ok) return toast(r.data.error)
      P.venueCache[term] = r.data.venues
    }
    past = P.venueCache[term]
  }
  const reg = past?.source === 'register'
  const list = now ? m.locations : past.venues
  const v = list.find((x) => x.id === id)
  const name = v?.name || m.locations.find((x) => x.id === id)?.name || 'Venue'
  const all = [...new Map([...m.locations, ...(past?.venues || [])].map((x) => [x.id, x.name])).entries()]
  const terms = m.venueTerms?.length ? m.venueTerms : [m.term]
  const players = now ? m.players.filter((p) => p.locationId === id) : (past.players || []).filter((p) => p.locationId === id)
  const paidList = now ? players.filter((p) => p.receivedCents) : players
  const split = v ? [['Stripe', v.stripeCents], ['Bank transfer', v.bankCents], ['Cash', v.cashCents], ['Other', v.otherCents]].filter(([, c]) => c).map(([n, c]) => `${n} ${money(c)}`).join(' · ') : ''
  // Where Lee's typed total in the register differs from the payments listed.
  const typed = reg ? (id === 'belrose' ? past.register['belrose hq'] : ['ntra', 'rydalmere'].includes(id) ? past.register.fields : undefined) : undefined
  const listedFields = reg ? past.venues.filter((x) => ['ntra', 'rydalmere'].includes(x.id)).reduce((t, x) => t + x.receivedCents, 0) : 0
  const listed = id === 'belrose' ? v?.receivedCents || 0 : listedFields
  const notes = now ? [
    `Revenue is the money that has come in this term: Stripe payments, read live, plus the cash and bank transfers recorded here. Before Stripe fees.`,
    `All venues add up to Income this term, ${money(m.kpis.incomeCents)}${m.unlinked?.cents ? `, with ${money(m.unlinked.cents)} not linked to a player yet (a payment from an email that is not on any row)` : ''}.`,
    v?.removedCents ? `Includes ${money(v.removedCents)} from players since removed.` : '',
    v?.airtableOnlyCents ? `Airtable also shows ${money(v.airtableOnlyCents)} as paid here with no payment this term (paid last term, or typed in). It is not counted.` : '',
  ] : reg ? [
    `${past.term} from your Money Register (the Google Sheet): the payments listed under each session, before any fees${past.importedAt ? `. Copied ${past.importedAt}` : ''}.`,
    `All venues add up to ${money(past.incomeCents)}. Game analysis is not counted as venue revenue.`,
    typed != null && typed !== listed ? `Your register's typed total for ${id === 'belrose' ? 'HQ' : 'the fields (NTRA and Rydalmere together)'} is ${money(typed)}; the payments listed come to ${money(listed)}.` : '',
  ] : [
    `${past.term} from the payment ledger: every Stripe, bank transfer and cash payment, before Stripe fees.`,
    `All venues add up to ${money(past.incomeCents)}${past.unlinked.cents ? `. ${money(past.unlinked.cents)} (${past.unlinked.count} payment${past.unlinked.count === 1 ? '' : 's'}) belongs to players no longer on the term list, so it is not on a venue` : ''}.`,
  ]
  const box = modal(`<div class="jv-top"><h2>${esc(name)}</h2><button type="button" class="j-close" data-close aria-label="Close">&times;</button></div>
    <div class="jv-switch">
      <div class="jp-seg" role="group" aria-label="Venue">${all.map(([vid, vn]) => `<button type="button" data-venue="${esc(vid)}" data-vterm="${esc(term)}" aria-pressed="${vid === id}">${esc(vn)}</button>`).join('')}</div>
      <label class="jv-term"><span class="muted small">Term</span><select class="j-select" id="jv-term">${terms.map((t) => `<option value="${esc(t === m.term ? '' : t)}" ${(now ? t === m.term : t === term) ? 'selected' : ''}>${esc(t === m.term ? `${t} so far` : t)}</option>`).join('')}</select></label>
    </div>
    ${!v ? '<p class="muted" style="margin-top:16px">No players or payments at this venue for this term.</p>' : `
    <div class="jv-kpis">
      <div class="jd-tile"><span class="lbl">Revenue</span><span class="val">${esc(money(v.receivedCents))}</span><span class="note">${esc(split || 'Nothing in yet')}</span></div>
      <div class="jd-tile"><span class="lbl">${now ? 'Players paid' : reg ? 'Payments' : 'Players who paid'}</span><span class="val">${now ? `${v.paid}<span class="muted" style="font-size:16px;font-weight:650"> / ${v.players}</span>` : v.players}</span>${now ? `<span class="note">Still owing ${esc(money(v.owingCents))}</span>` : ''}</div>
      ${v.juniors ? `<div class="jd-tile"><span class="lbl">Joners Juniors</span><span class="val">${esc(money(v.juniors.paidCents))}</span><span class="note">${v.juniors.paid} of ${v.juniors.players} paid${v.juniors.creditCents ? `, ${esc(money(v.juniors.creditCents))} with last term's credit` : ''}. Not in the JFP total.</span></div>` : ''}
    </div>
    <h3 class="jv-h3">${reg ? 'By session' : 'By group'}</h3>
    <div class="jp-scroll"><table class="jp-table jm-table"><thead><tr><th>${reg ? 'Session' : 'Group'}</th>${reg ? '' : '<th>Coach</th>'}<th class="num">${reg ? 'Payments' : 'Players'}</th><th class="num">Revenue</th>${now ? '<th class="num">Owing</th>' : ''}</tr></thead><tbody>
      ${v.groups.map((g) => `<tr><td>${esc(g.label)}</td>${reg ? '' : `<td>${esc(g.coach)}</td>`}<td class="num">${g.players}</td><td class="num">${esc(money(g.receivedCents))}</td>${now ? `<td class="num">${esc(money(g.owingCents))}</td>` : ''}</tr>`).join('')}
    </tbody></table></div>
    ${reg ? '' : `<details class="jv-players"><summary>Who paid (${paidList.length})</summary>
      <div class="jp-scroll" style="margin-top:8px"><table class="jp-table jm-table"><thead><tr><th>Player</th><th>Group</th><th class="num">Paid</th>${now ? '<th class="num">Owing</th><th>Status</th>' : ''}</tr></thead><tbody>
        ${paidList.map((p) => `<tr><td>${esc(p.player)}</td><td>${esc(now ? (p.group || '').replace(/, [^,]*$/, '') : p.group)}</td><td class="num">${esc(money(p.receivedCents))}</td>${now ? `<td class="num">${esc(money(p.owingCents))}</td><td>${statusPill(p.status)}</td>` : ''}</tr>`).join('') || `<tr><td colspan="5" class="muted">No payments yet.</td></tr>`}
      </tbody></table></div></details>`}`}
    <div class="jv-notes muted small">${notes.filter(Boolean).map((n) => `<p>${esc(n)}</p>`).join('')}</div>`, { wide: true })
  box.querySelector('#jv-term').addEventListener('change', (e) => venueModal(id, e.target.value))
}
document.addEventListener('click', (e) => {
  const v = e.target.closest('[data-venue]')
  if (!v || !P.money) return
  venueModal(v.dataset.venue, v.dataset.vterm || '')
})
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.target.tagName === 'BUTTON') return
  const v = e.target.closest?.('g[data-venue]')
  if (v && P.money) venueModal(v.dataset.venue)
})

// ---------- money: search, filters, history, record a payment ----------

const statusPill = (s) => `<span class="jm-status"><i style="background:${cssVar(STATUS[s][1])}"></i>${esc(STATUS[s][0])}</span>`

async function renderMoney() {
  const r = await need(await post('money'))
  P.money = r.money
  const m = P.money
  P.moneyFilter = { status: '', q: '', loc: '', ...(P.moneyFilter || {}) }
  const f = P.moneyFilter
  const counts = { '': m.players.length, ...m.status }
  view().innerHTML = `
    <div class="jd-head"><div><h1>Money</h1><p>Every player's payments: Stripe read live, plus the bank transfers and cash you record here.</p></div>
      <div class="jd-sync"><label class="muted small" for="m-since">Term payments from</label><input class="j-input" type="date" id="m-since" value="${esc(m.since)}" style="width:auto;padding:7px 10px;font-size:13.5px"><button type="button" class="j-btn j-btn-line j-btn-sm" id="m-refresh">Refresh from Stripe</button></div></div>
    ${m.stripeError ? `<div class="j-box j-box-amber">${esc(m.stripeError)}</div>` : ''}
    <div class="jd-grid">
      <section class="jd-card jd-hero jm-hero jd-in" style="--i:0"><div><p class="lbl">Income this term</p><p class="big">${esc(money(m.kpis.incomeCents))}</p></div>
        <div class="jd-split"><span>Refunded<b>${esc(money(m.kpis.refundsCents))}</b></span><span>Stripe payments<b>${m.kpis.stripePayments}</b></span></div></section>
      ${[['Stripe', m.kpis.stripeCents, '--c-series-1'], ['Bank transfer', m.kpis.bankCents, '--c-series-2'], ['Cash', m.kpis.cashCents, '--c-series-3'], ['Still owing', m.kpis.owingCents, '--c-critical']].map(([l, v, c], i) => `<section class="jd-card jd-tile jm-tile jd-in" style="--i:${i + 1}"><span class="lbl"><span class="jd-key"><i style="background:${cssVar(c)}"></i>${l}</span></span><span class="val">${esc(money(v))}</span></section>`).join('')}
    </div>
    ${m.status.stripe ? `<div class="jm-alert"><span><b>${m.status.stripe} player${m.status.stripe === 1 ? ' has' : 's have'} paid in Stripe</b> but Airtable does not show it yet.</span><span style="display:flex;gap:8px"><button type="button" class="j-btn j-btn-line j-btn-sm" data-set-status="stripe">Show them</button><button type="button" class="j-btn j-btn-dark j-btn-sm" id="m-record-all">Record all in Airtable</button></span></div>` : ''}
    <div class="jm-bar">
      <div class="jm-search"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2" stroke-linecap="round"/></svg><input class="j-input" id="m-q" type="search" placeholder="Search player, parent or email" value="${esc(f.q)}" autocomplete="off"></div>
      <select class="j-select" id="m-loc" style="width:auto"><option value="">All locations</option>${m.locations.map((l) => `<option value="${esc(l.id)}" ${f.loc === l.id ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select>
      <div class="jm-chips" id="m-chips">${[['', 'All'], ['paid', 'Paid'], ['stripe', 'Paid in Stripe'], ['part', 'Part paid'], ['unpaid', 'Unpaid'], ['unpriced', 'Not priced']].map(([v, l]) => `<button type="button" data-set-status="${v}" aria-pressed="${f.status === v}">${v ? `<i style="background:${cssVar(STATUS[v][1])}"></i>` : ''}${l} <span class="n">${counts[v] || 0}</span></button>`).join('')}</div>
    </div>
    <div class="jp-scroll"><table class="jp-table jm-table"><thead><tr><th>Player</th><th>Group</th><th class="num">Fee</th><th class="num">Paid</th><th class="num">Owing</th><th>Status</th><th></th></tr></thead><tbody id="m-rows"></tbody></table></div>
    <p class="muted small" id="m-count" style="margin-top:8px"></p>
    ${m.unmatched.length ? `<details class="jd-card" style="margin-top:18px"><summary style="cursor:pointer;font-weight:700">${m.unmatched.length} Stripe payment${m.unmatched.length === 1 ? '' : 's'} not matched to a player</summary><p class="sub" style="margin:6px 0 10px">Paid with an email that is not on any Term 4 row. Match each one to the player it was for.</p>
      <ul class="jm-hist">${m.unmatched.map((u) => `<li><span><b>${esc(u.name || u.email || 'No name')}</b><small>${esc(u.email)} · ${esc(new Date(u.at).toLocaleDateString('en-AU'))} · ${esc(u.product)}</small></span><span style="display:flex;gap:8px;align-items:center"><span class="amt">${esc(money(u.cents))}</span><button type="button" class="j-btn j-btn-line j-btn-sm" data-match="${esc(u.id)}">Match</button></span></li>`).join('')}</ul></details>` : ''}`
  const draw = () => {
    const q = f.q.trim().toLowerCase()
    const list = m.players.filter((p) => (!f.status || p.status === f.status) && (!f.loc || p.locationId === f.loc) && (!q || `${p.player} ${p.parent} ${p.email}`.toLowerCase().includes(q)))
    $('m-rows').innerHTML = list.map((p) => `<tr data-row="${esc(p.rowId)}"><td><b>${esc(p.player)}</b><br><span class="muted small">${esc(p.parent || '')}</span></td><td class="small">${esc(p.group)}</td><td class="num">${p.feeCents ? esc(money(p.feeCents)) : '<span class="muted">not set</span>'}</td><td class="num">${esc(money(p.paidCents))}${p.status === 'stripe' ? `<br><span class="muted small">Stripe ${esc(money(p.stripeCents))}</span>` : ''}</td><td class="num">${p.owingCents ? `<b>${esc(money(p.owingCents))}</b>` : '<span class="muted">0</span>'}</td><td>${statusPill(p.status)}</td>
      <td><div class="jm-actions">${p.hasNotes ? `<button type="button" class="jm-icon" data-notes="${esc(p.rowId)}" title="Notes" aria-label="Notes for ${esc(p.player)}"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 4h9l4 4v12H6z"/><path d="M9 11h7M9 15h5"/></svg></button>` : ''}<button type="button" class="j-btn j-btn-line j-btn-sm" data-record="${esc(p.rowId)}">Record payment</button></div></td></tr>`).join('') || '<tr><td colspan="7"><div class="j-empty">No players match.</div></td></tr>'
    $('m-count').textContent = `${list.length} of ${m.players.length} players · owing ${money(list.reduce((t, p) => t + p.owingCents, 0))}`
  }
  draw()
  $('m-q').addEventListener('input', (e) => { f.q = e.target.value; draw() })
  $('m-loc').addEventListener('change', (e) => { f.loc = e.target.value; draw() })
  view().querySelectorAll('[data-set-status]').forEach((b) => b.addEventListener('click', () => { f.status = b.dataset.setStatus; view().querySelectorAll('#m-chips [data-set-status]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.setStatus === f.status))); draw() }))
  $('m-rows').addEventListener('click', (e) => {
    const n = e.target.closest('[data-notes]'); if (n) { e.stopPropagation(); return notesModal(n.dataset.notes) }
    const rec = e.target.closest('[data-record]'); if (rec) { e.stopPropagation(); return recordModal(m.players.find((p) => p.rowId === rec.dataset.record)) }
    const tr = e.target.closest('[data-row]'); if (tr) historyDrawer(tr.dataset.row)
  })
  $('m-refresh').addEventListener('click', async (e) => {
    e.currentTarget.disabled = true
    const since = $('m-since').value
    if (since && since !== m.since) await post('saveSettings', { config: { moneySince: since } })
    const r2 = await post('money', { fresh: true, since })
    if (!r2.ok) return toast(r2.data.error)
    toast('Up to date with Stripe'); renderMoney()
  })
  $('m-record-all')?.addEventListener('click', async (e) => {
    const todo = m.players.filter((p) => p.status === 'stripe')
    if (!(await confirmBox(`Record the Stripe payments for <b>${todo.length}</b> player${todo.length === 1 ? '' : 's'} in Airtable (Term 4 Players and the payment ledger)?`, { ok: 'Record' }))) return
    e.currentTarget.disabled = true
    const r2 = await post('recordStripeAll')
    if (!r2.ok) return toast(r2.data.error)
    toast(`Recorded ${r2.data.recorded} Stripe payment${r2.data.recorded === 1 ? '' : 's'}`); renderMoney()
  })
  view().querySelectorAll('[data-match]').forEach((b) => b.addEventListener('click', () => matchModal(m.unmatched.find((u) => u.id === b.dataset.match))))
}

async function notesModal(rowId) {
  const r = await post('playerPayments', { rowId })
  if (!r.ok) return toast(r.data.error)
  const p = r.data.player
  modal(`<h2 style="margin-bottom:4px">Notes</h2><p class="muted small" style="margin-bottom:12px">${esc(p.player)}</p>
    ${p.linkNotes ? `<h3 class="small muted" style="margin:0 0 6px">Payment notes</h3><div class="jm-notes" style="margin-bottom:12px">${esc(p.linkNotes)}</div>` : ''}
    ${p.notes ? `<h3 class="small muted" style="margin:0 0 6px">Term 4 notes</h3><div class="jm-notes">${esc(p.notes)}</div>` : '<p class="muted">No notes.</p>'}
    <div style="display:flex;justify-content:flex-end;margin-top:14px"><button type="button" class="j-btn j-btn-line" data-close>Close</button></div>`, { wide: true })
}

function recordModal(p, { stripe } = {}) {
  const owing = p.owingCents || Math.max(0, p.feeCents - p.paidCents) || p.feeCents
  const box = modal(`<h2 style="margin-bottom:4px">${stripe ? 'Record a Stripe payment' : 'Record a payment'}</h2><p class="muted small" style="margin-bottom:14px">${esc(p.player)} · paid ${esc(money(p.paidCents))} of ${p.feeCents ? esc(money(p.feeCents)) : 'no fee set'}</p>
    ${stripe ? `<div class="j-box j-box-blue small" style="margin-bottom:12px">Stripe, ${esc(new Date(stripe.at).toLocaleDateString('en-AU'))}: ${esc(money(stripe.cents - (stripe.refundedCents || 0)))} · ${esc(stripe.product)}</div>` : `
    <div class="j-two"><label class="j-field"><span>Amount (A$)</span><input class="j-input" id="rp-amt" inputmode="decimal" value="${owing ? (owing / 100).toFixed(2).replace(/\.00$/, '') : ''}"></label>
    <label class="j-field"><span>How they paid</span><select class="j-select" id="rp-how"><option>Bank transfer</option><option>Cash</option><option>Other</option></select></label></div>
    <div class="j-two"><label class="j-field"><span>Date received</span><input class="j-input" type="date" id="rp-date" value="${new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' })}"></label>
    <label class="j-field"><span>Note <span class="muted">(optional)</span></span><input class="j-input" id="rp-note" maxlength="200" placeholder="For example, paid at the session"></label></div>`}
    <p class="muted small">Updates Term 4 Players and adds a row to the payment ledger.</p>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px"><button type="button" class="j-btn j-btn-line" data-close>Cancel</button><button type="button" class="j-btn j-btn-dark" id="rp-go">Save</button></div>`)
  box.querySelector('#rp-go').addEventListener('click', async (e) => {
    const body = stripe ? { rowIds: [p.rowId], method: 'Stripe', stripeSessionId: stripe.id } : { rowIds: [p.rowId], amountCents: Math.round(Number(box.querySelector('#rp-amt').value) * 100), method: box.querySelector('#rp-how').value, date: box.querySelector('#rp-date').value, note: box.querySelector('#rp-note').value.trim() }
    if (!stripe && !(body.amountCents > 0)) return toast('Enter the amount received.')
    // Hold the button: e.currentTarget is null once the handler has awaited.
    const btn = e.currentTarget
    btn.disabled = true
    const r = await post('recordPayment', body)
    btn.disabled = false
    if (!r.ok) return toast(r.data.error)
    closeModal(); closeDrawer(); toast(`Recorded. Airtable updated${r.data.ledger ? ' and the ledger has it' : ''}.`); P.board = null; if (P.tab === 'money') renderMoney()
  })
}

function matchModal(u) {
  const box = modal(`<h2 style="margin-bottom:4px">Match a Stripe payment</h2><p class="muted small" style="margin-bottom:12px">${esc(u.name || u.email)} · ${esc(money(u.cents))} · ${esc(new Date(u.at).toLocaleDateString('en-AU'))}</p>
    <label class="j-field"><span>Who was it for?</span><input class="j-input" id="mt-q" placeholder="Type a player or parent name" autocomplete="off"></label>
    <div id="mt-res"></div>`, { wide: true })
  const res = box.querySelector('#mt-res')
  box.querySelector('#mt-q').addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase()
    const hits = q.length < 2 ? [] : P.money.players.filter((p) => `${p.player} ${p.parent}`.toLowerCase().includes(q)).slice(0, 8)
    res.innerHTML = hits.map((p) => `<button type="button" class="j-player" data-pick="${esc(p.rowId)}"><span><b>${esc(p.player)}</b><br><span class="muted small">${esc(p.parent || '')} · ${esc(p.group)}</span></span>${statusPill(p.status)}</button>`).join('')
  })
  res.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-pick]'); if (!b) return
    const p = P.money.players.find((x) => x.rowId === b.dataset.pick)
    if (!(await confirmBox(`Record ${esc(money(u.cents))} from Stripe against <b>${esc(p.player)}</b>?`, { ok: 'Record' }))) return
    const r = await post('recordPayment', { rowIds: [p.rowId], method: 'Stripe', stripeSessionId: u.id })
    if (!r.ok) return toast(r.data.error)
    closeModal(); toast('Recorded. Airtable updated.'); renderMoney()
  })
}

function closeDrawer() { document.querySelector('.jm-drawer')?.remove(); document.querySelector('.jm-drawer-scrim')?.remove() }
async function historyDrawer(rowId) {
  closeDrawer()
  const scrim = document.createElement('div'); scrim.className = 'jp-scrim jm-drawer-scrim'; scrim.style.inset = '0'; scrim.style.zIndex = '65'; scrim.style.position = 'fixed'
  const d = document.createElement('aside'); d.className = 'jm-drawer'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true'); d.setAttribute('aria-label', 'Payment history')
  d.innerHTML = '<div class="body"><p class="muted">Loading</p></div>'
  root().append(scrim, d)
  scrim.addEventListener('click', closeDrawer)
  const r = await post('playerPayments', { rowId })
  if (!r.ok) { d.querySelector('.body').innerHTML = `<div class="j-box j-box-red">${esc(r.data.error)}</div>`; return }
  const p = r.data.player
  const row = P.money?.players.find((x) => x.rowId === rowId) || { rowId, player: p.player, feeCents: p.feeCents, paidCents: p.paidCents, owingCents: Math.max(0, p.feeCents - p.paidCents), status: 'unpaid' }
  const when = (iso) => (iso ? new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '')
  d.innerHTML = `<header><div><h2 style="font-size:19px">${esc(p.player)}</h2><p class="muted small">${esc(p.parent || '')}${p.email ? ` · ${esc(p.email)}` : ''}</p></div><button type="button" class="j-close" id="dr-x" aria-label="Close">&times;</button></header>
    <div class="body">
      <div class="jm-figs"><div><span>Fee</span><b>${p.feeCents ? esc(money(p.feeCents)) : 'Not set'}</b></div><div><span>Paid</span><b>${esc(money(p.paidCents))}</b></div><div><span>Status</span><b style="font-size:14px">${statusPill(row.status)}</b></div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px"><button type="button" class="j-btn j-btn-dark j-btn-sm" id="dr-rec">Record a payment</button><button type="button" class="j-btn j-btn-line j-btn-sm" id="dr-link">Send payment link</button>${p.notes || p.linkNotes ? '<button type="button" class="j-btn j-btn-line j-btn-sm" id="dr-notes">Notes</button>' : ''}</div>
      <h3>Stripe (live)</h3>
      ${p.stripe.length ? `<ul class="jm-hist">${p.stripe.map((s) => `<li><span>${esc(when(s.at))}<small>${esc(s.product)}${s.refundedCents ? ` · refunded ${esc(money(s.refundedCents))}` : ''}</small></span><span style="display:flex;gap:8px;align-items:center"><span class="amt">${esc(money(s.cents))}</span>${s.recorded ? '<span class="j-pill j-pill-green">In Airtable</span>' : `<button type="button" class="j-btn j-btn-line j-btn-sm" data-rec-stripe="${esc(s.id)}">Record</button>`}</span></li>`).join('')}</ul>` : '<p class="muted small">No Stripe payments from this email this term.</p>'}
      <h3>Ledger</h3>
      ${p.ledger.length ? `<ul class="jm-hist">${p.ledger.map((l) => `<li><span>${esc(l.date)}<small>${esc(l.method)}${l.status && l.status !== 'Paid' ? ` · ${esc(l.status)}` : ''}</small></span><span class="amt">${esc(money(l.cents))}</span></li>`).join('')}</ul>` : '<p class="muted small">Nothing in the payment ledger yet.</p>'}
      <h3>Payment links</h3>
      ${p.links.length ? `<ul class="jm-hist">${p.links.map((q) => `<li><span>${esc(when(q.createdAt))}<small>${esc({ open: 'Open', checkout: 'At checkout', paid: `Paid ${when(q.paidAt)}`, cancelled: 'Cancelled', expired: 'Expired' }[q.status] || q.status)}</small></span><span class="amt">${esc(money(q.cents))}</span></li>`).join('')}</ul>` : '<p class="muted small">No payment links.</p>'}
      <h3>Changes</h3>
      ${p.history.length ? `<ul class="jm-hist">${p.history.map((h) => `<li><span>${esc(h.action.replace(/\./g, ' '))}<small>${esc(h.by)}</small></span><span class="muted small">${esc(when(h.at))}</span></li>`).join('')}</ul>` : '<p class="muted small">No changes recorded.</p>'}
    </div>`
  d.querySelector('#dr-x').addEventListener('click', closeDrawer)
  d.querySelector('#dr-x').focus()
  d.querySelector('#dr-rec').addEventListener('click', () => recordModal(row))
  d.querySelector('#dr-notes')?.addEventListener('click', () => notesModal(rowId))
  d.querySelector('#dr-link').addEventListener('click', async () => {
    if (!P.board) P.board = await need(await post('board'))
    const f = findPlayer(rowId)
    if (f) { closeDrawer(); linkModal(f.p, f.g) } else toast('Open the Timetable to send this one.')
  })
  d.querySelectorAll('[data-rec-stripe]').forEach((b) => b.addEventListener('click', () => recordModal(row, { stripe: p.stripe.find((s) => s.id === b.dataset.recStripe) })))
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && document.querySelector('.jm-drawer') && !document.querySelector('.jp-modal')) closeDrawer() })
document.addEventListener('click', (e) => { const b = e.target.closest('[data-notes-row]'); if (b) { e.preventDefault(); notesModal(b.dataset.notesRow) } })

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
        ${s.covering ? `<div class="j-box j-box-blue small" style="margin-bottom:8px"><b>Covering for ${esc(s.covering.for)}</b> on ${esc(s.covering.dateLabel)}</div>` : ''}
        ${(s.coveredBy || []).length ? `<div class="j-box j-box-grey small" style="margin-bottom:8px">${s.coveredBy.map((c) => `${esc(c.dateLabel)}: covered by <b>${esc(c.coach)}</b>`).join('<br>')}</div>` : ''}
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

// ---------- current families: invite to their account ----------

async function renderFamilies() {
  const d = await need(await post('familyInvites'))
  const kind = { pay: ['amber', 'To pay'], paid: ['green', 'Paid'], noPrice: ['red', 'Needs a price first'] }
  const ready = d.list.filter((f) => f.kind !== 'noPrice')
  view().innerHTML = `<div class="jp-head"><div><h1>Players</h1><p class="muted small">Every Term 4 player, grouped under their parent's email. Send the parent their account: players already paid for see their sessions, anyone who owes gets a link to pay what Airtable shows as owing. Nothing is sent until you press Send. Replies go to Ligia.</p></div></div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">
      <span class="j-pill j-pill-grey">${d.list.length} families</span>
      <span class="j-pill j-pill-amber">${d.list.filter((f) => f.kind === 'pay').length} to pay</span>
      <span class="j-pill j-pill-green">${d.list.filter((f) => f.kind === 'paid').length} paid</span>
      <span class="j-pill j-pill-red">${d.list.filter((f) => f.kind === 'noPrice').length} need a price</span>
      <span class="j-pill j-pill-grey">${d.list.filter((f) => f.invitedAt).length} already invited</span>
      ${d.noEmail.length ? `<span class="j-pill j-pill-red">${d.noEmail.length} players with no email</span>` : ''}
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
      <button type="button" class="j-btn j-btn-line" id="fm-prev">Show the emails</button>
      <button type="button" class="j-btn j-btn-dark" id="fm-send">Send to selected</button>
    </div>
    <div id="fm-preview" hidden></div>
    <div class="jp-scroll"><table class="jp-table"><thead><tr><th><input type="checkbox" id="fm-all" aria-label="Select all"></th><th>Parent</th><th>Players</th><th>Status</th><th>Invited</th></tr></thead><tbody>
    ${d.list.map((f) => `<tr><td><input type="checkbox" data-fm="${esc(f.email)}" ${f.kind === 'noPrice' ? 'disabled' : ''}></td><td><b>${esc(f.parent || '')}</b><br><span class="muted small">${esc(f.email)}</span></td><td class="small">${f.players.map((x) => `${esc(x.name)} <span class="muted">${esc(x.group)}</span>`).join('<br>')}</td><td><span class="j-pill j-pill-${kind[f.kind][0]}">${esc(kind[f.kind][1])}${f.kind === 'pay' ? ` ${esc(money(f.owingCents))}` : ''}</span>${f.needsWaiver ? '<br><span class="muted small">Waiver needed</span>' : ''}</td><td class="small">${f.invitedAt ? esc(new Date(f.invitedAt).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })) : ''}</td></tr>`).join('')}
    </tbody></table></div>
    ${d.list.some((f) => f.kind === 'noPrice') ? '<p class="muted small" style="margin-top:8px">"Needs a price first": unpaid with no Term 4 Fee in Airtable. Send them a payment link from the Timetable (tap the player), or set the fee in Airtable, then come back.</p>' : ''}
    ${d.noEmail.length ? `<p class="muted small">No parent email in Airtable: ${esc(d.noEmail.map((x) => x.name).join(', '))}.</p>` : ''}`
  const boxes = () => [...view().querySelectorAll('[data-fm]')]
  $('fm-all').addEventListener('change', (e) => boxes().forEach((b) => { if (!b.disabled) b.checked = e.target.checked && !d.list.find((f) => f.email === b.dataset.fm)?.invitedAt }))
  $('fm-prev').addEventListener('click', () => {
    const el = $('fm-preview')
    el.hidden = !el.hidden
    el.innerHTML = ['pay', 'paid'].filter((k) => d.previews[k]).map((k) => `<div class="j-card" style="padding:12px;margin-bottom:12px"><p class="small"><b>${k === 'pay' ? 'Owes money' : 'Already paid'}</b> · Subject: ${esc(d.previews[k].subject)}</p><iframe title="Email preview" style="width:100%;height:560px;border:1px solid #eee;border-radius:10px;margin-top:8px" srcdoc="${esc(d.previews[k].html)}"></iframe></div>`).join('')
  })
  $('fm-send').addEventListener('click', async (e) => {
    const emails = boxes().filter((b) => b.checked).map((b) => b.dataset.fm)
    if (!emails.length) return toast('Tick the families to email.')
    const again = emails.filter((x) => d.list.find((f) => f.email === x)?.invitedAt).length
    if (!(await confirmBox(`Email <b>${emails.length}</b> parent${emails.length === 1 ? '' : 's'} now?${again ? ` ${again} already had it and will get it again.` : ''} Anyone who owes gets a payment link.`, { ok: 'Send' }))) return
    const btn = e.currentTarget
    btn.disabled = true
    let sent = 0, failed = 0
    for (let i = 0; i < emails.length; i += 20) {
      btn.textContent = `Sending ${Math.min(i + 20, emails.length)} of ${emails.length}`
      const r = await post('familyInvites', { send: true, emails: emails.slice(i, i + 20), resend: again > 0 })
      if (!r.ok) { toast(r.data.error || 'Sending stopped. Nothing is lost: try again.'); break }
      sent += r.data.sent.length; failed += r.data.failed.length
    }
    toast(`Sent ${sent}${failed ? `, ${failed} failed (try again)` : ''}`)
    renderFamilies()
  })
}

// ---------- cover, time off, session plans ----------

async function renderStaff() {
  const admin = P.user.role === 'admin'
  const d = await need(await post('staffOverview'))
  const pill = { active: ['green', 'Covered'], cancelled: ['grey', 'Cancelled'], pending: ['amber', 'Waiting for approval'], approved: ['green', 'Approved'], declined: ['red', 'Declined'] }
  const sessOpts = d.mySessions.map((s) => `<option value="${esc(s.id)}">${esc(s.label)}</option>`).join('')
  view().innerHTML = `<div class="jp-head"><div><h1>Cover and time off</h1><p class="muted small">${admin ? 'Every cover and time off request. Covers apply straight away; time off waits for you or Ligia.' : 'Need someone to take a session? Choose the date and the coach, and they get it in their My sessions straight away. Time off goes to Lee and Ligia to approve.'}</p></div></div>
    <div class="jp-two" style="display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(300px,1fr))">
      <div class="j-card" style="padding:16px"><h2 style="margin-bottom:10px">Request cover</h2>
        ${d.mySessions.length ? `<label class="j-field"><span>Session</span><select class="j-select" id="cv-g">${sessOpts}</select></label>
        <label class="j-field"><span>Date</span><select class="j-select" id="cv-d"></select></label>
        <label class="j-field"><span>Covering coach</span><select class="j-select" id="cv-c"></select></label>
        <label class="j-field"><span>Note <span class="muted">(optional)</span></span><input class="j-input" id="cv-n" maxlength="300"></label>
        <button type="button" class="j-btn j-btn-dark" id="cv-go">Put them on this session</button>` : '<p class="muted small">You have no sessions yet.</p>'}
      </div>
      <div class="j-card" style="padding:16px"><h2 style="margin-bottom:10px">Request time off</h2>
        ${admin ? `<label class="j-field"><span>Coach</span><select class="j-select" id="to-c">${d.coaches.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select></label>` : ''}
        <div class="j-two"><label class="j-field"><span>First day off</span><input class="j-input" type="date" id="to-f"></label><label class="j-field"><span>Last day off</span><input class="j-input" type="date" id="to-t"></label></div>
        <label class="j-field"><span>Reason <span class="muted">(optional)</span></span><input class="j-input" id="to-r" maxlength="300"></label>
        <button type="button" class="j-btn j-btn-dark" id="to-go">Send for approval</button>
        <p class="muted small" style="margin-top:8px">Time off does not move your sessions. Arrange cover for each one on the left.</p>
      </div>
    </div>
    <h2 style="margin:22px 0 10px">Time off</h2>
    ${d.timeOff.length ? d.timeOff.map((t) => `<div class="jp-player" style="cursor:default;align-items:center"><span><b>${esc(t.coach)}</b> · ${esc(t.from)}${t.to !== t.from ? ` to ${esc(t.to)}` : ''}${t.reason ? ` · <span class="muted">${esc(t.reason)}</span>` : ''}</span><span style="display:flex;gap:6px;align-items:center"><span class="j-pill j-pill-${pill[t.status]?.[0] || 'grey'}">${esc(pill[t.status]?.[1] || t.status)}</span>${admin && t.status === 'pending' ? `<button type="button" class="j-btn j-btn-dark j-btn-sm" data-to="${esc(t.id)}" data-st="approved">Approve</button><button type="button" class="j-btn j-btn-line j-btn-sm" data-to="${esc(t.id)}" data-st="declined">Decline</button>` : ''}</span></div>`).join('') : '<p class="muted small">No time off requests.</p>'}
    <h2 style="margin:22px 0 10px">Covers</h2>
    ${d.covers.length ? d.covers.map((c) => `<div class="jp-player" style="cursor:default;align-items:center"><span><b>${esc(c.group)}</b> · ${esc(c.dateLabel)}<br><span class="muted small">${esc(c.coach)} covered by <b>${esc(c.cover)}</b>${c.note ? ` · ${esc(c.note)}` : ''}</span></span><span style="display:flex;gap:6px;align-items:center"><span class="j-pill j-pill-${pill[c.status]?.[0] || 'grey'}">${esc(pill[c.status]?.[1] || c.status)}</span>${c.status === 'active' && (admin || c.coachId === P.user.coachId) ? `<button type="button" class="j-btn j-btn-line j-btn-sm" data-cv-x="${esc(c.id)}">Cancel</button>` : ''}</span></div>`).join('') : '<p class="muted small">No covers.</p>'}`
  const drawDates = () => {
    const s = d.mySessions.find((x) => x.id === $('cv-g').value)
    $('cv-d').innerHTML = (s?.dates || []).map((x) => `<option value="${esc(x.iso)}">${esc(x.label)}</option>`).join('') || '<option value="">No dates left this term</option>'
    $('cv-c').innerHTML = d.coaches.filter((c) => c.id !== (admin ? s?.coachId : P.user.coachId)).map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')
  }
  if ($('cv-g')) { drawDates(); $('cv-g').addEventListener('change', drawDates) }
  $('cv-go')?.addEventListener('click', async (e) => {
    e.currentTarget.disabled = true
    const r = await post('requestCover', { groupId: $('cv-g').value, date: $('cv-d').value, coverCoachId: $('cv-c').value, note: $('cv-n').value.trim() })
    toast(r.ok ? `${r.data.cover.cover} is on ${r.data.cover.group}, ${r.data.cover.dateLabel}` : r.data.error)
    renderStaff()
  })
  $('to-go').addEventListener('click', async (e) => {
    e.currentTarget.disabled = true
    const r = await post('requestTimeOff', { coachId: $('to-c')?.value, from: $('to-f').value, to: $('to-t').value || $('to-f').value, reason: $('to-r').value.trim() })
    toast(r.ok ? (admin ? 'Time off added. Approve it below.' : 'Sent to Lee and Ligia for approval.') : r.data.error)
    renderStaff()
  })
  view().querySelectorAll('[data-to]').forEach((b) => b.addEventListener('click', async () => { const r = await post('decideTimeOff', { id: b.dataset.to, status: b.dataset.st }); toast(r.ok ? 'Updated' : r.data.error); renderStaff() }))
  view().querySelectorAll('[data-cv-x]').forEach((b) => b.addEventListener('click', async () => { if (!(await confirmBox('Cancel this cover? The session goes back to its coach.'))) return; const r = await post('cancelCover', { id: b.dataset.cvX }); toast(r.ok ? 'Cover cancelled' : r.data.error); renderStaff() }))
}

// The On The Go planner: coaches build a session on an A4 pitch page and save
// it here. Opens in a new tab; Save in the planner lands in this list.
async function plannerBlock(admin) {
  const r = await post('planList')
  const list = r.ok ? r.data.plans : []
  const when = (iso) => new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
  return `<section class="jd-card" style="margin-bottom:16px"><div style="display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap">
      <div><h2>${admin ? 'Coach sessions' : 'My sessions'}</h2><p class="sub">Build a session on the On The Go planner: drag players, cones and arrows onto the pitch, add the coaching points, then press Save in the planner.</p></div>
      <a class="j-btn j-btn-dark" href="/jfp-planner/blank.html?new=1" target="_blank" rel="noopener">+ Create a session</a></div>
    ${list.length ? `<ul class="jm-hist" style="margin-top:12px">${list.map((x) => `<li><span><b>${esc(x.title)}</b><small>${admin ? `${esc(x.ownerName || x.owner)} · ` : ''}saved ${esc(when(x.savedAt))}</small></span><span style="display:flex;gap:6px"><a class="j-btn j-btn-line j-btn-sm" href="/jfp-planner/blank.html?plan=${encodeURIComponent(x.id)}" target="_blank" rel="noopener">Open</a><button type="button" class="j-btn j-btn-ghost j-btn-sm" data-plan-del="${esc(x.id)}">Delete</button></span></li>`).join('')}</ul>` : '<p class="muted small" style="margin-top:12px">No saved sessions yet. Create one and it appears here.</p>'}
  </section>`
}
function bindPlanner() {
  view().querySelectorAll('[data-plan-del]').forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmBox('Delete this session? It cannot be brought back.', { ok: 'Delete', danger: true }))) return
    const r = await post('planDelete', { id: b.dataset.planDel })
    toast(r.ok ? 'Deleted' : r.data.error); renderPlans()
  }))
}

async function renderPlans() {
  const admin = P.user.role === 'admin'
  const [d, planner] = await Promise.all([post('staffOverview').then(need), plannerBlock(admin)])
  const pl = d.plans
  if (!admin) {
    const filled = pl.weeks.filter((w) => w.title || w.focus || w.link)
    view().innerHTML = `<div class="jp-head"><div><h1>Session plans</h1><p class="muted small">Your saved sessions, how the program runs and what each week covers.</p></div></div>
      ${planner}
      ${pl.structure ? `<div class="j-card" style="padding:16px;margin-bottom:14px"><h2 style="margin-bottom:8px">Program structure</h2>${pl.structure.split(/\n\s*\n/).map((x) => `<p style="margin-bottom:8px">${esc(x).replace(/\n/g, '<br>')}</p>`).join('')}</div>` : ''}
      ${filled.length ? filled.map((w) => `<div class="j-card" style="padding:14px 16px;margin-bottom:10px"><b>Week ${w.week}${w.title ? `: ${esc(w.title)}` : ''}</b>${w.focus ? `<p class="small" style="margin-top:4px;white-space:pre-wrap">${esc(w.focus)}</p>` : ''}${w.link ? `<p style="margin-top:6px"><a class="j-btn j-btn-line j-btn-sm" href="${esc(w.link)}" target="_blank" rel="noopener noreferrer">Open the session plan</a></p>` : ''}</div>`).join('') : ''}`
    bindPlanner()
    return
  }
  view().innerHTML = `<div class="jp-head"><div><h1>Session plans</h1><p class="muted small">Every coach's saved sessions, and what coaches see in their Session plans tab: the program structure and each week.</p></div></div>
    ${planner}
    <div class="j-card" style="padding:16px;max-width:900px">
      <label class="j-field"><span>Program structure</span><textarea class="j-textarea" id="pl-s" rows="8" placeholder="How a JFP session runs, the standards, the term's themes. Leave a blank line between paragraphs.">${esc(pl.structure)}</textarea></label>
      ${pl.weeks.map((w, i) => `<div class="j-card" style="padding:12px;margin-bottom:8px" data-wk="${i}"><b>Week ${w.week}</b>
        <div class="j-two" style="margin-top:6px"><label class="j-field"><span>Title</span><input class="j-input" data-f="title" value="${esc(w.title)}" placeholder="For example: 1v1 attacking"></label><label class="j-field"><span>Link to the plan</span><input class="j-input" data-f="link" value="${esc(w.link)}" placeholder="https://"></label></div>
        <label class="j-field"><span>Focus and key points</span><textarea class="j-textarea" data-f="focus" rows="2">${esc(w.focus)}</textarea></label></div>`).join('')}
      <button type="button" class="j-btn j-btn-dark j-btn-lg" id="pl-save">Save session plans</button>
    </div>`
  $('pl-save').addEventListener('click', async () => {
    const weeks = [...view().querySelectorAll('[data-wk]')].map((box) => Object.fromEntries([...box.querySelectorAll('[data-f]')].map((i) => [i.dataset.f, i.value.trim()])))
    const r = await post('savePlans', { plans: { structure: $('pl-s').value, weeks } })
    toast(r.ok ? 'Saved. Coaches see it now.' : r.data.error)
  })
  bindPlanner()
}

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
        ${p.notes ? `<dt>Notes</dt><dd><details><summary style="cursor:pointer;font-weight:600">Show notes</summary><p style="font-weight:400;white-space:pre-wrap;margin-top:6px">${esc(p.notes)}</p></details></dd>` : ''}
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
      <h2 style="margin:16px 0 12px">Booking page</h2>
      <label class="j-check"><input type="checkbox" id="s-pw" ${c.passwordRequired ? 'checked' : ''}> <span><b>Ask for the booking password.</b> Off: anyone with the link sees the timetable (it is still hidden from Google). The password itself is set in Vercel (JFP_BOOKING_PASSWORD).</span></label>
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
      <label class="j-check"><input type="checkbox" id="s-wcarry" ${c.waiverCarryover !== false ? 'checked' : ''}> <span><b>Accept waivers signed in an earlier term.</b> Off: every family signs again for ${esc(c.term)}. Either way a waiver only counts when it carries the family's own email or mobile.</span></label>
      <label class="j-field"><span>Backup waiver form link</span><input class="j-input" id="s-waiver" value="${esc(c.waiverUrl)}"></label>
      <p class="muted small">Parents sign the waiver on the booking page. This link is the backup.</p>
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
      passwordRequired: $('s-pw').checked, waiverCarryover: $('s-wcarry').checked,
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
