// The Joners Juniors section of the staff portal (Lee, 13 Oct 2026): its own
// sidebar group with Dashboard, Players, Invites, Requests & waitlist,
// Classes, Registers, Messages, Money and Settings. Lee and Ligia only; the
// server checks every action again (api/_jj-portal.js).
//
// Built in stages. Stage 1: Dashboard, Players, Money (the Juniors money
// page in jfp-portal-juniors.js) and Settings. Stage 2: Invites (new family,
// re-enrol, reminders, and the online payments behind them) and Requests &
// waitlist. Stage 3: Classes and Registers (jfp-portal-jj-ops.js) and
// Messages (jfp-portal-jj-messages.js), and attendance on the Dashboard.
import { esc, money, toast } from './jfp-common.js'
import { psHead, psSearch, psSelect, psBadge, psToolsMore } from './jfp-portal-ps.js'
import { renderJuniorsMoney, forgetJuniors } from './jfp-portal-juniors.js'
import { renderClasses, renderRegisters } from './jfp-portal-jj-ops.js'
import { renderJJMessages } from './jfp-portal-jj-messages.js'

export const JJ_NAV = ['Joners Juniors', [['jj-dashboard', 'Dashboard'], ['jj-players', 'Players'], ['jj-invites', 'Invites'], ['jj-requests', 'Requests & waitlist'], ['jj-classes', 'Classes'], ['jj-registers', 'Registers'], ['jj-messages', 'Messages'], ['jj-money', 'Money'], ['jj-settings', 'Settings']]]
export const JJ_TABS = new Set(JJ_NAV[1].map(([k]) => k))
// The sidebar icon each Juniors page borrows from its JFP twin.
export const JJ_ICON = { 'jj-dashboard': 'overview', 'jj-players': 'families', 'jj-invites': 'invites', 'jj-requests': 'requests', 'jj-classes': 'groups', 'jj-registers': 'coach', 'jj-messages': 'messages', 'jj-money': 'money', 'jj-settings': 'settings' }

// Players: what is loaded, the search, the chip and the term shown.
const S = { data: null, at: 0, q: '', pay: '', waiver: '', cls: '', show: '', moreOpen: false, term: '' }
export function jjPlayersFilter(chip) { setChip(chip || ''); S.q = ''; S.cls = '' }

const PAY = { paid: ['Paid', 'green'], part: ['Part paid', 'orange'], unpaid: ['Unpaid', 'red'], noprice: ['No price', 'grey'] }
const payPill = (p) => `<span class="j-pill j-pill-${PAY[p.pay]?.[1] || 'grey'}">${esc(PAY[p.pay]?.[0] || p.pay)}</span>`
// Dot colours for the quick chips (the same as psChips in jfp-portal-ps.js).
const CHIP_COLOR = { red: '#E5383B', orange: '#F97316', green: '#12B76A', pink: '#EC4899', violet: '#7A5AF8', grey: '#98A2B3', blue: '#2E90FA' }
// The "?" next to a page title: the page's guidance, one tap away.
const help = (text) => `<details class="ps-help"><summary aria-label="About this page" title="About this page">?</summary><div class="ps-help-body">${esc(text)}</div></details>`
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' })
const longDay = (iso) => (iso ? new Date(`${String(iso).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-AU', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' }) : '')
const centsFrom = (v) => { const x = String(v ?? '').replace(/[a$,\s]/gi, ''); return x === '' ? null : Math.round(Number(x) * 100) }
const dollarsIn = (c) => (c == null ? '' : String(c / 100))

export async function renderJJ(tab, ui) {
  if (tab === 'jj-dashboard') return renderDashboard(ui)
  if (tab === 'jj-players') return renderPlayers(ui)
  if (tab === 'jj-money') return renderJuniorsMoney({ view: ui.view, post: ui.post, filter: ui.filter, go: ui.go, stale: ui.stale })
  if (tab === 'jj-settings') return renderSettings(ui)
  if (tab === 'jj-invites') return renderInvites(ui)
  if (tab === 'jj-requests') return renderRequests(ui)
  if (tab === 'jj-classes') return renderClasses(ui)
  if (tab === 'jj-registers') return renderRegisters(ui)
  if (tab === 'jj-messages') return renderJJMessages(ui)
  return renderDashboard(ui)
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
        <span class="jm-meter" role="img" aria-label="${pct}% of places taken"><span style="width:${pct}%"></span></span><span class="note">${(d.classes || []).length > 1 ? d.classes.map((k) => `${esc(k.label)}: ${k.enrolled} of ${k.capacity}`).join('<br>') : s.placesLeft ? `${s.placesLeft} place${s.placesLeft === 1 ? '' : 's'} left` : 'Full'}${c.removed ? ` · ${c.removed} left this term` : ''}</span></section>
      <section class="jd-card jd-tile jj-tile jd-in" style="--i:1" id="jj-t-collected"><span class="lbl">Collected</span><span class="val">${s.collectedCents == null ? '<span class="muted">not known</span>' : esc(money(s.collectedCents))}</span><span class="note">${s.keptCents == null ? 'Stripe, cash and bank' : `${esc(money(s.keptCents))} kept after Stripe fees${s.feesPending ? ' (some fees not known yet)' : ''}`}</span></section>
      <section class="jd-card jd-tile jj-tile jd-in" style="--i:2" id="jj-t-owing"><span class="lbl">Still owing</span><span class="val">${esc(money(s.owingCents || 0))}${s.owingComplete ? '' : '<span class="muted" style="font-size:14px;font-weight:650"> known</span>'}</span><span class="note">${c.unpaid + c.part} ${c.unpaid + c.part === 1 ? 'child' : 'children'}</span><button type="button" class="link" data-jj-go="jj-players" data-jj-filter="unpaid">See who</button></section>
      <section class="jd-card jd-tile jj-tile jd-in" style="--i:3" id="jj-t-waivers"><span class="lbl">Waivers missing</span><span class="val">${d.waiversUnknown ? '<span class="muted">not checked</span>' : c.noWaiver}</span><span class="note">One family waiver covers JFP and Juniors</span><button type="button" class="link" data-jj-go="jj-players" data-jj-filter="waiver">See who</button></section>
      <section class="jd-card jd-span-7 jd-in" style="--i:4"><h2>Needs you</h2><ul class="jd-list" id="jj-needs">
        ${d.needs.map((n) => `<li><button type="button" data-jj-go="${esc(n.tab)}" data-jj-filter="${esc(n.filter || '')}">${esc(n.label)}</button><span class="muted small">${{ 'jj-money': 'Money', 'jj-settings': 'Settings', 'jj-requests': 'Waitlist', 'jj-invites': 'Invites', 'jj-classes': 'Classes', 'jj-registers': 'Registers' }[n.tab] || 'Players'}</span></li>`).join('') || '<li><span class="muted">Nothing waiting. Nice.</span></li>'}
      </ul></section>
      <section class="jd-card jd-span-5 jd-in" style="--i:5"><h2>Website sign-up</h2><p class="sub">What parents see on jonerfootball.com/jonersjuniors</p>
        <dl class="jj-dl" style="margin-top:10px"><dt>Registrations</dt><dd>${d.registrationOpen ? '<span class="j-pill j-pill-green">Open</span>' : '<span class="j-pill j-pill-red">Closed</span>'}</dd>
        <dt>Term</dt><dd>${esc(d.public.termDatesLine)}</dd><dt>Class</dt><dd>${esc(d.public.classLabel)}</dd><dt>Fee</dt><dd>${esc(d.public.feeLine)}</dd></dl>
        <div class="jj-actions"><a class="j-btn j-btn-line" href="/jonersjuniors/" target="_blank" rel="noopener">Open the page</a><button type="button" class="j-btn j-btn-line" data-jj-go="jj-settings">Change in Settings</button></div></section>
      ${attendanceCard(d.attendance)}
    </div></div>`
  ui.view().querySelector('#jj-d-refresh').addEventListener('click', () => { forgetJuniors(); renderDashboard(ui, true) })
  bindGo(ui)
}

// Attendance by class date (all classes together) and who has missed two or more in a row.
function attendanceCard(a) {
  const head = '<section class="jd-card jd-span-12 jd-in" style="--i:6" id="jj-attendance"><h2>Attendance</h2>'
  if (!a?.ready) return `${head}<p class="sub">${esc(a?.error || 'Attendance could not be read.')}</p></section>`
  const weeks = a.weeks.filter((w) => w.registers)
  if (!weeks.length) return `${head}<p class="sub">No registers yet. Coaches mark the class in My sessions, or mark it under Registers.</p><div class="jj-actions"><button type="button" class="j-btn j-btn-line" data-jj-go="jj-registers">Open Registers</button></div></section>`
  return `${head}<p class="sub">${weeks.length} class date${weeks.length === 1 ? '' : 's'} marked so far.</p>
    <ul class="jj-att" aria-label="Attendance by week">${weeks.map((w) => { const pct = w.children ? Math.round((w.present / w.children) * 100) : 0; return `<li><span class="d">${esc(w.label)}</span><span class="jm-meter" role="img" aria-label="${pct}% here"><span style="width:${pct}%"></span></span><span class="n">${w.present} of ${w.children}${w.absent ? ` · ${w.absent} away` : ''}</span></li>` }).join('')}</ul>
    <h3 class="jj-sec">Missed 2 or more in a row</h3>
    ${a.streaks.length ? `<ul class="jd-list" id="jj-streaks">${a.streaks.map((k) => `<li><button type="button" data-jj-go="jj-registers">${esc(k.name)}: missed ${k.missed} in a row</button><span class="muted small">${esc(k.classLabel)} · last ${esc(k.lastLabel)}</span></li>`).join('')}</ul>` : '<p class="muted small">Nobody. Nice.</p>'}
  </section>`
}

function bindGo(ui) {
  ui.view().querySelectorAll('[data-jj-go]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.jjGo === 'jj-players') jjPlayersFilter(b.dataset.jjFilter)
    ui.go(b.dataset.jjGo)
  }))
}

