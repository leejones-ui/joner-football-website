// Coach invoices (Lee, 19 Oct 2026). Coaches: "My invoices", an invoice made
// from the hours they logged for a period, sent to Lee and Ligia. Lee and
// Ligia: "Coach invoices", every invoice with its lines checked against the
// covers, Approve, Mark paid or Send back, and each coach's hourly rate.
// Server: api/_jfp-coach-invoices.js.
import { esc, toast } from './jfp-common.js'

const S = { coachId: '', status: '', range: 'lastfortnight', from: '', to: '' }
const iso = (d) => d.toISOString().slice(0, 10)
const addDays = (s, n) => iso(new Date(Date.parse(`${s}T00:00:00Z`) + n * 86400000))
const mondayOf = (s) => { const d = new Date(`${s}T00:00:00Z`); return addDays(s, -((d.getUTCDay() + 6) % 7)) }
const hrs = (m) => { const h = Math.floor(m / 60), r = m % 60; return r ? `${h}h ${r}m` : `${h}h` }
const t12 = (hm) => { let [h, m] = hm.split(':').map(Number); const ap = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12; return `${h}${m ? `:${String(m).padStart(2, '0')}` : ''}${ap}` }
const PILL = { submitted: 'amber', approved: 'green', paid: 'green', queried: 'red', withdrawn: 'grey' }
function rangeOf(key, today) {
  const mon = mondayOf(today)
  const yest = addDays(today, -1)
  if (key === 'thisfortnight') return [addDays(mon, -7), today]
  if (key === 'thismonth') return [`${today.slice(0, 8)}01`, today]
  if (key === 'lastmonth') { const d = new Date(`${today.slice(0, 8)}01T00:00:00Z`); d.setUTCDate(0); const end = iso(d); return [`${end.slice(0, 8)}01`, end] }
  if (key === 'custom') return [S.from || addDays(mon, -14), S.to || yest]
  return [addDays(mon, -14), addDays(mon, -1)]
}
const RANGES = [['lastfortnight', 'Last fortnight'], ['thisfortnight', 'This fortnight'], ['thismonth', 'This month'], ['lastmonth', 'Last month'], ['custom', 'Choose dates']]

const flagHtml = (l) => l.flags.map((f) => `<span class="j-pill j-pill-${f.code === 'waiting' ? 'amber' : 'red'}" style="margin:2px 4px 0 0">${esc(f.text)}</span>`).join('')
const linesTable = (lines) => `<div class="ps-table-wrap"><table class="ps-table ps-flat"><thead><tr><th>Date</th><th>Hours</th><th>What</th></tr></thead><tbody>${lines.map((l) => `<tr><td><b>${esc(l.dateLabel)}</b><span class="ps-sub">${esc(t12(l.start))} to ${esc(t12(l.end))}</span></td><td><b>${hrs(l.minutes)}</b></td><td>${esc(l.kindLabel)}${l.what ? `<span class="ps-sub">${esc(l.what)}</span>` : ''}${l.flags.length ? `<div>${flagHtml(l)}</div>` : ''}</td></tr>`).join('')}</tbody></table></div>`

