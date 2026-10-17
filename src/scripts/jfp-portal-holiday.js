// Money > Holiday training (Lee, 13 Oct 2026): what school holiday training
// brought in, one NSW school holiday at a time. Bookings paid in Stripe (the
// real fee from Stripe, and what Stripe has refunded) and bank transfers Lee
// marked "Holiday revenue" on Bank transfers to check. Read only, except
// putting a bank transfer back on that list. Never added into the JFP figures.
import { psHelp } from './jfp-portal-ps.js'
import { esc, money } from './jfp-common.js'
import { moneyHead, bindTip, quietOk, markUpdated } from './jfp-portal-programmes.js'

const H = { data: null, at: 0, period: '', basis: 'session' }
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const day = (iso) => (iso ? new Date(`${String(iso).slice(0, 10)}T00:00:00`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : '')
const hhmm = (t) => { const m = /^(\d{2}):(\d{2})$/.exec(t || ''); if (!m) return ''; const h = Number(m[1]); return `${h % 12 || 12}${m[2] === '00' ? '' : `:${m[2]}`}${h < 12 ? 'am' : 'pm'}` }
export const HOLIDAY_DEFINITION = 'Kept = what families paid, less refunds and Stripe\'s fee (the real fee on each payment, from Stripe). Bank transfers have no fee. A booking counts in the holiday its session is in; a bank transfer counts in the holiday you picked for it.'

export function setHolidayHash(period) { history.replaceState(null, '', `#money?programme=holiday${period ? `&period=${encodeURIComponent(period)}` : ''}`) }

// quick: the last Stripe read is fine (first paint); force: ask even with a
// reading from the last minute (the refresh behind a first paint).
export async function holidayData(post, { period = '', fresh = false, quick = false, force = false } = {}) {
  if (!fresh && !force && H.data && (!period || H.data.period === period) && Date.now() - H.at < 60000) return H.data
  const r = await post('holidayMoney', { period, ...(fresh ? { fresh: true } : {}), ...(quick ? { quick: true } : {}) })
  if (!r.ok || !r.data?.holiday) throw new Error(r.data?.error || 'Could not load holiday training.')
  H.data = r.data.holiday
  H.at = Date.now()
  return H.data
}
// Something changed it (a bank line marked as holiday, or put back).
export function holidayStale() { H.data = null; H.at = 0 }

const STATUS = { paid: ['Paid', 'green'], cancelled: ['Cancelled', 'grey'], bank: ['Bank transfer', 'blue'], 'stripe-only': ['Paid, not confirmed', 'amber'], 'no-booking': ['Booking not found', 'amber'], link: ['Payment link', 'green'], 'link-check': ['Payment link, to check', 'amber'], marked: ['Stripe, marked', 'blue'] }
const pill = (s) => `<span class="j-pill j-pill-${STATUS[s]?.[1] || 'grey'}">${esc(STATUS[s]?.[0] || s)}</span>`

// A small table that stacks into one block per row on a phone.
function stackTable(id, head, rows, foot = null) {
  return `<div class="jp-scroll"><table class="jp-table jy-table jy-stack" id="${id}"><thead><tr>${head.map((h, i) => `<th${i ? ' class="num"' : ''}>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, i) => (i ? `<td class="num" data-label="${esc(head[i])}">${c}</td>` : `<th scope="row">${c}</th>`)).join('')}</tr>`).join('')}${foot ? `<tr class="jv-total">${foot.map((c, i) => (i ? `<td class="num" data-label="${esc(head[i])}"><b>${c}</b></td>` : `<th scope="row">${c}</th>`)).join('')}</tr>` : ''}</tbody></table></div>`
}
function groupCard(id, title, sub, list) {
  return `<section class="jd-card jh-card" id="${id}"><h2>${esc(title)}</h2><p class="sub">${esc(sub)}</p>
    ${list.length ? `<ul class="jm-feelist">${list.map((g) => `<li><span>${esc(g.label)}<small>${plural(g.count, 'payment')} · taken ${esc(money(g.takenCents))}${g.refundedCents ? ` · refunded ${esc(money(g.refundedCents))}` : ''}${g.feeCents ? ` · fees ${esc(money(g.feeCents))}` : ''}</small></span><b>${esc(money(g.keptCents))}</b></li>`).join('')}</ul>` : '<p class="muted small">Nothing yet.</p>'}</section>`
}

