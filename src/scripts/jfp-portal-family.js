// Money > By family (Lee, 12 Oct 2026): one invoice per family, while every
// place keeps its own price on its own row. Pick each place's price, see the
// family total, and send one link. When the family pays, the money goes onto
// each player's row by what that place owed, and the payment ledger gets one
// line per player.
import { esc, money } from './jfp-common.js'
import { textComposer, familyInvoiceText } from './jfp-portal-text.js'

// Price buttons. type is what the row's Payment Type becomes.
const PRESETS = [
  { key: 'group', label: 'Full term', type: 'JFP 10 weeks' },
  { key: 'familyPlace', label: 'Family rate', type: 'Sibling / 2 sessions per week', hint: 'every place once a family has two or more' },
  { key: 'sibling', label: 'Sibling', type: 'Sibling / 2 sessions per week' },
  { key: 'pathway', label: 'Pathway', type: 'JFP Pathway 10 weeks' },
  { key: 'pathwayOneToOne', label: 'Pathway 1 to 1', type: 'JFP pathway 1 on 1' },
  { key: 'oneToOneTerm', label: '1 to 1 term', type: 'JFP 1 on 1, 10 weeks' },
]
// Places the family rate applies to: ordinary group places, not pathway or 1 to 1.
const familyRateFits = (p) => !p.product || p.product === 'group'

export function familiesOf(players) {
  const by = new Map()
  for (const p of players) {
    const k = p.familyKey || p.email || `row:${p.rowId}`
    if (!by.has(k)) by.set(k, [])
    by.get(k).push(p)
  }
  return [...by.entries()].map(([key, places]) => ({
    key, places,
    parent: places.find((p) => p.parent)?.parent || '',
    email: places.find((p) => p.email)?.email || '',
    phone: places.find((p) => p.phone)?.phone || '',
    self: places.length === 1 && Boolean(places[0].ownContact),
    names: [...new Set(places.map((p) => p.player))],
    links: [...new Map(places.filter((p) => p.openLink).map((p) => [p.openLink.id, p.openLink])).values()],
  })).sort((a, b) => (b.places.length > 1) - (a.places.length > 1) || a.names[0].localeCompare(b.names[0]))
}

// The family list. ui: { m, f, post, toast, confirmBox, statusPill, done }
export function drawFamilies(box, ui) {
  const { m, f } = ui
  const q = f.q.trim().toLowerCase()
  // The Money toolbar's own match when given (every filter), else status, venue and search.
  const match = ui.match || ((p) => (!f.status || p.status === f.status) && (!q || `${p.player} ${p.parent} ${p.email}`.toLowerCase().includes(q)))
  const fams = familiesOf(m.players).filter((fam) => (!f.loc || fam.places.some((p) => p.locationId === f.loc)) && fam.places.some(match))
  const many = fams.filter((x) => x.places.length > 1).length
  box.innerHTML = `<p class="ps-sub-line">${fams.length} famil${fams.length === 1 ? 'y' : 'ies'}${many ? `, ${many} with more than one place` : ''}</p>`
    + (fams.map((fam) => card(fam, ui)).join('') || '<div class="j-empty">No families match.</div>')
  box.querySelectorAll('[data-fam]').forEach((el) => bindCard(el, fams.find((x) => x.key === el.dataset.fam), ui))
}

