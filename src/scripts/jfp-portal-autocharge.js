// Saved cards and bank accounts, and auto-charge after each session (Lee,
// 14 Oct 2026; claude/card-on-file). Staff side:
//   Players list   a "Card on file" / "Direct debit on file" tag (auto charge on shows)
//   Player record  the method, auto charge on or off, the last result
//   Edit player    the same, with the per player switch (Turn auto charge on / off)
//   Money > Pro sessions > Auto charges   what the next run would do and why
//                  ("Charge: marked here", "Wait: register not marked"), what
//                  needs a look, the per player switches, the latest results,
//                  and "Run now"
// Auto charge needs three locks (Lee, 16 Oct 2026): the family saved a method
// and agreed, staff turned it on for the player, and the Settings switch is on.
// The server (api/_jfp-saved-pay.js) decides everything again on each run.
import { esc } from './jfp-common.js'

const PILL = { succeeded: 'green', processing: 'amber', failed: 'red', action: 'red', uncertain: 'amber', charging: 'grey', skipped: 'grey', wait: 'amber' }

export function savedPayTag(p) {
  const s = p?.savedPay
  if (!s) return ''
  return ` <span class="ps-tag ${s.on ? 'green' : 'grey'}" title="${esc(`${s.method}${s.on ? ', auto charge on: charged after each session once the register is marked' : ', auto charge off for this player'}${s.last ? `. Last: ${s.last.dateLabel} ${s.last.label}` : ''}`)}">${s.kind === 'bank' ? 'Direct debit' : 'Card'} on file${s.on ? ', auto' : ''}</span>`
}

export function savedPayDetail(p, row) {
  const s = p?.savedPay
  if (!s) return row('Saved payment', 'None (pays by link or in My account)')
  return `${row('Saved payment', `${s.label}: ${s.method}`)}${row('Auto charge', s.on ? (s.sessionPay ? 'On: after each session, once the register is marked' : 'On: extra sessions only (term fee player)') : 'Off for this player')}${s.last ? row('Last charge', `${s.last.dateLabel}, ${s.last.amountLabel}: ${s.last.label}`) : ''}`
}

const recLine = (x) => `<li><span><b>${esc(x.player)}</b><small>${esc(x.dateLabel)} · ${esc(x.amountLabel)}${x.method ? ` · ${esc(x.method)}` : ''}${x.why ? ` · ${esc(x.why)}` : ''}${x.payreqId ? ` · ${esc(x.payreqId)}` : ''}</small></span><span class="j-pill j-pill-${PILL[x.status] || 'grey'}">${esc(x.statusLabel)}</span></li>`
const dayLabel = (iso) => (iso ? new Date(iso).toLocaleDateString('en-AU', { timeZone: 'Australia/Sydney', day: 'numeric', month: 'short', year: 'numeric' }) : '')

// The per player switch: on or off, with who changed it last.
async function flip(post, toast, rowId, on) {
  const x = await post('autoChargeSwitch', { rowId, on })
  if (!x.ok) { toast(x.data.error || 'Could not change it.'); return false }
  toast(x.data.on ? 'Auto charge is on for this player' : 'Auto charge is off for this player')
  return true
}

