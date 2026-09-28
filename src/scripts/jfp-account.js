// The family account page: sign in with an emailed code, then see players,
// sessions, what is paid, waivers, and anything staff asked the family to do.
import { $, esc, api, toast, openSheet, closeSheet, signIn, whoAmI, signOut, waiverBlock } from './jfp-common.js'

const q = new URLSearchParams(location.search)
let D = null

async function boot() {
  const user = await whoAmI('parent')
  if (!user) return showSignIn()
  start()
}

async function showSignIn() {
  $('signin').hidden = false
  $('app').hidden = true
  await signIn({ mount: $('si-mount'), foot: $('si-foot'), audience: 'parent', intro: 'Use the email address you gave Joner Football. We send a 6 digit code, no password needed.' })
  $('signin').hidden = true
  start()
}

async function start() {
  $('app').hidden = false
  $('sign-out').hidden = false
  if (q.get('paid') && q.get('session_id')) confirmPaid(q.get('session_id'))
  await load()
  const payId = q.get('pay')
  if (payId) {
    const el = document.querySelector(`[data-todo="${CSS.escape(payId)}"]`)
    if (el) { el.scrollIntoView({ block: 'center' }); el.style.boxShadow = '0 0 0 2px #111827' }
    else if (D && !D.todo.length) toast('That payment is already done or no longer open.')
  }
}

async function confirmPaid(sid) {
  $('banner').innerHTML = '<div class="j-box j-box-grey">Confirming your payment with Stripe</div>'
  for (let i = 0; i < 12; i += 1) {
    const r = await api(`/api/jfp-confirm?session_id=${encodeURIComponent(sid)}`, null, { method: 'GET' })
    if (r.ok && r.data.status === 'paid') {
      $('banner').innerHTML = `<div class="j-box j-box-green"><b>Payment received.</b> Thank you. We have emailed you a receipt${r.data.payment?.group ? ' and the session dates' : ''}.</div>`
      history.replaceState(null, '', location.pathname)
      await load()
      return
    }
    if (r.ok && r.data.status === 'received') { $('banner').innerHTML = '<div class="j-box j-box-amber"><b>We have your payment.</b> This payment link had been closed before you paid, so Lee or Ligia will contact you to sort it out. Do not pay again.</div>'; history.replaceState(null, '', location.pathname); return }
    if (r.ok && r.data.status === 'expired') { $('banner').innerHTML = '<div class="j-box j-box-amber">That payment was not completed. Nothing was charged.</div>'; return }
    await new Promise((res) => setTimeout(res, 4000))
  }
  $('banner').innerHTML = '<div class="j-box j-box-amber">Your payment is still processing. Do not pay again; refresh this page in a few minutes.</div>'
}

async function load() {
  const r = await api('/api/jfp-account', { action: 'overview' })
  if (r.status === 401) return showSignIn()
  if (!r.ok) { $('players').innerHTML = `<div class="j-empty">${esc(r.data.error || 'Could not load your account.')}</div>`; return }
  D = r.data
  render()
}