function card(fam, ui) {
  const { m } = ui
  const owing = fam.places.reduce((t, p) => t + p.owingCents, 0)
  return `<section class="jd-card jf-fam" data-fam="${esc(fam.key)}">
    <header><div><h3>${esc(fam.names.join(', '))}</h3><p class="muted small">${esc(fam.parent || 'No parent name')}${fam.email ? ` · ${esc(fam.email)}` : ' · <b>no email</b>'} · ${fam.places.length} place${fam.places.length === 1 ? '' : 's'}</p></div>
      <div class="jf-fam-now"><span class="muted small">Owing now</span><b>${esc(money(owing))}</b></div></header>
    ${fam.links.length ? `<p class="jf-fam-links">Open link${fam.links.length > 1 ? 's' : ''}: ${fam.links.map((l) => `${esc(l.players.join(' + '))} ${esc(money(l.amountCents))}${l.family ? ' (family invoice)' : ''}${l.note ? ` <span class="muted small">(${esc(l.note)})</span>` : ''}`).join(' · ')}</p>` : ''}
    <div class="jf-places">${fam.places.map((p) => `<div class="jf-place" data-place="${esc(p.rowId)}">
      <div class="jf-who"><b>${esc(p.player)}</b><span class="muted small">${esc(p.group)}</span><span class="small">${ui.statusPill(p.status)}${p.paidCents ? ` <span class="muted">· ${esc(money(p.paidCents))} paid</span>` : ''}</span><button type="button" class="j-btn j-btn-ghost j-btn-sm jf-remove" data-remove-place aria-label="Remove ${esc(p.player)}, ${esc(p.group)}">Remove</button></div>
      <div class="jf-price">
        <div class="jm-chips jf-presets">${PRESETS.map((x) => `<button type="button" data-preset="${x.key}" title="${esc(x.hint || x.type)}">${esc(x.label)} ${esc(money(m.prices[x.key]))}</button>`).join('')}</div>
        <div class="jf-custom"><label class="muted small" for="jf-fee-${esc(p.rowId)}">This place A$</label><input class="j-input" id="jf-fee-${esc(p.rowId)}" data-fee inputmode="decimal" value="${p.feeCents ? p.feeCents / 100 : ''}" placeholder="price"><span class="muted small" data-type>${esc(p.type || 'Payment type not set')}</span></div>
      </div></div>`).join('')}</div>
    <footer>
      ${fam.places.filter(familyRateFits).length > 1 ? `<button type="button" class="j-btn j-btn-line j-btn-sm" data-family-rate>Family rate: ${esc(money(m.prices.familyPlace))} a place</button>` : '<span></span>'}
      <div class="jf-total"><span class="muted small">Invoice</span><b data-total></b></div>
      <label class="j-check small"><input type="checkbox" data-email ${fam.email ? 'checked' : 'disabled'}> <span>Email it to the family</span></label>
      <label class="j-check small" ${fam.phone ? '' : 'title="No mobile on file: add one with Edit"'}><input type="checkbox" data-text ${fam.phone ? 'checked' : 'disabled'}> <span>Text it too${fam.phone ? '' : ' (no mobile)'}</span></label>
      <button type="button" class="j-btn j-btn-line j-btn-sm" data-text-now>Text the family</button>
      <button type="button" class="j-btn j-btn-ghost j-btn-sm" data-save>Save prices only</button>
      <button type="button" class="j-btn j-btn-dark j-btn-sm" data-send ${fam.email ? '' : 'disabled title="Add a parent email with Edit first"'}>Send family invoice</button>
    </footer>
    <p class="j-err" data-err hidden></p>
  </section>`
}

