// My account, the family portal (Lee, 13 Oct 2026). Sign in with an emailed
// code, then: the next session first, every date, player information (club,
// position, contacts), can't make a session, keep my spot for next term,
// term info, holidays and camps, training videos, the app and contact.
// Phones first: a bottom tab bar on phones, a side bar on big screens.
import { $, esc, api, toast, openSheet, closeSheet, signIn, signOut, waiverBlock, recaptcha, savePdf } from './jfp-common.js'
import { termInfo, expectations, links, groupingLine, termExtras } from '../data/jfp-term-info.js'
import { oneToOneSummary } from '../data/jfp-one-to-one.js'
import { hqVideos, pitchVideos, reels, socials, contacts, hq, holidays } from '../data/jfp-account-media.js'
import { ic } from './jfp-account-icons.js'
import { first, initials, money, pageHead, hero, secHead } from './jfp-account-ui.js'
import { oweList, jjOweList, oweCard, aheadBlock, depositCards, placeCards, historyCard } from './jfp-account-pay.js'
import { renderExtra, renderAnalysis, extraClick, setExtraLink } from './jfp-account-extras.js'
// Fees: save a card or bank account for session payments (claude/card-on-file).
import { mountSavedPay, savedReturn, forgetSaved } from './jfp-account-saved.js'
import { renderReports, reportsHomeBlock, unreadReports } from './jfp-account-reports.js'
import { newSessions, markSeen, newSessionsPopup } from './jfp-account-new.js'
import { askWhere } from './jfp-account-where.js'
import { coachRow, coachSheet } from './jfp-account-coach.js'
import { attendanceLine, pastMark, unreadNotes, notesHomeBlock, makeupsHomeBlock, askMakeup, renderNotes, renderAlerts, pushOffered, loginRow, loginSheet } from './jfp-account-more.js'

const q = new URLSearchParams(location.search)
let D = null
let PROF = null
// Fees (14 Oct 2026): read when the Fees tab first opens, again after each load.
let FEES = null
const PANELS = ['home', 'sessions', 'fees', 'family', 'news', 'notes', 'reports', 'alerts', 'info', 'waivers', 'cancel', 'keep', 'term', 'holidays', 'extra', 'analysis', 'videos', 'app', 'contact']
let current = 'home'
const KIT_URL = 'https://www.besteamsport.com.au/collections/joner-football'
const IMG = '/images/jfp-account'

// ---------- small helpers ----------

const sydIso = (ms = Date.now()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms))
const dayDiff = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000)
const fmt = (ms, opts) => new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', ...opts }).format(new Date(ms))
const termShort = () => String(D?.term || 'Term').replace(/\s+\d{4}$/, '')
const niceIso = (iso) => new Intl.DateTimeFormat('en-AU', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${iso}T00:00:00Z`))

function countdown(ms) {
  const n = dayDiff(sydIso(), sydIso(ms))
  if (n <= 0) { const h = Math.round((ms - Date.now()) / 3600e3); return h <= 1 ? 'Starting soon' : `Today, in ${h} hours` }
  if (n === 1) return 'Tomorrow'
  if (n < 14) return `In ${n} days`
  return `In ${Math.round(n / 7)} weeks`
}
function termWeek() {
  if (!D?.termStart) return null
  const weeks = D.weeks || 10
  const diff = dayDiff(D.termStart, sydIso())
  if (diff < 0) return { label: `Starts ${niceIso(D.termStart)}`, pct: 0 }
  const w = Math.floor(diff / 7) + 1
  if (w > weeks) return { label: 'Term finished', pct: 100 }
  return { label: `Week ${w} of ${weeks}`, pct: Math.min(100, Math.round(((diff + 1) / (weeks * 7)) * 100)) }
}
// Every booked session of every player, with the next one still on.
function upcoming() {
  const out = []
  for (const p of D.players) for (const e of p.enrolments) out.push({ p, e, next: (e.sessions || []).find((s) => !s.cancelled) || null })
  return out.sort((a, b) => (a.next?.startMs || Infinity) - (b.next?.startMs || Infinity))
}
// Our own light photos for each place (the big originals are for the booking page).
const VENUE_PHOTO = { ntra: `${IMG}/photos/ntra-field-900x1100.webp`, belrose: `${IMG}/photos/hq-indoor-800x1000.webp`, rydalmere: `${IMG}/photos/rydalmere-session-1200x800.webp` }
const VENUE_CARD = { ntra: `${IMG}/photos/ntra-field-1600x900.webp`, belrose: `${IMG}/photos/hq-exterior-1200x800.webp`, rydalmere: `${IMG}/photos/rydalmere-session-1200x800.webp` }
const VENUE_WIDE = { ntra: [`${IMG}/photos/ntra-field-1600x900.webp`, 1600], belrose: [`${IMG}/photos/hq-indoor-960x720.webp`, 960], rydalmere: [`${IMG}/photos/rydalmere-session-1200x800.webp`, 1200] }
const photoFor = (e) => VENUE_PHOTO[e.locationId] || e.photo || VENUE_PHOTO.ntra
// Portrait on phones, landscape on big screens.
const photoSet = (e) => { const w = VENUE_WIDE[e.locationId]; return w ? `srcset="${photoFor(e)} 800w, ${w[0]} ${w[1]}w" sizes="(min-width: 1100px) 55vw, 100vw"` : '' }
// Plain words for a parent (redesign, 17 Oct 2026). The server labels stay
// as they are (emails and Stripe use them); only what the page shows changes.
const ARRANGED = 'Nothing to pay yet'
function payDot(pm) {
  if (!pm) return ''
  const cls = { paid: 'ok', due: 'bad', trial: 'ok', sessions: 'ok', arranged: '' }[pm.state] || ''
  return `<span class="ja-dot ${cls}">${esc(pm.state === 'arranged' ? ARRANGED : pm.label)}</span>`
}
// "2026-07-19" -> "19 Jul 2026". Anything else is shown as it came.
function humanDate(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ''))
  if (!m) return String(v || '')
  return new Intl.DateTimeFormat('en-AU', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`))
}

// ---------- light or dark ----------
// Light by default (Lee, 17 Oct 2026). The choice is kept on this device; the
// page reads it before it paints (inline script in jfp-account.astro).
const theme = () => $('jfp-account')?.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'
function setTheme(t) {
  $('jfp-account')?.setAttribute('data-theme', t)
  try { localStorage.setItem('ja-theme', t) } catch {}
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'dark' ? '#0A0A0B' : '#F5F5F3')
  document.querySelectorAll('[data-theme-pick]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.themePick === t)))
}
const themeSwitch = () => `<div class="ja-seg2" role="group" aria-label="Look">${[['light', 'Light'], ['dark', 'Dark']].map(([k, l]) => `<button type="button" data-theme-pick="${k}" aria-pressed="${theme() === k}">${l}</button>`).join('')}</div>`
const standalone = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true

// ---------- sign in ----------

// The last copy of the account (Lee, 17 Oct 2026): painted at once on open,
// and kept for when there is no signal. Cleared on sign out or a new person.
const LAST = 'ja-last'
function readLast() { try { const v = JSON.parse(localStorage.getItem(LAST) || 'null'); return v?.d?.email ? v : null } catch { return null } }
function saveLast(d) { try { localStorage.setItem(LAST, JSON.stringify({ at: Date.now(), d })) } catch {} }
function clearLast() { try { localStorage.removeItem(LAST) } catch {} }
const offlineBanner = () => { $('banner').innerHTML = `<div class="j-box j-box-amber" style="margin-bottom:16px" data-offline><b>No signal.</b> This is your last copy${LASTAT ? ` from ${esc(fmt(LASTAT, { weekday: 'short', hour: 'numeric', minute: '2-digit' }))}` : ''}.</div>` }
let LASTAT = 0
function paintLast(last) {
  $('app').hidden = false
  setTheme(theme())
  D = last.d
  LASTAT = last.at
  render()
  const h = location.hash.slice(1).split('?')[0]
  show(PANELS.includes(h) ? h : 'home', { keepScroll: true })
}

// Opens with no signal and, later, shows push notifications.
function registerWorker() {
  if (!('serviceWorker' in navigator) || location.protocol !== 'https:' && location.hostname !== 'localhost') return
  navigator.serviceWorker.register('/jfp-account-sw.js', { scope: '/jfp-account/' }).catch(() => {})
}

async function boot() {
  registerWorker()
  const last = readLast()
  if (last) paintLast(last)
  const r = await api('/api/jfp-auth?audience=parent', null, { method: 'GET' })
  if (r.status === 0 && last) return offlineBanner()
  const user = r.ok ? r.data.user || null : null
  if (!user) { clearLast(); D = null; return showSignIn() }
  if (last && String(user.email || '').toLowerCase() !== String(last.d.email || '').toLowerCase()) { clearLast(); D = null }
  start()
}
async function showSignIn() {
  $('signin').hidden = false
  $('app').hidden = true
  await signIn({ mount: $('si-mount'), foot: $('si-foot'), audience: 'parent', intro: 'Use the email address you gave Joner Football. New to Joner Football? Use any email address and we make your account.' })
  $('signin').hidden = true
  start()
}
async function start() {
  $('app').hidden = false
  setTheme(theme())
  if (q.get('paid') && q.get('session_id')) confirmPaid(q.get('session_id'))
  // Back from saving a card or bank account on Stripe (claude/card-on-file).
  if (q.get('saved')) await savedReturn(q.get('saved'), $('banner'))
  await load()
  // A private extra session link: #extra?slot=<id>&k=<key> (money engineer, 14 Oct 2026).
  const [h, hq] = location.hash.slice(1).split('?')
  if (h === 'extra') setExtraLink(hq)
  show(PANELS.includes(h) ? h : 'home', { keepScroll: true })
  const payId = q.get('pay')
  if (payId) {
    show('home')
    // The payment cards live in the To sort sheet (redesign, 17 Oct 2026).
    if (todoSummary().n) todoSheet()
    const el = document.querySelector(`.j-sheet [data-todo="${CSS.escape(payId)}"]`) || document.querySelector(`[data-todo="${CSS.escape(payId)}"]`)
    if (el) { el.scrollIntoView({ block: 'center' }); el.style.boxShadow = '0 0 0 2px var(--ja-red, #E30613)' }
    else if (D && !D.todo.length && !(D.juniors?.todo || []).length) toast('That payment is already done or no longer open.')
  } else if (D?.askWhere) askWhere(D)
  else if (h !== 'extra' && h !== 'holidays') newSessionsPopup(D, (k) => show(k))
  loadProfiles()
}

async function confirmPaid(sid) {
  $('banner').innerHTML = '<div class="j-box j-box-grey" style="margin-bottom:16px">Confirming your payment with Stripe</div>'
  for (let i = 0; i < 12; i += 1) {
    const r = await api(`/api/jfp-confirm?session_id=${encodeURIComponent(sid)}`, null, { method: 'GET' })
    if (r.ok && r.data.status === 'paid') {
      $('banner').innerHTML = r.data.kind === 'juniors'
        ? `<div class="j-box j-box-green" style="margin-bottom:16px"><b>Payment received.</b> Thank you. ${esc((r.data.payment?.players || []).join(' and '))}${r.data.payment?.next?.choice === 'hold' ? `'s place for ${esc(r.data.payment.next.term)} is held` : `'s Joners Juniors place for ${esc(r.data.payment?.term || '')} is paid`}. We have emailed you a receipt.</div>`
        : `<div class="j-box j-box-green" style="margin-bottom:16px"><b>Payment received.</b> Thank you. We have emailed you a receipt${r.data.payment?.group ? ' and the session dates' : ''}.</div>`
      history.replaceState(null, '', location.pathname)
      await load()
      return
    }
    if (r.ok && r.data.status === 'received') { $('banner').innerHTML = '<div class="j-box j-box-amber" style="margin-bottom:16px"><b>We have your payment.</b> This payment link had been closed before you paid, so Lee or Ligia will contact you to sort it out. Do not pay again.</div>'; history.replaceState(null, '', location.pathname); return }
    if (r.ok && r.data.status === 'expired') { $('banner').innerHTML = '<div class="j-box j-box-amber" style="margin-bottom:16px">That payment was not completed. Nothing was charged.</div>'; return }
    await new Promise((res) => setTimeout(res, 4000))
  }
  $('banner').innerHTML = '<div class="j-box j-box-amber" style="margin-bottom:16px">Your payment is still processing. Do not pay again; refresh this page in a few minutes.</div>'
}

async function load() {
  const r = await api('/api/jfp-account', { action: 'overview', pay: q.get('pay') || '' })
  if (r.status === 401) { clearLast(); return showSignIn() }
  if (r.status === 0 && D) return offlineBanner()
  if (!r.ok) { document.querySelector('[data-pane="home"]').innerHTML = `<div class="ja-card">${esc(r.data.error || 'Could not load your account.')}</div>`; return }
  D = r.data
  saveLast(D)
  document.querySelector('[data-offline]')?.remove()
  FEES = null
  forgetSaved()
  render()
}
async function loadProfiles() {
  if (D?.playerLogin) return
  const r = await api('/api/jfp-account', { action: 'profiles' })
  if (!r.ok) return
  PROF = r.data
  renderShell()
  renderHome()
  renderInfo()
  if (pane('family')?.dataset.drawn) renderFamily()
}

// ---------- shell: side bar, tab bar, menu ----------