function niceDate(iso) { const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`); return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-AU', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }) }

function payPill(pm) {
  const cls = { paid: 'green', due: 'amber', trial: 'blue', arranged: 'grey' }[pm.state] || 'grey'
  return `<span class="j-pill j-pill-${cls}">${esc(pm.label)}</span>`
}

function render() {
  $('term').textContent = D.term
  $('hello').textContent = D.parentName ? `Hi ${D.parentName.split(' ')[0]}` : 'Your players'
  $('who').innerHTML = `Signed in as <b>${esc(D.email)}</b>`

  $('todo-wrap').hidden = !D.todo.length
  $('todo').innerHTML = D.todo.map((t) => `
    <div class="j-card" style="padding:16px;margin-bottom:10px" data-todo="${esc(t.id)}">
      <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center">
        <div><h3>${esc(t.players.join(' and '))}</h3><p class="muted small">${esc(t.group || 'JFP')}${t.expiresAt ? ` · held for you until ${esc(new Date(t.expiresAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }))}` : ''}</p></div>
        <div style="display:flex;gap:8px;align-items:center">${t.needsWaiver
          ? `<button type="button" class="j-btn j-btn-dark" data-waiver-for="${esc(t.id)}">Sign the waiver</button>`
          : `<button type="button" class="j-btn j-btn-dark" data-pay="${esc(t.id)}">Pay ${esc(t.amountLabel)}</button>`}</div>
      </div>
      ${t.needsWaiver ? `<p class="small" style="margin-top:8px">Then pay ${esc(t.amountLabel)} to lock the place in.</p>` : ''}
    </div>`).join('')

  if (!D.players.length) {
    $('players').innerHTML = `<div class="j-empty">We do not have any players under <b>${esc(D.email)}</b> yet.<br><br><a class="j-btn j-btn-dark" href="/jfp-booking/">Book a group</a><p class="small" style="margin-top:12px">Used another email with us? Sign out and sign in with that one.</p></div>`
  } else {
    $('players').innerHTML = `<h2 style="margin-bottom:10px">Players</h2>` + D.players.map((p) => `
      <article class="j-card" style="padding:16px;margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center">
          <div><h3 style="font-size:18px">${esc(p.name)}</h3><p class="muted small">${p.age != null ? `Age ${esc(p.age)} on the first day of term` : 'Age not on file'}</p></div>
          <div>${p.waiver.onFile ? `<span class="j-pill j-pill-green">Waiver on file${p.waiver.signedDate ? `, ${esc(niceDate(p.waiver.signedDate))}` : ''}</span>` : `<button type="button" class="j-btn j-btn-line j-btn-sm" data-waiver-player="${esc(p.key)}">Sign the waiver</button>`}</div>
        </div>
        ${p.enrolments.length ? p.enrolments.map((e) => `
          <div style="border-top:1px solid #F0F1F3;margin-top:12px;padding-top:12px">
            <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap">
              <div><b>${esc(e.day)} ${esc(e.time)}</b> · ${esc(e.location)}${e.coach ? ` · ${esc(e.coach)}` : ''}<p class="muted small">${e.status !== 'Confirmed' ? `${esc(e.status)} · ` : ''}First session ${esc(e.firstDate)}${e.maps ? ` · <a href="${esc(e.maps)}" target="_blank" rel="noopener noreferrer">Map</a>` : ''}</p></div>
              <div>${payPill(e.payment)}</div>
            </div>
            <details style="margin-top:6px"><summary class="small muted" style="cursor:pointer">All ${esc(e.dates.length)} dates</summary><p class="small" style="margin-top:6px">${esc(e.dates.join(', '))}</p></details>
          </div>`).join('') : `<p class="muted small" style="margin-top:10px">Not booked into ${esc(D.term)} yet. <a href="/jfp-booking/">Book a group</a></p>`}
      </article>`).join('')
  }

  $('requests-wrap').hidden = !D.requests.length
  const kind = { application: 'Application', waitlist: 'Waitlist', enquiry: 'Enquiry' }
  const state = { pending: ['grey', 'Waiting for review'], offered: ['green', 'Place offered, see To do'], declined: ['grey', 'Not this term'], done: ['grey', 'Closed'], expired: ['grey', 'Offer expired, contact us'] }
  $('requests').innerHTML = D.requests.map((r) => `<div class="j-card" style="padding:14px;margin-bottom:8px;display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap">
    <div><b>${esc(kind[r.kind] || r.kind)}</b> · ${esc(r.players.join(', '))}<p class="muted small">${esc(r.group)}</p></div>
    <span class="j-pill j-pill-${(state[r.status] || state.pending)[0]}">${esc((state[r.status] || state.pending)[1])}</span></div>`).join('')
}

document.addEventListener('click', async (e) => {
  const pay = e.target.closest('[data-pay]')
  if (pay) {
    pay.disabled = true
    pay.textContent = 'Taking you to payment'
    const r = await api('/api/jfp-account', { action: 'pay', payreqId: pay.dataset.pay })
    if (r.ok && r.data.url) { location.href = r.data.url; return }
    pay.disabled = false
    pay.textContent = 'Try again'
    if (r.data.code === 'waiver') { load(); toast('Sign the waiver first.') } else toast(r.data.error || 'Could not start the payment.')
    return
  }
  const wt = e.target.closest('[data-waiver-for]')
  if (wt) {
    const t = D.todo.find((x) => x.id === wt.dataset.waiverFor)
    const keys = D.players.filter((p) => !p.waiver.onFile && t.players.includes(p.name)).map((p) => p.key)
    return waiverSheet(keys.length ? keys : D.players.filter((p) => !p.waiver.onFile).map((p) => p.key))
  }
  const wp = e.target.closest('[data-waiver-player]')
  if (wp) return waiverSheet([wp.dataset.waiverPlayer])
  if (e.target.closest('#sign-out')) { await signOut('parent'); location.href = '/jfp-account/' }
})

function waiverSheet(keys) {
  const players = D.players.filter((p) => keys.includes(p.key))
  if (!players.length) return
  const sheet = openSheet({ title: 'Sign the waiver', subtitle: players.map((p) => p.name).join(', ') })
  const w = waiverBlock(D.term)
  sheet.body.innerHTML = players.map((p) => `
    <div class="j-card" style="padding:12px 14px;margin-bottom:10px" data-wp="${esc(p.key)}">
      <h3 style="margin-bottom:8px">${esc(p.name)}</h3>
      ${p.needsDob ? '<label class="j-field"><span>Date of birth</span><input class="j-input" type="date" data-f="dob" min="2004-01-01" max="2023-12-31"></label>' : ''}
      <div class="j-two"><label class="j-field"><span>Emergency contact</span><input class="j-input" data-f="emergencyName"></label><label class="j-field"><span>Their phone</span><input class="j-input" type="tel" inputmode="tel" data-f="emergencyPhone"></label></div>
      <div class="j-two"><label class="j-field"><span>Current club <span class="muted">(optional)</span></span><input class="j-input" data-f="club"></label><label class="j-field"><span>Medical notes <span class="muted">(optional)</span></span><input class="j-input" data-f="medical"></label></div>
    </div>`).join('') + `
    <div class="j-two"><label class="j-field"><span>Your name</span><input class="j-input" id="wp-name" value="${esc(D.parentName || '')}" autocomplete="name"></label><label class="j-field"><span>Your mobile</span><input class="j-input" id="wp-mobile" type="tel" inputmode="tel" autocomplete="tel"></label></div>`
  sheet.body.appendChild(w.el)
  sheet.body.insertAdjacentHTML('beforeend', '<p class="j-err" id="wp-err" hidden></p>')
  sheet.foot.innerHTML = '<button type="button" class="j-btn j-btn-dark j-btn-block j-btn-lg" id="wp-sign">Sign the waiver</button>'
  sheet.foot.querySelector('#wp-sign').addEventListener('click', async () => {
    const err = sheet.body.querySelector('#wp-err')
    if (!w.complete()) { err.textContent = 'Tick the first four boxes and type your full name to sign.'; err.hidden = false; return }
    const list = players.map((p) => {
      const box = sheet.body.querySelector(`[data-wp="${CSS.escape(p.key)}"]`)
      const v = { key: p.key }
      box.querySelectorAll('[data-f]').forEach((i) => { v[i.dataset.f] = i.value.trim() })
      return v
    })
    const btn = sheet.foot.querySelector('#wp-sign')
    btn.disabled = true
    const r = await api('/api/jfp-account', { action: 'signWaiver', players: list, waiver: w.read(), parentName: sheet.body.querySelector('#wp-name').value.trim(), mobile: sheet.body.querySelector('#wp-mobile').value.trim() })
    btn.disabled = false
    if (!r.ok) { err.textContent = r.data.error || 'Could not save the waiver. Try again.'; err.hidden = false; return }
    closeSheet(true)
    toast('Waiver signed. Thank you.')
    await load()
  })
}

boot()
