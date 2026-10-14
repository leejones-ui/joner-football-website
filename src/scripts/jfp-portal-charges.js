// Money > Extra sessions (Lee, 14 Oct 2026): extra sessions and video analysis
// charged to a player on top of their term (api/_jfp-charges.js). Taken, fees
// and kept, by coach, by month and by player, what is still to pay, and New
// charge (for testing and offline bookings). Never in the JFP figures.
//
// ui: { view, post, toast, modal, closeModal, confirm, copy, board(), pricing(), filter, go, saveFile, csvCell, aud, stale() }
import { esc, money } from './jfp-common.js'
import { moneyHead, bindTip, programmeSwitch, bindSwitch, remember, recall, quietOk } from './jfp-portal-programmes.js'

export const EXTRA_DEFINITION = 'Extra sessions: extra sessions and video analysis charged to a player on top of their term, paid from My account (card), or recorded here as a bank transfer or cash, and Stripe payments you matched to a player as an extra session. Kept = taken less refunds and Stripe fees. None of it is in the JFP figures.'
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const day = (iso) => (iso ? new Date(`${String(iso).slice(0, 10)}T00:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '')
const cents = (v) => Math.round(Number(String(v ?? '').replace(/[^0-9.]/g, '')) * 100)
const KIND = { stripe: ['Stripe', 'blue'], bank: ['Bank transfer', 'violet'], cash: ['Cash', 'green'], other: ['Other', 'grey'] }
const ST_PILL = { open: 'red', part: 'orange', paid: 'green', cancelled: 'grey' }
const key = (month) => `extra:${month || ''}`

export async function extraData(post, { month = '' } = {}) {
  const r = await post('extraMoney', month ? { month } : {})
  if (!r.ok || !r.data?.extra) throw new Error(r.data?.error || 'Could not load Extra sessions.')
  remember(key(month), r.data.extra)
  return r.data.extra
}

// ---------- the player picker (also used by invoices) ----------

// A search box over the board; chosen players show as chips. one: a single player.
export function playerPicker(ui, box, prefix, { one = false, onChange = () => {} } = {}) {
  const picked = []
  const q = box.querySelector(`#${prefix}-q`), res = box.querySelector(`#${prefix}-res`), chosen = box.querySelector(`#${prefix}-chosen`)
  const draw = () => {
    chosen.innerHTML = picked.map((x, i) => `<div class="jq-chosen"><span><b>${esc(x.name)}</b><small>${esc(x.where)}${x.parent ? ` · ${esc(x.parent)}` : ''}</small></span><button type="button" class="j-btn j-btn-line j-btn-sm" data-unpick="${i}">Remove</button></div>`).join('')
    q.hidden = one && picked.length > 0
    onChange(picked)
  }
  chosen.addEventListener('click', (e) => { const b = e.target.closest('[data-unpick]'); if (!b) return; picked.splice(Number(b.dataset.unpick), 1); draw() })
  q.addEventListener('input', async (e) => {
    const s = e.target.value.trim().toLowerCase()
    const b = s.length < 2 ? null : await ui.board()
    const all = b ? b.groups.flatMap((g) => g.players.filter((p) => !p.juniors).map((p) => ({ p, g }))).concat(b.unassigned.map((p) => ({ p, g: null }))) : []
    const hits = [...new Map(all.filter(({ p }) => `${p.name} ${p.parent || ''}`.toLowerCase().includes(s)).map((x) => [x.p.rowId, x])).values()].slice(0, 8)
    res.innerHTML = hits.map(({ p, g }, i) => `<button type="button" class="j-player" data-i="${i}"><span><b>${esc(p.name)}</b><br><span class="muted small">${g ? `${esc(g.day)} ${esc(g.time)}` : 'Not in a group'}${p.parent ? ` · ${esc(p.parent)}` : ''}</span></span></button>`).join('')
    res.querySelectorAll('[data-i]').forEach((x) => x.addEventListener('click', () => {
      const { p, g } = hits[Number(x.dataset.i)]
      if (!picked.some((y) => y.rowId === p.rowId)) picked.push({ rowId: p.rowId, name: p.name, parent: p.parent || '', email: p.email || '', where: g ? `${g.day} ${g.time}` : 'Not in a group' })
      res.innerHTML = ''; q.value = ''
      draw()
    }))
  })
  return { picked, add: (x) => { picked.push(x); draw() } }
}
export const pickerHtml = (prefix, label) => `<div class="j-field"><span>${esc(label)}</span><div id="${prefix}-chosen"></div><input class="j-input" id="${prefix}-q" placeholder="Search a player or parent" autocomplete="off"><div id="${prefix}-res"></div></div>`

// ---------- New charge ----------

export async function chargeModal(ui, { onDone = () => {} } = {}) {
  const pr = await ui.pricing().catch(() => null)
  const prices = (pr?.priceList || []).filter((p) => !p.archived && ['extra', 'pro'].includes(p.programme))
  const coaches = pr?.coaches || (await ui.coaches?.()) || []
  const ref = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const box = ui.modal(`<h2 style="margin-bottom:4px">New charge</h2><p class="muted small" style="margin-bottom:12px">An extra session or video analysis for one player. It shows in the family's My account, on Home and in Fees, with Pay. Nothing is emailed.</p>
    ${pickerHtml('ch', 'Player')}
    <div class="j-two"><label class="j-field"><span>What</span><select class="j-select" id="ch-kind"><option value="extra">Extra session</option><option value="analysis">Video analysis</option></select></label>
    <label class="j-field"><span>Price</span><select class="j-select" id="ch-price"><option value="">Type an amount</option>${prices.map((p) => `<option value="${esc(p.id)}" data-cents="${p.cents}" data-name="${esc(p.name)}">${esc(p.name)} · ${esc(p.amountLabel || money(p.cents))}</option>`).join('')}</select></label></div>
    <div class="j-two"><label class="j-field"><span>Amount (A$)</span><input class="j-input" id="ch-amt" inputmode="decimal"></label>
    <label class="j-field"><span>Session date (optional)</span><input class="j-input" id="ch-date" type="date"></label></div>
    <div class="j-two"><label class="j-field"><span>Label</span><input class="j-input" id="ch-label" maxlength="120" placeholder="e.g. Extra session, Saturday"></label>
    <label class="j-field"><span>Coach (optional)</span><select class="j-select" id="ch-coach"><option value="">No coach</option>${coaches.map((c) => `<option value="${esc(c.id)}">${esc(c.name || c.fullName)}</option>`).join('')}</select></label></div>
    <p class="j-err" id="ch-err" hidden></p>
    <div class="jq-foot"><button type="button" class="j-btn j-btn-line" data-close>Cancel</button><button type="button" class="j-btn j-btn-dark" id="ch-go">Create charge</button></div>`, { wide: true })
  const $ = (id) => box.querySelector(`#${id}`)
  const pick = playerPicker(ui, box, 'ch', { one: true })
  $('ch-price').addEventListener('change', (e) => { const o = e.target.selectedOptions[0]; if (o?.dataset.cents) { $('ch-amt').value = (Number(o.dataset.cents) / 100).toFixed(2).replace(/\.00$/, ''); if (!$('ch-label').value) $('ch-label').value = o.dataset.name } })
  $('ch-go').addEventListener('click', async () => {
    const err = $('ch-err')
    err.hidden = true
    const p = pick.picked[0]
    if (!p) { err.textContent = 'Choose the player.'; err.hidden = false; return }
    const amountCents = cents($('ch-amt').value)
    if (!(amountCents >= 100)) { err.textContent = 'Enter the amount.'; err.hidden = false; return }
    $('ch-go').disabled = true
    const r = await ui.post('createCharge', { rowId: p.rowId, kind: $('ch-kind').value, amountCents, sessionDate: $('ch-date').value, label: $('ch-label').value.trim(), coachId: $('ch-coach').value, ref })
    $('ch-go').disabled = false
    if (!r.ok) { err.textContent = r.data.error; err.hidden = false; return }
    ui.closeModal()
    ui.toast(`Charge made: ${r.data.charge.player}, ${money(r.data.charge.amountCents)}. It is in their My account.`)
    onDone(r.data)
  })
}

function payModal(ui, c, onDone) {
  const box = ui.modal(`<h2 style="margin-bottom:4px">Record a payment</h2><p class="muted small" style="margin-bottom:12px">${esc(c.player)} · ${esc(c.label)} · ${esc(money(c.owingCents))} to pay</p>
    <div class="j-two"><label class="j-field"><span>How</span><select class="j-select" id="cp-m"><option value="bank">Bank transfer</option><option value="cash">Cash</option><option value="other">Other</option></select></label>
    <label class="j-field"><span>Amount (A$)</span><input class="j-input" id="cp-amt" inputmode="decimal" value="${(c.owingCents / 100).toFixed(2).replace(/\.00$/, '')}"></label></div>
    <label class="j-field"><span>Date</span><input class="j-input" id="cp-date" type="date" value="${new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' })}"></label>
    <p class="j-err" id="cp-err" hidden></p>
    <div class="jq-foot"><button type="button" class="j-btn j-btn-line" data-close>Cancel</button><button type="button" class="j-btn j-btn-dark" id="cp-go">Record</button></div>`)
  box.querySelector('#cp-go').addEventListener('click', async () => {
    const r = await ui.post('chargeRecord', { id: c.id, method: box.querySelector('#cp-m').value, amountCents: cents(box.querySelector('#cp-amt').value), date: box.querySelector('#cp-date').value })
    if (!r.ok) { const e = box.querySelector('#cp-err'); e.textContent = r.data.error; e.hidden = false; return }
    ui.closeModal(); ui.toast(r.data.warning || 'Recorded'); onDone()
  })
}

// ---------- the view ----------

function table(id, head, rows) {
  return `<div class="jp-scroll"><table class="jp-table jy-table jy-stack" id="${id}"><thead><tr>${head.map((h, i) => `<th${i ? ' class="num"' : ''}>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, i) => (i ? `<td class="num" data-label="${esc(head[i])}">${c}</td>` : `<th scope="row">${c}</th>`)).join('')}</tr>`).join('')}</tbody></table></div>`
}
const groupRows = (list) => list.map((g) => [esc(g.label), esc(String(g.count)), esc(money(g.takenCents)), esc(money(g.feeCents)), `<b>${esc(money(g.keptCents))}</b>`])

