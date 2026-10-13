// Money > Prices and quick payment links (Lee, 13 Oct 2026): "we want to be
// able to create custom prices here, add as many as we want, and be able to
// create payment links straight away".
//
// ui: { view, post, need, toast, modal, closeModal, confirm, copy, board(), payPill, pricing(), resetPricing() }
import { esc, money } from './jfp-common.js'

export const PROG_PILL = { jfp: 'blue', juniors: 'violet', holiday: 'amber', other: 'grey' }
export const progPill = (id, label) => `<span class="j-pill j-pill-${PROG_PILL[id] || 'grey'}">${esc(label)}</span>`
const cents = (v) => Math.round(Number(String(v ?? '').replace(/[^0-9.]/g, '')) * 100)
const dollars = (c) => (c / 100).toFixed(2).replace(/\.00$/, '')
// Where a paid link with no player waits to be matched.
export const WHERE = { jfp: 'Money > JFP, Stripe payments not matched to a player', juniors: 'Money > Joners Juniors, payments not matched to a child', holiday: 'Money > Holiday training, Quick links to check', other: 'Payment links, Other payments to check' }

// ---------- Prices ----------

function priceRow(p) {
  return `<li class="jq-price${p.archived ? ' jq-archived' : ''}" data-price-id="${esc(p.id)}">
    <span class="jq-main"><b>${esc(p.name)}</b><small>${progPill(p.programme, p.programmeLabel)} <b class="jq-amt">${esc(p.amountLabel)}</b>${p.perSession ? ' a session' : ''}${p.description ? ` · ${esc(p.description)}` : ''}</small></span>
    <span class="jq-acts">${p.archived
      ? '<button type="button" class="j-btn j-btn-line j-btn-sm" data-restore-price>Restore</button>'
      : `<button type="button" class="j-btn j-btn-dark j-btn-sm" data-quick-price="${esc(p.id)}">Create link</button><button type="button" class="j-btn j-btn-line j-btn-sm" data-edit-price>Edit</button><button type="button" class="j-btn j-btn-ghost j-btn-sm" data-archive-price>Archive</button>`}</span></li>`
}

export async function renderPricesPage(ui) {
  const pr = await ui.pricing(true)
  const own = pr.priceList.filter((p) => !p.builtin && !p.archived)
  const archived = pr.priceList.filter((p) => !p.builtin && p.archived)
  ui.view().innerHTML = `<div id="pr-page"><div class="jp-head"><div><h1>Prices</h1><p class="muted small">Private: only you and Ligia see this tab. Add as many prices as you like and make a payment link from any of them. Parents only see what they pay.</p></div>
      <button type="button" class="j-btn j-btn-dark" id="pr-add">+ Add a price</button></div>
    <section class="j-card jq-card" id="pr-own">
      <h2>Your prices</h2><p class="muted small">For JFP, Joners Juniors, holiday training or anything else.</p>
      ${own.length ? `<ul class="jq-list" id="pr-own-list">${own.map(priceRow).join('')}</ul>` : '<p class="muted small" id="pr-none">No prices of your own yet. Add one, like a holiday camp day or a kit fee.</p>'}
      ${archived.length ? `<details class="jq-fold" id="pr-archived"><summary>Archived (${archived.length})</summary><ul class="jq-list">${archived.map(priceRow).join('')}</ul></details>` : ''}
    </section>
    <section class="j-card jq-card jp-prices" id="pr-jfp">
      <h2>JFP price list</h2><p class="muted small">The term prices every JFP link uses. Change an amount, then Save prices.</p>
      <ul class="jq-list">${pr.products.map((x) => `<li class="jq-price" data-price-id="jfp:${esc(x.key)}"><span class="jq-main"><b>${esc(x.label)}</b><small>${progPill('jfp', 'JFP')} Airtable type: ${esc(x.type)}${x.perPlaces > 1 ? ' · covers two places' : ''} · pro rata: ${x.proRata ? 'yes, sessions left' : 'no'}</small></span>
        <span class="jq-acts"><label class="jq-amt-in"><span class="muted small">A$</span><input class="j-input" data-price="${esc(x.key)}" inputmode="decimal" aria-label="${esc(x.label)} price, A$" value="${x.cents / 100}"></label><button type="button" class="j-btn j-btn-dark j-btn-sm" data-quick-price="jfp:${esc(x.key)}">Create link</button></span></li>`).join('')}</ul>
      <p class="muted small" style="margin-top:12px">Joining in week 4 of ${pr.weeks} pays for ${pr.weeks - 3} sessions: A$850 x ${pr.weeks - 3}/${pr.weeks} = A$${(850 * (pr.weeks - 3)) / pr.weeks}. Two siblings in one booking pay the two place rate each. After a trial, the trial price is taken off the term. Afterpay is on for every link unless you untick it.</p>
      <p class="j-err" id="pr-err" hidden></p>
      <button type="button" class="j-btn j-btn-dark" id="pr-save" style="margin-top:10px">Save prices</button>
    </section></div>`
  const $ = (id) => ui.view().querySelector(`#${id}`)
  $('pr-save').addEventListener('click', async () => {
    const prices = {}
    ui.view().querySelectorAll('[data-price]').forEach((i) => { prices[i.dataset.price] = Math.round(Number(i.value) * 100) })
    if (Object.values(prices).some((v) => !(v > 0))) { $('pr-err').textContent = 'Every price needs an amount.'; $('pr-err').hidden = false; return }
    const r = await ui.post('saveSettings', { config: { prices } })
    if (!r.ok) { $('pr-err').textContent = r.data.error; $('pr-err').hidden = false; return }
    ui.resetPricing()
    ui.toast('Prices saved')
    renderPricesPage(ui)
  })
  $('pr-add').addEventListener('click', () => priceModal(ui, null))
  // On this page's own element: the view outlives every tab.
  $('pr-page').addEventListener('click', async (e) => {
    const row = e.target.closest('[data-price-id]')
    if (!row) return
    const p = pr.priceList.find((x) => x.id === row.dataset.priceId)
    if (e.target.closest('[data-quick-price]')) return quickModal(ui, { priceId: p.id })
    if (e.target.closest('[data-edit-price]')) return priceModal(ui, p)
    const arch = e.target.closest('[data-archive-price]'), back = e.target.closest('[data-restore-price]')
    if (!arch && !back) return
    if (arch && !(await ui.confirm(`Archive <b>${esc(p.name)}</b>? It leaves the list and the link form. Links already made keep working.`, { ok: 'Archive' }))) return
    const r = await ui.post('archivePrice', { id: p.id, undo: Boolean(back) })
    if (!r.ok) return ui.toast(r.data.error)
    ui.resetPricing()
    ui.toast(arch ? 'Archived' : 'Restored')
    renderPricesPage(ui)
  })
}

