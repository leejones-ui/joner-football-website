// Removed players in the staff portal (Lee, 14 Oct 2026): "When we remove a
// player and give a reason, it should be easy to find in the portal and we
// need to know why they've moved. But they shouldn't leave the database."
//   findExisting: "Find an existing player" on every Add form. Removed
//     players show with "Removed <date>: <reason>"; picking one fills the
//     contacts, own contact, player information and date of birth, and the
//     add tells the server (fromRemoved) so the removal record says they are back.
//   removedView / wireRemoved: the Players tab's Removed list, with a count
//     of reasons this term, Add back and Open.
//   addBack: pick the group (where they were by default), then the Add form, prefilled.
// The server side is api/_jfp-removed.js.
import { esc, money } from './jfp-common.js'

const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ')
const when = (iso) => (iso ? new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '')

// What a picked removed player looks like on the form.
export function removedNote(x) {
  const r = x.removed || {}
  return `<div class="j-box j-box-grey small" style="margin-bottom:10px"><b>Adding ${esc(x.name)} back.</b> ${esc(r.label || 'Removed earlier')}${r.session ? `, was in ${esc(r.session)}` : ''}. Their contact details${x.profile ? ', player information' : ''}${x.waiver ? ' and waiver' : ''} are on file and carried over. Choose the price and payment as for anyone new.</div>`
}

// The search box on an Add form. form: wirePlayerForm()'s result (or any
// { fill(x) }). Returns { use(x), fromRemoved(name) }: fromRemoved gives the
// removal record to send with the add, only while the name is still theirs.
export function findExisting(box, { post, toast, input, results, form, onPick = () => {} }) {
  let picked = null
  const use = (x) => {
    picked = x.removed ? x : null
    form.fill(x)
    results.innerHTML = x.removed ? removedNote(x) : `<div class="j-box j-box-grey small" style="margin-bottom:10px">Using ${esc(x.name)} from ${esc(x.source)}.${x.waiver ? ' Waiver on file.' : ''}</div>`
    onPick(x)
  }
  let timer
  input.addEventListener('input', (e) => {
    clearTimeout(timer)
    const qv = e.target.value.trim()
    timer = setTimeout(async () => {
      if (qv.length < 2) { results.innerHTML = ''; return }
      const r = await post('searchPlayers', { q: qv })
      if (!r.ok) return
      const list = r.data.results || []
      results.innerHTML = list.length
        ? list.map((x, i) => `<button type="button" class="j-player" data-pick="${i}"><span><b>${esc(x.name)}</b>${x.age != null ? ` <span class="muted">(${esc(x.age)})</span>` : ''}<br><span class="muted small">${x.removed ? `<b>${esc(x.removed.label)}</b>${x.removed.session ? ` · was ${esc(x.removed.session)}` : ''} · ` : `${esc(x.source)} · `}${esc(x.parentName || (x.ownContact ? 'Own contact' : ''))} ${esc(x.email || '')}</span></span>${x.removed ? '<span class="j-pill j-pill-amber">Removed</span>' : x.waiver ? '<span class="j-pill j-pill-green">Waiver</span>' : ''}</button>`).join('')
        : '<p class="muted small" style="margin-bottom:10px">No match. Type the details below for a new player.</p>'
      results.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', async () => {
        const x = list[Number(b.dataset.pick)]
        if (!x.removed) return use(x)
        // Everything on file: contacts, own contact, player information, waiver.
        const full = await post('removedPlayer', { droppedId: x.removed.droppedId, rowId: x.removed.rowId })
        if (!full.ok) return toast(full.data.error || 'Could not read that player.')
        use({ ...full.data.player, fromRemoved: x.removed.droppedId })
      }))
    }, 250)
  })
  return { use, fromRemoved: (name) => (picked?.fromRemoved && norm(name) === norm(picked.name) ? picked.fromRemoved : '') }
}

// ---------- Players tab: Removed ----------

