// Make-ups and credits (Lee, 19 Oct 2026): cancel one group's session for an
// emergency (coach sick or no-show), then look after the free make-ups and
// credits it creates. Nothing here charges or refunds; families are emailed
// only when Lee or Ligia press Email the families (20 Oct 2026).
import { esc, toast } from './jfp-common.js'
import { psHead } from './jfp-portal-ps.js'

const S = { filter: 'open' }
const money = (cents) => `A$${(cents / 100).toFixed(2).replace(/\.00$/, '')}`
const PILL = { owed: ['amber', 'Owed'], requested: ['violet', 'Family asked'], booked: ['blue', 'Booked'], used: ['green', 'Used'], applied: ['green', 'Applied'], expired: ['red', 'Not used in term'], cancelled: ['grey', 'Cancelled'] }

export async function renderMakeups(ui) {
  const { view, post, need, modal, closeModal, confirmBox } = ui
  const d = await need(await post('makeupsList'))
  const open = (m) => ['owed', 'requested', 'booked', 'expired'].includes(m.status)
  const shown = d.makeups.filter((m) => (S.filter === 'open' ? open(m) : S.filter === 'all' ? true : m.status === S.filter))
  const count = (f) => d.makeups.filter((m) => (f === 'open' ? open(m) : m.status === f)).length
  view().innerHTML = `${psHead({ title: 'Make-ups and credits', count: `${count('open')} open`, primary: '<button type="button" class="j-btn j-btn-dark" id="mk-new">Cancel a session</button>' })}
    <p class="muted small" style="margin-bottom:10px">Only for emergencies, like a sick or missing coach. Free make-ups must be used by the end of this term (${esc(d.termEndLabel)}). Credits come off the family's next payment by themselves (see Money, Credits owed). Families see both in My account.</p>
    <div class="j-chips" style="margin-bottom:10px">${[['open', 'Open'], ['requested', 'Family asked'], ['booked', 'Booked'], ['used', 'Used'], ['applied', 'Applied'], ['all', 'All']].map(([k, l]) => `<button type="button" class="j-chip" data-f="${k}" aria-pressed="${S.filter === k}">${l}${k === 'open' ? ` (${count('open')})` : ''}</button>`).join('')}</div>
    <div class="ps-table-wrap"><table class="ps-table"><thead><tr><th>Player</th><th>Missed session</th><th>What they have</th><th>Status</th><th></th></tr></thead><tbody>
    ${shown.map((m) => `<tr><td><b>${esc(m.player)}</b></td><td>${esc(m.group)}<br><span class="muted small">${esc(m.dateLabel)} · ${esc(m.reason)}</span></td>
      <td>${m.kind === 'makeup' ? `Free make-up<br><span class="muted small">by ${esc(m.expiresLabel)}</span>` : `Credit ${m.cents ? esc(money(m.cents)) : '<span class="muted">value not set</span>'}<br><span class="muted small">next term</span>`}${m.requestNote ? `<br><span class="small">"${esc(m.requestNote)}"</span>` : ''}</td>
      <td><span class="j-pill j-pill-${PILL[m.status]?.[0] || 'grey'}">${esc(PILL[m.status]?.[1] || m.status)}</span>${m.bookedLabel ? `<br><span class="muted small">${esc(m.bookedLabel)}</span>` : ''}</td>
      <td style="white-space:nowrap">${actions(m)}</td></tr>`).join('') || '<tr><td colspan="5"><div class="ps-empty">Nothing here yet.</div></td></tr>'}
    </tbody></table></div>
    ${d.cancelled.length ? `<h2 style="margin:22px 0 8px">Cancelled sessions</h2>${d.cancelled.map((o) => `<div class="jp-player" style="cursor:default;align-items:center"><span><b>${esc(o.group)}</b> · ${esc(o.dateLabel)}<br><span class="muted small">${esc(o.reason)} · ${esc(o.count)} player${o.count === 1 ? '' : 's'} · ${o.kind === 'makeup' ? 'free make-ups' : o.kind === 'credit' ? 'credits' : 'nothing owed'}</span></span>${o.emailedAt ? `<span class="ps-tag">Families emailed</span>` : `<button type="button" class="j-btn j-btn-line j-btn-sm" data-ec-mail="${esc(o.groupId)}|${esc(o.date)}">Email families</button>`}<button type="button" class="j-btn j-btn-line j-btn-sm" data-undo="${esc(o.groupId)}|${esc(o.date)}">Undo</button></div>`).join('')}` : ''}`
  function actions(m) {
    const b = (op, label, line = true) => `<button type="button" class="j-btn ${line ? 'j-btn-line' : 'j-btn-dark'} j-btn-sm" data-op="${op}" data-id="${esc(m.id)}">${label}</button>`
    if (m.kind === 'makeup' && ['owed', 'requested'].includes(m.status)) return b('book', 'Book it', false) + ' ' + b('convert', 'Make it a credit') + ' ' + b('cancel', 'Remove')
    if (m.status === 'expired') return b('convert', 'Make it a credit') + ' ' + b('cancel', 'Remove')
    if (m.status === 'booked') return b('used', 'Mark used') + ' ' + b('unbook', 'Unbook')
    if (m.kind === 'credit' && m.status === 'owed') return b('applied', 'Mark applied', false) + ' ' + b('value', 'Set value') + ' ' + b('cancel', 'Remove')
    if (['cancelled'].includes(m.status)) return b('reopen', 'Reopen')
    return ''
  }
  view().querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => { S.filter = b.dataset.f; renderMakeups(ui) }))
  view().querySelector('#mk-new').addEventListener('click', () => cancelModal(ui, d, () => renderMakeups(ui)))
  view().querySelectorAll('[data-ec-mail]').forEach((b) => b.addEventListener('click', () => {
    const o = d.cancelled.find((x) => `${x.groupId}|${x.date}` === b.dataset.ecMail)
    const box = modal(`<h2 style="margin-bottom:4px">Email the families</h2><p class="muted small" style="margin-bottom:10px">${esc(o.group)} · ${esc(o.dateLabel)}. Every family in the group gets this once. You can change the words.</p>
      <textarea class="j-input" rows="5" maxlength="1200" id="ec-words">${esc(o.words)}</textarea>
      <p class="muted small" id="ec-sent" style="margin-top:6px">Texts from the portal are not set up yet.</p><p class="j-err" id="ec-err2" hidden></p>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px"><button type="button" class="j-btn j-btn-line" id="ec-done">Close</button><button type="button" class="j-btn j-btn-dark" id="ec-email">Email the families</button></div>`)
    emailButton(ui, box, o.groupId, o.date)
    box.querySelector('#ec-done').addEventListener('click', () => { closeModal(); renderMakeups(ui) })
  }))
  view().querySelectorAll('[data-undo]').forEach((b) => b.addEventListener('click', async () => {
    const [groupId, date] = b.dataset.undo.split('|')
    if (!(await confirmBox('Undo this cancellation? The make-ups and credits made for it are removed.', { ok: 'Undo it' }))) return
    const r = await post('emergencyUncancel', { groupId, date })
    toast(r.ok ? 'Undone' : r.data.error); renderMakeups(ui)
  }))
  view().querySelectorAll('[data-op]').forEach((b) => b.addEventListener('click', async () => {
    const m = d.makeups.find((x) => x.id === b.dataset.id)
    const op = b.dataset.op
    if (op === 'book') return bookModal(ui, d, m, () => renderMakeups(ui))
    if (op === 'value') return valueModal(ui, m, 'value', () => renderMakeups(ui))
    if (op === 'convert') return valueModal(ui, m, 'convert', () => renderMakeups(ui))
    if (op === 'cancel' && !(await confirmBox(`Remove what ${m.player} is owed? They stop seeing it.`, { ok: 'Remove', danger: true }))) return
    const r = await post('makeupUpdate', { id: m.id, op })
    toast(r.ok ? 'Updated' : r.data.error); renderMakeups(ui)
  }))
}

