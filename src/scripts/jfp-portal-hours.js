// Hours (Lee, 18 Oct 2026). Coaches: "My hours", log what they worked, with
// their own sessions and covers offered as one tap adds. Lee and Ligia:
// "Coach hours", every coach's hours with totals, Approve or Send back, CSV.
// Server: api/_jfp-hours.js.
import { esc, toast } from './jfp-common.js'
import { psHead, psSelect, psBadge, psChips } from './jfp-portal-ps.js'

const S = { range: 'fortnight', coachId: '', status: '' }
const STATUS = { submitted: ['orange', 'Waiting'], approved: ['green', 'Approved'], queried: ['red', 'Sent back'] }
const iso = (d) => d.toISOString().slice(0, 10)
const addDays = (s, n) => iso(new Date(Date.parse(`${s}T00:00:00Z`) + n * 86400000))
const mondayOf = (s) => { const d = new Date(`${s}T00:00:00Z`); return addDays(s, -((d.getUTCDay() + 6) % 7)) }
const hrs = (m) => { const h = Math.floor(m / 60), r = m % 60; return r ? `${h}h ${r}m` : `${h}h` }
const t12 = (hm) => { let [h, m] = hm.split(':').map(Number); const ap = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12; return `${h}${m ? `:${String(m).padStart(2, '0')}` : ''}${ap}` }
function rangeOf(key, today) {
  const mon = mondayOf(today)
  if (key === 'week') return [mon, addDays(mon, 6)]
  if (key === 'lastweek') return [addDays(mon, -7), addDays(mon, -1)]
  if (key === 'month') return [`${today.slice(0, 8)}01`, today]
  if (key === 'lastmonth') { const d = new Date(`${today.slice(0, 8)}01T00:00:00Z`); d.setUTCDate(0); const end = iso(d); return [`${end.slice(0, 8)}01`, end] }
  return [addDays(mon, -7), addDays(mon, 6)]
}
const RANGES = [['fortnight', 'This fortnight'], ['week', 'This week'], ['lastweek', 'Last week'], ['month', 'This month'], ['lastmonth', 'Last month']]

