// Bank transfers to check, on Money (Lee, 12 Oct 2026): money in from the
// bank (Xero, or a bank statement CSV uploaded here) with the player it is
// probably for. Lee records each one with one tap, or hides it.
// Read with its own action when Money first opens, never by the two minute
// refresh, so Money stays quick.
//
// 13 Oct 2026: every line can also be marked as holiday training ("Holiday
// revenue") or put on last term's list ("Previous term"); hints say which a
// line looks like; lines from before this term sit in their own fold; chips
// pick what is shown. "Pro session" puts a line in Money > Pro sessions.
import { esc, money } from './jfp-common.js'
import { parseBankCsv } from './jfp-bank-csv.js'

const B = { data: null, at: 0, loading: null, open: false, hiddenOpen: false, beforeOpen: false, chip: 'all', undo: null, prev: null, draw: () => {} }
const STALE = 5 * 60000
const STALE_XERO = 26 * 3600000

// ui: { post, toast }. Calls draw() when the answer comes in.
// Money may have been drawn again while waiting: the newest page is the one redrawn.
export function loadBank(ui, draw, { force = false } = {}) {
  B.draw = draw
  if (!force && B.data && Date.now() - B.at < STALE) return
  if (B.loading) return
  B.loading = ui.post('bankCheck').then((r) => {
    B.loading = null
    if (!r.ok || !r.data?.bank) { if (!B.data || B.data.error) B.data = { error: r.data?.error || 'Bank transfers could not be read just now.' } } else { B.data = r.data.bank; B.at = Date.now() }
    B.draw()
  })
}

const GRADE = { high: ['Likely match', 'j-pill-green'], possible: ['Possible match', 'j-pill-amber'], none: ['No match yet', 'j-pill-grey'] }
const when = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
const whenYear = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
const first = (name) => String(name || '').split(/\s+/)[0] || 'this player'
const CHIPS = [['all', 'All'], ['term', 'This term'], ['holiday', 'Looks like holiday'], ['last', 'Looks like last term'], ['hidden', 'Hidden']]

// The items for the venue picked: the top candidate's venue. Lines with no
// candidate belong to no venue, so they show under All only.
export function bankItems(loc) {
  const items = B.data?.items || []
  return loc ? items.filter((x) => x.candidates[0]?.locationId === loc) : items
}
function beforeItems(loc) {
  const items = B.data?.before || []
  return loc ? items.filter((x) => x.candidates[0]?.locationId === loc) : items
}
const hinted = (key) => (x) => Boolean(x.hints?.[key])