// The invoice itself, to print or save as a PDF.
function printable(inv) {
  const rows = inv.lines.map((l) => `<tr><td>${esc(l.dateLabel)}</td><td>${esc(t12(l.start))} to ${esc(t12(l.end))}</td><td>${esc(l.kindLabel)}${l.what ? `, ${esc(l.what)}` : ''}</td><td style="text-align:right">${hrs(l.minutes)}</td></tr>`).join('')
  return `<!doctype html><html><head><meta charset="utf-8"><title>Invoice ${esc(inv.number)}</title><style>body{font:14px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#111;margin:32px}h1{font-size:22px;margin:0 0 4px}table{width:100%;border-collapse:collapse;margin:16px 0}td,th{border-bottom:1px solid #ddd;padding:8px 6px;text-align:left;vertical-align:top}.r{text-align:right}.muted{color:#666}</style></head><body>
    <h1>Invoice ${esc(inv.number)}</h1><p class="muted">From ${esc(inv.coach)}${inv.abn ? `, ABN ${esc(inv.abn)}` : ''}<br>To Joner Football, 20 Narabang Way (Unit 2), Belrose NSW 2085<br>Work from ${esc(inv.fromLabel)} to ${esc(inv.toLabel)}. Sent ${esc(new Date(inv.createdAt).toLocaleDateString('en-AU'))}.</p>
    <table><thead><tr><th>Date</th><th>Time</th><th>What</th><th class="r">Hours</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="r"><b>Total ${hrs(inv.totalMinutes)}</b>${inv.rateCents ? `<br>at ${esc(inv.rateLabel)}: <b>${esc(inv.amountLabel)}</b>` : '<br>Rate: set by Lee'}</p>
    ${inv.payTo ? `<p><b>Pay to</b><br>${esc(inv.payTo)}</p>` : ''}${inv.note ? `<p><b>Note</b><br>${esc(inv.note)}</p>` : ''}
    <script>window.onload=()=>window.print()</script></body></html>`
}
function openPrint(inv) {
  const w = window.open('', '_blank')
  if (!w) return toast('Allow pop ups to print the invoice.')
  w.document.write(printable(inv)); w.document.close()
}