const shown = (d, q) => {
  const s = norm(q)
  return (d?.players || []).filter((p) => !s || [p.name, p.parent, p.email, p.phone, p.reason, p.details, p.session, p.removedBy].some((v) => norm(v).includes(s)))
}
export const removedCount = (d) => (d?.players || []).filter((p) => !p.restored).length

export function removedView(d, q = '') {
  const list = shown(d, q)
  const counts = d?.counts || []
  return `<p class="muted small" style="margin:0 0 8px">Everyone removed, and why. They stay on file: contacts, player information, waiver and history. <b>Add back</b> puts them in any group with a new price, or search their name in any Add a player form.</p>
    ${counts.length ? `<div class="ps-chips" aria-label="Why players left ${esc(d.term || 'this term')}"><span class="muted small" style="align-self:center">Why they left ${esc(d.term || 'this term')}:</span>${counts.map((c) => `<span class="j-pill j-pill-grey">${esc(c.reason)} · ${c.count}</span>`).join('')}</div>` : ''}
    <div class="ps-table-wrap"><table class="ps-table" id="pl-removed"><thead><tr><th>Player</th><th>Removed</th><th>Why</th><th data-col="football">From</th><th class="ps-end"><span class="sr-only">Actions</span></th></tr></thead>
    <tbody>${list.map((p) => `<tr data-rm-row="${esc(p.droppedId || p.rowId)}"><td data-col="who"><div class="ps-who"><div><b>${esc(p.name)}</b>${p.restored ? ' <span class="ps-tag">Back</span>' : ''}<span class="ps-sub">${esc(p.ownContact ? 'Own contact' : p.parent || '')}${p.email ? ` · ${esc(p.email)}` : ''}</span></div></div></td>
      <td data-col="group">${esc(when(p.removedAt) || 'Date not recorded')}<span class="ps-sub">${esc(p.removedBy ? `by ${p.removedBy}` : '')}</span></td>
      <td data-col="pay"><b>${esc(p.reason || 'No reason recorded')}</b>${p.details ? `<span class="ps-sub">${esc(p.details.slice(0, 120))}${p.details.length > 120 ? '…' : ''}</span>` : ''}</td>
      <td data-col="football">${esc(p.groupLabel || p.session || 'No group')}${p.coach ? `<span class="ps-sub">${esc(p.coach)}</span>` : ''}</td>
      <td class="ps-end ps-keep"><button type="button" class="j-btn j-btn-line j-btn-sm" data-rm-detail="${esc(p.droppedId || p.rowId)}">Open</button> <button type="button" class="j-btn j-btn-dark j-btn-sm" data-rm-back="${esc(p.droppedId || p.rowId)}">Add back</button></td></tr>`).join('') || '<tr><td colspan="5"><div class="ps-empty">Nobody removed.</div></td></tr>'}</tbody></table></div>`
}

