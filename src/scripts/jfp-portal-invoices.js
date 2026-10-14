// Money > Invoices (Lee, 14 Oct 2026): a proper invoice for a parent who asks
// for one (api/_jfp-invoices.js). The list with filters, New invoice (the
// family and players, lines from Prices or typed, due date, notes), the
// invoice as the family sees it, Preview email then Send, Copy link, Record a
// payment (bank transfer or cash), and Void.
//
// ui: { view, post, toast, modal, closeModal, confirm, copy, board(), pricing(), filter, go, stale() }
import { esc, money } from './jfp-common.js'
import { moneyHead, programmeSwitch, bindSwitch, bindTip } from './jfp-portal-programmes.js'
import { playerPicker, pickerHtml } from './jfp-portal-charges.js'
import { invoiceHtml } from './jfp-invoice.js'

const cents = (v) => Math.round(Number(String(v ?? '').replace(/[^0-9.]/g, '')) * 100)
const dollars = (c) => (c / 100).toFixed(2).replace(/\.00$/, '')
const day = (iso) => (iso ? new Date(`${String(iso).slice(0, 10)}T00:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '')
const PILL = { draft: 'grey', sent: 'blue', viewed: 'violet', part: 'orange', paid: 'green', void: 'grey' }
const FILTERS = [['', 'All'], ['draft', 'Draft'], ['sent', 'Sent'], ['viewed', 'Viewed'], ['part', 'Part paid'], ['paid', 'Paid'], ['void', 'Void'], ['overdue', 'Overdue']]
const PROGS = [['jfp', 'JFP'], ['pro', 'Pro sessions'], ['extra', 'Extra sessions'], ['other', 'Other']]
const TIP = 'Invoices for parents who ask for one. JFP and Pro sessions invoices are for a player\'s place: when paid (card in My account or on the invoice page, or a bank transfer with the invoice number in the reference) it is recorded on the player\'s row like any JFP payment. Extra sessions and Other invoices count in their own program. Prices include GST (one eleventh). Bank details show on the invoice only once they are saved in Settings.'

export async function renderInvoices(ui) {
  ui.filter.invStatus ||= ''
  ui.view().innerHTML = moneyHead({ controls: programmeSwitch('invoices'), loading: true, refresh: '' })
  bindSwitch(ui)
  const r = await ui.post('invoiceList')
  if (ui.stale()) return
  if (!r.ok) { ui.view().insertAdjacentHTML('beforeend', `<div class="j-box j-box-red">${esc(r.data.error)}</div>`); return }
  const d = r.data
  history.replaceState(null, '', '#money?programme=invoices')
  const f = ui.filter
  const list = () => d.invoices.filter((x) => (!f.invStatus || (f.invStatus === 'overdue' ? x.overdue : x.status === f.invStatus)) && (!f.invQ || `${x.id} ${x.parentName} ${x.email} ${x.players.map((p) => p.name).join(' ')}`.toLowerCase().includes(f.invQ)))
  ui.view().innerHTML = `
    ${moneyHead({ controls: `${programmeSwitch('invoices')}<button type="button" class="j-btn j-btn-dark j-btn-sm" id="iv-new">+ New invoice</button>`, at: new Date().toISOString(), tip: esc(TIP), refresh: 'iv-refresh' })}
    <p class="muted small" style="margin:-4px 0 12px">${esc(String(d.counts.all))} invoice${d.counts.all === 1 ? '' : 's'} · ${esc(money(d.owingCents))} still to pay</p>
    <div class="jm-bar"><div class="jm-chips" id="iv-chips" role="group" aria-label="Show">${FILTERS.map(([k, l]) => `<button type="button" data-ivf="${k}" aria-pressed="${f.invStatus === k}">${esc(l)}${k ? ` <span class="muted">${d.counts[k] || 0}</span>` : ''}</button>`).join('')}</div>
    <div class="jm-search"><input class="j-input" id="iv-q" type="search" placeholder="Search invoice, parent or player" value="${esc(f.invQ || '')}" autocomplete="off"></div></div>
    <div class="jp-scroll"><table class="jp-table jm-table"><thead><tr><th>Invoice</th><th>For</th><th>Date</th><th class="num">Total</th><th class="num">To pay</th><th>Status</th></tr></thead><tbody id="iv-rows"></tbody></table></div>`
  const rows = () => {
    const l = list()
    ui.view().querySelector('#iv-rows').innerHTML = l.length ? l.map((x) => `<tr data-inv="${esc(x.id)}" style="cursor:pointer"><td><b>${esc(x.id)}</b><br><small class="muted">${esc(x.programmeLabel)}</small></td><td>${esc(x.players.map((p) => p.name).join(', '))}<br><small class="muted">${esc(x.parentName || x.email)}</small></td><td>${esc(day(x.issueDate))}${x.dueDate ? `<br><small class="muted${x.overdue ? '' : ''}">due ${esc(day(x.dueDate))}</small>` : ''}</td><td class="num">${esc(money(x.totalCents))}</td><td class="num">${esc(money(x.owingCents))}</td><td><span class="j-pill j-pill-${PILL[x.status]}">${esc(x.statusLabel)}</span>${x.overdue ? ' <span class="j-pill j-pill-red">Overdue</span>' : ''}</td></tr>`).join('') : '<tr><td colspan="6" class="muted">No invoices here.</td></tr>'
  }
  rows()
  bindTip(ui.view())
  bindSwitch(ui)
  const root = ui.view()
  root.querySelector('#iv-refresh').addEventListener('click', () => renderInvoices(ui))
  root.querySelector('#iv-new').addEventListener('click', () => invoiceForm(ui, null))
  root.querySelector('#iv-chips').addEventListener('click', (e) => { const b = e.target.closest('[data-ivf]'); if (!b) return; f.invStatus = b.dataset.ivf; root.querySelectorAll('[data-ivf]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); rows() })
  root.querySelector('#iv-q').addEventListener('input', (e) => { f.invQ = e.target.value.trim().toLowerCase(); rows() })
  root.querySelector('#iv-rows').addEventListener('click', (e) => { const tr = e.target.closest('[data-inv]'); if (tr) invoiceDetail(ui, tr.dataset.inv) })
}

function lineRow(l = {}, i = 0) {
  return `<div class="ji-line" data-line="${i}" style="display:grid;grid-template-columns:1fr 70px 110px 32px;gap:6px;margin-bottom:6px"><input class="j-input" data-ld maxlength="200" placeholder="Description" value="${esc(l.description || '')}" aria-label="Description"><input class="j-input" data-lq inputmode="numeric" value="${l.qty || 1}" aria-label="Quantity"><input class="j-input" data-lu inputmode="decimal" placeholder="Price A$" value="${l.unitCents != null ? dollars(l.unitCents) : ''}" aria-label="Price, A$"><button type="button" class="j-btn j-btn-ghost j-btn-sm" data-ldel aria-label="Remove line">&times;</button></div>`
}

export async function invoiceForm(ui, inv) {
  const pr = await ui.pricing().catch(() => null)
  const prices = (pr?.priceList || []).filter((p) => !p.archived)
  const box = ui.modal(`<h2 style="margin-bottom:4px">${inv ? `Edit ${esc(inv.id)}` : 'New invoice'}</h2><p class="muted small" style="margin-bottom:12px">Saved as a draft. Nothing is sent until you press Send.</p>
    ${pickerHtml('ivp', 'Player (or players, one family)')}
    <div class="j-two"><label class="j-field"><span>Program</span><select class="j-select" id="iv-prog">${PROGS.map(([v, l]) => `<option value="${v}"${(inv?.programme || 'jfp') === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
    <label class="j-field"><span>Due date (optional)</span><input class="j-input" id="iv-due" type="date" value="${esc(inv?.dueDate || '')}"></label></div>
    <div class="j-two"><label class="j-field"><span>Parent name</span><input class="j-input" id="iv-parent" maxlength="120" value="${esc(inv?.parentName || '')}"></label>
    <label class="j-field"><span>Send to (email)</span><input class="j-input" id="iv-email" type="email" inputmode="email" value="${esc(inv?.email || '')}"></label></div>
    <div class="j-field"><span>Lines</span><div id="iv-lines">${(inv?.lines?.length ? inv.lines : [{}]).map(lineRow).join('')}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><button type="button" class="j-btn j-btn-line j-btn-sm" id="iv-addline">+ Add a line</button><select class="j-select" id="iv-fromprice" style="max-width:280px"><option value="">Add from Prices</option>${prices.map((p) => `<option value="${esc(p.id)}">${esc(p.name)} · ${esc(p.amountLabel || money(p.cents))}</option>`).join('')}</select></div></div>
    <p id="iv-total" style="font-weight:700;margin:8px 0"></p>
    <label class="j-field"><span>Notes on the invoice (optional)</span><textarea class="j-input" id="iv-notes" rows="2" maxlength="1000">${esc(inv?.notes || '')}</textarea></label>
    <p class="j-err" id="iv-err" hidden></p>
    <div class="jq-foot"><button type="button" class="j-btn j-btn-line" data-close>Cancel</button><button type="button" class="j-btn j-btn-dark" id="iv-save">Save draft</button></div>`, { wide: true })
  const $ = (id) => box.querySelector(`#${id}`)
  const pick = playerPicker(ui, box, 'ivp', { onChange: (list) => { if (list[0] && !$('iv-email').value) $('iv-email').value = list[0].email || ''; if (list[0] && !$('iv-parent').value) $('iv-parent').value = list[0].parent || '' } })
  for (const p of inv?.players || []) if (p.rowId) pick.add({ rowId: p.rowId, name: p.name, parent: '', email: '', where: '' })
  const read = () => [...$('iv-lines').querySelectorAll('[data-line]')].map((el) => ({ description: el.querySelector('[data-ld]').value.trim(), qty: Number(el.querySelector('[data-lq]').value) || 1, unitCents: cents(el.querySelector('[data-lu]').value) })).filter((l) => l.description || l.unitCents)
  const total = () => { const t = read().reduce((s, l) => s + l.qty * l.unitCents, 0); $('iv-total').textContent = `Total ${money(t)} (includes GST of ${money(Math.round(t / 11))})` }
  $('iv-lines').addEventListener('input', total)
  $('iv-lines').addEventListener('click', (e) => { if (e.target.closest('[data-ldel]')) { e.target.closest('[data-line]').remove(); total() } })
  $('iv-addline').addEventListener('click', () => { $('iv-lines').insertAdjacentHTML('beforeend', lineRow({}, Date.now())) })
  $('iv-fromprice').addEventListener('change', (e) => {
    const p = prices.find((x) => x.id === e.target.value)
    if (!p) return
    const empty = [...$('iv-lines').querySelectorAll('[data-line]')].find((el) => !el.querySelector('[data-ld]').value && !el.querySelector('[data-lu]').value)
    if (empty) empty.remove()
    $('iv-lines').insertAdjacentHTML('beforeend', lineRow({ description: p.name, qty: 1, unitCents: p.cents }, Date.now()))
    if (['jfp', 'pro', 'extra'].includes(p.programme)) $('iv-prog').value = p.programme
    e.target.value = ''
    total()
  })
  total()
  $('iv-save').addEventListener('click', async () => {
    const err = $('iv-err')
    err.hidden = true
    const body = { id: inv?.id || '', programme: $('iv-prog').value, rowIds: pick.picked.map((x) => x.rowId), email: $('iv-email').value.trim(), parentName: $('iv-parent').value.trim(), lines: read(), dueDate: $('iv-due').value, notes: $('iv-notes').value.trim() }
    if (!body.rowIds.length) { err.textContent = 'Choose the player.'; err.hidden = false; return }
    $('iv-save').disabled = true
    const r = await ui.post('invoiceSave', body)
    $('iv-save').disabled = false
    if (!r.ok) { err.textContent = r.data.error; err.hidden = false; return }
    ui.toast(`${r.data.invoice.id} saved as a draft`)
    invoiceDetail(ui, r.data.invoice.id, r.data)
  })
}

export async function invoiceDetail(ui, id, pre = null) {
  const d = pre || await ui.post('invoiceGet', { id }).then((r) => (r.ok ? r.data : (ui.toast(r.data.error), null)))
  if (!d) return
  const x = d.invoice
  const open = !['void', 'paid'].includes(x.status)
  const box = ui.modal(`<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
      ${x.status === 'draft' ? '<button type="button" class="j-btn j-btn-line j-btn-sm" data-iv="edit">Edit</button>' : ''}
      ${open ? '<button type="button" class="j-btn j-btn-dark j-btn-sm" data-iv="email">Preview email and send</button>' : ''}
      ${x.status === 'draft' ? '<button type="button" class="j-btn j-btn-line j-btn-sm" data-iv="ready">Mark ready, no email</button>' : ''}
      <button type="button" class="j-btn j-btn-line j-btn-sm" data-iv="copy">Copy link</button>
      <a class="j-btn j-btn-line j-btn-sm" href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">Open page and PDF</a>
      ${open && x.status !== 'draft' ? '<button type="button" class="j-btn j-btn-line j-btn-sm" data-iv="pay">Record payment</button>' : ''}
      ${open && !x.paidCents ? '<button type="button" class="j-btn j-btn-ghost j-btn-sm" data-iv="void">Void</button>' : ''}
      <button type="button" class="j-btn j-btn-ghost j-btn-sm" data-close>Close</button></div>
    <p class="muted small" style="margin-bottom:10px"><span class="j-pill j-pill-${PILL[x.status]}">${esc(x.statusLabel)}</span>${x.emailedAt ? ` · emailed ${esc(day(x.emailedAt))}` : ''}${x.viewedAt ? ` · opened ${esc(day(x.viewedAt))}` : ''}${x.payments.length ? ` · ${x.payments.map((p) => `${money(p.cents)} ${p.method} ${day(p.date)}`).join(', ')}` : ''}</p>
    <article class="ji-doc" style="border:1px solid #E5E7EB;border-radius:12px;padding:20px;background:#fff;color:#111827">${invoiceHtml(d.view)}</article>`, { wide: true })
  box.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-iv]'); if (!b) return
    const act = b.dataset.iv
    if (act === 'edit') return invoiceForm(ui, x)
    if (act === 'copy') return ui.copy(x.url)
    if (act === 'ready') { const r = await ui.post('invoiceSend', { id: x.id, sendEmail: false }); if (!r.ok) return ui.toast(r.data.error); ui.toast(`${x.id} is ready. Copy the link to send it yourself.`); return invoiceDetail(ui, x.id, r.data) }
    if (act === 'email') return emailPreview(ui, d)
    if (act === 'pay') return payModal(ui, x)
    if (act === 'void') {
      if (!(await ui.confirm(`Void <b>${esc(x.id)}</b>? The family can no longer pay it, and it leaves their My account.`, { ok: 'Void', danger: true }))) return
      const r = await ui.post('invoiceVoid', { id: x.id })
      if (!r.ok) return ui.toast(r.data.error)
      ui.toast(`${x.id} is void`); invoiceDetail(ui, x.id, r.data)
    }
  })
}

