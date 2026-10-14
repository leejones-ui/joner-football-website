// Pro session quotes in the staff portal (Lee, 14 Oct 2026): the commitment
// options in Edit player and Add a player, and the default Pro quote on
// Money > Prices. Each player's quote is their own: the price per session
// (the form's own per-session box) plus options like "6 sessions in a row at
// A$95 each". The player chooses in My account; only staff change the prices.
import { esc, money } from './jfp-common.js'

const dollars = (c) => (c / 100).toFixed(2).replace(/\.00$/, '')
const centsOf = (t) => { const x = String(t ?? '').replace(/[a$,\s]/gi, ''); return x === '' ? null : Math.round(Number(x) * 100) }
const tierRow = (t = {}) => `<div class="jpq-row" data-tier style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:6px 0">
  <input class="j-input" data-n inputmode="numeric" aria-label="Sessions in a row" value="${esc(t.n ?? '')}" placeholder="6" style="width:64px">
  <span class="small">in a row at A$</span>
  <input class="j-input" data-c inputmode="decimal" aria-label="Price each, A$" value="${t.cents ? esc(dollars(t.cents)) : ''}" placeholder="95" style="width:84px">
  <span class="small">each</span>
  <button type="button" class="j-btn j-btn-ghost j-btn-sm" data-rm aria-label="Remove this option">Remove</button></div>`

// The player's commitment, for staff: sessions covered and left.
export function commitmentHtml(c, paid = []) {
  if (!c) return ''
  const last = paid[0]
  return `<div class="j-box j-box-grey small" data-commitment style="margin:8px 0">
    <b>Committed: ${esc(c.sessions)} session${c.sessions > 1 ? 's' : ''}, ${esc(c.left)} left.</b>
    ${last ? ` Paid ${esc(last.amountLabel)} (${esc(last.sessions)} at ${esc(money(last.perCents))} each)${last.paidAt ? ` on ${esc(new Date(last.paidAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }))}` : ''}.` : ''}
    <br>${c.dates.map((d) => `<span${d.done ? ' class="muted"' : ''}>${esc(d.label)}</span>`).join(', ')}
    <br><span class="muted">These dates are never billed from Money. A missed one still counts as paid.</span></div>`
}

export function quoteHtml(px, { tiers = [], defaultQuote = null, title = 'Commitment options' } = {}) {
  return `<div class="jpq" id="${px}-q">
    <p class="small" style="margin:8px 0 2px"><b>${esc(title)}</b> <span class="muted">(optional, this player only)</span></p>
    <p class="muted small" style="margin:0 0 4px">In their account they choose: pay for the next session at the price above, or commit to one of these. Only you and Ligia change these prices.</p>
    <div id="${px}-q-rows">${tiers.map(tierRow).join('')}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="j-btn j-btn-line j-btn-sm" id="${px}-q-add">+ Add an option</button>${defaultQuote ? `<button type="button" class="j-btn j-btn-ghost j-btn-sm" id="${px}-q-def">Use the default Pro quote (${esc(money(defaultQuote.perCents))}${defaultQuote.tiers.map((t) => `, ${t.n} at ${money(t.cents)}`).join('')})</button>` : ''}</div>
    <p class="small" id="${px}-q-sum" style="margin:6px 0 0"></p>
    <p class="j-err" id="${px}-q-err" hidden></p></div>`
}

// perInput: the form's price per session box. read() gives { tiers } or { error }.
export function wireQuote(box, px, { perInput, defaultQuote = null } = {}) {
  const $ = (id) => box.querySelector(`#${px}-${id}`)
  const rows = () => [...$('q-rows').querySelectorAll('[data-tier]')]
  const raw = () => rows().map((r) => ({ n: Number(r.querySelector('[data-n]').value.trim()), cents: centsOf(r.querySelector('[data-c]').value) })).filter((t) => t.n || t.cents)
  const per = () => centsOf(perInput?.value)
  const read = () => {
    const tiers = raw()
    const p = per()
    for (const t of tiers) {
      if (!Number.isInteger(t.n) || t.n < 2 || t.n > 20) return { error: 'A commitment is 2 to 20 sessions in a row.' }
      if (!(t.cents >= 100)) return { error: `Enter the price each for ${t.n} sessions in a row.` }
      if (tiers.filter((x) => x.n === t.n).length > 1) return { error: `There are two options for ${t.n} sessions in a row. Keep one.` }
      if (p != null && t.cents >= p) return { error: `${t.n} in a row at ${money(t.cents)} each is not less than ${money(p)} a session.` }
    }
    if (tiers.length && !(p >= 100)) return { error: 'Enter the price per session first.' }
    return { tiers: tiers.sort((a, b) => a.n - b.n) }
  }
  const paint = () => {
    const p = per()
    const tiers = raw().filter((t) => t.n >= 2 && t.cents >= 100)
    $('q-sum').innerHTML = p >= 100 && tiers.length ? tiers.map((t) => `${esc(t.n)} in a row: <b>${esc(money(t.n * t.cents))}</b>${t.cents < p ? ` <span class="muted">(saves ${esc(money(t.n * (p - t.cents)))})</span>` : ''}`).join(' · ') : ''
    const r = read()
    $('q-err').textContent = r.error || ''; $('q-err').hidden = !r.error
  }
  const set = (tiers) => { $('q-rows').innerHTML = tiers.map(tierRow).join(''); paint() }
  $('q-add').addEventListener('click', () => { $('q-rows').insertAdjacentHTML('beforeend', tierRow()); $('q-rows').querySelector('[data-tier]:last-child [data-n]')?.focus() })
  $('q-rows').addEventListener('click', (e) => { if (e.target.closest('[data-rm]')) { e.target.closest('[data-tier]').remove(); paint() } })
  $('q-rows').addEventListener('input', paint)
  perInput?.addEventListener('input', paint)
  $('q-def')?.addEventListener('click', () => { if (perInput && defaultQuote) perInput.value = dollars(defaultQuote.perCents); set(defaultQuote?.tiers || []) })
  paint()
  return { read, set, show: (on) => { $('q').hidden = !on } }
}

export const sameTiers = (a = [], b = []) => JSON.stringify(a.map((t) => [t.n, t.cents])) === JSON.stringify(b.map((t) => [t.n, t.cents]))
