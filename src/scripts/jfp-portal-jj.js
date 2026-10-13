// The Joners Juniors section of the staff portal (Lee, 13 Oct 2026): its own
// sidebar group with Dashboard, Players, Invites, Requests & waitlist,
// Classes, Registers, Messages, Money and Settings. Lee and Ligia only; the
// server checks every action again (api/_jj-portal.js).
//
// Built in stages. This file has Dashboard, Players, Money (the Juniors
// money page in jfp-portal-juniors.js) and Settings; the other pages say what
// they will do and where to do it until then.
import { esc, money, toast } from './jfp-common.js'
import { renderJuniorsMoney, forgetJuniors } from './jfp-portal-juniors.js'

export const JJ_NAV = ['Joners Juniors', [['jj-dashboard', 'Dashboard'], ['jj-players', 'Players'], ['jj-invites', 'Invites'], ['jj-requests', 'Requests & waitlist'], ['jj-classes', 'Classes'], ['jj-registers', 'Registers'], ['jj-messages', 'Messages'], ['jj-money', 'Money'], ['jj-settings', 'Settings']]]
export const JJ_TABS = new Set(JJ_NAV[1].map(([k]) => k))
// The sidebar icon each Juniors page borrows from its JFP twin.
export const JJ_ICON = { 'jj-dashboard': 'overview', 'jj-players': 'families', 'jj-invites': 'invites', 'jj-requests': 'requests', 'jj-classes': 'groups', 'jj-registers': 'coach', 'jj-messages': 'messages', 'jj-money': 'money', 'jj-settings': 'settings' }

// Players: what is loaded, the search, the chip and the term shown.
const S = { data: null, at: 0, q: '', chip: '', term: '' }
export function jjPlayersFilter(chip) { S.chip = chip || ''; S.q = '' }