export async function renderCoachInvoices(ui) {
  const { view, post, need, user, modal, closeModal, confirmBox } = ui
  const admin = user.role === 'admin'
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date())
  const [from, to] = rangeOf(S.range, today)
  const d = await need(await post('coachInvList', admin ? { coachId: S.coachId } : { from, to }))
  const reload = () => renderCoachInvoices(ui)
  const card = (inv) => `<div class="j-card" style="padding:14px 16px;margin-bottom:10px" data-inv="${esc(inv.id)}">
    <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:flex-start">
      <div><b>${esc(inv.number)}</b>${admin ? ` · ${esc(inv.coach)}` : ''} <span class="j-pill j-pill-${PILL[inv.status] || 'grey'}">${esc(inv.statusLabel)}</span>${inv.flagCount ? ` <span class="j-pill j-pill-red">${inv.flagCount} to check</span>` : ''}
        <p class="muted small" style="margin-top:4px">${esc(inv.fromLabel)} to ${esc(inv.toLabel)} · ${hrs(inv.totalMinutes)}${inv.amountLabel ? ` · ${esc(inv.amountLabel)}` : ''}</p>
        ${inv.decisionNote ? `<p class="small" style="color:var(--j-red);margin-top:4px">${esc(inv.decisionNote)}</p>` : ''}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap"><button type="button" class="j-btn j-btn-line j-btn-sm" data-inv-open>See it</button><button type="button" class="j-btn j-btn-line j-btn-sm" data-inv-print>Print or PDF</button>
        ${admin && inv.status === 'submitted' ? '<button type="button" class="j-btn j-btn-dark j-btn-sm" data-inv-do="approved">Approve</button><button type="button" class="j-btn j-btn-ghost j-btn-sm" data-inv-do="queried">Send back</button>' : ''}
        ${admin && inv.status === 'approved' ? '<button type="button" class="j-btn j-btn-dark j-btn-sm" data-inv-do="paid">Mark paid</button>' : ''}
        ${inv.canWithdraw ? '<button type="button" class="j-btn j-btn-ghost j-btn-sm" data-inv-withdraw>Withdraw</button>' : ''}</div></div></div>`
  const list = d.invoices.filter((x) => !S.status || x.status === S.status)

  if (admin) {
    view().innerHTML = `<div class="jp-head"><div><h1>Coach invoices</h1><p class="muted small" style="margin-top:4px">Made from the hours each coach logged, so they match. A line is flagged when a cover says otherwise, or two coaches logged the same session.</p></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><select class="j-select" id="inv-coach" style="width:auto"><option value="">Every coach</option>${d.coaches.map((c) => `<option value="${esc(c.id)}" ${S.coachId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
      <select class="j-select" id="inv-status" style="width:auto"><option value="">Any status</option>${Object.entries(d.status).map(([k, v]) => `<option value="${k}" ${S.status === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></div></div>
      ${list.map(card).join('') || '<p class="muted">No invoices yet.</p>'}
      <details class="j-card" style="padding:14px 16px;margin-top:16px"><summary><b>Hourly rates</b> <span class="muted small">shown on each coach's invoices</span></summary>
        <div style="margin-top:10px">${d.coaches.map((c) => `<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap"><span style="min-width:140px">${esc(c.name)}</span><input class="j-input" style="width:120px" inputmode="decimal" data-rate="${esc(c.id)}" value="${d.rates[c.id] ? (d.rates[c.id] / 100).toFixed(2) : ''}" placeholder="A$ an hour"><button type="button" class="j-btn j-btn-line j-btn-sm" data-rate-save="${esc(c.id)}">Save</button></div>`).join('')}</div></details>`
    view().querySelector('#inv-coach').addEventListener('change', (e) => { S.coachId = e.target.value; reload() })
    view().querySelector('#inv-status').addEventListener('change', (e) => { S.status = e.target.value; renderCoachInvoices(ui) })
    view().querySelectorAll('[data-rate-save]').forEach((b) => b.addEventListener('click', async () => {
      const r = await post('coachInvRate', { coachId: b.dataset.rateSave, dollars: view().querySelector(`[data-rate="${b.dataset.rateSave}"]`).value })
      toast(r.ok ? 'Rate saved. It applies to new invoices.' : r.data.error)
    }))
  } else {
    const draft = d.draft || []
    const mins = draft.reduce((t, l) => t + l.minutes, 0)
    view().innerHTML = `<div class="jp-head"><div><h1>My invoices</h1><p class="muted small" style="margin-top:4px">Your invoice is made from the hours in My hours, so it always matches. ${d.rateLabel ? `Your rate: ${esc(d.rateLabel)}.` : 'Lee sets your hourly rate.'}</p></div></div>
      <section class="j-card" style="padding:14px 16px;margin-bottom:16px"><h3 style="margin-bottom:8px">New invoice</h3>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end"><label class="j-field" style="margin:0"><span>Dates</span><select class="j-select" id="inv-range">${RANGES.map(([k, l]) => `<option value="${k}" ${S.range === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          ${S.range === 'custom' ? `<label class="j-field" style="margin:0"><span>From</span><input class="j-input" type="date" id="inv-from" value="${esc(from)}" max="${esc(today)}"></label><label class="j-field" style="margin:0"><span>To</span><input class="j-input" type="date" id="inv-to" value="${esc(to)}" max="${esc(today)}"></label>` : `<span class="muted small" style="padding-bottom:10px">${esc(from)} to ${esc(to)}</span>`}</div>
        ${draft.length ? `<p class="small" style="margin:12px 0 6px"><b>${draft.length} entr${draft.length === 1 ? 'y' : 'ies'}, ${hrs(mins)}</b>${d.rateCents ? ` · ${esc(new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format((d.rateCents * mins) / 6000))}` : ''}${draft.some((l) => l.flags.length) ? ' · <span style="color:var(--j-red)">some lines need checking, see below</span>' : ''}</p>${linesTable(draft)}
          <div class="j-two" style="margin-top:10px"><label class="j-field"><span>ABN <span class="muted">(optional)</span></span><input class="j-input" id="inv-abn" inputmode="numeric" maxlength="20"></label><label class="j-field"><span>Pay to <span class="muted">(your account name, BSB and number)</span></span><input class="j-input" id="inv-pay" maxlength="200" autocomplete="off"></label></div>
          <label class="j-field"><span>Note <span class="muted">(optional)</span></span><input class="j-input" id="inv-note" maxlength="400"></label>
          <button type="button" class="j-btn j-btn-dark" id="inv-send">Send to Lee and Ligia</button>`
        : '<p class="muted small" style="margin-top:10px">No hours logged in these dates that are not on an invoice already. Log them in My hours first.</p>'}
      </section>
      <h2 style="font-size:16px;margin:0 0 10px">Sent</h2>${list.map(card).join('') || '<p class="muted">None yet.</p>'}`
    view().querySelector('#inv-range').addEventListener('change', (e) => { S.range = e.target.value; reload() })
    view().querySelector('#inv-from')?.addEventListener('change', (e) => { S.from = e.target.value; reload() })
    view().querySelector('#inv-to')?.addEventListener('change', (e) => { S.to = e.target.value; reload() })
    view().querySelector('#inv-send')?.addEventListener('click', async (e) => {
      if (draft.some((l) => l.flags.some((f) => f.code !== 'waiting')) && !(await confirmBox('Some lines are flagged (a cover or another coach). Send anyway? Lee or Ligia will check them.', { ok: 'Send' }))) return
      e.currentTarget.disabled = true
      const r = await post('coachInvCreate', { from, to, abn: view().querySelector('#inv-abn').value, payTo: view().querySelector('#inv-pay').value, note: view().querySelector('#inv-note').value })
      if (!r.ok) { toast(r.data.error); e.currentTarget.disabled = false; return }
      toast('Sent to Lee and Ligia'); reload()
    })
  }
  const invOf = (el) => d.invoices.find((x) => x.id === el.closest('[data-inv]').dataset.inv)
  view().querySelectorAll('[data-inv-open]').forEach((b) => b.addEventListener('click', () => {
    const inv = invOf(b)
    modal(`<h2 style="margin-bottom:4px">Invoice ${esc(inv.number)}</h2><p class="muted small" style="margin-bottom:10px">${esc(inv.coach)} · ${esc(inv.fromLabel)} to ${esc(inv.toLabel)} · ${hrs(inv.totalMinutes)}${inv.amountLabel ? ` · ${esc(inv.amountLabel)}` : ''}</p>${linesTable(inv.lines)}${inv.abn ? `<p class="small">ABN ${esc(inv.abn)}</p>` : ''}${inv.payTo ? `<p class="small">Pay to: ${esc(inv.payTo)}</p>` : ''}${inv.note ? `<p class="small">Note: ${esc(inv.note)}</p>` : ''}<div class="jpf-acts"><button type="button" class="j-btn j-btn-line" data-close>Close</button></div>`, { wide: true })
  }))
  view().querySelectorAll('[data-inv-print]').forEach((b) => b.addEventListener('click', () => openPrint(invOf(b))))
  view().querySelectorAll('[data-inv-withdraw]').forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmBox('Withdraw this invoice? Its hours come free to change and invoice again.', { ok: 'Withdraw' }))) return
    const r = await post('coachInvWithdraw', { id: invOf(b).id }); toast(r.ok ? 'Withdrawn' : r.data.error); if (r.ok) reload()
  }))
  view().querySelectorAll('[data-inv-do]').forEach((b) => b.addEventListener('click', async () => {
    const status = b.dataset.invDo
    let note = ''
    if (status === 'queried') {
      const box = modal('<h2 style="margin-bottom:8px">Send back</h2><label class="j-field"><span>What needs checking?</span><textarea class="j-textarea" id="inv-q" rows="3" maxlength="300"></textarea></label><div class="jpf-acts"><button type="button" class="j-btn j-btn-line" data-close>Close</button><button type="button" class="j-btn j-btn-dark" id="inv-q-go">Send back</button></div>')
      note = await new Promise((res) => box.querySelector('#inv-q-go').addEventListener('click', () => res(box.querySelector('#inv-q').value.trim())))
      closeModal()
      if (!note) return toast('Say what needs checking.')
    }
    const r = await post('coachInvDecide', { id: invOf(b).id, status, note }); toast(r.ok ? 'Saved' : r.data.error); if (r.ok) reload()
  }))
}
