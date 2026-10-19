// Player reports in the staff portal (Lee, 18 Oct 2026). The same card as
// /coach-report/: pick a player, rate them, write the feedback, then Send.
// Sending saves it in the family's account (Player reports tab) and emails
// the parent, and the player if they have their own login, with the PDF.
// A coach only sees players in their own groups; Lee and Ligia see everyone.
// Every change saves as a draft on the server, with a copy on this device so
// nothing typed is lost if the page closes.
import { esc } from './jfp-common.js'
import { psHelp } from './jfp-portal-ps.js'
import { savePdfOnDevice, reportCardHtml, reportDate as dateLabel } from './jfp-report-view.js'

const S = { tab: 'write', q: '', data: null }
const LOCAL = 'jfpReportDraft.portal.v1'
const first = (s) => String(s || '').trim().split(/\s+/)[0] || ''
const ROLE = { parent: 'Parent', player: 'Player', 'player login': 'Player (own login)' }

// ---------- this device's copy of a draft ----------
function localAll() { try { return JSON.parse(localStorage.getItem(LOCAL) || '{}') || {} } catch { return {} } }
function localGet(rowId) { return localAll()[rowId] || null }
function localPut(rowId, entry) { try { const all = localAll(); if (entry) all[rowId] = entry; else delete all[rowId]; localStorage.setItem(LOCAL, JSON.stringify(all)) } catch { /* private mode */ } }

export async function renderReports(ui) {
  const { view, post, need } = ui
  const d = S.data = await need(await post('reportHome', {}))
  const drafts = d.reports.filter((r) => r.status === 'draft')
  const sent = d.reports.filter((r) => r.status !== 'draft')
  const notDone = d.players.filter((p) => !p.sentAt).length
  view().innerHTML = `<div class="jp-head"><div><h1>Player reports</h1>
      <p class="muted small" style="margin-top:2px">${esc(d.term)} · ${d.isAdmin ? 'every JFP player' : 'the players in your groups'} ${psHelp('Pick a player, rate them and write your feedback. It saves as you go. When you press Send, the report goes into the family\'s account under Player reports and they get an email with the PDF. A player with their own login gets it too. Nobody else.')}</p></div></div>
    <div class="j-chips" style="margin:10px 0 14px" id="rp-tabs">
      <button type="button" class="j-chip" data-tab="write" aria-pressed="${S.tab === 'write'}">Players${notDone ? ` (${notDone} to do)` : ''}</button>
      <button type="button" class="j-chip" data-tab="drafts" aria-pressed="${S.tab === 'drafts'}">Drafts${drafts.length ? ` (${drafts.length})` : ''}</button>
      <button type="button" class="j-chip" data-tab="sent" aria-pressed="${S.tab === 'sent'}">Sent${sent.length ? ` (${sent.length})` : ''}</button>
    </div>
    <div id="rp-body"></div>`
  view().querySelector('#rp-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]'); if (!b) return
    S.tab = b.dataset.tab
    view().querySelectorAll('#rp-tabs [data-tab]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.tab === S.tab)))
    drawBody(ui)
  })
  drawBody(ui)
}

