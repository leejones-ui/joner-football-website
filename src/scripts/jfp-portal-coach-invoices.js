// Coach invoices (Lee, 19 and 20 Oct 2026). Coaches: "My invoices", an
// invoice made from the hours they logged, each session line priced from the
// register (players marked Present) and their own rate card, laid out like
// the invoices they used to send, emailed to Lee and Ligia with the PDF, due
// Monday 9am. Lee and Ligia: "Coach invoices", every invoice with its lines
// checked against the register and covers, set a TBC line, Approve, Mark paid
// or Send back, and each coach's rate card.
// Fully editable (Lee, 20 Oct 2026): a coach changes any line before sending
// (what, where, hours, amount), takes one off or adds one; Lee and Ligia change,
// add or take off any line after. A changed amount shows what the portal
// worked out. Lee can also make his own ("My own invoice").
// A coach only ever sees their own. Server: api/_jfp-coach-invoices.js.
import { esc, toast } from './jfp-common.js'

const S = { coachId: '', status: '', range: 'lastweek', from: '', to: '', mine: false, edits: {}, added: [], key: '' }
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

const flagHtml = (l) => (l.flags || []).map((f) => `<span class="j-pill j-pill-${f.code === 'waiting' || f.code === 'edited' || f.code === 'added' ? 'amber' : 'red'}" style="margin:2px 4px 0 0">${esc(f.text)}</span>`).join('')
const timeOf = (l) => (l.start ? `${t12(l.start)} to ${t12(l.end)}` : '')
const linesTable = (lines, { admin = false } = {}) => `<div class="ps-table-wrap"><table class="ps-table ps-flat"><thead><tr><th>Date</th><th>What and who</th><th>Location</th><th>Hours</th><th style="text-align:right">Total</th></tr></thead><tbody>${lines.map((l, i) => `<tr>
  <td><b>${esc(l.dateLabel)}</b><span class="ps-sub">${esc(timeOf(l))}</span></td>
  <td>${esc(l.description || l.kindLabel)}${l.basis ? `<span class="ps-sub">${esc(l.basis)}</span>` : ''}${flagHtml(l)}</td>
  <td>${esc(l.location || '')}</td><td>${hrs(l.minutes)}</td>
  <td style="text-align:right;white-space:nowrap"><b>${l.cents == null ? 'TBC' : esc(money(l.cents))}</b>${admin ? `<br><button type="button" class="j-btn j-btn-line j-btn-sm" data-line-set="${i}" style="margin-top:4px">${l.cents == null ? 'Set amount' : 'Change'}</button>` : ''}</td></tr>`).join('')}</tbody></table></div>${admin ? '<button type="button" class="j-btn j-btn-line j-btn-sm" id="line-add" style="margin-top:8px">+ Add a line</button>' : ''}`

// The line form (Lee and Ligia's change, or an added line).
const lineForm = (l = {}, { add = false } = {}) => `${add ? `<label class="j-field"><span>Date</span><input class="j-input" type="date" id="lf-date" value="${esc(l.date || '')}"></label>` : ''}
  <label class="j-field"><span>What and who</span><textarea class="j-textarea" id="lf-desc" rows="2" maxlength="300">${esc(l.description || '')}</textarea></label>
  <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px"><label class="j-field"><span>Location</span><input class="j-input" id="lf-loc" maxlength="80" value="${esc(l.location || '')}"></label>
  <label class="j-field"><span>Hours</span><input class="j-input" id="lf-hrs" inputmode="decimal" value="${l.minutes != null ? +(l.minutes / 60).toFixed(2) : ''}"></label>
  <label class="j-field"><span>Amount (A$)</span><input class="j-input" id="lf-amt" inputmode="decimal" value="${l.cents != null ? (l.cents / 100).toFixed(2) : ''}" placeholder="TBC"></label></div>`