export async function renderHours(ui) {
  const { view, post, need, user } = ui
  const admin = user.role === 'admin'
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date())
  const [from, to] = rangeOf(S.range, today)
  const d = await need(await post('hoursList', { from, to, coachId: admin ? S.coachId : '' }))
  const draw = () => {
    const list = d.entries.filter((h) => !S.status || h.status === S.status)
    const waiting = d.entries.filter((h) => h.status === 'submitted')
    const total = d.entries.reduce((t, h) => t + h.minutes, 0)
    const chips = psChips(Object.entries(STATUS).map(([k, [c, l]]) => ({ key: 'st', value: k, label: l, count: d.entries.filter((h) => h.status === k).length, color: c })), (k, v) => S.status === v)
    view().innerHTML = `${psHead({ title: admin ? 'Coach hours' : 'My hours', count: `${hrs(total)} logged`, primary: `${admin && waiting.length ? `<button type="button" class="j-btn j-btn-line" id="hr-approve-all">Approve ${waiting.length} waiting</button>` : ''}<button type="button" class="j-btn j-btn-dark" id="hr-add">+ Log hours</button>` })}
      <div class="ps-tools">${psSelect('hr-range', RANGES.map(([id, label]) => ({ id, label })), S.range, 'This fortnight', 'Dates').replace('<option value="">This fortnight</option>', '')}${admin ? psSelect('hr-coach', d.coaches, S.coachId, 'All coaches', 'Coach') : ''}<span class="muted small" style="align-self:center">${esc(fmtDay(from))} to ${esc(fmtDay(to))}</span>${admin ? '<button type="button" class="ps-link" id="hr-csv">Download CSV</button>' : ''}</div>
      ${chips}
      ${admin && d.totals.length > 1 ? `<div class="ps-table-wrap" style="margin-bottom:14px"><table class="ps-table ps-flat"><thead><tr><th>Coach</th><th>Total</th><th>Approved</th><th>Waiting</th><th data-col="football">Sent back</th></tr></thead><tbody>${d.totals.map((t) => `<tr data-hr-coach="${esc(t.coachId)}"><td data-col="who"><b>${esc(t.coach)}</b></td><td data-col="pay"><b>${hrs(t.minutes)}</b></td><td data-col="group">${hrs(t.approved)} approved</td><td data-col="flags">${t.waiting ? `${hrs(t.waiting)} waiting` : ''}</td><td data-col="football">${t.queried ? hrs(t.queried) : ''}</td></tr>`).join('')}</tbody></table></div>` : ''}
      ${d.suggest.length ? `<section class="jd-card" style="margin-bottom:14px"><div style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap"><h2 style="font-size:16px;margin:0">${admin && !S.coachId ? 'Your sessions' : 'Sessions'} not logged yet</h2><button type="button" class="j-btn j-btn-dark j-btn-sm" id="hr-add-all">Add all ${d.suggest.length}</button></div>
        <ul class="jd-list" style="margin-top:8px">${d.suggest.map((x, i) => `<li><span><b>${esc(x.dateLabel)}</b> ${esc(t12(x.start))} to ${esc(t12(x.end))} · ${esc(x.label)}${x.kind === 'cover' ? ' <span class="ps-tag">Cover</span>' : ''}</span><button type="button" class="j-btn j-btn-line j-btn-sm" data-hr-sug="${i}">Add</button></li>`).join('')}</ul></section>` : ''}
      <div class="ps-table-wrap"><table class="ps-table ps-flat" id="hr-list"><thead><tr><th>Date</th><th>Hours</th>${admin ? '<th>Coach</th>' : ''}<th data-col="football">What</th><th class="ps-end"><span class="sr-only">Actions</span></th></tr></thead>
      <tbody>${list.map((h) => `<tr data-hr="${esc(h.id)}"><td data-col="who"><b>${esc(h.dateLabel)}</b><span class="ps-sub">${esc(t12(h.start))} to ${esc(t12(h.end))}</span></td>
        <td data-col="pay"><b>${hrs(h.minutes)}</b><span class="ps-sub">${psBadge(...STATUS[h.status])}</span></td>
        ${admin ? `<td data-col="group">${esc(h.coach)}</td>` : ''}
        <td data-col="${admin ? 'flags' : 'group'}">${esc(h.kindLabel)}${h.note ? `<span class="ps-sub">${esc(h.note)}</span>` : ''}${h.status === 'queried' && h.decisionNote ? `<span class="ps-sub" style="color:var(--j-red)">Sent back: ${esc(h.decisionNote)}</span>` : ''}</td>
        <td class="ps-end ps-keep">${admin && h.status !== 'approved' ? `<button type="button" class="j-btn j-btn-dark j-btn-sm" data-hr-ok="${esc(h.id)}">Approve</button> ` : ''}${admin && h.status === 'submitted' ? `<button type="button" class="j-btn j-btn-line j-btn-sm" data-hr-back="${esc(h.id)}">Send back</button> ` : ''}${h.canEdit ? `<button type="button" class="j-btn j-btn-line j-btn-sm" data-hr-edit="${esc(h.id)}">Edit</button>` : ''}</td></tr>`).join('') || `<tr><td colspan="${admin ? 5 : 4}"><div class="ps-empty">No hours logged for these dates.</div></td></tr>`}</tbody></table></div>`
    wire(list)
  }
  const reload = () => renderHours(ui)
  const save = async (body) => { const r = await post('hoursSave', body); if (!r.ok) { toast(r.data.error || 'Could not save.'); return null } return r.data.entry }
  const wire = () => {
    const v = view()
    v.querySelector('#hr-range').addEventListener('change', (e) => { S.range = e.target.value || 'fortnight'; reload() })
    v.querySelector('#hr-coach')?.addEventListener('change', (e) => { S.coachId = e.target.value; reload() })
    v.querySelectorAll('[data-chip]').forEach((b) => b.addEventListener('click', () => { const val = b.dataset.chip.split(':')[1]; S.status = S.status === val ? '' : val; draw() }))
    v.querySelectorAll('[data-hr-coach]').forEach((r) => r.addEventListener('click', () => { S.coachId = r.dataset.hrCoach; reload() }))
    v.querySelector('#hr-add').addEventListener('click', () => entryModal(ui, d, null, reload))
    v.querySelectorAll('[data-hr-edit]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); entryModal(ui, d, d.entries.find((h) => h.id === b.dataset.hrEdit), reload) }))
    v.querySelectorAll('[data-hr-sug]').forEach((b) => b.addEventListener('click', async () => {
      const x = d.suggest[Number(b.dataset.hrSug)]
      b.disabled = true
      if (await save({ date: x.date, start: x.start, end: x.end, kind: x.kind, groupId: x.groupId, coachId: d.suggestFor })) { toast('Added.'); reload() } else b.disabled = false
    }))
    v.querySelector('#hr-add-all')?.addEventListener('click', async (e) => {
      e.currentTarget.disabled = true
      let n = 0
      for (const x of d.suggest) if (await save({ date: x.date, start: x.start, end: x.end, kind: x.kind, groupId: x.groupId, coachId: d.suggestFor })) n++
      toast(`${n} added.`); reload()
    })
    const decide = async (ids, status, note = '') => { const r = await post('hoursDecide', { ids, status, note }); if (!r.ok) return toast(r.data.error || 'Could not save.'); toast(status === 'approved' ? `${r.data.entries.length} approved.` : 'Sent back.'); reload() }
    v.querySelectorAll('[data-hr-ok]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); decide([b.dataset.hrOk], 'approved') }))
    v.querySelector('#hr-approve-all')?.addEventListener('click', () => decide(d.entries.filter((h) => h.status === 'submitted').map((h) => h.id), 'approved'))
    v.querySelectorAll('[data-hr-back]').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation()
      const box = ui.modal(`<h2 style="margin-bottom:10px">Send back</h2><label class="j-field"><span>What needs checking</span><textarea class="j-input" id="hb-note" rows="3" maxlength="300"></textarea></label><div class="jpf-acts"><button type="button" class="j-btn j-btn-line" data-close>Cancel</button><button type="button" class="j-btn j-btn-dark" id="hb-go">Send back</button></div>`)
      box.querySelector('#hb-go').addEventListener('click', () => { const note = box.querySelector('#hb-note').value; ui.closeModal(); decide([b.dataset.hrBack], 'queried', note) })
    }))
    v.querySelector('#hr-csv')?.addEventListener('click', () => {
      const rows = [['Coach', 'Date', 'Start', 'Finish', 'Hours', 'What', 'Note', 'Status'], ...d.entries.slice().reverse().map((h) => [h.coach, h.date, h.start, h.end, (h.minutes / 60).toFixed(2), h.kindLabel, h.note || '', STATUS[h.status][1]])]
      const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
      const a = document.createElement('a')
      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
      a.download = `coach-hours-${from}-to-${to}.csv`
      a.click()
    })
  }
  draw()
}
function fmtDay(s) { return new Intl.DateTimeFormat('en-AU', { timeZone: 'UTC', day: 'numeric', month: 'short' }).format(new Date(`${s}T00:00:00Z`)) }