// Edit player: the saved method and the per player switch.
export async function mountAutoChargeEdit(el, rowId, { post, toast }) {
  if (!el) return
  const r = await post('autoChargeStatus', { rowId })
  if (!el.isConnected) return
  if (!r.ok) { el.innerHTML = ''; return }
  const d = r.data
  if (!d.method) { el.innerHTML = d.sessionPay ? '<p class="muted small" style="margin:10px 0 0">No saved card or bank account. The family can save one in My account, Fees. Then you can turn auto charge on here.</p>' : ''; return }
  const what = d.sessionPay ? 'each session is charged the day after, once the register is marked, at their price per session (and extra sessions booked)' : 'they pay a term fee, so only extra sessions booked are charged, once their register is marked'
  el.innerHTML = `<div class="j-box ${d.on ? 'j-box-green' : 'j-box-grey'}" style="margin-top:10px">
      <p><b>${esc(d.method.staffLabel)}:</b> ${esc(d.method.label)}${d.method.detail ? ` <span class="muted small">(${esc(d.method.detail)})</span>` : ''}</p>
      <p class="small" style="margin:4px 0">Saved by ${esc(d.email)} ${d.consent?.at ? `on ${esc(dayLabel(d.consent.at))}` : ''}${d.consent?.version ? ` · consent ${esc(d.consent.version)}` : ''}${d.consent && !d.consent.coversOther ? ' · covers session fees and extra sessions only' : ''}</p>
      <p class="small" style="margin:4px 0">${d.on ? `Auto charge is <b>on</b> for this player${d.switchBy ? ` (${esc(d.switchBy)}, ${esc(dayLabel(d.switchAt))})` : ''}: ${esc(what)}.` : `Auto charge is <b>off</b> for this player${d.switchBy ? ` (${esc(d.switchBy)}, ${esc(dayLabel(d.switchAt))})` : ''}. Nothing is charged automatically. Turned on, ${esc(what)}, from today on.`}</p>
      ${d.recent?.length ? `<ul class="jm-hist" style="margin-top:6px">${d.recent.map(recLine).join('')}</ul>` : '<p class="muted small">No charges yet.</p>'}
      <button type="button" class="j-btn ${d.on ? 'j-btn-line' : 'j-btn-dark'} j-btn-sm" id="ac-switch" style="margin-top:8px">${d.on ? 'Turn auto charge off' : 'Turn auto charge on'}</button>
    </div>`
  el.querySelector('#ac-switch').addEventListener('click', async (e) => {
    e.currentTarget.disabled = true
    if (await flip(post, toast, rowId, !d.on)) mountAutoChargeEdit(el, rowId, { post, toast })
    else if (e.currentTarget.isConnected) e.currentTarget.disabled = false
  })
}

const ACTION_PILL = { charge: ['green', 'Charge'], skip: ['grey', 'Skip'], wait: ['amber', 'Wait'] }
function previewTable(list) {
  if (!list.length) return '<p class="muted small">Nothing to do: no player with a saved card or account had a session in the last two weeks that is not settled yet.</p>'
  return `<div class="jp-scroll"><table class="jp-table jy-table jy-stack" id="ac-preview"><thead><tr><th>Player</th><th>Session</th><th class="num">Amount</th><th>Method</th><th>What happens</th></tr></thead><tbody>${list.map((x) => `<tr data-ac="${esc(`${x.rowId}|${x.date}`)}">
      <th scope="row">${esc(x.player)}${x.programme === 'pro' ? ' <span class="ps-tag pink">Pro</span>' : ''}</th>
      <td data-label="Session">${esc(x.dateLabel)}${x.register ? ` <span class="muted small">(${esc(x.register === 'Present' ? 'came' : x.register === 'Absent' ? 'marked absent' : x.register)})</span>` : ''}</td>
      <td class="num" data-label="Amount">${esc(x.amountLabel || '-')}</td>
      <td data-label="Method">${esc(x.method)}</td>
      <td data-label="What happens"><span class="j-pill j-pill-${(ACTION_PILL[x.action] || ACTION_PILL.skip)[0]}">${esc((ACTION_PILL[x.action] || ACTION_PILL.skip)[1])}</span> <span class="small">${esc(x.action === 'charge' ? x.note : x.reasonLabel)}</span></td></tr>`).join('')}</tbody></table></div>`
}