export function extraCsv(v, { csvCell, aud }) {
  const out = []
  const add = (...cells) => out.push(cells.map(csvCell).join(','))
  add('Extra sessions money', v.month ? v.months.find((m) => m.id === v.month)?.label || v.month : 'Every month')
  add('Taken', aud(v.totals.takenCents)); add('Refunded', aud(v.totals.refundedCents)); add('Stripe fees', aud(v.totals.feeCents)); add('Kept', aud(v.totals.keptCents)); add('Still to pay', aud(v.totals.owingCents))
  add('')
  add('Date', 'Method', 'Player', 'For', 'Session', 'Coach', 'Taken (A$)', 'Refunded (A$)', 'Stripe fee (A$)', 'Kept (A$)', 'Reference')
  for (const x of v.lines) add(x.paidDate, x.method, x.who, x.note, x.sessionDate, x.coach, aud(x.takenCents), aud(x.refundedCents), aud(x.feeCents), aud(x.keptCents), x.chargeId || x.id)
  return out.join('\r\n')
}

function draw(ui, v) {
  const t = v.totals
  ui.filter.month = v.month
  history.replaceState(null, '', `#money?programme=extra${v.month ? `&month=${encodeURIComponent(v.month)}` : ''}`)
  const picker = `<label class="jm-show"><span class="muted small">Showing</span><select class="j-select" id="x-month"><option value="">Every month</option>${v.months.map((m) => `<option value="${esc(m.id)}"${m.id === v.month ? ' selected' : ''}>${esc(m.label)}</option>`).join('')}</select></label>`
  const tiles = [['Taken', t.takenCents, `${plural(t.count, 'payment')}`], ['Stripe fees', t.feeCents, t.feesPending ? `${plural(t.feesPending, 'fee')} still loading` : 'From Stripe'], ['Kept', t.keptCents, `Stripe ${money(t.stripe.keptCents)} · bank ${money(t.bank.keptCents)} · cash ${money(t.cash.keptCents)}`], ['Still to pay', t.owingCents, `${plural(t.openCount, 'charge')} open`]]
  ui.view().innerHTML = `
    ${moneyHead({ controls: `${programmeSwitch('extra')}${picker}<button type="button" class="j-btn j-btn-dark j-btn-sm" id="x-new">+ New charge</button><button type="button" class="j-btn j-btn-line j-btn-sm" id="x-csv">Download CSV</button>`, at: v.at, tip: EXTRA_DEFINITION, refresh: 'x-refresh' })}
    <div class="jd-grid" id="x-tiles">${tiles.map(([l, c, s], i) => `<section class="jd-card" style="--i:${i}"><p class="muted small">${esc(l)}</p><p style="font-size:24px;font-weight:800;margin:4px 0">${esc(money(c))}</p><p class="muted small">${esc(s)}</p></section>`).join('')}</div>
    <section class="jd-card" style="margin-top:16px"><h2 style="font-size:17px">Still to pay</h2>
      ${v.open.length ? `<ul class="jm-hist" id="x-open">${v.open.map((c) => `<li data-charge="${esc(c.id)}"><span><b>${esc(c.player)}</b><small>${esc(c.label)}${c.sessionDate ? ` · ${esc(day(c.sessionDate))}` : ''}${c.coach ? ` · ${esc(c.coach)}` : ''} · made ${esc(day(c.createdAt))}</small></span><span style="display:flex;gap:8px;align-items:center"><span class="amt">${esc(money(c.owingCents))}</span><span class="j-pill j-pill-${ST_PILL[c.status]}">${esc(c.statusLabel)}</span><button type="button" class="j-btn j-btn-line j-btn-sm" data-xpay>Record payment</button>${c.invoiceId ? '' : '<button type="button" class="j-btn j-btn-ghost j-btn-sm" data-xcancel>Cancel</button>'}</span></li>`).join('')}</ul>` : '<p class="muted small">Nothing waiting.</p>'}
    </section>
    ${v.toCheck.length ? `<section class="jd-card" style="margin-top:16px"><h2 style="font-size:17px">Quick links to check</h2><p class="muted small">Paid on an Extra sessions quick link with no player named.</p><ul class="jm-hist">${v.toCheck.map((x) => `<li><span><b>${esc(x.who || 'No name')}</b><small>${esc(day(x.paidDate))} · ${esc(x.note)}</small></span><span class="amt">${esc(money(x.takenCents))}</span></li>`).join('')}</ul></section>` : ''}
    <div class="jd-grid" style="margin-top:16px">
      <section class="jd-card"><h2 style="font-size:17px">By coach</h2>${v.byCoach.length ? table('x-coach', ['Coach', 'Payments', 'Taken', 'Fees', 'Kept'], groupRows(v.byCoach)) : '<p class="muted small">No payments yet.</p>'}</section>
      <section class="jd-card"><h2 style="font-size:17px">By month</h2>${v.byMonth.length ? table('x-bymonth', ['Month', 'Payments', 'Taken', 'Fees', 'Kept'], groupRows(v.byMonth)) : '<p class="muted small">No payments yet.</p>'}</section>
    </div>
    <section class="jd-card" style="margin-top:16px"><h2 style="font-size:17px">By player</h2>${v.byPlayer.length ? table('x-player', ['Player', 'Payments', 'Taken', 'Fees', 'Kept'], groupRows(v.byPlayer)) : '<p class="muted small">No payments yet.</p>'}</section>
    <section class="jd-card" style="margin-top:16px"><h2 style="font-size:17px">Payments</h2>${v.lines.length ? `<ul class="jm-hist" id="x-lines">${v.lines.map((x) => { const k = KIND[x.kind] || KIND.other; return `<li><span><b>${esc(x.who || 'Not matched to a player')}</b><small>${esc(day(x.paidDate))} · ${esc(x.note)}${x.coach ? ` · ${esc(x.coach)}` : ''}${x.kind === 'stripe' ? ` · ${x.feeCents == null ? 'fee still loading' : `fee ${esc(money(x.feeCents))}`}` : ''}</small></span><span style="display:flex;gap:8px;align-items:center"><span class="amt">${esc(money(x.keptCents))}</span><span class="j-pill j-pill-${k[1]}">${esc(k[0])}</span></span></li>` }).join('')}</ul>` : '<p class="muted small">No payments yet.</p>'}</section>`
  bindTip(ui.view())
  bindSwitch(ui)
  const root = ui.view()
  root.querySelector('#x-month').addEventListener('change', (e) => { ui.filter.month = e.target.value; renderExtraMoney(ui) })
  root.querySelector('#x-refresh').addEventListener('click', () => renderExtraMoney(ui, { fresh: true }))
  root.querySelector('#x-new').addEventListener('click', () => chargeModal(ui, { onDone: () => renderExtraMoney(ui, { fresh: true }) }))
  root.querySelector('#x-csv').addEventListener('click', () => ui.saveFile(`extra-sessions-${v.month || 'all'}.csv`, extraCsv(v, ui)))
  root.querySelector('#x-open')?.addEventListener('click', async (e) => {
    const li = e.target.closest('[data-charge]'); if (!li) return
    const c = v.open.find((x) => x.id === li.dataset.charge)
    if (e.target.closest('[data-xpay]')) return payModal(ui, c, () => renderExtraMoney(ui, { fresh: true }))
    if (e.target.closest('[data-xcancel]')) {
      if (!(await ui.confirm(`Cancel the ${esc(money(c.amountCents))} charge for <b>${esc(c.player)}</b>? It leaves their My account.`, { ok: 'Cancel charge', danger: true }))) return
      const r = await ui.post('chargeCancel', { id: c.id })
      ui.toast(r.ok ? 'Cancelled' : r.data.error)
      renderExtraMoney(ui, { fresh: true })
    }
  })
}

export async function renderExtraMoney(ui, { fresh = false } = {}) {
  const month = ui.filter.month || ''
  const kept = !fresh && recall(key(month), 900000)
  if (kept) draw(ui, kept.data)
  else ui.view().innerHTML = moneyHead({ controls: programmeSwitch('extra'), loading: true, refresh: '' })
  if (!kept) bindSwitch(ui)
  let v
  try { v = await extraData(ui.post, { month }) } catch (error) { if (!kept) ui.view().insertAdjacentHTML('beforeend', `<div class="j-box j-box-red">${esc(error.message)}</div>`); return }
  if (ui.stale()) return
  if (!kept || quietOk()) draw(ui, v)
}
