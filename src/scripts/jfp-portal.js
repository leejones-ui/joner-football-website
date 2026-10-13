// The JFP staff portal. Lee and Ligia see the whole program and the money;
// coaches see the program timetable (names and ages) and their own registers.
// Every change goes to Airtable through /api/jfp-portal-data, which checks
// the role again on the server.
import { $, esc, api, toast, signIn, whoAmI, signOut, money } from './jfp-common.js'
import { renderMessages } from './jfp-portal-messages.js'
import { juniorsCardShell, fillJuniorsCard, juniorsData } from './jfp-portal-juniors.js'
import { programmeSwitch, bindSwitch, moneyHead, bindTip, prefetchOthers, forget, markUpdated } from './jfp-portal-programmes.js'
import { renderProMoney, proData } from './jfp-portal-pro.js'
import { renderCampsMoney, campsData } from './jfp-portal-camps.js'
import { renderEverything } from './jfp-portal-everything.js'
import { drawFamilies, sessionModal } from './jfp-portal-family.js'
import { bankPanel, bindBank, loadBank, bankDone, bankStale } from './jfp-portal-bank.js'
import { renderHolidayMoney, holidayStale, holidayData } from './jfp-portal-holiday.js'
import { showingPicker, bindShowing, renderPastTerm, renderMoneyYear, redrawYearChart } from './jfp-portal-years.js'
import { renderPricesPage, quickModal, progPill, WHERE as QUICK_WHERE } from './jfp-portal-quick.js'
import { playerFormHtml, wirePlayerForm, filledValues, customOptions, customPrices, noGroupPaymentHtml, wireNoGroupPayment, PROFILE_LISTS } from './jfp-portal-player-form.js'
import { contactWords } from '../../api/_jfp-contact.js'
import { textComposer, payLinkText, trialText, helloText, inviteText } from './jfp-portal-text.js'
import { JJ_NAV, JJ_TABS, JJ_ICON, renderJJ } from './jfp-portal-jj.js'

// jf: the Money programme switch, the Joners Juniors filters and the holiday picked.
const P = { jf: { programme: 'jfp', term: '', status: '', q: '', period: '' }, user: null, tab: '', board: null, loc: '', day: '', coachFilter: '', ttView: 'staff', sel: '', groups: null, coachId: '', coachDate: {}, reqFilter: 'pending', linkFilter: 'open', linkProg: 'all', pricing: null }
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
  coach: [['Coaching', [['program', 'Program'], ['coach', 'My sessions'], ['cancellations', 'Cancellations'], ['staff', 'Cover and time off'], ['plans', 'Session plans'], ['profile', 'My profile']]]],
  admin: [
    ['Overview', [['overview', 'Dashboard']]],
    ['Program', [['board', 'Timetable'], ['families', 'Players'], ['messages', 'Messages'], ['requests', 'Requests'], ['groups', 'Groups and rules'], ['next', 'Next term'], ['holiday', 'Holiday training']]],
    // Joners Juniors (Lee, 13 Oct 2026): its own section, the same pages as JFP.
    JJ_NAV,
    ['Money', [['money', 'Money'], ['payments', 'Payment links'], ['prices', 'Prices']]],
    ['Coaches', [['coach', 'Registers'], ['cancellations', 'Cancellations'], ['staff', 'Cover and time off'], ['plans', 'Session plans'], ['coaches', 'Coaches']]],
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
  cancellations: '<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4M10 13.2l4 4M14 13.2l-4 4"/>',
  staff: '<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4M9 15l2 2 4-4"/>',
  plans: '<rect x="4" y="3.5" width="16" height="17" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M4 12h16"/>',
  coaches: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c.8-3.6 3.6-5.6 7-5.6s6.2 2 7 5.6"/>',
  profile: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c.8-3.6 3.6-5.6 7-5.6s6.2 2 7 5.6"/>',
  removed: '<path d="M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13"/>',
  audit: '<path d="M12 7v5l3 2"/><circle cx="12" cy="12" r="8.5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/>',
  invites: '<path d="M21 3 10.5 13.5M21 3l-6.5 18-4-7.5L3 9.5z"/>',
}
// Joners Juniors pages borrow their JFP twin's icon.
const icon = (k) => `<span class="ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICON[JJ_ICON[k] || k] || ICON.overview}</svg></span>`
function tabs() { return NAV[P.user.role === 'admin' ? 'admin' : 'coach'].flatMap(([, list]) => list) }

function start() {
  $('app').hidden = false
  $('sign-out').hidden = false
  $('who-name').textContent = P.user.name.replace(/^Coach\s+/, '')
  $('who-small').textContent = P.user.role === 'admin' ? 'Super admin' : 'Coach'
  $('me-ini').textContent = P.user.name.replace(/^Coach\s+/, '').split(/\s+/).map((w) => w[0] || '').join('').slice(0, 2).toUpperCase()
  // A Money link can carry the programme and term: #money?programme=juniors&term=Term%204%202026
  // or one venue: #money?loc=ntra
  // or an earlier JFP term or a whole year: #money?term=Term%203%202026, #money?year=2025
  const [hash, query] = location.hash.slice(1).split('?')
  const qp = new URLSearchParams(query || '')
  // Joners Juniors money has its own page now (#jj-money?term=...); old links still land there.
  if ((hash === 'money' && qp.get('programme') === 'juniors') || hash === 'jj-money') Object.assign(P.jf, { programme: 'jfp', term: (qp.get('term') || '').slice(0, 30) })
  if (hash === 'money' && qp.get('programme') === 'juniors') return go('jj-money')
  // or holiday training, one school holiday: #money?programme=holiday&period=2026-spring
  if (hash === 'money' && qp.get('programme') === 'holiday') Object.assign(P.jf, { programme: 'holiday', period: (qp.get('period') || '').slice(0, 20) })
  // Pro sessions (one month or every month), camps (a year) and everything (a year), 13 Oct 2026.
  if (hash === 'money' && qp.get('programme') === 'pro') Object.assign(P.jf, { programme: 'pro', month: /^\d{4}-\d{2}$/.test(qp.get('month') || '') ? qp.get('month') : '' })
  if (hash === 'money' && ['camps', 'all'].includes(qp.get('programme'))) Object.assign(P.jf, { programme: qp.get('programme'), year: /^\d{4}$/.test(qp.get('year') || '') ? Number(qp.get('year')) : 0 })
  if (hash === 'money' && qp.get('loc')) P.moneyFilter = { ...(P.moneyFilter || {}), loc: qp.get('loc') }
  if (hash === 'money' && !['juniors', 'holiday', 'pro', 'camps', 'all'].includes(qp.get('programme')) && (qp.get('year') || qp.get('term'))) P.moneyFilter = { ...(P.moneyFilter || {}), year: /^\d{4}$/.test(qp.get('year') || '') ? qp.get('year') : '', term: qp.get('year') ? '' : (qp.get('term') || '').slice(0, 30) }
  go(tabs().some(([k]) => k === hash) ? hash : tabs()[0][0])
}

function renderNav() {
  const sections = NAV[P.user.role === 'admin' ? 'admin' : 'coach']
  // Each heading opens and closes its group; the group holding the open tab stays open.
  const open = navOpen()
  $('nav').innerHTML = sections.map(([title, list]) => {
    const here = list.some(([k]) => k === P.tab)
    const shut = sections.length > 1 && !here && open[title] !== true
    return `<div class="jp-navgrp${shut ? ' shut' : ''}"><button type="button" class="jp-nav-sec" data-navsec="${esc(title)}" aria-expanded="${shut ? 'false' : 'true'}"><span>${esc(title)}</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10l5 5 5-5"/></svg></button><div class="jp-navlist">${list.map(([k, label]) => `<button type="button" data-tab="${k}" data-label="${esc(label)}" aria-current="${P.tab === k ? 'page' : 'false'}">${icon(k)}<span class="jp-lbl">${esc(label)}</span>${k === 'requests' && P.pendingCount ? `<span class="count">${P.pendingCount}</span>` : ''}${k === 'cancellations' && P.cxNew?.count ? `<span class="count" title="New since you last looked">${P.cxNew.count}</span>` : ''}</button>`).join('')}</div></div>`
  }).join('')
}

function navOpen() {
  try { return JSON.parse(localStorage.getItem('jfp-nav-open') || '{}') || {} } catch { return {} }
}

function toggleNavGroup(title) {
  const open = navOpen()
  const grp = [...document.querySelectorAll('.jp-navgrp')].find((g) => g.querySelector('[data-navsec]')?.dataset.navsec === title)
  const nowShut = !grp?.classList.contains('shut')
  open[title] = !nowShut
  try { localStorage.setItem('jfp-nav-open', JSON.stringify(open)) } catch {}
  grp?.classList.toggle('shut', nowShut)
  grp?.querySelector('[data-navsec]')?.setAttribute('aria-expanded', nowShut ? 'false' : 'true')
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

// instant: a Money programme switch. The view paints its last reading at
// once, so there is no "Loading" flash in between.
async function go(tab, { quiet = false, instant = false } = {}) {
  P.tab = tab
  P.nav = !quiet
  if (!quiet) history.replaceState(null, '', `#${tab}`)
  renderNav()
  if (!quiet && !instant) view().innerHTML = '<p class="muted">Loading</p>'
  closeSide()
  setDrawer(false)
  const fn = JJ_TABS.has(tab) ? () => renderJJ(tab, jjUi()) : { overview: renderOverview, next: renderNext, holiday: renderHoliday, board: renderBoard, program: renderProgram, groups: renderGroups, requests: renderRequests, payments: renderPayments, prices: renderPrices, money: renderMoney, coach: renderCoach, cancellations: renderCancellations, coaches: renderCoaches, profile: renderProfile, staff: renderStaff, plans: renderPlans, families: renderPlayers, messages: () => renderMessages({ view, need, modal, closeModal, confirmBox }), removed: renderRemoved, audit: renderAudit, settings: renderSettings }[tab]
  try { await fn() } catch (e) { console.error(e); if (!quiet) view().innerHTML = `<div class="j-box j-box-red">Something went wrong loading this page. ${esc(e.message || '')}</div>` }
  if (P.user?.role === 'admin' && (tab === 'money' || tab === 'jj-money')) prefetchOthers(tab === 'jj-money' ? 'juniors' : P.jf.programme, moneyReaders())
  if (!P.cxChecked) { P.cxChecked = true; checkCancelAlerts() } else cancelBanner()
  if (!quiet) view().focus({ preventScroll: true })
}
// New cancellations show up within two minutes, whatever page is open.
setInterval(() => { if (P.user && document.visibilityState === 'visible') checkCancelAlerts() }, 120000)

// Auto sync (Lee, 12 Oct 2026): the page on screen re-reads Airtable and
// Stripe by itself every 2 minutes, and as soon as you come back to the
// browser tab. It waits while you are typing, have a window or menu open, or
// are part way through something, and keeps your place on the page.
const AUTO = { tabs: new Set(['overview', 'board', 'families', 'money', 'requests', 'payments', 'program', 'jj-dashboard', 'jj-players', 'jj-money']), lastInput: 0, hiddenAt: 0, busy: false }
document.addEventListener('input', () => { AUTO.lastInput = Date.now() }, true)
async function autoSync() {
  if (AUTO.busy || !P.user || !AUTO.tabs.has(P.tab) || document.visibilityState !== 'visible') return
  if ($('jp-modal') || $('jp-side') || $('jp-menu') || document.querySelector('.jp-confirm-over, .j-sheet, .jf-changed, .jm-drawer')) return
  const a = document.activeElement
  if (a && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName)) return
  if (Date.now() - AUTO.lastInput < 60000) return
  AUTO.busy = true
  const y = window.scrollY
  try { P.board = null; PL.at = 0; await go(P.tab, { quiet: true }); window.scrollTo(0, y) } finally { AUTO.busy = false }
}
setInterval(autoSync, 120000)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') AUTO.hiddenAt = Date.now()
  else if (AUTO.hiddenAt && Date.now() - AUTO.hiddenAt > 60000) autoSync()
})

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
  m.innerHTML = items.map((it) => (it === '-' ? '<hr>' : `<button type="button" data-i="${esc(it.key)}" ${it.danger ? 'style="color:var(--j-red)"' : ''}>${esc(it.label)}</button>`)).join('')
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

