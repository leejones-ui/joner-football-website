// Agents (Lee, 20 Oct 2026): "invoicing needs to be for one agency and i
// should be able to update this ! this are one off payments now and again".
//
// Players > ⋯ > Agents, or "Agent: name" on a player: each agency's card with
// its details (Edit agency: the name on its invoices, the agent, the invoice
// email, billing address, ABN and price per session), its players and what is
// owed, its open payment links, and Bill the agency: the sessions picked go on
// one payment link and one invoice made out to the agency. Nothing is emailed
// unless "Email the invoice" is ticked.
import { esc, money } from './jfp-common.js'

const dollars = (c) => (c ? String(c / 100) : '')
const toCents = (v) => { const n = Number(String(v || '').replace(/[^\d.]/g, '')); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0 }

export async function agentsModal(ui, { openAgent } = {}) {
  const r = await ui.post('agentsList')
  if (!r.ok) return ui.toast(r.data.error || 'Could not load the agents.')
  const agents = r.data.agents || []
  if (openAgent) return agentCard(ui, openAgent)
  const box = ui.modal(`<h2 style="margin-bottom:4px">Agents</h2>
    <p class="muted small" style="margin-bottom:12px">Each agency has one account, one email and one invoice for all its players.</p>
    ${agents.length ? agents.map((a) => `<button type="button" class="j-card-btn" data-agent="${esc(a.id)}" style="display:flex;justify-content:space-between;gap:12px;width:100%;text-align:left;padding:12px;border:1px solid var(--line,#E4E7EC);border-radius:10px;background:none;margin-bottom:8px;cursor:pointer">
        <span><b>${esc(a.company || a.name)}</b><br><span class="muted small">${a.company ? `${esc(a.name)} · ` : ''}${esc(a.email)}</span></span>
        <span class="muted small" style="white-space:nowrap">${a.players.length} player${a.players.length === 1 ? '' : 's'} ›</span></button>`).join('') : '<p class="muted">No agents yet. Use + Add an agent.</p>'}
    <div class="jpf-acts"><button type="button" class="j-btn j-btn-line" data-close>Close</button><button type="button" class="j-btn j-btn-dark" id="ags-add">+ Add an agent</button></div>`)
  box.querySelectorAll('[data-agent]').forEach((b) => b.addEventListener('click', () => agentCard(ui, b.dataset.agent)))
  box.querySelector('#ags-add').addEventListener('click', () => ui.addAgent())
}