function sheetBlock(v) {
  const rows = v.byMonth[H.basis] || []
  const total = rows.reduce((t, r) => t + r.keptCents, 0)
  return `<section class="jd-card jh-sheet" id="h-sheet"><h2 class="jm-h2help">Add to your sheet ${psHelp('Holiday training kept, per calendar month, for your month-end sheet. It is not in the "JFP / JJ / training" row.')}</h2>
    <div class="jp-seg jh-basis" role="group" aria-label="Month by" style="margin:10px 0 4px"><button type="button" data-basis="session" aria-pressed="${H.basis === 'session'}">By session date</button><button type="button" data-basis="paid" aria-pressed="${H.basis === 'paid'}">By payment date</button></div>
    <p class="muted small" id="h-basis-note">${H.basis === 'session' ? 'Each booking in the month its session is on. A bank transfer with no session date goes in the month it came in, or the holiday\'s first day if it came in before or after the holiday.' : 'Each booking in the month it was paid; each bank transfer in the month it came in.'} Refunds and fees come off the same month.</p>
    ${rows.length ? stackTable('h-months', ['Month', 'Stripe kept', 'Bank transfer', 'Kept'], rows.map((r) => [esc(r.label), esc(money(r.stripeCents)), esc(money(r.bankCents)), `<b>${esc(money(r.keptCents))}</b>`]), rows.length > 1 ? ['Total', esc(money(rows.reduce((t, r) => t + r.stripeCents, 0))), esc(money(rows.reduce((t, r) => t + r.bankCents, 0))), esc(money(total))] : null) : '<p class="muted small">Nothing in this holiday yet.</p>'}
  </section>`
}

function owedBlock(v) {
  if (!v.refundsOwed.length) return ''
  const owed = v.refundsOwed.reduce((t, x) => t + (x.owedCents || 0), 0)
  return `<section class="j-box j-box-amber jh-owed" id="h-owed"><p><b>Refunds still owed: ${plural(v.refundsOwed.length, 'booking')} · ${esc(money(owed))}</b></p>
    <p class="small" style="margin:4px 0 8px">Cancelled with a refund due, and Stripe shows no refund (or less than is due). Make the refund in Stripe; it drops off here once Stripe has it.</p>
    <ul class="jm-hist">${v.refundsOwed.map((x) => `<li><span><b>${esc(x.who || x.bookingId)}</b><small>${esc([day(x.sessionDate), hhmm(x.time), x.coach].filter(Boolean).join(' · '))} · paid ${esc(money(x.takenCents))} · refund due ${esc(money(x.refundDueCents))}${x.refundedCents ? ` · refunded ${esc(money(x.refundedCents))}` : ''}${x.stripeChecked ? '' : ' · not found in Stripe'} · ${esc(x.bookingId)}</small></span><span style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end"><span class="amt">${x.owedCents == null ? 'check' : esc(money(x.owedCents))}</span>${x.intentId ? `<a class="j-btn j-btn-line j-btn-sm" href="https://dashboard.stripe.com/payments/${esc(x.intentId)}" target="_blank" rel="noopener">Open in Stripe</a>` : ''}</span></li>`).join('')}</ul></section>`
}

// Quick links for holiday training paid with no player named (13 Oct 2026).
function checkBlock(v) {
  if (!v.toCheck?.length) return ''
  return `<section class="j-box j-box-amber jh-owed" id="h-check"><p><b>Quick links to check: ${plural(v.toCheck.length, 'payment')}</b></p>
    <p class="small" style="margin:4px 0 8px">Paid on a holiday training quick link with no player named. Look at who paid, then tick Checked. They are counted either way.</p>
    <ul class="jm-hist">${v.toCheck.map((x) => `<li><span><b>${esc(x.note || 'Payment link')}</b><small>${esc(x.who || 'Payer not known')} · paid ${esc(day(x.paidDate))} · ${esc(x.id)}</small></span><span style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end"><span class="amt">${esc(money(x.takenCents))}</span><button type="button" class="j-btn j-btn-line j-btn-sm" data-hcheck="${esc(x.id)}">Checked</button></span></li>`).join('')}</ul></section>`
}