// Four payment colours everywhere in the portal (Lee, 12 Oct 2026):
// red unpaid, green paid, orange part paid, pink session by session.
const SESSION_RE = /session by session|drop-in|1 on 1 casual/i
function payKind(p) {
  if (SESSION_RE.test(p.type || p.paymentType || '')) return 'session'
  const s = p.paymentStatus
  if (s === 'Paid') return 'paid'
  if (s === 'Partially Paid') return 'part'
  return 'unpaid'
}
const PAY_KIND = { paid: ['green', 'Paid'], part: ['orange', 'Part paid'], unpaid: ['red', 'Unpaid'], session: ['pink', 'Session by session'] }
const payPill = (p) => {
  if (p.trial) return '<span class="j-pill j-pill-blue">Trial</span>'
  if (p.paymentStatus === 'N/A') return '<span class="j-pill j-pill-grey">N/A</span>'
  const [c, l] = PAY_KIND[payKind(p)]
  return `<span class="j-pill j-pill-${c}">${l}</span>`
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
  // Half term: a set number of sessions from the start date.
  if (prod.sessions) {
    const n = Math.min(prod.sessions, day ? dates.length || prod.sessions : prod.sessions)
    const unitFull = Math.round(pr.prices[prod.key] / prod.perPlaces)
    const unit = n < prod.sessions ? Math.round((unitFull * n) / prod.sessions / 100) * 100 : unitFull
    return { unit, total: unit * players, sessions: n, of: prod.sessions, proRata: n < prod.sessions, fixed: true, last: dates[n - 1]?.label || '' }
  }
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
// custom: Lee's own prices (Money > Prices) are in "Paying for" too.
function priceBlock(box, pr, { day, product, players = 1, credit = false, paid = 0, prefix = 'pb', noTrial = false, custom = false }) {
  const from = nextDate(pr, day)
  const own = custom ? customOptions(pr) : ''
  box.querySelector(`#${prefix}`).innerHTML = `
    <div class="j-two"><label class="j-field"><span>Paying for</span><select class="j-select" id="${prefix}-prod">${own ? `<optgroup label="JFP price list">${productOptions(pr, product, { noTrial })}</optgroup>${own}` : productOptions(pr, product, { noTrial })}</select></label>
    <label class="j-field"><span>Starts</span><select class="j-select" id="${prefix}-from">${dateOptions(pr, day, from)}</select></label></div>
    ${credit && paid > 0 ? `<label class="j-check"><input type="checkbox" id="${prefix}-credit" checked> <span>Take the ${esc(money(Math.min(paid, pr.prices.trial)))} trial off</span></label>` : ''}
    <div class="j-two"><label class="j-field"><span>Amount (A$)</span><input class="j-input" id="${prefix}-amt" inputmode="decimal"></label><div class="j-field"><span>&nbsp;</span><p class="muted small" id="${prefix}-why" style="padding-top:10px"></p></div></div>
    <label class="j-check"><input type="checkbox" id="${prefix}-afterpay" checked> <span>Afterpay allowed</span></label>`
  const $$ = (id) => box.querySelector(`#${prefix}-${id}`)
  let typed = false
  const calc = () => {
    const pick = $$('prod').value.startsWith('price:') ? customPrices(pr).find((x) => `price:${x.id}` === $$('prod').value) : null
    $$('from').closest('label').hidden = Boolean(pick)
    if (pick) {
      if (!typed) $$('amt').value = (pick.cents / 100).toFixed(2).replace(/\.00$/, '')
      $$('why').textContent = `${pick.name}${pick.perSession ? ', one session' : ''}${pick.programmeLabel ? `, ${pick.programmeLabel}` : ''}`
      return
    }
    const q = priceOf(pr, { product: $$('prod').value, day, from: $$('from').value, players })
    const off = credit ? ($$('credit')?.checked ? Math.min(paid, pr.prices.trial, q.total) : 0) : Math.min(paid, q.total)
    if (!typed) $$('amt').value = ((q.total - off) / 100).toFixed(2).replace(/\.00$/, '')
    $$('why').textContent = `${q.fixed ? `Half term, ${q.sessions} sessions${q.last ? `, to ${q.last}` : ''}` : q.proRata ? `Pro rata, ${q.sessions} of ${q.of} sessions` : $$('prod').value === 'trial' || $$('prod').value === 'oneToOne' ? 'One session' : `Full term, ${q.sessions} sessions`}${players > 1 ? `, ${players} players` : ''}${off ? `, less ${money(off)} ${credit ? 'trial' : 'already paid'}` : ''}`
  }
  $$('amt').addEventListener('input', () => { typed = true })
  for (const id of ['prod', 'from', 'credit']) $$(id)?.addEventListener('change', () => { typed = false; calc() })
  calc()
  return () => {
    const v = $$('prod').value
    const base = { startDate: $$('from').value, amountCents: Math.round(Number($$('amt').value) * 100), creditTrial: Boolean(credit && $$('credit')?.checked), afterpay: $$('afterpay').checked }
    return v.startsWith('price:') ? { ...base, priceId: v.slice(6) } : { ...base, product: v }
  }
}

// ---------- timetable (the board) ----------

const PERIODS = [['am', 'Morning'], ['pm', 'Afternoon']]
const locColor = (id) => `var(--j-loc-${id || 'belrose'})`

async function renderBoard(refresh) {
  if (!P.board || refresh !== false) P.board = await need(await post('board', refresh === 'hard' ? { fresh: true } : {}))
  const B = P.board
  P.coaches = B.coaches
  const groups = B.groups.filter((g) => (!P.loc || g.locationId === P.loc) && (!P.coachFilter || g.coachId === P.coachFilter) && (!P.day || g.day === P.day) && (P.ttView === 'staff' || g.mode !== 'closed' || isJJ(g)))
  const t = B.totals
  view().innerHTML = `
    <div class="jp-head"><div><h1>${esc(B.term)}</h1><p class="muted small">${t.dashboard} confirmed · ${t.players} holding a place · ${t.awaiting} not confirmed yet · ${t.pendingRequests} request${t.pendingRequests === 1 ? '' : 's'} waiting · waivers ${t.waivers}/${t.players} · updated ${esc(timeAgo(B.at))} <button type="button" class="j-btn j-btn-ghost j-btn-sm" id="b-refresh">Refresh</button></p></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><button type="button" class="j-btn j-btn-dark" id="b-add">+ Add player</button><div class="jp-seg" id="b-view">${[['staff', 'Staff view'], ['coach', 'Coach view'], ['parent', 'Parent view']].map(([v, l]) => `<button type="button" data-view="${v}" aria-pressed="${P.ttView === v}">${l}</button>`).join('')}</div></div></div>
    ${t.pendingRequests ? `<div class="j-box j-box-amber" style="margin-bottom:12px;display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap"><span><b>${t.pendingRequests} new request${t.pendingRequests === 1 ? '' : 's'}</b> waiting for an answer: accept, trial or decline.</span><button type="button" class="j-btn j-btn-dark j-btn-sm" data-tab="requests">Review</button></div>` : ''}
    <div class="j-daybar" id="b-days" style="margin-bottom:10px">${[['', 'Whole week'], ...DAYS.filter((d) => B.groups.some((g) => g.day === d)).map((d) => [d, d])].map(([v, l]) => `<button type="button" data-bday="${esc(v)}" aria-selected="${(P.day || '') === v}">${esc(l)}</button>`).join('')}</div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:12px">
      <div class="jp-seg" id="b-loc">${[['', 'All locations'], ...B.locations.map((l) => [l.id, l.name])].map(([v, l]) => `<button type="button" data-loc="${esc(v)}" aria-pressed="${P.loc === v}">${esc(l)}</button>`).join('')}</div>
      <select class="j-select" id="b-coach" style="width:auto"><option value="">Any coach</option>${B.coaches.map((c) => `<option value="${esc(c.id)}" ${P.coachFilter === c.id ? 'selected' : ''}>Coach ${esc(c.name)}</option>`).join('')}</select>
      ${P.ttView === 'staff' ? '<div class="jp-legend" style="margin-left:auto"><span><i class="i-due"></i>Unpaid</span><span><i class="i-paid"></i>Paid</span><span><i class="i-part"></i>Part paid</span><span><i class="i-session"></i>Session by session</span><span><i class="i-trial"></i>Trial</span><span><b style="color:#B42318;font-size:10px">W</b> no waiver</span></div>' : ''}
    </div>
    ${P.ttView === 'staff' ? '<p class="muted small" style="margin-bottom:8px">Tap a group for its rules, Add player or Copy spot link. Tap a name for payment and more. Drag a name onto another group to move them.</p>' : P.ttView === 'coach' ? '<p class="muted small" style="margin-bottom:8px">What a coach sees: every group, names and ages. No money, no contact details.</p>' : '<p class="muted small" style="margin-bottom:8px">What parents see: places left, never names.</p>'}
    <div class="jp-tt-wrap">${ttGrid(groups)}</div>
    ${B.unassigned.length && P.ttView === 'staff' ? `<div class="jp-day"><h2>Not in a group</h2></div><div class="jp-group">${B.unassigned.map((p) => playerRowHtml(p, '')).join('')}<p class="muted small" style="margin-top:8px">These rows have no session, or a session with no group (for the split morning groups, a coach with no group at that time). Move them onto a group.</p></div>` : ''}`
  $('b-refresh').addEventListener('click', () => renderBoard('hard'))
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
  return { paid: 'i-paid', part: 'i-part', unpaid: 'i-due', session: 'i-session' }[payKind(p)]
}

const isJJ = (g) => g?.label === 'Joners Juniors'
// Joners Juniors payment colours, the same four as JFP: green paid, orange
// part paid, red unpaid; grey for no fee (N/A) or refunded.
const JJ_PAY = {
  paid: ['i-paid', 'green', 'Paid'], stripe: ['i-paid', 'green', 'Paid in Stripe'], credit: ['i-paid', 'green', 'Paid with credit'],
  unverified: ['i-paid', 'green', 'Paid (amount not recorded)'], part: ['i-part', 'orange', 'Part paid'], unpaid: ['i-due', 'red', 'Unpaid'],
  nofee: ['i-due', 'red', 'Unpaid, no fee set'], na: ['i-off', 'grey', 'No fee (N/A)'], refunded: ['i-off', 'grey', 'Refunded'],
}
const jjPayTip = (pay) => `${JJ_PAY[pay.status]?.[2] || pay.status}${pay.feeCents ? `, fee ${money(pay.feeCents)}` : ''}${pay.paidCents ? `, paid ${money(pay.paidCents)}` : ''}${pay.owingCents ? `, owes ${money(pay.owingCents)}` : ''}`
// Notes for coaches and a later start week, shown wherever a coach sees the
// player (Lee, 12 Oct 2026).
const todayIso = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' })
const notYet = (p, date = todayIso()) => Boolean(p.startsFrom && date < p.startsFrom)
function noteChip(p) {
  if (!p.note && !notYet(p)) return ''
  const wk = (p.startsLabel.match(/week (\d+)/) || [])[1]
  const tip = [notYet(p) ? p.startsLabel : '', p.note].filter(Boolean).join('. ')
  return `<span class="jp-ntag" title="${esc(tip)}">${notYet(p) ? (wk ? `Wk ${wk}` : 'Later') : 'Note'}</span>`
}
function noteLine(p, date) {
  const bits = [notYet(p, date) ? `<b>${esc(p.startsLabel)}: not started yet</b>` : '', p.note ? esc(p.note) : ''].filter(Boolean)
  return bits.length ? `<span class="jp-cnote">${bits.join(' · ')}</span>` : ''
}
async function coachNoteModal(p, g) {
  const pr = await pricing()
  const dates = (pr.datesByDay[g?.day] || [])
  const box = modal(`<h2 style="margin-bottom:4px">Note for coaches</h2><p class="muted small" style="margin-bottom:12px">${esc(p.name)}${g ? ` · ${esc(g.day)} ${esc(g.time)}` : ''}. Coaches see this on their register, the timetable and the program. Families never see it.</p>
    <label class="j-field"><span>Note <span class="muted">(optional, up to 300 characters)</span></span><textarea class="j-input" id="cn-text" rows="3" maxlength="300" placeholder="e.g. Recovering from an ankle injury, no heading">${esc(p.note || '')}</textarea></label>
    <label class="j-field"><span>Starts</span><select class="j-select" id="cn-start"><option value="">From the start of term</option>${dates.map((d, i) => `<option value="${esc(d.iso)}" ${d.iso === p.startsFrom ? 'selected' : ''}>Week ${i + 1} · ${esc(d.label)}</option>`).join('')}</select></label>
    <p class="muted small">A later start also shows the family only their sessions from that week.</p>
    <p class="j-err" id="cn-err" hidden></p>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px"><button type="button" class="j-btn j-btn-line" data-close>Cancel</button><button type="button" class="j-btn j-btn-dark" id="cn-go">Save</button></div>`, { wide: true })
  box.querySelector('#cn-go').addEventListener('click', async (e) => {
    e.currentTarget.disabled = true
    const r = await post('setCoachNote', { rowId: p.rowId, text: box.querySelector('#cn-text').value, startDate: box.querySelector('#cn-start').value })
    if (!r.ok) { e.currentTarget.disabled = false; const er = box.querySelector('#cn-err'); er.textContent = r.data.error; er.hidden = false; return }
    closeModal(); toast('Saved. Coaches will see it.'); renderBoard(true)
  })
}

function ttBlock(g) {
  const n = g.players.length
  const left = g.capacity - n
  const tag = g.mode === 'direct' ? 'Book now' : g.mode === 'application' ? 'Apply' : g.mode === 'enquire' ? 'Enquire' : 'Hidden'
  const head = `<div class="jp-blk-head" data-open="${esc(g.id)}"><b>${esc(g.time)}</b>${g.pendingRequests && P.ttView === 'staff' ? ` <span class="j-pill j-pill-violet" style="font-size:10px;padding:0 6px">${g.pendingRequests} new</span>` : ''}<span class="n">${P.ttView === 'parent' ? '' : `${n}/${g.capacity}`}</span></div>
    <div class="sub" data-open="${esc(g.id)}">${esc(g.coachName || 'No coach')} · ${esc(tag)}${g.label !== 'Small group' ? ` · ${esc(g.label)}` : ''}${g.minAge != null ? ` · ${g.girlsOnly === 'yes' ? 'girls ' : ''}${g.minAge} to ${g.maxAge}` : ''}</div>`
  let body
  if (isJJ(g)) {
    // Joners Juniors: children from the Juniors table, signed up on the Juniors page.
    body = P.ttView === 'parent' ? '<div class="jp-open" style="font-weight:700">Joners Juniors · sign up on the Juniors page</div>'
      : g.players.map((p) => `<div class="jp-nm">${P.ttView === 'staff' && p.pay ? `<i class="${JJ_PAY[p.pay.status]?.[0] || 'i-off'}" title="${esc(jjPayTip(p.pay))}"></i>` : ''}<span class="nmx">${esc(p.name)}${p.age != null ? ` <span class="muted">${esc(p.age)}</span>` : ''}</span></div>`).join('') + `<div class="jp-open">${g.juniorsError ? esc(g.juniorsError) : `${n} from the Joners Juniors table`}</div>`
    return `<section class="jp-blk ${P.sel === g.id && P.ttView === 'staff' ? 'sel' : ''}" style="--lc:${locColor(g.locationId)}">${head}${body}</section>`
  }
  if (P.ttView === 'parent') {
    body = left <= 0 ? '<div class="jp-open" style="color:var(--j-red);font-weight:700">Fully booked · waitlist</div>' : `<div class="jp-open" style="color:${g.mode === 'direct' ? 'var(--j-green)' : 'var(--j-blue)'};font-weight:700">${tag} · ${left} ${left === 1 ? 'spot' : 'spots'} left</div>`
  } else {
    body = g.players.map((p) => `<div class="jp-nm" ${P.ttView === 'staff' ? `draggable="true" data-row="${esc(p.rowId)}" data-from="${esc(g.id)}" tabindex="0" role="button" aria-label="${esc(p.name)}, options"` : ''}>${P.ttView === 'staff' ? `<i class="${dotFor(p)}"></i>` : ''}<span class="nmx">${esc(p.name)}${p.age != null ? ` <span class="muted">${esc(p.age)}</span>` : ''}</span>${noteChip(p)}${P.ttView === 'staff' && p.status !== 'Confirmed' ? '<span class="muted" style="font-size:10px">awaiting</span>' : ''}${P.ttView === 'staff' && !p.waiver ? '<span class="w">W</span>' : ''}</div>`).join('')
    body += left > 0 ? `<div class="jp-open">+ ${left} open</div>` : left < 0 ? `<div class="jp-open" style="color:var(--j-red)">${-left} over capacity</div>` : '<div class="jp-open" style="color:var(--j-red)">Full</div>'
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
    ${isJJ(g) ? '<p class="j-box j-box-grey small" style="margin-top:12px">Joners Juniors: the children come from the Joners Juniors table in Airtable for this term. Add or change them there. Families sign up on the Juniors page, not here.</p>' : ''}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:14px">
      ${isJJ(g) ? '' : `<button type="button" class="j-btn j-btn-dark j-btn-sm" id="sd-add">Add player</button>
      <button type="button" class="j-btn j-btn-line j-btn-sm" id="sd-link">Copy spot link</button>`}
      <button type="button" class="j-btn j-btn-line j-btn-sm" id="sd-edit">Edit rules</button>
      <button type="button" class="j-btn j-btn-line j-btn-sm" id="sd-reg">Register</button>
    </div>
    ${g.pendingRequests ? `<button type="button" class="j-btn j-btn-soft j-btn-block j-btn-sm" id="sd-req" style="margin-top:8px">${g.pendingRequests} request${g.pendingRequests === 1 ? '' : 's'} for this group</button>` : ''}
    <h3 style="margin:16px 0 6px">Players</h3>
    ${g.players.map((p) => playerRowHtml(p, g.id)).join('') || '<p class="muted small">No players yet.</p>'}`
  document.querySelector('.jfp').appendChild(el)
  el.querySelector('#sd-x').addEventListener('click', () => { P.sel = ''; closeSide(); document.querySelectorAll('.jp-blk.sel').forEach((x) => x.classList.remove('sel')) })
  el.querySelector('#sd-add')?.addEventListener('click', () => addPlayerModal(g))
  el.querySelector('#sd-link')?.addEventListener('click', () => addPlayerModal(g, { spotLink: true }))
  el.querySelector('#sd-edit').addEventListener('click', async () => { if (!P.groups) P.groups = await need(await post('groups')); groupModal(P.groups.groups.find((x) => x.id === g.id) || g) })
  el.querySelector('#sd-reg').addEventListener('click', () => { P.coachId = g.coachId; go('coach') })
  el.querySelector('#sd-req')?.addEventListener('click', () => go('requests'))
  wireRows(el)
}

function playerRowHtml(p, gid) {
  // Joners Juniors children live in the Juniors table: shown, never moved or charged here.
  if (p.juniors) return `<div class="jp-player jp-player-jj"><span class="nm">${esc(p.name)}${p.age != null ? ` <span class="muted">(${esc(p.age)})</span>` : ''}</span><span class="tags">${p.pay ? `<span class="j-pill j-pill-${JJ_PAY[p.pay.status]?.[1] || 'grey'}" title="${esc(jjPayTip(p.pay))}">${esc(JJ_PAY[p.pay.status]?.[2] || p.pay.status)}</span>` : ''}<span class="j-pill j-pill-grey" title="From the Joners Juniors table">Juniors</span></span></div>`
  const tags = [
    p.status !== 'Confirmed' ? `<span class="j-pill j-pill-amber">${esc(p.status)}</span>` : '',
    payPill(p),
    p.payreq ? `<span class="j-pill j-pill-blue" title="Payment link open">Link ${esc(p.payreq.amountLabel)}</span>` : '',
    p.waiver ? '' : '<span class="j-pill j-pill-grey" title="No waiver on file">No waiver</span>',
    p.kit ? `<span class="j-pill j-pill-green" title="JF playing kit: ${esc(p.kit)}">Kit</span>` : '',
    notYet(p) ? `<span class="j-pill j-pill-violet">${esc(p.startsLabel)}</span>` : '',
    p.note ? `<span class="j-pill j-pill-grey" title="${esc(p.note)}">Coach note</span>` : '',
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
    { key: 'info', label: 'Details', run: () => openPlayerDetails(p.rowId, () => detailsModal(p, g)) },
    { key: 'move', label: 'Move to another group', run: () => moveModal(p, g) },
    { key: 'note', label: p.note || p.startsFrom ? 'Edit note for coaches' : 'Note for coaches (or a later start)', run: () => coachNoteModal(p, g) },
    '-',
    ...(p.trial ? [{ key: 'term', label: 'Offer full term (after trial)', run: () => termModal(p, g) }] : []),
    ...(p.paymentStatus !== 'Paid' || p.trial ? [{ key: 'link', label: p.payreq ? `Payment link open (${p.payreq.amountLabel})` : 'Send a payment link', run: () => linkModal(p, g) }, { key: 'paid', label: 'Mark paid offline', run: () => paidModal(p) }] : []),
    { key: 'trial', label: p.trial ? 'End trial without a link' : 'Mark as trial', run: async () => { const r = await post('setTrial', { rowId: p.rowId, trial: !p.trial }); if (!r.ok) return toast(r.data.error); toast('Updated'); renderBoard(true) } },
    '-',
    { key: 'remove', label: 'Remove from group', danger: true, run: () => removeModal(p, g) },
  ])
}

// The same player window as the Players tab: full name, age today, date of
// birth, club, session, money, family, waiver.
async function openPlayerDetails(rowId, fallback) {
  let list = PL.data?.players
  if (!list || Date.now() - PL.at > 30000) {
    const r = await post('playersList')
    if (!r.ok) return fallback()
    PL.data = r.data; PL.at = Date.now(); list = r.data.players
  }
  const p = list.find((x) => x.rowId === rowId)
  return p ? plDetail(p) : fallback()
}

// Which waiver was signed online: the adult one or the parent or guardian one.
const waiverKindLabel = (k) => (k === 'adult' ? ' (adult waiver, signed by the player)' : k === 'guardian' ? ' (parent or guardian waiver)' : '')
function detailsModal(p, g) {
  modal(`<h2 style="margin-bottom:12px">${esc(p.name)}</h2>
    <dl class="j-kv">
      <dt>Group</dt><dd>${g ? `${esc(g.day)} ${esc(g.time)}, ${esc(g.locationName)}, Coach ${esc(g.coachName)}` : esc(p.session || 'None')}</dd>
      <dt>Age</dt><dd>${p.age != null ? esc(p.age) : 'Not on file'}</dd>
      <dt>Status</dt><dd>${esc(p.status)}</dd>
      <dt>Type</dt><dd>${esc(p.type || 'Not set')}</dd>
      <dt>Payment</dt><dd>${esc(p.paymentStatus)} · paid ${esc(money(p.paidCents))} of ${esc(money(p.feeCents))}</dd>
      <dt>Waiver</dt><dd>${p.waiver ? `On file${waiverKindLabel(p.waiverKind)}` : 'Not found'}</dd>
      <dt>${p.ownContact ? 'Contact' : 'Parent'}</dt><dd>${p.ownContact ? 'The player (own contact)' : esc(p.parent || '')}</dd>
      <dt>Email</dt><dd>${p.email ? `<a href="mailto:${esc(p.email)}">${esc(p.email)}</a>` : 'None'}</dd>
      <dt>Mobile</dt><dd>${p.phone ? `<a href="tel:${esc(p.phone)}">${esc(p.phone)}</a>` : 'None'}</dd>
      ${p.linkNotes || p.notes ? `<dt>Notes</dt><dd><button type="button" class="j-btn j-btn-line j-btn-sm" data-notes-row="${esc(p.rowId)}">Show notes</button></dd>` : ''}
    </dl>
    <div style="display:flex;justify-content:flex-end;margin-top:16px"><button type="button" class="j-btn j-btn-line" data-close>Close</button></div>`)
}

function groupOptions(selected, { exclude } = {}) {
  // A Juniors class never takes JFP players.
  return P.board.groups.filter((g) => g.id !== exclude && !isJJ(g)).map((g) => `<option value="${esc(g.id)}" ${g.id === selected ? 'selected' : ''}>${esc(g.day)} ${esc(g.time)} · ${esc(g.locationName)} · Coach ${esc(g.coachName || '?')} · ${g.players.length}/${g.capacity}</option>`).join('')
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
    const go = box.querySelector('#pd-go'); go.disabled = true
    const r = await post('markPaid', { rowId: p.rowId, amountCents, method: box.querySelector('#pd-how').value })
    if (!r.ok) { go.disabled = false; return toast(r.data.error) }
    closeModal(); toast('Marked paid. Airtable updated.'); renderBoard(true)
  })
}

// A link for a player already on the board: what is owing, or a product
// from the price list (pro rata from the start week), or any amount.
async function linkModal(p, g) {
  const pr = await pricing()
  const owing = Math.max(0, p.feeCents - p.paidCents)
  const w = contactWords({ self: p.ownContact, players: [p.name], parent: p.parent })
  const box = modal(`<h2 style="margin-bottom:6px">Payment link</h2><p class="muted small" style="margin-bottom:12px">${esc(p.name)}${g ? ` · ${esc(g.day)} ${esc(g.time)}` : ''}. ${w.self ? `${esc(w.contact)} signs in with their own email, signs the waiver if needed, then pays.` : 'The family signs in with their email, signs the waiver if needed, then pays.'}</p>
    ${p.payreq ? `<div class="j-box j-box-grey" style="margin-bottom:12px">A link for ${esc(p.payreq.amountLabel)} is already open. To change its amount, use Payment links. A new link here leaves the old one open.</div>` : ''}
    <div class="jp-seg" id="ln-mode" style="margin-bottom:12px"><button type="button" data-m="price" aria-pressed="true">From the price list</button><button type="button" data-m="owing" aria-pressed="false">What is owing${owing ? ` (${esc(money(owing))})` : ''}</button></div>
    <div id="ln-price"></div>
    <label class="j-field"><span>${w.self ? "Player's email" : 'Parent email'}</span><input class="j-input" id="ln-email" type="email" value="${esc(p.email || '')}"></label>
    <label class="j-check" id="ln-change-row" hidden><input type="checkbox" id="ln-change"> <span>${w.self ? 'Update the email in Airtable to this address. They sign in with it to pay.' : 'Update the parent email in Airtable to this address. The family signs in with it to pay, and will see this player.'}</span></label>
    ${p.linkNotes ? `<details class="j-box j-box-amber small" style="margin-bottom:10px"><summary style="cursor:pointer"><b>${w.self ? 'This player has' : 'This family has'} payment notes in Airtable</b> (tap to read)</summary><p style="margin-top:6px;white-space:pre-wrap">${esc(p.linkNotes)}</p></details>` : ''}
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
      if (!confirm(`${r.data.error}\n\nThe old link stops working and ${w.self ? 'they use' : 'the family uses'} the new one.`)) return
      return go(sendEmail, true)
    }
    if (!r.ok) return toast(r.data.error)
    box.querySelector('#ln-out').innerHTML = `<div class="j-box ${r.data.emailError ? 'j-box-amber' : 'j-box-green'}" style="margin:10px 0">Link for ${esc(r.data.payreq.amountLabel)} created${r.data.emailed ? `. Sent to ${esc(r.data.emailTo)}` : ''}.${r.data.emailError ? ` ${esc(r.data.emailError)}` : ''} <button type="button" class="j-btn j-btn-line j-btn-sm" id="ln-copy">Copy link</button></div>`
    box.querySelector('#ln-copy').addEventListener('click', () => copy(r.data.payreq.url))
    if (!sendEmail) copy(r.data.payreq.url)
    box.querySelector('#ln-go').hidden = true; box.querySelector('#ln-copy-go').hidden = true
    P.board = null; PL.at = 0
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
    P.board = null; PL.at = 0
  }
  box.querySelector('#tm-go').addEventListener('click', () => go(true))
  box.querySelector('#tm-copy-go').addEventListener('click', () => go(false))
}

const LEAVE = ['Cost', 'Time or schedule clash', 'Club or school commitments', 'Injury', 'Not the right group or level', 'Trial was not the right fit', 'Moved away', 'Taking a break', 'Joined another program', 'Moved to 1 to 1', 'No reply from the family', 'Other']

function removeModal(p, g, after) {
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
    closeModal(); toast('Removed. Saved to Players dropped from term 4.'); P.sel = ''; closeSide(); P.board = null; PL.at = 0; (after || (() => renderBoard(true)))()
  })
}