function programmeOptions(list, selected) { return list.map((p) => `<option value="${esc(p.id)}"${p.id === selected ? ' selected' : ''}>${esc(p.label)}</option>`).join('') }

export async function priceModal(ui, p) {
  const pr = await ui.pricing()
  const box = ui.modal(`<h2 style="margin-bottom:10px">${p ? 'Edit price' : 'Add a price'}</h2>
    <label class="j-field"><span>Name</span><input class="j-input" id="pm-name" maxlength="80" value="${esc(p?.name || '')}" placeholder="e.g. Holiday camp day"></label>
    <div class="j-two"><label class="j-field"><span>Amount (A$)</span><input class="j-input" id="pm-amt" inputmode="decimal" value="${p ? dollars(p.cents) : ''}"></label>
    <label class="j-field"><span>Programme</span><select class="j-select" id="pm-prog">${programmeOptions(pr.programmes, p?.programme || 'jfp')}</select></label></div>
    <label class="j-field"><span>Description (optional)</span><input class="j-input" id="pm-desc" maxlength="300" value="${esc(p?.description || '')}" placeholder="Only you see this"></label>
    <label class="j-check"><input type="checkbox" id="pm-session"${p?.perSession ? ' checked' : ''}> <span>Per session (a link can be for several sessions)</span></label>
    <p class="j-err" id="pm-err" hidden></p>
    <div class="jq-foot"><button type="button" class="j-btn j-btn-line" data-close>Cancel</button><button type="button" class="j-btn j-btn-dark" id="pm-go">Save price</button></div>`)
  box.querySelector('#pm-go').addEventListener('click', async () => {
    const err = box.querySelector('#pm-err')
    const price = { id: p?.id || '', name: box.querySelector('#pm-name').value.trim(), amountCents: cents(box.querySelector('#pm-amt').value), programme: box.querySelector('#pm-prog').value, description: box.querySelector('#pm-desc').value.trim(), perSession: box.querySelector('#pm-session').checked }
    if (!price.name) { err.textContent = 'Give the price a name.'; err.hidden = false; return }
    if (!(price.amountCents > 0)) { err.textContent = 'Enter the amount.'; err.hidden = false; return }
    box.querySelector('#pm-go').disabled = true
    const r = await ui.post('savePrice', { price })
    box.querySelector('#pm-go').disabled = false
    if (!r.ok) { err.textContent = r.data.error; err.hidden = false; return }
    ui.closeModal()
    ui.resetPricing()
    ui.toast(p ? 'Price saved' : 'Price added')
    if (ui.onPrices) ui.onPrices()
  })
}

// ---------- Quick payment link ----------

