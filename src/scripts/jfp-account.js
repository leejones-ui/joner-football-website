// My account, the family page: sign in with an emailed code, then see players,
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
  const r = await api('/api/jfp-account', { action: 'overview', pay: q.get('pay') || '' })
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
  if (D.kitUrl && $('kit-link')) $('kit-link').href = D.kitUrl
  $('hello').textContent = D.parentName ? `Hi ${D.parentName.split(' ')[0]}` : 'Your players'
  $('who').innerHTML = `Signed in as <b>${esc(D.email)}</b>`

  $('todo-wrap').hidden = !D.todo.length
  // Each open link is a short checklist: the waiver, then pay. Opened from
  // the email link, that one comes first.
  const want = q.get('pay')
  const todo = [...D.todo].sort((x, y) => Number(y.id === want) - Number(x.id === want))
  $('todo').innerHTML = todo.map((t) => `
    <div class="j-card" style="padding:18px;margin-bottom:12px${t.id === want ? ';border-color:#111827' : ''}" data-todo="${esc(t.id)}">
      <h3 style="font-size:18px">${esc(t.players.join(' and '))}</h3>
      <p class="muted small">${esc(t.group || 'JFP')}${t.what ? ` · ${esc(t.what)}` : ''}${t.expiresAt ? ` · held for you until ${esc(new Date(t.expiresAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }))}` : ''}</p>
      <ol class="j-steps-list" style="margin-top:6px">
        <li><span class="n">${t.needsWaiver ? '1' : '✓'}</span><span style="flex:1;display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap"><span><b>Waiver</b><br><span class="muted small">${t.needsWaiver ? 'Sign the JFP waiver for this player.' : 'On file, nothing to do.'}</span></span>${t.needsWaiver ? `<button type="button" class="j-btn j-btn-dark j-btn-sm" data-waiver-for="${esc(t.id)}">Sign the waiver</button>` : ''}</span></li>
        ${t.needsKit ? `<li><span class="n">${t.kit ? '✓' : '2'}</span><span style="flex:1"><span style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap"><span><b>JF playing kit</b> <span class="j-pill j-pill-red">Required</span><br><span class="muted small">${t.kit ? `Done: ${esc(t.kit.toLowerCase())}.` : `Every player trains in it, ${esc(D.kitPriceLabel || 'A$50')} from BE Teamsport. The shop opens in a new tab.`}</span></span>${D.kitUrl && !t.kit ? `<a class="j-btn j-btn-line j-btn-sm" href="${esc(D.kitUrl)}" target="_blank" rel="noopener noreferrer">Order the kit</a>` : ''}</span>
          ${t.kit ? '' : `<span style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"><button type="button" class="j-btn j-btn-dark j-btn-sm" data-kit="ordered" data-kit-for="${esc(t.id)}">I have ordered it</button><button type="button" class="j-btn j-btn-line j-btn-sm" data-kit="has" data-kit-for="${esc(t.id)}">Already has one</button></span>`}</span></li>` : ''}
        <li><span class="n">${t.needsKit ? '3' : '2'}</span><span style="flex:1;display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap"><span><b>Pay ${esc(t.amountLabel)}</b><br><span class="muted small">${t.reason === 'trial' ? 'Books the trial.' : 'Locks the place in.'} Card, Apple Pay${t.afterpay ? ' or Afterpay' : ''}, on Stripe.</span></span><button type="button" class="j-btn j-btn-dark j-btn-sm" data-pay="${esc(t.id)}" ${t.needsWaiver ? 'disabled title="Sign the waiver first"' : t.needsKit && !t.kit ? 'disabled title="Confirm the playing kit first"' : ''}>Pay ${esc(t.amountLabel)}</button></span></li>
      </ol>
    </div>`).join('')

  if (!D.players.length) {
    $('players').innerHTML = `<div class="j-empty">We do not have any players under <b>${esc(D.email)}</b> yet.<br><br><a class="j-btn j-btn-dark" href="/jfp-booking/">See the timetable</a><p class="small" style="margin-top:12px">Used another email with us? Sign out and sign in with that one.</p></div>`
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
          </div>`).join('') : `<p class="muted small" style="margin-top:10px">Not booked into ${esc(D.term)} yet. <a href="/jfp-booking/">See the timetable</a></p>`}
      </article>`).join('')
  }

  // Next term: keep your place (hold or pay in full) or say not returning.
  $('next-wrap').hidden = !D.nextTerm
  if (D.nextTerm) {
    $('next-title').textContent = `${D.nextTerm.name}: keep your place`
    $('next').innerHTML = D.nextTerm.players.map((x) => `<div class="j-card" style="padding:16px;margin-bottom:10px">
      <h3>${esc(x.player)}</h3><p class="muted small">Now: ${esc(x.group)}</p>
      ${x.status === 'paid' ? '<p style="margin-top:8px"><span class="j-pill j-pill-green">Paid in full, locked in</span></p>'
        : x.status === 'no' ? '<p style="margin-top:8px"><span class="j-pill j-pill-grey">Not returning</span> <button type="button" class="j-btn j-btn-ghost j-btn-sm" data-next="hold" data-row="' + esc(x.rowId) + '">Changed your mind? Hold the place</button></p>'
        : x.status === 'held' ? `<p style="margin-top:8px"><span class="j-pill j-pill-violet">Place held</span> <span class="muted small">Pay the rest (${esc(x.afterHoldLabel)}) when you know your schedule.</span></p><button type="button" class="j-btn j-btn-dark j-btn-sm" data-next="full" data-row="${esc(x.rowId)}" style="margin-top:8px">Pay the rest</button>`
        : `<div class="j-outcomes" style="margin-top:10px">
            <button type="button" class="j-choice" data-next="full" data-row="${esc(x.rowId)}"><span><b>I can commit: pay ${esc(x.fullLabel)}</b><small>The place is locked in for the term. Card, Apple Pay or Afterpay.</small></span></button>
            <button type="button" class="j-choice" data-next="hold" data-row="${esc(x.rowId)}"><span><b>Hold my place: ${esc(x.holdLabel)}</b><small>Not sure of next term's schedule yet? Non-refundable, and it comes off the term fee.</small></span></button>
            <button type="button" class="j-choice" data-next="no" data-row="${esc(x.rowId)}"><span><b>Not returning</b><small>We will offer the spot to someone else.</small></span></button>
          </div>`}
    </div>`).join('')
  }

  $('requests-wrap').hidden = !D.requests.length
  const kind = { application: 'Application', waitlist: 'Waitlist', enquiry: 'Enquiry' }
  const state = { pending: ['grey', 'Waiting for review, we reply within 48 hours'], offered: ['green', 'Place offered, see To do'], declined: ['grey', 'Not this term'], done: ['grey', 'Closed'], expired: ['grey', 'Offer expired, contact us'] }
  $('requests').innerHTML = D.requests.map((r) => `<div class="j-card" style="padding:14px;margin-bottom:8px;display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap">
    <div><b>${esc(kind[r.kind] || r.kind)}</b> · ${esc(r.players.join(', '))}<p class="muted small">${esc(r.group)}</p></div>
    <span class="j-pill j-pill-${(state[r.status] || state.pending)[0]}">${esc(r.status === 'offered' && r.offer === 'trial' ? 'Trial offered, see To do' : (state[r.status] || state.pending)[1])}</span></div>`).join('')
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
    if (r.data.code === 'waiver') { load(); toast('Sign the waiver first.') } else if (r.data.code === 'kit') { load(); toast('Confirm the JF playing kit first.') } else toast(r.data.error || 'Could not start the payment.')
    return
  }
  const kb = e.target.closest('[data-kit]')
  if (kb) {
    kb.disabled = true
    const r = await api('/api/jfp-account', { action: 'confirmKit', payreqId: kb.dataset.kitFor, kit: kb.dataset.kit })
    if (!r.ok) { kb.disabled = false; return toast(r.data.error || 'Could not save that.') }
    toast('Thanks. Now you can pay.')
    return load()
  }
  const nx = e.target.closest('[data-next]')
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