// What staff see under "How they pay": what the family gets in My account.
function payHint(v, words = {}) {
  const they = words.self ? 'They' : 'The family'
  if (v === 'link') return `${they} get a Pay step in their account for this price, after the waiver. No separate link needed.`
  if (v === 'sessions' || v === 'pro') return 'They can pay for sessions from their account: the next session at their price, or more ahead. Sessions you bill from Money show there too.'
  if (v === 'none') return 'They can pay from their account. Any term fee on the row shows there with a Pay button.'
  return ''
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
    ${playerFormHtml('ap', { add: true, opts: { clubs: P.clubs || [] } })}
    <h3>Payment</h3>
    <label class="j-field"><span>Payment</span><select class="j-select" id="ap-pay">
      <option value="link" selected>A price: they sign in, sign the waiver and pay it (pick it below)</option><option value="offline">Already paid offline</option><option value="sessions">Session by session: their own price a session</option><option value="pro">Pro session: Pro sessions price a session</option><option value="trial">Free trial, no payment</option><option value="none">Decide later</option></select></label>
    <p class="muted small" id="ap-pay-hint" style="margin-top:-6px"></p>
    <div id="ap-price"></div>
    <label class="j-field" id="ap-trial-wrap" hidden><span>Trial date</span><select class="j-select" id="ap-trial">${dateOptions(pr, g.day, nextDate(pr, g.day))}</select></label>
    <label class="j-field" id="ap-per-wrap" hidden><span>Price per session (A$) <span class="muted">(optional, or set it when you bill)</span></span><input class="j-input" id="ap-per" inputmode="decimal" placeholder="e.g. 80"></label>
    <label class="j-check"><input type="checkbox" id="ap-send" ${spotLink ? '' : 'checked'}> <span id="ap-send-l"></span></label>
    <p class="j-err" id="ap-err" hidden></p>
    <div class="jpf-acts"><button type="button" class="j-btn j-btn-line" data-close>Cancel</button><button type="button" class="j-btn j-btn-dark" id="ap-go"></button></div>`, { wide: true })
  const read = priceBlock(box, pr, { day: g.day, product: g.product || 'group', prefix: 'ap-price', custom: true })
  let words = contactWords({})
  const payWatch = () => {
    const v = box.querySelector('#ap-pay').value
    const send = box.querySelector('#ap-send').checked
    box.querySelector('#ap-price').hidden = !['link', 'offline'].includes(v)
    box.querySelector('#ap-per-wrap').hidden = !['sessions', 'pro'].includes(v)
    box.querySelector('#ap-trial-wrap').hidden = v !== 'trial'
    // What the family will find when they sign in (Lee, 13 Oct 2026).
    box.querySelector('#ap-pay-hint').textContent = payHint(v, words)
    box.querySelector('#ap-price-afterpay').closest('label').hidden = v !== 'link'
    box.querySelector('#ap-send-l').textContent = words.self
      ? `Email ${words.contact} now. They sign in, sign their waiver, pay for this group, then get the training kit.`
      : 'Email the family now. They sign in, confirm the waiver (or sign it), pay for this group, then get the training kit.'
    const go = box.querySelector('#ap-go')
    if (!go.disabled) go.textContent = v === 'link' ? (send ? 'Add and email payment link' : 'Add and copy link') : send ? words.addAndEmail : 'Add to group'
  }
  const form = wirePlayerForm(box, 'ap', { onChange: (w) => { words = w; payWatch() } })
  // A per-session price from the list is a session-by-session player at that price.
  box.querySelector('#ap-price-prod').addEventListener('change', (e) => {
    const p = customPrices(pr).find((x) => `price:${x.id}` === e.target.value)
    if (p?.perSession) { box.querySelector('#ap-pay').value = p.programme === 'pro' ? 'pro' : 'sessions'; box.querySelector('#ap-per').value = (p.cents / 100).toFixed(2).replace(/\.00$/, ''); payWatch() }
  })
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
        form.fill(x)
        box.querySelector('#ap-results').innerHTML = `<div class="j-box j-box-grey small" style="margin-bottom:10px">Using ${esc(x.name)} from ${esc(x.source)}.${x.waiver ? ' Waiver on file.' : ''}</div>`
      }))
    }, 250)
  })
  let busy = false
  const submit = async () => {
    // Double-add safety: one request at a time; the button stays off until it answers.
    if (busy) return
    const err = box.querySelector('#ap-err')
    err.hidden = true
    const payment = box.querySelector('#ap-pay').value
    const priced = ['link', 'offline'].includes(payment) ? read() : {}
    const f = form.read()
    const body = {
      groupId: g.id,
      player: { name: f.row.name, dob: f.values.dob },
      parent: { name: f.row.parent, email: f.row.email, mobile: f.row.phone },
      ownContact: f.ownContact, profile: filledValues(f.values), note: f.note,
      payment, sendEmail: box.querySelector('#ap-send').checked, ...priced,
    }
    if (body.player.name.length < 3) { err.textContent = 'Enter the player\'s full name.'; err.hidden = false; return }
    if (payment === 'offline') body.method = 'Offline'
    if (payment === 'trial') body.startDate = box.querySelector('#ap-trial').value
    if (['sessions', 'pro'].includes(payment)) {
      const per = box.querySelector('#ap-per').value.trim()
      if (per) {
        body.perSessionCents = Math.round(Number(per) * 100)
        if (!(body.perSessionCents >= 100)) { err.textContent = 'Enter the price per session in dollars, for example 80.'; err.hidden = false; return }
      }
    }
    const btn = box.querySelector('#ap-go')
    const label = btn.textContent
    busy = true; btn.disabled = true; btn.textContent = 'Adding'
    let r = await post('addPlayer', body)
    if (r.status === 409 && r.data.code === 'full') {
      // The confirm replaces this form, so resend the same details on yes.
      if (!(await confirmBox(esc(r.data.error), { ok: 'Add anyway' }))) { busy = false; return }
      r = await post('addPlayer', { ...body, force: true })
      if (!r.ok) { busy = false; return toast(r.data.error || 'Could not add.') }
    } else if (!r.ok) { busy = false; btn.disabled = false; btn.textContent = label; err.innerHTML = `${esc(r.data.error || 'Could not add.')}${r.data.code === 'duplicate' && r.data.rowId ? ' <button type="button" class="j-btn j-btn-line j-btn-sm" id="ap-open-dup">Open the existing player</button>' : ''}`; err.hidden = false; box.querySelector('#ap-open-dup')?.addEventListener('click', () => { closeModal(); openPlayerRecord(r.data.rowId) }); return }
    closeModal()
    const w = r.data.words || words
    if (r.data.emailError) toast(r.data.emailError)
    else if (r.data.profileError) toast(r.data.profileError)
    const mobile = body.parent.mobile
    const where = `${g.day} ${g.time}, ${g.locationName}`
    const textIt = (text, title) => textComposer({ modal, toast, rowIds: [r.data.rowId], parent: body.parent.name, mobile, text, title, self: w.self, to: w.self ? body.player.name : '' })
    const sentLine = r.data.emailed ? ` Sent to ${esc(r.data.emailTo || body.parent.email)}.` : r.data.emailError ? ` <b>The email did not send:</b> ${esc(r.data.emailError)}` : ''
    if (r.data.payreq) {
      const url = r.data.payreq.url
      const done = modal(`<h2 style="margin-bottom:6px">${r.data.emailed ? 'Payment link emailed' : 'Payment link ready'}</h2><p class="muted small" style="margin-bottom:12px"><b>${esc(body.player.name)}</b> is held in ${esc(where)} as Awaiting Reply, and locks in once ${esc(r.data.payreq.amountLabel)} is paid.${sentLine} Now text ${w.self ? 'them' : 'them'} the same link.</p>
        <label class="j-field"><span>Payment link</span><input class="j-input" value="${esc(url)}" readonly></label>
        <div class="jpf-acts"><button type="button" class="j-btn j-btn-line" data-close>Close</button><button type="button" class="j-btn j-btn-line" id="dn-copy">Copy link</button><button type="button" class="j-btn j-btn-dark" id="dn-text" ${mobile ? '' : 'disabled title="No mobile entered"'}>Text it to ${esc(w.contact)}</button></div>
        ${mobile ? '' : '<p class="muted small" style="margin-top:8px">No mobile was entered. Add one with Edit on the Players tab to text them.</p>'}`)
      done.querySelector('#dn-copy').addEventListener('click', () => copy(url))
      done.querySelector('#dn-text').addEventListener('click', () => { closeModal(); textIt(payLinkText({ parent: body.parent.name, player: body.player.name, when: `${g.day} ${g.time}`, place: g.locationName, url, self: w.self }), `Text ${w.contact} the payment link`) })
      if (!r.data.emailed) copy(url)
    } else if (payment === 'trial' && mobile) {
      const when = box.querySelector('#ap-trial').selectedOptions[0]?.textContent || ''
      const done = modal(`<h2 style="margin-bottom:6px">Trial booked</h2><p class="muted small" style="margin-bottom:12px"><b>${esc(body.player.name)}</b> trials on ${esc(when)} in ${esc(where)}. ${esc(g.coachName ? `Coach ${g.coachName}` : 'The coach')} sees it as a trial in their sessions, and is asked for feedback after it.${sentLine}</p>
        <div class="jpf-acts"><button type="button" class="j-btn j-btn-line" data-close>Close</button><button type="button" class="j-btn j-btn-dark" id="dn-text">Text ${esc(w.contact)} the trial details</button></div>`)
      done.querySelector('#dn-text').addEventListener('click', () => { closeModal(); textIt(trialText({ parent: body.parent.name, player: body.player.name, when, where: `${g.time}, ${g.locationName}`, self: w.self }), 'Text the trial details') })
    } else if (!r.data.emailError) toast(`Added${r.data.emailed ? `. Sent to ${r.data.emailTo || body.parent.email}` : ''}. Airtable updated.`)
    P.board = null; PL.at = 0
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
    <div class="jp-kpis"><div class="jp-kpi"><span>Players this term</span><b>${t.players}</b></div><div class="jp-kpi"><span>Held</span><b>${t.held}</b></div><div class="jp-kpi"><span>Paid in full</span><b>${t.paid}</b></div><div class="jp-kpi"><span>Want to keep it</span><b>${t.interested || 0}</b></div><div class="jp-kpi"><span>Invited, no answer</span><b>${t.invited}</b></div><div class="jp-kpi"><span>Not returning</span><b>${t.no}</b></div></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px"><button type="button" class="j-btn j-btn-line j-btn-sm" id="nt-all">Select everyone not invited</button><label class="j-check" style="padding:0"><input type="checkbox" id="nt-email" checked> <span>Email the families</span></label><button type="button" class="j-btn j-btn-dark j-btn-sm" id="nt-invite">Invite selected</button></div>
    <div class="jp-scroll"><table class="jp-table"><thead><tr><th></th><th>Player</th><th>Group now</th><th>${esc(nt.name)}</th></tr></thead><tbody>
      ${d.players.map((p) => `<tr><td><input type="checkbox" data-nt="${esc(p.rowId)}" ${p.status ? 'disabled' : ''}></td><td><b>${esc(p.name)}</b><br><span class="muted small">${esc(p.parent)} · ${esc(p.email || 'no email')}</span></td><td>${esc(p.group)}${p.coach ? `<br><span class="muted small">Coach ${esc(p.coach)}</span>` : ''}</td><td>${p.status ? `<span class="j-pill j-pill-${word[p.status][0]}">${word[p.status][1]}</span>${p.paidCents ? ` <span class="muted small">${esc(money(p.paidCents))}</span>` : ''}` : p.interested ? '<span class="j-pill j-pill-amber">Wants to keep it</span> <span class="muted small">said so in My account</span>' : '<span class="muted small">Not invited</span>'}</td></tr>`).join('')}
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
    toast(r.ok ? `${r.data.invited} invited${r.data.emailed ? `, ${r.data.emailed} emailed` : ''}${r.data.failed?.length ? `. Not sent: ${r.data.failed.map((x) => `${x.email} (${x.error})`).join(', ')}` : ''}` : r.data.error); renderNext()
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
  $('g-draft').addEventListener('click', async () => { const r = await post('draftAges'); if (!r.ok) return toast(r.data.error); toast(`${r.data.changed} group${r.data.changed === 1 ? '' : 's'} given a draft age band`); P.board = null; PL.at = 0; renderGroups() })
  view().querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => groupModal(d.groups.find((g) => g.id === b.dataset.edit))))
}

function groupModal(g) {
  const d = P.groups
  const v = g || { day: 'Monday', time: '4:20pm', location: 'Belrose HQ', coachId: '', extraCoachIds: [], capacity: 4, mode: 'application', label: 'Small group', durationMin: 60, minAge: '', maxAge: '', ageStatus: 'draft', girlsOnly: 'no', publicNote: '', trials: true, questions: ['club', 'team', 'playingUp', 'trainedBefore'], product: 'group', byCoach: false }
  const REQS = [['club', 'Plays club football this season'], ['npl', 'Plays NPL, or Division 1 club football'], ['rep', 'In a representative, NPL or academy squad'], ['high', 'High level players only'], ['committed', 'Can commit to every session this term'], ['trialNew', 'New players trial first'], ['coach', 'By coach invitation or recommendation']]
  const QS = [['club', 'Club they play for'], ['team', 'Team and age group'], ['playingUp', 'Playing up or down'], ['trainedBefore', 'Trained with Joner before'], ['position', 'Position'], ['videos', 'Links to training or game videos']]
  const PRODS = [['group', 'Term, small group'], ['pathway', 'JFP Pathway'], ['oneToOneTerm', 'Term of 1 to 1s'], ['pathwayOneToOne', 'Pathway 1 to 1']]
  const opt = (list, cur) => list.map(([val, label]) => `<option value="${esc(val)}" ${String(cur) === String(val) ? 'selected' : ''}>${esc(label)}</option>`).join('')
  // Drop-downs everywhere (Lee, 12 Oct): times every 5 minutes from 6am to
  // 9pm plus any time a group already uses, the places groups already run,
  // and sensible ages, places and lengths. The current value is always kept.
  const mins = (t) => { const m = String(t).toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/); return m ? ((Number(m[1]) % 12) + (m[3] === 'pm' ? 12 : 0)) * 60 + Number(m[2] || 0) : 9999 }
  const label12 = (n) => { const h = Math.floor(n / 60), m = n % 60; return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''}${h < 12 ? 'am' : 'pm'}` }
  const groupsNow = (P.board?.groups || d.groups || [])
  const times = [...new Set([...Array.from({ length: (21 - 6) * 12 + 1 }, (_, i) => label12(360 + i * 5)), ...groupsNow.map((x) => x.time), v.time].filter(Boolean))].sort((a, b) => mins(a) - mins(b))
  const places = [...new Set(['Belrose HQ', 'NTRA', 'Rydalmere', ...groupsNow.map((x) => x.location), v.location].filter(Boolean))]
  const ages = [['', 'No limit'], ...Array.from({ length: 16 }, (_, i) => [String(i + 4), String(i + 4)])]
  const caps = Array.from({ length: 20 }, (_, i) => [String(i + 1), String(i + 1)])
  const durs = [...new Set([30, 45, 50, 55, 60, 75, 90, 120, Number(v.durationMin) || 60])].sort((a, b) => a - b).map((n) => [String(n), `${n} minutes`])
  const box = modal(`<h2 style="margin-bottom:12px">${g ? 'Edit group' : 'New group'}</h2>
    <div class="j-two"><label class="j-field"><span>Day</span><select class="j-select" id="gm-day">${opt(d.days.map((x) => [x, x]), v.day)}</select></label>
    <label class="j-field"><span>Start time</span><select class="j-select" id="gm-time">${opt(times.map((t) => [t, t]), v.time)}</select></label></div>
    <div class="j-two"><label class="j-field"><span>Location</span><select class="j-select" id="gm-loc">${opt(places.map((x) => [x, x === 'NTRA' ? 'North Turramurra (NTRA)' : x === 'Rydalmere' ? 'Rydalmere Park' : x]), v.location)}</select></label>
    <label class="j-field"><span>Coach</span><select class="j-select" id="gm-coach"><option value="">Not set</option>${opt(d.coaches.map((c) => [c.id, c.name]), v.coachId)}</select></label></div>
    <div class="j-two"><label class="j-field"><span>Parents can</span><select class="j-select" id="gm-mode">${opt(d.modes.map((m) => [m, modeLabel[m]]), v.mode)}</select></label>
    <label class="j-field"><span>Type</span><select class="j-select" id="gm-label">${opt(d.labels.map((x) => [x, x]), v.label)}</select></label></div>
    <div class="j-two"><label class="j-field"><span>Youngest age</span><select class="j-select" id="gm-min">${opt(ages, v.minAge ?? '')}</select></label><label class="j-field"><span>Oldest age</span><select class="j-select" id="gm-max">${opt(ages, v.maxAge ?? '')}</select></label></div>
    <div class="j-two"><label class="j-field"><span>Age band</span><select class="j-select" id="gm-agest">${opt([['draft', 'Draft, to confirm'], ['confirmed', 'Confirmed']], v.ageStatus)}</select></label>
    <label class="j-field"><span>Girls only</span><select class="j-select" id="gm-girls">${opt([['no', 'No'], ['suggested', 'Looks like it, not enforced'], ['yes', 'Yes, girls only']], v.girlsOnly)}</select></label></div>
    <div class="j-two"><label class="j-field"><span>Places (capacity)</span><select class="j-select" id="gm-cap">${opt(caps, v.capacity)}</select></label><label class="j-field"><span>Length</span><select class="j-select" id="gm-dur">${opt(durs, v.durationMin)}</select></label></div>
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
    closeModal(); toast(r.data.movedPlayers ? `Saved. ${r.data.movedPlayers} players moved in Airtable.` : 'Saved'); P.board = null; PL.at = 0; P.groups = null; if (P.tab === 'board') renderBoard(true); else renderGroups()
  })
  box.querySelector('#gm-del')?.addEventListener('click', async () => {
    if (!(await confirmBox(`Delete ${esc(g.day)} ${esc(g.time)}? Only possible when nobody is in it.`, { ok: 'Delete', danger: true }))) return
    const r = await post('deleteGroup', { id: g.id })
    if (!r.ok) return toast(r.data.error)
    toast('Deleted'); P.board = null; PL.at = 0; renderGroups()
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
      P.board = null; PL.at = 0
      return renderRequests()
    }
    if (!res.ok) return toast(res.data.error)
    box.querySelector('#of-out').innerHTML = `<div class="j-box j-box-green" style="margin:10px 0">${trial ? 'Trial offered' : 'Place offered'}, ${esc(res.data.payreq.amountLabel)}${res.data.emailed ? ', emailed' : ''}. <button type="button" class="j-btn j-btn-line j-btn-sm" id="of-copy">Copy payment link</button></div>`
    box.querySelector('#of-copy').addEventListener('click', () => copy(res.data.payreq.url))
    box.querySelector('#of-go').hidden = true
    box.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => renderRequests()))
    P.board = null; PL.at = 0
  }
  box.querySelector('#of-go').addEventListener('click', go)
}

// ---------- payment links ----------

const REASON = { 'admin-add': 'Spot link', balance: 'Balance', application: 'Application offer', waitlist: 'Waitlist offer', trial: 'Trial', 'term-after-trial': 'Term after trial', quick: 'Quick link' }
// Prices and quick links share the portal's own modal, toast and board.
const quickUi = () => ({ view, post, need, toast, modal, closeModal, confirm: confirmBox, copy, payPill, board: async () => (P.board ||= await need(await post('board'))), pricing: async (fresh = false) => { if (fresh) P.pricing = null; return pricing() }, resetPricing: () => { P.pricing = null }, onPrices: () => { if (P.tab === 'prices') renderPrices() }, onLinks: () => { if (P.tab === 'payments') renderPayments() } })
const LINK_PROGS = [['all', 'All'], ['jfp', 'JFP'], ['pro', 'Pro sessions'], ['juniors', 'Joners Juniors'], ['holiday', 'Holiday training'], ['other', 'Other']]

async function renderPayments() {
  const d = await need(await post('payments'))
  if (!P.board) P.board = await need(await post('board'))
  const eff = (e) => (!e ? '' : e.ok ? '<span class="j-pill j-pill-green">Airtable and emails done</span>' : `<span class="j-pill j-pill-red">${esc([...e.failed, ...e.uncertain, ...e.pending].join(', '))}</span>`)
  // A quick link with no player writes nothing to Airtable: staff are emailed.
  const effQuick = (e) => (!e ? '' : e.ok ? '<span class="j-pill j-pill-green">Staff emailed</span>' : '<span class="j-pill j-pill-red">Staff email not sent</span>')
  const when = (iso) => new Date(iso).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
  const state = (q) => {
    if (q.status === 'paid') return `<span class="j-pill j-pill-green">Paid</span><div class="muted small" style="margin-top:3px">${q.paidAt ? esc(when(q.paidAt)) : ''}</div>`
    if (['cancelled', 'expired'].includes(q.status)) return `<span class="j-pill j-pill-grey">${esc(q.status)}</span>`
    const pill = q.status === 'checkout' ? '<span class="j-pill j-pill-amber">Paying now</span>' : q.views ? `<span class="j-pill j-pill-amber">Opened ${q.views === 1 ? 'once' : `${q.views} times`}</span>` : q.emailedAt ? '<span class="j-pill j-pill-blue">Emailed</span>' : '<span class="j-pill j-pill-blue">Not sent yet</span>'
    return `${pill}<div class="muted small" style="margin-top:3px">${q.emailedAt ? `Emailed ${esc(when(q.emailedAt))}` : `Made ${esc(when(q.createdAt))}`}${q.expiresAt ? ` · holds until ${esc(new Date(q.expiresAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }))}` : ''}</div>`
  }
  const filt = { open: (q) => ['open', 'checkout'].includes(q.status), paid: (q) => q.status === 'paid', closed: (q) => ['cancelled', 'expired'].includes(q.status) }
  // Programme chips (Lee, 13 Oct 2026): every link before quick links is JFP.
  const inProg = (q) => P.linkProg === 'all' || (q.programme || 'jfp') === P.linkProg
  const shown = d.payreqs.filter(inProg)
  const counts = Object.fromEntries(Object.entries(filt).map(([k, f]) => [k, shown.filter(f).length]))
  const list = shown.filter(filt[P.linkFilter] || filt.open)
  const progCount = Object.fromEntries(LINK_PROGS.map(([k]) => [k, d.payreqs.filter((q) => k === 'all' || (q.programme || 'jfp') === k).length]))
  // Paid quick links for Other (and Pro sessions, until Money has its own Pro
  // view) with no player: nowhere else to look at them.
  const otherCheck = d.payreqs.filter((q) => q.quick && q.toCheck && ['other', 'pro'].includes(q.programme))
  const quickState = (q) => {
    const pill = { paid: 'green', expired: 'grey', cancelled: 'grey', paying: 'amber', opened: 'amber', sent: 'blue', made: 'blue' }[q.quickStatus] || 'grey'
    return `<span class="j-pill j-pill-${pill}">${esc(q.quickStatusLabel)}</span><div class="muted small" style="margin-top:3px">${q.status === 'paid' ? (q.paidAt ? esc(when(q.paidAt)) : '') : q.emailedAt ? `Emailed ${esc(when(q.emailedAt))}` : `Made ${esc(when(q.createdAt))}`}${q.views && q.status !== 'paid' ? ` · opened ${q.views === 1 ? 'once' : `${q.views} times`}` : ''}${['open', 'checkout'].includes(q.status) && q.expiresAt ? ` · works until ${esc(new Date(q.expiresAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }))}` : ''}</div>${q.status === 'paid' && q.toCheck ? `<div class="muted small">No player: waiting on ${esc(QUICK_WHERE[q.programme])}</div>` : ''}`
  }
  const who = (q) => (q.quick && !q.players.length ? `<b>No player</b><br><span class="muted small">${esc(q.status === 'paid' ? [q.payerName, q.payerEmail].filter(Boolean).join(' · ') || 'Paid' : q.email || 'No email')}</span>` : `<b>${esc(q.players.join(', '))}</b><br><span class="muted small">${esc(q.parentName)}${q.email ? ` · ${esc(q.email)}` : ''}</span>`)
  const forCell = (q) => (q.quick ? `${esc(q.forText)}<br><span class="muted small">${progPill(q.programme, q.programmeLabel)} Quick link${q.priceName && !q.forText.startsWith(q.priceName) ? ` · ${esc(q.priceName)}` : ''}${q.afterpay ? '' : ' · card only'}</span>` : `${esc(q.group || 'No group')}<br><span class="muted small">${esc(REASON[q.kind] || q.kind)}${q.productLabel ? ` · ${esc(q.productLabel)}` : ''}${q.trialDate ? ` · trial ${esc(q.trialDate)}` : q.startDate ? ` · from ${esc(q.startDate)}` : ''}${q.afterpay ? '' : ' · card only'}</span>`)
  const acts = (q) => `${['open', 'checkout'].includes(q.status) ? `<button type="button" class="j-btn j-btn-line j-btn-sm" data-change="${esc(q.id)}">Change amount</button> <button type="button" class="j-btn j-btn-line j-btn-sm" data-copy="${esc(q.url)}">Copy</button>${q.quick ? ` <a class="j-btn j-btn-line j-btn-sm" href="${esc(q.url)}" target="_blank" rel="noopener noreferrer">Open</a>${q.email ? ` <button type="button" class="j-btn j-btn-line j-btn-sm" data-email-quick="${esc(q.id)}">Email it</button>` : ''}` : ''} <button type="button" class="j-btn j-btn-ghost j-btn-sm" data-cancel-pay="${esc(q.id)}">Cancel</button>` : ''}${q.effects && !q.effects.ok ? `<button type="button" class="j-btn j-btn-line j-btn-sm" data-repair="${esc(q.id)}">Repair</button>` : ''}${q.stripeUrl ? ` <a class="j-btn j-btn-ghost j-btn-sm" href="${esc(q.stripeUrl)}" target="_blank" rel="noopener noreferrer">Stripe</a>` : ''}`
  const attention = [...d.payreqs, ...d.bookings].filter((x) => x.needsAttention)
  const attnWord = { 'paid-after-cancel': 'Paid after it was cancelled', 'second-payment': 'Paid twice', 'late-payment': 'Paid after the hold ran out' }
  view().innerHTML = `
    <div class="jp-head"><div><h1>Payment links</h1><p class="muted small">Make a link for any player, change the amount on an open one, or copy it to send yourself. You never need to open Stripe. Refunds are made in Stripe.</p></div>
      <div class="jq-acts"><button type="button" class="j-btn j-btn-dark" id="pl-quick">Quick link</button><button type="button" class="j-btn j-btn-line" id="pl-new">+ New payment link</button></div></div>
    ${otherCheck.length ? `<div class="j-box j-box-amber" id="pl-other-check" style="margin-bottom:16px"><b>Other payments to check: ${otherCheck.length}</b><p class="small" style="margin:4px 0 6px">Quick links for Pro sessions or Other, paid with no player named. Look at who paid, then tick Checked.</p><ul class="jm-hist">${otherCheck.map((q) => `<li><span><b>${esc(q.forText)}</b><small>${esc([q.payerName, q.payerEmail].filter(Boolean).join(' · ') || 'Payer not known')} · ${q.paidAt ? esc(when(q.paidAt)) : ''} · ${esc(q.id)}</small></span><span class="jq-acts"><span class="amt">${esc(q.amountLabel)}</span><button type="button" class="j-btn j-btn-line j-btn-sm" data-check-quick="${esc(q.id)}">Checked</button></span></li>`).join('')}</ul></div>` : ''}
    ${attention.length ? `<div class="j-box j-box-red" style="margin-bottom:16px"><b>Needs checking</b>${attention.map((x) => `<div style="margin-top:8px">${esc(x.players.join(', '))} · ${esc(x.parentName)} · ${esc(String(x.needsAttention).split(', ').map((k) => attnWord[k] || k).join(', '))}${(x.unexpected || []).map((u) => ` · ${esc(u.amountLabel)}${u.stripeUrl ? ` <a href="${esc(u.stripeUrl)}" target="_blank" rel="noopener noreferrer">Stripe</a>` : ''}`).join('')}</div>`).join('')}<p class="small" style="margin-top:8px">A payment that arrived after a cancel is not added to Airtable. Give the family the place (add them on the timetable) or refund in Stripe.</p></div>` : ''}
    <div class="j-chips jq-progs" id="pl-prog" role="group" aria-label="Programme" style="margin-bottom:8px">${LINK_PROGS.map(([v, l]) => `<button type="button" class="j-chip" data-prog="${v}" aria-pressed="${P.linkProg === v}">${l} ${progCount[v]}</button>`).join('')}</div>
    <div class="jp-seg" id="pl-f" style="margin-bottom:10px">${[['open', `Open ${counts.open}`], ['paid', `Paid ${counts.paid}`], ['closed', `Cancelled or expired ${counts.closed}`]].map(([v, l]) => `<button type="button" data-f="${v}" aria-pressed="${P.linkFilter === v}">${l}</button>`).join('')}</div>
    ${list.length ? `<div class="jp-scroll jq-links"><table class="jp-table jy-table jy-stack" id="pl-list"><thead><tr><th>Player</th><th>For</th><th>Amount</th><th>Status</th><th></th></tr></thead><tbody>
      ${list.map((q) => `<tr data-link="${esc(q.id)}"><td data-label="Player"><div class="jq-cell">${who(q)}</div></td>
        <td data-label="For"><div class="jq-cell">${forCell(q)}</div></td>
        <td data-label="Amount"><div class="jq-cell">${esc(q.amountLabel)}${q.feeLabel ? `<br><span class="muted small">fee ${esc(q.feeLabel)}</span>` : ''}</div></td><td data-label="Status"><div class="jq-cell">${q.quick ? quickState(q) : state(q)}${q.status === 'paid' ? `<div style="margin-top:4px">${q.quick && !(q.term4Ids || []).length ? effQuick(q.effects) : eff(q.effects)}</div>` : ''}</div></td>
        <td class="jq-rowacts" data-label="">${acts(q)}</td></tr>`).join('')}
    </tbody></table></div>` : '<div class="j-empty">Nothing here.</div>'}
    <h2 style="margin:22px 0 10px">Online bookings</h2>
    ${d.bookings.length ? `<div class="jp-scroll"><table class="jp-table"><thead><tr><th>Players</th><th>Group</th><th>Paid</th><th>Status</th><th>Airtable and emails</th><th></th></tr></thead><tbody>
      ${d.bookings.map((b) => `<tr><td><b>${esc(b.players.join(', ') || 'Not chosen yet')}</b><br><span class="muted small">${esc(b.parentName)} · ${esc(b.email)}</span></td><td>${esc(b.group)}</td><td>${esc(b.amountLabel)}${b.feeLabel ? `<br><span class="muted small">fee ${esc(b.feeLabel)}</span>` : ''}</td><td><span class="j-pill j-pill-${b.status === 'paid' ? 'green' : b.status === 'held' ? 'amber' : 'grey'}">${esc(b.status)}</span>${b.needsAttention ? ` <span class="j-pill j-pill-red">${esc(b.needsAttention)}</span>` : ''}</td><td>${eff(b.effects)}</td>
        <td style="white-space:nowrap">${b.effects && !b.effects.ok ? `<button type="button" class="j-btn j-btn-line j-btn-sm" data-repair="${esc(b.id)}">Repair</button>` : ''}${b.status === 'held' ? `<button type="button" class="j-btn j-btn-ghost j-btn-sm" data-cancel-booking="${esc(b.id)}">Release</button>` : ''}${b.stripeUrl ? ` <a class="j-btn j-btn-ghost j-btn-sm" href="${esc(b.stripeUrl)}" target="_blank" rel="noopener noreferrer">Stripe</a>` : ''}</td></tr>`).join('')}
    </tbody></table></div>` : '<div class="j-empty">No online bookings yet.</div>'}`
  $('pl-f').addEventListener('click', (e) => { const b = e.target.closest('[data-f]'); if (b) { P.linkFilter = b.dataset.f; renderPayments() } })
  $('pl-prog').addEventListener('click', (e) => { const b = e.target.closest('[data-prog]'); if (b) { P.linkProg = b.dataset.prog; renderPayments() } })
  $('pl-new').addEventListener('click', () => newLinkModal())
  $('pl-quick').addEventListener('click', () => quickModal(quickUi()))
  view().querySelectorAll('[data-email-quick]').forEach((b) => b.addEventListener('click', async () => { const q = d.payreqs.find((x) => x.id === b.dataset.emailQuick); if (!(await confirmBox(`Email this link to <b>${esc(q.email)}</b>?`, { ok: 'Email it' }))) return; const r = await post('emailQuickLink', { id: q.id }); toast(r.ok ? `Sent to ${r.data.emailTo || q.email}` : r.data.error); renderPayments() }))
  view().querySelectorAll('[data-check-quick]').forEach((b) => b.addEventListener('click', async () => { b.disabled = true; const r = await post('quickLinkChecked', { id: b.dataset.checkQuick }); toast(r.ok ? 'Checked' : r.data.error); renderPayments() }))
  view().querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', () => copy(b.dataset.copy)))
  view().querySelectorAll('[data-change]').forEach((b) => b.addEventListener('click', () => changeModal(d.payreqs.find((q) => q.id === b.dataset.change))))
  view().querySelectorAll('[data-repair]').forEach((b) => b.addEventListener('click', async () => { b.disabled = true; const r = await post('repair', { id: b.dataset.repair }); toast(r.ok ? (r.data.summary.ok ? 'Repaired' : 'Still not complete. Check Airtable and try again.') : r.data.error); renderPayments() }))
  view().querySelectorAll('[data-cancel-pay]').forEach((b) => b.addEventListener('click', async () => { if (!(await confirmBox('Cancel this payment link? The family will not be able to pay with it, and a place held for it goes back.'))) return; const r = await post('cancelPayreq', { id: b.dataset.cancelPay }); toast(r.ok ? 'Cancelled' : r.data.error); P.board = null; PL.at = 0; renderPayments() }))
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

// The JFP price list and Lee's own prices, each with Create link (13 Oct 2026).
async function renderPrices() { return renderPricesPage(quickUi()) }

// ---------- money ----------

// ---------- charts: animated, responsive, accessible ----------
// Columns grow from the baseline, bars from the left, tiles rise in. Each
// chart is redrawn at its container's width (no stretching), with a hover
// and keyboard tooltip and a table view underneath.

const cssVar = (name) => getComputedStyle(root()).getPropertyValue(name).trim()
const SERIES = [['stripe', 'Stripe', '--c-series-1'], ['bank', 'Bank transfer', '--c-series-2'], ['cash', 'Cash', '--c-series-3']]
const STATUS = {
  paid: ['Paid', '--c-good'], stripe: ['Paid in Stripe, not recorded', '--c-series-1'], part: ['Part paid', '--c-orange'],
  unpaid: ['Unpaid', '--c-critical'], unpriced: ['Unpaid, no price set', '--c-critical'], session: ['Session by session', '--c-pink'],
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
function weeklyChart(el, weeks, animate, empty = 'No money in yet.') {
  const W = Math.max(280, el.clientWidth), H = 240, L = 54, B = 26, T = 18
  const totals = weeks.map((w) => w.stripe + w.bank + w.cash)
  if (!totals.some((t) => t > 0)) { el.innerHTML = `<p class="muted small jc-empty">${esc(empty)}</p>`; return }
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
    const fees = w.fee ? `<span class="row">Stripe fees ${esc(money(w.fee))}</span><span class="row">Kept ${esc(money(totals[i] - w.fee))}</span>` : ''
    const tipHtml = `<b>Week of ${esc(lab(w.week))}</b>${SERIES.map(([k, n, c]) => `<span class="row"><i style="background:${cssVar(c)}"></i>${n} ${esc(money(w[k]))}</span>`).join('')}<span class="row">Total ${esc(money(totals[i]))}</span>${fees}`
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

function chartTable(head, rows, id = '') {
  return `<details class="jc-table"${id ? ` id="${id}" ${P.moneyOpen?.has(id) ? 'open' : ''}` : ''}><summary>Show as a table</summary><table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></details>`
}

// ---------- dashboard ----------

let resizeTimer = 0
async function renderOverview(redraw = false) {
  if (!redraw || !P.money) {
    view().innerHTML = '<p class="muted">Loading the dashboard</p>'
    // First paint from the last reading, then the latest a moment later.
    const [mr, rq] = await Promise.all([post('money', { quick: true }), post('requests')])
    const m = await need(mr)
    laterMoney('overview', (fresh) => { P.money = fresh; renderOverview(true) })
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
      <section class="jd-card jd-hero jd-span-5 jd-in" style="--i:0"><div><p class="lbl">Income this term</p><p class="big">${esc(money(k.incomeCents))}</p>${typeof k.netIncomeCents === 'number' ? `<p class="jm-sum"><b>${esc(money(k.netIncomeCents))}</b> kept after Stripe fees</p>` : ''}</div>
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
      <section class="jd-card jd-span-7 jd-in" style="--i:4"><h2>Venues</h2><p class="sub">Tap a venue to see its money. Bars: green is paid, grey is not yet.</p><div class="jc" id="c-locs"></div>
        <div class="jv-list">${m.locations.map((l) => `<button type="button" class="jv-btn" data-venue="${esc(l.id)}"><span class="nm">${esc(l.name)}</span><span class="amt">${esc(money(l.netCents ?? l.receivedCents))}</span><span class="muted small">kept after fees · paid in ${esc(money(l.receivedCents))}${l.juniors?.paidCents ? ` · + Juniors ${esc(money(l.juniors.paidCents))}` : ''}</span></button>`).join('')}</div>
        ${chartTable(['Location', 'Players', 'Paid', 'Owing', 'Paid in (after refunds)', 'Kept after Stripe fees'], m.locations.map((l) => [l.name, l.players, l.paid, money(l.owingCents), money(l.receivedCents), money(l.netCents ?? l.receivedCents)]))}</section>
      <section class="jd-card jd-span-5 jd-in" style="--i:5"><h2>Needs you</h2><ul class="jd-list">
        ${pending.slice(0, 4).map((r) => `<li><button type="button" data-tab="requests">${esc(r.players.map((p) => p.name).join(', '))}</button><span class="muted small">${esc(r.kind === 'application' ? 'Application' : r.kind === 'waitlist' ? 'Waitlist' : 'Enquiry')}</span></li>`).join('')}
        ${m.status.stripe ? `<li><button type="button" data-money-filter="stripe">${m.status.stripe} Stripe payment${m.status.stripe === 1 ? '' : 's'} to record in Airtable</button><span class="muted small">Money</span></li>` : ''}
        ${m.status.unpriced ? `<li><button type="button" data-money-filter="unpriced">${m.status.unpriced} players with no price set</button><span class="muted small">Money</span></li>` : ''}
        ${m.unmatched.length ? `<li><button type="button" data-money-filter="">${m.unmatched.length} Stripe payment${m.unmatched.length === 1 ? '' : 's'} not matched to a player</button><span class="muted small">Money</span></li>` : ''}
        ${!pending.length && !m.status.stripe && !m.status.unpriced && !m.unmatched.length ? '<li><span class="muted">Nothing waiting. Nice.</span></li>' : ''}
      </ul></section>
      ${juniorsCardShell()}
    </div>`
  fillJuniorsCard(juniorsUi())
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
    if (P.tab === 'money' && P.money && $('m-weekly')) { const s = moneyScope(P.money, P.moneyFilter?.loc || ''); weeklyChart($('m-weekly'), s.weekly, false, emptyWeekly(s)) }
    if (P.tab === 'money' && $('y-chart')) redrawYearChart()
  }, 150)
})
document.addEventListener('click', (e) => {
  const f = e.target.closest('[data-money-filter]')
  if (!f) return
  // The dashboard counts every venue, so the list it opens does too, and it is this term's.
  P.moneyFilter = { ...(P.moneyFilter || {}), status: f.dataset.moneyFilter, loc: '', term: '', year: '' }
  P.jf.programme = 'jfp'
  go('money')
})