function lineHtml(x) {
  const what = x.kind === 'bank' ? `Bank transfer · ${esc(x.who || 'no payer name')}` : x.marked ? `Stripe payment · ${esc(x.who || 'no name')}` : x.link ? `Payment link · ${esc(x.note || 'holiday training')}${x.players?.length ? ` · ${esc(x.players.join(', '))}` : ''}` : `${esc(x.typeName)}${x.seats > 1 ? ` · ${plural(x.seats, 'player')}` : ''}${x.who ? ` · ${esc(x.who)}` : ''}`
  const when = x.kind === 'bank' || x.marked ? `${x.sessionDate ? `Session ${esc(day(x.sessionDate))} · ` : ''}came in ${esc(day(x.paidDate))}` : x.link ? `Paid ${esc(day(x.paidDate))}${x.who ? ` · ${esc(x.who)}` : ''}` : `${esc(day(x.sessionDate) || 'No session date')}${x.time ? ` ${esc(hhmm(x.time))}` : ''} · paid ${esc(day(x.paidDate))}`
  const money2 = x.kind === 'bank' ? '' : ` · taken ${esc(money(x.takenCents))}${x.refundedCents ? ` · refunded ${esc(money(x.refundedCents))}` : ''} · ${x.feeCents == null ? 'fee still loading' : `fee ${esc(money(x.feeCents))}`}`
  return `<li class="jh-line" data-hline="${esc(x.id)}"><span><b>${what}</b><small>${when}</small><small>${esc(x.coach)} · ${esc(x.location)}${money2}${x.note && !x.link ? ` · ${esc(x.note)}` : ''}${x.kind === 'stripe' ? ` · ${esc(x.bookingId || x.id)}` : ''}</small></span>
    <span class="jh-right"><span class="amt">${esc(money(x.keptCents))}</span>${pill(x.status)}${x.kind === 'bank' || x.marked ? `<button type="button" class="j-btn j-btn-line j-btn-sm" data-hundo="${esc(x.id)}">Put back</button>` : ''}</span></li>`
}

// ---------- the CSV ----------

export function holidayCsv(v, { csvCell, aud }) {
  const out = []
  const add = (...cells) => out.push(cells.map(csvCell).join(','))
  const t = v.totals
  add('Holiday training money', v.label, v.range, `Downloaded ${new Date().toLocaleDateString('en-AU', { timeZone: 'Australia/Sydney' })}`)
  add('')
  add('Summary', 'A$')
  add('Taken', aud(t.takenCents))
  add('Refunded', aud(t.refundedCents))
  add('Stripe fees', aud(t.feeCents))
  add('GST in Stripe fees', aud(t.feeGstCents))
  add('Kept', aud(t.keptCents))
  add('Stripe kept', aud(t.stripe.keptCents))
  add('Bank transfer', aud(t.bank.keptCents))
  if (t.feesPending) add(`${plural(t.feesPending, 'Stripe fee')} still loading when this was downloaded`)
  for (const [basis, label] of [['session', 'by session date'], ['paid', 'by payment date']]) {
    add('')
    add(`Kept per month, ${label}`)
    add('Month', 'Stripe kept (A$)', 'Bank transfer (A$)', 'Kept (A$)')
    for (const r of v.byMonth[basis]) add(r.label, aud(r.stripeCents), aud(r.bankCents), aud(r.keptCents))
  }
  add('')
  add('Payments')
  add('Holiday', 'Session date', 'Time', 'Paid date', 'Method', 'Booking or bank line', 'Coach', 'Location', 'Session type', 'Players', 'Paid by', 'Taken (A$)', 'Refunded (A$)', 'Stripe fee (A$)', 'GST in fee (A$)', 'Kept (A$)', 'Status', 'Refund still owed (A$)')
  const names = Object.fromEntries(v.periods.map((p) => [p.id, p.label]))
  for (const x of v.lines) add(names[x.period] || x.period, x.sessionDate, x.time, x.paidDate, x.kind === 'bank' ? 'Bank transfer' : 'Stripe', x.bookingId || x.id, x.coach, x.location, x.typeName, x.seats || '', x.who, aud(x.takenCents), aud(x.refundedCents), aud(x.feeCents), aud(x.feeGstCents), aud(x.keptCents), STATUS[x.status]?.[0] || x.status, x.refundOwedCents ? aud(x.refundOwedCents) : '')
  add('Total', '', '', '', '', '', '', '', '', '', '', aud(t.takenCents), aud(t.refundedCents), aud(t.feeCents), aud(t.feeGstCents), aud(t.keptCents), '', '')
  if (v.lines.some((x) => x.feeCents == null)) add('A blank Stripe fee was not known yet when this was downloaded; kept is before that fee.')
  return out.join('\r\n')
}