function playersTable(list) {
  if (!list.length) return '<p class="muted small">No family with a place has saved a card or bank account yet.</p>'
  return `<div class="jp-scroll"><table class="jp-table jy-table jy-stack" id="ac-players"><thead><tr><th>Player</th><th>Pays</th><th>Method</th><th>Auto charge</th></tr></thead><tbody>${list.map((p) => `<tr>
      <th scope="row">${esc(p.player)}${p.programme === 'pro' ? ' <span class="ps-tag pink">Pro</span>' : ''}</th>
      <td data-label="Pays">${p.sessionPay ? 'Session by session' : 'Term fee <span class="muted small">(extra sessions only)</span>'}</td>
      <td data-label="Method">${esc(p.method)}${p.consentVersion && p.consentVersion < 3 ? ' <span class="muted small">(consent v2)</span>' : ''}</td>
      <td data-label="Auto charge"><button type="button" class="j-btn ${p.on ? 'j-btn-line' : 'j-btn-dark'} j-btn-sm" data-ac-switch="${esc(p.rowId)}" data-on="${p.on ? '1' : ''}">${p.on ? 'On: turn off' : 'Off: turn on'}</button>${p.by ? ` <span class="muted small">${esc(p.by)}, ${esc(dayLabel(p.at))}</span>` : ''}</td></tr>`).join('')}</tbody></table></div>`
}

// Money > Pro sessions: the Auto charges card. ui: { post, toast, confirm }.
export async function renderAutoChargePanel(el, ui) {
  if (!el) return
  el.innerHTML = '<h2>Auto charges</h2><p class="muted small">Loading</p>'
  const r = await ui.post('autoChargePanel')
  if (!el.isConnected) return
  if (!r.ok) { el.innerHTML = `<h2>Auto charges</h2><p class="small j-err">${esc(r.data.error || 'Could not load auto charges.')}</p>`; return }
  if (!Array.isArray(r.data?.preview)) { el.innerHTML = ''; el.hidden = true; return }
  const d = { needsLook: [], recent: [], ...r.data }
  const last = d.lastRun ? `Last run ${esc(new Date(d.lastRun.at).toLocaleString('en-AU', { timeZone: 'Australia/Sydney', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }))} (${esc(d.lastRun.by)}): ${d.lastRun.charged} charged, ${d.lastRun.processing} direct debit${d.lastRun.processing === 1 ? '' : 's'} started, ${d.lastRun.failed} not paid.` : 'Not run yet.'
  el.innerHTML = `<h2>Auto charges</h2>
    ${d.off ? `<div class="j-box j-box-amber" style="margin:8px 0"><b>Auto charge is off.</b> The list below is what it would do. Nothing is charged until it is turned on in Settings.</div>` : ''}
    <p class="sub">Session by session and Pro players whose family saved a card or bank account and agreed, once you turn auto charge on for the player below. ${esc(d.schedule)}. Present or a no-show is charged; told us 24 hours or more ahead is not; register not marked waits. Term fee players are never charged for sessions. Each charge is recorded on the player like a paid session invoice.</p>
    <p class="small muted">${last}</p>
    ${d.needsLook.length ? `<div class="j-box j-box-amber" style="margin:10px 0"><p><b>Needs a look: ${d.needsLook.length}</b></p><p class="small" style="margin:4px 0 6px">Not paid: the family was emailed a Pay link (it is on Payment links); check with them if it stays unpaid. Register not marked: nothing is charged until the coach marks it; each run looks again for up to two weeks.</p><ul class="jm-hist">${d.needsLook.map(recLine).join('')}</ul></div>` : ''}
    <h3 style="margin-top:12px">Next run would do</h3>
    <p class="small muted">${d.toCharge ? `${d.toCharge} to charge, ${esc(d.toChargeLabel)} in all.` : 'Nothing to charge right now.'}</p>
    ${previewTable(d.preview)}
    <div style="display:flex;gap:8px;margin-top:10px"><button type="button" class="j-btn j-btn-dark j-btn-sm" id="ac-run" ${d.preview.length ? '' : 'disabled'}>Run now</button><button type="button" class="j-btn j-btn-line j-btn-sm" id="ac-refresh">Refresh</button></div>
    <p class="small" id="ac-out" role="status" hidden></p>
    <h3 style="margin-top:14px">Players</h3>
    <p class="small muted">Off for everyone until you turn it on. Sessions before you turn it on are never charged automatically.</p>
    ${playersTable(d.players || [])}
    <h3 style="margin-top:14px">Latest</h3>
    ${d.recent.length ? `<ul class="jm-hist">${d.recent.map(recLine).join('')}</ul>` : '<p class="muted small">No auto charges yet.</p>'}`
  el.querySelector('#ac-refresh').addEventListener('click', () => renderAutoChargePanel(el, ui))
  el.querySelectorAll('[data-ac-switch]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true
    if (await flip(ui.post, ui.toast, b.dataset.acSwitch, !b.dataset.on)) renderAutoChargePanel(el, ui)
    else b.disabled = false
  }))
  el.querySelector('#ac-run').addEventListener('click', async (e) => {
    const n = d.toCharge
    if (!(await ui.confirm(`Charge <b>${n}</b> session${n === 1 ? '' : 's'} (${esc(d.toChargeLabel)}) to saved cards and bank accounts now? Skips are settled too. A session is never charged twice.`, { ok: 'Run now' }))) return
    const btn = e.currentTarget
    btn.disabled = true
    const x = await ui.post('autoChargeRun', { confirm: true })
    const out = el.querySelector('#ac-out')
    if (!x.ok) { btn.disabled = false; ui.toast(x.data.error || 'Could not run.'); return }
    if (x.data.off) { btn.disabled = false; ui.toast('Auto charge is off. Nothing was charged.', 6000); return }
    const s = x.data.summary
    ui.toast(`${s.charged} charged, ${s.processing} direct debit${s.processing === 1 ? '' : 's'} started, ${s.failed} not paid`)
    await renderAutoChargePanel(el, ui)
    const o2 = el.querySelector('#ac-out') || out
    if (o2) { o2.hidden = false; o2.className = 'small j-box j-box-grey'; o2.textContent = `Done: ${s.charged} charged, ${s.processing} direct debits started, ${s.failed} not paid, ${s.skipped} settled as not charged${s.waiting ? `, ${s.waiting} waiting for the register` : ''}.` }
  })
}