export async function quickModal(ui, { priceId = '' } = {}) {
  const pr = await ui.pricing()
  const prices = pr.priceList.filter((p) => !p.archived)
  const groups = pr.programmes.map((g) => ({ ...g, list: prices.filter((p) => p.programme === g.id) })).filter((g) => g.list.length)
  const box = ui.modal(`<h2 style="margin-bottom:4px">Quick payment link</h2><p class="muted small" style="margin-bottom:12px">Choose a price or type an amount. Nothing is sent until you tap Email it.</p>
    <label class="j-field"><span>Price</span><select class="j-select" id="ql-price"><option value="">Type an amount</option>${groups.map((g) => `<optgroup label="${esc(g.label)}">${g.list.map((p) => `<option value="${esc(p.id)}"${p.id === priceId ? ' selected' : ''}>${esc(p.name)} · ${esc(p.amountLabel)}${p.perSession ? ' a session' : ''}</option>`).join('')}</optgroup>`).join('')}</select></label>
    <div class="j-two"><label class="j-field"><span>Amount (A$)</span><input class="j-input" id="ql-amt" inputmode="decimal"></label>
    <label class="j-field" id="ql-sess-wrap" hidden><span>Sessions</span><input class="j-input" id="ql-sess" type="number" min="1" max="40" value="1" inputmode="numeric"></label></div>
    <label class="j-field"><span>What it is for</span><input class="j-input" id="ql-for" maxlength="120" placeholder="e.g. Holiday camp, 6 January"></label>
    <div class="j-two"><label class="j-field"><span>Programme</span><select class="j-select" id="ql-prog">${programmeOptions(pr.programmes, 'jfp')}</select></label>
    <label class="j-field" id="ql-hol-wrap" hidden><span>Which holidays</span><select class="j-select" id="ql-hol">${pr.holidayPeriods.map((h) => `<option value="${esc(h.id)}">${esc(h.label)}</option>`).join('')}</select></label></div>
    <div class="j-field"><span>Player (optional)</span><div id="ql-chosen"></div><input class="j-input" id="ql-q" placeholder="Search a player" autocomplete="off"><div id="ql-res"></div></div>
    <label class="j-field"><span>Parent email (optional)</span><input class="j-input" id="ql-email" type="email" inputmode="email" autocomplete="off"></label>
    <label class="j-check"><input type="checkbox" id="ql-afterpay" checked> <span>Afterpay allowed</span></label>
    <p class="muted small" id="ql-note"></p>
    <p class="j-err" id="ql-err" hidden></p>
    <div class="jq-foot"><button type="button" class="j-btn j-btn-line" data-close>Cancel</button><button type="button" class="j-btn j-btn-dark" id="ql-go">Create link</button></div>`, { wide: true })
  const $ = (id) => box.querySelector(`#${id}`)
  let chosen = null
  let autoFor = ''
  const price = () => prices.find((p) => p.id === $('ql-price').value) || null
  const note = () => {
    const prog = $('ql-prog').value
    $('ql-hol-wrap').hidden = prog !== 'holiday'
    $('ql-note').textContent = chosen
      ? (prog === 'jfp' ? `When it is paid, it is recorded on ${chosen.p.name}'s Term 4 row, like any JFP link.` : `${chosen.p.name}'s name goes on the link. Nothing is written to their JFP row.`)
      : `No player: when it is paid it waits on ${WHERE[prog]} for you to match.`
  }
  const fromPrice = () => {
    const p = price()
    $('ql-sess-wrap').hidden = !p?.perSession
    if (!p) return note()
    const n = p.perSession ? Math.max(1, Number($('ql-sess').value) || 1) : 1
    $('ql-amt').value = dollars(p.cents * n)
    const text = `${p.name}${n > 1 ? `, ${n} sessions` : ''}`
    if (!$('ql-for').value.trim() || $('ql-for').value === autoFor) $('ql-for').value = text
    autoFor = text
    $('ql-prog').value = p.programme
    note()
  }
  $('ql-price').addEventListener('change', fromPrice)
  $('ql-sess').addEventListener('input', fromPrice)
  $('ql-prog').addEventListener('change', note)
  const showChosen = () => {
    $('ql-chosen').innerHTML = chosen ? `<div class="jq-chosen"><span><b>${esc(chosen.p.name)}</b><small>${chosen.g ? `${esc(chosen.g.day)} ${esc(chosen.g.time)}` : 'Not in a group'}</small></span><button type="button" class="j-btn j-btn-line j-btn-sm" id="ql-unpick">Remove</button></div>` : ''
    $('ql-q').hidden = Boolean(chosen)
    if (chosen) $('ql-unpick').addEventListener('click', () => { chosen = null; showChosen(); note() })
  }
  $('ql-q').addEventListener('input', async (e) => {
    const q = e.target.value.trim().toLowerCase()
    const b = q.length < 2 ? null : await ui.board()
    const all = b ? b.groups.flatMap((g) => g.players.filter((p) => !p.juniors).map((p) => ({ p, g }))).concat(b.unassigned.map((p) => ({ p, g: null }))) : []
    const hits = all.filter(({ p }) => p.name.toLowerCase().includes(q)).slice(0, 8)
    $('ql-res').innerHTML = hits.map(({ p, g }, i) => `<button type="button" class="j-player" data-i="${i}"><span><b>${esc(p.name)}</b><br><span class="muted small">${g ? `${esc(g.day)} ${esc(g.time)}` : 'Not in a group'}${p.parent ? ` · ${esc(p.parent)}` : ''}</span></span>${ui.payPill(p)}</button>`).join('')
    $('ql-res').querySelectorAll('[data-i]').forEach((x) => x.addEventListener('click', () => {
      chosen = hits[Number(x.dataset.i)]
      if (!$('ql-email').value.trim() && chosen.p.email) $('ql-email').value = chosen.p.email
      $('ql-res').innerHTML = ''; $('ql-q').value = ''
      showChosen(); note()
    }))
  })
  fromPrice()
  const go = async (replace = false) => {
    const err = $('ql-err')
    err.hidden = true
    const p = price()
    const body = {
      priceId: p?.id || '', amountCents: cents($('ql-amt').value), sessions: p?.perSession ? Math.max(1, Number($('ql-sess').value) || 1) : undefined,
      forText: $('ql-for').value.trim(), programme: $('ql-prog').value, holidayPeriod: $('ql-prog').value === 'holiday' ? $('ql-hol').value : '',
      rowId: chosen?.p.rowId || '', email: $('ql-email').value.trim(), afterpay: $('ql-afterpay').checked, replace,
    }
    if (!(body.amountCents > 0)) { err.textContent = 'Choose a price or type an amount.'; err.hidden = false; return }
    if (!body.forText) { err.textContent = 'Say what it is for.'; err.hidden = false; return }
    $('ql-go').disabled = true
    const r = await ui.post('quickLink', body)
    $('ql-go').disabled = false
    if (r.data.code === 'link_open') {
      if (await ui.confirm(`${esc(r.data.error)}<br><br>The old link stops working and the family uses the new one.`, { ok: 'Replace it' })) return quickModal2(ui, body)
      return
    }
    if (!r.ok) { err.textContent = r.data.error; err.hidden = false; return }
    quickResult(ui, r.data.link)
  }
  $('ql-go').addEventListener('click', () => go(false))
}
// After "Replace it" the first modal has closed: send again with replace.
async function quickModal2(ui, body) {
  const r = await ui.post('quickLink', { ...body, replace: true })
  if (!r.ok) return ui.toast(r.data.error)
  quickResult(ui, r.data.link)
}