function cancelModal(ui, d, done) {
  const { post, modal, closeModal } = ui
  const box = modal(`<h2 style="margin-bottom:4px">Cancel a session</h2>
    <p class="muted small" style="margin-bottom:12px">For an emergency only. Everyone in the group gets what you choose below. Nothing is charged or emailed.</p>
    <label class="j-field"><span>Group</span><select class="j-select" id="ec-g">${d.groups.map((g) => `<option value="${esc(g.id)}">${esc(g.label)}</option>`).join('')}</select></label>
    <label class="j-field"><span>Date</span><select class="j-select" id="ec-d"></select></label>
    <label class="j-field"><span>Why</span><select class="j-select" id="ec-r">${d.reasons.map((r) => `<option>${esc(r)}</option>`).join('')}</select></label>
    <label class="j-field"><span>Each player gets</span><select class="j-select" id="ec-k"><option value="makeup">A free make-up this term</option><option value="credit">A credit for next term</option><option value="none">Nothing owed</option></select></label>
    <p class="j-err" id="ec-err" hidden></p>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px"><button type="button" class="j-btn j-btn-line" data-close>Close</button><button type="button" class="j-btn j-btn-dark" id="ec-go">Cancel this session</button></div>`, { wide: true })
  const dates = () => { const g = d.groups.find((x) => x.id === box.querySelector('#ec-g').value); const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' }); box.querySelector('#ec-d').innerHTML = (g?.dates || []).filter((x) => x.iso >= today).map((x) => `<option value="${esc(x.iso)}">${esc(x.label)}</option>`).join('') }
  dates(); box.querySelector('#ec-g').addEventListener('change', dates)
  box.querySelector('#ec-go').addEventListener('click', async (e) => {
    const b = e.currentTarget
    b.disabled = true
    const r = await post('emergencyCancel', { groupId: box.querySelector('#ec-g').value, date: box.querySelector('#ec-d').value, reason: box.querySelector('#ec-r').value, kind: box.querySelector('#ec-k').value })
    b.disabled = false
    if (!r.ok) { const er = box.querySelector('#ec-err'); er.textContent = r.data.error || 'Could not cancel.'; er.hidden = false; return }
    const gid = box.querySelector('#ec-g').value, date = box.querySelector('#ec-d').value
    box.innerHTML = `<h2 style="margin-bottom:6px">Session cancelled</h2><p>${esc(r.data.players)} player${r.data.players === 1 ? '' : 's'} now see it in My account. The register for that date is closed. Parents have not been messaged yet.</p>
      <p class="muted small" style="margin:10px 0 4px">Message to the families (you can change it):</p><textarea class="j-input" rows="5" maxlength="1200" id="ec-words">${esc(r.data.words)}</textarea>
      <p class="muted small" id="ec-sent" style="margin-top:6px">Email goes to every family in the group, once. Texts from the portal are not set up yet: copy the message into Messages for those.</p>
      <p class="j-err" id="ec-err2" hidden></p>
      <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:10px"><button type="button" class="j-btn j-btn-line" id="ec-copy">Copy message</button><button type="button" class="j-btn j-btn-dark" id="ec-email">Email the families</button><button type="button" class="j-btn j-btn-line" id="ec-done">Done</button></div>`
    box.querySelector('#ec-copy').addEventListener('click', async () => { try { await navigator.clipboard.writeText(box.querySelector('#ec-words').value); toast('Copied') } catch { box.querySelector('#ec-words').select() } })
    emailButton(ui, box, gid, date)
    box.querySelector('#ec-done').addEventListener('click', () => { closeModal(); done() })
  })
}

// Email the families (Lee, 20 Oct 2026): a second tap confirms, then it sends once.
function emailButton(ui, box, gid, date) {
  const b = box.querySelector('#ec-email')
  let armed = false
  b.addEventListener('click', async () => {
    const er = box.querySelector('#ec-err2')
    if (!armed) { armed = true; b.textContent = 'Yes, send the email'; er.hidden = true; return }
    b.disabled = true
    const r = await ui.post('emergencyEmail', { groupId: gid, date, text: box.querySelector('#ec-words').value })
    if (!r.ok) { b.disabled = false; armed = false; b.textContent = 'Email the families'; er.textContent = r.data.error || 'Could not send.'; er.hidden = false; return }
    b.remove()
    box.querySelector('#ec-sent').textContent = `Emailed ${r.data.sent} of ${r.data.families} famil${r.data.families === 1 ? 'y' : 'ies'}.`
  })
}

function bookModal(ui, d, m, done) {
  const { post, modal, closeModal } = ui
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' })
  const box = modal(`<h2 style="margin-bottom:4px">Book ${esc(m.player.split(' ')[0])}'s make-up</h2>
    <p class="muted small" style="margin-bottom:12px">Pick a session before ${esc(d.termEndLabel)}. It shows in that coach's register on the day. Check the group has room.</p>
    <label class="j-field"><span>Session</span><select class="j-select" id="bk-g">${d.groups.map((g) => `<option value="${esc(g.id)}">${esc(g.label)}</option>`).join('')}</select></label>
    <label class="j-field"><span>Date</span><select class="j-select" id="bk-d"></select></label>
    <p class="j-err" id="bk-err" hidden></p>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px"><button type="button" class="j-btn j-btn-line" data-close>Close</button><button type="button" class="j-btn j-btn-dark" id="bk-go">Book make-up</button></div>`)
  const dates = () => { const g = d.groups.find((x) => x.id === box.querySelector('#bk-g').value); box.querySelector('#bk-d').innerHTML = (g?.dates || []).filter((x) => x.iso >= today && x.iso <= d.termEnd).map((x) => `<option value="${esc(x.iso)}">${esc(x.label)}</option>`).join('') }
  dates(); box.querySelector('#bk-g').addEventListener('change', dates)
  box.querySelector('#bk-go').addEventListener('click', async () => {
    const r = await post('makeupUpdate', { id: m.id, op: 'book', groupId: box.querySelector('#bk-g').value, date: box.querySelector('#bk-d').value })
    if (!r.ok) { const er = box.querySelector('#bk-err'); er.textContent = r.data.error || 'Could not book.'; er.hidden = false; return }
    closeModal(); toast('Booked. The coach sees them in the register.'); done()
  })
}

function valueModal(ui, m, op, done) {
  const { post, modal, closeModal } = ui
  const box = modal(`<h2 style="margin-bottom:4px">${op === 'convert' ? 'Make it a credit' : 'Credit value'}</h2>
    <p class="muted small" style="margin-bottom:12px">${esc(m.player)}. The value in dollars, for the missed session.</p>
    <label class="j-field"><span>Credit (A$)</span><input class="j-input" id="cv-v" inputmode="decimal" value="${m.cents ? (m.cents / 100).toFixed(2).replace(/\.00$/, '') : ''}" placeholder="e.g. 50"></label>
    <p class="j-err" id="cv-err" hidden></p>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px"><button type="button" class="j-btn j-btn-line" data-close>Close</button><button type="button" class="j-btn j-btn-dark" id="cv-go">Save</button></div>`)
  box.querySelector('#cv-go').addEventListener('click', async () => {
    const dollars = Number(String(box.querySelector('#cv-v').value).replace(/[^0-9.]/g, ''))
    if (!(dollars >= 0)) { const er = box.querySelector('#cv-err'); er.textContent = 'Enter the credit in dollars.'; er.hidden = false; return }
    const r = await post('makeupUpdate', op === 'convert' ? { id: m.id, op: 'convert', cents: Math.round(dollars * 100) } : { id: m.id, op: 'value', cents: Math.round(dollars * 100) })
    if (!r.ok) { const er = box.querySelector('#cv-err'); er.textContent = r.data.error || 'Could not save.'; er.hidden = false; return }
    closeModal(); toast('Saved'); done()
  })
}
