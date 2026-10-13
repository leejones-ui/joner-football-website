// Money > Pro sessions (Lee, 13 Oct 2026): money taken for Pro sessions,
// apart from JFP. Stripe payments on Pro links (with the real Stripe fee on
// each), cash and bank transfers recorded on Pro players, and bank lines
// marked "Pro session" on Bank transfers to check. By month, by player, and
// a download. Read only, except putting a marked bank line back.
import { esc, money } from './jfp-common.js'
import { moneyHead, bindTip, programmeSwitch, bindSwitch, remember, recall, quietOk, markUpdated } from './jfp-portal-programmes.js'

export const PRO_DEFINITION = 'Pro sessions: Stripe payments on Pro links (the real Stripe fee on each, from Stripe), cash and bank transfers recorded on Pro players, and bank transfers you marked "Pro session" on Money &gt; JFP &gt; Bank transfers to check. Kept = taken less refunds and Stripe fees. Billed and owing come from the players\' rows in Airtable. None of it is in the JFP figures.'
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const day = (iso) => (iso ? new Date(`${String(iso).slice(0, 10)}T00:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '')
const KIND = { stripe: ['Stripe', 'blue'], bank: ['Bank transfer', 'violet'], cash: ['Cash', 'green'], other: ['Other', 'grey'] }
const key = (month) => `pro:${month || ''}`

export async function proData(post, { month = '', fresh = false, quick = false } = {}) {
  const r = await post('proMoney', { ...(month ? { month } : {}), ...(fresh ? { fresh: true } : {}), ...(quick ? { quick: true } : {}) })
  if (!r.ok || !r.data?.pro) throw new Error(r.data?.error || 'Could not load Pro sessions.')
  remember(key(month), r.data.pro)
  return r.data.pro
}

function stackTable(id, head, rows, foot = null) {
  return `<div class="jp-scroll"><table class="jp-table jy-table jy-stack" id="${id}"><thead><tr>${head.map((h, i) => `<th${i ? ' class="num"' : ''}>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, i) => (i ? `<td class="num" data-label="${esc(head[i])}">${c}</td>` : `<th scope="row">${c}</th>`)).join('')}</tr>`).join('')}${foot ? `<tr class="jv-total">${foot.map((c, i) => (i ? `<td class="num" data-label="${esc(head[i])}"><b>${c}</b></td>` : `<th scope="row">${c}</th>`)).join('')}</tr>` : ''}</tbody></table></div>`
}

export function proCsv(v, { csvCell, aud }) {
  const out = []
  const add = (...cells) => out.push(cells.map(csvCell).join(','))
  const t = v.totals
  add('Pro sessions money', v.month ? v.months.find((m) => m.id === v.month)?.label || v.month : 'Every month', `Downloaded ${new Date().toLocaleDateString('en-AU', { timeZone: 'Australia/Sydney' })}`)
  add('')
  add('Summary', 'A$')
  add('Taken', aud(t.takenCents)); add('Refunded', aud(t.refundedCents)); add('Stripe fees', aud(t.feeCents)); add('GST in Stripe fees', aud(t.feeGstCents)); add('Kept', aud(t.keptCents))
  add('Stripe kept', aud(t.stripe.keptCents)); add('Bank transfer', aud(t.bank.keptCents)); add('Cash and other', aud(t.cash.keptCents))
  add('Billed so far (Airtable)', aud(t.billedCents)); add('Still owing (Airtable)', aud(t.owingCents))
  if (t.feesPending) add(`${plural(t.feesPending, 'Stripe fee')} still loading when this was downloaded`)
  add('')
  add('By month (payment date)')
  add('Month', 'Taken (A$)', 'Refunded (A$)', 'Stripe fees (A$)', 'Kept (A$)', 'Stripe kept (A$)', 'Bank transfer (A$)', 'Cash and other (A$)')
  for (const r of v.byMonth) add(r.label, aud(r.takenCents), aud(r.refundedCents), aud(r.feeCents), aud(r.keptCents), aud(r.stripeCents), aud(r.bankCents), aud(r.cashCents))
  add('')
  add('By player')
  add('Player', 'Billed so far (A$)', 'Paid in Airtable (A$)', 'Owing (A$)', 'Taken here (A$)', 'Kept here (A$)')
  for (const p of v.byPlayer) add(p.player, aud(p.billedCents), aud(p.paidCents), aud(p.owingCents), aud(p.takenCents), aud(p.keptCents))
  if (v.unmatched) add('Not matched to a player', '', '', '', aud(v.unmatched.takenCents), aud(v.unmatched.keptCents))
  add('')
  add('Payments')
  add('Date', 'Method', 'For', 'Paid by', 'Taken (A$)', 'Refunded (A$)', 'Stripe fee (A$)', 'GST in fee (A$)', 'Kept (A$)', 'Reference')
  for (const x of v.lines) add(x.paidDate, x.method, x.who || 'Not matched to a player', x.payer, aud(x.takenCents), aud(x.refundedCents), aud(x.feeCents), aud(x.feeGstCents), aud(x.keptCents), x.id)
  add('Total', '', '', '', aud(t.takenCents), aud(t.refundedCents), aud(t.feeCents), aud(t.feeGstCents), aud(t.keptCents), '')
  if (v.lines.some((x) => x.feeCents == null)) add('A blank Stripe fee was not known yet when this was downloaded; kept is before that fee.')
  return out.join('\r\n')
}

function lineHtml(x) {
  const k = KIND[x.kind] || KIND.other
  const money2 = x.kind === 'stripe' ? ` · taken ${esc(money(x.takenCents))}${x.refundedCents ? ` · refunded ${esc(money(x.refundedCents))}` : ''} · ${x.feeCents == null ? 'fee still loading' : `fee ${esc(money(x.feeCents))}`}` : ''
  return `<li class="jh-line" data-pline="${esc(x.id)}"><span><b>${esc(x.who || 'Not matched to a player')}</b><small>${esc(day(x.paidDate))}${x.sessionDate ? ` · session ${esc(day(x.sessionDate))}` : ''}${x.payer && x.payer !== x.who ? ` · from ${esc(x.payer)}` : ''}${x.note ? ` · ${esc(x.note)}` : ''}</small><small>${esc(k[0])}${money2}</small></span>
    <span class="jh-right"><span class="amt">${esc(money(x.keptCents))}</span><span class="j-pill j-pill-${k[1]}">${esc(k[0])}</span>${x.marked ? `<button type="button" class="j-btn j-btn-line j-btn-sm" data-pundo="${esc(x.id)}">Put back</button>` : ''}</span></li>`
}

function setHash(month) { history.replaceState(null, '', `#money?programme=pro${month ? `&month=${encodeURIComponent(month)}` : ''}`) }

function draw(ui, v) {
  const t = v.totals
  ui.filter.month = v.month
  setHash(v.month)
  const label = v.month ? v.months.find((m) => m.id === v.month)?.label || v.month : 'Every month'
  const picker = `<label class="jm-show"><span class="muted small">Showing</span><select class="j-select" id="p-month"><option value="">Every month</option>${v.months.map((m) => `<option value="${esc(m.id)}"${m.id === v.month ? ' selected' : ''}>${esc(m.label)}</option>`).join('')}</select></label>`
  const tiles = [
    ['stripe', 'Stripe', t.stripe.keptCents, '--c-series-1', t.stripe.count ? `${plural(t.stripe.count, 'payment')} · fees ${money(t.stripe.feeCents)}` : 'None yet'],
    ['bank', 'Bank transfer', t.bank.keptCents, '--c-series-2', t.bank.count ? plural(t.bank.count, 'transfer') : 'None yet'],
    ['cash', 'Cash and other', t.cash.keptCents, '--c-series-3', t.cash.count ? plural(t.cash.count, 'payment') : 'None'],
    ['owing', 'Still owing', t.owingCents, '--c-critical', `${money(t.billedCents)} billed so far`],
  ]
  ui.view().innerHTML = `
    ${moneyHead({ controls: `${programmeSwitch('pro')}${picker}<button type="button" class="j-btn j-btn-line j-btn-sm" id="p-csv">Download CSV</button>`, at: v.at, tip: PRO_DEFINITION, refresh: 'p-refresh' })}
    ${v.stripeError ? `<div class="j-box j-box-amber" style="margin-bottom:10px">${esc(v.stripeError)}</div>` : ''}
    <div class="jd-grid">
      <section class="jd-card jd-hero jm-hero jm-net" style="--i:0"><div>
        <p class="lbl">Kept after Stripe fees · ${esc(label)}</p>
        <p class="big" id="p-kept">${esc(money(t.keptCents))}</p>
        <p class="jm-sum" id="p-sum"><span>Taken <b>${esc(money(t.takenCents))}</b></span> · <span>Refunded <b>${esc(money(t.refundedCents))}</b></span> · <span>Stripe fees <b>${esc(money(t.feeCents))}</b></span></p>
        ${t.feesPending ? `<p class="jm-pending">${plural(t.feesPending, 'fee')} still loading</p>` : ''}</div>
      </section>
      <div class="jm-tiles" data-n="4">${tiles.map(([k, l, val, c, note], i) => `<section class="jd-card jd-tile jm-tile" style="--i:${i + 1}" data-ptile="${k}"><span class="lbl"><span class="jd-key"><i style="background:var(${c})"></i>${l}</span></span><span class="val">${esc(money(val || 0))}</span><span class="note">${esc(note)}</span></section>`).join('')}</div>
    </div>
    ${v.toCheck.length ? `<section class="j-box j-box-amber jh-owed" id="p-check"><p><b>Pro quick links to check: ${plural(v.toCheck.length, 'payment')}</b></p><p class="small" style="margin:4px 0 8px">Paid on a Pro quick link with no player named. They are counted; look at who paid in Payment links.</p><ul class="jm-hist">${v.toCheck.map((x) => `<li><span><b>${esc(x.note || 'Quick link')}</b><small>${esc(x.who || 'Payer not known')} · paid ${esc(day(x.paidDate))}</small></span><span class="amt">${esc(money(x.takenCents))}</span></li>`).join('')}</ul></section>` : ''}
    <section class="jd-card jh-sheet" id="p-months-card"><h2>By month</h2><p class="sub">By the day the money came in. Refunds and fees come off the same month.</p>
      ${v.byMonth.length ? stackTable('p-months', ['Month', 'Taken', 'Refunded', 'Stripe fees', 'Kept'], v.byMonth.map((r) => [esc(r.label), esc(money(r.takenCents)), esc(money(r.refundedCents)), esc(money(r.feeCents)), `<b>${esc(money(r.keptCents))}</b>`]), v.byMonth.length > 1 ? ['Total', esc(money(t.takenCents)), esc(money(t.refundedCents)), esc(money(t.feeCents)), esc(money(t.keptCents))] : null) : '<p class="muted small">No Pro money yet.</p>'}
    </section>
    <section class="jd-card jh-sheet" id="p-players-card"><h2>By player</h2><p class="sub">Billed and paid so far from Airtable; taken and kept ${v.month ? `in ${esc(label)}` : 'here'}.</p>
      ${v.byPlayer.length || v.unmatched ? stackTable('p-players', ['Player', 'Billed', 'Paid', 'Owing', 'Kept'], [...v.byPlayer.map((p) => [`${esc(p.player)}${p.perSessionCents ? ` <small class="muted">${esc(money(p.perSessionCents))} a session</small>` : ''}${p.prepaidSessions ? ` <small class="muted">${esc(p.prepaidSessions)} prepaid</small>` : ''}`, esc(money(p.billedCents)), esc(money(p.paidCents)), p.owingCents ? `<b>${esc(money(p.owingCents))}</b>` : '<span class="muted">0</span>', esc(money(p.keptCents))]), ...(v.unmatched ? [['<span class="muted">Not matched to a player</span>', '', '', '', esc(money(v.unmatched.keptCents))]] : [])]) : '<p class="muted small">No Pro players yet. A player is Pro when their payment type is JFP Pro sessions.</p>'}
    </section>
    <section class="jd-card jh-list" id="p-lines"><h2>Payments</h2><p class="sub">${plural(v.lines.length, 'payment')}, newest first</p>
      ${v.lines.length ? `<ul class="jm-hist">${v.lines.map(lineHtml).join('')}</ul>` : '<p class="muted small">Nothing yet. Bank transfers for Pro sessions are marked on Money &gt; JFP &gt; Bank transfers to check.</p>'}</section>`
  bindTip(ui.view())
  bindSwitch(ui)
  const v$ = (s) => ui.view().querySelector(s)
  v$('#p-month').addEventListener('change', (e) => { ui.filter.month = e.target.value; renderProMoney(ui) })
  v$('#p-refresh').addEventListener('click', async (e) => {
    e.currentTarget.disabled = true
    try { await proData(ui.post, { month: v.month, fresh: true }); ui.toast('Up to date with Stripe and Airtable') } catch (err) { ui.toast(err.message) }
    renderProMoney(ui)
  })
  v$('#p-csv').addEventListener('click', () => ui.saveFile(`jfp-pro-sessions-${ui.slug(label)}.csv`, proCsv(v, ui)))
  v$('#p-lines').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-pundo]')
    if (!b) return
    const x = v.lines.find((l) => l.id === b.dataset.pundo)
    if (!(await ui.confirm(`Put <b>${esc(money(x.takenCents))}</b> from ${esc(x.payer || 'the bank')} back on Bank transfers to check? It comes out of Pro sessions.`, { ok: 'Put it back' }))) return
    b.disabled = true
    const r = await ui.post('bankProUndo', { id: x.id })
    if (!r.ok) { b.disabled = false; return ui.toast(r.data.error) }
    ui.toast('Back on Bank transfers to check')
    ui.bankStale?.()
    await proData(ui.post, { month: v.month }).catch(() => {})
    renderProMoney(ui)
  })
}