function bindCard(el, fam, ui) {
  const { m } = ui
  // What each place is set to now: its price and payment type.
  const state = new Map(fam.places.map((p) => [p.rowId, { feeCents: p.feeCents || null, type: p.type || '' }]))
  const placeEl = (id) => el.querySelector(`[data-place="${CSS.escape(id)}"]`)
  const total = () => fam.places.reduce((t, p) => { const s = state.get(p.rowId); return t + Math.max(0, (s.feeCents ?? 0) - p.paidCents) }, 0)
  const paint = () => {
    for (const p of fam.places) {
      const s = state.get(p.rowId), pe = placeEl(p.rowId)
      pe.querySelectorAll('[data-preset]').forEach((b) => b.setAttribute('aria-pressed', String(s.feeCents === m.prices[b.dataset.preset] && PRESETS.find((x) => x.key === b.dataset.preset).type === s.type)))
      pe.querySelector('[data-type]').textContent = s.type || 'Payment type not set'
      pe.classList.toggle('jf-changed', s.feeCents !== (p.feeCents || null) || s.type !== (p.type || ''))
    }
    el.querySelector('[data-total]').textContent = money(total())
  }
  const set = (id, feeCents, type) => { const s = state.get(id); s.feeCents = feeCents; if (type != null) s.type = type; placeEl(id).querySelector('[data-fee]').value = feeCents == null ? '' : feeCents / 100; paint() }
  el.addEventListener('click', async (e) => {
    const rm = e.target.closest('[data-remove-place]')
    if (rm) return ui.remove(fam.places.find((p) => p.rowId === rm.closest('[data-place]').dataset.place))
    const pr = e.target.closest('[data-preset]')
    if (pr) { const x = PRESETS.find((y) => y.key === pr.dataset.preset); return set(pr.closest('[data-place]').dataset.place, m.prices[x.key], x.type) }
    if (e.target.closest('[data-family-rate]')) { for (const p of fam.places.filter(familyRateFits)) set(p.rowId, m.prices.familyPlace, PRESETS[1].type); return }
    if (e.target.closest('[data-text-now]')) {
      // The open link if there is one, else the amount and where to pay.
      const link = fam.links[0]
      return textFamily(fam, ui, { amountCents: link ? link.amountCents : total(), url: link ? `${location.origin}/jfp-account/?pay=${encodeURIComponent(link.id)}` : '', emailed: Boolean(link) })
    }
    const send = e.target.closest('[data-send]'), save = e.target.closest('[data-save]')
    if (!send && !save) return
    const places = fam.places.map((p) => ({ rowId: p.rowId, ...state.get(p.rowId) }))
    const err = el.querySelector('[data-err]')
    const missing = places.filter((x) => x.feeCents == null)
    if (missing.length) { err.textContent = `Set a price for ${missing.map((x) => fam.places.find((p) => p.rowId === x.rowId).player).join(' and ')}.`; err.hidden = false; return }
    err.hidden = true
    if (save) return saveOnly(el, fam, places, ui)
    const email = el.querySelector('[data-email]').checked
    const lines = fam.places.map((p) => `${esc(p.player)}, ${esc(p.group)}: ${esc(money(state.get(p.rowId).feeCents))}${p.paidCents ? ` (${esc(money(p.paidCents))} paid)` : ''}`).join('<br>')
    if (!(await ui.confirmBox(`<b>One invoice for ${esc(money(total()))}</b> to ${esc(fam.email)}${email ? ', emailed now' : ', not emailed (you can copy the link)'}.<br><br>${lines}`, { ok: 'Send invoice' }))) return
    await submit(el, fam, places, { sendEmail: email }, ui, false, el.querySelector('[data-text]').checked)
  })
  el.querySelectorAll('[data-fee]').forEach((inp) => inp.addEventListener('input', () => {
    const id = inp.closest('[data-place]').dataset.place, v = inp.value.trim()
    state.get(id).feeCents = v === '' || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 100)
    paint()
  }))
  paint()
}

async function submit(el, fam, places, opts, ui, replace = false, text = false) {
  const btn = el.querySelector('[data-send]')
  btn.disabled = true
  const r = await ui.post('familyInvoice', { places, ...opts, replace })
  btn.disabled = false
  if (!r.ok && r.data.code === 'link_open') {
    if (await ui.confirmBox(esc(r.data.error), { ok: 'Replace with one invoice' })) return submit(el, fam, places, opts, ui, true, text)
    return
  }
  if (!r.ok) { const err = el.querySelector('[data-err]'); err.textContent = r.data.error; err.hidden = false; return }
  if (!r.data.payreq) { ui.toast(r.data.message || 'Prices saved'); return ui.done() }
  try { await navigator.clipboard.writeText(r.data.payreq.url) } catch {}
  ui.toast(`Family invoice ${r.data.payreq.amountLabel} ${r.data.emailed ? `emailed to ${fam.email}` : 'made'}. Link copied.${r.data.replaced ? ` ${r.data.replaced} older link${r.data.replaced > 1 ? 's' : ''} closed.` : ''}`, 7000)
  ui.done()
  // The text opens with the words filled in; nothing goes until Send.
  if (text && fam.phone) textFamily(fam, ui, { amountCents: r.data.payreq.amountCents, url: r.data.payreq.url, emailed: Boolean(r.data.emailed) })
}

