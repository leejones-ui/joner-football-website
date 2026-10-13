// Holiday training in the portal (Lee, 13 Oct 2026): Coming up, Past
// holidays, and Set up next holidays. Small pure renderers the holiday admin
// page uses, so they can be checked without a browser.

export function esc(v) { return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])) }
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

// Coming up: today and later. A booking whose session is not known stays in
// Coming up, so it is never hidden.
export const isPast = (date, today) => Boolean(date) && Boolean(today) && date < today
export function splitSlots(slots, today) {
  return { upcoming: slots.filter((s) => !isPast(s.date, today)), past: slots.filter((s) => isPast(s.date, today)) }
}
export function splitBookings(bookings, today) {
  return { upcoming: bookings.filter((b) => !isPast(b.slotDate, today)), past: bookings.filter((b) => isPast(b.slotDate, today)) }
}

export const EMPTY_TEXT = 'No holiday sessions set up yet.'
export function emptyHtml() {
  return `<div class="hp-empty" id="hp-empty"><p>${EMPTY_TEXT}</p><button type="button" class="btn-red min-h-[44px] px-5" data-plan-open>Set up the next holidays</button></div>`
}

// ---------- Past holidays ----------

const RUN = { online: 'Booked online', offline: 'Booked offline', none: 'Not booked' }
export function recordHtml(periods) {
  if (!periods.length) return '<p class="hp-muted" id="hp-record-empty">No past holiday sessions yet. Once a holiday is over, its sessions are kept here.</p>'
  return periods.map((p) => `
    <section class="hp-card hp-period" data-period="${esc(p.id)}">
      <div class="hp-period-head">
        <div><h3 class="hp-h3">${esc(p.label)}</h3><p class="hp-muted">${esc(p.range)}</p></div>
        <a class="link-btn" href="${esc(p.moneyHref)}" target="_top" data-money="${esc(p.id)}">See the money</a>
      </div>
      <dl class="hp-stats">
        <div><dt>Sessions run</dt><dd data-stat="run">${p.run}</dd></div>
        <div><dt>Bookings</dt><dd data-stat="bookings">${p.bookings}</dd></div>
        <div><dt>Players</dt><dd data-stat="players">${p.players}</dd></div>
        <div><dt>Coach</dt><dd data-stat="coach">${p.coaches.length ? p.coaches.map((c) => `${esc(c.name)} <span class="hp-muted">(${c.sessions})</span>`).join(', ') : '<span class="hp-muted">None</span>'}</dd></div>
      </dl>
      <p class="hp-muted hp-small">${[p.offline ? `${plural(p.offline, 'session')} booked offline` : '', p.notBooked ? `${plural(p.notBooked, 'slot')} not booked` : '', p.cancelled ? `${plural(p.cancelled, 'booking')} cancelled` : ''].filter(Boolean).join(' · ') || 'Every slot was booked.'}</p>
      <details class="hp-details"><summary>Every session (${p.sessions.length})</summary>
        <ul class="hp-list">${p.sessions.map((s) => `<li class="hp-row ${s.run === 'none' ? 'hp-none' : ''}"><span><b>${esc(s.dateLabel)} ${esc(s.startLabel)}</b> · ${esc(s.coach)} · ${esc(s.typeLabel)}${s.players.length ? `<br><span class="hp-muted">${esc(s.players.join(', '))}</span>` : ''}</span><span class="hp-tag">${esc(RUN[s.run])}</span></li>`).join('')}</ul>
      </details>
    </section>`).join('')
}

// ---------- Set up next holidays ----------

export function planFormHtml(plan) {
  const sel = (id, list, value) => `<select id="${id}" class="inp">${list.map((p) => `<option value="${esc(p.id)}"${p.id === value ? ' selected' : ''}>${esc(p.label)} · ${esc(p.range)}</option>`).join('')}</select>`
  return `
    <div class="hp-grid2">
      <div><label class="lbl" for="hp-period">Which holidays</label>${sel('hp-period', plan.choices, plan.target.id)}</div>
      <div><label class="lbl" for="hp-source">Copy from</label>${plan.sources.length ? sel('hp-source', plan.sources.map((p) => ({ ...p, range: `${plural(p.slots, 'slot')}` })), plan.source?.id || plan.sources[0].id) : '<p class="hp-muted" id="hp-no-source">No earlier holiday has sessions to copy.</p>'}</div>
    </div>
    <div class="hp-seg" role="group" aria-label="How to start">
      <button type="button" data-mode="copy" aria-pressed="${plan.mode === 'copy'}"${plan.sources.length ? '' : ' disabled'}>Copy last holiday's pattern</button>
      <button type="button" data-mode="blank" aria-pressed="${plan.mode === 'blank'}">Start blank</button>
    </div>`
}

