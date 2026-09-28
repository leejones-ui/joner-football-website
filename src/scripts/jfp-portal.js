// The JFP staff portal. Lee and Ligia see the whole programme and the money;
// coaches see only their own sessions. Every change goes to Airtable through
// /api/jfp-portal-data, which checks the role again on the server.
import { $, esc, api, toast, signIn, whoAmI, signOut, money } from './jfp-common.js'

const P = { user: null, tab: '', board: null, loc: '', groups: null, coachId: '', coachDate: {}, reqFilter: 'pending' }
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
  if (P.user.role !== 'admin') return [['coach', 'My sessions']]
  return [['board', 'Board'], ['groups', 'Groups'], ['requests', 'Requests'], ['payments', 'Payments'], ['money', 'Money'], ['coach', 'Coach view'], ['removed', 'Removed players'], ['audit', 'Audit log'], ['settings', 'Settings']]
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
  const fn = { board: renderBoard, groups: renderGroups, requests: renderRequests, payments: renderPayments, money: renderMoney, coach: renderCoach, removed: renderRemoved, audit: renderAudit, settings: renderSettings }[tab]
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
const modeLabel = { direct: 'Book online', application: 'Apply only', enquire: 'Enquire', closed: 'Hidden' }
const modePill = (g) => ({ direct: 'green', application: 'violet', enquire: 'grey', closed: 'grey' }[g.mode])
const agesText = (g) => (g.minAge != null ? `${g.girlsOnly === 'yes' ? 'Girls ' : ''}${g.minAge} to ${g.maxAge}` : 'Ages not set')
const timeAgo = (ms) => new Date(ms).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })

// ---------- board ----------

async function renderBoard(refresh) {
  if (!P.board || refresh !== false) P.board = await need(await post('board'))
  const B = P.board
  P.coaches = B.coaches
  const groups = B.groups.filter((g) => !P.loc || g.locationId === P.loc)
  const t = B.totals
  view().innerHTML = `
    <div class="jp-head"><div><h1>${esc(B.term)}</h1><p class="muted small">Live from Airtable Term 4 Players · updated ${esc(timeAgo(B.at))} · <button type="button" class="j-btn j-btn-ghost j-btn-sm" id="b-refresh">Refresh</button></p></div>
      <div class="jp-seg" id="b-loc">${[['', 'All'], ...B.locations.map((l) => [l.id, l.name])].map(([v, l]) => `<button type="button" data-loc="${esc(v)}" aria-pressed="${P.loc === v}">${esc(l)}</button>`).join('')}</div></div>
    <div class="jp-kpis">
      <div class="jp-kpi"><span>Players holding a place</span><b>${t.players}</b></div>
      <div class="jp-kpi"><span>Confirmed (dashboard)</span><b>${t.dashboard}</b></div>
      <div class="jp-kpi"><span>Not confirmed yet</span><b>${t.awaiting}</b></div>
      <div class="jp-kpi"><span>Spots left to book</span><b>${t.placesLeft}</b></div>
      <div class="jp-kpi"><span>Waivers on file</span><b>${t.waivers}/${t.players}</b></div>
    </div>
    <p class="muted small" style="margin-bottom:6px">Drag a player onto another group to move them. Tap a player for more.</p>
    ${DAYS.map((d) => {
      const list = groups.filter((g) => g.day === d)
      if (!list.length) return ''
      return `<div class="jp-day"><h2>${d}</h2><span class="muted small">${list.reduce((a, g) => a + g.players.length, 0)} players</span></div><div class="jp-board">${list.map(groupCard).join('')}</div>`
    }).join('')}
    ${B.unassigned.length ? `<div class="jp-day"><h2>Not in a group</h2></div><div class="jp-group">${B.unassigned.map((p) => playerRowHtml(p, '')).join('')}<p class="muted small" style="margin-top:8px">These rows have no session, or a session that is not a group yet. Move them onto a group.</p></div>` : ''}`
  $('b-refresh').addEventListener('click', () => renderBoard(true))
  $('b-loc').addEventListener('click', (e) => { const b = e.target.closest('[data-loc]'); if (b) { P.loc = b.dataset.loc; renderBoard(false) } })
  wireBoard()
}