function emailPreview(ui, d) {
  const box = ui.modal(`<h2 style="margin-bottom:4px">Email ${esc(d.invoice.id)}</h2><p class="muted small" style="margin-bottom:10px">To ${esc(d.email.to)} · ${esc(d.email.subject)}</p>
    <iframe title="Email preview" id="ie-frame" style="width:100%;height:440px;border:1px solid #E5E7EB;border-radius:10px;background:#fff"></iframe>
    <p class="j-err" id="ie-err" hidden></p>
    <div class="jq-foot"><button type="button" class="j-btn j-btn-line" data-close>Cancel</button><button type="button" class="j-btn j-btn-dark" id="ie-send">Send</button></div>`, { wide: true })
  box.querySelector('#ie-frame').srcdoc = d.email.html
  box.querySelector('#ie-send').addEventListener('click', async (e) => {
    e.currentTarget.disabled = true
    const r = await ui.post('invoiceSend', { id: d.invoice.id, sendEmail: true })
    if (!r.ok) { e.currentTarget.disabled = false; const x = box.querySelector('#ie-err'); x.textContent = r.data.error; x.hidden = false; return }
    if (r.data.emailError) ui.toast(r.data.emailError, 8000); else ui.toast(`Emailed to ${r.data.emailTo}`)
    invoiceDetail(ui, d.invoice.id, r.data)
  })
}

