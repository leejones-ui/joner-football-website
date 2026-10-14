// My account, the family portal (Lee, 13 Oct 2026). Sign in with an emailed
// code, then: the next session first, every date, player information (club,
// position, contacts), can't make a session, keep my spot for next term,
// term info, holidays and camps, training videos, the app and contact.
// Phones first: a bottom tab bar on phones, a side bar on big screens.
import { $, esc, api, toast, openSheet, closeSheet, signIn, whoAmI, signOut, waiverBlock, recaptcha } from './jfp-common.js'
import { termInfo, expectations, links } from '../data/jfp-term-info.js'
import { hqVideos, pitchVideos, reels, socials, contacts, hq, holidays } from '../data/jfp-account-media.js'

const q = new URLSearchParams(location.search)
let D = null
let PROF = null
// Fees (14 Oct 2026): read when the Fees tab first opens, again after each load.
let FEES = null
const PANELS = ['home', 'sessions', 'fees', 'info', 'cancel', 'keep', 'term', 'holidays', 'videos', 'app', 'contact']
let current = 'home'
const KIT_URL = 'https://www.besteamsport.com.au/collections/joner-football'
const IMG = '/images/jfp-account'

// ---------- icons ----------

const PATHS = {
  home: '<path d="M3.5 10.2 12 3.5l8.5 6.7V19a1.5 1.5 0 0 1-1.5 1.5h-4.5v-6h-5v6H5A1.5 1.5 0 0 1 3.5 19z"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 9.8h17M8 3v4M16 3v4"/>',
  card: '<rect x="2.8" y="5.5" width="18.4" height="13" rx="2.4"/><path d="M2.8 10h18.4M6.5 14.8h4"/>',
  calplus: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 9.8h17M8 3v4M16 3v4M12 12.8v5M9.5 15.3h5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5c1.4-3.8 4.3-5.7 7.5-5.7s6.1 1.9 7.5 5.7"/>',
  camera: '<path d="M4 8h3l1.6-2.4h6.8L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.4"/>',
  xcircle: '<circle cx="12" cy="12" r="8.5"/><path d="m9.2 9.2 5.6 5.6m0-5.6-5.6 5.6"/>',
  bookmark: '<path d="M6.5 3.5h11v17l-5.5-4-5.5 4z"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.6v.4"/>',
  sun: '<circle cx="12" cy="12" r="3.8"/><path d="M12 2.8v2M12 19.2v2M4.6 4.6 6 6M18 18l1.4 1.4M2.8 12h2M19.2 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
  grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.6"/>',
  play: '<circle cx="12" cy="12" r="8.5"/><path d="m10.2 8.6 5 3.4-5 3.4z" fill="currentColor"/>',
  playsolid: '<path d="M7 4.5v15l12.5-7.5z" fill="currentColor" stroke="none"/>',
  phone: '<rect x="6.5" y="2.8" width="11" height="18.4" rx="2.6"/><path d="M10.5 18h3"/>',
  shirt: '<path d="M8.2 3.5 3.8 6l1.5 4.3 2-.8v11h9.4v-11l2 .8L20.2 6l-4.4-2.5c-.6 1.6-2 2.6-3.8 2.6s-3.2-1-3.8-2.6z"/>',
  chat: '<path d="M20.5 12a8.5 8.5 0 0 1-12.3 7.6l-4.7 1.2 1.3-4.5A8.5 8.5 0 1 1 20.5 12z"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h11"/>',
  ext: '<path d="M7.5 16.5 16.5 7.5M9.5 7.5h7v7"/>',
  arrow: '<path d="M5 12h14m-5.5-5.5L19 12l-5.5 5.5"/>',
  left: '<path d="m14.5 6-6 6 6 6"/>',
  right: '<path d="m9.5 6 6 6-6 6"/>',
  pin: '<path d="M12 21s-6.8-6-6.8-11.2a6.8 6.8 0 0 1 13.6 0C18.8 15 12 21 12 21z"/><circle cx="12" cy="9.8" r="2.4"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  whistle: '<circle cx="9" cy="14" r="5"/><path d="M12.5 10.5 20.5 7v4l-6 1.5M9 14h.01"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  call: '<path d="M6.5 3.5h3l1.8 4.6-2.2 1.4a11 11 0 0 0 5.4 5.4l1.4-2.2 4.6 1.8v3a2 2 0 0 1-2.2 2A16 16 0 0 1 4.5 5.7a2 2 0 0 1 2-2.2z"/>',
  mail: '<rect x="3" y="5.5" width="18" height="13" rx="2.2"/><path d="m3.8 7 8.2 6.2L20.2 7"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  apple: '<path d="M16.4 12.6c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.2-2.8.8-3.5.8s-1.8-.8-3-.8C6.9 7.3 5.4 8.2 4.6 9.7c-1.7 2.9-.4 7.3 1.2 9.6.8 1.1 1.7 2.4 3 2.4 1.2-.1 1.6-.8 3.1-.8s1.8.8 3.1.8c1.3 0 2.1-1.2 2.9-2.3.9-1.3 1.3-2.6 1.3-2.7-.1 0-2.8-1-2.8-4.1zM14.1 5.8c.7-.8 1.1-1.9 1-3-1 0-2.1.7-2.8 1.5-.6.7-1.2 1.8-1 2.9 1.1.1 2.1-.6 2.8-1.4z" fill="currentColor" stroke="none"/>',
  gplay: '<path d="M4.2 3.3 13.6 12l-9.4 8.7c-.4-.2-.7-.7-.7-1.3V4.6c0-.6.3-1.1.7-1.3zM15 10.6l2.6-2.4L6 2.1l9 8.5zm0 2.8-9 8.5 11.6-6.1zm1.3-1.4 3 1.6c.9-.5.9-1.7 0-2.2l-3-1.6-1.7 1.6z" fill="currentColor" stroke="none"/>',
  instagram: '<rect x="3" y="3" width="18" height="18" rx="5.2"/><circle cx="12" cy="12" r="4.2"/><circle cx="17.4" cy="6.6" r="1.1" fill="currentColor" stroke="none"/>',
  youtube: '<path d="M21.6 7.2a2.6 2.6 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4A2.6 2.6 0 0 0 2.4 7.2C2 8.8 2 12 2 12s0 3.2.4 4.8a2.6 2.6 0 0 0 1.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4a2.6 2.6 0 0 0 1.8-1.8c.4-1.6.4-4.8.4-4.8s0-3.2-.4-4.8z" fill="currentColor" stroke="none"/><path d="m10 15 5.2-3L10 9z" fill="#0A0A0B" stroke="none"/>',
  tiktok: '<path d="M16.6 3c.4 2.3 1.8 3.8 4.1 4v3.1a7.7 7.7 0 0 1-4-1.2v6.4a5.8 5.8 0 1 1-5.8-5.8c.3 0 .7 0 1 .1v3.2a2.7 2.7 0 1 0 1.8 2.5V3z" fill="currentColor" stroke="none"/>',
  facebook: '<path d="M13.5 21v-7.4h2.5l.4-2.9h-2.9V8.9c0-.8.2-1.4 1.4-1.4h1.6V4.9c-.3 0-1.2-.1-2.3-.1-2.3 0-3.8 1.4-3.8 3.9v2.1H7.8v2.9h2.6V21z" fill="currentColor" stroke="none"/>',
  x: '<path d="M17.8 3.5h3l-6.6 7.5 7.8 9.5h-6.1l-4.8-5.9-5.5 5.9H2.6l7-7.9L2.2 3.5h6.3l4.3 5.4zm-1 15.3h1.7L7.3 5.1H5.5z" fill="currentColor" stroke="none"/>',
  threads: '<path d="M16.8 11.3c-.1 0-.2-.1-.3-.1-.2-3-1.8-4.7-4.6-4.7h0c-1.7 0-3 .7-3.9 2l1.5 1c.7-1 1.7-1.2 2.4-1.2h0c.9 0 1.6.3 2 .8.3.4.5.9.6 1.5-.8-.1-1.6-.2-2.5-.1-2.5.1-4.1 1.6-4 3.6.1 1 .6 1.9 1.4 2.5.7.4 1.6.7 2.6.6 1.3-.1 2.3-.6 3-1.4.5-.7.9-1.5 1-2.6.6.4 1.1.9 1.3 1.5.4 1 .4 2.7-.9 4-1.2 1.2-2.6 1.7-4.7 1.7-2.4 0-4.2-.8-5.3-2.3-1.1-1.4-1.6-3.4-1.7-6 0-2.5.6-4.5 1.7-6C7.8 4.5 9.6 3.7 12 3.7s4.3.8 5.5 2.3c.6.8 1 1.7 1.3 2.8l1.8-.5c-.4-1.4-1-2.5-1.7-3.5C17.4 2.9 15 1.9 12 1.9h0C9 1.9 6.7 2.9 5.1 4.8 3.7 6.6 3 9 3 12s.7 5.4 2.1 7.2c1.6 1.9 3.9 2.9 6.9 2.9h0c2.7 0 4.5-.7 6.1-2.2 2-2 1.9-4.5 1.3-6-.5-1.2-1.4-2.1-2.6-2.6zm-4.4 4.2c-1.1.1-2.2-.4-2.2-1.4 0-.7.5-1.5 2.2-1.6h.6c.6 0 1.2.1 1.7.2-.2 2.4-1.3 2.7-2.3 2.8z" fill="currentColor" stroke="none"/>',
}
const ic = (name, cls = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${cls ? ` class="${cls}"` : ''}>${PATHS[name] || ''}</svg>`

// ---------- small helpers ----------

const first = (name) => String(name || '').trim().split(/\s+/)[0] || ''
const initials = (name) => String(name || '').replace(/\(.*?\)/g, '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || 'J'
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
function payDot(pm) {
  const cls = { paid: 'ok', due: 'bad', trial: 'ok', sessions: 'ok', arranged: 'warn' }[pm.state] || ''
  return `<span class="ja-dot ${cls}">${esc(pm.label)}</span>`
}
function pageHead(kicker, title, lede = '', right = '') {
  return `<header class="ja-head"><div class="ja-head-row"><div><p class="ja-kicker"><i></i>${esc(kicker)}</p><h1 class="ja-display">${esc(title)}</h1></div>${right}</div>${lede ? `<p class="ja-lede">${lede}</p>` : ''}</header>`
}
function hero({ img, imgSmall, kicker, title, lede = '', actions = '' }) {
  return `<div class="ja-hero"><img src="${esc(imgSmall || img)}" srcset="${esc(imgSmall || img)} 900w, ${esc(img)} 1600w" sizes="(min-width: 640px) 80vw, 100vw" alt="" fetchpriority="high">
    <p class="ja-kicker"><i></i>${esc(kicker)}</p><h1 class="ja-display">${title}</h1>${lede ? `<p class="ja-lede">${lede}</p>` : ''}${actions ? `<div class="ja-actions">${actions}</div>` : ''}</div>`
}
function secHead(title, sub = '', railId = '', right = '') {
  return `<div class="ja-sec-head"><div><h2 class="ja-h2">${esc(title)}</h2>${sub ? `<p class="ja-muted ja-small">${sub}</p>` : ''}</div>${railId ? `<div class="ja-sec-nav"><button type="button" class="ja-round" data-rail-prev="${railId}" aria-label="Back">${ic('left')}</button><button type="button" class="ja-round" data-rail-next="${railId}" aria-label="More">${ic('right')}</button></div>` : right}</div>`
}

// ---------- sign in ----------

async function boot() {
  const user = await whoAmI('parent')
  if (!user) return showSignIn()
  start()
}
async function showSignIn() {
  $('signin').hidden = false
  $('app').hidden = true
  await signIn({ mount: $('si-mount'), foot: $('si-foot'), audience: 'parent', intro: 'Use the email address you gave Joner Football.' })
  $('signin').hidden = true
  start()
}
async function start() {
  $('app').hidden = false
  if (q.get('paid') && q.get('session_id')) confirmPaid(q.get('session_id'))
  await load()
  const h = location.hash.slice(1)
  show(PANELS.includes(h) ? h : 'home', { keepScroll: true })
  const payId = q.get('pay')
  if (payId) {
    show('home')
    const el = document.querySelector(`[data-todo="${CSS.escape(payId)}"]`)
    if (el) { el.scrollIntoView({ block: 'center' }); el.style.boxShadow = '0 0 0 2px #fff' }
    else if (D && !D.todo.length && !(D.juniors?.todo || []).length) toast('That payment is already done or no longer open.')
  }
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
  if (r.status === 401) return showSignIn()
  if (!r.ok) { document.querySelector('[data-pane="home"]').innerHTML = `<div class="ja-card">${esc(r.data.error || 'Could not load your account.')}</div>`; return }
  D = r.data
  FEES = null
  render()
}
async function loadProfiles() {
  const r = await api('/api/jfp-account', { action: 'profiles' })
  if (!r.ok) return
  PROF = r.data
  renderShell()
  renderHome()
  renderInfo()
}

// ---------- shell: side bar, tab bar, menu ----------

// The account holder is the player (a Pro or an adult): "My profile".
const solo = () => Boolean(D?.players?.length === 1 && D.players[0].self)
function face(name, photo, extra = '') {
  return photo ? `<span class="ja-avatar ja-face" ${extra}><img src="${esc(photo)}" alt="" loading="lazy"></span>` : `<span class="ja-avatar" ${extra}>${esc(initials(name))}</span>`
}
function nav() {
  return [
    { label: 'My JFP', items: [
      { key: 'home', label: 'Home', icon: 'home' },
      { key: 'sessions', label: 'My sessions', icon: 'calendar' },
      { key: 'fees', label: 'Fees', icon: 'card', dot: feesOwing() > 0 },
      { key: 'info', label: solo() ? 'My profile' : 'Player information', icon: 'user', dot: infoGaps().length > 0 },
      { key: 'cancel', label: "Can't make a session", icon: 'xcircle' },
      { key: 'keep', label: 'Keep my spot', sub: D?.keep?.name || 'Next term', icon: 'bookmark' },
    ] },
    { label: 'Program', items: [
      { key: 'term', label: `About ${termShort()}`, icon: 'info' },
      { key: 'holidays', label: 'Holiday training and camps', icon: 'sun' },
      { href: links.booking, label: 'Timetable', icon: 'grid' },
    ] },
    { label: 'Train', items: [
      { key: 'videos', label: 'Training videos', icon: 'play' },
      { key: 'app', label: 'The JF App', icon: 'phone' },
      { href: D?.kitUrl || KIT_URL, label: 'JF training kit', icon: 'shirt', ext: true },
    ] },
    { label: 'Help', items: [{ key: 'contact', label: 'Contact us', icon: 'chat' }] },
  ]
}
function navItem(it) {
  const inner = `${ic(it.icon)}<span>${esc(it.label)}${it.sub ? `<span class="sub">${esc(it.sub)}</span>` : ''}</span>${it.ext ? ic('ext', 'ext') : it.dot ? '<span class="dot" aria-label="Needs attention"></span>' : ''}`
  if (it.href) return `<a class="ja-nav-item" href="${esc(it.href)}"${it.ext ? ' target="_blank" rel="noopener noreferrer"' : ''}>${inner}</a>`
  return `<button type="button" class="ja-nav-item" data-go="${it.key}" aria-current="${current === it.key ? 'page' : 'false'}">${inner}</button>`
}
// The bottom bar on phones (round 2, 14 Oct 2026): the four places families
// go most, then More. More opens a sheet with everything else in the same
// groups as the side bar on big screens, as tiles, with what needs doing first.
const BAR = [['home', 'Home', 'home'], ['sessions', 'Sessions', 'calendar'], ['fees', 'Fees', 'card'], ['contact', 'Contact', 'chat']]
const unsignedWaivers = () => (D ? [...D.players, ...(D.juniors?.children || [])].filter((p) => !p.waiver?.onFile) : [])
function moreCount() { return infoGaps().length + unsignedWaivers().length }
function renderShell() {
  $('ja-nav').innerHTML = nav().map((g) => `<div class="ja-nav-group"><p class="ja-nav-label">${esc(g.label)}</p>${g.items.map(navItem).join('')}</div>`).join('')
  const n = moreCount()
  const inMore = !BAR.some(([k]) => k === current) && current !== 'home'
  $('ja-tabs').innerHTML = BAR.map(([k, l, i]) => `<button type="button" class="ja-tab" data-go="${k}" aria-current="${current === k ? 'page' : 'false'}">${ic(i)}<span>${l}</span>${k === 'fees' && feesOwing() ? '<span class="badge">!</span>' : ''}</button>`).join('')
    + `<button type="button" class="ja-tab" data-more aria-haspopup="dialog" aria-current="${inMore ? 'page' : 'false'}">${ic('menu')}<span>More</span>${n ? `<span class="badge">${n}</span>` : ''}</button>`
  $('ja-email').textContent = D?.email || ''
  const me = solo() ? D.players[0] : null
  if (me?.photo) $('ja-me').innerHTML = `<img src="${esc(me.photo)}" alt="">`
  else $('ja-me').textContent = initials(me?.name || D?.parentName || D?.email || 'J')
}
function moreTile(it) {
  const inner = `${ic(it.icon)}<span class="t">${esc(it.label)}</span>${it.sub ? `<span class="s">${esc(it.sub)}</span>` : ''}${it.dot ? '<span class="dot" aria-label="Needs attention"></span>' : ''}${it.ext ? ic('ext', 'ext') : ''}`
  if (it.href) return `<a class="ja-tile" href="${esc(it.href)}"${it.ext ? ' target="_blank" rel="noopener noreferrer"' : ''}>${inner}</a>`
  if (it.waivers) return `<button type="button" class="ja-tile is-due" data-waiver-player="${esc(it.waivers[0])}">${inner}</button>`
  return `<button type="button" class="ja-tile" data-go="${it.key}" aria-current="${current === it.key ? 'page' : 'false'}">${inner}</button>`
}
function moreSheet() {
  const sheet = openSheet({ title: 'More', subtitle: D?.email ? `Signed in as ${D.email}` : '' })
  const onBar = new Set(BAR.map(([k]) => k))
  const groups = nav().map((g) => ({ ...g, items: g.items.filter((it) => !onBar.has(it.key)) })).filter((g) => g.items.length)
  // Something to do first (a waiver to sign) sits at the top.
  const w = unsignedWaivers()
  const todo = w.length ? [{ label: 'To do', items: [{ waivers: w.map((p) => p.key), label: w.length === 1 ? (w[0].adult ? 'Sign your waiver' : `Sign ${first(w[0].name)}'s waiver`) : `Sign ${w.length} waivers`, sub: 'Needed before training', icon: 'check', dot: true }] }] : []
  sheet.body.innerHTML = [...todo, ...groups].map((g) => `<div class="ja-more-group"><p class="ja-nav-label">${esc(g.label)}</p><div class="ja-tiles">${g.items.map(moreTile).join('')}</div></div>`).join('')
  sheet.foot.innerHTML = '<button type="button" class="ja-btn ja-btn-line ja-btn-block" id="ja-signout2">Sign out</button>'
}
function show(panel, { keepScroll = false } = {}) {
  if (!PANELS.includes(panel)) panel = 'home'
  current = panel
  document.querySelectorAll('[data-pane]').forEach((x) => { x.hidden = x.dataset.pane !== panel })
  document.querySelectorAll('#ja-nav [data-go], #ja-tabs [data-go]').forEach((b) => b.setAttribute('aria-current', b.dataset.go === panel ? 'page' : 'false'))
  document.querySelector('#ja-tabs [data-more]')?.setAttribute('aria-current', panel !== 'home' && !BAR.some(([k]) => k === panel) ? 'page' : 'false')
  if (location.hash.slice(1) !== panel) history.replaceState(null, '', panel === 'home' ? location.pathname + location.search : `#${panel}`)
  const el = document.querySelector(`[data-pane="${panel}"]`)
  if (el && !el.dataset.drawn) drawPane(panel)
  if (!keepScroll) window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
  requestAnimationFrame(syncRails)
}
const DRAW = { home: () => renderHome(), sessions: () => renderSessions(), fees: () => renderFees(), info: () => renderInfo(), cancel: () => renderCancel(), keep: () => renderKeep(), term: () => renderTerm(), holidays: () => renderHolidays(), videos: () => renderVideos(), app: () => renderApp(), contact: () => renderContact() }
function drawPane(panel) { DRAW[panel]?.(); const el = document.querySelector(`[data-pane="${panel}"]`); if (el) el.dataset.drawn = '1' }