// ui: { post, modal, closeModal, toast, confirmBox, need, board(), groupOptions(selected), addToGroup(g, x), addNoGroup(x), after() }
export function wireRemoved(root, d, ui) {
  const find = (id) => (d?.players || []).find((p) => (p.droppedId || p.rowId) === id)
  root.querySelectorAll('[data-rm-back]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); addBack(ui, find(b.dataset.rmBack)) }))
  root.querySelectorAll('[data-rm-detail]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); removedDetail(ui, find(b.dataset.rmDetail)) }))
}

export function removedDetail(ui, p) {
  if (!p) return
  const box = ui.modal(`<h2 style="margin-bottom:4px">${esc(p.name)}</h2><p class="muted small" style="margin-bottom:12px">Removed${p.removedAt ? ` ${esc(when(p.removedAt))}` : ''}${p.removedBy ? ` by ${esc(p.removedBy)}` : ''}${p.term ? `, ${esc(p.term)}` : ''}${p.restored ? '. <b>Back in since.</b>' : ''}</p>
    <div class="j-box j-box-grey" style="margin-bottom:12px"><b>${esc(p.reason || 'No reason recorded')}</b>${p.details ? `<br><span style="white-space:pre-wrap">${esc(p.details)}</span>` : ''}</div>
    <dl class="j-kv">
      <dt>Was in</dt><dd>${esc(p.groupLabel || p.session || 'No group')}${p.coach ? `, ${esc(p.coach)}` : ''}</dd>
      <dt>${p.ownContact ? 'Contact' : 'Parent'}</dt><dd>${p.ownContact ? 'The player (own contact)' : esc(p.parent || '')}</dd>
      <dt>Email</dt><dd>${p.email ? `<a href="mailto:${esc(p.email)}">${esc(p.email)}</a>` : 'None'}</dd>
      <dt>Mobile</dt><dd>${p.phone ? `<a href="tel:${esc(p.phone)}">${esc(p.phone)}</a>` : 'None'}</dd>
      <dt>Payment</dt><dd>${esc(p.paymentStatus || 'Not set')} · paid ${esc(money(p.paidCents || 0))} of ${esc(money(p.feeCents || 0))}${p.type ? ` · ${esc(p.type)}` : ''}</dd>
      ${p.notes ? `<dt>Notes</dt><dd><details><summary style="cursor:pointer;font-weight:600">Show notes</summary><p style="font-weight:400;white-space:pre-wrap;margin-top:6px">${esc(p.notes)}</p></details></dd>` : ''}
    </dl>
    <div class="jpf-acts"><button type="button" class="j-btn j-btn-line" data-close>Close</button>${p.restored ? '' : '<button type="button" class="j-btn j-btn-line" id="rmd-restore" title="Back in the same group, at the same price">Restore as it was</button>'}<button type="button" class="j-btn j-btn-dark" id="rmd-back">Add back</button></div>`, { wide: true })
  box.querySelector('#rmd-back').addEventListener('click', () => { ui.closeModal(); addBack(ui, p) })
  box.querySelector('#rmd-restore')?.addEventListener('click', async () => {
    ui.closeModal()
    if (!(await ui.confirmBox(`Put ${esc(p.name)} back in ${esc(p.session || 'their group')} as Confirmed, at the same price?`))) return
    const r = await ui.post('restorePlayer', { droppedId: p.droppedId, rowId: p.rowId })
    ui.toast(r.ok ? 'Restored to Term 4. Airtable updated.' : r.data.error)
    if (r.ok) ui.after()
  })
}

// Add back: the group first (where they were, if it is still running), then
// the Add form with everything on file filled in.
export async function addBack(ui, p) {
  if (!p) return
  const r = await ui.post('removedPlayer', { droppedId: p.droppedId, rowId: p.rowId })
  if (!r.ok) return ui.toast(r.data.error || 'Could not read that player.')
  const x = { ...r.data.player, fromRemoved: p.droppedId || '' }
  const board = await ui.board()
  const was = x.removed?.groupId || ''
  const box = ui.modal(`<h2 style="margin-bottom:4px">Add ${esc(x.name)} back</h2>
    <p class="muted small" style="margin-bottom:12px">${esc(x.removed?.label || 'Removed earlier')}${x.removed?.session ? `, was in ${esc(x.removed.session)}` : ''}.</p>
    <label class="j-field"><span>Which group?</span><select class="j-select" id="ab-g"><option value="">No group yet</option>${ui.groupOptions(was)}</select></label>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px"><button type="button" class="j-btn j-btn-line" data-close>Cancel</button><button type="button" class="j-btn j-btn-dark" id="ab-go">Next</button></div>`)
  box.querySelector('#ab-go').addEventListener('click', () => {
    const g = board.groups.find((y) => y.id === box.querySelector('#ab-g').value)
    ui.closeModal()
    if (g) ui.addToGroup(g, x); else ui.addNoGroup(x)
  })
}