// The account holder is the player (a Pro or an adult): "My profile".
const solo = () => Boolean(D?.players?.length === 1 && D.players[0].self)
function face(name, photo, extra = '') {
  return photo ? `<span class="ja-avatar ja-face" ${extra}><img src="${esc(photo)}" alt="" loading="lazy"></span>` : `<span class="ja-avatar" ${extra}>${esc(initials(name))}</span>`
}
// The side bar (redesign, Lee 17 Oct 2026): the four main pages, then "My
// family" (the family's own things) and "Explore Joner" (everything else JFP
// offers). Sections open and close and are remembered on this device; the
// section holding the open page always stays open. Phones: the same two
// sections in the More sheet.
function nav() {
  const unsigned = unsignedWaivers().length
  const notesItem = { key: 'notes', label: 'Coach notes', icon: 'whistle', count: unreadNotes(D) }
  const reportsItem = { key: 'reports', label: 'Player reports', icon: 'spark', count: unreadReports(D) }
  const alertsItem = pushOffered(D) ? [{ key: 'alerts', label: 'Notifications', icon: 'bell' }] : []
  // A player's own login (12+): their sessions, notes and videos. No money or family.
  if (D?.playerLogin) return [
    { label: 'My JFP', items: [
      { key: 'home', label: 'Home', icon: 'home' },
      { key: 'sessions', label: 'Sessions', icon: 'calendar' },
      notesItem,
      reportsItem,
      { key: 'news', label: 'Announcements', icon: 'bell', count: unreadNews() },
    ] },
    { label: 'Manage', items: [{ key: 'cancel', label: "Can't make it", icon: 'xcircle' }, ...alertsItem, { key: 'contact', label: 'Contact us', icon: 'chat' }] },
    { label: 'Explore Joner', items: [
      { key: 'videos', label: 'Videos', icon: 'play' },
      { key: 'term', label: `${termShort()} info`, icon: 'info' },
      { key: 'app', label: 'The JF App', icon: 'phone' },
    ] },
  ]
  return [
    { label: 'My JFP', items: [
      { key: 'home', label: 'Home', icon: 'home' },
      { key: 'sessions', label: 'Sessions', icon: 'calendar' },
      { key: 'fees', label: 'Fees', icon: 'card', dot: feesOwing() > 0 },
      { key: 'family', label: solo() ? 'My profile' : D?.agent ? 'My players' : 'Family', icon: 'user', dot: familyCount() > 0 },
      { key: 'news', label: 'Announcements', icon: 'bell', count: unreadNews() },
      notesItem,
      reportsItem,
    ] },
    { label: 'Manage', items: [
      { key: 'cancel', label: "Can't make it", icon: 'xcircle' },
      ...alertsItem,
      { key: 'keep', label: 'Keep my spot', icon: 'bookmark', dot: Boolean(D?.keep?.open && (D?.nextTerm?.players || []).some((x) => !x.status || x.status === 'invited')) },
      { key: 'info', label: solo() ? 'My profile' : 'Player information', icon: 'user', dot: infoGaps().length > 0 },
      { key: 'waivers', label: 'Waivers', icon: 'sign', dot: unsigned > 0 },
      { key: 'contact', label: 'Contact us', icon: 'chat' },
    ] },
    { label: 'Explore Joner', items: [
      { key: 'term', label: `${termShort()} info`, icon: 'info' },
      { key: 'holidays', label: 'Holiday training', icon: 'sun', count: newSessions(D).holiday.length },
      { key: 'extra', label: 'Book extra sessions', icon: 'calplus', count: newSessions(D).extra.length },
      { key: 'analysis', label: 'Game analysis', icon: 'video' },
      { href: links.booking, label: 'Timetable', icon: 'grid' },
      { key: 'videos', label: 'Videos', icon: 'play' },
      { key: 'app', label: 'The JF App', icon: 'phone' },
      { href: D?.kitUrl || KIT_URL, label: 'JF training kit', icon: 'shirt', ext: true },
    ] },
  ]
}
function navItem(it) {
  const inner = `${ic(it.icon)}<span>${esc(it.label)}</span>${it.ext ? ic('ext', 'ext') : it.count ? newsBadge(it.count) : it.dot ? '<span class="dot" aria-label="Needs attention"></span>' : ''}`
  if (it.href) return `<a class="ja-nav-item" href="${esc(it.href)}"${it.ext ? ' target="_blank" rel="noopener noreferrer"' : ''}>${inner}</a>`
  return `<button type="button" class="ja-nav-item" data-go="${it.key}" aria-current="${current === it.key ? 'page' : 'false'}">${inner}</button>`
}
const NAV_KEY = 'ja-nav-open'
// Open on a first visit: My JFP and Manage. Explore Joner until opened.
const NAV_DEFAULT = { 'My JFP': true, 'Manage': true }
function navOpen() { try { return { ...NAV_DEFAULT, ...(JSON.parse(localStorage.getItem(NAV_KEY) || '{}') || {}) } } catch { return { ...NAV_DEFAULT } } }
function navGroup(g, open) {
  if (g.items.length === 1) return `<div class="ja-nav-one">${navItem(g.items[0])}</div>`
  const here = g.items.some((it) => it.key === current)
  const shut = !here && open[g.label] !== true
  const id = `ja-ng-${g.label.toLowerCase().replace(/[^a-z]+/g, '-')}`
  return `<div class="ja-nav-group${shut ? ' is-shut' : ''}" data-navgrp="${esc(g.label)}">
    <button type="button" class="ja-nav-sec" data-navsec="${esc(g.label)}" aria-expanded="${shut ? 'false' : 'true'}" aria-controls="${id}"><span>${esc(g.label)}</span>${g.items.some((it) => it.dot || it.count) ? '<span class="dot" aria-label="Needs attention"></span>' : ''}${ic('chevron', 'chev')}</button>
    <div class="ja-nav-list" id="${id}"><div>${g.items.map(navItem).join('')}</div></div></div>`
}
function toggleNav(label) {
  const grp = [...document.querySelectorAll('#ja-nav [data-navgrp]')].find((x) => x.dataset.navgrp === label)
  if (!grp) return
  const shut = !grp.classList.contains('is-shut')
  grp.classList.toggle('is-shut', shut)
  grp.querySelector('[data-navsec]').setAttribute('aria-expanded', String(!shut))
  const saved = navOpen()
  saved[label] = !shut
  try { localStorage.setItem(NAV_KEY, JSON.stringify(saved)) } catch {}
}
// The bottom bar on phones (redesign, Lee 17 Oct 2026): Home, Sessions, Fees,
// Family, More. A badge always counts what is on the page it opens: Fees
// counts payments to make, Family counts waivers and details to sort.
const FAMILY_BAR = [['home', 'Home', 'home'], ['sessions', 'Sessions', 'calendar'], ['fees', 'Fees', 'card'], ['family', 'Family', 'user']]
const PLAYER_BAR = [['home', 'Home', 'home'], ['sessions', 'Sessions', 'calendar'], ['notes', 'Notes', 'whistle'], ['videos', 'Videos', 'play']]
let BAR = FAMILY_BAR
// An agent's players sign their own waivers (Lee, 20 Oct 2026): never in the agent's list.
const unsignedWaivers = () => (D ? [...D.players, ...(D.juniors?.children || [])].filter((p) => !p.waiver?.onFile && !(p.byAgent && !D.playerLogin)) : [])
function familyCount() { return infoGaps().length + unsignedWaivers().length }
const badge = (n) => n ? `<span class="badge" aria-label="${n} to sort">${n}</span>` : ''
// Announcements (Lee, 17 Oct 2026): a red number counts the ones not opened yet.
const unreadNews = () => (D?.announcements || []).filter((a) => !a.read).length
const newsBadge = (n) => n ? `<span class="badge ja-nbadge" aria-label="${n} unread">${n > 9 ? '9+' : n}</span>` : ''
function renderShell() {
  BAR = D?.playerLogin ? PLAYER_BAR : FAMILY_BAR
  const open = navOpen()
  $('ja-nav').innerHTML = nav().map((g) => navGroup(g, open)).join('')
  const inMore = !BAR.some(([k]) => k === current)
  $('ja-tabs').innerHTML = BAR.map(([k, l, i]) => `<button type="button" class="ja-tab" data-go="${k}" aria-current="${current === k ? 'page' : 'false'}">${ic(i)}<span>${k === 'family' && solo() ? 'Me' : l}</span>${k === 'notes' ? newsBadge(unreadNotes(D)) : badge(k === 'fees' ? feesOwing() : k === 'family' ? familyCount() : 0)}</button>`).join('')
    + `<button type="button" class="ja-tab" data-more aria-haspopup="dialog" aria-current="${inMore ? 'page' : 'false'}">${ic('menu')}<span>More</span>${newsBadge(newSessions(D).n)}</button>`
  $('ja-email').textContent = D?.email || ''
  const unread = unreadNews()
  $('ja-bell').innerHTML = `${ic('bell')}${newsBadge(unread)}`
  $('ja-bell').setAttribute('aria-label', unread ? `Announcements, ${unread} unread` : 'Announcements')
  // The name button (top right) opens the account sheet: who is signed in,
  // light or dark, details, contact and sign out.
  const me = solo() ? D.players[0] : null
  const who = me?.name || D?.parentName || ''
  const av = me?.photo ? `<span class="ja-me-av"><img src="${esc(me.photo)}" alt=""></span>` : `<span class="ja-me-av">${esc(initials(who || D?.email || 'J'))}</span>`
  $('ja-me').innerHTML = `${av}<span class="ja-me-name">${esc(first(who) || 'Account')}</span>`
  $('ja-me').setAttribute('aria-label', `Your account${D?.email ? `, signed in as ${D.email}` : ''}`)
  const foot = document.querySelector('.ja-side-foot')
  if (foot && !foot.querySelector('.ja-seg2')) foot.insertAdjacentHTML('beforeend', `<div style="margin-top:12px">${themeSwitch()}</div>`)
}
function moreRow(it) {
  const inner = `<span class="ja-mr-ic">${ic(it.icon)}</span><span class="ja-mr-tx"><b>${esc(it.label)}</b></span>${it.count ? newsBadge(it.count) : it.dot ? '<span class="dot" aria-label="Needs attention"></span>' : ''}${it.ext ? ic('ext', 'ja-mr-go') : ic('right', 'ja-mr-go')}`
  if (it.href) return `<a class="ja-mrow" href="${esc(it.href)}"${it.ext ? ' target="_blank" rel="noopener noreferrer"' : ''}>${inner}</a>`
  return `<button type="button" class="ja-mrow" data-go="${it.key}" aria-current="${current === it.key ? 'page' : 'false'}">${inner}</button>`
}
const installCard = () => standalone() ? '' : `<button type="button" class="ja-install-cta" data-install><span class="j">J</span><span><b>Put My JFP on your home screen</b></span>${ic('right', 'ja-mr-go')}</button>`
function moreSheet() {
  const sheet = openSheet({ title: 'More', subtitle: '' })
  sheet.sheet.classList.add('ja-more-sheet')
  // Phones: the My JFP pages not on the bottom bar (Announcements, Coach
  // notes, Player reports) are listed here too, so every page is reachable.
  const [mine, ...rest] = nav()
  const left = { ...mine, items: mine.items.filter((it) => !BAR.some(([k]) => k === it.key)) }
  const groups = left.items.length ? [left, ...rest] : rest
  sheet.body.innerHTML = installCard() + groups.map((g) => `<div class="ja-more-group"><p class="ja-nav-label">${esc(g.label)}</p><div class="ja-mlist">${g.items.map(moreRow).join('')}</div></div>`).join('')
  sheet.foot.innerHTML = '<button type="button" class="ja-btn ja-btn-line ja-btn-block" id="ja-signout2">Sign out</button>'
}
// The name button: "how do I check my account?" (Lee, 17 Oct 2026).
function accountSheet() {
  const me = solo() ? D.players[0] : null
  const who = me?.name || D?.parentName || ''
  const sheet = openSheet({ title: who || 'Your account', subtitle: D?.email ? `Signed in as ${D.email}` : '' })
  sheet.body.innerHTML = `<div class="ja-more-group"><p class="ja-nav-label">Look</p>${themeSwitch()}</div>
    <div class="ja-more-group"><p class="ja-nav-label">Your account</p><div class="ja-mlist">
      ${D?.playerLogin ? '' : moreRow({ key: 'family', label: solo() ? 'My profile' : D?.agent ? 'Your players' : 'Your family', icon: 'user', dot: familyCount() > 0 })}
      ${D?.playerLogin ? '' : moreRow({ key: 'fees', label: 'Fees and receipts', icon: 'card', dot: feesOwing() > 0 })}
      ${moreRow({ key: 'contact', label: 'Contact us', icon: 'chat' })}
    </div></div>${installCard()}`
  sheet.foot.innerHTML = '<button type="button" class="ja-btn ja-btn-line ja-btn-block" id="ja-signout2">Sign out</button>'
}
// Add to Home Screen: the steps for iPhone (Safari) and Android (Chrome).
function installSheet() {
  const sheet = openSheet({ title: 'Put it on your home screen', subtitle: 'It opens like an app, with no app store.' })
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || !/android/i.test(navigator.userAgent)
  const steps = {
    ios: ['Open this page in Safari and tap Share at the bottom', 'Scroll down and tap Add to Home Screen', 'Tap Add. Look for the red J on your home screen'],
    android: ['Open this page in Chrome and tap the three dots, top right', 'Tap Add to Home screen or Install app', 'Tap Install. Look for the red J on your home screen'],
  }
  const draw = (k) => {
    sheet.body.innerHTML = `<div class="ja-seg2" role="group" aria-label="Your phone">${[['ios', 'iPhone'], ['android', 'Android']].map(([x, l]) => `<button type="button" data-os="${x}" aria-pressed="${x === k}">${l}</button>`).join('')}</div>
      <ol class="ja-isteps">${steps[k].map((t, i) => `<li><span class="n">${i + 1}</span><span>${esc(t)}</span></li>`).join('')}</ol>`
    sheet.body.querySelectorAll('[data-os]').forEach((b) => b.addEventListener('click', () => draw(b.dataset.os)))
  }
  draw(ios ? 'ios' : 'android')
  sheet.foot.innerHTML = '<button type="button" class="ja-btn ja-btn-red ja-btn-block" id="ja-inst-ok">Got it</button>'
  sheet.foot.querySelector('#ja-inst-ok').addEventListener('click', () => closeSheet())
}
function show(panel, { keepScroll = false } = {}) {
  if (!PANELS.includes(panel)) panel = 'home'
  current = panel
  document.querySelectorAll('[data-pane]').forEach((x) => { x.hidden = x.dataset.pane !== panel })
  document.querySelectorAll('#ja-nav [data-go], #ja-tabs [data-go]').forEach((b) => b.setAttribute('aria-current', b.dataset.go === panel ? 'page' : 'false'))
  // The section holding the page opens (a page reached from a button elsewhere).
  const grp = document.querySelector(`#ja-nav [data-go="${panel}"]`)?.closest('[data-navgrp].is-shut')
  if (grp) { grp.classList.remove('is-shut'); grp.querySelector('[data-navsec]')?.setAttribute('aria-expanded', 'true') }
  document.querySelector('#ja-tabs [data-more]')?.setAttribute('aria-current', !BAR.some(([k]) => k === panel) ? 'page' : 'false')
  if (location.hash.slice(1) !== panel) history.replaceState(null, '', panel === 'home' ? location.pathname + location.search : `#${panel}`)
  const el = document.querySelector(`[data-pane="${panel}"]`)
  if (el && !el.dataset.drawn) drawPane(panel)
  // Opening Book extra sessions or Holiday training: the new ones are seen.
  if ((panel === 'extra' || panel === 'holidays') && markSeen(D, panel === 'extra' ? 'extra' : 'holiday')) renderShell()
  if (!keepScroll) window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
  requestAnimationFrame(syncRails)
}
const pane = (k) => document.querySelector(`[data-pane="${k}"]`)
const DRAW = { home: () => renderHome(), sessions: () => renderSessions(), fees: () => renderFees(), family: () => renderFamily(), news: () => renderNews(), info: () => renderInfo(), waivers: () => renderWaivers(), cancel: () => renderCancel(), keep: () => renderKeep(), term: () => renderTerm(), holidays: () => renderHolidays(), extra: () => renderExtra(pane('extra'), D), analysis: () => renderAnalysis(pane('analysis'), D), videos: () => renderVideos(), app: () => renderApp(), contact: () => renderContact(), notes: () => renderNotes(pane('notes'), D, () => renderShell()), reports: () => renderReports(pane('reports'), D, () => renderShell()), alerts: () => renderAlerts(pane('alerts'), D) }
function drawPane(panel) { DRAW[panel]?.(); const el = document.querySelector(`[data-pane="${panel}"]`); if (el) el.dataset.drawn = '1' }

function render() {
  renderShell()
  // Data changed: draw again whatever has been opened.
  document.querySelectorAll('[data-pane]').forEach((el) => { delete el.dataset.drawn })
  drawPane(current)
  if (current !== 'home') drawPane('home')
}

// ---------- home ----------

// The next session (redesign, 17 Oct 2026): a photo strip with the countdown,
// then the player, the day and time large, the place, Directions and Can't
// make it. Never a coach's name (Lee, 14 Oct 2026).
function ticket({ p, e, next }) {
  const day = fmt(next.startMs, { weekday: 'short' })
  const when = countdown(next.startMs)
  const label = `${p.name}, ${fmt(next.startMs, { weekday: 'long', day: 'numeric', month: 'long' })}, ${e.time}, ${e.location}`
  return `<article class="ja-next" aria-label="Next session: ${esc(label)}">
    <div class="ja-next-ph"><img src="${esc(VENUE_CARD[e.locationId] || photoFor(e))}" alt="" fetchpriority="high"><span class="ja-next-when">${esc(when)}</span>${e.status && e.status !== 'Confirmed' ? `<span class="ja-next-st">${esc(e.status)}</span>` : '<span class="ja-next-st ok"><i></i>Session on</span>'}</div>
    <div class="ja-next-bd">
      <p class="ja-next-who">${esc(p.name)}</p>
      <h2 class="ja-next-t">${esc(day)} ${esc(e.time)}</h2>
      <p class="ja-next-dt">${esc(fmt(next.startMs, { weekday: 'long', day: 'numeric', month: 'long' }))}</p>
      <div class="ja-next-where"><span class="ja-mr-ic">${ic('pin')}</span><span><b>${esc(e.location)}</b><small>${esc(e.durationMin || 60)} min</small></span></div>
      <div class="ja-next-act">
        ${e.maps ? `<a class="ja-btn ja-btn-line" href="${esc(e.maps)}" target="_blank" rel="noopener noreferrer">${ic('pin')}Directions</a>` : ''}
        ${e.asksComing && !next.cancelled ? comingBtn(e, next.iso, (e.coming || []).includes(next.iso), fmt(next.startMs, { weekday: 'short', day: 'numeric', month: 'short' }), p).replace('ja-btn-sm ', '') : ''}
        <button type="button" class="ja-btn ja-btn-line" data-cancel-open="${esc(e.rowId)}" data-cancel-player="${esc(p.key)}" data-cancel-date="${esc(next.iso)}">${ic('xcircle')}Can't make it</button>
      </div>
    </div>
  </article>`
}
// The other players' next sessions, one row each.
function nextRow(x) {
  return `<button type="button" class="ja-nrow" data-go="sessions" data-kid="${esc(x.p.key)}"><span class="ja-avatar">${esc(initials(x.p.name))}</span><span class="ja-mr-tx"><b>${esc(first(x.p.name))} · ${esc(fmt(x.next.startMs, { weekday: 'short' }))} ${esc(x.e.time)}</b><small>${esc(x.e.location)}</small></span><span class="ja-nrow-when">${esc(countdown(x.next.startMs))}</span>${ic('right', 'ja-mr-go')}</button>`
}

// What a family still has to do, in the order Lee wants on sign in (13 Oct
// 2026): 1 sign the waiver, 2 pay (payment requests, then anything owing
// with no link yet), 3 player information Lee and Ligia need for grouping.
function infoGaps() {
  if (!PROF) return []
  return PROF.players.map((p) => ({ p, missing: missingInfo({ ...p.prefill, ...(p.profile || {}) }, Boolean(p.profile)) })).filter((x) => x.missing.length)
}
function missingInfo(v, saved) {
  const out = []
  if (!saved) out.push('check the details')
  if (!v.club && !['Not playing club football', 'School or social only'].includes(v.level)) out.push('club')
  if (!(v.positions || []).length) out.push('position')
  if (!v.emergencyName || !v.emergencyPhone) out.push('emergency contact')
  return out
}
function stepList(kicker, title, rows) {
  return rows.length ? `<div class="ja-card ja-todo"><div class="ja-card-head"><div><p class="ja-kicker"><i></i>${esc(kicker)}</p><h3 class="ja-h3" style="margin-top:8px;font-size:18px">${esc(title)}</h3></div></div><ul class="ja-list">${rows.map((r, i) => `<li class="ja-row"><span class="ja-num">${i + 1}</span><div><b>${esc(r.title)}</b><small>${esc(r.sub)}</small></div>${r.btn}</li>`).join('')}</ul></div>` : ''
}
// Round 3 (Lee, 14 Oct 2026): every payment is drawn by jfp-account-pay.js,
// the same card on Home and on Fees. Home shows what to pay now and, for
// session by session players, the next session and the best value.
function todoCards() {
  const want = q.get('pay')
  const pays = oweList(D, want).map((x) => oweCard(x, 'home'))
  const ahead = (D.owed || []).filter((o) => o.kind === 'prepay').map((o) => aheadBlock(D, o, { pane: 'home', compact: true }))
  // Players whose waiver is not part of a payment card above: step 1, first.
  const inCards = new Set([...D.todo.flatMap((t) => t.players), ...(D.owed || []).map((o) => o.player)])
  const waivers = D.players.filter((p) => !p.waiver.onFile && !inCards.has(p.name) && !(p.byAgent && !D.playerLogin)).map((p) => ({ title: p.adult ? (D.self || solo() ? 'Sign your waiver' : `Sign ${first(p.name)}'s waiver`) : `Sign ${first(p.name)}'s waiver`, sub: 'Every JFP player needs one on file. It takes two minutes.', btn: `<button type="button" class="ja-btn ja-btn-light ja-btn-sm" data-waiver-player="${esc(p.key)}">Sign</button>` }))
  const info = infoGaps().map(({ p, missing }) => {
    const need = missing.filter((m) => m !== 'check the details')
    const what = need.length ? `Add ${need.length > 1 ? `${need.slice(0, -1).join(', ')} and ${need.at(-1)}` : need[0]}.` : 'Check what your waiver told us and save.'
    const mine = !D.agent && (p.self || D.self)
    return { title: mine ? 'Your player details' : `${first(p.name)}'s player information`, sub: `${what} It helps us put ${mine ? 'you' : first(p.name)} in the right group.`, btn: '<button type="button" class="ja-btn ja-btn-light ja-btn-sm" data-go="info">Update</button>' }
  })
  return stepList('To do first', waivers.length === 1 ? 'Sign the waiver' : 'Sign the waivers', waivers) + agentWaiverSteps() + pays.join('') + ahead.join('') + jjTodoCards() + depositCards(D, { compact: true, self: Boolean(D.self || solo()) }) + stepList('Then', info.length === 1 ? 'Update player details' : `${info.length} player details to update`, info)
}
// One line on Home instead of a stack of cards (redesign, 17 Oct 2026):
// "N things to sort", red when there is money to pay. Tapping it opens the
// same cards in a sheet.
function todoSummary() {
  const pay = oweList(D).length + (D.juniors?.todo || []).length
  const ahead = (D.owed || []).filter((o) => o.kind === 'prepay').length
  const waivers = D.players.filter((p) => !p.waiver.onFile && !(p.byAgent && !D.playerLogin)).length + agentWaiting().length
  const info = infoGaps().length
  const deposit = depositCards(D, { compact: true, self: Boolean(D.self || solo()) }) ? 1 : 0
  const bits = [pay && `${pay} to pay`, waivers && `${waivers} waiver${waivers > 1 ? 's' : ''}`, info && `${info} player detail${info > 1 ? 's' : ''}`, deposit && 'next term', ahead && !pay && 'pay ahead']
  return { n: pay + waivers + info + deposit + (pay ? 0 : ahead), pay, line: bits.filter(Boolean).join(' · ') }
}
// An agent's account (Lee, 20 Oct 2026): each player signs their own waiver
// from their own login. The agent's step is to give them one.
const agentWaiting = () => (D?.agent && !D.playerLogin ? D.players.filter((p) => p.byAgent && !p.waiver?.onFile && !p.login) : [])
function agentWaiverSteps() {
  if (!D?.agent || D.playerLogin) return ''
  const rows = D.players.filter((p) => p.byAgent && !p.waiver?.onFile).map((p) => ({
    title: `${first(p.name)}'s waiver`,
    sub: p.login ? `${first(p.name)} has a login (${p.login}) and signs it there. A parent signs if they are under 18.` : `${first(p.name)} signs it, not you (a parent signs if they are under 18). Give them a login and they sign it there.`,
    btn: p.login ? '' : `<button type="button" class="ja-btn ja-btn-light ja-btn-sm" data-login-set="${esc(p.key)}">Give a login</button>`,
  }))
  return stepList('Waivers', rows.length === 1 ? 'The player signs their waiver' : 'Players sign their own waivers', rows)
}
function agentWaiverSheet(p) {
  const sheet = openSheet({ title: `${first(p.name)}'s waiver`, subtitle: 'The player signs it, not the agent' })
  sheet.body.innerHTML = `<p>Every JFP player needs a waiver on file. ${esc(first(p.name))} signs their own, or a parent signs if they are under 18.</p><p style="margin-top:10px">${p.login ? `${esc(first(p.name))} already has a login (${esc(p.login)}). Ask them to sign in and sign it there.` : `Give ${esc(first(p.name))} their own login with their own email. They sign in and sign the waiver there. They only see their own sessions, never your payments.`}</p>`
  sheet.foot.innerHTML = p.login ? '<button type="button" class="ja-btn ja-btn-line" data-close-sheet>Close</button>' : `<button type="button" class="ja-btn ja-btn-red" data-login-set="${esc(p.key)}">Give ${esc(first(p.name))} a login</button>`
  sheet.foot.querySelector('[data-close-sheet]')?.addEventListener('click', () => closeSheet())
  sheet.foot.querySelector('[data-login-set]')?.addEventListener('click', () => closeSheet(true))
}
function todoStrip() {
  const t = todoSummary()
  if (!t.n) return ''
  return `<button type="button" class="ja-strip${t.pay ? ' is-pay' : ''}" data-todo-open><span class="n">${t.n}</span><span class="ja-mr-tx"><b>${t.n === 1 ? '1 thing to sort' : `${t.n} things to sort`}</b><small>${esc(t.line)}</small></span>${ic('right', 'ja-mr-go')}</button>`
}
function todoSheet() {
  const sheet = openSheet({ title: 'To sort', subtitle: D.agent && !D.playerLogin ? 'Payments first, then player logins and details.' : 'Waivers first, then payments, then player details.' })
  sheet.sheet.classList.add('ja-todo-sheet')
  sheet.body.innerHTML = `<div class="ja-stack">${todoCards()}</div>`
  return sheet
}