function render() {
  renderShell()
  // Data changed: draw again whatever has been opened.
  document.querySelectorAll('[data-pane]').forEach((el) => { delete el.dataset.drawn })
  drawPane(current)
  if (current !== 'home') drawPane('home')
}

// ---------- home ----------

function ticket({ p, e, next }) {
  const contact = (e.contacts || [])[0]
  const dateBits = fmt(next.startMs, { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '')
  return `<article class="ja-ticket">
    <img src="${esc(photoFor(e))}" ${photoSet(e)} alt="" fetchpriority="high">
    <div class="ja-ticket-top"><span class="ja-live"><i></i>Next session</span><span class="ja-when">${esc(countdown(next.startMs))}</span></div>
    <div class="ja-ticket-body">
      <p class="ja-ticket-player">${esc(p.name)}</p>
      <h2 class="ja-ticket-date"><span>${esc(dateBits)}</span><span class="t">${esc(e.time)}</span></h2>
      <div class="ja-meta"><span>${ic('pin')}${esc(e.location)}</span><span>${ic('clock')}${esc(e.durationMin || 60)} min</span>${e.status && e.status !== 'Confirmed' ? `<span class="ja-tag amber">${esc(e.status)}</span>` : ''}</div>
      <div class="ja-actions">
        ${e.maps ? `<a class="ja-btn ja-btn-light" href="${esc(e.maps)}" target="_blank" rel="noopener noreferrer">${ic('pin')}Directions</a>` : ''}
        <button type="button" class="ja-btn ja-btn-glass" data-cancel-open="${esc(e.rowId)}" data-cancel-player="${esc(p.key)}" data-cancel-date="${esc(next.iso)}">Can't make it</button>
        <button type="button" class="ja-round" data-ics="${esc(e.rowId)}" aria-label="Add every session to your calendar" title="Add to calendar">${ic('calplus')}</button>
        ${contact ? `<a class="ja-round" href="tel:${esc(contact.tel)}" aria-label="Call ${esc(contact.name)}">${ic('call')}</a>` : ''}
      </div>
    </div>
  </article>`
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
const waiverStep = (needs, btn) => `<li class="ja-row"><span class="ja-num ${needs ? '' : 'done'}">${needs ? '1' : ic('check')}</span><div><b>Waiver</b><small>${needs ? 'Sign the JFP waiver first.' : 'On file.'}</small></div>${needs ? btn : ''}</li>`
// Session by session with nothing billed: pay for the next sessions now.
// pane: which page draws it (Home or Fees), so the two copies never share
// a radio group or a select.
function prepayPicker(o, pane = 'home') {
  const opts = Array.from({ length: o.max }, (_, i) => i + 1)
  return `<div class="ja-prepay" data-prepay="${esc(o.rowId)}" style="margin-top:10px">
    <label class="j-field" style="margin:0"><span>How many sessions?</span><select class="j-select" data-owed-n="${esc(o.rowId)}" data-pane-of="${esc(pane)}">${opts.map((n) => `<option value="${n}">${n} session${n > 1 ? 's' : ''}, ${esc(money(n * o.perCents))}</option>`).join('')}</select></label>
    <p class="ja-small ja-muted" data-owed-dates="${esc(o.rowId)}" style="margin-top:8px">${esc(o.dates[0]?.label || '')}</p></div>`
}
const money = (c) => `A$${(c / 100).toFixed(2).replace(/\.00$/, '')}`
// A Pro with their own quote (14 Oct 2026): only the options staff set, and
// (round 2) the rest of the term at the price per session.
const optDates = (x) => x.dates.map((d) => d.label).join(', ')
function optTitle(x) {
  if (x.key === 'rest') return `Pay for the rest of the term (${x.n} sessions)`
  if (x.commit) return x.rest ? `Commit to the rest of the term (${x.n} sessions in a row)` : `Commit to ${x.n} sessions in a row`
  return 'Pay for the next session'
}
function optSub(x) {
  if (x.commit) return `${money(x.perCents)} each, ${money(x.totalCents)} now${x.saveCents ? `. You save ${money(x.saveCents)}` : ''}.`
  if (x.key === 'rest') return `${money(x.perCents)} a session, ${money(x.totalCents)} now.`
  return `${money(x.perCents)} for the next session.`
}
function quotePicker(o, pane = 'home') {
  const c = o.quote.commitment
  return `<div class="ja-opts" data-quote="${esc(o.rowId)}" role="radiogroup" aria-label="How do you want to pay?">${o.quote.options.map((x, i) => `<label class="ja-opt"><input type="radio" name="q-${esc(pane)}-${esc(o.rowId)}" value="${esc(x.key)}" data-total="${esc(money(x.totalCents))}" ${i === 0 ? 'checked' : ''}>
      <span><b>${esc(optTitle(x))}</b>
      <small>${esc(optSub(x))}</small>
      <small class="ja-opt-dates">${esc(optDates(x))}</small>${x.commit ? '<small class="ja-opt-dates">Missed sessions are not refunded.</small>' : ''}</span></label>`).join('')}</div>
    ${c?.left ? `<p class="ja-small ja-muted" style="margin-top:8px">Already paid: ${esc(c.left)} committed session${c.left > 1 ? 's' : ''} to come.</p>` : ''}`
}
// Round 2 (Lee, 14 Oct 2026): a session by session player always sees what
// is still to come, never "nothing owing", with every way to pay ahead.
const BILLED_AFTER = 'Sessions you do not pay ahead are billed after they happen.'
function upcomingLine(o) {
  return `<b>Upcoming sessions: ${esc(o.left)} left this term at ${esc(o.perLabel)}</b><small>${esc(o.left)} session${o.left === 1 ? '' : 's'} come${o.left === 1 ? 's' : ''} to ${esc(o.leftLabel || money(o.left * o.perCents))}. ${BILLED_AFTER}</small>`
}
function sessionsPay(o, pane = 'home') {
  if (o.quote?.options?.length) return `${quotePicker(o, pane)}`
  return `${prepayPicker(o, pane)}${o.rest ? `<p style="margin-top:10px"><button type="button" class="ja-btn ja-btn-line ja-btn-sm ja-btn-wrap" data-owed="${esc(o.rowId)}" data-owed-option="rest" ${o.needsWaiver ? 'disabled title="Sign the waiver first"' : ''}>Pay for the rest of the term, ${esc(o.rest.n)} sessions, ${esc(o.rest.totalLabel)}</button></p>` : ''}`
}
function owedCard(o) {
  const pay = `<button type="button" class="ja-btn ja-btn-red ja-btn-sm" data-owed="${esc(o.rowId)}" ${o.needsWaiver ? 'disabled title="Sign the waiver first"' : ''}>Pay</button>`
  const what = o.kind === 'term'
    ? `<b>Pay ${esc(o.amountLabel)}</b><small>${esc(D.term)}, ${esc(o.group)}. Locks the place in. Card, Apple Pay or Afterpay.</small>`
    : o.kind === 'sessions'
      ? `<b>Pay ${esc(o.amountLabel)}</b><small>For the sessions Joner Football has billed. Card or Apple Pay.</small>`
      : `${upcomingLine(o)}${sessionsPay(o, 'home')}`
  return `<div class="ja-card ja-todo" data-todo-owed="${esc(o.rowId)}">
    <div class="ja-card-head"><div><p class="ja-kicker"><i></i>${o.kind === 'term' ? 'Pay for your place' : o.kind === 'prepay' ? 'Upcoming sessions' : 'Pay for your sessions'}</p><h3 class="ja-h3" style="margin-top:8px;font-size:18px">${esc(o.player)}</h3>
    <p class="ja-muted ja-small" style="margin-top:3px">${esc(o.group)}</p></div></div>
    <ul class="ja-list">${waiverStep(o.needsWaiver, `<button type="button" class="ja-btn ja-btn-light ja-btn-sm" data-waiver-player="${esc(o.playerKey)}">Sign</button>`)}
      <li class="ja-row"><span class="ja-num">2</span><div>${what}</div>${pay}</li></ul>
  </div>`
}
function todoCards() {
  const want = q.get('pay')
  const pays = [...D.todo].sort((x, y) => Number(y.id === want) - Number(x.id === want)).map((t) => `
    <div class="ja-card ja-todo" data-todo="${esc(t.id)}">
      <div class="ja-card-head"><div><p class="ja-kicker"><i></i>${t.reason === 'trial' ? 'Book the trial' : t.reason === 'sessions' ? 'Sessions to pay' : 'Finish your booking'}</p><h3 class="ja-h3" style="margin-top:8px;font-size:18px">${esc(t.players.join(' and '))}</h3>
      <p class="ja-muted ja-small" style="margin-top:3px">${t.places?.length ? t.places.map((x) => `${esc(x.name)}: ${esc(x.label)}, ${esc(x.amountLabel)}`).join('<br>') : `${esc(t.group || 'JFP')}${t.what ? `, ${esc(t.what)}` : ''}`}${t.expiresAt ? `<br>Held for you until ${esc(new Date(t.expiresAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }))}` : ''}</p></div></div>
      <ul class="ja-list">
        ${waiverStep(t.needsWaiver, `<button type="button" class="ja-btn ja-btn-light ja-btn-sm" data-waiver-for="${esc(t.id)}">Sign</button>`)}
        ${t.needsKit ? `<li class="ja-row"><span class="ja-num ${t.kit ? 'done' : ''}">${t.kit ? ic('check') : '2'}</span><div><b>JF playing kit</b><small>${t.kit ? `Done: ${esc(t.kit.toLowerCase())}.` : `Required. ${esc(D.kitPriceLabel || 'A$60')} from BE Teamsport.`}</small>${t.kit ? '' : `<span style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">${D.kitUrl ? `<a class="ja-btn ja-btn-line ja-btn-sm" href="${esc(D.kitUrl)}" target="_blank" rel="noopener noreferrer">Order the kit</a>` : ''}<button type="button" class="ja-btn ja-btn-line ja-btn-sm" data-kit="ordered" data-kit-for="${esc(t.id)}">I have ordered it</button><button type="button" class="ja-btn ja-btn-line ja-btn-sm" data-kit="has" data-kit-for="${esc(t.id)}">Already has one</button></span>`}</div><span></span></li>` : ''}
        <li class="ja-row"><span class="ja-num">${t.needsKit ? '3' : '2'}</span><div><b>Pay ${esc(t.amountLabel)}</b><small>${t.reason === 'trial' ? 'Books the trial.' : t.reason === 'sessions' ? 'Pays for these sessions.' : 'Locks the place in.'} Card, Apple Pay${t.afterpay ? ' or Afterpay' : ''}.</small></div><button type="button" class="ja-btn ja-btn-red ja-btn-sm" data-pay="${esc(t.id)}" ${t.needsWaiver ? 'disabled title="Sign the waiver first"' : t.needsKit && !t.kit ? 'disabled title="Confirm the playing kit first"' : ''}>Pay</button></li>
      </ul>${t.canChoose ? `<p style="margin-top:10px"><button type="button" class="ja-link ja-small" data-choose-again="${esc(t.id)}">Choose a different option</button></p>` : ''}
    </div>`)
  const owed = (D.owed || []).map(owedCard)
  // Players whose waiver is not part of a payment card above: step 1, first.
  const inCards = new Set([...D.todo.flatMap((t) => t.players), ...(D.owed || []).map((o) => o.player)])
  const waivers = D.players.filter((p) => !p.waiver.onFile && !inCards.has(p.name)).map((p) => ({ title: p.adult ? (D.self || solo() ? 'Sign your waiver' : `Sign ${first(p.name)}'s waiver`) : `Sign ${first(p.name)}'s waiver`, sub: 'Every JFP player needs one on file. It takes two minutes.', btn: `<button type="button" class="ja-btn ja-btn-light ja-btn-sm" data-waiver-player="${esc(p.key)}">Sign</button>` }))
  const info = infoGaps().map(({ p, missing }) => {
    const need = missing.filter((m) => m !== 'check the details')
    const what = need.length ? `Add ${need.length > 1 ? `${need.slice(0, -1).join(', ')} and ${need.at(-1)}` : need[0]}.` : 'Check what your waiver told us and save.'
    const mine = p.self || D.self
    return { title: mine ? 'Your player details' : `${first(p.name)}'s player information`, sub: `${what} It helps us put ${mine ? 'you' : first(p.name)} in the right group.`, btn: '<button type="button" class="ja-btn ja-btn-light ja-btn-sm" data-go="info">Update</button>' }
  })
  return stepList('To do first', waivers.length === 1 ? 'Sign the waiver' : 'Sign the waivers', waivers) + pays.join('') + owed.join('') + jjTodoCards() + stepList('Then', info.length === 1 ? 'Update player details' : `${info.length} player details to update`, info)
}

function renderHome() {
  const el = document.querySelector('[data-pane="home"]')
  if (!D) return
  const tw = termWeek()
  // A player who is their own contact is greeted by their own name.
  const name = D.self ? first(D.players[0]?.name) : D.parentName ? first(D.parentName) : ''
  const head = `<header class="ja-head"><p class="ja-kicker"><i></i>${esc(D.term)}${tw && !D.players.length ? ` · ${esc(tw.label)}` : ''}</p><h1 class="ja-display">${name ? `Hi ${esc(name)}` : 'Welcome'}</h1>${tw && D.players.length ? `<div class="ja-progress"><div class="bar"><span style="width:${tw.pct}%"></span></div><small>${esc(tw.label)}</small></div>` : ''}</header>`
  const promos = `<section class="ja-sec">${secHead('More from JFP')}<div class="ja-rail-wrap"><div class="ja-rail promos">
      <button type="button" class="ja-promo" data-go="keep"><img src="${IMG}/photos/lee-coaching-field-900x1100.webp" alt="" loading="lazy"><span class="go">${ic('arrow')}</span><p class="ja-kicker"><i></i>${esc(D.keep?.name || 'Next term')}</p><h3>Keep your spot</h3><p>Same day, same time, same group. Current ${D.self ? 'players' : 'families'} get first call.</p></button>
      <button type="button" class="ja-promo" data-go="holidays"><img src="${IMG}/photos/hq-indoor-800x1000.webp" alt="" loading="lazy"><span class="go">${ic('arrow')}</span><p class="ja-kicker"><i></i>School holidays</p><h3>Holiday training</h3><p>JFP players book holiday training and camps first.</p></button>
      <button type="button" class="ja-promo red" data-go="app"><img src="/images/app/joner-app-main-iphone-current-transparent.webp" alt="" loading="lazy"><span class="go">${ic('arrow')}</span><p class="ja-kicker"><i></i>Free for JFP players</p><h3>The JF App</h3><p>Keep training between sessions.</p></button>
    </div></div></section>`
  const watch = `<section class="ja-sec">${secHead('Watch at HQ', 'Real sessions from inside Joner Football HQ.', 'r-home')}<div class="ja-rail-wrap"><div class="ja-rail" id="r-home">${hqVideos.slice(0, 6).map(vidCard).join('')}</div></div><p style="margin-top:14px"><button type="button" class="ja-btn ja-btn-line ja-btn-sm" data-go="videos">All training videos ${ic('arrow')}</button></p></section>`
  // A Juniors-only family: the Juniors card and its to do, no JFP "nothing booked".
  if (!D.players.length && D.juniors) {
    el.innerHTML = `<header class="ja-head"><p class="ja-kicker"><i></i>Joners Juniors · ${esc(D.juniors.term)}</p><h1 class="ja-display">${name ? `Hi ${esc(name)}` : 'Welcome'}</h1></header>
      <div class="ja-home"><div class="ja-stack">${jjHomeCard()}</div><div class="ja-stack">${todoCards()}${requestsBlock()}</div></div>${watch}`
    return
  }
  if (!D.players.length) {
    el.innerHTML = `${head}
      <div class="ja-ticket" style="min-height:420px"><img src="${IMG}/photos/ntra-field-900x1100.webp" alt=""><div class="ja-ticket-top"><span class="ja-live"><i></i>${esc(D.term)}</span></div>
        <div class="ja-ticket-body"><h2 class="ja-ticket-date"><span>No sessions</span><span class="t">booked yet</span></h2>
        <p class="ja-meta">Pick a spot on the timetable and apply. We reply within 48 hours.</p>
        <div class="ja-actions"><a class="ja-btn ja-btn-red" href="${links.booking}">See the timetable</a><button type="button" class="ja-btn ja-btn-glass" data-go="contact">Already train with us?</button></div>
        <p class="ja-small" style="margin-top:14px;color:rgba(255,255,255,.75)">Booked with another email? Sign out and use that one.</p></div></div>
      ${requestsBlock()}${promos}${watch}`
    return
  }
  const ups = upcoming().filter((x) => x.next)
  const players = `<div class="ja-card"><div class="ja-card-head"><h3 class="ja-h3">Players</h3><button type="button" class="ja-link ja-small" data-go="info">${(solo() || D.self) ? 'My profile' : 'Player information'}</button></div><ul class="ja-list">
    ${D.players.map((p) => `<li class="ja-row">${face(p.name, p.photo)}<div><b>${esc(p.name)}</b><small>${p.enrolments.length ? p.enrolments.map((e) => `${esc(e.day.slice(0, 3))} ${esc(e.time)}, ${esc(e.location)}`).join(' · ') : p.placeNoSession ? 'Place confirmed, day and time to come' : 'Not booked this term'}</small></div>
      <div class="ja-flags">${p.enrolments.map((e) => payDot(e.payment)).join('')}${p.waiver.onFile ? '<span class="ja-dot ok">Waiver</span>' : `<button type="button" class="ja-dot bad" data-waiver-player="${esc(p.key)}">Sign waiver</button>`}</div></li>`).join('')}
  </ul></div>`
  const notBooked = D.players.filter((p) => !p.enrolments.length)
  // Something to do (waiver, pay, details): first on the page, above the
  // next session, so a phone shows it straight after signing in.
  const todo = todoCards()
  el.innerHTML = `${head}
    <div class="ja-home">
      <div class="ja-stack">${todo}${ups.length ? ticket(ups[0]) : `<div class="ja-card"><h3 class="ja-h3">No more sessions this term</h3><p class="ja-muted" style="margin-top:6px">See you next term. <button type="button" class="ja-link" data-go="keep">Keep your spot</button>.</p></div>`}
        ${ups.slice(1).map((x) => `<div class="ja-card"><div class="ja-row" style="border:0;padding:0"><span class="ja-avatar">${esc(initials(x.p.name))}</span><div><b>${esc(x.p.name)}: ${esc(fmt(x.next.startMs, { weekday: 'short', day: 'numeric', month: 'short' }))}, ${esc(x.e.time)}</b><small>${esc(x.e.location)} · ${esc(countdown(x.next.startMs))}</small></div><button type="button" class="ja-btn ja-btn-line ja-btn-sm" data-cancel-open="${esc(x.e.rowId)}" data-cancel-player="${esc(x.p.key)}" data-cancel-date="${esc(x.next.iso)}">Can't make it</button></div></div>`).join('')}
      </div>
      <div class="ja-stack">${players}${jjHomeCard()}${notBooked.length ? `<div class="ja-card"><p class="ja-small ja-muted">${notBooked.map((p) => p.placeNoSession ? `<b style="color:#fff">${esc(p.name)}</b> has a place. We will confirm the day and time.` : `<b style="color:#fff">${esc(p.name)}</b> is not booked this term. <a class="ja-link" href="${links.booking}">See the timetable</a>`).join('<br>')}</p></div>` : ''}${requestsBlock()}</div>
    </div>
    ${promos}${watch}`
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
  el.innerHTML = `${pageHead('My sessions', D.term, 'Every date this term. The next one is in red. Can\'t make one? Tap it and tell your coach.')}
    ${D.players.filter((p) => p.enrolments.length).map((p) => p.enrolments.map((e) => {
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
      return `<section class="ja-card" style="margin-bottom:14px" data-enrol="${esc(e.rowId)}">
        <div class="ja-enrol-head"><img src="${esc(photoFor(e))}" alt="" loading="lazy"><div><h2>${esc(p.name)}</h2><p>${esc(e.day)}s ${esc(e.time)} · ${esc(e.location)} · ${esc(e.durationMin || 60)} min</p><p style="margin-top:6px">${payDot(e.payment)}</p></div></div>
        <div class="ja-actions">${canPay ? `<button type="button" class="ja-btn ja-btn-red ja-btn-sm" data-go-pay="${esc(e.rowId)}">${ic('card')}Pay for sessions</button>` : ''}${e.maps ? `<a class="ja-btn ja-btn-line ja-btn-sm" href="${esc(e.maps)}" target="_blank" rel="noopener noreferrer">${ic('pin')}Directions</a>` : ''}<button type="button" class="ja-btn ja-btn-line ja-btn-sm" data-ics="${esc(e.rowId)}">${ic('calplus')}Add to calendar</button></div>
        ${e.sessionPay ? `<p class="ja-small ja-muted" style="margin-top:10px">Paid: paid ahead. Not paid yet: billed after the session, or pay ahead now.</p>` : ''}
        <ol class="ja-dates">${e.dates.map((label, i) => {
          const [dow, dd, mon] = label.split(' ')
          const s = future.get(label)
          const c = told.get(label)
          const pm = mark(e.isoDates?.[i] || s?.iso, Boolean(s) && !c)
          const cls = !s ? 'is-past' : c ? 'is-off' : label === nextLabel ? 'is-next' : ''
          const right = !s ? '<span class="ja-muted ja-small">Done</span>'
            : c ? `<button type="button" class="ja-btn ja-btn-line ja-btn-sm" data-cancel-undo="${esc(c.id)}">Undo</button>`
            : `<button type="button" class="ja-btn ${label === nextLabel ? 'ja-btn-light' : 'ja-btn-line'} ja-btn-sm" data-cancel-open="${esc(e.rowId)}" data-cancel-player="${esc(p.key)}" data-cancel-date="${esc(s.iso)}">Can't make it</button>`
          return `<li class="ja-date ${cls}"><span class="d"><b>${esc(dd)}</b><i>${esc(mon)}</i></span><span class="w"><b>${esc(dow)} ${esc(e.time)}${label === nextLabel ? '<span class="ja-tag">Next</span>' : ''}${c ? '<span class="ja-tag amber">You told us</span>' : ''}${pm}</b>Week ${i + 1}${c ? `, ${esc(c.reason)}` : ''}</span>${right}</li>`
        }).join('')}</ol>
      </section>`
    }).join('')).join('')}${jjSessions()}`
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
  if (!PROF.players.length) { el.innerHTML = `${head}<div class="ja-card">Once a player is booked into JFP, their details appear here.</div>`; return }
  const o = PROF.options || OPT
  el.innerHTML = head + PROF.players.map((pl) => {
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
        <label class="j-field full"><span>${(pl.self || D.self) ? 'What do you want to work on?' : `What does ${esc(first(pl.name))} want to work on?`} <span class="muted">(optional)</span></span><textarea class="j-textarea" data-f="goals" rows="2" maxlength="1000">${esc(v.goals || '')}</textarea></label>
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
  el.innerHTML = `${pageHead("Can't make it?", 'Tell your coach', 'Two taps and your coach sees it straight away.')}
    <div class="ja-steps"><div class="ja-step"><b>Pick the session</b><p>Choose the date below.</p></div><div class="ja-step"><b>Tell us why</b><p>Sick, injured, school or something else. Add a note if you like.</p></div><div class="ja-step"><b>Changed your mind?</b><p>Press Undo and your coach knows they are coming.</p></div></div>
    <p class="j-box j-box-amber" style="margin-top:14px">Please tell us as early as you can. There are no make-up sessions. Less than a day to go? Call or text your coach as well.</p>
    ${rows.length ? rows.map(({ p, e }) => {
      const open = (e.sessions || []).slice(0, 4)
      return `<section class="ja-card" style="margin-top:14px"><div class="ja-enrol-head"><img src="${esc(photoFor(e))}" alt="" loading="lazy"><div><h2>${esc(p.name)}</h2><p>${esc(e.day)}s ${esc(e.time)} · ${esc(e.location)}</p></div></div>
        ${open.length ? `<ol class="ja-dates">${open.map((s) => {
          const [dow, dd, mon] = s.label.split(' ')
          const c = (e.cancelled || []).find((x) => x.date === s.iso)
          return `<li class="ja-date ${c ? 'is-off' : ''}"><span class="d"><b>${esc(dd)}</b><i>${esc(mon)}</i></span><span class="w"><b>${esc(dow)} ${esc(e.time)}${c ? '<span class="ja-tag amber">Coach told</span>' : ''}</b>${esc(countdown(s.startMs))}</span>${c ? `<button type="button" class="ja-btn ja-btn-line ja-btn-sm" data-cancel-undo="${esc(c.id)}">Undo</button>` : `<button type="button" class="ja-btn ja-btn-light ja-btn-sm" data-cancel-open="${esc(e.rowId)}" data-cancel-player="${esc(p.key)}" data-cancel-date="${esc(s.iso)}">Can't make it</button>`}</li>`
        }).join('')}</ol>${(e.sessions || []).length > 4 ? `<p style="margin-top:12px"><button type="button" class="ja-link ja-small" data-go="sessions">See every date</button></p>` : ''}` : '<p class="ja-muted" style="margin-top:12px">No more sessions this term.</p>'}
        ${(e.contacts || []).length ? `<p class="ja-small ja-muted" style="margin-top:14px">On the day: ${e.contacts.map((c) => `<a class="ja-link" href="tel:${esc(c.tel)}">${esc(c.name)} ${esc(c.phone)}</a>`).join(' · ')}</p>` : ''}
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
    ['Groups', 'Coaches group players by age first, then ability. Groups are small, and players can move up when they need a stronger challenge.'],
  ]
  el.innerHTML = `${hero({ img: `${IMG}/photos/ntra-field-1600x900.webp`, imgSmall: `${IMG}/photos/ntra-field-900x1100.webp`, kicker: 'About', title: esc(D.term), lede: `${weeks} weeks of small-group training at Belrose HQ, North Turramurra and Rydalmere${D.termStart ? `, from the week of ${esc(niceIso(D.termStart))}` : ''}.` })}
    <div class="ja-grid ja-grid-3">
      ${[['01', 'Technique first', 'Ball mastery, 1v1 detail, weak foot work and game-relevant habits.'], ['02', 'High energy', 'Sharp, intense, demanding sessions. Real standards.'], ['03', 'Real development', 'Long-term growth across technical, physical and mental.']].map(([n, t, d]) => `<div class="ja-fact" style="border:1px solid var(--ja-line);border-radius:22px"><span class="n">${n}</span><h3>${t}</h3><p>${d}</p></div>`).join('')}
    </div>
    <section class="ja-sec">${secHead('How the term works')}<div class="ja-facts">${facts.map(([t, d], i) => `<div class="ja-fact"><span class="n">${String(i + 1).padStart(2, '0')}</span><h3>${esc(t)}</h3><p>${esc(d)}</p></div>`).join('')}</div></section>
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

// What is owing now, from the overview: payment requests, places with
// something owing and no request yet, and Joners Juniors.
function feesOwe() {
  const out = []
  // A family invoice (siblings, round 2): each child's own place and amount.
  for (const t of D.todo || []) out.push({ title: t.players.join(' and '), sub: t.places?.length ? t.places.map((x) => `${x.name}: ${x.label}, ${x.amountLabel}`).join(' · ') : [t.group, t.what].filter(Boolean).join(', '), amount: t.amountLabel, btn: t.needsWaiver || (t.needsKit && !t.kit) ? '<button type="button" class="ja-btn ja-btn-light ja-btn-sm" data-go="home">Finish on Home</button>' : `<button type="button" class="ja-btn ja-btn-red ja-btn-sm" data-pay="${esc(t.id)}">Pay</button>` })
  for (const o of (D.owed || []).filter((x) => x.kind !== 'prepay')) out.push({ title: o.player, sub: o.kind === 'term' ? `${D.term}, ${o.group}` : 'Sessions billed by Joner Football', amount: o.amountLabel, btn: o.needsWaiver ? '<button type="button" class="ja-btn ja-btn-light ja-btn-sm" data-go="home">Sign the waiver</button>' : `<button type="button" class="ja-btn ja-btn-red ja-btn-sm" data-owed="${esc(o.rowId)}">Pay</button>` })
  for (const t of D.juniors?.todo || []) out.push({ title: t.players.join(' and '), sub: `Joners Juniors, ${t.what}`, amount: t.amountLabel, btn: t.needsWaiver ? '<button type="button" class="ja-btn ja-btn-light ja-btn-sm" data-go="home">Sign the waiver</button>' : `<button type="button" class="ja-btn ja-btn-red ja-btn-sm" data-jjpay="${esc(t.id)}">Pay</button>` })
  const asked = new Set((D.juniors?.todo || []).flatMap((t) => t.players))
  for (const c of D.juniors?.children || []) if (c.payment?.canPay && !asked.has(c.name)) out.push({ title: c.name, sub: `Joners Juniors, ${c.className || D.juniors.term}`, amount: c.payment.state === 'part' ? 'What is left' : c.payment.label.replace(/ to pay$/, ''), btn: `<button type="button" class="ja-btn ja-btn-red ja-btn-sm" data-jjask="${esc(c.rowId)}">Pay</button>` })
  return out
}
function feesOwing() { return D ? feesOwe().length : 0 }
function renderFees() {
  const el = document.querySelector('[data-pane="fees"]')
  if (!D) return
  const owe = feesOwe()
  const ahead = (D.owed || []).filter((x) => x.kind === 'prepay')
  const head = pageHead('Fees', 'Fees and payments', 'What you owe now, what you have paid, and every payment.')
  // "Nothing owing" only when nothing is billed and no session is left to pay
  // for (round 2, 14 Oct 2026). Session by session: what is still to come.
  const oweCard = owe.length || !ahead.length ? `<div class="ja-card"><p class="ja-kicker"><i></i>Owing now</p>${owe.length
    ? `<ul class="ja-list" style="margin-top:10px">${owe.map((x) => `<li class="ja-row ja-row-fee"><span class="ja-num">${ic('card')}</span><div><b>${esc(x.title)}: ${esc(x.amount)}</b><small>${esc(x.sub || '')}</small></div>${x.btn}</li>`).join('')}</ul>`
    : `<h3 class="ja-h3" style="margin-top:8px">Nothing owing</h3><p class="ja-small ja-muted" style="margin-top:4px">You are all paid up.</p>`}</div>` : ''
  const aheadCards = ahead.map((o) => `<div class="ja-card" data-fees-owed="${esc(o.rowId)}"><p class="ja-kicker"><i></i>Upcoming sessions</p><h3 class="ja-h3" style="margin-top:8px;font-size:18px">${esc(o.player)}</h3><p class="ja-muted ja-small" style="margin-top:3px">${esc(o.group)}</p>
    <div class="ja-upc" style="margin-top:10px">${upcomingLine(o)}</div>
    ${o.needsWaiver ? `<p class="j-box j-box-amber ja-small" style="margin-top:10px">Sign the waiver first, then pay. <button type="button" class="ja-link" data-waiver-player="${esc(o.playerKey)}">Sign the waiver</button></p>` : ''}
    ${sessionsPay(o, 'fees')}
    <div class="ja-actions"><button type="button" class="ja-btn ja-btn-red ja-btn-sm" data-owed="${esc(o.rowId)}" ${o.needsWaiver ? 'disabled title="Sign the waiver first"' : ''}>Pay</button></div></div>`).join('')
  el.innerHTML = `${head}<div class="ja-stack">${oweCard}${aheadCards}<div id="fees-body"><div class="ja-card"><p class="ja-small ja-muted">Loading your payments.</p></div></div></div>`
  if (FEES) return fillFees()
  api('/api/jfp-account', { action: 'fees' }).then((r) => {
    FEES = r.ok ? r.data.fees : { error: r.data.error || 'Could not load your payments.' }
    if (current === 'fees') fillFees()
  })
}
function fillFees() {
  const box = document.getElementById('fees-body')
  if (!box) return
  if (FEES.error) { box.innerHTML = `<div class="ja-card"><p class="ja-small">${esc(FEES.error)}</p></div>`; return }
  const f = FEES
  const kind = { term: 'Term fee', sessions: 'Session by session', pro: 'Pro sessions', trial: 'Trial' }
  const places = f.places.length ? `<div class="ja-card"><p class="ja-kicker"><i></i>${esc(f.term)}</p><ul class="ja-list" style="margin-top:10px">${f.places.map((x) => `<li class="ja-row ja-row-fee"><span class="ja-avatar">${esc(initials(x.player))}</span><div><b>${esc(x.player)}</b><small>${esc(kind[x.kind] || '')}, ${esc(x.group)}</small>
      <small>${x.kind === 'term' ? `Paid ${esc(x.paidLabel)} of ${esc(x.feeLabel)}` : x.kind === 'trial' ? `Paid ${esc(x.paidLabel)}` : `Paid ${esc(x.paidLabel)} for sessions${x.owingCents ? `, ${esc(money(x.owingCents))} to pay` : ''}`}${x.prepaidSessions ? `. ${esc(x.prepaidSessions)} session${x.prepaidSessions > 1 ? 's' : ''} paid ahead` : ''}</small>
      ${x.commitment ? `<small>Committed to ${esc(x.commitment.sessions)} sessions, ${esc(x.commitment.left)} to come${x.commitment.leftDates.length ? `: ${esc(x.commitment.leftDates.join(', '))}` : ''}</small>` : ''}</div><span></span></li>`).join('')}</ul></div>` : ''
  const totals = f.totals.length ? `<div class="ja-card"><p class="ja-kicker"><i></i>Paid so far</p><h3 class="ja-h3" style="margin-top:8px">${esc(f.paidLabel)}</h3><p class="ja-small ja-muted" style="margin-top:4px">${f.totals.map((t) => `${esc(t.label)} ${esc(t.amountLabel)}`).join(' · ')}</p></div>` : ''
  const recs = `<div class="ja-card"><p class="ja-kicker"><i></i>Payment records</p>${f.records.length
    ? `<ul class="ja-list" style="margin-top:10px">${f.records.map((r) => `<li class="ja-row ja-row-fee" data-fee-record><span class="ja-num">${ic(r.method === 'Cash' || r.method === 'Bank transfer' ? 'check' : 'card')}</span><div><b>${esc(r.amountLabel)} · ${esc(r.dateLabel || 'date not recorded')}</b><small>${esc(r.what)}${r.players.length ? `, ${esc(r.players.join(' and '))}` : ''}</small><small>${esc(r.programme)} · ${esc(r.method)}${r.refundedLabel ? ` · ${esc(r.refundedLabel)} refunded` : ''}</small></div>${r.receiptUrl ? `<a class="ja-btn ja-btn-line ja-btn-sm" href="${esc(r.receiptUrl)}" target="_blank" rel="noopener noreferrer">Receipt</a>` : '<span></span>'}</li>`).join('')}</ul>`
    : '<p class="ja-small ja-muted" style="margin-top:8px">No payments yet.</p>'}
    <p class="ja-small ja-muted" style="margin-top:12px">Card payments show Stripe's receipt where Stripe has one. Cash and bank transfers show once Joner Football records them. Something missing? <button type="button" class="ja-link" data-go="contact">Contact us</button></p></div>`
  box.innerHTML = `<div class="ja-stack">${totals}${places}${recs}</div>`
}

// ---------- holidays and camps ----------

function renderHolidays() {
  const el = document.querySelector('[data-pane="holidays"]')
  el.innerHTML = `${hero({ img: `${IMG}/photos/hq-indoor-960x720.webp`, imgSmall: `${IMG}/photos/hq-indoor-800x1000.webp`, kicker: 'School holidays', title: 'Holiday training<br>and camps', lede: 'Extra training at Joner Football HQ in the school holidays, and Joner Football Camps.' })}
    <div class="ja-band"><div><p class="ja-kicker"><i></i>JFP players</p><h2 style="margin-top:10px">You book first</h2><p style="margin-top:8px">Joner Football Performance players get exclusive first booking rights for holiday training and camps.</p></div></div>
    <div class="ja-grid ja-grid-2" style="margin-top:14px">
      <article class="ja-card" style="padding:24px"><p class="ja-kicker"><i></i>Holiday training</p><h2 class="ja-h2" style="margin-top:10px">Next up: summer</h2>
        <p class="ja-lede" style="font-size:15px">${esc(holidays.last)} training is done. The next block runs in the NSW summer school holidays.</p>
        <dl class="ja-dl"><div><dt>When</dt><dd>${esc(holidays.from)} to ${esc(holidays.to)} (NSW school holidays)</dd></div><div><dt>Where</dt><dd>${esc(hq.name)}, Belrose</dd></div><div><dt>Sessions</dt><dd>1 to 1, shared and small groups, 60 or 90 minutes</dd></div></dl>
        <p class="ja-small ja-muted" style="margin-top:14px">We email JFP families the dates and times first. Keep an eye on your inbox.</p>
      </article>
      <article class="ja-card ja-venue"><img src="${IMG}/photos/camp-rydalmere-1200x800.webp" alt="Joner Football Camp in Sydney" loading="lazy"><div class="bd"><p class="ja-kicker"><i></i>Joner Football Camps</p><h3 style="margin-top:6px">Camps</h3><p>Dates, locations and everything else about our camps are on the website.</p><div class="ja-actions"><a class="ja-btn ja-btn-red" href="/camps" target="_blank" rel="noopener">See our camps ${ic('ext')}</a></div></div></article>
    </div>`
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
      <div class="ja-card" style="padding:24px"><p class="ja-kicker"><i></i>Booked into JFP</p><h2 class="ja-h2" style="margin-top:10px">Get your free access</h2><p class="ja-muted" style="margin-top:8px">Send us a message and we will set up free access for your player.</p><div class="ja-actions"><button type="button" class="ja-btn ja-btn-red" data-go="contact" data-topic="The JF App">Ask for access</button></div></div>
      <div class="ja-card" style="padding:24px"><p class="ja-kicker"><i></i>Not in JFP</p><h2 class="ja-h2" style="margin-top:10px">Join the app</h2><p class="ja-muted" style="margin-top:8px">Anyone can join the Joner Football App on its own.</p><div class="ja-actions"><a class="ja-btn ja-btn-line" href="/join" target="_blank" rel="noopener">Join page ${ic('ext')}</a></div></div>
      <div class="ja-card" style="padding:24px"><p class="ja-kicker"><i></i>What is inside</p><h2 class="ja-h2" style="margin-top:10px">About the app</h2><p class="ja-muted" style="margin-top:8px">See what the app has for players, parents and coaches.</p><div class="ja-actions"><a class="ja-btn ja-btn-line" href="${links.appPage}" target="_blank" rel="noopener">About the app ${ic('ext')}</a></div></div>
    </div>`
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
function reach(list) {
  return list.map((c) => `<span style="display:inline-flex;flex-wrap:wrap;gap:6px;align-items:center;margin:6px 8px 0 0"><b>${esc(c.name)}</b> <a class="ja-btn ja-btn-line ja-btn-sm" href="tel:${esc(c.tel)}">Call ${esc(c.phone)}</a><a class="ja-btn ja-btn-line ja-btn-sm" href="sms:${esc(c.tel)}">Text</a></span>`).join('')
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
    <p class="j-err" id="cx-err" hidden></p>`
  sheet.foot.innerHTML = '<button type="button" class="ja-btn ja-btn-red ja-btn-block" id="cx-go">Tell the team</button>'
  const late = () => {
    const s = open.find((x) => x.iso === sheet.body.querySelector('#cx-date').value)
    const soon = s && s.startMs - Date.now() < DAY
    sheet.body.querySelector('#cx-late').innerHTML = soon ? `<div class="j-box j-box-amber"><b>That is under 24 hours away.</b> We will tell the team straight away.${(e.contacts || []).length ? ` Please also call or text your coach.<div>${reach(e.contacts)}</div>` : ''}</div>` : ''
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
      go.textContent = 'Tell the team'
      err.textContent = r.data.error || 'Could not send that. Try again.'
      err.hidden = false
      if (r.status === 401) { closeSheet(true); showSignIn() }
      return
    }
    const c = r.data.cancellation
    // Never a coach's name (Lee, 14 Oct 2026): "your coach".
    const who = r.data.told.length ? 'your coach and the Joner Football team' : 'the Joner Football team'
    const phones = r.data.told.filter((t) => t.tel)
    sheet.setTitle('Thank you')
    sheet.body.innerHTML = `<div class="j-box j-box-green"><b>${r.data.already ? 'We already had this one.' : 'Done.'}</b> We have told ${esc(who)} that ${esc(p.name)} cannot make ${esc(c.label)}.</div>
      ${c.noticeLevel !== 'ok' ? `<p style="margin-top:12px">That is short notice, so please call or text your coach as well${phones.length ? '.' : ' if you can.'}</p>` : ''}
      ${phones.length ? `<p class="ja-small ja-muted" style="margin-top:12px">Need to reach them quickly?</p><div>${reach(phones)}</div>` : ''}
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
  const t = e.target
  if (t.closest('[data-more]') || t.closest('#ja-me')) return moreSheet()
  if (t.closest('#sign-out') || t.closest('#ja-signout2')) { await signOut('parent'); location.href = '/jfp-account/'; return }
  if (t.closest('[data-contact]')) { e.preventDefault(); if (D) { closeSheet(true); show('contact') } else contactSheet(); return }
  const go = t.closest('[data-go]')
  if (go) {
    if (go.dataset.topic) topic = go.dataset.topic
    closeSheet(true)
    if (go.dataset.go === 'contact') delete document.querySelector('[data-pane="contact"]')?.dataset.drawn
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
  if (ics) return downloadIcs(ics.dataset.ics)
  const tp = t.closest('[data-topic-pick]')
  if (tp) { topic = tp.getAttribute('aria-pressed') === 'true' ? '' : tp.dataset.topicPick; document.querySelectorAll('[data-topic-pick]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.topicPick === topic))); return }
  if (t.closest('#ct-send')) return sendContact(t.closest('#ct-send'))
  const segBtn = t.closest('[data-seg] [data-val]')
  if (segBtn) { const g = segBtn.closest('[data-seg]'); const on = segBtn.getAttribute('aria-pressed') !== 'true'; g.querySelectorAll('[data-val]').forEach((b) => b.setAttribute('aria-pressed', String(on && b === segBtn))); return }
  const multi = t.closest('[data-multi] [data-val]')
  if (multi) { multi.setAttribute('aria-pressed', String(multi.getAttribute('aria-pressed') !== 'true')); return }
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
    // The choice on the same page as the button (Home and Fees both draw it).
    const scope = ow.closest('[data-pane]') || document
    const n = scope.querySelector(`[data-owed-n="${CSS.escape(ow.dataset.owed)}"]`)
    const opt = scope.querySelector(`[data-quote="${CSS.escape(ow.dataset.owed)}"] input:checked`)
    const r = await api('/api/jfp-account', { action: 'payOwed', rowId: ow.dataset.owed, ...(ow.dataset.owedOption ? { option: ow.dataset.owedOption } : opt ? { option: opt.value, sessions: 1 } : n ? { sessions: Number(n.value) } : {}) })
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
    if (el) { el.scrollIntoView({ block: 'start' }); el.style.boxShadow = '0 0 0 2px #fff' }
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
    return waiverSheet(keys.length ? keys : D.players.filter((p) => !p.waiver.onFile).map((p) => p.key))
  }
  const wp = t.closest('[data-waiver-player]')
  if (wp) {
    // From the More sheet: every waiver still to sign, one sheet (children first).
    if (wp.closest('.ja-tiles')) { closeSheet(true); return waiverSheet(unsignedWaivers().map((p) => p.key)) }
    return waiverSheet([wp.dataset.waiverPlayer])
  }
})
window.addEventListener('hashchange', () => { const h = location.hash.slice(1); if (D && PANELS.includes(h) && h !== current) show(h) })

// ---------- Joners Juniors: the same login, its own cards ----------
// Nothing here shows for a family with no Juniors child (D.juniors is null).

const jjDot = (pm) => `<span class="ja-dot ${{ paid: 'ok', due: 'bad', owing: 'bad', part: 'warn', arranged: 'warn' }[pm.state] || ''}">${esc(pm.label)}</span>`

function jjTodoCards() {
  const J = D.juniors
  if (!J?.todo?.length) return ''
  const want = q.get('pay')
  return [...J.todo].sort((x, y) => Number(y.id === want) - Number(x.id === want)).map((t) => `
    <div class="ja-card ja-todo" data-todo="${esc(t.id)}"${t.id === want ? ' style="box-shadow:0 0 0 2px #fff"' : ''}>
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

// A quote option chosen: the Pay button says the total.
document.addEventListener('change', (e) => {
  const r = e.target.closest?.('[data-quote] input[type="radio"]')
  if (!r) return
  const scope = r.closest('[data-pane]') || document
  const b = scope.querySelector(`[data-owed="${CSS.escape(r.closest('[data-quote]').dataset.quote)}"]:not([data-owed-option])`)
  if (b && !b.disabled) b.textContent = `Pay ${r.dataset.total}`
})

// Pay for your sessions: the dates for the number chosen.
document.addEventListener('change', (e) => {
  const sel = e.target.closest?.('[data-owed-n]')
  if (!sel) return
  const o = (D?.owed || []).find((x) => x.rowId === sel.dataset.owedN)
  const out = (sel.closest('[data-pane]') || document).querySelector(`[data-owed-dates="${CSS.escape(sel.dataset.owedN)}"]`)
  if (o && out) out.textContent = o.dates.slice(0, Number(sel.value)).map((d) => d.label).join(', ')
})

document.addEventListener('change', (e) => {
  const inp = e.target.closest?.('[data-photo-for]')
  if (inp) savePhotoFor(inp.dataset.photoFor, inp).finally(() => { inp.value = '' })
})