export async function agentCard(ui, agentId) {
  const r = await ui.post('agentCard', { agentId, fresh: true })
  if (!r.ok) return ui.toast(r.data.error || 'Could not load the agent.')
  const { agent: a, players, open, totals } = r.data
  const billable = players.filter((p) => p.bySession)
  const box = ui.modal(`<h2 style="margin-bottom:2px">${esc(a.company || a.name)}</h2>
    <p class="muted small" style="margin-bottom:10px">Agent ${esc(a.name)} · ${esc(a.email)}${a.mobile ? ` · ${esc(a.mobile)}` : ''}</p>
    <div class="jf-agent-facts" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-bottom:12px">
      <div><span class="muted small">Invoices made out to</span><br><b>${esc(a.company || a.name)}</b>${a.company && a.name ? `<br><span class="small">Attn: ${esc(a.name)}</span>` : ''}${a.address ? `<br><span class="small">${esc(a.address)}</span>` : ''}${a.abn ? `<br><span class="small">ABN ${esc(a.abn)}</span>` : ''}<br><span class="small">${esc(a.billingEmail || a.email)}</span></div>
      <div><span class="muted small">Price per session</span><br><b>${a.rateCents ? money(a.rateCents) : 'Not set'}</b>${(a.packs || []).map((k) => `<br><span class="small">Pack of ${k.n}: ${money(k.cents)} a session (${money(k.n * k.cents)})</span>`).join('') || '<br><span class="small">No packs</span>'}</div>
      <div><span class="muted small">This term</span><br><b>${money(totals.feeCents)} billed</b><br><span class="small">${money(totals.paidCents)} paid · ${money(totals.owingCents)} owing</span></div>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
      <button type="button" class="j-btn j-btn-dark j-btn-sm" id="agc-bill" ${billable.length ? '' : 'disabled'}>Bill the agency</button>
      <button type="button" class="j-btn j-btn-line j-btn-sm" id="agc-pack" ${billable.length && (a.packs || []).length ? '' : 'disabled'}>Send a pack</button>
      <button type="button" class="j-btn j-btn-line j-btn-sm" id="agc-edit">Edit agency</button>
      <button type="button" class="j-btn j-btn-line j-btn-sm" id="agc-add">+ Add players</button>
    </div>
    <h3>Players (${players.length})</h3>
    ${players.length ? `<div style="overflow-x:auto"><table class="j-table small" style="width:100%"><thead><tr><th>Player</th><th>Group</th><th>Price</th><th>Owing</th><th>Prepaid left</th><th>Waiver</th></tr></thead><tbody>
      ${players.map((p) => `<tr><td><b>${esc(p.name)}</b>${p.byAgent ? ' <span class="ps-tag">Added by agent</span>' : ''}</td><td>${esc(p.group)}</td><td>${p.bySession ? (p.perSessionCents ? `${money(p.perSessionCents)} a session` : 'By the session') : esc(p.paymentType || 'Term fee')}</td><td>${p.owingCents ? money(p.owingCents) : '-'}</td><td>${p.prepaid ? `${p.prepaid} session${p.prepaid > 1 ? 's' : ''}` : '-'}</td><td>${p.waiver ? 'Signed' : 'Not yet'}</td></tr>`).join('')}
    </tbody></table></div>` : '<p class="muted">No players yet. The agent can add them from their account (My players > Add your players), or use + Add players.</p>'}
    <h3 style="margin-top:14px">Open payment links</h3>
    ${open.length ? open.map((q) => `<div style="display:flex;justify-content:space-between;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid var(--line,#E4E7EC)"><span><b>${money(q.amountCents)}</b> <span class="muted small">${esc(q.players.join(', '))}${q.emailedAt ? ' · emailed' : ' · not emailed'}</span></span><button type="button" class="j-btn j-btn-line j-btn-sm" data-copy="${esc(q.url)}">Copy link</button></div>`).join('') : '<p class="muted small">Nothing open.</p>'}
    <div class="jpf-acts"><button type="button" class="j-btn j-btn-line" data-close>Close</button></div>`, { wide: true })
  box.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', () => ui.copy(b.dataset.copy)))
  box.querySelector('#agc-edit').addEventListener('click', () => editAgency(ui, a))
  box.querySelector('#agc-add').addEventListener('click', () => ui.addAgent(a.id))
  box.querySelector('#agc-bill').addEventListener('click', () => billAgency(ui, a, billable))
  box.querySelector('#agc-pack').addEventListener('click', () => sendPack(ui, a, billable))
}

// A session pack for one player (Lee, 20 Oct 2026): a link at the agency's
// pack price. The sessions come off as you bill; unused ones end with the term.
function sendPack(ui, a, players) {
  const packs = a.packs || []
  const box = ui.modal(`<h2>Send a pack</h2>
    <p class="muted small" style="margin-bottom:10px">A payment link for ${esc(a.company || a.name)}. When it is paid, the sessions come off what you bill for that player. Unused sessions end with the term. Nothing is emailed: copy the link and send it.</p>
    <label class="j-field"><span>Player</span><select class="j-select" id="sp-row">${players.map((p) => `<option value="${esc(p.rowId)}">${esc(p.name)}</option>`).join('')}</select></label>
    <label class="j-field"><span>Pack</span><select class="j-select" id="sp-n">${packs.map((k) => `<option value="${k.n}">${k.n} sessions at ${money(k.cents)} = ${money(k.n * k.cents)}</option>`).join('')}</select></label>
    <p class="j-err" id="sp-err" hidden></p>
    <div id="sp-out"></div>
    <div class="jpf-acts"><button type="button" class="j-btn j-btn-line" data-close>Close</button><button type="button" class="j-btn j-btn-dark" id="sp-go">Make the link</button></div>`)
  box.querySelector('#sp-go').addEventListener('click', async (ev) => {
    const b = ev.currentTarget, err = box.querySelector('#sp-err')
    b.disabled = true; err.hidden = true
    const r = await ui.post('agentPack', { agentId: a.id, rowId: box.querySelector('#sp-row').value, n: Number(box.querySelector('#sp-n').value) })
    b.disabled = false
    if (!r.ok) { err.textContent = r.data.error; err.hidden = false; return }
    box.querySelector('#sp-out').innerHTML = `<p class="small" style="margin:8px 0">${r.data.reused ? 'This player already has an open link, so here it is (pay or cancel that one first):' : `Link made for ${money(r.data.amountCents)}:`}</p><div style="display:flex;gap:8px"><input class="j-input" readonly value="${esc(r.data.url)}"><button type="button" class="j-btn j-btn-line j-btn-sm" id="sp-copy">Copy</button></div>`
    box.querySelector('#sp-copy').addEventListener('click', () => ui.copy(r.data.url))
  })
}