// Announcements (Lee, 17 Oct 2026): one-way notices from Joner Football,
// newest (or pinned) first. Families read them here; there is no reply.
const annBody = (t) => esc(t).replace(/\n/g, '<br>')
function newsBlock() {
  const list = D?.announcements || []
  if (!list.length) return ''
  const a = list[0]
  return `<p class="ja-label">From Joner Football</p><article class="ja-card ja-news" aria-label="Announcement: ${esc(a.title)}">
    <p class="ja-news-meta">${!a.read ? '<span class="ja-tag red">New</span>' : ''}${a.pinned ? '<span class="ja-tag">Pinned</span>' : ''}<span>${esc(a.dateLabel)}${a.forLabel ? ` · ${esc(a.forLabel)}` : ''}</span></p>
    <h3 class="ja-h3">${esc(a.title)}</h3><p class="ja-news-body">${annBody(a.body)}</p>
    ${list.length > 1 ? `<button type="button" class="ja-btn ja-btn-ghost ja-btn-sm" data-go="news">See all ${list.length} announcements</button>` : ''}</article>`
}
// The Announcements page: every notice, newest (pinned) first. Opening it
// marks them read for this sign-in email, so the red number goes.
function renderNews() {
  const el = pane('news')
  const list = D?.announcements || []
  el.innerHTML = `${pageHead('From Joner Football', 'Announcements', '')}<div class="ja-stack ja-news-list">${list.map((a) => `<article class="ja-card ja-news${a.read ? '' : ' is-unread'}" aria-label="${a.read ? '' : 'New: '}${esc(a.title)}"><p class="ja-news-meta">${a.read ? '' : '<span class="ja-tag red">New</span>'}${a.pinned ? '<span class="ja-tag">Pinned</span>' : ''}<span>${esc(a.dateLabel)}${a.forLabel ? ` · ${esc(a.forLabel)}` : ''}</span></p><h3 class="ja-h3">${esc(a.title)}</h3><p class="ja-news-body is-full">${annBody(a.body)}</p></article>`).join('') || '<div class="ja-card"><p class="ja-muted">No announcements right now.</p></div>'}</div>`
  const ids = list.filter((a) => !a.read).map((a) => a.id)
  if (!ids.length) return
  api('/api/jfp-account', { action: 'announceRead', ids }).then((r) => {
    if (!r.ok) return
    for (const a of D.announcements || []) if (ids.includes(a.id)) a.read = true
    renderShell()
  })
}

function renderHome() {
  const el = document.querySelector('[data-pane="home"]')
  if (!D) return
  const tw = termWeek()
  // A player who is their own contact is greeted by their own name.
  const name = D.self ? first(D.players[0]?.name) : D.parentName ? first(D.parentName) : ''
  const today = fmt(Date.now(), { weekday: 'long', day: 'numeric', month: 'long' })
  const head = `<header class="ja-head"><p class="ja-kicker"><i></i>${esc(today)}${tw && /^Week/.test(tw.label) ? ` · ${esc(tw.label)}` : ''}</p><h1 class="ja-display">${name ? `Hi ${esc(name)}` : 'Welcome'}</h1></header>`
  const promos = `<section class="ja-sec">${secHead('More from JFP')}<div class="ja-rail-wrap"><div class="ja-rail promos">
      <button type="button" class="ja-promo" data-go="keep"><img src="${IMG}/photos/lee-coaching-field-900x1100.webp" alt="" loading="lazy"><span class="go">${ic('arrow')}</span><p class="ja-kicker"><i></i>${esc(D.keep?.name || 'Next term')}</p><h3>Keep your spot</h3><p>Same day, same time, same group. Current ${D.self ? 'players' : 'families'} get first call.</p></button>
      <button type="button" class="ja-promo" data-go="holidays"><img src="${IMG}/photos/hq-indoor-800x1000.webp" alt="" loading="lazy"><span class="go">${ic('arrow')}</span><p class="ja-kicker"><i></i>School holidays</p><h3>Holiday training</h3><p>JFP players book holiday training and camps first.</p></button>
      <button type="button" class="ja-promo red" data-go="app"><img src="/images/app/joner-app-main-iphone-current-transparent.webp" alt="" loading="lazy"><span class="go">${ic('arrow')}</span><p class="ja-kicker"><i></i>Free for JFP players</p><h3>The JF App</h3><p>Keep training between sessions.</p></button>
    </div></div></section>`
  const watch = `<section class="ja-sec">${secHead('Watch at HQ', 'Real sessions from inside Joner Football HQ.', 'r-home')}<div class="ja-rail-wrap"><div class="ja-rail" id="r-home">${hqVideos.slice(0, 6).map(vidCard).join('')}</div></div><p style="margin-top:14px"><button type="button" class="ja-btn ja-btn-line ja-btn-sm" data-go="videos">All training videos ${ic('arrow')}</button></p></section>`
  // A Juniors-only family: the Juniors card and its to do, no JFP "nothing booked".
  if (!D.players.length && D.juniors) {
    el.innerHTML = `<header class="ja-head"><p class="ja-kicker"><i></i>Joners Juniors · ${esc(D.juniors.term)}</p><h1 class="ja-display">${name ? `Hi ${esc(name)}` : 'Welcome'}</h1></header>
      <div class="ja-home"><div class="ja-stack">${jjHomeCard()}</div><div class="ja-stack">${newsBlock()}${todoCards()}${requestsBlock()}</div></div>${watch}`
    return
  }
  // Anyone can have an account (round 2 item 8): nobody booked into a
  // session yet. Book a session, add players and their details, sign waivers.
  if (!D.players.some((p) => p.enrolments.length || p.placeNoSession)) {
    const list = D.players.length ? `<div class="ja-card"><div class="ja-card-head"><h3 class="ja-h3">${D.self ? 'Your profile' : 'Your players'}</h3><button type="button" class="ja-link ja-small" data-go="info">${D.self ? 'My profile' : 'Player information'}</button></div><ul class="ja-list">
      ${D.players.map((p) => `<li class="ja-row">${face(p.name, p.photo)}<div><b>${esc(p.name)}</b><small>Not booked into a session yet</small></div><div class="ja-flags">${p.waiver.onFile ? '<span class="ja-dot ok">Waiver</span>' : `<button type="button" class="ja-dot bad" data-waiver-player="${esc(p.key)}">Sign waiver</button>`}</div></li>`).join('')}</ul></div>` : ''
    el.innerHTML = `${head}
      <div class="ja-ticket" style="min-height:420px" data-no-session><img src="${IMG}/photos/ntra-field-900x1100.webp" alt=""><div class="ja-ticket-top"><span class="ja-live"><i></i>${esc(D.term)}</span></div>
        <div class="ja-ticket-body"><h2 class="ja-ticket-date"><span>You're not booked</span><span class="t">into a session yet</span></h2>
        <p class="ja-meta">Pick a session on the timetable. ${D.players.length ? 'Your player details are saved, so booking is quick.' : 'Add your players first and booking is quick.'}</p>
        <div class="ja-actions"><a class="ja-btn ja-btn-red" href="${esc(D.bookUrl || '/jfp-booking/')}">Book a session</a><button type="button" class="ja-btn ja-btn-glass" data-add-player>${D.players.length ? 'Add another player' : 'Add a player'}</button></div>
        <p class="ja-small" style="margin-top:14px;color:rgba(255,255,255,.75)">Booked with another email? Sign out and use that one. Already train with us? <button type="button" class="ja-link" data-go="contact" style="color:#fff">Contact us</button></p></div></div>
      <div class="ja-stack" style="margin-top:14px">${newsBlock()}${todoCards()}${list}${requestsBlock()}</div>${promos}${watch}`
    return
  }
  const ups = upcoming().filter((x) => x.next)
  const notBooked = D.players.filter((p) => !p.enrolments.length)
  // Today first (redesign, 17 Oct 2026): the next session, the other
  // players' next sessions, one "to sort" line, then everything else.
  const nextBlock = ups.length
    ? `${ticket(ups[0])}${ups.length > 1 ? `<div class="ja-card ja-nlist">${ups.slice(1).map(nextRow).join('')}</div>` : ''}`
    : `<div class="ja-card"><h3 class="ja-h3">No more sessions this term</h3><p class="ja-muted" style="margin-top:6px">See you next term. <button type="button" class="ja-link" data-go="keep">Keep your spot</button>.</p></div>`
  // Players booked this term with nothing still to come, by name.
  const finished = upcoming().filter((x) => !x.next)
  const doneBlock = finished.length ? `<div class="ja-card ja-nlist">${finished.map((x) => `<button type="button" class="ja-nrow" data-go="sessions" data-kid="${esc(x.p.key)}"><span class="ja-avatar">${esc(initials(x.p.name))}</span><span class="ja-mr-tx"><b>${esc(x.p.name)}</b><small>${esc(x.e.day)}s ${esc(x.e.time)}, ${esc(x.e.location)} · No more sessions this term</small></span>${ic('right', 'ja-mr-go')}</button>`).join('')}</div>` : ''
  const strip = todoStrip()
  el.innerHTML = `${head}
    <div class="ja-home">
      <div class="ja-stack"><p class="ja-label">Next up</p>${nextBlock}${doneBlock}</div>
      <div class="ja-stack">${D.playerLogin ? playerWaiverStep() : strip ? `<p class="ja-label">To do</p>${strip}` : `<div class="ja-strip is-done">${ic('check')}<span class="ja-mr-tx"><b>All sorted</b><small>Nothing to sign or pay right now.</small></span></div>`}${reportsHomeBlock(D)}${makeupsHomeBlock(D)}${notesHomeBlock(D)}${newsBlock()}
        ${jjHomeCard()}${notBooked.length ? `<div class="ja-card"><p class="ja-small ja-muted">${notBooked.map((p) => p.placeNoSession ? `<b class="ja-ink">${esc(p.name)}</b> has a place. We will confirm the day and time.` : `<b class="ja-ink">${esc(p.name)}</b> is not booked this term. <a class="ja-link" href="${links.booking}">See the timetable</a>`).join('<br>')}</p></div>` : ''}${requestsBlock()}</div>
    </div>
    ${D.playerLogin ? '' : promos}${watch}`
}

// An agent's player, signed in with their own login: their waiver (Lee, 20 Oct 2026).
function playerWaiverStep() {
  const p = D.players.find((x) => x.agentPlayer && !x.waiver?.onFile)
  if (!p) return ''
  return stepList('To do first', 'Sign your waiver', [{ title: 'Sign your waiver', sub: 'Every JFP player needs one on file. Under 18? A parent or guardian signs it here with you.', btn: `<button type="button" class="ja-btn ja-btn-light ja-btn-sm" data-waiver-player="${esc(p.key)}">Sign</button>` }])
}

function requestsBlock() {
  if (!D.requests?.length) return ''
  const kind = { application: 'Application', waitlist: 'Waitlist', enquiry: 'Enquiry' }
  const state = { pending: 'Waiting for review, we reply within 48 hours', offered: 'Place offered, see To do', declined: 'Not this term', done: 'Closed', expired: 'Offer expired, contact us' }
  return `<div class="ja-card"><h3 class="ja-h3">Applications</h3><ul class="ja-list" style="margin-top:8px">${D.requests.map((r) => `<li class="ja-row"><span class="ja-avatar">${esc(initials(r.players[0] || 'J'))}</span><div><b>${esc(kind[r.kind] || r.kind)}: ${esc(r.players.join(', '))}</b><small>${esc(r.group)}</small></div><span class="ja-dot ${r.status === 'offered' ? 'ok' : r.status === 'pending' ? 'warn' : ''}">${esc(r.status === 'offered' && r.offer === 'trial' ? 'Trial offered' : state[r.status] || state.pending)}</span></li>`).join('')}</ul></div>`
}

// ---------- my sessions ----------

function renderSessions() {
  const el = document.querySelector('[data-pane="sessions"]')
  if (!D.players.some((p) => p.enrolments.length)) {
    el.innerHTML = D.juniors
      ? `${pageHead('My sessions', D.juniors.term, 'Every Joners Juniors class this term. The next one is marked.')}${jjSessions()}`
      : `${pageHead('My sessions', D.term, 'Nothing booked yet.')}<a class="ja-btn ja-btn-red" href="${links.booking}">See the timetable</a>`
    return
  }
  // Redesign (17 Oct 2026): a chip per player, past dates fold into one
  // "N done" line, the next 3 dates show, then "Show all". The next date has
  // the solid Can't make it; later dates a quieter one.
  const kids = D.players.filter((p) => p.enrolments.length)
  if (sessKid !== 'all' && !kids.some((p) => p.key === sessKid)) sessKid = 'all'
  const chips = kids.length > 1 || D.juniors ? `<div class="ja-kchips" role="group" aria-label="Show sessions for">${[['all', 'All'], ...kids.map((p) => [p.key, first(p.name)])].map(([k, l]) => `<button type="button" class="ja-kchip" data-kid-pick="${esc(k)}" aria-pressed="${sessKid === k}">${k === 'all' ? '' : `<span class="ja-avatar">${esc(initials(kids.find((p) => p.key === k)?.name))}</span>`}${esc(l)}</button>`).join('')}</div>` : ''
  el.innerHTML = `${pageHead(D.term, 'Sessions', '')}${chips}<div class="ja-sgrid">
    ${kids.filter((p) => sessKid === 'all' || p.key === sessKid).map((p) => p.enrolments.map((e) => {
      const future = new Map((e.sessions || []).map((s) => [s.label, s]))
      const told = new Map((e.cancelled || []).map((c) => [c.label, c]))
      const nextLabel = (e.sessions || []).find((s) => !s.cancelled)?.label
      // Session by session (round 2): a Paid / Not paid yet mark on each date
      // still to come, and a way to pay for sessions.
      const paidSet = new Set(e.paidDates || []), openSet = new Set(e.openDates || [])
      const canPay = e.sessionPay && (D.owed || []).some((o) => o.rowId === e.rowId && o.kind === 'prepay')
      const mark = (iso, upcoming) => {
        if (!e.sessionPay || !iso) return ''
        if (paidSet.has(iso)) return '<span class="ja-tag green">Paid</span>'
        if (!upcoming) return ''
        if (openSet.has(iso)) return '<span class="ja-tag amber">Payment started</span>'
        return '<span class="ja-tag grey">Not paid yet</span>'
      }
      const rows = e.dates.map((label, i) => ({ label, i, s: future.get(label), c: told.get(label) }))
      const done = rows.filter((r) => !r.s)
      const ahead = rows.filter((r) => r.s)
      const all = expanded.has(e.rowId)
      const shown = all ? rows : ahead.slice(0, 3)
      // I'm coming (Lee, 20 Oct 2026): session by session and Pro places tell the coach which weeks they will be at.
      const comingSet = new Set(e.coming || [])
      const date = ({ label, i, s, c }) => {
        const [dow, dd, mon] = label.split(' ')
        const yes = Boolean(e.asksComing && s && !c && comingSet.has(s.iso))
        const isNext = label === nextLabel
        const pm = mark(e.isoDates?.[i] || s?.iso, Boolean(s) && !c)
        const cls = !s ? 'is-past' : c ? 'is-off' : isNext ? 'is-next' : ''
        const right = !s ? pastMark(e, i)
          : c ? `<button type="button" class="ja-btn ja-btn-line ja-btn-sm" data-cancel-undo="${esc(c.id)}">Undo</button>`
          : e.asksComing ? `<span class="ja-yn">${comingBtn(e, s.iso, yes, `${dow} ${dd} ${mon}`, p)}<button type="button" class="ja-btn ja-btn-ghost ja-btn-sm" data-cancel-open="${esc(e.rowId)}" data-cancel-player="${esc(p.key)}" data-cancel-date="${esc(s.iso)}" aria-label="${esc(`${first(p.name)} can't make ${dow} ${dd} ${mon}`)}">Can't make it</button></span>`
          : `<button type="button" class="ja-btn ${isNext ? 'ja-btn-line' : 'ja-btn-ghost'} ja-btn-sm" data-cancel-open="${esc(e.rowId)}" data-cancel-player="${esc(p.key)}" data-cancel-date="${esc(s.iso)}" aria-label="${esc(`${first(p.name)} can't make ${dow} ${dd} ${mon}`)}">Can't make it</button>`
        const aria = `${p.name}, ${dow} ${dd} ${mon}, ${e.time}, ${e.location}${!s ? ', done' : c ? ', you told us they cannot make it' : isNext ? ', next session' : ''}${yes ? ', coming' : ''}`
        return `<li class="ja-date ${cls}" aria-label="${esc(aria)}"><span class="d"><b>${esc(dd)}</b><i>${esc(mon)}</i></span><span class="w"><b>${esc(dow)} ${esc(e.time)}${isNext ? '<span class="ja-tag">Next</span>' : ''}${c ? '<span class="ja-tag amber">You told us</span>' : ''}${pm}</b>Week ${i + 1}${isNext && s ? ` · ${esc(countdown(s.startMs))}` : ''}${c ? `, ${esc(c.reason)}` : ''}</span>${right}</li>`
      }
      return `<section class="ja-card ja-scard" data-enrol="${esc(e.rowId)}">
        <div class="ja-enrol-head"><img src="${esc(photoFor(e))}" alt="" loading="lazy"><div><h2>${esc(p.name)}</h2><p>${esc(e.day)}s ${esc(e.time)} · ${esc(e.location)} · ${esc(e.durationMin || 60)} min</p>${e.payment ? `<p style="margin-top:6px">${payDot(e.payment)}</p>` : ''}</div></div>
        ${e.sessionPay ? `<p class="ja-small ja-muted" style="margin-top:10px">Paid: paid ahead. Not paid yet: billed after the session, or pay ahead now.</p>` : ''}
        ${comingBar(e)}
        ${done.length && !all ? attendanceLine(e) || `<p class="ja-done-line">${ic('check')}<span>${done.length} done this term</span></p>` : ''}
        <ol class="ja-dates">${shown.map(date).join('')}</ol>
        ${rows.length > shown.length || all ? `<p class="ja-more-dates"><button type="button" class="ja-btn ja-btn-line ja-btn-sm" data-expand="${esc(e.rowId)}" aria-expanded="${all}">${all ? 'Show less' : `Show all ${rows.length} weeks`}</button></p>` : ''}
        <div class="ja-actions">${canPay ? `<button type="button" class="ja-btn ja-btn-red ja-btn-sm" data-go-pay="${esc(e.rowId)}">${ic('card')}Pay for sessions</button>` : ''}${e.maps ? `<a class="ja-btn ja-btn-line ja-btn-sm" href="${esc(e.maps)}" target="_blank" rel="noopener noreferrer">${ic('pin')}Directions</a>` : ''}<button type="button" class="ja-btn ja-btn-line ja-btn-sm" data-ics="${esc(e.rowId)}">${ic('calplus')}Add to calendar</button></div>
      </section>`
    }).join('')).join('')}</div>${sessKid === 'all' ? jjSessions() : ''}`
}
let sessKid = 'all'
const expanded = new Set()