function groupCard(g) {
  const left = g.mode === 'direct' ? (g.placesLeft > 0 ? `<span class="j-pill j-pill-${g.placesLeft <= 1 ? 'amber' : 'green'}">${g.placesLeft} left</span>` : '<span class="j-pill j-pill-grey">Full</span>') : `<span class="j-pill j-pill-${modePill(g)}">${esc(modeLabel[g.mode])}</span>`
  return `<section class="jp-group" data-drop="${esc(g.id)}">
    <div class="jp-group-head"><div><b>${esc(g.time)}</b> · <span>${esc(agesText(g))}</span>${g.minAge != null && g.ageStatus !== 'confirmed' ? ' <span class="j-pill j-pill-amber" title="Draft age band, confirm in Groups">draft</span>' : ''}</div>${left}</div>
    <div class="jp-sub"><span class="j-dot j-dot-${esc(g.locationId)}"></span>${esc(g.locationName)} · Coach ${esc(g.coachName || 'not set')}${g.extraCoachNames.length ? ` + ${esc(g.extraCoachNames.join(', '))}` : ''} · ${esc(g.label)} · ${g.taken}/${g.capacity}${g.holds ? ` · ${g.holds} being booked` : ''}${g.girlsOnly === 'suggested' ? ' · <span class="j-pill j-pill-amber">girls only?</span>' : ''}</div>
    ${g.players.map((p) => playerRowHtml(p, g.id)).join('') || '<p class="muted small" style="padding:6px 0">No players yet</p>'}
    <button type="button" class="jp-add" data-add="${esc(g.id)}">+ Add player</button>
  </section>`
}

function playerRowHtml(p, gid) {
  const tags = [
    p.status !== 'Confirmed' ? `<span class="j-pill j-pill-amber">${esc(p.status)}</span>` : '',
    payPill(p),
    p.payreq ? '<span class="j-pill j-pill-violet" title="Payment link open">Link</span>' : '',
    p.online ? '<span class="j-pill j-pill-blue" title="Booked online">Online</span>' : '',
    p.waiver ? '' : '<span class="j-pill j-pill-grey" title="No waiver on file">No waiver</span>',
  ].join('')
  return `<div class="jp-player" draggable="true" data-row="${esc(p.rowId)}" data-from="${esc(gid)}" tabindex="0" role="button" aria-label="${esc(p.name)}, options">
    <span class="nm">${esc(p.name)}${p.age != null ? ` <span class="muted">(${esc(p.age)})</span>` : ''}${p.coach && gid && P.board?.groups.find((g) => g.id === gid)?.extraCoachNames.length ? ` <span class="muted small">· ${esc(p.coach)}</span>` : ''}</span>
    <span class="tags">${tags}</span></div>`
}

function findPlayer(rowId) {
  for (const g of P.board.groups) { const p = g.players.find((x) => x.rowId === rowId); if (p) return { p, g } }
  const p = P.board.unassigned.find((x) => x.rowId === rowId)
  return p ? { p, g: null } : null
}

function wireBoard() {
  const v = view()
  v.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => addPlayerModal(P.board.groups.find((g) => g.id === b.dataset.add))))
  v.querySelectorAll('[data-row]').forEach((el) => {
    const open = () => playerMenu(el)
    el.addEventListener('click', open)
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open() } })
    el.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', el.dataset.row); e.dataTransfer.effectAllowed = 'move' })
  })
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
      if (await confirmBox(`Move <b>${esc(found.p.name)}</b> to <b>${esc(to.day)} ${esc(to.time)}, ${esc(to.locationName)}</b>?`, { ok: 'Move' })) doMove(rowId, to.id)
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
    ...(p.paymentStatus !== 'Paid' ? [{ key: 'link', label: p.payreq ? 'Payment link sent (copy or new)' : 'Send a payment link', run: () => linkModal(p, g) }, { key: 'paid', label: 'Mark paid offline', run: () => paidModal(p) }] : []),
    { key: 'trial', label: p.trial ? 'End trial (full term)' : 'Mark as trial', run: async () => { const r = await post('setTrial', { rowId: p.rowId, trial: !p.trial }); if (!r.ok) return toast(r.data.error); toast('Updated'); renderBoard(true) } },
    '-',
    { key: 'remove', label: 'Remove from group', danger: true, run: () => removeModal(p, g) },
  ])
}