const readForm = (box) => {
  const num = (v) => String(v).replace(/[^0-9.]/g, '')
  const amt = num(box.querySelector('#lf-amt').value), h = num(box.querySelector('#lf-hrs').value)
  return { date: box.querySelector('#lf-date')?.value, description: box.querySelector('#lf-desc').value, location: box.querySelector('#lf-loc').value, minutes: h === '' ? '' : Math.round(Number(h) * 60), cents: amt === '' ? '' : Math.round(Number(amt) * 100) }
}
// Lee and Ligia: the families on this invoice whose fees are not paid, to chase now.
function chaseList(inv) {
  const seen = new Map()
  for (const l of inv.lines) for (const u of l.unpaid || []) if (!seen.has(u.rowId)) seen.set(u.rowId, u)
  if (!seen.size) return ''
  return `<div class="j-card" style="padding:10px 12px;margin-bottom:10px;border-color:var(--j-red)"><b>Fees not paid: chase these families now</b><ul style="margin:6px 0 0 18px">${[...seen.values()].map((u) => `<li>${esc(u.name)} · ${esc(u.status)}${u.owedCents ? ` · owes ${esc(money(u.owedCents))}` : ''}</li>`).join('')}</ul></div>`
}
const fmtD = (s) => new Intl.DateTimeFormat('en-AU', { timeZone: 'UTC', day: 'numeric', month: 'short' }).format(new Date(`${s}T00:00:00Z`))
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
const CARD_FIELDS = [['weekendExtra', 'Weekend extra (Sat or Sun JFP, an hour)'], ['pathwayFlat', 'Pathway 45-minute class (flat)'], ['jjHead', 'Joners Juniors, head or shadow (an hour)'], ['office', 'Office hours (an hour)'], ['devSesh', 'Dev Sesh (flat, each one)']]
const dollars = (c) => (c ? (c / 100).toFixed(2).replace(/\.00$/, '') : '')
function cardForm(c, card, bands, groups = []) {
  const custom = Object.entries(card?.custom || {})
  const label = (id) => groups.find((g) => g.id === id)?.label || id
  const mine = groups.filter((g) => g.coachId === c.id)
  return `<div class="j-card" style="padding:12px 14px;margin-bottom:10px" data-card="${esc(c.id)}"><b>${esc(c.name)}</b>${card ? ` <span class="muted small">saved ${esc(new Date(card.savedAt).toLocaleDateString('en-AU'))}</span>` : ' <span class="j-pill j-pill-grey">No rates</span>'}
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px;margin-top:8px">${bands.map((b, i) => `<label class="j-field" style="margin:0"><span>${esc(b)}</span><input class="j-input" inputmode="decimal" data-band="${i}" value="${dollars(card?.bands?.[i])}"></label>`).join('')}</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px;margin-top:8px">${CARD_FIELDS.map(([k, l]) => `<label class="j-field" style="margin:0"><span>${esc(l)}</span><input class="j-input" inputmode="decimal" data-cf="${k}" value="${dollars(card?.[k])}" placeholder="Not agreed"></label>`).join('')}</div>
    <div style="margin-top:10px"><b class="small">Custom rate for one session (an hour)</b>
      ${custom.map(([gid, cents]) => `<div style="display:flex;gap:8px;align-items:center;margin-top:6px" data-cu="${esc(gid)}"><span class="small" style="flex:1">${esc(label(gid))}</span><input class="j-input" inputmode="decimal" data-cu-v value="${dollars(cents)}" style="width:110px" placeholder="Remove"></div>`).join('')}
      <div style="display:flex;gap:8px;align-items:center;margin-top:6px"><select class="j-select" data-cu-new style="flex:1"><option value="">Add a custom rate for a session…</option>${mine.filter((g) => !card?.custom?.[g.id]).map((g) => `<option value="${esc(g.id)}">${esc(g.label)}</option>`).join('')}</select><input class="j-input" inputmode="decimal" data-cu-new-v style="width:110px" placeholder="A$"></div></div>
    <p class="muted small" style="margin:6px 0">Camps: agreed with Lee before each camp (TBC). Leave a box empty when there is no agreed rate: those lines wait for you.</p>
    <button type="button" class="j-btn j-btn-dark j-btn-sm" data-card-save>Save ${esc(c.name)}'s rates</button></div>`
}