// The preview: each day with the sessions it would get, a tick per day.
export function planPreviewHtml(plan, ticked = null) {
  if (plan.mode === 'blank') {
    const weekdays = plan.days.filter((d) => !d.publicHoliday && d.weekday >= 1 && d.weekday <= 5).length
    return `<div class="hp-note" id="hp-blank"><p><b>${esc(plan.target.label)}</b>, ${esc(plan.target.range)}. Nothing is made yet.</p>
      <p class="hp-muted">Add the sessions with Add Slots. The dates there are set to these holidays.</p>
      <button type="button" class="btn-outline min-h-[44px] px-4" data-plan-weekdays>Put the ${weekdays} weekdays in the dates</button></div>`
  }
  const on = (d) => (ticked ? ticked.has(d.date) : d.items.some((x) => x.status === 'new'))
  const days = plan.days.filter((d) => d.items.length || d.wouldHave)
  const newCount = days.filter(on).reduce((t, d) => t + d.items.filter((x) => x.status === 'new').length, 0)
  const why = { exists: 'Already there', coach: 'Coach not active' }
  return `
    <p class="hp-summary" id="hp-summary">Copying <b>${esc(plan.source.label)}</b> (${plural(plan.source.pattern, 'session')} a week) onto <b>${esc(plan.target.label)}</b>, ${esc(plan.target.range)}.</p>
    ${plan.counts.exists || plan.counts.coach || plan.counts.publicHolidays ? `<p class="hp-muted hp-small" id="hp-skips">${[plan.counts.exists ? `${plural(plan.counts.exists, 'session')} already there` : '', plan.counts.coach ? `${plural(plan.counts.coach, 'session')} with a coach who is not active` : '', plan.counts.publicHolidays ? `${plural(plan.counts.publicHolidays, 'public holiday')} left out` : ''].filter(Boolean).join(' · ')}. These are not made.</p>` : ''}
    ${days.length ? `<ul class="hp-days">${days.map((d) => `
      <li class="hp-day${d.publicHoliday ? ' hp-off' : ''}">
        ${d.publicHoliday ? `<p class="hp-dayhead"><b>${esc(d.label)}</b> <span class="hp-tag">${esc(d.publicHoliday)}, left out</span></p>` : `<label class="hp-dayhead"><input type="checkbox" data-plan-day="${esc(d.date)}"${on(d) ? ' checked' : ''}${d.items.some((x) => x.status === 'new') ? '' : ' disabled'}> <b>${esc(d.label)}</b> <span class="hp-muted">${plural(d.items.filter((x) => x.status === 'new').length, 'new session')}</span></label>
        <ul class="hp-items">${d.items.map((x) => `<li class="${x.status === 'new' ? '' : 'hp-skip'}" data-plan-item="${esc(x.key)}">${esc(x.startLabel)} to ${esc(x.endLabel)} · Coach ${esc(x.coachName)} · ${esc(x.typeLabel)} · ${esc(x.priceLabel)}${x.customPrice ? ' (own price)' : ''}${x.capacity > 2 ? ` · up to ${x.capacity}` : ''}${x.status === 'new' ? '' : ` <span class="hp-tag">${esc(why[x.status])}</span>`}</li>`).join('')}</ul>`}
      </li>`).join('')}</ul>` : '<p class="hp-muted">The pattern has no sessions on these days.</p>'}
    <div class="hp-actions"><button type="button" class="btn-red min-h-[48px] px-5" data-plan-create${newCount ? '' : ' disabled'}>Create ${plural(newCount, 'session')}</button><button type="button" class="btn-outline min-h-[48px] px-4" data-plan-close>Not now</button></div>
    <p class="hp-muted hp-small">Nothing is emailed. Parents can book these as soon as they are made.</p>`
}

// The weekdays of a blank holiday, for the Add Slots dates.
export function blankDates(plan) {
  return plan.days.filter((d) => !d.publicHoliday && d.weekday >= 1 && d.weekday <= 5).map((d) => d.date)
}