// ---------- players ----------

// The quick chips keep their old values (the Dashboard's "See who" links use
// them): '' all, a payment status, 'waiver' (no waiver) or 'removed' (left).
// A chip sets the filter it stands for and clears the other chip filters.
function setChip(chip) {
  Object.assign(S, { pay: '', waiver: '', show: '' })
  if (chip === 'waiver') S.waiver = 'no'
  else if (chip === 'removed') S.show = 'left'
  else if (chip) S.pay = chip
}
const chipOn = (v) => (v === '' ? !S.pay && !S.waiver && !S.show : v === 'waiver' ? S.waiver === 'no' : v === 'removed' ? S.show === 'left' : S.pay === v)
const inClass = (p) => (S.data?.classes || []).some((k) => k.id === p.classId)

function matches(p) {
  const q = S.q.trim().toLowerCase()
  if (q && ![p.name, p.parent, p.email, ...(p.emails || []), p.mobile].some((v) => String(v || '').toLowerCase().includes(q))) return false
  if (S.show === 'left' ? !p.removed : p.removed) return false
  if (S.waiver === 'no' && p.waiver.onFile) return false
  if (S.waiver === 'yes' && !p.waiver.onFile) return false
  if (S.pay && p.pay !== S.pay) return false
  if (S.cls && (S.cls === 'none' ? inClass(p) : p.classId !== S.cls)) return false
  return true
}

async function loadPlayers(ui, fresh = false) {
  S.data = await ui.need(await ui.post('jjPlayers', { fresh, term: S.term }))
  S.at = Date.now()
  S.term = S.data.term
}

const PL_MORE = ['cls', 'show']
function plRow(p, multi) {
  const [label, color] = PAY[p.pay] || [p.pay, 'grey']
  const cls = (S.data.classes || []).find((k) => k.id === p.classId)
  return `<tr data-jjpl="${esc(p.rowId)}" class="${p.removed ? 'is-removed' : ''}" tabindex="0" aria-label="${esc(p.name)}, open details">
    <td data-col="who"><div class="ps-who"><div><b>${esc(p.name)}${p.age != null ? ` <span class="muted" style="font-weight:500">(${esc(p.age)})</span>` : ''}</b><span class="ps-sub">${esc(p.parent || 'No parent name')}${p.mobile ? ` · ${esc(p.mobile)}` : ''}</span>${p.removed ? `<span class="ps-sub">Left ${esc(longDay(p.removed.at))}${p.removed.reason ? `: ${esc(p.removed.reason)}` : ''}</span>` : ''}</div></div></td>
    ${multi ? `<td data-col="group">${cls ? esc(cls.label) : psBadge('orange', 'In no class')}</td>` : ''}
    <td data-col="pay">${psBadge(color, label)}<span class="ps-sub">${p.owingCents ? `${esc(money(p.owingCents))} owing` : p.feeCents != null ? esc(money(p.feeCents)) : ''}</span></td>
    <td data-col="flags" class="${p.waiver.onFile ? 'ps-ok' : ''}">${p.waiver.onFile ? '<span class="muted">Waiver on file</span>' : p.waiver.unknown ? psBadge('grey', 'Waiver not checked') : psBadge('red', 'No waiver')}</td>
  </tr>`
}