// Text the family about their invoice, in the Messages composer: Lee or
// Ligia can change every word before it goes.
function textFamily(fam, ui, { amountCents, url = '', emailed = false }) {
  const paidCents = fam.places.reduce((t, p) => t + (p.paidCents || 0), 0)
  const first = fam.places[0]
  return textComposer({
    modal: ui.modal, toast: ui.toast, rowIds: fam.places.map((p) => p.rowId), parent: fam.parent, mobile: fam.phone,
    title: fam.self ? `Text ${first.player.split(' ')[0]}` : 'Text the family', self: fam.self, to: fam.self ? first.player : '',
    text: familyInvoiceText({ parent: fam.parent, players: fam.names, amount: money(amountCents), url, paidCents, paidLabel: money(paidCents), email: fam.email, emailed, self: fam.self }),
  })
}

// Prices only, no invoice: each changed place through Edit's own action.
async function saveOnly(el, fam, places, ui) {
  const changed = places.filter((x) => { const p = fam.places.find((y) => y.rowId === x.rowId); return x.feeCents !== (p.feeCents || null) || x.type !== (p.type || '') })
  if (!changed.length) return ui.toast('Nothing changed')
  const moved = new Map(), gone = new Map()
  for (const x of changed) {
    const p = fam.places.find((y) => y.rowId === x.rowId)
    const fields = {}
    if (x.feeCents !== (p.feeCents || null)) fields.feeAud = x.feeCents / 100
    if (x.type && x.type !== p.type) fields.paymentType = x.type
    const r = await ui.post('editPlayer', { rowId: x.rowId, fields })
    if (!r.ok) { const err = el.querySelector('[data-err]'); err.textContent = `${p.player}: ${r.data.error}`; err.hidden = false; return }
    // An open link follows the new fee on its own (16 Oct 2026).
    for (const l of r.data.repricedLinks || []) moved.set(l.id, l)
    for (const l of r.data.closedLinks || []) gone.set(l.id, l)
  }
  const said = [...moved.values()].map((l) => `link updated to ${money(l.amountCents)} after the fee changed`).concat([...gone.values()].map((l) => `the ${money(l.amountCents)} link is cancelled, nothing is owing`))
  ui.toast(`Saved ${changed.length} price${changed.length > 1 ? 's' : ''} to Airtable${said.length ? `: ${said.join(', ')}.` : ''}`, said.length ? 8000 : 3600)
  ui.done()
}