function detailsModal(p, g) {
  modal(`<h2 style="margin-bottom:12px">${esc(p.name)}</h2>
    <dl class="j-kv">
      <dt>Group</dt><dd>${g ? `${esc(g.day)} ${esc(g.time)}, ${esc(g.locationName)}` : esc(p.session || 'None')}</dd>
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
  return P.board.groups.filter((g) => g.id !== exclude).map((g) => `<option value="${esc(g.id)}" ${g.id === selected ? 'selected' : ''}>${esc(g.day)} ${esc(g.time)} · ${esc(g.locationName)} · ${esc(agesText(g))} · ${g.taken}/${g.capacity}</option>`).join('')
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

function linkModal(p, g) {
  const owing = Math.max(0, p.feeCents - p.paidCents) || p.feeCents || 85000
  const box = modal(`<h2 style="margin-bottom:6px">Payment link</h2><p class="muted small" style="margin-bottom:12px">${esc(p.name)}${g ? ` · ${esc(g.day)} ${esc(g.time)}` : ''}. The family signs in with their email, signs the waiver if needed, then pays by card.</p>
    ${p.payreq ? `<div class="j-box j-box-grey" style="margin-bottom:12px">A link for ${esc(p.payreq.amountLabel)} is already open. Making a new one leaves the old one open too; cancel it in Payments if needed.</div>` : ''}
    <label class="j-field"><span>Amount (A$)</span><input class="j-input" id="ln-amt" inputmode="decimal" value="${(owing / 100).toFixed(2).replace(/\.00$/, '')}"></label>
    <label class="j-field"><span>Parent email</span><input class="j-input" id="ln-email" type="email" value="${esc(p.email || '')}"></label>
    <label class="j-check" id="ln-change-row" hidden><input type="checkbox" id="ln-change"> <span>Update the parent email in Airtable to this address. The family signs in with it to pay, and will see this player.</span></label>
    ${p.linkNotes ? `<div class="j-box j-box-amber small" style="margin-bottom:10px"><b>Payment notes in Airtable:</b> ${esc(p.linkNotes)}</div>` : ''}
    <label class="j-check"><input type="checkbox" id="ln-send" checked> <span>Email the link to the family now</span></label>
    <div id="ln-out"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px"><button type="button" class="j-btn j-btn-line" data-close>Close</button><button type="button" class="j-btn j-btn-dark" id="ln-go">Create link</button></div>`)
  const emailInput = box.querySelector('#ln-email')
  emailInput.addEventListener('input', () => { box.querySelector('#ln-change-row').hidden = emailInput.value.trim().toLowerCase() === (p.email || '').toLowerCase() })
  box.querySelector('#ln-go').addEventListener('click', async () => {
    const amountCents = Math.round(Number(box.querySelector('#ln-amt').value) * 100)
    if (!(amountCents > 0)) return toast('Enter an amount.')
    const btn = box.querySelector('#ln-go'); btn.disabled = true
    const r = await post('sendPaymentLink', { rowId: p.rowId, amountCents, email: emailInput.value.trim(), changeEmail: box.querySelector('#ln-change').checked, sendEmail: box.querySelector('#ln-send').checked })
    if (r.data.code === 'email_change') { btn.disabled = false; box.querySelector('#ln-change-row').hidden = false; return toast(r.data.error) }
    btn.disabled = false
    if (!r.ok) return toast(r.data.error)
    box.querySelector('#ln-out').innerHTML = `<div class="j-box j-box-green" style="margin:10px 0">Link for ${esc(r.data.payreq.amountLabel)} created${r.data.emailed ? ' and emailed' : ''}. <button type="button" class="j-btn j-btn-line j-btn-sm" id="ln-copy">Copy link</button></div>`
    box.querySelector('#ln-copy').addEventListener('click', () => copy(r.data.payreq.url))
    btn.hidden = true
    P.board = null
  })
}

function removeModal(p, g) {
  const box = modal(`<h2 style="margin-bottom:6px">Remove ${esc(p.name)}?</h2>
    <p class="muted small" style="margin-bottom:12px">Sets them to Dropped in Airtable${g ? ` and frees their place in ${esc(g.day)} ${esc(g.time)}` : ''}. You can restore them from Removed players.${p.paymentStatus === 'Paid' ? ' They have paid: any refund is done in Stripe.' : ''}</p>
    <label class="j-field"><span>Reason <span class="muted">(optional, saved in the notes)</span></span><input class="j-input" id="rm-why"></label>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px"><button type="button" class="j-btn j-btn-line" data-close>Cancel</button><button type="button" class="j-btn j-btn-danger" id="rm-go">Remove</button></div>`)
  box.querySelector('#rm-go').addEventListener('click', async () => {
    const r = await post('removePlayer', { rowId: p.rowId, reason: box.querySelector('#rm-why').value.trim() })
    if (!r.ok) return toast(r.data.error)
    closeModal(); toast('Removed. Airtable updated.'); renderBoard(true)
  })
}

function addPlayerModal(g) {
  const box = modal(`<h2>Add a player</h2><p class="muted small" style="margin:2px 0 14px">${esc(g.day)} ${esc(g.time)} · ${esc(g.locationName)} · ${esc(agesText(g))} · ${g.placesLeft} place${g.placesLeft === 1 ? '' : 's'} left</p>
    <label class="j-field"><span>Find an existing player <span class="muted">(Term 4, Term 3 or waivers)</span></span><input class="j-input" id="ap-search" placeholder="Start typing a name" autocomplete="off"></label>
    <div id="ap-results"></div>
    <div class="j-two"><label class="j-field"><span>Player's full name</span><input class="j-input" id="ap-name" autocomplete="off"></label><label class="j-field"><span>Date of birth <span class="muted">(optional)</span></span><input class="j-input" type="date" id="ap-dob"></label></div>
    <div class="j-two"><label class="j-field"><span>Parent name</span><input class="j-input" id="ap-parent"></label><label class="j-field"><span>Mobile</span><input class="j-input" id="ap-mobile" type="tel"></label></div>
    <label class="j-field"><span>Parent email</span><input class="j-input" id="ap-email" type="email"></label>
    <label class="j-field"><span>Payment</span><select class="j-select" id="ap-pay">
      <option value="link">Send a payment link (A$${(850).toLocaleString()})</option><option value="offline">Already paid offline</option><option value="trial">Trial session</option><option value="none">Decide later</option></select></label>
    <label class="j-check"><input type="checkbox" id="ap-send" checked> <span>Email the family: sign in, add details, sign the waiver and pay (only the steps they still need)</span></label>
    <p class="j-err" id="ap-err" hidden></p>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px"><button type="button" class="j-btn j-btn-line" data-close>Cancel</button><button type="button" class="j-btn j-btn-dark" id="ap-go">Add to group</button></div>`, { wide: true })
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
  const submit = async (force = false) => {
    const err = box.querySelector('#ap-err')
    const body = {
      groupId: g.id, force,
      player: { name: box.querySelector('#ap-name').value.trim(), dob: box.querySelector('#ap-dob').value },
      parent: { name: box.querySelector('#ap-parent').value.trim(), email: box.querySelector('#ap-email').value.trim(), mobile: box.querySelector('#ap-mobile').value.trim() },
      payment: box.querySelector('#ap-pay').value, sendEmail: box.querySelector('#ap-send').checked,
    }
    if (body.player.name.length < 3) { err.textContent = 'Enter the player\'s full name.'; err.hidden = false; return }
    if (body.payment === 'offline') body.method = 'Offline'
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
    toast(`Added${r.data.emailed ? ' and emailed the family' : ''}. Airtable updated.`)
    if (r.data.payreq && !r.data.emailed) copy(r.data.payreq.url)
    renderBoard(true)
  }
  box.querySelector('#ap-go').addEventListener('click', () => submit(false))
}

// ---------- groups ----------

async function renderGroups() {
  const d = await need(await post('groups'))
  P.groups = d
  if (!P.board) P.board = await need(await post('board'))
  const taken = Object.fromEntries(P.board.groups.map((g) => [g.id, g.taken]))
  view().innerHTML = `
    <div class="jp-head"><div><h1>Groups</h1><p class="muted small">What parents see and can book. Changes are live on the parent page straight away.</p></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="j-btn j-btn-line" id="g-draft">Draft age bands from players</button><button type="button" class="j-btn j-btn-dark" id="g-new">+ New group</button></div></div>
    <div class="jp-scroll"><table class="jp-table"><thead><tr><th>Day</th><th>Time</th><th>Location</th><th>Coach</th><th>Type</th><th>Parents can</th><th>Ages</th><th>Places</th><th></th></tr></thead><tbody>
    ${d.groups.map((g) => `<tr><td>${esc(g.day)}</td><td>${esc(g.time)}</td><td>${esc(g.locationName)}</td><td>${esc(d.coaches.find((c) => c.id === g.coachId)?.name || '')}${(g.extraCoachIds || []).length ? ` +${g.extraCoachIds.length}` : ''}</td><td>${esc(g.label)}</td>
      <td><span class="j-pill j-pill-${modePill(g)}">${esc(modeLabel[g.mode])}</span></td>
      <td>${esc(agesText(g))}${g.minAge != null && g.ageStatus !== 'confirmed' ? ' <span class="j-pill j-pill-amber">draft</span>' : ''}${g.girlsOnly === 'suggested' ? ' <span class="j-pill j-pill-amber">girls?</span>' : ''}</td>
      <td>${taken[g.id] ?? 0}/${g.capacity}</td><td><button type="button" class="j-btn j-btn-line j-btn-sm" data-edit="${esc(g.id)}">Edit</button></td></tr>`).join('')}
    </tbody></table></div>`
  $('g-new').addEventListener('click', () => groupModal(null))
  $('g-draft').addEventListener('click', async () => { const r = await post('draftAges'); if (!r.ok) return toast(r.data.error); toast(`${r.data.changed} group${r.data.changed === 1 ? '' : 's'} given a draft age band`); P.board = null; renderGroups() })
  view().querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => groupModal(d.groups.find((g) => g.id === b.dataset.edit))))
}

