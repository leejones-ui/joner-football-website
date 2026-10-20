// Missing players (Lee, 20 Oct 2026): "A player who misses 2 weeks in a row
// gets flagged to Ligia. That's usually the first sign a family is leaving."
// Lee and Ligia only. Each player whose last 2 marked sessions were not
// Present, whether the family told us, when they last came, and a Followed
// up button. At the top, the switch for the Monday email to Ligia with its
// words. The server works it all out (api/_jfp-absence.js).
import { esc } from './jfp-common.js'
import { psHead, psBadge } from './jfp-portal-ps.js'

const S = { show: 'todo' }
const who = (email) => { const e = String(email || '').toLowerCase(); if (e.startsWith('leejones@')) return 'Lee'; if (e.startsWith('ligia@')) return 'Ligia'; const n = e.split('@')[0]; return n ? n[0].toUpperCase() + n.slice(1) : 'Staff' }
const day = (iso) => (iso ? new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : '')
const toldBadge = (a) => (a.told === 'all' ? psBadge('orange', 'Told us') : a.told === 'some' ? psBadge('orange', `Told us ${a.toldCount} of ${a.inRow}`) : psBadge('red', "Didn't tell us"))

function digestHtml(d) {
  const w = d.digestWords
  return `<div class="j-card abs-digest">
    <label class="j-check small"><input type="checkbox" id="abs-digest" ${d.digest ? 'checked' : ''}> <span><b>Monday email to Ligia ${d.digest ? 'on' : 'off'}.</b> Every Monday morning, Ligia gets an email listing the players newly on this list (not yet followed up). Nothing is ever sent to families or coaches. Nothing new that week, no email.</span></label>
    <details class="abs-words" ${d.digest ? '' : 'open'}><summary>The email, word for word</summary>
      <div class="abs-mail">
        <p class="small muted" style="margin:0 0 4px">Subject: <b>${esc(w.subject)}</b></p>
        <p style="margin:0 0 6px"><b>${esc(w.heading)}</b></p>
        ${w.paras.map((x) => `<p class="small" style="margin:0 0 6px">${esc(x)}</p>`).join('')}
        <ul class="small abs-mail-list">${w.list.slice(0, 5).map(([k, v]) => `<li><b>${esc(k)}</b>: ${esc(v)}</li>`).join('')}${w.list.length > 5 ? `<li class="muted">and ${w.list.length - 5} more</li>` : ''}</ul>
        <p class="small" style="margin:0"><span class="ps-tag">${esc(w.cta.label)}</span> (a button to this page)</p>
      </div>
    </details>
  </div>`
}

function rowHtml(a, i) {
  const fu = a.followedUp
  const missed = `<b>${esc(a.inRow)} in a row</b>: ${esc(a.missed.map((m) => m.label).join(', '))}`
  const fuLine = fu ? `<span class="ps-sub">Followed up by ${esc(who(fu.by))}, ${esc(day(fu.at))}${fu.note ? `: ${esc(fu.note)}` : ''}</span>` : a.earlier ? `<span class="ps-sub">Followed up before (${esc(day(a.earlier.at))}${a.earlier.note ? `: ${esc(a.earlier.note)}` : ''}), missed again since</span>` : ''
  return `<tr>
    <td data-col="who"><button type="button" class="ps-link abs-name" data-abs-open="${esc(a.rowId)}">${esc(a.name)}</button>${fuLine}</td>
    <td data-col="group">${esc(a.group)}<span class="ps-sub">${esc(a.coach || 'No coach set')}</span></td>
    <td>${missed}</td>
    <td>${toldBadge(a)}</td>
    <td class="small" style="white-space:nowrap">${a.lastCameLabel ? esc(a.lastCameLabel) : '<span class="muted">Not this term</span>'}</td>
    <td class="ps-end ps-keep">${fu ? `<button type="button" class="j-btn j-btn-line j-btn-sm" data-abs-undo="${i}">Undo</button>` : `<button type="button" class="j-btn j-btn-dark j-btn-sm" data-abs-fu="${i}">Followed up</button>`}</td>
  </tr>`
}