function drawBody(ui) {
  const { view } = ui
  const d = S.data
  const body = view().querySelector('#rp-body')
  if (S.tab === 'write') {
    const q = S.q.trim().toLowerCase()
    const list = d.players.filter((p) => !q || p.name.toLowerCase().includes(q) || p.session.toLowerCase().includes(q))
    const bySession = new Map()
    for (const p of list) (bySession.get(p.session) || bySession.set(p.session, []).get(p.session)).push(p)
    body.innerHTML = `<label class="j-field" style="max-width:420px"><span class="sr-only">Find a player</span><input class="j-input" id="rp-q" type="search" placeholder="Find a player or session" value="${esc(S.q)}" autocomplete="off"></label>
      ${d.players.length ? '' : `<p class="muted">${d.isAdmin ? 'No JFP players this term yet.' : 'You have no players in your groups this term. If that is wrong, ask Lee or Ligia.'}</p>`}
      ${[...bySession].map(([session, ps]) => `<section class="j-card" style="padding:12px 14px;margin-bottom:12px">
        <h3 style="font-size:15px;margin-bottom:6px">${esc(session)}${d.isAdmin && ps[0].coach ? ` <span class="muted small">· ${esc(ps[0].coach)}</span>` : ''}</h3>
        ${ps.map((p) => `<div class="jp-player" style="cursor:default;gap:8px;flex-wrap:wrap">
          <span class="nm"><b>${esc(p.name)}</b>${p.age != null ? ` <span class="muted">(${esc(p.age)})</span>` : ''}${p.trial ? ' <span class="j-pill j-pill-blue">Trial</span>' : ''}<br>
            <span class="small">${p.sentAt ? `<span class="j-pill j-pill-green">Sent ${esc(dateLabel(p.sentAt))}</span>` : p.draftId ? `<span class="j-pill j-pill-amber">Draft${p.draftBy ? ` by ${esc(p.draftBy)}` : ''}</span>` : '<span class="j-pill j-pill-grey">Not started</span>'}</span></span>
          <span style="display:flex;gap:6px">${p.sentId ? `<button type="button" class="j-btn j-btn-line j-btn-sm" data-rp-view="${esc(p.sentId)}">View</button>` : ''}
            <button type="button" class="j-btn ${p.sentAt ? 'j-btn-line' : 'j-btn-dark'} j-btn-sm" data-rp-write="${esc(p.rowId)}">${p.draftId && !p.draftBy ? 'Carry on' : p.sentAt ? 'New report' : 'Write report'}</button></span>
        </div>`).join('')}</section>`).join('')}
      ${q && !list.length ? '<p class="muted">No player matches that.</p>' : ''}`
    const qi = body.querySelector('#rp-q')
    qi.addEventListener('input', () => { S.q = qi.value; const pos = qi.selectionStart; drawBody(ui); const n = view().querySelector('#rp-q'); n.focus(); n.setSelectionRange(pos, pos) })
  } else {
    const list = d.reports.filter((r) => (S.tab === 'drafts' ? r.status === 'draft' : r.status !== 'draft'))
    body.innerHTML = list.length ? list.map((r) => reportRow(r, d.isAdmin)).join('') : `<p class="muted">${S.tab === 'drafts' ? 'No drafts. A report you start saves here until you send it.' : 'No reports sent yet.'}</p>`
  }
  body.onclick = async (e) => {
    const w = e.target.closest('[data-rp-write]'); if (w) return openEditor(ui, w.dataset.rpWrite)
    const v = e.target.closest('[data-rp-view]'); if (v) return openSent(ui, v.dataset.rpView)
    const c = e.target.closest('[data-rp-edit]'); if (c) return openEditor(ui, c.dataset.rpEdit)
    const del = e.target.closest('[data-rp-del]'); if (del) return deleteDraft(ui, del.dataset.rpDel)
    const wd = e.target.closest('[data-rp-withdraw]'); if (wd) return withdraw(ui, wd.dataset.rpWithdraw, wd.dataset.on === '1')
  }
}