function groupModal(g) {
  const d = P.groups
  const v = g || { day: 'Monday', time: '4:20pm', location: 'Belrose HQ', coachId: '', extraCoachIds: [], capacity: 6, mode: 'closed', label: 'Small group', durationMin: 60, minAge: '', maxAge: '', ageStatus: 'draft', girlsOnly: 'no', publicNote: '' }
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
    <label class="j-field"><span>Note parents see <span class="muted">(optional)</span></span><input class="j-input" id="gm-note" value="${esc(v.publicNote || '')}" maxlength="200"></label>
    ${g ? '<p class="muted small">Changing the day, time or location moves every player in this group in Airtable too.</p>' : ''}
    <p class="j-err" id="gm-err" hidden></p>
    <div style="display:flex;gap:8px;justify-content:space-between;margin-top:10px">${g ? '<button type="button" class="j-btn j-btn-danger" id="gm-del">Delete</button>' : '<span></span>'}<span style="display:flex;gap:8px"><button type="button" class="j-btn j-btn-line" data-close>Cancel</button><button type="button" class="j-btn j-btn-dark" id="gm-save">Save</button></span></div>`, { wide: true })
  box.querySelector('#gm-save').addEventListener('click', async () => {
    const val = (id) => box.querySelector(id).value
    const group = { day: val('#gm-day'), time: val('#gm-time').trim(), location: val('#gm-loc').trim(), coachId: val('#gm-coach'), mode: val('#gm-mode'), label: val('#gm-label'), minAge: val('#gm-min'), maxAge: val('#gm-max'), ageStatus: val('#gm-agest'), girlsOnly: val('#gm-girls'), capacity: val('#gm-cap'), durationMin: val('#gm-dur'), publicNote: val('#gm-note'), extraCoachIds: [...box.querySelector('#gm-extra').selectedOptions].map((o) => o.value).filter((c) => c !== val('#gm-coach')) }
    const r = await post('saveGroup', { id: g?.id, group })
    if (!r.ok) { const e = box.querySelector('#gm-err'); e.textContent = r.data.error; e.hidden = false; return }
    closeModal(); toast(r.data.movedPlayers ? `Saved. ${r.data.movedPlayers} players moved in Airtable.` : 'Saved'); P.board = null; renderGroups()
  })
  box.querySelector('#gm-del')?.addEventListener('click', async () => {
    if (!(await confirmBox(`Delete ${esc(g.day)} ${esc(g.time)}? Only possible when nobody is in it.`, { ok: 'Delete', danger: true }))) return
    const r = await post('deleteGroup', { id: g.id })
    if (!r.ok) return toast(r.data.error)
    toast('Deleted'); P.board = null; renderGroups()
  })
}

// ---------- requests ----------

async function renderRequests() {
  const d = await need(await post('requests'))
  P.pendingCount = d.requests.filter((r) => r.status === 'pending').length
  renderNav()
  if (!P.board) P.board = await need(await post('board'))
  const list = d.requests.filter((r) => P.reqFilter === 'all' || r.status === P.reqFilter)
  const kind = { application: ['violet', 'Application'], waitlist: ['amber', 'Waitlist'], enquiry: ['grey', 'Enquiry'] }
  view().innerHTML = `
    <div class="jp-head"><div><h1>Requests</h1><p class="muted small">Pathway and squad applications, waitlist and 1 to 1 enquiries.</p></div>
      <div class="jp-seg" id="rq-f">${[['pending', 'Waiting'], ['offered', 'Offered'], ['all', 'All']].map(([v, l]) => `<button type="button" data-f="${v}" aria-pressed="${P.reqFilter === v}">${l}</button>`).join('')}</div></div>
    ${list.length ? list.map((r) => `<article class="j-card" style="padding:16px;margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap"><div><span class="j-pill j-pill-${kind[r.kind]?.[0] || 'grey'}">${esc(kind[r.kind]?.[1] || r.kind)}</span> <b style="margin-left:6px">${esc(r.players.map((p) => `${p.name}${p.age != null ? ` (${p.age})` : ''}`).join(', '))}</b>
        <p class="muted small" style="margin-top:4px">${esc(r.group)} · ${esc(new Date(r.createdAt).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' }))}</p></div>
        <span class="j-pill j-pill-grey">${esc(r.status)}</span></div>
      <p class="small" style="margin-top:8px">${esc(r.parentName)} · <a href="mailto:${esc(r.email)}">${esc(r.email)}</a> · <a href="tel:${esc(r.mobile)}">${esc(r.mobile)}</a>${r.club ? ` · ${esc(r.club)}` : ''}</p>
      ${r.message ? `<p class="small j-box j-box-grey" style="margin-top:8px">${esc(r.message)}</p>` : ''}
      ${r.players.some((p) => p.isNew) ? `<p class="muted small" style="margin-top:6px">New to JFP${r.players.some((p) => p.waiver) ? ', waiver signed' : ''}.</p>` : ''}
      ${['pending', 'offered'].includes(r.status) ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">${r.status === 'pending' ? `<button type="button" class="j-btn j-btn-dark j-btn-sm" data-offer="${esc(r.id)}">Offer a place</button>` : ''}<button type="button" class="j-btn j-btn-line j-btn-sm" data-done="${esc(r.id)}">Mark done</button><button type="button" class="j-btn j-btn-line j-btn-sm" data-decline="${esc(r.id)}">Decline</button></div>` : ''}
    </article>`).join('') : '<div class="j-empty">Nothing here.</div>'}`
  $('rq-f').addEventListener('click', (e) => { const b = e.target.closest('[data-f]'); if (b) { P.reqFilter = b.dataset.f; renderRequests() } })
  view().querySelectorAll('[data-offer]').forEach((b) => b.addEventListener('click', () => offerModal(d.requests.find((r) => r.id === b.dataset.offer))))
  for (const [attr, decision, label] of [['data-done', 'done', 'Mark this request as done?'], ['data-decline', 'decline', 'Decline this request? No email is sent; contact the family yourself.']]) {
    view().querySelectorAll(`[${attr}]`).forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirmBox(label))) return
      const r = await post('decideRequest', { id: b.getAttribute(attr), decision })
      if (!r.ok) return toast(r.data.error)
      toast('Updated'); renderRequests()
    }))
  }
}