// I'm coming: a toggle per date, and one tap for every week still to come.
function comingBtn(e, iso, yes, when, p) {
  return `<button type="button" class="ja-btn ja-btn-sm ja-coming" data-coming="${esc(e.rowId)}" data-coming-date="${esc(iso)}" aria-pressed="${yes}" aria-label="${esc(yes ? `${first(p.name)} is coming ${when}. Tap to take it back` : `${first(p.name)} is coming ${when}`)}">${yes ? `${ic('check')}Coming` : "I'm coming"}</button>`
}
function comingOpen(e) {
  const told = new Set((e.cancelled || []).map((c) => c.date))
  return (e.sessions || []).filter((s) => !told.has(s.iso)).map((s) => s.iso)
}
function comingBar(e) {
  if (!e.asksComing) return ''
  const open = comingOpen(e)
  if (!open.length) return ''
  const said = new Set(e.coming || [])
  const left = open.filter((d) => !said.has(d))
  return `<div class="ja-coming-bar"><p class="ja-small"><b>Which weeks can you make?</b> You pay by the session, so tap <b>I'm coming</b> or <b>Can't make it</b> for each date. Your coach uses it to plan.</p>
    <p class="ja-small ja-muted" style="margin-top:4px">${said.size ? `Coming to ${said.size} of ${open.length} week${open.length === 1 ? '' : 's'} still to come.` : 'Nothing picked yet.'}</p>
    ${left.length > 1 ? `<div class="ja-actions" style="margin-top:8px"><button type="button" class="ja-btn ja-btn-line ja-btn-sm" data-coming-all="${esc(e.rowId)}">${ic('check')}I'm coming to all ${left.length} weeks left</button></div>` : ''}</div>`
}
async function comingSave(btn, rowId, dates, on) {
  const en = D.players.flatMap((p) => p.enrolments).find((x) => x.rowId === rowId)
  if (!en) return
  btn.disabled = true
  const r = await api('/api/jfp-account', { action: 'comingSession', rowId, dates, on })
  btn.disabled = false
  if (!r.ok) return toast(r.data?.error || 'Could not save that. Try again.')
  en.coming = r.data.coming || []
  toast(on ? (dates.length > 1 ? `Saved. Your coach can see you are coming to ${r.data.dates.length} weeks.` : 'Saved. Your coach can see you are coming.') : 'Taken back.')
  renderSessions(); renderHome()
}

// ---------- player information ----------

