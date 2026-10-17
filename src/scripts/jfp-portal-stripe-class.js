// Unmatched Stripe > More (Lee, 18 Oct 2026): a Stripe payment on a JFP link
// that was really holiday training, Pro sessions or not JFP at all. The same
// choices, in the same "More" menu, as a bank line on Bank payments. Holiday
// training asks what bankHoliday asks (holiday, session date, coach,
// location). Marked payments sit in a "Marked" fold under the list, each
// with Put back.
import { esc, money } from './jfp-common.js'

const KIND = {
  holiday: { label: 'Holiday training', saved: 'holiday training', undo: 'stripeHolidayUndo' },
  pro: { label: 'Pro sessions', saved: 'Pro sessions', undo: 'stripeProUndo' },
  notJfp: { label: 'Not JFP', saved: 'not JFP', undo: 'stripeNotJfpUndo' },
}

// The "More" menu on one unmatched payment.
export const stripeMore = (u) => `<details class="jm-more"><summary class="j-btn j-btn-ghost j-btn-sm">More</summary><div class="jm-more-list" role="menu"><button type="button" role="menuitem" data-sc="holiday" data-sc-id="${esc(u.id)}">Holiday training</button><button type="button" role="menuitem" data-sc="pro" data-sc-id="${esc(u.id)}">Pro sessions</button><button type="button" role="menuitem" data-sc="notJfp" data-sc-id="${esc(u.id)}">Not JFP</button></div></details>`

// The payments marked so far, to put back.
export function stripeMarkedFold(list = []) {
  if (!list.length) return ''
  const what = (x) => `${KIND[x.kind]?.label || x.kind}${x.periodLabel ? ` · ${x.periodLabel}` : ''}${x.player ? ` · ${x.player}` : ''}`
  return `<details class="jm-bank-hidden" id="m-stripe-marked"><summary>Marked as not JFP term income (${list.length})</summary><ul class="jm-hist">${list.map((x) => `<li><span><b>${esc(x.name || 'No name')}</b><small>${esc(what(x))} · ${esc(new Date(`${x.date}T00:00:00`).toLocaleDateString('en-AU'))}${x.product ? ` · ${esc(x.product)}` : ''}</small></span><span class="jm-hist-go"><span class="amt">${esc(money(x.cents))}</span><button type="button" class="j-btn j-btn-line j-btn-sm" data-sc-undo="${esc(x.id)}" data-sc-kind="${esc(x.kind)}">Put back</button></span></li>`).join('')}</ul></details>`
}

const payBox = (u) => `<div class="j-box j-box-blue small" style="margin:8px 0 12px">Stripe, ${esc(new Date(u.at).toLocaleDateString('en-AU'))}: <b>${esc(money(u.cents))}</b> · ${esc(u.name || u.email || 'No name')}${u.product ? ` · ${esc(u.product)}` : ''}</div>`
const buttons = (go, label) => `<p class="j-err" id="sc-err" hidden></p><div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:10px"><button type="button" class="j-btn j-btn-line" data-close>Cancel</button><button type="button" class="j-btn j-btn-dark" id="${go}">${label}</button></div>`

async function loadOptions(ui, date) {
  const r = await ui.post('stripeClassOptions', { date })
  if (!r.ok) throw new Error(r.data?.error || 'Could not read the choices.')
  return { holiday: r.data.holiday, pro: r.data.pro }
}