function entryModal(ui, d, h, reload) {
  const admin = ui.user.role === 'admin'
  const today = d.today
  const box = ui.modal(`<h2 style="margin-bottom:12px">${h ? 'Edit hours' : 'Log hours'}</h2>
    ${admin && !h ? `<label class="j-field"><span>Coach</span><select class="j-select" id="he-coach">${d.coaches.map((c) => `<option value="${esc(c.id)}" ${c.id === (S.coachId || d.myCoachId) ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>` : ''}
    <label class="j-field"><span>Date</span><input class="j-input" type="date" id="he-date" max="${esc(today)}" value="${esc(h?.date || today)}"></label>
    <div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px"><label class="j-field"><span>Start</span><input class="j-input" type="time" id="he-start" step="300" value="${esc(h?.start || '')}"></label><label class="j-field"><span>Finish</span><input class="j-input" type="time" id="he-end" step="300" value="${esc(h?.end || '')}"></label></div>
    <label class="j-field"><span>What for</span><select class="j-select" id="he-kind">${Object.entries(d.kinds).map(([k, l]) => `<option value="${k}" ${(h?.kind || 'session') === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
    <label class="j-field"><span>Note (optional)</span><input class="j-input" id="he-note" maxlength="300" value="${esc(h?.note || '')}"></label>
    <p class="j-err" id="he-err" hidden></p>
    <div class="jpf-acts">${h ? '<button type="button" class="j-btn j-btn-line" id="he-del">Delete</button>' : ''}<button type="button" class="j-btn j-btn-line" data-close>Cancel</button><button type="button" class="j-btn j-btn-dark" id="he-go">Save</button></div>`)
  const err = (m) => { const e = box.querySelector('#he-err'); e.textContent = m; e.hidden = !m }
  box.querySelector('#he-go').addEventListener('click', async (e) => {
    e.currentTarget.disabled = true
    const r = await ui.post('hoursSave', { id: h?.id || '', coachId: box.querySelector('#he-coach')?.value || '', date: box.querySelector('#he-date').value, start: box.querySelector('#he-start').value, end: box.querySelector('#he-end').value, kind: box.querySelector('#he-kind').value, note: box.querySelector('#he-note').value, groupId: h?.groupId || '' })
    e.currentTarget.disabled = false
    if (!r.ok) return err(r.data.error || 'Could not save.')
    ui.closeModal(); toast('Saved.'); reload()
  })
  box.querySelector('#he-del')?.addEventListener('click', async () => {
    if (!(await ui.confirmBox('Delete these hours?', { ok: 'Delete', danger: true }))) return
    const r = await ui.post('hoursDelete', { id: h.id })
    if (!r.ok) return err(r.data.error || 'Could not delete.')
    ui.closeModal(); toast('Deleted.'); reload()
  })
}
