// Coach invoices (Lee, 19 and 20 Oct 2026). Coaches: "My invoices", an
// invoice made from the hours they logged, each session line priced from the
// register (players marked Present) and their own rate card, laid out like
// the invoices they used to send, emailed to Lee and Ligia with the PDF, due
// Monday 9am. Lee and Ligia: "Coach invoices", every invoice with its lines
// checked against the register and covers, set a TBC line, Approve, Mark paid
// or Send back, and each coach's rate card.
// A coach only ever sees their own. Server: api/_jfp-coach-invoices.js.
import { esc, toast } from './jfp-common.js'

const S = { coachId: '', status: '', range: 'lastweek', from: '', to: '' }
const iso = (d) => d.toISOString().slice(0, 10)
const addDays = (s, n) => iso(new Date(Date.parse(`${s}T00:00:00Z`) + n * 86400000))
const mondayOf = (s) => { const d = new Date(`${s}T00:00:00Z`); return addDays(s, -((d.getUTCDay() + 6) % 7)) }
const hrs = (m) => { const h = Math.floor(m / 60), r = m % 60; return r ? `${h}h ${r}m` : `${h}h` }
const t12 = (hm) => { let [h, m] = hm.split(':').map(Number); const ap = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12; return `${h}${m ? `:${String(m).padStart(2, '0')}` : ''}${ap}` }
const money = (c) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format((c || 0) / 100)
const PILL = { submitted: 'amber', approved: 'green', paid: 'green', queried: 'red', withdrawn: 'grey' }
function rangeOf(key, today) {
  const mon = mondayOf(today)
  if (key === 'thisweek') return [mon, today]
  if (key === 'lastfortnight') return [addDays(mon, -14), addDays(mon, -1)]
  if (key === 'custom') return [S.from || addDays(mon, -7), S.to || addDays(today, -1)]
  return [addDays(mon, -7), addDays(mon, -1)]
}
const RANGES = [['lastweek', 'Last week (Mon to Sun)'], ['thisweek', 'This week so far'], ['lastfortnight', 'Last fortnight'], ['custom', 'Choose dates']]

const flagHtml = (l) => l.flags.map((f) => `<span class="j-pill j-pill-${f.code === 'waiting' ? 'amber' : 'red'}" style="margin:2px 4px 0 0">${esc(f.text)}</span>`).join('')
const linesTable = (lines, { admin = false } = {}) => `<div class="ps-table-wrap"><table class="ps-table ps-flat"><thead><tr><th>Date</th><th>What and who</th><th>Location</th><th>Hours</th><th style="text-align:right">Total</th></tr></thead><tbody>${lines.map((l, i) => `<tr>
  <td><b>${esc(l.dateLabel)}</b><span class="ps-sub">${esc(t12(l.start))} to ${esc(t12(l.end))}</span></td>
  <td>${esc(l.description || l.kindLabel)}${l.basis ? `<span class="ps-sub">${esc(l.basis)}</span>` : ''}${flagHtml(l)}</td>
  <td>${esc(l.location || '')}</td><td>${hrs(l.minutes)}</td>
  <td style="text-align:right;white-space:nowrap"><b>${l.cents == null ? 'TBC' : esc(money(l.cents))}</b>${admin && l.cents == null ? `<br><button type="button" class="j-btn j-btn-line j-btn-sm" data-line-set="${i}" style="margin-top:4px">Set amount</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`
const totalOf = (lines) => lines.reduce((t, l) => t + (l.cents || 0), 0)
const tbcOf = (lines) => lines.filter((l) => l.cents == null).length

async function downloadPdf(post, inv) {
  const r = await post('coachInvPdf', { id: inv.id })
  if (!r.ok) return toast(r.data.error || 'Could not make the PDF.')
  const bytes = Uint8Array.from(atob(r.data.base64), (c) => c.charCodeAt(0))
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
  a.download = r.data.filename
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 4000)
}

const DETAIL = [['fullName', 'Full name', 'text'], ['abn', 'ABN', 'numeric'], ['address', 'Address', 'text'], ['phone', 'Phone number', 'tel'], ['email', 'Email', 'email'], ['accountName', 'Account name', 'text'], ['bsb', 'BSB', 'numeric'], ['accountNumber', 'Account number', 'numeric']]
const detailsForm = (d = {}) => `<div class="j-two">${DETAIL.map(([k, l, m]) => `<label class="j-field"><span>${l}</span><input class="j-input" data-det="${k}" value="${esc(d[k] || '')}" ${m === 'numeric' ? 'inputmode="numeric"' : m === 'email' ? 'type="email"' : m === 'tel' ? 'type="tel"' : ''}></label>`).join('')}</div>`