// ---------- the page ----------

// ui: { view, post, toast, filter, programmeSwitch, bindSwitch, saveFile, csvCell, slug, confirm, bankStale, stale() }
// The last reading paints at once (Lee, 13 Oct 2026: switching was slow);
// the latest is read behind it and drawn quietly if nobody is busy.
export async function renderHolidayMoney(ui) {
  const { view, post } = ui
  const want = ui.filter.period || ''
  const had = H.data && (!want || H.data.period === want) ? H.data : null
  if (had) paintHoliday(ui, had)
  else {
    view().innerHTML = `${moneyHead({ controls: ui.programmeSwitch, loading: true, refresh: '' })}<p class="muted">Loading holiday training from the booking system and Stripe</p>`
    ui.bindSwitch()
  }
  if (had && Date.now() - H.at < 60000 && !had.quick) return
  let v
  try { v = await holidayData(post, { period: want, quick: !had, force: true }) } catch (e) {
    if (had || ui.stale?.()) return
    view().innerHTML = `${moneyHead({ controls: ui.programmeSwitch, refresh: '' })}<div class="j-box j-box-red">${esc(e.message)} Nothing is shown rather than a wrong total. Try again in a minute.</div><button type="button" class="j-btn j-btn-line j-btn-sm" id="h-retry" style="margin-top:10px">Try again</button>`
    view().querySelector('#h-retry').addEventListener('click', () => { holidayStale(); renderHolidayMoney(ui) })
    ui.bindSwitch()
    return
  }
  if (ui.stale?.()) return
  const redraw = (x) => { const y = window.scrollY; paintHoliday(ui, x); window.scrollTo(0, y) }
  if (!had || quietOk()) redraw(v); else markUpdated(view(), v.stripeAt)
  if (v.quick) {
    const later = await holidayData(post, { period: v.period, force: true }).catch(() => null)
    if (later && !ui.stale?.() && quietOk()) redraw(later)
  }
}

