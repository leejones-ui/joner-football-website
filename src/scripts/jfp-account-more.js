// My account, 17 Oct 2026 (Lee): attendance per child, coach notes for
// families, push notifications and player logins (12+). Kept apart from
// jfp-account.js, which calls these with its own data (D) and helpers.
import { esc, api, toast, openSheet, closeSheet } from './jfp-common.js'
import { ic } from './jfp-account-icons.js'
import { first, pageHead } from './jfp-account-ui.js'

// ---------- attendance ----------

// "Came to 8 of 9" and a dot per week run so far (green came, red away,
// grey not marked). Nothing until the coach has marked a session.
export function attendanceLine(e) {
  const a = e.attendance
  if (!a) return ''
  const past = a.marks.filter((m) => m !== 'ahead')
  if (!past.length) return ''
  const dots = past.map((m, i) => `<i class="${m || 'none'}" title="Week ${i + 1}: ${m === 'came' ? 'came' : m === 'missed' ? 'away' : 'not marked'}"></i>`).join('')
  const text = a.marked ? a.label : `${past.length} done this term`
  return `<div class="ja-att-line" aria-label="${esc(a.marked ? `${a.label} sessions this term` : text)}">${ic('check')}<span>${esc(text)}</span><span class="ja-att-dots" aria-hidden="true">${dots}</span></div>`
}
// The right-hand word on a session already run.
export function pastMark(e, i) {
  const m = e.attendance?.marks?.[i]
  if (m === 'came') return '<span class="ja-att-word came">Came</span>'
  if (m === 'missed') return '<span class="ja-att-word missed">Away</span>'
  return '<span class="ja-muted ja-small">Done</span>'
}

// ---------- coach notes ----------

export const unreadNotes = (D) => (D?.notes || []).filter((n) => !n.read).length
const noteBody = (t) => esc(t).replace(/\n/g, '<br>')
function noteCard(n, many) {
  return `<article class="ja-card ja-news${n.read ? '' : ' is-unread'}" aria-label="${n.read ? '' : 'New: '}${n.kind === 'homework' ? 'Homework' : 'Note'} from the coach about ${esc(first(n.player))}"><p class="ja-news-meta">${n.read ? '' : '<span class="ja-tag red">New</span>'}${n.kind === 'homework' ? '<span class="ja-tag">Homework</span>' : ''}${many ? `<span class="ja-tag grey">${esc(first(n.player))}</span>` : ''}<span>${esc(n.dateLabel)}</span>${n.due ? `<span>Due: ${esc(n.due)}</span>` : ''}</p><p class="ja-news-body is-full">${noteBody(n.text)}</p></article>`
}
export function notesHomeBlock(D) {
  const list = (D?.notes || []).filter((n) => !n.read)
  if (!list.length) return ''
  const many = new Set((D.notes || []).map((n) => n.player)).size > 1
  return `<p class="ja-label">From the coach</p>${noteCard(list[0], many)}${list.length > 1 ? `<button type="button" class="ja-btn ja-btn-ghost ja-btn-sm" data-go="notes">See all ${list.length} new notes</button>` : `<button type="button" class="ja-btn ja-btn-ghost ja-btn-sm" data-go="notes">All coach notes</button>`}`
}
export function renderNotes(el, D, after) {
  const list = D?.notes || []
  const many = new Set(list.map((n) => n.player)).size > 1
  el.innerHTML = `${pageHead('From the coach', 'Coach notes', '')}<div class="ja-stack ja-news-list">${list.map((n) => noteCard(n, many)).join('') || '<div class="ja-card"><p class="ja-muted">No notes yet.</p></div>'}</div>`
  const ids = list.filter((n) => !n.read).map((n) => n.id)
  if (!ids.length) return
  api('/api/jfp-account', { action: 'noteRead', ids }).then((r) => {
    if (!r.ok) return
    for (const n of D.notes || []) if (ids.includes(n.id)) n.read = true
    after()
  })
}

// ---------- push notifications ----------

const KINDS = [['reminder', 'Night before a session'], ['changes', 'Session off or a different coach'], ['payments', 'Payment to make'], ['news', 'Announcements'], ['notes', 'Coach notes']]
const standalone = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true
const canPush = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent)
const onWhat = () => (isIos() || /android/i.test(navigator.userAgent) ? 'phone' : 'device')
const keyBytes = (b64) => { const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64.length % 4)) % 4)); return Uint8Array.from(s, (c) => c.charCodeAt(0)) }
async function registration() { try { return (await navigator.serviceWorker.getRegistration('/jfp-account/')) || null } catch { return null } }
async function currentSub() { const reg = await registration(); try { return reg ? await reg.pushManager.getSubscription() : null } catch { return null } }

export function pushOffered(D) { return Boolean(D?.push?.available) }

