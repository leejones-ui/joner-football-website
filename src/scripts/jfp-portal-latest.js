// Money > Latest payments (Lee, 3 Nov 2026): every JFP payment newest first,
// like the Joner Football app, so the one that just came in is at the top.
// Chips filter by kind (Term fees, Extra sessions, Invoices, Other) and show
// what that kind has taken. The players table can sort by it too (lastByRow).
import { esc, money } from './jfp-common.js'

const SHORT = 8, LONG = 60
let cache = null // { at, data }: kept a minute, the Money page redraws often.

export async function loadLatest(post, { fresh = false } = {}) {
  if (!fresh && cache && Date.now() - cache.at < 60000) return cache.data
  const r = await post('latestPayments')
  if (!r.ok) throw new Error(r.data?.error || 'Could not read the latest payments.')
  cache = { at: Date.now(), data: r.data }
  return r.data
}
export const forgetLatest = () => { cache = null }

const when = (x) => {
  if (!x.timed) return x.dateLabel
  const d = new Date(x.at)
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' })
  const t = d.toLocaleTimeString('en-AU', { timeZone: 'Australia/Sydney', hour: 'numeric', minute: '2-digit' })
  return x.date === today ? `Today ${t}` : `${x.dateLabel}, ${t}`
}

// ui: { post, filter, openExtra, openRow }. filter.latestKind and filter.latestMore are kept on the Money filter.
export async function mountLatest(box, ui) {
  if (!box) return
  if (!box.innerHTML) box.innerHTML = '<section class="jd-card jm-latest"><h2>Latest payments</h2><p class="muted small">Loading…</p></section>'
  let d
  try { d = await loadLatest(ui.post) } catch (error) { box.innerHTML = `<section class="jd-card jm-latest"><h2>Latest payments</h2><p class="muted small">${esc(error.message)}</p></section>`; return }
  draw(box, ui, d)
}

function draw(box, ui, d) {
  const f = ui.filter
  const kind = d.kinds[f.latestKind] ? f.latestKind : ''
  const list = d.items.filter((x) => !kind || x.kind === kind)
  const shown = list.slice(0, f.latestMore ? LONG : SHORT)
  const t = kind ? d.totals[kind] : Object.values(d.totals).reduce((a, x) => ({ cents: a.cents + x.cents, count: a.count + x.count }), { cents: 0, count: 0 })
  const all = kind ? d.allTime[kind] : null
  const chips = [['', 'All'], ...Object.entries(d.kinds)].map(([k, l]) => `<button type="button" class="j-chip" data-lp-kind="${esc(k)}" aria-pressed="${kind === k}">${esc(l)}${k && d.allTime[k].count ? ` (${d.allTime[k].count})` : ''}</button>`).join('')
  box.innerHTML = `<section class="jd-card jm-latest">
    <div class="jm-latest-head"><h2>Latest payments</h2><button type="button" class="jm-link" data-lp-refresh>Refresh</button></div>
    <div class="j-chips" style="margin:8px 0">${chips}</div>
    <p class="small jm-latest-sum"><b>${esc(money(t.cents))}</b> taken ${esc(d.termLabel)} from ${t.count} payment${t.count === 1 ? '' : 's'}${all && all.cents !== t.cents ? ` · ${esc(money(all.cents))} in all` : ''}${kind === 'extra' ? ' · <button type="button" class="jm-link" data-lp-extra>By coach, month and player</button>' : ''}</p>
    ${shown.length ? `<ul class="jm-hist">${shown.map((x) => `<li${x.rowIds.length ? ` data-lp-row="${esc(x.rowIds[0])}" tabindex="0" style="cursor:pointer"` : ''}><span style="min-width:0"><b>${esc(x.who || 'No name')}</b><small>${esc(when(x))} · ${esc(d.kinds[x.kind])} · ${esc(x.what)} · ${esc(x.method)}</small></span><span class="amt">${esc(money(x.cents))}</span></li>`).join('')}</ul>` : '<p class="muted small">No payments yet.</p>'}
    ${list.length > SHORT ? `<button type="button" class="ps-link" data-lp-more style="margin-top:6px">${f.latestMore ? 'Show fewer' : `Show more (${Math.min(list.length, LONG)})`}</button>` : ''}
  </section>`
  box.querySelectorAll('[data-lp-kind]').forEach((b) => b.addEventListener('click', () => { f.latestKind = b.dataset.lpKind; f.latestMore = false; draw(box, ui, d) }))
  box.querySelector('[data-lp-more]')?.addEventListener('click', () => { f.latestMore = !f.latestMore; draw(box, ui, d) })
  box.querySelector('[data-lp-extra]')?.addEventListener('click', () => ui.openExtra())
  box.querySelector('[data-lp-refresh]')?.addEventListener('click', async () => { forgetLatest(); try { draw(box, ui, await loadLatest(ui.post, { fresh: true })) } catch {} })
  const open = (e) => { const li = e.target.closest('[data-lp-row]'); if (li) ui.openRow(li.dataset.lpRow) }
  box.querySelector('.jm-hist')?.addEventListener('click', open)
  box.querySelector('.jm-hist')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(e) })
}