// Session by session (pink): bill the sessions a player came to at their own
// price, as a payment link or recorded as paid by bank or cash. Brothers and
// sisters on the same email who also pay by the session can go on one link.
export function sessionModal(p, ui) {
  const { m } = ui
  const kin = m.players.filter((x) => x.status === 'session' && x.familyKey === p.familyKey)
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' })
  const box = ui.modal(`<h2 style="margin-bottom:4px">Sessions: ${esc(p.player)}</h2>
    <p class="muted small" style="margin-bottom:12px">Pays session by session. Enter the sessions to bill and the price per session; it is added to their fee in Airtable, so Money and the ledger stay right.</p>
    ${kin.map((x) => `<div class="jf-srow" data-srow="${esc(x.rowId)}">
      <label class="j-check"><input type="checkbox" data-on ${x.rowId === p.rowId ? 'checked' : ''}> <span><b>${esc(x.player)}</b><br><span class="muted small">${esc(x.group)}</span>${x.prepaidSessions ? `<br><span class="small" style="color:#027A48">${esc(x.prepaidSessions)} session${x.prepaidSessions > 1 ? 's' : ''} paid in advance from their account. They come off what you bill here.</span>` : ''}</span></label>
      <div class="j-two"><label class="j-field"><span>Sessions</span><input class="j-input" data-n inputmode="numeric" value="1"></label>
      <label class="j-field"><span>Price per session (A$)</span><input class="j-input" data-per inputmode="decimal" value="${x.perSessionCents ? x.perSessionCents / 100 : ''}" placeholder="e.g. 50"></label></div></div>`).join('')}
    <label class="j-field"><span>Which sessions (optional, shows on the invoice)</span><input class="j-input" id="ss-what" placeholder="e.g. 8 and 15 October"></label>
    <div class="j-outcomes" style="margin:6px 0 10px">
      <label class="j-check"><input type="radio" name="ss-mode" value="link" checked> <span><b>Send a payment link</b> <span class="muted small">card or Apple Pay</span></span></label>
      <label class="j-check"><input type="radio" name="ss-mode" value="paid"> <span><b>Already paid</b> <span class="muted small">bank transfer or cash</span></span></label>
    </div>
    <div id="ss-link"><label class="j-check small"><input type="checkbox" id="ss-email" ${p.email ? 'checked' : 'disabled'}> <span>Email the link to ${esc(p.email || 'the family (no email on file)')}</span></label></div>
    <div id="ss-paid" hidden class="j-two"><label class="j-field"><span>Paid by</span><select class="j-select" id="ss-method"><option>Bank Transfer</option><option>Cash</option></select></label><label class="j-field"><span>Date</span><input class="j-input" type="date" id="ss-date" value="${today}" max="${today}"></label></div>
    <p style="margin:10px 0 0"><b>Total <span id="ss-total"></span></b></p>
    <p class="j-err" id="ss-err" hidden></p>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px"><button type="button" class="j-btn j-btn-line" data-close>Cancel</button><button type="button" class="j-btn j-btn-dark" id="ss-go">Send link</button></div>`, { wide: true })
  const mode = () => box.querySelector('[name="ss-mode"]:checked').value
  const picked = () => [...box.querySelectorAll('[data-srow]')].filter((r) => r.querySelector('[data-on]').checked).map((r) => ({ rowId: r.dataset.srow, sessions: Math.round(Number(r.querySelector('[data-n]').value)), perSessionCents: Math.round(Number(r.querySelector('[data-per]').value) * 100) }))
  const paint = () => {
    const rows = picked()
    box.querySelector('#ss-total').textContent = money(rows.reduce((t, x) => t + (x.sessions > 0 && x.perSessionCents > 0 ? Math.max(0, x.sessions - (kin.find((k) => k.rowId === x.rowId)?.prepaidSessions || 0)) * x.perSessionCents : 0), 0))
    box.querySelector('#ss-link').hidden = mode() !== 'link'; box.querySelector('#ss-paid').hidden = mode() !== 'paid'
    box.querySelector('#ss-go').textContent = mode() === 'link' ? 'Send link' : 'Record payment'
  }
  box.addEventListener('input', paint); box.addEventListener('change', paint); paint()
  const go = async (replace = false) => {
    const btn = box.querySelector('#ss-go'), err = box.querySelector('#ss-err')
    const rows = picked()
    if (!rows.length) { err.textContent = 'Tick at least one player.'; err.hidden = false; return }
    btn.disabled = true
    const r = await ui.post('sessionInvoice', { rows, what: box.querySelector('#ss-what').value, mode: mode(), sendEmail: box.querySelector('#ss-email').checked, method: box.querySelector('#ss-method').value, date: box.querySelector('#ss-date').value, replace })
    btn.disabled = false
    if (!r.ok && r.data.code === 'link_open') { if (await ui.confirmBox(esc(r.data.error), { ok: 'Replace it' })) return go(true); return }
    if (!r.ok) { err.textContent = r.data.error; err.hidden = false; return }
    ui.closeModal()
    if (r.data.payreq) { try { await navigator.clipboard.writeText(r.data.payreq.url) } catch {} ui.toast(`Link for ${r.data.payreq.amountLabel} ${r.data.emailed ? 'emailed' : 'made'}. Link copied.`, 6000) } else ui.toast(r.data.message || `Recorded ${r.data.recorded}`, r.data.message ? 7000 : 3600)
    ui.done()
  }
  box.querySelector('#ss-go').addEventListener('click', () => go())
}