function offerModal(r) {
  const box = modal(`<h2 style="margin-bottom:6px">Offer a place</h2><p class="muted small" style="margin-bottom:12px">${esc(r.players.map((p) => p.name).join(', '))}. The place is held in Airtable as Awaiting Reply for 7 days while they pay.</p>
    <label class="j-field"><span>Group</span><select class="j-select" id="of-g">${groupOptions(r.groupId)}</select></label>
    <label class="j-field"><span>Amount to pay (A$)</span><input class="j-input" id="of-amt" inputmode="decimal" value="${850 * r.players.length}"></label>
    <label class="j-check"><input type="checkbox" id="of-send" checked> <span>Email the family the offer and payment link</span></label>
    <div id="of-out"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px"><button type="button" class="j-btn j-btn-line" data-close>Close</button><button type="button" class="j-btn j-btn-dark" id="of-go">Offer</button></div>`)
  const go = async () => {
    const body = { id: r.id, decision: 'offer', groupId: box.querySelector('#of-g').value, amountCents: Math.round(Number(box.querySelector('#of-amt').value) * 100), sendEmail: box.querySelector('#of-send').checked }
    let res = await post('decideRequest', body)
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
    box.querySelector('#of-out').innerHTML = `<div class="j-box j-box-green" style="margin:10px 0">Offered${res.data.emailed ? ' and emailed' : ''}. <button type="button" class="j-btn j-btn-line j-btn-sm" id="of-copy">Copy payment link</button></div>`
    box.querySelector('#of-copy').addEventListener('click', () => copy(res.data.payreq.url))
    box.querySelector('#of-go').hidden = true
    box.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => renderRequests()))
    P.board = null
  }
  box.querySelector('#of-go').addEventListener('click', go)
}

