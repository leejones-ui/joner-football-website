// Money > Session value (Lee, 20 Oct 2026): "For each session: how full it
// is, and the money per coach hour. That tells you which slots to add, merge
// or drop (like 7:30 vs 7:45)". Lee and Ligia only; the server works it out
// (api/_jfp-session-value.js). Read only: nothing here changes a fee, a
// payment or a group.
import { esc, money } from './jfp-common.js'
import { psHead, psBadge } from './jfp-portal-ps.js'

const S = { sort: 'day', data: null }
try { S.sort = localStorage.getItem('jfp-sv-sort') || 'day' } catch {}

const signed = (c) => (c < 0 ? `-${money(-c)}` : money(c))
const hrs = (h) => `${Number.isInteger(h) ? h : h.toFixed(1)} h`
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const nullsLast = (a, b, f) => (f(a) == null) - (f(b) == null) || (f(b) ?? 0) - (f(a) ?? 0)
const byDay = (a, b) => a.dayOrder - b.dayOrder || String(a.sortTime).localeCompare(String(b.sortTime)) || a.venue.localeCompare(b.venue)
const SORTS = {
  full: (a, b) => nullsLast(a, b, (x) => x.fillPct) || byDay(a, b),
  perhour: (a, b) => nullsLast(a, b, (x) => x.feesPerHourCents) || byDay(a, b),
  day: byDay,
}

const HELP = 'Places, Term fees and Paid so far come from the Term 4 players in Airtable, counting players holding a place. Each player\'s own Term 4 fee is used; a player with no fee shows as "no price" and is not guessed. Paid so far does not include bank transfers not yet entered. Coach hours are this term\'s session dates times the session length, for the coach and any helpers. Coach cost comes from the coach rate cards, at the number of players holding a place now. Session by session and Pro players are counted apart, not in the term fees.'

function placesCell(g) {
  const pct = g.fillPct == null ? 'No places set' : `${g.fillPct}% full`
  return `${psBadge(g.fillTone, pct)}<span class="ps-sub">${g.oneToOne ? 'Booked as a 1 to 1' : `${g.holding} / ${g.capacity} places`}</span>`
}

function sessionCell(g) {
  const tags = [g.label && g.label !== 'Small group' ? `<span class="ps-tag">${esc(g.label)}</span>` : '', g.mode === 'closed' ? '<span class="ps-tag">Closed</span>' : ''].filter(Boolean).join(' ')
  const coach = g.coach || 'No coach set'
  const help = g.helpers.length ? ` + ${g.helpers.map(esc).join(', ')} helping` : ''
  const lap = g.overlaps.length ? `<span class="sv-lap">Overlaps: ${g.overlaps.map((o) => esc(o.label)).join('; ')}. Same venue, times cross.</span>` : ''
  return `<b>${esc(g.day)} ${esc(g.time)}</b> ${tags}<span class="ps-sub">${esc(g.venue)} · ${esc(coach)}${help}</span>${lap}`
}

function feesCell(g) {
  const extra = [
    g.noPrice ? `<span class="ps-badge orange"><i></i>${plural(g.noPrice, 'player')} with no price</span>` : '',
    g.session.count ? `<span class="ps-tag pink">+${g.session.count} paying by the session</span><span class="ps-sub">${g.session.perSessionCents ? `${esc(money(g.session.perSessionCents))} a session when they all come` : 'No session price set'}${g.session.unpriced ? ` (${g.session.unpriced} with no price)` : ''} · billed so far ${esc(money(g.session.billedCents))}</span>` : '',
    g.trial.count ? `<span class="ps-tag">+${plural(g.trial.count, 'trial')}</span>` : '',
  ].filter(Boolean).join(' ')
  return `<b>${esc(money(g.feeCents))}</b> <span class="muted small">term fees</span><span class="ps-sub">Paid so far ${esc(money(g.paidCents))}${g.termPlayers ? ` · ${plural(g.termPlayers, 'player')} on a term fee` : ''}</span>${extra ? `<div class="sv-extra">${extra}</div>` : ''}`
}

