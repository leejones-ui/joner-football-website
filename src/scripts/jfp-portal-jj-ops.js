// Joners Juniors stage 3 in the staff portal: Classes and Registers.
// Lee and Ligia only on these pages; the server checks every action again
// (api/_jj-classes.js, api/_jj-registers.js). Coaches mark their own Juniors
// class in My sessions, the same as JFP.
import { esc, toast } from './jfp-common.js'

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const pill = (c, l) => `<span class="j-pill j-pill-${c}">${esc(l)}</span>`
const saveBtn = (box, sel, fn) => box.querySelector(sel).addEventListener('click', async (e) => {
  const btn = e.currentTarget
  btn.disabled = true
  try { await fn() } finally { if (btn.isConnected) btn.disabled = false }
})

// ---------- classes ----------

const C = { data: null }

export async function renderClasses(ui, fresh = false) {
  const d = (C.data = await ui.need(await ui.post('jjClasses', { fresh })))
  const many = d.classes.length > 1
  const total = d.classes.reduce((t, c) => t + c.capacity, 0), taken = d.classes.reduce((t, c) => t + c.enrolled, 0)
  const card = (c) => `<section class="jd-card jj-class" data-class="${esc(c.id)}">
      <div class="jj-class-h"><div><h2>${esc(c.label)}</h2><p class="sub">${esc(c.location)} · ${c.durationMin} min · ${c.dates.length} class${c.dates.length === 1 ? '' : 'es'}${c.dates.length ? `, ${esc(c.dates[0].label)} to ${esc(c.dates.at(-1).label)}` : ''}</p></div>
        <span class="jj-class-places">${pill(c.enrolled >= c.capacity ? 'red' : 'green', `${c.enrolled} of ${c.capacity}`)}</span></div>
      <dl class="jj-dl" style="margin-top:10px"><dt>Head coach</dt><dd>${c.head ? esc(c.head.name) : '<span class="muted">Not set</span>'}</dd><dt>Shadow coach</dt><dd>${c.shadow ? esc(c.shadow.name) : '<span class="muted">Not set</span>'}</dd>
        <dt>Timetable</dt><dd>${c.timetable.ok ? pill('green', 'In step') : `${pill('amber', c.timetable.problem)} <button type="button" class="link" data-sync>Put it right</button>`}</dd></dl>
      <h3 class="jj-sec">Children</h3>
      ${c.children.length ? `<ul class="jj-kids">${c.children.map((k) => `<li><span><b>${esc(k.name)}</b>${k.age != null ? ` <span class="muted small">(${esc(k.age)})</span>` : ''}</span>${many ? `<button type="button" class="j-btn j-btn-ghost j-btn-sm" data-move="${esc(k.rowId)}" data-name="${esc(k.name)}">Move</button>` : ''}</li>`).join('')}</ul>` : '<p class="muted small">No children in this class yet.</p>'}
      <div class="jj-actions"><button type="button" class="j-btn j-btn-line" data-edit="${esc(c.id)}">Edit the class</button>${many && !c.enrolled ? `<button type="button" class="j-btn j-btn-danger" data-del="${esc(c.id)}">Remove the class</button>` : ''}</div>
    </section>`
  ui.view().innerHTML = `<div class="jj-view">
    <div class="jd-head"><div><h1>Classes</h1><p>Joners Juniors · ${esc(d.term)} · ${d.classes.length} class${many ? 'es' : ''} · ${taken} of ${total} places</p></div>
      <div class="jd-sync"><button type="button" class="j-btn j-btn-line j-btn-sm" id="jc-refresh">Refresh</button><button type="button" class="j-btn j-btn-dark j-btn-sm" id="jc-add">+ Add a class</button></div></div>
    <p class="muted small" style="margin:0 0 10px">Each class is on the timetable as a Joners Juniors group, with its head coach and shadow coach, so coaches see it in My sessions and mark the register. Saving here keeps the timetable in step.</p>
    ${d.unplaced.length ? `<div class="j-box j-box-amber" id="jc-unplaced" style="margin-bottom:12px"><b>${d.unplaced.length} ${d.unplaced.length === 1 ? 'child is' : 'children are'} in no class.</b> Their row's day, time or place matches no class.<ul class="jj-kids" style="margin-top:8px">${d.unplaced.map((k) => `<li><span><b>${esc(k.name)}</b> <span class="muted small">${esc(k.session)}</span></span><button type="button" class="j-btn j-btn-line j-btn-sm" data-move="${esc(k.rowId)}" data-name="${esc(k.name)}">Put in a class</button></li>`).join('')}</ul></div>` : ''}
    <div class="jj-classes">${d.classes.map(card).join('')}</div></div>`
  const v = ui.view()
  v.querySelector('#jc-refresh').addEventListener('click', () => renderClasses(ui, true))
  v.querySelector('#jc-add').addEventListener('click', () => classModal(ui, null))
  v.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => classModal(ui, d.classes.find((c) => c.id === b.dataset.edit))))
  v.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    const c = d.classes.find((x) => x.id === b.dataset.del)
    if (!(await ui.confirmBox(`Remove ${esc(c.label)}? It comes off the timetable too.`, { ok: 'Remove', danger: true }))) return
    await saveAll(ui, d.classes.filter((x) => x.id !== c.id), 'Class removed.')
  }))
  v.querySelectorAll('[data-move]').forEach((b) => b.addEventListener('click', () => moveModal(ui, b.dataset.move, b.dataset.name)))
  v.querySelectorAll('[data-sync]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true
    const r = await ui.post('jjSyncClasses')
    if (!r.ok) { b.disabled = false; return toast(r.data.error || 'Could not change the timetable.') }
    toast(r.data.timetableReport?.problems?.length ? r.data.timetableReport.problems.join(' ') : 'The timetable is in step.', 6000)
    renderClasses(ui)
  }))
}

const plainClass = (c) => ({ id: c.id, day: c.day, time: c.time, endTime: c.endTime, location: c.location, capacity: c.capacity, coachId: c.coachId || '', shadowCoachId: c.shadowCoachId || '' })

async function saveAll(ui, list, message, force = false) {
  const r = await ui.post('jjSaveClasses', { classes: list.map(plainClass), force })
  if (r.status === 409 && r.data.code === 'full') { if (await ui.confirmBox(esc(r.data.error), { ok: 'Save anyway' })) return saveAll(ui, list, message, true); return false }
  if (!r.ok) { toast(r.data.error || 'Could not save.', 7000); return false }
  ui.closeModal()
  const t = r.data.timetableReport || {}
  toast(t.problems?.length ? `${message} ${t.problems.join(' ')}` : `${message}${r.data.rowsWritten ? ` ${r.data.rowsWritten} ${r.data.rowsWritten === 1 ? 'child' : 'children'} updated in Airtable.` : ''} The timetable is in step.`, 6000)
  renderClasses(ui)
  return true
}

function classModal(ui, c) {
  const d = C.data
  const coachOpts = (sel) => `<option value="">Nobody</option>${d.coaches.map((x) => `<option value="${esc(x.id)}" ${x.id === sel ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}`
  const x = c || { day: 'Saturday', time: '', endTime: '', location: d.classes[0]?.location || 'Belrose HQ', capacity: 12, coachId: '', shadowCoachId: '' }
  const box = ui.modal(`<h2 style="margin-bottom:4px">${c ? `Edit ${esc(c.label)}` : 'Add a class'}</h2>
    <p class="muted small" style="margin-bottom:12px">${c && c.enrolled ? `${c.enrolled} ${c.enrolled === 1 ? 'child is' : 'children are'} in this class. A new day, time or place moves them with it in Airtable.` : 'The class goes on the timetable as a Joners Juniors group.'}</p>
    <div class="j-two"><label class="j-field"><span>Day</span><select class="j-select" id="jc-day">${DAYS.map((v) => `<option ${v === x.day ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
    <label class="j-field"><span>Places</span><input class="j-input" id="jc-cap" inputmode="numeric" value="${esc(x.capacity)}"></label></div>
    <div class="j-two"><label class="j-field"><span>Starts</span><input class="j-input" id="jc-time" value="${esc(x.time)}" placeholder="9:15am"></label>
    <label class="j-field"><span>Finishes</span><input class="j-input" id="jc-end" value="${esc(x.endTime)}" placeholder="10:00am"></label></div>
    <label class="j-field"><span>Venue (as the timetable has it)</span><input class="j-input" id="jc-loc" value="${esc(x.location)}"></label>
    <div class="j-two"><label class="j-field"><span>Head coach</span><select class="j-select" id="jc-head">${coachOpts(x.coachId)}</select></label>
    <label class="j-field"><span>Shadow coach</span><select class="j-select" id="jc-shadow">${coachOpts(x.shadowCoachId)}</select></label></div>
    <div class="jj-actions"><button type="button" class="j-btn j-btn-line" data-close>Cancel</button><button type="button" class="j-btn j-btn-dark" id="jc-go">${c ? 'Save' : 'Add the class'}</button></div>`)
  const q = (s) => box.querySelector(s).value.trim()
  saveBtn(box, '#jc-go', async () => {
    const edited = { ...(c ? plainClass(c) : { id: '' }), day: q('#jc-day'), time: q('#jc-time'), endTime: q('#jc-end'), location: q('#jc-loc'), capacity: Number(q('#jc-cap')), coachId: q('#jc-head'), shadowCoachId: q('#jc-shadow') }
    const list = c ? d.classes.map((k) => (k.id === c.id ? edited : k)) : [...d.classes, edited]
    await saveAll(ui, list, c ? 'Saved.' : 'Class added.')
  })
}

function moveModal(ui, rowId, name) {
  const d = C.data
  const box = ui.modal(`<h2 style="margin-bottom:4px">Move ${esc(name)}</h2>
    <p class="muted small" style="margin-bottom:12px">Changes the day, time and place on their Juniors row in Airtable, with a note.</p>
    <fieldset class="jj-radios"><legend>To</legend>${d.classes.map((c, i) => `<label class="j-check"><input type="radio" name="jm-to" value="${esc(c.id)}" ${i === 0 ? 'checked' : ''} ${c.children.some((k) => k.rowId === rowId) ? 'disabled' : ''}> ${esc(c.label)} <span class="muted small">(${c.enrolled} of ${c.capacity})</span></label>`).join('')}</fieldset>
    <label class="j-field"><span>Why <span class="muted">(optional)</span></span><input class="j-input" id="jm-why" maxlength="200"></label>
    <div class="jj-actions"><button type="button" class="j-btn j-btn-line" data-close>Cancel</button><button type="button" class="j-btn j-btn-dark" id="jm-go">Move</button></div>`)
  const pick = box.querySelector('[name="jm-to"]:not(:disabled)')
  if (pick) pick.checked = true
  const send = async (force = false) => {
    const to = box.querySelector('[name="jm-to"]:checked')?.value
    if (!to) return toast('Choose the class.')
    const r = await ui.post('jjMoveChild', { rowId, classId: to, note: box.querySelector('#jm-why').value.trim(), force })
    if (r.status === 409 && r.data.code === 'full') { if (await ui.confirmBox(esc(r.data.error), { ok: 'Move anyway' })) return send(true); return }
    if (!r.ok) return toast(r.data.error || 'Could not move.')
    ui.closeModal()
    toast(`${name} moved. Airtable updated.`)
    renderClasses(ui, true)
  }
  saveBtn(box, '#jm-go', () => send(false))
}

// ---------- registers ----------

const R = { classId: '', date: '' }

export async function renderRegisters(ui) {
  const d = await ui.need(await ui.post('jjRegister', { classId: R.classId, date: R.date }))
  R.classId = d.class.id; R.date = d.date
  const s = d.session
  const at = d.dates.findIndex((x) => x.iso === d.date)
  const row = (k) => `<li class="jj-reg" data-kid="${esc(k.rowId)}"><span class="jj-reg-name"><b>${esc(k.name)}</b>${k.age != null ? ` <span class="muted small">(${esc(k.age)})</span>` : ''}</span>
      <span class="jj-reg-btns" role="group" aria-label="${esc(k.name)}"><button type="button" class="j-btn j-btn-sm" data-mark="Present" aria-pressed="${k.status === 'Present'}">Here</button><button type="button" class="j-btn j-btn-sm" data-mark="Absent" aria-pressed="${k.status === 'Absent'}">Away</button></span></li>`
  const coachSel = (id, sel) => `<select class="j-select" id="${id}"><option value="">Nobody</option>${d.coaches.map((x) => `<option value="${esc(x.id)}" ${x.id === sel ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>`
  ui.view().innerHTML = `<div class="jj-view">
    <div class="jd-head"><div><h1>Registers</h1><p>Joners Juniors · ${esc(d.term)} · ${esc(d.class.label)}</p></div></div>
    ${d.classes.length > 1 ? `<div class="jp-seg" id="jr-classes" style="margin-bottom:10px">${d.classes.map((c) => `<button type="button" data-cls="${esc(c.id)}" aria-pressed="${c.id === d.class.id}">${esc(c.label)}</button>`).join('')}</div>` : ''}
    ${d.class.onTimetable ? '' : '<div class="j-box j-box-amber" style="margin-bottom:10px">This class is not on the timetable yet, so coaches cannot see it in My sessions. Put it right on the Classes page.</div>'}
    <div class="jj-reg-date">
      <button type="button" class="j-btn j-btn-line" id="jr-prev" aria-label="Earlier class" ${at <= 0 ? 'disabled' : ''}>‹</button>
      <select class="j-select" id="jr-date" aria-label="Class date">${d.dates.map((x) => `<option value="${esc(x.iso)}" ${x.iso === d.date ? 'selected' : ''}>Week ${x.week}: ${esc(x.label)}${x.marked ? ' · marked' : ''}</option>`).join('')}</select>
      <button type="button" class="j-btn j-btn-line" id="jr-next" aria-label="Later class" ${at >= d.dates.length - 1 ? 'disabled' : ''}>›</button>
    </div>
    <section class="jd-card" id="jr-coaches" style="margin-top:12px"><h2>Who coached</h2>
      <p class="sub">${s.recorded ? `${s.auto ? 'The class coaches, recorded with the first mark' : `Set by ${esc(s.by)}`}.` : 'The class coaches. Saved with the first mark, or change them here.'} This is what checks the Juniors lines on a coach's invoice.</p>
      ${d.canEditCoaches ? `<div class="j-two" style="margin-top:8px"><label class="j-field"><span>Head coach</span>${coachSel('jr-head', s.head?.id || '')}</label><label class="j-field"><span>Shadow coach</span>${coachSel('jr-shadow', s.shadow?.id || '')}</label></div>
        <div class="jj-actions" style="margin-top:6px"><button type="button" class="j-btn j-btn-line" id="jr-save-coaches">Save who coached</button></div>`
        : `<dl class="jj-dl" style="margin-top:8px"><dt>Head coach</dt><dd>${esc(s.head?.name || 'Not set')}</dd><dt>Shadow coach</dt><dd>${esc(s.shadow?.name || 'Not set')}</dd></dl>`}
    </section>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin:14px 0 8px" id="jr-counts">${pill('green', `${d.counts.present} here`)}${pill('red', `${d.counts.absent} away`)}${pill('grey', `${d.counts.unmarked} not marked`)}</div>
    ${d.children.length ? `<ul class="jj-regs" id="jr-list">${d.children.map(row).join('')}</ul>
      ${d.counts.unmarked ? '<div class="jj-actions"><button type="button" class="j-btn j-btn-line" id="jr-all">Mark the rest here</button></div>' : ''}` : '<div class="j-empty">No children in this class.</div>'}
    ${d.coachTotals ? `<section class="jd-card" id="jr-totals" style="margin-top:16px"><h2>Coach sessions so far</h2><p class="sub">Every class date that ran, by coach. Check these against the Juniors lines on coach invoices.</p>
      ${d.coachTotals.length ? `<ul class="jj-pays">${d.coachTotals.map((t) => `<li><span><b>${esc(t.name)}</b><br><span class="muted small">${t.head.length ? `Head: ${esc(t.head.map((x) => x.label).join(', '))}` : ''}${t.head.length && t.shadow.length ? '<br>' : ''}${t.shadow.length ? `Shadow: ${esc(t.shadow.map((x) => x.label).join(', '))}` : ''}</span></span><span>${pill('blue', `${t.head.length} head`)}${pill('violet', `${t.shadow.length} shadow`)}</span></li>`).join('')}</ul>` : '<p class="muted small">No registers yet.</p>'}</section>` : ''}
  </div>`
  const v = ui.view()
  v.querySelectorAll('#jr-classes [data-cls]').forEach((b) => b.addEventListener('click', () => { R.classId = b.dataset.cls; R.date = ''; renderRegisters(ui) }))
  v.querySelector('#jr-date').addEventListener('change', (e) => { R.date = e.target.value; renderRegisters(ui) })
  v.querySelector('#jr-prev').addEventListener('click', () => { R.date = d.dates[at - 1]?.iso || R.date; renderRegisters(ui) })
  v.querySelector('#jr-next').addEventListener('click', () => { R.date = d.dates[at + 1]?.iso || R.date; renderRegisters(ui) })
  const counts = () => {
    const kids = [...v.querySelectorAll('.jj-reg')]
    const n = (st) => kids.filter((k) => k.querySelector(`[data-mark="${st}"]`).getAttribute('aria-pressed') === 'true').length
    const here = n('Present'), away = n('Absent')
    v.querySelector('#jr-counts').innerHTML = `${pill('green', `${here} here`)}${pill('red', `${away} away`)}${pill('grey', `${kids.length - here - away} not marked`)}`
  }
  const mark = async (li, status) => {
    const before = [...li.querySelectorAll('[data-mark]')].map((b) => b.getAttribute('aria-pressed'))
    li.querySelectorAll('[data-mark]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mark === status)))
    counts()
    const r = await ui.post('jjMark', { classId: d.class.id, date: d.date, rowId: li.dataset.kid, status })
    if (!r.ok) {
      li.querySelectorAll('[data-mark]').forEach((b, i) => b.setAttribute('aria-pressed', before[i]))
      counts()
      toast(r.data.error || 'Not saved. Try again.')
      return false
    }
    if (r.data.airtable === 'failed') toast('Saved here. The Airtable copy did not save; it is tried again next time you mark.', 5000)
    return true
  }
  v.querySelectorAll('.jj-reg [data-mark]').forEach((b) => b.addEventListener('click', () => {
    const li = b.closest('.jj-reg')
    // Tapping the one already chosen takes the mark off.
    mark(li, b.getAttribute('aria-pressed') === 'true' ? '' : b.dataset.mark)
  }))
  v.querySelector('#jr-all')?.addEventListener('click', async (e) => {
    e.currentTarget.disabled = true
    for (const li of v.querySelectorAll('.jj-reg')) if (![...li.querySelectorAll('[data-mark]')].some((x) => x.getAttribute('aria-pressed') === 'true')) if (!(await mark(li, 'Present'))) break
    toast('Marked.')
  })
  v.querySelector('#jr-save-coaches')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget
    btn.disabled = true
    const r = await ui.post('jjSessionCoaches', { classId: d.class.id, date: d.date, headId: v.querySelector('#jr-head').value, shadowId: v.querySelector('#jr-shadow').value })
    btn.disabled = false
    if (!r.ok) return toast(r.data.error || 'Could not save.')
    toast('Saved who coached.')
    renderRegisters(ui)
  })
}