function reportRow(r, isAdmin) {
  const status = r.status === 'draft' ? '<span class="j-pill j-pill-amber">Draft</span>' : r.status === 'withdrawn' ? '<span class="j-pill j-pill-grey">Taken out of the account</span>' : `<span class="j-pill j-pill-green">Sent ${esc(dateLabel(r.sentAt))}</span>`
  const who = r.status === 'draft' ? `Started by ${esc(r.mine ? 'you' : r.createdByName || 'a coach')}${r.updatedAt ? `, saved ${esc(dateLabel(r.updatedAt))}` : ''}` : `Sent by ${esc(r.sentByName || r.createdByName || 'staff')}`
  const failed = (r.recipients || []).filter((x) => x.status === 'failed').length
  const held = (r.recipients || []).filter((x) => x.status === 'held').length
  return `<div class="j-card" style="padding:12px 14px;margin-bottom:10px;display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center">
    <div><b>${esc(r.player)}</b> ${status}<br><span class="small muted">Term ${esc(r.termNo)} ${esc(r.year)} · ${esc(r.session || '')} · ${who}${r.overall != null ? ` · Overall ${esc(r.overall)}` : ''}</span>
      ${failed ? `<br><span class="small" style="color:var(--j-red)">The email to ${failed} ${failed === 1 ? 'person' : 'people'} did not go. The report is still in their account.</span>` : ''}
      ${held ? `<br><span class="small muted">The email is waiting for Lee to approve it.</span>` : ''}</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap">${r.status === 'draft'
      ? `${r.mine || isAdmin ? `<button type="button" class="j-btn j-btn-dark j-btn-sm" data-rp-edit="${esc(r.rowId)}">Carry on</button><button type="button" class="j-btn j-btn-ghost j-btn-sm" data-rp-del="${esc(r.id)}">Delete</button>` : ''}`
      : `<button type="button" class="j-btn j-btn-line j-btn-sm" data-rp-view="${esc(r.id)}">View</button>${isAdmin ? `<button type="button" class="j-btn j-btn-ghost j-btn-sm" data-rp-withdraw="${esc(r.id)}" data-on="${r.status === 'withdrawn' ? '0' : '1'}">${r.status === 'withdrawn' ? 'Put back in the account' : 'Take out of the account'}</button>` : ''}`}</div>
  </div>`
}

async function deleteDraft(ui, id) {
  const { post, confirmBox, toast } = ui
  const r = S.data.reports.find((x) => x.id === id)
  if (!(await confirmBox(`Delete the draft report for <b>${esc(r?.player || 'this player')}</b>? It has not been sent.`, { ok: 'Delete draft', danger: true }))) return
  const out = await post('reportDelete', { id })
  if (!out.ok) return toast(out.data.error || 'Could not delete it.')
  if (r) localPut(r.rowId, null)
  toast('Draft deleted.'); renderReports(ui)
}

async function withdraw(ui, id, on) {
  const { post, confirmBox, toast } = ui
  const r = S.data.reports.find((x) => x.id === id)
  const msg = on ? `Take <b>${esc(r?.player || 'this')}'s</b> report out of the family's account? The email they already got cannot be taken back. The report stays on file here.` : `Put <b>${esc(r?.player || 'this')}'s</b> report back in the family's account? No email is sent.`
  if (!(await confirmBox(msg, { ok: on ? 'Take it out' : 'Put it back', danger: on }))) return
  const out = await post('reportWithdraw', { id, on })
  if (!out.ok) return toast(out.data.error || 'Could not change it.')
  toast(on ? 'Taken out of the family account.' : 'Back in the family account.'); renderReports(ui)
}