async function renderPlayers(ui, keep = false) {
  if (!S.data || (!keep && Date.now() - S.at > 30000)) await loadPlayers(ui, true)
  const d = S.data, c = d.counts
  const multi = (d.classes || []).length > 1
  if (!multi) S.cls = ''
  const shown = d.players.filter(matches)
  const total = S.show === 'left' ? c.removed : c.all
  const active = ['q', 'pay', 'waiver', 'cls', 'show'].filter((k) => S[k]).length
  const moreSet = PL_MORE.filter((k) => S[k]).length
  if (moreSet) S.moreOpen = true
  // A chip with nobody in it is left out, unless it is the one picked.
  const chips = [['', 'All', c.all, ''], ['paid', 'Paid', c.paid, 'green'], ['part', 'Part paid', c.part, 'orange'], ['unpaid', 'Unpaid', c.unpaid, 'red'], ['noprice', 'No price', c.noprice, 'grey'], ['waiver', 'No waiver', c.noWaiver, 'red'], ['removed', 'Left', c.removed, 'grey']].filter(([v, , n]) => v === '' || n || chipOn(v))
  const y = window.scrollY
  ui.view().innerHTML = `<div class="jj-view">
    ${psHead({ title: 'Players', count: shown.length === total ? String(total) : `${shown.length} of ${total}`, primary: d.current ? '<button type="button" class="j-btn j-btn-dark" id="jj-p-add">+ Add a child</button>' : '' }).replace('class="ps-count"', 'class="ps-count" id="jj-p-count"').replace('</h1>', `</h1>${help('Every Joners Juniors child in the term, read from Airtable. Tap a child for contacts, money, payments and the waiver. One family waiver covers JFP and Juniors.')}`)}
    <p class="ps-sub-line">${esc(d.term)} · ${esc(d.classLabel)} · ${d.summary.enrolled} of ${d.capacity} places</p>
    ${d.moneyError ? `<div class="j-box j-box-amber" style="margin-bottom:10px">${esc(d.moneyError)} Payment status is from Airtable only.</div>` : ''}
    ${d.current ? '' : `<div class="j-box j-box-grey" style="margin-bottom:10px">${esc(d.term)} is not the term running now. You can look and record a late payment; new children go into the current term.</div>`}
    <div class="ps-tools" role="search">
      ${psSearch('jj-q', 'Search children…', S.q, 'Search child, parent, email or mobile')}
      ${d.terms.length > 1 ? `<select class="j-select is-set" id="jj-term" aria-label="Term">${d.terms.map((t) => `<option ${t === d.term ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>` : ''}
      ${psSelect('jj-pay', ['paid', 'part', 'unpaid', 'noprice'].map((id) => ({ id, label: PAY[id][0] })), S.pay, 'Payment')}
      ${psSelect('jj-waiver', [{ id: 'yes', label: 'Waiver on file' }, { id: 'no', label: 'No waiver' }], S.waiver, 'Waiver')}
      <span class="ps-more-filters" id="jj-p-morebox" ${S.moreOpen ? '' : 'hidden'}>
        ${multi ? psSelect('jj-cls', [...d.classes.map((k) => ({ id: k.id, label: k.label })), { id: 'none', label: 'In no class' }], S.cls, 'Class') : ''}
        ${psSelect('jj-show', [{ id: 'left', label: 'Children who left' }], S.show, 'Still in the class')}
      </span>
      ${psToolsMore('jj-p', { open: S.moreOpen, set: moreSet, active })}
      <span class="ps-meta">Updated ${esc(new Date(S.at).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' }))} · <button type="button" class="ps-link" id="jj-p-refresh" title="Read Airtable again">Refresh</button></span>
    </div>
    <div class="ps-chips" id="jj-chips" aria-label="Quick filters">${chips.map(([v, l, n, col]) => `<button type="button" class="ps-chip" data-jjchip="${v}" aria-pressed="${chipOn(v)}">${col ? `<i style="background:${CHIP_COLOR[col]}"></i>` : ''}${esc(l)} <b>${n}</b></button>`).join('')}</div>
    <div class="ps-table-wrap"><table class="ps-table ps-flat jj-ps"><thead><tr><th>Child</th>${multi ? '<th>Class</th>' : ''}<th>Payment</th><th>Waiver</th></tr></thead>
      <tbody id="jj-rows">${shown.map((p) => plRow(p, multi)).join('') || `<tr><td colspan="${multi ? 4 : 3}"><div class="ps-empty">${d.players.length ? `No children match.${active ? ' <button type="button" class="ps-link" data-jj-clear>Clear filters</button>' : ''}` : `No children in ${esc(d.term)} yet.`}</div></td></tr>`}</tbody></table></div></div>`
  if (keep) window.scrollTo(0, y)
  const v = ui.view()
  const redraw = () => renderPlayers(ui, true)
  v.querySelector('#jj-q').addEventListener('input', (e) => { S.q = e.target.value; const at = e.target.selectionStart; redraw(); const i = ui.view().querySelector('#jj-q'); i.focus(); i.setSelectionRange(at, at) })
  for (const [id, key] of [['#jj-pay', 'pay'], ['#jj-waiver', 'waiver'], ['#jj-cls', 'cls'], ['#jj-show', 'show']]) v.querySelector(id)?.addEventListener('change', (e) => { S[key] = e.target.value; redraw() })
  v.querySelectorAll('[data-jjchip]').forEach((b) => b.addEventListener('click', () => { const ch = b.dataset.jjchip; setChip(ch && chipOn(ch) ? '' : ch); redraw() }))
  const clear = () => { Object.assign(S, { q: '', pay: '', waiver: '', cls: '', show: '' }); redraw() }
  v.querySelector('#jj-p-clear')?.addEventListener('click', clear)
  v.querySelector('[data-jj-clear]')?.addEventListener('click', clear)
  v.querySelector('#jj-p-morefilters').addEventListener('click', () => { S.moreOpen = !S.moreOpen; redraw() })
  v.querySelector('#jj-p-refresh').addEventListener('click', async () => { forgetJuniors(); await loadPlayers(ui, true); redraw() })
  v.querySelector('#jj-term')?.addEventListener('change', async (e) => { S.term = e.target.value; setChip(''); S.cls = ''; await loadPlayers(ui, false); redraw() })
  v.querySelector('#jj-p-add')?.addEventListener('click', () => addModal(ui))
  v.querySelectorAll('[data-jjpl]').forEach((tr) => {
    const open = () => { const p = d.players.find((x) => x.rowId === tr.dataset.jjpl); if (p) detailModal(ui, p) }
    tr.addEventListener('click', open)
    tr.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === tr) { e.preventDefault(); open() } })
  })
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
    <h3 class="jj-sec">Child</h3>${dl([['Class', esc((S.data.classes || []).find((k) => k.id === p.classId)?.label || p.className)], ['Medical', esc(p.medical || 'Nothing given')], ['Date of birth', esc(p.dob ? longDay(p.dob) : 'not on file')]])}
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
    ${(d.classes || []).length > 1 ? `<label class="j-field"><span>Class</span><select class="j-select" id="ja-class">${d.classes.map((k) => `<option value="${esc(k.id)}" ${k.placesLeft ? '' : 'data-full'}>${esc(k.label)} (${k.enrolled} of ${k.capacity})</option>`).join('')}</select></label>` : ''}
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
      payment, note: q('#ja-note').value.trim(), force, ...(q('#ja-class') ? { classId: q('#ja-class').value } : {}),
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
  const j = d.juniors
  const tableRows = Object.entries(j.tables).map(([t, id]) => `<div class="jj-trow"><input class="j-input" data-tterm value="${esc(t)}" aria-label="Term"><input class="j-input" data-tid value="${esc(id)}" aria-label="Airtable table id"><button type="button" class="j-btn j-btn-ghost" data-tdel aria-label="Remove this term">×</button></div>`).join('')
  const skipRows = (j.skipDates || []).map((s) => `<div class="jj-trow"><input class="j-input" type="date" data-sdate value="${esc(s.date)}" aria-label="Date"><input class="j-input" data-sreason value="${esc(s.reason)}" aria-label="Why"><button type="button" class="j-btn j-btn-ghost" data-tdel aria-label="Remove this date">×</button></div>`).join('')
  ui.view().innerHTML = `<div class="jj-view jj-set">
    <div class="jd-head"><div><h1>Settings</h1><details class="ps-help"><summary aria-label="About this page" title="About this page">?</summary><div class="ps-help-body">Joners Juniors. The website, Stripe checkout and confirmation emails use these, as soon as you save.</div></details></div></div>
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
        <p class="sub" id="jj-set-classes">${esc(d.derived.classes.map((x) => `${x.label} (${x.capacity} places)`).join(', '))}. Day, time, places and coaches are set on the Classes page. <button type="button" class="link" data-jj-go="jj-classes">Open Classes</button></p>
        <label class="j-field" style="margin-top:8px"><span>Address for parents</span><input class="j-input" name="location" value="${esc(j.location)}"></label>
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
        <div class="j-two"><label class="j-field"><span>Next term fee A$ <span class="muted">(blank: same as now)</span></span><input class="j-input" name="nextPrice" inputmode="decimal" value="${esc(dollarsIn(j.nextTerm.priceCents))}" placeholder="${esc(dollarsIn(j.priceCents))}"></label>
        <label class="j-field"><span>Hold the place A$ <span class="muted">(blank: no hold)</span></span><input class="j-input" name="nextHold" inputmode="decimal" value="${esc(dollarsIn(j.nextTerm.holdCents))}"></label></div>
        <label class="j-check"><input type="checkbox" name="nextOpen" ${j.nextTerm.open ? 'checked' : ''}> Re-enrolment is open to every current family (not only the ones invited)</label>
        <p class="muted small" id="jj-next-table" style="margin-top:6px">${d.derived.next?.table ? `Re-enrolled children go into the ${esc(j.nextTerm.name)} table when they pay.` : `<b>Add the Airtable table for ${esc(j.nextTerm.name)} below</b> before you send re-enrolment invites. Make it in Airtable by duplicating this term's table (structure only), then paste its tbl id.`}</p>
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
      classLabel: g('classLabel'), location: g('location'), ageLabel: g('ageLabel'),
      priceCents: price, siblingPriceCents: sibling, registrationOpen: f.get('registrationOpen') === 'on', waiverVersion: g('waiverVersion'),
      nextTerm: { name: g('nextName'), termStart: g('nextStart'), open: f.get('nextOpen') === 'on', priceCents: centsFrom(g('nextPrice')), holdCents: centsFrom(g('nextHold')) },
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
  bindGo(ui)
}

// ---------- invites (stage 2) ----------

const IV = { kind: 'new', filter: 'both', data: null, picked: null, preview: false, q: '', status: '' }
const KIND_TABS = [['new', 'New family'], ['next', 'Re-enrol'], ['reminder', 'Reminders']]
const STATUS = { 'not sent': ['grey', 'Not sent'], sent: ['violet', 'Sent'], opened: ['orange', 'Opened'], paid: ['green', 'Paid'], answered: ['green', 'Answered'] }
const NEXT = { invited: ['orange', 'Invited'], held: ['violet', 'Held'], paid: ['green', 'Paid'], no: ['grey', 'Not returning'], '': ['grey', 'Not invited'] }
const shortDay = (iso) => (iso ? new Date(iso).toLocaleDateString('en-AU', { timeZone: 'Australia/Sydney', day: 'numeric', month: 'short' }) : '')

async function loadInvites(ui) {
  IV.data = await ui.need(await ui.post('jjInvites', { kind: IV.kind, filter: IV.filter }))
  IV.picked = new Set(IV.data.list.filter((f) => f.todo && !f.sentAt && !IV.data.blocked).map((f) => f.email))
}

async function renderInvites(ui, keep = false) {
  if (!keep || !IV.data || IV.data.kind !== IV.kind) await loadInvites(ui)
  const d = IV.data
  const what = {
    new: 'Sign in to the family account (the same login as JFP) and pay this term. Families who owe get a payment link for exactly what is owing.',
    next: d.next ? `Keep the place for ${d.next.name}: pay ${money(d.next.fullCents)}${d.next.holdCents ? ` or hold it for ${money(d.next.holdCents)}` : ''}, or say not returning, in the family account.` : 'The re-enrol email for next term.',
    reminder: 'For families who still owe or have no waiver, with the amount still owing.',
  }[IV.kind]
  const q = IV.q.trim().toLowerCase()
  const ivMatch = (f) => (!IV.status || (f.status || 'not sent') === IV.status)
    && (!q || [f.parent, f.email, ...f.children.map((k) => k.name)].some((x) => String(x || '').toLowerCase().includes(q)))
  const shown = d.list.filter(ivMatch)
  const active = Boolean(IV.q || IV.status)
  const n = (s) => d.list.filter((f) => (f.status || 'not sent') === s).length
  const statuses = Object.keys(STATUS).filter((s) => n(s) || IV.status === s)
  const famRow = (f) => {
    const [c, l] = STATUS[f.status] || STATUS['not sent']
    return `<tr data-fam="${esc(f.email)}">
      <td data-col="who"><div class="ps-who"><label class="jj-fam-tick"><input type="checkbox" data-pick="${esc(f.email)}" ${IV.picked.has(f.email) ? 'checked' : ''} ${!f.todo || d.blocked ? 'disabled' : ''} aria-label="Choose ${esc(f.parent || f.email)}"></label>
        <div><b>${esc(f.parent || 'No parent name')}</b><span class="ps-sub">${esc(f.email)}</span>
        ${f.sentAt ? `<span class="ps-sub">Sent ${esc(shortDay(f.sentAt))}${f.sentCount > 1 ? ` (${f.sentCount} times)` : ''}${f.sentBy ? ` by ${esc(f.sentBy.split('@')[0])}` : ''}${f.openPayreq?.views ? ` · link opened ${esc(shortDay(f.openPayreq.viewedAt))}` : ''}${f.signedInAt ? ` · signed in ${esc(shortDay(f.signedInAt))}` : ''}</span>` : f.signedInAt ? `<span class="ps-sub">Signed in ${esc(shortDay(f.signedInAt))}</span>` : ''}</div></div></td>
      <td data-col="group">${f.children.map((k) => `<span class="jv-kid">${esc(k.name)}${IV.kind === 'next' ? ` ${psBadge(...(NEXT[k.next] || NEXT['']))}` : k.owingCents ? ` · ${esc(money(k.owingCents))} owing` : k.pay === 'paid' ? ' · paid' : ''}${!k.waiver && IV.kind !== 'next' ? ' · no waiver' : ''}</span>`).join('')}</td>
      <td data-col="pay">${psBadge(c, l)}${IV.kind !== 'next' && f.owingCents ? `<span class="ps-sub">${esc(money(f.owingCents))}</span>` : ''}${!f.owingKnown && IV.kind !== 'next' ? '<span class="ps-sub">owing not known</span>' : ''}</td>
      <td class="ps-end ps-keep"><button type="button" class="j-btn j-btn-ghost j-btn-sm" data-prev="${esc(f.email)}">Preview</button></td>
    </tr>`
  }
  const y = window.scrollY
  ui.view().innerHTML = `<div class="jj-view">
    ${psHead({ title: 'Invites', count: shown.length === d.list.length ? String(d.list.length) : `${shown.length} of ${d.list.length}`, primary: `<button type="button" class="j-btn j-btn-line" id="jv-prev">${IV.preview ? 'Hide the email' : 'Show the email'}</button><button type="button" class="j-btn j-btn-dark" id="jv-send" ${d.blocked ? 'disabled' : ''}>Send to ${IV.picked.size} chosen</button>` }).replace('</h1>', `</h1>${help(`${what} Families not sent yet are chosen for you; tick or untick any family. Send goes to every family chosen, even one a search or filter is hiding.`)}`)}
    <p class="ps-sub-line">${esc(d.term)} · Nothing is sent until you press Send</p>
    ${d.blocked ? `<div class="j-box j-box-amber" id="jv-blocked" style="margin-bottom:10px">${esc(d.blocked)} <button type="button" class="link" data-jj-go="jj-settings">Open Settings</button></div>` : ''}
    ${d.moneyError && IV.kind !== 'next' ? `<div class="j-box j-box-amber" style="margin-bottom:10px">${esc(d.moneyError)} Amounts may be missing, so families who owe cannot be sent a payment link until it is read.</div>` : ''}
    <div class="ps-tools" role="search">
      <div class="ps-seg" id="jv-kind" role="group" aria-label="Which email">${KIND_TABS.map(([k, l]) => `<button type="button" data-kind="${k}" aria-pressed="${IV.kind === k}">${esc(k === 'next' && d.next ? `Re-enrol for ${d.next.name}` : l)}</button>`).join('')}</div>
      ${IV.kind === 'reminder' ? `<div class="ps-seg" id="jv-filter" role="group" aria-label="Remind about">${[['both', 'Unpaid or no waiver'], ['unpaid', 'Unpaid'], ['waiver', 'No waiver']].map(([v, l]) => `<button type="button" data-filter="${v}" aria-pressed="${IV.filter === v}">${esc(l)}</button>`).join('')}</div>` : ''}
      ${psSearch('jv-q', 'Search families…', IV.q, 'Search parent, email or child')}
      ${psSelect('jv-status', statuses.map((s) => ({ id: s, label: STATUS[s][1] })), IV.status, 'Status')}
      ${psToolsMore('jv', { active, hasMore: false })}
      <span class="ps-meta"><button type="button" class="ps-link" id="jv-none">Choose none</button> · <button type="button" class="ps-link" id="jv-refresh">Refresh</button></span>
    </div>
    <div class="ps-chips" id="jv-counts" aria-label="Quick filters">${statuses.map((s) => `<button type="button" class="ps-chip" data-ivchip="${esc(s)}" aria-pressed="${IV.status === s}"><i style="background:${CHIP_COLOR[STATUS[s][0]]}"></i>${esc(s === 'paid' && IV.kind === 'next' ? 'Answered' : STATUS[s][1])} <b>${n(s)}</b></button>`).join('')}</div>
    <div id="jv-preview">${IV.preview ? previewHtml(d.previews) : ''}</div>
    <div class="ps-table-wrap"><table class="ps-table jv-ps"><thead><tr><th>Family</th><th>Children</th><th>Status</th><th class="ps-end"><span class="sr-only">Preview</span></th></tr></thead>
      <tbody id="jv-list">${shown.map(famRow).join('') || `<tr><td colspan="4"><div class="ps-empty">${d.list.length ? `No families match.${active ? ' <button type="button" class="ps-link" data-jv-clear>Clear filters</button>' : ''}` : IV.kind === 'reminder' ? 'Nobody to remind. Everyone has paid and signed.' : 'No families in this term yet.'}</div></td></tr>`}</tbody></table></div>
    ${d.noEmail.length ? `<p class="muted small" style="margin-top:8px">No parent email in Airtable, so no invite: ${esc(d.noEmail.map((x) => x.name).join(', '))}. Add one in Players.</p>` : ''}
    <section style="margin-top:22px" id="jv-pay"><div class="ps-title" style="margin-bottom:10px"><h2>Online payments</h2>${help('Every Juniors payment link, who opened it and whether it is paid.')}</div><div id="jv-paylist"><p class="muted small">Loading</p></div></section>
  </div>`
  if (keep) window.scrollTo(0, y)
  const v = ui.view()
  const redraw = () => renderInvites(ui, true)
  v.querySelectorAll('#jv-kind [data-kind]').forEach((b) => b.addEventListener('click', async () => { IV.kind = b.dataset.kind; IV.preview = false; IV.status = ''; await renderInvites(ui) }))
  v.querySelectorAll('#jv-filter [data-filter]').forEach((b) => b.addEventListener('click', async () => { IV.filter = b.dataset.filter; IV.status = ''; await loadInvites(ui); redraw() }))
  v.querySelector('#jv-q').addEventListener('input', (e) => { IV.q = e.target.value; const at = e.target.selectionStart; redraw(); const i = ui.view().querySelector('#jv-q'); i.focus(); i.setSelectionRange(at, at) })
  v.querySelector('#jv-status').addEventListener('change', (e) => { IV.status = e.target.value; redraw() })
  v.querySelectorAll('[data-ivchip]').forEach((b) => b.addEventListener('click', () => { IV.status = IV.status === b.dataset.ivchip ? '' : b.dataset.ivchip; redraw() }))
  const clear = () => { IV.q = ''; IV.status = ''; redraw() }
  v.querySelector('#jv-clear')?.addEventListener('click', clear)
  v.querySelector('[data-jv-clear]')?.addEventListener('click', clear)
  v.querySelector('#jv-refresh').addEventListener('click', async () => { await loadInvites(ui); redraw() })
  v.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('change', () => { if (b.checked) IV.picked.add(b.dataset.pick); else IV.picked.delete(b.dataset.pick); v.querySelector('#jv-send').textContent = `Send to ${IV.picked.size} chosen` }))
  v.querySelector('#jv-none').addEventListener('click', () => { IV.picked.clear(); redraw() })
  v.querySelector('#jv-prev').addEventListener('click', () => { IV.preview = !IV.preview; redraw() })
  v.querySelectorAll('[data-prev]').forEach((b) => b.addEventListener('click', async () => {
    const r = await ui.need(await ui.post('jjInvites', { kind: IV.kind, filter: IV.filter, previewEmail: b.dataset.prev }))
    ui.modal(`<h2 style="margin-bottom:4px">The email</h2><p class="muted small" style="margin-bottom:10px">What ${esc(b.dataset.prev)} would get. Nothing is sent from here.</p>${previewHtml(r.previews)}<div class="jj-actions"><button type="button" class="j-btn j-btn-line" data-close>Close</button></div>`, { wide: true })
  }))
  v.querySelector('#jv-send').addEventListener('click', (e) => sendPicked(ui, e.currentTarget))
  bindGo(ui)
  if (keep && PY.list) drawPayList(ui); else renderPayList(ui)
}

function previewHtml(list) {
  if (!list?.length) return '<p class="muted small">No family to show the email for.</p>'
  return list.map((x) => `<div class="j-card jj-prev" style="padding:12px;margin-bottom:12px"><p class="small" style="overflow-wrap:anywhere"><b>${esc(x.label)}</b> · ${esc(x.parent || x.email)}<br>Subject: ${esc(x.subject)}</p><iframe title="Email preview" class="jj-frame" srcdoc="${esc(x.html)}"></iframe></div>`).join('')
}

async function sendPicked(ui, btn, only = null) {
  const d = IV.data
  const emails = only || [...IV.picked]
  if (!emails.length) return toast('Choose the families to email.')
  const again = emails.filter((x) => d.list.find((f) => f.email === x)?.sentAt).length
  const word = { new: 'the sign in and pay email', next: `the ${d.next?.name || 'next term'} re-enrol email`, reminder: 'a reminder' }[d.kind]
  if (!(await ui.confirmBox(`Send ${esc(word)} to <b>${emails.length}</b> famil${emails.length === 1 ? 'y' : 'ies'} now?${again ? ` ${again} already had it and will get it again.` : ''}`, { ok: 'Send' }))) return false
  if (btn) btn.disabled = true
  let sent = 0
  const failed = []
  for (let i = 0; i < emails.length; i += 10) {
    if (btn) btn.textContent = `Sending ${Math.min(i + 10, emails.length)} of ${emails.length}`
    const r = await ui.post('jjInvites', { kind: d.kind, filter: IV.filter, send: true, emails: emails.slice(i, i + 10), resend: again > 0 })
    if (!r.ok) { toast(r.data.error || 'Sending stopped. Nothing is lost: try again.', 7000); break }
    sent += r.data.sent.length
    failed.push(...r.data.failed)
  }
  toast(`Sent ${sent}${failed.length ? `. Not sent: ${failed.length} (${failed[0].error})` : ''}`, failed.length ? 8000 : 4000)
  if (!only) { await loadInvites(ui); renderInvites(ui, true) }
  return true
}

// Online payments: read once, then the chips redraw from what is loaded.
const PY = { list: null, error: '', show: '' }
const PAY_ST = { open: ['orange', 'Waiting'], checkout: ['orange', 'On Stripe'], paid: ['green', 'Paid'], cancelled: ['grey', 'Cancelled'] }
const PAY_CHIPS = [['waiting', 'Waiting', (q) => q.status === 'open' || q.status === 'checkout', 'orange'], ['paid', 'Paid', (q) => q.status === 'paid', 'green'], ['check', 'Needs checking', (q) => q.needsCheck, 'red'], ['cancelled', 'Cancelled', (q) => q.status === 'cancelled', 'grey']]

async function renderPayList(ui) {
  const el = ui.view().querySelector('#jv-paylist')
  if (!el) return
  const r = await ui.post('jjPayments')
  PY.list = r.ok ? r.data.payments : null
  PY.error = r.ok ? '' : r.data.error || 'Could not read the payments.'
  drawPayList(ui)
}

function drawPayList(ui) {
  const el = ui.view().querySelector('#jv-paylist')
  if (!el) return
  if (!PY.list) { el.innerHTML = `<p class="muted small">${esc(PY.error)}</p>`; return }
  const all = PY.list
  if (!all.length) { el.innerHTML = '<p class="muted small">No online payments yet.</p>'; return }
  const chip = PAY_CHIPS.find(([k]) => k === PY.show)
  const list = chip ? all.filter(chip[2]) : all
  const chips = PAY_CHIPS.map(([k, l, f, col]) => [k, l, all.filter(f).length, col]).filter(([k, , n]) => n || PY.show === k)
  el.innerHTML = `<div class="ps-chips" id="jv-paychips" aria-label="Show payments"><button type="button" class="ps-chip" data-paychip="" aria-pressed="${!PY.show}">All <b>${all.length}</b></button>${chips.map(([k, l, n, col]) => `<button type="button" class="ps-chip" data-paychip="${k}" aria-pressed="${PY.show === k}"><i style="background:${CHIP_COLOR[col]}"></i>${esc(l)} <b>${n}</b></button>`).join('')}</div>
    <div class="ps-table-wrap"><table class="ps-table ps-flat jv-ps jv-pays"><thead><tr><th>For</th><th>Family</th><th>Payment</th><th>Check</th><th class="ps-end"><span class="sr-only">Actions</span></th></tr></thead><tbody>
    ${list.slice(0, 80).map((q) => `<tr data-payreq="${esc(q.id)}">
      <td data-col="who"><div class="ps-who"><div><b>${esc(q.players.join(', '))}</b><span class="ps-sub">${esc(q.what)}</span></div></div></td>
      <td data-col="group">${esc(q.parent || q.email)}<span class="ps-sub">${esc(shortDay(q.createdAt))}${q.views ? ` · opened ${q.views} time${q.views === 1 ? '' : 's'}` : ''}${q.paidAt ? ` · paid ${esc(shortDay(q.paidAt))}${q.feeCents != null ? `, Stripe fee ${esc(money(q.feeCents))}` : ''}` : ''}</span></td>
      <td data-col="pay">${psBadge(...(PAY_ST[q.status] || ['grey', q.status]))}<span class="ps-sub"><b>${esc(money(q.paidCents ?? q.amountCents))}</b></span></td>
      <td data-col="flags" class="${q.needsCheck ? '' : 'ps-ok'}">${q.needsCheck ? `${psBadge('red', 'Needs checking')}<span class="ps-sub">${esc(q.attention || q.error || 'Airtable not updated yet')}</span>` : '<span class="muted">Fine</span>'}</td>
      <td class="ps-end ps-keep">${q.needsCheck && q.airtable !== 'done' ? `<button type="button" class="j-btn j-btn-line j-btn-sm" data-repair="${esc(q.id)}">Try again</button>` : ''}${q.needsCheck && q.airtable === 'done' && q.attention ? `<button type="button" class="j-btn j-btn-line j-btn-sm" data-checked="${esc(q.id)}">Mark as checked</button>` : ''}${q.status === 'open' || q.status === 'checkout' ? `<button type="button" class="j-btn j-btn-ghost j-btn-sm" data-cancelpay="${esc(q.id)}">Cancel</button>` : ''}</td>
    </tr>`).join('') || `<tr><td colspan="5"><div class="ps-empty">No payments match. <button type="button" class="ps-link" data-paychip="">Clear filters</button></div></td></tr>`}</tbody></table></div>`
  el.querySelectorAll('[data-paychip]').forEach((b) => b.addEventListener('click', () => { const k = b.dataset.paychip; PY.show = PY.show === k ? '' : k; drawPayList(ui) }))
  el.querySelectorAll('[data-repair]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true
    const x = await ui.post('jjRepairPayment', { id: b.dataset.repair })
    toast(x.ok ? (x.data.done ? 'Done. Airtable updated.' : `Still not done: ${x.data.error || 'try again later'}`) : x.data.error || 'Could not try again.', 6000)
    renderPayList(ui)
  }))
  el.querySelectorAll('[data-checked]').forEach((b) => b.addEventListener('click', async () => {
    if (!(await ui.confirmBox('Sorted in Stripe (refunded or kept as credit)? The flag comes off; the record keeps who checked it.', { ok: 'Mark as checked' }))) return
    const x = await ui.post('jjPaymentChecked', { id: b.dataset.checked })
    toast(x.ok ? 'Marked as checked.' : x.data.error || 'Could not save that.')
    renderPayList(ui)
  }))
  el.querySelectorAll('[data-cancelpay]').forEach((b) => b.addEventListener('click', async () => {
    if (!(await ui.confirmBox('Cancel this payment link? The family will not be able to pay with it.', { ok: 'Cancel the link', danger: true }))) return
    const x = await ui.post('jjCancelPayreq', { id: b.dataset.cancelpay })
    toast(x.ok ? 'Cancelled.' : x.data.error || 'Could not cancel.')
    renderPayList(ui)
  }))
}