function payModal(ui, x) {
  const box = ui.modal(`<h2 style="margin-bottom:4px">Record a payment on ${esc(x.id)}</h2><p class="muted small" style="margin-bottom:12px">${esc(money(x.owingCents))} to pay. A bank transfer with ${esc(x.id)} in its reference also shows on Money &gt; JFP &gt; Bank transfers to check, ready to match.</p>
    <div class="j-two"><label class="j-field"><span>How</span><select class="j-select" id="ip-m"><option value="bank">Bank transfer</option><option value="cash">Cash</option><option value="other">Other</option></select></label>
    <label class="j-field"><span>Amount (A$)</span><input class="j-input" id="ip-amt" inputmode="decimal" value="${dollars(x.owingCents)}"></label></div>
    <label class="j-field"><span>Date</span><input class="j-input" id="ip-date" type="date" value="${new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' })}"></label>
    <p class="j-err" id="ip-err" hidden></p>
    <div class="jq-foot"><button type="button" class="j-btn j-btn-line" data-close>Cancel</button><button type="button" class="j-btn j-btn-dark" id="ip-go">Record</button></div>`)
  box.querySelector('#ip-go').addEventListener('click', async () => {
    const r = await ui.post('invoicePay', { id: x.id, method: box.querySelector('#ip-m').value, amountCents: cents(box.querySelector('#ip-amt').value), date: box.querySelector('#ip-date').value })
    if (!r.ok) { const e = box.querySelector('#ip-err'); e.textContent = r.data.error; e.hidden = false; return }
    ui.toast('Recorded'); invoiceDetail(ui, x.id, r.data)
  })
}