function form(kind, u, o) {
  if (kind === 'holiday') {
    const h = o.holiday
    const pick = h.periods.some((p) => p.id === h.suggested?.id) ? h.suggested.id : 'other'
    return `<h2 style="margin-bottom:4px">Holiday training</h2>${payBox(u)}
    <label class="j-field"><span>School holiday</span><select class="j-select" id="sc-period">${h.periods.map((p) => `<option value="${esc(p.id)}"${p.id === pick ? ' selected' : ''}>${esc(p.label)}${p.range ? ` (${esc(p.range)})` : ''}</option>`).join('')}</select></label>
    <div class="j-two"><label class="j-field"><span>Session date <span class="muted">(optional)</span></span><input class="j-input" type="date" id="sc-date"></label>
    <label class="j-field"><span>Coach <span class="muted">(optional)</span></span><select class="j-select" id="sc-coach"><option value="">Not sure</option>${h.coaches.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select></label></div>
    <div class="j-two"><label class="j-field"><span>Location</span><select class="j-select" id="sc-loc">${h.locations.map((l) => `<option${l === h.defaultLocation ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
    <label class="j-field"><span>Note <span class="muted">(optional)</span></span><input class="j-input" id="sc-note" maxlength="200" placeholder="For example, two kids, two sessions"></label></div>
    <p class="muted small">It counts in Money &gt; Holiday training as a Stripe payment, with its Stripe fee, and leaves JFP term income and this list. You can put it back.</p>
    ${buttons('sc-go', 'Save as holiday training')}`
  }
  if (kind === 'pro') {
    return `<h2 style="margin-bottom:4px">Pro sessions</h2>${payBox(u)}
    <div class="j-two"><label class="j-field"><span>Pro player <span class="muted">(optional)</span></span><select class="j-select" id="sc-row"><option value="">Not sure</option>${o.pro.players.map((p) => `<option value="${esc(p.rowId)}">${esc(p.player)}</option>`).join('')}</select></label>
    <label class="j-field"><span>Session date <span class="muted">(optional)</span></span><input class="j-input" type="date" id="sc-date"></label></div>
    <label class="j-field"><span>Note <span class="muted">(optional)</span></span><input class="j-input" id="sc-note" maxlength="200"></label>
    <p class="muted small">It counts in Money &gt; Pro sessions, with its Stripe fee, and leaves JFP term income and this list. You can put it back.</p>
    ${buttons('sc-go', 'Save as Pro sessions')}`
  }
  return `<h2 style="margin-bottom:4px">Not JFP</h2>${payBox(u)}
    <label class="j-field"><span>Note <span class="muted">(optional)</span></span><input class="j-input" id="sc-note" maxlength="200" placeholder="What it was for"></label>
    <p class="muted small">It leaves JFP term income and this list, and counts with the other Stripe payments that are not JFP. You can put it back.</p>
    ${buttons('sc-go', 'Save as not JFP')}`
}

// ui: { post, toast, confirm, modal, closeModal, after(kind) }
export async function stripeClassModal(kind, u, ui) {
  let o
  try { o = await loadOptions(ui, new Date(u.at).toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' })) } catch (e) { return ui.toast(e.message) }
  const box = ui.modal(form(kind, u, o))
  box.querySelector('#sc-go').addEventListener('click', async (e) => {
    const v = (id) => box.querySelector(id)?.value.trim() || ''
    const btn = e.currentTarget
    btn.disabled = true
    const body = kind === 'holiday' ? { id: u.id, period: v('#sc-period'), sessionDate: v('#sc-date'), coach: v('#sc-coach'), location: v('#sc-loc'), note: v('#sc-note') }
      : kind === 'pro' ? { id: u.id, rowId: v('#sc-row'), sessionDate: v('#sc-date'), note: v('#sc-note') } : { id: u.id, note: v('#sc-note') }
    const r = await ui.post(kind === 'holiday' ? 'stripeHoliday' : kind === 'pro' ? 'stripePro' : 'stripeNotJfp', body)
    btn.disabled = false
    if (!r.ok) { const er = box.querySelector('#sc-err'); if (er) { er.textContent = r.data.error; er.hidden = false } return ui.toast(r.data.error) }
    ui.closeModal()
    ui.toast(`Saved as ${KIND[kind].saved}${r.data.periodLabel ? `: ${r.data.periodLabel}` : ''}. Put it back under Marked.`, 6000)
    ui.after?.(kind)
  })
}

// Clicks inside the Unmatched Stripe section.
export async function onStripeClass(e, unmatched, ui) {
  const m = e.target.closest('[data-sc]')
  if (m) {
    m.closest('.jm-more')?.removeAttribute('open')
    const u = unmatched.find((x) => x.id === m.dataset.scId)
    if (u) stripeClassModal(m.dataset.sc, u, ui)
    return true
  }
  const un = e.target.closest('[data-sc-undo]')
  if (!un) return false
  const kind = KIND[un.dataset.scKind] ? un.dataset.scKind : 'holiday'
  if (!(await ui.confirm(`Put this payment back in JFP payments? It comes out of ${esc(KIND[kind].saved)}.`, { ok: 'Put it back' }))) return true
  un.disabled = true
  const r = await ui.post(KIND[kind].undo, { id: un.dataset.scUndo })
  if (!r.ok) { un.disabled = false; ui.toast(r.data.error); return true }
  ui.toast('Back in JFP payments')
  ui.after?.(kind)
  return true
}