function editAgency(ui, a) {
  const box = ui.modal(`<h2 style="margin-bottom:4px">Edit agency</h2>
    <p class="muted small" style="margin-bottom:12px">What goes on the agency's invoices, and who signs in. A new agent name, email or mobile goes on to every one of the agency's players in Airtable.</p>
    <div class="j-two"><label class="j-field"><span>Agency name <span class="muted">(invoices are made out to this)</span></span><input class="j-input" id="ea-company" value="${esc(a.company || '')}"></label>
    <label class="j-field"><span>Agent name</span><input class="j-input" id="ea-name" value="${esc(a.name || '')}"></label></div>
    <div class="j-two"><label class="j-field"><span>Agent email <span class="muted">(they sign in with this)</span></span><input class="j-input" id="ea-email" type="email" value="${esc(a.email || '')}"></label>
    <label class="j-field"><span>Agent mobile</span><input class="j-input" id="ea-mobile" type="tel" value="${esc(a.mobile || '')}"></label></div>
    <label class="j-field"><span>Invoices email <span class="muted">(optional, if accounts is a different address; shown on the invoice)</span></span><input class="j-input" id="ea-billing" type="email" value="${esc(a.billingEmail || '')}"></label>
    <label class="j-field"><span>Billing address <span class="muted">(optional)</span></span><input class="j-input" id="ea-address" value="${esc(a.address || '')}"></label>
    <div class="j-two"><label class="j-field"><span>ABN <span class="muted">(optional)</span></span><input class="j-input" id="ea-abn" inputmode="numeric" value="${esc(a.abn || '')}"></label>
    <label class="j-field"><span>Price per session (A$) <span class="muted">(used when you bill, and for players the agent adds)</span></span><input class="j-input" id="ea-rate" inputmode="decimal" value="${esc(dollars(a.rateCents))}" placeholder="e.g. 100"></label></div>
    <div class="j-two"><label class="j-field"><span>5-pack price per session (A$) <span class="muted">(blank: no 5-pack)</span></span><input class="j-input" id="ea-p5" inputmode="decimal" value="${esc(dollars((a.packs || []).find((k) => k.n === 5)?.cents))}" placeholder="e.g. 90"></label>
    <label class="j-field"><span>10-pack price per session (A$) <span class="muted">(blank: no 10-pack)</span></span><input class="j-input" id="ea-p10" inputmode="decimal" value="${esc(dollars((a.packs || []).find((k) => k.n === 10)?.cents))}" placeholder="e.g. 85"></label></div>
    <p class="j-err" id="ea-err" hidden></p>
    <div class="jpf-acts"><button type="button" class="j-btn j-btn-line" data-close>Cancel</button><button type="button" class="j-btn j-btn-dark" id="ea-save">Save</button></div>`, { wide: true })
  const v = (id) => box.querySelector(`#${id}`).value.trim()
  box.querySelector('#ea-save').addEventListener('click', async (ev) => {
    const b = ev.currentTarget, err = box.querySelector('#ea-err')
    b.disabled = true
    const r = await ui.post('editAgent', { agentId: a.id, agent: { company: v('ea-company'), name: v('ea-name'), email: v('ea-email'), mobile: v('ea-mobile'), billingEmail: v('ea-billing'), address: v('ea-address'), abn: v('ea-abn'), rateCents: toCents(v('ea-rate')), packs: { 5: toCents(v('ea-p5')) || 0, 10: toCents(v('ea-p10')) || 0 } } })
    b.disabled = false
    if (!r.ok) { err.textContent = r.data.error; err.hidden = false; return }
    ui.toast(`Saved${r.data.rowsChanged ? `, and ${r.data.rowsChanged} player${r.data.rowsChanged > 1 ? 's' : ''} updated in Airtable` : ''}.`)
    ui.after()
    agentCard(ui, a.id)
  })
}