// ---------- venues: revenue by venue (Lee, 6 Oct 2026) ----------

// This term comes with the dashboard (P.money). Any other term is read once
// and kept for the session: the term before from its payment ledger, older
// terms from the copy of the Money Register.
// A venue's costs for the term (rent, cleaning, field hire) and its profit.
// "No venue set" is not a place with rent: its players need a venue first.
const canCost = (m, id) => m.locations.find((l) => l.id === id)?.canCost ?? id !== 'other'
function costsBlock(v, can = true) {
  if (!can) return '<section class="jv-costs" id="jv-costs"><h3 class="jv-h3">Costs this term</h3><p class="muted small" id="jv-no-costs">Set a venue on these players to add costs.</p></section>'
  const lines = v?.costLines || []
  const costs = v?.costsCents || 0
  const before = v ? v.profitBeforeFees : false
  const base = v ? (before ? v.receivedCents || 0 : v.netCents || 0) : 0
  return `<section class="jv-costs" id="jv-costs">
    <div class="jv-costs-head"><h3 class="jv-h3">Costs this term</h3><button type="button" class="j-btn j-btn-line j-btn-sm" id="jv-cost-edit">${lines.length ? 'Edit' : 'Add costs'}</button></div>
    ${lines.length ? `<ul class="jm-feelist">${lines.map((l) => `<li><span>${esc(l.label)}</span><b>${esc(money(l.cents))}</b></li>`).join('')}<li class="tot"><span>Total costs</span><b>${esc(money(costs))}</b></li></ul>
    <div class="jv-profit"><span class="lbl">Profit after fees and costs</span><span class="val" id="jv-profit">${esc(signedMoney(v.profitCents))}</span><span class="note">${before ? 'Taken' : 'Kept after Stripe fees'} ${esc(money(base))} less costs ${esc(money(costs))}${before ? '. Stripe fees are not known for this term, so this is before fees.' : ''}</span></div>`
    : '<p class="muted small">No costs added yet. Add rent, cleaning or field hire to see what this venue makes.</p>'}
    <p class="muted small">${esc(WAGES_NOTE)}</p>
  </section>`
}
const centsFrom = (t) => { const x = String(t || '').replace(/[a$,\s]/gi, ''); return x === '' ? null : Math.round(Number(x) * 100) }
function costRow(l = { label: '', cents: null }) {
  return `<div class="jv-cost-row"><input class="j-input" data-cl maxlength="40" placeholder="For example, Field hire" aria-label="Cost name" value="${esc(l.label)}"><input class="j-input" data-cc inputmode="decimal" placeholder="A$" aria-label="Amount in dollars" value="${l.cents == null ? '' : esc((l.cents / 100).toFixed(2).replace(/\.00$/, ''))}"><button type="button" class="jv-cost-del" data-cost-del aria-label="Remove this line">&times;</button></div>`
}
// Edit in place: add or remove lines, copy last term's, save.
function bindCosts(box, { id, term, lines, last, reopen }) {
  const sec = box.querySelector('#jv-costs')
  const lastLines = last?.byVenue?.[id] || []
  box.querySelector('#jv-cost-edit')?.addEventListener('click', () => {
    sec.innerHTML = `<h3 class="jv-h3">Costs this term</h3><p class="muted small">${esc(term)}. Up to 20 lines. ${esc(WAGES_NOTE)}</p>
      <div id="jv-cost-rows">${(lines.length ? lines : [undefined]).map((l) => costRow(l)).join('')}</div>
      <div class="jv-cost-tools"><button type="button" class="j-btn j-btn-line j-btn-sm" id="jv-cost-add">+ Add a line</button>${lastLines.length ? `<button type="button" class="j-btn j-btn-line j-btn-sm" id="jv-cost-copy">Copy ${esc(last.term)}'s costs</button>` : ''}</div>
      <div class="jv-cost-tools jv-cost-save"><button type="button" class="j-btn j-btn-line" id="jv-cost-cancel">Cancel</button><button type="button" class="j-btn j-btn-dark" id="jv-cost-go">Save costs</button></div>`
    const rows = sec.querySelector('#jv-cost-rows')
    sec.querySelector('#jv-cost-add').addEventListener('click', () => {
      if (rows.children.length >= 20) return toast('Up to 20 lines per venue.')
      rows.insertAdjacentHTML('beforeend', costRow())
      rows.lastElementChild.querySelector('[data-cl]').focus()
    })
    sec.querySelector('#jv-cost-copy')?.addEventListener('click', () => { rows.innerHTML = lastLines.map((l) => costRow(l)).join('') })
    rows.addEventListener('click', (e) => { const d = e.target.closest('[data-cost-del]'); if (d) d.closest('.jv-cost-row').remove() })
    sec.querySelector('#jv-cost-cancel').addEventListener('click', () => reopen())
    sec.querySelector('#jv-cost-go').addEventListener('click', async (e) => {
      const out = []
      for (const r of rows.querySelectorAll('.jv-cost-row')) {
        const label = r.querySelector('[data-cl]').value.trim(), c = centsFrom(r.querySelector('[data-cc]').value)
        if (!label && c == null) continue
        if (!label) return toast('Give each cost a name, like "Field hire".')
        if (c == null || !Number.isFinite(c) || c < 0) return toast(`Check the amount for "${label}".`)
        out.push({ label, cents: c })
      }
      const btn = e.currentTarget
      btn.disabled = true
      const r = await post('saveVenueCosts', { term, venueId: id, lines: out })
      btn.disabled = false
      if (!r.ok) return toast(r.data.error)
      toast(out.length ? 'Costs saved' : 'Costs cleared')
      reopen()
    })
  })
}

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
  // Paid in Stripe but not recorded yet still owes what the Stripe money doesn't cover.
  const owes = (p) => p.stillOwingCents ?? p.owingCents
  const owingList = now ? players.filter((p) => owes(p) > 0).sort((a, b) => owes(b) - owes(a) || a.player.localeCompare(b.player)) : []
  const owingTotal = owingList.reduce((t, p) => t + owes(p), 0)
  const costable = canCost(m, id)
  const pnmHere = now ? (m.paidNoMoney || []).filter((x) => x.locationId === id).reduce((t, x) => t + x.missingCents, 0) : 0
  // Fees are known for this term and the term before (its ledger), not for the Money Register.
  const feesKnown = v ? typeof v.stripeFeeCents === 'number' : false
  const s = now && v ? moneyScope(m, id) : null
  const refunded = s?.refunded || 0
  const split = v ? [['Stripe', v.stripeCents], ['Bank transfer', v.bankCents], ['Cash', v.cashCents], ['Other', v.otherCents]].filter(([, c]) => c).map(([n, c]) => `${n} ${money(c)}`).join(' · ') : ''
  const groupName = (p) => (now ? (p.group || '').replace(/, [^,]*$/, '') : p.group)
  // Where Lee's typed total in the register differs from the payments listed.
  const typed = reg ? (id === 'belrose' ? past.register['belrose hq'] : ['ntra', 'rydalmere'].includes(id) ? past.register.fields : undefined) : undefined
  const listedFields = reg ? past.venues.filter((x) => ['ntra', 'rydalmere'].includes(x.id)).reduce((t, x) => t + x.receivedCents, 0) : 0
  const listed = id === 'belrose' ? v?.receivedCents || 0 : listedFields
  const notes = now ? [
    'Kept is what is left after Stripe takes its fee on each payment. Bank transfers and cash have no fee. A refund gives the money back, but Stripe keeps its fee.',
    m.unlinked?.cents ? `All venues plus ${money(m.unlinked.cents - (m.kpis.unlinkedFeeCents || 0))} kept (${money(m.unlinked.cents)} paid in) that isn't linked to a player yet (a payment from an email that is not on any row) add up to the term's ${money(m.kpis.netIncomeCents ?? m.kpis.incomeCents)} kept.` : `All venues add up to the term's ${money(m.kpis.netIncomeCents ?? m.kpis.incomeCents)} kept.`,
    s?.pending ? `${s.pending} Stripe fee${s.pending === 1 ? ' is' : 's are'} still loading, so kept may be a little high for now.` : '',
    v?.removedCents ? `Includes ${money(v.removedCents)} from players since removed.` : '',
    v?.airtableOnlyCents ? `Airtable also shows ${money(v.airtableOnlyCents)} as paid here with no payment this term (paid last term, or typed in). It is not counted.` : '',
  ] : reg ? [
    `${past.term} from your Money Register (the Google Sheet): the payments listed under each session${past.importedAt ? `. Copied ${past.importedAt}` : ''}.`,
    'Stripe fees not known for this term.',
    `All venues add up to ${money(past.incomeCents)}. Game analysis is not counted as venue revenue.`,
    typed != null && typed !== listed ? `Your register's typed total for ${id === 'belrose' ? 'HQ' : 'the fields (NTRA and Rydalmere together)'} is ${money(typed)}; the payments listed come to ${money(listed)}.` : '',
  ] : [
    `${past.term} from the payment ledger: every Stripe, bank transfer and cash payment, and the Stripe fee on each.`,
    past.feesPendingCount ? `${past.feesPendingCount} Stripe payment${past.feesPendingCount === 1 ? ' has' : 's have'} no fee in the ledger, so kept may be a little high.` : '',
    `All venues add up to ${money(past.incomeCents)}${past.unlinked.cents ? `. ${money(past.unlinked.cents)} (${past.unlinked.count} payment${past.unlinked.count === 1 ? '' : 's'}) belongs to players no longer on the term list, so it is not on a venue` : ''}.`,
  ]
  const taken = (v?.receivedCents || 0) + refunded
  const box = modal(`<div class="jv-top"><h2>${esc(name)}</h2><button type="button" class="j-close" data-close aria-label="Close">&times;</button></div>
    <div class="jv-switch">
      <div class="jp-seg" role="group" aria-label="Venue">${all.map(([vid, vn]) => `<button type="button" data-venue="${esc(vid)}" data-vterm="${esc(term)}" aria-pressed="${vid === id}">${esc(vn)}</button>`).join('')}</div>
      <label class="jv-term"><span class="muted small">Term</span><select class="j-select" id="jv-term">${terms.map((t) => `<option value="${esc(t === m.term ? '' : t)}" ${(now ? t === m.term : t === term) ? 'selected' : ''}>${esc(t === m.term ? `${t} so far` : t)}</option>`).join('')}</select></label>
    </div>
    ${!v ? `<p class="muted" style="margin-top:16px">No players or payments at this venue for this term.</p>${costsBlock(null, costable)}` : `
    <div class="jv-kpis">
      ${feesKnown
        ? `<div class="jd-tile jv-kept"><span class="lbl">Kept after Stripe fees</span><span class="val" id="jv-kept">${esc(money(v.netCents))}</span><span class="note">Taken ${esc(money(taken))}${refunded ? ` · Refunded ${esc(money(refunded))} · Paid in ${esc(money(v.receivedCents))}` : ''} · Stripe fees ${esc(money(v.stripeFeeCents))}</span>${split ? `<span class="note">${esc(split)}</span>` : ''}</div>`
        : `<div class="jd-tile jv-kept"><span class="lbl">Taken</span><span class="val" id="jv-kept">${esc(money(v.receivedCents))}</span><span class="note">Stripe fees not known for this term</span>${split ? `<span class="note">${esc(split)}</span>` : ''}</div>`}
      <div class="jd-tile"><span class="lbl">${now ? 'Players paid' : reg ? 'Payments' : 'Players who paid'}</span><span class="val">${now ? `${v.paid}<span class="muted" style="font-size:16px;font-weight:650"> / ${v.players}</span>` : v.players}</span>${now ? `<span class="note">Still owing ${esc(money(owingTotal))}</span>` : ''}</div>
      ${now && v.expectedCents ? `<div class="jd-tile"><span class="lbl">Expected this term</span><span class="val">${esc(money(v.expectedCents))}</span><span class="note">${v.collectedPct}% marked paid (${esc(money(v.collectedCents))})${pnmHere ? `. ${esc(money(pnmHere))} of that has no money found` : ''}</span>${meter(v.collectedPct)}</div>` : ''}
      ${v.juniors ? `<div class="jd-tile"><span class="lbl">Joners Juniors</span><span class="val">${esc(money(v.juniors.paidCents))}</span><span class="note">${v.juniors.paid} of ${v.juniors.players} paid${v.juniors.creditCents ? `, ${esc(money(v.juniors.creditCents))} with last term's credit` : ''}. Not in the JFP total.</span></div>` : ''}
    </div>
    ${costsBlock(v, costable)}
    <h3 class="jv-h3">${reg ? 'By session' : 'By group'}</h3>
    <div class="jp-scroll"><table class="jp-table jm-table"><thead><tr><th>${reg ? 'Session' : 'Group'}</th>${reg ? '' : '<th>Coach</th>'}<th class="num">${reg ? 'Payments' : 'Players'}</th><th class="num">${now ? 'Paid in' : 'Taken'}</th>${feesKnown ? '<th class="num">Kept</th>' : ''}${now ? '<th class="num">Owing</th>' : ''}</tr></thead><tbody>
      ${v.groups.map((g) => `<tr><td>${esc(g.label)}</td>${reg ? '' : `<td>${esc(g.coach)}</td>`}<td class="num">${g.players}</td><td class="num">${esc(money(g.receivedCents))}</td>${feesKnown ? `<td class="num">${esc(money(g.netCents))}</td>` : ''}${now ? `<td class="num">${esc(money(g.owingCents))}</td>` : ''}</tr>`).join('')}
      ${v.groups.length > 1 ? `<tr class="jv-total"><td>Total</td>${reg ? '' : '<td></td>'}<td class="num">${v.groups.reduce((t, g) => t + g.players, 0)}</td><td class="num">${esc(money(v.receivedCents))}</td>${feesKnown ? `<td class="num">${esc(money(v.netCents))}</td>` : ''}${now ? `<td class="num">${esc(money(v.owingCents))}</td>` : ''}</tr>` : ''}
    </tbody></table></div>
    ${now && refunded ? `<p class="muted small">Paid in is after refunds: taken ${esc(money(taken))} less ${esc(money(refunded))} refunded.</p>` : ''}
    ${now ? `<details class="jv-players" id="jv-owing" ${owingList.length ? 'open' : ''}><summary>Still owing (${owingList.length})${owingList.length ? ` · ${esc(money(owingTotal))}` : ''}</summary>
      ${owingList.length ? `<ul class="jv-owe">${owingList.map((p) => `<li><button type="button" data-owe-row="${esc(p.rowId)}"><span class="who"><b>${esc(p.player)}</b> <small>${esc(groupName(p))}</small></span> <span class="amt">${esc(money(owes(p)))} <small>${statusPill(p.status)}</small></span></button></li>`).join('')}</ul>` : '<p class="muted small" style="margin-top:8px">Nobody owes anything here.</p>'}</details>` : ''}
    ${reg ? '' : `<details class="jv-players"><summary>Who paid (${paidList.length})</summary>
      <div class="jp-scroll" style="margin-top:8px"><table class="jp-table jm-table"><thead><tr><th>Player</th><th>Group</th><th class="num">Paid</th>${feesKnown ? '<th class="num">Kept</th>' : ''}${now ? '<th class="num">Owing</th><th>Status</th>' : ''}</tr></thead><tbody>
        ${paidList.map((p) => `<tr ${now ? `data-owe-row="${esc(p.rowId)}"` : ''}><td>${esc(p.player)}</td><td>${esc(groupName(p))}</td><td class="num">${esc(money(p.receivedCents))}</td>${feesKnown ? `<td class="num">${esc(money(p.netReceivedCents ?? p.receivedCents))}</td>` : ''}${now ? `<td class="num">${esc(money(p.owingCents))}</td><td>${statusPill(p.status)}</td>` : ''}</tr>`).join('') || `<tr><td colspan="6" class="muted">No payments yet.</td></tr>`}
      </tbody></table></div></details>`}`}
    <div class="jv-notes muted small">${notes.filter(Boolean).map((n) => `<p>${esc(n)}</p>`).join('')}</div>`, { wide: true })
  box.querySelector('#jv-term').addEventListener('change', (e) => venueModal(id, e.target.value))
  if (costable) bindCosts(box, { id, term: now ? m.term : past.term, lines: v?.costLines || [], last: (now ? m.venueCostsLast : past.venueCostsLast) || null, reopen: async () => {
    if (now) {
      const r = await post('money', { quick: true })
      if (r.ok) { P.money = r.data.money; if (P.tab === 'money') renderMoney(P.money); else if (P.tab === 'overview') renderOverview(true) }
    } else {
      delete P.venueCache[term]
      // Money showing that term picks up the new costs too.
      if (P.tab === 'money' && P.moneyFilter?.term === term) renderMoney()
    }
    venueModal(id, term)
  } })
  // A player in the lists opens their payments, like a row in the Money table.
  box.addEventListener('click', (e) => {
    const r = e.target.closest('[data-owe-row]')
    if (!r) return
    closeModal()
    historyDrawer(r.dataset.oweRow)
  })
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

const juniorsUi = () => ({ view, post, filter: P.jf, go })
// Money > Holiday training (13 Oct 2026).
const holidayUi = () => ({ view, post, toast, filter: P.jf, programmeSwitch: programmeSwitch('holiday'), bindSwitch: () => bindSwitch(juniorsUi()), saveFile, csvCell, aud, slug, confirm: confirmBox, bankStale, stale: () => P.tab !== 'money' || P.jf.programme !== 'holiday' })
// What the Joners Juniors pages use from here.
const jjUi = () => ({ view, post, need, modal, closeModal, confirmBox, go, filter: P.jf, stale: () => P.tab !== 'jj-money' })
// Money > Pro sessions, Camps and Everything (13 Oct 2026).
const proUi = () => ({ view, post, toast, filter: P.jf, go, confirm: confirmBox, saveFile, csvCell, aud, slug, bankStale, stale: () => P.tab !== 'money' || P.jf.programme !== 'pro' })
const campsUi = () => ({ view, post, toast, filter: P.jf, go, saveFile, csvCell, aud, stale: () => P.tab !== 'money' || P.jf.programme !== 'camps' })
const everythingUi = () => ({
  view, filter: P.jf, go, moneyFilter: P.moneyFilter, stale: () => P.tab !== 'money' || P.jf.programme !== 'all',
  readers: {
    jfp: (year) => moneyYearData(year),
    juniors: () => juniorsData(post, { quick: true }),
    holiday: () => holidayData(post, { period: 'all', quick: true }),
    pro: () => proData(post, { quick: true }),
    camps: (year) => campsData(post, { year }),
  },
})
// After the first paint of a Money view, the other programmes are read
// quietly (their quick readings), so switching to them is instant.
const moneyReaders = () => [
  ['jfp', async () => { if (P.money && Date.now() - (P.moneyAt || 0) < 600000) return; const r = await post('money', { quick: true }); if (r.ok && r.data?.money) { P.money = r.data.money; P.moneyAt = Date.now() } }],
  ['juniors', () => juniorsData(post, { quick: true })],
  ['holiday', () => holidayData(post, { quick: true })],
  ['pro', () => proData(post, { quick: true })],
  ['camps', () => campsData(post, {})],
]
// Edit a player's details from Money: name, family, fee and payment type.
const PAY_TYPES = ['JFP Session by session', 'JFP 10 weeks', 'JFP Half term (5 weeks)', 'JFP Pathway 10 weeks', 'Sibling / 2 sessions per week', 'JFP Trial', 'JFP Drop-in', 'JFP 1 on 1 casual', 'JFP 1 on 1, 10 weeks', 'JFP pathway 1 on 1', 'JFP Pathway', 'Additional Term 4 session balance']
function editPlayerModal(p) {
  if (!p) return
  const box = modal(`<h2 style="margin-bottom:4px">Edit ${esc(p.player)}</h2>
    <p class="muted small" style="margin-bottom:12px">Saves to their row in Term 4 Players. The balance updates from the fee. Payments are recorded with Record payment.</p>
    <label class="j-field"><span>Player's full name</span><input class="j-input" id="ep-name" value="${esc(p.player)}"></label>
    <div class="j-two"><label class="j-field"><span>Fee for this place (A$)</span><input class="j-input" id="ep-fee" inputmode="decimal" value="${p.feeCents == null ? '' : p.feeCents / 100}" placeholder="not set"></label>
    <label class="j-field"><span>Payment type</span><select class="j-select" id="ep-type"><option value="">Not set</option>${[...new Set([...PAY_TYPES, p.type].filter(Boolean))].map((t) => `<option ${t === p.type ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label></div>
    <label class="j-field" id="ep-per-wrap"><span>Price per session (A$), for session by session</span><input class="j-input" id="ep-per" inputmode="decimal" value="${p.perSessionCents ? p.perSessionCents / 100 : ''}" placeholder="e.g. 50"></label>
    <p class="muted small" style="margin-top:-6px">Session by session: they can pay for sessions from their account. A fee with no payment link: they can pay from their account.</p>
    <div class="j-two"><label class="j-field"><span>Parent name</span><input class="j-input" id="ep-parent" value="${esc(p.parent || '')}"></label>
    <label class="j-field"><span>Mobile</span><input class="j-input" id="ep-phone" inputmode="tel" value="${esc(p.phone || '')}"></label></div>
    <label class="j-field"><span>Parent email</span><input class="j-input" id="ep-email" inputmode="email" value="${esc(p.email || '')}"></label>
    <p class="j-err" id="ep-err" hidden></p>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px"><button type="button" class="j-btn j-btn-line" data-close>Cancel</button><button type="button" class="j-btn j-btn-dark" id="ep-go">Save</button></div>`, { wide: true })
  box.querySelector('#ep-go').addEventListener('click', async (e) => {
    const v = (id) => box.querySelector(id).value.trim()
    const fee = v('#ep-fee')
    const fields = {}
    if (v('#ep-name') !== p.player) fields.name = v('#ep-name')
    if (v('#ep-parent') !== (p.parent || '')) fields.parent = v('#ep-parent')
    if (v('#ep-email') !== (p.email || '')) fields.email = v('#ep-email')
    if (v('#ep-phone') !== (p.phone || '')) fields.phone = v('#ep-phone')
    if ((fee === '' ? null : Math.round(Number(fee) * 100)) !== p.feeCents) fields.feeAud = fee === '' ? null : Number(fee)
    if (v('#ep-type') !== (p.type || '')) fields.paymentType = v('#ep-type')
    const per = v('#ep-per')
    if ((per === '' ? null : Math.round(Number(per) * 100)) !== (p.perSessionCents || null)) fields.perSessionAud = per === '' ? null : Number(per)
    if (!Object.keys(fields).length) return closeModal()
    e.currentTarget.disabled = true
    const r = await post('editPlayer', { rowId: p.rowId, fields })
    if (!r.ok) { e.currentTarget.disabled = false; const er = box.querySelector('#ep-err'); er.textContent = r.data.error; er.hidden = false; return }
    closeModal()
    const links = r.data.openLinks || []
    toast(links.length ? `Saved. Note: ${links.length} open payment link${links.length === 1 ? '' : 's'} for ${links.map((l) => `${l.players.join(' + ')} (${money(l.amountCents)})`).join(', ')}: change the amount in Payment links if it is now wrong.` : 'Saved to Airtable', links.length ? 9000 : 3600)
    P.board = null; PL.at = 0; renderMoney()
  })
}

// Pages draw at once from the last reading (quick), then ask for the latest
// and redraw quietly if you are still on the page and not in the middle of
// something.
function laterMoney(tab, apply) {
  post('money').then((r) => {
    if (r.ok && r.data?.money) { P.moneyLatest = r.data.money; P.moneyAt = Date.now() }
    if (!r.ok || P.tab !== tab) return
    if ($('jp-modal') || $('jp-side') || $('jp-menu') || document.querySelector('.jp-confirm-over, .jf-changed, .jm-drawer, #m-tipbox:not([hidden])')) return
    const a = document.activeElement
    if (a && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName)) return
    const y = window.scrollY
    apply(r.data.money)
    window.scrollTo(0, y)
  })
}

// ---------- money: one venue or all of them (12 Oct 2026) ----------
// Every figure on Money follows the venue picked: kept after Stripe fees,
// the tiles, the weekly chart, the fees, the counts, the alert and the list.

const METHOD = { card: 'Card / Link', link: 'Card / Link', afterpay_clearpay: 'Afterpay', klarna: 'Klarna', zip: 'Zip', au_becs_debit: 'Direct debit', unknown: 'Not known yet' }
const methodName = (k) => METHOD[k || 'unknown'] || String(k).replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
// Fees by how people paid. Card and Link cost the same, so they share a line.
function feeRows(byMethod) {
  const g = new Map()
  for (const x of byMethod) {
    const k = methodName(x.method)
    const r = g.get(k) || { label: k, count: 0, feeCents: 0, pendingCount: 0 }
    r.count += x.count
    r.feeCents += x.feeCents || 0
    r.pendingCount += x.pendingCount || 0
    g.set(k, r)
  }
  return [...g.values()].sort((a, b) => b.feeCents - a.feeCents || b.count - a.count)
}
// The same, from one venue's payment lines.
function methodsOf(lines) {
  const g = new Map()
  for (const x of lines) {
    const k = x.payMethod || 'unknown'
    const r = g.get(k) || { method: k, count: 0, feeCents: 0, pendingCount: 0 }
    r.count += 1
    r.feeCents += x.feeCents || 0
    if (x.feeCents == null) r.pendingCount += 1
    g.set(k, r)
  }
  return [...g.values()]
}
// The venues to pick from: No venue set only when it has players or money.
const moneyVenues = (m) => m.locations.filter((l) => l.id !== 'other' || l.players || l.receivedCents || l.stripeFeeCents)
// Money for all venues (the term's figures) or one venue (its share of them).
function moneyScope(m, loc) {
  const k = m.kpis
  const v = loc ? m.locations.find((l) => l.id === loc) : null
  const lines = (m.payments || []).filter((x) => !v || x.venueId === v.id)
  const players = v ? m.players.filter((p) => p.locationId === v.id) : m.players
  const sum = (key) => lines.reduce((t, x) => t + (x[key] || 0), 0)
  const stripeLines = lines.filter((x) => x.method === 'Stripe')
  if (!v) {
    return {
      id: '', name: 'All venues', players, lines, weekly: m.weekly,
      kept: k.netIncomeCents ?? k.incomeCents, received: k.incomeCents, fees: k.stripeFeesCents || 0, refunded: k.refundsCents || 0, gst: k.feeGstCents || 0, pending: k.feesPendingCount || 0,
      stripe: k.stripeCents, bank: k.bankCents, cash: k.cashCents, other: k.otherCents || 0, owing: k.owingCents,
      expected: k.expectedCents || 0, collected: k.collectedCents || 0, pct: k.collectedPct ?? null, byMethod: k.feesByMethod || methodsOf(stripeLines),
      costs: k.venueCostsCents || 0, profit: k.profitCents ?? (k.netIncomeCents ?? k.incomeCents), hasCosts: (k.venuesWithCosts || 0) > 0, pnm: m.paidNoMoney || [], canCost: false,
    }
  }
  return {
    id: v.id, name: v.name, players, lines, weekly: m.weeklyByVenue?.[v.id] || [],
    kept: v.netCents ?? v.receivedCents, received: v.receivedCents, fees: v.stripeFeeCents || 0, refunded: sum('refundedCents'), gst: sum('feeGstCents'), pending: new Set(stripeLines.filter((x) => x.feeCents == null).map((x) => x.id)).size,
    stripe: v.stripeCents, bank: v.bankCents, cash: v.cashCents, other: v.otherCents || 0, owing: v.owingCents,
    expected: v.expectedCents || 0, collected: v.collectedCents || 0, pct: v.collectedPct ?? null, byMethod: methodsOf(stripeLines),
    costs: v.costsCents || 0, profit: v.profitCents ?? (v.netCents ?? v.receivedCents), hasCosts: (v.costLines || []).length > 0, pnm: (m.paidNoMoney || []).filter((x) => x.locationId === v.id), canCost: canCost(m, v.id),
  }
}
// Profit can be below zero: "-A$120", not "A$-120".
const signedMoney = (c) => (c < 0 ? `-${money(-c)}` : money(c))
const WAGES_NOTE = "Coach wages aren't in this unless you add them as a cost."
// Marked paid in Airtable, but less money came in for them this term.
// Folds on Money that stay open when the page redraws itself.
const isOpen = (id) => (P.moneyOpen?.has(id) ? 'open' : '')
function keepFolds(root) {
  P.moneyOpen = P.moneyOpen || new Set()
  root.querySelectorAll('details[id]').forEach((d) => d.addEventListener('toggle', () => { if (d.open) P.moneyOpen.add(d.id); else P.moneyOpen.delete(d.id) }))
}
// Money in the total that the weekly chart can't show: no date, or before the first week.
const undatedOf = (s) => Math.max(0, s.received - s.weekly.reduce((t, w) => t + w.stripe + w.bank + w.cash, 0))
const emptyWeekly = (s) => `No money in yet${s.id ? ` at ${s.name}` : ''}.`
function paidNoMoneyList(list) {
  if (!list.length) return ''
  const missing = list.reduce((t, x) => t + x.missingCents, 0)
  return `<details class="jm-next jm-pnm" id="m-pnm" ${isOpen('m-pnm')}><summary>Marked paid but no money found: <b>${plural(list.length, 'player')}</b> · <b>${esc(money(missing))}</b></summary>
    <p class="small muted">Airtable says these are paid, but less money came in for them this term than it shows. They may have paid last term, or the amount was typed in. Tap one to check.</p>
    <ul class="jv-owe">${list.map((x) => `<li><button type="button" data-pnm-row="${esc(x.rowId)}"><span class="who"><b>${esc(x.player)}</b> <small>${esc((x.group || '').replace(/, [^,]*$/, ''))} · Airtable says ${esc(money(x.airtableSaysCents))} · found ${esc(money(x.foundCents))}</small></span><span class="amt">${esc(money(x.missingCents))} <small>not found</small></span></button></li>`).join('')}</ul></details>`
}
const meter = (pct) => (pct == null ? '' : `<span class="jm-meter" role="img" aria-label="${pct}% paid"><span style="width:${Math.min(100, Math.max(0, pct))}%"></span></span>`)
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

// The top of Money for the venue picked: kept, the tiles, the notes, the alert.
function scopeTop(m, s, cls) {
  const owingPlayers = s.players.filter((p) => p.owingCents > 0).length
  const tiles = [
    ['stripe', 'Stripe', s.stripe, '--c-series-1', s.fees ? `Stripe fees ${money(s.fees)}` : ''],
    ['bank', 'Bank transfer', s.bank, '--c-series-2', ''],
    ['cash', 'Cash', s.cash, '--c-series-3', ''],
    ...(s.other > 0 ? [['other', 'Other', s.other, '--c-neutral', '']] : []),
    ['owing', 'Still owing', s.owing, '--c-critical', plural(owingPlayers, 'player')],
  ]
  const stripeHere = s.players.filter((p) => p.status === 'stripe').length
  const k = m.kpis
  const pnmCents = s.pnm.reduce((t, x) => t + x.missingCents, 0)
  const undated = undatedOf(s)
  return `<div class="jd-grid">
      <section class="jd-card jd-hero jm-hero jm-net ${cls}" style="--i:0"><div>
        <p class="lbl">Kept after Stripe fees${s.id ? ` · ${esc(s.name)}` : ''}</p>
        <p class="big" id="m-kept">${esc(money(s.kept))}</p>
        <p class="jm-sum" id="m-sum"><span>Taken <b>${esc(money(s.received + s.refunded))}</b></span> · <span>Stripe fees <b>${esc(money(s.fees))}</b></span> · <span>Refunded <b>${esc(money(s.refunded))}</b></span></p>
        ${s.pending ? `<p class="jm-pending" id="m-pending">${plural(s.pending, 'fee')} still loading</p>` : ''}
        ${s.hasCosts ? `<p class="jm-profit" id="m-profit">Profit after costs <b>${esc(signedMoney(s.profit))}</b><small>Venue costs ${esc(money(s.costs))}. ${esc(WAGES_NOTE)}</small></p>` : s.canCost ? `<button type="button" class="jm-linkbtn" data-venue="${esc(s.id)}" id="m-add-costs">Add ${esc(s.name)}'s costs to see profit</button>` : ''}</div>
        ${s.expected ? `<div class="jm-expect" id="m-expect"><p>Expected this term <b>${esc(money(s.expected))}</b> · <b>${s.pct ?? 0}%</b> marked paid (${esc(money(s.collected))})</p>${meter(s.pct)}${pnmCents ? `<button type="button" class="jm-linkbtn" id="m-pnm-go">${esc(money(pnmCents))} of that has no money found</button>` : ''}</div>` : ''}
      </section>
      <div class="jm-tiles" data-n="${tiles.length}">${tiles.map(([key, l, v, c, note], i) => `<section class="jd-card jd-tile jm-tile ${cls}" style="--i:${i + 1}" data-tile="${key}"><span class="lbl"><span class="jd-key"><i style="background:${cssVar(c)}"></i>${l}</span></span><span class="val">${esc(money(v || 0))}</span>${note ? `<span class="note">${esc(note)}</span>` : ''}</section>`).join('')}</div>
    </div>
    ${!s.id && m.unlinked?.cents ? `<p class="jm-note" id="m-unlinked">${esc(money(m.unlinked.cents - (k.unlinkedFeeCents || 0)))} kept (${esc(money(m.unlinked.cents))} paid in) isn't linked to a player yet, so it sits under All.</p>` : ''}
    ${!s.id && k.nextTermCents > 0 ? `<details class="jm-next" id="m-next" ${isOpen('m-next')}><summary>Paid for next term: <b>${esc(money(k.nextTermCents))}</b> (not counted in this term)</summary>
      <ul class="jm-hist">${(m.nextTermPayments || []).map((p) => `<li><span><b>${esc(p.name || p.email || 'No name')}</b><small>${esc(new Date(p.at).toLocaleDateString('en-AU'))}${p.forTerm ? ` · ${esc(p.forTerm)}` : ''}</small></span><span class="amt">${esc(money(p.cents))}</span></li>`).join('')}</ul></details>` : ''}
    ${paidNoMoneyList(s.pnm)}
    ${stripeHere ? `<div class="jm-alert"><span><b>${plural(stripeHere, 'player')}${s.id ? ` at ${esc(s.name)}` : ''} ${stripeHere === 1 ? 'has' : 'have'} paid in Stripe</b> but Airtable does not show it yet.</span><span class="jm-alert-go"><button type="button" class="j-btn j-btn-line j-btn-sm" data-set-status="stripe">Show them</button><button type="button" class="j-btn j-btn-dark j-btn-sm" id="m-record-all">Record all in Airtable</button></span></div>` : ''}
    <div class="jd-grid jm-charts">
      <section class="jd-card jm-week ${cls}" style="--i:6"><h2>Money in by week</h2><p class="sub">${esc(s.name)}: Stripe, bank transfer and cash, by the week it came in</p>
        <div class="jc" id="m-weekly"></div>
        <div class="jc-legend">${SERIES.map(([, n, c]) => `<span><i style="background:${cssVar(c)}"></i>${n}</span>`).join('')}</div>
        ${undated ? `<p class="muted small" id="m-undated">${esc(money(undated))} has no date (or came in before the first week), so it isn't in the chart.</p>` : ''}
        ${chartTable(['Week of', 'Stripe', 'Bank transfer', 'Cash', 'Stripe fees'], s.weekly.map((w) => [w.week, money(w.stripe), money(w.bank), money(w.cash), money(w.fee || 0)]), 'm-weekly-table')}</section>
      ${feesCard(s, cls)}
    </div>`
}

function feesCard(s, cls) {
  const rows = feeRows(s.byMethod)
  const count = rows.reduce((t, r) => t + r.count, 0)
  return `<section class="jd-card jm-fees ${cls}" style="--i:7" id="m-fees"><h2>Stripe fees</h2><p class="sub">${esc(s.name)}, this term</p>
    ${!count ? '<p class="muted small">No Stripe payments yet.</p>' : `<p class="jm-fee-total"><b>${esc(money(s.fees))}</b> on ${plural(count, 'payment')}</p>
    <ul class="jm-feelist">${rows.map((r) => `<li><span>${esc(r.label)}<small>${plural(r.count, 'payment')}${r.pendingCount ? ` · ${r.pendingCount} still loading` : ''}</small></span><b>${esc(money(r.feeCents))}</b></li>`).join('')}</ul>
    <p class="small jm-gst">GST in these fees: <b>${esc(money(s.gst))}</b> (claimable)</p>`}
  </section>`
}

// ---------- download for the accountant ----------
// Built here from the Money figures already on the page, for the venue picked.
const csvCell = (v) => {
  const t = String(v ?? '')
  if (/^-?\d+(\.\d+)?$/.test(t)) return t
  // Text that starts like a formula stays text in a spreadsheet.
  const safe = /^[=+\-@\t\r]/.test(t) ? `'${t}` : t
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}
const aud = (c) => (c == null ? '' : (c / 100).toFixed(2))
function moneyCsv(m, s) {
  const venueName = (id) => m.locations.find((l) => l.id === id)?.name || 'Not linked to a player'
  const out = []
  const add = (...cells) => out.push(cells.map(csvCell).join(','))
  const sum = (list, k) => list.reduce((t, x) => t + (x[k] || 0), 0)
  add('JFP money', m.term, s.name, `Downloaded ${new Date().toLocaleDateString('en-AU', { timeZone: 'Australia/Sydney' })}`)
  add('')
  add('Summary', 'A$')
  add('Taken', aud(s.received + s.refunded))
  add('Refunded', aud(s.refunded))
  add('Stripe fees', aud(s.fees))
  add('GST in Stripe fees', aud(s.gst))
  add('Kept after Stripe fees', aud(s.kept))
  if (s.hasCosts) { add('Venue costs', aud(s.costs)); add('Profit after costs', aud(s.profit)) }
  if (s.pending) add(`${plural(s.pending, 'Stripe fee')} still loading when this was downloaded`)
  add('')
  add('Players')
  add('Player', 'Group', 'Venue', 'Fee (A$)', 'Paid this term (A$)', 'Owing (A$)', 'Stripe fee (A$)', 'Kept (A$)', 'Status')
  const players = s.players.filter((p) => p.feeCents || p.receivedCents || p.paidCents || p.owingCents)
  for (const p of players) add(p.player, (p.group || '').replace(/, [^,]*$/, ''), venueName(p.locationId), aud(p.feeCents || 0), aud(p.receivedCents || 0), aud(p.owingCents || 0), p.stripeFeePending ? '' : aud(p.stripeFeeCents || 0), p.stripeFeePending ? '' : aud(p.netReceivedCents ?? p.receivedCents ?? 0), STATUS[p.status]?.[0] || p.status)
  // Money that is in the venue's figures but not on a player listed above.
  const venues = s.id ? m.locations.filter((l) => l.id === s.id) : m.locations
  const removed = sum(venues, 'removedCents'), removedFee = sum(venues, 'removedFeeCents')
  const extra = []
  if (removed || removedFee) extra.push({ label: 'Players since removed', receivedCents: removed, stripeFeeCents: removedFee })
  if (!s.id && (m.kpis.unlinkedCents || m.kpis.unlinkedFeeCents)) extra.push({ label: 'Not linked to a player yet', receivedCents: m.kpis.unlinkedCents || 0, stripeFeeCents: m.kpis.unlinkedFeeCents || 0 })
  for (const x of extra) add(x.label, '', '', '', aud(x.receivedCents), '', aud(x.stripeFeeCents), aud(x.receivedCents - x.stripeFeeCents), '')
  const paid = sum(players, 'receivedCents') + sum(extra, 'receivedCents'), fees = sum(players, 'stripeFeeCents') + sum(extra, 'stripeFeeCents')
  add('Total', '', '', aud(sum(players, 'feeCents')), aud(paid), aud(sum(players, 'owingCents')), aud(fees), aud(paid - fees), '')
  add('')
  add('Payments')
  add('Date', 'Method', 'Paid by or for', 'Taken (A$)', 'Stripe fee (A$)', 'GST in fee (A$)', 'Refunded (A$)', 'Kept (A$)', 'Venue', 'Reference')
  for (const x of s.lines) add(x.at, x.method === 'Stripe' && x.payMethod ? `Stripe (${methodName(x.payMethod)})` : x.method, x.who, aud(x.takenCents), aud(x.feeCents), aud(x.feeGstCents), aud(x.refundedCents), aud(x.keptCents), venueName(x.venueId), x.id)
  add('Total', '', '', aud(sum(s.lines, 'takenCents')), aud(sum(s.lines, 'feeCents')), aud(sum(s.lines, 'feeGstCents')), aud(sum(s.lines, 'refundedCents')), aud(sum(s.lines, 'keptCents')), '', '')
  if (s.lines.some((x) => x.feeCents == null) || players.some((p) => p.stripeFeePending)) add('A blank Stripe fee (and kept) was not known yet when this was downloaded.')
  return out.join('\r\n')
}
const slug = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
function saveFile(name, text, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob(['﻿', text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}
const downloadMoney = (m, s) => saveFile(`jfp-money-${slug(m.term)}-${s.id || 'all'}.csv`, moneyCsv(m, s))

// ---------- money: an earlier term or a whole year (12 Oct 2026) ----------
// Money remembers what it shows in P.moneyFilter: this term, an earlier term
// (term) or a whole year (year), and the venue picked (loc). The views
// themselves are in jfp-portal-years.js.

function moneyHash(f) {
  const q = [f.year ? ['year', f.year] : f.term ? ['term', f.term] : null, f.loc ? ['loc', f.loc] : null].filter(Boolean)
  return q.length ? `#money?${q.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}` : '#money'
}
// An earlier term: the same figures as the venue window, read once a session.
async function pastTermData(term) {
  P.venueCache = P.venueCache || {}
  if (!P.venueCache[term]) {
    const r = await post('venues', { term })
    if (r.status === 404) return null
    P.venueCache[term] = (await need(r)).venues
  }
  return P.venueCache[term]
}
// A year is added up on the server (and kept there for 10 minutes). Here it is
// kept for 2 minutes, so the two minute refresh redraws it without asking.
async function moneyYearData(year, { fresh = false } = {}) {
  P.yearCache = P.yearCache || {}
  const hit = P.yearCache[year]
  if (!fresh && hit && Date.now() - hit.got < 120000) return hit.data
  const r = await post('moneyYear', { year, ...(fresh ? { fresh: true } : {}) })
  if (r.status === 404) return null
  const data = (await need(r)).year
  P.yearCache[year] = { data, got: Date.now() }
  return data
}
function yearsUi(terms, current, seq, animate) {
  return {
    view, post, toast, filter: P.moneyFilter, terms, current, animate,
    programmeSwitch: programmeSwitch('jfp'), bindSwitch: () => bindSwitch(juniorsUi()),
    render: () => renderMoney(), setHash: () => { if (P.tab === 'money') history.replaceState(null, '', moneyHash(P.moneyFilter)) },
    // The page moved on while this was loading.
    stale: () => P.tab !== 'money' || P.moneySeq !== seq || P.jf.programme !== 'jfp',
    cssVar, bindTips, compact, niceMax, saveFile, csvCell, slug, keepFolds, isOpen,
    pastTerm: pastTermData, yearData: moneyYearData,
  }
}
async function renderLookBack(pre, seq) {
  const f = P.moneyFilter
  if (pre) P.money = pre
  if (!P.money) {
    view().innerHTML = '<p class="muted">Loading</p>'
    P.money = (await need(await post('money', { quick: true }))).money
  }
  if (seq !== P.moneySeq) return
  const m = P.money
  const terms = m.venueTerms?.length ? m.venueTerms : [m.term]
  // A link to this term is today's view; a term or year with no figures falls back to it.
  if (f.term === m.term) f.term = ''
  if (f.term && !terms.includes(f.term)) { toast(`No figures for ${f.term}. Showing this term.`); f.term = '' }
  if (f.year && !terms.some((t) => t.endsWith(` ${f.year}`))) { toast(`No figures for ${f.year}. Showing this term.`); f.year = '' }
  if (!f.term && !f.year) return renderMoney()
  // The chart grows in the first time a view is drawn, not on every two minute refresh.
  const key = f.year ? `year:${f.year}` : `term:${f.term}`
  const ui = yearsUi(terms, m.term, seq, P.lookKey !== key)
  P.lookKey = key
  return f.year ? renderMoneyYear(ui) : renderPastTerm(ui)
}

// What Money > JFP explains under its (i).
const JFP_TIP = 'Every player\'s payments: Stripe read live, plus the bank transfers and cash you record here. Recording a payment writes the player\'s row and the payment ledger in Airtable; anything changed in Airtable shows here when you open this tab or press Refresh. Pro sessions, Joners Juniors, holiday training and camps are not in these figures: each has its own view in the Programme menu.'

async function renderMoney(pre) {
  // Opened from the menu or the programme switch (not a refresh after a change).
  const nav = P.nav === true
  P.nav = false
  // Joners Juniors money is its own page in the Joners Juniors section.
  if (P.jf.programme === 'juniors') { P.jf.programme = 'jfp'; return go('jj-money') }
  if (P.jf.programme === 'holiday') return renderHolidayMoney(holidayUi())
  if (P.jf.programme === 'pro') return renderProMoney(proUi())
  if (P.jf.programme === 'camps') return renderCampsMoney(campsUi())
  if (P.jf.programme === 'all') return renderEverything(everythingUi())
  P.moneyFilter = { status: '', q: '', loc: '', view: 'players', term: '', year: '', ...(P.moneyFilter || {}) }
  const seq = (P.moneySeq = (P.moneySeq || 0) + 1)
  if (P.moneyFilter.term || P.moneyFilter.year) return renderLookBack(pre, seq)
  P.lookKey = ''
  // Switching back to JFP: the last reading (up to 15 minutes old) at once,
  // the latest behind it (laterMoney). After a change it is always read again.
  const kept = !pre && nav && (P.moneyLatest || P.money) && Date.now() - (P.moneyAt || 0) < 900000 ? (P.moneyLatest || P.money) : null
  const r = pre ? { money: pre } : kept ? { money: kept } : await need(await post('money', { quick: true }))
  if (!pre && !kept) { P.moneyLatest = r.money; P.moneyAt = Date.now() }
  if (!pre) laterMoney('money', (fresh) => renderMoney(fresh))
  if (P.tab !== 'money' || P.jf.programme !== 'jfp' || seq !== P.moneySeq) return
  P.money = r.money
  const m = P.money
  const f = P.moneyFilter
  if (f.loc && !m.locations.some((l) => l.id === f.loc)) f.loc = ''
  const setHash = () => { if (P.tab === 'money') history.replaceState(null, '', moneyHash(f)) }
  view().innerHTML = `
    ${moneyHead({ controls: `${programmeSwitch('jfp')}${showingPicker(m.venueTerms?.length ? m.venueTerms : [m.term], m.term, f)}<button type="button" class="j-btn j-btn-dark j-btn-sm" id="m-add">+ Add a player</button>`, at: new Date(P.moneyAt || Date.now()).toISOString(), tip: `${esc(JFP_TIP)}<label class="jm-since"><span>Term payments counted from</span><input class="j-input" type="date" id="m-since" value="${esc(m.since)}"></label><span class="muted small">Change the date, then press Refresh.</span>`, refresh: 'm-refresh' })}
    ${m.stripeError ? `<div class="j-box j-box-amber">${esc(m.stripeError)}</div>` : ''}
    <div class="jm-scope">
      <div class="jm-locs" id="m-locs" role="group" aria-label="Venue">${[{ id: '', name: 'All', netCents: m.kpis.netIncomeCents ?? m.kpis.incomeCents }, ...moneyVenues(m)].map((l) => `<button type="button" data-mloc="${esc(l.id)}" aria-pressed="${f.loc === l.id}"><span class="nm">${esc(l.name)}</span> <span class="amt">${esc(money(l.netCents ?? l.receivedCents ?? 0))} kept</span></button>`).join('')}</div>
      <button type="button" class="j-btn j-btn-line j-btn-sm jm-csv" id="m-csv">Download for accountant</button>
    </div>
    <div id="m-scope"></div>
    <div id="m-bank"></div>
    <div class="jm-bar">
      <div class="jm-chips jm-view" role="group" aria-label="Show"><button type="button" data-money-view="players" aria-pressed="${f.view !== 'family'}">Players</button><button type="button" data-money-view="family" aria-pressed="${f.view === 'family'}">By family</button></div>
      <div class="jm-search"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2" stroke-linecap="round"/></svg><input class="j-input" id="m-q" type="search" placeholder="Search player, parent or email" value="${esc(f.q)}" autocomplete="off"></div>
      <div class="jm-chips" id="m-chips"></div>
    </div>
    <div id="m-fams" ${f.view === 'family' ? '' : 'hidden'}></div>
    <div class="jp-scroll" id="m-table" ${f.view === 'family' ? 'hidden' : ''}><table class="jp-table jm-table"><thead><tr><th>Player</th><th>Group</th><th class="num">Fee</th><th class="num">Paid</th><th class="num">Owing</th><th>Status</th><th></th></tr></thead><tbody id="m-rows"></tbody></table></div>
    <p class="muted small" id="m-count" style="margin-top:8px"></p>
    <div id="m-unmatched"></div>`
  const scope = () => moneyScope(m, f.loc)
  // Bank transfers to check: read on their own, and they follow the venue too.
  const family = (p) => m.players.filter((x) => x.familyKey === p.familyKey).map((x) => x.rowId)
  const bankUi = {
    post, toast, confirm: confirmBox, modal, closeModal,
    redraw: () => { if ($('m-bank') && P.money === m) drawBank() },
    // Marked as holiday training, or put on last term: those views read again.
    after: (kind) => { holidayStale(); if (kind === 'pro') forget('pro:'); if (kind === 'previous') { P.venueCache = {}; P.yearCache = {} } },
    record: (item, rowId) => {
      const p = m.players.find((x) => x.rowId === rowId)
      if (p) recordModal(p, { bank: { item, rowIds: item.candidates.find((c) => c.rowId === rowId)?.familyRowIds || family(p) } })
    },
    other: (item) => pickPlayerModal(`${money(item.cents)} from ${item.payer}`, (p) => recordModal(p, { bank: { item, rowIds: family(p) } })),
  }
  const drawBank = () => { $('m-bank').innerHTML = bankPanel(f.loc); bindBank($('m-bank'), bankUi) }
  // Everything that follows the venue picked.
  const drawScope = (animate) => {
    const s = scope()
    $('m-scope').innerHTML = scopeTop(m, s, animate ? 'jd-in' : '')
    keepFolds($('m-scope'))
    drawBank()
    weeklyChart($('m-weekly'), s.weekly, animate, emptyWeekly(s))
    const counts = { '': s.players.length }
    for (const p of s.players) counts[p.status] = (counts[p.status] || 0) + 1
    $('m-chips').innerHTML = [['', 'All'], ['paid', 'Paid'], ['part', 'Part paid'], ['unpaid', 'Unpaid'], ['session', 'Session by session'], ['unpriced', 'No price set'], ['stripe', 'Paid in Stripe']].filter(([v]) => v !== 'stripe' || counts.stripe || f.status === 'stripe').map(([v, l]) => `<button type="button" data-set-status="${v}" aria-pressed="${f.status === v}">${v ? `<i style="background:${cssVar(STATUS[v][1])}"></i>` : ''}${l} <span class="n">${counts[v] || 0}</span></button>`).join('')
    // Payments not tied to a player belong to no venue, so they show under All only.
    $('m-unmatched').innerHTML = !s.id && m.unmatched.length ? `<details class="jd-card" style="margin-top:18px"><summary style="cursor:pointer;font-weight:700">${m.unmatched.length} Stripe payment${m.unmatched.length === 1 ? '' : 's'} not matched to a player</summary><p class="sub" style="margin:6px 0 10px">Paid with an email that is not on any Term 4 row. Match each one to the player it was for.</p>
      <ul class="jm-hist">${m.unmatched.map((u) => `<li><span><b>${esc(u.name || u.email || 'No name')}</b><small>${esc(u.email)} · ${esc(new Date(u.at).toLocaleDateString('en-AU'))} · ${esc(u.product)}</small></span><span style="display:flex;gap:8px;align-items:center"><span class="amt">${esc(money(u.cents))}</span><button type="button" class="j-btn j-btn-line j-btn-sm" data-match="${esc(u.id)}">Match</button></span></li>`).join('')}</ul></details>` : ''
  }
  const draw = () => {
    if (f.view === 'family') { $('m-count').textContent = ''; return drawFamilies($('m-fams'), { m, f, post, toast, confirmBox, statusPill, done: () => { P.board = null; PL.at = 0; renderMoney() } }) }
    const q = f.q.trim().toLowerCase()
    const s = scope()
    const list = s.players.filter((p) => (!f.status || p.status === f.status) && (!q || `${p.player} ${p.parent} ${p.email}`.toLowerCase().includes(q)))
    $('m-rows').innerHTML = list.map((p) => `<tr data-row="${esc(p.rowId)}"><td><b>${esc(p.player)}</b><br><span class="muted small">${esc(p.parent || '')}</span></td><td class="small">${esc(p.group)}</td><td class="num">${p.status === 'session' ? `${p.perSessionCents ? `${esc(money(p.perSessionCents))}<br><span class="muted small">a session</span>` : '<span class="muted">per session</span>'}${p.feeCents ? `<br><span class="muted small">${esc(money(p.feeCents))} billed</span>` : ''}` : p.feeCents ? esc(money(p.feeCents)) : '<span class="muted">not set</span>'}</td><td class="num">${esc(money(p.paidCents))}${p.status === 'stripe' ? `<br><span class="muted small">Stripe ${esc(money(p.stripeCents))}</span>` : ''}</td><td class="num">${p.owingCents ? `<b>${esc(money(p.owingCents))}</b>` : '<span class="muted">0</span>'}</td><td>${statusPill(p.status)}</td>
      <td><div class="jm-actions">${p.hasNotes ? `<button type="button" class="jm-icon" data-notes="${esc(p.rowId)}" title="Notes" aria-label="Notes for ${esc(p.player)}"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 4h9l4 4v12H6z"/><path d="M9 11h7M9 15h5"/></svg></button>` : ''}${p.status === 'session' ? `<button type="button" class="j-btn j-btn-line j-btn-sm jm-pink" data-sessions="${esc(p.rowId)}">Sessions${p.perSessionCents ? ` · ${esc(money(p.perSessionCents))}` : ''}</button>` : `<button type="button" class="j-btn j-btn-line j-btn-sm" data-record="${esc(p.rowId)}">Record payment</button>`}<button type="button" class="j-btn j-btn-ghost j-btn-sm" data-edit-row="${esc(p.rowId)}">Edit</button><button type="button" class="j-btn j-btn-ghost j-btn-sm jm-del" data-remove-row="${esc(p.rowId)}" aria-label="Remove ${esc(p.player)}">Remove</button></div></td></tr>`).join('') || '<tr><td colspan="7"><div class="j-empty">No players match.</div></td></tr>'
    $('m-count').textContent = `${list.length} of ${s.players.length} players${s.id ? ` at ${s.name}` : ''} · owing ${money(list.reduce((t, p) => t + p.owingCents, 0))}`
  }
  const setStatus = (v) => {
    f.status = v
    $('m-chips').querySelectorAll('[data-set-status]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.setStatus === f.status)))
    draw()
  }
  setHash()
  drawScope(!pre)
  draw()
  loadBank(bankUi, bankUi.redraw)
  bindSwitch(juniorsUi())
  bindShowing({ view, filter: f, render: () => renderMoney() })
  bindTip(view())
  $('m-locs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-mloc]')
    if (!b || b.dataset.mloc === f.loc) return
    f.loc = b.dataset.mloc
    $('m-locs').querySelectorAll('[data-mloc]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.mloc === f.loc)))
    setHash()
    drawScope(false)
    draw()
  })
  $('m-csv').addEventListener('click', () => downloadMoney(m, scope()))
  $('m-q').addEventListener('input', (e) => { f.q = e.target.value; draw() })
  view().querySelectorAll('[data-money-view]').forEach((b) => b.addEventListener('click', () => {
    f.view = b.dataset.moneyView
    view().querySelectorAll('[data-money-view]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.moneyView === f.view)))
    $('m-fams').hidden = f.view !== 'family'; $('m-table').hidden = f.view === 'family'
    draw()
  }))
  $('m-chips').addEventListener('click', (e) => { const b = e.target.closest('[data-set-status]'); if (b) setStatus(b.dataset.setStatus) })
  $('m-scope').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-set-status]')
    if (b) return setStatus(b.dataset.setStatus)
    const pr = e.target.closest('[data-pnm-row]')
    if (pr) return historyDrawer(pr.dataset.pnmRow)
    if (e.target.closest('#m-pnm-go')) { const d = $('m-pnm'); if (d) { d.open = true; P.moneyOpen?.add('m-pnm'); d.scrollIntoView?.({ behavior: 'smooth', block: 'start' }) } return }
    const all = e.target.closest('#m-record-all')
    if (!all) return
    // Recording runs for every venue, so the count is every venue's.
    const todo = m.players.filter((p) => p.status === 'stripe')
    const here = scope().players.filter((p) => p.status === 'stripe').length
    if (!(await confirmBox(`Record the Stripe payments for <b>${todo.length}</b> player${todo.length === 1 ? '' : 's'}${here !== todo.length ? ' (every venue)' : ''} in Airtable (Term 4 Players and the payment ledger)?`, { ok: 'Record' }))) return
    all.disabled = true
    const r2 = await post('recordStripeAll')
    if (!r2.ok) { all.disabled = false; return toast(r2.data.error) }
    toast(`Recorded ${r2.data.recorded} Stripe payment${r2.data.recorded === 1 ? '' : 's'}`); renderMoney()
  })
  $('m-rows').addEventListener('click', (e) => {
    const n = e.target.closest('[data-notes]'); if (n) { e.stopPropagation(); return notesModal(n.dataset.notes) }
    const rec = e.target.closest('[data-record]'); if (rec) { e.stopPropagation(); return recordModal(m.players.find((p) => p.rowId === rec.dataset.record)) }
    const ed = e.target.closest('[data-edit-row]'); if (ed) { e.stopPropagation(); return editPlayerModal(m.players.find((p) => p.rowId === ed.dataset.editRow)) }
    const ss = e.target.closest('[data-sessions]'); if (ss) { e.stopPropagation(); return sessionModal(m.players.find((p) => p.rowId === ss.dataset.sessions), { m, post, toast, confirmBox, modal, closeModal, done: () => { P.board = null; PL.at = 0; renderMoney() } }) }
    const rm = e.target.closest('[data-remove-row]'); if (rm) { e.stopPropagation(); const p = m.players.find((x) => x.rowId === rm.dataset.removeRow); return removeModal({ rowId: p.rowId, name: p.player, paymentStatus: p.airtableStatus }, null, () => renderMoney()) }
    const tr = e.target.closest('[data-row]'); if (tr) historyDrawer(tr.dataset.row)
  })
  $('m-add').addEventListener('click', async () => { PL.at = 0; await go('players'); plAddBox() })
  $('m-refresh').addEventListener('click', async (e) => {
    e.currentTarget.disabled = true
    const since = $('m-since').value
    if (since && since !== m.since) await post('saveSettings', { config: { moneySince: since } })
    const r2 = await post('money', { fresh: true, since })
    if (!r2.ok) return toast(r2.data.error)
    toast('Up to date with Stripe'); renderMoney()
  })
  $('m-unmatched').addEventListener('click', (e) => { const b = e.target.closest('[data-match]'); if (b) matchModal(m.unmatched.find((u) => u.id === b.dataset.match)) })
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

// bank: a line from Bank transfers to check, { item, rowIds: the family's rows }.
function recordModal(p, { stripe, bank } = {}) {
  if (bank) return bankRecordModal(p, bank)
  // Marked paid by hand, never in the ledger: record how it was paid instead
  // of adding it again (Nicholas Casella, A$800 cash, 12 Oct 2026).
  const existing = !stripe && p.unledgeredCents > 0 && !p.owingCents
  const owing = existing ? p.unledgeredCents : p.owingCents || Math.max(0, p.feeCents - p.paidCents) || p.feeCents
  const box = modal(`<h2 style="margin-bottom:4px">${stripe ? 'Record a Stripe payment' : 'Record a payment'}</h2><p class="muted small" style="margin-bottom:14px">${esc(p.player)} · paid ${esc(money(p.paidCents))} of ${p.feeCents ? esc(money(p.feeCents)) : 'no fee set'}</p>
    ${existing ? `<div class="j-box j-box-blue small" style="margin-bottom:12px"><b>${esc(money(p.unledgeredCents))} already shows as paid</b> but how it was paid is not recorded. Saving records the method and adds it to your Cash or Bank transfer totals. It does not add to what ${esc(p.player)} has paid.</div>` : ''}
    ${stripe ? `<div class="j-box j-box-blue small" style="margin-bottom:12px">Stripe, ${esc(new Date(stripe.at).toLocaleDateString('en-AU'))}: ${esc(money(stripe.cents - (stripe.refundedCents || 0)))} · ${esc(stripe.product)}</div>` : `
    <div class="j-two"><label class="j-field"><span>Amount (A$)</span><input class="j-input" id="rp-amt" inputmode="decimal" value="${owing ? (owing / 100).toFixed(2).replace(/\.00$/, '') : ''}"></label>
    <label class="j-field"><span>How they paid</span><select class="j-select" id="rp-how"><option>Bank transfer</option><option>Cash</option><option>Other</option></select></label></div>
    <div class="j-two"><label class="j-field"><span>Date received</span><input class="j-input" type="date" id="rp-date" value="${new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' })}"></label>
    <label class="j-field"><span>Note <span class="muted">(optional)</span></span><input class="j-input" id="rp-note" maxlength="200" placeholder="For example, paid at the session"></label></div>`}
    <p class="muted small">Updates Term 4 Players and adds a row to the payment ledger.</p>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px"><button type="button" class="j-btn j-btn-line" data-close>Cancel</button><button type="button" class="j-btn j-btn-dark" id="rp-go">Save</button></div>`)
  box.querySelector('#rp-go').addEventListener('click', async (e) => {
    const body = stripe ? { rowIds: [p.rowId], method: 'Stripe', stripeSessionId: stripe.id } : { existing, rowIds: [p.rowId], amountCents: Math.round(Number(box.querySelector('#rp-amt').value) * 100), method: box.querySelector('#rp-how').value, date: box.querySelector('#rp-date').value, note: box.querySelector('#rp-note').value.trim() }
    if (!stripe && !(body.amountCents > 0)) return toast('Enter the amount received.')
    // Hold the button: e.currentTarget is null once the handler has awaited.
    const btn = e.currentTarget
    btn.disabled = true
    const r = await post('recordPayment', body)
    btn.disabled = false
    if (!r.ok) return toast(r.data.error)
    closeModal(); closeDrawer(); toast(`Recorded. Airtable updated${r.data.ledger ? ' and the ledger has it' : ''}.`); P.board = null; PL.at = 0; if (P.tab === 'money') renderMoney()
  })
}

// A bank transfer onto one player, or onto brothers and sisters together. The
// amount and date are the bank's; the line's own id goes in the ledger, so it
// can never be recorded twice.
function bankRecordModal(p, { item, rowIds }) {
  const rows = [p, ...(P.money?.players || []).filter((x) => rowIds.includes(x.rowId) && x.rowId !== p.rowId)]
  const famOwing = rows.reduce((t, x) => t + (x.owingCents || 0), 0)
  // Ticked: the player picked, and the whole family when the amount is what they all owe.
  const all = rows.length > 1 && item.cents === famOwing
  const box = modal(`<h2 style="margin-bottom:4px">Record a bank transfer</h2>
    <div class="j-box j-box-blue small" style="margin:8px 0 12px">Bank, ${esc(new Date(`${item.date}T00:00:00`).toLocaleDateString('en-AU'))}: <b>${esc(money(item.cents))}</b> · ${esc(item.payer)}</div>
    ${rows.length > 1 ? '<p class="small" style="margin:0 0 6px">Who was it for?</p>' : ''}
    <div class="jm-bank-rows" id="bk-rows">${rows.map((x, i) => `<label class="jm-bank-row"><input type="checkbox" value="${esc(x.rowId)}" ${i === 0 || all ? 'checked' : ''} ${rows.length === 1 ? 'disabled' : ''}><span><b>${esc(x.player)}</b><small>${esc((x.group || '').replace(/, [^,]*$/, ''))} · owing ${esc(money(x.owingCents || 0))}</small></span></label>`).join('')}</div>
    <label class="j-field"><span>Note <span class="muted">(optional)</span></span><input class="j-input" id="bk-note" maxlength="200"></label>
    <p class="muted small">Updates Term 4 Players and adds a row to the payment ledger, as a bank transfer on ${esc(new Date(`${item.date}T00:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' }))}.</p>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px"><button type="button" class="j-btn j-btn-line" data-close>Cancel</button><button type="button" class="j-btn j-btn-dark" id="bk-go">Record ${esc(money(item.cents))}</button></div>`)
  box.querySelector('#bk-go').addEventListener('click', async (e) => {
    const ids = [...box.querySelectorAll('#bk-rows input:checked')].map((x) => x.value)
    if (!ids.length) return toast('Tick who it was for.')
    const btn = e.currentTarget
    btn.disabled = true
    const body = { rowIds: ids, amountCents: item.cents, method: 'Bank transfer', date: item.date, note: box.querySelector('#bk-note').value.trim(), externalId: item.id }
    let r = await post('recordPayment', body)
    btn.disabled = false
    // The other copy (Xero or the bank CSV) of a transfer already recorded: only if Lee says it is a different one.
    if (r.status === 409 && r.data.code === 'twin') {
      if (!(await confirmBox(`${esc(r.data.error)}`, { ok: "It's a different payment" }))) return
      r = await post('recordPayment', { ...body, confirmTwin: true })
    }
    if (!r.ok) return toast(r.data.error)
    bankDone(item.id)
    closeModal(); closeDrawer(); toast(`Recorded. Airtable updated${r.data.ledger ? ' and the ledger has it' : ''}.`); P.board = null; PL.at = 0; if (P.tab === 'money') renderMoney()
  })
}

// Search this term's players and pick one.
function pickPlayerModal(what, pick) {
  const box = modal(`<h2 style="margin-bottom:4px">Who was it for?</h2><p class="muted small" style="margin-bottom:12px">${esc(what)}</p>
    <label class="j-field"><span>Player or parent</span><input class="j-input" id="pk-q" placeholder="Type a name" autocomplete="off"></label>
    <div id="pk-res"></div>`, { wide: true })
  const res = box.querySelector('#pk-res')
  box.querySelector('#pk-q').addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase()
    const hits = q.length < 2 ? [] : P.money.players.filter((p) => `${p.player} ${p.parent} ${p.email}`.toLowerCase().includes(q)).slice(0, 8)
    res.innerHTML = hits.map((p) => `<button type="button" class="j-player" data-pick="${esc(p.rowId)}"><span><b>${esc(p.player)}</b><br><span class="muted small">${esc(p.parent || '')} · ${esc(p.group)} · owing ${esc(money(p.owingCents))}</span></span>${statusPill(p.status)}</button>`).join('') || (q.length < 2 ? '' : '<p class="muted small">No player matches.</p>')
  })
  res.addEventListener('click', (e) => {
    const b = e.target.closest('[data-pick]')
    if (b) pick(P.money.players.find((x) => x.rowId === b.dataset.pick))
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
    // Already marked paid by hand: only link the Stripe payment to the row.
    const r = await post('recordPayment', { rowIds: [p.rowId], method: 'Stripe', stripeSessionId: u.id, existing: p.unledgeredCents >= u.cents && !p.owingCents })
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
      ${p.stripe.length ? `<ul class="jm-hist">${p.stripe.map((s) => `<li><span>${esc(when(s.at))}<small>${esc(s.product)}${s.refundedCents ? ` · refunded ${esc(money(s.refundedCents))}` : ''}${s.payMethod ? ` · ${esc(methodName(s.payMethod))}` : ''} · ${s.feeCents == null ? 'Stripe fee still loading' : `Stripe fee ${esc(money(s.feeCents))}`}</small></span><span style="display:flex;gap:8px;align-items:center"><span class="amt">${esc(money(s.cents))}</span>${s.nextTerm ? '<span class="j-pill j-pill-blue" title="Paid for next term, not counted in this term">Next term</span>' : s.recorded ? '<span class="j-pill j-pill-green">In Airtable</span>' : `<button type="button" class="j-btn j-btn-line j-btn-sm" data-rec-stripe="${esc(s.id)}">Record</button>`}</span></li>`).join('')}</ul>` : '<p class="muted small">No Stripe payments from this email this term.</p>'}
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
    ${trialCards(d.trials || [])}
    ${d.sessions.length ? d.sessions.map((s) => {
      const date = P.coachDate[s.id] || s.nextDate
      return `<article class="j-card" style="padding:16px;margin-bottom:12px" data-sess="${esc(s.id)}">
        ${s.covering ? `<div class="j-box j-box-blue small" style="margin-bottom:8px"><b>Covering for ${esc(s.covering.for)}</b> on ${esc(s.covering.dateLabel)}</div>` : ''}
        ${(s.coveredBy || []).length ? `<div class="j-box j-box-grey small" style="margin-bottom:8px">${s.coveredBy.map((c) => `${esc(c.dateLabel)}: covered by <b>${esc(c.coach)}</b>`).join('<br>')}</div>` : ''}
        <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center"><div><h3 style="font-size:17px">${esc(s.day)} ${esc(s.time)} · ${esc(s.location)}</h3><p class="muted small">${esc(s.label)}${s.minAge != null ? ` · ages ${s.minAge} to ${s.maxAge}` : ''} · ${s.durationMin} min · ${s.players.length} player${s.players.length === 1 ? '' : 's'}</p></div>
          <select class="j-select" style="width:auto" data-date="${esc(s.id)}">${s.dates.map((x) => `<option value="${esc(x.iso)}" ${x.iso === date ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</select></div>
        <div style="margin-top:10px">${s.players.filter((p) => !p.trialDate || p.trialDate === date).map((p) => `<div class="jp-player" style="cursor:default">${avatar(p.photo, p.name, 32)}<span class="nm" style="flex:1 1 auto;min-width:0">${esc(p.name)}${p.age != null ? ` <span class="muted">(${esc(p.age)})</span>` : ''}${!p.mine ? ` <span class="muted small">· ${esc(p.coach)}</span>` : ''}${(s.cancelledBy?.[date] || {})[p.rowId] ? ` <span class="j-pill j-pill-amber" title="${esc(`${s.cancelledBy[date][p.rowId].reason}, ${s.cancelledBy[date][p.rowId].notice}`)}">Cancelled by parent</span>` : ''}${p.trial ? ' <span class="j-pill j-pill-blue">Trial</span>' : ''}${p.status !== 'Confirmed' ? ` <span class="j-pill j-pill-amber">${esc(p.status)}</span>` : ''}${noteLine(p, date)}</span>
          <span class="jp-att"><button type="button" class="p" data-att="Present" data-row="${esc(p.rowId)}" aria-pressed="${s.attendance[p.rowId] === 'Present'}">Here</button><button type="button" class="a" data-att="Absent" data-row="${esc(p.rowId)}" aria-pressed="${s.attendance[p.rowId] === 'Absent'}">Away</button></span></div>`).join('') || '<p class="muted small">No players yet.</p>'}</div>
      </article>`
    }).join('') : '<div class="j-empty">No sessions yet.</div>'}`
  $('c-pick')?.addEventListener('click', (e) => { const b = e.target.closest('[data-c]'); if (b) { P.coachId = b.dataset.c; renderCoach() } })
  view().querySelectorAll('[data-trial-fb]').forEach((b) => b.addEventListener('click', () => trialFeedbackModal((d.trials || []).find((t) => t.rowId === b.dataset.trialFb), d.verdicts)))
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

// Trials in this coach's sessions (Ligia, 13 Oct 2026): a reminder on the
// day, then a short form after it so Lee and Ligia hear how it went.
function trialCards(trials) {
  if (!trials.length) return ''
  const due = trials.filter((t) => t.due)
  const next = trials.filter((t) => t.upcoming)
  const done = trials.filter((t) => t.feedback)
  return `<section class="j-card" style="padding:16px;margin-bottom:14px;border-color:${due.length ? 'var(--j-amber)' : 'var(--j-line)'}">
    <h3 style="font-size:16px;margin-bottom:4px">Trial players</h3>
    <p class="muted small" style="margin-bottom:8px">Treat them like everyone else. After the session, tell Lee and Ligia how it went: they use it to offer the right group.</p>
    ${due.map((t) => `<div class="jp-player" style="cursor:default"><span class="nm"><b>${esc(t.name)}</b>${t.age != null ? ` <span class="muted">(${esc(t.age)})</span>` : ''} <span class="j-pill j-pill-blue">Trial</span><br><span class="muted small">${esc(t.dateLabel || 'Trial')} · ${esc(t.session)}</span></span><button type="button" class="j-btn j-btn-dark j-btn-sm" data-trial-fb="${esc(t.rowId)}">Give feedback</button></div>`).join('')}
    ${next.map((t) => `<div class="jp-player" style="cursor:default"><span class="nm"><b>${esc(t.name)}</b>${t.age != null ? ` <span class="muted">(${esc(t.age)})</span>` : ''} <span class="j-pill j-pill-blue">Trial</span><br><span class="muted small">Trialling ${esc(t.dateLabel)} · ${esc(t.session)}</span></span><span class="muted small">Feedback after the session</span></div>`).join('')}
    ${done.map((t) => `<div class="jp-player" style="cursor:default"><span class="nm">${esc(t.name)} <span class="j-pill j-pill-green">Feedback sent</span><br><span class="muted small">${esc(t.feedback.verdict)}, ${esc(new Date(t.feedback.at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }))}</span></span><button type="button" class="j-btn j-btn-ghost j-btn-sm" data-trial-fb="${esc(t.rowId)}">Update</button></div>`).join('')}
  </section>`
}
function trialFeedbackModal(t, verdicts = []) {
  if (!t) return
  let verdict = t.feedback?.verdict || ''
  const box = modal(`<h2 style="margin-bottom:2px">How did ${esc(t.name.split(' ')[0])}'s trial go?</h2>
    <p class="muted small" style="margin-bottom:14px">${esc(t.dateLabel || 'Trial')} · ${esc(t.session)}. Goes to Lee and Ligia, and onto ${esc(t.name.split(' ')[0])}'s player information.</p>
    <div class="j-field"><span>Overall</span><div class="j-chips" style="flex-wrap:wrap" id="tf-v">${verdicts.map((v) => `<button type="button" class="j-chip" data-v="${esc(v)}" aria-pressed="${v === verdict}">${esc(v)}</button>`).join('')}</div></div>
    <div class="j-two"><label class="j-field"><span>Level compared with the group</span><select class="j-select" id="tf-level"><option value="">Choose</option>${['Below the group', 'About right', 'Above the group'].map((x) => `<option>${x}</option>`).join('')}</select></label>
    <label class="j-field"><span>Best group for them <span class="muted">(optional)</span></span><input class="j-input" id="tf-best" placeholder="For example, Tue 5:25pm Belrose"></label></div>
    <label class="j-field"><span>Notes for Lee and Ligia</span><textarea class="j-textarea" id="tf-notes" rows="5" placeholder="Strengths, what to work on, attitude, anything they should know"></textarea></label>
    <p class="j-err" id="tf-err" hidden></p>
    <div style="display:flex;gap:8px;justify-content:flex-end"><button type="button" class="j-btn j-btn-line" data-close>Cancel</button><button type="button" class="j-btn j-btn-dark" id="tf-go">Send to Lee and Ligia</button></div>`, { wide: true })
  box.querySelector('#tf-v').addEventListener('click', (e) => { const b = e.target.closest('[data-v]'); if (!b) return; verdict = b.dataset.v; box.querySelectorAll('[data-v]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))) })
  box.querySelector('#tf-go').addEventListener('click', async (e) => {
    const err = box.querySelector('#tf-err'); err.hidden = true
    const btn = e.currentTarget; btn.disabled = true
    const r = await post('trialFeedback', { rowId: t.rowId, verdict, level: box.querySelector('#tf-level').value, best: box.querySelector('#tf-best').value.trim(), notes: box.querySelector('#tf-notes').value.trim() })
    btn.disabled = false
    if (!r.ok) { err.textContent = r.data.error || 'Could not send.'; err.hidden = false; return }
    closeModal(); toast('Sent to Lee and Ligia. Thank you.'); renderCoach()
  })
}

async function loadAttendance() { renderCoach() }

// ---------- cancellations: families who told us a player cannot make a session ----------

// New cancellations since this person last looked: a count on the tab and,
// for coaches, a banner on their pages until they open Cancellations.
async function checkCancelAlerts() {
  const r = await post('cancelAlerts')
  if (!r.ok) return
  const before = P.cxNew?.count || 0
  P.cxNew = r.data
  if (before !== r.data.count) renderNav()
  cancelBanner()
}
function cancelBanner() {
  document.querySelector('.jp-cx-banner')?.remove()
  const n = P.cxNew?.count || 0
  if (!n || P.user?.role === 'admin' || P.tab === 'cancellations') return
  const first = P.cxNew.latest[0]
  const box = document.createElement('div')
  box.className = 'j-box jp-cx-banner'
  box.innerHTML = `<span><b>${n === 1 ? 'A player cannot make a session' : `${n} new cancellations`}</b><br><span class="small">${P.cxNew.latest.slice(0, 3).map((c) => `${esc(c.player)}, ${esc(c.dateLabel)} ${esc(c.time)} (${esc(c.reason)}, ${esc(c.noticeLabel)})`).join('<br>')}${n > 3 ? '<br>and more' : ''}</span></span><button type="button" class="j-btn j-btn-dark j-btn-sm" data-tab="cancellations">See ${n === 1 ? 'it' : 'them'}</button>`
  view().prepend(box)
}

async function renderCancellations() {
  if (P.cxNew?.count) { P.cxNew = { count: 0, latest: [] }; renderNav() }
  const admin = P.user.role === 'admin'
  const when = P.cxWhen || 'upcoming'
  const d = await need(await post('cancellations', { when }))
  const sum = d.summary
  const noticePill = (c) => `<span class="j-pill j-pill-${c.noticeLevel === 'very-late' ? 'red' : c.noticeLevel === 'late' ? 'amber' : 'green'}">${esc(c.noticeLabel)}</span>`
  const submitted = (iso) => new Date(iso).toLocaleString('en-AU', { timeZone: 'Australia/Sydney', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
  view().innerHTML = `
    <div class="jp-head"><div><h1>Cancellations</h1><p class="muted small">${admin ? 'Every time a family tells us a player cannot make a session. The place stays held; this is only the heads up.' : 'Families who have told us a player in your groups cannot make a session. Newest first.'}</p></div></div>
    <div class="jp-kpis"><div class="jp-kpi"><span>Cancellations</span><b>${sum.total}</b></div><div class="jp-kpi"><span>Under 24 h notice</span><b>${sum.under24}</b></div><div class="jp-kpi"><span>Under 2 h notice</span><b>${sum.under2}</b></div><div class="jp-kpi"><span>Average notice</span><b>${sum.total ? `${sum.averageHours} h` : 'None yet'}</b></div><div class="jp-kpi"><span>Median notice</span><b>${sum.total ? `${sum.medianHours} h` : 'None yet'}</b></div></div>
    <div class="jp-seg" id="cx-f" style="margin:14px 0 10px">${[['upcoming', `Upcoming ${d.counts.upcoming}`], ['past', `Past ${d.counts.past}`], ['all', `All ${d.counts.all}`]].map(([v, l]) => `<button type="button" data-f="${v}" aria-pressed="${when === v}">${l}</button>`).join('')}</div>
    ${d.cancellations.length ? `<div class="jp-scroll"><table class="jp-table"><thead><tr><th>Player</th><th>Session</th><th>Coach</th><th>Reason</th><th>Notice</th><th>Sent</th></tr></thead><tbody>
      ${d.cancellations.map((c) => `<tr><td><b>${esc(c.player)}</b>${c.status === 'withdrawn' ? ' <span class="j-pill j-pill-grey">Withdrawn</span>' : ''}${admin && c.parentName ? `<br><span class="muted small">${esc(c.parentName)} · ${esc(c.email)}</span>` : ''}</td>
        <td><b>${esc(c.dateLabel)}</b><br><span class="muted small">${esc(c.group)} · ${esc(c.location)}</span></td>
        <td>${c.coaches.length ? esc(c.coaches.map((x) => x.replace(/^Coach /, '')).join(', ')) : '<span class="muted">None</span>'}</td>
        <td>${esc(c.reason)}${c.note ? `<br><span class="muted small">${esc(c.note)}</span>` : ''}</td>
        <td>${c.status === 'withdrawn' ? '<span class="muted">Withdrawn</span>' : noticePill(c)}${admin && c.notFullySent?.length ? `<br><span class="j-pill j-pill-red" title="These emails did not go">Not sent: ${esc(c.notFullySent.join(', '))}</span>` : ''}</td>
        <td class="muted small">${esc(submitted(c.submittedAt))}</td></tr>`).join('')}
    </tbody></table></div>` : `<div class="j-empty">${when === 'upcoming' ? 'No upcoming cancellations.' : when === 'past' ? 'No past cancellations.' : 'No cancellations yet.'}</div>`}`
  $('cx-f').addEventListener('click', (e) => { const b = e.target.closest('[data-f]'); if (b) { P.cxWhen = b.dataset.f; renderCancellations() } })
}

// ---------- current families: invite to their account ----------

const FM = { mode: 'account' }
async function renderFamilies() {
  const d = await need(await post('familyInvites'))
  const acct = FM.mode === 'account'
  const kind = { pay: ['amber', 'To pay'], paid: ['green', 'Paid'], noPrice: ['red', 'Needs a price first'] }
  const signed = d.list.filter((f) => f.signedInAt).length
  const when = (iso) => new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
  const canTick = (f) => (acct ? !f.signedInAt : f.kind !== 'noPrice')
  const done = (f) => (acct ? f.accountInvitedAt : f.invitedAt)
  view().innerHTML = `<div class="jp-head"><div><h1>Account invites</h1><p class="muted small">Every Term 4 family, grouped under the parent's email. Their account already exists: they only need to sign in once with that email.</p></div></div>
    <div class="jp-seg" id="fm-mode" style="margin-bottom:12px"><button type="button" data-m="account" aria-pressed="${acct}">Sign-in invite, no money (everyone)</button><button type="button" data-m="pay" aria-pressed="${!acct}">With a payment link (families who owe)</button></div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">
      <span class="j-pill j-pill-grey">${d.list.length} families</span>
      <span class="j-pill j-pill-green">${signed} signed in</span>
      <span class="j-pill j-pill-amber">${d.list.length - signed} not signed in yet</span>
      <span class="j-pill j-pill-grey">${d.list.filter(done).length} already sent this invite</span>
      ${acct ? '' : `<span class="j-pill j-pill-red">${d.list.filter((f) => f.kind === 'noPrice').length} need a price</span>`}
      ${d.noEmail.length ? `<span class="j-pill j-pill-red">${d.noEmail.length} players with no email</span>` : ''}
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
      <button type="button" class="j-btn j-btn-line" id="fm-back">Back to players</button>
      <button type="button" class="j-btn j-btn-line" id="fm-prev">Show the email</button>
      <button type="button" class="j-btn j-btn-dark" id="fm-send">Send to selected</button>
    </div>
    <div id="fm-result" role="status"></div>
    <div id="fm-preview" hidden></div>
    <div class="jp-scroll"><table class="jp-table"><thead><tr><th><input type="checkbox" id="fm-all" aria-label="Select all"></th><th>Parent</th><th>Players</th><th>Signed in</th><th>${acct ? 'Invite sent' : 'Payment'}</th></tr></thead><tbody>
    ${d.list.map((f) => `<tr><td><input type="checkbox" data-fm="${esc(f.email)}" ${canTick(f) ? '' : 'disabled'}></td><td><b>${f.self ? 'The player' : esc(f.parent || 'No parent name')}</b>${f.self ? ' <span class="j-pill j-pill-grey">Own contact</span>' : ''}<br><span class="muted small">${esc(f.email)}</span></td><td class="small">${f.players.map((x) => `${esc(x.name)} <span class="muted">${esc(x.group || '')}</span>`).join('<br>')}</td>
      <td>${f.signedInAt ? `<span class="j-pill j-pill-green">Yes, ${esc(when(f.signedInAt))}</span>` : '<span class="j-pill j-pill-amber">Not yet</span>'}</td>
      <td class="small">${acct ? (f.accountInvitedAt ? esc(when(f.accountInvitedAt)) : '<span class="muted">Not sent</span>') : `<span class="j-pill j-pill-${kind[f.kind][0]}">${kind[f.kind][1]}${f.kind === 'pay' ? ` ${esc(money(f.owingCents))}` : ''}</span>${f.invitedAt ? `<br><span class="muted">Sent ${esc(when(f.invitedAt))}</span>` : ''}`}</td></tr>`).join('')}
    </tbody></table></div>
    ${d.noEmail.length ? `<p class="muted small" style="margin-top:8px">No parent email in Airtable, so no invite: ${esc(d.noEmail.map((x) => x.name).join(', '))}.</p>` : ''}`
  $('fm-back').addEventListener('click', () => renderPlayers())
  view().querySelectorAll('#fm-mode [data-m]').forEach((b) => b.addEventListener('click', () => { FM.mode = b.dataset.m; renderFamilies() }))
  const boxes = () => [...view().querySelectorAll('[data-fm]')]
  $('fm-all').addEventListener('change', (e) => boxes().forEach((b) => { if (!b.disabled) b.checked = e.target.checked && !done(d.list.find((f) => f.email === b.dataset.fm) || {}) }))
  $('fm-prev').addEventListener('click', () => {
    const el = $('fm-preview')
    el.hidden = !el.hidden
    const keys = acct ? ['account'] : ['pay', 'paid']
    const label = { account: 'Sign-in invite', pay: 'Owes money', paid: 'Already paid' }
    el.innerHTML = keys.filter((k) => d.previews[k]).map((k) => `<div class="j-card" style="padding:12px;margin-bottom:12px"><p class="small"><b>${label[k]}</b> · Subject: ${esc(d.previews[k].subject)}</p><iframe title="Email preview" style="width:100%;height:560px;border:1px solid var(--j-line);border-radius:10px;background:#fff" srcdoc="${esc(d.previews[k].html)}"></iframe></div>`).join('')
  })
  $('fm-send').addEventListener('click', async (e) => {
    // Read the button before any await: the browser clears currentTarget once
    // the click is handled, which made Send do nothing after the confirm.
    const btn = e.currentTarget
    const emails = boxes().filter((b) => b.checked).map((b) => b.dataset.fm)
    if (!emails.length) return toast('Tick the families to email.')
    const again = emails.filter((x) => done(d.list.find((f) => f.email === x) || {})).length
    if (!(await confirmBox(`Email <b>${emails.length}</b> parent${emails.length === 1 ? '' : 's'} now?${again ? ` ${again} already had it and will get it again.` : ''} ${acct ? 'A sign-in invite with no amounts in it. Anyone already signed in is skipped.' : 'Anyone who owes gets a payment link.'}`, { ok: 'Send' }))) return
    btn.disabled = true
    const sent = [], failed = [], skipped = []
    let stopped = ''
    for (let i = 0; i < emails.length; i += 20) {
      btn.textContent = `Sending ${Math.min(i + 20, emails.length)} of ${emails.length}`
      const r = await post('familyInvites', { send: true, mode: acct ? 'account' : 'pay', emails: emails.slice(i, i + 20), resend: again > 0 })
      if (!r.ok) { stopped = r.data.error || 'Sending stopped. Nothing is lost: try again.'; break }
      sent.push(...r.data.sent)
      failed.push(...r.data.failed.map((e) => ({ email: e, why: r.data.errors?.[e] || 'It did not send.' })))
      skipped.push(...(r.data.skipped || []))
    }
    toast(`Sent ${sent.length}${failed.length ? `, ${failed.length} failed` : ''}${skipped.length ? `, ${skipped.length} skipped` : ''}`)
    await renderFamilies()
    // Every family ticked gets an answer: sent, failed (why) or skipped (why).
    const famOf = (em) => d.list.find((f) => f.email === em)
    const li = (x, cls) => `<li><span><b>${esc(x.email)}</b>${x.why ? `<small>${esc(x.why)}</small>` : ''}</span><span style="display:flex;gap:6px;align-items:center">${acct && famOf(x.email)?.mobile ? `<button type="button" class="j-btn j-btn-line j-btn-sm" data-fm-text="${esc(x.email)}">Text</button>` : ''}<span class="j-pill j-pill-${cls}">${cls === 'green' ? 'Sent' : cls === 'red' ? 'Failed' : 'Skipped'}</span></span></li>`
    $('fm-result').innerHTML = `<div class="j-box ${failed.length || stopped ? 'j-box-red' : 'j-box-green'}" style="margin-bottom:12px"><b>Sent to ${sent.length} of ${emails.length}</b>${stopped ? `<p class="small">${esc(stopped)}</p>` : ''}<ul class="jm-hist">${[...failed.map((x) => li(x, 'red')), ...skipped.map((x) => li(x, 'amber')), ...sent.map((e) => li({ email: e }, 'green'))].join('')}</ul></div>`
    $('fm-result').querySelectorAll('[data-fm-text]').forEach((b) => b.addEventListener('click', () => {
      const f = famOf(b.dataset.fmText)
      if (f) textComposer({ modal, toast, rowIds: f.players.map((x) => x.rowId), parent: f.parent, mobile: f.mobile, text: inviteText({ parent: f.parent, player: f.players[0]?.name, email: f.email, self: f.self }), title: f.self ? `Text ${f.players[0]?.name.split(' ')[0]}` : 'Text the family', self: f.self, to: f.self ? f.players[0]?.name : '' })
    }))
  })
}

// ---------- Players: search, filters, a full record, and adding one ----------

const PL = { q: '', status: '', group: '', coach: '', waiver: '', place: '', level: '', pos: '', data: null, at: 0 }

function plMatch(p) {
  const q = PL.q.trim().toLowerCase()
  if (q && ![p.name, p.parent, p.email, p.phone, p.groupLabel, p.coach].some((v) => String(v || '').toLowerCase().includes(q))) return false
  if (PL.status === 'paid' && p.paymentStatus !== 'Paid') return false
  if (PL.status === 'unpaid' && p.paymentStatus === 'Paid') return false
  if (PL.status === 'noprice' && p.feeAud != null) return false
  if (PL.group && p.groupId !== PL.group) return false
  if (PL.coach && p.coachId !== PL.coach) return false
  if (PL.waiver === 'yes' && !p.waiver.onFile) return false
  if (PL.waiver === 'no' && p.waiver.onFile) return false
  if (PL.place === 'in' && !p.inGroup) return false
  if (PL.place === 'out' && p.inGroup) return false
  if (PL.level === 'none' && p.profile?.level) return false
  if (PL.level && PL.level !== 'none' && p.profile?.level !== PL.level) return false
  if (PL.pos && !(p.profile?.positions || []).includes(PL.pos)) return false
  return true
}

// ---------- player information: club, level, positions, contacts ----------
// Saved in Airtable "JFP Player Profiles". Families update the same row from
// My account, so what they change shows here (Lee, 13 Oct 2026).
const PROFILE_OPTIONS = {
  levels: ['A-League academy', 'NPL', 'Youth league (BYL or GYL)', 'JDL (was SAP)', 'Club Division 1', 'Club Division 2', 'Club Division 3 or lower', 'School or social only', 'Not playing club football'],
  positions: ['Goalkeeper', 'Centre back', 'Full back', 'Defensive midfield', 'Central midfield', 'Attacking midfield', 'Winger', 'Striker'],
}
const POS_SHORT = { Goalkeeper: 'GK', 'Centre back': 'CB', 'Full back': 'FB', 'Defensive midfield': 'DM', 'Central midfield': 'CM', 'Attacking midfield': 'AM', Winger: 'W', Striker: 'ST' }

function footballCell(p) {
  const f = p.profile || {}
  const top = [p.club, f.team].filter(Boolean).join(' · ')
  const sub = [f.level, (f.positions || []).map((x) => POS_SHORT[x] || x).join('/'), f.foot ? `${f.foot} foot` : ''].filter(Boolean).join(' · ')
  if (!top && !sub) return '<span class="muted small">Not on file</span>'
  return `${esc(top || 'Club not on file')}${sub ? `<br><span class="muted small">${esc(sub)}</span>` : ''}${f.updatedFrom === 'Family account' ? '<br><span class="j-pill j-pill-blue" title="Updated by the family in My account">From family</span>' : ''}`
}

// One window to fix anything about a player: the Term 4 row (name, contact,
// email, mobile, own contact, payment) and their player information. Saves to Airtable.
async function plEdit(p) {
  const r = await post('getProfile', { rowId: p.rowId })
  if (!r.ok) return toast(r.data.error || 'Could not load the player.')
  const d = r.data
  const v = { ...d.prefill, ...(d.profile || {}) }
  const opts = d.options || PROFILE_OPTIONS
  if (opts.clubs) P.clubs = opts.clubs
  const pr = await pricing().catch(() => null)
  const types = d.row.paymentTypes || []
  const per = d.row.perSessionCents ? (d.row.perSessionCents / 100).toFixed(2).replace(/\.00$/, '') : ''
  const box = modal(`<h2 style="margin-bottom:2px">Edit ${esc(d.row.name)}</h2>
    <p class="muted small" style="margin-bottom:14px">${d.profile ? `Player information last updated ${esc(new Date(d.profile.updatedAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }))} by ${esc(d.profile.updatedBy || 'staff')}.` : 'No player information saved yet. Anything from their waiver is filled in for you to check.'} Saves to Airtable.</p>
    ${playerFormHtml('pe', { row: d.row, v, opts })}
    <details class="jq-fold jpf-fold" id="pe-payfold"><summary>Payment: ${esc(d.row.paymentType || 'type not set')}${d.row.feeAud != null ? `, fee ${esc(money0(d.row.feeAud))}` : ''}</summary>
      <label class="j-field"><span>Payment type</span><select class="j-select" id="pe-type"><option value="">Not set</option>${types.map((t) => `<option ${t === d.row.paymentType ? 'selected' : ''}>${esc(t)}</option>`).join('')}${d.row.paymentType && !types.includes(d.row.paymentType) ? `<option selected>${esc(d.row.paymentType)}</option>` : ''}</select></label>
      <p class="muted small" style="margin-top:-6px">Session by session and Pro sessions: they can pay for sessions from their account (the next session at their price, or more ahead), and sessions you bill from Money show there too. A term fee with no link: they can pay from their account. Pro sessions money shows under Pro sessions, not JFP term income.</p>
      <label class="j-field" id="pe-per-wrap"><span>Price per session (A$) <span class="muted">(session by session and Pro sessions)</span></span><input class="j-input" id="pe-per" inputmode="decimal" value="${esc(per)}" placeholder="e.g. 80"></label>
      <div class="j-two"><label class="j-field"><span>Term 4 fee (A$)</span><input class="j-input" id="pe-fee" inputmode="decimal" value="${esc(d.row.feeAud ?? '')}"></label>
      <label class="j-field"><span>Set the fee from a price <span class="muted">(optional)</span></span><select class="j-select" id="pe-price"><option value="">Choose a price</option>${pr ? `<optgroup label="JFP price list">${(pr.products || []).map((x) => `<option value="${x.cents}" data-type="${esc(x.type)}">${esc(x.label)} · ${esc(money(x.cents))}</option>`).join('')}</optgroup>${customPrices(pr).map((x) => `<option value="${x.cents}" data-type="${x.programme === 'pro' ? 'JFP Pro sessions' : ''}" data-per="${x.perSession ? '1' : ''}">${esc(x.name)} · ${esc(x.amountLabel || money(x.cents))}${x.perSession ? ' a session' : ''}</option>`).join('')}` : ''}</select></label></div>
      ${d.row.paidAud ? `<p class="muted small">Paid so far: ${esc(money0(d.row.paidAud))}.</p>` : ''}
    </details>
    <p class="j-err" id="pe-err" hidden></p>
    <div class="jpf-acts"><button type="button" class="j-btn j-btn-line" data-close>Cancel</button><button type="button" class="j-btn j-btn-dark" id="pe-save">Save</button></div>`, { wide: true })
  const form = wirePlayerForm(box, 'pe')
  const typeWatch = () => { box.querySelector('#pe-per-wrap').hidden = !/session by session|pro session/i.test(box.querySelector('#pe-type').value) }
  box.querySelector('#pe-type').addEventListener('change', typeWatch)
  box.querySelector('#pe-price').addEventListener('change', (e) => {
    const o = e.target.selectedOptions[0]
    if (!o?.value) return
    const c = Number(o.value)
    if (o.dataset.per) { if (o.dataset.type) box.querySelector('#pe-type').value = o.dataset.type; else box.querySelector('#pe-type').value = 'JFP Session by session'; box.querySelector('#pe-per').value = (c / 100).toFixed(2).replace(/\.00$/, '') }
    else { box.querySelector('#pe-fee').value = (c / 100).toFixed(2).replace(/\.00$/, ''); if (o.dataset.type) box.querySelector('#pe-type').value = o.dataset.type }
    typeWatch()
  })
  typeWatch()
  box.querySelector('#pe-save').addEventListener('click', async (e) => {
    const btn = e.currentTarget
    if (btn.disabled) return
    const err = box.querySelector('#pe-err'); err.hidden = true
    const f = form.read()
    const changed = Object.fromEntries(Object.entries(f.row).filter(([k, x]) => x !== (d.row[k] || '')))
    // Own contact keeps any parent name already in Airtable (untick to bring it back).
    if (f.ownContact) delete changed.parent
    if (f.ownContact !== (d.row.ownContact === true)) changed.ownContact = f.ownContact
    const type = box.querySelector('#pe-type').value
    if (type !== (d.row.paymentType || '')) changed.paymentType = type
    const fee = box.querySelector('#pe-fee').value.trim().replace(/[a$,\s]/gi, '')
    if (fee !== String(d.row.feeAud ?? '')) changed.feeAud = fee === '' ? null : Number(fee)
    const perNow = box.querySelector('#pe-per').value.trim().replace(/[a$,\s]/gi, '')
    if (perNow !== per) changed.perSessionAud = perNow === '' ? null : Number(perNow)
    btn.disabled = true; btn.textContent = 'Saving'
    if (Object.keys(changed).length) {
      const a = await post('editPlayer', { rowId: p.rowId, fields: changed })
      if (!a.ok) { btn.disabled = false; btn.textContent = 'Save'; err.textContent = a.data.error || 'Could not save.'; err.hidden = false; return }
    }
    const b = await post('saveProfile', { rowId: p.rowId, values: f.values })
    btn.disabled = false; btn.textContent = 'Save'
    if (!b.ok) { err.textContent = b.data.error || 'Could not save.'; err.hidden = false; return }
    closeModal(); toast('Saved to Airtable'); P.board = null; PL.at = 0; if (P.tab === 'families') renderPlayers()
  })
}

const money0 = (n) => (n == null ? '' : `A$${Number(n).toLocaleString('en-AU')}`)

function plRow(p) {
  return `<tr data-pl="${esc(p.rowId)}" style="cursor:pointer">
    <td><div style="display:flex;gap:10px;align-items:center">${avatar(p.profile?.photo, p.name, 34)}<div><b>${esc(p.name)}</b>${p.age != null ? ` <span class="muted small">(${esc(p.age)})</span>` : ''}${p.pro ? ' <span class="j-pill j-pill-pink">Pro</span>' : ''}<br><span class="muted small">${p.ownContact ? 'Own contact' : esc(p.parent || 'no parent name')}</span></div></div></td>
    <td>${p.inGroup ? esc(p.groupLabel) : '<span class="j-pill j-pill-red">Not in a group</span>'}<br><span class="muted small">${esc(p.coach || '')}</span></td>
    <td>${payPill(p)}${p.feeAud != null ? `<br><span class="muted small">${esc(money0(p.feeAud))}${p.balanceAud ? `, ${esc(money0(p.balanceAud))} owing` : ''}</span>` : ''}</td>
    <td>${footballCell(p)}</td>
    <td>${p.waiver.onFile ? '<span class="j-pill j-pill-green">Waiver</span>' : '<span class="j-pill j-pill-red">No waiver</span>'}</td>
    <td class="muted small">${esc(p.email || 'no email')}</td>
    <td><button type="button" class="j-btn j-btn-line j-btn-sm" data-pl-edit="${esc(p.rowId)}">Edit</button></td>
  </tr>`
}

function plDetail(p) {
  const w = contactWords({ self: p.ownContact, players: [p.name], parent: p.parent })
  const row = (k, v) => (v ? `<div class="j-kv"><span>${esc(k)}</span><span>${esc(v)}</span></div>` : '')
  const born = p.dob ? new Date(`${p.dob}T00:00:00Z`).toLocaleDateString('en-AU', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' }) : ''
  modal(`<div style="display:flex;gap:14px;align-items:center;margin-bottom:14px">${avatar(p.profile?.photo, p.name, 64)}<div><h2 style="margin-bottom:2px">${esc(p.name)}</h2>
    <p class="muted small">${p.age != null ? `Age ${esc(p.age)}` : 'Age not on file'}${born ? ` · born ${esc(born)}` : ''}${p.club ? ` · ${esc(p.club)}` : ''}</p></div></div>
    <h3>Player</h3>
    ${row('Full name', p.name)}
    ${row('Age', p.age != null ? `${p.age} (today, from the date of birth)` : 'not on file: add a date of birth')}
    ${row('Date of birth', born || 'not on file')}
    <h3 style="margin-top:14px">Football</h3>
    ${row('Club', p.club || 'not on file')}
    ${row('Team', p.profile?.team)}
    ${row('Level', p.profile?.level)}
    ${row('Plays', p.profile?.playingUp)}
    ${row('Positions', (p.profile?.positions || []).join(', '))}
    ${row('Stronger foot', p.profile?.foot)}
    ${row('Association', p.profile?.association)}
    ${row('Years playing', p.profile?.yearsPlaying)}
    ${row('Rep or academy', p.profile?.repTeam)}
    ${p.profile?.updatedAt ? row('Updated', `${new Date(p.profile.updatedAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}${p.profile.updatedFrom === 'Family account' ? ' by the family' : ''}`) : ''}
    ${p.trial ? `<h3 style="margin-top:14px">Trial</h3>
    ${row('Trial date', p.trialDate || 'not set')}
    ${p.trialFeedback ? `${row('Coach said', `${p.trialFeedback.verdict}${p.trialFeedback.level ? `, level ${p.trialFeedback.level.toLowerCase()}` : ''}${p.trialFeedback.best ? `, best group: ${p.trialFeedback.best}` : ''}`)}${row('From', `Coach ${p.trialFeedback.byName}, ${new Date(p.trialFeedback.at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}`)}<p class="small" style="white-space:pre-wrap;margin:6px 0 0">${esc(p.trialFeedback.notes)}</p>` : row('Coach feedback', 'not in yet (the coach is asked after the trial)')}` : ''}
    <h3 style="margin-top:14px">Session</h3>
    ${row('Group', p.inGroup ? p.groupLabel : 'Not in a group')}
    ${row('Coach', p.coach)}
    ${row('In Airtable as', [p.day, p.time, p.location].filter(Boolean).join(' ') || 'no session set')}
    ${row('Confirmation', p.confirmation)}
    <h3 style="margin-top:14px">Money</h3>
    ${row('Fee', p.feeAud == null ? 'no fee set' : money0(p.feeAud))}
    ${row('Paid', money0(p.paidAud))}
    ${row('Balance', money0(p.balanceAud))}
    ${row('Status', p.paymentStatus)}
    ${row('Type', p.paymentType)}
    <h3 style="margin-top:14px">${p.ownContact ? 'Contact (the player)' : 'Family'}</h3>
    ${p.ownContact ? row('Contact', 'The player is their own contact') : row('Parent', p.parent)}
    ${row('Email', p.email || 'no email')}
    ${row('Mobile', p.phone)}
    <div class="jpf-acts jpf-acts-left"><button type="button" class="j-btn j-btn-line" id="pd-invite" ${p.email ? '' : 'disabled title="No email on this player"'}>Account invite</button></div>
    <p class="small" id="pd-invite-out" role="status" hidden></p>
    <h3 style="margin-top:14px">Emails</h3>
    <div id="pd-emails" class="jpf-emails"><p class="muted small">Checking the email log…</p></div>
    <h3 style="margin-top:14px">Paperwork</h3>
    ${row('Waiver', p.waiver.onFile ? `On file${waiverKindLabel(p.waiver.kind)}${p.waiver.term ? `, ${p.waiver.term}` : ''}${p.waiver.signedDate ? `, signed ${p.waiver.signedDate}` : ''}${p.waiver.spelling ? `, signed as "${p.waiver.spelling}"` : ''}` : 'Not signed (no waiver in Airtable for this player)')}
    ${row('Playing kit', p.kit || 'not confirmed')}
    ${p.notes ? `<h3 style="margin-top:14px">Notes</h3><p class="small" style="white-space:pre-wrap;max-height:220px;overflow:auto">${esc(p.notes)}</p>` : ''}
    <div class="jpf-acts"><button type="button" class="j-btn j-btn-line" data-close>Close</button><button type="button" class="j-btn j-btn-line" id="pd-text">${esc(w.textWho)}</button><button type="button" class="j-btn j-btn-dark" id="pd-edit">Edit</button></div>`, { wide: true })
  $('pd-edit')?.addEventListener('click', () => { closeModal(); plEdit(p) })
  $('pd-text')?.addEventListener('click', () => { closeModal(); textComposer({ modal, toast, rowIds: [p.rowId], parent: p.parent, mobile: p.phone, text: helloText({ parent: p.parent, player: p.name, self: w.self }), title: w.textWho, self: w.self, to: w.self ? p.name : '' }) })
  $('pd-invite')?.addEventListener('click', (e) => sendAccountInviteFor(p, e.currentTarget))
  loadEmailLog(p.rowId)
}

// The account invite for one player, held place or not (Lee, 13 Oct 2026:
// "account invite did nothing"). Always says what happened.
async function sendAccountInviteFor(p, btn) {
  const out = $('pd-invite-out')
  btn.disabled = true
  const was = btn.textContent
  btn.textContent = 'Sending'
  const r = await post('inviteAccount', { rowId: p.rowId })
  btn.textContent = was
  btn.disabled = false
  if (out) {
    out.hidden = false
    out.className = `small j-box ${r.ok ? 'j-box-green' : 'j-box-red'}`
    out.textContent = r.ok ? `Sent to ${r.data.sentTo}.${r.data.signedInBefore ? ' They have signed in before, so they know the way.' : ''}` : (r.data.error || 'Not sent. Try again.')
    // Text them the same, from 0404 780 351 or your own phone (Lee, 13 Oct 2026).
    if (p.phone) {
      const tb = document.createElement('button')
      tb.type = 'button'
      tb.className = 'j-btn j-btn-line j-btn-sm'
      tb.style.marginLeft = '8px'
      tb.textContent = r.ok ? 'Text them too' : 'Text the invite instead'
      tb.addEventListener('click', () => { const self = Boolean(p.ownContact); closeModal(); textComposer({ modal, toast, rowIds: [p.rowId], parent: p.parent, mobile: p.phone, text: inviteText({ parent: p.parent, player: p.name, email: p.email, self }), title: self ? `Text ${p.name.split(' ')[0]}` : 'Text the family', self, to: self ? p.name : '' }) })
      out.append(tb)
    }
  }
  toast(r.ok ? `Sent to ${r.data.sentTo}` : (r.data.error || 'Not sent.'))
  loadEmailLog(p.rowId)
}

// The Emails check on the player: the last emails to this player or family,
// from our own send log, with Brevo's message id when it gave one.
const EMAIL_WHEN = (iso) => new Date(iso).toLocaleString('en-AU', { timeZone: 'Australia/Sydney', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
async function loadEmailLog(rowId) {
  const r = await post('emailLog', { rowId })
  const el = $('pd-emails')
  if (!el) return
  if (!r.ok) { el.innerHTML = `<p class="small j-err">${esc(r.data.error || 'Could not read the email log.')}</p>`; return }
  const list = r.data.emails || []
  el.innerHTML = list.length
    ? `<ul class="jm-hist">${list.map((e) => `<li><span><b>${esc(e.subject)}</b><small>${esc(EMAIL_WHEN(e.at))} · to ${esc(e.to.join(', '))}${e.kind ? ` · ${esc(e.kind)}` : ''}${e.messageId ? ` · Brevo ${esc(e.messageId.replace(/^<|>$/g, '').slice(0, 40))}` : ''}${e.error ? `<br>${esc(e.error)}` : ''}</small></span><span class="j-pill j-pill-${e.status === 'sent' ? 'green' : 'red'}">${e.status === 'sent' ? 'Sent' : 'Failed'}</span></li>`).join('')}</ul>`
    : `<p class="muted small">No emails in our log for ${esc((r.data.addresses || []).join(', ') || 'this player')} yet. The log started on 13 Oct 2026.</p>`
}

// Open one player's full record by row id (the "already added" link).
async function openPlayerRecord(rowId) {
  if (!PL.data) PL.data = await need(await post('playersList', { fresh: true }))
  let p = PL.data.players.find((x) => x.rowId === rowId)
  if (!p) { PL.data = await need(await post('playersList', { fresh: true })); PL.at = Date.now(); p = PL.data.players.find((x) => x.rowId === rowId) }
  if (p) plDetail(p); else toast('That player is not in the list any more.')
}

// The Players tab add (no group): the same details as Edit and the Timetable
// add, the payment, and an email (sign-in invite, or the payment link).
async function plAddBox() {
  const pr = await pricing()
  const box = modal(`<h2 style="margin-bottom:4px">Add a player</h2>
    <p class="muted small" style="margin-bottom:12px">Writes a row to Term 4 Players in Airtable with no session, and their player information. They hold no place and take no capacity until you put them in a group on the Timetable.</p>
    ${playerFormHtml('pa', { add: true, opts: { clubs: P.clubs || [] } })}
    ${noGroupPaymentHtml('pa', pr)}
    <label class="j-check"><input type="checkbox" id="pa-send"> <span id="pa-send-l"></span></label>
    <p class="j-err" id="pa-err" hidden></p>
    <div class="jpf-acts"><button type="button" class="j-btn j-btn-line" data-close>Cancel</button><button type="button" class="j-btn j-btn-dark" id="pa-go">Add player</button></div>`, { wide: true })
  let words = contactWords({})
  let pay = 'none'
  const relabel = () => {
    const send = box.querySelector('#pa-send').checked
    box.querySelector('#pa-send-l').textContent = pay === 'link'
      ? `Email the payment link to ${words.self ? words.contact : 'the family'} now`
      : `Email ${words.self ? words.contact : 'the family'} a sign-in invite now (no amounts in it)`
    const go = box.querySelector('#pa-go')
    if (!go.disabled) go.textContent = send ? (pay === 'link' ? 'Add and email payment link' : words.addAndEmail) : pay === 'link' ? 'Add and make link' : 'Add player'
  }
  const form = wirePlayerForm(box, 'pa', { onChange: (w) => { words = w; relabel() } })
  const readPay = wireNoGroupPayment(box, 'pa', pr, { onChange: (v) => { pay = v; relabel() } })
  box.querySelector('#pa-prod').addEventListener('change', (e) => {
    const p = customPrices(pr).find((x) => `price:${x.id}` === e.target.value)
    if (p?.perSession) { box.querySelector('#pa-pay').value = p.programme === 'pro' ? 'pro' : 'sessions'; box.querySelector('#pa-per').value = (p.cents / 100).toFixed(2).replace(/\.00$/, ''); box.querySelector('#pa-pay').dispatchEvent(new Event('change')) }
  })
  box.querySelector('#pa-send').addEventListener('change', relabel)
  relabel()
  let busy = false
  const send = async (force = false) => {
    if (busy) return
    const err = box.querySelector('#pa-err'); err.hidden = true
    const f = form.read()
    if (f.row.name.length < 3) { err.textContent = "Enter the player's full name."; err.hidden = false; return }
    const payBody = readPay()
    if (payBody.error) { err.textContent = payBody.error; err.hidden = false; return }
    const btn = box.querySelector('#pa-go')
    const label = btn.textContent
    // Double-add safety: off until the server answers.
    busy = true; btn.disabled = true; btn.textContent = 'Adding'
    const r = await post('addPlayerNoGroup', {
      player: { name: f.row.name, dob: f.values.dob }, parent: { name: f.row.parent, email: f.row.email, mobile: f.row.phone },
      ownContact: f.ownContact, profile: filledValues(f.values), note: f.note, sendEmail: box.querySelector('#pa-send').checked, ...payBody, ...(force ? { force: true } : {}),
    })
    busy = false; btn.disabled = false; btn.textContent = label
    if (!r.ok) {
      err.innerHTML = `${esc(r.data.error || 'Could not add.')}${r.data.code === 'duplicate' && r.data.rowId ? ` <button type="button" class="j-btn j-btn-line j-btn-sm" id="pa-open-dup">Open the existing player</button>${r.data.inGroup ? ' <button type="button" class="j-btn j-btn-line j-btn-sm" id="pa-force">Add another row anyway</button>' : ''}` : ''}`
      err.hidden = false
      box.querySelector('#pa-open-dup')?.addEventListener('click', () => { closeModal(); openPlayerRecord(r.data.rowId) })
      box.querySelector('#pa-force')?.addEventListener('click', () => send(true))
      return
    }
    closeModal()
    const extra = r.data.emailError || r.data.profileError || ''
    if (r.data.payreq) {
      const url = r.data.payreq.url
      const done = modal(`<h2 style="margin-bottom:6px">${r.data.emailed ? 'Added and payment link emailed' : 'Added, payment link ready'}</h2><p class="muted small" style="margin-bottom:12px"><b>${esc(f.row.name)}</b> is in Term 4 Players with no group yet. ${esc(r.data.payreq.amountLabel)} to pay.${r.data.emailed ? ` Sent to ${esc(r.data.emailTo)}.` : ''}${extra ? ` <b>${esc(extra)}</b>` : ''}</p>
        <label class="j-field"><span>Payment link</span><input class="j-input" value="${esc(url)}" readonly></label>
        <div class="jpf-acts"><button type="button" class="j-btn j-btn-line" data-close>Close</button><button type="button" class="j-btn j-btn-dark" id="dn-copy">Copy link</button></div>`)
      done.querySelector('#dn-copy').addEventListener('click', () => copy(url))
    } else toast(extra || `Added${r.data.emailed ? `. Sent to ${r.data.emailTo}` : ''}. Airtable updated.`)
    P.board = null; PL.at = 0; renderPlayers()
  }
  box.querySelector('#pa-go').addEventListener('click', () => send(false))
}

async function renderPlayers(keep = false) {
  // Read from Airtable again whenever the tab is opened after half a minute,
  // so a change made in Airtable shows here without a page reload. Typing in
  // the search box or changing a filter redraws from what is already loaded.
  if (!PL.data || (!keep && Date.now() - PL.at > 30000)) { PL.data = await need(await post('playersList', { fresh: true })); PL.at = Date.now() }
  const d = PL.data
  const shown = d.players.filter(plMatch)
  const opt = (list, sel, blank) => `<option value="">${blank}</option>` + list.map((x) => `<option value="${esc(x.id)}" ${sel === x.id ? 'selected' : ''}>${esc(x.label || x.name)}</option>`).join('')
  view().innerHTML = `<div class="jp-head"><div><h1>Players</h1><p class="muted small">Every Term 4 player. Search, filter by level or position, click anyone to see everything, or press Edit to change their details. Families update the same details in My account.</p></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><span class="muted small" id="pl-synced">Read from Airtable ${esc(new Date(PL.at).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' }))}</span><button type="button" class="j-btn j-btn-line" id="pl-refresh">Refresh from Airtable</button><button type="button" class="j-btn j-btn-dark" id="pl-add">+ Add a player</button><button type="button" class="j-btn j-btn-line" id="pl-invite">Send account invites</button></div></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
      <input class="j-input" id="pl-q" placeholder="Search name, parent, email, mobile, group" value="${esc(PL.q)}" style="flex:1;min-width:240px">
      <select class="j-select" id="pl-status" style="width:auto">${opt([{ id: 'unpaid', label: 'Not paid' }, { id: 'paid', label: 'Paid' }, { id: 'noprice', label: 'No fee set' }], PL.status, 'Any payment')}</select>
      <select class="j-select" id="pl-group" style="width:auto">${opt(d.groups, PL.group, 'Any group')}</select>
      <select class="j-select" id="pl-coach" style="width:auto">${opt(d.coaches, PL.coach, 'Any coach')}</select>
      <select class="j-select" id="pl-waiver" style="width:auto">${opt([{ id: 'yes', label: 'Waiver on file' }, { id: 'no', label: 'No waiver' }], PL.waiver, 'Any waiver')}</select>
      <select class="j-select" id="pl-place" style="width:auto">${opt([{ id: 'in', label: 'In a group' }, { id: 'out', label: 'Not in a group' }], PL.place, 'In or out')}</select>
      <select class="j-select" id="pl-level" style="width:auto">${opt([...PROFILE_OPTIONS.levels.map((x) => ({ id: x, label: x })), { id: 'none', label: 'Level not known' }], PL.level, 'Any level')}</select>
      <select class="j-select" id="pl-pos" style="width:auto">${opt(PROFILE_OPTIONS.positions.map((x) => ({ id: x, label: x })), PL.pos, 'Any position')}</select>
      <button type="button" class="j-btn j-btn-ghost j-btn-sm" id="pl-clear">Clear</button>
    </div>
    <p class="muted small" style="margin-bottom:8px">${shown.length} of ${d.players.length} players${shown.length !== d.players.length ? ' match' : ''} · ${d.players.filter((p) => !p.inGroup).length} not in a group · ${d.players.filter((p) => p.feeAud == null).length} with no fee · ${d.players.filter((p) => !p.waiver.onFile).length} with no waiver</p>
    <div class="jp-scroll"><table class="jp-table"><thead><tr><th>Player</th><th>Group</th><th>Payment</th><th>Football</th><th>Waiver</th><th>Email</th><th></th></tr></thead>
      <tbody>${shown.map(plRow).join('') || '<tr><td colspan="7" class="muted">Nobody matches those filters.</td></tr>'}</tbody></table></div>`
  const redraw = () => renderPlayers(true)
  $('pl-q').addEventListener('input', (e) => { PL.q = e.target.value; const at = e.target.selectionStart; redraw(); const i = $('pl-q'); i.focus(); i.setSelectionRange(at, at) })
  for (const [id, key] of [['pl-status', 'status'], ['pl-group', 'group'], ['pl-coach', 'coach'], ['pl-waiver', 'waiver'], ['pl-place', 'place'], ['pl-level', 'level'], ['pl-pos', 'pos']]) {
    $(id).addEventListener('change', (e) => { PL[key] = e.target.value; redraw() })
  }
  $('pl-clear').addEventListener('click', () => { Object.assign(PL, { q: '', status: '', group: '', coach: '', waiver: '', place: '', level: '', pos: '' }); redraw() })
  $('pl-add').addEventListener('click', () => plAddBox())
  $('pl-refresh').addEventListener('click', () => { PL.at = 0; renderPlayers() })
  $('pl-invite').addEventListener('click', () => renderFamilies())
  view().querySelectorAll('[data-pl]').forEach((tr) => tr.addEventListener('click', (e) => {
    const p = d.players.find((x) => x.rowId === tr.dataset.pl)
    if (!p) return
    if (e.target.closest('[data-pl-edit]')) return plEdit(p)
    plDetail(p)
  }))
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
    // iPhone photos are usually HEIC. The guard above lets them through but
    // Chrome cannot decode HEIC, so the only sign was "that file could not be
    // read". Say what it is and what to do. (Ruby, 8 Oct 2026.)
    const heic = /heic|heif/i.test(file.type || '') || /\.(heic|heif)$/i.test(file.name || '')
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
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error(heic
        ? 'This browser cannot open iPhone HEIC photos. On an iPhone: Settings, Camera, Formats, Most Compatible, then take the photo again. Or open it in Photos and export it as a JPG.'
        : 'That file could not be read. Try a JPG or PNG.'))
    }
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
          <label class="j-field"><span>Mobile (parents see this so they can reach the coach)</span><input class="j-input" type="tel" inputmode="tel" data-cf="phone" value="${esc(c.phone || '')}" placeholder="Not shown until you add it" autocomplete="off"></label>
          <label class="j-check"><input type="checkbox" data-cf="alerts" ${c.alerts ? 'checked' : ''}> <span>Email them when a family pays for a place in their group</span></label>
          <p class="muted small">Matches Airtable's Coach column as "${esc(c.airtableName || c.name)}"${c.id === 'lee' ? '. You sign in as super admin, so you see everything.' : ''}</p>
        </div></div>`).join('')}</div>
      <div class="j-card" style="padding:14px;max-width:760px;margin-top:12px"><h3 style="margin-bottom:8px">Add a coach</h3>
        <div class="j-two"><label class="j-field"><span>Full name</span><input class="j-input" id="co-new-name" placeholder="First and last name"></label><label class="j-field"><span>Email</span><input class="j-input" type="email" id="co-new-email"></label></div>
        <button type="button" class="j-btn j-btn-line j-btn-sm" id="co-add">Add to the list</button></div>
      <p class="j-err" id="co-err" hidden></p>
      <button type="button" class="j-btn j-btn-dark j-btn-lg" id="co-save" style="margin-top:12px">Save coaches</button>`
    const read = () => { rows = rows.map((c, i) => { const box = view().querySelector(`[data-co="${i}"]`); return { ...c, fullName: box.querySelector('[data-cf="fullName"]').value.trim(), email: box.querySelector('[data-cf="email"]').value.trim(), phone: box.querySelector('[data-cf="phone"]').value.trim(), alerts: box.querySelector('[data-cf="alerts"]').checked } }) }
    view().querySelectorAll('[data-photo]').forEach((b) => b.addEventListener('click', () => { read(); const c = rows[Number(b.dataset.photo)]; if (!list.some((x) => x.id === c.id)) return toast('Save coaches first, then add the photo.'); photoPicker(b, c.id, (url) => { c.photo = url; draw() }) }))
    view().querySelectorAll('[data-photo-rm]').forEach((b) => b.addEventListener('click', async () => { read(); const c = rows[Number(b.dataset.photoRm)]; const r = await post('coachPhoto', { coachId: c.id, remove: true }); if (r.ok) { c.photo = ''; draw() } else toast(r.data.error) }))
    $('co-add').addEventListener('click', () => {
      read()
      const full = $('co-new-name').value.trim().replace(/\s+/g, ' ')
      if (!/\s/.test(full)) return toast('Enter their first and last name.')
      const first = full.split(' ')[0]
      let id = first.toLowerCase().replace(/[^a-z0-9]/g, '') || 'coach'
      while (rows.some((c) => c.id === id)) id += '2'
      rows.push({ id, name: first, fullName: full, airtableName: full, email: $('co-new-email').value.trim(), phone: '', alerts: false, photo: '' })
      draw()
    })
    $('co-save').addEventListener('click', async () => {
      read()
      const bad = rows.find((c) => c.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email))
      if (bad) { $('co-err').textContent = `Check ${bad.fullName}'s email.`; $('co-err').hidden = false; return }
      const phoneOk = (v) => { const n = v.replace(/\D/g, '').length; return /^[+(\d][\d\s().-]*$/.test(v) && n >= 8 && n <= 15 }
      const badPhone = rows.find((c) => c.phone && !phoneOk(c.phone))
      if (badPhone) { $('co-err').textContent = `Check ${badPhone.fullName}'s mobile. Use digits, like 0411 222 333.`; $('co-err').hidden = false; return }
      const r = await post('saveSettings', { config: { coachLoginsEnabled: $('co-on').checked, coaches: rows.map(({ photo, ...c }) => c) } })
      if (!r.ok) { $('co-err').textContent = r.data.error; $('co-err').hidden = false; return }
      toast('Coaches saved'); P.coaches = null; P.board = null; PL.at = 0; renderCoaches()
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
    toast(r.ok ? 'Restored to Term 4. Airtable updated.' : r.data.error); P.board = null; PL.at = 0; renderRemoved()
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
      <label class="j-field"><span>Kit price shown to families</span><input class="j-input" id="s-kitprice" value="${esc(c.kitPriceLabel || 'A$60')}" maxlength="20"></label></div>
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
  const sec = e.target.closest('[data-navsec]')
  if (sec) { toggleNavGroup(sec.dataset.navsec); return }
  const t = e.target.closest('[data-tab]')
  if (t) { go(t.dataset.tab); return }
  if (e.target.closest('#sign-out')) { await signOut('staff'); location.href = '/jfp-portal/' }
})

boot()
