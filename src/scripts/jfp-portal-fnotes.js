// Coach notes for families (Lee, 17 Oct 2026: "goes straight to the family").
// A coach writes from a player in My sessions; Lee and Ligia from the
// timetable or the Coach notes page, where they can edit or delete any note.
// Families see the words only, from "Coach" (never a coach's name).
import { esc, toast } from './jfp-common.js'
import { psHead, psSearch } from './jfp-portal-ps.js'

const MAX = 1000

// One player's notes and a box to write a new one.
export async function familyNotesModal(ui, { rowId, name }) {
  const { post, modal, closeModal, confirmBox } = ui
  const r = await post('familyNotes', { rowId })
  if (!r.ok) return toast(r.data.error || 'Could not open the notes.')
  let notes = r.data.notes
  const firstName = String(name || '').split(' ')[0]
  const box = modal(`<h2 style="margin-bottom:4px">Note to ${esc(firstName)}'s family</h2>
    <p class="muted small" style="margin-bottom:12px">They see it straight away in My account, from "Coach".</p>
    <textarea class="j-input" id="fn-text" rows="4" maxlength="${MAX}" placeholder="Great session today. Work on your weaker foot this week."></textarea>
    <p class="j-err" id="fn-err" hidden></p>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px"><button type="button" class="j-btn j-btn-line" data-close>Close</button><button type="button" class="j-btn j-btn-dark" id="fn-go">Send to family</button></div>
    <div id="fn-list" style="margin-top:16px"></div>`, { wide: true })
  const list = () => {
    box.querySelector('#fn-list').innerHTML = notes.length ? `<p class="small" style="font-weight:700;margin-bottom:6px">Sent before</p>${notes.map((n) => noteRow(n)).join('')}` : ''
    wire(box, ui, notes, (next) => { notes = next; list() })
  }
  list()
  box.querySelector('#fn-go').addEventListener('click', async (e) => {
    const b = e.currentTarget
    b.disabled = true
    const s = await post('familyNoteSave', { rowId, text: box.querySelector('#fn-text').value })
    b.disabled = false
    if (!s.ok) { const er = box.querySelector('#fn-err'); er.textContent = s.data.error || 'Could not send.'; er.hidden = false; return }
    box.querySelector('#fn-text').value = ''
    notes = [s.data.note, ...notes]
    list()
    toast(`Sent. ${firstName}'s family can see it now.`)
  })
}

function noteRow(n) {
  return `<div class="j-box j-box-grey" style="margin-bottom:8px" data-fn="${esc(n.id)}"><p class="muted small">${esc(n.dateLabel)}${n.byName ? ` · ${esc(n.byName)}` : ''}${n.edited ? ' · edited' : ''}${n.player ? ` · ${esc(n.player)}` : ''}${n.group ? ` · ${esc(n.group)}` : ''}</p>
    <p style="margin-top:4px;white-space:pre-wrap">${esc(n.text)}</p>
    ${n.canEdit ? `<div style="display:flex;gap:6px;margin-top:6px"><button type="button" class="j-btn j-btn-line j-btn-sm" data-fn-edit="${esc(n.id)}">Edit</button><button type="button" class="j-btn j-btn-line j-btn-sm" data-fn-del="${esc(n.id)}">Delete</button></div>` : ''}</div>`
}

// Edit in place and delete, for whoever may (Lee, Ligia, or the note's coach).
function wire(root, ui, notes, done) {
  const { post, confirmBox } = ui
  root.querySelectorAll('[data-fn-del]').forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmBox('Delete this note? The family stops seeing it at once.', { ok: 'Delete', danger: true }))) return
    const r = await post('familyNoteDelete', { id: b.dataset.fnDel })
    if (!r.ok) return toast(r.data.error || 'Could not delete.')
    toast('Deleted.'); done(notes.filter((n) => n.id !== b.dataset.fnDel))
  }))
  root.querySelectorAll('[data-fn-edit]').forEach((b) => b.addEventListener('click', () => {
    const n = notes.find((x) => x.id === b.dataset.fnEdit)
    const card = root.querySelector(`[data-fn="${CSS.escape(n.id)}"]`)
    card.innerHTML = `<textarea class="j-input" rows="4" maxlength="${MAX}">${esc(n.text)}</textarea><div style="display:flex;gap:6px;justify-content:flex-end;margin-top:6px"><button type="button" class="j-btn j-btn-line j-btn-sm" data-x>Cancel</button><button type="button" class="j-btn j-btn-dark j-btn-sm" data-s>Save</button></div>`
    card.querySelector('[data-x]').addEventListener('click', () => done(notes))
    card.querySelector('[data-s]').addEventListener('click', async () => {
      const r = await post('familyNoteSave', { id: n.id, text: card.querySelector('textarea').value })
      if (!r.ok) return toast(r.data.error || 'Could not save.')
      toast('Saved. The family sees the new words.'); done(notes.map((x) => (x.id === n.id ? r.data.note : x)))
    })
  }))
}

// Lee and Ligia: every note sent, newest first, to read, edit or delete.
const S = { q: '' }
export async function renderFamilyNotesPage(ui) {
  const { view, post, need } = ui
  const d = await need(await post('familyNotesAll'))
  let notes = d.notes
  const draw = () => {
    const q = S.q.trim().toLowerCase()
    const shown = notes.filter((n) => !q || `${n.player} ${n.text} ${n.byName}`.toLowerCase().includes(q))
    view().innerHTML = `${psHead({ title: 'Coach notes', count: `${notes.length} sent` })}
      <div class="ps-tools" role="search">${psSearch('fn-q', 'Search notes…', S.q, 'Search coach notes')}</div>
      <div id="fn-all">${shown.map(noteRow).join('') || '<div class="ps-table-wrap"><div class="ps-empty">No coach notes yet. Coaches write them from a player in My sessions.</div></div>'}</div>`
    const i = view().querySelector('#fn-q')
    i.addEventListener('input', (e) => { S.q = e.target.value; const at = e.target.selectionStart; draw(); const x = view().querySelector('#fn-q'); x.focus(); x.setSelectionRange(at, at) })
    wire(view(), ui, notes, (next) => { notes = next; draw() })
  }
  draw()
}