export function bankPanel(loc) {
  const d = B.data
  const items = bankItems(loc)
  const before = beforeItems(loc)
  const toCheck = items.filter((x) => x.grade !== 'none').length
  const src = d?.sources || {}
  const xero = src.xeroAt ? `From Xero, updated ${new Date(src.xeroAt).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}` : 'No Xero update in the last 3 days'
  const csv = src.csvAt ? ` · Bank CSV uploaded ${new Date(src.csvAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}` : ''
  // The Mac sends Xero twice a day. Over a day old means it has stopped.
  const stale = d && !d.error && (!src.xeroAt || Date.now() - Date.parse(src.xeroAt) > STALE_XERO)
  const staleNote = !stale ? '' : src.xeroAt ? `Xero hasn't updated since ${new Date(src.xeroAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}. Upload the bank CSV for now.` : 'Xero has stopped sending. Upload the bank CSV for now.'
  const hidden = loc ? [] : d?.hidden || []
  const count = !d ? '<span class="n muted">checking</span>' : d.error ? '' : `<span class="n">${items.length}</span>`
  const all = [...items, ...before]
  const n = { all: all.length, term: items.length, holiday: all.filter(hinted('holiday')).length, last: all.filter(hinted('lastTerm')).length, hidden: hidden.length }
  const chip = n[B.chip] != null ? B.chip : 'all'
  const chips = d && !d.error && (all.length || hidden.length) ? `<div class="jm-chips jm-bank-chips" id="m-bank-chips" role="group" aria-label="Show">${CHIPS.map(([k, l]) => `<button type="button" data-bank-chip="${k}" aria-pressed="${chip === k}">${l} <span class="n">${n[k]}</span></button>`).join('')}</div>` : ''
  let list
  if (!d) list = '<p class="muted small">Checking the bank lines</p>'
  else if (d.error) list = `<div class="j-box j-box-amber small">${esc(d.error)}</div>`
  else if (chip === 'hidden') list = hidden.length ? hiddenList(hidden) : '<p class="muted small">Nothing hidden.</p>'
  else {
    const shown = chip === 'holiday' ? all.filter(hinted('holiday')) : chip === 'last' ? all.filter(hinted('lastTerm')) : items
    list = shown.length ? `<ul class="jm-bank-list">${shown.map(itemHtml).join('')}</ul>`
      : chip === 'all' || chip === 'term' ? `<p class="muted small">Nothing to check${loc ? ' at this venue' : ''}. Every bank transfer we can see is recorded or hidden.</p>`
        : `<p class="muted small">No bank transfers ${chip === 'holiday' ? 'look like holiday training' : 'look like last term'}${loc ? ' at this venue' : ''}.</p>`
    // Lines from before this term: their own fold, under All.
    if (chip === 'all' && before.length) list += `<details class="jm-bank-before" id="m-bank-before"${B.beforeOpen ? ' open' : ''}><summary>Before this term (${before.length})</summary><p class="small muted">Older transfers, from before this term's payments start: holiday training and last term's fees. Sort them with the buttons.</p><ul class="jm-bank-list">${before.map(itemHtml).join('')}</ul></details>`
  }
  const undo = B.undo ? `<div class="j-box j-box-blue small jm-bank-undo" id="m-bank-undo"><span>${esc(B.undo.text)}</span><button type="button" class="j-btn j-btn-line j-btn-sm" data-bank-undo="${esc(B.undo.id)}">Undo</button></div>` : ''
  return `<details class="jm-next jm-bank" id="m-bank-box" ${B.open ? 'open' : ''}><summary>Bank transfers to check ${count}${toCheck ? ` <small class="muted">${toCheck} with a match</small>` : ''}</summary>
    <div class="jm-bank-src">
      <p class="small" id="m-bank-xero">${esc(xero)}${esc(csv)}</p>
      ${staleNote ? `<p class="j-box j-box-amber small" id="m-bank-stale">${esc(staleNote)}</p>` : ''}
      <p class="small muted">Xero only shows transfers after they're coded in Xero. Uploading the bank CSV works straight away.</p>
      <div class="jm-bank-up"><label class="j-btn j-btn-line j-btn-sm" for="m-bank-file">Upload bank statement (CSV)</label><input type="file" id="m-bank-file" accept=".csv,text/csv,text/plain" class="jm-file"><span class="small muted">CommBank NetBank &gt; Accounts &gt; Export &gt; CSV</span></div>
    </div>
    ${undo}${chips}
    ${list}
    ${hidden.length && chip === 'all' ? `<details class="jm-bank-hidden" id="m-bank-hidden"${B.hiddenOpen ? ' open' : ''}><summary>Hidden (${hidden.length})</summary>${hiddenList(hidden)}</details>` : ''}</details>`
}

const hiddenList = (hidden) => `<ul class="jm-hist">${hidden.map((x) => `<li data-bank-hid="${esc(x.id)}"><span><b>${esc(money(x.cents))}</b> <small>${esc(when(x.date))} · ${esc(x.payer)}</small></span><button type="button" class="j-btn j-btn-line j-btn-sm" data-bank-show>Show again</button></li>`).join('')}</ul>`