// ---------- "Charge saved card" on a charge or an invoice (round 2) ----------
// Admin only. Shows only where the family has a saved method and the charge
// is open; the confirm says the amount and the method. The server takes the
// amount from the charge or invoice, never from here.
// The tick "The family has agreed to this amount" is required (Lee, 16 Oct
// 2026) and kept with the payment. A family who saved under consent v2 only
// agreed to session fees and extra sessions: staff see that.
function agreeBox(ui, info) {
  return new Promise((resolve) => {
    const box = ui.modal(`<p style="font-size:15px;margin-bottom:12px">Charge <b>${esc(info.amountLabel)}</b> to ${esc(info.label)} now?</p>
      ${info.note ? `<p class="small j-box j-box-amber" style="margin-bottom:12px">${esc(info.note)}. Their saved consent covers session fees and extra sessions only.</p>` : ''}
      <label class="j-check" style="margin-bottom:6px"><input type="checkbox" id="ac-agreed"> <span>The family has agreed to this amount</span></label>
      <p class="j-err" id="ac-agree-err" hidden>Tick the box first.</p>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px"><button type="button" class="j-btn j-btn-line" data-no>Cancel</button><button type="button" class="j-btn j-btn-dark" data-yes>${esc(info.button)}</button></div>`)
    box.querySelector('[data-no]').addEventListener('click', () => { ui.closeModal(); resolve(false) })
    box.querySelector('[data-yes]').addEventListener('click', () => {
      if (!box.querySelector('#ac-agreed').checked) { box.querySelector('#ac-agree-err').hidden = false; return }
      ui.closeModal(); resolve(true)
    })
  })
}
async function chargeSaved(ui, { chargeId = '', invoiceId = '', info, onDone }) {
  if (!(await agreeBox(ui, info))) return
  const r = await ui.post('chargeSavedPay', { chargeId, invoiceId, confirm: true, agreed: true })
  if (!r.ok) return ui.toast(r.data.error || 'Could not charge it.')
  const said = { succeeded: `Paid: ${r.data.amountLabel} charged to ${r.data.method}`, processing: `Direct debit of ${r.data.amountLabel} started. It clears in 2 to 3 business days.`, failed: `Not paid: ${r.data.why}. The family was emailed the Pay link.`, action: `Not paid: ${r.data.why}. The family was emailed the Pay link.`, uncertain: 'Stripe did not answer. It is checked again on the next run; do not charge again.' }
  ui.toast(said[r.data.result] || r.data.result, 7000)
  onDone?.()
}