// ui: { view, post, toast, filter, go, confirm, saveFile, csvCell, aud, slug, bankStale, stale() }
// The last reading paints at once; the latest is read behind it.
export async function renderProMoney(ui) {
  const month = ui.filter.month || ''
  const hit = recall(key(month))
  if (hit) draw(ui, hit.data)
  else {
    ui.view().innerHTML = `${moneyHead({ controls: programmeSwitch('pro'), loading: true, refresh: '' })}<p class="muted">Loading Pro sessions</p>`
    bindSwitch(ui)
  }
  if (hit && Date.now() - hit.at < 30000 && !hit.data.quick) return
  let v
  try { v = await proData(ui.post, { month, quick: !hit }) } catch (e) {
    if (hit || ui.stale()) return
    ui.view().innerHTML = `${moneyHead({ controls: programmeSwitch('pro'), refresh: '' })}<div class="j-box j-box-red">${esc(e.message)} Nothing is shown rather than a wrong total. Try again in a minute.</div><button type="button" class="j-btn j-btn-line j-btn-sm" id="p-retry" style="margin-top:10px">Try again</button>`
    bindSwitch(ui)
    ui.view().querySelector('#p-retry').addEventListener('click', () => renderProMoney(ui))
    return
  }
  if (ui.stale()) return
  if (!hit || quietOk()) { const y = window.scrollY; draw(ui, v); window.scrollTo(0, y) } else markUpdated(ui.view(), v.at)
  // A first paint from the last Stripe read: the latest behind it.
  if (v.quick) {
    const later = await proData(ui.post, { month }).catch(() => null)
    if (later && !ui.stale() && quietOk()) { const y = window.scrollY; draw(ui, later); window.scrollTo(0, y) }
  }
}