function itemHtml(x) {
  const c = x.candidates[0]
  const [label, pill] = GRADE[x.grade] || GRADE.none
  const pv = x.previous
  const hints = `${x.hints?.holiday ? '<span class="j-pill j-pill-blue" data-hint="holiday">Looks like holiday training</span>' : ''}${x.hints?.lastTerm ? '<span class="j-pill j-pill-violet" data-hint="last">Looks like last term</span>' : ''}`
  return `<li class="jm-bank-item" data-bank="${esc(x.id)}">
    <div class="top"><span class="when">${esc(x.early ? whenYear(x.date) : when(x.date))}</span><b class="amt">${esc(money(x.cents))}</b><span class="j-pill ${pill}">${label}</span>${hints}</div>
    <p class="payer">${esc(x.payer)}${x.description && x.description !== x.payer ? ` <small class="muted">${esc(x.description)}</small>` : ''}</p>
    ${c ? `<p class="cand"><b>${esc(c.player)}</b>${c.parent ? ` <small>(${esc(c.parent)})</small>` : ''} · owing ${esc(money(c.owingCents))}<br><small class="muted">${esc(c.reason)}</small>${x.candidates.length > 1 ? `<br><small class="muted">Also: ${x.candidates.slice(1).map((o) => esc(o.player)).join(', ')}</small>` : ''}</p>` : '<p class="cand muted small">No player with that name.</p>'}
    ${pv ? `<p class="cand prev small">Last term: <b>${esc(pv.player)}</b>${pv.parent ? ` (${esc(pv.parent)})` : ''} · ${pv.owingCents ? `owing ${esc(money(pv.owingCents))}` : esc(pv.status || 'paid')}<br><small class="muted">${esc(pv.reason)}</small></p>` : ''}
    <div class="btns">${c ? `<button type="button" class="j-btn j-btn-dark j-btn-sm" data-bank-rec="${esc(c.rowId)}">Record for ${esc(first(c.player))}</button>` : ''}<button type="button" class="j-btn j-btn-line j-btn-sm" data-bank-other>Other player…</button><button type="button" class="j-btn j-btn-line j-btn-sm" data-bank-holiday>Holiday revenue</button><button type="button" class="j-btn j-btn-line j-btn-sm" data-bank-pro>Pro session</button><button type="button" class="j-btn j-btn-line j-btn-sm" data-bank-prev>Previous term</button><button type="button" class="j-btn j-btn-ghost j-btn-sm" data-bank-ignore>Not JFP / ignore</button></div>
  </li>`
}

const findItem = (id) => [...(B.data?.items || []), ...(B.data?.before || [])].find((x) => x.id === id)

// ui: { post, toast, confirm(html, opts), record(item, rowId), other(item), redraw(),
//       modal(html, opts), closeModal(), after(kind) }
export function bindBank(el, ui) {
  const box = el.querySelector('#m-bank-box')
  if (!box) return
  box.addEventListener('toggle', (e) => { if (e.target !== box) return; B.open = box.open; if (box.open) loadBank(ui, ui.redraw) })
  const hid = el.querySelector('#m-bank-hidden')
  hid?.addEventListener('toggle', () => { B.hiddenOpen = hid.open })
  const bef = el.querySelector('#m-bank-before')
  bef?.addEventListener('toggle', () => { B.beforeOpen = bef.open })
  el.querySelector('#m-bank-file')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const p = parseBankCsv(await file.text())
    if (p.error) return ui.toast(p.error)
    const r = await ui.post('bankUpload', { lines: p.lines })
    if (!r.ok) return ui.toast(r.data.error)
    const kept = r.data.kept ?? p.lines.length
    ui.toast(`Read ${p.lines.length} payment${p.lines.length === 1 ? '' : 's'} in. ${kept} could be JFP, ${r.data.added} new.${p.cut ? ` The oldest ${p.cut} were left out.` : ''}`, 6000)
    B.open = true
    loadBank(ui, ui.redraw, { force: true })
  })
  box.addEventListener('click', async (e) => {
    const ch = e.target.closest('[data-bank-chip]')
    if (ch) { B.chip = ch.dataset.bankChip; return ui.redraw() }
    const un = e.target.closest('[data-bank-undo]')
    if (un) {
      un.disabled = true
      const kind = B.undo?.kind === 'pro' ? 'pro' : 'holiday'
      const r = await ui.post(kind === 'pro' ? 'bankProUndo' : 'bankHolidayUndo', { id: un.dataset.bankUndo })
      if (!r.ok) { un.disabled = false; return ui.toast(r.data.error) }
      B.undo = null
      ui.toast('Put back on the list')
      ui.after?.(kind)
      return loadBank(ui, ui.redraw, { force: true })
    }
    const show = e.target.closest('[data-bank-show]')
    if (show) {
      const id = show.closest('[data-bank-hid]').dataset.bankHid
      show.disabled = true
      const r = await ui.post('bankUnignore', { id })
      if (!r.ok) { show.disabled = false; return ui.toast(r.data.error) }
      ui.toast('Back on the list')
      return loadBank(ui, ui.redraw, { force: true })
    }
    const li = e.target.closest('[data-bank]')
    if (!li) return
    const item = findItem(li.dataset.bank)
    if (!item) return
    const rec = e.target.closest('[data-bank-rec]')
    if (rec) return ui.record(item, rec.dataset.bankRec)
    if (e.target.closest('[data-bank-other]')) return ui.other(item)
    if (e.target.closest('[data-bank-holiday]')) return holidayModal(item, ui)
    if (e.target.closest('[data-bank-pro]')) return proModal(item, ui)
    if (e.target.closest('[data-bank-prev]')) return previousModal(item, ui)
    const ig = e.target.closest('[data-bank-ignore]')
    if (!ig) return
    // Easy to hit by mistake on a phone, so ask first. It can be shown again under Hidden.
    if (!(await ui.confirm(`Hide <b>${esc(money(item.cents))}</b> from ${esc(item.payer)}? It goes under Hidden at the bottom of this list, where you can show it again.`, { ok: 'Hide it' }))) return
    ig.disabled = true
    const r = await ui.post('bankIgnore', { id: item.id })
    if (!r.ok) { ig.disabled = false; return ui.toast(r.data.error) }
    B.data.items = B.data.items.filter((x) => x.id !== item.id)
    B.data.before = (B.data.before || []).filter((x) => x.id !== item.id)
    B.data.hidden = [{ id: item.id, date: item.date, cents: item.cents, payer: item.payer, source: item.source }, ...(B.data.hidden || []).filter((x) => x.id !== item.id)]
    ui.toast(`Hidden: ${money(item.cents)} from ${item.payer}. Show it again under Hidden.`, 6000)
    ui.redraw()
  })
}