function paintHoliday(ui, v) {
  const { view, post, toast } = ui
  ui.filter.period = v.period
  setHolidayHash(v.period)
  const t = v.totals
  const owed = v.refundsOwed.reduce((x, r) => x + (r.owedCents || 0), 0)
  const picker = `<label class="jm-show"><span class="muted small">Holiday</span><select class="j-select" id="h-period">${v.periods.map((p) => `<option value="${esc(p.id)}"${p.id === v.period ? ' selected' : ''}>${esc(p.label)}${p.count ? ` · ${esc(money(p.keptCents))}` : ' · nothing yet'}</option>`).join('')}</select></label>`
  const tiles = [
    ['stripe', 'Stripe', t.stripe.keptCents, '--c-series-1', t.stripe.count ? `${plural(t.stripe.count, 'booking')} · fees ${money(t.stripe.feeCents)}` : 'No bookings'],
    ['bank', 'Bank transfer', t.bank.keptCents, '--c-series-2', t.bank.count ? plural(t.bank.count, 'transfer') : 'None marked yet'],
    ['refunds', 'Refunded', t.refundedCents, '--c-neutral', t.refundedCents ? 'in Stripe' : 'None'],
    ['owed', 'Refunds still owed', owed, '--c-critical', v.refundsOwed.length ? plural(v.refundsOwed.length, 'booking') : 'None'],
  ]
  view().innerHTML = `
    ${moneyHead({ controls: `${ui.programmeSwitch}${picker}<button type="button" class="j-btn j-btn-line j-btn-sm" id="h-csv">Download CSV</button>`, at: v.stripeAt || new Date().toISOString(), note: v.range ? `<span id="h-range">${esc(v.range)}</span>` : '', tip: `Bookings paid in Stripe, and bank transfers you marked as holiday training. Not in the JFP figures. ${esc(HOLIDAY_DEFINITION)}`, refresh: 'h-refresh' })}
    ${v.stripeError ? `<div class="j-box j-box-amber" style="margin-bottom:10px">${esc(v.stripeError)}</div>` : ''}
    <div class="jd-grid">
      <section class="jd-card jd-hero jm-hero jm-net" style="--i:0"><div>
        <p class="lbl">Kept after Stripe fees · ${esc(v.label)}</p>
        <p class="big" id="h-kept">${esc(money(t.keptCents))}</p>
        <p class="jm-sum" id="h-sum"><span>Taken <b>${esc(money(t.takenCents))}</b></span> · <span>Refunded <b>${esc(money(t.refundedCents))}</b></span> · <span>Stripe fees <b>${esc(money(t.feeCents))}</b></span></p>
        ${t.feesPending ? `<p class="jm-pending" id="h-pending">${plural(t.feesPending, 'fee')} still loading</p>` : ''}</div>
      </section>
      <div class="jm-tiles" data-n="4">${tiles.map(([key, l, val, c, note], i) => `<section class="jd-card jd-tile jm-tile" style="--i:${i + 1}" data-htile="${key}"><span class="lbl"><span class="jd-key"><i style="background:var(${c})"></i>${l}</span></span><span class="val">${esc(money(val || 0))}</span><span class="note">${esc(note)}</span></section>`).join('')}</div>
    </div>
    ${owedBlock(v)}
    ${checkBlock(v)}
    <div id="h-sheet-wrap">${sheetBlock(v)}</div>
    <div class="jh-groups">
      ${groupCard('h-coach', 'By coach', 'Kept, by who ran the session', v.byCoach)}
      ${groupCard('h-loc', 'By location', 'Kept, by where it was', v.byLocation)}
      ${groupCard('h-type', 'By session type', '1 on 1, shared or small group, and the price a player', v.byType)}
    </div>
    <section class="jd-card jh-list" id="h-lines"><h2>Bookings and transfers</h2><p class="sub">${plural(v.lines.length, 'payment')} in ${esc(v.label)}, newest session first</p>
      ${v.lines.length ? `<ul class="jm-hist">${v.lines.map(lineHtml).join('')}</ul>` : '<p class="muted small">Nothing in this holiday yet. Mark bank transfers in Money &gt; Bank payments.</p>'}</section>`
  ui.bindSwitch()
  bindTip(view())
  view().querySelector('#h-period').addEventListener('change', (e) => { ui.filter.period = e.target.value; holidayStale(); renderHolidayMoney(ui) })
  view().querySelector('#h-refresh').addEventListener('click', async (e) => {
    e.currentTarget.disabled = true
    try { await holidayData(post, { period: v.period, fresh: true }); toast('Up to date with Stripe') } catch (err) { toast(err.message) }
    renderHolidayMoney(ui)
  })
  view().querySelector('#h-csv').addEventListener('click', () => ui.saveFile(`jfp-holiday-training-${ui.slug(v.label)}.csv`, holidayCsv(v, ui)))
  view().querySelector('#h-sheet-wrap').addEventListener('click', (e) => {
    const b = e.target.closest('[data-basis]')
    if (!b || b.dataset.basis === H.basis) return
    H.basis = b.dataset.basis
    view().querySelector('#h-sheet-wrap').innerHTML = sheetBlock(v)
  })
  view().querySelector('#h-check')?.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-hcheck]')
    if (!b) return
    b.disabled = true
    const r = await post('quickLinkChecked', { id: b.dataset.hcheck })
    if (!r.ok) { b.disabled = false; return toast(r.data.error) }
    toast('Checked')
    holidayStale()
    renderHolidayMoney(ui)
  })
  view().querySelector('#h-lines').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-hundo]')
    if (!b) return
    const x = v.lines.find((l) => l.id === b.dataset.hundo)
    // A Stripe payment marked from Unmatched Stripe goes back to JFP payments.
    const where = x.marked ? 'in JFP payments (Unmatched Stripe)' : 'on Bank transfers to check'
    if (!(await ui.confirm(`Put <b>${esc(money(x.takenCents))}</b> from ${esc(x.who || (x.marked ? 'Stripe' : 'the bank'))} back ${where}? It comes out of holiday training.`, { ok: 'Put it back' }))) return
    b.disabled = true
    const r = await post(x.marked ? 'stripeHolidayUndo' : 'bankHolidayUndo', { id: x.id })
    if (!r.ok) { b.disabled = false; return toast(r.data.error) }
    toast(`Back ${where}`)
    ui.bankStale?.()
    holidayStale()
    renderHolidayMoney(ui)
  })
}