function hourCell(g) {
  const who = g.coaches > 1 ? ` (${g.coaches} coaches)` : ''
  const hours = `${hrs(g.coachHours)} coach hours${who}<span class="ps-sub">${plural(g.sessions, 'session')} × ${g.durationMin} min${g.cancelled ? ` · ${g.cancelled} cancelled` : ''}${g.helpers.length ? ' · helpers counted' : ''}</span>`
  const per = g.feesPerHourCents == null ? '<span class="muted">No hours</span>' : `<b>${esc(money(g.feesPerHourCents))}</b> <span class="muted small">fees an hour</span>`
  let cost
  if (g.cost.known) {
    const tone = g.marginPerHourCents < 0 ? ' sv-neg' : ''
    cost = `<span class="ps-sub" title="${esc(g.cost.basis.join('; '))}">Coach cost ${esc(money(g.cost.perHourCents))} an hour</span><span class="ps-sub sv-margin${tone}">Margin ${esc(signed(g.marginPerHourCents))} an hour</span>`
  } else if (g.cost.noCoach) cost = '<span class="ps-sub">No coach set</span>'
  else if (g.cost.missing.length) cost = `<span class="ps-sub">No rate card${g.cost.missing.length < g.coaches ? ` for ${g.cost.missing.map(esc).join(', ')}` : ''}</span>`
  else cost = `<span class="ps-sub">${esc(g.cost.reason || 'Coach cost not known')}</span>`
  return `<div>${per}${cost}</div><div class="sv-hours">${hours}</div>`
}

export async function renderSessionValue({ view, post, need }) {
  S.data = await need(await post('sessionValue'))
  draw(view)
}

function draw(view) {
  const d = S.data
  const T = d.totals
  const list = d.groups.slice().sort(SORTS[S.sort] || byDay)
  const head = psHead({ title: 'Session value', count: d.groups.length }).replace('</h1>', `</h1><details class="ps-help"><summary aria-label="About this page" title="About this page">?</summary><div class="ps-help-body">${esc(HELP)}</div></details>`)
  view().innerHTML = `${head}
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin:0 0 10px">
      <span class="ps-tag">${esc(d.term)}</span><span class="ps-tag">${T.holding} / ${T.capacity} places${T.fillPct != null ? ` (${T.fillPct}%)` : ''}</span><span class="ps-tag">${esc(money(T.feeCents))} term fees</span>${T.feesPerHourCents != null ? `<span class="ps-tag">${esc(money(T.feesPerHourCents))} an hour</span>` : ''}${T.noPrice ? `<span class="ps-tag">${plural(T.noPrice, 'player')} with no price</span>` : ''}${T.session ? `<span class="ps-tag pink">+${T.session} paying by the session</span>` : ''}
    </div>
    <div class="j-chips" style="margin:0 0 12px" role="group" aria-label="Sort">${[['day', 'By day'], ['full', 'By % full'], ['perhour', 'By fees an hour']].map(([k, l]) => `<button type="button" class="j-chip" data-sv-sort="${k}" aria-pressed="${S.sort === k}">${l}</button>`).join('')}</div>
    <div class="ps-table-wrap"><table class="ps-table sv-ps"><thead><tr><th>Session</th><th data-col="pay">Places</th><th>Term fees</th><th>Per coach hour</th></tr></thead><tbody>
    ${list.map((g) => `<tr><td data-col="who">${sessionCell(g)}</td><td data-col="pay">${placesCell(g)}</td><td data-col="group">${feesCell(g)}</td><td data-col="flags">${hourCell(g)}</td></tr>`).join('') || '<tr><td colspan="4"><div class="ps-empty">No JFP groups yet.</div></td></tr>'}
    </tbody>${list.length ? `<tfoot><tr class="sv-total"><td data-col="who"><b>All ${plural(T.groups, 'group')}</b>${T.unplaced ? `<span class="ps-sub">${plural(T.unplaced, 'player')} holding a place but not in a group, not counted</span>` : ''}</td>
      <td data-col="pay">${psBadge(T.fillTone, T.fillPct == null ? 'No places set' : `${T.fillPct}% full`)}<span class="ps-sub">${T.holding} / ${T.capacity} places</span></td>
      <td data-col="group"><b>${esc(money(T.feeCents))}</b> <span class="muted small">term fees</span><span class="ps-sub">Paid so far ${esc(money(T.paidCents))}${T.noPrice ? ` · ${T.noPrice} no price` : ''}${T.session ? ` · +${T.session} by the session` : ''}${T.trial ? ` · +${plural(T.trial, 'trial')}` : ''}</span></td>
      <td data-col="flags">${T.feesPerHourCents != null ? `<b>${esc(money(T.feesPerHourCents))}</b> <span class="muted small">fees an hour</span>` : ''}<span class="ps-sub">${hrs(T.coachHours)} coach hours</span>${T.costed ? `<span class="ps-sub">Margin ${esc(signed(T.marginPerHourCents))} an hour, over the ${plural(T.costed, 'group')} with a rate card</span>` : '<span class="ps-sub">No rate cards yet</span>'}</td></tr></tfoot>` : ''}</table></div>`
  view().querySelectorAll('[data-sv-sort]').forEach((b) => b.addEventListener('click', () => {
    S.sort = b.dataset.svSort
    try { localStorage.setItem('jfp-sv-sort', S.sort) } catch {}
    draw(view)
  }))
}
