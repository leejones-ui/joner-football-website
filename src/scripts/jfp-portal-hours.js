// Hours (Lee, 18 Oct 2026). Coaches: "My hours", log what they worked, with
// their own sessions and covers offered as one tap adds. 20 Oct 2026 ("it
// needs to be able to add the players they had... click that hour, then the
// players names get entered into the invoice"): each session is a card; tap it
// to tick who you coached (the register's Present and paid-upfront players come
// ticked) and those names go on the invoice line. Lee and Ligia:
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
  const draw = () => (admin ? drawAdmin() : drawCoach())
  const playersLine = (h) => (h.players?.length ? `<span class="hc-players">${h.players.map((p) => `<span class="hc-chip">${esc(p.name)}</span>`).join('')}</span>` : ['session', 'cover', 'devsesh'].includes(h.kind) ? '<span class="hc-none">Tap to tick your players</span>' : '')
  const drawCoach = () => {
    const total = d.entries.reduce((t, h) => t + h.minutes, 0)
    const byDate = (a, b) => b.date.localeCompare(a.date) || a.start.localeCompare(b.start)
    view().innerHTML = `${HC_CSS}${psHead({ title: 'My hours', count: `${hrs(total)} logged`, primary: '<button type="button" class="j-btn j-btn-dark" id="hr-add">+ Other hours</button>' })}
      <div class="ps-tools">${psSelect('hr-range', RANGES.map(([id, label]) => ({ id, label })), S.range, 'This fortnight', 'Dates').replace('<option value="">This fortnight</option>', '')}<span class="muted small" style="align-self:center">${esc(fmtDay(from))} to ${esc(fmtDay(to))}</span></div>
      <p class="muted small" style="margin:0 0 12px">Tap a session to log it and tick the players you coached. Their names go straight onto your invoice.</p>
      ${d.suggest.length ? `<h2 class="hc-h">To log <span class="muted small">${d.suggest.length}</span>${d.suggest.length > 1 ? '<button type="button" class="ps-link" id="hr-add-all">Log all as on the register</button>' : ''}</h2>
        <div class="hc-grid">${d.suggest.slice().sort(byDate).map((x) => `<button type="button" class="hc-card hc-todo" data-hr-sug="${d.suggest.indexOf(x)}"><span class="hc-date">${esc(x.dateLabel)}</span><b>${esc(t12(x.start))} to ${esc(t12(x.end))}</b><span class="hc-what">${esc(x.label)}${x.kind === 'cover' ? ' · Cover' : ''}</span><span class="hc-go">Log it and tick players</span></button>`).join('')}</div>` : ''}
      <h2 class="hc-h">Logged</h2>
      <div class="hc-grid">${d.entries.slice().sort(byDate).map((h) => `<button type="button" class="hc-card" data-hr-edit="${esc(h.id)}" ${h.canEdit ? '' : 'data-locked="1"'}><span class="hc-date">${esc(h.dateLabel)} ${psBadge(...STATUS[h.status])}</span><b>${esc(t12(h.start))} to ${esc(t12(h.end))} · ${hrs(h.minutes)}</b><span class="hc-what">${esc(h.kindLabel)}${h.note ? ` · ${esc(h.note)}` : ''}</span>${playersLine(h)}${h.status === 'queried' && h.decisionNote ? `<span class="hc-none">Sent back: ${esc(h.decisionNote)}</span>` : ''}${h.invoiceId ? '<span class="muted small">On an invoice</span>' : ''}</button>`).join('') || '<div class="ps-empty">Nothing logged for these dates yet.</div>'}</div>`
    const v = view()
    v.querySelector('#hr-range').addEventListener('change', (e) => { S.range = e.target.value || 'fortnight'; reload() })
    v.querySelector('#hr-add').addEventListener('click', () => entryModal(ui, d, null, reload))
    v.querySelectorAll('[data-hr-sug]').forEach((b) => b.addEventListener('click', () => entryModal(ui, d, null, reload, d.suggest[Number(b.dataset.hrSug)])))
    v.querySelectorAll('[data-hr-edit]').forEach((b) => b.addEventListener('click', () => {
      const h = d.entries.find((x) => x.id === b.dataset.hrEdit)
      if (b.dataset.locked) return toast(h.invoiceId ? 'On an invoice. Withdraw the invoice to change it.' : 'Approved. Ask Lee or Ligia to change it.')
      entryModal(ui, d, h, reload)
    }))
    v.querySelector('#hr-add-all')?.addEventListener('click', async (e) => {
      e.currentTarget.disabled = true
      let n = 0
      for (const x of d.suggest) if (await save({ date: x.date, start: x.start, end: x.end, kind: x.kind, groupId: x.groupId, coachId: d.suggestFor })) n++
      toast(`${n} added. Tap any to change the players.`); reload()
    })
  }
  const drawAdmin = () => {
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
        <td data-col="${admin ? 'flags' : 'group'}">${esc(h.kindLabel)}${h.note ? `<span class="ps-sub">${esc(h.note)}</span>` : ''}${h.players?.length ? `<span class="ps-sub">${h.players.length} player${h.players.length === 1 ? '' : 's'}: ${esc(h.players.map((p) => p.name).join(', '))}</span>` : ''}${h.status === 'queried' && h.decisionNote ? `<span class="ps-sub" style="color:var(--j-red)">Sent back: ${esc(h.decisionNote)}</span>` : ''}</td>
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
    v.querySelectorAll('[data-hr-sug]').forEach((b) => b.addEventListener('click', () => entryModal(ui, d, null, reload, d.suggest[Number(b.dataset.hrSug)])))
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

const HC_CSS = `<style>
.hc-h{font-size:15px;margin:22px 0 10px;display:flex;gap:8px;align-items:center}.hc-h .ps-link{margin-left:auto;font-size:13px}
.hc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:10px}
.hc-card{all:unset;box-sizing:border-box;cursor:pointer;color:var(--j-ink);display:flex;flex-direction:column;gap:4px;padding:12px 14px;border:1px solid var(--j-line);border-radius:12px;background:var(--j-surface);min-width:0}
.hc-card:hover,.hc-card:focus-visible{border-color:var(--j-ink);outline:none}
.hc-card[data-locked]{cursor:default;opacity:.85}
.hc-todo{border-style:dashed}
.hc-date{display:flex;justify-content:space-between;gap:6px;align-items:center;font-size:12px;color:var(--j-muted);text-transform:uppercase;letter-spacing:.03em}
.hc-what{font-size:13px;color:var(--j-muted);overflow-wrap:anywhere}
.hc-go{font-size:13px;font-weight:600;color:var(--j-blue);margin-top:2px}
.hc-players{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}
.hc-chip{font:inherit;font-size:12px;color:var(--j-ink);border:0;padding:2px 8px;border-radius:999px;background:var(--j-surface-2)}
.hc-none{font-size:12px;color:var(--j-amber);margin-top:2px}
.hp-list{display:flex;flex-direction:column;gap:2px;max-height:46vh;overflow:auto;margin:6px 0 8px;border:1px solid var(--j-line);border-radius:10px;padding:4px}
.hp-row{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:8px;cursor:pointer}
.hp-row:hover{background:var(--j-surface-2)}
.hp-row input{width:18px;height:18px;flex:none}
.hp-row small{margin-left:auto;color:var(--j-muted);white-space:nowrap}
</style>`
const MARK = { Present: 'Present', Absent: 'Away', Notified: 'Told us away' }
const HQ_CSS = `<style>
.hq{display:flex;flex-direction:column;gap:14px}
.hq-sec>span{display:block;font-size:12.5px;font-weight:650;color:var(--j-muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:.03em}
.hq-row{display:flex;flex-wrap:wrap;gap:6px}
.hq-chip{font:inherit;font-size:14px;line-height:1.2;color:var(--j-ink);background:var(--j-surface-2);border:1px solid var(--j-line);border-radius:999px;padding:9px 14px;cursor:pointer;min-height:40px;text-align:left}
.hq-chip small{display:block;font-size:11.5px;color:var(--j-muted)}
.hq-chip[aria-pressed="true"]{background:var(--j-action);color:var(--j-action-ink);border-color:var(--j-action)}
.hq-chip[aria-pressed="true"] small{color:inherit;opacity:.8}
.hq-chip.hq-dim{opacity:.6}
.hq-players{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:6px;max-height:40vh;overflow:auto}
.hq-players .hq-chip{border-radius:12px}
.hq-time{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px}
</style>`
const DURS = [[30, '30m'], [45, '45m'], [60, '1h'], [90, '1h 30m'], [120, '2h'], [180, '3h']]
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const toMin = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m }
const fromMin = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const dayChip = (iso, today) => (iso === today ? 'Today' : iso === addDays(today, -1) ? 'Yesterday' : new Intl.DateTimeFormat('en-AU', { timeZone: 'UTC', weekday: 'short', day: 'numeric' }).format(new Date(`${iso}T00:00:00Z`)))

