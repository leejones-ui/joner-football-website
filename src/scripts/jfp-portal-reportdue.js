// Player reports due in week 9 (Lee, 20 Oct 2026). From week 9 each coach
// sees how many of theirs are sent; Lee and Ligia see every coach and the
// switch for the reminder emails and texts.
import { esc } from './jfp-common.js'

let cache = null // { at, r }: the register redraws often; ask at most once a minute.
export async function mountReportDue(box, { post, toast }, { always = false } = {}) {
  if (!box) return
  const r = cache && Date.now() - cache.at < 60000 ? cache.r : await post('reportDue')
  if (!r.ok) return
  cache = { at: Date.now(), r }
  const d = r.data
  const live = d.phase !== 'none'
  if (!live && !(d.admin && always)) { box.innerHTML = ''; return }
  const me = d.coaches[0]
  const over = d.phase === 'overdue'
  let html = ''
  if (!d.admin) {
    if (!me || !me.total) { box.innerHTML = ''; return }
    html = me.left
      ? `<div class="j-box ${over ? 'j-box-red' : 'j-box-amber'} small" style="margin:8px 0"><b>${over ? 'Player reports overdue' : `Player reports due by ${esc(d.endLabel)}`}.</b> You have sent ${me.sent} of ${me.total}. <a href="#reports" data-tab="reports">Write them now</a>${me.missing.length ? `<br><span class="muted">Still to do: ${esc(me.missing.slice(0, 12).map((m) => m.name).join(', '))}${me.missing.length > 12 ? ` and ${me.missing.length - 12} more` : ''}</span>` : ''}</div>`
      : `<div class="j-box j-box-green small" style="margin:8px 0"><b>All ${me.total} player reports sent.</b> Thank you.</div>`
  } else {
    const behind = d.coaches.filter((c) => c.left)
    html = `<div class="j-card" style="padding:12px 14px;margin:8px 0 14px">
      <p style="margin:0 0 6px"><b>Player reports are due in week ${d.dueWeek}</b> <span class="muted small">(${esc(d.start)} to ${esc(d.endLabel)})</span></p>
      ${live ? `<p class="small" style="margin:0 0 8px">${behind.length ? d.coaches.map((c) => `${esc(c.name)}: <b>${c.sent} of ${c.total}</b>`).join(' · ') : 'Every coach has sent all their reports.'}</p>` : ''}
      <label class="j-check small"><input type="checkbox" id="rd-rem" ${d.reminders ? 'checked' : ''}> <span>Reminders on: the first day of week ${d.dueWeek}, coaches with reports to do get an email and a text. The last day, anyone still behind gets another, and you (Telegram) and Ligia (email) get who is missing what.</span></label></div>`
  }
  box.innerHTML = html
  box.querySelector('#rd-rem')?.addEventListener('change', async (e) => {
    cache = null
    const x = await post('reportDue', { reminders: e.target.checked })
    if (!x.ok) { e.target.checked = !e.target.checked; return toast(x.data.error) }
    toast(x.data.reminders ? 'Report reminders on' : 'Report reminders off')
  })
}