const PAY = { paid: ['Paid', 'green'], part: ['Part paid', 'orange'], unpaid: ['Unpaid', 'red'], noprice: ['No price', 'grey'] }
const payPill = (p) => `<span class="j-pill j-pill-${PAY[p.pay]?.[1] || 'grey'}">${esc(PAY[p.pay]?.[0] || p.pay)}</span>`
const waiverPill = (p) => (p.waiver.onFile ? '<span class="j-pill j-pill-green">Waiver</span>' : p.waiver.unknown ? '<span class="j-pill j-pill-grey">Waiver not checked</span>' : '<span class="j-pill j-pill-red">No waiver</span>')
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' })
const longDay = (iso) => (iso ? new Date(`${String(iso).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-AU', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' }) : '')
const centsFrom = (v) => { const x = String(v ?? '').replace(/[a$,\s]/gi, ''); return x === '' ? null : Math.round(Number(x) * 100) }
const dollarsIn = (c) => (c == null ? '' : String(c / 100))

export async function renderJJ(tab, ui) {
  if (tab === 'jj-dashboard') return renderDashboard(ui)
  if (tab === 'jj-players') return renderPlayers(ui)
  if (tab === 'jj-money') return renderJuniorsMoney({ view: ui.view, post: ui.post, filter: ui.filter, go: ui.go })
  if (tab === 'jj-settings') return renderSettings(ui)
  return renderSoon(tab, ui)
}

// ---------- dashboard ----------

async function renderDashboard(ui, fresh = false) {
  const d = await ui.need(await ui.post('jjDashboard', { fresh }))
  const s = d.summary, c = d.counts
  const pct = s.capacity ? Math.min(100, Math.round((s.enrolled / s.capacity) * 100)) : 0
  ui.view().innerHTML = `<div class="jj-view">
    <div class="jd-head"><div><h1>Joners Juniors</h1><p>${esc(d.term)}${d.datesLabel ? ` · ${esc(d.datesLabel)}` : ''} · ${esc(d.classLabel)}</p></div>
      <div class="jd-sync"><button type="button" class="j-btn j-btn-line j-btn-sm" id="jj-d-refresh">Refresh</button></div></div>
    ${d.moneyError ? `<div class="j-box j-box-amber" style="margin-bottom:12px">${esc(d.moneyError)} Money figures may be missing below.</div>` : ''}
    <div class="jd-grid">
      <section class="jd-card jd-tile jj-tile jd-in" style="--i:0" id="jj-t-enrolled"><span class="lbl">Enrolled</span><span class="val">${s.enrolled}<span class="muted" style="font-size:16px;font-weight:650"> / ${s.capacity}</span></span>
        <span class="jm-meter" role="img" aria-label="${pct}% of places taken"><span style="width:${pct}%"></span></span><span class="note">${s.placesLeft ? `${s.placesLeft} place${s.placesLeft === 1 ? '' : 's'} left` : 'Full'}${c.removed ? ` · ${c.removed} left this term` : ''}</span></section>
      <section class="jd-card jd-tile jj-tile jd-in" style="--i:1" id="jj-t-collected"><span class="lbl">Collected</span><span class="val">${s.collectedCents == null ? '<span class="muted">not known</span>' : esc(money(s.collectedCents))}</span><span class="note">${s.keptCents == null ? 'Stripe, cash and bank' : `${esc(money(s.keptCents))} kept after Stripe fees${s.feesPending ? ' (some fees not known yet)' : ''}`}</span></section>
      <section class="jd-card jd-tile jj-tile jd-in" style="--i:2" id="jj-t-owing"><span class="lbl">Still owing</span><span class="val">${esc(money(s.owingCents || 0))}${s.owingComplete ? '' : '<span class="muted" style="font-size:14px;font-weight:650"> known</span>'}</span><span class="note">${c.unpaid + c.part} ${c.unpaid + c.part === 1 ? 'child' : 'children'}</span><button type="button" class="link" data-jj-go="jj-players" data-jj-filter="unpaid">See who</button></section>
      <section class="jd-card jd-tile jj-tile jd-in" style="--i:3" id="jj-t-waivers"><span class="lbl">Waivers missing</span><span class="val">${d.waiversUnknown ? '<span class="muted">not checked</span>' : c.noWaiver}</span><span class="note">One family waiver covers JFP and Juniors</span><button type="button" class="link" data-jj-go="jj-players" data-jj-filter="waiver">See who</button></section>
      <section class="jd-card jd-span-7 jd-in" style="--i:4"><h2>Needs you</h2><ul class="jd-list" id="jj-needs">
        ${d.needs.map((n) => `<li><button type="button" data-jj-go="${esc(n.tab)}" data-jj-filter="${esc(n.filter || '')}">${esc(n.label)}</button><span class="muted small">${n.tab === 'jj-money' ? 'Money' : n.tab === 'jj-settings' ? 'Settings' : 'Players'}</span></li>`).join('') || '<li><span class="muted">Nothing waiting. Nice.</span></li>'}
      </ul></section>
      <section class="jd-card jd-span-5 jd-in" style="--i:5"><h2>Website sign-up</h2><p class="sub">What parents see on jonerfootball.com/jonersjuniors</p>
        <dl class="jj-dl" style="margin-top:10px"><dt>Registrations</dt><dd>${d.registrationOpen ? '<span class="j-pill j-pill-green">Open</span>' : '<span class="j-pill j-pill-red">Closed</span>'}</dd>
        <dt>Term</dt><dd>${esc(d.public.termDatesLine)}</dd><dt>Class</dt><dd>${esc(d.public.classLabel)}</dd><dt>Fee</dt><dd>${esc(d.public.feeLine)}</dd></dl>
        <div class="jj-actions"><a class="j-btn j-btn-line" href="/jonersjuniors/" target="_blank" rel="noopener">Open the page</a><button type="button" class="j-btn j-btn-line" data-jj-go="jj-settings">Change in Settings</button></div></section>
      <section class="jd-card jd-span-12 jd-in" style="--i:6" id="jj-attendance"><h2>Attendance</h2><p class="sub">${esc(d.attendance.note)} Coaches can already mark the class in My sessions.</p></section>
    </div></div>`
  ui.view().querySelector('#jj-d-refresh').addEventListener('click', () => { forgetJuniors(); renderDashboard(ui, true) })
  bindGo(ui)
}

function bindGo(ui) {
  ui.view().querySelectorAll('[data-jj-go]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.jjGo === 'jj-players') jjPlayersFilter(b.dataset.jjFilter)
    ui.go(b.dataset.jjGo)
  }))
}

// ---------- players ----------

function matches(p) {
  const q = S.q.trim().toLowerCase()
  if (q && ![p.name, p.parent, p.email, ...(p.emails || []), p.mobile].some((v) => String(v || '').toLowerCase().includes(q))) return false
  if (S.chip === 'removed') return Boolean(p.removed)
  if (p.removed) return false
  if (S.chip === 'waiver') return !p.waiver.onFile
  if (S.chip) return p.pay === S.chip
  return true
}

async function loadPlayers(ui, fresh = false) {
  S.data = await ui.need(await ui.post('jjPlayers', { fresh, term: S.term }))
  S.at = Date.now()
  S.term = S.data.term
}

async function renderPlayers(ui, keep = false) {
  if (!S.data || (!keep && Date.now() - S.at > 30000)) await loadPlayers(ui, true)
  const d = S.data, c = d.counts
  const shown = d.players.filter(matches)
  // A chip with nobody in it is left out, unless it is the one picked.
  const chips = [['', 'All', c.all], ['paid', 'Paid', c.paid], ['part', 'Part paid', c.part], ['unpaid', 'Unpaid', c.unpaid], ['noprice', 'No price', c.noprice], ['waiver', 'No waiver', c.noWaiver], ['removed', 'Left', c.removed]].filter(([v, , n]) => v === '' || n || S.chip === v)
  ui.view().innerHTML = `<div class="jj-view">
    <div class="jd-head"><div><h1>Players</h1><p>Joners Juniors · ${esc(d.term)} · ${esc(d.classLabel)} · ${d.summary.enrolled} of ${d.capacity} places</p></div>
      <div class="jd-sync">${d.terms.length > 1 ? `<label class="muted small" for="jj-term">Term</label><select class="j-select" id="jj-term" style="width:auto;min-height:40px">${d.terms.map((t) => `<option ${t === d.term ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>` : ''}<button type="button" class="j-btn j-btn-line j-btn-sm" id="jj-p-refresh">Refresh from Airtable</button>${d.current ? '<button type="button" class="j-btn j-btn-dark j-btn-sm" id="jj-p-add">+ Add a child</button>' : ''}</div></div>
    ${d.moneyError ? `<div class="j-box j-box-amber" style="margin-bottom:10px">${esc(d.moneyError)} Payment status is from Airtable only.</div>` : ''}
    ${d.current ? '' : `<div class="j-box j-box-grey" style="margin-bottom:10px">${esc(d.term)} is not the term running now. You can look and record a late payment; new children go into the current term.</div>`}
    <div class="jm-bar">
      <div class="jm-search"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2" stroke-linecap="round"/></svg><input class="j-input" id="jj-q" type="search" placeholder="Search child, parent, email or mobile" value="${esc(S.q)}" autocomplete="off"></div>
      <div class="jm-chips" id="jj-chips" role="group" aria-label="Show">${chips.map(([v, l, n]) => `<button type="button" data-jjchip="${v}" aria-pressed="${S.chip === v}">${esc(l)} <span class="n">${n}</span></button>`).join('')}</div>
    </div>
    <p class="muted small" id="jj-p-count" style="margin:0 0 8px">${shown.length} of ${S.chip === 'removed' ? c.removed : c.all} ${S.chip === 'removed' ? 'who left' : 'children'}${S.q || S.chip ? ' match' : ''} · read ${esc(new Date(S.at).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' }))}</p>
    <div class="jj-list" id="jj-rows">${shown.map((p) => `<button type="button" class="jj-pl${p.removed ? ' is-removed' : ''}" data-jjpl="${esc(p.rowId)}">
        <span class="jj-pl-main"><b>${esc(p.name)}${p.age != null ? ` <span class="muted" style="font-weight:500">(${esc(p.age)})</span>` : ''}</b><small>${esc(p.parent || 'No parent name')}${p.mobile ? ` · ${esc(p.mobile)}` : ''}</small>${p.removed ? `<small>Left ${esc(longDay(p.removed.at))}${p.removed.reason ? `: ${esc(p.removed.reason)}` : ''}</small>` : ''}</span>
        <span class="jj-pl-tags">${payPill(p)}${waiverPill(p)}${p.owingCents ? `<small>${esc(money(p.owingCents))} owing</small>` : ''}</span></button>`).join('') || `<div class="j-empty">${d.players.length ? 'Nobody matches.' : `No children in ${esc(d.term)} yet.`}</div>`}</div></div>`
  const redraw = () => renderPlayers(ui, true)
  ui.view().querySelector('#jj-q').addEventListener('input', (e) => { S.q = e.target.value; const at = e.target.selectionStart; redraw(); const i = ui.view().querySelector('#jj-q'); i.focus(); i.setSelectionRange(at, at) })
  ui.view().querySelectorAll('[data-jjchip]').forEach((b) => b.addEventListener('click', () => { S.chip = b.dataset.jjchip; redraw() }))
  ui.view().querySelector('#jj-p-refresh').addEventListener('click', async () => { forgetJuniors(); await loadPlayers(ui, true); redraw() })
  ui.view().querySelector('#jj-term')?.addEventListener('change', async (e) => { S.term = e.target.value; S.chip = ''; await loadPlayers(ui, false); redraw() })
  ui.view().querySelector('#jj-p-add')?.addEventListener('click', () => addModal(ui))
  ui.view().querySelectorAll('[data-jjpl]').forEach((b) => b.addEventListener('click', () => { const p = d.players.find((x) => x.rowId === b.dataset.jjpl); if (p) detailModal(ui, p) }))
}

// After any change: read again and show the same page.
async function afterChange(ui, message) {
  forgetJuniors()
  ui.closeModal()
  toast(message)
  await loadPlayers(ui, true)
  renderPlayers(ui, true)
}

function detailModal(ui, p) {
  const dl = (rows) => `<dl class="jj-dl">${rows.filter(([, v]) => v).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>`
  const tel = (m) => (m ? `<a href="tel:${esc(String(m).replace(/[^\d+]/g, ''))}">${esc(m)}</a>` : '')
  const mail = (e) => (e ? `<a href="mailto:${esc(e)}">${esc(e)}</a>` : '')
  const box = ui.modal(`<h2 style="margin-bottom:2px">${esc(p.name)}</h2>
    <p class="muted small" style="margin-bottom:12px">${p.age != null ? `Age ${esc(p.age)}` : 'Age not on file'}${p.dob ? ` · born ${esc(longDay(p.dob))}` : ''} · ${esc(p.term)} · ${esc(p.source)}</p>
    ${p.removed ? `<div class="j-box j-box-grey" style="margin-bottom:10px">Left on ${esc(longDay(p.removed.at))}${p.removed.reason ? `: ${esc(p.removed.reason)}` : ''}${p.removed.by ? ` (by ${esc(p.removed.by)})` : ''}. Not in the class, the counts or what is owing.</div>` : ''}
    <h3 class="jj-sec">Child</h3>${dl([['Class', esc(p.className)], ['Medical', esc(p.medical || 'Nothing given')], ['Date of birth', esc(p.dob ? longDay(p.dob) : 'not on file')]])}
    <h3 class="jj-sec">Family</h3>${dl([['Parent', esc(p.parent || 'not on file')], ['Email', (p.emails || []).map(mail).join('<br>') || 'not on file'], ['Mobile', [tel(p.mobile), tel(p.mobile2)].filter(Boolean).join('<br>') || 'not on file'], ['Also in JFP', p.jfpSiblings.length ? esc(p.jfpSiblings.join(', ')) : '']])}
    <h3 class="jj-sec">Money</h3>${dl([['Fee', p.feeCents == null ? 'not set' : esc(money(p.feeCents))], ['Paid', p.paidCents == null ? 'not known' : esc(money(p.paidCents))], ['Owing', p.owingCents == null ? 'not known' : esc(money(p.owingCents))], ['Status', `${payPill(p)} <span class="muted small">${esc(p.payLabel)}</span>`], ['Paid via', esc(p.paidVia)], ['Airtable says', esc(p.airtableStatus)]])}
    ${p.payments.length ? `<ul class="jj-pays">${p.payments.map((x) => `<li><span>${esc(x.kind === 'stripe' ? `Stripe ${x.ref}` : `${x.method} · ${x.id}`)}<br><span class="muted small">${esc(longDay(x.at))}</span></span><span><b>${esc(money(x.cents))}</b>${x.kind === 'recorded' ? ` <button type="button" class="j-btn j-btn-ghost j-btn-sm" data-void="${esc(x.id)}">Take off</button>` : ''}</span></li>`).join('')}</ul>` : '<p class="muted small">No payments found yet.</p>'}
    <h3 class="jj-sec">Waiver</h3><p class="small">${p.waiver.onFile ? `On file (${esc(p.waiver.how)}${p.waiver.signedDate ? `, signed ${esc(p.waiver.signedDate)}` : ''}${p.waiver.term ? `, ${esc(p.waiver.term)}` : ''})` : p.waiver.unknown ? 'Could not be checked just now.' : `Not signed${p.waiver.airtable ? ` (Airtable: ${esc(p.waiver.airtable)})` : ''}. One family waiver covers JFP and Juniors.`}</p>
    ${p.notes ? `<h3 class="jj-sec">Notes</h3><p class="small" style="white-space:pre-wrap;max-height:200px;overflow:auto;overflow-wrap:anywhere">${esc(p.notes)}</p>` : ''}
    <div class="jj-actions">
      ${p.removed ? '' : '<button type="button" class="j-btn j-btn-dark" data-act="pay">Record payment</button>'}
      <button type="button" class="j-btn j-btn-line" data-act="edit">Edit</button>
      <button type="button" class="j-btn j-btn-line" data-act="note">Add a note</button>
      ${p.removed ? '<button type="button" class="j-btn j-btn-line" data-act="restore">Put back in the class</button>' : '<button type="button" class="j-btn j-btn-danger" data-act="remove">Remove</button>'}
      <button type="button" class="j-btn j-btn-ghost" data-close>Close</button>
    </div>`, { wide: true })
  const act = (k, fn) => box.querySelector(`[data-act="${k}"]`)?.addEventListener('click', fn)
  act('pay', () => payModal(ui, p))
  act('edit', () => editModal(ui, p))
  act('note', () => noteModal(ui, p))
  act('remove', () => removeModal(ui, p))
  act('restore', () => restore(ui, p))
  box.querySelectorAll('[data-void]').forEach((b) => b.addEventListener('click', () => voidModal(ui, p, b.dataset.void)))
}

const saveBtn = (box, sel, fn) => box.querySelector(sel).addEventListener('click', async (e) => {
  const btn = e.currentTarget
  btn.disabled = true
  try { await fn() } finally { if (btn.isConnected) btn.disabled = false }
})

function addModal(ui) {
  const d = S.data
  const box = ui.modal(`<h2 style="margin-bottom:4px">Add a child</h2>
    <p class="muted small" style="margin-bottom:12px">Adds a row to the ${esc(d.term)} Joners Juniors table in Airtable, in ${esc(d.classLabel)}.</p>
    <label class="j-field"><span>Child's full name</span><input class="j-input" id="ja-name" autocomplete="off"></label>
    <div class="j-two"><label class="j-field"><span>Date of birth <span class="muted">(optional)</span></span><input class="j-input" type="date" id="ja-dob" max="${today()}"></label>
    <label class="j-field"><span>Medical or allergies <span class="muted">(optional)</span></span><input class="j-input" id="ja-med" maxlength="600"></label></div>
    <label class="j-field"><span>Parent name</span><input class="j-input" id="ja-parent" autocomplete="off"></label>
    <div class="j-two"><label class="j-field"><span>Parent email</span><input class="j-input" id="ja-email" inputmode="email" autocomplete="off"></label>
    <label class="j-field"><span>Mobile</span><input class="j-input" id="ja-mobile" inputmode="tel" autocomplete="off"></label></div>
    <label class="j-field"><span>Term fee A$</span><input class="j-input" id="ja-fee" inputmode="decimal" value="${esc(dollarsIn(d.priceCents))}"></label>
    <fieldset class="jj-radios"><legend>Payment</legend>
      <label class="j-check"><input type="radio" name="ja-pay" value="none" checked> Not paid yet</label>
      <label class="j-check"><input type="radio" name="ja-pay" value="offline"> Paid now by cash or bank transfer</label>
      <label class="j-check"><input type="radio" name="ja-pay" value="free"> No fee</label></fieldset>
    <div class="j-two" id="ja-paid" hidden><label class="j-field"><span>Amount paid A$</span><input class="j-input" id="ja-amount" inputmode="decimal" value="${esc(dollarsIn(d.priceCents))}"></label>
      <label class="j-field"><span>How</span><select class="j-select" id="ja-method">${d.methods.map((m) => `<option>${esc(m)}</option>`).join('')}</select></label></div>
    <label class="j-field"><span>Note <span class="muted">(optional)</span></span><input class="j-input" id="ja-note" maxlength="300"></label>
    <div class="jj-actions"><button type="button" class="j-btn j-btn-line" data-close>Cancel</button><button type="button" class="j-btn j-btn-dark" id="ja-go">Add child</button></div>`)
  const q = (s) => box.querySelector(s)
  box.querySelectorAll('[name="ja-pay"]').forEach((r) => r.addEventListener('change', () => { q('#ja-paid').hidden = q('[name="ja-pay"]:checked').value !== 'offline' }))
  const send = async (force = false) => {
    const payment = q('[name="ja-pay"]:checked').value
    const body = {
      player: { name: q('#ja-name').value.trim(), dob: q('#ja-dob').value, medical: q('#ja-med').value.trim() },
      parent: { name: q('#ja-parent').value.trim(), email: q('#ja-email').value.trim(), mobile: q('#ja-mobile').value.trim() },
      feeAud: q('#ja-fee').value.trim() === '' ? undefined : Number(q('#ja-fee').value.replace(/[a$,\s]/gi, '')),
      payment, note: q('#ja-note').value.trim(), force,
      ...(payment === 'offline' ? { amountCents: centsFrom(q('#ja-amount').value), method: q('#ja-method').value } : {}),
    }
    if (body.player.name.length < 3) return toast("Enter the child's full name.")
    const r = await ui.post('jjAddPlayer', body)
    if (r.status === 409 && ['duplicate', 'full'].includes(r.data.code)) {
      const again = await ui.confirmBox(esc(r.data.error), { ok: 'Add anyway' })
      if (again) return send(true)
      return
    }
    if (!r.ok) return toast(r.data.error || 'Could not add.')
    await afterChange(ui, r.data.recorded?.error ? `Added. The payment was not recorded: ${r.data.recorded.error}` : 'Added. Airtable updated.')
  }
  saveBtn(box, '#ja-go', () => send(false))
}

function editModal(ui, p) {
  const box = ui.modal(`<h2 style="margin-bottom:12px">Edit ${esc(p.name)}</h2>
    <label class="j-field"><span>Child's full name</span><input class="j-input" id="je-name" value="${esc(p.name)}"></label>
    <div class="j-two"><label class="j-field"><span>Date of birth</span><input class="j-input" type="date" id="je-dob" value="${esc(p.dob || '')}" max="${today()}"></label>
    <label class="j-field"><span>Term fee A$</span><input class="j-input" id="je-fee" inputmode="decimal" value="${esc(dollarsIn(p.feeCents))}"></label></div>
    <label class="j-field"><span>Medical or allergies</span><input class="j-input" id="je-med" value="${esc(p.medical || '')}" maxlength="600"></label>
    <label class="j-field"><span>Parent name</span><input class="j-input" id="je-parent" value="${esc(p.parent || '')}"></label>
    <div class="j-two"><label class="j-field"><span>Parent email</span><input class="j-input" id="je-email" inputmode="email" value="${esc(p.emails?.[0] || '')}"></label>
    <label class="j-field"><span>Second parent email</span><input class="j-input" id="je-email2" inputmode="email" value="${esc(p.emails?.[1] || '')}"></label></div>
    <div class="j-two"><label class="j-field"><span>Mobile</span><input class="j-input" id="je-mobile" inputmode="tel" value="${esc(p.mobile || '')}"></label>
    <label class="j-field"><span>Second mobile</span><input class="j-input" id="je-mobile2" inputmode="tel" value="${esc(p.mobile2 || '')}"></label></div>
    <p class="muted small">The parent email is how the family signs in and pays. Payments are recorded on their own, never edited here.</p>
    <div class="jj-actions"><button type="button" class="j-btn j-btn-line" data-close>Cancel</button><button type="button" class="j-btn j-btn-dark" id="je-go">Save</button></div>`)
  const q = (s) => box.querySelector(s).value.trim()
  saveBtn(box, '#je-go', async () => {
    const before = { name: p.name, dob: p.dob || '', medical: p.medical || '', parent: p.parent || '', email: p.emails?.[0] || '', email2: p.emails?.[1] || '', mobile: p.mobile || '', mobile2: p.mobile2 || '' }
    const now = { name: q('#je-name'), dob: q('#je-dob'), medical: q('#je-med'), parent: q('#je-parent'), email: q('#je-email'), email2: q('#je-email2'), mobile: q('#je-mobile'), mobile2: q('#je-mobile2') }
    const fields = Object.fromEntries(Object.entries(now).filter(([k, v]) => v !== before[k]))
    const fee = q('#je-fee')
    if (fee !== dollarsIn(p.feeCents)) fields.feeAud = fee === '' ? null : Number(fee.replace(/[a$,\s]/gi, ''))
    if (!Object.keys(fields).length) return toast('Nothing changed.')
    const r = await ui.post('jjEditPlayer', { rowId: p.rowId, term: p.term, fields })
    if (!r.ok) return toast(r.data.error || 'Could not save.')
    await afterChange(ui, 'Saved. Airtable updated.')
  })
}

function noteModal(ui, p) {
  const box = ui.modal(`<h2 style="margin-bottom:12px">A note on ${esc(p.name)}</h2>
    <label class="j-field"><span>Note</span><textarea class="j-textarea" id="jn-text" rows="3" maxlength="500"></textarea></label>
    <p class="muted small">Added to the child's notes in Airtable with today's date and your name.</p>
    <div class="jj-actions"><button type="button" class="j-btn j-btn-line" data-close>Cancel</button><button type="button" class="j-btn j-btn-dark" id="jn-go">Add note</button></div>`)
  saveBtn(box, '#jn-go', async () => {
    const r = await ui.post('jjAddNote', { rowId: p.rowId, term: p.term, text: box.querySelector('#jn-text').value.trim() })
    if (!r.ok) return toast(r.data.error || 'Could not save.')
    await afterChange(ui, 'Note added.')
  })
}

function removeModal(ui, p) {
  const box = ui.modal(`<h2 style="margin-bottom:4px">Remove ${esc(p.name)}</h2>
    <p class="muted small" style="margin-bottom:12px">They leave the class, the counts and what is owing. Their row stays in Airtable with a note, and money already paid stays counted. You can put them back.</p>
    <label class="j-field"><span>Why are they leaving?</span><select class="j-select" id="jr-reason"><option value="">Choose a reason</option>${S.data.reasons.map((r) => `<option>${esc(r)}</option>`).join('')}</select></label>
    <label class="j-field"><span>Details <span class="muted">(optional)</span></span><input class="j-input" id="jr-details" maxlength="400"></label>
    <div class="jj-actions"><button type="button" class="j-btn j-btn-line" data-close>Cancel</button><button type="button" class="j-btn j-btn-danger" id="jr-go">Remove</button></div>`)
  saveBtn(box, '#jr-go', async () => {
    const reason = box.querySelector('#jr-reason').value
    if (!reason) return toast('Choose why they are leaving.')
    const r = await ui.post('jjRemovePlayer', { rowId: p.rowId, term: p.term, reason, details: box.querySelector('#jr-details').value.trim() })
    if (!r.ok) return toast(r.data.error || 'Could not remove.')
    await afterChange(ui, `${p.name} removed.`)
  })
}

async function restore(ui, p, force = false) {
  const r = await ui.post('jjRestorePlayer', { rowId: p.rowId, term: p.term, force })
  if (r.status === 409 && r.data.code === 'full') { if (await ui.confirmBox(esc(r.data.error), { ok: 'Put back anyway' })) return restore(ui, p, true); return }
  if (!r.ok) return toast(r.data.error || 'Could not put them back.')
  await afterChange(ui, `${p.name} is back in the class.`)
}

function payModal(ui, p) {
  const owing = p.owingCents ?? (p.feeCents != null ? Math.max(0, p.feeCents - (p.paidCents || 0)) : null)
  const box = ui.modal(`<h2 style="margin-bottom:4px">Record a payment</h2>
    <p class="muted small" style="margin-bottom:12px">${esc(p.name)} · fee ${p.feeCents == null ? 'not set' : esc(money(p.feeCents))} · ${owing == null ? 'owing not known' : `${esc(money(owing))} owing`}. Card payments in Stripe are found on their own: record only cash, bank transfers and other money here.</p>
    <div class="j-two"><label class="j-field"><span>Amount received A$</span><input class="j-input" id="jp-amount" inputmode="decimal" value="${esc(dollarsIn(owing || null))}"></label>
    <label class="j-field"><span>How</span><select class="j-select" id="jp-method">${S.data.methods.map((m) => `<option>${esc(m)}</option>`).join('')}</select></label></div>
    <div class="j-two"><label class="j-field"><span>Date received</span><input class="j-input" type="date" id="jp-date" value="${today()}" max="${today()}"></label>
    <label class="j-field"><span>Note <span class="muted">(optional)</span></span><input class="j-input" id="jp-note" maxlength="200" placeholder="For example, paid at the desk"></label></div>
    <div class="jj-actions"><button type="button" class="j-btn j-btn-line" data-close>Cancel</button><button type="button" class="j-btn j-btn-dark" id="jp-go">Record payment</button></div>`)
  const send = async (allowOver = false) => {
    const amountCents = centsFrom(box.querySelector('#jp-amount').value)
    if (!(amountCents > 0)) return toast('Enter the amount received.')
    const r = await ui.post('jjRecordPayment', { rowIds: [p.rowId], term: p.term, amountCents, method: box.querySelector('#jp-method').value, date: box.querySelector('#jp-date').value, note: box.querySelector('#jp-note').value.trim(), allowOver })
    if (r.status === 400 && /more than|Nothing is owing/.test(r.data.error || '') && !allowOver) { if (await ui.confirmBox(`${esc(r.data.error)} Record it anyway?`, { ok: 'Record anyway' })) return send(true); return }
    if (!r.ok) return toast(r.data.error || 'Could not record.')
    await afterChange(ui, `${money(amountCents)} recorded. Airtable updated.`)
  }
  saveBtn(box, '#jp-go', () => send(false))
}

function voidModal(ui, p, id) {
  const box = ui.modal(`<h2 style="margin-bottom:4px">Take off payment ${esc(id)}</h2>
    <p class="muted small" style="margin-bottom:12px">For a payment entered by mistake. It stays in the record, marked as taken off, and ${esc(p.name)}'s status is worked out again.</p>
    <label class="j-field"><span>Why?</span><input class="j-input" id="jv-reason" maxlength="200" placeholder="For example, typed twice"></label>
    <div class="jj-actions"><button type="button" class="j-btn j-btn-line" data-close>Cancel</button><button type="button" class="j-btn j-btn-danger" id="jv-go">Take it off</button></div>`)
  saveBtn(box, '#jv-go', async () => {
    const r = await ui.post('jjVoidPayment', { id, reason: box.querySelector('#jv-reason').value.trim() })
    if (!r.ok) return toast(r.data.error || 'Could not take it off.')
    await afterChange(ui, 'Payment taken off.')
  })
}

// ---------- settings ----------

async function renderSettings(ui) {
  const d = await ui.need(await ui.post('jjSettings'))
  const j = d.juniors, c = j.classes[0]
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
  const tableRows = Object.entries(j.tables).map(([t, id]) => `<div class="jj-trow"><input class="j-input" data-tterm value="${esc(t)}" aria-label="Term"><input class="j-input" data-tid value="${esc(id)}" aria-label="Airtable table id"><button type="button" class="j-btn j-btn-ghost" data-tdel aria-label="Remove this term">×</button></div>`).join('')
  const skipRows = (j.skipDates || []).map((s) => `<div class="jj-trow"><input class="j-input" type="date" data-sdate value="${esc(s.date)}" aria-label="Date"><input class="j-input" data-sreason value="${esc(s.reason)}" aria-label="Why"><button type="button" class="j-btn j-btn-ghost" data-tdel aria-label="Remove this date">×</button></div>`).join('')
  ui.view().innerHTML = `<div class="jj-view jj-set">
    <div class="jd-head"><div><h1>Settings</h1><p>Joners Juniors. The website, Stripe checkout and confirmation emails use these, as soon as you save.</p></div></div>
    <div class="jd-card" id="jj-preview"><h2>What parents see now</h2><dl class="jj-dl" style="margin-top:8px"><dt>Term dates</dt><dd>${esc(d.public.termDatesLine)}</dd><dt>Class</dt><dd>${esc(d.public.classLabel)}</dd><dt>Term fee</dt><dd>${esc(d.public.feeLine)}</dd><dt>Registrations</dt><dd>${d.public.registrationOpen ? 'Open' : 'Closed'}</dd></dl>
      <p class="muted small" style="margin-top:8px">${d.derived.dates.length} class${d.derived.dates.length === 1 ? '' : 'es'}: ${esc(d.derived.dates.map((x) => x.label).join(', '))}</p></div>
    <form id="jj-sform" novalidate>
      <section class="jd-card"><h2>Term</h2>
        <div class="j-two"><label class="j-field"><span>Term name</span><input class="j-input" name="term" value="${esc(j.term)}" placeholder="Term 1 2027"></label>
        <label class="j-field"><span>First class</span><input class="j-input" type="date" name="termStart" value="${esc(j.termStart)}"></label></div>
        <div class="j-two"><label class="j-field"><span>Weeks</span><input class="j-input" name="weeks" inputmode="numeric" value="${esc(j.weeks)}"></label>
        <label class="j-field"><span>Dates as parents see them <span class="muted">(blank: worked out)</span></span><input class="j-input" name="datesLabel" value="${esc(j.datesLabel)}" placeholder="${esc(d.derived.datesLabel)}"></label></div>
        <p class="jj-sub">Saturdays with no class</p><div id="jj-skips">${skipRows}</div><button type="button" class="j-btn j-btn-line j-btn-sm" id="jj-skip-add">+ Add a date off</button>
      </section>
      <section class="jd-card"><h2>Class</h2>
        <div class="j-two"><label class="j-field"><span>Day</span><select class="j-select" name="day">${days.map((x) => `<option ${x === c.day ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
        <label class="j-field"><span>Places</span><input class="j-input" name="capacity" inputmode="numeric" value="${esc(c.capacity)}"></label></div>
        <div class="j-two"><label class="j-field"><span>Starts</span><input class="j-input" name="time" value="${esc(c.time)}" placeholder="9:15am"></label>
        <label class="j-field"><span>Finishes</span><input class="j-input" name="endTime" value="${esc(c.endTime)}" placeholder="10:00am"></label></div>
        <div class="j-two"><label class="j-field"><span>Venue (as the timetable has it)</span><input class="j-input" name="classLocation" value="${esc(c.location)}"></label>
        <label class="j-field"><span>Coach</span><select class="j-select" name="coachId"><option value="">No coach</option>${d.coaches.map((x) => `<option value="${esc(x.id)}" ${x.id === c.coachId ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label></div>
        <label class="j-field"><span>Address for parents</span><input class="j-input" name="location" value="${esc(j.location)}"></label>
        <label class="j-field"><span>Class as parents see it <span class="muted">(blank: worked out)</span></span><input class="j-input" name="classLabel" value="${esc(j.classLabel)}" placeholder="${esc(d.derived.classLabel)}"></label>
        <label class="j-field"><span>Ages</span><input class="j-input" name="ageLabel" value="${esc(j.ageLabel)}"></label>
      </section>
      <section class="jd-card"><h2>Price and sign-up</h2>
        <div class="j-two"><label class="j-field"><span>Term fee A$</span><input class="j-input" name="price" inputmode="decimal" value="${esc(dollarsIn(j.priceCents))}"></label>
        <label class="j-field"><span>Second child A$ <span class="muted">(optional)</span></span><input class="j-input" name="siblingPrice" inputmode="decimal" value="${esc(dollarsIn(j.siblingPriceCents))}"></label></div>
        <label class="j-check"><input type="checkbox" name="registrationOpen" ${j.registrationOpen ? 'checked' : ''}> Website registrations are open</label>
        <label class="j-field"><span>Waiver version</span><input class="j-input" name="waiverVersion" value="${esc(j.waiverVersion)}"></label>
      </section>
      <section class="jd-card"><h2>Next term</h2>
        <div class="j-two"><label class="j-field"><span>Name</span><input class="j-input" name="nextName" value="${esc(j.nextTerm.name)}"></label>
        <label class="j-field"><span>First class <span class="muted">(if known)</span></span><input class="j-input" type="date" name="nextStart" value="${esc(j.nextTerm.termStart)}"></label></div>
        <label class="j-check"><input type="checkbox" name="nextOpen" ${j.nextTerm.open ? 'checked' : ''}> Re-enrolment for next term is open</label>
      </section>
      <section class="jd-card"><h2>Airtable tables</h2><p class="sub">The Joners Juniors table for each term (it starts with tbl). Add next term's before you switch the term above.</p>
        <div id="jj-tables" style="margin-top:8px">${tableRows}</div><button type="button" class="j-btn j-btn-line j-btn-sm" id="jj-table-add">+ Add a term</button>
      </section>
      <div class="jj-actions"><button type="submit" class="j-btn j-btn-dark" id="jj-save">Save settings</button></div>
    </form></div>`
  const v = ui.view()
  const row = (a, b) => { const el = document.createElement('div'); el.className = 'jj-trow'; el.innerHTML = `${a}${b}<button type="button" class="j-btn j-btn-ghost" data-tdel aria-label="Remove">×</button>`; return el }
  v.querySelector('#jj-table-add').addEventListener('click', () => v.querySelector('#jj-tables').append(row('<input class="j-input" data-tterm placeholder="Term 1 2027" aria-label="Term">', '<input class="j-input" data-tid placeholder="tbl..." aria-label="Airtable table id">')))
  v.querySelector('#jj-skip-add').addEventListener('click', () => v.querySelector('#jj-skips').append(row('<input class="j-input" type="date" data-sdate aria-label="Date">', '<input class="j-input" data-sreason placeholder="Why" aria-label="Why">')))
  v.addEventListener('click', (e) => { const b = e.target.closest('[data-tdel]'); if (b) b.closest('.jj-trow').remove() })
  v.querySelector('#jj-sform').addEventListener('submit', async (e) => {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const g = (k) => String(f.get(k) ?? '').trim()
    const price = centsFrom(g('price')), sibling = centsFrom(g('siblingPrice'))
    const juniors = {
      term: g('term'), termStart: g('termStart'), weeks: Number(g('weeks')), datesLabel: g('datesLabel'),
      skipDates: [...v.querySelectorAll('#jj-skips .jj-trow')].map((r) => ({ date: r.querySelector('[data-sdate]').value, reason: r.querySelector('[data-sreason]').value.trim() })).filter((x) => x.date),
      classes: [{ ...c, day: g('day'), time: g('time'), endTime: g('endTime'), location: g('classLocation'), capacity: Number(g('capacity')), coachId: g('coachId') }],
      classLabel: g('classLabel'), location: g('location'), ageLabel: g('ageLabel'),
      priceCents: price, siblingPriceCents: sibling, registrationOpen: f.get('registrationOpen') === 'on', waiverVersion: g('waiverVersion'),
      nextTerm: { name: g('nextName'), termStart: g('nextStart'), open: f.get('nextOpen') === 'on' },
      tables: Object.fromEntries([...v.querySelectorAll('#jj-tables .jj-trow')].map((r) => [r.querySelector('[data-tterm]').value.trim(), r.querySelector('[data-tid]').value.trim()]).filter(([t, id]) => t || id)),
    }
    const btn = v.querySelector('#jj-save')
    btn.disabled = true
    const r = await ui.post('jjSaveSettings', { juniors })
    btn.disabled = false
    if (!r.ok) return toast(r.data.error || 'Could not save.', 7000)
    forgetJuniors(); S.data = null
    toast(r.data.warnings?.length ? `Saved. ${r.data.warnings.join(' ')}` : 'Saved. The website shows it within a minute.', 6000)
    renderSettings(ui)
  })
}

// ---------- the pages still to come ----------

const SOON = {
  'jj-invites': ['Invites', 'Email families a link to sign in, pay and sign the waiver: new families, re-enrolling for next term, and reminders for anyone unpaid or without a waiver.', 'Until then, families sign up on the website, and Players shows who has not paid or signed.'],
  'jj-requests': ['Requests & waitlist', 'Families asking for a place when the class is full, in the order they asked, with one tap to offer a place.', 'Until then, switch website registrations off in Settings when the class is full.'],
  'jj-classes': ['Classes', 'Each Joners Juniors class with its coach, places and children.', 'There is one class for now: change its day, time, places and coach in Settings.'],
  'jj-registers': ['Registers', 'Mark each class present or absent, with attendance by week on the Dashboard.', 'Until then, coaches mark the class in My sessions, the same as JFP.'],
  'jj-messages': ['Messages', 'Email or text one family or the whole class.', 'Until then, email or call a family from their page in Players.'],
}
function renderSoon(tab, ui) {
  const [title, what, now] = SOON[tab] || ['Coming next', '', '']
  ui.view().innerHTML = `<div class="jj-view"><div class="jd-head"><div><h1>${esc(title)}</h1><p>Joners Juniors</p></div></div>
    <section class="jd-card jj-soon"><span class="j-pill j-pill-violet">Coming next</span><p style="margin-top:10px">${esc(what)}</p><p class="muted small" style="margin-top:8px">${esc(now)}</p>
    <div class="jj-actions"><button type="button" class="j-btn j-btn-line" data-jj-go="jj-players">Open Players</button><button type="button" class="j-btn j-btn-line" data-jj-go="jj-settings">Open Settings</button></div></section></div>`
  bindGo(ui)
}