export async function renderAbsence({ view, post, need, modal, closeModal, toast, openPlayer, onCount }) {
  const d = await need(await post('absenceList', { show: S.show }))
  onCount?.(d.totals.todo)
  const T = d.totals
  const empty = S.show === 'done' ? 'Nobody followed up yet.' : S.show === 'all' ? 'Nobody has missed 2 sessions in a row. Good news.' : 'Nobody to follow up. Players show here when they miss 2 marked sessions in a row.'
  view().innerHTML = `${psHead({ title: 'Missing players', count: T.todo }).replace('</h1>', '</h1><details class="ps-help"><summary aria-label="About this page" title="About this page">?</summary><div class="ps-help-body">Players who were not there for their last 2 marked sessions in a row, this term. A session the coach did not mark is skipped, and so is one we cancelled. Told us means the family said in their account they could not come. Trials and Joners Juniors are not included. Followed up takes a player off To follow up; if they miss another session they come back.</div></details>')}
    ${digestHtml(d)}
    <div class="j-chips" style="margin:12px 0">${[['todo', 'To follow up', T.todo], ['done', 'Followed up', T.done], ['all', 'All', T.all]].map(([k, l, n]) => `<button type="button" class="j-chip" data-abs-show="${k}" aria-pressed="${S.show === k}">${l} <b>${n}</b></button>`).join('')}</div>
    <div class="ps-table-wrap"><table class="ps-table"><thead><tr><th>Player</th><th data-col="group">Group</th><th>Missed</th><th>Told us?</th><th>Last came</th><th class="ps-end"><span class="sr-only">Actions</span></th></tr></thead><tbody>
    ${d.players.map(rowHtml).join('') || `<tr><td colspan="6"><div class="ps-empty">${empty}</div></td></tr>`}
    </tbody></table></div>`
  const again = () => renderAbsence({ view, post, need, modal, closeModal, toast, openPlayer, onCount })
  view().querySelectorAll('[data-abs-show]').forEach((b) => b.addEventListener('click', () => { S.show = b.dataset.absShow; again() }))
  view().querySelectorAll('[data-abs-open]').forEach((b) => b.addEventListener('click', () => (openPlayer ? openPlayer(b.dataset.absOpen) : null)))
  view().querySelector('#abs-digest')?.addEventListener('change', async (e) => {
    const r = await post('absenceDigest', { on: e.target.checked })
    if (!r.ok) { e.target.checked = !e.target.checked; return toast(r.data.error || 'Could not change it.') }
    toast(r.data.digest ? 'Monday email to Ligia on' : 'Monday email to Ligia off')
    again()
  })
  view().querySelectorAll('[data-abs-fu]').forEach((b) => b.addEventListener('click', () => {
    const a = d.players[Number(b.dataset.absFu)]
    const box = modal(`<h2 style="margin-bottom:4px">Followed up: ${esc(a.name)}</h2>
      <p class="muted small" style="margin-bottom:12px">Missed ${esc(a.inRow)} in a row (${esc(a.missed.map((m) => m.label).join(', '))}). This takes them off To follow up. If they miss another session they come back.</p>
      <label class="j-field"><span>Note <span class="muted">(optional, staff only)</span></span><textarea class="j-input" id="abs-note" rows="3" maxlength="300" placeholder="For example: spoke to mum, away on holiday, back next week"></textarea></label>
      <p class="j-box j-box-red small" id="abs-err" hidden></p>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px"><button type="button" class="j-btn j-btn-line" data-close>Cancel</button><button type="button" class="j-btn j-btn-dark" id="abs-save">Save</button></div>`)
    box.querySelector('#abs-save').addEventListener('click', async (ev) => {
      ev.target.disabled = true
      const r = await post('absenceFollowUp', { rowId: a.rowId, date: a.latest, note: box.querySelector('#abs-note').value })
      if (!r.ok) { ev.target.disabled = false; const err = box.querySelector('#abs-err'); err.textContent = r.data.error || 'Could not save.'; err.hidden = false; return }
      closeModal(); toast(`${a.name} marked followed up`); again()
    })
  }))
  view().querySelectorAll('[data-abs-undo]').forEach((b) => b.addEventListener('click', async () => {
    const a = d.players[Number(b.dataset.absUndo)]
    b.disabled = true
    const r = await post('absenceUndo', { rowId: a.rowId, date: a.latest })
    if (!r.ok) { b.disabled = false; return toast(r.data.error || 'Could not undo.') }
    toast(`${a.name} back on To follow up`); again()
  }))
}