// After a payment is recorded from the panel: it drops off at once, and the
// next look asks the server again.
export function bankDone(id) {
  if (B.data?.items) B.data.items = B.data.items.filter((x) => x.id !== id)
  if (B.data?.before) B.data.before = B.data.before.filter((x) => x.id !== id)
  B.at = 0
}
// A holiday line put back from the Holiday training view: ask the bank again next time.
export function bankStale() { B.at = 0 }

const bankBox = (item) => `<div class="j-box j-box-blue small" style="margin:8px 0 12px">Bank, ${esc(new Date(`${item.date}T00:00:00`).toLocaleDateString('en-AU'))}: <b>${esc(money(item.cents))}</b> · ${esc(item.payer)}</div>`
// A save that might be the other copy of a recorded transfer asks first.
async function saveWithTwin(ui, action, body) {
  let r = await ui.post(action, body)
  if (r.status === 409 && r.data.code === 'twin') {
    if (!(await ui.confirm(esc(r.data.error), { ok: "It's a different payment" }))) return null
    r = await ui.post(action, { ...body, confirmTwin: true })
  }
  return r
}

// ---------- Holiday revenue ----------

const HOW = { inside: 'The bank date is in', before: 'The bank date is just before', after: 'The bank date is just after' }
export function holidayModal(item, ui) {
  const h = B.data?.holiday || { periods: [], coaches: [], locations: ['Belrose HQ'], defaultLocation: 'Belrose HQ' }
  const sug = item.holidayPeriod || { id: 'other', how: 'none' }
  const pick = h.periods.some((p) => p.id === sug.id) ? sug.id : 'other'
  const sugLabel = h.periods.find((p) => p.id === pick)?.label || ''
  const box = ui.modal(`<h2 style="margin-bottom:4px">Holiday training</h2>${bankBox(item)}
    <label class="j-field"><span>School holiday</span><select class="j-select" id="hb-period">${h.periods.map((p) => `<option value="${esc(p.id)}"${p.id === pick ? ' selected' : ''}>${esc(p.label)}${p.range ? ` (${esc(p.range)})` : ''}</option>`).join('')}</select></label>
    ${HOW[sug.how] && pick !== 'other' ? `<p class="muted small" id="hb-why" style="margin:-6px 0 12px">${esc(HOW[sug.how])} the ${esc(sugLabel)}.</p>` : ''}
    <div class="j-two"><label class="j-field"><span>Session date <span class="muted">(optional)</span></span><input class="j-input" type="date" id="hb-date"></label>
    <label class="j-field"><span>Coach <span class="muted">(optional)</span></span><select class="j-select" id="hb-coach"><option value="">Not sure</option>${h.coaches.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select></label></div>
    <div class="j-two"><label class="j-field"><span>Location</span><select class="j-select" id="hb-loc">${h.locations.map((l) => `<option${l === h.defaultLocation ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
    <label class="j-field"><span>Note <span class="muted">(optional)</span></span><input class="j-input" id="hb-note" maxlength="200" placeholder="For example, two kids, two sessions"></label></div>
    <p class="muted small">It counts in Money &gt; Holiday training as a bank transfer, and leaves this list. It can't be recorded for a player as well. You can put it back.</p>
    <p class="j-err" id="hb-err" hidden></p>
    <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:10px"><button type="button" class="j-btn j-btn-line" data-close>Cancel</button><button type="button" class="j-btn j-btn-dark" id="hb-go">Save as holiday training</button></div>`)
  box.querySelector('#hb-go').addEventListener('click', async (e) => {
    const v = (id) => box.querySelector(id).value.trim()
    const btn = e.currentTarget
    btn.disabled = true
    const body = { id: item.id, period: v('#hb-period'), sessionDate: v('#hb-date'), coach: v('#hb-coach'), location: v('#hb-loc'), note: v('#hb-note') }
    const r = await saveWithTwin(ui, 'bankHoliday', body)
    btn.disabled = false
    if (!r) return
    if (!r.ok) { const er = box.querySelector('#hb-err'); if (er) { er.textContent = r.data.error; er.hidden = false } return ui.toast(r.data.error) }
    bankDone(item.id)
    B.undo = { id: item.id, text: `Saved ${money(item.cents)} from ${item.payer} as holiday training (${r.data.periodLabel}).` }
    ui.closeModal()
    ui.toast(`Saved as holiday training: ${r.data.periodLabel}`)
    ui.after?.('holiday')
    ui.redraw()
  })
}

// ---------- Pro session (13 Oct 2026) ----------

export function proModal(item, ui) {
  const players = B.data?.pro?.players || []
  const box = ui.modal(`<h2 style="margin-bottom:4px">Pro session</h2>${bankBox(item)}
    <div class="j-two"><label class="j-field"><span>Pro player <span class="muted">(optional)</span></span><select class="j-select" id="pb-row"><option value="">Not sure</option>${players.map((p) => `<option value="${esc(p.rowId)}">${esc(p.player)}</option>`).join('')}</select></label>
    <label class="j-field"><span>Session date <span class="muted">(optional)</span></span><input class="j-input" type="date" id="pb-date"></label></div>
    <label class="j-field"><span>Note <span class="muted">(optional)</span></span><input class="j-input" id="pb-note" maxlength="200" placeholder="For example, two Pro sessions"></label>
    <p class="muted small">It counts in Money &gt; Pro sessions as a bank transfer, and leaves this list. It is not JFP term income and can't be recorded for a player as well. You can put it back.</p>
    <p class="j-err" id="pb-err" hidden></p>
    <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:10px"><button type="button" class="j-btn j-btn-line" data-close>Cancel</button><button type="button" class="j-btn j-btn-dark" id="pb-go">Save as Pro session</button></div>`)
  box.querySelector('#pb-go').addEventListener('click', async (e) => {
    const v = (id) => box.querySelector(id).value.trim()
    const btn = e.currentTarget
    btn.disabled = true
    const r = await saveWithTwin(ui, 'bankPro', { id: item.id, rowId: v('#pb-row'), sessionDate: v('#pb-date'), note: v('#pb-note') })
    btn.disabled = false
    if (!r) return
    if (!r.ok) { const er = box.querySelector('#pb-err'); if (er) { er.textContent = r.data.error; er.hidden = false } return ui.toast(r.data.error) }
    bankDone(item.id)
    B.undo = { id: item.id, kind: 'pro', text: `Saved ${money(item.cents)} from ${item.payer} as Pro sessions${r.data.line?.player ? ` (${r.data.line.player})` : ''}.` }
    ui.closeModal()
    ui.toast('Saved as Pro sessions')
    ui.after?.('pro')
    ui.redraw()
  })
}

// ---------- Previous term ----------

async function previousPlayers(ui) {
  if (B.prev && Date.now() - B.prev.at < 5 * 60000) return B.prev
  const r = await ui.post('previousTermPlayers')
  if (!r.ok) throw new Error(r.data?.error || 'Could not read last term\'s players.')
  B.prev = { term: r.data.term, players: r.data.players || [], at: Date.now() }
  return B.prev
}
const prevRow = (p, sel) => `<label class="jm-bank-row"><input type="radio" name="pt-row" value="${esc(p.rowId)}"${p.rowId === sel ? ' checked' : ''}><span><b>${esc(p.player)}</b><small>${esc([p.parent, p.location].filter(Boolean).join(' · '))}</small><small>Fee ${p.feeCents == null ? 'not set' : esc(money(p.feeCents))} · paid ${esc(money(p.paidCents || 0))} · ${p.owingCents ? `<b>owing ${esc(money(p.owingCents))}</b>` : esc(p.status === 'Paid' ? 'marked paid' : p.status || 'nothing owing')}</small></span></label>`

export async function previousModal(item, ui) {
  let prev
  try { prev = await previousPlayers(ui) } catch (e) { return ui.toast(e.message) }
  let sel = item.previous?.rowId || ''
  const box = ui.modal(`<h2 style="margin-bottom:4px">Last term: ${esc(prev.term)}</h2>${bankBox(item)}
    <label class="j-field"><span>Player or parent</span><input class="j-input" id="pt-q" placeholder="Type a name" autocomplete="off" value="${esc(item.previous?.player || '')}"></label>
    <div class="jm-bank-rows" id="pt-res"></div>
    <div class="j-two"><label class="j-field"><span>Amount (A$)</span><input class="j-input" id="pt-amt" inputmode="decimal" value="${esc((item.cents / 100).toFixed(2).replace(/\.00$/, ''))}"></label>
    <label class="j-field"><span>Date</span><input class="j-input" type="date" id="pt-date" value="${esc(item.date)}" disabled></label></div>
    <label class="j-field"><span>Note <span class="muted">(optional)</span></span><input class="j-input" id="pt-note" maxlength="200"></label>
    <p class="muted small">Adds one row to the payment ledger under ${esc(prev.term)}, as a bank transfer on the bank's date. If they still owe, it goes on their ${esc(prev.term)} row too.</p>
    <p class="j-err" id="pt-err" hidden></p>
    <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:10px"><button type="button" class="j-btn j-btn-line" data-close>Cancel</button><button type="button" class="j-btn j-btn-dark" id="pt-go">Save for ${esc(prev.term)}</button></div>`, { wide: true })
  const res = box.querySelector('#pt-res')
  const draw = () => {
    const q = box.querySelector('#pt-q').value.trim().toLowerCase()
    const hits = q.length < 2 ? prev.players.filter((p) => p.rowId === sel) : prev.players.filter((p) => p.rowId === sel || `${p.player} ${p.parent}`.toLowerCase().includes(q)).slice(0, 8)
    res.innerHTML = hits.map((p) => prevRow(p, sel)).join('') || (q.length < 2 ? '<p class="muted small">Type at least 2 letters of the player or parent.</p>' : `<p class="muted small">Nobody on ${esc(prev.term)}'s list matches.</p>`)
  }
  draw()
  box.querySelector('#pt-q').addEventListener('input', draw)
  res.addEventListener('change', (e) => { if (e.target.name === 'pt-row') sel = e.target.value })
  box.querySelector('#pt-go').addEventListener('click', async (e) => {
    const err = (m) => { const er = box.querySelector('#pt-err'); er.textContent = m; er.hidden = false }
    if (!sel) return err('Pick who it was for.')
    const amountCents = Math.round(Number(box.querySelector('#pt-amt').value) * 100)
    if (!(amountCents > 0)) return err('Enter the amount.')
    if (amountCents > item.cents) return err(`That is more than the ${money(item.cents)} that came in.`)
    const btn = e.currentTarget
    btn.disabled = true
    const r = await saveWithTwin(ui, 'bankPreviousTerm', { id: item.id, rowId: sel, amountCents, note: box.querySelector('#pt-note').value.trim() })
    btn.disabled = false
    if (!r) return
    if (!r.ok) return err(r.data.error)
    const who = prev.players.find((p) => p.rowId === sel)
    bankDone(item.id)
    B.prev = null
    ui.closeModal()
    ui.toast(r.data.warning || `Saved for ${who?.player || 'them'} in ${r.data.term}: in the ledger${r.data.addedCents ? ` and ${money(r.data.addedCents)} on their row` : ''}.`, r.data.warning ? 9000 : 4000)
    ui.after?.('previous', r.data.term)
    ui.redraw()
  })
}