export async function renderAlerts(el, D) {
  const head = pageHead(`On this ${onWhat()}`, 'Notifications', '')
  if (!pushOffered(D)) { el.innerHTML = `${head}<div class="ja-card"><p class="ja-muted">Notifications are not set up yet.</p></div>`; return }
  if (isIos() && !standalone()) {
    el.innerHTML = `${head}<div class="ja-card"><h3 class="ja-h3">Add My JFP to your home screen first</h3><p class="ja-muted" style="margin-top:6px">iPhone only sends notifications to apps on the home screen. Add it, open it from there, then come back here.</p><div class="ja-actions"><button type="button" class="ja-btn ja-btn-red" data-install>Show me how</button></div></div>`
    return
  }
  if (!canPush()) { el.innerHTML = `${head}<div class="ja-card"><p class="ja-muted">This browser cannot get notifications. Try Chrome, or Safari from the home screen.</p></div>`; return }
  el.innerHTML = `${head}<div class="ja-card ja-muted">Checking this phone</div>`
  const sub = await currentSub()
  const r = await api('/api/jfp-account', { action: 'pushState', endpoint: sub?.endpoint || '' })
  if (!r.ok) { el.innerHTML = `${head}<div class="ja-card">${esc(r.data.error || 'Could not load.')}</div>`; return }
  draw(el, D, r.data.push, sub)
}
function draw(el, D, st, sub) {
  const on = Boolean(sub && st.thisDevice)
  const blocked = Notification.permission === 'denied'
  const kinds = KINDS.filter(([k]) => !(D.playerLogin && k === 'payments'))
  el.innerHTML = `${pageHead(`On this ${onWhat()}`, 'Notifications', '')}
    <div class="ja-card ja-acct">
      <div class="ja-acct-row"><div><b>This ${onWhat()}</b><small>${on ? 'On' : blocked ? 'Blocked in your settings' : 'Off'}</small></div>
        ${blocked ? '' : `<button type="button" class="ja-btn ${on ? 'ja-btn-line' : 'ja-btn-red'} ja-btn-sm" data-push-toggle>${on ? 'Turn off' : 'Turn on'}</button>`}</div>
      ${blocked ? '<div class="ja-acct-row"><small class="ja-muted">Allow notifications for this site in your phone settings, then come back.</small></div>' : ''}
      ${on ? kinds.map(([k, l]) => `<div class="ja-acct-row"><div><b>${esc(l)}</b></div><div class="ja-seg2" role="group" aria-label="${esc(l)}"><button type="button" data-push-kind="${k}" data-v="1" aria-pressed="${st.prefs[k] !== false}">On</button><button type="button" data-push-kind="${k}" data-v="0" aria-pressed="${st.prefs[k] === false}">Off</button></div></div>`).join('') : ''}
    </div>`
  el.querySelector('[data-push-toggle]')?.addEventListener('click', async (ev) => {
    const b = ev.currentTarget
    b.disabled = true
    try {
      if (on) {
        try { await sub.unsubscribe() } catch {}
        const r = await api('/api/jfp-account', { action: 'pushUnsubscribe', endpoint: sub.endpoint })
        toast(`Notifications off on this ${onWhat()}.`)
        return draw(el, D, r.ok ? r.data.push : st, null)
      }
      if ((await Notification.requestPermission()) !== 'granted') { toast('Notifications were not allowed.'); return draw(el, D, st, null) }
      const reg = (await registration()) || (await navigator.serviceWorker.register('/jfp-account-sw.js', { scope: '/jfp-account/' }))
      await navigator.serviceWorker.ready
      const s = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(D.push.key) })
      const r = await api('/api/jfp-account', { action: 'pushSubscribe', sub: s.toJSON() })
      if (!r.ok) { try { await s.unsubscribe() } catch {}; toast(r.data.error || 'Could not turn them on.'); return draw(el, D, st, null) }
      toast('Notifications on.')
      draw(el, D, r.data.push, s)
    } catch (error) { console.error(error); toast('Could not turn them on on this phone.'); b.disabled = false }
  })
  el.querySelectorAll('[data-push-kind]').forEach((b) => b.addEventListener('click', async () => {
    const k = b.dataset.pushKind, v = b.dataset.v === '1'
    el.querySelectorAll(`[data-push-kind="${k}"]`).forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.v === (v ? '1' : '0'))))
    const r = await api('/api/jfp-account', { action: 'pushPrefs', endpoint: sub?.endpoint || '', prefs: { [k]: v } })
    if (!r.ok) toast(r.data.error || 'Could not save.')
  }))
}

// ---------- player logins (12+) ----------

