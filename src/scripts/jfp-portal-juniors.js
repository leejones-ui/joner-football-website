// Joners Juniors money (Lee, 11 Oct 2026; its own page in the Joners Juniors
// section since 13 Oct): the term's children and what each has paid, with
// Stripe's real fees and what was kept, cash and bank transfers recorded in
// the portal, earlier terms and years, and a download. Read only here.
// Juniors figures are never added into the JFP ones: they come from the
// Juniors tables, their own Stripe payments and the Juniors payment ledger.
import { esc, money, toast } from './jfp-common.js'

const J = { data: null, at: 0 }
const STATUS = {
  paid: ['Paid', 'green'], stripe: ['Paid in Stripe, not in Airtable', 'blue'], part: ['Part paid', 'amber'], unpaid: ['Unpaid', 'red'],
  unverified: ['Paid, amount not recorded', 'amber'], credit: ['Paid with credit', 'grey'], refunded: ['Refunded', 'grey'],
  na: ['No fee (N/A)', 'grey'], nofee: ['Fee not set', 'red'],
}
const ORDER = ['paid', 'stripe', 'part', 'unpaid', 'unverified', 'credit', 'refunded', 'nofee', 'na']
export const DEFINITION = 'Collected = money received for this term\'s Juniors enrolments, net of refunds, whenever it was paid: Stripe (Sydney account) plus the cash and bank transfers recorded in the portal. Places paid with credit are not new money. Kept = collected less Stripe\'s fees.'
const pill = (s) => `<span class="j-pill j-pill-${STATUS[s]?.[1] || 'grey'}">${esc(STATUS[s]?.[0] || s)}</span>`
const amt = (c) => (c == null ? '<span class="muted">unknown</span>' : esc(money(c)))
const when = (iso) => (iso ? new Date(String(iso).length === 10 ? `${iso}T00:00:00+10:00` : iso).toLocaleDateString('en-AU', { timeZone: 'Australia/Sydney', day: 'numeric', month: 'short', year: 'numeric' }) : '')
const time = (iso) => (iso ? new Date(iso).toLocaleString('en-AU', { timeZone: 'Australia/Sydney', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '')
const METHOD = { card: 'Card', afterpay_clearpay: 'Afterpay', klarna: 'Klarna', zip: 'Zip', au_becs_debit: 'Direct debit', link: 'Link' }

export async function juniorsData(post, { fresh = false, quick = false } = {}) {
  if (!fresh && J.data && Date.now() - J.at < 60000) return J.data
  const r = await post('juniorsMoney', { fresh, quick })
  if (!r.ok) throw new Error(r.data?.error || 'Could not load Joners Juniors.')
  J.data = r.data.juniors
  J.at = Date.now()
  return J.data
}
// After a payment is recorded or a child added: read again next time.
export function forgetJuniors() { J.data = null; J.at = 0 }

function setHash(term) { history.replaceState(null, '', `#jj-money?term=${encodeURIComponent(term)}`) }

// The programme switch at the top of Money: JFP Money or Joners Juniors Money.
export function programmeSwitch(current) {
  return `<div class="jp-seg jm-prog" role="group" aria-label="Programme">${[['jfp', 'JFP'], ['juniors', 'Joners Juniors'], ['holiday', 'Holiday training']].map(([v, l]) => `<button type="button" data-programme="${v}" aria-pressed="${current === v}">${l}</button>`).join('')}</div>`
}

// ---------- the download ----------

const csvCell = (v) => {
  const t = String(v ?? '')
  if (/^-?\d+(\.\d+)?$/.test(t)) return t
  // Text that starts like a formula stays text in a spreadsheet.
  const safe = /^[=+\-@\t\r]/.test(t) ? `'${t}` : t
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}
const aud = (c) => (c == null ? '' : (c / 100).toFixed(2))
const sum = (list, k) => list.reduce((t, x) => t + (x[k] || 0), 0)
// One file for a term: the summary, every child, every payment. No emails or phone numbers.
export function juniorsCsv(d, term) {
  const t = d.byTerm[term]
  const out = []
  const add = (...cells) => out.push(cells.map(csvCell).join(','))
  add('Joners Juniors money', term, `Downloaded ${new Date().toLocaleDateString('en-AU', { timeZone: 'Australia/Sydney' })}`)
  add('')
  add('Summary', 'A$')
  add('Collected (after refunds)', aud(t.collectedCents))
  add('Stripe', aud(t.stripeCents)); add('Cash', aud(t.cashCents)); add('Bank transfer', aud(t.bankCents))
  if (t.otherCents) add('Other', aud(t.otherCents))
  add('Refunded', aud(t.refundedCents))
  add('Stripe fees', aud(t.feesCents)); add('GST in Stripe fees', aud(t.feeGstCents))
  add('Kept after Stripe fees', aud(t.keptCents))
  add('Still owing', aud(t.owingCents), t.owingComplete ? '' : `known only: ${t.unresolved} with no known balance`)
  if (t.feesPending) add(`${t.feesPending} Stripe fee${t.feesPending === 1 ? '' : 's'} still loading when this was downloaded`)
  add('')
  add('Children')
  add('Child', 'Parent', 'Fee (A$)', 'Paid (A$)', 'Refunded (A$)', 'Owing (A$)', 'Stripe fee (A$)', 'Status', 'Paid via', 'Left')
  const kids = d.players.filter((p) => p.term === term)
  for (const p of kids) add(p.player, p.parent, aud(p.feeCents), aud(p.paidCents), aud(p.refundedCents), aud(p.owingCents), p.stripeFeePending ? '' : aud(p.stripeFeeCents || 0), STATUS[p.status]?.[0] || p.status, p.paidVia, p.removed ? `Left ${p.removed.at}` : '')
  add('Total', '', aud(sum(kids, 'feeCents')), aud(sum(kids, 'paidCents')), aud(sum(kids, 'refundedCents')), aud(sum(kids, 'owingCents')), aud(sum(kids, 'stripeFeeCents')), '', '', '')
  add('')
  add('Payments')
  add('Date', 'Method', 'For', 'Taken (A$)', 'Refunded (A$)', 'Stripe fee (A$)', 'GST in fee (A$)', 'Kept (A$)', 'Reference')
  for (const l of t.lines || []) add(String(l.at || '').slice(0, 10), l.kind === 'stripe' && l.payMethod ? `Stripe (${METHOD[l.payMethod] || l.payMethod})` : l.method, l.who || 'Not matched to a child', aud(l.takenCents), aud(l.refundedCents), aud(l.feeCents), aud(l.feeGstCents), aud(l.keptCents), l.ref)
  const lines = t.lines || []
  add('Total', '', '', aud(sum(lines, 'takenCents')), aud(sum(lines, 'refundedCents')), aud(sum(lines, 'feeCents')), aud(sum(lines, 'feeGstCents')), aud(sum(lines, 'keptCents')), '')
  if (lines.some((l) => l.feeCents == null)) add('A blank Stripe fee (and kept) was not known yet when this was downloaded.')
  return out.join('\r\n')
}
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
function saveFile(name, text) {
  const url = URL.createObjectURL(new Blob(['﻿', text], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

// ---------- Money: Joners Juniors ----------

const headHtml = (sub, extra = '') => `<div class="jd-head"><div><h1>Money</h1><p>${sub}</p></div><div class="jd-sync">${programmeSwitch('juniors')}${extra}</div></div>`

function earlierHtml(d) {
  const years = d.years || []
  if (!years.length || (years.length === 1 && !(d.earlier || []).length)) return ''
  return `<details class="jd-card jj-years" id="jm-years" style="margin-top:12px"><summary style="cursor:pointer;font-weight:700;min-height:40px;display:flex;align-items:center">Earlier terms and years</summary>
    ${years.map((y) => `<div class="jj-year"><p class="jj-year-h"><b>${y.year}</b><span>${esc(money(y.takenCents))} collected${y.keptCents != null ? ` · ${esc(money(y.keptCents))} kept` : ''}</span></p>
      <ul class="jm-hist">${y.terms.map((t) => `<li><span><b>${esc(t.term)}</b><small>${t.source === 'register' ? 'From your Money Register (totals only)' : 'From the Juniors tables and Stripe'}</small></span><span class="amt">${esc(money(t.takenCents))}</span></li>`).join('')}</ul></div>`).join('')}
    ${d.historyError ? `<p class="muted small">${esc(d.historyError)}</p>` : ''}</details>`
}

export async function renderJuniorsMoney(ui) {
  const { view, post, filter } = ui
  view().innerHTML = `<div class="jj-view">${headHtml('Joners Juniors')}<p class="muted">Loading Joners Juniors from Airtable and Stripe</p></div>`
  bindSwitch(ui)
  let d
  try { d = await juniorsData(post) } catch (e) {
    view().innerHTML = `<div class="jj-view">${headHtml('Joners Juniors')}<div class="j-box j-box-red">${esc(e.message)} Nothing is shown rather than a wrong total. Try Refresh in a minute.</div><button type="button" class="j-btn j-btn-line j-btn-sm" id="jm-retry" style="margin-top:10px">Try again</button></div>`
    bindSwitch(ui)
    view().querySelector('#jm-retry').addEventListener('click', () => { J.data = null; renderJuniorsMoney(ui) })
    return
  }
  if (!filter.term || !d.terms.includes(filter.term)) filter.term = d.currentTerm
  setHash(filter.term)
  const t = d.byTerm[filter.term] || { players: 0, collectedCents: 0, refundedCents: 0, owingCents: 0, owingComplete: true, counts: {}, unlinkedCents: 0, unlinkedCount: 0, creditPlaces: 0, unresolved: 0, linkedCents: 0, stripeCents: 0, cashCents: 0, bankCents: 0, feesCents: 0, keptCents: 0, feesPending: 0, lines: [] }
  const inTerm = d.players.filter((p) => p.term === filter.term)
  const unlinked = d.unlinked.filter((u) => u.term === filter.term)
  view().innerHTML = `<div class="jj-view">
    ${headHtml('Joners Juniors: its own Airtable tables, Stripe payments and payment ledger. Not included in the JFP figures.', `<label class="muted small" for="jm-term">Term</label><select class="j-select" id="jm-term" style="width:auto;min-height:40px">${d.terms.map((x) => `<option ${x === filter.term ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select><button type="button" class="j-btn j-btn-line j-btn-sm" id="jm-refresh">Refresh</button>`)}
    <p class="muted small" style="margin:-4px 0 10px">Last refreshed ${esc(time(d.at))}. ${esc(DEFINITION)}</p>
    ${d.stale ? `<div class="j-box j-box-amber" style="margin-bottom:10px"><b>Not up to date.</b> ${esc(d.error || '')} (from ${esc(time(d.at))})</div>` : ''}
    <div class="jd-grid">
      <section class="jd-card jd-hero jm-hero jd-in" style="--i:0"><div><p class="lbl">Collected, ${esc(filter.term)}</p><p class="big">${esc(money(t.collectedCents))}</p><p class="small" style="opacity:.8">After refunds</p></div>
        <div class="jd-split"><span>Stripe<b>${esc(money(t.stripeCents || 0))}</b></span><span>Cash<b>${esc(money(t.cashCents || 0))}</b></span><span>Bank transfer<b>${esc(money(t.bankCents || 0))}</b></span></div></section>
      <section class="jd-card jd-tile jm-tile jd-in" style="--i:1" id="jm-kept"><span class="lbl">Kept after Stripe fees</span><span class="val">${esc(money(t.keptCents ?? t.collectedCents))}</span><span class="note">Stripe fees ${esc(money(t.feesCents || 0))}${t.feesPending ? `, ${t.feesPending} not known yet` : ''}</span></section>
      <section class="jd-card jd-tile jm-tile jd-in" style="--i:2"><span class="lbl">Still owing</span>${t.owingComplete ? `<span class="val">${esc(money(t.owingCents))}</span>` : `<span class="val">${esc(money(t.owingCents))}<span class="muted" style="font-size:14px;font-weight:650"> known</span></span><span class="note">Incomplete: ${t.unresolved} ${t.unresolved === 1 ? 'child has' : 'children have'} no known balance</span>`}</section>
      <section class="jd-card jd-tile jm-tile jd-in" style="--i:3"><span class="lbl">Children</span><span class="val">${t.players}</span><span class="note">${(t.counts.paid || 0) + (t.counts.stripe || 0)} paid${t.removed ? ` · ${t.removed} left` : ''}</span></section>
      <section class="jd-card jd-tile jm-tile jd-in" style="--i:4"><span class="lbl">Paid with credit</span><span class="val">${t.creditPlaces}</span><span class="note">Not new money</span></section>
      <section class="jd-card jd-tile jm-tile jd-in" style="--i:5"><span class="lbl">Amount not recorded</span><span class="val">${t.counts.unverified || 0}</span><span class="note">Marked Paid, no payment found</span></section>
    </div>
    <div class="jm-bar">
      <div class="jm-search"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2" stroke-linecap="round"/></svg><input class="j-input" id="jm-q" type="search" placeholder="Search child or parent" value="${esc(filter.q || '')}" autocomplete="off"></div>
      <div class="jm-chips" id="jm-chips">${[['', 'All', inTerm.length], ...ORDER.filter((s) => t.counts[s]).map((s) => [s, STATUS[s][0], t.counts[s]])].map(([v, l, n]) => `<button type="button" data-jstatus="${v}" aria-pressed="${(filter.status || '') === v}">${esc(l)} <span class="n">${n}</span></button>`).join('')}</div>
      <button type="button" class="j-btn j-btn-line j-btn-sm jm-csv" id="jm-csv">Download for accountant</button>
    </div>
    <p class="muted small" id="jm-active" style="margin:0 0 8px"></p>
    <div class="jj-mlist" id="jm-rows" role="list"></div>
    <p class="muted small" id="jm-count" style="margin-top:8px"></p>
    ${unlinked.length ? `<details class="jd-card" style="margin-top:18px"><summary style="cursor:pointer;font-weight:700;min-height:40px;display:flex;align-items:center">${unlinked.length} payment${unlinked.length === 1 ? '' : 's'} not matched to a child (${esc(money(t.unlinkedCents))})</summary><p class="sub" style="margin:6px 0 10px">Counted in ${esc(filter.term)}, but no Juniors row has the email or name they used.</p>
      <ul class="jm-hist">${unlinked.map((u) => `<li><span><b>${esc(u.forPlayer ? `For ${u.forPlayer}` : when(u.at))}</b><small>${u.forPlayer ? `${esc(when(u.at))} · ` : ''}${esc(u.why)} · ref ${esc(u.ref)}</small></span><span class="amt">${esc(money(u.cents))}</span></li>`).join('')}</ul></details>` : ''}
    ${(d.byHand || []).filter((u) => u.term === filter.term).map((u) => `<p class="muted small" style="margin-top:10px">Matched by hand: ${esc(money(u.cents))} on ${esc(when(u.at))} for ${esc(u.forPlayer)}${u.rowTerm && u.rowTerm !== u.term ? ` (counted in ${esc(u.term)}; their ${esc(u.rowTerm)} place is paid with this credit)` : ''}.</p>`).join('')}
    ${earlierHtml(d)}
    <details class="jd-card" style="margin-top:12px"><summary style="cursor:pointer;font-weight:700;min-height:40px;display:flex;align-items:center">How this is worked out</summary>
      <ul class="small" style="margin:8px 0 0 18px;line-height:1.7">
        <li>${esc(DEFINITION)}</li>
        <li>Read from ${d.coverage.tables} Juniors tables in Airtable (${d.coverage.rows} children), ${d.coverage.stripePayments} paid Stripe payments on the Sydney account (found by the IDs on the rows, the Joners Juniors tag on online sign-ups, and ${d.coverage.linksChecked} Juniors payment link${d.coverage.linksChecked === 1 ? '' : 's'}), and ${d.coverage.recordedPayments || 0} cash or bank payment${d.coverage.recordedPayments === 1 ? '' : 's'} recorded in the portal. Each payment counts once.</li>
        <li>A payment is matched to a child by its Stripe or registration ID, then by the child's name (from Stripe or the website's Joners Juniors sign-up sheet), then by the parent's email on the same payment link. One payment for two children is split by fee.</li>
        <li>Stripe's fee is the real one on each payment (from Stripe, GST included), never an estimate. Cash and bank transfers cost nothing.</li>
        ${d.coverage.sheet?.error ? `<li><b>${esc(d.coverage.sheet.error)}</b>, so matching used Airtable and Stripe only.</li>` : d.coverage.sheet ? `<li>Sign-up sheet ("${esc(d.coverage.sheet.tab)}" tab): ${d.coverage.sheet.rows} sign-ups, ${d.coverage.sheet.paid} marked paid, ${d.coverage.sheet.paidFoundInStripe} of those found in Stripe. The sheet is only used to match; it never adds money.</li>` : ''}
        <li>"Paid, amount not recorded": Airtable says Paid but no Stripe or recorded payment was found for that child. It is not counted, and its balance is unknown. Record how they paid on the child's page in Players.</li>
        ${d.coverage.missingLinks ? `<li><b>${d.coverage.missingLinks} payment link on the rows was not found in Stripe.</b></li>` : ''}
        ${d.coverage.alsoInJfp ? `<li><b>${d.coverage.alsoInJfp} Juniors payment${d.coverage.alsoInJfp === 1 ? ' is' : 's are'} also counted in the JFP Money view.</b> Tell Claude.</li>` : '<li>None of these payments is counted in the JFP figures.</li>'}
        ${d.unassigned ? `<li>${d.unassigned} Juniors payment${d.unassigned === 1 ? '' : 's'} could not be given a term, so ${d.unassigned === 1 ? 'it is' : 'they are'} in no term total: ${d.unlinked.filter((u) => !u.term).map((u) => `${esc(money(u.cents))} on ${esc(when(u.at))}${u.forPlayer ? ` for ${esc(u.forPlayer)}` : ''}`).join('; ')}.</li>` : ''}
        ${d.otherCurrency.length ? `<li>${d.otherCurrency.length} payment${d.otherCurrency.length === 1 ? '' : 's'} not in AUD: not added.</li>` : ''}
      </ul></details></div>`
  const draw = () => {
    const q = (filter.q || '').trim().toLowerCase()
    const list = inTerm.filter((p) => (!filter.status || p.status === filter.status) && (!q || `${p.player} ${p.parent}`.toLowerCase().includes(q)))
    view().querySelector('#jm-rows').innerHTML = list.map((p) => `<div class="jj-mrow${p.removed ? ' is-removed' : ''}" role="listitem"><span class="jj-mrow-who"><b>${esc(p.player)}</b>${p.removed ? ' <span class="j-pill j-pill-grey">Left</span>' : ''}<small>${esc(p.parent || '')}</small></span>
      <span class="jj-mrow-fig"><small>Fee</small>${p.feeCents == null ? '<span class="muted">not set</span>' : esc(money(p.feeCents))}</span>
      <span class="jj-mrow-fig"><small>Paid</small>${esc(money(p.paidCents))}${p.refundedCents ? `<small>refunded ${esc(money(p.refundedCents))}</small>` : ''}</span>
      <span class="jj-mrow-fig"><small>Owing</small>${p.owingCents ? `<b>${esc(money(p.owingCents))}</b>` : amt(p.owingCents)}</span>
      <span class="jj-mrow-st">${pill(p.status)}<small>${esc(p.paidVia || (p.match === 'stripe' ? 'Stripe' : ''))}${p.paidAt ? ` · ${esc(when(p.paidAt))}` : ''}</small>${p.status !== 'paid' && p.airtableStatus ? `<small>Airtable: ${esc(p.airtableStatus)}</small>` : ''}</span></div>`).join('') || `<div class="j-empty">${inTerm.length ? 'No children match.' : `No Joners Juniors children in ${esc(filter.term)}.`}</div>`
    const active = [filter.term, filter.status ? STATUS[filter.status][0] : '', q ? `"${filter.q.trim()}"` : ''].filter(Boolean)
    view().querySelector('#jm-active').innerHTML = `Showing: Joners Juniors · ${active.map(esc).join(' · ')}${filter.status || q ? ' <button type="button" class="link" id="jm-reset">Clear</button>' : ''}`
    view().querySelector('#jm-reset')?.addEventListener('click', () => { filter.status = ''; filter.q = ''; renderJuniorsMoney(ui) })
    view().querySelector('#jm-count').textContent = `${list.length} of ${inTerm.length} children · paid ${money(list.reduce((s, p) => s + p.paidCents, 0))} · owing ${money(list.reduce((s, p) => s + (p.owingCents || 0), 0))}${list.some((p) => p.owingCents == null) ? ' known' : ''}`
  }
  draw()
  view().querySelector('#jm-q').addEventListener('input', (e) => { filter.q = e.target.value; draw() })
  view().querySelector('#jm-term').addEventListener('change', (e) => { filter.term = e.target.value; filter.status = ''; renderJuniorsMoney(ui) })
  view().querySelectorAll('[data-jstatus]').forEach((b) => b.addEventListener('click', () => { filter.status = b.dataset.jstatus; view().querySelectorAll('#jm-chips [data-jstatus]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.jstatus === filter.status))); draw() }))
  view().querySelector('#jm-csv').addEventListener('click', () => saveFile(`joners-juniors-money-${slug(filter.term)}.csv`, juniorsCsv(d, filter.term)))
  view().querySelector('#jm-refresh').addEventListener('click', async (e) => {
    e.currentTarget.disabled = true
    try { await juniorsData(post, { fresh: true }); toast('Up to date') } catch (err) { toast(err.message) }
    renderJuniorsMoney(ui)
  })
  bindSwitch(ui)
}

// JFP and holiday training are views of Money; Joners Juniors has its own
// Money page in its section. The switch moves between all three.
export function bindSwitch(ui) {
  ui.view().querySelectorAll('[data-programme]').forEach((b) => b.addEventListener('click', () => {
    const want = b.dataset.programme
    if (b.getAttribute('aria-pressed') === 'true') return
    if (want === 'juniors') { ui.filter.programme = 'jfp'; return ui.go('jj-money') }
    ui.filter.programme = want === 'holiday' ? 'holiday' : 'jfp'
    if (want === 'jfp') history.replaceState(null, '', '#money')
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
  try { d = await juniorsData(ui.post, { quick: !ui.again }) } catch (e) {
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
        <div><span class="lbl">Collected</span><span class="val">${esc(money(t.collectedCents))}</span><span class="note">${t.keptCents != null ? `${esc(money(t.keptCents))} kept after fees` : 'After refunds'}</span></div>
        <div><span class="lbl">Still owing</span><span class="val">${esc(money(t.owingCents))}</span><span class="note">${t.owingComplete ? `${(t.counts.unpaid || 0) + (t.counts.part || 0)} children` : `Known only: ${t.unresolved} unresolved`}</span></div>
        <div><span class="lbl">Children</span><span class="val">${t.players}</span><span class="note">${t.creditPlaces ? `${t.creditPlaces} paid with credit` : 'this term'}</span></div>
      </div>
      <button type="button" class="j-btn j-btn-line j-btn-sm" id="jj-open">Open Joners Juniors</button>
    </div>
    ${d.stale ? `<div class="j-box j-box-amber small" style="margin-top:10px">Not up to date: last good figures from ${esc(time(d.at))}.</div>` : ''}
    <p class="muted small" style="margin-top:10px">${esc(DEFINITION)}</p>`
  el.querySelector('#jj-open').addEventListener('click', () => { ui.filter.term = term; ui.filter.status = ''; ui.go('jj-dashboard') })
  // Shown from the last reading: fetch the latest and fill the card again.
  if (d.quick && !ui.again) { J.data = null; fillJuniorsCard({ ...ui, again: true }) }
}