// Rate card editor (Lee and Ligia): dollars an hour unless it says flat.
const CARD_FIELDS = [['weekendExtra', 'Weekend extra (Sat or Sun JFP, an hour)'], ['pathwayFlat', 'Pathway 45-minute class (flat)'], ['jjHead', 'Joners Juniors head coach (an hour)'], ['jjShadow', 'Joners Juniors shadow coach (an hour)'], ['office', 'Office hours (an hour)'], ['devSesh', 'Dev Sesh (an hour)']]
const dollars = (c) => (c ? (c / 100).toFixed(2).replace(/\.00$/, '') : '')
function cardForm(c, card, bands) {
  return `<div class="j-card" style="padding:12px 14px;margin-bottom:10px" data-card="${esc(c.id)}"><b>${esc(c.name)}</b>${card ? ` <span class="muted small">saved ${esc(new Date(card.savedAt).toLocaleDateString('en-AU'))}</span>` : ' <span class="j-pill j-pill-grey">No rates</span>'}
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px;margin-top:8px">${bands.map((b, i) => `<label class="j-field" style="margin:0"><span>${esc(b)}</span><input class="j-input" inputmode="decimal" data-band="${i}" value="${dollars(card?.bands?.[i])}"></label>`).join('')}</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px;margin-top:8px">${CARD_FIELDS.map(([k, l]) => `<label class="j-field" style="margin:0"><span>${esc(l)}</span><input class="j-input" inputmode="decimal" data-cf="${k}" value="${dollars(card?.[k])}" placeholder="Not agreed"></label>`).join('')}</div>
    <p class="muted small" style="margin:6px 0">Camps: agreed with Lee before each camp (TBC). Leave a box empty when there is no agreed rate: those lines wait for you.</p>
    <button type="button" class="j-btn j-btn-dark j-btn-sm" data-card-save>Save ${esc(c.name)}'s rates</button></div>`
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
      <div><b>${esc(inv.number)}</b>${admin ? ` · ${esc(inv.coach)}` : ''} <span class="j-pill j-pill-${PILL[inv.status] || 'grey'}">${esc(inv.statusLabel)}</span>${inv.flagCount ? ` <span class="j-pill j-pill-red">${inv.flagCount} to check</span>` : ''}${inv.pending ? ` <span class="j-pill j-pill-amber">${inv.pending} TBC</span>` : ''}
        <p class="muted small" style="margin-top:4px">${esc(inv.fromLabel)} to ${esc(inv.toLabel)} · ${hrs(inv.totalMinutes)} · <b>${esc(inv.amountLabel)}</b>${inv.paidAt ? ` · paid ${esc(new Date(inv.paidAt).toLocaleDateString('en-AU'))}` : ''}</p>
        ${inv.decisionNote ? `<p class="small" style="color:var(--j-red);margin-top:4px">${esc(inv.decisionNote)}</p>` : ''}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap"><button type="button" class="j-btn j-btn-line j-btn-sm" data-inv-open>See it</button><button type="button" class="j-btn j-btn-line j-btn-sm" data-inv-pdf>PDF</button>
        ${admin && inv.status === 'submitted' ? `<button type="button" class="j-btn j-btn-dark j-btn-sm" data-inv-do="approved" ${inv.pending ? 'disabled title="Set the TBC lines first"' : ''}>Approve</button><button type="button" class="j-btn j-btn-ghost j-btn-sm" data-inv-do="queried">Send back</button>` : ''}
        ${admin && inv.status === 'approved' ? '<button type="button" class="j-btn j-btn-dark j-btn-sm" data-inv-do="paid">Mark paid</button>' : ''}
        ${inv.canWithdraw ? '<button type="button" class="j-btn j-btn-ghost j-btn-sm" data-inv-withdraw>Withdraw</button>' : ''}</div></div></div>`
  const list = d.invoices.filter((x) => !S.status || x.status === S.status)

  if (admin) {
    view().innerHTML = `<div class="jp-head"><div><h1>Coach invoices</h1><p class="muted small" style="margin-top:4px">Made from the hours each coach logged. Every session is priced from the register (players marked present) and that coach's rate card. Flagged when a cover says otherwise, two coaches logged the same session, or the register is not marked. Due Monday 9am.</p></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><select class="j-select" id="inv-coach" style="width:auto"><option value="">Every coach</option>${d.coaches.map((c) => `<option value="${esc(c.id)}" ${S.coachId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
      <select class="j-select" id="inv-status" style="width:auto"><option value="">Any status</option>${Object.entries(d.status).map(([k, v]) => `<option value="${k}" ${S.status === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></div></div>
      ${list.map(card).join('') || '<p class="muted">No invoices yet.</p>'}
      <details class="j-card" style="padding:14px 16px;margin-top:16px" id="inv-cards"><summary><b>Rate cards</b> <span class="muted small">only you and Ligia see these</span></summary><div id="inv-cards-body" style="margin-top:10px"><p class="muted small">Loading…</p></div></details>`
    view().querySelector('#inv-coach').addEventListener('change', (e) => { S.coachId = e.target.value; reload() })
    view().querySelector('#inv-status').addEventListener('change', (e) => { S.status = e.target.value; renderCoachInvoices(ui) })
    view().querySelector('#inv-cards').addEventListener('toggle', async (e) => {
      if (!e.target.open) return
      const r = await post('coachPayCards')
      const box = view().querySelector('#inv-cards-body')
      if (!r.ok) { box.innerHTML = `<p class="j-err">${esc(r.data.error || 'Could not load.')}</p>`; return }
      box.innerHTML = r.data.coaches.map((c) => cardForm(c, r.data.cards[c.id], r.data.bands)).join('')
      box.querySelectorAll('[data-card-save]').forEach((b) => b.addEventListener('click', async () => {
        const el = b.closest('[data-card]')
        const cents = (v) => (String(v).trim() === '' ? null : Math.round(Number(String(v).replace(/[^0-9.]/g, '')) * 100))
        const cardBody = { bands: [...el.querySelectorAll('[data-band]')].map((i) => cents(i.value)) }
        el.querySelectorAll('[data-cf]').forEach((i) => { cardBody[i.dataset.cf] = cents(i.value) })
        const x = await post('coachPayCardSave', { coachId: el.dataset.card, card: cardBody })
        toast(x.ok ? 'Rates saved. They price new invoices.' : x.data.error)
      }))
    })
  } else {
    const draft = d.draft || []
    const det = d.details || {}
    const missing = ['fullName', 'accountName', 'bsb', 'accountNumber'].some((k) => !det[k])
    view().innerHTML = `<div class="jp-head"><div><h1>My invoices</h1><p class="muted small" style="margin-top:4px">Made from your hours in My hours. Each session is priced from the register: the players marked present and your rate. Send it by <b>Monday 9am</b> (next due ${esc(d.dueLabel)}). Only you, Lee and Ligia see your invoices.</p></div></div>
      <details class="j-card" style="padding:14px 16px;margin-bottom:16px" ${missing ? 'open' : ''}><summary><b>Your invoice details</b>${missing ? ' <span class="j-pill j-pill-amber">Fill these in first</span>' : ''}</summary>
        <p class="muted small" style="margin:8px 0">These print on your invoice, like the one you used to send. Only you, Lee and Ligia see them.</p>${detailsForm(det)}
        <button type="button" class="j-btn j-btn-dark j-btn-sm" id="det-save">Save my details</button></details>
      <section class="j-card" style="padding:14px 16px;margin-bottom:16px"><h3 style="margin-bottom:8px">New invoice</h3>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end"><label class="j-field" style="margin:0"><span>Dates</span><select class="j-select" id="inv-range">${RANGES.map(([k, l]) => `<option value="${k}" ${S.range === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
          ${S.range === 'custom' ? `<label class="j-field" style="margin:0"><span>From</span><input class="j-input" type="date" id="inv-from" value="${esc(from)}" max="${esc(today)}"></label><label class="j-field" style="margin:0"><span>To</span><input class="j-input" type="date" id="inv-to" value="${esc(to)}" max="${esc(today)}"></label>` : ''}</div>
        ${!d.hasCard ? '<p class="small" style="margin-top:10px">Lee has not set your rates in the portal yet, so amounts show as TBC. You can still send it.</p>' : ''}
        ${draft.length ? `${linesTable(draft)}
          <p style="margin:10px 0;text-align:right"><b>Total ${esc(money(totalOf(draft)))}</b>${tbcOf(draft) ? ` <span class="muted small">+ ${tbcOf(draft)} TBC (Lee or Ligia set)</span>` : ''}</p>
          <label class="j-field"><span>Note <span class="muted">(optional)</span></span><input class="j-input" id="inv-note" maxlength="400"></label>
          <button type="button" class="j-btn j-btn-dark" id="inv-send">Send to Lee and Ligia</button>`
        : '<p class="muted small" style="margin-top:10px">No hours logged in these dates that are not on an invoice already. Log them in My hours first.</p>'}
      </section>
      <h2 style="font-size:16px;margin:0 0 10px">Sent</h2>${list.map(card).join('') || '<p class="muted">None yet.</p>'}`
    view().querySelector('#det-save').addEventListener('click', async () => {
      const details = Object.fromEntries([...view().querySelectorAll('[data-det]')].map((i) => [i.dataset.det, i.value]))
      const r = await post('coachPayDetailsSave', { details })
      toast(r.ok ? 'Saved' : r.data.error); if (r.ok) reload()
    })
    view().querySelector('#inv-range').addEventListener('change', (e) => { S.range = e.target.value; reload() })
    view().querySelector('#inv-from')?.addEventListener('change', (e) => { S.from = e.target.value; reload() })
    view().querySelector('#inv-to')?.addEventListener('change', (e) => { S.to = e.target.value; reload() })
    view().querySelector('#inv-send')?.addEventListener('click', async (e) => {
      if (draft.some((l) => l.flags.some((f) => f.code !== 'waiting')) && !(await confirmBox('Some lines are flagged (the register, a cover or another coach). Send anyway? Lee or Ligia will check them.', { ok: 'Send' }))) return
      e.currentTarget.disabled = true
      const r = await post('coachInvCreate', { from, to, note: view().querySelector('#inv-note').value })
      if (!r.ok) { toast(r.data.error); e.currentTarget.disabled = false; return }
      toast('Sent to Lee and Ligia'); reload()
    })
  }
  const invOf = (el) => d.invoices.find((x) => x.id === el.closest('[data-inv]').dataset.inv)
  view().querySelectorAll('[data-inv-open]').forEach((b) => b.addEventListener('click', () => {
    const inv = invOf(b)
    const box = modal(`<h2 style="margin-bottom:4px">Invoice ${esc(inv.number)}</h2><p class="muted small" style="margin-bottom:10px">${esc(inv.coach)} · ${esc(inv.fromLabel)} to ${esc(inv.toLabel)} · ${hrs(inv.totalMinutes)} · <b>${esc(inv.amountLabel)}</b>${inv.dueLabel ? ` · due ${esc(inv.dueLabel)}` : ''}</p>${linesTable(inv.lines, { admin: admin && ['submitted', 'queried', 'approved'].includes(inv.status) })}${inv.note ? `<p class="small" style="margin-top:8px"><b>Note:</b> ${esc(inv.note)}</p>` : ''}<div class="jpf-acts"><button type="button" class="j-btn j-btn-line" data-close>Close</button></div>`, { wide: true })
    box.querySelectorAll('[data-line-set]').forEach((x) => x.addEventListener('click', async () => {
      const amt = window.prompt('Amount for this line, in dollars:')
      if (amt == null) return
      const why = window.prompt('Why (for example, the camp rate agreed with Lee):')
      if (!why) return toast('Say why.')
      const r = await post('coachInvLineSet', { id: inv.id, index: Number(x.dataset.lineSet), cents: Math.round(Number(String(amt).replace(/[^0-9.]/g, '')) * 100), note: why })
      toast(r.ok ? 'Saved' : r.data.error); if (r.ok) { closeModal(); reload() }
    }))
  }))
  view().querySelectorAll('[data-inv-pdf]').forEach((b) => b.addEventListener('click', () => downloadPdf(post, invOf(b))))
  view().querySelectorAll('[data-inv-withdraw]').forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmBox('Withdraw this invoice? Its hours come free to change and invoice again.', { ok: 'Withdraw' }))) return
    const r = await post('coachInvWithdraw', { id: invOf(b).id }); toast(r.ok ? 'Withdrawn' : r.data.error); if (r.ok) reload()
  }))
  view().querySelectorAll('[data-inv-do]').forEach((b) => b.addEventListener('click', async () => {
    const status = b.dataset.invDo
    let note = ''
    if (status === 'queried') {
      const box = modal('<h2 style="margin-bottom:8px">Send back</h2><label class="j-field"><span>What needs checking?</span><textarea class="j-textarea" id="inv-q" rows="3" maxlength="300"></textarea></label><div class="jpf-acts"><button type="button" class="j-btn j-btn-line" data-close>Cancel</button><button type="button" class="j-btn j-btn-dark" id="inv-q-go">Send back</button></div>')
      note = await new Promise((res) => box.querySelector('#inv-q-go').addEventListener('click', () => res(box.querySelector('#inv-q').value.trim())))
      closeModal()
      if (!note) return toast('Say what needs checking.')
    }
    const r = await post('coachInvDecide', { id: invOf(b).id, status, note }); toast(r.ok ? 'Saved' : r.data.error); if (r.ok) reload()
  }))
}