// Log or change hours: everything is a tap. Date, what, which session (its
// times fill in), then tap the players (the register's come ticked).
function entryModal(ui, d, h, reload, sug = null) {
  const admin = ui.user.role === 'admin'
  const today = d.today
  const src = h || sug || {}
  const st = { coachId: h?.coachId || (sug ? d.suggestFor : admin ? S.coachId || d.myCoachId : ''), date: src.date || today, kind: src.kind || 'session', groupId: src.groupId || '', start: src.start || '', end: src.end || '', picked: new Set((h?.players || []).filter((p) => p.rowId).map((p) => p.rowId)), typed: (h?.players || []).filter((p) => !p.rowId).map((p) => p.name), touched: Boolean(h?.players), opts: null, list: null, q: '' }
  const box = ui.modal(`${HQ_CSS}<h2 style="margin-bottom:12px">${h ? 'Change hours' : 'Log hours'}</h2><div class="hq" id="hq"></div>
    <p class="j-err" id="he-err" hidden></p>
    <div class="jpf-acts">${h ? '<button type="button" class="j-btn j-btn-line" id="he-del">Delete</button>' : ''}<button type="button" class="j-btn j-btn-line" data-close>Cancel</button><button type="button" class="j-btn j-btn-dark" id="he-go">Save</button></div>`, { wide: true })
  const err = (m) => { const e = box.querySelector('#he-err'); e.textContent = m; e.hidden = !m }
  const chip = (attr, val, label, on, sub = '', dim = false) => `<button type="button" class="hq-chip${dim ? ' hq-dim' : ''}" ${attr}="${esc(val)}" aria-pressed="${on}">${esc(label)}${sub ? `<small>${esc(sub)}</small>` : ''}</button>`
  const usesGroup = () => ['session', 'cover', 'juniors'].includes(st.kind)
  const loadOpts = async () => { const r = await ui.post('hoursOptions', { coachId: st.coachId }); st.opts = r.ok ? r.data : { groups: [], players: [] }; draw() }
  const loadList = async () => {
    st.list = null
    if (!st.groupId) return draw()
    draw()
    const r = await ui.post('hoursPlayers', { groupId: st.groupId, date: st.date })
    st.list = r.ok ? r.data : { players: [], error: r.data.error }
    if (!st.touched) st.picked = new Set(st.list.players.filter((p) => p.ticked).map((p) => p.rowId))
    draw()
  }
  const draw = () => {
    const el = box.querySelector('#hq')
    const dates = Array.from({ length: 8 }, (_, i) => addDays(today, -i))
    const wd = DAYS[new Date(`${st.date}T00:00:00Z`).getUTCDay()]
    const groups = (st.opts?.groups || []).filter((g) => st.kind !== 'juniors' || g.kind === 'juniors').sort((a, b) => Number(b.day === wd) - Number(a.day === wd))
    const dur = st.start && st.end ? toMin(st.end) - toMin(st.start) : 0
    let players = ''
    if (usesGroup() && st.groupId) {
      players = !st.list ? '<p class="muted small">Loading the register…</p>' : st.list.error ? `<p class="j-err">${esc(st.list.error)}</p>` : `${st.list.marked ? '' : '<p class="small" style="color:var(--j-amber);margin-bottom:6px">Register not marked yet. Tap who came.</p>'}<div class="hq-players">${st.list.players.map((p) => chip('data-hq-p', p.rowId, p.full || p.name, st.picked.has(p.rowId), p.mark ? `${MARK[p.mark] || p.mark}${p.mark !== 'Present' && p.paidUpfront ? ', paid' : ''}` : '')).join('') || '<p class="muted small">No players in this group.</p>'}</div>`
    } else if (!usesGroup()) {
      const q = st.q.toLowerCase()
      const all = (st.opts?.players || []).filter((p) => st.picked.has(p.rowId) || !q || p.full.toLowerCase().includes(q))
      players = `<input class="j-input" id="hq-q" placeholder="Search your players" value="${esc(st.q)}" style="margin-bottom:6px"><div class="hq-players">${all.slice(0, 60).map((p) => chip('data-hq-p', p.rowId, p.full, st.picked.has(p.rowId))).join('') || '<p class="muted small">No match. Type the name below.</p>'}</div>`
    } else players = '<p class="muted small">Tap the session above first.</p>'
    el.innerHTML = `${admin && !h ? `<div class="hq-sec"><span>Coach</span><select class="j-select" id="hq-coach">${d.coaches.map((c) => `<option value="${esc(c.id)}" ${c.id === st.coachId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>` : ''}
      <div class="hq-sec"><span>When</span><div class="hq-row">${dates.map((x) => chip('data-hq-date', x, dayChip(x, today), x === st.date)).join('')}<input class="j-input" type="date" id="hq-date" max="${esc(today)}" value="${esc(st.date)}" style="width:auto;min-height:40px"></div></div>
      <div class="hq-sec"><span>What</span><div class="hq-row">${Object.entries(d.kinds).map(([k, l]) => chip('data-hq-kind', k, l, k === st.kind)).join('')}</div></div>
      ${usesGroup() ? `<div class="hq-sec"><span>Which session</span><div class="hq-row">${groups.map((g) => chip('data-hq-g', g.id, `${g.day.slice(0, 3)} ${g.time}`, g.id === st.groupId, g.label.split(', ').slice(1).join(', '), g.day !== wd)).join('') || '<p class="muted small">No sessions of yours found. Use Other.</p>'}</div></div>` : ''}
      <div class="hq-sec"><span>Time</span><div class="hq-time"><label class="j-field" style="margin:0"><span>Start</span><input class="j-input" type="time" id="hq-start" step="300" value="${esc(st.start)}"></label><label class="j-field" style="margin:0"><span>Finish</span><input class="j-input" type="time" id="hq-end" step="300" value="${esc(st.end)}"></label></div>
        <div class="hq-row" style="margin-top:6px">${DURS.map(([m, l]) => chip('data-hq-dur', m, l, dur === m)).join('')}</div></div>
      <div class="hq-sec"><span>Players you coached (${st.picked.size + st.typed.length})</span>${players}
        <div class="hq-row" style="margin-top:6px">${st.typed.map((n, i) => chip('data-hq-x', i, `${n} ✕`, true)).join('')}</div>
        <div style="display:flex;gap:6px;margin-top:6px"><input class="j-input" id="hq-add" maxlength="40" placeholder="Someone else? Type a name"><button type="button" class="j-btn j-btn-line" id="hq-add-go">Add</button></div></div>
      <div class="hq-sec"><span>Note (optional)</span><input class="j-input" id="hq-note" maxlength="300" value="${esc(st.note ?? h?.note ?? '')}"></div>`
    wire(el)
  }
  const wire = (el) => {
    el.querySelector('#hq-coach')?.addEventListener('change', (e) => { st.coachId = e.target.value; st.groupId = ''; st.picked.clear(); loadOpts() })
    el.querySelectorAll('[data-hq-date]').forEach((b) => b.addEventListener('click', () => { st.date = b.dataset.hqDate; if (st.groupId) loadList(); else draw() }))
    el.querySelector('#hq-date').addEventListener('change', (e) => { if (e.target.value) { st.date = e.target.value; if (st.groupId) loadList(); else draw() } })
    el.querySelectorAll('[data-hq-kind]').forEach((b) => b.addEventListener('click', () => { st.kind = b.dataset.hqKind; if (!usesGroup()) { st.groupId = ''; st.list = null } draw() }))
    el.querySelectorAll('[data-hq-g]').forEach((b) => b.addEventListener('click', () => { const g = st.opts.groups.find((x) => x.id === b.dataset.hqG); st.groupId = g.id; if (g.start) { st.start = g.start; st.end = g.end } st.touched = false; loadList() }))
    el.querySelectorAll('[data-hq-dur]').forEach((b) => b.addEventListener('click', () => { if (!st.start) return err('Set the start time first.'); err(''); st.end = fromMin(toMin(st.start) + Number(b.dataset.hqDur)); draw() }))
    el.querySelector('#hq-start').addEventListener('change', (e) => { const keep = st.start && st.end ? toMin(st.end) - toMin(st.start) : 60; st.start = e.target.value; if (st.start) st.end = fromMin(toMin(st.start) + (keep > 0 ? keep : 60)); draw() })
    el.querySelector('#hq-end').addEventListener('change', (e) => { st.end = e.target.value })
    el.querySelectorAll('[data-hq-p]').forEach((b) => b.addEventListener('click', () => { const id = b.dataset.hqP; st.touched = true; if (st.picked.has(id)) st.picked.delete(id); else st.picked.add(id); draw() }))
    el.querySelectorAll('[data-hq-x]').forEach((b) => b.addEventListener('click', () => { st.typed.splice(Number(b.dataset.hqX), 1); draw() }))
    const q = el.querySelector('#hq-q')
    if (q) q.addEventListener('input', (e) => { st.q = e.target.value; const pos = e.target.selectionStart; draw(); const n = box.querySelector('#hq-q'); n.focus(); n.setSelectionRange(pos, pos) })
    const add = () => { const v = el.querySelector('#hq-add').value.trim(); if (v) { st.typed.push(v); st.touched = true; draw() } }
    el.querySelector('#hq-add-go').addEventListener('click', add)
    el.querySelector('#hq-add').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add() } })
    el.querySelector('#hq-note').addEventListener('input', (e) => { st.note = e.target.value })
  }
  box.querySelector('#he-go').addEventListener('click', async (e) => {
    if (usesGroup() && !st.groupId && !h) return err('Tap which session, or choose Other.')
    e.currentTarget.disabled = true
    const players = [...[...st.picked].map((rowId) => ({ rowId })), ...st.typed.map((name) => ({ name }))]
    const r = await ui.post('hoursSave', { id: h?.id || '', coachId: st.coachId, date: st.date, start: st.start, end: st.end, kind: st.kind, note: st.note ?? h?.note ?? '', groupId: usesGroup() ? st.groupId : '', ...(st.touched || st.groupId || players.length ? { players } : {}) })
    e.currentTarget.disabled = false
    if (!r.ok) return err(r.data.error || 'Could not save.')
    ui.closeModal(); toast(players.length ? `Saved with ${players.length} player${players.length === 1 ? '' : 's'}.` : 'Saved.'); reload()
  })
  box.querySelector('#he-del')?.addEventListener('click', async () => {
    if (!(await ui.confirmBox('Delete these hours?', { ok: 'Delete', danger: true }))) return
    const r = await ui.post('hoursDelete', { id: h.id })
    if (!r.ok) return err(r.data.error || 'Could not delete.')
    ui.closeModal(); toast('Deleted.'); reload()
  })
  draw()
  loadOpts()
  if (st.groupId) loadList()
}