const OPT = {
  levels: ['A-League academy', 'NPL', 'Youth league (BYL or GYL)', 'JDL (was SAP)', 'Club Division 1', 'Club Division 2', 'Club Division 3 or lower', 'School or social only', 'Not playing club football'],
  playingUp: ['Own age', 'Playing up', 'Playing down'],
  positions: ['Goalkeeper', 'Centre back', 'Full back', 'Defensive midfield', 'Central midfield', 'Attacking midfield', 'Winger', 'Striker'],
  feet: ['Right', 'Left', 'Both'],
}
function renderInfo() {
  const el = document.querySelector('[data-pane="info"]')
  if (!el || !D) return
  const list = PROF?.players || []
  const me = list.length === 1 && list[0].self
  const head = (me || D.self)
    ? pageHead('My profile', 'Your details', 'Your club, position and who to call in an emergency. Lee and Ligia use this to put you in the right group, so keep it up to date. Your photo is only seen by Joner Football staff and coaches.')
    : pageHead('Player information', list.length === 1 ? `${first(list[0].name)}'s details` : 'Your players', 'Club, position and who to call. Lee and Ligia use this to put players in the right group, so keep it up to date. Changed clubs? Update it here and we see it straight away. Photos are only seen by Joner Football staff and coaches.')
  if (!PROF) { el.innerHTML = `${head}<div class="ja-card ja-muted">Loading player information</div>`; return }
  // Anyone can add a player, booked or not (round 2 item 8).
  const addBar = `<div class="ja-actions" style="margin:0 0 14px"><button type="button" class="ja-btn ja-btn-line ja-btn-sm" data-add-player>+ Add a player</button></div>`
  if (!PROF.players.length) { el.innerHTML = `${head}<div class="ja-card"><h3 class="ja-h3">No players yet</h3><p class="ja-muted" style="margin-top:6px">Add a player (or yourself, if you are the player) and fill in their details. You do not need a session booked.</p><div class="ja-actions"><button type="button" class="ja-btn ja-btn-red" data-add-player>Add a player</button></div></div>`; return }
  const o = PROF.options || OPT
  el.innerHTML = head + addBar + PROF.players.map((pl) => {
    const v = { ...pl.prefill, ...(pl.profile || {}) }
    const miss = missingInfo(v, Boolean(pl.profile))
    const done = 4 - miss.length
    const f = (id, label, val, attrs = '') => `<label class="j-field"><span>${label}</span><input class="j-input" data-f="${id}" value="${esc(val || '')}" ${attrs}></label>`
    const seg = (key, list) => `<div class="j-field full"><span>${{ playingUp: 'Plays', foot: 'Stronger foot' }[key]}</span><div class="ja-seg" data-seg="${key}">${list.map((x) => `<button type="button" class="j-chip" data-val="${esc(x)}" aria-pressed="${v[key] === x}">${esc(x)}</button>`).join('')}</div></div>`
    return `<section class="ja-card" style="margin-bottom:14px" data-prof="${esc(pl.key)}">
      <div class="ja-card-head"><div><h2 class="ja-h2">${esc(pl.name)}</h2>
        <div class="ja-meter"><div class="bar"><span style="width:${Math.round((done / 4) * 100)}%"></span></div><small>${miss.length ? `Still to add: ${esc(miss.filter((m) => m !== 'check the details').join(', ') || 'check and save')}` : 'All done'}</small></div>
        ${pl.profile?.updatedAt ? `<p class="ja-small ja-muted" style="margin-top:8px">Last updated ${esc(new Date(pl.profile.updatedAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }))}${pl.profile.updatedFrom === 'Staff portal' ? ' by Joner Football' : ''}.</p>` : '<p class="ja-small ja-muted" style="margin-top:8px">We filled in what your waiver told us. Please check it and save.</p>'}
      </div>${photoPicker(pl)}</div>
      <div class="ja-form">
        <h4>Football</h4>
        ${f('club', 'Club', v.club, `placeholder="For example, Manly United" autocomplete="off" list="clubs-${esc(pl.key)}"`)}
        <datalist id="clubs-${esc(pl.key)}">${(o.clubs || []).map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
        ${f('team', 'Team and age group', v.team, 'placeholder="For example, U13 Div 1" autocomplete="off"')}
        ${f('association', 'Association <span class="muted">(optional)</span>', v.association, 'placeholder="For example, MWFA or NWSF"')}
        ${f('previousClubs', 'Previous clubs <span class="muted">(optional)</span>', v.previousClubs)}
        <label class="j-field"><span>Years playing</span><select class="j-select" data-f="yearsPlaying"><option value="">Choose</option>${(o.years || ['Under 1 year', '1 to 2 years', '3 to 4 years', '5 or more years']).map((x) => `<option ${v.yearsPlaying === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></label>
        ${f('repTeam', 'Rep, academy or squads <span class="muted">(optional)</span>', v.repTeam, 'placeholder="For example, Manly United academy"')}
        ${f('otherTraining', 'Other training each week <span class="muted">(optional)</span>', v.otherTraining, 'placeholder="For example, futsal on Mondays"')}
        <label class="j-field"><span>Level</span><select class="j-select" data-f="level"><option value="">Choose</option>${o.levels.map((x) => `<option ${v.level === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></label>
        ${pl.self ? '' : seg('playingUp', o.playingUp)}
        <div class="j-field full"><span>Positions <span class="muted">(choose any)</span></span><div class="ja-seg" data-multi="positions">${o.positions.map((x) => `<button type="button" class="j-chip" data-val="${esc(x)}" aria-pressed="${(v.positions || []).includes(x)}">${esc(x)}</button>`).join('')}</div></div>
        ${seg('foot', o.feet)}
        <label class="j-field full"><span>${(pl.self || D.self) ? 'What do you want to work on? Anything the coaches should know?' : `What does ${esc(first(pl.name))} want to work on? Anything the coaches should know?`} <span class="muted">(optional, your coach sees this)</span></span><textarea class="j-textarea" data-f="goals" rows="2" maxlength="1000">${esc(v.goals || '')}</textarea></label>
        <h4>Player</h4>
        ${f('dob', 'Date of birth', v.dob, `type="date" min="${esc(PROF.dob?.min || '1940-01-01')}" max="${esc(PROF.dob?.max || new Date().toISOString().slice(0, 10))}"`)}
        ${(pl.self || D.self) ? `<h4>Contact</h4>
        ${f('parentMobile', 'Your mobile', v.parentMobile, 'type="tel" inputmode="tel" autocomplete="tel"')}` : `<h4>Parents</h4>
        ${f('parentName', 'Parent name', v.parentName, 'autocomplete="name"')}
        ${f('parentMobile', 'Parent mobile', v.parentMobile, 'type="tel" inputmode="tel" autocomplete="tel"')}
        ${f('parent2Name', 'Second parent <span class="muted">(optional)</span>', v.parent2Name)}
        ${f('parent2Mobile', 'Second parent mobile', v.parent2Mobile, 'type="tel" inputmode="tel"')}
        ${f('parent2Email', 'Second parent email <span class="muted">(optional)</span>', v.parent2Email, 'type="email" inputmode="email"')}`}
        <h4>Emergency contact</h4>
        ${f('emergencyName', 'Name', v.emergencyName)}
        ${f('emergencyPhone', 'Phone', v.emergencyPhone, 'type="tel" inputmode="tel"')}
        ${f('emergencyRelation', 'Relationship <span class="muted">(optional)</span>', v.emergencyRelation, 'placeholder="For example, grandparent"')}
        <label class="j-field full"><span>Medical notes <span class="muted">(optional, only Lee, Ligia and the coach see them)</span></span><textarea class="j-textarea" data-f="medical" rows="2" maxlength="1000">${esc(v.medical || '')}</textarea></label>
      </div>
      <p class="j-err" data-err hidden></p>
      <div class="ja-save"><button type="button" class="ja-btn ja-btn-red" data-save-prof="${esc(pl.key)}">${(pl.self || D.self) ? 'Save my profile' : `Save ${esc(first(pl.name))}'s information`}</button><span class="ja-small ja-muted">Saves straight to our system.</span></div>
    </section>`
  }).join('')
}

// ---------- waivers ----------

// Every player's waiver in one place (round 3): signed, when and which one,
// or Sign. JFP and Joners Juniors share the family waiver.
function renderWaivers() {
  const el = pane('waivers')
  const all = [...D.players, ...(D.juniors?.children || [])]
  const due = all.filter((p) => !p.waiver?.onFile)
  el.innerHTML = `${pageHead('Player', 'Waivers', 'Every JFP player needs a waiver on file before they train. It takes two minutes, and one covers JFP and Joners Juniors.')}
    ${due.length > 1 ? `<div class="ja-actions" style="margin:0 0 14px"><button type="button" class="ja-btn ja-btn-red" data-waiver-all>${ic('sign')}Sign all ${due.length} waivers</button></div>` : ''}
    ${all.length ? `<div class="ja-card"><ul class="ja-list">${all.map((p) => `<li class="ja-row">${face(p.name, p.photo)}<div><b>${esc(p.name)}</b><small>${p.waiver?.onFile ? `Signed${p.waiver.signedDate ? ` ${esc(humanDate(p.waiver.signedDate))}` : ''}${p.waiver.kind === 'adult' ? ', adult waiver (signed by the player)' : p.waiver.kind ? ', signed by a parent or guardian' : ''}${p.waiver.term ? ` · ${esc(p.waiver.term)}` : ''}` : 'Not signed yet. Needed before training.'}</small></div>${p.waiver?.onFile ? '<span class="ja-dot ok">On file</span>' : `<button type="button" class="ja-btn ja-btn-red ja-btn-sm" data-waiver-player="${esc(p.key)}">Sign</button>`}</li>`).join('')}</ul></div>`
      : `<div class="ja-card"><h3 class="ja-h3">No players yet</h3><p class="ja-muted" style="margin-top:6px">Add a player first, then sign their waiver here.</p><div class="ja-actions"><button type="button" class="ja-btn ja-btn-red" data-add-player>Add a player</button></div></div>`}`
}

async function saveProf(key, btn) {
  const box = document.querySelector(`[data-prof="${CSS.escape(key)}"]`)
  const values = {}
  box.querySelectorAll('[data-f]').forEach((i) => { values[i.dataset.f] = i.value.trim() })
  box.querySelectorAll('[data-seg]').forEach((g) => { values[g.dataset.seg] = g.querySelector('[aria-pressed="true"]')?.dataset.val || '' })
  values.positions = [...box.querySelectorAll('[data-multi="positions"] [aria-pressed="true"]')].map((b) => b.dataset.val)
  const err = box.querySelector('[data-err]')
  err.hidden = true
  btn.disabled = true
  btn.textContent = 'Saving'
  const r = await api('/api/jfp-account', { action: 'saveProfile', playerKey: key, values })
  btn.disabled = false
  if (!r.ok) { btn.textContent = 'Save'; err.textContent = r.data.error || 'Could not save. Try again.'; err.hidden = false; return }
  const pl = PROF.players.find((x) => x.key === key)
  if (pl) pl.profile = r.data.profile
  toast('Saved. Lee and Ligia can see it now.')
  renderInfo(); renderShell(); renderHome()
  document.querySelector(`[data-prof="${CSS.escape(key)}"]`)?.scrollIntoView({ block: 'start' })
}

// ---------- add a player (no session needed) ----------

// Round 2 item 8: a player profile from the account, booked or not. The
// player's own details are then filled in on Player information.
function addPlayerSheet() {
  const sheet = openSheet({ title: 'Add a player', subtitle: 'No session needed. You can book one any time.' })
  const o = PROF?.options || OPT
  sheet.body.innerHTML = `
    <label class="j-check" style="margin-bottom:10px"><input type="checkbox" id="ap-self"> <span><b>I am the player</b> (18 or over, signing up for myself)</span></label>
    <label class="j-field"><span id="ap-name-l">Player's full name</span><input class="j-input" id="ap-name" autocomplete="off"></label>
    <label class="j-field"><span>Date of birth</span><input class="j-input" id="ap-dob" type="date" min="${esc(PROF?.dob?.min || '1940-01-01')}" max="${esc(PROF?.dob?.max || new Date().toISOString().slice(0, 10))}"></label>
    <label class="j-field"><span>Club <span class="muted">(optional)</span></span><input class="j-input" id="ap-club" autocomplete="off" placeholder="For example, Manly United"></label>
    <label class="j-field"><span>Level <span class="muted">(optional)</span></span><select class="j-select" id="ap-level"><option value="">Choose</option>${o.levels.map((x) => `<option>${esc(x)}</option>`).join('')}</select></label>
    <div id="ap-parent"><div class="j-two"><label class="j-field"><span>Your name (parent or guardian)</span><input class="j-input" id="ap-pname" autocomplete="name" value="${esc(D.parentName || '')}"></label><label class="j-field"><span>Your mobile</span><input class="j-input" id="ap-pmob" type="tel" inputmode="tel" autocomplete="tel"></label></div></div>
    <p class="j-err" id="ap-err" hidden></p>`
  const selfBox = sheet.body.querySelector('#ap-self')
  const sync = () => { const me = selfBox.checked; sheet.body.querySelector('#ap-parent').hidden = me; sheet.body.querySelector('#ap-name-l').textContent = me ? 'Your full name' : "Player's full name" }
  selfBox.addEventListener('change', sync)
  sync()
  sheet.foot.innerHTML = '<button type="button" class="ja-btn ja-btn-red ja-btn-block" id="ap-save">Add the player</button>'
  sheet.foot.querySelector('#ap-save').addEventListener('click', async (ev) => {
    const b = ev.currentTarget
    const g = (id) => sheet.body.querySelector(id).value.trim()
    const err = sheet.body.querySelector('#ap-err')
    err.hidden = true
    const me = selfBox.checked
    const values = { club: g('#ap-club'), level: g('#ap-level'), ...(me ? {} : { parentName: g('#ap-pname'), parentMobile: g('#ap-pmob') }) }
    b.disabled = true
    const r = await api('/api/jfp-account', { action: 'addPlayer', name: g('#ap-name'), dob: g('#ap-dob'), self: me, values })
    b.disabled = false
    if (!r.ok) { err.textContent = r.data.error || 'Could not add the player. Try again.'; err.hidden = false; return }
    closeSheet(true)
    toast('Added. Now fill in their details.')
    await load()
    await loadProfiles()
    show('info')
    document.querySelector(`[data-prof="${CSS.escape(r.data.key)}"]`)?.scrollIntoView({ block: 'start' })
  })
}

// ---------- profile photo ----------

function photoPicker(pl) {
  const photo = pl.profile?.photo || ''
  return `<div class="ja-photo-wrap"><label class="ja-photo" aria-label="${photo ? 'Change photo' : 'Add a photo'}">${photo ? `<img src="${esc(photo)}" alt="">` : `<span>${esc(initials(pl.name))}</span>`}<i>${ic('camera')}</i><input type="file" accept="image/*" data-photo-for="${esc(pl.key)}" hidden></label>
    ${photo ? `<button type="button" class="ja-link ja-small" data-photo-rm="${esc(pl.key)}">Remove</button>` : '<small>Add photo</small>'}</div>`
}

// Cropped square in the browser (600 x 600 JPEG), so even a big phone photo
// uploads in a moment.
function squarePhoto(file) {
  return new Promise((resolve, reject) => {
    const heic = /heic|heif/i.test(file.type || '') || /\.(heic|heif)$/i.test(file.name || '')
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const side = Math.min(img.naturalWidth, img.naturalHeight)
      const sx = (img.naturalWidth - side) / 2
      // Portraits: keep the face, which is usually in the top part.
      const sy = img.naturalHeight > img.naturalWidth ? Math.min((img.naturalHeight - side) * 0.25, img.naturalHeight - side) : (img.naturalHeight - side) / 2
      const n = Math.min(600, side)
      const cv = document.createElement('canvas')
      cv.width = n; cv.height = n
      cv.getContext('2d').drawImage(img, sx, sy, side, side, 0, 0, n, n)
      URL.revokeObjectURL(url)
      resolve(cv.toDataURL('image/jpeg', 0.85))
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(heic ? 'That photo is in iPhone HEIC format. Take a screenshot of it and choose the screenshot, or choose another photo.' : 'That file could not be read. Choose a photo.')) }
    img.src = url
  })
}

async function savePhotoFor(key, input, remove = false) {
  const card = document.querySelector(`[data-prof="${CSS.escape(key)}"]`)
  const wrap = card?.querySelector('.ja-photo-wrap')
  let image = ''
  if (!remove) {
    const file = input.files?.[0]
    if (!file) return
    try { image = await squarePhoto(file) } catch (err) { return toast(err.message) }
  }
  wrap?.classList.add('is-busy')
  const r = await api('/api/jfp-account', { action: 'savePhoto', playerKey: key, ...(remove ? { remove: true } : { image }) })
  wrap?.classList.remove('is-busy')
  if (!r.ok) return toast(r.data.error || 'Could not save the photo. Try again.')
  const pl = PROF.players.find((x) => x.key === key)
  if (pl) pl.profile = r.data.profile
  const dp = D.players.find((x) => x.key === key)
  if (dp) dp.photo = r.data.profile?.photo || ''
  toast(remove ? 'Photo removed.' : 'Photo saved.')
  renderInfo(); renderShell(); renderHome()
}

// ---------- can't make a session ----------

function renderCancel() {
  const el = document.querySelector('[data-pane="cancel"]')
  const rows = D.players.flatMap((p) => p.enrolments.map((e) => ({ p, e })))
  el.innerHTML = `${pageHead("Can't make it?", 'Tell your coach', 'Two taps and the coach taking the session and Ligia hear straight away, by email.')}
    <div class="ja-steps"><div class="ja-step"><b>Pick the session</b><p>Choose the date below.</p></div><div class="ja-step"><b>Tell us why</b><p>Sick, injured, school or something else. Add a note if you like.</p></div><div class="ja-step"><b>Changed your mind?</b><p>Press Undo and your coach knows they are coming.</p></div></div>
    <p class="j-box j-box-amber" style="margin-top:14px">Please tell us as early as you can. There are no make-up sessions for sessions you miss (if we cancel one, you get a free make-up or credit). Less than a day to go? Call or text the coach or Ligia as well.</p>
    ${rows.length ? rows.map(({ p, e }) => {
      const open = (e.sessions || []).slice(0, 4)
      return `<section class="ja-card" style="margin-top:14px"><div class="ja-enrol-head"><img src="${esc(photoFor(e))}" alt="" loading="lazy"><div><h2>${esc(p.name)}</h2><p>${esc(e.day)}s ${esc(e.time)} · ${esc(e.location)}</p></div></div>
        ${open.length ? `<ol class="ja-dates">${open.map((s) => {
          const [dow, dd, mon] = s.label.split(' ')
          const c = (e.cancelled || []).find((x) => x.date === s.iso)
          return `<li class="ja-date ${c ? 'is-off' : ''}"><span class="d"><b>${esc(dd)}</b><i>${esc(mon)}</i></span><span class="w"><b>${esc(dow)} ${esc(e.time)}${c ? '<span class="ja-tag amber">Coach told</span>' : ''}</b>${esc(countdown(s.startMs))}</span>${c ? `<button type="button" class="ja-btn ja-btn-line ja-btn-sm" data-cancel-undo="${esc(c.id)}">Undo</button>` : `<button type="button" class="ja-btn ja-btn-light ja-btn-sm" data-cancel-open="${esc(e.rowId)}" data-cancel-player="${esc(p.key)}" data-cancel-date="${esc(s.iso)}">Can't make it</button>`}</li>`
        }).join('')}</ol>${(e.sessions || []).length > 4 ? `<p style="margin-top:12px"><button type="button" class="ja-link ja-small" data-go="sessions">See every date</button></p>` : ''}` : '<p class="ja-muted" style="margin-top:12px">No more sessions this term.</p>'}
        <div style="margin-top:14px"><p class="ja-small ja-muted">On the day, call or text:</p>${reach(e, p, e.sessions?.[0])}</div>
      </section>`
    }).join('') : `<div class="ja-card" style="margin-top:14px">Nothing booked yet. <a class="ja-link" href="${links.booking}">See the timetable</a></div>`}`
}

// ---------- keep my spot ----------

function renderKeep() {
  const el = document.querySelector('[data-pane="keep"]')
  const k = D.keep || { name: 'Next term', players: [], holdLabel: '' }
  const top = hero({ img: `${IMG}/photos/lee-coaching-field-1600x900.webp`, imgSmall: `${IMG}/photos/lee-coaching-field-900x1100.webp`, kicker: k.name, title: 'Keep your spot', lede: `Same day, same time, same group. Current JFP ${D.self ? 'players' : 'families'} get first call on their spot before ${esc(k.name)} opens to everyone else.` })
  const steps = `<div class="ja-steps" style="margin-top:18px"><div class="ja-step"><b>Tell us you want it</b><p>${D.self ? 'Press the button. No payment now.' : 'Press the button for each player. No payment now.'}</p></div><div class="ja-step"><b>First to know</b><p>We email you as soon as ${esc(k.name)} bookings open, before anyone else.</p></div><div class="ja-step"><b>Lock it in</b><p>Hold it for ${esc(k.holdLabel || 'a small fee')}, which comes off the term fee, or pay the term in full. The hold fee is non-refundable.</p></div></div>`
  // Open (or invited): the real choices.
  if (D.nextTerm) {
    el.innerHTML = `${top}<div class="ja-keep">${D.nextTerm.players.map((x) => `<div class="ja-card ja-keep-card"><p class="ja-kicker"><i></i>${esc(D.nextTerm.name)}</p><h3 class="ja-h3" style="margin-top:8px">${esc(x.player)}</h3><p class="ja-muted ja-small">Now: ${esc(x.group)}</p>
      ${x.status === 'paid' ? `<div class="done">${ic('check')}<span>Paid in full. The spot is locked in.</span></div>`
        : x.status === 'no' ? `<p style="margin-top:12px" class="ja-muted">You told us not returning.</p><div class="ja-actions"><button type="button" class="ja-btn ja-btn-line ja-btn-sm" data-next="hold" data-row="${esc(x.rowId)}">Changed your mind? Hold the spot</button></div>`
        : x.status === 'held' ? `<div class="done">${ic('check')}<span>Spot held. Pay the rest (${esc(x.afterHoldLabel)}) when you know your schedule.</span></div><div class="ja-actions"><button type="button" class="ja-btn ja-btn-red" data-next="full" data-row="${esc(x.rowId)}">Pay the rest</button></div>`
        : `<div class="ja-grid ja-grid-2" style="margin-top:14px">
            <button type="button" class="j-choice" data-next="full" data-row="${esc(x.rowId)}"><span><b>I can commit: pay ${esc(x.fullLabel)}</b><small>The spot is locked in for the term. Card, Apple Pay or Afterpay.</small></span></button>
            <button type="button" class="j-choice" data-next="hold" data-row="${esc(x.rowId)}"><span><b>Hold my spot: ${esc(x.holdLabel)}</b><small>Not sure of next term's schedule yet? Non-refundable, and it comes off the term fee.</small></span></button>
            <button type="button" class="j-choice" data-next="no" data-row="${esc(x.rowId)}"><span><b>Not returning</b><small>We will offer the spot to someone else.</small></span></button>
          </div>`}</div>`).join('')}</div>${steps}`
    return
  }
  el.innerHTML = `${top}<div class="ja-keep">${k.players.length ? k.players.map((x) => `<div class="ja-card ja-keep-card">
      <p class="ja-kicker"><i></i>Your spot now</p><h3 class="ja-h3" style="margin-top:8px">${esc(x.player)}</h3><p class="ja-muted ja-small">${esc(x.group)}</p>
      ${x.interested ? `<div class="done">${ic('check')}<span>You are on the list. We will email you as soon as ${esc(k.name)} opens, before anyone else.</span></div>`
        : `<div class="ja-actions"><button type="button" class="ja-btn ja-btn-red" data-interest="${esc(x.rowId)}">I want to keep this spot</button></div><p class="ja-small ja-muted" style="margin-top:10px">No payment now. Nothing is taken until ${esc(k.name)} opens.</p>`}
    </div>`).join('') : `<div class="ja-card"><h3 class="ja-h3">Book a spot this term to keep it</h3><p class="ja-muted" style="margin-top:6px">Families training with us this term get first call on their spot for ${esc(k.name)}.</p><div class="ja-actions"><a class="ja-btn ja-btn-red" href="${links.booking}">See the timetable</a></div></div>`}</div>${steps}`
}

// ---------- about the term ----------

function renderTerm() {
  const el = document.querySelector('[data-pane="term"]')
  const weeks = D.weeks || 10
  const facts = [
    ...termInfo.filter(([t]) => t !== 'New booking system'),
    ['Groups', groupingLine],
    ['1 on 1 training', oneToOneSummary],
  ]
  el.innerHTML = `${hero({ img: `${IMG}/photos/ntra-field-1600x900.webp`, imgSmall: `${IMG}/photos/ntra-field-900x1100.webp`, kicker: 'About', title: esc(D.term), lede: `${weeks} weeks of small-group training at Belrose HQ, North Turramurra and Rydalmere${D.termStart ? `, from the week of ${esc(niceIso(D.termStart))}` : ''}.` })}
    <section class="ja-sec">${secHead('How the term works')}<div class="ja-facts">${facts.map(([t, d], i) => `<div class="ja-fact"><span class="n">${String(i + 1).padStart(2, '0')}</span><h3>${esc(t)}</h3><p>${esc(d)}</p></div>`).join('')}</div></section>
    <section class="ja-sec">${secHead('Want more?')}<div class="ja-grid ja-grid-2">${termExtras.map((x) => `<div class="ja-card" style="padding:22px"><h3 class="ja-h3">${esc(x.title)}</h3><p class="ja-small ja-muted" style="margin:6px 0 14px">${esc(x.text)}</p><button type="button" class="ja-btn ja-btn-red ja-btn-sm" data-go="${esc(x.key)}">${esc(x.cta)}</button></div>`).join('')}</div></section>
    <section class="ja-sec ja-split">
      <div class="ja-card" style="padding:26px"><p class="ja-kicker"><i></i>Every session</p><h2 class="ja-h2" style="margin-top:10px">Come ready</h2>
        <ul class="ja-ticks">${[...expectations.slice(0, 1), 'JF playing kit, boots for synthetic, shin guards and a drink bottle.', 'A waterproof jacket when it is wet. Only really bad storms change a session, and Belrose HQ is indoors.', ...expectations.slice(2)].map((x) => `<li>${ic('check')}<span>${esc(x)}</span></li>`).join('')}</ul>
        <div class="ja-actions"><a class="ja-btn ja-btn-red" href="${esc(D.kitUrl || KIT_URL)}" target="_blank" rel="noopener noreferrer">${ic('shirt')}Order the JF kit, ${esc(D.kitPriceLabel || 'A$60')}</a><button type="button" class="ja-btn ja-btn-line" data-go="cancel">Can't make a session</button></div>
      </div>
      <div class="ja-split-media"><img src="${IMG}/photos/lee-one-on-one-1200x900.webp" alt="Coach Lee with a JFP player" loading="lazy"></div>
    </section>
    <section class="ja-sec">${secHead('Where we train')}<div class="ja-grid ja-grid-3">${(D.venues || []).map((v) => `<article class="ja-card ja-venue"><img src="${esc(VENUE_CARD[v.id] || v.photo)}" alt="" loading="lazy"><div class="bd"><h3>${esc(v.name)}</h3><p>${esc(v.address)}</p>${v.blurb ? `<p>${esc(v.blurb)}</p>` : ''}<div class="ja-actions">${v.maps ? `<a class="ja-btn ja-btn-line ja-btn-sm" href="${esc(v.maps)}" target="_blank" rel="noopener noreferrer">${ic('pin')}Directions</a>` : ''}</div></div></article>`).join('')}</div></section>`
}

// ---------- fees ----------

// Fees (round 3, Lee 14 Oct 2026): the clear place to pay, for every kind of
// player. Next term's deposit when it is open, what to pay now, every way to
// pay ahead, each place this term (with "Paid in full"), then every payment.
function feesOwing() { return D ? oweList(D).length + jjOweList(D).length : 0 }
function renderFees() {
  const el = document.querySelector('[data-pane="fees"]')
  if (!D) return
  const owe = [...oweList(D), ...jjOweList(D)]
  const ahead = (D.owed || []).filter((x) => x.kind === 'prepay')
  const head = pageHead(D.term, 'Fees', '')
  const deposit = depositCards(D, { self: Boolean(D.self || solo()) })
  // Redesign (17 Oct 2026): this term in plain words first, then what to pay
  // now, paying ahead, a saved card (only when there is one) and receipts.
  const now = owe.length
    ? `<section class="ja-fees-sec">${secHead('To pay now')}<div class="ja-pay-grid">${owe.map((x) => oweCard(x, 'fees')).join('')}</div></section>`
    : !ahead.length ? `<div class="ja-card ja-allpaid">${ic('check')}<div><h3 class="ja-h3">Nothing owing</h3><p class="ja-small ja-muted">You are all paid up.</p></div></div>` : ''
  const pre = ahead.length ? `<section class="ja-fees-sec">${secHead('Pay ahead and save', 'Pay for sessions before they happen. Commit to a run and each session costs less.')}${ahead.map((o) => aheadBlock(D, o, { pane: 'fees' })).join('')}</section>` : ''
  el.innerHTML = `${head}
    <section class="ja-fees-sec">${secHead('This term')}<div id="fees-places"><div class="ja-card ja-skel"><p class="ja-small ja-muted">Loading your payments.</p></div></div></section>
    ${now}${deposit ? `<section class="ja-fees-sec">${deposit}</section>` : ''}${pre}
    <section class="ja-fees-sec ja-saved-sec">${secHead('Saved card or bank account')}<div id="fees-saved"></div></section>
    <section class="ja-fees-sec">${secHead('Payments and receipts')}<div id="fees-body"></div></section>`
  mountSavedPay(document.getElementById('fees-saved'))
  if (FEES) return fillFees()
  api('/api/jfp-account', { action: 'fees' }).then((r) => {
    if (r.status === 401) return showSignIn()
    FEES = r.ok ? r.data.fees : { error: r.data.error || 'Could not load your payments.' }
    if (current === 'fees') fillFees()
  })
}
function fillFees() {
  const places = document.getElementById('fees-places')
  const box = document.getElementById('fees-body')
  if (!box || !places) return
  if (FEES.error) { places.innerHTML = `<div class="ja-card"><p class="ja-small">${esc(FEES.error)}</p></div>`; box.innerHTML = ''; return }
  places.innerHTML = plainPlaces(placeCards(FEES, D)) || '<div class="ja-card"><p class="ja-small ja-muted">No place booked this term.</p></div>'
  box.innerHTML = historyCard(FEES)
}

// Words a parent understands (redesign, 17 Oct 2026). The server's
// "Group to be confirmed" and "Paid A$0 of A$0" mean nothing to a family.
function plainPlaces(html) {
  return String(html || '')
    .replace(/Group to be confirmed/g, 'Day and time to come')
    .replace(/Paid A\$0 of A\$0\.( Pay the rest above\.)?/g, 'No fee set yet. We will send a payment link if anything is due.')
}

// ---------- family ----------

// Family (redesign, Lee 17 Oct 2026): every child with their session, age,
// waiver and details, then your own details, light or dark, and sign out.
// No coach names for families (Lee, 14 Oct 2026), unless Lee switches on
// coach profiles for families (20 Oct 2026): then each card shows its coaches.
function renderFamily() {
  const el = pane('family')
  if (!el || !D) return
  const kids = [...D.players, ...(D.juniors?.children || [])]
  const gaps = new Map(infoGaps().map((g) => [g.p.key, g.missing]))
  const nW = unsignedWaivers().length, nI = infoGaps().length
  const name = D.self ? first(D.players[0]?.name) : first(D.parentName)
  const strip = nW + nI ? `<div class="ja-strip is-flat"><span class="n">${nW + nI}</span><span class="ja-mr-tx"><b>${nW + nI === 1 ? '1 thing to sort here' : `${nW + nI} things to sort here`}</b><small>${[nW && `${nW} waiver${nW > 1 ? 's' : ''} to sign`, nI && `${nI} with details missing`].filter(Boolean).join(' · ')}</small></span></div>` : ''
  const card = (p) => {
    const jj = p.key.startsWith('jj:')
    const where = jj ? `Joners Juniors · ${p.className || D.juniors?.classLabel || ''}` : p.enrolments?.length ? p.enrolments.map((e) => `${e.day}s ${e.time}, ${e.location}`).join(' · ') : p.placeNoSession ? 'Place confirmed, day and time to come' : 'Not booked this term'
    const miss = gaps.get(p.key)
    const w = p.waiver?.onFile
      ? `<span class="ja-tag green">Signed${p.waiver.signedDate ? ` ${esc(humanDate(p.waiver.signedDate))}` : ''}</span>`
      : `<span class="ja-tag red">To sign</span>`
    const details = jj ? '' : !PROF ? '<span class="ja-muted ja-small">Loading</span>' : miss ? `<span class="ja-tag amber">${miss.filter((m) => m !== 'check the details').length ? 'Details missing' : 'Check and save'}</span>` : '<span class="ja-tag green">Complete</span>'
    return `<article class="ja-kid" aria-label="${esc(p.name)}">
      <div class="ja-kid-head">${face(p.name, p.photo)}<div><h3>${esc(p.name)}</h3><p>${p.age != null && p.age !== '' ? `Age ${esc(p.age)} · ` : ''}${esc(where)}</p></div></div>
      <div class="ja-kid-facts">
        <div><span>Waiver</span>${w}</div>
        ${jj ? '' : `<div><span>Player details</span>${details}</div>`}
        ${jj ? '' : loginRow(p, D)}
      </div>
      ${jj ? '' : coachRow(p)}
      <div class="ja-kid-act">${p.waiver?.onFile ? '' : `<button type="button" class="ja-btn ja-btn-red ja-btn-sm" data-waiver-player="${esc(p.key)}">${ic('sign')}Sign waiver</button>`}${jj ? '' : `<button type="button" class="ja-btn ${miss ? 'ja-btn-light' : 'ja-btn-line'} ja-btn-sm" data-go="info">${miss ? 'Update details' : 'View details'}</button>`}</div>
    </article>`
  }
  el.innerHTML = `${pageHead(name ? `${name}'s family` : 'Your family', solo() ? 'My profile' : 'Family', '')}${strip}
    <p class="ja-label" style="margin-top:18px">${solo() ? 'You' : 'Players'}</p>
    ${kids.length ? `<div class="ja-kids">${kids.map(card).join('')}</div>` : '<div class="ja-card"><p class="ja-muted">No players yet.</p></div>'}
    <div class="ja-actions" style="margin:14px 0 0"><button type="button" class="ja-btn ja-btn-line ja-btn-sm" data-add-player>+ Add a player</button>${nW > 1 ? `<button type="button" class="ja-btn ja-btn-red ja-btn-sm" data-waiver-all>${ic('sign')}Sign all ${nW} waivers</button>` : ''}</div>
    <p class="ja-label" style="margin-top:26px">Your account</p>
    <div class="ja-card ja-acct"><div class="ja-acct-row"><div><b>${esc(D.parentName || (D.self ? D.players[0]?.name : '') || 'Signed in')}</b><small>${esc(D.email || '')}</small></div><button type="button" class="ja-btn ja-btn-line ja-btn-sm" id="sign-out-fam">Sign out</button></div>
      <div class="ja-acct-row"><div><b>Look</b><small>Light or dark, on this phone or computer</small></div>${themeSwitch()}</div>
      ${standalone() ? '' : `<div class="ja-acct-row"><div><b>Home screen</b><small>Open My JFP like an app</small></div><button type="button" class="ja-btn ja-btn-line ja-btn-sm" data-install>How</button></div>`}
    </div>`
}

// ---------- holidays and camps ----------

function renderHolidays() {
  const el = document.querySelector('[data-pane="holidays"]')
  // The sessions on offer first, no photo (Lee, 19 Oct 2026).
  const h = D.extras?.holiday || { sessions: [] }
  const list = h.sessions || []
  const open = list.filter((x) => !x.full).length
  const byDay = []
  for (const x of list) { const last = byDay.at(-1); if (last && last.date === x.date) last.items.push(x); else byDay.push({ date: x.date, label: x.dateLabel, items: [x] }) }
  const row = (x) => `<li class="ja-row ${x.full ? 'is-off' : ''}"><span class="ja-num">${ic('clock')}</span><div><b>${esc(x.time)}</b><small>${esc(x.typeLabel)}${x.durationMin ? ` · ${esc(String(x.durationMin))} min` : ''}${x.fromLabel && !x.full ? ` · from ${esc(x.fromLabel)}` : ''}</small></div><span class="ja-small ${x.full ? 'ja-muted' : ''}">${x.full ? 'Taken' : x.placesLeft != null ? `${x.placesLeft} place${x.placesLeft === 1 ? '' : 's'} left` : 'Open'}</span></li>`
  const book = `<button type="button" class="ja-btn ja-btn-red" data-hol-book>Book holiday training ${ic('arrow')}</button>`
  const sessions = list.length
    ? `<section class="ja-sec" id="hol-sessions">${secHead('Sessions you can book')}
        <div class="ja-actions" style="margin:0 0 12px">${open ? book : ''}<span class="ja-small ja-muted">${open ? `${open} open · ` : 'All taken just now · '}${esc(h.where || `${hq.name}, Belrose`)}</span></div>
        <p class="j-err" data-hol-err hidden></p>
        <div class="ja-grid ja-grid-2">${byDay.map((d) => `<article class="ja-card"><p class="ja-kicker"><i></i>${esc(d.label)}</p><ul class="ja-list" style="margin-top:8px">${d.items.map(row).join('')}</ul></article>`).join('')}</div></section>`
    : `<section class="ja-sec" id="hol-sessions"><article class="ja-card" style="padding:24px"><p class="ja-kicker"><i></i>Holiday training</p><h2 class="ja-h2" style="margin-top:10px">No holiday sessions to book yet</h2>
        <p class="ja-lede" style="font-size:15px">${esc(holidays.last)} training is done. The next block runs in the NSW summer school holidays, ${esc(holidays.from)} to ${esc(holidays.to)}. The sessions show here as soon as they open.</p>
        <dl class="ja-dl"><div><dt>Where</dt><dd>${esc(hq.name)}, Belrose</dd></div><div><dt>Sessions</dt><dd>1 to 1, shared and small groups, 60 or 90 minutes</dd></div></dl></article></section>`
  el.innerHTML = `${pageHead('School holidays', 'Holiday training', 'Training at Joner Football HQ in the school holidays. JFP players book first.')}
    ${sessions}
    <div class="ja-band" style="margin-top:14px"><div><p class="ja-kicker"><i></i>JFP players</p><h2 style="margin-top:10px">You book first</h2><p style="margin-top:8px">Joner Football Performance players get first booking rights for holiday training and camps.</p></div></div>
    <div class="ja-grid ja-grid-2" style="margin-top:14px">
      <article class="ja-card ja-venue"><img src="${IMG}/photos/camp-rydalmere-1200x800.webp" alt="Joner Football Camp in Sydney" loading="lazy"><div class="bd"><p class="ja-kicker"><i></i>Joner Football Camps</p><h3 style="margin-top:6px">Camps</h3><p>Dates, locations and everything else about our camps are on the website.</p><div class="ja-actions"><a class="ja-btn ja-btn-red" href="/camps" target="_blank" rel="noopener">See our camps ${ic('ext')}</a></div></div></article>
    </div>`
  el.querySelector('[data-hol-book]')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget
    const err = el.querySelector('[data-hol-err]')
    btn.disabled = true
    const r = await api('/api/jfp-account', { action: 'holidayAccess' })
    btn.disabled = false
    // Not a JFP family: the booking page asks for the password from their message.
    if (r.ok || r.data.code === 'password') { location.href = r.data.url || '/holiday-bookings/'; return }
    err.textContent = r.data.error || 'Could not open holiday booking. Try again.'
    err.hidden = false
  })
}

// ---------- training videos ----------

function vidCard(v) {
  return `<button type="button" class="ja-vid" data-yt="${esc(v.id)}" data-title="${esc(v.title)}"><span class="ja-vid-media"><img src="${IMG}/yt/${esc(v.id)}.webp" alt="" loading="lazy" decoding="async"><span class="ja-vid-play">${ic('playsolid')}</span><span class="ja-vid-time">${esc(v.time)}</span></span><span class="ja-vid-title">${esc(v.title)}</span></button>`
}
function reelCard(code, i) {
  return `<a class="ja-reel" href="https://www.instagram.com/reel/${esc(code)}/" target="_blank" rel="noopener noreferrer" aria-label="Instagram reel ${i + 1}, opens Instagram"><img src="${IMG}/reels/${esc(code)}.webp" alt="" loading="lazy" decoding="async"><span class="ig">${ic('instagram')}</span><span class="pl">${ic('playsolid')}</span></a>`
}
function renderVideos() {
  const el = document.querySelector('[data-pane="videos"]')
  el.innerHTML = `${pageHead('Training videos', 'Watch and learn', 'Real sessions from Joner Football HQ and the main pitch. Try the drills between sessions.')}
    <section>${secHead('Inside JF HQ', 'Indoor sessions at Belrose HQ.', 'r-hq')}<div class="ja-rail-wrap"><div class="ja-rail" id="r-hq">${hqVideos.map(vidCard).join('')}</div></div></section>
    <section class="ja-sec">${secHead('On the main pitch', 'Outdoor sessions and drills with Coach Lee.', 'r-pitch')}<div class="ja-rail-wrap"><div class="ja-rail" id="r-pitch">${pitchVideos.map(vidCard).join('')}</div></div></section>
    <section class="ja-sec">${secHead('On Instagram', 'Short clips from JFP sessions. Tap one to watch it on Instagram.', 'r-ig')}<div class="ja-rail-wrap"><div class="ja-rail reels" id="r-ig">${reels.map(reelCard).join('')}</div></div></section>
    <section class="ja-sec">${secHead('Follow Joner Football')}<div class="ja-socials">${socials.map((s) => `<a class="ja-social" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${ic(s.key)}<span><b>${esc(s.name)}</b><small>${esc(s.handle)}</small></span></a>`).join('')}</div></section>`
}

// ---------- the app ----------

function renderApp() {
  const el = document.querySelector('[data-pane="app"]')
  el.innerHTML = `<div class="ja-apphero"><div class="copy"><p class="ja-kicker"><i></i>Free for JFP players</p><h1 class="ja-display">The JF App</h1>
      <p class="ja-lede">Every player booked into JFP gets free access to the Joner Football App, so training keeps going between sessions.</p>
      <div class="ja-actions"><a class="ja-store" href="${links.appStore}" target="_blank" rel="noopener noreferrer">${ic('apple')}<span><small>Download on the</small><b>App Store</b></span></a><a class="ja-store" href="${links.googlePlay}" target="_blank" rel="noopener noreferrer">${ic('gplay')}<span><small>Get it on</small><b>Google Play</b></span></a></div></div>
      <img class="shot" src="/images/app/joner-app-main-iphone-current-transparent.webp" alt="The Joner Football App on a phone" loading="lazy"></div>
    <div class="ja-grid ja-grid-3">
      <div class="ja-card" style="padding:24px" id="app-free"><p class="ja-kicker"><i></i>Booked into JFP</p><h2 class="ja-h2" style="margin-top:10px">Get your free access</h2><p class="ja-muted" style="margin-top:8px">Checking your places…</p></div>
      <div class="ja-card" style="padding:24px"><p class="ja-kicker"><i></i>Not in JFP</p><h2 class="ja-h2" style="margin-top:10px">Join the app</h2><p class="ja-muted" style="margin-top:8px">Anyone can join the Joner Football App on its own.</p><div class="ja-actions"><a class="ja-btn ja-btn-line" href="/join" target="_blank" rel="noopener">Join page ${ic('ext')}</a></div></div>
      <div class="ja-card" style="padding:24px"><p class="ja-kicker"><i></i>What is inside</p><h2 class="ja-h2" style="margin-top:10px">About the app</h2><p class="ja-muted" style="margin-top:8px">See what the app has for players, parents and coaches.</p><div class="ja-actions"><a class="ja-btn ja-btn-line" href="${links.appPage}" target="_blank" rel="noopener">About the app ${ic('ext')}</a></div></div>
    </div>`
  appFreeCard()
}

// Free access (Lee, 19 Oct 2026): booked into Term 4 and paid, then the
// account email goes into the Uscreen group JFP (PLUS) straight away and the
// card shows how to get into the app. Free accounts and trials see how to get it.
async function appFreeCard() {
  const box = document.getElementById('app-free')
  if (!box) return
  const r = await api('/api/jfp-account', { action: 'appAccessState' })
  const a = r.ok ? r.data.app : null
  const email = (a && a.accountEmail) || D.email || ''
  const head = '<p class="ja-kicker"><i></i>Booked into Term 4</p><h2 class="ja-h2" style="margin-top:10px">Free JF App access</h2>'
  const offer = '<p class="ja-muted" style="margin-top:8px">If you have booked into Term 4 and train with us, you get the Joner Football App free, with full PLUS access.</p>'
  if (!a || !a.eligible) { box.innerHTML = `${head}${offer}<p class="ja-muted" style="margin-top:8px">It unlocks here once your Term 4 place is paid. Paid already? Ask Ligia and she will check it.</p><div class="ja-actions"><button type="button" class="ja-btn ja-btn-line" data-go="contact" data-topic="The JF App">Ask Ligia</button></div>`; return }
  const q = a.request
  if (q && q.status === 'done') { box.innerHTML = `${head}<p class="ja-muted" style="margin-top:8px">You are in. Free PLUS access is on <b>${esc(q.appEmail)}</b>.</p>${appSteps(q.appEmail)}`; return }
  if (q && q.status === 'requested') { box.innerHTML = `${head}<p class="ja-muted" style="margin-top:8px">We have your request for <b>${esc(q.appEmail)}</b> and are setting it up by hand. We will email you when it is ready, usually within a day.</p><div class="ja-actions"><button type="button" class="ja-btn ja-btn-line" id="app-go">Try again now</button></div>`; wireAppGo(box, q.appEmail); return }
  box.innerHTML = `${head}${offer}<p class="ja-muted" style="margin-top:8px">For ${esc(a.players.join(' and '))}. Confirm the email on this account. It is the email you will sign in to the app with.</p>
    <label class="j-field" style="margin-top:12px"><span>Your account email</span><input class="j-input" id="app-email" type="email" inputmode="email" autocomplete="email" placeholder="${esc(email)}"></label>
    <div class="ja-actions"><button type="button" class="ja-btn ja-btn-red" id="app-go">Get my free access</button></div>`
  wireAppGo(box)
}
function wireAppGo(box, fixed) {
  box.querySelector('#app-go')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget
    const appEmail = fixed || box.querySelector('#app-email')?.value || ''
    btn.disabled = true; btn.textContent = 'Setting it up…'
    const res = await api('/api/jfp-account', { action: 'appAccess', appEmail })
    if (!res.ok) { toast(res.data.error || 'Could not do that. Try again.'); btn.disabled = false; btn.textContent = fixed ? 'Try again now' : 'Get my free access'; return }
    const q = res.data.app && res.data.app.request
    toast(q && q.status === 'done' ? 'Done. Your free access is on.' : 'Thanks. We will set it up and email you.')
    appFreeCard()
  })
}
function appSteps(email) {
  return `<ol class="ja-steps" style="margin:14px 0 0;padding-left:20px;display:grid;gap:8px">
      <li><b>Download the Joner Football App.</b><div class="ja-actions" style="margin-top:8px"><a class="ja-btn ja-btn-line ja-btn-sm" href="${links.appStore}" target="_blank" rel="noopener noreferrer">App Store</a><a class="ja-btn ja-btn-line ja-btn-sm" href="${links.googlePlay}" target="_blank" rel="noopener noreferrer">Google Play</a></div></li>
      <li><b>Open it and tap Sign in</b> with <b>${esc(email)}</b>.</li>
      <li><b>First time?</b> Look for an email from Joner Football to set your password. No email? Tap Forgot password in the app and use the same email.</li>
      <li><b>That is it.</b> PLUS is already unlocked. Do not buy a plan in the app, you will not need one.</li>
    </ol>`
}

// ---------- contact ----------

let topic = ''
function renderContact() {
  const el = document.querySelector('[data-pane="contact"]')
  const topics = ['Sessions and groups', 'Payments', 'Holiday training and camps', 'Kit', 'The JF App', 'Something else']
  const names = D.players.map((p) => p.name)
  el.innerHTML = `${pageHead('Contact us', 'Talk to us', 'Call, text or email. Or send a question below and Ligia will reply by email, usually within a day.')}
    <div class="ja-grid ja-grid-2">${contacts.map((c, i) => `<article class="ja-card ja-person-card" style="padding:24px">
        <div class="who"><span class="ja-mono ${i ? 'dark' : ''}">${esc(c.initials)}</span><div><h3>${esc(c.name)}</h3><p class="role">${esc(c.role)}</p></div></div>
        <p class="ja-muted" style="margin-top:12px">${esc(c.about)}</p>
        <div class="ja-lines"><a href="tel:${esc(c.tel)}"><span>Mobile</span>${esc(c.phone)}</a><a href="mailto:${esc(c.email)}"><span>Email</span>${esc(c.email)}</a></div>
        <div class="ja-quick"><a class="ja-btn ja-btn-light ja-btn-sm" href="tel:${esc(c.tel)}">${ic('call')}Call</a><a class="ja-btn ja-btn-line ja-btn-sm" href="sms:${esc(c.tel)}">${ic('chat')}Text</a><a class="ja-btn ja-btn-line ja-btn-sm" href="mailto:${esc(c.email)}">${ic('mail')}Email</a></div>
      </article>`).join('')}</div>
    <div class="ja-grid ja-grid-2" style="margin-top:14px">
      <section class="ja-card" style="padding:24px"><p class="ja-kicker"><i></i>Ask a question</p><h2 class="ja-h2" style="margin-top:10px">Send us a message</h2>
        <div class="j-field" style="margin-top:16px"><span>What is it about?</span><div class="ja-topics" id="ct-topics">${topics.map((t) => `<button type="button" class="j-chip" data-topic-pick="${esc(t)}" aria-pressed="${t === topic}">${esc(t)}</button>`).join('')}</div></div>
        ${names.length ? `<label class="j-field"><span>Which player? <span class="muted">(optional)</span></span><select class="j-select" id="ct-player"><option value="">Not about one player</option>${names.map((n) => `<option>${esc(n)}</option>`).join('')}</select></label>` : ''}
        <div class="j-two"><label class="j-field"><span>Your name</span><input class="j-input" id="ct-name" value="${esc(D.parentName || '')}" autocomplete="name"></label><label class="j-field"><span>Mobile <span class="muted">(optional)</span></span><input class="j-input" id="ct-phone" type="tel" inputmode="tel" autocomplete="tel"></label></div>
        <label class="j-field"><span>Your question</span><textarea class="j-textarea" id="ct-msg" rows="5" maxlength="3000"></textarea></label>
        <p class="j-err" id="ct-err" hidden></p>
        <div class="ja-actions"><button type="button" class="ja-btn ja-btn-red" id="ct-send">Send message</button><span class="ja-small ja-muted">Replies go to ${esc(D.email)}</span></div>
      </section>
      <section class="ja-card ja-venue"><img src="${IMG}/photos/hq-exterior-1200x800.webp" alt="Joner Football HQ, Belrose" loading="lazy"><div class="bd"><p class="ja-kicker"><i></i>Find us</p><h3 style="margin-top:6px">${esc(hq.name)}</h3><p>${esc(hq.address)}</p><div class="ja-actions"><a class="ja-btn ja-btn-line ja-btn-sm" href="${esc(hq.maps)}" target="_blank" rel="noopener noreferrer">${ic('pin')}Directions</a></div></div></section>
    </div>`
}
async function sendContact(btn) {
  const v = (id) => ($(id)?.value || '').trim()
  const err = $('ct-err')
  err.hidden = true
  const message = v('ct-msg')
  if (v('ct-name').length < 2 || message.length < 5) { err.textContent = 'Add your name and a question.'; err.hidden = false; return }
  btn.disabled = true
  btn.textContent = 'Sending'
  const lines = [topic ? `Topic: ${topic}` : '', v('ct-player') ? `Player: ${v('ct-player')}` : '', 'Sent from My account.', '', message].filter((x, i) => x || i === 3)
  const r = await api('/api/jfp-access', { action: 'contact', name: v('ct-name'), email: D.email, phone: v('ct-phone'), message: lines.join('\n'), page: '/jfp-account/', recaptchaToken: await recaptcha('jfp_contact') })
  btn.disabled = false
  btn.textContent = 'Send message'
  if (!r.ok) { err.textContent = r.data.error || 'Could not send. Try again, or email ligia@jonerfootball.com.'; err.hidden = false; return }
  $('ct-msg').value = ''
  toast('Sent. Ligia will be in touch.')
}
// Signed out (the sign in page): the same message, as a sheet.
function contactSheet() {
  const s = openSheet({ title: 'Contact us', subtitle: 'Ligia will reply by email, usually within a day.' })
  s.body.innerHTML = `<label class="j-field"><span>Your name</span><input class="j-input" id="cs-name" autocomplete="name"></label>
    <div class="j-two"><label class="j-field"><span>Email</span><input class="j-input" id="cs-email" type="email" autocomplete="email"></label><label class="j-field"><span>Mobile <span class="muted">(optional)</span></span><input class="j-input" id="cs-phone" type="tel" autocomplete="tel"></label></div>
    <label class="j-field"><span>Message</span><textarea class="j-textarea" id="cs-msg" rows="5"></textarea></label><p class="j-err" id="cs-err" hidden></p>
    <p class="ja-small ja-muted">Or call Ligia on <a class="ja-link" href="tel:+61456361962">0456 361 962</a>.</p>`
  s.foot.innerHTML = '<button type="button" class="ja-btn ja-btn-red ja-btn-block" id="cs-send">Send message</button>'
  s.foot.querySelector('#cs-send').addEventListener('click', async (ev) => {
    const b = ev.currentTarget
    const g = (id) => s.body.querySelector(id).value.trim()
    const err = s.body.querySelector('#cs-err')
    if (g('#cs-name').length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(g('#cs-email')) || g('#cs-msg').length < 5) { err.textContent = 'Add your name, email and a message.'; err.hidden = false; return }
    b.disabled = true
    const r = await api('/api/jfp-access', { action: 'contact', name: g('#cs-name'), email: g('#cs-email'), phone: g('#cs-phone'), message: g('#cs-msg'), page: '/jfp-account/', recaptchaToken: await recaptcha('jfp_contact') })
    b.disabled = false
    if (!r.ok) { err.textContent = r.data.error || 'Could not send. Try again.'; err.hidden = false; return }
    s.body.innerHTML = '<div class="j-box j-box-green"><b>Sent.</b> Ligia will be in touch.</div>'
    s.foot.innerHTML = ''
    setTimeout(() => closeSheet(), 2200)
  })
}

// ---------- video player ----------

function playVideo(id, title) {
  const wrap = document.createElement('div')
  wrap.className = 'ja-player'
  wrap.setAttribute('role', 'dialog')
  wrap.setAttribute('aria-modal', 'true')
  wrap.setAttribute('aria-label', title)
  wrap.innerHTML = `<button type="button" class="ja-round ja-player-close" aria-label="Close video">${ic('close')}</button><div class="ja-player-box"><div class="ja-player-frame"><iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1&playsinline=1&rel=0&modestbranding=1" title="${esc(title)}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></div><p class="ja-player-title">${esc(title)}</p></div>`
  const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey) }
  const onKey = (e) => { if (e.key === 'Escape') close() }
  wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('.ja-player-close')) close() })
  document.addEventListener('keydown', onKey)
  document.querySelector('.jfp').appendChild(wrap)
  wrap.querySelector('.ja-player-close').focus()
}

// Rail arrows (big screens): one screenful at a time, greyed at the ends.
function syncRails() {
  document.querySelectorAll('.ja-rail[id]').forEach((r) => {
    const prev = document.querySelector(`[data-rail-prev="${r.id}"]`)
    const next = document.querySelector(`[data-rail-next="${r.id}"]`)
    if (prev) prev.disabled = r.scrollLeft <= 4
    if (next) next.disabled = r.scrollLeft + r.clientWidth >= r.scrollWidth - 4
  })
}
document.addEventListener('scroll', (e) => { if (e.target?.classList?.contains('ja-rail')) requestAnimationFrame(syncRails) }, true)
window.addEventListener('resize', () => requestAnimationFrame(syncRails))

// ---------- calendar ----------

// Subscribe once (Lee, 17 Oct 2026): the phone's calendar reads the family's
// private feed and keeps itself up to date. Download once stays as a fallback.
async function calendarSheet(rowId) {
  const sheet = openSheet({ title: 'Add to your calendar', subtitle: 'Every session. Updates by itself.' })
  sheet.body.innerHTML = '<p class="ja-muted">Getting your link</p>'
  const r = await api('/api/jfp-account', { action: 'calendarLink' })
  if (!r.ok) { sheet.body.innerHTML = `<p class="ja-muted">${esc(r.data.error || 'Could not get your link. Try again.')}</p>`; return }
  const https = r.data.url, webcal = https.replace(/^https?:/, 'webcal:')
  sheet.body.innerHTML = `<div class="ja-mlist">
    <a class="ja-mrow" href="${esc(webcal)}"><span class="ja-mr-ic">${ic('calplus')}</span><span class="ja-mr-tx"><b>iPhone, iPad or Mac</b></span>${ic('right', 'ja-mr-go')}</a>
    <a class="ja-mrow" href="https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}" target="_blank" rel="noopener noreferrer"><span class="ja-mr-ic">${ic('calendar')}</span><span class="ja-mr-tx"><b>Google Calendar</b></span>${ic('ext', 'ja-mr-go')}</a>
    <button type="button" class="ja-mrow" id="cal-copy"><span class="ja-mr-ic">${ic('ext')}</span><span class="ja-mr-tx"><b>Copy the link</b></span></button>
    <button type="button" class="ja-mrow" id="cal-once"><span class="ja-mr-ic">${ic('calplus')}</span><span class="ja-mr-tx"><b>Download once</b></span></button></div>`
  sheet.body.querySelector('#cal-copy').addEventListener('click', async () => { try { await navigator.clipboard.writeText(https); toast('Link copied.') } catch { toast(https) } })
  sheet.body.querySelector('#cal-once').addEventListener('click', () => downloadIcs(rowId))
}

function icsFor(p, e) {
  const pad = (n) => String(n).padStart(2, '0')
  const stamp = (ms) => { const d = new Date(ms); return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z` }
  const t = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/([,;])/g, '\\$1').replace(/\n/g, '\\n')
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Joner Football//JFP//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${t(`JFP ${first(p.name)}`)}`]
  for (const s of (e.sessions || []).filter((x) => !x.cancelled)) {
    lines.push('BEGIN:VEVENT', `UID:${e.rowId}-${s.iso}@jonerfootball.com`, `DTSTAMP:${stamp(Date.now())}`, `DTSTART:${stamp(s.startMs)}`, `DTEND:${stamp(s.startMs + (e.durationMin || 60) * 60000)}`,
      `SUMMARY:${t(`JFP: ${first(p.name)}`)}`, `LOCATION:${t(e.address || e.location)}`, `DESCRIPTION:${t(`Joner Football Performance, ${e.location}. Can't make it? Tell us in My account: https://jonerfootball.com/jfp-account/`)}`, 'END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return lines.join('\r\n')
}
function downloadIcs(rowId) {
  for (const p of D.players) {
    const e = p.enrolments.find((x) => x.rowId === rowId)
    if (!e) continue
    const url = URL.createObjectURL(new Blob([icsFor(p, e)], { type: 'text/calendar' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `jfp-${first(p.name).toLowerCase() || 'sessions'}.ics`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 4000)
    toast('Calendar file ready. Open it to add every session.')
    return
  }
}

// ---------- can't make a session: the form ----------

const HOUR = 3600e3
const DAY = 24 * HOUR
// Who to call or text about a session (round 3, Lee 14 Oct 2026): the coach
// taking it (their mobile, labelled "Coach", never a name) and Ligia in the
// office. Text opens the phone's messages with the words already in.
const LIGIA = contacts.find((c) => /^Ligia/.test(c.name))
function cantText(p, e, s) { return `${p.name} can't make ${s ? `${s.label} ` : ''}${e.time}`.replace(/\s+/g, ' ').trim() }
function smsHref(tel, text) { return `sms:${tel}?&body=${encodeURIComponent(text)}` }
function reachList(e) {
  const coach = (e.contacts || []).find((c) => c.tel)
  return [...(coach ? [{ who: 'Coach', phone: coach.phone, tel: coach.tel }] : []), ...(LIGIA ? [{ who: 'Ligia', phone: LIGIA.phone, tel: LIGIA.tel, sub: 'Office' }] : [])]
}
function reach(e, p, s) {
  const text = cantText(p, e, s)
  return `<div class="ja-reach" data-reach>${reachList(e).map((c) => `<div class="ja-reach-row"><span class="ja-reach-who"><b>${esc(c.who)}</b><small>${esc(c.sub ? `${c.sub} · ${c.phone}` : c.phone)}</small></span><a class="ja-btn ja-btn-line ja-btn-sm" href="tel:${esc(c.tel)}">${ic('call')}Call</a><a class="ja-btn ja-btn-line ja-btn-sm" data-sms="${esc(c.tel)}" href="${esc(smsHref(c.tel, text))}">${ic('chat')}Text</a></div>`).join('')}</div>`
}
function cancelSheet(e, p, preset = '') {
  const open = (e.sessions || []).filter((s) => s.startMs > Date.now())
  const sheet = openSheet({ title: "Can't make a session", subtitle: `${p.name}, ${e.day} ${e.time}, ${e.location}` })
  const free = open.filter((s) => !s.cancelled)
  if (!free.length) {
    sheet.body.innerHTML = `<div class="j-box j-box-green">You have already told us about every upcoming session for ${esc(p.name)}.</div>`
    sheet.foot.innerHTML = '<button type="button" class="ja-btn ja-btn-light ja-btn-block" id="cx-done">Done</button>'
    sheet.foot.querySelector('#cx-done').addEventListener('click', () => closeSheet())
    return
  }
  const pick = free.find((s) => s.iso === preset) || free[0]
  let reason = ''
  sheet.body.innerHTML = `
    <label class="j-field"><span>Which session?</span><select class="j-select" id="cx-date">${open.map((s) => `<option value="${esc(s.iso)}" ${s.cancelled ? 'disabled' : ''} ${s.iso === pick.iso ? 'selected' : ''}>${esc(s.label)}${s.cancelled ? ' (already told)' : ''}</option>`).join('')}</select></label>
    <div class="j-field"><span>Why?</span><div id="cx-reasons" role="group" aria-label="Reason" style="display:flex;flex-wrap:wrap;gap:8px">${D.reasons.map((r) => `<button type="button" class="j-chip" data-reason="${esc(r.key)}" aria-pressed="false">${esc(r.label)}</button>`).join('')}</div></div>
    <label class="j-field"><span>Note for the coach <span class="muted" id="cx-hint">(optional)</span></span><textarea class="j-textarea" id="cx-note" maxlength="${esc(D.noteMax)}" rows="3"></textarea></label>
    <div id="cx-late"></div>
    <p class="j-err" id="cx-err" hidden></p>
    <div class="ja-reach-box"><p class="ja-small"><b>We email the coach taking the session and Ligia.</b> Rather call or text?</p><div id="cx-reach"></div></div>`
  sheet.foot.innerHTML = '<button type="button" class="ja-btn ja-btn-red ja-btn-block" id="cx-go">Tell the coach and Ligia</button>'
  const late = () => {
    const s = open.find((x) => x.iso === sheet.body.querySelector('#cx-date').value)
    const soon = s && s.startMs - Date.now() < DAY
    sheet.body.querySelector('#cx-late').innerHTML = soon ? '<div class="j-box j-box-amber"><b>That is under 24 hours away.</b> We will tell them straight away. Please also call or text the coach or Ligia below.</div>' : ''
    // The text is written for the date chosen.
    sheet.body.querySelector('#cx-reach').innerHTML = reach(e, p, s)
  }
  late()
  sheet.body.querySelector('#cx-date').addEventListener('change', late)
  sheet.body.querySelector('#cx-reasons').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-reason]')
    if (!b) return
    reason = b.dataset.reason
    sheet.body.querySelectorAll('[data-reason]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)))
    sheet.body.querySelector('#cx-hint').textContent = reason === 'other' ? '(please add a few words)' : '(optional)'
  })
  const go = sheet.foot.querySelector('#cx-go')
  go.addEventListener('click', async () => {
    const err = sheet.body.querySelector('#cx-err')
    const note = sheet.body.querySelector('#cx-note').value.trim()
    const date = sheet.body.querySelector('#cx-date').value
    err.hidden = true
    if (!reason) { err.textContent = 'Choose a reason.'; err.hidden = false; return }
    if (reason === 'other' && note.length < 3) { err.textContent = 'Add a few words so the coach knows why.'; err.hidden = false; return }
    go.disabled = true
    go.textContent = 'Sending'
    const r = await api('/api/jfp-account', { action: 'cancelSession', rowId: e.rowId, date, reason, note })
    if (!r.ok) {
      go.disabled = false
      go.textContent = 'Tell the coach and Ligia'
      err.textContent = r.data.error || 'Could not send that. Try again.'
      err.hidden = false
      if (r.status === 401) { closeSheet(true); showSignIn() }
      return
    }
    const c = r.data.cancellation
    // Never a coach's name (Lee, 14 Oct 2026): "the coach". Round 3: say
    // plainly who heard, the coach taking the session and Ligia.
    const t = r.data.toldWho || { coach: r.data.told.length > 0, staff: true }
    const who = t.coach && t.staff ? 'the coach and Ligia' : t.coach ? 'the coach' : t.staff ? 'Ligia and the Joner Football team' : ''
    const s = (e.sessions || []).find((x) => x.iso === c.date) || { label: c.label }
    sheet.setTitle('Thank you')
    sheet.body.innerHTML = `<div class="j-box j-box-green" data-cx-done><b>${r.data.already ? 'We already had this one.' : 'Done.'}</b> ${who ? `We have told ${esc(who)} that ${esc(p.name)} cannot make ${esc(c.label)}, ${esc(e.time)}.` : `We have saved that ${esc(p.name)} cannot make ${esc(c.label)}. Our email did not go, so please call or text below.`}</div>
      ${c.noticeLevel !== 'ok' ? '<p style="margin-top:12px">That is short notice, so please call or text the coach or Ligia as well.</p>' : ''}
      <p class="ja-small ja-muted" style="margin-top:12px">Need to reach them quickly?</p>${reach(e, p, s)}
      <p class="ja-small ja-muted" style="margin-top:12px">Changed your mind? Press Undo on the date before the session starts.</p>`
    sheet.foot.innerHTML = '<button type="button" class="ja-btn ja-btn-light ja-btn-block" id="cx-done">Done</button>'
    sheet.foot.querySelector('#cx-done').addEventListener('click', () => closeSheet())
    load()
  })
}

// ---------- waiver ----------

// The adult waiver (18 or over, signing for themselves) or the parent or
// guardian one. Juniors children are always the guardian one. A date of
// birth typed on the sheet decides when there was none on file.
const ageFrom = (dob) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(dob || '')) return null; const t = sydIso(); let a = Number(t.slice(0, 4)) - Number(dob.slice(0, 4)); if (t.slice(5) < dob.slice(5)) a -= 1; return a }
const isAdult = (p) => !p.key.startsWith('jj:') && p.adult === true
function waiverSheet(keys) {
  let players = [...D.players, ...(D.juniors?.children || [])].filter((p) => keys.includes(p.key))
  if (!players.length) return
  // One kind per sheet: children first (a parent signs), then each adult
  // player on their own (they sign for themselves).
  const kids = players.filter((p) => !isAdult(p))
  players = kids.length ? kids : players.slice(0, 1)
  let kind = kids.length ? 'guardian' : 'adult'
  const sheet = openSheet({ title: kind === 'adult' ? 'Sign your waiver' : 'Sign the waiver', subtitle: players.map((p) => p.name).join(', ') })
  const term = players.some((p) => p.key.startsWith('jj:')) ? `${D.term}, JFP and Joners Juniors` : D.term
  let w = null
  sheet.body.innerHTML = players.map((p) => `
    <div class="j-card" style="padding:12px 14px;margin-bottom:10px" data-wp="${esc(p.key)}">
      <h3 style="margin-bottom:8px">${esc(p.name)}</h3>
      ${p.needsDob ? `<label class="j-field"><span>Date of birth</span><input class="j-input" type="date" data-f="dob" min="1940-01-01" max="${new Date().toISOString().slice(0, 10)}"></label>` : ''}
      <div class="j-two"><label class="j-field"><span>Emergency contact</span><input class="j-input" data-f="emergencyName"></label><label class="j-field"><span>Their phone</span><input class="j-input" type="tel" inputmode="tel" data-f="emergencyPhone"></label></div>
      <div class="j-two"><label class="j-field"><span>Current club <span class="muted">(optional)</span></span><input class="j-input" data-f="club"></label><label class="j-field"><span>Medical notes <span class="muted">(optional)</span></span><input class="j-input" data-f="medical"></label></div>
    </div>`).join('') + `
    <div class="j-two"><label class="j-field"><span id="wp-name-l"></span><input class="j-input" id="wp-name" autocomplete="name"></label><label class="j-field"><span>Your mobile</span><input class="j-input" id="wp-mobile" type="tel" inputmode="tel" autocomplete="tel"></label></div>
    <div id="wp-block"></div>`
  const nameBox = sheet.body.querySelector('#wp-name')
  const draw = () => {
    const keep = w?.read()
    w = waiverBlock(term, { kind, self: kind === 'adult' })
    sheet.setTitle?.(kind === 'adult' ? 'Sign your waiver' : 'Sign the waiver')
    sheet.body.querySelector('#wp-name-l').textContent = kind === 'adult' ? 'Your full name' : 'Parent or guardian name'
    if (!nameBox.dataset.typed) nameBox.value = kind === 'adult' ? players[0].name : (D.self ? '' : D.parentName || '')
    const box = sheet.body.querySelector('#wp-block')
    box.replaceChildren(w.el)
    // Ticks and signature carry over if the version changes.
    if (keep) { for (const [k, v] of Object.entries(keep.accepted)) { const i = w.el.querySelector(`[data-w="${k}"]`); if (i) i.checked = v } w.el.querySelector('[data-w="media"]').checked = keep.media; w.el.querySelector('[data-w="signature"]').value = keep.signature }
  }
  draw()
  nameBox.addEventListener('input', () => { nameBox.dataset.typed = '1' })
  // One player whose date of birth was not on file: what they type decides.
  if (players.length === 1 && players[0].needsDob && !players[0].key.startsWith('jj:')) {
    sheet.body.querySelector('[data-f="dob"]').addEventListener('change', (ev) => {
      const a = ageFrom(ev.target.value)
      const next = a == null ? kind : a >= 18 ? 'adult' : 'guardian'
      if (next !== kind) { kind = next; delete nameBox.dataset.typed; draw() }
    })
  }
  sheet.body.insertAdjacentHTML('beforeend', '<p class="j-err" id="wp-err" hidden></p>')
  sheet.foot.innerHTML = '<button type="button" class="ja-btn ja-btn-red ja-btn-block" id="wp-sign">Sign the waiver</button>'
  sheet.foot.querySelector('#wp-sign').addEventListener('click', async () => {
    const err = sheet.body.querySelector('#wp-err')
    if (!w.complete()) { err.textContent = kind === 'adult' ? 'Tick the first five boxes and type your full name to sign.' : 'Tick the first four boxes and type your full name to sign.'; err.hidden = false; return }
    const list = players.map((p) => {
      const box = sheet.body.querySelector(`[data-wp="${CSS.escape(p.key)}"]`)
      const v = { key: p.key }
      box.querySelectorAll('[data-f]').forEach((i) => { v[i.dataset.f] = i.value.trim() })
      return v
    })
    const btn = sheet.foot.querySelector('#wp-sign')
    btn.disabled = true
    const r = await api('/api/jfp-account', { action: 'signWaiver', players: list, waiver: w.read(), parentName: nameBox.value.trim(), mobile: sheet.body.querySelector('#wp-mobile').value.trim() })
    btn.disabled = false
    if (!r.ok) {
      // The date of birth says the other version: show it and sign again.
      if (r.data.code === 'adult' && kind !== 'adult') { kind = 'adult'; draw() } else if (r.data.code === 'guardian' && kind !== 'guardian') { kind = 'guardian'; draw() }
      err.textContent = r.data.error || 'Could not save the waiver. Try again.'; err.hidden = false; return
    }
    closeSheet(true)
    toast('Waiver signed. Thank you.')
    await load()
    loadProfiles()
    // Someone still to sign (an adult player signs their own): say so.
    if (keys.some((k) => !players.some((p) => p.key === k) && D.players.some((p) => p.key === k && !p.waiver.onFile))) toast('Thank you. One more waiver to sign, see To do.')
  })
}

// ---------- clicks ----------

document.addEventListener('click', async (e) => {
  const ls = e.target.closest('[data-login-set]')
  if (ls) { const p = D.players.find((x) => x.key === ls.dataset.loginSet); if (p) loginSheet(p, D, () => load()); return }
  const t = e.target
  if (t.closest('[data-more]')) return moreSheet()
  if (t.closest('#ja-me')) return accountSheet()
  const th = t.closest('[data-theme-pick]')
  if (th) return setTheme(th.dataset.themePick)
  if (t.closest('[data-install]')) return installSheet()
  if (t.closest('[data-todo-open]')) return todoSheet()
  const kp = t.closest('[data-kid-pick]')
  if (kp) { sessKid = kp.dataset.kidPick; return renderSessions() }
  const ex = t.closest('[data-expand]')
  if (ex) { const id = ex.dataset.expand; if (expanded.has(id)) expanded.delete(id); else expanded.add(id); renderSessions(); document.querySelector(`[data-enrol="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' }); return }
  const sec = t.closest('[data-navsec]')
  if (sec) return toggleNav(sec.dataset.navsec)
  if (t.closest('[data-waiver-all]')) return waiverSheet(unsignedWaivers().map((p) => p.key))
  if (extraClick(t, { D })) return
  const mk = t.closest('[data-makeup-ask]'); if (mk) return askMakeup(mk.dataset.makeupAsk, load)
  if (t.closest('#sign-out') || t.closest('#ja-signout2') || t.closest('#sign-out-fam')) { clearLast(); await signOut('parent'); location.href = '/jfp-account/'; return }
  if (t.closest('[data-contact]')) { e.preventDefault(); if (D) { closeSheet(true); show('contact') } else contactSheet(); return }
  const go = t.closest('[data-go]')
  if (go) {
    if (go.dataset.topic) topic = go.dataset.topic
    closeSheet(true)
    if (['contact', 'news', 'notes', 'reports', 'alerts'].includes(go.dataset.go)) delete document.querySelector(`[data-pane="${go.dataset.go}"]`)?.dataset.drawn
    // A player row on Home opens Sessions on that player.
    if (go.dataset.kid) { sessKid = go.dataset.kid; delete pane('sessions')?.dataset.drawn }
    show(go.dataset.go)
    return
  }
  const nav = t.closest('.j-sheet a.ja-nav-item, .j-sheet a.ja-tile')
  if (nav) { closeSheet(true); return }
  const yt = t.closest('[data-yt]')
  if (yt) return playVideo(yt.dataset.yt, yt.dataset.title)
  const rp = t.closest('[data-rail-prev], [data-rail-next]')
  if (rp) { const r = $(rp.dataset.railPrev || rp.dataset.railNext); if (r) r.scrollBy({ left: (rp.dataset.railPrev ? -1 : 1) * r.clientWidth * 0.92, behavior: 'smooth' }); return }
  const ics = t.closest('[data-ics]')
  if (ics) return calendarSheet(ics.dataset.ics)
  const tp = t.closest('[data-topic-pick]')
  if (tp) { topic = tp.getAttribute('aria-pressed') === 'true' ? '' : tp.dataset.topicPick; document.querySelectorAll('[data-topic-pick]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.topicPick === topic))); return }
  if (t.closest('#ct-send')) return sendContact(t.closest('#ct-send'))
  const segBtn = t.closest('[data-seg] [data-val]')
  if (segBtn) { const g = segBtn.closest('[data-seg]'); const on = segBtn.getAttribute('aria-pressed') !== 'true'; g.querySelectorAll('[data-val]').forEach((b) => b.setAttribute('aria-pressed', String(on && b === segBtn))); return }
  const multi = t.closest('[data-multi] [data-val]')
  if (multi) { multi.setAttribute('aria-pressed', String(multi.getAttribute('aria-pressed') !== 'true')); return }
  if (t.closest('[data-add-player]')) { closeSheet(true); return addPlayerSheet() }
  const cpf = t.closest('[data-coach-profile]')
  if (cpf) return coachSheet(cpf.dataset.coachProfile)
  const sp = t.closest('[data-save-prof]')
  if (sp) return saveProf(sp.dataset.saveProf, sp)
  const prm = t.closest('[data-photo-rm]')
  if (prm) return savePhotoFor(prm.dataset.photoRm, null, true)
  const it = t.closest('[data-interest]')
  if (it) {
    it.disabled = true
    it.textContent = 'Saving'
    const r = await api('/api/jfp-account', { action: 'nextTermInterest', rowId: it.dataset.interest })
    if (!r.ok) { it.disabled = false; it.textContent = 'I want to keep this spot'; return toast(r.data.error || 'Could not save that.') }
    const k = D.keep.players.find((x) => x.rowId === it.dataset.interest)
    if (k) k.interested = true
    toast("You are on the list. We will email you first.")
    return renderKeep()
  }
  // Something owing with no payment link yet: the server makes the request
  // (working out the amount itself), then opens Stripe as Pay does.
  const ow = t.closest('[data-owed]')
  if (ow) {
    if (ow.disabled) return
    ow.disabled = true
    ow.textContent = 'Opening'
    // Round 3: each way to pay is its own card and button. "Choose how
    // many" reads the number from its own card.
    const card = ow.closest('.ja-opt-card') || ow.closest('[data-pane]') || document
    const n = ow.hasAttribute('data-owed-count') ? card.querySelector(`[data-owed-n="${CSS.escape(ow.dataset.owed)}"]`) : null
    const r = await api('/api/jfp-account', { action: 'payOwed', rowId: ow.dataset.owed, ...(ow.dataset.owedOption ? { option: ow.dataset.owedOption } : n ? { sessions: Number(n.value) } : {}) })
    if (r.ok && r.data.url) { location.href = r.data.url; return }
    ow.disabled = false
    ow.textContent = 'Try again'
    if (r.data.code === 'waiver') { await load(); return toast('Sign the waiver first.') }
    if (r.data.code === 'kit') { await load(); return toast('Confirm the JF playing kit first, then pay.') }
    toast(r.data.error || 'Could not start the payment.')
    if (r.status === 409) load()
    return
  }
  // My sessions: "Pay for sessions" opens Fees at that player's options.
  const gp = t.closest('[data-go-pay]')
  if (gp) {
    show('fees')
    const el = document.querySelector(`[data-pane="fees"] [data-fees-owed="${CSS.escape(gp.dataset.goPay)}"]`)
    if (el) { el.scrollIntoView({ block: 'start' }); el.style.boxShadow = '0 0 0 2px var(--ja-hi)' }
    return
  }
  // A pay-ahead link they made: close it and choose again.
  const again = t.closest('[data-choose-again]')
  if (again) {
    again.disabled = true
    const r = await api('/api/jfp-account', { action: 'cancelOwed', payreqId: again.dataset.chooseAgain })
    if (!r.ok) { again.disabled = false; toast(r.data.error || 'Could not change that.'); if (r.status === 409) load(); return }
    await load()
    return toast('Choose how you want to pay.')
  }
  // The PDF tax invoice for one of the family's own payments (Fees).
  const fp = t.closest('[data-fee-pdf]')
  if (fp) {
    fp.disabled = true
    const r = await api('/api/jfp-account', { action: 'invoicePdf', payreqId: fp.dataset.feePdf })
    fp.disabled = false
    if (r.ok && r.data.pdf) savePdf(r.data); else toast(r.data.error || 'Could not get the invoice. Try again.')
    return
  }
  // A receipt PDF for any payment on Fees, cash and bank included.
  const fr = t.closest('[data-fee-receipt]')
  if (fr) {
    fr.disabled = true
    const r = await api('/api/jfp-account', { action: 'receiptPdf', id: fr.dataset.feeReceipt })
    fr.disabled = false
    if (r.ok && r.data.pdf) savePdf(r.data); else toast(r.data.error || 'Could not get the receipt. Try again.')
    return
  }
  const pay = t.closest('[data-pay]')
  if (pay) {
    pay.disabled = true
    pay.textContent = 'Opening'
    const r = await api('/api/jfp-account', { action: 'pay', payreqId: pay.dataset.pay })
    if (r.ok && r.data.url) { location.href = r.data.url; return }
    pay.disabled = false
    pay.textContent = 'Try again'
    if (r.data.code === 'waiver') { load(); toast('Sign the waiver first.') } else if (r.data.code === 'kit') { load(); toast('Confirm the JF playing kit first.') } else toast(r.data.error || 'Could not start the payment.')
    return
  }
  const kb = t.closest('[data-kit]')
  if (kb) {
    kb.disabled = true
    const r = await api('/api/jfp-account', { action: 'confirmKit', payreqId: kb.dataset.kitFor, kit: kb.dataset.kit })
    if (!r.ok) { kb.disabled = false; return toast(r.data.error || 'Could not save that.') }
    toast('Thanks. Now you can pay.')
    return load()
  }
  const cm = t.closest('[data-coming]')
  if (cm) return comingSave(cm, cm.dataset.coming, [cm.dataset.comingDate], cm.getAttribute('aria-pressed') !== 'true')
  const ca = t.closest('[data-coming-all]')
  if (ca) { const en = D.players.flatMap((p) => p.enrolments).find((x) => x.rowId === ca.dataset.comingAll); if (en) { const said = new Set(en.coming || []); return comingSave(ca, en.rowId, comingOpen(en).filter((d) => !said.has(d)), true) } return }
  const cx = t.closest('[data-cancel-open]')
  if (cx) {
    const p = D.players.find((x) => x.key === cx.dataset.cancelPlayer)
    const en = p?.enrolments.find((x) => x.rowId === cx.dataset.cancelOpen)
    if (en) cancelSheet(en, p, cx.dataset.cancelDate || '')
    return
  }
  const undo = t.closest('[data-cancel-undo]')
  if (undo) {
    if (!confirm('Tell the team this player is coming after all?')) return
    undo.disabled = true
    const r = await api('/api/jfp-account', { action: 'withdrawCancel', id: undo.dataset.cancelUndo })
    if (!r.ok) { undo.disabled = false; return toast(r.data.error || 'Could not undo that.') }
    toast('Done. We have told the team.')
    return load()
  }
  const nx = t.closest('[data-next]')
  if (nx) {
    const choice = nx.dataset.next
    if (choice === 'no' && !confirm('Tell us this player is not returning next term?')) return
    nx.disabled = true
    const r = await api('/api/jfp-account', { action: 'nextTermChoice', rowId: nx.dataset.row, choice })
    if (!r.ok) { nx.disabled = false; return toast(r.data.error || 'Could not save that.') }
    if (choice === 'no') { toast('Thanks for letting us know.'); return load() }
    const p = await api('/api/jfp-account', { action: 'pay', payreqId: r.data.payreqId })
    if (p.ok && p.data.url) { location.href = p.data.url; return }
    nx.disabled = false
    if (p.data.code === 'waiver') { await load(); return toast('Sign the waiver first, then pay.') }
    return toast(p.data.error || 'Could not start the payment.')
  }
  const jp = t.closest('[data-jjpay], [data-jjask], [data-jjnext]')
  if (jp) return jjAct(jp)
  const wt = t.closest('[data-waiver-for]')
  if (wt && D.juniors?.todo?.some((x) => x.id === wt.dataset.waiverFor)) {
    const td = D.juniors.todo.find((x) => x.id === wt.dataset.waiverFor)
    return waiverSheet(D.juniors.children.filter((c) => !c.waiver.onFile && td.players.includes(c.name)).map((c) => c.key))
  }
  if (wt) {
    const td = D.todo.find((x) => x.id === wt.dataset.waiverFor)
    const keys = D.players.filter((p) => !p.waiver.onFile && td.players.includes(p.name)).map((p) => p.key)
    return waiverSheet(keys.length ? keys : D.players.filter((p) => !p.waiver.onFile && !(p.byAgent && !D.playerLogin)).map((p) => p.key))
  }
  const wp = t.closest('[data-waiver-player]')
  const wpp = wp && D.players.find((p) => p.key === wp.dataset.waiverPlayer)
  if (wpp?.byAgent && !D.playerLogin) return agentWaiverSheet(wpp)
  if (wp) {
    // From the More sheet: every waiver still to sign, one sheet (children first).
    if (wp.closest('.ja-tiles')) { closeSheet(true); return waiverSheet(unsignedWaivers().map((p) => p.key)) }
    return waiverSheet([wp.dataset.waiverPlayer])
  }
})
window.addEventListener('hashchange', () => { const [h, hq] = location.hash.slice(1).split('?'); if (h === 'extra' && hq) { setExtraLink(hq); const el = pane('extra'); if (el) delete el.dataset.drawn } if (D && PANELS.includes(h) && (h !== current || hq)) show(h) })

// ---------- Joners Juniors: the same login, its own cards ----------
// Nothing here shows for a family with no Juniors child (D.juniors is null).

const jjDot = (pm) => `<span class="ja-dot ${{ paid: 'ok', due: 'bad', owing: 'bad', part: 'warn', arranged: 'warn' }[pm.state] || ''}">${esc(pm.label)}</span>`

function jjTodoCards() {
  const J = D.juniors
  if (!J?.todo?.length) return ''
  const want = q.get('pay')
  return [...J.todo].sort((x, y) => Number(y.id === want) - Number(x.id === want)).map((t) => `
    <div class="ja-card ja-todo" data-todo="${esc(t.id)}"${t.id === want ? ' style="box-shadow:0 0 0 2px var(--ja-hi)"' : ''}>
      <div class="ja-card-head"><div><p class="ja-kicker"><i></i>Joners Juniors</p><h3 class="ja-h3" style="margin-top:8px;font-size:18px">${esc(t.players.join(' and '))}</h3>
      <p class="ja-muted ja-small" style="margin-top:3px">${t.places?.length ? t.places.map((x) => `${esc(x.name)}: ${esc(x.amountLabel)}`).join('<br>') : esc(t.what || '')}${t.places?.length && t.what ? `<br>${esc(t.what)}` : ''}</p></div></div>
      <ul class="ja-list">
        <li class="ja-row"><span class="ja-num ${t.needsWaiver ? '' : 'done'}">${t.needsWaiver ? '1' : ic('check')}</span><div><b>Waiver</b><small>${t.needsWaiver ? 'One family waiver covers JFP and Joners Juniors.' : 'On file.'}</small></div>${t.needsWaiver ? `<button type="button" class="ja-btn ja-btn-light ja-btn-sm" data-waiver-for="${esc(t.id)}">Sign</button>` : ''}</li>
        <li class="ja-row"><span class="ja-num">2</span><div><b>Pay ${esc(t.amountLabel)}</b><small>Card, Apple Pay or Google Pay.</small></div><button type="button" class="ja-btn ja-btn-red ja-btn-sm" data-jjpay="${esc(t.id)}" ${t.needsWaiver ? 'disabled title="Sign the waiver first"' : ''}>Pay</button></li>
      </ul>
    </div>`).join('')
}

function jjNextBlock(c) {
  const x = c.next
  if (!x) return ''
  const title = `<p class="ja-small" style="margin-top:12px"><b>${esc(D.juniors.nextTerm?.name || 'Next term')}</b></p>`
  if (x.status === 'paid') return `${title}<p style="margin-top:6px"><span class="ja-dot ok">Paid in full, locked in</span></p>`
  if (x.status === 'held') return `${title}<p class="ja-small ja-muted" style="margin-top:6px"><span class="ja-dot ok">Place held</span> Pay the rest (${esc(x.afterHoldLabel)}) when you are ready.</p><button type="button" class="ja-btn ja-btn-red ja-btn-sm" data-jjnext="full" data-row="${esc(c.rowId)}" style="margin-top:8px">Pay the rest</button>`
  if (x.status === 'no') return `${title}<p style="margin-top:6px"><span class="ja-dot">Not returning</span> <button type="button" class="ja-link ja-small" data-jjnext="full" data-row="${esc(c.rowId)}">Changed your mind? Pay ${esc(x.fullLabel)}</button></p>`
  return `${title}<ul class="ja-list">
      <li class="ja-row"><div><b>Keep the place: ${esc(x.fullLabel)}</b><small>Locked in for the term.</small></div><button type="button" class="ja-btn ja-btn-red ja-btn-sm" data-jjnext="full" data-row="${esc(c.rowId)}">Pay</button></li>
      ${x.holdLabel ? `<li class="ja-row"><div><b>Hold the place: ${esc(x.holdLabel)}</b><small>Not sure yet? Non-refundable, and it comes off the term fee.</small></div><button type="button" class="ja-btn ja-btn-line ja-btn-sm" data-jjnext="hold" data-row="${esc(c.rowId)}">Hold</button></li>` : ''}
      <li class="ja-row"><div><b>Not returning</b><small>We will offer the spot to a family on the waitlist.</small></div><button type="button" class="ja-btn ja-btn-line ja-btn-sm" data-jjnext="no" data-row="${esc(c.rowId)}">Tell us</button></li>
    </ul>`
}

// The Joners Juniors card on Home: the class, each child, paid, waiver, Pay, next term.
function jjHomeCard() {
  const J = D.juniors
  if (!J) return ''
  return `<div class="ja-card" id="jj-home"><div class="ja-card-head"><div><p class="ja-kicker"><i></i>Joners Juniors</p><h3 class="ja-h3" style="margin-top:8px">${esc(J.classLabel)}</h3><p class="ja-muted ja-small" style="margin-top:3px">${esc(J.location)} · ${esc(J.term)}${J.datesLabel ? `, ${esc(J.datesLabel)}` : ''}</p></div></div>
    <ul class="ja-list">${J.children.map((c) => `<li class="ja-row" data-jjchild="${esc(c.rowId)}"><span class="ja-avatar">${esc(initials(c.name))}</span><div><b>${esc(c.name)}</b><small>${c.nextDate ? `Next class ${esc(c.nextDate)}` : c.firstDate ? `First class ${esc(c.firstDate)}` : esc(c.className)}${c.age != null ? ` · age ${esc(c.age)}` : ''}</small>
        ${c.payment.canPay ? `<button type="button" class="ja-btn ja-btn-red ja-btn-sm" style="margin-top:8px" data-jjask="${esc(c.rowId)}">${c.payment.state === 'part' ? 'Pay what is left' : `Pay ${esc(c.payment.label.replace(/ to pay$/, ''))}`}</button>` : ''}
        ${jjNextBlock(c)}</div>
      <div class="ja-flags">${jjDot(c.payment)}${c.waiver.onFile ? '<span class="ja-dot ok">Waiver</span>' : `<button type="button" class="ja-dot bad" data-waiver-player="${esc(c.key)}">Sign waiver</button>`}</div></li>`).join('')}</ul>
    ${J.paid?.length ? `<p class="ja-muted ja-small" style="margin-top:10px">Paid online: ${J.paid.map((x) => `${esc(x.amountLabel)} for ${esc(x.players.join(', '))} (${esc(x.what)})`).join('; ')}</p>` : ''}</div>`
}

// My sessions: every Juniors class date, the next one marked.
function jjSessions() {
  const J = D.juniors
  if (!J) return ''
  return J.children.map((c) => `<section class="ja-card" style="margin-bottom:14px">
      <div class="ja-enrol-head"><img src="${IMG}/photos/hq-indoor-800x1000.webp" alt="" loading="lazy"><div><h2>${esc(c.name)}</h2><p>Joners Juniors · ${esc(c.className)} · ${esc(c.location)}</p><p style="margin-top:6px">${jjDot(c.payment)}</p></div></div>
      <ol class="ja-dates">${c.dates.map((label, i) => {
        const [dow, dd, mon] = String(label).split(' ')
        const next = label === c.nextDate
        return `<li class="ja-date ${next ? 'is-next' : ''}"><span class="d"><b>${esc(dd || '')}</b><i>${esc(mon || '')}</i></span><span class="w"><b>${esc(dow || label)}${next ? '<span class="ja-tag">Next</span>' : ''}</b>Week ${i + 1}</span><span></span></li>`
      }).join('')}</ol>
    </section>`).join('')
}

async function jjAct(b) {
  b.disabled = true
  const again = () => { b.disabled = false }
  const go = async (payreqId) => {
    const r = await api('/api/jfp-account', { action: 'jjPay', payreqId })
    if (r.ok && r.data.url) { location.href = r.data.url; return }
    again()
    if (r.data.code === 'waiver') { await load(); return toast('Sign the waiver first, then pay.') }
    toast(r.data.error || 'Could not start the payment.')
    if (r.status === 409) load()
  }
  if (b.dataset.jjpay) return go(b.dataset.jjpay)
  if (b.dataset.jjask) {
    const r = await api('/api/jfp-account', { action: 'jjRequestPay', rowIds: [b.dataset.jjask] })
    if (!r.ok) { again(); toast(r.data.error || 'Could not start the payment.'); if (r.data.code === 'paid') load(); return }
    return go(r.data.payreqId)
  }
  const choice = b.dataset.jjnext
  if (choice === 'no' && !confirm('Tell us this child is not returning next term?')) return again()
  const r = await api('/api/jfp-account', { action: 'jjNextChoice', rowId: b.dataset.row, choice })
  if (!r.ok) { again(); return toast(r.data.error || 'Could not save that.') }
  if (choice === 'no') { toast('Thanks for letting us know.'); return load() }
  return go(r.data.payreqId)
}

boot()

// Choose how many: the total and the dates for the number chosen.
document.addEventListener('change', (e) => {
  const sel = e.target.closest?.('[data-owed-n]')
  if (!sel) return
  const o = (D?.owed || []).find((x) => x.rowId === sel.dataset.owedN)
  const card = sel.closest('.ja-opt-card')
  if (!o || !card) return
  const n = Number(sel.value)
  card.querySelectorAll('[data-count-total]').forEach((x) => { x.textContent = money(n * o.perCents) })
  const d = card.querySelector('[data-count-dates]')
  if (d) d.textContent = o.dates.slice(0, n).map((x) => x.label).join(', ')
})

document.addEventListener('change', (e) => {
  const inp = e.target.closest?.('[data-photo-for]')
  if (inp) savePhotoFor(inp.dataset.photoFor, inp).finally(() => { inp.value = '' })
})