// ---------- requests and waitlist (stage 2) ----------

// Requests: what is loaded and the filters. keep: redraw from what is loaded.
const RQ = { data: null, q: '', status: '', stage: '', why: '' }
const RQ_STATUS = [['waiting', 'Waitlist', 'orange'], ['accepted', 'Accepted', 'green'], ['declined', 'Declined', 'grey']]

async function renderRequests(ui, keep = false) {
  if (!keep || !RQ.data) RQ.data = await ui.need(await ui.post('jjRequests'))
  const d = RQ.data
  const tel = (m) => (m ? `<a href="tel:${esc(String(m).replace(/[^\d+]/g, ''))}">${esc(m)}</a>` : '')
  const stage = { waiting: ['orange', 'Waiting'], accepted: ['orange', 'In the class, invite not sent'], invited: ['violet', 'Invited to pay'], paid: ['green', 'Paid'], declined: ['grey', 'Declined'] }
  const q = RQ.q.trim().toLowerCase()
  const rqMatch = (r) => (!RQ.status || r.status === RQ.status) && (!RQ.stage || r.stage === RQ.stage) && (!RQ.why || r.why === RQ.why)
    && (!q || [r.player.name, r.parent.name, r.parent.email, r.parent.mobile].some((x) => String(x || '').toLowerCase().includes(q)))
  // The waitlist first, in the order asked; then accepted, then declined.
  const order = { waiting: 0, accepted: 1, declined: 2 }
  const all = [...d.list].sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3) || (a.position || 0) - (b.position || 0))
  const shown = all.filter(rqMatch)
  const active = ['q', 'status', 'stage', 'why'].filter((k) => RQ[k]).length
  const waiting = d.list.filter((r) => r.status === 'waiting').sort((a, b) => (a.position || 0) - (b.position || 0))
  const row = (r) => `<tr data-req="${esc(r.id)}">
      <td data-col="who"><div class="ps-who"><div><b>${r.position ? `${r.position}. ` : ''}${esc(r.player.name)}${r.age != null ? ` <span class="muted" style="font-weight:500">(${esc(r.age)})</span>` : ''}</b>
        <span class="ps-sub">${esc(r.parent.name)}</span>${r.player.medical && !/^none/i.test(r.player.medical) ? `<span class="ps-sub">Medical: ${esc(r.player.medical)}</span>` : ''}</div></div></td>
      <td data-col="group"><a href="mailto:${esc(r.parent.email)}">${esc(r.parent.email)}</a>${r.parent.mobile ? `<span class="ps-sub">${tel(r.parent.mobile)}</span>` : ''}</td>
      <td data-col="pay">${psBadge(...(stage[r.stage] || stage.waiting))}<span class="ps-sub">Asked ${esc(shortDay(r.createdAt))} · ${r.why === 'closed' ? 'registrations were closed' : 'the class was full'}</span>
        ${r.decidedAt ? `<span class="ps-sub">${esc(r.status === 'declined' ? 'Declined' : 'Accepted')} by ${esc(r.decidedBy)} on ${esc(shortDay(r.decidedAt))}${r.declineReason ? `: ${esc(r.declineReason)}` : ''}${r.invitedAt ? ` · invite sent ${esc(shortDay(r.invitedAt))}` : ''}</span>` : ''}</td>
      <td class="ps-end ps-keep"><div class="jj-row-acts">
        ${r.status === 'waiting' ? `<button type="button" class="j-btn j-btn-dark j-btn-sm" data-accept="${esc(r.id)}">Accept: give the place</button><button type="button" class="j-btn j-btn-line j-btn-sm" data-decline="${esc(r.id)}">Decline</button>` : ''}
        ${r.stage === 'accepted' || r.stage === 'invited' ? `<button type="button" class="j-btn ${r.stage === 'accepted' ? 'j-btn-dark' : 'j-btn-line'} j-btn-sm" data-invite="${esc(r.parent.email)}">${r.stage === 'accepted' ? 'Send the invite to pay' : 'Send the invite again'}</button>` : ''}
        ${r.status === 'declined' ? `<button type="button" class="j-btn j-btn-line j-btn-sm" data-wait="${esc(r.id)}">Back on the waitlist</button>` : ''}
      </div></td>
    </tr>`
  const y = window.scrollY
  ui.view().innerHTML = `<div class="jj-view">
    ${psHead({ title: 'Requests & waitlist', count: shown.length === all.length ? String(all.length) : `${shown.length} of ${all.length}` }).replace('</h1>', `</h1>${help('When the class is full or registrations are closed, the website form puts families here instead of taking payment. Accepting puts the child in the class and lets you send the sign in and pay email. Declining sends no email.')}`)}
    <p class="ps-sub-line">${esc(d.term)} · ${d.enrolled} of ${d.capacity} places taken · website registrations ${d.registrationOpen ? 'open' : 'closed'}</p>
    ${d.placeFree && waiting.length ? `<div class="j-box j-box-green" id="jr-free" style="margin-bottom:12px"><b>${d.placesLeft} place${d.placesLeft === 1 ? ' is' : 's are'} free.</b> ${esc(waiting[0].player.name)} is next on the waitlist.</div>` : ''}
    <div class="ps-tools" role="search">
      ${psSearch('jrq-q', 'Search requests…', RQ.q, 'Search child, parent, email or mobile')}
      ${psSelect('jrq-stage', Object.entries(stage).map(([id, [, label]]) => ({ id, label })), RQ.stage, 'Stage')}
      ${psSelect('jrq-why', [{ id: 'full', label: 'The class was full' }, { id: 'closed', label: 'Registrations were closed' }], RQ.why, 'Why they asked')}
      ${psToolsMore('jrq', { active, hasMore: false })}
      <span class="ps-meta"><button type="button" class="ps-link" id="jrq-refresh">Refresh</button></span>
    </div>
    <div class="ps-chips" id="jrq-chips" aria-label="Quick filters">${RQ_STATUS.map(([k, l, col]) => `<button type="button" class="ps-chip" data-rqchip="${k}" aria-pressed="${RQ.status === k}"><i style="background:${CHIP_COLOR[col]}"></i>${esc(l)} <b>${d.list.filter((r) => r.status === k).length}</b></button>`).join('')}</div>
    <div class="ps-table-wrap"><table class="ps-table ps-flat jr-ps"><thead><tr><th>Child</th><th>Contact</th><th>Stage</th><th class="ps-end"><span class="sr-only">Actions</span></th></tr></thead>
      <tbody id="jrq-rows">${shown.map(row).join('') || `<tr><td colspan="4"><div class="ps-empty">${all.length ? `No requests match.${active ? ' <button type="button" class="ps-link" data-jrq-clear>Clear filters</button>' : ''}` : 'Nobody waiting. Requests show here when the class is full or registrations are closed.'}</div></td></tr>`}</tbody></table></div>
  </div>`
  if (keep) window.scrollTo(0, y)
  const v = ui.view()
  const redraw = () => renderRequests(ui, true)
  v.querySelector('#jrq-q').addEventListener('input', (e) => { RQ.q = e.target.value; const at = e.target.selectionStart; redraw(); const i = ui.view().querySelector('#jrq-q'); i.focus(); i.setSelectionRange(at, at) })
  v.querySelector('#jrq-stage').addEventListener('change', (e) => { RQ.stage = e.target.value; redraw() })
  v.querySelector('#jrq-why').addEventListener('change', (e) => { RQ.why = e.target.value; redraw() })
  v.querySelectorAll('[data-rqchip]').forEach((b) => b.addEventListener('click', () => { RQ.status = RQ.status === b.dataset.rqchip ? '' : b.dataset.rqchip; redraw() }))
  const clear = () => { Object.assign(RQ, { q: '', status: '', stage: '', why: '' }); redraw() }
  v.querySelector('#jrq-clear')?.addEventListener('click', clear)
  v.querySelector('[data-jrq-clear]')?.addEventListener('click', clear)
  v.querySelector('#jrq-refresh').addEventListener('click', () => renderRequests(ui))
  const decide = async (body) => {
    const r = await ui.post('jjDecideRequest', body)
    if (r.status === 409 && r.data.code === 'full') { if (await ui.confirmBox(esc(r.data.error), { ok: 'Accept anyway' })) return decide({ ...body, force: true }); return null }
    if (!r.ok) { toast(r.data.error || 'Could not save that.'); return null }
    return r.data
  }
  v.querySelectorAll('[data-accept]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true
    const x = await decide({ id: b.dataset.accept, decision: 'accept' })
    if (!x) { b.disabled = false; return }
    forgetJuniors(); S.data = null
    toast('Accepted. The child is in the class (Unpaid).')
    await renderRequests(ui)
    inviteOne(ui, x.email, () => renderRequests(ui))
  }))
  v.querySelectorAll('[data-decline]').forEach((b) => b.addEventListener('click', () => {
    const box = ui.modal(`<h2 style="margin-bottom:4px">Decline</h2><p class="muted small" style="margin-bottom:12px">The request is marked declined. No email is sent: call or email the family yourself if you want to.</p>
      <label class="j-field"><span>Why <span class="muted">(optional, staff only)</span></span><input class="j-input" id="jr-why" maxlength="200"></label>
      <div class="jj-actions"><button type="button" class="j-btn j-btn-line" data-close>Cancel</button><button type="button" class="j-btn j-btn-danger" id="jr-no">Decline</button></div>`)
    saveBtn(box, '#jr-no', async () => { if (await decide({ id: b.dataset.decline, decision: 'decline', reason: box.querySelector('#jr-why').value.trim() })) { ui.closeModal(); toast('Declined.'); renderRequests(ui) } })
  }))
  v.querySelectorAll('[data-wait]').forEach((b) => b.addEventListener('click', async () => { if (await decide({ id: b.dataset.wait, decision: 'wait' })) { toast('Back on the waitlist.'); renderRequests(ui) } }))
  v.querySelectorAll('[data-invite]').forEach((b) => b.addEventListener('click', () => inviteOne(ui, b.dataset.invite, () => renderRequests(ui))))
}