// The link, ready: Copy, Open, and Email it when there is an email.
export function quickResult(ui, link) {
  const box = ui.modal(`<h2 style="margin-bottom:4px">Link ready</h2>
    <p class="muted small" id="qr-what">${esc(link.forText)} · ${esc(link.amountLabel)} · ${esc(link.programmeLabel)}${link.players?.length ? ` · ${esc(link.players.join(', '))}` : ''}</p>
    <label class="j-field" style="margin-top:10px"><span>Payment link</span><input class="j-input" id="qr-url" readonly value="${esc(link.url)}"></label>
    <div class="jq-acts jq-acts-wide"><button type="button" class="j-btn j-btn-dark" id="qr-copy">Copy</button><a class="j-btn j-btn-line" id="qr-open" href="${esc(link.url)}" target="_blank" rel="noopener noreferrer">Open</a>${link.email ? '<button type="button" class="j-btn j-btn-line" id="qr-email">Email it</button>' : ''}<button type="button" class="j-btn j-btn-ghost" data-close>Done</button></div>
    <p class="muted small" id="qr-note" style="margin-top:10px">${link.email ? `Email it sends the link to ${esc(link.email)}. Nothing has been sent yet.` : 'Nothing has been sent. Copy it into a text or an email.'} The link works for 30 days.</p>`)
  box.querySelector('#qr-copy').addEventListener('click', () => ui.copy(link.url))
  box.querySelector('#qr-email')?.addEventListener('click', async (e) => {
    const b = e.currentTarget
    b.disabled = true
    const r = await ui.post('emailQuickLink', { id: link.id })
    if (!r.ok) { b.disabled = false; return ui.toast(r.data.error) }
    b.textContent = 'Emailed'
    box.querySelector('#qr-note').textContent = `Emailed to ${link.email}.`
    ui.toast('Emailed')
    ui.onLinks?.()
  })
  ui.onLinks?.()
}