// ---------- the report card: read only (sent) ----------
async function openSent(ui, id) {
  const { post, modal, toast } = ui
  const out = await post('reportGet', { id })
  if (!out.ok) return toast(out.data.error || 'Could not open that report.')
  const r = out.data.report
  const recips = (r.recipients || []).map((x) => `<li><span><b>${esc(ROLE[x.role] || x.role)}</b>${x.name ? ` · ${esc(x.name)}` : ''}<small>${esc(x.email)}</small></span><span>${x.status === 'sent' ? '<span class="j-pill j-pill-green">Emailed</span>' : x.status === 'held' ? '<span class="j-pill j-pill-amber">Waiting for Lee</span>' : x.status === 'failed' ? `<span class="j-pill j-pill-red">Did not go</span>${x.error ? `<small>${esc(x.error)}</small>` : ''}` : ''}</span></li>`).join('')
  const box = modal(`<h2 style="margin-bottom:2px">${esc(r.player)}: Term ${esc(r.termNo)} ${esc(r.year)} report</h2>
    <p class="muted small" style="margin-bottom:12px">${r.status === 'withdrawn' ? 'Taken out of the family account.' : `Sent ${esc(dateLabel(r.sentAt))} by ${esc(r.sentByName || 'staff')}. It is in the family's account under Player reports.`}</p>
    ${reportCardHtml(r, S.data.form)}
    ${recips ? `<h3 style="font-size:15px;margin:14px 0 6px">Who it went to</h3><ul class="jm-hist">${recips}</ul>` : ''}
    <p class="j-err" id="rp-err" hidden></p><div id="rp-tap"></div>
    <div class="jp-modal-foot" style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap"><button type="button" class="j-btn j-btn-line" data-close>Close</button><button type="button" class="j-btn j-btn-dark" id="rp-pdf">Save PDF to this device</button></div>`, { wide: true })
  wirePdfButton(ui, box, () => id)
}

function wirePdfButton(ui, box, getId, before) {
  const btn = box.querySelector('#rp-pdf')
  btn.addEventListener('click', async () => {
    const err = box.querySelector('#rp-err'); err.hidden = true
    btn.disabled = true; const label = btn.textContent; btn.textContent = 'Making the PDF...'
    try {
      if (before) { const ok = await before(); if (!ok) return }
      const out = await ui.post('reportPdf', { id: getId() })
      if (!out.ok) { err.textContent = out.data.error || 'The PDF could not be made.'; err.hidden = false; return }
      const how = await savePdfOnDevice(out.data, {
        onNeedTap: (go) => {
          const tap = box.querySelector('#rp-tap')
          tap.innerHTML = '<button type="button" class="j-btn j-btn-dark" style="width:100%;margin-top:10px">The PDF is ready: tap to save it</button>'
          tap.querySelector('button').addEventListener('click', () => { go(); tap.innerHTML = '' }, { once: true })
        },
      })
      if (how === 'saved') ui.toast('PDF saved. Look in your Downloads.')
    } finally { btn.disabled = false; btn.textContent = label }
  })
}

// ---------- the report card: writing it ----------
async function openEditor(ui, rowId) {
  const { post, modal, toast } = ui
  const out = await post('reportStart', { rowId })
  if (!out.ok) return toast(out.data.error || 'Could not open that player.')
  const form = S.data?.form || (await ui.need(await post('reportHome', {}))).form
  const rep = out.data.report
  const st = {
    id: rep.id || '', rowId, player: rep.player, dirty: false, saving: null, timer: 0, sending: false,
    f: { program: rep.program, termNo: rep.termNo, year: rep.year, reportDate: rep.reportDate, location: rep.location, coachName: rep.coachName, ratings: { ...rep.ratings }, feedback: rep.feedback || '', reminder: rep.reminder || '' },
  }
  // What was typed on this device and never reached the server comes back.
  const local = localGet(rowId)
  let restored = false
  if (local && !local.synced && (local.id || '') === st.id && (!rep.updatedAt || local.at > rep.updatedAt)) {
    st.f = { ...st.f, ...local.f, ratings: { ...st.f.ratings, ...(local.f?.ratings || {}) } }; restored = true; st.dirty = true
  }
  const f = st.f
  const sel = (id, list, v) => `<select class="j-select" id="${id}">${list.map((x) => `<option ${String(x) === String(v) ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>`
  const box = modal(`<div id="rp-edit">
    <h2 style="margin-bottom:2px">${esc(st.player)}</h2>
    <p class="muted small" style="margin-bottom:10px">${esc(rep.session || '')} · <span id="rp-saved">${st.id ? 'Saved as a draft' : 'Not saved yet'}</span></p>
    ${restored ? '<p class="j-box j-box-amber small" style="margin-bottom:10px">Brought back what you typed on this device last time.</p>' : ''}
    ${out.data.resumed && rep.mine === false ? `<p class="j-box j-box-grey small" style="margin-bottom:10px">Started by ${esc(rep.createdByName || 'a coach')}.</p>` : ''}
    <div class="j-two"><label class="j-field"><span>Program</span>${sel('rp-program', form.programs, f.program)}</label>
      <label class="j-field"><span>Term</span>${sel('rp-term', ['1', '2', '3', '4'], f.termNo)}</label></div>
    <div class="j-two"><label class="j-field"><span>Year</span><input class="j-input" id="rp-year" inputmode="numeric" maxlength="4" value="${esc(f.year)}"></label>
      <label class="j-field"><span>Report date</span><input class="j-input" id="rp-date" type="date" value="${esc(f.reportDate)}"></label></div>
    <div class="j-two"><label class="j-field"><span>Location</span><input class="j-input" id="rp-loc" maxlength="60" value="${esc(f.location)}"></label>
      <label class="j-field"><span>Coach</span><input class="j-input" id="rp-coach" maxlength="60" value="${esc(f.coachName)}"></label></div>
    <h3 style="font-size:15px;margin:10px 0 2px">Ratings</h3>
    <p class="muted small" style="margin-bottom:8px">${form.scale.map((s, i) => `${i + 1} ${esc(s)}`).join(' · ')}. Tap again to clear.</p>
    <div class="rp-rates" id="rp-rates">${form.attrs.map((a) => `<div class="rp-rate-in" data-k="${esc(a.k)}"><span>${esc(a.l)}</span><span class="rp-dots">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-n="${n}" aria-label="${esc(a.l)}: ${n}, ${esc(form.scale[n - 1])}" aria-pressed="${(f.ratings[a.k] || 0) === n}">${n}</button>`).join('')}</span></div>`).join('')}</div>
    <label class="j-field" style="margin-top:12px"><span style="display:flex;justify-content:space-between;gap:8px;align-items:center">Coach feedback <span style="display:flex;gap:8px;align-items:center"><button type="button" class="j-btn j-btn-line j-btn-sm" id="rp-mic" hidden>Speak</button><small class="muted" id="rp-count"></small></span></span>
      <textarea class="j-textarea" id="rp-fb" rows="8" maxlength="${form.feedbackMax}" placeholder="What ${esc(first(st.player))} did well, what to work on next, and how">${esc(f.feedback)}</textarea></label>
    <label class="j-field"><span>Next term reminder <span class="muted">(optional)</span></span>
      <textarea class="j-textarea" id="rp-next" rows="3" maxlength="${form.reminderMax}" placeholder="For example, Term 1 starts the week of 2 February. Keep your spot in My account.">${esc(f.reminder)}</textarea></label>
    <p class="j-err" id="rp-err" hidden></p><div id="rp-tap"></div>
    <div class="jp-modal-foot" style="display:flex;gap:8px;justify-content:space-between;flex-wrap:wrap">
      <button type="button" class="j-btn j-btn-ghost" data-close>Close</button>
      <span style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="j-btn j-btn-line" id="rp-pdf">Save PDF to this device</button><button type="button" class="j-btn j-btn-dark" id="rp-next-step">Check and send</button></span>
    </div></div>
    <div id="rp-confirm" hidden></div>`, { wide: true })

  const $ = (s) => box.querySelector(s)
  const count = () => { $('#rp-count').textContent = `${f.feedback.length} / ${form.feedbackMax}` }
  count()
  const backup = () => localPut(rowId, { id: st.id, f, at: new Date().toISOString(), synced: false })
  const changed = () => { st.dirty = true; backup(); $('#rp-saved').textContent = 'Saving...'; clearTimeout(st.timer); st.timer = setTimeout(() => save(), 1200) }
  async function save() {
    clearTimeout(st.timer)
    if (st.saving) await st.saving
    if (!st.dirty) return true
    st.dirty = false
    st.saving = (async () => {
      const r = await post('reportSave', { id: st.id, rowId, fields: f })
      if (!r.ok) {
        st.dirty = true
        if (box.isConnected) { $('#rp-saved').textContent = 'Not saved'; const err = $('#rp-err'); err.textContent = r.data.error || 'Could not save. What you typed is kept on this device.'; err.hidden = false }
        return false
      }
      st.id = r.data.report.id
      if (!st.dirty) localPut(rowId, { id: st.id, f, at: r.data.report.updatedAt || new Date().toISOString(), synced: true })
      if (box.isConnected) { $('#rp-saved').textContent = 'Saved as a draft'; $('#rp-err').hidden = true }
      return true
    })()
    const ok = await st.saving
    st.saving = null
    return ok
  }
  // Closing the window (or the page) saves whatever is waiting.
  const flush = () => { if (st.dirty) save() }
  const watch = new MutationObserver(() => { if (!box.isConnected) { watch.disconnect(); flush(); setTimeout(() => { if (ui.view().querySelector('#rp-tabs')) renderReports(ui).catch(() => {}) }, 400) } })
  watch.observe(box.parentNode, { childList: true })
  window.addEventListener('pagehide', flush, { once: true })

  const bindText = (sel, key, after) => $(sel).addEventListener('input', (e) => { f[key] = e.target.value; after?.(); changed() })
  bindText('#rp-year', 'year'); bindText('#rp-date', 'reportDate'); bindText('#rp-loc', 'location'); bindText('#rp-coach', 'coachName')
  bindText('#rp-fb', 'feedback', count); bindText('#rp-next', 'reminder')
  $('#rp-program').addEventListener('change', (e) => { f.program = e.target.value; changed() })
  $('#rp-term').addEventListener('change', (e) => { f.termNo = e.target.value; changed() })
  $('#rp-rates').addEventListener('click', (e) => {
    const b = e.target.closest('[data-n]'); if (!b) return
    const row = b.closest('[data-k]'); const k = row.dataset.k; const n = Number(b.dataset.n)
    f.ratings[k] = f.ratings[k] === n ? 0 : n
    row.querySelectorAll('[data-n]').forEach((x) => x.setAttribute('aria-pressed', String(Number(x.dataset.n) === f.ratings[k])))
    changed()
  })
  mic($('#rp-mic'), $('#rp-fb'), (text) => { f.feedback = text.slice(0, form.feedbackMax); $('#rp-fb').value = f.feedback; count(); changed() })

  const needSaved = async () => {
    const err = $('#rp-err'); err.hidden = true
    if (!st.id || st.dirty || st.saving) { st.dirty = true; if (!(await save())) return false }
    return true
  }
  wirePdfButton(ui, box, () => st.id, needSaved)

  $('#rp-next-step').addEventListener('click', async (e) => {
    const err = $('#rp-err'); err.hidden = true
    const scoredN = form.attrs.filter((a) => f.ratings[a.k] > 0).length
    if (!scoredN && !f.feedback.trim()) { err.textContent = 'Add some ratings or feedback first.'; err.hidden = false; return }
    const btn = e.currentTarget; btn.disabled = true
    try {
      if (!(await needSaved())) return
      const r = await post('reportRecipients', { id: st.id })
      if (!r.ok) { err.textContent = r.data.error || 'Could not check who it goes to.'; err.hidden = false; return }
      showConfirm(r.data.recipients, scoredN)
    } finally { btn.disabled = false }
  })

  function showConfirm(recipients, scoredN, note = '') {
    const c = $('#rp-confirm')
    $('#rp-edit').hidden = true; c.hidden = false
    const missing = form.attrs.length - scoredN
    c.innerHTML = `<h2 style="margin-bottom:2px">Send ${esc(first(st.player))}'s report?</h2>
      <p class="muted small" style="margin-bottom:12px">${esc(st.player)} · ${esc(f.program)} · Term ${esc(f.termNo)} ${esc(f.year)}</p>
      ${note ? `<p class="j-box j-box-amber small" style="margin-bottom:10px">${esc(note)}</p>` : ''}
      ${recipients.length ? `<p style="margin-bottom:6px"><b>It goes to:</b></p><ul class="jm-hist" style="margin-bottom:10px">${recipients.map((x) => `<li><span><b>${esc(ROLE[x.role] || x.role)}</b>${x.name ? ` · ${esc(x.name)}` : ''}<small>${esc(x.email)}</small></span></li>`).join('')}</ul>
        <p class="small muted" style="margin-bottom:10px">They get an email with the PDF, and it saves in their account under Player reports. Nobody else gets it.</p>`
        : `<p class="j-box j-box-red small" style="margin-bottom:10px">${esc(st.player)} has no email on file, so the report cannot be sent yet. Lee or Ligia can add one in Players. Your draft is saved.</p>`}
      ${missing ? `<p class="small" style="margin-bottom:10px">${missing} of ${form.attrs.length} ratings are blank. They show as "Not rated".</p>` : ''}
      <label class="j-check" style="display:flex;gap:8px;align-items:flex-start;margin-bottom:12px"><input type="checkbox" id="rp-ok" ${recipients.length ? '' : 'disabled'}><span>I have checked this is ${esc(st.player)}'s report and it is ready to send.</span></label>
      <p class="j-err" id="rp-err2" hidden></p>
      <div class="jp-modal-foot" style="display:flex;gap:8px;justify-content:space-between;flex-wrap:wrap"><button type="button" class="j-btn j-btn-line" id="rp-back">Back to the report</button>
        <button type="button" class="j-btn j-btn-dark" id="rp-send" disabled>Send report</button></div>`
    c.querySelector('#rp-back').addEventListener('click', () => { c.hidden = true; $('#rp-edit').hidden = false })
    const ok = c.querySelector('#rp-ok'); const send = c.querySelector('#rp-send')
    ok.addEventListener('change', () => { send.disabled = !ok.checked })
    send.addEventListener('click', () => doSend(recipients, false))
  }

  async function doSend(recipients, again) {
    if (st.sending) return
    st.sending = true
    const c = $('#rp-confirm'); const send = c.querySelector('#rp-send'); const err = c.querySelector('#rp-err2')
    send.disabled = true; send.textContent = 'Sending...'; err.hidden = true
    try {
      if (!(await needSaved())) { err.textContent = 'Could not save the report first, so it was not sent.'; err.hidden = false; return }
      const r = await post('reportSend', { id: st.id, confirm: true, expect: recipients.map((x) => ({ role: x.role, name: x.name })), again })
      if (r.ok) {
        localPut(rowId, null)
        const d = r.data.report.recipients || []
        const failed = d.filter((x) => x.status === 'failed').length
        const held = d.filter((x) => x.status === 'held').length
        S.tab = 'sent'
        ui.closeModal()
        ui.toast(failed ? `Saved in the family's account, but ${failed} email${failed === 1 ? '' : 's'} did not go. See Sent.` : held ? 'Saved in the family\'s account. The email is waiting for Lee to approve it.' : `Sent. It is in ${first(st.player)}'s family account now.`, 6000)
        return
      }
      const code = r.data.code
      if (code === 'again') {
        c.querySelector('#rp-ok').checked = false
        err.innerHTML = `${esc(r.data.error)} <button type="button" class="j-btn j-btn-dark j-btn-sm" id="rp-again" style="margin-left:6px">Yes, send this one too</button>`; err.hidden = false
        c.querySelector('#rp-again').addEventListener('click', () => { st.sending = false; doSend(recipients, true) }, { once: true })
        return
      }
      if (code === 'recipients') { st.sending = false; return showConfirm(r.data.recipients || [], form.attrs.filter((a) => f.ratings[a.k] > 0).length, 'Who it goes to changed just now. Check the list again.') }
      if (code === 'sent') { localPut(rowId, null); ui.closeModal(); ui.toast('This report was already sent.'); return }
      err.textContent = r.data.error || 'It did not send. Try again.'; err.hidden = false
    } finally {
      st.sending = false
      if (box.isConnected && send.isConnected) { send.textContent = 'Send report'; send.disabled = !c.querySelector('#rp-ok')?.checked }
    }
  }
}

// Speak the feedback (where the browser can): adds to what is there.
function mic(btn, area, onText) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition
  if (!SR) return
  btn.hidden = false
  let rec = null
  btn.addEventListener('click', () => {
    if (rec) { rec.stop(); return }
    rec = new SR(); rec.lang = 'en-AU'; rec.continuous = true; rec.interimResults = false
    const start = area.value.replace(/\s+$/, '')
    let said = ''
    rec.onresult = (e) => { for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) said += `${said ? ' ' : ''}${e.results[i][0].transcript.trim()}`; onText(`${start}${start && said ? ' ' : ''}${said}`) }
    rec.onend = () => { rec = null; btn.textContent = 'Speak' }
    rec.onerror = () => { rec = null; btn.textContent = 'Speak' }
    rec.start(); btn.textContent = 'Stop'
  })
}

// From a player's window in My sessions.
export function writeReportFor(ui, rowId) { return openEditor(ui, rowId) }