// The "sign in and pay" email for one family: preview first, then Send.
async function inviteOne(ui, email, after = () => {}) {
  const r = await ui.post('jjInvites', { kind: 'new', previewEmail: email })
  if (!r.ok) return toast(r.data.error || 'Could not make the email.')
  IV.kind = 'new'; IV.data = null
  const f = r.data.list.find((x) => x.email === email)
  if (!f) return toast('That family is not in the class yet. Refresh and try again.')
  const box = ui.modal(`<h2 style="margin-bottom:4px">Send the invite to pay?</h2><p class="muted small" style="margin-bottom:10px">${esc(f.parent || email)} gets this email. ${f.owingCents ? `It has a payment link for ${esc(money(f.owingCents))}.` : 'Nothing is owing.'} Nothing is sent until you press Send.</p>${previewHtml(r.data.previews)}
    <div class="jj-actions"><button type="button" class="j-btn j-btn-line" data-close>Not now</button><button type="button" class="j-btn j-btn-dark" id="ji-send">Send</button></div>`, { wide: true })
  saveBtn(box, '#ji-send', async () => {
    const x = await ui.post('jjInvites', { kind: 'new', send: true, emails: [email], resend: Boolean(f.sentAt) })
    ui.closeModal()
    toast(x.ok && x.data.sent.length ? 'Sent.' : (x.data.failed?.[0]?.error || x.data.skipped?.[0]?.why || x.data.error || 'Not sent.'), 6000)
    after()
  })
}
