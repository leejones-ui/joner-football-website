// Joners Juniors on the Money tab and the dashboard (Lee, 11 Oct 2026).
// Read only. Juniors figures are never added into the JFP ones: they come
// from the Juniors tables and their own Stripe payments, labelled as such.
import { esc, money, toast } from './jfp-common.js'

const J = { data: null, at: 0 }
const STATUS = {
  paid: ['Paid', 'green'], stripe: ['Paid in Stripe, not in Airtable', 'blue'], part: ['Part paid', 'amber'], unpaid: ['Unpaid', 'red'],
  unverified: ['Paid, amount not recorded', 'amber'], credit: ['Paid with credit', 'grey'], refunded: ['Refunded', 'grey'],
  na: ['No fee (N/A)', 'grey'], nofee: ['Fee not set', 'red'],
}
const ORDER = ['paid', 'stripe', 'part', 'unpaid', 'unverified', 'credit', 'refunded', 'nofee', 'na']
export const DEFINITION = 'Collected = money received in Stripe (Sydney account) against this term\'s Juniors enrolments, net of refunds, whenever it was paid. Places paid with credit are not new money. Cash and bank transfers are not recorded for Juniors.'
const pill = (s) => `<span class="j-pill j-pill-${STATUS[s]?.[1] || 'grey'}">${esc(STATUS[s]?.[0] || s)}</span>`
const amt = (c) => (c == null ? '<span class="muted">unknown</span>' : esc(money(c)))
const when = (iso) => (iso ? new Date(iso).toLocaleDateString('en-AU', { timeZone: 'Australia/Sydney', day: 'numeric', month: 'short', year: 'numeric' }) : '')
const time = (iso) => (iso ? new Date(iso).toLocaleString('en-AU', { timeZone: 'Australia/Sydney', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '')

export async function juniorsData(post, { fresh = false } = {}) {
  if (!fresh && J.data && Date.now() - J.at < 60000) return J.data
  const r = await post('juniorsMoney', { fresh })
  if (!r.ok) throw new Error(r.data?.error || 'Could not load Joners Juniors.')
  J.data = r.data.juniors
  J.at = Date.now()
  return J.data
}

function setHash(term) { history.replaceState(null, '', `#money?programme=juniors&term=${encodeURIComponent(term)}`) }

// The programme switch shown at the top of Money, for both programmes.
export function programmeSwitch(current) {
  return `<div class="jp-seg jm-prog" role="group" aria-label="Programme">${[['jfp', 'JFP'], ['juniors', 'Joners Juniors']].map(([v, l]) => `<button type="button" data-programme="${v}" aria-pressed="${current === v}">${l}</button>`).join('')}</div>`
}

// ---------- Money: Joners Juniors ----------

export async function renderJuniorsMoney(ui) {
  const { view, post, filter, go } = ui
  view().innerHTML = `<div class="jd-head"><div><h1>Money</h1><p>Joners Juniors</p></div><div class="jd-sync">${programmeSwitch('juniors')}</div></div><p class="muted">Loading Joners Juniors from Airtable and Stripe</p>`
  let d
  try { d = await juniorsData(post) } catch (e) {
    view().innerHTML = `<div class="jd-head"><div><h1>Money</h1><p>Joners Juniors</p></div><div class="jd-sync">${programmeSwitch('juniors')}</div></div><div class="j-box j-box-red">${esc(e.message)} Nothing is shown rather than a wrong total. Try Refresh in a minute.</div><button type="button" class="j-btn j-btn-line j-btn-sm" id="jm-retry" style="margin-top:10px">Try again</button>`
    view().querySelector('#jm-retry').addEventListener('click', () => { J.data = null; renderJuniorsMoney(ui) })
    return
  }
  if (!filter.term || !d.terms.includes(filter.term)) filter.term = d.currentTerm
  setHash(filter.term)
  const t = d.byTerm[filter.term] || { players: 0, collectedCents: 0, refundedCents: 0, owingCents: 0, owingComplete: true, counts: {}, unlinkedCents: 0, unlinkedCount: 0, creditPlaces: 0, unresolved: 0, linkedCents: 0 }
  const inTerm = d.players.filter((p) => p.term === filter.term)
  const unlinked = d.unlinked.filter((u) => u.term === filter.term)
  view().innerHTML = `
    <div class="jd-head"><div><h1>Money</h1><p>Joners Juniors: its own Airtable tables and Stripe payments. Not included in the JFP figures.</p></div>
      <div class="jd-sync">${programmeSwitch('juniors')}<label class="muted small" for="jm-term">Term</label><select class="j-select" id="jm-term" style="width:auto">${d.terms.map((x) => `<option ${x === filter.term ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select><button type="button" class="j-btn j-btn-line j-btn-sm" id="jm-refresh">Refresh</button></div></div>
    <p class="muted small" style="margin:-4px 0 10px">Last refreshed ${esc(time(d.at))}. ${esc(DEFINITION)}</p>
    ${d.stale ? `<div class="j-box j-box-amber" style="margin-bottom:10px"><b>Not up to date.</b> ${esc(d.error || '')} (from ${esc(time(d.at))})</div>` : ''}
    <div class="jd-grid">
      <section class="jd-card jd-hero jm-hero jd-in" style="--i:0"><div><p class="lbl">Collected, ${esc(filter.term)}</p><p class="big">${esc(money(t.collectedCents))}</p><p class="small" style="opacity:.8">Stripe, net of refunds</p></div>
        <div class="jd-split"><span>Refunded<b>${esc(money(t.refundedCents))}</b></span><span>Matched to a child<b>${esc(money(t.linkedCents))}</b></span><span>Not matched<b>${esc(money(t.unlinkedCents))}</b></span></div></section>
      <section class="jd-card jd-tile jm-tile jd-in" style="--i:1"><span class="lbl">Still owing</span>${t.owingComplete ? `<span class="val">${esc(money(t.owingCents))}</span>` : `<span class="val">${esc(money(t.owingCents))}<span class="muted" style="font-size:14px;font-weight:650"> known</span></span><span class="note">Incomplete: ${t.unresolved} ${t.unresolved === 1 ? 'child has' : 'children have'} no known balance</span>`}</section>
      <section class="jd-card jd-tile jm-tile jd-in" style="--i:2"><span class="lbl">Children</span><span class="val">${t.players}</span><span class="note">${(t.counts.paid || 0) + (t.counts.stripe || 0)} paid in Stripe</span></section>
      <section class="jd-card jd-tile jm-tile jd-in" style="--i:3"><span class="lbl">Paid with credit</span><span class="val">${t.creditPlaces}</span><span class="note">Not new money</span></section>
      <section class="jd-card jd-tile jm-tile jd-in" style="--i:4"><span class="lbl">Amount not recorded</span><span class="val">${t.counts.unverified || 0}</span><span class="note">Marked Paid, no Stripe payment found</span></section>
    </div>
    <div class="jm-bar">
      <div class="jm-search"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2" stroke-linecap="round"/></svg><input class="j-input" id="jm-q" type="search" placeholder="Search child or parent" value="${esc(filter.q || '')}" autocomplete="off"></div>
      <div class="jm-chips" id="jm-chips">${[['', 'All', inTerm.length], ...ORDER.filter((s) => t.counts[s]).map((s) => [s, STATUS[s][0], t.counts[s]])].map(([v, l, n]) => `<button type="button" data-jstatus="${v}" aria-pressed="${(filter.status || '') === v}">${esc(l)} <span class="n">${n}</span></button>`).join('')}</div>
    </div>
    <p class="muted small" id="jm-active" style="margin:0 0 8px"></p>
    <div class="jp-scroll"><table class="jp-table jm-table"><thead><tr><th>Child</th><th class="jj-sm-hide">Programme</th><th class="num">Fee</th><th class="num">Paid</th><th class="num">Owing</th><th>Status</th><th>Paid via</th></tr></thead><tbody id="jm-rows"></tbody></table></div>
    <p class="muted small" id="jm-count" style="margin-top:8px"></p>
    ${unlinked.length ? `<details class="jd-card" style="margin-top:18px"><summary style="cursor:pointer;font-weight:700">${unlinked.length} Stripe payment${unlinked.length === 1 ? '' : 's'} not matched to a child (${esc(money(t.unlinkedCents))})</summary><p class="sub" style="margin:6px 0 10px">Counted in ${esc(filter.term)} because they came through its payment link, but no Juniors row has the email they used.</p>
      <ul class="jm-hist">${unlinked.map((u) => `<li><span><b>${esc(u.forPlayer ? `For ${u.forPlayer}` : when(u.at))}</b><small>${u.forPlayer ? `${esc(when(u.at))} · ` : ''}${esc(u.why)} · ref ${esc(u.ref)}</small></span><span class="amt">${esc(money(u.cents))}</span></li>`).join('')}</ul></details>` : ''}
    <details class="jd-card" style="margin-top:12px"><summary style="cursor:pointer;font-weight:700">How this is worked out</summary>
      <ul class="small" style="margin:8px 0 0 18px;line-height:1.7">
        <li>${esc(DEFINITION)}</li>
        <li>Read from ${d.coverage.tables} Juniors tables in Airtable (${d.coverage.rows} children) and ${d.coverage.stripePayments} paid Stripe payments on the Sydney account, found by the IDs on the rows, the Joners Juniors tag on online sign-ups, and ${d.coverage.linksChecked} Juniors payment link${d.coverage.linksChecked === 1 ? '' : 's'}. Each payment counts once.</li>
        <li>A payment is matched to a child by its Stripe ID, then by the child's name (from Stripe or the website's Joners Juniors sign-up sheet), then by the parent's email on the same payment link. One payment for two children is split by fee.</li>
        ${d.coverage.sheet?.error ? `<li><b>${esc(d.coverage.sheet.error)}</b>, so matching used Airtable and Stripe only.</li>` : d.coverage.sheet ? `<li>Sign-up sheet ("${esc(d.coverage.sheet.tab)}" tab): ${d.coverage.sheet.rows} sign-ups, ${d.coverage.sheet.paid} marked paid, ${d.coverage.sheet.paidFoundInStripe} of those found in Stripe. The sheet is only used to match; it never adds money.</li>` : ''}
        <li>"Paid, amount not recorded": Airtable says Paid but no Stripe payment was found for that child. It is not counted, and its balance is unknown.</li>
        ${d.coverage.missingLinks ? `<li><b>${d.coverage.missingLinks} payment link on the rows was not found in Stripe.</b></li>` : ''}
        ${d.coverage.alsoInJfp ? `<li><b>${d.coverage.alsoInJfp} Juniors payment${d.coverage.alsoInJfp === 1 ? ' is' : 's are'} also counted in the JFP Money view.</b> Tell Claude.</li>` : '<li>None of these payments is counted in the JFP figures.</li>'}
        ${d.unassigned ? `<li>${d.unassigned} Juniors payment${d.unassigned === 1 ? '' : 's'} could not be given a term, so ${d.unassigned === 1 ? 'it is' : 'they are'} in no term total: ${d.unlinked.filter((u) => !u.term).map((u) => `${esc(money(u.cents))} on ${esc(when(u.at))}${u.forPlayer ? ` for ${esc(u.forPlayer)}` : ''}`).join('; ')}.</li>` : ''}
        ${d.otherCurrency.length ? `<li>${d.otherCurrency.length} payment${d.otherCurrency.length === 1 ? '' : 's'} not in AUD: not added.</li>` : ''}
      </ul></details>`
  const draw = () => {
    const q = (filter.q || '').trim().toLowerCase()
    const list = inTerm.filter((p) => (!filter.status || p.status === filter.status) && (!q || `${p.player} ${p.parent}`.toLowerCase().includes(q)))
    view().querySelector('#jm-rows').innerHTML = list.map((p) => `<tr><td><b>${esc(p.player)}</b><br><span class="muted small">${esc(p.parent || '')}</span></td><td class="small jj-sm-hide">Joners Juniors<br><span class="muted">${esc(p.term)}</span></td><td class="num">${p.feeCents == null ? '<span class="muted">not set</span>' : esc(money(p.feeCents))}</td><td class="num">${esc(money(p.paidCents))}${p.refundedCents ? `<br><span class="muted small">refunded ${esc(money(p.refundedCents))}</span>` : ''}</td><td class="num">${p.owingCents ? `<b>${esc(money(p.owingCents))}</b>` : amt(p.owingCents)}</td><td>${pill(p.status)}${p.status !== 'paid' && p.airtableStatus ? `<br><span class="muted small">Airtable: ${esc(p.airtableStatus)}</span>` : ''}</td><td class="small">${esc(p.paidVia || (p.match ? 'Stripe' : ''))}${p.paidAt ? `<br><span class="muted">${esc(when(p.paidAt))}</span>` : ''}</td></tr>`).join('') || `<tr><td colspan="7"><div class="j-empty">${inTerm.length ? 'No children match.' : `No Joners Juniors children in ${esc(filter.term)}.`}</div></td></tr>`
    const active = [filter.term, filter.status ? STATUS[filter.status][0] : '', q ? `"${filter.q.trim()}"` : ''].filter(Boolean)
    view().querySelector('#jm-active').innerHTML = `Showing: Joners Juniors · ${active.map(esc).join(' · ')}${filter.status || q ? ' <button type="button" class="link" id="jm-reset">Clear</button>' : ''}`
    view().querySelector('#jm-reset')?.addEventListener('click', () => { filter.status = ''; filter.q = ''; renderJuniorsMoney(ui) })
    view().querySelector('#jm-count').textContent = `${list.length} of ${inTerm.length} children · paid ${money(list.reduce((s, p) => s + p.paidCents, 0))} · owing ${money(list.reduce((s, p) => s + (p.owingCents || 0), 0))}${list.some((p) => p.owingCents == null) ? ' known' : ''}`
  }
  draw()
  view().querySelector('#jm-q').addEventListener('input', (e) => { filter.q = e.target.value; draw() })
  view().querySelector('#jm-term').addEventListener('change', (e) => { filter.term = e.target.value; filter.status = ''; renderJuniorsMoney(ui) })
  view().querySelectorAll('[data-jstatus]').forEach((b) => b.addEventListener('click', () => { filter.status = b.dataset.jstatus; view().querySelectorAll('#jm-chips [data-jstatus]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.jstatus === filter.status))); draw() }))
  view().querySelector('#jm-refresh').addEventListener('click', async (e) => {
    e.currentTarget.disabled = true
    try { await juniorsData(post, { fresh: true }); toast('Up to date') } catch (err) { toast(err.message) }
    renderJuniorsMoney(ui)
  })
  bindSwitch(ui)
}

export function bindSwitch(ui) {
  ui.view().querySelectorAll('[data-programme]').forEach((b) => b.addEventListener('click', () => {
    if (ui.filter.programme === b.dataset.programme) return
    ui.filter.programme = b.dataset.programme
    if (b.dataset.programme === 'jfp') history.replaceState(null, '', '#money')
    ui.go('money')
  }))
}

// ---------- the dashboard card ----------

export function juniorsCardShell() {
  return `<section class="jd-card jd-span-12 jd-in jj-card" style="--i:6" id="jj-card"><h2>Joners Juniors</h2><p class="sub">Loading</p></section>`
}

export async function fillJuniorsCard(ui) {
  const el = document.getElementById('jj-card')
  if (!el) return
  let d
  try { d = await juniorsData(ui.post) } catch (e) {
    el.innerHTML = `<h2>Joners Juniors</h2><div class="j-box j-box-amber small" style="margin-top:8px">${esc(e.message)} No total is shown rather than a wrong one.</div>`
    return
  }
  if (!document.getElementById('jj-card')) return
  const term = d.currentTerm
  const t = d.byTerm[term]
  if (!t) { el.innerHTML = '<h2>Joners Juniors</h2><p class="sub">No Juniors terms found in Airtable.</p>'; return }
  el.innerHTML = `<div class="jj-row">
      <div><h2>Joners Juniors</h2><p class="sub">${esc(term)} · separate from JFP · refreshed ${esc(time(d.at))}</p></div>
      <div class="jj-figs">
        <div><span class="lbl">Collected</span><span class="val">${esc(money(t.collectedCents))}</span><span class="note">Stripe, net of refunds</span></div>
        <div><span class="lbl">Still owing</span><span class="val">${esc(money(t.owingCents))}</span><span class="note">${t.owingComplete ? `${(t.counts.unpaid || 0) + (t.counts.part || 0)} children` : `Known only: ${t.unresolved} unresolved`}</span></div>
        <div><span class="lbl">Children</span><span class="val">${t.players}</span><span class="note">${t.creditPlaces ? `${t.creditPlaces} paid with credit` : 'this term'}</span></div>
      </div>
      <button type="button" class="j-btn j-btn-line j-btn-sm" id="jj-open">Open in Money</button>
    </div>
    ${d.stale ? `<div class="j-box j-box-amber small" style="margin-top:10px">Not up to date: last good figures from ${esc(time(d.at))}.</div>` : ''}
    <p class="muted small" style="margin-top:10px">${esc(DEFINITION)}</p>`
  el.querySelector('#jj-open').addEventListener('click', () => { ui.filter.programme = 'juniors'; ui.filter.term = term; ui.filter.status = ''; ui.go('money') })
}