// A row on the player's card in Family: their own sign in, or a way to set one up.
export function loginRow(p, D) {
  if (D.playerLogin || p.self || !p.enrolments?.length) return ''
  const min = D.playerMinAge || 12
  if (p.age == null || p.age === '' || Number(p.age) < min) return ''
  return `<div><span>Own login</span>${p.login ? `<button type="button" class="ja-link ja-small" data-login-set="${esc(p.key)}">${esc(p.login)}</button>` : `<button type="button" class="ja-link ja-small" data-login-set="${esc(p.key)}">Set up</button>`}</div>`
}
export function loginSheet(p, D, reload) {
  const sheet = openSheet({ title: `${first(p.name)}'s own login`, subtitle: '' })
  sheet.body.innerHTML = `<p class="ja-muted" style="margin-bottom:12px">${esc(first(p.name))} signs in with their own email and sees their sessions, attendance and coach notes. Never fees or the rest of the family.</p>
    <label class="j-field"><span>${esc(first(p.name))}'s email</span><input class="j-input" id="pl-email" type="email" autocomplete="off" value="${esc(p.login || '')}" placeholder="name@example.com"></label>
    <p class="j-err" id="pl-err" role="alert" hidden></p>`
  sheet.foot.innerHTML = `${p.login ? '<button type="button" class="ja-btn ja-btn-line" id="pl-off">Remove login</button>' : ''}<button type="button" class="ja-btn ja-btn-red" id="pl-go">Save</button>`
  const err = (m) => { const e = sheet.body.querySelector('#pl-err'); e.textContent = m; e.hidden = !m }
  sheet.foot.querySelector('#pl-go').addEventListener('click', async (ev) => {
    ev.currentTarget.disabled = true
    const r = await api('/api/jfp-account', { action: 'playerLoginSet', playerKey: p.key, email: sheet.body.querySelector('#pl-email').value })
    ev.currentTarget.disabled = false
    if (!r.ok) return err(r.data.error || 'Could not save.')
    closeSheet(); toast(`Saved. ${first(p.name)} signs in at jonerfootball.com/jfp-account with that email.`); reload()
  })
  sheet.foot.querySelector('#pl-off')?.addEventListener('click', async () => {
    const r = await api('/api/jfp-account', { action: 'playerLoginRemove', playerKey: p.key })
    if (!r.ok) return err(r.data.error || 'Could not remove.')
    closeSheet(); toast('Login removed.'); reload()
  })
}


// ---------- make-ups and credits (Lee, 19 Oct 2026) ----------
// After we cancel a session for an emergency: a free make-up to use this term,
// or a credit for next term. The family sees it here and can ask for the make-up.
const money = (c) => `A$${(c / 100).toFixed(2).replace(/\.00$/, '')}`
export function makeupsHomeBlock(D) {
  const list = (D?.makeups || []).filter((m) => !['used', 'applied'].includes(m.status))
  if (!list.length) return ''
  const many = new Set(list.map((m) => m.player)).size > 1
  const line = (m) => {
    const who = many ? `${esc(first(m.player))}: ` : ''
    if (m.kind === 'credit') return `${who}a credit${m.cents ? ` of ${esc(money(m.cents))}` : ''} for the session we cancelled on ${esc(m.dateLabel)}. It comes off next term, and Ligia will apply it.`
    if (m.status === 'booked') return `${who}your free make-up is booked: ${esc(m.bookedLabel)}.`
    if (m.status === 'requested') return `${who}you have asked for a make-up. Ligia will get back to you with a session.`
    if (m.status === 'expired') return `${who}the free make-up for ${esc(m.dateLabel)} was not used this term. Contact Ligia and she will sort it.`
    return `${who}a free make-up for the session we cancelled on ${esc(m.dateLabel)}. Use it by ${esc(m.expiresLabel)}.`
  }
  return `<p class="ja-label">Make-ups and credits</p>${list.map((m) => `<article class="ja-card" style="display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap"><p style="flex:1 1 220px;min-width:0">${line(m)}</p>${m.canAsk ? `<button type="button" class="ja-btn ja-btn-light ja-btn-sm" data-makeup-ask="${esc(m.id)}">Ask for my make-up</button>` : ''}</article>`).join('')}`
}
export function askMakeup(id, done) {
  const sheet = openSheet({ title: 'Ask for your make-up', subtitle: 'Ligia will find a session and let you know' })
  sheet.body.innerHTML = `<label class="j-field"><span>Days or times that suit <span class="ja-muted">(optional)</span></span><textarea class="j-textarea" id="mk-note" rows="3" maxlength="300" placeholder="For example, Thursday afternoons or any day after school"></textarea></label><p class="j-err" id="mk-err" hidden></p>`
  sheet.foot.innerHTML = '<button type="button" class="ja-btn ja-btn-light ja-btn-block" id="mk-go">Send request</button>'
  sheet.foot.querySelector('#mk-go').addEventListener('click', async (e) => {
    const b = e.currentTarget
    b.disabled = true
    const r = await api('/api/jfp-account', { action: 'makeupRequest', id, note: sheet.body.querySelector('#mk-note').value })
    b.disabled = false
    if (!r.ok) { const er = sheet.body.querySelector('#mk-err'); er.textContent = r.data.error || 'Could not send. Try again.'; er.hidden = false; return }
    closeSheet(); toast('Sent. Ligia will be in touch.'); done?.()
  })
}