// ---------- payments ----------

async function renderPayments() {
  const d = await need(await post('payments'))
  const eff = (e) => (!e ? '' : e.ok ? '<span class="j-pill j-pill-green">All done</span>' : `<span class="j-pill j-pill-red">${esc([...e.failed, ...e.uncertain, ...e.pending].join(', '))}</span>`)
  const statusPill = (s) => `<span class="j-pill j-pill-${{ paid: 'green', open: 'amber', checkout: 'amber', held: 'amber', cancelled: 'grey', expired: 'grey' }[s] || 'grey'}">${esc(s === 'checkout' ? 'paying now' : s)}</span>`
  const attention = [...d.payreqs, ...d.bookings].filter((x) => x.needsAttention)
  const attnWord = { 'paid-after-cancel': 'Paid after it was cancelled', 'second-payment': 'Paid twice', 'late-payment': 'Paid after the hold ran out' }
  view().innerHTML = `
    <div class="jp-head"><div><h1>Payments</h1><p class="muted small">Online bookings and payment links. Refunds are made in Stripe.</p></div></div>
    ${attention.length ? `<div class="j-box j-box-red" style="margin-bottom:16px"><b>Needs checking</b>${attention.map((x) => `<div style="margin-top:8px">${esc(x.players.join(', '))} · ${esc(x.parentName)} · ${esc(String(x.needsAttention).split(', ').map((k) => attnWord[k] || k).join(', '))}${(x.unexpected || []).map((u) => ` · ${esc(u.amountLabel)}${u.stripeUrl ? ` <a href="${esc(u.stripeUrl)}" target="_blank" rel="noopener noreferrer">Stripe</a>` : ''}`).join('')}</div>`).join('')}<p class="small" style="margin-top:8px">A payment that arrived after a cancel is not added to Airtable. Give the family the place (add them on the board) or refund in Stripe.</p></div>` : ''}
    <h2 style="margin:6px 0 10px">Payment links</h2>
    ${d.payreqs.length ? `<div class="jp-scroll"><table class="jp-table"><thead><tr><th>Players</th><th>Group</th><th>Amount</th><th>Status</th><th>Airtable and emails</th><th></th></tr></thead><tbody>
      ${d.payreqs.map((q) => `<tr><td><b>${esc(q.players.join(', '))}</b><br><span class="muted small">${esc(q.parentName)} · ${esc(q.email)}</span></td><td>${esc(q.group)}<br><span class="muted small">${esc(q.kind)}</span></td><td>${esc(q.amountLabel)}${q.feeLabel ? `<br><span class="muted small">fee ${esc(q.feeLabel)}</span>` : ''}</td><td>${statusPill(q.status)}</td><td>${eff(q.effects)}</td>
        <td style="white-space:nowrap">${['open', 'checkout'].includes(q.status) ? `<button type="button" class="j-btn j-btn-line j-btn-sm" data-copy="${esc(q.url)}">Copy link</button> <button type="button" class="j-btn j-btn-ghost j-btn-sm" data-cancel-pay="${esc(q.id)}">Cancel</button>` : ''}${q.effects && !q.effects.ok ? `<button type="button" class="j-btn j-btn-line j-btn-sm" data-repair="${esc(q.id)}">Repair</button>` : ''}${q.stripeUrl ? ` <a class="j-btn j-btn-ghost j-btn-sm" href="${esc(q.stripeUrl)}" target="_blank" rel="noopener noreferrer">Stripe</a>` : ''}</td></tr>`).join('')}
    </tbody></table></div>` : '<div class="j-empty">No payment links yet.</div>'}
    <h2 style="margin:22px 0 10px">Online bookings</h2>
    ${d.bookings.length ? `<div class="jp-scroll"><table class="jp-table"><thead><tr><th>Players</th><th>Group</th><th>Paid</th><th>Status</th><th>Airtable and emails</th><th></th></tr></thead><tbody>
      ${d.bookings.map((b) => `<tr><td><b>${esc(b.players.join(', ') || 'Not chosen yet')}</b><br><span class="muted small">${esc(b.parentName)} · ${esc(b.email)}</span></td><td>${esc(b.group)}</td><td>${esc(b.amountLabel)}${b.feeLabel ? `<br><span class="muted small">fee ${esc(b.feeLabel)}</span>` : ''}</td><td>${statusPill(b.status)}${b.needsAttention ? ` <span class="j-pill j-pill-red">${esc(b.needsAttention)}</span>` : ''}</td><td>${eff(b.effects)}</td>
        <td style="white-space:nowrap">${b.effects && !b.effects.ok ? `<button type="button" class="j-btn j-btn-line j-btn-sm" data-repair="${esc(b.id)}">Repair</button>` : ''}${b.status === 'held' ? `<button type="button" class="j-btn j-btn-ghost j-btn-sm" data-cancel-booking="${esc(b.id)}">Release</button>` : ''}${b.stripeUrl ? ` <a class="j-btn j-btn-ghost j-btn-sm" href="${esc(b.stripeUrl)}" target="_blank" rel="noopener noreferrer">Stripe</a>` : ''}</td></tr>`).join('')}
    </tbody></table></div>` : '<div class="j-empty">No online bookings yet.</div>'}`
  view().querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', () => copy(b.dataset.copy)))
  view().querySelectorAll('[data-repair]').forEach((b) => b.addEventListener('click', async () => { b.disabled = true; const r = await post('repair', { id: b.dataset.repair }); toast(r.ok ? (r.data.summary.ok ? 'Repaired' : 'Still not complete. Check Airtable and try again.') : r.data.error); renderPayments() }))
  view().querySelectorAll('[data-cancel-pay]').forEach((b) => b.addEventListener('click', async () => { if (!(await confirmBox('Cancel this payment link? The family will not be able to pay with it.'))) return; const r = await post('cancelPayreq', { id: b.dataset.cancelPay }); toast(r.ok ? 'Cancelled' : r.data.error); renderPayments() }))
  view().querySelectorAll('[data-cancel-booking]').forEach((b) => b.addEventListener('click', async () => { if (!(await confirmBox('Release this held place?'))) return; const r = await post('cancelBooking', { id: b.dataset.cancelBooking }); toast(r.ok ? 'Released' : r.data.error); renderPayments() }))
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
    <div class="jp-head"><div><h1>${admin ? `Coach ${esc(d.coach)}` : 'My sessions'}</h1><p class="muted small">${esc(d.term)} · ${d.sessions.length} session${d.sessions.length === 1 ? '' : 's'} a week · ${hrs(d.hours.perWeekMinutes)} a week, ${hrs(d.hours.termMinutes)} across the term</p></div>
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

// ---------- removed, audit, settings ----------

async function renderRemoved() {
  const d = await need(await post('removed'))
  view().innerHTML = `<div class="jp-head"><div><h1>Removed players</h1><p class="muted small">Term 4 rows marked Dropped or Not Returning. Restore puts them back as Confirmed in the same session.</p></div></div>
    ${d.players.length ? `<div class="jp-scroll"><table class="jp-table"><thead><tr><th>Player</th><th>Session</th><th>Status</th><th>Payment</th><th></th></tr></thead><tbody>
      ${d.players.map((p) => `<tr><td><b>${esc(p.name)}</b><br><span class="muted small">${esc(p.parent)} · ${esc(p.email)}</span></td><td>${esc(p.session)}</td><td>${esc(p.status)}</td><td>${payPill(p)}</td><td><button type="button" class="j-btn j-btn-line j-btn-sm" data-restore="${esc(p.rowId)}">Restore</button></td></tr>`).join('')}
    </tbody></table></div>` : '<div class="j-empty">Nobody removed.</div>'}`
  view().querySelectorAll('[data-restore]').forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmBox('Restore this player as Confirmed?'))) return
    const r = await post('restorePlayer', { rowId: b.dataset.restore })
    toast(r.ok ? 'Restored. Airtable updated.' : r.data.error); P.board = null; renderRemoved()
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
  const c = (await need(await post('getSettings'))).config
  view().innerHTML = `<div class="jp-head"><div><h1>Settings</h1><p class="muted small">Term details, who can sign in, and alerts.</p></div></div>
    <div class="j-card" style="padding:18px;max-width:760px">
      <h2 style="margin-bottom:12px">Term</h2>
      <div class="j-two"><label class="j-field"><span>Term name</span><input class="j-input" id="s-term" value="${esc(c.term)}"></label><label class="j-field"><span>First day (a Monday)</span><input class="j-input" type="date" id="s-start" value="${esc(c.termStart)}"></label></div>
      <div class="j-two"><label class="j-field"><span>Weeks</span><input class="j-input" id="s-weeks" inputmode="numeric" value="${c.weeks}"></label><label class="j-field"><span>Price per player (A$)</span><input class="j-input" id="s-price" inputmode="decimal" value="${c.priceCents / 100}"></label></div>
      <h2 style="margin:16px 0 12px">Who can sign in</h2>
      <label class="j-field"><span>Super admins (full access and money), one email per line</span><textarea class="j-textarea" id="s-admins">${esc(c.superAdmins.join('\n'))}</textarea></label>
      <label class="j-field"><span>Booking alert emails (Lee always gets them), one per line</span><textarea class="j-textarea" id="s-staff">${esc(c.staffEmails.join('\n'))}</textarea></label>
      <label class="j-check"><input type="checkbox" id="s-coaches-on" ${c.coachLoginsEnabled ? 'checked' : ''}> <span><b>Coach logins on.</b> Coaches with an email below can sign in and see their own sessions. Nobody is emailed when you switch this on; tell them to go to jonerfootball.com/jfp-portal.</span></label>
      ${c.coaches.map((co) => `<div class="j-two"><label class="j-field"><span>Coach ${esc(co.name)} (Airtable: ${esc(co.airtableName)})</span><input class="j-input" type="email" data-coach="${esc(co.id)}" value="${esc(co.email)}" placeholder="No login"></label><span></span></div>`).join('')}
      <h2 style="margin:16px 0 12px">Waiver</h2>
      <label class="j-field"><span>Backup waiver form link</span><input class="j-input" id="s-waiver" value="${esc(c.waiverUrl)}"></label>
      <p class="muted small">Families sign the waiver on the booking page. This link is the backup.</p>
      <h2 style="margin:16px 0 12px">Locations</h2>
      ${c.locations.map((l) => `<div class="j-card" style="padding:12px;margin-bottom:8px" data-loc="${esc(l.id)}"><b>${esc(l.name)}</b><div class="j-two" style="margin-top:8px"><label class="j-field"><span>Line under the photo</span><input class="j-input" data-lf="blurb" value="${esc(l.blurb)}"></label><label class="j-field"><span>Photo path</span><input class="j-input" data-lf="photo" value="${esc(l.photo)}"></label></div><label class="j-field"><span>Address</span><input class="j-input" data-lf="address" value="${esc(l.address)}"></label></div>`).join('')}
      <p class="j-err" id="s-err" hidden></p>
      <button type="button" class="j-btn j-btn-dark j-btn-lg" id="s-save" style="margin-top:8px">Save settings</button>
    </div>`
  $('s-save').addEventListener('click', async () => {
    const lines = (id) => $(id).value.split(/\s*[\n,]\s*/).map((s) => s.trim()).filter(Boolean)
    const config = {
      term: $('s-term').value.trim(), termStart: $('s-start').value, weeks: Number($('s-weeks').value), priceCents: Math.round(Number($('s-price').value) * 100),
      superAdmins: lines('s-admins'), staffEmails: lines('s-staff'), coachLoginsEnabled: $('s-coaches-on').checked, waiverUrl: $('s-waiver').value.trim(),
      coaches: c.coaches.map((co) => ({ ...co, email: view().querySelector(`[data-coach="${CSS.escape(co.id)}"]`).value.trim() })),
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