export async function renderCoachInvoices(ui) {
  const { view, post, need, user, modal, closeModal, confirmBox } = ui
  const isAdmin = user.role === 'admin'
  const admin = isAdmin && !S.mine
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date())
  const [from, to] = rangeOf(S.range, today)
  const d = await need(await post('coachInvList', admin ? { coachId: S.coachId } : { from, to, mine: isAdmin }))
  // Edits belong to one set of dates.
  if (S.key !== `${from}|${to}`) { S.key = `${from}|${to}`; S.edits = {}; S.added = [] }
  const reload = () => renderCoachInvoices(ui)
  const card = (inv) => `<div class="j-card" style="padding:14px 16px;margin-bottom:10px" data-inv="${esc(inv.id)}">
    <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:flex-start">
      <div><b>${esc(inv.number)}</b>${admin ? ` · ${esc(inv.coach)}` : ''} <span class="j-pill j-pill-${PILL[inv.status] || 'grey'}">${esc(inv.statusLabel)}</span>${inv.flagCount ? ` <span class="j-pill j-pill-red">${inv.flagCount} to check</span>` : ''}${inv.pending ? ` <span class="j-pill j-pill-amber">${inv.pending} TBC</span>` : ''}${inv.unpaidCount ? ` <span class="j-pill j-pill-red">Fees not paid: chase ${inv.unpaidCount}</span>` : ''}
        <p class="muted small" style="margin-top:4px">${esc(inv.fromLabel)} to ${esc(inv.toLabel)} · ${hrs(inv.totalMinutes)} · <b>${esc(inv.amountLabel)}</b>${inv.paidAt ? ` · paid ${esc(new Date(inv.paidAt).toLocaleDateString('en-AU'))}` : ''}</p>
        ${inv.decisionNote ? `<p class="small" style="color:var(--j-red);margin-top:4px">${esc(inv.decisionNote)}</p>` : ''}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap"><button type="button" class="j-btn j-btn-line j-btn-sm" data-inv-open>See it</button><button type="button" class="j-btn j-btn-line j-btn-sm" data-inv-pdf>PDF</button>
        ${admin && inv.status === 'submitted' ? `<button type="button" class="j-btn j-btn-dark j-btn-sm" data-inv-do="approved" ${inv.pending ? 'disabled title="Set the TBC lines first"' : ''}>Approve</button><button type="button" class="j-btn j-btn-ghost j-btn-sm" data-inv-do="queried">Send back</button>` : ''}
        ${admin && inv.status === 'approved' ? '<button type="button" class="j-btn j-btn-dark j-btn-sm" data-inv-do="paid">Mark paid</button>' : ''}
        ${inv.canWithdraw ? '<button type="button" class="j-btn j-btn-ghost j-btn-sm" data-inv-withdraw>Withdraw</button>' : ''}</div></div></div>`
  const list = d.invoices.filter((x) => !S.status || x.status === S.status)

  if (admin) {
    view().innerHTML = `<div class="jp-head"><div><h1>Coach invoices</h1><p class="muted small" style="margin-top:4px">Made from the hours each coach logged. Every session is priced from the register (players marked present) and that coach's rate card. Flagged when a cover says otherwise, two coaches logged the same session, or the register is not marked. Due Monday 9am.</p></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">${d.myCoachId ? '<button type="button" class="j-btn j-btn-line" id="inv-mine">My own invoice</button>' : ''}<select class="j-select" id="inv-coach" style="width:auto"><option value="">Every coach</option>${d.coaches.map((c) => `<option value="${esc(c.id)}" ${S.coachId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
      <select class="j-select" id="inv-status" style="width:auto"><option value="">Any status</option>${Object.entries(d.status).map(([k, v]) => `<option value="${k}" ${S.status === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></div></div>
      <details class="j-card" style="padding:12px 16px;margin-bottom:14px"><summary><b>How it works</b></summary><ol class="small" style="margin:8px 0 0 18px;display:grid;gap:4px">
        <li>The coach logs each session in <b>My hours</b> (one tap, or Log all as on the register) and ticks who was there. Their own timetabled sessions and covers on record are approved as they log them. Anything else (events, admin, a TBC rate, players that differ from the register) waits for you in Coach hours.</li>
        <li>By Monday 9am the coach opens <b>My invoices</b>, checks the lines (priced from the register and their rate card) and presses Send to Lee and Ligia.</li>
        <li>It lands here. You check the flags, set any TBC line and press <b>Approve</b> once. That approves every hour on it too. Then <b>Mark paid</b> when you have paid them.</li></ol></details>
      ${(d.unbilled || []).length ? `<section class="j-card" style="padding:12px 16px;margin-bottom:14px"><h2 style="font-size:16px;margin:0 0 6px">Not invoiced yet</h2><p class="muted small" style="margin:0 0 8px">Hours logged that are not on an invoice. The coach sends these from My invoices.</p>
        <ul style="margin:0;padding:0;list-style:none;display:grid;gap:6px">${d.unbilled.map((u) => `<li style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><span><b>${esc(u.coach)}</b> · ${hrs(u.minutes)} in ${u.entries} entr${u.entries === 1 ? 'y' : 'ies'}, ${esc(u.fromLabel)} to ${esc(u.toLabel)}</span>${u.waiting ? `<span class="j-pill j-pill-amber">${u.waiting} waiting in Coach hours</span>` : ''}</li>`).join('')}</ul></section>` : ''}
      ${list.map(card).join('') || '<p class="muted">No invoices sent yet.</p>'}
      <details class="j-card" style="padding:14px 16px;margin-top:16px" id="inv-cards"><summary><b>Rate cards</b> <span class="muted small">only you and Ligia see these</span></summary><div id="inv-cards-body" style="margin-top:10px"><p class="muted small">Loading…</p></div></details>`
    view().querySelector('#inv-coach').addEventListener('change', (e) => { S.coachId = e.target.value; reload() })
    view().querySelector('#inv-mine')?.addEventListener('click', () => { S.mine = true; reload() })
    view().querySelector('#inv-status').addEventListener('change', (e) => { S.status = e.target.value; renderCoachInvoices(ui) })
    view().querySelector('#inv-cards').addEventListener('toggle', async (e) => {
      if (!e.target.open) return
      const r = await post('coachPayCards')
      const box = view().querySelector('#inv-cards-body')
      if (!r.ok) { box.innerHTML = `<p class="j-err">${esc(r.data.error || 'Could not load.')}</p>`; return }
      box.innerHTML = r.data.coaches.map((c) => cardForm(c, r.data.cards[c.id], r.data.bands, r.data.groups)).join('')
      box.querySelectorAll('[data-card-save]').forEach((b) => b.addEventListener('click', async () => {
        const el = b.closest('[data-card]')
        const cents = (v) => (String(v).trim() === '' ? null : Math.round(Number(String(v).replace(/[^0-9.]/g, '')) * 100))
        const cardBody = { bands: [...el.querySelectorAll('[data-band]')].map((i) => cents(i.value)) }
        el.querySelectorAll('[data-cf]').forEach((i) => { cardBody[i.dataset.cf] = cents(i.value) })
        cardBody.jjShadow = cardBody.jjHead
        cardBody.custom = {}
        el.querySelectorAll('[data-cu]').forEach((row) => { const v = cents(row.querySelector('[data-cu-v]').value); if (v != null) cardBody.custom[row.dataset.cu] = v })
        const ng = el.querySelector('[data-cu-new]').value, nv = cents(el.querySelector('[data-cu-new-v]').value)
        if (ng && nv != null) cardBody.custom[ng] = nv
        const x = await post('coachPayCardSave', { coachId: el.dataset.card, card: cardBody })
        toast(x.ok ? 'Rates saved. They price new invoices.' : x.data.error)
      }))
    })
  } else {
    const draft = d.draft || []
    const det = d.details || {}
    const missing = ['fullName', 'accountName', 'bsb', 'accountNumber'].some((k) => !det[k])
    view().innerHTML = `${S.mine ? '<p style="margin-bottom:10px"><button type="button" class="ps-link" id="inv-back">Back to Coach invoices</button></p>' : ''}<div class="jp-head"><div><h1>${S.mine ? 'My own invoice' : 'My invoices'}</h1><p class="muted small" style="margin-top:4px">Made from your hours in My hours. Each session is priced from the players you ticked in My hours (or the register) and your rate. You can change any line before you send it. Send it by <b>Monday 9am</b> (next due ${esc(d.dueLabel)}). Only you, Lee and Ligia see your invoices.</p></div></div>
      <details class="j-card" style="padding:14px 16px;margin-bottom:16px" ${missing ? 'open' : ''}><summary><b>Your invoice details</b>${missing ? ' <span class="j-pill j-pill-amber">Fill these in first</span>' : ''}</summary>
        <p class="muted small" style="margin:8px 0">These print on your invoice, like the one you used to send. Only you, Lee and Ligia see them.</p>${detailsForm(det)}
        <button type="button" class="j-btn j-btn-dark j-btn-sm" id="det-save">Save my details</button></details>
      <section class="j-card" style="padding:14px 16px;margin-bottom:16px"><h3 style="margin-bottom:8px">New invoice</h3>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end"><label class="j-field" style="margin:0"><span>Dates</span><select class="j-select" id="inv-range">${RANGES.map(([k, l]) => `<option value="${k}" ${S.range === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
          ${S.range === 'custom' ? `<label class="j-field" style="margin:0"><span>From</span><input class="j-input" type="date" id="inv-from" value="${esc(from)}" max="${esc(today)}"></label><label class="j-field" style="margin:0"><span>To</span><input class="j-input" type="date" id="inv-to" value="${esc(to)}" max="${esc(today)}"></label>` : ''}</div>
        ${!d.hasCard ? '<p class="small" style="margin-top:10px">Lee has not set your rates in the portal yet, so amounts show as TBC. You can still send it.</p>' : ''}
        ${draft.length || S.added.length ? `<p class="muted small" style="margin:10px 0 6px">Check each line. You can change anything, take a line off (it stays in My hours for later) or add one. Lee and Ligia see what you changed.</p>
          <div id="inv-draft"></div>
          <button type="button" class="j-btn j-btn-line j-btn-sm" id="inv-add-line">+ Add a line</button>
          <p style="margin:10px 0;text-align:right" id="inv-total"></p>
          <label class="j-field"><span>Note <span class="muted">(optional)</span></span><input class="j-input" id="inv-note" maxlength="400"></label>
          <button type="button" class="j-btn j-btn-dark" id="inv-send">Send to Lee and Ligia</button>`
        : '<p class="muted small" style="margin-top:10px">No hours logged in these dates that are not on an invoice already. Log them in My hours first, or add a line here.</p><button type="button" class="j-btn j-btn-line j-btn-sm" id="inv-add-line">+ Add a line</button>'}
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
    view().querySelector('#inv-back')?.addEventListener('click', () => { S.mine = false; reload() })
    // The editable lines: what the portal worked out, with the coach's changes on top.
    const cur = (l) => ({ ...l, ...(S.edits[l.hoursId] || {}) })
    const drawDraft = () => {
      const box = view().querySelector('#inv-draft')
      if (!box) return
      const rows = draft.map((l) => ({ l: cur(l), base: l, off: S.edits[l.hoursId]?.remove }))
      box.innerHTML = [...rows.map(({ l, base, off }) => `<div class="j-card" style="padding:10px 12px;margin-bottom:8px;${off ? 'opacity:.5' : ''}" data-dl="${esc(l.hoursId)}">
          <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start"><div><b>${esc(l.dateLabel)}</b> <span class="muted small">${esc(timeOf(l))}${base.basis ? ` · ${esc(base.basis)}` : ''}</span><div>${flagHtml(base)}</div></div>
          <button type="button" class="j-btn j-btn-ghost j-btn-sm" data-dl-off>${off ? 'Put back' : 'Take off'}</button></div>
          ${off ? '' : `<textarea class="j-textarea" data-f="description" rows="2" maxlength="300" style="margin-top:6px">${esc(l.description || '')}</textarea>
          <div style="display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr) minmax(0,1fr);gap:8px;margin-top:6px"><label class="j-field" style="margin:0"><span>Location</span><input class="j-input" data-f="location" value="${esc(l.location || '')}"></label><label class="j-field" style="margin:0"><span>Hours</span><input class="j-input" data-f="hours" inputmode="decimal" value="${+(l.minutes / 60).toFixed(2)}"></label><label class="j-field" style="margin:0"><span>A$</span><input class="j-input" data-f="amount" inputmode="decimal" value="${l.cents != null ? (l.cents / 100).toFixed(2) : ''}" placeholder="TBC"></label></div>
          ${base.cents !== l.cents ? `<p class="small" style="margin-top:4px;color:var(--j-amber)">Changed. Worked out: ${base.cents == null ? 'TBC' : esc(money(base.cents))}</p>` : ''}`}</div>`),
        ...S.added.map((a, i) => `<div class="j-card" style="padding:10px 12px;margin-bottom:8px" data-al="${i}"><div style="display:flex;justify-content:space-between;gap:8px"><b>${esc(a.date ? fmtD(a.date) : '')}</b> <span class="j-pill j-pill-amber">Added</span><button type="button" class="j-btn j-btn-ghost j-btn-sm" data-al-off>Remove</button></div><p style="margin:4px 0">${esc(a.description)}</p><p class="muted small">${esc(a.location || '')} · ${+(a.minutes / 60).toFixed(2)}h · ${a.cents === '' || a.cents == null ? 'TBC' : esc(money(a.cents))}</p></div>`)].join('')
      drawTotal()
      box.querySelectorAll('[data-dl]').forEach(wireLine)
      box.querySelectorAll('[data-al-off]').forEach((b) => b.addEventListener('click', () => { S.added.splice(Number(b.closest('[data-al]').dataset.al), 1); drawDraft() }))
    }
    const drawTotal = () => {
      const live = draft.filter((l) => !S.edits[l.hoursId]?.remove).map(cur)
      const all = [...live, ...S.added.map((a) => ({ ...a, cents: a.cents === '' ? null : a.cents }))]
      view().querySelector('#inv-total').innerHTML = `<b>Total ${esc(money(totalOf(all)))}</b>${tbcOf(all) ? ` <span class="muted small">+ ${tbcOf(all)} TBC (Lee or Ligia set)</span>` : ''}`
    }
    const wireLine = (el) => {
        const id = el.dataset.dl
        el.querySelector('[data-dl-off]').addEventListener('click', () => { S.edits[id] = { ...(S.edits[id] || {}), remove: !S.edits[id]?.remove }; drawDraft() })
        el.querySelectorAll('[data-f]').forEach((i) => i.addEventListener('change', () => {
          const e = (S.edits[id] ||= {})
          const v = i.value, n = String(v).replace(/[^0-9.]/g, '')
          if (i.dataset.f === 'hours') e.minutes = Math.round(Number(n) * 60)
          else if (i.dataset.f === 'amount') e.cents = n === '' ? null : Math.round(Number(n) * 100)
          else e[i.dataset.f] = v
          drawTotal()
        }))
    }
    drawDraft()
    view().querySelector('#inv-add-line')?.addEventListener('click', () => {
      const box = modal(`<h2 style="margin-bottom:10px">Add a line</h2>${lineForm({ date: to }, { add: true })}<p class="j-err" id="lf-err" hidden></p><div class="jpf-acts"><button type="button" class="j-btn j-btn-line" data-close>Cancel</button><button type="button" class="j-btn j-btn-dark" id="lf-go">Add</button></div>`)
      box.querySelector('#lf-go').addEventListener('click', () => {
        const x = readForm(box)
        const bad = !x.date || x.date < from || x.date > to ? `Choose a date from ${fmtD(from)} to ${fmtD(to)}.` : !x.description.trim() ? 'Say what the line is for.' : ''
        if (bad) { const e = box.querySelector('#lf-err'); e.textContent = bad; e.hidden = false; return }
        S.added.push({ ...x, minutes: x.minutes === '' ? 0 : x.minutes }); closeModal()
        if (!view().querySelector('#inv-draft')) reload(); else drawDraft()
      })
    })
    view().querySelector('#inv-send')?.addEventListener('click', async (e) => {
      // Held before any await: currentTarget is null after the confirm box (Dean, 26 Oct 2026: Send did nothing).
      const btn = e.currentTarget
      if (draft.some((l) => !S.edits[l.hoursId]?.remove && l.flags.some((f) => f.code !== 'waiting')) && !(await confirmBox('Some lines are flagged (the register, a cover or another coach). Send anyway? Lee or Ligia will check them.', { ok: 'Send' }))) return
      btn.disabled = true
      const lines = Object.entries(S.edits).map(([hoursId, x]) => ({ hoursId, ...x }))
      const r = await post('coachInvCreate', { from, to, note: view().querySelector('#inv-note').value, lines, added: S.added })
      if (!r.ok) { toast(r.data.error); btn.disabled = false; return }
      S.edits = {}; S.added = []
      toast(r.data.emailed === false ? 'Saved. The email to Lee and Ligia did not go: tell Lee.' : 'Sent to Lee and Ligia'); reload()
    })
  }
  const invOf = (el) => d.invoices.find((x) => x.id === el.closest('[data-inv]').dataset.inv)
  view().querySelectorAll('[data-inv-open]').forEach((b) => b.addEventListener('click', () => {
    const inv = invOf(b)
    const box = modal(`<h2 style="margin-bottom:4px">Invoice ${esc(inv.number)}</h2><p class="muted small" style="margin-bottom:10px">${esc(inv.coach)} · ${esc(inv.fromLabel)} to ${esc(inv.toLabel)} · ${hrs(inv.totalMinutes)} · <b>${esc(inv.amountLabel)}</b>${inv.dueLabel ? ` · due ${esc(inv.dueLabel)}` : ''}</p>${chaseList(inv)}${linesTable(inv.lines, { admin: admin && ['submitted', 'queried', 'approved'].includes(inv.status) })}${inv.note ? `<p class="small" style="margin-top:8px"><b>Note:</b> ${esc(inv.note)}</p>` : ''}<div class="jpf-acts"><button type="button" class="j-btn j-btn-line" data-close>Close</button></div>`, { wide: true })
    const lineModal = (i) => {
      const l = i == null ? { date: inv.to, minutes: 60 } : inv.lines[i]
      const m = modal(`<h2 style="margin-bottom:4px">${i == null ? 'Add a line' : `Change line, ${esc(l.dateLabel)}`}</h2>${l.calcCents !== undefined && l.calcCents !== l.cents ? `<p class="muted small">Worked out: ${l.calcCents == null ? 'TBC' : esc(money(l.calcCents))}</p>` : ''}${lineForm(l, { add: i == null })}<label class="j-field"><span>Why <span class="muted">(optional, for example the camp rate agreed)</span></span><input class="j-input" id="lf-why" maxlength="200"></label><p class="j-err" id="lf-err" hidden></p>
        <div class="jpf-acts">${i != null ? '<button type="button" class="j-btn j-btn-ghost" id="lf-off">Take this line off</button>' : ''}<button type="button" class="j-btn j-btn-line" data-close>Cancel</button><button type="button" class="j-btn j-btn-dark" id="lf-go">Save</button></div>`)
      const done = (r) => { if (!r.ok) { const e = m.querySelector('#lf-err'); e.textContent = r.data.error || 'Could not save.'; e.hidden = false; return } closeModal(); toast('Saved'); reload() }
      m.querySelector('#lf-go').addEventListener('click', async () => {
        const x = readForm(m)
        done(i == null ? await post('coachInvLineAdd', { id: inv.id, line: x }) : await post('coachInvLineSet', { id: inv.id, index: i, line: x, note: m.querySelector('#lf-why').value }))
      })
      m.querySelector('#lf-off')?.addEventListener('click', async () => { if (await confirmBox('Take this line off the invoice? Its hours come free.', { ok: 'Take off' })) done(await post('coachInvLineRemove', { id: inv.id, index: i })) })
    }
    box.querySelectorAll('[data-line-set]').forEach((x) => x.addEventListener('click', () => lineModal(Number(x.dataset.lineSet))))
    box.querySelector('#line-add')?.addEventListener('click', () => lineModal(null))
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
