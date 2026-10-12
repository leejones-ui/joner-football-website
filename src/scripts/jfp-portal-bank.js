// Bank transfers to check, on Money (Lee, 12 Oct 2026): money in from the
// bank (Xero, or a bank statement CSV uploaded here) with the player it is
// probably for. Lee records each one with one tap, or hides it.
// Read with its own action when Money first opens, never by the two minute
// refresh, so Money stays quick.
import { esc, money } from './jfp-common.js'
import { parseBankCsv } from './jfp-bank-csv.js'

const B = { data: null, at: 0, loading: null, open: false, draw: () => {} }
const STALE = 5 * 60000

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
const first = (name) => String(name || '').split(/\s+/)[0] || 'this player'

// The items for the venue picked: the top candidate's venue. Lines with no
// candidate belong to no venue, so they show under All only.
export function bankItems(loc) {
  const items = B.data?.items || []
  return loc ? items.filter((x) => x.candidates[0]?.locationId === loc) : items
}

export function bankPanel(loc) {
  const d = B.data
  const items = bankItems(loc)
  const toCheck = items.filter((x) => x.grade !== 'none').length
  const src = d?.sources || {}
  const xero = src.xeroAt ? `From Xero, updated ${new Date(src.xeroAt).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}` : "Xero hasn't sent anything yet"
  const csv = src.csvAt ? ` · Bank CSV uploaded ${new Date(src.csvAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}` : ''
  const count = !d ? '<span class="n muted">checking</span>' : d.error ? '' : `<span class="n">${items.length}</span>`
  const list = !d ? '<p class="muted small">Checking the bank lines</p>'
    : d.error ? `<div class="j-box j-box-amber small">${esc(d.error)}</div>`
      : items.length ? `<ul class="jm-bank-list">${items.map(itemHtml).join('')}</ul>`
        : `<p class="muted small">Nothing to check${loc ? ' at this venue' : ''}. Every bank transfer we can see is recorded or hidden.</p>`
  return `<details class="jm-next jm-bank" id="m-bank-box" ${B.open ? 'open' : ''}><summary>Bank transfers to check ${count}${toCheck ? ` <small class="muted">${toCheck} with a match</small>` : ''}</summary>
    <div class="jm-bank-src">
      <p class="small" id="m-bank-xero">${esc(xero)}${esc(csv)}</p>
      <p class="small muted">Xero only shows transfers after they're coded in Xero. Uploading the bank CSV works straight away.</p>
      <div class="jm-bank-up"><label class="j-btn j-btn-line j-btn-sm" for="m-bank-file">Upload bank statement (CSV)</label><input type="file" id="m-bank-file" accept=".csv,text/csv,text/plain" class="jm-file"><span class="small muted">CommBank NetBank &gt; Accounts &gt; Export &gt; CSV</span></div>
    </div>
    ${list}</details>`
}

function itemHtml(x) {
  const c = x.candidates[0]
  const [label, pill] = GRADE[x.grade] || GRADE.none
  return `<li class="jm-bank-item" data-bank="${esc(x.id)}">
    <div class="top"><span class="when">${esc(when(x.date))}</span><b class="amt">${esc(money(x.cents))}</b><span class="j-pill ${pill}">${label}</span></div>
    <p class="payer">${esc(x.payer)}${x.description && x.description !== x.payer ? ` <small class="muted">${esc(x.description)}</small>` : ''}</p>
    ${c ? `<p class="cand"><b>${esc(c.player)}</b>${c.parent ? ` <small>(${esc(c.parent)})</small>` : ''} · owing ${esc(money(c.owingCents))}<br><small class="muted">${esc(c.reason)}</small>${x.candidates.length > 1 ? `<br><small class="muted">Also: ${x.candidates.slice(1).map((o) => esc(o.player)).join(', ')}</small>` : ''}</p>` : '<p class="cand muted small">No player with that name.</p>'}
    <div class="btns">${c ? `<button type="button" class="j-btn j-btn-dark j-btn-sm" data-bank-rec="${esc(c.rowId)}">Record for ${esc(first(c.player))}</button>` : ''}<button type="button" class="j-btn j-btn-line j-btn-sm" data-bank-other>Other player…</button><button type="button" class="j-btn j-btn-ghost j-btn-sm" data-bank-ignore>Not JFP / ignore</button></div>
  </li>`
}

// ui: { post, toast, record(item, rowId), other(item), redraw() }
export function bindBank(el, ui) {
  const box = el.querySelector('#m-bank-box')
  if (!box) return
  box.addEventListener('toggle', () => { B.open = box.open; if (box.open) loadBank(ui, ui.redraw) })
  el.querySelector('#m-bank-file')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const p = parseBankCsv(await file.text())
    if (p.error) return ui.toast(p.error)
    const r = await ui.post('bankUpload', { lines: p.lines })
    if (!r.ok) return ui.toast(r.data.error)
    ui.toast(`Read ${p.lines.length} payment${p.lines.length === 1 ? '' : 's'} in, ${r.data.added} new.${p.cut ? ` The oldest ${p.cut} were left out.` : ''}`)
    B.open = true
    loadBank(ui, ui.redraw, { force: true })
  })
  box.addEventListener('click', async (e) => {
    const li = e.target.closest('[data-bank]')
    if (!li) return
    const item = B.data.items.find((x) => x.id === li.dataset.bank)
    const rec = e.target.closest('[data-bank-rec]')
    if (rec) return ui.record(item, rec.dataset.bankRec)
    if (e.target.closest('[data-bank-other]')) return ui.other(item)
    const ig = e.target.closest('[data-bank-ignore]')
    if (!ig) return
    ig.disabled = true
    const r = await ui.post('bankIgnore', { id: item.id })
    if (!r.ok) { ig.disabled = false; return ui.toast(r.data.error) }
    B.data.items = B.data.items.filter((x) => x.id !== item.id)
    ui.toast(`Hidden: ${money(item.cents)} from ${item.payer}`)
    ui.redraw()
  })
}

// After a payment is recorded from the panel: it drops off at once, and the
// next look asks the server again.
export function bankDone(id) {
  if (B.data?.items) B.data.items = B.data.items.filter((x) => x.id !== id)
  B.at = 0
}