export async function mountSavedChargeButtons(list, open, ui, onDone) {
  if (!list || !open?.length) return
  const r = await ui.post('savedPayFor', { chargeIds: open.map((c) => c.id) })
  if (!r.ok || !list.isConnected) return
  for (const [id, info] of Object.entries(r.data.charges || {})) {
    const li = list.querySelector(`[data-charge="${CSS.escape(id)}"]`)
    const spot = li?.querySelector('[data-xpay]')?.parentElement || li
    if (!spot) continue
    const b = document.createElement('button')
    b.type = 'button'; b.className = 'j-btn j-btn-dark j-btn-sm'; b.textContent = info.button; b.title = `${info.label}${info.note ? `. ${info.note}` : ''}`
    b.addEventListener('click', (e) => { e.stopPropagation(); chargeSaved(ui, { chargeId: id, info, onDone }) })
    spot.prepend(b)
  }
}

export async function mountInvoiceSavedButton(box, inv, ui, onDone) {
  if (!box || ['void', 'paid', 'draft'].includes(inv.status)) return
  const r = await ui.post('savedPayFor', { invoiceIds: [inv.id] })
  const info = r.ok ? r.data.invoices?.[inv.id] : null
  const bar = box.querySelector('[data-iv="pay"]')?.parentElement
  if (!info || !bar || !box.isConnected) return
  const b = document.createElement('button')
  b.type = 'button'; b.className = 'j-btn j-btn-dark j-btn-sm'; b.textContent = info.button; b.title = `${info.label}${info.note ? `. ${info.note}` : ''}`
  b.addEventListener('click', () => chargeSaved(ui, { invoiceId: inv.id, info, onDone }))
  bar.querySelector('[data-iv="pay"]').before(b)
}

// ---------- Settings: the three switches (admin only) ----------
const SWITCHES = [
  ['cards', 'Saved cards', 'Families can save a card (Apple Pay and Google Pay too) in My account, Fees, and staff can use Charge saved card. Off: families do not see it.'],
  ['bank', 'Saved bank accounts (BECS Direct Debit)', 'Turn on after BECS Direct Debit is switched on in Stripe and the webhook has payment_intent.succeeded and payment_intent.payment_failed'],
  ['autoCharge', 'Auto charge after each session', 'Charges saved cards and accounts the day after each session once the register is marked (and extra sessions), only for players you turned auto charge on for. Off: the daily job and Run now only show what they would do.'],
]
export async function mountSavedPaySettings(el, { post, toast }) {
  if (!el) return
  const r = await post('savedPaySettings')
  if (!r.ok || !r.data?.savedPay || !el.isConnected) return
  const v = r.data.savedPay
  el.innerHTML = `<h2 style="margin:16px 0 6px">Saved cards and auto charge</h2>
    <p class="muted small" style="margin-bottom:8px">Each switch saves straight away.</p>
    ${SWITCHES.map(([k, l, line]) => `<label class="j-check"><input type="checkbox" data-sp="${k}" ${v[k] ? 'checked' : ''}${k === 'bank' && !v.cards ? ' disabled' : ''}> <span><b>${esc(l)}.</b> ${esc(line)}</span></label>`).join('')}`
  el.querySelectorAll('[data-sp]').forEach((b) => b.addEventListener('change', async () => {
    b.disabled = true
    const x = await post('savedPaySettings', { set: { [b.dataset.sp]: b.checked } })
    if (!x.ok) { b.checked = !b.checked; b.disabled = false; return toast(x.data.error || 'Could not save.') }
    toast('Saved')
    mountSavedPaySettings(el, { post, toast })
  }))
}