// Bill the agency: the sessions picked, one link, one invoice to the agency.
function billAgency(ui, a, players) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' })
  const box = ui.modal(`<h2 style="margin-bottom:4px">Bill ${esc(a.company || a.name)}</h2>
    <p class="muted small" style="margin-bottom:12px">Tick the players and the sessions to bill. They go on one invoice made out to ${esc(a.company || a.name)}, and on to each player's fee in Airtable so Money and the ledger stay right.</p>
    ${players.map((p) => `<div class="jf-srow" data-srow="${esc(p.rowId)}" style="margin-bottom:8px">
      <label class="j-check"><input type="checkbox" data-on ${players.length === 1 ? 'checked' : ''}> <span><b>${esc(p.name)}</b><br><span class="muted small">${esc(p.group)}</span></span></label>
      <div class="j-two"><label class="j-field"><span>Sessions</span><input class="j-input" data-n inputmode="numeric" value="1"></label>
      <label class="j-field"><span>Price per session (A$)</span><input class="j-input" data-per inputmode="decimal" value="${esc(dollars(p.perSessionCents || a.rateCents))}" placeholder="e.g. 100"></label></div></div>`).join('')}
    <label class="j-field"><span>Which sessions (optional, shows on the invoice)</span><input class="j-input" id="ba-what" placeholder="e.g. 21 October"></label>
    <div class="j-outcomes" style="margin:6px 0 10px">
      <label class="j-check"><input type="radio" name="ba-mode" value="link" checked> <span><b>Invoice with a payment link</b> <span class="muted small">card or Apple Pay</span></span></label>
      <label class="j-check"><input type="radio" name="ba-mode" value="paid"> <span><b>Already paid</b> <span class="muted small">bank transfer or cash</span></span></label>
    </div>
    <div id="ba-link"><label class="j-check small"><input type="checkbox" id="ba-email"> <span>Email the invoice to ${esc(a.email)} now (a real email, with the PDF made out to ${esc(a.company || a.name)})</span></label></div>
    <div id="ba-paid" hidden class="j-two"><label class="j-field"><span>Paid by</span><select class="j-select" id="ba-method"><option>Bank Transfer</option><option>Cash</option></select></label><label class="j-field"><span>Date</span><input class="j-input" type="date" id="ba-date" value="${today}" max="${today}"></label></div>
    <p style="margin:10px 0 0"><b>Total <span id="ba-total"></span></b></p>
    <p class="j-err" id="ba-err" hidden></p>
    <div class="jpf-acts"><button type="button" class="j-btn j-btn-line" data-close>Cancel</button><button type="button" class="j-btn j-btn-dark" id="ba-go">Make the invoice</button></div>`, { wide: true })
  const mode = () => box.querySelector('[name="ba-mode"]:checked').value
  const picked = () => [...box.querySelectorAll('[data-srow]')].filter((r) => r.querySelector('[data-on]').checked).map((r) => ({ rowId: r.dataset.srow, sessions: Math.round(Number(r.querySelector('[data-n]').value)), perSessionCents: toCents(r.querySelector('[data-per]').value) }))
  const paint = () => {
    box.querySelector('#ba-total').textContent = money(picked().reduce((t, x) => t + (x.sessions > 0 ? x.sessions * x.perSessionCents : 0), 0))
    box.querySelector('#ba-link').hidden = mode() !== 'link'; box.querySelector('#ba-paid').hidden = mode() !== 'paid'
    box.querySelector('#ba-go').textContent = mode() === 'paid' ? 'Record payment' : box.querySelector('#ba-email').checked ? 'Make and email the invoice' : 'Make the invoice'
  }
  box.addEventListener('input', paint); box.addEventListener('change', paint); paint()
  const go = async (replace = false) => {
    const btn = box.querySelector('#ba-go'), err = box.querySelector('#ba-err')
    const rows = picked()
    if (!rows.length) { err.textContent = 'Tick at least one player.'; err.hidden = false; return }
    btn.disabled = true
    const r = await ui.post('sessionInvoice', { rows, what: box.querySelector('#ba-what').value, mode: mode(), sendEmail: mode() === 'link' && box.querySelector('#ba-email').checked, method: box.querySelector('#ba-method').value, date: box.querySelector('#ba-date').value, replace })
    btn.disabled = false
    if (!r.ok && r.data.code === 'link_open') { if (await ui.confirmBox(esc(r.data.error), { ok: 'Replace it' })) return go(true); return }
    if (!r.ok) { err.textContent = r.data.error; err.hidden = false; return }
    if (r.data.payreq) { try { await navigator.clipboard.writeText(r.data.payreq.url) } catch {} ui.toast(`Invoice for ${r.data.payreq.amountLabel} ${r.data.emailed ? `emailed to ${a.email}` : 'made, not emailed'}. Link copied.${r.data.emailError ? ` ${r.data.emailError}` : r.data.pdfWarning ? ` ${r.data.pdfWarning}` : ''}`, 8000) } else ui.toast(r.data.message || `Recorded ${r.data.recorded}`, 5000)
    ui.after()
    agentCard(ui, a.id)
  }
  box.querySelector('#ba-go').addEventListener('click', () => go())
}
